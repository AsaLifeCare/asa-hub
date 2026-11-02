// An unreadable or empty group falls back to MedDel.gs: absence or an illegible cell never cancels a renewal.

var MEDDEL_CATALOG_TAB = 'meddel_catalog';

// Mirrored by tools/mint_meddel_catalog_house.py; the two must not drift.
var MEDDEL_CATALOG_HEADER = [
  'id', 'createdAt', 'updatedAt',
  'kind', 'name', 'value', 'label', 'enabled', 'note'
];

var MEDDEL_CATALOG_KINDS = { setting: 1, level: 1, active_status: 1 };

// The PII floor, not configurable: guards both the read column (`value`) and the write-back header (`label`).
var MEDDEL_CATALOG_FORBIDDEN =
  /(ssn|social[_ ]?sec|date[_ ]?of[_ ]?birth|\bdob\b|birth[_ ]?date|password|passwd|\bpwd\b|\blogin\b|username|\bpin\b)/i;

var MEDDEL_CATALOG_COLUMN = /^[a-z][a-z0-9_]{0,62}$/;

// A write-back header must be shipped or read like an expiration column; anything else is refused.
var MEDDEL_CATALOG_HEADER_OK = /(expir|\bexp\b|renew)/i;

var MEDDEL_CATALOG_CACHE_KEY = 'meddel_catalog_v1';

// Never `{ok: true, rows: []}` on a failure; hubTabSheet_ never creates a missing tab.
function medDelCatalogRows_() {
  var sheet = null;
  try {
    if (typeof hubTabSheet_ !== 'function') {
      return { ok: false, why: 'the tab router is not available in this execution', rows: [] };
    }
    sheet = hubTabSheet_(MEDDEL_CATALOG_TAB);
  } catch (e) {
    return { ok: false, rows: [],
             why: 'the catalogue house could not be opened: ' + String((e && e.message) || e) };
  }
  if (!sheet) {
    return { ok: false, rows: [],
             why: 'no workbook answers for `' + MEDDEL_CATALOG_TAB + '` — the house is not ' +
                  'minted yet, or its pointer HUB_HOUSE_MEDDEL_CATALOG_ID is missing' };
  }
  var values = null;
  try { values = sheet.getDataRange().getValues(); }
  catch (e2) {
    return { ok: false, rows: [],
             why: 'the catalogue could not be read: ' + String((e2 && e2.message) || e2) };
  }
  if (!values || !values.length) {
    return { ok: false, rows: [], why: 'the catalogue sheet has no header row' };
  }
  var hdr = values[0].map(function (h) { return String(h == null ? '' : h).trim(); });
  if (hdr.indexOf('kind') === -1 || hdr.indexOf('name') === -1) {
    return { ok: false, rows: [],
             why: 'the catalogue header has no `kind`/`name` columns — it is not the catalogue' };
  }
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = {};
    for (var c = 0; c < hdr.length; c++) {
      if (!hdr[c]) continue;
      var v = values[r][c];
      // HUB DB runs on Etc/GMT: cellText_, never toISOString.
      if (v instanceof Date && typeof cellText_ === 'function') v = cellText_(v);
      row[hdr[c]] = String(v == null ? '' : v).trim();
    }
    if (!row.kind && !row.name) continue;
    rows.push(row);
  }
  return { ok: true, why: '', rows: rows };
}

// '?' is not 'off': an unrecognised word leaves the row on, or a tick would cancel renewals.
function medDelCatalogSwitch_(value) {
  var s = String(value == null ? '' : value).trim().toLowerCase();
  if (!s) return 'on';
  if (s === 'yes' || s === 'y' || s === 'on' || s === 'true' || s === '1' || s === 'enabled') {
    return 'on';
  }
  if (s === 'no' || s === 'n' || s === 'off' || s === 'false' || s === '0' || s === 'disabled') {
    return 'off';
  }
  return '?';
}

// Pure (the self-test runs it); resolved per group, never all-or-nothing.
function medDelCatalogBuild_(read, legacy) {
  var shippedLevels = (typeof MEDDEL_LEVELS !== 'undefined') ? MEDDEL_LEVELS : [];
  var shippedColumns = (typeof MEDDEL_LEVEL_COLUMNS !== 'undefined') ? MEDDEL_LEVEL_COLUMNS : {};
  var shippedHeaders = (typeof MEDDEL_LEVEL_HEADERS !== 'undefined') ? MEDDEL_LEVEL_HEADERS : {};
  var shippedStatuses = (typeof MEDDEL_ACTIVE_STATUSES !== 'undefined') ? MEDDEL_ACTIVE_STATUSES : {};
  var shippedFields = (typeof MEDDEL_MASTER_FIELDS !== 'undefined') ? MEDDEL_MASTER_FIELDS : [];

  var out = {
    ok: !!(read && read.ok),
    why: (read && read.why) ? String(read.why) : '',
    source: 'code',
    groups: { settings: 'code', levels: 'code', statuses: 'code' },
    refused: [],
    settings: null,
    levels: [], levelColumns: {}, levelHeaders: {},
    activeStatuses: {}, masterFields: []
  };

  // Precedence: shipped defaults < legacy medDelConfig row < catalogue.
  var saved = {};
  var k;
  if (legacy && typeof legacy === 'object') for (k in legacy) saved[k] = legacy[k];
  var settingRows = 0;

  var rows = (read && read.ok && read.rows) ? read.rows : [];
  var levels = [], columns = {}, headers = {}, statuses = {};
  var levelRows = 0, statusRows = 0;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i] || {};
    var kind = String(row.kind || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    var name = String(row.name || '').trim();
    if (!kind || !name) continue;
    if (!MEDDEL_CATALOG_KINDS[kind]) {
      out.refused.push('row "' + name + '": unknown kind "' + kind + '"');
      continue;
    }
    var sw = medDelCatalogSwitch_(row.enabled);
    if (sw === '?') {
      out.refused.push('row "' + name + '": "' + String(row.enabled).trim() + '" in `enabled` is ' +
                       'neither yes nor no — the row was left ON, because a cell nobody can read ' +
                       'must never be the thing that switches something off');
    }
    var on = sw !== 'off';

    if (kind === 'setting') {
      settingRows++;
      // A setting switched off means "use the shipped default".
      if (on) saved[name] = row.value;
      continue;
    }

    if (kind === 'active_status') {
      statusRows++;
      if (!on) continue;
      statuses[String(name).trim().toLowerCase()] = 1;
      continue;
    }

    levelRows++;
    if (!on) continue;
    var column = String(row.value || '').trim().toLowerCase();
    var header = String(row.label || '').trim();
    var shippedHeader = String(shippedHeaders[name] || '');
    if (column && MEDDEL_CATALOG_FORBIDDEN.test(column)) {
      out.refused.push('level "' + name + '": the column "' + column + '" names protected ' +
                       'employee data and was refused');
      column = '';
    } else if (column && !MEDDEL_CATALOG_COLUMN.test(column)) {
      out.refused.push('level "' + name + '": "' + row.value + '" is not a Master column name');
      column = '';
    }
    // Phase 5 writes a date under this header on the employee Master: the same floor applies.
    if (header && MEDDEL_CATALOG_FORBIDDEN.test(header)) {
      out.refused.push('level "' + name + '": the write-back header "' + header + '" names ' +
                       'protected employee data and was refused — nothing is ever written there');
      header = '';
    } else if (header && header !== shippedHeader && !MEDDEL_CATALOG_HEADER_OK.test(header)) {
      out.refused.push('level "' + name + '": "' + header + '" does not read like an expiration ' +
                       'column on the Master, so the renewed date is not written under it');
      header = '';
    }
    if (!column) column = String(shippedColumns[name] || '');
    if (!column) {
      out.refused.push('level "' + name + '": no usable Master column — the level was skipped');
      continue;
    }
    if (!header) header = shippedHeader;
    // Still detected without a header; never fall back to `name` as a write target.
    if (!header) {
      out.refused.push('level "' + name + '": no Master header to write the renewed date back ' +
                       'under — fill in `label` with that column\'s header on the Master');
    }
    if (levels.indexOf(name) === -1) levels.push(name);
    columns[name] = column;
    headers[name] = header;
  }

  out.settings = (typeof medDelConfigMerge_ === 'function')
    ? medDelConfigMerge_(saved) : saved;
  if (read && read.ok && settingRows) out.groups.settings = 'sheet';

  if (read && read.ok && levelRows && levels.length) {
    out.levels = levels;
    out.levelColumns = columns;
    out.levelHeaders = headers;
    out.groups.levels = 'sheet';
  } else {
    if (read && read.ok && levelRows && !levels.length) {
      out.refused.push('every level row was switched off or unusable — the shipped levels stand');
    }
    out.levels = shippedLevels.slice();
    out.levelColumns = {};
    out.levelHeaders = {};
    for (k in shippedColumns) out.levelColumns[k] = shippedColumns[k];
    for (k in shippedHeaders) out.levelHeaders[k] = shippedHeaders[k];
  }

  // A union: flows already in flight for a level switched off still need their write-back header.
  for (k in shippedHeaders) {
    if (!out.levelHeaders[k]) out.levelHeaders[k] = shippedHeaders[k];
  }

  // An empty status set would read everyone as inactive and cancel every open flow.
  if (read && read.ok && statusRows && !medDelCatalogEmpty_(statuses)) {
    out.activeStatuses = statuses;
    out.groups.statuses = 'sheet';
  } else {
    if (read && read.ok && statusRows) {
      out.refused.push('every employment status row was switched off — the shipped statuses ' +
                       'stand, because an empty list would cancel every open renewal');
    }
    for (k in shippedStatuses) out.activeStatuses[k] = shippedStatuses[k];
  }

  // The shipped whitelist is the PII boundary; the catalogue may only add its levels' expiry columns.
  var fields = [], seen = {};
  for (var f = 0; f < shippedFields.length; f++) {
    if (seen[shippedFields[f]]) continue;
    seen[shippedFields[f]] = 1;
    fields.push(shippedFields[f]);
  }
  for (var lv = 0; lv < out.levels.length; lv++) {
    var col = String(out.levelColumns[out.levels[lv]] || '');
    if (!col || seen[col] || MEDDEL_CATALOG_FORBIDDEN.test(col)) continue;
    seen[col] = 1;
    fields.push(col);
  }
  out.masterFields = fields;

  if (out.groups.settings === 'sheet' || out.groups.levels === 'sheet' ||
      out.groups.statuses === 'sheet') {
    out.source = (out.groups.settings === 'sheet' && out.groups.levels === 'sheet' &&
                  out.groups.statuses === 'sheet') ? 'sheet' : 'mixed';
  }
  if (!out.why && read && read.ok &&
      (out.groups.levels === 'code' || out.groups.statuses === 'code' ||
       out.groups.settings === 'code')) {
    out.why = 'the catalogue was read but some of it is not filled in — ' +
              'settings: ' + out.groups.settings + ', levels: ' + out.groups.levels +
              ', employment statuses: ' + out.groups.statuses;
  }
  return out;
}

function medDelCatalogEmpty_(obj) {
  for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) return false; }
  return true;
}

var MEDDEL_CATALOG_MEMO = null;
var MEDDEL_CATALOG_SAID = false;

// Scoped per world/place (the cache is shared); computed per call, never at load time.
function medDelCatalogKey_() {
  try {
    if (typeof cacheScope_ === 'function') {
      return MEDDEL_CATALOG_CACHE_KEY + '_' + cacheScope_(MEDDEL_CATALOG_TAB);
    }
  } catch (e) { }
  return MEDDEL_CATALOG_CACHE_KEY;
}

function medDelCatalogLegacy_() {
  var saved = null;
  try {
    listRows_('financeConfig', {}).forEach(function (r) {
      if (str_(r.key) !== MEDDEL_CONFIG_KEY) return;
      try { saved = JSON.parse(str_(r.value) || '{}'); }
      catch (e) {
        if (typeof hubSysLog_ === 'function') {
          hubSysLog_('asa-hub:meddel', 'meddel_config_bad_json',
                     'the medDelConfig row is not valid JSON — the catalogue and the ' +
                     'defaults are in force', { status: 500 });
        }
        saved = null;
      }
    });
  } catch (e2) { }
  return saved;
}

// A failed read is never cached: the next execution asks the sheet again.
function medDelCatalog_() {
  if (MEDDEL_CATALOG_MEMO) return MEDDEL_CATALOG_MEMO;
  var key = medDelCatalogKey_();
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (eC) { cache = null; }
  if (cache) {
    var hit = null;
    try { hit = cache.get(key); } catch (eG) { hit = null; }
    if (hit) {
      try {
        MEDDEL_CATALOG_MEMO = JSON.parse(hit);
        return MEDDEL_CATALOG_MEMO;
      } catch (eP) { }
    }
  }
  var built = medDelCatalogBuild_(medDelCatalogRows_(), medDelCatalogLegacy_());
  if (built.ok && cache) {
    try { cache.put(key, JSON.stringify(built), 60); }
    catch (eU) { }
  }
  if (!built.ok) medDelCatalogSay_(built);
  MEDDEL_CATALOG_MEMO = built;
  return built;
}

// Once per execution: a sweep reaches this once per flow.
function medDelCatalogSay_(cat) {
  if (MEDDEL_CATALOG_SAID) return;
  MEDDEL_CATALOG_SAID = true;
  try {
    if (typeof hubSysLog_ !== 'function') return;
    hubSysLog_('asa-hub:meddel', 'meddel_catalog_unreadable',
               (cat && cat.why) || 'the med del catalogue could not be read',
               { status: 500,
                 message: 'the lane is running on the shipped levels, statuses and timings — ' +
                          'nothing was skipped and nobody was cancelled' });
  } catch (e) { }
}

function medDelCatalogBump_() {
  MEDDEL_CATALOG_MEMO = null;
  MEDDEL_CATALOG_SAID = false;
  try { CacheService.getScriptCache().remove(medDelCatalogKey_()); } catch (e) { }
}

function medDelCatalogState_(cat) {
  var c = cat || medDelCatalog_();
  return {
    ok: !!c.ok, why: String(c.why || ''), source: String(c.source || 'code'),
    groups: c.groups, refused: (c.refused || []).slice(0, 10),
    levels: (c.levels || []).slice()
  };
}
