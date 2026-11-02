// The envelope's `world` re-points the generic verbs at the caller's own workbook; sessions, users and prefs never follow it.

var WORLD_REGISTRY_TAB = 'user_worlds';
var WORLD_REGISTRY_HEADER = ['world_id', 'owner_user_id', 'owner_email',
                             'name', 'spreadsheet_id', 'created_at',
                             // blank means the defaults were never seeded
                             'defaults_version'];
var WORLD_FOLDER_NAME = 'User Worlds';
var WORLD_APPS_TAB = 'world_apps';
var WORLD_TAB_RE = /^[A-Za-z][A-Za-z0-9_]{0,48}$/;
// Interviewers and trainees get no world; every other account, clients included, does.
var WORLD_ROLES = ['admin', 'manager', 'staff', 'client'];

function worldHuman_(user) {
  return !!(user && !user.is_service &&
            WORLD_ROLES.indexOf(String(user.role)) !== -1);
}

function worldDenied_() {
  return { status: 403, message: 'Worlds are for employees.' };
}

// A world kept from this caller (Settings > My Work, AlertsConfig.gs) is answered as one never offered.
function worldWithheld_(user) {
  try { return typeof hubMyWorldHiddenFor_ === 'function' && !!hubMyWorldHiddenFor_(user); }
  catch (e) { return false; }
}

function worldOffered_(user) {
  return worldHuman_(user) && !worldWithheld_(user);
}

function worldRegistrySheet_() {
  var sheet = ensureTab_(WORLD_REGISTRY_TAB, WORLD_REGISTRY_HEADER);
  ensureHeader_(sheet, WORLD_REGISTRY_HEADER);
  return sheet;
}

function worldRows_() {
  return cacheRead_(WORLD_REGISTRY_TAB, 'rows', function () {
    return readAll_(worldRegistrySheet_());
  });
}

function worldRowFor_(user) {
  var uid = str_(user && user.id);
  if (!uid) return null;
  var rows = worldRows_();
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].owner_user_id) === uid) return rows[i];
  }
  return null;
}

function worldPublic_(row) {
  return {
    world_id: str_(row.world_id),
    name: str_(row.name),
    spreadsheet_id: str_(row.spreadsheet_id),
    created_at: str_(row.created_at)
  };
}

// Every refusal is 404, never 403: a 403 would admit the world exists.
function worldResolve_(rows, wid, user) {
  var deny = { error: { status: 404, message: 'No world "' + wid + '".' } };
  if (!user || user.is_service) return deny;
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].world_id) !== wid) continue;
    // Besides the owner, only a member Members.gs resolved may visit, read-only.
    var mayVisit = false;
    if (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX &&
        HUB_MEMBER_CTX.scope === 'work_world' &&
        str_(rows[i].owner_user_id) === str_(HUB_MEMBER_CTX.userId)) {
      mayVisit = true;
    }
    if (!mayVisit && str_(rows[i].owner_user_id) !== str_(user.id)) return deny;
    var sid = str_(rows[i].spreadsheet_id);
    if (!sid) return deny;
    return { worldId: wid, ssId: sid };
  }
  return deny;
}

function worldContext_(world, user) {
  var wid = str_(world);
  if (!wid) return null;
  if (!user || user.is_service) return worldResolve_([], wid, user);
  if (worldWithheld_(user)) return worldResolve_([], wid, user);
  return worldResolve_(worldRows_(), wid, user);
}

function worldMintTab_(ss, tab, keys) {
  var header = ['id'];
  for (var i = 0; i < keys.length; i++) {
    if (header.indexOf(keys[i]) === -1) header.push(keys[i]);
  }
  var sheet = ss.insertSheet(tab);
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  sheet.setFrozenRows(1);
  return sheet;
}

// Upstream adapters and gates are skipped on purpose: the workbook boundary is the isolation.
function worldRoute_(resource, action, payload, user) {
  if (['list', 'get', 'create', 'update', 'delete'].indexOf(action) === -1) {
    return { status: 400, message: 'Unknown action: "' + action + '". ' +
      'Valid actions: list, get, create, update, delete.' };
  }
  var tab = str_(resource);
  if (!WORLD_TAB_RE.test(tab)) {
    return { status: 404, message: 'Unknown resource: "' + tab + '".' };
  }
  var ss = getSpreadsheet_();   // world-aware
  var exists = !!ss.getSheetByName(tab);
  var missing = { status: 404, message: 'No "' + tab + '" record with id "' +
                  str_(payload && payload.id) + '".' };
  switch (action) {
    case 'list': {
      if (!exists) return { status: 200, data: [] };
      return { status: 200, data: listRows_(tab, payload) };
    }
    case 'get': {
      if (!exists) return missing;
      var row = requireRow_(tab, payload.id);
      return row.error ? row.error : { status: 200, data: row };
    }
    case 'create': {
      if (!exists) worldMintTab_(ss, tab, Object.keys(payload || {}));
      var made = createRow_(tab, payload);
      return sheetDbRefused_(made) ? sheetDbRefused_(made) : { status: 200, data: made };
    }
    case 'update': {
      if (!exists) return missing;
      var updated = updateRowById_(tab, payload);
      return updated.error ? updated.error : { status: 200, data: updated };
    }
    case 'delete': {
      if (!exists) return missing;
      var removed = deleteRowById_(tab, payload.id);
      return removed.error ? removed.error
        : { status: 200, data: { id: payload.id, deleted: true } };
    }
  }
}

/** The caller's own world, or null when none has been created yet. */
HUB_POLICY.worldGet = {
  file: 'World.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  // Must be a literal (read unexecuted), so it repeats WORLD_ROLES; the self-test asserts they match.
  roles: ['admin', 'manager', 'staff', 'client'],
  invalidates: [], emits: []
};
HUB_ACTIONS.worldGet = function (payload, user) {
  if (!worldHuman_(user)) return worldDenied_();
  // no world, the answer that also sends a stored one home
  if (worldWithheld_(user)) return { status: 200, data: { world: null } };
  var row = worldRowFor_(user);
  return { status: 200, data: { world: row ? worldPublic_(row) : null } };
};

/** Create the caller's own world workbook when there is none yet; the Drive work happens outside the platform's single script lock. */
HUB_POLICY.worldEnsure = {
  file: 'World.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff', 'client'],
  invalidates: [], emits: []
};
function worldDiscard_(ssId) {
  try { DriveApp.getFileById(str_(ssId)).setTrashed(true); }
  catch (e) {}
}

// Drive work stays outside the platform's single script lock; the lock only guards the registry append.
HUB_ACTIONS.worldEnsure = function (payload, user) {
  if (!worldOffered_(user)) return worldDenied_();
  var row = worldRowFor_(user);
  if (row) {
    worldSeedDefaultsMaybe_(user);
    return { status: 200, data: { world: worldPublic_(row), created: false } };
  }

  // Not a lock (the cache cannot compare-and-set); the registry check under the lock decides.
  var mintKey = 'wldmint_' + str_(user.id);
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (eC) { cache = null; }
  if (cache && cache.get(mintKey)) {
    return { status: 409, message: 'Your world is being created right now — try again in a few seconds.' };
  }
  if (cache) { try { cache.put(mintKey, '1', 90); } catch (eP) {} }

  var unmark = function () {
    if (cache) { try { cache.remove(mintKey); } catch (eR) {} }
  };

  var name = 'ASA World — ' + (str_(user.display_name) || str_(user.email) || str_(user.id));
  var ss;
  try {
    ss = SpreadsheetApp.create(name);
  } catch (eCreate) {
    unmark();
    return { status: 503, message: 'Your world could not be created right now — try again in a moment.' };
  }
  try {
    DriveApp.getFileById(ss.getId())
      .moveTo(filesChildByName_(filesRoot_(), WORLD_FOLDER_NAME));
  } catch (eMove) {}

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    worldDiscard_(ss.getId());
    unmark();
    return { status: 409, message: 'Another request is creating your world right now — try again in a few seconds.' };
  }
  var createdRec = null;
  try {
    // Re-read past the cache under the lock so a losing retry finds the winner's row.
    cacheBump_(WORLD_REGISTRY_TAB);
    row = worldRowFor_(user);
    if (row) {
      worldDiscard_(ss.getId());
      return { status: 200, data: { world: worldPublic_(row), created: false } };
    }
    createdRec = {
      world_id: 'wld_' + randomHex_(12),
      owner_user_id: str_(user.id),
      owner_email: str_(user.email),
      name: name,
      spreadsheet_id: ss.getId(),
      created_at: new Date().toISOString()
    };
    var sheet = worldRegistrySheet_();
    var header = ensureHeader_(sheet, WORLD_REGISTRY_HEADER);
    sheet.appendRow(header.map(function (h) { return createdRec[h] !== undefined ? createdRec[h] : ''; }));
    cacheBump_(WORLD_REGISTRY_TAB);
    hubSysLog_(user.email, 'worldEnsure', createdRec.world_id, { status: 200 });
  } finally {
    lock.releaseLock();
    unmark();
  }
  // Seed after the lock; a failed seed leaves the stamp blank for the next sign-in.
  worldSeedDefaultsMaybe_(user);
  return { status: 200, data: { world: worldPublic_(createdRec), created: true } };
};

function worldAppsSheet_(ss) {
  var sheet = ss.getSheetByName(WORLD_APPS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(WORLD_APPS_TAB);
    sheet.getRange(1, 1, 1, APP_BUILDER_COLUMNS.length).setValues([APP_BUILDER_COLUMNS]);
    sheet.setFrozenRows(1);
  }
  ensureHeader_(sheet, APP_BUILDER_COLUMNS);
  return sheet;
}

function worldEnsureDataTab_(ss, resource, columns) {
  if (!resource) return '';
  var sheet = ss.getSheetByName(resource);
  var keys = ['id'].concat(columns.map(function (c) { return c.key; })
                                  .filter(function (k) { return k !== 'id'; }));
  if (!sheet) {
    sheet = ss.insertSheet(resource);
    sheet.getRange(1, 1, 1, keys.length).setValues([keys]);
    sheet.setFrozenRows(1);
    return 'created';
  }
  ensureHeader_(sheet, keys);
  return 'exists';
}

function worldDeleteRows_(sheet, column, value) {
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, ''); });
  var col = hdr.indexOf(String(column).toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (col === -1) return 0;
  var vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  var gone = 0;
  for (var r = vals.length - 1; r >= 0; r--) {
    if (String(vals[r][col]).trim() === String(value).trim()) {
      sheet.deleteRow(r + 2);
      gone++;
    }
  }
  return gone;
}

// Must match SheetDb's world cache key derivation.
function worldCacheBump_(ssId, tab) {
  cacheBump_('w_' + String(ssId).slice(0, 8) + '_' + tab);
}

/** Manifests in exactly the appsBuilt grammar, read from the caller's own world_apps tab. */
HUB_POLICY.worldAppsList = {
  file: 'World.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff', 'client'],
  invalidates: [], emits: []
};
HUB_ACTIONS.worldAppsList = function (payload, user) {
  if (!worldOffered_(user)) return worldDenied_();
  var mine = worldRowFor_(user);
  if (!mine) return { status: 200, data: { apps: [], problems: [], tab: WORLD_APPS_TAB, world: null, defaults: worldDefaultsSummary_({}) } };
  var ss = ssOpen_(str_(mine.spreadsheet_id));
  var sheet = ss.getSheetByName(WORLD_APPS_TAB);
  if (!sheet) {
    return { status: 200, data: { apps: [], problems: [], tab: WORLD_APPS_TAB, world: str_(mine.world_id), defaults: worldDefaultsSummary_({}) } };
  }

  // Mapping copied verbatim from appsBuilt: a world app must be indistinguishable from a company one.
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var col = function (row, name) {
    var i = hdr.indexOf(name);
    return i === -1 ? '' : String(row[i] == null ? '' : row[i]).trim();
  };

  var byApp = {}, order = [], problems = [], ownedIds = {};
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var appId = col(row, 'app_id');
    if (!appId) continue;
    ownedIds[appId] = true;
    if (!packetTruthy_(col(row, 'enabled') || 'TRUE')) continue;

    var type = col(row, 'page_type') || 'sheet';
    if (APP_BUILDER_TYPES.indexOf(type) === -1) {
      problems.push({ row: r + 1, app: appId,
        message: 'page_type "' + type + '" is not one the engine mounts (' + APP_BUILDER_TYPES.join(', ') + ')' });
      continue;
    }
    var resource = col(row, 'resource');
    if (!resource) {
      problems.push({ row: r + 1, app: appId, message: 'resource is required — it is where the rows live' });
      continue;
    }

    var columns = appBuilderColumns_(col(row, 'columns'));
    var options = appBuilderJson_(col(row, 'options'), {});
    if (col(row, 'options') && !Object.keys(options).length) {
      problems.push({ row: r + 1, app: appId, message: 'options is not valid JSON — the page kept its defaults' });
    }
    if (columns.length) options.columns = options.columns || columns;

    var page = {
      id: col(row, 'page_id') || 'list',
      type: type,
      title: col(row, 'page_title') || col(row, 'app_name') || appId,
      dataSource: { resource: resource },
      config: options
    };

    if (!byApp[appId]) {
      var audience = col(row, 'audience');
      byApp[appId] = {
        id: appId,
        name: col(row, 'app_name') || appId,
        tagline: col(row, 'tagline'),
        icon: col(row, 'icon') || 'layout-grid',
        accent: col(row, 'accent') || 'blue',
        category: col(row, 'category') || 'Workspace',
        version: 'sheet',
        enabled: true,
        audience: audience ? audience.split(',').map(function (a) { return a.trim(); }).filter(String)
                           : ['admin', 'manager', 'staff'],
        pages: [],
        source: 'sheet'
      };
      order.push(appId);
    }
    byApp[appId].pages.push(page);
  }

  var apps = order.map(function (id) { return byApp[id]; });
  return { status: 200, data: { apps: apps, problems: problems, tab: WORLD_APPS_TAB, world: str_(mine.world_id), defaults: worldDefaultsSummary_(ownedIds) } };
};

/** appBuilderUpsert in the caller's own workbook: one locked swap of the app's rows; data tabs minted inside the world, seeded only on birth, never cleared. */
HUB_POLICY.worldAppUpsert = {
  file: 'World.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff', 'client'],
  invalidates: [], emits: [],
  params: { app: { type: 'object', required: true } }
};
HUB_ACTIONS.worldAppUpsert = function (payload, user) {
  if (!worldOffered_(user)) return worldDenied_();
  var app = payload && payload.app;
  if (!app || typeof app !== 'object' || Array.isArray(app)) {
    return { status: 400, message: 'app is required — the object the studio publishes.' };
  }
  var id = String(app.id || '').trim();
  if (!APP_BUILDER_ID_RE.test(id)) {
    return { status: 400, message: 'app.id "' + id + '" is not a usable app id (kebab-case, e.g. my-tracker).' };
  }
  var name = String(app.name || '').trim();
  if (!name) return { status: 400, message: 'app.name is required — the listing starts there.' };
  var pages = app.pages;
  if (!Array.isArray(pages) || !pages.length) {
    return { status: 400, message: 'app.pages must hold at least one page.' };
  }
  if (pages.length > APP_BUILDER_MAX_PAGES) {
    return { status: 400, message: 'app.pages holds ' + pages.length + ' pages; the most an app may have is ' + APP_BUILDER_MAX_PAGES + '.' };
  }
  for (var p = 0; p < pages.length; p++) {
    var bad = appBuilderValidPage_(pages[p], p);
    if (bad) return { status: 400, message: bad };
    var resName = String(pages[p].resource).trim();
    if (resName === WORLD_APPS_TAB || resName === WORLD_REGISTRY_TAB) {
      return { status: 400, message: 'page resource "' + resName + '" is reserved.' };
    }
  }

  // The swap deletes first and cannot roll back, so every refusal must fire before the lock.
  var warnings = [];
  var prepared = [];
  for (var p2 = 0; p2 < pages.length; p2++) {
    var pg = pages[p2];
    var pgLabel = String(pg.id || p2 + 1);
    var options = pg.options !== undefined ? (pg.options || {}) : null;
    if (typeof options === 'string') {
      try { options = JSON.parse(options); }
      catch (eO) { return { status: 400, message: 'page ' + pgLabel + ': options is a string that is not JSON.' }; }
    }
    if (options && typeof options === 'object') {
      appBuilderSanitizeActions_(options, warnings, pgLabel);
    }
    var optionsText = options !== null
      ? JSON.stringify(options)
      : String(pg.optionsText || '');
    if (optionsText.length > APP_BUILDER_MAX_OPTIONS_CHARS) {
      return { status: 400, message: 'page "' + pgLabel + '": options is ' + optionsText.length +
        ' characters; the most a cell holds safely here is ' + APP_BUILDER_MAX_OPTIONS_CHARS + '.' };
    }
    prepared.push({
      page: pg, resource: String(pg.resource).trim(), optionsText: optionsText,
      columnsDsl: Array.isArray(pg.columns) ? appBuilderColumnsDsl_(pg.columns) : String(pg.columns || '')
    });
  }
  var audience = [];
  (Array.isArray(app.audience) ? app.audience : []).forEach(function (a) {
    a = String(a).trim();
    if (APP_BUILDER_AUDIENCE.indexOf(a) !== -1 && audience.indexOf(a) === -1) audience.push(a);
  });

  var mine = worldRowFor_(user);
  if (!mine) return { status: 404, message: 'No world yet — worldEnsure creates one.' };
  var ssId = str_(mine.spreadsheet_id);
  var ss = ssOpen_(ssId);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { status: 409, message: 'Another publish is writing your world right now — try again in a few seconds.' };
  }
  try {
    var sheet = worldAppsSheet_(ss);
    worldDeleteRows_(sheet, 'app_id', id);

    var now = new Date().toISOString();
    var by = 'world:' + str_(user.email);
    var enabled = app.enabled === false || app.enabled === 'FALSE' ? 'FALSE' : 'TRUE';
    var rows = [];
    var tabs = [];
    for (var i = 0; i < prepared.length; i++) {
      var prep = prepared[i];
      var page = prep.page;
      var resource = prep.resource;
      rows.push([
        id, name, String(app.tagline || ''), String(app.icon || 'layout-grid'),
        String(app.accent || 'blue'), String(app.category || 'Workspace'),
        audience.join(','),
        String(page.id || (i === 0 ? 'main' : 'page-' + (i + 1))),
        String(page.title || name),
        String(page.type || 'sheet'),
        resource,
        prep.columnsDsl,
        prep.optionsText,
        enabled,
        String(page.notes || ''),
        now,
        by,
        // 18th column (tenant): always blank in a world, but setValues needs the full width.
        ''
      ]);

      var cols = appBuilderColumns_(prep.columnsDsl);
      var tabState = worldEnsureDataTab_(ss, resource, cols);
      var seeded = 0;
      if (tabState === 'created' && Array.isArray(page.rows) && page.rows.length) {
        var dataSheet = ss.getSheetByName(resource);
        var keys = dataSheet.getRange(1, 1, 1, dataSheet.getLastColumn()).getValues()[0]
          .map(function (h) { return String(h).trim(); });
        var seedRows = [];
        var limit = Math.min(page.rows.length, APP_BUILDER_MAX_SEED_ROWS);
        for (var s = 0; s < limit; s++) {
          var rec = page.rows[s];
          if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
          if (typeof rec.id !== 'string' || !rec.id) rec.id = 'row-' + (seedRows.length + 1);
          seedRows.push(keys.map(function (k) {
            var v = rec[k];
            if (v === undefined || v === null) return '';
            return (typeof v === 'object') ? JSON.stringify(v) : v;
          }));
        }
        if (seedRows.length) {
          dataSheet.getRange(2, 1, seedRows.length, keys.length).setValues(seedRows);
          seeded = seedRows.length;
        }
      }
      worldCacheBump_(ssId, resource);
      tabs.push({ resource: resource, state: tabState, seeded: seeded });
    }
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, APP_BUILDER_COLUMNS.length)
         .setValues(rows);
    worldCacheBump_(ssId, WORLD_APPS_TAB);

    return { status: 200, data: { id: id, pages: rows.length, tabs: tabs, warnings: warnings } };
  } finally {
    lock.releaseLock();
  }
};

// Data tabs are left alone: unregistering is reversible, emptying a tab is not.
HUB_POLICY.worldAppDelete = {
  file: 'World.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff', 'client'],
  invalidates: [], emits: [],
  params: { app_id: { type: 'string', required: true } }
};
HUB_ACTIONS.worldAppDelete = function (payload, user) {
  if (!worldOffered_(user)) return worldDenied_();
  var id = str_(payload && payload.app_id);
  if (!id) return { status: 400, message: 'app_id is required.' };
  var mine = worldRowFor_(user);
  if (!mine) return { status: 404, message: 'No world yet — worldEnsure creates one.' };
  var ssId = str_(mine.spreadsheet_id);
  var sheet = ssOpen_(ssId).getSheetByName(WORLD_APPS_TAB);
  var gone = sheet ? worldDeleteRows_(sheet, 'app_id', id) : 0;
  worldCacheBump_(ssId, WORLD_APPS_TAB);
  return { status: 200, data: { id: id, removed: gone } };
};
