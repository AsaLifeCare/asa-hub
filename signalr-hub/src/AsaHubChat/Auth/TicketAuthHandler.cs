using System.Security.Claims;
using System.Text.Encodings.Web;
using AsaHubChat.Relay;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace AsaHubChat.Auth;

/// <summary>
/// Who a hub request is: a ticket from the relay's ticket door, sent as `access_token` on the query (WebSockets,
/// Server-Sent Events) or as a Bearer header (negotiate, sends), redeemed at the relay. Nothing here logs it.
/// </summary>
public sealed class TicketAuthHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public new const string Scheme = "ticket";

    public const string RefClaim = "asa:ref";
    public const string AccountClaim = "asa:account";
    public const string PersonClaim = "asa:person";
    public const string FoldClaim = "asa:fold";
    public const string NameClaim = "asa:name";
    public const string TenantClaim = "asa:tenant";
    public const string MasterClaim = "asa:master";
    public const string NarrowedClaim = "asa:narrowed";

    private readonly IRelayClient relay;
    private readonly TicketCache cache;

    public TicketAuthHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder,
        IRelayClient relay, TicketCache cache)
        : base(options, logger, encoder)
    {
        this.relay = relay;
        this.cache = cache;
    }

    public static string ReadTicket(HttpRequest request)
    {
        var query = request.Query["access_token"].ToString();
        if (query.Length > 0)
        {
            return query;
        }
        var header = request.Headers.Authorization.ToString();
        return header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header[7..].Trim() : "";
    }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var ticket = ReadTicket(Request);
        if (ticket.Length == 0 || ticket.Length > 256)
        {
            return AuthenticateResult.NoResult();
        }
        var connection = Request.Query["id"].ToString();
        var key = TicketCache.Hash(ticket);
        if (cache.TryGet(key, connection, out var known) && known is not null)
        {
            return Success(known);
        }
        var (who, _) = await relay.RedeemAsync(ticket, Context.RequestAborted);
        if (who is null)
        {
            // the base class may write this sentence to a log: it never carries the relay's reason
            return AuthenticateResult.Fail("refused");
        }
        cache.Put(key, connection, who);
        return Success(who);
    }

    private static AuthenticateResult Success(Identity who)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, who.AccountId),
            new(ClaimTypes.Name, who.AccountId),
            new(RefClaim, who.Ref),
            new(AccountClaim, who.AccountId),
            new(PersonClaim, who.PersonId),
            new(NameClaim, who.Name),
            new(TenantClaim, who.Tenant),
            new(MasterClaim, who.IsMaster ? "1" : "0"),
            new(NarrowedClaim, who.Narrowed ? "1" : "0"),
        };
        claims.AddRange(who.FoldIds.Select(id => new Claim(FoldClaim, id)));
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme));
        return AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme));
    }

    public static Identity? IdentityOf(ClaimsPrincipal? user)
    {
        if (user?.Identity?.IsAuthenticated != true)
        {
            return null;
        }
        string One(string type) => user.FindFirst(type)?.Value ?? "";
        var reference = One(RefClaim);
        var account = One(AccountClaim);
        if (reference.Length == 0 || account.Length == 0)
        {
            return null;
        }
        var folds = user.FindAll(FoldClaim).Select(c => c.Value).Where(v => v.Length > 0).Distinct().ToList();
        // an unreadable claim narrows: a client never loses its narrowing to a missing word
        var narrowed = One(NarrowedClaim) != "0";
        return new Identity(reference, account, One(PersonClaim), folds, One(NameClaim), One(TenantClaim), One(MasterClaim) == "1",
            narrowed);
    }
}
