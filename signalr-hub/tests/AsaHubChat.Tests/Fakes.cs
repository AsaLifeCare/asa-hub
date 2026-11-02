using System.Collections.Concurrent;
using System.Text.Json;
using AsaHubChat.Relay;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;

namespace AsaHubChat.Tests;

/// <summary>The relay's internal doors, answered in memory: tickets by name, execs by script, rails by ref.</summary>
public sealed class FakeRelay : IRelayClient
{
    public sealed record Call(string Ref, string Action, string Payload, string ClientId);

    public readonly ConcurrentDictionary<string, Identity> Tickets = new(StringComparer.Ordinal);
    public readonly ConcurrentQueue<Call> Calls = new();
    private readonly ConcurrentDictionary<string, ConcurrentQueue<Func<RelayAnswer>>> scripts = new(StringComparer.Ordinal);
    private int ids;

    public volatile bool FrameHeld;

    /// <summary>Runs before an exec answers: (action, payload json).</summary>
    public Func<string, string, Task>? BeforeExec { get; set; }

    public void Script(string action, params Func<RelayAnswer>[] answers)
    {
        var queue = scripts.GetOrAdd(action, _ => new ConcurrentQueue<Func<RelayAnswer>>());
        foreach (var a in answers)
        {
            queue.Enqueue(a);
        }
    }

    public IReadOnlyList<Call> CallsFor(string action) => Calls.Where(c => c.Action == action).ToList();

    /// <summary>Refs the relay no longer knows (it restarted, or they idled out), and refs whose session ended.</summary>
    public readonly ConcurrentDictionary<string, bool> Forgotten = new(StringComparer.Ordinal);
    public readonly ConcurrentDictionary<string, bool> Ended = new(StringComparer.Ordinal);
    private int refChecks;

    public int RefChecks => Volatile.Read(ref refChecks);

    public Task<RefVerdict?> CheckRefsAsync(IReadOnlyList<string> refs, CancellationToken ct)
    {
        Interlocked.Increment(ref refChecks);
        var unknown = refs.Where(r => Forgotten.ContainsKey(r)).ToList();
        var revoked = refs.Where(r => Ended.ContainsKey(r)).ToList();
        return Task.FromResult<RefVerdict?>(new RefVerdict(unknown, revoked));
    }

    private int gateChecks;

    public int GateChecks => Volatile.Read(ref gateChecks);

    /// <summary>The gate door's answer; unset, it says FrameHeld as it stands.</summary>
    public Func<RelayAnswer>? GateAnswer { get; set; }

    public Task<RelayAnswer> FrameGateAsync(CancellationToken ct)
    {
        Interlocked.Increment(ref gateChecks);
        return Task.FromResult(GateAnswer is { } answer ? answer() : new RelayAnswer { Status = 200, FrameHeld = FrameHeld });
    }

    /// <summary>Whom a ref's rail names (its people), for a chatOverview no script answers.</summary>
    public readonly ConcurrentDictionary<string, string[]> Rails = new(StringComparer.Ordinal);

    private string RailOf(string reference) => JsonSerializer.Serialize(new
    {
        me = "",
        threads = Array.Empty<object>(),
        people = (Rails.TryGetValue(reference, out var named) ? named : Array.Empty<string>())
            .Select(id => new { user_id = id, name = id, online = false })
            .ToArray(),
        unread = 0,
    });

    /// <summary>Tickets the relay refuses with a reason of its own (acting, revoked, ...), not as unknown.</summary>
    public readonly ConcurrentDictionary<string, string> RefusedTickets = new(StringComparer.Ordinal);

    public Task<(Identity? Who, RelayAnswer Answer)> RedeemAsync(string ticket, CancellationToken ct)
    {
        if (RefusedTickets.TryGetValue(ticket, out var why))
        {
            return Task.FromResult<(Identity?, RelayAnswer)>((null, Refusal(409, why)));
        }
        if (Tickets.TryGetValue(ticket, out var who))
        {
            var data = JsonSerializer.Serialize(new
            {
                @ref = who.Ref,
                account_id = who.AccountId,
                person_id = who.PersonId,
                fold_ids = who.FoldIds,
                name = who.Name,
                tenant = who.Tenant,
                is_master = who.IsMaster,
                narrowed = who.Narrowed,
            });
            var answer = Ok(data, FrameHeld);
            return Task.FromResult<(Identity?, RelayAnswer)>((RelayAnswer.IdentityFrom(answer), answer));
        }
        return Task.FromResult<(Identity?, RelayAnswer)>((null, Refusal(401, "ticket")));
    }

    public async Task<RelayAnswer> ExecAsync(string reference, string action, object payload, string clientId, CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(payload);
        Calls.Enqueue(new Call(reference, action, json, clientId));
        if (BeforeExec is { } before)
        {
            await before(action, json);
        }
        if (scripts.TryGetValue(action, out var queue) && queue.TryDequeue(out var next))
        {
            return next();
        }
        return action switch
        {
            "chatOverview" => Ok(RailOf(reference), FrameHeld),
            "chatSend" => Ok($$"""{"id":"msg_{{Interlocked.Increment(ref ids)}}","created_at":"2026-01-01T00:00:00.000Z","thread_key":""}""", FrameHeld),
            "chatMessages" => Ok("""{"messages":[],"reset":false,"reactions":{}}""", FrameHeld),
            "chatMarkRead" => Ok("""{"marked":1}""", FrameHeld),
            "chatReact" => Ok("""{"message_id":"m1","reactions":{},"on":true,"to_user":""}""", FrameHeld),
            _ => Ok("""{"unread":0}""", FrameHeld),
        };
    }

    public static RelayAnswer Ok(string dataJson, bool held = false)
    {
        using var doc = JsonDocument.Parse(dataJson);
        return new RelayAnswer { Status = 200, Data = doc.RootElement.Clone(), FrameHeld = held };
    }

    public static RelayAnswer Refusal(int status, string reason, int retryAfterS = 0) =>
        new() { Status = status, Reason = reason, Message = reason, RetryAfterS = retryAfterS, FrameHeld = true };
}

/// <summary>Every line the app would write, at the levels it is configured to write them.</summary>
public sealed class CaptureLogs : ILoggerProvider
{
    public readonly ConcurrentQueue<string> Lines = new();

    public ILogger CreateLogger(string categoryName) => new Logger(categoryName, Lines);

    public void Dispose()
    {
    }

    private sealed class Logger(string category, ConcurrentQueue<string> lines) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            lines.Enqueue($"{logLevel} {category}: {formatter(state, exception)} {exception}");
        }
    }
}

public sealed class HubFactory : WebApplicationFactory<Program>
{
    public const string Key = "test-key-0123456789abcdef";

    public FakeRelay Relay { get; } = new();
    public CaptureLogs Logs { get; } = new();

    /// <summary>A test's own numbers, set before its first connection (the server starts on first use).</summary>
    public Action<ChatOptions>? Tune { get; set; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("HUB_CHAT_KEY", Key);
        builder.ConfigureLogging(logging => logging.AddProvider(Logs));
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IRelayClient>();
            services.AddSingleton<IRelayClient>(Relay);
            services.PostConfigure<ChatOptions>(o =>
            {
                o.ChatKey = Key;
                o.SendRetryWaitFloor = TimeSpan.FromMilliseconds(10);
                o.SendRetryWaitCap = TimeSpan.FromMilliseconds(50);
                o.PresenceTick = TimeSpan.FromHours(1);
                // the sweeper stays out of the way unless a test asks for it
                o.SweepTick = TimeSpan.FromHours(1);
                Tune?.Invoke(o);
            });
        });
    }

    public Identity Person(string ticket, string reference, string account, string person, params string[] folds)
    {
        var who = new Identity(reference, account, person, folds.Length > 0 ? folds : new[] { person, account }.Distinct().ToArray(),
            "Name of " + account, "", false);
        Relay.Tickets[ticket] = who;
        return who;
    }

    /// <summary>A client or a guardian: the relay redeems its ticket as narrowed.</summary>
    public Identity Narrowed(string ticket, string reference, string account, string person)
    {
        var who = Person(ticket, reference, account, person) with { Narrowed = true };
        Relay.Tickets[ticket] = who;
        return who;
    }

    public async Task<HubConnection> Connect(string ticket)
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(Server.BaseAddress, "chat-hub/live"), o =>
            {
                o.HttpMessageHandlerFactory = _ => Server.CreateHandler();
                o.AccessTokenProvider = () => Task.FromResult<string?>(ticket);
                o.Transports = HttpTransportType.LongPolling;
            })
            .AddJsonProtocol(o => o.PayloadSerializerOptions.PropertyNamingPolicy = null)
            .Build();
        await connection.StartAsync();
        return connection;
    }
}
