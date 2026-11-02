using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AsaHubChat.Relay;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace AsaHubChat.Tests;

/// <summary>The hub end to end over the test server, with the relay answered by FakeRelay.</summary>
public sealed class ChatHubTests : IAsyncLifetime
{
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(800);

    private readonly HubFactory factory = new();
    private readonly List<HubConnection> connections = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var c in connections)
        {
            await c.DisposeAsync();
        }
        await factory.DisposeAsync();
    }

    private async Task<HubConnection> Connect(string ticket)
    {
        var c = await factory.Connect(ticket);
        connections.Add(c);
        return c;
    }

    private static TaskCompletionSource<JsonElement> Listen(HubConnection c, string method)
    {
        var got = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        c.On<JsonElement>(method, m => got.TrySetResult(m));
        return got;
    }

    private static TaskCompletionSource<bool> ListenBare(HubConnection c, string method)
    {
        var got = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        c.On(method, () => got.TrySetResult(true));
        return got;
    }

    private static TaskCompletionSource<bool> Closed(HubConnection c)
    {
        var closed = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        c.Closed += _ =>
        {
            closed.TrySetResult(true);
            return Task.CompletedTask;
        };
        return closed;
    }

    private static async Task Until(Func<bool> what)
    {
        var end = DateTime.UtcNow + Wait;
        while (!what())
        {
            if (DateTime.UtcNow > end)
            {
                throw new TimeoutException("timed out waiting");
            }
            await Task.Delay(10);
        }
    }

    [Fact]
    public async Task AFoldedAccountReceivesAFrameSentToItsPerson()
    {
        factory.Person("tk-acc2", "ref-acc2", "acc-2", "per-1", "per-1", "acc-2");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        factory.Relay.Rails["ref-bob"] = new[] { "per-1" };
        var folded = await Connect("tk-acc2");
        var bob = await Connect("tk-bob");
        // the gate is open once the relay has said so, and bob's rail names per-1
        await bob.InvokeAsync<JsonElement>("Overview");
        var got = Listen(folded, "message");
        var settled = Listen(folded, "confirm");

        await bob.InvokeAsync<JsonElement>("Send", "per-1", "hello", "client-000001");

        var message = await got.Task.WaitAsync(Wait);
        Assert.Equal("per-1", message.GetProperty("to").GetString());
        Assert.Equal("per-bob", message.GetProperty("from").GetString());
        Assert.Equal("hello", message.GetProperty("body").GetString());
        Assert.Equal("per-1", (await settled.Task.WaitAsync(Wait)).GetProperty("to").GetString());
    }

    [Fact]
    public async Task OpenThreadRefusesAThreadThatIsNotTheCallers()
    {
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        var ann = await Connect("tk-ann");

        var foreign = await Assert.ThrowsAsync<HubException>(() => ann.InvokeAsync("OpenThread", "per-x|per-y"));
        Assert.Contains("refused", foreign.Message);
        await Assert.ThrowsAsync<HubException>(() => ann.InvokeAsync("OpenThread", "per-ann"));
        await ann.InvokeAsync("OpenThread", "per-bob");
    }

    [Fact]
    public async Task ASendAnswersAtOnceAndIsRetriedWithTheSameClientId()
    {
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Relay.Script("chatSend",
            () => FakeRelay.Refusal(504, "unconfirmed", retryAfterS: 1),
            () => FakeRelay.Ok("""{"id":"msg_9","created_at":"2026-01-01T00:00:00.000Z","thread_key":"per-ann|per-bob"}"""));
        var ann = await Connect("tk-ann");
        var echo = Listen(ann, "confirm");

        var queued = await ann.InvokeAsync<JsonElement>("Send", "per-bob", "once", "client-000002");
        Assert.True(queued.GetProperty("queued").GetBoolean());

        var landed = await echo.Task.WaitAsync(Wait);
        Assert.Equal("msg_9", landed.GetProperty("id").GetString());
        Assert.Equal("client-000002", landed.GetProperty("client_id").GetString());
        Assert.Equal("sent", landed.GetProperty("state").GetString());
        var sends = factory.Relay.CallsFor("chatSend");
        Assert.Equal(2, sends.Count);
        Assert.All(sends, s => Assert.Equal("client-000002", s.ClientId));
    }

    [Fact]
    public async Task ASendThatIsRefusedIsNotRetriedAndSaysSo()
    {
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Relay.Script("chatSend", () => new RelayAnswer { Status = 404, Message = "Not found.", FrameHeld = true });
        var ann = await Connect("tk-ann");
        var failed = Listen(ann, "send_failed");

        await ann.InvokeAsync<JsonElement>("Send", "per-bob", "x", "client-000003");

        var said = await failed.Task.WaitAsync(Wait);
        Assert.Equal("client-000003", said.GetProperty("client_id").GetString());
        Assert.Equal("Not found.", said.GetProperty("why").GetString());
        Assert.False(said.GetProperty("unconfirmed").GetBoolean(), "a refusal ran nothing: it was not sent");
        Assert.Single(factory.Relay.CallsFor("chatSend"));
    }

    [Fact]
    public async Task ASendNobodyConfirmedSaysNotConfirmedRatherThanNotSent()
    {
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Relay.Script("chatSend",
            () => FakeRelay.Refusal(504, "unconfirmed", retryAfterS: 1),
            () => FakeRelay.Refusal(504, "unconfirmed", retryAfterS: 1),
            () => FakeRelay.Refusal(504, "unconfirmed", retryAfterS: 1));
        var ann = await Connect("tk-ann");
        var failed = Listen(ann, "send_failed");

        await ann.InvokeAsync<JsonElement>("Send", "per-bob", "maybe", "client-000070");

        var said = await failed.Task.WaitAsync(Wait);
        Assert.Equal("client-000070", said.GetProperty("client_id").GetString());
        Assert.True(said.GetProperty("unconfirmed").GetBoolean(), "the row may have landed: the tab offers the Retry");
        Assert.Equal(3, factory.Relay.CallsFor("chatSend").Count);
    }

    [Fact]
    public async Task OneSendersMessagesLandInTheOrderTheyWereSent()
    {
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Relay.BeforeExec = async (action, payload) =>
        {
            if (action == "chatSend" && payload.Contains("\"first\""))
            {
                await Task.Delay(400);
            }
        };
        var ann = await Connect("tk-ann");
        var landed = new List<string>();
        var both = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        ann.On<JsonElement>("confirm", m =>
        {
            lock (landed)
            {
                landed.Add(m.GetProperty("body").GetString() ?? "");
                if (landed.Count == 2)
                {
                    both.TrySetResult();
                }
            }
        });

        await ann.InvokeAsync<JsonElement>("Send", "per-bob", "first", "client-000010");
        await ann.InvokeAsync<JsonElement>("Send", "per-bob", "second", "client-000011");
        await both.Task.WaitAsync(Wait);

        var order = factory.Relay.CallsFor("chatSend").Select(c => JsonDocument.Parse(c.Payload).RootElement.GetProperty("body").GetString()).ToList();
        Assert.Equal(new[] { "first", "second" }, order);
        Assert.Equal(new[] { "first", "second" }, landed);
    }

    [Fact]
    public async Task AHeldFrameReachesTheSendersTabsButNotTheRecipient()
    {
        factory.Relay.FrameHeld = true;
        factory.Person("tk-ann1", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-ann2", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        factory.Relay.Rails["ref-ann"] = new[] { "per-bob" };
        var ann1 = await Connect("tk-ann1");
        var ann2 = await Connect("tk-ann2");
        var bob = await Connect("tk-bob");
        // the relay has said it holds
        await ann1.InvokeAsync<JsonElement>("Overview");
        var echo = Listen(ann2, "message");
        var settled = Listen(ann2, "confirm");
        var leak = Listen(bob, "message");
        var leakSettled = Listen(bob, "confirm");

        await ann1.InvokeAsync<JsonElement>("Send", "per-bob", "held words", "client-000020");

        var mine = await echo.Task.WaitAsync(Wait);
        Assert.Equal("held words", mine.GetProperty("body").GetString());
        Assert.Equal("sending", mine.GetProperty("state").GetString());
        await settled.Task.WaitAsync(Wait);
        await Task.Delay(Quiet);
        Assert.False(leak.Task.IsCompleted, "the recipient heard a frame while the gate held");
        Assert.False(leakSettled.Task.IsCompleted, "the recipient heard the ending while the gate held");
    }

    [Fact]
    public async Task AnOpenGateReachesTheRecipient()
    {
        factory.Relay.FrameHeld = false;
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        factory.Relay.Rails["ref-ann"] = new[] { "per-bob" };
        var ann = await Connect("tk-ann");
        var bob = await Connect("tk-bob");
        await ann.InvokeAsync<JsonElement>("Overview");
        var got = Listen(bob, "message");

        await ann.InvokeAsync<JsonElement>("Send", "per-bob", "open", "client-000021");

        Assert.Equal("open", (await got.Task.WaitAsync(Wait)).GetProperty("body").GetString());
    }

    [Fact]
    public async Task ASendReachesTheRecipientAtOnceBeforeTheSheetHasItThenIsConfirmed()
    {
        factory.Relay.FrameHeld = false;
        var sheet = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        factory.Relay.BeforeExec = async (action, _) =>
        {
            if (action == "chatSend")
            {
                await sheet.Task;
            }
        };
        factory.Relay.Script("chatSend",
            () => FakeRelay.Ok("""{"id":"msg_77","created_at":"2026-01-01T10:00:12.000Z","thread_key":"per-ann|per-bob"}"""));
        factory.Person("tk-ann1", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-ann2", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        factory.Relay.Rails["ref-ann"] = new[] { "per-bob" };
        var ann1 = await Connect("tk-ann1");
        var ann2 = await Connect("tk-ann2");
        var bob = await Connect("tk-bob");
        await ann1.InvokeAsync<JsonElement>("Overview");
        var bobHeard = Listen(bob, "message");
        var bobSettled = Listen(bob, "confirm");
        var otherTab = Listen(ann2, "message");
        var sameTab = Listen(ann1, "message");
        var annSettled = Listen(ann1, "confirm");

        await ann1.InvokeAsync<JsonElement>("Send", "per-bob", "right now", "client-000080");

        // the append is still on its way, and the recipient already has the words
        var now = await bobHeard.Task.WaitAsync(Wait);
        Assert.Equal("sending", now.GetProperty("state").GetString());
        Assert.Equal("client-000080", now.GetProperty("client_id").GetString());
        Assert.Equal("per-ann", now.GetProperty("from").GetString());
        Assert.Equal("per-bob", now.GetProperty("to").GetString());
        Assert.Equal("right now", now.GetProperty("body").GetString());
        Assert.Equal("per-ann|per-bob", now.GetProperty("thread_key").GetString());
        Assert.True(DateTimeOffset.TryParse(now.GetProperty("at").GetString(), out _));
        Assert.Equal("right now", (await otherTab.Task.WaitAsync(Wait)).GetProperty("body").GetString());
        Assert.False(bobSettled.Task.IsCompleted);
        Assert.False(sheet.Task.IsCompleted);

        sheet.SetResult();
        var done = await bobSettled.Task.WaitAsync(Wait);
        Assert.Equal("client-000080", done.GetProperty("client_id").GetString());
        Assert.Equal("msg_77", done.GetProperty("id").GetString());
        Assert.Equal("2026-01-01T10:00:12.000Z", done.GetProperty("created_at").GetString());
        Assert.Equal("sent", done.GetProperty("state").GetString());
        Assert.Equal("msg_77", (await annSettled.Task.WaitAsync(Wait)).GetProperty("id").GetString());
        await Task.Delay(Quiet);
        Assert.False(sameTab.Task.IsCompleted, "the tab that sent it already shows it");
        Assert.Single(factory.Relay.CallsFor("chatSend"));
    }

    [Fact]
    public async Task ASendThatFailsIsRetractedFromTheRecipientAndSaidToTheSender()
    {
        factory.Relay.FrameHeld = false;
        factory.Relay.Script("chatSend", () => new RelayAnswer { Status = 404, Message = "Not found.", FrameHeld = false });
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        factory.Relay.Rails["ref-ann"] = new[] { "per-bob" };
        var ann = await Connect("tk-ann");
        var bob = await Connect("tk-bob");
        await ann.InvokeAsync<JsonElement>("Overview");
        var shown = Listen(bob, "message");
        var gone = Listen(bob, "retract");
        var settled = Listen(bob, "confirm");
        var failed = Listen(ann, "send_failed");

        await ann.InvokeAsync<JsonElement>("Send", "per-bob", "never stored", "client-000081");

        Assert.Equal("client-000081", (await shown.Task.WaitAsync(Wait)).GetProperty("client_id").GetString());
        var retract = await gone.Task.WaitAsync(Wait);
        Assert.Equal("client-000081", retract.GetProperty("client_id").GetString());
        Assert.Equal("Not found.", retract.GetProperty("why").GetString());
        Assert.Equal("client-000081", (await failed.Task.WaitAsync(Wait)).GetProperty("client_id").GetString());
        await Task.Delay(Quiet);
        Assert.False(settled.Task.IsCompleted);
    }

    [Fact]
    public async Task OneClientIdIsOneMessageOneRowAndOneBubble()
    {
        factory.Relay.FrameHeld = false;
        var sheet = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        factory.Relay.BeforeExec = async (action, _) =>
        {
            if (action == "chatSend")
            {
                await sheet.Task;
            }
        };
        factory.Person("tk-ann1", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-ann2", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        factory.Relay.Rails["ref-ann"] = new[] { "per-bob" };
        var ann1 = await Connect("tk-ann1");
        var ann2 = await Connect("tk-ann2");
        var bob = await Connect("tk-bob");
        await ann1.InvokeAsync<JsonElement>("Overview");
        var shown = 0;
        var settled = 0;
        var annSettled = 0;
        bob.On<JsonElement>("message", _ => Interlocked.Increment(ref shown));
        bob.On<JsonElement>("confirm", _ => Interlocked.Increment(ref settled));
        ann1.On<JsonElement>("confirm", _ => Interlocked.Increment(ref annSettled));

        await ann1.InvokeAsync<JsonElement>("Send", "per-bob", "just once", "client-000082");
        // the same message again while it is on its way, from this tab and from another of the same person
        var again = await ann1.InvokeAsync<JsonElement>("Send", "per-bob", "just once", "client-000082");
        Assert.True(again.GetProperty("queued").GetBoolean());
        await ann2.InvokeAsync<JsonElement>("Send", "per-bob", "just once", "client-000082");
        await Until(() => Volatile.Read(ref shown) == 1);

        sheet.SetResult();
        await Until(() => Volatile.Read(ref settled) == 1 && Volatile.Read(ref annSettled) == 1);

        // delivered: a repeat is told its receipt again, and nobody else hears anything
        var late = await ann1.InvokeAsync<JsonElement>("Send", "per-bob", "just once", "client-000082");
        Assert.False(late.GetProperty("queued").GetBoolean());
        await Until(() => Volatile.Read(ref annSettled) == 2);

        // the same client id is never another message's
        var other = await Assert.ThrowsAsync<HubException>(
            () => ann1.InvokeAsync<JsonElement>("Send", "per-bob", "other words", "client-000082"));
        Assert.Contains("refused", other.Message);

        await Task.Delay(Quiet);
        Assert.Equal(1, Volatile.Read(ref shown));
        Assert.Equal(1, Volatile.Read(ref settled));
        Assert.Single(factory.Relay.CallsFor("chatSend"));
    }

    [Fact]
    public async Task ARetryOfAFailedSendIsShownAgainAndLandsUnderTheSameClientId()
    {
        factory.Relay.FrameHeld = false;
        factory.Relay.Script("chatSend",
            () => new RelayAnswer { Status = 404, Message = "Not found.", FrameHeld = false },
            () => FakeRelay.Ok("""{"id":"msg_83","created_at":"2026-01-01T10:00:00.000Z","thread_key":"per-ann|per-bob"}"""));
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        factory.Relay.Rails["ref-ann"] = new[] { "per-bob" };
        var ann = await Connect("tk-ann");
        var bob = await Connect("tk-bob");
        await ann.InvokeAsync<JsonElement>("Overview");
        var heard = new ConcurrentQueue<string>();
        foreach (var kind in new[] { "message", "confirm", "retract" })
        {
            bob.On<JsonElement>(kind, f => heard.Enqueue(kind + ":" + f.GetProperty("client_id").GetString()));
        }
        var failed = Listen(ann, "send_failed");

        await ann.InvokeAsync<JsonElement>("Send", "per-bob", "second try", "client-000083");
        await failed.Task.WaitAsync(Wait);
        await Until(() => heard.Count == 2);

        await ann.InvokeAsync<JsonElement>("Send", "per-bob", "second try", "client-000083");
        await Until(() => heard.Count == 4);

        Assert.Equal(new[] { "message:client-000083", "retract:client-000083", "message:client-000083", "confirm:client-000083" },
            heard.ToArray());
        Assert.All(factory.Relay.CallsFor("chatSend"), c => Assert.Equal("client-000083", c.ClientId));
        Assert.Equal(2, factory.Relay.CallsFor("chatSend").Count);
    }

    [Fact]
    public async Task AGateThatOpensByTheAnswerHandsTheRecipientTheWholeLineOnce()
    {
        // the rail that names the recipient is itself a relay answer, and it said the gate holds; the switch goes off
        // there, the hub has not heard it, and the gate door does not answer: the words wait for the sheet
        factory.Relay.FrameHeld = true;
        factory.Relay.GateAnswer = () => RelayAnswer.Transport("HttpRequestException");
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        factory.Relay.Rails["ref-ann"] = new[] { "per-bob" };
        var ann = await Connect("tk-ann");
        var bob = await Connect("tk-bob");
        await ann.InvokeAsync<JsonElement>("Overview");
        // a call answered proves the recipient's connect ran: only the gate keeps the words back
        await bob.InvokeAsync("SetVisible", true);
        factory.Relay.FrameHeld = false;
        var early = Listen(bob, "message");
        var settled = Listen(bob, "confirm");

        await ann.InvokeAsync<JsonElement>("Send", "per-bob", "after the sheet", "client-000084");

        var whole = await settled.Task.WaitAsync(Wait);
        Assert.Equal("after the sheet", whole.GetProperty("body").GetString());
        Assert.Equal("per-ann", whole.GetProperty("from").GetString());
        Assert.Equal("sent", whole.GetProperty("state").GetString());
        await Task.Delay(Quiet);
        Assert.False(early.Task.IsCompleted);
        Assert.True(factory.Relay.GateChecks >= 1, "the gate door was asked");
    }

    [Fact]
    public async Task AGateWordTooOldIsAskedAgainAndASwitchTurnedOnSinceHoldsTheWords()
    {
        // every word is too old: the gate door is asked at each send
        factory.Tune = o => o.FrameGateFresh = TimeSpan.Zero;
        factory.Relay.FrameHeld = false;
        factory.Person("tk-ann1", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-ann2", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        factory.Relay.Rails["ref-ann"] = new[] { "per-bob" };
        var ann1 = await Connect("tk-ann1");
        var ann2 = await Connect("tk-ann2");
        var bob = await Connect("tk-bob");
        // the relay said open, then the switch went on there; the hub has heard nothing since
        await ann1.InvokeAsync<JsonElement>("Overview");
        factory.Relay.FrameHeld = true;
        var leak = Listen(bob, "message");
        var leakSettled = Listen(bob, "confirm");
        var settled = Listen(ann2, "confirm");

        await ann1.InvokeAsync<JsonElement>("Send", "per-bob", "held since", "client-000088");

        Assert.Equal("held since", (await settled.Task.WaitAsync(Wait)).GetProperty("body").GetString());
        await Task.Delay(Quiet);
        Assert.True(factory.Relay.GateChecks >= 1, "the gate door was asked");
        Assert.False(leak.Task.IsCompleted, "the recipient heard the words after the switch went on");
        Assert.False(leakSettled.Task.IsCompleted, "the recipient heard the ending while the gate held");
    }

    [Fact]
    public async Task OnlyTheTabsShownTheWordsHearTheirEndingOnceTheGateHasClosed()
    {
        factory.Relay.FrameHeld = false;
        var sheet = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        factory.Relay.BeforeExec = async (action, _) =>
        {
            if (action == "chatSend")
            {
                await sheet.Task;
            }
        };
        factory.Relay.Script("chatSend",
            () => FakeRelay.Ok("""{"id":"msg_90","created_at":"2026-01-01T10:00:00.000Z","thread_key":"per-ann|per-bob"}""", held: true),
            () => new RelayAnswer { Status = 404, Message = "Not found.", FrameHeld = true });
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob1", "ref-bob1", "acc-bob", "per-bob");
        factory.Person("tk-bob2", "ref-bob2", "acc-bob", "per-bob");
        factory.Relay.Rails["ref-ann"] = new[] { "per-bob" };
        var ann = await Connect("tk-ann");
        var bob1 = await Connect("tk-bob1");
        await ann.InvokeAsync<JsonElement>("Overview");
        var first = new ConcurrentQueue<string>();
        foreach (var kind in new[] { "message", "confirm", "retract" })
        {
            bob1.On<JsonElement>(kind, f => first.Enqueue(kind + ":" + f.GetProperty("client_id").GetString()));
        }
        var annSettled = Listen(ann, "confirm");
        var annFailed = Listen(ann, "send_failed");

        await ann.InvokeAsync<JsonElement>("Send", "per-bob", "landed", "client-000090");
        await ann.InvokeAsync<JsonElement>("Send", "per-bob", "refused", "client-000091");
        await Until(() => first.Count == 2);
        // a tab of the recipient that connects while both are on their way was shown neither
        var bob2 = await Connect("tk-bob2");
        var second = new ConcurrentQueue<string>();
        foreach (var kind in new[] { "message", "confirm", "retract" })
        {
            bob2.On<JsonElement>(kind, f => second.Enqueue(kind + ":" + f.GetProperty("client_id").GetString()));
        }
        await bob2.InvokeAsync("SetVisible", true);

        // both answers say the gate holds by now
        sheet.SetResult();
        Assert.Equal("msg_90", (await annSettled.Task.WaitAsync(Wait)).GetProperty("id").GetString());
        Assert.Equal("client-000091", (await annFailed.Task.WaitAsync(Wait)).GetProperty("client_id").GetString());
        await Until(() => first.Count == 4);
        await Task.Delay(Quiet);

        Assert.Equal(new[] { "message:client-000090", "message:client-000091", "confirm:client-000090", "retract:client-000091" },
            first.ToArray());
        Assert.Empty(second);
    }

    [Fact]
    public async Task WordsReachTheRecipientAtOnceOnlyWhenTheSendersRailNamesThem()
    {
        // somebody this person's rail does not name: away from home, perhaps nobody Apps Script lets them write to
        factory.Relay.FrameHeld = false;
        factory.Relay.Script("chatSend",
            () => new RelayAnswer { Status = 404, Message = "Not found.", FrameHeld = false },
            () => FakeRelay.Ok("""{"id":"msg_92","created_at":"2026-01-01T10:00:00.000Z","thread_key":"per-ann|per-bob"}"""));
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        var ann = await Connect("tk-ann");
        var bob = await Connect("tk-bob");
        await ann.InvokeAsync<JsonElement>("Overview");
        var heard = new ConcurrentQueue<string>();
        foreach (var kind in new[] { "message", "confirm", "retract" })
        {
            bob.On<JsonElement>(kind, f => heard.Enqueue(kind + ":" + f.GetProperty("client_id").GetString()));
        }
        var failed = Listen(ann, "send_failed");

        // refused by Apps Script: the recipient never heard a word of it
        await ann.InvokeAsync<JsonElement>("Send", "per-bob", "from elsewhere", "client-000092");
        await failed.Task.WaitAsync(Wait);
        // taken by Apps Script: the recipient hears the line with its confirm, and only then
        await ann.InvokeAsync<JsonElement>("Send", "per-bob", "taken", "client-000093");
        await Until(() => heard.Contains("confirm:client-000093"));
        await Task.Delay(Quiet);

        Assert.Equal(new[] { "confirm:client-000093" }, heard.ToArray());
    }

    [Fact]
    public async Task ANarrowedRecipientHearsAtOnceOnlyFromSomebodyItsRailNames()
    {
        factory.Relay.FrameHeld = false;
        factory.Narrowed("tk-cli", "ref-cli", "acc-cli", "per-cli");
        factory.Person("tk-ada", "ref-ada", "acc-ada", "per-ada");
        factory.Person("tk-new", "ref-new", "acc-new", "per-new");
        factory.Relay.Script("chatOverview", () => FakeRelay.Ok(
            """{"me":"per-cli","circle":{"why":""},"threads":[],"people":[{"user_id":"per-ada","name":"Ada"}],"unread":0}"""));
        // both senders' rails name the client: only the client's own rail tells them apart
        factory.Relay.Rails["ref-ada"] = new[] { "per-cli" };
        factory.Relay.Rails["ref-new"] = new[] { "per-cli" };
        var cli = await Connect("tk-cli");
        var ada = await Connect("tk-ada");
        var stranger = await Connect("tk-new");
        await cli.InvokeAsync<JsonElement>("Overview");
        await ada.InvokeAsync<JsonElement>("Overview");
        await stranger.InvokeAsync<JsonElement>("Overview");
        var heard = new ConcurrentQueue<string>();
        foreach (var kind in new[] { "message", "confirm" })
        {
            cli.On<JsonElement>(kind, f => heard.Enqueue(kind + ":" + f.GetProperty("body").GetString()));
        }

        await ada.InvokeAsync<JsonElement>("Send", "per-cli", "from the circle", "client-000085");
        await Until(() => heard.Contains("confirm:from the circle"));
        // somebody the rail does not name reaches a client only once Apps Script has taken the line
        await stranger.InvokeAsync<JsonElement>("Send", "per-cli", "first word", "client-000086");
        await Until(() => heard.Contains("confirm:first word"));

        await Task.Delay(Quiet);
        Assert.Contains("message:from the circle", heard);
        Assert.DoesNotContain("message:first word", heard);

        // and a client writes, at once or ever, only to whom its rail names
        var outsider = Listen(stranger, "message");
        await Assert.ThrowsAsync<HubException>(() => cli.InvokeAsync<JsonElement>("Send", "per-new", "hi", "client-000087"));
        await Task.Delay(Quiet);
        Assert.False(outsider.Task.IsCompleted);
    }

    [Fact]
    public async Task AnUnknownRefAsksForANewTicketAndKeepsTheSocket()
    {
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Relay.Script("chatOverview", () => FakeRelay.Refusal(401, "ref_unknown"));
        var ann = await Connect("tk-ann");
        var reauth = ListenBare(ann, "reauth");

        var asked = await Assert.ThrowsAsync<HubException>(() => ann.InvokeAsync<JsonElement>("Overview"));
        Assert.Contains("reauth", asked.Message);
        Assert.True(await reauth.Task.WaitAsync(Wait));
        Assert.Equal(HubConnectionState.Connected, ann.State);

        factory.Person("tk-ann-new", "ref-ann-new", "acc-ann", "per-ann");
        await ann.InvokeAsync<JsonElement>("Reauth", "tk-ann-new");
        await ann.InvokeAsync<JsonElement>("Overview");
        Assert.Equal("ref-ann-new", factory.Relay.CallsFor("chatOverview").Last().Ref);
    }

    [Fact]
    public async Task AReauthWithAnotherPersonsTicketIsRefused()
    {
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        var ann = await Connect("tk-ann");

        await Assert.ThrowsAsync<HubException>(() => ann.InvokeAsync<JsonElement>("Reauth", "tk-bob"));
        await ann.InvokeAsync<JsonElement>("Overview");
        Assert.Equal("ref-ann", factory.Relay.CallsFor("chatOverview").Last().Ref);
    }

    [Fact]
    public async Task ARevokedSessionIsToldAndClosed()
    {
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Relay.Script("chatOverview", () => FakeRelay.Refusal(401, "revoked"));
        var ann = await Connect("tk-ann");
        var revoked = ListenBare(ann, "revoked");
        var closed = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        ann.Closed += _ =>
        {
            closed.TrySetResult(true);
            return Task.CompletedTask;
        };

        try
        {
            await ann.InvokeAsync<JsonElement>("Overview");
        }
        catch (Exception)
        {
            // the connection is gone before the answer, or the answer is the refusal: both are the point
        }

        Assert.True(await revoked.Task.WaitAsync(Wait));
        Assert.True(await closed.Task.WaitAsync(Wait));
    }

    [Fact]
    public async Task TheRelaysRevokeClosesThatRefsConnectionsOnly()
    {
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        var ann = await Connect("tk-ann");
        var bob = await Connect("tk-bob");
        var annRevoked = ListenBare(ann, "revoked");
        var bobRevoked = ListenBare(bob, "revoked");
        var http = factory.CreateClient();

        var refused = await http.PostAsJsonAsync("/internal/event", new { kind = "revoke", refs = new[] { "ref-ann" } });
        Assert.Equal(HttpStatusCode.Unauthorized, refused.StatusCode);

        using var request = new HttpRequestMessage(HttpMethod.Post, "/internal/event")
        {
            Content = JsonContent.Create(new { kind = "revoke", refs = new[] { "ref-ann" } }),
        };
        request.Headers.Add("X-Hub-Chat-Key", HubFactory.Key);
        var accepted = await http.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);

        Assert.True(await annRevoked.Task.WaitAsync(Wait));
        await Task.Delay(Quiet);
        Assert.False(bobRevoked.Task.IsCompleted);
    }

    [Fact]
    public async Task ANudgeFromTheRelayReachesBothEndsOnlyWhenTheGateIsOpen()
    {
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        var ann = await Connect("tk-ann");
        var bob = await Connect("tk-bob");
        var annNudge = Listen(ann, "nudge");
        var bobNudge = Listen(bob, "nudge");
        var http = factory.CreateClient();

        async Task Post(object ev)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/internal/event") { Content = JsonContent.Create(ev) };
            request.Headers.Add("X-Hub-Chat-Key", HubFactory.Key);
            (await http.SendAsync(request)).EnsureSuccessStatusCode();
        }

        await Post(new { kind = "nudge", action = "chatSend", thread_key = "per-ann|per-bob", from = "acc-ann", to = new[] { "per-bob" }, held = true });
        Assert.Equal("per-ann|per-bob", (await annNudge.Task.WaitAsync(Wait)).GetProperty("thread_key").GetString());
        await Task.Delay(Quiet);
        Assert.False(bobNudge.Task.IsCompleted);

        await Post(new { kind = "nudge", action = "chatSend", thread_key = "per-ann|per-bob", from = "acc-ann", to = new[] { "per-bob" }, held = false });
        Assert.Equal("per-ann|per-bob", (await bobNudge.Task.WaitAsync(Wait)).GetProperty("thread_key").GetString());
    }

    private async Task PostEvent(object ev)
    {
        var http = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/internal/event") { Content = JsonContent.Create(ev) };
        request.Headers.Add("X-Hub-Chat-Key", HubFactory.Key);
        (await http.SendAsync(request)).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task ASendTheRelayKeptFromTodaysChatReachesBothEndsWithItsWords()
    {
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob2", "per-bob", "per-bob", "acc-bob2");
        var ann = await Connect("tk-ann");
        var bob = await Connect("tk-bob");
        var annConfirm = Listen(ann, "confirm");
        var bobConfirm = Listen(bob, "confirm");

        await PostEvent(new
        {
            kind = "sent", id = "msg_kept", created_at = "2026-09-30T13:00:00.000Z", thread_key = "per-ann|per-bob",
            from = "per-ann", from_name = "Ann", to = "per-bob", to_ids = new[] { "per-bob", "acc-bob2" },
            body = "from today's chat", client_id = "bLkept", held = true,
        });
        var own = await annConfirm.Task.WaitAsync(Wait);
        Assert.Equal("msg_kept", own.GetProperty("id").GetString());
        Assert.Equal("sent", own.GetProperty("state").GetString());
        await Task.Delay(Quiet);
        Assert.False(bobConfirm.Task.IsCompleted);

        await PostEvent(new
        {
            kind = "sent", id = "msg_kept2", created_at = "2026-09-30T13:00:01.000Z", thread_key = "per-ann|per-bob",
            from = "per-ann", from_name = "Ann", to = "per-bob", to_ids = new[] { "per-bob", "acc-bob2" },
            body = "the words", client_id = "bLkept2", held = false,
        });
        var got = await bobConfirm.Task.WaitAsync(Wait);
        Assert.Equal("msg_kept2", got.GetProperty("id").GetString());
        Assert.Equal("the words", got.GetProperty("body").GetString());
        Assert.Equal("per-ann", got.GetProperty("from").GetString());
        Assert.Equal("bLkept2", got.GetProperty("client_id").GetString());
        // the hub itself asked Apps Script nothing
        Assert.Empty(factory.Relay.CallsFor("chatSend"));
    }

    [Fact]
    public async Task AKeptSendRefusedLaterGoesAtBothEndsAndItsRetryIsANewTry()
    {
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        factory.Relay.Rails["ref-ann"] = new[] { "per-bob" };
        var ann = await Connect("tk-ann");
        var bob = await Connect("tk-bob");
        await ann.InvokeAsync<JsonElement>("Overview");
        var confirmed = Listen(ann, "confirm");
        var annGone = Listen(ann, "gone");
        var bobGone = Listen(bob, "gone");

        await ann.InvokeAsync<JsonElement>("Send", "per-bob", "kept, then refused", "client-000077");
        var receipt = await confirmed.Task.WaitAsync(Wait);
        Assert.Single(factory.Relay.CallsFor("chatSend"));

        await PostEvent(new
        {
            kind = "refused", id = receipt.GetProperty("id").GetString(), thread_key = "per-ann|per-bob", from = "per-ann",
            to = "per-bob", to_ids = new[] { "per-bob" }, client_id = "client-000077", why = "Not found.",
        });
        var mine = await annGone.Task.WaitAsync(Wait);
        var theirs = await bobGone.Task.WaitAsync(Wait);
        Assert.Equal("client-000077", mine.GetProperty("client_id").GetString());
        Assert.Equal("Not found.", mine.GetProperty("why").GetString());
        Assert.False(theirs.GetProperty("moved").GetBoolean());
        Assert.False(theirs.TryGetProperty("body", out _));

        // the same client id again goes to the relay, which answers the recorded verdict; never the old receipt
        await ann.InvokeAsync<JsonElement>("Send", "per-bob", "kept, then refused", "client-000077");
        await Until(() => factory.Relay.CallsFor("chatSend").Count == 2);
    }

    [Fact]
    public async Task AReadMarkNeverHoldsUpAReadOfThatPerson()
    {
        factory.Tune = o => o.ExecsPerPerson = 1;
        var marks = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        factory.Relay.BeforeExec = async (action, _) =>
        {
            if (action == "chatMarkRead")
            {
                await marks.Task;
            }
        };
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Relay.Rails["ref-ann"] = new[] { "per-bob" };
        var ann = await Connect("tk-ann");
        await ann.InvokeAsync<JsonElement>("Overview");

        var mark = ann.InvokeAsync<JsonElement>("MarkRead", "per-bob");
        await Until(() => factory.Relay.CallsFor("chatMarkRead").Count == 1);
        // a read waits for no mark: the mark holds a share of its own
        await ann.InvokeAsync<JsonElement>("Messages", "per-bob", (string?)null).WaitAsync(Wait);
        Assert.False(mark.IsCompleted);

        marks.SetResult();
        await mark.WaitAsync(Wait);
    }

    [Fact]
    public async Task NoTicketRefOrWordsReachTheLogs()
    {
        factory.Person("tk-secret-ticket-value-000", "ref-secret-value-000", "acc-secret", "per-secret");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        factory.Relay.Script("chatOverview", () => FakeRelay.Refusal(401, "ref_unknown"));
        var secret = await Connect("tk-secret-ticket-value-000");
        var bob = await Connect("tk-bob");
        var echo = Listen(secret, "confirm");

        await secret.InvokeAsync<JsonElement>("Send", "per-bob", "secret words 7Q", "client-000030");
        await echo.Task.WaitAsync(Wait);
        await Assert.ThrowsAsync<HubException>(() => secret.InvokeAsync<JsonElement>("Overview"));
        await Assert.ThrowsAnyAsync<Exception>(() => factory.Connect("tk-nobody-knows-this-000"));
        // a refusal's reason is the relay's word about a session: the ticket handler writes nothing of it
        factory.Relay.RefusedTickets["tk-acting-000"] = "acting";
        await Assert.ThrowsAnyAsync<Exception>(() => factory.Connect("tk-acting-000"));
        // nor does SignalR's dispatcher, which writes every exception a hub method throws, message included
        factory.Person("tk-actor-000", "ref-actor-000", "acc-actor", "per-actor");
        var actor = await Connect("tk-actor-000");
        factory.Relay.Script("chatOverview", () => FakeRelay.Refusal(409, "acting"));
        await Assert.ThrowsAnyAsync<Exception>(() => actor.InvokeAsync<JsonElement>("Overview"));
        // a fault is still said: by the method and the fault's type, never by its message
        factory.Relay.BeforeExec = (action, _) =>
            action == "chatMessages" ? throw new InvalidOperationException("secret words 8R") : Task.CompletedTask;
        await Assert.ThrowsAsync<HubException>(() => bob.InvokeAsync<JsonElement>("Messages", "per-secret", (string?)null));

        var all = string.Join("\n", factory.Logs.Lines);
        Assert.Contains(factory.Logs.Lines, line => line.Contains("Messages") && line.Contains("InvalidOperationException"));
        Assert.DoesNotContain("secret words 8R", all);
        Assert.DoesNotContain("acting", all);
        Assert.DoesNotContain(factory.Logs.Lines, line => line.Contains("AsaHubChat.Auth"));
        Assert.DoesNotContain("tk-secret-ticket-value-000", all);
        Assert.DoesNotContain("tk-nobody-knows-this-000", all);
        Assert.DoesNotContain("ref-secret-value-000", all);
        Assert.DoesNotContain("secret words 7Q", all);
        Assert.DoesNotContain("acc-secret", all);
        Assert.DoesNotContain("per-secret", all);
    }

    [Fact]
    public async Task ARenewalNotMadeInTimeClosesTheConnection()
    {
        factory.Tune = o =>
        {
            o.ReauthGrace = TimeSpan.FromMilliseconds(300);
            o.SweepTick = TimeSpan.FromMilliseconds(50);
        };
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Relay.Script("chatOverview", () => FakeRelay.Refusal(401, "ref_unknown"));
        var ann = await Connect("tk-ann");
        var reauth = ListenBare(ann, "reauth");
        var closed = Closed(ann);

        await Assert.ThrowsAsync<HubException>(() => ann.InvokeAsync<JsonElement>("Overview"));

        Assert.True(await reauth.Task.WaitAsync(Wait));
        Assert.True(await closed.Task.WaitAsync(Wait), "a connection that never renewed its ref stayed open");
    }

    [Fact]
    public async Task ARenewalMadeInTimeKeepsTheSocket()
    {
        factory.Tune = o =>
        {
            o.ReauthGrace = TimeSpan.FromMilliseconds(1500);
            o.SweepTick = TimeSpan.FromMilliseconds(50);
        };
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Relay.Script("chatOverview", () => FakeRelay.Refusal(401, "ref_unknown"));
        var ann = await Connect("tk-ann");
        var reauth = ListenBare(ann, "reauth");

        await Assert.ThrowsAsync<HubException>(() => ann.InvokeAsync<JsonElement>("Overview"));
        Assert.True(await reauth.Task.WaitAsync(Wait));
        factory.Person("tk-ann-new", "ref-ann-new", "acc-ann", "per-ann");
        await ann.InvokeAsync<JsonElement>("Reauth", "tk-ann-new");

        await Task.Delay(TimeSpan.FromMilliseconds(2500));
        Assert.Equal(HubConnectionState.Connected, ann.State);
    }

    [Fact]
    public async Task TheRelaysWordOnHeldRefsClosesEndedSessionsAndMakesForgottenOnesRenew()
    {
        factory.Tune = o =>
        {
            o.RefCheckEvery = TimeSpan.Zero;
            o.SweepTick = TimeSpan.FromMilliseconds(50);
            o.ReauthGrace = TimeSpan.FromMilliseconds(400);
        };
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        factory.Person("tk-cy", "ref-cy", "acc-cy", "per-cy");
        var ann = await Connect("tk-ann");
        var bob = await Connect("tk-bob");
        var cy = await Connect("tk-cy");
        // a tab that hid itself is still asked about: hiding is not a way out of the check
        await ann.InvokeAsync("SetVisible", false);
        var annRevoked = ListenBare(ann, "revoked");
        var annClosed = Closed(ann);
        var bobReauth = ListenBare(bob, "reauth");
        var bobClosed = Closed(bob);

        factory.Relay.Ended["ref-ann"] = true;
        factory.Relay.Forgotten["ref-bob"] = true;

        Assert.True(await annRevoked.Task.WaitAsync(Wait));
        Assert.True(await annClosed.Task.WaitAsync(Wait), "an ended session's hidden tab kept its connection");
        Assert.True(await bobReauth.Task.WaitAsync(Wait));
        Assert.True(await bobClosed.Task.WaitAsync(Wait), "a forgotten ref that never renewed kept its connection");
        await Task.Delay(Quiet);
        Assert.Equal(HubConnectionState.Connected, cy.State);
        Assert.True(factory.Relay.RefChecks > 0);
    }

    [Fact]
    public async Task NoConnectionOutlivesItsLife()
    {
        factory.Tune = o =>
        {
            o.MaxConnectionLife = TimeSpan.FromMilliseconds(400);
            o.SweepTick = TimeSpan.FromMilliseconds(50);
        };
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        var ann = await Connect("tk-ann");
        var closed = Closed(ann);

        Assert.True(await closed.Task.WaitAsync(Wait));
    }

    [Fact]
    public async Task AFullLaneRefusesASendInsteadOfHoldingIt()
    {
        factory.Tune = o => o.LaneCapacity = 2;
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        factory.Relay.BeforeExec = async (action, _) =>
        {
            if (action == "chatSend")
            {
                await gate.Task;
            }
        };
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        var ann = await Connect("tk-ann");
        var landed = 0;
        ann.On<JsonElement>("confirm", _ => Interlocked.Increment(ref landed));

        await ann.InvokeAsync<JsonElement>("Send", "per-bob", "one", "client-000050");
        await Until(() => factory.Relay.CallsFor("chatSend").Count == 1);
        await ann.InvokeAsync<JsonElement>("Send", "per-bob", "two", "client-000051");
        await ann.InvokeAsync<JsonElement>("Send", "per-bob", "three", "client-000052");
        var refused = await Assert.ThrowsAsync<HubException>(
            () => ann.InvokeAsync<JsonElement>("Send", "per-bob", "four", "client-000053"));
        Assert.Contains("refused", refused.Message);

        gate.SetResult();
        await Until(() => Volatile.Read(ref landed) == 3);
        Assert.Equal(new[] { "one", "two", "three" },
            factory.Relay.CallsFor("chatSend").Select(c => JsonDocument.Parse(c.Payload).RootElement.GetProperty("body").GetString()));
    }

    [Fact]
    public async Task CallsPastTheBucketAreRefused()
    {
        factory.Tune = o =>
        {
            o.CallBurst = 3;
            o.CallsPerSecond = 0;
        };
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        var ann = await Connect("tk-ann");
        var bob = await Connect("tk-bob");

        for (var i = 0; i < 3; i++)
        {
            await ann.InvokeAsync("SetVisible", true);
        }
        var refused = await Assert.ThrowsAsync<HubException>(() => ann.InvokeAsync("SetVisible", true));
        Assert.Contains("refused", refused.Message);
        // a bucket is the connection's own
        await bob.InvokeAsync("SetVisible", true);
    }

    [Fact]
    public async Task OnePersonHoldsNoMoreThanItsShareOfTheRelay()
    {
        factory.Tune = o => o.ExecsPerPerson = 2;
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        factory.Relay.BeforeExec = async (action, _) =>
        {
            if (action == "chatOverview")
            {
                await gate.Task;
            }
        };
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        var ann = await Connect("tk-ann");

        var calls = Enumerable.Range(0, 3).Select(_ => ann.InvokeAsync<JsonElement>("Overview")).ToList();
        await Until(() => factory.Relay.CallsFor("chatOverview").Count == 2);
        await Task.Delay(Quiet);
        Assert.Equal(2, factory.Relay.CallsFor("chatOverview").Count);

        gate.SetResult();
        await Task.WhenAll(calls).WaitAsync(Wait);
        Assert.Equal(3, factory.Relay.CallsFor("chatOverview").Count);
    }

    [Fact]
    public async Task ARoundOfPresencePingsGoesSeveralAtOnce()
    {
        factory.Tune = o => o.PingsAtOnce = 3;
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        factory.Relay.BeforeExec = async (action, _) =>
        {
            if (action == "chatPing")
            {
                await gate.Task;
            }
        };
        foreach (var who in new[] { "ann", "bob", "cy", "di" })
        {
            factory.Person($"tk-{who}", $"ref-{who}", $"acc-{who}", $"per-{who}");
            // a call answered proves its connect ran, so the round finds it visible
            await (await Connect($"tk-{who}")).InvokeAsync("SetVisible", true);
        }
        var pinger = factory.Services.GetServices<IHostedService>().OfType<AsaHubChat.Live.PresencePinger>().Single();

        var round = pinger.RoundAsync(CancellationToken.None);

        // one ping Apps Script holds does not hold the rest of the round
        await Until(() => factory.Relay.CallsFor("chatPing").Count == 3);
        await Task.Delay(Quiet);
        Assert.Equal(3, factory.Relay.CallsFor("chatPing").Count);
        gate.SetResult();
        await round.WaitAsync(Wait);
        Assert.Equal(4, factory.Relay.CallsFor("chatPing").Count);
    }

    [Fact]
    public async Task APingThatFindsUnreadMovingNudgesThatPersonsOwnTabsOnce()
    {
        factory.Tune = o => o.PresenceEvery = TimeSpan.Zero;
        factory.Person("tk-ann1", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-ann2", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        var ann1 = await Connect("tk-ann1");
        var ann2 = await Connect("tk-ann2");
        var bob = await Connect("tk-bob");
        // a call answered on each proves its connect ran; bob's tab is hidden, so ann alone is pinged
        await ann1.InvokeAsync("SetVisible", true);
        await ann2.InvokeAsync("SetVisible", true);
        await bob.InvokeAsync("SetVisible", false);
        var nudges = new ConcurrentQueue<string>();
        foreach (var (c, who) in new[] { (ann1, "ann1"), (ann2, "ann2"), (bob, "bob") })
        {
            c.On<JsonElement>("nudge", f => nudges.Enqueue(who + ":" + f.GetProperty("thread_key").GetString()));
        }
        const string one = """{"unread":1,"latest":{"id":"m1","at":"2026-01-01T10:00:00.000Z","from_user":"per-bob","from_name":"Bob","body":"words"}}""";
        factory.Relay.Script("chatPing",
            () => FakeRelay.Ok("""{"unread":0,"latest":null}"""),
            () => FakeRelay.Ok(one),
            () => FakeRelay.Ok(one));
        var pinger = factory.Services.GetServices<IHostedService>().OfType<AsaHubChat.Live.PresencePinger>().Single();

        // the first ping finds nothing unread: nothing is owed
        await pinger.RoundAsync(CancellationToken.None);
        await Task.Delay(Quiet);
        Assert.Empty(nudges);

        // a line nobody else told this person of (a sender still on today's chat): each of their tabs, once
        await pinger.RoundAsync(CancellationToken.None);
        await Until(() => nudges.Count >= 2);

        // the same count and the same line again: nothing new
        await pinger.RoundAsync(CancellationToken.None);
        await Task.Delay(Quiet);
        Assert.Equal(new[] { "ann1:", "ann2:" }, nudges.OrderBy(n => n, StringComparer.Ordinal).ToArray());
        Assert.Equal(3, factory.Relay.CallsFor("chatPing").Count);
    }

    [Fact]
    public async Task APushedMessageIsSignedWithTheSheetsIdForItsSender()
    {
        factory.Relay.FrameHeld = false;
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        var ann = await Connect("tk-ann");
        var bob = await Connect("tk-bob");
        factory.Relay.Script("chatSend",
            () => FakeRelay.Ok("""{"id":"msg_5","created_at":"2026-01-01T00:00:00.000Z","thread_key":"per-ann|per-bob-sheet"}"""));
        var got = Listen(ann, "confirm");

        await bob.InvokeAsync<JsonElement>("Send", "per-ann", "signed", "client-000060");

        var message = await got.Task.WaitAsync(Wait);
        Assert.Equal("per-bob-sheet", message.GetProperty("from").GetString());
    }

    [Fact]
    public async Task OverviewOverlaysLivePresenceAndLearnsTheSheetsNameForTheCaller()
    {
        factory.Person("tk-ann", "ref-ann", "acc-ann", "per-ann");
        factory.Person("tk-bob", "ref-bob", "acc-bob", "per-bob");
        factory.Relay.FrameHeld = false;
        factory.Relay.Script("chatOverview", () => FakeRelay.Ok(
            """{"me":"per-ann-sheet","threads":[{"thread_key":"per-ann|per-bob","with_user":"per-bob","online":false}],"people":[{"user_id":"per-bob","name":"Bob","online":false}],"unread":0}"""));
        var ann = await Connect("tk-ann");
        await Connect("tk-bob");

        var overview = await ann.InvokeAsync<JsonElement>("Overview");

        Assert.True(overview.GetProperty("people")[0].GetProperty("online").GetBoolean());
        Assert.True(overview.GetProperty("threads")[0].GetProperty("online").GetBoolean());

        // a frame addressed to the sheet's own id for the caller now reaches this connection
        var got = Listen(ann, "confirm");
        var bob = connections[1];
        await bob.InvokeAsync<JsonElement>("Send", "per-ann-sheet", "to the sheet id", "client-000040");
        Assert.Equal("to the sheet id", (await got.Task.WaitAsync(Wait)).GetProperty("body").GetString());
    }

    [Fact]
    public async Task ANarrowedCallerHearsPresenceOnlyOfThePeopleItsRailLists()
    {
        factory.Relay.FrameHeld = false;
        factory.Narrowed("tk-cli", "ref-cli", "acc-cli", "per-cli");
        factory.Person("tk-ada", "ref-ada", "acc-ada", "per-ada");
        factory.Person("tk-out", "ref-out", "acc-out", "per-out");
        factory.Relay.Script("chatOverview", () => FakeRelay.Ok(
            """{"me":"per-cli","circle":{"why":""},"threads":[{"thread_key":"per-cli|per-out","with_user":"per-out","online":false}],"people":[{"user_id":"per-ada","name":"Ada","online":false}],"unread":0}"""));
        var ada = await Connect("tk-ada");
        var outsider = await Connect("tk-out");
        var cli = await Connect("tk-cli");
        var heard = new ConcurrentQueue<string>();
        cli.On<JsonElement>("presence", p => heard.Enqueue(p.GetProperty("user_id").GetString() ?? ""));

        var overview = await cli.InvokeAsync<JsonElement>("Overview");

        Assert.True(overview.GetProperty("people")[0].GetProperty("online").GetBoolean());
        Assert.False(overview.GetProperty("threads")[0].GetProperty("online").GetBoolean(),
            "one who only wrote first is never shown online to a client");
        await outsider.InvokeAsync("SetVisible", false);
        await ada.InvokeAsync("SetVisible", false);
        await Until(() => heard.Contains("per-ada"));
        await Task.Delay(Quiet);
        Assert.DoesNotContain("per-out", heard);
    }

    [Fact]
    public async Task ANarrowedCallerReachesOnlyThePeopleItsRailNamed()
    {
        factory.Narrowed("tk-cli", "ref-cli", "acc-cli", "per-cli");
        factory.Relay.Script("chatOverview", () => FakeRelay.Ok(
            """{"me":"per-cli","circle":{"why":""},"threads":[{"thread_key":"per-cli|per-out","with_user":"per-out"}],"people":[{"user_id":"per-ada","name":"Ada"}],"unread":0}"""));
        var cli = await Connect("tk-cli");

        await Assert.ThrowsAsync<HubException>(() => cli.InvokeAsync("OpenThread", "per-ada"));
        await cli.InvokeAsync<JsonElement>("Overview");

        await cli.InvokeAsync("OpenThread", "per-ada");
        await cli.InvokeAsync("OpenThread", "per-out");
        var foreign = await Assert.ThrowsAsync<HubException>(() => cli.InvokeAsync("OpenThread", "per-oth"));
        Assert.Contains("refused", foreign.Message);
        await Assert.ThrowsAsync<HubException>(() => cli.InvokeAsync<JsonElement>("Messages", "per-oth", (string?)null));
        await Assert.ThrowsAsync<HubException>(() => cli.InvokeAsync<JsonElement>("Send", "per-oth", "hi", "client-000900"));
        await Assert.ThrowsAsync<HubException>(() => cli.InvokeAsync<JsonElement>("MarkRead", "per-oth"));
        Assert.Empty(factory.Relay.CallsFor("chatMessages"));
        Assert.Empty(factory.Relay.CallsFor("chatSend"));
        Assert.Empty(factory.Relay.CallsFor("chatMarkRead"));

        await cli.InvokeAsync<JsonElement>("Messages", "per-out", (string?)null);
        Assert.Single(factory.Relay.CallsFor("chatMessages"));
    }
}
