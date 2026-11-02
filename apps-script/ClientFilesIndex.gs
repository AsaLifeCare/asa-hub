// client_files without its OCR and digest columns, grouped by client and kept in the script cache until…
// A reader takes candidate rows and applies its own match; a screen that shows one paper's digest reads that row…

var CFX_COLS = ['id', 'client_key', 'client_name', 'title', 'folder', 'kind', 'doc_kind', 'subject', 'digest_category',
                'mime_type', 'drive_id', 'url', 'size_bytes', 'file_date', 'issued_on', 'expires_on', 'modified_time',
                'createdAt', 'digest_state', 'digest_text_chars', 'text_file'];
var CFX_CHUNK = 90000;
var CFX_PUT_BATCH = 100;
// this execution's manifest and group texts (never parsed rows a caller could change), for one cache version
var CFX_MEMO_ = {};

/** Every row of client_files, slim, in sheet order. */
function clientFilesAll_() {
  return cfxRows_(function (man) { return man.owners.map(function (o, i) { return i; }); });
}

/** The rows that may be these clients': each key's rows and every row carrying one of these folded names. */
function clientFilesFor_(keys, nameKeys) {
  return cfxRows_(function (man) {
    var gis = [];
    var add = function (gi) { if (gis.indexOf(gi) === -1) gis.push(gi); };
    (keys || []).forEach(function (k) {
      var t = String(k == null ? '' : k).trim();
      var gi = t ? man.owners.indexOf(t) : -1;
      if (gi !== -1) add(gi);
    });
    (nameKeys || []).forEach(function (n) {
      var list = Object.prototype.hasOwnProperty.call(man.names, n) ? man.names[n] : [];
      list.forEach(add);
    });
    return gis;
  });
}

// One row whole, its OCR and digest columns too: at its sheet row while that row still holds it, else found by its…
function clientFileWhole_(slim) {
  var sheet = sheetFor_('clientFiles');
  var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return null;
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var idAt = header.lastIndexOf('id'), fileAt = header.lastIndexOf('drive_id');
  var id = String(slim && slim.id != null ? slim.id : ''), file = String(slim && slim.drive_id != null ? slim.drive_id : '');
  var cell = function (line, at) { return String(deserialize_(line[at])); };
  var same = function (line) {
    return (idAt === -1 || cell(line, idAt) === id) && (fileAt === -1 || cell(line, fileAt) === file);
  };
  var line = null, row = Number(slim && slim._row) || 0;
  if (row >= 2 && row <= lastRow) {
    line = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
    if (!same(line)) line = null;
  }
  if (!line) {
    var col = idAt !== -1 && id ? idAt : fileAt;
    if (col === -1) return null;
    var want = col === idAt ? id : file;
    var keys = sheet.getRange(2, col + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length && !line; i++) {
      if (cell(keys[i], 0) !== want) continue;
      var got = sheet.getRange(i + 2, 1, 1, lastCol).getValues()[0];
      if (same(got)) line = got;
    }
  }
  if (!line) return null;
  var obj = {};
  header.forEach(function (h, i) { if (h !== '') obj[h] = deserialize_(line[i]); });
  return obj;
}

// ---- the sheet ----------------------------------------------------------------

/** The slim columns of every non-empty row, in sheet order, each with its sheet row (_row): one read per column run. */
function cfxSheetRows_() {
  var sheet = sheetFor_('clientFiles');
  try { depNote_(sheet.getParent().getId(), sheet.getName()); } catch (eDep) {}
  var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  // a repeated header: the last column wins, as readAll_
  var at = {};
  header.forEach(function (h, i) { if (CFX_COLS.indexOf(h) !== -1) at[h] = i; });
  var cols = Object.keys(at).map(function (h) { return at[h]; }).sort(function (a, b) { return a - b; });
  var runs = [];
  cols.forEach(function (c) {
    var last = runs[runs.length - 1];
    if (last && last.to === c - 1) last.to = c;
    else runs.push({ from: c, to: c });
  });
  var n = lastRow - 1;
  runs.forEach(function (run) { run.grid = sheet.getRange(2, run.from + 1, n, run.to - run.from + 1).getValues(); });
  var fields = Object.keys(at).map(function (h) {
    var run = runs.filter(function (x) { return at[h] >= x.from && at[h] <= x.to; })[0];
    return { name: h, grid: run.grid, off: at[h] - run.from };
  });
  var out = [];
  for (var r = 0; r < n; r++) {
    var obj = {}, empty = true;
    for (var f = 0; f < fields.length; f++) {
      var v = fields[f].grid[r][fields[f].off];
      if (v !== '' && v !== null) empty = false;
      obj[fields[f].name] = deserialize_(v);
    }
    if (empty) continue;
    obj._row = r + 2;
    out.push(obj);
  }
  return out;
}

// ---- the cache ----------------------------------------------------------------

function cfxScope_() {
  return cacheScope_(tabFor_('clientFiles'));
}

function cfxNoteDep_() {
  if (!DEPS_SEEN_) return;
  try {
    var tab = tabFor_('clientFiles');
    var wb = hubTabWorkbook_(tab);
    depNote_(wb ? wb.getId() : '', tab);
  } catch (e) { /* observed deps are a hint */ }
}

/** Grouped by owner (the trimmed key, else '~' and the folded name); every folded name lists the groups carrying it. */
function cfxEncode_(rows) {
  var owners = [], groups = [], at = {}, names = {};
  (rows || []).forEach(function (r, p) {
    var key = String(r.client_key == null ? '' : r.client_key).trim();
    var nk = clientNameKey_(r.client_name);
    var owner = key || '~' + nk;
    var gi = Object.prototype.hasOwnProperty.call(at, owner) ? at[owner] : (at[owner] = owners.push(owner) - 1);
    if (!groups[gi]) groups[gi] = [];
    var line = [p, Number(r._row) || 0];
    var drive = String(r.drive_id == null ? '' : r.drive_id);
    CFX_COLS.forEach(function (c) {
      if (!Object.prototype.hasOwnProperty.call(r, c)) { line.push(null); return; }
      // a url naming the row's own drive id says nothing the id does not
      line.push(c === 'url' && drive && locationsDriveId_(r.url) === drive ? '' : r[c]);
    });
    groups[gi].push(line);
    var list = Object.prototype.hasOwnProperty.call(names, nk) ? names[nk] : (names[nk] = []);
    if (list.indexOf(gi) === -1) list.push(gi);
  });
  var texts = {}, chunks = [];
  groups.forEach(function (g, gi) {
    texts[gi] = JSON.stringify(g);
    chunks.push(Math.max(1, Math.ceil(texts[gi].length / CFX_CHUNK)));
  });
  return { man: { cols: CFX_COLS.slice(), owners: owners, chunks: chunks, names: names }, texts: texts };
}

function cfxDecode_(cols, texts) {
  var lines = [];
  texts.forEach(function (t) { JSON.parse(t).forEach(function (l) { lines.push(l); }); });
  lines.sort(function (a, b) { return a[0] - b[0]; });
  return lines.map(function (l) {
    var o = {};
    for (var i = 0; i < cols.length; i++) if (l[i + 2] !== null) o[cols[i]] = l[i + 2];
    if (l[1]) o._row = l[1];
    return o;
  });
}

function cfxParts_(text) {
  var out = [];
  for (var i = 0; i < text.length; i += CFX_CHUNK) out.push(text.substr(i, CFX_CHUNK));
  return out.length ? out : [''];
}

/** The groups first, the manifest last: a manifest found promises every group under it. */
function cfxKeep_(cache, base, enc) {
  var batch = {}, count = 0, batches = [];
  var put = function (k, v) {
    batch[k] = v;
    if (++count >= CFX_PUT_BATCH) { batches.push(batch); batch = {}; count = 0; }
  };
  Object.keys(enc.texts).forEach(function (gi) {
    cfxParts_(enc.texts[gi]).forEach(function (part, j) { put(base + ':g' + gi + ':' + j, part); });
  });
  if (count) batches.push(batch);
  batches.forEach(function (b) { cache.putAll(b, CACHE_TTL_SECONDS); });
  var man = {}, parts = cfxParts_(JSON.stringify(enc.man));
  parts.forEach(function (part, j) { man[base + ':m:' + j] = part; });
  man[base + ':m:n'] = String(parts.length);
  cache.putAll(man, CACHE_TTL_SECONDS);
}

/** The slim read, kept under `base` when there is a cache; kept or not, it answers this read. */
function cfxBuild_(base, cache) {
  var enc = cfxEncode_(cfxSheetRows_());
  var state = { base: base, cache: cache, man: enc.man, texts: enc.texts };
  if (base && cache) {
    try { cfxKeep_(cache, base, enc); CFX_MEMO_ = state; } catch (e) { /* the next read builds again */ }
  }
  return state;
}

/** The version is read before the sheet, so a write landing during the read retires what it kept. */
function cfxState_() {
  var base = '';
  try {
    var scope = cfxScope_();
    base = 'cfx1:' + scope + ':' + cacheVersion_(scope);
  } catch (eS) { base = ''; }
  if (base && CFX_MEMO_.base === base) return CFX_MEMO_;
  var cache = null;
  if (base) { try { cache = CacheService.getScriptCache(); } catch (eC) { cache = null; } }
  if (cache) {
    var man = null;
    try {
      var n = parseInt(cache.get(base + ':m:n'), 10);
      if (n > 0) man = JSON.parse(cfxJoin_(cache, base + ':m', n));
    } catch (eM) { man = null; }
    if (man && man.owners && man.chunks && man.names && man.cols) {
      cfxNoteDep_();
      CFX_MEMO_ = { base: base, cache: cache, man: man, texts: {} };
      return CFX_MEMO_;
    }
  }
  return cfxBuild_(base, cache);
}

function cfxJoin_(cache, prefix, n) {
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(prefix + ':' + i);
  var got = cache.getAll(keys), text = '';
  for (var j = 0; j < n; j++) {
    if (typeof got[keys[j]] !== 'string') throw new Error('a cached part is gone');
    text += got[keys[j]];
  }
  return text;
}

/** The groups' texts, fetched in one call; null when the cache lost any of them. */
function cfxTexts_(state, gis) {
  var need = gis.filter(function (gi) { return !Object.prototype.hasOwnProperty.call(state.texts, gi); });
  if (need.length) {
    if (!state.cache) return null;
    var keys = [];
    need.forEach(function (gi) { for (var j = 0; j < state.man.chunks[gi]; j++) keys.push(state.base + ':g' + gi + ':' + j); });
    var got;
    try { got = state.cache.getAll(keys); } catch (e) { return null; }
    for (var i = 0; i < need.length; i++) {
      var text = '';
      for (var j = 0; j < state.man.chunks[need[i]]; j++) {
        var part = got[state.base + ':g' + need[i] + ':' + j];
        if (typeof part !== 'string') return null;
        text += part;
      }
      state.texts[need[i]] = text;
    }
  }
  return gis.map(function (gi) { return state.texts[gi]; });
}

function cfxRows_(pick) {
  var state = cfxState_();
  var texts = cfxTexts_(state, pick(state.man));
  if (!texts) {
    state = cfxBuild_(state.base, state.cache);
    texts = cfxTexts_(state, pick(state.man));
  }
  return cfxDecode_(state.man.cols, texts);
}
