using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AsaHubChat.Live;
using Microsoft.Extensions.Options;

namespace AsaHubChat.Internal;

/// <summary>
/// The relay's doors into the hub, keyed with X-Hub-Chat-Key; nginx never routes them.
///   POST /internal/event   {kind: nudge | read | revoke | hello | sent | refused, ...}
///   POST /internal/revoke  {refs: [...]}
/// </summary>
public static class InternalEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapPost("/internal/event", async (HttpContext http, RelayEvents events, IOptionsMonitor<ChatOptions> options) =>
        {
            if (!KeyOk(http, options.CurrentValue.ChatKey))
            {
                return Results.Unauthorized();
            }
            JsonDocument doc;
            try
            {
                doc = await JsonDocument.ParseAsync(http.Request.Body, cancellationToken: http.RequestAborted);
            }
            catch (JsonException)
            {
                return Results.BadRequest();
            }
            using (doc)
            {
                await events.HandleAsync(doc.RootElement);
            }
            return Results.Ok(new { ok = true });
        });

        app.MapPost("/internal/revoke", async (HttpContext http, RelayEvents events, IOptionsMonitor<ChatOptions> options) =>
        {
            if (!KeyOk(http, options.CurrentValue.ChatKey))
            {
                return Results.Unauthorized();
            }
            JsonDocument doc;
            try
            {
                doc = await JsonDocument.ParseAsync(http.Request.Body, cancellationToken: http.RequestAborted);
            }
            catch (JsonException)
            {
                return Results.BadRequest();
            }
            using (doc)
            {
                await events.RevokeAsync(doc.RootElement);
            }
            return Results.Ok(new { ok = true });
        });
    }

    public static bool KeyOk(HttpContext http, string expected)
    {
        var given = http.Request.Headers["X-Hub-Chat-Key"].ToString();
        if (expected.Length == 0 || given.Length == 0)
        {
            return false;
        }
        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(given), Encoding.UTF8.GetBytes(expected));
    }
}

/// <summary>
/// What the relay tells the hub: chat written outside it, sends it kept first (their words, and a refusal that came
/// after their answer), sessions that ended, a relay that restarted.
/// </summary>
public sealed class RelayEvents
{
    private readonly Pusher push;
    private readonly SendBook book;

    public RelayEvents(Pusher push, SendBook book)
    {
        this.push = push;
        this.book = book;
    }

    public async Task HandleAsync(JsonElement ev)
    {
        if (ev.ValueKind != JsonValueKind.Object)
        {
            return;
        }
        switch (Str(ev, "kind"))
        {
            case "nudge":
            {
                // a fact, never the words: the tabs read Messages for that thread themselves
                var frame = new { thread_key = Str(ev, "thread_key"), action = Str(ev, "action") };
                var from = Str(ev, "from");
                if (from.Length > 0)
                {
                    await push.ToPeople(new[] { from }, "nudge", frame);
                }
                var held = !ev.TryGetProperty("held", out var h) || h.ValueKind != JsonValueKind.False;
                if (!held)
                {
                    await push.ToPeople(Strings(ev, "to"), "nudge", frame);
                }
                break;
            }
            case "read":
            {
                var by = Str(ev, "by");
                if (by.Length > 0)
                {
                    await push.ToPeople(new[] { by }, "read", new { with_user = Str(ev, "with_user"), by, thread_key = "" });
                }
                break;
            }
            case "sent":
            {
                // a send the relay kept first from outside the hub: its words, as this hub's own `confirm` carries them
                var from = Str(ev, "from");
                var id = Str(ev, "id");
                if (from.Length == 0 || id.Length == 0)
                {
                    break;
                }
                var frame = new
                {
                    client_id = Str(ev, "client_id"),
                    id,
                    created_at = Str(ev, "created_at"),
                    state = "sent",
                    thread_key = Str(ev, "thread_key"),
                    @from = from,
                    from_name = Str(ev, "from_name"),
                    to = Str(ev, "to"),
                    body = Str(ev, "body"),
                };
                await push.ToPeople(new[] { from }, "confirm", frame);
                if (!Held(ev))
                {
                    await push.ToPeople(Recipients(ev), "confirm", frame);
                }
                break;
            }
            case "refused":
            {
                // a kept send Apps Script did not file: its line goes at both ends (no words ride this), and a Retry of
                // it is a new try; `moved` is a row filed under another id, which the tabs read for themselves
                var from = Str(ev, "from");
                var clientId = Str(ev, "client_id");
                var moved = ev.TryGetProperty("moved", out var mv) && mv.ValueKind == JsonValueKind.True;
                if (from.Length > 0 && clientId.Length > 0)
                {
                    if (moved)
                    {
                        book.Forget(from, clientId);
                    }
                    else
                    {
                        book.Failed(from, clientId);
                    }
                }
                var frame = new { id = Str(ev, "id"), client_id = clientId, thread_key = Str(ev, "thread_key"), why = Str(ev, "why"), moved };
                await push.ToPeople(new[] { from }.Concat(Recipients(ev)), "gone", frame);
                break;
            }
            case "revoke":
                await RevokeAsync(ev);
                break;
            case "hello":
                // the relay restarted and forgot every ref: every tab asks for a new ticket and keeps its socket, or is
                // closed once ReauthGrace has passed without one
                await push.ReauthAll();
                break;
        }
    }

    public async Task RevokeAsync(JsonElement ev)
    {
        foreach (var reference in Strings(ev, "refs"))
        {
            await push.Revoke(reference);
        }
    }

    private static bool Held(JsonElement ev) => !ev.TryGetProperty("held", out var h) || h.ValueKind != JsonValueKind.False;

    /// <summary>The person written to and every account folded onto them.</summary>
    private static List<string> Recipients(JsonElement ev)
    {
        var to = Strings(ev, "to_ids");
        var person = Str(ev, "to");
        if (person.Length > 0 && !to.Contains(person))
        {
            to.Insert(0, person);
        }
        return to;
    }

    private static string Str(JsonElement ev, string name) =>
        ev.ValueKind == JsonValueKind.Object && ev.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() ?? ""
            : "";

    private static List<string> Strings(JsonElement ev, string name)
    {
        var out_ = new List<string>();
        if (ev.ValueKind == JsonValueKind.Object && ev.TryGetProperty(name, out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in arr.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String && item.GetString() is { Length: > 0 } s)
                {
                    out_.Add(s);
                }
            }
        }
        return out_;
    }
}
