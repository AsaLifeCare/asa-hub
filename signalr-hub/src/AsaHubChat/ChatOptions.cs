namespace AsaHubChat;

/// <summary>Read from the environment (HUB_RELAY_URL, HUB_CHAT_KEY); the rest are the design's numbers.</summary>
public sealed class ChatOptions
{
    public string RelayUrl { get; set; } = "http://asa-hub-snapshot:8080";

    /// <summary>HMAC-SHA256(HUB_SERVICE_SECRET, "asa-hub-chat"): the relay derives the same value in code.</summary>
    public string ChatKey { get; set; } = "";

    /// <summary>One chatPing per person with a visible tab, as often as the shell's beat stamped presence.</summary>
    public TimeSpan PresenceEvery { get; set; } = TimeSpan.FromMinutes(4);

    public TimeSpan PresenceTick { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>chatPings of one round in flight at once (the relay runs four chat execs at a time).</summary>
    public int PingsAtOnce { get; set; } = 4;

    /// <summary>A send is tried this many times through the relay, with the same client id each time.</summary>
    public int SendTries { get; set; } = 3;

    /// <summary>The relay's retry_after is honoured within these bounds.</summary>
    public TimeSpan SendRetryWaitFloor { get; set; } = TimeSpan.FromSeconds(5);

    public TimeSpan SendRetryWaitCap { get; set; } = TimeSpan.FromSeconds(150);

    /// <summary>How long a settled send is remembered by its client id: a repeat within it is the same message.</summary>
    public TimeSpan SendMemory { get; set; } = TimeSpan.FromHours(1);

    /// <summary>
    /// Words reach the other end before the sheet has them only while the frame gate is open as the relay said
    /// within this; an older word is asked again at the relay's gate door (nothing in Apps Script).
    /// </summary>
    public TimeSpan FrameGateFresh { get; set; } = TimeSpan.FromSeconds(5);

    /// <summary>How long the gate door is waited for; past it the gate holds and the words wait for the sheet.</summary>
    public TimeSpan FrameGateAsk { get; set; } = TimeSpan.FromSeconds(3);

    /// <summary>Past this a send answers "not sent" rather than keep the sender's lane.</summary>
    public TimeSpan SendDeadline { get; set; } = TimeSpan.FromMinutes(5);

    /// <summary>A redeemed ticket is remembered for the connection that used it, sliding.</summary>
    public TimeSpan TicketCacheSlide { get; set; } = TimeSpan.FromHours(2);

    /// <summary>An unbound ticket (negotiate, before the connect) lives as long as the relay's own ticket.</summary>
    public TimeSpan TicketCacheUnbound { get; set; } = TimeSpan.FromSeconds(60);

    /// <summary>A connection asked to renew its ref (`reauth`) that has not done so by then is closed.</summary>
    public TimeSpan ReauthGrace { get; set; } = TimeSpan.FromSeconds(90);

    /// <summary>How often overdue renewals and connection lifetimes are looked at.</summary>
    public TimeSpan SweepTick { get; set; } = TimeSpan.FromSeconds(15);

    /// <summary>How often the relay is asked which of the refs held here are still sessions (hidden tabs included).</summary>
    public TimeSpan RefCheckEvery { get; set; } = TimeSpan.FromMinutes(2);

    /// <summary>No connection outlives this; the tab reconnects through the ticket door, which judges it again.</summary>
    public TimeSpan MaxConnectionLife { get; set; } = TimeSpan.FromHours(12);

    /// <summary>Sends one person may have waiting behind the one on its way; more are refused, never queued.</summary>
    public int LaneCapacity { get; set; } = 20;

    /// <summary>Hub calls one connection may make at once, then CallsPerSecond: a token bucket per connection.</summary>
    public int CallBurst { get; set; } = 30;

    public double CallsPerSecond { get; set; } = 1.0;

    /// <summary>Relay execs one person may hold at once (sends ride their lane, one at a time, besides these).</summary>
    public int ExecsPerPerson { get; set; } = 2;
}
