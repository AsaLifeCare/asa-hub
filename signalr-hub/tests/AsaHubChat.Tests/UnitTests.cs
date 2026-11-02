using System.Text.Json;
using AsaHubChat.Auth;
using AsaHubChat.Live;
using AsaHubChat.Relay;
using Microsoft.Extensions.Options;
using Xunit;

namespace AsaHubChat.Tests;

public sealed class UnitTests
{
    private sealed class OptionsOf(ChatOptions value) : IOptionsMonitor<ChatOptions>
    {
        public ChatOptions CurrentValue => value;
        public ChatOptions Get(string? name) => value;
        public IDisposable? OnChange(Action<ChatOptions, string?> listener) => null;
    }

    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    [Fact]
    public void AThreadKeyIsTheSortedPairAndNeedsTwoPeople()
    {
        Assert.Equal("a|b", ThreadKeys.For("b", "a"));
        Assert.Equal("A|a", ThreadKeys.For("a", "A"));
        Assert.Null(ThreadKeys.For("a", "a"));
        Assert.Null(ThreadKeys.For("a", "b|c"));
        Assert.Null(ThreadKeys.For("a", ""));
        Assert.True(ThreadKeys.Owns("a|b", new[] { "b" }));
        Assert.False(ThreadKeys.Owns("x|y", new[] { "a", "b" }));
        Assert.False(ThreadKeys.Owns("x", new[] { "x" }));
    }

    [Fact]
    public void ARelayAnswerKeepsTheGateHeldUnlessItSaysOtherwise()
    {
        var open = RelayAnswer.Parse(JsonDocument.Parse("""{"status":200,"data":{"id":"m1"},"frame_held":false}""").RootElement);
        var silent = RelayAnswer.Parse(JsonDocument.Parse("""{"status":200,"data":{}}""").RootElement);
        var unconfirmed = RelayAnswer.Parse(JsonDocument.Parse("""{"status":504,"reason":"unconfirmed","retry_after_s":150}""").RootElement);
        Assert.True(open.Ok);
        Assert.False(open.FrameHeld);
        Assert.Equal("m1", open.DataString("id"));
        Assert.True(silent.FrameHeld);
        Assert.True(unconfirmed.Unconfirmed && unconfirmed.Retriable && unconfirmed.RetryAfterS == 150);
        Assert.False(RelayAnswer.Parse(JsonDocument.Parse("""{"status":404,"message":"Not found."}""").RootElement).Retriable);
    }

    [Fact]
    public void ARedeemedIdentityAlwaysCarriesThePersonAndTheAccount()
    {
        var answer = RelayAnswer.Parse(JsonDocument.Parse(
            """{"status":200,"data":{"ref":"r1","account_id":"acc-2","person_id":"per-1","fold_ids":["per-1"],"name":"Ann","tenant":"akron","is_master":true}}""").RootElement);
        var who = RelayAnswer.IdentityFrom(answer)!;
        Assert.Equal(new[] { "per-1", "acc-2" }, who.FoldIds);
        Assert.Equal("akron", who.Tenant);
        Assert.True(who.IsMaster);
        Assert.False(who.Narrowed);
        Assert.Null(RelayAnswer.IdentityFrom(RelayAnswer.Parse(JsonDocument.Parse("""{"status":401,"reason":"ticket"}""").RootElement)));
    }

    [Fact]
    public void ARedeemedClientIsNarrowedAndReachesOnlyWhatItsRailNamed()
    {
        var answer = RelayAnswer.Parse(JsonDocument.Parse(
            """{"status":200,"data":{"ref":"r1","account_id":"acc-c","person_id":"per-c","fold_ids":[],"narrowed":true}}""").RootElement);
        var who = RelayAnswer.IdentityFrom(answer)!;
        Assert.True(who.Narrowed);
        var client = new LiveSession("c1", who, null, DateTimeOffset.UnixEpoch);
        Assert.False(client.MayReach("per-ada"), "nobody before a rail");
        client.SetListed(new[] { "per-ada" });
        Assert.True(client.MayReach("per-ada"));
        Assert.False(client.MayReach("per-oth"));
        var staff = new LiveSession("s1", who with { Narrowed = false }, null, DateTimeOffset.UnixEpoch);
        Assert.True(staff.MayReach("per-oth"));
        // what the rail named, narrowed or not: whom words go to before Apps Script has judged them
        Assert.False(staff.Lists("per-oth"));
        staff.SetListed(new[] { "per-oth" });
        Assert.True(staff.Lists("per-oth"));
        Assert.True(client.Lists("per-ada"));
        Assert.False(client.Lists("per-oth"));
    }

    [Fact]
    public void TheFrameGateIsOpenOnlyAsRecentlyAsTheRelaySaidSo()
    {
        var sessions = new SessionRegistry();
        var t0 = new DateTimeOffset(2026, 1, 1, 10, 0, 0, TimeSpan.Zero);
        Assert.True(sessions.LastFrameHeld, "nothing heard holds");
        Assert.False(sessions.FrameOpenSince(DateTimeOffset.MinValue));

        sessions.NoteFrameGate(false, t0);
        Assert.False(sessions.LastFrameHeld);
        Assert.True(sessions.FrameOpenSince(t0 - TimeSpan.FromSeconds(5)));
        Assert.False(sessions.FrameOpenSince(t0 + TimeSpan.FromSeconds(1)), "a word older than asked for is not the gate now");

        sessions.NoteFrameGate(true, t0 + TimeSpan.FromSeconds(2));
        Assert.False(sessions.FrameOpenSince(t0));
        // an answer heard before the one held does not overwrite it
        sessions.NoteFrameGate(false, t0 + TimeSpan.FromSeconds(1));
        Assert.True(sessions.LastFrameHeld);
        Assert.False(sessions.FrameOpenSince(t0));
    }

    [Fact]
    public async Task ReadMarksCoalesceAndTheLatestWins()
    {
        var reads = new ReadCoalescer();
        var gate = new TaskCompletionSource();
        var ran = new List<string>();
        Func<string, Func<Task<RelayAnswer>>> work = name => async () =>
        {
            lock (ran)
            {
                ran.Add(name);
            }
            if (name == "first")
            {
                await gate.Task;
            }
            return FakeRelay.Ok("{\"marked\":1}");
        };

        var first = reads.Run("k", work("first"));
        var second = reads.Run("k", work("second"));
        var third = reads.Run("k", work("third"));
        gate.SetResult();
        await Task.WhenAll(first, second, third);

        Assert.Equal(new[] { "first", "third" }, ran);
    }

    [Fact]
    public async Task ALaneRunsItsWorkInOrderOneAtATime()
    {
        var lanes = new SenderLanes(capacity: 32);
        var seen = new List<int>();
        var running = 0;
        var overlap = false;
        var tasks = Enumerable.Range(0, 20).Select(i => lanes.TryRun("p", async () =>
        {
            if (Interlocked.Increment(ref running) > 1)
            {
                overlap = true;
            }
            await Task.Delay(i % 3);
            lock (seen)
            {
                seen.Add(i);
            }
            Interlocked.Decrement(ref running);
            return i;
        })!).ToList();
        await Task.WhenAll(tasks);
        Assert.False(overlap);
        Assert.Equal(Enumerable.Range(0, 20), seen);
    }

    [Fact]
    public async Task AFullLaneRefusesAtOnceAndOnlyItsOwnPerson()
    {
        var lanes = new SenderLanes(capacity: 2);
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var first = lanes.TryRun("p", async () =>
        {
            started.TrySetResult();
            await gate.Task;
            return 1;
        });
        Assert.NotNull(first);
        await started.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.NotNull(lanes.TryRun("p", () => Task.FromResult(2)));
        Assert.NotNull(lanes.TryRun("p", () => Task.FromResult(3)));
        Assert.Null(lanes.TryRun("p", () => Task.FromResult(4)));
        Assert.NotNull(lanes.TryRun("q", () => Task.FromResult(5)));
        gate.SetResult();
        Assert.Equal(1, await first!.WaitAsync(TimeSpan.FromSeconds(10)));
        // room again once the lane moves
        var after = lanes.TryRun("p", () => Task.FromResult(6));
        Assert.NotNull(after);
        Assert.Equal(6, await after!.WaitAsync(TimeSpan.FromSeconds(10)));
    }

    [Fact]
    public void ABucketRefillsAtItsRateAndIsTheConnectionsOwn()
    {
        var clock = new Clock();
        var limiter = new AsaHubChat.Hubs.CallLimiter(new OptionsOf(new ChatOptions { CallBurst = 2, CallsPerSecond = 1 }), clock);
        Assert.True(limiter.TryTake("c1"));
        Assert.True(limiter.TryTake("c1"));
        Assert.False(limiter.TryTake("c1"));
        Assert.True(limiter.TryTake("c2"));
        clock.Now += TimeSpan.FromSeconds(1);
        Assert.True(limiter.TryTake("c1"));
        Assert.False(limiter.TryTake("c1"));
        clock.Now += TimeSpan.FromMinutes(5);
        Assert.True(limiter.TryTake("c1"));
        Assert.True(limiter.TryTake("c1"));
        Assert.False(limiter.TryTake("c1"));
    }

    [Fact]
    public async Task APersonsExecsWaitForTheirShare()
    {
        var gate = new PersonExecGate(2);
        var hold = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var mostLock = new object();
        var running = 0;
        var most = 0;
        async Task<int> Work()
        {
            var now = Interlocked.Increment(ref running);
            lock (mostLock)
            {
                most = Math.Max(most, now);
            }
            await hold.Task;
            Interlocked.Decrement(ref running);
            return now;
        }
        var all = Enumerable.Range(0, 5).Select(_ => gate.Run("p", () => Work())).ToList();
        var other = gate.Run("q", () => Task.FromResult(7));
        Assert.Equal(7, await other.WaitAsync(TimeSpan.FromSeconds(10)));
        await Task.Delay(100);
        Assert.Equal(2, Volatile.Read(ref running));
        hold.SetResult();
        await Task.WhenAll(all).WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(2, most);
    }

    [Fact]
    public void AMessageIsSignedWithTheSheetsIdForItsSender()
    {
        var who = new Identity("r1", "acc-1", "per-1", new[] { "per-1", "acc-1" }, "Ann", "", false);
        var session = new LiveSession("c1", who, null, DateTimeOffset.UnixEpoch);
        Assert.Equal("per-1-sheet", AsaHubChat.Hubs.ChatHub.SenderId(session, "per-1-sheet|per-2", "per-2"));
        Assert.Equal("per-1-sheet", AsaHubChat.Hubs.ChatHub.SenderId(session, "per-0|per-1-sheet", "per-0"));
        Assert.Equal("per-1", AsaHubChat.Hubs.ChatHub.SenderId(session, "", "per-2"));
        Assert.Equal("per-1", AsaHubChat.Hubs.ChatHub.SenderId(session, "per-8|per-9", "per-2"));
        session.SetSheetId("not-mine");
        Assert.Equal("per-1", session.SelfId);
        session.AddFold("per-1-sheet");
        session.SetSheetId("per-1-sheet");
        Assert.Equal("per-1-sheet", session.SelfId);
        Assert.Equal("per-1-sheet", AsaHubChat.Hubs.ChatHub.SenderId(session, "", "per-2"));
    }

    [Fact]
    public void AClientIdIsOneMessageUntilItIsForgotten()
    {
        var clock = new Clock();
        var book = new SendBook(TimeSpan.FromHours(1), clock);
        Assert.Equal(SendBook.Kind.Start, book.Begin("per-1", "client-1", "per-2", "hello").Kind);
        Assert.Equal(SendBook.Kind.OnItsWay, book.Begin("per-1", "client-1", "per-2", "hello").Kind);
        Assert.Equal(SendBook.Kind.Mismatch, book.Begin("per-1", "client-1", "per-2", "hellO").Kind);
        Assert.Equal(SendBook.Kind.Mismatch, book.Begin("per-1", "client-1", "per-3", "hello").Kind);
        // another sender's client id is theirs
        Assert.Equal(SendBook.Kind.Start, book.Begin("per-9", "client-1", "per-2", "hello").Kind);

        var receipt = new SendBook.Receipt("m1", "2026-01-01T00:00:00.000Z", "per-1|per-2", "per-1");
        book.Sent("per-1", "client-1", receipt);
        var again = book.Begin("per-1", "client-1", "per-2", "hello");
        Assert.Equal(SendBook.Kind.Sent, again.Kind);
        Assert.Same(receipt, again.Receipt);

        // a failed one is its Retry: it goes again, and is on its way again
        Assert.Equal(SendBook.Kind.Start, book.Begin("per-1", "client-2", "per-2", "x").Kind);
        book.Failed("per-1", "client-2");
        Assert.Equal(SendBook.Kind.Start, book.Begin("per-1", "client-2", "per-2", "x").Kind);
        Assert.Equal(SendBook.Kind.OnItsWay, book.Begin("per-1", "client-2", "per-2", "x").Kind);

        // one refused before it started starts afresh
        Assert.Equal(SendBook.Kind.Start, book.Begin("per-1", "client-3", "per-2", "y").Kind);
        book.Forget("per-1", "client-3");
        Assert.Equal(SendBook.Kind.Start, book.Begin("per-1", "client-3", "per-2", "other words").Kind);

        // settled ones are forgotten after a while; one still on its way never is
        clock.Now += TimeSpan.FromHours(2);
        Assert.Equal(SendBook.Kind.Start, book.Begin("per-1", "client-1", "per-2", "hello").Kind);
        Assert.Equal(SendBook.Kind.OnItsWay, book.Begin("per-1", "client-2", "per-2", "x").Kind);
    }

    [Fact]
    public void APushedTimeIsWrittenAsTheSheetWritesIts()
    {
        var at = new DateTimeOffset(2026, 1, 2, 3, 4, 5, 678, TimeSpan.FromHours(2));
        Assert.Equal("2026-01-02T01:04:05.678Z", AsaHubChat.Hubs.ChatHub.Iso(at));
    }

    [Fact]
    public void ARenewalIsDueOnceAndClearedByTheRenewal()
    {
        var who = new Identity("r1", "acc-1", "per-1", new[] { "per-1", "acc-1" }, "Ann", "", false);
        var t0 = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var session = new LiveSession("c1", who, null, t0);
        Assert.False(session.ReauthOverdue(t0.AddHours(1)));
        session.AskReauth(t0.AddSeconds(90));
        session.AskReauth(t0.AddSeconds(900));
        Assert.False(session.ReauthOverdue(t0.AddSeconds(60)));
        Assert.True(session.ReauthOverdue(t0.AddSeconds(91)), "a second ask moved the first one's time");
        session.Reauthed();
        Assert.False(session.ReauthOverdue(t0.AddHours(1)));
    }

    [Fact]
    public void TheRelaysWordOnRefsIsReadAsItIsWritten()
    {
        var verdict = RefVerdict.From(RelayAnswer.Parse(JsonDocument.Parse(
            """{"status":200,"data":{"unknown":["r1",""],"revoked":["r2",3]}}""").RootElement))!;
        Assert.Equal(new[] { "r1" }, verdict.Unknown);
        Assert.Equal(new[] { "r2" }, verdict.Revoked);
        Assert.Null(RefVerdict.From(RelayAnswer.Parse(JsonDocument.Parse("""{"status":401,"reason":"key"}""").RootElement)));
        Assert.Null(RefVerdict.From(RelayAnswer.Transport("HttpRequestException")));
    }

    [Fact]
    public void ATicketBindsToTheFirstConnectionThatUsesIt()
    {
        var clock = new Clock();
        var cache = new TicketCache(new OptionsOf(new ChatOptions()), clock);
        var who = new Identity("r1", "acc", "per", new[] { "per", "acc" }, "", "", false);
        var key = TicketCache.Hash("ticket-value");
        cache.Put(key, "", who);

        Assert.False(cache.TryGet(key, "", out _));          // a second negotiate goes to the relay
        Assert.True(cache.TryGet(key, "conn-1", out var bound));
        Assert.Same(who, bound);
        Assert.True(cache.TryGet(key, "conn-1", out _));
        Assert.False(cache.TryGet(key, "conn-2", out _));    // another connection goes to the relay

        cache.Put(TicketCache.Hash("late"), "", who);
        clock.Now += TimeSpan.FromSeconds(61);
        Assert.False(cache.TryGet(TicketCache.Hash("late"), "conn-3", out _));

        cache.DropRef("r1");
        Assert.False(cache.TryGet(key, "conn-1", out _));
    }

    [Fact]
    public void PresenceChangesOnTheFirstAndLastVisibleConnectionAndPingsOnItsClock()
    {
        var clock = new Clock();
        var presence = new PresenceRegistry(clock);
        Assert.True(presence.SetVisible("per", "c1", true, "r1"));
        Assert.False(presence.SetVisible("per", "c2", true, "r2"));
        Assert.False(presence.SetVisible("per", "c1", false, "r1"));
        Assert.True(presence.IsOnline("per"));

        var due = presence.DuePings(TimeSpan.FromMinutes(4));
        Assert.Single(due);
        Assert.Equal("r2", due[0].Ref);
        Assert.Empty(presence.DuePings(TimeSpan.FromMinutes(4)));
        clock.Now += TimeSpan.FromMinutes(4);
        Assert.Single(presence.DuePings(TimeSpan.FromMinutes(4)));

        Assert.True(presence.Remove("per", "c2"));
        Assert.False(presence.IsOnline("per"));
        Assert.Empty(presence.DuePings(TimeSpan.FromMinutes(4)));
    }

    [Fact]
    public void APingsUnreadMarkIsTheCountAndTheNewestLinesIdAndTimeNeverItsWords()
    {
        var mark = PresencePinger.UnreadMark(FakeRelay.Ok(
            """{"unread":2,"latest":{"id":"m9","at":"2026-01-01T10:00:00.000Z","from_user":"per-bob","body":"secret words"}}"""))
            .GetValueOrDefault();
        Assert.Equal(2L, mark.Unread);
        Assert.Equal("2\nm9\n2026-01-01T10:00:00.000Z", mark.Mark);
        Assert.Equal("0\n\n", PresencePinger.UnreadMark(FakeRelay.Ok("""{"unread":0,"latest":null}"""))?.Mark);
        Assert.Null(PresencePinger.UnreadMark(FakeRelay.Ok("""{"latest":null}""")));
        Assert.Null(PresencePinger.UnreadMark(FakeRelay.Refusal(401, "ref_unknown")));
    }
}
