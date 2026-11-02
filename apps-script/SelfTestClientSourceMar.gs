/** A Drive folder held in memory: {name, files: [{id, name}], folders: [...]}. */
function stCsmFolder_(spec) {
  var iter = function (list) {
    var i = 0;
    return { hasNext: function () { return i < list.length; }, next: function () { return list[i++]; } };
  };
  var file = function (f) {
    return {
      getId: function () { return f.id; }, getName: function () { return f.name; },
      getMimeType: function () { return f.mime || 'application/pdf'; }, getSize: function () { return f.size || 1024; },
      getLastUpdated: function () { return new Date('2026-09-20T12:00:00Z'); }
    };
  };
  return {
    getId: function () { return spec.id || spec.name; },
    getName: function () { return spec.name; },
    getFiles: function () { return iter((spec.files || []).map(file)); },
    getFolders: function () { return iter((spec.folders || []).map(stCsmFolder_)); }
  };
}

/** Clients › Administration: the master-only gate, the joins, the day repair, the shaping, a failing source, the doc door and the scan. */
function stClientSourceMar_(out) {
  var P = 'client sources, mar: ';

  // ---- declarations ----
  var bad = [];
  CSM_ACTIONS.forEach(function (a) {
    var p = HUB_POLICY[a];
    if (!p || p.file !== 'ClientSourceMar.gs' || typeof HUB_ACTIONS[a] !== 'function') { bad.push(a + ': undeclared'); return; }
    if (RESOLVER_LANES.indexOf(p.lane) === -1 || RESOLVER_STORES.indexOf(p.store) === -1 ||
        RESOLVER_COSTS.indexOf(p.cost) === -1) bad.push(a + ': lane/store/cost');
    if (JSON.stringify(p.roles) !== JSON.stringify(ST_CP_READ_ROLES)) bad.push(a + ': roles ' + JSON.stringify(p.roles));
    if ((p.invalidates || []).length || (p.emits || []).length) bad.push(a + ': invalidates/emits');
    if (p.idempotent !== true) bad.push(a + ': not idempotent');
    var params = p.params || {};
    Object.keys(params).forEach(function (k) { if (params[k] && params[k].required) bad.push(a + ': ' + k + ' required at the door'); });
  });
  stAssert_(out, P + 'the three doors are declared in ClientSourceMar.gs for every role App Control may release Clients ' +
                 'to, idempotent, invalidating and emitting nothing, requiring no param before the gate; the read rides ' +
                 'the read lane',
            bad.length === 0 && CSM_ACTIONS.length === 3 && HUB_POLICY.clientSourceMar.lane === 'read', bad.join('; '));
  var asResource = Object.keys(RESOURCES).filter(function (k) {
    return /^clientSource/i.test(k) || (RESOURCES[k] && /^csm_/.test(String(RESOURCES[k].sheet || '')));
  });
  stAssert_(out, P + 'no RESOURCE reads through these doors, so no generic route or slice can reach them',
            asResource.length === 0, asResource.join());

  var keep = {
    derived: clientsDerived_, list: listRows_, bytes: locationsDocBytes_, root: csmClientsRoot_, text: csmDriveText_,
    masterCache: HUB_MASTER_EMAIL_CACHE, member: HUB_MEMBER_CTX, cacheRead: cacheRead_, cacheVersion: cacheVersion_,
    cacheBump: cacheBump_, cacheScope: cacheScope_, log: hubSysLog_, create: createRow_, update: updateRowById_,
    rules: hubProfileAppRules_
  };
  var master = { email: HUB_MASTER_ACCOUNT, role: 'admin' };
  var logged = 0, writes = 0;
  var cfxUndo = stCfxStub_();
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    HUB_MEMBER_CTX = null;
    cacheRead_ = function (scope, name, producer) { return producer(); };
    cacheVersion_ = function () { return '1'; };
    cacheBump_ = function () {};
    cacheScope_ = function (t) { return t; };
    hubSysLog_ = function () { logged++; };
    createRow_ = function () { writes++; return {}; };
    updateRowById_ = function () { writes++; return {}; };

    // ---- the gate (no App Control row: the master's alone) ----
    hubProfileAppRules_ = function () { return { rules: {}, tenants: {} }; };
    HUB_VIEWER_MEMO = null;
    var asked = 0;
    clientsDerived_ = function () { asked++; return []; };
    listRows_ = function () { asked++; return []; };
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
    CSM_ACTIONS.forEach(function (a) {
      callers.forEach(function (u) {
        var r = HUB_ACTIONS[a]({ client: 'kmarsh', file_id: 'fileAug000001' }, u);
        if (!shape(r)) leaks.push(a + ' ' + JSON.stringify(u) + ' → ' + JSON.stringify(r));
      });
      HUB_MEMBER_CTX = { memberId: 'mem_st', userId: 'u-st', email: 'ann@example.org' };
      var inVisit = HUB_ACTIONS[a]({ client: 'kmarsh' }, master);
      HUB_MEMBER_CTX = null;
      if (!shape(inVisit)) leaks.push(a + ' in a visit → ' + JSON.stringify(inVisit));
    });
    stAssert_(out, P + 'with no App Control row: a non-master, a manager, a staff member, a visit, the service identity ' +
                   'and no session all get the 404 shape, before any client or row is read', leaks.length === 0 && asked === 0,
              leaks.slice(0, 4).join(' | ') + ' asked=' + asked);

    // ---- the stores ----
    clientsDerived_ = function () {
      return [{ client_key: 'kmarsh', name: 'Kenny Marsh', status: 'active' },
              { client_key: 'lgomez', name: 'Lia Gomez', status: 'active' },
              { name: 'No Key Person', status: 'active' }];
    };
    var passes = [
      { id: 'emar_2', source_row: 'emar:2', client: 'Kenny Marsh', medication: 'Sucralfate', status: 'Pass', date: '2025-06-10',
        schedule: '8:00 PM', administeredBy: 'Ann Lee', src_dosage: '1gm', src_medtype: 'Pill' },
      { id: 'emar_3', source_row: 'emar:3', client: 'kenny  marsh', medication: 'Sucralfate', status: 'Cancel',
        date: '2025-11-06 10:17', src_withheld_type: 'At Workshop' },
      { id: 'emar_4', source_row: 'emar:4', client: 'Lia Gomez', medication: 'Aspirin', status: 'Pass', date: '13/06/2025, 09:00:00' },
      { id: 'emar_5', source_row: 'emar:5', client: 'Kenny Marsh', medication: 'Folic acid', status: 'Discontinued',
        date: '2025-07-07 20:00' },
      { id: 'emar_6', source_row: 'emar:6', client: 'Kenny Marsh', medication: 'Folic acid', status: 'Pass',
        date: '2025-07-08 08:00', administeredBy: 'asatech' },
      { id: 'emar_7', source_row: 'emar:7', client: 'Kenny Marsh', medication: 'Metoprolol', status: 'Breakdown',
        date: '12:00:00 AM', src_withheld_type: 'Stopped due to critical measure' },
      { id: 'emar_8', source_row: 'emar:8', client: 'Kenny Marsh', medication: 'Tylenol', status: 'Pass', date: '2025-07-13 09:30',
        src_prn: 'PRN', src_prn_reason: 'Pain' },
      { id: 'emar_9', source_row: 'emar:9', client: 'Other Client', medication: 'X', status: 'Pass', date: '2025-08-14 08:00' }
    ];
    var files = [
      { id: 'CDOC_a', client_key: 'kmarsh', client_name: 'Kenny Marsh', doc_kind: 'mar', title: 'MARS_2026 August_Kenny Marsh.pdf',
        file_date: '2026-08-01', drive_id: 'fileAug000001', kind: 'pdf', mime_type: 'application/pdf', size_bytes: '5007089',
        folder: 'MARS', digest_state: 'done', digest_text: 'KENNY AUGUST DIGEST', text_file: 'textAug000001',
        createdAt: '2026-09-09T12:15:14Z' },
      { id: 'CDOC_b', client_key: 'kmarsh', client_name: 'Kenny Marsh', doc_kind: 'mar', title: 'MARS_2026 July_Kenny Marsh.pdf',
        file_date: '2026-07-01', drive_id: 'fileJul000001', digest_state: 'pending' },
      { id: 'CDOC_c', client_key: '', client_name: 'Kenny Marsh', doc_kind: 'mar', title: 'MARS old', file_date: '',
        drive_id: 'fileOld000001' },
      { id: 'CDOC_d', client_key: 'lgomez', client_name: 'Kenny Marsh', doc_kind: 'mar', title: 'MARS Lia',
        file_date: '2026-09-01', drive_id: 'fileLia000001' },
      { id: 'CDOC_e', client_key: 'kmarsh', client_name: 'Kenny Marsh', doc_kind: 'isp', title: 'ISP', drive_id: 'fileIsp000001' }
    ];
    var errors = [
      { id: 'e1', client_key: 'kmarsh', client_name: 'Kenny Marsh', error_date: '9/9/2025', medication: 'Cilostazol',
        flags: 'Circled, Initialed, Explained, Missed', problem: 'NI NE', time: '8p' },
      { id: 'e2', client_key: 'km', client_name: 'Kenny  Marsh', error_date: '6/2', year: '2026', medication: 'Aspirin',
        flags: 'Circled, (I) Wrong Day' },
      { id: 'e3', client_key: '', client_name: 'KM', error_date: 'Various', flags: '' },
      { id: 'e4', client_key: 'lgomez', client_name: 'Lia Gomez', error_date: '2026-06-30', flags: 'Controlled' },
      { id: 'e5', client_key: 'kmarsh', client_name: 'Kenny Marsh', error_date: 'most of month', flags: 'Initialed' }
    ];
    var failing = {};
    listRows_ = function (r) {
      if (failing[r]) throw new Error('st: ' + r + ' closed');
      return r === 'marEntries' ? passes : r === 'clientFiles' ? files : r === 'marErrors' ? errors : [];
    };

    // ---- the client ----
    var none = HUB_ACTIONS.clientSourceMar({}, master);
    var unknown = HUB_ACTIONS.clientSourceMar({ client: 'nobody' }, master);
    var byFold = csmClient_('nokeyperson');
    stAssert_(out, P + 'the client is a roster key: none is 400, an unknown one 404, a row with no key answers to its folded name',
              none.status === 400 && unknown.status === 404 && byFold.key === 'nokeyperson' && !!byFold.names.nokeyperson,
              JSON.stringify([none, unknown, byFold.key]));

    var ans = HUB_ACTIONS.clientSourceMar({ client: 'kmarsh' }, master);
    var d = ans.data || { tabs: {} };
    var tabs = d.tabs || {};
    stAssert_(out, P + 'the answer is {client, tabs:{papers, passes, errors}}, each tab {rows, kpis, statuses, why}',
              ans.status === 200 && d.client.client_key === 'kmarsh' && d.client.name === 'Kenny Marsh' &&
              CSM_TABS.every(function (t) { return tabs[t] && Array.isArray(tabs[t].rows) && tabs[t].why === '' &&
                                                   typeof tabs[t].kpis === 'object' && Array.isArray(tabs[t].statuses); }) &&
              d.degraded === false, JSON.stringify(ans).slice(0, 300));

    // ---- the passes ----
    var pr = tabs.passes.rows || [];
    var byId = {};
    pr.forEach(function (r) { byId[r.id] = r; });
    stAssert_(out, P + 'passes: joined by the folded name, another client left out; newest first, a pass with no day last',
              pr.map(function (r) { return r.id; }).join() === 'emar_8,emar_6,emar_5,emar_3,emar_2,emar_7',
              pr.map(function (r) { return r.id + ':' + r.date; }).join());
    stAssert_(out, P + 'passes: a day Sheets typed month-first is read back between its neighbours; a day that fits as ' +
                   'written stays; a day-first text Sheets refused reads day-first; a time with no day keeps no day',
              byId.emar_3.date === '2025-06-11' && byId.emar_3.date_fixed === true &&
              byId.emar_3.date_as_written === '2025-11-06 10:17' && byId.emar_6.date === '2025-07-08' &&
              byId.emar_6.date_fixed === false && byId.emar_7.date === '' && byId.emar_7.time === '00:00' &&
              csmPassDate_('13/06/2025, 09:00:00').day === '2025-06-13' &&
              csmPassDate_('7/16/2025, 1:05:00 PM').day === '2025-07-16' &&
              csmPassDate_('7/16/2025, 1:05:00 PM').time === '13:05' &&
              csmPassDate_('08/07/2025, 12:26:14').day === '2025-07-08' &&
              csmPassDate_('08/07/2025, 12:26:14').other === '2025-08-07' &&
              csmPassDate_('2025-06-10').other === '' && csmPassDate_('2025-06-03 08:00').other === '2025-03-06',
              JSON.stringify([byId.emar_3, byId.emar_6, byId.emar_7]).slice(0, 400));
    stAssert_(out, P + 'passes: Pass is Recorded, Cancel is Not given with its reason, Discontinued and Breakdown as they are; ' +
                   'the shared account is named for what it is',
              byId.emar_2.status === 'Recorded' && byId.emar_3.status === 'Not given' &&
              byId.emar_3.reason === 'At Workshop' && /Reason: At Workshop/.test(byId.emar_3.details) &&
              byId.emar_5.status === 'Discontinued' && byId.emar_7.status === 'Breakdown' &&
              byId.emar_7.reason === 'Stopped due to critical measure' &&
              byId.emar_6.given_by === CSM_SHARED_SIGNER_WORDS && byId.emar_6.signed_as === 'asatech' &&
              byId.emar_8.prn === true && /PRN: Pain/.test(byId.emar_8.details) &&
              tabs.passes.statuses.join() === 'Recorded,Not given,Discontinued,Breakdown',
              JSON.stringify(pr.map(function (r) { return [r.id, r.status, r.reason, r.given_by]; })));
    var pk = tabs.passes.kpis;
    stAssert_(out, P + 'passes: the counts are the rows\', and "as of" is the newest pass in the whole log',
              pk.passes === 6 && pk.recorded === 3 && pk.not_given === 1 && pk.discontinued === 1 && pk.breakdown === 1 &&
              pk.dates_fixed === 1 && pk.no_day === 1 && pk.first === '2025-06-10' && pk.last === '2025-07-13' &&
              tabs.passes.as_of === '2025-08-14', JSON.stringify(pk) + ' ' + tabs.passes.as_of);

    // ---- the papers ----
    var pp = tabs.papers.rows || [];
    stAssert_(out, P + 'papers: the client\'s MARS rows by key, a keyless row by its name, never another client\'s key; ' +
                   'newest first; Latest, Earlier and Undated',
              pp.map(function (r) { return r.id + ':' + r.status; }).join() === 'CDOC_a:Latest,CDOC_b:Earlier,CDOC_c:Undated' &&
              pp[0].file_id === 'fileAug000001' && pp[0].has_text === true && pp[0].date === '2026-08-01' &&
              /August 2026/.test(pp[0].details) && tabs.papers.kpis.papers === 3 && tabs.papers.kpis.months === 2 &&
              tabs.papers.kpis.latest === '2026-08-01' && tabs.papers.kpis.undated === 1 &&
              tabs.papers.as_of === '2026-09-01' && tabs.papers.indexed_at === '2026-09-09',
              JSON.stringify(pp.map(function (r) { return [r.id, r.status, r.date]; })) + ' ' + JSON.stringify(tabs.papers.kpis));
    stAssert_(out, P + 'papers: the OCR digest never rides the list — only the document door hands it out',
              JSON.stringify(ans).indexOf('KENNY AUGUST DIGEST') === -1 && JSON.stringify(ans).indexOf('textAug000001') === -1,
              'digest in the list');

    // ---- the errors ----
    var er = tabs.errors.rows || [];
    stAssert_(out, P + 'errors: by key, or by the folded name when the key is not a roster key; initials that name this ' +
                   'client alone join it, marked and counted apart; the audit\'s m/d day with the row\'s year; the ' +
                   'problem flag is the status',
              er.map(function (r) { return r.id + ':' + r.date + ':' + r.status + ':' + r.matched_by; }).join() ===
                'e2:2026-06-02:Wrong day:name,e1:2025-09-09:Missed:key,e5::Marked:key,e3::Not flagged:initials' &&
              er[1].marks.join() === 'Circled,Initialed,Explained' && er[1].kinds.join() === 'Missed' &&
              er[3].filed_as === 'KM' && /^Filed as KM/.test(er[3].details) && er[0].filed_as === '' &&
              tabs.errors.kpis.errors === 4 && tabs.errors.kpis.missed === 1 && tabs.errors.kpis.wrong_day === 1 &&
              tabs.errors.kpis.undated === 2 && tabs.errors.kpis.by_initials === 1 && tabs.errors.kpis.initials_held === 0 &&
              tabs.errors.initials === 'KM' && tabs.errors.initials_why === '' && tabs.errors.as_of === '2026-06-30' &&
              tabs.errors.statuses.join() === 'Missed,Wrong day,Marked,Not flagged',
              JSON.stringify(er.map(function (r) { return [r.id, r.date, r.status, r.matched_by]; })) + ' ' +
              JSON.stringify(tabs.errors.kpis));

    // ---- a source that cannot be read ----
    failing.marErrors = true;
    var hurt = HUB_ACTIONS.clientSourceMar({ client: 'kmarsh' }, master).data;
    failing.marErrors = false;
    stAssert_(out, P + 'an unreadable audit answers its tab with why and no counts, never an empty table dressed as zero; ' +
                   'the other tabs still answer and the whole is marked degraded',
              /the MAR errors audit could not be read/.test(hurt.tabs.errors.why) && hurt.tabs.errors.rows.length === 0 &&
              Object.keys(hurt.tabs.errors.kpis).length === 0 && hurt.tabs.passes.rows.length === 6 &&
              hurt.tabs.papers.why === '' && hurt.degraded === true, JSON.stringify(hurt.tabs.errors));

    // ---- rows the audit files only under initials ----
    stAssert_(out, P + 'initials are two or three letters of one case, dotted or spaced; a name is not initials',
              csmInitialsOnly_('TC') === 'TC' && csmInitialsOnly_('t.c.') === 'TC' && csmInitialsOnly_('K H') === 'KH' &&
              csmInitialsOnly_('Tom') === '' && csmInitialsOnly_('Tavi C') === '' && csmInitialsOnly_('tc1') === '' &&
              csmNameInitials_('Mary Ann Smith').join() === 'MS,MAS' && csmNameInitials_('TC').length === 0,
              JSON.stringify([csmInitialsOnly_('t.c.'), csmNameInitials_('Mary Ann Smith')]));
    var roster0 = clientsDerived_, errors0 = errors, files0 = files;
    var withTavi = function (more) {
      return function () { return roster0().concat([{ client_key: 'tavi_corvenly', name: 'Tavi Corvenly' }], more || []); };
    };
    var taviErrors = function () {
      return (HUB_ACTIONS.clientSourceMar({ client: 'tavi_corvenly' }, master).data || { tabs: {} }).tabs.errors || {};
    };
    clientsDerived_ = withTavi();
    errors = errors0.concat([
      { id: 'e6', client_key: 'tc', client_name: 'TC', error_date: '1/9/2023', medication: 'Med A', flags: 'Missed, Controlled' },
      { id: 'e7', client_key: '', client_name: 'tc', error_date: '8/17/2024', medication: 'Med B', flags: 'Initialed' }
    ]);
    var tavi = taviErrors();
    var kenny = HUB_ACTIONS.clientSourceMar({ client: 'kmarsh' }, master).data.tabs.errors;
    stAssert_(out, P + 'errors: "tc" and "TC" rows join the one roster client whose initials are TC, marked initials, ' +
                   'counted apart; every kind a row names is a status; another client does not take them',
              (tavi.rows || []).map(function (r) { return r.id + ':' + r.matched_by + ':' + r.filed_as; }).join() ===
                'e7:initials:TC,e6:initials:TC' &&
              tavi.kpis.by_initials === 2 && tavi.kpis.initials_held === 0 && tavi.initials === 'TC' &&
              tavi.statuses.join() === 'Missed,Controlled,Marked' && kenny.rows.length === 4,
              JSON.stringify([tavi.rows && tavi.rows.map(function (r) { return r.id; }), tavi.kpis, tavi.statuses]));
    var heldBy = function (label) {
      var t = taviErrors();
      return { label: label, ok: (t.rows || []).length === 0 && t.kpis && t.kpis.initials_held === 2 &&
                                 t.kpis.by_initials === 0, why: t.initials_why || '' };
    };
    errors = errors.concat([{ id: 'e8', client_key: 'tc', client_name: 'Tom Collins', error_date: '5/2/2025', flags: 'Missed' }]);
    var byAudit = heldBy('a full name in the audit');
    errors = errors.slice(0, -1);
    files = files0.concat([{ id: 'CDOC_t', client_key: '', client_name: 'Tina Cole', doc_kind: 'isp', drive_id: 'fileTina00001' }]);
    var byFiles = heldBy('a keyless name in the papers index');
    files = files0;
    clientsDerived_ = withTavi([{ client_key: 'tim_crane', name: 'Tim Crane' }]);
    var byRoster = heldBy('another roster client');
    clientsDerived_ = withTavi();
    errors = errors.concat([{ id: 'e9', client_key: '', client_name: 'Tavi Q. Corvenly (inactive)', error_date: '6/1/2025',
                              flags: 'Missed' }]);
    var sameFl = taviErrors();
    errors = errors.slice(0, -1);
    failing.clientFiles = true;
    var blindInitials = heldBy('an unreadable papers index');
    failing.clientFiles = false;
    stAssert_(out, P + 'errors: initials another roster client, a full name in the audit or a keyless name in the papers ' +
                   'index also fits are held back and counted, with why; the client\'s own first and last name spelled ' +
                   'another way is no one else; an unreadable index rules nobody out',
              byAudit.ok && byFiles.ok && byRoster.ok && /same initials/.test(byAudit.why) &&
              blindInitials.ok && /could not be read/.test(blindInitials.why) && sameFl.kpis.by_initials === 2 &&
              sameFl.kpis.initials_held === 0,
              JSON.stringify([byAudit, byFiles, byRoster, blindInitials, sameFl.kpis]));
    clientsDerived_ = roster0;
    errors = errors0;
    files = files0;

    // ---- the pass-time column ----
    var passes0 = passes;
    passes = [
      { id: 'emar_20', source_row: 'emar:20', client: 'Kenny Marsh', medication: 'A', status: 'Pass', date: '2025-08-14 08:00',
        schedule: '8:00 AM' },
      { id: 'emar_21', source_row: 'emar:21', client: 'Kenny Marsh', medication: 'B', status: 'Pass', date: '2025-03-09 15:32',
        schedule: '2025-03-09 15:32', src_prn: 'PRN', src_prn_pass_time: '03/09/2025, 15:32:00' },
      { id: 'emar_22', source_row: 'emar:22', client: 'Kenny Marsh', medication: 'C', status: 'Pass', date: '2025-09-20 08:00',
        schedule: '20/09/2025, 08:05:00' },
      { id: 'emar_23', source_row: 'emar:23', client: 'Kenny Marsh', medication: 'D', status: 'Pass', date: '12:00:00 AM',
        schedule: '29/09/2025, 18:14:21' },
      { id: 'emar_24', source_row: 'emar:24', client: 'Kenny Marsh', medication: 'E', status: 'Pass', date: '2025-10-02',
        schedule: '2025-10-02 09:15' },
      { id: 'emar_25', source_row: 'emar:25', client: 'Kenny Marsh', medication: 'F', status: 'Pass', date: '2025-10-05 07:00',
        schedule: '2025-11-04 07:00' },
      { id: 'emar_26', source_row: 'emar:26', client: 'Kenny Marsh', medication: 'G', status: 'Pass', date: '12:00:00 AM',
        src_prn_pass_time: '06/10/2025, 10:00:00' }
    ];
    var pt = HUB_ACTIONS.clientSourceMar({ client: 'kmarsh' }, master).data.tabs.passes;
    var at = {};
    (pt.rows || []).forEach(function (r) { at[r.id] = r; });
    stAssert_(out, P + 'passes: a date-time in the pass-time column is never "Due": it is read against the settled day ' +
                   'and drawn only when it says more (a swapped ISO copy and a matching dd/mm stamp say nothing new); a ' +
                   'clock stays "Due"; one that reads two ways and fits neither is shown as written and says so',
              at.emar_20.schedule === '8:00 AM' && /Due 8:00 AM/.test(at.emar_20.details) &&
              at.emar_21.date === '2025-09-03' && at.emar_21.date_fixed === true && at.emar_21.schedule === '' &&
              at.emar_21.pass_time === '' && at.emar_21.prn_time === '' && !/Due|2025-03-09/.test(at.emar_21.details) &&
              at.emar_22.schedule === '' && at.emar_22.pass_time === 'Sep 20, 2025 · 8:05 AM' &&
              /Pass time Sep 20, 2025 · 8:05 AM/.test(at.emar_22.details) &&
              at.emar_24.time === '09:15' && at.emar_24.pass_time === '' &&
              at.emar_25.date === '2025-10-05' && at.emar_25.pass_time === '"2025-11-04 07:00" as written — it reads two ways',
              JSON.stringify(pt.rows).slice(0, 600));
    stAssert_(out, P + 'passes: a date cell with only a time takes its day and clock from the pass-time column (or the PRN ' +
                   'one), flagged and counted; no pass is left without a day',
              at.emar_23.date === '2025-09-29' && at.emar_23.time === '18:14' && at.emar_23.date_from === 'pass time' &&
              at.emar_23.pass_time === '' && at.emar_23.date_as_written === '12:00:00 AM' &&
              at.emar_26.date === '2025-10-06' && at.emar_26.date_from === 'PRN pass time' && at.emar_26.prn_time === '' &&
              pt.kpis.days_from_pass_time === 2 && pt.kpis.no_day === 0 && pt.as_of === '2025-10-06',
              JSON.stringify([at.emar_23, at.emar_26, pt.kpis]).slice(0, 600));
    passes = passes0;

    // ---- the document door ----
    var served = [];
    locationsDocBytes_ = function (id) {
      served.push(id);
      return { name: id + '.pdf', mime: 'application/pdf', size: 4, exported: false, b64: 'JVBERg==' };
    };
    csmDriveText_ = function (id) { return id === 'textAug000001' ? 'THE WHOLE OCR TEXT' : ''; };
    var foreign = HUB_ACTIONS.clientSourceMarDocFile({ client: 'kmarsh', file_id: 'fileLia000001' }, master);
    var notMar = HUB_ACTIONS.clientSourceMarDocFile({ client: 'kmarsh', file_id: 'fileIsp000001' }, master);
    var badId = HUB_ACTIONS.clientSourceMarDocFile({ client: 'kmarsh', file_id: '../x' }, master);
    var badPart = HUB_ACTIONS.clientSourceMarDocFile({ client: 'kmarsh', file_id: 'fileAug000001', part: 'raw' }, master);
    stAssert_(out, P + 'the document door refuses another client\'s paper, a non-MARS file, a malformed id and an unknown ' +
                   'part — each before Drive is touched',
              foreign.status === 404 && notMar.status === 404 && badId.status === 400 && badPart.status === 400 &&
              served.length === 0, JSON.stringify([foreign, notMar, badId, badPart]));
    var doc = HUB_ACTIONS.clientSourceMarDocFile({ client: 'kmarsh', file_id: 'fileAug000001' }, master);
    var txt = HUB_ACTIONS.clientSourceMarDocFile({ client: 'kmarsh', file_id: 'fileAug000001', part: 'text' }, master);
    var noTxt = HUB_ACTIONS.clientSourceMarDocFile({ client: 'kmarsh', file_id: 'fileOld000001', part: 'text' }, master);
    stAssert_(out, P + 'the document door serves the client\'s own paper as bytes with its OCR digest, and the whole OCR ' +
                   'text on asking; a paper with no text file says so',
              doc.status === 200 && doc.data.b64 === 'JVBERg==' && doc.data.mime === 'application/pdf' &&
              doc.data.digest.text === 'KENNY AUGUST DIGEST' && doc.data.digest.has_text === true &&
              served.join() === 'fileAug000001' && txt.status === 200 && txt.data.text === 'THE WHOLE OCR TEXT' &&
              txt.data.truncated === false && noTxt.status === 404,
              JSON.stringify([doc.status, doc.data && doc.data.digest, txt, noTxt]));

    // ---- the import scan ----
    csmClientsRoot_ = function () {
      return stCsmFolder_({ name: 'Clients', folders: [
        { name: 'Kenny Marsh', files: [{ id: 'newSep0000001', name: 'MARS_2026 September_Kenny Marsh.pdf' },
                                        { id: 'notes00000001', name: 'House notes.pdf' }],
          folders: [{ name: 'MARS', files: [{ id: 'fileAug000001', name: 'MARS_2026 August_Kenny Marsh.pdf' },
                                            { id: 'newOct0000001', name: 'MARS_2026 October_Kenny Marsh.pdf' }] },
                    { name: 'Med Documents', folders: [{ name: 'MARS', files: [{ id: 'newMed0000001', name: 'Physician order.pdf' }] }] }] },
        { name: 'Lia Gomez', folders: [{ name: 'MARS', files: [{ id: 'fileLia000001', name: 'MARS Lia.pdf' }] }] },
        { name: '0 - Client Inactive', folders: [{ name: 'Old Person', folders: [{ name: 'MARS', files: [{ id: 'oldP000000001', name: 'MARS-2022 May.pdf' }] }] }] },
        { name: 'Templates', folders: [{ name: 'MARS', files: [{ id: 'tmpl000000001', name: 'Blank MAR.docx' }] }] }
      ] });
    };
    var all = HUB_ACTIONS.clientSourceMarImportScan({}, master);
    var one = HUB_ACTIONS.clientSourceMarImportScan({ client: 'kmarsh' }, master);
    var ids = function (r) { return ((r.data && r.data.missing) || []).map(function (m) { return m.drive_id; }).sort().join(); };
    var sep = ((one.data && one.data.missing) || []).filter(function (m) { return m.drive_id === 'newSep0000001'; })[0] || {};
    stAssert_(out, P + 'the scan lists the MARS drawer\'s files and the MAR-named root files that client_files does not ' +
                   'hold, per client folder (inactive ones included, templates skipped), and writes nothing',
              all.status === 200 && all.data.dry_run === true && ids(all) === 'newMed0000001,newOct0000001,newSep0000001,oldP000000001' &&
              all.data.indexed === 2 && all.data.folders === 3 && all.data.unmatched_folders.join() === 'Old Person' &&
              one.status === 200 && ids(one) === 'newMed0000001,newOct0000001,newSep0000001' && one.data.folders === 1 &&
              sep.client_key === 'kmarsh' && sep.file_date === '2026-09-01' && sep.named_mar === true &&
              writes === 0, JSON.stringify([all.data, one.data]).slice(0, 600));
    csmClientsRoot_ = function () { throw new Error('st: the drive is closed'); };
    var closed = HUB_ACTIONS.clientSourceMarImportScan({}, master);
    failing.clientFiles = true;
    var blind = HUB_ACTIONS.clientSourceMarImportScan({}, master);
    failing.clientFiles = false;
    stAssert_(out, P + 'the scan says why when the drive or the index cannot be read — never an empty "nothing missing"',
              closed.status === 503 && /Clients drive could not be read/.test(closed.message) &&
              blind.status === 503 && /nothing can be called new/.test(blind.message),
              JSON.stringify([closed, blind]));
    stAssert_(out, P + 'no door wrote a log line (a line would carry a name)', logged === 0, 'logged ' + logged);
  } finally {
    clientsDerived_ = keep.derived;
    listRows_ = keep.list;
    locationsDocBytes_ = keep.bytes;
    csmClientsRoot_ = keep.root;
    csmDriveText_ = keep.text;
    HUB_MASTER_EMAIL_CACHE = keep.masterCache;
    HUB_MEMBER_CTX = keep.member;
    cacheRead_ = keep.cacheRead;
    cacheVersion_ = keep.cacheVersion;
    cacheBump_ = keep.cacheBump;
    cacheScope_ = keep.cacheScope;
    hubSysLog_ = keep.log;
    createRow_ = keep.create;
    updateRowById_ = keep.update;
    hubProfileAppRules_ = keep.rules;
    HUB_VIEWER_MEMO = null;
    cfxUndo();
  }
}
