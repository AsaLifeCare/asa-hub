using AsaHubChat.Relay;
using Microsoft.Extensions.Options;

namespace AsaHubChat.Live;

/// <summary>
/// No connection outlives the session it was opened for. A ticket opens a connection once; after that it is kept
/// honest here, not by the tab:
///   - every RefCheckEvery the relay is asked which refs held here (hidden tabs too) are still sessions: an unknown
///     one is asked to renew, an ended one is closed;
///   - a connection asked to renew that has not by ReauthGrace is closed (a tab whose session ended cannot get the
///     ticket to renew with);
///   - none lives past MaxConnectionLife: the tab reconnects through the ticket door, which judges it again.
/// A closed connection reconnects on its own if it can; nothing here is logged about whose it was.
/// </summary>
public sealed class ConnectionSweeper : BackgroundService
{
    private readonly SessionRegistry sessions;
    private readonly IRelayClient relay;
    private readonly Pusher push;
    private readonly IOptionsMonitor<ChatOptions> options;
    private readonly TimeProvider clock;
    private DateTimeOffset lastCheck;

    public ConnectionSweeper(SessionRegistry sessions, IRelayClient relay, Pusher push, IOptionsMonitor<ChatOptions> options,
        TimeProvider clock)
    {
        this.sessions = sessions;
        this.relay = relay;
        this.push = push;
        this.options = options;
        this.clock = clock;
        lastCheck = clock.GetUtcNow();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(options.CurrentValue.SweepTick, clock, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            try
            {
                await SweepAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception)
            {
                // one bad pass is not the end of the sweeper; the next tick looks again
            }
        }
    }

    /// <summary>One pass: the relay's word on the refs when it is due, then overdue renewals and old connections.</summary>
    public async Task SweepAsync(CancellationToken ct)
    {
        var o = options.CurrentValue;
        var now = clock.GetUtcNow();
        if (now - lastCheck >= o.RefCheckEvery)
        {
            lastCheck = now;
            var refs = sessions.Refs();
            if (refs.Count > 0 && await relay.CheckRefsAsync(refs, ct) is { } verdict)
            {
                foreach (var reference in verdict.Revoked)
                {
                    await push.Revoke(reference);
                }
                foreach (var reference in verdict.Unknown)
                {
                    await push.Reauth(reference);
                }
            }
        }
        now = clock.GetUtcNow();
        foreach (var session in sessions.All())
        {
            if (session.ReauthOverdue(now) || now - session.ConnectedAt > o.MaxConnectionLife)
            {
                session.Context?.Abort();
            }
        }
    }
}
