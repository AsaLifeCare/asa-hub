/** Self-test for ProductionActions.gs: fake books, forms and houses record every call; stand-ins restored in `finally`. */

var ST_PA_BANNER = 'Asa LifeCare Systems are Online, go there for this kind of request: https://asamylife.asalifecare.com/';
var ST_PA_DEF_SHA_PIN = '28cb56aee0241172';

function stPaBook_(spec) {
  var cells = {}, fmt = {}, links = {}, writes = [], reads = { n: 0 };
  var tabColor = spec.tabColor || null;
  var key = function (r, c) { return r + ',' + c; };
  var get = function (r, c) { return Object.prototype.hasOwnProperty.call(cells, key(r, c)) ? cells[key(r, c)] : ''; };
  var put = function (r, c, v) {
    if (v === '' || v === null || v === undefined) delete cells[key(r, c)];
    else cells[key(r, c)] = v;
  };
  var styleOf = function (r, c) {
    return fmt[key(r, c)] || { bg: '#ffffff', fc: '#000000', fw: 'normal', wrap: 'OVERFLOW' };
  };
  var style = function (r, c, k, v) { var s = styleOf(r, c); s = JSON.parse(JSON.stringify(s)); s[k] = v; fmt[key(r, c)] = s; };
  (spec.rows || []).forEach(function (vals, i) { vals.forEach(function (v, j) { put(i + 1, j + 1, v); }); });
  var extent = function (which) {
    var n = 0;
    Object.keys(cells).forEach(function (k) { var p = k.split(','); n = Math.max(n, Number(p[which])); });
    return n;
  };
  var merged = spec.merged || [];
  function range(r, c, nr, nc) {
    var grid = function (fn) {
      var out = [];
      for (var i = 0; i < nr; i++) { var line = []; for (var j = 0; j < nc; j++) line.push(fn(r + i, c + j)); out.push(line); }
      return out;
    };
    var each = function (fn) { for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) fn(r + i, c + j, i, j); };
    return {
      getRow: function () { return r; }, getColumn: function () { return c; },
      getNumRows: function () { return nr; }, getNumColumns: function () { return nc; },
      getValues: function () { reads.n++; return grid(get); },
      getBackgrounds: function () { return grid(function (a, b) { return styleOf(a, b).bg; }); },
      getFontColors: function () { return grid(function (a, b) { return styleOf(a, b).fc; }); },
      getFontWeights: function () { return grid(function (a, b) { return styleOf(a, b).fw; }); },
      getWrapStrategy: function () { return styleOf(r, c).wrap; },
      getMergedRanges: function () {
        return merged.filter(function (m) { return m.row >= r && m.row < r + nr && m.col2 >= c && m.col < c + nc; });
      },
      getCell: function (i, j) { return range(r + i - 1, c + j - 1, 1, 1); },
      setRichTextValue: function (v) { writes.push('rich ' + key(r, c)); put(r, c, v.text); links[key(r, c)] = v.url; },
      setValue: function (v) { writes.push('value ' + key(r, c)); put(r, c, v); },
      setValues: function (vs) { writes.push('values'); each(function (a, b, i, j) { put(a, b, vs[i][j]); }); },
      setBackground: function (v) {
        if (spec.failBg && spec.failBg-- > 0) throw new Error('Service error: Spreadsheets');
        writes.push('bg'); each(function (a, b) { style(a, b, 'bg', v); });
      },
      setFontColor: function (v) { writes.push('fc'); each(function (a, b) { style(a, b, 'fc', v); }); },
      setFontWeight: function (v) { writes.push('fw'); each(function (a, b) { style(a, b, 'fw', v); }); },
      setWrapStrategy: function (v) { writes.push('wrap'); each(function (a, b) { style(a, b, 'wrap', String(v)); }); },
      setBackgrounds: function (vs) { writes.push('bgs'); each(function (a, b, i, j) { style(a, b, 'bg', vs[i][j]); }); },
      setFontColors: function (vs) { writes.push('fcs'); each(function (a, b, i, j) { style(a, b, 'fc', vs[i][j]); }); },
      setFontWeights: function (vs) { writes.push('fws'); each(function (a, b, i, j) { style(a, b, 'fw', vs[i][j]); }); },
      clearContent: function () { writes.push('clear'); each(function (a, b) { put(a, b, ''); delete links[key(a, b)]; }); }
    };
  }
  var book = null;
  var sheet = {
    getSheetId: function () { return spec.gid; },
    getName: function () { return spec.tab; },
    getFrozenRows: function () { return spec.frozen || 0; },
    getLastRow: function () { return extent(0); },
    getLastColumn: function () { return extent(1); },
    getMaxColumns: function () { return spec.maxCols; },
    getMaxRows: function () { return spec.maxRows; },
    getFormUrl: function () { return spec.formUrl || null; },
    getTabColor: function () { return tabColor; },
    setTabColor: function (v) { writes.push('tab'); tabColor = v; },
    getRange: function (a, b, n, m) { return range(a, b, n || 1, m || 1); },
    appendRow: function (vals) { var at = extent(0) + 1; vals.forEach(function (v, j) { put(at, j + 1, v); }); },
    getParent: function () { return book; }
  };
  book = { getId: function () { return spec.id; }, getName: function () { return spec.name; },
           getSheets: function () { return [sheet]; } };
  return {
    book: book, sheet: sheet, writes: writes, reads: reads, links: links,
    get: get, set: put, style: styleOf, tabColor: function () { return tabColor; },
    snapshot: function (maxCol) {
      var out = {};
      Object.keys(cells).forEach(function (k) { if (Number(k.split(',')[1]) <= maxCol) out[k] = cells[k]; });
      return JSON.stringify(out);
    }
  };
}

function stPaMessenger_() {
  var rows = [['Timestamp', 'Message Group', 'Group Type', 'Message Text', 'Sent?']];
  for (var i = 2; i <= 860; i++) {
    rows.push(['9/' + (i % 28 + 1) + '/2026 10:00:00', 'ALL STAFF', 'group', 'Message ' + i, 'Yes']);
  }
  return stPaBook_({ id: '1N0TtcYzftx0ulCKfJFihpaYH9RXMc7F6dxwHR7N5IsM', name: 'Master Messenger',
                     tab: 'Message Submissions', gid: 1542343678, frozen: 1, maxCols: 30, maxRows: 1860,
                     formUrl: 'https://docs.google.com/forms/d/stFormEdit1234567890abcdef/viewform', rows: rows });
}

function stPaCommLog_() {
  return stPaBook_({ id: '19jwo2BCtiyRRMK1PghCwgngUJplBdxMCCWGzuqz6IQU', name: 'Communication Log',
                     tab: 'Communication Master ', gid: 1077596508, frozen: 1, maxCols: 26, maxRows: 1000,
                     rows: [['Name', 'Date', 'NOTES', 'Contact'], ['A Person', '9/1/2026', 'called', 'phone']] });
}

function stPaForm_(spec) {
  var f = { accepting: spec.accepting !== false, message: spec.message || '', calls: [] };
  f.handle = {
    getId: function () { return spec.id; },
    getTitle: function () { return spec.title || 'A form'; },
    getDestinationId: function () { if (!spec.destination) throw new Error('no destination'); return spec.destination; },
    isAcceptingResponses: function () { return f.accepting; },
    getCustomClosedFormMessage: function () { return f.message; },
    setAcceptingResponses: function (v) { f.calls.push('accepting ' + v); f.accepting = !!v; },
    setCustomClosedFormMessage: function (v) { f.calls.push('message'); f.message = String(v); }
  };
  return f;
}

function stPaBannerParams_(book, gid, range, extra) {
  var p = { book: book, gid: gid, range: range, text: ST_PA_BANNER, background: '#8B0000', color: '#FFFFFF',
            bold: true, tab_color: '#8B0000' };
  Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
  return JSON.stringify(p);
}

function stProductionActions_(out) {
  var keep = {
    rows: paRows_, append: paAppend_, put: paPut_, ready: paHouseReady_,
    openBook: paOpenBook_, openForm: paOpenForm_, access: paAccess_, rich: paRichText_,
    testOn: hubTestModeOn_, dial: commDialState_, mockWrite: commMockWrite_, log: hubSysLog_,
    master: HUB_MASTER_EMAIL_CACHE, sb: switchboardValues_, prop: hubProp_, tenant: HUB_TENANT_CTX
  };
  var r = {};
  var store = {}, mock = [], logs = [], books = {}, forms = {}, opened = [];
  var testMode = 'on', propsDead = false, houseReady = true, mockDead = false;
  var CORE = 'stCoreBook000000000000000000000', RUNTIME = 'stRuntimeBook0000000000000000';
  var HOUSE = 'stHouseBook000000000000000000000';
  var copy = function (o) { return JSON.parse(JSON.stringify(o)); };
  var boss = { email: 'boss@example.org', display_name: 'The Boss', role: 'admin', types: [] };
  var n = 0;
  var cid = function () { return 'stpa-' + (++n); };
  var def = function (id, number, phase, kind, handler, params, extra) {
    var row = { id: id, number: number, phase: phase, title: 'Action ' + id, system: 'A system', kind: kind,
                handler: handler, params: params || '', how: kind === 'manual' ? 'Do it by hand.' : '', link: '',
                requires: '', effect: 'An effect.', enabled: 'yes', createdAt: '2026-09-24T00:00:00Z',
                updatedAt: '2026-09-24T00:00:00Z', updated_by: '' };
    Object.keys(extra || {}).forEach(function (k) { row[k] = extra[k]; });
    store.production_actions.push(row);
    return row;
  };
  var preview = function (id) {
    var res = HUB_ACTIONS.productionActionPreview({ action_ids: [id] }, boss);
    return (res.data && res.data.items && res.data.items[id]) || { problems: [JSON.stringify(res)] };
  };
  var run = function (id, expect, sha, clientId) {
    var pv = sha === undefined ? preview(id) : null;
    return HUB_ACTIONS.productionActionRun({ action_id: id, client_id: clientId || cid(),
      preview_sha: sha === undefined ? pv.preview_sha : sha, expect: expect }, boss);
  };
  var runsOf = function (act) { return store.production_action_runs.filter(function (x) { return !act || x.act === act; }); };
  try {
    store = { production_actions: [], production_action_runs: [] };
    paRows_ = function (tab) {
      if (!store[tab]) throw new Error('no such house');
      return store[tab].map(function (x, i) { var y = copy(x); y._row = i + 2; return y; });
    };
    paAppend_ = function (tab, row) { store[tab].push(copy(row)); };
    paPut_ = function (tab, row) {
      var at = -1;
      store[tab].forEach(function (x, i) { if (x.id === row.id) at = i; });
      if (at === -1) store[tab].push(copy(row)); else store[tab][at] = copy(row);
    };
    paHouseReady_ = function () { return houseReady; };
    paOpenBook_ = function (id) { opened.push(id); if (books[id]) return books[id].book; throw new Error('File not found: ' + id); };
    paOpenForm_ = function (p) {
      var f = forms[paStr_(p.form) || (paStr_(p.book) + '#' + paStr_(p.gid))];
      if (!f) throw new Error('You do not have permission to access the requested document');
      return f.handle;
    };
    paAccess_ = function (id) { return (books[id] && books[id].access) || 'edit'; };
    paRichText_ = function (text, url) { return { text: text, url: url }; };
    hubTestModeOn_ = function () { if (testMode === 'unreadable') throw new Error('config unreadable'); return testMode === 'on'; };
    commDialState_ = function () { return { word: testMode === 'off' ? 'send' : 'record', readable: true }; };
    commMockWrite_ = function (row) { if (mockDead) throw new Error('the mock house is down'); mock.push(copy(row)); };
    hubSysLog_ = function (a, b, c) { logs.push(b + ' ' + c); };
    switchboardValues_ = function (area) {
      if (area !== 'props' || propsDead) return {};
      return { HUB_HOUSE_PRODUCTION_ACTIONS_ID: HOUSE, HUB_DB_ID: CORE };
    };
    hubProp_ = function (k) { return ({ HUB_DB_ID: CORE, HUB_APPS_RUNTIME_ID: RUNTIME })[k] || ''; };
    HUB_MASTER_EMAIL_CACHE = 'boss@example.org';
    HUB_TENANT_CTX = null;

    var mm = stPaMessenger_();
    books[mm.book.getId()] = mm;
    var MM_PARAMS = stPaBannerParams_(mm.book.getId(), 1542343678, 'G1:N1',
      { note: 'the form\'s four answers and Sent?', script: 'New Group Message.gs reads the last row' });
    def('mm_banner', '4', 'at', 'automatic', 'banner', MM_PARAMS);
    def('manual_one', '6', 'at', 'manual', '');

    var intruders = [
      { email: 'sam@example.org', role: 'staff', types: [] },
      { email: 'mia@example.org', role: 'manager', types: ['HM'] },
      { email: 'a@example.org', role: 'admin', types: ['ADMIN'] },
      { email: 'boss@example.org', role: 'admin', is_service: true }
    ];
    r.gate = [];
    var doors = [
      ['productionActionPreview', { action_ids: ['mm_banner'] }],
      ['productionActionRun', { action_id: 'mm_banner', client_id: 'x1', preview_sha: 'x', expect: 'real' }],
      ['productionActionMark', { action_id: 'manual_one', client_id: 'x2', done: true }],
      ['productionActionUndo', { run_id: 'PR-x', client_id: 'x3' }],
      ['productionActionSave', { client_id: 'x4', action: { id: 'mm_banner', title: 'Hijacked' } }]
    ];
    testMode = 'off';
    intruders.forEach(function (u) {
      doors.forEach(function (d) { r.gate.push(HUB_ACTIONS[d[0]](copy(d[1]), u).status); });
    });
    r.door = intruders.map(function (u) {
      return doors.map(function (d) {
        var g = hubPolicyGate_(d[0], copy(d[1]), u);
        return g ? g.status : HUB_ACTIONS[d[0]](copy(d[1]), u).status;
      }).join(',');
    });
    HUB_TENANT_CTX = { tenantId: 'ten_away' };
    doors.forEach(function (d) { r.gate.push(HUB_ACTIONS[d[0]](copy(d[1]), boss).status); });
    HUB_TENANT_CTX = null;
    r.gateWrites = mm.writes.length;
    r.gateRuns = runsOf().length;
    r.gateTitle = store.production_actions[0].title;
    houseReady = false;
    r.undeclared = HUB_ACTIONS.productionActionPreview({ action_ids: ['mm_banner'] }, boss);
    houseReady = true;

    testMode = 'on';
    r.mmPreview = preview('mm_banner');

    var readsBefore = mm.reads.n;
    r.rehearse = run('mm_banner', 'rehearse');
    r.rehearseMock = copy(mock);
    r.rehearseRuns = runsOf('rehearse').length;
    r.rehearseWrites = mm.writes.length;
    r.rehearseRead = mm.reads.n > readsBefore;

    testMode = 'off';
    r.offRehearse = run('mm_banner', 'rehearse');
    testMode = 'unreadable';
    r.unreadable = run('mm_banner', 'real');
    r.unreadableWrites = mm.writes.length;
    mockDead = true;
    testMode = 'on';
    r.mockDown = run('mm_banner', 'rehearse');
    mockDead = false;

    testMode = 'off';
    var headBefore = mm.snapshot(5);
    r.real = run('mm_banner', 'real');
    r.realG1 = mm.get(1, 7);
    r.realLink = mm.links['1,7'];
    r.realStyles = ['1,7', '1,10', '1,14'].map(function (k) { var p = k.split(','); return mm.style(Number(p[0]), Number(p[1])); });
    r.realO1 = mm.style(1, 15);
    r.realTab = mm.tabColor();
    r.realLast = mm.sheet.getLastRow();
    r.realHead = mm.snapshot(5) === headBefore;
    r.realLog = logs.slice();
    mm.sheet.appendRow(['9/24/2026 12:00:00', 'LEADERSHIP', 'group', 'Meeting at 3', '']);
    var lastRow = mm.sheet.getLastRow();
    var lastCol = mm.sheet.getLastColumn();
    var line = mm.sheet.getRange(lastRow, 1, 1, lastCol).getValues()[0];
    r.replay = { lastRow: lastRow, group: line[1], type: line[2], text: line[3] };
    mm.sheet.getRange(lastRow, 5).setValue('Yes');
    r.replaySent = mm.get(861, 5);
    r.replayBanner = mm.get(1, 7);

    var cl = stPaCommLog_();
    books[cl.book.getId()] = cl;
    def('comm_log_banner', '5', 'at', 'automatic', 'banner',
        stPaBannerParams_(cl.book.getId(), 1077596508, 'F1:M1', { note: 'Name, Date, NOTES and Contact' }));
    r.clPreview = preview('comm_log_banner');
    r.clRun = run('comm_log_banner', 'real');
    r.clF1 = cl.get(1, 6);
    r.clLast = cl.sheet.getLastRow();
    r.clE1 = cl.style(1, 5);

    var refuse = function (id, bookFix, params, tweak) {
      books[bookFix.book.getId()] = bookFix;
      def(id, 'R' + id.slice(-2), 'at', 'automatic', 'banner', params);
      if (tweak) tweak();
      var pv = preview(id);
      var got = HUB_ACTIONS.productionActionRun({ action_id: id, client_id: cid(), preview_sha: pv.preview_sha || 'none',
                                                  expect: 'real' }, boss);
      return { pv: pv, run: got.data && got.data.run, writes: bookFix.writes.length };
    };
    var fresh = function (over) {
      var b = stPaMessenger_();
      if (over) over(b);
      return b;
    };
    var mm2 = fresh();
    books[mm2.book.getId()] = mm2;
    r.stale = HUB_ACTIONS.productionActionRun({ action_id: 'mm_banner', client_id: cid(), preview_sha: 'deadbeefdeadbeef',
                                                expect: 'real' }, boss).data.run;
    r.staleWrites = mm2.writes.length;
    var typedPv = preview('mm_banner');
    mm2.set(1, 7, 'my note');
    r.typedRun = HUB_ACTIONS.productionActionRun({ action_id: 'mm_banner', client_id: cid(),
                                                   preview_sha: typedPv.preview_sha, expect: 'real' }, boss).data.run;
    r.typedPreview = preview('mm_banner');
    r.typedWrites = mm2.writes.length;
    var alt = function (idTail) {
      var b = stPaMessenger_();
      b.book.getId = function () { return 'stAltBook' + idTail + '00000000000000000'; };
      return b;
    };
    var b1 = alt('row5');
    r.dataRow = refuse('ref_row5', b1, stPaBannerParams_(b1.book.getId(), 1542343678, 'G5:N5'));
    var b2 = alt('hdr');
    r.overHeader = refuse('ref_hdr', b2, stPaBannerParams_(b2.book.getId(), 1542343678, 'D1:H1'));
    var merged = stPaBook_({ id: 'stMergedBook00000000000000000', name: 'Merged', tab: 'T', gid: 7, frozen: 1, maxCols: 30,
                             maxRows: 100, rows: [['a', 'b'], ['1', '2']], merged: [{ row: 1, col: 8, col2: 9 }] });
    r.merged = refuse('ref_merge', merged, stPaBannerParams_('stMergedBook00000000000000000', 7, 'D1:K1'));
    var empty = stPaBook_({ id: 'stEmptyBook000000000000000000', name: 'Empty', tab: 'T', gid: 8, frozen: 1, maxCols: 30,
                            maxRows: 100, rows: [] });
    r.emptyTab = refuse('ref_empty', empty, stPaBannerParams_('stEmptyBook000000000000000000', 8, 'G1:N1'));
    var core = stPaBook_({ id: CORE, name: 'Core', tab: 'T', gid: 9, frozen: 1, maxCols: 30, maxRows: 100,
                           rows: [['a'], ['1']] });
    r.coreBook = refuse('ref_core', core, stPaBannerParams_(CORE, 9, 'G1:N1'));
    var house = stPaBook_({ id: HOUSE, name: 'A house', tab: 'T', gid: 10, frozen: 1, maxCols: 30, maxRows: 100,
                            rows: [['a'], ['1']] });
    r.houseBook = refuse('ref_house', house, stPaBannerParams_(HOUSE, 10, 'G1:N1'));
    var blind = stPaBook_({ id: 'stBlindBook000000000000000000', name: 'Blind', tab: 'T', gid: 11, frozen: 1, maxCols: 30,
                            maxRows: 100, rows: [['a'], ['1']] });
    r.propsDead = refuse('ref_blind', blind, stPaBannerParams_('stBlindBook000000000000000000', 11, 'G1:N1'),
                         function () { propsDead = true; });
    propsDead = false;
    var narrow = stPaBook_({ id: 'stNarrowBook00000000000000000', name: 'Narrow', tab: 'T', gid: 12, frozen: 1, maxCols: 5,
                             maxRows: 100, rows: [['a', 'b', 'c', 'd', 'e'], ['1', '2', '3', '4', '5']] });
    r.noColumn = refuse('ref_narrow', narrow, stPaBannerParams_('stNarrowBook00000000000000000', 12, 'G1:N1'));
    var viewOnly = stPaBook_({ id: 'stViewBook0000000000000000000', name: 'View', tab: 'T', gid: 13, frozen: 1, maxCols: 30,
                               maxRows: 100, rows: [['a'], ['1']] });
    viewOnly.access = 'view';
    r.viewOnly = refuse('ref_view', viewOnly, stPaBannerParams_('stViewBook0000000000000000000', 13, 'G1:N1'));
    books[mm.book.getId()] = mm;

    var repeatId = cid();
    var runsBefore = runsOf().length;
    var clWritesBefore = cl.writes.length;
    r.repeat = HUB_ACTIONS.productionActionRun({ action_id: 'comm_log_banner', client_id: r.clRun.data.run.client_id,
                                                 preview_sha: 'anything', expect: 'real' }, boss);
    r.repeatRuns = runsOf().length - runsBefore;
    r.repeatWrites = cl.writes.length - clWritesBefore;
    r.noop = run('comm_log_banner', 'real', undefined, repeatId);
    r.noopWrites = cl.writes.length - clWritesBefore;

    var realRunId = r.real.data.run.id;
    var mmWrites = mm.writes.length;
    r.undo = HUB_ACTIONS.productionActionUndo({ run_id: realRunId, client_id: cid() }, boss);
    r.undoG1 = mm.get(1, 7);
    r.undoStyle = mm.style(1, 7);
    r.undoTab = mm.tabColor();
    r.undoLast = mm.sheet.getLastRow();
    r.undoWrote = mm.writes.length > mmWrites;
    r.undoTwice = HUB_ACTIONS.productionActionUndo({ run_id: realRunId, client_id: cid() }, boss);
    r.real2 = run('mm_banner', 'real');
    mm.set(1, 7, 'edited by hand');
    var handWrites = mm.writes.length;
    r.undoHand = HUB_ACTIONS.productionActionUndo({ run_id: r.real2.data.run.id, client_id: cid() }, boss);
    r.undoHandG1 = mm.get(1, 7);
    r.undoHandWrites = mm.writes.length - handWrites;
    testMode = 'on';
    r.undoTestOn = HUB_ACTIONS.productionActionUndo({ run_id: r.clRun.data.run.id, client_id: cid() }, boss);
    r.undoTestOnF1 = cl.get(1, 6);
    r.undoOld = HUB_ACTIONS.productionActionUndo({ run_id: r.rehearse.data.run.id, client_id: cid() }, boss);

    books[CORE] = core;
    var coreWrites = core.writes.length;
    var forge = function (id, actionId, after) {
      store.production_action_runs.push({ id: id, createdAt: '2099-01-01T00:00:00Z', action_id: actionId, act: 'run',
        result: 'ok', target: 'Master Messenger › Message Submissions › G1:N1', after: JSON.stringify(after),
        before: JSON.stringify({ backgrounds: ['#000000'], font_colors: ['#000000'], font_weights: ['bold'] }) });
      var got = HUB_ACTIONS.productionActionUndo({ run_id: id, client_id: cid() }, boss);
      store.production_action_runs = store.production_action_runs.filter(function (x) { return x.id !== id; });
      return got;
    };
    r.forgedCore = forge('PR-FORGED-1', 'mm_banner', { handler: 'banner', book: CORE, gid: 9, a1: 'A1', text: 'a' });
    core.set(1, 7, ST_PA_BANNER);
    r.forgedB1 = forge('PR-FORGED-2', 'ref_core', { handler: 'banner', book: CORE, gid: 9, a1: 'G1:N1', text: ST_PA_BANNER });
    r.forgedCoreWrites = core.writes.length - coreWrites;
    r.forgedCoreA1 = core.get(1, 1);
    var mmForged = mm.writes.length;
    r.forgedCells = forge('PR-FORGED-3', 'mm_banner', { handler: 'banner', book: mm.book.getId(), gid: 1542343678,
                                                        a1: 'A1', text: 'Timestamp' });
    r.forgedCellsWrites = mm.writes.length - mmForged;

    testMode = 'off';
    var partial = stPaBook_({ id: 'stPartialBook0000000000000000', name: 'Partial', tab: 'T', gid: 14, frozen: 1,
                              maxCols: 30, maxRows: 100, rows: [['a', 'b'], ['1', '2']], failBg: 1 });
    books[partial.book.getId()] = partial;
    def('partial', '20', 'at', 'automatic', 'banner', stPaBannerParams_(partial.book.getId(), 14, 'D1:F1'));
    r.partialRun = run('partial', 'real');
    r.partialD1 = partial.get(1, 4);
    r.partialTab = partial.tabColor();
    r.partialAgain = run('partial', 'real');
    r.partialAgainStyle = partial.style(1, 4);
    var halfDone = stPaBook_({ id: 'stHalfDoneBook000000000000000', name: 'Half done', tab: 'T', gid: 15, frozen: 1,
                               maxCols: 30, maxRows: 100, rows: [['a', 'b', '', ST_PA_BANNER], ['1', '2']] });
    books[halfDone.book.getId()] = halfDone;
    def('half_done', '21', 'at', 'automatic', 'banner',
        stPaBannerParams_(halfDone.book.getId(), 15, 'D1:F1', { tab_color: '' }));
    r.halfPlan = preview('half_done');
    r.halfRun = run('half_done', 'real');
    r.halfStyle = halfDone.style(1, 4);
    r.halfTab = halfDone.tabColor();

    def('open_link', '11', 'after', 'automatic', 'link', JSON.stringify({ url: 'https://asamylife.asalifecare.com/' }));
    var openedBefore = opened.length;
    var mockBefore = mock.length;
    testMode = 'on';
    r.linkRehearse = run('open_link', 'rehearse');
    r.linkMock = mock.length - mockBefore;
    testMode = 'off';
    r.linkReal = run('open_link', 'real');
    r.linkLedger = store.production_action_runs[store.production_action_runs.length - 1];
    r.linkOpened = opened.length - openedBefore;

    var form = stPaForm_({ id: 'stFormEditId00000000000000000', title: 'Vacation and Time-Off Requests', message: 'old words' });
    forms['stFormEditId00000000000000000'] = form;
    def('close_form', '7', 'at', 'automatic', 'form_close',
        JSON.stringify({ form: 'stFormEditId00000000000000000', message: 'Requests are on the platform now.' }));
    r.formPreview = preview('close_form');
    r.formRun = run('close_form', 'real');
    r.formAfter = { accepting: form.accepting, message: form.message };
    r.formUndo = HUB_ACTIONS.productionActionUndo({ run_id: r.formRun.data.run.id, client_id: cid() }, boss);
    r.formUndone = { accepting: form.accepting, message: form.message };
    def('close_missing', '9', 'at', 'automatic', 'form_close',
        JSON.stringify({ form: 'stNoSuchForm0000000000000000000', message: 'Closed.' }));
    r.formMissing = preview('close_missing');
    var shut = stPaForm_({ id: 'stShutForm000000000000000000000', accepting: false, message: 'Closed.' });
    forms['stShutForm000000000000000000000'] = shut;
    def('close_shut', '9b', 'at', 'automatic', 'form_close',
        JSON.stringify({ form: 'stShutForm000000000000000000000', message: 'Closed.' }));
    r.formNoop = run('close_shut', 'real');
    r.formNoopCalls = shut.calls.length;
    var coreForm = stPaForm_({ id: 'stCoreFormId0000000000000000' });
    forms[CORE + '#9'] = coreForm;
    def('close_core', '9c', 'at', 'automatic', 'form_close', JSON.stringify({ book: CORE, gid: 9, message: 'Closed.' }));
    r.formCore = preview('close_core');
    r.formCoreRun = run('close_core', 'real', r.formCore.preview_sha || 'none');
    var destForm = stPaForm_({ id: 'stDestFormId0000000000000000', destination: CORE });
    forms['stDestFormId0000000000000000'] = destForm;
    def('close_dest', '9d', 'at', 'automatic', 'form_close',
        JSON.stringify({ form: 'stDestFormId0000000000000000', message: 'Closed.' }));
    r.formDest = preview('close_dest');
    r.formDestRun = run('close_dest', 'real', r.formDest.preview_sha || 'none');
    r.formOwnCalls = coreForm.calls.length + destForm.calls.length;
    var otherForm = stPaForm_({ id: 'stOtherFormId000000000000000', accepting: false, message: 'x' });
    forms['stOtherFormId000000000000000'] = otherForm;
    r.formForged = forge('PR-FORGED-4', 'close_form', { handler: 'form_close', form: 'stOtherFormId000000000000000',
                                                        message: 'x' });
    r.formForgedCalls = otherForm.calls.length;

    testMode = 'on';
    r.mark = HUB_ACTIONS.productionActionMark({ action_id: 'manual_one', client_id: cid(), done: true }, boss);
    r.unmark = HUB_ACTIONS.productionActionMark({ action_id: 'manual_one', client_id: cid(), done: false }, boss);
    testMode = 'off';
    r.markOff = HUB_ACTIONS.productionActionMark({ action_id: 'mm_banner', client_id: cid(), done: true }, boss);
    r.markMissing = HUB_ACTIONS.productionActionMark({ action_id: 'nope', client_id: cid(), done: true }, boss);

    var defsBefore = store.production_actions.length;
    var save = function (a) { return HUB_ACTIONS.productionActionSave({ client_id: cid(), action: a }, boss); };
    var base = { title: 'Close the old form', number: '12', phase: 'at', kind: 'automatic', handler: 'banner',
                 params: { book: 'stSomeOutsideBook0000000000', range: 'G1:N1', text: ST_PA_BANNER } };
    r.saveNoGid = save(base);
    r.saveHandler = save({ title: 'Teleport', number: '13', phase: 'at', kind: 'automatic', handler: 'teleport' });
    r.saveManual = save({ title: 'By hand', number: '14', phase: 'at', kind: 'manual', handler: 'link' });
    r.saveLink = save({ title: 'A link', number: '15', phase: 'after', kind: 'manual', handler: '', link: 'http://example.org' });
    r.saveRows = save({ title: 'Two rows', number: '16', phase: 'at', kind: 'automatic', handler: 'banner',
                        params: { book: 'stSomeOutsideBook0000000000', gid: 1, range: 'G1:N2', text: ST_PA_BANNER } });
    r.saveBadCount = store.production_actions.length - defsBefore;
    r.saveNew = save({ title: 'Tell the office', number: '17', phase: 'after', kind: 'manual', handler: '',
                       how: 'Send the note.', link: '/app/smartcomms/broadcast', enabled: 'yes' });
    r.saveEdit = save({ id: 'manual_one', title: 'Retired by hand', enabled: 'no' });
    r.saveCount = store.production_actions.length - defsBefore;
    r.saveEdited = store.production_actions.filter(function (x) { return x.id === 'manual_one'; })[0];
    r.saveLedger = runsOf('save').length;

    r.pin = paDefSha_({ id: 'pin_fixture', kind: 'automatic', handler: 'link', phase: 'at', enabled: 'Yes ',
                        params: ' {"url":"https://asamylife.asalifecare.com/"} ' });
  } catch (e) {
    r.error = String((e && e.message) || e) + ' ' + String((e && e.stack) || '').slice(0, 500);
  } finally {
    paRows_ = keep.rows; paAppend_ = keep.append; paPut_ = keep.put; paHouseReady_ = keep.ready;
    paOpenBook_ = keep.openBook; paOpenForm_ = keep.openForm; paAccess_ = keep.access; paRichText_ = keep.rich;
    hubTestModeOn_ = keep.testOn; commDialState_ = keep.dial; commMockWrite_ = keep.mockWrite; hubSysLog_ = keep.log;
    HUB_MASTER_EMAIL_CACHE = keep.master; switchboardValues_ = keep.sb; hubProp_ = keep.prop; HUB_TENANT_CTX = keep.tenant;
  }

  var J = function (o) { return JSON.stringify(o === undefined ? null : o).slice(0, 600); };
  var runOf = function (res) { return (res && res.data && res.data.run) || {}; };
  var inv = function (pv, id) { return ((pv && pv.invariants) || []).filter(function (x) { return x.id === id; })[0] || {}; };
  var A = function (name, pass, detail) { stAssert_(out, 'production actions: ' + name, pass, detail); };

  A('the section ran to the end', !r.error, r.error);
  if (r.error) return;

  A('the five handlers answer 404 to staff, a manager, an admin who is not the master, a service call and the master away',
    r.gate.length === 25 && r.gate.every(function (s) { return s === 404; }), J(r.gate));
  A('through the policy gate first, as the door runs: staff and a manager meet its 403, the others the handler\'s 404',
    J(r.door) === J(['403,403,403,403,403', '403,403,403,403,403', '404,404,404,404,404', '404,404,404,404,404']),
    J(r.door));
  A('those refusals wrote no cell, no History row and no definition',
    r.gateWrites === 0 && r.gateRuns === 0 && r.gateTitle === 'Action mm_banner', J([r.gateWrites, r.gateRuns, r.gateTitle]));
  A('an undeclared house is a 503 that says the sheets are not set up, never the core workbook',
    r.undeclared.status === 503 && /not set up yet/.test(r.undeclared.message), J(r.undeclared));

  var pv = r.mmPreview;
  A('Master Messenger: the preview resolves G1:N1 on the tab found by its id, and every check holds',
    /G1:N1/.test(pv.target) && pv.invariants.length === 9 && pv.invariants.every(function (x) { return x.ok; }) &&
    pv.ok === true && pv.state === 'empty', J(pv));
  A('Master Messenger: the words say the last row stays 860 and the next answer lands on 861, and a form feeds the tab',
    /The last row stays 860/.test(pv.untouched[0]) && /lands on row 861/.test(pv.untouched[0]) &&
    /columns A–E \(the form's four answers and Sent\?\)/.test(pv.untouched[0]) &&
    /script's last-row read/.test(pv.untouched[0]) && pv.untouched.indexOf('A linked form feeds this tab.') !== -1, J(pv.untouched));
  A('Master Messenger: the target line names the tab id, row 1 as the frozen header row, the link and blood red',
    /\(tab id 1542343678\) · cells G1:N1 — row 1, the frozen header row · text in G1 · link on the address · blood red, white bold · tab colour blood red\./
      .test(pv.words[0]) && pv.mode === 'rehearse', J(pv.words));

  var reh = runOf(r.rehearse);
  A('test mode on: Run writes one CommMock row (productionAction, rehearsed) and one rehearse row',
    r.rehearseMock.length === 1 && r.rehearseMock[0].method === 'productionAction' &&
    r.rehearseMock[0].result === 'rehearsed' && r.rehearseMock[0].channel === 'production_action' &&
    r.rehearseRuns === 1 && reh.act === 'rehearse' && reh.result === 'ok' && reh.mock_row_id === r.rehearseMock[0].id,
    J([r.rehearseMock, reh]));
  A('test mode on: the mock row carries the preview\'s exact words, the target and the ledger key',
    r.rehearseMock[0].body.indexOf(pv.words[0]) === 0 && r.rehearseMock[0].to_masked === pv.target &&
    r.rehearseMock[0].ledger_key === reh.id && /\(rehearsal\)$/.test(r.rehearseMock[0].subject) &&
    /test mode is on|asked for a rehearsal/.test(r.rehearseMock[0].held_by), J(r.rehearseMock[0]));
  A('test mode on: no call that writes reached the tab', r.rehearseWrites === 0 && r.rehearseRead === true, r.rehearseWrites);
  A('test mode off with a rehearse click is a rehearsal only',
    runOf(r.offRehearse).act === 'rehearse' && runOf(r.offRehearse).result === 'ok' &&
    /asked for a rehearsal/.test(mock[1] && mock[1].held_by), J([runOf(r.offRehearse), mock[1]]));
  A('an unreadable test mode with a real click rehearses and writes nothing',
    runOf(r.unreadable).act === 'rehearse' && runOf(r.unreadable).test_mode === 'unreadable' && r.unreadableWrites === 0,
    J(runOf(r.unreadable)));
  A('a rehearsal whose CommMock row cannot be written is failed, not rehearsed',
    runOf(r.mockDown).act === 'rehearse' && runOf(r.mockDown).result === 'failed', J(runOf(r.mockDown)));

  var real = runOf(r.real);
  A('a real run: the line lands in G1 with a link on the address',
    real.act === 'run' && real.result === 'ok' && r.realG1 === ST_PA_BANNER &&
    r.realLink === 'https://asamylife.asalifecare.com/', J([real, r.realG1, r.realLink]));
  A('a real run: G1:N1 is blood red, white and bold, the tab colour is set, and O1 is untouched',
    r.realStyles.every(function (s) { return s.bg === '#8B0000' && s.fc === '#FFFFFF' && s.fw === 'bold'; }) &&
    r.realO1.bg === '#ffffff' && r.realTab === '#8B0000', J([r.realStyles, r.realO1, r.realTab]));
  A('a real run: the last row is still 860 and nothing in A–E moved', r.realLast === 860 && r.realHead === true,
    J([r.realLast, r.realHead]));
  A('a real run is written to the platform log', r.realLog.some(function (l) { return /production_action_run/.test(l); }),
    J(r.realLog));
  A('the form\'s next answer, appended after the banner, lands on row 861',
    r.replay.lastRow === 861, J(r.replay));
  A('New Group Message.gs\'s own last-row read finds that submission, not the banner, and its Sent? lands on E861',
    r.replay.group === 'LEADERSHIP' && r.replay.type === 'group' && r.replay.text === 'Meeting at 3' &&
    r.replaySent === 'Yes' && r.replayBanner === ST_PA_BANNER, J([r.replay, r.replaySent]));

  A('Communication Log: F1:M1 lands, the gap column E stays empty, and the last row stays 2',
    /F1:M1/.test(r.clPreview.target) && runOf(r.clRun).result === 'ok' && r.clF1 === ST_PA_BANNER && r.clLast === 2 &&
    r.clE1.bg === '#ffffff', J([r.clPreview.target, runOf(r.clRun), r.clLast]));
  A('Communication Log: no form, and the words say a bound script cannot be seen from here',
    r.clPreview.untouched.indexOf('No linked form feeds this tab.') !== -1 &&
    r.clPreview.untouched.some(function (w) { return /bound script cannot be seen/.test(w) && /left of F/.test(w); }),
    J(r.clPreview.untouched));

  A('a stale preview_sha is refused ("preview again") and writes nothing',
    r.stale.result === 'refused' && /preview again/.test(r.stale.detail) && r.staleWrites === 0, J(r.stale));
  A('a G1 somebody typed into changes the preview and the run is refused',
    r.typedRun.result === 'refused' && /preview again|not empty|inside the header/.test(r.typedRun.detail) &&
    inv(r.typedPreview, 'B5').ok === false && /G1 is not empty \('my note'\)/.test(inv(r.typedPreview, 'B5').words) &&
    r.typedWrites === 0, J([r.typedRun, inv(r.typedPreview, 'B5')]));
  A('a data-row target (G5:N5) is refused by B3 and writes nothing',
    r.dataRow.run.result === 'refused' && /Row 5 is below the frozen header band/.test(r.dataRow.run.detail) &&
    r.dataRow.writes === 0, J(r.dataRow));
  A('a range over the header (D1:H1) is refused by B4',
    inv(r.overHeader.pv, 'B4').ok === false && /Column D is inside the header \(A–E\)/.test(inv(r.overHeader.pv, 'B4').words) &&
    r.overHeader.run.result === 'refused' && r.overHeader.writes === 0, J(r.overHeader));
  A('a merged range is refused by B6', inv(r.merged.pv, 'B6').ok === false && r.merged.run.result === 'refused' &&
    r.merged.writes === 0, J(r.merged.pv.invariants));
  A('an empty tab is refused by B7', inv(r.emptyTab.pv, 'B7').ok === false &&
    /The tab is empty/.test(inv(r.emptyTab.pv, 'B7').words) && r.emptyTab.writes === 0, J(r.emptyTab.pv.invariants));
  A('the core workbook and a switchboard:props book are refused by B1',
    /one of the platform's own books/.test(r.coreBook.run.detail) && /one of the platform's own books/.test(r.houseBook.run.detail) &&
    r.coreBook.writes === 0 && r.houseBook.writes === 0, J([r.coreBook.run, r.houseBook.run]));
  A('FAIL-CLOSED: when the platform\'s own books cannot be listed, B1 refuses',
    inv(r.propsDead.pv, 'B1').ok === false && /could not be listed/.test(r.propsDead.run.detail) && r.propsDead.writes === 0,
    J(r.propsDead.run));
  A('a grid exactly as wide as the header has no free column (B8)',
    inv(r.noColumn.pv, 'B8').ok === false && /No free column right of the header/.test(inv(r.noColumn.pv, 'B8').words) &&
    r.noColumn.writes === 0, J(r.noColumn.pv.invariants));
  A('a book the platform account can only view is refused by B9',
    inv(r.viewOnly.pv, 'B9').ok === false && r.viewOnly.run.result === 'refused' && r.viewOnly.writes === 0,
    J(r.viewOnly.pv.invariants));

  A('the same client_id twice answers the first row, with no second row and no second write',
    r.repeat.data.repeat === true && r.repeat.data.run.id === runOf(r.clRun).id && r.repeatRuns === 0 &&
    r.repeatWrites === 0, J(r.repeat));
  A('a banner already in place is a noop with no write',
    runOf(r.noop).result === 'noop' && r.noopWrites === 0, J(runOf(r.noop)));

  A('undo puts back the empty cells, the formats and the tab colour, and keeps the last row',
    runOf(r.undo).act === 'undo' && runOf(r.undo).result === 'ok' && runOf(r.undo).undoes === real.id &&
    r.undoG1 === '' && r.undoStyle.bg === '#ffffff' && r.undoStyle.fw === 'normal' && !r.undoTab &&
    r.undoLast === 861 && r.undoWrote, J([runOf(r.undo), r.undoStyle, r.undoTab, r.undoLast]));
  A('a second undo of the same run is refused', r.undoTwice.status === 409, J(r.undoTwice));
  A('an undo after G1 was edited by hand is refused and changes nothing',
    runOf(r.undoHand).result === 'refused' && r.undoHandG1 === 'edited by hand' && r.undoHandWrites === 0, J(runOf(r.undoHand)));
  A('an undo while test mode is on is allowed', runOf(r.undoTestOn).result === 'ok' && r.undoTestOnF1 === '',
    J(runOf(r.undoTestOn)));
  A('a rehearsal is never undone', r.undoOld.status === 400, J(r.undoOld));
  A('a hand-made History row naming the core workbook is refused: its cells are not the ones the action names',
    runOf(r.forgedCore).result === 'refused' && /not the ones the action names now/.test(runOf(r.forgedCore).detail),
    J(runOf(r.forgedCore)));
  A('a hand-made History row for an action that names the core workbook is refused by B1',
    runOf(r.forgedB1).result === 'refused' && /platform's own books/.test(runOf(r.forgedB1).detail) &&
    r.forgedCoreWrites === 0 && r.forgedCoreA1 === 'a', J([runOf(r.forgedB1), r.forgedCoreWrites]));
  A('a hand-made History row naming other cells of the outside book is refused and writes nothing',
    runOf(r.forgedCells).result === 'refused' && r.forgedCellsWrites === 0, J(runOf(r.forgedCells)));
  A('a write that fails half-way is failed, and the cells and tab colour are put back at once',
    runOf(r.partialRun).result === 'failed' && /Service error/.test(runOf(r.partialRun).detail) &&
    /put back as they were/.test(runOf(r.partialRun).detail) && r.partialD1 === '' && !r.partialTab,
    J([runOf(r.partialRun), r.partialD1, r.partialTab]));
  A('after that failure the next run writes the banner, never a noop',
    runOf(r.partialAgain).result === 'ok' && r.partialAgainStyle.bg === '#8B0000', J(runOf(r.partialAgain)));
  A('the banner\'s text without its colours is "partial": B5 holds, and a run applies the colours instead of a noop',
    r.halfPlan.state === 'partial' && inv(r.halfPlan, 'B5').ok === true && runOf(r.halfRun).result === 'ok' &&
    r.halfStyle.bg === '#8B0000' && r.halfStyle.fw === 'bold', J([r.halfPlan.state, runOf(r.halfRun)]));
  A('an empty tab colour leaves the tab colour alone', !r.halfTab, J(r.halfTab));

  A('link: a rehearsal is a mock row', runOf(r.linkRehearse).act === 'rehearse' && r.linkMock === 1, J(runOf(r.linkRehearse)));
  A('link: a real run is a History row with the address and opens no book',
    runOf(r.linkReal).act === 'run' && runOf(r.linkReal).result === 'ok' && r.linkReal.data.open === 'https://asamylife.asalifecare.com/' &&
    /asamylife/.test(J(r.linkLedger.after)) && r.linkOpened === 0 && runOf(r.linkReal).has_undo === false, J(r.linkReal));

  A('form_close: the preview opens the form and says what it will show',
    r.formPreview.ok === true && /Stops Google Form "Vacation and Time-Off Requests" accepting answers/.test(r.formPreview.words[0]),
    J(r.formPreview));
  A('form_close: a real run closes the form and sets the message',
    runOf(r.formRun).result === 'ok' && r.formAfter.accepting === false && r.formAfter.message === 'Requests are on the platform now.',
    J([runOf(r.formRun), r.formAfter]));
  A('form_close: undo reopens it and puts the old message back',
    runOf(r.formUndo).result === 'ok' && r.formUndone.accepting === true && r.formUndone.message === 'old words', J(r.formUndone));
  A('form_close: a form that cannot be opened makes the preview say so',
    r.formMissing.ok === false && /could not be opened/.test(r.formMissing.problems[0]), J(r.formMissing));
  A('form_close: a form already closed with the same message is a noop',
    runOf(r.formNoop).result === 'noop' && r.formNoopCalls === 0, J(runOf(r.formNoop)));
  A('form_close: a form whose answers land in the core workbook, or whose destination is it, is refused (F2)',
    r.formCore.ok === false && inv(r.formCore, 'F2').ok === false && runOf(r.formCoreRun).result === 'refused' &&
    r.formDest.ok === false && inv(r.formDest, 'F2').ok === false && runOf(r.formDestRun).result === 'refused' &&
    r.formOwnCalls === 0, J([r.formCore, r.formDest]));
  A('form_close: a hand-made History row naming another form is refused and touches it not',
    runOf(r.formForged).result === 'refused' && /not the one the action names now/.test(runOf(r.formForged).detail) &&
    r.formForgedCalls === 0, J(runOf(r.formForged)));

  A('mark and unmark append rows in test mode, in any phase',
    runOf(r.mark).act === 'mark' && runOf(r.mark).result === 'ok' && runOf(r.unmark).act === 'unmark' &&
    runOf(r.unmark).detail === 'Reopened.' && runOf(r.markOff).act === 'mark', J([runOf(r.mark), runOf(r.unmark)]));
  A('mark on an unknown action is a 404', r.markMissing.status === 404, J(r.markMissing));

  var named = function (res, field) {
    return res.status === 400 && (res.problems || []).some(function (x) { return x.field === field; });
  };
  A('save: a banner without gid, an unknown handler, a manual row with a handler, a link that is not https and ' +
    'a two-row range are each a 400 that names the field',
    named(r.saveNoGid, 'params.gid') && named(r.saveHandler, 'handler') && named(r.saveManual, 'handler') &&
    named(r.saveLink, 'link') && named(r.saveRows, 'params.range') && r.saveBadCount === 0,
    J([r.saveNoGid, r.saveHandler, r.saveManual, r.saveLink, r.saveRows]));
  A('save: a valid row is added with a slug id, an edit upserts by id, and nothing is deleted',
    r.saveNew.status === 200 && r.saveNew.data.action.id === 'tell_the_office' && r.saveEdit.status === 200 &&
    r.saveCount === 1 && r.saveEdited.title === 'Retired by hand' && r.saveEdited.enabled === 'no' &&
    r.saveEdited.phase === 'at' && r.saveLedger === 2, J([r.saveNew, r.saveEdited]));

  A('def_sha: the pinned fixture hashes to the constant tools/test-production-actions.py asserts',
    r.pin === ST_PA_DEF_SHA_PIN, r.pin);
  A('the handler list is banner, link and form_close, each with plan, rehearse and run',
    PA_HANDLER_IDS.join(',') === 'banner,link,form_close' && PA_HANDLER_IDS.every(function (h) {
      return typeof PA_HANDLERS[h].plan === 'function' && typeof PA_HANDLERS[h].run === 'function' &&
        typeof PA_HANDLERS[h].rehearse === 'function';
    }), J(PA_HANDLER_IDS));
}
