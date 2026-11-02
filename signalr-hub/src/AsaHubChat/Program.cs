// asa-hub-chat: the My Inbox chat's transport. The messages stay in Apps Script (chat_messages, chat_presence,
// chat_notice); this process only carries them, and knows who is asking only through the relay's tickets.
using AsaHubChat;
using AsaHubChat.Auth;
using AsaHubChat.Hubs;
using AsaHubChat.Internal;
using AsaHubChat.Live;
using AsaHubChat.Relay;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

// Warning and above, and this service's own counts. No request logging: a ticket rides the query string.
builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(o =>
{
    o.SingleLine = true;
    o.IncludeScopes = false;
    o.UseUtcTimestamp = true;
    o.TimestampFormat = "yyyy-MM-ddTHH:mm:ssZ ";
});
builder.Logging.SetMinimumLevel(LogLevel.Warning);
builder.Logging.AddFilter("AsaHubChat", LogLevel.Information);
// the ticket handler's base class writes every refusal and challenge at Information: none of it is a count
builder.Logging.AddFilter("AsaHubChat.Auth", LogLevel.Warning);
builder.Logging.AddFilter("Microsoft.AspNetCore.Hosting.Diagnostics", LogLevel.None);
builder.Logging.AddFilter("Microsoft.AspNetCore.Http.Connections", LogLevel.Error);
// every hub method's exception, message included, at Error: a refusal's words stay out; FailureLog names faults
builder.Logging.AddFilter("Microsoft.AspNetCore.SignalR.Internal.DefaultHubDispatcher", LogLevel.None);

builder.Services.AddOptions<ChatOptions>().Configure<IConfiguration>((o, config) =>
{
    if (config["HUB_RELAY_URL"] is { Length: > 0 } url)
    {
        o.RelayUrl = url;
    }
    o.ChatKey = config["HUB_CHAT_KEY"] ?? "";
});

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpClient(RelayClient.HttpClientName, (sp, http) =>
{
    var o = sp.GetRequiredService<IOptions<ChatOptions>>().Value;
    http.BaseAddress = new Uri(o.RelayUrl.TrimEnd('/') + "/");
    // the relay's exec budget is 45 s; the rest is the way there and back
    http.Timeout = TimeSpan.FromSeconds(55);
});
builder.Services.AddSingleton<IRelayClient, RelayClient>();
builder.Services.AddSingleton<SessionRegistry>();
builder.Services.AddSingleton<PresenceRegistry>();
// bounded: a full lane refuses a send rather than hold it (ChatOptions.LaneCapacity)
builder.Services.AddSingleton(sp => new SenderLanes(sp.GetRequiredService<IOptionsMonitor<ChatOptions>>().CurrentValue.LaneCapacity));
builder.Services.AddSingleton(sp => new SendBook(sp.GetRequiredService<IOptionsMonitor<ChatOptions>>().CurrentValue.SendMemory,
    sp.GetRequiredService<TimeProvider>()));
builder.Services.AddSingleton(sp => new PersonExecGate(sp.GetRequiredService<IOptionsMonitor<ChatOptions>>().CurrentValue.ExecsPerPerson));
builder.Services.AddSingleton<ReadCoalescer>();
builder.Services.AddSingleton<TicketCache>();
builder.Services.AddSingleton<Pusher>();
builder.Services.AddSingleton<RelayEvents>();
builder.Services.AddSingleton<CallLimiter>();
builder.Services.AddSingleton<FailureLog>();
builder.Services.AddHostedService<StartupCheck>();
builder.Services.AddHostedService<PresencePinger>();
builder.Services.AddHostedService<ConnectionSweeper>();

builder.Services.AddAuthentication(TicketAuthHandler.Scheme)
    .AddScheme<AuthenticationSchemeOptions, TicketAuthHandler>(TicketAuthHandler.Scheme, _ => { });
builder.Services.AddAuthorization();

builder.Services.AddSignalR(o =>
{
    o.MaximumReceiveMessageSize = 32 * 1024;
    o.KeepAliveInterval = TimeSpan.FromSeconds(15);
    // a hidden tab's timers wake once a minute: its pings can be a minute and more apart
    o.ClientTimeoutInterval = TimeSpan.FromSeconds(150);
    // every read waits on Apps Script (seconds, a minute in its tail); a send answers at once (ChatHub.Send)
    o.MaximumParallelInvocationsPerClient = 8;
    o.EnableDetailedErrors = false;
    // every call through one token bucket per connection (the singleton registered above)
    o.AddFilter<CallLimiter>();
    o.AddFilter<FailureLog>();
}).AddJsonProtocol(o => o.PayloadSerializerOptions.PropertyNamingPolicy = null);

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();

app.MapHub<ChatHub>("/chat-hub/live", o =>
{
    o.Transports = HttpTransportType.WebSockets | HttpTransportType.ServerSentEvents | HttpTransportType.LongPolling;
    o.AllowStatefulReconnects = true;
}).RequireAuthorization();

// counts only, for the container's healthcheck; nginx routes /chat-hub/ alone
app.MapGet("/health", (SessionRegistry sessions, TicketCache tickets) =>
    Results.Ok(new { ok = true, connections = sessions.Count, tickets = tickets.Count }));

InternalEndpoints.Map(app);

app.Run();

/// <summary>A hub with no key could only refuse every internal door and every redeem: it does not start.</summary>
internal sealed class StartupCheck : IHostedService
{
    private readonly IOptionsMonitor<ChatOptions> options;

    public StartupCheck(IOptionsMonitor<ChatOptions> options) => this.options = options;

    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(options.CurrentValue.ChatKey))
        {
            throw new InvalidOperationException("HUB_CHAT_KEY is not set; the hub cannot reach the relay's doors.");
        }
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}

public partial class Program
{
}
