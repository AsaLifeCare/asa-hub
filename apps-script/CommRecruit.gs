var RECRUIT_SITUATIONS = {
  hiring_screen_day_reminder: 'hiring.screen.day_reminder',
  hiring_onboarding_start: 'hiring.onboarding.start',
  hiring_bci_howto: 'hiring.bci.howto'
};

var RECRUIT_HOUSES = {
  recruit_pipeline: { source_tab: 'Talent Pipeline', prefix: 'TP' },
  recruit_onboarding: { source_tab: 'Onboarding Checklist', prefix: 'OC' }
};

var RECRUIT_MAX_ROWS = 20;
// The copy travels back with the answer, cut where the mock outbox cuts a body (CommMock.gs), with its length.
var RECRUIT_WORDS_MAX = 4000;
// The relay waits 180 s; a row not started within this budget answers `failed`.
var RECRUIT_START_BUDGET_MS = 100000;
var RECRUIT_PASS_BY = 'asa-hub:recruit-book';
var RECRUIT_SCREENER_FALLBACK = 'Our house manager';
var RECRUIT_NAME_FALLBACK = 'there';

function recruitStr_(v) { return String(v == null ? '' : v).trim(); }


function recruitHouseSheet_(tab) {
  try {
    if (typeof houseMoved_ !== 'function' || !houseMoved_(tab)) return null;
    return (typeof houseSheetFor_ === 'function') ? houseSheetFor_(tab) : null;
  } catch (e) { return null; }
}

// Rewritten whole: the book has no trustworthy row key.
function recruitIngestOne_(data) {
  var d = data || {};
  var tab = recruitStr_(d.tab);
  var out = { tab: tab, state: 'refused', rows: 0, columns: 0, fingerprint: recruitStr_(d.fingerprint), why: '' };
  if (!RECRUIT_HOUSES[tab]) { out.why = 'not a house this door writes'; return out; }
  var header = Array.isArray(d.header) ? d.header.map(function (h) { return String(h == null ? '' : h); }) : [];
  var rows = Array.isArray(d.rows) ? d.rows : [];
  if (!header.length || header[0] !== 'id') {
    out.why = 'the copy carries no header led by `id` — nothing was written';
    return out;
  }
  if (!rows.length) {
    out.why = 'the copy carries no rows — the house was left as it stands';
    return out;
  }
  var sheet = recruitHouseSheet_(tab);
  if (!sheet) {
    out.state = 'no_house';
    out.why = 'the house for ' + tab + ' is not declared — run tools/mint_recruit_houses.py; the relay ' +
              'offers the copy again later';
    return out;
  }
  var width = header.length;
  var grid = [header];
  for (var i = 0; i < rows.length; i++) {
    var line = Array.isArray(rows[i]) ? rows[i].slice(0, width) : [];
    while (line.length < width) line.push('');
    grid.push(line.map(function (c) { return c == null ? '' : String(c); }));
  }
  if (typeof laneMirrorSafeRows_ === 'function') laneMirrorSafeRows_(grid);
  try {
    if (sheet.getMaxRows() < grid.length) sheet.insertRowsAfter(sheet.getMaxRows(), grid.length - sheet.getMaxRows());
    if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
    sheet.clearContents();
    sheet.getRange(1, 1, grid.length, width).setValues(grid);
    sheet.setFrozenRows(1);
  } catch (e) {
    out.state = 'failed';
    out.why = 'the house could not be written: ' + String((e && e.message) || e).slice(0, 200);
    return out;
  }
  out.state = 'written';
  out.rows = rows.length;
  out.columns = width;
  out.why = rows.length + ' row(s) of "' + RECRUIT_HOUSES[tab].source_tab + '", the whole tab';
  try {
    hubSysLog_(RECRUIT_PASS_BY, 'recruit_house_written', tab + ': ' + out.why, { status: 200 });
  } catch (eL) {}
  return out;
}

HUB_POLICY.recruitBookIngest = {
  file: 'CommRecruit.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  // Empty on purpose: the handler admits the relay's service identity or an admin.
  roles: [],
  invalidates: [],
  emits: []
};
HUB_ACTIONS.recruitBookIngest = function (payload, user) {
  if (!user || (!user.is_service && String(user.role) !== 'admin')) return hubDenied_();
  // GATED (gate_recruit_book_ingest, SmartGate.gs).
  var recruitGate = (typeof hubIngestGate_ === 'function')
    ? hubIngestGate_('gate_recruit_book_ingest',
                     { subject: 'the recruiters\' book feed',
                       body: 'recruiter rows written back into the live house' })
    : null;
  if (recruitGate) return recruitGate;
  return { status: 200, data: recruitIngestOne_(payload || {}) };
};


function recruitSituation_(sid) {
  var key = RECRUIT_SITUATIONS[sid];
  if (!key) return null;
  var id = (typeof commSituationId_ === 'function') ? commSituationId_(key, sid) : sid;
  var sit = (typeof smartSituationOn_ === 'function') ? smartSituationOn_(id) : null;
  if (!sit) return null;
  var chans = (typeof smartList_ === 'function') ? smartList_(sit.channels) : [];
  if (chans.indexOf('sms') === -1 || !recruitStr_(sit.sms_text)) return null;
  return sit;
}

function recruitDayWords_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(recruitStr_(iso));
  if (!m) return '';
  var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
                'October', 'November', 'December'];
  var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return days[d.getUTCDay()] + ', ' + months[d.getUTCMonth()] + ' ' + d.getUTCDate();
}

function recruitVars_(r, sit) {
  var first = recruitStr_(r.first_name) || recruitStr_(r.name).split(/\s+/)[0] || RECRUIT_NAME_FALLBACK;
  var screener = recruitStr_(r.screener);
  if (String(r.situation) === 'hiring_onboarding_start' && !screener) screener = RECRUIT_SCREENER_FALLBACK;
  return {
    first_name: first,
    name: recruitStr_(r.name) || first,
    screener: screener,
    time: recruitStr_(r.time),
    location: recruitStr_(r.location).replace(/[.\s]+$/, ''),
    date: recruitDayWords_(r.date),
    sender: recruitStr_(sit && sit.sender) ||
            ((typeof SMART_SENDER_DEFAULT !== 'undefined') ? SMART_SENDER_DEFAULT : '')
  };
}

function recruitNumber_(raw) {
  var s = recruitStr_(raw);
  var shared = false, ours = false;
  try { shared = (typeof hubLineSharedForIdentity_ === 'function') && hubLineSharedForIdentity_(s); }
  catch (e1) { shared = false; }
  if (!shared) {
    try { shared = (typeof hubSharedLine_ === 'function') && hubSharedLine_(s); } catch (e2) { shared = false; }
  }
  if (shared) return { to: '', state: 'shared_line', why: 'that number is a shared line — it names nobody' };
  try { ours = (typeof hubLineOurs_ === 'function') && hubLineOurs_(s); } catch (e3) { ours = false; }
  if (ours) return { to: '', state: 'our_line', why: 'that number is one of our own lines' };
  var to = (typeof packetSendableNumber_ === 'function') ? packetSendableNumber_(s) : '';
  if (!to) return { to: '', state: 'no_number', why: 'no number we may text on the row' };
  return { to: to, state: '', why: '' };
}

function recruitPacing_(sit) {
  var most = parseInt(recruitStr_(sit && sit.max_attempts), 10);
  if (isNaN(most) || most < 1) most = 1;
  var word = recruitStr_(sit && sit.frequency).toLowerCase() || 'once';
  var gap = (typeof SMART_FREQUENCIES !== 'undefined' && SMART_FREQUENCIES.hasOwnProperty(word))
    ? SMART_FREQUENCIES[word] : 0;
  return { max: gap > 0 ? most : 1, gap_days: gap };
}

// refused_quiet, dial_unknown, held and failed are retried; every other state is final.
function recruitTellOne_(r, env) {
  var res = { id: recruitStr_(r && r.id), state: '', why: '', detail: '',
              words: '', words_chars: 0, to_masked: '', line: '', channel: '' };
  var done = function (state, why) { res.state = state; res.why = String(why || ''); return res; };
  var sid = recruitStr_(r && r.situation);
  if (!res.id || !RECRUIT_SITUATIONS[sid]) return done('refused', 'not a row this door knows');
  if (env.quiet) {
    return done('refused_quiet', 'inside the quiet window (' +
                ((typeof hubQuietWords_ === 'function') ? hubQuietWords_() : '21:31-07:59 New York') +
                '): nothing is said, and the relay offers it again after it');
  }
  if (!env.dialReadable) {
    return done('dial_unknown', 'the sending dial could not be read: nothing is said or written, and the ' +
                'relay asks again');
  }
  if (env.dial !== 'send' && env.dial !== 'record') {
    return done('dial_off', 'the sending dial stands at `' + env.dial + '`: nothing is said or written');
  }
  var sit = env.sits[sid];
  if (!sit) return done('held', 'the situation ' + sid + ' is off on the Desk or has no text to send');
  if (sid === 'hiring_bci_howto') {
    var pace = recruitPacing_(sit);
    res.max = pace.max;
    res.gap_days = pace.gap_days;
  }
  var deadline = Date.parse(recruitStr_(r.deadline));
  if (!isNaN(deadline) && env.nowMs >= deadline) {
    return done('stale', 'the screen has started — no reminder after it');
  }
  var num = recruitNumber_(r.phone);
  if (!num.to) return done(num.state, num.why);
  var vars = recruitVars_(r, sit);
  if (sid === 'hiring_screen_day_reminder' && (!vars.time || !vars.location || !vars.screener)) {
    return done('refused', 'the reminder cannot say the screen\'s time, place and house manager');
  }
  var body = smartRender_(sit.sms_text, vars);
  var fromLine = recruitStr_(sit.from_line);
  var reason = 'hiring book: ' + sid;
  var person = vars.name;
  var intent = 'RB|' + res.id;
  var lineName = fromLine ||
    ((typeof RPC_DEFAULT_LINE_NAME !== 'undefined') ? RPC_DEFAULT_LINE_NAME : 'Automations');
  var lineWords = 'from ' + lineName;

  // THE COPY, ANSWERED BACK.
  res.words = String(body).slice(0, RECRUIT_WORDS_MAX);
  res.words_chars = String(body).length;
  res.to_masked = (typeof rpcMaskTo_ === 'function') ? rpcMaskTo_(num.to) : '';
  res.line = lineName;
  res.channel = 'sms';

  // This branch skips the door, so it must consult the opt-out list itself.
  if (!commDialHandsOver_(env.dial)) {
    var stop = '';
    try { stop = (typeof optOutBlocked_ === 'function') ? optOutBlocked_(num.to) : ''; }
    catch (eO) { stop = 'The opt-out list could not be checked: ' + String((eO && eO.message) || eO); }
    if (stop) return done('opted_out', stop);
    var why = (typeof commDialHeldWhy_ === 'function')
      ? commDialHeldWhy_(env.dial, 1, 'the candidate on the recruiters\' book')
      : 'the sending dial stands at `' + env.dial + '`, not `send`';
    var noted = '';
    try {
      noted = (typeof hubRehearsalHeld_ === 'function') ? hubRehearsalHeld_({
        situation: sid, intent_key: intent, person_key: recruitStr_(r.phone).replace(/\D/g, '').slice(-10),
        person_name: person, purpose: 'hiring book · ' + lineWords, verdict: 'recorded',
        pass_by: RECRUIT_PASS_BY, reasons: why, channel: 'sms', to: num.to, body: body,
        sender_used: vars.sender, reason: reason, to_name: person
      }) : '';
    } catch (eN) { noted = ''; }
    return done('recorded', 'the sending dial stands at `' + env.dial + '`: nobody was contacted' +
                (noted ? ' — the text is in the rehearsal book and the mock outbox'
                       : ' — and the rehearsal row could not be written'));
  }

  var heldR = (typeof HUB_REHEARSAL_CTX !== 'undefined') ? HUB_REHEARSAL_CTX : null;
  var heldM = (typeof COMM_MOCK_CTX !== 'undefined') ? COMM_MOCK_CTX : null;
  var sms = null;
  try {
    HUB_REHEARSAL_CTX = { pass_by: RECRUIT_PASS_BY, situation: sid, intent_key: intent,
                          person_key: recruitStr_(r.phone).replace(/\D/g, '').slice(-10), person_name: person,
                          purpose: 'hiring book', sender_used: vars.sender };
    COMM_MOCK_CTX = { situation: sid, person_name: person, ledger_key: intent,
                      purpose: 'hiring book · ' + lineWords };
    sms = rpcCall_('smsSend', { to: num.to, body: body, reason: reason, from_line: fromLine },
                   { idempotency_key: 'recruit_' + String(res.id).replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 60) +
                                      '_' + (parseInt(r.slot, 10) || 1) });
  } catch (eS) {
    sms = { ok: false, sent: false, error: 'transport', detail: String((eS && eS.message) || eS) };
  } finally {
    HUB_REHEARSAL_CTX = heldR;
    COMM_MOCK_CTX = heldM;
  }
  if (sms && sms.quiet) {
    return done('refused_quiet', 'the send door\'s quiet window: nothing is said, and the relay offers it again ' +
                'after it');
  }
  if (sms && sms.sent) {
    if (!sms.redirected && typeof smartRecord_ === 'function') {
      try { smartRecord_(intent, sid, person, recruitStr_(r.date), 'sms'); } catch (eR) {}
    }
    return done(sms.redirected ? 'redirected' : 'told', sms.redirected ? 'test mode sent it to the testers' : '');
  }
  if (sms && sms.rehearsed) return done('rehearsed', recruitStr_(sms.detail));
  if (sms && sms.recorded_to) return done('recorded', 'written into ' + recruitStr_(sms.recorded_to));
  if (sms && sms.deduplicated) return done('duplicate', 'this exact text already went');
  if (sms && sms.reason === 'opted_out') return done('opted_out', recruitStr_(sms.detail));
  if (sms && sms.gated) return done('held', recruitStr_(sms.reason) || 'the send door held it');
  res.detail = recruitStr_(sms && sms.error);
  return done('failed', recruitStr_((sms && (sms.detail || sms.error)) || 'the send door gave no answer'));
}

HUB_POLICY.recruitTell = {
  file: 'CommRecruit.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [],
  emits: ['smsSend']
};
HUB_ACTIONS.recruitTell = function (payload, user) {
  if (!user || (!user.is_service && String(user.role) !== 'admin')) return hubDenied_();
  var data = payload || {};
  var rows = Array.isArray(data.rows) ? data.rows.slice(0, RECRUIT_MAX_ROWS) : [];
  var out = { results: [], counts: {}, dial: '' };
  if (!rows.length) return { status: 200, data: out };
  var now = new Date();
  // An unreadable dial is `dial_unknown`, never `off`.
  var dialState = { word: 'off', readable: false };
  try { dialState = commDialState_(); } catch (eD) { dialState = { word: 'off', readable: false }; }
  var sits = {};
  Object.keys(RECRUIT_SITUATIONS).forEach(function (sid) {
    try { sits[sid] = recruitSituation_(sid); } catch (eS) { sits[sid] = null; }
  });
  var env = {
    now: now, nowMs: now.getTime(),
    quiet: (typeof hubQuietAt_ === 'function') ? hubQuietAt_() : false,
    dial: String(dialState.word || 'off'), dialReadable: dialState.readable !== false,
    sits: sits
  };
  out.dial = env.dialReadable ? env.dial : 'unknown';
  var begun = Date.now();
  rows.forEach(function (raw) {
    var r = raw || {};
    var res;
    if (Date.now() - begun > RECRUIT_START_BUDGET_MS) {
      res = { id: recruitStr_(r.id), state: 'failed',
              why: 'this execution spent its time on the rows before it; the relay offers it again' };
    } else {
      try { res = recruitTellOne_(r, env); }
      catch (e) {
        res = { id: recruitStr_(r.id), state: 'failed',
                why: 'the lane threw: ' + String((e && e.message) || e).slice(0, 200) };
      }
    }
    out.counts[res.state] = (out.counts[res.state] || 0) + 1;
    out.results.push(res);
  });
  try {
    hubSysLog_(RECRUIT_PASS_BY, 'recruit_tell', rows.length + ' text(s): ' + JSON.stringify(out.counts),
               { status: 200 });
  } catch (eLg) {}
  return { status: 200, data: out };
};
