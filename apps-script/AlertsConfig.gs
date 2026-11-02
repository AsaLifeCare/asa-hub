// HIRING CONFIG — recipients, timings and guards in the hiring_alerts_config key/value tab, editable from Settings…
// The MESSAGE TEXTS left: every msg_* key is a history row whose living copy is a Smart Comms situation.
var HIRING_ALERTS_TAB = 'hiring_alerts_config';
var HIRING_ALERTS_CACHE_KEY = 'hiring_alerts_cfg';

// WHICH KEYS EXIST is AlertsCatalog.gs's question, not this file's: hiringAlertsCatalogRows_() answers it from the…

/** The tab, created and seeded on first touch — nothing to install. */
function hiringAlertsSheet_() {
  var sheet = hubTabEnsure_(HIRING_ALERTS_TAB, ['key', 'value', 'note']);
  // Facts are keyed by `key` and hold strings, so neither the duplicate rows nor the #ERROR!
  if (sheet.isRuntimeBacked) return sheet;
  // A key added to the CATALOGUE still has to arrive here, or the Settings screen cannot show a row the admin must…
  var catalog = hiringAlertsCatalogRows_();
  var values = sheet.getDataRange().getValues();
  // Every map on this lane is keyed `'k:' + key`: on a bare object `have['constructor']` is truthy before a single…
  var have = {};
  for (var i = 1; i < values.length; i++) {
    var k = String(values[i][0] || '').trim();
    if (k) have['k:' + k] = true;
  }
  var missing = catalog.filter(function (d) { return !have['k:' + d.key]; });
  if (missing.length) {
    // UNDER A LOCK, AND RE-READ INSIDE IT.
    var lock = LockService.getScriptLock();
    var held = false;
    try { held = lock.tryLock(10000); } catch (eL) { held = false; }
    try {
      if (held) {
        // Recompute from the sheet as it is INSIDE the lock, not from the snapshot taken before waiting: the race…
        var fresh = sheet.getDataRange().getValues();
        var now = {};
        for (var j = 1; j < fresh.length; j++) {
          var fk = String(fresh[j][0] || '').trim();
          if (fk) now['k:' + fk] = true;
        }
        missing = missing.filter(function (d) { return !now['k:' + d.key]; });
      }
      // NEVER SEED WITHOUT THE LOCK (found after an hour on a setting that would not save).
      if (!held) { missing = []; }
      // hubCellSafe_ IS NOT OPTIONAL HERE.
      missing.forEach(function (d) {
        sheet.appendRow([d.key, hubCellSafe_(d.value), d.note]);
      });
    } finally {
      if (held) { try { lock.releaseLock(); } catch (eR) { /* released at exit */ } }
    }
    hiringAlertsBump_();   // memo + the 60s entry, both
  }
  hiringAlertsHeal_(sheet);
  return sheet;
}

/** Sheet error text — a cell that reads as one of these holds no value at all. */
var HIRING_ALERTS_ERROR = /^#(ERROR!|REF!|NAME\?|VALUE!|DIV\/0!|N\/A|NULL!|NUM!)/;

// Put back a default whose cell became a spreadsheet ERROR.
function hiringAlertsHeal_(sheet) {
  try {
    var values = sheet.getDataRange().getValues();
    // `'k:' + key`, not the bare key: `byKey['constructor']` is truthy on a bare object and would heal a row this…
    var byKey = {};
    hiringAlertsCatalogRows_().forEach(function (d) { byKey['k:' + d.key] = d; });
    var fixed = 0, leftBroken = [];
    for (var i = 1; i < values.length; i++) {
      var key = String(values[i][0] || '').trim();
      var val = String(values[i][1] == null ? '' : values[i][1]).trim();
      if (!key || !byKey['k:' + key] || !HIRING_ALERTS_ERROR.test(val)) continue;
      var def = byKey['k:' + key];
      if (String(def.value == null ? '' : def.value).trim() === '' && !def.shipped) {
        leftBroken.push(key);
        continue;
      }
      sheet.getRange(i + 1, 2).setValue(hubCellSafe_(def.value));
      fixed++;
    }
    if (leftBroken.length) {
      try {
        hubSysLog_('asa-hub:heal', 'hiring_alerts_not_healed',
                   leftBroken.join(', ') + ' — the cell is a spreadsheet error, the key exists ' +
                   'only in the catalogue sheet and its default there is empty, so it was left ' +
                   'as it is rather than blanked',
                   { status: 500 });
      } catch (eNH) { /* the cell matters more than the note */ }
    }
    // AND THE DUPLICATES GO — a key belongs in the tab exactly once.
    var seen = {}, doomed = [];
    for (var d = 1; d < values.length; d++) {
      var dk = String(values[d][0] || '').trim();
      if (!dk) continue;
      var dv = String(values[d][1] == null ? '' : values[d][1]).trim();
      if (seen['k:' + dk] === undefined) { seen['k:' + dk] = { row: d, value: dv }; continue; }
      // keep whichever carries a value; the incumbent wins a tie
      if (!seen['k:' + dk].value && dv) {
        doomed.push(seen['k:' + dk].row);
        seen['k:' + dk] = { row: d, value: dv };
      } else { doomed.push(d); }
    }
    if (doomed.length) {
      var dlock = LockService.getScriptLock(), dheld = false;
      try { dheld = dlock.tryLock(10000); } catch (eDL) { dheld = false; }
      if (dheld) {
        try {
          doomed.sort(function (a, b) { return b - a; });
          for (var x = 0; x < doomed.length; x++) sheet.deleteRow(doomed[x] + 1);
          fixed += doomed.length;
          try {
            hubSysLog_('asa-hub:heal', 'hiring_alerts_dedup',
                       doomed.length + ' duplicate row(s) removed', { status: 200 });
          } catch (eLg) { /* the collapse matters more than the note */ }
        } finally {
          try { dlock.releaseLock(); } catch (eR2) { /* released at exit */ }
        }
      }
    }
    if (fixed) {
      hiringAlertsBump_();   // memo + the 60s entry, both
    }
  } catch (e2) { /* a broken cell is better than a broken read */ }
}

// The whole config as {key: value}, memoised per execution and cached 60s.
var HIRING_ALERTS_MEMO = null;

function hiringAlerts_() {
  if (HIRING_ALERTS_MEMO) return HIRING_ALERTS_MEMO;
  var cache = CacheService.getScriptCache();
  var hit = cache.get(HIRING_ALERTS_CACHE_KEY);
  if (hit) {
    try { HIRING_ALERTS_MEMO = JSON.parse(hit); return HIRING_ALERTS_MEMO; }
    catch (e) { /* re-read below */ }
  }
  var values = hiringAlertsSheet_().getDataRange().getValues();
  var cfg = {};
  for (var i = 1; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    if (key) cfg[key] = String(values[i][1] == null ? '' : values[i][1]);
  }
  try { cache.put(HIRING_ALERTS_CACHE_KEY, JSON.stringify(cfg), 60); } catch (e) { /* served uncached */ }
  HIRING_ALERTS_MEMO = cfg;
  return cfg;
}

/** Drop both caches after a write — the memo dies with the round trip. */
function hiringAlertsBump_() {
  HIRING_ALERTS_MEMO = null;
  try { CacheService.getScriptCache().remove(HIRING_ALERTS_CACHE_KEY); } catch (e) {}
}

/** Recipients as lists — config first, the old constants as the floor. */
function hubAlertRecipients_() {
  var cfg = hiringAlerts_();
  var split = function (raw) {
    return String(raw || '').split(/[,;\n]+/).map(function (s) { return s.trim(); }).filter(String);
  };
  var sms = split(cfg.sms_recipients);
  var emails = split(cfg.email_recipients);
  return {
    sms: sms.length ? sms : split(bookText_('Strings', 'recipients.date_accepted.sms', '')),
    emails: emails.length ? emails : split(bookText_('Strings', 'recipients.date_accepted.emails', ''))
  };
}

/** TEST MODE — one place decides whether a real person hears from us. */

/** Split a config cell on comma/semicolon/newline into trimmed entries. */
function hubCfgList_(raw) {
  return String(raw == null ? '' : raw).split(/[,;\n]+/)
    .map(function (s) { return s.trim(); }).filter(String);
}

/** +1XXXXXXXXXX, or '' when it is not a number we can send to. */
function hubTestPhone_(raw) {
  var d = String(raw == null ? '' : raw).replace(/\D/g, '').replace(/^1/, '');
  return d.length === 10 ? '+1' + d : '';
}

// The address, or '' — deliberately strict, because a typo here means a channel silently has nobody on it and every…
function hubTestEmail_(raw) {
  var s = String(raw == null ? '' : raw).trim();
  return /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(s) ? s : '';
}

// ------------------------------------------------------------------ THE SHARED-LINE LAW, ASKED BY THE REDIRECT TOO…
function hubSharedLineDigits_() {
  if (typeof SHARED_LINE_DIGITS === 'undefined' || !SHARED_LINE_DIGITS) return [];
  var raw = Array.isArray(SHARED_LINE_DIGITS) ? SHARED_LINE_DIGITS : Object.keys(SHARED_LINE_DIGITS);
  var out = [];
  raw.forEach(function (d) {
    var k = String(d == null ? '' : d).replace(/\D/g, '').slice(-10);
    if (k.length === 10 && out.indexOf(k) === -1) out.push(k);
  });
  return out;
}

// Is this destination one of the company's own shared lines?
function hubSharedLine_(value) {
  var k = String(value == null ? '' : value).replace(/\D/g, '').slice(-10);
  return !!k && hubSharedLineDigits_().indexOf(k) !== -1;
}

// THE SENTENCE, WRITTEN ONCE AND SAID EVERYWHERE — the config screen, the system log, the abilities report and the…
function hubTestSharedWarning_(st) {
  // NOTHING IS REDIRECTED ANY MORE, so there is no room to warn about: every on position of test mode writes a row…
  return '';
}

/** The words test_mode is read by; HUB_REHEARSAL_WORDS (Rpc.gs) are on too. */
var HUB_TEST_MODE_ON_WORDS = ['on', 'true', '1', 'test'];
var HUB_TEST_MODE_OFF_WORDS = ['off', 'false', '0', 'production'];

/** Is this test_mode word one the reader knows? A blank cell is known (never set). */
function hubTestModeWordKnown_(raw) {
  var w = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!w) return true;
  if (HUB_TEST_MODE_ON_WORDS.indexOf(w) !== -1 || HUB_TEST_MODE_OFF_WORDS.indexOf(w) !== -1) return true;
  return typeof HUB_REHEARSAL_WORDS !== 'undefined' && HUB_REHEARSAL_WORDS.indexOf(w) !== -1;
}

/** The sentence a held message and the relay carry for a word the reader does not know. */
function hubTestModeUnknownWhy_(word) {
  return 'test_mode reads "' + String(word).slice(0, 40) + '", a word the switch does not know ' +
         '(on or off) — held as on until it is saved as one of them';
}

/** The whole state of test mode, resolved once: { on, explicit, unrecognized, sms: [], emails: [], dropped: [], shared: [] }. */
function hubTestModeState_(cfg) {
  cfg = cfg || ((typeof hiringAlerts_ === 'function') ? hiringAlerts_() : {});
  var dropped = [];
  var sms = [], emails = [];
  hubCfgList_(cfg.test_redirect_sms).forEach(function (raw) {
    var n = hubTestPhone_(raw);
    if (n) { if (sms.indexOf(n) === -1) sms.push(n); } else dropped.push(raw);
  });
  hubCfgList_(cfg.test_redirect_email).forEach(function (raw) {
    var e = hubTestEmail_(raw);
    if (e) { if (emails.indexOf(e) === -1) emails.push(e); } else dropped.push(raw);
  });
  var raw = String(cfg.test_mode == null ? '' : cfg.test_mode).trim().toLowerCase();
  var on;
  var unrecognized = '';
  if (HUB_TEST_MODE_ON_WORDS.indexOf(raw) !== -1) on = true;
  // THE SHEET WORDS ARE ON, WHOEVER IS LISTED: test mode is one switch, and every on position sends nothing (Rpc.gs…
  else if (typeof HUB_REHEARSAL_WORDS !== 'undefined' && HUB_REHEARSAL_WORDS.indexOf(raw) !== -1) on = true;
  else if (HUB_TEST_MODE_OFF_WORDS.indexOf(raw) !== -1) on = false;
  else if (!raw) on = (sms.length + emails.length) > 0;    // never set — ON if a tester is listed
  // FAIL-CLOSED: a typed word outside the vocabulary is a switch nobody can read, so it holds and is named…
  else { on = true; unrecognized = raw; }
  // WHICH OF THE TESTERS IS A ROOM.
  var shared = sms.filter(function (n) { return hubSharedLine_(n); });
  return { on: on, explicit: raw !== '', unrecognized: unrecognized, sms: sms, emails: emails,
           dropped: dropped, shared: shared };
}

// May this config be saved?
function hubTestModeRefusal_(next, values) {
  var typed = values || null;
  // A word the reader does not know is refused whatever else the save touches: stored, it holds every message as on…
  var touchesMode = !typed || Object.prototype.hasOwnProperty.call(typed, 'test_mode');
  if (touchesMode && !hubTestModeWordKnown_((next || {}).test_mode)) {
    return 'Test mode is "on" or "off" — "' + String((next || {}).test_mode).trim().slice(0, 40) +
           '" is a word the switch does not know. Choose one of the two positions and save again.';
  }
  var touchesLists = !typed ||
    Object.prototype.hasOwnProperty.call(typed, 'test_redirect_sms') ||
    Object.prototype.hasOwnProperty.call(typed, 'test_redirect_email');
  if (!touchesLists) return '';
  var st = hubTestModeState_(next);
  if (st.dropped.length) {
    return 'Not a usable recipient: ' + st.dropped.join(', ') +
           '. Numbers are +1XXXXXXXXXX and addresses need an @ — an entry that ' +
           'does not parse is a tester nobody can name.';
  }
  return '';
}

/** A whole number from the config, or the shipped value. */
function hubCfgInt_(key, fallback, min, max) {
  var raw;
  try { raw = (typeof hiringAlerts_ === 'function' ? hiringAlerts_() : {})[key]; }
  catch (e) { return fallback; }
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return fallback;
  var n = parseInt(s, 10);
  if (!isFinite(n)) return fallback;
  if (min !== undefined && n < min) return fallback;
  if (max !== undefined && n > max) return fallback;
  return n;
}

// An on/off cell.
function hubCfgOn_(key) {
  var raw;
  try { raw = (typeof hiringAlerts_ === 'function' ? hiringAlerts_() : {})[key]; }
  catch (e) { return false; }
  var v = String(raw == null ? '' : raw).trim().toLowerCase();
  return v === 'on' || v === 'true' || v === '1' || v === 'yes';
}

// SETTINGS > MY WORK: what the master hides from every other account.
var MYWORK_HIDE_KEYS = { header: 'mywork_hide_header', source_notes: 'mywork_hide_source_notes',
                         missing_row: 'mywork_hide_missing_row', completed: 'mywork_hide_completed',
                         inbox_sources: 'mywork_hide_inbox_sources',
                         ssa_updated: 'mywork_hide_ssa_updated', ssa_county: 'mywork_hide_ssa_county',
                         ssa_count: 'mywork_hide_ssa_count', ssa_role: 'mywork_hide_ssa_role',
                         sched_hours: 'mywork_hide_sched_hours', record_notes: 'mywork_hide_record_notes' };

/** Is `key` one of the My Work display switches — the master's pen alone? */
function hubMyWorkHideKey_(key) {
  return /^mywork_/.test(String(key == null ? '' : key));
}

// FAIL-CLOSED: the master in its own session, the only person who reads or writes the switches.
function hubMyWorkHideMaster_(user) {
  try { return (typeof hubIsRealMaster_ === 'function') && !!hubIsRealMaster_(user); }
  catch (e) { return false; }
}

// Who the config lane hands the switches to: the service identity (the relay, which obeys them) and the master's…
function hubMyWorkHideLaneFor_(user) {
  return !!(user && user.is_service === true) || hubMyWorkHideMaster_(user);
}

/** The parts that FAIL CLOSED: only a plain no shows what they hide; a blank cell or an unknown word hides. */
var MYWORK_HIDE_FAIL_CLOSED = { sched_hours: true };

// The switches as booleans; anything not plainly yes hides nothing, except a fail-closed part, where anything not…
function hubMyWorkHideRead_() {
  var cfg = hiringAlerts_() || {};
  var shipped = hubMyWorkHideDefaults_();
  var out = {};
  for (var part in MYWORK_HIDE_KEYS) {
    if (!MYWORK_HIDE_KEYS.hasOwnProperty(part)) continue;
    var key = MYWORK_HIDE_KEYS[part];
    var raw = cfg[key] !== undefined ? cfg[key] : shipped['k:' + key];
    var v = String(raw == null ? '' : raw).trim().toLowerCase();
    out[part] = MYWORK_HIDE_FAIL_CLOSED[part] ? !(v === 'no' || v === 'off' || v === 'false' || v === '0')
      : (v === 'yes' || v === 'on' || v === 'true' || v === '1');
  }
  return out;
}

// The stamps switch (`ssa_updated`) as authMe and authLogin hand it to every session; the screen shows the stamps…
function hubStampsHidden_() {
  try { return hubMyWorkHideRead_().ssa_updated !== false; } catch (e) { return true; }
}

// Scheduling's hours column (`sched_hours`): hidden from everyone but the master, and FAIL-CLOSED — only a plain no…
function hubSchedHoursHidden_() { try { return hubMyWorkHideRead_().sched_hours !== false; } catch (e) { return true; } }

// The Staff source-notes switch (`record_notes`) as authMe and authLogin hand it to every session; the screen shows…
function hubRecordNotesHidden_() { try { return hubMyWorkHideRead_().record_notes !== false; } catch (e) { return true; } }

// SETTINGS > MY WORK, the app list: comma-separated app ids that reach the master's own session alone.
var MYWORK_APPS_KEY = 'mywork_hide_apps';

// The accounts (USR_ ids) that see the listed apps too, each as App Control has them.
var MYWORK_APPS_SEEN_KEY = 'mywork_hide_apps_seen';

/** FAIL-OPEN: a list cell's ids, once each; a cell that cannot be read lists none. */
function hubMyWorkListRead_(key) {
  var raw;
  try { raw = (hiringAlerts_() || {})[key]; } catch (e) { return []; }
  var out = [];
  String(raw == null ? '' : raw).split(/[,;\s]+/).forEach(function (x) {
    var id = String(x || '').trim().slice(0, 80);
    if (id && out.indexOf(id) === -1) out.push(id);
  });
  return out;
}

/** The listed app ids. */
function hubMyWorkAppsRead_() { return hubMyWorkListRead_(MYWORK_APPS_KEY); }

/** The accounts that see the listed apps too; an unreadable cell lets nobody in. */
function hubMyWorkAppsSeenRead_() { return hubMyWorkListRead_(MYWORK_APPS_SEEN_KEY); }

// The ids cut from what this caller is handed: none for the master's own session, the service identity (the relay…
function hubMyWorkAppsCutFor_(user) {
  if (hubMyWorkHideLaneFor_(user)) return [];
  var cut = hubMyWorkAppsRead_();
  if (!cut.length || !user || user.visiting_member) return cut;
  var id = String(user.id || '').trim();
  return id && hubMyWorkAppsSeenRead_().indexOf(id) !== -1 ? [] : cut;
}

/** A copy of an app-keyed map without the cut ids; the map itself when nothing is cut. */
function hubMyWorkAppsCut_(map, cut) {
  if (!map || typeof map !== 'object' || Array.isArray(map) || !cut || !cut.length) return map;
  var out = {};
  for (var k in map) {
    if (map.hasOwnProperty(k) && cut.indexOf(k) === -1) out[k] = map[k];
  }
  return out;
}

// SETTINGS > MY WORK, the world switch: yes keeps My World (World.gs) to the master's own session and the accounts…
var MYWORK_WORLD_KEY = 'mywork_hide_world';

// The accounts (USR_ ids) that keep their world while the switch is on.
var MYWORK_WORLD_SEEN_KEY = 'mywork_hide_world_seen';

/** FAIL-OPEN: the switch; a cell that cannot be read is the shipped no. */
function hubMyWorldHideOn_() { return hubCfgOn_(MYWORK_WORLD_KEY); }

/** The accounts that keep their world; an unreadable cell lets nobody in. */
function hubMyWorldSeenRead_() { return hubMyWorkListRead_(MYWORK_WORLD_SEEN_KEY); }

// Is My World kept from this caller?
function hubMyWorldHiddenFor_(user) {
  try {
    if (hubMyWorkHideLaneFor_(user)) return false;
    var who = (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX &&
               typeof HUB_CALLER !== 'undefined' && HUB_CALLER) ? HUB_CALLER : user;
    if (!who || who.is_service === true) return false;
    if (!who.visiting_member && String(who.role || '') === 'admin' && hubIsMaster_(who.email)) return false;
    if (!hubMyWorldHideOn_()) return false;
    if (who.visiting_member) return true;
    var id = String(who.id || '').trim();
    return !(id && hubMyWorldSeenRead_().indexOf(id) !== -1);
  } catch (e) {
    return false;
  }
}

// SETTINGS > MY WORK, the My asa.
var MYWORK_MYASA_KEY = 'mywork_hide_myasa';

// The accounts (USR_ ids) that keep My asa.
var MYWORK_MYASA_SEEN_KEY = 'mywork_hide_myasa_seen';

/** FAIL-OPEN: the switch; a cell that cannot be read is the shipped no. */
function hubMyAsaHideOn_() { return hubCfgOn_(MYWORK_MYASA_KEY); }

/** The accounts that keep My asa.; an unreadable cell lets nobody in. */
function hubMyAsaSeenRead_() { return hubMyWorkListRead_(MYWORK_MYASA_SEEN_KEY); }

// Are My asa.
function hubMyAsaHiddenFor_(user) {
  try {
    if (hubMyWorkHideLaneFor_(user)) return false;
    var who = (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX &&
               typeof HUB_CALLER !== 'undefined' && HUB_CALLER) ? HUB_CALLER : user;
    if (!who || who.is_service === true) return false;
    if (!who.visiting_member && String(who.role || '') === 'admin' && hubIsMaster_(who.email)) return false;
    if (!hubMyAsaHideOn_()) return false;
    if (who.visiting_member) return true;
    var id = String(who.id || '').trim();
    return !(id && hubMyAsaSeenRead_().indexOf(id) !== -1);
  } catch (e) {
    return false;
  }
}

// Each switch's default ('k:' + key), from the catalogue; the shipped copy when the catalogue cannot answer.
function hubMyWorkHideDefaults_() {
  var rows;
  try { rows = hiringAlertsCatalog_().rows; } catch (e) { rows = null; }
  if (!Array.isArray(rows)) rows = HIRING_ALERTS_CATALOG_SHIPPED;
  var out = {};
  rows.forEach(function (d) { if (d && hubMyWorkHideKey_(d.key)) out['k:' + d.key] = d.value; });
  return out;
}

// hubAlertRender_ LEFT WITH THE MESSAGES: every template it rendered is a Smart Comms situation row now, rendered…

/** Read the config for the Settings screens. Admin only. */
HUB_POLICY.hiringAlertsGet = {
  file: 'AlertsConfig.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.hiringAlertsGet = function (payload, user) {
  if (!user || user.role !== 'admin') return hubDenied_();
  // LEVEL THE TAB HERE: hiringAlerts_ seeds nothing while the 60s cache is warm, so a key added to the catalogue…
  try { hiringAlertsSheet_(); } catch (eSeed) { /* the values below still answer from the catalogue */ }
  var cfg = hiringAlerts_();
  var catalog = hiringAlertsCatalog_();
  var st = hubTestModeState_(cfg);
  var sharedWarning = hubTestSharedWarning_(st);
  // Settings > My Work's rows are the master's to read: every other admin gets neither the values nor the key names.
  var seesMyWork = hubMyWorkHideMaster_(user);
  var shownRows = catalog.rows.filter(function (d) { return seesMyWork || !hubMyWorkHideKey_(d.key); });
  var shippedOnly = (catalog.shipped_only || []).filter(function (k) { return seesMyWork || !hubMyWorkHideKey_(k); });
  return { status: 200, data: {
    rows: shownRows.map(function (d) {
      // THE NOTE IS WHERE THE SCREEN ALREADY LOOKS.
      var note = d.note;
      if (d.key === 'test_redirect_sms' && sharedWarning) note = note + ' — ' + sharedWarning;
      return { key: d.key, value: cfg[d.key] !== undefined ? cfg[d.key] : d.value,
               note: note, default_value: d.value,
               // Which screen owns this row — the client must not re-derive it from key names.
               group: d.group || 'alerts' };
    }),
    // WHERE THE KEYS CAME FROM, IN THE ANSWER ITSELF.
    catalogue: { ok: catalog.ok, read: catalog.read, source: catalog.source,
                 tab: catalog.tab, keys: shownRows.length,
                 sheet_keys: catalog.sheet_keys, shipped_only: shippedOnly,
                 // What the reader had to CORRECT in a cell somebody typed (a group no screen draws, a default…
                 repaired: (catalog.repaired || []).filter(function (l) { return seesMyWork || !hubMyWorkHideKey_(l); }),
                 refused: catalog.refused,
                 message: catalog.message },
    // The RESOLVED state, not the raw cells: empty test_mode with a tester listed is ON, and the screen must show…
    test_mode: { on: st.on, explicit: st.explicit, unrecognized: st.unrecognized,
                 sms: st.sms, emails: st.emails, dropped: st.dropped,
                 shared: st.shared, shared_warning: sharedWarning },
    // Who can sign a scorecard from ALL three routes — showing only the cell would hide access somebody still holds…
    scorecard: (typeof interviewWhoCanRecord_ === 'function')
      ? interviewWhoCanRecord_() : null
  } };
};

/** Save edited cells. Admin only; unknown keys are ignored, not created. */
HUB_POLICY.hiringAlertsSet = {
  file: 'AlertsConfig.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.hiringAlertsSet = function (payload, user) {
  if (!user || user.role !== 'admin') return hubDenied_();
  var values = (payload && payload.values) || {};
  // WHAT MY WORK SHOWS EVERYBODY ELSE IS THE MASTER'S ALONE: the master in its own session, never a visit, an…
  var myWorkKeys = Object.keys(values).filter(hubMyWorkHideKey_);
  if (myWorkKeys.length) {
    if (!hubMyWorkHideMaster_(user)) {
      hubSysLog_(user && user.email, 'hiring_alerts_refused',
                 'my work display keys refused: ' + myWorkKeys.join(', '), { status: 403 });
      return { status: 403, message: 'What My Work and My Inbox show is set by the master account alone (' +
               myWorkKeys.join(', ') + '). Nothing was saved.' };
    }
  }
  // FEATURE ACCESS IS THE ACCESS MATRIX'S.
  var grants = Object.keys(values).filter(function (k) { return /_badges$/.test(String(k)); });
  if (grants.length) {
    var mayGrant = false;
    try { mayGrant = (typeof accessMatrixMayEdit_ === 'function') && !!accessMatrixMayEdit_(user); }
    catch (eG) { mayGrant = false; }
    if (!mayGrant) {
      hubSysLog_(user && user.email, 'hiring_alerts_refused',
                 'feature access keys refused: ' + grants.join(', '), { status: 403 });
      return { status: 403, message: 'Feature access is changed only by whoever the access rule names (' +
               grants.join(', ') + '). Nothing was saved.' };
    }
  }
  var sheet = hiringAlertsSheet_();
  var data = sheet.getDataRange().getValues();
  // `'k:' + key`: on a bare object `known['constructor']` is truthy with nothing in it, so a payload key by that…
  var catalog = hiringAlertsCatalogRows_();
  var known = {};
  catalog.forEach(function (d) { known['k:' + d.key] = true; });
  var isKnown = function (k) { return known['k:' + k] === true; };

  // VALIDATE THE WHOLE RESULT, NOT THE EDIT.
  var before = hiringAlerts_(), next = {};
  for (var bk in before) if (before.hasOwnProperty(bk)) next[bk] = before[bk];
  for (var pk in values) {
    if (values.hasOwnProperty(pk) && isKnown(pk)) next[pk] = String(values[pk] == null ? '' : values[pk]);
  }
  var refusal = hubTestModeRefusal_(next, values);
  if (refusal) {
    hubSysLog_(user && user.email, 'hiring_alerts_refused', refusal, { status: 400 });
    return { status: 400, error: refusal };
  }

 // UNKNOWN KEYS REFUSE OUT LOUD: the old shape dropped them silently and answered success - a version-skewed screen…
  var unknown = [];
  for (var uk in values) { if (values.hasOwnProperty(uk) && !isKnown(uk)) unknown.push(uk); }
  if (unknown.length) {
    return { status: 400, message: 'The configuration catalogue does not know: ' + unknown.join(', ') +
             ' - add the key to the ' + HIRING_ALERTS_CATALOG_TAB + ' sheet, or publish the latest ' +
             'Apps Script version, and save again.' };
  }
  var changed = 0;
  for (var key in values) {
    if (!isKnown(key)) continue;                     // config, not a free-for-all
    var v = String(values[key] == null ? '' : values[key]);
    var found = false;
    // EVERY ROW WITH THIS KEY, NOT THE FIRST (found after an hour: everything was selected, the apply went through…
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]).trim() === key) {
        sheet.getRange(r + 1, 2).setValue(v);
        found = true;
      }
    }
    if (!found) {
      // APPEND WITH ITS NOTE: the note is the only place that says what the cell does, and a save used to leave the…
      var def = null;
      catalog.forEach(function (d) { if (d.key === key) def = d; });
      sheet.appendRow([key, v, def ? def.note : '']);
    }
    changed++;
  }
  hiringAlertsBump_();   // memo + the 60s entry, both
  hubSysLog_(user && user.email, 'hiring_alerts_set', changed + ' key(s) updated', { status: 200 });

  // GOING BACK TO PRODUCTION IS AN EVENT — the minute real applicants start hearing from us again must be in the…
  var after = hubTestModeState_(next);
  var afterWarning = hubTestSharedWarning_(after);
  if (after.on !== hubTestModeState_(before).on) {
    hubSysLog_(user && user.email, 'test_mode_' + (after.on ? 'on' : 'off'),
               after.on
                 ? 'TEST MODE ON — nothing leaves the platform: every message is written as a row ' +
                   'in the mock outbox, and the sending dial follows (record)'
                 : 'PRODUCTION — messages now reach their real recipients, and the sending dial ' +
                   'follows (send)',
               { status: 200 });
  }
  // AND SAID AT EVERY SAVE THAT LEAVES IT POINTING THERE, not only at the save that switched test mode on.
  if (after.on && afterWarning) {
    hubSysLog_(user && user.email, 'test_redirect_shared_line', afterWarning, { status: 200 });
  }
  // The warning travels with the answer so the screen can show it without re-deriving it — and `saved` is…
  return { status: 200, data: { saved: changed,
                                test_mode: { on: after.on, shared: after.shared },
                                warning: afterWarning } };
};
