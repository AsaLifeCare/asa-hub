using System.Collections.Concurrent;
using System.Text.Json;
using AsaHubChat.Relay;
using Microsoft.Extensions.Options;

namespace AsaHubChat.Live;

/// <summary>
/// While a person has a visible connection, one chatPing every PresenceEvery keeps chat_presence fresh, so Apps
/// Script's away letter is not sent to somebody who is here. It replaces the shell's beat for live tabs, one for one.
/// The pings of one round go PingsAtOnce at a time: each waits on Apps Script (seconds, up to the relay's budget),
/// and one after another a round of many people would outlast PresenceEvery and leave their presence stale.
///
/// The ping is also the floor under every other way a line reaches a tab: its answer carries the person's unread
/// count and newest unread line, and when either moved since that person was last told, their own tabs are nudged
/// and read the rail again. A sender still on today's chat whose send was never heard by the relay is found here,
/// as the shell's beat found it; the frame gate does not apply, as the nudge goes to the person's own tabs alone.
/// </summary>
public sealed class PresencePinger : BackgroundService
{
    /// <summary>People remembered at most; past this the memory starts again (at worst one extra nudge each).</summary>
    private const int ToldMax = 10_000;

    private readonly PresenceRegistry presence;
    private readonly IRelayClient relay;
    private readonly Pusher push;
    private readonly SessionRegistry sessions;
    private readonly IOptionsMonitor<ChatOptions> options;
    private readonly TimeProvider clock;

    /// <summary>person -> the unread mark their tabs were last nudged for (or found at their first ping).</summary>
    private readonly ConcurrentDictionary<string, string> told = new(StringComparer.Ordinal);

    public PresencePinger(PresenceRegistry presence, IRelayClient relay, Pusher push, SessionRegistry sessions,
        IOptionsMonitor<ChatOptions> options, TimeProvider clock)
    {
        this.presence = presence;
        this.relay = relay;
        this.push = push;
        this.sessions = sessions;
        this.options = options;
        this.clock = clock;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(options.CurrentValue.PresenceTick, clock, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            try
            {
                await RoundAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
        }
    }

    /// <summary>One round: every person owed a ping now, PingsAtOnce at a time.</summary>
    public async Task RoundAsync(CancellationToken ct)
    {
        // only people with a visible tab are pinged, so only they are remembered
        foreach (var person in told.Keys)
        {
            if (!presence.IsOnline(person))
            {
                told.TryRemove(person, out _);
            }
        }
        if (told.Count > ToldMax)
        {
            told.Clear();
        }
        var due = presence.DuePings(options.CurrentValue.PresenceEvery);
        if (due.Count == 0)
        {
            return;
        }
        var parallel = new ParallelOptions
        {
            MaxDegreeOfParallelism = Math.Max(1, options.CurrentValue.PingsAtOnce),
            CancellationToken = ct,
        };
        await Parallel.ForEachAsync(due, parallel, (ping, token) => new ValueTask(PingAsync(ping.Person, ping.Ref, token)));
    }

    /// <summary>One person's ping; what it teaches (the frame gate, a forgotten or ended ref, unread moving) is acted on here.</summary>
    private async Task PingAsync(string person, string reference, CancellationToken ct)
    {
        try
        {
            var answer = await relay.ExecAsync(reference, "chatPing", new { }, "", ct);
            if (answer.Status != 0)
            {
                sessions.NoteFrameGate(answer.FrameHeld, clock.GetUtcNow());
            }
            if (answer.RefUnknown)
            {
                await push.Reauth(reference);
            }
            else if (answer.Revoked)
            {
                await push.Revoke(reference);
            }
            else if (Moved(person, UnreadMark(answer)))
            {
                await push.ToPeople(new[] { person }, "nudge", new { thread_key = "", action = "chatPing" });
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            // one person's ping is not the round's end; the next round pings them again
        }
    }

    /// <summary>
    /// Whether the person's tabs are owed a nudge: the mark moved since the last one. At a person's first ping this
    /// hub knows nothing of what their tabs read, so an unread line there is owed one (a rail read for nothing, at
    /// worst).
    /// </summary>
    private bool Moved(string person, (long Unread, string Mark)? now)
    {
        if (now is null || person.Length == 0)
        {
            return false;
        }
        var seen = now.Value;
        var had = told.TryGetValue(person, out var before);
        told[person] = seen.Mark;
        return had ? !string.Equals(before, seen.Mark, StringComparison.Ordinal) : seen.Unread > 0;
    }

    /// <summary>chatPing's unread count and newest unread line, by its id and time — never its words; null when unreadable.</summary>
    internal static (long Unread, string Mark)? UnreadMark(RelayAnswer answer)
    {
        if (!answer.Ok || answer.Data is not { ValueKind: JsonValueKind.Object } d
            || !d.TryGetProperty("unread", out var u) || u.ValueKind != JsonValueKind.Number)
        {
            return null;
        }
        var unread = u.TryGetInt64(out var n) ? n : (long)u.GetDouble();
        var id = "";
        var at = "";
        if (d.TryGetProperty("latest", out var latest) && latest.ValueKind == JsonValueKind.Object)
        {
            id = Text(latest, "id");
            at = Text(latest, "at");
        }
        return (unread, unread + "\n" + id + "\n" + at);
    }

    private static string Text(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
}
