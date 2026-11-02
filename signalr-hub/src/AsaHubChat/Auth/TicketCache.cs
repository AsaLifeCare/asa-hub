using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using AsaHubChat.Relay;
using Microsoft.Extensions.Options;

namespace AsaHubChat.Auth;

/// <summary>
/// A ticket redeemed once, remembered for the connection it opened. Negotiate spends the relay's first use;
/// the connect, and every later request of a Server-Sent Events or long-polling connection, are answered here
/// for that same connection id without asking the relay again. Keyed by the ticket's hash, never the ticket.
/// </summary>
public sealed class TicketCache
{
    private sealed class Entry
    {
        public required Identity Who { get; init; }
        public string Connection { get; set; } = "";
        public DateTimeOffset Seen { get; set; }
    }

    private readonly ConcurrentDictionary<string, Entry> entries = new(StringComparer.Ordinal);
    private readonly IOptionsMonitor<ChatOptions> options;
    private readonly TimeProvider clock;

    public TicketCache(IOptionsMonitor<ChatOptions> options, TimeProvider clock)
    {
        this.options = options;
        this.clock = clock;
    }

    public int Count => entries.Count;

    public static string Hash(string ticket) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(ticket)));

    /// <summary>The identity for this ticket on this connection; an unbound entry binds to the first connection that uses it.</summary>
    public bool TryGet(string key, string connection, out Identity? who)
    {
        who = null;
        if (!entries.TryGetValue(key, out var entry))
        {
            return false;
        }
        var now = clock.GetUtcNow();
        lock (entry)
        {
            var life = entry.Connection.Length == 0 ? options.CurrentValue.TicketCacheUnbound : options.CurrentValue.TicketCacheSlide;
            if (now - entry.Seen > life)
            {
                entries.TryRemove(key, out _);
                return false;
            }
            if (entry.Connection.Length == 0)
            {
                if (connection.Length == 0)
                {
                    // a second negotiate with the same ticket: the relay counts that use
                    return false;
                }
                entry.Connection = connection;
            }
            else if (entry.Connection != connection)
            {
                return false;
            }
            entry.Seen = now;
            who = entry.Who;
            return true;
        }
    }

    public void Put(string key, string connection, Identity who)
    {
        Prune();
        entries[key] = new Entry { Who = who, Connection = connection, Seen = clock.GetUtcNow() };
    }

    public void DropRef(string reference)
    {
        foreach (var (key, entry) in entries)
        {
            if (entry.Who.Ref == reference)
            {
                entries.TryRemove(key, out _);
            }
        }
    }

    private void Prune()
    {
        if (entries.Count < 4096)
        {
            return;
        }
        var now = clock.GetUtcNow();
        var slide = options.CurrentValue.TicketCacheSlide;
        foreach (var (key, entry) in entries)
        {
            if (now - entry.Seen > slide)
            {
                entries.TryRemove(key, out _);
            }
        }
    }
}
