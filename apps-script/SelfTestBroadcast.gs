/** Self-test for CommBroadcast.gs: stand-ins restored in `finally`; the send door is the real rpcCall_. */

function stBroadcastCalendar_(today) {
  var d = function (n) {
    var t = new Date(Date.parse(today + 'T12:00:00Z') + n * 86400000);
    return ('0' + (t.getUTCMonth() + 1)).slice(-2) + '/' + ('0' + t.getUTCDate()).slice(-2) + '/' + t.getUTCFullYear();
  };
  var A = 'CAN - 48TH (A) - ABD1547', B = 'CAN - 48TH (B) - ABD1711', M = 'CAN - MS - MS4060';
  return [
    ['Location', 'Employee', 'Designation', 'Phone', 'Date'],
    [A, 'Ann Able', '**', '(330) 555-0101', d(-2)],
    [A, 'Ben Baker', '*', '3305550102', d(3)],
    [A, 'Cal Coe', '', '3305550103', d(-10)],
    [A, 'OPEN', '', '', d(1)],
    [A, 'Old Timer', '*', '3305550104', d(-60)],
    [B, 'Dee Dunn', '*', '(330) 555-0105', d(0)],
    [B, 'Ben Baker', '*', '3305550102', d(0)],
    [M, 'Eve Echo', '**', '3309195558', d(0)],
    [M, 'WORKSHOP (MS)', '', '', d(0)]
  ];
}

function stStaffBroadcast_(out) {
  var keep = {
    calRows: commBroadcastCalendarRows_, cache: commBroadcastCache_, people: commBroadcastPeopleRows_,
    clients: commBroadcastClientKeys_, rows: commBroadcastRows_, put: commBroadcastPut_,
    ready: commBroadcastHouseReady_, relay: (typeof staffRelayPost_ === 'function') ? staffRelayPost_ : null,
    every: commCallOffEveryoneAudience_, hms: commCallOffHouseManagersAudience_,
    on: smartSituationOn_, sits: smartSituations_, dialState: commDialState_, dial: commDial_,
    test: commTestMode_, sheet: hubRehearsalToSheet_, rhWrite: hubRehearsalWrite_,
    mockWrite: commMockWrite_, mockDead: COMM_MOCK_DEAD, mockWritten: COMM_MOCK_WRITTEN,
    mockSeen: commMockQuietSeen_, optIdx: (typeof optOutIndex_ === 'function') ? optOutIndex_ : null,
    transport: RPC_TEST_TRANSPORT, force: RPC_TEST_FORCE_ON, now: HUB_QUIET_NOW,
    oKeys: hubQuietOwedKeys_, oGet: hubQuietOwedGet_, oSet: hubQuietOwedSet_, oDel: hubQuietOwedDel_,
    log: hubSysLog_, record: smartRecord_, setting: (typeof digestSetting_ === 'function') ? digestSetting_ : null,
    master: HUB_MASTER_EMAIL_CACHE, memo: COMM_BROADCAST_CAL_MEMO, budget: COMM_BROADCAST_BUDGET_MS,
    claim: commBroadcastClaim_
  };
  var run = 'stb' + String(Date.now()).slice(-9);
  var r = {};
  var TODAY = '2026-09-22';
  var DAY = '2026-09-22T16:00:00Z';
  var calFail = false, calReads = 0, peopleFail = false, relayDown = false, houseReady = true;
  var dialNow = { word: 'record', readable: true }, testOn = true;
  var sitOn = true, sitCc = '';
  var people = [], sent = [], rhRows = [], mockRows = [], ledger = [], owed = {}, store = {};
  var copy = function (o) { return JSON.parse(JSON.stringify(o)); };
  var sitRow = function () {
    return { id: 'staff_broadcast', enabled: sitOn ? 'yes' : 'no', kind: 'event', event: 'staff_broadcast',
             channels: 'sms', sms_text: '{message}\n{signature}', cc: sitCc, to: '' };
  };
  var dir = { email: 'dora@example.org', display_name: 'Dora Director', role: 'staff', types: ['DIRECTOR'] };
  /* the team lead badge is read from HUB_BADGE_FOLLOWS, never spelled */
  var leadBadge = Object.keys(HUB_BADGE_FOLLOWS).filter(function (k) {
    return HUB_BADGE_FOLLOWS[k] === 'DIRECTOR';
  })[0] || 'DIRECTOR';
  var lead = { email: 'tim@example.org', display_name: 'Tim Lead', role: 'staff', types: [leadBadge] };
  var hm = { email: 'ann@example.org', display_name: 'Ann Able', role: 'manager', types: ['HM'] };
  var hmByPhone = { email: 'eve2@example.org', display_name: 'Evelyn E', role: 'manager', types: ['HM'],
                    phone: '+1 330 555 0199', phones: [] };
  var staff = { email: 'sam@example.org', display_name: 'Sam Staff', role: 'staff', types: [] };
  var boss = { email: 'boss@example.org', display_name: 'The Boss', role: 'staff', types: [] };
  var fresh = function () { COMM_BROADCAST_CAL_MEMO = null; };
  var basePeople = function () {
    return [
      { id: 'p-ann', name: 'Ann Able', status: 'Active', phone: '3305550101' },
      { id: 'p-ben', name: 'Ben Baker', status: 'Active', phone: '330-555-0102' },
      { id: 'p-cal', name: 'Cal Coe', status: 'Archived', phone: '3305550103' },
      { id: 'p-dee', name: 'Dee Dunn', status: 'Active', phone: '' },
      { id: 'p-fay', name: 'Fay Fox', status: 'Active', phone: '3305550106' },
      { id: 'p-gus', name: 'Gus Opt', status: 'Active', phone: '3305550107' }
    ];
  };
  var preview = function (user, p) { fresh(); return HUB_ACTIONS.staffBroadcastPreview(p, user); };
  var send = function (user, p) { fresh(); return HUB_ACTIONS.staffBroadcastSend(p, user); };
  var withSha = function (user, p) {
    var pv = preview(user, p);
    var q = copy(p);
    q.audience_sha = (pv.data && pv.data.audience_sha) || '';
    return q;
  };
  try {
    var cache = {};
    commBroadcastCache_ = function () {
      return { get: function (k) { return Object.prototype.hasOwnProperty.call(cache, k) ? cache[k] : null; },
               put: function (k, v) { cache[k] = String(v); }, remove: function (k) { delete cache[k]; } };
    };
    commBroadcastCalendarRows_ = function () {
      calReads++;
      if (calFail) throw new Error('the book would not open');
      return { values: stBroadcastCalendar_(TODAY), tz: 'America/New_York' };
    };
    people = basePeople();
    commBroadcastPeopleRows_ = function () {
      if (peopleFail) throw new Error('People would not open');
      return copy(people);
    };
    commBroadcastClientKeys_ = function () { return { calclient: true }; };
    if (keep.optIdx) {
      optOutIndex_ = function () {
        return { by: { '3305550107': { key: '3305550107', source: 'sms reply', at: '2026-09-01', phrase: 'stop' } },
                 error: '' };
      };
    }
    commCallOffEveryoneAudience_ = function () {
      return { ok: true, readable: true, missing: '', why: '',
               people: [{ person_key: 'annable', name: 'Ann Able', phone: '+13305550101' },
                        { person_key: 'benbaker', name: 'Ben Baker', phone: '+13305550102' },
                        { person_key: 'benbaker2', name: 'Ben Baker (second row)', phone: '330.555.0102' },
                        { person_key: 'fayfox', name: 'Fay Fox', phone: '+13305550106' },
                        { person_key: 'gusopt', name: 'Gus Opt', phone: '+13305550107' }],
               counted: { rows: 9, active: 7, no_phone: 2, refused: 0 } };
    };
    commCallOffHouseManagersAudience_ = function () {
      return { ok: true, readable: true, missing: '', why: '',
               people: [{ person_key: '', name: 'Ann Able', phone: '+13305550101' },
                        { person_key: '', name: 'Hal Head', phone: '+13305550108' }],
               counted: { rows: 9, named: 2, no_phone: 0 } };
    };
    staffRelayPost_ = function (path) {
      if (path !== COMM_BROADCAST_PRN_PATH) return { status: 404, message: 'no such door' };
      if (relayDown) return { status: 502, message: 'relay down' };
      return { status: 200, data: { readable: true, names: ['Dee Dunn', 'Fay Fox', 'Zed Nowhere'],
                                    mentions: [{ name: 'Ivy Ink', note: 'PRN weekends' }], as_of: DAY } };
    };
    smartSituationOn_ = function (id) {
      return (id === 'staff_broadcast' && sitOn) ? sitRow() : null;
    };
    smartSituations_ = function () { return [sitRow()]; };
    commDialState_ = function () { return copy(dialNow); };
    commDial_ = function () { return dialNow.word; };
    commTestMode_ = function () { return testOn; };
    hubRehearsalToSheet_ = function () { return testOn; };
    hubRehearsalWrite_ = function (row) { rhRows.push(row); return row.id; };
    COMM_MOCK_DEAD = {};
    COMM_MOCK_WRITTEN = 0;
    commMockWrite_ = function (row) { mockRows.push(row); };
    commMockQuietSeen_ = function () { return false; };
    RPC_TEST_TRANSPORT = function (name, p) {
      sent.push({ name: name, to: String(p.to || ''), body: String(p.body || '') });
      return { ok: true, sent: true, gated: false, method: name, receipt: 'st-bc-' + sent.length };
    };
    RPC_TEST_FORCE_ON = true;
    hubQuietOwedKeys_ = function () { return Object.keys(owed); };
    hubQuietOwedGet_ = function (k) { return Object.prototype.hasOwnProperty.call(owed, k) ? owed[k] : null; };
    hubQuietOwedSet_ = function (k, v) { owed[k] = String(v); };
    hubQuietOwedDel_ = function (k) { delete owed[k]; };
    commBroadcastHouseReady_ = function () { return houseReady; };
    commBroadcastRows_ = function () {
      if (!houseReady) throw new Error('not minted');
      return Object.keys(store).map(function (k) { return copy(store[k]); });
    };
    commBroadcastPut_ = function (row) {
      var nowIso = new Date().toISOString();
      row.updatedAt = nowIso;
      if (!row.createdAt) row.createdAt = nowIso;
      store[row.id] = copy(row);
    };
    hubSysLog_ = function () {};
    smartRecord_ = function (key) { ledger.push(key); return true; };
    if (keep.setting) digestSetting_ = function (k, fb) { return fb; };
    HUB_MASTER_EMAIL_CACHE = 'boss@example.org';
    HUB_QUIET_NOW = DAY;

    r.who = {
      dir: commBroadcastWho_(dir), lead: commBroadcastWho_(lead), hm: commBroadcastWho_(hm),
      staff: commBroadcastWho_(staff), svc: commBroadcastWho_({ is_service: true, role: 'admin' }),
      admin: commBroadcastWho_({ email: 'a@example.org', role: 'admin', types: [] }),
      boss: commBroadcastWho_(boss)
    };

    fresh();
    r.cal = commBroadcastCalendar_({ fresh: true });
    calFail = true; fresh(); cache = {};
    var readsBefore = calReads;
    r.calBad = commBroadcastCalendar_({ fresh: true });
    r.calBad2 = commBroadcastCalendar_();
    r.calBadReads = calReads - readsBefore;
    calFail = false; fresh(); cache = {};

    r.hmHouseA = preview(hm, { audience: 'house', house: 'CAN - 48TH (A) - ABD1547', message: 'Open shift at 48A' });
    r.hmHouseB = preview(hm, { audience: 'house', house: 'CAN - 48TH (B) - ABD1711', message: 'Open shift at 48B' });
    r.hmLead = preview(hm, { audience: 'leadership', message: 'Managers meeting' });
    r.hmAll = preview(hm, { audience: 'allstaff', message: 'Schedule posted' });
    r.phoneHouses = commBroadcastOwnHouses_(hmByPhone, (function () {
      fresh(); var c = commBroadcastCalendar_({ fresh: true });
      c.managers.push({ name: 'Someone Else', key: 'someoneelse', location: 'CAN - MS - MS4060', phone_key: '3305550199' });
      return c;
    })());
    fresh();
    r.sharedPhoneHouses = commBroadcastOwnHouses_({ email: 'x@example.org', display_name: 'Xavier Ex', role: 'manager',
                                                    types: ['HM'], phone: '+1 (330) 919-5558', phones: [] },
                                                  commBroadcastCalendar_({ fresh: true }));
    fresh();
    r.linkedHouses = commBroadcastOwnHouses_({ email: 'ann2@example.org', display_name: 'Eve Echo', role: 'manager',
                                               types: ['HM'], people_id: 'people:p-ann' },
                                             commBroadcastCalendar_({ fresh: true }));
    r.sharedKey = [commBroadcastSharedKey_('+1 330 919 5558'), commBroadcastSharedKey_('3305550101')];
    r.substr = preview(dir, { audience: 'house', house: '48TH', message: 'Open shift' });
    r.staffBoard = HUB_ACTIONS.staffBroadcastBoard({}, staff);
    fresh();
    r.hmBoard = HUB_ACTIONS.staffBroadcastBoard({}, hm);
    fresh();
    r.staffPreview = preview(staff, { audience: 'allstaff', message: 'hello all' });

    r.all = preview(dir, { audience: 'allstaff', message: 'Schedule posted' });
    r.houseA = preview(dir, { audience: 'house', house: 'CAN - 48TH (A) - ABD1547', message: 'x1 open shift' });
    r.houseAMed = preview(dir, { audience: 'house', house: 'CAN - 48TH (A) - ABD1547', meddel: true,
                                 message: 'meds shift at 48A' });
    r.med = preview(dir, { audience: 'meddel', message: 'meds shift anywhere' });
    sitCc = '+13305550199, directors, someone@example.org';
    r.lead = preview(lead, { audience: 'leadership', message: 'Managers meeting at noon' });
    r.houseCc = preview(dir, { audience: 'house', house: 'CAN - 48TH (B) - ABD1711', message: 'house only' });
    sitCc = '';
    r.prn = preview(dir, { audience: 'prn', message: 'PRN shifts open' });
    relayDown = true;
    r.prnDown = preview(dir, { audience: 'prn', message: 'PRN shifts open' });
    relayDown = false;
    peopleFail = true;
    r.peopleDown = preview(dir, { audience: 'house', house: 'CAN - 48TH (A) - ABD1547', message: 'x2 open shift' });
    peopleFail = false;

    r.words = {
      empty: commBroadcastTextProblem_('', ''), dot: commBroadcastTextProblem_('.', ''),
      one: commBroadcastTextProblem_('  a  ', ''), two: commBroadcastTextProblem_('ok', ''),
      long: commBroadcastTextProblem_(new Array(COMM_BROADCAST_TEXT_MAX + 2).join('x'), ''),
      sig: commBroadcastTextProblem_('Open shift', new Array(COMM_BROADCAST_SIGNATURE_MAX + 2).join('s')),
      hits: commBroadcastReasonHits_('Can anyone cover 49th now? It\'s a family emergency.'),
      clean: commBroadcastReasonHits_('Open shift 8A-4P at MS, contact Tonisha'),
      calledOff: commBroadcastReasonHits_('Maria called off, can anyone cover JH 2p-10p?'),
      noShow: commBroadcastReasonHits_('Open shift at 49th — no call no show this morning'),
      noSig: commBroadcastRender_('{message}\n{signature}', { message: 'Open shift today', signature: '' }),
      withSig: commBroadcastRender_('{message}\n{signature}', { message: 'Open shift today', signature: 'Tonisha' }),
      hi: commBroadcastRender_('Hi {first_name}, {message}', { message: 'open shift', first_name: '' }),
      dash: commBroadcastRender_('{message}\n- {signature}', { message: 'm', signature: '' }),
      unknown: commBroadcastRender_('{message} {nobody}', { message: 'm' }),
      ownDash: commBroadcastRender_('{message} - {signature}', { message: '-  Open  shift ,today', signature: '' }),
      lead: commBroadcastRender_('{signature}: {message}', { message: 'Open shift', signature: '' }),
      typed: commBroadcastRender_('{message}\n{signature}', { message: 'Hi {first_name}', signature: '', first_name: 'Zed' })
    };
    r.warnAll = preview(dir, { audience: 'allstaff', message: 'Open shift, she is at the hospital' });
    r.warnLead = preview(dir, { audience: 'leadership', message: 'Open shift, she is at the hospital' });

    testOn = true; dialNow = { word: 'record', readable: true };
    var pTest = withSha(dir, { audience: 'house', house: 'CAN - 48TH (A) - ABD1547', message: 'Open shift 8A-4P',
                               signature: 'Dora', client_id: run + '-test' });
    var s0 = sent.length, rh0 = rhRows.length, m0 = mockRows.length;
    r.testSend = send(dir, pTest);
    r.testSent = sent.length - s0;
    r.testRh = rhRows.slice(rh0);
    r.testMock = mockRows.slice(m0);
    r.testAgain = send(dir, pTest);
    r.testAgainRows = rhRows.length - rh0;

    testOn = false; dialNow = { word: 'send', readable: true };
    var pProd = withSha(dir, { audience: 'allstaff', message: 'Schedule for October is posted',
                               client_id: run + '-prod' });
    s0 = sent.length;
    var l0 = ledger.length;
    r.prodSend = send(dir, pProd);
    r.prodSent = sent.slice(s0);
    r.prodLedger = ledger.length - l0;
    var pFix = withSha(dir, { audience: 'house', house: 'CAN - 48TH (A) - ABD1547', message: 'Open shfit 8A-4P',
                              client_id: run + '-fix' });
    s0 = sent.length;
    r.fixFirst = send(dir, pFix);
    var pFix2 = copy(pFix);
    pFix2.message = 'Open shift 8A-4P';
    pFix2.audience_sha = withSha(dir, pFix2).audience_sha;
    r.fixAgain = send(dir, pFix2);
    r.fixSame = send(dir, pFix);
    r.fixSent = sent.length - s0;

    RPC_TEST_FORCE_ON = false;
    var pOff = withSha(dir, { audience: 'house', house: 'CAN - 48TH (B) - ABD1711', message: 'Switch off test',
                              client_id: run + '-off' });
    s0 = sent.length;
    r.offSend = send(dir, pOff);
    r.offSent = sent.length - s0;
    RPC_TEST_FORCE_ON = true;

    var pMoved = withSha(dir, { audience: 'house', house: 'CAN - 48TH (A) - ABD1547', message: 'Moved test',
                                client_id: run + '-moved' });
    people.forEach(function (p) { if (p.name === 'Cal Coe') p.status = 'Active'; });
    s0 = sent.length;
    r.moved = send(dir, pMoved);
    r.movedSent = sent.length - s0;
    r.movedStored = !!store[commBroadcastId_(dir.email, run + '-moved')];
    people = basePeople();

    var NIGHT = '2026-09-23T03:00:00Z', EARLY = '2026-09-23T11:59:00Z', MORNING = '2026-09-23T12:05:00Z';
    var pNight = withSha(hm, { audience: 'house', house: 'CAN - 48TH (A) - ABD1547', message: 'Night ask',
                               client_id: run + '-night' });
    HUB_QUIET_NOW = NIGHT;
    s0 = sent.length; m0 = mockRows.length;
    r.night = send(hm, pNight);
    r.nightSent = sent.length - s0;
    r.nightMock = mockRows.slice(m0);
    r.nightOwed = Object.keys(owed).length;
    var pWith = withSha(hm, { audience: 'allstaff', message: 'Night ask two', client_id: run + '-withdraw' });
    r.night2 = send(hm, pWith);
    r.withdrawOther = HUB_ACTIONS.staffBroadcastWithdraw({ id: r.night2.data.broadcast.id }, staff);
    r.withdraw = HUB_ACTIONS.staffBroadcastWithdraw({ id: r.night2.data.broadcast.id }, hm);
    HUB_QUIET_NOW = EARLY;
    s0 = sent.length;
    r.early = hubQuietOwedCarry_({ broadcast: commBroadcastQuietCarry_ });
    r.earlySent = sent.length - s0;
    HUB_QUIET_NOW = MORNING;
    r.morning = hubQuietOwedCarry_({ broadcast: commBroadcastQuietCarry_ });
    r.morningSent = sent.slice(s0);
    r.morningRow = copy(store[r.night.data.broadcast.id]);
    r.morningAgain = hubQuietOwedCarry_({ broadcast: commBroadcastQuietCarry_ });
    var pOffNight = withSha(dir, { audience: 'house', house: 'CAN - 48TH (B) - ABD1711', message: 'Night three',
                                   client_id: run + '-offnight' });
    HUB_QUIET_NOW = NIGHT;
    r.night3 = send(dir, pOffNight);
    sitOn = false;
    HUB_QUIET_NOW = MORNING;
    s0 = sent.length;
    r.offCarry = hubQuietOwedCarry_({ broadcast: commBroadcastQuietCarry_ });
    r.offCarrySent = sent.length - s0;
    r.offCarryRow = copy(store[r.night3.data.broadcast.id]);
    sitOn = true;
    HUB_QUIET_NOW = DAY;

    testOn = true; dialNow = { word: 'record', readable: true };
    var pMockNight = withSha(dir, { audience: 'house', house: 'CAN - 48TH (A) - ABD1547', message: 'TEST',
                                    client_id: run + '-mocknight' });
    HUB_QUIET_NOW = NIGHT;
    r.mockNight = send(dir, pMockNight);
    testOn = false; dialNow = { word: 'send', readable: true };
    r.mockNightView = commBroadcastPublic_(copy(store[r.mockNight.data.broadcast.id]), commBroadcastWho_(dir), true);
    HUB_QUIET_NOW = MORNING;
    s0 = sent.length;
    r.mockCarry = hubQuietOwedCarry_({ broadcast: commBroadcastQuietCarry_ });
    r.mockCarrySent = sent.length - s0;
    r.mockCarryRow = copy(store[r.mockNight.data.broadcast.id]);
    HUB_QUIET_NOW = DAY;
    testOn = true; dialNow = { word: 'record', readable: true };
    var pMockPart = withSha(dir, { audience: 'allstaff', message: 'Test blast', client_id: run + '-mockpart' });
    COMM_BROADCAST_BUDGET_MS = -1;
    r.mockPart = send(dir, pMockPart);
    COMM_BROADCAST_BUDGET_MS = keep.budget;
    testOn = false; dialNow = { word: 'send', readable: true };
    r.mockPartView = commBroadcastPublic_(copy(store[r.mockPart.data.broadcast.id]), commBroadcastWho_(dir), true);
    s0 = sent.length;
    r.mockCont = HUB_ACTIONS.staffBroadcastContinue({ id: r.mockPart.data.broadcast.id }, dir);
    r.mockContSent = sent.length - s0;

    var pRace = withSha(dir, { audience: 'house', house: 'CAN - 48TH (B) - ABD1711', message: 'Race ask',
                               client_id: run + '-race' });
    HUB_QUIET_NOW = NIGHT;
    r.race = send(dir, pRace);
    HUB_QUIET_NOW = MORNING;
    commBroadcastClaim_ = function (cid, allowed) {
      r.raceWithdraw = HUB_ACTIONS.staffBroadcastWithdraw({ id: cid }, dir);
      return keep.claim(cid, allowed);
    };
    s0 = sent.length;
    r.raceCarry = hubQuietOwedCarry_({ broadcast: commBroadcastQuietCarry_ });
    r.raceSent = sent.length - s0;
    commBroadcastClaim_ = keep.claim;
    r.raceRow = copy(store[r.race.data.broadcast.id]);
    HUB_QUIET_NOW = DAY;
    var pBusy = withSha(dir, { audience: 'house', house: 'CAN - 48TH (B) - ABD1711', message: 'Busy ask',
                               client_id: run + '-busy' });
    HUB_QUIET_NOW = NIGHT;
    r.busy = send(dir, pBusy);
    HUB_QUIET_NOW = MORNING;
    commBroadcastClaim_ = function () {
      return { refused: 'another broadcast pass holds the lock — try again in a moment', busy: true };
    };
    s0 = sent.length;
    r.busyCarry = hubQuietOwedCarry_({ broadcast: commBroadcastQuietCarry_ });
    r.busySent = sent.length - s0;
    commBroadcastClaim_ = keep.claim;
    s0 = sent.length;
    r.busyLater = hubQuietOwedCarry_({ broadcast: commBroadcastQuietCarry_ });
    r.busyLaterSent = sent.length - s0;
    HUB_QUIET_NOW = DAY;

    var pPart = withSha(dir, { audience: 'allstaff', message: 'Partial test', client_id: run + '-part' });
    COMM_BROADCAST_BUDGET_MS = -1;
    s0 = sent.length;
    r.part = send(dir, pPart);
    r.partSent = sent.length - s0;
    COMM_BROADCAST_BUDGET_MS = keep.budget;
    r.contOther = HUB_ACTIONS.staffBroadcastContinue({ id: r.part.data.broadcast.id }, hm);
    r.cont = HUB_ACTIONS.staffBroadcastContinue({ id: r.part.data.broadcast.id }, dir);
    r.contSent = sent.slice(s0);
    /* a crash between the send and its mark: the row forgets, the receipts do not */
    var crashed = store[r.part.data.broadcast.id];
    crashed.recipients.forEach(function (x) { x.o = 'pending'; delete x.w; });
    crashed.state = 'partial';
    crashed.next_index = 0;
    s0 = sent.length;
    r.replay = HUB_ACTIONS.staffBroadcastContinue({ id: crashed.id }, dir);
    r.replaySent = sent.length - s0;
    r.stale = commBroadcastState_({ state: 'sending', updatedAt: new Date(Date.now() - 4 * 60000).toISOString() },
                                  Date.now());
    r.live = commBroadcastState_({ state: 'sending', updatedAt: new Date().toISOString() }, Date.now());
    var died = function (minutesAgo, tag) {
      var d = copy(store[r.part.data.broadcast.id]);
      d.id = 'BC_' + tag + run;
      d.client_id = run + '-' + tag;
      d.state = 'sending';
      d.next_index = 0;
      d.recipients.forEach(function (x) { x.o = 'pending'; delete x.w; });
      d.updatedAt = new Date(Date.now() - minutesAgo * 60000).toISOString();
      return d;
    };
    r.diedRecent = commBroadcastPublic_(died(10, 'recent'), commBroadcastWho_(dir), true);
    store['BC_old' + run] = died(7 * 60, 'old');
    r.diedOld = commBroadcastPublic_(copy(store['BC_old' + run]), commBroadcastWho_(dir), true);
    s0 = sent.length;
    r.diedOldCont = HUB_ACTIONS.staffBroadcastContinue({ id: 'BC_old' + run }, dir);
    r.diedOldSent = sent.length - s0;
    r.diedOldRow = copy(store['BC_old' + run]);

    houseReady = false;
    s0 = sent.length;
    r.noHouse = send(dir, { audience: 'allstaff', message: 'no house', client_id: run + '-nohouse',
                            audience_sha: 'x' });
    houseReady = true;
    dialNow = { word: 'off', readable: false };
    r.blind = send(dir, { audience: 'allstaff', message: 'blind dial', client_id: run + '-blind',
                          audience_sha: 'x' });
    dialNow = { word: 'send', readable: true };
    sitOn = false;
    r.offRow = send(dir, { audience: 'allstaff', message: 'switched off', client_id: run + '-sitoff',
                           audience_sha: 'x' });
    sitOn = true;
    r.refusedSent = sent.length - s0;
    r.dotSend = send(dir, { audience: 'allstaff', message: '.', client_id: run + '-dot', audience_sha: 'x' });

    r.storeCount = Object.keys(store).length;
    fresh();
    r.dirBoard = HUB_ACTIONS.staffBroadcastBoard({}, dir);
    fresh();
    r.hmBoard2 = HUB_ACTIONS.staffBroadcastBoard({}, hm);
  } catch (e) {
    r.error = String((e && e.message) || e) + ' ' + String((e && e.stack) || '').slice(0, 400);
  } finally {
    commBroadcastCalendarRows_ = keep.calRows; commBroadcastCache_ = keep.cache;
    commBroadcastPeopleRows_ = keep.people; commBroadcastClientKeys_ = keep.clients;
    commBroadcastRows_ = keep.rows; commBroadcastPut_ = keep.put; commBroadcastHouseReady_ = keep.ready;
    if (keep.relay) staffRelayPost_ = keep.relay;
    commCallOffEveryoneAudience_ = keep.every; commCallOffHouseManagersAudience_ = keep.hms;
    smartSituationOn_ = keep.on; smartSituations_ = keep.sits; commDialState_ = keep.dialState;
    commDial_ = keep.dial; commTestMode_ = keep.test; hubRehearsalToSheet_ = keep.sheet;
    hubRehearsalWrite_ = keep.rhWrite; commMockWrite_ = keep.mockWrite; COMM_MOCK_DEAD = keep.mockDead;
    COMM_MOCK_WRITTEN = keep.mockWritten; commMockQuietSeen_ = keep.mockSeen;
    if (keep.optIdx) optOutIndex_ = keep.optIdx;
    RPC_TEST_TRANSPORT = keep.transport; RPC_TEST_FORCE_ON = keep.force; HUB_QUIET_NOW = keep.now;
    hubQuietOwedKeys_ = keep.oKeys; hubQuietOwedGet_ = keep.oGet; hubQuietOwedSet_ = keep.oSet;
    hubQuietOwedDel_ = keep.oDel; hubSysLog_ = keep.log; smartRecord_ = keep.record;
    if (keep.setting) digestSetting_ = keep.setting;
    HUB_MASTER_EMAIL_CACHE = keep.master; COMM_BROADCAST_CAL_MEMO = keep.memo;
    COMM_BROADCAST_BUDGET_MS = keep.budget; commBroadcastClaim_ = keep.claim;
  }

  var J = function (o) { return JSON.stringify(o === undefined ? null : o).slice(0, 600); };
  var names = function (res) {
    return ((res && res.data && res.data.recipients) || []).map(function (x) { return x.name; }).join(',');
  };
  var dropped = function (res, reason) {
    var hit = ((res && res.data && res.data.dropped) || []).filter(function (d) { return d.reason === reason; })[0];
    return hit || { count: 0, names: [] };
  };
  stAssert_(out, 'broadcast: the section ran to the end', !r.error, r.error);

  var w = r.who || {};
  stAssert_(out, 'broadcast: a director, a team lead, an admin and the master reach every audience; a house manager ' +
                 'is a house manager; plain staff and the service identity may not broadcast at all',
            w.dir && w.dir.above && w.lead.above && w.admin.above && w.boss.above && w.boss.master &&
            !w.hm.above && w.hm.hm && w.hm.ok && !w.staff.ok && !w.svc.ok && !!w.staff.why, J(w));

  var cal = r.cal || { houses: {} };
  var A = cal.houses['CAN - 48TH (A) - ABD1547'] || { people: [] };
  var B = cal.houses['CAN - 48TH (B) - ABD1711'] || { people: [] };
  var M = cal.houses['CAN - MS - MS4060'] || { people: [] };
  stAssert_(out, 'broadcast: a house\'s staff are its calendar rows in the window — the last 28 days and ' +
                 'everything scheduled — with OPEN, WORKSHOP and a row two months old left out',
            cal.readable && A.label === '48TH (A)' &&
            A.people.map(function (p) { return p.name; }).join(',') === 'Ann Able,Ben Baker,Cal Coe' &&
            B.people.map(function (p) { return p.name; }).join(',') === 'Ben Baker,Dee Dunn' &&
            M.people.map(function (p) { return p.name; }).join(',') === 'Eve Echo',
            J({ A: A.people, B: B.people, M: M.people }));
  stAssert_(out, 'broadcast: a star in the Designation column is Med Del, ** is the house manager — read off the ' +
                 'same calendar the `housemanagers` keyword reads',
            A.people.filter(function (p) { return p.meddel; }).length === 2 &&
            (cal.managers || []).map(function (m) { return m.name + '@' + m.location; }).sort().join(',') ===
              'Ann Able@CAN - 48TH (A) - ABD1547,Eve Echo@CAN - MS - MS4060', J(cal.managers));
  stAssert_(out, 'broadcast: a calendar that will not open is "we cannot see" — no houses, a reason, and it is not ' +
                 'cached, so the next ask opens the book again',
            r.calBad && !r.calBad.readable && Object.keys(r.calBad.houses).length === 0 &&
            String(r.calBad.why).indexOf('we cannot see') !== -1 && r.calBadReads === 2, J(r.calBad));

  stAssert_(out, 'broadcast: a house manager writes to the staff of their OWN house and to all staff — another ' +
                 'house is refused naming the house the calendar gives them, and Leadership is refused',
            r.hmHouseA && r.hmHouseA.status === 200 && r.hmAll.status === 200 &&
            r.hmHouseB.status === 403 && String(r.hmHouseB.message).indexOf('48TH (A)') !== -1 &&
            r.hmLead.status === 403, J([r.hmHouseB, r.hmLead]));
  stAssert_(out, 'broadcast: a house manager is found by NAME first; a number is only the fallback, because a ' +
                 'household handset is shared',
            r.phoneHouses && r.phoneHouses.via === 'phone' &&
            r.phoneHouses.houses.join(',') === 'CAN - MS - MS4060', J(r.phoneHouses));
  stAssert_(out, 'broadcast: a shared line names nobody — a profile carrying the 5558 is handed no house, even where a ' +
                 'manager\'s only calendar number is the 5558',
            r.sharedPhoneHouses && r.sharedPhoneHouses.houses.length === 0 && r.sharedPhoneHouses.via === '' &&
            r.sharedKey && r.sharedKey[0] === true && r.sharedKey[1] === false,
            J({ houses: r.sharedPhoneHouses, keys: r.sharedKey }));
  stAssert_(out, 'broadcast: an account linked to its People row is that row — a display name typed to match another ' +
                 'manager hands over nothing of theirs',
            r.linkedHouses && r.linkedHouses.via === 'name' &&
            r.linkedHouses.houses.join(',') === 'CAN - 48TH (A) - ABD1547', J(r.linkedHouses));
  stAssert_(out, 'broadcast: a house is the calendar\'s exact location — "48TH" matches nothing, never two houses',
            r.substr && r.substr.status === 403 && String(r.substr.message).indexOf('not on the calendar') !== -1,
            J(r.substr));
  var hb = (r.hmBoard && r.hmBoard.data) || {};
  var auds = {};
  (hb.audiences || []).forEach(function (a) { auds[a.id] = a.allowed; });
  stAssert_(out, 'broadcast: the page is told who may send — staff read why not, a house manager is offered their ' +
                 'own house alone, and Leadership stays closed to them',
            r.staffBoard.data.can_send === false && !!r.staffBoard.data.why &&
            r.staffBoard.data.situation === null && r.staffBoard.data.mode === null &&
            !!hb.situation && !!hb.mode && hb.situation.cc === undefined &&
            r.staffPreview.status === 403 && hb.can_send === true &&
            (hb.houses || []).map(function (h) { return h.label; }).join(',') === '48TH (A)' &&
            auds.allstaff === true && auds.house === true && auds.leadership === false,
            J({ staff: r.staffBoard.data, hm: hb.houses, auds: auds }));

  stAssert_(out, 'broadcast: All staff is the `allstaff` keyword, deduplicated by the normalised number (one ' +
                 'person spelled two ways is texted once), with the opted-out and the unnumbered counted, not texted',
            r.all.status === 200 && names(r.all) === 'Ann Able,Ben Baker,Fay Fox' && r.all.data.count === 3 &&
            dropped(r.all, 'opted_out').count === 1 && dropped(r.all, 'no_number').count === 2 &&
            (r.all.data.notes || []).join(' ').indexOf('texted once') !== -1, J(r.all.data));
  stAssert_(out, 'broadcast: One house is that house\'s staff — People\'s number first, and somebody People says ' +
                 'has left is not texted; with Med Del only, the starred ones',
            names(r.houseA) === 'Ann Able,Ben Baker' &&
            dropped(r.houseA, 'not_on_staff').names.join(',') === 'Cal Coe' &&
            names(r.houseAMed) === 'Ann Able,Ben Baker', J([r.houseA.data, r.houseAMed.data]));
  var medFrom = {};
  ((r.med.data || {}).recipients || []).forEach(function (x) { medFrom[x.name] = x.from; });
  stAssert_(out, 'broadcast: Only Med Del is every starred person on the calendar once, the calendar\'s own number ' +
                 'standing in where People holds none, and a manager whose only number is the shared line is nobody',
            names(r.med) === 'Ann Able,Ben Baker,Dee Dunn' && medFrom['Dee Dunn'] === 'calendar' &&
            medFrom['Ann Able'] === 'people' && dropped(r.med, 'not_textable').names.join(',') === 'Eve Echo',
            J(r.med.data));
  var leadTo = ((r.lead.data || {}).recipients || []).map(function (x) { return x.name + '/' + x.from; });
  stAssert_(out, 'broadcast: Leadership is `housemanagers` + `directors` (the 5558 group), and the Cc cell joins ' +
                 'it — a keyword already there is texted once, an e-mail address is said and skipped',
            r.lead.status === 200 && r.lead.data.count === 4 &&
            leadTo.indexOf('the 5558 group/keyword:directors') !== -1 && leadTo.indexOf('Hal Head/keyword:housemanagers') !== -1 &&
            leadTo.indexOf('Cc cell/cc') !== -1 && dropped(r.lead, 'cc_address').count === 1, J(r.lead.data));
  stAssert_(out, 'broadcast: the Cc cell reaches the page as a count — its entries are never echoed, and one left ' +
                 'out is counted without its address',
            r.lead.data.situation.cc === undefined && r.lead.data.situation.cc_count === 3 &&
            dropped(r.lead, 'cc_address').names.length === 0 &&
            JSON.stringify(r.lead.data).indexOf('someone@example.org') === -1 &&
            JSON.stringify(r.lead.data).indexOf('3305550199') === -1, J(r.lead.data));
  stAssert_(out, 'broadcast: the Cc cell joins the company-wide audiences and never a house',
            r.houseCc.status === 200 && names(r.houseCc) === 'Ben Baker,Dee Dunn', J(r.houseCc.data));
  stAssert_(out, 'broadcast: PRN is the Staff Preferences NOTE the relay reads, mapped through People and the ' +
                 'calendar; a name found nowhere is said, and a note that only mentions PRN is reported, not counted',
            names(r.prn) === 'Dee Dunn,Fay Fox' && dropped(r.prn, 'not_found').names.join(',') === 'Zed Nowhere' &&
            (r.prn.data.notes || []).join(' ').indexOf('Ivy Ink') !== -1, J(r.prn.data));
  stAssert_(out, 'broadcast: a PRN door that does not answer, or People that will not open, is "we cannot see" — ' +
                 'never an audience of nobody, and never one of somebody',
            r.prnDown.status === 200 && r.prnDown.data.readable === false && r.prnDown.data.count === 0 &&
            String(r.prnDown.data.why.join(' ')).indexOf('never "nobody is PRN"') !== -1 &&
            r.peopleDown.data.readable === false && r.peopleDown.data.count === 0, J([r.prnDown.data, r.peopleDown.data]));

  var wd = r.words || {};
  stAssert_(out, 'broadcast: an empty, a "." and a one-character text are refused; two characters may go; too long ' +
                 'a message or signature is refused with its length',
            !!wd.empty && !!wd.dot && !!wd.one && wd.two === '' && String(wd.long).indexOf(String(COMM_BROADCAST_TEXT_MAX)) !== -1 &&
            String(wd.sig).indexOf(String(COMM_BROADCAST_SIGNATURE_MAX)) !== -1 &&
            r.dotSend && r.dotSend.status === 400, J(wd));
  stAssert_(out, 'broadcast: the words that carry a call-off\'s reason are found as whole words, and warned about ' +
                 'for staff — never for Leadership, who may know why',
            (wd.hits || []).join(',') === 'emergency,family' && (wd.clean || []).length === 0 &&
            (r.warnAll.data.reason_words || []).join(',') === 'hospital' &&
            (r.warnLead.data.reason_words || []).length === 0, J([wd.hits, r.warnAll.data.reason_words]));
  stAssert_(out, 'broadcast: a text that says WHO left the shift open is warned about too — "called off", "no call", ' +
                 '"no show" are on the floor beside the reasons',
            (wd.calledOff || []).indexOf('called off') !== -1 &&
            (wd.noShow || []).indexOf('no call') !== -1 && (wd.noShow || []).indexOf('no show') !== -1,
            J([wd.calledOff, wd.noShow]));
  stAssert_(out, 'broadcast: no signature, no signature line; "Hi {first_name}," with no name reads "Hi,"; a line ' +
                 'left with only a dash goes; an unknown placeholder stays visible',
            wd.noSig === 'Open shift today' && wd.withSig === 'Open shift today\nTonisha' &&
            wd.hi === 'Hi, open shift' && wd.dash === 'm' && wd.unknown === 'm {nobody}', J(wd));
  stAssert_(out, 'broadcast: only the gap is closed up — the sender\'s own dashes, spaces and commas are theirs, ' +
                 'and a placeholder they typed into the message is text, not a slot',
            wd.ownDash === '-  Open  shift ,today' && wd.lead === 'Open shift' && wd.typed === 'Hi {first_name}', J(wd));

  var ts = (r.testSend && r.testSend.data && r.testSend.data.broadcast) || {};
  var rhIds = {};
  (r.testRh || []).forEach(function (x) { rhIds[x.id] = true; });
  stAssert_(out, 'broadcast: TEST MODE — every copy goes through the one door and becomes a row in the rehearsal ' +
                 'book AND the mock outbox, one per recipient, and NOBODY IS CONTACTED',
            r.testSend.status === 200 && ts.state === 'done' && ts.tally.recorded === 2 && ts.tally.sent === 0 &&
            r.testSent === 0 && (r.testRh || []).length === 2 && Object.keys(rhIds).length === 2 &&
            (r.testMock || []).length === 2 &&
            (r.testMock || []).every(function (m) { return m.result === 'rehearsed' && m.situation === 'staff_broadcast'; }) &&
            (r.testRh || []).every(function (x) { return x.situation === 'staff_broadcast' && x.body === 'Open shift 8A-4P\nDora'; }),
            J({ ts: ts, rh: (r.testRh || []).length, mock: r.testMock }));
  stAssert_(out, 'broadcast: the same press twice is one broadcast — the second answers the first and writes nothing',
            r.testAgain && r.testAgain.data && r.testAgain.data.already === true && r.testAgainRows === 2,
            J(r.testAgain));

  var ps = (r.prodSend && r.prodSend.data && r.prodSend.data.broadcast) || {};
  var prodTo = (r.prodSent || []).map(function (x) { return x.to; }).sort().join(',');
  stAssert_(out, 'broadcast: PRODUCTION — one text per number, each number once, the words as written, through ' +
                 'the one door; the ledger gets one line',
            ps.state === 'done' && ps.tally.sent === 3 && prodTo === '+13305550101,+13305550102,+13305550106' &&
            (r.prodSent || []).every(function (x) { return x.name === 'smsSend' && x.body === 'Schedule for October is posted'; }) &&
            r.prodLedger === 1, J({ ps: ps, sent: r.prodSent }));
  stAssert_(out, 'broadcast: the same key carrying DIFFERENT words is refused with nothing sent — a corrected text is ' +
                 'never swallowed as "already sent"; the same words again still answer the first',
            r.fixFirst && r.fixFirst.status === 200 && r.fixAgain && r.fixAgain.status === 409 &&
            String(r.fixAgain.message).indexOf('the message') !== -1 &&
            r.fixSame && r.fixSame.data && r.fixSame.data.already === true && r.fixSent === 2,
            J({ again: r.fixAgain, same: r.fixSame && r.fixSame.status, sent: r.fixSent }));
  stAssert_(out, 'broadcast: the page is handed names and the last four digits — never a whole number',
            JSON.stringify(ps.recipients || []).indexOf('3305550101') === -1 &&
            JSON.stringify(ps.recipients || []).indexOf('•••0101') !== -1, J(ps.recipients));

  var os = (r.offSend && r.offSend.data && r.offSend.data.broadcast) || {};
  stAssert_(out, 'broadcast: with the sending switch off every copy is HELD with the reason — never "sent" for one ' +
                 'a brake held',
            os.state === 'done' && os.tally.held === 2 && os.tally.sent === 0 && r.offSent === 0 &&
            (os.recipients || []).every(function (x) { return x.outcome === 'held' && x.why.indexOf('HUB_RPC_SEND') !== -1; }),
            J(os));
  stAssert_(out, 'broadcast: what each door answer becomes on the row',
            commBroadcastOutcome_({ ok: true, sent: true }).o === 'sent' &&
            commBroadcastOutcome_({ ok: true, deduplicated: true }).o === 'sent' &&
            commBroadcastOutcome_({ ok: true, sent: false, gated: true, rehearsed: true }).o === 'recorded' &&
            commBroadcastOutcome_({ ok: true, gated: true, rehearsed: true, rehearsal_recorded: false }).o === 'held' &&
            commBroadcastOutcome_({ ok: true, gated: true, recorded_to: 'x' }).o === 'recorded' &&
            commBroadcastOutcome_({ ok: true, sent: false, gated: true, reason: 'opted_out' }).o === 'refused' &&
            commBroadcastOutcome_({ ok: true, sent: false, gated: true, reason: 'HUB_RPC_SEND is off' }).o === 'held' &&
            commBroadcastOutcome_({ ok: true, sent: false, gated: true, quiet: true }).o === 'pending' &&
            commBroadcastOutcome_({ ok: false, error: 'provider_400' }).o === 'failed' &&
            commBroadcastOutcome_(null).o === 'failed', '');

  stAssert_(out, 'broadcast: an audience that moved between the preview and the press sends NOTHING, writes no row, ' +
                 'and hands the page the new list to confirm',
            r.moved && r.moved.data && r.moved.data.changed === true && r.moved.data.sent_nothing === true &&
            r.moved.data.preview.count === 3 && r.movedSent === 0 && r.movedStored === false, J(r.moved));

  var nb = (r.night && r.night.data && r.night.data.broadcast) || {};
  stAssert_(out, 'broadcast: at 23:00 the quiet window holds the whole broadcast before a single copy — one held ' +
                 'row in the mock outbox for the audience, on the morning list, nobody contacted',
            nb.state === 'held_quiet' && nb.tally.pending === 2 && r.nightSent === 0 &&
            (r.nightMock || []).length === 1 && r.nightMock[0].result === 'held_quiet' &&
            Number(r.nightMock[0].audience) === 2 && r.nightOwed === 1 && nb.can_withdraw === true &&
            nb.can_continue === false, J({ nb: nb, mock: r.nightMock }));
  stAssert_(out, 'broadcast: only its author or somebody above may withdraw it, and a withdrawn broadcast is never ' +
                 'asked again',
            r.withdrawOther && r.withdrawOther.status === 403 && r.withdraw.status === 200 &&
            r.withdraw.data.broadcast.state === 'withdrawn' && r.withdraw.data.broadcast.tally.withdrawn === 3,
            J([r.withdrawOther, r.withdraw && r.withdraw.data]));
  var mt = (r.morningSent || []).map(function (x) { return x.to; }).sort().join(',');
  stAssert_(out, 'broadcast: 07:59 says nothing; the first pass after 08:00 sends the held one to the people it ' +
                 'was confirmed for, lets the withdrawn one go, and a second pass finds nothing',
            r.early && r.early.waiting === 2 && r.earlySent === 0 &&
            r.morning && r.morning.carried === 1 && r.morning.stale === 1 &&
            mt === '+13305550101,+13305550102' && r.morningRow && r.morningRow.state === 'done' &&
            r.morningAgain && r.morningAgain.carried === 0 && r.morningAgain.stale === 0,
            J({ early: r.early, morning: r.morning, sent: r.morningSent, again: r.morningAgain }));
  stAssert_(out, 'broadcast: a broadcast whose row was switched off overnight is let go at 08:00 — nobody contacted, ' +
                 'and the row says why',
            r.offCarry && r.offCarry.stale === 1 && r.offCarrySent === 0 && r.offCarryRow &&
            r.offCarryRow.state === 'stopped' && String(r.offCarryRow.why).indexOf('switched off') !== -1,
            J({ carry: r.offCarry, row: r.offCarryRow && r.offCarryRow.state }));

  var mv = r.mockNightView || {};
  stAssert_(out, 'broadcast: a broadcast confirmed while test mode was on is NEVER sent for real — held overnight, ' +
                 'test mode off by the morning: the carry stops it, nobody is texted, and the row says why',
            r.mockNight && r.mockNight.data.broadcast.state === 'held_quiet' &&
            r.mockNight.data.broadcast.test_mode === 'on' &&
            mv.can_continue === false && mv.can_resend === true && String(mv.hold_why).indexOf('test mode') !== -1 &&
            r.mockCarry && r.mockCarry.stale === 1 && r.mockCarry.carried === 0 && r.mockCarrySent === 0 &&
            r.mockCarryRow && r.mockCarryRow.state === 'stopped' && r.mockCarryRow.held === 2 &&
            r.mockCarryRow.pending === 0 && String(r.mockCarryRow.why).indexOf('test mode') !== -1,
            J({ view: mv, carry: r.mockCarry, row: r.mockCarryRow && r.mockCarryRow.state }));
  var mp = r.mockPartView || {};
  var mc = (r.mockCont && r.mockCont.data) || {};
  stAssert_(out, 'broadcast: a test-mode pass that stopped part way is not continued after test mode goes off — no ' +
                 'Continue is offered, and pressing it anyway stops the row with nobody texted',
            r.mockPart && r.mockPart.data.broadcast.state === 'partial' && mp.can_continue === false &&
            mp.can_resend === true && String(mp.hold_why).indexOf('test mode') !== -1 &&
            String(mc.refused || '').indexOf('test mode') !== -1 && mc.broadcast && mc.broadcast.state === 'stopped' &&
            mc.broadcast.tally.sent === 0 && r.mockContSent === 0,
            J({ view: mp, cont: mc }));

  stAssert_(out, 'broadcast: the morning carry takes the row under the lock — a Withdraw that lands between its read ' +
                 'and its claim wins, and nobody is texted',
            r.raceWithdraw && r.raceWithdraw.status === 200 && r.raceCarry && r.raceCarry.stale === 1 &&
            r.raceCarry.carried === 0 && r.raceSent === 0 && r.raceRow && r.raceRow.state === 'withdrawn' &&
            r.raceRow.withdrawn === 2,
            J({ carry: r.raceCarry, row: r.raceRow && r.raceRow.state }));
  stAssert_(out, 'broadcast: a carry that cannot take the lock keeps the broadcast for the next pass and sends ' +
                 'nothing; the next pass sends it',
            r.busyCarry && r.busyCarry.carried === 1 && r.busySent === 0 &&
            r.busyLater && r.busyLater.carried === 1 && r.busyLaterSent === 2 &&
            stCode_(commBroadcastQuietCarry_).indexOf('commBroadcastClaim_(') !== -1,
            J({ busy: r.busyCarry, later: r.busyLater, sent: r.busyLaterSent }));

  var pb = (r.part && r.part.data && r.part.data.broadcast) || {};
  var cb = (r.cont && r.cont.data && r.cont.data.broadcast) || {};
  stAssert_(out, 'broadcast: a pass that runs out of budget stops, says how many were never asked, and Continue ' +
                 'sends exactly those — only for its author or somebody above',
            pb.state === 'partial' && pb.tally.pending === 3 && r.partSent === 0 && pb.can_continue === true &&
            r.contOther && r.contOther.status === 403 && cb.state === 'done' && cb.tally.sent === 3 &&
            (r.contSent || []).length === 3, J({ pb: pb, cb: cb }));
  stAssert_(out, 'broadcast: continuing after a crash that lost the marks texts NOBODY twice — each copy\'s own ' +
                 'receipt answers for it',
            r.replay && r.replay.data && r.replay.data.broadcast.state === 'done' && r.replaySent === 0 &&
            r.replay.data.broadcast.tally.sent === 3, J(r.replay && r.replay.data));
  stAssert_(out, 'broadcast: a row left `sending` for minutes is interrupted; a fresh one is still sending',
            r.stale === 'interrupted' && r.live === 'sending', J([r.stale, r.live]));
  var dOld = r.diedOld || {};
  stAssert_(out, 'broadcast: a pass cut short minutes ago may be continued (each copy\'s receipt still answers for ' +
                 'it); one cut short past the receipts\' life is refused — nobody texted twice, the row untouched',
            r.diedRecent && r.diedRecent.state === 'interrupted' && r.diedRecent.can_continue === true &&
            !r.diedRecent.hold_why && dOld.state === 'interrupted' && dOld.can_continue === false &&
            dOld.can_withdraw === true && String(dOld.hold_why).indexOf('receipts') !== -1 &&
            r.diedOldCont && String((r.diedOldCont.data || {}).refused || '').indexOf('receipts') !== -1 &&
            r.diedOldSent === 0 && r.diedOldRow && r.diedOldRow.state === 'sending',
            J({ recent: r.diedRecent && r.diedRecent.can_continue, old: dOld.hold_why, cont: r.diedOldCont }));

  stAssert_(out, 'broadcast: nothing is sent without its house, on an unreadable test-mode switch, or with the row ' +
                 'switched off — each refused out loud',
            r.noHouse && r.noHouse.status === 503 && r.blind && r.blind.status === 503 &&
            r.offRow && r.offRow.status === 409 && r.refusedSent === 0, J([r.noHouse, r.blind, r.offRow]));

  var dh = ((r.dirBoard && r.dirBoard.data) || {}).history || [];
  var hh = ((r.hmBoard2 && r.hmBoard2.data) || {}).history || [];
  stAssert_(out, 'broadcast: the history is every broadcast for somebody above, and a house manager\'s own for them',
            dh.length === Math.min(r.storeCount, COMM_BROADCAST_HISTORY) && hh.length === 2 &&
            hh.every(function (h) { return h.mine; }) &&
            dh.filter(function (h) { return !h.mine; }).length === 2,
            J({ dir: dh.length, stored: r.storeCount, hm: hh.length }));

  stAssert_(out, 'broadcast: every copy leaves through rpcCall_ and nothing else, the reads never reach the loop, ' +
                 'and the hotline pass carries the night\'s broadcasts',
            stCode_(commBroadcastSendOne_).indexOf("rpcCall_('smsSend'") !== -1 &&
            stCode_(HUB_ACTIONS.staffBroadcastPreview).indexOf('commBroadcastSendLoop_') === -1 &&
            stCode_(HUB_ACTIONS.staffBroadcastBoard).indexOf('commBroadcastSendLoop_') === -1 &&
            stCode_(HUB_ACTIONS.hotlineSweep).indexOf('commBroadcastQuietCarry_') !== -1 &&
            stCode_(smartEventSweep_).indexOf("=== 'broadcast'") !== -1 &&
            OPT_OUT_SCOPE_BY_FILE['CommBroadcast.gs'] === 'staff' &&
            SMART_EVENT_SENDERS.staff_broadcast === 'CommBroadcast.gs', '');
  var seed = null;
  SMART_EXTRA_SITUATIONS_SEED.forEach(function (s) { if (s.id === 'staff_broadcast') seed = s; });
  stAssert_(out, 'broadcast: the row is born ON, texting the sender\'s words — {message} and the signature — with ' +
                 'no `to` a cell could widen',
            !!seed && seed.enabled === 'yes' && seed.channels === 'sms' && seed.to === '' &&
            seed.sms_text === '{message}\n{signature}' && seed.event === 'staff_broadcast', J(seed));
}
