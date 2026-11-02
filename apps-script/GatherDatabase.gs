// Targets are declared (properties, Registry, house facts), never found by a Drive name search.
var GATHER_SOURCE_FOLDER_ID = '1kNOcvchYhIAgItXUlfOjA6Gb7k5KxPJZ'; // ASA Hub - Source
var GATHER_DATA_SUBFOLDER = 'Database';
var GATHER_REPORT_TAB = 'gather_report';
// Drive moves are slow; one run cannot move the whole estate before timing out.
var GATHER_MOVE_BATCH = 60;

var GATHER_REPORT_HEADER = ['file_id', 'name', 'kind', 'from', 'to', 'verdict', 'at'];

// Clinical books never join the gather: Source/Database is shared and copied into the mirror.
var GATHER_KEEP_APART = ['HUB_HOUSE_MED_DISPENSES_ID', 'HUB_HOUSE_MED_PATIENTS_ID'];

function gatherKeptApart_(key, subject) {
  var subj = str_(subject).trim().toUpperCase();
  var k = str_(key).trim().toLowerCase();
  for (var i = 0; i < GATHER_KEEP_APART.length; i++) {
    var p = GATHER_KEEP_APART[i];
    if (subj === p || k === 'config.props.' + p.toLowerCase().replace(/_/g, '')) return true;
  }
  return false;
}

function gatherDestFor_(kind) {
  return kind === 'book' ? 'source' : 'database';
}

// Data is added first, so a file that is also a Registry row is classed as data.
function gatherDatabaseTargets_() {
  var seen = {};
  var out = [];
  var add = function (id, name, kind) {
    id = str_(id).trim();
    if (!id || seen[id]) return;
    seen[id] = true;
    out.push({ id: id, name: str_(name), kind: kind });
  };

  var sys = [
    ['HUB_DB_ID', 'Core'], ['HUB_APPS_RUNTIME_ID', 'Essencial'],
    ['HUB_APPS_BOOK_ID', 'Apps book'], ['HUB_CARE_BOOK_ID', 'Care book'],
    ['HUB_PREFS_ID', 'Prefs'], ['HUB_LOGS_ID', 'Logs'],
    ['HUB_COMMS_ID', 'Comms'], ['HUB_DIRECTORY_ID', 'Directory'],
    ['HUB_GENERIC_CONFIG_ID', 'Generic config']
  ];
  for (var s = 0; s < sys.length; s++) {
    add(hubId_(sys[s][0]), sys[s][1], 'system');
  }

  var houses = {};
  var apart = {};
  try {
    var facts = ssOpen_(hubId_('HUB_APPS_RUNTIME_ID')).getSheetByName('Facts');
    if (facts) {
      var fv = facts.getDataRange().getValues();
      for (var f = 1; f < fv.length; f++) {
        var key = str_(fv[f][0]);
        var subj = str_(fv[f][1]);
        if (!/hubhouse/i.test(key) && !/^HUB_HOUSE_.*_ID$/i.test(subj)) continue;
        if (gatherKeptApart_(key, subj)) { apart[str_(fv[f][2]).trim()] = true; continue; }
        houses[str_(fv[f][2]).trim()] = true;
      }
    }
  } catch (eF) {}
  delete houses[''];
  // a house kept apart is never a target, whatever else names its id
  for (var aid in apart) { if (aid) { seen[aid] = true; delete houses[aid]; } }
  for (var hid in houses) add(hid, '', 'house');

  // Registry rows not 'on' are retired books and stay where they are.
  try {
    var reg = ssOpen_(hubId_('HUB_APPS_RUNTIME_ID')).getSheetByName('Registry');
    if (reg) {
      var rv = reg.getDataRange().getValues();
      var hdr = (rv[0] || []).map(function (c) { return str_(c).trim(); });
      var iId = hdr.indexOf('Spreadsheet ID');
      var iSt = hdr.indexOf('Status');
      var iCx = hdr.indexOf('Context');
      for (var r = 1; r < rv.length; r++) {
        if (iSt !== -1 && str_(rv[r][iSt]).toLowerCase() !== 'on') continue;
        add(rv[r][iId], iCx !== -1 ? rv[r][iCx] : '', 'book');
      }
    }
  } catch (eR) {}

  return out;
}

function gatherSourceFolder_() {
  try {
    var f = DriveApp.getFolderById(GATHER_SOURCE_FOLDER_ID);
    return f.isTrashed() ? null : f;
  } catch (e) { return null; }
}

// The dry run (create=false) must leave the Drive exactly as it found it.
function gatherDataFolder_(create) {
  var source = gatherSourceFolder_();
  if (!source) return null;
  var it = source.getFoldersByName(GATHER_DATA_SUBFOLDER);
  if (it.hasNext()) return it.next();
  return create ? source.createFolder(GATHER_DATA_SUBFOLDER) : null;
}

function gatherReportSheet_() {
  return hubTabEnsure_(GATHER_REPORT_TAB, GATHER_REPORT_HEADER);
}

function gatherParentsOf_(file) {
  var names = [];
  var ps = file.getParents();
  while (ps.hasNext()) names.push(ps.next().getName());
  return names.join(' + ') || '(root)';
}

function gatherReportWrite_(rows) {
  var sheet = gatherReportSheet_();
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, GATHER_REPORT_HEADER.length).clearContent();
  }
  if (!rows.length) return;
  var body = rows.map(function (r) { return r.map(function (c) { return hubCellSafe_(c); }); });
  sheet.getRange(2, 1, body.length, GATHER_REPORT_HEADER.length).setValues(body);
}

function gatherDatabaseRun_(move) {
  var source = gatherSourceFolder_();
  if (!source) return { status: 404, message: 'ASA Hub - Source did not answer at ' + GATHER_SOURCE_FOLDER_ID };
  var data = gatherDataFolder_(move);
  if (move && !data) return { status: 500, message: 'Could not create Source/' + GATHER_DATA_SUBFOLDER };

  var targets = gatherDatabaseTargets_();
  var rows = [], moved = 0, left = 0, failed = 0, home = 0, unreachable = 0;
  var now = new Date().toISOString();

  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    var dest = gatherDestFor_(t.kind) === 'database' ? data : source;
    var destName = gatherDestFor_(t.kind) === 'database'
      ? 'Source/' + GATHER_DATA_SUBFOLDER : 'Source';
    var file = null;
    try { file = DriveApp.getFileById(t.id); } catch (eG) { file = null; }
    if (!file) {
      unreachable++;
      rows.push([t.id, t.name, t.kind, '?', destName, 'unreachable', now]);
      continue;
    }
    var name = file.getName();
    var inside = false;
    if (dest) {
      var ps = file.getParents();
      while (ps.hasNext()) { if (ps.next().getId() === dest.getId()) { inside = true; break; } }
    }
    if (inside) {
      home++;
      rows.push([t.id, name, t.kind, destName, destName, 'already there', now]);
      continue;
    }
    if (!move) {
      rows.push([t.id, name, t.kind, gatherParentsOf_(file), destName, 'would move', now]);
      continue;
    }
    if (moved >= GATHER_MOVE_BATCH) { left++; continue; }
    try {
      file.moveTo(dest);
      moved++;
      rows.push([t.id, name, t.kind, 'moved', destName, 'moved', now]);
    } catch (eM) {
      failed++;
      rows.push([t.id, name, t.kind, gatherParentsOf_(file), destName,
                 'failed: ' + str_((eM && eM.message) || eM), now]);
    }
  }

  gatherReportWrite_(rows);

  var summary = (move ? 'MOVE' : 'DRY') + ': ' + targets.length + ' target(s), ' +
    (move ? moved + ' moved, ' + failed + ' failed, ' + left + ' left to do'
          : rows.length + ' planned') +
    ', ' + home + ' already home, ' + unreachable + ' unreachable';
  try { hubSysLog_('editor', move ? 'gather_database_move' : 'gather_database_dry', summary, { status: 200 }); } catch (eL) {}
  Logger.log(summary);

  return { status: 200, data: {
    dry_run: !move, targets: targets.length, moved: moved, failed: failed,
    left_to_do: left, already_there: home, unreachable: unreachable,
    report: 'tab `' + GATHER_REPORT_TAB + '` in the Core'
  } };
}

/** The gather move as a door the relay or an admin can run: same targets, same batch, same report tab; dry_run plans without moving. */
HUB_POLICY.gatherDatabaseMove = {
  file: 'GatherDatabase.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  params: { dry_run: { type: 'boolean' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.gatherDatabaseMove = function (payload, user) {
  var isMachine = !!(user && user.is_service);
  if (!isMachine && (!user || String(user.role) !== 'admin')) return hubDenied_();
  var dry = !!(payload && (payload.dry_run === true || String(payload.dry_run) === 'true'));
  return gatherDatabaseRun_(!dry);
};

function runGatherDatabase() {
  return gatherDatabaseRun_(false);
}

function runGatherDatabaseMove() {
  return gatherDatabaseRun_(true);
}
