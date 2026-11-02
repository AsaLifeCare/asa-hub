// The durable record: the `messages` tab is rewritten on every sync and can only detect.
var OPT_OUT_TAB = 'entity_opt_outs';
var OPT_OUT_COLUMNS = [
  'target', 'kind', 'target_key', 'person_name', 'candidate_id',
  'source', 'phrase', 'message_id', 'at', 'by', 'released_at', 'released_by',
  'scope'
];
var OPT_OUT_CACHE_KEY = 'hub_opt_outs_v1';
var OPT_OUT_CACHE_SECONDS = 45;

// Short and unambiguous on purpose: a clever list suppresses people who never asked.
var OPT_OUT_PHRASES_SHIPPED =
  'stop, stopall, unsubscribe, cancel, end, quit, revoke, optout, opt out, ' +
  'remove me, pare, parar, para, nao quero, não quero, remova, descadastrar, sair';

// Never "yes": an opt-in releases a suppression, and "yes" answers any question.
var OPT_IN_PHRASES_SHIPPED = 'start, unstop, resume, voltar, pode mandar';

var WRONG_NUMBER_PHRASES_SHIPPED =
  'wrong number, wrong person, you have the wrong number, sorry wrong number, ' +
  'this is not me, not me, numero errado, número errado, nao sou eu, não sou eu, ' +
  'pessoa errada';

var INBOUND_TAB = 'entity_inbound_messages';
var INBOUND_COLUMNS = [
  'message_id', 'received_at', 'from_number', 'from_key', 'candidate_id',
  'person_name', 'body', 'intent', 'our_number', 'seen_at', 'seen_by', 'recorded_at'
];

// Only a wrong number is ever scoped; a stop is never narrowed, and an unscoped row or caller blocks.
var OPT_OUT_SCOPES = ['hiring', 'staff'];

// Keyed by HUB_POLICY[action].file, not per call site: an unlisted file answers '' and blocks.
var OPT_OUT_SCOPE_BY_FILE = {
  'HiringOutreach.gs': 'hiring', 'Interview.gs': 'hiring', 'InterviewFlow.gs': 'hiring',
  'Screening.gs': 'hiring', 'Hired.gs': 'hiring', 'Packet.gs': 'hiring',
  'Invites.gs': 'hiring', 'TalentPipeline.gs': 'hiring', 'HiringFlow.gs': 'hiring',
  'HiringWalk.gs': 'hiring', 'Onboarding.gs': 'hiring', 'Talent.gs': 'hiring',
  'CommRecruit.gs': 'hiring',
  'SmartComms.gs': 'staff', 'StaffAlerts.gs': 'staff', 'CommRecord.gs': 'staff',
  'CommCallOff.gs': 'staff', 'CommIncident.gs': 'staff', 'CommSupport.gs': 'staff',
  'CommPsi.gs': 'staff', 'CommQualify.gs': 'staff', 'CommInbound.gs': 'staff',
  'MedDel.gs': 'staff', 'CommBroadcast.gs': 'staff', 'CommOpenShiftCovered.gs': 'staff'
};

var OPT_OUT_HIRING_LINES = ['3309195559', '3307544040'];
// Also the test-redirect target: in test mode a reply there could be about anything, so no scope.
var OPT_OUT_OUTREACH_LINE = '3309195558';

function optOutScopeForLine_(ourNumber) {
  var d = String(ourNumber || '').replace(/\D/g, '').slice(-10);
  if (!d) return '';
  if (OPT_OUT_HIRING_LINES.indexOf(d) !== -1) return 'hiring';
  if (d === OPT_OUT_OUTREACH_LINE) {
    var testing = false;
    try { testing = (typeof commTestMode_ === 'function') && !!commTestMode_(); }
    catch (eT) { testing = true; }
    return testing ? '' : 'hiring';
  }
  return '';
}

// Triggers, sweeps and editor runs set no HUB_ACTION_NOW, answer '' and so block.
function optOutScopeNow_() {
  try {
    if (typeof HUB_ACTION_NOW === 'undefined' || !HUB_ACTION_NOW) return '';
    var pol = (typeof HUB_POLICY !== 'undefined') ? HUB_POLICY[HUB_ACTION_NOW] : null;
    var file = pol && pol.file;
    if (!file) return '';
    return OPT_OUT_SCOPE_BY_FILE[String(file)] || '';
  } catch (e) { return ''; }
}

function optOutScoped_(hit) {
  if (!hit) return false;
  if (String(hit.source || '').toLowerCase().indexOf('wrong') === -1) return false;
  return OPT_OUT_SCOPES.indexOf(String(hit.scope || '')) !== -1;
}

function optOutKey_(target) {
  var s = String(target || '').trim();
  if (!s) return '';
  if (s.indexOf('@') !== -1) return s.toLowerCase();
  var d = s.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

function optOutKind_(target) {
  return String(target || '').indexOf('@') !== -1 ? 'email' : 'phone';
}

function optOutPhrases_(key, shipped) {
  var raw = '';
  try {
    var cfg = hiringAlerts_();
    raw = String((cfg && cfg[key]) || '');
  } catch (e) { raw = ''; }
  var list = raw.split(/[,;\n]+/).map(function (s) {
    return String(s).trim().toLowerCase();
  }).filter(String);
  if (!list.length) {
    list = shipped.split(/[,;\n]+/).map(function (s) { return s.trim().toLowerCase(); }).filter(String);
  }
  return list;
}

function optOutIntent_(body) {
  var s = String(body || '').toLowerCase().replace(/[^a-zà-ú0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (optOutPhrases_('opt_out_phrases', OPT_OUT_PHRASES_SHIPPED).indexOf(s) !== -1) return 'opt-out';
  if (optOutPhrases_('opt_in_phrases', OPT_IN_PHRASES_SHIPPED).indexOf(s) !== -1) return 'opt-in';
  if (optOutPhrases_('wrong_number_phrases', WRONG_NUMBER_PHRASES_SHIPPED).indexOf(s) !== -1) return 'wrong-number';
  return 'reply';
}

function optOutSheet_() {
  var sheet = hubTabEnsure_(OPT_OUT_TAB, OPT_OUT_COLUMNS);
  ensureHeader_(sheet, OPT_OUT_COLUMNS);
  return sheet;
}

function inboundSheet_() {
  var sheet = hubTabEnsure_(INBOUND_TAB, INBOUND_COLUMNS);
  ensureHeader_(sheet, INBOUND_COLUMNS);
  return sheet;
}

function optOutIndex_() {
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get(OPT_OUT_CACHE_KEY);
    if (hit) return JSON.parse(hit);
  } catch (e) { cache = null; }

  var out = { by: {}, error: '' };
  try {
    optOutSheet_();
    readTabNormalized_(hubTabWorkbook_(OPT_OUT_TAB), OPT_OUT_TAB).forEach(function (r) {
      var key = str_(r.targetkey) || optOutKey_(r.target);
      if (!key) return;
      if (str_(r.releasedat)) { delete out.by[key]; return; }
      out.by[key] = {
        target: str_(r.target), kind: str_(r.kind), name: str_(r.personname),
        candidate_id: str_(r.candidateid), source: str_(r.source),
        phrase: str_(r.phrase), at: str_(r.at), scope: str_(r.scope)
      };
    });
  } catch (e2) {
    out.error = 'The opt-out list could not be read: ' + String((e2 && e2.message) || e2);
    return out;   // never cached: a failure must not become the answer for 45s
  }
  try { if (cache) cache.put(OPT_OUT_CACHE_KEY, JSON.stringify(out), OPT_OUT_CACHE_SECONDS); }
  catch (e3) { }
  return out;
}

function optOutBust_() {
  try { CacheService.getScriptCache().remove(OPT_OUT_CACHE_KEY); } catch (e) { }
}

// Pass `scope` only where no action is running (a sweep); otherwise optOutScopeNow_ answers it.
function optOutBlocked_(target, scope) {
  var key = optOutKey_(target);
  if (!key) return '';
  var idx = optOutIndex_();
  if (idx.error) return idx.error;
  var hit = idx.by[key];
  if (!hit) return '';
  // An unnamed caller is an unknown conversation, and unknown blocks.
  var mine = (scope === undefined || scope === null) ? optOutScopeNow_() : String(scope || '');
  if (mine && optOutScoped_(hit) && String(hit.scope) !== mine) return '';
  return 'This person asked us to stop' +
         (hit.at ? ' on ' + String(hit.at).slice(0, 10) : '') +
         (hit.phrase ? ' ("' + hit.phrase + '")' : '') + '.';
}

// For cards: unlike optOutBlocked_, an unreadable list is not a suppression here.
function optOutIsSuppressed_(target, scope) {
  var key = optOutKey_(target);
  if (!key) return '';
  var idx = optOutIndex_();
  if (idx.error) return '';
  var hit = idx.by[key];
  if (!hit) return '';
  var mine = (scope === undefined || scope === null) ? optOutScopeNow_() : String(scope || '');
  if (mine && optOutScoped_(hit) && String(hit.scope) !== mine) return '';
  return 'Asked us to stop' + (hit.at ? ' on ' + String(hit.at).slice(0, 10) : '') + '.';
}

function optOutAdd_(target, info) {
  info = info || {};
  var key = optOutKey_(target);
  if (!key) return { ok: false, why: 'not a number or an address we can key on' };
  var idx = optOutIndex_();
  if (!idx.error && idx.by[key]) return { ok: true, already: true };
  optOutSheet_();
  hubAppendRow_(OPT_OUT_TAB, {
    target: String(target), kind: optOutKind_(target), target_key: key,
    person_name: str_(info.name), candidate_id: str_(info.candidateId),
    source: str_(info.source) || 'manual', phrase: str_(info.phrase),
    message_id: str_(info.messageId),
    at: new Date().toISOString(), by: str_(info.by),
    // Only a wrong number may carry a scope.
    scope: (String(info.source || '').toLowerCase().indexOf('wrong') !== -1)
      ? str_(info.scope) : ''
  });
  optOutBust_();
  return { ok: true, already: false };
}

// Stamps released_at and keeps the row: the record outlives the release.
function optOutRelease_(target, user) {
  var key = optOutKey_(target);
  if (!key) return { ok: false, why: 'not a number or an address we can key on' };
  var sheet = optOutSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var iKey = hdr.indexOf('target_key'), iRel = hdr.indexOf('released_at'),
      iRelBy = hdr.indexOf('released_by');
  if (iKey === -1 || iRel === -1) return { ok: false, why: 'the opt-out tab is missing its columns' };
  var freed = 0;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][iKey]).trim() !== key) continue;
    if (String(values[i][iRel]).trim()) continue;
    sheet.getRange(i + 1, iRel + 1).setValue(new Date().toISOString());
    if (iRelBy !== -1) sheet.getRange(i + 1, iRelBy + 1).setValue(str_(user && user.email));
    freed++;
  }
  optOutBust_();
  return { ok: true, freed: freed };
}

function inboundIndex_() {
  var have = {};
  try {
    inboundSheet_();
    readTabNormalized_(hubTabWorkbook_(INBOUND_TAB), INBOUND_TAB)
      .forEach(function (r) { var id = str_(r.messageid); if (id) have[id] = true; });
  } catch (e) { return { have: {}, error: String((e && e.message) || e) }; }
  return { have: have, error: '' };
}

// Built once per execution; the first row wins for a repeated number, so the answer is stable.
var INBOUND_WHO_INDEX = null;

function inboundWhoIndex_() {
  if (INBOUND_WHO_INDEX) return INBOUND_WHO_INDEX;
  var idx = {};
  try {
    var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB);
    for (var i = 0; i < rows.length; i++) {
      var d = str_(rows[i].phone).replace(/\D/g, '').slice(-10);
      if (!d || idx[d]) continue;
      idx[d] = { id: str_(rows[i].candidateid), name: str_(rows[i].candidatename) };
    }
  } catch (e) {
    // Not memoised: "nobody matches" must not stand for the whole execution.
    return {};
  }
  INBOUND_WHO_INDEX = idx;
  return idx;
}

function inboundWho_(digits) {
  if (!digits) return null;
  return inboundWhoIndex_()[digits] || null;
}

HUB_POLICY.commsInboundSweep = {
  file: 'OptOut.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  // Empty on purpose: the screen reads optOutList directly, no slice serves it.
  invalidates: [], emits: [],
  params: { restart: { type: 'string' } }
};
HUB_ACTIONS.commsInboundSweep = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  // `restart` is safe: rows are keyed on message id, so a re-read records nothing twice.
  return commsInboundRun_(str_(user && user.email) || 'asa-hub',
                          { restart: String((payload && payload.restart) || '') === 'yes' });
};

// The Quo workbook's Messages tab: its `Direction` says `incoming` on every row, so trust `Status`.
var QUO_MESSAGES_TAB = 'Messages';

var INBOUND_BATCH_ROWS = 1500;

var INBOUND_BATCH_RECORD = 300;

// A row index, not a date: the tab is append-only.
var INBOUND_CURSOR_PROP = 'HUB_INBOUND_CURSOR';

// Last-resort floor only: inboundIsOurs_ asks the line directory first.
var INBOUND_COMPANY_DIGITS = ['3309197595', '3309197779'];

function inboundCursor_() {
  try {
    var n = parseInt(String(hubProp_(INBOUND_CURSOR_PROP) || '0'), 10);
    return isNaN(n) || n < 0 ? 0 : n;
  } catch (e) { return 0; }
}

function inboundCursorSet_(n) {
  try { hubPropSet_(INBOUND_CURSOR_PROP, String(n)); }
  catch (e) { }
}

// True for a blank number on purpose: the careful direction.
function inboundIsOurs_(digits) {
  if (!digits) return true;
  try {
    if (typeof hubLineOurs_ === 'function' && hubLineOurs_(digits)) return true;
  } catch (e) { }
  if (typeof SHARED_LINE_DIGITS !== 'undefined' && SHARED_LINE_DIGITS.indexOf(digits) !== -1) return true;
  return INBOUND_COMPANY_DIGITS.indexOf(digits) !== -1;
}

var INBOUND_RECENT_DAYS = 45;

function inboundIsRecent_(when) {
  var s = str_(when);
  if (!s) return true;            // undated counts as new, never as old
  var t = new Date(s).getTime();
  if (isNaN(t)) return true;
  return (new Date().getTime() - t) <= INBOUND_RECENT_DAYS * 86400000;
}

function commsInboundRun_(byEmail, opts) {
  opts = opts || {};
  var sheet = null;
  try {
    sheet = ssOpen_(hubId_('QUO_SYNC_SHEET_ID')).getSheetByName(QUO_MESSAGES_TAB);
  } catch (e) {
    return { status: 503, message: 'The message mirror could not be opened (' +
             String((e && e.message) || e) + '). Nothing was swept.' };
  }
  if (!sheet) {
    return { status: 503, message: 'The Quo workbook has no "' + QUO_MESSAGES_TAB +
             '" tab. An absent source is not an empty inbox — nothing was swept.' };
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { status: 200, data: {
      recorded: 0, stops: 0, starts: 0, wrongNumbers: 0, alreadySeen: 0,
      remaining: 0, replies: [], noFeed: true,
      message: 'No inbound feed. The message mirror is EMPTY — not "no replies". ' +
               'Until OpenPhone writes to it again, a STOP sent by SMS cannot be seen.'
    } };
  }

  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return normKey_(h); });
  var iId = header.indexOf('messageid'), iAt = header.indexOf('messagecreated'),
      iStatus = header.indexOf('status'), iExt = header.indexOf('externalparticipants'),
      iBody = header.indexOf('body'), iQuo = header.indexOf('quonumber');
  if (iId === -1 || iStatus === -1 || iBody === -1) {
    return { status: 503, message: 'The mirror is missing the columns this reads ' +
             '(Message ID / Status / Body). Nothing was swept.' };
  }

  var seen = inboundIndex_();
  if (seen.error) {
    return { status: 503, message: 'The inbound record could not be read (' +
             seen.error + '). Nothing was swept, so nothing is double-counted.' };
  }

  var cursor = opts.restart ? 0 : inboundCursor_();
  var from = Math.max(2, cursor + 1);
  if (from > lastRow) from = Math.max(2, lastRow - INBOUND_BATCH_ROWS + 1);
  var count = Math.min(INBOUND_BATCH_ROWS, lastRow - from + 1);
  var values = sheet.getRange(from, 1, count, header.length).getValues();

  var out = [], recorded = 0, stops = 0, starts = 0, wrong = 0, already = 0,
      ours = 0, outgoing = 0, passedOver = 0, replies = [], reached = from - 1;

  for (var i = 0; i < values.length && recorded < INBOUND_BATCH_RECORD; i++) {
    reached = from + i;
    var r = values[i];
    var g = function (idx) { return idx === -1 ? '' : str_(r[idx]); };

    // Status, never Direction (see QUO_MESSAGES_TAB).
    if (g(iStatus).toLowerCase() !== 'received') { outgoing++; continue; }
    var id = g(iId);
    if (!id) continue;
    if (seen.have[id]) { already++; continue; }

    var fromNum = g(iExt);
    var digits = fromNum.replace(/\D/g, '').slice(-10);
    if (inboundIsOurs_(digits)) { ours++; continue; }

    var body = g(iBody);
    // An empty body is an attachment: a reply for a person to open, never silence.
    var intent = optOutIntent_(body) || 'reply';
    var who = inboundWho_(digits);

    if (intent === 'opt-out') {
      optOutAdd_(fromNum, { name: who && who.name, candidateId: who && who.id,
                            source: 'sms reply', phrase: body.slice(0, 120),
                            messageId: id, by: 'asa-hub:inbound' });
      stops++;
    } else if (intent === 'opt-in') {
      optOutRelease_(fromNum, { email: 'asa-hub:inbound' });
      starts++;
    } else if (intent === 'wrong-number') {
      optOutAdd_(fromNum, { name: who && who.name, candidateId: who && who.id,
                            source: 'wrong number', phrase: body.slice(0, 120),
                            messageId: id, by: 'asa-hub:inbound',
                            scope: optOutScopeForLine_(g(iQuo)) });
      wrong++;
    }

    // The mirror is the whole company's traffic: file decisions always, others only for a candidate or when recent.
    var decision = (intent === 'opt-out' || intent === 'opt-in' || intent === 'wrong-number');
    var recent = inboundIsRecent_(g(iAt));
    if (decision || who || recent) {
      out.push({
        message_id: id, received_at: g(iAt), from_number: fromNum, from_key: digits,
        candidate_id: who ? who.id : '', person_name: who ? who.name : '',
        body: body.slice(0, 900), intent: intent, our_number: g(iQuo),
        recorded_at: new Date().toISOString()
      });
      recorded++;
      if (intent === 'reply') replies.push({ name: who ? who.name : fromNum, body: body.slice(0, 140) });
    } else {
      passedOver++;
    }
    seen.have[id] = true;
  }

  if (out.length) inboundAppendMany_(out);
  inboundCursorSet_(reached);

  var remaining = Math.max(0, lastRow - reached);
  hubSysLog_(byEmail, 'comms_inbound_sweep',
             recorded + ' new, ' + stops + ' opt-out, ' + starts + ' opt-in, ' +
             wrong + ' wrong number, ' + passedOver + ' read and not filed, ' +
             ours + ' our own lines, ' + remaining + ' rows behind', { status: 200 });

  return { status: 200, data: {
    recorded: recorded, stops: stops, starts: starts, wrongNumbers: wrong,
    alreadySeen: already, ourOwnLines: ours, outgoing: outgoing,
    passedOver: passedOver,
    remaining: remaining, replies: replies.slice(0, 20), noFeed: false,
    message: recorded
      ? recorded + ' new message(s): ' + stops + ' asked us to stop, ' + starts +
        ' asked to resume, ' + wrong + ' wrong number, ' +
        (recorded - stops - starts - wrong) + ' are replies to read.' +
        (passedOver ? ' ' + passedOver + ' older message(s) from numbers nobody on the board owns were read and not filed.' : '') +
        (remaining ? ' ' + remaining + ' row(s) still behind — the next pass continues.' : '')
      : (remaining
          ? 'Nothing new in this batch. ' + remaining + ' row(s) still behind.'
          : 'Nothing new — every message in the mirror is already recorded.')
  } };
}

function inboundAppendMany_(rows) {
  var sheet = inboundSheet_();
  var hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var matrix = rows.map(function (row) {
    return hdr.map(function (h) {
      return row[h] === undefined ? '' : hubCellSafe_(row[h]);
    });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, matrix.length, hdr.length).setValues(matrix);
  // Replies are joined onto the candidate card: its cache must go too.
  try { hubBustTalentCache_(); } catch (eB) {}
}

// Service reads only; a STOP must not wait for someone to open a screen. The automatic pass is Python's
// (app/opt_outs*.py, app/inbound_copy_writes.py), rung by the relay's clock whichever side holds the list.
function commsInboundSweepMaybe_() {
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
}

HUB_POLICY.optOutList = {
  file: 'OptOut.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'], invalidates: [], emits: []
};
HUB_ACTIONS.optOutList = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var idx = optOutIndex_();
  var list = [];
  for (var k in idx.by) {
    if (Object.prototype.hasOwnProperty.call(idx.by, k)) {
      var v = idx.by[k];
      list.push({ key: k, target: v.target, kind: v.kind, name: v.name,
                  candidate_id: v.candidate_id, source: v.source,
                  phrase: v.phrase, at: v.at,
                  scope: v.scope || '' });
    }
  }
  list.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });

  // The index drops released rows; the screen still needs them.
  var released = [];
  try {
    optOutSheet_();
    readTabNormalized_(hubTabWorkbook_(OPT_OUT_TAB), OPT_OUT_TAB).forEach(function (r) {
      if (!str_(r.releasedat)) return;
      released.push({ key: str_(r.targetkey) || optOutKey_(r.target), target: str_(r.target),
                      kind: str_(r.kind), name: str_(r.personname),
                      candidate_id: str_(r.candidateid), source: str_(r.source),
                      phrase: str_(r.phrase), at: str_(r.at), scope: str_(r.scope),
                      released_at: str_(r.releasedat), released_by: str_(r.releasedby) });
    });
  } catch (e) { }
  released.sort(function (a, b) {
    return String(b.released_at).localeCompare(String(a.released_at));
  });

  return { status: 200, data: {
    optOuts: list,
    released: released,
    // Carried, never swallowed: an empty list from an unreadable tab would read as "nobody opted out".
    unreadable: idx.error || ''
  } };
};

HUB_POLICY.optOutSet = {
  file: 'OptOut.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'], invalidates: [], emits: [],
  params: {
    target: { type: 'string', required: true },
    release: { type: 'string' },
    name: { type: 'string' },
    candidate_id: { type: 'string' }
  }
};
HUB_ACTIONS.optOutSet = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  payload = payload || {};
  var target = str_(payload.target);
  if (!target) return { status: 400, message: 'A number or an address is required.' };
  if (!optOutKey_(target)) {
    return { status: 400, message: '"' + target + '" is not a ten-digit number or an e-mail address.' };
  }
  var release = ['yes', 'true', '1', 'on'].indexOf(String(payload.release || '').toLowerCase()) !== -1;
  var out = release
    ? optOutRelease_(target, user)
    : optOutAdd_(target, { name: payload.name, candidateId: payload.candidate_id,
                           source: 'by hand', by: user.email });
  if (!out.ok) return { status: 400, message: out.why || 'Nothing changed.' };
  hubSysLog_(user.email, release ? 'opt_out_released' : 'opt_out_added',
             optOutKey_(target), { status: 200 });
  return { status: 200, data: {
    released: !!release, already: !!out.already, freed: out.freed || 0,
    message: release
      ? (out.freed ? 'They can be contacted again.' : 'They were not on the list.')
      : (out.already ? 'They were already on the list.' : 'They will not be contacted again.')
  } };
};

HUB_POLICY.inboundMarkSeen = {
  file: 'OptOut.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'], invalidates: [], emits: [],
  params: { message_id: { type: 'string', required: true } }
};
HUB_ACTIONS.inboundMarkSeen = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var id = str_(payload && payload.message_id);
  if (!id) return { status: 400, message: 'Which message?' };
  var sheet = inboundSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var iId = hdr.indexOf('message_id'), iSeen = hdr.indexOf('seen_at'), iBy = hdr.indexOf('seen_by');
  if (iId === -1 || iSeen === -1) return { status: 500, message: 'The inbound tab is missing its columns.' };
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][iId]).trim() !== id) continue;
    if (String(values[i][iSeen]).trim()) return { status: 200, data: { already: true } };
    sheet.getRange(i + 1, iSeen + 1).setValue(new Date().toISOString());
    if (iBy !== -1) sheet.getRange(i + 1, iBy + 1).setValue(str_(user.email));
    try { hubBustTalentCache_(); } catch (eB) {}
    return { status: 200, data: { already: false } };
  }
  return { status: 404, message: 'No message with that id.' };
};
