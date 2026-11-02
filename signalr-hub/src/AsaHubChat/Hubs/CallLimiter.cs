using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;

namespace AsaHubChat.Hubs;

/// <summary>
/// A token bucket per connection over every hub call. nginx's limit_req counts HTTP requests, and a WebSocket is
/// one request however many frames it carries: without this, one granted connection could call as fast as it can
/// write. A call past the bucket is refused with `refused:`, never queued.
/// </summary>
public sealed class CallLimiter : IHubFilter
{
    private sealed class Bucket
    {
        public double Tokens;
        public DateTimeOffset At;
    }

    private readonly ConcurrentDictionary<string, Bucket> buckets = new(StringComparer.Ordinal);
    private readonly IOptionsMonitor<ChatOptions> options;
    private readonly TimeProvider clock;

    public CallLimiter(IOptionsMonitor<ChatOptions> options, TimeProvider clock)
    {
        this.options = options;
        this.clock = clock;
    }

    public int Count => buckets.Count;

    public async ValueTask<object?> InvokeMethodAsync(HubInvocationContext invocationContext,
        Func<HubInvocationContext, ValueTask<object?>> next)
    {
        if (!TryTake(invocationContext.Context.ConnectionId))
        {
            throw new HubException("refused: too many calls at once; wait a moment");
        }
        return await next(invocationContext);
    }

    public Task OnConnectedAsync(HubLifetimeContext context, Func<HubLifetimeContext, Task> next) => next(context);

    public async Task OnDisconnectedAsync(HubLifetimeContext context, Exception? exception,
        Func<HubLifetimeContext, Exception?, Task> next)
    {
        buckets.TryRemove(context.Context.ConnectionId, out _);
        await next(context, exception);
    }

    /// <summary>One call's token, if the connection has one left.</summary>
    public bool TryTake(string connectionId)
    {
        var o = options.CurrentValue;
        var burst = Math.Max(1, o.CallBurst);
        var now = clock.GetUtcNow();
        var bucket = buckets.GetOrAdd(connectionId, _ => new Bucket { Tokens = burst, At = now });
        lock (bucket)
        {
            var earned = (now - bucket.At).TotalSeconds * Math.Max(0, o.CallsPerSecond);
            bucket.Tokens = Math.Min(burst, bucket.Tokens + earned);
            bucket.At = now;
            if (bucket.Tokens < 1)
            {
                return false;
            }
            bucket.Tokens -= 1;
            return true;
        }
    }
}
