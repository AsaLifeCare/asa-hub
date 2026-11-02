function stOpenShiftCovered_(out) {
  var keep = {
    rows: commCallOffRows_, upsert: commRecordUpsert_, on: smartSituationOn_, sits: smartSituations_,
    dialState: commDialState_, dial: commDial_, test: commTestMode_, sheet: hubRehearsalToSheet_,
    rhWrite: hubRehearsalWrite_, mockWrite: commMockWrite_, mockDead: COMM_MOCK_DEAD,
    mockWritten: COMM_MOCK_WRITTEN, mockSeen: commMockQuietSeen_,
    optIdx: (typeof optOutIndex_ === 'function') ? optOutIndex_ : null,
    transport: RPC_TEST_TRANSPORT, force: RPC_TEST_FORCE_ON, now: HUB_QUIET_NOW,
    log: hubSysLog_, record: smartRecord_, every: commCallOffEveryoneAudience_,
    master: HUB_MASTER_EMAIL_CACHE, budget: COMM_CALLOFF_BLAST_BUDGET_MS, cap: COMM_CALLOFF_BLAST_MAX,
    qProps: commCallOffQuietProps_, qLock: commCallOffQuietLocked_, qNow: commCallOffQuietNow_,
    ctx: commCallOffContext_, truth: commCallOffQuietTruth_, others: commCallOffTellOthers_
  };
  var r = {};
  var DAY = '2026-09-22T16:00:00Z';            // the send door's clock runs in New York
  var NIGHT = '2026-09-23T03:00:00Z';
  var nowMs = Date.now();
  var TODAY = Utilities.formatDate(new Date(nowMs), 'America/New_York', 'yyyy-MM-dd');
  var LATER = new Date(nowMs + 6 * 3600000).toISOString();
  var EARLIER = new Date(nowMs - 3600000).toISOString();
  var JH = 'CAN - JH - ABD2704';
  var rows = {}, sent = [], rhRows = [], mockRows = [], ledger = [];
  var dialNow = { word: 'record', readable: true }, testOn = true, sitOn = true;
  var coveredWords = SMART_OPEN_SHIFT_COVERED_TEXT;
  var copy = function (o) { return JSON.parse(JSON.stringify(o)); };
  var coveredRow = function () {
    return { id: 'open_shift_covered', enabled: sitOn ? 'yes' : 'no', kind: 'event',
             event: 'open_shift_covered', channels: 'sms', sms_text: coveredWords,
             email_subject: '', email_text: '', to: '', cc: '' };
  };
  var everyoneRow = { id: 'call_off_everyone', enabled: 'yes', kind: 'call_off', channels: 'sms',
                      to: 'allstaff', sms_text: 'URGENT OPEN SHIFT\nCan anyone pick up a shift {day_word}?',
                      email_subject: '', email_text: '' };
  var aud3 = [{ to: '+13305550101', name: 'Ann Able' }, { to: '+13305550102', name: 'Ben Baker' },
              { to: '+13305550103', name: 'Cal Coe' }];
  // Per-run ids: the send door remembers idempotency keys for six hours.
  var run = 'osc' + String(Date.now()).slice(-8) + '-';
  var R = function (name) { return rows[run + name]; };
  var callOff = function (name, over) {
    var id = run + name;
    var base = { id: id, instance: 'st-osc:' + id, kind: 'call_off', shift_date: TODAY,
                 person_name: 'Zed Caller', person_key: 'zedcaller', source: 'hotline',
                 everyone_state: 'told', everyone_at: new Date(nowMs - 600000).toISOString(),
                 everyone_audience: commCallOffAudienceCell_(aud3, TODAY, JH) };
    for (var k in (over || {})) if (Object.prototype.hasOwnProperty.call(over, k)) base[k] = over[k];
    rows[id] = base;
    return base;
  };
  var fill = function (over) {
    var base = { id: JH + '|Zed Caller|' + TODAY, kind: 'open_shift_covered', location: JH, house: 'ABD2704',
                 house_name: 'JH home', address: '2407 Harrison Ave', open_row: 'Zed Caller',
                 called_off_by: 'Zed Caller', col_iso: TODAY, value: '2P-10P', shift_start: '',
                 shift_end: LATER, start_hm: '14:00', filled_by: 'Ann Able', filled_how: 'approved',
                 decided_by: 'Mary Manager', filled_at: new Date(nowMs).toISOString() };
    for (var k in (over || {})) if (Object.prototype.hasOwnProperty.call(over, k)) base[k] = over[k];
    return base;
  };
  var svc = { is_service: true, role: 'admin' };
  var door = function (list) { return HUB_ACTIONS.openShiftCovered({ rows: list }, svc); };
  var one = function (f) {
    var res = door([f]);
    return (res && res.data && res.data.results && res.data.results[0]) || { state: 'no answer', res: res };
  };
  try {
    commCallOffRows_ = function () { return copy(rows); };
    commRecordUpsert_ = function (house, patch) {
      var id = String((patch && patch.id) || '');
      if (!id) return true;
      rows[id] = rows[id] || { id: id };
      for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) rows[id][k] = patch[k];
      return true;
    };
    smartSituationOn_ = function (id) {
      if (id === 'open_shift_covered') return sitOn ? coveredRow() : null;
      if (id === 'call_off_everyone') return everyoneRow;
      return null;
    };
    smartSituations_ = function () { return [coveredRow(), everyoneRow]; };
    commDialState_ = function () { return copy(dialNow); };
    commDial_ = function () { return dialNow.word; };
    commTestMode_ = function () { return testOn; };
    hubRehearsalToSheet_ = function () { return testOn; };
    hubRehearsalWrite_ = function (row) { rhRows.push(row); return row.id; };
    COMM_MOCK_DEAD = {};
    COMM_MOCK_WRITTEN = 0;
    commMockWrite_ = function (row) { mockRows.push(row); };
    commMockQuietSeen_ = function () { return false; };
    if (keep.optIdx) optOutIndex_ = function () { return { by: {}, error: '' }; };
    RPC_TEST_TRANSPORT = function (name, p) {
      sent.push({ name: name, to: String(p.to || ''), body: String(p.body || '') });
      return { ok: true, sent: true, gated: false, method: name, receipt: 'st-osc-' + sent.length };
    };
    RPC_TEST_FORCE_ON = true;
    hubSysLog_ = function () {};
    smartRecord_ = function (key) { ledger.push(key); return true; };
    HUB_MASTER_EMAIL_CACHE = 'boss@example.org';
    HUB_QUIET_NOW = DAY;

    commCallOffEveryoneAudience_ = function () {
      return { ok: true, readable: true, missing: '', why: '',
               people: [{ person_key: 'annable', name: 'Ann Able', phone: '+13305550101' },
                        { person_key: 'benbaker', name: 'Ben Baker', email: 'ben@example.org' },
                        { person_key: 'calcoe', name: 'Cal Coe', phone: '+13305550103' }] };
    };
    var place = { house: JH, manager: '', reason: 'she is at the hospital', shift_day: TODAY, day_from_call: true };
    var facts = { kind: 'call_off', date: TODAY, name: 'Zed Caller', name_from: 'person', person_key: 'zedcaller' };
    rows[run + 'B1'] = { id: run + 'B1' };
    commCallOffTellOthers_(run + 'B1', facts, 'st-osc:' + run + 'b1', place,
                           { test: false, dial: 'record', nowIso: new Date(nowMs).toISOString(), nowMs: nowMs },
                           null, { everyone: true });
    r.keptRecord = copy(R('B1'));
    rows[run + 'B2'] = { id: run + 'B2' };
    testOn = false;
    var s0 = sent.length;
    commCallOffTellOthers_(run + 'B2', facts, 'st-osc:' + run + 'b2', place,
                           { test: false, dial: 'send', nowIso: new Date(nowMs).toISOString(), nowMs: nowMs },
                           null, { everyone: true });
    r.keptSend = copy(R('B2'));
    r.keptSendSent = sent.slice(s0);
    rows = {};
    commCallOffEveryoneAudience_ = keep.every;
    r.cellRound = commCallOffAudienceRead_(commCallOffAudienceCell_(aud3, TODAY, JH));
    r.cellBlank = commCallOffAudienceRead_('');
    r.cellJunk = commCallOffAudienceRead_('{not json');

    r.staffDoor = HUB_ACTIONS.openShiftCovered({ rows: [fill()] },
                                               { email: 's@example.org', role: 'staff', types: [] });
    r.emptyDoor = HUB_ACTIONS.openShiftCovered({ rows: [] }, svc);

    testOn = true; dialNow = { word: 'record', readable: true };
    callOff('T1', { everyone_state: 'recorded' });
    s0 = sent.length;
    var rh0 = rhRows.length, m0 = mockRows.length;
    r.test = one(fill());
    r.testSent = sent.length - s0;
    r.testRh = rhRows.slice(rh0);
    r.testMock = mockRows.slice(m0);
    r.testRow = copy(R('T1'));
    r.testAgain = one(fill());
    r.testAgainRows = rhRows.length - rh0;
    rows = {};

    testOn = false; dialNow = { word: 'send', readable: true };
    callOff('P1');
    s0 = sent.length;
    var l0 = ledger.length;
    var both = door([fill(), fill()]);
    r.prod = both.data.results[0];
    r.prodTwiceInOnePost = both.data.results[1];
    r.prodSent = sent.slice(s0);
    r.prodLedger = ledger.slice(l0);
    r.prodRow = copy(R('P1'));
    s0 = sent.length;
    r.prodAgain = one(fill());
    r.prodAgainSent = sent.length - s0;
    rows = {};

    callOff('W1', { everyone_state: 'recorded' });
    s0 = sent.length;
    r.written = one(fill());
    rows = {};
    callOff('N1', { everyone_state: 'not_owed', everyone_audience: '' });
    r.notOwed = one(fill());
    rows = {};
    callOff('U1', { everyone_audience: '' });
    r.unknown = one(fill());
    r.nobodySent = sent.length - s0;
    rows = {};

    callOff('D1', { everyone_state: 'deferred' });
    s0 = sent.length;
    r.dropped = one(fill());
    r.droppedRow = copy(R('D1'));
    r.droppedSent = sent.length - s0;
    var qStore = {};
    commCallOffQuietProps_ = function () {
      return { getProperty: function (k) { return Object.prototype.hasOwnProperty.call(qStore, k) ? qStore[k] : null; },
               setProperty: function (k, v) { qStore[k] = String(v); },
               deleteProperty: function (k) { delete qStore[k]; } };
    };
    commCallOffQuietLocked_ = function (fn) { return fn(); };
    commCallOffQuietNow_ = function () { return false; };
    commCallOffContext_ = function () { return { nowMs: nowMs, nowIso: new Date(nowMs).toISOString(), test: false, dial: 'send' }; };
    commCallOffQuietTruth_ = function (entry) {
      return { why: '', facts: facts, place: commCallOffPlace_((entry && entry.place) || {}) };
    };
    var carried = [];
    commCallOffTellOthers_ = function (id, f, inst, pl, c, ack, only) {
      carried.push({ id: id, legs: Object.keys(only || {}).sort().join(',') });
      return {};
    };
    var qMap = {};
    qMap[run + 'D1'] = { legs: ['house_manager', 'cover_offer', 'everyone', 'directors'],
                         at: new Date(nowMs).toISOString(), place: { house: JH } };
    qStore[COMM_CALLOFF_QUIET_PROP] = JSON.stringify(qMap);
    r.carry = commCallOffQuietCarry_();
    r.carried = carried;
    r.carryRow = copy(R('D1'));
    commCallOffQuietProps_ = keep.qProps; commCallOffQuietLocked_ = keep.qLock; commCallOffQuietNow_ = keep.qNow;
    commCallOffContext_ = keep.ctx; commCallOffQuietTruth_ = keep.truth; commCallOffTellOthers_ = keep.others;
    rows = {};

    callOff('Q1');
    HUB_QUIET_NOW = NIGHT;
    s0 = sent.length;
    r.quiet = one(fill());
    r.quietRow = copy(R('Q1'));
    r.quietSent = sent.length - s0;
    HUB_QUIET_NOW = DAY;
    r.quietMorning = one(fill());
    rows = {};

    callOff('S1');
    s0 = sent.length;
    r.stale = one(fill({ shift_end: EARLIER }));
    rows = {};
    callOff('O1');
    sitOn = false;
    r.off = one(fill());
    sitOn = true;
    rows = {};
    callOff('X1');
    dialNow = { word: 'off', readable: false };
    r.blind = one(fill());
    r.blindRow = copy(R('X1'));
    dialNow = { word: 'send', readable: true };
    r.overSent = sent.length - s0;
    rows = {};
    callOff('C1');
    COMM_CALLOFF_BLAST_MAX = 1;
    s0 = sent.length;
    r.cut = one(fill());
    r.cutSent = sent.length - s0;
    COMM_CALLOFF_BLAST_MAX = keep.cap;
    r.cutAgain = one(fill());
    rows = {};
    callOff('C2');
    COMM_CALLOFF_BLAST_MAX = 2;
    RPC_TEST_FORCE_ON = false;
    s0 = sent.length;
    r.cutHeld = one(fill());
    r.cutHeldSent = sent.length - s0;
    RPC_TEST_FORCE_ON = true;
    COMM_CALLOFF_BLAST_MAX = keep.cap;
    rows = {};
    callOff('C3');
    COMM_CALLOFF_BLAST_BUDGET_MS = -1;
    s0 = sent.length;
    r.cutZero = one(fill());
    r.cutZeroRow = copy(R('C3'));
    r.cutZeroSent = sent.length - s0;
    COMM_CALLOFF_BLAST_BUDGET_MS = keep.budget;
    r.cutZeroLater = one(fill());
    rows = {};
    var ticks = 0, turnAt = 0;
    commCallOffQuietNow_ = function () { ticks++; return ticks >= turnAt; };
    callOff('Q2');
    ticks = 0; turnAt = 2;                            // the door's read says day, the claim's says night
    s0 = sent.length;
    r.nightAtClaim = one(fill());
    r.nightAtClaimRow = copy(R('Q2'));
    rows = {};
    callOff('Q3');
    ticks = 0; turnAt = 3;                            // day at the claim, night at the first copy
    r.nightInLoop = one(fill());
    r.nightInLoopRow = copy(R('Q3'));
    r.nightSent = sent.length - s0;
    commCallOffQuietNow_ = keep.qNow;
    rows = {};

    r.none = one(fill());
    callOff('L1', { person_name: 'Zed Q Caller', person_key: 'zedqcaller' });
    s0 = sent.length;
    r.loose = one(fill());
    r.looseSent = sent.length - s0;
    rows = {};
    callOff('A1', { person_name: 'Zed Caller Jr', person_key: 'zedcallerjr' });
    callOff('A2', { person_name: 'Zed Caller Sr', person_key: 'zedcallersr' });
    r.ambiguous = one(fill());
    rows = {};
    callOff('H1', { everyone_audience: commCallOffAudienceCell_(aud3, TODAY, 'CAN - MS - MS4060') });
    r.otherHouse = one(fill());
    rows = {};
    callOff('J1');
    callOff('J2', { instance: 'form:x', source: 'form',
                    everyone_audience: commCallOffAudienceCell_([aud3[2], { to: '+13305550104', name: 'Dee Dunn' }],
                                                                TODAY, '') });
    s0 = sent.length;
    r.joined = one(fill());
    r.joinedSent = sent.slice(s0).map(function (x) { return x.to; });
    rows = {};

    coveredWords = 'OPEN SHIFT COVERED\n{employee} called off; {house} {day_word} is covered.\nReason: {reason}\nThank you';
    callOff('V1');
    s0 = sent.length;
    r.words = one(fill());
    r.wordsSent = sent.slice(s0);
    coveredWords = SMART_OPEN_SHIFT_COVERED_TEXT;
    rows = {};
    var gapVars = { house: '', time: '', day_word: 'today', location: '', date: TODAY, sender: 'x' };
    r.render = smartRender_(openShiftCoveredWords_(coveredRow(), gapVars).sms_text, gapVars);

    callOff('K1', { covered_state: 'told', covered_why: '3 of 3 told · filled by Ann Able, applied and approved',
                    covered_at: new Date(nowMs).toISOString(), covered_count: '3/3',
                    covered_filled_at: new Date(nowMs).toISOString() });
    callOff('K2');
    r.hmBoard = HUB_ACTIONS.openShiftCoveredBoard({}, { email: 'ann@example.org', display_name: 'Ann Able',
                                                        role: 'manager', types: ['HM'] });
    r.staffBoard = HUB_ACTIONS.openShiftCoveredBoard({}, { email: 's@example.org', display_name: 'Sam',
                                                           role: 'staff', types: [] });
  } catch (e) {
    r.error = String((e && e.message) || e) + ' ' + String((e && e.stack) || '').slice(0, 400);
  } finally {
    commCallOffRows_ = keep.rows; commRecordUpsert_ = keep.upsert; smartSituationOn_ = keep.on;
    smartSituations_ = keep.sits; commDialState_ = keep.dialState; commDial_ = keep.dial;
    commTestMode_ = keep.test; hubRehearsalToSheet_ = keep.sheet; hubRehearsalWrite_ = keep.rhWrite;
    commMockWrite_ = keep.mockWrite; COMM_MOCK_DEAD = keep.mockDead; COMM_MOCK_WRITTEN = keep.mockWritten;
    commMockQuietSeen_ = keep.mockSeen;
    if (keep.optIdx) optOutIndex_ = keep.optIdx;
    RPC_TEST_TRANSPORT = keep.transport; RPC_TEST_FORCE_ON = keep.force; HUB_QUIET_NOW = keep.now;
    hubSysLog_ = keep.log; smartRecord_ = keep.record; commCallOffEveryoneAudience_ = keep.every;
    HUB_MASTER_EMAIL_CACHE = keep.master; COMM_CALLOFF_BLAST_BUDGET_MS = keep.budget;
    COMM_CALLOFF_BLAST_MAX = keep.cap;
    commCallOffQuietProps_ = keep.qProps; commCallOffQuietLocked_ = keep.qLock; commCallOffQuietNow_ = keep.qNow;
    commCallOffContext_ = keep.ctx; commCallOffQuietTruth_ = keep.truth; commCallOffTellOthers_ = keep.others;
  }

  var J = function (o) { return JSON.stringify(o === undefined ? null : o).slice(0, 700); };
  stAssert_(out, 'open shift covered: the section ran to the end', !r.error, r.error);

  var seed = null;
  SMART_EXTRA_SITUATIONS_SEED.forEach(function (s) { if (s.id === 'open_shift_covered') seed = s; });
  stAssert_(out, 'open shift covered: the row ships ON, by text, with NO `to` or `cc` — the audience is the blast\'s own ' +
                 'list — and its words say which shift and never why or who',
            !!seed && seed.enabled === 'yes' && seed.kind === 'event' && seed.event === 'open_shift_covered' &&
            seed.channels === 'sms' && seed.to === '' && seed.cc === '' &&
            seed.sms_text === SMART_OPEN_SHIFT_COVERED_TEXT &&
            /\{house\}/.test(seed.sms_text) && /\{day_word\}/.test(seed.sms_text) &&
            !/\{(reason|employee)\}/.test(seed.sms_text) && /^[\x00-\x7F]*$/.test(seed.sms_text), J(seed));
  stAssert_(out, 'open shift covered: fired by its own file and never by the sweep — the event cannot fire, the sender ' +
                 'is named, and the sweep answers its subject with no rows',
            !!SMART_EVENTS.open_shift_covered &&
            stCode_(SMART_EVENTS.open_shift_covered.applies).indexOf('fires: false') !== -1 &&
            SMART_EVENT_SENDERS.open_shift_covered === 'CommOpenShiftCovered.gs' &&
            stCode_(smartEventSweep_).indexOf("=== 'open_shift') return []") !== -1, '');
  stAssert_(out, 'open shift covered: the relay may knock (named in the service list and the Guardian\'s event mirror), ' +
                 'a person may not, and the door declares what it can send',
            SERVICE_SWEEP_ACTIONS.indexOf('openShiftCovered') !== -1 &&
            GUARDIAN_RELAY_EVENT_ACTIONS.indexOf('openShiftCovered') !== -1 &&
            HUB_POLICY.openShiftCovered.file === 'CommOpenShiftCovered.gs' &&
            HUB_POLICY.openShiftCovered.emits.indexOf('smsSend') !== -1 &&
            HUB_POLICY.openShiftCoveredBoard.emits.length === 0 &&
            OPT_OUT_SCOPE_BY_FILE['CommOpenShiftCovered.gs'] === 'staff' &&
            !!r.staffDoor && r.staffDoor.status === 403 &&
            !!r.emptyDoor && r.emptyDoor.status === 200, J({ staff: r.staffDoor, empty: r.emptyDoor }));
  stAssert_(out, 'open shift covered: the call-off row grew the cells the follow-up needs, and its claim is its own',
            COMM_CALLOFF_HEADER.indexOf('everyone_audience') !== -1 &&
            COMM_CALLOFF_HEADER.indexOf('covered_filled_at') !== -1 &&
            ['covered_state', 'covered_test_state', 'covered_at', 'covered_why'].every(function (c) {
              return COMM_CALLOFF_HEADER.indexOf(c) !== -1;
            }) &&
            COMM_CALLOFF_STATE_COLS.covered.prod === 'covered_state' &&
            COMM_CALLOFF_STATE_COLS.covered.prod !== COMM_CALLOFF_STATE_COLS.everyone.prod, '');

  var kr = commCallOffAudienceRead_((r.keptRecord || {}).everyone_audience);
  var ks = commCallOffAudienceRead_((r.keptSend || {}).everyone_audience);
  stAssert_(out, 'open shift covered: a blast the dial held keeps the list it RESOLVED, with the day it said and the ' +
                 'house the call named',
            (r.keptRecord || {}).everyone_state === 'recorded' && kr.readable && kr.day === TODAY && kr.house === JH &&
            kr.to.length === 3, J(kr));
  stAssert_(out, 'open shift covered: a blast that sent keeps only the addresses it REACHED — the e-mail the text row ' +
                 'could not send to is not on it',
            (r.keptSend || {}).everyone_state === 'told' && ks.readable &&
            ks.to.map(function (a) { return a.to; }).join(',') === '+13305550101,+13305550103' &&
            (r.keptSendSent || []).length === 2, J({ ks: ks, sent: r.keptSendSent, row: r.keptSend }));
  stAssert_(out, 'open shift covered: the kept list reads back as it was written, and a blank or broken cell is one ' +
                 'nobody can read',
            r.cellRound.readable && r.cellRound.to.length === 3 && r.cellRound.to[1].name === 'Ben Baker' &&
            r.cellBlank.readable === false && r.cellJunk.readable === false, J(r.cellRound));

  stAssert_(out, 'open shift covered: in test mode the follow-up is ONE row in the rehearsal book and ONE in the mock ' +
                 'outbox for the whole audience — nothing reaches the transport — and the row says `recorded`',
            (r.test || {}).state === 'recorded' && r.testSent === 0 &&
            (r.testRh || []).length === 1 && (r.testMock || []).length === 1 &&
            r.testRh[0].situation === 'open_shift_covered' &&
            String(r.testRh[0].body).indexOf('OPEN SHIFT COVERED') === 0 &&
            String(r.testRh[0].body).indexOf('JH home at 2pm today') !== -1 &&
            String(r.testMock[0].audience) === '3' &&
            (r.testRow || {}).covered_state === 'recorded' && !!(r.testRow || {}).covered_filled_at,
            J({ test: r.test, rh: r.testRh, mock: r.testMock, row: r.testRow }));
  stAssert_(out, 'open shift covered: offered again, it is `duplicate` and writes nothing',
            (r.testAgain || {}).state === 'duplicate' && r.testAgainRows === 1, J(r.testAgain));

  stAssert_(out, 'open shift covered: in production one text goes to each address the ask reached — and to NOBODY ' +
                 'else — in the Desk\'s words, with no caller and no reason in them',
            (r.prod || {}).state === 'told' && (r.prod || {}).count === '3/3' &&
            (r.prodSent || []).map(function (x) { return x.to; }).join(',') === '+13305550101,+13305550102,+13305550103' &&
            (r.prodSent || []).every(function (x) {
              return x.body.indexOf('OPEN SHIFT COVERED') === 0 && x.body.indexOf('Zed') === -1 &&
                     x.body.indexOf('hospital') === -1 && x.body.indexOf('{') === -1;
            }), J({ prod: r.prod, sent: r.prodSent }));
  stAssert_(out, 'open shift covered: once per shift — the same fill twice in one post, or offered again later, is ' +
                 '`duplicate` and texts nobody; the ledger has one line',
            (r.prodTwiceInOnePost || {}).state === 'duplicate' && (r.prodAgain || {}).state === 'duplicate' &&
            r.prodAgainSent === 0 && (r.prodLedger || []).length === 1 &&
            (r.prodRow || {}).covered_state === 'told' && (r.prodRow || {}).covered_count === '3/3',
            J({ twice: r.prodTwiceInOnePost, again: r.prodAgain, ledger: r.prodLedger }));

  stAssert_(out, 'open shift covered: an ask that reached nobody is followed by nothing — written down while the dial ' +
                 'held it, never owed, or sent before its audience was kept',
            (r.written || {}).state === 'nobody_heard' && (r.notOwed || {}).state === 'nobody_heard' &&
            (r.unknown || {}).state === 'unknown_audience' && r.nobodySent === 0,
            J({ written: r.written, notOwed: r.notOwed, unknown: r.unknown }));

  stAssert_(out, 'open shift covered: a shift filled while its URGENT OPEN SHIFT was still held for 08:00 drops the ask ' +
                 'instead — nobody is asked, nobody is told',
            (r.dropped || {}).state === 'ask_dropped' && r.droppedSent === 0 &&
            !!(r.droppedRow || {}).covered_filled_at, J({ dropped: r.dropped, row: r.droppedRow }));
  stAssert_(out, 'open shift covered: and the morning carry lets the two ASKS go (the blast and the cover offer, ' +
                 'marked `stopped`) while the manager\'s word and the 5558 group still go',
            (r.carried || []).length === 1 && r.carried[0].legs === 'directors,house_manager' &&
            (r.carryRow || {}).everyone_state === 'stopped' && (r.carryRow || {}).offer_send_state === 'stopped' &&
            String((r.carryRow || {}).everyone_why || '').indexOf('covered before the morning') !== -1,
            J({ carried: r.carried, row: r.carryRow, carry: r.carry }));

  stAssert_(out, 'open shift covered: inside the quiet window nothing is said, the fill is written down, and the relay ' +
                 'is told to come back — at 08:00 it is told',
            (r.quiet || {}).state === 'refused_quiet' && r.quietSent === 0 &&
            !!(r.quietRow || {}).covered_filled_at && !(r.quietRow || {}).covered_state &&
            (r.quietMorning || {}).state === 'told', J({ quiet: r.quiet, row: r.quietRow, morning: r.quietMorning }));

  stAssert_(out, 'open shift covered: a shift that is over is `stale`, a row switched off is `held`, a dial nobody can ' +
                 'read is `dial_unknown` with nothing claimed — and none of them texts anybody',
            (r.stale || {}).state === 'stale' && (r.off || {}).state === 'held' &&
            (r.blind || {}).state === 'dial_unknown' && !(r.blindRow || {}).covered_state && r.overSent === 0,
            J({ stale: r.stale, off: r.off, blind: r.blind }));
  stAssert_(out, 'open shift covered: a pass cut short says how many were told and how many NEVER asked, and is ' +
                 'never retried',
            (r.cut || {}).state === 'partial' && r.cutSent === 1 && (r.cut || {}).count === '1/3' &&
            String((r.cut || {}).why).indexOf('1 told') !== -1 &&
            String((r.cut || {}).why).indexOf('2 NEVER ASKED') !== -1 && (r.cutAgain || {}).state === 'duplicate',
            J({ cut: r.cut, again: r.cutAgain }));
  stAssert_(out, 'open shift covered: "told" is only what left — copies the send door held are named as held, and ' +
                 'a pass that told nobody ends `held`, not `partial`',
            (r.cutHeld || {}).state === 'held' && r.cutHeldSent === 0 &&
            String((r.cutHeld || {}).why).indexOf('0 told') !== -1 &&
            String((r.cutHeld || {}).why).indexOf('2 held, refused or failed at the send door') !== -1 &&
            String((r.cutHeld || {}).why).indexOf('1 NEVER ASKED') !== -1, J(r.cutHeld));
  stAssert_(out, 'open shift covered: a pass that stops before its first copy gives the claim back and is offered ' +
                 'again — nothing final is written for a follow-up nobody heard',
            (r.cutZero || {}).state === 'not_yet' && r.cutZeroSent === 0 &&
            (r.cutZeroRow || {}).covered_state === 'planned' && (r.cutZeroLater || {}).state === 'told',
            J({ zero: r.cutZero, row: (r.cutZeroRow || {}).covered_state, later: r.cutZeroLater }));
  stAssert_(out, 'open shift covered: 21:31 arriving mid-post is caught at the claim (nothing claimed) and inside the ' +
                 'loop (the claim given back) — both `refused_quiet`, never a final ending with nobody told',
            (r.nightAtClaim || {}).state === 'refused_quiet' && !(r.nightAtClaimRow || {}).covered_state &&
            (r.nightInLoop || {}).state === 'refused_quiet' && (r.nightInLoopRow || {}).covered_state === 'planned' &&
            r.nightSent === 0,
            J({ claim: r.nightAtClaim, loop: r.nightInLoop, row: (r.nightInLoopRow || {}).covered_state }));

  stAssert_(out, 'open shift covered: a fill with no call-off recorded here yet is `not_yet` (the relay asks again), ' +
                 'a roster name inside the call\'s own spelling is found, and two different people are refused',
            (r.none || {}).state === 'not_yet' && (r.loose || {}).state === 'told' && r.looseSent === 3 &&
            (r.ambiguous || {}).state === 'nobody_heard' &&
            String((r.ambiguous || {}).why).indexOf('different people') !== -1,
            J({ none: r.none, loose: r.loose, amb: r.ambiguous }));
  stAssert_(out, 'open shift covered: a call-off at another house is not this shift; the hotline and the form recording ' +
                 'one absence are one shift, and everybody either ask reached is told once',
            (r.otherHouse || {}).state === 'not_yet' && (r.joined || {}).state === 'told' &&
            (r.joinedSent || []).join(',') === '+13305550101,+13305550102,+13305550103,+13305550104',
            J({ other: r.otherHouse, joined: r.joined, sent: r.joinedSent }));

  var wBody = ((r.wordsSent || [])[0] || {}).body || '';
  stAssert_(out, 'open shift covered: words rewritten on the Desk to name the caller or the reason still carry neither — ' +
                 'the placeholder goes, and a line left with nothing on it goes too',
            (r.words || {}).state === 'told' && !!wBody && wBody.indexOf('Zed') === -1 &&
            wBody.indexOf('Reason') === -1 && wBody.indexOf('{') === -1 &&
            wBody.indexOf('JH home today is covered.') !== -1, wBody);
  stAssert_(out, 'open shift covered: a missing house and hour leave their words out rather than a gap',
            r.render === 'OPEN SHIFT COVERED\nThe shift today has been covered - no need to respond.\nThank you!',
            J(r.render));

  var items = (r.hmBoard && r.hmBoard.data && r.hmBoard.data.items) || [];
  stAssert_(out, 'open shift covered: the Broadcast page shows a house manager each follow-up and what it did — never ' +
                 'who called off — and shows plain staff nothing',
            !!r.hmBoard && r.hmBoard.data.can_see === true && items.length === 1 && items[0].state === 'told' &&
            items[0].house === 'JH' && items[0].audience === 3 && J(items).indexOf('Zed') === -1 &&
            r.hmBoard.data.situation.id === 'open_shift_covered' &&
            !!r.staffBoard && r.staffBoard.data.can_see === false && r.staffBoard.data.items.length === 0,
            J({ hm: r.hmBoard, staff: r.staffBoard }));

  var oneSrc = stCode_(openShiftCoveredOne_);
  stAssert_(out, 'open shift covered: the fill is stamped before anything else, the claim is taken before the first copy, ' +
                 'and every copy goes through the one send door with its own key',
            oneSrc.indexOf('covered_filled_at') !== -1 &&
            oneSrc.indexOf('covered_filled_at') < oneSrc.indexOf('env.quiet') &&
            oneSrc.indexOf("commCallOffClaim_(") !== -1 &&
            oneSrc.indexOf("commCallOffClaim_(") < oneSrc.indexOf('commCallOffCopyTo_(') &&
            oneSrc.indexOf('rpcCall_(') === -1 &&
            oneSrc.indexOf("idem + commCallOffAddressKey_(a.to)") !== -1, '');
}
