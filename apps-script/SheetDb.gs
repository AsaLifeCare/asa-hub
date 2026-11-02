// Configuration: Props.gs wins over the store. Runtime state (scriptPropIsRuntime_): the store wins, the file only seeds.

var HUB_PROPS_FILE = null;    // Props.gs as data — built once per execution
var HUB_ID_CACHE = null;      // the store — one getProperties() per execution

// Must never seed the store: that would re-plant every property on every request.
function hubPropsBoot_() {
  // the first call of doPost and doGet: an acting context and a session left by a warm start die here
  HUB_BE_ANOTHER = null;
  HUB_SESSION_USER = null;
  if (typeof HUB_VIEWER_MEMO !== 'undefined') HUB_VIEWER_MEMO = null;
  return hubPropsCheck_();
}

// The check alone, for a caller already inside a request: it must not reset the request's acting context.
function hubPropsCheck_() {
  try {
    var file = hubPropsFile_();
    if (file && file.HUB_DB_ID) return true;
    if (hubPropsStore_().HUB_DB_ID) return true;
    Logger.log('Props: no HUB_DB_ID in Props.gs or in the store — every screen ' +
               'reading the database will open empty.');
    return false;
  } catch (e) { return false; }
}

// Every value Props.gs would set, without setting one.
function hubPropsFile_() {
  if (HUB_PROPS_FILE) return HUB_PROPS_FILE;
  var map = {};
  try {
    if (typeof propertieService === 'function') {
      if (propertieService.length >= 1) {
        propertieService({
          setProperty: function (k, v) {
            var kk = String(k || '');
            if (kk) map[kk] = (v == null ? '' : String(v));
          }
        });
      } else {
        // No sink argument: calling it would write every property, so parse the source.
        map = hubPropsFromSource_();
      }
    }
  } catch (e) {
    try { map = hubPropsFromSource_(); } catch (e2) { map = {}; }
  }
  HUB_PROPS_FILE = map;
  return map;
}

// A commented-out line means "not set here", never "set to nothing".
function hubPropsFromSource_() {
  var map = {};
  var src = '';
  try { src = String(propertieService); } catch (e) { return map; }
  var lines = src.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/^\s+/, '');
    if (line.indexOf('//') === 0) continue;
    var m = line.match(/setProperty\(\s*'([A-Za-z0-9_]+)'\s*,\s*'((?:\\.|[^'\\])*)'\s*\)/);
    if (!m) continue;
    map[m[1]] = String(m[2]).replace(/\\n/g, '\n').replace(/\\(['\\])/g, '$1');
  }
  return map;
}

function hubPropsStore_() {
  if (!HUB_ID_CACHE) {
    try { HUB_ID_CACHE = PropertiesService.getScriptProperties().getProperties() || {}; }
    catch (e) { HUB_ID_CACHE = {}; }
  }
  return HUB_ID_CACHE;
}

// Never throws: unreadable is ''.
function hubProp_(key) {
  var k = String(key || '');
  if (!k) return '';

  var owned = false;
  try { owned = (typeof scriptPropIsRuntime_ === 'function') && scriptPropIsRuntime_(k); }
  catch (eR) { owned = false; }

  if (owned) {
    // Fresh per key: this execution may have written it after the store was cached.
    var live = '';
    try { live = String(PropertiesService.getScriptProperties().getProperty(k) || ''); }
    catch (e1) { live = ''; }
    if (live) return live;
    var seed = hubPropsFile_()[k];   // store emptied: the file is the seed
    return seed ? String(seed) : '';
  }

  var fromFile = hubPropsFile_()[k];
  if (fromFile) return String(fromFile);
  var fromStore = hubPropsStore_()[k];
  if (fromStore) return String(fromStore);
  // Last resort for when a push overwrote Props.gs and the store lost the id.
  try {
    return (typeof switchboardProp_ === 'function') ? switchboardProp_(k) : '';
  } catch (eL) { return ''; }
}

function hubId_(key) { return hubProp_(key); }

// The only write door (a raw setProperty leaves the cached store stale); for runtime state only.
function hubPropSet_(key, value) {
  var k = String(key || '');
  if (!k) return false;
  try {
    PropertiesService.getScriptProperties().setProperty(k, String(value == null ? '' : value));
    HUB_ID_CACHE = null;
    return true;
  } catch (e) { return false; }
}

function hubPropDelete_(key) {
  var k = String(key || '');
  if (!k) return false;
  try {
    PropertiesService.getScriptProperties().deleteProperty(k);
    HUB_ID_CACHE = null;
    return true;
  } catch (e) { return false; }
}

// --- SheetDB: storage layer ---

// Never repointed to a place's workbook: moving accounts or sessions would stop everyone signing in.
var HUB_CENTRAL_TABS = [
  'users', 'hub_sessions', 'user_prefs',
  // Keyed by place, so it cannot be sharded by place.
  'user_place_profiles',
  'tenants', 'user_worlds', 'platform_members', 'platform_invites',
  'app_badge_access', 'app_tenant_access', 'config_badge_access',
  'apps', 'app_builder', 'hub_resources'
];

function hubTabIsCentral_(tab) {
  return HUB_CENTRAL_TABS.indexOf(String(tab || '')) !== -1;
}

// Headquarters only. An empty property means the tab has not moved and HUB_DB still answers.
var HUB_TAB_HOME = {
  shopper_items: 'HUB_APPS_BOOK_ID',
  shopper_prices: 'HUB_APPS_BOOK_ID',
  meal_profile: 'HUB_APPS_BOOK_ID',
  meal_log: 'HUB_APPS_BOOK_ID',
  learn_skills: 'HUB_APPS_BOOK_ID',
  learn_attempts: 'HUB_APPS_BOOK_ID',
  travel_trips: 'HUB_APPS_BOOK_ID',
  mail: 'HUB_APPS_BOOK_ID',
  helpful_contacts: 'HUB_APPS_BOOK_ID',
  audits: 'HUB_APPS_BOOK_ID',
  equipment: 'HUB_APPS_BOOK_ID',
  expenseReports: 'HUB_APPS_BOOK_ID',
  fleetVehicles: 'HUB_APPS_BOOK_ID',
  inventoryItems: 'HUB_APPS_BOOK_ID',
  leads: 'HUB_APPS_BOOK_ID',
  mileageLogs: 'HUB_APPS_BOOK_ID',
  routes: 'HUB_APPS_BOOK_ID',
  truelink_runs: 'HUB_APPS_BOOK_ID',
  sheet_tasks: 'HUB_APPS_BOOK_ID',
  week_items: 'HUB_APPS_BOOK_ID',
  team_tasks: 'HUB_APPS_BOOK_ID',
  team_projects: 'HUB_APPS_BOOK_ID',
  project_work_items: 'HUB_APPS_BOOK_ID',
  reminders: 'HUB_APPS_BOOK_ID',
  policyAcks: 'HUB_APPS_BOOK_ID',
  finance_config: 'HUB_APPS_BOOK_ID',
  finance_balances: 'HUB_APPS_BOOK_ID',
  notifications: 'HUB_APPS_BOOK_ID',
  staff_notes: 'HUB_APPS_BOOK_ID',
  staff_profile_visits: 'HUB_APPS_BOOK_ID',
  ssa_notes: 'HUB_APPS_BOOK_ID',
  family_notes: 'HUB_APPS_BOOK_ID',
  // Client care data never shares a workbook with the personal apps.
  mealPlans: 'HUB_CARE_BOOK_ID',
  shiftTimeline: 'HUB_CARE_BOOK_ID',
  visits: 'HUB_CARE_BOOK_ID',
  med_catalog: 'HUB_CARE_BOOK_ID',
  client_notes: 'HUB_CARE_BOOK_ID',
  mar_errors: 'HUB_CARE_BOOK_ID',
  missing_medications: 'HUB_CARE_BOOK_ID',
  client_files: 'HUB_CARE_BOOK_ID',
  med_deliveries: 'HUB_CARE_BOOK_ID',
  care_docs: 'HUB_CARE_BOOK_ID',
  billing_claims: 'HUB_CARE_BOOK_ID',
  ist_records: 'HUB_CARE_BOOK_ID',
  house_notes: 'HUB_CARE_BOOK_ID',
  isp_sections: 'HUB_CARE_BOOK_ID',
  incident_reviews: 'HUB_CARE_BOOK_ID',
  client_overrides: 'HUB_CARE_BOOK_ID'
};

// Tabs first written in their declared book, never moved there: hubTabEnsure_ may create these, and only in that book.
var HUB_TAB_BORN_HOME = ['house_notes', 'isp_sections', 'incident_reviews', 'staff_notes', 'staff_profile_visits',
                         'ssa_notes', 'family_notes', 'client_overrides'];

function hubTabHomeId_(tab) {
  var key = HUB_TAB_HOME[String(tab || '')];
  if (!key) return '';
  try { return str_(hubProp_(key)); } catch (e) { return ''; }
}

// '' until tenantEnsure gives the place a book; '' must keep the headquarters behaviour.
function tenantSpreadsheetId_() {
  if (typeof hubAwayTenant_ !== 'function' || !hubAwayTenant_()) return '';
  var here = hubTenantId_();
  var rows = tenantsRows_();
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].tenantid) === here) return str_(rows[i].spreadsheetid);
  }
  return '';
}

// Order matters: world, then central tabs, then the place's book, then the tab's home, then HUB_DB.
function hubDb_(tab) {
  if (typeof HUB_WORLD_CTX !== 'undefined' && HUB_WORLD_CTX) {
    return ssOpen_(HUB_WORLD_CTX.ssId);
  }
  if (hubTabIsCentral_(tab)) return ssOpen_(hubId_('HUB_DB_ID'));
  var sid = tenantSpreadsheetId_();
  if (sid) return ssOpen_(sid);
  var home = hubTabHomeId_(tab);
  return ssOpen_(home || hubId_('HUB_DB_ID'));
}

// Called bare it means "this place's book".
function getSpreadsheet_(tab) {
  return hubDb_(tab);
}

// In a world the resource name is the tab name.
function tabFor_(resource) {
  if (typeof HUB_WORLD_CTX !== 'undefined' && HUB_WORLD_CTX) return String(resource);
  return RESOURCES[resource].sheet;
}

// The cache is shared: qualify by the answering workbook; headquarters and central tabs keep the bare name.
function cacheScope_(tab) {
  if (typeof HUB_WORLD_CTX !== 'undefined' && HUB_WORLD_CTX) {
    return 'w_' + String(HUB_WORLD_CTX.ssId).slice(0, 8) + '_' + tab;
  }
  if (!hubTabIsCentral_(tab)) {
    var sid = tenantSpreadsheetId_();
    if (sid) return 't_' + String(sid).slice(0, 8) + '_' + tab;
  }
  return tab;
}

// Routing belongs to TabRouter.gs alone; never create a missing tab in HUB_DB directly.
function sheetFor_(resource) {
  return hubTabEnsure_(tabFor_(resource), ['id', 'createdAt', 'updatedAt']);
}

function headerOf_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(String).filter(function (h) { return h !== ''; });
}

// Appends missing columns only; never reorders or re-stamps.
function ensureHeader_(sheet, keys) {
  var header = headerOf_(sheet);
  var missing = keys.filter(function (k) { return header.indexOf(k) === -1; });
  if (missing.length > 0) {
    header = header.concat(missing);
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
  }
  return header;
}

// A Date off a CELL → the text that cell means.
function cellText_(value) {
  if (!(value instanceof Date) || isNaN(value.getTime())) return null;
  var y = value.getUTCFullYear();
  var h = value.getUTCHours(), mi = value.getUTCMinutes(), s = value.getUTCSeconds();
  if (y < 1900) {
    var ap = h >= 12 ? 'PM' : 'AM', hh = h % 12; if (hh === 0) hh = 12;
    return hh + ':' + cellPad2_(mi) + ':' + cellPad2_(s) + ' ' + ap;
  }
  if (h === 0 && mi === 0 && s === 0 && value.getUTCMilliseconds() === 0) {
    return y + '-' + cellPad2_(value.getUTCMonth() + 1) + '-' + cellPad2_(value.getUTCDate());
  }
  return value.toISOString();
}

function cellPad2_(n) { return n < 10 ? '0' + n : String(n); }

/** Serializes a value for a cell: objects/arrays → JSON strings. */
function serialize_(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return cellText_(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

// Deserializes a cell value: dates/times become their own text, JSON-looking strings are parsed.
function deserialize_(value) {
  if (value instanceof Date) return cellText_(value);
  if (typeof value === 'string') {
    var t = value.trim();
    if ((t.charAt(0) === '{' || t.charAt(0) === '[') && t.length > 1) {
      try { return JSON.parse(t); } catch (err) { /* plain string */ }
    }
  }
  return value;
}

/** Generic read: every non-empty row → a plain object keyed by the header. */
function readAll_(sheet) {
  // OBSERVED, NOT DECLARED (Cache.gs).
  try { depNote_(sheet.getParent().getId(), sheet.getName()); } catch (eDep) {}
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0].map(String);
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var line = values[r];
    var empty = line.every(function (c) { return c === '' || c === null; });
    if (empty) continue;
    var obj = {};
    for (var c = 0; c < header.length; c++) {
      if (header[c] === '') continue;
      obj[header[c]] = deserialize_(line[c]);
    }
    rows.push(obj);
  }
  return rows;
}

/** Finds the 1-based sheet row index for a record id (0 when not found). */
function findRowIndex_(sheet, id) {
  if (id === undefined || id === null || id === '') return 0;
  var header = headerOf_(sheet);
  var idCol = header.indexOf('id');
  if (idCol === -1) return 0;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var ids = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  var needle = String(id);
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === needle) return i + 2;
  }
  return 0;
}

// ------------------------------------------------------------------ CRUD operations…

// list — returns rows newest-relevant order preserved, with optional: q full-text-ish filter (case-insensitive…
function listRows_(resource, params) {
  // The whole tab, read once and held until something writes it (Cache.gs).
  var tab = tabFor_(resource);
  var rows = cacheRead_(cacheScope_(tab), 'rows', function () { return readAll_(sheetFor_(resource)); });

  var q = (params.q === undefined || params.q === null ? '' : String(params.q)).trim().toLowerCase();
  if (q !== '') {
    rows = rows.filter(function (row) {
      return Object.keys(row).some(function (key) {
        var v = row[key];
        if (v === null || v === undefined) return false;
        var s = (typeof v === 'object') ? JSON.stringify(v) : String(v);
        return s.toLowerCase().indexOf(q) !== -1;
      });
    });
  }

  var offset = parseInt(params.offset, 10);
  if (isNaN(offset) || offset < 0) offset = 0;
  var limit = parseInt(params.limit, 10);
  if (isNaN(limit) || limit < 0) return rows.slice(offset);
  return rows.slice(offset, offset + limit);
}

/** get — fetches one record; returns { error: envelope } when id is bad/missing. */
function requireRow_(resource, id) {
  if (id === undefined || id === null || id === '') {
    return { error: { status: 400, message: 'Missing required "id" in payload.' } };
  }
  var sheet = sheetFor_(resource);
  var rowIndex = findRowIndex_(sheet, id);
  if (rowIndex === 0) {
    return { error: { status: 404, message: 'No "' + resource + '" record with id "' + id + '".' } };
  }
  var header = headerOf_(sheet);
  var line = sheet.getRange(rowIndex, 1, 1, header.length).getValues()[0];
  var obj = {};
  header.forEach(function (h, i) { obj[h] = deserialize_(line[i]); });
  return obj;
}

// create — assigns `id` (Utilities.getUuid()) and `createdAt`/`updatedAt` ISO timestamps when the payload does not…
function cacheBumpAfterWrite_(resource) {
  try {
    cacheBump_(cacheScope_(tabFor_(resource)));
  } catch (e) { /* the write already succeeded — a failed bump is a slow read */ }
}

// THE WIDEST DOOR ON THE PLATFORM, AND IT NEVER ASKED THE SWITCH.
function sheetDbGateHolds_(resource, act) {
  if (typeof hubGateHolds_ !== 'function') return null;
  var gate = hubGateHolds_('gate_book_write_funnel', {
    subject: act + ' on ' + String(resource || 'a resource'),
    body: 'a write into the live "' + String(resource || '') + '" book was held',
    purpose: 'a book write this platform gated'
  });
  if (!gate.held) return null;
  return { error: { status: 409, message: gate.why } };
}

// THE REFUSAL A WRITE ANSWERED — its { status, message }, or null when it landed.
function sheetDbRefused_(res) {
  return (res && typeof res === 'object' && res.error && res.error.status) ? res.error : null;
}

function createRow_(resource, payload) {
  var createHeld = sheetDbGateHolds_(resource, 'create');
  if (createHeld) return createHeld;
  cacheBump_(cacheScope_(tabFor_(resource)));
  var record = {};
  for (var k in payload) record[k] = payload[k];
  var now = new Date().toISOString();
  if (!record.id) record.id = Utilities.getUuid();
  if (!record.createdAt) record.createdAt = now;
  record.updatedAt = now;

  var sheet = sheetFor_(resource);
  var header = ensureHeader_(sheet, Object.keys(record));
  var line = header.map(function (h) { return serialize_(record[h]); });
  var before = sheet.isRuntimeBacked ? sheet.getLastRow() : -1;
  sheet.appendRow(line);
  // A RUNTIME-BACKED APPEND CAN REFUSE.
  if (before !== -1 && sheet.getLastRow() === before) {
    return { error: { status: 422, message: 'The "' + resource + '" runtime store files rows ' +
                                            'against a subject, and this payload names none.' } };
  }
  cacheBumpAfterWrite_(resource);
  return record;
}

// update — merges `payload` into the record identified by `payload.id`, refreshes `updatedAt`, and returns the…
function updateRowById_(resource, payload) {
  var updateHeld = sheetDbGateHolds_(resource, 'update');
  if (updateHeld) return updateHeld;
  cacheBump_(cacheScope_(tabFor_(resource)));
  if (!payload || payload.id === undefined || payload.id === '') {
    return { error: { status: 400, message: 'Missing required "id" in payload.' } };
  }
  var sheet = sheetFor_(resource);
  var rowIndex = findRowIndex_(sheet, payload.id);
  if (rowIndex === 0) {
    return { error: { status: 404, message: 'No "' + resource + '" record with id "' + payload.id + '".' } };
  }

  // Merge: existing row ← payload patch.
  var existing = requireRow_(resource, payload.id);
  var merged = {};
  for (var k1 in existing) merged[k1] = existing[k1];
  for (var k2 in payload) {
    if (k2 === 'createdAt') continue; // createdAt is immutable
    merged[k2] = payload[k2];
  }
  merged.updatedAt = new Date().toISOString();

  var header = ensureHeader_(sheet, Object.keys(merged));
  var line = header.map(function (h) { return serialize_(merged[h]); });
  sheet.getRange(rowIndex, 1, 1, header.length).setValues([line]);
  cacheBumpAfterWrite_(resource);
  return merged;
}

/** delete — removes the row for `id`; returns { error } when not found. */
function deleteRowById_(resource, id) {
  var deleteHeld = sheetDbGateHolds_(resource, 'delete');
  if (deleteHeld) return deleteHeld;
  cacheBump_(cacheScope_(tabFor_(resource)));
  if (id === undefined || id === null || id === '') {
    return { error: { status: 400, message: 'Missing required "id" in payload.' } };
  }
  var sheet = sheetFor_(resource);
  var rowIndex = findRowIndex_(sheet, id);
  if (rowIndex === 0) {
    return { error: { status: 404, message: 'No "' + resource + '" record with id "' + id + '".' } };
  }
  sheet.deleteRow(rowIndex);
  cacheBumpAfterWrite_(resource);
  return {};
}
