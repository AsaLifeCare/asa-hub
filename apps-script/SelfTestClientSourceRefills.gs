/** An in-memory book: getSheetByName(tab) → a sheet whose data range answers display text. */
function stCsrBook_(tabs) {
  return {
    getSheetByName: function (name) {
      var grid = tabs[name];
      if (!grid) return null;
      return { getDataRange: function () {
        return { getDisplayValues: function () {
          var w = grid.length ? grid[0].length : 0;
          return grid.map(function (row) {
            var line = [];
            for (var c = 0; c < w; c++) line.push(row[c] === undefined ? '' : String(row[c]));
            return line;
          });
        } };
      } };
    }
  };
}

/** Clients › Refills: the master-only gate, the name join, the shaping of each tab, and a failing source saying why. */
function stClientSourceRefills_(out) {
  var P = 'client refills: ';

  // ---- declarations ----
  var bad = [];
  CSR_ACTIONS.forEach(function (a) {
    var p = HUB_POLICY[a];
    if (!p || p.file !== 'ClientSourceRefills.gs' || typeof HUB_ACTIONS[a] !== 'function') { bad.push(a + ': undeclared'); return; }
    if (p.lane !== 'read' || p.idempotent !== true || p.store !== 'sheet') bad.push(a + ': lane/store/idempotent');
    if (JSON.stringify(p.roles) !== JSON.stringify(ST_CP_READ_ROLES)) bad.push(a + ': roles ' + JSON.stringify(p.roles));
    if ((p.invalidates || []).length || (p.emits || []).length) bad.push(a + ': invalidates/emits');
    var params = p.params || {};
    Object.keys(params).forEach(function (k) { if (params[k] && params[k].required) bad.push(a + ': ' + k + ' required at the door'); });
  });
  stAssert_(out, P + 'every action is a read declared in ClientSourceRefills.gs for every role App Control may release ' +
                 'Clients to, invalidating no slice, emitting nothing, and requiring no param before the gate',
            bad.length === 0, bad.join('; '));
  var asResource = Object.keys(RESOURCES).filter(function (k) {
    return /^clientSource/i.test(k) || /^csr_/i.test(String(RESOURCES[k] && RESOURCES[k].sheet));
  });
  stAssert_(out, P + 'no generic resource reaches this door\'s answers', asResource.length === 0, asResource.join());

  // ---- dates as the book writes them ----
  var days = [csrDay_('9/30/2025'), csrDay_('10/1/26'), csrDay_('Thursday, December 12, 2024'), csrDay_('2026-06-01'),
              csrDay_('2/30/2026'), csrDay_('12/30'), csrDay_('y'), csrDay_('')];
  stAssert_(out, P + 'a day is read in the book\'s own spellings; an impossible or year-less one is never a date',
            days.join('|') === '2025-09-30|2026-10-01|2024-12-12|2026-06-01||||', days.join('|'));
  var ats = [csrAt_('9/22/2025 9:51:14'), csrAt_('9/28/2026 13:01:01'), csrAt_('1/5/2026 1:05 PM'), csrAt_('6/1/2026'),
             csrAt_('2026-09-22T09:51:14'), csrAt_('soon')];
  stAssert_(out, P + 'a timestamp keeps the book\'s wall clock; a bare day stays a day',
            ats.join('|') === '2025-09-22T09:51:14|2026-09-28T13:01:01|2026-01-05T13:05:00|2026-06-01|2026-09-22T09:51:14|',
            ats.join('|'));
  var labels = [csrDayLabel_('2026-09-30'), csrDayLabel_('2024-01-05'), csrDayLabel_('soon'), csrDayLabel_('')];
  stAssert_(out, P + 'a run-out day in DETAILS is drawn as the tab draws its dates; a word is not a day',
            labels.join('|') === 'Sep 30, 2026|Jan 5, 2024||', labels.join('|'));
  var worded = csrReport_({ id: 'w', form: 'live', source: 's', reported_at: '2026-09-01T08:00:00', issue: 'Low',
                            runs_out: '', runs_out_text: 'next week' });
  stAssert_(out, P + 'a run-out the book wrote in words stays in its words', worded.details === 'Low · runs out next week',
            worded.details);

  // ---- the stores ----
  var FR4 = [
    ['Status', 'Column 1', 'Timestamp', 'Your Name', 'Select Client:', 'Ann Test : Medications', 'Bob Test : Medications',
     "What's the issue related?", 'Expected date to run out of medication',
     'If you don’t see the missing medication above, please tell us here:'],
    ['Completed', 'Called 29/09', '9/22/2026 9:51:14', 'Sam Staff', 'Ann Test', 'LORAZEPAM TAB 0.5MG', '',
     'Not delivered', '9/30/2026', ''],
    ['', '', '9/27/2026 13:01:01', 'Sam Staff', 'Ann  Test', '', '', 'Partially Delivered', '10/6/2026',
     'refill too soon'],
    ['Outstanding', '', '9/28/2026 8:00:00', 'Lee Staff', 'Bob Test', '', 'SECRET BOB DRUG', 'Not delivered',
     '10/2/2026', '']
  ];
  var FR1 = [
    ['Status', 'Timestamp', 'Your Name', 'Client Name', 'Issue Description', 'Medication(s) Name',
     'Expected date to run out of medication', 'House', 'Dr', 'OTC', 'Notes'],
    ['Resolved', '10/4/2024 12:29:48', 'Old Staff', 'ann test', 'Low', 'CITALOPRAM TAB 20MG', '12/1/2024', '48th (A)',
     'Dr One', 'Yes', 'contacted']
  ];
  var LOW = [
    ['Dr', 'Med', 'OTC', 'Dr #', 'House', 'Notes', 'Client', 'Status', 'Manager', 'Contact Dr', '# of Refills',
     'Important Med?', 'Finney\'s Received'],
    ['Dr One', 'GABAPENTIN CAP 400MG', 'Script Req', '3305550100', '48th (A)', 'check Mon', 'Ann Test', 'Outstanding',
     'Hal Manager', 'Thursday, December 12, 2024', '2', 'Yes', 'n'],
    ['Dr Two', 'SECRET BOB LOW', '', '', '', '', 'Bob Test', 'Completed', '', 'y', '', '', '']
  ];
  var CONTROL = [
    ['Client Name', 'Medication Name', 'Physician Name', 'Physian NO.', 'Qty Written', 'Qty Dispensed', 'Qty Remaining',
     'Days Supply', 'Buffer Days', 'Refill Status', 'Next Refill Due', 'Notes / Action Needed'],
    ['Ann Test', 'OMEPRAZOLE CAP 40MG', 'Dr One', '123', '62', '27', '35', '', '', '', '', 'TAKE 1 DAILY'],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
    ['Bob Test', 'SECRET BOB CONTROL', '', '', '', '', '', '', '', '', '', '']
  ];
  var DERIVED = [{ client_key: 'st_ann', name: 'Ann Test' }, { client_key: 'st_bob', name: 'Bob Test' }];
  var COPY = [{ id: 'mm1', client_key: 'st_ann', client_name: 'Ann Test', reported_at: '5/27/2026 13:12:21',
                issue: 'Not delivered', status: '', medications: 'COPY DRUG', expected_runout: '6/1/2026',
                reporter: 'Sam Staff', free_text: '' },
              { id: 'mm2', client_key: 'st_bob', client_name: 'Bob Test', reported_at: '5/27/2026 13:13:40',
                issue: 'Not delivered', status: '', medications: 'SECRET BOB COPY', expected_runout: '',
                reporter: 'Lee Staff', free_text: '' }];

  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var keep = {
    derived: clientsDerived_, open: ssOpen_, list: listRows_, today: locationsToday_, cached: csrCached_,
    read: cacheRead_, bump: cacheBump_, masterCache: HUB_MASTER_EMAIL_CACHE, member: HUB_MEMBER_CTX,
    service: HUB_IS_SERVICE_REQ, rules: hubProfileAppRules_, users: usersAll_
  };
  var master = { email: HUB_MASTER_ACCOUNT, role: 'admin' };
  var tabs = { 'Form Responses 4': FR4, 'Form Responses 1': FR1, 'Low Refills': LOW, 'Medication Control': CONTROL };
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    HUB_MEMBER_CTX = null;
    HUB_IS_SERVICE_REQ = false;
    var derivedAsked = 0, opened = 0;
    clientsDerived_ = function () { derivedAsked++; return DERIVED.map(function (r) { return { client_key: r.client_key, name: r.name }; }); };
    ssOpen_ = function () { opened++; return stCsrBook_(tabs); };
    listRows_ = function (resource) {
      if (resource !== CSR_COPY_RESOURCE) throw new Error('st: unexpected tab ' + resource);
      return COPY.slice();
    };
    locationsToday_ = function () { return '2026-09-28'; };
    csrCached_ = function (a, k, producer) { return producer(); };

    // ---- the gate (no App Control row: the master's alone; a visit's own row is on no book) ----
    hubProfileAppRules_ = function () { return { rules: {}, tenants: {} }; };
    usersAll_ = function () { return []; };
    HUB_VIEWER_MEMO = null;
    var callers = [
      { email: 'admin@example.org', role: 'admin' },
      { email: 'mgr@example.org', role: 'manager' },
      { id: 'u-st9', email: 'st9@example.org', role: 'staff', types: ['STAFF'] },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', is_service: true },
      { email: HUB_MASTER_ACCOUNT, role: 'manager' },
      null
    ];
    var leaks = [];
    var shape = function (r) { return !!r && r.status === 404 && r.message === 'Unknown action.' && Object.keys(r).length === 2; };
    CSR_ACTIONS.forEach(function (a) {
      callers.forEach(function (u) {
        var r = HUB_ACTIONS[a]({ client: 'st_ann' }, u);
        if (!shape(r)) leaks.push(a + ' ' + JSON.stringify(u) + ' → ' + JSON.stringify(r));
      });
      HUB_MEMBER_CTX = { memberId: 'mem_st', userId: 'u-st', email: 'ann@example.org' };
      var inVisit = HUB_ACTIONS[a]({ client: 'st_ann' }, master);
      HUB_MEMBER_CTX = null;
      if (!shape(inVisit)) leaks.push(a + ' in a visit → ' + JSON.stringify(inVisit));
      HUB_IS_SERVICE_REQ = true;
      var asService = HUB_ACTIONS[a]({ client: 'st_ann' }, master);
      HUB_IS_SERVICE_REQ = false;
      if (!shape(asService)) leaks.push(a + ' on a service request → ' + JSON.stringify(asService));
    });
    stAssert_(out, P + 'with no App Control row: a non-master, a manager, a staff member, a visit, the service identity ' +
                   'and no session all get the 404 shape, before a client or a book is read',
              leaks.length === 0 && derivedAsked === 0 && opened === 0,
              leaks.slice(0, 4).join(' | ') + ' derived=' + derivedAsked + ' opened=' + opened);
    var blank = HUB_ACTIONS.clientSourceRefills({ client: '  ' }, master);
    var unknown = HUB_ACTIONS.clientSourceRefills({ client: 'st_nobody' }, master);
    stAssert_(out, P + 'the master passes the gate: no client is 400, an unknown client is 404 and no book is opened',
              blank.status === 400 && unknown.status === 404 && unknown.message === 'No such client.' && opened === 0,
              JSON.stringify([blank, unknown, opened]));

    // ---- the join and the shaping ----
    var got = HUB_ACTIONS.clientSourceRefills({ client: 'st_ann' }, master);
    var d = got.data || {};
    var t = d.tabs || {};
    var rep = (t.reports && t.reports.rows) || [];
    var text = JSON.stringify(got);
    stAssert_(out, P + 'the answer is {client, name, tabs:{reports, low_refills, control}}, each tab {rows, kpis, why, ' +
                   'as_of, note}, and nothing of another client rides it',
              got.status === 200 && d.client === 'st_ann' && d.name === 'Ann Test' &&
              ['reports', 'low_refills', 'control'].every(function (k) {
                var x = t[k];
                return x && Array.isArray(x.rows) && typeof x.kpis === 'object' && typeof x.why === 'string' &&
                       typeof x.as_of === 'string' && typeof x.note === 'string';
              }) && text.indexOf('SECRET BOB') === -1 && text.indexOf('Lee Staff') === -1 && d.degraded === false,
              text.slice(0, 600));
    stAssert_(out, P + 'reports: the live form and the earlier one, joined by the normalised name, newest first',
              rep.length === 3 && rep[0].id === 'live-3' && rep[1].id === 'live-2' && rep[2].id === 'earlier-2' &&
              rep[2].form === 'earlier' && rep[2].house === '48th (A)',
              JSON.stringify(rep.map(function (r) { return r.id; })));
    var first = rep[1] || {}, second = rep[0] || {};
    stAssert_(out, P + 'a report reads the medication from the client\'s own column, the run-out day as ISO, the office ' +
                   'note, and a blank status as Reported; with no medication named, the free text is the record',
              first.record === 'LORAZEPAM TAB 0.5MG' && first.runs_out === '2026-09-30' && first.date === '2026-09-22' &&
              first.status === 'Completed' && first.office_note === 'Called 29/09' &&
              first.details === 'Not delivered · runs out Sep 30, 2026' &&
              second.record === 'refill too soon' && second.status === 'Reported' &&
              second.reported_at === '2026-09-27T13:01:01',
              JSON.stringify([first, second]));
    var k = t.reports ? t.reports.kpis : {};
    stAssert_(out, P + 'reports kpis: the open ones, the next run-out still ahead among them, the last report; as_of is ' +
                   'the newest line of the live form',
              k.reports === 3 && k.open === 1 && k.next_run_out === '2026-10-06' && k.last_reported === '2026-09-27' &&
              t.reports.as_of === '2026-09-28', JSON.stringify([k, t.reports && t.reports.as_of]));
    var low = (t.low_refills && t.low_refills.rows) || [];
    stAssert_(out, P + 'low refills: the client\'s rows with the refills left, the prescriber, the day the doctor was ' +
                   'contacted, and the outstanding count',
              low.length === 1 && low[0].record === 'GABAPENTIN CAP 400MG' && low[0].date === '2024-12-12' &&
              low[0].details === 'Refills: 2 · Script Req · Dr One' && low[0].status === 'Outstanding' &&
              low[0].dr_phone === '3305550100' && low[0].important === true && low[0].pharmacy_received === 'n' &&
              t.low_refills.kpis.outstanding === 1, JSON.stringify(low));
    var ctl = (t.control && t.control.rows) || [];
    stAssert_(out, P + 'medication control: a row with no Next Refill Due is "No due date" and the tab says the book ' +
                   'writes none — never an invented date',
              ctl.length === 1 && ctl[0].record === 'OMEPRAZOLE CAP 40MG' && ctl[0].date === '' &&
              ctl[0].status === 'No due date' && ctl[0].qty_remaining === '35' &&
              ctl[0].details === 'written 62, dispensed 27, 35 remaining · Dr One' &&
              /writes no Days Supply or Next Refill Due/.test(t.control.note), JSON.stringify(t.control));
    CONTROL[1][10] = '9/20/2026';
    CONTROL.push(['Ann Test', 'LATER CAP', '', '', '', '', '', '30', '', '', '10/20/2026', '']);
    var dated = HUB_ACTIONS.clientSourceRefills({ client: 'st_ann' }, master).data.tabs.control;
    stAssert_(out, P + 'medication control: a written due day is Due once reached and Scheduled before it',
              dated.rows.length === 2 && dated.rows[0].status === 'Due' && dated.rows[1].status === 'Scheduled' &&
              dated.kpis.with_due_date === 2 && dated.kpis.due === 1 && dated.note === '', JSON.stringify(dated));

    // ---- a source that cannot be read says why ----
    delete tabs['Low Refills'];
    var noLow = HUB_ACTIONS.clientSourceRefills({ client: 'st_ann' }, master).data;
    stAssert_(out, P + 'a missing tab answers its own tab with why, never an empty table, and the answer is degraded',
              noLow.tabs.low_refills.rows.length === 0 && /no Low Refills tab/.test(noLow.tabs.low_refills.why) &&
              noLow.tabs.reports.rows.length === 3 && noLow.degraded === true, JSON.stringify(noLow.tabs.low_refills));
    tabs['Low Refills'] = LOW;
    ssOpen_ = function () { throw new Error('no access'); };
    var shut = HUB_ACTIONS.clientSourceRefills({ client: 'st_ann' }, master).data;
    stAssert_(out, P + 'with the book shut, reports fall back to the Hub\'s copy with the reason and its last day; the ' +
                   'other tabs say why',
              shut.degraded === true && shut.tabs.reports.rows.length === 1 && shut.tabs.reports.rows[0].form === 'copy' &&
              shut.tabs.reports.rows[0].runs_out === '2026-06-01' && /could not be opened \(no access\)/.test(shut.tabs.reports.why) &&
              shut.tabs.reports.as_of === '2026-05-27' && JSON.stringify(shut).indexOf('SECRET BOB') === -1 &&
              /could not be opened/.test(shut.tabs.low_refills.why) && shut.tabs.low_refills.rows.length === 0 &&
              /could not be opened/.test(shut.tabs.control.why), JSON.stringify(shut.tabs.reports).slice(0, 400));
    listRows_ = function () { throw new Error('copy gone'); };
    var both = HUB_ACTIONS.clientSourceRefills({ client: 'st_ann' }, master).data.tabs.reports;
    stAssert_(out, P + 'with the book and the copy both unreadable, reports carry both reasons and no rows',
              both.rows.length === 0 && /could not be opened/.test(both.why) && /copy gone/.test(both.why), JSON.stringify(both));
    ssOpen_ = function () { return stCsrBook_(tabs); };

    // ---- two clients, one name ----
    clientsDerived_ = function () {
      return DERIVED.concat([{ client_key: 'st_ann2', name: 'Ann Test' }]).map(function (r) {
        return { client_key: r.client_key, name: r.name };
      });
    };
    var twin = HUB_ACTIONS.clientSourceRefills({ client: 'st_ann' }, master).data;
    stAssert_(out, P + 'two clients carrying one name are refused a name join: every tab says so and carries no row',
              ['reports', 'low_refills', 'control'].every(function (x) {
                return twin.tabs[x].rows.length === 0 && /Another client on file carries this name/.test(twin.tabs[x].why);
              }), JSON.stringify(twin.tabs.reports));

    // ---- the cache ----
    csrCached_ = keep.cached;
    var bumped = [], names = [];
    cacheRead_ = function (scope, name, producer) { names.push(scope + '|' + name); return producer(); };
    cacheBump_ = function (scope) { bumped.push(scope); };
    csrCached_('clientSourceRefills', 'st_ann', function () { return { degraded: false }; });
    csrCached_('clientSourceRefills', 'st_ann', function () { return { degraded: true }; });
    stAssert_(out, P + 'the cache is keyed per client and per minute, and a degraded answer is dropped at once',
              bumped.length === 1 && bumped[0] === 'csr_clientSourceRefills_st_ann' &&
              /^csr_clientSourceRefills_st_ann\|v1_\d+$/.test(names[0] || ''), JSON.stringify([names, bumped]));

    // ---- no name in a log ----
    var logged = ['csrAnswer_', 'csrReports_', 'csrFormRows_', 'csrCopyRows_', 'csrLowRefills_', 'csrControl_']
      .filter(function (fn) { return /hubSysLog_|Logger\.log|console\./.test(stCode_(g[fn])); })
      .concat(/hubSysLog_|Logger\.log|console\./.test(stCode_(keep.cached)) ? ['csrCached_'] : [])
      .concat(/hubSysLog_|Logger\.log|console\./.test(stCode_(HUB_ACTIONS.clientSourceRefills)) ? ['clientSourceRefills'] : []);
    stAssert_(out, P + 'no read writes a log line (a line would carry a client\'s name)', logged.length === 0, logged.join());
  } finally {
    clientsDerived_ = keep.derived;
    ssOpen_ = keep.open;
    listRows_ = keep.list;
    locationsToday_ = keep.today;
    csrCached_ = keep.cached;
    cacheRead_ = keep.read;
    cacheBump_ = keep.bump;
    HUB_MASTER_EMAIL_CACHE = keep.masterCache;
    HUB_MEMBER_CTX = keep.member;
    HUB_IS_SERVICE_REQ = keep.service;
    hubProfileAppRules_ = keep.rules;
    usersAll_ = keep.users;
    HUB_VIEWER_MEMO = null;
  }
}
