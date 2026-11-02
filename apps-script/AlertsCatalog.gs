// ------------------------------------------------------------------ THE CONFIG CATALOGUE — which keys exist, read…
// Everything hardcoded moves to a sheet — far too much of this lane was living in code.
var HIRING_ALERTS_CATALOG_TAB = 'hiring_alerts_catalog';

// The columns, by NAME — the reader finds them in the header row, so a column inserted by hand in the sheet cannot…
var HIRING_ALERTS_CATALOG_HEADER = ['key', 'group', 'default_value', 'note'];

// THE GROUPS ARE A CLOSED VOCABULARY, AND THAT IS THE WHOLE POINT OF NAMING THEM HERE.
var HIRING_ALERTS_CATALOG_GROUPS = ['messages', 'recipients', 'timing', 'guard', 'test',
                                    'alerts', 'access', 'clients', 'hiringapp', 'platform',
                                    'mywork'];

// The group a row falls to when nothing else can answer — the general list, visible rather than lost.
var HIRING_ALERTS_CATALOG_GROUP_FALLBACK = 'alerts';

// A KEY A PLAIN `{key: value}` MAP CANNOT CARRY.
var HIRING_ALERTS_CATALOG_REFUSED_KEYS = ['__proto__'];

// THE CACHE KEY AND ITS LIFETIME.
var HIRING_ALERTS_CATALOG_CACHE_KEY = 'hiring_alerts_catalog';
var HIRING_ALERTS_CATALOG_TTL = 300;
var HIRING_ALERTS_CATALOG_TTL_FAILED = 60;

/** How often a degraded read is written to the system log (see below). */
var HIRING_ALERTS_CATALOG_SAID_KEY = 'hiring_alerts_catalog_said';
var HIRING_ALERTS_CATALOG_SAID_TTL = 3600;

var HIRING_ALERTS_CATALOG_MEMO = null;

// THE CACHE, BEHIND A FUNCTION — so a test can stand somewhere else.
function hiringAlertsCatalogCache_() {
  try { return CacheService.getScriptCache(); } catch (e) { return null; }
}

// The catalogue's own sheet, or null.
function hiringAlertsCatalogSheet_() {
  try {
    if (typeof houseSheetFor_ !== 'function') return null;
    return houseSheetFor_(HIRING_ALERTS_CATALOG_TAB) || null;
  } catch (e) { return null; }
}

// The catalogue exactly as the house holds it: { rows, read, why }.
function hiringAlertsCatalogFromSheet_() {
  var sheet = hiringAlertsCatalogSheet_();
  if (!sheet) {
    return { rows: [], read: false,
             why: 'no ' + HIRING_ALERTS_CATALOG_TAB + ' house is declared, or it did not open' };
  }
  var values;
  try { values = sheet.getDataRange().getValues(); }
  catch (eRead) {
    return { rows: [], read: false,
             why: 'the catalogue tab could not be read (' +
                  String((eRead && eRead.message) || eRead) + ')' };
  }
  if (!values || values.length < 2) {
    return { rows: [], read: false, why: 'the catalogue tab carries no rows under its header' };
  }
  var head = [];
  for (var h = 0; h < values[0].length; h++) {
    head.push(String(values[0][h] == null ? '' : values[0][h]).trim().toLowerCase());
  }
  var iKey = head.indexOf('key');
  if (iKey === -1) {
    return { rows: [], read: false,
             why: 'the catalogue header has no `key` column (found: ' + head.join(', ') + ')' };
  }
  var iGroup = head.indexOf('group');
  var iValue = head.indexOf('default_value');
  var iNote = head.indexOf('note');
  var cell = function (row, at) {
    return at === -1 ? '' : String(row[at] == null ? '' : row[at]);
  };
  // A KEY TWICE IN THE CATALOGUE KEEPS ITS FIRST PLACE AND ITS LAST WORDS.
  var rows = [], at = {}, doubled = 0, refused = [];
  for (var i = 1; i < values.length; i++) {
    var key = String(values[i][iKey] == null ? '' : values[i][iKey]).trim();
    if (!key) continue;
    if (HIRING_ALERTS_CATALOG_REFUSED_KEYS.indexOf(key) !== -1) {
      if (refused.indexOf(key) === -1) refused.push(key);
      continue;
    }
    var row = { key: key,
                group: cell(values[i], iGroup).trim() || HIRING_ALERTS_CATALOG_GROUP_FALLBACK,
                value: cell(values[i], iValue),
                note: cell(values[i], iNote) };
    if (at['k:' + key] === undefined) { at['k:' + key] = rows.length; rows.push(row); }
    else { rows[at['k:' + key]] = row; doubled++; }
  }
  if (!rows.length) {
    return { rows: [], read: false, refused: refused,
             why: 'the catalogue tab has a header and no key rows' };
  }
  return { rows: rows, read: true, doubled: doubled, refused: refused, why: '' };
}

// The sheet's rows, plus any key only the shipped copy knows.
function hiringAlertsCatalogMerge_(got) {
  var shipped = [];
  try {
    if (typeof HIRING_ALERTS_CATALOG_SHIPPED !== 'undefined' && HIRING_ALERTS_CATALOG_SHIPPED) {
      shipped = HIRING_ALERTS_CATALOG_SHIPPED;
    }
  } catch (eS) { shipped = []; }
  // `'k:' + key` here too: a bare map would answer `true` for `constructor` and drop that key out of the union…
  var byShipped = {};
  shipped.forEach(function (d) {
    var k = String(d && d.key ? d.key : '').trim();
    if (k) byShipped['k:' + k] = d;
  });
  var blank = function (v) { return String(v == null ? '' : v).trim() === ''; };

  var rows = [], have = {}, repaired = [];
  (got.rows || []).forEach(function (r) {
    var ship = byShipped['k:' + r.key] || null;
    var group = r.group;
    if (HIRING_ALERTS_CATALOG_GROUPS.indexOf(group) === -1) {
      var fell = (ship && String(ship.group || '').trim()) || HIRING_ALERTS_CATALOG_GROUP_FALLBACK;
      if (HIRING_ALERTS_CATALOG_GROUPS.indexOf(fell) === -1) {
        fell = HIRING_ALERTS_CATALOG_GROUP_FALLBACK;
      }
      repaired.push(r.key + ': group "' + group + '" is not one the platform draws — showing it ' +
                    'under "' + fell + '"');
      group = fell;
    }
    var value = r.value;
    if (blank(value) && ship && !blank(ship.value)) {
      repaired.push(r.key + ': its default cell is empty — using the default shipped with the ' +
                    'code, so nothing restores an empty list');
      value = String(ship.value);
    }
    have['k:' + r.key] = true;
    // `shipped` is a FACT, not a policy: does the code also carry this key?
    rows.push({ key: r.key, group: group, value: value, note: r.note, shipped: !!ship });
  });
  var only = [];
  shipped.forEach(function (d) {
    var key = String(d && d.key ? d.key : '').trim();
    if (!key || have['k:' + key]) return;
    have['k:' + key] = true;
    only.push(key);
    rows.push({ key: key,
                group: String(d.group || '').trim() || HIRING_ALERTS_CATALOG_GROUP_FALLBACK,
                value: String(d.value == null ? '' : d.value), note: '', shipped: true });
  });
  var refused = got.refused || [];
  var says = [];
  // Every admin reads this sentence, so Settings > My Work's keys are never counted or named in it: they are the…
  var masters = function (k) { return /^mywork_/.test(String(k == null ? '' : k)); };
  var named = only.filter(function (k) { return !masters(k); });
  var repairedSaid = repaired.filter(function (line) { return !masters(line); });
  if (!got.read) {
    says.push('The configuration catalogue could not be read from its house (' + got.why +
              '). The keys below are the last-resort copy shipped with the code and they have ' +
              'no notes. The values are the live ones and still rule; nothing else has changed.');
  } else if (named.length) {
    says.push(named.length + ' key(s) are not in the catalogue sheet and are showing without ' +
              'their note: ' + named.join(', ') + '. Run tools/mint_alerts_catalogue.py to ' +
              'write them in.');
  }
  if (refused.length) {
    says.push('Refused as a key name: ' + refused.join(', ') + '. A configuration key is read ' +
              'into a plain map and those names cannot be stored in one, so a field by that ' +
              'name could never hold a value.');
  }
  if (repairedSaid.length) {
    says.push('Corrected while reading the catalogue sheet — ' + repairedSaid.join('; ') + '.');
  }
  return { rows: rows, ok: !!got.read && !only.length && !repaired.length && !refused.length,
           read: !!got.read,
           source: got.read ? 'sheet' : 'shipped', tab: HIRING_ALERTS_CATALOG_TAB,
           sheet_keys: (got.rows || []).length, doubled: got.doubled || 0,
           shipped_only: only, repaired: repaired, refused: refused,
           message: says.join(' ') };
}

/** The whole catalogue, memoised per execution and cached — the one reader. */
function hiringAlertsCatalog_() {
  if (HIRING_ALERTS_CATALOG_MEMO) return HIRING_ALERTS_CATALOG_MEMO;
  var cache = hiringAlertsCatalogCache_();
  if (cache) {
    var hit = null;
    try { hit = cache.get(HIRING_ALERTS_CATALOG_CACHE_KEY); } catch (eG) { hit = null; }
    if (hit) {
      try {
        HIRING_ALERTS_CATALOG_MEMO = JSON.parse(hit);
        return HIRING_ALERTS_CATALOG_MEMO;
      } catch (eP) { /* re-read below */ }
    }
  }
  var out = hiringAlertsCatalogMerge_(hiringAlertsCatalogFromSheet_());
  if (cache) {
    try {
      cache.put(HIRING_ALERTS_CATALOG_CACHE_KEY, JSON.stringify(out),
                out.read ? HIRING_ALERTS_CATALOG_TTL : HIRING_ALERTS_CATALOG_TTL_FAILED);
    } catch (eU) { /* served uncached */ }
  }
  // SAID OUT LOUD, NOT INFERRED — and said ONCE AN HOUR, not once a minute.
  if (out.message) {
    var say = true;
    if (cache) {
      try {
        say = !cache.get(HIRING_ALERTS_CATALOG_SAID_KEY);
        if (say) cache.put(HIRING_ALERTS_CATALOG_SAID_KEY, '1', HIRING_ALERTS_CATALOG_SAID_TTL);
      } catch (eQ) { say = true; }
    }
    if (say) {
      try {
        hubSysLog_('asa-hub:config', 'hiring_alerts_catalog', out.message,
                   { status: out.read ? 200 : 500 });
      } catch (eL) { /* the answer matters more than the note */ }
    }
  }
  HIRING_ALERTS_CATALOG_MEMO = out;
  return out;
}

/** Every configuration key in catalogue order: { key, group, value, note }. */
function hiringAlertsCatalogRows_() {
  return hiringAlertsCatalog_().rows;
}

// Drop the catalogue's memo and its cache entry — for the self-test, and for a hand that has just edited the sheet…
function hiringAlertsCatalogBump_() {
  HIRING_ALERTS_CATALOG_MEMO = null;
  // Through the same door the reader uses, so a test standing on a private store drops ITS entry and never reaches…
  try {
    var cache = hiringAlertsCatalogCache_();
    if (cache) cache.remove(HIRING_ALERTS_CATALOG_CACHE_KEY);
  } catch (e) {}
}

// ------------------------------------------------------------------ THE LAST-RESORT COPY — the keys, their group…
var HIRING_ALERTS_CATALOG_SHIPPED = [
  {"key":"clients_views_master","group":"clients","value":"directory, record, unique"},
  {"key":"clients_toolbar_master","group":"clients","value":"share, export, add"},
  {"key":"hiring_views_master","group":"hiringapp","value":"pipeline, flow"},
  {"key":"platform_email_enabled","group":"platform","value":"yes"},
  {"key":"platform_mail_badges","group":"guard","value":"DIRECTOR"},
  {"key":"contact_sweep_hours","group":"guard","value":"2"},
  {"key":"potclients_views_master","group":"guard","value":"pipeline, unique"},
  {"key":"sms_recipients","group":"recipients","value":"+13309195559, +13309197779, +13309195558"},
  {"key":"escalation_floor_sms","group":"recipients","value":"+13309195559, +13309197779, +13309195558"},
  {"key":"opt_out_phrases","group":"platform","value":""},
  {"key":"opt_in_phrases","group":"platform","value":""},
  {"key":"wrong_number_phrases","group":"platform","value":""},
  {"key":"test_mode","group":"test","value":""},
  {"key":"test_redirect_sms","group":"test","value":""},
  {"key":"test_redirect_email","group":"test","value":""},
  {"key":"packet_rehearsal_number","group":"test","value":""},
  {"key":"copilot_badges","group":"access","value":""},
  {"key":"myworld_badges","group":"access","value":""},
  {"key":"smartcomms_widget_badges","group":"access","value":"DIRECTOR, ADMINISTRATOR, ADMIN, MANAGER"},
  {"key":"franchise_view_badges","group":"access","value":""},
  {"key":"appgrid_badges","group":"access","value":""},
  {"key":"behavior_all_badges","group":"access","value":"ADMIN, ADMINISTRATOR, DIRECTOR, MANAGER, HM"},
  {"key":"render_sheet_edit_badges","group":"access","value":""},
  {"key":"email_recipients","group":"recipients","value":"admin@abrighterdawninc.com, ty.bond@asalifecare.com, asatech@asalifecare.com"},
  {"key":"hiring_team_emails","group":"recipients","value":"arthur.torres@asalifecare.com, ty.bond@asalifecare.com, admin@abrighterdawninc.com"},
  {"key":"interview_supervisor_name","group":"recipients","value":"Tieara Kennemore"},
  {"key":"msg_packet_request_sms","group":"messages","value":"Hi DSP, this is ASA Lifecare. To finish your onboarding we still need your signed New Hire packet. Please check your inbox for your New Hire packet and complete it."},
  {"key":"msg_packet_request_email_subject","group":"messages","value":"Your signed New Hire packet — ASA Lifecare"},
  {"key":"msg_packet_request_email","group":"messages","value":"Hi DSP,\n\nTo finish your onboarding we still need your signed New Hire packet.\nPlease check your inbox for your New Hire packet and complete it.\n\nASA Lifecare"},
  {"key":"test_banner","group":"test","value":""},
  {"key":"interview_scorecard_emails","group":"access","value":""},
  {"key":"hiring_timezone","group":"platform","value":""},
  {"key":"packet_hold_hours","group":"timing","value":""},
  {"key":"onboarding_window_before_days","group":"timing","value":""},
  {"key":"onboarding_window_after_days","group":"timing","value":""},
  {"key":"messages_paused","group":"platform","value":""},
  {"key":"msg_date_accepted","group":"messages","value":"Hub: could not read the accepted in-person date for {name}.\nPhone: {phone} · Email: {email}\n{screen}\n{report}Action: open the Hiring Pipeline card and press Manual on Date accepted."},
  {"key":"msg_hired_complete","group":"messages","value":"Hub: {name} completed every Hired step — all documentation is OK.{manual_note}\nPhone: {phone} · Email: {email}\nThey stay on the last step of the Hiring Pipeline for one more day, then move to Users as staff automatically."},
  {"key":"msg_hired_missing","group":"messages","value":"Hub: {name} reached Hired, but these items are missing:\n{missing}\nPhone: {phone} · Email: {email}\nThey still stay one more day on the pipeline and then move to Users as staff — chase the missing items in the Onboarding Tracker."},
  {"key":"staff_guard_mode","group":"guard","value":"shadow"},
  {"key":"staff_guard_mode_public","group":"guard","value":"shadow"},
  {"key":"staff_guard_block_statuses","group":"guard","value":"active, admin"},
  {"key":"staff_guard_test_phones","group":"guard","value":"+13309195558"},
  {"key":"staff_guard_test_emails","group":"guard","value":"asatech*@asalifecare.com, asatechjk@gmail.com, silvajhonatanbrito@gmail.com"},
  {"key":"staff_guard_shared_emails","group":"guard","value":"info@asalifecare.com, hr@asalifecare.com, admin@asalifecare.com, support@asalifecare.com"},
  {"key":"mywork_hide_header","group":"mywork","value":"no"},
  {"key":"mywork_hide_source_notes","group":"mywork","value":"no"},
  {"key":"mywork_hide_missing_row","group":"mywork","value":"no"},
  {"key":"mywork_hide_completed","group":"mywork","value":"no"},
  {"key":"mywork_hide_inbox_sources","group":"mywork","value":"no"},
  {"key":"mywork_hide_ssa_updated","group":"mywork","value":"yes"},
  {"key":"mywork_hide_ssa_county","group":"mywork","value":"yes"},
  {"key":"mywork_hide_ssa_count","group":"mywork","value":"yes"},
  {"key":"mywork_hide_ssa_role","group":"mywork","value":"yes"},
  {"key":"mywork_hide_sched_hours","group":"mywork","value":"yes"},
  {"key":"mywork_hide_record_notes","group":"mywork","value":"yes"},
  {"key":"mywork_hide_apps","group":"mywork","value":""},
  {"key":"mywork_hide_apps_seen","group":"mywork","value":""},
  {"key":"mywork_hide_world","group":"mywork","value":"no"},
  {"key":"mywork_hide_world_seen","group":"mywork","value":""},
  {"key":"mywork_hide_myasa","group":"mywork","value":"no"},
  {"key":"mywork_hide_myasa_seen","group":"mywork","value":""},
  {"key":"mywork_appcontrol_delegates","group":"mywork","value":""},
  {"key":"mywork_editions","group":"mywork","value":""},
  {"key":"mywork_auto_sr_late_show","group":"mywork","value":"no"},
  {"key":"mywork_auto_sr_no_call_no_show","group":"mywork","value":"no"},
  {"key":"mywork_auto_sr_punch_missing","group":"mywork","value":"no"},
  {"key":"mywork_auto_sr_incident","group":"mywork","value":"no"},
  {"key":"mywork_auto_sr_general_requests","group":"mywork","value":"no"},
  {"key":"mywork_auto_sr_vehicle","group":"mywork","value":"no"},
  {"key":"mywork_auto_sr_payroll","group":"mywork","value":"no"},
  {"key":"mywork_auto_sr_adp_update","group":"mywork","value":"no"},
  {"key":"mywork_auto_sr_time_off","group":"mywork","value":"no"}
];
