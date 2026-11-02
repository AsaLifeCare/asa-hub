namespace AsaHubChat.Live;

/// <summary>
/// Person -> their visible connections. Online while one is visible; each such person is owed one chatPing every
/// PresenceEvery, so Apps Script's away letter (chatMaybeMail_ reads chat_presence) sees them as here.
/// </summary>
public sealed class PresenceRegistry
{
    private sealed class Entry
    {
        public readonly Dictionary<string, string> Visible = new(StringComparer.Ordinal);   // connection -> ref
        public DateTimeOffset LastPing = DateTimeOffset.MinValue;
    }

    private readonly object gate = new();
    private readonly Dictionary<string, Entry> byPerson = new(StringComparer.Ordinal);
    private readonly TimeProvider clock;

    public PresenceRegistry(TimeProvider clock) => this.clock = clock;

    /// <summary>True when the person's online state changed.</summary>
    public bool SetVisible(string person, string connectionId, bool visible, string reference)
    {
        lock (gate)
        {
            var before = IsOnlineLocked(person);
            if (!byPerson.TryGetValue(person, out var entry))
            {
                entry = new Entry();
                byPerson[person] = entry;
            }
            if (visible)
            {
                entry.Visible[connectionId] = reference;
            }
            else
            {
                entry.Visible.Remove(connectionId);
            }
            if (entry.Visible.Count == 0 && entry.LastPing == DateTimeOffset.MinValue)
            {
                byPerson.Remove(person);
            }
            return before != IsOnlineLocked(person);
        }
    }

    /// <summary>A connection that is gone. True when the person's online state changed.</summary>
    public bool Remove(string person, string connectionId) => SetVisible(person, connectionId, false, "");

    public bool IsOnline(string person)
    {
        lock (gate) { return IsOnlineLocked(person); }
    }

    /// <summary>The ref of a visible connection whose person is owed a ping now; marked as pinged.</summary>
    public IReadOnlyList<(string Person, string Ref)> DuePings(TimeSpan every)
    {
        var now = clock.GetUtcNow();
        var due = new List<(string, string)>();
        lock (gate)
        {
            foreach (var (person, entry) in byPerson)
            {
                if (entry.Visible.Count == 0 || now - entry.LastPing < every)
                {
                    continue;
                }
                entry.LastPing = now;
                due.Add((person, entry.Visible.Values.Last()));
            }
            foreach (var person in byPerson.Where(p => p.Value.Visible.Count == 0).Select(p => p.Key).ToList())
            {
                byPerson.Remove(person);
            }
        }
        return due;
    }

    private bool IsOnlineLocked(string person) => byPerson.TryGetValue(person, out var e) && e.Visible.Count > 0;
}
