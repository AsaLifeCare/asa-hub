// Support Requests: the policies and the seeds, the queue's key against the Python's own vectors, the type and its…
function stSupportDesk_(out) {
  var P = 'support desk: ';
  var G = (typeof globalThis !== 'undefined') ? globalThis : this;

  // ---- a day-only request takes its call's instant, on that day only ----
  var keptTimes = SD_MEMO.__call_times;
  SD_MEMO.__call_times = { AC1: '2026-10-07T14:43:50.616Z', AC2: '2026-10-08T14:00:00Z' };
  var rcv = function (when, notes) { return sdReceivedOf_({ date_received: when, notes: notes }); };
  stAssert_(out, P + 'a request the hotline wrote as a bare day is received at its call\'s own time, never at 12:00 AM; ' +
                 'a call of another day, a missing call and a cell with its own time keep the cell',
            rcv('10/7/2026', 'Call ID: AC1') === '2026-10-07T14:43:50.616Z' &&
            rcv('10/7/2026', 'Call ID: AC2') === '10/7/2026' && rcv('10/7/2026', 'no call') === '10/7/2026' &&
            rcv('2026-10-07T09:00:00Z', 'Call ID: AC1') === '2026-10-07T09:00:00Z',
            JSON.stringify([rcv('10/7/2026', 'Call ID: AC1'), rcv('10/7/2026', 'Call ID: AC2')]));
  if (keptTimes === undefined) delete SD_MEMO.__call_times; else SD_MEMO.__call_times = keptTimes;

  // ---- declarations ----
  var WIDE = '["admin","director","manager","staff"]';
  var SENDS = { supportDeskDecide: true, supportDeskPunch: true };
  var bad = [];
  SD_ACTIONS.forEach(function (a) {
    var p = HUB_POLICY[a];
    if (!p || p.file !== 'SupportDesk.gs' || typeof HUB_ACTIONS[a] !== 'function') { bad.push(a + ': undeclared'); return; }
    if (p.store !== 'sheet' || (p.lane !== 'read' && p.lane !== 'tool')) bad.push(a + ': lane/store ' + p.lane + '/' + p.store);
    if (JSON.stringify(p.roles) !== WIDE) bad.push(a + ': roles ' + JSON.stringify(p.roles));
    if ((p.invalidates || []).length) bad.push(a + ': invalidates');
    if (JSON.stringify(p.emits || []) !== (SENDS[a] ? '["smsSend"]' : '[]')) bad.push(a + ': emits ' + JSON.stringify(p.emits));
    var params = p.params || {};
    Object.keys(params).forEach(function (k) {
      if (!params[k] || !params[k].type || params[k].required) bad.push(a + ': ' + k + ' untyped or required at the door');
    });
  });
  stAssert_(out, P + 'nine actions in SupportDesk.gs, the wide roles (the gate decides), typed params, no slice, and ' +
                 'smsSend declared exactly on decide and the punch door',
            bad.length === 0 && SD_ACTIONS.length === 9 && HUB_POLICY.supportDeskList.lane === 'read' &&
            HUB_POLICY.myCalendarVacationRoute.lane === 'read' && HUB_POLICY.supportDeskSeat.lane === 'read' &&
            HUB_POLICY.supportDeskDecide.params.to.type === 'string', bad.join('; '));

  var seeds = {};
  SMART_EXTRA_SITUATIONS_SEED.forEach(function (s) { seeds[s.id] = s; });
  var seedBad = [];
  SD_SITUATIONS.forEach(function (id) {
    var s = seeds[id];
    if (!s) { seedBad.push(id + ' absent'); return; }
    if (s.enabled !== 'yes' || s.kind !== 'letter' || s.channels !== 'sms' || s.to !== '' || !String(s.sms_text || '').trim()) {
      seedBad.push(id + ' ' + s.enabled + '/' + s.kind + '/' + s.channels);
    }
    if (/\{(reason|summary_of_incident|ssn)\}/.test(String(s.sms_text))) seedBad.push(id + ' can carry a reason or a report');
    if (/[^\x00-\x7F]/.test(String(s.sms_text))) seedBad.push(id + ' leaves the GSM alphabet');
  });
  var code = [];
  for (var gn in G) {
    if (/^(sd[A-Z]|supportDesk|supportInbox|myCalendarVacation)/.test(gn) && typeof G[gn] === 'function') {
      code.push({ n: gn, c: stCode_(G[gn]) });
    }
  }
  SD_ACTIONS.forEach(function (a) { code.push({ n: a, c: stCode_(HUB_ACTIONS[a]) }); });
  var used = {};
  code.forEach(function (f) {
    (f.c.match(/'sr_[a-z_]+'/g) || []).forEach(function (m) { used[m.slice(1, -1)] = true; });
  });
  Object.keys(used).forEach(function (id) { if (!seeds[id]) seedBad.push(id + ' is said but never seeded'); });
  stAssert_(out, P + 'the four sr_* situations are seeded ON as SMS letters with no Goes to, ASCII only, carry no ' +
                 'reason or report, and every situation the code names is seeded',
            seedBad.length === 0 && SD_SITUATIONS.length === 4 && Object.keys(used).length === 4, seedBad.join('; '));

  var forbidden = code.filter(function (f) {
    return /\b(rpcCall_|commCallOffRecorded_|rpcOpenPhoneSms_|schedInbox_|hubLetterSend_|schedFlowAnswerLocked_|schedFlowKick_)\s*\(/.test(f.c) ||
           /insertSheet/.test(f.c) || /\buserUpdate\b|\bprofileUpdate\b/.test(f.c);
  }).map(function (f) { return f.n; });
  stAssert_(out, P + 'no Support Requests function knocks the send door, files a call-off, writes Scheduling\'s items, ' +
                 'answers below Scheduling\'s own door, makes a tab or calls the account doors; smartTell_ says every text',
            forbidden.length === 0 && code.length > 40 && /\bsmartTell_\s*\(/.test(stCode_(sdTell_)),
            forbidden.join(', ') + ' / ' + code.length + ' scanned');

  // ---- the hooks are wired, one guarded line each ----
  var attendance = stCode_(HUB_ACTIONS.staffAttendancePunch);
  var h1 = attendance.indexOf("typeof supportDeskAttendance_ === 'function'");
  var sweepMail = stCode_(HUB_ACTIONS.staffAttendanceSweep);
  var shift = stCode_(HUB_ACTIONS.staffShiftReminder);
  var hot = stCode_(HUB_ACTIONS.hotlineSweep);
  var est = stCode_(estateRoute_);
  var hired = stCode_(HUB_ACTIONS.hiringSweep);
  stAssert_(out, P + 'the seven hooks sit where they hear: attendance before the ledger read, the mailbox after its key, ' +
                 'the shift rows before the quiet check, the queue and the incidents after they land, the platform ' +
                 'form after its append, the clock left hiringSweep for Python\'s (app/support_desk_clock*) — each ' +
                 'guarded and wrapped',
            h1 !== -1 && h1 < attendance.indexOf('smartAlreadySent_') &&
            /if \(fresh && ledgerKey && typeof supportDeskAttendanceMail_ === 'function'\) supportDeskAttendanceMail_\(parsed, ledgerKey, dayIso\)/.test(sweepMail) &&
            shift.indexOf('supportDeskShiftRow_(kind, r)') !== -1 &&
            shift.indexOf('supportDeskShiftRow_(kind, r)') < shift.indexOf('if (quiet)') &&
            hot.indexOf('supportDeskFiled_(requests.slice(0, queued.landed)') > hot.indexOf("hotlineEstateAppendRows_('supportQueue'") &&
            hot.indexOf("supportDeskIncidents_(incidentRows.slice(0, filedIncidents.landed), 'hotline')") >
              hot.indexOf("hotlineEstateAppendRows_('uiIncidents'") &&
            /resource === 'uiIncidents' && typeof supportDeskIncidents_ === 'function'/.test(est) &&
            hired.indexOf('supportDeskTick_()') === -1, '');

  // ---- the queue's key: the Python's own vectors (tools/test-my-work.py pins the same) ----
  var V = [
    ['Ty Bond', 'Operations - Vehicle Issue', 'Van broke down on Route 62, stranded with client', '2026-01-27T15:04:00Z',
     'ty bond|operations - vehicle issue|van broke down on route 62, stranded with client|2026-01-27', 'HQ5EF1CB5F25'],
    ['Angel Fiber', 'Payroll', 'Missing paycheck for last week', '9/16/2026',
     'angel fiber|payroll|missing paycheck for last week|2026-09-16', 'HQ6EEF063DEE'],
    ['', 'Other - General Requests', 'Caller reached voicemail and left no details.', '2026-09-18',
     '|other - general requests|caller reached voicemail and left no details.|2026-09-18', 'HQ82D0D7C86E'],
    ['Joan Cheruiyot', 'ADP - Update Information', '  New e-mail: AbC123@Gmail.com  ', 'not a date',
     'joan cheruiyot|adp - update information|new e-mail: abc123@gmail.com|not a date', 'HQD1BC183BB5'],
    ['Maria Lopez', 'Schedule - Call Off', 'Calling off tonight, sick child', '2026-09-18T02:30:00Z',
     'maria lopez|schedule - call off|calling off tonight, sick child|2026-09-17', 'HQDDED74CB55']
  ];
  var vecBad = [];
  V.forEach(function (v) {
    var k = sdQueueKey_(v[0], v[1], v[2], v[3]);
    if (k !== v[4]) vecBad.push('key ' + k);
    if ('HQ' + sdSha10_(k) !== v[5]) vecBad.push('ref ' + sdSha10_(k) + ' for ' + v[5]);
  });
  var dateCell = sdQueueKey_('Maria Lopez', 'Schedule - Call Off', 'Calling off tonight, sick child',
                             new Date('2026-09-18T02:30:00Z'));
  var inKey = sdIncidentKey_({ timestamp: '2026-09-27T19:54:00.000Z', your_name: 'Jane Doe', client_name: 'John Client',
                               incident_category: 'Minor injury' });
  var inDate = sdIncidentKey_({ timestamp: new Date('2026-09-27T19:54:00Z'), your_name: 'Jane Doe',
                                client_name: 'John Client', incident_category: 'Minor injury' });
  stAssert_(out, P + 'the HQ key and ref are byte-identical to the Python on all five vectors, a Date cell is its Ohio ' +
                 'day, and the incident key is IN22AECE9878 whether the cell is text or a Date',
            vecBad.length === 0 && dateCell === V[4][4] && inKey === 'IN22AECE9878' && inDate === inKey &&
            sdIncidentKey_({ timestamp: '', your_name: 'x' }) === '' && sdNthRef_('HQ1', 2) === 'HQ1-2' &&
            sdNthRef_('HQ1', 1) === 'HQ1', vecBad.join('; ') + ' / ' + dateCell + ' / ' + inKey + ' / ' + inDate);

  // ---- the type and its route ----
  var tp = sdTypeParts_('Operations - Vehicle Issue');
  stAssert_(out, P + 'a type is split on its first " - " and shown "Area · Label"; no separator is the label alone; ' +
                 'blank is Other',
            tp.area === 'Operations' && tp.label === 'Vehicle Issue' && tp.display === 'Operations · Vehicle Issue' &&
            sdTypeParts_('Payroll').display === 'Payroll' && sdTypeParts_('Payroll').area === '' &&
            sdTypeParts_('  ').display === 'Other' && sdTypeParts_('A - B - C').label === 'B - C' &&
            sdTypeOfCategory_('Attendance · Late Show').area === 'Attendance', JSON.stringify(tp));
  stAssert_(out, P + 'the route is matched through the hotline\'s own type key (case, punctuation and plurals), a ' +
                 'call-off is Scheduling\'s, and a type in no route has none',
            sdRouteOf_('operations - vehicle issues') === 'vehicle' && sdRouteOf_('Van Calendar') === 'vehicle' &&
            sdRouteOf_('ADP - Pay Stub') === 'payroll' && sdRouteOf_('PSI - Time Entries') === 'payroll' &&
            sdRouteOf_('Other - General Request') === 'general' && sdRouteOf_('ADP - Update Information') === 'adp_update' &&
            sdRouteOf_('Training - CPR') === '' && sdRouteOf_('') === '' && sdIsCallOff_('Schedule - Call Off') &&
            sdIsCallOff_('schedule-call offs') && !sdIsCallOff_('Schedule - Shift Changes') &&
            sdUrgency_('Mid') === 'Medium' && sdUrgency_('medium') === 'Medium' && sdUrgency_('High') === 'High',
            [sdRouteOf_('operations - vehicle issues'), sdRouteOf_('ADP - Pay Stub')].join(','));

  // ---- the switches ----
  var autoKeys = Object.keys(MYWORK_AUTO_KEYS);
  var shipped = {};
  HIRING_ALERTS_CATALOG_SHIPPED.forEach(function (d) { shipped[d.key] = d; });
  var swBad = autoKeys.filter(function (k) {
    var d = shipped[MYWORK_AUTO_KEYS[k]];
    return !d || d.group !== 'mywork' || d.value !== 'no' || !/^mywork_auto_sr_/.test(d.key) ||
           sdHas_(MYWORK_HIDE_KEYS, k);
  });
  var keepCfg = { alerts: G.hiringAlerts_, catalog: G.hiringAlertsCatalog_ };
  try {
    hiringAlertsCatalog_ = function () { return hiringAlertsCatalogMerge_({ read: true, rows: [], refused: [] }); };
    hiringAlerts_ = function () {
      return { mywork_auto_sr_vehicle: ' YES ', mywork_auto_sr_payroll: 'maybe', mywork_auto_sr_incident: 'on' };
    };
    var read = hubMyWorkAutoRead_();
    var reads = hubMyWorkAutoOn_('vehicle') && !hubMyWorkAutoOn_('payroll') && hubMyWorkAutoOn_('incident') &&
                !hubMyWorkAutoOn_('late_show') && !hubMyWorkAutoOn_('nonsense') && !hubMyWorkAutoOn_('toString');
    hiringAlerts_ = function () { throw new Error('the tab could not be read'); };
    var thrown = hubMyWorkAutoOn_('vehicle');
    stAssert_(out, P + 'nine switches, all shipping no under mywork and none a hide switch; plainly yes runs, ' +
                   '"maybe" and a missing cell do not, and an unreadable tab runs nothing',
              swBad.length === 0 && autoKeys.length === 9 && reads && thrown === false &&
              Object.keys(read).length === 9, swBad.join(', ') + ' ' + JSON.stringify(read));
  } finally {
    hiringAlerts_ = keepCfg.alerts;
    hiringAlertsCatalog_ = keepCfg.catalog;
  }

  // ---- the read-back extractor ----
  var rb1 = sdReadBack_('[0:10] +13305550001: hi\n[0:20] agent: I have the new email address as abc123@Gmail.com. Is ' +
                        'that correct?\n[0:24] +13305550001: Yes, that is it.', '');
  var rb2 = sdReadBack_('', 'So your new home address is 42 Oak Street. Did I get that right? Yeah.');
  var rb3 = sdReadBack_('[0:10] agent: The new phone number is 330 555 0199. Is that correct?\n[0:15] +1330: No, ' +
                        'it is 0198.', '');
  var rb4 = sdReadBack_('[0:10] agent: Your updated e-mail is jay at mail dot com. Is that right?\n[0:12] caller: ' +
                        'Correct.', '');
  stAssert_(out, P + 'the read-back is deterministic: the agent\'s line then the caller\'s yes proves the value; a ' +
                 'no proves nothing; a spoken-out value is caught',
            rb1 && rb1.field === 'email' && rb1.value === 'abc123@Gmail.com' && rb2 && rb2.field === 'address' &&
            rb2.value === '42 Oak Street' && rb3 === null && rb4 && rb4.field === 'email' &&
            sdSpelledOut_(rb4.value, 'email') && !sdSpelledOut_(rb1.value, 'email') &&
            !sdSpelledOut_('42 Oak Street at Main', 'address') && sdSpelledOut_('3 3 0 5 5 5', 'phone'),
            JSON.stringify([rb1, rb2, rb3, rb4]));

  // ---- the stand-ins ----
  var STUBS = ['sdRead_', 'sdAppend_', 'sdUpsert_', 'sdHouseReady_', 'usersAll_', 'hubProfileAppGate_', 'hubIsRealMaster_',
               'schedSettings_', 'schedRead_', 'schedHouseReady_', 'schedHouseLabel_', 'schedShiftWords_', 'schedVersion_',
               'schedKeyOf_', 'schedFlowTimeOffAsk_', 'estateRows_', 'estateSource_', 'hiringAlerts_',
               'hiringAlertsCatalog_', 'smartTell_', 'hubSysLog_', 'hubTestModeState_', 'contactPhoneWho_',
               'commCallsTranscriptRead_', 'contactGuard_', 'userSetFields_', 'usersRowsBump_', 'mailPlatformUrl_'];
  var keep = {};
  STUBS.forEach(function (n) { keep[n] = G[n]; });
  var keepAnswer = HUB_ACTIONS.schedulingAnswer;
  var keepVars = { version: SD_VERSION_KEY, due: SD_DUE_KEY, now: SD_NOW,
                   member: (typeof HUB_MEMBER_CTX !== 'undefined') ? HUB_MEMBER_CTX : null };
  SD_VERSION_KEY = 'sd_list_v_selftest';
  SD_DUE_KEY = 'sd_due_at_selftest';
  HUB_MEMBER_CTX = null;

  var ACC = {
    ty: { userid: 'U_TY', displayname: 'Ty Bond', email: 'ty.bond@abrighterdawninc.com', emails: '["ty.bond@asalifecare.com"]',
          phone: '+13305550101', phones: '', active: 'TRUE', role: 'admin' },
    tyOld: { userid: 'U_TYOLD', displayname: 'Ty Bond', email: 'ty.old@asalifecare.com', emails: '', phone: '',
             phones: '', active: 'FALSE', mergedinto: 'U_TY', role: 'admin' },
    brit: { userid: 'U_BRIT', displayname: 'Brittany Anderson', email: 'brittfrench1316@gmail.com', emails: '',
            phone: '+13305550102', phones: '', active: 'TRUE', role: 'staff' },
    arthur: { userid: 'U_ART', displayname: 'Arthur Rodrigues', email: 'arthur.torres@asalifecare.com', emails: '',
              phone: '+13309195559', phones: '', active: 'TRUE', role: 'admin' },
    well: { userid: 'U_WEL', displayname: 'Wellington', email: 'admin@abrighterdawninc.com', emails: '',
            phone: '+13307544040', phones: '', active: 'TRUE', role: 'admin' },
    joan: { userid: 'U_JOAN', displayname: 'Joan Cheruiyot', email: 'joan@x', emails: '', phone: '+13305550133',
            phones: '', active: 'TRUE', role: 'staff' },
    eve: { userid: 'U_EVE', displayname: 'Eve Tan', email: 'eve@x', emails: '', phone: '', phones: '', active: 'TRUE',
           role: 'staff' },
    fam: { userid: 'U_FAM', displayname: 'Fay Family', email: 'fay@x', emails: '', phone: '', phones: '', active: 'TRUE',
           role: 'family' }
  };
  var userOf = function (k, extra) {
    var a = ACC[k];
    var u = { id: a.userid, email: a.email, display_name: a.displayname, role: a.role };
    for (var x in (extra || {})) u[x] = extra[x];
    return u;
  };
  var MASTER = { id: 'U_MASTER', email: 'master@x', display_name: 'Master', role: 'admin' };

  var db, told, answered, timeOffAsked, cfg, gateOpen, schedReady, schedDirsReadable, flows, schedItems, queue,
      incidents, written, transcript, holder;
  var copy = function (o) { return JSON.parse(JSON.stringify(o)); };
  var reset = function () {
    db = { support_events: [], support_decisions: [], support_inbox: [], support_settings: [] };
    told = []; answered = []; timeOffAsked = []; written = [];
    cfg = {};
    gateOpen = { U_TY: true, U_BRIT: true, U_ART: true, U_WEL: true, U_EVE: true, U_JOAN: true };
    schedReady = true; schedDirsReadable = true;
    flows = []; schedItems = [];
    queue = [
      { id: 'r2', status: 'New', urgency: 'High', date_received: '2026-01-27T15:04:00Z', requestor: 'Ty Bond',
        requestor_phone: '3305550101', type_of_request: 'Operations - Vehicle Issue',
        description_of_request: 'Van broke down on Route 62, stranded with client', notes: 'Call ID: ACaaa111', processed: '' },
      { id: 'r3', status: 'New', urgency: 'Mid', date_received: '9/16/2026', requestor: 'Angel Fiber',
        requestor_phone: '3305550177', type_of_request: 'Payroll', description_of_request: 'Missing paycheck for last week',
        notes: '', processed: '' },
      { id: 'r4', status: 'Pending', urgency: 'Low', date_received: '2026-09-18', requestor: '',
        requestor_phone: '3307544040', type_of_request: 'Other - General Requests',
        description_of_request: 'Caller reached voicemail and left no details.', notes: '', processed: '' },
      { id: 'r5', status: 'New', urgency: 'Low', date_received: '2026-09-18T02:30:00Z', requestor: 'Maria Lopez',
        requestor_phone: '3305550188', type_of_request: 'Schedule - Call Off',
        description_of_request: 'Calling off tonight, sick child', notes: 'Call ID: ACccc333', processed: '' },
      { id: 'r6', status: 'Resolved', urgency: 'Low', date_received: '2026-02-01', requestor: 'Old Caller',
        requestor_phone: '', type_of_request: 'Training - CPR', description_of_request: 'CPR class', notes: '', processed: '' }
    ];
    incidents = [];
    transcript = null;
    holder = { state: 'sole', name: 'Joan Cheruiyot', people: [], why: 'one person' };
    sdMemoDrop_();
    try { CacheService.getScriptCache().remove(SD_VERSION_KEY); CacheService.getScriptCache().remove(SD_DUE_KEY); } catch (e) {}
  };
  var setAll = function (on) {
    Object.keys(MYWORK_AUTO_KEYS).forEach(function (k) { cfg[MYWORK_AUTO_KEYS[k]] = on ? 'yes' : 'no'; });
  };

  sdHouseReady_ = function () { return true; };
  sdRead_ = function (tab) {
    if (!db[tab]) throw new Error('The Support Requests house "' + tab + '" is not set up.');
    return copy(db[tab]);
  };
  sdAppend_ = function (tab, rows) { rows.forEach(function (r) { db[tab].push(copy(r)); }); sdMemoDrop_(tab); sdBump_(); return rows.length; };
  sdUpsert_ = function (tab, rows) {
    var idf = tab === 'support_settings' ? 'key' : 'id';
    rows.forEach(function (r) {
      var i = -1;
      db[tab].forEach(function (x, j) { if (x[idf] === r[idf]) i = j; });
      if (i === -1) db[tab].push(copy(r)); else db[tab][i] = copy(r);
    });
    sdMemoDrop_(tab); sdBump_();
    return rows.length;
  };
  usersAll_ = function () { return Object.keys(ACC).map(function (k) { return copy(ACC[k]); }); };
  hubProfileAppGate_ = function (id, u) {
    if (id !== SD_APP_ID || !u || u.is_service) return { open: false };
    return { open: u.email === MASTER.email || !!gateOpen[u.id] };
  };
  hubIsRealMaster_ = function (u) { return !!u && !u.is_service && !u.visiting_member && u.email === MASTER.email; };
  schedSettings_ = function () {
    return { readable: schedDirsReadable, directors_readable: schedDirsReadable, directors_why: 'unreadable here',
             directors: [{ email: 'ty.bond@asalifecare.com', uid: 'U_TY', name: 'Ty Bond' },
                         { email: 'brittfrench1316@gmail.com', uid: 'U_BRIT', name: 'Brittany Anderson' }] };
  };
  schedHouseReady_ = function () { return schedReady; };
  schedRead_ = function (tab) {
    if (!schedReady) throw new Error('The Scheduling house "' + tab + '" is not set up.');
    return copy(tab === SCHED_TABS.flows ? flows : schedItems);
  };
  schedHouseLabel_ = function (c) { return c === 'BM4060' ? 'BM' : c; };
  schedShiftWords_ = function (c) { return String(c.text || ''); };
  schedVersion_ = function () { return 'v-selftest'; };
  schedKeyOf_ = function (u) { return u && u.id === 'U_EVE' ? clientNameKey_('Eve Tan') : ''; };
  schedFlowTimeOffAsk_ = function (g, p, via) {
    timeOffAsked.push({ g: g, p: p, via: via });
    if (p.from < '2026-10-08') return { status: 409, message: 'Time off needs at least 7 days\' notice — inside that, use Call Off or Swap.' };
    var f = { id: 'SF00000000E1', kind: 'time_off', state: 'waiting', date: p.from, date_to: p.to, person: g.name,
              person_key: g.key, person_uid: g.uid, source: 'platform', source_ref: via === 'my-calendar' ? 'my-calendar' : '',
              seats: JSON.stringify([{ seat: 'director', state: 'waiting', to: [{ uid: 'U_TY', name: 'Ty Bond' },
                                                                              { uid: 'U_BRIT', name: 'Brittany Anderson' }] }]),
              created_at: '2026-10-01T15:00:00.000Z' };
    flows.push(f);
    return { ok: true, flow: f };
  };
  estateRows_ = function (res) { return copy(res === 'supportQueue' ? queue : res === 'uiIncidents' ? incidents : []); };
  estateSource_ = function () { return null; };
  hiringAlerts_ = function () { return cfg; };
  hiringAlertsCatalog_ = function () { return hiringAlertsCatalogMerge_({ read: true, rows: [], refused: [] }); };
  smartTell_ = function (o) { told.push(copy(o)); return { situation: o.situation, state: 'held', held: 'test_mode', why: 'test mode' }; };
  hubSysLog_ = function () {};
  hubTestModeState_ = function () { return { on: true }; };
  contactPhoneWho_ = function () { return holder; };
  commCallsTranscriptRead_ = function (id) {
    if (transcript === 'throw') throw new Error('the transcripts could not be opened');
    if (!transcript || id !== transcript.call_id) return { status: 404, message: 'no transcript on file for that call' };
    return { status: 200, data: transcript };
  };
  contactGuard_ = function () { return null; };
  userSetFields_ = function (uid, fields) { written.push({ uid: uid, fields: copy(fields) }); return true; };
  usersRowsBump_ = function () {};
  mailPlatformUrl_ = function () { return 'https://hub.example'; };
  HUB_ACTIONS.schedulingAnswer = function (p, u) {
    answered.push({ p: copy(p), uid: u && u.id });
    return { status: 200, data: { ok: true, changed: true, said: 'Approved.', state: 'approved' } };
  };

  try {
    reset();
    setAll(false);

    // ---- the gate and the cut ----
    var closed = HUB_ACTIONS.supportDeskList({}, userOf('joan', { email: 'nobody@x', id: 'U_NOBODY' }));
    gateOpen = {};
    var closedDecide = HUB_ACTIONS.supportDeskDecide({ ref: 'HQ5EF1CB5F25', verdict: 'approve' }, userOf('ty'));
    var closedAdp = HUB_ACTIONS.supportDeskAdp({ ref: 'HQ5EF1CB5F25', op: 'approve' }, userOf('ty'));
    stAssert_(out, P + 'a closed App Control gate answers 404 Unknown action to the list, the decision and the ADP door',
              closed.status === 404 && closedDecide.status === 404 && closedAdp.status === 404 &&
              closed.message === 'Unknown action.', JSON.stringify([closed, closedDecide]));
    reset();
    setAll(false);
    var ty = HUB_ACTIONS.supportDeskList({}, userOf('ty')).data;
    var master = HUB_ACTIONS.supportDeskList({ completed: true }, MASTER).data;
    var lead = HUB_ACTIONS.supportDeskList({}, userOf('arthur')).data;
    var other = HUB_ACTIONS.supportDeskList({}, userOf('eve')).data;
    var watcher = HUB_ACTIONS.supportDeskList({}, userOf('eve', { types: 'SUPERVISOR' })).data;
    var lead2 = HUB_ACTIONS.supportDeskList({}, userOf('eve', { types: 'TEAMLEAD' })).data;
    // TEAMLEAD stands in for nobody (the operator's rule, 2026-10-29): it sees what anybody else sees
    stAssert_(out, P + 'a SUPERVISOR badge sees every row Ty sees and decides none of them; a TEAMLEAD badge is no ' +
                   'watcher and sees what anybody else sees',
              lead2.rows.length === other.rows.length && lead2.viewer.is_watcher !== true &&
              lead2.viewer.can_decide === false &&
              watcher.rows.length === ty.rows.length && watcher.viewer.is_watcher === true &&
              watcher.viewer.can_decide === false &&
              watcher.rows.every(function (r) { return !r.may.approve && !r.may.deny && !r.may.resolve && !r.may.redirect; }),
              JSON.stringify([watcher.rows.length, ty.rows.length, watcher.viewer]));
    var refs = function (d) { return d.rows.map(function (r) { return r.ref; }); };
    stAssert_(out, P + 'the directors and the master see every row (completed ones only when asked), a lead sees the ' +
                   'general requests alone, anybody else no row and one sentence; Ty resolves through the live account',
              ty.viewer.is_director && ty.viewer.can_decide && ty.rows.length === 4 && master.rows.length === 5 &&
              master.viewer.is_master && master.viewer.can_decide && lead.viewer.is_lead && !lead.viewer.can_decide &&
              refs(lead).join(',') === 'HQ82D0D7C86E' && other.rows.length === 0 &&
              other.note === 'Requests are shown to the directors.' && ty.directors.length === 2 &&
              ty.leads.map(function (l) { return l.uid; }).join(',') === 'U_ART,U_WEL' && ty.counts.completed === 1,
              JSON.stringify([refs(ty), refs(master), refs(lead), other.note, ty.counts]));
    var veh = ty.rows.filter(function (r) { return r.ref === 'HQ5EF1CB5F25'; })[0] || {};
    stAssert_(out, P + 'a queue row carries its ref, the "Area · Label" pill, its urgency, its Call ID and never the ' +
                   'caller\'s phone; the directors may approve, deny or resolve it',
              veh.type && veh.type.display === 'Operations · Vehicle Issue' && veh.route === 'vehicle' &&
              veh.requestor.uid === 'U_TY' && veh.status.tone === 'new' && veh.may.approve && veh.may.resolve &&
              JSON.stringify(veh).indexOf('5550101') === -1 && JSON.stringify(veh).indexOf('ACaaa111') !== -1 &&
              veh.date === '2026-01-27T15:04:00Z' && !('_final' in veh) && !('_items' in veh),
              JSON.stringify(veh));
    var sch = ty.sources.filter(function (s) { return s.key === 'scheduling'; })[0];
    schedReady = false;
    sdMemoDrop_();
    sdBump_();
    var noSched = HUB_ACTIONS.supportDeskList({}, userOf('ty')).data;
    var schedSrc = noSched.sources.filter(function (s) { return s.key === 'scheduling'; })[0];
    stAssert_(out, P + 'Scheduling\'s houses not set up: its source says so (the screen draws it as its own line, so ' +
                   'the note does not say it twice), and the queue rows are still listed (never a silent zero)',
              sch && sch.state === 'ready' && schedSrc.state === 'unreadable' &&
              schedSrc.why === 'Scheduling\'s houses are not set up yet' && noSched.rows.length === 4 &&
              noSched.note.indexOf('Scheduling') === -1, JSON.stringify([schedSrc, noSched.note]));
    schedReady = true;
    delete db.support_decisions;
    sdMemoDrop_();
    sdBump_();
    var noDecs = HUB_ACTIONS.supportDeskList({}, userOf('ty')).data;
    var noDecsAnswer = HUB_ACTIONS.supportDeskDecide({ ref: 'HQ5EF1CB5F25', verdict: 'approve' }, userOf('ty'));
    db.support_decisions = [];
    var decsSrc = noDecs.sources.filter(function (s) { return s.key === 'decisions'; })[0] || {};
    stAssert_(out, P + 'a decisions house that cannot be read is named on the list and refuses every verdict with 503',
              decsSrc.state === 'unreadable' && /support_decisions/.test(decsSrc.why) && noDecsAnswer.status === 503,
              JSON.stringify([decsSrc, noDecs.note, noDecsAnswer]));

    // ---- the one-verdict law ----
    reset();
    var a1 = HUB_ACTIONS.supportDeskDecide({ ref: 'HQ5EF1CB5F25', verdict: 'approve', note: 'Sending the spare van' }, userOf('ty'));
    var a2 = HUB_ACTIONS.supportDeskDecide({ ref: 'HQ5EF1CB5F25', verdict: 'approve' }, userOf('brit'));
    var a3 = HUB_ACTIONS.supportDeskDecide({ ref: 'HQ5EF1CB5F25', verdict: 'deny' }, userOf('brit'));
    var notDir = HUB_ACTIONS.supportDeskDecide({ ref: 'HQ6EEF063DEE', verdict: 'approve' }, userOf('arthur'));
    var mVisit = HUB_ACTIONS.supportDeskDecide({ ref: 'HQ6EEF063DEE', verdict: 'approve' },
                                               { id: MASTER.id, email: MASTER.email, display_name: MASTER.display_name,
                                                 role: MASTER.role, visiting_member: 'mem_1' });
    var mApprove = HUB_ACTIONS.supportDeskDecide({ ref: 'HQ6EEF063DEE', verdict: 'approve' }, MASTER);
    var mResolve = HUB_ACTIONS.supportDeskDecide({ ref: 'HQ82D0D7C86E', verdict: 'resolve' }, MASTER);
    var visit = HUB_ACTIONS.supportDeskDecide({ ref: 'HQ82D0D7C86E', verdict: 'resolve' },
                                              userOf('ty', { visiting_member: 'mem_1' }));
    var gone = HUB_ACTIONS.supportDeskDecide({ ref: 'HQ0000000000', verdict: 'resolve' }, userOf('ty'));
    var word = HUB_ACTIONS.supportDeskDecide({ ref: 'HQ82D0D7C86E', verdict: 'maybe' }, userOf('ty'));
    var dec = db.support_decisions[0] || {};
    var w = sdJson_(dec.witness, {});
    var mDec = db.support_decisions.filter(function (d) { return d.ref === 'HQ6EEF063DEE'; })[0] || {};
    stAssert_(out, P + 'one final verdict per request: the first lands with its witness; the same verdict again is ' +
                   'unchanged and names who; another verdict is 409 with who and when; a lead approving is 403; the ' +
                   'master decides as a director does, recorded as the master\'s, never during a visit; a visit 403, an ' +
                   'unknown ref 404, an unknown word 400',
              a1.status === 200 && a1.data.changed === true && a1.data.row && a1.data.row.status.word === 'Approved' &&
              a1.data.row.completed === true && a2.status === 200 && a2.data.changed === false &&
              a2.data.said === 'Already approved by Ty Bond.' && a3.status === 409 &&
              a3.message.indexOf('Already approved by Ty Bond at ') === 0 && notDir.status === 403 &&
              notDir.message === 'Only the directors decide requests.' && mVisit.status === 403 &&
              mApprove.status === 200 && mDec.verdict === 'approved' && mDec.by_uid === 'U_MASTER' &&
              mResolve.status === 200 && visit.status === 403 && gone.status === 404 &&
              gone.message === 'That request is not on the queue any more.' && word.status === 400 &&
              dec.verdict === 'approved' && dec.by_uid === 'U_TY' && dec.note === 'Sending the spare van' &&
              w.row === 2 && w.call_id === 'ACaaa111' && w.requestor === 'Ty Bond' && /^SD[0-9A-F]{10}$/.test(dec.id) &&
              db.support_decisions.length === 3,
              JSON.stringify([a1.status, a2.data, a3, notDir.status, mVisit.status, mApprove, mDec, mResolve.status,
                              visit.status, w, db.support_decisions.length]));

    // ---- the hooks, switched off ----
    reset();
    setAll(false);
    var offs = [
      supportDeskAttendance_([{ kind: 'late_show', row: { person: 'Eve Tan', day: '2026-10-01' } }], '2026-10-01'),
      supportDeskAttendanceMail_({ kind: 'no_call', person: 'Eve Tan' }, 'k', '2026-10-01'),
      supportDeskPunchNoted_([{ person: 'Eve Tan', verdict: 'missing', pair_fault: true, shift_at: '2026-10-01T12:00:00Z' }], 'board'),
      supportDeskIncidents_([{ timestamp: '2026-10-01T12:00:00Z', your_name: 'Eve Tan' }], 'hotline')
    ];
    var filedOff = supportDeskFiled_([queue[0]], {});
    hiringAlerts_ = function () { throw new Error('the tab could not be read'); };
    var unreadable = [
      supportDeskAttendance_([{ kind: 'no_call', row: { person: 'Eve Tan' } }], '2026-10-01'),
      supportDeskShiftRow_('punch_open_entry', { id: 'x', person: 'Eve Tan', shift_at: '2026-10-01T12:00:00Z' }),
      supportDeskIncidents_([{ timestamp: '2026-10-01T12:00:00Z' }], 'platform'),
      supportDeskFiled_([queue[0]], {})
    ];
    hiringAlerts_ = function () { return cfg; };
    stAssert_(out, P + 'every hook is off with its switch off and with the switches unreadable: nothing is raised, ' +
                   'nothing is told, nothing is marked done',
              offs.every(function (o) { return o && o.off === true; }) && filedOff.off === 1 &&
              unreadable.every(function (o) { return o && o.off === true; }) && db.support_events.length === 0 &&
              db.support_inbox.length === 0 && told.length === 0, JSON.stringify([offs, filedOff, unreadable]));
    setAll(true);
    var garbage = [];
    var threw = '';
    try {
      garbage = [supportDeskAttendance_(null, null), supportDeskAttendance_([null, { kind: 'x' }, { kind: 'late_show' }], ''),
                 supportDeskAttendanceMail_(null, null, null), supportDeskShiftRow_(null, null),
                 supportDeskShiftRow_('login_missing', { checked: 'yes' }), supportDeskPunchNoted_([null, 7, 'x'], 'board'),
                 supportDeskIncidents_([null, { timestamp: 'garbage' }], 'form'), supportDeskFiled_([null, {}], null)];
    } catch (eG) { threw = String(eG.message || eG); }
    stAssert_(out, P + 'the hooks never throw on garbage and raise nothing from it',
              !threw && garbage.length === 8 && db.support_events.length === 0, threw + ' ' + JSON.stringify(garbage));

    // ---- Late Show / No Call No Show ----
    reset();
    setAll(true);
    SD_NOW = '2026-10-01T16:00:00Z';
    var att = supportDeskAttendance_([{ kind: 'no_call', row: { person: 'Eve Tan', day: '2026-10-01', house: 'BM',
                                                                shift_code: '8A-4P', shift_at: '2026-10-01T12:00:00Z' } },
                                      { kind: 'late_show', row: { person: 'Old One', day: '2026-09-20' } }], '2026-10-01');
    var mail = supportDeskAttendanceMail_({ kind: 'no_call', person: 'Eve Tan' },
                                          staffAlertLedgerKey_('staff_no_call', 'Eve Tan', '2026-10-01'), '2026-10-01');
    var ncns = db.support_events[0] || {};
    var warnItems = db.support_inbox.filter(function (it) { return it.ref === ncns.id; });
    stAssert_(out, P + 'a No Call No Show is one warning request keyed as Smart Comms keys it, a red item to each ' +
                   'director and no text; the mailbox\'s report of the same absence converges; a week-old one is not raised',
              att.raised === 1 && att.skipped === 1 && mail.already === true && db.support_events.length === 1 &&
              ncns.kind === 'no_call' && ncns.id === sdEventId_('no_call', staffAlertLedgerKey_('staff_no_call', 'Eve Tan', '2026-10-01')) &&
              warnItems.length === 2 && warnItems.every(function (it) { return it.kind === 'warning' && it.seat === 'director'; }) &&
              warnItems[0].title === 'No Call No Show — Eve Tan' &&
              warnItems[0].body === 'BM · 8A-4P · Thu 10/1. Directors, are you aware?' &&
              warnItems[0].link === '/app/support-desk/requests?ref=' + ncns.id && told.length === 0 &&
              /^SN[0-9A-F]{10}$/.test(warnItems[0].id), JSON.stringify([att, mail, ncns, warnItems]));

    // ---- aware accumulates ----
    var aw1 = HUB_ACTIONS.supportDeskDecide({ ref: ncns.id, verdict: 'aware' }, userOf('ty'));
    var aw1b = HUB_ACTIONS.supportDeskDecide({ ref: ncns.id, verdict: 'resolve' }, userOf('ty'));
    var britItem = warnItems.filter(function (it) { return it.to_uid === 'U_BRIT'; })[0];
    var aw2 = HUB_ACTIONS.supportInboxAnswer({ item_id: britItem.id, word: 'aware' }, userOf('brit'));
    var aw3 = HUB_ACTIONS.supportInboxAnswer({ item_id: britItem.id, word: 'aware' }, userOf('brit'));
    var after = HUB_ACTIONS.supportDeskList({ completed: true }, userOf('ty')).data.rows
      .filter(function (r) { return r.ref === ncns.id; })[0] || {};
    stAssert_(out, P + '"I\'m aware" accumulates: the first director leaves it asking, the second (from My Inbox) closes ' +
                   'it "Aware — Ty … · Brittany …"; a second press is unchanged; a warning has no Resolve',
              aw1.status === 200 && aw1.data.row.status.word === 'Directors, are you aware?' &&
              aw1.data.row.waiting_on.join(',') === 'Brittany Anderson' && aw1b.status === 400 && aw2.status === 200 &&
              aw2.data.changed === true && aw3.data.changed === false && after.completed === true &&
              /^Aware — Ty \d\d:\d\d · Brittany \d\d:\d\d$/.test(after.status.word) && after.acks.length === 2 &&
              db.support_decisions.filter(function (d) { return d.verdict === 'aware'; }).length === 2,
              JSON.stringify([aw1.data && aw1.data.row && aw1.data.row.status, aw1b, aw2, aw3, after.status]));

    // ---- the My Inbox door, gated by the seat ----
    var tyItem = warnItems.filter(function (it) { return it.to_uid === 'U_TY'; })[0];
    var other1 = HUB_ACTIONS.supportInboxAnswer({ item_id: tyItem.id, word: 'aware' }, userOf('brit'));
    var visit1 = HUB_ACTIONS.supportInboxAnswer({ item_id: tyItem.id, word: 'aware' }, userOf('ty', { visiting_member: 'm' }));
    var svc = HUB_ACTIONS.supportInboxAnswer({ item_id: tyItem.id, word: 'aware' }, { is_service: true });
    var badId = HUB_ACTIONS.supportInboxAnswer({ item_id: 'SI0000000000', word: 'aware' }, userOf('ty'));
    var badWord = HUB_ACTIONS.supportInboxAnswer({ item_id: tyItem.id, word: 'approve' }, userOf('ty'));
    stAssert_(out, P + 'the My Inbox answer refuses another person\'s item (403), a visit (403), the service (404), a ' +
                   'foreign id and a foreign word (400); first answer wins',
              other1.status === 403 && other1.message === 'This item is waiting on someone else.' &&
              visit1.status === 403 && svc.status === 404 && badId.status === 400 && badWord.status === 400,
              JSON.stringify([other1, visit1, svc, badId, badWord]));

    // ---- the first missing punch ----
    reset();
    setAll(true);
    SD_NOW = '2026-10-01T16:00:00Z';
    var p1 = supportDeskPunchNoted_([{ id: 'b1', person: 'Eve Tan', house: 'BM4060', house_name: 'BM', shift_code: '8A-4P',
                                       shift_at: '2026-10-01T08:00:00-04:00', verdict: 'missing', pair_fault: true }], 'board');
    var p2 = supportDeskShiftRow_('login_missing', { id: 'r1', person: 'Eve Tan', house_name: 'BM',
                                                     shift_at: '2026-10-01T12:00:00Z', checked: true });
    var p3 = supportDeskShiftRow_('punch_open_entry', { id: 'r2', person: 'Eve Tan', shift_at: '2026-10-01T12:00:00.000Z' });
    var p4 = supportDeskShiftRow_('punch_open_entry', { id: 'r3', person: 'Eve Tan', shift_at: '2026-10-01T12:00:00Z' });
    var p5 = supportDeskPunchNoted_([{ person: 'Eve Tan', verdict: 'not_entered_yet', pair_fault: true, shift_at: '2026-10-01T20:00:00Z' },
                                     { person: 'Eve Tan', verdict: 'open', pair_fault: false, shift_at: '2026-10-01T20:00:00Z' }], 'board');
    var pev = db.support_events[0] || {};
    var pItems = db.support_inbox.filter(function (it) { return it.ref === pev.id; });
    var pNotes = db.support_decisions.filter(function (d) { return d.ref === pev.id && d.verdict === 'note'; });
    stAssert_(out, P + 'the first missing punch of a shift is one warning to the directors and the leads and one ' +
                   'sr_punch_aware text each; the same shift again raises nothing, the other direction is one note; ' +
                   'not-entered-yet and a paired shift are ignored',
              p1.raised === 1 && p2.already === 1 && p3.already === 1 && p4.already === 1 && p5.skipped === 2 &&
              db.support_events.length === 1 && pev.kind === 'punch' && pev.source_ref === clientNameKey_('Eve Tan') + '|2026-10-01T12:00Z' &&
              pItems.length === 4 && pItems[0].title === 'Eve Tan is not punching in' &&
              pItems.filter(function (it) { return it.seat === 'lead'; }).length === 2 && told.length === 2 &&
              told.every(function (t) { return t.situation === 'sr_punch_aware' && t.key.indexOf('sr|sr_punch_aware|' + pev.id + '|') === 0; }) &&
              pNotes.length === 1 && pNotes[0].note === 'Also not punching out' &&
              pItems.filter(function (it) { return it.to_uid === 'U_ART'; })[0].note === 'text: no_phone' &&
              pItems.filter(function (it) { return it.to_uid === 'U_TY'; })[0].note === 'text: held:test_mode',
              JSON.stringify([p1, p2, p3, p5, pev.source_ref, told.length, pItems.map(function (i) { return i.note; })]));

    // ---- incidents ----
    var inc = supportDeskIncidents_([{ timestamp: '2026-09-27T19:54:00.000Z', your_name: 'Jane Doe', client_name: 'John Client',
                                       incident_category: 'Minor injury', incident_location: 'BM4060',
                                       summary_of_incident: 'CLINICAL TEXT' }], 'hotline');
    var inc2 = supportDeskIncidents_([{ timestamp: new Date('2026-09-27T19:54:00Z'), your_name: 'Jane Doe', client_name: 'John Client',
                                        incident_category: 'Minor injury' }], 'platform');
    var iev = db.support_events.filter(function (e) { return e.kind === 'incident'; })[0] || {};
    var iItems = db.support_inbox.filter(function (it) { return it.ref === iev.id; });
    stAssert_(out, P + 'an incident is one important alert to the directors and the leads, a pointer only (category, ' +
                   'location, day) — never the report — keyed IN22AECE9878 from the hotline and the platform alike',
              inc.raised === 1 && inc2.already === 1 && iev.source_ref === 'IN22AECE9878' && iItems.length === 4 &&
              iItems.every(function (it) { return it.kind === 'important'; }) &&
              iItems[0].title === 'Incident filed — Minor injury' &&
              JSON.stringify(db.support_events).indexOf('CLINICAL') === -1 &&
              JSON.stringify(db.support_inbox).indexOf('CLINICAL') === -1 && told.length === 2,
              JSON.stringify([inc, inc2, iev.source_ref, iItems.length]));

    // ---- routing the hotline's requests ----
    var f1 = supportDeskFiled_([queue[0], queue[1], queue[2], queue[3], queue[4]], { callId: 'ACaaa111' });
    var f2 = supportDeskFiled_([queue[0]], {});
    var vItems = db.support_inbox.filter(function (it) { return it.ref === 'HQ5EF1CB5F25'; });
    var pyItems = db.support_inbox.filter(function (it) { return it.ref === 'HQ6EEF063DEE'; });
    var gItems = db.support_inbox.filter(function (it) { return it.ref === 'HQ82D0D7C86E'; });
    var vTold = told.filter(function (t) { return t.situation === 'sr_vehicle_request'; });
    var pTold = told.filter(function (t) { return t.situation === 'sr_payroll_request'; });
    var rev = db.support_events.filter(function (e) { return e.kind === 'route' && e.ref === 'HQ5EF1CB5F25'; })[0] || {};
    var revTold = (sdJson_(rev.details, {}) || {}).told || [];
    stAssert_(out, P + 'a vehicle request goes to both directors then a text each; payroll to Ty then a text; a general ' +
                   'request to the two leads with no text; a call-off and an unrouted type to nobody; filed again, nothing',
              f1.routed === 3 && f1.skipped === 2 && f2.already === 1 && vItems.length === 2 &&
              vItems[0].title === 'Operations · Vehicle Issue from Ty Bond' && vTold.length === 2 &&
              vTold[0].vars.callback === '3305550101' && vTold[0].vars.urgency === 'High' &&
              vTold[0].vars.link === 'https://hub.example/#/app/support-desk/requests?ref=HQ5EF1CB5F25' &&
              pyItems.length === 1 && pyItems[0].to_uid === 'U_TY' && pTold.length === 1 && gItems.length === 2 &&
              gItems.every(function (it) { return it.seat === 'lead'; }) &&
              told.filter(function (t) { return t.situation !== 'sr_vehicle_request' && t.situation !== 'sr_payroll_request' &&
                                                t.situation !== 'sr_punch_aware'; }).length === 0 &&
              revTold.length === 2 && revTold[0].text.state === 'held:test_mode',
              JSON.stringify([f1, f2, vItems.length, vTold.length, pyItems.length, gItems.length, revTold]));

    // ---- ADP · Update Information ----
    reset();
    setAll(true);
    var adpRow = function (desc, extra) {
      var r = { id: 'r9', status: 'New', urgency: 'Low', date_received: '2026-10-01T14:00:00Z', requestor: 'Joan Cheruiyot',
                requestor_phone: '3305550133', type_of_request: 'ADP - Update Information', description_of_request: desc,
                notes: 'Call ID: ACddd444', processed: '' };
      for (var x in (extra || {})) r[x] = extra[x];
      return { ref: 'HQ' + sdSha10_(sdQueueKey_(r.requestor, r.type_of_request, r.description_of_request, r.date_received)),
               row: r, index: 0, book_row: 9 };
    };
    var EMAIL_CALL = { call_id: 'ACddd444', full_transcript: '', speaker_transcript:
      '[0:05] agent: What is the updated email address?\n[0:09] +13305550133: joan.new@example.com\n' +
      '[0:12] agent: I have the new email address as joan.new@example.com. Is that correct?\n[0:15] +13305550133: Yes.' };
    var judge = function (desc, extra, call, who) {
      transcript = call === undefined ? EMAIL_CALL : call;
      holder = who || { state: 'sole', name: 'Joan Cheruiyot', people: [], why: 'one person' };
      return sdAdpJudge_(adpRow(desc, extra));
    };
    var jOk = judge('New e-mail');
    var jNoCall = judge('New e-mail', { notes: '' });
    var jStar = judge('New e-mail', { requestor: '*Joan Cheruiyot' });
    var jBlank = judge('New e-mail', { requestor: 'Undetermined' });
    var jShared = judge('New e-mail', { requestor_phone: '3307544040' });
    var jOtherLine = judge('New e-mail', {}, undefined, { state: 'sole', name: 'Tim Gray', people: [] });
    var jSharedLine = judge('New e-mail', {}, undefined, { state: 'shared', name: '', people: [], why: '2 people hold this line' });
    var jNoWords = judge('New e-mail', {}, null);
    var jNoYes = judge('New e-mail', {}, { call_id: 'ACddd444', full_transcript: '', speaker_transcript:
      '[0:12] agent: I have the new email address as joan.new@example.com. Is that correct?\n[0:15] caller: No.' });
    var jSpelled = judge('New e-mail', {}, { call_id: 'ACddd444', full_transcript: '', speaker_transcript:
      '[0:12] agent: Your new email is j a j m a e o dot com. Is that correct?\n[0:15] caller: Yes.' });
    var jRate = judge('Wants a new pay rate');
    var jW4 = judge('Update my W-4 please');
    var jHeldElse = (function () {
      var keepC = contactGuard_;
      contactGuard_ = function () { return { severity: 'block', hits: [{ via: 'email', people: [{ name: 'Someone Else', active: true }] }] }; };
      try { return judge('New e-mail'); } finally { contactGuard_ = keepC; }
    })();
    var jAddr = judge('New address', {}, { call_id: 'ACddd444', speaker_transcript: '', full_transcript:
      'Okay. So your new home address is 42 Oak Street, Canton. Is that correct? Yes it is.' });
    var jThrow = null;
    try { judge('New e-mail', {}, 'throw'); } catch (eT) { jThrow = String(eT.message || eT); }
    var refusedAll = [jNoCall, jStar, jBlank, jShared, jOtherLine, jSharedLine, jNoWords, jNoYes, jSpelled, jHeldElse]
      .every(function (j) { return j.state === 'refused' && j.why && !j.proof; });
    stAssert_(out, P + 'ADP: an e-mail read back and confirmed by the caller whose line and name prove one live account ' +
                   'is READY with a proof; every guard refuses in one sentence (no Call ID, no name, a starred name, a ' +
                   'company line, another holder, a shared line, no transcript, no yes, spelled out, held elsewhere); ' +
                   'pay rate and W-4 are ADP\'s alone; an address is applied; an unreadable call throws (judged again)',
              jOk.state === 'ready' && jOk.field === 'email' && jOk.value === 'joan.new@example.com' && jOk.uid === 'U_JOAN' &&
              jOk.proof === sdSha10_('U_JOAN|email|joan.new@example.com') &&
              jOk.words === 'Add joan.new@example.com to Joan Cheruiyot\'s e-mails' && refusedAll &&
              jRate.state === 'refused_auto' && jW4.state === 'refused_auto' &&
              jRate.why === 'ADP only — a person must make this change in ADP.' &&
              jShared.why === 'The call came from a company line, which names nobody.' &&
              jAddr.state === 'applied' && jAddr.field === 'address' && jAddr.value === '42 Oak Street, Canton' && !!jThrow,
              JSON.stringify([jOk, jNoCall.why, jStar.why, jBlank.why, jOtherLine.why, jSharedLine.why, jNoWords.why,
                              jNoYes.why, jSpelled.why, jHeldElse.why, jRate.state, jAddr, jThrow]));

    // the ADP door: the one-click approval, re-derived on the server
    var q = adpRow('New e-mail');
    queue = [q.row];
    transcript = EMAIL_CALL;
    holder = { state: 'sole', name: 'Joan Cheruiyot', people: [], why: 'one person' };
    sdMemoDrop_();
    sdBump_();
    var raised =sdAdpRaise_(sdQueueAll_()[0], 'hotline');
    var adpEv = db.support_events.filter(function (e) { return e.kind === 'adp'; })[0] || {};
    var adpList = HUB_ACTIONS.supportDeskList({}, userOf('ty')).data.rows[0] || {};
    var wrongProof = HUB_ACTIONS.supportDeskAdp({ ref: q.ref, op: 'approve', proof: 'ABCDEF0123' }, userOf('ty'));
    var notDirAdp = HUB_ACTIONS.supportDeskAdp({ ref: q.ref, op: 'approve', proof: jOk.proof }, userOf('arthur'));
    var masterVisitAdp = HUB_ACTIONS.supportDeskAdp({ ref: q.ref, op: 'approve', proof: jOk.proof },
                                                    { id: MASTER.id, email: MASTER.email, role: MASTER.role,
                                                      display_name: MASTER.display_name, visiting_member: 'mem_1' });
    transcript = { call_id: 'ACddd444', full_transcript: '', speaker_transcript:
      '[0:12] agent: I have the new email address as other@example.com. Is that correct?\n[0:15] caller: Yes.' };
    var changedCall = HUB_ACTIONS.supportDeskAdp({ ref: q.ref, op: 'approve', proof: jOk.proof }, userOf('ty'));
    transcript = EMAIL_CALL;
    var ok1 = HUB_ACTIONS.supportDeskAdp({ ref: q.ref, op: 'approve', proof: jOk.proof }, MASTER);
    var ok2 = HUB_ACTIONS.supportDeskAdp({ ref: q.ref, op: 'approve', proof: jOk.proof }, userOf('brit'));
    var undoMail = HUB_ACTIONS.supportDeskAdp({ ref: q.ref, op: 'undo' }, userOf('ty'));
    var approvedLine = db.support_decisions.filter(function (d) { return d.ref === q.ref && d.verdict === 'approved'; });
    var keepJoanEmails = ACC.joan.emails;
    ACC.joan.emails = '["joan.new@example.com"]';
    // no bump: the account is outside the houses, and the list's key carries it
    sdMemoDrop_();
    var savedRow = HUB_ACTIONS.supportDeskList({ completed: true }, userOf('ty')).data.rows
      .filter(function (r) { return r.ref === q.ref; })[0] || {};
    ACC.joan.emails = keepJoanEmails;
    stAssert_(out, P + 'ADP approve: the panel gets the words and the proof; a stale proof or a call that now says ' +
                   'something else is 409; a lead, or the master during a visit, cannot approve; the master\'s own ' +
                   'approval records "approved" as his and opens the ' +
                   'person\'s profile with the e-mail filled in, writing NO account and sending no text; a second is ' +
                   'unchanged and opens the profile again; the account holding it reads as applied; an added e-mail is ' +
                   'not undone here',
              raised.raised === true && adpEv.ref === q.ref && adpList.adp && adpList.adp.state === 'ready' &&
              adpList.adp.proof === jOk.proof && wrongProof.status === 409 && notDirAdp.status === 403 &&
              masterVisitAdp.status === 403 &&
              changedCall.status === 409 && ok1.status === 200 && ok1.data.changed === true && written.length === 0 &&
              ok1.data.open && ok1.data.open.href === '/app/users/profile?u=U_JOAN&contacts=1&add_email=joan.new%40example.com' &&
              ok1.data.row && ok1.data.row.adp.state === 'ready' && /^Approved by Master/.test(ok1.data.row.adp.why) &&
              approvedLine.length === 1 && approvedLine[0].by_uid === 'U_MASTER' &&
              told.filter(function (t) { return t.situation === 'sr_adp_applied'; }).length === 0 &&
              ok2.data.changed === false && ok2.data.open && ok2.data.open.href === ok1.data.open.href &&
              undoMail.status === 400 && savedRow.adp && savedRow.adp.state === 'applied',
              JSON.stringify([raised, adpList.adp, wrongProof, notDirAdp.status, changedCall.status, ok1.data,
                              written, ok2.data, undoMail, approvedLine, savedRow.adp]));

    // an address: applied with the event, the directors told, and undone by a director
    reset();
    setAll(true);
    var aq = adpRow('New address');
    queue = [aq.row];
    transcript = { call_id: 'ACddd444', speaker_transcript: '', full_transcript:
      'So your new home address is 42 Oak Street. Is that correct? Yes.' };
    holder = { state: 'sole', name: 'Joan Cheruiyot', people: [], why: 'one person' };
    var filedAdp = supportDeskFiled_([aq.row], {});
    var aItems = db.support_inbox.filter(function (it) { return it.ref === aq.ref; });
    var applied = db.support_decisions.filter(function (d) { return d.verdict === 'applied'; })[0] || {};
    var undo = HUB_ACTIONS.supportDeskAdp({ ref: aq.ref, op: 'undo' }, userOf('brit'));
    stAssert_(out, P + 'ADP address: applied automatically as an append-only "applied" line, both directors get ' +
                   '"Update information from X applied automatically" and an sr_adp_applied text naming the field ' +
                   'and never the value; a director can undo it',
              filedAdp.routed === 1 && aItems.length === 2 &&
              aItems[0].title === 'Update information from Joan Cheruiyot applied automatically' &&
              applied.via === 'auto' && JSON.parse(applied.note).value === '42 Oak Street' &&
              told.length === 2 && told[0].situation === 'sr_adp_applied' && told[0].vars.field === 'home address' &&
              JSON.stringify(told).indexOf('Oak') === -1 && written.length === 0 && undo.status === 200 &&
              undo.data.row.adp.state === 'undone', JSON.stringify([filedAdp, aItems.length, applied, told, undo]));

    // ---- Scheduling rows: read through Scheduling, answered by Scheduling ----
    reset();
    flows = [
      { id: 'SF0000000001', kind: 'time_off', state: 'waiting', house_code: '', date: '2026-10-20', date_to: '2026-10-22',
        person: 'Eve Tan', person_key: clientNameKey_('Eve Tan'), person_uid: 'U_EVE', reason: 'A VACATION REASON',
        source: 'platform', source_ref: '', created_at: '2026-10-01T15:00:00.000Z',
        seats: JSON.stringify([{ seat: 'director', state: 'waiting', to: [{ uid: 'U_TY', name: 'Ty Bond' },
                                                                         { uid: 'U_BRIT', name: 'Brittany Anderson' }] }]) },
      { id: 'SF0000000002', kind: 'call_off', state: 'outreach_1', house_code: 'BM4060', date: '2026-09-18', person: 'Maria Lopez',
        person_uid: '', reason: 'sick child', source: 'hotline', source_ref: 'ACccc333:calloff:1', shift_text: '4P-12A',
        created_at: '2026-09-18T02:31:00.000Z', seats: '[]' },
      { id: 'SF0000000003', kind: 'time_off', state: 'waiting', house_code: '', date: '2026-10-24', date_to: '2026-10-24',
        person: 'Master', person_key: '', person_uid: 'U_MASTER', reason: '', source: 'platform', source_ref: '',
        created_at: '2026-10-01T16:00:00.000Z',
        seats: JSON.stringify([{ seat: 'director', state: 'waiting', to: [{ uid: 'U_TY', name: 'Ty Bond' }] }]) }
    ];
    schedItems = [
      { id: 'SI0000000001', flow_id: 'SF0000000001', box: 'work', kind: 'approval', seat: 'director', to_uid: 'U_TY', state: 'waiting' },
      { id: 'SI0000000002', flow_id: 'SF0000000001', box: 'work', kind: 'approval', seat: 'director', to_uid: 'U_BRIT', state: 'waiting' },
      { id: 'SI0000000003', flow_id: 'SF0000000002', box: 'inbox', kind: 'warning', seat: 'director', to_uid: 'U_TY', state: 'posted' },
      { id: 'SI0000000004', flow_id: 'SF0000000003', box: 'work', kind: 'approval', seat: 'director', to_uid: 'U_TY', state: 'waiting' }
    ];
    var tyS = HUB_ACTIONS.supportDeskList({}, userOf('ty')).data;
    var mS = HUB_ACTIONS.supportDeskList({}, MASTER).data;
    var toRow = tyS.rows.filter(function (r) { return r.ref === 'SF0000000001'; })[0] || {};
    var coRow = tyS.rows.filter(function (r) { return r.ref === 'SF0000000002'; })[0] || {};
    var mTo = mS.rows.filter(function (r) { return r.ref === 'SF0000000001'; })[0] || {};
    var mOwn = mS.rows.filter(function (r) { return r.ref === 'SF0000000003'; })[0] || {};
    var queueCallOff = tyS.rows.filter(function (r) { return r.ref === 'HQDDED74CB55'; });
    var deny = HUB_ACTIONS.supportDeskDecide({ ref: 'SF0000000001', verdict: 'deny', note: 'Short staffed' }, userOf('ty'));
    var aware = HUB_ACTIONS.supportDeskDecide({ ref: 'SF0000000002', verdict: 'aware' }, userOf('ty'));
    var mDeny = HUB_ACTIONS.supportDeskDecide({ ref: 'SF0000000001', verdict: 'deny' }, MASTER);
    var mOwnDeny = HUB_ACTIONS.supportDeskDecide({ ref: 'SF0000000003', verdict: 'deny' }, MASTER);
    var mVisitDeny = HUB_ACTIONS.supportDeskDecide({ ref: 'SF0000000001', verdict: 'deny' },
                                                   { id: MASTER.id, email: MASTER.email, role: MASTER.role,
                                                     display_name: MASTER.display_name, visiting_member: 'mem_1' });
    stAssert_(out, P + 'Scheduling rows come from its own flows: time off waits on both directors with the viewer\'s ' +
                   'own My Work item and never the time-off reason; the phone call-off and its queue row are one row; ' +
                   'a deny is Scheduling\'s decline on the director\'s own item, the note kept beside it; aware is seen; ' +
                   'the master stands in on a waiting director seat through Scheduling\'s own door, never on the master\'s own ' +
                   'request and never during a visit',
              toRow.type && toRow.type.display === 'Schedule · Time Off Request' && toRow.sched.item_id === 'SI0000000001' &&
              toRow.sched.words.join(',') === 'approve,decline' && toRow.may.approve && toRow.may.deny &&
              JSON.stringify(toRow).indexOf('A VACATION REASON') === -1 && coRow.type.display === 'Schedule · Call Off' &&
              coRow.details.some(function (d) { return d.label === 'Phone request' && d.value === 'HQDDED74CB55'; }) &&
              queueCallOff.length === 0 && coRow.may.aware && deny.status === 200 && answered.length === 3 &&
              answered[0].p.item_id === 'SI0000000001' && answered[0].p.word === 'decline' &&
              answered[0].p.note === 'Short staffed' && answered[1].p.word === 'seen' &&
              answered[1].p.item_id === 'SI0000000003' &&
              db.support_decisions.filter(function (d) { return d.ref === 'SF0000000001' && d.verdict === 'note'; }).length === 1 &&
              mTo.sched.item_id === 'SI0000000001' && mTo.may.approve && mTo.may.deny && mDeny.status === 200 &&
              answered[2].p.item_id === 'SI0000000001' && answered[2].p.word === 'decline' && answered[2].uid === 'U_MASTER' &&
              mOwn.sched.item_id === '' && !mOwn.may.approve && mOwnDeny.status === 403 && mVisitDeny.status === 403,
              JSON.stringify([toRow.sched, toRow.may, coRow.details, queueCallOff.length, answered, mDeny, mTo.sched,
                              mTo.may, mOwn.sched, mOwn.may, mOwnDeny, mVisitDeny]));

    // ---- My Calendar → Vacation Requests ----
    reset();
    setAll(false);
    var rOff = HUB_ACTIONS.myCalendarVacationRoute({}, userOf('eve'));
    var fOff = HUB_ACTIONS.myCalendarVacationFile({ from: '2026-10-20', to: '2026-10-22' }, userOf('eve'));
    setAll(true);
    var fNoKey = HUB_ACTIONS.myCalendarVacationFile({ from: '2026-10-20', to: '2026-10-22' }, userOf('joan'));
    var fSoon = HUB_ACTIONS.myCalendarVacationFile({ from: '2026-10-03', to: '2026-10-04' }, userOf('eve'));
    var fOk = HUB_ACTIONS.myCalendarVacationFile({ from: '2026-10-20', to: '2026-10-22', reason: 'family' }, userOf('eve'));
    var rOn = HUB_ACTIONS.myCalendarVacationRoute({}, userOf('eve'));
    var fVisit = HUB_ACTIONS.myCalendarVacationFile({ from: '2026-10-20' }, userOf('eve', { visiting_member: 'm' }));
    var vItems = db.support_inbox.filter(function (it) { return it.ref === 'SF00000000E1'; });
    stAssert_(out, P + 'My Calendar: off (or unreadable) keeps today\'s Time Off door; on, the ask is filed through ' +
                   'Scheduling\'s own time-off ask from my-calendar, its refusals pass through, both directors get an ' +
                   'informative, and the caller\'s own list reads it back; a visit is refused',
              rOff.data.on === false && fOff.data.routed === false && fNoKey.status === 403 && fSoon.status === 409 &&
              fOk.data.routed === true && fOk.data.flow_id === 'SF00000000E1' &&
              fOk.data.said === 'Asked. Both directors have it; the first answer decides.' &&
              timeOffAsked[timeOffAsked.length - 1].via === 'my-calendar' && timeOffAsked[timeOffAsked.length - 1].g.key &&
              vItems.length === 2 && vItems[0].title === 'Vacation request — Eve Tan' && rOn.data.on === true &&
              rOn.data.mine.length === 1 && rOn.data.mine[0].word === 'Waiting on the directors' && fVisit.status === 403,
              JSON.stringify([rOff.data, fOff.data, fNoKey, fSoon, fOk.data, rOn.data, fVisit]));

    // ---- the clock: a watermark first, nothing older raised ----
    reset();
    setAll(true);
    var tick1 = sdTickRun_(Date.now() + 20000);
    var wm = sdJson_((db.support_settings.filter(function (s) { return s.key === 'watermark'; })[0] || {}).value, {});
    queue.push({ id: 'r7', status: 'New', urgency: 'High', date_received: '2026-10-01T15:00:00Z', requestor: 'Late Filer',
                 requestor_phone: '3305550199', type_of_request: 'Operations - Vehicle Issue',
                 description_of_request: 'Flat tire on the van', notes: '', processed: '' });
    sdMemoDrop_();
    sdBump_();
    var tick2 = sdTickRun_(Date.now() + 20000);
    stAssert_(out, P + 'the clock: its first pass with a switch on writes the watermark and raises nothing older; a row ' +
                   'filed after it by anybody is routed on the next pass',
              tick1.watermark === true && tick1.routed === 0 && wm.parts && wm.parts.vehicle && wm.parts.vehicle.rows === 5 &&
              db.support_events.filter(function (e) { return e.kind === 'route'; }).length === 1 && tick2.routed === 1,
              JSON.stringify([tick1, wm, tick2]));

    // ---- texts the quiet window held: said again, or closed once the request is decided ----
    reset();
    setAll(true);
    supportDeskFiled_([queue[0], queue[1]], {});
    db.support_inbox.forEach(function (it) { if (/^text: /.test(it.note)) it.note = 'text: held:quiet'; });
    sdMemoDrop_();
    HUB_ACTIONS.supportDeskDecide({ ref: 'HQ6EEF063DEE', verdict: 'resolve' }, userOf('ty'));
    var before = told.length;
    smartTell_ = function (o) { told.push(copy(o)); return { situation: o.situation, state: 'sent' }; };
    var owed = sdOwedSay_('', Date.now() + 10000);
    var notes = db.support_inbox.map(function (it) { return it.ref + ':' + it.note; }).sort();
    stAssert_(out, P + 'a text the quiet window held is said again with the same key, and one whose request was ' +
                   'decided first is closed by the decision itself, never said',
              owed.said === 2 && owed.dropped === 0 && told.length === before + 2 &&
              told.slice(before).every(function (t) { return t.situation === 'sr_vehicle_request'; }) &&
              notes.filter(function (n) { return n.indexOf('HQ6EEF063DEE:text: dropped') === 0; }).length === 1 &&
              notes.filter(function (n) { return n === 'HQ5EF1CB5F25:text: sent'; }).length === 2,
              JSON.stringify([owed, notes]));
    smartTell_ = function (o) { told.push(copy(o)); return { situation: o.situation, state: 'held', held: 'test_mode', why: 'test mode' }; };

    // ---- the punch door is the relay's; the settings are the master's ----
    var punchUser = HUB_ACTIONS.supportDeskPunch({ rows: [] }, userOf('ty'));
    var punchSvc = HUB_ACTIONS.supportDeskPunch({ rows: [{ person: 'Eve Tan', verdict: 'open', pair_fault: true,
                                                            shift_at: new Date(sdNowMs_()).toISOString() }] }, { is_service: true });
    var setTy = HUB_ACTIONS.supportDeskSettingsSet({ values: { leads: 'arthur.torres@asalifecare.com' } }, userOf('ty'));
    var setBad = HUB_ACTIONS.supportDeskSettingsSet({ values: { leads: 'nobody@nowhere.x' } }, MASTER);
    var setOk = HUB_ACTIONS.supportDeskSettingsSet({ values: { payroll_to: 'brittfrench1316@gmail.com',
                                                               routes: { vehicle: ['Van Calendar'] } } }, MASTER);
    sdMemoDrop_();
    stAssert_(out, P + 'the punch door answers the relay alone; Support Requests settings are the master\'s, every ' +
                   'list re-resolved (an unknown e-mail refuses the save), routes a map of lists',
              punchUser.status === 403 && punchSvc.status === 200 && punchSvc.data.raised === 1 && setTy.status === 404 &&
              setBad.status === 400 && setBad.message.indexOf('nobody@nowhere.x') !== -1 && setOk.status === 200 &&
              setOk.data.settings.payroll_to === 'brittfrench1316@gmail.com' && sdPayrollTo_().list[0].uid === 'U_BRIT' &&
              sdRouteOf_('Operations - Vehicle Issue', sdSettings_().routes) === '',
              JSON.stringify([punchUser.status, punchSvc, setTy.status, setBad, setOk]));

    // ---- an incident: important, acked by anyone it reached, resolved by a director or the master ----
    reset();
    setAll(true);
    supportDeskIncidents_([{ timestamp: '2026-09-27T19:54:00.000Z', your_name: 'Jane Doe', client_name: 'John Client',
                             incident_category: 'Minor injury' }], 'hotline');
    var incRef = (db.support_events[0] || {}).id;
    var artAware = HUB_ACTIONS.supportDeskDecide({ ref: incRef, verdict: 'aware' }, userOf('arthur'));
    var artResolve = HUB_ACTIONS.supportDeskDecide({ ref: incRef, verdict: 'resolve' }, userOf('arthur'));
    var mIncAware = HUB_ACTIONS.supportDeskDecide({ ref: incRef, verdict: 'aware' }, MASTER);
    var mAck = db.support_decisions.filter(function (d) { return d.ref === incRef && d.verdict === 'aware' && d.by_uid === 'U_MASTER'; });
    var mInc = HUB_ACTIONS.supportDeskDecide({ ref: incRef, verdict: 'resolve' }, MASTER);
    stAssert_(out, P + 'an incident is acknowledged by a lead it reached, never resolved by one; the master marks it ' +
                   'aware as a director does, recorded as the master\'s, and resolves it',
              artAware.status === 200 && artResolve.status === 403 && mIncAware.status === 200 && mAck.length === 1 &&
              mInc.status === 200 && mInc.data.row.status.word === 'Resolved' && mInc.data.row.completed === true,
              JSON.stringify([artAware.status, artResolve, mIncAware, mAck.length, mInc.status]));

    // ---- Redirect: one request handed to one account's My Work ----
    reset();
    setAll(false);
    // Eve's App Control gate is shut: only the seat a redirect opens lets her in
    gateOpen = { U_TY: true, U_BRIT: true, U_ART: true, U_WEL: true, U_JOAN: true };
    var RREF = 'HQ6EEF063DEE';
    var redir = function (to, who, note) {
      var p = { ref: RREF, verdict: 'redirect' };
      if (to !== undefined) p.to = to;
      if (note) p.note = note;
      return HUB_ACTIONS.supportDeskDecide(p, who);
    };
    var noTo = redir(undefined, userOf('ty'));
    var toSelf = redir('U_TY', userOf('ty'));
    var unknown = redir('U_NOPE', userOf('ty'));
    var merged = redir('U_TYOLD', userOf('ty'));
    var family = redir('U_FAM', userOf('ty'));
    var keepUsers = usersAll_;
    usersAll_ = function () { throw new Error('the accounts tab could not be read'); };
    var unreadAccounts = redir('U_EVE', userOf('ty'));
    var unreadTarget = sdRedirectTarget_('U_EVE');
    usersAll_ = keepUsers;
    var leadRedir = redir('U_EVE', userOf('arthur'));
    stAssert_(out, P + 'Redirect refuses with nobody chosen, to yourself, to an unknown, merged or non-staff account (400), ' +
                   'with the accounts unreadable (503, never "nobody") and from a lead (403) — nothing is recorded',
              noTo.status === 400 && noTo.message === 'Choose who to redirect it to.' && toSelf.status === 400 &&
              toSelf.message === 'Redirect it to someone else — it is already yours to answer.' && unknown.status === 400 &&
              merged.status === 400 && family.status === 400 && /staff account only/.test(family.message) &&
              unreadAccounts.status === 503 && /accounts could not be read/.test(unreadAccounts.message) &&
              unreadTarget.status === 503 && leadRedir.status === 403 && db.support_decisions.length === 0 &&
              db.support_inbox.length === 0,
              JSON.stringify([noTo, toSelf, unknown, merged, family, unreadAccounts, leadRedir.status]));

    var r1 = redir('U_EVE', userOf('ty'), 'Please call her back');
    var r1again = redir('U_EVE', userOf('ty'));
    var redDec = db.support_decisions.filter(function (d) { return d.verdict === 'redirected'; })[0] || {};
    var redW = sdJson_(redDec.witness, {}) || {};
    var seat1 = db.support_inbox.filter(function (it) { return it.box === 'work'; });
    var r1row = (r1.data && r1.data.row) || {};
    var r1last = (r1row.history || [])[(r1row.history || []).length - 1] || {};
    stAssert_(out, P + 'Ty redirects a request to Eve with a note: an append-only "redirected" line naming her, never ' +
                   'final (the request stays open, "Redirected to Eve Tan", waiting on her), and one My Work item ' +
                   'for her account; the same redirect again changes nothing',
              r1.status === 200 && r1.data.changed === true &&
              r1.data.said === 'Redirected to Eve Tan — it waits in their My Work.' &&
              r1row.status.word === 'Redirected to Eve Tan' && r1row.status.tone === 'waiting' && r1row.completed === false &&
              r1row.waiting_on.join(',') === 'Eve Tan' && r1last.verdict === 'redirected' && r1last.to === 'Eve Tan' &&
              r1last.by === 'Ty Bond' && r1last.note === 'Please call her back' && redDec.by_uid === 'U_TY' &&
              redW.to_uid === 'U_EVE' && redW.to_name === 'Eve Tan' && redW.item_id === (seat1[0] || {}).id &&
              seat1.length === 1 && seat1[0].to_uid === 'U_EVE' && seat1[0].state === 'waiting' &&
              seat1[0].kind === 'redirect' && seat1[0].seat === 'redirect' && /^SN[0-9A-F]{10}$/.test(seat1[0].id) &&
              seat1[0].title === 'Payroll from Angel Fiber' && seat1[0].note === 'Redirected by Ty Bond: Please call her back' &&
              seat1[0].link === '/app/support-desk/requests?ref=' + RREF &&
              r1again.status === 200 && r1again.data.changed === false && db.support_decisions.length === 1,
              JSON.stringify([r1.data && r1.data.said, r1row.status, r1last, redW, seat1, r1again.data]));

    var eveList = HUB_ACTIONS.supportDeskList({}, userOf('eve'));
    var eveSeat = HUB_ACTIONS.supportDeskSeat({ ref: RREF }, userOf('eve'));
    var eveOther = HUB_ACTIONS.supportDeskSeat({ ref: 'HQ5EF1CB5F25' }, userOf('eve'));
    var joanSeat = HUB_ACTIONS.supportDeskSeat({ ref: RREF }, userOf('joan'));
    var eveInbox = HUB_ACTIONS.supportInboxAnswer({ item_id: seat1[0].id, word: 'aware' }, userOf('eve'));
    var es = (eveSeat.data && eveSeat.data.row) || { may: {} };
    var pk = ((eveSeat.data && eveSeat.data.people) || []).map(function (x) { return x.uid; });
    stAssert_(out, P + 'Eve, her App Control gate shut, reads her one request through its seat with every answer ' +
                   'offered and the live staff accounts to redirect to (never herself, a merged or a family account); ' +
                   'the list and any other request stay shut to her; My Inbox never answers her My Work item',
              eveList.status === 404 && eveSeat.status === 200 && es.ref === RREF && es.may.approve && es.may.deny &&
              es.may.resolve && es.may.redirect && !es.may.aware && pk.indexOf('U_EVE') === -1 &&
              pk.indexOf('U_TY') !== -1 && pk.indexOf('U_TYOLD') === -1 && pk.indexOf('U_FAM') === -1 &&
              eveOther.status === 404 && joanSeat.status === 404 && eveInbox.status === 400,
              JSON.stringify([eveList.status, eveSeat.status, es.may, pk, eveOther.status, joanSeat.status, eveInbox]));

    var r2 = redir('U_JOAN', userOf('eve'), 'Joan handles payroll');
    var eveLate = HUB_ACTIONS.supportDeskDecide({ ref: RREF, verdict: 'approve' }, userOf('eve'));
    var joanList = HUB_ACTIONS.supportDeskList({}, userOf('joan')).data;
    var r3 = HUB_ACTIONS.supportDeskDecide({ ref: RREF, verdict: 'deny', note: 'Paid on the 25th' }, userOf('joan'));
    var seats = {};
    db.support_inbox.forEach(function (it) { if (it.box === 'work') seats[it.to_uid] = it; });
    stAssert_(out, P + 'Eve redirects it on to Joan from My Work: her item closes as redirected and she answers no more; ' +
                   'Joan lists it alone and denies it, which closes her item as denied',
              r2.status === 200 && r2.data.changed === true && eveLate.status === 404 &&
              joanList.rows.length === 1 && joanList.rows[0].ref === RREF &&
              joanList.note === 'Only the requests redirected to you are shown.' && joanList.people.length > 0 &&
              r3.status === 200 && r3.data.changed === true && seats.U_EVE.state === 'redirected' &&
              seats.U_EVE.answered_by === 'Eve Tan' && seats.U_JOAN.state === 'denied' &&
              seats.U_JOAN.answered_by === 'Joan Cheruiyot',
              JSON.stringify([r2.status, eveLate, joanList.rows.length, joanList.note, r3.status, seats]));

    var late409 = redir('U_EVE', userOf('ty'));
    var joan409 = HUB_ACTIONS.supportDeskDecide({ ref: RREF, verdict: 'approve' }, userOf('joan'));
    var joanSame = HUB_ACTIONS.supportDeskDecide({ ref: RREF, verdict: 'deny' }, userOf('joan'));
    var histRow = HUB_ACTIONS.supportDeskList({ completed: true }, userOf('ty')).data.rows
      .filter(function (r) { return r.ref === RREF; })[0] || { history: [] };
    var said = histRow.history.map(function (h) { return [h.verdict, h.to || '', h.by].join('/'); });
    stAssert_(out, P + 'the 409 law holds: a redirect after the final verdict, or another verdict from the last holder, is ' +
                   '409; the same verdict again changes nothing; the history says who redirected it to whom',
              late409.status === 409 && late409.message.indexOf('Already denied by Joan Cheruiyot at ') === 0 &&
              joan409.status === 409 && joanSame.status === 200 && joanSame.data.changed === false &&
              histRow.status.word === 'Denied' && histRow.completed === true &&
              said.join(',') === 'redirected/Eve Tan/Ty Bond,redirected/Joan Cheruiyot/Eve Tan,denied//Joan Cheruiyot',
              JSON.stringify([late409, joan409.status, joanSame.data, said]));

    var mRedir = HUB_ACTIONS.supportDeskDecide({ ref: 'HQ5EF1CB5F25', verdict: 'redirect', to: 'U_EVE' }, MASTER);
    var eveResolve = HUB_ACTIONS.supportDeskDecide({ ref: 'HQ5EF1CB5F25', verdict: 'resolve', note: 'Spare van sent' },
                                                   userOf('eve'));
    var eveApproveGone = HUB_ACTIONS.supportDeskSeat({ ref: 'HQ5EF1CB5F25' }, userOf('eve'));
    var schedRedir = (function () {
      flows = [{ id: 'SF0000000001', kind: 'time_off', state: 'waiting', date: '2026-10-20', date_to: '2026-10-22',
                 person: 'Eve Tan', person_uid: 'U_EVE', source: 'platform', source_ref: '', created_at: '2026-10-01T15:00:00.000Z',
                 seats: JSON.stringify([{ seat: 'director', state: 'waiting', to: [{ uid: 'U_TY', name: 'Ty Bond' }] }]) }];
      schedItems = [{ id: 'SI0000000001', flow_id: 'SF0000000001', box: 'work', kind: 'approval', seat: 'director',
                      to_uid: 'U_TY', state: 'waiting' }];
      sdMemoDrop_();
      sdBump_();
      return HUB_ACTIONS.supportDeskDecide({ ref: 'SF0000000001', verdict: 'redirect', to: 'U_EVE' }, userOf('ty'));
    })();
    stAssert_(out, P + 'the master may redirect, as a director does; the holder resolves it; a Scheduling request is never ' +
                   'redirected here — its seats are Scheduling\'s',
              mRedir.status === 200 && eveResolve.status === 200 && eveResolve.data.changed === true &&
              eveApproveGone.status === 404 && schedRedir.status === 400 && answered.length === 0,
              JSON.stringify([mRedir.status, eveResolve, eveApproveGone.status, schedRedir]));

    stAlertReceive_(out, { reset: reset, setAll: setAll, userOf: userOf, MASTER: MASTER, ACC: ACC,
                           db: function () { return db; }, told: function () { return told; } });
  } finally {
    STUBS.forEach(function (n) { G[n] = keep[n]; });
    HUB_ACTIONS.schedulingAnswer = keepAnswer;
    SD_VERSION_KEY = keepVars.version;
    SD_DUE_KEY = keepVars.due;
    SD_NOW = keepVars.now;
    HUB_MEMBER_CTX = keepVars.member;
    sdMemoDrop_();
  }
}

// Settings > Alerts I receive, inside the Support Requests stand-ins: the door answers the directors and the master…
function stAlertReceive_(out, h) {
  var P = 'alerts I receive: ';
  var WIDE = '["admin","director","manager","staff"]';
  var keepVars = { cacheKey: AR_CACHE_KEY, masterEmail: HUB_MASTER_EMAIL_CACHE, now: SD_NOW };
  var tyPhones = h.ACC.ty.phones;
  AR_CACHE_KEY = 'ar_receive_off_selftest';
  HUB_MASTER_EMAIL_CACHE = h.MASTER.email;
  h.ACC.boss = { userid: h.MASTER.id, displayname: 'Master', email: h.MASTER.email, emails: '',
                 phone: '+13305550199', phones: '', active: 'TRUE', role: 'admin' };
  var fresh = function () { h.reset(); h.setAll(true); arCacheDrop_(); SD_NOW = '2026-10-01T16:00:00Z'; };
  var set = function (who, part, on) { return HUB_ACTIONS.alertReceiveSet({ part: part, receive: on }, who); };
  var itemsTo = function (ref) {
    return h.db().support_inbox.filter(function (it) { return it.ref === ref; }).map(function (it) { return it.to_uid; })
      .sort().join(',');
  };
  try {
    var bad = AR_ACTIONS.filter(function (a) {
      var p = HUB_POLICY[a];
      return !p || p.file !== 'AlertReceive.gs' || typeof HUB_ACTIONS[a] !== 'function' || p.store !== 'sheet' ||
             JSON.stringify(p.roles) !== WIDE || (p.emits || []).length || (p.invalidates || []).length;
    });
    stAssert_(out, P + 'two actions in AlertReceive.gs, the wide roles (the gate decides), sending nothing; the read ' +
                   'is a read and the write a tool with typed params',
              bad.length === 0 && AR_ACTIONS.length === 2 && HUB_POLICY.alertReceiveGet.lane === 'read' &&
              HUB_POLICY.alertReceiveSet.lane === 'tool' && HUB_POLICY.alertReceiveSet.params.part.type === 'string' &&
              HUB_POLICY.alertReceiveSet.params.receive.type === 'boolean' &&
              JSON.stringify(AR_PARTS) === '["no_call","punch","incident"]', bad.join(', '));

    // ---- who has the section ----
    fresh();
    var gTy = HUB_ACTIONS.alertReceiveGet({}, h.userOf('ty'));
    var gMaster = HUB_ACTIONS.alertReceiveGet({}, h.MASTER);
    var refused = [HUB_ACTIONS.alertReceiveGet({}, h.userOf('arthur')), HUB_ACTIONS.alertReceiveGet({}, h.userOf('eve')),
                   HUB_ACTIONS.alertReceiveGet({}, h.userOf('ty', { visiting_member: 'mem_1' })),
                   HUB_ACTIONS.alertReceiveGet({}, { is_service: true }), HUB_ACTIONS.alertReceiveGet({}, null),
                   HUB_ACTIONS.alertReceiveGet({}, { id: h.MASTER.id, email: h.MASTER.email, role: 'admin',
                                                     visiting_member: 'mem_1' }),
                   set(h.userOf('arthur'), 'incident', false), set(h.userOf('eve'), 'no_call', false)];
    stAssert_(out, P + 'a director and the master read their three alerts, every one on; a lead, staff, a visit, the ' +
                   'service and nobody get 404 Unknown action from both doors',
              gTy.status === 200 && gTy.data.as === 'director' &&
              JSON.stringify(gTy.data.receive) === '{"no_call":true,"punch":true,"incident":true}' &&
              gTy.data.saveable === true && gMaster.status === 200 && gMaster.data.as === 'master' &&
              refused.every(function (r) { return r.status === 404 && r.message === 'Unknown action.'; }) &&
              h.db().support_settings.length === 0, JSON.stringify([gTy, gMaster, refused]));

    // ---- the write ----
    var s1 = set(h.userOf('ty'), 'no_call', false);
    var s2 = set(h.userOf('ty'), 'punch', false);
    var s3 = set(h.userOf('ty'), 'punch', true);
    var badPart = set(h.userOf('ty'), 'late_show', false);
    var badWord = HUB_ACTIONS.alertReceiveSet({ part: 'incident', receive: 'no' }, h.userOf('ty'));
    var row = h.db().support_settings.filter(function (r) { return r.key === 'receive_off:U_TY'; });
    var gAfter = HUB_ACTIONS.alertReceiveGet({}, h.userOf('ty'));
    stAssert_(out, P + 'each save is one switch of the caller\'s own row, keyed by the session, never a payload; a part ' +
                   'outside the three and a word that is not true or false are 400',
              s1.status === 200 && s1.data.receive.no_call === false && s2.data.receive.punch === false &&
              s3.status === 200 && s3.data.receive.punch === true && s3.data.receive.no_call === false &&
              badPart.status === 400 && badWord.status === 400 && row.length === 1 && row[0].value === 'no_call' &&
              row[0].updated_by === 'Ty Bond' && gAfter.data.receive.no_call === false && gAfter.data.receive.punch === true &&
              h.db().support_settings.length === 1, JSON.stringify([s1, s3, badPart, row, gAfter]));

    // ---- the cut, at send time ----
    supportDeskAttendance_([{ kind: 'no_call', row: { person: 'Eve Tan', day: '2026-10-01', house: 'BM' } },
                            { kind: 'late_show', row: { person: 'Cy Far', day: '2026-10-01', house: 'BM' } }],
                           '2026-10-01');
    var nc = h.db().support_events.filter(function (e) { return e.kind === 'no_call'; })[0] || {};
    var ls = h.db().support_events.filter(function (e) { return e.kind === 'late_show'; })[0] || {};
    var ncItem = h.db().support_inbox.filter(function (it) { return it.ref === nc.id; })[0] || {};
    stAssert_(out, P + 'Ty turned No Call No Show off: the request is still raised, its red item reaches Brittany ' +
                   'alone and says which alert it is; the Late Show he never turned off reaches them both',
              !!nc.id && itemsTo(nc.id) === 'U_BRIT' && ncItem.alert === 'no_call' && !!ls.id &&
              itemsTo(ls.id) === 'U_BRIT,U_TY', JSON.stringify([itemsTo(nc.id), itemsTo(ls.id), ncItem.alert]));

    fresh();
    set(h.userOf('ty'), 'punch', false);
    set(h.userOf('brit'), 'incident', false);
    supportDeskPunchNoted_([{ id: 'b1', person: 'Eve Tan', house_name: 'BM', shift_code: '8A-4P',
                              shift_at: '2026-10-01T08:00:00-04:00', verdict: 'missing', pair_fault: true }], 'board');
    var pev = h.db().support_events.filter(function (e) { return e.kind === 'punch'; })[0] || {};
    var pTold = h.told().filter(function (t) { return t.situation === 'sr_punch_aware'; });
    supportDeskIncidents_([{ timestamp: '2026-10-01T13:00:00.000Z', your_name: 'Jane Doe', client_name: 'John Client',
                             incident_category: 'Minor injury', incident_location: 'BM4060' }], 'hotline');
    var iev = h.db().support_events.filter(function (e) { return e.kind === 'incident'; })[0] || {};
    var iItems = h.db().support_inbox.filter(function (it) { return it.ref === iev.id; });
    stAssert_(out, P + 'Ty turned "is not punching in" off: its item and its text reach Brittany and the two leads, ' +
                   'never Ty; Brittany turned Incident filed off: the incident reaches Ty and the two leads',
              itemsTo(pev.id) === 'U_ART,U_BRIT,U_WEL' && pTold.length >= 1 &&
              pTold.every(function (t) { return t.key.slice(-5) !== '|U_TY'; }) &&
              h.db().support_inbox.filter(function (it) { return it.ref === pev.id; })
                .every(function (it) { return it.alert === 'punch'; }) &&
              itemsTo(iev.id) === 'U_ART,U_TY,U_WEL' && iItems.every(function (it) { return it.alert === 'incident'; }),
              JSON.stringify([itemsTo(pev.id), pTold.map(function (t) { return t.key; }), itemsTo(iev.id)]));

    // ---- the pages: the row's addresses and numbers ----
    fresh();
    set(h.userOf('ty'), 'no_call', false);
    var dests = ['ty.bond@asalifecare.com', 'TY.BOND@abrighterdawninc.com', '+1 (330) 555-0101', 'lead@example.org',
                 '+13305550102'];
    var keptNc = staffAlertReceivers_('no_call', dests);
    var keptLs = staffAlertReceivers_('late_show', dests);
    var keptInc = commIncidentReceivers_(dests);
    h.ACC.ty.phones = JSON.stringify([{ label: 'Group', number: '+13305550102' }]);
    sdMemoDrop_();
    var keptShared = staffAlertReceivers_('no_call', ['+13305550102', 'ty.bond@asalifecare.com']);
    h.ACC.ty.phones = tyPhones;
    sdMemoDrop_();
    stAssert_(out, P + 'the No Show No Call letter and text leave out every address and number of Ty\'s own, in any ' +
                   'case or format, and keep everyone else; a Late Show and the incident page keep them all; a number ' +
                   'another account also carries is never taken out',
              JSON.stringify(keptNc) === '["lead@example.org","+13305550102"]' &&
              JSON.stringify(keptLs) === JSON.stringify(dests) && JSON.stringify(keptInc) === JSON.stringify(dests) &&
              JSON.stringify(keptShared) === '["+13305550102"]',
              JSON.stringify([keptNc, keptLs, keptInc, keptShared]));

    // ---- only the holders, and only while they hold it ----
    fresh();
    h.db().support_settings.push({ key: 'receive_off:U_ART', value: 'incident, no_call', note: '', updated_at: '',
                                   updated_by: '' });
    set(h.MASTER, 'incident', false);
    set(h.userOf('ty'), 'no_call', false);
    var lane = arLane_();
    supportDeskIncidents_([{ timestamp: '2026-10-01T14:00:00.000Z', your_name: 'Jane Doe', client_name: 'Ann Client',
                             incident_category: 'Fall' }], 'platform');
    var iev2 = h.db().support_events.filter(function (e) { return e.kind === 'incident'; })[0] || {};
    var bundle = stCode_(HUB_ACTIONS.configLane);
    stAssert_(out, P + 'the config lane carries the holders\' choices by account id — the master\'s and Ty\'s, never a ' +
                   'row left by a lead, who is still told; the lane is handed to the relay and the master alone',
              JSON.stringify(lane) === '{"U_MASTER":["incident"],"U_TY":["no_call"]}' &&
              itemsTo(iev2.id) === 'U_ART,U_BRIT,U_TY,U_WEL' &&
              bundle.indexOf('out.alert_receive_off = arLane_()') !== -1 &&
              bundle.indexOf("typeof arLane_ === 'function' && typeof hubMyWorkHideLaneFor_ === 'function' && " +
                             'hubMyWorkHideLaneFor_(user)') !== -1, JSON.stringify([lane, itemsTo(iev2.id)]));

    // ---- what cannot be read cuts nobody ----
    fresh();
    set(h.userOf('ty'), 'no_call', false);
    var keepDb = h.db().support_settings;
    delete h.db().support_settings;
    arCacheDrop_();
    sdMemoDrop_();
    var gBroken = HUB_ACTIONS.alertReceiveGet({}, h.userOf('ty'));
    var sBroken = set(h.userOf('ty'), 'punch', false);
    var keptBroken = staffAlertReceivers_('no_call', ['ty.bond@asalifecare.com']);
    h.db().support_settings = keepDb;
    stAssert_(out, P + 'a settings house that cannot be read answers 503 to the read and the write and cuts nobody',
              gBroken.status === 503 && sBroken.status === 503 && arReceives_('U_TY', 'no_call') === true &&
              JSON.stringify(keptBroken) === '["ty.bond@asalifecare.com"]', JSON.stringify([gBroken, sBroken]));

    // ---- the doors that send, wired ----
    var punchSrc = stCode_(HUB_ACTIONS.staffAttendancePunch);
    var sweepSrc = stCode_(HUB_ACTIONS.staffAttendanceSweep);
    var incSrc = stCode_(commIncidentFiled_);
    stAssert_(out, P + 'the punch door and the mailbox sweep cut both legs after the escalation joins, a row nobody is ' +
                   'left for is done and filed under its own word, and the incident page keeps every entry\'s place',
              punchSrc.indexOf('staffAlertReceivers_(item.kind, mailTo)') !== -1 &&
              punchSrc.indexOf('staffAlertReceivers_(item.kind, plan.numbers)') >
                punchSrc.indexOf('staffAlertEscalation_(person, day)') &&
              punchSrc.indexOf('out.off++') !== -1 && sweepSrc.indexOf('staffAlertReceivers_(parsed.kind, toHere)') !== -1 &&
              sweepSrc.indexOf('staffAlertReceivers_(parsed.kind, plan.numbers)') >
                sweepSrc.indexOf('staffAlertEscalation_(parsed.person') &&
              sweepSrc.indexOf("gatedWord = 'held-receivers-off'") !== -1 &&
              incSrc.indexOf('commIncidentReceivers_(addresses)') !== -1 && incSrc.indexOf('paged.indexOf(dest)') !== -1,
              '');
  } finally {
    AR_CACHE_KEY = keepVars.cacheKey;
    HUB_MASTER_EMAIL_CACHE = keepVars.masterEmail;
    SD_NOW = keepVars.now;
    h.ACC.ty.phones = tyPhones;
    delete h.ACC.boss;
    try { CacheService.getScriptCache().remove('ar_receive_off_selftest'); } catch (e) {}
    sdMemoDrop_();
  }
}
