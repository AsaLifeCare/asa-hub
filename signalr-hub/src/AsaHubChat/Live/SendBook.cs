namespace AsaHubChat.Live;

/// <summary>
/// Every send this hub was handed, by its sender and client id. A client id is one message: a repeat of it while it
/// is on its way is nothing, a repeat of a delivered one is told its receipt again, and a repeat of a failed one is
/// its Retry, which goes again under the same id (the relay's write_id hands back the receipt if the row landed after
/// all). So a repeat is never a second row, nor a second bubble at either end. Only the words' hash is kept.
/// </summary>
public sealed class SendBook
{
    public enum Kind
    {
        /// <summary>New, or the Retry of a failed one: push it and send it.</summary>
        Start,
        OnItsWay,
        Sent,
        /// <summary>The same client id with other words or for somebody else: refused.</summary>
        Mismatch,
    }

    /// <summary>What the sheet answered for a delivered send.</summary>
    public sealed record Receipt(string Id, string CreatedAt, string ThreadKey, string From);

    public readonly record struct Begun(Kind Kind, Receipt? Receipt);

    private enum State
    {
        OnItsWay,
        Sent,
        Failed,
    }

    private sealed class Entry
    {
        public required string To { get; init; }
        public required int BodyHash { get; init; }
        public required int BodyLength { get; init; }
        public State State { get; set; }
        public Receipt? Receipt { get; set; }
        public DateTimeOffset At { get; set; }
    }

    /// <summary>Past this many, every settled entry goes, however young.</summary>
    private const int MaxEntries = 100_000;

    private readonly object gate = new();
    private readonly Dictionary<string, Entry> entries = new(StringComparer.Ordinal);
    private readonly TimeSpan keep;
    private readonly TimeProvider clock;
    private DateTimeOffset pruned = DateTimeOffset.MinValue;

    public SendBook(TimeSpan keep, TimeProvider clock)
    {
        this.keep = keep > TimeSpan.Zero ? keep : TimeSpan.FromHours(1);
        this.clock = clock;
    }

    public int Count
    {
        get { lock (gate) { return entries.Count; } }
    }

    public Begun Begin(string person, string clientId, string to, string body)
    {
        var now = clock.GetUtcNow();
        var key = Key(person, clientId);
        lock (gate)
        {
            Prune(now);
            if (entries.TryGetValue(key, out var e))
            {
                if (e.To != to || e.BodyLength != body.Length || e.BodyHash != Hash(body))
                {
                    return new Begun(Kind.Mismatch, null);
                }
                switch (e.State)
                {
                    case State.OnItsWay:
                        return new Begun(Kind.OnItsWay, null);
                    case State.Sent:
                        return new Begun(Kind.Sent, e.Receipt);
                }
                e.State = State.OnItsWay;
                e.At = now;
                return new Begun(Kind.Start, null);
            }
            entries[key] = new Entry { To = to, BodyHash = Hash(body), BodyLength = body.Length, State = State.OnItsWay, At = now };
            return new Begun(Kind.Start, null);
        }
    }

    public void Sent(string person, string clientId, Receipt receipt) => Settle(person, clientId, State.Sent, receipt);

    public void Failed(string person, string clientId) => Settle(person, clientId, State.Failed, null);

    /// <summary>Never started (its lane was full): the next Send of it starts afresh.</summary>
    public void Forget(string person, string clientId)
    {
        lock (gate)
        {
            entries.Remove(Key(person, clientId));
        }
    }

    private void Settle(string person, string clientId, State state, Receipt? receipt)
    {
        var now = clock.GetUtcNow();
        lock (gate)
        {
            if (entries.TryGetValue(Key(person, clientId), out var e))
            {
                e.State = state;
                e.Receipt = receipt;
                e.At = now;
            }
        }
    }

    /// <summary>Settled entries older than `keep` (all settled ones past MaxEntries); one on its way always stays.</summary>
    private void Prune(DateTimeOffset now)
    {
        var crowded = entries.Count > MaxEntries;
        if (!crowded && now - pruned < TimeSpan.FromMinutes(1))
        {
            return;
        }
        pruned = now;
        var gone = entries
            .Where(kv => kv.Value.State != State.OnItsWay && (crowded || now - kv.Value.At > keep))
            .Select(kv => kv.Key)
            .ToList();
        foreach (var key in gone)
        {
            entries.Remove(key);
        }
    }

    private static int Hash(string body) => StringComparer.Ordinal.GetHashCode(body);

    private static string Key(string person, string clientId) => person + "\n" + clientId;
}
