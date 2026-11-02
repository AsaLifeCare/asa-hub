// Every message the platform decides to say gets a row, held or sent; the write never throws or changes the answer.

var COMM_MOCK_HOUSE = 'comm_mock';

// ensureHeader_ only appends, so a live house keeps its own order.
var COMM_MOCK_HEADER = [
  'id', 'createdAt', 'updatedAt',
  'at', 'day', 'hour', 'pass_id', 'seq',
  'situation', 'purpose', 'method', 'send_at',
  'person_name', 'to_masked', 'audience',
  'channel', 'subject', 'body', 'body_chars',
  'result', 'held_by', 'reason',
  'dial', 'test_mode', 'send_switch',
  'ledger_key', 'tenant'
];

var COMM_MOCK_METHODS = { smsSend: 'sms', emailSend: 'email', teamAlert: 'team',
                          packetRequest: 'sms' };

var COMM_MOCK_ROWS_KEPT = 2000;

// A sweep must not spend its six minutes appending rows; hitting the cap is logged.
var COMM_MOCK_PER_EXECUTION = 200;

var COMM_MOCK_WRITTEN = 0;
var COMM_MOCK_CAPPED = 0;
var COMM_MOCK_PASS = null;
var COMM_MOCK_SEQ = 0;
// Per house: one flag would leave a row's own sheet growing for ever.
var COMM_MOCK_TRIMMED = {};
// Per book: an unwritable house must not silence the outbox.
var COMM_MOCK_DEAD = {};

// Set and cleared by a caller that knows more than the door; what cannot be derived stays empty.
var COMM_MOCK_CTX = null;

function commMockPass_() {
  if (!COMM_MOCK_PASS) {
    COMM_MOCK_PASS = 'mock_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14) +
                     '_' + Math.floor(Math.random() * 9000 + 1000);
  }
  return COMM_MOCK_PASS;
}

function commMockSituationFrom_(reason) {
  var s = String(reason || '');
  var m = /(?:smart comms(?: cc| digest| event)?|comms|smart comms event)\s*:\s*([A-Za-z0-9_\-]+)/.exec(s);
  if (m) return m[1];
  // Any other "label: id" tail counts only when that situation really exists.
  var tail = /:\s*([A-Za-z0-9_\-]+)\s*$/.exec(s);
  if (!tail) return '';
  var want = tail[1], hit = '';
  try {
    smartSituations_().forEach(function (row) {
      if (String(row.id) === want) hit = want;
    });
  } catch (e) { return ''; }
  return hit;
}

function commMockHoursFor_(situationId) {
  if (!situationId) return '';
  try {
    var hit = '';
    smartSituations_().forEach(function (s) {
      if (String(s.id) === String(situationId)) hit = String(s.send_at || '');
    });
    return hit;
  } catch (e) { return ''; }
}

// Fails open on purpose: an unreadable situations cache must not silence a lane.
function commMockRecordTo_(situationId) {
  if (!situationId) return '';
  var house = '';
  try {
    smartSituations_().forEach(function (s) {
      if (String(s.id) === String(situationId)) house = String(s.record_to || '').trim();
    });
  } catch (e) { return ''; }
  // The seed answers while the cell is blank; a cell that says anything, even 'send', wins.
  if (!house) {
    try {
      smartDefaults_().forEach(function (d) {
        if (String(d.id) === String(situationId)) house = String(d.record_to || '').trim();
      });
    } catch (eS) { }
  }
  if (house.toLowerCase() === 'send' || house.toLowerCase() === 'none') return '';
  return house;
}

// The quiet window asks this too: a message that reaches nobody need not be held.
function commMockRecordHouse_(method, params) {
  if (!COMM_MOCK_METHODS[String(method || '')]) return '';
  var situation = commMockSituationFrom_((params || {}).reason);
  if (!situation) return '';
  return commMockRecordTo_(situation);
}

function commMockRecordOnly_(method, params, opts) {
  var house = commMockRecordHouse_(method, params);
  if (!house) return null;
  var situation = commMockSituationFrom_((params || {}).reason);
  var out = { ok: true, sent: false, gated: true, method: String(method || ''),
              recorded_to: house, reason: 'recorded to ' + house,
              detail: 'This situation writes into its own sheet (' + house +
                      ') instead of sending. Nobody was contacted.' };
  try {
    commMockNote_(method, params, opts, out, house);
  } catch (e) {
    // The message still does not go out: a lost row is not a sent text.
    try {
      hubSysLog_('asa-hub:commmock', 'comm_mock_record_lost',
                 situation + ' → ' + house + ': ' + String((e && e.message) || e),
                 { status: 500 });
    } catch (eL) { }
  }
  return out;
}

// Why this execution could not read the switch, or ''; never throws.
function commMockSwitchWhy_() {
  try {
    return (typeof hubSwitchUnreadableWhy_ === 'function') ? String(hubSwitchUnreadableWhy_() || '') : '';
  } catch (e) { return ''; }
}

// THE ONE MESSAGE THAT LEAVES WHILE THE LANE HOLDS, AND IT NEVER LEAVES QUIETLY.
var COMM_MOCK_AUTH_PASSED = 'delivered while the lane was holding — an authentication letter ' +
                            'carries a way back into an account and is not held by the dial';

// Never throws, and never lets a secret through when the helper is missing from a push.
function commMockWithhold_(text, withhold) {
  try {
    if (typeof hubWithhold_ === 'function') return hubWithhold_(text, withhold);
  } catch (e) { /* fall through to the blunt answer */ }
  return withhold ? '{words withheld}' : String(text == null ? '' : text);
}

// AN OPT-OUT LIST THAT COULD NOT BE READ IS NOT A PERSON WHO SAID STOP.
var COMM_MOCK_OPT_OUT_UNREAD = /opt-out list could not be (read|checked)/i;

function commMockAuthWords_(kind, holding) {
  if (!kind) return '';
  return holding ? COMM_MOCK_AUTH_PASSED + ' (' + String(kind) + ')'
                 : 'an authentication letter (' + String(kind) + ')';
}

function commMockAudience_(to) {
  var list = String(to == null ? '' : to).split(/[,;]+/).filter(function (x) {
    return String(x).trim().length > 0;
  });
  return list.length;
}

// 'sync' is deliberately absent: its {name} is sometimes a run mode, not a person.
var COMM_MOCK_PERSON_SUBJECTS = {
  candidate: true, staff: true, recon: true, client: true,
  travel: true, shopperOwners: true, onboarding: true
};

// Ids, addresses, unfilled placeholders and lists are not a person.
function commMockLooksLikeAPerson_(value) {
  var v = String(value == null ? '' : value).trim();
  if (v.length < 2 || v.length > 60) return false;
  if (/[0-9_{}<>@|;,\/\\]/.test(v)) return false;
  if (v.indexOf('·') !== -1) return false;
  return /[A-Za-z]/.test(v);
}

// Anchored on the template's literal text around {name}; any ambiguity answers ''.
function commMockPersonSpan_(tpl, rendered) {
  var t = String(tpl == null ? '' : tpl), s = String(rendered == null ? '' : rendered);
  if (!t || !s) return '';
  var at = t.indexOf('{name}');
  if (at === -1 || t.indexOf('{name}', at + 1) !== -1) return '';
  var head = t.slice(0, at), tail = t.slice(at + '{name}'.length);
  var left = head.slice(head.lastIndexOf('}') + 1);
  var cut = tail.indexOf('{');
  var right = (cut === -1) ? tail : tail.slice(0, cut);
  if (!left && head) return '';
  if (!right && tail) return '';
  var start = 0;
  if (left) {
    var l = s.indexOf(left);
    if (l === -1 || l !== s.lastIndexOf(left)) return '';
    start = l + left.length;
  }
  var end = s.length;
  if (right) {
    var r = s.indexOf(right, start);
    if (r === -1 || r !== s.lastIndexOf(right)) return '';
    end = r;
  }
  if (end < start) return '';
  return s.slice(start, end).trim();
}

// Never from ledger keys, split subjects or addresses: a wrong name is worse than a blank.
function commMockPersonFrom_(situationId, params) {
  if (!situationId) return '';
  var p = params || {};
  var row = null;
  try {
    smartSituations_().forEach(function (s) {
      if (String(s.id) === String(situationId)) row = s;
    });
  } catch (e) { return ''; }
  if (!row) return '';

  // A digest lists everybody, so it names nobody.
  var kind = String(row.kind || '').trim().toLowerCase();
  if (kind === 'digest') return '';
  if (kind !== 'reminder') {
    if (kind !== 'event') return '';
    var def = null;
    try {
      def = (typeof SMART_EVENTS !== 'undefined' && SMART_EVENTS)
        ? SMART_EVENTS[String(row.event || '').trim()] : null;
    } catch (eE) { return ''; }
    if (!def) return '';
    if (!COMM_MOCK_PERSON_SUBJECTS[String(def.subject || 'candidate')]) return '';
  }

  // The live row only, never the seed: the words were rendered from the cell that is there.
  var pairs = [[row.email_subject, p.subject],
               [row.email_text, p.body],
               [row.sms_text, p.body]];
  for (var i = 0; i < pairs.length; i++) {
    var hit = commMockPersonSpan_(pairs[i][0], pairs[i][1]);
    if (hit && commMockLooksLikeAPerson_(hit)) return hit;
  }
  return '';
}

function commMockNote_(method, params, opts, res, house) {
  var book = String(house || COMM_MOCK_HOUSE);
  if (COMM_MOCK_DEAD[book]) return;
  var channel = COMM_MOCK_METHODS[String(method || '')];
  if (!channel) return;
  if (!res || res.reason === 'dry_run') return;
  if (!res.ok && (res.error === 'undeclared_method' || res.error === 'missing_param' ||
                  res.error === 'bad_param')) return;
  // The cap governs the outbox only: a row's own house is the message's only record.
  if (!house && COMM_MOCK_WRITTEN >= COMM_MOCK_PER_EXECUTION) { COMM_MOCK_CAPPED++; return; }

  params = params || {};
  opts = opts || {};
  var ctx = (typeof COMM_MOCK_CTX !== 'undefined' && COMM_MOCK_CTX) ? COMM_MOCK_CTX : {};
  var now = new Date();

  // A quiet-window repeat within the memo's six hours is counted, not written again.
  if (res.quiet && !house && commMockQuietSeen_(method, params)) { COMM_MOCK_QUIET_REPEATS++; return; }

  var result = 'held', heldBy = '';
  if (res.recorded_to) { result = 'recorded'; heldBy = 'this row writes into ' + res.recorded_to; }
  else if (res.quiet) { result = 'held_quiet'; heldBy = 'the quiet window (' + commMockQuietWords_() + ')'; }
  // A HOLD THAT IS REALLY AN OUTAGE SAYS SO.
  else if (res.rehearsed) { result = 'rehearsed'; heldBy = commMockSwitchWhy_() || 'the dial is at the sheet'; }
  else if (res.sent && res.redirected) { result = 'rehearsed'; heldBy = 'test mode redirected it'; }
  else if (res.sent) {
    result = 'sent';
    // A letter that left BECAUSE it is an authentication letter names the exemption it used, and says whether the…
    var authKind = '';
    try {
      authKind = (typeof hubAuthLetterKind_ === 'function')
        ? hubAuthLetterKind_(params.auth_letter) : '';
    } catch (eA) { authKind = ''; }
    // Asked only for a letter that claimed the exemption: every other sent row is the row it always was, and a…
    var lanesHolding = false;
    if (authKind) {
      try {
        lanesHolding = !!(typeof hubRehearsalToSheet_ === 'function' && hubRehearsalToSheet_());
      } catch (eH) { lanesHolding = true; }
    }
    heldBy = commMockAuthWords_(authKind, lanesHolding);
  }
  else if (res.reason === 'opted_out') {
    result = 'refused';
    heldBy = COMM_MOCK_OPT_OUT_UNREAD.test(String(res.detail || res.error || ''))
      ? 'the opt-out list could not be read' : 'the person asked us to stop';
  }
  else if (res.deduplicated) { result = 'held'; heldBy = 'the same ask already landed'; }
  else if (res.gated) { result = 'held'; heldBy = String(res.held_by || res.reason || 'a brake'); }
  else if (!res.ok) { result = 'failed'; heldBy = String(res.error || ''); }

  var situation = String(ctx.situation || '') || commMockSituationFrom_(params.reason);
  var body = String(params.body == null ? '' : params.body);
  if (!body && String(method) === 'packetRequest' && typeof rpcPacketMessage_ === 'function') {
    try { body = String(rpcPacketMessage_(params) || ''); } catch (eP) { body = ''; }
  }
  // A secret the message carries (a reset or registration link) reaches the person and never this book, which every…
  var subjectWords = String(params.subject == null ? '' : params.subject);
  if (params.withhold) {
    body = commMockWithhold_(body, params.withhold);
    subjectWords = commMockWithhold_(subjectWords, params.withhold);
  }
  // And anything the lane named as a secret for the length of its call (hubSecretsHold_): this row is mirrored…
  if (typeof hubSecretScrub_ === 'function') {
    body = hubSecretScrub_(body);
    subjectWords = hubSecretScrub_(subjectWords);
  }
  var hm = '';
  try {
    hm = Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH:mm');
  } catch (eH) { hm = now.toISOString().slice(11, 16); }
  var day = '';
  try {
    day = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  } catch (eD) { day = now.toISOString().slice(0, 10); }

  var row = {
    id: commMockPass_() + '#' + (++COMM_MOCK_SEQ),
    at: now.toISOString(), day: day, hour: hm,
    pass_id: commMockPass_(), seq: COMM_MOCK_SEQ,
    situation: situation,
    purpose: String(ctx.purpose || params.reason || ''),
    method: String(method || ''),
    send_at: String(ctx.slot || ctx.send_at || commMockHoursFor_(situation) || ''),
    person_name: String(ctx.person_name || '') || commMockPersonFrom_(situation, params),
    to_masked: ((typeof hubRehearsalMask_ === 'function') ? hubRehearsalMask_(params.to) : '') ||
               ((typeof rpcMaskTo_ === 'function') ? rpcMaskTo_(params.to) : ''),
    audience: ctx.audience || commMockAudience_(params.to),
    channel: channel,
    // the words as rendered, with both kinds of secret withheld above
    subject: subjectWords,
    body: body.slice(0, 4000),
    body_chars: body.length,
    result: result, held_by: heldBy,
    reason: String(res.detail || res.reason || ''),
    dial: (function () {
      try { return (typeof commDial_ === 'function') ? String(commDial_() || '') : ''; }
      catch (e) { return ''; }
    })(),
    // The sheet position outranks 'on', as it does at the transport — and an unreadable switch outranks both…
    test_mode: (function () {
      try {
        // Asked FIRST, then read: the sheet answer and the unreadable answer both come back as "holding", and it is…
        var toSheet = (typeof hubRehearsalToSheet_ === 'function') ? hubRehearsalToSheet_() : false;
        if (commMockSwitchWhy_()) return 'unreadable';
        if (toSheet) return 'sheet';
        var st = (typeof hubTestModeState_ === 'function') ? hubTestModeState_() : null;
        return st ? (st.on ? 'on' : 'off') : '';
      } catch (e) { return 'unreadable'; }
    })(),
    send_switch: (function () {
      try { return (typeof rpcSendEnabled_ === 'function' && rpcSendEnabled_()) ? 'on' : 'off'; }
      catch (e) { return ''; }
    })(),
    ledger_key: String(ctx.ledger_key || opts.idempotency_key || ''),
    tenant: (function () {
      try { return (typeof tenantStamp_ === 'function') ? String(tenantStamp_() || '') : ''; }
      catch (e) { return ''; }
    })()
  };

  try {
    commMockWrite_(row, house);
    COMM_MOCK_WRITTEN++;
  } catch (e) {
    // Once per execution: every later message would fail the same way.
    COMM_MOCK_DEAD[book] = true;
    try {
      hubSysLog_('asa-hub:commmock', 'comm_mock_unwritable',
                 String((e && e.message) || e) +
                 ' — the messages of this pass are not in the book', { status: 500 });
    } catch (eL) { }
  }
}

function commMockWrite_(row, house) {
  var sheet = hubTabEnsure_(String(house || COMM_MOCK_HOUSE), COMM_MOCK_HEADER);
  var nowIso = new Date().toISOString();
  row.createdAt = nowIso;
  row.updatedAt = nowIso;
  var header = ensureHeader_(sheet, COMM_MOCK_HEADER);
  sheet.appendRow(header.map(function (h) {
    return (typeof serialize_ === 'function') ? serialize_(row[h])
                                              : String(row[h] == null ? '' : row[h]);
  }));
  commMockTrim_(sheet, house);
}

function commMockTrim_(sheet, house) {
  // Only the outbox is trimmed: a row's own house belongs to its lane.
  if (house) return;
  var which = String(house || COMM_MOCK_HOUSE);
  if (COMM_MOCK_TRIMMED[which]) return;
  COMM_MOCK_TRIMMED[which] = true;
  try {
    var last = sheet.getLastRow();
    var over = (last - 1) - COMM_MOCK_ROWS_KEPT;
    if (over <= 0) return;
    sheet.deleteRows(2, over);
    hubSysLog_('asa-hub:commmock', 'comm_mock_trimmed',
               over + ' of the oldest row(s) retired — the book keeps ' +
               COMM_MOCK_ROWS_KEPT, { status: 200 });
  } catch (e) {
    try {
      hubSysLog_('asa-hub:commmock', 'comm_mock_trim_failed',
                 String((e && e.message) || e), { status: 200 });
    } catch (eL) { }
  }
}

function commMockSayIfCapped_() {
  if (COMM_MOCK_QUIET_REPEATS && !COMM_MOCK_QUIET_SAID) {
    COMM_MOCK_QUIET_SAID = true;
    try {
      hubSysLog_('asa-hub:commmock', 'comm_mock_quiet_repeats',
                 'messages the quiet window already held tonight are being asked for again this ' +
                 'execution — held again, each still in the book once, not written twice',
                 { status: 200 });
    } catch (eQ) { }
  }
  if (!COMM_MOCK_CAPPED) return;
  try {
    hubSysLog_('asa-hub:commmock', 'comm_mock_capped',
               COMM_MOCK_CAPPED + ' more message(s) this execution are NOT in the book (the cap is ' +
               COMM_MOCK_PER_EXECUTION + ')', { status: 200 });
  } catch (e) { }
  COMM_MOCK_CAPPED = 0;
}

var COMM_MOCK_QUIET_REPEATS = 0;
var COMM_MOCK_QUIET_SAID = false;

// The longest a script cache remembers; a night may still write a held message two or three times.
var COMM_MOCK_QUIET_MEMO_S = 21600;

function commMockQuietWords_() {
  try { if (typeof hubQuietWords_ === 'function') return hubQuietWords_(); } catch (e) { }
  return '21:31–07:59 New York';
}

// A cache that will not answer is "not seen": a second row is the cheap mistake.
function commMockQuietSeen_(method, params) {
  var p = params || {};
  var seed = [String(method || ''), String(p.to || ''), String(p.subject || ''),
              String(p.body || '').slice(0, 400)].join('|');
  var key = '';
  try {
    key = 'cmq_' + Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, seed)
      .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
  } catch (eK) { return false; }
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get(key)) return true;
    cache.put(key, '1', COMM_MOCK_QUIET_MEMO_S);
  } catch (eC) { }
  return false;
}

var COMM_MOCK_CHANNEL_METHOD = { sms: 'smsSend', email: 'emailSend', team: 'teamAlert' };

// For lanes that hold their own message before rpcCall_; never throws, never decides.
function commMockHeld_(what, heldBy, quiet) {
  var w = what || {};
  var method = COMM_MOCK_CHANNEL_METHOD[String(w.channel || 'sms')] || 'smsSend';
  var to = String(w.to == null ? '' : w.to);
  var why = String(heldBy || 'the lane held it');
  // The recipient rides the purpose: the person column is who the message is about.
  var purpose = [String(w.purpose || ''), String(w.to_name || '') ? 'to ' + String(w.to_name) : '']
    .filter(function (x) { return !!x; }).join(' · ');
  var held = (typeof COMM_MOCK_CTX !== 'undefined') ? COMM_MOCK_CTX : null;
  try {
    COMM_MOCK_CTX = {
      situation: String(w.situation || ''),
      purpose: purpose || String(w.reason || ''),
      person_name: String(w.person_name || ''),
      ledger_key: String(w.intent_key || ''),
      audience: commMockAudience_(to)
    };
    commMockNote_(method, { to: to, subject: String(w.subject || ''), body: String(w.body || ''),
                            reason: String(w.reason || '') }, {},
                  { ok: true, sent: false, gated: true, quiet: quiet === true, method: method,
                    reason: why, held_by: why, detail: String(w.reasons || '') || why });
  } catch (e) {
  } finally {
    COMM_MOCK_CTX = held;
  }
}

var COMM_MOCK_WEB_CHANNELS = { web_notice: 'webNotice', web_push: 'webPush', roster_write: 'rosterWrite' };
var COMM_MOCK_WEB_MAX = 50;

function commMockWebRows_(rows) {
  var out = { rows: [], refused: [] };
  (Array.isArray(rows) ? rows : []).slice(0, COMM_MOCK_WEB_MAX).forEach(function (r) {
    var id = String((r && r.id) || '');
    if (!/^web_[0-9a-f]{20}$/.test(id)) { out.refused.push({ id: id, why: 'not a relay row id' }); return; }
    var channel = String(r.channel || '');
    if (!COMM_MOCK_WEB_CHANNELS[channel]) {
      out.refused.push({ id: id, why: 'not a web channel: ' + channel });
      return;
    }
    var row = {};
    COMM_MOCK_HEADER.forEach(function (h) { row[h] = (r[h] == null) ? '' : r[h]; });
    row.id = id;
    row.method = COMM_MOCK_WEB_CHANNELS[channel];
    row.body = String(row.body).slice(0, 4000);
    out.rows.push(row);
  });
  return out;
}

function commMockWebWrite_(rows) {
  var sheet = hubTabEnsure_(COMM_MOCK_HOUSE, COMM_MOCK_HEADER);
  var header = ensureHeader_(sheet, COMM_MOCK_HEADER);
  var idCol = header.indexOf('id') + 1;
  var have = {};
  var last = sheet.getLastRow();
  if (idCol > 0 && last > 1) {
    sheet.getRange(2, idCol, last - 1, 1).getValues().forEach(function (v) { have['k:' + String(v[0])] = true; });
  }
  var nowIso = new Date().toISOString();
  var lines = [], written = [];
  rows.forEach(function (row) {
    written.push(row.id);
    if (have['k:' + row.id]) return;
    have['k:' + row.id] = true;
    row.createdAt = nowIso;
    row.updatedAt = nowIso;
    lines.push(header.map(function (h) {
      return (typeof serialize_ === 'function') ? serialize_(row[h]) : String(row[h] == null ? '' : row[h]);
    }));
  });
  if (lines.length) sheet.getRange(last + 1, 1, lines.length, header.length).setValues(lines);
  commMockTrim_(sheet, '');
  return { written: written, appended: lines.length };
}

HUB_POLICY.commMockWebIngest = {
  file: 'CommMock.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [],
  emits: []
};
HUB_ACTIONS.commMockWebIngest = function (payload, user) {
  if (!user || (!user.is_service && String(user.role) !== 'admin')) return hubDenied_();
  var picked = commMockWebRows_((payload || {}).rows);
  if (!picked.rows.length) return { status: 200, data: { written: [], refused: picked.refused } };
  try {
    var wrote = commMockWebWrite_(picked.rows);
    return { status: 200, data: { written: wrote.written, refused: picked.refused, appended: wrote.appended } };
  } catch (e) {
    // Answers nothing as written, so the relay offers the rows again.
    try {
      hubSysLog_('asa-hub:commmock', 'comm_mock_web_unwritable', String((e && e.message) || e), { status: 500 });
    } catch (eL) { }
    return { status: 503, message: 'the mock outbox could not be written: ' + String((e && e.message) || e) };
  }
};
