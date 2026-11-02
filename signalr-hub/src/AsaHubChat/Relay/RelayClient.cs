using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace AsaHubChat.Relay;

/// <summary>The relay's internal doors. Every Apps Script call the hub makes goes through ExecAsync with the caller's ref.</summary>
public interface IRelayClient
{
    Task<(Identity? Who, RelayAnswer Answer)> RedeemAsync(string ticket, CancellationToken ct);

    Task<RelayAnswer> ExecAsync(string reference, string action, object payload, string clientId, CancellationToken ct);

    /// <summary>Which of these refs are no longer sessions at the relay; null when it could not say.</summary>
    Task<RefVerdict?> CheckRefsAsync(IReadOnlyList<string> refs, CancellationToken ct);

    /// <summary>The frame gate as the relay holds it now (`frame_held`); runs nothing in Apps Script. Held when it cannot say.</summary>
    Task<RelayAnswer> FrameGateAsync(CancellationToken ct);
}

public sealed class RelayClient : IRelayClient
{
    public const string HttpClientName = "relay";

    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = null };

    private readonly IHttpClientFactory factory;
    private readonly IOptionsMonitor<ChatOptions> options;
    private readonly ILogger<RelayClient> log;
    private long failures;

    public RelayClient(IHttpClientFactory factory, IOptionsMonitor<ChatOptions> options, ILogger<RelayClient> log)
    {
        this.factory = factory;
        this.options = options;
        this.log = log;
    }

    public long Failures => Interlocked.Read(ref failures);

    public async Task<(Identity? Who, RelayAnswer Answer)> RedeemAsync(string ticket, CancellationToken ct)
    {
        var answer = await PostAsync("chat/ticket/redeem", new Dictionary<string, object?> { ["ticket"] = ticket }, retries: 2, ct);
        return (RelayAnswer.IdentityFrom(answer), answer);
    }

    public Task<RelayAnswer> ExecAsync(string reference, string action, object payload, string clientId, CancellationToken ct)
    {
        var body = new Dictionary<string, object?>
        {
            ["ref"] = reference,
            ["action"] = action,
            ["payload"] = payload,
            ["client_id"] = clientId,
        };
        // A relay that refuses the connection never saw the call, so trying again cannot run anything twice; a
        // call the relay did see is guarded there (an append-class write in flight or unsettled is never re-sent).
        return PostAsync("chat/exec", body, retries: 2, ct);
    }

    public async Task<RefVerdict?> CheckRefsAsync(IReadOnlyList<string> refs, CancellationToken ct)
    {
        var answer = await PostAsync("chat/refs", new Dictionary<string, object?> { ["refs"] = refs }, retries: 1, ct);
        return RefVerdict.From(answer);
    }

    /// <summary>Not tried again: a gate that does not answer at once holds, and the words wait for the sheet.</summary>
    public Task<RelayAnswer> FrameGateAsync(CancellationToken ct) =>
        PostAsync("chat/gate", new Dictionary<string, object?>(), retries: 0, ct);

    private async Task<RelayAnswer> PostAsync(string path, Dictionary<string, object?> body, int retries, CancellationToken ct)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(body, Json);
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                var http = factory.CreateClient(HttpClientName);
                using var request = new HttpRequestMessage(HttpMethod.Post, path);
                request.Headers.TryAddWithoutValidation("X-Hub-Chat-Key", options.CurrentValue.ChatKey);
                request.Content = new ByteArrayContent(bytes);
                request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
                using var response = await http.SendAsync(request, ct);
                await using var stream = await response.Content.ReadAsStreamAsync(ct);
                using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
                return RelayAnswer.Parse(doc.RootElement);
            }
            catch (HttpRequestException exc) when (attempt < retries && IsRefused(exc))
            {
                await Task.Delay(TimeSpan.FromSeconds(attempt == 0 ? 1 : 3), ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exc)
            {
                if (Interlocked.Increment(ref failures) % 50 == 1)
                {
                    log.LogWarning("relay door {Door} did not answer ({Error})", path, exc.GetType().Name);
                }
                return RelayAnswer.Transport(exc.GetType().Name);
            }
        }
    }

    private static bool IsRefused(HttpRequestException exc) =>
        exc.HttpRequestError is HttpRequestError.ConnectionError or HttpRequestError.NameResolutionError;
}
