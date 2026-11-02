// SUPPORT REQUESTS — every Employee Support Hotline request, every Scheduling request and every warning the…
// Apps Script decides who sees what; the screen draws.

var SD_APP_ID = 'support-desk';
var SD_TABS = { events: 'support_events', decisions: 'support_decisions', inbox: 'support_inbox',
                settings: 'support_settings' };

var SD_HEADERS = {
  support_events: ['id', 'kind', 'ref', 'route', 'source', 'source_ref', 'title', 'category', 'person', 'person_key',
                   'person_uid', 'house', 'day', 'at', 'details', 'status', 'test_mode', 'created_at', 'created_by'],
  support_decisions: ['id', 'ref', 'source', 'verdict', 'note', 'by_uid', 'by_name', 'at', 'via', 'witness',
                      'test_mode'],
  // `alert`: which raised alert an item is (late_show, no_call, punch, incident), for the relay's per-person cut
  support_inbox: ['id', 'ref', 'box', 'kind', 'seat', 'to_uid', 'to_email', 'to_name', 'title', 'body',
                  'house_label', 'date', 'state', 'answered_by', 'answered_at', 'note', 'link', 'test_mode',
                  'created_at', 'alert'],
  support_settings: ['key', 'value', 'note', 'updated_at', 'updated_by']
};

var SD_TZ = 'America/New_York';
var SD_ACTIONS = ['supportDeskList', 'supportDeskDecide', 'supportDeskAdp', 'supportDeskSettingsSet',
                  'supportInboxAnswer', 'supportDeskPunch', 'myCalendarVacationRoute', 'myCalendarVacationFile',
                  'supportDeskSeat'];
var SD_SITUATIONS = ['sr_vehicle_request', 'sr_payroll_request', 'sr_punch_aware', 'sr_adp_applied'];
var SD_LOCK_MS = 20000;
var SD_BUSY_SENTENCE = 'Somebody else is answering this request right now — try again.';
var SD_VERSION_KEY = 'sd_list_v';
// CacheService's longest: every write here bumps the version, and what comes from outside the houses is in the key
var SD_LIST_TTL = 21600;
var SD_CHUNK = 90000;
var SD_DUE_KEY = 'sd_due_at';
var SD_TICK_EVERY_MS = 600000;
var SD_TICK_BUDGET_MS = 20000;
var SD_PUNCH_MAX = 200;
var SD_OWED_HOURS = 36;
var SD_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var SD_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

var SD_ROUTE_ORDER = ['vehicle', 'payroll', 'general', 'adp_update'];
var SD_ROUTES_DEFAULT = {
  vehicle: ['Operations - Vehicle Issue', 'Operations - Transportation', 'Operations - Transportation Request',
            'Van Calendar'],
  payroll: ['ADP - Pay Stubs', 'Payroll', 'PSI - Time Entries', 'Finances - Request for Pay Stubs', 'Pay Stubs'],
  general: ['Other - General Requests'],
  adp_update: ['ADP - Update Information']
};
var SD_SETTING_DEFAULTS = {
  directors: 'ty.bond@abrighterdawninc.com, brittfrench1316@gmail.com',
  leads: 'arthur.torres@asalifecare.com, admin@abrighterdawninc.com',
  payroll_to: 'ty.bond@abrighterdawninc.com'
};
var SD_SETTABLE = ['leads', 'payroll_to', 'routes', 'directors'];
var SD_FINAL = { approved: 'Approved', denied: 'Denied', resolved: 'Resolved' };
var SD_VERDICT_OF = { approve: 'approved', deny: 'denied', resolve: 'resolved', aware: 'aware',
                      redirect: 'redirected' };
// a redirect hands one request to one account's My Work (support_inbox box 'work'), answered through supportDeskDecide
var SD_STAFF_ROLES = ['admin', 'director', 'manager', 'staff'];
var SD_WORK_BOX = 'work';
var SD_REDIRECT = 'redirect';
var SD_SEAT_REF = /^(HQ|SE)[0-9A-F]{10}(-\d+)?$/;
var SD_WARNING_KINDS = { late_show: 1, no_call: 1, punch: 1 };
var SD_SCHED_KINDS = { call_off: 1, phone: 1, request_off: 1, time_off: 1, swap: 1, take: 1 };
var SD_SCHED_WAITING = { waiting: 1, waiting_staff: 1, waiting_manager: 1, waiting_director: 1 };
var SD_SCHED_CLOSED = { approved: 1, approved_future: 1, declined: 1, expired: 1, withdrawn: 1, cancelled: 1, done: 1,
                        covered: 1, stopped: 1 };
var SD_ADP_ONLY = /pay\s*rate|\bw-?4\b|\bbank\b|direct\s*deposit|routing\s*number|account\s*number|\btax|\bssn\b|social\s*security|date\s*of\s*birth|\bdob\b|birth\s*day|legal\s*name|sign[\s-]*in\s*e-?mail|login\s*e-?mail|salary|\bwage/i;
var SD_READBACK = /(new|updated)\s+(home\s+|mailing\s+)?(address|e-?mail(\s+address)?|phone(\s+number)?)\s+(as|is|to)\s+(.+?)[.?]\s*(is that (correct|right)|did i get that right)/i;
var SD_YES = /^\s*(yes|yeah|correct|that'?s right)\b/i;
/** The self-test's clock: an ISO instant while a check names the hour it is about, null everywhere real. */
var SD_NOW = null;

/* ---- small values ---- */

function sdStr_(v) { return String(v == null ? '' : v).trim(); }

function sdText_(v, max) {
  var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return max ? s.slice(0, max) : s;
}

function sdErr_(e) { return String((e && e.message) || e || 'unknown error').slice(0, 240); }

function sdNowMs_() {
  if (SD_NOW) {
    var t = Date.parse(String(SD_NOW));
    if (!isNaN(t)) return t;
  }
  return Date.now();
}

function sdIso_(ms) { return new Date(ms).toISOString(); }

function sdDayOfMs_(ms) { return Utilities.formatDate(new Date(ms), SD_TZ, 'yyyy-MM-dd'); }

function sdRefuse_(status, message) { return { status: status, message: message }; }

function sdJson_(raw, fallback) {
  if (raw && typeof raw === 'object') return raw;
  try {
    var v = JSON.parse(String(raw || ''));
    return (v && typeof v === 'object') ? v : fallback;
  } catch (e) { return fallback; }
}

function sdHas_(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

function sdSha10_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('').slice(0, 10)
    .toUpperCase();
}

function sdPad_(n) { return (n < 10 ? '0' : '') + n; }

function sdValidYmd_(y, m, d) {
  var dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function sdFold_(name) {
  try { return clientNameKey_(name); } catch (e) { return sdStr_(name).toLowerCase(); }
}

function sdFirst_(name) { return sdStr_(name).split(/\s+/)[0] || sdStr_(name); }

function sdMaskPhones_(text) { return String(text || '').replace(/\+?\d[\d\s().-]{6,}\d/g, '[number]'); }

/* ---- time, as the screens and the queue's own key read it ---- */

var SD_INSTANT_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** An instant's epoch ms: a Date, or text that starts like an ISO instant (no zone reads as UTC); else null. */
function sdInstantMs_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v.getTime();
  var s = sdStr_(v);
  if (!SD_INSTANT_RE.test(s)) return null;
  var t = s.charAt(10) === ' ' ? s.slice(0, 10) + 'T' + s.slice(11) : s;
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(t)) t += 'Z';
  var ms = Date.parse(t);
  return isNaN(ms) ? null : ms;
}

/** The calendar day: an instant's Ohio day, an ISO day, a sheet's M/D/YYYY; '' when none (server/my_work.py day_of). */
function sdDayOf_(v) {
  var ms = sdInstantMs_(v);
  if (ms !== null) return sdDayOfMs_(ms);
  var s = sdStr_(v);
  var m = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return sdValidYmd_(+m[1], +m[2], +m[3]) ? m[1] + '-' + m[2] + '-' + m[3] : '';
  m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(s);
  if (m) return sdValidYmd_(+m[3], +m[1], +m[2]) ? m[3] + '-' + sdPad_(+m[1]) + '-' + sdPad_(+m[2]) : '';
  return '';
}

/** An instant as UTC ISO to the second, a day as YYYY-MM-DD, '' when unreadable (my_work.py when_of). */
function sdWhenOf_(v) {
  var ms = sdInstantMs_(v);
  if (ms !== null) return new Date(ms).toISOString().slice(0, 19) + 'Z';
  return sdDayOf_(v);
}

/** One spelling of an instant for a key: a Date or an ISO instant as toISOString, anything else as written. */
function sdInstantText_(v) {
  var ms = sdInstantMs_(v);
  if (ms !== null && (Object.prototype.toString.call(v) === '[object Date]' ||
                      /(Z|[+-]\d{2}:?\d{2})$/i.test(sdStr_(v)))) return new Date(ms).toISOString();
  return Object.prototype.toString.call(v) === '[object Date]' ? '' : sdStr_(v);
}

/** An instant to the minute in UTC (yyyy-MM-ddTHH:mmZ), '' when unreadable. */
function sdUtcMinute_(v) {
  var ms = sdInstantMs_(v);
  return ms === null ? '' : new Date(ms).toISOString().slice(0, 16) + 'Z';
}

function sdDayAdd_(iso, n) {
  var p = String(iso || '').split('-');
  if (p.length !== 3) return '';
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000);
  return d.getUTCFullYear() + '-' + sdPad_(d.getUTCMonth() + 1) + '-' + sdPad_(d.getUTCDate());
}

/** "Thu 10/1" for an ISO day; the text as it came when it is not one. */
function sdDayWords_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sdStr_(iso));
  if (!m || !sdValidYmd_(+m[1], +m[2], +m[3])) return sdStr_(iso);
  return SD_WEEKDAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] + ' ' + (+m[2]) + '/' + (+m[3]);
}

/** "Sep 18, 2026 2:24 PM" in Ohio for an instant, "Sep 18, 2026" for a day, the text as written otherwise. */
function sdStampWords_(v) {
  var ms = sdInstantMs_(v);
  var day = ms !== null ? sdDayOfMs_(ms) : sdDayOf_(v);
  if (!day) return sdText_(v, 60);
  var p = day.split('-');
  var words = SD_MONTHS[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0];
  if (ms !== null) words += ' ' + Utilities.formatDate(new Date(ms), SD_TZ, 'h:mm a');
  return words;
}

function sdClockWords_(iso) {
  var ms = sdInstantMs_(iso);
  return ms === null ? '' : Utilities.formatDate(new Date(ms), SD_TZ, 'HH:mm');
}

/* ---- the houses (ASA Data, one Data tab each) ---- */

function sdHouseReady_(tab) {
  try { return !!houseMoved_(tab); } catch (e) { return false; }
}

function sdSheet_(tab) {
  if (!SD_HEADERS[tab]) throw new Error('No Support Requests house is called "' + tab + '".');
  if (!sdHouseReady_(tab)) {
    throw new Error('The Support Requests house "' + tab + '" is not set up (no pointer, or moved.' + tab +
                    ' is not on).');
  }
  return hubTabEnsure_(tab, SD_HEADERS[tab]);
}

function sdIdField_(tab) { return tab === SD_TABS.settings ? 'key' : 'id'; }

function sdCellText_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return cellText_(v) || '';
  return String(v).trim();
}

var SD_MEMO = {};

var SD_MEMO_DERIVED = { support_events: ['__events'], support_decisions: ['__decs'], support_inbox: ['__items'],
                        support_settings: ['__settings', '__dirs', '__people_leads', '__people_payroll_to', '__receive',
                                           '__ar_off', '__ar_master'] };

/** Forgets what this execution read of a house (and what was built from it); every house when no tab is named. */
function sdMemoDrop_(tab) {
  if (!tab) { SD_MEMO = {}; return; }
  delete SD_MEMO[tab];
  (SD_MEMO_DERIVED[tab] || []).forEach(function (k) { delete SD_MEMO[k]; });
  delete SD_MEMO.__base;
}

/** Every row of a house, header-keyed, in sheet order; throws (naming the house) when it cannot be read. */
function sdRead_(tab) {
  if (sdHas_(SD_MEMO, tab)) return SD_MEMO[tab];
  var values;
  try { values = sdSheet_(tab).getDataRange().getValues(); }
  catch (e) { throw new Error('The Support Requests house "' + tab + '" could not be read: ' + sdErr_(e)); }
  var out = [];
  if (values.length > 1) {
    var header = values[0].map(function (h) { return String(h || '').trim(); });
    var idf = sdIdField_(tab);
    for (var r = 1; r < values.length; r++) {
      var row = {};
      for (var c = 0; c < header.length; c++) if (header[c]) row[header[c]] = sdCellText_(values[r][c]);
      if (row[idf]) out.push(row);
    }
  }
  SD_MEMO[tab] = out;
  return out;
}

function sdLine_(header, row) {
  return header.map(function (h) {
    var v = sdHas_(row, h) ? row[h] : '';
    if (v !== null && typeof v === 'object') v = JSON.stringify(v);
    return hubCellSafe_(String(v == null ? '' : v));
  });
}

function sdPutLines_(sheet, at, lines) {
  if (!lines.length) return;
  var need = at + lines.length - 1;
  if (need > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), need - sheet.getMaxRows());
  var range = sheet.getRange(at, 1, lines.length, lines[0].length);
  range.setNumberFormat('@');
  range.setValues(lines);
}

function sdWrite_(tab, rows, appendOnly) {
  if (!rows || !rows.length) return 0;
  var held = sheetDbGateHolds_(tab, appendOnly ? 'create' : 'update');
  if (held) throw new Error(held.error.message);
  var sheet = sdSheet_(tab);
  var header = ensureHeader_(sheet, SD_HEADERS[tab]);
  var idf = sdIdField_(tab), idCol = header.indexOf(idf);
  var last = Math.max(sheet.getLastRow(), 1);
  var at = {};
  if (!appendOnly && last > 1 && idCol !== -1) {
    sheet.getRange(2, idCol + 1, last - 1, 1).getValues().forEach(function (r, i) {
      var k = sdCellText_(r[0]);
      if (k && !sdHas_(at, k)) at[k] = i + 2;
    });
  }
  var byId = {}, order = [];
  rows.forEach(function (row) {
    var k = sdStr_(row[idf]);
    if (!k) throw new Error('A ' + tab + ' row needs its ' + idf + '.');
    if (!sdHas_(byId, k)) order.push(k);
    byId[k] = row;
  });
  var appends = [];
  order.forEach(function (k) {
    var line = sdLine_(header, byId[k]);
    if (sdHas_(at, k)) sdPutLines_(sheet, at[k], [line]);
    else appends.push(line);
  });
  sdPutLines_(sheet, last + 1, appends);
  sdMemoDrop_(tab);
  sdBump_();
  return order.length;
}

function sdAppend_(tab, rows) { return sdWrite_(tab, rows, true); }

function sdUpsert_(tab, rows) { return sdWrite_(tab, rows, false); }

/** Runs fn under the script lock; a lock not had in 20 s is a 409 the panel shows. */
function sdLock_(fn) {
  var lock = LockService.getScriptLock();
  var held = false;
  try { held = lock.tryLock(SD_LOCK_MS); } catch (e) { held = false; }
  if (!held) return sdRefuse_(409, SD_BUSY_SENTENCE);
  try { return fn(); } finally { try { lock.releaseLock(); } catch (eR) {} }
}

function sdBump_() {
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    cache.put(SD_VERSION_KEY, String(Date.now()) + '-' + Math.random(), SD_LIST_TTL);
  } catch (e) {
    // a version that could not move must not stand: removed, the next read mints a new one
    try { if (cache) cache.remove(SD_VERSION_KEY); } catch (eR) {}
  }
}

/** The list's cache version; '' when the cache cannot answer, and then nothing is cached. */
function sdVersion_() {
  try {
    var cache = CacheService.getScriptCache();
    var v = cache.get(SD_VERSION_KEY);
    if (!v) {
      v = String(Date.now()) + '-' + Math.random();
      cache.put(SD_VERSION_KEY, v, SD_LIST_TTL);
    }
    return v;
  } catch (e) { return ''; }
}

function sdCacheGet_(base) {
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

function sdCachePut_(base, value) {
  try {
    var cache = CacheService.getScriptCache();
    var text = JSON.stringify(value);
    var n = Math.ceil(text.length / SD_CHUNK);
    if (n > 60) return;
    for (var i = 0; i < n; i++) cache.put(base + ':' + i, text.substr(i * SD_CHUNK, SD_CHUNK), SD_LIST_TTL);
    cache.put(base + ':n', String(n), SD_LIST_TTL);
  } catch (e) {}
}

/* ---- settings and people ---- */

function sdLive_(u) {
  var off = sdStr_(u && u.active).toUpperCase();
  return !!u && off !== 'FALSE' && off !== '0' && off !== 'NO' && !sdStr_(u.mergedinto);
}

/** E-mails → live accounts, the way the sign-in door finds them (merged rows never answer). */
function sdResolveEmails_(csv) {
  var emails = sdStr_(csv).split(/[,;\s]+/).map(function (s) { return s.trim().toLowerCase(); })
    .filter(function (s) { return s.indexOf('@') > 0; });
  var out = { list: [], missed: [], why: '' };
  var seen = {};
  emails.forEach(function (email) {
    var u = null;
    try { u = userByEmail_(email); } catch (e) { u = null; }
    if (u && sdLive_(u)) {
      var uid = sdStr_(u.userid);
      if (!seen[uid]) out.list.push({ uid: uid, name: sdStr_(u.displayname) || email, email: email });
      seen[uid] = true;
    } else {
      out.missed.push(email);
    }
  });
  if (!emails.length) out.why = 'no e-mail is written';
  else if (out.missed.length) out.why = 'no live account answers ' + out.missed.join(', ');
  return out;
}

/** The settings house over the shipped defaults. Not set up → defaults; set up but unreadable → `readable:false`. */
function sdSettings_() {
  if (SD_MEMO.__settings) return SD_MEMO.__settings;
  var out = { readable: true, set_up: sdHouseReady_(SD_TABS.settings), why: '', values: {}, routes: null,
              routes_why: '', watermark: {} };
  var kv = {};
  if (out.set_up) {
    try {
      sdRead_(SD_TABS.settings).forEach(function (r) { kv[r.key] = r.value; });
    } catch (e) { out.readable = false; out.why = sdErr_(e); }
  }
  ['directors', 'leads', 'payroll_to'].forEach(function (k) {
    out.values[k] = sdStr_(kv[k]) || SD_SETTING_DEFAULTS[k];
  });
  var routes = sdJson_(kv.routes, null);
  if (routes && !Array.isArray(routes)) {
    out.routes = {};
    for (var rk in routes) {
      if (sdHas_(routes, rk) && Array.isArray(routes[rk])) out.routes[rk] = routes[rk].map(sdStr_).filter(String);
    }
  } else {
    if (sdStr_(kv.routes)) out.routes_why = 'The routes setting is not readable JSON — the shipped routes are used.';
    out.routes = SD_ROUTES_DEFAULT;
  }
  out.watermark = sdJson_(kv.watermark, {}) || {};
  out.seeded_at = sdStr_(kv.seeded_at);
  SD_MEMO.__settings = out;
  return out;
}

/** ONE LIST WITH SCHEDULING: its directors when readable, the Support Requests setting only when it is not. */
function sdDirectors_() {
  if (SD_MEMO.__dirs) return SD_MEMO.__dirs;
  var sched = null;
  try { sched = schedFlowDirectors_(schedSettings_()); }
  catch (e) { sched = { readable: false, list: [], why: sdErr_(e) }; }
  var out;
  if (sched && sched.readable && sched.list.length) {
    out = { readable: true, from: 'scheduling', why: '',
            list: sched.list.map(function (d) { return { uid: sdStr_(d.uid), name: sdStr_(d.name), email: sdStr_(d.email) }; }) };
  } else {
    var st = sdSettings_();
    var got = st.readable ? sdResolveEmails_(st.values.directors) : { list: [], why: st.why };
    if (got.list.length) {
      out = { readable: true, from: 'support', list: got.list,
              why: 'Directors from Support Requests settings — Scheduling\'s list could not be read' +
                   (got.missed.length ? ' (and ' + got.why + ')' : '') + '.' };
    } else {
      out = { readable: false, from: '', list: [],
              why: 'Nobody can decide right now: Scheduling\'s directors could not be read (' +
                   sdStr_(sched && sched.why) + ') and the Support Requests settings name no live director (' +
                   sdStr_(got.why) + ').' };
    }
  }
  SD_MEMO.__dirs = out;
  return out;
}

function sdPeople_(which) {
  var memo = '__people_' + which;
  if (SD_MEMO[memo]) return SD_MEMO[memo];
  var st = sdSettings_();
  var out = st.readable ? sdResolveEmails_(st.values[which]) : { list: [], missed: [], why: st.why };
  SD_MEMO[memo] = out;
  return out;
}

function sdLeads_() { return sdPeople_('leads'); }

function sdPayrollTo_() { return sdPeople_('payroll_to'); }

/** Live accounts by display-name fold; null when the accounts cannot be read. */
function sdAccounts_() {
  if (sdHas_(SD_MEMO, '__accounts')) return SD_MEMO.__accounts;
  var byKey = null;
  try {
    byKey = {};
    (usersAll_() || []).forEach(function (u) {
      if (!sdLive_(u)) return;
      var k = hubNameFold_(u.displayname);
      if (!k) return;
      if (!byKey[k]) byKey[k] = [];
      byKey[k].push(u);
    });
  } catch (e) { byKey = null; }
  SD_MEMO.__accounts = byKey;
  return byKey;
}

/** The one live account a name folds to; null when none, two or unreadable. */
function sdAccountByName_(name) {
  var all = sdAccounts_();
  var k = '';
  try { k = hubNameFold_(name); } catch (e) { k = ''; }
  var hits = (all && k) ? (all[k] || []) : [];
  return hits.length === 1 ? hits[0] : null;
}

function sdUidByName_(name) { var u = sdAccountByName_(name); return u ? sdStr_(u.userid) : ''; }

function sdUserByUid_(uid) {
  var want = sdStr_(uid);
  if (!want) return null;
  var hit = null;
  try {
    (usersAll_() || []).forEach(function (u) { if (sdStr_(u.userid) === want && sdLive_(u)) hit = u; });
  } catch (e) { hit = null; }
  return hit;
}

/** The account's own phone a text may go to: `phone`, then `phones`, the first the send door accepts. */
function sdPhoneOf_(u) {
  if (!u) return '';
  var list = [u.phone];
  try { profileParsePhones_(u.phones).forEach(function (p) { list.push(p && p.number); }); } catch (e) {}
  for (var i = 0; i < list.length; i++) {
    var ok = packetSendableNumber_(list[i]);
    if (ok) return ok;
  }
  return '';
}

/* ---- the gate ---- */

function sdVisiting_(user) {
  return !!(user && (user.visiting_member || (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX)));
}

function sdActorName_(user) {
  return sdStr_(user && (user.display_name != null ? user.display_name : user.displayname)) ||
         sdStr_(user && user.email);
}

// Who sees and who decides — the App Control gate opens the door, the lists decide the cut.
var SD_WATCH_BADGES = ['ADMIN', 'ADMINISTRATOR', 'DIRECTOR'];

// The badges worn and what each stands in for (HUB_BADGE_FOLLOWS), never the account role: role admin is carried by…
function sdWatches_(user) {
  return userBadgesWorn_(user && user.types, '').some(function (b) { return SD_WATCH_BADGES.indexOf(b) !== -1; });
}

function sdGate_(user) {
  var g = { open: false, uid: '', name: '', email: '', is_master: false, is_director: false, is_lead: false,
            is_watcher: false, can_decide: false };
  var got = null;
  try { got = hubProfileAppGate_(SD_APP_ID, user); } catch (e) { got = null; }
  if (!got || !got.open) return g;
  g.open = true;
  g.uid = hubActingUserId_(user);
  g.name = sdActorName_(user);
  g.email = sdStr_(user && user.email).toLowerCase();
  try { g.is_master = !!hubIsRealMaster_(user); } catch (eM) { g.is_master = false; }
  var dirs = sdDirectors_();
  g.is_director = !!(g.uid && dirs.list.some(function (d) { return d.uid === g.uid; }));
  g.is_lead = !!(g.uid && sdLeads_().list.some(function (d) { return d.uid === g.uid; }));
  try { g.is_watcher = sdWatches_(user); } catch (eW) { g.is_watcher = false; }
  g.can_decide = g.is_director || g.is_master;
  return g;
}

/** Test mode, fail closed: anything unreadable or unknown is on. */
function sdTestMode_() {
  try {
    var s = hubTestModeState_();
    if (!s || (s.on !== true && s.on !== false)) return { on: true, readable: false, why: 'Test mode could not be read.' };
    if (s.unrecognized) return { on: true, readable: false, why: 'Test mode reads a word the switch does not know — held as on.' };
    return { on: s.on, readable: true, why: s.on ? 'Test mode is on: texts are written to the rehearsal sheet.' : '' };
  } catch (e) {
    return { on: true, readable: false, why: 'Test mode could not be read (' + sdErr_(e) + ') — held as on.' };
  }
}

function sdTestWord_() { return sdTestMode_().on === false ? 'no' : 'yes'; }

/* ---- the hotline queue: its key, its type, its route ---- */

/** The key the queue's rows are told apart by — byte-identical to server/my_work.py _support_key. */
function sdQueueKey_(person, type, details, received) {
  var day = sdDayOf_(received);
  return [sdStr_(person).toLowerCase(), sdStr_(type).toLowerCase(), sdStr_(details).toLowerCase().slice(0, 120),
          day || (Object.prototype.toString.call(received) === '[object Date]' ? '' : sdStr_(received))].join('|');
}

function sdNthRef_(base, n) { return n <= 1 ? base : base + '-' + n; }

function sdCallIdOf_(notes) {
  var m = /Call ID:\s*(AC[0-9a-f]+)/i.exec(String(notes || ''));
  return m ? m[1] : '';
}

/** call_id → the call's own instant, from the calls house, read once per pass; {} when it cannot be read. */
function sdCallTimes_() {
  if (sdHas_(SD_MEMO, '__call_times')) return SD_MEMO.__call_times;
  var out = {};
  try {
    if (typeof commCallsDeclared_ === 'function' && commCallsDeclared_(COMM_CALLS_TAB)) {
      var got = commCallsRead_(commCallsSheet_());
      var ci = got.header.indexOf('call_id'), ai = got.header.indexOf('call_at');
      for (var i = 1; ci !== -1 && ai !== -1 && i < got.values.length; i++) {
        var id = sdStr_(got.values[i][ci]), at = sdStr_(got.values[i][ai]);
        if (id && at && !out[id]) out[id] = at;
      }
    }
  } catch (e) { out = {}; }
  SD_MEMO.__call_times = out;
  return out;
}

/** The sheet kept only the day: a midnight Date, M/D/YYYY or YYYY-MM-DD. */
function sdDayOnly_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return !isNaN(v.getTime()) && v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0;
  }
  return /^\s*(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})\s*$/.test(sdStr_(v));
}

// When a queue row was received.
function sdReceivedOf_(r) {
  var raw = r.date_received;
  if (!sdDayOnly_(raw)) return raw;
  var id = sdCallIdOf_(r.notes);
  var at = id ? sdCallTimes_()[id] : '';
  return at && sdDayOf_(at) === sdDayOf_(raw) ? at : raw;
}

/** "Area - Label" → {raw, area, label, display:"Area · Label"}; no separator → the label alone; blank → Other. */
function sdTypeParts_(raw) {
  var s = sdStr_(raw);
  if (!s) return { raw: '', area: '', label: 'Other', display: 'Other' };
  var cut = s.indexOf(' - ');
  if (cut === -1) return { raw: s, area: '', label: s, display: s };
  var area = s.slice(0, cut).trim(), label = s.slice(cut + 3).trim();
  return { raw: s, area: area, label: label, display: area + ' · ' + label };
}

/** A category the platform wrote ("Attendance · Late Show") as a type. */
function sdTypeOfCategory_(cat) {
  var s = sdStr_(cat);
  var cut = s.indexOf(' · ');
  if (cut === -1) return sdTypeParts_(s);
  return { raw: s, area: s.slice(0, cut).trim(), label: s.slice(cut + 3).trim(), display: s };
}

function sdTypeKey_(raw) {
  try { return hotlineRequestTypeKey_(raw); } catch (e) { return sdStr_(raw).toLowerCase(); }
}

function sdIsCallOff_(raw) {
  if (!sdStr_(raw)) return false;
  try {
    if (sdTypeKey_(raw) === sdTypeKey_(HOTLINE_CALL_OFF_TYPE)) return true;
    return typeof hotlineRequestTypeCallOffish_ === 'function' && !!hotlineRequestTypeCallOffish_(raw);
  } catch (e) { return /call[\s-]*off/i.test(String(raw)); }
}

/** The first route whose list holds this type, compared by the hotline's own type key; '' when none. */
function sdRouteOf_(raw, routes) {
  var r = routes || SD_ROUTES_DEFAULT;
  var k = sdTypeKey_(raw);
  if (!k) return '';
  var order = SD_ROUTE_ORDER.slice();
  for (var extra in r) if (sdHas_(r, extra) && order.indexOf(extra) === -1) order.push(extra);
  for (var i = 0; i < order.length; i++) {
    var list = r[order[i]] || [];
    for (var j = 0; j < list.length; j++) if (sdTypeKey_(list[j]) === k) return order[i];
  }
  return '';
}

function sdUrgency_(v) {
  var s = sdStr_(v);
  if (/^(mid|medium)$/i.test(s)) return 'Medium';
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/** Every queue row in book order with its HQ ref; throws when the book cannot be read. */
function sdQueueAll_() {
  if (SD_MEMO.__queue) return SD_MEMO.__queue;
  var rows = estateRows_('supportQueue') || [];
  var nth = {};
  var out = rows.map(function (r, i) {
    var key = sdQueueKey_(r.requestor, r.type_of_request, r.description_of_request, r.date_received);
    nth[key] = (nth[key] || 0) + 1;
    var m = /^r(\d+)$/.exec(sdStr_(r.id));
    return { ref: sdNthRef_('HQ' + sdSha10_(key), nth[key]), key: key, row: r, index: i,
             book_row: m ? +m[1] : 0 };
  });
  SD_MEMO.__queue = out;
  return out;
}

/* ---- events, items, decisions ---- */

function sdEventId_(kind, sourceRef) { return 'SE' + sdSha10_(kind + '|' + sourceRef); }

function sdItemId_(ref, kind, uid) { return 'SN' + sdSha10_(ref + '|' + kind + '|' + uid); }

function sdDecisionId_(ref, verdict, uid, at) { return 'SD' + sdSha10_(ref + '|' + verdict + '|' + uid + '|' + at); }

/** The events, first row of an id wins (a lock-free hook may at most have appended a twin). */
function sdEvents_() {
  if (SD_MEMO.__events) return SD_MEMO.__events;
  var seen = {}, out = [];
  sdRead_(SD_TABS.events).forEach(function (e) {
    if (seen[e.id]) return;
    seen[e.id] = true;
    out.push(e);
  });
  SD_MEMO.__events = out;
  return out;
}

function sdEventById_(id) {
  var hit = null;
  sdEvents_().forEach(function (e) { if (!hit && e.id === id) hit = e; });
  return hit;
}

function sdDecisionsByRef_() {
  if (SD_MEMO.__decs) return SD_MEMO.__decs;
  var by = {};
  sdRead_(SD_TABS.decisions).forEach(function (d) { (by[d.ref] = by[d.ref] || []).push(d); });
  SD_MEMO.__decs = by;
  return by;
}

function sdItemsByRef_() {
  if (SD_MEMO.__items) return SD_MEMO.__items;
  var by = {};
  sdRead_(SD_TABS.inbox).forEach(function (it) { (by[it.ref] = by[it.ref] || []).push(it); });
  SD_MEMO.__items = by;
  return by;
}

function sdDropReads_() {
  [SD_TABS.events, SD_TABS.decisions, SD_TABS.inbox, SD_TABS.settings].forEach(sdMemoDrop_);
  delete SD_MEMO.__queue;
}

/** The latest final verdict (approved, denied, resolved) of a ref's decisions, or null. */
function sdFinalOf_(decs) {
  var hit = null;
  (decs || []).forEach(function (d) { if (SD_FINAL[d.verdict]) hit = d; });
  return hit;
}

/** The latest redirect of a ref's decisions as {to_uid, to_name, by, at, note, item_id}, or null. */
function sdLastRedirect_(decs) {
  var hit = null;
  (decs || []).forEach(function (d) { if (d.verdict === 'redirected') hit = d; });
  if (!hit) return null;
  var w = sdJson_(hit.witness, {}) || {};
  if (!sdStr_(w.to_uid)) return null;
  return { to_uid: sdStr_(w.to_uid), to_name: sdStr_(w.to_name) || 'someone', by: sdStr_(hit.by_name),
           at: sdStr_(hit.at), note: sdStr_(hit.note), item_id: sdStr_(w.item_id) };
}

/** The redirect a request still waits on: the latest one while no final verdict stands. */
function sdRedirectOf_(decs) {
  return sdFinalOf_(decs) ? null : sdLastRedirect_(decs);
}

function sdDecisionRow_(f) {
  var at = f.at || sdIso_(sdNowMs_());
  return { id: sdDecisionId_(f.ref, f.verdict, sdStr_(f.by_uid), at), ref: f.ref, source: f.source,
           verdict: f.verdict, note: sdText_(f.note, 2000), by_uid: sdStr_(f.by_uid), by_name: sdStr_(f.by_name),
           at: at, via: f.via || 'support-desk', witness: f.witness ? JSON.stringify(f.witness) : '',
           test_mode: sdTestWord_() };
}

function sdSourceOfRef_(ref) {
  if (/^SF/.test(ref)) return 'scheduling';
  if (/^SE/.test(ref)) return 'event';
  return 'queue';
}

/** One My Inbox item for one person, idempotent by ref, kind and recipient; `alert` names a raised alert's kind. */
function sdItem_(ref, kind, seat, to, title, body, houseLabel, date, alert) {
  return { id: sdItemId_(ref, kind, sdStr_(to.uid)), ref: ref, box: 'inbox', kind: kind, seat: seat,
           to_uid: sdStr_(to.uid), to_email: sdStr_(to.email), to_name: sdStr_(to.name),
           title: sdText_(title, 200), body: sdText_(sdMaskPhones_(body), 300), house_label: sdText_(houseLabel, 80),
           date: sdStr_(date), state: 'posted', answered_by: '', answered_at: '', note: '',
           link: '/app/support-desk/requests?ref=' + encodeURIComponent(ref), test_mode: sdTestWord_(),
           created_at: sdIso_(sdNowMs_()), alert: sdStr_(alert) };
}

/** Who a raised alert still reaches: a director or the master who turned it off is left out (AlertReceive.gs). */
function sdReceivers_(people, part) {
  return typeof arReceivers_ === 'function' ? arReceivers_(people, part) : (people || []);
}

/** The union of people lists, one per account. */
function sdUnion_() {
  var seen = {}, out = [];
  for (var i = 0; i < arguments.length; i++) {
    (arguments[i] || []).forEach(function (p) {
      if (!p || !p.uid || seen[p.uid]) return;
      seen[p.uid] = true;
      out.push(p);
    });
  }
  return out;
}

/** An event row with every column, its `details` JSON capped. */
function sdEventRow_(f) {
  var row = {};
  SD_HEADERS.support_events.forEach(function (h) { row[h] = ''; });
  for (var k in f) if (sdHas_(f, k)) row[k] = f[k];
  var d = typeof row.details === 'string' ? row.details : JSON.stringify(row.details || {});
  if (d.length > 4000) d = JSON.stringify({ cut: true, why: 'the details were longer than 4000 characters' });
  row.details = d;
  row.status = row.status || 'raised';
  row.test_mode = sdTestWord_();
  row.created_at = row.created_at || sdIso_(sdNowMs_());
  row.created_by = row.created_by || 'support-desk';
  return row;
}

// Writes the items absent so far, then the event when its id is absent.
function sdRaise_(ev, items) {
  var have = sdItemsByRef_()[ev.ref] || [];
  var known = {};
  have.forEach(function (it) { known[it.id] = true; });
  var fresh = (items || []).filter(function (it) {
    if (!it || !it.to_uid || known[it.id]) return false;
    known[it.id] = true;
    return true;
  });
  if (fresh.length) sdAppend_(SD_TABS.inbox, fresh);
  delete SD_MEMO.__items;
  if (sdEventById_(ev.id)) return { raised: false, already: true, items: fresh.length };
  sdAppend_(SD_TABS.events, [sdEventRow_(ev)]);
  delete SD_MEMO.__events;
  return { raised: true, already: false, items: fresh.length };
}

/* ---- texts: every one handed to Smart Comms ---- */

function sdLink_(path) {
  var base = '';
  try { base = (typeof mailPlatformUrl_ === 'function') ? mailPlatformUrl_() : ''; } catch (e) { base = ''; }
  return base + '/#' + path;
}

/** The outcome in one word: sent | held:<why> | off | no_phone | refused | failed | already. */
function sdOutcome_(r) {
  var s = sdStr_(r && r.state);
  if (s === 'held') return 'held:' + (sdStr_(r.held) || 'gated');
  return s || 'failed';
}

/** One text to one recipient's own phone through smartTell_; a recipient with no phone of their own is no_phone. */
function sdTell_(situation, to, vars, ref) {
  var u = sdUserByUid_(to.uid);
  var phone = sdPhoneOf_(u);
  if (!phone) return { state: 'no_phone', held: '', why: 'no phone of their own the send door accepts' };
  try {
    return smartTell_({ situation: situation, to: phone, vars: vars || {}, key: 'sr|' + situation + '|' + ref + '|' + to.uid,
                        person: sdStr_(to.name), lane: 'support requests', at_ms: sdNowMs_(), prune: true });
  } catch (e) {
    return { state: 'failed', held: '', why: sdErr_(e) };
  }
}

/** Says one situation to each recipient, writing the outcome on that recipient's item. Returns the told list. */
function sdTellAll_(situation, people, vars, ref, kind) {
  var told = [];
  var notes = [];
  (people || []).forEach(function (p) {
    var r = sdTell_(situation, p, vars, ref);
    var word = sdOutcome_(r);
    var itemId = sdItemId_(ref, kind, p.uid);
    told.push({ uid: p.uid, name: p.name, inbox_id: itemId, text: { situation: situation, state: word,
                                                                   why: sdText_(r.why, 160) } });
    notes.push({ id: itemId, word: word });
  });
  sdItemNotes_(notes);
  return told;
}

/** Writes "text: <outcome>" on items (only `note` changes); a write that fails leaves the outcome on the event. */
function sdItemNotes_(notes) {
  if (!notes.length) return;
  try {
    var by = {};
    sdRead_(SD_TABS.inbox).forEach(function (it) { by[it.id] = it; });
    var rows = [];
    notes.forEach(function (n) {
      var it = by[n.id];
      if (!it) return;
      it.note = 'text: ' + n.word;
      rows.push(it);
    });
    if (rows.length) sdUpsert_(SD_TABS.inbox, rows);
    delete SD_MEMO.__items;
  } catch (e) { /* the event keeps the outcome */ }
}

/* ---- the list ---- */

function sdSource_(key, state, why, count) {
  return { key: key, state: state, why: why || '', count: count || 0, as_of: sdIso_(sdNowMs_()) };
}

function sdQueueStatus_(book, final) {
  if (final) return { word: SD_FINAL[final.verdict], tone: final.verdict, completed: true };
  var s = sdStr_(book), low = s.toLowerCase();
  if (!low || low === 'new') return { word: s || 'New', tone: 'new', completed: false };
  if (/^(resolved|closed|done|completed)$/.test(low)) return { word: s, tone: 'resolved', completed: true };
  return { word: s, tone: 'pending', completed: false };
}

function sdHistoryOf_(decs) {
  return (decs || []).map(function (d) {
    var line = { at: d.at, by: d.by_name || (d.via === 'auto' ? 'Support Requests' : ''), verdict: d.verdict,
                 note: d.verdict === 'applied' ? sdAppliedWords_(d) : d.note, via: d.via };
    if (d.verdict === 'redirected') line.to = sdStr_((sdJson_(d.witness, {}) || {}).to_name);
    return line;
  });
}

function sdAppliedWords_(d) {
  var n = sdJson_(d.note, null);
  if (!n || !n.field) return sdStr_(d.note);
  return (n.field === 'address' ? 'Address' : n.field === 'email' ? 'E-mail' : 'Phone') + ' applied on the platform: ' +
         sdStr_(n.value);
}

function sdAcksOf_(decs) {
  var seen = {}, out = [];
  (decs || []).forEach(function (d) {
    if (d.verdict !== 'aware' || seen[d.by_uid]) return;
    seen[d.by_uid] = true;
    out.push({ uid: d.by_uid, name: d.by_name, at: d.at });
  });
  return out;
}

function sdDetail_(list, label, value) {
  var v = sdText_(value, 1200);
  if (v) list.push({ label: label, value: v });
}

/** The ADP block of a queue row, from its event and the decisions on its ref. */
function sdAdpOf_(ev, decs, on) {
  if (!ev) return on === false ? { state: 'off', field: '', words: '', proof: '', why: 'The ADP updates switch is off.' } : null;
  var d = sdJson_(ev.details, {}) || {};
  var state = sdStr_(d.state) || 'refused';
  var why = sdStr_(d.why);
  var approved = null;
  (decs || []).forEach(function (x) {
    if (x.verdict === 'applied') state = 'applied';
    else if (x.verdict === 'undone') state = 'undone';
    else if (x.verdict === 'approved') approved = x;
  });
  // an e-mail or phone is saved on the person's profile, never here: it reads as applied once the account holds it
  if (state === 'ready' && sdAdpHeld_(d)) state = 'applied';
  else if (state === 'ready' && approved) {
    why = 'Approved by ' + (sdStr_(approved.by_name) || 'a director') + ' — the account changes when Save is pressed ' +
          'on the profile.';
  }
  return { state: state, field: sdStr_(d.field), words: sdStr_(d.words), proof: state === 'ready' ? sdStr_(d.proof) : '',
           why: why };
}

/** The account already holds the prepared e-mail or phone: the same proof over what it holds. */
function sdAdpHeld_(d) {
  var uid = sdStr_(d && d.uid), field = sdStr_(d && d.field), proof = sdStr_(d && d.proof);
  if (!uid || !proof || (field !== 'email' && field !== 'phone')) return false;
  var u = null;
  try { u = sdUserByUid_(uid); } catch (e) { u = null; }
  if (!u) return false;
  var held = field === 'email'
    ? [sdStr_(u.email)].concat(profileParseEmails_(u.emails)).map(function (e) { return sdStr_(e).toLowerCase(); })
    : [u.phone].concat(profileParsePhones_(u.phones).map(function (p) { return p && p.number; })).map(function (n) {
        var dd = sdDigits10_(n);
        return dd.length === 10 ? '(' + dd.slice(0, 3) + ') ' + dd.slice(3, 6) + '-' + dd.slice(6) : '';
      });
  return held.some(function (v) { return !!v && sdSha10_(uid + '|' + field + '|' + v) === proof; });
}

/** Where the approval of a prepared e-mail or phone is saved: the person's profile, its contacts opened with it. */
function sdAdpOpen_(j) {
  var add = j.field === 'email' ? 'add_email' : 'add_phone';
  return { uid: j.uid, field: j.field, value: j.value,
           href: '/app/users/profile?u=' + encodeURIComponent(j.uid) + '&contacts=1&' + add + '=' +
                 encodeURIComponent(j.value) };
}

function sdToldWords_(told) {
  return (told || []).map(function (t) {
    var s = sdStr_(t && t.text && t.text.state);
    return sdStr_(t.name) + (s ? ' (text ' + s.replace(':', ': ') + ')' : '');
  }).join(', ');
}

/** The queue's rows (call-offs a Scheduling flow already holds are folded into it by the caller). */
function sdQueueRows_(queue, decsBy, eventsByRef, routes, autos) {
  return queue.map(function (q) {
    var r = q.row;
    var decs = decsBy[q.ref] || [];
    var final = sdFinalOf_(decs);
    var st = sdQueueStatus_(r.status, final);
    var redirect = sdRedirectOf_(decs);
    var last = sdLastRedirect_(decs);
    if (redirect && !st.completed) st = { word: 'Redirected to ' + redirect.to_name, tone: 'waiting', completed: false };
    var type = sdTypeParts_(r.type_of_request);
    var route = sdRouteOf_(r.type_of_request, routes);
    var callOff = sdIsCallOff_(r.type_of_request);
    var details = [];
    sdDetail_(details, 'Urgency', sdUrgency_(r.urgency));
    sdDetail_(details, 'Received', sdStampWords_(sdReceivedOf_(r)));
    sdDetail_(details, 'Call ID', sdCallIdOf_(r.notes));
    if (final) sdDetail_(details, 'Queue status', r.status);
    sdDetail_(details, 'Notes', sdMaskPhones_(String(r.notes || '').replace(/Call ID:\s*AC[0-9a-f]+/i, '')));
    sdDetail_(details, 'Processed', r.processed);
    var routeEv = (eventsByRef[q.ref] || []).filter(function (e) { return e.kind === 'route'; })[0] || null;
    if (routeEv) {
      var rd = sdJson_(routeEv.details, {}) || {};
      sdDetail_(details, 'Routed', (route ? route.replace('_', ' ') : 'routed') + ' — told ' + (sdToldWords_(rd.told) || 'nobody'));
    }
    var adpEv = (eventsByRef[q.ref] || []).filter(function (e) { return e.kind === 'adp'; })[0] || null;
    var out = {
      ref: q.ref, source: 'queue', kind: callOff ? 'call_off' : (route === 'adp_update' ? 'adp' : 'request'),
      status: { word: st.word, tone: st.tone }, date: sdWhenOf_(sdReceivedOf_(r)),
      requestor: { name: sdText_(r.requestor, 120), uid: sdUidByName_(r.requestor) }, type: type,
      urgency: sdUrgency_(r.urgency), description: sdText_(r.description_of_request, 4000), route: route,
      completed: st.completed, details: details, history: sdHistoryOf_(decs), acks: sdAcksOf_(decs),
      waiting_on: [], link: '/app/support-desk/requests?ref=' + encodeURIComponent(q.ref),
      _vis: (route === 'general') ? 'lead' : 'director', _final: final ? final.verdict : '',
      _final_by: final ? sdStr_(final.by_name) : '', _final_at: final ? sdStr_(final.at) : '',
      _call_id: sdCallIdOf_(r.notes), _book_row: q.book_row,
      _redirect: redirect, _last_to: last ? last.to_uid : ''
    };
    if (route === 'adp_update') {
      var adp = sdAdpOf_(adpEv, decs, autos ? autos.adp_update : null);
      if (adp) out.adp = adp;
    }
    return out;
  });
}

function sdEventStatus_(ev, decs, items, directors) {
  var acks = sdAcksOf_(decs);
  var final = sdFinalOf_(decs);
  if (ev.kind === 'incident') {
    if (final) return { word: SD_FINAL[final.verdict], tone: final.verdict, completed: true, waiting: [] };
    return { word: 'Important — incident filed', tone: 'important', completed: false, waiting: [] };
  }
  var addressed = (items || []).filter(function (it) { return it.seat === 'director'; })
    .map(function (it) { return { uid: it.to_uid, name: it.to_name }; });
  if (!addressed.length) addressed = directors.slice();
  var acked = {};
  acks.forEach(function (a) { acked[a.uid] = a; });
  var waiting = addressed.filter(function (d) { return !acked[d.uid]; });
  if (addressed.length && !waiting.length) {
    return { word: 'Aware — ' + addressed.map(function (d) {
      return sdFirst_(d.name || acked[d.uid].name) + ' ' + sdClockWords_(acked[d.uid].at);
    }).join(' · '), tone: 'aware', completed: true, waiting: [] };
  }
  return { word: 'Directors, are you aware?', tone: 'warning', completed: false,
           waiting: waiting.map(function (d) { return d.name; }) };
}

/** The warnings and incidents the platform raised (route, adp and vacation events decorate other rows). */
function sdEventRows_(events, decsBy, itemsBy, directors) {
  var out = [];
  events.forEach(function (ev) {
    if (!SD_WARNING_KINDS[ev.kind] && ev.kind !== 'incident') return;
    var d = sdJson_(ev.details, {}) || {};
    var decs = decsBy[ev.ref] || [];
    var st = sdEventStatus_(ev, decs, itemsBy[ev.ref] || [], directors);
    var redirect = ev.kind === 'incident' ? sdRedirectOf_(decs) : null;
    var last = ev.kind === 'incident' ? sdLastRedirect_(decs) : null;
    if (redirect && !st.completed) st = { word: 'Redirected to ' + redirect.to_name, tone: st.tone, completed: false, waiting: [redirect.to_name] };
    var details = [];
    if (ev.kind === 'incident') {
      sdDetail_(details, 'Category', d.incident_category);
      sdDetail_(details, 'Location', d.incident_location);
      sdDetail_(details, 'Day', sdDayWords_(d.day));
      sdDetail_(details, 'Filed through', d.via);
      sdDetail_(details, 'Report', 'Open Incidents for the report.');
    } else {
      sdDetail_(details, 'House', d.house_name || d.house || ev.house);
      sdDetail_(details, 'Shift', d.shift_code);
      sdDetail_(details, 'Day', sdDayWords_(ev.day));
      if (ev.kind === 'punch') {
        sdDetail_(details, 'Not punching', d.direction);
        sdDetail_(details, 'Clock read', sdStampWords_(d.read_at));
      } else {
        sdDetail_(details, 'Minutes late', d.minutes_late);
        sdDetail_(details, 'Seen by', d.source === 'clock' ? 'the time clock' : d.source === 'form' ? 'the call-off form' :
                                    d.source === 'mail' ? 'the mailbox' : d.source);
      }
    }
    out.push({
      ref: ev.ref, source: 'event', kind: ev.kind, status: { word: st.word, tone: st.tone },
      date: sdWhenOf_(ev.at) || sdWhenOf_(ev.created_at), requestor: { name: sdStr_(ev.person), uid: sdStr_(ev.person_uid) },
      type: sdTypeOfCategory_(ev.category), urgency: ev.kind === 'incident' ? 'High' : '', description: sdStr_(ev.title),
      route: '', completed: st.completed, details: details, history: sdHistoryOf_(decs), acks: sdAcksOf_(decs),
      waiting_on: st.waiting, link: '/app/support-desk/requests?ref=' + encodeURIComponent(ev.ref),
      _vis: (ev.kind === 'incident' || ev.kind === 'punch') ? 'lead' : 'director',
      _final: (sdFinalOf_(decs) || {}).verdict || '', _final_by: sdStr_((sdFinalOf_(decs) || {}).by_name),
      _final_at: sdStr_((sdFinalOf_(decs) || {}).at), _redirect: redirect, _last_to: last ? last.to_uid : ''
    });
  });
  return out;
}

function sdSchedStatus_(f) {
  var s = sdStr_(f.state);
  var seats = sdJson_(f.seats, []) || [];
  var waitingSeat = null;
  (Array.isArray(seats) ? seats : []).forEach(function (x) { if (!waitingSeat && x && x.state === 'waiting') waitingSeat = x; });
  var names = waitingSeat ? (waitingSeat.to || []).map(function (t) { return sdStr_(t && t.name); }).filter(String) : [];
  if (SD_SCHED_WAITING[s]) return { word: 'Waiting on ' + (names.join(', ') || 'an answer'), tone: 'waiting', completed: false, waiting: names };
  var map = { approved: ['Approved', 'approved'], approved_future: ['Approved', 'approved'], declined: ['Declined', 'denied'],
              expired: ['Expired', 'closed'], withdrawn: ['Withdrawn', 'closed'], cancelled: ['Cancelled', 'closed'],
              done: ['Done', 'resolved'], covered: ['Covered', 'resolved'], stopped: ['Stopped', 'closed'], needs_human: ['Needs a person', 'warning'],
              outreach_1: ['Looking for cover', 'pending'], outreach_wait: ['Looking for cover', 'pending'],
              outreach_2: ['Looking for cover', 'pending'] };
  var hit = map[s] || [s || 'Open', 'pending'];
  return { word: hit[0], tone: hit[1], completed: !!SD_SCHED_CLOSED[s], waiting: [] };
}

function sdSchedType_(kind) {
  if (kind === 'call_off' || kind === 'phone') return sdTypeParts_('Schedule - Call Off');
  if (kind === 'time_off' || kind === 'request_off') return sdTypeParts_('Schedule - Time Off Request');
  return sdTypeParts_('Schedule - Shift Changes');
}

function sdSchedHouse_(code) {
  try { return sdStr_(schedHouseLabel_(code)) || sdStr_(code); } catch (e) { return sdStr_(code); }
}

function sdSchedShift_(f) {
  try {
    return sdStr_(schedShiftWords_({ text: f.shift_text, start_min: f.start_min, end_min: f.end_min })) || sdStr_(f.shift_text);
  } catch (e) { return sdStr_(f.shift_text); }
}

/** A swap's partner shift when it is an exchange (Scheduling.gs schedExchangeOf_), or null. */
function sdSchedExchange_(f) {
  try { return typeof schedExchangeOf_ === 'function' ? schedExchangeOf_(f) : null; } catch (e) { return null; }
}

/** The partner shift of an exchange in words: 'Wed 10/7 4P-12A at FT'. */
function sdSchedExchangeWhere_(ex) {
  var shift = sdSchedShift_({ shift_text: ex.text, start_min: ex.start_min, end_min: ex.end_min });
  return [sdDayWords_(ex.date), shift, 'at ' + sdSchedHouse_(ex.house)].filter(String).join(' ');
}

function sdSchedDescription_(f) {
  var house = f.house_code ? sdSchedHouse_(f.house_code) : '';
  var shift = sdSchedShift_(f);
  var day = sdDayWords_(f.date);
  var where = [day, shift, house ? 'at ' + house : ''].filter(String).join(' ');
  var ex = f.kind === 'swap' ? sdSchedExchange_(f) : null;
  if (ex) {
    return 'Swap: ' + sdStr_(f.person) + ' ⇄ ' + sdStr_(f.replacement) + ' — ' + where + ' · ' + sdSchedExchangeWhere_(ex);
  }
  if (f.kind === 'call_off') return 'Called off — ' + where;
  if (f.kind === 'phone') return 'Called off by phone — a person has to find the shift: ' + where;
  if (f.kind === 'request_off') return 'Request Off · one shift — ' + where;
  if (f.kind === 'time_off') return 'Time off ' + sdDayWords_(f.date) + ' to ' + sdDayWords_(f.date_to || f.date);
  if (f.kind === 'swap') return 'Swap: ' + sdStr_(f.person) + ' to ' + sdStr_(f.replacement) + ' — ' + where;
  return 'Open shift taken by ' + sdStr_(f.person) + ' — ' + where;
}

/** Scheduling's own flows as rows, read through Scheduling's own readers: no copy, no write. */
function sdSchedRows_(decsBy, eventsByRef, sources) {
  if (!sdHasSched_()) {
    sources.push(sdSource_('scheduling', 'unreadable', 'Scheduling\'s houses are not set up yet'));
    return { rows: [], byCall: {} };
  }
  var flows, inbox;
  try {
    flows = schedRead_(SCHED_TABS.flows);
    inbox = schedRead_(SCHED_TABS.inbox);
  } catch (e) {
    sources.push(sdSource_('scheduling', 'unreadable', sdErr_(e)));
    return { rows: [], byCall: {} };
  }
  var itemsBy = {};
  inbox.forEach(function (it) { (itemsBy[it.flow_id] = itemsBy[it.flow_id] || []).push(it); });
  var children = {};
  flows.forEach(function (f) {
    if (f.kind === 'call_off' && /^SF[0-9A-F]{10}$/.test(sdStr_(f.source_ref))) {
      (children[f.source_ref] = children[f.source_ref] || []).push(f);
    }
  });
  var rows = [], byCall = {};
  flows.forEach(function (f) {
    if (!SD_SCHED_KINDS[f.kind]) return;
    if (f.kind === 'call_off' && /^SF[0-9A-F]{10}$/.test(sdStr_(f.source_ref))) return;
    var st = sdSchedStatus_(f);
    if (f.kind === 'take' && !st.completed) return;
    var seats = sdJson_(f.seats, []) || [];
    var decs = decsBy[f.id] || [];
    var details = [];
    if (f.house_code) sdDetail_(details, 'House', sdSchedHouse_(f.house_code));
    sdDetail_(details, f.kind === 'time_off' ? 'Days' : 'Day',
              f.kind === 'time_off' ? sdDayWords_(f.date) + ' to ' + sdDayWords_(f.date_to || f.date) : sdDayWords_(f.date));
    if (f.kind !== 'time_off') sdDetail_(details, 'Shift', sdSchedShift_(f));
    sdDetail_(details, 'Filed', f.source === 'hotline' ? 'by phone' : f.source === 'editor' ? 'by an editor' :
                                f.source_ref === 'my-calendar' ? 'from My Calendar' : 'on the platform');
    var exch = f.kind === 'swap' ? sdSchedExchange_(f) : null;
    if (exch) {
      sdDetail_(details, 'Swapped with', f.replacement);
      sdDetail_(details, 'Their shift', sdSchedExchangeWhere_(exch));
    } else if (f.replacement) sdDetail_(details, 'Replacement', f.replacement);
    if (f.kind === 'call_off' || f.kind === 'phone') sdDetail_(details, 'Reason', f.reason);
    var kids = children[f.id] || [];
    if (kids.length) {
      sdDetail_(details, 'Open shifts', kids.length + ' opened — ' + kids.map(function (k) {
        return sdDayWords_(k.date) + ' ' + sdSchedStatus_(k).word.toLowerCase();
      }).join(', '));
    }
    var vac = (eventsByRef[f.id] || []).filter(function (e) { return e.kind === 'vacation'; })[0];
    if (vac) sdDetail_(details, 'My Calendar', 'Asked from My Calendar → Vacation Requests');
    var history = sdHistoryOf_(decs);
    (Array.isArray(seats) ? seats : []).forEach(function (s) {
      if (s && (s.state === 'approved' || s.state === 'declined') && s.at) {
        history.push({ at: s.at, by: sdStr_(s.by), verdict: s.state, note: sdStr_(s.note), via: 'scheduling' });
      }
    });
    var items = itemsBy[f.id] || [];
    var acks = [];
    items.forEach(function (it) {
      if (it.box === 'inbox' && it.kind === 'warning' && sdStr_(it.answered_at)) {
        acks.push({ uid: it.to_uid, name: it.answered_by || it.to_name, at: it.answered_at });
        history.push({ at: it.answered_at, by: it.answered_by || it.to_name, verdict: 'aware', note: '', via: 'my-inbox' });
      }
    });
    history.sort(function (a, b) { return sdStr_(a.at) < sdStr_(b.at) ? -1 : sdStr_(a.at) > sdStr_(b.at) ? 1 : 0; });
    var row = {
      ref: f.id, source: 'scheduling', kind: f.kind, status: { word: st.word, tone: st.tone },
      date: sdWhenOf_(f.created_at) || sdStr_(f.date), requestor: { name: sdStr_(f.person), uid: sdStr_(f.person_uid) },
      type: sdSchedType_(f.kind), urgency: '', description: sdSchedDescription_(f), route: '', completed: st.completed,
      details: details, history: history, acks: acks, waiting_on: st.waiting,
      sched: { flow_id: f.id, state: sdStr_(f.state), item_id: '', words: [],
               seats: (Array.isArray(seats) ? seats : []).map(function (s) {
                 return { seat: sdStr_(s && s.seat), state: sdStr_(s && s.state),
                          to: ((s && s.to) || []).map(function (t) { return sdStr_(t && t.name); }),
                          by: sdStr_(s && s.by), at: sdStr_(s && s.at), note: sdStr_(s && s.note),
                          house: s && s.house ? sdSchedHouse_(s.house) : '' };
               }) },
      link: f.house_code ? '/app/scheduling/calendar?house=' + encodeURIComponent(f.house_code) + '&day=' +
                           encodeURIComponent(sdStr_(f.date)) : '/app/scheduling/calendar',
      _vis: 'director',
      _items: items.map(function (it) {
        return { id: it.id, box: it.box, kind: it.kind, seat: sdStr_(it.seat), to_uid: it.to_uid, state: it.state,
                 answered_at: sdStr_(it.answered_at), answered_by: sdStr_(it.answered_by) };
      })
    };
    rows.push(row);
    var instance = sdStr_(f.source_ref);
    var cut = instance.indexOf(':calloff:');
    if (cut > 0) (byCall[instance.slice(0, cut)] = byCall[instance.slice(0, cut)] || []).push(row);
  });
  sources.push(sdSource_('scheduling', 'ready', '', rows.length));
  return { rows: rows, byCall: byCall };
}

function sdHasSched_() {
  try { return typeof schedHouseReady_ === 'function' && schedHouseReady_(SCHED_TABS.flows) && schedHouseReady_(SCHED_TABS.inbox); }
  catch (e) { return false; }
}

// What the list is built from outside its own houses, Scheduling's and the queue's — the day, the switches, the…
function sdOutsideStamp_() {
  var parts = [sdDayOfMs_(sdNowMs_())];
  var autos = null;
  try { autos = hubMyWorkAutoRead_(); } catch (eA) { autos = null; }
  parts.push(JSON.stringify(autos), JSON.stringify(sdDirectors_()), JSON.stringify(sdLeads_()));
  var all = null;
  try { all = usersAll_() || []; } catch (eU) { all = null; }
  if (!all) parts.push('accounts unreadable');
  else all.forEach(function (u) {
    parts.push([u.userid, u.displayname, u.email, u.emails, u.phone, u.phones, u.active, u.mergedinto].map(sdStr_).join('|'));
  });
  try { return sdSha10_(parts.join('\n')); } catch (e) { return ''; }
}

/** Everything about the list nobody's eyes change, cached under the houses' and the queue's versions. */
function sdBase_(fresh) {
  var v = sdVersion_(), sv = '', qv = '';
  try { sv = schedVersion_(); } catch (e) { sv = ''; }
  try { var src = estateSource_('supportQueue'); qv = src ? cacheVersion_(cacheScopeSheet_(src.id, src.tab)) : ''; } catch (eQ) { qv = ''; }
  var stamp = v ? sdOutsideStamp_() : '';
  var key = (v && stamp && sv !== null) ? 'sd_list2:' + v + ':' + sv + ':' + qv + ':' + stamp : '';
  if (!fresh && SD_MEMO.__base && SD_MEMO.__base_key === key && key) return SD_MEMO.__base;
  var got = (!fresh && key) ? sdCacheGet_(key) : null;
  if (!got) {
    got = sdBaseBuild_();
    // a list with a source missing is never kept: the next read asks again
    var whole = got.sources.every(function (s) { return s.state === 'ready'; });
    if (key && whole) sdCachePut_(key, got);
  }
  SD_MEMO.__base = got;
  SD_MEMO.__base_key = key;
  return got;
}

function sdBaseBuild_() {
  var sources = [];
  var nowMs = sdNowMs_();
  var st = sdSettings_();
  var autos = null;
  try { autos = hubMyWorkAutoRead_(); } catch (eA) { autos = null; }
  var decsBy = {}, decsOk = true;
  try { decsBy = sdDecisionsByRef_(); sources.push(sdSource_('decisions', 'ready', '', sdRead_(SD_TABS.decisions).length)); }
  catch (eD) { decsOk = false; sources.push(sdSource_('decisions', 'unreadable', sdErr_(eD))); }
  var events = [], eventsByRef = {};
  try {
    events = sdEvents_();
    events.forEach(function (e) { (eventsByRef[e.ref] = eventsByRef[e.ref] || []).push(e); });
    sources.push(sdSource_('events', 'ready', '', events.length));
  } catch (eE) { sources.push(sdSource_('events', 'unreadable', sdErr_(eE))); }
  var itemsBy = {};
  try { itemsBy = sdItemsByRef_(); sources.push(sdSource_('inbox', 'ready', '', sdRead_(SD_TABS.inbox).length)); }
  catch (eI) { sources.push(sdSource_('inbox', 'unreadable', sdErr_(eI))); }
  var dirs = sdDirectors_();
  var sched;
  try { sched = sdSchedRows_(decsBy, eventsByRef, sources); }
  catch (eS) {
    sources.push(sdSource_('scheduling', 'unreadable', sdErr_(eS)));
    sched = { rows: [], byCall: {} };
  }
  var queueRows = [];
  try {
    var queue = sdQueueAll_();
    queueRows = sdQueueRows_(queue, decsBy, eventsByRef, st.routes, autos);
    sources.unshift(sdSource_('queue', 'ready', '', queue.length));
  } catch (eQ) {
    sources.unshift(sdSource_('queue', 'unreadable', 'The Support Queue book could not be read: ' + sdErr_(eQ)));
  }
  // a phone call-off Scheduling already holds is shown once: as the flow, naming the queue row
  var folded = {};
  var keep = [];
  var usedByCall = {};
  queueRows.forEach(function (row) {
    if (row.kind === 'call_off' && row._call_id && sched.byCall[row._call_id]) {
      var n = usedByCall[row._call_id] || 0;
      var flowRow = sched.byCall[row._call_id][n];
      if (flowRow) {
        usedByCall[row._call_id] = n + 1;
        flowRow.details.push({ label: 'Phone request', value: row.ref });
        folded[row.ref] = flowRow.ref;
        return;
      }
    }
    keep.push(row);
  });
  var dirNames = dirs.list.map(function (d) { return d.name; });
  keep.forEach(function (r) { if (!r.completed) r.waiting_on = r._redirect ? [r._redirect.to_name] : dirNames.slice(); });
  var rows = keep.concat(sched.rows).concat(sdEventRows_(events, decsBy, itemsBy, dirs.list));
  rows.forEach(function (r) {
    r._items = r._items || (itemsBy[r.ref] || []).map(function (it) {
      return { id: it.id, box: it.box, kind: it.kind, seat: it.seat, to_uid: it.to_uid, to_name: it.to_name,
               state: it.state, answered_at: sdStr_(it.answered_at), answered_by: sdStr_(it.answered_by) };
    });
  });
  rows.sort(function (a, b) {
    var x = sdStr_(a.date), y = sdStr_(b.date);
    return x < y ? 1 : x > y ? -1 : 0;
  });
  var tm = sdTestMode_();
  return { now: sdIso_(nowMs), today: sdDayOfMs_(nowMs), rows: rows, sources: sources, decisions_ok: decsOk,
           folded: folded, test_mode: tm, directors: dirs, leads: sdLeads_(), autos: autos,
           routes_why: st.routes_why };
}

// The viewer's own Scheduling item for a row: a waiting approval, else an unanswered warning.
function sdSchedItemFor_(row, g) {
  var uid = g && g.uid;
  var work = null, warn = null, seat = null;
  var standIn = !!(g && g.is_master && uid && !(row.requestor && row.requestor.uid === uid));
  (row._items || []).forEach(function (it) {
    if (standIn && !seat && it.box === 'work' && it.state === 'waiting' && it.seat === 'director') seat = it;
    if (!uid || it.to_uid !== uid) return;
    if (it.box === 'work' && it.state === 'waiting') work = it;
    if (it.box === 'inbox' && it.kind === 'warning' && !it.answered_at) warn = it;
  });
  return work || seat || warn;
}

function sdOwnItem_(row, uid) {
  var hit = null;
  (row._items || []).forEach(function (it) { if (it.to_uid === uid && it.box !== SD_WORK_BOX && !hit) hit = it; });
  return hit;
}

/** Whether the request waits on this viewer because it was redirected to them. */
function sdHolds_(row, g) {
  return !!(row._redirect && g.uid && row._redirect.to_uid === g.uid);
}

/** What this viewer may press on this row, and why not when nothing. */
function sdMay_(row, g, base) {
  var may = { approve: false, deny: false, resolve: false, aware: false, redirect: false, why: '' };
  if (row.source === 'scheduling') {
    var it = sdSchedItemFor_(row, g);
    if (it && it.box === 'work') { may.approve = true; may.deny = true; }
    else if (it) { may.aware = true; }
    else if (row.completed) may.why = 'This request is ' + row.status.word.toLowerCase() + '.';
    else if (row.waiting_on.length) {
      may.why = g.is_master && !g.is_director
        ? 'Waiting on ' + row.waiting_on.join(', ') + ' — the first answer decides.'
        : 'This one is waiting on ' + row.waiting_on.join(', ') + '.';
    } else may.why = 'Nothing here is waiting on you.';
    return may;
  }
  if (!base.directors.readable) { may.why = base.directors.why; return may; }
  var own = sdOwnItem_(row, g.uid);
  var acked = (row.acks || []).some(function (a) { return a.uid === g.uid; });
  var holds = sdHolds_(row, g);
  if (row.source === 'event') {
    may.aware = !acked && (!!(own && !own.answered_at) || g.is_director || g.is_master);
    if (row.kind === 'incident' && !row.completed) {
      may.resolve = g.is_director || g.is_master || holds;
      may.redirect = may.resolve;
    }
    if (!may.aware && !may.resolve) {
      may.why = acked ? 'You marked this as aware.' : row.completed ? 'This one is closed.'
        : 'Only the people it was addressed to mark it.';
    }
    return may;
  }
  if (row._final) {
    may.why = 'Already ' + row._final + ' by ' + (row._final_by || 'someone') + '.';
    return may;
  }
  if (g.is_director || g.is_master || holds) {
    may.approve = true; may.deny = true; may.resolve = true; may.redirect = true;
  }
  else may.why = 'Only the directors decide requests.';
  if (row.completed && !row._final) {
    may.approve = false; may.deny = false; may.resolve = false; may.redirect = false;
    may.why = 'The queue already says ' + row.status.word + '.';
  }
  return may;
}

/** The base cut for one viewer: who sees which rows, what each may press, the internals stripped. */
function sdCut_(base, g, opts) {
  var o = opts || {};
  var wantCompleted = o.completed === true;
  var since = Number(o.since_days) > 0 ? sdDayAdd_(base.today, -Math.floor(Number(o.since_days))) : '';
  var sees = function (row) {
    if (g.is_master || g.is_director || g.is_watcher || sdHolds_(row, g)) return true;
    if (g.is_lead) return row._vis === 'lead';
    return false;
  };
  var counts = { open: 0, waiting_on_me: 0, warnings: 0, completed: 0 };
  var rows = [];
  base.rows.forEach(function (row) {
    if (!sees(row)) return;
    if (row.completed) counts.completed++;
    if (!wantCompleted && row.completed) return;
    if (since && sdStr_(row.date).slice(0, 10) < since) return;
    var out = {};
    for (var k in row) if (sdHas_(row, k) && k.charAt(0) !== '_') out[k] = row[k];
    out.may = sdMay_(row, g, base);
    if (row.source === 'scheduling') {
      var it = sdSchedItemFor_(row, g);
      out.sched = JSON.parse(JSON.stringify(row.sched));
      out.sched.item_id = it ? it.id : '';
      out.sched.words = it ? (it.box === 'work' ? ['approve', 'decline'] : ['seen']) : [];
    }
    if (!row.completed) {
      counts.open++;
      if (row.status.tone === 'warning') counts.warnings++;
    }
    if (out.may.approve || out.may.deny || out.may.aware) counts.waiting_on_me++;
    rows.push(out);
  });
  return { rows: rows, counts: counts };
}

/* ---- the actions ---- */

HUB_POLICY.supportDeskList = {
  file: 'SupportDesk.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { completed: { type: 'boolean' }, since_days: { type: 'number' } }
};
HUB_ACTIONS.supportDeskList = function (payload, user) {
  var g = sdGate_(user);
  if (!g.open) return sdRefuse_(404, 'Unknown action.');
  var p = payload || {};
  var base;
  try { base = sdBase_(false); }
  catch (e) { return sdRefuse_(503, 'Support Requests could not be read just now (' + sdErr_(e) + ').'); }
  var cut = sdCut_(base, g, { completed: p.completed === true, since_days: p.since_days });
  // an unreadable source is said by its own entry in `sources` (the screen draws one line each), never twice here
  var notes = [];
  if (base.directors.from === 'support') notes.push(base.directors.why);
  if (!base.directors.readable) notes.push(base.directors.why);
  if (base.leads && base.leads.why) notes.push('Leads: ' + base.leads.why + '.');
  if (base.routes_why) notes.push(base.routes_why);
  var privileged = g.is_master || g.is_director || g.is_lead || g.is_watcher;
  if (!privileged) notes = [cut.rows.length ? 'Only the requests redirected to you are shown.' : 'Requests are shown to the directors.'];
  else if (g.is_watcher && !g.can_decide) notes.push('You see every request; the directors decide them.');
  var autos = null;
  try { autos = hubMyWorkAutoRead_(); } catch (eA) { autos = null; }
  var automations = {};
  Object.keys(MYWORK_AUTO_KEYS).forEach(function (k) { automations[k] = autos ? autos[k] === true : null; });
  var redirects = g.is_master || g.is_director || cut.rows.some(function (r) { return r.may.redirect; });
  var pickers = redirects ? sdPickersFor_(g.uid) : { list: [], why: '' };
  return { status: 200, data: {
    ok: true, now: sdIso_(sdNowMs_()), today: base.today,
    viewer: { uid: g.uid, name: g.name, is_master: g.is_master, is_director: g.is_director, is_lead: g.is_lead,
              is_watcher: g.is_watcher, can_decide: g.can_decide },
    test_mode: sdTestMode_(),
    directors: base.directors.list.map(function (d) { return { uid: d.uid, name: d.name }; }),
    leads: base.leads.list.map(function (d) { return { uid: d.uid, name: d.name }; }),
    directors_readable: base.directors.readable, directors_why: base.directors.why,
    automations: automations,
    sources: privileged ? base.sources : [],
    rows: cut.rows,
    counts: cut.counts,
    people: pickers.list, people_why: pickers.why,
    note: notes.join(' ')
  } };
};

/* ---- redirect: one request handed to one account's My Work ---- */

// Live staff-side accounts a request may be redirected to, the viewer left out: { list:[{uid, name}], why }.
function sdPickersFor_(uid) {
  var all = null;
  try { all = usersAll_(); } catch (e) { return { list: [], why: 'The accounts could not be read (' + sdErr_(e) + ').' }; }
  if (!Array.isArray(all)) return { list: [], why: 'The accounts could not be read.' };
  var byName = {};
  all.forEach(function (u) {
    if (!sdLive_(u) || SD_STAFF_ROLES.indexOf(sdStr_(u.role).toLowerCase()) === -1) return;
    if (typeof hubIsMasterRow_ === 'function' && hubIsMasterRow_(u)) return;
    var id = sdStr_(u.userid), name = sdStr_(u.displayname);
    var k = '';
    try { k = hubNameFold_(name); } catch (eK) { k = name.toLowerCase(); }
    if (!id || !k) return;
    (byName[k] = byName[k] || []).push({ uid: id, name: name });
  });
  var list = [], twins = 0;
  Object.keys(byName).forEach(function (k) {
    if (byName[k].length > 1) { twins++; return; }
    if (byName[k][0].uid !== uid) list.push(byName[k][0]);
  });
  list.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return { list: list, why: twins ? twins + (twins === 1 ? ' name is' : ' names are') + ' worn by two live accounts and ' +
                                    'left out of the list.' : '' };
}

/** The account a redirect hands a request to, found here by its id: live and staff-side, or a refusal. */
function sdRedirectTarget_(uid) {
  var want = sdText_(uid, 80);
  if (!want) return sdRefuse_(400, 'Choose who to redirect it to.');
  var all = null;
  try { all = usersAll_(); } catch (e) { all = null; }
  if (!Array.isArray(all)) return sdRefuse_(503, 'The accounts could not be read, so it was not redirected — try again.');
  var hit = null;
  all.forEach(function (u) { if (sdStr_(u.userid) === want && sdLive_(u)) hit = u; });
  if (!hit) return sdRefuse_(400, 'That account is not a live account on the platform — choose another person.');
  if (SD_STAFF_ROLES.indexOf(sdStr_(hit.role).toLowerCase()) === -1) {
    return sdRefuse_(400, 'A request is redirected to a staff account only — choose another person.');
  }
  var name = sdStr_(hit.displayname);
  if (!name) return sdRefuse_(400, 'That account carries no name — choose another person.');
  return { uid: want, name: name, email: sdStr_(hit.email).toLowerCase() };
}

// The account the latest redirect of a request named: it reads and answers that one request whatever the app's…
function sdSeatGate_(user, ref) {
  if (!user || user.is_service || sdVisiting_(user) || !SD_SEAT_REF.test(sdStr_(ref))) return null;
  var uid = '';
  try { uid = sdStr_(hubActingUserId_(user)); } catch (e) { uid = ''; }
  if (!uid) return null;
  var last = null;
  try { last = sdLastRedirect_(sdDecisionsByRef_()[ref] || []); } catch (eD) { return null; }
  if (!last || last.to_uid !== uid) return null;
  return { open: true, seat: true, uid: uid, name: sdActorName_(user), email: sdStr_(user.email).toLowerCase(),
           is_master: false, is_director: false, is_lead: false, can_decide: false };
}

/** The My Work item a redirect opens for its holder: one per redirect, answered through supportDeskDecide. */
function sdWorkItem_(row, to, decisionId, byName, note) {
  var title = row.type.display + ' from ' + (row.requestor.name || 'an unknown caller');
  var it = sdItem_(row.ref, SD_REDIRECT, SD_REDIRECT, to, title, row.description, '', '');
  it.id = sdItemId_(row.ref, SD_REDIRECT, sdStr_(to.uid) + '|' + decisionId);
  it.box = SD_WORK_BOX;
  it.state = 'waiting';
  it.note = sdText_('Redirected by ' + byName + (note ? ': ' + note : ''), 300);
  return it;
}

/** Closes the request's waiting My Work items, each marked with what closed it. */
function sdSeatsClose_(ref, state, by, at) {
  delete SD_MEMO[SD_TABS.inbox];
  delete SD_MEMO.__items;
  var open = (sdItemsByRef_()[ref] || []).filter(function (it) { return it.box === SD_WORK_BOX && it.state === 'waiting'; });
  open.forEach(function (it) { it.state = state; it.answered_by = by; it.answered_at = at; });
  if (open.length) sdUpsert_(SD_TABS.inbox, open);
  return open.length;
}

/** A redirect: recorded like every verdict but never final — the request stays open, waiting in the holder's My Work. */
function sdRedirect_(row, to, note, g) {
  return sdLock_(function () {
    delete SD_MEMO[SD_TABS.decisions];
    delete SD_MEMO.__decs;
    var decs = sdDecisionsByRef_()[row.ref] || [];
    var final = sdFinalOf_(decs);
    if (final) {
      return sdRefuse_(409, 'Already ' + final.verdict + ' by ' + (sdStr_(final.by_name) || 'someone') + ' at ' +
                            sdStampWords_(final.at) + '.');
    }
    var open = sdRedirectOf_(decs);
    delete SD_MEMO[SD_TABS.inbox];
    delete SD_MEMO.__items;
    var seated = (sdItemsByRef_()[row.ref] || []).some(function (it) {
      return it.box === SD_WORK_BOX && it.state === 'waiting' && it.to_uid === to.uid;
    });
    if (open && open.to_uid === to.uid && seated) {
      return { ok: true, changed: false, said: 'Already redirected to ' + to.name + '.' };
    }
    var at = sdIso_(sdNowMs_());
    var dec = sdDecisionRow_({ ref: row.ref, source: row.source, verdict: 'redirected', note: note, by_uid: g.uid,
                               by_name: g.name, at: at, via: 'support-desk' });
    var item = sdWorkItem_(row, to, dec.id, g.name, note);
    var w = { to_uid: to.uid, to_name: to.name, item_id: item.id };
    if (row.source === 'queue') {
      w.row = row._book_row || 0;
      w.requestor = row.requestor.name;
      w.type = row.type.raw;
      w.call_id = row._call_id || '';
      w.date_received = row.date;
    }
    dec.witness = JSON.stringify(w);
    sdAppend_(SD_TABS.decisions, [dec]);
    sdSeatsClose_(row.ref, 'redirected', g.name, at);
    sdAppend_(SD_TABS.inbox, [item]);
    return { ok: true, changed: true, said: 'Redirected to ' + to.name + ' — it waits in their My Work.' };
  });
}

HUB_POLICY.supportDeskSeat = {
  file: 'SupportDesk.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { ref: { type: 'string' } }
};
/** One request as its viewer sees it, with the people it may be redirected to: My Work's panel reads it here. */
HUB_ACTIONS.supportDeskSeat = function (payload, user) {
  var ref = sdText_(payload && payload.ref, 40);
  var g = sdGate_(user);
  if (!g.open) g = sdSeatGate_(user, ref);
  if (!g || !g.open) return sdRefuse_(404, 'Unknown action.');
  if (!ref) return sdRefuse_(400, 'Which request? The ref is missing.');
  var row = null;
  try {
    var cut = sdCut_(sdBase_(false), g, { completed: true });
    cut.rows.forEach(function (r) { if (r.ref === ref) row = r; });
  } catch (e) { return sdRefuse_(503, 'Support Requests could not be read just now (' + sdErr_(e) + ').'); }
  if (!row) return sdRefuse_(404, 'That request is not waiting on you any more.');
  var pickers = row.may.redirect ? sdPickersFor_(g.uid) : { list: [], why: '' };
  return { status: 200, data: { ok: true, row: row, people: pickers.list, people_why: pickers.why,
                                viewer: { uid: g.uid, name: g.name, is_master: g.is_master, is_director: g.is_director,
                                          is_lead: g.is_lead, can_decide: g.can_decide } } };
};

/** One row as this viewer sees it, read fresh. */
function sdRowFor_(ref, g) {
  sdDropReads_();
  var base = sdBase_(true);
  var target = base.folded[ref] || ref;
  var cut = sdCut_(base, g, { completed: true });
  var hit = null;
  cut.rows.forEach(function (r) { if (r.ref === target) hit = r; });
  return hit;
}

function sdFindBaseRow_(base, ref) {
  var target = base.folded[ref] || ref;
  var hit = null;
  base.rows.forEach(function (r) { if (r.ref === target) hit = r; });
  return hit;
}

/** Appends a final verdict under the lock, by the law of Requests.gs requestResolve: one final verdict per request. */
function sdDecideFinal_(row, verdict, note, g) {
  return sdLock_(function () {
    delete SD_MEMO[SD_TABS.decisions];
    delete SD_MEMO.__decs;
    var decs = sdDecisionsByRef_()[row.ref] || [];
    var final = sdFinalOf_(decs);
    if (final) {
      var who = sdStr_(final.by_name) || 'someone';
      if (final.verdict === verdict) return { ok: true, changed: false, said: 'Already ' + verdict + ' by ' + who + '.' };
      return sdRefuse_(409, 'Already ' + final.verdict + ' by ' + who + ' at ' + sdStampWords_(final.at) + '.');
    }
    var witness = row.source === 'queue'
      ? { row: row._book_row || 0, requestor: row.requestor.name, type: row.type.raw, call_id: row._call_id || '',
          date_received: row.date }
      : null;
    var dec = sdDecisionRow_({ ref: row.ref, source: row.source, verdict: verdict, note: note,
                               by_uid: g.uid, by_name: g.name, via: 'support-desk', witness: witness });
    sdAppend_(SD_TABS.decisions, [dec]);
    // the decision stands on its own; a My Work item left waiting only answers "Already …" when pressed
    try { sdSeatsClose_(row.ref, verdict, g.name, dec.at); } catch (eS) {}
    return { ok: true, changed: true, said: SD_FINAL[verdict] + '.' };
  });
}

/** An "I'm aware" on a warning: one per person per request, and the person's own item answered with it. */
function sdAwareLocked_(ref, source, uid, name, via) {
  delete SD_MEMO[SD_TABS.decisions];
  delete SD_MEMO.__decs;
  var decs = sdDecisionsByRef_()[ref] || [];
  var mine = decs.filter(function (d) { return d.verdict === 'aware' && d.by_uid === uid; })[0];
  var nowIso = sdIso_(sdNowMs_());
  delete SD_MEMO[SD_TABS.inbox];
  delete SD_MEMO.__items;
  var items = (sdItemsByRef_()[ref] || []).filter(function (it) {
    return it.to_uid === uid && it.box !== SD_WORK_BOX && !sdStr_(it.answered_at);
  });
  items.forEach(function (it) { it.answered_by = name; it.answered_at = nowIso; it.state = it.kind === 'info' ? 'seen' : 'aware'; });
  if (items.length) sdUpsert_(SD_TABS.inbox, items);
  if (mine) return { ok: true, changed: false, said: 'Already marked by you at ' + sdStampWords_(mine.at) + '.' };
  sdAppend_(SD_TABS.decisions, [sdDecisionRow_({ ref: ref, source: source, verdict: 'aware', note: '', by_uid: uid,
                                                 by_name: name, at: nowIso, via: via })]);
  return { ok: true, changed: true, said: 'Marked — you are aware.' };
}

// Texts that the quiet window held for a request, said again when they can be; once the request is decided they are…
function sdOwedSay_(onlyRef, deadline) {
  var out = { said: 0, dropped: 0 };
  var nowMs = sdNowMs_();
  var items;
  try { items = sdRead_(SD_TABS.inbox); } catch (e) { return out; }
  var owed = items.filter(function (it) {
    if (onlyRef && it.ref !== onlyRef) return false;
    if (!/^text: held:quiet/.test(sdStr_(it.note))) return false;
    var born = Date.parse(sdStr_(it.created_at));
    return !isNaN(born) && nowMs - born < SD_OWED_HOURS * 3600000;
  });
  if (!owed.length) return out;
  var decsBy = {};
  try { decsBy = sdDecisionsByRef_(); } catch (eD) { return out; }
  var notes = [];
  owed.forEach(function (it) {
    if (deadline && Date.now() > deadline) return;
    var ev = null;
    try {
      sdEvents_().forEach(function (e) { if (!ev && e.ref === it.ref && (e.kind === 'route' || e.kind === 'punch' || e.kind === 'adp')) ev = e; });
    } catch (eE) { ev = null; }
    if (!ev) return;
    if (sdFinalOf_(decsBy[it.ref] || [])) { notes.push({ id: it.id, word: 'dropped: the request was decided first' }); out.dropped++; return; }
    var plan = sdTextPlan_(ev);
    if (!plan) return;
    var r = sdTell_(plan.situation, { uid: it.to_uid, name: it.to_name }, plan.vars, it.ref);
    notes.push({ id: it.id, word: sdOutcome_(r) });
    if (r.state === 'sent') out.said++;
  });
  sdItemNotes_(notes);
  return out;
}

HUB_POLICY.supportDeskDecide = {
  file: 'SupportDesk.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: ['smsSend'],
  params: { ref: { type: 'string' }, verdict: { type: 'string' }, note: { type: 'string' }, to: { type: 'string' } }
};
HUB_ACTIONS.supportDeskDecide = function (payload, user) {
  var p = payload || {};
  var ref = sdText_(p.ref, 40);
  var g = sdGate_(user);
  // the account a redirect named answers that request from My Work, whatever the app's access
  if (!g.open) g = sdSeatGate_(user, ref);
  if (!g || !g.open) return sdRefuse_(404, 'Unknown action.');
  if (!user || user.is_service || sdVisiting_(user)) {
    return sdRefuse_(403, 'Answer from your own account — not while visiting someone else.');
  }
  var word = sdText_(p.verdict, 10).toLowerCase();
  var note = sdText_(p.note, 500);
  if (!ref) return sdRefuse_(400, 'Which request? The ref is missing.');
  if (!SD_VERDICT_OF[word]) return sdRefuse_(400, 'Answer with approve, deny, resolve, redirect or aware.');
  var base, row;
  try {
    sdDropReads_();
    base = sdBase_(true);
    row = sdFindBaseRow_(base, ref);
  } catch (e) { return sdRefuse_(503, 'Support Requests could not be read just now (' + sdErr_(e) + ') — nothing was changed.'); }
  if (!row) return sdRefuse_(404, 'That request is not on the queue any more.');
  var verdict = SD_VERDICT_OF[word];
  if (row.source === 'scheduling') return sdDecideSched_(row, word, note, g, user);
  if (!base.directors.readable) return sdRefuse_(503, base.directors.why);
  if (!base.decisions_ok) return sdRefuse_(503, 'The decisions house could not be read, so nothing can be decided right now.');
  // the last account a redirect named keeps its seat after a verdict lands, so a late answer meets the 409 law
  var holder = !!g.uid && row._last_to === g.uid;
  if (verdict !== 'aware' && !g.is_director && !g.is_master && !holder) {
    return sdRefuse_(403, 'Only the directors decide requests.');
  }
  // a request already decided answers by the one-verdict law (same verdict: unchanged; another: 409), never by `may`
  var decided = verdict !== 'aware' && !!row._final;
  var may = sdMay_(row, g, base);
  if (!decided && !may[word]) return sdRefuse_(400, may.why || 'That answer is not offered on this request.');
  var to = null;
  if (verdict === 'redirected') {
    to = sdRedirectTarget_(p.to);
    if (to.status) return to;
    if (to.uid === g.uid) return sdRefuse_(400, 'Redirect it to someone else — it is already yours to answer.');
  }
  var res;
  try {
    if (verdict === 'aware') {
      res = sdLock_(function () { return sdAwareLocked_(row.ref, row.source, g.uid, g.name, 'support-desk'); });
    } else if (verdict === 'redirected') {
      res = sdRedirect_(row, to, note, g);
    } else {
      res = sdDecideFinal_(row, verdict, note, g);
    }
  } catch (eW) { return sdRefuse_(503, 'Support Requests could not be written just now (' + sdErr_(eW) + ') — nothing was changed.'); }
  if (!res || res.status) return res || sdRefuse_(503, 'No answer from the lock.');
  try { sdOwedSay_(row.ref, Date.now() + 10000); } catch (eO) {}
  try {
    hubSysLog_(sdStr_(user.email), 'supportDeskDecide', row.ref + ' ' + verdict + (to ? ' to ' + to.uid : ''), { status: 200 });
  } catch (eL) {}
  var fresh = null;
  try { fresh = sdRowFor_(row.ref, g); } catch (eR) { fresh = null; }
  return { status: 200, data: { ok: true, changed: res.changed !== false, said: res.said, row: fresh } };
};

/** A Scheduling row is answered by Scheduling's own door; the answer passes through unchanged. */
function sdDecideSched_(row, word, note, g, user) {
  var it = sdSchedItemFor_(row, g);
  if (!it) return sdRefuse_(403, 'This one is waiting on ' + (row.waiting_on.join(', ') || 'someone else') + '.');
  var schedWord = word === 'approve' ? 'approve' : word === 'deny' ? 'decline' : word === 'aware' ? 'seen' : '';
  if (!schedWord) return sdRefuse_(400, 'A Scheduling request is approved, declined or marked as seen here.');
  if (it.box === 'work' && schedWord === 'seen') return sdRefuse_(400, 'Approve or decline this one.');
  if (it.box === 'inbox' && schedWord !== 'seen') return sdRefuse_(400, 'An alert is only marked as aware.');
  var got = HUB_ACTIONS.schedulingAnswer({ item_id: it.id, word: schedWord, note: note }, user);
  if (!got || got.status !== 200) return got || sdRefuse_(503, 'Scheduling did not answer.');
  if (note) {
    try {
      sdAppend_(SD_TABS.decisions, [sdDecisionRow_({ ref: row.ref, source: 'scheduling', verdict: 'note', note: note,
                                                     by_uid: g.uid, by_name: g.name, via: 'support-desk' })]);
    } catch (eN) { /* the decision stands in Scheduling; the annotation is the only thing lost */ }
  }
  sdBump_();
  var d = got.data || {};
  var fresh = null;
  try { fresh = sdRowFor_(row.ref, g); } catch (eR) { fresh = null; }
  return { status: 200, data: { ok: true, changed: d.changed !== false, said: d.said, state: d.state, row: fresh } };
}

HUB_POLICY.supportInboxAnswer = {
  file: 'SupportDesk.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { item_id: { type: 'string' }, word: { type: 'string' } }
};
/** GATED BY THE SEAT, not by the app: the session's own account must be the item's recipient. */
HUB_ACTIONS.supportInboxAnswer = function (payload, user) {
  if (!user || user.is_service) return sdRefuse_(404, 'Unknown action.');
  if (sdVisiting_(user)) return sdRefuse_(403, 'Answer from your own account — not while visiting someone else.');
  var me = hubActingUserId_(user);
  if (!me) return sdRefuse_(404, 'Unknown action.');
  var p = payload || {};
  var itemId = sdText_(p.item_id, 20);
  var word = sdText_(p.word, 10).toLowerCase();
  if (!/^SN[0-9A-F]{10}$/.test(itemId)) return sdRefuse_(400, 'Which item? The item id is missing.');
  if (word !== 'aware' && word !== 'seen') return sdRefuse_(400, 'Mark it as aware or seen.');
  var name = sdActorName_(user);
  var out;
  try {
    out = sdLock_(function () {
      sdDropReads_();
      var item = null;
      sdRead_(SD_TABS.inbox).forEach(function (r) { if (r.id === itemId) item = r; });
      if (!item) return sdRefuse_(404, 'This item is not here any more.');
      if (sdStr_(item.to_uid) !== me) return sdRefuse_(403, 'This item is waiting on someone else.');
      if (item.box === SD_WORK_BOX) return sdRefuse_(400, 'A redirected request is answered in My Work.');
      if (sdStr_(item.answered_at)) {
        return { ok: true, changed: false, said: 'Already marked by ' + (sdStr_(item.answered_by) || 'someone') + '.',
                 state: item.state };
      }
      var want = item.kind === 'info' ? 'seen' : 'aware';
      if (word !== want) return sdRefuse_(400, 'This one is marked as ' + want + '.');
      if (want === 'aware') {
        var r = sdAwareLocked_(item.ref, sdSourceOfRef_(item.ref), me, name, 'my-inbox');
        return { ok: true, changed: true, said: r.changed ? 'Marked — you are aware.' : r.said, state: 'aware' };
      }
      item.answered_by = name;
      item.answered_at = sdIso_(sdNowMs_());
      item.state = 'seen';
      sdUpsert_(SD_TABS.inbox, [item]);
      return { ok: true, changed: true, said: 'Marked as seen.', state: 'seen' };
    });
  } catch (e) { return sdRefuse_(503, 'Support Requests could not be written just now (' + sdErr_(e) + ') — nothing was changed.'); }
  if (!out || out.status) return out || sdRefuse_(503, 'No answer from the lock.');
  try { hubSysLog_(sdStr_(user.email), 'supportInboxAnswer', itemId + ' ' + word, { status: 200 }); } catch (eL) {}
  return { status: 200, data: { ok: true, changed: out.changed !== false, said: out.said, state: out.state } };
};

HUB_POLICY.supportDeskSettingsSet = {
  file: 'SupportDesk.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { values: { type: 'object' } }
};
HUB_ACTIONS.supportDeskSettingsSet = function (payload, user) {
  var master = false;
  try { master = !!hubIsRealMaster_(user); } catch (e) { master = false; }
  if (!master || sdVisiting_(user)) return sdRefuse_(404, 'Unknown action.');
  var values = (payload && payload.values && typeof payload.values === 'object') ? payload.values : {};
  var keys = Object.keys(values).filter(function (k) { return SD_SETTABLE.indexOf(k) !== -1; });
  if (!keys.length) return sdRefuse_(400, 'Nothing to save: only ' + SD_SETTABLE.join(', ') + ' are set here.');
  var rows = [], refused = [];
  var nowIso = sdIso_(sdNowMs_());
  keys.forEach(function (k) {
    var v = values[k];
    if (k === 'routes') {
      var obj = (v && typeof v === 'object') ? v : sdJson_(v, null);
      var okRoutes = obj && !Array.isArray(obj) && Object.keys(obj).every(function (rk) {
        return Array.isArray(obj[rk]) && obj[rk].every(function (t) { return typeof t === 'string' && sdStr_(t); });
      });
      if (!okRoutes) { refused.push('routes must map each route to a list of request types'); return; }
      rows.push({ key: k, value: JSON.stringify(obj), note: '', updated_at: nowIso, updated_by: sdActorName_(user) });
      return;
    }
    var got = sdResolveEmails_(v);
    if (!got.list.length || got.missed.length) { refused.push(k + ': ' + (got.why || 'no live account')); return; }
    rows.push({ key: k, value: got.list.map(function (x) { return x.email; }).join(', '), note: '', updated_at: nowIso,
                updated_by: sdActorName_(user) });
  });
  if (refused.length) return sdRefuse_(400, 'Nothing was saved — ' + refused.join('; ') + '.');
  try {
    var res = sdLock_(function () { sdUpsert_(SD_TABS.settings, rows); return { ok: true }; });
    if (res && res.status) return res;
  } catch (eW) { return sdRefuse_(503, 'The settings could not be written (' + sdErr_(eW) + ') — nothing was changed.'); }
  sdDropReads_();
  try { hubSysLog_(sdStr_(user && user.email), 'supportDeskSettingsSet', keys.join(','), { status: 200 }); } catch (eL) {}
  var st = sdSettings_();
  return { status: 200, data: { ok: true, settings: { directors: st.values.directors, leads: st.values.leads,
                                                       payroll_to: st.values.payroll_to, routes: st.routes } } };
};

/* ---- what the platform raises by itself (the hooks; each never throws and never changes its host) ---- */

function sdHeld_(why) { return { held: true, why: why }; }

/** Late Show and No Call No Show from the relay's clock and the call-off form (StaffAlerts.gs staffAttendancePunch). */
function supportDeskAttendance_(work, today) {
  try {
    var on = { late_show: hubMyWorkAutoOn_('late_show'), no_call: hubMyWorkAutoOn_('no_call') };
    if (!on.late_show && !on.no_call) return { off: true };
    var out = { raised: 0, already: 0, off: 0, skipped: 0 };
    var day0 = sdStr_(today) || sdDayOfMs_(sdNowMs_());
    (work || []).forEach(function (w) {
      var kind = w && w.kind === 'no_call' ? 'no_call' : (w && w.kind === 'late_show' ? 'late_show' : '');
      if (!kind) { out.skipped++; return; }
      if (!on[kind]) { out.off++; return; }
      var r = (w && w.row) || {};
      var person = sdStr_(r.person);
      var day = sdStr_(r.day) || day0;
      if (!person || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < sdDayAdd_(day0, -1)) { out.skipped++; return; }
      var sid = kind === 'no_call' ? 'staff_no_call' : 'staff_late_show';
      var got = sdAttendanceRaise_(kind, staffAlertLedgerKey_(sid, person, day), person, day, {
        source: sdStr_(r.source) || 'clock', minutes_late: sdStr_(r.minutes_late), house: sdStr_(r.house),
        shift_code: sdStr_(r.shift_code), shift_at: sdStr_(r.shift_at), read_at: sdStr_(r.read_at)
      });
      if (got.raised) out.raised++; else out.already++;
    });
    return out;
  } catch (e) { return sdHeld_(sdErr_(e)); }
}

/** The mailbox's Late Show / No Call No Show reports, under the same key as the clock's (StaffAlerts.gs sweep). */
function supportDeskAttendanceMail_(parsed, ledgerKey, dayIso) {
  try {
    var kind = parsed && (parsed.kind === 'late_show' || parsed.kind === 'no_call') ? parsed.kind : '';
    if (!kind) return { skipped: true };
    if (!hubMyWorkAutoOn_(kind)) return { off: true };
    var day0 = sdDayOfMs_(sdNowMs_());
    if (!sdStr_(ledgerKey) || !sdStr_(parsed.person) || sdStr_(dayIso) < sdDayAdd_(day0, -1)) return { skipped: true };
    return sdAttendanceRaise_(kind, ledgerKey, sdStr_(parsed.person), sdStr_(dayIso), { source: 'mail' });
  } catch (e) { return sdHeld_(sdErr_(e)); }
}

function sdAttendanceRaise_(kind, sourceRef, person, day, facts) {
  var id = sdEventId_(kind, sourceRef);
  var label = kind === 'no_call' ? 'No Call No Show' : 'Late Show';
  var dirs = sdDirectors_();
  var where = [facts.house, facts.shift_code, sdDayWords_(day)].filter(String).join(' · ');
  var items = sdReceivers_(dirs.list, kind).map(function (d) {
    return sdItem_(id, 'warning', 'director', d, label + ' — ' + person, where + '. Directors, are you aware?',
                   facts.house, day, kind);
  });
  return sdRaise_({ id: id, kind: kind, ref: id, route: '', source: facts.source, source_ref: sourceRef,
                    title: label + ' — ' + person, category: 'Attendance · ' + label, person: person,
                    person_key: sdFold_(person), person_uid: sdUidByName_(person), house: facts.house, day: day,
                    at: facts.shift_at || day, details: facts }, items);
}

/** Smart Comms rows the shift flow already plans (StaffAlerts.gs staffShiftReminder): a missing punch out or in. */
function supportDeskShiftRow_(kind, r) {
  try {
    var row = r || {};
    var direction = kind === 'punch_open_entry' ? 'out' : (kind === 'login_missing' && row.checked === true ? 'in' : '');
    if (!direction) return { skipped: true };
    return supportDeskPunchNoted_([{ id: sdStr_(row.id), person: sdStr_(row.person), person_key: sdStr_(row.person_key),
                                     house: sdStr_(row.house), house_name: sdStr_(row.house_name),
                                     shift_code: sdStr_(row.shift_code), shift_at: sdStr_(row.shift_at),
                                     shift_end: sdStr_(row.shift_end), verdict: direction === 'in' ? 'missing' : 'open',
                                     pair_fault: true, read_at: sdStr_(row.checked_at) }], 'shift');
  } catch (e) { return sdHeld_(sdErr_(e)); }
}

/** The first missing punch per person per shift: a warning to the directors and the leads, and a text to each. */
function supportDeskPunchNoted_(facts, via) {
  try {
    if (!hubMyWorkAutoOn_('punch')) return { off: true, raised: 0, already: 0 };
    var out = { raised: 0, already: 0, off: false, skipped: 0, why: '' };
    var day0 = sdDayOfMs_(sdNowMs_());
    (facts || []).slice(0, SD_PUNCH_MAX).forEach(function (f) {
      var fact = f || {};
      var verdict = sdStr_(fact.verdict);
      if (verdict === 'not_entered_yet' || fact.pair_fault !== true || (verdict !== 'missing' && verdict !== 'open')) {
        out.skipped++;
        return;
      }
      var person = sdStr_(fact.person);
      var minute = sdUtcMinute_(fact.shift_at);
      if (!person || !minute) { out.skipped++; return; }
      var day = sdDayOf_(fact.shift_at);
      if (day < sdDayAdd_(day0, -1)) { out.skipped++; return; }
      var direction = verdict === 'missing' ? 'in' : 'out';
      var sourceRef = sdFold_(person) + '|' + minute;
      var id = sdEventId_('punch', sourceRef);
      var had = sdEventById_(id);
      if (had) {
        var was = (sdJson_(had.details, {}) || {}).direction;
        if (was && was !== direction) sdPunchAlso_(id, direction);
        out.already++;
        return;
      }
      var dirs = sdDirectors_().list;
      var leads = sdLeads_().list.filter(function (l) { return !dirs.some(function (d) { return d.uid === l.uid; }); });
      var dirsTold = sdReceivers_(dirs, 'punch'), leadsTold = sdReceivers_(leads, 'punch');
      var house = sdStr_(fact.house_name) || sdStr_(fact.house);
      var title = person + ' is not punching ' + direction;
      var body = [house, sdStr_(fact.shift_code), sdDayWords_(day)].filter(String).join(' · ') + '. Are you aware?';
      var items = dirsTold.map(function (d) {
        return sdItem_(id, 'warning', 'director', d, title, body, house, day, 'punch');
      }).concat(leadsTold.map(function (l) {
        return sdItem_(id, 'warning', 'lead', l, title, body, house, day, 'punch');
      }));
      var details = { direction: direction, house_name: house, shift_code: sdStr_(fact.shift_code),
                      shift_at: sdStr_(fact.shift_at), shift_end: sdStr_(fact.shift_end), read_at: sdStr_(fact.read_at),
                      verdict: verdict, via: via };
      var ev = { id: id, kind: 'punch', ref: id, route: '', source: via, source_ref: sourceRef, title: title,
                 category: 'Attendance · Missing punch', person: person, person_key: sdFold_(person),
                 person_uid: sdUidByName_(person), house: sdStr_(fact.house), day: day, at: sdStr_(fact.shift_at),
                 details: details };
      var got = sdRaise_(ev, items);
      if (!got.raised) { out.already++; return; }
      out.raised++;
      var plan = sdTextPlan_(sdEventRow_(ev));
      sdTellAll_(plan.situation, sdUnion_(dirsTold, leadsTold), plan.vars, id, 'warning');
    });
    return out;
  } catch (e) { return sdHeld_(sdErr_(e)); }
}

function sdPunchAlso_(ref, direction) {
  var line = 'Also not punching ' + direction;
  var decs = sdDecisionsByRef_()[ref] || [];
  if (decs.some(function (d) { return d.verdict === 'note' && d.note === line; })) return;
  sdAppend_(SD_TABS.decisions, [sdDecisionRow_({ ref: ref, source: 'event', verdict: 'note', note: line, by_uid: '',
                                                 by_name: 'Support Requests', via: 'auto' })]);
  delete SD_MEMO.__decs;
}

/** The situation and its values for an event that owes texts; null when it owes none. */
function sdTextPlan_(ev) {
  var d = sdJson_(ev.details, {}) || {};
  if (ev.kind === 'punch') {
    return { situation: 'sr_punch_aware', vars: {
      person: sdStr_(ev.person), direction: sdStr_(d.direction), house: sdStr_(d.house_name) || sdStr_(ev.house),
      shift: sdStr_(d.shift_code), date: sdDayWords_(ev.day), link: sdLink_('/app/my-inbox/alerts') } };
  }
  if (ev.kind === 'adp') {
    return { situation: 'sr_adp_applied', vars: { requestor: sdStr_(ev.person), field: sdFieldWords_(d.field),
                                                  link: sdLink_('/app/support-desk/requests?ref=' + ev.ref) } };
  }
  if (ev.kind === 'route' && (ev.route === 'vehicle' || ev.route === 'payroll')) {
    var q = null;
    try { sdQueueAll_().forEach(function (x) { if (x.ref === ev.ref) q = x.row; }); } catch (e) { q = null; }
    if (!q) return null;
    return { situation: ev.route === 'vehicle' ? 'sr_vehicle_request' : 'sr_payroll_request', vars: sdRouteVars_(q, ev.ref) };
  }
  return null;
}

function sdRouteVars_(q, ref) {
  return { requestor: sdText_(q.requestor, 80) || 'an unknown caller',
           callback: sdText_(q.requestor_phone, 30) || 'no number on file', type: sdText_(q.type_of_request, 80),
           summary: sdText_(q.description_of_request, 120), urgency: sdUrgency_(q.urgency) || 'Low',
           link: sdLink_('/app/support-desk/requests?ref=' + ref) };
}

function sdFieldWords_(field) {
  return field === 'address' ? 'home address' : field === 'email' ? 'e-mail' : field === 'phone' ? 'phone' : sdStr_(field);
}

/** An incident's key, the one server/my_work.py gives it; '' when the row has no timestamp (never raised). */
function sdIncidentKey_(row) {
  var ts = sdInstantText_(row && row.timestamp);
  if (!ts || (sdInstantMs_(ts) === null && !sdDayOf_(ts))) return '';
  return 'IN' + sdSha10_(ts + '|' + sdStr_(row.your_name) + '|' + sdStr_(row.client_name) + '|' +
                         sdStr_(row.incident_category));
}

/** Incidents from the hotline, the platform's own form and the estate's Google Form: a pointer, never the report. */
function supportDeskIncidents_(rows, via) {
  try {
    if (!hubMyWorkAutoOn_('incident')) return { off: true };
    var out = { raised: 0, already: 0, skipped: 0 };
    (rows || []).forEach(function (r) {
      var row = r || {};
      var ts = sdInstantText_(row.timestamp);
      var inKey = sdIncidentKey_(row);
      if (!inKey) { out.skipped++; return; }
      var id = sdEventId_('incident', inKey);
      var category = sdText_(row.incident_category, 80) || 'Incident';
      var day = sdDayOf_(row.incident_date) || sdDayOf_(row.timestamp);
      var location = sdText_(row.incident_location, 80);
      var title = 'Incident filed — ' + category;
      var body = [location, sdDayWords_(day)].filter(String).join(' · ') + '. Open Incidents for the report.';
      var people = sdReceivers_(sdUnion_(sdDirectors_().list, sdLeads_().list), 'incident');
      var dirIds = {};
      sdDirectors_().list.forEach(function (d) { dirIds[d.uid] = true; });
      var items = people.map(function (p) {
        return sdItem_(id, 'important', dirIds[p.uid] ? 'director' : 'lead', p, title, body, location, day, 'incident');
      });
      var got = sdRaise_({ id: id, kind: 'incident', ref: id, route: '', source: via, source_ref: inKey, title: title,
                           category: 'Incident · ' + category, person: sdText_(row.your_name, 120),
                           person_key: sdFold_(row.your_name), person_uid: sdUidByName_(row.your_name), house: location,
                           day: day, at: ts,
                           details: { incident_category: category, incident_location: location, day: day, via: via } },
                         items);
      if (got.raised) out.raised++; else out.already++;
    });
    return out;
  } catch (e) { return sdHeld_(sdErr_(e)); }
}

// Hotline requests that landed (Hotline.gs hotlineSweep) and rows the tick finds filed by anyone else: each is…
function supportDeskFiled_(rows, ctx) {
  try {
    var st = sdSettings_();
    var autos = null;
    try { autos = hubMyWorkAutoRead_(); } catch (eA) { return { off: true, why: 'the switches could not be read' }; }
    var out = { routed: 0, already: 0, off: 0, skipped: 0, retry: 0 };
    var wanted = (rows || []).filter(function (r) {
      var route = sdRouteOf_(r && r.type_of_request, st.routes);
      if (!route || sdIsCallOff_(r && r.type_of_request)) { out.skipped++; return false; }
      if (!autos[route]) { out.off++; return false; }
      return true;
    });
    if (!wanted.length) return out;
    delete SD_MEMO.__queue;
    var queue = sdQueueAll_();
    wanted.forEach(function (r) {
      var key = sdQueueKey_(r.requestor, r.type_of_request, r.description_of_request, r.date_received);
      var hit = null;
      queue.forEach(function (q) { if (q.key === key) hit = q; });
      if (!hit) { out.retry++; return; }
      var got = sdRoute_(hit, sdRouteOf_(r.type_of_request, st.routes), (ctx && ctx.via) || 'hotline');
      if (got.raised) out.routed++; else if (got.held) out.retry++; else out.already++;
    });
    return out;
  } catch (e) { return sdHeld_(sdErr_(e)); }
}

function sdRouted_(ref) {
  return sdEvents_().some(function (e) { return e.ref === ref && (e.kind === 'route' || e.kind === 'adp'); });
}

/** One queue row to its route: the items, then the texts, then the event that remembers both. */
function sdRoute_(q, route, via) {
  if (sdRouted_(q.ref)) return { raised: false, already: true };
  if (route === 'adp_update') return sdAdpRaise_(q, via);
  var r = q.row;
  var type = sdTypeParts_(r.type_of_request);
  var who = sdText_(r.requestor, 80) || 'an unknown caller';
  var title = type.display + ' from ' + who;
  var body = (sdUrgency_(r.urgency) || 'Low') + ' · ' + sdText_(r.description_of_request, 140);
  var people = route === 'vehicle' ? sdDirectors_().list : route === 'payroll' ? sdPayrollTo_().list : sdLeads_().list;
  var seat = route === 'general' ? 'lead' : route === 'payroll' ? 'payroll' : 'director';
  var day = sdDayOf_(r.date_received);
  var items = people.map(function (p) { return sdItem_(q.ref, 'info', seat, p, title, body, '', day); });
  var id = sdEventId_('route', q.ref);
  var have = sdItemsByRef_()[q.ref] || [];
  var known = {};
  have.forEach(function (it) { known[it.id] = true; });
  var fresh = items.filter(function (it) { return !known[it.id]; });
  if (fresh.length) sdAppend_(SD_TABS.inbox, fresh);
  delete SD_MEMO.__items;
  var told = people.map(function (p) { return { uid: p.uid, name: p.name, inbox_id: sdItemId_(q.ref, 'info', p.uid), text: null }; });
  if (route === 'vehicle' || route === 'payroll') {
    told = sdTellAll_(route === 'vehicle' ? 'sr_vehicle_request' : 'sr_payroll_request', people, sdRouteVars_(r, q.ref),
                      q.ref, 'info');
  }
  if (sdEventById_(id)) return { raised: false, already: true };
  sdAppend_(SD_TABS.events, [sdEventRow_({ id: id, kind: 'route', ref: q.ref, route: route, source: via,
                                           source_ref: q.ref, title: title, category: sdStr_(r.type_of_request),
                                           person: who, person_key: sdFold_(r.requestor),
                                           person_uid: sdUidByName_(r.requestor), house: '', day: day,
                                           at: sdWhenOf_(sdReceivedOf_(r)),
                                           details: { told: told, nobody: people.length ? '' : 'nobody on the ' + route + ' list has a live account' } })]);
  delete SD_MEMO.__events;
  return { raised: true, already: false };
}

/* ---- ADP · Update Information ---- */

function sdTurns_(spoken) {
  var out = [];
  String(spoken || '').split('\n').forEach(function (line) {
    var m = /^\s*\[(\d+:\d{2})\]\s*([^:]+?):\s*(.*)$/.exec(line);
    if (m) out.push({ who: m[2].trim(), said: m[3] });
  });
  return out;
}

/** The value the agent read back and the caller confirmed, deterministic; null when the call does not prove one. */
function sdReadBack_(spoken, full) {
  var pick = function (m) {
    var w = m[3].toLowerCase();
    var field = w.indexOf('address') === 0 ? 'address' : w.indexOf('phone') === 0 ? 'phone' : 'email';
    return { field: field, value: sdStr_(m[7]).replace(/[\s,;:]+$/, '') };
  };
  var turns = sdTurns_(spoken);
  if (turns.length) {
    for (var i = 0; i < turns.length; i++) {
      var m = SD_READBACK.exec(turns[i].said);
      if (!m) continue;
      for (var j = i + 1; j < turns.length; j++) {
        if (turns[j].who === turns[i].who) continue;
        if (SD_YES.test(turns[j].said)) return pick(m);
        break;
      }
    }
    return null;
  }
  var text = String(full || '');
  var re = new RegExp(SD_READBACK.source, 'ig');
  var mm;
  while ((mm = re.exec(text))) {
    if (SD_YES.test(text.slice(mm.index + mm[0].length).replace(/^[\s?.!,]+/, ''))) return pick(mm);
  }
  return null;
}

/** A value said letter by letter, or an e-mail said in words ("at", "dot") — never taken as written. */
function sdSpelledOut_(value, field) {
  if (/(?:\b[a-z0-9]\b[\s-]+){3,}/i.test(value)) return true;
  return field === 'email' && (/\bdot\b|\bat\b/i.test(value) || /\s/.test(sdStr_(value)));
}

function sdDigits10_(v) { return String(v || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); }

/** Another live account already holds this e-mail or phone — then it can never be added here. */
function sdHeldElsewhere_(uid, field, value) {
  var want = field === 'email' ? sdStr_(value).toLowerCase() : sdDigits10_(value);
  var hit = '';
  usersAll_().forEach(function (u) {
    if (hit || !sdLive_(u) || sdStr_(u.userid) === uid) return;
    if (field === 'email') {
      var mails = [sdStr_(u.email).toLowerCase()].concat(profileParseEmails_(u.emails).map(function (e) { return sdStr_(e).toLowerCase(); }));
      if (mails.indexOf(want) !== -1) hit = sdStr_(u.displayname);
    } else {
      var nums = [sdDigits10_(u.phone)].concat(profileParsePhones_(u.phones).map(function (p) { return sdDigits10_(p && p.number); }));
      if (nums.indexOf(want) !== -1) hit = sdStr_(u.displayname);
    }
  });
  if (hit) return hit;
  // a roster that cannot be read is not a roster without holders: it throws, and the request is judged again
  var guard = contactGuard_(field === 'phone' ? value : '', field === 'email' ? value : '', {});
  if (guard && guard.severity === 'unverified') throw new Error('the staff roster could not be read');
  var me = sdUserByUid_(uid);
  var mine = me ? sdFold_(me.displayname) : '';
  var other = '';
  ((guard && guard.hits) || []).forEach(function (h) {
    (h.people || []).forEach(function (pp) { if (!other && sdFold_(pp.name) !== mine) other = sdStr_(pp.name); });
  });
  return other;
}

// Judges one ADP · Update Information row: who called is proven by two keys, the value by the call's own read-back…
function sdAdpJudge_(q) {
  var r = q.row;
  var out = { state: 'refused', field: '', value: '', words: '', why: '', uid: '', name: '', call_id: sdCallIdOf_(r.notes),
              proof: '', value_shape: '' };
  var refuse = function (why) { out.why = why; return out; };
  var desc = sdStr_(r.description_of_request);
  var adpOnly = SD_ADP_ONLY.test(desc);
  if (adpOnly && !/address|e-?mail|phone/i.test(desc)) {
    out.state = 'refused_auto';
    return refuse('ADP only — a person must make this change in ADP.');
  }
  if (!out.call_id) return refuse('No Call ID on the request, so the call cannot be read back.');
  var who = sdStr_(r.requestor);
  if (!who || /^\*/.test(who) || contactNameMissing_(who)) return refuse('The caller did not say who they are.');
  var line = sdDigits10_(r.requestor_phone);
  if (!line) return refuse('The request carries no caller number.');
  if (SHARED_LINE_DIGITS.indexOf(line) !== -1) return refuse('The call came from a company line, which names nobody.');
  var holder = contactPhoneWho_(r.requestor_phone);
  if (!holder || holder.state !== 'sole') return refuse('The caller\'s line does not name one person: ' + sdStr_(holder && holder.why) + '.');
  if (sdFold_(holder.name) !== sdFold_(who)) return refuse('The caller\'s line belongs to ' + holder.name + ', not ' + who + '.');
  var acct = sdAccountByName_(who);
  if (!acct) return refuse('No single live account is called ' + who + '.');
  out.uid = sdStr_(acct.userid);
  out.name = sdStr_(acct.displayname);
  var t = commCallsTranscriptRead_(out.call_id, { email: 'support-desk' });
  if (!t || t.status === 404) return refuse('No transcript is on file for that call.');
  if (t.status !== 200) throw new Error('the call\'s transcript could not be read');
  var rb = sdReadBack_(t.data.speaker_transcript, t.data.full_transcript);
  if (!rb || !rb.value) {
    if (adpOnly) { out.state = 'refused_auto'; return refuse('ADP only — a person must make this change in ADP.'); }
    return refuse('The call never read the new value back and heard a yes.');
  }
  if (sdSpelledOut_(rb.value, rb.field)) return refuse('The value was spelled out on the call, so it cannot be taken as written.');
  out.field = rb.field;
  out.value_shape = rb.field;
  if (rb.field === 'address') {
    if (!/\d/.test(rb.value) || !/[a-z]/i.test(rb.value) || rb.value.length > 200) return refuse('The address read back is not a street address.');
    out.value = rb.value;
    out.state = 'applied';
    out.words = 'Home address set to ' + rb.value + ' on the platform. ADP still needs the change.';
  } else if (rb.field === 'email') {
    var em = rb.value.toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(em)) return refuse('The e-mail read back is not a valid address.');
    var mails = [sdStr_(acct.email).toLowerCase()].concat(profileParseEmails_(acct.emails).map(function (e) { return sdStr_(e).toLowerCase(); }));
    if (mails.indexOf(em) !== -1) return refuse('That e-mail is already on ' + out.name + '\'s account.');
    var elsewhereE = sdHeldElsewhere_(out.uid, 'email', em);
    if (elsewhereE) return refuse('That e-mail is already held elsewhere (' + elsewhereE + ').');
    out.value = em;
    out.state = 'ready';
    out.words = 'Add ' + em + ' to ' + out.name + '\'s e-mails';
  } else {
    var d = sdDigits10_(rb.value);
    if (d.length !== 10) return refuse('The phone read back is not a 10-digit US number.');
    if (SHARED_LINE_DIGITS.indexOf(d) !== -1) return refuse('That number is a company line.');
    var nums = [sdDigits10_(acct.phone)].concat(profileParsePhones_(acct.phones).map(function (p) { return sdDigits10_(p && p.number); }));
    if (nums.indexOf(d) !== -1) return refuse('That phone is already on ' + out.name + '\'s account.');
    var elsewhereP = sdHeldElsewhere_(out.uid, 'phone', d);
    if (elsewhereP) return refuse('That phone is already held elsewhere (' + elsewhereP + ').');
    out.value = '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
    out.state = 'ready';
    out.words = 'Add ' + out.value + ' to ' + out.name + '\'s phones';
  }
  out.proof = sdSha10_(out.uid + '|' + out.field + '|' + out.value);
  return out;
}

/** Raises the ADP event of a queue row; an address is applied with it, and the directors are told. */
function sdAdpRaise_(q, via) {
  var j;
  try { j = sdAdpJudge_(q); } catch (e) { return { raised: false, held: true, why: sdErr_(e) }; }
  var id = sdEventId_('adp', q.ref);
  var who = sdText_(q.row.requestor, 80) || 'an unknown caller';
  var dirs = sdDirectors_().list;
  var items = [];
  if (j.state === 'applied') {
    items = dirs.map(function (d) {
      return sdItem_(q.ref, 'info', 'director', d, 'Update information from ' + who + ' applied automatically',
                     sdFieldWords_(j.field).charAt(0).toUpperCase() + sdFieldWords_(j.field).slice(1) +
                     ' changed on the platform. ADP still needs the change.', '', sdDayOf_(q.row.date_received));
    });
  } else if (j.state === 'ready') {
    items = dirs.map(function (d) {
      return sdItem_(q.ref, 'info', 'director', d, 'Update information from ' + who + ' is ready to approve',
                     'A new ' + (j.field === 'email' ? 'e-mail' : 'phone') + ' waits for one-click approval.', '',
                     sdDayOf_(q.row.date_received));
    });
  }
  var ev = { id: id, kind: 'adp', ref: q.ref, route: 'adp_update', source: via, source_ref: q.ref,
             title: 'Update information from ' + who, category: sdStr_(q.row.type_of_request), person: who,
             person_key: sdFold_(q.row.requestor), person_uid: j.uid, house: '', day: sdDayOf_(q.row.date_received),
             at: sdWhenOf_(q.row.date_received),
             details: { proof: j.proof, field: j.field, words: j.words, value_shape: j.value_shape, why: j.why,
                        uid: j.uid, call_id: j.call_id, state: j.state === 'refused_auto' ? 'refused' : j.state } };
  var got = sdRaise_(ev, items);
  if (!got.raised) return got;
  if (j.state === 'applied') {
    sdAppend_(SD_TABS.decisions, [sdDecisionRow_({ ref: q.ref, source: 'queue', verdict: 'applied',
      note: JSON.stringify({ field: j.field, value: j.value }), by_uid: '', by_name: 'Support Requests', via: 'auto' })]);
    var plan = sdTextPlan_(sdEventRow_(ev));
    var told = sdTellAll_(plan.situation, dirs, plan.vars, q.ref, 'info');
    try { hubSysLog_('asa-hub:support-desk', 'support_adp_applied', q.ref + ' ' + j.field + ' told ' + told.length, { status: 200 }); } catch (eL) {}
  } else if (j.state === 'refused_auto') {
    sdAppend_(SD_TABS.decisions, [sdDecisionRow_({ ref: q.ref, source: 'queue', verdict: 'refused_auto', note: j.why,
                                                   by_uid: '', by_name: 'Support Requests', via: 'auto' })]);
  }
  delete SD_MEMO.__decs;
  return got;
}

HUB_POLICY.supportDeskAdp = {
  file: 'SupportDesk.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { ref: { type: 'string' }, op: { type: 'string' }, proof: { type: 'string' } }
};
HUB_ACTIONS.supportDeskAdp = function (payload, user) {
  var g = sdGate_(user);
  if (!g.open) return sdRefuse_(404, 'Unknown action.');
  if (!user || user.is_service || user.visiting_member || (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX)) {
    return sdRefuse_(403, 'Answer from your own account — not while visiting someone else.');
  }
  if (!g.is_director && !g.is_master) return sdRefuse_(403, 'Only the directors decide requests.');
  var p = payload || {};
  var ref = sdText_(p.ref, 40), op = sdText_(p.op, 10).toLowerCase(), proof = sdText_(p.proof, 20).toUpperCase();
  if (!/^HQ[0-9A-F]{10}(-\d+)?$/.test(ref)) return sdRefuse_(400, 'Which request? The ref is missing.');
  if (op !== 'approve' && op !== 'undo') return sdRefuse_(400, 'Approve or undo the change.');
  var ev, decs, q = null;
  try {
    sdDropReads_();
    ev = sdEventById_(sdEventId_('adp', ref));
    decs = sdDecisionsByRef_()[ref] || [];
    sdQueueAll_().forEach(function (x) { if (x.ref === ref) q = x; });
  } catch (e) { return sdRefuse_(503, 'Support Requests could not be read just now (' + sdErr_(e) + ') — nothing was changed.'); }
  if (!ev || !q) return sdRefuse_(404, 'That request is not on the queue any more.');
  var adp = sdAdpOf_(ev, decs, true);
  if (op === 'undo') return sdAdpUndo_(ref, adp, g, user);
  if (adp.state === 'applied') return { status: 200, data: { ok: true, changed: false, said: 'Already applied.', row: null } };
  if (adp.state !== 'ready') return sdRefuse_(400, 'There is nothing waiting for approval on this request.');
  var d = sdJson_(ev.details, {}) || {};
  if (!proof || proof !== sdStr_(d.proof)) return sdRefuse_(409, 'The change in front of you is no longer the one on file — reopen it.');
  var j;
  try { j = sdAdpJudge_(q); } catch (eJ) { return sdRefuse_(503, 'The call could not be read again just now (' + sdErr_(eJ) + ') — nothing was changed.'); }
  if (j.state !== 'ready' || j.proof !== proof) {
    return sdRefuse_(409, 'The change in front of you is no longer the one on file — reopen it.' + (j.why ? ' ' + j.why : ''));
  }
  var res;
  try {
    // the approval is recorded here; the account itself is written only by the profile's own Save (userUpdate)
    res = sdLock_(function () {
      delete SD_MEMO.__decs;
      delete SD_MEMO[SD_TABS.decisions];
      var final = sdFinalOf_(sdDecisionsByRef_()[ref] || []);
      var by = final ? (sdStr_(final.by_name) || 'someone') : '';
      if (final && final.verdict !== 'approved') {
        return sdRefuse_(409, 'Already ' + final.verdict + ' by ' + by + ' at ' + sdStampWords_(final.at) + '.');
      }
      if (final) return { ok: true, changed: false, said: 'Already approved by ' + by + ' — save it on ' + j.name + '\'s profile.' };
      sdAppend_(SD_TABS.decisions, [sdDecisionRow_({ ref: ref, source: 'queue', verdict: 'approved',
        note: j.words + ' — saved on the profile.', by_uid: g.uid, by_name: g.name, via: 'support-desk',
        witness: { row: q.book_row || 0, requestor: sdStr_(q.row.requestor), type: sdStr_(q.row.type_of_request),
                   call_id: j.call_id, date_received: sdWhenOf_(q.row.date_received) } })]);
      try { sdSeatsClose_(ref, 'approved', g.name, sdIso_(sdNowMs_())); } catch (eS) {}
      return { ok: true, changed: true, said: 'Approved. ' + j.name + '\'s profile opens with the new ' +
                                              (j.field === 'email' ? 'e-mail' : 'phone') + ' filled in — Save there adds it.' };
    });
  } catch (eW) { return sdRefuse_(503, 'Support Requests could not be written just now (' + sdErr_(eW) + ') — nothing was changed.'); }
  if (!res || res.status) return res || sdRefuse_(503, 'No answer from the lock.');
  if (res.changed) {
    try { hubSysLog_(sdStr_(user.email), 'supportDeskAdp', ref + ' ' + j.field + ' approved for ' + j.uid, { status: 200 }); } catch (eL) {}
  }
  var fresh = null;
  try { fresh = sdRowFor_(ref, g); } catch (eR) { fresh = null; }
  return { status: 200, data: { ok: true, changed: res.changed !== false, said: res.said, row: fresh, open: sdAdpOpen_(j) } };
};

function sdAdpUndo_(ref, adp, g, user) {
  if (adp.state === 'undone') return { status: 200, data: { ok: true, changed: false, said: 'Already undone.', row: null } };
  if (adp.state !== 'applied' || adp.field !== 'address') {
    return sdRefuse_(400, adp.state === 'applied' ? 'An added e-mail or phone is removed on the person\'s profile.'
                                                  : 'Nothing was applied on this request.');
  }
  var res;
  try {
    res = sdLock_(function () {
      sdAppend_(SD_TABS.decisions, [sdDecisionRow_({ ref: ref, source: 'queue', verdict: 'undone', note: 'address',
                                                     by_uid: g.uid, by_name: g.name, via: 'support-desk' })]);
      return { ok: true, changed: true, said: 'Undone. The address on the platform is the one before this request.' };
    });
  } catch (e) { return sdRefuse_(503, 'Support Requests could not be written just now (' + sdErr_(e) + ') — nothing was changed.'); }
  if (!res || res.status) return res || sdRefuse_(503, 'No answer from the lock.');
  try { hubSysLog_(sdStr_(user.email), 'supportDeskAdp', ref + ' undo', { status: 200 }); } catch (eL) {}
  var fresh = null;
  try { fresh = sdRowFor_(ref, g); } catch (eR) { fresh = null; }
  return { status: 200, data: { ok: true, changed: true, said: res.said, row: fresh } };
}

/* ---- the relay's punch board: transport only, the judging is here ---- */

HUB_POLICY.supportDeskPunch = {
  file: 'SupportDesk.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: ['smsSend'],
  params: { rows: { type: 'array' } }
};
HUB_ACTIONS.supportDeskPunch = function (payload, user) {
  if (!user || user.is_service !== true) return hubDenied_();
  var rows = Array.isArray(payload && payload.rows) ? payload.rows.slice(0, SD_PUNCH_MAX) : [];
  var got = supportDeskPunchNoted_(rows, 'board');
  return { status: 200, data: { ok: !got.held, raised: got.raised || 0, already: got.already || 0, off: !!got.off,
                                why: sdStr_(got.why) } };
};

/* ---- the clock: catch-ups, owed texts, My Calendar vacations ---- */

/** Called at the top of HUB_ACTIONS.hiringSweep; one cache read when nothing is due. */
function supportDeskTick_() {
  var nowMs = sdNowMs_();
  try {
    var due = CacheService.getScriptCache().get(SD_DUE_KEY);
    if (due && Number(due) > nowMs) return { ran: false, due: Number(due) };
  } catch (e) { return { ran: false, why: 'the cache could not be read' }; }
  var lock = LockService.getScriptLock();
  var held = false;
  try { held = lock.tryLock(0); } catch (eL) { held = false; }
  if (!held) return { ran: false, why: 'busy' };
  try {
    try { CacheService.getScriptCache().put(SD_DUE_KEY, String(nowMs + SD_TICK_EVERY_MS), 21600); } catch (eP) {}
    return sdTickRun_(Date.now() + SD_TICK_BUDGET_MS);
  } catch (e2) {
    return { ran: false, why: sdErr_(e2) };
  } finally { try { lock.releaseLock(); } catch (eR) {} }
}

function sdTickRun_(deadline) {
  var out = { ran: true, watermark: false, routed: 0, incidents: 0, owed: null, vacations: 0, why: [] };
  var autos;
  try { autos = hubMyWorkAutoRead_(); } catch (e) { out.why.push('the switches could not be read — nothing runs'); return out; }
  sdDropReads_();
  var st = sdSettings_();
  if (!st.set_up || !st.readable) { out.why.push('the settings house cannot hold a watermark — no catch-up runs'); }
  var wm = JSON.parse(JSON.stringify(st.watermark || {}));
  wm.parts = wm.parts || {};
  var queue = null, incidents = null;
  var queueParts = SD_ROUTE_ORDER.filter(function (p) { return autos[p]; });
  if (queueParts.length) {
    try { queue = sdQueueAll_(); } catch (eQ) { out.why.push('the queue could not be read'); }
  }
  if (autos.incident) {
    try { incidents = estateRows_('uiIncidents') || []; } catch (eI) { out.why.push('the incidents could not be read'); }
  }
  var changed = false;
  var nowIso = sdIso_(sdNowMs_());
  if (queue) {
    var newest = '';
    queue.forEach(function (q) { var d = sdDayOf_(q.row.date_received); if (d > newest) newest = d; });
    queueParts.forEach(function (p) {
      if (wm.parts[p]) return;
      wm.parts[p] = { rows: queue.length, day: newest, at: nowIso };
      if (!wm.queue) wm.queue = newest;
      changed = true;
    });
  }
  if (incidents) {
    var newestMs = 0;
    incidents.forEach(function (r) { var ms = sdInstantMs_(r.timestamp); if (ms !== null && ms > newestMs) newestMs = ms; });
    if (!wm.parts.incident) {
      wm.parts.incident = { ms: newestMs, at: nowIso };
      if (!wm.incidents) wm.incidents = newestMs ? sdIso_(newestMs) : '';
      changed = true;
    }
  }
  if (changed) {
    if (!st.set_up || !st.readable) return out;
    wm.set_at = wm.set_at || nowIso;
    try {
      sdUpsert_(SD_TABS.settings, [{ key: 'watermark', value: JSON.stringify(wm), note: 'the first pass of each switch: nothing older is raised',
                                     updated_at: nowIso, updated_by: 'support-desk clock' }]);
      out.watermark = true;
    } catch (eW) { out.why.push('the watermark could not be written — no catch-up runs'); return out; }
  }
  if (queue && st.set_up && st.readable) {
    for (var i = 0; i < queue.length; i++) {
      if (Date.now() > deadline) { out.why.push('out of time — the next pass continues'); break; }
      var q = queue[i];
      var route = sdRouteOf_(q.row.type_of_request, st.routes);
      var mark = route && wm.parts[route];
      if (!mark || !autos[route] || sdIsCallOff_(q.row.type_of_request)) continue;
      var day = sdDayOf_(q.row.date_received);
      if (q.index < Number(mark.rows || 0) || !day || day < sdStr_(mark.day)) continue;
      try {
        if (sdRouted_(q.ref)) continue;
        if (sdRoute_(q, route, 'tick').raised) out.routed++;
      } catch (eR) { out.why.push(sdErr_(eR)); }
    }
  }
  if (incidents && wm.parts.incident && st.set_up && st.readable) {
    var fresh = incidents.filter(function (r) {
      var ms = sdInstantMs_(r.timestamp);
      return ms !== null && ms > Number(wm.parts.incident.ms || 0);
    });
    if (fresh.length && Date.now() < deadline) {
      var got = supportDeskIncidents_(fresh, 'form');
      out.incidents = got.raised || 0;
    }
  }
  if (Date.now() < deadline) {
    try { out.owed = sdOwedSay_('', deadline); } catch (eO) { out.why.push('owed texts: ' + sdErr_(eO)); }
  }
  if (autos.time_off && Date.now() < deadline && sdHasSched_()) {
    try {
      schedRead_(SCHED_TABS.flows).forEach(function (f) {
        if (f.kind !== 'time_off' || sdStr_(f.source_ref) !== 'my-calendar' || Date.now() > deadline) return;
        if (sdEventById_(sdEventId_('vacation', f.id))) return;
        if (sdVacationRaise_(f).raised) out.vacations++;
      });
    } catch (eV) { out.why.push('vacations: ' + sdErr_(eV)); }
  }
  return out;
}

/* ---- My Calendar → Vacation Requests, into Scheduling's own time-off flow ---- */

/** The caller's own identity: signed in, a person, at their own keyboard. */
function sdOwnIdentity_(user) {
  if (!user || user.is_service) return { refuse: sdRefuse_(404, 'Unknown action.') };
  if (sdVisiting_(user)) return { refuse: sdRefuse_(403, 'Ask from your own account — not while visiting someone else.') };
  var uid = hubActingUserId_(user);
  if (!uid) return { refuse: sdRefuse_(404, 'Unknown action.') };
  return { uid: uid, name: sdActorName_(user) };
}

function sdVacationWord_(state) {
  return { waiting: 'Waiting on the directors', approved: 'Approved', approved_future: 'Approved', declined: 'Declined',
           expired: 'Expired', withdrawn: 'Withdrawn' }[state] || sdStr_(state);
}

function sdVacationRaise_(f) {
  var id = sdEventId_('vacation', f.id);
  var who = sdStr_(f.person);
  var items = sdDirectors_().list.filter(function (d) { return d.uid !== sdStr_(f.person_uid); }).map(function (d) {
    return sdItem_(f.id, 'info', 'director', d, 'Vacation request — ' + who,
                   sdDayWords_(f.date) + ' to ' + sdDayWords_(f.date_to || f.date) +
                   '. Approve or decline in Support Requests or My Work.', '', f.date);
  });
  return sdRaise_({ id: id, kind: 'vacation', ref: f.id, route: '', source: 'my-calendar', source_ref: f.id,
                    title: 'Vacation request — ' + who, category: 'Schedule - Time Off Request', person: who,
                    person_key: sdStr_(f.person_key), person_uid: sdStr_(f.person_uid), house: '', day: sdStr_(f.date),
                    at: sdStr_(f.created_at), details: { from: sdStr_(f.date), to: sdStr_(f.date_to) } }, items);
}

HUB_POLICY.myCalendarVacationRoute = {
  file: 'SupportDesk.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: {}
};
HUB_ACTIONS.myCalendarVacationRoute = function (payload, user) {
  var me = sdOwnIdentity_(user);
  if (me.refuse) return me.refuse;
  var out = { on: false, readable: true, why: '', mine: [] };
  if (!hubMyWorkAutoOn_('time_off')) {
    out.why = 'Vacation requests go to the Time Off app.';
    return { status: 200, data: out };
  }
  if (!sdHasSched_()) {
    out.readable = false;
    out.why = 'Scheduling\'s houses are not set up yet — vacation requests go to the Time Off app.';
    return { status: 200, data: out };
  }
  var key = '';
  try { key = schedKeyOf_(user, me.uid); } catch (eK) { key = ''; }
  if (!key) {
    out.why = 'Your account is not matched to one person on the calendar — vacation requests go to the Time Off app.';
    return { status: 200, data: out };
  }
  try {
    schedRead_(SCHED_TABS.flows).forEach(function (f) {
      if (f.kind !== 'time_off' || sdStr_(f.source_ref) !== 'my-calendar' || sdStr_(f.person_key) !== key) return;
      var seats = sdJson_(f.seats, []) || [];
      var seat = (Array.isArray(seats) ? seats : []).filter(function (s) { return s && s.seat === 'director'; })[0] || {};
      out.mine.push({ flow_id: f.id, from: sdStr_(f.date), to: sdStr_(f.date_to) || sdStr_(f.date), state: sdStr_(f.state),
                      word: sdVacationWord_(f.state), decided_by: sdStr_(seat.by), decided_at: sdStr_(seat.at),
                      note: sdStr_(seat.note) });
    });
  } catch (e) {
    out.readable = false;
    out.why = 'Scheduling could not be read just now (' + sdErr_(e) + ').';
    return { status: 200, data: out };
  }
  out.on = true;
  return { status: 200, data: out };
};

HUB_POLICY.myCalendarVacationFile = {
  file: 'SupportDesk.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { from: { type: 'string' }, to: { type: 'string' }, reason: { type: 'string' } }
};
HUB_ACTIONS.myCalendarVacationFile = function (payload, user) {
  var me = sdOwnIdentity_(user);
  if (me.refuse) return me.refuse;
  if (!hubMyWorkAutoOn_('time_off')) return { status: 200, data: { ok: true, routed: false, why: 'The switch is off.' } };
  if (!sdHasSched_()) {
    return { status: 200, data: { ok: true, routed: false, why: 'Scheduling\'s houses are not set up yet.' } };
  }
  var key = '';
  try { key = schedKeyOf_(user, me.uid); } catch (eK) { key = ''; }
  if (!key) return sdRefuse_(403, 'Your account is not matched to one person on the calendar.');
  var isDirector = false;
  try {
    isDirector = schedFlowDirectors_(schedSettings_()).list.some(function (d) { return d.uid === me.uid; });
  } catch (eD) { isDirector = false; }
  var g = { open: true, uid: me.uid, name: me.name, key: key, is_master: false, is_director: isDirector,
            editorOf: function () { return false; } };
  var p = payload || {};
  var got = schedFlowTimeOffAsk_(g, { from: p.from, to: p.to, reason: p.reason }, 'my-calendar');
  if (!got || got.status) return got || sdRefuse_(503, 'Scheduling did not answer.');
  var flow = got.flow;
  try { sdVacationRaise_(flow); } catch (eR) { /* the clock raises it on its next pass */ }
  try { hubSysLog_(sdStr_(user.email), 'myCalendarVacationFile', flow.id, { status: 200 }); } catch (eL) {}
  return { status: 200, data: { ok: true, routed: true, flow_id: flow.id,
                                said: 'Asked. Both directors have it; the first answer decides.' } };
};
