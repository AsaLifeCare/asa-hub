// Sheet look-alike over facts for dissolved tabs; one per tab per execution so every reader sees its writes.
var RUNTIME_SHEET_MEMO = {};

function runtimeSheetFor_(tabName) {
  if (typeof hiringTabDissolved_ !== 'function' || !hiringTabDissolved_(tabName)) return null;
  var tab = String(tabName);
  if (RUNTIME_SHEET_MEMO[tab]) return RUNTIME_SHEET_MEMO[tab];
  RUNTIME_SHEET_MEMO[tab] = runtimeSheetMake_(tab);
  return RUNTIME_SHEET_MEMO[tab];
}

function runtimeSheetMake_(tabName) {
  var tab = String(tabName);
  var rows = hiringLegacyRows_(tab) || [];
  var header = runtimeSheetHeader_(tab, rows);
  var grid = [header.slice()];
  rows.forEach(function (r) {
    grid.push(header.map(function (h) {
      var k = normKey_ ? normKey_(h) : String(h).replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
      return r[k] === undefined ? '' : String(r[k]);
    }));
  });

  function subjectOf(rowIndex) {          // 1-based, header is row 1
    var r = rows[rowIndex - 2];
    return r ? hiringRowKey_(tab, r) : '';
  }
  function write(rowIndex, colIndex, value) {
    // Row 1 widens the header (ensureHeader_ relies on it); names stay in raw sheet spelling.
    if (rowIndex === 1) {
      var name = String(value == null ? '' : value).trim();
      if (name) { header[colIndex - 1] = name; grid[0] = header.slice(); }
      return;
    }
    var col = header[colIndex - 1];
    if (!col) return;
    var sub = subjectOf(rowIndex);
    if (!sub) return;
    if (grid[rowIndex - 1]) grid[rowIndex - 1][colIndex - 1] = String(value == null ? '' : value);
    hiringLegacyWrite_(tab, sub, runtimeSheetOne_(col, value), 'runtime-sheet');
  }

  var api = {
    getName: function () { return tab; },
    getLastRow: function () { return grid.length; },
    getLastColumn: function () { return header.length; },
    getMaxRows: function () { return grid.length; },
    getMaxColumns: function () { return header.length; },
    getDataRange: function () { return api.getRange(1, 1, grid.length, header.length); },
    getRange: function (a, b, c, d) {
      var pos = runtimeSheetPos_(a, b, c, d, header.length, grid.length);
      return {
        getValue: function () {
          var line = grid[pos.row - 1] || [];
          return line[pos.col - 1] === undefined ? '' : line[pos.col - 1];
        },
        getValues: function () {
          var out = [];
          for (var i = 0; i < pos.rows; i++) {
            var line = grid[pos.row - 1 + i] || [];
            var one = [];
            for (var j = 0; j < pos.cols; j++) {
              one.push(line[pos.col - 1 + j] === undefined ? '' : line[pos.col - 1 + j]);
            }
            out.push(one);
          }
          return out;
        },
        setValue: function (v) { write(pos.row, pos.col, v); return this; },
        setValues: function (vals) {
          (vals || []).forEach(function (line, i) {
            (line || []).forEach(function (v, j) { write(pos.row + i, pos.col + j, v); });
          });
          return this;
        },
        setNumberFormat: function () { return this; },
        setNumberFormats: function () { return this; },
        setFontWeight: function () { return this; },
        setBackground: function () { return this; },
        clearContent: function () { return this; }
      };
    },
    appendRow: function (arr) {
      var vals = {};
      (arr || []).forEach(function (v, i) { if (header[i]) vals[header[i]] = v; });
      // hiringRowKey_ probes normalized names, so the probe carries both spellings.
      var probe = {};
      Object.keys(vals).forEach(function (k) {
        probe[k] = vals[k];
        var n = (typeof normKey_ === 'function')
          ? normKey_(k)
          : String(k).replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
        if (probe[n] === undefined) probe[n] = vals[k];
      });
      var sub = hiringRowKey_(tab, probe);
      if (!sub) return api;
      grid.push(header.map(function (h) { return vals[h] === undefined ? '' : String(vals[h]); }));
      hiringLegacyWrite_(tab, sub, vals, 'runtime-sheet:append');
      return api;
    },
    deleteRow: function (rowIndex) {
      // Splices like a real sheet, so callers that loop descending stay correct.
      var sub = subjectOf(rowIndex);
      if (sub) hiringLegacyWrite_(tab, sub, { __deleted: 'true' }, 'runtime-sheet:delete');
      if (rowIndex >= 2) { rows.splice(rowIndex - 2, 1); grid.splice(rowIndex - 1, 1); }
      return api;
    },
    clearContents: function () {
      rows.forEach(function (r) {
        var sub = hiringRowKey_(tab, r);
        if (sub) hiringLegacyWrite_(tab, sub, { __deleted: 'true' }, 'runtime-sheet:clear');
      });
      rows.length = 0; grid.length = 1;
      return api;
    },
    setFrozenRows: function () { return api; },
    insertRowsAfter: function () { return api; },
    insertColumnsAfter: function () { return api; },
    sort: function () { return api; },
    getSheetId: function () { return 0; },
    // depNote_ needs this; without it the slice builder silently misses the dissolved source.
    getParent: function () {
      var rid = '';
      try { rid = hubRuntimeId_(); } catch (e) {}
      return {
        getId: function () { return rid; },
        getSpreadsheetTimeZone: function () { return 'Etc/GMT'; }
      };
    },
    isRuntimeBacked: true
  };
  return api;
}

// Raw sheet spellings first (callers indexOf `cjis_status`), then fact-only columns, normalized.
function runtimeSheetHeader_(tab, rows) {
  var out = [], seen = {};
  var raw = null;
  try { raw = hiringLegacyHeader_(tab); } catch (e) { raw = null; }
  (raw || []).forEach(function (h) {
    var k = normKey_ ? normKey_(h) : String(h).replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
    if (k && !seen[k]) { seen[k] = 1; out.push(String(h)); }
  });
  if (!out.length) { seen.candidateid = 1; out.push('candidateid'); }
  (rows || []).forEach(function (r) {
    for (var k in r) { if (!seen[k]) { seen[k] = 1; out.push(k); } }
  });
  return out;
}

function runtimeSheetOne_(col, value) {
  var one = {};
  one[col] = value;
  return one;
}

function runtimeSheetPos_(a, b, c, d, cols, rows) {
  if (typeof a === 'string') {
    var m = String(a).toUpperCase().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
    if (!m) return { row: 1, col: 1, rows: 1, cols: 1 };
    var c1 = runtimeSheetCol_(m[1]), r1 = parseInt(m[2], 10);
    var c2 = m[3] ? runtimeSheetCol_(m[3]) : c1;
    var r2 = m[4] ? parseInt(m[4], 10) : r1;
    return { row: r1, col: c1, rows: Math.max(1, r2 - r1 + 1), cols: Math.max(1, c2 - c1 + 1) };
  }
  return { row: a || 1, col: b || 1,
           rows: c || 1, cols: d || 1 };
}

function runtimeSheetCol_(letters) {
  var n = 0;
  String(letters).split('').forEach(function (ch) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  });
  return n || 1;
}
