// THE JSON LANE (C5) — the architecture: The intranet runs from JSON with every sheet inside it.
// One giant JSON carrying all the sheets is generated, zipped into Drive and ingested by the platform; every five…

// THE SHAPE OF WHAT IS INSIDE.
var BUNDLE_READER_VERSION = 2;

/** Where the bundles are filed, beside 'User Worlds' and 'Tenant Workbooks'. */
var BUNDLE_FOLDER_NAME = 'Snapshot Bundles';

// How many builds of one place survive a sweep.
var BUNDLE_KEEP_PER_PLACE = 2;

// A place's bundles are named so the sweep can group them without opening anything: `bundle~<place>~<iso>.json`…
var BUNDLE_SEP = '~';

function bundleName_(placeId, stamp) {
  return 'bundle' + BUNDLE_SEP + (str_(placeId) || 'home') + BUNDLE_SEP +
         str_(stamp).replace(/[:.]/g, '-') + '.json';
}

function bundlePlaceOf_(fileName) {
  var parts = str_(fileName).split(BUNDLE_SEP);
  return (parts.length >= 3 && parts[0] === 'bundle') ? parts[1] : '';
}

/** Every bundle file, newest first within its place. */
function bundleIsOurs_(name) { return str_(name).indexOf('bundle' + BUNDLE_SEP) === 0; }

// THE BOOK'S OWN FINGERPRINT — one question instead of one per tab.
var BUNDLE_BOOK_REV = '[book]';

function bundleBookKey_(bookId, scope) {
  return str_(bookId) + '::' + BUNDLE_BOOK_REV + str_(scope);
}

// When the workbook itself last changed, ISO — or '' when we could not ask.
function bundleBookStamp_(bookId) {
  try { return DriveApp.getFileById(str_(bookId)).getLastUpdated().toISOString(); }
  catch (e) { return ''; }
}

// EVERY ROUTED TAB, AS THIS PLACE SEES IT.
function bundleResourceNames_() {
  var names = [];
  for (var r in RESOURCES) if (RESOURCES.hasOwnProperty(r)) names.push(r);
  names.sort();
  return names;
}

function bundleReadAll_(have, part, parts) {
  var out = {}, skipped = [], carried = [];
  have = have || {};
  var nParts = Math.max(1, parseInt(parts, 10) || 1);
  var iPart = Math.max(0, parseInt(part, 10) || 0) % nParts;
  var order = bundleResourceNames_();
  var mine = {};
  for (var oi = 0; oi < order.length; oi++) {
    if (oi % nParts === iPart) mine[order[oi]] = true;
  }

  // THE SIZE DECIDES WHETHER WE READ AT ALL.
  var revs = {};
  var revKey = {};
  var revError = '';
  var gotAsked = 0;                 // fingerprints that came back from the ASK
  try {
    var pairs = [];
    var wantRevs = [];              // { tab, book, key } — one per routed tab
    var books = {};                 // the DISTINCT workbooks they live in
    for (var rn in RESOURCES) {
      if (!RESOURCES.hasOwnProperty(rn) || !mine[rn]) continue;
      var t = RESOURCES[rn].sheet;
      if (!t) continue;
      var bookId = '';
      // hubTabWorkbook_, not hubDb_: the latter knows the book map but not the houses, so a moved tab was…
      try { bookId = hubTabWorkbook_(t).getId(); } catch (eBook) { bookId = ''; }
      revKey[rn] = bookId ? (bookId + '::' + t) : t;
      wantRevs.push({ tab: t, book: bookId, key: revKey[rn] });
      if (bookId) books[bookId] = true;
    }
    // This half's own corner of the stamp map — see bundleBookKey_.
    var bookScope = nParts > 1 ? ('#' + iPart) : '';
    var stamps = {};
    for (var bid in books) {
      if (!books.hasOwnProperty(bid)) continue;
      var st = bundleBookStamp_(bid);
      // '' is never "unchanged" — see bundleBookStamp_.
      if (st) { stamps[bid] = st; revs[bundleBookKey_(bid, bookScope)] = st; }
    }
    for (var wi = 0; wi < wantRevs.length; wi++) {
      var w = wantRevs[wi];
      var quiet = !!(w.book && stamps[w.book] &&
                     have[bundleBookKey_(w.book, bookScope)] === stamps[w.book]);
      // 'error' is not an answer we may carry forward: it said "we do not know" once, and repeating it for as long…
      if (quiet && have[w.key] && have[w.key] !== 'error') {
        revs[w.key] = have[w.key];
        continue;
      }
      pairs.push(w.book ? { id: w.book, tab: w.tab } : w.tab);
    }
    if (pairs.length) {
      var answer = bulkTabsRevs_({ tabs: pairs });
      var asked = ((answer && answer.data) || {}).revs || {};
      for (var ak in asked) if (asked.hasOwnProperty(ak)) { revs[ak] = asked[ak]; gotAsked++; }
    }
  } catch (eRevs) {
    // No fingerprints is not a failure: it is a full read, exactly as before.
    revs = {};
    revKey = {};
    revError = String((eRevs && eRevs.message) || eRevs).slice(0, 160);
  }

  // A DEGRADATION NOBODY CAN SEE LASTS FOREVER (found live).
  var revsEmpty = pairs.length > 0 && !gotAsked;
  if (revsEmpty && typeof hubSysLog_ === 'function') {
    try {
      hubSysLog_('asa-hub:bundle', 'bundle_revs_empty',
                 'asked for ' + pairs.length + ' fingerprint(s) and got none' +
                 (revError ? ' — ' + revError : '') +
                 ' — this place will be read WHOLE every cycle until it is fixed',
                 { status: 500 });
    } catch (eLog) { /* the flag below still travels */ }
  }

  for (var resource in RESOURCES) {
    if (!RESOURCES.hasOwnProperty(resource) || !mine[resource]) continue;
    var tab = RESOURCES[resource].sheet;
    // Keyed by the BOOK as well as the tab, so a place that repointed a tab is compared against its own copy and…
    var rk = revKey[resource] || tab;
    var now = revs[rk];
    // 'error' is NOT "unchanged" — a fingerprint we could not take says nothing about the tab, so the tab is read.
    if (now && now !== 'error' && have[rk] && have[rk] === now) {
      carried.push(resource);
      continue;
    }
    try {
      // A dissolved tab's slice comes from the depot, raw column names and all — the same bridge bulkTabsRead_…
      var moved = hiringTabDissolved_(tab) ? hiringLegacyRawRows_(tab) : null;
      if (moved !== null) {
        if (hubAwayTenant_()) {
          moved = moved.filter(function (r) { return tenantRowVisible_(r && r.tenant); });
        }
        out[resource] = moved;
        continue;
      }
      // A MOVED tab's slice comes from its house (HouseFlip.gs) — before the missing-tab guard, the books_text…
      var houseSh = (typeof houseSheetFor_ === 'function') ? houseSheetFor_(tab) : null;
      var ss = houseSh ? houseSh.getParent() : hubTabWorkbook_(tab);
      var sheet = houseSh || hubHouseTabIn_(ss, tab);
      if (!sheet) { out[resource] = []; continue; }
      // THE SAME READER THE VERBS USE, and this is not a detail (found live, ).
      var rows = readAll_(sheet);
      // LAW 2 — narrowed HERE, so nothing downstream has an `if` to forget.
      if (hubAwayTenant_()) {
        rows = rows.filter(function (r) { return tenantRowVisible_(r && r.tenant); });
      }
      out[resource] = rows;
    } catch (e) {
      // A tab that cannot be read is REPORTED, never silently emptied: an empty array and a failure look identical…
      skipped.push(resource + ': ' + str_(e && e.message));
    }
  }
  return { resources: out, unreadable: skipped, carried: carried, revs: revs,
           revs_empty: revsEmpty, revs_error: revError,
           part: iPart, parts: nParts };
}

// A WORLD'S OWN TABS.
function bundleReadWorld_(have) {
  // A WORLD CARRIES FORWARD LIKE EVERYWHERE ELSE (found live).
  have = have || {};
  var out = {}, skipped = [], carried = [], revs = {};
  var book = str_(HUB_WORLD_CTX.ssId);
  var bookKey = bundleBookKey_(book);
  var bookStamp = bundleBookStamp_(book);
  if (bookStamp && have[bookKey] === bookStamp) {
    var stillHeld = [];
    for (var hk in have) {
      if (!have.hasOwnProperty(hk) || hk === bookKey) continue;
      if (hk.indexOf(book + '::') !== 0) continue;
      stillHeld.push(hk.slice(book.length + 2));
    }
    if (stillHeld.length) {
      // `revs` is handed back exactly as it came: the relay's map is already right about this workbook, and…
      return { resources: {}, unreadable: [], carried: stillHeld, revs: have };
    }
  }
  var ss;
  try {
    ss = ssOpen_(book);
  } catch (eOpen) {
    return { resources: {}, unreadable: ['workbook: ' + str_(eOpen && eOpen.message)],
             carried: [], revs: {} };
  }
  // '' is never "unchanged" — an unstamped world is simply read as it always was, and is asked again next cycle.
  if (bookStamp) revs[bookKey] = bookStamp;
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    var key = book + '::' + name;
    var fp = '';
    try {
      var rows = sheets[i].getLastRow();
      if (rows < 2) fp = 'empty';
      else {
        var last = sheets[i].getRange(rows, 1, 1, sheets[i].getLastColumn()).getValues()[0];
        fp = rows + ':' + String(last.join('')).length + ':' +
          Utilities.base64Encode(Utilities.computeDigest(
            Utilities.DigestAlgorithm.MD5, last.join(''), Utilities.Charset.UTF_8)).slice(0, 12);
      }
    } catch (eFp) { fp = 'error'; }
    revs[key] = fp;
    if (fp && fp !== 'error' && have[key] && have[key] === fp) {
      carried.push(name);
      continue;
    }
    try {
      // the sheet's own header, exactly as worldRoute_ would serve it
      out[name] = readAll_(sheets[i]);
    } catch (e) {
      skipped.push(name + ': ' + str_(e && e.message));
    }
  }
  return { resources: out, unreadable: skipped, carried: carried, revs: revs };
}

/** The bundles folder, made on first use. */
function bundleFolder_() {
  return filesChildByName_(filesRoot_(), BUNDLE_FOLDER_NAME);
}

// THE BUILD'S OWN EXCLUSION — not the platform's.
var BUNDLE_LOCK_KEY = 'bundle_building';
var BUNDLE_LOCK_TTL_S = 360;   // longer than a build, shorter than a cycle

function bundleLockTake_() {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get(BUNDLE_LOCK_KEY)) return false;
    cache.put(BUNDLE_LOCK_KEY, String(Date.now()), BUNDLE_LOCK_TTL_S);
    return true;
  } catch (e) {
    // No cache is not a reason to stop building — it is a reason to build without the guard, which is what this did…
    return true;
  }
}

function bundleLockDrop_() {
  try { CacheService.getScriptCache().remove(BUNDLE_LOCK_KEY); } catch (e) {}
}

// BUILD ONE BUNDLE for the place this execution is standing in.
function bundleBuild_(label, withBody, have, part, parts) {
  var inWorld = (typeof HUB_WORLD_CTX !== 'undefined' && HUB_WORLD_CTX);
  var place = str_(label) || (inWorld ? 'world_' + str_(HUB_WORLD_CTX.worldId) : hubTenantId_());
  var startedAt = new Date().toISOString();
  var read = inWorld ? bundleReadWorld_(have) : bundleReadAll_(have, part, parts);
  // WHETHER THIS BUILD IS A PIECE OR A WHOLE — decided here rather than below, because the payload now needs to…
  var incremental = !!(read.carried && read.carried.length) || (read.parts || 1) > 1;
  var payload = {
    place: place || 'home',
    // WHICH READER MADE THIS FILE.
    reader: BUNDLE_READER_VERSION,
    built_at: new Date().toISOString(),
    read_started_at: startedAt,
    // THE STAMP THE FILE CARRIES — and only the file.
    db_last_updated: (!incremental && typeof serviceDbStamp_ === 'function') ? serviceDbStamp_() : '',
    unreadable: read.unreadable,
    // WHAT THIS BUILD WAS MADE FROM.
    revs: read.revs || {},
    // AND WHY THERE ARE NONE, WHEN THERE ARE NONE.
    revs_empty: !!read.revs_empty,
    revs_error: read.revs_error || '',
    // Named, not sent: the caller already holds these and merges them in.
    carried: read.carried || [],
    resources: read.resources
  };
  // A PARTIAL BUILD IS NEVER FILED.
  var body = incremental ? '' : JSON.stringify(payload);
  var file = null;
  if (!incremental) {
    var folder = bundleFolder_();
    file = folder.createFile(bundleName_(place, payload.built_at), body, 'application/json');
    bundleSweep_(place);
  }
  var counts = {};
  for (var r in read.resources) if (read.resources.hasOwnProperty(r)) counts[r] = read.resources[r].length;
  var receipt = {
    place: payload.place, built_at: payload.built_at,
    file_id: file ? file.getId() : '',
    incremental: incremental,
    part: read.part || 0, parts: read.parts || 1,
    read: counts, carried: read.carried || [],
    bytes: body.length, resources: counts, unreadable: read.unreadable
  };
  // THE BUILD HANDS BACK WHAT IT BUILT (Rule Zero).
  if (withBody) receipt.bundle = payload;
  return receipt;
}

// KEEP THE LAST, DROP THE REST — for one place, or every place when none is named.
function bundleSweep_(placeId) {
  var folder = bundleFolder_();
  var byPlace = {};
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    var name = f.getName();
    if (!bundleIsOurs_(name)) continue;
    var p = bundlePlaceOf_(name);
    if (placeId !== undefined && placeId !== null && str_(placeId) &&
        p !== str_(placeId)) continue;
    if (!byPlace[p]) byPlace[p] = [];
    byPlace[p].push({ file: f, name: name });
  }
  var removed = 0;
  for (var key in byPlace) {
    if (!byPlace.hasOwnProperty(key)) continue;
    var list = byPlace[key];
    // the name carries an ISO stamp, so lexicographic IS chronological
    list.sort(function (a, b) { return a.name < b.name ? 1 : -1; });
    for (var i = BUNDLE_KEEP_PER_PLACE; i < list.length; i++) {
      try { list[i].file.setTrashed(true); removed++; } catch (e) { /* next sweep gets it */ }
    }
  }
  return removed;
}

/** The newest bundle for a place, as text — '' when there is none yet. */
function bundleLatest_(placeId) {
  var want = str_(placeId) || 'home';
  var folder = bundleFolder_();
  var it = folder.getFiles(), best = null, bestName = '';
  while (it.hasNext()) {
    var f = it.next(), name = f.getName();
    if (name.indexOf('bundle' + BUNDLE_SEP + want + BUNDLE_SEP) !== 0) continue;
    if (!best || name > bestName) { best = f; bestName = name; }
  }
  return best ? best.getBlob().getDataAsString() : '';
}

// THE PERSONAL HALF OF A PLACE.
function bundleReadOwned_() {
  var byUser = {}, skipped = [], revs = {};
  // THE FINGERPRINTS THIS HALF WAS NEVER GIVEN (not a degradation: the work that made the system faster reached one…
  var pairs = [];
  for (var rn in RESOURCES) {
    if (!RESOURCES.hasOwnProperty(rn)) continue;
    var oc = RESOURCES[rn];
    if (!oc.ownedBy || !oc.sheet) continue;
    var ownBook = '';
    try { ownBook = hubTabWorkbook_(oc.sheet).getId(); } catch (eOwnBook) { ownBook = ''; }
    pairs.push(ownBook ? { id: ownBook, tab: oc.sheet } : oc.sheet);
  }
  if (pairs.length) {
    // One call for all eight, and it reads one row per tab — the cost of asking is a fraction of the cost of the…
    try { revs = ((bulkTabsRevs_({ tabs: pairs }) || {}).data || {}).revs || {}; }
    catch (eOwnRevs) { revs = {}; }
  }
  for (var resource in RESOURCES) {
    if (!RESOURCES.hasOwnProperty(resource)) continue;
    var cfg = RESOURCES[resource];
    if (!cfg.ownedBy) continue;
    var tab = cfg.sheet;
    try {
      var sheet = hubTabSheet_(tab);
      if (!sheet) continue;
      var ss = sheet.getParent();
      // readAll_, because cfg.ownedBy names a RAW column ('ownerId') and the normalised reader would have called it…
      var rows = readAll_(sheet);
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        // the place narrows first, exactly as the list verb does
        if (hubAwayTenant_() && !tenantRowVisible_(row && row.tenant)) continue;
        var owner = str_(hubOwnerOf_(row, cfg));
        if (!owner) continue;          // a row nobody owns belongs in nobody's file
        if (!byUser[owner]) byUser[owner] = {};
        if (!byUser[owner][resource]) byUser[owner][resource] = [];
        byUser[owner][resource].push(row);
      }
    } catch (e) {
      skipped.push(resource + ': ' + str_(e && e.message));
    }
  }
  // THE PREFERENCES ARE THEIRS TOO: slices and bundles are per user, and that includes the user's preferences.
  try {
    var prefRows = readAll_(prefsSheet_());
    for (var pi = 0; pi < prefRows.length; pi++) {
      var puid = str_(prefRows[pi] && prefRows[pi].user_id);
      if (!puid) continue;
      if (!byUser[puid]) byUser[puid] = {};
      byUser[puid]['userPrefs'] = [prefRows[pi]];
    }
  } catch (ePrefs) {
    skipped.push('userPrefs: ' + str_(ePrefs && ePrefs.message));
  }
  // `revs` travels with the answer so the caller can decide, next cycle, whether this execution is worth spending…
  return { users: byUser, unreadable: skipped, revs: revs };
}

HUB_POLICY.snapshotBundleOwned = {
  file: 'Bundle.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.snapshotBundleOwned = function (payload, user) {
  if (!user || !user.is_service) return { status: 404, message: 'Unknown action.' };
  var wanted = str_(payload && payload.place);
  var held = HUB_TENANT_CTX;
  if (wanted && tenantActiveIdsFrom_(tenantsRows_()).indexOf(wanted) === -1) {
    return { status: 404, message: 'Not found.' };
  }
  try {
    if (wanted) HUB_TENANT_CTX = { tenantId: wanted };
    var read = bundleReadOwned_();
    var counts = {};
    for (var u in read.users) {
      if (!read.users.hasOwnProperty(u)) continue;
      var n = 0;
      for (var r in read.users[u]) if (read.users[u].hasOwnProperty(r)) n += read.users[u][r].length;
      counts[u] = n;
    }
    return { status: 200, data: {
      place: wanted || 'home',
      // the personal half is a bundle too, and carries the same stamp
      reader: BUNDLE_READER_VERSION,
      built_at: new Date().toISOString(),
      unreadable: read.unreadable,
      // The owned tabs' fingerprints, keyed exactly as the place bundle keys them.
      revs: read.revs || {},
      counts: counts,
      users: read.users
    } };
  } finally { HUB_TENANT_CTX = held || null; }
};

// ------------------------------------------------------------------ the machine's doors — service identity only…

HUB_POLICY.snapshotBundleBuild = {
  file: 'Bundle.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.snapshotBundleBuild = function (payload, user) {
  // The builder's own lane.
  if (!user) return hubDenied_();
  if (!user.is_service) {
    var isMaster = false;
    try { isMaster = hubIsMaster_(str_(user.email)); } catch (e) { isMaster = false; }
    if (!isMaster) return { status: 404, message: 'Unknown action.' };
  }
  // THE MACHINE BUILDS FOR A PLACE IT IS NOT STANDING IN — the missing half of "built per place from day one"…
  var wanted = str_(payload && payload.place);
  var wantWorld = str_(payload && payload.world);
  // The machine asks for the body; a person clicking this in the editor wants the receipt, not seven megabytes of…
  var withBody = !!(payload && payload.withBody) && !!user.is_service;
  // WHAT THE CALLER ALREADY HOLDS — `{ tab: fingerprint }` from the bundle it is carrying.
  var have = (user.is_service && payload && payload.have && typeof payload.have === 'object')
    ? payload.have : {};
  var held = HUB_TENANT_CTX;
  var heldWorld = HUB_WORLD_CTX;
  var worldCtx = null;
  if (wantWorld) {
    // A WORLD IS A WORKBOOK, so the id is resolved against the registry and never trusted from the payload: an…
    var wrows = worldRows_();
    for (var wi = 0; wi < wrows.length; wi++) {
      if (str_(wrows[wi].world_id) === wantWorld && str_(wrows[wi].spreadsheet_id)) {
        worldCtx = { worldId: wantWorld, ssId: str_(wrows[wi].spreadsheet_id) };
        break;
      }
    }
    if (!worldCtx) return { status: 404, message: 'Not found.' };
  } else if (wanted) {
    if (tenantActiveIdsFrom_(tenantsRows_()).indexOf(wanted) === -1) {
      return { status: 404, message: 'Not found.' };
    }
  }
  // A READ-ONLY MIRROR MUST NOT QUEUE BEHIND THE PLATFORM'S WRITES (measured — the bundle had been an hour stale…
  if (!bundleLockTake_()) {
    return { status: 200, data: { skipped: 'another build is already running' } };
  }
  try {
    if (worldCtx) {
      HUB_WORLD_CTX = worldCtx;
      // a world is nobody's company ground — the tenant context must not travel into it, the same rule doPost…
      HUB_TENANT_CTX = null;
      // THE WORLD GETS ITS FINGERPRINTS TOO (found live).
      return { status: 200, data: bundleBuild_('world_' + wantWorld, withBody, have, 0, 1) };
    }
    if (wanted) HUB_TENANT_CTX = { tenantId: wanted };
    return { status: 200, data: bundleBuild_(null, withBody, have,
      (payload && payload.part) || 0, (payload && payload.parts) || 1) };
  } finally {
    HUB_TENANT_CTX = held || null;
    HUB_WORLD_CTX = heldWorld || null;
    bundleLockDrop_();
  }
};

HUB_POLICY.snapshotBundlePlaces = {
  file: 'Bundle.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
// Which places the machine should build a bundle for: '' (headquarters) first, then every active place.
HUB_ACTIONS.snapshotBundlePlaces = function (payload, user) {
  if (!user || !user.is_service) return { status: 404, message: 'Unknown action.' };
  var ids = tenantActiveIdsFrom_(tenantsRows_());
  var home = tenantHomeId_();
  var out = [''];
  for (var i = 0; i < ids.length; i++) {
    if (ids[i] && ids[i] !== home) out.push(ids[i]);
  }
  // AND EVERY WORLD.
  var worlds = [];
  try {
    worldRows_().forEach(function (w) {
      if (str_(w.world_id) && str_(w.spreadsheet_id)) worlds.push(str_(w.world_id));
    });
  } catch (eW) { /* no registry yet — the places still build */ }
  return { status: 200, data: { places: out, worlds: worlds } };
};

HUB_POLICY.snapshotBundleLatest = {
  file: 'Bundle.gs', lane: 'read', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.snapshotBundleLatest = function (payload, user) {
  if (!user || !user.is_service) return { status: 404, message: 'Unknown action.' };
  var text = bundleLatest_(str_(payload && payload.place));
  if (!text) return { status: 404, message: 'No bundle has been built for that place yet.' };
  var parsed = null;
  try { parsed = JSON.parse(text); }
  catch (e) { return { status: 500, message: 'The newest bundle is not readable JSON.' }; }
  return { status: 200, data: parsed };
};

HUB_POLICY.snapshotBundleSweep = {
  file: 'Bundle.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.snapshotBundleSweep = function (payload, user) {
  if (!user) return hubDenied_();
  if (!user.is_service) {
    var master = false;
    try { master = hubIsMaster_(str_(user.email)); } catch (e) { master = false; }
    if (!master) return { status: 404, message: 'Unknown action.' };
  }
  return { status: 200, data: { removed: bundleSweep_(str_(payload && payload.place)) } };
};

// THE CONFIGURATION EVERY SCREEN READS BEFORE IT CAN PAINT, IN ONE EXECUTION.
HUB_POLICY.configLane = {
  file: 'Bundle.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: []
};
HUB_ACTIONS.configLane = function (payload, user) {
  if (!user) return hubDenied_();
  var out = { place: '', own_workbook: false, built_at: new Date().toISOString() };
  try { out.place = str_(hubTenantId_()); } catch (ePlace) { out.place = ''; }
  try { out.own_workbook = !!tenantSpreadsheetId_(); } catch (eBook) { out.own_workbook = false; }

  function part(name, fn) {
    try {
      var r = fn();
      if (r && r.status === 200) out[name] = r.data;
    } catch (e) { /* one part's refusal is not the lane's failure */ }
  }
  part('hiringViews', function () { return HUB_ACTIONS.hiringViewsPolicy({}, user); });
  part('clientViews', function () { return HUB_ACTIONS.clientViewsPolicy({}, user); });
  part('potClientsViews', function () { return HUB_ACTIONS.potClientsViewsPolicy({}, user); });
  part('shelf', function () { return HUB_ACTIONS.appShelfGet({}, user); });
 // THE OTHER TWO THE SHELL READS BEFORE IT DRAWS.
  part('menuLinks', function () { return HUB_ACTIONS.userMenuLinksList({}, user); });
  part('appsBuilt', function () { return HUB_ACTIONS.appsBuilt({}, user); });
  // resolved test mode for the relay's web notices (hubTestModeState_); relay-only, never in the browser bundle
  try {
    var testState = hubTestModeState_();
    var testWord = String((hiringAlerts_() || {}).test_mode || '').trim().toLowerCase();
    if (testState.unrecognized) {
      // FAIL-CLOSED: the relay holds on `unreadable`, never on a word it cannot place
      out.test_mode = { unreadable: hubTestModeUnknownWhy_(testState.unrecognized), on: true,
                        word: testWord, explicit: true };
    } else {
      out.test_mode = { on: !!testState.on, word: testWord || (testState.on ? 'on' : 'off'),
                        explicit: !!testState.explicit };
    }
  } catch (eTest) {
    out.test_mode = { unreadable: String((eTest && eTest.message) || eTest).slice(0, 200) };
  }
  // AND THE GATES THE RELAY ASKS (SmartGate.gs HUB_GATES, `relay: true`).
  try {
    if (typeof HUB_GATES !== 'undefined' && typeof hubGatesArmedRead_ === 'function') {
      var gateRead = hubGatesArmedRead_();
      if (gateRead.unreadable) {
        out.smart_gates_unreadable = String(gateRead.unreadable).slice(0, 200);
      } else {
        var gateMap = {};
        HUB_GATES.forEach(function (g) { gateMap[g.id] = !!(gateRead.map && gateRead.map[g.id] === true); });
        out.smart_gates = gateMap;
      }
    }
  } catch (eGates) {
    out.smart_gates_unreadable = String((eGates && eGates.message) || eGates).slice(0, 200);
  }
  // AND THE COMPANY NOTICES' SWITCHES (NoticeSituations.gs): one situation per notice kind the relay stores for the…
  try {
    if (typeof hubNoticeSituationsRead_ === 'function') {
      var noticeRead = hubNoticeSituationsRead_();
      if (noticeRead.unreadable) out.notice_situations_unreadable = String(noticeRead.unreadable).slice(0, 200);
      else out.notice_situations = noticeRead.map;
    }
  } catch (eNotices) {
    out.notice_situations_unreadable = String((eNotices && eNotices.message) || eNotices).slice(0, 200);
  }
  // AND SETTINGS > MY WORK (AlertsConfig.gs hubMyWorkHideRead_): the parts the master hides from every other…
  if (typeof hubMyWorkHideRead_ === 'function' && typeof hubMyWorkHideLaneFor_ === 'function' &&
      hubMyWorkHideLaneFor_(user)) {
    try {
      out.my_work_hide = hubMyWorkHideRead_();
    } catch (eMyWork) {
      out.my_work_hide_unreadable = String((eMyWork && eMyWork.message) || eMyWork).slice(0, 200);
    }
  }
  // AND ITS APP LIST (hubMyWorkAppsRead_), on the same terms: the relay cuts those apps from the matrices and the…
  if (typeof hubMyWorkAppsRead_ === 'function' && typeof hubMyWorkHideLaneFor_ === 'function' &&
      hubMyWorkHideLaneFor_(user)) {
    out.my_work_apps = hubMyWorkAppsRead_();
    if (typeof hubMyWorkAppsSeenRead_ === 'function') out.my_work_apps_seen = hubMyWorkAppsSeenRead_();
  }
  // AND THE WORLD SWITCH (hubMyWorldHideOn_), on the same terms: the relay serves a world's file to the master and…
  if (typeof hubMyWorldHideOn_ === 'function' && typeof hubMyWorkHideLaneFor_ === 'function' &&
      hubMyWorkHideLaneFor_(user)) {
    out.my_world_hide = hubMyWorldHideOn_();
    out.my_world_seen = hubMyWorldSeenRead_();
  }
  // AND SETTINGS > ALERTS I RECEIVE (AlertReceive.gs arLane_), on the same terms: by account id, the alerts each…
  if (typeof arLane_ === 'function' && typeof hubMyWorkHideLaneFor_ === 'function' && hubMyWorkHideLaneFor_(user)) {
    try { out.alert_receive_off = arLane_(); } catch (eReceive) { /* nobody is cut */ }
  }
  // AND SETTINGS > APP CONTROL ACCESS (AppControlDelegates.gs), on the same terms: the accounts whose May change is…
  if (typeof hubAcDelegateWritersRead_ === 'function' && typeof hubMyWorkHideLaneFor_ === 'function' &&
      hubMyWorkHideLaneFor_(user)) {
    out.app_control_writers = hubAcDelegateWritersRead_();
  }
  return { status: 200, data: out };
};
