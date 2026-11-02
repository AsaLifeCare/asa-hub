using System.Collections.Concurrent;
using System.Threading.Channels;
using AsaHubChat.Relay;

namespace AsaHubChat.Live;

/// <summary>
/// One queue per sender: a person's sends land in the order they were typed, one at a time. A lane holds at most
/// `capacity` sends waiting behind the one on its way; past that a send is refused at once, never held in memory.
/// </summary>
public sealed class SenderLanes
{
    public const int DefaultCapacity = 20;

    private sealed class Lane
    {
        private readonly Channel<Func<Task>> queue;

        public Lane(int capacity)
        {
            queue = Channel.CreateBounded<Func<Task>>(new BoundedChannelOptions(capacity)
            {
                SingleReader = true,
                FullMode = BoundedChannelFullMode.Wait,
            });
            _ = Task.Run(PumpAsync);
        }

        private async Task PumpAsync()
        {
            await foreach (var item in queue.Reader.ReadAllAsync())
            {
                await item();
            }
        }

        /// <summary>Null when the lane is full: TryWrite on a full bounded channel refuses rather than waits.</summary>
        public Task<T>? TryEnqueue<T>(Func<Task<T>> work)
        {
            var done = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            var taken = queue.Writer.TryWrite(async () =>
            {
                try
                {
                    done.TrySetResult(await work());
                }
                catch (Exception exc)
                {
                    done.TrySetException(exc);
                }
            });
            return taken ? done.Task : null;
        }
    }

    private readonly ConcurrentDictionary<string, Lane> lanes = new(StringComparer.Ordinal);
    private readonly int capacity;

    public SenderLanes(int capacity = DefaultCapacity) => this.capacity = Math.Max(1, capacity);

    /// <summary>Queued synchronously, so two calls made in order run in that order; null when the lane is full.</summary>
    public Task<T>? TryRun<T>(string person, Func<Task<T>> work) =>
        lanes.GetOrAdd(person, _ => new Lane(capacity)).TryEnqueue(work);
}

/// <summary>Relay execs one person may hold at once, across all of their connections: no account holds every slot.</summary>
public sealed class PersonExecGate
{
    private readonly ConcurrentDictionary<string, SemaphoreSlim> gates = new(StringComparer.Ordinal);
    private readonly int perPerson;

    public PersonExecGate(int perPerson) => this.perPerson = Math.Max(1, perPerson);

    /// <summary>A read mark or a reaction: a share of its own, so a read the relay answers from memory never waits behind one.</summary>
    public Task<T> RunWrite<T>(string person, Func<Task<T>> work) => Run(person + "\n\u0001write", work);

    public async Task<T> Run<T>(string person, Func<Task<T>> work)
    {
        var gate = gates.GetOrAdd(person, _ => new SemaphoreSlim(perPerson, perPerson));
        await gate.WaitAsync();
        try
        {
            return await work();
        }
        finally
        {
            gate.Release();
        }
    }
}

/// <summary>Mark-read per thread: one in flight; whatever arrives meanwhile shares one more run, the latest's.</summary>
public sealed class ReadCoalescer
{
    private sealed class Slot
    {
        public Func<Task<RelayAnswer>>? NextWork;
        public List<TaskCompletionSource<RelayAnswer>> NextWaiters = new();
    }

    private readonly object gate = new();
    private readonly Dictionary<string, Slot> slots = new(StringComparer.Ordinal);

    public Task<RelayAnswer> Run(string key, Func<Task<RelayAnswer>> work)
    {
        var mine = new TaskCompletionSource<RelayAnswer>(TaskCreationOptions.RunContinuationsAsynchronously);
        bool start;
        lock (gate)
        {
            if (slots.TryGetValue(key, out var slot))
            {
                slot.NextWork = work;
                slot.NextWaiters.Add(mine);
                start = false;
            }
            else
            {
                slots[key] = new Slot();
                start = true;
            }
        }
        if (start)
        {
            _ = PumpAsync(key, work, mine);
        }
        return mine.Task;
    }

    private async Task PumpAsync(string key, Func<Task<RelayAnswer>> work, TaskCompletionSource<RelayAnswer> first)
    {
        var waiters = new List<TaskCompletionSource<RelayAnswer>> { first };
        while (true)
        {
            RelayAnswer answer;
            try
            {
                answer = await work();
            }
            catch (Exception exc)
            {
                answer = RelayAnswer.Transport(exc.GetType().Name);
            }
            foreach (var w in waiters)
            {
                w.TrySetResult(answer);
            }
            lock (gate)
            {
                var slot = slots[key];
                if (slot.NextWork is null)
                {
                    slots.Remove(key);
                    return;
                }
                work = slot.NextWork;
                waiters = slot.NextWaiters;
                slot.NextWork = null;
                slot.NextWaiters = new();
            }
        }
    }
}
