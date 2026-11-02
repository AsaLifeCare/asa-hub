using AsaHubChat.Auth;
using AsaHubChat.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;

namespace AsaHubChat.Live;

/// <summary>
/// Every frame the hub sends, from one place. A frame for another person goes out only while the relay's frame
/// gate is open; the sender's own tabs always hear their own words.
/// </summary>
public sealed class Pusher
{
    private readonly IHubContext<ChatHub> hub;
    private readonly SessionRegistry sessions;
    private readonly TicketCache tickets;
    private readonly IOptionsMonitor<ChatOptions> options;
    private readonly TimeProvider clock;

    public Pusher(IHubContext<ChatHub> hub, SessionRegistry sessions, TicketCache tickets,
        IOptionsMonitor<ChatOptions> options, TimeProvider clock)
    {
        this.hub = hub;
        this.sessions = sessions;
        this.tickets = tickets;
        this.options = options;
        this.clock = clock;
    }

    public Task ToGroups(IEnumerable<string> groups, string method, object payload) =>
        hub.Clients.Groups(groups.Distinct().ToList()).SendAsync(method, payload);

    public Task ToPeople(IEnumerable<string> ids, string method, object payload) =>
        ToGroups(ids.Where(id => id.Length > 0).Select(ThreadKeys.PersonGroup), method, payload);

    /// <summary>A person's tabs but one: the tab that did it already shows it.</summary>
    public Task ToPersonExcept(string id, string connectionId, string method, object payload) =>
        id.Length == 0
            ? Task.CompletedTask
            : hub.Clients.GroupExcept(ThreadKeys.PersonGroup(id), new[] { connectionId }).SendAsync(method, payload);

    public Task ToConnections(IReadOnlyList<string> connectionIds, string method, object payload) =>
        connectionIds.Count == 0 ? Task.CompletedTask : hub.Clients.Clients(connectionIds).SendAsync(method, payload);

    public Task ToConnection(string connectionId, string method, params object[] args) =>
        args.Length == 0
            ? hub.Clients.Client(connectionId).SendAsync(method)
            : hub.Clients.Client(connectionId).SendAsync(method, args[0]);

    /// <summary>Presence of one person, to the connections whose partners include them — never while the gate holds.</summary>
    public Task Presence(string person, bool online)
    {
        if (sessions.LastFrameHeld)
        {
            return Task.CompletedTask;
        }
        var to = sessions.PartnersOf(person).Select(s => s.ConnectionId).ToList();
        return to.Count == 0
            ? Task.CompletedTask
            : hub.Clients.Clients(to).SendAsync("presence", new { user_id = person, online });
    }

    /// <summary>A ref the relay no longer knows as a session: its connections are told, then closed.</summary>
    public async Task Revoke(string reference)
    {
        tickets.DropRef(reference);
        var gone = sessions.ByRef(reference);
        foreach (var session in gone)
        {
            try
            {
                await hub.Clients.Client(session.ConnectionId).SendAsync("revoked");
            }
            catch (Exception)
            {
                // a connection already going: the abort below is what matters
            }
        }
        if (gone.Count == 0)
        {
            return;
        }
        // a moment for the frame to leave before the connection does
        await Task.Delay(TimeSpan.FromMilliseconds(250));
        foreach (var session in gone)
        {
            session.Context?.Abort();
        }
    }

    /// <summary>
    /// A ref the relay forgot (it restarted, or the ref idled out): the connections holding it ask for a new ticket
    /// and stay open — until ReauthGrace has passed without one, when ConnectionSweeper closes them. A tab whose
    /// session ended cannot get that ticket, so it stops hearing anything.
    /// </summary>
    public async Task Reauth(string reference)
    {
        foreach (var session in sessions.ByRef(reference))
        {
            await Ask(session);
        }
    }

    /// <summary>The relay restarted: every connection renews, or is closed.</summary>
    public async Task ReauthAll()
    {
        foreach (var session in sessions.All())
        {
            await Ask(session);
        }
    }

    private async Task Ask(LiveSession session)
    {
        session.AskReauth(clock.GetUtcNow() + options.CurrentValue.ReauthGrace);
        try
        {
            await hub.Clients.Client(session.ConnectionId).SendAsync("reauth");
        }
        catch (Exception)
        {
            // a connection already going; the sweeper closes it if it is not
        }
    }
}
