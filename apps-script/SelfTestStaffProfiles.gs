/** The Employee Database Master as the fixture holds it: the scorecard block, then `Status` onward, the real duplicate headers. */
function stSpMasterGrid_() {
  var cols = [
    ['Employee', 'Ann9 Lee', 'Bob9 Twin', 'Cara9 Only', 'Bob9 Twin', 'Dee9 Solo'],
    ['Job App', 1, 1, 1, 1, 0],
    ['Attestation', 1, 1, 1, 1, 0],
    ['i9 Form', 1, 1, 1, 1, 0],
    ['i9 (Type 1)', 'Driver License', '', '', '', ''],
    ['W4', 1, 1, 1, 1, 0],
    ['HIPAA', 1, 1, 1, 1, 0],
    ['Pay Auth', 1, 1, 1, 1, 0],
    ['HS Diploma', 1, 1, 1, 1, 0],
    ['Drive Abstract (last)', 1, 1, 1, 1, 0],
    ['Car Insurance', 1, 1, 1, 1, 0],
    ['SAM', 1, 1, 1, 1, 0],
    ['OIG', 1, 1, 1, 1, 0],
    ['Abuser', 1, 1, 1, 1, 0],
    ['Sex Offender', 0.5, 1, 1, 1, 0],
    ['Offender', 0.5, 1, 1, 1, 0],
    ['Nurse Aide', 1, 1, 1, 1, 0],
    ['Exclusions', 1, 1, 1, 1, 0],
    ['BCI', 1, 1, 1, 1, 0],
    ['Rapback', 1, 1, 1, 1, 0],
    ['Status', 'Yes', 'Yes', 'No', 'Yes', 'Other'],
    ['Employee ID', '100001', '100002', '100003', '100004', '100005'],
    ['First Name', 'Ann9', 'Bob9', 'Cara9', 'Bob9', ''],
    ['Last Name', 'Lee', 'Twin', 'Only', 'Twin', ''],
    ['SSN#', '987-65-4323', '', '', '', ''],
    ['SSN (Last 4)', '', '', 1842, '', ''],
    ['Date of Birth', new Date(Date.UTC(1990, 4, 17, 16)), '', '', '', ''],
    ['Address', '12 Main St NW', '', '', '', ''],
    ['City', 'Canton', '', '', '', ''],
    ['State', 'OH', '', 'OH', '', ''],
    ['Zip', '44708', '', '', '', ''],
    ['Phone Number', '(330) 555-0101', '(330) 555-0202', '(330) 555-0303', '', ''],
    ['Email', 'ann9.lee@example.org', '', 'cara9@example.org', '', ''],
    ['Referral', 'Rae Ref', '', '', '', ''],
    ['Referral Paid?', 'Yes 5/1/2025', '', '', '', ''],
    ['Start Date(doc)', '01/02/2024', '', '', '', ''],
    ['Start Date (first day)', '01/10/2024', '', '', '', ''],
    ['End Date\n(last day)', '', '', '08/31/2026', '', ''],
    ['Job App Date', '12/20/2023', '', '', '', ''],
    ['Resume', 'Yes', '', 'No', '', ''],
    ['Attestation Date', '12/21/2023', '', '', '', ''],
    ['I-9 Date', '12/22/2023', '', '', '', ''],
    ['I-9 Completed', 'No', '', '', '', ''],
    ['I-9 Type 1', 'Driver License', '', '', '', ''],
    ['I-9 1 Exp Date', '06/30/2027', '', '', '', ''],
    ['I-9 Type 2 ', 'Social Security', '', '', '', ''],
    ['I-9 2 Exp Date', 'n/a', '', '', '', ''],
    ['W-4 Date', '12/22/2023', '', '', '', ''],
    ['HIPAA Form Date', '12/22/2023', '', '', '', ''],
    ['Pay Auth Form Date', '12/22/2023', '', '', '', ''],
    ['HS Diploma', 'Yes', '', 'No, I don\'t have one', '', ''],
    ['Driver', 'Yes', '', 'No', '', ''],
    ['DL#', '12347731', '', 'SV123456', '', ''],
    ['License Exp Date', '06/30/2027', '', '', '', ''],
    ['Driver\'s Abstract (Original)', '01/05/2024', '', '', '', ''],
    ['Driver\'s Abstract (Latest)', '01/05/2026', '', '', '', ''],
    ['Insurance Exp Date', '03/01/2027', '', '', '', ''],
    ['SAM', '01/03/2024', '', '', '', ''],
    ['OIG', '01/03/2024', '', '', '', ''],
    ['Abuser Registry', '01/03/2024', '', '', '', ''],
    ['Sex Offender', '01/03/2024', '', '', '', ''],
    ['Offender', '01/03/2024', '', '', '', ''],
    ['Nurse Aide', 'n/a', '', '', '', ''],
    ['Exclusions Database', '01/03/2024', '', '', '', ''],
    ['BCI/FBI', 'BMT123456789', '', '', '', ''],
    ['BCI Check Date', '01/04/2024', '', '', '', ''],
    ['Rapback Entry Date', '01/08/2024', '', '', '', ''],
    ['Login', 'ann9.lee.login', '', '', '', ''],
    ['Password', 'Secret.4323!', '', '', '', '']
  ];
  var grid = [];
  for (var r = 0; r < cols[0].length; r++) grid.push(cols.map(function (c) { return c[r]; }));
  return grid;
}

/** The Employee Database's employee driver tab with its real headers: two rows for one name, rows with no driving fact, words in Points. */
function stSpDriverGrid_() {
  return [
    ['Employee', 'Status', 'First Name', 'Last Name', 'SSN#', 'Date of Birth', 'Driver', 'DL #', 'Points', 'License Exp Date',
     'Driver\'s Abstract (Original)', 'Driver\'s Abstract (Latest)', 'Insurance Exp Date'],
    ['Ann9 Lee', 'Yes', 'Ann9', 'Lee', '987-65-4323', new Date(Date.UTC(1990, 4, 17, 16)), 'Yes', 'SV128707', 2, '06/30/2027',
     'n/a', '01/05/2026', '3/1/2027'],
    ['Bob9 Twin', 'Yes', 'Bob9', 'Twin', '', '', 'Yes', '', 0, '', '', '', ''],
    ['Bob9 Twin', 'No', 'Bob9', 'Twin', '', '', 'Suspended', '', 6, '', '', '', ''],
    ['Cara9 Only', 'Yes', 'Cara9', 'Only', '', '5/17/1990', 'Suspended', '12', 'CANT CHECK', '', '', '', ''],
    ['Cara9 Only', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['Dee9 Solo', 'Other', '', '', '', '', 'No', '', '', '', '', '', 'n/a'],
    ['Dee9 Solo', 'No', '', '', '', '', '', '', '', '', '', '', ''],
    ['Eve9 Past', 'Yes', 'Eve9', 'Past', '', '', 'Suspended', 'OH SV554433', 1, '8/1/2026', '9/23', '', '10/20/2026']
  ];
}

/** The Driver Compliance tab with its real headers: two rows for one name that employee driver does not carry. */
function stSpDriverComplianceGrid_() {
  return [
    ['Employee', 'Status', 'Driver', 'DL #', 'Drivers Abstract Latest', 'Insurance Expiration'],
    ['Ann9 Lee', 'Yes', 'Suspended', 'SV128707', '01/05/2026', '03/01/2027'],
    ['Cara9 Only', 'Yes', 'Failure To Reinstate', '', '', ''],
    ['Eve9 Past', 'Yes', 'Yes', '', '', ''],
    ['Fay9 Two', 'Yes', 'Yes', '', '', ''],
    ['Fay9 Two', 'Yes', 'Suspended', '', '', '']
  ];
}

// The Med Del Certs (MAIS) scrape as certReadTab_ hands it back: a history per person, a Date cell as an instant…
function stSpMaisRows_() {
  var row = function (first, last, id, name, type, eff, exp, status, stamp) {
    return { timestamp: stamp || '2026-09-01 10:00:00', search_first: first, search_last: last, search_dob: '05/17/1990',
             dd_id: id, name: name, dob: '05/17/1990', cert_type: type, effective: eff, expiration: exp, status: status };
  };
  return [
    row('Ann9', 'Lee', 'MA00000001', 'Ann9 Lee', 'Cat - I', '1/5/2025', '1/5/2027', 'Expired', '2026-08-01 09:00:00'),
    row('Rob9', 'Smith', 'MA00000011', 'Rob9 J Smith', 'Cat - I', '1/1/2025', '1/1/2027', 'Certified'),
    row('Bob9x', 'Smith', 'MA00000012', 'Rob9 Smith', 'Cat - II', '1/1/2025', '1/1/2027', 'Certified'),
    row('Kay9', 'Lane', 'MA00000013', 'Kay9 Lane', 'Cat - I', '1/1/2025', '1/1/2027', 'Certified'),
    row('Kay9', 'Lane', 'MA00000013', 'Kay9 M Lane', 'Cat - I', '1/1/2023', '1/1/2025', 'Expired'),
    row('Gus9', 'Soon', 'MA00000014', 'Gus9 Soon', 'Cat - I', '10/20/2024', '10/20/2026', 'Certified'),
    row('Ann9', 'Lee', 'MA00000001', 'Ann9 Lee', 'Cat - III', '3/1/2025', '3/1/2027', 'Voluntary Withdrawal'),
    row('Ann9', 'Lee', 'MA00000001', 'Ann9 Lee', 'Cat - I', '1/5/2023', '1/5/2025', 'Expired'),
    row('Ann9', 'Lee', 'MA00000001', 'Ann9 Lee', 'Cat - I', '1/5/2025', '1/5/2027', 'Certified'),
    row('Ann9', 'Lee', 'MA00000001', 'Ann9 Lee', 'Cat - II', '2024-02-01T05:00:00.000Z', '2026-02-01T05:00:00.000Z', 'Certified'),
    row('Ann9', 'Lee', 'MA00000001', 'Ann9 Lee', 'Cat - I', '1/5/2024', '1/5/2025', 'Expired'),
    row('Ann9', 'Lee', 'MA00000001', 'Ann9 Lee', 'Cat - III', '3/1/2026', '3/1/2028', 'ERROR: HTTP 503'),
    row('Ann9', 'Leex', 'MA00000009', 'Ann9 Leex', 'Cat - I', '1/1/2026', '1/1/2028', 'Certified'),
    row('Bob9', 'Twin', 'MA00000002', 'Bob9 Twin', 'Cat - I', '1/1/2025', '1/1/2027', 'Certified'),
    row('Bob9', 'Twin', 'MA00000003', 'Bob9 Twin', 'Cat - I', '1/1/2025', '1/1/2027', 'Certified'),
    row('Cara9', 'Only', 'MA00000004', 'Caroline9 Only', 'Cat - I', '6/1/2024', '6/1/2027', 'Expired'),
    row('Cara9', 'Only', 'MA00000004', 'Caroline9 Only', 'Cat - I', '6/1/2025', '6/1/2027', 'Certified')
  ];
}

/** An in-memory tab that remembers which columns were read below the header. */
function stSpSheet_(grid) {
  var sheet = stLocSheet_(grid);
  var inner = sheet.getRange;
  sheet.readCols = {};
  sheet.getRange = function (r, c, nr, nc) {
    if (r >= 2) for (var i = 0; i < (nc || 1); i++) sheet.readCols[c + i] = true;
    return inner(r, c, nr, nc);
  };
  return sheet;
}

/** Every key anywhere in a value. */
function stSpKeys_(v, acc) {
  acc = acc || {};
  if (Array.isArray(v)) v.forEach(function (x) { stSpKeys_(x, acc); });
  else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { acc[k] = true; stSpKeys_(v[k], acc); });
  return acc;
}

/** Staff: the App Control gate and the viewer cut, the Master's positional read and masks, the shifts inversion, the identity-only clients, the doors and the visit log. */
function stStaffProfiles_(out) {
  var P = 'staff profiles: ';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var TEST_KEYS = ['ann9lee', 'bob9twin', 'cara9only', 'dee9solo', 'all'];
  var verSeq = 0;
  // Every answer this test can cache gets a new version: one call where the cache takes a batch.
  var fresh = function () {
    var cache = CacheService.getScriptCache();
    var batch = {};
    TEST_KEYS.forEach(function (k) {
      SP_ACTIONS.forEach(function (a) { batch['ver_sp_' + a + '_' + k] = 'st' + (++verSeq); });
    });
    if (typeof cache.putAll === 'function') cache.putAll(batch, 21600);
    else Object.keys(batch).forEach(function (k) { cache.put(k, batch[k], 21600); });
  };

  // ---- 1. declarations ----
  var READS = SP_ACTIONS.slice(0, 12).concat(['staffProfilePreferences', 'staffProfilePerformance']);
  // Assign Training: a manager (HM and above), the master or the person themselves, never the Staff app's gate
  var ASSIGN = 'staffProfileAssignTraining';
  var ASSIGN_ROLES = '["admin","director","manager","staff","onboarding","interviewer"]';
  var TOOLS = ['staffProfileDocFile', 'staffProfileTranscript', 'staffProfileAssignTraining'];
  var WRITES = ['staffProfileAssignTraining', 'staffProfileNoteAdd', 'staffProfileNoteState', 'staffProfileEdit',
                'staffProfileRename', 'staffProfileDrivingEdit', 'staffProfileMaisEdit', 'staffProfileIstEdit',
                'staffProfilePreferencesSave'];
  var OPENED = ['staffProfileRoster', 'staffProfileOverview'];
  var WIDE = '["admin","director","manager","staff","client","onboarding","interviewer"]';
  var bad = [];
  SP_ACTIONS.forEach(function (a) {
    var p = HUB_POLICY[a];
    if (!p || p.file !== 'StaffProfiles.gs' || typeof HUB_ACTIONS[a] !== 'function') { bad.push(a + ': undeclared'); return; }
    if (RESOLVER_LANES.indexOf(p.lane) === -1 || RESOLVER_STORES.indexOf(p.store) === -1) bad.push(a + ': lane/store');
    var roles = a === ASSIGN ? ASSIGN_ROLES : (WRITES.indexOf(a) !== -1 ? '["admin","manager"]' : WIDE);
    if (JSON.stringify(p.roles) !== roles) bad.push(a + ': roles ' + JSON.stringify(p.roles));
    if ((p.invalidates || []).length || (p.emits || []).length) bad.push(a + ': invalidates/emits');
    var params = p.params || {};
    Object.keys(params).forEach(function (k) { if (params[k] && params[k].required) bad.push(a + ': ' + k + ' required at the door'); });
    var want = READS.indexOf(a) !== -1 ? 'read' : (TOOLS.indexOf(a) !== -1 ? 'tool' : 'write');
    if (p.lane !== want) bad.push(a + ': lane ' + p.lane + ', wanted ' + want);
    if (want === 'read' && p.idempotent !== true) bad.push(a + ': a read not idempotent');
    var first = OPENED.indexOf(a) !== -1
      ? /^function\s*\(payload, user\)\s*\{\s*var gate = staffProfilesGate_\(user\);\s*if \(!gate\.open\) return staffProfilesUnknown_\(\);/
      : a === ASSIGN
      ? /^function\s*\(payload, user\)\s*\{\s*if \(!spTrainingAssigner_\(user, payload && payload\.staff\)\) return staffProfilesUnknown_\(\);/
      : (WRITES.indexOf(a) !== -1
        ? /^function\s*\(payload, user\)\s*\{\s*if \(!staffProfilesMaster_\(user\)\) return staffProfilesUnknown_\(\);/
        : /^function\s*\(payload, user\)\s*\{\s*if \(!spWholeGate_\(user\)\) return staffProfilesUnknown_\(\);/);
    if (!first.test(stCode_(HUB_ACTIONS[a]))) bad.push(a + ': the gate is not the first line');
  });
  stAssert_(out, P + 'all 27 actions are declared in StaffProfiles.gs on their lane, invalidate and emit nothing, require no ' +
                 'param before the gate and open with it: the reads and the HR issue to every role App Control may ' +
                 'release to, behind the app gate; Assign Training behind the manager-or-self rule; the other writes ' +
                 'to admin/manager, behind the real master',
            bad.length === 0 && SP_ACTIONS.length === 27, bad.join('; '));

  var keep = {
    person: staffProfilesPerson_, masterCache: HUB_MASTER_EMAIL_CACHE, member: HUB_MEMBER_CTX, log: hubSysLog_,
    ensure: hubTabEnsure_, sheet: hubTabSheet_, holds: sheetDbGateHolds_, estate: estateRows_, listRows: listRows_,
    merged: peopleMerged_, noIsp: withoutIspClients_, derived: clientsDerived_, photoIdx: clientPhotoIndex_,
    users: usersAll_, masterIdx: spMasterIndex_, cal: locationsCalendar_, punches: locationsPunches_,
    homes: locationsHomes_, managers: hubCalendarManagers_, today: locationsToday_, drive: spDriveDocs_,
    staffDocs: staffDocsFor_, uploads: complianceDocsRows_, packet: packetMirrorRows_, cert: certPicture_,
    certCols: certMatrixColumns_, certDays: certExpiringDays_, reqValues: reqStatesListValues_, reqAll: requirementsAll_,
    lineRow: hubLineRow_, lineOurs: hubLineOurs_, hubId: hubId_, ssOpen: ssOpen_, callsRead: commCallsTranscriptRead_,
    bytes: locationsDocBytes_, house: locationsHouse_, istMap: istHouseMap_, createRow: createRow_, lock: locationsLock_,
    beAnother: beAnotherActive_, istNote: istCertNote_, perf: perfReadSoft_, empDb: empDbId_, masterTab: emp360MasterTab_,
    transBuild: spTranscriptsBuild_, certTab: certReadTab_, appRules: hubProfileAppRules_, appGate: hubProfileAppGate_,
    visible: hubStaffVisibleForHouses_, scheduled: hubStaffScheduledForHouses_, viewerMemo: HUB_VIEWER_MEMO,
    clientScope: hubViewerClientScope_
  };
  var master = { email: HUB_MASTER_ACCOUNT, role: 'admin', display_name: 'The Master' };
  var logged = [];
  // App Control as the gate reads it: no Staff row until a case releases it
  var APP_RULES = { rules: {}, tenants: {} };
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    HUB_MEMBER_CTX = null;
    HUB_VIEWER_MEMO = null;
    hubProfileAppRules_ = function () { HUB_VIEWER_MEMO = null; return APP_RULES; };
    hubSysLog_ = function (who, kind, target) { logged.push(kind + ':' + target); return true; };

    // ---- 2. the gate ----
    var asked = 0;
    staffProfilesPerson_ = function () { asked++; return { refused: { status: 418, message: 'st: the person was asked' } }; };
    var sally = { id: 'u-sally9', email: 'sally9@asa.test', role: 'staff', types: ['STAFF'], display_name: 'Sally9 Staff' };
    var callers = [
      { email: 'admin@example.org', role: 'admin' },
      { email: 'mgr@example.org', role: 'manager' },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', is_service: true },
      { email: HUB_MASTER_ACCOUNT, role: 'manager' },
      sally,
      null
    ];
    var body = { staff: 'ann9lee', id: 'SN_1', state: 'open', section: 'profile', call_id: 'AC1', house: 'ABD1305',
                 details: 'x', show_inactive: true };
    var shape = function (r) { return !!r && r.status === 404 && r.message === 'Unknown action.' && Object.keys(r).length === 2; };
    var leaks = [];
    SP_ACTIONS.forEach(function (a) {
      if (a === ASSIGN) return;
      callers.forEach(function (u) {
        var r = HUB_ACTIONS[a](body, u);
        if (!shape(r)) leaks.push(a + ' ' + JSON.stringify(u) + ' → ' + JSON.stringify(r));
      });
      HUB_MEMBER_CTX = { memberId: 'mem_st', userId: 'u-st', email: 'ann@example.org' };
      var inVisit = HUB_ACTIONS[a](body, master);
      HUB_MEMBER_CTX = null;
      if (!shape(inVisit)) leaks.push(a + ' in a visit → ' + JSON.stringify(inVisit));
    });
    stAssert_(out, P + 'while no App Control row names Staff: another admin, a manager, a STAFF account, a visit, the ' +
                   'service identity, the master as a manager, no session and the member context all get the exact 404 ' +
                   'shape before the person is looked up',
              leaks.length === 0 && asked === 0, leaks.slice(0, 4).join(' | ') + ' asked=' + asked);
    var aBody = { staff: 'ann9lee', details: 'x' };
    var aOpen = [
      { email: 'admin@example.org', role: 'admin', derived_types: [] },
      { id: 'u-hm9', email: 'hm9@asa.test', role: 'staff', types: ['HM'], derived_types: [], display_name: 'Hm9 Nine' },
      { id: 'u-tl9', email: 'tl9@asa.test', role: 'staff', types: ['TEAMLEAD'], derived_types: [], display_name: 'Tl9 Nine' },
      { id: 'u-ann9', email: 'ann9@asa.test', role: 'staff', types: ['STAFF'], derived_types: [], display_name: 'Ann9 Lee' }
    ].map(function (u) { return HUB_ACTIONS[ASSIGN](aBody, u).status; });
    var aShut = [
      { id: 'u-sally9', email: 'sally9@asa.test', role: 'staff', types: ['STAFF'], derived_types: [], display_name: 'Sally9 Staff' },
      { id: 'u-g9', email: 'g9@asa.test', role: 'staff', types: ['GUARDIAN'], derived_types: [], display_name: 'G9 Nine' },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', is_service: true },
      null
    ].filter(function (u) { return !shape(HUB_ACTIONS[ASSIGN](aBody, u)); });
    stAssert_(out, P + 'assign training: a badge ranked HM or above (admin, HM, a team lead) and the person themselves reach ' +
                   'the person lookup; another STAFF account, a guardian, a visit, the service identity and no session ' +
                   'get the exact 404 before it',
              aOpen.join() === '418,418,418,418' && aShut.length === 0 && asked === 4, JSON.stringify([aOpen, aShut, asked]));
    asked = 0;
    var passed = SP_ACTIONS.filter(function (a) { return a !== 'staffProfileRoster' && a !== 'staffProfileNoteState'; })
      .map(function (a) { return a + ':' + HUB_ACTIONS[a](body, master).status; });
    stAssert_(out, P + 'the master in its own session passes the gate to the person lookup',
              passed.every(function (s) { return /:418$/.test(s); }) && asked === passed.length, passed.join());

    // released to STAFF: every read opens on the whole record, every write stays the master's
    APP_RULES = { rules: {}, tenants: {} };
    APP_RULES.rules[SP_APP_ID] = ['STAFF'];
    asked = 0;
    var staffGate = staffProfilesGate_(sally);
    var staffReads = SP_ACTIONS.filter(function (a) {
      return a !== 'staffProfileRoster' && a !== 'staffProfileNoteState' && WRITES.indexOf(a) === -1;
    }).map(function (a) { return a + ':' + HUB_ACTIONS[a](body, sally).status; });
    var staffWrites = WRITES.map(function (a) { return HUB_ACTIONS[a](body, sally); });
    var otherBadge = { id: 'u-hm9', email: 'hm9@asa.test', role: 'manager', types: ['HM'], display_name: 'Hm9 Nine' };
    var otherShut = SP_ACTIONS.filter(function (a) { return a !== ASSIGN && !shape(HUB_ACTIONS[a](body, otherBadge)); });
    stAssert_(out, P + 'released to STAFF: a STAFF account sees everything — every read passes the gate to the person ' +
                   'lookup — while the writes answer the exact 404 before it, and a badge the row does not name ' +
                   'is still refused everywhere',
              staffGate.open === true && staffGate.scope.kind === 'all' &&
              staffReads.every(function (s) { return /:418$/.test(s); }) && asked === staffReads.length &&
              staffWrites.every(shape) && otherShut.length === 0,
              JSON.stringify([staffGate, staffReads, staffWrites, otherShut]));
    APP_RULES = { rules: {}, tenants: {} };
    staffProfilesPerson_ = keep.person;

    // ---- fixtures ----
    var grid = stSpMasterGrid_();
    var idx = spMasterIndexFrom_(grid, 'America/New_York');
    var people = [
      { id: 'P1', name: 'Ann9 Lee', first_name: 'Ann9', last_name: 'Lee', role: 'DSP', status: 'active',
        email: 'ann9.lee@example.org', phone: '330-555-0101', employee_id: '', avatar: '' },
      { id: 'P2', name: 'Bob9 Twin', status: 'active', phone: '330-555-0202' },
      { id: 'P3', name: 'Dupe9 Dupe', status: 'active' },
      { id: 'P4', name: 'dupe9  dupe', status: 'inactive' },
      { id: 'PPL_guardian_gina9guardian', name: 'Gina9 Guardian', guardian_for: 'Kenny9 Marsh', phone: '330-555-0909' },
      { id: 'P6', name: 'Kenny9 Marsh', role: 'client' },
      { id: 'P7', name: 'Sam9 Share', status: 'active', phone: '(330) 555-0111' }
    ];
    var clients = [
      { client_key: 'k9marsh', id: 'CLI_k9marsh', name: 'Kenny9 Marsh', house: 'ABD1305', home_address: '', status: 'active',
        avatar: 'https://img/k.png', medications: ['secret pill'], diagnoses_text: 'dx words', allergies: 'nuts',
        conditions: 'cond words' },
      { client_key: 'l9gomez', id: 'CLI_l9gomez', name: 'Lia9 Gomez', house: 'ABD1547', status: 'active', medications: ['x'] },
      { client_key: 'p9quinn', id: 'CLI_p9quinn', name: 'Pat9 Quinn', house: 'ABD1305', status: 'active' },
      { client_key: 'm9new', id: 'CLI_m9new', name: 'Mo9 New', house: 'ABD1547', status: 'active' },
      { client_key: 'far9', id: 'CLI_far9', name: 'Far9 Away', house: 'QQ1000', status: 'active' }
    ];
    var ist = [
      { id: 'i1', staffName: 'Ann9  Lee', clientName: 'Kenny9 Marsh', house: 'ABD1305', status: 'done', trainedAt: '2026-01-02',
        dueDate: '2025-12-30', docFileId: 'istpaperfile01', docAt: '2026-01-03T00:00:00Z', createdAt: '2025-12-01T00:00:00Z' },
      { id: 'i2', staffName: 'Ann9 Lee', clientName: 'Lia9 Gomez', house: 'ABD1547', status: 'owed', dueDate: '2026-09-01',
        createdAt: '2026-08-01T00:00:00Z' },
      { id: 'i3', staffName: 'Bob9 Twin', clientName: 'Far9 Away', house: 'QQ1000', status: 'owed' }
    ];
    var users = [
      { userid: 'U1', email: 'ann9.lee@example.org', displayname: 'Ann9 Lee', role: 'staff', active: 'true',
        lastlogin: '2026-09-20T10:00:00Z', createdat: '2025-01-01T00:00:00Z', phone: '(330) 555-0111',
        phones: '[{"label":"Mobile","number":"(330) 555-0111"}]', emails: 'ann9.home@example.org', avatar: 'https://img/ann.png',
        passhash: 'HASHVALUE123', salt: 'SALTVALUE', mustchange: 'true', password: 'plainpw' },
      { userid: 'U2', email: 'b1@example.org', displayname: 'Bob9 Twin', role: 'staff' },
      { userid: 'U3', email: 'b2@example.org', displayname: 'Bob9 Twin', role: 'staff' }
    ];
    var photos = [{ title: 'ABD1305', src: 'https://img/scene.png', kind: 'scene' }];
    listRows_ = function (res) {
      if (res === 'people') return people.map(function (p) { var o = {}; for (var k in p) o[k] = p[k]; return o; });
      if (res === 'istRecords') return ist.slice();
      if (res === 'photos') return photos.slice();
      throw new Error('st: no ' + res);
    };
    peopleMerged_ = function (rows) { return rows; };
    withoutIspClients_ = function (rows) { return rows; };
    clientsDerived_ = function () { return clients.slice(); };
    clientPhotoIndex_ = function () { return {}; };
    usersAll_ = function () { return users; };
    spMasterIndex_ = function () { return idx; };
    locationsToday_ = function () { return '2026-09-22'; };
    hubTabSheet_ = function () { return null; };
    hubTabEnsure_ = function (t) { throw new Error('st: no tab ' + t); };
    sheetDbGateHolds_ = function () { return null; };
    fresh();

    // ---- 3. the person ----
    var roster = spRosterIndex_();
    var r400 = staffProfilesPerson_('Ann9 Lee');
    var r404 = staffProfilesPerson_('zzz9nobody');
    var r409 = staffProfilesPerson_('dupe9dupe');
    var gina = staffProfilesPerson_('gina9guardian');
    var kenny = staffProfilesPerson_('kenny9marsh');
    var bob = staffProfilesPerson_('bob9twin');
    var dee = staffProfilesPerson_('dee9solo');
    var ann = staffProfilesPerson_('ann9lee');
    stAssert_(out, P + 'a person resolves by the folded name: malformed 400, unknown 404, two roster rows 409; a guardian ' +
                   'or a client row is never a staff member; a key two Master rows share reads no Master row; the ' +
                   'Employee cell keys a row with no first or last name',
              r400.refused && r400.refused.status === 400 && r404.refused && r404.refused.status === 404 &&
              r409.refused && r409.refused.status === 409 && gina.refused && gina.refused.status === 404 &&
              kenny.refused && kenny.refused.status === 404 && !roster.byKey.gina9guardian && !roster.byKey.kenny9marsh &&
              bob.master === null && /two Master rows/.test(bob.master_why) && bob.account === null &&
              /two accounts/.test(bob.account_why) && dee.master && dee.master.status === 'Other' &&
              ann.master && ann.people && ann.people.id === 'P1' && ann.account && ann.account.user_id === 'U1' &&
              ann.status === 'active',
              JSON.stringify([r400, r404, r409, gina, kenny, bob.master_why, bob.account_why, dee.master && dee.master.status]));
    stAssert_(out, P + 'the account is copied by name, never a credential: no pass_hash, salt, password or mustchange',
              !!ann.account && Object.keys(ann.account).sort().join() ===
                'active,avatar,created_at,email,emails,last_login,phone,phones,role,user_id' &&
              JSON.stringify(ann.account).indexOf('HASHVALUE') === -1 && JSON.stringify(ann.account).indexOf('SALTVALUE') === -1,
              JSON.stringify(ann.account));
    spMasterIndex_ = function () { throw new Error('st: the Master is closed'); };
    var closedUnknown = staffProfilesPerson_('cara9only');
    var closedKnown = staffProfilesPerson_('ann9lee');
    spMasterIndex_ = function () { return idx; };
    stAssert_(out, P + 'an unreadable Master is 503 for a key the roster does not carry, never 404; a roster person still ' +
                   'resolves and says the Master could not be read',
              closedUnknown.refused && closedUnknown.refused.status === 503 && !closedKnown.refused &&
              closedKnown.master === null && /could not be read/.test(closedKnown.master_why) && closedKnown.master_read === false,
              JSON.stringify([closedUnknown, closedKnown.master_why]));

    // ---- 4. the Master's positional read ----
    var af = (idx.rows.ann9lee || {}).fields || {};
    var cf = (idx.rows.cara9only || {}).fields || {};
    stAssert_(out, P + 'Master: every field lands on its own column — both start dates, the end date under a broken ' +
                   'header, both abstracts, a trailing-space header — and the scorecard flags survive beside their ' +
                   'data columns of the same name',
              idx.missing.length === 0 && idx.status_col === true && af.start_doc === '01/02/2024' &&
              af.start_first_day === '01/10/2024' && cf.end_last_day === '08/31/2026' && !af.end_last_day &&
              af.abstract_original === '01/05/2024' && af.abstract_latest === '01/05/2026' &&
              af.i9_type_2 === 'Social Security' && af.i9_type_1 === 'Driver License' &&
              af.hs_diploma === 'Yes' && af.flag_hs_diploma === '1' && af.sex_offender === '01/03/2024' &&
              af.flag_sex_offender === '0.5' && af.flag_offender === '0.5' && af.nurse_aide === 'n/a' &&
              af.flag_nurse_aide === '1' && af.dob === '1990-05-17' && af.employee_id === '100001' &&
              idx.rows.bob9twin.ambiguous === true && idx.rows.dee9solo && idx.rows.dee9solo.fields.status === 'Other',
              JSON.stringify({ missing: idx.missing, ann: af, cara: cf }));
    // the second Bob9 Twin row (sheet row 5) worded off, then both
    var statusAt = stSpMasterGrid_()[0].indexOf('Status');
    var worded = function (rows, word) {
      return spMasterIndexFrom_(stSpMasterGrid_().map(function (row, i) {
        return rows.indexOf(i) === -1 ? row : row.map(function (v, c) { return c === statusAt ? word : v; });
      }), 'America/New_York').rows.bob9twin;
    };
    var oneLive = worded([4], 'No'), noneLive = worded([2, 4], 'No'), cased = worded([4], ' inactive ');
    stEq_(out, P + 'Master: a name on two rows reads its one Active row — the row a confirmed date is written to — and ' +
          'stays unread with none or two Active',
          [oneLive.ambiguous, oneLive.fields.employee_id, cased.ambiguous, cased.fields.employee_id, noneLive.ambiguous,
           idx.rows.bob9twin.ambiguous].join(' '), 'false 100002 false 100002 true true');
    var cutHead = stSpMasterGrid_()[0];
    var cut = stSpMasterGrid_().map(function (row) {
      return row.filter(function (v, i) { return cutHead[i] !== 'Driver\'s Abstract (Latest)'; });
    });
    var cutIdx = spMasterIndexFrom_(cut, 'America/New_York');
    var noStatus = spMasterIndexFrom_(stSpMasterGrid_().map(function (row, i) {
      return row.map(function (v, c) { return i === 0 && v === 'Status' ? 'State of play' : v; });
    }), 'America/New_York');
    var hrWhy = spHrBuild_({ master: cutIdx.rows.ann9lee.fields, master_missing: cutIdx.missing, master_read: true }).why;
    stAssert_(out, P + 'Master: a column that is not there is named as missing and said in the answer, never read from ' +
                   'its neighbour; with no Status column the scorecard block is not guessed',
              cutIdx.missing.join() === 'abstract_latest' && cutIdx.rows.ann9lee.fields.abstract_original === '01/05/2024' &&
              !cutIdx.rows.ann9lee.fields.abstract_latest && /no column for abstract_latest/.test(hrWhy) &&
              noStatus.status_col === false && noStatus.missing.indexOf('flag_sex_offender') !== -1 &&
              noStatus.missing.indexOf('status') !== -1, JSON.stringify([cutIdx.missing, hrWhy, noStatus.missing]));

    // ---- 5. the masks ----
    var dl = [spLicenceMask_('SV123456', 'OH'), spLicenceMask_('TU 482913', 'OH'), spLicenceMask_('MA 123456', 'OH'),
              spLicenceMask_('OH-SV123456', ''), spLicenceMask_('oh sv123456', 'PA'), spLicenceMask_('SV123456', ''),
              spLicenceMask_('SV123456', 'Ohio'), spLicenceMask_('AB1234', 'OH'), spLicenceMask_('12347731', 'OH')];
    stAssert_(out, P + 'masks: SSN (Last 4) or the last four of a nine-digit SSN#, junk is blank; a licence shows the last ' +
                   'four of its digits and never its own letters — the state is a separate state token before a lettered ' +
                   'number, else the Master\'s State; under six digits is only "On file"; a BCI receipt keeps its prefix ' +
                   'and last three',
              spSsnMask_('1842', '') === '•••-••-1842' && spSsnMask_('', '987-65-1842') === '•••-••-1842' &&
              spSsnMask_(1842, '') === '•••-••-1842' && spSsnMask_('', '12-34') === '' && spSsnMask_('x', 'none') === '' &&
              dl.join('|') === 'OH •••• 3456|OH •••• 2913|OH •••• 3456|OH •••• 3456|OH •••• 3456|•••• 3456|•••• 3456|' +
                               'On file|OH •••• 7731' &&
              spLicenceMask_('n/a', 'OH') === '' && spLicenceMask_('12', 'OH') === 'On file' &&
              spBciMask_('BMT123456789').ref === 'BMT•••••789' && spBciMask_('01/04/2024').date === '2024-01-04' &&
              af.ssn_masked === '•••-••-4323' && af.license_masked === 'OH •••• 7731' && af.bci_ref_masked === 'BMT•••••789' &&
              cf.ssn_masked === '•••-••-1842' && cf.license_masked === 'OH •••• 3456',
              JSON.stringify([dl, af.ssn_masked, af.license_masked, af.bci_ref_masked, cf.ssn_masked, cf.license_masked]));
    var scrubbed = spScrub_({ body: 'ssn 987 65 4323, again 987.65.4323 or 987-65-4323; call 330 555 0101', id: '987654323' });
    stAssert_(out, P + 'scrub: an SSN grouped with spaces, dots or dashes is withheld in free text; a phone grouped ' +
                   'three-three-four and an id key are not touched',
              scrubbed.body === 'ssn [withheld], again [withheld] or [withheld]; call 330 555 0101' && scrubbed.id === '987654323',
              JSON.stringify(scrubbed));
    stAssert_(out, P + 'loose files: the name is matched as whole words — never inside a longer first or last name',
              spNameIn_('Ann9 Lee', 'Ann9 Lee - I9.pdf') && spNameIn_('Ann9 Lee', 'resume_ann9  lee.pdf') &&
              !spNameIn_('Ann9 Lee', 'Joann9 Lee - I9.pdf') && !spNameIn_('Ann9 Lee', 'Ann9 Leeds I9.pdf') &&
              !spNameIn_('', 'Ann9 Lee.pdf') && !spNameIn_('A.nn9 Lee', 'AXnn9 Lee.pdf'), '');
    var raws = ['987-65-4323', '987654323', '12347731', 'SV123456', 'SV ••••', 'BMT123456789', 'ann9.lee.login', 'Secret.4323!',
                'HASHVALUE123', 'SALTVALUE', 'plainpw'];
    var leakIn = function (text) { return raws.filter(function (s) { return text.indexOf(s) !== -1; }); };
    stAssert_(out, P + 'masks: the Master index holds no raw SSN, licence, BCI receipt, login or password',
              leakIn(JSON.stringify(idx)).length === 0, leakIn(JSON.stringify(idx)).join());

    var calendar = { tz: 'America/New_York', values: [
      ['Location', 'Employee', 'Designation', 'Phone', 'Date'],
      ['CAN - 49TH - ABD1305', 'Ann9 Lee', '*', '', '06/01/2026'],
      ['CAN - 49TH - ABD1305', 'ann9 lee', '***', '', '09/10/2026'],
      ['CAN - 48TH (A) - ABD1547', 'Ann9 Lee', '*', '', '03/02/2026'],
      ['CAN - 48TH (A) - ABD1547', 'Bob9 Twin', '*', '', '09/10/2026'],
      ['CAN - 49TH - ABD1305', 'Ann9 Lee', '*', '', '09/28/2026'],
      ['CAN - 49TH - ABD1305', 'Ann9 Lee', '*', '', '10/05/2026'],
      ['CAN - 49TH - ABD1305', 'Ann9 Lee', '*', '', '09/30/2026'],
      ['CAN - 49TH - ABD1305', 'OPEN', '', '', '09/11/2026']
    ] };
    var punches = [
      { employee: 'Ann9 Lee', house: 'ABD1305', location_name: '1305 49th', date_iso: '2026-09-15', start_time: '07:00',
        end_time: '15:00', consumer_1: 'Pat9 Quinn', comments: 'private words' },
      { employee: 'Ann9 Lee', house: '', location_name: '1305  49th', date_iso: '2026-09-15', start_time: '15:30', end_time: '19:00' },
      { employee: 'Ann9 Lee', house: 'ABD1305', location_name: '1305 49th', date_iso: '2026-09-10', start_time: '08:00', end_time: '16:00' },
      { employee: 'Zed9 Other', house: 'ABD1547', location_name: '1547 48th', date_iso: '2026-09-15', consumer_1: 'Lia9 Gomez' }
    ];
    locationsCalendar_ = function () { return { cal: calendar, why: '' }; };
    locationsPunches_ = function () { return { rows: punches, why: '' }; };
    locationsHomes_ = function () { return [{ code: 'ABD1305', home_name: 'CAN - 49TH', address: '1305 49th St NW, Canton, OH', thumbnail_url: 'https://img/h.png' }]; };
    hubCalendarManagers_ = function () { return { ann9lee: ['CAN - 49TH - ABD1305'] }; };
    spDriveDocs_ = function () {
      return { files: [
        { file_id: 'driveresume0001', title: 'Ann9 Lee - Resume.pdf', mime: 'application/pdf', date: '2023-12-01', folder: '', source: 'drive' },
        { file_id: 'drivebci000001', title: 'BCI results.pdf', mime: 'application/pdf', date: '2024-01-04', folder: 'Background Checks', source: 'drive' }
      ], why: [], failed: false };
    };
    staffDocsFor_ = function () {
      return { name: 'Ann9 Lee', docs: [
        { type: 'DODD Training Certificate', from: 'form', link: 'https://drive.google.com/open?id=formdodd00001',
          expires: '2027-01-01', certified: '2025-01-01' },
        { type: 'Drivers License / OH ID', from: 'archive', fileId: 'archivedl00001' }
      ] };
    };
    var uploads = [
      { id: 'UP1', person: 'Ann9 Lee', cert: 'cpr', reqid: 'cpr', fileid: 'uploadcpr0001', at: '2026-09-01T00:00:00Z',
        by: 'ann9.lee@example.org', confirmedat: '' },
      { id: 'UP2', person: 'Ann9 Lee', cert: 'dodd', reqid: 'dodd', fileid: 'formdodd00001', at: '2025-01-10T00:00:00Z',
        by: 'ann9.lee@example.org', confirmedat: '2026-02-01T00:00:00Z', confirmedby: 'the master' },
      { id: 'UP3', person: 'Ann9 Leex', cert: 'cpr', reqid: 'cpr', fileid: 'otherperson001', at: '2026-09-01T00:00:00Z', confirmedat: '' }
    ];
    complianceDocsRows_ = function () { return uploads.slice(); };
    packetMirrorRows_ = function () { return []; };
    certPicture_ = function () {
      return { ann9lee: { name: 'Ann9 Lee', certs: {
        dodd: { status: 'valid', expires: '2027-01-01' }, cpr: { status: 'expiring', expires: '2026-10-15' },
        med1: { status: 'expired', expires: '2025-01-01' }, mandt: { status: 'valid', expires: '' } } } };
    };
    certMatrixColumns_ = function () { return ['dodd', 'cpr', 'med1', 'money', 'mandt']; };
    certExpiringDays_ = function () { return 60; };
    estateRows_ = function (res) {
      if (res !== 'uiIncidents') return [];
      return [
        { your_name: 'Zed9 Other', employees_involved: 'Ann9 Lee, Bob9 Twin', incident_category: 'Fall',
          incident_date: '2026-09-01', client_name: 'Kenny9 Marsh', summary_of_incident: 'private summary words' },
        { your_name: 'Ann9 Lee', employees_involved: '', incident_category: 'Behavior', incident_date: '2026-08-01',
          summary_of_incident: 'more private words' },
        { your_name: 'Zed9 Other', employees_involved: 'Ann9 Leeson', incident_category: 'Other', incident_date: '2026-08-02' }
      ];
    };
    perfReadSoft_ = function () {
      return [{ empid: 'E1', name: 'Ann9 Lee', category: 'Manager note', text: 'Great with clients', src: 'hub:boss@example.org',
                createdat: '2025-06-01T00:00:00Z' },
              { empid: 'E1', name: 'Ann9 Lee', category: 'Daily note', text: 'client care words', createdat: '2025-06-02T00:00:00Z' }];
    };
    ssOpen_ = function () { return {}; };
    hubId_ = function () { return ''; };
    fresh();

    var hr = HUB_ACTIONS.staffProfileHr({ staff: 'ann9lee' }, master);
    var emp = HUB_ACTIONS.staffProfileEmployment({ staff: 'ann9lee' }, master);
    var ov = HUB_ACTIONS.staffProfileOverview({ staff: 'ann9lee' }, master);
    var docs = HUB_ACTIONS.staffProfileDocuments({ staff: 'ann9lee' }, master);
    var answers = JSON.stringify([hr, emp, ov, docs]);
    var answerKeys = stSpKeys_([hr, emp, ov, docs]);
    stAssert_(out, P + 'masks: the HR, Employment, Overview and Documents answers carry no raw SSN, licence, BCI receipt, ' +
                   'login or password, and no pass_hash, salt or mustchange key',
              hr.status === 200 && emp.status === 200 && ov.status === 200 && docs.status === 200 &&
              leakIn(answers).length === 0 && !answerKeys.pass_hash && !answerKeys.passhash && !answerKeys.salt &&
              !answerKeys.mustchange && !answerKeys.password,
              leakIn(answers).join() + ' ' + [hr.status, emp.status, ov.status, docs.status].join());
    var h = hr.data || {};
    stAssert_(out, P + 'HR: the masked SSN and licence, the day of birth, the screening lines (a dated check is clear, a ' +
                   'n/a is not applicable), the BCI line with its masked receipt, the account without a password, and ' +
                   'one audit line per view',
              h.personal && h.personal.ssn_masked === '•••-••-4323' && h.personal.dob === '1990-05-17' &&
              h.driver.license_masked === 'OH •••• 7731' && h.driver.approved === true &&
              h.work_auth.i9_type_2_exp === 'n/a' && h.work_auth.i9_type_1_exp === '2027-06-30' &&
              h.screening.length === 8 && h.screening.filter(function (s) { return s.id === 'sex_offender'; })[0].state === 'clear' &&
              h.screening.filter(function (s) { return s.id === 'sex_offender'; })[0].date === '2024-01-03' &&
              h.screening.filter(function (s) { return s.id === 'nurse_aide'; })[0].state === 'na' &&
              h.screening.filter(function (s) { return s.id === 'bci_fbi'; })[0].ref_masked === 'BMT•••••789' &&
              h.screening.filter(function (s) { return s.id === 'bci_fbi'; })[0].date === '2024-01-04' &&
              h.account && h.account.login === 'ann9.lee@example.org' && !('password' in h.account) &&
              logged.filter(function (l) { return l === 'staffProfileHr:ann9lee'; }).length === 1,
              JSON.stringify([h, logged]));
    var hrAgain = HUB_ACTIONS.staffProfileHr({ staff: 'ann9lee' }, master);
    stAssert_(out, P + 'HR: a view served from the cache is logged again — every view is a line in the audit history',
              hrAgain.status === 200 && logged.filter(function (l) { return l === 'staffProfileHr:ann9lee'; }).length === 2,
              logged.join());
    var cachedHr = cacheRead_('sp_staffProfileHr_ann9lee', 'v1_all', function () { throw new Error('st: not cached'); });
    stAssert_(out, P + 'masks: the cached HR answer, read back through the cache, holds no raw value either',
              leakIn(JSON.stringify(cachedHr)).length === 0 && cachedHr.personal.ssn_masked === '•••-••-4323',
              leakIn(JSON.stringify(cachedHr)).join());
    // What userUpdate {active:false} leaves on the users tab, then what re-enabling leaves.
    users[0].active = 'false';
    var hrOff = HUB_ACTIONS.staffProfileHr({ staff: 'ann9lee' }, master);
    users[0].active = 'true';
    var hrOn = HUB_ACTIONS.staffProfileHr({ staff: 'ann9lee' }, master);
    var acctOf = function (r) { return r && r.data && r.data.account ? r.data.account.active : 'none'; };
    stAssert_(out, P + 'HR: the account is read on every view, never from the cached record — access turned off between ' +
                   'two views reads off at once, turned on again reads on, and the rest of the record still comes cached',
              acctOf(hrAgain) === true && hrOff.status === 200 && acctOf(hrOff) === false && acctOf(hrOn) === true &&
              hrOff.data.account.login === 'ann9.lee@example.org' && hrOff.data.account_why === '' &&
              hrOff.data.personal.ssn_masked === '•••-••-4323' && !('account' in cachedHr) && !('account_why' in cachedHr),
              JSON.stringify([acctOf(hrAgain), acctOf(hrOff), acctOf(hrOn), Object.keys(cachedHr)]));
    spMasterIndex_ = keep.masterIdx;
    empDbId_ = function () { return 'st-empdb-book'; };
    emp360MasterTab_ = function () { return 'Master'; };
    ssOpen_ = function (id) {
      if (id !== 'st-empdb-book') throw new Error('st: no book ' + id);
      return { getSheetByName: function (t) { return t === 'Master' ? stLocSheet_(stSpMasterGrid_()) : null; },
               getSpreadsheetTimeZone: function () { return 'America/New_York'; } };
    };
    CacheService.getScriptCache().put('ver_' + cacheScopeSheet_('st-empdb-book', 'Master'), 'st' + (++verSeq), 21600);
    var realIdx = spMasterIndex_();
    var readBack = cacheRead_(cacheScopeSheet_('st-empdb-book', 'Master'), 'sp_master_v3', function () { throw new Error('st: not cached'); });
    stAssert_(out, P + 'masks: the real Master read caches the masked index only — read back, no raw value is in it',
              !!realIdx.rows.ann9lee && leakIn(JSON.stringify(readBack)).length === 0 &&
              readBack.rows.ann9lee.fields.ssn_masked === '•••-••-4323', leakIn(JSON.stringify(readBack)).join());
    spMasterIndex_ = function () { return idx; };
    ssOpen_ = function () { return {}; };
    empDbId_ = keep.empDb;
    emp360MasterTab_ = keep.masterTab;

    var e = emp.data || {};
    stAssert_(out, P + 'Employment: pure data — the referral paid day, the résumé file the Documents found, the three ' +
                   'employment dates, the HS diploma flag and an approved driver',
              e.hiring && e.hiring.referral === 'Rae Ref' && e.hiring.referral_paid === '2025-05-01' &&
              e.hiring.referral_paid_flag === 'yes' && e.hiring.job_app_date === '2023-12-20' &&
              e.hiring.resume.flag === 'yes' && e.hiring.resume.doc_id === 'driveresume0001' &&
              e.dates.start_doc === '2024-01-02' && e.dates.start_first_day === '2024-01-10' && e.dates.end_last_day === '' &&
              e.qualifications.hs_diploma.flag === '1' && e.qualifications.hs_diploma.value === 'Yes' &&
              e.qualifications.driver.approved === true && e.on_master === true, JSON.stringify(e));
    var byId = {};
    ((docs.data || {}).docs || []).forEach(function (d) { byId[d.id] = d; });
    var dodd = ((docs.data || {}).docs || []).filter(function (d) { return d.file_id === 'formdodd00001'; })[0] || {};
    stAssert_(out, P + 'Documents: the Master\'s papers with their dates and flags — signed forms, a verified I-9, a résumé ' +
                   'and a licence joined to their files — beside every other file, a confirmed upload verified; a ' +
                   'paper with no file carries no file id',
              byId['master:job_app'] && byId['master:job_app'].status === 'signed' && byId['master:job_app'].date === '2023-12-20' &&
              byId['master:i9'] && byId['master:i9'].status === 'verified' && byId['master:i9'].expires === '2027-06-30' &&
              byId['master:hs_diploma'] && byId['master:hs_diploma'].status === 'verified' && byId['master:hs_diploma'].file_id === null &&
              byId.driveresume0001 && byId.driveresume0001.title === 'Resume' && byId.driveresume0001.status === 'on_file' &&
              byId.archivedl00001 && byId.archivedl00001.title === 'Driver\'s license' && byId.archivedl00001.expires === '2027-06-30' &&
              byId.drivebci000001 && byId.drivebci000001.category === 'background' &&
              dodd.status === 'verified' && dodd.category === 'training' && dodd.expires === '2027-01-01' &&
              byId.uploadcpr0001 && byId.uploadcpr0001.status === 'on_file' && byId.istpaperfile01 &&
              !byId.otherperson001 && docs.data.counts.total === docs.data.docs.length,
              JSON.stringify(docs.data));
    var cara = HUB_ACTIONS.staffProfileDocuments({ staff: 'cara9only' }, master);
    var caraIds = ((cara.data || {}).docs || []).map(function (d) { return d.id + ':' + d.status; });
    stAssert_(out, P + 'Documents: "No, I don\'t have one" is no diploma, never verified; a non-driver has no driving papers',
              cara.status === 200 && caraIds.indexOf('master:hs_diploma:missing') !== -1 &&
              caraIds.filter(function (s) { return /drivers_|car_insurance/.test(s); }).length === 0, caraIds.join());

    // ---- 6. the shifts inversion ----
    var sh = HUB_ACTIONS.staffProfileShifts({ staff: 'ann9lee' }, master);
    var s = sh.data || {};
    var hb = {};
    (s.houses || []).forEach(function (x) { hb[x.code] = x; });
    var dayBy = {};
    (s.days || []).forEach(function (d) { dayBy[d.date + '|' + d.house] = d; });
    stAssert_(out, P + 'shifts: the Calendar Archive and the punches filtered by the folded name — houses with first and ' +
                   'last day, HM from the calendar\'s ** rule and lead from a recent ***, a punch mapped by its place, ' +
                   'the day\'s punches spanning the day',
              sh.status === 200 && hb.ABD1305 && hb.ABD1305.days === 3 && hb.ABD1305.first_day === '2026-06-01' &&
              hb.ABD1305.last_day === '2026-09-15' && hb.ABD1305.hm === true && hb.ABD1305.lead === true &&
              hb.ABD1305.current === true && hb.ABD1305.photo === 'https://img/scene.png' && hb.ABD1547 &&
              hb.ABD1547.current === false && hb.ABD1547.days === 1 &&
              dayBy['2026-09-15|ABD1305'] && dayBy['2026-09-15|ABD1305'].start === '07:00' &&
              dayBy['2026-09-15|ABD1305'].end === '19:00' && dayBy['2026-09-15|ABD1305'].source === 'punches' &&
              dayBy['2026-09-10|ABD1305'].designation === 'lead' && dayBy['2026-09-10|ABD1305'].source === 'punches' &&
              dayBy['2026-06-01|ABD1305'].source === 'archive' && !dayBy['2026-03-02|ABD1547'],
              JSON.stringify(s));
    stAssert_(out, P + 'shifts: a future row goes to upcoming and groups as "house · weekdays · hours"; the archive\'s ' +
                   'empty months are gaps; no client name or punch comment is in the answer',
              (s.upcoming || []).length === 3 && s.patterns.length === 1 && s.patterns[0].house === 'ABD1305' &&
              s.patterns[0].weekdays.join() === 'Mon,Wed' && s.patterns[0].from === '2026-09-28' &&
              s.patterns[0].to === '2026-10-05' && s.gaps.length === 2 && s.gaps[1].from === '2026-06-02' &&
              s.gaps[1].to === '2026-09-09' && JSON.stringify(s).indexOf('Pat9 Quinn') === -1 &&
              JSON.stringify(s).indexOf('private words') === -1 && JSON.stringify(s).indexOf('consumer') === -1,
              JSON.stringify([s.upcoming, s.patterns, s.gaps]));

    // ---- 7. the clients union ----
    var o = ov.data || {};
    var cby = {};
    (o.clients || []).forEach(function (c) { cby[c.client_key] = c.via.slice().sort().join('+'); });
    var clinical = ['medications', 'diagnoses_text', 'allergies', 'conditions', 'consumer_1', 'consumers'];
    var allKeys = stSpKeys_([ov, sh, docs, emp, hr]);
    stAssert_(out, P + 'overview: the clients are the union of the ISTs, the punches and the houses worked in lately, ' +
                   'each resolved to identity only — no clinical key anywhere',
              cby.k9marsh === 'house+ist' && cby.l9gomez === 'ist' && cby.p9quinn === 'house+punches' && !cby.far9 &&
              clinical.filter(function (k) { return allKeys[k]; }).length === 0 &&
              JSON.stringify(ov).indexOf('secret pill') === -1 && JSON.stringify(ov).indexOf('dx words') === -1,
              JSON.stringify(o.clients));
    stAssert_(out, P + 'overview: every phone and every e-mail on its own line, once each, the account\'s first',
              o.person && o.person.phones.map(function (x) { return x.label + ':' + x.value; }).join('|') ===
                'Mobile:(330) 555-0111|Phone:330-555-0101' &&
              o.person.emails.map(function (x) { return x.value; }).join('|') ===
                'ann9.lee@example.org|ann9.home@example.org' &&
              o.person.employee_id === '100001' && o.person.employee_id_source === 'master' &&
              o.person.start_date === '2024-01-10' && o.ist.length === 2 &&
              o.ist.filter(function (x) { return x.client_name === 'Kenny9 Marsh'; })[0].status === 'done' &&
              o.houses.length === 2, JSON.stringify(o.person) + JSON.stringify(o.ist));

    // ---- 7b. driving and MAIS ----
    var drvIdx = spDriverIndexFrom_(stSpDriverGrid_(), 'America/New_York');
    var compIdx = spDriverIndexFrom_(stSpDriverComplianceGrid_(), 'America/New_York');
    var ok = function (index) { return { index: index, why: '' }; };
    var TODAY = '2026-09-22';
    var drive = function (key, main, comp) { return spDrivingFrom_(key, main, comp, TODAY, 60); };
    var dAnn = drive('ann9lee', ok(drvIdx), ok(compIdx));
    var dBob = drive('bob9twin', ok(drvIdx), ok(compIdx));
    var dCara = drive('cara9only', ok(drvIdx), ok(compIdx));
    var dDee = drive('dee9solo', ok(drvIdx), ok(compIdx));
    var dZed = drive('zed9none', ok(drvIdx), ok(compIdx));
    var dEve = drive('eve9past', ok(drvIdx), ok(compIdx));
    var dFay = drive('fay9two', ok(drvIdx), ok(compIdx));
    var shutRead = { index: null, why: spWhy_('the employee driver tab', new Error('st: closed')) };
    var shutComp = { index: null, why: spWhy_('the Driver Compliance tab', new Error('st: closed')) };
    var dShut = drive('ann9lee', shutRead, ok(compIdx));
    var dBoth = drive('ann9lee', shutRead, shutComp);
    var dNoComp = drive('ann9lee', ok(drvIdx), shutComp);
    stAssert_(out, P + 'driving: the facts of employee driver by the folded name — points, the licence, both abstracts ' +
                   '(n/a is none) and the insurance as days, the licence masked as HR Admin masks it — and the standing ' +
                   'from Driver Compliance with its tab named; days that have not come are current',
              dAnn.found && dAnn.driver === true && dAnn.points === 2 && dAnn.points_note === '' &&
              dAnn.license_expires === '2027-06-30' && dAnn.abstract_original === '' && dAnn.abstract_latest === '2026-01-05' &&
              dAnn.insurance_expires === '2027-03-01' && dAnn.dl_last4 === '•••• 8707' &&
              dAnn.dl_last4 === spLicenceMask_('SV128707', '') && dAnn.source === 'employee driver' &&
              dAnn.license_standing && dAnn.license_standing.word === 'Suspended' &&
              dAnn.license_standing.state === 'invalid' && dAnn.license_standing.source === 'Driver Compliance' &&
              dAnn.driver_standing === null && dAnn.license_state === 'current' && dAnn.insurance_state === 'current' &&
              dAnn.unread.length === 0 && dAnn.standing_ambiguous === false &&
              dAnn.why === '' && dAnn.degraded === false && dAnn.ambiguous === false, JSON.stringify(dAnn));
    stAssert_(out, P + 'driving: a passed licence day is expired and an insurance day inside the window due soon; a date ' +
                   'cell in words ("9/23") is kept as written with no state; the employee driver tab\'s own "Suspended" ' +
                   'stays beside Driver Compliance\'s "Yes"',
              dEve.found && dEve.license_expires === '2026-08-01' && dEve.license_state === 'expired' &&
              dEve.insurance_expires === '2026-10-20' && dEve.insurance_state === 'due_soon' &&
              dEve.abstract_original === '9/23' && dEve.dl_last4 === 'OH •••• 4433' &&
              dEve.license_standing.state === 'valid' && dEve.license_standing.source === 'Driver Compliance' &&
              dEve.driver_standing && dEve.driver_standing.word === 'Suspended' && dEve.driver_standing.state === 'invalid' &&
              dEve.driver_standing.source === 'employee driver', JSON.stringify(dEve));
    stAssert_(out, P + 'driving: two Driver Compliance rows under one name leave the standing unread and said, never ' +
                   '"not a driver"; an unread Driver Compliance is named in unread, the standing left unsaid',
              dFay.found === false && dFay.standing_ambiguous === true && dFay.license_standing === null &&
              /two rows of the Driver Compliance tab/.test(dFay.why) &&
              dNoComp.found && dNoComp.degraded === true && dNoComp.license_standing === null &&
              dNoComp.unread.join() === 'Driver Compliance' && dNoComp.points === 2, JSON.stringify([dFay, dNoComp]));
    stAssert_(out, P + 'driving: two rows under one name are ambiguous and said, never guessed; a row with no driving fact ' +
                   '(blank, or only its Status) does not make a name ambiguous; a Points cell in words is kept as words; ' +
                   '"No" is not a driver; no row is not found, with nothing to say',
              dBob.ambiguous === true && dBob.found === false && dBob.points === null && dBob.license_standing === null &&
              /two rows of the employee driver tab/.test(dBob.why) &&
              dCara.ambiguous === false && dCara.found && dCara.points === null && dCara.points_note === 'CANT CHECK' &&
              dCara.dl_last4 === 'On file' && dCara.license_standing.word === 'Failure To Reinstate' &&
              dCara.license_standing.state === 'invalid' &&
              dDee.found && dDee.driver === false && dDee.license_standing === null &&
              dZed.found === false && dZed.driver === null && dZed.why === '' && dZed.degraded === false,
              JSON.stringify([dBob, dCara, dDee, dZed]));
    stAssert_(out, P + 'driving: an unread tab is a sentence and a degraded part, never "not a driver" — with employee ' +
                   'driver unread the Driver Compliance row is shown under its own tab name, the points left unsaid',
              dShut.degraded === true && /employee driver tab could not be read/.test(dShut.why) && dShut.found === true &&
              dShut.source === 'Driver Compliance' && dShut.points === null && dShut.license_standing.word === 'Suspended' &&
              dShut.unread.join() === 'employee driver' &&
              dBoth.degraded === true && dBoth.found === false && dBoth.driver === null &&
              dBoth.unread.join() === 'employee driver,Driver Compliance' &&
              /Driver Compliance tab could not be read/.test(dBoth.why), JSON.stringify([dShut, dBoth]));
    var renamed = function (from, to) {
      return stSpDriverGrid_().map(function (line, i) {
        return line.map(function (v) { return i === 0 && from.indexOf(v) !== -1 ? to : v; });
      });
    };
    var dNoName = drive('ann9lee', ok(spDriverIndexFrom_(renamed(['Employee', 'Last Name'], 'Who'), 'America/New_York')),
                        ok(compIdx));
    var dNoPts = drive('ann9lee', ok(spDriverIndexFrom_(renamed(['Points'], 'Score'), 'America/New_York')), ok(compIdx));
    stAssert_(out, P + 'driving: a tab with no name column is said and degraded, never everyone "not a driver"; a missing ' +
                   'Points column is named, the rest still read',
              dNoName.degraded === true && /no Employee or First and Last Name column/.test(dNoName.why) &&
              dNoName.unread.join() === 'employee driver' &&
              dNoPts.degraded === false && /employee driver tab has no column for points/.test(dNoPts.why) &&
              dNoPts.found && dNoPts.points === null && dNoPts.license_expires === '2027-06-30',
              JSON.stringify([dNoName, dNoPts]));

    var maisRows = stSpMaisRows_();
    var mais = function (rows, key) { return spMaisFrom_(rows, key, TODAY, 60); };
    var mAnn = mais(maisRows, 'ann9lee');
    var mBob = mais(maisRows, 'bob9twin');
    var mCara = mais(maisRows, 'cara9only');
    var mZed = mais(maisRows, 'zed9none');
    var mRob = mais(maisRows, 'rob9smith');
    var mKay = mais(maisRows, 'kay9lane');
    var mGus = mais(maisRows, 'gus9soon');
    var lineOf = function (m) {
      return (m.certs || []).map(function (c) {
        return [c.level, c.effective, c.expires, c.status, c.expired, c.older].join(' ');
      }).join(' | ');
    };
    stAssert_(out, P + 'MAIS: one line per Cat level in level order — the latest by Expiration with its Effective, the ' +
                   'older rows counted and the same record scraped again counted once, its newest scrape speaking; a ' +
                   'Certified word past its day is expired; a word that is not certified is expired with the word kept; ' +
                   'a scraper ERROR row is skipped, never the latest',
              lineOf(mAnn) === 'Cat - I 2025-01-05 2027-01-05 certified false 2 | ' +
                               'Cat - II 2024-02-01 2026-02-01 certified true 0 | ' +
                               'Cat - III 2025-03-01 2027-03-01 expired true 0' &&
              mAnn.certs[0].word === 'Certified' && mAnn.certs[0].due_soon === false &&
              mAnn.certs[2].word === 'Voluntary Withdrawal' && mAnn.history === 2 && mAnn.matched_by === 'name' &&
              mAnn.ambiguous === false && mAnn.why === '', lineOf(mAnn) + ' ' + JSON.stringify(mAnn));
    stAssert_(out, P + 'MAIS: two DD IDs under one name are ambiguous and said; a registry name that differs is found by ' +
                   'the name it was searched with; the same Expiration is broken by the later Effective; no record is none',
              mBob.ambiguous === true && mBob.certs.length === 0 && /2 DODD registry records/.test(mBob.why) &&
              mCara.matched_by === 'search' && lineOf(mCara) === 'Cat - I 2025-06-01 2027-06-01 certified false 1' &&
              mZed.certs.length === 0 && mZed.matched_by === '' && mZed.why === '',
              JSON.stringify([mBob, mCara, mZed]));
    stAssert_(out, P + 'MAIS: another person\'s registry name that folds to this key is never attached when this ' +
                   'person\'s own search found a different DD ID; the same DD ID under a changed name stands; a ' +
                   'certification expiring inside the window is due soon',
              mRob.ambiguous === true && mRob.certs.length === 0 && /point at different DODD records/.test(mRob.why) &&
              mKay.ambiguous === false && lineOf(mKay) === 'Cat - I 2025-01-01 2027-01-01 certified false 0' &&
              mKay.matched_by === 'name' &&
              mGus.certs.length === 1 && mGus.certs[0].due_soon === true && mGus.certs[0].expired === false,
              JSON.stringify([mRob, mKay, mGus]));
    var without = function (col) {
      return maisRows.map(function (r) { var o = {}; for (var k in r) { if (k !== col) o[k] = r[k]; } return o; });
    };
    var mNoId = mais(without('dd_id'), 'ann9lee');
    var mNoType = mais(without('cert_type'), 'ann9lee');
    stAssert_(out, P + 'MAIS: a scrape with no DD ID column is said and degraded and shows nothing, since two registry ' +
                   'records under one name could not be told apart; a missing Cert Type column is said, the rest still read',
              mNoId.degraded === true && mNoId.certs.length === 0 && /no column for dd_id/.test(mNoId.why) &&
              mNoType.degraded === true && /no column for cert_type/.test(mNoType.why) && mNoType.certs.length === 1,
              JSON.stringify([mNoId, mNoType]));
    var secrets = ['987-65-4323', '987654323', '1990-05-17', '05/17/1990', '5/17/1990', 'SV128707', '128707', 'SV554433',
                   '554433', 'MA0000'];
    var secretIn = function (v) { var t = JSON.stringify(v); return secrets.filter(function (s) { return t.indexOf(s) !== -1; }); };
    var built = [drvIdx, compIdx, dAnn, dBob, dCara, dDee, dEve, dFay, mAnn, mBob, mCara, mRob, mKay, mGus];
    stAssert_(out, P + 'driving and MAIS: no SSN, day of birth, whole licence number or DD ID is in either index or any ' +
                   'part built from them',
              secretIn(built).length === 0, secretIn(built).join());

    empDbId_ = function () { return 'st-empdb-book'; };
    ssOpen_ = function (id) {
      if (id !== 'st-empdb-book') throw new Error('st: no book ' + id);
      return { getSheetByName: function (t) {
                 return t === 'employee driver' ? stLocSheet_(stSpDriverGrid_())
                   : (t === 'Driver Compliance' ? stLocSheet_(stSpDriverComplianceGrid_()) : null);
               },
               getSpreadsheetTimeZone: function () { return 'America/New_York'; } };
    };
    ['employee driver', 'Driver Compliance'].forEach(function (t) {
      CacheService.getScriptCache().put('ver_' + cacheScopeSheet_('st-empdb-book', t), 'st' + (++verSeq), 21600);
    });
    var realDrv = spDriverIndex_('employee driver');
    var drvBack = cacheRead_(cacheScopeSheet_('st-empdb-book', 'employee driver'), 'sp_driver_v1',
                             function () { throw new Error('st: not cached'); });
    certReadTab_ = function (tab) {
      if (tab !== certSourceTab_('mais')) throw new Error('st: no estate tab ' + tab);
      return stSpMaisRows_();
    };
    fresh();
    var ovDrv = HUB_ACTIONS.staffProfileOverview({ staff: 'ann9lee' }, master);
    var od = (ovDrv.data || {}).driving || {}, om = (ovDrv.data || {}).med_del || {};
    stAssert_(out, P + 'driving: the real read caches the masked index only, and the Staff Profile answer carries both ' +
                   'parts as built — the masked licence, the points, one MAIS line per level — with nothing secret in it',
              !!realDrv.rows.ann9lee && drvBack.rows.ann9lee.fields.dl_last4 === '•••• 8707' &&
              secretIn(drvBack).length === 0 && ovDrv.status === 200 && od.dl_last4 === '•••• 8707' && od.points === 2 &&
              od.license_standing && od.license_standing.word === 'Suspended' && od.degraded === false &&
              od.license_state === 'current' && (om.certs || []).length === 3 && om.source === 'Med Del Certs (MAIS)' &&
              om.degraded === false && !/see Driver|see Med Del/.test(ovDrv.data.why) &&
              secretIn(ovDrv).length === 0, JSON.stringify([od, om]) + ' ' + secretIn(ovDrv).join());
    certReadTab_ = function (tab) {
      if (tab !== certSourceTab_('mais')) throw new Error('st: no estate tab ' + tab);
      return [];
    };
    fresh();
    var ovNone = HUB_ACTIONS.staffProfileOverview({ staff: 'ann9lee' }, master);
    var nm = (ovNone.data || {}).med_del || {};
    stAssert_(out, P + 'MAIS: a tab that reads no rows (missing, renamed or empty) is unread and degraded, never "no MAIS ' +
                   'record", and the page\'s banner points at the card that says so',
              ovNone.status === 200 && nm.degraded === true && /read no rows/.test(nm.why) && nm.certs.length === 0 &&
              ovNone.data.degraded === true && /see Med Del \(MAIS\)/.test(ovNone.data.why) &&
              !/see Driver/.test(ovNone.data.why), JSON.stringify(nm) + ' ' + ovNone.data.why);
    empDbId_ = function () { throw new Error('st: the book is closed'); };
    certReadTab_ = function () { throw new Error('st: the scrape is closed'); };
    fresh();
    var ovShut = HUB_ACTIONS.staffProfileOverview({ staff: 'ann9lee' }, master);
    var sd = (ovShut.data || {}).driving || {}, sm = (ovShut.data || {}).med_del || {};
    stAssert_(out, P + 'driving and MAIS: an unreadable book is a sentence in each part and a degraded answer, never ' +
                   'an empty record; the page\'s banner points at both cards',
              ovShut.status === 200 && ovShut.data.degraded === true && sd.degraded === true &&
              /employee driver tab could not be read/.test(sd.why) && /Driver Compliance tab could not be read/.test(sd.why) &&
              sm.degraded === true && /Med Del Certs \(MAIS\) tab could not be read/.test(sm.why) && sm.certs.length === 0 &&
              /see Driver/.test(ovShut.data.why) && /see Med Del \(MAIS\)/.test(ovShut.data.why),
              JSON.stringify([sd, sm]) + ' ' + ovShut.data.why);
    ssOpen_ = function () { return {}; };
    empDbId_ = keep.empDb;
    certReadTab_ = keep.certTab;
    fresh();

    // ---- 8. compliance ----
    var flowsHead = MEDDEL_HEADER.slice();
    var flowRow = function (vals) { return flowsHead.map(function (h) { return vals[h] === undefined ? '' : vals[h]; }); };
    var flows = stSpSheet_([flowsHead,
      flowRow({ id: 'md_a1', employeeName: 'Ann9 Lee', nameKey: 'ann9lee', medLevel: 'Med 1', certExpDate: '2025-01-01',
                phase: '3', overallStatus: 'active', phone: '(330) 555-0101' }),
      flowRow({ id: 'md_a3', employeeName: 'Ann9 Lee', nameKey: 'ann9lee', medLevel: 'Med 3', certExpDate: '2026-10-30',
                phase: '2', overallStatus: 'active' }),
      flowRow({ id: 'md_a2', employeeName: 'Ann9 Lee', nameKey: 'ann9lee', medLevel: 'Med 2', certExpDate: '2026-10-01',
                phase: '5', overallStatus: 'complete' }),
      flowRow({ id: 'md_x1', employeeName: 'Ann9 Leex', nameKey: 'ann9leex', medLevel: 'Med 1', certExpDate: '2026-10-01',
                phase: '4', overallStatus: 'active' })]);
    var ensuredFlows = [];
    hubTabSheet_ = function (t) { return t === MEDDEL_TAB ? flows : null; };
    hubTabEnsure_ = function (t) { ensuredFlows.push(t); throw new Error('st: a read never makes ' + t); };
    certMatrixColumns_ = function () { return ['dodd', 'cpr', 'med1', 'med3', 'money', 'mandt']; };
    var trackerTab = certSourceTab_('trainings');
    certReadTab_ = function (tab) {
      if (tab !== trackerTab) throw new Error('st: no estate tab ' + tab);
      return [{ name: 'Ann9 Lee', training: 'DODD 8-Hour Exp', status: 'Renewal assigned', expiration_date: '2027-01-01' },
              { name: 'Ann9 Leex', training: 'CPR Exp Date', status: 'Scheduled', expiration_date: '2026-10-01' },
              { name: 'Ann9 Lee', training: 'Not a course', status: 'Whatever', expiration_date: '' }];
    };
    fresh();
    var comp = HUB_ACTIONS.staffProfileCompliance({ staff: 'ann9lee' }, master);
    var tr = {}, trRow = {};
    ((comp.data || {}).training || []).forEach(function (t) { tr[t.id] = t.state; trRow[t.id] = t; });
    var scr = {};
    ((comp.data || {}).screening || []).forEach(function (x) { scr[x.id] = x.state + ':' + x.date; });
    stAssert_(out, P + 'compliance: a course with a date is current, due soon or expired; a course the sources know the ' +
                   'person for with no date is "no date", never current; a paper awaiting confirmation is in review',
              comp.status === 200 && tr.dodd === 'current' && tr.cpr === 'in_review' && tr.med1 === 'expired' &&
              tr.money === 'no_date' && tr.mandt === 'no_date', JSON.stringify(comp.data && comp.data.training));
    stAssert_(out, P + 'compliance: the person\'s active Med Del flow rides its course — a dated course keeps its pill with ' +
                   'the renewal and its phase beside it, a course with no date is "renewal assigned"; a complete flow or ' +
                   'another key\'s never; the tracker\'s own Status word is kept for the course it names; the flows tab is ' +
                   'read and never made',
              trRow.med1 && trRow.med1.renewal && trRow.med1.renewal.phase === '3' &&
              trRow.med1.renewal.phase_label === 'Relias training' && tr.med3 === 'renewal_assigned' &&
              trRow.med3.renewal.phase === '2' && trRow.med3.renewal.phase_label === 'Application received' &&
              trRow.dodd.renewal === null && trRow.dodd.tracker_word === 'Renewal assigned' && trRow.cpr.tracker_word === '' &&
              JSON.stringify(comp.data.training).indexOf('Whatever') === -1 &&
              JSON.stringify(comp.data.training).indexOf('Scheduled') === -1 && comp.data.degraded === false &&
              ensuredFlows.length === 0 && JSON.stringify(comp.data).indexOf('555-0101') === -1,
              JSON.stringify([comp.data && comp.data.training, comp.data && comp.data.why, ensuredFlows]));
    stAssert_(out, P + 'compliance: the credentials by their expiry, Nurse Aide not applicable, and a dated screening ' +
                   'clear — a registry check with a date is never an expiry',
              comp.data.credentials[0].state === 'current' && comp.data.credentials[2].state === 'na' &&
              scr.federal === 'clear:2024-01-03' && scr.state_registries === 'clear:2024-01-03' &&
              scr.bci_fbi === 'clear:2024-01-04', JSON.stringify(comp.data.screening));
    requirementsAll_ = function () { return { source: 'fallback', rows: REQUIREMENTS_CATALOG.slice() }; };
    fresh();
    var filing = HUB_ACTIONS.staffProfileCompliance({ staff: 'ann9lee' }, master);
    var fil = {};
    (((filing.data || {}).training || []).concat((filing.data || {}).credentials || [])).forEach(function (t) {
      var f = t.filing || {};
      fil[t.id] = [f.req_id, f.master_header, f.date_role, f.files, f.confirm_why ? 'shut' : 'open'].join('|');
    });
    stEq_(out, P + 'compliance: each course and credential names the requirement its paper files under, the Master ' +
          'column a confirmed date is written to, and whether a paper is read and its date confirmed here',
          ['dodd', 'cpr', 'med1', 'money', 'driver_license', 'car_insurance', 'nurse_aide'].map(function (k) {
            return k + '=' + fil[k];
          }).join(' '),
          'dodd=dodd|DODD 8-Hour Exp|expires|true|open cpr=cpr|CPR Exp Date|expires|true|open ' +
          'med1=med1|Med 1 Exp Date|expires|true|shut money=money|money mgt date|expires|true|open ' +
          'driver_license=driver_license|License Exp Date|expires|true|open ' +
          'car_insurance=car_insurance|Insurance Exp Date|expires|true|open nurse_aide=nurse_aide|||false|shut');
    var papers = (filing.data || {}).papers || [];
    stEq_(out, P + 'compliance: the person\'s papers filed and not yet confirmed are listed to continue from — never a ' +
          'confirmed one, another person\'s, or the paper\'s link or file',
          papers.map(function (p) { return [p.id, p.req_id, p.at].join('|'); }).join(' ') + ' ' +
          (JSON.stringify(papers).indexOf('uploadcpr0001') === -1 && papers.every(function (p) {
            return !Object.prototype.hasOwnProperty.call(p, 'url') && !Object.prototype.hasOwnProperty.call(p, 'file_id');
          })), 'UP1|cpr|2026-09-01T00:00:00Z true');
    requirementsAll_ = function () { throw new Error('st: the catalogue tab is down'); };
    fresh();
    var noCat = HUB_ACTIONS.staffProfileCompliance({ staff: 'ann9lee' }, master);
    stAssert_(out, P + 'compliance: a catalogue that cannot be read files no course, says so, and is never kept as an ' +
                   'empty catalogue',
              noCat.status === 200 && noCat.data.degraded === true && /the requirements catalogue/.test(noCat.data.why) &&
              noCat.data.training.every(function (t) { return t.filing && t.filing.req_id === ''; }),
              JSON.stringify([noCat.data && noCat.data.why, noCat.data && noCat.data.training]));
    requirementsAll_ = function () { return { source: 'fallback', rows: REQUIREMENTS_CATALOG.slice() }; };

    // ---- 9. actions ----
    requirementsAll_ = function () {
      return { source: 'tab', rows: [
        { req_id: 'dodd', label: 'DODD 8-Hour', category: 'training' },
        { req_id: 'cpr', label: 'CPR / First Aid', category: 'training' },
        { req_id: 'driver_license', label: 'Driver\'s License', category: 'documents' },
        { req_id: 'bci', label: 'BCI', category: 'background' },
        { req_id: 'med3', label: 'Med Delivery 3', category: 'training', credential: 'med3' }] };
    };
    reqStatesListValues_ = function () {
      return { hdr: ['login', 'person_key', 'person_name', 'req_id', 'state', 'expires', 'days_left'], values: [
        ['', 'ann9lee', 'Ann9 Lee', 'dodd', 'expired', '2026-09-01', '-21'],
        ['', 'ann9lee', 'Ann9 Lee', 'driver_license', 'expiring', '2026-10-01', '9'],
        ['', 'ann9lee', 'Ann9 Lee', 'bci', 'missing', '', ''],
        ['', 'ann9leex', 'Ann9 Leex', 'cpr', 'expired', '2026-01-01', ''],
        ['', 'ann9lee', 'Ann9 Lee', 'cpr', 'ok', '2027-01-01', ''],
        ['', 'ann9lee', 'Ann9 Lee', 'med3', 'expiring', '2026-10-30', '38']] };
    };
    fresh();
    var act = HUB_ACTIONS.staffProfileActions({ staff: 'ann9lee' }, master);
    var items = ((act.data || {}).items || []).map(function (i) { return i.id + ':' + i.status + ':' + i.flow + ':' + i.phase; });
    stAssert_(out, P + 'actions: the person\'s requirement rows by the exact key (another key never matches), background ' +
                   'checks left out, the owed IST and the paper in review with its document',
              act.status === 200 && items.length === 6 &&
              items.indexOf('req:dodd:needs_attention:Training renewal:Expired') !== -1 &&
              items.indexOf('req:driver_license:due_soon:Document renewal:Expires in 9 days') !== -1 &&
              items.indexOf('ist:i2:needs_attention:IST training:Owed · due 2026-09-01') !== -1 &&
              items.indexOf('upload:UP1:in_review:Certificate review:In review') !== -1 &&
              act.data.items.filter(function (i) { return i.id === 'upload:UP1'; })[0].action.doc_id === 'uploadcpr0001',
              items.join(' | '));
    stAssert_(out, P + 'actions: an active Med Del flow is a pendency at its phase — one row with the requirement it renews ' +
                   '(the requirement\'s status kept), its own row otherwise, expired past its date; a complete flow or ' +
                   'another key\'s never',
              items.indexOf('req:med3:due_soon:Med Del renewal:Phase 2 · Application received') !== -1 &&
              items.indexOf('meddel:md_a1:needs_attention:Med Del renewal:Phase 3 · Relias training') !== -1 &&
              items.join().indexOf('md_a2') === -1 && items.join().indexOf('md_x1') === -1 &&
              act.data.items.filter(function (i) { return i.id === 'meddel:md_a1'; })[0].date === '2025-01-01' &&
              act.data.counts.needs_attention === 3 && act.data.counts.due_soon === 2 && act.data.counts.in_review === 1,
              items.join(' | '));

    // ---- 10. the document door ----
    var bytesAsked = [];
    locationsDocBytes_ = function (id) { bytesAsked.push(id); return { name: 'cpr.pdf', mime: 'application/pdf', size: 3, exported: false, b64: 'QUJD' }; };
    var d1 = HUB_ACTIONS.staffProfileDocFile({ staff: 'ann9lee', id: 'uploadcpr0001' }, master);
    var d2 = HUB_ACTIONS.staffProfileDocFile({ staff: 'ann9lee', id: 'otherperson001' }, master);
    var d3 = HUB_ACTIONS.staffProfileDocFile({ staff: 'ann9lee', id: 'bad id' }, master);
    var d4 = HUB_ACTIONS.staffProfileDocFile({ staff: 'ann9lee', id: 'driveresume0001' }, master);
    stAssert_(out, P + 'document door: a file the person\'s Documents name opens as bytes; another person\'s file is 404 ' +
                   'and a malformed id 400, both before Drive is asked',
              d1.status === 200 && d1.data.b64 === 'QUJD' && d2.status === 404 && d3.status === 400 && d4.status === 200 &&
              bytesAsked.join() === 'uploadcpr0001,driveresume0001', JSON.stringify([d1.status, d2, d3, bytesAsked]));

    // ---- texts ----
    var quo = stSpSheet_([
      ['message_id', 'message_created', 'direction', 'from_number', 'to_number', 'body', 'quo_number', 'user_id'],
      ['m1', '2026-05-01T12:00:00Z', 'incoming', '+13305550101', '+13309197595', 'Running late', 'PNaaaa0001', ''],
      ['m2', '2026-05-06T12:00:00Z', 'outgoing', '+13309197595', '+13305550101', 'Thanks', 'PNaaaa0001', 'US1'],
      ['m3', '2026-08-24T12:00:00Z', 'incoming', '+13305550101', '+13309195558', 'Hi group', 'PNgroup001', ''],
      ['m4', '2026-08-25T12:00:00Z', 'incoming', '+13305550111', '+13309197595', 'shared phone text', 'PNaaaa0001', ''],
      ['m5', '2026-08-25T13:00:00Z', 'incoming', '+12165550000', '+13309197595', 'stranger text', 'PNaaaa0001', ''],
      ['m6', '2026-05-07T12:00:00Z', 'outgoing', '+13309197595', '+13305550101', 'number 987654323 ok', 'PNaaaa0001', '']
    ]);
    hubTabSheet_ = function (t) { return t === 'quo_messages' ? quo : null; };
    hubLineRow_ = function (v) {
      var s = String(v || '');
      if (s === 'PNaaaa0001' || s === '3309197595') {
        return { digits: '3309197595', e164: '+13309197595', name: 'HR line', owner: 'Hera Owner', humans: 1, shared: false };
      }
      if (s === 'PNgroup001' || s === '3309195558') {
        return { digits: '3309195558', e164: '+13309195558', name: 'Group', owner: 'Svc', humans: 3, shared: true };
      }
      return null;
    };
    hubLineOurs_ = function (d) { return d === '3309197595' || d === '3309195558'; };
    fresh();
    var tx = HUB_ACTIONS.staffProfileTexts({ staff: 'ann9lee' }, master);
    var tx2 = HUB_ACTIONS.staffProfileTexts({ staff: 'ann9lee', with: '3309197595' }, master);
    var tx3 = HUB_ACTIONS.staffProfileTexts({ staff: 'ann9lee', with: '3309197595', before: '2026-05-06T12:00:00Z' }, master);
    var t2 = tx2.data || {};
    var txText = JSON.stringify([tx, tx2, tx3]);
    stAssert_(out, P + 'texts: one conversation per company line, newest first; a phone another person also carries is ' +
                   'not attributed; the sole holder of a line signs its texts, a shared line names nobody; the empty ' +
                   'months are a gap; a stranger\'s number or text never appears; a bare nine-digit run is withheld',
              tx.status === 200 && tx.data.counterparts.map(function (c) { return c.id; }).join() === '3309195558,3309197595' &&
              tx.data.with === '3309195558' && tx.data.counterparts[0].owner === '' && tx.data.phones_matched === 1 &&
              /not attributed/.test(tx.data.why) && t2.messages.map(function (m) { return m.id; }).join() === 'm6,m2,m1' &&
              t2.messages[1].by === 'Hera Owner' && t2.messages[2].by === 'Ann9 Lee' && t2.messages[2].dir === 'in' &&
              t2.messages[0].body.indexOf('987654323') === -1 && t2.more === false &&
              tx.data.coverage.gaps.length === 1 && tx.data.coverage.gaps[0].from === '2026-05-08' &&
              tx.data.coverage.gaps[0].to === '2026-08-23' && (tx3.data.messages || []).map(function (m) { return m.id; }).join() === 'm1' &&
              txText.indexOf('2165550000') === -1 && txText.indexOf('stranger') === -1 && txText.indexOf('shared phone text') === -1,
              txText.slice(0, 1500));

    // ---- 11. the calls and the transcript door ----
    var hot = stSpSheet_([
      ['Call ID', 'Transcript Created', 'Event Timestamp', 'Duration (sec)', 'Quo Number', 'Participant(s)', 'Team Member(s)',
       'Direction', '# Turns', 'Full Transcript', 'Speaker Transcript'],
      ['AC1', '2026-05-02T10:00:00Z', '2026-05-02T10:00:00Z', 120, 'PNx', '+13305550101', '+13309197595', 'incoming', 8,
       'SECRET WORDS', 'A: SECRET WORDS'],
      ['AC2', '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', 60, 'PNx', '+12165550000', '+13309197595', 'incoming', 4,
       'other words', '']
    ]);
    var calls = stSpSheet_([
      ['id', 'call_id', 'call_at', 'line', 'direction', 'duration_sec', 'turns', 'person_key'],
      ['c3', 'AC3', '2026-09-01T00:00:00Z', '+13309197595', 'outgoing', 30, 2, 'ann9lee'],
      ['c4', 'AC4', '2026-09-02T00:00:00Z', '+13309197595', 'outgoing', 30, 2, 'bob9twin']
    ]);
    var items2 = stSpSheet_([
      ['id', 'call_id', 'work_type', 'category', 'description'],
      ['w1', 'AC1', 'DailyNote', 'Daily note', 'WORDS DESC'],
      ['w2', 'AC3', 'Request', 'Time off', 'MORE WORDS']
    ]);
    hubId_ = function (k) { return k === 'HOTLINE_TRANSCRIPTS_ID' ? 'st-hot-book' : ''; };
    ssOpen_ = function (id) {
      if (id !== 'st-hot-book') throw new Error('st: no book');
      return { getSheetByName: function (n) { return n === HOTLINE_TRANSCRIPTS_TAB ? hot : null; } };
    };
    hubTabSheet_ = function (t) { return t === COMM_CALLS_TAB ? calls : (t === COMM_WORK_ITEMS_TAB ? items2 : null); };
    fresh();
    var tc = HUB_ACTIONS.staffProfileTranscripts({ staff: 'ann9lee' }, master);
    var tcd = tc.data || {};
    stAssert_(out, P + 'calls: the hotline tab by the person\'s phone and the calls house by its person key, newest first, ' +
                   'each with its kind and categories; the words and the description columns are never read',
              tc.status === 200 && (tcd.calls || []).map(function (c) { return c.call_id; }).join() === 'AC3,AC1' &&
              tcd.calls[1].kind === 'DailyNote' && tcd.calls[1].categories.join() === 'Daily note' &&
              tcd.calls[1].secs === '120' && tcd.calls[1].line === '+13309197595' && tcd.calls[0].categories.join() === 'Time off' &&
              tcd.categories.length === 2 && tcd.gaps.length === 1 && tcd.gaps[0].from === '2026-05-03' &&
              !hot.readCols[10] && !hot.readCols[11] && !items2.readCols[5] &&
              JSON.stringify(tc).indexOf('WORDS') === -1 && JSON.stringify(tc).indexOf('2165550000') === -1,
              JSON.stringify([tcd, Object.keys(hot.readCols), Object.keys(items2.readCols)]));
    var doorCalls = [];
    commCallsTranscriptRead_ = function (id, u) { doorCalls.push(id + ':' + (u && u.email)); return { status: 200, data: { call_id: id } }; };
    var own = HUB_ACTIONS.staffProfileTranscript({ staff: 'ann9lee', call_id: 'AC1' }, master);
    var others = HUB_ACTIONS.staffProfileTranscript({ staff: 'ann9lee', call_id: 'AC2' }, master);
    APP_RULES = { rules: {}, tenants: {} };
    APP_RULES.rules[SP_APP_ID] = ['STAFF'];
    var ownSally = HUB_ACTIONS.staffProfileTranscript({ staff: 'ann9lee', call_id: 'AC1' }, sally);
    var adminDoorSally = HUB_ACTIONS.commCallsTranscript({ call_id: 'AC1' }, sally);
    APP_RULES = { rules: {}, tenants: {} };
    var shutSally = HUB_ACTIONS.staffProfileTranscript({ staff: 'ann9lee', call_id: 'AC1' }, sally);
    stAssert_(out, P + 'transcript door: another person\'s call is 404; the person\'s own is read through the transcript ' +
                   'reader once, as the master — and for a STAFF account on the released app, past this gate and not ' +
                   'the admin-only door, which still refuses it; unreleased, the exact 404',
              own.status === 200 && own.data.call_id === 'AC1' && others.status === 404 &&
              ownSally.status === 200 && ownSally.data.call_id === 'AC1' && adminDoorSally.status === 403 &&
              shape(shutSally) && doorCalls.join() === 'AC1:' + HUB_MASTER_ACCOUNT + ',AC1:sally9@asa.test',
              JSON.stringify([own, others, ownSally, adminDoorSally, shutSally, doorCalls]));
    commCallsTranscriptRead_ = keep.callsRead;
    hubId_ = function () { return ''; };
    ssOpen_ = function () { return {}; };

    // ---- 12. the visit log ----
    var visits = stLocSheet_([]);
    var ensured = [];
    hubTabEnsure_ = function (tab, header) {
      ensured.push(tab);
      if (HUB_TAB_BORN_HOME.indexOf(tab) === -1) throw new Error('st: ' + tab + ' is not born home');
      if (tab !== SP_VISITS_TAB) throw new Error('st: no other tab');
      if (!visits.grid.length) visits.grid.push(header.slice());
      return visits;
    };
    hubTabSheet_ = function (t) { return t === SP_VISITS_TAB && visits.grid.length ? visits : null; };
    var quiet = 'spv_' + clientNameKey_(HUB_MASTER_ACCOUNT) + '_ann9lee_documents';
    CacheService.getScriptCache().remove(quiet);
    var logBefore = logged.length;
    beAnotherActive_ = function () { return { real: 'x' }; };
    var acting = HUB_ACTIONS.staffProfileVisit({ staff: 'ann9lee', section: 'documents' }, master);
    beAnotherActive_ = keep.beAnother;
    var visiting = HUB_ACTIONS.staffProfileVisit({ staff: 'ann9lee', section: 'documents' },
                                                 { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'm1' });
    HUB_MEMBER_CTX = { memberId: 'mem_st', userId: 'u-st', email: 'ann@example.org' };
    var inCtx = HUB_ACTIONS.staffProfileVisit({ staff: 'ann9lee', section: 'documents' }, master);
    HUB_MEMBER_CTX = null;
    stAssert_(out, P + 'visits: an acting session is not recorded and nothing names why; a visit and the member context ' +
                   'stop at the gate — no row, no tab, no log line',
              acting.status === 200 && JSON.stringify(acting.data) === '{"recorded":false}' && Object.keys(acting).length === 2 &&
              visiting.status === 404 && inCtx.status === 404 && visits.grid.length === 0 && ensured.length === 0 &&
              logged.length === logBefore, JSON.stringify([acting, visiting, inCtx, ensured]));
    var v1 = HUB_ACTIONS.staffProfileVisit({ staff: 'ann9lee', section: 'documents' }, master);
    var v2 = HUB_ACTIONS.staffProfileVisit({ staff: 'ann9lee', section: 'documents' }, master);
    var vBad = HUB_ACTIONS.staffProfileVisit({ staff: 'ann9lee', section: 'passwords' }, master);
    var vh = visits.grid[0] || [];
    var vr = visits.grid[1] || [];
    stAssert_(out, P + 'visits: a visit appends one row with the declared header in the born-home tab; the same visitor, ' +
                   'person and section inside the quiet window writes nothing; an unknown section is 400; no log line',
              v1.status === 200 && v1.data.recorded === true && v2.data.recorded === false && vBad.status === 400 &&
              visits.grid.length === 2 && vh.join() === SP_VISITS_HEADER.join() && vr[vh.indexOf('staff_key')] === 'ann9lee' &&
              vr[vh.indexOf('section')] === 'documents' && vr[vh.indexOf('visitor_email')] === HUB_MASTER_ACCOUNT &&
              ensured.join() === SP_VISITS_TAB && logged.length === logBefore &&
              stCode_(HUB_ACTIONS.staffProfileVisit).indexOf('hubSysLog_') === -1,
              JSON.stringify([v1, v2, vBad, visits.grid]));
    CacheService.getScriptCache().remove(quiet);
    var heldQuiet = 'spv_' + clientNameKey_(HUB_MASTER_ACCOUNT) + '_ann9lee_employment';
    CacheService.getScriptCache().remove(heldQuiet);
    var heldAsked = 0;
    sheetDbGateHolds_ = function () { heldAsked++; return { error: { status: 409, message: 'st: held' } }; };
    var vh1 = HUB_ACTIONS.staffProfileVisit({ staff: 'ann9lee', section: 'employment' }, master);
    var vh2 = HUB_ACTIONS.staffProfileVisit({ staff: 'ann9lee', section: 'employment' }, master);
    sheetDbGateHolds_ = function () { return null; };
    CacheService.getScriptCache().remove(heldQuiet);
    stAssert_(out, P + 'visits: while the book-write funnel holds, a visit writes nothing and the funnel is asked once per ' +
                   'visitor, person and section inside the quiet window — never once per section open',
              vh1.status === 200 && vh1.data.recorded === false && vh2.status === 200 && vh2.data.recorded === false &&
              heldAsked === 1 && visits.grid.length === 2, JSON.stringify([vh1, vh2, heldAsked, visits.grid.length]));

    // ---- activity ----
    var events = stLocSheet_([EVENTS_HEADER.slice(),
      ['evt_1', 'requirement_state_changed', 'x', 'person', 'ann9lee', 'Ann9 Lee', '{"req_id":"dodd","prev_state":"ok","state":"expired","expires":"2026-09-01"}', 's', '2026-09-02T00:00:00Z', ''],
      ['evt_2', 'staffProfileHr', HUB_MASTER_ACCOUNT, 'action', 'ann9lee', '', '{}', 'hubSysLog_', '2026-09-03T00:00:00Z', ''],
      ['evt_3', 'requirement_state_changed', 'x', 'person', 'ann9leex', 'Ann9 Leex', '{"req_id":"cpr"}', 's', '2026-09-04T00:00:00Z', '']
    ]);
    hubTabSheet_ = function (t) {
      if (t === SP_VISITS_TAB) return visits;
      if (t === EVENTS_TAB) return events;
      return null;
    };
    fresh();
    var ac = HUB_ACTIONS.staffProfileActivity({ staff: 'ann9lee' }, master);
    var kinds = {};
    ((ac.data || {}).events || []).forEach(function (ev) { kinds[ev.kind] = (kinds[ev.kind] || 0) + 1; });
    var acText = JSON.stringify(ac);
    stAssert_(out, P + 'activity: visits with who and when, the ISTs, the requirement change and the HR view from the ' +
                   'events trail (another key never), the uploads, the incidents the person is named in or filed — never ' +
                   'their words — and the schedule said as "Scheduled"',
              ac.status === 200 && ac.data.visits_total === 1 && ac.data.visits[0].section === 'documents' &&
              kinds.visit === 1 && kinds.ist_assigned === 2 && kinds.ist_done === 1 && kinds.requirement === 1 &&
              kinds.hr_view === 1 && kinds.incident === 2 && kinds.upload >= 2 && kinds.upload_confirmed === 1 &&
              kinds.scheduled === 1 && acText.indexOf('private summary') === -1 && acText.indexOf('more private') === -1 &&
              acText.indexOf('Kenny9 Marsh') !== -1 && acText.indexOf('ann9leex') === -1 && acText.indexOf('confirmed') !== -1 &&
              ac.data.events.filter(function (ev) { return ev.kind === 'scheduled'; })[0].title === 'Scheduled — ABD1305 · Mon, Wed',
              JSON.stringify(kinds) + ' ' + acText.slice(0, 600));

    // ---- 13. notes ----
    var notes = stLocSheet_([]);
    ensured = [];
    hubTabEnsure_ = function (tab, header) {
      ensured.push(tab);
      if (HUB_TAB_BORN_HOME.indexOf(tab) === -1) throw new Error('st: ' + tab + ' is not born home');
      if (tab !== SP_NOTES_TAB) throw new Error('st: no other tab');
      if (!notes.grid.length) notes.grid.push(header.slice());
      return notes;
    };
    hubTabSheet_ = function (t) { return t === SP_NOTES_TAB && notes.grid.length ? notes : null; };
    fresh();
    var nBefore = HUB_ACTIONS.staffProfileNotes({ staff: 'ann9lee' }, master);
    var nBad = [
      HUB_ACTIONS.staffProfileNoteAdd({ staff: 'ann9lee', details: '' }, master),
      HUB_ACTIONS.staffProfileNoteAdd({ staff: 'ann9lee', details: 'x', priority: 'panic' }, master),
      HUB_ACTIONS.staffProfileNoteAdd({ staff: 'ann9lee', details: 'x', category: 'gossip' }, master),
      HUB_ACTIONS.staffProfileNoteAdd({ staff: 'ann9lee', details: new Array(4002).join('y') }, master)
    ].map(function (r) { return r.status; });
    sheetDbGateHolds_ = function () { return { error: { status: 409, message: 'st: held' } }; };
    var nHeld = HUB_ACTIONS.staffProfileNoteAdd({ staff: 'ann9lee', details: 'x' }, master);
    sheetDbGateHolds_ = function () { return null; };
    stAssert_(out, P + 'notes: a read makes nothing; empty or over-long details, an unknown priority or category are 400; ' +
                   'the held funnel is 409 — none of them makes the tab',
              nBefore.status === 200 && nBefore.data.notes.length === 0 && nBefore.data.earlier.length === 1 &&
              nBefore.data.earlier[0].details === 'Great with clients' && nBad.join() === '400,400,400,400' &&
              nHeld.status === 409 && ensured.length === 0 && notes.grid.length === 0,
              JSON.stringify([nBefore, nBad, nHeld, ensured]));
    var nAdd = HUB_ACTIONS.staffProfileNoteAdd({ staff: 'ann9lee', details: '=HYPERLINK("http://x")', priority: 'High',
                                                 category: 'training', by: 'Mallory', state: 'resolved', id: 'forged' }, master);
    var nh = notes.grid[0] || [];
    var nr = notes.grid[1] || [];
    var ncol = function (hd) { return nr[nh.indexOf(hd)]; };
    stAssert_(out, P + 'notes: the first write makes the born-home tab through hubTabEnsure_; the filer, time, id and state ' +
                   'are the server\'s and text is kept from being a formula',
              nAdd.status === 200 && ensured.join() === SP_NOTES_TAB && nh.join() === SP_NOTES_HEADER.join() &&
              ncol('staff_key') === 'ann9lee' && ncol('state') === 'open' && ncol('by') === 'The Master' &&
              /^SN_/.test(ncol('id')) && ncol('priority') === 'high' && ncol('category') === 'training' &&
              ncol('details') === '\'=HYPERLINK("http://x")' && logged.indexOf('staffProfileNoteAdd:ann9lee') !== -1,
              JSON.stringify([nAdd, notes.grid]));
    var nid = String(ncol('id'));
    var nWrong = HUB_ACTIONS.staffProfileNoteState({ id: nid, state: 'resolved', staff: 'bob9twin' }, master);
    var nState = HUB_ACTIONS.staffProfileNoteState({ id: nid, state: 'deleted', staff: 'ann9lee' }, master);
    var nOk = HUB_ACTIONS.staffProfileNoteState({ id: nid, state: 'resolved', staff: 'ann9lee' }, master);
    var nAfter = HUB_ACTIONS.staffProfileNotes({ staff: 'ann9lee' }, master);
    stAssert_(out, P + 'notes: resolving checks the staff witness (another key is 409), knows open and resolved, touches ' +
                   'the three state cells, and the read retires with the write',
              nWrong.status === 409 && nState.status === 400 && nOk.status === 200 && ncol('state') === 'resolved' &&
              ncol('details') === '\'=HYPERLINK("http://x")' && nAfter.data.notes.length === 1 &&
              nAfter.data.notes[0].state === 'resolved', JSON.stringify([nWrong, nState, nOk, nAfter]));

    // ---- 14. assign training ----
    var createdRows = [];
    var lockLog = [];
    locationsLock_ = function () { lockLog.push('take'); return { releaseLock: function () { lockLog.push('release'); } }; };
    createRow_ = function (res, rec) { createdRows.push([res, rec]); var o2 = {}; for (var k in rec) o2[k] = rec[k]; o2.id = 'IST_NEW'; return o2; };
    istCertNote_ = function () { return 'st note'; };
    locationsHouse_ = function (raw) {
      if (raw === 'EMPTY01') return { code: 'EMPTY01', all_clients: clients, clients: [] };
      if (raw !== 'ABD1547') return { refused: { status: 404, message: 'st: no house' } };
      return { code: 'ABD1547', all_clients: clients, clients: [clients[1], clients[3]] };
    };
    istHouseMap_ = function () { return { ABD1547: ['Lia9 Gomez', 'Mo9 New', 'Ghost9 Name'] }; };
    var aEmpty = HUB_ACTIONS.staffProfileAssignTraining({ staff: 'ann9lee', house: 'EMPTY01' }, master);
    sheetDbGateHolds_ = function () { return { error: { status: 409, message: 'st: held' } }; };
    var aHeld = HUB_ACTIONS.staffProfileAssignTraining({ staff: 'ann9lee', house: 'ABD1547' }, master);
    sheetDbGateHolds_ = function () { return null; };
    var aDue = HUB_ACTIONS.staffProfileAssignTraining({ staff: 'ann9lee', house: 'ABD1547', due_date: 'soon' }, master);
    var aOk = HUB_ACTIONS.staffProfileAssignTraining({ staff: 'ann9lee', house: 'ABD1547' }, master);
    var made = (createdRows[0] || [])[1] || {};
    stAssert_(out, P + 'assign training: no clients is 409, the held funnel 409 and a bad day 400, each before a row; a ' +
                   'pair already on file is reported, a mapped name no client answers to is never a row, and exactly ' +
                   'one owed row is created with the rebuild\'s field set, under the lock',
              aEmpty.status === 409 && aHeld.status === 409 && aDue.status === 400 && aOk.status === 200 &&
              createdRows.length === 1 && createdRows[0][0] === 'istRecords' && made.status === 'owed' &&
              made.staffName === 'Ann9 Lee' && made.clientName === 'Mo9 New' && made.house === 'ABD1547' &&
              made.dueDate === '2026-09-22' && made.certNote === 'st note' && made.staffEmail === 'ann9.lee@example.org' &&
              made.notifyCount === '0' && made.trainedAt === '' && made.remindRequested === '' &&
              aOk.data.already.length === 1 && aOk.data.already[0].client_name === 'Lia9 Gomez' &&
              aOk.data.unplaced.join() === 'Ghost9 Name' && lockLog.join() === 'take,release' &&
              logged.indexOf('staffProfileAssignTraining:ann9lee') !== -1,
              JSON.stringify([aEmpty, aHeld, aDue, aOk, createdRows, lockLog]));

    // ---- the roster ----
    fresh();
    var rs = HUB_ACTIONS.staffProfileRoster({}, master);
    var rsAll = HUB_ACTIONS.staffProfileRoster({ show_inactive: 'true' }, master);
    var rk = {};
    ((rs.data || {}).staff || []).forEach(function (x) { rk[x.key] = x; });
    var rka = {};
    ((rsAll.data || {}).staff || []).forEach(function (x) { rka[x.key] = x; });
    stAssert_(out, P + 'roster: People and the Master together, the inactive only when asked, two records sharing a name ' +
                   'listed as ambiguous, the account\'s photo first, never a guardian or a client',
              rs.status === 200 && rk.ann9lee && rk.ann9lee.status === 'active' && rk.ann9lee.avatar === 'https://img/ann.png' &&
              rk.ann9lee.employee_id === '100001' && !rk.cara9only && rka.cara9only && rka.cara9only.status === 'inactive' &&
              rk.dupe9dupe && rk.dupe9dupe.ambiguous === true && rk.dee9solo && rk.dee9solo.status === 'other' &&
              !rk.gina9guardian && !rk.kenny9marsh && rs.data.counts.inactive >= 1,
              JSON.stringify([rs.data, rsAll.data && rsAll.data.counts]));

    // ---- 15. the viewer scope ----
    var scopeOf = function (kind, clientKeys, houses) {
      return { kind: kind, client_keys: clientKeys || [], house_codes: houses || [], ssa_keys: [], family_keys: [], why: '' };
    };
    var gateFor = {};
    hubProfileAppGate_ = function (appId, u) {
      var sc = appId === SP_APP_ID && u && !u.is_service && u.id ? gateFor[u.id] : null;
      return sc ? { open: true, scope: sc } : keep.appGate(appId, u);
    };
    var housesAsked = [], visibleKeys = ['ann9lee', 'dupe9dupe'], visibleWhy = '', visibleBroken = false;
    var rulesAsked = [];
    hubStaffVisibleForHouses_ = function (codes) {
      housesAsked.push((codes || []).join(','));
      rulesAsked.push('recent');
      if (visibleBroken) throw new Error('st: the calendar is closed');
      return { keys: visibleKeys.slice(), why: visibleWhy };
    };
    // a client's houses see this week's shifts there; stood in with the same people here
    hubStaffScheduledForHouses_ = function (codes) {
      housesAsked.push((codes || []).join(','));
      rulesAsked.push('week');
      if (visibleBroken) throw new Error('st: the calendar is closed');
      return { keys: visibleKeys.slice(), why: visibleWhy, week: '2026-09-21' };
    };
    var looked = [];
    staffProfilesPerson_ = function (k) { looked.push(k); return keep.person(k); };
    var kid = { id: 'u-kid9', email: 'kenny9@x.test', role: 'client', types: ['CLIENT'], client_key: 'k9marsh' };
    var fam = { id: 'u-fam9', email: 'gina9@x.test', role: 'client', types: ['GUARDIAN'], client_key: 'k9marsh' };
    var ssaV = { id: 'u-ssa9', email: 'ssa9@county.test', role: 'staff', types: ['GUARDIAN'] };
    gateFor[kid.id] = scopeOf('client', ['k9marsh'], ['ABD1305']);
    gateFor[fam.id] = scopeOf('guardian', ['k9marsh'], ['ABD1305']);
    gateFor[ssaV.id] = scopeOf('ssa', ['k9marsh'], ['ABD1305']);
    fresh();
    var BASIC_ROW = ['ambiguous', 'avatar', 'first_name', 'key', 'last_name', 'name', 'role', 'status'];
    var rKid = HUB_ACTIONS.staffProfileRoster({}, kid);
    var rKidRows = ((rKid.data || {}).staff || []);
    var rowKeysOk = rKidRows.every(function (x) {
      return Object.keys(x).every(function (k) { return BASIC_ROW.indexOf(k) !== -1; });
    });
    var rMaster = HUB_ACTIONS.staffProfileRoster({}, master);
    stAssert_(out, P + 'viewer scope: a client\'s roster is only the staff their houses see — name, photo, role and status, ' +
                   'never an employee id — marked basic and counted on what it lists; the master\'s is the whole roster, ' +
                   'marked full',
              rKid.status === 200 && rKid.data.view === 'basic' &&
              rKidRows.map(function (x) { return x.key; }).sort().join() === 'ann9lee,dupe9dupe' && rowKeysOk &&
              JSON.stringify(rKid).indexOf('100001') === -1 && rKid.data.counts.active === 2 &&
              rKid.data.degraded === false && housesAsked.indexOf('ABD1305') !== -1 &&
              rMaster.status === 200 && rMaster.data.view === 'full' &&
              rMaster.data.staff.some(function (x) { return x.key === 'bob9twin'; }) &&
              rMaster.data.staff.some(function (x) { return x.employee_id === '100001'; }),
              JSON.stringify([rKid, rMaster.data && rMaster.data.view]));

    var logBefore15 = logged.length;
    looked = [];
    var oKid = HUB_ACTIONS.staffProfileOverview({ staff: 'ann9lee' }, kid);
    var oFam = HUB_ACTIONS.staffProfileOverview({ staff: 'ann9lee' }, fam);
    var ok = oKid.data || {};
    var kidText = JSON.stringify(oKid);
    var never = ['ann9.lee@example.org', 'ann9.home@example.org', '555-0101', '555-0111', '100001', 'Lia9 Gomez',
                 'Pat9 Quinn', 'istpaperfile01', 'ABD1547', '1990-05-17', 'Great with clients'];
    stAssert_(out, P + 'viewer scope: a client or family viewer reads the BASIC profile — name, photo, role and status, and ' +
                   'the ISTs on their own client — never a phone, e-mail, employee id, house worked, other client, ' +
                   'driving, MAIS, note or document',
              oKid.status === 200 && Object.keys(ok).sort().join() === 'degraded,ist,person,view,why' && ok.view === 'basic' &&
              Object.keys(ok.person || {}).sort().join() === 'avatar,first_name,key,last_name,name,role,status' &&
              ok.person.avatar === 'https://img/ann.png' && ok.person.name === 'Ann9 Lee' &&
              ok.ist.length === 1 && ok.ist[0].client_key === 'k9marsh' && ok.ist[0].status === 'done' &&
              !('doc_id' in ok.ist[0]) && never.filter(function (s) { return kidText.indexOf(s) !== -1; }).length === 0 &&
              oFam.status === 200 && JSON.stringify(oFam.data) === JSON.stringify(ok),
              JSON.stringify([oKid, never.filter(function (s) { return kidText.indexOf(s) !== -1; })]));
    rulesAsked = [];
    HUB_ACTIONS.staffProfileRoster({}, kid);
    HUB_ACTIONS.staffProfileOverview({ staff: 'ann9lee' }, kid);
    var kidRules = rulesAsked.join();
    rulesAsked = [];
    HUB_ACTIONS.staffProfileRoster({}, fam);
    HUB_ACTIONS.staffProfileOverview({ staff: 'ann9lee' }, fam);
    var famRules = rulesAsked.join();
    stAssert_(out, P + 'viewer scope: a client\'s houses see the staff on this week\'s shifts there, for the roster and ' +
                   'the profile alike; a family member keeps the recent rule',
              kidRules === 'week,week' && famRules === 'recent,recent', kidRules + ' | ' + famRules);

    // ---- the relay's pack for a client ----
    hubViewerClientScope_ = function (kind, v) { return scopeOf(kind, [v.client_key], ['ABD1305']); };
    fresh();
    var logBeforePack = logged.length;
    var cpk = HUB_ACTIONS.staffClientPack({ client: 'k9marsh' }, serviceUser_());
    var cpp = (cpk.data && cpk.data.parts) || {};
    var cps = (cpk.data && cpk.data.part_status) || {};
    var rosterNow = HUB_ACTIONS.staffProfileRoster({}, kid);
    var annNow = HUB_ACTIONS.staffProfileOverview({ staff: 'ann9lee' }, kid);
    var packShut = [master, kid, fam, null, { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' }]
      .map(function (u) { return HUB_ACTIONS.staffClientPack({ client: 'k9marsh' }, u); });
    var packBad = HUB_ACTIONS.staffClientPack({ client: 'k 9' }, serviceUser_());
    var budgetKeep = SP_CLIENT_PACK_BUDGET_MS;
    SP_CLIENT_PACK_BUDGET_MS = -1;
    var packLate = HUB_ACTIONS.staffClientPack({ client: 'k9marsh' }, serviceUser_());
    SP_CLIENT_PACK_BUDGET_MS = budgetKeep;
    var packPol = HUB_POLICY.staffClientPack || {};
    stAssert_(out, P + 'client pack: a service read declared in StaffProfiles.gs and no section door; only the service ' +
                   'identity gathers it — the roster and each BASIC profile exactly as the Staff actions answer the ' +
                   'client, none for an ambiguous name, and the Monday of the week it is of; past its budget no profile ' +
                   'is started; a malformed key is 400; nothing is logged',
              packPol.file === 'StaffProfiles.gs' && packPol.lane === 'read' && JSON.stringify(packPol.roles) === '["admin"]' &&
              SERVICE_READ_ACTIONS.indexOf('staffClientPack') !== -1 && SP_ACTIONS.indexOf('staffClientPack') === -1 &&
              cpk.status === 200 && cpk.data.client === 'k9marsh' && cpk.data.week === '2026-09-21' &&
              JSON.stringify(cpp.roster) === JSON.stringify(rosterNow.data) &&
              JSON.stringify(cpp.profile_ann9lee) === JSON.stringify(annNow.data) &&
              Object.keys(cpp).sort().join() === 'profile_ann9lee,roster' && cps.roster.status === 200 &&
              packShut.every(shape) && packBad.status === 400 && packLate.status === 200 &&
              packLate.data.part_status.profile_ann9lee.status === 503 && !packLate.data.parts.profile_ann9lee &&
              !!packLate.data.parts.roster && LOCATION_PACK_MEMO_ === null && CLIENTS_DERIVED_MEMO_ === null &&
              logged.length === logBeforePack,
              JSON.stringify([cpk, packShut, packBad]).slice(0, 1500));
    hubViewerClientScope_ = keep.clientScope;

    looked = [];
    var outside = HUB_ACTIONS.staffProfileOverview({ staff: 'bob9twin' }, kid);
    var nobodyK = HUB_ACTIONS.staffProfileOverview({ staff: 'zzz9nobody' }, fam);
    var malformed = HUB_ACTIONS.staffProfileOverview({ staff: 'Ann9 Lee' }, kid);
    stAssert_(out, P + 'viewer scope: a staff key outside the viewer\'s houses answers 404 exactly as a key no one carries, ' +
                   'before the person is looked up; a malformed key is 400',
              outside.status === 404 && outside.message === SP_NO_STAFF && nobodyK.status === 404 &&
              JSON.stringify(nobodyK) === JSON.stringify(outside) && malformed.status === 400 && looked.length === 0,
              JSON.stringify([outside, nobodyK, malformed, looked]));

    var notesBefore = notes.grid.length, rowsBefore = createdRows.length, visitsBefore = visits.grid.length;
    var narrowLeaks = [];
    [kid, fam].forEach(function (u) {
      SP_ACTIONS.forEach(function (a) {
        if (OPENED.indexOf(a) !== -1) return;
        var r = HUB_ACTIONS[a]({ staff: 'ann9lee', id: nid, state: 'open', section: 'profile', call_id: 'AC1',
                                 house: 'ABD1547', details: 'x' }, u);
        if (!shape(r)) narrowLeaks.push(u.id + ' ' + a + ' → ' + JSON.stringify(r));
      });
    });
    stAssert_(out, P + 'viewer scope: for a client or family viewer every other section, document, call, visit and write ' +
                   'answers the exact 404 — no note, IST row, visit row or log line is made',
              narrowLeaks.length === 0 && notes.grid.length === notesBefore && createdRows.length === rowsBefore &&
              visits.grid.length === visitsBefore && logged.length === logBefore15,
              narrowLeaks.slice(0, 4).join(' | '));

    fresh();
    var oSsa = HUB_ACTIONS.staffProfileOverview({ staff: 'ann9lee' }, ssaV);
    var shSsa = HUB_ACTIONS.staffProfileShifts({ staff: 'ann9lee' }, ssaV);
    var hrSsa = HUB_ACTIONS.staffProfileHr({ staff: 'ann9lee' }, ssaV);
    var rSsa = HUB_ACTIONS.staffProfileRoster({}, ssaV);
    var ssaWrites = WRITES.map(function (a) {
      return HUB_ACTIONS[a]({ staff: 'ann9lee', id: nid, state: 'open', house: 'ABD1547', details: 'x' }, ssaV);
    });
    stAssert_(out, P + 'viewer scope: an SSA sees Staff whole — every staff member, the phones, the shifts and the HR ' +
                   'record — and still writes nothing',
              oSsa.status === 200 && oSsa.data.person.phones.length === 2 && oSsa.data.person.employee_id === '100001' &&
              shSsa.status === 200 && hrSsa.status === 200 && rSsa.data.view === 'full' &&
              rSsa.data.staff.some(function (x) { return x.key === 'bob9twin'; }) && ssaWrites.every(shape) &&
              notes.grid.length === notesBefore && createdRows.length === rowsBefore,
              JSON.stringify([oSsa.status, shSsa.status, hrSsa.status, ssaWrites]));

    visibleWhy = 'The IST records could not be read (st).';
    var rShort = HUB_ACTIONS.staffProfileRoster({}, kid);
    visibleBroken = true;
    var rBroken = HUB_ACTIONS.staffProfileRoster({}, kid);
    var oBroken = HUB_ACTIONS.staffProfileOverview({ staff: 'ann9lee' }, kid);
    visibleBroken = false;
    visibleWhy = '';
    staffProfilesPerson_ = function () {
      return { refused: { status: 503, message: 'The staff sources could not be read just now (st: the People book id)' } };
    };
    var oSources = HUB_ACTIONS.staffProfileOverview({ staff: 'ann9lee' }, kid);
    staffProfilesPerson_ = function (k) { looked.push(k); return keep.person(k); };
    stAssert_(out, P + 'viewer scope: a source behind the staff a house sees that could not be read says the list may be ' +
                   'short without naming it; one that throws shows no one and opens no one; a person the sources could ' +
                   'not read is 503 without the sources\' words',
              rShort.status === 200 && rShort.data.staff.length === 2 && rShort.data.degraded === true &&
              /may be short/.test(rShort.data.why) && rShort.data.why.indexOf('IST records') === -1 &&
              rBroken.status === 200 && rBroken.data.staff.length === 0 && rBroken.data.degraded === true &&
              oBroken.status === 404 && oBroken.message === SP_NO_STAFF &&
              oSources.status === 503 && oSources.message.indexOf('People book') === -1,
              JSON.stringify([rShort.data, rBroken.data, oBroken, oSources]));

    // the real gate end to end: STAFF on the released app reads the whole record, on the unreleased one nothing
    hubProfileAppGate_ = keep.appGate;
    APP_RULES = { rules: {}, tenants: {} };
    APP_RULES.rules[SP_APP_ID] = ['STAFF'];
    fresh();
    var oSally = HUB_ACTIONS.staffProfileOverview({ staff: 'ann9lee' }, sally);
    var rSally = HUB_ACTIONS.staffProfileRoster({}, sally);
    var nSally = HUB_ACTIONS.staffProfileNoteAdd({ staff: 'ann9lee', details: 'x' }, sally);
    APP_RULES = { rules: {}, tenants: {} };
    var oShut = HUB_ACTIONS.staffProfileOverview({ staff: 'ann9lee' }, sally);
    stAssert_(out, P + 'viewer scope: through the real gate, STAFF on the released app reads the whole profile and roster ' +
                   'and files no note; with the row gone the same account gets the exact 404',
              oSally.status === 200 && oSally.data.person.phones.length === 2 && !oSally.data.view &&
              rSally.status === 200 && rSally.data.view === 'full' && shape(nSally) && shape(oShut) &&
              notes.grid.length === notesBefore,
              JSON.stringify([oSally.status, rSally.data && rSally.data.view, nSally, oShut]));
    staffProfilesPerson_ = keep.person;
    hubStaffVisibleForHouses_ = keep.visible;
    hubStaffScheduledForHouses_ = keep.scheduled;

    // ---- 16. the record edit ----
    var editKeep = { lock: LockService, hubSheet: hubSheet_, ensureCols: ensureUserProfileColumns_ };
    var book = stSpMasterGrid_();
    var bookSheet = stLocSheet_(book);
    var bookRange = bookSheet.getRange;
    bookSheet.getRange = function (r, c, nr, nc) {
      var rg = bookRange(r, c, nr, nc);
      rg.getFormula = function () { return ''; };
      return rg;
    };
    var acctSheet = stLocSheet_([
      ['user_id', 'email', 'phone', 'phones', 'emails', 'avatar'],
      ['U1', 'ann9.lee@example.org', '(330) 555-0111', '[{"label":"Mobile","number":"(330) 555-0111"}]', 'ann9.home@example.org',
       'https://img/ann.png']
    ]);
    try {
      LockService = { getScriptLock: function () {
        return { tryLock: function () { return true; }, waitLock: function () {}, releaseLock: function () {} };
      } };
      empDbId_ = function () { return 'st-empdb-book'; };
      emp360MasterTab_ = function () { return 'Master'; };
      ssOpen_ = function (id) {
        if (id !== 'st-empdb-book') throw new Error('st: no book ' + id);
        return { getSheetByName: function (t) { return t === 'Master' ? bookSheet : null; },
                 getSpreadsheetTimeZone: function () { return 'America/New_York'; } };
      };
      hubSheet_ = function () { return acctSheet; };
      ensureUserProfileColumns_ = function () {};
      CacheService.getScriptCache().put('ver_' + cacheScopeSheet_('st-empdb-book', 'Master'), 'st' + (++verSeq), 21600);
      fresh();
      var col = function (h) { return book[0].indexOf(h); };
      var other = { email: 'admin@example.org', role: 'admin' };
      var notMaster = HUB_ACTIONS.staffProfileEdit({ key: 'ann9lee', changes: [{ field: 'zip', value: '1', expected: '44708' }] }, other);
      var empRead = HUB_ACTIONS.staffProfileEmployment({ staff: 'ann9lee' }, master);
      var empOther = spWithEdit_({ status: 200, data: { a: 1 } }, staffProfilesPerson_('ann9lee'), other, 'employment');
      stAssert_(out, P + 'edit: another admin gets the exact 404 and nothing is written; the master\'s read carries the raw ' +
                     'cell each field is witnessed by, no other viewer\'s does',
                shape(notMaster) && book[1][col('Zip')] === '44708' && empRead.status === 200 &&
                empRead.data.edit.start_first_day === '01/10/2024' && empRead.data.edit.job_app_date === '12/20/2023' &&
                !('ssn' in empRead.data.edit) && !('dob' in empRead.data.edit) && !('edit' in empOther.data),
                JSON.stringify([notMaster, empRead.data && empRead.data.edit, empOther]));

      logged = [];
      var stale = HUB_ACTIONS.staffProfileEdit({ key: 'ann9lee', changes: [{ field: 'zip', value: '44709', expected: '44000' }] }, master);
      stAssert_(out, P + 'edit: a stale witness is 409 with what the cell holds now, and nothing is written or logged',
                stale.status === 409 && stale.data.current.zip === '44708' && stale.data.written.length === 0 &&
                book[1][col('Zip')] === '44708' && logged.filter(function (l) { return /^staffProfileEdit:/.test(l); }).length === 0,
                JSON.stringify([stale, logged]));

      var locked = HUB_ACTIONS.staffProfileEdit({ key: 'ann9lee', changes: ['first_name', 'employee_id', 'role', 'ssn', 'dob', 'dl',
        'bci_fbi'].map(function (f) { return { field: f, value: 'x', expected: '' }; }) }, master);
      stAssert_(out, P + 'edit: a rename, the payroll id, the synced role and the protected fields are refused with a reason; ' +
                     'nothing is written',
                locked.status === 200 && locked.data.written.length === 0 && locked.data.refused.length === 7 &&
                locked.data.refused.every(function (r) { return r.why.length > 10; }) && book[1][col('First Name')] === 'Ann9' &&
                book[1][col('Employee ID')] === '100001', JSON.stringify(locked));

      logged = [];
      var ok = HUB_ACTIONS.staffProfileEdit({ key: 'ann9lee', changes: [
        { field: 'start_first_day', value: '2024-01-12', expected: '01/10/2024' },
        { field: 'phone', value: '(330) 555-0177', expected: '(330) 555-0101' },
        { field: 'account_phones', value: 'Mobile: (330) 555-0188', expected: 'Mobile: (330) 555-0111' },
        { field: 'login_email', value: 'ann9.new@example.org', expected: 'ann9.lee@example.org' }
      ] }, master);
      var line = logged.filter(function (l) { return /^staffProfileEdit:/.test(l); });
      stAssert_(out, P + 'edit: each field lands in its own store — a start date on its own column (the two start dates ' +
                     'fold to one key), the Master phone, the account phones — and the sign-in email waits for its ' +
                     'confirmation; the audit line names the fields and carries no contact value',
                ok.status === 200 && ok.data.written.join() === 'start_first_day,phone,account_phones' &&
                ok.data.refused.length === 1 && ok.data.refused[0].field === 'login_email' &&
                book[1][col('Start Date (first day)')] === '2024-01-12' && book[1][col('Start Date(doc)')] === '01/02/2024' &&
                book[1][col('Phone Number')] === '(330) 555-0177' &&
                acctSheet.grid[1][3] === '[{"label":"Mobile","number":"(330) 555-0188"}]' &&
                acctSheet.grid[1][2] === '(330) 555-0188' && acctSheet.grid[1][1] === 'ann9.lee@example.org' &&
                line.length === 1 && line[0].indexOf('start_first_day "01/10/2024" → "2024-01-12"') !== -1 &&
                !/555-01(77|88|01|11)/.test(logged.join(' ')),
                JSON.stringify([ok, logged, acctSheet.grid[1]]));

      var taken = HUB_ACTIONS.staffProfileEdit({ key: 'ann9lee', confirm_login_email: true,
        changes: [{ field: 'login_email', value: 'b1@example.org', expected: 'ann9.lee@example.org' }] }, master);
      var moved = HUB_ACTIONS.staffProfileEdit({ key: 'ann9lee', confirm_login_email: true,
        changes: [{ field: 'login_email', value: 'Ann9.New@example.org', expected: 'ann9.lee@example.org' }] }, master);
      stAssert_(out, P + 'edit: the sign-in email moves only confirmed and only to an address no other account signs in with',
                taken.status === 200 && taken.data.refused.length === 1 && /Another account/.test(taken.data.refused[0].why) &&
                moved.status === 200 && moved.data.written.join() === 'login_email' &&
                acctSheet.grid[1][1] === 'ann9.new@example.org', JSON.stringify([taken, moved]));
    } finally {
      LockService = editKeep.lock;
      hubSheet_ = editKeep.hubSheet;
      ensureUserProfileColumns_ = editKeep.ensureCols;
      ssOpen_ = keep.ssOpen;
      empDbId_ = keep.empDb;
      emp360MasterTab_ = keep.masterTab;
    }

    // ---- no delete anywhere ----
    var fns = Object.keys(g).filter(function (k) { return /^(sp[A-Z]|staffProfiles)/.test(k) && typeof g[k] === 'function'; });
    var deleting = [];
    fns.map(function (k) { return [k, g[k]]; }).concat(SP_ACTIONS.map(function (a) { return [a, HUB_ACTIONS[a]]; }))
      .forEach(function (pair) {
        if (/deleteRows?\(|deleteRowById_|deleteSheet|clearContents?\(|\.clear\(|setTrashed|api\.delete/.test(stCode_(pair[1]))) {
          deleting.push(pair[0]);
        }
      });
    stAssert_(out, P + 'no Staff code path deletes, clears or trashes anything',
              fns.length >= 30 && deleting.length === 0, 'functions=' + fns.length + ' deleting=' + deleting.join());
  } finally {
    staffProfilesPerson_ = keep.person;
    HUB_MASTER_EMAIL_CACHE = keep.masterCache;
    HUB_MEMBER_CTX = keep.member;
    hubSysLog_ = keep.log;
    hubTabEnsure_ = keep.ensure;
    hubTabSheet_ = keep.sheet;
    sheetDbGateHolds_ = keep.holds;
    estateRows_ = keep.estate;
    listRows_ = keep.listRows;
    peopleMerged_ = keep.merged;
    withoutIspClients_ = keep.noIsp;
    clientsDerived_ = keep.derived;
    clientPhotoIndex_ = keep.photoIdx;
    usersAll_ = keep.users;
    spMasterIndex_ = keep.masterIdx;
    locationsCalendar_ = keep.cal;
    locationsPunches_ = keep.punches;
    locationsHomes_ = keep.homes;
    hubCalendarManagers_ = keep.managers;
    locationsToday_ = keep.today;
    spDriveDocs_ = keep.drive;
    staffDocsFor_ = keep.staffDocs;
    complianceDocsRows_ = keep.uploads;
    packetMirrorRows_ = keep.packet;
    certPicture_ = keep.cert;
    certMatrixColumns_ = keep.certCols;
    certExpiringDays_ = keep.certDays;
    reqStatesListValues_ = keep.reqValues;
    requirementsAll_ = keep.reqAll;
    hubLineRow_ = keep.lineRow;
    hubLineOurs_ = keep.lineOurs;
    hubId_ = keep.hubId;
    ssOpen_ = keep.ssOpen;
    commCallsTranscriptRead_ = keep.callsRead;
    locationsDocBytes_ = keep.bytes;
    locationsHouse_ = keep.house;
    istHouseMap_ = keep.istMap;
    createRow_ = keep.createRow;
    locationsLock_ = keep.lock;
    beAnotherActive_ = keep.beAnother;
    istCertNote_ = keep.istNote;
    perfReadSoft_ = keep.perf;
    empDbId_ = keep.empDb;
    emp360MasterTab_ = keep.masterTab;
    spTranscriptsBuild_ = keep.transBuild;
    certReadTab_ = keep.certTab;
    hubProfileAppRules_ = keep.appRules;
    hubProfileAppGate_ = keep.appGate;
    hubStaffVisibleForHouses_ = keep.visible;
    hubStaffScheduledForHouses_ = keep.scheduled;
    hubViewerClientScope_ = keep.clientScope;
    HUB_VIEWER_MEMO = keep.viewerMemo;
    // no fixture answer outlives the test under a key a real read could ask for
    fresh();
  }
  stElMirrorShare_(out);
  stStaffAddress_(out);
}

// Employee Pay's house reaches the relay mirror: the reader is granted and the header cell written back once per…
function stElMirrorShare_(out) {
  var P = 'staff profiles: employee loans: ';
  var keep = { houseId: houseIdFor_, grant: hubGrantReader_, sheet: elSheet_, holds: sheetDbGateHolds_, log: hubSysLog_ };
  var props = PropertiesService.getScriptProperties();
  var cache = CacheService.getScriptCache();
  var before = props.getProperty(EL_MIRRORED_PROP);
  var grid = [['id', 'kind']], writes = [], grants = [], logged = [];
  var grantOk = false, held = false, house = 'BOOK_EL1';
  try {
    houseIdFor_ = function (tab) { return tab === EL_TAB ? house : ''; };
    hubGrantReader_ = function (file, who, said) {
      grants.push(file.getId() + ' ' + who);
      if (said) { said.ok = grantOk; said.reason = grantOk ? '' : 'Drive answered 403'; }
      return grantOk;
    };
    elSheet_ = function () {
      return { getRange: function (r, c) {
        return { getValue: function () { return grid[r - 1][c - 1]; },
                 setValue: function (v) { writes.push(r + ',' + c + '=' + v); grid[r - 1][c - 1] = v; } };
      } };
    };
    sheetDbGateHolds_ = function () { return held ? { error: { status: 409, message: 'held' } } : null; };
    hubSysLog_ = function (who, ev, what) { logged.push(ev + ' ' + what); return true; };
    props.deleteProperty(EL_MIRRORED_PROP);
    cache.remove(EL_SHARE_TRY_KEY);
    var refused = elShareMaybe_();
    var throttled = elShareMaybe_();
    var afterRefusal = [grants.length, writes.length, props.getProperty(EL_MIRRORED_PROP), logged.slice()];
    cache.remove(EL_SHARE_TRY_KEY);
    held = true;
    var funnel = elShareMaybe_();
    var whileHeld = [grants.length, writes.length];
    cache.remove(EL_SHARE_TRY_KEY);
    held = false;
    grantOk = true;
    var granted = elShareMaybe_();
    var remembered = props.getProperty(EL_MIRRORED_PROP), touched = writes.join();
    cache.remove(EL_SHARE_TRY_KEY);
    var again = elShareMaybe_();
    var afterSuccess = [grants.length, writes.length];
    cache.remove(EL_SHARE_TRY_KEY);
    house = 'BOOK_EL2';
    elShareMaybe_();
    stAssert_(out, P + 'the house is let in to the relay mirror and its header cell written back with what it held, ' +
                   'once per house: a refusal writes nothing, is said and is never claimed; a held funnel neither ' +
                   'grants nor writes; a success is remembered by the house id and a re-minted house asks again',
              !refused.ok && throttled.waiting === true && afterRefusal[0] === 1 && afterRefusal[1] === 0 &&
              afterRefusal[2] === null && afterRefusal[3].length === 1 &&
              /^employee_loans_not_shared /.test(afterRefusal[3][0]) && /403/.test(afterRefusal[3][0]) &&
              funnel.held === true && whileHeld[0] === 1 && whileHeld[1] === 0 &&
              granted.ok === true && grants[1] === 'BOOK_EL1 ' + EL_READER && touched === '1,1=id' &&
              grid[0][0] === 'id' && remembered === 'BOOK_EL1' && again.already === true &&
              afterSuccess.join() === '2,1' && grants.length === 3 && grants[2] === 'BOOK_EL2 ' + EL_READER &&
              writes.length === 2 &&
              props.getProperty(EL_MIRRORED_PROP) === 'BOOK_EL2' && logged.length === 1,
              JSON.stringify([grants, writes, logged, remembered]));
  } finally {
    houseIdFor_ = keep.houseId;
    hubGrantReader_ = keep.grant;
    elSheet_ = keep.sheet;
    sheetDbGateHolds_ = keep.holds;
    hubSysLog_ = keep.log;
    // the live remembered grant is what it was before the test
    if (before === null) props.deleteProperty(EL_MIRRORED_PROP);
    else props.setProperty(EL_MIRRORED_PROP, before);
    cache.remove(EL_SHARE_TRY_KEY);
  }
}

/** My Profile's own address: who it is for is the session's, only the four Master columns move, each witnessed. */
function stStaffAddress_(out) {
  var P = 'staff profiles, own address: ';
  var keep = { gate: hubProfileAppGate_, self: complianceDocsSelf_, person: staffProfilesPerson_,
               master: staffProfilesMaster_, write: emp360WriteCell_, log: hubSysLog_, bump: staffProfilesBump_,
               member: HUB_MEMBER_CTX };
  var ctxOf = function (over) {
    var c = { key: 'ann9lee', name: 'Ann9 Lee', people: { id: 'people:P1' }, account: null, master_why: '',
              master: { employee_id: 'E1', address: '1 Elm St', city: 'Akron', state: 'OH', zip: '44301' },
              master_edit: { address: '1 Elm St', city: 'Akron', state: 'OH', zip: '44301' },
              master_cols: { address: { at: 9, head: 'Address' }, city: { at: 10, head: 'City' },
                             state: { at: 11, head: 'State' }, zip: { at: 12, head: 'Zip Code' } } };
    Object.keys(over || {}).forEach(function (k) { c[k] = over[k]; });
    return c;
  };
  var ann = { id: 'u-ann9', email: 'ann9@asa.test', role: 'staff', display_name: 'Ann9 Lee' };
  var boss = { id: 'u-boss9', email: 'boss9@asa.test', role: 'admin', display_name: 'The Boss' };
  var gateOpen = true, selfAnswer = null, people = {}, asked = [], writes = [], logged = [], bumped = [];
  try {
    HUB_MEMBER_CTX = null;
    hubProfileAppGate_ = function (app, u) { return { open: gateOpen && app === 'my-profile' && !!u, scope: { kind: 'all' } }; };
    complianceDocsSelf_ = function () { return selfAnswer; };
    staffProfilesPerson_ = function (key) {
      asked.push(key);
      return people[key] || { refused: { status: 404, message: SP_NO_STAFF } };
    };
    staffProfilesMaster_ = function (u) { return !!u && u.id === 'u-boss9'; };
    emp360WriteCell_ = function (payload, user, allow, at) {
      writes.push({ payload: payload, allow: allow, at: at, by: user.email });
      return { status: 200, data: { field: payload.field, value: payload.value } };
    };
    hubSysLog_ = function (who, kind, target) { logged.push(kind + ':' + target); return true; };
    staffProfilesBump_ = function (action, key) { bumped.push(action + ':' + key); };
    var settled = { key: 'ann9lee', id: 'P1', status: 200, why: '', bridged: false };

    var bad = [['address', '12 Maple St', ''], ['address', '12345', SP_ADDRESS_WORDS.address], ['address', '', SP_ADDRESS_WORDS.blank],
               ['city', 'O\'Fallon', ''], ['city', 'Akron 2', SP_ADDRESS_WORDS.city], ['state', 'OH', ''],
               ['state', 'XX', SP_ADDRESS_WORDS.state], ['state', 'oh', SP_ADDRESS_WORDS.state], ['zip', '44301', ''],
               ['zip', '44301-1234', ''], ['zip', '4430', SP_ADDRESS_WORDS.zip], ['phone', '5550101', SP_ADDRESS_WORDS.only]]
      .filter(function (t) { return spAddressBad_(t[0], t[1]) !== t[2]; });
    stAssert_(out, P + 'a value is taken only as a street with a letter, a city in words, a two-capital US state and a ' +
                   '5-digit or ZIP+4 zip; a blank or another field never', bad.length === 0, JSON.stringify(bad));

    people.ann9lee = ctxOf();
    selfAnswer = settled;
    var shut = [
      HUB_ACTIONS.staffProfileAddress({}, null), HUB_ACTIONS.staffProfileAddress({}, { email: 'svc', is_service: true }),
      HUB_ACTIONS.staffProfileAddress({}, { id: 'u-ann9', role: 'staff', visiting_member: 'mem_1' })
    ];
    gateOpen = false;
    shut.push(HUB_ACTIONS.staffProfileAddress({}, ann));
    gateOpen = true;
    var others = HUB_ACTIONS.staffProfileAddress({ key: 'bob9twin' }, ann);
    var otherWrite = HUB_ACTIONS.staffProfileAddressEdit({ key: 'bob9twin',
      changes: [{ field: 'city', value: 'Canton', expected: 'Akron' }] }, ann);
    stAssert_(out, P + 'no session, the service identity, a visit and an account App Control does not open My Profile to ' +
                   'are refused; a key sent by anyone but the master is refused before any record is looked up',
              shut.map(function (r) { return r.status; }).join() === '403,403,403,403' &&
              shut[2].message === SP_ADDRESS_WORDS.visit && shut[3].message === SP_ADDRESS_WORDS.gate &&
              others.status === 403 && others.message === SP_ADDRESS_WORDS.others && otherWrite.status === 403 &&
              asked.length === 0 && writes.length === 0, JSON.stringify([shut, others, otherWrite, asked]));

    selfAnswer = { key: '', id: '', status: 403, why: 'Your account is not linked to a roster row.', bridged: false };
    var unsettled = HUB_ACTIONS.staffProfileAddress({}, ann);
    selfAnswer = { key: 'ann9lee', id: 'P1', status: 200, why: '', bridged: true };
    var bridged = HUB_ACTIONS.staffProfileAddress({}, ann);
    selfAnswer = settled;
    people.ann9lee = ctxOf({ people: { id: 'people:P9' } });
    var otherRow = HUB_ACTIONS.staffProfileAddress({}, ann);
    stAssert_(out, P + 'an own record the ledger cannot settle says why, one reached only through a roster e-mail is ' +
                   'refused, and a staff record that is not the settled roster row is nobody\'s',
              unsettled.status === 403 && unsettled.message === 'Your account is not linked to a roster row.' &&
              bridged.status === 403 && bridged.message === SP_ADDRESS_WORDS.bridged &&
              otherRow.status === 409 && otherRow.message === SP_ADDRESS_WORDS.untold,
              JSON.stringify([unsettled, bridged, otherRow]));

    people.ann9lee = ctxOf();
    logged = [];
    var own = HUB_ACTIONS.staffProfileAddress({}, ann);
    var d = own.data || {};
    people.bob9twin = ctxOf({ key: 'bob9twin', name: 'Bob9 Twin', master: null, master_edit: null,
                              master_why: 'two Master rows share this name, so neither is read' });
    var theirs = HUB_ACTIONS.staffProfileAddress({ key: 'bob9twin' }, boss);
    stAssert_(out, P + 'the own answer carries the Master\'s four parts, the raw cells the save is witnessed by and the ' +
                   'staff key, unlogged; the master\'s read of another person is logged, and a person with no Master row ' +
                   'is answered shut with the reason',
              own.status === 200 && d.own === true && d.staff_key === 'ann9lee' && d.read === true && d.allowed === true &&
              d.address.address === '1 Elm St' && d.address.zip === '44301' && d.edit.city === 'Akron' &&
              theirs.status === 200 && theirs.data.own === false && theirs.data.read === false &&
              theirs.data.allowed === false && theirs.data.why === 'two Master rows share this name, so neither is read' &&
              logged.join() === 'staffProfileAddress:bob9twin', JSON.stringify([own, theirs, logged]));

    logged = [];
    bumped = [];
    writes = [];
    var saved = HUB_ACTIONS.staffProfileAddressEdit({ changes: [
      { field: 'city', value: 'Canton', expected: 'Akron' }, { field: 'state', value: 'pa', expected: 'OH' },
      { field: 'zip', value: '4470', expected: '44301' }, { field: 'phone', value: '330-555-0101', expected: '' }] }, ann);
    var w = writes.map(function (x) {
      return [x.payload.employeeId, x.payload.field, x.payload.value, x.payload.expected, x.allow, x.at].join('|');
    });
    stAssert_(out, P + 'a save writes the changed address cells on the caller\'s own Master row, each witnessed and the ' +
                   'state in capitals; a bad zip and any other field are refused with the reason; the HR read is retired ' +
                   'and the audit line names the fields, never the address',
              saved.status === 200 && saved.data.written.join() === 'city,state' && saved.data.staff_key === 'ann9lee' &&
              saved.data.refused.length === 2 && saved.data.refused[0].why === SP_ADDRESS_WORDS.zip &&
              saved.data.refused[1].why === SP_ADDRESS_WORDS.only &&
              w.join() === 'E1|City|Canton|Akron|true|10,E1|State|PA|OH|true|11' &&
              bumped.join() === 'staffProfileHr:ann9lee' && logged.join() === 'staffProfileAddressEdit:ann9lee: city, state',
              JSON.stringify([saved, w, bumped, logged]));

    emp360WriteCell_ = function () { return { status: 409, message: 'Someone changed this row since you opened it — reloaded.',
                                               data: { current: 'Kent' } }; };
    bumped = [];
    var stale = HUB_ACTIONS.staffProfileAddressEdit({ changes: [{ field: 'city', value: 'Canton', expected: 'Akron' }] }, ann);
    stAssert_(out, P + 'a cell changed since the panel opened is not written: 409 with what it holds now, nothing retired',
              stale.status === 409 && stale.data.current.city === 'Kent' && stale.data.written.length === 0 &&
              bumped.length === 0, JSON.stringify([stale, bumped]));
  } finally {
    hubProfileAppGate_ = keep.gate;
    complianceDocsSelf_ = keep.self;
    staffProfilesPerson_ = keep.person;
    staffProfilesMaster_ = keep.master;
    emp360WriteCell_ = keep.write;
    hubSysLog_ = keep.log;
    staffProfilesBump_ = keep.bump;
    HUB_MEMBER_CTX = keep.member;
  }
}
