// Apps defined by spreadsheet rows instead of a checkout.
// `app_builder`: one row per PAGE; rows sharing `app_id` become one app, in sheet order, merged with the built-in…

var APP_BUILDER_TAB = 'app_builder';

var APP_BUILDER_COLUMNS = [
  'app_id', 'app_name', 'tagline', 'icon', 'accent', 'category', 'audience',
  'page_id', 'page_title', 'page_type', 'resource', 'columns', 'options',
  'enabled', 'notes', 'updated_at', 'updated_by',
 // WHERE THIS APP WAS BUILT (Tenant.gs).
  'tenant'
];

/** Page types the engine can mount. Anything else is refused by name. */
var APP_BUILDER_TYPES = ['sheet', 'gallery', 'board', 'documents', 'videos',
                         'dashboard', 'schedule', 'timeline', 'checklist', 'detail',
                         'pipeline'];

// Seed row.
var APP_BUILDER_EXAMPLE = [
  ['house-supplies', 'House Supplies', 'What each house needs this week',
   'package', 'amber', 'Operations', 'admin,manager,staff',
   'list', 'Supply requests', 'sheet', 'houseSupplies',
   'house:House:text|item:Item:text|qty:Qty:number|needed_by:Needed by:date|status:Status:status',
   '{"searchable":true,"exportable":true,"primaryKey":"item"}',
   'TRUE', 'Example row — edit or delete it. The tab houseSupplies was created from the columns above.', '', '']
];

/** The app_builder tab, created with headers and the example row if absent. */
function appBuilderSheet_() {
  var existed = !!hubTabSheet_(APP_BUILDER_TAB);
  var sheet = hubTabEnsure_(APP_BUILDER_TAB, APP_BUILDER_COLUMNS);
  // Seeding is for an EMPTY tab only.
  if (!existed && sheet.getLastRow() < 2) {
    // First row is a working app, so the shape is obvious from the sheet.
    var seed = APP_BUILDER_EXAMPLE.map(function (row) {
      var out = row.slice(0, APP_BUILDER_COLUMNS.length);
      while (out.length < APP_BUILDER_COLUMNS.length) out.push('');
      return out;
    });
    sheet.getRange(2, 1, seed.length, APP_BUILDER_COLUMNS.length).setValues(seed);
  }
  ensureHeader_(sheet, APP_BUILDER_COLUMNS);
  return sheet;
}

// "house:House:text|item:Item:text" → column objects.
function appBuilderColumns_(spec) {
  var out = [];
  String(spec || '').split('|').forEach(function (part) {
    var bits = String(part).split(':');
    var key = String(bits[0] || '').trim();
    if (!key) return;
    out.push({
      key: key,
      label: String(bits[1] || key).trim(),
      kind: String(bits[2] || 'text').trim()
    });
  });
  return out;
}

/** Parse a JSON cell; a typo returns the fallback instead of failing the page. */
function appBuilderJson_(raw, fallback) {
  var text = String(raw == null ? '' : raw).trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

// Give the resource somewhere to live.
function appBuilderEnsureTab_(resource, columns) {
  if (!resource) return '';
  // AN ESTATE RESOURCE HAS NO TAB TO ENSURE (2026-09-07, the House Supplies fill): route() intercepts it into the…
  if (typeof ESTATE_SOURCES !== 'undefined' && ESTATE_SOURCES[resource]) return 'estate';
  var keys = ['id'].concat(columns.map(function (c) { return c.key; })
                                  .filter(function (k) { return k !== 'id'; }));
  var existed = !!hubTabSheet_(resource);
  var sheet = hubTabEnsure_(resource, keys);
  if (!existed) return 'created';
  ensureHeader_(sheet, keys);
  return 'exists';
}

// Every app the sheet defines, shaped like a coded manifest.
HUB_POLICY.appsBuilt = {
  file: 'AppBuilder.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.appsBuilt = function (payload, user) {
  if (!user) return hubDenied_();
  var sheet = appBuilderSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var col = function (row, name) {
    var i = hdr.indexOf(name);
    return i === -1 ? '' : String(row[i] == null ? '' : row[i]).trim();
  };

  var byApp = {}, order = [], problems = [];

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var appId = col(row, 'app_id');
    if (!appId) continue;
    // built HERE, or at headquarters when this is headquarters (Tenant.gs) — this tab is read directly rather than…
    if (!tenantRowVisible_(col(row, 'tenant'))) continue;
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
        category: col(row, 'category') || 'Operations',
        version: 'sheet',
        enabled: true,
        // No audience means employees — never trainees or clients.
        audience: audience ? audience.split(',').map(function (a) { return a.trim(); }).filter(String)
                           : ['admin', 'manager', 'staff'],
        pages: [],
        /** so the shell can say where this app came from */
        source: 'sheet'
      };
      order.push(appId);
    }
    byApp[appId].pages.push(page);
    // A tab whose declared book is dark refuses to be made, and this lane runs on every sign-in: one such row must…
    try {
      appBuilderEnsureTab_(resource, columns);
    } catch (eTab) {
      problems.push({ row: r + 1, app: appId,
        message: String((eTab && eTab.message) || eTab) });
    }
  }

  var apps = order.map(function (id) { return byApp[id]; });
  return { status: 200, data: { apps: apps, problems: problems, tab: APP_BUILDER_TAB } };
};

/** Create the tab (with its worked example) without waiting for a first read. */
function seedAppBuilder() {
  appBuilderSheet_();
  Logger.log('app_builder ready with ' + (APP_BUILDER_EXAMPLE.length) + ' example row(s)');
}


// Making the rows reachable Sheet tabs join `RESOURCES` as ordinary SheetDB entries; without this every read of a…
var APP_BUILDER_REGISTERED = false;
var APP_BUILDER_RESOURCE_CACHE_KEY = 'app_builder_resources_v1';

function appBuilderRegisterResources_() {
  if (APP_BUILDER_REGISTERED) return;
  APP_BUILDER_REGISTERED = true;

  var names = null;
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(APP_BUILDER_RESOURCE_CACHE_KEY);
    if (hit) names = JSON.parse(hit);
  } catch (e) { names = null; }

  if (!names) {
    try {
      var sheet = hubTabSheet_(APP_BUILDER_TAB);
      if (!sheet) return;
      var values = sheet.getDataRange().getValues();
      var hdr = values[0].map(function (h) { return String(h).trim(); });
      var iRes = hdr.indexOf('resource'), iOn = hdr.indexOf('enabled');
      if (iRes === -1) return;
      var seen = {};
      names = [];
      for (var r = 1; r < values.length; r++) {
        if (iOn !== -1 && !packetTruthy_(String(values[r][iOn] || 'TRUE'))) continue;
        var name = String(values[r][iRes] || '').trim();
        if (!name || seen[name]) continue;
        seen[name] = true;
        names.push(name);
      }
      try { cache.put(APP_BUILDER_RESOURCE_CACHE_KEY, JSON.stringify(names), 300); } catch (e2) {}
    } catch (e3) {
      return;   // no tab, no access — the built-in resources are unaffected
    }
  }

  for (var i = 0; i < names.length; i++) {
    // Never shadow a coded resource: a typo must not take over `people`.
    if (!RESOURCES.hasOwnProperty(names[i])) {
      RESOURCES[names[i]] = { sheet: names[i], readOnly: false };
    }
  }
}


// Publishing from the Playground (write door added ) Rules this lane enforces, because the studio screen cannot…
var APP_BUILDER_ID_RE = /^[a-z][a-z0-9-]{1,48}$/;
var APP_BUILDER_RESOURCE_RE = /^[A-Za-z][A-Za-z0-9_]{1,48}$/;
var APP_BUILDER_MAX_PAGES = 12;
var APP_BUILDER_MAX_SEED_ROWS = 200;
var APP_BUILDER_MAX_OPTIONS_CHARS = 8000;
var APP_BUILDER_AUDIENCE = ['admin', 'manager', 'staff', 'client', 'all'];

/** Action kinds the generic runner executes. The upsert strips anything else. */
var APP_BUILDER_ACTION_KINDS = ['patch', 'call', 'link'];
var APP_BUILDER_ACTION_SLOTS = ['rowActions', 'headerActions', 'secondaryActions'];

// Strip unusable buttons from a page config (rowActions / headerActions / secondaryActions / footer.buttons).
function appBuilderSanitizeActions_(options, warnings, pageLabel) {
  var slots = APP_BUILDER_ACTION_SLOTS.slice();
  if (options.footer && typeof options.footer === 'object') slots.push('footer');
  for (var s = 0; s < slots.length; s++) {
    var slot = slots[s];
    var list = slot === 'footer'
      ? (Array.isArray(options.footer) ? options.footer : (options.footer && options.footer.buttons))
      : options[slot];
    if (!Array.isArray(list)) continue;
    for (var i = list.length - 1; i >= 0; i--) {
      var a = list[i];
      if (!a || typeof a !== 'object' || !a.kind) continue;
      if (APP_BUILDER_ACTION_KINDS.indexOf(a.kind) === -1) {
        warnings.push('page ' + pageLabel + ': action "' + (a.label || a.id || '?') +
          '" has unknown kind "' + a.kind + '" — removed');
        list.splice(i, 1);
        continue;
      }
      if (a.kind === 'call' && a.call && !HUB_ACTIONS[a.call]) {
        warnings.push('page ' + pageLabel + ': action "' + (a.label || a.id || '?') +
          '" calls "' + a.call + '", which is not a declared action — removed');
        list.splice(i, 1);
      }
    }
  }
}

/** [{key,label,kind}] → "key:Label:kind|…"; the DSL stays a server concern. */
function appBuilderColumnsDsl_(columns) {
  var parts = [];
  (columns || []).forEach(function (c) {
    if (!c || typeof c !== 'object') return;
    var key = String(c.key || '').trim();
    if (!key || key.indexOf('|') !== -1 || key.indexOf(':') !== -1) return;
    var label = String(c.label || key).replace(/[|:]/g, ' ').replace(/\s+/g, ' ').trim();
    var kind = String(c.kind || 'text').replace(/[|:]/g, '').trim() || 'text';
    parts.push(key + ':' + label + ':' + kind);
  });
  return parts.join('|');
}

/** '' if the page is publishable, else the reason to refuse it. */
function appBuilderValidPage_(page, index) {
  if (!page || typeof page !== 'object') return 'page ' + (index + 1) + ' is not an object';
  var type = String(page.type || 'sheet');
  if (APP_BUILDER_TYPES.indexOf(type) === -1) {
    return 'page ' + (index + 1) + ': type "' + type + '" is not one the engine mounts (' + APP_BUILDER_TYPES.join(', ') + ')';
  }
  var resource = String(page.resource || '').trim();
  if (!APP_BUILDER_RESOURCE_RE.test(resource)) {
    return 'page ' + (index + 1) + ': resource "' + resource + '" is not a usable tab name (letters, digits, underscore)';
  }
  var pageId = String(page.id || '').trim();
  if (pageId && !/^[a-z][a-z0-9-]{0,40}$/.test(pageId)) {
    return 'page ' + (index + 1) + ': id "' + pageId + '" is not a usable page id (kebab-case)';
  }
  return '';
}

// MAY THIS PAGE TOUCH THIS TAB NAME?
function appBuilderResourceState_(ss, resource, builderOwned) {
  if (builderOwned[resource]) return 'builder';
  if (RESOURCES.hasOwnProperty(resource)) return 'coded';
  for (var key in RESOURCES) {
    if (RESOURCES.hasOwnProperty(key) && RESOURCES[key].sheet === resource) {
      return 'page resource "' + resource + '" is the sheet behind the coded resource "' + key +
        '" — bind the resource by its name instead';
    }
  }
  // `ss` is the book that answers for app_builder, and the router answers null for a dissolved tab — the name test…
  if ((ss && ss.getSheetByName(resource)) || appBuilderHomeHas_(resource)) {
    return 'page resource "' + resource + '" names a tab this platform already uses for something else — ' +
      'the builder only writes tabs it created';
  }
  return 'create';
}

// True when the platform already serves this tab from somewhere (2026-09, the HUB_DB drain).
function appBuilderHomeHas_(resource) {
  if (hubTabDeclaredGone_(resource)) return true;
  // The book map is a declaration too, and unlike the switches it lives in the code: a homed tab must read "used"…
  try {
    if (typeof HUB_TAB_HOME !== 'undefined' &&
        HUB_TAB_HOME.hasOwnProperty(String(resource))) return true;
  } catch (eHome) {}
  return !!hubTabSheet_(resource);
}

/** Replace all app_builder rows for one app id, admin only. */
HUB_POLICY.appBuilderUpsert = {
  file: 'AppBuilder.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: [],
  params: { app: { type: 'object', required: true } }
};
HUB_ACTIONS.appBuilderUpsert = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();

  var app = payload.app;
  var id = String(app.id || '').trim();
  if (!APP_BUILDER_ID_RE.test(id)) {
    return { status: 400, message: 'app.id "' + id + '" is not a usable app id (kebab-case, e.g. custom-fleet-tracker).' };
  }
  var name = String(app.name || '').trim();
  if (!name) return { status: 400, message: 'app.name is required — the hub listing starts there.' };
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
  }

  var audience = [];
  (Array.isArray(app.audience) ? app.audience : []).forEach(function (a) {
    a = String(a).trim();
    if (APP_BUILDER_AUDIENCE.indexOf(a) !== -1 && audience.indexOf(a) === -1) audience.push(a);
  });

  // PREPARE EVERYTHING BEFORE THE LOCK: the swap deletes first and cannot roll back, so every refusal must fire…
  var warnings = [];
  var ss = hubTabWorkbook_(APP_BUILDER_TAB);
  var builderOwned = {};
  try {
    readTabNormalized_(ss, APP_BUILDER_TAB).forEach(function (r) {
      var res = str_(r.resource);
      if (res) builderOwned[res] = true;
    });
  } catch (eB) { /* no app_builder tab yet — nothing is builder-owned */ }

  var prepared = [];
  for (var p2 = 0; p2 < pages.length; p2++) {
    var pg = pages[p2];
    var pgLabel = String(pg.id || p2 + 1);
    var res2 = String(pg.resource).trim();
    var state = appBuilderResourceState_(ss, res2, builderOwned);
    if (state !== 'builder' && state !== 'coded' && state !== 'create') {
      return { status: 400, message: 'page ' + pgLabel + ': ' + state + '.' };
    }
    // A tab that moved and whose book is dark cannot be made, and the swap below deletes before it writes — so that…
    if (state === 'builder' && hubTabDeclaredGone_(res2) && !hubTabSheet_(res2)) {
      return { status: 400, message: 'page ' + pgLabel + ': resource "' + res2 +
        '" moved to a book that did not answer — publish again once it does.' };
    }
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
      page: pg, resource: res2, state: state, optionsText: optionsText,
      columnsDsl: Array.isArray(pg.columns) ? appBuilderColumnsDsl_(pg.columns) : String(pg.columns || '')
    });
  }

  // ONE APP ID PER PLATFORM (Tenant.gs).
  try {
    var clash = false;
    readTabNormalized_(ss, APP_BUILDER_TAB).forEach(function (r) {
      if (str_(r.appid) === id && !tenantRowVisible_(r.tenant)) clash = true;
    });
    if (clash) {
      return { status: 409, message: 'The app id "' + id + '" is already published elsewhere on this platform — choose another id.' };
    }
  } catch (eClash) { /* no tab yet — nothing to clash with */ }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { status: 409, message: 'Another publish is writing app_builder right now — try again in a few seconds.' };
  }
  try {
    var sheet = appBuilderSheet_();
    // One swap under the lock: a lockless reader may see an empty app for a moment, never a half-written one.
    appDeleteRows_(APP_BUILDER_TAB, 'app_id', id);

    var now = new Date().toISOString();
    var by = 'asa-hub:' + String(user.email || 'unknown');
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
        // stamped from the context, never from the payload — the same law hubPlaceGate_ follows for every generic…
        tenantStamp_()
      ]);

      // Coded resource = binding, never a target: no tab created, nothing seeded.
      if (prep.state === 'coded') {
        tabs.push({ resource: resource, state: 'coded', seeded: 0 });
        continue;
      }
      var cols = appBuilderColumns_(prep.columnsDsl);
      var tabState = appBuilderEnsureTab_(resource, cols);
      var seeded = 0;
      if (tabState === 'created' && Array.isArray(page.rows) && page.rows.length) {
        // Seed the tab that was just made, in whichever book holds it.
        var dataSheet = hubTabSheet_(resource);
        var keys = dataSheet.getRange(1, 1, 1, dataSheet.getLastColumn()).getValues()[0]
          .map(function (h) { return String(h).trim(); });
        var seedRows = [];
        var limit = Math.min(page.rows.length, APP_BUILDER_MAX_SEED_ROWS);
        for (var s = 0; s < limit; s++) {
          var rec = page.rows[s];
          // Arrays are objects to typeof; seeding one gives an all-empty row.
          if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
          // A row without an id can be listed but never addressed.
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
      tabs.push({ resource: resource, state: tabState, seeded: seeded });
    }
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, APP_BUILDER_COLUMNS.length)
         .setValues(rows);

    // Both caches must drop, or the next read has not heard of this publish.
    try {
      var cache = CacheService.getScriptCache();
      cache.remove(APP_BUILDER_RESOURCE_CACHE_KEY);
      cache.remove('hub_dyn_resources');
    } catch (eC) { /* cache down — the TTL still expires */ }

    hubSysLog_(user.email, 'appBuilderUpsert', id, { status: 200 });
    return { status: 200, data: { id: id, pages: rows.length, tabs: tabs, warnings: warnings } };
  } finally {
    lock.releaseLock();
  }
};

/** Editor-only entry point; the studio is the real caller. */
function runAppBuilderUpsert(example) {
  var out = HUB_ACTIONS.appBuilderUpsert(example || {
    app: {
      id: 'custom-example', name: 'Example', icon: 'rocket', accent: 'lavender',
      category: 'Workspace', audience: ['admin'],
      pages: [{ id: 'main', type: 'sheet', title: 'Main', resource: 'pgExample',
                columns: [{ key: 'name', label: 'Name', kind: 'text' }],
                rows: [{ id: 'row-1', name: 'It works' }] }]
    }
  }, { role: 'admin', email: 'editor' });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}


// "DESCRIBE THE APP" — one-shot generation, draft only The studio's AI lane: a sentence becomes a DRAFT the editor…
var PLAYGROUND_GEN_MAX_PROMPT = 2000;
var PLAYGROUND_GEN_MAX_PAGES = 4;
var PLAYGROUND_GEN_TINTS = ['mint', 'peach', 'lavender', 'pink', 'blue', 'amber'];
var PLAYGROUND_GEN_ICONS = ['rocket', 'layout-grid', 'table', 'list-checks', 'calendar',
  'image', 'video', 'book-open', 'columns-3', 'square-kanban', 'id-card', 'megaphone',
  'package', 'users', 'clipboard-list', 'clipboard-check', 'truck', 'wrench',
  'heart-pulse', 'graduation-cap', 'wallet', 'map-pin', 'bell', 'star'];

// The generation prompt: JSON only, and only page types/configs the engine mounts.
function playgroundGenPrompt_(brief) {
  return [
    'You design one small internal app for the ASA Hub platform. Answer with ONE JSON object and nothing else — no prose, no code fence.',
    '',
    'Schema of your answer:',
    '{ "name": string, "tagline": string, "icon": string, "accent": string, "category": string,',
    '  "pages": [ { "id": kebab-case, "type": string, "title": string,',
    '               "config": object, "rows": [object] } ] }',
    '',
    'Rules:',
    '- "icon" is one of: ' + PLAYGROUND_GEN_ICONS.join(', ') + '.',
    '- "accent" is one of: ' + PLAYGROUND_GEN_TINTS.join(', ') + '.',
    '- "category" is a short workspace noun (e.g. "Operations", "Workspace", "Intelligence").',
    '- "type" is one of: ' + APP_BUILDER_TYPES.join(', ') + '. Pick the template that fits the job; 1 to ' + PLAYGROUND_GEN_MAX_PAGES + ' pages.',
    '- Every row has a unique string "id" ("row-1", "row-2", …). 5 to 8 believable sample rows per page.',
    '- Config vocabularies by type:',
    '  sheet: { "entity": ["record","records"], "searchable": true, "selectable": true, "columns": [ { "key", "label", "kind" } ] } — kinds: text, avatar+text (add "subKey"), chip (add "tintBy" {value: tint}), chips, date, number, progress, image.',
    '  pipeline / board: { "stageField": "stage", "stages": [ { "id", "label", "tint", "description"? } ], "cardFields": { "title": rowKey, "subtitle": rowKey, "tags": { "key": rowKey, "tintBy": {} }, "meta": [rowKey] } }. Rows carry the stage id under stageField (board rows use "column").',
    '  dashboard: { "greeting": { "name", "subtitle" }, "widgets": [ … ] } — widget kinds: stat {label,value,delta?,tint?}, ring {percent,caption?}, donut {slices:[{label,value,tint?}],centerLabel?}, bars {bars:[{label,value,tint?}]}, note {text,tint?}, list {items:[…]}.',
    '  detail: { "header": { "title": rowKey, "subtitle": rowKey, "avatar": rowKey, "statusChip": { "field": rowKey, "tintBy": {} } }, "stats": [ { "label", "value": rowKey, "icon", "tint" } ], "sections": [ { "kind": "fields", "title", "fields": [ { "label", "value": rowKey } ] } ] }.',
    '  gallery: { "srcKey": "src", "titleKey": "title", "subtitleKey"?, "groupBy"?, "aspect": "photo" }. Rows carry image paths under srcKey.',
    '  checklist: { "groupKey": "section", "labelKey": "item", "noteKey": "note", "requiredKey": "required" }.',
    '  timeline: { "timeKey": "at", "titleKey": "title", "bodyKey": "detail", "actorKey": "actor", "kindKey": "kind", "kindTints": {} }.',
    '  documents: { "collections": [ { "id", "label", "icon", "tint" } ] }. Rows: { id, title, excerpt, collection, updatedAt, readMinutes, body: [ { "kind": "h2"|"p", "text" } ] }.',
    '  videos: { "channels": [ { "id", "label", "tint" } ] }. Rows: { id, title, channel, thumb, durationSec, views, watched, publishedAt, description }.',
    '  schedule: { "view": "week", "resources": [ { "id", "name", "role"? } ], "eventTypes": { "key": { "label", "tint" } }, "timeRange": [8, 19], "slotMinutes": 30 }. Rows: { id, personId, date "YYYY-MM-DD", start "HH:MM", durationMin, type }.',
    '- Column keys and row keys must match exactly. Dates are ISO "YYYY-MM-DD".',
    '- A page may declare BUTTONS in its config — this is what makes the app a tool:',
    '  "rowActions": [ { "id", "label", "icon", "kind", ... } ] on sheet pages, shown in each row\'s menu.',
    '  kinds you may use:',
    '    patch — update this row: { "kind": "patch", "patch": { "status": "Done" } } — values may interpolate "{row.key}".',
    '    link — open a URL: { "kind": "link", "href": "https://…/{row.id}" }.',
    '  optional on any action: "when": { "field", "eq" } (only show when the row matches), "confirm": "Are you sure?" , "toast": "Done — {row.name}", "quick": true (a visible button instead of the menu), "danger": true.',
    '  Give every app 1–3 genuinely useful row actions (e.g. mark done, approve, archive). Do NOT invent "call" actions — only patch and link.',
    '',
    'The app the user wants:',
    brief
  ].join('\n');
}

// A generated page is a SUGGESTION: coerce it into something the engine mounts, or drop it with a warning the…
function playgroundGenPage_(raw, index, warnings) {
  if (!raw || typeof raw !== 'object') { warnings.push('page ' + (index + 1) + ' was not an object — dropped'); return null; }
  var type = String(raw.type || '').trim();
  if (APP_BUILDER_TYPES.indexOf(type) === -1) {
    warnings.push('page ' + (index + 1) + ': type "' + type + '" is not mountable — replaced with sheet');
    type = 'sheet';
  }
  var config = (raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config)) ? raw.config : {};
  if (!raw.config || typeof raw.config !== 'object') warnings.push('page ' + (index + 1) + ' had no config object — using defaults');
  var rows = [];
  if (Array.isArray(raw.rows)) {
    if (raw.rows.length > 25) warnings.push('page ' + (index + 1) + ': the model drew ' + raw.rows.length + ' rows; kept 25');
    for (var i = 0; i < raw.rows.length && rows.length < 25; i++) {
      var r = raw.rows[i];
      if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
      if (typeof r.id !== 'string' || !r.id) r.id = 'row-' + (rows.length + 1);
      rows.push(r);
    }
  }
  if (!rows.length) warnings.push('page ' + (index + 1) + ' came with no usable rows');
  return {
    id: (/^[a-z][a-z0-9-]{0,40}$/.test(String(raw.id || ''))) ? String(raw.id) : (index === 0 ? 'main' : 'page-' + (index + 1)),
    type: type,
    title: String(raw.title || '').trim() || 'Page ' + (index + 1),
    config: config,
    rows: rows
  };
}

/** Draft an app from a one-sentence brief. Admin only; writes nothing. */
HUB_POLICY.playgroundGenerate = {
  file: 'AppBuilder.gs', lane: 'tool', store: 'external',
  idempotent: false, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: [],
  params: { prompt: { type: 'string', required: true } }
};
HUB_ACTIONS.playgroundGenerate = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var brief = String(payload.prompt || '').trim();
  if (!brief) return { status: 400, message: 'Describe the app first — one sentence is enough.' };
  if (brief.length > PLAYGROUND_GEN_MAX_PROMPT) {
    return { status: 400, message: 'Keep the description under ' + PLAYGROUND_GEN_MAX_PROMPT + ' characters.' };
  }

  var res = screenAiChat_(playgroundGenPrompt_(brief), 0.3, 'ai_playground_page');
  if (!res.ok) {
    return { status: 502, message: 'No model answered (' + res.error + '). Try again in a moment.' };
  }

  var draft;
  try { draft = JSON.parse(res.content); }
  catch (e) {
    hubSysLog_(user.email, 'playground_generate_unparseable', res.via, { status: 502 });
    return { status: 502, message: 'The model answered, but not in JSON — rephrase slightly and try again.' };
  }
  // JSON.parse('null') SUCCEEDS — refuse it here or the next line throws a 500.
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    return { status: 502, message: 'The model answered, but not with an app — rephrase slightly and try again.' };
  }

  var warnings = [];
  var pages = [];
  var rawPages = Array.isArray(draft.pages) ? draft.pages : [];
  if (!rawPages.length && (draft.type || draft.config)) rawPages = [draft]; // a model that answered one bare page
  if (rawPages.length > PLAYGROUND_GEN_MAX_PAGES) {
    warnings.push('the model drew ' + rawPages.length + ' pages; kept the first ' + PLAYGROUND_GEN_MAX_PAGES);
  }
  for (var i = 0; i < rawPages.length && pages.length < PLAYGROUND_GEN_MAX_PAGES; i++) {
    var page = playgroundGenPage_(rawPages[i], i, warnings);
    if (page) pages.push(page);
  }
  if (!pages.length) {
    return { status: 502, message: 'The model produced no mountable page — rephrase slightly and try again.' };
  }

  var icon = String(draft.icon || '').trim();
  if (PLAYGROUND_GEN_ICONS.indexOf(icon) === -1) icon = 'rocket';
  var accent = String(draft.accent || '').trim();
  if (PLAYGROUND_GEN_TINTS.indexOf(accent) === -1) accent = 'lavender';

  hubSysLog_(user.email, 'playgroundGenerate', res.via, { status: 200 });
  return { status: 200, data: {
    via: res.via,
    warnings: warnings,
    draft: {
      name: String(draft.name || '').trim() || 'Untitled app',
      tagline: String(draft.tagline || '').trim(),
      icon: icon,
      accent: accent,
      category: String(draft.category || '').trim() || 'Workspace',
      pages: pages
    }
  } };
};
