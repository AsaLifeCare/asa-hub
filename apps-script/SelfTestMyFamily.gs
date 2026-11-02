/** My Work, My Calendar and My Inbox for a client-role account: the account's own client only, every source said. */
function stMyFamily_(out) {
  if (typeof HUB_ACTIONS.myFamily !== 'function' || typeof myFamilyAnswer_ !== 'function') {
    stAssert_(out, 'my family: MyFamily.gs declares the read', false, 'missing');
    return;
  }
  var keep = { route: route, derived: clientsDerived_, managers: hotlineHouseManagers_, access: HUB_ACTIONS.appBadgeAccessGet,
               readTab: readTabNormalized_, workbook: hubTabWorkbook_, log: hubSysLog_, housesOf: hubViewerHousesOf_,
               visible: hubStaffVisibleForHouses_, cal: locationsCalendar_, punches: locationsPunches_, estate: estateRows_,
               apptTab: csApptTabRows_, apptCached: csApptCached_, acting: HUB_BE_ANOTHER };
  var today = myFamilyToday_(new Date());
  var week = myFamilyWeek_('', today);
  var day = function (n) { return myFamilyShift_(today, n); };
  var CLIENTS = [
    { client_key: 'jane_doe', name: 'Jane Doe', home_address: '4708 Meadowlane Dr NW, Canton, OH 44709', house: 'ABD4708' },
    { client_key: 'bob_roe', name: 'Bob Roe', home_address: '2704 Oak St, Canton, OH', house: 'BM2704' }
  ];
  var ROWS = {
    clients: CLIENTS,
    drAppointments: [
      { id: 'd1', client: 'Jane Doe', specialist: 'Dentist', dr_name: 'Dr Ada', next_visit: today, status: 'Scheduled' },
      { id: 'd2', client: 'Bob Roe', specialist: 'Cardiology', dr_name: 'Dr Bo', next_visit: today, status: 'Scheduled' },
      { id: 'd3', client: 'Jane Doe', specialist: 'Eye doctor', dr_name: 'Dr Cy', next_visit: myFamilyShift_(week, 12),
        status: '' },
      { id: 'd4', client: 'Jane Doe', specialist: 'Podiatry', dr_name: 'Dr Di', next_visit: '', status: '' }
    ],
    // the booked visits: the Dentist's is the same visit as its doctor's next_visit, so it is drawn once
    drVisits: [
      { id: 'v1', client_name: 'Jane Doe', dr_name: 'Dr Ada', appointment_date: today, appointment_start_time: '10:00 AM',
        appointment_address: '12 Main St' },
      { id: 'v2', client_name: 'Bob Roe', dr_name: 'Dr Bo', appointment_date: today, appointment_start_time: '9:00 AM',
        appointment_address: 'NEVER SHOWN clinic' }
    ],
    futureApts: [],
    uiIncidents: [
      { client_name: 'Jane Doe', incident_date: day(-2), incident_category: 'Fall', timestamp: day(-2) + 'T14:00:00Z',
        incident_description: 'NEVER SHOWN' },
      { client_name: 'Bob Roe', incident_date: day(-1), incident_category: 'Behavior', timestamp: day(-1) + 'T14:00:00Z' },
      { client_name: 'Jane Doe', incident_date: day(-90), incident_category: 'Old', timestamp: day(-90) + 'T14:00:00Z' }
    ],
    workOrders: [
      { select_address_vehicle: '4708 Meadowlane Dr NW', status: 'Done', timestamp: day(-3) + 'T13:00:00Z',
        vendor: 'NEVER SHOWN', cost: '999' },
      { select_address_vehicle: '2704 Oak St', status: 'Open', timestamp: day(-3) + 'T13:00:00Z' }
    ],
    careDocs: [
      { id: 'd1', collection: 'family', client: 'jane_doe', title: 'NEVER SHOWN', updatedAt: day(-1) },
      { id: 'd2', collection: 'family', client: 'bob_roe', updatedAt: day(-1) },
      { id: 'd3', collection: 'clinical', client: 'jane_doe', updatedAt: day(-1) }
    ],
    tasks: [{ id: 't1', title: 'Call the office', column: 'this-week', ownerId: 'u-jane', updatedAt: day(-1) }],
    sheetTasks: []
  };
  // the inbox's own sources: Jane's house, the staff it sees, and who worked where on the archive and the clock
  var HOUSES = { jane_doe: ['ABD4708'], bob_roe: ['BM2704'] };
  var VISIBLE = { ABD4708: ['nianew', 'olgaold', 'patpunch', 'fayfuture'], BM2704: ['otherhouse'] };
  var ARCHIVE = [
    ['Location', 'Employee', 'Designation', 'Shift', 'Date'],
    ['CAN - JH - ABD4708', 'Nia New', '', '8A-4P', day(-3)],
    ['CAN - JH - ABD4708', 'Olga Old', '', '8A-4P', day(-40)],
    ['CAN - JH - ABD4708', 'Olga Old', '', '8A-4P', day(-2)],
    ['CAN - JH - ABD4708', 'Fay Future', '', '8A-4P', day(3)],
    ['CAN - JH - ABD4708', 'Ned Notseen', '', '8A-4P', day(-1)],
    ['CAN - XX - BM2704', 'Other House', '', '8A-4P', day(-1)]
  ];
  var PUNCHES = [{ house: 'ABD4708', employee: 'Pat Punch', date_iso: day(-5) },
                 { house: 'BM2704', employee: 'Other House', date_iso: day(-1) }];
  var calReads = 0;
  var mdy = function (iso) { var c = iso.split('-'); return Number(c[1]) + '/' + Number(c[2]) + '/' + c[0]; };
  var noonOf = function (iso) { return new Date(Date.parse(iso + 'T16:00:00Z')); };
  // the Calendar Archive as the hotline book holds it: M/D/YYYY text or a date cell, clock text or a time cell
  var WEEK_ARCHIVE = [
    ['Location', 'Employee', 'Designation', 'Phone', 'Date', 'Start Time', 'End Time'],
    ['CAN - JH - ABD4708', 'Ann Staff', '', '3305550001', mdy(week), '7:00 AM', '3:00 PM'],
    ['CAN - JH - ABD4708', 'Ben Night', '**', '3305550002', mdy(myFamilyShift_(week, 2)), '11:00 PM', '7:00 AM'],
    ['CAN - JH - ABD4708', 'OPEN', '', '', mdy(myFamilyShift_(week, 2)), '3:00 PM', '11:00 PM'],
    ['CAN - JH - ABD4708', 'Cy Day', '', '3305550003', noonOf(myFamilyShift_(week, 3)),
     new Date(Date.parse('2026-09-30T12:00:00Z')), new Date(Date.parse('2026-09-30T20:00:00Z'))],
    ['CAN - XX - BM2704', 'Zed Other', '', '3305550099', mdy(week), '7:00 AM', '3:00 PM'],
    ['CAN - XX - BM2704', 'Yan Other', '', '3305550098', mdy(myFamilyShift_(week, 5)), '7:00 AM', '3:00 PM'],
    ['CAN - JH - ABD4708', 'Ann Staff', '', '3305550001', mdy(myFamilyShift_(week, 14)), '7:00 AM', '3:00 PM'],
    ['CAN - JH - ABD4708', 'Ann Staff', '', '3305550001', mdy(week), '7:00 AM', '3:00 PM']
  ];
  // the week reads the shift columns, the inbox reads who worked where: each part is asked with its own archive
  var asking = '';
  var asked = [];
  var broken = {};
  var rules = {};
  var OPEN = ['CLIENT', 'STAFF'];
  var setRules = function (r) { rules = r; };
  var allOpen = function () {
    return { 'dr-appointments': OPEN, houses: OPEN, suggestions: OPEN, taskboard: OPEN, 'taskboard-sheet': OPEN,
             'house-repair': OPEN, 'ui-incidents': OPEN, family: OPEN, 'my-calendar': OPEN };
  };
  var head = function (w, k) {
    var hit = null;
    (w.heads || []).forEach(function (h) { if (h.key === k) hit = h; });
    return hit || {};
  };
  var logged = [];
  var n = 0;
  // an account id no earlier run used: the read's own cache must never answer one case with another run's
  var run = String(new Date().getTime()) + '-' + Math.floor(Math.random() * 1e6);
  var who = function (over) {
    n++;
    var u = { id: 'u-st-fam-' + run + '-' + n, email: 'jane@example.invalid', role: 'client', client_key: 'jane_doe',
              types: ['CLIENT'], app_denials: [] };
    for (var k in over) if (over.hasOwnProperty(k)) u[k] = over[k];
    return u;
  };
  var ask = function (part, user, extra) {
    var p = { part: part };
    asking = part;
    for (var k in (extra || {})) if (extra.hasOwnProperty(k)) p[k] = extra[k];
    try { return HUB_ACTIONS.myFamily(p, user); }
    catch (e) { return { threw: String((e && e.message) || e) }; }
  };
  try {
    hubSysLog_ = function (a, b, c) { logged.push(String(b) + ': ' + String(c)); return true; };
    clientsDerived_ = function () { return CLIENTS; };
    route = function (resource, action) {
      asked.push(resource + '.' + action);
      if (broken[resource]) throw new Error('st: ' + resource + ' is down');
      return { status: 200, data: (ROWS[resource] || []).slice() };
    };
    estateRows_ = function (resource) {
      asked.push(resource + '.estate');
      if (broken[resource]) throw new Error('st: ' + resource + ' is down');
      // row ids as the estate reader mints them
      return (ROWS[resource] || []).map(function (r, i) {
        var o = { id: 'r' + (i + 2) };
        for (var k in r) if (r.hasOwnProperty(k)) o[k] = r[k];
        return o;
      });
    };
    csApptTabRows_ = function () {
      asked.push('futureApts.estate');
      if (broken.futureApts) throw new Error('st: futureApts is down');
      return ROWS.futureApts.slice();
    };
    // every ask builds the client's appointments afresh: a held build would answer one case with another's rows
    csApptCached_ = function (key, producer) { return producer(); };
    hotlineHouseManagers_ = function () {
      if (broken.managers) return { readable: false, why: 'st: the calendar is down', people: [] };
      return { readable: true, people: [
        { name: 'Mary Manager', phone: '3305550100', house: 'CAN - JH - ABD4708' },
        { name: 'Other Manager', phone: '3305550199', house: 'CAN - XX - BM2704' }
      ] };
    };
    HUB_ACTIONS.appBadgeAccessGet = function () {
      if (broken.access) throw new Error('st: the matrix is down');
      return { status: 200, data: { rules: rules, configRules: {}, tenantRules: {} } };
    };
    hubViewerHousesOf_ = function (keys) {
      // the week reads the client records as the real rule does
      if (asking === 'calendar') return keep.housesOf(keys);
      if (broken.houses) return { codes: [], why: ['The client records could not be read (st: down).'] };
      var codes = [];
      (keys || []).forEach(function (k) { codes = codes.concat(HOUSES[k] || []); });
      return { codes: codes, why: [] };
    };
    hubStaffVisibleForHouses_ = function (codes) {
      // the rule reads the archive as the real one does, so one read between them proves the memo
      locationsCalendar_();
      var keys = [];
      (codes || []).forEach(function (c) { keys = keys.concat(VISIBLE[c] || []); });
      return { keys: keys, why: broken.calendar ? 'The Calendar Archive could not be read (st: down).' : '' };
    };
    locationsCalendar_ = function () {
      return locationsPackMemo_('calendar', function () {
        if (asking === 'calendar') {
          asked.push('archive.read');
          if (broken.archive) return { cal: null, why: 'the Calendar Archive could not be read (st: the archive is down)' };
          return { cal: { values: WEEK_ARCHIVE, tz: 'America/New_York' }, why: '' };
        }
        calReads++;
        if (broken.calendar) return { cal: null, why: 'st: the archive is down' };
        return { cal: { values: ARCHIVE, tz: 'America/New_York' }, why: '' };
      });
    };
    locationsPunches_ = function () {
      return broken.punches ? { rows: null, why: 'st: the clock is down' } : { rows: PUNCHES.slice(), why: '' };
    };
    hubTabWorkbook_ = function () { return {}; };
    readTabNormalized_ = function (ss, tab) {
      if (tab !== SUGGESTIONS_TAB) throw new Error('st: only the suggestions tab is read here');
      return [
        { suggestionid: 'SUG_1', byemail: 'Jane@Example.invalid', text: 'More walks, please', createdat: day(-4) + 'T10:00:00Z' },
        { suggestionid: 'SUG_2', byemail: 'bob@example.invalid', text: 'NEVER SHOWN', createdat: day(-4) + 'T10:00:00Z' }
      ];
    };
    setRules(allOpen());

    var pol = HUB_POLICY.myFamily || {};
    stAssert_(out, 'my family: declared a read for the client role alone, with nothing it sends or invalidates',
              pol.lane === 'read' && JSON.stringify(pol.roles) === '["client"]' && pol.file === 'MyFamily.gs' &&
              !(pol.emits || []).length && !(pol.invalidates || []).length, JSON.stringify(pol));

    var staff = ask('work', { id: 'u-staff', role: 'staff', email: 's@example.invalid' });
    var svc = ask('work', { id: 'svc', role: 'client', is_service: true, client_key: 'jane_doe' });
    var visit = ask('work', who({ visiting_member: 'mem_1' }));
    var badPart = ask('everything', who({}));
    var badWeek = ask('calendar', who({}), { week: '2026-13-45' });
    stAssert_(out, 'my family: a staff session, the service identity and a visit are refused, an unknown part and ' +
                   'an unreadable week are 400 — and nothing is read for any of them',
              staff.status === 403 && svc.status === 403 && visit.status === 403 && badPart.status === 400 &&
              badWeek.status === 400 && asked.length === 0,
              JSON.stringify([staff, svc, visit, badPart, badWeek, asked]));

    var unlinked = ['calendar', 'work', 'inbox'].map(function (p) { return ask(p, who({ client_key: '' })); });
    stAssert_(out, 'my family: an account with no client key is answered linked:false with its sentence and no rows, ' +
                   'and nothing is read',
              unlinked.every(function (r) {
                return r.status === 200 && r.data.linked === false && !!r.data.why && !r.data.rows && !r.data.items &&
                       !r.data.appointments && !r.data.sources;
              }) && asked.length === 0, JSON.stringify(unlinked) + ' ' + JSON.stringify(asked));

    var cal = ask('calendar', who({})).data || {};
    var ap = cal.appointments || {};
    stAssert_(out, 'my family: the week lists the account\'s own appointments, the next one after it, and counts the ' +
                   'undated — another client\'s never',
              cal.linked === true && cal.viewer === 'client' && cal.ward.name === 'Jane Doe' &&
              ap.rows.length === 1 && ap.rows[0].title === 'Dentist' && ap.rows[0].doctor === 'Dr Ada' &&
              !!ap.next && ap.next.title === 'Eye doctor' && ap.undated === 1 && ap.source.state === 'ok' &&
              JSON.stringify(cal).indexOf('Cardiology') === -1 && cal.week.from === week,
              JSON.stringify(cal));
    stAssert_(out, 'my calendar: a booked visit carries its clock and place, and the doctor\'s next visit that is the ' +
                   'same visit is not drawn twice — another client\'s visit never',
              ap.rows.length === 1 && ap.rows[0].time === '10:00 AM' && ap.rows[0].place === '12 Main St' &&
              ap.rows[0].day === today && JSON.stringify(ap).indexOf('NEVER SHOWN') === -1 &&
              JSON.stringify(ap).indexOf('Dr Bo') === -1, JSON.stringify(ap));
    var mgr = cal.manager || {};
    var houses = Object.keys(hubClientIdentity_('jane_doe').houses || {});
    if (houses.join(',') !== '4708') {
      // hubClientIdentity_ reads the house number through RegExp.$1, which a sandbox's own RegExp does not set
      stSkip_(out, 'my family: the house manager is the hotline calendar\'s, cut to the account\'s own house',
              'the house number could not be read here (' + houses.join(',') + '); runSelfTest() in the editor ' +
              'asserts it');
    } else {
      stAssert_(out, 'my family: the house manager is the hotline calendar\'s, cut to the account\'s own house',
                mgr.source.state === 'ok' && mgr.rows.length === 1 && mgr.rows[0].name === 'Mary Manager' &&
                JSON.stringify(mgr).indexOf('Other Manager') === -1, JSON.stringify(mgr));
    }
    stAssert_(out, 'my family: the house manager never names another house\'s manager',
              JSON.stringify(mgr).indexOf('Other Manager') === -1 && !!mgr.source, JSON.stringify(mgr));
    var realIdentity = hubClientIdentity_;
    var pinned = null;
    try {
      hubClientIdentity_ = function (k) {
        var id = realIdentity(k);
        id.houses = k === 'jane_doe' ? { '4708': true } : {};
        return id;
      };
      pinned = (ask('calendar', who({})).data || {}).manager || {};
    } finally {
      hubClientIdentity_ = realIdentity;
    }
    stAssert_(out, 'my family: with the house number read, the hotline calendar is cut by the one narrowing to the ' +
                   'manager of that house alone',
              pinned.source.state === 'ok' && pinned.rows.length === 1 && pinned.rows[0].name === 'Mary Manager' &&
              pinned.rows[0].phone === '3305550100', JSON.stringify(pinned));

    // ---- my calendar: the staff on shift at the client's own house ----
    var W = function (n) { return myFamilyShift_(week, n); };
    var sh = cal.shifts || {};
    var shTxt = JSON.stringify(sh);
    var shLine = (sh.rows || []).map(function (s) { return s.day + ' ' + s.staff + ' ' + s.start + '-' + s.end; })
      .join(' | ');
    stAssert_(out, 'my calendar for a client: every named staff shift of the week at its own house — the name and the ' +
                   'hours, a date cell and a time cell read as the text ones — once each; nothing of another house, no ' +
                   'phone, no open square, no other week',
              !!sh.source && sh.source.state === 'ok' && sh.source.count === 3 &&
              shLine === [W(0) + ' Ann Staff 07:00-15:00', W(2) + ' Ben Night 23:00-07:00',
                          W(3) + ' Cy Day 08:00-16:00'].join(' | ') &&
              JSON.stringify(sh.houses) === '["ABD4708"]' && shTxt.indexOf('Zed') === -1 &&
              shTxt.indexOf('Yan') === -1 && shTxt.indexOf('3305550') === -1 && shTxt.indexOf('OPEN') === -1 &&
              shTxt.indexOf('BM2704') === -1, shLine + ' ' + shTxt);
    stAssert_(out, 'my calendar: the days the archive carries at all are named, so a day it does not reach is never ' +
                   'said to have no shifts',
              JSON.stringify(sh.drawn) === JSON.stringify([W(0), W(2), W(3), W(5)]), JSON.stringify(sh.drawn));
    var bobWeek = (ask('calendar', who({ client_key: 'bob_roe', email: 'bob@example.invalid' })).data || {}).shifts || {};
    stAssert_(out, 'my calendar: another client\'s week is its own house\'s alone',
              (bobWeek.rows || []).map(function (s) { return s.staff; }).join(',') === 'Zed Other,Yan Other' &&
              JSON.stringify(bobWeek).indexOf('Ann Staff') === -1, JSON.stringify(bobWeek));
    var named = ask('calendar', who({}), { house: 'BM2704', client_key: 'bob_roe', client: 'bob_roe' }).data || {};
    stAssert_(out, 'my calendar: a house or a client the payload names changes nothing — the account\'s own house and ' +
                   'appointments only',
              JSON.stringify((named.shifts || {}).rows) === JSON.stringify(sh.rows) &&
              JSON.stringify((named.appointments || {}).rows) === JSON.stringify(ap.rows) &&
              JSON.stringify(named).indexOf('Zed') === -1 && JSON.stringify(named).indexOf('Cardiology') === -1,
              JSON.stringify([named.shifts, named.appointments]));
    var switched = {};
    try {
      HUB_BE_ANOTHER = { real: { id: 'u-st-master', email: 'master@example.invalid', display_name: 'The master' },
                         target: { id: 'u-jane', email: 'jane@example.invalid', display_name: 'Jane Doe', role: 'client' },
                         until: new Date(Date.now() + 3600000).toISOString(), th: 'st-th', parent_th: 'st-parent' };
      switched = ask('calendar', who({})).data || {};
    } finally {
      HUB_BE_ANOTHER = keep.acting;
    }
    var masterOwn = ask('calendar', { id: 'u-st-master', role: 'admin', email: 'master@example.invalid' });
    stAssert_(out, 'my calendar in a switched session as the client: its own house\'s shifts and its own appointments ' +
                   'exactly as the client reads them; the master\'s own session is refused this read',
              JSON.stringify((switched.shifts || {}).rows) === JSON.stringify(sh.rows) &&
              JSON.stringify((switched.appointments || {}).rows) === JSON.stringify(ap.rows) && masterOwn.status === 403,
              JSON.stringify([switched.shifts, masterOwn]));
    var keepHouse = [CLIENTS[0].house, CLIENTS[0].home_address];
    var homeless = {};
    try {
      CLIENTS[0].house = '';
      CLIENTS[0].home_address = '';
      homeless = (ask('calendar', who({})).data || {}).shifts || {};
    } finally {
      CLIENTS[0].house = keepHouse[0];
      CLIENTS[0].home_address = keepHouse[1];
    }
    stAssert_(out, 'my calendar: a record whose house cannot be matched shows no shift and says so — never another ' +
                   'house\'s, never "no shifts"',
              !!homeless.source && homeless.source.state === 'unreadable' && !!homeless.source.why &&
              homeless.source.count === null && (homeless.rows || []).length === 0, JSON.stringify(homeless));
    broken.archive = true;
    var dark = (ask('calendar', who({})).data || {}).shifts || {};
    broken.archive = false;
    stAssert_(out, 'my calendar: a Calendar Archive that cannot be read leaves the shifts unreadable with its reason — ' +
                   'never an empty week',
              !!dark.source && dark.source.state === 'unreadable' && dark.source.why.indexOf('the archive is down') !== -1 &&
              (dark.rows || []).length === 0 && (dark.drawn || []).length === 0, JSON.stringify(dark));
    var noCal = allOpen();
    delete noCal['my-calendar'];
    noCal['dr-appointments'] = ['GUARDIAN', 'STAFF'];
    setRules(noCal);
    var markCal = asked.length;
    var shutWeek = ask('calendar', who({})).data || {};
    var shutReads = asked.slice(markCal).filter(function (a) { return a === 'archive.read' || /\.estate$/.test(a); });
    setRules(allOpen());
    stAssert_(out, 'my calendar: a row that does not name CLIENT leaves its part not applicable and never read — My ' +
                   'Calendar\'s for the shifts, Dr Appointments\' for the appointments',
              shutWeek.shifts.source.state === 'not_applicable' && shutWeek.shifts.rows.length === 0 &&
              shutWeek.appointments.source.state === 'not_applicable' && shutWeek.appointments.rows.length === 0 &&
              shutReads.length === 0, JSON.stringify([shutWeek.shifts, shutWeek.appointments, shutReads]));

    // ---- my calendar: every written day is read ----
    var ON = '2026-09-30';
    var FORMATS = [
      [new Date(Date.parse('2026-10-02T16:00:00Z')), '2026-10-02'], ['2026-10-02T04:00:00.000Z', '2026-10-02'],
      ['2026-10-02T02:00:00.000Z', '2026-10-01'], ['2026-10-02', '2026-10-02'], ['2026-10-02 09:00', '2026-10-02'],
      ['2026/10/2', '2026-10-02'], ['10/2/2026', '2026-10-02'], ['10/02/2026 10:00 AM', '2026-10-02'],
      ['10/2/26', '2026-10-02'], ['10-2-2026', '2026-10-02'], ['10.2.2026', '2026-10-02'], ['30/9/2026', '2026-09-30'],
      ['Friday, October 2, 2026', '2026-10-02'], ['Oct 2, 2026', '2026-10-02'], ['Oct. 2nd 2026', '2026-10-02'],
      ['Sept 30th, 2026', '2026-09-30'], ['2 October 2026', '2026-10-02'], ['2nd of Oct, 2026', '2026-10-02'],
      ['Scheduled for 10/2/2026 with Dr Ada', '2026-10-02'], ['Oct 2', '2026-10-02'], ['10/2', '2026-10-02'],
      ['Jan 5', '2027-01-05'], ['46297', '2026-10-02'], ['2/30/2026', ''], ['13/13/2026', ''], ['TBD', ''],
      ['as needed', ''], ['September 2026', ''], ['Tuesday', ''], ['', ''], [null, '']
    ];
    var misread = FORMATS.filter(function (f) { return myFamilyApptDay_(f[0], ON) !== f[1]; })
      .map(function (f) { return String(f[0]) + ' → ' + myFamilyApptDay_(f[0], ON) + ' (not ' + f[1] + ')'; });
    stAssert_(out, 'my calendar: an appointment day is read however it is written — a date cell, an instant in New ' +
                   'York, ISO, M/D/YYYY and M/D/YY with any separator, a day-first date, the month in words, a day among ' +
                   'words, a day without its year, a sheet day number — and nothing that is not a day',
              misread.length === 0, misread.join(' | '));
    var MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
                 'November', 'December'];
    var DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var noon = function (iso) { return new Date(Date.parse(iso + 'T12:00:00Z')); };
    var inWords = function (iso) {
      var t = noon(iso);
      return DOW[t.getUTCDay()] + ', ' + MONTH[t.getUTCMonth()] + ' ' + t.getUTCDate() + ', ' + t.getUTCFullYear();
    };
    var yearless = function (iso) { var t = noon(iso); return MONTH[t.getUTCMonth()].slice(0, 3) + ' ' + t.getUTCDate(); };
    var dayFirst = function (iso) {
      var t = noon(iso);
      return t.getUTCDate() + ' ' + MONTH[t.getUTCMonth()] + ' ' + t.getUTCFullYear();
    };
    var serial = function (iso) { return String((noon(iso).getTime() - Date.UTC(1899, 11, 30, 12)) / 86400000); };
    var keepRows = [ROWS.drVisits, ROWS.futureApts, ROWS.drAppointments];
    var written = {};
    try {
      ROWS.drVisits = [
        { id: 'v1', client_name: 'Jane Doe', dr_name: 'Dr Ze', appointment_date: noonOf(W(0)).toISOString(),
          appointment_start_time: '8:00 AM', appointment_address: '1 First St' },
        { id: 'v2', client_name: 'Jane Doe', dr_name: 'Dr Ada', appointment_date: inWords(W(1)),
          appointment_start_time: '2:00:00 PM', appointment_address: '12 Main St' },
        { id: 'v3', client_name: 'Jane Doe', dr_name: 'Dr Cy', appointment_date: mdy(W(2)).replace(/\d\d(\d\d)$/, '$1'),
          appointment_start_time: '9:00 AM', appointment_address: '3 Eye St' }
      ];
      ROWS.futureApts = [
        { id: 'f1', client_name: 'Jane Doe', dr_name: 'Dr Fu', appointment_date: W(6).replace(/-/g, '/'),
          appointment_start_time: '11:30', appointment_address: '6 Future St' }
      ];
      ROWS.drAppointments = [
        // the same visits as the booked ones, written their own way: drawn once
        { id: 'd1', client: 'Jane Doe', specialist: 'Dentist', dr_name: 'Dr Ada', next_visit: mdy(W(1)) },
        { id: 'd3', client: 'Jane Doe', specialist: 'Eye doctor', dr_name: 'Dr Cy', next_visit: W(2) },
        { id: 'd5', client: 'Jane Doe', specialist: 'Sleep study', dr_name: 'Dr Sl', next_visit: serial(W(3)) },
        { id: 'd6', client: 'Jane Doe', specialist: 'Neurology', dr_name: 'Dr Ne', next_visit: yearless(W(4)) },
        { id: 'd7', client: 'Jane Doe', specialist: 'Hearing', dr_name: 'Dr He', next_visit: dayFirst(W(5)) },
        { id: 'd4', client: 'Jane Doe', specialist: 'Podiatry', dr_name: 'Dr Di', next_visit: '' },
        { id: 'd8', client: 'Jane Doe', specialist: 'Lab work', dr_name: 'Dr La', next_visit: '   ' },
        { id: 'd9', client: 'Jane Doe', specialist: 'Allergy', dr_name: 'Dr Al', next_visit: 'TBD' }
      ];
      written = (ask('calendar', who({})).data || {}).appointments || {};
    } finally {
      ROWS.drVisits = keepRows[0];
      ROWS.futureApts = keepRows[1];
      ROWS.drAppointments = keepRows[2];
    }
    var placed = (written.rows || []).map(function (a) { return a.day + ' ' + a.title + ' ' + a.time; }).join(' | ');
    stAssert_(out, 'my calendar: every appointment is placed on the day written — a date cell, the day in words, a ' +
                   'two-digit year, Future Apts, a sheet day number, a day without its year, a day-first date — and ' +
                   'only one with no day written stays unplaced',
              placed === [W(0) + ' Doctor appointment 8:00 AM', W(1) + ' Dentist 2:00 PM', W(2) + ' Eye doctor 9:00 AM',
                          W(3) + ' Sleep study ', W(4) + ' Neurology ', W(5) + ' Hearing ',
                          W(6) + ' Doctor appointment 11:30 AM'].join(' | ') &&
              written.undated === 3 && written.source.state === 'ok', placed + ' undated=' + written.undated);
    broken.drVisits = true;
    var halfRead = (ask('calendar', who({})).data || {}).appointments || {};
    broken.drVisits = false;
    stAssert_(out, 'my calendar: with the booked visits unreadable the doctors\' next visits are still shown, and the ' +
                   'part that could not be read is said',
              halfRead.source.state === 'ok' && halfRead.source.why.indexOf('drVisits is down') !== -1 &&
              (halfRead.rows || []).some(function (a) { return a.title === 'Dentist' && a.day === today; }),
              JSON.stringify(halfRead));

    var work = ask('work', who({})).data || {};
    var bySrc = {};
    (work.sources || []).forEach(function (s) { bySrc[s.key] = s; });
    var wtxt = JSON.stringify(work);
    stAssert_(out, 'my work for a client: their own suggestion, their own card and the repair at their house, with ' +
                   'status and day — no other client\'s, no vendor, no cost, and actions not applicable',
              bySrc.suggestions.count === 1 && bySrc.tasks.count === 1 && bySrc.repairs.count === 1 &&
              bySrc.sheet_tasks.state === 'empty' && work.rows.length === 3 &&
              wtxt.indexOf('NEVER SHOWN') === -1 && wtxt.indexOf('999') === -1 && wtxt.indexOf('Oak') === -1 &&
              work.actions.state === 'not_applicable' &&
              work.rows.some(function (r) { return r.source === 'tasks' && r.status === 'This week'; }), wtxt);

    var markInbox = asked.length;
    var inbox = ask('inbox', who({})).data || {};
    var inboxReads = asked.slice(markInbox);
    var itxt = JSON.stringify(inbox);
    var names = (inbox.items || []).map(function (i) { return i.title; }).join('|');
    stAssert_(out, 'my inbox for a client: only New staff — the staff its house sees whose first day there is in the ' +
                   'last two weeks, on the archive or the clock, newest first; never another house\'s, never one ' +
                   'the house does not see, never a day to come, never an older hand',
              (inbox.heads || []).length === 1 && inbox.heads[0].key === 'new_staff' && inbox.heads[0].state === 'ok' &&
              inbox.heads[0].count === 2 &&
              names === 'New staff at your house: Nia New|New staff at your house: Pat Punch' &&
              (inbox.items || []).every(function (i) {
                return i.type === 'new_staff' && /^fam:staff:[0-9a-f]{10}$/.test(i.id) && i.flag === false &&
                       /^[a-z0-9]+$/.test(i.staff);
              }) &&
              itxt.indexOf('Other House') === -1 && itxt.indexOf('Olga') === -1 && itxt.indexOf('Fay') === -1 &&
              itxt.indexOf('Ned') === -1 && itxt.indexOf('NEVER SHOWN') === -1 && itxt.indexOf('Fall') === -1, itxt);
    stAssert_(out, 'my inbox for a client: the houses it lives in are named for the relay\'s company notices, and ' +
                   'no record of another kind is read',
              JSON.stringify(inbox.house_codes) === '["ABD4708"]' && inbox.houses_why === '' &&
              inbox.window_days === MY_FAMILY_NEW_STAFF_DAYS &&
              ['uiIncidents', 'drAppointments', 'workOrders', 'careDocs'].every(function (r) {
                return inboxReads.indexOf(r + '.list') === -1;
              }), JSON.stringify([inbox.house_codes, inboxReads]));
    stAssert_(out, 'my inbox: the archive is read once for the staff rule and the first days, and the memo is let go',
              calReads === 1 && LOCATION_PACK_MEMO_ === null, calReads + ' ' + JSON.stringify(LOCATION_PACK_MEMO_));

    var guard = ask('inbox', who({ types: ['GUARDIAN'], email: 'guardian@example.invalid' })).data || {};
    var gcal = ask('calendar', who({ types: ['GUARDIAN'] })).data || {};
    stAssert_(out, 'my family: GUARDIAN on the account makes the viewer a guardian — the wording names the ward, ' +
                   'the scope is the same client',
              guard.viewer === 'guardian' && gcal.viewer === 'guardian' &&
              (guard.items || []).some(function (i) { return i.title === 'New staff at Jane Doe’s house: Nia New'; }) &&
              (guard.items || []).length === (inbox.items || []).length && gcal.appointments.rows.length === 1,
              JSON.stringify([guard.viewer, guard.items]));
    var bob = ask('inbox', who({ client_key: 'bob_roe' })).data || {};
    stAssert_(out, 'my inbox: another client\'s account is told its own house\'s staff alone',
              JSON.stringify(bob.house_codes) === '["BM2704"]' && (bob.items || []).length === 1 &&
              bob.items[0].title === 'New staff at your house: Other House' &&
              JSON.stringify(bob).indexOf('Nia') === -1, JSON.stringify(bob));
    var gwork = ask('work', who({ types: ['GUARDIAN'], email: 'guardian@example.invalid' })).data || {};
    stAssert_(out, 'my work for a guardian: suggestions are the ones this account filed, not the client\'s',
              (gwork.sources || []).some(function (s) { return s.key === 'suggestions' && s.state === 'empty'; }),
              JSON.stringify(gwork.sources));

    setRules({ 'dr-appointments': ['GUARDIAN', 'STAFF'], houses: OPEN, suggestions: OPEN, taskboard: ['STAFF'],
               'taskboard-sheet': OPEN, 'house-repair': OPEN });
    var shutCal = ask('calendar', who({})).data || {};
    var shutWork = ask('work', who({})).data || {};
    var denied = ask('work', who({ app_denials: ['house-repair'] })).data || {};
    var st = function (w, k) {
      var hit = null;
      (w.sources || []).forEach(function (s) { if (s.key === k) hit = s; });
      return hit ? hit.state : '';
    };
    stAssert_(out, 'my family: a source whose App Control row does not name CLIENT, or that the account is denied, ' +
                   'is not applicable — never read, never listed',
              shutCal.appointments.source.state === 'not_applicable' && shutCal.appointments.rows.length === 0 &&
              st(shutWork, 'tasks') === 'not_applicable' &&
              !shutWork.rows.some(function (r) { return r.source === 'tasks'; }) &&
              st(denied, 'repairs') === 'not_applicable', JSON.stringify([shutCal.appointments, shutWork.sources]));
    setRules(allOpen());

    broken.access = true;
    var blind = ask('work', who({})).data || {};
    broken.access = false;
    stAssert_(out, 'my family: an App Control reader that fails leaves every gated source unreadable — could not ' +
                   'look, never shut and never empty',
              (blind.sources || []).length === 4 &&
              blind.sources.every(function (s) { return s.state === 'unreadable' && s.count === null; }) &&
              blind.rows.length === 0, JSON.stringify(blind.sources));

    broken.houses = true;
    var noHouses = ask('inbox', who({})).data || {};
    broken.houses = false;
    stAssert_(out, 'my inbox: houses that cannot be read name none — New staff is unreadable with the reason, no ' +
                   'staff is listed, and the relay is told why no notice can be tied to a house',
              head(noHouses, 'new_staff').state === 'unreadable' && head(noHouses, 'new_staff').count === null &&
              head(noHouses, 'new_staff').why.indexOf('client records could not be read') !== -1 &&
              (noHouses.items || []).length === 0 && (noHouses.house_codes || []).length === 0 &&
              noHouses.houses_why.indexOf('client records could not be read') !== -1, JSON.stringify(noHouses));
    var homeless = ask('inbox', who({ client_key: 'nobody_here' })).data || {};
    stAssert_(out, 'my inbox: a client who lives in no house on record is told so, never an empty list',
              head(homeless, 'new_staff').state === 'unreadable' && !!homeless.houses_why &&
              (homeless.items || []).length === 0, JSON.stringify(homeless));

    broken.calendar = true;
    var clockOnly = ask('inbox', who({})).data || {};
    broken.punches = true;
    var neither = ask('inbox', who({})).data || {};
    broken.calendar = false;
    broken.punches = false;
    stAssert_(out, 'my inbox: with the archive down the clock still names the new staff and the gap says what is ' +
                   'missing; with both down New staff is unreadable',
              head(clockOnly, 'new_staff').state === 'ok' && (clockOnly.items || []).length === 1 &&
              clockOnly.items[0].title.indexOf('Pat Punch') !== -1 &&
              head(clockOnly, 'new_staff').gap.indexOf('Calendar Archive could not be read') !== -1 &&
              head(neither, 'new_staff').state === 'unreadable' && (neither.items || []).length === 0 &&
              LOCATION_PACK_MEMO_ === null, JSON.stringify([clockOnly.heads, neither.heads]));

    broken.access = true;
    var blindInbox = ask('inbox', who({})).data || {};
    broken.access = false;
    stAssert_(out, 'my inbox: New staff hangs on no source row of App Control — the relay gates the app itself',
              head(blindInbox, 'new_staff').state === 'ok' && (blindInbox.items || []).length === 2,
              JSON.stringify(blindInbox.heads));

    var keepAppts = ROWS.drAppointments, keepVisits = ROWS.drVisits;
    ROWS.drVisits = [
      { client_name: 'Jane Doe', dr_name: 'Dr Ada', appointment_date: today, appointment_start_time: '10:00 AM' },
      { client_name: 'Jane Doe', dr_name: 'Dr Pt', appointment_date: today, appointment_start_time: '9:00 AM' },
      { client_name: 'Jane Doe', dr_name: 'Dr Lb', appointment_date: today, appointment_start_time: 'after lunch' },
      { client_name: 'Jane Doe', dr_name: 'Dr Ev', appointment_date: today, appointment_start_time: '1:30 PM' }
    ];
    ROWS.drAppointments = [
      { client: 'Jane Doe', specialist: 'Dentist', dr_name: 'Dr Ada', next_visit: today, start_time: '10:00 AM' },
      { client: 'Jane Doe', specialist: 'Physical therapy', dr_name: 'Dr Pt', next_visit: today, start_time: '9:00 AM' },
      { client: 'Jane Doe', specialist: 'Lab work', dr_name: 'Dr Lb', next_visit: today, start_time: 'after lunch' },
      { client: 'Jane Doe', specialist: 'Evening check', dr_name: 'Dr Ev', next_visit: today, start_time: '1:30 PM' },
      { client: 'Jane Doe', specialist: 'Retired surgeon', dr_name: 'Dr Ex', next_visit: today, start_time: '8:00 AM',
        active_or_discontinued: 'Discontinued' },
      { client: 'Jane Doe', specialist: 'Retired dermatology', dr_name: 'Dr Ey', next_visit: myFamilyShift_(week, 8),
        active_or_discontinued: 'discontinued' },
      { client: 'Jane Doe', specialist: 'Retired podiatry', next_visit: '', active_or_discontinued: 'DISCONTINUED' },
      { client: 'Jane Doe', specialist: 'Eye doctor', dr_name: 'Dr Cy', next_visit: myFamilyShift_(week, 12),
        active_or_discontinued: 'Active' }
    ];
    var sorted;
    try {
      sorted = (ask('calendar', who({})).data || {}).appointments || {};
    } finally {
      ROWS.drAppointments = keepAppts;
      ROWS.drVisits = keepVisits;
    }
    var order = (sorted.rows || []).map(function (a) { return a.title; }).join(',');
    stAssert_(out, 'my calendar: same-day appointments run by the clock — 9:00 AM before 10:00 AM, a time it cannot ' +
                   'read last',
              order === 'Physical therapy,Dentist,Evening check,Lab work', order);
    stAssert_(out, 'my family: a discontinued doctor is no appointment — not in the week, not the next one, not ' +
                   'counted undated',
              JSON.stringify(sorted).indexOf('Retired') === -1 && !!sorted.next && sorted.next.title === 'Eye doctor' &&
              sorted.undated === 0, JSON.stringify(sorted));

    broken.drAppointments = true;
    broken.drVisits = true;
    broken.managers = true;
    var down = ask('calendar', who({})).data || {};
    broken = {};
    stAssert_(out, 'my family: a source that fails is unreadable with its reason, never an empty list',
              down.appointments.source.state === 'unreadable' && down.appointments.source.count === null &&
              down.appointments.source.why.indexOf('drAppointments is down') !== -1 &&
              down.manager.source.state === 'unreadable' && down.manager.source.why.indexOf('calendar is down') !== -1,
              JSON.stringify([down.appointments.source, down.manager.source]));

    var nohouse = CLIENTS[0].home_address;
    CLIENTS[0].home_address = '';
    var noHouse = ask('calendar', who({})).data || {};
    var noHouseWork = ask('work', who({})).data || {};
    CLIENTS[0].home_address = nohouse;
    stAssert_(out, 'my family: a record whose house cannot be matched says so — no manager and no repair is ' +
                   'claimed as none',
              noHouse.manager.source.state === 'unreadable' && noHouse.manager.rows.length === 0 &&
              st(noHouseWork, 'repairs') === 'unreadable', JSON.stringify([noHouse.manager, noHouseWork.sources]));

    var u = who({});
    var first = ask('work', u);
    var before = asked.length;
    var again = ask('work', u);
    stAssert_(out, 'my family: a second ask within a minute is answered from the cache, per account and part',
              first.status === 200 && again.status === 200 && asked.length === before &&
              JSON.stringify(first.data) === JSON.stringify(again.data), before + ' → ' + asked.length);

    stAssert_(out, 'my family: the read writes no log line', logged.length === 0 &&
              stCode_(HUB_ACTIONS.myFamily).indexOf('hubSysLog_') === -1 &&
              stCode_(myFamilyAnswer_).indexOf('hubSysLog_') === -1, JSON.stringify(logged));
  } finally {
    route = keep.route;
    estateRows_ = keep.estate;
    csApptTabRows_ = keep.apptTab;
    csApptCached_ = keep.apptCached;
    locationsCalendar_ = keep.cal;
    HUB_BE_ANOTHER = keep.acting;
    clientsDerived_ = keep.derived;
    hotlineHouseManagers_ = keep.managers;
    HUB_ACTIONS.appBadgeAccessGet = keep.access;
    readTabNormalized_ = keep.readTab;
    hubTabWorkbook_ = keep.workbook;
    hubSysLog_ = keep.log;
    hubViewerHousesOf_ = keep.housesOf;
    hubStaffVisibleForHouses_ = keep.visible;
    locationsCalendar_ = keep.cal;
    locationsPunches_ = keep.punches;
  }
}
