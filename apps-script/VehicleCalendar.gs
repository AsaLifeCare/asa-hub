// Transportation (app id vehicle-calendar): the team's vehicles, the trips booked on them and the requests the…
// The request, answer, withdraw, assignment and text flows live in VehicleCalendarFlows.gs and write through here.

var VC_APP_ID = 'vehicle-calendar';
var VC_TABS = { vehicles: 'vc_vehicles', trips: 'vc_trips', inbox: 'vc_inbox', log: 'vc_log', settings: 'vc_settings' };

var VC_HEADERS = {
  vc_vehicles: ['id', 'name', 'description', 'seats', 'wheelchair_accessible', 'availability', 'aliases', 'tint', 'order',
                'note', 'created_at', 'updated_at', 'updated_by'],
  vc_trips: ['id', 'state', 'vehicle_id', 'requested_vehicle_id', 'start_at', 'end_at', 'day', 'end_known',
             'wheelchair_required', 'trip_type', 'purpose', 'destination', 'details', 'client_key', 'client_name',
             'staff_key', 'staff_uid', 'staff_name', 'driver_key', 'driver_uid', 'driver_name', 'requested_by_uid',
             'requested_by_name', 'decided_by_uid', 'decided_by_name', 'decided_at', 'decision_note', 'assign_note',
             'appointment_ref', 'source', 'source_ref', 'told', 'test_mode', 'created_at', 'created_by', 'updated_at',
             'updated_by'],
  vc_inbox: ['id', 'trip_id', 'box', 'kind', 'seat', 'to_uid', 'to_email', 'to_name', 'title', 'body', 'facts', 'date',
             'when', 'state', 'answered_by', 'answered_at', 'note', 'link', 'test_mode', 'created_at'],
  vc_log: ['id', 'at', 'by_uid', 'by_name', 'trip_id', 'vehicle_id', 'via', 'was', 'now', 'note'],
  vc_settings: ['key', 'value', 'note', 'updated_at', 'updated_by']
};

var VC_ACTIONS = ['vehicleCalendarBoard', 'vehicleCalendarRequest', 'vehicleCalendarAnswer', 'vehicleCalendarWithdraw',
                  'vehicleCalendarTripSave', 'vehicleCalendarVehicleSave', 'vehicleCalendarSettingsSet',
                  'vehicleCalendarSeed', 'vehicleCalendarImport'];
var VC_SITUATIONS = ['transport_request_ask', 'transport_request_decided', 'transport_trip_cancelled'];

var VC_TZ = 'America/New_York';
var VC_LOCK_MS = 20000;
var VC_BUSY_SENTENCE = 'Somebody else is changing the vehicle calendar right now — try again.';
var VC_VISITING_SENTENCE = 'Do this from your own account — not while visiting someone else.';
var VC_BOARD_VERSION_KEY = 'vc_board_v';
var VC_TTL = 21600;
var VC_SIDE_TTL = 1800;
var VC_CHUNK = 90000;
var VC_CHUNKS_MAX = 60;
var VC_HISTORY_DAYS = 400;
var VC_MAX_SPAN_MS = 14 * 86400000;
var VC_LATE_MS = 15 * 60000;
var VC_DUE_KEY = 'vc_due_at';
var VC_INBOX_READER = 'living-brain@asalifecare-jarvis.iam.gserviceaccount.com';
var VC_INBOX_SHARED_PROP = 'VC_INBOX_SHARED';
var VC_INBOX_SHARE_TRY_KEY = 'vc_inbox_share_try';
var VC_PEOPLE_KEY = 'vc_people_v2';
var VC_CLIENTS_KEY = 'vc_clients_v1';
var VC_DRIVERS_KEY = 'vc_drivers_v1';

var VC_STAFF_ROLES = ['admin', 'director', 'manager', 'staff'];
var VC_AVAILABILITY = ['available', 'maintenance', 'out_of_service'];
var VC_TINTS = ['blue', 'mint', 'peach', 'lilac', 'amber', 'rose'];
var VC_STATES = ['requested', 'scheduled', 'needs_assignment', 'declined', 'cancelled'];
var VC_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var VC_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

var VC_SETTING_DEFAULTS = {
  directors: 'ty.bond@asalifecare.com, brittfrench1316@gmail.com',
  trip_types: '["Doctor appointment","Grocery shopping","Chores / errands","Social / outing","Day program","Work","Other"]',
  text_to: '{}',
  import_minutes: '120'
};

var VC_SEED_VEHICLES = [
  { name: 'Van', description: 'Wheelchair-accessible van', seats: 6, wheelchair_accessible: 'yes',
    availability: 'available', aliases: 'Van|Wheelchair Van - 1|Wheelchair Van', tint: 'blue', order: 1 },
  { name: 'Mazda', description: 'Mazda CX-5', seats: 5, wheelchair_accessible: 'no',
    availability: 'available', aliases: 'Mazda|Mazda Van|Mazda CX-5', tint: 'mint', order: 2 },
  { name: 'Ford', description: 'Ford Escape', seats: 5, wheelchair_accessible: 'no',
    availability: 'available', aliases: 'Ford|Ford Escape', tint: 'peach', order: 3 }
];

/** The self-test's clock: an ISO instant while a check names the moment it is about, null everywhere real. */
var VC_NOW = null;

// ---- small pure helpers ----

function vcStr_(v) { return String(v == null ? '' : v).trim(); }

function vcText_(v, max) {
  var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return max ? s.slice(0, max) : s;
}

function vcErr_(e) { return String((e && e.message) || e || 'unknown error').slice(0, 240); }

function vcRefuse_(status, message) { return { status: status, message: message }; }

function vcClosed_() { return vcRefuse_(404, 'Unknown action.'); }

function vcJson_(text, fallback) {
  if (text && typeof text === 'object') return text;
  var s = vcStr_(text);
  if (!s) return fallback;
  try { var v = JSON.parse(s); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; }
}

function vcYes_(v) {
  if (v === true) return true;
  return /^(yes|true|1|on|y)$/i.test(vcStr_(v));
}

function vcWord_(b) { return b ? 'yes' : 'no'; }

function vcNow_() {
  if (VC_NOW) {
    var t = Date.parse(String(VC_NOW));
    if (!isNaN(t)) return t;
  }
  return Date.now();
}

function vcNowIso_() { return new Date(vcNow_()).toISOString(); }

function vcMs_(iso) {
  var t = Date.parse(vcStr_(iso));
  return isNaN(t) ? NaN : t;
}

function vcHex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

/** The first ten hex characters of SHA-256, upper case. */
function vcSha10_(text) {
  return vcHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8))
    .slice(0, 10).toUpperCase();
}

function vcNewId_(prefix) {
  var hex = '';
  while (hex.length < 10) hex += Math.floor(Math.random() * 0x100000000).toString(16);
  return prefix + hex.slice(0, 10).toUpperCase();
}

function vcIsoValid_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(vcStr_(iso));
  if (!m) return false;
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function vcDayIndex_(iso) {
  var p = vcStr_(iso).split('-');
  return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
}

function vcIsoAdd_(iso, days) {
  var d = new Date((vcDayIndex_(iso) + days) * 86400000);
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

/** The Ohio day of an instant. */
function vcDayOf_(ms) { return Utilities.formatDate(new Date(ms), VC_TZ, 'yyyy-MM-dd'); }

/** The Ohio clock of an instant, 24 h ('09:00'). */
function vcHm_(ms) { return Utilities.formatDate(new Date(ms), VC_TZ, 'HH:mm'); }

/** The Ohio clock of an instant in words ('1:00 PM'). */
function vcClockWords_(ms) { return String(Utilities.formatDate(new Date(ms), VC_TZ, 'h:mm a')).replace(/ /g, ' '); }

function vcMinutesOfDay_(ms) {
  var hm = vcHm_(ms).split(':');
  return Number(hm[0]) * 60 + Number(hm[1]);
}

/** An instant as ISO with the Eastern offset of that moment (yyyy-MM-ddTHH:mm:00-04:00, or -05:00 in winter). */
function vcIso_(ms) {
  var t = Math.floor(Number(ms) / 60000) * 60000;
  var day = vcDayOf_(t), hm = vcHm_(t);
  var p = day.split('-'), h = hm.split(':');
  var off = Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2], +h[0], +h[1]) - t) / 60000);
  var a = Math.abs(off);
  return day + 'T' + hm + ':00' + (off < 0 ? '-' : '+') + ('0' + Math.floor(a / 60)).slice(-2) + ':' +
         ('0' + (a % 60)).slice(-2);
}

// 'yyyy-MM-ddTHH:mm' on the Eastern wall clock → { ms }.
function vcWallToMs_(wall) {
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(vcStr_(wall));
  var bad = { status: 400, message: 'Choose a date and a time.' };
  if (!m) return bad;
  var day = m[1] + '-' + m[2] + '-' + m[3];
  if (!vcIsoValid_(day) || +m[4] > 23 || +m[5] > 59) return bad;
  var base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  var hours = [4, 5];
  for (var i = 0; i < hours.length; i++) {
    var ms = base + hours[i] * 3600000;
    if (vcDayOf_(ms) === day && vcHm_(ms) === m[4] + ':' + m[5]) return { ms: ms };
  }
  return { status: 400, message: 'That time does not exist in Eastern Time (the clocks jump forward).' };
}

/** 'Tue Oct 7' (with the weekday) or 'Oct 7'. */
function vcDayWords_(iso, withWeekday) {
  if (!vcIsoValid_(iso)) return vcStr_(iso);
  var p = iso.split('-');
  var words = VC_MONTHS[+p[1] - 1] + ' ' + (+p[2]);
  return withWeekday ? VC_WEEKDAYS[((vcDayIndex_(iso) % 7) + 7 + 4) % 7] + ' ' + words : words;
}

/** 'Tue Oct 7, 1:00 PM – 3:20 PM', or 'Oct 7, 1:00 PM – Oct 8, 9:00 AM' across days; `ascii` uses a plain hyphen. */
function vcWhenWords_(startIso, endIso, ascii) {
  var s = vcMs_(startIso), e = vcMs_(endIso);
  if (isNaN(s)) return '';
  var dash = ascii ? ' - ' : ' – ';
  var sd = vcDayOf_(s);
  if (isNaN(e)) return vcDayWords_(sd, true) + ', ' + vcClockWords_(s);
  var ed = vcDayOf_(e);
  if (sd === ed) return vcDayWords_(sd, true) + ', ' + vcClockWords_(s) + dash + vcClockWords_(e);
  return vcDayWords_(sd, false) + ', ' + vcClockWords_(s) + dash + vcDayWords_(ed, false) + ', ' + vcClockWords_(e);
}

/** '9:00 AM – 11:30 AM' on one day, the whole words across days. */
function vcSpanWords_(startIso, endIso) {
  var s = vcMs_(startIso), e = vcMs_(endIso);
  if (isNaN(s) || isNaN(e)) return vcWhenWords_(startIso, endIso);
  if (vcDayOf_(s) !== vcDayOf_(e)) return vcWhenWords_(startIso, endIso);
  return vcClockWords_(s) + ' – ' + vcClockWords_(e);
}

/** Half-open: a trip ending at ten leaves the vehicle free for one starting at ten. */
function vcOverlap_(a, b) { return a.s < b.e && b.s < a.e; }

function vcSpanOf_(t) { return { s: vcMs_(t.start_at), e: vcMs_(t.end_at) }; }

function vcStamp_(ms) {
  var day = vcDayOf_(ms);
  return vcDayWords_(day, false) + ', ' + day.slice(0, 4) + ', ' + vcClockWords_(ms) + ' Eastern';
}

function vcPhoneWords_(e164) {
  var d = vcStr_(e164).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : vcStr_(e164);
}

// ---- the houses (ASA Data, one Data tab each) ----

function vcHouseReady_(tab) {
  try { return !!houseMoved_(tab); } catch (e) { return false; }
}

function vcSheet_(tab) {
  if (!VC_HEADERS[tab]) throw new Error('No Transportation house is called "' + tab + '".');
  if (!vcHouseReady_(tab)) {
    throw new Error('The Transportation house "' + tab + '" is not set up (no pointer, or moved.' + tab + ' is not on).');
  }
  return hubTabEnsure_(tab, VC_HEADERS[tab]);
}

function vcIdField_(tab) { return tab === VC_TABS.settings ? 'key' : 'id'; }

function vcCellText_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return cellText_(v) || '';
  return String(v).trim();
}

var VC_MEMO = {};
var VC_DIRTY = false;
var VC_INBOX_TOUCHED = false;

function vcMemoDrop_(tab) { if (tab) delete VC_MEMO[tab]; else VC_MEMO = {}; }

/** Under the lock every house is read again: rows memoized before it may be another execution's past. */
function vcMemoFresh_() {
  Object.keys(VC_TABS).forEach(function (k) { delete VC_MEMO[VC_TABS[k]]; });
  delete VC_MEMO.__settings;
  VC_ROWS_MEMO = {};
  VC_BOARD_MEMO = {};
}

/** A write is flushed and the version bumped again before the lock goes: no reader caches rows still in flight. */
function vcSettle_() {
  if (!VC_DIRTY) return;
  VC_DIRTY = false;
  try { SpreadsheetApp.flush(); } catch (e) { /* the bump below still invalidates */ }
  vcBump_();
}

/** Every row of a house as a plain object keyed by its header; throws (naming the house) when it cannot be read. */
function vcRead_(tab) {
  if (Object.prototype.hasOwnProperty.call(VC_MEMO, tab)) return VC_MEMO[tab];
  var setKey = '';
  if (tab === VC_TABS.settings && vcVersion_()) {
    try {
      setKey = 'vc_set:' + vcVersion_();
      var hit = CacheService.getScriptCache().get(setKey);
      if (hit) { VC_MEMO[tab] = JSON.parse(hit); return VC_MEMO[tab]; }
    } catch (eC) { setKey = ''; }
  }
  var values;
  try { values = vcSheet_(tab).getDataRange().getValues(); }
  catch (e) { throw new Error(/^The Transportation house/.test(vcErr_(e)) ? vcErr_(e) : 'The Transportation house "' + tab + '" could not be read: ' + vcErr_(e)); }
  var out = [];
  if (values.length > 1) {
    var header = values[0].map(function (h) { return String(h || '').trim(); });
    var idf = vcIdField_(tab);
    for (var r = 1; r < values.length; r++) {
      var row = {};
      for (var c = 0; c < header.length; c++) if (header[c]) row[header[c]] = vcCellText_(values[r][c]);
      if (row[idf]) out.push(row);
    }
  }
  if (setKey) {
    try { CacheService.getScriptCache().put(setKey, JSON.stringify(out), VC_TTL); } catch (eP) {}
  }
  VC_MEMO[tab] = out;
  return out;
}

function vcLine_(header, row) {
  return header.map(function (h) {
    var v = Object.prototype.hasOwnProperty.call(row, h) ? row[h] : '';
    if (v !== null && typeof v === 'object') v = JSON.stringify(v);
    return hubCellSafe_(String(v == null ? '' : v));
  });
}

function vcPutLines_(sheet, at, lines) {
  if (!lines.length) return;
  var need = at + lines.length - 1;
  if (need > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), need - sheet.getMaxRows());
  var range = sheet.getRange(at, 1, lines.length, lines[0].length);
  range.setNumberFormat('@');
  range.setValues(lines);
}

function vcWrite_(tab, rows, appendOnly) {
  if (!rows || !rows.length) return 0;
  var held = sheetDbGateHolds_(tab, appendOnly ? 'create' : 'update');
  if (held) throw new Error(held.error.message);
  var sheet = vcSheet_(tab);
  var header = ensureHeader_(sheet, VC_HEADERS[tab]);
  var idf = vcIdField_(tab), idCol = header.indexOf(idf);
  var last = Math.max(sheet.getLastRow(), 1);
  var at = {};
  if (!appendOnly && last > 1 && idCol !== -1) {
    sheet.getRange(2, idCol + 1, last - 1, 1).getValues().forEach(function (r, i) {
      var k = vcCellText_(r[0]);
      if (k && !Object.prototype.hasOwnProperty.call(at, k)) at[k] = i + 2;
    });
  }
  var byId = {}, order = [];
  rows.forEach(function (row) {
    var k = vcStr_(row[idf]);
    if (!k) throw new Error('A ' + tab + ' row needs its ' + idf + '.');
    if (!Object.prototype.hasOwnProperty.call(byId, k)) order.push(k);
    byId[k] = row;
  });
  var updates = [], appends = [];
  order.forEach(function (k) {
    var line = vcLine_(header, byId[k]);
    if (Object.prototype.hasOwnProperty.call(at, k)) updates.push({ at: at[k], line: line });
    else appends.push(line);
  });
  if (updates.length > 40) {
    var body = sheet.getRange(2, 1, last - 1, header.length).getValues().map(function (r) {
      return r.map(function (v) { return hubCellSafe_(vcCellText_(v)); });
    });
    updates.forEach(function (u) { body[u.at - 2] = u.line; });
    vcPutLines_(sheet, 2, body);
  } else {
    updates.forEach(function (u) { vcPutLines_(sheet, u.at, [u.line]); });
  }
  vcPutLines_(sheet, last + 1, appends);
  VC_DIRTY = true;
  if (tab === VC_TABS.inbox) VC_INBOX_TOUCHED = true;
  vcMemoDrop_(tab);
  if (tab === VC_TABS.settings) delete VC_MEMO.__settings;
  vcBump_();
  return order.length;
}

/** Writes rows by id (by key for settings); the caller holds the lock. */
function vcUpsert_(tab, rows) { return vcWrite_(tab, rows, false); }

function vcAppend_(tab, rows) { return vcWrite_(tab, rows, true); }

/** Runs fn under the script lock (20 s, else a 409 the panel shows); houses are read fresh inside, flushed after. */
function vcLock_(fn) {
  var lock = LockService.getScriptLock();
  var held = false;
  try { held = lock.tryLock(VC_LOCK_MS); } catch (e) { held = false; }
  if (!held) return vcRefuse_(409, VC_BUSY_SENTENCE);
  vcMemoFresh_();
  try { return fn(); } finally {
    try { vcSettle_(); } catch (eS) { /* released regardless */ }
    try { lock.releaseLock(); } catch (eR) {}
    vcInboxShareMaybe_();
  }
}

// The items house must be readable by the relay's mirror (My Work and My Inbox read it there).
function vcInboxShareMaybe_() {
  if (!VC_INBOX_TOUCHED) return null;
  VC_INBOX_TOUCHED = false;
  var said = { ok: false, reason: '' };
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty(VC_INBOX_SHARED_PROP)) return { ok: true, already: true };
    var cache = CacheService.getScriptCache();
    if (cache.get(VC_INBOX_SHARE_TRY_KEY)) return { ok: false, waiting: true };
    cache.put(VC_INBOX_SHARE_TRY_KEY, '1', 600);
    var id = vcStr_(houseIdFor_(VC_TABS.inbox));
    if (!id) {
      said.reason = 'the items house has no pointer';
    } else {
      var file = { getId: function () { return id; }, getName: function () { return VC_TABS.inbox; } };
      if (hubGrantReader_(file, VC_INBOX_READER, said)) {
        props.setProperty(VC_INBOX_SHARED_PROP, new Date().toISOString() + ' ' + id);
        said.ok = true;
      }
    }
  } catch (e) { said.ok = false; said.reason = vcErr_(e); }
  if (!said.ok) {
    try {
      hubSysLog_('asa-hub:transportation', 'transportation_inbox_not_shared',
                 'the relay mirror (' + VC_INBOX_READER + ') is not yet a reader of vc_inbox: ' +
                 (vcStr_(said.reason) || 'the grant was refused') + ' — tried again on a later write', { status: 409 });
    } catch (eL) { /* the next write tries again */ }
  }
  return said;
}

// ---- the cache ----

var VC_ROWS_MEMO = {};
var VC_BOARD_MEMO = {};

function vcBump_() {
  try { CacheService.getScriptCache().put(VC_BOARD_VERSION_KEY, String(Date.now()) + vcNewId_('-'), VC_TTL); }
  catch (e) {}
  VC_ROWS_MEMO = {};
  VC_BOARD_MEMO = {};
}

/** The board's cache version; '' when the cache cannot answer, and then nothing is cached. */
function vcVersion_() {
  try {
    var cache = CacheService.getScriptCache();
    var v = cache.get(VC_BOARD_VERSION_KEY);
    if (!v) {
      v = String(Date.now()) + vcNewId_('-');
      cache.put(VC_BOARD_VERSION_KEY, v, VC_TTL);
    }
    return v;
  } catch (e) { return ''; }
}

function vcCacheGet_(base) {
  try {
    var cache = CacheService.getScriptCache();
    var n = parseInt(cache.get(base + ':n') || '', 10);
    if (!n) return null;
    var text = '';
    for (var i = 0; i < n; i++) {
      var part = cache.get(base + ':' + i);
      if (part === null || part === undefined) return null;
      text += part;
    }
    return JSON.parse(text);
  } catch (e) { return null; }
}

function vcCachePut_(base, value, ttl) {
  try {
    var cache = CacheService.getScriptCache();
    var text = JSON.stringify(value);
    var n = Math.ceil(text.length / VC_CHUNK);
    if (n > VC_CHUNKS_MAX) return;
    for (var i = 0; i < n; i++) cache.put(base + ':' + i, text.substr(i * VC_CHUNK, VC_CHUNK), ttl || VC_TTL);
    cache.put(base + ':n', String(n), ttl || VC_TTL);
  } catch (e) {}
}

/** The three houses a read needs, kept under the version every write bumps: { vehicles, trips, inbox, inbox_why }. */
function vcRows_() {
  var v = vcVersion_();
  var base = 'vc_rows:' + v;
  if (VC_ROWS_MEMO[base]) return VC_ROWS_MEMO[base];
  var got = v ? vcCacheGet_(base) : null;
  if (!got) {
    got = { vehicles: vcRead_(VC_TABS.vehicles), trips: vcRead_(VC_TABS.trips), inbox: null, inbox_why: '' };
    try { got.inbox = vcRead_(VC_TABS.inbox); } catch (e) { got.inbox_why = vcErr_(e); }
    if (v && got.inbox) vcCachePut_(base, got);
  }
  VC_ROWS_MEMO[base] = got;
  return got;
}

// ---- test mode and the quiet window ----

/** Test mode, fail closed: anything unreadable or unknown is on. */
function vcTestMode_() {
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
    return { on: true, readable: false, why: 'Test mode could not be read (' + vcErr_(e) + ') — held as on.' };
  }
}

function vcTestWord_() {
  try { return vcTestMode_().on === false ? 'no' : 'yes'; } catch (e) { return 'yes'; }
}

// ---- accounts ----

function vcLive_(u) {
  var off = vcStr_(u && u.active).toUpperCase();
  return !!u && off !== 'FALSE' && off !== '0' && off !== 'NO' && !vcStr_(u.mergedinto);
}

/** The live account with this id, or null. */
function vcAccount_(uid) {
  var id = vcStr_(uid);
  if (!id) return null;
  var all = [];
  try { all = usersAll_() || []; } catch (e) { return null; }
  for (var i = 0; i < all.length; i++) {
    if (vcStr_(all[i].userid) === id && vcLive_(all[i])) return all[i];
  }
  return null;
}

/** The account's own numbers, its sign-in phone first: each one this platform may text, as +1XXXXXXXXXX. */
function vcAccountPhones_(u) {
  if (!u) return [];
  var tries = [u.phone];
  var list = [];
  try { list = (typeof profileParsePhones_ === 'function') ? profileParsePhones_(u.phones) || [] : []; } catch (e) { list = []; }
  list.forEach(function (p) { tries.push(p && typeof p === 'object' ? p.number : p); });
  var out = [];
  tries.forEach(function (t) {
    var n = packetSendableNumber_(t);
    if (n && out.indexOf(n) === -1) out.push(n);
  });
  return out;
}

/** The number a text to this account goes to: the settings' text_to, then the account's phone, then its phones. */
function vcPhoneOf_(uid) {
  var id = vcStr_(uid);
  if (!id) return '';
  var st = null;
  try { st = vcSettings_(); } catch (e) { st = null; }
  var over = st && st.text_to ? packetSendableNumber_(st.text_to[id]) : '';
  if (over) return over;
  return vcAccountPhones_(vcAccount_(id))[0] || '';
}

/** A list cached for half an hour, outside the board's version: built only when the cache misses or was degraded. */
function vcSideCached_(key, build) {
  if (Object.prototype.hasOwnProperty.call(VC_MEMO, '__side:' + key)) return VC_MEMO['__side:' + key];
  var got = vcCacheGet_(key);
  if (!got) {
    got = build();
    if (got && got.readable) vcCachePut_(key, got, VC_SIDE_TTL);
  }
  VC_MEMO['__side:' + key] = got;
  return got;
}

// Live staff-side accounts as pickers: { readable, why, rows:[{key, uid, name}], byKey, byUid }.
function vcPeople_() {
  var got = vcSideCached_(VC_PEOPLE_KEY, function () {
    var out = { readable: false, why: '', rows: [] };
    var all;
    try { all = usersAll_() || []; } catch (e) { out.why = 'the accounts could not be read (' + vcErr_(e) + ')'; return out; }
    var seen = {};
    all.forEach(function (u) {
      if (!vcLive_(u)) return;
      if (VC_STAFF_ROLES.indexOf(vcStr_(u.role).toLowerCase()) === -1) return;
      var name = vcStr_(u.displayname), uid = vcStr_(u.userid);
      var key = clientNameKey_(name);
      if (!key || !uid) return;
      // kept for lookups, left out of the picker
      var row = { key: key, uid: uid, name: name };
      if (typeof hubIsMasterRow_ === 'function' && hubIsMasterRow_(u)) row.unlisted = true;
      (seen[key] = seen[key] || []).push(row);
    });
    var dropped = 0;
    Object.keys(seen).forEach(function (k) {
      if (seen[k].length > 1) { dropped++; return; }
      out.rows.push(seen[k][0]);
    });
    out.rows.sort(function (a, b) { return a.name.localeCompare(b.name); });
    out.readable = true;
    if (dropped) {
      out.why = dropped + ' name' + (dropped === 1 ? ' is' : 's are') + ' worn by two live accounts and left out of ' +
                'the staff list';
    }
    return out;
  });
  if (!got.byKey) {
    got.byKey = {};
    got.byUid = {};
    (got.rows || []).forEach(function (p) { got.byKey[p.key] = p; got.byUid[p.uid] = p; });
  }
  return got;
}

/** The active client roster as pickers: { readable, why, rows:[{key, name}] }. */
function vcClients_() {
  return vcSideCached_(VC_CLIENTS_KEY, function () {
    var out = { readable: false, why: '', rows: [] };
    var data;
    try { data = cpRosterBuild_(false); }
    catch (e) { out.why = 'the client roster could not be read (' + vcErr_(e) + ')'; return out; }
    if (!data || !Array.isArray(data.clients)) { out.why = 'the client roster answered in a shape this app does not read'; return out; }
    var seen = {};
    data.clients.forEach(function (c) {
      var key = vcStr_(c && c.client_key), name = vcStr_(c && c.name);
      if (!key || !name || seen[key]) return;
      seen[key] = true;
      out.rows.push({ key: key, name: name });
    });
    out.rows.sort(function (a, b) { return a.name.localeCompare(b.name); });
    out.readable = true;
    return out;
  });
}

/** One person's driving word from the two Employee Database reads: may_drive true, false, or null when unknown. */
function vcDriverWord_(d) {
  if (!d || d.ambiguous) return { may_drive: null, word: 'Two Employee Database rows carry this name' };
  if (!d.found) return { may_drive: null, word: d.unread && d.unread.length ? 'Driving record unreadable' : 'No driving record' };
  if (d.driver === false) return { may_drive: false, word: 'Not a driver' };
  if (d.license_standing && d.license_standing.state === 'invalid') {
    return { may_drive: false, word: vcText_(d.license_standing.word, 60) || 'Licence not valid' };
  }
  if (d.driver === true) return { may_drive: true, word: 'Cleared to drive' };
  return { may_drive: null, word: 'No driving record' };
}

// { readable, why, map:{[key]:{may_drive, word}} } for every staff key, from employee driver + Driver Compliance.
function vcDrivers_(keys) {
  var want = (keys || []).filter(function (k) { return !!k; }).sort();
  var cacheKey = VC_DRIVERS_KEY + ':' + vcSha10_(want.join('|'));
  return vcSideCached_(cacheKey, function () {
    var out = { readable: false, why: '', map: {} };
    var read = function (tab) {
      try { return { index: spDriverIndex_(tab), why: '' }; }
      catch (e) { return { index: null, why: 'the ' + tab + ' tab could not be read (' + vcErr_(e) + ')' }; }
    };
    var main = read(SP_DRIVER_TAB), comp = read(SP_DRIVER_COMPLIANCE_TAB);
    if (!main.index && !comp.index) { out.why = [main.why, comp.why].join('; '); return out; }
    var today = vcDayOf_(vcNow_());
    want.forEach(function (k) {
      var d = null;
      try { d = spDrivingFrom_(k, main, comp, today, 0); } catch (e) { d = null; }
      out.map[k] = vcDriverWord_(d);
    });
    out.readable = true;
    out.why = [main.why, comp.why].filter(String).join('; ');
    return out;
  });
}

// ---- settings ----

function vcIntOf_(v, fallback) {
  var n = parseInt(vcStr_(v), 10);
  return isNaN(n) ? fallback : n;
}

function vcTripTypesOf_(raw) {
  var list = vcJson_(raw, null);
  if (!Array.isArray(list)) return null;
  var out = [];
  list.forEach(function (t) {
    var s = vcText_(t, 40);
    if (s && out.indexOf(s) === -1) out.push(s);
  });
  return out.length ? out : null;
}

/** Each address through userByEmail_ (merged rows skipped, the e-mail extras read), kept only when the account is live. */
function vcResolveDirectors_(raw) {
  var out = { list: [], missed: [], why: '' };
  var emails = vcStr_(raw).split(/[,;\s]+/).map(function (s) { return s.trim().toLowerCase(); })
    .filter(function (s) { return s.indexOf('@') > 0; });
  emails.forEach(function (email) {
    var u = null;
    try { u = userByEmail_(email); } catch (eU) { out.why = 'the accounts could not be read (' + vcErr_(eU) + ')'; u = null; }
    if (u && vcLive_(u)) {
      var uid = vcStr_(u.userid);
      if (!out.list.some(function (d) { return d.uid === uid; })) {
        out.list.push({ email: email, uid: uid, name: vcStr_(u.displayname) || email });
      }
    } else {
      out.missed.push(email);
    }
  });
  return out;
}

// The settings house over the shipped defaults.
function vcSettings_() {
  if (VC_MEMO.__settings) return VC_MEMO.__settings;
  var out = { readable: true, why: '', directors: [], directors_readable: false, directors_why: '',
              trip_types: vcTripTypesOf_(VC_SETTING_DEFAULTS.trip_types), text_to: {}, import_minutes: 120,
              seeded_at: '', imported_at: '', import_report: null, raw: {} };
  var kv = {};
  try {
    vcRead_(VC_TABS.settings).forEach(function (r) { kv[r.key] = r.value; });
  } catch (e) {
    out.readable = false;
    out.why = vcErr_(e);
  }
  out.raw = kv;
  out.trip_types = vcTripTypesOf_(kv.trip_types) || out.trip_types;
  var tt = vcJson_(kv.text_to, {});
  out.text_to = tt && typeof tt === 'object' && !Array.isArray(tt) ? tt : {};
  var mins = vcIntOf_(kv.import_minutes, 120);
  out.import_minutes = mins >= 15 && mins <= 720 ? mins : 120;
  out.seeded_at = vcStr_(kv.seeded_at);
  out.imported_at = vcStr_(kv.imported_at);
  out.import_report = vcJson_(kv.import_report, null);
  var raw = out.readable && vcStr_(kv.directors) ? kv.directors : VC_SETTING_DEFAULTS.directors;
  var res = vcResolveDirectors_(raw);
  out.directors = res.list;
  out.directors_readable = res.list.length > 0;
  var whys = [];
  if (!out.readable) whys.push('The Transportation settings could not be read, so the shipped list is used (' + out.why + ').');
  if (res.why) whys.push('The ' + res.why + '.');
  if (res.missed.length) whys.push('No live account answers ' + res.missed.join(', ') + '.');
  if (!res.list.length && !res.missed.length && !res.why) whys.push('No directors are written in the Transportation settings.');
  out.directors_why = whys.join(' ');
  VC_MEMO.__settings = out;
  return out;
}

function vcSettingsPublic_() {
  var s = vcSettings_();
  return { readable: s.readable, why: s.why,
           directors: s.directors.map(function (d) { return { uid: d.uid, name: d.name, email: d.email }; }),
           directors_readable: s.directors_readable, directors_why: s.directors_why, trip_types: s.trip_types,
           text_to: Object.keys(s.text_to).map(function (uid) { return { uid: uid, to: vcPhoneWords_(s.text_to[uid]) }; }),
           import_minutes: s.import_minutes, seeded: !!s.seeded_at, seeded_at: s.seeded_at, imported_at: s.imported_at };
}

// ---- the gate ----

function vcVisiting_(user) {
  return !!(!user || user.is_service || user.visiting_member ||
            (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX));
}

function vcUserName_(user) {
  return vcStr_(user && (user.display_name != null ? user.display_name : user.displayname)) || vcStr_(user && user.email);
}

/** { open, uid, name, email, key, is_master, is_director, can_edit, visiting } — closed reads as Unknown action. */
function vcGate_(user) {
  var g = { open: false, uid: '', name: '', email: '', key: '', is_master: false, is_director: false, can_edit: false,
            visiting: true };
  var got = null;
  try { got = hubProfileAppGate_(VC_APP_ID, user); } catch (e) { got = null; }
  if (!got || !got.open) return g;
  g.open = true;
  g.uid = hubActingUserId_(user);
  g.name = vcUserName_(user);
  g.email = vcStr_(user && user.email).toLowerCase();
  g.visiting = vcVisiting_(user);
  try { g.is_master = !!hubIsRealMaster_(user); } catch (eM) { g.is_master = false; }
  var st = null;
  try { st = vcSettings_(); } catch (eS) { st = null; }
  g.is_director = !!(st && g.uid && st.directors.some(function (d) { return d.uid === g.uid; }));
  g.can_edit = g.is_master || g.is_director;
  try {
    var me = vcPeople_().byUid[g.uid];
    g.key = me ? me.key : '';
  } catch (eP) { g.key = ''; }
  return g;
}

// FAIL-CLOSED: from a client's page — its trips to the app's editors, and to a clients.transportation holder who reads it.
function vcClientGate_(g, user, clientKey) {
  if (!clientKey) return g;
  var lent = false;
  if (!g.can_edit) {
    var shut = true;
    try { shut = cpProfileEditDoor_({ client: clientKey }, user, CP_EDITION_TRANSPORT); } catch (e) { shut = true; }
    if (shut) return g;
    lent = !g.open;
  }
  var h = {};
  for (var k in g) h[k] = g[k];
  h.client = clientKey;
  if (!lent) return h;
  h.open = true;
  h.lent = true;
  h.uid = hubActingUserId_(user);
  h.name = vcUserName_(user);
  h.email = vcStr_(user && user.email).toLowerCase();
  h.visiting = vcVisiting_(user);
  try {
    var me = vcPeople_().byUid[h.uid];
    h.key = me ? me.key : '';
  } catch (eP) { h.key = ''; }
  return h;
}

// ---- vehicles and trips as the board shows them ----

function vcVehicleDetails_(description, seats, accessible) {
  var parts = [];
  if (vcStr_(description)) parts.push(vcStr_(description));
  if (seats) parts.push(seats + ' seat' + (seats === 1 ? '' : 's'));
  if (accessible) parts.push('Wheelchair accessible');
  return parts.join(' · ');
}

function vcAvailabilityOf_(v) {
  var a = vcStr_(v).toLowerCase();
  return VC_AVAILABILITY.indexOf(a) === -1 ? 'available' : a;
}

function vcAliasesOf_(r) {
  var out = [];
  [r && r.name].concat(vcStr_(r && r.aliases).split('|')).forEach(function (a) {
    var s = vcStr_(a);
    if (s && out.indexOf(s) === -1) out.push(s);
  });
  return out;
}

function vcVehicleOut_(r) {
  var seats = vcIntOf_(r.seats, 0);
  var acc = vcYes_(r.wheelchair_accessible);
  return { id: vcStr_(r.id), name: vcStr_(r.name), description: vcStr_(r.description), seats: seats,
           wheelchair_accessible: acc, availability: vcAvailabilityOf_(r.availability),
           tint: VC_TINTS.indexOf(vcStr_(r.tint)) === -1 ? 'blue' : vcStr_(r.tint), order: Number(r.order) || 0,
           details: vcVehicleDetails_(r.description, seats, acc), note: vcStr_(r.note) };
}

function vcVehicleIndex_(rows) {
  var by = {};
  (rows || []).forEach(function (r) { by[vcStr_(r.id)] = r; });
  return by;
}

function vcTripOut_(t, vById) {
  var s = vcMs_(t.start_at), e = vcMs_(t.end_at);
  var veh = vById[t.vehicle_id], req = vById[t.requested_vehicle_id];
  return {
    id: t.id, state: VC_STATES.indexOf(t.state) === -1 ? 'requested' : t.state,
    vehicle_id: t.vehicle_id, vehicle_name: veh ? vcStr_(veh.name) : '',
    requested_vehicle_id: t.requested_vehicle_id, requested_vehicle_name: req ? vcStr_(req.name) : '',
    start_at: t.start_at, end_at: t.end_at, day: t.day,
    start_label: isNaN(s) ? '' : vcHm_(s), end_label: isNaN(e) ? '' : vcHm_(e), end_known: t.end_known !== 'no',
    wheelchair_required: vcYes_(t.wheelchair_required), trip_type: t.trip_type, purpose: t.purpose,
    destination: t.destination, details: t.details, client_key: t.client_key, client_name: t.client_name,
    staff_key: t.staff_key, staff_name: t.staff_name, driver_key: t.driver_key, driver_name: t.driver_name,
    requested_by: { uid: t.requested_by_uid, name: t.requested_by_name },
    decided_by: t.decided_by_name, decided_at: t.decided_at, decision_note: t.decision_note, assign_note: t.assign_note,
    source: t.source, test_mode: t.test_mode === 'yes', created_at: t.created_at, updated_at: t.updated_at
  };
}

/** The word and tone of a trip at `nowMs`: In use and Completed are read off a scheduled trip, never stored. */
function vcTripWord_(t, nowMs) {
  if (t.state === 'scheduled') {
    var sp = vcSpanOf_(t);
    if (!isNaN(sp.e) && sp.e <= nowMs) return { word: 'Completed', tone: 'grey' };
    if (!isNaN(sp.s) && sp.s <= nowMs) return { word: 'In use', tone: 'mint' };
    return { word: 'Scheduled', tone: 'blue' };
  }
  if (t.state === 'needs_assignment') return { word: 'Needs assignment', tone: 'peach' };
  if (t.state === 'declined') return { word: 'Declined', tone: 'rose' };
  if (t.state === 'cancelled') return { word: 'Cancelled', tone: 'grey' };
  return { word: 'Requested', tone: 'amber' };
}

function vcVehicleStatus_(v, active) {
  if (v.availability === 'maintenance') return { word: 'Maintenance', tone: 'peach' };
  if (v.availability === 'out_of_service') return { word: 'Out of service', tone: 'grey' };
  if (active) return { word: 'In use', tone: 'amber' };
  return { word: 'Available', tone: 'mint' };
}

// ---- the board: the houses built once per version, cached in chunks, cut per viewer after the cache ----

function vcSource_(key, state, why, count) {
  return { key: key, state: state ? 'ready' : 'unreadable', why: vcStr_(why), count: count };
}

/** Everything nobody's eyes change: vehicles, the last 400 days of trips, who each request waits on, the settings. */
function vcBuildBase_() {
  var rows = vcRows_();
  var st = vcSettings_();
  var today = vcDayOf_(vcNow_());
  var from = vcIsoAdd_(today, -VC_HISTORY_DAYS);
  var vById = vcVehicleIndex_(rows.vehicles);
  var vehicles = rows.vehicles.map(vcVehicleOut_).sort(function (a, b) {
    return a.order - b.order || a.name.localeCompare(b.name);
  });
  var trips = rows.trips.filter(function (t) { return !t.day || t.day >= from; }).map(function (t) {
    return vcTripOut_(t, vById);
  }).sort(function (a, b) { return a.start_at < b.start_at ? -1 : (a.start_at > b.start_at ? 1 : 0); });
  var waiting = (rows.inbox || []).filter(function (r) { return r.box === 'work' && r.state === 'waiting'; })
    .map(function (r) {
      return { id: r.id, trip_id: r.trip_id, seat: vcStr_(r.seat), to_uid: r.to_uid, to_name: r.to_name };
    });
  return {
    vehicles: vehicles, trips: trips, waiting: waiting,
    settings: { directors: st.directors.map(function (d) { return { uid: d.uid, name: d.name }; }),
                directors_readable: st.directors_readable, directors_why: st.directors_why, trip_types: st.trip_types,
                seeded: !!st.seeded_at, imported_at: st.imported_at },
    sources: [vcSource_('vehicles', true, '', vehicles.length), vcSource_('trips', true, '', trips.length),
              vcSource_('inbox', !!rows.inbox, rows.inbox_why, rows.inbox ? rows.inbox.length : 0),
              vcSource_('settings', st.readable, st.why, Object.keys(st.raw || {}).length)],
    degraded: !rows.inbox || !st.readable
  };
}

function vcBoardBase_() {
  var v = vcVersion_();
  var key = 'vc_board2:' + v;
  if (VC_BOARD_MEMO[key]) return VC_BOARD_MEMO[key];
  var got = v ? vcCacheGet_(key) : null;
  if (!got) {
    got = vcBuildBase_();
    if (v && !got.degraded) vcCachePut_(key, got);
  }
  VC_BOARD_MEMO[key] = got;
  return got;
}

function vcCopy_(v) { return JSON.parse(JSON.stringify(v)); }

/** The private shape of somebody else's trip: when and on what, never who or why. */
function vcTripPrivate_(t, w) {
  return { id: t.id, state: t.state, word: w.word, tone: w.tone, vehicle_id: t.vehicle_id, vehicle_name: t.vehicle_name,
           start_at: t.start_at, end_at: t.end_at, day: t.day, start_label: t.start_label, end_label: t.end_label,
           private: true, mine: false };
}

/** The viewer's cut of a cached base: privacy, the waiting items, the KPIs and every word read at `nowMs`. */
function vcCut_(base, g, nowMs) {
  var waitOn = {};
  base.waiting.forEach(function (w) { (waitOn[w.trip_id] = waitOn[w.trip_id] || []).push(w); });
  var trips = base.trips.map(function (t) {
    var w = vcTripWord_(t, nowMs);
    var mine = !!(g.uid && t.requested_by && t.requested_by.uid === g.uid);
    if (!g.can_edit && !mine && !(g.client && t.client_key === g.client)) return vcTripPrivate_(t, w);
    var o = vcCopy_(t);
    o.word = w.word;
    o.tone = w.tone;
    o.mine = mine;
    if (t.state === 'requested') {
      o.seats = [{ to: (waitOn[t.id] || []).map(function (x) { return x.to_name; }), state: 'waiting', by: '', at: '' }];
    }
    return o;
  });
  var vehicles = base.vehicles.map(function (v) {
    var o = vcCopy_(v);
    delete o.note;
    var active = null, next = null;
    base.trips.forEach(function (t) {
      if (t.state !== 'scheduled' || t.vehicle_id !== v.id) return;
      var sp = vcSpanOf_(t);
      if (sp.s <= nowMs && nowMs < sp.e) active = active || t;
      else if (sp.s > nowMs && (!next || sp.s < vcMs_(next.start_at))) next = t;
    });
    o.status = vcVehicleStatus_(v, active);
    if (active) o.active_trip = { id: active.id, start_at: active.start_at, end_at: active.end_at };
    if (next) o.next_trip = { id: next.id, start_at: next.start_at, end_at: next.end_at };
    return o;
  });
  var kpis = { needs_assignment: 0, scheduled: 0, in_service: 0 };
  base.trips.forEach(function (t) {
    var e = vcMs_(t.end_at);
    if (!(e > nowMs)) return;
    if (t.state === 'requested' || t.state === 'needs_assignment') kpis.needs_assignment++;
    else if (t.state === 'scheduled') kpis.scheduled++;
  });
  base.vehicles.forEach(function (v) { if (v.availability === 'available') kpis.in_service++; });
  var waitRows = [];
  if (g.uid) {
    var held = {};
    base.waiting.forEach(function (w) { if (w.to_uid === g.uid) { waitRows.push(w); held[w.trip_id] = true; } });
    // the master stands in on a director seat of every request the master did not file
    if (g.is_master && !g.visiting) {
      base.trips.forEach(function (t) { if (t.requested_by && t.requested_by.uid === g.uid) held[t.id] = true; });
      base.waiting.forEach(function (w) {
        if (w.seat !== 'director' || held[w.trip_id]) return;
        held[w.trip_id] = true;
        waitRows.push(w);
      });
    }
  }
  var waiting = waitRows.map(function (w) { return { item_id: w.id, trip_id: w.trip_id }; });
  return { trips: trips, vehicles: vehicles, kpis: kpis, waiting: waiting };
}

/** The whole board for one viewer: the cached base cut at this instant, plus the pickers from their own caches. */
function vcBoard_(g) {
  var nowMs = vcNow_();
  var base = vcBoardBase_();
  var cut = vcCut_(base, g, nowMs);
  var people = vcPeople_(), clients = vcClients_();
  var sources = base.sources.slice();
  sources.push(vcSource_('people', people.readable, people.why, (people.rows || []).length));
  sources.push(vcSource_('clients', clients.readable, clients.why, (clients.rows || []).length));
  var out = {
    ok: true, now: vcIso_(nowMs), today: vcDayOf_(nowMs), stamp: vcStamp_(nowMs),
    viewer: { uid: g.uid, name: g.name, is_master: g.is_master, is_director: g.is_director,
              can_edit: g.can_edit, can_request: !!(g.open && !g.lent && !g.visiting && base.settings.directors_readable),
              visiting: g.visiting, client: g.client || '' },
    test_mode: vcTestMode_(), settings: base.settings,
    vehicles: cut.vehicles, trips: cut.trips, kpis: cut.kpis,
    people: (people.rows || []).filter(function (p) { return !p.unlisted; })
      .map(function (p) { return { key: p.key, uid: p.uid, name: p.name }; }),
    // a holder's trip stays with its client: the picker names that client alone
    clients: (clients.rows || []).filter(function (c) { return g.can_edit || !g.client || c.key === g.client; }),
    waiting: cut.waiting, sources: sources, note: ''
  };
  if (g.can_edit || g.client) {
    var drivers = vcDrivers_((people.rows || []).map(function (p) { return p.key; }));
    out.drivers = drivers.map || {};
    sources.push(vcSource_('drivers', drivers.readable, drivers.why, Object.keys(drivers.map || {}).length));
  }
  var down = sources.filter(function (s) { return s.state !== 'ready'; });
  if (down.length) {
    out.note = 'Not everything could be read: ' + down.map(function (s) { return s.key + ' (' + s.why + ')'; }).join('; ') + '.';
  }
  return out;
}

function vcFail_(e) {
  var msg = vcErr_(e);
  try { hubSysLog_('asa-hub:transportation', 'transportation_unreadable', msg, { status: 503 }); } catch (eL) {}
  return vcRefuse_(503, /^The Transportation house/.test(msg) ? msg
    : 'The vehicle calendar could not be read or written just now (' + msg + ') — nothing was changed.');
}

/** A write's answer, built after the lock is let go: the sentence, the ids, warnings, and the viewer's fresh board. */
function vcAnswerAfter_(g, done) {
  if (!done || done.status) return done || vcRefuse_(503, 'The vehicle calendar did not answer just now — try again.');
  var data = { ok: true, said: done.said };
  ['trip_id', 'vehicle_id', 'warnings', 'report', 'dry_run', 'settings', 'state', 'changed'].forEach(function (k) {
    if (done[k] !== undefined && done[k] !== null) data[k] = done[k];
  });
  if (data.warnings && !data.warnings.length) delete data.warnings;
  try { data.board = vcBoard_(g); }
  catch (e) { data.reread = 'Saved — but the calendar could not be read back just now; refresh to see it.'; }
  return { status: 200, data: data };
}

function vcLogRow_(g, tripId, vehicleId, via, was, now, note) {
  return { id: vcNewId_('VL'), at: vcNowIso_(), by_uid: g ? g.uid : 'system', by_name: g ? g.name : 'Transportation',
           trip_id: tripId || '', vehicle_id: vehicleId || '', via: via,
           was: was === '' || was === undefined ? '' : JSON.stringify(was),
           now: now === '' || now === undefined ? '' : JSON.stringify(now), note: vcText_(note, 500) };
}

// ---- the board ----

HUB_POLICY.vehicleCalendarBoard = {
  file: 'VehicleCalendar.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' } }
};
/** Transportation's one big read: vehicles, trips, the viewer's waiting approvals and the pickers, cut per viewer. */
HUB_ACTIONS.vehicleCalendarBoard = function (payload, user) {
  var g = vcClientGate_(vcGate_(user), user, vcText_(payload && payload.client, 120));
  if (!g.open) return vcClosed_();
  try {
    return { status: 200, data: vcBoard_(g) };
  } catch (e) {
    return vcFail_(e);
  }
};

// ---- vehicles ----

function vcVehicleByName_(rows, name, exceptId) {
  var want = vcStr_(name).toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (vcStr_(rows[i].id) !== exceptId && vcStr_(rows[i].name).toLowerCase() === want) return rows[i];
  }
  return null;
}

// Scheduled trips on a vehicle that is no longer fit for them go back to Needs assignment: every future trip when…
function vcUnassignForVehicle_(g, vehicle, why, onlyWheelchair, nowMs) {
  var moved = [];
  vcRead_(VC_TABS.trips).forEach(function (t) {
    if (t.state !== 'scheduled' || t.vehicle_id !== vehicle.id) return;
    if (!(vcMs_(t.end_at) > nowMs)) return;
    if (onlyWheelchair && !vcYes_(t.wheelchair_required)) return;
    var was = { state: t.state, vehicle_id: t.vehicle_id };
    t.state = 'needs_assignment';
    t.vehicle_id = '';
    t.assign_note = why;
    t.updated_at = vcNowIso_();
    t.updated_by = g.uid;
    moved.push({ trip: t, was: was });
  });
  if (!moved.length) return 0;
  vcUpsert_(VC_TABS.trips, moved.map(function (m) { return m.trip; }));
  vcAppend_(VC_TABS.log, moved.map(function (m) {
    return vcLogRow_(g, m.trip.id, vehicle.id, 'unassigned_by_vehicle', m.was,
                     { state: 'needs_assignment', vehicle_id: '' }, why);
  }));
  return moved.length;
}

HUB_POLICY.vehicleCalendarVehicleSave = {
  file: 'VehicleCalendar.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { vehicle_id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
            seats: { type: 'number' }, wheelchair_accessible: { type: 'boolean' },
            availability: { type: 'string' }, note: { type: 'string' } }
};
/** Add or edit a vehicle (the directors and the master); leaving service returns its trips to Needs assignment. */
HUB_ACTIONS.vehicleCalendarVehicleSave = function (payload, user) {
  var g = vcGate_(user);
  if (!g.open) return vcClosed_();
  if (g.visiting) return vcRefuse_(403, VC_VISITING_SENTENCE);
  if (!g.can_edit) return vcRefuse_(403, 'Only the directors manage vehicles.');
  var p = payload || {};
  var vid = vcText_(p.vehicle_id, 20);
  var name = vcText_(p.name, 200);
  var description = vcText_(p.description, 200);
  var seats = Number(p.seats);
  var availability = vcStr_(p.availability).toLowerCase() || 'available';
  var note = p.note === undefined || p.note === null ? null : vcText_(p.note, 1000);
  if (vid && !/^VV[0-9A-F]{10}$/.test(vid)) return vcRefuse_(400, 'Which vehicle? The id is not one this app writes.');
  if (!name) return vcRefuse_(400, 'Give the vehicle a name.');
  if (name.length > 40) return vcRefuse_(400, 'A vehicle name can be at most 40 characters.');
  if (description.length > 120) return vcRefuse_(400, 'The description can be at most 120 characters.');
  if (!(seats >= 1 && seats <= 60) || Math.round(seats) !== seats) return vcRefuse_(400, 'Seats are a whole number from 1 to 60.');
  if (VC_AVAILABILITY.indexOf(availability) === -1) return vcRefuse_(400, 'Availability is Available, Maintenance or Out of service.');
  if (note !== null && note.length > 500) return vcRefuse_(400, 'A note can be at most 500 characters.');
  var accessible = p.wheelchair_accessible === true || vcYes_(p.wheelchair_accessible);
  try {
    var done = vcLock_(function () {
      var nowMs = vcNow_(), nowIso = vcNowIso_();
      var rows = vcRead_(VC_TABS.vehicles);
      var was = vid ? vcVehicleIndex_(rows)[vid] : null;
      if (vid && !was) return vcRefuse_(404, 'That vehicle is not on the list any more.');
      if (vcVehicleByName_(rows, name, vid)) return vcRefuse_(409, 'Another vehicle is already called ' + name + '.');
      var row;
      if (was) {
        row = vcCopy_(was);
      } else {
        var used = rows.map(function (r) { return vcStr_(r.tint); });
        var tint = VC_TINTS.filter(function (t) { return used.indexOf(t) === -1; })[0] || VC_TINTS[rows.length % VC_TINTS.length];
        var order = 0;
        rows.forEach(function (r) { order = Math.max(order, Number(r.order) || 0); });
        row = { id: vcNewId_('VV'), aliases: name, tint: tint, order: String(order + 1), created_at: nowIso };
      }
      var before = was ? { name: was.name, description: was.description, seats: was.seats,
                           wheelchair_accessible: was.wheelchair_accessible, availability: vcAvailabilityOf_(was.availability),
                           note: was.note } : '';
      row.name = name;
      row.description = description;
      row.seats = String(seats);
      row.wheelchair_accessible = vcWord_(accessible);
      row.availability = availability;
      if (note !== null) row.note = note;
      else if (!was) row.note = '';
      if (was && vcAliasesOf_(was).indexOf(name) === -1) row.aliases = vcAliasesOf_(was).concat([name]).join('|');
      row.updated_at = nowIso;
      row.updated_by = g.uid;
      vcUpsert_(VC_TABS.vehicles, [row]);
      vcAppend_(VC_TABS.log, [vcLogRow_(g, '', row.id, was ? 'vehicle_edit' : 'vehicle_add', before, {
        name: name, description: description, seats: String(seats), wheelchair_accessible: row.wheelchair_accessible,
        availability: availability, note: row.note }, '')]);
      var moved = 0;
      if (availability !== 'available') {
        moved += vcUnassignForVehicle_(g, row, availability === 'maintenance'
          ? 'The ' + name + ' went into maintenance — choose another vehicle.'
          : 'The ' + name + ' was taken out of service — choose another vehicle.', false, nowMs);
      }
      if (!accessible) {
        moved += vcUnassignForVehicle_(g, row, 'The ' + name + ' is no longer marked wheelchair accessible — choose ' +
                                       'another vehicle.', true, nowMs);
      }
      var said = moved ? 'Saved. ' + moved + ' scheduled trip' + (moved === 1 ? '' : 's') + ' went back to Needs assignment.'
                       : 'Saved.';
      return { said: said, vehicle_id: row.id };
    });
    if (!done || done.status) return done || vcFail_('no answer from the lock');
    try { hubSysLog_(vcStr_(user && user.email), 'vehicleCalendarVehicleSave', done.vehicle_id, { status: 200 }); } catch (eL) {}
    return vcAnswerAfter_(g, done);
  } catch (e) {
    return vcFail_(e);
  }
};

// ---- settings (the master) ----

var VC_SETTABLE = {
  directors: function (v) {
    var list = vcStr_(v).split(/[,;\s]+/).filter(function (s) { return s; });
    if (!list.length || list.some(function (s) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); })) {
      return { error: 'Directors are e-mail addresses, separated by commas.' };
    }
    var res = vcResolveDirectors_(list.join(', '));
    if (res.why) return { error: 'The ' + res.why + '.' };
    if (res.missed.length) return { error: 'No live account answers ' + res.missed.join(', ') + '.' };
    return { value: list.map(function (s) { return s.toLowerCase(); }).join(', ') };
  },
  trip_types: function (v) {
    var list = Array.isArray(v) ? v : vcJson_(v, null);
    if (!Array.isArray(list)) list = vcStr_(v).split(/\s*[\n;]\s*/);
    var out = [];
    list.forEach(function (t) { var s = vcText_(t); if (s && out.indexOf(s) === -1) out.push(s); });
    if (!out.length || out.length > 20 || out.some(function (s) { return s.length > 40; })) {
      return { error: 'Trip types are 1 to 20 names of at most 40 characters.' };
    }
    return { value: JSON.stringify(out) };
  },
  text_to: function (v) {
    var map = v && typeof v === 'object' && !Array.isArray(v) ? v : vcJson_(v, null);
    if (!map || typeof map !== 'object' || Array.isArray(map)) return { error: 'Text numbers are a map of account to number.' };
    var out = {}, bad = [];
    Object.keys(map).forEach(function (uid) {
      var id = vcStr_(uid);
      if (!vcStr_(map[uid])) return;
      var n = packetSendableNumber_(map[uid]);
      if (!n || !vcAccount_(id)) bad.push(id);
      else out[id] = n;
    });
    if (bad.length) return { error: 'These need a live account and a number this platform may text: ' + bad.join(', ') + '.' };
    return { value: JSON.stringify(out) };
  },
  import_minutes: function (v) {
    var n = vcIntOf_(v, -1);
    return n >= 15 && n <= 720 ? { value: String(n) } : { error: 'The assumed length is 15 to 720 minutes.' };
  }
};

HUB_POLICY.vehicleCalendarSettingsSet = {
  file: 'VehicleCalendar.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { values: { type: 'object' } }
};
/** The master's settings: the directors who approve, the trip types, an approver's text number, the import length. */
HUB_ACTIONS.vehicleCalendarSettingsSet = function (payload, user) {
  var g = vcGate_(user);
  if (!g.open) return vcClosed_();
  if (!g.is_master || g.visiting) return vcRefuse_(403, 'Only the master changes the Transportation settings.');
  var values = (payload && payload.values) || {};
  var rows = [], bad = [];
  try {
    Object.keys(values).forEach(function (k) {
      if (!VC_SETTABLE[k]) { bad.push(k + ' is not a setting this screen changes.'); return; }
      var got = VC_SETTABLE[k](values[k]);
      if (got.error) bad.push(got.error);
      else rows.push({ key: k, value: got.value, note: '', updated_at: vcNowIso_(), updated_by: g.uid });
    });
  } catch (eV) { return vcFail_(eV); }
  if (bad.length) return vcRefuse_(400, bad.join(' '));
  if (!rows.length) return vcRefuse_(400, 'Nothing to change.');
  try {
    var done = vcLock_(function () {
      vcUpsert_(VC_TABS.settings, rows);
      vcAppend_(VC_TABS.log, [vcLogRow_(g, '', '', 'settings', '', rows.map(function (r) { return r.key; }), '')]);
      vcMemoDrop_();
      return { said: 'Saved.', settings: vcSettingsPublic_() };
    });
    return vcAnswerAfter_(g, done);
  } catch (e) {
    return vcFail_(e);
  }
};

// ---- the seed (the master; a dry run first) ----

function vcSeedId_(name) { return 'VV' + vcSha10_('seed|' + vcStr_(name).toLowerCase()); }

/** Pure: what the seed would add, given the vehicles and settings already there. Nothing present is rewritten. */
function vcSeedPlan_(vehicleRows, settingsKv, nowIso, by) {
  var report = { vehicles: { add: [], kept: [] }, settings: { add: [], kept: [] } };
  var vehicles = [], settings = [];
  var ids = vcVehicleIndex_(vehicleRows);
  VC_SEED_VEHICLES.forEach(function (s) {
    var id = vcSeedId_(s.name);
    if (ids[id] || vcVehicleByName_(vehicleRows, s.name, '')) { report.vehicles.kept.push(s.name); return; }
    report.vehicles.add.push(s.name);
    vehicles.push({ id: id, name: s.name, description: s.description, seats: String(s.seats),
                    wheelchair_accessible: s.wheelchair_accessible, availability: s.availability, aliases: s.aliases,
                    tint: s.tint, order: String(s.order), note: '', created_at: nowIso, updated_at: nowIso,
                    updated_by: by });
  });
  Object.keys(VC_SETTING_DEFAULTS).forEach(function (k) {
    if (vcStr_(settingsKv[k])) { report.settings.kept.push(k); return; }
    report.settings.add.push(k);
    settings.push({ key: k, value: VC_SETTING_DEFAULTS[k], note: 'seed', updated_at: nowIso, updated_by: by });
  });
  if (vcStr_(settingsKv.seeded_at)) report.settings.kept.push('seeded_at');
  else report.settings.add.push('seeded_at');
  return { report: report, vehicles: vehicles, settings: settings };
}

HUB_POLICY.vehicleCalendarSeed = {
  file: 'VehicleCalendar.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { dry_run: { type: 'boolean' } }
};
/** The master's seed: the Van, the Mazda and the Ford and the default settings. A dry run unless dry_run is false. */
HUB_ACTIONS.vehicleCalendarSeed = function (payload, user) {
  var g = vcGate_(user);
  if (!g.open) return vcClosed_();
  if (!g.is_master || g.visiting) return vcRefuse_(403, 'Only the master seeds the vehicles.');
  var dry = !(payload && payload.dry_run === false);
  try {
    var kv = function () {
      var out = {};
      vcRead_(VC_TABS.settings).forEach(function (r) { out[r.key] = r.value; });
      return out;
    };
    if (dry) {
      var plan = vcSeedPlan_(vcRead_(VC_TABS.vehicles), kv(), vcNowIso_(), g.uid);
      return { status: 200, data: { ok: true, dry_run: true, report: plan.report,
                                    said: 'Dry run: nothing was written. ' + plan.report.vehicles.add.length +
                                          ' vehicle(s) and ' + plan.report.settings.add.length + ' setting(s) to add.' } };
    }
    var done = vcLock_(function () {
      var nowIso = vcNowIso_();
      var p = vcSeedPlan_(vcRead_(VC_TABS.vehicles), kv(), nowIso, g.uid);
      if (p.vehicles.length) vcUpsert_(VC_TABS.vehicles, p.vehicles);
      var srows = p.settings.slice();
      if (p.report.settings.add.indexOf('seeded_at') !== -1) {
        srows.push({ key: 'seeded_at', value: nowIso, note: 'seed', updated_at: nowIso, updated_by: g.uid });
      }
      if (srows.length) vcUpsert_(VC_TABS.settings, srows);
      vcAppend_(VC_TABS.log, [vcLogRow_(g, '', '', 'seed', '', p.report, '')]);
      vcMemoDrop_();
      return { said: 'Seeded: ' + p.report.vehicles.add.length + ' vehicle(s) and ' + p.report.settings.add.length +
                     ' setting(s) added; nothing already there was rewritten.', report: p.report, dry_run: false };
    });
    return vcAnswerAfter_(g, done);
  } catch (e) {
    return vcFail_(e);
  }
};

// ---- the Van Calendar, imported once and never written back (the master; a dry run first) ----

function vcPad2_(n) { return ('0' + n).slice(-2); }

/** The Van Calendar's timestamp (M/D/YYYY H:mm:ss on the Eastern clock) as an instant, or '' when it does not read. */
function vcBookStampIso_(raw) {
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/.exec(vcStr_(raw));
  if (!m) return '';
  var got = vcWallToMs_(m[3] + '-' + vcPad2_(+m[1]) + '-' + vcPad2_(+m[2]) + 'T' + vcPad2_(+m[4]) + ':' + m[5]);
  return got.ms ? new Date(got.ms).toISOString() : '';
}

// Pure over what it is handed: the Van Calendar book (already realigned by csTransportRequests_), the vehicles, the…
function vcImportPlan_(book, vehicleRows, tripRows, clients, people, minutes, nowMs) {
  var report = { read: book.total || 0, realigned: book.realigned || 0, unread: book.unread || 0, add: 0, already: 0,
                 skipped: [], conflicts: [], end_assumed: 0, vehicles_unmatched: [], clients_unmatched: [],
                 first_day: '', last_day: '', from_today: 0 };
  var alias = {};
  vehicleRows.forEach(function (v) {
    vcAliasesOf_(v).forEach(function (a) { var k = csTransportBaseKey_(a); if (k && !alias[k]) alias[k] = v; });
  });
  var have = {}, busy = {};
  tripRows.forEach(function (t) {
    if (t.source_ref) have[t.source_ref] = true;
    if (t.state === 'scheduled' && t.vehicle_id) (busy[t.vehicle_id] = busy[t.vehicle_id] || []).push(vcSpanOf_(t));
  });
  var known = {};
  ((clients && clients.rows) || []).forEach(function (c) { known[c.key] = c; });
  var staff = (people && people.byKey) || {};
  var cand = [];
  (book.requests || []).forEach(function (r) {
    var ref = 'van_calendar:r' + r.row;
    if (have[ref]) { report.already++; return; }
    var v = alias[csTransportBaseKey_(r.vehicle)];
    if (!v) {
      var nm = vcStr_(r.vehicle) || '(blank)';
      if (report.vehicles_unmatched.indexOf(nm) === -1) report.vehicles_unmatched.push(nm);
      report.skipped.push({ row: r.row, why: 'no vehicle on the list is called ' + nm });
      return;
    }
    var sMin = csTransportClock_(r.start);
    if (sMin === null) { report.skipped.push({ row: r.row, why: 'no start time' }); return; }
    var s = vcWallToMs_(r.date + 'T' + vcPad2_(Math.floor(sMin / 60)) + ':' + vcPad2_(sMin % 60));
    if (!s.ms) { report.skipped.push({ row: r.row, why: s.message }); return; }
    var eMin = csTransportClock_(r.end);
    var e = eMin !== null && eMin > sMin ? vcWallToMs_(r.date + 'T' + vcPad2_(Math.floor(eMin / 60)) + ':' + vcPad2_(eMin % 60)) : null;
    var assumed = !(e && e.ms);
    cand.push({ r: r, ref: ref, v: v, s: s.ms, e: assumed ? s.ms + minutes * 60000 : e.ms, assumed: assumed });
  });
  cand.sort(function (a, b) { return a.s - b.s || a.r.row - b.r.row; });
  var today = vcDayOf_(nowMs), nowIso = new Date(nowMs).toISOString();
  var trips = [];
  cand.forEach(function (c) {
    var list = busy[c.v.id] || (busy[c.v.id] = []);
    var span = { s: c.s, e: c.e };
    var clash = list.some(function (b) { return vcOverlap_(span, b); });
    if (!clash) list.push(span);
    var ck = clientNameKey_(c.r.client);
    var client = known[ck] || null;
    if (!client && vcStr_(c.r.client) && report.clients_unmatched.indexOf(vcStr_(c.r.client)) === -1) {
      report.clients_unmatched.push(vcStr_(c.r.client));
    }
    var sk = clientNameKey_(c.r.staff);
    var person = sk ? staff[sk] || null : null;
    var day = vcDayOf_(c.s);
    trips.push({
      id: 'VT' + vcSha10_(c.ref), state: clash ? 'needs_assignment' : 'scheduled', vehicle_id: clash ? '' : c.v.id,
      requested_vehicle_id: c.v.id, start_at: vcIso_(c.s), end_at: vcIso_(c.e), day: day,
      end_known: c.assumed ? 'no' : 'yes', wheelchair_required: vcYes_(c.v.wheelchair_accessible) ? 'yes' : 'no',
      trip_type: '', purpose: vcText_(c.r.reason, 200), destination: vcText_(c.r.destination, 300), details: '',
      client_key: client ? client.key : '', client_name: vcText_(c.r.client, 120),
      staff_key: person ? person.key : '', staff_uid: person ? person.uid : '', staff_name: vcText_(c.r.staff, 120),
      driver_key: person ? person.key : '', driver_uid: person ? person.uid : '', driver_name: vcText_(c.r.staff, 120),
      requested_by_uid: '', requested_by_name: 'Van Calendar', decided_by_uid: '', decided_by_name: '', decided_at: '',
      decision_note: '', assign_note: clash ? 'Overlapped another Van Calendar booking' : '', appointment_ref: '',
      source: 'import:van_calendar', source_ref: c.ref, told: '{}', test_mode: 'no',
      created_at: vcBookStampIso_(c.r.requested_at) || nowIso, created_by: 'import', updated_at: nowIso,
      updated_by: 'import'
    });
    report.add++;
    if (c.assumed) report.end_assumed++;
    if (day >= today) report.from_today++;
    if (!report.first_day || day < report.first_day) report.first_day = day;
    if (!report.last_day || day > report.last_day) report.last_day = day;
  });
  (book.conflicts || []).forEach(function (cf) {
    trips.forEach(function (t) {
      if (t.day !== cf.date) return;
      var names = {};
      csTransportNameKeys_(t.client_name).forEach(function (k) { names[k] = true; });
      if (!csTransportListNames_(names, cf.clients)) return;
      var note = 'Van Calendar conflict (' + (vcStr_(cf.status) || 'Listed') + (cf.time ? ', ' + vcStr_(cf.time) : '') + ')' +
                 (cf.notes ? ': ' + vcText_(cf.notes, 200) : '');
      t.assign_note = t.assign_note ? t.assign_note + ' · ' + note : note;
      report.conflicts.push({ row: cf.row, with: t.source_ref, note: note });
    });
  });
  return { trips: trips, report: report };
}

HUB_POLICY.vehicleCalendarImport = {
  file: 'VehicleCalendar.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { dry_run: { type: 'boolean' } }
};
/** The master's one-time import of the Van Calendar's trips; never written back. A dry run unless dry_run is false. */
HUB_ACTIONS.vehicleCalendarImport = function (payload, user) {
  var g = vcGate_(user);
  if (!g.open) return vcClosed_();
  if (!g.is_master || g.visiting) return vcRefuse_(403, 'Only the master imports the Van Calendar.');
  var dry = !(payload && payload.dry_run === false);
  try {
    var book = csTransportBook_();
    if (!book || book.requests === null) {
      return vcRefuse_(503, 'The Van Calendar could not be read: ' + vcStr_(book && book.requests_why) + '.');
    }
    var people = vcPeople_(), clients = vcClients_(), st = vcSettings_();
    var nowMs = vcNow_();
    if (dry) {
      var plan = vcImportPlan_(book, vcRead_(VC_TABS.vehicles), vcRead_(VC_TABS.trips), clients, people,
                               st.import_minutes, nowMs);
      if (!clients.readable) plan.report.clients_why = clients.why;
      return { status: 200, data: { ok: true, dry_run: true, report: plan.report,
                                    said: 'Dry run: nothing was written. ' + plan.report.read + ' rows read, ' +
                                          plan.report.add + ' trips to add, ' + plan.report.already + ' already in.' } };
    }
    var done = vcLock_(function () {
      var p = vcImportPlan_(book, vcRead_(VC_TABS.vehicles), vcRead_(VC_TABS.trips), clients, people,
                            st.import_minutes, vcNow_());
      if (!clients.readable) p.report.clients_why = clients.why;
      if (p.trips.length) vcUpsert_(VC_TABS.trips, p.trips);
      var nowIso = vcNowIso_();
      var text = JSON.stringify(p.report);
      if (text.length > 45000) text = text.slice(0, 45000);
      vcUpsert_(VC_TABS.settings, [
        { key: 'imported_at', value: nowIso, note: 'import', updated_at: nowIso, updated_by: g.uid },
        { key: 'import_report', value: text, note: 'import', updated_at: nowIso, updated_by: g.uid }
      ]);
      vcAppend_(VC_TABS.log, [vcLogRow_(g, '', '', 'import', '', { add: p.report.add, already: p.report.already,
        skipped: p.report.skipped.length, first_day: p.report.first_day, last_day: p.report.last_day }, '')]);
      vcMemoDrop_();
      return { said: 'Imported ' + p.report.add + ' trip' + (p.report.add === 1 ? '' : 's') + ' from the Van Calendar; ' +
                     p.report.already + ' were already in. Nothing was written back to the Van Calendar.',
               report: p.report, dry_run: false };
    });
    if (done && !done.status) {
      try { hubSysLog_(vcStr_(user && user.email), 'vehicleCalendarImport', String(done.report.add), { status: 200 }); } catch (eL) {}
    }
    return vcAnswerAfter_(g, done);
  } catch (e) {
    return vcFail_(e);
  }
};

// ---- Clients › Transportation reads the same trips (ClientSourceTransport.gs calls these, guarded) ----

function vcClientStatus_(t, nowMs) {
  if (t.state === 'requested' || t.state === 'needs_assignment') return 'Needs assignment';
  if (t.state === 'scheduled') return vcMs_(t.end_at) <= nowMs ? 'Completed' : 'Scheduled';
  return 'Cancelled';
}

/** The vehicles in the shape csTransportVehicles_ reads as fleet rows, with every name the Van Calendar uses. */
function vcClientVehicles_(rows) {
  return (rows || []).map(function (r) {
    var a = vcAvailabilityOf_(r.availability);
    return { unit: vcStr_(r.name), vehicle: vcStr_(r.description), year: '', plate: '',
             status: a === 'available' ? 'active' : (a === 'maintenance' ? 'service' : 'out of service'),
             aliases: vcAliasesOf_(r) };
  });
}

/** One vc trip in the Clients transport tab's own trip shape. */
function vcClientTripOut_(t, vById, nowMs) {
  var s = vcMs_(t.start_at), e = vcMs_(t.end_at);
  var veh = vById[t.state === 'scheduled' ? t.vehicle_id : ''] || null;
  var start = isNaN(s) ? null : vcMinutesOfDay_(s);
  var sameDay = !isNaN(s) && !isNaN(e) && vcDayOf_(s) === vcDayOf_(e);
  var end = t.end_known !== 'no' && sameDay ? vcMinutesOfDay_(e) : null;
  var time = isNaN(s) ? '' : vcClockWords_(s);
  var endTime = end === null ? '' : vcClockWords_(e);
  var reason = vcStr_(t.purpose) || vcStr_(t.trip_type);
  var vehicle = veh ? vcStr_(veh.name) : '';
  var status = vcClientStatus_(t, nowMs);
  var reserved = time ? (endTime ? time + ' – ' + endTime : time) : '';
  return {
    id: t.id, source: 'vehicle_calendar', sheet_row: 0, date: t.day, start: start, end: end, time: time,
    end_time: endTime, reason: reason, destination: vcStr_(t.destination), staff: vcStr_(t.staff_name),
    requested_at: t.created_at, requested_on: t.created_at ? vcDayOf_(vcMs_(t.created_at) || 0) : '',
    vehicle: vehicle, event_id: '', book_status: '', realigned: false, requests: 1, dr_name: '', dr_address: '',
    visit_id: '', conflict: '', conflict_time: '', conflict_open: false, status: status,
    record: reason || 'Van trip', assignment: vehicle, reserved_time: reserved,
    details: [vehicle || 'No vehicle booked', reserved, vcStr_(t.destination)].filter(function (x) { return !!x; }).join(' · ')
  };
}

// The client's trips from vc_trips (by client_key, the name fold as fallback), every imported row's source_ref (so…
function vcClientTrips_(clientKey, name, names) {
  var rows = vcRows_();
  var vById = vcVehicleIndex_(rows.vehicles);
  var nowMs = vcNow_();
  var fold = names || {};
  if (!Object.keys(fold).length && name) fold[clientNameKey_(name)] = true;
  var out = { rows: [], refs: {}, vehicles: vcClientVehicles_(rows.vehicles), bookings: [], why: '' };
  rows.trips.forEach(function (t) {
    if (t.source_ref) out.refs[t.source_ref] = true;
    var mine = (!!clientKey && t.client_key === clientKey) ||
               (!t.client_key && !!vcStr_(t.client_name) && csTransportNamed_(fold, t.client_name));
    if (t.state === 'scheduled' && t.source === 'platform' && vById[t.vehicle_id]) {
      var b = vcClientTripOut_(t, vById, nowMs);
      out.bookings.push({ id: t.id, date: t.day, start: b.start, end: b.end, time: b.time, end_time: b.end_time,
                          vehicle: vcStr_(vById[t.vehicle_id].name), aliases: vcAliasesOf_(vById[t.vehicle_id]),
                          client: vcStr_(t.client_name), record: b.reason, destination: b.destination });
    }
    if (mine) out.rows.push(vcClientTripOut_(t, vById, nowMs));
  });
  return out;
}

// ---- Clients › Appointments and Staff › Calendar read the board's trips, matched by the platform's own keys ----

var VC_PERSON_ACTIONS = ['vehicleCalendarClientTrips', 'vehicleCalendarStaffTrips'];
var VC_PERSON_STATES = { requested: 1, needs_assignment: 1, scheduled: 1 };
var VC_STAFF_KEY = /^[a-z0-9]{3,80}$/;

/** A trip as a person's calendar shows it: when, on what, who drives and rides, where to; never its notes. */
function vcPersonTripOut_(t, nowMs) {
  var w = vcTripWord_(t, nowMs);
  return { id: t.id, state: t.state, word: w.word, tone: w.tone, day: t.day, start_at: t.start_at, end_at: t.end_at,
           start_label: t.start_label, end_label: t.end_known ? t.end_label : '',
           vehicle_name: t.state === 'scheduled' ? t.vehicle_name : '', trip_type: t.trip_type, purpose: t.purpose,
           destination: t.destination, wheelchair_required: !!t.wheelchair_required, client_key: t.client_key,
           client_name: t.client_name, staff_name: t.staff_name, driver_name: t.driver_name };
}

/** The live trips `roleOf` names a role on, from `from` on, in time order; a trip it names nothing on is left out. */
function vcPersonTrips_(roleOf, from) {
  var nowMs = vcNow_();
  var trips = [];
  vcBoardBase_().trips.forEach(function (t) {
    if (!VC_PERSON_STATES[t.state] || (from && t.day < from)) return;
    var role = roleOf(t);
    if (!role) return;
    var o = vcPersonTripOut_(t, nowMs);
    if (role !== true) o.role = role;
    trips.push(o);
  });
  return { ok: true, today: vcDayOf_(nowMs), trips: trips };
}

HUB_POLICY.vehicleCalendarClientTrips = {
  file: 'VehicleCalendar.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' } }
};
/** One client's trips by their client key, for whoever Clients › Appointments opens that client to (csApptGate_). */
HUB_ACTIONS.vehicleCalendarClientTrips = function (payload, user) {
  var key = vcText_(payload && payload.client, 120);
  var reader = null;
  try { reader = key ? csApptGate_(user, key) : null; } catch (e) { reader = null; }
  if (!reader) return vcClosed_();
  try {
    var data = vcPersonTrips_(function (t) { return t.client_key === key; }, '');
    data.client = key;
    return { status: 200, data: data };
  } catch (e2) { return vcFail_(e2); }
};

HUB_POLICY.vehicleCalendarStaffTrips = {
  file: 'VehicleCalendar.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { person: { type: 'string' } }
};
/** One staff member's trips by their staff key, as driver or companion, from last week on, for a viewer Staff shows whole. */
HUB_ACTIONS.vehicleCalendarStaffTrips = function (payload, user) {
  var whole = null;
  try { whole = spWholeGate_(user); } catch (e) { whole = null; }
  if (!whole) return vcClosed_();
  var key = vcStr_(payload && payload.person);
  if (!VC_STAFF_KEY.test(key)) return vcRefuse_(400, 'person: a staff key.');
  try {
    var from = vcIsoAdd_(vcDayOf_(vcNow_()), -7);
    var data = vcPersonTrips_(function (t) {
      return t.driver_key === key ? 'driver' : (t.staff_key === key ? 'companion' : '');
    }, from);
    data.person = key;
    return { status: 200, data: data };
  } catch (e2) { return vcFail_(e2); }
};

// ---- Support Requests reads the same truth (vcSupportRows_ / vcSupportDecide_; no second copy) ----

var VC_SUPPORT_TYPE = { raw: 'Operations - Vehicle Request', area: 'Operations', label: 'Vehicle Request',
                        display: 'Operations · Vehicle Request' };

function vcSupportStatus_(t, waitingNames, nowMs) {
  if (t.state === 'requested') {
    return { word: 'Waiting on ' + (waitingNames.length ? waitingNames.join(', ') : 'the directors'), tone: 'waiting' };
  }
  if (t.state === 'needs_assignment') return { word: 'Approved · needs a vehicle', tone: 'pending' };
  if (t.state === 'declined') return { word: 'Declined', tone: 'denied' };
  if (t.state === 'cancelled') return { word: 'Cancelled', tone: 'closed' };
  if (vcMs_(t.end_at) <= nowMs) return { word: 'Completed', tone: 'resolved' };
  return { word: 'Scheduled', tone: 'approved' };
}

var VC_LOG_VERDICT = { request: 'requested', withdraw: 'withdrawn', cancel: 'cancelled', assign: 'assigned',
                       unassigned_by_vehicle: 'returned to Needs assignment', import: 'imported' };

// The vehicle requests as Support Requests rows: { readable, why, version, rows }.
function vcSupportRows_(user) {
  var out = { readable: false, why: '', version: vcVersion_(), rows: [] };
  var me = '', seesAll = false, master = false;
  try {
    me = hubActingUserId_(user);
    try { master = !!hubIsRealMaster_(user); } catch (eM) { master = false; }
    var st = vcSettings_();
    seesAll = master || st.directors.some(function (d) { return d.uid === me; });
  } catch (eG) { out.why = vcErr_(eG); return out; }
  var rows, log;
  try { rows = vcRows_(); }
  catch (e) { out.why = vcErr_(e); return out; }
  if (!rows.inbox) { out.why = rows.inbox_why || 'the Transportation items could not be read'; return out; }
  try { log = vcRead_(VC_TABS.log); } catch (eL) { log = null; }
  var vById = vcVehicleIndex_(rows.vehicles);
  var nowMs = vcNow_();
  var byTrip = {};
  rows.inbox.forEach(function (r) { if (r.box === 'work') (byTrip[r.trip_id] = byTrip[r.trip_id] || []).push(r); });
  var logOf = {};
  (log || []).forEach(function (l) { if (l.trip_id) (logOf[l.trip_id] = logOf[l.trip_id] || []).push(l); });
  rows.trips.forEach(function (t) {
    if (t.source !== 'platform') return;
    if (!seesAll && (!me || t.requested_by_uid !== me)) return;
    var items = byTrip[t.id] || [];
    var waiting = items.filter(function (i) { return i.state === 'waiting'; });
    // the master stands in on a director seat of a request the master did not file
    var standIn = master && t.requested_by_uid !== me
      ? waiting.filter(function (i) { return vcStr_(i.seat) === 'director'; })[0] : null;
    var mineItem = me ? waiting.filter(function (i) { return i.to_uid === me; })[0] || standIn || null : null;
    var veh = vById[t.vehicle_id] || vById[t.requested_vehicle_id] || null;
    var vname = veh ? vcStr_(veh.name) : 'a vehicle';
    var when = vcWhenWords_(t.start_at, t.end_at);
    var status = vcSupportStatus_(t, waiting.map(function (i) { return i.to_name; }), nowMs);
    var details = [{ label: 'Requested by', value: vcStr_(t.requested_by_name) },
                   { label: 'Vehicle', value: vname }, { label: 'When', value: when },
                   { label: 'Staff', value: vcStr_(t.staff_name) }];
    if (seesAll && vcStr_(t.client_name)) details.push({ label: 'Client', value: vcStr_(t.client_name) });
    details.push({ label: 'Trip type', value: vcStr_(t.trip_type) });
    details.push({ label: 'Wheelchair-accessible vehicle', value: vcYes_(t.wheelchair_required) ? 'Yes' : 'No' });
    if (vcStr_(t.details)) details.push({ label: 'Details', value: vcText_(t.details, 240) });
    if (vcStr_(t.assign_note)) details.push({ label: 'Note', value: vcText_(t.assign_note, 240) });
    var history = (logOf[t.id] || []).sort(function (a, b) { return a.at < b.at ? -1 : (a.at > b.at ? 1 : 0); })
      .map(function (l) {
        var now = vcJson_(l.now, {});
        var verdict = l.via === 'answer' ? vcStr_(now && now.answer) || vcStr_(now && now.state) : (VC_LOG_VERDICT[l.via] || l.via);
        return { at: l.at, by: l.by_name, verdict: verdict, note: l.note, via: l.via };
      });
    var answered = items.filter(function (i) { return i.state === 'approved' || i.state === 'declined'; })[0];
    out.rows.push({
      ref: t.id, source: 'transportation', kind: 'vehicle_request', status: status, date: t.created_at,
      requestor: { name: vcStr_(t.requested_by_name), uid: vcStr_(t.requested_by_uid) }, type: VC_SUPPORT_TYPE,
      urgency: '', description: [vcStr_(t.trip_type), vname, when].filter(String).join(' · '), route: 'vehicle',
      completed: t.state === 'declined' || t.state === 'cancelled' || (t.state === 'scheduled' && vcMs_(t.end_at) <= nowMs),
      details: details, history: history, acks: [], waiting_on: waiting.map(function (i) { return i.to_name; }),
      may: { approve: !!mineItem, deny: !!mineItem, resolve: false, aware: false,
             why: mineItem ? '' : (t.state === 'requested'
               ? 'Waiting on ' + waiting.map(function (i) { return i.to_name; }).join(', ') + '.'
               : (answered ? 'Answered by ' + answered.answered_by + '.' : '')) },
      vc: { trip_id: t.id, item_id: mineItem ? mineItem.id : '', words: mineItem ? ['approve', 'decline'] : [] },
      link: '/app/vehicle-calendar/calendar?trip=' + t.id
    });
  });
  out.rows.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  out.readable = true;
  if (!log) out.why = 'the Transportation log could not be read, so the rows carry no history';
  return out;
}
