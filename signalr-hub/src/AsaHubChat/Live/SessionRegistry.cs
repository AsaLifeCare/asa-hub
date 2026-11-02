using System.Collections.Concurrent;
using AsaHubChat.Relay;
using Microsoft.AspNetCore.SignalR;

namespace AsaHubChat.Live;

/// <summary>One live connection: whose it is (from the ticket), which ref it spends, what it may be told.</summary>
public sealed class LiveSession
{
    private readonly object gate = new();
    private readonly HashSet<string> folds = new(StringComparer.Ordinal);
    private readonly HashSet<string> partners = new(StringComparer.Ordinal);
    private readonly HashSet<string> listed = new(StringComparer.Ordinal);
    private readonly HashSet<string> threads = new(StringComparer.Ordinal);
    private string reference;
    private string sheetId = "";
    private DateTimeOffset? reauthDue;

    public LiveSession(string connectionId, Identity who, HubCallerContext? context, DateTimeOffset connectedAt)
    {
        ConnectionId = connectionId;
        AccountId = who.AccountId;
        PersonId = who.PersonId.Length > 0 ? who.PersonId : who.AccountId;
        Name = who.Name;
        Tenant = who.Tenant;
        Narrowed = who.Narrowed;
        reference = who.Ref;
        Context = context;
        ConnectedAt = connectedAt;
        folds.Add(PersonId);
        folds.Add(AccountId);
        foreach (var id in who.FoldIds)
        {
            folds.Add(id);
        }
    }

    public string ConnectionId { get; }
    public string AccountId { get; }
    public string PersonId { get; }

    /// <summary>What this person's pushed lines are signed with; a renewal fills it in if the ticket had none.</summary>
    public string Name { get; set; }

    public string Tenant { get; }

    /// <summary>A client or a guardian: it reaches only the people its last rail named, and hears presence of fewer.</summary>
    public bool Narrowed { get; }

    public HubCallerContext? Context { get; }
    public DateTimeOffset ConnectedAt { get; }
    public bool Visible { get; set; } = true;

    public string Ref
    {
        get { lock (gate) { return reference; } }
        set { lock (gate) { reference = value; } }
    }

    /// <summary>
    /// The id the sheet writes for this person (chatOverview `me`, Chat.gs chatPersonId_), once an Overview has said
    /// it; the relay's fold until then. What this person's frames are signed with, so the other end files them
    /// under the thread the sheet keeps.
    /// </summary>
    public string SelfId
    {
        get { lock (gate) { return sheetId.Length > 0 ? sheetId : PersonId; } }
    }

    /// <summary>Only an id already among this connection's own (AddFold first).</summary>
    public void SetSheetId(string id)
    {
        lock (gate)
        {
            if (folds.Contains(id))
            {
                sheetId = id;
            }
        }
    }

    /// <summary>Asked to renew its ref by then; the first ask sets the time, a later one does not move it.</summary>
    public void AskReauth(DateTimeOffset due)
    {
        lock (gate)
        {
            reauthDue ??= due;
        }
    }

    public void Reauthed()
    {
        lock (gate)
        {
            reauthDue = null;
        }
    }

    public bool ReauthOverdue(DateTimeOffset now)
    {
        lock (gate)
        {
            return reauthDue is { } due && now > due;
        }
    }

    public IReadOnlyList<string> FoldIds
    {
        get { lock (gate) { return folds.ToList(); } }
    }

    public bool HasFold(string id)
    {
        lock (gate) { return folds.Contains(id); }
    }

    /// <summary>True when the id was not one of this connection's own before.</summary>
    public bool AddFold(string id)
    {
        lock (gate) { return folds.Add(id); }
    }

    public void SetPartners(IEnumerable<string> ids)
    {
        lock (gate)
        {
            partners.Clear();
            foreach (var id in ids)
            {
                partners.Add(id);
            }
        }
    }

    public bool IsPartner(string id)
    {
        lock (gate) { return partners.Contains(id); }
    }

    /// <summary>Everybody the last rail named: its people and its conversations.</summary>
    public void SetListed(IEnumerable<string> ids)
    {
        lock (gate)
        {
            listed.Clear();
            foreach (var id in ids)
            {
                listed.Add(id);
            }
        }
    }

    /// <summary>Whether this connection may reach that person: anyone, unless narrowed to what its rail named.</summary>
    public bool MayReach(string id)
    {
        lock (gate) { return !Narrowed || listed.Contains(id); }
    }

    /// <summary>
    /// Whether the last rail named that person, narrowed or not. Chat.gs names there only whom this person may write
    /// to from this place (and a client's or a guardian's circle), so it is what Apps Script is likely to take.
    /// </summary>
    public bool Lists(string id)
    {
        lock (gate) { return listed.Contains(id); }
    }

    public bool OpenThread(string key)
    {
        lock (gate) { return threads.Add(key); }
    }

    public bool CloseThread(string key)
    {
        lock (gate) { return threads.Remove(key); }
    }
}

public sealed class SessionRegistry
{
    private readonly ConcurrentDictionary<string, LiveSession> byConnection = new(StringComparer.Ordinal);
    private readonly object frameGate = new();
    private bool frameHeld = true;
    private DateTimeOffset frameHeardAt = DateTimeOffset.MinValue;

    /// <summary>The relay's frame gate as last answered. Until an answer says otherwise, it holds.</summary>
    public bool LastFrameHeld
    {
        get { lock (frameGate) { return frameHeld; } }
    }

    /// <summary>What a relay answer said of the frame gate, heard at `at`; a word older than the one held is not taken.</summary>
    public void NoteFrameGate(bool held, DateTimeOffset at)
    {
        lock (frameGate)
        {
            if (at < frameHeardAt)
            {
                return;
            }
            frameHeld = held;
            frameHeardAt = at;
        }
    }

    /// <summary>
    /// Open, as a relay answer heard at or after `since` said. One process-wide word: any answer sets it, so an older
    /// one is not taken for the gate now (the switch may have gone on since), and none at all holds.
    /// </summary>
    public bool FrameOpenSince(DateTimeOffset since)
    {
        lock (frameGate) { return !frameHeld && frameHeardAt >= since; }
    }

    public int Count => byConnection.Count;

    public void Add(LiveSession session) => byConnection[session.ConnectionId] = session;

    public LiveSession? Get(string connectionId) => byConnection.TryGetValue(connectionId, out var s) ? s : null;

    public LiveSession? Remove(string connectionId) => byConnection.TryRemove(connectionId, out var s) ? s : null;

    public IReadOnlyList<LiveSession> All() => byConnection.Values.ToList();

    public IReadOnlyList<LiveSession> ByRef(string reference) =>
        byConnection.Values.Where(s => s.Ref == reference).ToList();

    /// <summary>Every ref a connection here holds, visible or not: what the relay is asked about.</summary>
    public IReadOnlyList<string> Refs() =>
        byConnection.Values.Select(s => s.Ref).Where(r => r.Length > 0).Distinct(StringComparer.Ordinal).ToList();

    /// <summary>The connections that hear that id's person group: every one with it among its own ids.</summary>
    public IReadOnlyList<LiveSession> OfPerson(string id) =>
        byConnection.Values.Where(s => s.HasFold(id)).ToList();

    public IReadOnlyList<LiveSession> PartnersOf(string personId) =>
        byConnection.Values.Where(s => s.IsPartner(personId)).ToList();
}
