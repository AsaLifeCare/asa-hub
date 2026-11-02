// App Studio: imported sheet resources (read-only, cached 60s), app overrides and tenants.

// The one tab maker (TabRouter.gs); it refuses to re-create a tab somebody deliberately killed.
function ensureTab_(name, headers) {
  return hubTabEnsure_(name, headers);
}

function hubDynamicResources_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('hub_dyn_resources');
  if (hit) return JSON.parse(hit);
  var out = {};
  try {
    var sheet = hubTabSheet_('hub_resources');
    if (sheet) {
      readTabNormalized_(sheet.getParent(), 'hub_resources').forEach(function (r) {
        var id = str_(r.resourceid);
        // rowLimit caps what a screen asks for (the newest rows); the sheet itself is never truncated.
        if (id) out[id] = {
          sid: str_(r.spreadsheetid), tab: str_(r.tabname),
          rowLimit: parseInt(str_(r.rowlimit), 10) || 0,
          // The cached map is shared across places, so tenant travels with the row and route() narrows.
          tenant: str_(r.tenant)
        };
      });
    }
  } catch (err) {}
  cache.put('hub_dyn_resources', JSON.stringify(out), 60);
  return out;
}

// Keeps the original header casing: imported apps derive their column labels from it.
function readTabRawKeys_(ss, tabName) {
  var sheet = null;
  if (String(ss.getId()) === String(hubId_('HUB_DB_ID'))) {
    sheet = hubTabSheet_(tabName);
    if (sheet) ss = sheet.getParent();
  }
  // hubHouseTabIn_, not getSheetByName: a house book may carry the rows under the matrix name.
  if (!sheet) sheet = hubHouseTabIn_(ss, tabName);
  if (!sheet) throw new Error('Tab missing: ' + tabName);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0].map(function (h) { return String(h).trim(); });
  var isUtcBook = String(ss.getId()) === String(hubId_('HUB_DB_ID')) ||
                  ss.getSpreadsheetTimeZone() === 'Etc/GMT';
  var tz = isUtcBook ? '' : ss.getSpreadsheetTimeZone();
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var line = values[r];
    var empty = true;
    for (var e = 0; e < line.length; e++) {
      if (line[e] !== '' && line[e] !== null) { empty = false; break; }
    }
    if (empty) continue;
    var obj = {};
    for (var c = 0; c < header.length; c++) {
      if (!header[c]) continue;
      var v = line[c];
      if (v instanceof Date) v = isUtcBook ? cellText_(v) : estateCell_(v, tz);
      obj[header[c]] = v;
    }
    rows.push(obj);
  }
  return rows;
}

function dynRoute_(dyn, action, payload) {
  if (action === 'list' || action === 'get') {
    var rows = cacheRead_('dyn_' + dyn.sid.slice(0, 8) + '_' + dyn.tab, 'rows', function () {
      var loaded = readTabRawKeys_(ssOpen_(dyn.sid), dyn.tab);
      loaded.forEach(function (r, i) { if (r.id === undefined) r.id = '_r' + (i + 2); });
      return loaded;
    });
    if (action === 'list') {
      var want = parseInt(payload && payload.limit, 10) || dyn.rowLimit || 0;
      if (want > 0 && rows.length > want) rows = rows.slice(rows.length - want);
      return { status: 200, data: rows };
    }
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].id) === String(payload.id)) return { status: 200, data: rows[i] };
    }
    return { status: 404, message: 'No record "' + payload.id + '".' };
  }
  return { status: 405, message: 'Imported resources are read-only in this build.' };
}

function sheetIdFromUrl_(input) {
  var s = str_(input);
  var m = s.match(/\/d\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  return '';
}

HUB_POLICY.sheetInspect = {
  file: 'Studio.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.sheetInspect = function (payload, user) {
  if (!user || user.role !== 'admin') return hubDenied_();
  var sid = sheetIdFromUrl_(payload.url);
  if (!sid) return { status: 400, message: 'Paste a Google Sheets URL (or its id).' };
  var ss;
  try {
    ss = ssOpen_(sid);
  } catch (err) {
    return { status: 403, message: 'Could not open that spreadsheet — make sure this Google account has access to it.' };
  }
  var tabs = ss.getSheets().map(function (sh) {
    var lastCol = sh.getLastColumn();
    var headers = lastCol > 0
      ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }).filter(String)
      : [];
    return { name: sh.getName(), headers: headers, rows: Math.max(0, sh.getLastRow() - 1) };
  });
  return { status: 200, data: { spreadsheet_id: sid, title: ss.getName(), tabs: tabs } };
};

HUB_POLICY.sheetImport = {
  file: 'Studio.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.sheetImport = function (payload, user) {
  if (!user || user.role !== 'admin') return hubDenied_();
  var sid = sheetIdFromUrl_(payload.spreadsheet_id || payload.url);
  var tab = str_(payload.tab);
  var name = str_(payload.name) || tab || 'Imported sheet';
  if (!sid || !tab) return { status: 400, message: 'spreadsheet_id and tab are required.' };
  try {
    var sheet = ssOpen_(sid).getSheetByName(tab);
    if (!sheet) return { status: 404, message: 'Tab "' + tab + '" not found.' };
  } catch (err) {
    return { status: 403, message: 'Could not open that spreadsheet — make sure this Google account has access to it.' };
  }
  var resourceId = 'x_' + normKey_(name).slice(0, 24) + '_' + randomHex_(4);
  // One handle for the maker and the write, or the row lands in a workbook nobody reads.
  var resources = ensureTab_('hub_resources', ['resource_id', 'spreadsheet_id', 'tab_name', 'label', 'created_at', 'created_by', 'tenant']);
  resources.appendRow([
    resourceId, sid, tab, name, new Date().toISOString(), 'asa-hub:' + user.email,
    // Stamped from the context, never the payload.
    tenantStamp_()
  ]);
  var app = {
    id: 'app_' + randomHex_(6),
    name: name,
    tagline: str_(payload.tagline) || 'Imported from Google Sheets',
    icon: str_(payload.icon) || 'table',
    accent: str_(payload.accent) || 'blue',
    category: 'Imported',
    version: '1.0.0',
    isNew: true,
    enabled: true,
    source: 'studio',
    pages: [{ id: 'main', type: 'sheet', title: name,
              dataSource: { resource: resourceId }, config: {} }]
  };
  var madeApp = createRow_('apps', app);
  if (sheetDbRefused_(madeApp)) return sheetDbRefused_(madeApp);
  CacheService.getScriptCache().remove('hub_dyn_resources');
  return { status: 200, data: { resource_id: resourceId, app: app } };
};

/** Rename, restyle or hide an app; a row matching a built-in id is an override the SPA layers on top. */
HUB_POLICY.appUpsert = {
  file: 'Studio.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.appUpsert = function (payload, user) {
  if (!user || user.role !== 'admin') return hubDenied_();
  var id = str_(payload.id);
  if (!id) return { status: 400, message: 'app id required' };
  // an override row on a master-only app reaches the master too (enabled:false hides it from him)
  if (appIsMasterOnly_(id) && !appAccessMayEdit_(user)) {
    return { status: 403, message: 'This app is the master\'s alone — only the master may change it.' };
  }
  var fields = {};
  ['name', 'tagline', 'icon', 'accent', 'category'].forEach(function (k) {
    if (payload[k] !== undefined) fields[k] = str_(payload[k]);
  });
  if (payload.enabled !== undefined) fields.enabled = payload.enabled === true || payload.enabled === 'true';
  if (payload.drag_focus !== undefined) fields.drag_focus = payload.drag_focus === true || payload.drag_focus === 'true';
  // App ids are unique platform-wide: an id taken by another place is refused, never a second row.
  var rows = readAll_(sheetFor_('apps'));
  var mine = null, elsewhere = false;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) !== id) continue;
    if (tenantRowVisible_(rows[i].tenant)) mine = rows[i]; else elsewhere = true;
  }
  if (!mine && elsewhere) {
    return { status: 409, message: 'The app id "' + id + '" is already registered elsewhere on this platform — choose another id.' };
  }
  if (mine) {
    var patch = Object.assign({ id: id }, fields);
    var gate = hubPlaceGate_('apps', 'update', patch);
    if (gate) return gate;
    var merged = updateRowById_('apps', patch);
    return merged.error ? merged.error : { status: 200, data: merged };
  }
  var fresh = Object.assign({ id: id, override: true }, fields);
  var gateC = hubPlaceGate_('apps', 'create', fresh);
  if (gateC) return gateC;
  var created = createRow_('apps', fresh);
  if (sheetDbRefused_(created)) return sheetDbRefused_(created);
  return { status: 200, data: created };
};

// --- tenants (franchises) ---

var TENANT_HEADERS = ['tenant_id', 'name', 'type', 'city', 'state', 'status',
                      'staff_count', 'client_count', 'since', 'created_at', 'created_by',
                      // Never echoed to the SPA: a spreadsheet id is a credential.
                      'spreadsheet_id'];

HUB_POLICY.tenantsList = {
  file: 'Studio.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.tenantsList = function (payload, user) {
  var tenantsTab = ensureTab_('tenants', TENANT_HEADERS);
  // Only places the CALLER may enter: inside a member visit `user` wears the visited badge.
  var who = (typeof HUB_CALLER !== 'undefined' && HUB_CALLER) ? HUB_CALLER : user;
  var reachList = tenantReachIds_(who);   // null = every active row (the master)
  var reach = null;
  if (reachList) {
    reach = {};
    for (var t = 0; t < reachList.length; t++) reach[reachList[t]] = true;
  }
  var rows = readTabNormalized_(tenantsTab.getParent(), 'tenants')
    .filter(function (t) { return str_(t.status).toLowerCase() !== 'archived'; })
    .filter(function (t) {
      if (!reach) return true;
      // The hq row always stays: a shell with no chip at all cannot be signed into.
      return reach[str_(t.tenantid)] === true || str_(t.type) === 'hq';
    })
    .map(function (t) {
      return { id: str_(t.tenantid), name: str_(t.name), type: str_(t.type) || 'branch',
               city: str_(t.city), state: str_(t.state),
               status: str_(t.status) || 'active',
               staffCount: parseInt(str_(t.staffcount), 10) || 0,
               clientCount: parseInt(str_(t.clientcount), 10) || 0,
               since: str_(t.since) };
    });
  return { status: 200, data: rows };
};

HUB_POLICY.tenantUpsert = {
  file: 'Studio.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.tenantUpsert = function (payload, user) {
  if (!user || user.role !== 'admin') return hubDenied_();
  var sheet = ensureTab_('tenants', TENANT_HEADERS);
  var id = str_(payload.id);
  var name = str_(payload.name);
  if (!id && !name) return { status: 400, message: 'tenant name required' };
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('tenantid');
  if (id) {
    for (var r = 1; r < values.length; r++) {
      if (str_(values[r][iId]) !== id) continue;
      var set = function (key, val) {
        var i = hdr.indexOf(key);
        if (i !== -1) sheet.getRange(r + 1, i + 1).setValue(val);
      };
      ['name', 'type', 'city', 'state', 'status', 'since'].forEach(function (k) {
        if (payload[k] !== undefined) set(normKey_(k), str_(payload[k]));
      });
      if (payload.staffCount !== undefined) set('staffcount', parseInt(payload.staffCount, 10) || 0);
      if (payload.clientCount !== undefined) set('clientcount', parseInt(payload.clientCount, 10) || 0);
      return { status: 200, data: { id: id } };
    }
    return { status: 404, message: 'No tenant "' + id + '".' };
  }
  var newId = 'ten_' + normKey_(name).slice(0, 16) + '_' + randomHex_(4);
  sheet.appendRow([
    newId, name, str_(payload.type) || 'franchise', str_(payload.city), str_(payload.state),
    'active', parseInt(payload.staffCount, 10) || 0, parseInt(payload.clientCount, 10) || 0,
    str_(payload.since) || String(new Date().getFullYear()),
    new Date().toISOString(), 'asa-hub:' + user.email
  ]);
  return { status: 200, data: { id: newId } };
};

HUB_POLICY.resourcesList = {
  file: 'Studio.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.resourcesList = function (payload, user) {
  if (!user || user.role !== 'admin') return hubDenied_();
  var sheet = hubTabSheet_('hub_resources');
  if (!sheet) return { status: 200, data: [] };
  return { status: 200, data: readTabNormalized_(sheet.getParent(), 'hub_resources').map(function (r) {
    return { resource_id: str_(r.resourceid), spreadsheet_id: str_(r.spreadsheetid),
             tab: str_(r.tabname), label: str_(r.label), created_at: str_(r.createdat) };
  }) };
};

// Unregisters an app from apps, hub_resources and app_builder; its data tab is never touched.
function appDeleteRows_(tabName, column, value) {
  var sheet = hubTabSheet_(tabName);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, ''); });
  var col = hdr.indexOf(String(column).toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (col === -1) return 0;
  var vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  // Another place's row is not the caller's to delete.
  var iTenant = hdr.indexOf('tenant');
  var gone = 0;
  for (var r = vals.length - 1; r >= 0; r--) {
    if (String(vals[r][col]).trim() !== String(value).trim()) continue;
    if (!tenantRowVisible_(iTenant === -1 ? '' : vals[r][iTenant])) continue;
    sheet.deleteRow(r + 2);
    gone++;
  }
  return gone;
}

HUB_POLICY.appDelete = {
  file: 'Studio.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.appDelete = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var id = str_(payload.id);
  if (!id) return { status: 400, message: 'app id required' };

  var found = { apps: 0, hub_resources: 0, app_builder: 0 };
  var resourceIds = [], dataTabs = [];
  // Counted only where the caller stands, or the 404 would reveal another place's apps.
  try {
    readAll_(sheetFor_('apps')).forEach(function (r) {
      if (String(r.id) === id && tenantRowVisible_(r.tenant)) found.apps++;
    });
  } catch (eA) {}
  try {
    var resourcesTab = hubTabSheet_('hub_resources');
    readTabNormalized_(resourcesTab.getParent(), 'hub_resources').forEach(function (r) {
      if (str_(r.resourceid) === id && tenantRowVisible_(r.tenant)) {
        found.hub_resources++; resourceIds.push(str_(r.tabname));
      }
    });
  } catch (eR) {}
  try {
    var builderTab = hubTabSheet_(APP_BUILDER_TAB);
    readTabNormalized_(builderTab.getParent(), APP_BUILDER_TAB).forEach(function (r) {
      if (str_(r.appid) === id && tenantRowVisible_(r.tenant)) {
        found.app_builder++;
        var res = str_(r.resource);
        if (res && dataTabs.indexOf(res) === -1) dataTabs.push(res);
      }
    });
  } catch (eB) {}

  if (!found.apps && !found.hub_resources && !found.app_builder) {
    return { status: 404, message: 'No app "' + id + '" is registered. Nothing was deleted.' };
  }

  var removed = {
    apps: appDeleteRows_('apps', 'id', id),
    hub_resources: appDeleteRows_('hub_resources', 'resource_id', id),
    app_builder: appDeleteRows_(APP_BUILDER_TAB, 'app_id', id)
  };

  var tabs = dataTabs.concat(resourceIds).filter(function (t, i, a) { return t && a.indexOf(t) === i; });
  var kept = [];
  tabs.forEach(function (t) {
    var sheet = hubTabSheet_(t);
    if (sheet) kept.push({ tab: t, rows: Math.max(0, sheet.getLastRow() - 1) });
  });

  try {
    var cache = CacheService.getScriptCache();
    cache.remove('hub_dyn_resources');
    cache.remove(APP_BUILDER_RESOURCE_CACHE_KEY);
  } catch (eC) {}

  hubSysLog_(user.email, 'appDelete', id, { status: 200 });
  return { status: 200, data: {
    id: id, removed: removed, data_kept: kept,
    note: kept.length
      ? 'The app is gone from the platform. Its data is untouched — ' +
        kept.map(function (k) { return k.tab + ' (' + k.rows + ' rows)'; }).join(', ') +
        '. Nothing here deletes a tab; that is done in the spreadsheet, by someone who can see it.'
      : 'The app is gone from the platform. It had no data tab of its own.'
  } };
};

function runAppDelete(appId) {
  var out = HUB_ACTIONS.appDelete({ id: appId || '' }, { role: 'admin', email: 'editor' });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
