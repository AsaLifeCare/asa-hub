/** An in-memory tab: getDataRange, getRange(row, col, rows, cols), appendRow, the header helpers' calls. */
function stLocSheet_(grid) {
  var cell = function (r, c) { var row = grid[r]; return row && row[c] !== undefined ? row[c] : ''; };
  return {
    grid: grid,
    getLastColumn: function () { return grid.length ? grid[0].length : 0; },
    getLastRow: function () { return grid.length; },
    getDataRange: function () {
      return { getValues: function () {
        var w = grid.length ? grid[0].length : 0;
        return grid.map(function (row) { var out = []; for (var c = 0; c < w; c++) out.push(row[c] === undefined ? '' : row[c]); return out; });
      } };
    },
    getRange: function (r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      var put = function (vals) {
        for (var i = 0; i < nr; i++) {
          while (grid.length < r + i) grid.push([]);
          for (var j = 0; j < nc; j++) grid[r - 1 + i][c - 1 + j] = vals[i][j];
        }
      };
      return {
        getValues: function () {
          var out = [];
          for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) row.push(cell(r - 1 + i, c - 1 + j)); out.push(row); }
          return out;
        },
        setValues: put,
        setValue: function (v) { put([[v]]); }
      };
    },
    appendRow: function (line) { grid.push(line.slice()); }
  };
}

// Locations: the App Control gate and the viewer's cut on every read, the master-only writes, the staff merge, the…
function stLocations_(out) {
  var P = 'locations: ';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;

  // ---- declarations ----
  var READS = ['locationScope', 'locationOverview', 'locationStaff', 'locationRepairs', 'locationIncidents',
               'locationDocuments', 'locationSupplies', 'locationNotes'];
  var OPEN_ROLES = '["admin","director","manager","staff","client","onboarding","interviewer"]';
  var TOOLS = ['locationIstFile', 'locationDocFile', 'locationDocRemove', 'locationDocLink', 'locationDocUpload'];
  var bad = [];
  LOCATION_ACTIONS.forEach(function (a) {
    var p = HUB_POLICY[a];
    if (!p || p.file !== 'Locations.gs' || typeof HUB_ACTIONS[a] !== 'function') { bad.push(a + ': undeclared'); return; }
    if (RESOLVER_LANES.indexOf(p.lane) === -1 || RESOLVER_STORES.indexOf(p.store) === -1) bad.push(a + ': lane/store');
    var roles = READS.indexOf(a) !== -1 || a === 'locationDocFile' ? OPEN_ROLES : '["admin","manager","staff"]';
    if (JSON.stringify(p.roles) !== roles) bad.push(a + ': roles ' + JSON.stringify(p.roles));
    if ((p.invalidates || []).length || (p.emits || []).length) bad.push(a + ': invalidates/emits');
    var params = p.params || {};
    Object.keys(params).forEach(function (k) { if (params[k] && params[k].required) bad.push(a + ': ' + k + ' required at the door'); });
    var want = READS.indexOf(a) !== -1 ? 'read' : (TOOLS.indexOf(a) !== -1 ? 'tool' : 'write');
    if (p.lane !== want) bad.push(a + ': lane ' + p.lane + ', wanted ' + want);
    if (want === 'read' && p.idempotent !== true) bad.push(a + ': a read not idempotent');
  });
  stAssert_(out, P + 'every action is declared in Locations.gs — the reads for every role App Control may release them ' +
                 'to, the writes for the employees an edition may name (the door decides) — on its lane, invalidating ' +
                 'no slice, emitting nothing, and requiring no param before the gate',
            bad.length === 0 && LOCATION_ACTIONS.length === 27, bad.join('; '));

  // ---- the gate ----
  var keep = {
    house: locationsHouse_, masterCache: HUB_MASTER_EMAIL_CACHE, member: HUB_MEMBER_CTX, log: hubSysLog_,
    ensure: hubTabEnsure_, sheet: hubTabSheet_, moved: houseMoved_, holds: sheetDbGateHolds_, estate: estateRows_,
    homes: locationsHomes_, clientRows: locationsClientRows_, derived: clientsDerived_, istRows: locationsIstRows_,
    homeId: hubTabHomeId_, rules: hubProfileAppRules_, viewerMemo: HUB_VIEWER_MEMO
  };
  var master = { email: HUB_MASTER_ACCOUNT, role: 'admin' };
  var RULES = { rules: {}, tenants: {} };
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    HUB_MEMBER_CTX = null;
    HUB_VIEWER_MEMO = null;
    hubProfileAppRules_ = function () { return RULES; };
    var asked = 0;
    locationsHouse_ = function () { asked++; return { refused: { status: 418, message: 'st: the house was asked' } }; };
    var callers = [
      { email: 'admin@example.org', role: 'admin' },
      { email: 'mgr@example.org', role: 'manager' },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', is_service: true },
      { email: HUB_MASTER_ACCOUNT, role: 'manager' },
      null
    ];
    var leaks = [];
    var shape = function (r) { return !!r && r.status === 404 && r.message === 'Unknown action.' && Object.keys(r).length === 2; };
    LOCATION_ACTIONS.forEach(function (a) {
      callers.forEach(function (u) {
        var r = HUB_ACTIONS[a]({ house: 'ZZ9999', id: 'HN_1', state: 'open' }, u);
        if (!shape(r)) leaks.push(a + ' ' + JSON.stringify(u) + ' → ' + JSON.stringify(r));
      });
      HUB_MEMBER_CTX = { memberId: 'mem_st', userId: 'u-st', email: 'ann@example.org' };
      var inVisit = HUB_ACTIONS[a]({ house: 'ZZ9999', id: 'HN_1', state: 'open' }, master);
      HUB_MEMBER_CTX = null;
      if (!shape(inVisit)) leaks.push(a + ' in a visit → ' + JSON.stringify(inVisit));
    });
    stAssert_(out, P + 'with no App Control row, a non-master, a manager, a visit, the service identity and no session ' +
                   'all get the docRoom 404 shape, before the house is looked up', leaks.length === 0 && asked === 0,
              leaks.slice(0, 4).join(' | ') + ' asked=' + asked);
    var passed = LOCATION_ACTIONS.filter(function (a) { return a !== 'locationNoteState' && a !== 'locationScope'; })
      .map(function (a) { return HUB_ACTIONS[a]({ house: 'ZZ9999' }, master).status; });
    var masterScope = HUB_ACTIONS.locationScope({}, master);
    stAssert_(out, P + 'the master in its own session passes the gate to the house lookup, and is told its writes and ' +
                   'every edition',
              passed.every(function (s) { return s === 418; }) && masterScope.status === 200 &&
              masterScope.data.kind === 'master' && masterScope.data.writes === true && masterScope.data.cut === false &&
              masterScope.data.editions.length === 7 && masterScope.data.houses === null, JSON.stringify([passed, masterScope]));

    // App Control's row decides, through the real gate: STAFF only where the row names it, then on everything
    var staffer = { id: 'u-st9', email: 'st9@asa.test', role: 'staff', types: ['STAFF'], display_name: 'St9 Staff' };
    var WRITES = ['locationNoteAdd', 'locationNoteState', 'locationSupplyEntry', 'locationIstFile', 'locationHouseSave',
                  'locationNoteEdit', 'locationSupplyEdit', 'locationStaffRemove', 'locationIncidentFile',
                  'locationIncidentEdit', 'locationRepairFile', 'locationRepairEdit', 'locationDocRemove',
                  'locationDocLink', 'locationDocUpload', 'locationClientsAdd', 'locationAssetEdit', 'locationAssetAdd'];
    var ask = { house: 'ZZ9999', id: 'HN_1234567890', state: 'open' };
    asked = 0;
    RULES = { rules: { 'client-profiles': ['STAFF'], locations: ['CLIENT', 'GUARDIAN'] }, tenants: {} };
    HUB_VIEWER_MEMO = null;
    var shutToStaff = LOCATION_ACTIONS.filter(function (a) { return !shape(HUB_ACTIONS[a](ask, staffer)); });
    stAssert_(out, P + 'STAFF on a Locations row that does not name it (another app released to it) gets the 404 ' +
                   'shape on every action, before the house is looked up',
              shutToStaff.length === 0 && asked === 0, shutToStaff.join() + ' asked=' + asked);
    RULES = { rules: { locations: ['STAFF', 'CLIENT'] }, tenants: {} };
    HUB_VIEWER_MEMO = null;
    var staffReads = LOCATION_ACTIONS.filter(function (a) { return WRITES.indexOf(a) === -1 && a !== 'locationScope'; })
      .map(function (a) { return a + ':' + HUB_ACTIONS[a](ask, staffer).status; });
    var staffScope = HUB_ACTIONS.locationScope({}, staffer);
    var staffWrites = WRITES.filter(function (a) { return !shape(HUB_ACTIONS[a](ask, staffer)); });
    stAssert_(out, P + 'STAFF on a row that names it reads every section of every house (the house lookup is reached), ' +
                   'is told it sees everything and no write or edition is its, and every write still answers 404',
              staffReads.every(function (s) { return /:418$/.test(s); }) && staffReads.length === 8 &&
              staffScope.status === 200 && staffScope.data.kind === 'all' && staffScope.data.writes === false &&
              JSON.stringify(staffScope.data.editions) === '[]' &&
              staffScope.data.cut === false && staffScope.data.houses === null && staffWrites.length === 0,
              JSON.stringify([staffReads, staffScope, staffWrites]));
    RULES = { rules: {}, tenants: {} };
    HUB_VIEWER_MEMO = null;
    locationsHouse_ = keep.house;

    // ---- the house and its clients ----
    locationsHomes_ = function () {
      return [{ code: 'ZZ9999', address: '9999 Test Ave NW, Apt B, Canton, OH', home_name: 'ZZ - ZZ9999' }];
    };
    locationsClientRows_ = function () {
      return [{ client_key: 'kmarsh', name: 'Kenny Marsh', house: 'ZZ9999', home_address: '', status: 'active' },
              { client_key: 'noh', name: 'No House', house: '', home_address: '9999 Test Ave NW Apt B, Canton', status: '' },
              { client_key: 'other', name: 'Other Unit', house: '', home_address: '9999 Test Ave NW, Apt A', status: 'active' },
              { client_key: 'gone', name: 'Gone Client', house: 'ZZ9999', home_address: '', status: 'inactive' },
              { client_key: 'far', name: 'Far Away', house: 'QQ1000', home_address: '', status: 'active' }];
    };
    var ctx = locationsHouse_('zz9999');
    var nf = locationsHouse_('QQ1111');
    var carried = locationsHouse_('QQ1000');
    var bad400 = locationsHouse_('House 12');
    stAssert_(out, P + 'a house resolves by code: its code on a client, else the registry street AND unit; ' +
                   'an inactive client and another unit stay out; unknown is 404, malformed 400',
              ctx.code === 'ZZ9999' && ctx.clients.map(function (c) { return c.client_key; }).sort().join() === 'kmarsh,noh' &&
              nf.refused && nf.refused.status === 404 && carried.code === 'QQ1000' && !carried.home &&
              bad400.refused && bad400.refused.status === 400,
              JSON.stringify([ctx.clients, nf, bad400]));
    locationsHomes_ = function () { throw new Error('st: registry closed'); };
    var closed = locationsHouse_('QQ1111');
    stAssert_(out, P + 'an unreadable registry is 503, never "no such house"',
              closed.refused && closed.refused.status === 503, JSON.stringify(closed));
    locationsHomes_ = keep.homes;
    locationsClientRows_ = keep.clientRows;

    clientsDerived_ = function () {
      return [{ client_key: 'k1', name: 'Kay One', house: 'ZZ9999', home_address: '1 A St', status: 'active', isp_year: '2026',
                medications: ['secret pill'], conditions: 'x', diagnoses_text: 'y', guardian_phone: '555', allergies_text: 'z' },
              { name: 'Lia  Gomez', house: 'ZZ9999', home_address: '', status: 'active' }];
    };
    var narrowed = locationsClientRows_();
    stAssert_(out, P + 'the clients are narrowed to identity — no medication, condition or contact field survives; ' +
                   'a client with no client_key keys by its folded name, so a note can name it',
              Object.keys(narrowed[0]).sort().join() === 'client_key,home_address,house,isp_year,name,status' &&
              JSON.stringify(narrowed).indexOf('secret') === -1 && narrowed[1].client_key === 'liagomez',
              JSON.stringify(narrowed));
    clientsDerived_ = keep.derived;

    // ---- the staff merge ----
    var cal = { tz: 'America/New_York', values: [
      ['Location', 'Employee', 'Designation', 'Phone', 'Date', 'Start Time', 'End Time'],
      ['CAN - 49TH - ABD1305', 'Ann Lee', '*', '', '01/06/2025', '', ''],
      ['CAN - 49TH - ABD1305', 'ann   lee', '*', '', '03/10/2025', '', ''],
      ['CAN - 49TH - ABD1305', 'OPEN', '', '', '03/10/2025', '', ''],
      ['CAN - 48TH (A) - ABD1547', 'Bob Other', '*', '', '03/10/2025', '', ''],
      ['CAN - 49TH - ABD1305', 'Cara Lead', '***', '', '09/20/2026', '', ''],
      ['CAN - 49TH - ABD1305', 'Ann Lee', '*', '', '12/30/2026', '', '']
    ] };
    var psi = [
      { employee: 'Ann Lee', house: 'ABD1305', location_name: '1305 49th St NW', date_iso: '2026-09-20',
        consumer_1: 'Client Secret', consumers: 'Client Secret', comments: 'private words' },
      { employee: 'Dee Punch', house: '', location_name: '1305  49th St NW', date_iso: '2026-09-21', consumer_1: 'Client Secret' },
      { employee: 'Eve Else', house: 'ABD1547', location_name: '1547 48th St NW', date_iso: '2026-09-21' }
    ];
    var merged = locationsStaffMerge_('ABD1305', cal, psi, '2026-09-22', { annlee: true });
    var by = {};
    merged.staff.forEach(function (p) { by[p.key] = p; });
    var ann = by.annlee || {};
    stAssert_(out, P + 'staff: one row per folded name, first from the Calendar Archive and latest from the punches, ' +
                   'each date labelled, a future day and another house left out',
              Object.keys(by).sort().join() === 'annlee,caralead,deepunch' && ann.name === 'Ann Lee' &&
              ann.first_day === '2025-01-06' && ann.first_source === 'archive' &&
              ann.last_day === '2026-09-20' && ann.last_source === 'punches' && ann.shifts === 3 &&
              ann.sources.join() === 'archive,punches' && ann.hm === true && by.caralead.lead === true &&
              by.caralead.hm === false && by.deepunch.sources.join() === 'punches',
              JSON.stringify(merged.staff));
    var staffText = JSON.stringify(merged);
    stAssert_(out, P + 'staff: no consumer_* field, comment or client name from a punch reaches the answer',
              staffText.indexOf('consumer') === -1 && staffText.indexOf('Client Secret') === -1 &&
              staffText.indexOf('private words') === -1 && staffText.indexOf('comments') === -1, staffText);
    var istIdx = locationsIstIndex_([
      { id: 'i1', staffName: 'Ann  Lee', clientName: 'Kenny Marsh', house: 'ABD1305', status: 'done', trainedAt: '2026-01-02',
        docUrl: 'https://drive.google.com/file/d/abc/view', docFileId: 'abcdefghijk' },
      { id: 'i2', staffName: 'Ann Lee', clientName: 'Kenny Marsh', house: 'ABD1547', status: 'owed' }
    ], 'ABD1305', [{ client_key: 'kmarsh', name: 'Kenny Marsh' }, { client_key: 'ttwo', name: 'Tee Two' }]);
    var cellA = locationsIstCell_((istIdx.annlee || {}).kmarsh, { client_key: 'kmarsh', name: 'Kenny Marsh' });
    var cellB = locationsIstCell_((istIdx.annlee || {}).ttwo, { client_key: 'ttwo', name: 'Tee Two' });
    stAssert_(out, P + 'staff: an IST cell is the row at this house for the pair, with its paper; no row is status null',
              cellA.id === 'i1' && cellA.status === 'done' && cellA.docFileId === 'abcdefghijk' &&
              cellB.status === null && cellB.id === '' && cellB.client === 'Tee Two', JSON.stringify([cellA, cellB]));

    // ---- the repairs join ----
    var homes = [
      { code: 'ZE4048', address: '4048 Orchard Dale Dr NW, Apt A, Canton, OH 44709' },
      { code: 'ZAB2704', address: '2704 Harrison Ave NW, Canton, OH 44709' },
      { code: 'ZB4060', address: '4060 Orchard Dale Dr NW, Apt B, Canton, OH 44709' },
      { code: 'ZM4060', address: '4060 Orchard Dale Dr NW, Apt A, Canton, OH 44709' }
    ];
    var index = locationsAddrIndex_(homes, [{ house: 'ZL4048', home_address: '4048 Orchard Dale Dr NW Apt B, Canton, OH' }]);
    var repairRows = [
      { id: 'r2', select_address_vehicle: '4048 Orchard Dale Dr NW, Apt A, Canton, OH 44709', status: '', timestamp: '2026-09-01T10:00:00Z' },
      { id: 'r3', select_address_vehicle: '4048 Orchard Dale Apt B', status: '', timestamp: '2026-09-02T10:00:00Z' },
      { id: 'r4', select_address_vehicle: '4048 Orchard Dale (request maintenance)', status: '', timestamp: '2026-09-03T10:00:00Z' },
      { id: 'r5', select_address_vehicle: 'ALL', status: 'Completed', timestamp: '2026-08-01T10:00:00Z' },
      { id: 'r6', select_address_vehicle: '4048 Orchard Dale Apt A', status: 'Cancelled', timestamp: '2026-08-02T10:00:00Z' },
      { id: 'r7', select_address_vehicle: '2704 Harrison (request maintenance)', status: 'In Progress', timestamp: '2026-09-04T10:00:00Z' },
      { id: 'r8', select_address_vehicle: '4060 Orchard Dale', status: '', timestamp: '2026-09-05T10:00:00Z' }
    ];
    var ec = locationsRepairsFor_(repairRows, 'ZE4048', index);
    var ecBy = {};
    ec.forEach(function (r) { ecBy[r.id] = r; });
    var abd = locationsRepairsFor_(repairRows, 'ZAB2704', index).map(function (r) { return r.id + ':' + r.match; });
    var bm = locationsRepairsFor_(repairRows, 'ZB4060', index).map(function (r) { return r.id; });
    stAssert_(out, P + 'repairs: the exact street and unit, the unique street-number fallback, and ALL in every house; ' +
                   'another unit and a shared number stay out',
              ec.map(function (r) { return r.id; }).join() === 'r2,r6,r5' && ecBy.r2.match === 'exact' &&
              ecBy.r6.match === 'street_number' && ecBy.r5.whole_estate === true && ecBy.r5.match === 'all' &&
              abd.join() === 'r7:street_number,r5:all' && bm.join() === 'r5',
              JSON.stringify([ec.map(function (r) { return r.id + ':' + r.match; }), abd, bm]));
    stAssert_(out, P + 'repairs: Completed and Cancelled are resolved, everything else open',
              ecBy.r2.resolved === false && ecBy.r5.resolved === true && ecBy.r6.resolved === true &&
              locationsRepairsFor_(repairRows, 'ZAB2704', index)[0].resolved === false, JSON.stringify(ec));

    locationsHouse_ = function () {
      return { code: 'ZE4048', home: homes[0], homes: homes, clients: [],
               all_clients: [{ house: 'ZL4048', home_address: '4048 Orchard Dale Dr NW Apt B, Canton, OH' }] };
    };
    estateRows_ = function (res) { return res === 'workOrders' ? repairRows : []; };
    cacheBump_('loc_locationRepairs_ZE4048');
    var openOnly = HUB_ACTIONS.locationRepairs({ house: 'ZE4048' }, master);
    var withAll = HUB_ACTIONS.locationRepairs({ house: 'ZE4048', resolved: 'true' }, master);
    stAssert_(out, P + 'repairs: the list is the open ones; Show resolved adds the Completed and Cancelled',
              openOnly.status === 200 && openOnly.data.rows.map(function (r) { return r.id; }).join() === 'r2' &&
              openOnly.data.open_count === 1 && openOnly.data.resolved_count === 2 &&
              withAll.data.rows.length === 3 && withAll.data.resolved === true,
              JSON.stringify([openOnly, withAll && withAll.data && withAll.data.rows.length]));
    locationsHouse_ = keep.house;
    estateRows_ = keep.estate;

    // ---- the incidents join ----
    var inc = locationsIncidentsFor_([
      { id: 'r2', client_name: 'Kenny  Marsh', your_name: 'A B', incident_location: 'House',
        incident_category: 'Minor injury or illness (rash, bruise, small cut), Fall', incident_date: '2026-09-01T04:00:00.000Z',
        incident_time: '10:30', summary_of_incident: 'what happened', comments: 'not a column' },
      { id: 'r3', client_name: 'Other Person', incident_category: 'Fall', incident_date: '2026-09-09T04:00:00.000Z' },
      { id: 'r4', client_name: 'kenny marsh', incident_category: '["Fall"]', incident_date: '2026-09-05T04:00:00.000Z' }
    ], [{ client_key: 'kmarsh', name: 'Kenny Marsh' }]);
    stAssert_(out, P + 'incidents: joined through clientNameKey_ to the current clients, newest first, the category ' +
                   'split paren-aware, the full row whitelisted',
              inc.map(function (r) { return r.id; }).join() === 'r4,r2' && inc[1].client_key === 'kmarsh' &&
              inc[1].categories.length === 2 && inc[1].categories[0].indexOf('rash, bruise, small cut') !== -1 &&
              inc[0].categories.join() === 'Fall' && inc[1].row.summary_of_incident === 'what happened' &&
              !('comments' in inc[1].row) && inc[1].incident_time === '10:30', JSON.stringify(inc));

    // ---- no delete anywhere ----
    var fns = Object.keys(g).filter(function (k) { return /^locations/.test(k) && typeof g[k] === 'function'; });
    var deleting = [], trashing = [];
    fns.map(function (k) { return [k, g[k]]; }).concat(LOCATION_ACTIONS.map(function (a) { return [a, HUB_ACTIONS[a]]; }))
      .forEach(function (pair) {
        var src = stCode_(pair[1]);
        if (/deleteRows?\(|deleteRowById_|deleteSheet|clearContents?\(|\.clear\(|['"]delete['"]|api\.delete/.test(src)) deleting.push(pair[0]);
        if (/setTrashed/.test(src)) trashing.push(pair[0]);
      });
    stAssert_(out, P + 'no Locations code path deletes a row, a tab or a record; the one trash is the Office preview\'s own copy',
              fns.length >= 20 && deleting.length === 0 && trashing.join() === 'locationsOfficePdf_',
              'functions=' + fns.length + ' deleting=' + deleting.join() + ' trashing=' + trashing.join());

    // ---- the consumption math ----
    var fig = function (entries, par) {
      var list = entries.slice();
      if (par !== undefined) list.push({ kind: 'par', qty: par, on_hand_after: null, at: '2026-09-01T00:00:00Z' });
      return locationsSupplyItem_(list, 7);
    };
    var a1 = fig([{ kind: 'delivery', qty: 40, on_hand_after: 50, at: '2026-09-10T12:00:00Z' },
                  { kind: 'count', qty: 30, on_hand_after: null, at: '2026-09-14T12:00:00Z' }], 20);
    var a2 = fig([{ kind: 'count', qty: 10, on_hand_after: null, at: '2026-09-09T12:00:00Z' },
                  { kind: 'delivery', qty: 40, on_hand_after: null, at: '2026-09-10T12:00:00Z' },
                  { kind: 'count', qty: 35, on_hand_after: null, at: '2026-09-15T12:00:00Z' }], 40);
    var a3 = fig([{ kind: 'delivery', qty: 40, on_hand_after: null, at: '2026-09-10T12:00:00Z' },
                  { kind: 'count', qty: 30, on_hand_after: null, at: '2026-09-12T12:00:00Z' }]);
    var a4 = fig([{ kind: 'count', qty: 0, on_hand_after: null, at: '2026-09-12T12:00:00Z' }], 5);
    var a5 = fig([{ kind: 'delivery', qty: 12, on_hand_after: 12, at: '2026-09-12T12:00:00Z' }], 6);
    var a6 = fig([{ kind: 'delivery', qty: 90, on_hand_after: 100, at: '2026-09-10T12:00:00Z' },
                  { kind: 'count', qty: 90, on_hand_after: null, at: '2026-09-15T12:00:00Z' }], 50);
    stAssert_(out, P + 'supplies: the baseline is on_hand_after when given — consumption 20 over 4 days, 6 days of cover, Order now',
              a1.consumption === 20 && a1.rate_per_day === 5 && a1.days_of_cover === 6 && a1.status === 'order_now' &&
              a1.in_stock === 30 && a1.checked === '2026-09-14T12:00:00Z' && a1.measured === true, JSON.stringify(a1));
    stAssert_(out, P + 'supplies: otherwise the count before the delivery plus the delivery — 15 used, below par is Low',
              a2.consumption === 15 && a2.rate_per_day === 3 && a2.days_of_cover === 11.7 && a2.status === 'low', JSON.stringify(a2));
    stAssert_(out, P + 'supplies: no baseline, or no count after the delivery, is null — never 0',
              a3.consumption === null && a3.measured === false && a3.in_stock === 30 &&
              a5.consumption === null && a5.in_stock === 12 && a5.checked === '2026-09-12T12:00:00Z', JSON.stringify([a3, a5]));
    stAssert_(out, P + 'supplies: nothing on hand is Order now; at or above par with a week of cover is In stock',
              a4.status === 'order_now' && a6.status === 'in_stock' && a6.days_of_cover === 45, JSON.stringify([a4, a6]));
    var grouped = locationsSupplies_([
      { house: 'ZZ9999', item: 'Gloves (M)', kind: 'count', qty: '5', category: 'Care supplies', at: '2026-09-12T00:00:00Z' },
      { house: 'ZZ9999', item: 'gloves  (m)', kind: 'par', qty: 10, category: '', at: '2026-09-01T00:00:00Z' },
      { house: 'ZZ9999', item: 'Soap', kind: '', qty: 3, at: '2026-09-12T00:00:00Z' },
      { house: 'ZZ9999', item: 'Soap', kind: 'count', qty: 'lots', at: '2026-09-12T00:00:00Z' },
      { house: 'QQ1000', item: 'Gloves (M)', kind: 'count', qty: 99, at: '2026-09-13T00:00:00Z' }
    ], 'ZZ9999', 7);
    stAssert_(out, P + 'supplies: one line per folded item at this house; a request row or a word for a quantity is not a count',
              grouped.length === 1 && grouped[0].in_stock === 5 && grouped[0].par === 10 && grouped[0].status === 'low' &&
              grouped[0].category === 'Care supplies', JSON.stringify(grouped));

    // ---- the notes door ----
    var notesSheet = stLocSheet_([]);
    var ensured = [];
    var logged = [];
    hubTabEnsure_ = function (tab, header) {
      ensured.push(tab);
      if (tab !== LOCATION_NOTES_TAB) throw new Error('st: no other tab');
      if (!notesSheet.grid.length) notesSheet.grid.push(header.slice());
      return notesSheet;
    };
    hubTabSheet_ = function (tab) { return tab === LOCATION_NOTES_TAB && notesSheet.grid.length ? notesSheet : null; };
    sheetDbGateHolds_ = function () { return null; };
    hubSysLog_ = function (who, kind, target) { logged.push(kind + ':' + target); return true; };
    var zz = { code: 'ZZ9999', home: null, homes: [], all_clients: [{ client_key: 'kmarsh', name: 'Kenny Marsh' }],
               clients: [{ client_key: 'kmarsh', name: 'Kenny Marsh' }] };
    locationsHouse_ = function () { return zz; };
    cacheBump_('loc_locationNotes_ZZ9999');
    var before = HUB_ACTIONS.locationNotes({ house: 'ZZ9999' }, master);
    var refusals = [
      HUB_ACTIONS.locationNoteAdd({ house: 'ZZ9999', details: '' }, master),
      HUB_ACTIONS.locationNoteAdd({ house: 'ZZ9999', details: 'x', priority: 'panic' }, master),
      HUB_ACTIONS.locationNoteAdd({ house: 'ZZ9999', details: 'x', client_key: 'someone-else' }, master)
    ].map(function (r) { return r.status; });
    stAssert_(out, P + 'notes: nothing is created by a read or by a refused write — empty details, an unknown priority ' +
                   'and a client of another house are 400',
              before.status === 200 && before.data.exists === false && before.data.notes.length === 0 &&
              refusals.join() === '400,400,400' && ensured.length === 0 && notesSheet.grid.length === 0,
              JSON.stringify([before, refusals, ensured]));
    var added = HUB_ACTIONS.locationNoteAdd({ house: 'ZZ9999', details: '=HYPERLINK("http://x")', priority: 'High',
                                               client_key: 'kmarsh', by: 'Mallory', state: 'resolved', id: 'forged',
                                               at: '1999-01-01' }, master);
    var head = notesSheet.grid[0] || [];
    var row = notesSheet.grid[1] || [];
    var col = function (h) { return row[head.indexOf(h)]; };
    stAssert_(out, P + 'notes: the first write makes the tab through hubTabEnsure_; the filer, the time, the id and ' +
                   'the state are the server\'s, never the payload\'s, and text is kept from being a formula',
              added.status === 200 && ensured.join() === LOCATION_NOTES_TAB && head.join() === LOCATION_NOTES_HEADER.join() &&
              notesSheet.grid.length === 2 && col('by') === HUB_MASTER_ACCOUNT && col('state') === 'open' &&
              /^HN_/.test(col('id')) && col('at') !== '1999-01-01' && col('priority') === 'high' &&
              col('client_key') === 'kmarsh' && col('details') === '\'=HYPERLINK("http://x")' &&
              added.data.note.client_name === 'Kenny Marsh', JSON.stringify([added, notesSheet.grid]));
    var nid = String(col('id'));
    var moved = HUB_ACTIONS.locationNoteState({ id: nid, state: 'resolved', house: 'QQ1000' }, master);
    var badState = HUB_ACTIONS.locationNoteState({ id: nid, state: 'deleted' }, master);
    var resolved = HUB_ACTIONS.locationNoteState({ id: nid, state: 'resolved', house: 'ZZ9999' }, master);
    stAssert_(out, P + 'notes: resolving checks the house witness, knows only open and resolved, and touches the ' +
                   'state cells alone',
              moved.status === 409 && badState.status === 400 && resolved.status === 200 && col('state') === 'resolved' &&
              col('state_by') === HUB_MASTER_ACCOUNT && col('details') === '\'=HYPERLINK("http://x")' &&
              notesSheet.grid.length === 2, JSON.stringify([moved, badState, resolved, row]));
    var after = HUB_ACTIONS.locationNotes({ house: 'ZZ9999' }, master);
    stAssert_(out, P + 'notes: the read retires with the write and names the client from its key',
              after.status === 200 && after.data.exists === true && after.data.notes.length === 1 &&
              after.data.notes[0].state === 'resolved' && after.data.notes[0].client_name === 'Kenny Marsh' &&
              after.data.open_count === 0, JSON.stringify(after));
    stAssert_(out, P + 'writes log the house code and nothing else',
              logged.join() === 'locationNoteAdd:ZZ9999,locationNoteState:ZZ9999', logged.join(' | '));
    // the relay's overlay names a new row before the sheet holds it: its minted id is the row's, written once
    var mintNote = 'HN_0b4c2a1e-5f6d-4e7a-9b8c-0d1e2f3a4b5c';
    var mintedNote = HUB_ACTIONS.locationNoteAdd({ house: 'ZZ9999', details: 'Counted', id: mintNote }, master);
    var mintedTwice = HUB_ACTIONS.locationNoteAdd({ house: 'ZZ9999', details: 'Counted', id: mintNote }, master);
    var mintedRows = notesSheet.grid.filter(function (r) { return r[head.indexOf('id')] === mintNote; }).length;
    stAssert_(out, P + 'notes: a relay-minted id names the new row, and the same id sent again writes nothing more',
              mintedNote.status === 200 && mintedNote.data.note.id === mintNote && mintedTwice.status === 200 &&
              mintedTwice.data.already === true && mintedRows === 1 && notesSheet.grid.length === 3,
              JSON.stringify([mintedNote, mintedTwice, notesSheet.grid.length]));

    // ---- the supplies door ----
    var ledger = stLocSheet_([['id', 'house', 'item', 'qty', 'needed_by', 'status']]);
    var declared = false;
    houseMoved_ = function (tab) { return declared && tab === LOCATION_SUPPLY_TAB; };
    hubTabEnsure_ = function (tab) { if (tab !== LOCATION_SUPPLY_TAB) throw new Error('st: no other tab'); return ledger; };
    hubTabSheet_ = function (tab) { return tab === LOCATION_SUPPLY_TAB ? ledger : null; };
    var undeclared = HUB_ACTIONS.locationSupplyEntry({ house: 'ZZ9999', item: 'Gloves', kind: 'count', qty: 3 }, master);
    declared = true;
    var supplyBad = [
      HUB_ACTIONS.locationSupplyEntry({ house: 'ZZ9999', item: 'Gloves', kind: 'steal', qty: 3 }, master),
      HUB_ACTIONS.locationSupplyEntry({ house: 'ZZ9999', item: 'Gloves', kind: 'count', qty: -1 }, master),
      HUB_ACTIONS.locationSupplyEntry({ house: 'ZZ9999', item: '', kind: 'count', qty: 1 }, master)
    ].map(function (r) { return r.status; });
    var delivered = HUB_ACTIONS.locationSupplyEntry({ house: 'ZZ9999', item: 'Gloves', kind: 'delivery', qty: '40',
                                                       on_hand_after: 50, category: 'Care supplies' }, master);
    var lh = ledger.grid[0];
    var lr = ledger.grid[1] || [];
    stAssert_(out, P + 'supplies: an undeclared ledger house refuses (503) and writes nowhere; a bad kind or quantity ' +
                   'is 400; a delivery adds the six columns and one row',
              undeclared.status === 503 && supplyBad.join() === '400,400,400' && delivered.status === 200 &&
              ledger.grid.length === 2 && lh.join() === LOCATION_SUPPLY_HEADER.join() &&
              lr[lh.indexOf('kind')] === 'delivery' && lr[lh.indexOf('qty')] === 40 &&
              lr[lh.indexOf('on_hand_after')] === 50 && lr[lh.indexOf('house')] === 'ZZ9999',
              JSON.stringify([undeclared, supplyBad, delivered, ledger.grid]));
    estateRows_ = function () { return []; };
    var supplies = HUB_ACTIONS.locationSupplies({ house: 'ZZ9999' }, master);
    stAssert_(out, P + 'supplies: the read computes from the ledger — a delivery with no count after is "not measured yet"',
              supplies.status === 200 && supplies.data.ledger_ready === true && supplies.data.consumables.length === 1 &&
              supplies.data.consumables[0].consumption === null && supplies.data.consumables[0].in_stock === 50 &&
              supplies.data.order_days === 7, JSON.stringify(supplies));
    var mintLine = 'LS_7d1f0c2b-3a4e-4b5c-8d6e-9f0a1b2c3d4e';
    var mintedLine = HUB_ACTIONS.locationSupplyEntry({ house: 'ZZ9999', item: 'Gloves', kind: 'count', qty: 30,
                                                        id: mintLine }, master);
    var mintedLineAgain = HUB_ACTIONS.locationSupplyEntry({ house: 'ZZ9999', item: 'Gloves', kind: 'count', qty: 30,
                                                             id: mintLine }, master);
    var forgedLine = HUB_ACTIONS.locationSupplyEntry({ house: 'ZZ9999', item: 'Gloves', kind: 'count', qty: 30,
                                                        id: 'LS_forged' }, master);
    stAssert_(out, P + 'supplies: a relay-minted id names the new line once; an id of any other shape is the server\'s',
              mintedLine.status === 200 && mintedLine.data.entry.id === mintLine && mintedLineAgain.data.already === true &&
              forgedLine.status === 200 && forgedLine.data.entry.id !== 'LS_forged' && ledger.grid.length === 4,
              JSON.stringify([mintedLine, mintedLineAgain, forgedLine, ledger.grid.length]));
    estateRows_ = keep.estate;

    // ---- the IST paper door ----
    locationsIstRows_ = function () { return []; };
    var ist = [
      HUB_ACTIONS.locationIstFile({ house: 'ZZ9999', staff: 'Ann Lee', client: 'Kenny Marsh',
                                    file: { filename: 'x.exe', mime: 'application/x-msdownload', base64: 'QUJD' } }, master),
      HUB_ACTIONS.locationIstFile({ house: 'ZZ9999', staff: 'Ann Lee', client: 'Nobody Here',
                                    file: { filename: 'x.pdf', mime: 'application/pdf', base64: 'QUJD' } }, master),
      HUB_ACTIONS.locationIstFile({ house: 'ZZ9999', staff: 'Ann Lee', client: 'Kenny Marsh',
                                    file: { filename: 'x.pdf', mime: 'application/pdf', base64: 'QUJD' } }, master)
    ];
    stAssert_(out, P + 'IST papers: the certificate door\'s types only, a current client only, and a pair with no IST ' +
                   'record at this house is 404 — each before Drive is touched',
              ist[0].status === 400 && ist[1].status === 400 && ist[2].status === 404,
              JSON.stringify(ist));

    // ---- the relay's pack ----
    var pol = HUB_POLICY.locationPack || {};
    stAssert_(out, P + 'pack: declared in Locations.gs as an idempotent read, a service read, and no section door',
              pol.file === 'Locations.gs' && pol.lane === 'read' && pol.idempotent === true &&
              JSON.stringify(pol.roles) === '["admin"]' && typeof HUB_ACTIONS.locationPack === 'function' &&
              SERVICE_READ_ACTIONS.indexOf('locationPack') !== -1 && LOCATION_ACTIONS.indexOf('locationPack') === -1 &&
              LOCATION_PACK_PARTS.join() === 'overview,staff,notes,supplies,guidebook,repairs,incidents,client_views',
              JSON.stringify(pol));
    var packKeep = { cal: commBroadcastCalendarRows_, full: psiPunchesFullSheet_, rows: psiPunchesRows_,
                     room: docRoomFolder_, policies: locationsPolicies_, isp: ispDocFor_ };
    try {
      var reads = { cal: 0, punches: 0 };
      commBroadcastCalendarRows_ = function () { reads.cal++; return cal; };
      psiPunchesFullSheet_ = function () { return {}; };
      psiPunchesRows_ = function () { reads.punches++; return { rows: psi }; };
      docRoomFolder_ = function () { return { folder: null, reason: 'st: no houses room' }; };
      locationsPolicies_ = function () {
        return [{ title: 'Company Policies', url: 'https://drive.google.com/file/d/policyxxxxx1/view', drive_id: 'policyxxxxx1' }];
      };
      ispDocFor_ = function () { return { id: '', name: '', url: '' }; };
      hubTabSheet_ = function () { return null; };
      estateRows_ = function (res) {
        if (res === 'workOrders') return [{ id: 'w1', select_address_vehicle: 'ALL', status: '', timestamp: '2026-09-01T10:00:00Z' }];
        if (res === 'uiIncidents') return [{ id: 'u1', client_name: 'Kenny Marsh', incident_category: 'Fall', incident_date: '2026-09-02' }];
        return [];
      };
      var bumpAll = function () {
        ['locationOverview', 'locationStaff', 'locationNotes', 'locationSupplies', 'locationDocuments', 'locationRepairs',
         'locationIncidents'].forEach(function (a) {
          cacheBump_('loc_' + a + '_ZZ9999');
        });
      };
      bumpAll();
      var shutOut = [master, { email: 'admin@example.org', role: 'admin' }, null,
                     { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' }].map(function (u) {
        var r = HUB_ACTIONS.locationPack({ house: 'ZZ9999' }, u);
        return r.status + ':' + r.message;
      });
      stAssert_(out, P + 'pack: every session — the master\'s own included — and no session get "Unknown action."',
                shutOut.join('|') === ['404:Unknown action.', '404:Unknown action.', '404:Unknown action.',
                                       '404:Unknown action.'].join('|'), shutOut.join(' | '));
      var pack = HUB_ACTIONS.locationPack({ house: 'ZZ9999' }, serviceUser_());
      var parts = (pack.data && pack.data.parts) || {};
      var st = (pack.data && pack.data.part_status) || {};
      stAssert_(out, P + 'pack: the service reads every part in one execution, the Calendar Archive and the punches ' +
                     'once each, and the memo is dropped after',
                pack.status === 200 && pack.data.house === 'ZZ9999' && !!pack.data.built_at &&
                LOCATION_PACK_PARTS.every(function (n) { return st[n] && st[n].status === 200 && !!parts[n]; }) &&
                reads.cal === 1 && reads.punches === 1 && LOCATION_PACK_MEMO_ === null,
                JSON.stringify([pack.status, st, reads, LOCATION_PACK_MEMO_]));
      var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
      var docs = HUB_ACTIONS.locationDocuments({ house: 'ZZ9999' }, master).data;
      var parity = {
        overview: same(parts.overview, HUB_ACTIONS.locationOverview({ house: 'ZZ9999' }, master).data),
        staff: same(parts.staff, HUB_ACTIONS.locationStaff({ house: 'ZZ9999' }, master).data),
        notes: same(parts.notes, HUB_ACTIONS.locationNotes({ house: 'ZZ9999' }, master).data),
        supplies: same(parts.supplies, HUB_ACTIONS.locationSupplies({ house: 'ZZ9999' }, master).data),
        guidebook: !!docs && parts.guidebook.guidebook === docs.guidebook &&
                   parts.guidebook.guidebook_why === docs.guidebook_why && docs.guidebook_why === 'st: no houses room',
        repairs: same(parts.repairs.rows, HUB_ACTIONS.locationRepairs({ house: 'ZZ9999', resolved: true }, master).data.rows) &&
                 parts.repairs.rows.length === 1,
        incidents: same(parts.incidents, HUB_ACTIONS.locationIncidents({ house: 'ZZ9999' }, master).data) &&
                   parts.incidents.rows.length === 1
      };
      stAssert_(out, P + 'pack: each part is its section action\'s own answer — the repair requests every one, resolved ' +
                     'or not — and the guidebook the Documents walk',
                Object.keys(parity).every(function (k) { return parity[k]; }), JSON.stringify(parity));
      var packText = JSON.stringify(pack);
      stAssert_(out, P + 'pack: no consumer_* field, punch comment or client name from a punch reaches it',
                packText.indexOf('consumer') === -1 && packText.indexOf('Client Secret') === -1 &&
                packText.indexOf('private words') === -1, packText.slice(0, 300));
      hubTabSheet_ = function (tab) { if (tab === LOCATION_NOTES_TAB) throw new Error('st: notes closed'); return null; };
      bumpAll();
      var broken = HUB_ACTIONS.locationPack({ house: 'ZZ9999' }, serviceUser_());
      var bst = broken.data.part_status;
      stAssert_(out, P + 'pack: a part that fails is its own 503 and the other four still answer',
                broken.status === 200 && bst.notes.status === 503 && !broken.data.parts.notes &&
                /notes closed/.test(bst.notes.message) &&
                ['overview', 'staff', 'supplies', 'guidebook'].every(function (n) {
                  return bst[n].status === 200 && !!broken.data.parts[n];
                }) && LOCATION_PACK_MEMO_ === null, JSON.stringify(bst));
    } finally {
      commBroadcastCalendarRows_ = packKeep.cal;
      psiPunchesFullSheet_ = packKeep.full;
      psiPunchesRows_ = packKeep.rows;
      docRoomFolder_ = packKeep.room;
      locationsPolicies_ = packKeep.policies;
      ispDocFor_ = packKeep.isp;
      hubTabSheet_ = keep.sheet;
      estateRows_ = keep.estate;
    }

    // ---- the viewer's cut ----
    stLocationsCut_(out, P, master);

    // ---- where the notes live ----
    var asResource = Object.keys(RESOURCES).filter(function (k) {
      return RESOURCES[k] && (RESOURCES[k].sheet === LOCATION_NOTES_TAB || RESOURCES[k].sheet === LOCATION_SUPPLY_TAB);
    });
    stAssert_(out, P + 'the notes tab is no generic resource: not clientScoped, no list/get door, no slice',
              asResource.length === 0, asResource.join());
    stAssert_(out, P + 'house_notes is routed to the Care book and born there, beside the Clients app\'s three tabs, the Staff app\'s two ' +
                   'and the SSA and Families apps\' one each',
              HUB_TAB_HOME.house_notes === 'HUB_CARE_BOOK_ID' && Object.keys(HUB_TAB_HOME).length === 48 &&
              HUB_TAB_BORN_HOME.join() === 'house_notes,isp_sections,incident_reviews,staff_notes,staff_profile_visits,ssa_notes,family_notes,client_overrides',
              Object.keys(HUB_TAB_HOME).length + ' ' + HUB_TAB_BORN_HOME.join());
    hubTabHomeId_ = function (t) { return t === 'house_notes' || t === 'ist_records' ? 'CARE_BOOK' : ''; };
    var book = function (id) { return { getId: function () { return id; } }; };
    var born = [hubTabBornHere_(book('CARE_BOOK'), 'house_notes'), hubTabBornHere_(book('HUB_DB'), 'house_notes'),
                hubTabBornHere_(book('CARE_BOOK'), 'ist_records'), hubTabBornHere_(null, 'house_notes')];
    hubTabHomeId_ = function () { return ''; };
    born.push(hubTabBornHere_(book(''), 'house_notes'));
    var ens = stCode_(keep.ensure);
    stAssert_(out, P + 'a born-home tab is made only in the book its property names — never HUB_DB, never another tab, ' +
                   'never with the property unset',
              born.join() === 'true,false,false,false,false' &&
              ens.indexOf('hubTabBornHere_') > ens.indexOf('hubTabDeclaredGone_') &&
              ens.indexOf('hubTabBornHere_') < ens.indexOf('insertSheet'), born.join());
  } finally {
    locationsHouse_ = keep.house;
    HUB_MASTER_EMAIL_CACHE = keep.masterCache;
    HUB_MEMBER_CTX = keep.member;
    hubSysLog_ = keep.log;
    hubTabEnsure_ = keep.ensure;
    hubTabSheet_ = keep.sheet;
    houseMoved_ = keep.moved;
    sheetDbGateHolds_ = keep.holds;
    estateRows_ = keep.estate;
    locationsHomes_ = keep.homes;
    locationsClientRows_ = keep.clientRows;
    clientsDerived_ = keep.derived;
    locationsIstRows_ = keep.istRows;
    hubTabHomeId_ = keep.homeId;
    hubProfileAppRules_ = keep.rules;
    HUB_VIEWER_MEMO = keep.viewerMemo;
  }
}

// The cut each scope makes, the gate's scope stood in for: a client, a family member and an SSA held to their…
function stLocationsCut_(out, P, master) {
  var keep = {
    gate: hubProfileAppGate_, house: locationsHouse_, visible: hubStaffVisibleForHouses_, istRows: locationsIstRows_,
    estate: estateRows_, cal: commBroadcastCalendarRows_, full: psiPunchesFullSheet_, rows: psiPunchesRows_,
    room: docRoomFolder_, policies: locationsPolicies_, isp: ispDocFor_, sheet: hubTabSheet_, bytes: locationsDocBytes_,
    homes: locationsHomes_, clientRows: locationsClientRows_
  };
  var j = function (x) { return JSON.stringify(x); };
  var scopeOf = function (kind, keys, codes) {
    return { kind: kind, client_keys: keys || [], house_codes: codes || [], ssa_keys: ['ssa_x'], family_keys: ['fam_x'],
             why: '' };
  };
  var SCOPES = {
    'u-kay': scopeOf('client', ['kmarsh'], ['ZZ9999']),
    'u-gia': scopeOf('guardian', ['liagomez'], ['ZZ9999']),
    'u-ssa': scopeOf('ssa', ['kmarsh'], ['ZZ9999']),
    'u-all': scopeOf('all')
  };
  var who = function (id, role) { return { id: id, email: id + '@x.test', role: role, types: [] }; };
  var kay = who('u-kay', 'client'), gia = who('u-gia', 'client'), ssa = who('u-ssa', 'staff'), all = who('u-all', 'staff');
  var gateAsked = [];
  var ZZ = { code: 'ZZ9999', home: { code: 'ZZ9999', address: '9999 Test Ave NW', home_name: 'ZZ - ZZ9999' }, homes: [],
             all_clients: [], clients: [{ client_key: 'kmarsh', name: 'Kenny Marsh', isp_year: '2026' },
                                        { client_key: 'liagomez', name: 'Lia Gomez', isp_year: '' }] };
  var houseAsked = [];
  var guideFile = {
    getId: function () { return 'guidezz00001'; }, getName: function () { return 'ZZ Guidebook'; },
    getMimeType: function () { return 'application/pdf'; }, getUrl: function () { return 'https://x.test/g'; },
    getLastUpdated: function () { return new Date('2026-09-01T12:00:00Z'); }
  };
  var iter = function (list) { var i = 0; return { hasNext: function () { return i < list.length; }, next: function () { return list[i++]; } }; };
  var houseFolder = { getId: function () { return 'fzz'; }, getName: function () { return 'ZZ9999 - Test'; },
                      getFolders: function () { return iter([]); }, getFiles: function () { return iter([guideFile]); } };
  var room = { getFolders: function () { return iter([houseFolder]); }, getFiles: function () { return iter([]); } };
  var bytesAsked = [];
  try {
    hubProfileAppGate_ = function (appId, u) {
      gateAsked.push(appId);
      if (appId !== LOCATION_APP_ID) return { open: false, scope: scopeOf('none') };
      if (locationsGate_(u)) return { open: true, scope: scopeOf('master') };
      var s = u && SCOPES[u.id];
      return s ? { open: true, scope: JSON.parse(j(s)) } : { open: false, scope: scopeOf('none') };
    };
    locationsHouse_ = function (raw) {
      houseAsked.push(String(raw));
      return String(raw).toUpperCase() === 'ZZ9999' ? ZZ : { code: 'QQ1000', home: null, homes: [], all_clients: [], clients: [] };
    };
    hubStaffVisibleForHouses_ = function (codes) { return { keys: codes.join() === 'ZZ9999' ? ['annlee'] : [], why: '' }; };
    commBroadcastCalendarRows_ = function () {
      return { tz: 'America/New_York', values: [
        ['Location', 'Employee', 'Designation', 'Phone', 'Date'],
        ['ZZ - ZZ9999', 'Ann Lee', '*', '', '09/20/2025'],
        ['ZZ - ZZ9999', 'Bob Gone', '*', '', '01/06/2025']] };
    };
    psiPunchesFullSheet_ = function () { return {}; };
    psiPunchesRows_ = function () { return { rows: [] }; };
    locationsIstRows_ = function () {
      return [{ id: 'i1', staffName: 'Ann Lee', clientName: 'Kenny Marsh', house: 'ZZ9999', status: 'done',
                trainedAt: '2026-01-02', docUrl: 'https://drive.google.com/file/d/istzz000001/view', docFileId: 'istzz000001',
                docAt: '2026-01-03', docBy: 'Filer' },
              { id: 'i2', staffName: 'Ann Lee', clientName: 'Lia Gomez', house: 'ZZ9999', status: 'done',
                docFileId: 'istzz000002' }];
    };
    estateRows_ = function (res) {
      return res === 'uiIncidents' ? [
        { id: 'n1', client_name: 'Kenny Marsh', incident_category: 'Fall', incident_date: '2026-09-01T04:00:00.000Z' },
        { id: 'n2', client_name: 'Lia Gomez', incident_category: 'Medication error', incident_date: '2026-09-02T04:00:00.000Z' }
      ] : [];
    };
    docRoomFolder_ = function () { return { folder: room, reason: '' }; };
    locationsPolicies_ = function () {
      return [{ title: 'Company Policies', url: 'u1', drive_id: 'policyzz0001' },
              { title: 'Bill of Rights - ER', url: 'u2', drive_id: 'policyzz0002' },
              { title: 'MUI Handbook', url: 'u3', drive_id: 'policyzz0003' }];
    };
    ispDocFor_ = function (name) {
      var id = 'isp' + clientNameKey_(name) + '00';
      return { id: id, name: name + ' ISP', url: 'https://docs.google.com/document/d/' + id + '/edit' };
    };
    var noteRows = [
      { id: 'HN_h', house: 'ZZ9999', client_key: '', state: 'open', details: 'house', at: '2026-09-03' },
      { id: 'HN_k', house: 'ZZ9999', client_key: 'kmarsh', state: 'open', details: 'kenny', at: '2026-09-02' },
      { id: 'HN_l', house: 'ZZ9999', client_key: 'liagomez', state: 'open', details: 'lia', at: '2026-09-01' }
    ];
    var noteGrid = [LOCATION_NOTES_HEADER].concat(noteRows.map(function (n) {
      return LOCATION_NOTES_HEADER.map(function (h) { return n[h] || ''; });
    }));
    var noteSheet = { getDataRange: function () { return { getValues: function () { return noteGrid; } }; } };
    hubTabSheet_ = function (tab) { return tab === LOCATION_NOTES_TAB ? noteSheet : null; };
    locationsDocBytes_ = function (id) {
      bytesAsked.push(id);
      return { name: id, mime: 'application/pdf', size: 1, exported: false, b64: 'QQ==' };
    };
    locationsHomes_ = function () {
      return [{ code: 'ZZ9999', home_name: 'ZZ - ZZ9999', address: '9999 Test Ave NW', region: 'Canton', thumbnail_url: '' }];
    };
    locationsClientRows_ = function () {
      return [{ client_key: 'kmarsh', name: 'Kenny Marsh', house: 'ZZ9999', home_address: '', status: 'active' },
              { client_key: 'liagomez', name: 'Lia Gomez', house: 'ZZ9999', home_address: '', status: 'active' },
              { client_key: 'far', name: 'Far Away', house: 'QQ1000', home_address: '', status: 'active' }];
    };
    ['locationOverview', 'locationStaff', 'locationNotes', 'locationSupplies', 'locationDocuments', 'locationIncidents',
     'locationRepairs'].forEach(function (a) { cacheBump_('loc_' + a + '_ZZ9999'); });

    var shape = function (r) { return !!r && r.status === 404 && r.message === 'Unknown action.' && Object.keys(r).length === 2; };
    var READS = ['locationOverview', 'locationStaff', 'locationRepairs', 'locationIncidents', 'locationDocuments',
                 'locationSupplies', 'locationNotes', 'locationDocFile'];
    var WRITES = ['locationNoteAdd', 'locationNoteState', 'locationSupplyEntry', 'locationIstFile', 'locationHouseSave',
                  'locationNoteEdit', 'locationSupplyEdit', 'locationStaffRemove', 'locationIncidentFile',
                  'locationIncidentEdit', 'locationRepairFile', 'locationRepairEdit', 'locationDocRemove',
                  'locationDocLink', 'locationDocUpload', 'locationClientsAdd', 'locationAssetEdit', 'locationAssetAdd'];

    // a house outside the scope, or no house at all, is the closed gate's answer before the house is looked up
    houseAsked = [];
    var outside = [];
    [kay, gia, ssa].forEach(function (u) {
      READS.forEach(function (a) {
        ['QQ1000', 'qq1000', '', 'House 12'].forEach(function (h) {
          var r = HUB_ACTIONS[a]({ house: h, id: 'isplia00000001' }, u);
          if (!shape(r)) outside.push(u.id + ' ' + a + ' ' + h + ' → ' + j(r));
        });
      });
    });
    stAssert_(out, P + 'a client, a family member and an SSA asking for a house outside their scope (or none, or a ' +
                   'malformed one) get the closed gate\'s 404 shape, and the house is never looked up',
              outside.length === 0 && houseAsked.length === 0 && gateAsked.every(function (a) { return a === 'locations'; }),
              outside.slice(0, 3).join(' | ') + ' asked=' + houseAsked.join());

    // nobody but the master writes, whatever the gate opened for reading
    var wrote = [];
    [kay, gia, ssa, all].forEach(function (u) {
      WRITES.forEach(function (a) {
        var r = HUB_ACTIONS[a]({ house: 'ZZ9999', id: 'HN_1', state: 'open', details: 'x', item: 'Gloves', kind: 'count',
                                 qty: 1, staff: 'Ann Lee', client: 'Kenny Marsh' }, u);
        if (!shape(r)) wrote.push(u.id + ' ' + a + ' → ' + j(r));
      });
    });
    stAssert_(out, P + 'every write answers 404 to a client, a family member, an SSA and a STAFF reader, before the ' +
                   'house is looked up', wrote.length === 0 && houseAsked.length === 0, wrote.slice(0, 3).join(' | '));

    // the scope answer: the kind, the houses as the switcher lists them, never the scope's keys
    var sKay = HUB_ACTIONS.locationScope({}, kay), sSsa = HUB_ACTIONS.locationScope({}, ssa);
    var sAll = HUB_ACTIONS.locationScope({}, all), sNone = HUB_ACTIONS.locationScope({}, who('u-nobody', 'staff'));
    var hKay = (sKay.data && sKay.data.houses) || [];
    var hSsa = (sSsa.data && sSsa.data.houses) || [];
    stAssert_(out, P + 'locationScope: a client and an SSA are told their house with only their own client (and how many ' +
                   'live there), STAFF everything, a closed gate 404 — never the scope\'s client, SSA or family keys',
              sKay.status === 200 && sKay.data.kind === 'client' && sKay.data.cut === true && sKay.data.writes === false &&
              hKay.length === 1 && hKay[0].code === 'ZZ9999' && hKay[0].client_count === 2 &&
              j(hKay[0].clients) === j([{ client_key: 'kmarsh', name: 'Kenny Marsh' }]) &&
              sSsa.data.kind === 'ssa' && sSsa.data.cut === false && hSsa[0].client_count === 2 &&
              j(hSsa[0].clients) === j([{ client_key: 'kmarsh', name: 'Kenny Marsh' }]) &&
              sAll.data.kind === 'all' && sAll.data.houses === null && shape(sNone) &&
              !/client_keys|ssa_keys|family_keys|ssa_x|fam_x/.test(j([sKay, sSsa, sAll])),
              j([sKay, sSsa, sAll, sNone]));

    // overview and staff
    var oKay = HUB_ACTIONS.locationOverview({ house: 'zz9999' }, kay);
    var oSsa = HUB_ACTIONS.locationOverview({ house: 'ZZ9999' }, ssa);
    var oMaster = HUB_ACTIONS.locationOverview({ house: 'ZZ9999' }, master);
    stAssert_(out, P + 'overview: a client and an SSA see their own client alone; the master every current client — and ' +
                   'the cut never reaches the held answer',
              oKay.status === 200 && j(oKay.data.clients) === j([{ client_key: 'kmarsh', name: 'Kenny Marsh' }]) &&
              j(oSsa.data.clients) === j([{ client_key: 'kmarsh', name: 'Kenny Marsh' }]) &&
              oMaster.data.clients.length === 2, j([oKay, oSsa.data.clients]));
    var stKay = HUB_ACTIONS.locationStaff({ house: 'ZZ9999' }, kay).data || {};
    var stGia = HUB_ACTIONS.locationStaff({ house: 'ZZ9999' }, gia).data || {};
    var stSsa = HUB_ACTIONS.locationStaff({ house: 'ZZ9999' }, ssa).data || {};
    var annKay = (stKay.staff || [])[0] || {};
    stAssert_(out, P + 'staff: a client sees only the staff visible for its house, each with its own client\'s IST cell ' +
                   'and no paper; a family member its ward\'s; an SSA everyone, with its own client\'s cell and paper alone',
              (stKay.staff || []).map(function (p) { return p.key; }).join() === 'annlee' &&
              j(stKay.clients) === j([{ client_key: 'kmarsh', name: 'Kenny Marsh' }]) &&
              annKay.ist.length === 1 && annKay.ist[0].status === 'done' && annKay.ist[0].docFileId === '' &&
              annKay.ist[0].docUrl === '' && annKay.ist[0].docBy === '' &&
              (stGia.staff || []).length === 1 && stGia.staff[0].ist.length === 1 &&
              stGia.staff[0].ist[0].client_key === 'liagomez' &&
              (stSsa.staff || []).length === 2 && j(stSsa).indexOf('istzz000001') !== -1 &&
              j(stSsa.clients) === j([{ client_key: 'kmarsh', name: 'Kenny Marsh' }]) &&
              stSsa.staff.every(function (p) { return p.ist.length === 1 && p.ist[0].client_key === 'kmarsh'; }) &&
              j(stSsa).indexOf('istzz000002') === -1 && j(stSsa).indexOf('Lia Gomez') === -1 &&
              j([stKay, stGia]).indexOf('istzz00000') === -1 && j([stKay, stGia]).indexOf('Bob Gone') === -1,
              j([stKay, stGia, stSsa]));

    // incidents, documents, notes
    var iKay = HUB_ACTIONS.locationIncidents({ house: 'ZZ9999' }, kay).data || {};
    var iSsa = HUB_ACTIONS.locationIncidents({ house: 'ZZ9999' }, ssa).data || {};
    stAssert_(out, P + 'incidents: a client and an SSA see their own client\'s alone, with only their categories',
              (iKay.rows || []).map(function (r) { return r.id; }).join() === 'n1' && iKay.categories.join() === 'Fall' &&
              iKay.clients.length === 1 && j(iKay).indexOf('Lia Gomez') === -1 &&
              (iSsa.rows || []).map(function (r) { return r.id; }).join() === 'n1' && iSsa.categories.join() === 'Fall' &&
              j(iSsa).indexOf('Lia Gomez') === -1,
              j([iKay, iSsa]));
    var dGia = HUB_ACTIONS.locationDocuments({ house: 'ZZ9999' }, gia).data || {};
    var dSsa = HUB_ACTIONS.locationDocuments({ house: 'ZZ9999' }, ssa).data || {};
    stAssert_(out, P + 'documents: a family member sees its ward\'s ISP and the two company documents written for ' +
                   'clients, and no guidebook; an SSA its own client\'s ISP with every policy and the guidebook',
              (dGia.isps || []).map(function (d) { return d.client_key; }).join() === 'liagomez' &&
              (dGia.policies || []).map(function (p) { return p.drive_id; }).join() === 'policyzz0002,policyzz0003' &&
              dGia.guidebook === null && dGia.guidebook_withheld === true && dGia.guidebook_why === '' &&
              (dSsa.isps || []).map(function (d) { return d.client_key; }).join() === 'kmarsh' &&
              (dSsa.policies || []).length === 3 && !!dSsa.guidebook && dSsa.guidebook.files.length === 1,
              j([dGia, dSsa]));
    var nKay = HUB_ACTIONS.locationNotes({ house: 'ZZ9999' }, kay), nGia = HUB_ACTIONS.locationNotes({ house: 'ZZ9999' }, gia);
    var nSsa = HUB_ACTIONS.locationNotes({ house: 'ZZ9999' }, ssa), nAll = HUB_ACTIONS.locationNotes({ house: 'ZZ9999' }, all);
    var rep = HUB_ACTIONS.locationRepairs({ house: 'ZZ9999' }, kay), sup = HUB_ACTIONS.locationSupplies({ house: 'ZZ9999' }, gia);
    var noteIds = function (r) { return ((r && r.data && r.data.notes) || []).map(function (n) { return n.id; }).join(); };
    stAssert_(out, P + 'house notes answer 404 to a client and a family member; an SSA reads the house\'s own notes and ' +
                   'its client\'s, never another client\'s; STAFF every note; repairs and supplies read for every scope',
              shape(nKay) && shape(nGia) && nSsa.status === 200 && noteIds(nSsa) === 'HN_h,HN_k' &&
              nSsa.data.open_count === 2 && nAll.status === 200 && noteIds(nAll) === 'HN_h,HN_k,HN_l' &&
              nAll.data.open_count === 3 && rep.status === 200 && sup.status === 200,
              j([nKay, nGia, nSsa, nAll.status, noteIds(nAll), rep.status, sup.status]));

    // a document through its door: only a file the viewer's own Documents answer names
    bytesAsked = [];
    var doc = function (u, id) { return HUB_ACTIONS.locationDocFile({ house: 'ZZ9999', id: id }, u).status; };
    var got = {
      ownIsp: doc(kay, 'ispkennymarsh00'), otherIsp: doc(kay, 'ispliagomez00'), companyPolicy: doc(kay, 'policyzz0001'),
      clientPolicy: doc(kay, 'policyzz0002'), guidebook: doc(kay, 'guidezz00001'), istPaper: doc(kay, 'istzz000001'),
      ssaGuide: doc(ssa, 'guidezz00001'), ssaIst: doc(ssa, 'istzz000001'), ssaOtherIsp: doc(ssa, 'ispliagomez00'),
      ssaOtherIst: doc(ssa, 'istzz000002'), ssaPolicy: doc(ssa, 'policyzz0001')
    };
    stAssert_(out, P + 'documents door: a client opens its own client\'s ISP and a client policy, never another client\'s ' +
                   'ISP, a staff policy, the guidebook or an IST paper; an SSA opens the guidebook, a staff policy and ' +
                   'its own client\'s IST paper, never another client\'s ISP or IST paper',
              got.ownIsp === 200 && got.clientPolicy === 200 && got.otherIsp === 404 && got.companyPolicy === 404 &&
              got.guidebook === 404 && got.istPaper === 404 && got.ssaGuide === 200 && got.ssaIst === 200 &&
              got.ssaOtherIsp === 404 && got.ssaOtherIst === 404 && got.ssaPolicy === 200 &&
              bytesAsked.join() === 'ispkennymarsh00,policyzz0002,guidezz00001,istzz000001,policyzz0001',
              j([got, bytesAsked]));

    // the relay's pack: each current client's own view, exactly what the actions answer that client
    ZZ.homes = locationsHomes_();
    ZZ.all_clients = locationsClientRows_().concat([
      { client_key: 'moved', name: 'Moe Ved', house: 'QQ1000', home_address: '', status: 'active' }]);
    ZZ.clients = ZZ.clients.concat([{ client_key: 'moved', name: 'Moe Ved', isp_year: '' }]);
    ['locationOverview', 'locationStaff', 'locationNotes', 'locationSupplies', 'locationDocuments', 'locationIncidents',
     'locationRepairs'].forEach(function (a) { cacheBump_('loc_' + a + '_ZZ9999'); });
    var answersOf = function (u) {
      return { scope: HUB_ACTIONS.locationScope({}, u).data,
               overview: HUB_ACTIONS.locationOverview({ house: 'ZZ9999' }, u).data,
               staff: HUB_ACTIONS.locationStaff({ house: 'ZZ9999' }, u).data,
               incidents: HUB_ACTIONS.locationIncidents({ house: 'ZZ9999' }, u).data,
               documents: HUB_ACTIONS.locationDocuments({ house: 'ZZ9999' }, u).data };
    };
    var giaBefore = j(answersOf(gia));
    var packed = HUB_ACTIONS.locationPack({ house: 'ZZ9999' }, serviceUser_());
    var views = ((packed.data || {}).parts || {}).client_views || {};
    var kv = views.kmarsh || {};
    var kayAnswers = answersOf(kay);
    var unlike = Object.keys(kayAnswers).filter(function (k) { return j(kv[k]) !== j(kayAnswers[k]); });
    stAssert_(out, P + 'pack: each current client of the house whose scope is this house alone has its own view — the ' +
                   'scope, overview, staff, incidents and documents exactly as the actions answer that client, and ' +
                   'nothing else: no notes, guidebook, IST paper or other client; a client whose record names another ' +
                   'house has none',
              packed.status === 200 && packed.data.part_status.client_views.status === 200 &&
              Object.keys(views).sort().join() === 'kmarsh,liagomez' && unlike.length === 0 &&
              Object.keys(kv).sort().join() === 'documents,incidents,overview,scope,staff' &&
              kv.scope.kind === 'client' && kv.scope.cut === true && kv.scope.writes === false &&
              ['Lia Gomez', 'Moe Ved', 'guidezz00001', 'istzz00000', 'HN_', 'policyzz0001'].every(function (w) {
                return j(kv).indexOf(w) === -1;
              }), j([unlike, Object.keys(views), kv]).slice(0, 1500));
    stAssert_(out, P + 'pack: a family member\'s own answers are the same after the pack is gathered as before it',
              j(answersOf(gia)) === giaBefore, giaBefore.slice(0, 300));
    hubStaffVisibleForHouses_ = function () { throw new Error('st: the calendar is closed'); };
    ['locationOverview', 'locationStaff', 'locationIncidents'].forEach(function (a) { cacheBump_('loc_' + a + '_ZZ9999'); });
    estateRows_ = function () { throw new Error('st: incidents closed'); };
    var noIncidents = HUB_ACTIONS.locationPack({ house: 'ZZ9999' }, serviceUser_());
    var nst = (noIncidents.data && noIncidents.data.part_status) || {};
    stAssert_(out, P + 'pack: with a part a view is cut from unanswered, no client has a view and the part says why',
              noIncidents.status === 200 && nst.incidents.status === 503 && nst.client_views.status === 503 &&
              /incidents/.test(nst.client_views.message) && !noIncidents.data.parts.client_views, j(nst));
  } finally {
    hubProfileAppGate_ = keep.gate;
    locationsHouse_ = keep.house;
    hubStaffVisibleForHouses_ = keep.visible;
    locationsIstRows_ = keep.istRows;
    estateRows_ = keep.estate;
    commBroadcastCalendarRows_ = keep.cal;
    psiPunchesFullSheet_ = keep.full;
    psiPunchesRows_ = keep.rows;
    docRoomFolder_ = keep.room;
    locationsPolicies_ = keep.policies;
    ispDocFor_ = keep.isp;
    hubTabSheet_ = keep.sheet;
    locationsDocBytes_ = keep.bytes;
    locationsHomes_ = keep.homes;
    locationsClientRows_ = keep.clientRows;
  }
}
