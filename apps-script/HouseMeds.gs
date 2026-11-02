// ------------------------------------------------------------------ HOUSE MEDS — the pharmacy's reports, copied…
// This door writes three houses and nothing else: med_imports the ledger (no names, no drugs) med_dispenses every…

var HOUSE_MEDS_TABS = ['med_imports', 'med_dispenses', 'med_patients'];
var HOUSE_MEDS_IMMUTABLE = { med_dispenses: true };
var HOUSE_MEDS_MAX_ROWS = 1000;
var HOUSE_MEDS_CLAIM_KEY = 'house_meds_running';
var HOUSE_MEDS_CLAIM_S = 5 * 60;

function houseMedsStr_(v) { return String(v == null ? '' : v).trim(); }

/** The house's sheet by its depot pointer — the moved switch not required. */
function houseMedsSheet_(tab) {
  var id = houseIdFor_(tab);
  if (!id) return null;
  var book = ssOpen_(id);
  if (!book) return null;
  return book.getSheetByName(tab) || book.getSheetByName(HOUSE_DATA_TAB) || null;
}

/** A cell as the text it means: a Date as its day, a number as written. */
function houseMedsCellText_(v, tz) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, tz || 'UTC', 'yyyy-MM-dd');
  }
  return String(v).trim();
}

/** One tab: {present, written, updated, conflicts, why}. */
function houseMedsUpsertTab_(tab, part) {
  var out = { present: 0, written: 0, updated: 0, conflicts: 0, why: '' };
  var header = (part && part.header) || [];
  var rows = (part && part.rows) || [];
  if (!header.length || header[0] !== 'id') { out.why = tab + ': no header led by id'; return out; }
  if (rows.length > HOUSE_MEDS_MAX_ROWS) { out.why = tab + ': more than ' + HOUSE_MEDS_MAX_ROWS + ' rows'; return out; }
  var sheet = houseMedsSheet_(tab);
  if (!sheet) { out.why = tab + ': the house is not declared — run tools/mint_house_meds_houses.py'; return out; }
  var live = ensureHeader_(sheet, header);
  var width = live.length;
  sheet.getRange(1, 1, sheet.getMaxRows(), width).setNumberFormat('@');
  var tz = sheet.getParent().getSpreadsheetTimeZone();
  var values = sheet.getDataRange().getValues();
  var at = {};
  for (var r = 1; r < values.length; r++) {
    var id = houseMedsCellText_(values[r][0], tz);
    if (id && !at.hasOwnProperty(id)) at[id] = r;
  }
  var col = {};
  for (var h = 0; h < live.length; h++) col[String(live[h])] = h;
  var appends = [];
  for (var i = 0; i < rows.length; i++) {
    var sent = rows[i] || [];
    var line = [];
    for (var c = 0; c < width; c++) line.push('');
    for (var k = 0; k < header.length; k++) {
      if (col.hasOwnProperty(header[k])) line[col[header[k]]] = houseMedsStr_(sent[k]);
    }
    var sid = line[0];
    if (!sid) continue;
    if (!at.hasOwnProperty(sid)) { appends.push(line); at[sid] = -1; continue; }
    if (at[sid] === -1) { out.present++; continue; }
    var have = values[at[sid]];
    var same = true;
    for (var x = 0; x < header.length; x++) {
      var ci = col[header[x]];
      if (houseMedsCellText_(have[ci], tz) !== houseMedsStr_(sent[x])) { same = false; break; }
    }
    if (same) { out.present++; continue; }
    if (HOUSE_MEDS_IMMUTABLE[tab]) { out.conflicts++; continue; }
    var patch = [line];
    laneMirrorSafeRows_(patch);
    sheet.getRange(at[sid] + 1, 1, 1, width).setValues(patch);
    out.updated++;
    out.present++;
  }
  if (appends.length) {
    laneMirrorSafeRows_(appends);
    var start = Math.max(sheet.getLastRow(), 1) + 1;
    if (sheet.getMaxRows() < start + appends.length - 1) {
      sheet.insertRowsAfter(sheet.getMaxRows(), start + appends.length - 1 - sheet.getMaxRows());
    }
    var range = sheet.getRange(start, 1, appends.length, width);
    range.setNumberFormat('@');
    range.setValues(appends);
    out.written += appends.length;
    out.present += appends.length;
  }
  return out;
}

HUB_POLICY.houseMedsIngest = {
  file: 'HouseMeds.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  params: { tabs: { required: true, type: 'object' } },
  roles: [], service: true,
  invalidates: [], emits: []
};
HUB_ACTIONS.houseMedsIngest = function (payload, user) {
  if (!user || !user.is_service) return hubDenied_();
  var tabs = (payload && payload.tabs) || {};
  var claim = null, mine = false, lock = null;
  try { claim = CacheService.getScriptCache(); } catch (eC) { claim = null; }
  try { lock = LockService.getScriptLock(); } catch (eL) { lock = null; }
  if (lock && lock.tryLock(2000)) {
    try {
      var running = null;
      try { running = claim && claim.get(HOUSE_MEDS_CLAIM_KEY); } catch (eG) { running = null; }
      if (!running) {
        mine = true;
        try { if (claim) claim.put(HOUSE_MEDS_CLAIM_KEY, String(new Date().getTime()), HOUSE_MEDS_CLAIM_S); }
        catch (eP) { /* the pass still runs */ }
      }
    } finally {
      try { lock.releaseLock(); } catch (eR) { /* gone with the execution */ }
    }
  } else if (!lock) {
    mine = true;
  }
  if (!mine) return { status: 409, message: 'The house copy is already being written.' };
  try {
    var present = {}, written = {}, conflicts = {}, why = [];
    for (var t = 0; t < HOUSE_MEDS_TABS.length; t++) {
      var tab = HOUSE_MEDS_TABS[t];
      if (!tabs[tab]) continue;
      var res = houseMedsUpsertTab_(tab, tabs[tab]);
      present[tab] = res.present;
      written[tab] = res.written + res.updated;
      conflicts[tab] = res.conflicts;
      if (res.why) why.push(res.why);
    }
    try {
      hubSysLog_('asa-hub:house-meds', 'house_meds_ingested',
                 JSON.stringify({ present: present, conflicts: conflicts }), { status: 200 });
    } catch (eS) { /* the rows are the record */ }
    return { status: 200, data: { complete: !why.length, present: present, written: written,
                                  conflicts: conflicts, why: why.join('; ') } };
  } finally {
    if (mine && claim) {
      try { claim.remove(HOUSE_MEDS_CLAIM_KEY); } catch (eX) { /* expires on its own */ }
    }
  }
};
