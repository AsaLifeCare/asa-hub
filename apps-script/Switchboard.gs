// Controls are depot facts stamped `switchboard:<area>.<key>`; {} means nothing is switched on.
var SWITCHBOARD_VALUES_MEMO = {};
function switchboardValues_(area) {
  var want = String(area || '').trim();
  if (!want) return {};
  // Keyed by the cache key: a bare area such as `constructor` would hit Object.prototype.
  var cacheKey = 'hub_switchboard_v1_' + want;
  if (SWITCHBOARD_VALUES_MEMO[cacheKey]) return SWITCHBOARD_VALUES_MEMO[cacheKey];
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(cacheKey);
    if (hit) {
      SWITCHBOARD_VALUES_MEMO[cacheKey] = JSON.parse(hit);
      return SWITCHBOARD_VALUES_MEMO[cacheKey];
    }
  } catch (e) {}

  var map = {};
  try {
    var stamp = 'switchboard:' + want + '.';
    var sheet = ssOpen_(hubRuntimeId_()).getSheetByName('Facts');
    var found = sheet ? sheet.createTextFinder(stamp).matchEntireCell(false).findAll() : [];
    if (found.length) {
      var first = found[0].getRow(), last = first;
      for (var i = 1; i < found.length; i++) {
        var r = found[i].getRow();
        if (r < first) first = r;
        if (r > last) last = r;
      }
      // B..E in one call: Subject ID, Value, Type, Source.
      var block = sheet.getRange(first, 2, last - first + 1, 4).getValues();
      for (var j = 0; j < block.length; j++) {
        var src = String(block[j][3] || '');
        if (src.indexOf(stamp) !== 0) continue;
        var key = src.slice(stamp.length) || String(block[j][0] || '');
        if (key) map[key] = String(block[j][1] == null ? '' : block[j][1]);
      }
    }
  } catch (e2) { map = {}; }

  try { cache.put(cacheKey, JSON.stringify(map), 300); } catch (e3) {}
  SWITCHBOARD_VALUES_MEMO[cacheKey] = map;
  return map;
}

// Only for admin jobs that write a fact and read it back; request paths keep the five-minute cache.
function switchboardForget_(area) {
  var want = String(area || '').trim();
  if (!want) return;
  var cacheKey = 'hub_switchboard_v1_' + want;
  try { delete SWITCHBOARD_VALUES_MEMO[cacheKey]; } catch (eMemo) {}
  try { CacheService.getScriptCache().remove(cacheKey); } catch (eCache) {}
}

function switchboardOn_(value) {
  var v = String(value == null ? '' : value).trim().toLowerCase();
  return v === 'on' || v === 'true' || v === '1' || v === 'yes';
}

// The busy flag stops the ledger read recursing through hubProp_ for the runtime id itself.
var SWITCHBOARD_PROP_BUSY = false;
function switchboardProp_(key) {
  var k = String(key || '');
  if (!k || SWITCHBOARD_PROP_BUSY) return '';
  SWITCHBOARD_PROP_BUSY = true;
  var v = '';
  try { v = String(switchboardValues_('props')[k] || ''); } catch (e) { v = ''; }
  SWITCHBOARD_PROP_BUSY = false;
  return v;
}
