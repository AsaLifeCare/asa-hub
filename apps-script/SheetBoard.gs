var SHEETBOARD_ROOT = 'Task Board Sheet';

// The folder name carries the user id because two people can share a display name.
function sheetBoardFolder_(user) {
  var uid = str_(user && user.id);
  if (!uid) return null;
  var root = null;
  var savedId = str_(hubProp_('SHEETBOARD_ROOT_ID'));
  if (savedId) {
    try { root = DriveApp.getFolderById(savedId); } catch (eById) { root = null; }
  }
  if (!root) {
    var it = DriveApp.getFoldersByName(SHEETBOARD_ROOT);
    root = it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(SHEETBOARD_ROOT);
    try { hubPropSet_('SHEETBOARD_ROOT_ID', root.getId()); } catch (eSet) {}
  }
  var mine = str_(user.display_name || user.email || uid) + ' — ' + uid;
  var f = root.getFoldersByName(mine);
  return f.hasNext() ? f.next() : root.createFolder(mine);
}

// Server-side feature gate that fails closed: no row, no read, no match means one sheet per card.
function sheetBoardMayAddMore_(user) {
  if (!user || user.is_service) return false;
  try { if (typeof hubIsMaster_ === 'function' && hubIsMaster_(str_(user.email))) return true; }
  catch (eM) {}
  var rule = '';
  try {
    var sheet = appBadgeSheet_();
    var values = sheet.getDataRange().getValues();
    var hdr = values[0].map(normKey_);
    var iId = hdr.indexOf('appid'), iB = hdr.indexOf('badges');
    for (var r = 1; r < values.length; r++) {
      if (str_(values[r][iId]) !== 'taskboard-sheet.multipleSheets') continue;
      rule = str_(values[r][iB]);
      break;
    }
  } catch (e) { return false; }
  if (!rule.trim()) return false;
  // The role folds in: staff often carry no badge at all.
  var have = (typeof hubBadgeHaystack_ === 'function')
    ? hubBadgeHaystack_(userTypesFromRaw_(user.types).types.join(','), user.role)
    : String(userTypesFromRaw_(user.types).types.join(',')).toUpperCase();
  return rule.split(',').some(function (b) {
    b = b.trim().toUpperCase();
    return !!b && have.indexOf(b) !== -1;
  });
}

/** Make (or find) the spreadsheet for one card. */
HUB_POLICY.sheetBoardCreate = {
  file: 'SheetBoard.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff', 'client'],
  invalidates: ['sheetTasks'], emits: []
};
// Idempotent: a second press or a relay retry answers the sheet already made.
HUB_ACTIONS.sheetBoardCreate = function (payload, user) {
  var id = str_(payload && payload.id);
  if (!id) return { status: 400, message: 'id is required — the card the sheet belongs to.' };
  if (!user || user.is_service) return hubDenied_();

  var row = requireRow_('sheetTasks', id);
  if (row.error) return row.error;
  // hubOwnedGate_ only covers the generic verbs; a named action checks ownership itself.
  var cfg = RESOURCES.sheetTasks;
  var mine = (typeof hubActingUserId_ === 'function') ? hubActingUserId_(user) : str_(user.id);
  if (hubOwnerOf_(row, cfg) !== mine) {
    return { status: 404, message: 'No card "' + id + '" here.' };
  }

  var existing = str_(row.spreadsheet_id);
  var wantMore = payload && payload.another === true;
  if (existing && !wantMore) {
    return { status: 200, data: { id: id, spreadsheet_id: existing,
                                  spreadsheet_url: str_(row.spreadsheet_url),
                                  spreadsheet_name: str_(row.spreadsheet_name), created: false } };
  }
  if (existing && wantMore && !sheetBoardMayAddMore_(user)) {
    return { status: 403, message: 'This card already has its spreadsheet. More than one per card ' +
                                   'is a feature your badge does not carry.' };
  }

  var folder = sheetBoardFolder_(user);
  if (!folder) return { status: 500, message: 'Could not open your folder in Drive.' };

  var name = str_(row.title) || 'Untitled card';
  if (existing && wantMore) {
    name = name + ' (' + String(new Date().toISOString()).slice(0, 10) + ')';
  }
  var ss;
  try {
    ss = SpreadsheetApp.create(name);
    var file = DriveApp.getFileById(ss.getId());
    folder.addFile(file);
    try { DriveApp.getRootFolder().removeFile(file); } catch (eRm) {}
  } catch (eC) {
    return { status: 502, message: 'Drive refused to make the spreadsheet: ' + str_(eC && eC.message) };
  }

  var fields = { spreadsheet_id: ss.getId(), spreadsheet_url: ss.getUrl(), spreadsheet_name: name };
  var updated = updateRowById_('sheetTasks', { id: id,
    spreadsheet_id: fields.spreadsheet_id,
    spreadsheet_url: fields.spreadsheet_url,
    spreadsheet_name: fields.spreadsheet_name });
  if (updated && updated.error) return updated.error;

  hubSysLog_(str_(user.email), 'sheetboard_create',
             'spreadsheet "' + name + '" for card ' + id, { status: 200 });
  return { status: 200, data: { id: id, spreadsheet_id: fields.spreadsheet_id,
                                spreadsheet_url: fields.spreadsheet_url,
                                spreadsheet_name: name, created: true } };
};

var SHEETBOARD_MAX_ROWS = 500;

// Every door resolves the spreadsheet from the owned card, never from an id the browser sends.
function sheetBoardOpen_(id, user) {
  if (!user || user.is_service) return { error: hubDenied_() };
  var row = requireRow_('sheetTasks', str_(id));
  if (row.error) return { error: row.error };
  var mine = (typeof hubActingUserId_ === 'function') ? hubActingUserId_(user) : str_(user.id);
  if (hubOwnerOf_(row, RESOURCES.sheetTasks) !== mine) {
    return { error: { status: 404, message: 'No card "' + str_(id) + '" here.' } };
  }
  var ssId = str_(row.spreadsheet_id);
  if (!ssId) return { error: { status: 404, message: 'This card has no spreadsheet yet.' } };
  // FAIL-CLOSED: a card field is data its owner can write, so only a workbook the board made, inside the owner's…
  if (!sheetBoardOwnsFile_(ssId, user)) {
    return { error: { status: 404, message: 'This card has no spreadsheet of its own.' } };
  }
  try {
    return { ss: ssOpen_(ssId), row: row };
  } catch (e) {
    return { error: { status: 404, message: 'That spreadsheet is gone from Drive.' } };
  }
}

/** True only when the file sits in the caller's own board folder; any failure answers false. */
function sheetBoardOwnsFile_(ssId, user) {
  try {
    var folder = sheetBoardFolder_(user);
    if (!folder) return false;
    var parents = DriveApp.getFileById(str_(ssId)).getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === folder.getId()) return true;
    }
    return false;
  } catch (e) { return false; }
}

function sheetBoardTab_(ss, name) {
  var t = str_(name) ? ss.getSheetByName(str_(name)) : ss.getSheets()[0];
  return t || ss.getSheets()[0];
}

// Roles stay literal in each policy: emit-resolver-manifest reads policies statically.
HUB_POLICY.sheetBoardGrid = {
  file: 'SheetBoard.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff', 'client'], invalidates: [], emits: []
};
HUB_ACTIONS.sheetBoardGrid = function (payload, user) {
  var open = sheetBoardOpen_(payload && payload.id, user);
  if (open.error) return open.error;
  var tab = sheetBoardTab_(open.ss, payload && payload.tab);
  if (!tab) return { status: 404, message: 'That spreadsheet has no tabs.' };
  var tabs = open.ss.getSheets().map(function (s) { return s.getName(); });
  if (tab.getLastRow() < 1) {
    return { status: 200, data: { tab: tab.getName(), tabs: tabs, header: [], rows: [],
                                  colors: [], truncated: false,
                                  name: str_(open.row.spreadsheet_name), url: str_(open.row.spreadsheet_url) } };
  }
  var values = tab.getDataRange().getDisplayValues();
  var header = values[0].map(function (h) { return String(h); });
  var body = values.slice(1);
  var truncated = body.length > SHEETBOARD_MAX_ROWS;
  if (truncated) body = body.slice(0, SHEETBOARD_MAX_ROWS);
  var colors = [];
  try {
    var rng = tab.getRange(2, 1, Math.max(1, body.length), Math.max(1, header.length));
    colors = rng.getBackgrounds();
  } catch (eC) { colors = []; }
  return { status: 200, data: { tab: tab.getName(), tabs: tabs, header: header, rows: body,
                                colors: colors, truncated: truncated,
                                name: str_(open.row.spreadsheet_name), url: str_(open.row.spreadsheet_url) } };
};

HUB_POLICY.sheetBoardCellSet = {
  file: 'SheetBoard.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff', 'client'], invalidates: [], emits: []
};
HUB_ACTIONS.sheetBoardCellSet = function (payload, user) {
  var open = sheetBoardOpen_(payload && payload.id, user);
  if (open.error) return open.error;
  var tab = sheetBoardTab_(open.ss, payload && payload.tab);
  var r = Number(payload && payload.row);
  var c = Number(payload && payload.col);
  if (!(r >= 1) || !(c >= 1)) return { status: 400, message: 'row and col are 1-based numbers.' };
  tab.getRange(r + 1, c).setValue(str_(payload.value));
  return { status: 200, data: { row: r, col: c, value: tab.getRange(r + 1, c).getDisplayValue() } };
};

HUB_POLICY.sheetBoardRowAdd = {
  file: 'SheetBoard.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff', 'client'], invalidates: [], emits: []
};
HUB_ACTIONS.sheetBoardRowAdd = function (payload, user) {
  var open = sheetBoardOpen_(payload && payload.id, user);
  if (open.error) return open.error;
  var tab = sheetBoardTab_(open.ss, payload && payload.tab);
  tab.appendRow(new Array(Math.max(1, tab.getLastColumn())).fill(''));
  return { status: 200, data: { rows: Math.max(0, tab.getLastRow() - 1) } };
};

HUB_POLICY.sheetBoardRowDelete = {
  file: 'SheetBoard.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff', 'client'], invalidates: [], emits: []
};
HUB_ACTIONS.sheetBoardRowDelete = function (payload, user) {
  var open = sheetBoardOpen_(payload && payload.id, user);
  if (open.error) return open.error;
  var tab = sheetBoardTab_(open.ss, payload && payload.tab);
  var r = Number(payload && payload.row);
  if (!(r >= 1)) return { status: 400, message: 'row is a 1-based number.' };
  // +1: the screen's grid starts below the header row.
  if (r + 1 > tab.getLastRow()) return { status: 400, message: 'There is no row ' + r + '.' };
  tab.deleteRow(r + 1);
  return { status: 200, data: { rows: Math.max(0, tab.getLastRow() - 1) } };
};

HUB_POLICY.sheetBoardColAdd = {
  file: 'SheetBoard.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff', 'client'], invalidates: [], emits: []
};
HUB_ACTIONS.sheetBoardColAdd = function (payload, user) {
  var open = sheetBoardOpen_(payload && payload.id, user);
  if (open.error) return open.error;
  var tab = sheetBoardTab_(open.ss, payload && payload.tab);
  var name = str_(payload && payload.name).slice(0, 80);
  if (!name) return { status: 400, message: 'A column needs a name.' };
  var col = Math.max(1, tab.getLastColumn() + 1);
  if (tab.getMaxColumns() < col) tab.insertColumnsAfter(tab.getMaxColumns(), col - tab.getMaxColumns());
  tab.getRange(1, col).setValue(name);
  return { status: 200, data: { col: col, name: name } };
};

HUB_POLICY.sheetBoardTabAdd = {
  file: 'SheetBoard.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff', 'client'], invalidates: [], emits: []
};
HUB_ACTIONS.sheetBoardTabAdd = function (payload, user) {
  var open = sheetBoardOpen_(payload && payload.id, user);
  if (open.error) return open.error;
  var name = str_(payload && payload.name).slice(0, 80) || 'Sheet';
  if (open.ss.getSheetByName(name)) return { status: 409, message: 'That tab already exists.' };
  open.ss.insertSheet(name);
  return { status: 200, data: { tab: name, tabs: open.ss.getSheets().map(function (s) { return s.getName(); }) } };
};
