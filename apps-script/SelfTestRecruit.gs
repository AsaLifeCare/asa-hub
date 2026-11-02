/** Self-test for CommRecruit.gs: stand-ins restored in `finally`; the send door is the real rpcCall_. */

function stRecruitBook_(out) {
  var keep = {
    on: smartSituationOn_, sits: smartSituations_, dialState: commDialState_, dial: commDial_,
    test: commTestMode_, sheet: hubRehearsalToSheet_, rhWrite: hubRehearsalWrite_,
    mockWrite: commMockWrite_, mockDead: COMM_MOCK_DEAD, mockWritten: COMM_MOCK_WRITTEN,
    mockSeen: commMockQuietSeen_, optIdx: (typeof optOutIndex_ === 'function') ? optOutIndex_ : null,
    transport: RPC_TEST_TRANSPORT, force: RPC_TEST_FORCE_ON, now: HUB_QUIET_NOW,
    log: hubSysLog_, record: smartRecord_, moved: houseMoved_, houseSheet: houseSheetFor_,
    ours: hubLineOurs_
  };
  var r = {};
  var DAY = '2026-09-22T16:00:00Z';
  var NIGHT = '2026-09-23T03:00:00Z';
  var nowMs = Date.now();
  var LATER = new Date(nowMs + 3 * 3600000).toISOString();
  var EARLIER = new Date(nowMs - 3600000).toISOString();
  var sent = [], rhRows = [], mockRows = [], ledger = [], sheetCalls = [];
  var dialNow = { word: 'record', readable: true }, testOn = true;
  var offIds = {}, blocked = {}, bciPace = { max_attempts: '1', frequency: 'once' }, textOver = {};
  var copy = function (o) { return JSON.parse(JSON.stringify(o)); };
  var sitRow = function (id) {
    var words = textOver[id] || { hiring_screen_day_reminder: SMART_RECRUIT_SCREEN_TEXT,
                  hiring_onboarding_start: SMART_RECRUIT_ONBOARD_TEXT, hiring_bci_howto: SMART_RECRUIT_BCI_TEXT }[id];
    return { id: id, enabled: offIds[id] ? 'no' : 'yes', kind: 'event', event: id, channels: 'sms',
             sms_text: words, email_subject: '', email_text: '', to: '', cc: '',
             sender: SMART_RECRUIT_SENDER, from_line: SMART_RECRUIT_LINE,
             max_attempts: id === 'hiring_bci_howto' ? bciPace.max_attempts : '1',
             frequency: id === 'hiring_bci_howto' ? bciPace.frequency : 'once' };
  };
  var allRows = function () {
    return ['hiring_screen_day_reminder', 'hiring_onboarding_start', 'hiring_bci_howto'].map(sitRow);
  };
  /* per-run ids: the send door remembers idempotency keys for six hours */
  var run = 'rb' + String(Date.now()).slice(-8) + '-';
  var svc = { is_service: true, role: 'admin' };
  var row = function (sid, over) {
    var base = { id: run + sid.slice(7, 13) + '-' + Math.floor(Math.random() * 1e6), situation: sid, slot: 1,
                 phone: '+13305550101', first_name: 'Ann', name: 'Ann Able', screener: 'Tieara',
                 time: '11AM', location: '1305 49th St, NW, Canton.', date: '2026-09-23',
                 deadline: LATER, source: 'TP-1684' };
    for (var k in (over || {})) if (Object.prototype.hasOwnProperty.call(over, k)) base[k] = over[k];
    return base;
  };
  var tell = function (list) { return HUB_ACTIONS.recruitTell({ rows: list }, svc); };
  var one = function (x) {
    var res = tell([x]);
    return (res && res.data && res.data.results && res.data.results[0]) || { state: 'no answer', res: res };
  };
  var fakeSheet = function () {
    var s = { maxRows: 10, maxCols: 3 };
    return {
      getMaxRows: function () { return s.maxRows; },
      getMaxColumns: function () { return s.maxCols; },
      insertRowsAfter: function (at, n) { s.maxRows += n; sheetCalls.push('rows+' + n); },
      insertColumnsAfter: function (at, n) { s.maxCols += n; sheetCalls.push('cols+' + n); },
      clearContents: function () { sheetCalls.push('clear'); },
      getRange: function (r0, c0, nr, nc) {
        return { setValues: function (v) { sheetCalls.push({ at: [r0, c0, nr, nc], values: v }); } };
      },
      setFrozenRows: function (n) { sheetCalls.push('frozen' + n); }
    };
  };
  try {
    smartSituationOn_ = function (id) { return offIds[id] ? null : (allRows().filter(function (x) { return x.id === id; })[0] || null); };
    smartSituations_ = function () { return allRows(); };
    commDialState_ = function () { return copy(dialNow); };
    commDial_ = function () { return dialNow.word; };
    commTestMode_ = function () { return testOn; };
    hubRehearsalToSheet_ = function () { return testOn; };
    hubRehearsalWrite_ = function (x) { rhRows.push(x); return x.id || 'rh'; };
    COMM_MOCK_DEAD = {};
    COMM_MOCK_WRITTEN = 0;
    commMockWrite_ = function (x) { mockRows.push(x); };
    commMockQuietSeen_ = function () { return false; };
    if (keep.optIdx) {
      optOutIndex_ = function () {
        var by = {};
        for (var k in blocked) if (Object.prototype.hasOwnProperty.call(blocked, k)) by[k] = blocked[k];
        return { by: by, error: '' };
      };
    }
    RPC_TEST_TRANSPORT = function (name, p) {
      sent.push({ name: name, to: String(p.to || ''), body: String(p.body || ''), from_line: String(p.from_line || ''),
                  reason: String(p.reason || '') });
      return { ok: true, sent: true, gated: false, method: name, receipt: 'st-rb-' + sent.length };
    };
    RPC_TEST_FORCE_ON = true;
    hubSysLog_ = function () {};
    smartRecord_ = function (key) { ledger.push(key); return true; };
    HUB_QUIET_NOW = DAY;

    var provider = [
      { id: 'PNPqYnvZUD', number: '+13309195558', name: 'Automations', users: [{ id: 'U_AUTO' }] },
      { id: 'PNDNwYvvLJ', number: '+13309195559', name: 'Arthur', users: [{ id: 'U_ARTHUR' }] },
      { id: 'PNtyone01', number: '+13309197779', name: 'Ty', users: [] },
      { id: 'PNtytwo02', number: '+19377166410', name: 'Ty (second)', users: [] }
    ];
    r.pickBlank = rpcSenderPick_(provider, '');
    r.pickRole = rpcSenderPick_(provider, 'Administration');
    r.pickName = hubLineSenderMatch_(provider, 'arthur');
    r.pickNum = hubLineSenderMatch_(provider, '(330) 919-5559');
    r.pickId = hubLineSenderMatch_(provider, 'PNDNwYvvLJ');
    r.pickTwo = hubLineSenderMatch_(provider, 'Director');
    r.pickNone = rpcSenderPick_(provider, 'Nowhere');
    r.pickNoAuto = rpcSenderPick_(provider.slice(1), '');
    r.knownAdmin = hubLineSenderKnown_('Administration');
    r.knownTypo = hubLineSenderKnown_('Adminstration');
    testOn = false; dialNow = { word: 'send', readable: true };
    var s0 = sent.length;
    r.doorLine = rpcCall_('smsSend', { to: '+13305550199', body: 'hello', reason: 'hiring book: hiring_bci_howto' },
                          { idempotency_key: run + 'line-1' });
    r.doorLineSent = sent.slice(s0);
    s0 = sent.length;
    r.doorPlain = rpcCall_('smsSend', { to: '+13305550198', body: 'hello', reason: 'st: no situation' },
                           { idempotency_key: run + 'line-2' });
    r.doorPlainSent = sent.slice(s0);
    /* a reason worded for the log names no row; the lane's own context does */
    var heldCtx = COMM_MOCK_CTX;
    s0 = sent.length;
    try {
      COMM_MOCK_CTX = { situation: 'hiring_bci_howto' };
      r.doorCtx = rpcCall_('smsSend', { to: '+13305550197', body: 'hello', reason: 'hiring: first contact by text' },
                           { idempotency_key: run + 'line-3' });
    } finally { COMM_MOCK_CTX = heldCtx; }
    r.doorCtxSent = sent.slice(s0);

    r.staffTell = HUB_ACTIONS.recruitTell({ rows: [row('hiring_screen_day_reminder')] },
                                          { email: 's@example.org', role: 'staff', types: [] });
    r.staffIngest = HUB_ACTIONS.recruitBookIngest({ tab: 'recruit_pipeline' },
                                                  { email: 's@example.org', role: 'staff', types: [] });
    r.emptyTell = tell([]);

    testOn = true; dialNow = { word: 'record', readable: true };
    s0 = sent.length;
    var rh0 = rhRows.length, m0 = mockRows.length;
    r.test = one(row('hiring_screen_day_reminder'));
    r.testSent = sent.length - s0;
    r.testRh = rhRows.slice(rh0);
    r.testMock = mockRows.slice(m0);
    /* words edited on the Desk past the mock outbox's cut */
    var mL = mockRows.length;
    textOver.hiring_onboarding_start = 'Hello {first_name}, ' + new Array(451).join('0123456789');
    r.long = one(row('hiring_onboarding_start'));
    r.longMock = mockRows.slice(mL);
    textOver = {};

    testOn = false; dialNow = { word: 'send', readable: true };
    s0 = sent.length;
    var l0 = ledger.length;
    var screenRow = row('hiring_screen_day_reminder');
    r.prod = one(screenRow);
    r.prodSent = sent.slice(s0);
    r.prodLedger = ledger.slice(l0);
    s0 = sent.length;
    r.prodAgain = one(screenRow);
    r.prodAgainSent = sent.length - s0;
    s0 = sent.length;
    r.onboard = one(row('hiring_onboarding_start', { screener: '' }));
    r.onboardSent = sent.slice(s0);
    s0 = sent.length;
    r.bci = one(row('hiring_bci_howto'));
    r.bciSent = sent.slice(s0);
    bciPace = { max_attempts: '3', frequency: 'weekly' };
    r.bciPaced = one(row('hiring_bci_howto'));
    bciPace = { max_attempts: '1', frequency: 'once' };
    r.noName = one(row('hiring_onboarding_start', { first_name: '', name: '' }));

    s0 = sent.length;
    HUB_QUIET_NOW = NIGHT;
    r.quiet = one(row('hiring_screen_day_reminder'));
    testOn = true; dialNow = { word: 'record', readable: true };
    var rhN = rhRows.length, mN = mockRows.length;
    r.quietTest = one(row('hiring_screen_day_reminder'));
    r.quietTestRows = (rhRows.length - rhN) + (mockRows.length - mN);
    testOn = false; dialNow = { word: 'send', readable: true };
    HUB_QUIET_NOW = DAY;
    dialNow = { word: 'off', readable: false };
    r.blind = one(row('hiring_screen_day_reminder'));
    dialNow = { word: 'off', readable: true };
    r.dialOff = one(row('hiring_screen_day_reminder'));
    dialNow = { word: 'send', readable: true };
    offIds.hiring_screen_day_reminder = true;
    r.off = one(row('hiring_screen_day_reminder'));
    offIds = {};
    r.stale = one(row('hiring_screen_day_reminder', { deadline: EARLIER }));
    r.shared = one(row('hiring_screen_day_reminder', { phone: '+13309195558' }));
    hubLineOurs_ = function (v) { return String(v || '').replace(/\D/g, '').slice(-10) === '3305550177'; };
    r.ours = one(row('hiring_screen_day_reminder', { phone: '+13305550177' }));
    hubLineOurs_ = keep.ours;
    r.noNumber = one(row('hiring_screen_day_reminder', { phone: '555-0101' }));
    r.noPlace = one(row('hiring_screen_day_reminder', { location: '' }));
    r.unknownSit = one(row('hiring_something_else'));
    blocked['3305550133'] = { source: 'stop', phrase: 'stop', at: '2026-09-01T00:00:00Z' };
    r.optedOut = one(row('hiring_bci_howto', { phone: '+13305550133' }));
    testOn = true; dialNow = { word: 'record', readable: true };
    var rhO = rhRows.length, mO = mockRows.length;
    r.optedOutTest = one(row('hiring_screen_day_reminder', { phone: '+13305550133' }));
    r.optedOutTestRows = (rhRows.length - rhO) + (mockRows.length - mO);
    testOn = false; dialNow = { word: 'send', readable: true };
    blocked = {};
    r.refusedSent = sent.length - s0;

    var houseOn = true;
    var sheetObj = fakeSheet();
    houseMoved_ = function (tab) { return houseOn && tab === 'recruit_pipeline'; };
    houseSheetFor_ = function (tab) { return (houseOn && tab === 'recruit_pipeline') ? sheetObj : null; };
    var hdr = ['id', 'Hire ?', 'Status', 'First Name', 'Phone', 'Notes'];
    var body = [['TP-2', 'Yes', '5 - Onboarding', 'Ann', '330-555-0101', '=IMPORTRANGE("x")'],
                ['TP-3', '', '3 - In Person', 'Ben', '330-555-0102']];
    r.ingest = HUB_ACTIONS.recruitBookIngest({ tab: 'recruit_pipeline', header: hdr, rows: body,
                                               fingerprint: 'fp1' }, svc);
    r.ingestCalls = sheetCalls.slice();
    sheetCalls = [];
    r.ingestEmpty = HUB_ACTIONS.recruitBookIngest({ tab: 'recruit_pipeline', header: hdr, rows: [],
                                                    fingerprint: 'fp2' }, svc);
    r.ingestNoId = HUB_ACTIONS.recruitBookIngest({ tab: 'recruit_pipeline', header: ['Status'], rows: body,
                                                   fingerprint: 'fp3' }, svc);
    r.ingestOther = HUB_ACTIONS.recruitBookIngest({ tab: 'users', header: hdr, rows: body, fingerprint: 'fp4' }, svc);
    r.ingestHouseless = HUB_ACTIONS.recruitBookIngest({ tab: 'recruit_onboarding', header: hdr, rows: body,
                                                        fingerprint: 'fp5' }, svc);
    r.ingestUntouched = sheetCalls.length;
  } catch (e) {
    r.error = String((e && e.message) || e) + ' ' + String((e && e.stack) || '').slice(0, 400);
  } finally {
    smartSituationOn_ = keep.on; smartSituations_ = keep.sits; commDialState_ = keep.dialState;
    commDial_ = keep.dial; commTestMode_ = keep.test; hubRehearsalToSheet_ = keep.sheet;
    hubRehearsalWrite_ = keep.rhWrite; commMockWrite_ = keep.mockWrite; COMM_MOCK_DEAD = keep.mockDead;
    COMM_MOCK_WRITTEN = keep.mockWritten; commMockQuietSeen_ = keep.mockSeen;
    if (keep.optIdx) optOutIndex_ = keep.optIdx;
    RPC_TEST_TRANSPORT = keep.transport; RPC_TEST_FORCE_ON = keep.force; HUB_QUIET_NOW = keep.now;
    hubSysLog_ = keep.log; smartRecord_ = keep.record; houseMoved_ = keep.moved;
    houseSheetFor_ = keep.houseSheet; hubLineOurs_ = keep.ours;
  }

  var J = function (o) { return JSON.stringify(o === undefined ? null : o).slice(0, 700); };
  stAssert_(out, 'recruiting book: the section ran to the end', !r.error, r.error);

  var seeds = smartDefaults_().filter(function (d) {
    return ['hiring_screen_day_reminder', 'hiring_onboarding_start', 'hiring_bci_howto'].indexOf(String(d.id)) !== -1;
  });
  stAssert_(out, 'recruiting book: the three rows are seeded ON, as events, SMS only, with words, no audience cell, ' +
                 'saying they come from Arthur on the Administration line',
            seeds.length === 3 && seeds.every(function (d) {
              return smartOn_(d.enabled) && d.kind === 'event' && d.event === d.id && d.channels === 'sms' &&
                     !!String(d.sms_text).trim() && !String(d.to) && !String(d.cc) &&
                     d.from_line === 'Administration' && d.sender === 'Arthur from Asa Life Care';
            }), J(seeds.map(function (d) { return [d.id, d.enabled, d.kind, d.from_line, d.sender]; })));
  stAssert_(out, 'recruiting book: each is a code-fired event the sweep never walks — fires:false, its own subject, ' +
                 'answered with no rows, and its sender in this repo',
            ['hiring_screen_day_reminder', 'hiring_onboarding_start', 'hiring_bci_howto'].every(function (id) {
              return SMART_EVENTS[id] && SMART_EVENTS[id].subject === 'recruit_book' &&
                     SMART_EVENTS[id].applies().fires === false && SMART_EVENT_SENDERS[id] === 'CommRecruit.gs';
            }) && stCode_(smartEventSweep_).indexOf("=== 'recruit_book') return []") !== -1, '');
  stAssert_(out, 'recruiting book: each row is resolved through its binding cell, the shipped id the floor',
            ['hiring.screen.day_reminder', 'hiring.onboarding.start', 'hiring.bci.howto'].every(function (k) {
              return COMM_BINDINGS_DEFAULTS.some(function (b) { return b.key === k; });
            }) && stCode_(recruitSituation_).indexOf('commSituationId_(key, sid)') !== -1, '');
  var words = [SMART_RECRUIT_SCREEN_TEXT, SMART_RECRUIT_ONBOARD_TEXT, SMART_RECRUIT_BCI_TEXT];
  stAssert_(out, 'recruiting book: the words are plain ASCII (one curly quote would halve a segment) and never carry ' +
                 'a reason or a password',
            words.every(function (w) { return /^[\x0a\x20-\x7e]+$/.test(w) && w.indexOf('{reason}') === -1 &&
                                              w.indexOf('{password}') === -1; }), '');
  stAssert_(out, 'recruiting book: the how-to carries True Hire, its address, the company and the reason code, as ' +
                 'Arthur pastes it',
            SMART_RECRUIT_BCI_TEXT.indexOf('True Hire') !== -1 &&
            SMART_RECRUIT_BCI_TEXT.indexOf('4650 Hills and Dales Road NW Ste. 320, Canton, Ohio 44708') !== -1 &&
            SMART_RECRUIT_BCI_TEXT.indexOf('A Brighter Dawn, Inc') !== -1 &&
            SMART_RECRUIT_BCI_TEXT.indexOf('5123.081') !== -1, '');
  stAssert_(out, 'recruiting book: the house door and the text door are service-only and named on the relay\'s list, ' +
                 'as events the Guardian expects to be quiet on a quiet day',
            SERVICE_SWEEP_ACTIONS.indexOf('recruitBookIngest') !== -1 &&
            SERVICE_SWEEP_ACTIONS.indexOf('recruitTell') !== -1 &&
            GUARDIAN_RELAY_EVENT_ACTIONS.indexOf('recruitBookIngest') !== -1 &&
            GUARDIAN_RELAY_EVENT_ACTIONS.indexOf('recruitTell') !== -1 &&
            OPT_OUT_SCOPE_BY_FILE['CommRecruit.gs'] === 'hiring', '');

  stAssert_(out, 'sender line: the SMS contract declares an optional from_line, and a blank one is the line named ' +
                 'Automations, exactly as before',
            !!(HUB_RPC.smsSend.params.from_line && !HUB_RPC.smsSend.params.from_line.required) &&
            (r.pickBlank || {}).from === '+13309195558' && (r.pickBlank || {}).userId === 'U_AUTO', J(r.pickBlank));
  stAssert_(out, 'sender line: a line is named the way the line directory names it — its role, its provider name, ' +
                 'its number or its id',
            (r.pickRole || {}).from === '+13309195559' && (r.pickRole || {}).userId === 'U_ARTHUR' &&
            (r.pickName || {}).via === 'name' && (r.pickNum || {}).via === 'number' && (r.pickId || {}).via === 'id' &&
            String(((r.pickNum || {}).line || {}).number) === '+13309195559', J([r.pickRole, r.pickName, r.pickNum]));
  stAssert_(out, 'sender line: a role two lines share names neither, and a line nobody has REFUSES rather than ' +
                 'falling back to Automations',
            !(r.pickTwo || {}).line && String((r.pickTwo || {}).why).indexOf('more than one') !== -1 &&
            (r.pickNone || {}).error === 'no_sending_line' &&
            String((r.pickNone || {}).detail).indexOf('nothing was sent') !== -1 &&
            (r.pickNoAuto || {}).error === 'no_sending_line', J([r.pickTwo, r.pickNone, r.pickNoAuto]));
  stAssert_(out, 'sender line: the Desk accepts a line the directory knows and refuses a typo with the names that work',
            (r.knownAdmin || {}).ok === true && (r.knownTypo || {}).ok === false &&
            ((r.knownTypo || {}).names || []).indexOf('Administration') !== -1 &&
            stCode_(HUB_ACTIONS.smartCommsSet).indexOf('hubLineSenderKnown_(row.from_line)') !== -1,
            J([r.knownAdmin, r.knownTypo]));
  stAssert_(out, 'sender line: the send door reads the line of the row a reason names, for ANY lane — and a text whose ' +
                 'reason names no row leaves from the default line',
            (r.doorLine || {}).sent === true && ((r.doorLineSent || [])[0] || {}).from_line === 'Administration' &&
            (r.doorPlain || {}).sent === true && ((r.doorPlainSent || [])[0] || {}).from_line === '',
            J({ line: r.doorLineSent, plain: r.doorPlainSent }));
  stAssert_(out, 'recruiting book: a lane whose reason line is worded for the log still obeys its row\'s "Sends from" ' +
                 'cell through the context it hands the mock outbox',
            (r.doorCtx || {}).sent === true && ((r.doorCtxSent || [])[0] || {}).from_line === 'Administration',
            J(r.doorCtxSent));
  stAssert_(out, 'sender line: the row carries the cell (SMART_HEADER, appended last) and the seed plants it',
            SMART_HEADER[SMART_HEADER.length - 1] === 'from_line' &&
            stCode_(smartDefaults_).indexOf("from_line: pick('from_line'") !== -1 &&
            stCode_(rpcSend_).indexOf('rpcOpenPhoneSms_(smsTo, body, fromLine') !== -1 &&
            stCode_(rpcOpenPhoneSms_).indexOf('rpcSenderLine_(apiKey, fromLine)') !== -1, '');

  stAssert_(out, 'recruiting book: only the relay (or an admin by hand) rings either door; an empty post is a quiet 200',
            !!r.staffTell && r.staffTell.status === 403 && !!r.staffIngest && r.staffIngest.status === 403 &&
            !!r.emptyTell && r.emptyTell.status === 200 && r.emptyTell.data.results.length === 0,
            J({ tell: r.staffTell, ingest: r.staffIngest }));

  stAssert_(out, 'recruiting book: with test mode on the text is one rehearsal row and one mock row, the words ' +
                 'rendered for the candidate — NOBODY IS CONTACTED',
            (r.test || {}).state === 'recorded' && r.testSent === 0 && (r.testRh || []).length === 1 &&
            (r.testMock || []).length === 1 && String((r.test || {}).why).indexOf('nobody was contacted') !== -1,
            J({ test: r.test, rh: (r.testRh || []).length, mock: (r.testMock || []).length }));
  stAssert_(out, 'recruiting book: a held text answers with the copy the mock row holds — the words, the masked ' +
                 'number, the line and the channel — so the page shows it without reading that book',
            String((r.test || {}).words) === String(((r.testMock || [])[0] || {}).body) &&
            String((r.test || {}).words).indexOf('Hello Ann,') === 0 &&
            String((r.test || {}).to_masked) === '•••0101' && (r.test || {}).channel === 'sms' &&
            String((r.test || {}).line).length > 0 &&
            String((r.test || {}).words).indexOf('+1330') === -1 &&
            String((r.quiet || {}).words) === '' && String((r.dialOff || {}).words) === '',
            J({ test: r.test, mock: (r.testMock || [])[0] }));
  var noCopy = [r.quiet, r.blind, r.dialOff, r.off, r.stale, r.shared, r.noNumber, r.noPlace, r.unknownSit];
  stAssert_(out, 'recruiting book: an answer taken before the words were composed carries no copy and no channel — ' +
                 'a row switched off on the Desk, the quiet window, the dial, a started screen, a number refused — ' +
                 'so the page never says a copy of it could not be read',
            noCopy.every(function (x) {
              return !!x && String(x.words) === '' && String(x.channel) === '' && Number(x.words_chars) === 0;
            }) && (r.off || {}).state === 'held',
            J(noCopy.map(function (x) {
              return x && { state: x.state, words: x.words, channel: x.channel, chars: x.words_chars };
            })));
  var leftBody = String(((r.prodSent || [])[0] || {}).body || '');
  stAssert_(out, 'recruiting book: every answer taken after the words exist marks the copy with its channel — told, ' +
                 'duplicate, and a person who said stop — and a told text\'s copy is the body that left',
            (r.prod || {}).channel === 'sms' && leftBody.length > 0 && String((r.prod || {}).words) === leftBody &&
            Number((r.prod || {}).words_chars) === leftBody.length &&
            (r.prodAgain || {}).channel === 'sms' && (r.optedOut || {}).channel === 'sms',
            J({ prod: r.prod, again: r.prodAgain, opted: r.optedOut }));
  var longMock = (r.longMock || [])[0] || {};
  stAssert_(out, 'recruiting book: words past the mock outbox\'s cut come back cut exactly where that book cuts them, ' +
                 'with their whole length — so the page can say it shows the first part, never a whole-looking text',
            (r.long || {}).state === 'recorded' && Number(longMock.body_chars) > 4000 &&
            String((r.long || {}).words) === String(longMock.body) &&
            Number((r.long || {}).words_chars) === Number(longMock.body_chars) &&
            String((r.long || {}).words).length < Number((r.long || {}).words_chars),
            J({ state: (r.long || {}).state, words: String((r.long || {}).words).length,
                chars: (r.long || {}).words_chars, mockBody: String(longMock.body || '').length,
                mockChars: longMock.body_chars }));

  var pBody = ((r.prodSent || [])[0] || {}).body || '';
  stAssert_(out, 'recruiting book: the screen reminder goes once, to the candidate, from the Administration line, ' +
                 'saying the hour, the house manager and the place (its full stop taken off)',
            (r.prod || {}).state === 'told' && (r.prodSent || []).length === 1 &&
            (r.prodSent[0] || {}).to === '+13305550101' && (r.prodSent[0] || {}).from_line === 'Administration' &&
            pBody.indexOf('Hello Ann, this is Arthur from Asa Life Care.') === 0 &&
            pBody.indexOf('scheduled for today at 11AM, with our house manager Tieara, located at 1305 49th St, NW, ' +
                          'Canton.') !== -1 && pBody.indexOf('Canton..') === -1 && pBody.indexOf('{') === -1 &&
            (r.prodSent[0] || {}).reason === 'hiring book: hiring_screen_day_reminder' &&
            (r.prodLedger || []).length === 1, J({ prod: r.prod, sent: r.prodSent }));
  stAssert_(out, 'recruiting book: the same occasion offered twice is `duplicate` and texts nobody again',
            (r.prodAgain || {}).state === 'duplicate' && r.prodAgainSent === 0, J(r.prodAgain));
  var oBody = ((r.onboardSent || [])[0] || {}).body || '';
  stAssert_(out, 'recruiting book: the onboarding start asks for the best e-mail address, and a book that names no ' +
                 'screener says "Our house manager"',
            (r.onboard || {}).state === 'told' && oBody.indexOf('Our house manager has reached out to me') !== -1 &&
            oBody.indexOf('best email address') !== -1, oBody);
  var bBody = ((r.bciSent || [])[0] || {}).body || '';
  stAssert_(out, 'recruiting book: the how-to goes whole, and hands the relay the row\'s repeat rule — once by ' +
                 'default, the Desk\'s max_attempts and frequency when set',
            (r.bci || {}).state === 'told' && bBody.indexOf('True Hire') !== -1 &&
            (r.bci || {}).max === 1 && (r.bci || {}).gap_days === 0 &&
            (r.bciPaced || {}).max === 3 && (r.bciPaced || {}).gap_days === 7, J({ bci: r.bci, paced: r.bciPaced }));
  stAssert_(out, 'recruiting book: a row with no name greets "there", never "Hello ,"',
            (r.noName || {}).state === 'told' &&
            String(((sent.filter(function (x) { return x.body.indexOf('Hello there,') === 0; }))[0] || {}).body).length > 0,
            J(r.noName));

  stAssert_(out, 'recruiting book: inside the quiet window nothing is said (`refused_quiet`, offered again after it); a ' +
                 'dial nobody can read is `dial_unknown`; a dial at off is `dial_off`; a row switched off is `held`',
            (r.quiet || {}).state === 'refused_quiet' && (r.blind || {}).state === 'dial_unknown' &&
            (r.dialOff || {}).state === 'dial_off' && (r.off || {}).state === 'held',
            J([r.quiet, r.blind, r.dialOff, r.off]));
  stAssert_(out, 'recruiting book: at night with test mode on the text is not even written down — the window holds ' +
                 'it before the dial is asked',
            (r.quietTest || {}).state === 'refused_quiet' && r.quietTestRows === 0,
            J({ quiet: r.quietTest, rows: r.quietTestRows }));
  stAssert_(out, 'recruiting book: a screen that has started is `stale`; a shared line, a line of ours, a number that ' +
                 'is not ten digits and a reminder with no place are refused in words',
            (r.stale || {}).state === 'stale' && (r.shared || {}).state === 'shared_line' &&
            (r.ours || {}).state === 'our_line' && (r.noNumber || {}).state === 'no_number' &&
            (r.noPlace || {}).state === 'refused' && (r.unknownSit || {}).state === 'refused',
            J([r.stale, r.shared, r.ours, r.noNumber, r.noPlace, r.unknownSit]));
  stAssert_(out, 'recruiting book: a person who said stop is `opted_out` at the one door — and not one refusal above ' +
                 'texted anybody',
            (r.optedOut || {}).state === 'opted_out' && r.refusedSent === 0, J({ opted: r.optedOut, sent: r.refusedSent }));
  stAssert_(out, 'recruiting book: in test mode a person who said stop is `opted_out` too — no rehearsal row and no ' +
                 'mock row saying production would text them',
            (r.optedOutTest || {}).state === 'opted_out' && r.optedOutTestRows === 0,
            J({ opted: r.optedOutTest, rows: r.optedOutTestRows }));

  var wrote = (r.ingestCalls || []).filter(function (c) { return c && c.values; })[0] || {};
  stAssert_(out, 'recruiting book: the house door rewrites the whole tab — header then rows, short rows padded, the ' +
                 'grid grown to fit — and answers the rows, the columns and the fingerprint it was handed',
            !!r.ingest && r.ingest.status === 200 && r.ingest.data.state === 'written' && r.ingest.data.rows === 2 &&
            r.ingest.data.columns === 6 && r.ingest.data.fingerprint === 'fp1' &&
            (r.ingestCalls || []).indexOf('clear') !== -1 &&
            J(wrote.at) === J([1, 1, 3, 6]) && (wrote.values || [])[2].length === 6 &&
            (wrote.values || [])[0][0] === 'id', J({ ingest: r.ingest, calls: r.ingestCalls }));
  stAssert_(out, 'recruiting book: a copied cell that looks like a formula lands as text, never a calculation',
            String(((wrote.values || [])[1] || [])[5]).charAt(0) === "'", J((wrote.values || [])[1]));
  stAssert_(out, 'recruiting book: an empty copy never empties the house, a copy with no `id` column is refused, a tab ' +
                 'that is not ours is refused, and a house nobody declared is `no_house` — never made here',
            !!r.ingestEmpty && r.ingestEmpty.data.state === 'refused' &&
            !!r.ingestNoId && r.ingestNoId.data.state === 'refused' &&
            !!r.ingestOther && r.ingestOther.data.state === 'refused' &&
            !!r.ingestHouseless && r.ingestHouseless.data.state === 'no_house' && r.ingestUntouched === 0,
            J([r.ingestEmpty, r.ingestNoId, r.ingestOther, r.ingestHouseless]));

  var tellSrc = stCode_(recruitTellOne_);
  stAssert_(out, 'recruiting book: every text leaves through rpcCall_ or is written by hubRehearsalHeld_ — nothing ' +
                 'reaches the provider on its own, and the house door never creates a tab',
            tellSrc.indexOf("rpcCall_('smsSend'") !== -1 && tellSrc.indexOf('hubRehearsalHeld_(') !== -1 &&
            tellSrc.indexOf('UrlFetchApp') === -1 && stCode_(recruitIngestOne_).indexOf('insertSheet') === -1 &&
            stCode_(recruitIngestOne_).indexOf('hubTabEnsure_') === -1 &&
            tellSrc.indexOf('env.quiet') < tellSrc.indexOf("rpcCall_('smsSend'"), '');
}
