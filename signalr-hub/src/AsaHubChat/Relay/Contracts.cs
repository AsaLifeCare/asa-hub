using System.Text.Json;

namespace AsaHubChat.Relay;

/// <summary>The relay's word on the refs held here: `Unknown` must renew or close, `Revoked` close now.</summary>
public sealed record RefVerdict(IReadOnlyList<string> Unknown, IReadOnlyList<string> Revoked)
{
    public static RefVerdict? From(RelayAnswer answer)
    {
        if (!answer.Ok || answer.Data is not { ValueKind: JsonValueKind.Object } d)
        {
            return null;
        }
        static List<string> List(JsonElement root, string name)
        {
            var out_ = new List<string>();
            if (root.TryGetProperty(name, out var arr) && arr.ValueKind == JsonValueKind.Array)
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
        return new RefVerdict(List(d, "unknown"), List(d, "revoked"));
    }
}

/// <summary>
/// Whose a redeemed ticket is. The session token never reaches the hub: only the relay's opaque ref. `Narrowed` is a
/// client or a guardian, whose chat is only the people its rail names.
/// </summary>
public sealed record Identity(
    string Ref,
    string AccountId,
    string PersonId,
    IReadOnlyList<string> FoldIds,
    string Name,
    string Tenant,
    bool IsMaster,
    bool Narrowed = false);

/// <summary>
/// One answer from the relay: the Apps Script envelope (status, data, message) or the relay's own refusal, which
/// always carries a reason (ref_unknown, revoked, acting, unconfirmed, unreachable, key, ...). Status 0 is a relay
/// that could not be reached at all.
/// </summary>
public sealed class RelayAnswer
{
    public int Status { get; init; }
    public string Reason { get; init; } = "";
    public string Message { get; init; } = "";
    public JsonElement? Data { get; init; }

    /// <summary>The relay's frame gate: when held, nothing is pushed to anybody but the caller's own tabs.</summary>
    public bool FrameHeld { get; init; } = true;

    public int RetryAfterS { get; init; }

    public bool Ok => Status == 200 && Reason.Length == 0;
    public bool RefUnknown => Reason == "ref_unknown";
    public bool Revoked => Reason is "revoked" or "acting";
    public bool Unconfirmed => Reason == "unconfirmed";

    /// <summary>A failure a later try of the same write may still turn into a delivery.</summary>
    public bool Retriable => Unconfirmed || Status == 0 || Reason is "unreachable" or "unavailable" or "transport";

    public static RelayAnswer Transport(string why) => new() { Status = 0, Reason = "transport", Message = why, FrameHeld = true };

    public static RelayAnswer Parse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return Transport("the relay answered something that is not an envelope");
        }
        int status = root.TryGetProperty("status", out var s) && s.ValueKind == JsonValueKind.Number && s.TryGetInt32(out var n) ? n : 0;
        string Str(string name) => root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
        bool held = !root.TryGetProperty("frame_held", out var h) || h.ValueKind != JsonValueKind.False;
        int retry = root.TryGetProperty("retry_after_s", out var r) && r.ValueKind == JsonValueKind.Number && r.TryGetInt32(out var rs) ? rs : 0;
        JsonElement? data = root.TryGetProperty("data", out var d) ? d.Clone() : null;
        return new RelayAnswer
        {
            Status = status,
            Reason = Str("reason"),
            Message = Str("message"),
            Data = data,
            FrameHeld = held,
            RetryAfterS = retry,
        };
    }

    public string DataString(string name)
    {
        if (Data is { ValueKind: JsonValueKind.Object } d && d.TryGetProperty(name, out var v))
        {
            return v.ValueKind switch
            {
                JsonValueKind.String => v.GetString() ?? "",
                JsonValueKind.Number => v.GetRawText(),
                _ => "",
            };
        }
        return "";
    }

    public static Identity? IdentityFrom(RelayAnswer answer)
    {
        if (!answer.Ok || answer.Data is not { ValueKind: JsonValueKind.Object } d)
        {
            return null;
        }
        string Str(string name) => d.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
        var folds = new List<string>();
        if (d.TryGetProperty("fold_ids", out var f) && f.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in f.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String && item.GetString() is { Length: > 0 } id && !folds.Contains(id))
                {
                    folds.Add(id);
                }
            }
        }
        var reference = Str("ref");
        var account = Str("account_id");
        var person = Str("person_id");
        if (reference.Length == 0 || account.Length == 0)
        {
            return null;
        }
        if (person.Length == 0)
        {
            person = account;
        }
        if (!folds.Contains(person))
        {
            folds.Insert(0, person);
        }
        if (!folds.Contains(account))
        {
            folds.Add(account);
        }
        bool master = d.TryGetProperty("is_master", out var m) && m.ValueKind == JsonValueKind.True;
        bool narrowed = d.TryGetProperty("narrowed", out var nw) && nw.ValueKind == JsonValueKind.True;
        return new Identity(reference, account, person, folds, Str("name"), Str("tenant"), master, narrowed);
    }
}
