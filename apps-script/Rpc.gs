/** Outbound RPC — the only declared path for a request LEAVING this platform. */

/** Every method this platform may call, and what it must carry. */
var HUB_RPC = {};

/** Sending is OFF unless this Script Property switches it on. */
var RPC_SEND_PROP = 'HUB_RPC_SEND';

// How long a send receipt is remembered, so a retry of the SAME logical request cannot become a second SMS to a…
var RPC_RECEIPT_TTL_S = 21600;

/** The self-test's own switch: per-execution, and honoured ONLY while a stand-in transport is installed. */
var RPC_TEST_FORCE_ON = false;

// A MESSAGE THAT IS WRITTEN DOWN INSTEAD OF SENT STILL CARRIES ITS WORDS.
var HUB_RPC_SECRETS = null;

function hubSecretsHold_(list) {
  var out = [];
  (list || []).forEach(function (s) { if (String(s || '').length >= 4) out.push(String(s)); });
  HUB_RPC_SECRETS = out.length ? out : null;
}

function hubSecretsRelease_() { HUB_RPC_SECRETS = null; }

// The words as they were rendered, with any named secret withheld — in the one word both nets write…
function hubSecretScrub_(text) {
  var s = String(text == null ? '' : text);
  if (!HUB_RPC_SECRETS || !s) return s;
  for (var i = 0; i < HUB_RPC_SECRETS.length; i++) {
    s = s.split(HUB_RPC_SECRETS[i]).join(HUB_WITHHELD_WORDS);
  }
  return s;
}

/** True only when the Script Property says on AND Settings has not paused. */
function rpcSendEnabled_() {
  if (RPC_TEST_FORCE_ON && typeof RPC_TEST_TRANSPORT === 'function') return true;
  var on = false;
  try {
    var v = String(hubProp_(RPC_SEND_PROP) || '').toLowerCase();
    on = (v === 'on' || v === 'true' || v === '1');
  } catch (e) { return false; }
  if (!on) return false;
  // THE SETTINGS SWITCH MAY ONLY NARROW.
  try {
    if (typeof hubCfgOn_ === 'function' && hubCfgOn_('messages_paused')) return false;
  } catch (e2) { /* unreadable config never widens the gate; it is already on */ }
  return true;
}

/** The contracts */

// One SMS to one number.
HUB_RPC.smsSend = {
  channel: 'openphone',
  what: 'One SMS to one number.',
  params: {
    to: { type: 'string', required: true },
    body: { type: 'string', required: true },
    reason: { type: 'string', required: true },  // why, in the log, always
    // the line it leaves from; absent = Automations, else the situation's cell (rpcSituationLine_)
    from_line: { type: 'string', required: false }
  },
  idempotent: false,          // a second send is a second message
  reaches_a_person: true,
  timeout_s: 30
};

/** One email to one address. */
HUB_RPC.emailSend = {
  channel: 'gmail',
  what: 'One email to one address.',
  params: {
    to: { type: 'string', required: true },
    subject: { type: 'string', required: true },
    body: { type: 'string', required: true },
    // The designed layout, optional — the words in `body` are always the message, so a caller that sends no html…
    html: { type: 'string', required: false },
 // WHICH OF THE PLATFORM'S MAILBOXES IT LEAVES FROM.
    from_account: { type: 'string', required: false },
 // COMMA-SEPARATED COPY LIST.
    cc: { type: 'string', required: false },
    reason: { type: 'string', required: true }
  },
  idempotent: false,
  reaches_a_person: true,
  timeout_s: 30
};

/** The New Hire packet request — the entry door the packet hold needs. */
HUB_RPC.packetRequest = {
  channel: 'openphone',
  what: 'Ask a new hire to sign the New Hire packet.',
  params: {
    candidate_id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    to: { type: 'string', required: true },
    // Set only by a rehearsal. Present = the body says so at the top.
    rehearsal_for: { type: 'string' }
  },
  idempotent: false,
  reaches_a_person: true,
  timeout_s: 30
};

// The team alert.
HUB_RPC.teamAlert = {
  channel: 'openphone+gmail',
  what: 'Tell the hiring team something changed.',
  params: {
    subject: { type: 'string', required: true },
    body: { type: 'string', required: true },
    reason: { type: 'string', required: true },
    // Optional, comma-separated.
    to: { type: 'string' },
    // Optional designed letter (the mailShell_ html).
    html: { type: 'string', required: false },
    // THE E-MAIL'S OWN WORDS.
    mail_text: { type: 'string', required: false },
    // Optional "sms, email": the legs the situation row names. Absent = both.
    legs: { type: 'string', required: false }
  },
  idempotent: false,
  reaches_a_person: true,
  timeout_s: 60
};

/** The door */

// Make a declared call.
function rpcCall_(method, params, opts) {
  var rpcOut = (function () {
  opts = opts || {};
  params = params || {};
  var name = String(method || '');
  var contract = HUB_RPC[name];

  // Undeclared is refused — the line both ancestors got wrong.
  if (!contract) {
    return { ok: false, sent: false, gated: false, method: name,
             error: 'undeclared_method',
             detail: 'No contract for "' + name + '". Declare HUB_RPC.' + name +
                     ' before anything calls it — an undeclared call is one nobody ' +
                     'has decided the shape of.' };
  }

  // Refuse at home, with the envelope, before spending an execution.
  var spec = contract.params || {};
  for (var key in spec) {
    if (!spec.hasOwnProperty(key)) continue;
    var rule = spec[key], val = params[key];
    var missing = (val === undefined || val === null || String(val) === '');
    if (rule.required && missing) {
      return { ok: false, sent: false, gated: false, method: name,
               error: 'missing_param', detail: 'Missing required parameter: ' + key,
               params: rpcSafeParams_(params) };
    }
    if (!missing && rule.type) {
      var actual = Array.isArray(val) ? 'array' : typeof val;
      if (actual !== rule.type) {
        return { ok: false, sent: false, gated: false, method: name,
                 error: 'bad_param', detail: key + ' must be ' + rule.type + ', got ' + actual };
      }
    }
  }

  /** No `from_line`: the situation named by `reason` decides; params are copied, never edited. */
  if (name === 'smsSend' && !str_(params.from_line)) {
    var ownLine = rpcSituationLine_(params.reason);
    if (ownLine) {
      var withLine = {};
      for (var pk in params) if (params.hasOwnProperty(pk)) withLine[pk] = params[pk];
      withLine.from_line = ownLine;
      params = withLine;
    }
  }

  // ONCE SMART COMMS' SENDING IS PYTHON'S (the relay's `comms-send`), the message is handed there and decided by the
  // brakes it holds; while it is Apps Script's the relay says so, and this door goes on as it always did.
  var viaPython = rpcPythonSend_(name, params, opts);
  if (viaPython) return viaPython;

  /** THE PERSON'S OWN BRAKE, at the only door every send goes through. */
  if (contract.reaches_a_person && name !== 'teamAlert' &&
      typeof optOutBlocked_ === 'function') {
    var stopped = '';
    try {
      stopped = optOutBlocked_(params.to);
    } catch (eO) {
      // Unreadable is a refusal HERE, unlike everywhere else: the confident zero would be "nobody opted out", and…
      stopped = 'The opt-out list could not be checked: ' + String((eO && eO.message) || eO);
    }
    if (stopped) {
      hubSysLog_('asa-hub:rpc', 'rpc_opted_out', name + ' → ' + rpcMaskTo_(params.to),
                 { status: 200, message: stopped });
      return { ok: true, sent: false, gated: true, method: name,
               reason: 'opted_out', detail: stopped,
               would_have: rpcSafeParams_(params) };
    }
  }

  if (opts.dry_run === true) {
    return { ok: true, sent: false, gated: true, method: name,
             reason: 'dry_run', params: rpcSafeParams_(params) };
  }

  // IS THIS ONE OF THE TWO LETTERS THAT CARRY A WAY IN (HUB_AUTH_LETTERS)?
  var authKind = (typeof hubAuthLetterKind_ === 'function')
    ? hubAuthLetterKind_(params.auth_letter) : '';
  // a text walks past only for the kinds whose text carries a way in (HUB_AUTH_TEXTS)
  if (authKind && name === 'smsSend' && !hubAuthTextKind_(authKind)) authKind = '';
  if (authKind) hubAuthLetterSay_(authKind, 'rpcCall_ ' + name, params.to);

  // THE QUIET WINDOW (hubQuietHolds_) — nothing reaches a person 21:31–07:59 New York, whatever the lane.
  if (hubQuietHolds_(name, contract, params, opts, authKind)) {
    var quietSeen = rpcReceiptSeen_(str_(opts.idempotency_key));
    if (quietSeen) {
      return { ok: true, sent: false, gated: false, deduplicated: true,
               method: name, receipt: quietSeen,
               detail: 'This exact request was already made — not sent again.' };
    }
    hubQuietSay_(name);
    return hubQuietAnswer_(name, params);
  }

  // THE DIAL AT THE SHEET — the destination is a row, and there is no send.
  if (hubRehearsalToSheet_() && !authKind) {
    return hubRehearsalSend_(name, hubRehearsalMsgFor_(name, params));
  }

  // A ROW THAT WRITES INTO ITS OWN SHEET.
  var recorded = (!authKind && typeof commMockRecordOnly_ === 'function')
    ? commMockRecordOnly_(name, params, opts) : null;
  if (recorded) return recorded;

  // Exactly once, where it reaches a person.
  var key = str_(opts.idempotency_key);
  var cache = null;
  if (key && contract.reaches_a_person) {
    try {
      cache = CacheService.getScriptCache();
      var seen = cache.get('rpc_' + key);
      if (seen) {
        return { ok: true, sent: false, gated: false, deduplicated: true,
                 method: name, receipt: seen,
                 detail: 'This exact request was already made — not sent again.' };
      }
    } catch (eC) { cache = null; }
  }

  if (!rpcSendEnabled_() && !authKind) {
    // Recorded, not sent — the record is how a person reads tomorrow what the platform WOULD have sent tonight.
    hubSysLog_('asa-hub:rpc', 'rpc_gated', name,
               { status: 200, message: str_(params.reason) });
    return { ok: true, sent: false, gated: true, method: name,
             reason: 'HUB_RPC_SEND is off',
             would_have: rpcSafeParams_(params) };
  }

  var res;
  try {
    res = rpcSend_(name, contract, params);
  } catch (e) {
    hubSysLog_('asa-hub:rpc', 'rpc_failed', name, { status: 502, message: String(e) });
    return { ok: false, sent: false, gated: false, method: name,
             error: 'transport', detail: String((e && e.message) || e) };
  }

  // A REDIRECTED RECEIPT IS NOT REMEMBERED.
  if (res.ok && key && cache && !res.redirected && !res.rehearsed) {
    try { cache.put('rpc_' + key, String(res.receipt || 'sent'), RPC_RECEIPT_TTL_S); }
    catch (eP) { /* receipt not remembered — a retry may duplicate, so it is
                    logged rather than swallowed */
      hubSysLog_('asa-hub:rpc', 'rpc_receipt_lost', name, { status: 200 });
    }
  }
  // 'rpc_sent' IS THE PROOF A MESSAGE LEFT, so a rehearsal may not wear it: the row is the rehearsal's record and…
  hubSysLog_('asa-hub:rpc',
             res.rehearsed ? 'rpc_rehearsed' : (res.ok ? 'rpc_sent' : 'rpc_refused'), name,
             { status: res.ok ? 200 : 502, message: str_(res.detail || params.reason) });
  return res;
  })();
  try {
    // A MESSAGE ALREADY WRITTEN INTO ITS OWN HOUSE IS NOT WRITTEN AGAIN, nor one Python decided (it notes its own).
    if (typeof commMockNote_ === 'function' && !(rpcOut && (rpcOut.recorded_to || rpcOut.python))) {
      commMockNote_(method, params, opts, rpcOut);
    }
    // AND A CAP IS NEVER SILENT.
    if (typeof commMockSayIfCapped_ === 'function') commMockSayIfCapped_();
  } catch (eMock) { /* the book is never worth a message */ }
  return rpcOut;
}

// Whether the relay last said Python sends (held six hours): a relay that does not answer then sends nothing from here.
var RPC_PYTHON_SAID = 'rpc_python_send';

// The message handed to Python's send door while Smart Comms' sending is Python's: rpcCall_'s answer, marked `python`;
// null while Apps Script still sends, or while a self-test's stand-in transport decides.
function rpcPythonSend_(name, params, opts) {
  if (RPC_TEST_TRANSPORT || typeof staffRelayPost_ !== 'function') return null;
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (eC) { cache = null; }
  var env = staffRelayPost_('/smart-comms/rpc', { method: name, params: params, opts: opts || {} });
  if (env && env.status === 200 && env.data) {
    if (env.data.python !== true) {
      try { if (cache) cache.put(RPC_PYTHON_SAID, 'no', 21600); } catch (eN) { /* asked again next time */ }
      return null;
    }
    try { if (cache) cache.put(RPC_PYTHON_SAID, 'yes', 21600); } catch (eY) { /* asked again next time */ }
    var out = env.data.answer || { ok: false, sent: false, gated: false, method: name, error: 'transport',
                                   detail: 'The platform\'s sender gave no answer — nothing was sent.' };
    out.python = true;
    return out;
  }
  var last = '';
  try { last = cache ? String(cache.get(RPC_PYTHON_SAID) || '') : ''; } catch (eL) { last = ''; }
  if (last === 'yes') {
    return { ok: false, sent: false, gated: false, python: true, method: name, error: 'transport',
             detail: 'The platform\'s sender did not answer (' + String((env && env.message) || 'no answer') +
                     ') — nothing was sent.' };
  }
  return null;
}

/** The `from_line` of the situation the reason names (else COMM_MOCK_CTX / HUB_REHEARSAL_CTX), or ''; never throws. */
function rpcSituationLine_(reason) {
  try {
    var sid = (typeof commMockSituationFrom_ === 'function') ? commMockSituationFrom_(reason) : '';
    if (!sid) {
      var mockCtx = (typeof COMM_MOCK_CTX !== 'undefined' && COMM_MOCK_CTX) ? COMM_MOCK_CTX : {};
      var rhCtx = (typeof HUB_REHEARSAL_CTX !== 'undefined' && HUB_REHEARSAL_CTX) ? HUB_REHEARSAL_CTX : {};
      sid = str_(mockCtx.situation) || str_(rhCtx.situation);
    }
    if (!sid || typeof smartSituations_ !== 'function') return '';
    var line = '';
    smartSituations_().forEach(function (s) { if (String(s.id) === sid) line = str_(s.from_line); });
    return line;
  } catch (e) { return ''; }
}

// The receipt this idempotency key already earned, or ''.
function rpcReceiptSeen_(key) {
  if (!key) return '';
  try {
    return String(CacheService.getScriptCache().get('rpc_' + key) || '');
  } catch (e) { return ''; }
}

// Parameters as they may safely be logged or returned: a body is content, a number is a person.
function rpcMaskTo_(v) {
  var s = String(v == null ? '' : v);
  return s.length > 4 ? '•••' + s.slice(-4) : '•••';
}

function rpcSafeParams_(p) {
  var out = {};
  for (var k in p) {
    if (!p.hasOwnProperty(k)) continue;
    // The secrets a message names so its records can withhold them are never echoed.
    if (k === 'withhold') continue;
    var v = String(p[k] == null ? '' : p[k]);
    if (p.withhold && (k === 'body' || k === 'subject')) v = hubWithhold_(v, p.withhold);
    if (k === 'to') out[k] = v.length > 4 ? '•••' + v.slice(-4) : '•••';
    else if (k === 'body') out[k] = v.slice(0, 80) + (v.length > 80 ? '…' : '');
    else out[k] = v.slice(0, 120);
  }
  return out;
}

/** The transport — the ONLY place that knows how a message leaves */

/** A stand-in transport, set ONLY by the self-test and cleared in its `finally`. */
var RPC_TEST_TRANSPORT = null;

/** Said once per execution, never once per message — see hubTestSharedSay_. */
var HUB_TEST_SHARED_SAID = false;

// THE REDIRECT SAYS WHAT IT IS POINTING AT, ONCE.
function hubTestSharedSay_(st) {
  if (HUB_TEST_SHARED_SAID) return;
  HUB_TEST_SHARED_SAID = true;
  try {
    var words = (typeof hubTestSharedWarning_ === 'function') ? hubTestSharedWarning_(st) : '';
    if (words) hubSysLog_('asa-hub:rpc', 'test_redirect_shared_line', words, { status: 200 });
  } catch (e) { /* the send stands */ }
}

// THE TWO LETTERS THAT ARE NOT MESSAGES — they carry a way IN.
var HUB_AUTH_LETTERS = {
  password_reset: 'PasswordReset.gs — the temporary password a locked-out person signs in with once',
  invitation: 'Invites.gs, CommRelease.gs and HubCore.gs — the letter an invited, released or newly ' +
              'provisioned person gets their way in with'
};

// The claimed kind if it is one this platform knows, else '' — which every gate reads as "no exemption", the state…
function hubAuthLetterKind_(claim) {
  var kind = String(claim == null ? '' : claim).trim();
  if (!kind) return '';
  return Object.prototype.hasOwnProperty.call(HUB_AUTH_LETTERS, kind) ? kind : '';
}

// THE KINDS WHOSE TEXT CARRIES A WAY IN TOO.
var HUB_AUTH_TEXTS = {
  password_reset: 'PasswordReset.gs — the temporary password, texted when the letter cannot reach the person'
};

/** The kind when its text may pass the dial, else ''. */
function hubAuthTextKind_(kind) {
  var k = hubAuthLetterKind_(kind);
  return (k && Object.prototype.hasOwnProperty.call(HUB_AUTH_TEXTS, k)) ? k : '';
}

// Said at the one moment a brake was stepped over, so the exemption is never a thing that happened quietly.
function hubAuthLetterSay_(kind, where, to) {
  try {
    hubSysLog_('asa-hub:rpc', 'auth_letter_passed',
               kind + ' at ' + where + ' → ' + rpcMaskTo_(to) +
               ' — an authentication letter is not held by the dial',
               { status: 200 });
  } catch (e) { /* the letter never waits on its own log line */ }
}

// ------------------------------------------------------------------ THE QUIET WINDOW — nobody is messaged…
var HUB_QUIET_FROM = '21:31';
var HUB_QUIET_TO = '08:00';
var HUB_QUIET_TZ = 'America/New_York';

// The self-test's clock, and nothing else's: an ISO instant while a check names the hour it is about, null…
var HUB_QUIET_NOW = null;

/** Said once per execution, never once per message (hubTestSharedSay_). */
var HUB_QUIET_SAID = false;

// WHAT A PERSON ASKED FOR AT THAT MOMENT — the only messages the window lets through besides the authentication…
var HUB_QUIET_EXEMPT = {
  sign_in: 'a letter that carries a way in — a login, a first password, a mailbox\'s credentials — ' +
           'sent at the moment a PERSON made, released or signed in to that account; never a sweep, ' +
           'which waits for 08:00 instead (Hired.gs onboardingByPerson_)',
  asked_now: 'the person who pressed the button is the one it reaches — a design preview to their ' +
             'own inbox, the report of a walk they just ran, a layout test run from the editor',
  by_hand: 'a letter a person wrote and sent by hand from the Mail app — a person speaking, not the ' +
           'platform notifying'
};

/** The claimed exemption if it is one this platform knows, else ''. */
function hubQuietExemptKind_(claim) {
  var kind = String(claim == null ? '' : claim).trim();
  if (!kind) return '';
  return Object.prototype.hasOwnProperty.call(HUB_QUIET_EXEMPT, kind) ? kind : '';
}

/** The instant the window is asked about: the self-test's named hour, or now. */
function hubQuietNow_() {
  if (HUB_QUIET_NOW) {
    var t = Date.parse(String(HUB_QUIET_NOW));
    if (!isNaN(t)) return new Date(t);
  }
  return new Date();
}

// Is this instant inside the quiet window, New York wall time?
function hubQuietAt_(when) {
  var hm = '';
  try { hm = Utilities.formatDate(when || hubQuietNow_(), HUB_QUIET_TZ, 'HH:mm'); }
  catch (e) { return false; }
  if (HUB_QUIET_FROM <= HUB_QUIET_TO) return hm >= HUB_QUIET_FROM && hm < HUB_QUIET_TO;
  return hm >= HUB_QUIET_FROM || hm < HUB_QUIET_TO;
}

/** "21:31–07:59 New York": the silent minutes, first and last, as said aloud. */
function hubQuietWords_() {
  var m = /^(\d{1,2}):(\d{2})$/.exec(HUB_QUIET_TO);
  var last = HUB_QUIET_TO;
  if (m) {
    var mins = (Number(m[1]) * 60 + Number(m[2]) + 1439) % 1440;
    last = ('0' + Math.floor(mins / 60)).slice(-2) + ':' + ('0' + (mins % 60)).slice(-2);
  }
  return HUB_QUIET_FROM + '–' + last + ' New York';
}

// DOES THE WINDOW HOLD THIS CALL?
function hubQuietHolds_(name, contract, params, opts, authKind) {
  if (!contract || !contract.reaches_a_person) return false;
  if (authKind) return false;
  if (hubQuietExemptKind_(opts && opts.quiet_exempt)) return false;
  if (!hubQuietAt_()) return false;
  // A ROW THAT WRITES INTO ITS OWN HOUSE REACHES NOBODY, at any hour: its message is a line in a list somebody…
  try {
    if (typeof commMockRecordHouse_ === 'function' && commMockRecordHouse_(name, params)) return false;
  } catch (eR) { /* an unreadable cell is not a house: the window holds it */ }
  return true;
}

/** The not-now: the shape of every other hold, plus the word that says it ends. */
function hubQuietAnswer_(name, params) {
  return { ok: true, sent: false, gated: true, quiet: true, redirected: false,
           method: String(name || ''), reason: 'quiet_hours',
           retry_after: HUB_QUIET_TO + ' ' + HUB_QUIET_TZ,
           detail: 'Inside the quiet window (' + hubQuietWords_() + '): nothing reaches a person ' +
                   'now. Ask again at ' + HUB_QUIET_TO + ', and say it then only if it is still true.',
           would_have: rpcSafeParams_(params || {}) };
}

// One line per execution the window held something in — the mock outbox has the messages themselves, one row each…
function hubQuietSay_(name) {
  if (HUB_QUIET_SAID) return;
  HUB_QUIET_SAID = true;
  try {
    hubSysLog_('asa-hub:rpc', 'rpc_quiet_held',
               String(name || '') + ' and every other message this execution tries before ' +
               HUB_QUIET_TO + ' — inside the quiet window (' + hubQuietWords_() + '); each is in ' +
               'the mock outbox as held_quiet, and nothing reached anybody',
               { status: 200 });
  } catch (e) { /* the hold stands without its log line */ }
}

// ------------------------------------------------------------------ THE MORNING LIST — what a one-shot page the…
var HUB_QUIET_OWED_PREFIX = 'HUB_QUIET_OWED|';
/* Per lane, and per entry, for a lane that keeps a page's words whole. */
var HUB_QUIET_OWED_MAX = 12;
var HUB_QUIET_OWED_BYTES = 6000;
var HUB_QUIET_OWED_HORIZON_MS = 36 * 3600 * 1000;
// A LANE THAT KEEPS FACTS, NOT WORDS, KEEPS MANY MORE.
var HUB_QUIET_OWED_LANES = {
  letter: { max: 100, bytes: 1500 },
  // an app announcement owed to the morning, ONE ENTRY PER APP: its id, the badges it is owed to, its title and…
  app_release: { max: 150, bytes: 3000 }
};

// How long one pass may spend carrying the morning list before it leaves the rest for the next pass (the relay…
var HUB_QUIET_CARRY_BUDGET_MS = 120000;

/** { max, bytes } for one lane. */
function hubQuietOwedLimits_(lane) {
  var l = HUB_QUIET_OWED_LANES[String(lane || '')] || {};
  return { max: Number(l.max) || HUB_QUIET_OWED_MAX, bytes: Number(l.bytes) || HUB_QUIET_OWED_BYTES };
}

// THE STORE, four doors the self-test stands in for: this lane's memory lives in the project's Script Properties…
function hubQuietOwedKeys_() {
  return PropertiesService.getScriptProperties().getKeys().filter(function (k) {
    return String(k).indexOf(HUB_QUIET_OWED_PREFIX) === 0;
  });
}
function hubQuietOwedGet_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function hubQuietOwedSet_(k, v) { PropertiesService.getScriptProperties().setProperty(k, v); }
function hubQuietOwedDel_(k) { PropertiesService.getScriptProperties().deleteProperty(k); }

// Runs `fn` under the script lock when it can be had, and without it when it cannot: a lost race costs one entry, a…
function hubQuietLocked_(fn) {
  var lock = null;
  try {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) lock = null;
  } catch (eL) { lock = null; }
  try { return fn(); }
  finally { if (lock) { try { lock.releaseLock(); } catch (eR) { /* the execution releases it */ } } }
}

/** The property name of one entry: the lane and its own key, made safe. */
function hubQuietOwedName_(lane, key) {
  return HUB_QUIET_OWED_PREFIX + String(lane || '').replace(/[^a-z_]/gi, '') + '|' +
         String(key || '').replace(/[^A-Za-z0-9:_.|@+-]/g, '_').slice(0, 180);
}

// ONE PAGE ONTO THE MORNING LIST.
function hubQuietOwe_(lane, key, data, at) {
  var name = hubQuietOwedName_(lane, key);
  var limits = hubQuietOwedLimits_(lane);
  var first = (at && !isNaN(Date.parse(String(at)))) ? String(at) : hubQuietNow_().toISOString();
  var body = '', refused = '';
  try {
    body = JSON.stringify({ lane: String(lane || ''), key: String(key || ''), at: first, data: data || {} });
  } catch (eJ) { refused = 'the page could not be written down (' + String((eJ && eJ.message) || eJ).slice(0, 80) + ')'; }
  if (!refused && body.length > limits.bytes) {
    refused = 'the page is ' + body.length + ' characters and the lane keeps ' + limits.bytes;
  }
  if (!refused) {
    refused = hubQuietLocked_(function () {
      try {
        if (hubQuietOwedGet_(name)) return '';
        var mine = hubQuietOwedKeys_().filter(function (k) {
          return k.indexOf(HUB_QUIET_OWED_PREFIX + String(lane || '') + '|') === 0;
        });
        if (mine.length >= limits.max) return 'the list already holds ' + limits.max + ' for this lane';
        hubQuietOwedSet_(name, body);
        return '';
      } catch (e) { return 'the list could not be written (' + String((e && e.message) || e).slice(0, 80) + ')'; }
    });
  }
  if (refused) {
    try {
      hubSysLog_('asa-hub:rpc', 'quiet_owed_refused',
                 'a ' + String(lane || '') + ' page the quiet window held could NOT be kept for the morning — ' +
                 refused + ' — it will not be said at ' + HUB_QUIET_TO, { status: 500 });
    } catch (eL) { /* the lane's own answer says it too */ }
  }
  return !refused;
}

// THE MORNING, FOR EVERY ONE-SHOT LANE.
function hubQuietOwedCarry_(lanes) {
  var out = { carried: 0, stale: 0, kept: 0, waiting: 0, why: [] };
  var names = [];
  try { names = hubQuietOwedKeys_(); } catch (eK) { return out; }
  if (!names.length) return out;
  if (hubQuietAt_()) { out.waiting = names.length; return out; }
  var nowMs = hubQuietNow_().getTime();
  // A BUDGET, CHECKED BEFORE EACH ENTRY IS TAKEN.
  var started = Date.now();
  names.forEach(function (name) {
    if (Date.now() - started >= HUB_QUIET_CARRY_BUDGET_MS) { out.waiting++; return; }
    var raw = hubQuietLocked_(function () {
      var got = null;
      try { got = hubQuietOwedGet_(name); hubQuietOwedDel_(name); } catch (eT) { got = null; }
      return got;
    });
    if (!raw) return;
    var entry = null;
    try { entry = JSON.parse(raw); } catch (eP) { entry = null; }
    var why = '', state = 'stale';
    var carrier = entry && lanes ? lanes[String(entry.lane || '')] : null;
    var atMs = entry ? Date.parse(String(entry.at || '')) : NaN;
    if (!entry) why = 'an entry that could not be read';
    else if (!isNaN(atMs) && nowMs - atMs > HUB_QUIET_OWED_HORIZON_MS) why = 'held more than a day and a half';
    else if (typeof carrier !== 'function') why = 'no carrier for the lane `' + String(entry.lane || '') + '`';
    else {
      try {
        var said = carrier(entry.data || {}, entry) || {};
        state = (said.state === 'carried' || said.state === 'kept') ? said.state : 'stale';
        why = String(said.why || '');
      } catch (eC) {
        why = 'the lane threw: ' + String((eC && eC.message) || eC);
      }
    }
    if (state === 'carried') out.carried++;
    else {
      if (state === 'kept') out.kept++;
      else out.stale++;
      if (out.why.length < 6) out.why.push(String((entry && entry.lane) || '?') + ': ' + why);
    }
  });
  try {
    hubSysLog_('asa-hub:rpc', 'quiet_owed_carried',
               out.carried + ' page(s) the quiet window held were said this morning · ' + out.stale +
               ' no longer true and let go' +
               // each entry's own why names the cause: a read that did not land, or a hold that ends
               (out.kept ? ' · ' + out.kept + ' kept for the next pass' : '') +
               (out.waiting ? ' · ' + out.waiting + ' left for the next pass (this pass\'s time budget)' : '') +
               (out.why.length ? ' (' + out.why.join(' · ') + ')' : ''),
               { status: 200 });
  } catch (eL) { /* the answer carries it */ }
  return out;
}

// TEST MODE — everything goes to the listed testers and to nobody else.
var HUB_SWITCH_UNREADABLE_WHY = '';

/** Said once per execution: a sweep that holds a hundred messages is one outage, not a hundred. */
var HUB_SWITCH_UNREADABLE_SAID = false;

/** Remember and say why the switch could not be read; returns the words. */
function hubSwitchUnreadable_(where, err) {
  var why = 'the send switch could not be read at ' + String(where || 'a door') + ': ' +
            String((err && err.message) || err || 'no reason given').slice(0, 200);
  HUB_SWITCH_UNREADABLE_WHY = why;
  if (HUB_SWITCH_UNREADABLE_SAID) return why;
  HUB_SWITCH_UNREADABLE_SAID = true;
  try {
    hubSysLog_('asa-hub:rpc', 'test_mode_unreadable',
               why + ' — this message and every other one this execution tries while the read ' +
               'keeps failing is HELD, not sent. An unreadable switch is not an off switch, so ' +
               'nothing leaves this platform until it can be read again.',
               { status: 502 });
  } catch (e2) { /* logging is not worth failing a hold over */ }
  return why;
}

/** A read that answered: the outage this execution saw earlier is over. */
function hubSwitchReadable_() {
  HUB_SWITCH_UNREADABLE_WHY = '';
}

/** The words of this execution's unreadable read, or ''. */
function hubSwitchUnreadableWhy_() {
  return String(HUB_SWITCH_UNREADABLE_WHY || '');
}

// A SECRET NEVER TRAVELS INTO A BOOK.
var HUB_WITHHELD_WORDS = '{withheld}';

function hubWithhold_(text, withhold) {
  var out = String(text == null ? '' : text);
  var list = Array.isArray(withhold) ? withhold : [withhold];
  list.forEach(function (secret) {
    var s = String(secret == null ? '' : secret);
    if (s.length >= 4) out = out.split(s).join(HUB_WITHHELD_WORDS);
  });
  return out;
}

/** The holding answer every transport reads as "write the row, send nothing". */
function hubSwitchHeldRedirect_(why) {
  return { sms: [], emails: [], sheet: true, unreadable: true, why: String(why || ''),
           testers_sms: [], testers_emails: [], shared: [] };
}

// AND NOW TEST MODE IS ONE SWITCH, AND ON MEANS NOTHING LEAVES.
function hubTestRedirect_() {
  try {
    var on = hubTestModeOn_();
    hubSwitchReadable_();
    if (!on) return null;
    var st = hubTestModeState_();
    return { sms: [], emails: [], sheet: true,
             testers_sms: (st && st.sms) || [], testers_emails: (st && st.emails) || [],
             shared: (st && st.shared) || [] };
  } catch (e) {
    return hubSwitchHeldRedirect_(hubSwitchUnreadable_('hubTestRedirect_', e));
  }
}

// The in-body rehearsal marker.
function hubTestBannerHtml_(realTo) {
  return '<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;' +
         'padding:10px 14px;margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;' +
         'font-size:13px;line-height:19px;color:#92400e;">' +
         '<strong>[TEST]</strong> Test mode is on — this rehearsal was redirected to you. ' +
         'The real recipient would have been <strong>' +
         String(realTo || 'the usual recipients').replace(/</g, '&lt;') + '</strong>.' +
         '</div>';
}

function hubTestBanner_(realTo) {
  var tpl = '';
  try { tpl = str_((typeof hiringAlerts_ === 'function' ? hiringAlerts_() : {}).test_banner); }
  catch (e) { tpl = ''; }
  if (!tpl) return '';
  return tpl.replace(/\{to\}/g, String(realTo || 'the usual recipients')) + '\n';
}

// ------------------------------------------------------------------ THE THIRD POSITION — the rehearsal writes a…
var HUB_REHEARSAL_WORDS = ['sheet', 'rehearsal', 'paper'];

// The house the rehearsal writes into.
var HUB_REHEARSAL_HOUSE = 'comm_rehearsal';

// The declared header, in the mint's order (tools/mint_rehearsal_out_house.py).
var HUB_REHEARSAL_HEADER = [
  'id', 'createdAt', 'updatedAt',
  'pass_id', 'pass_at', 'pass_by', 'seq',
  'intent_key', 'person_key', 'person_name',
  'channel', 'to_masked', 'redirected', 'redirect_to_masked',
  'situation', 'purpose', 'words_sha', 'sender_used', 'from_account',
  'subject', 'body', 'body_chars',
  'would_have_sent', 'verdict', 'reasons', 'consent', 'window', 'attempt',
  'dial', 'at', 'test_mode', 'tenant'
];

// THE FLOOR: the newest passes that stand whatever else is true — the number the mint declares…
var HUB_REHEARSAL_PASSES_KEPT = 10;

// AND THE CEILING, IN ROWS, BECAUSE A PASS IS NO LONGER ONE SIZE.
var HUB_REHEARSAL_ROWS_KEPT = 2000;

// AND THE SHIFT FLOW KEEPS ITS OWN BUDGET BESIDE IT.
var HUB_REHEARSAL_SHIFT_ROWS_KEPT = 2500;
var HUB_REHEARSAL_SHIFT_PASS_BY = 'asa-hub:staffalerts';

// WHAT THE LANE KNOWS AND THE DOOR DOES NOT.
var HUB_REHEARSAL_CTX = null;

/** The pass, minted once per execution when the lane does not name one. */
var HUB_REHEARSAL_PASS = null;

/** Retirement runs once per execution, not once per row. */
var HUB_REHEARSAL_TRIMMED = false;

/** The sequence inside a pass, when the lane does not count for us. */
var HUB_REHEARSAL_SEQ = 0;

// Is test mode on — in ANY of its on positions?
function hubRehearsalToSheet_() {
  try {
    var on = hubTestModeOn_();
    hubSwitchReadable_();
    return on;
  } catch (e) { hubSwitchUnreadable_('hubRehearsalToSheet_', e); return true; }
}

// THE ONE SWITCH, READ — true when test mode is on in any position, false when it is off.
function hubTestModeOn_(cfg) {
  var c = cfg || hiringAlerts_();
  var st = hubTestModeState_(c);
  // FAIL-CLOSED: a word the reader does not know is a switch that cannot be read — every reader holds on the throw…
  if (st.unrecognized) throw new Error(hubTestModeUnknownWhy_(st.unrecognized));
  return !!st.on;
}

/** The lane's context for this one message, or {}. */
function hubRehearsalCtx_() {
  return (typeof HUB_REHEARSAL_CTX !== 'undefined' && HUB_REHEARSAL_CTX) ? HUB_REHEARSAL_CTX : {};
}

// THE PASS.
function hubRehearsalPassId_() {
  var said = str_(hubRehearsalCtx_().pass_id);
  if (said) return said;
  if (HUB_REHEARSAL_PASS) return HUB_REHEARSAL_PASS;
  HUB_REHEARSAL_PASS = 'RHP_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14) +
                       '_' + Utilities.getUuid().slice(0, 6);
  // WHICH BRAKE OPENED IT.
  try {
    hubSysLog_('asa-hub:rpc', 'rehearsal_pass_opened',
               HUB_REHEARSAL_PASS + ' — ' +
               (hubRehearsalToSheet_()
                 ? 'the test dial is at the sheet; nothing leaves this platform until it says ' +
                   'on or off again'
                 : 'a lane held its own message and wrote the words down instead; the sending ' +
                   'dial is what decides whether they leave'),
               { status: 200 });
  } catch (eL) { /* the pass stands */ }
  return HUB_REHEARSAL_PASS;
}

// The row's own name: one message in one pass.
function hubRehearsalId_(pass, key, channel) {
  var seed = String(pass) + '|' + String(key) + '|' + String(channel);
  var hex = '';
  try {
    hex = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, seed)
      .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('').slice(0, 12);
  } catch (e) { hex = String(seed.length) + String(new Date().getTime()); }
  return 'CRH_' + hex;
}

// The destination, under the platform's own recipe — the same one commMask_ and rpcMaskTo_ use.
function hubRehearsalMask_(v) {
  var parts = String(v == null ? '' : v).split(/[,;]+/)
    .map(function (x) { return String(x).trim(); })
    .filter(function (x) { return !!x; });
  if (!parts.length) return '';
  var head = rpcMaskTo_(parts[0]);
  return parts.length > 1 ? head + ' +' + (parts.length - 1) + ' more' : head;
}

// THE ROW — what would have been said, to whom, under what, and why.
function hubRehearsalRow_(msg) {
  var ctx = hubRehearsalCtx_();
  var nowIso = new Date().toISOString();
  var pass = hubRehearsalPassId_();
  // The reason line of the comms lane IS two of these columns, spelled as a sentence.
  var reason = str_(msg.reason);
  var lane = /^comms:\s*([^·]+)·\s*(.+)$/.exec(reason);
  var situation = str_(ctx.situation) || (lane ? lane[1].trim() : '');
  var intentKey = str_(ctx.intent_key) || (lane ? lane[2].trim() : '');
  // TWO BOOKS ABOUT ONE MOMENT MUST NOT DISAGREE.
  if (!situation && typeof commMockSituationFrom_ === 'function') {
    try { situation = str_(commMockSituationFrom_(reason)); } catch (eSit) { /* stays blank */ }
  }
  var body = str_(msg.body);
  var redir = null;
  try { redir = hubTestRedirect_(); } catch (eR) { redir = null; }
  // WHERE TEST MODE WOULD HAVE SENT IT, IN EITHER OF ITS POSITIONS.
  var wouldRedirect = msg.channel === 'email'
    ? (((redir && (redir.testers_emails || redir.emails)) || []).join(','))
    : (((redir && (redir.testers_sms || redir.sms)) || []).join(','));
  var seq = ctx.seq;
  if (seq === undefined || seq === null || seq === '') { HUB_REHEARSAL_SEQ++; seq = HUB_REHEARSAL_SEQ; }
  var sending = false;
  try { sending = rpcSendEnabled_(); } catch (eS) { sending = false; }
  // THE DIAL IS A REASON, NOT JUST A COLUMN.
  var dialWord = '';
  try { dialWord = (typeof commDial_ === 'function') ? String(commDial_()) : ''; }
  catch (eD) { dialWord = ''; }
  var handsOver = !dialWord || dialWord === 'send';
  var reasons = str_(ctx.reasons);
  if (!sending) reasons = (reasons ? reasons + ' · ' : '') + 'HUB_RPC_SEND is off';
  if (dialWord && !handsOver) {
    reasons = (reasons ? reasons + ' · ' : '') +
              'the sending dial stands at `' + dialWord + '`, not `send`';
  }
  return {
    id: hubRehearsalId_(pass, intentKey || (str_(msg.to) + '|' + str_(msg.subject) + '|' + body.slice(0, 40)), msg.channel),
    pass_id: pass,
    pass_at: nowIso,
    pass_by: str_(ctx.pass_by) || 'asa-hub:rehearsal',
    seq: seq,
    intent_key: intentKey,
    person_key: str_(ctx.person_key),
    // AND THE NAME THE SAME WAY.
    person_name: str_(ctx.person_name) || (function () {
      if (!situation || typeof commMockPersonFrom_ !== 'function') return '';
      try { return str_(commMockPersonFrom_(situation, msg)); } catch (ePer) { return ''; }
    })(),
    channel: str_(msg.channel),
    to_masked: hubRehearsalMask_(msg.to),
    // WHAT TEST MODE WOULD HAVE DONE WITH IT.
    redirected: wouldRedirect ? 'yes' : 'no',
    redirect_to_masked: hubRehearsalMask_(wouldRedirect),
    situation: situation,
    purpose: str_(ctx.purpose),
    words_sha: str_(ctx.words_sha),
    sender_used: str_(ctx.sender_used),
    from_account: str_(msg.from_account),
    subject: str_(msg.subject),
    body: body,
    // A 0 beside a named situation is a template that rendered to nothing — an empty cell and a cell that failed to…
    body_chars: body.length,
    would_have_sent: (sending && handsOver) ? 'yes' : 'no',
    verdict: str_(ctx.verdict),
    reasons: reasons,
    consent: str_(ctx.consent),
    window: str_(ctx.window),
    attempt: (ctx.attempt === undefined || ctx.attempt === null) ? '' : String(ctx.attempt),
    dial: dialWord,
    at: nowIso,
    // WHICH BRAKE PRODUCED THIS ROW.
    test_mode: str_(ctx.test_mode) || 'sheet',
    tenant: (function () {
      try { return (typeof tenantStamp_ === 'function') ? String(tenantStamp_() || '') : ''; }
      catch (eT) { return ''; }
    })()
  };
}

/** Upsert by the column literally named `id`, the row engine's own key. */
function hubRehearsalWrite_(row) {
  var sheet = hubTabEnsure_(HUB_REHEARSAL_HOUSE, HUB_REHEARSAL_HEADER);
  var nowIso = new Date().toISOString();
  var found = findRowIndex_(sheet, row.id);
  row.updatedAt = nowIso;
  if (!found) row.createdAt = nowIso;
  var header = ensureHeader_(sheet, HUB_REHEARSAL_HEADER);
  if (!found) {
    sheet.appendRow(header.map(function (h) { return serialize_(row[h]); }));
  } else {
    var range = sheet.getRange(found, 1, 1, header.length);
    var existing = range.getValues()[0];
    range.setValues([header.map(function (h, i) {
      return Object.prototype.hasOwnProperty.call(row, h) ? serialize_(row[h]) : existing[i];
    })]);
  }
  hubRehearsalTrim_(sheet);
  return row.id;
}

// RETIREMENT, BY PASS AND NEVER BY ROW.
function hubRehearsalTrim_(sheet) {
  if (HUB_REHEARSAL_TRIMMED) return;
  HUB_REHEARSAL_TRIMMED = true;
  try {
    var last = sheet.getLastRow();
    if (last < 2) return;
    var header = headerOf_(sheet);
    var col = header.indexOf('pass_id') + 1;
    if (!col) return;
    var vals = sheet.getRange(2, col, last - 1, 1).getValues();
    // WHO WROTE EACH PASS — the shift flow's are budgeted apart.
    var byCol = header.indexOf('pass_by') + 1;
    var byVals = byCol ? sheet.getRange(2, byCol, last - 1, 1).getValues() : null;
    var order = [], seen = {}, rowsIn = {}, shiftPass = {};
    for (var i = 0; i < vals.length; i++) {
      var p = String(vals[i][0] || '');
      if (!p) continue;
      if (!seen[p]) { seen[p] = true; order.push(p); rowsIn[p] = 0; }
      rowsIn[p]++;
      if (byVals && String(byVals[i][0] || '') === HUB_REHEARSAL_SHIFT_PASS_BY) shiftPass[p] = true;
    }
    // WHAT STANDS: the newest passes, whole, while their pool's budget lasts — and the newest few of each pool…
    var keep = {};
    var pools = { other: { kept: 0, spent: 0, full: false, budget: HUB_REHEARSAL_ROWS_KEPT },
                  shift: { kept: 0, spent: 0, full: false, budget: HUB_REHEARSAL_SHIFT_ROWS_KEPT } };
    for (var k = order.length - 1; k >= 0; k--) {
      var pool = pools[shiftPass[order[k]] ? 'shift' : 'other'];
      if (pool.full) continue;
      if (pool.kept < HUB_REHEARSAL_PASSES_KEPT || pool.spent + rowsIn[order[k]] <= pool.budget) {
        keep[order[k]] = true;
        pool.kept++;
        pool.spent += rowsIn[order[k]];
        continue;
      }
      pool.full = true;                              // everything older in this pool goes with it
    }
    var doomed = {};
    order.forEach(function (p) { if (!keep[p]) doomed[p] = true; });
    if (!Object.keys(doomed).length) return;
    // Bottom-up, in contiguous blocks: deleting downwards would move every row still to be looked at.
    var run = 0;
    for (var r = vals.length; r >= 1; r--) {
      if (doomed[String(vals[r - 1][0] || '')]) { run++; continue; }
      if (run) { sheet.deleteRows(r + 2, run); run = 0; }
    }
    if (run) sheet.deleteRows(2, run);
  } catch (e) {
    try {
      hubSysLog_('asa-hub:rpc', 'rehearsal_trim_failed', String((e && e.message) || e), { status: 200 });
    } catch (eL) { /* the rows stand; the house grows until the next pass */ }
  }
}

// THE ANSWER A REHEARSED MESSAGE GIVES BACK, and why it is this one.
function hubRehearsalAnswer_(name, rowId, recorded) {
  var out = { ok: true, sent: false, gated: true, redirected: false, receipt: '',
              method: String(name || ''), rehearsed: true, reason: 'rehearsal_sheet',
              rehearsal_row: String(rowId || ''), rehearsal_recorded: !!recorded,
              detail: recorded
                ? 'The dial is at the sheet: this message was written into ' +
                  HUB_REHEARSAL_HOUSE + ' and sent to nobody.'
                : 'The dial is at the sheet: nothing was sent, and the row could NOT be ' +
                  'written — the words of this message are lost.' };
  return out;
}

// THE ONE ENTRY POINT.
function hubRehearsalSend_(name, msg) {
  var rowId = '', recorded = false;
  try {
    var row = hubRehearsalRow_(msg || {});
    rowId = hubRehearsalWrite_(row);
    recorded = true;
  } catch (e) {
    try {
      hubSysLog_('asa-hub:rpc', 'rehearsal_row_lost',
                 String(name || '') + ' → ' + hubRehearsalMask_(msg && msg.to) + ': ' +
                 String((e && e.message) || e),
                 { status: 502 });
    } catch (eL) { /* the message was still not sent, which is the part that matters */ }
  }
  return hubRehearsalAnswer_(name, rowId, recorded);
}

// THE SAME BOOK, WRITTEN BY A LANE THAT HELD ITS OWN MESSAGE.
function hubRehearsalNote_(msg) {
  try { return hubRehearsalWrite_(hubRehearsalRow_(msg || {})); }
  catch (e) {
    try {
      hubSysLog_('asa-hub:rpc', 'rehearsal_row_lost',
                 'held by the dial → ' + hubRehearsalMask_(msg && msg.to) + ': ' +
                 String((e && e.message) || e), { status: 502 });
    } catch (eL) { /* nothing was sent either way, which is the part that matters */ }
    return '';
  }
}

// WHAT A LANE HANDS OVER WHEN THE DIAL HELD ITS MESSAGE — the book's own context, set and put back, so a lane…
function hubRehearsalHeld_(what) {
  var w = what || {};
  var held = (typeof HUB_REHEARSAL_CTX !== 'undefined') ? HUB_REHEARSAL_CTX : null;
  var testWord = 'off';
  try { testWord = (typeof commTestMode_ === 'function' && commTestMode_()) ? 'on' : 'off'; }
  catch (eT) { testWord = 'off'; }
  var id = '';
  try {
    HUB_REHEARSAL_CTX = {
      pass_id: str_(w.pass_id), pass_by: str_(w.pass_by) || 'asa-hub:held-by-the-dial',
      seq: w.seq, intent_key: str_(w.intent_key),
      person_key: str_(w.person_key), person_name: str_(w.person_name),
      situation: str_(w.situation), purpose: str_(w.purpose),
      sender_used: str_(w.sender_used), verdict: str_(w.verdict), reasons: str_(w.reasons),
      consent: str_(w.consent), window: str_(w.window), attempt: w.attempt,
      test_mode: testWord
    };
    id = hubRehearsalNote_({ channel: str_(w.channel) || 'sms', to: str_(w.to),
                             subject: str_(w.subject), body: str_(w.body),
                             from_account: str_(w.from_account), reason: str_(w.reason) });
  } finally {
    HUB_REHEARSAL_CTX = held;
  }
  // THE MOCK OUTBOX'S ROW — after the rehearsal's, and whether or not that one landed: the two books are written…
  try {
    if (typeof commMockHeld_ === 'function') {
      var heldBy = str_(w.held_by);
      if (!heldBy) {
        var dialNow = '';
        try { dialNow = (typeof commDial_ === 'function') ? String(commDial_() || '') : ''; }
        catch (eD) { dialNow = ''; }
        heldBy = 'the sending dial stands at `' + (dialNow || 'off') + '`, not `send`';
      }
      commMockHeld_(w, heldBy);
    }
  } catch (eM) { /* the mock is never worth a message */ }
  return id;
}

// What the transport holds for each declared method, at the moment the words still exist.
function hubRehearsalMsgFor_(name, params) {
  var p = params || {};
  // The row proves the words were rendered; it does not have to carry a credential into a house the mirror copies…
  var scrub = hubSecretScrub_;
  var subj = scrub(hubWithhold_(str_(p.subject), p.withhold));
  var words = scrub(hubWithhold_(str_(p.body), p.withhold));
  if (name === 'emailSend') {
    return { channel: 'email', to: str_(p.to), subject: subj, body: words,
             from_account: str_(p.from_account), reason: str_(p.reason), method: name };
  }
  if (name === 'teamAlert') {
    // One message to a distribution, not to a person: the channel says so, and `to` is whoever Settings names plus…
    return { channel: 'team', to: str_(p.to), subject: subj, body: words,
             reason: str_(p.reason), method: name };
  }
  if (name === 'packetRequest') {
    return { channel: 'sms', to: str_(p.to), subject: '', body: scrub(rpcPacketMessage_(p)),
             reason: 'hiring: the New Hire packet request', method: name };
  }
  return { channel: 'sms', to: str_(p.to), subject: '', body: words,
           reason: str_(p.reason), method: name };
}

// The only function that acts.
function rpcSend_(name, contract, params) {
  if (RPC_TEST_TRANSPORT) return RPC_TEST_TRANSPORT(name, params);
  // THE EXEMPTION IS ASKED AGAIN HERE, for the same reason the two brakes below are: this function is reachable on…
  var authKind = (typeof hubAuthLetterKind_ === 'function')
    ? hubAuthLetterKind_(params && params.auth_letter) : '';
  if (authKind && name === 'smsSend' && !hubAuthTextKind_(authKind)) authKind = '';
  // THE GATE BELONGS HERE TOO.
  if (!rpcSendEnabled_() && !authKind) {
    return { ok: true, sent: false, gated: true, method: name,
             reason: 'HUB_RPC_SEND is off' };
  }
  // Everything leaves through here, so the test redirect is applied here and at no call site.
  var redir = authKind ? null : hubTestRedirect_();

  // THE SHEET POSITION, ASKED AGAIN AT THE TRANSPORT.
  if (redir && redir.sheet) {
    return hubRehearsalSend_(name, hubRehearsalMsgFor_(name, params));
  }

  if (name === 'smsSend' || name === 'packetRequest') {
    var body = name === 'packetRequest' ? rpcPacketMessage_(params) : str_(params.body);
    var smsTo = str_(params.to);
    // '' is Automations; a rehearsal leaves from the same line the real one would
    var fromLine = name === 'smsSend' ? str_(params.from_line) : '';
    if (redir) {
      if (!redir.sms.length) {
        return { ok: false, sent: false, gated: false, method: name, error: 'test_redirect_no_sms',
                 detail: 'test mode is on and no tester is listed for SMS — ' +
                         'refusing to fall back to the real recipient' };
      }
      // A secret the text carries belongs to its owner, never to the testers reading the rehearsal.
      body = hubTestBanner_(smsTo) + (params.withhold ? hubWithhold_(body, params.withhold) : body);
      var fan = rpcFanOutSms_(name, redir.sms, body, fromLine);
      fan.redirected = true;
      return fan;
    }
    return rpcOpenPhoneSms_(smsTo, body, fromLine, name === 'smsSend' ? authKind : '');
  }
  if (name === 'emailSend') {
    var mailTo = str_(params.to), mailBody = str_(params.body), subject = str_(params.subject);
    // The copy list travels only on a REAL delivery.
    var mailCc = str_(params.cc);
    if (redir) mailCc = '';
    if (redir) {
      if (!redir.emails.length) {
        return { ok: false, sent: false, gated: false, method: name, error: 'test_redirect_no_email',
                 detail: 'test mode is on and no tester is listed for e-mail — ' +
                         'refusing to fall back to the real recipient' };
      }
      // The configured banner is OFF by default, and the html strip travels only when html does — so a plain letter…
      var plainMark = hubTestBanner_(mailTo);
      if (!plainMark) plainMark = '[TEST] Redirected to you. The real recipient would have been ' + mailTo + '.\n\n';
      // A secret the letter carries (a password, a link in) belongs to its owner, never to the testers.
      if (params.withhold) {
        mailBody = hubWithhold_(mailBody, params.withhold);
        subject = hubWithhold_(subject, params.withhold);
      }
      mailBody = plainMark + mailBody;
      // The marker lives in the SUBJECT, not the body: it stops a forwarded screenshot reading as a real…
      subject = '[TEST] ' + subject;
      // One call, every tester: MailApp takes a comma-separated list, so all testers read the same message in the…
      mailTo = redir.emails.join(',');
    }
    // SMTP-first through the platform's own mailbox (asa-hub@asaop.org), MailApp when it is not wired — the…
    var mailHtml = str_(params.html);
    if (redir && mailHtml) {
      mailHtml = hubTestBannerHtml_(str_(params.to)) +
                 (params.withhold ? hubWithhold_(mailHtml, params.withhold) : mailHtml);
    }
    // THE KIND TRAVELS THE LAST STEP TOO.
    var mailLedger = authKind ? { auth_letter: authKind, lane: 'rpc', reason: str_(params.reason) } : null;
    // A secret the letter names reaches the person and never the mail log.
    if (params.withhold) {
      mailLedger = mailLedger || { lane: 'rpc', reason: str_(params.reason) };
      mailLedger.withhold = params.withhold;
    }
    var out = platformMailOut_(mailTo, subject, mailBody, mailHtml,
                               str_(params.from_account), mailCc, mailLedger);
    // THE TRANSPORT'S OWN ANSWER, not a constant.
    return { ok: true, sent: !!(out && out.sent), gated: false, method: name,
             receipt: (out && out.receipt) || '', rehearsed: !!(out && out.rehearsed),
             redirected: !!redir, cc: mailCc };
  }
  if (name === 'teamAlert') {
    // hubTeamNotify_ swallows every failure it meets, so "it returned" is not "it sent" — count what it reached…
    var extra = str_(params.to).split(/[,;]+/).map(function (x) { return x.trim(); })
      .filter(String);
    // In test mode the team alert reaches the tester and nobody else — the extra list is discarded rather than…
    var mailParam = (str_(params.html) || str_(params.mail_text))
      ? { text: str_(params.mail_text) || str_(params.body), html: str_(params.html) } : null;
    // THE LEGS A SITUATION ROW NAMES: a leg it leaves out is not sent.
    if (str_(params.legs)) {
      mailParam = mailParam || { text: '', html: '' };
      mailParam.legs = str_(params.legs).split(/[,;|\s]+/).map(function (x) { return x.trim(); }).filter(String);
    }
    var reach = hubTeamNotify_(str_(params.body).length ? str_(params.subject) : str_(params.subject),
                               redir ? hubTestBanner_('the hiring team') + str_(params.body) : str_(params.body),
                               redir ? [] : extra, mailParam);
    var got = (reach && (reach.sms + reach.email)) || 0;
    if (!got) {
      return { ok: false, sent: false, gated: false, method: name,
               error: 'no_recipient_reached',
               detail: 'neither an SMS nor an e-mail reached anybody' };
    }
    return { ok: true, sent: true, gated: false, method: name,
             redirected: !!redir,
             receipt: 'team:' + reach.sms + 'sms+' + reach.email + 'email' };
  }
  return { ok: false, sent: false, gated: false, method: name,
           error: 'no_transport', detail: 'Declared but nothing carries it yet.' };
}

// The packet request's situation row (hiring_packet_request), or {} — the TEXT source since the Smart Comms move.
function rpcPacketSituation_() {
  var sit = null;
  try {
    var sid = commSituationId_('hiring.packet.request', 'hiring_packet_request');
    smartSituations_().forEach(function (s) {
      if (str_(s.id) === sid) sit = s;
    });
  } catch (e) { sit = null; }
  return sit || {};
}

// The packet e-mail wording.
function rpcPacketEmail_(params) {
  var vars = { name: str_(params.name) };
  var sit = rpcPacketSituation_();
  var subject = hiringRenderMail_(str_(sit.email_subject) ||
    'Your signed New Hire packet — ASA Lifecare', vars);
  var body = hiringRenderMail_(str_(sit.email_text) ||
    ('Hi DSP,\n\n' +
     'To finish your onboarding we still need your signed New Hire packet.\n' +
     'Please check your inbox for your New Hire packet and complete it.\n\n' +
     'ASA Lifecare'), vars);
  return {
    subject: subject,
    body: body,
    html: packetRequestEmail_({ subject: subject, bodyText: body }).html
  };
}

/** The packet SMS wording, same source and fallback as the e-mail. */
function rpcPacketMessage_(params) {
  // NO NAME IN THE DEFAULT — the wording says DSP and never the person's name, though {name} still renders for…
  var sit = rpcPacketSituation_();
  return hiringRenderMail_(str_(sit.sms_text) ||
    ('Hi DSP, this is ASA Lifecare. To finish your onboarding we still need your ' +
     'signed New Hire packet. Please check your inbox for your New Hire packet and complete it.'),
    { name: str_(params.name) });
}

// The line we send FROM, cached for the execution: it is the same for every recipient and does not change mid-run.
var RPC_SENDER_LINE = null;
/** Other named lines, cached per execution. */
var RPC_SENDER_LINES = {};
/** The line every message leaves from unless its situation names another. */
var RPC_DEFAULT_LINE_NAME = 'Automations';

/** The line to send from; an unknown name refuses rather than falling back to Automations. */
function rpcSenderLine_(apiKey, fromLine) {
  var want = str_(fromLine);
  if (!want && RPC_SENDER_LINE) return RPC_SENDER_LINE;
  if (want && RPC_SENDER_LINES[want]) return RPC_SENDER_LINES[want];
  var lines = UrlFetchApp.fetch('https://api.openphone.com/v1/phone-numbers',
    { headers: { Authorization: apiKey }, muteHttpExceptions: true });
  if (lines.getResponseCode() !== 200) {
    return { error: 'provider_' + lines.getResponseCode(),
             detail: 'The provider would not list our lines, so there is no number to send from.' };
  }
  var picked = rpcSenderPick_((JSON.parse(lines.getContentText()) || {}).data || [], want);
  if (picked.error) return picked;
  if (want) RPC_SENDER_LINES[want] = picked;
  else RPC_SENDER_LINE = picked;
  return picked;
}

/** The pick without I/O — { from, userId, line } or { error, detail }; matched by hubLineSenderMatch_. */
function rpcSenderPick_(data, want) {
  var w = str_(want);
  var hit = null;
  if (!w) {
    (data || []).forEach(function (p) {
      if (String(p && p.name) === RPC_DEFAULT_LINE_NAME) hit = p;
    });
    if (!hit) {
      return { error: 'no_sending_line',
               detail: 'No line named "' + RPC_DEFAULT_LINE_NAME + '" — nothing to send from.' };
    }
  } else {
    var m = (typeof hubLineSenderMatch_ === 'function') ? hubLineSenderMatch_(data, w)
      : { line: null, why: 'the line directory is not in this build' };
    if (!m.line) {
      return { error: 'no_sending_line',
               detail: 'The situation says it sends from "' + w + '" and ' + m.why +
                       ' — nothing was sent. Blank the "Sends from" cell to send from ' +
                       RPC_DEFAULT_LINE_NAME + '.' };
    }
    hit = m.line;
  }
  var userId = (hit.users && hit.users[0]) ? str_(hit.users[0].id) : '';
  return { from: str_(hit.number), userId: userId, line: w || RPC_DEFAULT_LINE_NAME };
}

/** ONE logical message, SEVERAL testers. */
function rpcFanOutSms_(name, list, body, fromLine) {
  var ok = 0, ids = [], last = null;
  for (var i = 0; i < list.length; i++) {
    var r = rpcOpenPhoneSms_(list[i], body, fromLine);
    last = r;
    if (r.ok && r.sent) { ok++; ids.push(str_(r.receipt)); }
    else {
      hubSysLog_('asa-hub:rpc', 'rpc_test_fanout_failed',
                 name + ' → •••' + String(list[i]).slice(-4) + ': ' + str_(r.error),
                 { status: 502 });
    }
  }
  if (!ok) {
    return last || { ok: false, sent: false, gated: false, method: name,
                     error: 'test_redirect_no_sms', detail: 'no tester to send to' };
  }
  return { ok: true, sent: true, gated: false, method: name,
           receipt: ids.join(',') + ' [' + ok + '/' + list.length + ' testers]' };
}

// One SMS through the provider, with the answer actually checked — the old path fired and assumed, so a 4xx looked…
function rpcSmsSinkPlan_(to, body, redir) {
  if (!redir) return { pass: true };
  // THE SHEET POSITION IS A REFUSAL HERE, not a fan-out: there is no tester to fan out to, and the caller that…
  if (redir.sheet) {
    return { refuse: hubRehearsalSend_('sms', { channel: 'sms', to: to, subject: '', body: body }) };
  }
  var mine = String(to || '').replace(/\D/g, '').slice(-10);
  var isTester = (redir.sms || []).some(function (n) {
    return String(n).replace(/\D/g, '').slice(-10) === mine;
  });
  if (isTester) return { pass: true };
  if (!(redir.sms || []).length) {
    return { refuse: { ok: false, sent: false, gated: false, error: 'test_redirect_no_sms',
                       detail: 'test mode is on and no tester is listed for SMS — ' +
                               'refusing to fall back to the real recipient' } };
  }
  var mark = '';
  try { mark = (typeof hubTestBanner_ === 'function') ? hubTestBanner_(to) : ''; } catch (eB) { mark = ''; }
  if (!mark) mark = '[TEST for ' + String(to || '') + '] ';
  return { fan: redir.sms.slice(), body: mark + String(body || '') };
}

function rpcOpenPhoneSms_(to, body, fromLine, authKind) {
  // the one text that carries a way in (HUB_AUTH_TEXTS) is not sunk; everything else asks the dial again here
  var plan = hubAuthTextKind_(authKind) ? { pass: true } : rpcSmsSinkPlan_(to, body, hubTestRedirect_());
  if (plan.refuse) return plan.refuse;
  if (plan.fan) {
    var fan = rpcFanOutSms_('sms', plan.fan, plan.body, fromLine);
    fan.redirected = true;
    return fan;
  }
  var apiKey = hubProp_(typeof SCRAPER_OPENPHONE_PROP !== 'undefined' ? SCRAPER_OPENPHONE_PROP : 'OPENPHONE_API_KEY');
  if (!apiKey) {
    return { ok: false, sent: false, gated: false, error: 'no_provider_key',
             detail: 'No OPENPHONE_API_KEY in Script Properties.' };
  }
  var line = rpcSenderLine_(apiKey, fromLine);
  if (line.error) {
    return { ok: false, sent: false, gated: false, error: line.error, detail: line.detail };
  }
  var from = line.from, senderUserId = line.userId;
  var payload = { content: body, from: from, to: [to] };
  if (senderUserId) payload.userId = senderUserId;
  var res = UrlFetchApp.fetch('https://api.openphone.com/v1/messages', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: apiKey },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  return rpcProviderVerdict_(res.getResponseCode(), res.getContentText());
}

/** Did the provider actually take the message? */
function rpcProviderVerdict_(code, text) {
  if (code >= 400) {
    // The provider's own sentence is NOT carried up: its validation errors quote the rejected number, and `detail`…
    return { ok: false, sent: false, gated: false, error: 'provider_' + code,
             detail: 'the provider refused with ' + code };
  }
  var id = '';
  try {
    var body = JSON.parse(String(text || ''));
    id = str_(body && body.data && body.data.id);
  } catch (e) { id = ''; }
  if (!id) {
    return { ok: false, sent: false, gated: false, error: 'provider_bad_shape',
             detail: 'the provider answered ' + code + ' with no message id — ' +
                     'nothing here proves anything was sent' };
  }
  return { ok: true, sent: true, gated: false, receipt: id };
}

/** Introspection — the module says what it can do */

HUB_POLICY.rpcAbilities = {
  file: 'Rpc.gs', lane: 'read', store: 'json', idempotent: true,
  cost: 'instant', roles: ['admin'], invalidates: [], emits: []
};
// Report what this platform can send, derived from the contracts — never a second list kept beside them.
HUB_ACTIONS.rpcAbilities = function (payload, user) {
  if (!user || (String(user.role) !== 'admin' && !user.is_service)) return hubDenied_();
  var out = {};
  // WHAT THE SWITCH DOES NOT GOVERN: nothing now.
  var ungoverned = [];
  for (var k in HUB_RPC) {
    if (!HUB_RPC.hasOwnProperty(k)) continue;
    var c = HUB_RPC[k];
    out[k] = { channel: c.channel, what: c.what,
               reaches_a_person: c.reaches_a_person === true,
               required: Object.keys(c.params || {}).filter(function (p) {
                 return c.params[p].required;
               }) };
  }
  // Test mode belongs in the answer to "what can this platform send": it is the difference between reaching an…
  var tm = { on: false, sms: 0, emails: 0, dropped: [], shared: [] };
  var sharedWarning = '';
  try {
    var st = hubTestModeState_();
    // THE SHARED LINES ARE NAMED, NOT COUNTED.
    tm = { on: st.on, sms: st.sms.length, emails: st.emails.length,
           dropped: st.dropped, shared: st.shared };
    sharedWarning = hubTestSharedWarning_(st);
  } catch (eT) { tm.unreadable = true; }
  // WHICH POSITION THE DIAL IS IN.
  var toSheet = hubRehearsalToSheet_();
  var unreadableWhy = hubSwitchUnreadableWhy_();
  if (unreadableWhy) tm.unreadable = true;
  tm.position = tm.unreadable ? 'unreadable' : (toSheet ? 'sheet' : (tm.on ? 'testers' : 'production'));
  if (toSheet) tm.on = true;
  return { status: 200, data: {
    sending: rpcSendEnabled_() ? 'on' : 'off',
    // Counts, not the list — the numbers belong on the screen where an admin typed them.
    test_mode: tm,
    // ANYWHERE THE PLATFORM REPORTS ITS OWN TEST STATE INCLUDES THIS ONE.
    test_mode_note: (tm.unreadable
      ? 'THE SWITCH COULD NOT BE READ — every message below is HELD, written into the ' +
        HUB_REHEARSAL_HOUSE + ' house and sent to nobody, until the configuration answers again' +
        (unreadableWhy ? ' (' + unreadableWhy + ')' : '') + '.'
      : toSheet
      ? 'THE DIAL IS AT THE SHEET — every message below is written into the ' +
        HUB_REHEARSAL_HOUSE + ' house as a row and reaches nobody: no phone, no inbox, ' +
        'not a tester. It is the only position under which a rehearsal of the whole ' +
        'lane cannot land 64 texts in one group chat.'
      : (tm.on
      ? 'TEST MODE — every message below goes to the listed testers and to nobody else, ' +
        'including the team alerts that the sending switch does not hold'
      : 'production — messages reach their real recipients')) +
      (sharedWarning && !toSheet ? ' · ' + sharedWarning : ''),
    // Said on its own key as well as inside the note, because a screen that renders one sentence must not have to…
    test_mode_shared_warning: toSheet ? '' : sharedWarning,
    // THE NIGHT, beside the switches: the window every message above obeys, whether it is standing now, and the…
    quiet_window: { from: HUB_QUIET_FROM, to: HUB_QUIET_TO, tz: HUB_QUIET_TZ,
                    words: hubQuietWords_(), now: hubQuietAt_(),
                    exempt: Object.keys(HUB_AUTH_LETTERS).concat(Object.keys(HUB_QUIET_EXEMPT)) },
    sending_governs: 'everything declared below — the New Hire packet request, the ' +
                     'overdue-packet alert and the lead-scraper alert among them',
    always_sends: ungoverned,
    always_sends_note: ungoverned.length
      ? 'these lanes reach the transport without passing this door and are NOT held by the switch'
      : 'nothing — every team alert passes this door and is held by the switch, the quiet ' +
        'window and the receipt like every other message',
    // AND THE DOORS THAT CALL THE MAIL TRANSPORT THEMSELVES, named so the answer above is whole.
    direct_doors: [
      { door: 'PasswordReset.gs authForgotPub_',
        why: 'the password reset link — an authentication letter, asked for by the person it reaches; ' +
             'its situation (auth_password_reset) is asked first and its row is written by hand' },
      { door: 'HiringSimConfig.gs simActorMailOut_',
        why: 'the hiring simulator\'s actors writing to the platform\'s own mailbox — a rehearsal ' +
             'between the platform\'s own accounts, held by the switch like every rehearsal' }
    ],
    methods: out
  } };
};

/** ▶ What can this platform send, and is sending on? */
function runRpcAbilities() {
  var out = HUB_ACTIONS.rpcAbilities({}, { role: 'admin', email: 'editor' });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// ▶ Prove the whole path without a phone ringing: every contract is exercised dry, so a missing parameter or a…
function runRpcSelfTest() {
  var cases = [
    { m: 'smsSend', p: { to: '+13309195558', body: 'test', reason: 'self-test' }, want: true },
    { m: 'smsSend', p: { to: '+13309195558', reason: 'self-test' }, want: false },
    { m: 'packetRequest', p: { candidate_id: 'CAN_TEST', name: 'Test Person', to: '+13309195558' }, want: true },
    { m: 'packetRequest', p: { name: 'Test Person', to: '+13309195558' }, want: false },
    { m: 'teamAlert', p: { subject: 's', body: 'b', reason: 'self-test' }, want: true },
    { m: 'noSuchMethod', p: {}, want: false }
  ];
  var results = [], failures = 0;
  for (var i = 0; i < cases.length; i++) {
    var r = rpcCall_(cases[i].m, cases[i].p, { dry_run: true });
    var pass = (r.ok === cases[i].want);
    if (!pass) failures++;
    results.push({ method: cases[i].m, expected_ok: cases[i].want, got_ok: r.ok,
                   error: r.error || '', pass: pass });
    // A dry run that reports sent:true would mean the gate leaks.
    if (r.sent === true) { failures++; results[results.length - 1].leaked = true; }
  }
  var out = { failures: failures, sending: rpcSendEnabled_() ? 'on' : 'off', cases: results };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
