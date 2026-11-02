using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using AsaHubChat.Auth;
using AsaHubChat.Live;
using AsaHubChat.Relay;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;

namespace AsaHubChat.Hubs;

/// <summary>
/// The chat's transport. Who is asking comes from the redeemed ticket and nothing else: no method takes a person,
/// a target or a member for the caller. Every read and write goes through the relay's exec door with the caller's
/// ref; the messages stay in Apps Script. A refusal reaches the caller as a HubException whose message starts with
/// its kind: `reauth:`, `revoked:`, `refused:`, `failed:`.
/// </summary>
[Authorize]
public sealed class ChatHub : Hub
{
    private const int BodyMax = 4000;

    private readonly SessionRegistry sessions;
    private readonly PresenceRegistry presence;
    private readonly SenderLanes lanes;
    private readonly SendBook book;
    private readonly ReadCoalescer reads;
    private readonly PersonExecGate execs;
    private readonly IRelayClient relay;
    private readonly Pusher push;
    private readonly IOptionsMonitor<ChatOptions> options;
    private readonly TimeProvider clock;

    public ChatHub(SessionRegistry sessions, PresenceRegistry presence, SenderLanes lanes, SendBook book, ReadCoalescer reads,
        PersonExecGate execs, IRelayClient relay, Pusher push, IOptionsMonitor<ChatOptions> options, TimeProvider clock)
    {
        this.sessions = sessions;
        this.presence = presence;
        this.lanes = lanes;
        this.book = book;
        this.reads = reads;
        this.execs = execs;
        this.relay = relay;
        this.push = push;
        this.options = options;
        this.clock = clock;
    }

    public override async Task OnConnectedAsync()
    {
        var who = TicketAuthHandler.IdentityOf(Context.User);
        if (who is null)
        {
            Context.Abort();
            return;
        }
        var session = new LiveSession(Context.ConnectionId, who, Context, clock.GetUtcNow());
        sessions.Add(session);
        foreach (var id in session.FoldIds)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, ThreadKeys.PersonGroup(id));
        }
        if (presence.SetVisible(session.PersonId, Context.ConnectionId, true, session.Ref))
        {
            await push.Presence(session.PersonId, true);
        }
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var session = sessions.Remove(Context.ConnectionId);
        if (session is not null && presence.Remove(session.PersonId, Context.ConnectionId))
        {
            await push.Presence(session.PersonId, false);
        }
        await base.OnDisconnectedAsync(exception);
    }

    /// <summary>The rail: threads, people, unread — with presence from the live registry as well as the sheet.</summary>
    public async Task<JsonNode?> Overview()
    {
        var session = Me();
        var answer = await Exec(session, "chatOverview", new { });
        var data = answer.Data is { } d ? JsonNode.Parse(d.GetRawText()) : null;
        if (data is not JsonObject root)
        {
            return data;
        }
        // self-healing: the sheet's own name for this person joins the connection's ids, and signs its frames
        var me = Text(root["me"]);
        if (ThreadKeys.ValidPersonId(me))
        {
            if (session.AddFold(me))
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, ThreadKeys.PersonGroup(me));
            }
            session.SetSheetId(me);
        }
        var partners = new List<string>();
        var listed = new List<string>();
        // a narrowed caller (a client or a guardian) hears presence only of the people its rail lists
        var people = new HashSet<string>(StringComparer.Ordinal);
        if (root["people"] is JsonArray folks)
        {
            foreach (var item in folks.OfType<JsonObject>())
            {
                people.Add(Text(item["user_id"]));
            }
        }
        foreach (var list in new[] { "threads", "people" })
        {
            if (root[list] is not JsonArray items)
            {
                continue;
            }
            foreach (var item in items.OfType<JsonObject>())
            {
                var id = Text(item["with_user"]);
                if (id.Length == 0)
                {
                    id = Text(item["user_id"]);
                }
                if (id.Length == 0)
                {
                    continue;
                }
                listed.Add(id);
                if (session.Narrowed && !people.Contains(id))
                {
                    continue;
                }
                partners.Add(id);
                if (presence.IsOnline(id))
                {
                    item["online"] = true;
                }
            }
        }
        session.SetPartners(partners);
        session.SetListed(listed);
        // the ids a pushed message may carry as this person's own (the tab judges `mine` by them)
        root["live_ids"] = new JsonArray(session.FoldIds.Select(id => (JsonNode?)JsonValue.Create(id)).ToArray());
        return root;
    }

    public async Task<JsonElement?> Messages(string withId, string? after)
    {
        var session = Me();
        RequirePerson(session, withId);
        var payload = string.IsNullOrEmpty(after)
            ? (object)new { with_user = withId }
            : new { with_user = withId, after };
        var answer = await Exec(session, "chatMessages", payload);
        return answer.Data;
    }

    public async Task OpenThread(string withId)
    {
        var session = Me();
        var key = ThreadKeys.For(session.SelfId, withId);
        if (key is null || !ThreadKeys.Owns(key, session.FoldIds) || session.HasFold(withId) || !session.MayReach(withId))
        {
            throw new HubException("refused: that is not one of your conversations");
        }
        if (session.OpenThread(key))
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, ThreadKeys.ThreadGroup(key));
        }
    }

    public async Task CloseThread(string withId)
    {
        var session = Me();
        // opened before the sheet's own id was known, it was keyed by the relay's
        foreach (var self in new[] { session.SelfId, session.PersonId }.Distinct())
        {
            var key = ThreadKeys.For(self, withId);
            if (key is not null && session.CloseThread(key))
            {
                await Groups.RemoveFromGroupAsync(Context.ConnectionId, ThreadKeys.ThreadGroup(key));
            }
        }
    }

    /// <summary>
    /// The words go out the moment they arrive — `message` with state `sending` to the sender's other tabs, and to the
    /// recipient when PushSending may — and the send is queued on the sender's lane and answered at once: an Apps
    /// Script append takes seconds (a minute in its tail). The ending follows as frames: `confirm` (the sheet's id)
    /// when the relay has kept it to write behind (at once) or the sheet has it; `gone` if a kept send is refused
    /// later (RelayEvents); `retract` to the recipient's tabs that were shown the words and `send_failed` to the
    /// sender when it will not. A client id is one message (SendBook): a repeat is never a second row nor a second
    /// bubble.
    /// </summary>
    public async Task<object> Send(string withId, string body, string clientId)
    {
        var session = Me();
        RequirePerson(session, withId);
        if (string.IsNullOrWhiteSpace(body) || body.Length > BodyMax)
        {
            throw new HubException("refused: a message is 1 to 4000 characters");
        }
        if (!ThreadKeys.ValidClientId(clientId))
        {
            throw new HubException("refused: a message carries its own client id");
        }
        var begun = book.Begin(session.PersonId, clientId, withId, body);
        switch (begun.Kind)
        {
            case SendBook.Kind.Mismatch:
                throw new HubException("refused: that client id is another message's");
            case SendBook.Kind.OnItsWay:
                return new { client_id = clientId, queued = true };
            case SendBook.Kind.Sent:
                // delivered already: its receipt again, to this person's own tabs
                await push.ToPeople(new[] { session.PersonId }, "confirm", Confirmed(begun.Receipt!, clientId, withId, session.Name, body));
                return new { client_id = clientId, queued = false };
        }
        // the append waits for the words to be out, so the recipient always hears `message` before its ending
        var told = new TaskCompletionSource<IReadOnlyList<string>>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (lanes.TryRun(session.PersonId, async () => await SendWithRetry(session, withId, body, clientId, await told.Task)) is null)
        {
            book.Forget(session.PersonId, clientId);
            throw new HubException("refused: too many messages are still on their way; wait for them");
        }
        IReadOnlyList<string> heard = Array.Empty<string>();
        try
        {
            heard = await PushSending(session, withId, body, clientId);
        }
        finally
        {
            told.TrySetResult(heard);
        }
        return new { client_id = clientId, queued = true };
    }

    /// <summary>
    /// The words before the sheet has them. The sender's other tabs always hear them. The recipient only when the
    /// sender's last rail names it (Chat.gs lists there whom this person may write to from this place, and a client's
    /// or a guardian's circle), while the frame gate is open now (FrameOpenNow), and a client or a guardian only from
    /// somebody its own rail names — anybody else hears the line with its `confirm`, once Apps Script has judged the
    /// send. Answers the recipient's connections the words were handed to: they alone hear how it ended whatever the
    /// gate says by then.
    /// </summary>
    private async Task<IReadOnlyList<string>> PushSending(LiveSession session, string withId, string body, string clientId)
    {
        var self = session.SelfId;
        var frame = new
        {
            client_id = clientId,
            @from = self,
            from_name = session.Name,
            to = withId,
            body,
            thread_key = ThreadKeys.For(self, withId) ?? "",
            at = Iso(clock.GetUtcNow()),
            state = "sending",
        };
        IReadOnlyList<string> told = Array.Empty<string>();
        try
        {
            await push.ToPersonExcept(session.PersonId, Context.ConnectionId, "message", frame);
            if (!session.Lists(withId))
            {
                return told;
            }
            var mine = session.FoldIds;
            var to = sessions.OfPerson(withId)
                .Where(r => !r.Narrowed || mine.Any(r.MayReach))
                .Select(r => r.ConnectionId)
                .Distinct(StringComparer.Ordinal)
                .ToList();
            // nobody to hand them to asks the relay nothing
            if (to.Count == 0 || !await FrameOpenNow())
            {
                return told;
            }
            // set before the frame leaves: a push that fails part way may still have reached some of them
            told = to;
            await push.ToConnections(to, "message", frame);
            return told;
        }
        catch (Exception)
        {
            // a frame that could not leave never stops the send; its ending still reaches the sender
            return told;
        }
    }

    /// <summary>
    /// The frame gate now: open when a relay answer within FrameGateFresh said so; otherwise the relay's gate door is
    /// asked (nothing in Apps Script). Held when neither says open — the words then wait for the sheet.
    /// </summary>
    private async Task<bool> FrameOpenNow()
    {
        var o = options.CurrentValue;
        if (sessions.FrameOpenSince(clock.GetUtcNow() - o.FrameGateFresh))
        {
            return true;
        }
        using var ask = new CancellationTokenSource(o.FrameGateAsk);
        var answer = await relay.FrameGateAsync(ask.Token);
        if (answer.Status != 0)
        {
            sessions.NoteFrameGate(answer.FrameHeld, clock.GetUtcNow());
        }
        return answer.Ok && !answer.FrameHeld;
    }

    /// <summary>The ending of a delivered send, whole: a tab that never heard its `message` draws it from this.</summary>
    internal static object Confirmed(SendBook.Receipt receipt, string clientId, string withId, string fromName, string body) => new
    {
        client_id = clientId,
        id = receipt.Id,
        created_at = receipt.CreatedAt,
        state = "sent",
        thread_key = receipt.ThreadKey,
        @from = receipt.From,
        from_name = fromName,
        to = withId,
        body,
    };

    /// <summary>The sheet's own form of a time (JavaScript's toISOString), so pushed and read lines sort together.</summary>
    internal static string Iso(DateTimeOffset at) =>
        at.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    /// <summary>
    /// Tried with the same client id each time, so a retry is the same write; never cancelled with the connection.
    /// A wait that would end past the deadline is not waited: the send says it failed, and a Retry (same client id)
    /// gets the receipt if it landed after all.
    /// `send_failed` says which ending it was: `unconfirmed` when the last word could not tell whether the row landed
    /// (Apps Script took it and did not answer, or the relay could not be heard), so the tab says "not confirmed"
    /// and offers the Retry rather than "not sent" and a retyped duplicate; false when it was refused outright.
    /// `told`: the recipient's connections that were shown the words at once. They hear the ending whatever the gate
    /// says by then; every other connection of the recipient hears the `confirm` only if the gate is open at the
    /// answer, and never a `retract` (it drew nothing to take back).
    /// </summary>
    private async Task<bool> SendWithRetry(LiveSession session, string withId, string body, string clientId,
        IReadOnlyList<string> told)
    {
        var o = options.CurrentValue;
        var deadline = clock.GetUtcNow() + o.SendDeadline;
        var why = "the message was not sent";
        var unconfirmed = false;
        try
        {
            var wait = TimeSpan.Zero;
            for (var attempt = 1; attempt <= o.SendTries && clock.GetUtcNow() + wait < deadline; attempt++)
            {
                if (wait > TimeSpan.Zero)
                {
                    await Task.Delay(wait, clock);
                }
                var answer = await relay.ExecAsync(session.Ref, "chatSend", new { to_user = withId, body }, clientId, CancellationToken.None);
                await Settle(session, answer);
                if (answer.Ok)
                {
                    var threadKey = answer.DataString("thread_key");
                    var receipt = new SendBook.Receipt(answer.DataString("id"), answer.DataString("created_at"), threadKey,
                        SenderId(session, threadKey, withId));
                    book.Sent(session.PersonId, clientId, receipt);
                    var confirm = Confirmed(receipt, clientId, withId, session.Name, body);
                    try
                    {
                        await push.ToPeople(new[] { session.PersonId }, "confirm", confirm);
                        if (!answer.FrameHeld)
                        {
                            await push.ToPeople(new[] { withId }, "confirm", confirm);
                        }
                        else
                        {
                            // the gate closed since the words went out: only the tabs showing them hear how they ended
                            await push.ToConnections(told, "confirm", confirm);
                        }
                    }
                    catch (Exception)
                    {
                        // delivered all the same: a tab that missed its ending finds the row on its next read
                    }
                    return true;
                }
                if (answer.Message.Length > 0)
                {
                    why = answer.Message;
                }
                // a refusal or a forgotten ref ran nothing; a retriable ending may have landed
                unconfirmed = answer.Retriable;
                if (answer.Revoked || !(answer.Retriable || answer.RefUnknown))
                {
                    break;
                }
                // a forgotten ref: the tab was just asked to re-ticket, and this connection's ref is swapped in place
                wait = answer.RefUnknown ? TimeSpan.FromSeconds(3)
                    : answer.Unconfirmed ? TimeSpan.FromSeconds(Math.Max(1, answer.RetryAfterS))
                    : TimeSpan.FromSeconds(attempt * 5);
                wait = wait < o.SendRetryWaitFloor ? o.SendRetryWaitFloor : wait > o.SendRetryWaitCap ? o.SendRetryWaitCap : wait;
            }
        }
        catch (Exception exc)
        {
            why = "the hub lost track of it (" + exc.GetType().Name + ")";
            unconfirmed = true;
        }
        book.Failed(session.PersonId, clientId);
        try
        {
            // the bubble the recipient's tabs were shown goes; a Retry that lands shows it again
            await push.ToConnections(told, "retract", new { client_id = clientId, why });
        }
        finally
        {
            await push.ToPeople(new[] { session.PersonId }, "send_failed",
                new { client_id = clientId, to_user = withId, why, unconfirmed });
        }
        return false;
    }

    /// <summary>
    /// The sheet's id for the sender: the side of the answer's thread key that is not the person written to (the key
    /// is Chat.gs's own, built from its chatPersonId_); the Overview's `me` when the key cannot say.
    /// </summary>
    internal static string SenderId(LiveSession session, string threadKey, string withId)
    {
        var parts = threadKey.Split('|');
        if (parts.Length == 2 && parts[0].Length > 0 && parts[1].Length > 0 && parts[0] != parts[1])
        {
            // where the relay's fold and the sheet's differ, the sheet is right: it is what the other end reads
            if (parts[0] == withId)
            {
                return parts[1];
            }
            if (parts[1] == withId)
            {
                return parts[0];
            }
        }
        return session.SelfId;
    }

    /// <summary>`withId` is the conversation the reaction was made in, as the tab files it; it only labels the frame.</summary>
    public async Task<object> React(string messageId, string emoji, string clientId, string? withId)
    {
        var session = Me();
        if (string.IsNullOrWhiteSpace(messageId) || messageId.Length > 200 || string.IsNullOrWhiteSpace(emoji) || emoji.Length > 16)
        {
            throw new HubException("refused: which message, and which reaction");
        }
        if (!ThreadKeys.ValidClientId(clientId))
        {
            throw new HubException("refused: a reaction carries its own client id");
        }
        var answer = await Exec(session, "chatReact", new { message_id = messageId, emoji }, clientId, write: true);
        var other = answer.DataString("to_user");
        JsonNode? reactions = answer.Data is { ValueKind: JsonValueKind.Object } d && d.TryGetProperty("reactions", out var r)
            ? JsonNode.Parse(r.GetRawText())
            : null;
        var self = session.SelfId;
        // the sheet hands back the other end's raw account id; the tab's own name for the conversation files it
        var label = ThreadKeys.ValidPersonId(withId) && !session.HasFold(withId!) ? withId! : other;
        var frame = new
        {
            message_id = messageId,
            reactions,
            by = self,
            thread_key = label.Length > 0 ? ThreadKeys.For(self, label) ?? "" : "",
        };
        await push.ToPeople(new[] { session.PersonId }, "reaction", frame);
        if (!answer.FrameHeld && other.Length > 0)
        {
            await push.ToPeople(new[] { other }, "reaction", frame);
        }
        return frame;
    }

    /// <summary>One in flight per thread; the reader's tabs hear it (badges), the thread hears it unless held (receipts).</summary>
    public async Task<object> MarkRead(string withId)
    {
        var session = Me();
        RequirePerson(session, withId);
        var answer = await reads.Run(session.PersonId + "\n" + withId,
            () => execs.RunWrite(session.PersonId,
                () => relay.ExecAsync(session.Ref, "chatMarkRead", new { with_user = withId }, NewClientId(), CancellationToken.None)));
        await Settle(session, answer);
        if (!answer.Ok)
        {
            throw Fail(answer);
        }
        var self = session.SelfId;
        var key = ThreadKeys.For(self, withId) ?? "";
        var frame = new
        {
            with_user = withId,
            by = self,
            thread_key = key,
            marked = answer.DataString("marked"),
            at = clock.GetUtcNow().ToString("O"),
        };
        var groups = new List<string> { ThreadKeys.PersonGroup(session.PersonId) };
        if (!answer.FrameHeld && key.Length > 0)
        {
            groups.Add(ThreadKeys.ThreadGroup(key));
        }
        await push.ToGroups(groups, "read", frame);
        return frame;
    }

    public async Task SetVisible(bool visible)
    {
        var session = Me();
        session.Visible = visible;
        if (presence.SetVisible(session.PersonId, Context.ConnectionId, visible, session.Ref))
        {
            await push.Presence(session.PersonId, visible);
        }
    }

    /// <summary>A new ticket for the same session and place: the ref is swapped and the socket stays.</summary>
    public async Task<object> Reauth(string ticket)
    {
        var session = Me();
        var (who, answer) = await relay.RedeemAsync(ticket ?? "", Context.ConnectionAborted);
        if (who is null)
        {
            if (answer.Revoked)
            {
                await push.Revoke(session.Ref);
            }
            throw new HubException("refused: " + (answer.Reason.Length > 0 ? answer.Reason : "the ticket was not accepted"));
        }
        if (who.AccountId != session.AccountId || who.Tenant != session.Tenant)
        {
            throw new HubException("refused: that ticket is another session's");
        }
        session.Ref = who.Ref;
        session.Reauthed();
        if (session.Name.Length == 0 && who.Name.Length > 0)
        {
            session.Name = who.Name;
        }
        foreach (var id in who.FoldIds)
        {
            if (session.AddFold(id))
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, ThreadKeys.PersonGroup(id));
            }
        }
        if (session.Visible)
        {
            presence.SetVisible(session.PersonId, Context.ConnectionId, true, session.Ref);
        }
        return new { ok = true };
    }

    private LiveSession Me() =>
        sessions.Get(Context.ConnectionId) ?? throw new HubException("reauth: this connection is not known");

    private static void RequirePerson(LiveSession session, string withId)
    {
        if (!ThreadKeys.ValidPersonId(withId) || session.HasFold(withId) || !session.MayReach(withId))
        {
            throw new HubException("refused: that is not somebody you can write to");
        }
    }

    private static string NewClientId() => Guid.NewGuid().ToString("N");

    private static string Text(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<string>(out var text) ? text : "";

    private async Task<RelayAnswer> Exec(LiveSession session, string action, object payload, string clientId = "",
        bool write = false)
    {
        Func<Task<RelayAnswer>> work = () => relay.ExecAsync(session.Ref, action, payload, clientId, CancellationToken.None);
        var answer = await (write ? execs.RunWrite(session.PersonId, work) : execs.Run(session.PersonId, work));
        await Settle(session, answer);
        if (!answer.Ok)
        {
            throw Fail(answer);
        }
        return answer;
    }

    /// <summary>What every relay answer teaches: the frame gate, and a ref that is unknown or revoked.</summary>
    private async Task Settle(LiveSession session, RelayAnswer answer)
    {
        if (answer.Status != 0)
        {
            sessions.NoteFrameGate(answer.FrameHeld, clock.GetUtcNow());
        }
        if (answer.RefUnknown)
        {
            await push.Reauth(session.Ref);
        }
        else if (answer.Revoked)
        {
            await push.Revoke(session.Ref);
        }
    }

    private static HubException Fail(RelayAnswer answer)
    {
        if (answer.RefUnknown)
        {
            return new HubException("reauth: this session must be renewed");
        }
        if (answer.Revoked)
        {
            return new HubException("revoked: " + (answer.Reason == "acting" ? "chat is off while acting as someone else" : "the session ended"));
        }
        return new HubException("failed: " + (answer.Message.Length > 0 ? answer.Message : "the chat did not answer"));
    }
}
