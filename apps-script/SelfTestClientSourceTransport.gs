/** A display-value tab for the transport fixture. */
function stCstSheet_(grid) {
  var w = 0;
  grid.forEach(function (r) { if (r.length > w) w = r.length; });
  return {
    getDataRange: function () {
      return { getDisplayValues: function () {
        return grid.map(function (r) { var o = []; for (var c = 0; c < w; c++) o.push(r[c] === undefined ? '' : String(r[c])); return o; });
      } };
    }
  };
}

/** The Van Calendar as the book holds it: header order, a row one cell short at Event ID, a duplicate, a blank day. */
function stCstBook_() {
  return {
    Requests: [
      ['Status', 'Event ID', 'Select Vehicle', 'Timestamp', 'Your Name', 'Client Name', 'Date (Day Client Needs the Van)',
       'Start Time', 'End Time', 'Why does the client need the van?', 'Destination Address'],
      ['', '', 'Wheelchair Van - 1', '10/16/2025', 'Dee Staff', 'Kay One', '10/16/2025', '5:30:00 PM', '8:00:00 PM', 'Social', 'Bingo'],
      ['New', '', 'Wheelchair Van - 1', '11/5/2025 10:14:07', '', 'Kay One', '11/17/2025', '9:45:00 AM', '11:45:00 AM', 'Dr. Adler Appt', '4100 Test Clinic Rd'],
      ['New', 'Wheelchair Van - 1', '11/5/2025 10:14:07', '', 'Kay One', '11/17/2025', '9:45:00 AM', '', 'Dr. Adler Appt', '4100 Test Clinic Rd'],
      ['New', 'Wheelchair Van - 1', '9/20/2026 10:00:00', '', 'Kay One', '10/2/2026', '9:45:00 AM', '', 'Dr. Carver Appt', '4900 Sample Ave'],
      ['New', 'Wheelchair Van - 1', '9/23/2026 19:05:41', '', 'Kay One', '1/15/2026', '11:00:00 AM', '', 'Dr. Brandt Appt', '1300 Example Dr'],
      ['New', 'Wheelchair Van - 1', '9/21/2026 8:00:00', '', 'Bo Other', '10/2/2026', '9:45:00 AM', '8:00:00 PM', 'Dr. Secret Clinic Appt', '1 Hidden Rd'],
      ['New', 'Wheelchair Van - 1', '9/21/2026 8:00:00', '', 'Kay One', '', '', '', 'Dr. Nowhere Appt', ''],
      ['', '', 'Wheelchair Van - 1', '9/22/2026', 'Dee Staff', 'Kay One', '10/9/2026', '5:30:00 PM', '6:00:00 PM', 'Social', 'Bar'],
      ['', '', '', '', '', '', '', '', '', '', '']
    ],
    Conflicts: [
      ['Status', 'Date', 'Clients in Conflict', 'Conflict Time', 'Notes'],
      ['Unresolved', '10/9/2026', 'Bo Other, Kay One', '5:30 PM - 6:00 PM', ''],
      ['Resolved', '10/16/2025', 'Kay One', '5:30 PM - 8:00 PM', 'moved']
    ]
  };
}

/** Transport: the master-only gate, the book read (realigned rows), the joins, the statuses, the fleet, the miles, and why. */
function stClientSourceTransport_(out) {
  var P = 'client transport: ';
  // ---- declarations ----
  var bad = [];
  CS_TRANSPORT_ACTIONS.forEach(function (a) {
    var p = HUB_POLICY[a];
    if (!p || p.file !== 'ClientSourceTransport.gs' || typeof HUB_ACTIONS[a] !== 'function') { bad.push(a + ': undeclared'); return; }
    if (p.lane !== 'read' || p.idempotent !== true || RESOLVER_STORES.indexOf(p.store) === -1) bad.push(a + ': lane/store');
    if (JSON.stringify(p.roles) !== JSON.stringify(ST_CP_READ_ROLES)) bad.push(a + ': roles');
    if ((p.invalidates || []).length || (p.emits || []).length) bad.push(a + ': invalidates/emits');
    var params = p.params || {};
    Object.keys(params).forEach(function (k) { if (params[k] && params[k].required) bad.push(a + ': ' + k + ' required'); });
  });
  stAssert_(out, P + 'the door is declared in ClientSourceTransport.gs: a read for every role App Control may release ' +
                 'Clients to, invalidating and emitting nothing, no param required before the gate',
            bad.length === 0 && CS_TRANSPORT_ACTIONS.length === 1, bad.join('; '));

  var keep = {
    client: csTransportClient_, derived: clientsDerived_, open: ssOpen_, estate: estateRows_, list: listRows_,
    psiSheet: psiPunchesFullSheet_, psiRows: psiPunchesRows_, today: csTransportToday_, cache: csTransportCache_,
    prop: hubProp_, log: hubSysLog_, masterCache: HUB_MASTER_EMAIL_CACHE, member: HUB_MEMBER_CTX, source: estateSource_,
    rules: hubProfileAppRules_
  };
  var master = { email: HUB_MASTER_ACCOUNT, role: 'admin' };
  var logged = 0;
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    HUB_MEMBER_CTX = null;
    hubSysLog_ = function () { logged++; };

    // ---- the gate (no App Control row: the master's alone) ----
    hubProfileAppRules_ = function () { return { rules: {}, tenants: {} }; };
    HUB_VIEWER_MEMO = null;
    var asked = 0;
    csTransportClient_ = function () { asked++; return { refused: { status: 418, message: 'st: the client was asked' } }; };
    var callers = [
      { email: 'admin@example.org', role: 'admin' }, { email: 'mgr@example.org', role: 'manager' },
      { id: 'u-st9', email: 'st9@example.org', role: 'staff', types: ['STAFF'] },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', is_service: true },
      { email: HUB_MASTER_ACCOUNT, role: 'manager' }, null
    ];
    var leaks = [];
    var shape = function (r) { return !!r && r.status === 404 && r.message === 'Unknown action.' && Object.keys(r).length === 2; };
    callers.forEach(function (u) {
      var r = HUB_ACTIONS.clientSourceTransport({ client: 'kayone' }, u);
      if (!shape(r)) leaks.push(JSON.stringify(u) + ' → ' + JSON.stringify(r));
    });
    HUB_MEMBER_CTX = { memberId: 'mem_st', userId: 'u-st', email: 'ann@example.org' };
    var inVisit = HUB_ACTIONS.clientSourceTransport({ client: 'kayone' }, master);
    HUB_MEMBER_CTX = null;
    if (!shape(inVisit)) leaks.push('visit → ' + JSON.stringify(inVisit));
    var passed = HUB_ACTIONS.clientSourceTransport({ client: 'kayone' }, master);
    stAssert_(out, P + 'with no App Control row: a non-master, a manager, a staff member, a visit, the service identity ' +
                   'and no session get the plain 404 before the client is looked up; the master in its own session ' +
                   'reaches it',
              leaks.length === 0 && asked === 1 && passed.status === 418, leaks.slice(0, 3).join(' | ') + ' asked=' + asked);
    csTransportClient_ = keep.client;

    // ---- the client ----
    clientsDerived_ = function () { return [{ client_key: 'kayone', name: 'Kay One' }, { client_key: 'boother', name: 'Bo Other' }]; };
    var blank = csTransportClient_(''), unknown = csTransportClient_('nobody'), found = csTransportClient_('kayone');
    clientsDerived_ = function () { throw new Error('st: plans closed'); };
    var closed = csTransportClient_('kayone');
    stAssert_(out, P + 'a blank client is 400, an unknown one 404, unreadable clients 503 — never a guess',
              blank.refused.status === 400 && unknown.refused.status === 404 && closed.refused.status === 503 &&
              found.client.name === 'Kay One' && found.names.kayone === true, JSON.stringify([blank, unknown, closed, found.client]));

    // ---- days and clocks as the sources write them ----
    var days0 = [csTransportDay_('11/17/2025'), csTransportDay_('11/5/2025 10:14:07'), csTransportDay_('2026-09-26T02:00:00Z'),
                 csTransportDay_('Wednesday, September 25, 2024'), csTransportDay_('9:45:00 AM'), csTransportDay_('13/40/2025')];
    var clocks0 = [csTransportClock_('9:45:00 AM'), csTransportClock_('12:05 pm'), csTransportClock_('14:05'),
                   csTransportClock_('11/17/2025'), csTransportClock_('Dr. Adler Appt')];
    stAssert_(out, P + 'a day from a US date, a stamp, an instant (New York\'s day), a long date; a clock from 12- or ' +
                   '24-hour text; anything else is nothing',
              days0.join() === '2025-11-17,2025-11-05,2026-09-25,2024-09-25,,' &&
              JSON.stringify(clocks0) === '[585,725,845,null,null]' && csTransportClockLabel_(725) === '12:05 PM',
              JSON.stringify([days0, clocks0]));

    // ---- the book ----
    var book = stCstBook_();
    var parsed = csTransportRequests_(stCstSheet_(book.Requests).getDataRange().getDisplayValues());
    var byRow = {};
    parsed.rows.forEach(function (r) { byRow[r.row] = r; });
    var r4 = byRow[4] || {};
    stAssert_(out, P + 'the Requests tab: a row one cell short at Event ID is read one column over — client, day, clock, ' +
                   'reason, destination, vehicle and request stamp land in their own fields; a row with no day is counted',
              parsed.total === 8 && parsed.realigned === 4 && parsed.unread === 1 && r4.client === 'Kay One' &&
              r4.date === '2025-11-17' && r4.start === '9:45:00 AM' && r4.end === '' && r4.reason === 'Dr. Adler Appt' &&
              r4.destination === '4100 Test Clinic Rd' && r4.vehicle === 'Wheelchair Van - 1' && r4.requested_at === '11/5/2025 10:14:07' &&
              r4.staff === '' && byRow[2].staff === 'Dee Staff', JSON.stringify(parsed));
    var days = parsed.rows.map(function (r) { return r.date; }).sort();
    var vocab = {};
    parsed.rows.forEach(function (r) { vocab[r.status || '(blank)'] = true; });
    stAssert_(out, P + 'measured on the fixture: the requests run 2025-10-16 to 2026-10-09 and the book\'s own status ' +
                   'vocabulary is New and blank',
              days[0] === '2025-10-16' && days[days.length - 1] === '2026-10-09' &&
              Object.keys(vocab).sort().join() === '(blank),New', days.join() + ' ' + Object.keys(vocab).join());

    // ---- the whole answer ----
    var sources = function () {
      return {
        form: { rows: [{ id: 'S1', status: 'new', vehicle: 'Wheelchair Van - 1', requested_at: '2026-09-25T12:00:00Z', staff: 'Eve Form',
                         client: 'Kay One', date: '2026-10-20', start: '10:00', end: '11:00', reason: 'Chores', destination: 'Store' },
                       { id: 'S2', status: 'new', vehicle: 'Wheelchair Van - 1', requested_at: '2026-09-25T12:00:00Z', staff: 'Eve Form',
                         client: 'Kay One', date: '2026-10-02', start: '9:45', end: '', reason: 'Doctor', destination: 'Twice' }], why: '' },
        visits: { rows: [
          { id: 'r7', client_name: 'Kay One', dr_name: 'Dr Carver', appointment_address: '4900 Sample Ave', appointment_date: '10/2/2026',
            appointment_start_time: '9:45 AM', wheelchair_van_required: 'Yes', manager: 'Max Manager', timestamp: '2026-09-19T12:00:00Z' },
          { id: 'r8', client_name: 'KAY  ONE', dr_name: 'Dr Future', appointment_address: '9 Future Rd', appointment_date: '2026-11-03T05:00:00.000Z',
            appointment_start_time: '13:30', wheelchair_van_required: 'Yes', timestamp: '2026-09-20T12:00:00Z' },
          { id: 'r9', client_name: 'Kay One', dr_name: 'Dr Past', appointment_address: '8 Past Rd', appointment_date: 'Wednesday, September 25, 2024',
            appointment_start_time: '08:00', wheelchair_van_required: 'Yes', timestamp: '2024-09-01T12:00:00Z' }
        ], why: '' },
        repairs: { rows: [
          { id: 'r2', select_address_vehicle: 'Wheelchair Van', please_describe_the_issue: 'Oil change light on', status: 'In Progress',
            repair_type: 'Other', timestamp: '2026-10-01T14:00:00.000Z' },
          { id: 'r3', select_address_vehicle: 'Wheelchair Van', please_describe_the_issue: 'Old', status: 'Completed',
            timestamp: '2025-01-01T14:00:00.000Z' },
          { id: 'r4', select_address_vehicle: '4100 Test Clinic Rd', status: '', timestamp: '2026-09-01T14:00:00.000Z' }
        ], why: '' },
        fleet: { rows: [], why: '' },
        punches: { rows: [
          { id: 'p1', employee: 'Ann Aide', date_iso: '2026-09-21', start_time: '01:57:00 PM', end_time: '10:00:00 PM',
            transportation_units: '10.00', work_code: 'HPC', status: 'I', consumer_1: 'Kay, One' },
          { id: 'p2', employee: 'Ann Aide', date_iso: '2026-09-22', transportation_units: '0.00', consumer_1: 'Kay, One' },
          { id: 'p3', employee: 'Ben Aide', date_iso: '2026-09-23', transportation_units: '40.00', consumer_1: 'Bo, Other' }
        ], why: '' }
      };
    };
    var bookRead = { id: 'st', requests: parsed.rows, conflicts: csTransportConflicts_(book.Conflicts), requests_why: '',
                     conflicts_why: '', total: parsed.total, realigned: parsed.realigned, unread: parsed.unread };
    var ctx = sources();
    ctx.client = { client_key: 'kayone', name: 'Kay One' };
    ctx.names = { kayone: true };
    ctx.today = '2026-09-28';
    ctx.date = '2026-10-02';
    ctx.book = bookRead;
    var a = csTransportAnswer_(ctx);
    var h = a.tabs.history, st = {};
    h.rows.forEach(function (t) { st[t.id] = t; });
    stAssert_(out, P + 'history: the client\'s own trips only; the twice-filed day is one trip with its end kept; the Hub form ' +
                   'adds a day the book lacks and not one it has; a booked van visit joins its trip',
              Object.keys(st).sort().join() === 'dvr8,dvr9,hfS1,vc2,vc3,vc5,vc6,vc9' && st.vc3.requests === 2 &&
              st.vc3.end_time === '11:45 AM' && st.vc5.dr_name === 'Dr Carver' && st.vc5.visit_id === 'r7' &&
              JSON.stringify(a).indexOf('Secret Clinic') === -1 && JSON.stringify(a).indexOf('Hidden Rd') === -1,
              JSON.stringify(Object.keys(st)));
    stAssert_(out, P + 'statuses: a past booked day Completed, a day ahead Scheduled, a day before its request Check date, ' +
                   'a van visit ahead with no booking Needs assignment, a past one No booking, an open conflict ahead Needs assignment',
              st.vc2.status === 'Completed' && st.vc3.status === 'Completed' && st.vc5.status === 'Scheduled' &&
              st.vc6.status === 'Check date' && st.dvr8.status === 'Needs assignment' && st.dvr8.date === '2026-11-03' &&
              st.dvr9.status === 'No booking' && st.dvr9.date === '2024-09-25' && st.vc9.status === 'Needs assignment' &&
              st.vc9.conflict === 'Unresolved' && st.vc2.conflict === 'Resolved' && st.hfS1.status === 'Scheduled',
              JSON.stringify(h.rows.map(function (t) { return [t.id, t.status, t.conflict]; })));
    stAssert_(out, P + 'history KPIs count Needs assignment, Scheduled and Completed; the pills offered are the ones present; ' +
                   'newest first; the calendar is the same trips oldest first',
              JSON.stringify(h.kpis) === '{"needs_assignment":2,"scheduled":2,"completed":2}' &&
              h.statuses.join() === 'Needs assignment,Scheduled,Completed,Check date,No booking' &&
              h.rows[0].id === 'dvr8' && a.tabs.calendar.rows[0].id === 'dvr9' && a.tabs.calendar.rows.length === 8 &&
              a.tabs.calendar.vehicles.join() === 'Wheelchair Van - 1' && h.conflicts.length === 2 && !h.why && !a.degraded &&
              /^1 Van Calendar request row carried no readable day/.test(h.note),
              JSON.stringify([h.kpis, h.statuses, a.tabs.calendar.kpis, h.why, h.note]));
    var v = a.tabs.vehicles.rows[0] || {};
    var other = (v.bookings || []).filter(function (b) { return !b.mine; })[0] || {};
    stAssert_(out, P + 'vehicles: one van from the requests, maintenance while an open repair names its plain name, the day\'s ' +
                   'bookings with another client\'s trip reduced to its clock',
              a.tabs.vehicles.rows.length === 1 && v.vehicle === 'Wheelchair Van - 1' && v.status === 'Maintenance' &&
              v.maintenance.length === 1 && v.repairs.length === 2 && v.bookings.length === 2 && other.who === 'Another client' &&
              other.record === '' && other.destination === '' && other.trip_id === '' && v.clients_total === 2 &&
              a.tabs.vehicles.kpis.maintenance === 1 && a.tabs.vehicles.window.start === '9:45 AM' &&
              a.tabs.vehicles.window.end === '8:00 PM', JSON.stringify(v));
    ctx.repairs.rows = [];
    var full = csTransportAnswer_(ctx).tabs.vehicles.rows[0];
    ctx.date = '2025-10-16';
    var evening = csTransportAnswer_(ctx).tabs.vehicles.rows[0];
    ctx.date = '2026-10-09';
    var part = csTransportAnswer_(ctx).tabs.vehicles.rows[0];
    ctx.date = '2026-12-25';
    var free = csTransportAnswer_(ctx).tabs.vehicles.rows[0];
    stAssert_(out, P + 'availability: Booked only when the day\'s bookings cover the observed window, Partly Booked with ' +
                   'any other booking, Available with none; the client\'s booking links its trip',
              full.status === 'Booked' && evening.status === 'Partly Booked' && part.status === 'Partly Booked' &&
              free.status === 'Available' && part.bookings[0].trip_id === 'vc9',
              JSON.stringify([full.status, evening.status, part.status, free.status]));
    var m = a.tabs.mileage;
    stAssert_(out, P + 'mileage: units on shifts with the client, a "Last, First" consumer matched, a zero dropped',
              m.rows.length === 1 && m.rows[0].units === 10 && m.rows[0].record === 'Ann Aide' && m.kpis.units === 10 &&
              m.kpis.shifts === 1 && m.as_of === '2026-09-23', JSON.stringify(m));

    // ---- a failing source says why ----
    ctx = sources();
    ctx.client = { client_key: 'kayone', name: 'Kay One' };
    ctx.names = { kayone: true };
    ctx.today = '2026-09-28';
    ctx.date = '2026-10-02';
    ctx.book = { id: 'st', requests: null, conflicts: null, requests_why: 'the Van Calendar book could not be opened (st)',
                 conflicts_why: 'the Van Calendar book could not be opened (st)', total: 0, realigned: 0, unread: 0 };
    ctx.punches = { rows: null, why: 'the PSI punch house is not declared' };
    var down = csTransportAnswer_(ctx);
    stAssert_(out, P + 'an unreadable book: the tabs say why, carry no KPI dressed as zero, the fleet is empty with the reason, ' +
                   'the van visits still show, and the answer is degraded',
              down.degraded === true && /Van Calendar book could not be opened/.test(down.tabs.history.why) &&
              down.tabs.history.kpis === null && down.tabs.calendar.kpis === null && down.tabs.vehicles.kpis === null &&
              down.tabs.vehicles.rows.length === 0 && /could not be opened/.test(down.tabs.vehicles.why) &&
              down.tabs.history.rows.length === 4 && down.tabs.mileage.kpis === null &&
              down.tabs.mileage.why === 'the PSI punch house is not declared', JSON.stringify(down.tabs.history));

    // ---- the door, end to end ----
    clientsDerived_ = function () { return [{ client_key: 'kayone', name: 'Kay One' }]; };
    hubProp_ = function () { return ''; };
    csTransportToday_ = function () { return '2026-09-28'; };
    csTransportCache_ = function (k, fn) { return fn(); };
    ssOpen_ = function () { return { getSheetByName: function (t) { return book[t] ? stCstSheet_(book[t]) : null; } }; };
    estateRows_ = function (r) { return r === 'drVisits' ? sources().visits.rows : r === 'workOrders' ? sources().repairs.rows : []; };
    listRows_ = function () { return []; };
    psiPunchesFullSheet_ = function () { return null; };
    var door = HUB_ACTIONS.clientSourceTransport({ client: 'kayone', date: '2026-10-02' }, master);
    var badDate = HUB_ACTIONS.clientSourceTransport({ client: 'kayone', date: '10/2/2026' }, master);
    ssOpen_ = function () { throw new Error('st: no access'); };
    var shut = HUB_ACTIONS.clientSourceTransport({ client: 'kayone' }, master);
    stAssert_(out, P + 'the door: the master reads the four tabs; a day not written yyyy-mm-dd is 400; a book that will not ' +
                   'open answers 200 with the reason on the tabs; nothing is logged',
              door.status === 200 && door.data.tabs.history.rows.length === 7 && door.data.date === '2026-10-02' &&
              door.data.sources[0].realigned === 4 && /PSI punch house is not declared/.test(door.data.tabs.mileage.why) &&
              badDate.status === 400 && shut.status === 200 && /could not be opened \(st: no access\)/.test(shut.data.tabs.history.why) &&
              shut.data.degraded === true && logged === 0,
              JSON.stringify([door.status, door.data && door.data.tabs.history.rows.length, badDate, shut.data && shut.data.tabs.history.why]));

    // ---- an appointment save retires the kept trips ----
    var visitsBook = { id: 'st_cst_' + Date.now(), tab: 'Dr Appt Archive' };
    var visitsScope = cacheScopeSheet_(visitsBook.id, visitsBook.tab);
    estateSource_ = function (r) { return r === 'drVisits' ? visitsBook : null; };
    CacheService.getScriptCache().put('ver_' + visitsScope, '1', 21600);
    var kept = [];
    csTransportCache_ = function (k) { kept.push(k); return {}; };
    HUB_ACTIONS.clientSourceTransport({ client: 'kayone', date: '2026-10-02' }, master);
    HUB_ACTIONS.clientSourceTransport({ client: 'kayone', date: '2026-10-02' }, master);
    cacheBump_(visitsScope);
    HUB_ACTIONS.clientSourceTransport({ client: 'kayone', date: '2026-10-02' }, master);
    stAssert_(out, P + 'the kept answer is named by the Dr Appt Archive\'s cache version, so the estate\'s write of a ' +
                   'visit (the appointment pencil) retires it at once',
              kept.length === 3 && kept[0] === kept[1] && kept[2] !== kept[1] && /_1$/.test(kept[0]) &&
              kept[2].indexOf('cst_transport_v1_kayone_2026-10-02_2026-09-28_') === 0, kept.join(' | '));
  } finally {
    estateSource_ = keep.source;
    csTransportClient_ = keep.client;
    clientsDerived_ = keep.derived;
    ssOpen_ = keep.open;
    estateRows_ = keep.estate;
    listRows_ = keep.list;
    psiPunchesFullSheet_ = keep.psiSheet;
    psiPunchesRows_ = keep.psiRows;
    csTransportToday_ = keep.today;
    csTransportCache_ = keep.cache;
    hubProp_ = keep.prop;
    hubSysLog_ = keep.log;
    HUB_MASTER_EMAIL_CACHE = keep.masterCache;
    HUB_MEMBER_CTX = keep.member;
    hubProfileAppRules_ = keep.rules;
    HUB_VIEWER_MEMO = null;
  }
}
