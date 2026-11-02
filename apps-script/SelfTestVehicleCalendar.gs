// Transportation (vehicle-calendar): the clock words, the request's refusals in their order, the first answer and…
function stVehicleCalendar_(out) {
  var P = 'vehicle calendar: ';
  var G = (typeof globalThis !== 'undefined') ? globalThis : this;

  // ---- the pure words ----
  stAssert_(out, P + 'overlap is half-open: back-to-back is free, a shared minute is not',
            !vcOverlap_({ s: 0, e: 10 }, { s: 10, e: 20 }) && vcOverlap_({ s: 0, e: 11 }, { s: 10, e: 20 }) &&
            vcOverlap_({ s: 12, e: 13 }, { s: 10, e: 20 }), '');
  var fall = vcWallToMs_('2026-11-01T01:30');
  var spring = vcWallToMs_('2026-03-08T02:30');
  var winter = vcWallToMs_('2026-12-01T09:00');
  var summer = vcWallToMs_('2026-10-07T13:00');
  stAssert_(out, P + 'the Eastern wall clock: the fall-back hour reads as EDT, the spring-forward hour is refused, ' +
                 'winter is -05:00 and summer -04:00',
            fall.ms === Date.parse('2026-11-01T01:30:00-04:00') && spring.status === 400 &&
            spring.message === 'That time does not exist in Eastern Time (the clocks jump forward).' &&
            winter.ms === Date.parse('2026-12-01T09:00:00-05:00') && summer.ms === Date.parse('2026-10-07T13:00:00-04:00') &&
            vcIso_(summer.ms) === '2026-10-07T13:00:00-04:00' && vcIso_(winter.ms) === '2026-12-01T09:00:00-05:00' &&
            vcWallToMs_('2026-02-30T09:00').status === 400,
            JSON.stringify([fall, spring, winter, summer, vcIso_(summer.ms)]));
  stEq_(out, P + 'when, one day', vcWhenWords_('2026-10-07T13:00:00-04:00', '2026-10-07T15:20:00-04:00'),
        'Wed Oct 7, 1:00 PM – 3:20 PM');
  stEq_(out, P + 'when, across days', vcWhenWords_('2026-10-07T13:00:00-04:00', '2026-10-08T09:00:00-04:00'),
        'Oct 7, 1:00 PM – Oct 8, 9:00 AM');
  stEq_(out, P + 'when, for a text (plain hyphen)', vcWhenWords_('2026-10-07T13:00:00-04:00', '2026-10-07T15:20:00-04:00', true),
        'Wed Oct 7, 1:00 PM - 3:20 PM');

  // ---- the declarations ----
  var SENDS = { vehicleCalendarRequest: true, vehicleCalendarAnswer: true, vehicleCalendarTripSave: true };
  var bad = [];
  VC_ACTIONS.forEach(function (a) {
    var p = HUB_POLICY[a];
    if (!p || typeof HUB_ACTIONS[a] !== 'function') { bad.push(a + ': undeclared'); return; }
    if (['VehicleCalendar.gs', 'VehicleCalendarFlows.gs'].indexOf(p.file) === -1) bad.push(a + ': file ' + p.file);
    if ((a === 'vehicleCalendarBoard' ? 'read' : 'tool') !== p.lane || p.store !== 'sheet') bad.push(a + ': lane ' + p.lane);
    if (JSON.stringify(p.roles) !== '["admin","director","manager","staff"]') bad.push(a + ': roles');
    if ((p.invalidates || []).length) bad.push(a + ': invalidates');
    if (JSON.stringify(p.emits || []) !== (SENDS[a] ? '["smsSend"]' : '[]')) bad.push(a + ': emits ' + JSON.stringify(p.emits));
    Object.keys(p.params || {}).forEach(function (k) { if (!p.params[k] || !p.params[k].type) bad.push(a + ': ' + k + ' untyped'); });
  });
  stAssert_(out, P + 'nine actions, the wide roles (the gate decides), typed params, no slice invalidated, and smsSend ' +
                 'declared on Request, Answer and TripSave alone', bad.length === 0 && VC_ACTIONS.length === 9, bad.join('; '));

  var seeds = {};
  SMART_EXTRA_SITUATIONS_SEED.forEach(function (s) { seeds[s.id] = s; });
  var seedBad = [];
  VC_SITUATIONS.forEach(function (id) {
    var s = seeds[id];
    if (!s) { seedBad.push(id + ' absent'); return; }
    if (s.enabled !== 'yes' || s.kind !== 'letter' || s.channels !== 'sms' || s.to !== '' || !vcStr_(s.sms_text)) {
      seedBad.push(id + ' ' + s.enabled + '/' + s.kind + '/' + s.channels);
    }
    if (/[^\x00-\x7F]/.test(String(s.sms_text))) seedBad.push(id + ' leaves the GSM alphabet');
  });
  var askText = String((seeds.transport_request_ask || {}).sms_text || '');
  stAssert_(out, P + 'the three transport_* situations are seeded ON as letters with ASCII SMS words, and the ask carries ' +
                 'the requester, the vehicle, the time, the wheelchair answer and the My Work link',
            seedBad.length === 0 && ['{requester}', '{vehicle}', '{when}', '{wheelchair}', '{link}', '{details}']
              .every(function (t) { return askText.indexOf(t) !== -1; }), seedBad.join('; ') + ' ' + askText);
  var pruned = smartPruneUnfilled_(smartRender_(askText, { requester: 'Taylor Brooks', vehicle: 'Van', when: 'Wed Oct 7, 1:00 PM - 3:20 PM',
                                                          staff: 'Taylor Brooks', trip_type: 'Work', wheelchair: 'No',
                                                          link: 'https://x/#/app/my-work', sender: 'ASA' }));
  stAssert_(out, P + 'an empty phone, client or details drops only its own sentence, never the request itself',
            /^Vehicle request waiting for your approval: Taylor Brooks asks for the Van, Wed Oct 7/.test(pruned) &&
            pruned.indexOf('Phone:') === -1 && pruned.indexOf('Client:') === -1 && pruned.indexOf('Details:') === -1 &&
            pruned.indexOf('Approve or decline in My Work') !== -1, pruned);

  var vcCode = [];
  for (var gn in G) {
    if (/^vc[A-Z]/.test(gn) && typeof G[gn] === 'function') vcCode.push({ n: gn, c: stCode_(G[gn]) });
  }
  Object.keys(HUB_ACTIONS).forEach(function (a) {
    if (/^vehicleCalendar/.test(a) && typeof HUB_ACTIONS[a] === 'function') vcCode.push({ n: a, c: stCode_(HUB_ACTIONS[a]) });
  });
  var forbidden = ['rpcCall_(', 'insertSheet', 'schedInbox_(', 'commCallOffRecorded_', 'rpcOpenPhoneSms_', 'hubLetterSend_',
                   'smartRender_(', ['Be', 'Another'].join('')];
  var hits = [];
  vcCode.forEach(function (f) { forbidden.forEach(function (w) { if (f.c.indexOf(w) !== -1) hits.push(f.n + ' ' + w); }); });
  var sitsUsed = [];
  vcCode.forEach(function (f) {
    (f.c.match(/'transport_[a-z_]+'/g) || []).forEach(function (m) {
      var id = m.slice(1, -1);
      if (sitsUsed.indexOf(id) === -1) sitsUsed.push(id);
    });
  });
  stAssert_(out, P + 'Transportation never knocks the door itself: no rpcCall_, no insertSheet, no Scheduling inbox, no ' +
                 'rendering — vcSay_ hands each text to smartTell_ — and every situation it names is seeded',
            hits.length === 0 && vcCode.length > 40 && /\bsmartTell_\s*\(/.test(stCode_(vcSay_)) &&
            sitsUsed.length >= 3 && sitsUsed.every(function (id) { return !!seeds[id]; }),
            hits.join(', ') + ' / ' + sitsUsed.join(','));
  var sweep = stCode_(HUB_ACTIONS.hiringSweep);
  stAssert_(out, P + 'the clock left hiringSweep: the relay rings Python\'s (app/vc_clock*)',
            sweep.indexOf('vcClockTick_()') === -1, '');

  // ---- the stand-ins ----
  var STUBS = ['vcRead_', 'vcWrite_', 'hubProfileAppGate_', 'hubIsRealMaster_', 'usersAll_', 'cpRosterBuild_',
               'spDriverIndex_', 'smartTell_', 'hubTestModeState_', 'hubSysLog_', 'csTransportBook_', 'cpProfileEditDoor_'];
  var keep = {};
  STUBS.forEach(function (n) { keep[n] = G[n]; });
  var keepVars = { now: VC_NOW, ver: VC_BOARD_VERSION_KEY, due: VC_DUE_KEY, people: VC_PEOPLE_KEY, clients: VC_CLIENTS_KEY,
                   drivers: VC_DRIVERS_KEY, member: (typeof HUB_MEMBER_CTX !== 'undefined') ? HUB_MEMBER_CTX : null };
  var run = 'st' + Date.now() + Math.floor(Math.random() * 1000);
  var gen = 0;
  var reset = function () {
    gen++;
    VC_PEOPLE_KEY = 'vc_people_' + run + '_' + gen;
    VC_CLIENTS_KEY = 'vc_clients_' + run + '_' + gen;
    VC_DRIVERS_KEY = 'vc_drivers_' + run + '_' + gen;
    VC_MEMO = {};
    VC_ROWS_MEMO = {};
    VC_BOARD_MEMO = {};
    vcBump_();
  };
  try {
    VC_NOW = '2026-10-05T14:00:00Z';
    VC_BOARD_VERSION_KEY = 'vc_board_v_' + run;
    VC_DUE_KEY = 'vc_due_at_' + run;
    HUB_MEMBER_CTX = null;
    var STORE = { vc_vehicles: [], vc_trips: [], vc_inbox: [], vc_log: [], vc_settings: [] };
    var FAIL = {};
    var copy = function (v) { return JSON.parse(JSON.stringify(v)); };
    vcRead_ = function (tab) {
      if (FAIL[tab]) throw new Error(FAIL[tab]);
      if (!STORE[tab]) throw new Error('No Transportation house is called "' + tab + '".');
      return copy(STORE[tab]);
    };
    vcWrite_ = function (tab, rows, appendOnly) {
      if (FAIL[tab]) throw new Error(FAIL[tab]);
      var idf = tab === 'vc_settings' ? 'key' : 'id';
      (rows || []).forEach(function (r) {
        var row = {};
        VC_HEADERS[tab].forEach(function (h) {
          var v = Object.prototype.hasOwnProperty.call(r, h) ? r[h] : '';
          row[h] = v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v == null ? '' : v);
        });
        var at = -1;
        if (!appendOnly) STORE[tab].forEach(function (x, i) { if (x[idf] === row[idf]) at = i; });
        if (at === -1) STORE[tab].push(row); else STORE[tab][at] = row;
      });
      vcBump_();
      return (rows || []).length;
    };
    var USERS = [
      { userid: 'USR_MASTER', email: 'boss@x', displayname: 'Boss Master', role: 'admin', active: 'TRUE' },
      { userid: 'USR_8F7DD2A6B756', email: 'ty.bond@abrighterdawninc.com', displayname: 'Ty Bond', role: 'admin',
        active: 'TRUE', phone: '937-716-6410', emails: '["ty.bond@asalifecare.com","bondtt@muohio.edu"]' },
      { userid: 'USR_425E6461EBCD', email: 'ty.bond@asalifecare.com', displayname: 'Ty Bond', role: 'admin',
        active: 'FALSE', mergedinto: 'USR_8F7DD2A6B756', phone: '937-716-6410' },
      { userid: 'USR_B08C57743A1E', email: 'brittfrench1316@gmail.com', displayname: 'Brittany Anderson', role: 'staff',
        active: 'TRUE', phone: '+17272379704' },
      { userid: 'U_TAYLOR', email: 'taylor@x', displayname: 'Taylor Brooks', role: 'staff', active: 'TRUE',
        phone: '330-555-0101' },
      { userid: 'U_SAM', email: 'sam@x', displayname: 'Sam Lee', role: 'staff', active: 'TRUE', phone: '330-555-0102' },
      { userid: 'U_PAT1', email: 'pat1@x', displayname: 'Pat Kim', role: 'staff', active: 'TRUE' },
      { userid: 'U_PAT2', email: 'pat2@x', displayname: 'Pat Kim', role: 'staff', active: 'TRUE' },
      { userid: 'U_KAY', email: 'kay@x', displayname: 'Kay Client', role: 'client', active: 'TRUE' }
    ];
    usersAll_ = function () { return copy(USERS); };
    var OPEN = { boss: true, taylor: true, sam: true, ty: false, brit: false };
    var WHO = { boss: 'USR_MASTER', ty: 'USR_8F7DD2A6B756', brit: 'USR_B08C57743A1E', taylor: 'U_TAYLOR', sam: 'U_SAM' };
    var user = function (w, extra) {
      var u = null;
      USERS.forEach(function (x) { if (x.userid === WHO[w]) u = x; });
      var o = { id: u.userid, email: u.email, display_name: u.displayname, role: u.role };
      for (var k in (extra || {})) o[k] = extra[k];
      return o;
    };
    var whoOf = function (u) {
      var hit = '';
      Object.keys(WHO).forEach(function (w) { if (u && WHO[w] === u.id) hit = w; });
      return hit;
    };
    hubProfileAppGate_ = function (app, u) {
      return { open: app === VC_APP_ID && !!u && !u.is_service && !!OPEN[whoOf(u)], scope: null };
    };
    hubIsRealMaster_ = function (u) { return !!u && u.email === 'boss@x' && !u.visiting_member && !u.is_service; };
    var LORI = clientNameKey_('Lori Schmucker'), BETH = clientNameKey_('Beth Ann Sutter');
    cpRosterBuild_ = function () {
      return { clients: [{ client_key: BETH, name: 'Beth Ann Sutter', status: 'active' },
                         { client_key: LORI, name: 'Lori Schmucker', status: 'active' }] };
    };
    var DRIVERS = {
      'employee driver': [['Employee', 'First Name', 'Last Name', 'Driver', 'DL #', 'Points', 'License Exp Date'],
                          ['Taylor Brooks', 'Taylor', 'Brooks', 'Yes', 'X1234567', '0', '2030-01-01'],
                          ['Sam Lee', 'Sam', 'Lee', 'Yes', 'Y7654321', '2', '2030-01-01']],
      'Driver Compliance': [['Employee', 'Driver'], ['Taylor Brooks', 'Yes'], ['Sam Lee', 'Suspended']]
    };
    spDriverIndex_ = function (tab) { return spDriverIndexFrom_(DRIVERS[tab], 'America/New_York'); };
    var TOLD = [];
    var TELL = { state: 'held', held: 'test_mode', why: 'test mode' };
    smartTell_ = function (o) { TOLD.push(copy(o)); var r = copy(TELL); r.situation = o.situation; return r; };
    hubTestModeState_ = function () { return { on: true }; };
    hubSysLog_ = function () {};
    reset();

    // ---- the seed, a dry run first ----
    var boss = user('boss');
    var dry = HUB_ACTIONS.vehicleCalendarSeed({}, boss);
    var refused = HUB_ACTIONS.vehicleCalendarSeed({ dry_run: false }, user('taylor'));
    stAssert_(out, P + 'the seed is a dry run unless asked otherwise, writes nothing then, and is the master\'s alone',
              dry.status === 200 && dry.data.dry_run === true && dry.data.report.vehicles.add.join(',') === 'Van,Mazda,Ford' &&
              dry.data.report.settings.add.length === 5 && STORE.vc_vehicles.length === 0 && STORE.vc_settings.length === 0 &&
              refused.status === 403, JSON.stringify([dry, refused]));
    var applied = HUB_ACTIONS.vehicleCalendarSeed({ dry_run: false }, boss);
    reset();
    var again = HUB_ACTIONS.vehicleCalendarSeed({ dry_run: false }, boss);
    reset();
    var VAN = vcSeedId_('Van'), MAZDA = vcSeedId_('Mazda'), FORD = vcSeedId_('Ford');
    var van = STORE.vc_vehicles.filter(function (v) { return v.id === VAN; })[0] || {};
    stAssert_(out, P + 'applied: the Van (6 seats, accessible, blue), the Mazda and the Ford with their Van Calendar names; ' +
                   'a second seed keeps everything and adds nothing',
              applied.status === 200 && STORE.vc_vehicles.length === 3 && /^VV[0-9A-F]{10}$/.test(VAN) && van.seats === '6' &&
              van.wheelchair_accessible === 'yes' && van.tint === 'blue' && van.aliases === 'Van|Wheelchair Van - 1|Wheelchair Van' &&
              again.status === 200 && again.data.report.vehicles.add.length === 0 && again.data.report.settings.add.length === 0 &&
              STORE.vc_vehicles.length === 3, JSON.stringify([applied.status, again.data && again.data.report, van]));
    stEq_(out, P + 'the details line', vcVehicleOut_(van).details, 'Wheelchair-accessible van · 6 seats · Wheelchair accessible');

    // ---- the directors: Ty by his old address lands on the live account, never the merged one ----
    var st = vcSettings_();
    stAssert_(out, P + 'directors: ty.bond@asalifecare.com resolves to USR_8F7DD2A6B756 (the merged row never answers) and ' +
                   'brittfrench1316@gmail.com to USR_B08C57743A1E',
              st.directors_readable && st.directors.length === 2 && st.directors[0].uid === 'USR_8F7DD2A6B756' &&
              st.directors[1].uid === 'USR_B08C57743A1E' && st.directors_why === '', JSON.stringify(st.directors) + st.directors_why);
    FAIL.vc_settings = 'st: settings unreadable';
    reset();
    var stDown = vcSettings_();
    stAssert_(out, P + 'an unreadable settings house falls back to the shipped list and says so',
              !stDown.readable && stDown.directors_readable && stDown.directors.length === 2 &&
              /could not be read, so the shipped list is used/.test(stDown.directors_why), stDown.directors_why);
    delete FAIL.vc_settings;
    var keptDirectors = STORE.vc_settings.filter(function (r) { return r.key === 'directors'; })[0];
    keptDirectors.value = 'nobody@x';
    reset();
    var stNone = vcSettings_();
    var shut = HUB_ACTIONS.vehicleCalendarRequest({ vehicle_id: VAN }, user('taylor'));
    stAssert_(out, P + 'directors fail closed: a list that resolves to nobody refuses every request with 503',
              !stNone.directors_readable && /No live account answers nobody@x/.test(stNone.directors_why) &&
              shut.status === 503 && /^Nobody is set to approve vehicle requests: /.test(shut.message), JSON.stringify(shut));
    keptDirectors.value = VC_SETTING_DEFAULTS.directors;
    reset();

    // ---- the request's refusals, in their order ----
    var people = vcPeople_(), clients = vcClients_();
    var TAYLOR = clientNameKey_('Taylor Brooks'), SAM = clientNameKey_('Sam Lee');
    stAssert_(out, P + 'the staff list: live staff-side accounts only, a name two accounts wear is left out and said',
              !!people.byKey[TAYLOR] && !people.byKey[clientNameKey_('Pat Kim')] && !people.byKey[clientNameKey_('Kay Client')] &&
              /worn by two live accounts/.test(people.why), JSON.stringify(people.rows));
    var form = function (o) {
      var f = { vehicle_id: VAN, staff_key: TAYLOR, start: '2026-10-07T13:00', end: '2026-10-07T15:20', client_key: LORI,
                trip_type: 'Doctor appointment', details: 'Primary care follow-up', wheelchair_required: false };
      for (var k in (o || {})) f[k] = o[k];
      return f;
    };
    var trip = function (o) {
      var t = { id: vcNewId_('VT'), state: 'scheduled', vehicle_id: VAN, requested_vehicle_id: VAN,
                start_at: '2026-10-07T13:00:00-04:00', end_at: '2026-10-07T15:00:00-04:00', day: '2026-10-07',
                end_known: 'yes', wheelchair_required: 'no', trip_type: 'Work', purpose: 'Work', client_key: BETH,
                client_name: 'Beth Ann Sutter', staff_key: SAM, staff_name: 'Sam Lee', driver_key: SAM, driver_name: 'Sam Lee',
                requested_by_uid: 'U_SAM', requested_by_name: 'Sam Lee', source: 'platform', told: '{}', test_mode: 'yes',
                created_at: '2026-10-01T12:00:00.000Z' };
      for (var k in (o || {})) t[k] = o[k];
      return t;
    };
    var setAvail = function (id, a) {
      STORE.vc_vehicles.forEach(function (v) { if (v.id === id) v.availability = a; });
    };
    var check = function (f, trips) {
      return vcRequestCheck_(f, { vehicles: copy(STORE.vc_vehicles), trips: trips || [], people: people, clients: clients,
                                  settings: vcSettings_(), now: vcNow_() });
    };
    var msg = function (r) { return r && r.status ? r.status + ' ' + r.message : 'ok'; };
    var longText = new Array(1002).join('x');
    var cases = [
      ['4 vehicle', form({ vehicle_id: 'VV0000000000' }), null, '400 Choose a vehicle.'],
      ['5 staff', form({ staff_key: 'nobody' }), null, '400 Choose a staff member.'],
      ['6 trip type', form({ trip_type: 'Picnic' }), null, '400 Choose a trip type.'],
      ['7 end after start', form({ end: '2026-10-07T13:00' }), null, '400 The end must be after the start.'],
      ['8 fourteen days', form({ end: '2026-10-22T13:00' }), null, '400 A reservation can be at most 14 days.'],
      ['9 passed', form({ start: '2026-10-05T09:00', end: '2026-10-05T11:00' }), null, '400 That start has already passed.'],
      ['11 wheelchair, Mazda', form({ vehicle_id: MAZDA, wheelchair_required: true }), null,
       '400 The Mazda is not wheelchair accessible — choose the Van.'],
      ['11 wheelchair, Ford', form({ vehicle_id: FORD, wheelchair_required: true }), null,
       '400 The Ford is not wheelchair accessible — choose the Van.'],
      ['12 booked', form(), [trip({ start_at: '2026-10-07T12:00:00-04:00', end_at: '2026-10-07T13:30:00-04:00' })],
       '409 The Van is booked Wed Oct 7, 12:00 PM – 1:30 PM — choose another vehicle or time.'],
      ['13 staff has a trip', form({ vehicle_id: FORD }),
       [trip({ state: 'requested', vehicle_id: '', requested_vehicle_id: MAZDA, staff_key: TAYLOR, driver_key: TAYLOR,
               start_at: '2026-10-07T14:00:00-04:00', end_at: '2026-10-07T16:00:00-04:00' })],
       '409 Taylor Brooks already has a trip then (Mazda, 2:00 PM – 4:00 PM).'],
      ['14 client', form({ client_key: 'nobodyclient' }), null, '400 Choose a client from the list.'],
      ['15 details', form({ details: longText }), null, '400 Trip details can be at most 1000 characters.'],
      ['order 4 before 5', form({ vehicle_id: 'VV0000000000', staff_key: 'nobody' }), null, '400 Choose a vehicle.'],
      ['order 6 before 7', form({ trip_type: 'Picnic', end: '2026-10-07T12:00' }), null, '400 Choose a trip type.'],
      ['order 12 before 14', form({ client_key: 'nobodyclient' }),
       [trip({ start_at: '2026-10-07T12:00:00-04:00', end_at: '2026-10-07T13:30:00-04:00' })],
       '409 The Van is booked Wed Oct 7, 12:00 PM – 1:30 PM — choose another vehicle or time.'],
      ['order 14 before 15', form({ client_key: 'nobodyclient', details: longText }), null, '400 Choose a client from the list.'],
      ['wheelchair, the Van', form({ wheelchair_required: true }), null, 'ok'],
      ['back-to-back is free', form(), [trip({ start_at: '2026-10-07T11:00:00-04:00', end_at: '2026-10-07T13:00:00-04:00' })], 'ok']
    ];
    var wrong = [];
    cases.forEach(function (c) { var got = msg(check(c[1], c[2])); if (got !== c[3]) wrong.push(c[0] + ': ' + got); });
    setAvail(MAZDA, 'maintenance');
    var maint = msg(check(form({ vehicle_id: MAZDA, wheelchair_required: true })));
    if (maint !== '409 The Mazda is in maintenance — choose another vehicle.') wrong.push('10 maintenance (before 11): ' + maint);
    setAvail(MAZDA, 'out_of_service');
    var oos = msg(check(form({ vehicle_id: MAZDA })));
    if (oos !== '409 The Mazda is out of service — choose another vehicle.') wrong.push('10 out of service: ' + oos);
    setAvail(MAZDA, 'available');
    var pend = check(form(), [trip({ state: 'requested', vehicle_id: '', staff_key: SAM, driver_key: SAM })]);
    stAssert_(out, P + 'the request refuses in its order (4 vehicle … 15 details): wheelchair refuses the Mazda and the ' +
                   'Ford and takes the Van, back-to-back is free, and a waiting request on the same vehicle is a warning',
              wrong.length === 0 && pend.ok === true && pend.warnings.length === 1 &&
              pend.warnings[0] === 'Another request for the Van is waiting for the same time — the first one approved gets it.',
              wrong.join(' | ') + ' / ' + JSON.stringify(pend));
    var visit = HUB_ACTIONS.vehicleCalendarRequest(form(), user('taylor', { visiting_member: 'X' }));
    var closed = HUB_ACTIONS.vehicleCalendarRequest(form(), user('ty'));
    stAssert_(out, P + 'the gate: a closed app is Unknown action, a visit is refused',
              closed.status === 404 && visit.status === 403 && visit.message === VC_VISITING_SENTENCE, JSON.stringify([closed, visit]));

    // ---- a request lands: two waiting items, two texts through Smart Comms ----
    TOLD = [];
    var req = HUB_ACTIONS.vehicleCalendarRequest(form(), user('taylor'));
    var T1 = req.data && req.data.trip_id;
    var t1 = STORE.vc_trips.filter(function (t) { return t.id === T1; })[0] || {};
    var items1 = STORE.vc_inbox.filter(function (r) { return r.trip_id === T1; });
    var facts1 = items1.length ? JSON.parse(items1[0].facts) : [];
    var told1 = JSON.parse(t1.told || '{}');
    stAssert_(out, P + 'a request: requested, nothing reserved, the driver is the staff member, one waiting My Work item per ' +
                   'director with the facts, the panel told who has it',
              req.status === 200 && /^VT[0-9A-F]{10}$/.test(T1) && t1.state === 'requested' && t1.vehicle_id === '' &&
              t1.requested_vehicle_id === VAN && t1.driver_key === TAYLOR && t1.start_at === '2026-10-07T13:00:00-04:00' &&
              t1.client_name === 'Lori Schmucker' && t1.source === 'platform' && items1.length === 2 &&
              items1.every(function (r) { return r.box === 'work' && r.kind === 'approval' && r.state === 'waiting' &&
                                                 r.link === '/app/my-work' && r.title === 'Vehicle request — Taylor Brooks' &&
                                                 r.id === 'VI' + vcSha10_(T1 + '|work|approval|' + r.to_uid); }) &&
              facts1[0].label === 'Requested by' && facts1[0].value === 'Taylor Brooks · 330-555-0101' &&
              facts1.map(function (f) { return f.label; }).join('|') ===
                'Requested by|Vehicle|When|Staff|Client|Trip type|Wheelchair-accessible vehicle|Details' &&
              req.data.said === 'Requested. Ty Bond and Brittany Anderson have it — the first answer decides.' &&
              !!req.data.board, JSON.stringify(req).slice(0, 600));
    stAssert_(out, P + 'the ask is handed to Smart Comms once per director, to their own number, under the trip\'s key; the ' +
                   'outcome (held by test mode) is written on the trip and said in the panel',
              TOLD.length === 2 && TOLD[0].situation === 'transport_request_ask' && TOLD[0].to === '+19377166410' &&
              TOLD[1].to === '+17272379704' && TOLD[0].key === 'vc|transport_request_ask|' + T1 + '|USR_8F7DD2A6B756' &&
              TOLD[0].lane === 'transportation' && TOLD[0].prune === true && TOLD[0].vars.wheelchair === 'No' &&
              TOLD[0].vars.requester_phone === '330-555-0101' && /\/#\/app\/my-work$/.test(TOLD[0].vars.link) &&
              told1.ask && told1.ask.USR_8F7DD2A6B756.held === 'test_mode' && !(told1.owed || []).length &&
              (req.data.warnings || []).join(' ').indexOf('Test mode is on') !== -1, JSON.stringify([TOLD, told1]));

    // ---- the answer: the seat decides, the first answer wins ----
    var tyItem = items1.filter(function (r) { return r.to_uid === 'USR_8F7DD2A6B756'; })[0];
    var britItem = items1.filter(function (r) { return r.to_uid === 'USR_B08C57743A1E'; })[0];
    var notMine = HUB_ACTIONS.vehicleCalendarAnswer({ item_id: tyItem.id, word: 'approve' }, user('brit'));
    var visiting = HUB_ACTIONS.vehicleCalendarAnswer({ item_id: tyItem.id, word: 'approve' }, user('ty', { visiting_member: 'U_SAM' }));
    var badId = HUB_ACTIONS.vehicleCalendarAnswer({ item_id: 'SI0000000000', word: 'approve' }, user('ty'));
    TOLD = [];
    var yes = HUB_ACTIONS.vehicleCalendarAnswer({ item_id: tyItem.id, word: 'approve' }, user('ty'));
    var late = HUB_ACTIONS.vehicleCalendarAnswer({ item_id: britItem.id, word: 'decline' }, user('brit'));
    t1 = STORE.vc_trips.filter(function (t) { return t.id === T1; })[0];
    var after = {};
    STORE.vc_inbox.forEach(function (r) { if (r.trip_id === T1) after[r.to_uid + '|' + r.box] = r; });
    stAssert_(out, P + 'the answer is the seat\'s: another\'s item 403 names who it waits on, a visit 403, a bad id 400',
              notMine.status === 403 && notMine.message === 'This one is waiting on Ty Bond.' && visiting.status === 403 &&
              badId.status === 400 && badId.message === 'Unknown item.', JSON.stringify([notMine, visiting, badId]));
    stAssert_(out, P + 'Ty approves first: the trip is scheduled on the Van, Brittany\'s item is superseded by Ty, the ' +
                   'requester has an informative and a text; Brittany\'s late decline changes nothing and is told who answered',
              yes.status === 200 && yes.data.changed === true && yes.data.state === 'approved' && t1.state === 'scheduled' &&
              t1.vehicle_id === VAN && t1.decided_by_name === 'Ty Bond' &&
              after['USR_8F7DD2A6B756|work'].state === 'approved' && after['USR_B08C57743A1E|work'].state === 'superseded' &&
              after['USR_B08C57743A1E|work'].answered_by === 'Ty Bond' && after['U_TAYLOR|inbox'] &&
              after['U_TAYLOR|inbox'].title === 'Your vehicle request was approved' &&
              after['U_TAYLOR|inbox'].link === '/app/vehicle-calendar/calendar?trip=' + T1 &&
              TOLD.length === 1 && TOLD[0].situation === 'transport_request_decided' && TOLD[0].to === '+13305550101' &&
              TOLD[0].vars.result === 'approved' && TOLD[0].vars.by === 'Ty Bond' &&
              late.status === 200 && late.data.changed === false && late.data.said === 'Already answered by Ty Bond.' &&
              !yes.data.board, JSON.stringify([yes, late]).slice(0, 700));

    // a request whose requester also holds an item answers nothing
    var own = trip({ state: 'requested', vehicle_id: '', requested_by_uid: 'USR_8F7DD2A6B756', requested_by_name: 'Ty Bond',
                     start_at: '2026-10-09T09:00:00-04:00', end_at: '2026-10-09T10:00:00-04:00', day: '2026-10-09' });
    STORE.vc_trips.push(own);
    var ownItem = vcInboxRow_(own, 'work', 'approval', 'director', { uid: 'USR_8F7DD2A6B756', name: 'Ty Bond' }, 't', 'b', [], '/app/my-work');
    STORE.vc_inbox.push(ownItem);
    var self = HUB_ACTIONS.vehicleCalendarAnswer({ item_id: ownItem.id, word: 'approve' }, user('ty'));
    stAssert_(out, P + 'nobody answers their own request', self.status === 403, JSON.stringify(self));

    // two requests for the same Van and hour: the second approval lands in Needs assignment
    reset();
    var rA = HUB_ACTIONS.vehicleCalendarRequest(form({ staff_key: SAM, start: '2026-10-08T09:00', end: '2026-10-08T11:30' }), user('sam'));
    var rB = HUB_ACTIONS.vehicleCalendarRequest(form({ start: '2026-10-08T10:00', end: '2026-10-08T12:00' }), user('taylor'));
    var itemOf = function (tid, uid) {
      return STORE.vc_inbox.filter(function (r) { return r.trip_id === tid && r.to_uid === uid && r.box === 'work'; })[0];
    };
    var aA = HUB_ACTIONS.vehicleCalendarAnswer({ item_id: itemOf(rA.data.trip_id, 'USR_8F7DD2A6B756').id, word: 'approve' }, user('ty'));
    var aB = HUB_ACTIONS.vehicleCalendarAnswer({ item_id: itemOf(rB.data.trip_id, 'USR_B08C57743A1E').id, word: 'approve' }, user('brit'));
    var tB = STORE.vc_trips.filter(function (t) { return t.id === rB.data.trip_id; })[0];
    stAssert_(out, P + 'approve with a clash: recorded as approved, the trip waits in Needs assignment with the reason, and ' +
                   'the second request was warned when it was filed',
              (rB.data.warnings || [])[0] === 'Another request for the Van is waiting for the same time — the first one approved gets it.' &&
              aA.data.state === 'approved' && aB.status === 200 && aB.data.state === 'approved' && tB.state === 'needs_assignment' &&
              tB.vehicle_id === '' && tB.assign_note === 'Approved, but the Van was booked by then — choose a vehicle.' &&
              /^Approved, but the Van was booked by then/.test(aB.data.said), JSON.stringify([rB.data.warnings, aB, tB]).slice(0, 600));

    // decline, withdraw
    reset();
    var rC = HUB_ACTIONS.vehicleCalendarRequest(form({ start: '2026-10-12T09:00', end: '2026-10-12T10:00' }), user('taylor'));
    TOLD = [];
    var no = HUB_ACTIONS.vehicleCalendarAnswer({ item_id: itemOf(rC.data.trip_id, 'USR_B08C57743A1E').id, word: 'decline',
                                                note: 'The van is booked for a client outing' }, user('brit'));
    var tC = STORE.vc_trips.filter(function (t) { return t.id === rC.data.trip_id; })[0];
    var toldNo = TOLD.slice();
    var rD = HUB_ACTIONS.vehicleCalendarRequest(form({ start: '2026-10-13T09:00', end: '2026-10-13T10:00' }), user('taylor'));
    var wOther = HUB_ACTIONS.vehicleCalendarWithdraw({ trip_id: rD.data.trip_id }, user('sam'));
    var wOwn = HUB_ACTIONS.vehicleCalendarWithdraw({ trip_id: rD.data.trip_id }, user('taylor'));
    var tD = STORE.vc_trips.filter(function (t) { return t.id === rD.data.trip_id; })[0];
    var dItems = STORE.vc_inbox.filter(function (r) { return r.trip_id === rD.data.trip_id && r.box === 'work'; });
    var lateD = HUB_ACTIONS.vehicleCalendarAnswer({ item_id: dItems[0].id, word: 'approve' }, user(dItems[0].to_uid === 'USR_8F7DD2A6B756' ? 'ty' : 'brit'));
    stAssert_(out, P + 'decline tells the requester with the note; only the requester withdraws, the items close, and an ' +
                   'answer after it is told the request was withdrawn',
              no.data.state === 'declined' && tC.state === 'declined' && tC.decision_note === 'The van is booked for a client outing' &&
              toldNo.length === 1 && toldNo[0].vars.result === 'declined' && toldNo[0].vars.note === 'The van is booked for a client outing' &&
              wOther.status === 403 && wOwn.status === 200 && wOwn.data.said === 'Withdrawn.' && tD.state === 'cancelled' &&
              dItems.every(function (r) { return r.state === 'closed'; }) && lateD.data && lateD.data.changed === false &&
              lateD.data.said === 'The request was withdrawn.', JSON.stringify([no, wOther, wOwn, lateD]).slice(0, 600));

    // ---- the directors' trip panel ----
    reset();
    OPEN.ty = true;
    var notEditor = HUB_ACTIONS.vehicleCalendarTripSave({ trip_id: tB.id, status: 'scheduled' }, user('taylor'));
    var stillBooked = HUB_ACTIONS.vehicleCalendarTripSave({ trip_id: rB.data.trip_id, status: 'scheduled' }, user('ty'));
    var rE = HUB_ACTIONS.vehicleCalendarRequest(form({ start: '2026-10-14T09:00', end: '2026-10-14T10:00' }), user('taylor'));
    var waitE = HUB_ACTIONS.vehicleCalendarTripSave({ trip_id: rE.data.trip_id, status: 'scheduled' }, user('ty'));
    var samBusy = HUB_ACTIONS.vehicleCalendarTripSave({ trip_id: tB.id, status: 'scheduled', vehicle_id: MAZDA,
                                                        driver_key: SAM }, user('ty'));
    var loose = trip({ state: 'needs_assignment', vehicle_id: '', requested_vehicle_id: FORD, staff_key: TAYLOR,
                       driver_key: TAYLOR, start_at: '2026-10-16T09:00:00-04:00', end_at: '2026-10-16T10:00:00-04:00',
                       day: '2026-10-16' });
    STORE.vc_trips.push(loose);
    var suspended = HUB_ACTIONS.vehicleCalendarTripSave({ trip_id: loose.id, status: 'scheduled', vehicle_id: FORD,
                                                          driver_key: SAM }, user('ty'));
    var withTaylor = HUB_ACTIONS.vehicleCalendarTripSave({ trip_id: tB.id, status: 'scheduled', vehicle_id: MAZDA,
                                                           driver_key: TAYLOR }, user('ty'));
    var tB2 = STORE.vc_trips.filter(function (t) { return t.id === tB.id; })[0];
    var clash = HUB_ACTIONS.vehicleCalendarTripSave({ trip_id: tB.id, status: 'scheduled', vehicle_id: VAN }, user('ty'));
    stAssert_(out, P + 'trip panel: the directors alone; a waiting request is answered, not set; a driver already driving ' +
                   'then and a driver the Employee Database suspends are refused; a free vehicle and a cleared driver ' +
                   'schedule it; a booked vehicle is refused',
              notEditor.status === 403 && notEditor.message === 'Only the directors assign trips.' && stillBooked.status === 409 && /^The Van is booked /.test(stillBooked.message) &&
              waitE.status === 400 && waitE.message === 'A waiting request is approved or declined by the directors — not set here.' &&
              samBusy.status === 409 && samBusy.message === 'Sam Lee already drives the Van then (9:00 AM – 11:30 AM).' &&
              suspended.status === 409 && suspended.message === 'Sam Lee is not cleared to drive (Employee Database).' &&
              withTaylor.status === 200 && tB2.state === 'scheduled' && tB2.vehicle_id === MAZDA && tB2.driver_key === TAYLOR &&
              clash.status === 409 && /^The Van is booked /.test(clash.message),
              JSON.stringify([notEditor, stillBooked, waitE, samBusy, suspended, withTaylor.status, clash]).slice(0, 700));
    TOLD = [];
    var cancel = HUB_ACTIONS.vehicleCalendarTripSave({ trip_id: tB.id, status: 'cancelled', note: 'Appointment moved' }, user('ty'));
    var tB3 = STORE.vc_trips.filter(function (t) { return t.id === tB.id; })[0];
    var cInfo = STORE.vc_inbox.filter(function (r) { return r.trip_id === tB.id && r.box === 'inbox'; })[0] || {};
    var again2 = HUB_ACTIONS.vehicleCalendarTripSave({ trip_id: tB.id, status: 'scheduled' }, user('ty'));
    stAssert_(out, P + 'cancel: the trip lets the vehicle go, the requester has an informative and a text, and a cancelled ' +
                   'trip is not changed again',
              cancel.status === 200 && tB3.state === 'cancelled' && tB3.vehicle_id === '' &&
              cInfo.title === 'Your trip was cancelled' && TOLD.length === 1 && TOLD[0].situation === 'transport_trip_cancelled' &&
              TOLD[0].vars.note === 'Appointment moved' && again2.status === 409, JSON.stringify([cancel.data && cancel.data.said, cInfo, TOLD]));

    // ---- out of service ----
    reset();
    var past = trip({ start_at: '2026-10-01T09:00:00-04:00', end_at: '2026-10-01T10:00:00-04:00', day: '2026-10-01' });
    var future = trip({ start_at: '2026-10-20T09:00:00-04:00', end_at: '2026-10-20T10:00:00-04:00', day: '2026-10-20' });
    var futureMazda = trip({ vehicle_id: MAZDA, requested_vehicle_id: MAZDA, start_at: '2026-10-20T09:00:00-04:00',
                             end_at: '2026-10-20T10:00:00-04:00', day: '2026-10-20' });
    STORE.vc_trips.push(past, future, futureMazda);
    var dup = HUB_ACTIONS.vehicleCalendarVehicleSave({ vehicle_id: VAN, name: 'mazda', description: 'x', seats: 6,
                                                       wheelchair_accessible: true, availability: 'available' }, user('ty'));
    var seats = HUB_ACTIONS.vehicleCalendarVehicleSave({ vehicle_id: VAN, name: 'Van', description: 'x', seats: 0,
                                                         wheelchair_accessible: true, availability: 'available' }, user('ty'));
    var oosSave = HUB_ACTIONS.vehicleCalendarVehicleSave({ vehicle_id: VAN, name: 'Van', description: 'Wheelchair-accessible van',
                                                           seats: 6, wheelchair_accessible: true,
                                                           availability: 'out_of_service' }, user('ty'));
    var byId = function (id) { return STORE.vc_trips.filter(function (t) { return t.id === id; })[0]; };
    var moved = STORE.vc_log.filter(function (l) { return l.via === 'unassigned_by_vehicle'; });
    stAssert_(out, P + 'out of service: the Van\'s future scheduled trips go back to Needs assignment with the reason, a past ' +
                   'one stays, another vehicle\'s stay; a name already worn and a seat count out of 1-60 are refused',
              dup.status === 409 && seats.status === 400 && oosSave.status === 200 &&
              /^Saved\. \d+ scheduled trips? went back to Needs assignment\.$/.test(oosSave.data.said) &&
              byId(future.id).state === 'needs_assignment' && byId(future.id).vehicle_id === '' &&
              byId(future.id).assign_note === 'The Van was taken out of service — choose another vehicle.' &&
              byId(past.id).state === 'scheduled' && byId(futureMazda.id).state === 'scheduled' &&
              moved.some(function (l) { return l.trip_id === future.id; }) && !moved.some(function (l) { return l.trip_id === past.id; }),
              JSON.stringify([dup, seats, oosSave.data && oosSave.data.said, byId(future.id), byId(past.id)]).slice(0, 700));
    var added = HUB_ACTIONS.vehicleCalendarVehicleSave({ name: 'Bus', description: 'Ford Transit', seats: 12,
                                                         wheelchair_accessible: false, availability: 'available' }, user('ty'));
    var bus = STORE.vc_vehicles.filter(function (v) { return v.name === 'Bus'; })[0] || {};
    stAssert_(out, P + 'a new vehicle gets its own id, the next free tint and the last place',
              added.status === 200 && /^VV[0-9A-F]{10}$/.test(bus.id) && bus.tint === 'lilac' && bus.order === '4' &&
              added.data.vehicle_id === bus.id, JSON.stringify(bus));
    setAvail(VAN, 'available');
    reset();

    // ---- the board and its privacy cut ----
    var bTy = HUB_ACTIONS.vehicleCalendarBoard({}, user('ty')).data;
    var bSam = HUB_ACTIONS.vehicleCalendarBoard({}, user('sam')).data;
    var otherOf = function (b, id) { return b.trips.filter(function (t) { return t.id === id; })[0] || {}; };
    var priv = otherOf(bSam, T1), full = otherOf(bTy, T1), samOwn = otherOf(bSam, futureMazda.id);
    var vanCard = bTy.vehicles.filter(function (v) { return v.id === VAN; })[0] || {};
    var mazdaCard = bTy.vehicles.filter(function (v) { return v.id === MAZDA; })[0] || {};
    var PHONE = /\+1\d{10}|\b\d{3}-\d{3}-\d{4}\b/;
    stAssert_(out, P + 'privacy: somebody else\'s trip reaches a non-editor as when and on what alone (private, no client, ' +
                   'no staff); a director reads it whole; the requester reads their own',
              priv.private === true && priv.client_name === undefined && priv.staff_name === undefined && priv.mine === false &&
              priv.vehicle_id !== undefined && priv.trip_type === undefined && full.client_name === 'Lori Schmucker' && full.private === undefined &&
              samOwn.mine === true && samOwn.client_name === 'Beth Ann Sutter', JSON.stringify([priv, samOwn]).slice(0, 500));
    stAssert_(out, P + 'the board: vehicle status cards with the next booking, the KPIs, the pickers, the drivers to editors ' +
                   'only, the stamp in Eastern, and no phone number anywhere',
              bTy.ok === true && bTy.vehicles.length === 4 && vanCard.status.word === 'Available' && !!mazdaCard.next_trip && mazdaCard.next_trip.id === futureMazda.id &&
              vanCard.details === 'Wheelchair-accessible van · 6 seats · Wheelchair accessible' &&
              typeof bTy.kpis.needs_assignment === 'number' && bTy.kpis.in_service === 4 && !!bTy.drivers &&
              bTy.drivers[TAYLOR].may_drive === true && bTy.drivers[SAM].may_drive === false && bSam.drivers === undefined &&
              bSam.viewer.can_edit === false && bTy.viewer.can_edit === true && bTy.viewer.is_director === true &&
              / Eastern$/.test(bTy.stamp) && bTy.people.length >= 4 && bTy.clients.length === 2 &&
              !PHONE.test(JSON.stringify(bTy)) && !PHONE.test(JSON.stringify(bSam)),
              JSON.stringify([vanCard, bTy.kpis, bTy.viewer]).slice(0, 600));
    var inUseTrip = trip({ start_at: '2026-10-05T09:30:00-04:00', end_at: '2026-10-05T11:00:00-04:00', day: '2026-10-05' });
    STORE.vc_trips.push(inUseTrip);
    reset();
    var bNow = HUB_ACTIONS.vehicleCalendarBoard({}, user('ty')).data;
    var inUse = otherOf(bNow, inUseTrip.id), done = otherOf(bNow, past.id);
    var vanNow = bNow.vehicles.filter(function (v) { return v.id === VAN; })[0] || {};
    stAssert_(out, P + 'In use and Completed are read at the instant of the read, never stored',
              inUse.word === 'In use' && done.word === 'Completed' && vanNow.status.word === 'In use' &&
              vanNow.active_trip.id === inUseTrip.id && byId(inUseTrip.id).state === 'scheduled', JSON.stringify([inUse.word, done.word, vanNow.status]));

    // ---- the clock says what the quiet window held, under the same key ----
    reset();
    var owedTrip = trip({ state: 'requested', vehicle_id: '', start_at: '2026-10-21T09:00:00-04:00',
                          end_at: '2026-10-21T10:00:00-04:00', day: '2026-10-21' });
    owedTrip.told = JSON.stringify({ owed: [{ sit: 'transport_request_ask', bucket: 'ask', uid: 'USR_8F7DD2A6B756', name: 'Ty Bond',
                                              key: 'vc|transport_request_ask|' + owedTrip.id + '|USR_8F7DD2A6B756',
                                              vars: { requester: 'Sam Lee' }, while: 'requested' }] });
    STORE.vc_trips.push(owedTrip);
    CacheService.getScriptCache().remove(VC_DUE_KEY);
    VC_NOW = '2026-10-06T03:30:00Z';
    var night = vcClockTick_();
    VC_NOW = '2026-10-06T12:05:00Z';
    CacheService.getScriptCache().remove(VC_DUE_KEY);
    TOLD = [];
    TELL = { state: 'sent', held: '', why: '' };
    var morning = vcClockTick_();
    var toldO = JSON.parse(byId(owedTrip.id).told);
    stAssert_(out, P + 'the clock: at night it waits for 08:00; after it, the owed text is said with the same key and its ' +
                   'outcome recorded',
              night.ran === false && night.why === 'quiet hours' && morning.ran === true && TOLD.length === 1 &&
              TOLD[0].key === 'vc|transport_request_ask|' + owedTrip.id + '|USR_8F7DD2A6B756' &&
              toldO.ask.USR_8F7DD2A6B756.state === 'sent' && !(toldO.owed || []).length, JSON.stringify([night, morning, toldO]));
    TELL = { state: 'held', held: 'test_mode', why: 'test mode' };
    VC_NOW = '2026-10-05T14:00:00Z';

    // ---- Support Requests reads the same truth ----
    reset();
    var rF = HUB_ACTIONS.vehicleCalendarRequest(form({ start: '2026-10-15T09:00', end: '2026-10-15T10:00' }), user('taylor'));
    var supTy = vcSupportRows_(user('ty'));
    var supSam = vcSupportRows_(user('sam'));
    var rowF = supTy.rows.filter(function (r) { return r.ref === rF.data.trip_id; })[0] || {};
    var samRows = supSam.rows.filter(function (r) { return r.requestor.uid !== 'U_SAM'; });
    stAssert_(out, P + 'Support Requests rows: the trip id as ref, Operations · Vehicle Request, waiting on both directors, ' +
                   'approve and deny only to a seat holder, the client to directors only, never a phone; a staff member ' +
                   'reads their own requests alone',
              supTy.readable === true && rowF.source === 'transportation' && rowF.kind === 'vehicle_request' &&
              rowF.type.display === 'Operations · Vehicle Request' && rowF.route === 'vehicle' &&
              rowF.status.word === 'Waiting on Ty Bond, Brittany Anderson' && rowF.status.tone === 'waiting' &&
              rowF.may.approve === true && rowF.may.deny === true && rowF.may.resolve === false &&
              /^VI[0-9A-F]{10}$/.test(rowF.vc.item_id) && rowF.link === '/app/vehicle-calendar/calendar?trip=' + rF.data.trip_id &&
              rowF.details.some(function (d) { return d.label === 'Client'; }) && !PHONE.test(JSON.stringify(supTy)) &&
              samRows.length === 0 && supSam.rows.every(function (r) { return !r.details.some(function (d) { return d.label === 'Client'; }); }) &&
              typeof supTy.version === 'string', JSON.stringify(rowF).slice(0, 700));
    var viaSupport = vcSupportDecide_(rF.data.trip_id, 'approve', '', user('ty'));
    var viaSupportLate = vcSupportDecide_(rF.data.trip_id, 'deny', '', user('brit'));
    stAssert_(out, P + 'Support Requests decides through the same answer door: approve passes through, a late deny is told ' +
                   'who answered',
              viaSupport.status === 200 && viaSupport.data.changed === true && viaSupport.data.state === 'approved' &&
              viaSupportLate.status === 200 && viaSupportLate.data.changed === false &&
              viaSupportLate.data.said === 'Already answered by Ty Bond.', JSON.stringify([viaSupport, viaSupportLate]));

    // ---- the master stands in on a director seat ----
    reset();
    var rM = HUB_ACTIONS.vehicleCalendarRequest(form({ start: '2026-10-16T09:00', end: '2026-10-16T10:00' }), user('taylor'));
    var rMine = HUB_ACTIONS.vehicleCalendarRequest(form({ start: '2026-10-17T09:00', end: '2026-10-17T10:00' }), user('boss'));
    var mItems = STORE.vc_inbox.filter(function (r) { return r.trip_id === rM.data.trip_id && r.box === 'work'; });
    var mineItems = STORE.vc_inbox.filter(function (r) { return r.trip_id === rMine.data.trip_id && r.box === 'work'; });
    var bossBoard = HUB_ACTIONS.vehicleCalendarBoard({}, user('boss')).data;
    var samBoard = HUB_ACTIONS.vehicleCalendarBoard({}, user('sam')).data;
    var bossWait = bossBoard.waiting.filter(function (w) { return w.trip_id === rM.data.trip_id; });
    var bossSup = vcSupportRows_(user('boss'));
    var bossRow = bossSup.rows.filter(function (r) { return r.ref === rM.data.trip_id; })[0] || {};
    var bossOwnRow = bossSup.rows.filter(function (r) { return r.ref === rMine.data.trip_id; })[0] || {};
    var mVisit = HUB_ACTIONS.vehicleCalendarAnswer({ item_id: mItems[0].id, word: 'approve' },
                                                   user('boss', { visiting_member: 'U_SAM' }));
    var mSam = HUB_ACTIONS.vehicleCalendarAnswer({ item_id: mItems[0].id, word: 'approve' }, user('sam'));
    var mOwn = HUB_ACTIONS.vehicleCalendarAnswer({ item_id: mineItems[0].id, word: 'approve' }, user('boss'));
    TOLD = [];
    var mYes = HUB_ACTIONS.vehicleCalendarAnswer({ item_id: mItems[0].id, word: 'approve' }, user('boss'));
    var tM = STORE.vc_trips.filter(function (t) { return t.id === rM.data.trip_id; })[0] || {};
    var mAfter = STORE.vc_inbox.filter(function (r) { return r.trip_id === rM.data.trip_id && r.box === 'work'; });
    stAssert_(out, P + 'the master decides a director seat as a director does: the master\'s board and Support rows carry ' +
                   'one seat per request the master did not file; the trip and both items name the master; the ' +
                   'requester alone is told; never during a visit, never the master\'s own request, and a staff member ' +
                   'still cannot',
              bossWait.length === 1 && mItems.some(function (r) { return r.id === bossWait[0].item_id; }) &&
              !bossBoard.waiting.some(function (w) { return w.trip_id === rMine.data.trip_id; }) &&
              samBoard.waiting.length === 0 && bossRow.may && bossRow.may.approve === true &&
              /^VI[0-9A-F]{10}$/.test(bossRow.vc.item_id) && bossOwnRow.may && bossOwnRow.may.approve === false &&
              mVisit.status === 403 && mSam.status === 403 && mOwn.status === 403 &&
              mYes.status === 200 && mYes.data.changed === true && tM.state === 'scheduled' &&
              tM.decided_by_uid === 'USR_MASTER' && tM.decided_by_name === 'Boss Master' &&
              mAfter.filter(function (r) { return r.state === 'approved' && r.answered_by === 'Boss Master'; }).length === 1 &&
              mAfter.filter(function (r) { return r.state === 'superseded' && r.answered_by === 'Boss Master'; }).length === 1 &&
              TOLD.length === 1 && TOLD[0].situation === 'transport_request_decided' && TOLD[0].to === '+13305550101',
              JSON.stringify([bossWait, bossRow.may, bossOwnRow.may, mVisit, mSam, mOwn, mYes, tM.decided_by_name, TOLD]).slice(0, 900));
    var rN = HUB_ACTIONS.vehicleCalendarRequest(form({ start: '2026-10-18T09:00', end: '2026-10-18T10:00' }), user('taylor'));
    var viaSupportBoss = vcSupportDecide_(rN.data.trip_id, 'deny', 'No van that day', user('boss'));
    var viaSupportVisit = vcSupportDecide_(rN.data.trip_id, 'deny', '', user('boss', { visiting_member: 'U_SAM' }));
    stAssert_(out, P + '…and through Support Requests the same door takes the master\'s answer, never during a visit',
              viaSupportBoss.status === 200 && viaSupportBoss.data.state === 'declined' && viaSupportVisit.status === 403,
              JSON.stringify([viaSupportBoss, viaSupportVisit]));

    // ---- the Van Calendar, imported once ----
    reset();
    var head = ['Status', 'Event ID', 'Select Vehicle', 'Timestamp', 'Your Name', 'Client Name',
                'Date (Day Client Needs the Van)', 'Start Time', 'End Time', 'Why does the client need the van?',
                'Destination Address'];
    var values = [head,
      ['New', 'ev1', 'Wheelchair Van - 1', '10/1/2025 10:00:00', 'Taylor Brooks', 'Lori Schmucker', '10/16/2025', '1:00 PM', '3:00 PM', 'Social/Bingo', 'Hall'],
      ['New', 'Wheelchair Van - 1', '9/30/2026 21:41:48', 'Taylor Brooks', 'Lori Schmucker', '10/20/2026', '9:30 AM', '', 'Dr. Ray Appt', '1 Main St'],
      ['New', 'Wheelchair Van - 1', '9/30/2026 21:41:48', 'Sam Lee', 'Other', '10/20/2026', '10:00 AM', '', 'Dr. Lo Appt', '2 Main St'],
      ['New', 'ev4', 'Wheelchair Van - 1', '9/1/2026 8:00:00', 'Sam Lee', 'Karen Craney', '10/22/2026', '', '', 'Chores', ''],
      ['New', 'ev5', 'Pickup Truck', '9/1/2026 8:00:00', 'Sam Lee', 'Karen Craney', '10/23/2026', '9:00 AM', '10:00 AM', 'Chores', '']];
    var parsed = csTransportRequests_(values);
    var BOOK = { requests: parsed.rows, total: parsed.total, realigned: parsed.realigned, unread: parsed.unread,
                 conflicts: [{ row: 2, status: 'Unresolved', date: '2025-10-16', clients: 'Lori Schmucker', time: '1:30 PM - 2:00 PM', notes: '' }],
                 requests_why: '', conflicts_why: '' };
    csTransportBook_ = function () { return BOOK; };
    var before = STORE.vc_trips.length;
    var imDry = HUB_ACTIONS.vehicleCalendarImport({}, boss);
    var rep = imDry.data && imDry.data.report;
    stAssert_(out, P + 'import, dry run: the shifted rows read, an end the Van Calendar lacks is assumed, an overlap waits in ' +
                   'Needs assignment, a row with no start or an unknown vehicle is skipped with why, and nothing is written',
              imDry.status === 200 && imDry.data.dry_run === true && rep.read === 5 && rep.realigned === 2 && rep.add === 3 &&
              rep.end_assumed === 2 && rep.already === 0 && rep.skipped.length === 2 &&
              rep.skipped.some(function (s) { return s.why === 'no start time'; }) && rep.vehicles_unmatched.join() === 'Pickup Truck' &&
              rep.clients_unmatched.indexOf('Other') !== -1 && rep.conflicts.length === 1 && rep.from_today === 2 &&
              rep.first_day === '2025-10-16' && rep.last_day === '2026-10-20' && STORE.vc_trips.length === before,
              JSON.stringify(imDry).slice(0, 800));
    var imOne = HUB_ACTIONS.vehicleCalendarImport({ dry_run: false }, boss);
    reset();
    var imTwo = HUB_ACTIONS.vehicleCalendarImport({ dry_run: false }, boss);
    var imported = STORE.vc_trips.filter(function (t) { return t.source === 'import:van_calendar'; });
    var shifted = imported.filter(function (t) { return t.source_ref === 'van_calendar:r3'; })[0] || {};
    var second = imported.filter(function (t) { return t.source_ref === 'van_calendar:r4'; })[0] || {};
    var first = imported.filter(function (t) { return t.source_ref === 'van_calendar:r2'; })[0] || {};
    stAssert_(out, P + 'import, applied twice: three trips the first time under ids from their rows, nothing new the second ' +
                   '(already), no item and no text; the assumed end is marked',
              imOne.status === 200 && imOne.data.report.add === 3 && imTwo.status === 200 && imTwo.data.report.add === 0 &&
              imTwo.data.report.already === 3 && imported.length === 3 && shifted.id === 'VT' + vcSha10_('van_calendar:r3') &&
              shifted.end_known === 'no' && shifted.end_at === '2026-10-20T11:30:00-04:00' && shifted.state === 'scheduled' &&
              shifted.client_key === LORI && shifted.staff_key === TAYLOR && shifted.requested_by_name === 'Van Calendar' &&
              second.state === 'needs_assignment' && second.assign_note === 'Overlapped another Van Calendar booking' &&
              /Van Calendar conflict \(Unresolved/.test(first.assign_note) && first.end_known === 'yes' &&
              !STORE.vc_inbox.some(function (r) { return r.trip_id === shifted.id; }) &&
              STORE.vc_settings.some(function (r) { return r.key === 'imported_at' && r.value; }),
              JSON.stringify([imOne.data && imOne.data.said, imTwo.data && imTwo.data.report, shifted, second]).slice(0, 900));

    reset();
    var supAfter = vcSupportRows_(user('ty'));
    stAssert_(out, P + 'an imported Van Calendar booking is not a request: Support Requests lists platform requests only',
              supAfter.readable === true && supAfter.rows.length > 0 &&
              supAfter.rows.every(function (r) { return imported.every(function (t) { return t.id !== r.ref; }); }),
              JSON.stringify(supAfter.rows.map(function (r) { return r.ref; })));

    // ---- Clients › Transportation shows each trip once ----
    reset();
    var part = vcClientTrips_(LORI, 'Lori Schmucker', (function () { var n = {}; n[LORI] = true; return n; })());
    var cAns = csTransportAnswer_({
      client: { client_key: LORI, name: 'Lori Schmucker' }, names: (function () { var n = {}; n[LORI] = true; return n; })(),
      today: '2026-10-05', date: '2026-10-20', book: BOOK, form: { rows: [], why: '' }, visits: { rows: [], why: '' },
      repairs: { rows: [], why: '' }, fleet: { rows: [], why: '' }, punches: { rows: [], why: '', newest: '' }, vc: part
    });
    var hist = cAns.tabs.history.rows;
    var fromVc = hist.filter(function (t) { return t.source === 'vehicle_calendar'; });
    var fromBook = hist.filter(function (t) { return t.source === 'van_calendar'; });
    var vanRow = cAns.tabs.vehicles.rows.filter(function (v) { return v.fleet && v.fleet.unit === 'Van'; })[0] || {};
    stAssert_(out, P + 'Clients › Transportation: the client\'s trips from the vehicle calendar come first, a Van Calendar row ' +
                   'it imported is not shown twice, the Van joins the van the Van Calendar names, and one source line is added',
              fromVc.length >= 2 && fromBook.length === 0 &&
              fromVc.some(function (t) { return t.id === shifted.id && t.status === 'Scheduled' && t.vehicle === 'Van'; }) &&
              vanRow.vehicle === 'Wheelchair Van - 1' &&
              cAns.sources[cAns.sources.length - 1].id === 'vehicle_calendar' && cAns.sources.length === 8,
              JSON.stringify([hist.map(function (t) { return t.source + ':' + t.id + ':' + t.status; }), vanRow.vehicle]).slice(0, 700));

    // ---- Clients › Transportation: clients.transportation lends the trip panel for one client's trips ---- the…
    var LENT = {};
    var ASKED = [];
    cpProfileEditDoor_ = function (payload, u, edition) {
      ASKED.push(edition);
      if (hubIsRealMaster_(u)) return null;
      var w = whoOf(u);
      return edition === CP_EDITION_TRANSPORT && !!w && !u.visiting_member && LENT[w] === (payload && payload.client)
        ? null : { status: 404, message: 'Unknown action.' };
    };
    OPEN.ty = true;
    var cTrip = trip({ state: 'needs_assignment', vehicle_id: '', requested_vehicle_id: FORD, client_key: LORI,
                       client_name: 'Lori Schmucker', staff_key: TAYLOR, staff_name: 'Taylor Brooks', driver_key: TAYLOR,
                       driver_name: 'Taylor Brooks', requested_by_uid: 'U_TAYLOR', requested_by_name: 'Taylor Brooks',
                       start_at: '2026-10-21T09:00:00-04:00', end_at: '2026-10-21T10:00:00-04:00', day: '2026-10-21' });
    var oTrip = trip({ vehicle_id: MAZDA, requested_vehicle_id: MAZDA, start_at: '2026-10-21T12:00:00-04:00',
                       end_at: '2026-10-21T13:00:00-04:00', day: '2026-10-21', requested_by_uid: 'USR_B08C57743A1E',
                       requested_by_name: 'Brittany Anderson', staff_key: TAYLOR, staff_name: 'Taylor Brooks',
                       driver_key: TAYLOR, driver_name: 'Taylor Brooks' });
    STORE.vc_trips.push(cTrip, oTrip);
    reset();
    var tripIn = function (b, id) { return ((b && b.trips) || []).filter(function (t) { return t.id === id; })[0] || {}; };
    var byTrip = function (id) { return STORE.vc_trips.filter(function (t) { return t.id === id; })[0] || {}; };
    var move = { trip_id: cTrip.id, client: LORI, status: 'scheduled', vehicle_id: FORD, note: 'From the client page' };
    OPEN.sam = false;
    var shutBoard = HUB_ACTIONS.vehicleCalendarBoard({ client: LORI }, user('sam'));
    var shutSave = HUB_ACTIONS.vehicleCalendarTripSave(move, user('sam'));
    OPEN.sam = true;
    var appBoard = HUB_ACTIONS.vehicleCalendarBoard({ client: LORI }, user('sam')).data;
    var appSave = HUB_ACTIONS.vehicleCalendarTripSave(move, user('sam'));
    LENT.sam = BETH;
    var otherSave = HUB_ACTIONS.vehicleCalendarTripSave(move, user('sam'));
    var untouched = byTrip(cTrip.id).state === 'needs_assignment';
    stAssert_(out, P + 'Clients: without clients.transportation for this client, an account the app is not released to ' +
                   'gets Unknown action from the board and the trip save; a staff member the app is released to reads ' +
                   'the client\'s trip private and keeps the app\'s own refusal; a holder for another client is refused; ' +
                   'nothing is written',
              shutBoard.status === 404 && shutSave.status === 404 && appBoard.viewer.client === '' &&
              tripIn(appBoard, cTrip.id).private === true && appSave.status === 403 &&
              appSave.message === 'Only the directors assign trips.' && otherSave.status === 403 && untouched &&
              ASKED.every(function (e) { return e === CP_EDITION_TRANSPORT; }),
              JSON.stringify([shutBoard, shutSave, appBoard.viewer, appSave, otherSave]).slice(0, 700));
    LENT.sam = LORI;
    OPEN.sam = false;
    var lentBoard = HUB_ACTIONS.vehicleCalendarBoard({ client: LORI }, user('sam')).data;
    var lentOwn = tripIn(lentBoard, cTrip.id), lentOther = tripIn(lentBoard, oTrip.id);
    var lentMoved = HUB_ACTIONS.vehicleCalendarTripSave({ trip_id: oTrip.id, client: LORI, status: 'cancelled' }, user('sam'));
    var lentAway = HUB_ACTIONS.vehicleCalendarTripSave({ trip_id: cTrip.id, client: LORI, client_key: BETH }, user('sam'));
    var lentVisit = HUB_ACTIONS.vehicleCalendarTripSave(move, user('sam', { visiting_member: 'U_TAYLOR' }));
    var lentSave = HUB_ACTIONS.vehicleCalendarTripSave(move, user('sam'));
    var cSaved = byTrip(cTrip.id);
    stAssert_(out, P + 'Clients: a holder for this client the app is not released to reads the board with that client\'s ' +
                   'trips whole (the others private, the client picker that client alone, the drivers), never a request ' +
                   'button; schedules the trip through the app\'s own rules with the Apply strip\'s words and a fresh ' +
                   'board; another client\'s trip is refused as moved, the trip never leaves its client, never during a visit',
              lentBoard.viewer.client === LORI && lentBoard.viewer.can_edit === false && lentBoard.viewer.can_request === false &&
              lentOwn.client_name === 'Lori Schmucker' && !lentOwn.private && lentOther.private === true &&
              lentBoard.clients.length === 1 && lentBoard.clients[0].key === LORI && !!lentBoard.drivers &&
              lentMoved.status === 409 && /has moved/.test(lentMoved.message) && byTrip(oTrip.id).state === 'scheduled' &&
              lentAway.status === 403 && /stays with that client/.test(lentAway.message) && lentVisit.status === 404 &&
              lentSave.status === 200 && cSaved.state === 'scheduled' && cSaved.vehicle_id === FORD &&
              cSaved.client_key === LORI && lentSave.data.app === CP_APP_ID && lentSave.data.steps[0].id === 'sheet' &&
              /Transportation trips house/.test(lentSave.data.steps[0].words) && lentSave.data.slices.length === 0 &&
              lentSave.data.written.indexOf('state') !== -1 && lentSave.data.written.indexOf('vehicle_id') !== -1 &&
              lentSave.data.board.viewer.client === LORI && tripIn(lentSave.data.board, cTrip.id).word === 'Scheduled',
              JSON.stringify([lentBoard.viewer, lentOwn.private, lentMoved, lentAway, lentVisit, lentSave.status,
                              lentSave.data && lentSave.data.steps, cSaved.state]).slice(0, 900));
    OPEN.sam = true;
    var openBoard = HUB_ACTIONS.vehicleCalendarBoard({ client: LORI }, user('sam')).data;
    TOLD = [];
    var lentCancel = HUB_ACTIONS.vehicleCalendarTripSave({ trip_id: cTrip.id, client: LORI, status: 'cancelled',
                                                           note: 'Appointment moved' }, user('sam'));
    var cGone = byTrip(cTrip.id);
    ASKED = [];
    var bossScoped = HUB_ACTIONS.vehicleCalendarTripSave({ trip_id: oTrip.id, client: LORI, details: 'x' }, boss);
    var tyBoard = HUB_ACTIONS.vehicleCalendarBoard({ client: LORI }, user('ty')).data;
    var tyOwn = HUB_ACTIONS.vehicleCalendarTripSave({ trip_id: oTrip.id, details: 'Bring the folder' }, user('ty'));
    stAssert_(out, P + 'Clients: a holder the app is released to reads it the same way and may still ask for a vehicle; the ' +
                   'cancel tells the requester as the app\'s own does; the master and a director need no edition, a ' +
                   'call naming a client changes only that client\'s trip, and the app\'s own save is unchanged',
              openBoard.viewer.client === LORI && openBoard.viewer.can_request === true && !tripIn(openBoard, cTrip.id).private &&
              lentCancel.status === 200 && cGone.state === 'cancelled' && cGone.vehicle_id === '' && TOLD.length === 1 &&
              TOLD[0].situation === 'transport_trip_cancelled' && lentCancel.data.written.indexOf('state') !== -1 &&
              bossScoped.status === 409 && ASKED.length === 0 && tyBoard.viewer.client === LORI &&
              tyBoard.clients.length > 1 && tyOwn.status === 200 && byTrip(oTrip.id).details === 'Bring the folder' &&
              tyOwn.data.steps === undefined,
              JSON.stringify([openBoard.viewer, lentCancel.status, cGone.state, TOLD.map(function (t) { return t.situation; }),
                              bossScoped, ASKED, tyBoard.viewer, tyOwn.status]).slice(0, 900));
  } finally {
    STUBS.forEach(function (n) { G[n] = keep[n]; });
    VC_NOW = keepVars.now;
    VC_BOARD_VERSION_KEY = keepVars.ver;
    VC_DUE_KEY = keepVars.due;
    VC_PEOPLE_KEY = keepVars.people;
    VC_CLIENTS_KEY = keepVars.clients;
    VC_DRIVERS_KEY = keepVars.drivers;
    HUB_MEMBER_CTX = keepVars.member;
    VC_MEMO = {};
    VC_ROWS_MEMO = {};
    VC_BOARD_MEMO = {};
  }
}
