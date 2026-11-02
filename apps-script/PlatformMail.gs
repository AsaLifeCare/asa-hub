// PLATFORM MAIL — the Hub's own mailbox, asa-hub@asaop.org.
// THE MAIL LIVES ON THE MAILSERVER; THE HUB ONLY CARRIES IT PAST.

var PLATFORM_MAIL_RELAY = 'https://asamylife.asalifecare.com';

// HOW MANY MAILBOXES THIS PLATFORM MAY HOLD.
var PLATFORM_MAIL_MAX = 5;

// EVERY MAILBOX THE PLATFORM IS WIRED TO, in order.
function platformMailAccounts_() {
  var out = [];
  try {
    for (var i = 1; i <= PLATFORM_MAIL_MAX; i++) {
      var suffix = i === 1 ? '' : '_' + i;
      // hubProp_ reads Props.gs first and the property store second, so a mailbox moved into the file and one still…
      var user = hubProp_('PLATFORM_EMAIL' + suffix).trim();
      var pass = hubProp_('PLATFORM_EMAIL_PASSWORD' + suffix);
      if (!user || !pass) continue;
      out.push({ id: String(i), user: user, password: pass });
    }
  } catch (e) { return out; }
  return out;
}

// { user, password } for ONE mailbox — or null, which every caller treats as "not wired".
function platformMailCreds_(id) {
  var all = platformMailAccounts_();
  if (!all.length) return null;
  var want = String(id == null ? '' : id).trim();
  if (want) {
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === want) return { user: all[i].user, password: all[i].password };
    }
  }
  return { user: all[0].user, password: all[0].password };
}

// The addresses, without the passwords — for a screen that has to offer a choice.
function platformMailAddresses_() {
  return platformMailAccounts_().map(function (a) {
    return { id: a.id, address: a.user, primary: a.id === '1' };
  });
}

/** One POST to the mail relay. The secret is the same one /analyze trusts. */
function platformMailPost_(path, extra, accountId) {
  var creds = platformMailCreds_(accountId);
  if (!creds) return { status: 503, message: 'PLATFORM_EMAIL is not configured' };
  var secret = '';
  try { secret = String(hubProp_('HUB_SERVICE_SECRET') || ''); }
  catch (eS) { secret = ''; }
  if (!secret) return { status: 503, message: 'HUB_SERVICE_SECRET is not configured' };
  var payload = { service_secret: secret, user: creds.user, password: creds.password };
  for (var k in (extra || {})) payload[k] = extra[k];
  try {
    var r = UrlFetchApp.fetch(PLATFORM_MAIL_RELAY + path, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var env = {};
    try { env = JSON.parse(r.getContentText() || '{}'); } catch (eJ) { env = {}; }
    if (r.getResponseCode() >= 400 || !env.status) {
      // NOT-OUR-ENVELOPE IS A FAILURE even under HTTP 200: a route nginx does not carry falls into the SPA fallback…
      var code = r.getResponseCode();
      return { status: (code >= 400 ? code : 502),
               message: String(env.message || (env.status ? 'relay refused' : 'not the relay\'s answer (' + code + ')')) };
    }
    return env;
  } catch (e2) {
    // The exception text never carries the payload — UrlFetchApp errors name the URL and the failure, not the body.
    return { status: 502, message: 'relay unreachable: ' + String((e2 && e2.message) || e2).slice(0, 120) };
  }
}

// The e-mail transport, SMTP-first.
function platformMailSink_(to, subject, body, html, cc, redir) {
  var out = { to: to, subject: subject, body: body, html: html, cc: cc,
              redirected: false, real_to: '' };
  if (redir === undefined) {
    // the live truth; a test passes its own so the rule is provable dry.
    try {
      redir = (typeof hubTestRedirect_ === 'function')
        ? hubTestRedirect_()
        : { sms: [], emails: [], sheet: true, unreadable: true };
    } catch (e) {
      redir = (typeof hubSwitchHeldRedirect_ === 'function')
        ? hubSwitchHeldRedirect_((typeof hubSwitchUnreadable_ === 'function')
            ? hubSwitchUnreadable_('platformMailSink_', e) : '')
        : { sms: [], emails: [], sheet: true, unreadable: true };
    }
  }
  if (!redir) return out;
  // THE DIAL AT THE SHEET.
  if (redir.sheet) {
    var rowOut = (typeof hubRehearsalSend_ === 'function')
      ? hubRehearsalSend_('emailSend', { channel: 'email', to: to, subject: subject,
                                         body: body, cc: cc })
      : null;
    throw new Error('rehearsal_sheet: the dial is at the sheet — this letter was written into ' +
                    'the rehearsal house' +
                    ((rowOut && rowOut.rehearsal_row) ? ' as ' + rowOut.rehearsal_row : '') +
                    ' and sent to nobody');
  }
  var testers = (redir.emails || []).map(function (e) { return String(e).trim().toLowerCase(); });
  var asked = String(to || '').split(/[,;]+/)
    .map(function (s) { return s.trim().toLowerCase(); }).filter(String);
  if (asked.length && asked.every(function (a) { return testers.indexOf(a) !== -1; })) return out;
  if (!testers.length) {
    throw new Error('test_redirect_no_email: test mode is on and no tester is listed for e-mail — ' +
                    'refusing to fall back to the real recipient');
  }
  out.real_to = String(to || '');
  out.to = testers.join(',');
  out.cc = '';                                   // a copy surviving the redirect reaches the real team
  if (!/^\[TEST\]/i.test(String(subject || ''))) out.subject = '[TEST] ' + String(subject || '');
  var banner = '';
  try { banner = (typeof hubTestBanner_ === 'function') ? hubTestBanner_(out.real_to) : ''; }
  catch (eB) { banner = ''; }
  // the configured banner is OFF by default; a tester must still learn who the letter was for, so the fallback…
  if (!banner) banner = '[TEST] Redirected to you. The real recipient would have been ' + out.real_to + '.\n\n';
  out.body = banner + String(body || '');
  if (html && typeof hubTestBannerHtml_ === 'function') out.html = hubTestBannerHtml_(out.real_to) + String(html);
  out.redirected = true;
  return out;
}

// The words as a record may keep them.
function platformMailWithhold_(text, ledger) {
  var out = text;
  try {
    if (typeof hubSecretScrub_ === 'function') out = hubSecretScrub_(out);
  } catch (eS) { return '{words withheld}'; }
  var secret = ledger && ledger.withhold;
  if (!secret) return out;
  try {
    if (typeof hubWithhold_ === 'function') return hubWithhold_(out, secret);
  } catch (e) { /* the blunt answer below */ }
  return '{words withheld}';
}

/** The name the platform's own mailbox signs with; a bare address reads as unknown to a recipient's filter. */
var PLATFORM_MAIL_FROM_NAME = 'ASA MyLife';

/** Every secret a letter names — its `withhold` and the lane's held secrets — as a list for the relay. */
function platformMailSecrets_(ledger) {
  var out = [];
  var add = function (s) {
    var v = String(s == null ? '' : s);
    if (v.length >= 4 && out.indexOf(v) === -1) out.push(v);
  };
  var w = ledger && ledger.withhold;
  (Array.isArray(w) ? w : [w]).forEach(add);
  if (typeof HUB_RPC_SECRETS !== 'undefined' && HUB_RPC_SECRETS) HUB_RPC_SECRETS.forEach(add);
  return out.slice(0, 8);
}

function platformMailOut_(to, subject, body, html, fromAccount, cc, ledger) {
  // THE DIAL AT THE SHEET — BEFORE EVERYTHING, past_redirect included.
  var authKind = '';
  try {
    authKind = (typeof hubAuthLetterKind_ === 'function')
      ? hubAuthLetterKind_(ledger && ledger.auth_letter) : '';
  } catch (eA) { authKind = ''; }    // an unreadable claim is no claim
  // AN UNREADABLE SWITCH HOLDS, AND SO DOES A MISSING ONE.
  var toSheet = true;
  try {
    toSheet = (typeof hubRehearsalToSheet_ === 'function') ? !!hubRehearsalToSheet_() : true;
  } catch (eSh) {
    if (typeof hubSwitchUnreadable_ === 'function') hubSwitchUnreadable_('platformMailOut_', eSh);
    toSheet = true;
  }
  if (toSheet && authKind) {
    try {
      if (typeof hubAuthLetterSay_ === 'function') hubAuthLetterSay_(authKind, 'platformMailOut_', to);
    } catch (eS2) { /* the letter never waits on its own log line */ }
  }
  if (toSheet && !authKind) {
    var rehearsed = (typeof hubRehearsalSend_ === 'function') ? hubRehearsalSend_('emailSend', {
      channel: 'email', to: to,
      subject: platformMailWithhold_(subject, ledger), body: platformMailWithhold_(body, ledger),
      from_account: str_(fromAccount), cc: cc,
      reason: str_(ledger && ledger.reason)
    }) : null;
    // NO MAIL-LEDGER ROW.
    return { sent: false, receipt: '', redirected: false, rehearsed: true,
             rehearsal_row: str_(rehearsed && rehearsed.rehearsal_row) };
  }
  // ONE deliberate way past the sink, claimed by the caller and never inferred: `ledger.past_redirect === true`.
  var wasRedirected = false;
  // AND THE TESTER REDIRECT IS THE SAME QUESTION ONE LAYER DOWN.
  if (!authKind && !(ledger && ledger.past_redirect === true)) {
    var sunk = platformMailSink_(to, subject, body, html, cc);
    if (sunk.redirected) {
      wasRedirected = true;
      try {
        hubSysLog_('asa-hub:mail', 'platform_mail_redirected',
                   'test mode: a letter for ' + sunk.real_to + ' went to the testers', { status: 200 });
      } catch (eR) { /* the redirect stands */ }
      to = sunk.to; subject = sunk.subject; body = sunk.body; html = sunk.html; cc = sunk.cc;
    }
  }
  var creds = platformMailCreds_(fromAccount);
 // THE DECIDERS SEE EVERY REHEARSAL: every e-mail carrying the [test] badge reaches Arthur and Ty Bond.
  cc = mailAlsoTellDeciders_(subject, to, cc);
 // THE LEDGER STAMP — every mail is logged.
  var mailLogSay_ = function (receipt) {
    try {
      if (typeof mailLogOut_ !== 'function') return;
      mailLogOut_({
        account: str_(fromAccount) || '1',
        address: (creds && creds.user) || '',
        to: to, cc: cc,
        subject: platformMailWithhold_(subject, ledger), body: platformMailWithhold_(body, ledger),
        lane: str_(ledger && ledger.lane), reason: str_(ledger && ledger.reason),
        send_id: str_(ledger && ledger.send_id), receipt: receipt
      });
    } catch (eLg) { /* the send stands */ }
  };
  if (creds) {
    var sendBody = {
      to: to, subject: subject, body: body,
      // The designed layout travels beside the words, never instead of them: the plain part is what a text-only…
      html: html ? String(html) : '',
 // A REAL Cc, comma-separated: the hiring simulation copies the team on every letter, and a copy has to arrive AS a…
      cc: cc ? String(cc) : '',
      send_id: 'pm_' + Utilities.getUuid()
    };
    // the platform's own voice carries its name; a numbered mailbox is somebody's and keeps its bare address
    if (!str_(fromAccount) || str_(fromAccount) === '1') sendBody.from_name = PLATFORM_MAIL_FROM_NAME;
    // the copy the mailbox files in Sent (readable on the platform) keeps the words, never the secret
    var secrets = platformMailSecrets_(ledger);
    if (secrets.length) sendBody.withhold = secrets;
    // asked only by a letter that must arrive: an address that cannot receive mail comes back unsent
    if (ledger && ledger.reach === true) sendBody.check_reach = true;
    var r = platformMailPost_('/mail/send', sendBody, fromAccount);
    if (r && r.status === 200) {
      mailLogSay_('smtp');
      return { sent: true, receipt: 'smtp', redirected: wasRedirected,
               message_id: str_(r.data && r.data.message_id) };
    }
    // UNDELIVERABLE IS AN ANSWER, NOT A FAILURE: MailApp would only mail the same dead address from Google.
    if (r && r.status === 422 && r.data && r.data.undeliverable) {
      try {
        hubSysLog_('asa-hub:mail', 'platform_mail_undeliverable',
                   (typeof rpcMaskTo_ === 'function' ? rpcMaskTo_(to) : '•••') + ' — ' +
                   str_(r.data.undeliverable) + (str_(r.data.bounced_at) ? ' (' + str_(r.data.bounced_at) + ')' : ''),
                   { status: 422 });
      } catch (eU) { /* the answer below still says it */ }
      return { sent: false, receipt: '', redirected: wasRedirected, undeliverable: str_(r.data.undeliverable) };
    }
    try {
      hubSysLog_('asa-hub:mail', 'platform_mail_fallback',
                 'relay said ' + String(r && r.message).slice(0, 100) + ' — MailApp carried it',
                 { status: (r && r.status) || 502 });
    } catch (eL) { /* logging never blocks a send */ }
  }
  var msg = { to: to, subject: subject, body: body };
  if (html) msg.htmlBody = String(html);
  if (cc) msg.cc = String(cc);
  MailApp.sendEmail(msg);
  mailLogSay_('mail');
  return { sent: true, receipt: 'mail', redirected: wasRedirected };
}

// ▶ Try to access the mailbox: read the inbox, log what is there.
function runPlatformMailProbe() {
  var all = platformMailAccounts_();
  if (!all.length) {
    Logger.log('NOT CONNECTED: no PLATFORM_EMAIL is configured');
    return { status: 503, accounts: 0 };
  }
  var out = [];
  for (var a = 0; a < all.length; a++) {
    var r = platformMailPost_('/mail/inbox', { limit: 10 }, all[a].id);
    if (r.status !== 200) {
      Logger.log('[' + all[a].id + '] ' + all[a].user + ' — NOT CONNECTED: ' +
                 r.status + ' — ' + r.message);
      out.push({ id: all[a].id, address: all[a].user, ok: false, message: r.message });
      continue;
    }
    var t = (r.data && r.data.threads) || [];
    Logger.log('[' + all[a].id + '] ' + all[a].user + ' — connected, ' + t.length + ' message(s)');
    for (var i = 0; i < t.length; i++) {
      Logger.log('      [' + (t[i].unread ? 'NEW' : 'read') + '] ' + t[i].date + ' · ' +
                 t[i].from_addr + ' · ' + t[i].subject);
    }
    out.push({ id: all[a].id, address: all[a].user, ok: true, count: t.length });
  }
  return { status: 200, accounts: out };
}

// WHO READS THE PLATFORM MAILBOX — the master plus the badges the `platform_mail_badges` config names — the config…
var PLATFORM_MAIL_BADGES_CACHE = null;
function platformMailReaderBadges_() {
  // Read ONCE per execution: userPublic_ asks this for every row of usersList, and hiringAlerts_ is a CacheService…
  if (PLATFORM_MAIL_BADGES_CACHE !== null) return PLATFORM_MAIL_BADGES_CACHE;
  var raw = '';
  try { raw = str_(hiringAlerts_().platform_mail_badges); } catch (e) { raw = ''; }
  var list = userTypesFromRaw_(raw || 'DIRECTOR').types;
  PLATFORM_MAIL_BADGES_CACHE = list.length ? list : ['DIRECTOR'];
  return PLATFORM_MAIL_BADGES_CACHE;
}
function platformMailCanRead_(user) {
  if (!user || user.is_service) return false;
  if (hubIsMaster_(str_(user.email))) return true;
  // WORN, plus what a worn badge currently stands in for (Profile.gs HUB_BADGE_FOLLOWS): a SUPERVISOR reads the box…
  var mine = (typeof userBadgesWorn_ === 'function')
    ? userBadgesWorn_(user.types, '')
    : userTypesFromRaw_(user.types).types;
  var allowed = platformMailReaderBadges_();
  for (var i = 0; i < mine.length; i++) {
    if (allowed.indexOf(mine[i]) !== -1) return true;
  }
  return false;
}

// The Inbox view.
HUB_POLICY.platformMailInbox = {
  file: 'PlatformMail.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: []
};
HUB_ACTIONS.platformMailInbox = function (payload, user) {
 // THE PERSON'S OWN BOX — a signed-in user finds their mailbox already in place.
  if (String((payload && payload.account) || '') === 'mine') {
    if (!user || user.is_service) return { status: 404, message: 'Unknown action.' };
    var own = platformMailOwnBox_(user);
    var boxM = String((payload && payload.box) || '');
    if (!own) {
      return { status: 200, data: { address: '', account: 'mine',
               accounts: platformMailAccountsFor_(user), threads: [], folders: [],
               mailbox: '', fetched_at: '',
               note: 'Your mailbox is minted at sign-in — sign out and back in once, then look again.' } };
    }
    var rO = platformMailPostOwn_('/mail/inbox', {
      limit: Math.min(Number(payload && payload.limit) || 30, 100),
      mailbox: boxM === 'sent' ? 'sent' : boxM
    }, own);
    if (rO.status !== 200) return { status: rO.status, message: rO.message };
    return { status: 200, data: { address: own, account: 'mine',
             accounts: platformMailAccountsFor_(user),
             threads: (rO.data && rO.data.threads) || [],
             folders: (rO.data && rO.data.folders) || [],
             mailbox: (rO.data && rO.data.mailbox) || '',
             fetched_at: (rO.data && rO.data.fetched_at) || '' } };
  }
  if (!platformMailCanRead_(user)) {
    // The same shape Master.gs refuses with: not "forbidden", which would advertise that there is a mailbox to be…
    return { status: 404, message: 'Unknown action.' };
  }
  // 'sent', the inbox, or one of the watcher's own Staff folders — the relay holds the SHAPE rule; this only names…
  var box = String((payload && payload.box) || '');
 // WHICH MAILBOX.
  var account = String((payload && payload.account) || '');
  var r = platformMailPost_('/mail/inbox', {
    limit: Math.min(Number(payload && payload.limit) || 30, 100),
    mailbox: box === 'sent' ? 'sent' : box
  }, account);
  if (r.status !== 200) return { status: r.status, message: r.message };
  // THE LIST OF ADDRESSES TRAVELS WITH THE ANSWER, and only to somebody the gate above has already admitted: a…
  return { status: 200, data: { address: (platformMailCreds_(account) || {}).user || '',
                                account: account || '1',
                                accounts: platformMailAccountsFor_(user),
                                threads: (r.data && r.data.threads) || [],
                                folders: (r.data && r.data.folders) || [],
                                mailbox: (r.data && r.data.mailbox) || '',
                                fetched_at: (r.data && r.data.fetched_at) || '' } };
};

// Send one e-mail from the platform's address, by hand.
HUB_POLICY.platformMailSend = {
  file: 'PlatformMail.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
 // EVERY internal user sends: every user sends the informational e-mails they need through the asa-hub.
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: ['emailSend']
};
HUB_ACTIONS.platformMailSend = function (payload, user) {
  // The switch lives in the configs with everything else.
  try {
    if (typeof hiringAlerts_ !== 'function') throw new Error('the configuration reader is not in this build');
    var cfg = hiringAlerts_() || {};
    if (String(cfg.platform_email_enabled || 'yes').trim().toLowerCase() === 'no') {
      return { status: 503, message: 'Platform e-mail is switched off in Settings.' };
    }
  } catch (eC) {
    return { status: 503, message: 'The platform e-mail switch could not be read — nothing was sent. ' +
             'Try again in a moment.' };
  }
  var to = str_(payload && payload.to).trim();
  var subject = str_(payload && payload.subject).trim();
  var body = str_(payload && payload.body);
  if (to.indexOf('@') === -1) return { status: 400, message: 'to: a full address is required.' };
  if (!subject && !body) return { status: 400, message: 'An empty message is refused.' };
  // WHICH MAILBOX IT LEAVES FROM.
  var from = str_(payload && payload.from_account);
 // FROM THE PERSON'S OWN BOX: personal mail leaves as person, through their own credentials on the relay — like…
  if (from === 'mine') {
    var ownS = platformMailOwnBox_(user);
    if (!ownS) return { status: 409, message: 'Your mailbox is minted at sign-in — none exists yet.' };
    // BUT TEST MODE STOPS IT TOO.
    var ownHeld = true, ownWhy = '';
    try {
      ownHeld = (typeof hubRehearsalToSheet_ === 'function') ? !!hubRehearsalToSheet_() : true;
      if (typeof hubRehearsalToSheet_ !== 'function') {
        ownWhy = 'the send switch is not in this build, so it cannot be read';
      }
    } catch (eOwnT) {
      ownWhy = (typeof hubSwitchUnreadable_ === 'function')
        ? hubSwitchUnreadable_('platformMailSend own box', eOwnT)
        : 'the send switch could not be read';
      ownHeld = true;
    }
    if (!ownWhy && typeof hubSwitchUnreadableWhy_ === 'function') ownWhy = hubSwitchUnreadableWhy_();
    if (ownHeld) {
      var ownHeldBy = ownWhy
        ? ownWhy + ' — held, not sent'
        : 'test mode is on — nothing leaves the platform';
      try {
        if (typeof hubRehearsalHeld_ === 'function') {
          hubRehearsalHeld_({
            channel: 'email', to: to, subject: subject, body: body, from_account: ownS,
            reason: 'platform mail: sent by ' + str_(user && user.email) + ' from their own mailbox',
            pass_by: 'asa-hub:platform-mail', to_name: to,
            held_by: ownHeldBy
          });
        }
      } catch (eOwnH) { /* nothing was sent either way, which is the part that matters */ }
      hubSysLog_(str_(user && user.email), 'platform_mail_send_own_held',
                 to + ' — as ' + ownS + ' · ' + ownHeldBy + ', written to the mock outbox', { status: 200 });
      return { status: 200, data: { sent: false, gated: true, rehearsed: true, from: ownS,
        unreadable: !!ownWhy,
        note: ownWhy
          ? 'The send switch could not be read, so nothing leaves the platform until it can. The letter ' +
            'is a row in the mock outbox, sent to nobody.'
          : 'Test mode is on — nothing leaves the platform. The letter is a row in the mock outbox, sent to nobody.' } };
    }
    var rS = platformMailPostOwn_('/mail/send', {
      to: to, subject: subject, body: body, html: '',
      send_id: 'own_' + Utilities.getUuid()
    }, ownS);
    if (Number(rS.status) !== 200) return { status: rS.status, message: rS.message };
    hubSysLog_(str_(user.email), 'platform_mail_send_own', to + ' — as ' + ownS, { status: 200 });
    return { status: 200, data: { sent: true, redirected: false, from: ownS } };
  }
  // A LETTER WRITTEN BY HAND is a person speaking, not the platform notifying: the quiet window does not hold it…
  var r = rpcCall_('emailSend', { to: to, subject: subject, body: body,
                                  from_account: from,
                                  reason: 'platform mail: sent by ' + str_(user.email) +
                                          (from ? ' as mailbox ' + from : '') },
                   { idempotency_key: 'pmsend_' + Utilities.getUuid(), quiet_exempt: 'by_hand' });
  if (!r.ok) return { status: 502, message: str_(r.error) || 'The send failed.' };
  if (r.gated) return { status: 200, data: { sent: false, gated: true,
    note: 'Recorded, not sent — sending is switched off or the recipient opted out.' } };
  return { status: 200, data: { sent: true, redirected: !!r.redirected, receipt: str_(r.receipt),
                                from: (platformMailCreds_(from) || {}).user || '' } };
};

// ------------------------------------------------------------------ PERSONAL MAILBOXES — an individual address…

var USER_MAILBOX_TAB = 'user_mailboxes';

/** The Smart Comms situation the mailbox credentials letter speaks through (SmartGate.gs hubDisabledLetterSeeds_). */
var MAILBOX_CREDENTIALS_SITUATION = 'mailbox_credentials';

/** Said once per execution: a sign-in wave held by one brake is one fact. */
var MAILBOX_HELD_SAID = false;

// WOULD THE PASSWORD LETTER LEAVE?
function mailboxLetterHeld_(email) {
  var e = String(email || '').trim().toLowerCase();
  if (typeof hubIsMaster_ === 'function' && hubIsMaster_(e)) return { skip: true, why: '', row: null };
  if (e.indexOf('@') === -1) return { skip: true, why: '', row: null };
  var gate = (typeof hubSituationGate_ === 'function')
    ? hubSituationGate_(MAILBOX_CREDENTIALS_SITUATION)
    : { on: false, row: null, why: 'the Smart Comms situations are not in this build' };
  if (!gate.on) return { skip: false, why: gate.why, row: null };
  var row = gate.row;
  var keepOwn = (typeof smartList_ === 'function') ? smartList_(row.exclude_values) : [];
  if (keepOwn.map(function (x) { return String(x).toLowerCase(); }).indexOf(e) !== -1) {
    return { skip: true, why: '', row: row };
  }
  var chans = (typeof smartList_ === 'function') ? smartList_(row.channels) : [];
  if (chans.indexOf('email') === -1 || !str_(row.email_text)) {
    return { skip: false, why: 'the situation ' + MAILBOX_CREDENTIALS_SITUATION + ' writes no letter', row: row };
  }
  var held = true;
  try { held = (typeof hubRehearsalToSheet_ === 'function') ? !!hubRehearsalToSheet_() : true; }
  catch (eT) { held = true; }
  if (held) return { skip: false, why: 'test mode holds every message, so the password letter could not leave', row: row };
  var sending = false;
  try { sending = (typeof rpcSendEnabled_ === 'function') && !!rpcSendEnabled_(); } catch (eS) { sending = false; }
  if (!sending) return { skip: false, why: 'the sending switch is off, so the password letter could not leave', row: row };
  var stopped = '';
  try { stopped = (typeof optOutBlocked_ === 'function') ? String(optOutBlocked_(e) || '') : ''; }
  catch (eO) { stopped = 'the opt-out list could not be checked'; }
  if (stopped) return { skip: false, why: 'the password letter would be held: ' + stopped, row: row };
  return { skip: false, why: '', row: row };
}

function mailboxEnsure_(u) {
  if (!u || !u.id) return null;
  var cache = CacheService.getScriptCache();
  var ck = 'mbx_' + String(u.id);
  if (cache.get(ck)) return null;
  var ask = mailboxLetterHeld_(u.email);
  // AN ADDRESS THAT KEEPS ITS OWN MAIL never gets a box minted.
  if (ask.skip) { cache.put(ck, '1', 21600); return null; }
  // A HELD LETTER MINTS NOTHING, and nothing is stamped: the next sign-in asks again.
  if (ask.why) {
    if (!MAILBOX_HELD_SAID) {
      MAILBOX_HELD_SAID = true;
      try {
        hubSysLog_('asa-hub:mailbox', 'mailbox_provision_held',
                   String(u.email || u.id) + ' — no mailbox was created: ' + ask.why +
                   '. It is asked again at the next sign-in.', { status: 200 });
      } catch (eH) { /* the hold stands without its line */ }
    }
    return null;
  }
  var have = false;
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), USER_MAILBOX_TAB).forEach(function (r) {
      if (String(r.userid) === String(u.id)) have = true;
    });
  } catch (e) { /* first run ever: the tab is born on the first append */ }
  if (have) { cache.put(ck, '1', 21600); return null; }
  var name = String(u.name || '').trim() || String(u.email || '').split('@')[0];
  var local = name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
  if (!local) { cache.put(ck, '1', 21600); return null; }
  var env = platformMailPost_('/mail/provision', { local: local });
  if (!env || Number(env.status) !== 200 || !env.data) {
    hubSysLog_('asa-hub:mailbox', 'mailbox_provision_failed',
               String(u.email || u.id) + ' - ' + String((env && env.message) || 'no answer'),
               { status: 502 });
    return null;   // tried again on the next sign-in
  }
  var account = String(env.data.account || '');
  // The ONE time the password travels: to its owner, at their own address, in the situation's words.
  var letterWhy = '';
  if (env.data.created && env.data.password) {
    var pw = String(env.data.password);
    var vars = { first_name: name.split(/\s+/)[0] || '', name: name, account: account, password: pw };
    var render = function (t) {
      return (typeof smartRender_ === 'function') ? smartRender_(String(t || ''), vars) : String(t || '');
    };
    if (typeof hubSecretsHold_ === 'function') hubSecretsHold_([pw]);
    try {
      var res = rpcCall_('emailSend', {
        to: String(u.email),
        subject: render(ask.row.email_subject) || 'Your own ASA mailbox is ready',
        body: render(ask.row.email_text),
        reason: 'smart comms: ' + MAILBOX_CREDENTIALS_SITUATION,
        // the password reaches its owner and no record: not the mock outbox, the rehearsal house or a tester
        withhold: String(env.data.password)
      }, { quiet_exempt: 'sign_in' });   // minted at their own sign-in, and sent once
      if (!(res && res.ok && res.sent)) {
        letterWhy = str_(res && (res.detail || res.reason || res.error)) || 'the send door answered nothing';
      }
    } catch (eM) {
      letterWhy = String((eM && eM.message) || eM).slice(0, 200);
    } finally {
      if (typeof hubSecretsRelease_ === 'function') hubSecretsRelease_();
    }
  }
  hubAppendRow_(USER_MAILBOX_TAB, {
    user_id: String(u.id), user_email: String(u.email || ''),
    account: account,
    created: env.data.created ? (letterWhy ? 'yes, the password letter did not leave' : 'yes') : 'existing',
    created_at: new Date().toISOString()
  });
  cache.put(ck, '1', 21600);
  if (letterWhy) {
    hubSysLog_(String(u.email || ''), 'mailbox_password_not_delivered',
               account + ' exists, and its password did NOT reach its owner (' + letterWhy + '). The relay ' +
               'hands a password over once: it is in the relay\'s credentials file and must be re-issued ' +
               'by hand.', { status: 500 });
  }
  hubSysLog_(String(u.email || ''), 'mailbox_provisioned', account, { status: 200 });
  return account;
}

// The signed-in person's own mailbox address — '' when none was minted yet.
function platformMailOwnBox_(user) {
  if (!user || !user.id) return '';
  var own = '';
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), USER_MAILBOX_TAB).forEach(function (r) {
      if (String(r.userid) === String(user.id) && str_(r.account)) own = str_(r.account);
    });
  } catch (e) { own = ''; }
  return own;
}

// One POST for the person's OWN box: no credentials travel — the relay resolves them from its host-only store by…
function platformMailPostOwn_(path, extra, account) {
  var secret = '';
  try { secret = String(hubProp_('HUB_SERVICE_SECRET') || ''); }
  catch (eS) { secret = ''; }
  if (!secret) return { status: 503, message: 'HUB_SERVICE_SECRET is not configured' };
  var payload = { service_secret: secret, account: String(account || '') };
  for (var k in (extra || {})) payload[k] = extra[k];
  try {
    var r = UrlFetchApp.fetch(PLATFORM_MAIL_RELAY + path, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var env = {};
    try { env = JSON.parse(r.getContentText() || '{}'); } catch (eJ) { env = {}; }
    if (!env.status) env.status = r.getResponseCode();
    return env;
  } catch (eF) {
    return { status: 502, message: 'the mail relay is unreachable' };
  }
}

// The switcher's list FOR THIS CALLER: the platform boxes when the gate admits them, plus the person's own box…
function platformMailAccountsFor_(user) {
  var list = platformMailCanRead_(user) ? platformMailAddresses_() : [];
  var own = platformMailOwnBox_(user);
  if (own) list = list.concat([{ id: 'mine', address: own, primary: false, mine: true }]);
  return list;
}

// ------------------------------------------------------------------ THE MESSAGE ITSELF.

// WHO MAY TOUCH WHICH MAILBOX — one reading, shared by all five doors.
function platformMailDoor_(payload, user) {
  var account = String((payload && payload.account) || '');
  if (account === 'mine') {
    if (!user || user.is_service) return { refuse: { status: 404, message: 'Unknown action.' } };
    var own = platformMailOwnBox_(user);
    if (!own) return { refuse: { status: 409, message: 'Your mailbox is minted at sign-in — none exists yet.' } };
    return { own: own };
  }
  if (!platformMailCanRead_(user)) return { refuse: { status: 404, message: 'Unknown action.' } };
  return { account: account };
}

/** One POST through whichever credential lane the door resolved. */
function platformMailFetch_(path, extra, door) {
  return door.own
    ? platformMailPostOwn_(path, extra, door.own)
    : platformMailPost_(path, extra, door.account);
}

/** The whole message: full text, the HTML alternative, the attachment list. */
HUB_POLICY.platformMailMessage = {
  file: 'PlatformMail.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: []
};
HUB_ACTIONS.platformMailMessage = function (payload, user) {
  var door = platformMailDoor_(payload, user);
  if (door.refuse) return door.refuse;
  var id = str_(payload && payload.id).trim();
  if (!id) return { status: 400, message: 'id is required.' };
  var r = platformMailFetch_('/mail/message', {
    id: id, mailbox: str_(payload && payload.mailbox),
    hint: str_(payload && payload.hint).slice(0, 120)
  }, door);
  if (r.status !== 200) return { status: r.status, message: r.message };
  return { status: 200, data: r.data };
};

// One attachment's bytes, base64 — bounded at the relay, so a 30MB scan refuses with its size instead of bursting…
HUB_POLICY.platformMailAttachment = {
  file: 'PlatformMail.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: []
};
HUB_ACTIONS.platformMailAttachment = function (payload, user) {
  var door = platformMailDoor_(payload, user);
  if (door.refuse) return door.refuse;
  var id = str_(payload && payload.id).trim();
  var part = Number(payload && payload.part);
  if (!id || isNaN(part) || part < 0) return { status: 400, message: 'id and part are required.' };
  var r = platformMailFetch_('/mail/attachment', {
    id: id, part: part, mailbox: str_(payload && payload.mailbox),
    hint: str_(payload && payload.hint).slice(0, 120)
  }, door);
  if (r.status !== 200) return { status: r.status, message: r.message };
  return { status: 200, data: r.data };
};

// The seen flag — set when a person actually opens a message, so the badge and the bold row stop lying the moment…
HUB_POLICY.platformMailMark = {
  file: 'PlatformMail.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: []
};
HUB_ACTIONS.platformMailMark = function (payload, user) {
  var door = platformMailDoor_(payload, user);
  if (door.refuse) return door.refuse;
  var items = [];
  var given = (payload && payload.items) || [];
  for (var i = 0; i < given.length && items.length < 50; i++) {
    var id = str_(given[i] && given[i].id).trim();
    if (id) items.push({ id: id, hint: str_(given[i] && given[i].hint).slice(0, 120) });
  }
  if (!items.length) return { status: 400, message: 'items: nothing to mark.' };
  var r = platformMailFetch_('/mail/mark', {
    items: items,
    seen: (payload && payload.seen === false) ? 'no' : 'yes',
    mailbox: str_(payload && payload.mailbox)
  }, door);
  if (r.status !== 200) return { status: r.status, message: r.message };
  return { status: 200, data: r.data };
};

// Archive / Trash, FOR REAL.
HUB_POLICY.platformMailMove = {
  file: 'PlatformMail.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: []
};
HUB_ACTIONS.platformMailMove = function (payload, user) {
  var door = platformMailDoor_(payload, user);
  if (door.refuse) return door.refuse;
  var folder = str_(payload && payload.folder);
  if (folder !== 'Archive' && folder !== 'Trash') {
    return { status: 400, message: 'folder: Archive or Trash.' };
  }
  var id = str_(payload && payload.id).trim();
  if (!id) return { status: 400, message: 'id is required.' };
  var r = platformMailFetch_('/mail/file', {
    folder: folder,
    items: [{ id: id, hint: str_(payload && payload.hint).slice(0, 120) }]
  }, door);
  if (r.status !== 200) return { status: r.status, message: r.message };
  hubSysLog_(str_(user.email), 'platform_mail_move',
             folder + ' — ' + id.slice(0, 60), { status: 200 });
  return { status: 200, data: r.data };
};

// UNSEEN per mailbox — the badge the account switcher never had.
HUB_POLICY.platformMailUnread = {
  file: 'PlatformMail.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: []
};
HUB_ACTIONS.platformMailUnread = function (payload, user) {
  if (!user || user.is_service) return { status: 404, message: 'Unknown action.' };
  var pairs = [];
  if (platformMailCanRead_(user)) {
    var all = platformMailAccounts_();
    for (var i = 0; i < all.length; i++) {
      pairs.push({ label: all[i].id, user: all[i].user, password: all[i].password });
    }
  }
  var accounts = [];
  var own = platformMailOwnBox_(user);
  if (own) accounts.push(own);
  if (!pairs.length && !accounts.length) {
    return { status: 200, data: { counts: [] } };
  }
  var secret = '';
  try { secret = String(hubProp_('HUB_SERVICE_SECRET') || ''); } catch (eS) { secret = ''; }
  if (!secret) return { status: 503, message: 'HUB_SERVICE_SECRET is not configured' };
  try {
    var resp = UrlFetchApp.fetch(PLATFORM_MAIL_RELAY + '/mail/unread', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ service_secret: secret, pairs: pairs, accounts: accounts }),
      muteHttpExceptions: true
    });
    var env = {};
    try { env = JSON.parse(resp.getContentText() || '{}'); } catch (eJ) { env = {}; }
    if (Number(env.status) !== 200) {
      return { status: Number(env.status) || 502, message: str_(env.message) || 'relay refused' };
    }
    // The numbered boxes come back labelled by slot id; 'mine' is renamed so the screen matches counts to chips…
    var counts = ((env.data || {}).counts || []).map(function (c) {
      return { account: accounts.indexOf(String(c.address)) !== -1 ? 'mine' : String(c.address),
               unread: Number(c.unread) };
    });
    return { status: 200, data: { counts: counts } };
  } catch (eF) {
    return { status: 502, message: 'the mail relay is unreachable' };
  }
};

// ONE IMAP LOGIN WITH EXPLICIT CREDENTIALS — the add-account door's proof.
function platformMailVerify_(user, password) {
  var secret = '';
  try { secret = String(hubProp_('HUB_SERVICE_SECRET') || ''); }
  catch (eS) { secret = ''; }
  if (!secret) return { ok: false, message: 'HUB_SERVICE_SECRET is not configured' };
  try {
    var r = UrlFetchApp.fetch(PLATFORM_MAIL_RELAY + '/mail/inbox', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ service_secret: secret, user: user,
                                password: password, limit: 1 }),
      muteHttpExceptions: true
    });
    var env = {};
    try { env = JSON.parse(r.getContentText() || '{}'); } catch (eJ) { env = {}; }
    if (r.getResponseCode() >= 400 || Number(env.status) !== 200) {
      return { ok: false,
               message: String(env.message || ('the mailserver refused (' + r.getResponseCode() + ')')) };
    }
    return { ok: true, message: '' };
  } catch (e2) {
    return { ok: false, message: 'relay unreachable: ' + String((e2 && e2.message) || e2).slice(0, 120) };
  }
}

HUB_POLICY.platformMailAccountAdd = {
  file: 'PlatformMail.gs', lane: 'tool', store: 'sheet',
  // lane 'tool' is the load-bearing choice: the password gets ONE honest synchronous ride through /gas and never…
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  params: { address: { required: true, type: 'string' },
            password: { required: true, type: 'string' },
            slot: { required: false, type: 'string' } },
  invalidates: [], emits: []
};
// WIRE ANOTHER MAILBOX FROM THE SCREEN — a method inside the e-mail app for adding further accounts, by entering an…
HUB_ACTIONS.platformMailAccountAdd = function (payload, user) {
  if (!user || user.is_service || !hubIsMaster_(str_(user.email))) {
    return { status: 404, message: 'Unknown action.' };
  }
  var p = payload || {};
  var address = String(p.address || '').trim();
  var password = String(p.password || '');
  if (address.indexOf('@') === -1) {
    return { status: 400, message: 'That is not an e-mail address.' };
  }
  if (!password) return { status: 400, message: 'The mailbox needs its password.' };

  var wired = platformMailAccounts_();
  for (var w = 0; w < wired.length; w++) {
    if (wired[w].user.toLowerCase() === address.toLowerCase()) {
      return { status: 409, message: 'That mailbox is already wired as slot ' + wired[w].id + '.' };
    }
  }
  var slot = String(p.slot || '').trim();
  if (slot) {
    if (['2', '3', '4', '5'].indexOf(slot) === -1) {
      return { status: 400, message: 'Slot must be 2–5 — slot 1 is the platform\'s own voice.' };
    }
  } else {
    var taken = {};
    wired.forEach(function (a) { taken[a.id] = true; });
    for (var n = 2; n <= PLATFORM_MAIL_MAX; n++) {
      if (!taken[String(n)]) { slot = String(n); break; }
    }
    if (!slot) return { status: 409, message: 'All five mailbox slots are wired — free one first.' };
  }
  var keyAddr = 'PLATFORM_EMAIL_' + slot;
  var keyPass = 'PLATFORM_EMAIL_PASSWORD_' + slot;
  // THE FILE SHADOW: hubProp_ reads Props.gs first for these keys, so a store write under a live file line changes…
  var inFile = false;
  try { inFile = (typeof scriptPropInFile_ === 'function') &&
                 (scriptPropInFile_(keyAddr) || scriptPropInFile_(keyPass)); }
  catch (eF) { inFile = false; }
  if (inFile) {
    return { status: 409, message: 'Slot ' + slot + ' lives in Props.gs — comment out ' +
             keyAddr + ' / ' + keyPass + ' there and publish, then add it here.' };
  }
  var proof = platformMailVerify_(address, password);
  if (!proof.ok) {
    return { status: 502, message: 'The mailserver refused these credentials: ' + proof.message };
  }
  // hubPropSet_, never raw setProperty: it drops the per-execution store cache, so the platformMailAddresses_ read…
  if (!hubPropSet_(keyAddr, address) || !hubPropSet_(keyPass, password)) {
    return { status: 502, message: 'The property store refused the write — try again.' };
  }
  try {
    hubSysLog_(str_(user.email), 'platform_mail_account_added',
               address + ' as slot ' + slot, { status: 200 });
  } catch (eL) { /* wired either way */ }
  return { status: 200, data: { added: true, id: slot, address: address,
           accounts: platformMailAddresses_() } };
};
