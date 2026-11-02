function renderSheetBust_(tab) {
  var t = String(tab || '');
  if (!t) return;
  try { cacheBump_(cacheScope_(t)); } catch (e) {}
  try {
    if (t === TALENT_CANDIDATES_TAB || t === TALENT_RESUME_TAB ||
        t === TALENT_PHONE_TAB || (typeof INBOUND_TAB !== 'undefined' && t === INBOUND_TAB)) {
      hubBustTalentCache_();
    }
  } catch (e2) {}
}

// NEVER 'users': salts and password hashes live there.
var RENDER_SHEET_TABS = ['entity_candidates', 'entity_phone_screens',
                         'staff_requests', 'finance_transactions', 'travelTrips',
                         'mar_entries',
                         'app_release_log',
                         'projects', 'diseases', 'workOrders',
                         'drAppointments', 'shifts',
                         'comm_intents', 'comm_bindings', 'comm_attempts',
                         'comm_routes', 'smart_comms_sent'];
var RENDER_SHEET_MAX_ROWS = 1000;

// Readable, never typed into: a hand-written ledger row silences or re-arms a reminder with no trace.
var RENDER_SHEET_LEDGER_TABS = ['smart_comms_sent', 'comm_attempts'];

function renderSheetParentId_(sheet) {
  try {
    if (sheet && typeof sheet.getParent === 'function') {
      var book = sheet.getParent();
      if (book && typeof book.getId === 'function') return String(book.getId());
    }
  } catch (e) {}
  return '';
}

// A ledger lives in HUB_DB under its own name, or in its data house under its own name or 'Data'.
function renderSheetLedgerHit_(landed, bookId) {
  var name = str_(landed), id = str_(bookId);
  if (!name || !id) return '';
  var hubDb = '';
  try { hubDb = str_(hubId_('HUB_DB_ID')); } catch (e) { hubDb = ''; }
  var houseTab = (typeof HOUSE_DATA_TAB !== 'undefined') ? String(HOUSE_DATA_TAB) : 'Data';
  var hit = '';
  RENDER_SHEET_LEDGER_TABS.forEach(function (t) {
    if (hit) return;
    if (hubDb && id === hubDb && name === t) { hit = t; return; }
    var house = '';
    try { house = (typeof houseIdFor_ === 'function') ? str_(houseIdFor_(t)) : ''; }
    catch (e2) { house = ''; }
    if (house && id === house && (name === t || name === houseTab)) hit = t;
  });
  return hit;
}

// A built-in key is judged by name; a linked tab by name and workbook, so a stranger's same-named tab passes.
function renderSheetLedgerRefusal_(key, sheet) {
  var name = str_(key);
  var hit = RENDER_SHEET_LEDGER_TABS.indexOf(name) !== -1 ? name : '';
  if (!hit && sheet) {
    var landed = '';
    try { landed = String(sheet.getName()); } catch (e) { landed = ''; }
    hit = renderSheetLedgerHit_(landed, renderSheetParentId_(sheet));
  }
  if (!hit) return null;
  return { status: 403, message: hit + ' is a ledger — only the engine that sends writes it. A row typed ' +
                                 'here would silence or re-arm a real reminder with no trace, so this tab ' +
                                 'is read-only on this screen.' };
}

// A write gate fails closed: an empty render_sheet_edit_badges admits only admins and the master.
function renderSheetCanEdit_(user) {
  if (!user || user.is_service) return false;
  if (String(user.role) === 'admin') return true;
  if (hubIsMaster_(str_(user.email))) return true;
  var cfg = '';
  try {
    cfg = str_((typeof hiringAlerts_ === 'function' ? hiringAlerts_() : {}).render_sheet_edit_badges);
  } catch (e) { cfg = ''; }
  if (!cfg.trim()) return false;
  var mine = (typeof userBadgesWorn_ === 'function')
    ? userBadgesWorn_(user.types, '')
    : userTypesFromRaw_(user.types).types;
  return cfg.split(',').some(function (b) {
    b = b.trim().toUpperCase();
    return !!b && mine.indexOf(b) !== -1;
  });
}

// A runtime-served tab has no display layer, so values stand in.
function renderSheetShown_(range) {
  var grid = (typeof range.getDisplayValues === 'function')
    ? range.getDisplayValues() : range.getValues();
  return (grid || []).map(function (line) {
    return (line || []).map(function (v) { return String(v == null ? '' : v); });
  });
}

function renderSheetShownOne_(range) {
  if (typeof range.getDisplayValue === 'function') return String(range.getDisplayValue());
  var v = range.getValue();
  return String(v == null ? '' : v);
}

function renderSheetHeader_(sheet) {
  return renderSheetShown_(sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())))[0] || [];
}

var RENDER_SHEETS_REG = 'render_sheets';
var RENDER_SHEETS_REG_HEADER = ['id', 'title', 'sheet_id', 'tab_name', 'added_by', 'added_at'];

function renderSheetsRegSheet_() {
  return hubTabEnsure_(RENDER_SHEETS_REG, RENDER_SHEETS_REG_HEADER);
}

// Throws when the registry cannot be read: an unread list is not an empty one.
function renderSheetsRegRows_() {
  var values = renderSheetsRegSheet_().getDataRange().getValues();
  var out = [];
  for (var r = 1; r < values.length; r++) {
    if (!str_(values[r][0])) continue;
    out.push({ id: str_(values[r][0]), title: str_(values[r][1]), sheet_id: str_(values[r][2]),
               tab_name: str_(values[r][3]), added_by: str_(values[r][4]), added_at: str_(values[r][5]) });
  }
  return out;
}

var RENDER_SHEETS_REG_UNREAD = 'The list of linked spreadsheets could not be read.';

function renderSheetIdFromUrl_(v) {
  var s = String(v || '').trim();
  var m = s.match(/\/d\/([-\w]{20,})/);
  if (m) return m[1];
  return /^[-\w]{20,}$/.test(s) ? s : '';
}

var RENDER_SHEET_ESTATE = [
  { key: 'est_uimui', prop: 'ESTATE_UI_ID', tab: 'UIs and MUIs', title: 'Asa | UIs and MUIs' },
  // No est_mar: MAR reads our own mar_entries tab, copied once from the eMAR history.
];

function renderSheetEstateResolve_(key) {
  var hit = null;
  RENDER_SHEET_ESTATE.forEach(function (e) { if (e.key === key) hit = e; });
  if (!hit) return null;
  var id = '';
  try { id = hubId_(hit.prop); } catch (e) { id = ''; }
  if (!id) id = str_(hit.fallbackId);
  if (!id) return { error: { status: 404, message: hit.prop + ' is not set — the workbook is unknown to the platform.' } };
  try {
    var ss = ssOpen_(id);
    var tab = hit.tab ? ss.getSheetByName(hit.tab) : ss.getSheets()[0];
    if (!tab) return { error: { status: 404, message: 'Tab "' + hit.tab + '" is gone from that spreadsheet.' } };
    return { sheet: tab, label: hit.title + (hit.tab ? '!' + hit.tab : '') };
  } catch (e2) {
    return { error: { status: 403, message: 'The platform account cannot open that spreadsheet.' } };
  }
}

function renderSheetResolve_(key) {
  var name = str_(key);
  if (name.indexOf('est_') === 0) {
    return renderSheetEstateResolve_(name) ||
      { error: { status: 400, message: 'That tab is not served here.' } };
  }
  if (name.indexOf('lnk_') !== 0) {
    if (RENDER_SHEET_TABS.indexOf(name) === -1) return { error: { status: 400, message: 'That tab is not served here.' } };
    // Where the tab lives now, never a leftover copy in HUB_DB.
    var tab = hubTabSheet_(name);
    return { sheet: tab, label: name };
  }
  var row = null, reg;
  try { reg = renderSheetsRegRows_(); }
  catch (eReg) { return { error: { status: 503, message: RENDER_SHEETS_REG_UNREAD + ' Try again.' } }; }
  reg.forEach(function (r) { if ('lnk_' + r.id === name) row = r; });
  if (!row) return { error: { status: 404, message: 'That spreadsheet is no longer on the list.' } };
  try {
    var ss = ssOpen_(row.sheet_id);
    var tab2 = row.tab_name ? ss.getSheetByName(row.tab_name) : ss.getSheets()[0];
    if (!tab2) return { error: { status: 404, message: 'Tab "' + row.tab_name + '" is gone from that spreadsheet.' } };
    if (row.sheet_id === hubId_('HUB_DB_ID') && tab2.getName() === 'users') {
      return { error: { status: 403, message: 'That tab is never served here.' } };
    }
    return { sheet: tab2, label: row.title + (row.tab_name ? '!' + row.tab_name : '') };
  } catch (e) {
    return { error: { status: 403, message: 'The platform account cannot open that spreadsheet - share it and try again.' } };
  }
}

HUB_POLICY.renderSheetList = {
  file: 'RenderSheet.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.renderSheetList = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  // FAIL-CLOSED: a sheet the list could not open is alive:false, its 0s unmeasured and uncounted.
  var tabs = RENDER_SHEET_TABS.map(function (name) {
    var rows = 0, cols = 0, alive = false;
    try {
      var sheet = hubTabSheet_(name);
      if (sheet) {
        rows = Math.max(0, sheet.getLastRow() - 1);
        cols = sheet.getLastColumn();
        alive = true;
      }
    } catch (e) { rows = 0; cols = 0; alive = false; }
    // The screen does not read read_only yet: the server's 403 is the whole protection.
    return { key: name, tab: name, source: 'hub', rows: rows, cols: cols, alive: alive,
             read_only: RENDER_SHEET_LEDGER_TABS.indexOf(name) !== -1 };
  });
  RENDER_SHEET_ESTATE.forEach(function (e) {
    var rows = 0, cols = 0, alive = false, readOnly = false;
    try {
      var res = renderSheetEstateResolve_(e.key);
      if (res && res.sheet) {
        rows = Math.max(0, res.sheet.getLastRow() - 1); cols = res.sheet.getLastColumn();
        readOnly = !!renderSheetLedgerRefusal_(e.key, res.sheet);
        alive = true;
      }
    } catch (eE) { rows = 0; cols = 0; alive = false; }
    tabs.push({ key: e.key, tab: e.title + (e.tab ? ' - ' + e.tab : ''),
                source: 'linked', rows: rows, cols: cols, alive: alive,
                read_only: readOnly });
  });
  // FAIL-CLOSED: an unread registry is said (registry_unread), never an empty list of linked sheets.
  var regRows = [], regUnread = false;
  try { regRows = renderSheetsRegRows_(); }
  catch (eReg) { regRows = []; regUnread = true; }
  regRows.forEach(function (r) {
    var rows = 0, cols = 0, alive = false, readOnly = false;
    try {
      var res = renderSheetResolve_('lnk_' + r.id);
      if (res.sheet) {
        rows = Math.max(0, res.sheet.getLastRow() - 1); cols = res.sheet.getLastColumn();
        // Judged on the sheet the write door lands on, not tab_name (empty falls back to the first sheet).
        readOnly = !!renderSheetLedgerRefusal_('lnk_' + r.id, res.sheet);
        alive = true;
      }
    } catch (e) { rows = 0; cols = 0; alive = false; }
    tabs.push({ key: 'lnk_' + r.id, tab: r.title + (r.tab_name ? ' - ' + r.tab_name : ''),
                source: 'linked', rows: rows, cols: cols, alive: alive,
                read_only: readOnly });
  });
  var listed = { tabs: tabs, can_edit: renderSheetCanEdit_(user) };
  if (regUnread) listed.registry_unread = true;
  return { status: 200, data: listed };
};

HUB_POLICY.renderSheetGrid = {
  file: 'RenderSheet.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.renderSheetGrid = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var name = str_(payload && payload.tab);
  var res = renderSheetResolve_(name);
  if (res.error) return res.error;
  var sheet = res.sheet;
  if (!sheet || sheet.getLastRow() < 1) {
    return { status: 200, data: { tab: name, header: [], rows: [], truncated: false } };
  }
  var values = renderSheetShown_(sheet.getDataRange());
  var header = values[0];
  var body = values.slice(1);
  var truncated = body.length > RENDER_SHEET_MAX_ROWS;
  if (truncated) body = body.slice(0, RENDER_SHEET_MAX_ROWS);

  // White and black are dropped: shipping them would paint the replica against the dark theme.
  var colors = { back: [], fore: [], bold: [] };
  try {
    var range = sheet.getDataRange();
    var bg = range.getBackgrounds();
    var fg = range.getFontColors();
    var wt = range.getFontWeights();
    var take = function (grid, blank) {
      var out = [];
      var rowsN = Math.min(grid.length, (truncated ? RENDER_SHEET_MAX_ROWS : body.length) + 1);
      for (var r = 0; r < rowsN; r++) {
        var line = [];
        for (var c = 0; c < grid[r].length; c++) {
          var v = String(grid[r][c] || '').toLowerCase();
          line.push(blank.indexOf(v) === -1 ? v : '');
        }
        out.push(line);
      }
      return out;
    };
    colors.back = take(bg, ['#ffffff', 'white', '']);
    colors.fore = take(fg, ['#000000', 'black', '']);
    colors.bold = take(wt, ['normal', '']);
  } catch (eFmt) { colors = { back: [], fore: [], bold: [] }; }

  var frozen = 1;
  try { frozen = sheet.getFrozenRows(); } catch (eFz) { frozen = 1; }

  return { status: 200, data: { tab: name, header: header, rows: body,
                                truncated: truncated, colors: colors,
                                frozen: frozen } };
};

HUB_POLICY.renderSheetCellSet = {
  file: 'RenderSheet.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.renderSheetCellSet = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  if (!renderSheetCanEdit_(user)) {
    return { status: 403, message: 'Your badge may view these sheets, not edit them.' };
  }
  var name = str_(payload && payload.tab);
  // Asked before the resolve (no read, no tab needed), then again on the sheet actually reached.
  var noLedger = renderSheetLedgerRefusal_(name, null);
  if (noLedger) return noLedger;
  var res = renderSheetResolve_(name);
  if (res.error) return res.error;
  var sheet = res.sheet;
  if (!sheet) return { status: 400, message: 'That tab does not exist yet.' };
  noLedger = renderSheetLedgerRefusal_(name, sheet);
  if (noLedger) return noLedger;
  var name2 = res.label;
  var header = renderSheetHeader_(sheet);
  var colName = String(payload.col == null ? '' : payload.col);
  var colIdx = header.indexOf(colName);
  if (colIdx === -1) return { status: 400, message: 'Unknown column: ' + colName };
  // `row` is the 1-based data row; the header is sheet row 1.
  var row = Math.floor(Number(payload.row));
  if (!(row >= 1) || row > sheet.getLastRow() - 1) {
    return { status: 400, message: 'Row ' + payload.row + ' is out of range.' };
  }
  var cell = sheet.getRange(row + 1, colIdx + 1);
  var current = renderSheetShownOne_(cell);
  var prev = String(payload.prev == null ? '' : payload.prev);
  if (current !== prev) {
    return { status: 409, message: 'The cell changed under you — reload.', data: { current: current } };
  }
  var value = String(payload.value == null ? '' : payload.value);
  // Text format before the value, so nothing coerces.
  cell.setNumberFormat('@');
  cell.setValue(value);
  SpreadsheetApp.flush();
  // The runtime silently drops a write whose row names no subject; never answer 200 for it.
  var after = renderSheetShownOne_(cell);
  if (sheet.isRuntimeBacked && after !== value) {
    return { status: 400, message: 'That row names no subject the runtime can file a change under.' };
  }
  // The only lane where a hiring stage moves without hubSetStatus_, so it must bust the talent cache.
  renderSheetBust_(name);
  var at = (typeof cell.getA1Notation === 'function')
    ? cell.getA1Notation() : ('r' + (row + 1) + 'c' + (colIdx + 1));
  hubSysLog_(str_(user.email), 'renderSheetCellSet', name2 + '!' + at,
             { status: 200, message: current.slice(0, 80) + ' -> ' + value.slice(0, 80) });
  return { status: 200, data: { tab: name, row: row, col: colName, value: after } };
};

HUB_POLICY.renderSheetRowAdd = {
  file: 'RenderSheet.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.renderSheetRowAdd = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  if (!renderSheetCanEdit_(user)) {
    return { status: 403, message: 'Your badge may view these sheets, not edit them.' };
  }
  var name = str_(payload && payload.tab);
  var noLedgerA = renderSheetLedgerRefusal_(name, null);
  if (noLedgerA) return noLedgerA;
  var resA = renderSheetResolve_(name);
  if (resA.error) return resA.error;
  var sheet = resA.sheet;
  if (!sheet) return { status: 400, message: 'That tab does not exist yet.' };
  noLedgerA = renderSheetLedgerRefusal_(name, sheet);
  if (noLedgerA) return noLedgerA;
  var nameA = resA.label;
  var header = renderSheetHeader_(sheet);
  var values = (payload && payload.values) || {};
  var unknown = Object.keys(values).filter(function (k) { return header.indexOf(k) === -1; });
  if (unknown.length) {
    return { status: 400, message: 'Unknown column(s): ' + unknown.join(', ') };
  }
  var arr = header.map(function (h) { return String(values[h] == null ? '' : values[h]); });
  var rowAt = sheet.getLastRow() + 1;
  if (sheet.isRuntimeBacked) {
    sheet.appendRow(arr);
    // The row count is the only place the runtime's silent refusal shows.
    if (sheet.getLastRow() < rowAt) {
      return { status: 400, message: 'That row names no subject the runtime can file it under.' };
    }
  } else {
    var range = sheet.getRange(rowAt, 1, 1, header.length);
    range.setNumberFormat('@');
    range.setValues([arr]);
  }
  SpreadsheetApp.flush();
  renderSheetBust_(nameA);
  hubSysLog_(str_(user.email), 'renderSheetRowAdd', nameA + '!A' + rowAt,
             { status: 200, message: arr.filter(String).slice(0, 3).join(' | ').slice(0, 80) });
  return { status: 200, data: { tab: name, row: rowAt - 1 } };
};

HUB_POLICY.renderSheetAdd = {
  file: 'RenderSheet.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.renderSheetAdd = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  if (!renderSheetCanEdit_(user)) {
    return { status: 403, message: 'Your badge may view these sheets, not manage them.' };
  }
  var sid = renderSheetIdFromUrl_(payload && payload.url);
  if (!sid) return { status: 400, message: 'Paste the spreadsheet link (or its id).' };
  if (sid === hubId_('HUB_DB_ID')) return { status: 400, message: 'The platform database is already on this screen.' };
  var tabName = str_(payload && payload.tab);
  var ss;
  try { ss = ssOpen_(sid); ss.getName(); }
  catch (e) {
    return { status: 403, message: 'The platform account cannot open that spreadsheet - share it with the platform account and try again.' };
  }
  if (tabName && !ss.getSheetByName(tabName)) {
    return { status: 400, message: 'Tab "' + tabName + '" does not exist in that spreadsheet.' };
  }
  var known;
  try { known = renderSheetsRegRows_(); }
  catch (eReg) { return { status: 503, message: RENDER_SHEETS_REG_UNREAD + ' Nothing was added.' }; }
  var dupe = known.some(function (r) { return r.sheet_id === sid && r.tab_name === tabName; });
  if (dupe) return { status: 409, message: 'That spreadsheet is already on the list.' };
  var id = randomHex_(8);
  renderSheetsRegSheet_().appendRow([id, ss.getName(), sid, tabName, str_(user.email), new Date().toISOString()]);
  hubSysLog_(str_(user.email), 'renderSheetAdd', ss.getName() + (tabName ? '!' + tabName : ''), { status: 200, message: sid });
  return { status: 200, data: { id: 'lnk_' + id, title: ss.getName() } };
};

HUB_POLICY.renderSheetRemove = {
  file: 'RenderSheet.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.renderSheetRemove = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  if (!renderSheetCanEdit_(user)) {
    return { status: 403, message: 'Your badge may view these sheets, not manage them.' };
  }
  var id = str_(payload && payload.id).replace(/^lnk_/, '');
  if (!id) return { status: 400, message: 'Which spreadsheet?' };
  var sheet = renderSheetsRegSheet_();
  var values = sheet.getDataRange().getValues();
  for (var r = values.length - 1; r >= 1; r--) {
    if (str_(values[r][0]) === id) {
      hubSysLog_(str_(user.email), 'renderSheetRemove', str_(values[r][1]), { status: 200, message: id });
      sheet.deleteRow(r + 1);
      return { status: 200, data: { removed: true } };
    }
  }
  return { status: 404, message: 'That spreadsheet is no longer on the list.' };
};
