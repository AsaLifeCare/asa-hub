// Rewritten by tools/push_apps_script.py on every push, so the serving engine reports its own build.
var HUB_CODE_BUILD = '2026-10-23T16:44:03Z';

// Service identity only and read-only by construction: nothing here can reach a write.

var BULK_MAX_TABS = 12;

// An entry is a tab name or { id, tab }; a pair answers under `<id>::<tab>` so same-named tabs never collide.
function bulkTabsRevs_(payload) {
  var names = (payload && payload.tabs) || [];
  if (!names.length || !Array.isArray(names)) {
    return { status: 400, message: 'tabs: a list of tab names is required.' };
  }
  var revs = {};
  for (var i = 0; i < names.length; i++) {
    var entry = names[i];
    var isPair = !!(entry && typeof entry === 'object' && entry.tab);
    var tab = String(isPair ? entry.tab : entry);
    var key = (isPair && entry.id) ? (String(entry.id) + '::' + tab) : tab;
    try {
      if (hiringTabDissolved_(tab)) {
        // Never rebuild for a fingerprint: the write path bumps a cache counter, and absent means unchanged.
        var bump = '0';
        try { bump = CacheService.getScriptCache().get('hiring_legacy_rev_' + tab) || '0'; }
        catch (eB) { bump = '?'; }
        revs[key] = 'dsv:' + bump;
        continue;
      }
      // Resolve through hubTabSheet_: a moved tab read from the emptied HUB_DB would answer 'unchanged' forever.
      var sheet = (isPair && entry.id)
        ? hubHouseTabIn_(ssOpen_(String(entry.id)), tab)
        : hubTabSheet_(tab);
      if (!sheet) { revs[key] = 'absent'; continue; }
      var rows = sheet.getLastRow();
      if (rows < 2) { revs[key] = 'empty'; continue; }
      var last = sheet.getRange(rows, 1, 1, sheet.getLastColumn()).getValues()[0];
      revs[key] = rows + ':' + String(last.join('')).length + ':' +
        Utilities.base64Encode(Utilities.computeDigest(
          Utilities.DigestAlgorithm.MD5, last.join(''), Utilities.Charset.UTF_8)).slice(0, 12);
    } catch (e) {
      // Unreadable means unknown, never unchanged.
      revs[key] = 'error';
    }
  }
  // The build stamp must ride revs: the resources call is skipped exactly when a carry is being decided.
  return { status: 200, data: { revs: revs, read_at: new Date().toISOString(),
                                code: (typeof HUB_CODE_BUILD !== 'undefined') ? String(HUB_CODE_BUILD) : '' } };
}

// Keyed by the original header names: the same shape the Postgres mirror stores.
function bulkTabsRead_(payload) {
  var names = (payload && payload.tabs) || [];
  if (!names.length || !Array.isArray(names)) {
    return { status: 400, message: 'tabs: a list of tab names is required.' };
  }
  var wanted = names.slice(0, BULK_MAX_TABS);
  var out = {};
  for (var i = 0; i < wanted.length; i++) {
    var tab = String(wanted[i]);
    try {
      var moved = hiringTabDissolved_(tab) ? hiringLegacyRawRows_(tab) : null;
      if (moved !== null) { out[tab] = moved; continue; }
      // Houses first: the missing-tab guard below would serve [] while the house holds every row.
      var house = (typeof houseSheetFor_ === 'function') ? houseSheetFor_(tab) : null;
      if (house) { out[tab] = readTabRawKeys_(house.getParent(), tab); continue; }
      var ss = hubTabWorkbook_(tab);
      out[tab] = (ss && hubHouseTabIn_(ss, tab)) ? readTabRawKeys_(ss, tab) : [];
    } catch (e) {
      out[tab] = [];
    }
  }
  return {
    status: 200,
    data: {
      tabs: out,
      // The builder stamps its slices with this, so a slice's age is the data's age.
      read_at: new Date().toISOString(),
      truncated: names.length > wanted.length
    }
  };
}

// List only, through route()'s own path: one implementation per shape, and a payload cannot name an action.
var BULK_MAX_RESOURCES = 4;

function bulkResourcesRead_(payload, user) {
  var names = (payload && payload.resources) || [];
  if (!names.length || !Array.isArray(names)) {
    return { status: 400, message: 'resources: a list of resource names is required.' };
  }
  var wanted = names.slice(0, BULK_MAX_RESOURCES);
  var out = {}, failed = {}, deps = {};
  for (var i = 0; i < wanted.length; i++) {
    var name = String(wanted[i]);
    try {
      // Dependencies are observed, never declared; an empty set means "not seen" and must always recompute.
      var watched = depsWatch_(function () { return route(name, 'list', {}, user); });
      var res = watched.value;
      if (res && res.status === 200) {
        out[name] = res.data || [];
        deps[name] = watched.deps;
      } else {
        failed[name] = (res && res.message) || 'refused';
      }
    } catch (e) {
      failed[name] = String(e).slice(0, 160);
    }
  }
  var pairs = [], seen = {};
  for (var r in deps) {
    if (!deps.hasOwnProperty(r)) continue;
    for (var d = 0; d < deps[r].length; d++) {
      var k = deps[r][d];
      if (seen[k]) continue;
      seen[k] = true;
      var cut = k.indexOf('::');
      pairs.push({ id: k.slice(0, cut), tab: k.slice(cut + 2) });
    }
  }
  var sizes = {};
  if (pairs.length) {
    try { sizes = ((bulkTabsRevs_({ tabs: pairs }) || {}).data || {}).revs || {}; }
    catch (eRev) { sizes = {}; }
  }
  return {
    status: 200,
    data: {
      resources: out,
      failed: failed,
      deps: deps,
      sizes: sizes,
      code: (typeof HUB_CODE_BUILD !== 'undefined') ? String(HUB_CODE_BUILD) : '',
      read_at: new Date().toISOString(),
      truncated: names.length > wanted.length
    }
  };
}
