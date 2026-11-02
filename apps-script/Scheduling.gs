// Scheduling: one editable calendar per house in its own ASA Data houses, read as one board and cut per viewer.
// The request, call-off, swap and outreach flows live in SchedulingFlows.gs and write through the doors here.

var SCHED_APP_ID = 'scheduling';
var SCHED_TABS = { cells: 'sched_cells', rows: 'sched_rows', flows: 'sched_flows', inbox: 'sched_inbox',
                   log: 'sched_log', settings: 'sched_settings', drafts: 'sched_drafts' };

var SCHED_HEADERS = {
  sched_cells: ['id', 'period_id', 'house_code', 'date', 'row_id', 'text', 'kind', 'start_min', 'end_min', 'hours',
                'token', 'color', 'state', 'base', 'flow_id', 'source', 'note', 'updated_at', 'updated_by'],
  sched_rows: ['id', 'house_code', 'location', 'row_id', 'row_kind', 'name', 'person_key', 'designation', 'order',
               'active', 'source', 'updated_at', 'updated_by'],
  sched_flows: ['id', 'kind', 'state', 'house_code', 'date', 'date_to', 'row_id', 'person', 'person_key', 'person_uid',
                'shift_text', 'start_min', 'end_min', 'open_row_id', 'replacement', 'replacement_key',
                'replacement_uid', 'seats', 'reason', 'note', 'source', 'source_ref', 'outreach_stage',
                'outreach_next_at', 'outreach_log', 'test_mode', 'created_at', 'created_by', 'updated_at',
                'closed_at', 'closed_by'],
  sched_inbox: ['id', 'flow_id', 'box', 'kind', 'seat', 'to_uid', 'to_email', 'to_name', 'title', 'body',
                'house_code', 'house_label', 'date', 'shift_text', 'state', 'answered_by', 'answered_at', 'note',
                'link', 'test_mode', 'created_at'],
  sched_log: ['id', 'at', 'by_uid', 'by_name', 'house_code', 'date', 'row_id', 'was', 'now', 'via', 'flow_id', 'note',
              'undone_at'],
  sched_settings: ['key', 'value', 'note', 'updated_at', 'updated_by'],
  sched_drafts: ['id', 'house_code', 'first', 'last', 'state', 'rev', 'body', 'body_2', 'body_3', 'body_4',
                 'approved_at', 'approved_by', 'published_at', 'updated_at', 'updated_by']
};

var SCHED_ACTIONS = ['schedulingBoard', 'schedulingCellSave', 'schedulingAddPerson', 'schedulingUndo',
                     'schedulingSettingsSet', 'schedulingSeed', 'schedulingRoll', 'schedulingTimeOffImport'];

var SCHED_TZ = 'America/New_York';
var SCHED_LOCK_MS = 20000;
var SCHED_BUSY_SENTENCE = 'Somebody else is changing the calendar right now — try again.';
var SCHED_BOARD_VERSION_KEY = 'sched_board_v';
// CacheService's longest: every write here bumps the version, and what comes from outside the six houses is in the key
var SCHED_BOARD_TTL = 21600;
var SCHED_BADGES_KEY = 'sched_badges_v1';
// the certificate books and the accounts say nothing when they change: their age is the badges' only clock
var SCHED_BADGES_TTL = 1800;
var SCHED_BADGES_RETRY_TTL = 300;
var SCHED_CHUNK = 90000;
var SCHED_LOG_KEEP = 100;
var SCHED_REPORT_LIST = 60;

var SCHED_SETTING_DEFAULTS = {
  directors: 'ty.bond@asalifecare.com, brittfrench1316@gmail.com',
  cycle_days: '28', roll_lead_days: '7', outreach_wait_min: '7', min_days_ahead: '7'
};
var SCHED_FIRST_PERIOD = { id: 'P2026-09-28', first: '2026-09-28', last: '2026-10-25', state: 'live',
                           rolled_from: '', rolled_at: '', by: '' };

var SCHED_WORKING = { day: 1, morning: 1, afternoon: 1, evening: 1, overnight: 1 };
var SCHED_OFF_STATES = { called_off: 1, requested_off: 1, time_off: 1, swapped_out: 1 };
var SCHED_ONE_OFF_STATES = { called_off: 1, requested_off: 1, time_off: 1, swapped_out: 1, swap_in: 1, taken: 1,
                             training: 1 };
// a shift held by a one-off: an editor changing its hours keeps it the one-off it is
var SCHED_HELD_ONE_OFF = { swap_in: 1, taken: 1, training: 1 };
var SCHED_INBOX_READER = 'living-brain@asalifecare-jarvis.iam.gserviceaccount.com';
var SCHED_INBOX_SHARED_PROP = 'SCHED_INBOX_SHARED';
var SCHED_INBOX_SHARE_TRY_KEY = 'sched_inbox_share_try';
var SCHED_ROW_KINDS = { person: 1, open: 1, workshop: 1, other: 1 };
var SCHED_STAFF_ROLES = ['admin', 'director', 'manager', 'staff'];
var SCHED_NOT_PEOPLE = { nurse: 1, family: 1 };
var SCHED_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var SCHED_WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// ---- small pure helpers ----

function schedStr_(v) { return String(v == null ? '' : v).trim(); }

function schedErr_(e) { return String((e && e.message) || e).slice(0, 200); }

function schedNow_() { return new Date().toISOString(); }

function schedToday_() { return Utilities.formatDate(new Date(), SCHED_TZ, 'yyyy-MM-dd'); }

function schedRefuse_(status, message) { return { status: status, message: message }; }

function schedJson_(text, fallback) {
  if (text && typeof text === 'object') return text;
  var s = schedStr_(text);
  if (!s) return fallback;
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

function schedIsoValid_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(schedStr_(iso));
  if (!m) return false;
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// Dates are cut, never parsed through a time zone: a day is a UTC calendar index.
function schedDayIndex_(iso) {
  var p = schedStr_(iso).split('-');
  return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
}

function schedIsoOfIndex_(n) {
  var d = new Date(n * 86400000);
  var pad = function (x) { return (x < 10 ? '0' : '') + x; };
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

function schedIsoAdd_(iso, days) { return schedIsoOfIndex_(schedDayIndex_(iso) + days); }

function schedDow_(iso) { return (schedDayIndex_(iso) % 7 + 7 + 4) % 7; }

// The estate's week starts on Saturday (house_cal_live.week_key).
function schedWeekKey_(iso) {
  if (!schedIsoValid_(iso)) return iso;
  return schedIsoAdd_(iso, -((schedDow_(iso) + 1) % 7));
}

function schedDates_(first, last) {
  var out = [];
  if (!schedIsoValid_(first) || !schedIsoValid_(last)) return out;
  for (var n = schedDayIndex_(first); n <= schedDayIndex_(last); n++) out.push(schedIsoOfIndex_(n));
  return out;
}

function schedCol_(iso) {
  var p = iso.split('-');
  return { iso: iso, date: (+p[1]) + '/' + (+p[2]), short: SCHED_MONTHS[+p[1] - 1] + ' ' + (+p[2]),
           weekday: SCHED_WEEKDAYS[schedDow_(iso)] };
}

function schedDayWords_(iso) {
  if (!schedIsoValid_(iso)) return schedStr_(iso);
  var p = iso.split('-');
  var wd = SCHED_WEEKDAYS[schedDow_(iso)];
  return wd.charAt(0) + wd.slice(1).toLowerCase() + ' ' + (+p[1]) + '/' + (+p[2]);
}

function schedHex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function schedSha16_(text) {
  return schedHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, String(text),
                                           Utilities.Charset.UTF_8)).slice(0, 16);
}

function schedCellId_(houseCode, rowId, date) { return 'SC_' + schedSha16_(houseCode + '|' + rowId + '|' + date); }

function schedRowId_(houseCode, rowId) { return 'SR_' + schedSha16_(houseCode + '|' + rowId); }

function schedNewId_(prefix) {
  var hex = '';
  while (hex.length < 10) hex += Math.floor(Math.random() * 0x100000000).toString(16);
  return prefix + hex.slice(0, 10).toUpperCase();
}

function schedFold_(v) { return clientNameKey_(v); }

function schedSlug_(name) { return schedStr_(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

// ---- the cell grammar: an exact port of server/shift_slices.py classify + _kind_for ----

// The first half may drop its meridiem ("230-10p") and borrow the second's.
var SCHED_TIME_RANGE = /^\*?\s*(\d{1,2})(?::?(\d{2}))?\s*([AP])?M?\s*[-–]\s*(\d{1,2})(?::?(\d{2}))?\s*([AP])M?(?:\s+[A-Za-z]{1,4})?\s*$/i;
var SCHED_TIME_INSIDE = /(\d{1,2})(?::?(\d{2}))?\s*([AP])?M?\s*[-–]\s*(\d{1,2})(?::?(\d{2}))?\s*([AP])M?(?![A-Za-z0-9])/i;
var SCHED_NOT_WORKING = { 'OFF': 1, 'R/O': 1, 'C/O': 1, 'RO': 1, 'R\\O': 1, 'R/0': 1, 'NCNS': 1, 'NO WORKSHOP': 1 };
var SCHED_CHAIN = /\s*[><]\s*/;

function schedHour_(h, m, ap) {
  return parseInt(h, 10) % 12 + (String(ap).toUpperCase() === 'P' ? 12 : 0) + (m ? parseInt(m, 10) / 60 : 0);
}

function schedSpanOf_(m) {
  var ap1 = m[3] || m[6];
  var start = schedHour_(m[1], m[2], ap1), end = schedHour_(m[4], m[5], m[6]);
  if (m[3] === undefined && start >= end) start = ((start - 12) % 24 + 24) % 24;
  if (end <= start) end += 24;
  return [start, end];
}

function schedRange_(segment) {
  var m = SCHED_TIME_RANGE.exec(schedStr_(segment));
  return m ? schedSpanOf_(m) : null;
}

function schedKindFor_(start, end) {
  if (start >= 19 || end > 24) return 'overnight';
  if (end - start >= 11 && start <= 10) return 'day';
  if (start < 11) return 'morning';
  if (start < 16) return 'afternoon';
  return 'evening';
}

/** The Python dict, key for key: null for an empty cell. */
function schedClassifyRaw_(raw) {
  var code = String(raw == null ? '' : raw).trim();
  if (!code) return null;
  var segments = code.split(SCHED_CHAIN).filter(function (s) { return s.trim(); });
  var hours = null, token = null;
  for (var i = 0; i < segments.length; i++) {
    var got = schedRange_(segments[i]);
    if (got && hours === null) hours = got;
    else if (!got && token === null) {
      var up = segments[i].trim().toUpperCase().replace(/^\*+/, '').trim();
      if (!SCHED_NOT_WORKING[up]) token = segments[i].trim();
    }
  }
  var shown = code.replace(/^\*+/, '').trim();
  if (hours) return { kind: schedKindFor_(hours[0], hours[1]), code: shown, start: hours[0], end: hours[1], token: token };
  var upShown = shown.toUpperCase();
  if (upShown === 'OFF') return { kind: 'off', code: 'OFF' };
  if (SCHED_NOT_WORKING[upShown]) return { kind: 'ro', code: upShown };
  return { kind: 'alias', code: shown, token: shown };
}

/** { kind, start, end, hours, token, code } with start/end in hours (end may pass 24); null for an empty cell. */
function schedClassify_(text) {
  var got = schedClassifyRaw_(text);
  if (!got) return null;
  var timed = got.start !== undefined && got.end !== undefined;
  return { kind: got.kind, code: got.code, token: got.token === undefined ? null : got.token,
           start: timed ? got.start : null, end: timed ? got.end : null,
           hours: timed ? Math.round((got.end - got.start) * 100) / 100 : 0 };
}

/** The first time range written anywhere inside an alias (MED DEL 8A-4P), or null. */
function schedTimeInside_(text) {
  var m = SCHED_TIME_INSIDE.exec(String(text == null ? '' : text));
  return m ? schedSpanOf_(m) : null;
}

/** How many links of a chain read as a time range; only the first counts for hours. */
function schedRangeCount_(text) {
  return String(text == null ? '' : text).split(SCHED_CHAIN).filter(function (s) {
    return s.trim() && schedRange_(s);
  }).length;
}

function schedHalf_(hour) {
  var total = ((Math.round(hour * 60) % 1440) + 1440) % 1440;
  var hh = Math.floor(total / 60), mm = total % 60;
  var twelve = hh % 12 || 12;
  return twelve + (mm ? (mm < 10 ? '0' : '') + mm : '') + (hh >= 12 ? 'P' : 'A');
}

function schedCodeOf_(start, end) { return schedHalf_(start) + '-' + schedHalf_(end); }

function schedTimeHours_(v) {
  var t = schedStr_(v);
  var m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (m) return parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return parseFloat(t);
}

/** 'HH:MM' or decimal hours → the cell code, refused when it would not read back (value_from_times). */
function schedValueFromTimes_(start, end) {
  var s = schedTimeHours_(start), e = schedTimeHours_(end);
  if (s === null || e === null || s < 0 || s >= 24 || e < 0 || e >= 24) return { error: 'Start and end must be times of day.' };
  if (Math.abs(s - e) < 1e-9) return { error: 'A shift needs a start and an end that differ.' };
  var code = schedCodeOf_(s, e);
  var got = schedClassify_(code);
  var wantLen = ((e - s) % 24 + 24) % 24 || 24;
  if (!got || got.start === null || Math.abs(got.start - s) > 1e-6 || Math.abs((got.end - got.start) - wantLen) > 1e-6) {
    return { error: code + ' would not read back as those hours — type the code instead.' };
  }
  return { code: code };
}

function schedClock_(hour) {
  var total = ((Math.round(hour * 60) % 1440) + 1440) % 1440;
  var hh = Math.floor(total / 60), mm = total % 60;
  return (hh % 12 || 12) + ':' + (mm < 10 ? '0' : '') + mm + ' ' + (hh >= 12 ? 'PM' : 'AM');
}

/** A cell as words: the code as written (8A-4P), or with `long` the clock (8:00 AM – 4:00 PM). */
function schedShiftWords_(cell, long) {
  var text = schedStr_(cell && (cell.text !== undefined ? cell.text : cell.shift_text)).replace(/^\*+/, '').trim();
  if (!long) return text;
  var got = schedClassify_(text);
  if (!got || got.start === null) return text;
  return schedClock_(got.start) + ' – ' + schedClock_(got.end);
}

// ---- the houses (ASA Data, one Data tab each) ----

function schedHouseReady_(tab) {
  try { return !!houseMoved_(tab); } catch (e) { return false; }
}

function schedSheet_(tab) {
  if (!SCHED_HEADERS[tab]) throw new Error('No Scheduling house is called "' + tab + '".');
  if (!schedHouseReady_(tab)) {
    throw new Error('The Scheduling house "' + tab + '" is not set up (no pointer, or moved.' + tab + ' is not on).');
  }
  return hubTabEnsure_(tab, SCHED_HEADERS[tab]);
}

function schedIdField_(tab) { return tab === SCHED_TABS.settings ? 'key' : 'id'; }

function schedCellText_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return cellText_(v) || '';
  return String(v).trim();
}

var SCHED_MEMO = {};

function schedMemoDrop_(tab) { if (tab) delete SCHED_MEMO[tab]; else SCHED_MEMO = {}; }

/** Under a lock every house is read again: rows memoized before it may be another execution's past. */
function schedMemoFresh_() {
  Object.keys(SCHED_TABS).forEach(function (k) { delete SCHED_MEMO[SCHED_TABS[k]]; });
  delete SCHED_MEMO.__settings;
}

/** A write is flushed, then the version bumped again, before the lock goes: no reader caches rows still in flight. */
var SCHED_DIRTY = false;
function schedSettle_() {
  if (!SCHED_DIRTY) return;
  SCHED_DIRTY = false;
  try { SpreadsheetApp.flush(); } catch (e) { /* the bump below still invalidates */ }
  schedBump_();
}

/** Every row of a house as a plain object keyed by its header; throws (naming the house) when it cannot be read. */
function schedRead_(tab) {
  if (Object.prototype.hasOwnProperty.call(SCHED_MEMO, tab)) return SCHED_MEMO[tab];
  // the settings are read on every gate: held under the board's version, which every write bumps
  var setKey = '';
  if (tab === SCHED_TABS.settings && schedVersion_()) {
    try {
      setKey = 'sched_set:' + schedVersion_();
      var hit = CacheService.getScriptCache().get(setKey);
      if (hit) { SCHED_MEMO[tab] = JSON.parse(hit); return SCHED_MEMO[tab]; }
    } catch (eC) { setKey = ''; }
  }
  var values;
  try { values = schedSheet_(tab).getDataRange().getValues(); }
  catch (e) { throw new Error('The Scheduling house "' + tab + '" could not be read: ' + schedErr_(e)); }
  var out = [];
  if (values.length > 1) {
    var header = values[0].map(function (h) { return String(h || '').trim(); });
    var idf = schedIdField_(tab);
    for (var r = 1; r < values.length; r++) {
      var row = {};
      for (var c = 0; c < header.length; c++) if (header[c]) row[header[c]] = schedCellText_(values[r][c]);
      if (row[idf]) out.push(row);
    }
  }
  if (setKey) {
    try { CacheService.getScriptCache().put(setKey, JSON.stringify(out), SCHED_BOARD_TTL); } catch (eP) {}
  }
  SCHED_MEMO[tab] = out;
  return out;
}

/** The book-write funnel's hold as the refusal a handler answers, or null. */
function schedHeld_() {
  var held = sheetDbGateHolds_(SCHED_TABS.cells, 'update');
  return held ? held.error : null;
}

function schedLine_(header, row) {
  return header.map(function (h) {
    var v = Object.prototype.hasOwnProperty.call(row, h) ? row[h] : '';
    if (v !== null && typeof v === 'object') v = JSON.stringify(v);
    return hubCellSafe_(String(v == null ? '' : v));
  });
}

function schedPutLines_(sheet, at, lines) {
  if (!lines.length) return;
  var need = at + lines.length - 1;
  if (need > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), need - sheet.getMaxRows());
  var range = sheet.getRange(at, 1, lines.length, lines[0].length);
  range.setNumberFormat('@');
  range.setValues(lines);
}

function schedWrite_(tab, rows, appendOnly) {
  if (!rows || !rows.length) return 0;
  var held = sheetDbGateHolds_(tab, appendOnly ? 'create' : 'update');
  if (held) throw new Error(held.error.message);
  var sheet = schedSheet_(tab);
  var header = ensureHeader_(sheet, SCHED_HEADERS[tab]);
  var idf = schedIdField_(tab), idCol = header.indexOf(idf);
  var last = Math.max(sheet.getLastRow(), 1);
  var at = {};
  if (!appendOnly && last > 1 && idCol !== -1) {
    sheet.getRange(2, idCol + 1, last - 1, 1).getValues().forEach(function (r, i) {
      var k = schedCellText_(r[0]);
      if (k && !Object.prototype.hasOwnProperty.call(at, k)) at[k] = i + 2;
    });
  }
  var byId = {}, order = [];
  rows.forEach(function (row) {
    var k = schedStr_(row[idf]);
    if (!k) throw new Error('A ' + tab + ' row needs its ' + idf + '.');
    if (!Object.prototype.hasOwnProperty.call(byId, k)) order.push(k);
    byId[k] = row;
  });
  var updates = [], appends = [];
  order.forEach(function (k) {
    var line = schedLine_(header, byId[k]);
    if (Object.prototype.hasOwnProperty.call(at, k)) updates.push({ at: at[k], line: line });
    else appends.push(line);
  });
  if (updates.length > 40) {
    var body = sheet.getRange(2, 1, last - 1, header.length).getValues().map(function (r) {
      return r.map(function (v) { return hubCellSafe_(schedCellText_(v)); });
    });
    updates.forEach(function (u) { body[u.at - 2] = u.line; });
    schedPutLines_(sheet, 2, body);
  } else {
    updates.forEach(function (u) { schedPutLines_(sheet, u.at, [u.line]); });
  }
  schedPutLines_(sheet, last + 1, appends);
  SCHED_DIRTY = true;
  if (tab === SCHED_TABS.inbox) SCHED_INBOX_TOUCHED = true;
  schedMemoDrop_(tab);
  schedBump_();
  return order.length;
}

/** Writes rows by id (by key for settings); the caller holds the lock. */
function schedUpsert_(tab, rows) { return schedWrite_(tab, rows, false); }

function schedAppend_(tab, rows) { return schedWrite_(tab, rows, true); }

/** Deletes rows by id; the caller holds the lock. */
function schedRemove_(tab, ids) {
  if (!ids || !ids.length) return 0;
  var held = sheetDbGateHolds_(tab, 'update');
  if (held) throw new Error(held.error.message);
  var sheet = schedSheet_(tab);
  var header = ensureHeader_(sheet, SCHED_HEADERS[tab]);
  var idCol = header.indexOf(schedIdField_(tab));
  var last = sheet.getLastRow();
  if (last < 2 || idCol === -1) return 0;
  var want = {};
  ids.forEach(function (id) { want[schedStr_(id)] = true; });
  var hit = [];
  sheet.getRange(2, idCol + 1, last - 1, 1).getValues().forEach(function (r, i) {
    if (want[schedCellText_(r[0])]) hit.push(i + 2);
  });
  hit.sort(function (a, b) { return b - a; }).forEach(function (at) { sheet.deleteRow(at); });
  if (hit.length) SCHED_DIRTY = true;
  schedMemoDrop_(tab);
  schedBump_();
  return hit.length;
}

// Runs fn under the script lock (waiting `waitMs`, 20 s by default; not had → a 409 the panel shows).
function schedLock_(fn, waitMs) {
  var lock = LockService.getScriptLock();
  var held = false;
  try { held = lock.tryLock(waitMs === undefined ? SCHED_LOCK_MS : waitMs); } catch (e) { held = false; }
  if (!held) return schedRefuse_(409, SCHED_BUSY_SENTENCE);
  schedMemoFresh_();
  try { return fn(); } finally {
    try { schedSettle_(); } catch (eS) { /* released regardless */ }
    try { lock.releaseLock(); } catch (eR) {}
    schedInboxShareMaybe_();
  }
}

// The items house must be readable by the relay's mirror (My Work and My Inbox read it there).
var SCHED_INBOX_TOUCHED = false;
function schedInboxShareMaybe_() {
  if (!SCHED_INBOX_TOUCHED) return null;
  SCHED_INBOX_TOUCHED = false;
  var said = { ok: false, reason: '' };
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty(SCHED_INBOX_SHARED_PROP)) return { ok: true, already: true };
    var cache = CacheService.getScriptCache();
    if (cache.get(SCHED_INBOX_SHARE_TRY_KEY)) return { ok: false, waiting: true };
    cache.put(SCHED_INBOX_SHARE_TRY_KEY, '1', 600);
    var id = schedStr_(houseIdFor_(SCHED_TABS.inbox));
    if (!id) {
      said.reason = 'the items house has no pointer';
    } else {
      var file = { getId: function () { return id; }, getName: function () { return SCHED_TABS.inbox; } };
      if (hubGrantReader_(file, SCHED_INBOX_READER, said)) {
        props.setProperty(SCHED_INBOX_SHARED_PROP, new Date().toISOString() + ' ' + id);
        said.ok = true;
      }
    }
  } catch (e) { said.ok = false; said.reason = schedErr_(e); }
  if (!said.ok) {
    try {
      hubSysLog_('asa-hub:scheduling', 'scheduling_inbox_not_shared',
                 'the relay mirror (' + SCHED_INBOX_READER + ') is not yet a reader of sched_inbox: ' +
                 (schedStr_(said.reason) || 'the grant was refused') + ' — tried again on a later write', { status: 409 });
    } catch (eL) { /* the next write tries again */ }
  }
  return said;
}

function schedBump_() {
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    cache.put(SCHED_BOARD_VERSION_KEY, String(Date.now()) + schedNewId_('-'), SCHED_BOARD_TTL);
  } catch (e) {
    // a version that could not move must not stand: removed, the next read mints a new one
    try { if (cache) cache.remove(SCHED_BOARD_VERSION_KEY); } catch (eR) {}
  }
  SCHED_BOARD_MEMO = {};
}

/** The board's cache version; '' when the cache cannot answer, and then nothing is cached. */
function schedVersion_() {
  try {
    var cache = CacheService.getScriptCache();
    var v = cache.get(SCHED_BOARD_VERSION_KEY);
    if (!v) {
      v = String(Date.now()) + schedNewId_('-');
      cache.put(SCHED_BOARD_VERSION_KEY, v, SCHED_BOARD_TTL);
    }
    return v;
  } catch (e) { return ''; }
}

// ---- settings ----

function schedIntOf_(v, fallback) {
  var n = parseInt(schedStr_(v), 10);
  return isNaN(n) ? fallback : n;
}

function schedPeriodsOf_(raw) {
  var list = schedJson_(raw, null);
  if (!Array.isArray(list)) return null;
  var out = list.filter(function (p) {
    return p && schedIsoValid_(p.first) && schedIsoValid_(p.last) && p.first <= p.last;
  }).map(function (p) {
    return { id: schedStr_(p.id) || 'P' + p.first, first: p.first, last: p.last, state: schedStr_(p.state) || 'live',
             rolled_from: schedStr_(p.rolled_from), rolled_at: schedStr_(p.rolled_at), by: schedStr_(p.by) };
  });
  out.sort(function (a, b) { return a.first < b.first ? -1 : (a.first > b.first ? 1 : 0); });
  return out;
}

/** The settings house over the shipped defaults; directors are never defaulted — unreadable or empty refuses. */
function schedSettings_() {
  if (SCHED_MEMO.__settings) return SCHED_MEMO.__settings;
  var out = { readable: true, why: '', directors: [], directors_readable: false, directors_why: '',
              cycle_days: 28, roll_lead_days: 7, outreach_wait_min: 7, min_days_ahead: 7,
              periods: [SCHED_FIRST_PERIOD], houses: [], seeded_at: '', raw: {} };
  var kv = {};
  try {
    schedRead_(SCHED_TABS.settings).forEach(function (r) { kv[r.key] = r.value; });
  } catch (e) {
    out.readable = false;
    out.why = schedErr_(e);
  }
  out.raw = kv;
  var cyc = schedIntOf_(kv.cycle_days, 28);
  out.cycle_days = cyc >= 7 && cyc % 7 === 0 ? cyc : 28;
  out.roll_lead_days = Math.max(0, schedIntOf_(kv.roll_lead_days, 7));
  out.outreach_wait_min = Math.max(1, schedIntOf_(kv.outreach_wait_min, 7));
  out.min_days_ahead = Math.max(0, schedIntOf_(kv.min_days_ahead, 7));
  var periods = schedPeriodsOf_(kv.periods);
  if (periods && periods.length) out.periods = periods;
  var houses = schedJson_(kv.houses, null);
  if (Array.isArray(houses)) {
    out.houses = houses.filter(function (h) { return h && schedStr_(h.code); }).map(function (h) {
      return { code: schedStr_(h.code), location: schedStr_(h.location), short: schedStr_(h.short) || schedStr_(h.code),
               book_id: schedStr_(h.book_id) };
    });
  }
  out.seeded_at = schedStr_(kv.seeded_at);
  if (!out.readable) {
    out.directors_why = 'The Scheduling settings could not be read, so nobody is known to be a director: ' + out.why;
  } else {
    var emails = schedStr_(kv.directors).split(/[,;\s]+/).map(function (s) { return s.trim().toLowerCase(); })
      .filter(function (s) { return s.indexOf('@') > 0; });
    if (!emails.length) {
      out.directors_why = 'No directors are written in the Scheduling settings.';
    } else {
      var missed = [];
      emails.forEach(function (email) {
        var u = null;
        try { u = userByEmail_(email); } catch (eU) { u = null; }
        if (u && schedLive_(u)) out.directors.push({ email: email, uid: schedStr_(u.userid), name: schedStr_(u.displayname) });
        else missed.push(email);
      });
      out.directors_readable = out.directors.length > 0;
      if (missed.length) out.directors_why = 'No live account answers ' + missed.join(', ') + '.';
    }
  }
  SCHED_MEMO.__settings = out;
  return out;
}

function schedPeriodOf_(date) {
  var periods = schedSettings_().periods;
  for (var i = 0; i < periods.length; i++) {
    if (periods[i].first <= date && date <= periods[i].last) return periods[i];
  }
  return null;
}

function schedPeriodById_(id) {
  var periods = schedSettings_().periods;
  for (var i = 0; i < periods.length; i++) if (periods[i].id === id) return periods[i];
  return null;
}

/** The period holding Ohio's today; before the first, the first; after the last, the last. */
function schedCurrentPeriod_() {
  var periods = schedSettings_().periods, today = schedToday_();
  var hit = schedPeriodOf_(today);
  if (hit) return hit;
  if (!periods.length) return SCHED_FIRST_PERIOD;
  return today < periods[0].first ? periods[0] : periods[periods.length - 1];
}

function schedHouseList_() {
  var s = schedSettings_();
  if (s.houses.length) return s.houses;
  var seen = {}, out = [];
  schedRead_(SCHED_TABS.rows).forEach(function (r) {
    if (!r.house_code || seen[r.house_code]) return;
    seen[r.house_code] = true;
    out.push({ code: r.house_code, location: r.location, short: r.house_code, book_id: '' });
  });
  return out;
}

function schedHouseLabel_(houseCode) {
  var code = schedStr_(houseCode);
  var list;
  try { list = schedHouseList_(); } catch (e) { list = []; }
  for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i].short || code;
  return code;
}

/** Upper short name, code and location → code, for reading an alias that names a house. */
function schedHouseTokens_() {
  var map = {};
  var list;
  try { list = schedHouseList_(); } catch (e) { list = []; }
  list.forEach(function (h) {
    [h.code, h.short, h.location].forEach(function (t) {
      var up = schedStr_(t).toUpperCase();
      if (up) map[up] = h.code;
      var tight = up.replace(/\s+/g, '');
      if (tight) map[tight] = h.code;
    });
  });
  return map;
}

/** The house an alias names (any link of a chain), or ''. */
function schedNamesHouse_(text, tokens) {
  var parts = String(text == null ? '' : text).replace(/^\*+/, '').split(SCHED_CHAIN);
  for (var i = 0; i < parts.length; i++) {
    var up = parts[i].trim().toUpperCase();
    if (!up) continue;
    if (tokens[up]) return tokens[up];
    if (tokens[up.replace(/\s+/g, '')]) return tokens[up.replace(/\s+/g, '')];
  }
  return '';
}

// ---- accounts ----

function schedLive_(u) {
  var off = schedStr_(u && u.active).toUpperCase();
  return !!u && off !== 'FALSE' && off !== '0' && off !== 'NO' && !schedStr_(u.mergedinto);
}

/** Live accounts by display-name fold; null when the accounts cannot be read. */
function schedAccounts_() {
  if (Object.prototype.hasOwnProperty.call(SCHED_MEMO, '__accounts')) return SCHED_MEMO.__accounts;
  var byKey = null;
  try {
    byKey = {};
    (usersAll_() || []).forEach(function (u) {
      if (!schedLive_(u)) return;
      var k = hubNameFold_(u.displayname);
      if (!k) return;
      if (!byKey[k]) byKey[k] = [];
      byKey[k].push(u);
    });
  } catch (e) { byKey = null; }
  SCHED_MEMO.__accounts = byKey;
  return byKey;
}

/** The one live account whose display name folds to this key; null when none, two, or unreadable. */
function schedUserByKey_(personKey) {
  var all = schedAccounts_();
  var hits = all ? (all[schedStr_(personKey)] || []) : [];
  if (hits.length !== 1) return null;
  var u = hits[0];
  return { uid: schedStr_(u.userid), email: schedStr_(u.email).toLowerCase(), name: schedStr_(u.displayname),
           role: schedStr_(u.role), types: u.types };
}

/** The phone of somebody on staff (People house, by the name fold); '' for anyone whose People status is not. */
function schedPhoneOf_(personKey) {
  var key = schedStr_(personKey);
  if (!key) return '';
  if (!Object.prototype.hasOwnProperty.call(SCHED_MEMO, '__phones')) {
    var got = null;
    try { got = (typeof commBroadcastPeople_ === 'function') ? commBroadcastPeople_() : null; } catch (e) { got = null; }
    SCHED_MEMO.__phones = got && got.readable ? got : null;
  }
  var people = SCHED_MEMO.__phones;
  var row = people && people.byKey ? people.byKey[key] : null;
  if (!row || !(people.onStaff || {})[schedStr_(row.status).toLowerCase()]) return '';
  var e164 = hubPhoneE164_(row.phone);
  return /^\+\d{10,15}$/.test(e164) ? e164 : '';
}

// ---- the gate ----

/** Test mode, fail closed: anything unreadable or unknown is on. */
function schedTestMode_() {
  try {
    var s = hubTestModeState_();
    if (!s || (s.on !== true && s.on !== false)) return { on: true, readable: false, why: 'Test mode could not be read.' };
    if (s.unrecognized) {
      return { on: true, readable: false,
               why: (typeof hubTestModeUnknownWhy_ === 'function') ? hubTestModeUnknownWhy_(s.unrecognized)
                 : 'Test mode reads a word the switch does not know — held as on.' };
    }
    return { on: s.on, readable: true, why: s.on ? 'Test mode is on: texts are held.' : '' };
  } catch (e) {
    return { on: true, readable: false, why: 'Test mode could not be read (' + schedErr_(e) + ') — held as on.' };
  }
}

/** The viewer's own key: the display-name fold, only when no other live account folds the same. */
function schedKeyOf_(user, uid) {
  var key = hubNameFold_(user && (user.display_name != null ? user.display_name : user.displayname));
  if (!key) return '';
  var all = schedAccounts_();
  if (!all) return '';
  var hits = all[key] || [];
  if (hits.length > 1) return '';
  if (hits.length === 1 && schedStr_(hits[0].userid) !== uid) return '';
  return key;
}

function schedGate_(user) {
  var got = null;
  try { got = hubProfileAppGate_(SCHED_APP_ID, user); } catch (e) { got = null; }
  return schedCtxFor_(user, got);
}

/** The viewer's context behind an open gate ({ open, scope }); closed for any other. */
function schedCtxFor_(user, got) {
  var ctx = { open: false, scope: null, user: user, uid: '', name: '', key: '', is_master: false, is_director: false,
              editorOf: function () { return false; } };
  if (!got || !got.open) return ctx;
  ctx.open = true;
  ctx.scope = got.scope;
  ctx.uid = hubActingUserId_(user);
  ctx.name = schedStr_(user && (user.display_name != null ? user.display_name : user.displayname)) ||
             schedStr_(user && user.email);
  ctx.key = schedKeyOf_(user, ctx.uid);
  try { ctx.is_master = !!hubIsRealMaster_(user); } catch (eM) { ctx.is_master = false; }
  var s = null;
  try { s = schedSettings_(); } catch (eS) { s = null; }
  ctx.is_director = !!(s && ctx.uid && s.directors.some(function (d) { return d.uid === ctx.uid; }));
  ctx.editorOf = function (houseCode) {
    if (ctx.is_master || ctx.is_director) return true;
    if (!ctx.key) return false;
    try {
      return schedHouseManagers_(houseCode).some(function (m) { return m.key === ctx.key; });
    } catch (eH) { return false; }
  };
  return ctx;
}

function schedClosed_() { return schedRefuse_(404, 'Unknown action.'); }

/** Hours travel to the master always, to everyone else only when the switch is readable and off. */
function schedHoursHidden_(ctx) {
  if (ctx && ctx.is_master) return false;
  var read = (typeof hubSchedHoursHidden_ === 'function') ? hubSchedHoursHidden_ : null;
  if (!read) return true;
  try { return read() !== false; } catch (e) { return true; }
}

// ---- rows and cells ----

function schedRowKindOf_(name) {
  var s = schedStr_(name);
  if (/^\s*open(?![a-z])/i.test(s)) return 'open';
  if (/workshop/i.test(s)) return 'workshop';
  if (SCHED_NOT_PEOPLE[schedFold_(s)]) return 'other';
  return 'person';
}

function schedOpenN_(rowId) {
  var m = /^OPEN:(\d+)$/.exec(schedStr_(rowId));
  return m ? parseInt(m[1], 10) : 0;
}

function schedRowOrder_(a, b) {
  var rank = function (r) { return r.row_kind === 'open' ? 0 : (r.row_kind === 'person' ? 1 : 2); };
  var ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return schedOpenN_(a.row_id) - schedOpenN_(b.row_id);
  return (parseFloat(a.order) || 0) - (parseFloat(b.order) || 0);
}

/** A house's active rows: OPEN rows first, then people in roster order, then the rest. */
function schedRows_(houseCode) {
  return schedRead_(SCHED_TABS.rows).filter(function (r) {
    return r.house_code === houseCode && r.active !== 'no';
  }).sort(schedRowOrder_);
}

function schedRowAt_(houseCode, rowId) {
  var rows = schedRead_(SCHED_TABS.rows);
  for (var i = 0; i < rows.length; i++) if (rows[i].house_code === houseCode && rows[i].row_id === rowId) return rows[i];
  return null;
}

function schedCellAt_(houseCode, rowId, date) {
  var id = schedCellId_(houseCode, rowId, date);
  var cells = schedRead_(SCHED_TABS.cells);
  for (var i = 0; i < cells.length; i++) if (cells[i].id === id) return cells[i];
  return null;
}

function schedHouseManagers_(houseCode) {
  return schedRead_(SCHED_TABS.rows).filter(function (r) {
    return r.house_code === houseCode && r.active !== 'no' && r.row_kind === 'person' && r.designation === '**';
  }).map(function (r) {
    var u = schedUserByKey_(r.person_key);
    return { name: r.name, key: r.person_key, uid: u ? u.uid : '', email: u ? u.email : '' };
  });
}

function schedCellRow_(houseCode, rowId, date, text, extra) {
  var cls = schedClassify_(text);
  var p = schedPeriodOf_(date);
  var row = {
    id: schedCellId_(houseCode, rowId, date), period_id: p ? p.id : '', house_code: houseCode, date: date,
    row_id: rowId, text: text, kind: cls ? cls.kind : '',
    start_min: cls && cls.start !== null ? String(Math.round(cls.start * 60)) : '',
    end_min: cls && cls.end !== null ? String(Math.round(cls.end * 60)) : '',
    hours: cls ? cls.hours.toFixed(2) : '0.00', token: cls && cls.token ? cls.token : '', color: '',
    state: '', base: '', flow_id: '', source: 'app', note: '', updated_at: schedNow_(), updated_by: ''
  };
  for (var k in (extra || {})) if (Object.prototype.hasOwnProperty.call(extra, k)) row[k] = extra[k];
  return row;
}

function schedLogRow_(ctx, houseCode, date, rowId, was, now, via, flowId, note) {
  return { id: schedNewId_('SL'), at: schedNow_(), by_uid: ctx ? ctx.uid : 'system',
           by_name: ctx ? ctx.name : 'Scheduling', house_code: houseCode, date: date, row_id: rowId,
           was: was, now: now, via: via, flow_id: flowId || '', note: schedStr_(note).slice(0, 500), undone_at: '' };
}

/** Writes or clears one cell and logs it; an empty text with no base deletes the row. The caller holds the lock. */
function schedSetCell_(houseCode, rowId, date, patch, via, ctx, note, flowId) {
  patch = patch || {};
  var was = schedCellAt_(houseCode, rowId, date);
  var text = schedStr_(patch.text);
  var base = patch.base !== undefined ? schedStr_(patch.base) : '';
  var rowRec = schedRowAt_(houseCode, rowId);
  var out = null;
  if (!text && !base) {
    if (was) schedRemove_(SCHED_TABS.cells, [was.id]);
  } else {
    var state = schedStr_(patch.state) ||
      (rowRec && rowRec.row_kind === 'open' && schedClassify_(text) && schedClassify_(text).start !== null ? 'open' : 'scheduled');
    out = schedCellRow_(houseCode, rowId, date, text, {
      state: state, base: base, flow_id: schedStr_(patch.flow_id !== undefined ? patch.flow_id : flowId),
      source: schedStr_(patch.source) || (flowId ? 'flow:' + flowId : 'app'),
      color: was ? was.color : '', note: schedStr_(note).slice(0, 500), updated_by: ctx ? ctx.uid : 'system'
    });
    schedUpsert_(SCHED_TABS.cells, [out]);
  }
  schedAppend_(SCHED_TABS.log, [schedLogRow_(ctx, houseCode, date, rowId, was ? was.text : '', text, via, flowId, note)]);
  return out;
}

function schedOpenRowRecord_(houseCode, n, ctx) {
  var rowId = 'OPEN:' + n;
  var loc = '';
  try {
    schedHouseList_().forEach(function (h) { if (h.code === houseCode) loc = h.location; });
  } catch (e) { loc = ''; }
  return { id: schedRowId_(houseCode, rowId), house_code: houseCode, location: loc, row_id: rowId, row_kind: 'open',
           name: n === 1 ? 'OPEN' : 'OPEN ' + n, person_key: '', designation: '', order: String(n), active: 'yes',
           source: 'app', updated_at: schedNow_(), updated_by: ctx ? ctx.uid : 'system' };
}

/** The first OPEN row with nothing that day, or the next new one: { row_id, fresh: row record | null }. */
function schedOpenRowFor_(houseCode, date, rows, cellIds) {
  var open = rows.filter(function (r) { return r.house_code === houseCode && r.row_kind === 'open' && r.active !== 'no'; })
    .sort(schedRowOrder_);
  var maxN = 0;
  for (var i = 0; i < open.length; i++) {
    maxN = Math.max(maxN, schedOpenN_(open[i].row_id));
    if (!cellIds[schedCellId_(houseCode, open[i].row_id, date)]) return { row_id: open[i].row_id, fresh: null };
  }
  rows.filter(function (r) { return r.house_code === houseCode && r.row_kind === 'open'; }).forEach(function (r) {
    maxN = Math.max(maxN, schedOpenN_(r.row_id));
  });
  var n = maxN + 1;
  while (cellIds[schedCellId_(houseCode, 'OPEN:' + n, date)]) n++;
  return { row_id: 'OPEN:' + n, fresh: n };
}

// Places `text` on the first OPEN row free that day (a new OPEN row when none is), state open.
function schedOpenShift_(houseCode, date, text, flowId, ctx, base) {
  var ids = {};
  schedRead_(SCHED_TABS.cells).forEach(function (c) {
    if (c.date === date && c.house_code === houseCode && (c.text || c.base)) ids[c.id] = true;
  });
  var pick = schedOpenRowFor_(houseCode, date, schedRead_(SCHED_TABS.rows), ids);
  if (pick.fresh) schedUpsert_(SCHED_TABS.rows, [schedOpenRowRecord_(houseCode, pick.fresh, ctx)]);
  schedSetCell_(houseCode, pick.row_id, date, { text: text, state: 'open', flow_id: flowId || '', base: schedStr_(base),
                                               source: flowId ? 'flow:' + flowId : 'app' }, 'open', ctx, '', flowId);
  return { row_id: pick.row_id };
}

// ---- the overlap law: half-open intervals per folded person across every house ----

/** A call-off or time off: only the person, the house's editors, the directors and the master learn of it. */
function schedCellPrivate_(cell) {
  var state = schedStr_(cell && cell.state);
  if (state === 'called_off' || state === 'time_off') return true;
  var cls = schedClassify_(cell && cell.text);
  return !!(cls && cls.kind === 'ro' && cls.code === 'C/O');
}

/** What one stored cell holds against its person: null, or { s, e (absolute minutes), whole, named, private, ... }. */
function schedHoldOf_(cell, tokens) {
  var text = schedStr_(cell.text);
  var state = schedStr_(cell.state);
  if (!text && !SCHED_OFF_STATES[state]) return null;
  var day = schedDayIndex_(cell.date) * 1440;
  var cls = schedClassify_(text);
  var whole = { s: day, e: day + 1440, whole: true };
  if (state === 'swapped_out') return null;
  if (SCHED_OFF_STATES[state] || (cls && cls.kind === 'ro')) {
    whole.why = 'off';
    whole.private = schedCellPrivate_(cell);
    return whole;
  }
  if (!cls || cls.kind === 'off') return null;
  if (cls.start !== null) return { s: day + Math.round(cls.start * 60), e: day + Math.round(cls.end * 60), why: 'overlap' };
  var inside = schedTimeInside_(text);
  if (inside) return { s: day + Math.round(inside[0] * 60), e: day + Math.round(inside[1] * 60), why: 'overlap' };
  whole.why = 'unreadable';
  whole.named = schedNamesHouse_(text, tokens);
  return whole;
}

/** Every hold of every person: { [key]: [{ house_code, date, text, s, e, whole, named, why, cell_id }] }. */
function schedHoldIndex_(cells, rows, flows, tokens) {
  var personOf = {};
  rows.forEach(function (r) {
    if (r.row_kind === 'person' && r.person_key) personOf[r.house_code + '|' + r.row_id] = r.person_key;
  });
  var out = {};
  var push = function (key, h) { if (!out[key]) out[key] = []; out[key].push(h); };
  cells.forEach(function (c) {
    var key = personOf[c.house_code + '|' + c.row_id];
    if (!key) return;
    var h = schedHoldOf_(c, tokens);
    if (!h) return;
    h.house_code = c.house_code; h.date = c.date; h.text = c.text || c.base || ''; h.cell_id = c.id;
    push(key, h);
  });
  (flows || []).forEach(function (f) {
    if (f.kind !== 'time_off' || (f.state !== 'approved' && f.state !== 'approved_future') || !f.person_key) return;
    if (!schedIsoValid_(f.date)) return;
    var to = schedIsoValid_(f.date_to) ? f.date_to : f.date;
    schedDates_(f.date, to).forEach(function (d) {
      var day = schedDayIndex_(d) * 1440;
      push(f.person_key, { s: day, e: day + 1440, whole: true, why: 'time_off', house_code: '', date: d,
                           text: 'time off', cell_id: '', flow_id: f.id, private: true });
    });
  });
  return out;
}

function schedHoldsNow_() {
  return schedHoldIndex_(schedRead_(SCHED_TABS.cells), schedRead_(SCHED_TABS.rows), schedRead_(SCHED_TABS.flows),
                         schedHouseTokens_());
}

// null when the person is free, or { house_code, date, text, why } of the first thing they hold against [start_min…
function schedClash_(personKey, date, startMin, endMin, opts) {
  opts = opts || {};
  var key = schedStr_(personKey);
  if (!key || !schedIsoValid_(date)) return null;
  var holds = (opts.holds || schedHoldsNow_())[key] || [];
  var ignore = {};
  (opts.ignore_cell_ids || []).forEach(function (id) { ignore[id] = true; });
  var day = schedDayIndex_(date) * 1440;
  var unread = startMin === null || startMin === undefined || startMin === '';
  var s = unread ? day : day + Number(startMin), e = unread ? day + 1440 : day + Number(endMin);
  var placing = schedStr_(opts.house_code);
  var named = opts.value ? schedNamesHouse_(opts.value, opts.tokens || schedHouseTokens_()) : '';
  for (var i = 0; i < holds.length; i++) {
    var h = holds[i];
    if (h.cell_id && ignore[h.cell_id]) continue;
    // an echo of a shift never blocks the shift it echoes, either way round
    if (h.whole && h.named && placing && h.named === placing) continue;
    if (unread && named && h.house_code === named) continue;
    if (h.s < e && s < h.e) {
      return { house_code: h.house_code, date: h.date, text: h.text, why: unread && h.why === 'overlap' ? 'unreadable' : h.why,
               private: !!h.private };
    }
  }
  return null;
}

/** Whether `ctx` may learn why `key` is not free: the person, the master, a director, or an editor of that house. */
function schedSeesWhy_(ctx, key, houseCode) {
  if (!ctx) return false;
  if (ctx.is_master || ctx.is_director) return true;
  if (key && ctx.key && ctx.key === key) return true;
  if (!houseCode || typeof ctx.editorOf !== 'function') return false;
  try { return !!ctx.editorOf(houseCode); } catch (e) { return false; }
}

// The refusal a clash answers, in the one sentence the panel shows.
function schedClashSentence_(name, clash, ctx, key) {
  if (clash.private && ctx !== undefined && !schedSeesWhy_(ctx, key, clash.house_code)) {
    return 'Not possible: ' + name + ' is not free that day.';
  }
  if (clash.why === 'time_off') return 'Not possible: ' + name + ' has approved time off that day.';
  return 'Not possible: ' + name + ' is already at ' + schedHouseLabel_(clash.house_code) + ' ' +
         schedShiftWords_({ text: clash.text }) + ' that day.';
}

// ---- Staff Preferences: a placement against them waits for an override ----

var SCHED_PREF_DAY_WORDS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
var SCHED_PREFS_OVERRIDE_NOTE = 'Override: placed against Staff Preferences';

// What `personKey`'s Staff Preferences say against working at `houseCode` on `date` ('' = no day): { why, fields }…
function schedPrefsAgainst_(personKey, name, houseCode, date) {
  var key = schedStr_(personKey);
  if (!key || typeof spPrefsIndex_ !== 'function') return null;
  var p = null;
  try { p = (spPrefsIndex_() || {})[key] || null; } catch (e) { p = null; }
  if (!p) return null;
  var says = [], fields = [];
  if (houseCode && (p.houses || []).indexOf(houseCode) !== -1) {
    says.push('cannot work at ' + schedHouseLabel_(houseCode));
    fields.push('unavailable_locations');
  }
  var period = null;
  try { period = date && schedIsoValid_(date) ? schedPeriodOf_(date) : null; } catch (eP) { period = null; }
  if (period) {
    var week = Math.floor((schedDayIndex_(date) - schedDayIndex_(period.first)) / 7) % 2 ? 'b' : 'a';
    var dow = schedDow_(date);
    if (((p.days || {})[week] || []).indexOf(SCHED_WEEKDAYS[dow].toLowerCase()) !== -1) {
      says.push('are unavailable on ' + SCHED_PREF_DAY_WORDS[dow] + ' in Week ' + week.toUpperCase());
      fields.push('unavailable_days');
    }
  }
  if (!says.length) return null;
  return { why: schedStr_(name) + '\'s Staff Preferences say they ' + says.join(' and ') + '.', fields: fields };
}

/** The 409 the panel turns into a confirm; the same write sent again with `override: true` goes ahead. */
function schedPrefsRefusal_(against) {
  return { status: 409, message: against.why, data: { needs_override: true, reason: against.why } };
}

/** An override is kept in the edit log: the preferences crossed by name, never what they hold. No texts. */
function schedPrefsOverrideLog_(user, action, houseCode, date, personKey, against) {
  try {
    hubEditLog_(user, action, 'override ' + houseCode + ' ' + (date || '') + ' ' + personKey,
                against.fields.map(function (f) { return { field: f }; }), []);
  } catch (e) { /* the Scheduling log line still carries it */ }
}

function schedPrefsNote_(note) {
  var n = schedStr_(note);
  return n ? n + ' — ' + SCHED_PREFS_OVERRIDE_NOTE : SCHED_PREFS_OVERRIDE_NOTE;
}

// ---- IST: trained at THAT house (the relay's rule, server/shift_requests.py ist_index + ist_verdict) ----

/** The IST book and its settings, once an execution; kept apart from SCHED_MEMO, which a lock empties. */
var SCHED_IST_MEMO = null;

function schedIstDay_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    try { return Utilities.formatDate(v, SCHED_TZ, 'yyyy-MM-dd'); } catch (e) { return ''; }
  }
  return schedStr_(v).slice(0, 10);
}

// Read BEFORE any Scheduling lock is taken: the IST settings seed their own tab under the script lock, which inside…
function schedIstWarm_() {
  if (SCHED_IST_MEMO) return SCHED_IST_MEMO;
  var out = { readable: false, why: '', by: {}, scope: 'house', valid_days: 0, mapped: {}, mapped_readable: false,
              today: '' };
  var done = function () { SCHED_IST_MEMO = out; return out; };
  try { out.today = istOhioToday_(); } catch (eT) { out.today = schedToday_(); }
  try {
    istConfig_();
    if (istConfigSource_() === 'shipped') {
      out.why = 'the IST settings could not be read, so nobody can be shown to be trained';
      return done();
    }
    out.scope = istCfgChoice_('ist_trained_scope');
    out.valid_days = istCfgInt_('ist_valid_days');
  } catch (eC) { out.why = 'the IST settings could not be read (' + schedErr_(eC) + ')'; return done(); }
  var rows;
  try { rows = listRows_('istRecords', {}) || []; }
  catch (eR) { out.why = 'the IST record could not be read (' + schedErr_(eR) + ')'; return done(); }
  if (!rows.length) { out.why = 'the IST record holds no rows, so nobody can be shown to be trained'; return done(); }
  var doneWord = (typeof IST_STATUS_DONE !== 'undefined') ? IST_STATUS_DONE : 'done';
  rows.forEach(function (d) {
    var who = schedFold_(d.staffName), code = schedStr_(d.house).toUpperCase();
    if (!who || !code) return;
    var p = out.by[who] || (out.by[who] = {});
    var slot = p[code] || (p[code] = { done: [], owed: 0 });
    var at = schedIstDay_(d.trainedAt);
    if (schedStr_(d.status).toLowerCase() === doneWord || at) slot.done.push({ client: schedStr_(d.clientName), at: at });
    else slot.owed++;
  });
  if (out.scope === 'client') {
    try {
      var map = listRows_('istHouses', {}) || [];
      map.forEach(function (r) {
        if (schedStr_(r.active || 'yes').toLowerCase() === 'no') return;
        var code = schedStr_(r.house).toUpperCase(), client = schedStr_(r.clientName);
        if (!code || !client) return;
        var list = out.mapped[code] || (out.mapped[code] = []);
        if (list.indexOf(client) === -1) list.push(client);
      });
      out.mapped_readable = map.length > 0;
    } catch (eM) { out.mapped_readable = false; }
  }
  out.readable = true;
  return done();
}

/** A completed IST still counts on day `days` after it (Ohio date); no date, or 0 days, never lapses. */
function schedIstLapsed_(at, days, today) {
  if (!days || !schedIsoValid_(at) || !schedIsoValid_(today)) return false;
  return schedDayIndex_(today) > schedDayIndex_(at) + days;
}

/** { has: true | false | null (unreadable, which counts as missing), state, why } — never names a client. */
function schedIstFor_(personKey, houseCode) {
  var key = schedStr_(personKey), code = schedStr_(houseCode).toUpperCase();
  var house = code;
  try { house = schedHouseLabel_(code) || code; } catch (eH) { house = code; }
  var idx = schedIstWarm_();
  var say = function (has, state, why) { return { has: has, state: state, why: why }; };
  if (!key || !code) return say(null, 'unreadable', 'no person or house to check the IST against');
  if (!idx.readable) return say(null, 'unreadable', idx.why + ' — so no IST at ' + house + ' can be shown');
  var slot = (idx.by[key] || {})[code] || null;
  var rows = slot ? slot.done : [];
  var current = rows.filter(function (r) { return !schedIstLapsed_(r.at, idx.valid_days, idx.today); });
  var lapsed = rows.filter(function (r) { return schedIstLapsed_(r.at, idx.valid_days, idx.today); });
  if (idx.scope === 'client') {
    if (!idx.mapped_readable) return say(null, 'unreadable', 'the house to client map could not be read, and the IST ' +
                                           'settings ask for an IST on every client at ' + house);
    var need = idx.mapped[code] || [], have = {};
    current.forEach(function (r) { have[schedFold_(r.client)] = true; });
    var short = need.filter(function (c) { return !have[schedFold_(c)]; });
    if (need.length && !short.length) return say(true, 'ok', 'trained at ' + house + ' on every client there');
    if (need.length) return say(false, slot ? 'owed' : 'missing', 'no IST at ' + house + ' for every client there');
  }
  if (current.length) return say(true, 'ok', 'trained at ' + house);
  if (lapsed.length) return say(false, 'owed', 'the IST for ' + house + ' has lapsed');
  if (slot && slot.owed) return say(false, 'owed', 'the IST for ' + house + ' is still owed');
  return say(false, 'missing', 'no IST for ' + house + ' on file');
}

// On the house's roster before a placement: an active person row there from the book, or one that already held a…
function schedOnRoster_(houseCode, personKey) {
  var key = schedStr_(personKey);
  if (!key) return false;
  var row = null;
  schedRead_(SCHED_TABS.rows).forEach(function (r) {
    if (r.house_code === houseCode && r.row_kind === 'person' && r.person_key === key && r.active !== 'no') row = r;
  });
  if (!row) return false;
  if (/^seed:/.test(schedStr_(row.source))) return true;
  return schedRead_(SCHED_TABS.cells).some(function (c) {
    if (c.house_code !== houseCode || c.row_id !== row.row_id || c.state === 'training') return false;
    var a = schedClassify_(c.text), b = schedClassify_(c.base);
    return !!((a && a.start !== null) || (b && b.start !== null));
  });
}

/** Placing `personKey` on a shift at `houseCode` makes them a trainee: new to the house and without its IST. null = no. */
function schedTrainingNeed_(houseCode, personKey) {
  if (schedOnRoster_(houseCode, personKey)) return null;
  var ist = schedIstFor_(personKey, houseCode);
  return ist.has === true ? null : ist;
}

// An editor writes `value` on a person's cell (the caller holds the lock and has checked the overlap law).
function schedEditorPlace_(ctx, house, row, date, value, was, via, note, newRow) {
  var cls = schedClassify_(value);
  var timed = !!(value && cls && cls.start !== null);
  var wasState = schedStr_(was && was.state);
  if (was && SCHED_HELD_ONE_OFF[wasState] && timed && schedStr_(was.text)) {
    // a pattern that is the shift itself (an approved editor's training) follows its new hours
    var keptBase = schedStr_(was.base) && schedStr_(was.base) === schedStr_(was.text) ? value : schedStr_(was.base);
    var kept = schedSetCell_(house, row.row_id, date, { text: value, state: wasState, base: keptBase,
                             flow_id: schedStr_(was.flow_id), source: schedStr_(was.source) || 'app' },
                             via, ctx, note, schedStr_(was.flow_id));
    if (wasState === 'training') schedTrainingMoved_(schedStr_(was.flow_id), kept, ctx);
    return { cell: kept, training: null };
  }
  var need = timed && row.row_kind === 'person' ? schedTrainingNeed_(house, row.person_key) : null;
  var plan = null, person = null;
  if (need) {
    var u = schedUserByKey_(row.person_key);
    person = { name: row.name, key: row.person_key, uid: u ? u.uid : '' };
    plan = schedTrainingPlan_(house, person, schedSettings_());
    if (plan.status) return plan;
  }
  if (newRow) schedUpsert_(SCHED_TABS.rows, [newRow]);
  if (wasState === 'training' && schedStr_(was.flow_id)) {
    schedTrainingEnd_(schedStr_(was.flow_id), 'withdrawn', ctx, 'the shift was taken off the calendar by ' + ctx.name);
  }
  if (!need) return { cell: schedSetCell_(house, row.row_id, date, { text: value, source: 'app' }, via, ctx, note, ''), training: null };
  var id = schedFlowNewId_('SF', house + '|' + row.row_id + '|' + date + '|training');
  var cell = schedSetCell_(house, row.row_id, date, { text: value, state: 'training', base: schedBaseOf_(was), flow_id: id,
                                                     source: 'flow:' + id }, via, ctx, note, id);
  schedTrainingOpen_({ id: id, house: house, date: date, cell: cell, person: person, ist: need, source: 'editor',
                       source_ref: '', ctx: ctx, plan: plan });
  return { cell: cell, training: { flow_id: id, why: need.why } };
}

// ---- badges: house manager, team leader, Medication Administration level ----

function schedMedLevel_(certs) {
  var level = 0;
  [1, 2, 3].forEach(function (n) {
    var c = certs && certs['med' + n];
    if (!c || !schedStr_(c.expires) || c.evidence === 'submitted') return;
    if (c.status === 'valid' || c.status === 'expiring') level = n;
  });
  return level;
}

/** { med: {key: 1|2|3}, lead: {key: true}, why } — only the level travels, never a date. Cached. */
function schedBadgeFacts_() {
  if (SCHED_MEMO.__badges) return SCHED_MEMO.__badges;
  var cache = null, out = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get(SCHED_BADGES_KEY);
    if (hit) out = JSON.parse(hit);
  } catch (e) { out = null; }
  if (!out) {
    out = { med: {}, lead: {}, why: '' };
    var whys = [];
    try {
      var pic = certPicture_() || {};
      Object.keys(pic).forEach(function (k) {
        var n = schedMedLevel_(pic[k] && pic[k].certs);
        if (n) out.med[k] = n;
      });
    } catch (eC) { whys.push('certificates: ' + schedErr_(eC)); }
    try {
      (usersAll_() || []).forEach(function (u) {
        if (!schedLive_(u)) return;
        if (userBadgesWorn_(u.types, u.role).indexOf('TEAMLEAD') === -1) return;
        var k = hubNameFold_(u.displayname);
        if (k) out.lead[k] = true;
      });
    } catch (eU) { whys.push('accounts: ' + schedErr_(eU)); }
    out.why = whys.join('; ');
    // a source that failed is asked again soon, not on every read of a board cached for hours
    if (cache) {
      try { cache.put(SCHED_BADGES_KEY, JSON.stringify(out), whys.length ? SCHED_BADGES_RETRY_TTL : SCHED_BADGES_TTL); }
      catch (eP) {}
    }
  }
  SCHED_MEMO.__badges = out;
  return out;
}

// ---- the board: built once per period, cached in chunks, cut per viewer after the cache ----

var SCHED_BOARD_MEMO = {};

function schedCacheGet_(base) {
  try {
    var cache = CacheService.getScriptCache();
    var n = parseInt(cache.get(base + ':n') || '', 10);
    if (!n) return null;
    var keys = [], parts = {}, text = '';
    for (var i = 0; i < n; i++) keys.push(base + ':' + i);
    // one round trip where the cache offers it
    if (typeof cache.getAll === 'function') parts = cache.getAll(keys);
    else keys.forEach(function (k) { parts[k] = cache.get(k); });
    for (var j = 0; j < n; j++) {
      var part = parts[keys[j]];
      if (part === null || part === undefined) return null;
      text += part;
    }
    return JSON.parse(text);
  } catch (e) { return null; }
}

function schedCachePut_(base, value, ttl) {
  try {
    var text = JSON.stringify(value);
    var n = Math.ceil(text.length / SCHED_CHUNK);
    if (n > 60) return;
    var cache = CacheService.getScriptCache(), life = ttl || SCHED_BOARD_TTL, all = {};
    for (var i = 0; i < n; i++) all[base + ':' + i] = text.substr(i * SCHED_CHUNK, SCHED_CHUNK);
    if (typeof cache.putAll === 'function') cache.putAll(all, life);
    else Object.keys(all).forEach(function (k) { cache.put(k, all[k], life); });
    // the count last: a reader never finds it before its parts
    cache.put(base + ':n', String(n), life);
  } catch (e) {}
}

/** An exchange's partner shift (SchedulingFlows.gs outreach_log.exchange), or null. */
function schedExchangeOf_(f) {
  if (!f || f.kind !== 'swap') return null;
  var log = schedJson_(f.outreach_log, {});
  var ex = log && typeof log === 'object' ? log.exchange : null;
  if (!ex || typeof ex !== 'object' || !schedStr_(ex.house) || !/^P:./.test(schedStr_(ex.row_id)) ||
      !schedIsoValid_(ex.date)) return null;
  return ex;
}

function schedFlowOut_(f, withReason) {
  var seats = schedJson_(f.seats, []);
  var ex = schedExchangeOf_(f);
  return {
    id: f.id, kind: f.kind, state: f.state, house_code: f.house_code, house_label: schedHouseLabel_(f.house_code),
    date: f.date, date_to: f.date_to, row_id: f.row_id, person: f.person, shift_text: f.shift_text,
    open_row_id: f.open_row_id, replacement: f.replacement,
    seats: (Array.isArray(seats) ? seats : []).map(function (s) {
      var o = { seat: s && s.seat, state: s && s.state, at: s && s.at, why: s && s.why,
                to: ((s && s.to) || []).map(function (t) { return { name: t && t.name }; }) };
      if (s && s.house) { o.house = s.house; o.house_label = schedHouseLabel_(s.house); }
      return o;
    }),
    exchange: ex ? { house_code: ex.house, house_label: schedHouseLabel_(ex.house), date: ex.date, row_id: ex.row_id,
                     shift_text: schedStr_(ex.text) } : undefined,
    reason: withReason ? f.reason : undefined, note: f.note, source: f.source, test_mode: f.test_mode,
    created_at: f.created_at, updated_at: f.updated_at, closed_at: f.closed_at
  };
}

/** Everything about a period nobody's eyes change: built from the six houses. */
function schedBuildBase_(period) {
  var settings = schedSettings_();
  var houses = schedHouseList_();
  var rows = schedRead_(SCHED_TABS.rows);
  var allCells = schedRead_(SCHED_TABS.cells);
  var flows = schedRead_(SCHED_TABS.flows);
  var inbox = schedRead_(SCHED_TABS.inbox);
  var log = schedRead_(SCHED_TABS.log);
  var tokens = schedHouseTokens_();
  var badges = schedBadgeFacts_();
  var accounts = schedAccounts_();
  var dates = schedDates_(period.first, period.last);
  var col = {};
  dates.forEach(function (d, i) { col[d] = i; });
  var cells = allCells.filter(function (c) { return Object.prototype.hasOwnProperty.call(col, c.date); });

  var flowById = {}, flowAt = {}, timeOff = {};
  flows.forEach(function (f) {
    flowById[f.id] = { id: f.id, kind: f.kind, state: f.state };
    if (/^waiting/.test(f.state) && f.house_code && f.row_id && f.date) {
      // a swap's mark names whoever is on the other side of that cell
      var flowMark = function (other) {
        var m = { id: f.id, kind: f.kind, state: f.state };
        if (f.kind === 'swap' && schedStr_(other)) m['with'] = schedStr_(other);
        return m;
      };
      flowAt[f.house_code + '|' + f.row_id + '|' + f.date] = flowMark(f.replacement);
      // an exchange waits on both shifts: the partner's cell carries it too
      var ex = schedExchangeOf_(f);
      if (ex) flowAt[ex.house + '|' + ex.row_id + '|' + ex.date] = flowMark(f.person);
    }
    if (f.kind === 'time_off' && f.person_key && schedIsoValid_(f.date)) {
      var mark = f.state === 'waiting' ? 'asked' : (f.state === 'approved' || f.state === 'approved_future' ? 'approved' : '');
      if (!mark) return;
      schedDates_(f.date, schedIsoValid_(f.date_to) ? f.date_to : f.date).forEach(function (d) {
        if (!Object.prototype.hasOwnProperty.call(col, d)) return;
        if (!timeOff[f.person_key]) timeOff[f.person_key] = {};
        if (timeOff[f.person_key][d] !== 'approved') timeOff[f.person_key][d] = mark;
      });
    }
  });

  var holds = schedHoldIndex_(cells, rows, flows, tokens);
  var timedAt = {};
  var personOf = {};
  rows.forEach(function (r) { if (r.row_kind === 'person' && r.person_key) personOf[r.house_code + '|' + r.row_id] = r.person_key; });
  cells.forEach(function (c) {
    var key = personOf[c.house_code + '|' + c.row_id];
    if (!key || SCHED_OFF_STATES[c.state]) return;
    var cls = schedClassify_(c.text);
    if (!cls || cls.start === null) return;
    if (!timedAt[key]) timedAt[key] = {};
    if (!timedAt[key][c.date]) timedAt[key][c.date] = [];
    if (timedAt[key][c.date].indexOf(c.house_code) === -1) timedAt[key][c.date].push(c.house_code);
  });
  var shortOf = {};
  houses.forEach(function (h) { shortOf[h.code] = h.short || h.code; });

  var cellAt = {};
  cells.forEach(function (c) { cellAt[c.house_code + '|' + c.row_id + '|' + c.date] = c; });

  // a Saturday week can straddle two periods: its hours are counted from every cell of the week
  var weekFrom = schedWeekKey_(period.first), weekTo = schedIsoAdd_(schedWeekKey_(period.last), 6);
  var weekHours = {};
  allCells.forEach(function (c) {
    if (!c.date || c.date < weekFrom || c.date > weekTo || !personOf[c.house_code + '|' + c.row_id]) return;
    if (SCHED_OFF_STATES[c.state]) return;
    var cls = schedClassify_(c.text);
    if (!cls || cls.start === null) return;
    var at = c.house_code + '|' + c.row_id, wk = schedWeekKey_(c.date);
    if (!weekHours[at]) weekHours[at] = {};
    weekHours[at][wk] = Math.round(((weekHours[at][wk] || 0) + cls.hours) * 100) / 100;
  });

  var grids = {}, people = {}, managers = {}, hmKeys = {};
  houses.forEach(function (h) {
    var hr = rows.filter(function (r) { return r.house_code === h.code && r.active !== 'no'; }).sort(schedRowOrder_);
    var days = dates.map(function (d) { return { iso: d, working: 0, hours: 0 }; });
    managers[h.code] = [];
    hmKeys[h.code] = [];
    var outRows = hr.map(function (r) {
      var isPerson = r.row_kind === 'person';
      var key = isPerson ? r.person_key : '';
      if (isPerson && key && !people[key]) people[key] = { key: key, name: r.name, has_account: !!(accounts && (accounts[key] || []).length === 1) };
      if (isPerson && r.designation === '**') { managers[h.code].push(r.name); if (key) hmKeys[h.code].push(key); }
      var total = 0, byWeek = isPerson ? schedCopy_(weekHours[h.code + '|' + r.row_id] || {}) : {};
      var line = dates.map(function (d, i) {
        var c = cellAt[h.code + '|' + r.row_id + '|' + d];
        var mark = key && timeOff[key] ? timeOff[key][d] : '';
        if (!c || (!c.text && !mark)) {
          var elsewhere = key && timedAt[key] && timedAt[key][d] ? timedAt[key][d].filter(function (x) { return x !== h.code; }) : [];
          if (c && !c.text) {
            var empty = { text: '', kind: '', state: c.state };
            if (c.flow_id && flowById[c.flow_id]) empty.flow = flowById[c.flow_id];
            if (elsewhere.length) { empty.kind = 'alias'; empty.echo = shortOf[elsewhere[0]] || elsewhere[0]; }
            return empty.echo || empty.flow ? empty : null;
          }
          if (mark) return { text: '', kind: '', state: 'scheduled', time_off: mark };
          if (isPerson && elsewhere.length) return { text: '', kind: 'alias', state: 'scheduled', echo: shortOf[elsewhere[0]] || elsewhere[0] };
          return null;
        }
        var cls = schedClassify_(c.text);
        var cell = { text: c.text, kind: cls ? cls.kind : '', state: c.state || 'scheduled' };
        if (cls && cls.start !== null) { cell.start = cls.start; cell.end = cls.end; cell.hours = cls.hours; }
        // a request waiting on the shift is drawn before the flow that last wrote it
        var flow = flowAt[h.code + '|' + r.row_id + '|' + d] || (c.flow_id && flowById[c.flow_id]);
        if (flow) cell.flow = flow;
        if (c.state === 'called_off' || (cls && cls.kind === 'ro' && cls.code === 'C/O')) cell.private = true;
        if (c.state === 'time_off') cell.time_off_state = true;
        if (mark) cell.time_off = mark;
        if (cls && cls.start !== null && isPerson && !SCHED_OFF_STATES[c.state]) {
          total += cls.hours;
          // a trainee works the shift beside the DSP: their own hours, never the day's coverage
          if (c.state !== 'training') {
            days[i].working++;
            days[i].hours = Math.round((days[i].hours + cls.hours) * 100) / 100;
          }
        }
        return cell;
      });
      return {
        row_id: r.row_id, kind: r.row_kind, name: r.name, key: key, designation: r.designation,
        badges: { hm: isPerson && r.designation === '**',
                  lead: isPerson && (r.designation === '***' || !!(key && badges.lead[key])),
                  med: isPerson && key ? (badges.med[key] || 0) : 0 },
        hours: isPerson ? { period: Math.round(total * 100) / 100, by_week: byWeek } : null,
        cells: line
      };
    });
    grids[h.code] = { code: h.code, cols: dates.map(schedCol_), rows: outRows, days: days };
  });

  // [date, start, end, house, 'work' | 'day', private]: the cut drops the sixth, and the house and span of a private one
  var busy = {};
  Object.keys(holds).forEach(function (key) {
    busy[key] = holds[key].filter(function (h) { return Object.prototype.hasOwnProperty.call(col, h.date); })
      .map(function (h) {
        var day = schedDayIndex_(h.date) * 1440;
        return [h.date, h.s - day, h.e - day, h.house_code, h.why === 'overlap' ? 'work' : 'day', h.private ? 1 : 0];
      });
  });

  // whoever can be placed but is on no house's rows yet: every live staff-side account a name names alone
  if (accounts) {
    Object.keys(accounts).forEach(function (k) {
      var list = accounts[k] || [];
      if (people[k] || list.length !== 1) return;
      if (SCHED_STAFF_ROLES.indexOf(schedStr_(list[0].role).toLowerCase()) === -1) return;
      if (typeof hubIsMasterRow_ === 'function' && hubIsMasterRow_(list[0])) return;
      people[k] = { key: k, name: schedStr_(list[0].displayname), has_account: true };
    });
  }

  var recentFlows = flows.filter(function (f) {
    return schedStr_(f.date_to || f.date) >= schedIsoAdd_(period.first, -7) || /^(waiting|outreach|approved_future)/.test(f.state);
  });
  var logBy = {};
  log.slice().sort(function (a, b) { return a.at < b.at ? 1 : (a.at > b.at ? -1 : 0); }).forEach(function (l) {
    if (!l.house_code) return;
    if (!logBy[l.house_code]) logBy[l.house_code] = [];
    if (logBy[l.house_code].length < SCHED_LOG_KEEP) {
      logBy[l.house_code].push({ id: l.id, at: l.at, by_uid: l.by_uid, by_name: l.by_name, house_code: l.house_code,
                                 date: l.date, row_id: l.row_id, was: l.was, now: l.now, via: l.via,
                                 flow_id: l.flow_id, note: l.note, undone_at: l.undone_at });
    }
  });

  var periods = settings.periods;
  var lastP = periods[periods.length - 1];
  return {
    period: { id: period.id, first: period.first, last: period.last, state: period.state },
    periods: periods.map(function (p) { return { id: p.id, first: p.first, last: p.last, state: p.state }; }),
    houses: houses.map(function (h) { return { code: h.code, location: h.location, short: h.short || h.code }; }),
    managers: managers, hm_keys: hmKeys,
    settings: {
      min_days_ahead: settings.min_days_ahead, outreach_wait_min: settings.outreach_wait_min,
      cycle_days: settings.cycle_days, roll_lead_days: settings.roll_lead_days,
      directors: settings.directors.map(function (d) { return d.name; }),
      directors_readable: settings.directors_readable,
      next_roll_on: lastP ? schedIsoAdd_(lastP.last, -settings.roll_lead_days) : ''
    },
    grids: grids, busy: busy,
    people: Object.keys(people).sort().map(function (k) { return people[k]; }),
    flows: recentFlows.map(function (f) {
      var o = schedFlowOut_(f, true);
      o.person_key = f.person_key; o.person_uid = f.person_uid; o.replacement_key = f.replacement_key;
      o.replacement_uid = f.replacement_uid;
      return o;
    }),
    waiting: inbox.filter(function (i) { return i.box === 'work' && i.state === 'waiting'; }).map(function (i) {
      return { id: i.id, flow_id: i.flow_id, kind: i.kind, seat: i.seat, to_uid: i.to_uid, title: i.title, body: i.body,
               house_code: i.house_code, house_label: i.house_label, date: i.date, shift_text: i.shift_text,
               link: i.link, test_mode: i.test_mode, created_at: i.created_at };
    }),
    log: logBy,
    badges_why: badges.why
  };
}

/** The accounts and badges a base is built from, as a stamp: a change there is a new key, never a stale board. */
function schedOutsideStamp_() {
  var parts = [];
  var acc = schedAccounts_();
  if (!acc) parts.push('accounts unreadable');
  else Object.keys(acc).sort().forEach(function (k) {
    parts.push(k + '=' + (acc[k] || []).map(function (u) {
      return [u.userid, u.email, u.displayname, u.role].map(schedStr_).join('|');
    }).join(','));
  });
  var b = schedBadgeFacts_();
  parts.push(JSON.stringify(b.med), JSON.stringify(b.lead), b.why);
  try { return schedFlowHex_(parts.join('\n')).slice(0, 16); } catch (e) { return ''; }
}

/** The base's cache key, '' when the cache cannot be trusted with it. */
function schedBoardKey_(period) {
  var v = schedVersion_();
  var s = v ? schedOutsideStamp_() : '';
  return v && s ? 'sched_board:' + v + ':' + s + ':' + period.id : '';
}

function schedBoardBase_(period) {
  var base = schedBoardKey_(period);
  var memo = base || 'uncached:' + period.id;
  if (SCHED_BOARD_MEMO[memo]) return SCHED_BOARD_MEMO[memo];
  var got = base ? schedCacheGet_(base) : null;
  if (!got) {
    got = schedBuildBase_(period);
    if (base) schedCachePut_(base, got);
  }
  SCHED_BOARD_MEMO[memo] = got;
  return got;
}

function schedCopy_(v) { return JSON.parse(JSON.stringify(v)); }

/** Editor of a house by the same rows the base was built from: master, a director, or its ** row. */
function schedBaseEditor_(base, ctx, code) {
  if (ctx.is_master || ctx.is_director) return true;
  return !!(ctx.key && ((base.hm_keys || {})[code] || []).indexOf(ctx.key) !== -1);
}

/** The viewer's cut of a cached base: hours, C/O privacy, flows and time off for the privileged, own items. */
function schedCut_(base, ctx, houseCodes, personKeys) {
  var hidden = schedHoursHidden_(ctx);
  var grids = {};
  // the flows the viewer is in: an exchange's mark on the partner's cell is theirs to see
  var inMine = {};
  (base.flows || []).forEach(function (f) {
    if ((ctx.key && (f.person_key === ctx.key || f.replacement_key === ctx.key)) ||
        (ctx.uid && (f.person_uid === ctx.uid || f.replacement_uid === ctx.uid))) inMine[f.id] = true;
  });
  Object.keys(base.grids).forEach(function (code) {
    if (houseCodes && houseCodes.indexOf(code) === -1) return;
    var g = schedCopy_(base.grids[code]);
    var privileged = schedBaseEditor_(base, ctx, code);
    g.rows.forEach(function (r) {
      r.me = !!(ctx.key && r.kind === 'person' && r.key === ctx.key);
      var own = privileged || r.me;
      if (hidden) delete r.hours;
      else if (!r.hours) delete r.hours;
      r.cells = r.cells.map(function (c) {
        if (!c) return null;
        if (c.private && !own) return null;
        // time off reads as the R/O it is written as, never as time off, to anyone it is not theirs to know
        if (c.time_off_state && !own) c.state = 'scheduled';
        delete c.private;
        delete c.time_off_state;
        delete c.flow_id;
        if (!own) {
          if (!(c.flow && c.flow.kind === 'swap' && inMine[c.flow.id])) delete c.flow;
          delete c.time_off;
        }
        if (hidden) delete c.hours;
        if (!c.text && !c.echo && !c.time_off && !c.flow) return null;
        return c;
      });
    });
    if (hidden) g.days.forEach(function (d) { delete d.hours; });
    grids[code] = g;
  });
  // a call-off or time off of somebody else's is only "not free that day", nowhere and without a span
  var busy = {};
  Object.keys(base.busy).forEach(function (k) {
    if (personKeys && personKeys.indexOf(k) === -1) return;
    busy[k] = base.busy[k].map(function (b) {
      var sees = !b[5] || (ctx.key && k === ctx.key) || ctx.is_master || ctx.is_director ||
                 (b[3] && schedBaseEditor_(base, ctx, b[3]));
      return sees ? [b[0], b[1], b[2], b[3], b[4] || 'work'] : [b[0], 0, 1440, '', 'day'];
    });
  });
  var mine = base.flows.filter(function (f) {
    return (ctx.key && (f.person_key === ctx.key || f.replacement_key === ctx.key)) ||
           (ctx.uid && (f.person_uid === ctx.uid || f.replacement_uid === ctx.uid));
  }).map(function (f) {
    var o = schedCopy_(f);
    var subject = (ctx.key && f.person_key === ctx.key) || (ctx.uid && f.person_uid === ctx.uid);
    if (!subject) delete o.reason;
    delete o.person_key; delete o.person_uid; delete o.replacement_key; delete o.replacement_uid;
    return o;
  });
  var waitRows = [];
  if (ctx.uid) {
    var held = {};
    base.waiting.forEach(function (i) { if (i.to_uid === ctx.uid) { waitRows.push(i); held[i.flow_id] = true; } });
    // the master stands in on every director seat: one item per request, never the master's own
    if (ctx.is_master) {
      base.flows.forEach(function (f) { if (f.person_uid && f.person_uid === ctx.uid) held[f.id] = true; });
      base.waiting.forEach(function (i) {
        if (i.seat !== 'director' || held[i.flow_id]) return;
        held[i.flow_id] = true;
        waitRows.push(i);
      });
    }
  }
  var waiting = waitRows.map(function (i) {
    var o = schedCopy_(i);
    delete o.to_uid;
    return o;
  });
  // the history of the houses drawn, for whoever edits them
  var log = {}, logged = false;
  Object.keys(grids).forEach(function (code) {
    if (!schedBaseEditor_(base, ctx, code)) return;
    log[code] = (base.log || {})[code] || [];
    logged = true;
  });
  return { grids: grids, busy: busy, mine: mine, waiting_on_me: waiting, hidden: hidden, log: logged ? log : null };
}

/** What every write answers with: the named houses and people, cut for this viewer (and their history, to editors). */
function schedBoardPart_(ctx, periodId, houseCodes, personKeys) {
  var period = (periodId && schedPeriodById_(periodId)) || schedCurrentPeriod_();
  var cut = schedCut_(schedBoardBase_(period), ctx, houseCodes || null, personKeys || null);
  var part = { grids: cut.grids, busy: cut.busy, mine: cut.mine, waiting_on_me: cut.waiting_on_me };
  if (cut.log) part.log = cut.log;
  return part;
}

function schedBoard_(ctx, period) {
  var base = schedBoardBase_(period);
  var cut = schedCut_(base, ctx, null, null);
  var editorOf = base.houses.filter(function (h) { return schedBaseEditor_(base, ctx, h.code); })
    .map(function (h) { return h.code; });
  var today = schedToday_();
  var houses = base.houses.map(function (h) {
    var g = cut.grids[h.code];
    var staff = 0, open = 0;
    (g ? g.rows : []).forEach(function (r) {
      if (r.kind === 'person') staff++;
      if (r.kind !== 'open') return;
      r.cells.forEach(function (c, i) {
        if (c && c.state === 'open' && c.start !== undefined && g.cols[i].iso >= today) open++;
      });
    });
    return { code: h.code, location: h.location, short: h.short, staff: staff, managers: base.managers[h.code] || [],
             open: open };
  });
  var display = { hidden: { hours: cut.hidden } };
  // the master's muted line: the switch as everyone else reads it (unreadable reads as hidden)
  if (ctx.is_master) display.hidden_from_others = { hours: schedHoursHidden_(null) };
  var out = {
    ok: true, now: schedNow_(), today: today, period: base.period, periods: base.periods, houses: houses,
    viewer: { uid: ctx.uid, name: ctx.name, key: ctx.key, is_master: ctx.is_master, is_director: ctx.is_director,
              editor_of: editorOf, can_edit_any: !!(ctx.is_master || ctx.is_director) },
    test_mode: schedTestMode_(), display: display, settings: base.settings,
    grids: cut.grids, busy: cut.busy, people: base.people, mine: cut.mine, waiting_on_me: cut.waiting_on_me
  };
  if (editorOf.length) {
    out.log = {};
    editorOf.forEach(function (code) { out.log[code] = base.log[code] || []; });
  }
  return out;
}

// The write answer every Scheduling write gives (SchedulingFlows.gs schedFlowWriteAnswer_ gives the same): { ok…
function schedAnswer_(ctx, said, periodId, houseCodes, personKeys, extra) {
  var part = schedBoardPart_(ctx, periodId, houseCodes, personKeys);
  var out = { ok: true, said: said, period_id: periodId, grids: part.grids, busy: part.busy, mine: part.mine,
              waiting_on_me: part.waiting_on_me, test_mode: schedTestMode_() };
  if (part.log) out.log = part.log;
  for (var k in (extra || {})) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
  return { status: 200, data: out };
}

// A locked write's answer, built after the lock is let go (the board is read back without holding everyone else up).
function schedAnswerAfter_(ctx, done) {
  if (!done || done.status) return done || schedRefuse_(503, 'The calendar did not answer just now — try again.');
  try {
    return schedAnswer_(ctx, done.said, done.period, done.houses, done.keys, done.extra);
  } catch (e) {
    var data = { ok: true, said: done.said, period_id: done.period, grids: {}, busy: {},
                 reread: 'Saved — but the calendar could not be read back just now; refresh to see it.',
                 test_mode: schedTestMode_() };
    for (var k in (done.extra || {})) if (Object.prototype.hasOwnProperty.call(done.extra, k)) data[k] = done.extra[k];
    return { status: 200, data: data };
  }
}

/** What a locked write hands schedAnswerAfter_. */
function schedDone_(said, periodId, houses, keys, extra) {
  return { said: said, period: periodId, houses: houses, keys: keys, extra: extra || null };
}

function schedUnreadable_(e) {
  return schedRefuse_(503, 'The Scheduling calendar could not be read just now — ' + schedErr_(e));
}

/** Week hours across every house, for the 40-hour warning (it never refuses). */
function schedWeekHours_(personKey, date) {
  var wk = schedWeekKey_(date), sum = 0;
  var personOf = {};
  schedRead_(SCHED_TABS.rows).forEach(function (r) {
    if (r.row_kind === 'person') personOf[r.house_code + '|' + r.row_id] = r.person_key;
  });
  schedRead_(SCHED_TABS.cells).forEach(function (c) {
    if (personOf[c.house_code + '|' + c.row_id] !== personKey || SCHED_OFF_STATES[c.state]) return;
    if (!schedIsoValid_(c.date) || schedWeekKey_(c.date) !== wk) return;
    var cls = schedClassify_(c.text);
    if (cls && cls.start !== null) sum += cls.hours;
  });
  return Math.round(sum * 100) / 100;
}

// ---- actions ----

HUB_POLICY.schedulingBoard = {
  file: 'Scheduling.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { period_id: { type: 'string' } }
};
HUB_ACTIONS.schedulingBoard = function (payload, user) {
  var ctx = schedGate_(user);
  if (!ctx.open) return schedClosed_();
  try {
    var pid = schedStr_(payload && payload.period_id);
    var period = pid ? schedPeriodById_(pid) : schedCurrentPeriod_();
    if (!period) return schedRefuse_(404, 'That calendar period does not exist.');
    return { status: 200, data: schedBoard_(ctx, period) };
  } catch (e) {
    return schedUnreadable_(e);
  }
};

HUB_POLICY.schedulingCellSave = {
  file: 'Scheduling.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: ['smsSend'],
  params: { house: { type: 'string' }, row_id: { type: 'string' }, person: { type: 'string' },
            date: { type: 'string' }, value: { type: 'string' }, start: { type: 'string' },
            end: { type: 'string' }, note: { type: 'string' }, via: { type: 'string' },
            open_row_id: { type: 'string' }, cancel_pending: { type: 'boolean' }, override: { type: 'boolean' } }
};

/** The span a placed value holds: its time, or the time written inside an alias (MED DEL 8A-4P); null = the whole day. */
function schedValueSpan_(cls, value) {
  if (cls && cls.start !== null) return [Math.round(cls.start * 60), Math.round(cls.end * 60)];
  var inside = schedTimeInside_(value);
  return inside ? [Math.round(inside[0] * 60), Math.round(inside[1] * 60)] : null;
}

/** A pattern's base under a cell: a one-off keeps the one it replaced, anything else is its own. */
function schedBaseOf_(cell) {
  if (!cell) return '';
  return SCHED_ONE_OFF_STATES[schedStr_(cell.state)] ? schedStr_(cell.base) : schedStr_(cell.text);
}

/** One row holds one cell a day: somebody already working at this house that day cannot be given a second shift. */
function schedSameHouseBar_(houseCode, name, was) {
  var cls = was && schedStr_(was.text) ? schedClassify_(was.text) : null;
  if (!cls || cls.kind === 'off') return null;
  return schedRefuse_(409, name + ' already has ' + schedStr_(was.text) + ' at ' + schedHouseLabel_(houseCode) +
                           ' that day — a row holds one shift a day.');
}

HUB_ACTIONS.schedulingCellSave = function (payload, user) {
  var ctx = schedGate_(user);
  if (!ctx.open) return schedClosed_();
  payload = payload || {};
  var house = schedStr_(payload.house), date = schedStr_(payload.date), via = schedStr_(payload.via) || 'edit';
  var openRowId = schedStr_(payload.open_row_id);
  if (['add', 'edit', 'delete'].indexOf(via) === -1) return schedRefuse_(400, 'A cell is added, edited or deleted.');
  if (!house || !schedIsoValid_(date)) return schedRefuse_(400, 'Pick a house and a day.');
  if (openRowId && (via !== 'add' || !/^OPEN:\d+$/.test(openRowId))) return schedRefuse_(400, 'Pick the OPEN shift to give.');
  try {
    if (!ctx.editorOf(house)) {
      return schedRefuse_(403, 'Only the house manager, the Scheduling directors and the master edit this calendar.');
    }
    var period = schedPeriodOf_(date);
    if (!period) return schedRefuse_(400, 'That day is not on any calendar period yet.');
    if (!schedHouseList_().some(function (h) { return h.code === house; })) return schedRefuse_(404, 'There is no such house.');
    var value = via === 'delete' ? '' : schedStr_(payload.value);
    if (!openRowId && via !== 'delete' && !value && (schedStr_(payload.start) || schedStr_(payload.end))) {
      var built = schedValueFromTimes_(payload.start, payload.end);
      if (built.error) return schedRefuse_(400, built.error);
      value = built.code;
    }
    if (!openRowId && via !== 'delete' && !value) return schedRefuse_(400, 'Type a shift, or pick its start and end.');
    if (via !== 'delete') schedIstWarm_();
    var cancelled = null, overrode = null;
    var done = schedLock_(function () {
      var held = schedHeld_();
      if (held) return held;
      schedMemoDrop_();
      var rowId = schedStr_(payload.row_id), newRow = null;
      if (!rowId) {
        var who = schedStr_(payload.person);
        var key = schedFold_(who);
        if (!key) return schedRefuse_(400, 'Pick a row or a person.');
        schedRead_(SCHED_TABS.rows).some(function (r) {
          if (r.row_kind !== 'person' || r.person_key !== key) return false;
          who = r.name;
          return true;
        });
        rowId = 'P:' + key;
        var known = schedRowAt_(house, rowId);
        if (!known || known.active === 'no') newRow = schedPersonRow_(house, who, key, known, ctx);
      }
      var row = newRow || schedRowAt_(house, rowId);
      if (!row || row.active === 'no') return schedRefuse_(404, 'That row is not on this house\'s calendar.');
      if (openRowId) {
        var given = schedAssignOpen_(ctx, house, date, openRowId, row, newRow, payload.note, period, payload.override === true);
        if (given && !given.status && given.overrode) overrode = { row: row, against: given.overrode };
        return given;
      }
      // a swap (either side), a Request Off or a training waiting on the cell: answered or cancelled first
      var busy = schedFlowCellBusy_(house, rowId, date);
      if (busy && payload.cancel_pending !== true) return schedRefuse_(409, schedFlowPendingWords_(busy, house, rowId, date));
      var was = schedCellAt_(house, rowId, date);
      // OFF is free: an add over it replaces it
      if (via === 'add' && was && was.text && (schedClassify_(was.text) || {}).kind !== 'off') {
        return schedRefuse_(409, row.name + ' already has ' + was.text + ' that day — edit it instead.');
      }
      var cls = schedClassify_(value);
      var warn = '';
      if (value && row.row_kind === 'person' && cls && cls.kind !== 'off' && cls.kind !== 'ro') {
        var span = schedValueSpan_(cls, value);
        var clash = schedClash_(row.person_key, date, span ? span[0] : null, span ? span[1] : null,
                                { ignore_cell_ids: was ? [was.id] : [], house_code: house, value: value });
        if (clash) return schedRefuse_(409, schedClashSentence_(row.name, clash, ctx, row.person_key));
      }
      // a new shift for somebody (not new hours on one they already work) is read against their Staff Preferences
      var crossed = null;
      var wasCls = was && schedStr_(was.text) ? schedClassify_(was.text) : null;
      if (value && row.row_kind === 'person' && cls && cls.start !== null && !(wasCls && wasCls.start !== null)) {
        crossed = schedPrefsAgainst_(row.person_key, row.name, house, date);
        if (crossed && payload.override !== true) return schedPrefsRefusal_(crossed);
      }
      // a cancelled training's cell is written as the plain shift under it: the edit is the editor's own placement
      var under = busy && was && schedStr_(was.state) === 'training' && schedStr_(was.flow_id) === schedStr_(busy.id)
        ? { id: was.id, text: schedStr_(was.base), state: '', base: '', flow_id: '' } : was;
      var placed = schedEditorPlace_(ctx, house, row, date, value, under, via,
                                     crossed ? schedPrefsNote_(payload.note) : payload.note, newRow);
      if (placed.status) return placed;
      if (crossed) overrode = { row: row, against: crossed };
      if (busy) {
        cancelled = { id: busy.id, what: schedFlowPendingWhat_(busy, house, rowId, date) };
        schedFlowCancelPending_(busy, ctx, house, rowId, date);
      }
      var cell = placed.cell;
      if (cell && row.row_kind === 'person' && cls && cls.start !== null && !schedHoursHidden_(ctx)) {
        var wk = schedWeekHours_(row.person_key, date);
        if (wk > 40) warn = row.name + ' now has ' + wk + ' hours in the week of ' + schedDayWords_(schedWeekKey_(date)) + '.';
      }
      var said = via === 'delete' ? 'Removed ' + (was ? was.text : 'the shift') + ' from ' + row.name + ' on ' + schedDayWords_(date) + '.'
        : 'Saved ' + value + ' for ' + row.name + ' on ' + schedDayWords_(date) + '.';
      var extra = warn ? { warn: warn } : {};
      if (cancelled) said += ' The pending ' + cancelled.what + ' was cancelled; whoever asked is told.';
      if (placed.training) {
        said += ' ' + schedTrainingWords_(row.name, house, placed.training.why);
        extra.training = placed.training;
      }
      return schedDone_(said, period.id, [house], row.person_key ? [row.person_key] : [], extra);
    });
    // the cancelled flow's texts are said after the lock, as every flow's are
    if (cancelled && done && !done.status) schedFlowKick_([cancelled.id]);
    if (overrode && done && !done.status) {
      schedPrefsOverrideLog_(user, 'schedulingCellSave', house, date, overrode.row.person_key, overrode.against);
    }
    return schedAnswerAfter_(ctx, done);
  } catch (e) {
    return schedUnreadable_(e);
  }
};

// An editor gives an OPEN shift to somebody, in one write under the lock.
function schedAssignOpen_(ctx, house, date, openRowId, row, newRow, note, period, override) {
  if (row.row_kind !== 'person') return schedRefuse_(400, 'An OPEN shift is given to a person.');
  var open = schedCellAt_(house, openRowId, date);
  if (!open || schedStr_(open.state) !== 'open' || !schedStr_(open.text)) {
    return schedRefuse_(409, 'That OPEN shift is not open any more — somebody took it a moment ago.');
  }
  var text = schedStr_(open.text);
  var was = schedCellAt_(house, row.row_id, date);
  var bar = schedSameHouseBar_(house, row.name, was);
  if (bar) return bar;
  var cls = schedClassify_(text);
  var span = schedValueSpan_(cls, text);
  var clash = schedClash_(row.person_key, date, span ? span[0] : null, span ? span[1] : null,
                          { ignore_cell_ids: was ? [was.id] : [], house_code: house, value: text });
  if (clash) return schedRefuse_(409, schedClashSentence_(row.name, clash, ctx, row.person_key));
  var crossed = cls && cls.start !== null ? schedPrefsAgainst_(row.person_key, row.name, house, date) : null;
  if (crossed && !override) return schedPrefsRefusal_(crossed);
  if (crossed) note = schedPrefsNote_(note);
  // somebody new to the house without its IST is given it as a training (asked before anything is written)
  var need = cls && cls.start !== null ? schedTrainingNeed_(house, row.person_key) : null;
  var plan = null, person = null;
  if (need) {
    var u = schedUserByKey_(row.person_key);
    person = { name: row.name, key: row.person_key, uid: u ? u.uid : '' };
    plan = schedTrainingPlan_(house, person, schedSettings_());
    if (plan.status) return plan;
  }
  if (newRow) schedUpsert_(SCHED_TABS.rows, [newRow]);
  var flowId = schedStr_(open.flow_id);
  var why = 'Assigned from ' + (schedOpenN_(openRowId) > 1 ? 'OPEN ' + schedOpenN_(openRowId) : 'OPEN') +
            (schedStr_(note) ? ' — ' + schedStr_(note) : '');
  var tid = need ? schedFlowNewId_('SF', house + '|' + row.row_id + '|' + date + '|training') : '';
  var placed;
  if (tid) {
    placed = schedSetCell_(house, row.row_id, date, { text: text, state: 'training', base: schedBaseOf_(was), flow_id: tid,
                                                     source: 'flow:' + tid }, 'add', ctx, why, tid);
  } else if (flowId) {
    placed = schedSetCell_(house, row.row_id, date, { text: text, state: 'taken', base: schedBaseOf_(was), flow_id: flowId,
                                                     source: 'flow:' + flowId }, 'add', ctx, why, flowId);
  } else {
    placed = schedSetCell_(house, row.row_id, date, { text: text, source: 'app' }, 'add', ctx, why, '');
  }
  // a call-off's OPEN cell goes; one that keeps a pattern's base keeps it for the roll
  if (flowId && schedStr_(open.base)) {
    schedSetCell_(house, openRowId, date, { text: '', state: 'taken', base: schedStr_(open.base), flow_id: '',
                                            source: 'app' }, 'delete', ctx, 'Assigned to ' + row.name, flowId);
  } else {
    schedSetCell_(house, openRowId, date, { text: '' }, 'delete', ctx, 'Assigned to ' + row.name, flowId);
  }
  if (flowId && typeof schedFlowCoveredBy_ === 'function') schedFlowCoveredBy_(flowId, ctx.name);
  var said = 'Gave ' + text + ' on ' + schedDayWords_(date) + ' to ' + row.name + '.';
  var extra = null;
  if (tid) {
    // a genuinely open shift given is the editor's pattern; one a call-off opened stays a one-off
    schedTrainingOpen_({ id: tid, house: house, date: date, cell: placed, person: person, ist: need,
                         source: flowId ? 'assign' : 'editor', source_ref: flowId, ctx: ctx, plan: plan });
    said += ' ' + schedTrainingWords_(row.name, house, need.why);
    extra = { training: { flow_id: tid, why: need.why } };
  }
  var done = schedDone_(said, period.id, [house], row.person_key ? [row.person_key] : [], extra);
  if (crossed) done.overrode = crossed;
  return done;
}

/** The sentence a write adds when it placed somebody as a training. */
function schedTrainingWords_(name, house, why) {
  return name + ' works it as a training with the house manager, not as the DSP (' + why + '): the house manager and ' +
         'a director approve it in My Work; a decline takes ' + name + ' off and opens the shift.';
}

function schedPersonRow_(house, name, key, known, ctx) {
  var rows = schedRead_(SCHED_TABS.rows).filter(function (r) { return r.house_code === house; });
  var maxOrder = 0;
  rows.forEach(function (r) { if (r.row_kind === 'person') maxOrder = Math.max(maxOrder, parseFloat(r.order) || 0); });
  var loc = '';
  schedHouseList_().forEach(function (h) { if (h.code === house) loc = h.location; });
  var rec = known ? schedCopy_(known) : {
    id: schedRowId_(house, 'P:' + key), house_code: house, location: loc, row_id: 'P:' + key, row_kind: 'person',
    name: schedStr_(name), person_key: key, designation: '', order: String(maxOrder + 1), source: 'app'
  };
  rec.active = 'yes';
  rec.updated_at = schedNow_();
  rec.updated_by = ctx ? ctx.uid : 'system';
  return rec;
}

HUB_POLICY.schedulingAddPerson = {
  file: 'Scheduling.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, person: { type: 'string' }, override: { type: 'boolean' } }
};
HUB_ACTIONS.schedulingAddPerson = function (payload, user) {
  var ctx = schedGate_(user);
  if (!ctx.open) return schedClosed_();
  var house = schedStr_(payload && payload.house), name = schedStr_(payload && payload.person);
  var key = schedFold_(name);
  if (!house || !key) return schedRefuse_(400, 'Pick a house and a person.');
  if (schedRowKindOf_(name) !== 'person') return schedRefuse_(400, 'An OPEN or WORKSHOP row is not a person.');
  try {
    if (!ctx.editorOf(house)) {
      return schedRefuse_(403, 'Only the house manager, the Scheduling directors and the master edit this calendar.');
    }
    if (!schedHouseList_().some(function (h) { return h.code === house; })) return schedRefuse_(404, 'There is no such house.');
    var crossed = null;
    var done = schedLock_(function () {
      var held = schedHeld_();
      if (held) return held;
      schedMemoDrop_();
      var known = schedRowAt_(house, 'P:' + key);
      if (known && known.active !== 'no') return schedRefuse_(409, known.name + ' is already on ' + schedHouseLabel_(house) + '.');
      crossed = schedPrefsAgainst_(key, (known && known.name) || name, house, '');
      if (crossed && payload.override !== true) return schedPrefsRefusal_(crossed);
      var rec = schedPersonRow_(house, name, key, known, ctx);
      schedUpsert_(SCHED_TABS.rows, [rec]);
      schedAppend_(SCHED_TABS.log, [schedLogRow_(ctx, house, '', rec.row_id, '', rec.name, 'add_person', '',
                                                 crossed ? SCHED_PREFS_OVERRIDE_NOTE : '')]);
      return schedDone_(rec.name + ' is on ' + schedHouseLabel_(house) + '.', schedCurrentPeriod_().id, [house], [key]);
    });
    if (crossed && done && !done.status) schedPrefsOverrideLog_(user, 'schedulingAddPerson', house, '', key, crossed);
    return schedAnswerAfter_(ctx, done);
  } catch (e) {
    return schedUnreadable_(e);
  }
};

HUB_POLICY.schedulingUndo = {
  file: 'Scheduling.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' } }
};
HUB_ACTIONS.schedulingUndo = function (payload, user) {
  var ctx = schedGate_(user);
  if (!ctx.open) return schedClosed_();
  var house = schedStr_(payload && payload.house);
  if (!house) return schedRefuse_(400, 'Pick a house.');
  try {
    if (!ctx.editorOf(house)) {
      return schedRefuse_(403, 'Only the house manager, the Scheduling directors and the master edit this calendar.');
    }
    schedIstWarm_();
    var trained = null;
    var done = schedLock_(function () {
      var held = schedHeld_();
      if (held) return held;
      schedMemoDrop_();
      var mine = schedRead_(SCHED_TABS.log).filter(function (l) {
        return l.house_code === house && l.by_uid === ctx.uid && !l.undone_at &&
               ['add', 'edit', 'delete', 'add_person'].indexOf(l.via) !== -1;
      }).sort(function (a, b) { return a.at < b.at ? 1 : (a.at > b.at ? -1 : 0); });
      if (!mine.length) return schedRefuse_(404, 'Nothing of yours to undo on ' + schedHouseLabel_(house) + '.');
      var act = mine[0];
      var row = schedRowAt_(house, act.row_id);
      var keys = row && row.person_key ? [row.person_key] : [];
      var periodId = schedCurrentPeriod_().id;
      if (act.via === 'add_person') {
        if (row) {
          var off = schedCopy_(row);
          off.active = 'no'; off.updated_at = schedNow_(); off.updated_by = ctx.uid;
          schedUpsert_(SCHED_TABS.rows, [off]);
        }
      } else {
        if (!row) return schedRefuse_(404, 'That row is no longer on this house\'s calendar.');
        var busy = schedFlowCellBusy_(house, act.row_id, act.date);
        if (busy) return schedRefuse_(409, schedFlowPendingWords_(busy, house, act.row_id, act.date));
        var cur = schedCellAt_(house, act.row_id, act.date);
        if (schedStr_(cur && cur.text) !== schedStr_(act.now)) {
          return schedRefuse_(409, 'That cell changed since — undo would overwrite ' + (schedStr_(cur && cur.text) || 'an empty cell') + '.');
        }
        var back = schedStr_(act.was), cls = schedClassify_(back);
        if (back && row.row_kind === 'person' && cls && cls.kind !== 'off' && cls.kind !== 'ro') {
          var span = schedValueSpan_(cls, back);
          var clash = schedClash_(row.person_key, act.date, span ? span[0] : null, span ? span[1] : null,
                                  { ignore_cell_ids: cur ? [cur.id] : [], house_code: house, value: back });
          if (clash) return schedRefuse_(409, schedClashSentence_(row.name, clash, ctx, row.person_key));
        }
        var placed = schedEditorPlace_(ctx, house, row, act.date, back, cur, 'undo', 'undo of ' + act.id, null);
        if (placed.status) return placed;
        if (placed.training) trained = placed.training;
        var p = schedPeriodOf_(act.date);
        if (p) periodId = p.id;
      }
      var stamped = schedCopy_(act);
      stamped.undone_at = schedNow_();
      schedUpsert_(SCHED_TABS.log, [stamped]);
      var said = 'Undone: ' + (act.via === 'add_person' ? (row ? row.name : 'the person') + ' is off the house again'
        : (schedStr_(act.was) || 'an empty cell') + ' is back') + '.';
      if (trained) said += ' ' + schedTrainingWords_(row.name, house, trained.why);
      return schedDone_(said, periodId, [house], keys, trained ? { training: trained } : null);
    });
    return schedAnswerAfter_(ctx, done);
  } catch (e) {
    return schedUnreadable_(e);
  }
};

var SCHED_SETTABLE = {
  directors: function (v) {
    var list = schedStr_(v).split(/[,;\s]+/).filter(function (s) { return s; });
    if (!list.length || list.some(function (s) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); })) {
      return { error: 'Directors are e-mail addresses, separated by commas.' };
    }
    return { value: list.map(function (s) { return s.toLowerCase(); }).join(', ') };
  },
  cycle_days: function (v) {
    var n = schedIntOf_(v, -1);
    return n >= 7 && n <= 84 && n % 7 === 0 ? { value: String(n) } : { error: 'The cycle is 7 to 84 days, in whole weeks.' };
  },
  roll_lead_days: function (v) {
    var n = schedIntOf_(v, -1);
    return n >= 1 && n <= 28 ? { value: String(n) } : { error: 'The roll runs 1 to 28 days before a period ends.' };
  },
  outreach_wait_min: function (v) {
    var n = schedIntOf_(v, -1);
    return n >= 5 && n <= 10 ? { value: String(n) } : { error: 'The outreach waits 5 to 10 minutes.' };
  },
  min_days_ahead: function (v) {
    var n = schedIntOf_(v, -1);
    return n >= 0 && n <= 60 ? { value: String(n) } : { error: 'Requests are 0 to 60 days ahead.' };
  }
};

function schedSettingsPublic_() {
  var s = schedSettings_();
  return { readable: s.readable, why: s.why, directors: s.directors.map(function (d) { return { email: d.email, name: d.name }; }),
           directors_readable: s.directors_readable, directors_why: s.directors_why, cycle_days: s.cycle_days,
           roll_lead_days: s.roll_lead_days, outreach_wait_min: s.outreach_wait_min, min_days_ahead: s.min_days_ahead,
           periods: s.periods, houses: s.houses.map(function (h) { return { code: h.code, location: h.location, short: h.short }; }),
           seeded_at: s.seeded_at };
}

HUB_POLICY.schedulingSettingsSet = {
  file: 'Scheduling.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { values: { type: 'object' } }
};
HUB_ACTIONS.schedulingSettingsSet = function (payload, user) {
  var ctx = schedGate_(user);
  if (!ctx.open) return schedClosed_();
  if (!ctx.is_master) return schedRefuse_(403, 'Only the master changes the Scheduling settings.');
  var values = (payload && payload.values) || {};
  var rows = [], bad = [];
  Object.keys(values).forEach(function (k) {
    if (!SCHED_SETTABLE[k]) { bad.push(k + ' is not a setting this screen changes.'); return; }
    var got = SCHED_SETTABLE[k](values[k]);
    if (got.error) bad.push(got.error);
    else rows.push({ key: k, value: got.value, note: '', updated_at: schedNow_(), updated_by: ctx.uid });
  });
  if (bad.length) return schedRefuse_(400, bad.join(' '));
  if (!rows.length) return schedRefuse_(400, 'Nothing to change.');
  try {
    return schedLock_(function () {
      var held = schedHeld_();
      if (held) return held;
      schedMemoDrop_();
      schedUpsert_(SCHED_TABS.settings, rows);
      schedMemoDrop_();
      return { status: 200, data: { ok: true, said: 'Saved.', settings: schedSettingsPublic_() } };
    });
  } catch (e) {
    return schedUnreadable_(e);
  }
};

// ---- the seed: the 17 per-house books, copied once ----

var SCHED_BOOK_LABEL = /^CAN\s*-\s*(.+?)\s*-\s*([A-Z]+\d+)$/;

/** The houses' own books, from the Dashboard index (Recon.gs): [{ label, id, code, short }]. */
function schedSeedLinks_() {
  var out = [];
  (reconCalendarLinks_() || []).forEach(function (l) {
    var m = SCHED_BOOK_LABEL.exec(schedStr_(l.label));
    if (m) out.push({ label: schedStr_(l.label), id: l.id, code: m[2], short: m[1].trim() });
  });
  return out;
}

function schedWeekdayWord_(text) {
  var up = schedStr_(text).toUpperCase().slice(0, 3);
  return SCHED_WEEKDAYS.indexOf(up) !== -1 ? up : '';
}

// One book's CALENDAR tab, read: the STAFF header row, the real dates under it (getValues) and the cells as shown…
function schedSeedParse_(link, values, display, colors, dateIso, first, last) {
  var out = { code: link.code, short: link.short, location: link.label, book_id: link.id, rows: [], cells: [],
              header_row: -1, dates: [], in_period: 0, weekday_mismatch: [], duplicates: [], why: '' };
  for (var r = 0; r < Math.min(12, values.length); r++) {
    for (var c = 0; c < Math.min(4, (values[r] || []).length); c++) {
      if (schedStr_(display[r][c]).toUpperCase() === 'STAFF') { out.header_row = r; break; }
    }
    if (out.header_row !== -1) break;
  }
  if (out.header_row === -1) { out.why = 'no STAFF header in the first rows'; return out; }
  var hr = out.header_row;
  var cols = [];
  for (var c2 = 2; c2 < values[hr].length; c2++) {
    var iso = dateIso(values[hr][c2]);
    if (!iso) continue;
    out.dates.push(iso);
    var label = hr > 0 ? schedWeekdayWord_(display[hr - 1][c2]) : '';
    if (label && label !== SCHED_WEEKDAYS[schedDow_(iso)]) out.weekday_mismatch.push({ iso: iso, label: label });
    if (iso >= first && iso <= last) cols.push({ c: c2, iso: iso });
  }
  out.in_period = cols.length;
  var seen = {}, openN = 0, order = 0, slugSeen = {};
  for (var r2 = hr + 1; r2 < values.length; r2++) {
    var name = schedStr_(display[r2][1]);
    if (!name) continue;
    var kind = schedRowKindOf_(name);
    var rowId;
    if (kind === 'open') rowId = 'OPEN:' + (++openN);
    else if (kind === 'person') {
      var key = schedFold_(name);
      if (!key) continue;
      rowId = 'P:' + key;
      if (seen[rowId]) {
        var filled = cols.filter(function (x) { return schedStr_(display[r2][x.c]); }).length;
        out.duplicates.push({ name: name, sheet_row: r2 + 1, cells: filled });
        continue;
      }
    } else {
      var slug = schedSlug_(name) || 'row';
      slugSeen[slug] = (slugSeen[slug] || 0) + 1;
      rowId = 'X:' + slug + (slugSeen[slug] > 1 ? '-' + slugSeen[slug] : '');
    }
    seen[rowId] = true;
    order++;
    var desig = schedStr_(display[r2][0]);
    out.rows.push({ row_id: rowId, row_kind: kind, name: name, person_key: kind === 'person' ? schedFold_(name) : '',
                    designation: kind === 'person' && /^\*{1,3}$/.test(desig) ? desig : '', order: order });
    cols.forEach(function (x) {
      var text = schedStr_(display[r2][x.c]);
      if (!text) return;
      var bg = colors && colors[r2] ? schedStr_(colors[r2][x.c]).toLowerCase() : '';
      out.cells.push({ row_id: rowId, row_kind: kind, name: name, date: x.iso, text: text,
                       color: bg && bg !== '#ffffff' ? bg : '' });
    });
  }
  return out;
}

/** Every parsed book → the rows and cells to store, and the report of what was not guessed. Pure. */
function schedSeedPlan_(books, first, last, now) {
  var tokens = {};
  books.forEach(function (b) {
    [b.code, b.short, b.location].forEach(function (t) {
      var up = schedStr_(t).toUpperCase();
      if (up) { tokens[up] = b.code; tokens[up.replace(/\s+/g, '')] = b.code; }
    });
  });
  var timed = {};
  books.forEach(function (b) {
    b.cells.forEach(function (c) {
      if (c.row_kind !== 'person') return;
      var cls = schedClassify_(c.text);
      if (!cls || cls.start === null) return;
      timed[b.code + '|' + schedFold_(c.name) + '|' + c.date] = [cls.start, cls.end];
    });
  });
  var report = { first: first, last: last, at: now, houses: [], weekday_mismatch: [], stale_tabs: [],
                 duplicate_names: [], multi_range_cells: [], alias_with_time: [], unbacked_echoes: [],
                 timed_echoes: [], not_a_house_aliases: 0, echoes_skipped: 0, unreadable_books: [], no_header: [] };
  var rows = [], cells = [];
  var list = function (name, item) { if (report[name].length < SCHED_REPORT_LIST) report[name].push(item); };
  books.forEach(function (b) {
    if (b.unreadable) { report.unreadable_books.push({ code: b.code, label: b.location, why: b.why }); return; }
    if (b.header_row === -1) { report.no_header.push({ code: b.code, why: b.why }); return; }
    var stored = 0;
    if (b.weekday_mismatch.length) {
      report.weekday_mismatch.push({ code: b.code, count: b.weekday_mismatch.length, first: b.weekday_mismatch[0] });
    }
    if (!b.in_period) {
      report.stale_tabs.push({ code: b.code, first: b.dates.length ? b.dates.slice().sort()[0] : '',
                               last: b.dates.length ? b.dates.slice().sort()[b.dates.length - 1] : '' });
    }
    b.duplicates.forEach(function (d) { list('duplicate_names', { code: b.code, name: d.name, sheet_row: d.sheet_row, cells: d.cells }); });
    b.rows.forEach(function (r) {
      rows.push({ id: schedRowId_(b.code, r.row_id), house_code: b.code, location: b.location, row_id: r.row_id,
                  row_kind: r.row_kind, name: r.name, person_key: r.person_key, designation: r.designation,
                  order: String(r.order), active: 'yes', source: 'seed:' + b.book_id, updated_at: now, updated_by: 'seed' });
    });
    b.cells.forEach(function (c) {
      var cls = schedClassify_(c.text);
      var where = { code: b.code, name: c.name, date: c.date, text: c.text };
      if (schedRangeCount_(c.text) > 1) list('multi_range_cells', where);
      if (cls.kind === 'alias') {
        var named = schedNamesHouse_(c.text, tokens);
        if (named && named !== b.code) {
          var links = String(c.text).replace(/^\*+/, '').split(SCHED_CHAIN);
          var backed = links.some(function (l) {
            var code = tokens[l.trim().toUpperCase()] || tokens[l.trim().toUpperCase().replace(/\s+/g, '')];
            return code && timed[code + '|' + schedFold_(c.name) + '|' + c.date];
          });
          if (backed && c.row_kind === 'person') { report.echoes_skipped++; return; }
          list('unbacked_echoes', where);
        } else if (!named) {
          report.not_a_house_aliases++;
        }
        if (schedTimeInside_(c.text)) list('alias_with_time', where);
      } else if (cls.start !== null && c.row_kind === 'person') {
        // the same hours written at two houses, each naming the other: which one is worked is not guessed
        var other = schedNamesHouse_(c.text, tokens);
        var there = other && other !== b.code ? timed[other + '|' + schedFold_(c.name) + '|' + c.date] : null;
        if (there && there[0] === cls.start && there[1] === cls.end) {
          list('timed_echoes', { code: b.code, name: c.name, date: c.date, text: c.text, other: other });
        }
      }
      var state = c.row_kind === 'open' && cls.start !== null ? 'open'
        : (cls.kind === 'ro' && cls.code === 'C/O' ? 'called_off' : 'scheduled');
      cells.push({ id: schedCellId_(b.code, c.row_id, c.date), period_id: 'P' + first, house_code: b.code,
                   date: c.date, row_id: c.row_id, text: c.text, kind: cls.kind,
                   start_min: cls.start !== null ? String(Math.round(cls.start * 60)) : '',
                   end_min: cls.end !== null ? String(Math.round(cls.end * 60)) : '',
                   hours: cls.hours.toFixed(2), token: cls.token || '', color: c.color, state: state, base: '',
                   flow_id: '', source: 'seed:' + b.book_id, note: '', updated_at: now, updated_by: 'seed' });
      stored++;
    });
    report.houses.push({ code: b.code, short: b.short, book_id: b.book_id, rows: b.rows.length, cells: stored,
                         days_in_period: b.in_period });
  });
  return { rows: rows, cells: cells, report: report,
           houses: books.filter(function (b) { return !b.unreadable; }).map(function (b) {
             return { code: b.code, location: b.location, short: b.short, book_id: b.book_id };
           }) };
}

function schedSeedRead_(link, first, last) {
  try {
    var ss = ssOpen_(link.id);
    var sheet = ss.getSheetByName('CALENDAR') || ss.getSheets()[0];
    var range = sheet.getDataRange();
    var tz = SCHED_TZ;
    try { tz = ss.getSpreadsheetTimeZone() || SCHED_TZ; } catch (eT) { tz = SCHED_TZ; }
    var colors = null;
    try { colors = range.getBackgrounds(); } catch (eB) { colors = null; }
    return schedSeedParse_(link, range.getValues(), range.getDisplayValues(), colors, function (v) {
      return (v instanceof Date && !isNaN(v.getTime())) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : '';
    }, first, last);
  } catch (e) {
    return { code: link.code, short: link.short, location: link.label, book_id: link.id, unreadable: true,
             why: schedErr_(e), rows: [], cells: [], dates: [], duplicates: [], weekday_mismatch: [] };
  }
}

function schedSeed_(ctx, first, last, dry, readBook) {
  var links = schedSeedLinks_();
  if (!links.length) return schedRefuse_(503, 'The Dashboard index listed no house book (CAN - XX - CODE).');
  var now = schedNow_();
  var books = links.map(function (l) { return (readBook || schedSeedRead_)(l, first, last); });
  var plan = schedSeedPlan_(books, first, last, now);
  var summary = { houses: plan.houses.length, rows: plan.rows.length, cells: plan.cells.length };
  if (dry) return { status: 200, data: { ok: true, dry_run: true, said: 'Dry run: nothing was written.', report: plan.report, counts: summary } };
  var settings = schedSettings_();
  if (!settings.readable) return schedRefuse_(503, 'The Scheduling settings could not be read: ' + settings.why);
  if (settings.seeded_at) return schedRefuse_(409, 'The calendars were already copied (' + settings.seeded_at + ') — the seed runs once.');
  var held = schedHeld_();
  if (held) return held;
  schedUpsert_(SCHED_TABS.rows, plan.rows);
  schedUpsert_(SCHED_TABS.cells, plan.cells);
  schedAppend_(SCHED_TABS.log, plan.houses.map(function (h) {
    return schedLogRow_(ctx, h.code, first, '', '', 'seeded ' + first + '..' + last, 'seed', '', h.book_id);
  }));
  var report = JSON.stringify(plan.report);
  if (report.length > 45000) report = report.slice(0, 45000);
  var period = { id: 'P' + first, first: first, last: last, state: 'live', rolled_from: '', rolled_at: '', by: ctx ? ctx.uid : '' };
  var kv = settings.raw || {};
  var srows = [
    { key: 'periods', value: JSON.stringify([period]) },
    { key: 'houses', value: JSON.stringify(plan.houses) },
    { key: 'seed_report', value: report },
    { key: 'seeded_at', value: now }
  ];
  Object.keys(SCHED_SETTING_DEFAULTS).forEach(function (k) {
    if (!schedStr_(kv[k])) srows.push({ key: k, value: SCHED_SETTING_DEFAULTS[k] });
  });
  srows.forEach(function (r) { r.note = ''; r.updated_at = now; r.updated_by = ctx ? ctx.uid : 'seed'; });
  schedUpsert_(SCHED_TABS.settings, srows);
  schedMemoDrop_();
  return { status: 200, data: { ok: true, dry_run: false, said: 'Copied ' + summary.cells + ' cells of ' + summary.houses + ' houses.',
                                report: plan.report, counts: summary } };
}

HUB_POLICY.schedulingSeed = {
  file: 'Scheduling.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { first: { type: 'string' }, last: { type: 'string' }, dry_run: { type: 'boolean' } }
};
HUB_ACTIONS.schedulingSeed = function (payload, user) {
  var ctx = schedGate_(user);
  if (!ctx.open) return schedClosed_();
  if (!ctx.is_master) return schedRefuse_(403, 'Only the master copies the calendars in.');
  payload = payload || {};
  var first = schedStr_(payload.first) || SCHED_FIRST_PERIOD.first;
  var last = schedStr_(payload.last) || SCHED_FIRST_PERIOD.last;
  if (!schedIsoValid_(first) || !schedIsoValid_(last) || first > last) return schedRefuse_(400, 'The period needs a first and a last day.');
  if ((schedDayIndex_(last) - schedDayIndex_(first) + 1) % 7 !== 0) return schedRefuse_(400, 'A period is whole weeks.');
  var dry = payload.dry_run !== false;
  try {
    if (dry) return schedSeed_(ctx, first, last, true);
    return schedLock_(function () { schedMemoDrop_(); return schedSeed_(ctx, first, last, false); });
  } catch (e) {
    return schedUnreadable_(e);
  }
};

// ---- the roll: the whole combo copied forward by cycle_days ----

// The base pattern of `src` laid onto `next`: scheduled shifts, OFF, workshop and genuinely open cells; a one-off…
function schedRollPlan_(src, next, cells, rows, flows, tokens, now, by) {
  var offset = schedDayIndex_(next.first) - schedDayIndex_(src.first);
  var activeRow = {};
  rows.forEach(function (r) { if (r.active !== 'no') activeRow[r.house_code + '|' + r.row_id] = r; });
  var dropped = { one_off: 0, ro: 0, call_off_open: 0, echo: 0, inactive_row: 0, outside: 0, training_waiting: 0 };
  var planned = {}, order = [];
  var put = function (row) { if (!planned[row.id]) order.push(row.id); planned[row.id] = row; };
  var trainingOf = {}, reopen = [];
  flows.forEach(function (f) { if (f.kind === 'training') trainingOf[f.id] = f; });
  cells.forEach(function (c) {
    if (c.date < src.first || c.date > src.last) return;
    var row = activeRow[c.house_code + '|' + c.row_id];
    if (!row) { dropped.inactive_row++; return; }
    var to = schedIsoAdd_(c.date, offset);
    if (to > next.last) { dropped.outside++; return; }
    var text = schedStr_(c.text), state = schedStr_(c.state) || 'scheduled';
    // an editor's new pattern for somebody whose training nobody has approved yet: the slot is kept, on an OPEN row
    var tf = state === 'training' ? trainingOf[c.flow_id] : null;
    if (tf && tf.source === 'editor' && tf.state === 'waiting' && text) {
      reopen.push({ house: c.house_code, date: to, text: text, location: row.location });
      dropped.training_waiting++;
    }
    if (SCHED_ONE_OFF_STATES[state]) {
      if (!schedStr_(c.base)) { dropped.one_off++; return; }
      text = schedStr_(c.base);
    } else if (state === 'open' && c.flow_id) {
      // a call-off's open shift is a one-off, unless it keeps a pattern nobody else holds
      if (!schedStr_(c.base)) { dropped.call_off_open++; return; }
      text = schedStr_(c.base);
    }
    var cls = schedClassify_(text);
    if (!cls) { dropped.one_off++; return; }
    if (cls.kind === 'ro') { dropped.ro++; return; }
    if (cls.kind === 'alias' && schedNamesHouse_(text, tokens)) { dropped.echo++; return; }
    put(schedRollCell_(c.house_code, c.row_id, to, text, row.row_kind === 'open' && cls.start !== null ? 'open' : 'scheduled',
                       { color: c.color, source: 'roll:' + next.id, period_id: next.id, updated_at: now, updated_by: by }));
  });

  var newRows = [], applied = [], flowsOut = [];
  var cellIds = {};
  order.forEach(function (id) { if (planned[id].text) cellIds[id] = true; });
  var allRows = rows.slice();
  var openRowAt = function (house, date, location) {
    var pick = schedOpenRowFor_(house, date, allRows, cellIds);
    if (pick.fresh) {
      var rec = schedOpenRowRecord_(house, pick.fresh, null);
      if (location) rec.location = location;
      newRows.push(rec);
      allRows.push(rec);
    }
    return pick.row_id;
  };
  reopen.forEach(function (o) {
    var openCell = schedRollCell_(o.house, openRowAt(o.house, o.date, o.location), o.date, o.text, 'open',
                                  { source: 'roll:' + next.id, period_id: next.id, updated_at: now, updated_by: by });
    put(openCell);
    cellIds[openCell.id] = true;
  });
  flows.forEach(function (f) {
    if (f.kind !== 'time_off' || f.state !== 'approved_future' || !f.person_key || !schedIsoValid_(f.date)) return;
    var to = schedIsoValid_(f.date_to) ? f.date_to : f.date;
    // the days the approval kept for the roll (SchedulingFlows.gs outreach_log.future); the range when none is written
    var flog = schedJson_(f.outreach_log, {});
    if (!flog || typeof flog !== 'object' || Array.isArray(flog)) flog = {};
    var owed = Array.isArray(flog.future) ? flog.future.filter(schedIsoValid_) : schedDates_(f.date, to);
    var hit = 0, rolledDays = [];
    owed.forEach(function (d) {
      if (d < next.first || d > next.last) return;
      rolledDays.push(d);
      rows.forEach(function (r) {
        if (r.row_kind !== 'person' || r.person_key !== f.person_key || r.active === 'no') return;
        var id = schedCellId_(r.house_code, r.row_id, d);
        var c = planned[id];
        var cls = c ? schedClassify_(c.text) : null;
        if (!cls || cls.start === null) return;
        var shift = c.text;
        put(schedRollCell_(r.house_code, r.row_id, d, 'R/O', 'time_off',
                           { base: shift, flow_id: f.id, source: 'flow:' + f.id, period_id: next.id, updated_at: now, updated_by: by }));
        var pick = schedOpenRowFor_(r.house_code, d, allRows, cellIds);
        if (pick.fresh) {
          var rec = schedOpenRowRecord_(r.house_code, pick.fresh, null);
          rec.location = r.location;
          newRows.push(rec);
          allRows.push(rec);
        }
        var openCell = schedRollCell_(r.house_code, pick.row_id, d, shift, 'open',
                                      { flow_id: f.id, source: 'flow:' + f.id, period_id: next.id, updated_at: now, updated_by: by });
        put(openCell);
        cellIds[openCell.id] = true;
        applied.push({ flow_id: f.id, house_code: r.house_code, date: d, shift: shift, open_row_id: pick.row_id });
        flog.applied = (Array.isArray(flog.applied) ? flog.applied : []).concat([
          { date: d, house: r.house_code, open_row_id: pick.row_id, roll: next.id }]);
        hit++;
      });
    });
    // a day before the new period was never in one the roll creates: it is not owed any more
    var left = owed.filter(function (d) { return d > next.last; });
    if (owed.length && !rolledDays.length && left.length === owed.length) return;
    var done = schedCopy_(f);
    flog.future = left;
    done.outreach_log = JSON.stringify(flog);
    done.updated_at = now;
    if (!left.length) {
      done.state = 'approved';
      done.closed_at = now;
    }
    flowsOut.push(done);
  });

  var outCells = order.map(function (id) { return planned[id]; });
  var holds = schedHoldIndex_(outCells, allRows, [], tokens);
  var clashes = [];
  Object.keys(holds).forEach(function (key) {
    var list = holds[key].slice().sort(function (a, b) { return a.s - b.s; });
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length && list[j].s < list[i].e; j++) {
        var a = list[i], b = list[j];
        if (a.house_code === b.house_code || a.why === 'off' || b.why === 'off') continue;
        if ((a.whole && a.named === b.house_code) || (b.whole && b.named === a.house_code)) continue;
        if (clashes.length < 200) {
          clashes.push({ person_key: key, date: a.date, a: { house: a.house_code, text: a.text },
                         b: { house: b.house_code, date: b.date, text: b.text } });
        }
      }
    }
  });
  return { cells: outCells, rows: newRows, flows: flowsOut, applied: applied, dropped: dropped, clashes: clashes };
}

function schedRollCell_(houseCode, rowId, date, text, state, extra) {
  var cls = schedClassify_(text);
  var row = {
    id: schedCellId_(houseCode, rowId, date), period_id: '', house_code: houseCode, date: date, row_id: rowId,
    text: text, kind: cls ? cls.kind : '', start_min: cls && cls.start !== null ? String(Math.round(cls.start * 60)) : '',
    end_min: cls && cls.end !== null ? String(Math.round(cls.end * 60)) : '', hours: cls ? cls.hours.toFixed(2) : '0.00',
    token: cls && cls.token ? cls.token : '', color: '', state: state, base: '', flow_id: '', source: '', note: '',
    updated_at: '', updated_by: ''
  };
  for (var k in (extra || {})) if (Object.prototype.hasOwnProperty.call(extra, k)) row[k] = extra[k] == null ? '' : extra[k];
  return row;
}

/** Rolls the last period forward (the clock passes null and rolls only when due). The caller holds the lock. */
function schedRoll_(ctx, dryRun) {
  var settings = schedSettings_();
  if (!settings.readable) return { ok: false, dry_run: !!dryRun, why: 'The Scheduling settings could not be read: ' + settings.why };
  var periods = settings.periods;
  var src = periods[periods.length - 1];
  var today = schedToday_();
  var dueOn = schedIsoAdd_(src.last, -settings.roll_lead_days);
  if (!ctx && today < dueOn) return { ok: false, dry_run: !!dryRun, why: 'Not due until ' + dueOn + '.', due_on: dueOn };
  var first = schedIsoAdd_(src.last, 1);
  var next = { id: 'P' + first, first: first, last: schedIsoAdd_(first, settings.cycle_days - 1), state: 'live',
               rolled_from: src.id, rolled_at: schedNow_(), by: ctx ? ctx.uid : 'clock' };
  var now = schedNow_();
  var plan = schedRollPlan_(src, next, schedRead_(SCHED_TABS.cells), schedRead_(SCHED_TABS.rows),
                            schedRead_(SCHED_TABS.flows), schedHouseTokens_(), now, ctx ? ctx.uid : 'clock');
  var report = { ok: true, dry_run: !!dryRun, from: { id: src.id, first: src.first, last: src.last },
                 period: { id: next.id, first: next.first, last: next.last }, cells: plan.cells.length,
                 open_rows_added: plan.rows.length, time_off_applied: plan.applied.length, dropped: plan.dropped,
                 clashes: plan.clashes };
  if (dryRun) return report;
  var held = schedHeld_();
  if (held) return { ok: false, dry_run: false, why: held.message };
  if (plan.rows.length) schedUpsert_(SCHED_TABS.rows, plan.rows);
  schedUpsert_(SCHED_TABS.cells, plan.cells);
  if (plan.flows.length) schedUpsert_(SCHED_TABS.flows, plan.flows);
  schedAppend_(SCHED_TABS.log, [schedLogRow_(ctx, '', next.first, '', src.id, next.id, 'roll', '',
                                             plan.cells.length + ' cells; ' + plan.clashes.length + ' clashes')]);
  schedUpsert_(SCHED_TABS.settings, [{ key: 'periods', value: JSON.stringify(periods.concat([next])), note: '',
                                       updated_at: now, updated_by: ctx ? ctx.uid : 'clock' }]);
  schedMemoDrop_();
  return report;
}

HUB_POLICY.schedulingRoll = {
  file: 'Scheduling.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { dry_run: { type: 'boolean' }, from: { type: 'string' } }
};
/** A real roll names the period it copies (`from`, the dry run's): a second press, or a re-sent one, rolls nothing. */
HUB_ACTIONS.schedulingRoll = function (payload, user) {
  var ctx = schedGate_(user);
  if (!ctx.open) return schedClosed_();
  if (!ctx.is_master) return schedRefuse_(403, 'Only the master rolls the calendar forward.');
  var dry = !(payload && payload.dry_run === false);
  var from = schedStr_(payload && payload.from);
  try {
    var run = function () {
      schedMemoDrop_();
      if (!dry && from) {
        var periods = schedSettings_().periods;
        var last = periods[periods.length - 1];
        if (last && last.id !== from) return schedRefuse_(409, 'Already rolled: the last period is now ' + last.id + '.');
      }
      return schedRoll_(ctx, dry);
    };
    var report = dry ? run() : schedLock_(run);
    if (report && report.status) return report;
    if (!report.ok) return schedRefuse_(409, report.why);
    return { status: 200, data: { ok: true, dry_run: dry,
                                  said: (dry ? 'Dry run: ' : 'Rolled: ') + report.period.first + ' to ' + report.period.last + ', ' +
                                        report.cells + ' cells, ' + report.clashes.length + ' clashes.',
                                  report: report } };
  } catch (e) {
    return schedUnreadable_(e);
  }
};

// ---- the Time Off house carried over: its approved and pending requests become Scheduling's own time-off flows ----

var SCHED_TO_SOURCE_TAB = 'time_off';
var SCHED_TO_SOURCE = 'time_off_house';
var SCHED_TO_TAKEN = { scheduled: 'approved', pending: 'waiting' };
var SCHED_TO_STANDING = { waiting: 1, approved: 1, approved_future: 1 };
var SCHED_TO_RANK = { would_import: 0, imported: 0, unmatched: 1, skipped: 2, already_imported: 3 };

/** The Time Off house's request rows, read and never written; throws naming what could not be read. */
function schedTimeOffSourceRows_() {
  var id = schedStr_(houseIdFor_(SCHED_TO_SOURCE_TAB));
  if (!id) throw new Error('the Time Off house has no pointer (HUB_HOUSE_TIME_OFF_ID)');
  var sheet = ssOpen_(id).getSheetByName(SCHED_TO_SOURCE_TAB);
  if (!sheet) throw new Error('the Time Off house has no "' + SCHED_TO_SOURCE_TAB + '" tab');
  var values = sheet.getDataRange().getValues();
  var header = (values[0] || []).map(function (h) { return schedStr_(h); });
  if (header.indexOf('id') === -1 || header.indexOf('status') === -1) {
    throw new Error('the Time Off house\'s "' + SCHED_TO_SOURCE_TAB + '" tab has no id or status column');
  }
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = {};
    for (var c = 0; c < header.length; c++) {
      if (!header[c]) continue;
      var v = values[r][c];
      row[header[c]] = Object.prototype.toString.call(v) === '[object Date]'
        ? Utilities.formatDate(v, SCHED_TZ, 'yyyy-MM-dd') : schedStr_(v);
    }
    if (row.id) out.push(row);
  }
  return out;
}

function schedTimeOffDay_(v) {
  var s = schedStr_(v);
  var m = /^\d{4}-\d{2}-\d{2}/.exec(s);
  if (m) return schedIsoValid_(m[0]) ? m[0] : '';
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  var iso = m ? m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) : '';
  return schedIsoValid_(iso) ? iso : '';
}

function schedTimeOffAt_(v) {
  var ms = Date.parse(schedStr_(v));
  return isNaN(ms) ? '' : new Date(ms).toISOString();
}

function schedTimeOffWords_(name) {
  return schedStr_(name).toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 1; });
}

/** Every person on a Scheduling roster row, by name key, with the houses they are on. */
function schedTimeOffRoster_() {
  var out = {};
  schedRead_(SCHED_TABS.rows).forEach(function (r) {
    if (r.row_kind !== 'person' || !r.person_key || r.active === 'no') return;
    var p = out[r.person_key] || (out[r.person_key] = { key: r.person_key, name: r.name, houses: [] });
    if (p.houses.indexOf(r.house_code) === -1) p.houses.push(r.house_code);
  });
  return out;
}

/** The roster person a Time Off row names: the name key, else the one roster name with the same first and last words. */
function schedTimeOffWho_(row, roster) {
  var keys = [schedFold_(row.person_key), schedFold_(row.person)];
  for (var i = 0; i < keys.length; i++) if (keys[i] && roster[keys[i]]) return roster[keys[i]];
  var wa = schedTimeOffWords_(row.person);
  if (wa.length < 2) return null;
  var hits = Object.keys(roster).filter(function (k) {
    var wb = schedTimeOffWords_(roster[k].name);
    return wb.length >= 2 && wb[0] === wa[0] && wb[wb.length - 1] === wa[wa.length - 1];
  });
  return hits.length === 1 ? roster[hits[0]] : null;
}

/** The Time Off row's house codes as Scheduling houses, and those no Scheduling house answers. */
function schedTimeOffHouses_(raw, tokens) {
  var codes = [], unknown = [];
  schedStr_(raw).split(/[,;]+/).forEach(function (t) {
    var up = schedStr_(t).toUpperCase();
    if (!up) return;
    var code = tokens[up] || tokens[up.replace(/\s+/g, '')] || '';
    if (code) { if (codes.indexOf(code) === -1) codes.push(code); } else if (unknown.indexOf(up) === -1) unknown.push(up);
  });
  return { codes: codes, unknown: unknown };
}

/** The shifts a person holds on those days, every house: what approved time off stands beside on the calendar. */
function schedTimeOffHeld_(cells, key, from, to) {
  return cells.filter(function (c) {
    return c.row_id === 'P:' + key && c.date >= from && c.date <= to && schedFlowHolds_(c);
  }).sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); }).map(function (c) {
    return c.date + ' ' + schedHouseLabel_(c.house_code) + ' ' + c.text;
  });
}

/** One carried-over request as a time-off flow: approved as a closed record, pending waiting on the directors. */
function schedTimeOffFlow_(ctx, row, who, uid, from, to, as, askable) {
  var ref = schedStr_(row.id);
  var nowIso = new Date(schedFlowNow_()).toISOString();
  var by = schedStr_(row.dir_by) || schedStr_(row.closed_by) || 'the Time Off app';
  var at = schedTimeOffAt_(row.dir_at) || schedTimeOffAt_(row.decided_at) || nowIso;
  var seat = as === 'waiting'
    ? { seat: 'director', to: askable, state: 'waiting', by: '', at: '', note: '', why: '' }
    : { seat: 'director', to: [], state: 'approved', by: by, at: at, note: '', why: 'carried over' };
  var f = schedFlowRow_({
    id: 'SF' + schedFlowHex_(SCHED_TO_SOURCE + '|' + ref).slice(0, 10).toUpperCase(), kind: 'time_off', state: as,
    date: from, date_to: to, row_id: 'P:' + who.key, person: who.name, person_key: who.key, person_uid: uid,
    reason: schedFlowText_(row.time_off_reason, 500), note: 'Carried over from the Time Off app (' + ref + ').',
    source: SCHED_TO_SOURCE, source_ref: ref, created_at: schedTimeOffAt_(row.createdAt), created_by: ctx.uid,
    seats: JSON.stringify([seat])
  });
  if (as === 'approved') {
    f.closed_at = at;
    f.closed_by = by;
    f.outreach_log = JSON.stringify({ applied: [], future: [], carried: true });
  }
  return f;
}

// The Time Off house's scheduled requests become approved records and its pending ones wait on the directors in My…
function schedTimeOffImport_(ctx, source, apply) {
  var today = schedFlowDay_(schedFlowNow_());
  var roster = schedTimeOffRoster_();
  var tokens = schedHouseTokens_();
  var cells = schedRead_(SCHED_TABS.cells);
  var dirs = schedFlowDirectors_(schedSettings_());
  var done = {}, standing = [];
  schedRead_(SCHED_TABS.flows).forEach(function (f) {
    if (f.kind !== 'time_off') return;
    if (f.source === SCHED_TO_SOURCE && f.source_ref) done[f.source_ref] = f;
    if (SCHED_TO_STANDING[f.state]) standing.push(f);
  });
  var counts = { rows: 0, by_status: {}, imported: 0, approved: 0, waiting: 0, already_imported: 0, unmatched: 0,
                 skipped: 0, with_conflicts: 0 };
  var lines = [], flows = [], items = [];
  (source || []).forEach(function (row) {
    var ref = schedStr_(row.id);
    if (!ref) return;
    counts.rows++;
    var status = schedStr_(row.status).toLowerCase() || 'blank';
    counts.by_status[status] = (counts.by_status[status] || 0) + 1;
    var as = SCHED_TO_TAKEN[status] || '';
    // the closed past is counted, never listed
    if (status === 'history') { counts.skipped++; return; }
    var from = schedTimeOffDay_(row.start_date), to = schedTimeOffDay_(row.end_date) || from;
    var hs = schedTimeOffHouses_(row.houses, tokens);
    var line = { ref: ref, person: schedStr_(row.person), status: status, from: from, to: to, houses: hs.codes,
                 houses_unknown: hs.unknown, matched: '', as: as, outcome: 'skipped', why: '', conflicts: [] };
    lines.push(line);
    var skip = function (why) { line.why = why; counts.skipped++; };
    if (!as) return skip('a ' + status + ' request is not carried over');
    if (done[ref]) {
      line.outcome = 'already_imported';
      line.flow_id = done[ref].id;
      counts.already_imported++;
      return;
    }
    var who = schedTimeOffWho_(row, roster);
    if (!who) {
      line.outcome = 'unmatched';
      line.why = 'nobody on a Scheduling roster answers this name';
      counts.unmatched++;
      return;
    }
    line.matched = who.name;
    if (!from || to < from) return skip('the dates cannot be read');
    if (as === 'waiting' && from < today) return skip('still pending, but its first day has passed');
    var clash = standing.filter(function (f) {
      return f.person_key === who.key && f.date <= to && (f.date_to || f.date) >= from;
    })[0];
    if (clash) return skip('overlaps time off already in Scheduling (' + clash.date + ' to ' + (clash.date_to || clash.date) + ')');
    var uid = (schedUserByKey_(who.key) || {}).uid || '';
    var askable = [];
    if (as === 'waiting') {
      if (!dirs.readable) return skip('nobody can decide it: ' + dirs.why);
      askable = dirs.list.filter(function (d) { return d.uid !== uid; });
      if (!askable.length) return skip('no director but the person can decide it');
    } else {
      line.conflicts = schedTimeOffHeld_(cells, who.key, from, to);
      if (line.conflicts.length) counts.with_conflicts++;
    }
    if (!hs.codes.length && !hs.unknown.length) line.why = 'no houses on the request — carried against the person';
    line.outcome = apply ? 'imported' : 'would_import';
    counts.imported++;
    counts[as]++;
    var f = apply ? schedTimeOffFlow_(ctx, row, who, uid, from, to, as, askable)
      : { person_key: who.key, date: from, date_to: to };
    standing.push(f);
    if (!apply) return;
    line.flow_id = f.id;
    flows.push(f);
    if (as !== 'waiting') return;
    var title = 'Time off — ' + who.name + ' · ' + schedFlowDayWords_(from) + ' to ' + schedFlowDayWords_(to);
    var body = (f.reason ? '"' + f.reason + '" — ' : '') + 'Carried over from the Time Off app. Approve to put every ' +
               'shift of theirs in those days up as an open shift; days beyond the last calendar period are applied ' +
               'when the roll creates them.';
    askable.forEach(function (d) { items.push(schedFlowItem_(f, 'work', 'approval', 'director', d, title, body)); });
  });
  if (flows.length) schedUpsert_(SCHED_TABS.flows, flows);
  if (items.length) schedInbox_(items);
  lines.sort(function (a, b) {
    var ra = SCHED_TO_RANK[a.outcome], rb = SCHED_TO_RANK[b.outcome];
    if (ra !== rb) return ra - rb;
    return a.from < b.from ? -1 : (a.from > b.from ? 1 : 0);
  });
  var said = (apply ? 'Carried over ' : 'Dry run: would carry over ') + counts.imported + ' (' + counts.approved +
             ' approved, ' + counts.waiting + ' waiting on the directors); ' + counts.already_imported +
             ' already here, ' + counts.unmatched + ' not matched, ' + counts.skipped + ' left behind.';
  return { ok: true, dry_run: !apply, said: said, report: { counts: counts, lines: lines } };
}

HUB_POLICY.schedulingTimeOffImport = {
  file: 'Scheduling.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { apply: { type: 'boolean' } }
};
/** The master's carry-over of the Time Off house: a dry run unless `apply` is true; run twice, it carries nothing new. */
HUB_ACTIONS.schedulingTimeOffImport = function (payload, user) {
  var ctx = schedGate_(user);
  if (!ctx.open) return schedClosed_();
  if (!ctx.is_master) return schedRefuse_(403, 'Only the master carries the time off over.');
  var apply = !!(payload && (payload.apply === true || payload.apply === 'true'));
  var source;
  try { source = schedTimeOffSourceRows_(); }
  catch (eS) { return schedRefuse_(503, 'The Time Off house could not be read just now — ' + schedErr_(eS)); }
  try {
    if (!apply) return { status: 200, data: schedTimeOffImport_(ctx, source, false) };
    var res = schedLock_(function () {
      schedMemoDrop_();
      var held = schedHeld_();
      if (held) return held;
      return schedTimeOffImport_(ctx, source, true);
    });
    if (!res || res.status) return res || schedRefuse_(503, 'No answer from the lock.');
    schedBump_();
    hubSysLog_(schedStr_(user && user.email), 'schedulingTimeOffImport', res.said, { status: 200 });
    return { status: 200, data: res };
  } catch (e) {
    return schedUnreadable_(e);
  }
};
