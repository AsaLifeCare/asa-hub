// Reads are cached until something writes: every write path must call cacheBump_.

var CACHE_TTL_SECONDS = 600;
var CACHE_CHUNK_BYTES = 90000;      // CacheService silently drops entries over ~100KB
var CACHE_MAX_CHUNKS = 20;

// Per-execution memo of text, never parsed values, so callers never share a mutable array.
var CACHE_MEMO_ = {};
var CACHE_DEPS_ = {};

// Dependencies are observed, never declared; a derivation that observed nothing is never carried forward.
var DEPS_SEEN_ = null;

function depNote_(bookId, tab) {
  if (!DEPS_SEEN_) return;
  var t = String(tab || '');
  if (!t) return;
  DEPS_SEEN_[String(bookId || '') + '::' + t] = true;
}

function depNoteAll_(keys) {
  if (!DEPS_SEEN_ || !keys) return;
  for (var i = 0; i < keys.length; i++) DEPS_SEEN_[keys[i]] = true;
}

function depsWatch_(fn) {
  var outer = DEPS_SEEN_;
  DEPS_SEEN_ = {};
  var mine;
  try {
    var value = fn();
    mine = DEPS_SEEN_;
    return { value: value, deps: objectKeys_(mine) };
  } finally {
    DEPS_SEEN_ = outer;
    if (outer && mine) for (var k in mine) if (mine.hasOwnProperty(k)) outer[k] = true;
  }
}

function objectKeys_(o) {
  var out = [];
  for (var k in o) if (o.hasOwnProperty(k)) out.push(k);
  out.sort();
  return out;
}

// Only a successful open is memoised: a bad id must throw every time.
var SS_OPEN_MEMO_ = {};

function ssOpen_(id) {
  var key = String(id || '');
  if (!key) return SpreadsheetApp.openById(key);
  if (SS_OPEN_MEMO_[key]) return SS_OPEN_MEMO_[key];
  var ss = SpreadsheetApp.openById(key);
  SS_OPEN_MEMO_[key] = ss;
  return ss;
}

function cacheVersion_(scope) {
  // Never memoised: another execution may bump the version mid-run.
  var cache = CacheService.getScriptCache();
  var key = 'ver_' + scope;
  var v = cache.get(key);
  if (!v) {
    v = String(Date.now());
    cache.put(key, v, 21600);
  }
  return v;
}

// One sheet, one scope, so any writer retires it for every reader.
function cacheScopeSheet_(ssId, tab) {
  return 'sh_' + String(ssId || '').slice(0, 8) + '_' + String(tab || '');
}

function cacheBump_(scope) {
  var v = String(Date.now());
  try {
    CacheService.getScriptCache().put('ver_' + scope, v, 21600);
  } catch (e) { }
}

function cacheChunkKeys_(base, count) {
  var keys = [];
  for (var i = 0; i < count; i++) keys.push(base + ':' + i);
  return keys;
}

// Every failure falls back to producing: a cache must never break the app.
function cacheRead_(scope, name, producer) {
  var cache = CacheService.getScriptCache();
  var base = 'c:' + scope + ':' + cacheVersion_(scope) + ':' + name;

  if (CACHE_MEMO_.hasOwnProperty(base)) {
    try {
      // A hit replays the deps a miss observed, or the derivation looks independent.
      depNoteAll_(CACHE_DEPS_[base]);
      return JSON.parse(CACHE_MEMO_[base]);
    } catch (eM) { delete CACHE_MEMO_[base]; }
  }

  try {
    var head = cache.get(base + ':n');
    if (head) {
      var n = parseInt(head, 10);
      var parts = cache.getAll(cacheChunkKeys_(base, n));
      var joined = '';
      for (var i = 0; i < n; i++) {
        var part = parts[base + ':' + i];
        if (part === undefined || part === null) { joined = ''; break; }
        joined += part;
      }
      if (joined) {
        CACHE_MEMO_[base] = joined;
        // Note the book the tab lives in now, never HUB_DB; '' for a dissolved scope.
        var depBook = '';
        try {
          var depWb = (typeof hubTabWorkbook_ === 'function') ? hubTabWorkbook_(scope) : null;
          depBook = depWb ? depWb.getId() : '';
        } catch (eDepBook) { depBook = ''; }
        depNote_(depBook, scope);
        return JSON.parse(joined);
      }
    }
  } catch (e) { }

  var watched = depsWatch_(producer);
  var value = watched.value;
  CACHE_DEPS_[base] = watched.deps;
  depNoteAll_(watched.deps);
  try {
    var text = JSON.stringify(value);
    CACHE_MEMO_[base] = text;
    var chunks = Math.ceil(text.length / CACHE_CHUNK_BYTES);
    if (chunks <= CACHE_MAX_CHUNKS) {
      var payload = { };
      for (var c = 0; c < chunks; c++) {
        payload[base + ':' + c] = text.substr(c * CACHE_CHUNK_BYTES, CACHE_CHUNK_BYTES);
      }
      payload[base + ':n'] = String(chunks);
      cache.putAll(payload, CACHE_TTL_SECONDS);
    }
  } catch (e2) { }
  return value;
}

/** What the cache is holding right now, per tab. */
HUB_POLICY.cacheStatus = {
  file: 'Cache.gs', lane: 'read', store: 'json',
  idempotent: true, cost: 'instant',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.cacheStatus = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var scopes = Object.keys(RESOURCES).map(function (r) { return RESOURCES[r].sheet; });
  var out = [];
  for (var i = 0; i < scopes.length; i++) {
    var base = 'c:' + scopes[i] + ':' + cacheVersion_(scopes[i]) + ':rows';
    out.push({ tab: scopes[i], cached: Boolean(CacheService.getScriptCache().get(base + ':n')) });
  }
  return { status: 200, data: { ttl_seconds: CACHE_TTL_SECONDS, tabs: out } };
};

/** Drop everything, for a sheet edited by hand that must show now. */
HUB_POLICY.cacheClear = {
  file: 'Cache.gs', lane: 'tool', store: 'json',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.cacheClear = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var scopes = Object.keys(RESOURCES).map(function (r) { return RESOURCES[r].sheet; });
  scopes.push('hub_dyn');
  for (var i = 0; i < scopes.length; i++) cacheBump_(scopes[i]);
  hubSysLog_(user && user.email, 'cache_clear', String(scopes.length) + ' tab(s)', { status: 200 });
  return { status: 200, data: { cleared: scopes.length } };
};
