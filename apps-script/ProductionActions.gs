// Production Actions: the go-live runbook. The handlers answer 404 to all but the master; nothing here sends a message.

var PA_ACTIONS_HOUSE = 'production_actions';
var PA_RUNS_HOUSE = 'production_action_runs';

var PA_ACTIONS_HEADER = [
  'id', 'createdAt', 'updatedAt', 'updated_by',
  'number', 'phase', 'title', 'system', 'kind', 'handler', 'params',
  'how', 'link', 'requires', 'effect', 'enabled'
];

var PA_RUNS_HEADER = [
  'id', 'createdAt', 'updatedAt',
  'action_id', 'number', 'title',
  'act', 'result', 'expect', 'test_mode', 'dial',
  'by_email', 'by_name', 'client_id',
  'def_sha', 'preview_sha', 'target', 'detail',
  'before', 'after', 'undoes', 'mock_row_id', 'tenant'
];

var PA_EDITABLE = ['number', 'phase', 'title', 'system', 'kind', 'handler', 'params',
                   'how', 'link', 'requires', 'effect', 'enabled'];

var PA_PHASES = ['before', 'at', 'after'];
var PA_KINDS = ['automatic', 'manual'];
var PA_HANDLER_IDS = ['banner', 'link', 'form_close'];
var PA_PREVIEW_MAX = 12;
var PA_LOCK_MS = 20000;
var PA_LOG = 'asa-hub:production-actions';
var PA_UNDECLARED = 'The runbook\'s Google Sheets are not set up yet.';
var PA_FORM_OWN = 'That form, or the book its answers land in, is one of the platform\'s own — close an outside form only.';
var PA_DRIVE_ID = /^[A-Za-z0-9_-]{20,80}$/;
var PA_HEX = /^#[0-9A-Fa-f]{6}$/;
var PA_COLOUR_WORDS = { '#8B0000': 'blood red', '#FFFFFF': 'white', '#000000': 'black' };

function paStr_(v) { return String(v == null ? '' : v).trim(); }

function paErr_(e) { return String((e && e.message) || e).slice(0, 200); }

function paNow_() { return new Date().toISOString(); }

function paDenied_(name) { return { status: 404, message: 'Unknown action: "' + name + '".' }; }

function paGate_(user, name) {
  if (!user || user.is_service || String(user.role) !== 'admin') return paDenied_(name);
  if (!hubIsMaster_(paStr_(user.email))) return paDenied_(name);
  if (hubAwayTenant_()) return paDenied_(name);
  return null;
}

function paHouseReady_(tab) {
  try { return !!houseMoved_(tab); } catch (e) { return false; }
}

function paHousesReady_() {
  return paHouseReady_(PA_ACTIONS_HOUSE) && paHouseReady_(PA_RUNS_HOUSE);
}

function paHeaderOf_(tab) { return tab === PA_ACTIONS_HOUSE ? PA_ACTIONS_HEADER : PA_RUNS_HEADER; }

function paSheet_(tab) {
  if (!paHouseReady_(tab)) throw new Error(PA_UNDECLARED);
  return hubTabEnsure_(tab, paHeaderOf_(tab));
}

function paCellText_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return cellText_(v) || '';
  return String(v).trim();
}

function paRows_(tab) {
  var values = paSheet_(tab).getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0].map(function (h) { return String(h || '').trim(); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = { _row: r + 1 };
    for (var c = 0; c < header.length; c++) if (header[c]) row[header[c]] = paCellText_(values[r][c]);
    if (row.id) out.push(row);
  }
  return out;
}

function paLine_(header, row) {
  return header.map(function (h) {
    var v = Object.prototype.hasOwnProperty.call(row, h) ? row[h] : '';
    if (v !== null && typeof v === 'object') v = JSON.stringify(v);
    return hubCellSafe_(String(v == null ? '' : v));
  });
}

function paWriteAt_(sheet, at, line) {
  if (at > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), at - sheet.getMaxRows());
  var range = sheet.getRange(at, 1, 1, line.length);
  range.setNumberFormat('@');
  range.setValues([line]);
}

function paAppend_(tab, row) {
  var sheet = paSheet_(tab);
  var header = ensureHeader_(sheet, paHeaderOf_(tab));
  paWriteAt_(sheet, Math.max(sheet.getLastRow(), 1) + 1, paLine_(header, row));
}

function paPut_(tab, row) {
  var sheet = paSheet_(tab);
  var header = ensureHeader_(sheet, paHeaderOf_(tab));
  var ids = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues() : [];
  var at = 0;
  for (var i = 0; i < ids.length; i++) if (paCellText_(ids[i][0]) === paStr_(row.id)) { at = i + 2; break; }
  paWriteAt_(sheet, at || Math.max(sheet.getLastRow(), 1) + 1, paLine_(header, row));
}

function paDefs_() { return paRows_(PA_ACTIONS_HOUSE); }
function paRuns_() { return paRows_(PA_RUNS_HOUSE); }

function paDefFind_(defs, id) {
  for (var i = 0; i < defs.length; i++) if (paStr_(defs[i].id) === paStr_(id)) return defs[i];
  return null;
}

function paByClient_(runs, clientId) {
  for (var i = 0; i < runs.length; i++) if (paStr_(runs[i].client_id) === clientId) return runs[i];
  return null;
}

function paEnabledWord_(v) {
  var s = paStr_(v).toLowerCase();
  return (s === 'no' || s === 'false' || s === '0' || s === 'off') ? 'no' : 'yes';
}

function paSha16_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('').slice(0, 16);
}

function paDefSha_(def) {
  return paSha16_([paStr_(def.id), paStr_(def.kind), paStr_(def.handler), paStr_(def.phase),
                   paEnabledWord_(def.enabled), paStr_(def.params)].join('\n'));
}

function paParams_(def) {
  var raw = paStr_(def.params);
  if (!raw) return { obj: {}, error: '' };
  try {
    var v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { obj: null, error: 'The params are not a JSON object.' };
    return { obj: v, error: '' };
  } catch (e) { return { obj: null, error: 'The params are not valid JSON.' }; }
}

function paColNum_(letters) {
  var n = 0;
  for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
}

function paColName_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function paA1_(a1) {
  var m = /^([A-Z]{1,3})(\d{1,7})(?::([A-Z]{1,3})(\d{1,7}))?$/.exec(paStr_(a1).toUpperCase());
  if (!m) return null;
  var out = { col: paColNum_(m[1]), row: Number(m[2]) };
  out.col2 = m[3] ? paColNum_(m[3]) : out.col;
  out.row2 = m[4] ? Number(m[4]) : out.row;
  if (out.row < 1 || out.col < 1 || out.col2 < out.col || out.row2 < out.row) return null;
  return out;
}

function paA1Text_(row, col, col2) {
  return paColName_(col) + row + (col2 > col ? ':' + paColName_(col2) + row : '');
}

function paUrlIn_(text) {
  var m = /https?:\/\/[^\s]+/.exec(String(text || ''));
  return m ? m[0] : '';
}

function paFormId_(v) {
  var s = paStr_(v);
  if (!s) return { id: '', published: false };
  var m = /\/forms\/d\/(e\/)?([A-Za-z0-9_-]{20,})/.exec(s);
  if (m) return m[1] ? { id: '', published: true } : { id: m[2], published: false };
  if (/^1FAIpQL/.test(s)) return { id: '', published: true };
  return PA_DRIVE_ID.test(s) ? { id: s, published: false } : { id: '', published: false };
}

function paHandlerProblems_(handler, p) {
  var out = [];
  var say = function (field, words) { out.push({ field: 'params.' + field, words: words }); };
  if (handler === 'banner') {
    if (!PA_DRIVE_ID.test(paStr_(p.book))) say('book', 'The book is a Drive id.');
    if (!/^\d{1,12}$/.test(paStr_(p.gid))) say('gid', 'The tab id (gid) is a whole number.');
    var r = paA1_(p.range);
    if (!r) say('range', 'The cells are one A1 range, like G1:N1.');
    else if (r.row !== r.row2) say('range', 'The cells are one row.');
    var text = paStr_(p.text);
    if (text.length < 3 || text.length > 500) say('text', 'The text is 3–500 characters.');
    ['background', 'color', 'tab_color'].forEach(function (k) {
      if (paStr_(p[k]) && !PA_HEX.test(paStr_(p[k]))) say(k, 'A colour is #RRGGBB.');
    });
    if (p.bold !== undefined && p.bold !== null && typeof p.bold !== 'boolean') say('bold', 'Bold is true or false.');
  } else if (handler === 'link') {
    if (!/^https:\/\/\S+$/.test(paStr_(p.url))) say('url', 'The link is https://…');
  } else if (handler === 'form_close') {
    var hasForm = !!paStr_(p.form), hasTab = !!paStr_(p.book) || !!paStr_(p.gid);
    if (hasForm === hasTab) say('form', 'Name the form (its edit id or edit link), or the book and tab id its answers land on — one of the two.');
    if (hasForm) {
      var f = paFormId_(p.form);
      if (f.published) say('form', 'That is the published id (/e/…) — a form opens by its edit id.');
      else if (!f.id) say('form', 'The form is its edit id or its edit link.');
    }
    if (hasTab) {
      if (!PA_DRIVE_ID.test(paStr_(p.book))) say('book', 'The book is a Drive id.');
      if (!/^\d{1,12}$/.test(paStr_(p.gid))) say('gid', 'The tab id (gid) is a whole number.');
    }
    var msg = paStr_(p.message);
    if (msg.length < 3 || msg.length > 500) say('message', 'The closed message is 3–500 characters.');
  }
  return out;
}

function paValidate_(def) {
  var problems = [];
  var say = function (field, words) { problems.push({ field: field, words: words }); };
  if (!/^[a-z0-9_]{2,40}$/.test(paStr_(def.id))) say('id', 'The id is 2–40 lowercase letters, digits or _.');
  var number = paStr_(def.number);
  if (!number || number.length > 6) say('number', 'The number is 1–6 characters.');
  if (PA_PHASES.indexOf(paStr_(def.phase)) === -1) say('phase', 'The phase is before, at or after.');
  var title = paStr_(def.title);
  if (title.length < 3 || title.length > 120) say('title', 'The title is 3–120 characters.');
  var kind = paStr_(def.kind), handler = paStr_(def.handler);
  if (PA_KINDS.indexOf(kind) === -1) say('kind', 'The kind is automatic or manual.');
  else if (kind === 'automatic' && PA_HANDLER_IDS.indexOf(handler) === -1) {
    say('handler', 'An automatic action needs a handler: ' + PA_HANDLER_IDS.join(', ') + '.');
  } else if (kind === 'manual' && handler) {
    say('handler', 'A manual action has no handler — make it automatic to use one.');
  }
  var link = paStr_(def.link);
  if (link && !/^https:\/\/\S+$/.test(link) && !/^\/apps?(\/\S*)?$/.test(link)) {
    say('link', 'The link is https://… or an in-app /app/… path.');
  }
  if (kind === 'automatic' && PA_HANDLER_IDS.indexOf(handler) !== -1) {
    var p = paParams_(def);
    if (!p.obj) say('params', p.error);
    else problems = problems.concat(paHandlerProblems_(handler, p.obj));
  }
  return problems;
}

function paDefOut_(def) {
  var out = {};
  PA_ACTIONS_HEADER.forEach(function (h) { out[h] = paStr_(def[h]); });
  var p = paParams_(def);
  out.params_obj = p.obj;
  if (p.error) out.params_error = p.error;
  out.def_sha = paDefSha_(def);
  return out;
}

function paRunOut_(row) {
  var out = {};
  PA_RUNS_HEADER.forEach(function (h) {
    if (h === 'before' || h === 'after') return;
    var v = row[h];
    out[h] = (v !== null && typeof v === 'object') ? JSON.stringify(v) : paStr_(v);
  });
  var b = row.before;
  var kept = b && typeof b === 'object' ? Object.keys(b).length > 0 : !!paStr_(b);
  out.has_undo = paStr_(row.act) === 'run' && paStr_(row.result) === 'ok' && kept;
  return out;
}

// FAIL-CLOSED: when the platform's own books cannot be listed, no outside book is written.
function paPlatformBooks_() {
  var ids = {};
  var add = function (id, why) { var s = paStr_(id); if (s) ids[s] = why; };
  var core = paStr_(hubProp_('HUB_DB_ID'));
  if (!core) return { ids: ids, error: 'the core book id could not be read' };
  add(core, 'the core workbook');
  add(hubProp_('HUB_APPS_RUNTIME_ID'), 'the Essencial');
  add(hubProp_('HUB_HIRING_RUNTIME_ID'), 'the hiring runtime');
  var props = {};
  try { props = switchboardValues_('props') || {}; } catch (e) { props = {}; }
  var keys = Object.keys(props);
  if (!keys.length) return { ids: ids, error: 'the switchboard props could not be read' };
  keys.forEach(function (k) { add(props[k], 'switchboard:props.' + k); });
  var store = {};
  try { store = hubPropsStore_() || {}; } catch (e2) { store = {}; }
  Object.keys(store).forEach(function (k) { if (/_ID$/.test(k)) add(store[k], 'Script Property ' + k); });
  return { ids: ids, error: '' };
}

function paOpenBook_(id) { return SpreadsheetApp.openById(id); }

function paTabByGid_(book, gid) {
  var sheets = book.getSheets();
  for (var i = 0; i < sheets.length; i++) if (Number(sheets[i].getSheetId()) === Number(gid)) return sheets[i];
  return null;
}

function paOpenForm_(p) {
  var f = paFormId_(p.form);
  if (f.id) return FormApp.openById(f.id);
  var book = paOpenBook_(paStr_(p.book));
  var sheet = paTabByGid_(book, p.gid);
  if (!sheet) throw new Error('no tab with id ' + paStr_(p.gid) + ' in that book');
  var url = '';
  try { url = paStr_(sheet.getFormUrl()); } catch (e) { url = ''; }
  if (!url) throw new Error('no form feeds that tab');
  return FormApp.openByUrl(url);
}

// FAIL-OPEN: an access level that cannot be read lets the write judge; a refused write changes nothing.
function paAccess_(bookId) {
  try {
    var level = String(DriveApp.getFileById(bookId).getAccess(Session.getEffectiveUser()));
    if (level === 'OWNER' || level === 'EDIT' || level === 'ORGANIZER' || level === 'FILE_ORGANIZER') return 'edit';
    if (level === 'VIEW' || level === 'COMMENT') return 'view';
    return 'unknown';
  } catch (e) { return 'unknown'; }
}

function paRichText_(text, url) {
  var at = text.indexOf(url);
  return SpreadsheetApp.newRichTextValue().setText(text).setLinkUrl(at, at + url.length, url).build();
}

function paWrap_(name) {
  try { return SpreadsheetApp.WrapStrategy[name] || name; } catch (e) { return name; }
}

function paFlush_() {
  try { SpreadsheetApp.flush(); } catch (e) { return; }
}

function paTabColor_(sheet) {
  try { var c = sheet.getTabColor(); return c ? String(c) : ''; } catch (e) { return ''; }
}

// FAIL-CLOSED: a test mode that cannot be read rehearses.
function paTestMode_() {
  try { return hubTestModeOn_() ? 'on' : 'off'; } catch (e) { return 'unreadable'; }
}

function paDialWord_() {
  try {
    var d = commDialState_();
    return d && d.readable === false ? 'unreadable' : paStr_(d && d.word);
  } catch (e) { return 'unreadable'; }
}

function paColourWord_(hex) {
  var h = paStr_(hex).toUpperCase();
  return PA_COLOUR_WORDS[h] || h.toLowerCase();
}

function paDressed_(sheet, rng, want) {
  var same = function (list, v) {
    return list.every(function (x) { return paStr_(x).toUpperCase() === paStr_(v).toUpperCase(); });
  };
  try {
    return same(rng.getBackgrounds()[0], want.background) && same(rng.getFontColors()[0], want.color) &&
      same(rng.getFontWeights()[0], want.bold ? 'bold' : 'normal') &&
      (!want.tab_color || paTabColor_(sheet).toUpperCase() === want.tab_color.toUpperCase());
  } catch (e) { return false; }
}

function paPlanBase_(handler) {
  return { handler: handler, ok: false, state: '', target: '', words: [], untouched: [],
           invariants: [], problems: [], key: [] };
}

function paBannerPlan_(p) {
  var plan = paPlanBase_('banner');
  var check = function (id, ok, words) {
    plan.invariants.push({ id: id, ok: !!ok, words: words });
    if (!ok) plan.problems.push(words);
    return !!ok;
  };
  var bookId = paStr_(p.book), gid = Number(p.gid), a1 = paA1_(p.range), text = paStr_(p.text);
  var own = paPlatformBooks_();
  if (own.error) {
    check('B1', false, 'The platform\'s own books could not be listed (' + own.error + '), so no book is written.');
    return plan;
  }
  if (!check('B1', !own.ids[bookId], own.ids[bookId]
    ? 'That is one of the platform\'s own books — a banner is for an outside book.'
    : 'An outside book, not one of the platform\'s own.')) return plan;
  var book = null;
  try { book = paOpenBook_(bookId); } catch (e) {
    plan.problems.push('The book could not be opened (' + paErr_(e) + ').');
    return plan;
  }
  var sheet = paTabByGid_(book, gid);
  if (!check('B2', !!sheet, sheet ? 'Tab found by its id ' + gid + '.' : 'No tab with id ' + gid + ' in this book.')) return plan;
  if (!a1 || a1.row !== a1.row2) { plan.problems.push('The cells are not one row.'); return plan; }

  var frozen = Number(sheet.getFrozenRows()) || 0;
  var band = Math.max(1, frozen);
  check('B3', a1.row <= band, a1.row <= band
    ? 'Row ' + a1.row + ' is in the frozen header band.'
    : 'Row ' + a1.row + ' is below the frozen header band — appended rows would meet it.');

  var lastRow = Number(sheet.getLastRow()) || 0;
  var width = Number(sheet.getLastColumn()) || 0;
  var head = width ? sheet.getRange(a1.row, 1, 1, width).getValues()[0] : [];
  var headerEnd = 0;
  for (var c = 0; c < head.length; c++) {
    var cell = paStr_(head[c]);
    if (!cell) continue;
    if (c + 1 === a1.col && cell === text) continue;
    headerEnd = c + 1;
  }
  var headerSpan = headerEnd ? 'A–' + paColName_(headerEnd) : '';
  check('B4', a1.col > headerEnd, a1.col > headerEnd
    ? 'Column ' + paColName_(a1.col) + ' is right of the header' + (headerSpan ? ' (' + headerSpan + ').' : '.')
    : 'Column ' + paColName_(a1.col) + ' is inside the header (' + headerSpan + ').');

  var bg = paStr_(p.background) || '#8B0000', fg = paStr_(p.color) || '#FFFFFF';
  var bold = p.bold !== false, tabColour = p.tab_color === undefined ? '#8B0000' : paStr_(p.tab_color);
  var maxCols = Number(sheet.getMaxColumns()) || 0;
  var col2 = Math.min(a1.col2, maxCols);
  var fits = a1.col <= maxCols;
  var clipped = fits ? paA1Text_(a1.row, a1.col, col2) : '';
  var rng = null;
  if (fits) {
    rng = sheet.getRange(a1.row, a1.col, 1, col2 - a1.col + 1);
    var vals = rng.getValues()[0].map(paStr_);
    var empty = vals.every(function (v) { return !v; });
    var worded = vals[0] === text && vals.slice(1).every(function (v) { return !v; });
    var dressed = worded && paDressed_(sheet, rng, { background: bg, color: fg, bold: bold, tab_color: tabColour });
    plan.state = empty ? 'empty' : worded ? (dressed ? 'already' : 'partial') : 'blocked';
    var busy = -1;
    for (var i = 0; i < vals.length; i++) if (vals[i] && !(i === 0 && worded)) { busy = i; break; }
    check('B5', empty || worded, empty ? 'Every cell of ' + clipped + ' is empty.'
      : dressed ? clipped + ' already holds exactly this banner — a run changes nothing.'
        : worded ? clipped + ' holds this banner\'s text but not all its colours — a run applies them.'
          : paColName_(a1.col + busy) + a1.row + ' is not empty (\'' + vals[busy].slice(0, 40) + '\').');
    var merged = [];
    try { merged = rng.getMergedRanges() || []; } catch (eM) { merged = []; }
    check('B6', !merged.length, merged.length ? clipped + ' crosses a merged range.' : 'No merged range touches ' + clipped + '.');
  }
  check('B7', a1.row <= lastRow, a1.row <= lastRow
    ? 'Row ' + a1.row + ' is above the last row (' + lastRow + '), so the last row cannot move.'
    : 'The tab is empty, so row ' + a1.row + ' would become its last row.');
  check('B8', fits, fits
    ? (col2 < a1.col2 ? 'The grid ends at ' + paColName_(maxCols) + ', so the cells are ' + clipped + '.'
      : 'The cells ' + clipped + ' are inside the grid.')
    : 'No free column right of the header.');
  var access = paAccess_(bookId);
  check('B9', access !== 'view', access === 'view'
    ? 'The platform account can only view this book — share it as editor first.'
    : access === 'edit' ? 'The platform account can edit this book.'
      : 'Edit rights could not be read; a write that is refused changes nothing.');
  plan.invariants.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });

  var formUrl = '';
  try { formUrl = paStr_(sheet.getFormUrl()); } catch (eF) { formUrl = ''; }
  var url = paUrlIn_(text);
  var tabName = paStr_(sheet.getName()), bookName = paStr_(book.getName());
  var first = paColName_(a1.col) + a1.row;
  plan.target = bookName + ' › ' + tabName + ' › ' + (clipped || paStr_(p.range));
  plan.words.push(bookName + ' › ' + tabName + ' (tab id ' + gid + ') · cells ' + (clipped || paStr_(p.range)) +
    ' — row ' + a1.row + (a1.row <= frozen ? ', the frozen header row' : '') + ' · text in ' + first +
    (url ? ' · link on the address' : '') + ' · ' + paColourWord_(bg) + ', ' + paColourWord_(fg) +
    (bold ? ' bold' : '') + (tabColour ? ' · tab colour ' + paColourWord_(tabColour) : '') + '.');
  var note = paStr_(p.note), script = paStr_(p.script);
  plan.untouched.push('Untouched: ' + (headerEnd ? 'columns ' + headerSpan + (note ? ' (' + note + ')' : '') : 'every column left of ' + paColName_(a1.col)) +
    ' and every row below ' + a1.row + '. The last row stays ' + lastRow + ', so ' +
    (script ? 'the script\'s last-row read still finds the newest submission' : 'a last-row read still finds the newest row') +
    ', and the next ' + (formUrl ? 'form answer' : 'appended row') + ' lands on row ' + (lastRow + 1) + '.');
  plan.untouched.push(formUrl ? 'A linked form feeds this tab.' : 'No linked form feeds this tab.');
  if (!script) {
    plan.untouched.push('A bound script cannot be seen from here; nothing below row ' + a1.row +
                        ' or left of ' + paColName_(a1.col) + ' is touched.');
  }
  plan.key = [bookId, gid, clipped, plan.state, headerEnd];
  plan.ok = !plan.problems.length;
  plan._h = { book: book, sheet: sheet, range: rng, bookId: bookId, gid: gid, a1: clipped, text: text, url: url,
              background: bg, color: fg, bold: bold, tab_color: tabColour, lastRow: lastRow };
  return plan;
}

function paBannerRestore_(sheet, rng, before) {
  rng.clearContent();
  if (before.backgrounds) rng.setBackgrounds([before.backgrounds]);
  if (before.font_colors) rng.setFontColors([before.font_colors]);
  if (before.font_weights) rng.setFontWeights([before.font_weights]);
  rng.getCell(1, 1).setWrapStrategy(paWrap_(before.wrap || 'OVERFLOW'));
  sheet.setTabColor(before.tab_color || null);
}

function paBannerRun_(plan) {
  var h = plan._h, sheet = h.sheet, rng = h.range;
  var lastBefore = Number(sheet.getLastRow()) || 0;
  var first = rng.getCell(1, 1);
  var before = {
    backgrounds: rng.getBackgrounds()[0],
    font_colors: rng.getFontColors()[0],
    font_weights: rng.getFontWeights()[0],
    wrap: String(first.getWrapStrategy() || 'OVERFLOW'),
    tab_color: paTabColor_(sheet)
  };
  var after = { handler: 'banner', book: h.bookId, gid: h.gid, a1: h.a1, text: h.text };
  try {
    if (h.url) first.setRichTextValue(paRichText_(h.text, h.url));
    else first.setValue(h.text);
    rng.setBackground(h.background);
    rng.setFontColor(h.color);
    rng.setFontWeight(h.bold ? 'bold' : 'normal');
    first.setWrapStrategy(paWrap_('OVERFLOW'));
    if (h.tab_color) sheet.setTabColor(h.tab_color);
    paFlush_();
  } catch (eW) {
    return { result: 'failed', before: before, after: after,
             detail: 'The write failed (' + paErr_(eW) + '); ' + paPutBack_(sheet, rng, before) + '.' };
  }
  var lastAfter = Number(sheet.getLastRow()) || 0;
  if (lastAfter !== lastBefore) {
    return { result: 'failed', before: before, after: after,
             detail: 'The last row moved from ' + lastBefore + ' to ' + lastAfter + ', so ' +
                     paPutBack_(sheet, rng, before) + '.' };
  }
  return { result: 'ok', before: before, after: after,
           detail: 'Wrote the line in ' + h.a1 + ' of ' + plan.target.split(' › ').slice(0, 2).join(' › ') +
                   '; the last row stayed ' + lastBefore + '.' };
}

function paJson_(v) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(paStr_(v) || '{}') || {}; } catch (e) { return {}; }
}

function paPutBack_(sheet, rng, before) {
  try {
    paBannerRestore_(sheet, rng, before);
    paFlush_();
    return 'the cells were put back as they were';
  } catch (e) { return 'putting the cells back failed too (' + paErr_(e) + '), so preview it to see what stands'; }
}

function paRefused_(words) {
  return { result: 'refused', detail: paStr_(words).replace(/\.$/, '') + ' — nothing was put back.' };
}

// The History house is editable in Drive, so an undo is bound to the action's current definition and to B1.
function paUndoBound_(after, def) {
  if (!def || paStr_(def.kind) !== 'automatic' || paStr_(def.handler) !== paStr_(after.handler)) {
    return 'The action no longer names this change';
  }
  var p = paParams_(def).obj;
  if (!p) return 'The action\'s params do not parse';
  if (paStr_(after.handler) !== 'banner') return '';
  var a = paA1_(after.a1), d = paA1_(p.range);
  if (paStr_(after.book) !== paStr_(p.book) || Number(after.gid) !== Number(p.gid) || !a || !d ||
      a.row !== d.row || a.col !== d.col || a.col2 > d.col2) {
    return 'The run\'s cells are not the ones the action names now';
  }
  var own = paPlatformBooks_();
  if (own.error) return 'The platform\'s own books could not be listed (' + own.error + ')';
  if (own.ids[paStr_(after.book)]) return 'That is one of the platform\'s own books';
  return '';
}

function paBannerUndo_(run, def) {
  var after = paJson_(run.after), before = paJson_(run.before);
  var bound = paUndoBound_(after, def);
  if (bound) return paRefused_(bound);
  var book = paOpenBook_(after.book);
  var sheet = paTabByGid_(book, after.gid);
  if (!sheet) return paRefused_('The tab with id ' + after.gid + ' is gone');
  var a1 = paA1_(after.a1);
  var rng = sheet.getRange(a1.row, a1.col, 1, a1.col2 - a1.col + 1);
  var vals = rng.getValues()[0].map(paStr_);
  var intact = vals[0] === paStr_(after.text) && vals.slice(1).every(function (v) { return !v; });
  if (!intact) return paRefused_(after.a1 + ' no longer holds exactly the line the run wrote');
  var lastBefore = Number(sheet.getLastRow()) || 0;
  paBannerRestore_(sheet, rng, before);
  paFlush_();
  var lastAfter = Number(sheet.getLastRow()) || 0;
  return { result: lastAfter === lastBefore ? 'ok' : 'failed',
           detail: lastAfter === lastBefore
             ? 'Put back ' + after.a1 + ' as it was: empty, its colours, and the tab colour.'
             : 'Put back ' + after.a1 + ', but the last row moved from ' + lastBefore + ' to ' + lastAfter + '.' };
}

function paLinkPlan_(p) {
  var plan = paPlanBase_('link');
  var url = paStr_(p.url);
  var ok = /^https:\/\/\S+$/.test(url);
  plan.invariants.push({ id: 'L1', ok: ok, words: ok ? 'The link is https.' : 'The link is not https.' });
  if (!ok) plan.problems.push('The link is not https.');
  plan.state = 'open';
  plan.target = url;
  plan.words.push('Opens ' + url + ' in a new tab.');
  plan.untouched.push('Nothing is written anywhere.');
  plan.key = [url];
  plan.ok = ok;
  plan._h = { url: url };
  return plan;
}

function paLinkRun_(plan) {
  return { result: 'ok', before: '', after: { handler: 'link', url: plan._h.url },
           detail: 'Opened ' + plan._h.url + '.' };
}

function paFormPlan_(p) {
  var plan = paPlanBase_('form_close');
  var check = function (id, ok, words) {
    plan.invariants.push({ id: id, ok: !!ok, words: words });
    if (!ok) plan.problems.push(words);
    return !!ok;
  };
  var own = paPlatformBooks_();
  if (own.error) {
    check('F2', false, 'The platform\'s own books could not be listed (' + own.error + '), so no form is closed.');
    return plan;
  }
  var book = paStr_(p.book);
  if (book && own.ids[book]) { check('F2', false, PA_FORM_OWN); return plan; }
  var form = null;
  try { form = paOpenForm_(p); } catch (e) {
    check('F1', false, 'The form could not be opened (' + paErr_(e) + ') — the platform account must be able to edit it.');
    return plan;
  }
  check('F1', true, 'The platform account can open this form.');
  var id = paStr_(form.getId());
  var dest = '';
  try { dest = paStr_(form.getDestinationId()); } catch (eD) { dest = ''; }
  var mine = !!(own.ids[id] || own.ids[dest]);
  if (!check('F2', !mine, mine ? PA_FORM_OWN
    : 'An outside form: neither it nor the book its answers land in is one of the platform\'s own.')) return plan;
  var accepting = !!form.isAcceptingResponses();
  var message = paStr_(form.getCustomClosedFormMessage());
  var want = paStr_(p.message);
  var title = '';
  try { title = paStr_(form.getTitle()); } catch (eT) { title = ''; }
  plan.state = (!accepting && message === want) ? 'already' : accepting ? 'open' : 'closed';
  plan.target = 'Google Form ' + (title ? '"' + title + '"' : id);
  plan.words.push(plan.state === 'already'
    ? plan.target + ' is already closed with this message — a run changes nothing.'
    : 'Stops ' + plan.target + ' accepting answers; it will show: "' + want + '"');
  plan.untouched.push('The answers already given and the sheet they landed on are untouched.');
  plan.key = [id, accepting ? 'accepting' : 'closed'];
  plan.ok = !plan.problems.length;
  plan._h = { form: form, id: id, message: want, accepting: accepting, before_message: message };
  return plan;
}

function paFormRun_(plan) {
  var h = plan._h;
  var before = { accepting: h.accepting, message: h.before_message };
  h.form.setCustomClosedFormMessage(h.message);
  h.form.setAcceptingResponses(false);
  return { result: 'ok', before: before, after: { handler: 'form_close', form: h.id, message: h.message },
           detail: 'Closed ' + plan.target + ' with the platform\'s message.' };
}

function paFormUndo_(run, def) {
  var after = paJson_(run.after), before = paJson_(run.before);
  var bound = paUndoBound_(after, def);
  if (bound) return paRefused_(bound);
  var plan = paFormPlan_(paParams_(def).obj);
  if (!plan.ok) return paRefused_(plan.problems[0] || 'The checks did not hold');
  if (plan._h.id !== paStr_(after.form)) return paRefused_('The run\'s form is not the one the action names now');
  var form = plan._h.form;
  var still = !form.isAcceptingResponses() && paStr_(form.getCustomClosedFormMessage()) === paStr_(after.message);
  if (!still) return paRefused_('The form no longer stands as the run left it');
  form.setAcceptingResponses(!!before.accepting);
  form.setCustomClosedFormMessage(paStr_(before.message));
  return { result: 'ok', detail: 'Put the form back: ' + (before.accepting ? 'accepting answers again' : 'closed as before') + '.' };
}

var PA_HANDLERS = {
  banner: {
    plan: function (p) { return paBannerPlan_(p); },
    rehearse: function (plan) { return plan.words.concat(plan.untouched).join('\n'); },
    run: function (plan) { return paBannerRun_(plan); },
    undo: function (run, def) { return paBannerUndo_(run, def); }
  },
  link: {
    plan: function (p) { return paLinkPlan_(p); },
    rehearse: function (plan) { return plan.words.concat(plan.untouched).join('\n'); },
    run: function (plan) { return paLinkRun_(plan); },
    undo: null
  },
  form_close: {
    plan: function (p) { return paFormPlan_(p); },
    rehearse: function (plan) { return plan.words.concat(plan.untouched).join('\n'); },
    run: function (plan) { return paFormRun_(plan); },
    undo: function (run, def) { return paFormUndo_(run, def); }
  }
};

function paPlanFor_(def) {
  var problems = paValidate_(def);
  if (problems.length) {
    var bad = paPlanBase_(paStr_(def.handler));
    bad.problems = problems.map(function (x) { return x.words; });
    return bad;
  }
  var plan = PA_HANDLERS[paStr_(def.handler)].plan(paParams_(def).obj);
  plan.def_sha = paDefSha_(def);
  plan.preview_sha = paSha16_([plan.def_sha].concat(plan.key).join('|'));
  return plan;
}

function paPreviewOut_(def, plan, mode) {
  var out = { action_id: paStr_(def.id), number: paStr_(def.number), title: paStr_(def.title),
              kind: paStr_(def.kind), handler: paStr_(def.handler), def_sha: paDefSha_(def),
              test_mode: mode, mode: mode === 'off' ? 'real' : 'rehearse' };
  if (paStr_(def.kind) !== 'automatic') {
    out.how = paStr_(def.how);
    out.link = paStr_(def.link);
    out.requires = paStr_(def.requires);
    out.problems = [];
    return out;
  }
  ['preview_sha', 'state', 'target', 'words', 'untouched', 'invariants', 'problems'].forEach(function (k) {
    out[k] = plan[k] === undefined ? '' : plan[k];
  });
  out.ok = !!plan.ok;
  return out;
}

var PA_RUN_IDS = {};

function paRunId_() {
  var id = '';
  do {
    id = 'PR-' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 17) + '-' +
         String(Math.floor(Math.random() * 9000) + 1000);
  } while (PA_RUN_IDS[id]);
  PA_RUN_IDS[id] = true;
  return id;
}

function paRunRow_(def, user, clientId, act, expect, mode) {
  var now = paNow_();
  var tenant = '';
  try { tenant = paStr_(tenantStamp_()); } catch (e) { tenant = ''; }
  return {
    id: paRunId_(), createdAt: now, updatedAt: now,
    action_id: paStr_(def.id), number: paStr_(def.number), title: paStr_(def.title),
    act: act, result: '', expect: expect || '', test_mode: mode, dial: paDialWord_(),
    by_email: paStr_(user.email), by_name: paStr_(user.display_name || user.name) || paStr_(user.email),
    client_id: clientId, def_sha: def.kind !== undefined ? paDefSha_(def) : '', preview_sha: '',
    target: '', detail: '', before: '', after: '', undoes: '', mock_row_id: '', tenant: tenant
  };
}

function paLocked_(fn) {
  var lock = null;
  try { lock = LockService.getScriptLock(); } catch (e) { lock = null; }
  if (lock && !lock.tryLock(PA_LOCK_MS)) {
    return { status: 409, message: 'Another production action is running — try again in a moment.' };
  }
  try { return fn(); }
  finally {
    if (lock) { try { lock.releaseLock(); } catch (eR) { lock = null; } }
  }
}

function paAudit_(what, target, ok) {
  try { hubSysLog_(PA_LOG, what, target, { status: ok ? 200 : 500 }); } catch (e) { return false; }
  return true;
}

function paLedger_(row) {
  try { paAppend_(PA_RUNS_HOUSE, row); return ''; }
  catch (e) {
    paAudit_('production_action_ledger_lost', row.id + ': ' + paErr_(e), false);
    return paErr_(e);
  }
}

function paAnswer_(row, extra) {
  var lost = paLedger_(row);
  if (lost) {
    return { status: 500, message: (row.act === 'run' || row.act === 'undo') && row.result === 'ok'
      ? 'The change was made, but its History row could not be written (' + lost + ').'
      : 'The History row could not be written (' + lost + ').' };
  }
  var data = { run: paRunOut_(row) };
  if (extra) Object.keys(extra).forEach(function (k) { data[k] = extra[k]; });
  return { status: 200, data: data };
}

function paMock_(def, plan, row, held) {
  var now = new Date();
  var body = PA_HANDLERS[paStr_(def.handler)].rehearse(plan);
  var send = '';
  try { send = (typeof rpcSendEnabled_ === 'function' && rpcSendEnabled_()) ? 'on' : 'off'; } catch (e) { send = ''; }
  var iso = now.toISOString();
  return {
    id: row.id + '.mock', at: iso, day: iso.slice(0, 10), hour: iso.slice(11, 16),
    pass_id: 'production-actions', seq: 1,
    situation: 'production_action', purpose: 'production action #' + paStr_(def.number) + ' · ' + paStr_(def.handler),
    method: 'productionAction', send_at: '', person_name: '', to_masked: plan.target, audience: 1,
    channel: 'production_action', subject: '#' + paStr_(def.number) + ' ' + paStr_(def.title) + ' (rehearsal)',
    body: body.slice(0, 4000), body_chars: body.length,
    result: 'rehearsed', held_by: held,
    reason: 'Nothing outside the platform\'s own houses was opened for writing.',
    dial: row.dial, test_mode: row.test_mode, send_switch: send, ledger_key: row.id, tenant: row.tenant
  };
}

/** The preview of one or more actions: what each would write, where, and every check, read-only. */
HUB_POLICY.productionActionPreview = {
  file: 'ProductionActions.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  params: { action_ids: { required: true, type: 'array' } },
  roles: ['admin'], invalidates: [], emits: []
};
HUB_ACTIONS.productionActionPreview = function (payload, user) {
  var denied = paGate_(user, 'productionActionPreview');
  if (denied) return denied;
  if (!paHousesReady_()) return { status: 503, message: PA_UNDECLARED };
  var ids = (payload && payload.action_ids) || [];
  if (!Array.isArray(ids) || !ids.length || ids.length > PA_PREVIEW_MAX) {
    return { status: 400, message: 'Preview 1–' + PA_PREVIEW_MAX + ' actions at a time.' };
  }
  var defs;
  try { defs = paDefs_(); } catch (e) { return { status: 503, message: 'The runbook could not be read (' + paErr_(e) + ').' }; }
  var mode = paTestMode_();
  var items = {};
  ids.forEach(function (raw) {
    var id = paStr_(raw);
    var def = paDefFind_(defs, id);
    if (!def) { items[id] = { action_id: id, problems: ['No action "' + id + '".'] }; return; }
    var plan = null;
    if (paStr_(def.kind) === 'automatic') {
      try { plan = paPlanFor_(def); } catch (eP) {
        plan = paPlanBase_(paStr_(def.handler));
        plan.problems = ['The preview failed (' + paErr_(eP) + ').'];
      }
    }
    items[id] = paPreviewOut_(def, plan, mode);
  });
  return { status: 200, data: { test_mode: mode, mode: mode === 'off' ? 'real' : 'rehearse', items: items } };
};

/** Run one automatic action: a rehearsal unless test mode reads off and the click asked for a real run. */
HUB_POLICY.productionActionRun = {
  file: 'ProductionActions.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  params: { action_id: { required: true, type: 'string' }, client_id: { required: true, type: 'string' },
            preview_sha: { required: true, type: 'string' }, expect: { required: true, type: 'string' } },
  roles: ['admin'], invalidates: [], emits: []
};
HUB_ACTIONS.productionActionRun = function (payload, user) {
  var denied = paGate_(user, 'productionActionRun');
  if (denied) return denied;
  if (!paHousesReady_()) return { status: 503, message: PA_UNDECLARED };
  var p = payload || {};
  var id = paStr_(p.action_id), clientId = paStr_(p.client_id), sha = paStr_(p.preview_sha);
  var expect = paStr_(p.expect) === 'real' ? 'real' : 'rehearse';
  if (!id || !clientId) return { status: 400, message: 'An action and a client id are required.' };
  return paLocked_(function () {
    var runs = paRuns_();
    var prior = paByClient_(runs, clientId);
    if (prior) return { status: 200, data: { run: paRunOut_(prior), repeat: true } };
    var def = paDefFind_(paDefs_(), id);
    if (!def) return { status: 404, message: 'No action "' + id + '".' };
    if (paStr_(def.kind) !== 'automatic') return { status: 400, message: 'A manual action is marked done, not run.' };
    if (paEnabledWord_(def.enabled) === 'no') return { status: 400, message: 'That action is switched off.' };
    var mode = paTestMode_();
    var real = mode === 'off' && expect === 'real';
    var row = paRunRow_(def, user, clientId, real ? 'run' : 'rehearse', expect, mode);
    var plan;
    try { plan = paPlanFor_(def); } catch (eP) {
      row.result = 'failed';
      row.detail = 'The target could not be read (' + paErr_(eP) + ').';
      return paAnswer_(row);
    }
    row.preview_sha = paStr_(plan.preview_sha);
    row.target = plan.target;
    if (!plan.ok) {
      row.result = 'refused';
      row.detail = plan.problems[0] || 'The checks did not hold.';
      return paAnswer_(row);
    }
    if (sha !== plan.preview_sha) {
      row.result = 'refused';
      row.detail = 'Changed since the preview — preview again.';
      return paAnswer_(row);
    }
    if (!real) {
      var held = expect === 'rehearse' ? 'the click asked for a rehearsal'
        : mode === 'unreadable' ? 'test mode could not be read, so it counts as on — a production action only rehearses'
          : 'test mode is on — a production action only rehearses';
      var mock = paMock_(def, plan, row, held);
      try {
        commMockWrite_(mock);
        row.result = 'ok';
        row.mock_row_id = mock.id;
        row.detail = 'Rehearsed as CommMock row ' + mock.id + '; nothing outside was written.';
      } catch (eW) {
        row.result = 'failed';
        row.detail = 'The CommMock row could not be written (' + paErr_(eW) + '), so the rehearsal did not happen.';
      }
      return paAnswer_(row);
    }
    if (plan.state === 'already') {
      row.result = 'noop';
      row.detail = 'Already in place — nothing was written.';
      return paAnswer_(row);
    }
    try {
      var got = PA_HANDLERS[paStr_(def.handler)].run(plan);
      row.result = got.result;
      row.before = got.before || '';
      row.after = got.after || '';
      row.detail = got.detail;
    } catch (eR) {
      row.result = 'failed';
      row.detail = 'The write failed (' + paErr_(eR) + ').';
    }
    paAudit_('production_action_run', row.target + ' · ' + row.result, row.result === 'ok');
    var answer = paAnswer_(row);
    if (answer.status === 200 && paStr_(def.handler) === 'link') answer.data.open = plan._h.url;
    return answer;
  });
};

/** Mark an action done or reopen it: a record of what a person did, in any phase and any test-mode position. */
HUB_POLICY.productionActionMark = {
  file: 'ProductionActions.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  params: { action_id: { required: true, type: 'string' }, client_id: { required: true, type: 'string' },
            done: { required: true, type: 'boolean' } },
  roles: ['admin'], invalidates: [], emits: []
};
HUB_ACTIONS.productionActionMark = function (payload, user) {
  var denied = paGate_(user, 'productionActionMark');
  if (denied) return denied;
  if (!paHousesReady_()) return { status: 503, message: PA_UNDECLARED };
  var p = payload || {};
  var id = paStr_(p.action_id), clientId = paStr_(p.client_id), done = p.done === true;
  if (!id || !clientId) return { status: 400, message: 'An action and a client id are required.' };
  return paLocked_(function () {
    var prior = paByClient_(paRuns_(), clientId);
    if (prior) return { status: 200, data: { run: paRunOut_(prior), repeat: true } };
    var def = paDefFind_(paDefs_(), id);
    if (!def) return { status: 404, message: 'No action "' + id + '".' };
    var row = paRunRow_(def, user, clientId, done ? 'mark' : 'unmark', '', paTestMode_());
    row.result = 'ok';
    row.detail = done ? 'Marked done.' : 'Reopened.';
    return paAnswer_(row);
  });
};

/** Undo the newest real run of an action, once, only while its target still holds exactly what the run wrote. */
HUB_POLICY.productionActionUndo = {
  file: 'ProductionActions.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  params: { run_id: { required: true, type: 'string' }, client_id: { required: true, type: 'string' } },
  roles: ['admin'], invalidates: [], emits: []
};
HUB_ACTIONS.productionActionUndo = function (payload, user) {
  var denied = paGate_(user, 'productionActionUndo');
  if (denied) return denied;
  if (!paHousesReady_()) return { status: 503, message: PA_UNDECLARED };
  var p = payload || {};
  var runId = paStr_(p.run_id), clientId = paStr_(p.client_id);
  if (!runId || !clientId) return { status: 400, message: 'A run and a client id are required.' };
  return paLocked_(function () {
    var runs = paRuns_();
    var prior = paByClient_(runs, clientId);
    if (prior) return { status: 200, data: { run: paRunOut_(prior), repeat: true } };
    var target = null;
    runs.forEach(function (r) { if (paStr_(r.id) === runId) target = r; });
    if (!target || paStr_(target.act) !== 'run' || paStr_(target.result) !== 'ok') {
      return { status: 400, message: 'Only a real run that wrote something can be undone.' };
    }
    var newest = null;
    runs.forEach(function (r) {
      if (paStr_(r.action_id) !== paStr_(target.action_id) || paStr_(r.act) !== 'run' || paStr_(r.result) !== 'ok') return;
      if (!newest || paStr_(r.createdAt) > paStr_(newest.createdAt) ||
          (paStr_(r.createdAt) === paStr_(newest.createdAt) && Number(r._row || 0) > Number(newest._row || 0))) newest = r;
    });
    if (!newest || paStr_(newest.id) !== runId) return { status: 409, message: 'Only the newest real run of this action can be undone.' };
    var undone = runs.some(function (r) {
      return paStr_(r.act) === 'undo' && paStr_(r.result) === 'ok' && paStr_(r.undoes) === runId;
    });
    if (undone) return { status: 409, message: 'That run is already undone.' };
    var handler = paStr_(paJson_(target.after).handler);
    var h = PA_HANDLERS[handler];
    if (!h || !h.undo) return { status: 400, message: 'This action has nothing to put back.' };
    var def = paDefFind_(paDefs_(), target.action_id);
    var row = paRunRow_(def || { id: target.action_id, number: target.number, title: target.title },
                        user, clientId, 'undo', '', paTestMode_());
    row.undoes = runId;
    row.target = paStr_(target.target);
    try {
      var got = h.undo(target, def);
      row.result = got.result;
      row.detail = got.detail;
    } catch (eU) {
      row.result = 'failed';
      row.detail = 'The undo failed (' + paErr_(eU) + ').';
    }
    paAudit_('production_action_undo', row.target + ' · ' + row.result, row.result === 'ok');
    return paAnswer_(row);
  });
};

function paNewId_(title, defs) {
  var base = paStr_(title).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36) || 'action';
  if (base.length < 2) base = 'action_' + base;
  var id = base, n = 2;
  while (paDefFind_(defs, id)) id = base + '_' + (n++);
  return id;
}

/** Add or edit one runbook action; nothing is ever deleted — enabled "no" retires a row. */
HUB_POLICY.productionActionSave = {
  file: 'ProductionActions.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  params: { client_id: { required: true, type: 'string' }, action: { required: true, type: 'object' } },
  roles: ['admin'], invalidates: [], emits: []
};
HUB_ACTIONS.productionActionSave = function (payload, user) {
  var denied = paGate_(user, 'productionActionSave');
  if (denied) return denied;
  if (!paHousesReady_()) return { status: 503, message: PA_UNDECLARED };
  var p = payload || {};
  var clientId = paStr_(p.client_id), input = p.action || {};
  if (!clientId || typeof input !== 'object') return { status: 400, message: 'An action and a client id are required.' };
  return paLocked_(function () {
    var defs = paDefs_();
    var prior = paByClient_(paRuns_(), clientId);
    if (prior) {
      var had = paDefFind_(defs, prior.action_id);
      return { status: 200, data: { run: paRunOut_(prior), action: had ? paDefOut_(had) : null, repeat: true } };
    }
    var id = paStr_(input.id);
    var existing = id ? paDefFind_(defs, id) : null;
    if (!id) id = paNewId_(input.title, defs);
    var row = {};
    PA_ACTIONS_HEADER.forEach(function (h) { row[h] = existing ? paStr_(existing[h]) : ''; });
    PA_EDITABLE.forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(input, k)) return;
      var v = input[k];
      row[k] = (k === 'params' && v !== null && typeof v === 'object') ? JSON.stringify(v) : paStr_(v);
    });
    var now = paNow_();
    row.id = id;
    row.enabled = paEnabledWord_(row.enabled);
    if (!existing) row.createdAt = now;
    row.updatedAt = now;
    row.updated_by = paStr_(user.email);
    var problems = paValidate_(row);
    if (problems.length) return { status: 400, message: problems[0].words, problems: problems };
    try { paPut_(PA_ACTIONS_HOUSE, row); }
    catch (e) { return { status: 503, message: 'The runbook could not be written (' + paErr_(e) + ').' }; }
    var ledger = paRunRow_(row, user, clientId, 'save', '', paTestMode_());
    ledger.result = 'ok';
    ledger.detail = (existing ? 'Edited' : 'Added') + ' #' + paStr_(row.number) + ' ' + paStr_(row.title) + '.';
    return paAnswer_(ledger, { action: paDefOut_(row) });
  });
};
