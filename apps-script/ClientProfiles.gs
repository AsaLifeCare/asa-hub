// Clients: one client at a time.
// The reads, here and in the ClientSource*.gs doors (Appointments, Transportation, Administration, Refills, Client…

var CP_ACTIONS = ['clientProfileRoster', 'clientProfileDetails', 'clientProfileCare', 'clientProfileMeds',
                  'clientProfileIncidents', 'clientProfileActivity',
                  'clientProfileDocFile', 'clientProfileSave', 'clientProfileIncidentStatus',
                  'clientProfileApptSave', 'clientProfileIspSections', 'clientProfileRename', 'clientProfileStatus',
                  'clientProfileOverride'];
var CP_SECTIONS_TAB = 'isp_sections';
// The Hub's own corrections to the plan's family members and care rows; the plan sweep never writes this tab.
var CP_OVERRIDES_TAB = 'client_overrides';
var CP_OVERRIDES_HEADER = ['id', 'client_key', 'kind', 'tab', 'target', 'record', 'text', 'name', 'relationship',
                           'phone', 'email', 'state', 'by', 'at'];
var CP_OVERRIDE_FIELDS = { care: ['record', 'text', 'removed'], family: ['name', 'relationship', 'phone', 'email', 'removed'] };
var CP_OVERRIDE_TABS = ['daily', 'health', 'goals', 'home'];
var CP_SECTIONS_HEADER = ['id', 'client_key', 'isp_year', 'section', 'record', 'text', 'source_file', 'loaded_at'];
var CP_REVIEWS_TAB = 'incident_reviews';
var CP_REVIEWS_HEADER = ['id', 'client_key', 'client_name', 'incident_ts', 'status', 'by', 'at'];
var CP_INCIDENT_STATUSES = ['Reported', 'Under review', 'Closed'];
var CP_CARE_TABS = ['plans', 'team', 'daily', 'health', 'goals', 'home'];
var CP_MEDS_TABS = ['meds'];
var CP_CLIENT_DB_PROP = 'HUB_CLIENT_DB_SHEET_ID';
var CP_CLIENT_DB_FALLBACK = '1fTi78ztKDiK3hvYLbI2IQ1TeSrzVLceK5LyXJ4BVPe8';
var CP_MASTER_TAB = 'Master';
var CP_ARCHIVE_TAB = 'Archive - Old Clients';
var CP_MASTER_DATA_PROP = 'EMP360_MASTER_DATA_ID';
var CP_MASTER_DATA_TAB = 'Client - Database';
var CP_SECTION_MAX = 30000;
var CP_ROW_CAP = 600;
// The digest pass files a few plans with no sections; each decode is a relay round trip of tens of seconds.
var CP_ISP_SWEEP_PER_PASS = 2;
var CP_ISP_SWEEP_FLOOR_MS = 60000;
// A plan the sweep could not file waits an hour, doubled per failure up to a day.
var CP_ISP_SWEEP_WAIT_MS = 60 * 60 * 1000;
var CP_ISP_SWEEP_WAIT_CAP_MS = 24 * 60 * 60 * 1000;
var CP_ISP_SWEEP_TRIES_PROP = 'ISP_SECTIONS_TRIES';

// Routines are cut from the plan's own sentences; a routine the plan does not write gets no row.
var CP_ROUTINES = [
  { section: 'morning', label: 'Morning', re: /\bmornings?\b/i },
  { section: 'afternoon', label: 'Afternoon', re: /\bafternoons?\b/i },
  { section: 'evening', label: 'Evening', re: /\bevenings?\b/i },
  { section: 'bedtime', label: 'Bedtime', re: /\bbed\s?time\b|\b(goes|going|go) to bed\b/i },
  { section: 'overnight', label: 'Overnight', re: /\bovernights?\b|\bthrough the night\b/i },
  { section: 'meals', label: 'Meals', re: /\b(breakfast|lunch|dinner|supper)\b/i },
  { section: 'hygiene', label: 'Hygiene', re: /\b(showers?|showering|baths?|bathing|hygiene)\b/i },
  { section: 'sleep', label: 'Sleep', re: /\bsleep(s|ing)?\b|\bslept\b/i },
  { section: 'wake', label: 'Waking up', re: /\b(wakes?|waking|woke)\b|\bwake-?up\b/i }
];

// Other sections: a start heading and, for services, every block the plan repeats.
var CP_PLAN_SECTIONS = [
  { section: 'important_people', label: 'Important people', start: /(^|\n)[ \t]*Important People\b/i, keepHead: true },
  { section: 'services', label: 'Paid supports', start: /(^|\n)[ \t]*(Paid Supports|Funding Source)\s*:/i, many: true },
  { section: 'home_needs', label: 'Community living', start: /(^|\n)[ \t]*Community Living\b[^\n]*/i },
  { section: 'equipment', label: 'Equipment', start: /(^|\n)[ \t]*Assistive\/adaptive equipment used\b[^\n]*/i },
  { section: 'outcomes', label: 'Outcomes & experiences', start: /(^|\n)[ \t]*Outcomes\s*(?:and|&)?\s*Experiences\b[^\n]*/i },
  { section: 'great_things', label: 'Great things about me', start: /(^|\n)[ \t]*Great Things About\b[^\n]*/i },
  { section: 'team', label: 'All team members', start: /(^|\n)[ \t]*All Team Members\b[^\n]*/i, tail: true }
];

// Any of these at the start of a line ends a section (the decoder's own stop list).
var CP_STOP_LABELS = ['Important To\\b', 'Important For\\b', 'Need to Know to Support', 'Great Things About',
  'Contact Information', 'Assessment Area', 'Discovery Assessment', 'Healthy Living', 'Nutrition\\b',
  'Communication\\b', 'Advocacy', 'Safety\\s*&\\s*Security', 'Social\\s*&\\s*Spirituality', 'Daily Life',
  'School and Education', 'Community Living', 'Skills and Abilities', 'Getting Around', 'Supervision Considerations',
  'Known and Likely Risks', 'Outcomes', 'Services and Supports', 'Informed Consent', 'Team Signatures',
  'Scope of Service', 'Who is Responsible', 'Support Planning', 'What does a healthy lifestyle', 'Does the person\\b',
  'What kinds of food', 'What physical', 'Has the person been to the hospital', 'Do they require',
  'Assistive/adaptive equipment used', 'Date of Birth', 'Important People', 'Paid Supports\\s*:',
  'Funding Source\\s*:', 'All Team Members'];

// The plan's flat fields per Care & Support tab.
var CP_CARE_FIELDS = {
  daily: [['personal_care', 'Personal care'], ['mobility', 'Mobility'], ['diet_nutrition', 'Diet & nutrition'],
          ['communication', 'Communication']],
  health: [['diagnoses', 'Diagnoses'], ['allergies', 'Allergies'], ['medications', 'Medications in the plan'],
           ['medical_summary', 'Medical summary'], ['safety_risks', 'Safety & risks'], ['behaviors', 'Behavior support'],
           ['supervision_level', 'Supervision']],
  goals: [['goals_outcomes', 'Goals & outcomes'], ['important_to', 'Important to'], ['important_for', 'Important for']],
  home: [],
  team: [],
  plans: []
};
var CP_CARE_SECTIONS = {
  daily: [], health: ['equipment'], goals: ['outcomes', 'great_things'], home: ['home_needs', 'services'],
  team: ['team'], plans: []
};

// The Hub `clients` columns the profile pencil may write; an alias maps a profile name to its column.
var CP_SAVE_FIELDS = ['dob', 'house', 'home_address', 'client_number', 'initials', 'medicaid_id',
  'house_manager', 'house_manager_phone', 'house_manager_email',
  'guardianName', 'guardian_relationship', 'guardian_email', 'guardian_phone', 'guardian_address',
  'ssa_name', 'ssa_email', 'ssa_phone',
  'outcome', 'ama_date', 'start_date', 'isp_signed_date', 'self_admin_assessment', 'self_admin_expires',
  'media_release', 'medical_supply', 'truelink_consent', 'guardianship_papers',
  'workshop', 'workshop_phone', 'workshop_address', 'transportation', 'transportation_phone',
  'payee_rep', 'payee_rep_phone', 'payee_rep_email', 'food_stamp', 'spending_limit'];
var CP_SAVE_ALIASES = { guardian_name: 'guardianName' };
var CP_NEVER_WRITTEN = /ssn|social|tlcard|debitcard|cardnumber|cardlast|^dc|pin|securitycode|cvv|ccv/;
// A save column and the other Hub columns that carry the same value: read in this order, cleared together.
var CP_FIELD_NAMES = { house: ['house', 'houseName'], guardianName: ['guardianName', 'guardian_name'] };
// The save columns also written to the Asa Client Database Master row, so the books that read it (Locations) agree.
var CP_MASTER_WRITE_THROUGH = ['house'];
var CP_EDIT_PROTECTED = 'Protected: never written from the Hub.';
var CP_EDIT_LOCKED = {
  name: 'The name joins the client\'s Master, plan and Hub rows, so a rename files through its own door.',
  status: 'Moving a client between the Master and the archive of old clients files through its own door.'
};
// The Hub tabs that join a client by key or name, re-keyed by a rename: key columns by the exact key, name columns…
var CP_REKEY_TABS = [
  { tab: 'clients', key: ['client_key'], name: ['name'] },
  { tab: 'isps', key: ['client_key'], name: ['client_name'] },
  { tab: 'client_files', key: ['client_key'], name: ['client_name'] },
  { tab: 'client_notes', key: ['client_key'], name: ['client_name'] },
  { tab: 'isp_contacts', key: ['client_key'], name: ['client_name'] },
  { tab: 'isp_sections', key: ['client_key'], ids: ['id'] },
  { tab: 'incident_reviews', key: ['client_key'], name: ['client_name'], ids: ['id'] },
  { tab: 'client_overrides', key: ['client_key'], ids: ['target'] },
  { tab: 'house_notes', key: ['client_key'] },
  { tab: 'family_notes', key: ['client_key'] },
  { tab: 'vc_trips', key: ['client_key'], name: ['client_name'] },
  { tab: 'tasks', key: ['client_key'], name: ['client_name'] },
  { tab: 'users', key: ['client_key'] },
  { tab: 'photos', name: ['title'], where: { kind: 'avatar' } }
];
// What a rename cannot reach: the systems and forms that file new rows under the names they hold.
var CP_RENAME_ELSEWHERE = 'PsiAnywhere, DODD\'s billing reports and the forms that feed these books keep the names they hold until ' +
                          'they are changed there.';

// The appointment pencil: the Dr Appt Archive columns, and the ApptRow names that stand for them.
var CP_APPT_FIELDS = { dr_name: 'dr_name', appointment_date: 'appointment_date', date: 'appointment_date',
  appointment_start_time: 'appointment_start_time', time: 'appointment_start_time',
  appointment_address: 'appointment_address', dr_address: 'appointment_address',
  wheelchair_van_required: 'wheelchair_van_required', van: 'wheelchair_van_required', upcoming: 'upcoming' };

// Master and archive headers (folded: lowercase, '#' as 'no', nothing else) → profile field or masked cell.
var CP_BOOK_FIELDS = {
  client: 'name', customer: 'name', ama: 'ama_date', isp: 'isp_signed_date', ssa: 'ssa_name', ssano: 'ssa_phone',
  ssaemail: 'ssa_email', house: 'house', status: 'status', address: 'home_address', outcome: 'outcome',
  clientno: 'client_number', guardian: 'guardian_name', initials: 'initials', workshop: 'workshop',
  birthdate: 'dob', payeerep: 'payee_rep', foodstamp: 'food_stamp', guardianno: 'guardian_phone',
  medicaidno: 'medicaid_id', startdate: 'start_date', payeerepno: 'payee_rep_phone', housemanager: 'house_manager',
  mediarelease: 'media_release', guardianemail: 'guardian_email', medicalsupply: 'medical_supply',
  spendinglimit: 'spending_limit', transportation: 'transportation', workshopphone: 'workshop_phone',
  housemanagerno: 'house_manager_phone', payeerepemail: 'payee_rep_email', guardianaddress: 'guardian_address',
  workshopaddress: 'workshop_address', housemanageremail: 'house_manager_email',
  guardianshippapers: 'guardianship_papers', guardianrelationship: 'guardian_relationship',
  selfadminassessment: 'self_admin_assessment', transportationphone: 'transportation_phone',
  truelinkconsentform: 'truelink_consent', selfadminexpirationdate: 'self_admin_expires'
};
var CP_BOOK_MASKED = { ssn: 'ssn', tldebitcardnumber: 'tl_card', dcexpdate: 'dc_exp',
                       dcsecuritycode: 'dc_security_code', dcpinno: 'dc_pin' };
var CP_BOOK_DATES = ['dob', 'ama_date', 'start_date', 'self_admin_expires', 'isp_signed_date'];
var CP_BOOK_PHONES = ['ssa_phone', 'guardian_phone', 'payee_rep_phone', 'house_manager_phone',
                      'workshop_phone', 'transportation_phone'];

/** FAIL-CLOSED: the writes' gate — the master in its own session, never a visit or a service call. */
function clientProfilesGate_(user) {
  try { return !!hubIsRealMaster_(user); } catch (e) { return false; }
}

var CP_APP_ID = 'client-profiles';
var CP_SCOPED = ['client', 'guardian', 'ssa'];
// The activity kinds that are the staff's and the office's notes, never a client's or a family's to read.
var CP_NOTE_KINDS = ['daily_note', 'client_note', 'house_note'];
var CP_NOTE_COUNTS = ['daily_notes', 'client_notes', 'house_notes'];

// FAIL-CLOSED: who reads Clients, and which clients: { kind, keys }.
function clientProfilesReader_(user) {
  try {
    if (!user || user.is_service) return null;
    if (typeof HUB_IS_SERVICE_REQ !== 'undefined' && HUB_IS_SERVICE_REQ) return null;
    if (hubIsRealMaster_(user)) return { kind: 'master', keys: null };
    var gate = hubProfileAppGate_(CP_APP_ID, user);
    var scope = gate && gate.open === true ? gate.scope : null;
    if (!scope) return null;
    if (scope.kind === 'all') return { kind: 'all', keys: null };
    if (CP_SCOPED.indexOf(scope.kind) === -1) return null;
    var keys = {}, n = 0;
    (scope.client_keys || []).forEach(function (k) {
      var key = String(k == null ? '' : k).trim();
      if (key && !keys[key]) { keys[key] = true; n++; }
    });
    return n ? { kind: scope.kind, keys: keys } : null;
  } catch (e) { return null; }
}

/** The reader for one client; null when the app is shut to them or the client is outside their scope. */
function clientProfilesReaderFor_(user, client) {
  var reader = clientProfilesReader_(user);
  if (!reader || !reader.keys) return reader;
  return reader.keys[String(client == null ? '' : client).trim()] === true ? reader : null;
}

/** A client or a family member: their own record, without the staff's notes or the office's management. */
function clientProfilesOwnOnly_(reader) {
  return !!reader && (reader.kind === 'client' || reader.kind === 'guardian');
}

function clientProfilesUnknown_() {
  return { status: 404, message: 'Unknown action.' };
}

function cpWhy_(what, e) {
  return what + ' could not be read (' + String((e && e.message) || e).slice(0, 120) + ')';
}

function cpVerbatim_(v, max) {
  var s = String(v == null ? '' : v).replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
  return max ? s.slice(0, max) : s;
}

/** The first line of a passage, bullets off, for a table's DETAILS cell. */
function cpGist_(v) {
  var lines = cpVerbatim_(v).split('\n');
  for (var i = 0; i < lines.length; i++) {
    var s = lines[i].replace(/^[\s•●◦▪*\-–]+/, '').trim();
    if (s) return s.length > 160 ? s.slice(0, 157) + '…' : s;
  }
  return '';
}

/** A day as yyyy-MM-dd, or ''. */
function cpDay_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, 'America/New_York', 'yyyy-MM-dd');
  var s = String(v == null ? '' : v).trim();
  return s ? apptDay_(s) : '';
}

function cpPhone_(v) {
  var s = String(v == null ? '' : v).trim();
  return s ? ispPhone_(s) : '';
}

function cpNum_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v).replace(/[,$\s]/g, '');
  if (/^\(\d+(\.\d+)?\)$/.test(s)) s = '-' + s.slice(1, -1);
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

function cpAge_(dob, today) {
  var b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob || ''));
  var t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ''));
  if (!b || !t) return null;
  var age = Number(t[1]) - Number(b[1]) - ((t[2] + t[3]) < (b[2] + b[3]) ? 1 : 0);
  return age >= 0 && age < 130 ? age : null;
}

function cpInitials_(name) {
  return String(name || '').split(/\s+/).filter(String).map(function (w) { return w.charAt(0).toUpperCase(); })
    .join('').slice(0, 3);
}

function cpStatuses_(rows) {
  var seen = {}, out = [];
  (rows || []).forEach(function (r) {
    var s = String((r && r.status) || '');
    if (s && !seen[s]) { seen[s] = true; out.push(s); }
  });
  return out;
}

// The only way an SSN, a card number or a DC cell reaches an answer: last four of an SSN (whole, or already cut to…
function clientProfileMask_(raw) {
  var r = raw || {};
  var digits = function (v) { return String(v == null ? '' : v).replace(/\D/g, ''); };
  var present = function (v) {
    var s = String(v == null ? '' : v).replace(/[\s\-–—.\/]+/g, '');
    return !!s && !/^(na|none|no|null|0+)$/i.test(s);
  };
  var ssn = digits(r.ssn);
  var card = digits(r.tl_card);
  return {
    ssn_last4: ssn.length === 9 || ssn.length === 4 ? ssn.slice(-4) : null,
    ssn_on_file: ssn.length >= 4,
    tl_card_last4: (card.length >= 12 && card.length <= 19) || card.length === 4 ? card.slice(-4) : null,
    dc_exp_on_file: present(r.dc_exp),
    dc_security_code_on_file: present(r.dc_security_code),
    dc_pin_on_file: present(r.dc_pin)
  };
}

var CP_SCRUB_KEYS = { id: true, file_id: true, isp_file_id: true, receipt_file_id: true, drive_id: true,
                      person_id: true, ssa_person_id: true, witness: true };

/** Last guard on every answer: a bare 9-digit or 13-19-digit run, or an SSN shape, never leaves. */
function cpScrub_(v, key) {
  if (key && CP_SCRUB_KEYS[key]) return v;
  if (typeof v === 'string') {
    return v.replace(/(^|\D)\d{3}-\d{2}-\d{4}(?=\D|$)/g, '$1[withheld]')
            .replace(/(^|\D)(\d{9}|\d{13,19})(?=\D|$)/g, '$1[withheld]');
  }
  if (typeof v === 'number') {
    var len = String(Math.abs(Math.round(v))).length;
    return (len === 9 || (len >= 13 && len <= 19)) && Math.round(v) === v ? null : v;
  }
  if (Array.isArray(v)) return v.map(function (x) { return cpScrub_(x); });
  if (v && typeof v === 'object') {
    var out = {};
    Object.keys(v).forEach(function (k) { out[k] = cpScrub_(v[k], k); });
    return out;
  }
  return v;
}

function cpAnswer_(data) {
  return { status: 200, data: cpScrub_(data) };
}

// ---- the books -----------------------------------------------------------

function cpFold_(header) {
  return String(header == null ? '' : header).toLowerCase().replace(/#/g, 'no').replace(/[^a-z0-9]+/g, '');
}

// A client book's rows as { key → { name, fields, mask } }: only the mapped columns, dates as days, phones…
function cpBookIndexFrom_(values, tz) {
  var index = { rows: {}, order: [] };
  if (!values || values.length < 2) return index;
  var head = values[0].map(cpFold_);
  for (var r = 1; r < values.length; r++) {
    var line = values[r] || [];
    var fields = {}, raw = {};
    for (var c = 0; c < head.length; c++) {
      var v = line[c];
      if (v === '' || v === null || v === undefined) continue;
      if (CP_BOOK_MASKED[head[c]]) { raw[CP_BOOK_MASKED[head[c]]] = v; continue; }
      var f = CP_BOOK_FIELDS[head[c]];
      if (!f || fields[f]) continue;
      if (v instanceof Date) v = isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz || 'America/New_York', 'yyyy-MM-dd');
      var s = locationsText_(v, 500);
      if (CP_BOOK_DATES.indexOf(f) !== -1) s = cpDay_(s) || s;
      if (CP_BOOK_PHONES.indexOf(f) !== -1) s = cpPhone_(s);
      if (s) fields[f] = s;
    }
    var mask = clientProfileMask_(raw);
    raw = null;
    var key = clientNameKey_(fields.name);
    if (!key) continue;
    if (index.rows[key]) { index.rows[key] = { name: fields.name, key: key, ambiguous: true, fields: {}, mask: clientProfileMask_({}) }; continue; }
    index.rows[key] = { name: fields.name, key: key, ambiguous: false, fields: fields, mask: mask };
    index.order.push(key);
  }
  return index;
}

/** One client book tab, masked, cached by its sheet. Throws when the book cannot be read. */
function cpBookIndex_(id, tab) {
  return cacheRead_(cacheScopeSheet_(id, tab), 'cp_book_v1', function () {
    var ss = ssOpen_(id);
    var sheet = ss.getSheetByName(tab);
    if (!sheet) throw new Error('the book has no ' + tab + ' tab');
    return cpBookIndexFrom_(sheet.getDataRange().getValues(), ss.getSpreadsheetTimeZone());
  });
}

function cpClientDbId_() {
  return locationsBookId_(CP_CLIENT_DB_PROP, CP_CLIENT_DB_FALLBACK);
}

function cpMasterIndex_() { return cpBookIndex_(cpClientDbId_(), CP_MASTER_TAB); }
function cpArchiveIndex_() { return cpBookIndex_(cpClientDbId_(), CP_ARCHIVE_TAB); }
function cpMasterDataIndex_() {
  var id = String(hubId_(CP_MASTER_DATA_PROP) || '');
  if (!id) throw new Error(CP_MASTER_DATA_PROP + ' is not set');
  return cpBookIndex_(id, CP_MASTER_DATA_TAB);
}

// ---- the client ----------------------------------------------------------

/** The client a request names: clientsDerived_ by exact client_key, else the archive of old clients by its key. */
function clientProfilesClient_(raw) {
  var key = String(raw == null ? '' : raw).trim();
  if (!key || !/^[A-Za-z0-9_.\-]{1,120}$/.test(key)) {
    return { refused: { status: 400, message: 'client: the client key the roster gives.' } };
  }
  var all;
  try { all = clientsDerived_(null); }
  catch (e) { return { refused: { status: 503, message: 'The clients could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' } }; }
  var row = null;
  all.forEach(function (c) {
    var k = String(c.client_key || '').trim() || clientNameKey_(c.name);
    if (!row && k === key) row = c;
  });
  if (row) {
    return { key: key, name: locationsText_(row.name), row: row, archived: false, all: all };
  }
  var arch = null;
  try { arch = cpArchiveIndex_(); }
  catch (eA) { return { refused: { status: 503, message: 'The clients archive could not be read just now (' + String((eA && eA.message) || eA).slice(0, 120) + ').' } }; }
  var hit = arch.rows[key];
  if (hit && !hit.ambiguous) {
    var fields = {};
    Object.keys(hit.fields).forEach(function (k2) { fields[k2] = hit.fields[k2]; });
    fields.client_key = key;
    fields.status = 'inactive';
    return { key: key, name: hit.name, row: fields, archived: true, archive_mask: hit.mask, all: all };
  }
  return { refused: { status: 404, message: 'No client "' + key + '" is on file.' } };
}

function cpRosterRow_(c, photos) {
  var name = locationsText_(c.name);
  return {
    client_key: String(c.client_key || '').trim() || clientNameKey_(name), client_id: String(c.id || ''), name: name,
    status: clientLive_(c) ? 'active' : 'inactive', house: locationsText_(c.house || c.houseName),
    avatar: String(c.avatar || (photos && photos[clientNameKey_(name)]) || ''), isp_year: locationsText_(c.isp_year)
  };
}

function cpIspRow_(key) {
  var hit = null;
  listRows_('isps', {}).forEach(function (r) { if (!hit && String(r.client_key || '').trim() === key) hit = r; });
  return hit;
}

/** Keyed cp_<action>_<client_key>; the name carries the tab and the versions of what it reads. A degraded answer is never kept. */
function clientProfilesCached_(action, key, part, depScopes, producer) {
  var scope = 'cp_' + action + '_' + key;
  var name = 'v1_' + String(part || 'all');
  (depScopes || []).forEach(function (s) {
    try { name += '_' + cacheVersion_(s); } catch (e) { name += '_x'; }
  });
  var value = cacheRead_(scope, name, function () { return cpScrub_(producer()); });
  if (value && value.degraded) cacheBump_(scope);
  return value;
}

function cpBump_(key, actions) {
  (actions || []).forEach(function (a) { cacheBump_('cp_' + a + '_' + key); });
}

function cpEstateScope_(resource) {
  try { return locationsEstateScope_(resource); } catch (e) { return ''; }
}

function cpTabScope_(tab) {
  try { return cacheScope_(tab); } catch (e) { return tab; }
}

/** A Hub tab of ours (never a RESOURCE) as rows; [] while it has not been made. */
function cpOwnRows_(tab) {
  var sheet = hubTabSheet_(tab);
  return sheet ? locationsTabRows_(sheet) : [];
}

// FAIL-CLOSED: a tab of ours is created only while SheetDb.gs declares it born in the Care book; without that…
function cpTabHomed_(tab) {
  try {
    return HUB_TAB_HOME[tab] === 'HUB_CARE_BOOK_ID' && HUB_TAB_BORN_HOME.indexOf(tab) !== -1;
  } catch (e) { return false; }
}

function cpTabUnhomed_(tab) {
  return { status: 503, message: 'The ' + tab + ' store has no home in the Care book in this deployment, so nothing was filed.' };
}

function cpPeopleIndex_() {
  var byId = {}, byKey = {};
  listRows_('people', {}).forEach(function (p) {
    var id = String(p.id || '');
    if (id) byId[id] = p;
    var k = clientNameKey_(p.name);
    if (k) (byKey[k] = byKey[k] || []).push(p);
  });
  return { byId: byId, byKey: byKey };
}

function cpPersonId_(people, name, preferId) {
  if (!people) return '';
  if (preferId && people.byId[preferId]) return preferId;
  var hits = people.byKey[clientNameKey_(name)] || [];
  return hits.length === 1 ? String(hits[0].id || '') : '';
}

// ---- the plan's sections -------------------------------------------------

/** The plan text without its page furniture, as lines. */
function cpPlanLines_(raw) {
  return String(raw || '').replace(/\r/g, '').replace(/HCBS -/g, '').split('\n').map(function (l) { return l.trim(); })
    .filter(function (s) {
      if (!s) return false;
      if (/^OhioISP\s*-\s/i.test(s) || /^Page\s+\d+(\s+of\s+\d+)?$/i.test(s)) return false;
      if (/^ISP Span Dates\s*:/i.test(s) || /^Effective Date\s*:/i.test(s)) return false;
      if (/^Last revised\b/i.test(s) || /^HCBS\b/i.test(s) || /^\d{1,3}$/.test(s)) return false;
      return true;
    });
}

var CP_STOP_RE_ = null;
function cpStopRe_() {
  if (!CP_STOP_RE_) CP_STOP_RE_ = new RegExp('(^|\\n)[ \\t]*(?:' + CP_STOP_LABELS.join('|') + ')', 'i');
  return CP_STOP_RE_;
}

/** Every block a start heading opens, up to the next section heading; empty blocks are skipped. */
function cpBlocks_(text, spec) {
  var out = [];
  var re = new RegExp(spec.start.source, 'gi');
  var m;
  while ((m = re.exec(text)) !== null) {
    var headAt = m.index + (m[1] ? m[1].length : 0);
    var from = spec.keepHead ? headAt : m.index + m[0].length;
    var rest = text.slice(from);
    var skip = spec.keepHead ? (m[0].length - (m[1] ? m[1].length : 0)) : 0;
    var body = rest;
    if (!spec.tail) {
      var after = rest.slice(skip);
      var stop = after.search(cpStopRe_());
      if (stop !== -1) body = rest.slice(0, skip + stop);
    }
    body = cpVerbatim_(body.replace(/^\s*:?\s*/, ''), CP_SECTION_MAX);
    var content = spec.keepHead ? body.replace(spec.start, '').trim() : body;
    if (content.length >= 3) out.push(body);
    if (!spec.many && out.length) break;
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/** The plan's sentences, a heading line never glued to the prose after it, questions dropped. */
function cpSentences_(lines) {
  var heading = new RegExp('^(?:' + CP_STOP_LABELS.join('|') + ')', 'i');
  var segments = [], cur = [];
  lines.forEach(function (ln) {
    if (heading.test(ln)) { if (cur.length) segments.push(cur); cur = []; return; }
    if (/^[•●◦▪*\-–]\s*/.test(ln) && cur.length) { segments.push(cur); cur = []; }
    cur.push(ln.replace(/^[•●◦▪*\-–]\s*/, ''));
  });
  if (cur.length) segments.push(cur);
  var out = [];
  segments.forEach(function (seg) {
    var text = seg.join(' ').replace(/\s+/g, ' ').trim();
    (text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) || []).forEach(function (s) {
      var t = s.trim();
      if (t.length < 8 || /\?["')\]]*$/.test(t)) return;
      out.push(t);
    });
  });
  return out;
}

/** Raw plan text → verbatim section rows; a section or routine the plan does not carry is listed in absent. */
function clientProfileIspCut_(raw) {
  var lines = cpPlanLines_(raw);
  var text = lines.join('\n');
  var rows = [], absent = [];
  var sentences = cpSentences_(lines);
  CP_ROUTINES.forEach(function (rt) {
    var seen = {}, hits = [];
    sentences.forEach(function (s) {
      if (rt.re.test(s) && !seen[s]) { seen[s] = true; hits.push(s); }
    });
    if (hits.length) rows.push({ section: rt.section, record: rt.label, text: hits.join('\n').slice(0, CP_SECTION_MAX) });
    else absent.push(rt.section);
  });
  CP_PLAN_SECTIONS.forEach(function (spec) {
    var blocks = cpBlocks_(text, spec);
    if (!blocks.length) { absent.push(spec.section); return; }
    blocks.forEach(function (b) {
      var record = spec.label;
      if (spec.section === 'services') {
        var first = cpGist_(b.replace(/^(Paid Supports|Funding Source)\s*:\s*/i, ''));
        if (first) record = first.slice(0, 80);
      }
      rows.push({ section: spec.section, record: record, text: b });
    });
  });
  return { rows: rows, absent: absent };
}

function cpSectionsSheet_(create) {
  return create ? hubTabEnsure_(CP_SECTIONS_TAB, CP_SECTIONS_HEADER) : hubTabSheet_(CP_SECTIONS_TAB);
}

// Replace one client's rows in isp_sections: the tab is rewritten in place (kept rows, then the new ones, then…
function cpSectionsWrite_(key, ispYear, sourceFile, cut) {
  if (!cpTabHomed_(CP_SECTIONS_TAB)) return cpTabUnhomed_(CP_SECTIONS_TAB);
  var held = sheetDbGateHolds_(CP_SECTIONS_TAB, 'update');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return { status: 409, message: 'Another write is in progress — try again in a moment.' };
  try {
    var sheet;
    try { sheet = cpSectionsSheet_(true); }
    catch (eS) { return { status: 503, message: 'The isp_sections store is not set up (' + String((eS && eS.message) || eS).slice(0, 120) + ').' }; }
    var head = ensureHeader_(sheet, CP_SECTIONS_HEADER);
    var values = sheet.getDataRange().getValues();
    var width = head.length;
    var iKey = head.indexOf('client_key');
    var kept = [];
    for (var r = 1; r < values.length; r++) {
      var line = values[r] || [];
      var empty = line.every(function (c) { return c === '' || c === null; });
      if (empty || String(line[iKey] || '').trim() === key) continue;
      var copy = [];
      for (var c = 0; c < width; c++) copy.push(hubCellSafe_(line[c] === undefined || line[c] === null ? '' : line[c]));
      kept.push(copy);
    }
    var now = new Date().toISOString();
    var count = {};
    var fresh = cut.rows.map(function (row) {
      count[row.section] = (count[row.section] || 0) + 1;
      var rec = { id: 'IS_' + key + '_' + row.section + (count[row.section] > 1 ? '_' + count[row.section] : ''),
                  client_key: key, isp_year: ispYear, section: row.section, record: row.record,
                  text: row.text, source_file: sourceFile, loaded_at: now };
      return head.map(function (h) { return hubCellSafe_(rec[h] === undefined || rec[h] === null ? '' : String(rec[h])); });
    });
    var grid = kept.concat(fresh);
    var total = Math.max(grid.length, values.length - 1);
    while (grid.length < total) {
      var blank = [];
      for (var b = 0; b < width; b++) blank.push('');
      grid.push(blank);
    }
    if (grid.length) sheet.getRange(2, 1, grid.length, width).setValues(grid);
  } finally { lock.releaseLock(); }
  cacheBump_(cpTabScope_(CP_SECTIONS_TAB));
  cpBump_(key, ['clientProfileCare', 'clientProfileDetails']);
  return null;
}

/** Cut a plan's text into isp_sections for one client (the intake calls this for every new plan). */
function clientProfileIspSectionsFrom_(key, ispYear, raw, sourceFile) {
  return cpSectionsFileCut_(key, ispYear, sourceFile, clientProfileIspCut_(raw));
}

/** File an already cut plan for one client. Answers { rows, sections, absent } or { refused }. */
function cpSectionsFileCut_(key, ispYear, sourceFile, cut) {
  var k = String(key || '').trim();
  if (!k) return { refused: { status: 400, message: 'client_key: which client the plan is about.' } };
  var refused = cpSectionsWrite_(k, String(ispYear || ''), String(sourceFile || ''), cut);
  if (refused) return { refused: refused };
  return { rows: cut.rows.length, sections: cut.rows.map(function (r) { return r.section; }), absent: cut.absent };
}

/** The client's filed sections, the current plan year's first. */
function cpSectionsFor_(key) {
  return cpOwnRows_(CP_SECTIONS_TAB).filter(function (r) { return String(r.client_key || '') === key; });
}

// ---- reads ---------------------------------------------------------------

// The switcher: identity only — key, record id, name, status, house, photo, plan year — cut to the reader's own…
HUB_POLICY.clientProfileRoster = {
  file: 'ClientProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { show_inactive: {} }
};
HUB_ACTIONS.clientProfileRoster = function (payload, user) {
  var reader = clientProfilesReader_(user);
  if (!reader) return clientProfilesUnknown_();
  var raw = payload && payload.show_inactive;
  var withInactive = raw === true || /^(true|1|yes|on)$/i.test(String(raw == null ? '' : raw));
  return cpRosterDoor_(withInactive, reader);
};

/** Past the gate — the switcher's answer for this reader, and the relay pack's own part. */
function cpRosterDoor_(withInactive, reader) {
  var data;
  try {
    data = clientProfilesCached_('clientProfileRoster', 'all', withInactive ? 'inactive' : 'active',
      [cpTabScope_('isps'), cpTabScope_('clients'), cpTabScope_('photos')], function () {
        return cpRosterBuild_(withInactive);
      });
  } catch (e) {
    return { status: 503, message: 'The clients could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
  return cpAnswer_(cpRosterFor_(data, reader));
}

/** The roster as this reader sees it: their own clients only when their scope names some, and who they read as. */
function cpRosterFor_(data, reader) {
  var out = {};
  Object.keys(data || {}).forEach(function (k) { out[k] = data[k]; });
  out.clients = ((data && data.clients) || []).filter(function (c) { return !reader.keys || reader.keys[c.client_key] === true; });
  out.viewer = reader.kind;
  return out;
}

function cpRosterBuild_(withInactive) {
  var photos = {};
  try { photos = clientPhotoIndex_(); } catch (eP) { photos = {}; }
  var seen = {};
  var clients = clientsDerived_(null).map(function (c) { return cpRosterRow_(c, photos); }).filter(function (r) {
    if (!r.client_key || seen[r.client_key]) return false;
    seen[r.client_key] = true;
    return withInactive || r.status === 'active';
  });
  var why = '', degraded = false;
  if (withInactive) {
    try {
      var arch = cpArchiveIndex_();
      var names = {};
      clients.forEach(function (r) { names[clientNameKey_(r.name)] = true; });
      arch.order.forEach(function (k) {
        var hit = arch.rows[k];
        if (!hit || hit.ambiguous || seen[k] || names[k]) return;
        seen[k] = true;
        clients.push({ client_key: k, client_id: '', name: hit.name, status: 'inactive', house: hit.fields.house || '',
                       avatar: String(photos[k] || ''), isp_year: '' });
      });
    } catch (eA) { why = cpWhy_('the archive of old clients', eA); degraded = true; }
  }
  clients.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return { clients: clients, inactive_why: why, degraded: degraded };
}

/** Client Profile: the six detail blocks and the family grid; SSN, card, DC and PIN only as clientProfileMask_ leaves them. */
HUB_POLICY.clientProfileDetails = {
  file: 'ClientProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' } }
};
HUB_ACTIONS.clientProfileDetails = function (payload, user) {
  if (!clientProfilesReaderFor_(user, payload && payload.client)) return clientProfilesUnknown_();
  return cpDetailsDoor_(payload);
};

/** Past the gate — the door's answer, and the relay pack's part. */
function cpDetailsDoor_(payload) {
  var ctx = clientProfilesClient_(payload && payload.client);
  if (ctx.refused) return ctx.refused;
  return cpAnswer_(cpDetails_(ctx));
}

function cpDetails_(ctx) {
  return clientProfilesCached_('clientProfileDetails', ctx.key, 'all',
    [cpTabScope_('isps'), cpTabScope_('clients'), cpTabScope_('people'), cpTabScope_(CP_SECTIONS_TAB),
     cpTabScope_(CP_OVERRIDES_TAB)],
    function () { return cpDetailsBuild_(ctx); });
}

/** The client's rows in the Master (or the archive) and Master Data, as the profile and the edit door read them. */
function cpSources_(ctx) {
  var why = [], degraded = false;
  var master = null, tl = null;
  if (ctx.archived) {
    master = { fields: {}, mask: ctx.archive_mask || clientProfileMask_({}) };
  } else {
    try {
      var mi = cpMasterIndex_();
      master = mi.rows[clientNameKey_(ctx.name)] || null;
      if (master && master.ambiguous) { why.push('the Asa Client Database Master has two rows for ' + ctx.name); master = null; }
      else if (!master) {
        // a client set inactive keeps its row in the archive of old clients
        var ai = null;
        try { ai = cpArchiveIndex_().rows[clientNameKey_(ctx.name)] || null; } catch (eA) { ai = null; }
        if (ai && !ai.ambiguous) master = ai;
        else why.push('the Asa Client Database Master has no row for ' + ctx.name);
      }
    } catch (eM) { degraded = true; why.push(cpWhy_('the Asa Client Database', eM)); }
  }
  try {
    var ti = cpMasterDataIndex_();
    tl = ti.rows[clientNameKey_(ctx.name)] || null;
    if (tl && tl.ambiguous) tl = null;
  } catch (eT) { degraded = true; why.push(cpWhy_('Master Data › ' + CP_MASTER_DATA_TAB, eT)); }
  return { mf: (master && master.fields) || {}, tf: (tl && tl.fields) || {},
           mask: (master && master.mask) || clientProfileMask_({}), tmask: (tl && tl.mask) || clientProfileMask_({}),
           why: why, degraded: degraded };
}

/** The Hub row first (its own columns, then the plan's), then the Master, then Master Data; a cleared column stays blank. */
function cpPicker_(c, mf, tf) {
  var cleared = hubEditCleared_(c && c.cleared_fields);
  return function () {
    var names = Array.prototype.slice.call(arguments);
    if (names.some(function (n) { return cleared[n]; })) return '';
    var srcs = [c || {}, mf, tf];
    for (var s = 0; s < srcs.length; s++) {
      for (var n = 0; n < names.length; n++) {
        var v = locationsText_(srcs[s][names[n]], 500);
        if (v) return v;
      }
    }
    return '';
  };
}

/** The edit door's fields: the save columns under the names the panel sends (guardian_name for guardianName). */
function cpEditColumns_() {
  var out = {};
  CP_SAVE_FIELDS.forEach(function (col) { out[col] = col; });
  Object.keys(CP_SAVE_ALIASES).forEach(function (k) { delete out[CP_SAVE_ALIASES[k]]; out[k] = CP_SAVE_ALIASES[k]; });
  return out;
}

/** Each edit field's value as the profile picks it — what the panel opens on and the door witnesses. */
function cpEditRaw_(pick) {
  var cols = cpEditColumns_(), out = {};
  Object.keys(cols).forEach(function (k) { out[k] = pick.apply(null, CP_FIELD_NAMES[cols[k]] || [cols[k]]); });
  return out;
}

function cpDetailsBuild_(ctx) {
  var c = ctx.row || {};
  var src = cpSources_(ctx);
  var why = src.why, degraded = src.degraded;
  var pick = cpPicker_(c, src.mf, src.tf);
  var mask = src.mask, tmask = src.tmask;
  var today = locationsToday_();
  var dob = cpDay_(pick('dob'));
  var house = pick('house', 'houseName');
  var code = locationsHouseCode_(house) || locationsCode_(house);
  var label = house;
  var houses = [];
  try {
    locationsHomes_().forEach(function (h) {
      if (code && h.code === code && h.home_name) label = h.home_name;
      houses.push({ code: h.code, name: h.home_name || h.code });
    });
  } catch (eH) { label = house; }
  var people = null;
  try { people = cpPeopleIndex_(); } catch (eP) { why.push(cpWhy_('the people roster', eP)); }
  var gRaw = pick('guardianName', 'guardian_name');
  var gName = gRaw && guardianIsPerson_(gRaw) ? guardianDisplayName_(gRaw) : gRaw;
  var gId = gName && guardianIsPerson_(gName) ? 'PPL_guardian_' + clientNameKey_(gName) : '';
  var isp = null;
  try { isp = cpIspRow_(ctx.key); } catch (eI) { why.push(cpWhy_('the plans', eI)); }
  var doc = { id: '' };
  try { doc = ispDocFor_(ctx.name); } catch (eD) { doc = { id: '' }; }
  var family = [];
  try { family = cpFamily_(ctx, isp, people); } catch (eF) { why.push(cpWhy_('the plan\'s important people', eF)); }
  var roster = cpRosterRow_(c, null);
  roster.status = ctx.archived ? 'inactive' : roster.status;
  if (!roster.avatar) {
    try { roster.avatar = String(clientPhotoIndex_()[clientNameKey_(ctx.name)] || ''); } catch (eA) { roster.avatar = ''; }
  }
  return {
    client: {
      client_key: ctx.key, name: ctx.name, status: roster.status, house: house, avatar: roster.avatar,
      isp_year: roster.isp_year, client_number: pick('client_number'), initials: pick('initials') || cpInitials_(ctx.name),
      dob: dob, age: cpAge_(dob, today)
    },
    identity: { ssn_last4: mask.ssn_last4, ssn_on_file: mask.ssn_on_file, medicaid_id: pick('medicaid_id') },
    home: { house_code: code, house_label: label, home_address: pick('home_address'),
            house_manager: pick('house_manager'), house_manager_phone: cpPhone_(pick('house_manager_phone')),
            house_manager_email: pick('house_manager_email') },
    guardian: { name: gName, person_id: gId && people && people.byId[gId] ? gId : '',
                relationship: pick('guardian_relationship'), email: pick('guardian_email'),
                address: pick('guardian_address'), phone: cpPhone_(pick('guardian_phone')),
                ssa_name: pick('ssa_name'), ssa_person_id: cpPersonId_(people, pick('ssa_name')),
                ssa_email: pick('ssa_email'), ssa_phone: cpPhone_(pick('ssa_phone')) },
    services: { outcome: pick('outcome'), ama_date: cpDay_(pick('ama_date')) || pick('ama_date'),
                isp_year: roster.isp_year || locationsText_(isp && isp.isp_year), isp_file_id: String(doc.id || ''),
                start_date: cpDay_(pick('start_date')) || pick('start_date'),
                self_admin_assessment: pick('self_admin_assessment'),
                self_admin_expires: cpDay_(pick('self_admin_expires')) || pick('self_admin_expires'),
                media_release: pick('media_release'), medical_supply: pick('medical_supply'),
                truelink_consent: pick('truelink_consent'), guardianship_papers: pick('guardianship_papers') },
    day: { workshop: pick('workshop'), workshop_phone: cpPhone_(pick('workshop_phone')),
           workshop_address: pick('workshop_address'), transportation: pick('transportation'),
           transportation_phone: cpPhone_(pick('transportation_phone')) },
    financial: { payee_rep: pick('payee_rep'), payee_rep_phone: cpPhone_(pick('payee_rep_phone')),
                 payee_rep_email: pick('payee_rep_email'), tl_card_last4: tmask.tl_card_last4 || mask.tl_card_last4,
                 dc_exp_on_file: mask.dc_exp_on_file, dc_security_code_on_file: mask.dc_security_code_on_file,
                 dc_pin_on_file: mask.dc_pin_on_file || tmask.dc_pin_on_file,
                 food_stamp: pick('food_stamp'), spending_limit: pick('spending_limit') },
    family: family,
    edit: cpEditWithKey_(cpEditRaw_(pick), ctx),
    houses: houses,
    degraded: degraded,
    why: why.join('; ')
  };
}

/** The Important People table: the filed section when there is one, else the plan's contact page. */
function cpFamily_(ctx, isp, people) {
  var text = '';
  var year = locationsText_(isp && isp.isp_year);
  cpSectionsFor_(ctx.key).forEach(function (r) {
    if (r.section !== 'important_people') return;
    if (!text || String(r.isp_year) === year) text = String(r.text || '');
  });
  if (!text && isp) text = String(isp.contact_block || '');
  var seen = {};
  var members = ispPeople_(text).filter(function (p) {
    var k = clientNameKey_(p.name);
    if (!k || seen[k] || k === clientNameKey_(ctx.name)) return false;
    seen[k] = true;
    return true;
  }).map(function (p) {
    return { key: clientNameKey_(p.name), name: locationsText_(p.name), relationship: locationsText_(p.role),
             phone: cpPhone_(p.phone), email: locationsText_(p.email) };
  });
  var out = [];
  var mine = cpOverridesFor_(ctx.key, 'family');
  var byTarget = {};
  mine.forEach(function (o) { if (o.target) byTarget[o.target] = o; });
  var put = function (m, o) {
    if (o) {
      if (o.state === 'removed') return;
      m = { key: m.key, name: locationsText_(o.name), relationship: locationsText_(o.relationship),
            phone: cpPhone_(o.phone), email: locationsText_(o.email), edited: true };
      if (!m.name) return;
    }
    m.person_id = cpPersonId_(people, m.name);
    m.edit = { name: m.name, relationship: m.relationship, phone: m.phone, email: m.email, removed: '' };
    out.push(m);
  };
  members.forEach(function (m) { put(m, byTarget[m.key]); });
  mine.forEach(function (o) { if (!o.target) put({ key: String(o.id || '') }, o); });
  return out;
}

/** This client's override rows of one kind ('care' or 'family'), oldest first; [] before the tab is made. */
function cpOverridesFor_(key, kind) {
  return cpOwnRows_(CP_OVERRIDES_TAB).filter(function (r) {
    return String(r.client_key || '') === key && String(r.kind || '') === kind;
  });
}

/** Care & Support: one tab at a time, every row the plan's own words with its plan year's status. */
HUB_POLICY.clientProfileCare = {
  file: 'ClientProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' }, tab: { type: 'string' } }
};
HUB_ACTIONS.clientProfileCare = function (payload, user) {
  if (!clientProfilesReaderFor_(user, payload && payload.client)) return clientProfilesUnknown_();
  return cpCareDoor_(payload);
};

/** Past the gate — the door's answer, and the relay pack's part. */
function cpCareDoor_(payload) {
  var ctx = clientProfilesClient_(payload && payload.client);
  if (ctx.refused) return ctx.refused;
  var tab = locationsText_(payload && payload.tab).toLowerCase() || 'plans';
  if (CP_CARE_TABS.indexOf(tab) === -1) return { status: 400, message: 'tab: one of ' + CP_CARE_TABS.join(', ') + '.' };
  var data;
  try {
    data = clientProfilesCached_('clientProfileCare', ctx.key, tab,
      [cpTabScope_('isps'), cpTabScope_(CP_SECTIONS_TAB), cpTabScope_(CP_OVERRIDES_TAB), cpTabScope_('client_files'), cpTabScope_('clients'),
       cpEstateScope_('drAppointments')], function () { return cpCareBuild_(ctx, tab); });
  } catch (e) {
    return { status: 503, message: 'Care & Support could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
  return cpAnswer_(data);
}

function cpCareBuild_(ctx, tab) {
  var isp = cpIspRow_(ctx.key);
  var year = locationsText_(isp && isp.isp_year);
  var planSource = isp ? 'ISP ' + (year || '') + (isp.source_file ? ' · ' + locationsText_(isp.source_file) : '') : '';
  var planDay = cpDay_(isp && isp.loaded_at);
  var rows = [], absent = [], why = [];
  var sections = cpSectionsFor_(ctx.key);
  // Before the plan is cut into sections nothing is known absent: the why says so instead.
  var filed = sections.length > 0;
  var sectionRow = function (r) {
    var t = cpVerbatim_(r.text, CP_SECTION_MAX);
    return { id: String(r.id || ''), record: locationsText_(r.record), date: cpDay_(r.loaded_at),
             details: cpGist_(t), status: year && String(r.isp_year) === year ? 'Current' : 'Past plan',
             source: 'ISP ' + locationsText_(r.isp_year) + (r.source_file ? ' · ' + locationsText_(r.source_file) : ''),
             text: t };
  };
  if (!isp) why.push('No plan is filed for ' + ctx.name + '.');
  if (isp && !filed && (tab === 'daily' || (CP_CARE_SECTIONS[tab] || []).length)) {
    why.push('The plan has not been read into sections yet — Read the plans files them.');
  }
  if (tab === 'daily') {
    CP_ROUTINES.forEach(function (rt) {
      var mine = sections.filter(function (r) { return r.section === rt.section; });
      var cur = mine.filter(function (r) { return year && String(r.isp_year) === year; });
      (cur.length ? cur : mine).forEach(function (r) { rows.push(sectionRow(r)); });
      if (!cur.length && filed) absent.push(rt.section);
    });
  }
  (CP_CARE_SECTIONS[tab] || []).forEach(function (s) {
    var mine = sections.filter(function (r) { return r.section === s; });
    mine.forEach(function (r) { rows.push(sectionRow(r)); });
    if (!mine.length && filed) absent.push(s);
  });
  (CP_CARE_FIELDS[tab] || []).forEach(function (f) {
    var t = cpVerbatim_(isp && isp[f[0]], CP_SECTION_MAX);
    if (!t) { absent.push(f[0]); return; }
    rows.push({ id: 'isp_' + ctx.key + '_' + f[0], record: f[1], date: planDay, details: cpGist_(t),
                status: 'Current', source: planSource, text: t });
  });
  var out = { tab: tab, rows: rows, statuses: [], absent: absent, why: '' };
  if (tab === 'plans') out.rows = cpPlanDocs_(ctx, isp, planSource, planDay, why);
  if (tab === 'home') {
    var c = ctx.row || {};
    var house = locationsText_(c.house || c.houseName), addr = locationsText_(c.home_address);
    if (house || addr) {
      out.rows.unshift({ id: 'home_' + ctx.key, record: 'Home', date: '', details: [house, addr].filter(String).join(' · '),
                         status: ctx.archived ? 'Past plan' : 'Current', source: 'Client record', text: '' });
    }
  }
  if (tab === 'team') out.people = cpTeam_(ctx, why);
  if (CP_OVERRIDE_TABS.indexOf(tab) !== -1) out.rows = cpCareOverridden_(ctx, tab, out.rows);
  out.statuses = cpStatuses_(out.rows);
  out.why = why.join(' ');
  return out;
}

// The plan's care rows with the Hub's own corrections over them: a row the override names takes its title and text…
function cpCareOverridden_(ctx, tab, rows) {
  var mine = cpOverridesFor_(ctx.key, 'care').filter(function (o) { return String(o.tab || '') === tab; });
  var byTarget = {};
  mine.forEach(function (o) { if (o.target) byTarget[o.target] = o; });
  var edited = function (row, o) {
    var t = cpVerbatim_(o.text, CP_SECTION_MAX);
    return { id: row.id, record: locationsText_(o.record), date: cpDay_(o.at), details: cpGist_(t), status: 'Current',
             source: 'Edited in the Hub', text: t };
  };
  var out = [];
  rows.forEach(function (r) {
    var o = r.id ? byTarget[r.id] : null;
    if (o && o.state === 'removed') return;
    var row = o ? edited(r, o) : r;
    if (!/^home_/.test(String(row.id || ''))) row.edit = { record: row.record, removed: '' };
    out.push(row);
  });
  mine.forEach(function (o) {
    if (o.target || o.state === 'removed' || !locationsText_(o.record)) return;
    var row = edited({ id: String(o.id || '') }, o);
    row.edit = { record: row.record, removed: '' };
    out.push(row);
  });
  return out;
}

/** A client file the Plans list shows: labelled a plan, never an identity paper. */
function cpPlanFile_(r) {
  if (!r || String(r.digest_category || '').trim().toLowerCase() === 'identity' ||
      /ssn|social.?security|identity|licen[cs]e|state_id|birth|passport/i.test(String(r.doc_kind || ''))) return false;
  var label = [r.title, r.folder, r.kind, r.doc_kind, r.subject].map(function (x) { return String(x || ''); }).join(' ');
  return /\bisp\b|service plan|support plan|care plan|behavior(al)? support|self.?admin/i.test(label);
}

/** Care plans: the filed plan, then the client's plan documents with Current / Expired from their expiry. */
function cpPlanDocs_(ctx, isp, planSource, planDay, why) {
  var rows = [];
  var today = locationsToday_();
  if (isp) {
    var doc = { id: '' };
    try { doc = ispDocFor_(ctx.name); } catch (eD) { doc = { id: '' }; }
    rows.push({ id: 'isp_' + ctx.key, record: 'Individual Service Plan ' + locationsText_(isp.isp_year), date: planDay,
                details: locationsText_(isp.source_file) + (isp.page_count ? ' · ' + locationsText_(isp.page_count) + ' pages' : ''),
                status: 'Current', source: planSource, file_id: String(doc.id || '') });
  }
  var nk = clientNameKey_(ctx.name);
  try {
    clientFilesFor_([ctx.key], [nk]).forEach(function (r) {
      if (String(r.client_key || '') !== ctx.key && clientNameKey_(r.client_name) !== nk) return;
      if (!cpPlanFile_(r)) return;
      var exp = cpDay_(r.expires_on);
      rows.push({ id: String(r.id || ''), record: locationsText_(r.title) || locationsText_(r.folder),
                  date: cpDay_(r.issued_on) || cpDay_(r.file_date), details: locationsText_(r.folder) + (exp ? ' · expires ' + exp : ''),
                  status: exp ? (exp < today ? 'Expired' : 'Current') : 'No expiry on file', source: 'Client files',
                  file_id: String(r.drive_id || '') || locationsDriveId_(r.url) });
    });
  } catch (e) { why.push(cpWhy_('The client files', e) + '.'); }
  return rows;
}

/** Care team: the record's people, the plan's important people and the client's doctors, one row a person. */
function cpTeam_(ctx, why) {
  var d = cpDetails_(ctx);
  var people = null;
  try { people = cpPeopleIndex_(); } catch (eP) { people = null; }
  var out = [], seen = {};
  var add = function (name, rel, phone, email, pid, source) {
    var n = locationsText_(name);
    var k = clientNameKey_(n);
    if (!k || !guardianIsPerson_(n)) return;
    if (seen[k] !== undefined) {
      var had = out[seen[k]];
      if (!had.phone && phone) had.phone = cpPhone_(phone);
      if (!had.email && email) had.email = locationsText_(email);
      return;
    }
    var id = pid || cpPersonId_(people, n);
    var p = id && people ? people.byId[id] : null;
    seen[k] = out.length;
    out.push({ name: n, relationship: locationsText_(rel), phone: cpPhone_(phone), email: locationsText_(email),
               avatar: p ? String(p.avatar || '') : '', person_id: id || '', source: source });
  };
  add(d.guardian.name, d.guardian.relationship ? 'Guardian · ' + d.guardian.relationship : 'Guardian',
      d.guardian.phone, d.guardian.email, d.guardian.person_id, 'Client record');
  add(d.guardian.ssa_name, 'SSA', d.guardian.ssa_phone, d.guardian.ssa_email, d.guardian.ssa_person_id, 'Client record');
  add(d.home.house_manager, 'House manager', d.home.house_manager_phone, d.home.house_manager_email, '', 'Client record');
  add(d.financial.payee_rep, 'Payee representative', d.financial.payee_rep_phone, d.financial.payee_rep_email, '', 'Client record');
  d.family.forEach(function (f) { add(f.name, f.relationship, f.phone, f.email, f.person_id, 'ISP ' + (d.services.isp_year || '')); });
  try {
    var nk = clientNameKey_(ctx.name);
    estateRows_('drAppointments').forEach(function (r) {
      if (clientNameKey_(r.client) !== nk) return;
      if (/discontinu|cancel/i.test(String(r.active_or_discontinued || '') + ' ' + String(r.status || ''))) return;
      add(r.dr_name, locationsText_(r.specialist) || 'Doctor', r.phone, '', '', 'Dr Master');
    });
  } catch (e) { why.push(cpWhy_('The doctors (Dr Master)', e) + '.'); }
  return out;
}

/** Medication › Medications: the eMAR list with Active / Discontinued (Administration and Refills read their own apps). */
HUB_POLICY.clientProfileMeds = {
  file: 'ClientProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' }, tab: { type: 'string' } }
};
HUB_ACTIONS.clientProfileMeds = function (payload, user) {
  if (!clientProfilesReaderFor_(user, payload && payload.client)) return clientProfilesUnknown_();
  return cpMedsDoor_(payload);
};

/** Past the gate — the door's answer, and the relay pack's part. */
function cpMedsDoor_(payload) {
  var ctx = clientProfilesClient_(payload && payload.client);
  if (ctx.refused) return ctx.refused;
  var tab = locationsText_(payload && payload.tab).toLowerCase() || 'meds';
  if (CP_MEDS_TABS.indexOf(tab) === -1) return { status: 400, message: 'tab: one of ' + CP_MEDS_TABS.join(', ') + '.' };
  var data;
  try {
    data = clientProfilesCached_('clientProfileMeds', ctx.key, tab,
      [cpTabScope_('medications')], function () { return cpMedsBuild_(ctx, tab); });
  } catch (e) {
    return { status: 503, message: 'The medications could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
  return cpAnswer_(data);
}

function cpMedsBuild_(ctx, tab) {
  var nk = clientNameKey_(ctx.name);
  var rows = [], asOf = '', why = '';
  var newer = function (d) { if (d && d > asOf) asOf = d; };
  listRows_('medications', {}).forEach(function (r) {
    if (clientNameKey_(r.Client) !== nk) return;
    var name = locationsText_(r.PrescriptionName);
    if (!name) return;
    var times = (String(r.AdministrationTimes || '').match(/\d{3,4}/g) || []).map(function (t) {
      t = ('0000' + t).slice(-4); return t.slice(0, 2) + ':' + t.slice(2);
    });
    var gone = locationsText_(r.Discountinued);
    var added = cpDay_(r['Added Date']);
    newer(added); newer(cpDay_(r['Discountinued Date'])); newer(cpDay_(r.updatedAt));
    var autoId = locationsText_(r['Id - Auto']);
    rows.push({ id: String(r['Id - Auto'] || r.id || ''), record: name, date: added, edit: autoId ? medsEditRaw_(r) : {},
                details: [locationsText_(r.Dosage), locationsText_(r.MedType), locationsText_(r.PRN), times.join(' ')]
                  .filter(String).join(' · '),
                status: gone ? 'Discontinued' : 'Active',
                source: 'eMAR' + (locationsText_(r.Dr) ? ' · Dr ' + locationsText_(r.Dr) : ''),
                text: [cpVerbatim_(r.PrescriptionInstructions), cpVerbatim_(r.MedDetails)].filter(String).join('\n') });
  });
  rows.sort(function (a, b) { return (a.status === b.status ? 0 : (a.status === 'Active' ? -1 : 1)) || a.record.localeCompare(b.record); });
  if (!rows.length) why = 'The eMAR list names no medication for ' + ctx.name + '.';
  return { tab: tab, rows: rows, statuses: cpStatuses_(rows), as_of: asOf, why: why };
}

function cpApptRow_(r, ctx, today) {
  var day = cpDay_(r.appointment_date);
  var bucket = apptBucket_(day, '', today, '');
  var up = /^y/i.test(String(r.upcoming || ''));
  var status = day ? (bucket === 'upcoming' ? 'Upcoming' : 'Past') : (up || !String(r.upcoming || '') ? 'Upcoming' : 'Past');
  return { id: String(r.id || ''), witness: String(r.client_name || ''), client_key: ctx.key,
           client_name: locationsText_(r.client_name), date: day || locationsText_(r.appointment_date),
           time: locationsText_(r.appointment_start_time), dr_name: locationsText_(r.dr_name),
           dr_address: locationsText_(r.appointment_address), van: /^y/i.test(String(r.wheelchair_van_required || '')),
           status: status };
}

/** The client's visits in the Dr Appt Archive, joined by folded name. Throws when the archive cannot be read. */
function cpVisits_(ctx) {
  var nk = clientNameKey_(ctx.name);
  return estateRows_('drVisits').filter(function (r) { return clientNameKey_(r.client_name) === nk; });
}

function cpReviewsFor_(key) {
  var by = {};
  cpOwnRows_(CP_REVIEWS_TAB).forEach(function (r) {
    if (String(r.client_key || '') !== key) return;
    var id = String(r.id || '');
    if (id && (!by[id] || String(r.at || '') >= String(by[id].at || ''))) by[id] = r;
  });
  return by;
}

function cpList_(v) {
  return String(v == null ? '' : v).split(/[,;\n]+/).map(function (s) { return s.trim(); }).filter(String);
}

/** Incidents: the client's UI/MUI reports (the Locations join, unchanged) with their review status by client_key|incident_ts. */
function cpIncidentsBuild_(ctx) {
  var c = ctx.row || {};
  var house = locationsText_(c.house || c.houseName);
  var code = locationsHouseCode_(house) || locationsCode_(house);
  var joined = locationsIncidentsFor_(estateRows_('uiIncidents'), [{ client_key: ctx.key, name: ctx.name }]);
  var reviews = cpReviewsFor_(ctx.key);
  var cats = {};
  var rows = joined.map(function (j) {
    var full = j.row || {};
    var ts = String(full.timestamp || '');
    var rv = reviews[ctx.key + '|' + ts] || null;
    j.categories.forEach(function (x) { cats[x] = true; });
    return { id: j.id, incident_ts: ts, your_name: j.your_name, client_name: j.client_name, client_key: ctx.key,
             incident_category: j.incident_category, categories: j.categories, incident_location: j.incident_location,
             house_code: code, incident_date: cpDay_(j.incident_date) || j.incident_date, incident_time: j.incident_time,
             incident_reported_date: cpDay_(full.incident_reported_date) || String(full.incident_reported_date || ''),
             incident_reported_time: String(full.incident_reported_time || ''),
             employees_involved: cpList_(full.employees_involved),
             summary_of_incident: String(full.summary_of_incident || ''),
             immediate_action_taken: String(full.immediate_action_taken || ''),
             cause_and_contributing_factors: String(full.cause_and_contributing_factors || ''),
             prevention_plan: String(full.prevention_plan || ''),
             status: rv && CP_INCIDENT_STATUSES.indexOf(String(rv.status)) !== -1 ? String(rv.status) : 'Reported',
             status_by: rv ? String(rv.by || '') : '', status_at: rv ? String(rv.at || '') : '' };
  });
  return { rows: rows, categories: Object.keys(cats).sort(), statuses: CP_INCIDENT_STATUSES.slice() };
}

HUB_POLICY.clientProfileIncidents = {
  file: 'ClientProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' } }
};
HUB_ACTIONS.clientProfileIncidents = function (payload, user) {
  if (!clientProfilesReaderFor_(user, payload && payload.client)) return clientProfilesUnknown_();
  return cpIncidentsDoor_(payload);
};

/** Past the gate — the door's answer, and the relay pack's part. */
function cpIncidentsDoor_(payload) {
  var ctx = clientProfilesClient_(payload && payload.client);
  if (ctx.refused) return ctx.refused;
  var data;
  try {
    data = clientProfilesCached_('clientProfileIncidents', ctx.key, 'all',
      [cpEstateScope_('uiIncidents'), cpTabScope_(CP_REVIEWS_TAB)], function () { return cpIncidentsBuild_(ctx); });
  } catch (e) {
    return { status: 503, message: 'The incidents could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
  return cpAnswer_(data);
}

// The pack's review statuses, by client_key|incident_ts: the one part of Incidents no slice carries (the reports…
function cpReviewsDoor_(payload) {
  var ctx = clientProfilesClient_(payload && payload.client);
  if (ctx.refused) return ctx.refused;
  var by = cpReviewsFor_(ctx.key), reviews = {};
  Object.keys(by).forEach(function (id) {
    reviews[id] = { status: String(by[id].status || ''), by: String(by[id].by || ''), at: String(by[id].at || '') };
  });
  return cpAnswer_({ client_key: ctx.key, reviews: reviews, statuses: CP_INCIDENT_STATUSES.slice() });
}

// ---- Activity --------------------------------------------------------------

var CP_ACTIVITY_KINDS = { daily_note: 'Daily note', client_note: 'Client note', house_note: 'House note',
                          incident: 'Incident', visit: 'Doctor visit', med_added: 'Medication added',
                          med_stopped: 'Medication discontinued' };

// Every client-bearing row, newest first: daily notes, client and house notes, incidents, visits and medication…
function cpActivityBuild_(ctx, own) {
  var nk = clientNameKey_(ctx.name);
  var rows = [], why = [], degraded = false;
  var counts = { daily_notes: 0, client_notes: 0, house_notes: 0, incidents: 0, visits: 0, med_changes: 0 };
  if (own) CP_NOTE_COUNTS.forEach(function (k) { delete counts[k]; });
  var push = function (kind, id, record, date, text, by, source) {
    var t = cpVerbatim_(text, 4000);
    rows.push({ id: kind + '_' + id, kind: kind, record: locationsText_(record, 160) || CP_ACTIVITY_KINDS[kind],
                date: date, details: cpGist_(t), status: CP_ACTIVITY_KINDS[kind], source: source,
                by: locationsText_(by), text: t });
  };
  var step = function (label, fn, note) {
    if (own && note) return;
    try { fn(); } catch (e) { degraded = true; why.push(cpWhy_(label, e) + '.'); }
  };
  step('The daily notes', function () {
    estateRows_('dailyNotes').forEach(function (r) {
      if (clientNameKey_(r.client_name) !== nk) return;
      counts.daily_notes++;
      push('daily_note', r.id, r.category, cpDay_(r.reporting_date) || cpDay_(r.timestamp), r.response, r.dsp_name, 'Staff Daily Notes');
    });
  }, true);
  step('The client notes', function () {
    listRows_('clientNotes', {}).forEach(function (r) {
      if (String(r.client_key || '') !== ctx.key && clientNameKey_(r.client_name) !== nk) return;
      counts.client_notes++;
      push('client_note', r.id, r.source_tab || 'Client note', cpDay_(r.entry_date) || cpDay_(r.createdAt), r.note, r.contact, 'Client notes');
    });
  }, true);
  step('The house notes', function () {
    cpOwnRows_(LOCATION_NOTES_TAB).forEach(function (r) {
      if (String(r.client_key || '') !== ctx.key || String(r.state || '').toLowerCase() === 'removed') return;
      counts.house_notes++;
      push('house_note', r.id, (locationsText_(r.priority) || 'normal') + ' priority · ' + locationsText_(r.house),
           cpDay_(r.at), r.details, r.by, 'House notes');
    });
  }, true);
  step('The incidents', function () {
    locationsIncidentsFor_(estateRows_('uiIncidents'), [{ client_key: ctx.key, name: ctx.name }]).forEach(function (j) {
      counts.incidents++;
      push('incident', j.id, j.incident_category, cpDay_(j.incident_date) || cpDay_(j.row && j.row.timestamp),
           j.row && j.row.summary_of_incident, j.your_name, 'UIs and MUIs');
    });
  });
  step('The doctor visits', function () {
    cpVisits_(ctx).forEach(function (r) {
      counts.visits++;
      push('visit', r.id, locationsText_(r.dr_name) ? 'Dr ' + locationsText_(r.dr_name) : 'Doctor visit',
           cpDay_(r.appointment_date), r.appointment_address, r.manager, 'Dr Appt Archive');
    });
  });
  step('The medications', function () {
    listRows_('medications', {}).forEach(function (r) {
      if (clientNameKey_(r.Client) !== nk) return;
      var id = String(r['Id - Auto'] || r.id || '');
      var added = cpDay_(r['Added Date']);
      if (added) { counts.med_changes++; push('med_added', id, r.PrescriptionName, added, r.Dosage, r.Added, 'eMAR'); }
      var stopped = cpDay_(r['Discountinued Date']);
      if (stopped) { counts.med_changes++; push('med_stopped', id, r.PrescriptionName, stopped, r.Discountinued, '', 'eMAR'); }
    });
  });
  rows.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  var last = rows.length ? rows[0].date : '';
  var kinds = Object.keys(CP_ACTIVITY_KINDS).filter(function (k) { return !own || CP_NOTE_KINDS.indexOf(k) === -1; });
  return { rows: rows.slice(0, CP_ROW_CAP), kinds: kinds.map(function (k) { return CP_ACTIVITY_KINDS[k]; }),
           counts: counts, last_date: last, total: rows.length, why: why.join(' '), degraded: degraded };
}

/** Activity: the client's trail assembled from every client-bearing row, in the RecordTable shape. */
HUB_POLICY.clientProfileActivity = {
  file: 'ClientProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' } }
};
HUB_ACTIONS.clientProfileActivity = function (payload, user) {
  var reader = clientProfilesReaderFor_(user, payload && payload.client);
  if (!reader) return clientProfilesUnknown_();
  return cpActivityDoor_(payload, clientProfilesOwnOnly_(reader));
};

/** Past the gate — the door's answer, and the relay pack's part; `own` leaves the notes out. */
function cpActivityDoor_(payload, own) {
  var ctx = clientProfilesClient_(payload && payload.client);
  if (ctx.refused) return ctx.refused;
  return cpAnswer_(cpActivity_(ctx, own));
}

function cpActivity_(ctx, own) {
  return clientProfilesCached_('clientProfileActivity', ctx.key, own ? 'own' : 'all',
    [cpEstateScope_('dailyNotes'), cpTabScope_('client_notes'), cpTabScope_(LOCATION_NOTES_TAB), cpEstateScope_('uiIncidents'),
     cpEstateScope_('drVisits'), cpTabScope_('medications')], function () { return cpActivityBuild_(ctx, !!own); });
}

// ---- the relay's pack ------------------------------------------------------

// Every private part of one client, each its own door's answer and cache: what no slice may carry.
var CP_PACK_PARTS = ['roster_own', 'details', 'care_plans', 'care_team', 'care_daily', 'care_health', 'care_goals',
                     'care_home', 'meds', 'reviews', 'incidents', 'activity', 'activity_own', 'appointments', 'transport',
                     'transport_own', 'mar', 'mar_own', 'refills', 'funds', 'billing'];
// Past this a pack starts no further part, so it always answers inside the execution limit.
var CP_PACK_BUDGET_MS = 240000;

/** Each part's door, past its gate, asked for one client; a client's own cut of a part gathered already reads it. */
function cpPackDoors_(key, parts) {
  var ask = { client: key };
  var care = function (tab) { return function () { return cpCareDoor_({ client: key, tab: tab }); }; };
  var own = function (name, door, cut) {
    return function () {
      var got = parts && parts[name] ? { status: 200, data: parts[name] } : door();
      return got && got.status === 200 && got.data ? { status: 200, data: cut(got.data) } : got;
    };
  };
  var mine = {};
  mine[key] = true;
  return {
    roster_own: function () { return cpRosterDoor_(false, { kind: 'client', keys: mine }); },
    details: function () { return cpDetailsDoor_(ask); },
    care_plans: care('plans'), care_team: care('team'), care_daily: care('daily'), care_health: care('health'),
    care_goals: care('goals'), care_home: care('home'),
    meds: function () { return cpMedsDoor_({ client: key, tab: 'meds' }); },
    reviews: function () { return cpReviewsDoor_(ask); },
    incidents: function () { return cpIncidentsDoor_(ask); },
    activity: function () { return cpActivityDoor_(ask); },
    activity_own: function () { return cpActivityDoor_(ask, true); },
    appointments: function () { return csApptDoor_(ask); },
    transport: function () { return csTransportDoor_(ask); },
    transport_own: own('transport', function () { return csTransportDoor_(ask); }, csTransportOwn_),
    mar: function () { return csmDoor_(ask); },
    mar_own: own('mar', function () { return csmDoor_(ask); }, csmOwn_),
    refills: function () { return csrDoor_(ask); },
    funds: function () { return csfFundsDoor_(ask); },
    billing: function () { return csfBillingDoor_(ask); }
  };
}

// The relay's pack: every section's private part of one client — the record, the six care tabs, the medications…
HUB_POLICY.clientPack = {
  file: 'ClientProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' } }
};
HUB_ACTIONS.clientPack = function (payload, user) {
  if (!user || !user.is_service) return clientProfilesUnknown_();
  var started = Date.now();
  var held = CLIENTS_DERIVED_MEMO_;
  CLIENTS_DERIVED_MEMO_ = {};
  try {
    var ctx = clientProfilesClient_(payload && payload.client);
    if (ctx.refused) return ctx.refused;
    var parts = {}, status = {};
    var doors = cpPackDoors_(ctx.key, parts);
    CP_PACK_PARTS.forEach(function (name) {
      if (Date.now() - started > CP_PACK_BUDGET_MS) {
        status[name] = { status: 503, message: 'This part was not gathered in this pack; it is read on its own.' };
        return;
      }
      try {
        var got = doors[name]();
        if (got && got.status === 200 && got.data !== undefined && got.data !== null) {
          parts[name] = got.data;
          status[name] = { status: 200 };
        } else {
          status[name] = { status: Number(got && got.status) || 503,
                           message: String((got && got.message) || 'This part did not answer.').slice(0, 200) };
        }
      } catch (e) {
        status[name] = { status: 503, message: 'This part could not be read just now (' +
                         String((e && e.message) || e).slice(0, 120) + ').' };
      }
    });
    return { status: 200, data: { client: ctx.key, built_at: new Date(started).toISOString(), parts: parts,
                                  part_status: status } };
  } finally { CLIENTS_DERIVED_MEMO_ = held; }
};

// One document of the client, as bytes for the platform's centred viewer (the Locations converter): only the plan…
HUB_POLICY.clientProfileDocFile = {
  file: 'ClientProfiles.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' }, file_id: { type: 'string' } }
};
HUB_ACTIONS.clientProfileDocFile = function (payload, user) {
  if (!clientProfilesReaderFor_(user, payload && payload.client)) return clientProfilesUnknown_();
  var ctx = clientProfilesClient_(payload && payload.client);
  if (ctx.refused) return ctx.refused;
  var id = locationsText_(payload && payload.file_id, 120);
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return { status: 400, message: 'file_id: a Drive file id.' };
  if (!cpDocKnown_(ctx, id)) return { status: 404, message: 'This client names no such document.' };
  var got;
  try { got = locationsDocBytes_(id); }
  catch (e) {
    var gone = /not found|no item|does not exist|trashed/i.test(String((e && e.message) || e));
    return gone ? { status: 404, message: 'The file is no longer in the drive.' }
                : { status: 503, message: 'The document could not be opened just now — try again in a minute.' };
  }
  if (got.refused) return got.refused;
  return { status: 200, data: { id: id, name: got.name, mime: got.mime, size: got.size, exported: got.exported, b64: got.b64 } };
};

function cpDocKnown_(ctx, id) {
  try { if (String(ispDocFor_(ctx.name).id || '') === id) return true; } catch (e) { /* not the plan */ }
  var nk = clientNameKey_(ctx.name);
  try {
    return clientFilesFor_([ctx.key], [nk]).some(function (r) {
      if (String(r.client_key || '') !== ctx.key && clientNameKey_(r.client_name) !== nk) return false;
      if (!cpPlanFile_(r)) return false;
      return String(r.drive_id || '') === id || locationsDriveId_(r.url) === id;
    });
  } catch (eF) { return false; }
}

// ---- writes --------------------------------------------------------------

// The editions the profile pencil, the care rows, the chart rows and the trips belong to (Editions.gs EDITIONS).
var CP_EDITION_PROFILE = 'clients.profile';
var CP_EDITION_CARE = 'clients.care';
var CP_EDITION_MEDS = 'clients.medication';
var CP_EDITION_TRANSPORT = 'clients.transportation';

// FAIL-CLOSED: an edit's door — the master; else a listed holder of the edition, for a client they read (never own).
function cpProfileEditDoor_(payload, user, edition) {
  if (clientProfilesGate_(user)) return hubIsWriter_(user) ? null : hubDenied_();
  var allowed = false;
  try { allowed = hubEditionAllows_(edition || CP_EDITION_PROFILE, user); } catch (e) { allowed = false; }
  if (!allowed) return clientProfilesUnknown_();
  var reader = clientProfilesReaderFor_(user, payload && payload.client);
  return reader && !clientProfilesOwnOnly_(reader) ? null : clientProfilesUnknown_();
}

// The profile pencil: the allowlisted Hub `clients` columns only; SSN, card, DC and PIN are never written here.
HUB_POLICY.clientProfileSave = {
  file: 'ClientProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: ['clients'], emits: [],
  params: { client: { type: 'string' }, fields: {}, changes: { type: 'array' } }
};
HUB_ACTIONS.clientProfileSave = function (payload, user) {
  var shut = cpProfileEditDoor_(payload, user);
  if (shut) return shut;
  var ctx = clientProfilesClient_(payload && payload.client);
  if (ctx.refused) return ctx.refused;
  if (payload && payload.changes !== undefined) return cpEditSteps_(cpProfileEdit_(ctx, payload, user));
  var checked = clientProfileSaveFields_(payload && payload.fields);
  if (checked.refused) return checked.refused;
  if (ctx.archived) {
    return { status: 409, message: 'This client is in the archive of old clients; the archive is not edited here.' };
  }
  var house = checked.fields.hasOwnProperty('house') ? cpEditLive_(ctx) : null;
  var got = cpProfileWrite_(ctx, checked.fields, house && !house.refused ? house.house : '');
  if (got.refused) return got.refused;
  hubSysLog_(str_(user.email), 'clientProfileSave', ctx.key, { status: 200 });
  var row = { id: got.id, client_key: ctx.key };
  Object.keys(checked.fields).forEach(function (k) { row[k] = checked.fields[k]; });
  var data = { saved: true, row: cpScrub_(row) };
  if (got.failed.length) data.refused = got.failed.map(function (f) { return { field: f.column, why: f.why }; });
  return { status: 200, data: data };
};

// The Apply strip's words per kind of edit: the row it wrote, the caches read again.
var CP_EDIT_WORDS = {
  profile: ['The client\'s row on the Hub clients tab.', 'The client\'s profile and the roster, read again.'],
  care: ['The care record on the Hub client_overrides tab.', 'The client\'s Care & Support, read again.'],
  meds: ['The medicine\'s row on the Hub medications tab (the eMAR list).', 'The client\'s Medication, read again.'],
  transport: ['The trip\'s row in the Transportation trips house, and its log line.',
              'The vehicle calendar and the client\'s Transportation, read again.']
};

/** A landed edit's answer with what the Apply strip shows: the Hub row, the caches retired, the slices that follow. */
function cpEditSteps_(got, kind) {
  var d = got && got.data;
  if (!got || got.status !== 200 || !d || !(d.written || []).length) return got;
  var words = CP_EDIT_WORDS[kind] || CP_EDIT_WORDS.profile;
  d.steps = [{ id: 'sheet', label: 'Sheet', landed: true, words: words[0] },
             { id: 'cache', label: 'Kept caches', landed: true, words: words[1] }];
  d.slices = kind ? [] : ['clients'];
  d.mirror = d.written.indexOf('house') !== -1 ? ['houses'] : [];
  d.app = CP_APP_ID;
  return got;
}

/** Why the edit door does not write this field; '' when it does. */
function cpEditRefusal_(field, cols) {
  if (CP_NEVER_WRITTEN.test(cpFold_(field))) return CP_EDIT_PROTECTED;
  if (CP_EDIT_LOCKED[field]) return CP_EDIT_LOCKED[field];
  return cols[field] ? '' : 'Not a field this app edits.';
}

/** What the profile shows for each edit field now, scrubbed as the read sends it: the witness. */
function cpEditLive_(ctx) {
  var src = cpSources_(ctx);
  if (src.degraded) {
    return { refused: { status: 503, message: 'Part of the client record could not be read just now, so nothing was written.' } };
  }
  return cpScrub_(cpEditRaw_(cpPicker_(ctx.row || {}, src.mf, src.tf)));
}

function cpProfileEdit_(ctx, payload, user) {
  var asked = hubEditChanges_(payload);
  if (asked.refused) return asked.refused;
  if (ctx.archived) {
    return { status: 409, message: 'This client is in the archive of old clients; the archive is not edited here.' };
  }
  var live = cpEditLive_(ctx);
  if (live.refused) return live.refused;
  var cols = cpEditColumns_();
  var fields = {}, written = [], refused = [], stale = {};
  var homes = null;
  asked.changes.forEach(function (c) {
    var why = cpEditRefusal_(c.field, cols);
    if (why) { refused.push({ field: c.field, why: why }); return; }
    var held = hubEditWitness_(c.field, c.expected, live[c.field]);
    if (held) { stale[c.field] = held.data.current; return; }
    var value = c.value.replace(/\s+/g, ' ').slice(0, 500);
    if (c.field === 'house' && value) {
      if (!homes) {
        homes = {};
        try { locationsHomes_().forEach(function (h) { homes[h.code] = true; }); } catch (eH) { homes = null; }
      }
      if (!homes) { refused.push({ field: c.field, why: 'The Locations homes list could not be read just now.' }); return; }
      value = value.toUpperCase();
      if (!homes[value]) { refused.push({ field: c.field, why: 'Not a house on the Locations registry.' }); return; }
    }
    fields[cols[c.field]] = hubCellSafe_(value);
    written.push({ field: c.field, before: c.expected, after: value });
  });
  var notes = [];
  if (written.length) {
    var got = cpProfileWrite_(ctx, fields, live.house);
    if (got.refused) return got.refused;
    got.failed.forEach(function (f) {
      var k = Object.keys(cols).filter(function (x) { return cols[x] === f.column; })[0] || f.column;
      written = written.filter(function (w) { return w.field !== k; });
      refused.push({ field: k, why: f.why });
    });
    notes = got.notes;
    if (written.length) hubEditLog_(user, 'clientProfileSave', ctx.key, written, []);
  }
  var data = { written: written.map(function (w) { return w.field; }), refused: refused };
  if (notes.length) data.notes = notes;
  if (Object.keys(stale).length) {
    data.current = stale;
    return { status: 409, data: data,
             message: written.length ? 'Some fields changed since the panel was opened — reloaded; the others were saved.'
                                     : 'Changed since the panel was opened — reloaded, nothing was written.' };
  }
  return { status: 200, data: data };
}

// Files checked columns on the client's Hub row (made when it has none).
function cpProfileWrite_(ctx, fields, oldHouse) {
  var target = null;
  try {
    listRows_('clients', {}).forEach(function (r) {
      var k = String(r.client_key || '').trim() || clientNameKey_(r.name);
      if (!target && k === ctx.key) target = r;
    });
  } catch (eC) {
    return { refused: { status: 503, message: 'The clients tab could not be read just now (' + String((eC && eC.message) || eC).slice(0, 120) + ').' } };
  }
  var held = sheetDbGateHolds_('clients', target ? 'update' : 'create');
  if (held) return { refused: held.error };
  var failed = [], notes = [];
  CP_MASTER_WRITE_THROUGH.forEach(function (col) {
    if (!fields.hasOwnProperty(col)) return;
    var m = cpMasterWrite_(ctx.name, col, String(fields[col]));
    if (m.why) { failed.push({ column: col, why: m.why }); delete fields[col]; }
    else if (m.absent) notes.push(col + ': the Asa Client Database Master has no row for this client, so only the Hub record carries it.');
  });
  if (!Object.keys(fields).length) return { id: '', failed: failed, notes: notes };
  var was = String((target && target.cleared_fields) || '');
  var next = hubEditClearedNext_(was, fields);
  var res;
  if (target) {
    var patch = { id: target.id };
    Object.keys(fields).forEach(function (k) { patch[k] = fields[k]; });
    if (next !== was) patch.cleared_fields = next;
    res = updateRowById_('clients', patch);
  } else {
    var rec = { id: 'CLI_' + ctx.key, client_key: ctx.key, name: ctx.name };
    Object.keys(fields).forEach(function (k) { rec[k] = fields[k]; });
    if (next) rec.cleared_fields = next;
    res = createRow_('clients', rec);
  }
  var refused = sheetDbRefused_(res);
  if (refused) return { refused: refused };
  cpBump_(ctx.key, ['clientProfileDetails', 'clientProfileCare', 'clientProfileIncidents']);
  cacheBump_('cp_clientProfileRoster_all');
  if (fields.hasOwnProperty('house')) {
    [oldHouse, fields.house].forEach(function (h) {
      var code = locationsHouseCode_(h) || locationsCode_(h);
      if (code) { locationsBump_('locationOverview', code); locationsBump_('locationStaff', code); }
    });
  }
  return { id: String((res && res.id) || ''), failed: failed, notes: notes };
}

/** The Asa Client Database Master tab the write-through writes; throws when it cannot be opened. */
function cpMasterSheet_() {
  var sheet = ssOpen_(cpClientDbId_()).getSheetByName(CP_MASTER_TAB);
  if (!sheet) throw new Error('the book has no ' + CP_MASTER_TAB + ' tab');
  return sheet;
}

// The write-through: the one Master row whose client cell is this client's name (the witness) takes `value` under…
function cpMasterWrite_(name, col, value) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { why: 'The Asa Client Database is busy — try again in a moment.' };
  try {
    return cpMasterWriteHeld_(name, col, value);
  } finally {
    try { lock.releaseLock(); } catch (eR) { /* released with the execution */ }
  }
}

/** The book row whose client cell folds to `name`: { at } (0-based), { absent }, or { twin } when two rows carry it. */
function cpBookRowOf_(values, name) {
  var head = (values[0] || []).map(cpFold_);
  var names = [];
  head.forEach(function (h, i) { if (CP_BOOK_FIELDS[h] === 'name') names.push(i); });
  var key = clientNameKey_(name), rows = [];
  for (var r = 1; r < values.length; r++) {
    var who = names.map(function (i) { return locationsText_(values[r][i]); }).filter(String)[0] || '';
    if (who && clientNameKey_(who) === key) rows.push(r);
  }
  if (!names.length || !rows.length) return { absent: true, names: names };
  return rows.length > 1 ? { twin: true, names: names } : { at: rows[0], names: names };
}

/** cpMasterWrite_ under a lock the caller holds; `col` 'name' writes every client cell of the row. */
function cpMasterWriteHeld_(name, col, value) {
  try {
    var sheet = cpMasterSheet_();
    var values = sheet.getDataRange().getValues();
    var head = (values[0] || []).map(cpFold_);
    var hit = cpBookRowOf_(values, name);
    var cols = [];
    if (col === 'name') cols = hit.names;
    else head.forEach(function (h, i) { if (!cols.length && CP_BOOK_FIELDS[h] === col) cols.push(i); });
    if (!cols.length || !hit.names.length) return { why: 'The Asa Client Database Master has no column for this field.' };
    if (hit.absent) return { absent: true };
    if (hit.twin) return { why: 'Two rows of the Asa Client Database Master carry this name, so neither was moved.' };
    var wrote = false;
    cols.forEach(function (at) {
      if (col === 'name' && !locationsText_(values[hit.at][at])) return;
      if (locationsText_(values[hit.at][at]) === value) return;
      sheet.getRange(hit.at + 1, at + 1).setValue(hubCellSafe_(value));
      wrote = true;
    });
    if (wrote) {
      try { cacheBump_(cacheScopeSheet_(cpClientDbId_(), CP_MASTER_TAB)); } catch (eB) { /* the index heals on its clock */ }
    }
    return { done: true };
  } catch (e) {
    return { why: 'The Asa Client Database Master could not be written (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
}

/** The pencil's fields, checked: a sensitive name or an unknown one refuses the whole save (422). */
function clientProfileSaveFields_(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { refused: { status: 400, message: 'fields: the profile fields to save, by name.' } };
  }
  var out = {}, never = [], unknown = [];
  Object.keys(raw).forEach(function (k) {
    var col = CP_SAVE_ALIASES[k] || k;
    if (CP_NEVER_WRITTEN.test(cpFold_(k))) { never.push(k); return; }
    if (CP_SAVE_FIELDS.indexOf(col) === -1) { unknown.push(k); return; }
    var v = raw[k];
    if (v !== null && typeof v === 'object') { unknown.push(k); return; }
    out[col] = hubCellSafe_(String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 500));
  });
  if (never.length) {
    return { refused: { status: 422, message: 'SSN, card, DC and PIN are never written here (' + never.join(', ') + ').' } };
  }
  if (unknown.length) return { refused: { status: 422, message: 'Not a profile field: ' + unknown.join(', ') + '.' } };
  if (!Object.keys(out).length) return { refused: { status: 400, message: 'fields: nothing to save.' } };
  return { fields: out };
}

/** 'Active' or 'Inactive', as the profile shows the client: the witness of the status door. */
function cpStatusWord_(ctx) {
  return !ctx.archived && locationsClientCurrent_(ctx.row) ? 'Active' : 'Inactive';
}

/** The profile's edit map with the name and the status, which file through their own doors. */
function cpEditWithKey_(edit, ctx) {
  edit.name = locationsText_(ctx.name);
  edit.status = cpStatusWord_(ctx);
  return edit;
}

/** The one change a single-field door takes, the others refused: { change, refused } or { error }. */
function cpOneChange_(payload, field) {
  var asked = hubEditChanges_(payload);
  if (asked.refused) return { error: asked.refused };
  var change = null, refused = [];
  asked.changes.forEach(function (c) {
    if (c.field === field) change = c;
    else refused.push({ field: c.field, why: 'Not a field this door edits.' });
  });
  if (!change) return { error: { status: 400, message: 'changes: one { field: "' + field + '", value, expected }.' } };
  return { change: change, refused: refused };
}

function cpBusy_() {
  return { status: 409, message: 'Another write is in progress — try again in a moment.' };
}

/** A person's full name as a rename files it: words only, single-spaced, first and last; '' when it is not one. */
function cpCleanName_(v) {
  var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (s.length < 3 || s.length > 120 || s.split(' ').length < 2) return '';
  return /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ .,'\-]*$/.test(s) ? s : '';
}

/** The key a renamed client takes: the plan's key shape or the name-fold shape, as the old key was made. */
function cpRenameKey_(oldKey, oldName, newName) {
  if (oldKey === ispIntakeKey_(oldName)) return ispIntakeKey_(newName);
  if (oldKey === clientNameKey_(oldName)) return clientNameKey_(newName);
  return oldKey;
}

// Rename: the client's name and key carried under one lock into every book that matches a client by name or key…
HUB_POLICY.clientProfileRename = {
  file: 'ClientProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['clients'], emits: [],
  params: { client: { type: 'string' }, changes: { type: 'array' } }
};
/** A hold on the rename door, for when a book that matches a client by name cannot follow it. */
var CP_RENAME_HELD = false;
HUB_ACTIONS.clientProfileRename = function (payload, user) {
  if (!clientProfilesGate_(user)) return clientProfilesUnknown_();
  if (!hubIsWriter_(user)) return hubDenied_();
  if (CP_RENAME_HELD) return { status: 409, message: 'Renaming a client is held. Nothing was changed.' };
  var first = clientProfilesClient_(payload && payload.client);
  if (first.refused) return first.refused;
  var one = cpOneChange_(payload, 'name');
  if (one.error) return one.error;
  var name = cpCleanName_(one.change.value);
  if (!name) return { status: 400, message: 'name: a full name, first and last, in letters.' };
  var held = sheetDbGateHolds_('clients', 'update');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return cpBusy_();
  var ctx, newKey, notes = [], moved;
  try {
    ctx = clientProfilesClient_(payload && payload.client);
    if (ctx.refused) return ctx.refused;
    if (ctx.archived) {
      return { status: 409, message: 'This client is in the archive of old clients; set them active before renaming.' };
    }
    var stale = hubEditWitness_('name', one.change.expected, locationsText_(ctx.name));
    if (stale) {
      return { status: 409, message: stale.message,
               data: { written: [], refused: one.refused, current: { name: stale.data.current } } };
    }
    if (name === locationsText_(ctx.name)) {
      return { status: 200, data: { written: [], refused: one.refused, client_key: ctx.key } };
    }
    newKey = cpRenameKey_(ctx.key, ctx.name, name);
    var clash = cpRenameClash_(ctx, name, newKey);
    if (clash) return { status: 409, message: clash };
    var plan = cpRenamePlan_(ctx, newKey, name);
    if (plan.cannot.length) {
      return { status: 409, message: 'Nothing was renamed: the new name cannot be carried into ' + plan.cannot.join('; ') + '.',
               data: { written: [], refused: one.refused, cannot_follow: plan.cannot } };
    }
    var failed = cpRenameApply_(plan);
    if (failed) return { status: 503, message: failed, data: { written: [], refused: one.refused } };
    notes = plan.notes;
    moved = plan.moved;
  } finally { lock.releaseLock(); }
  notes.push(CP_RENAME_ELSEWHERE);
  cpRenameBump_(ctx, newKey);
  hubEditLog_(user, 'clientProfileRename', ctx.key + ' → ' + newKey, [{ field: 'name' }], []);
  return { status: 200, data: { written: ['name'], refused: one.refused, client_key: newKey, notes: notes, moved: moved } };
};

/** Why the new name or key would join another client's records; '' when nothing else carries them. */
function cpRenameClash_(ctx, name, newKey) {
  var fold = clientNameKey_(name), mine = clientNameKey_(ctx.name);
  var other = (ctx.all || []).some(function (c) {
    var k = String(c.client_key || '').trim() || clientNameKey_(c.name);
    if (k === ctx.key) return false;
    return k === newKey || clientNameKey_(c.name) === fold;
  });
  if (other) return 'Another client already carries that name, so nothing was renamed.';
  if (fold === mine) return '';
  var books = [];
  try { books.push(cpMasterIndex_()); } catch (eM) { return 'The Asa Client Database could not be read just now, so nothing was renamed.'; }
  try { books.push(cpArchiveIndex_()); } catch (eA) { return 'The archive of old clients could not be read just now, so nothing was renamed.'; }
  if (books.some(function (b) { return !!b.rows[fold]; })) {
    return 'The Asa Client Database already holds a row with that name, so nothing was renamed.';
  }
  return '';
}

/** The Hub tabs a rename follows: CP_REKEY_TABS, every client-scoped resource's tab, the PSI punches, the form answers. */
function cpRenameHubTabs_() {
  var out = CP_REKEY_TABS.slice(), seen = {};
  out.forEach(function (s) { seen[s.tab] = true; });
  Object.keys(RESOURCES).forEach(function (res) {
    var cfg = RESOURCES[res] || {};
    if (!cfg.clientScoped || cfg.clientByHouse || cfg.clientByAddress || ESTATE_SOURCES[res] || !cfg.sheet || seen[cfg.sheet]) return;
    seen[cfg.sheet] = true;
    out.push({ tab: cfg.sheet, any: true });
  });
  [{ tab: PSI_PUNCHES_FULL_TAB, name: ['consumer_1', 'consumer_2', 'consumer_3'], list: ['consumers'] },
   { tab: 'form_submissions', json: ['answers'] }].forEach(function (s) { if (!seen[s.tab]) out.push(s); });
  return out;
}

/** The books outside the Hub tabs that match a client by name (the column kinds: cpRenameScan_). */
function cpRenameBooks_() {
  var dr = 'Dr Appointments › ', mm = 'Missing Medications › ', van = 'Van Calendar › ';
  var formNames = [/^selectclient/, 'clientname', 'client'], formHeads = /^(.+?)\s*:\s*medications?\s*$/i;
  return [
    { book: 'Asa Client Database › ' + CP_MASTER_TAB, master: true, bookNames: true, one: true },
    { book: 'Master Data › ' + CP_MASTER_DATA_TAB, prop: CP_MASTER_DATA_PROP, tab: CP_MASTER_DATA_TAB, bookNames: true, one: true },
    { book: dr + CS_APPT_ARCHIVE, estate: 'drVisits', name: ['clientname'] },
    { book: dr + CS_APPT_FUTURE, estate: 'drVisits', tab: CS_APPT_FUTURE, name: ['clientname'] },
    { book: dr + CS_APPT_MASTER, estate: 'drAppointments', name: ['client'] },
    { book: 'UIs and MUIs', estate: 'uiIncidents', name: ['clientname'] },
    { book: 'Staff Daily Notes', estate: 'dailyNotes', name: ['clientname'] },
    { book: mm + CSR_LIVE_TAB, prop: CSR_BOOK_PROP, fallback: CSR_BOOK_FALLBACK, tab: CSR_LIVE_TAB, name: formNames, heads: formHeads },
    { book: mm + CSR_EARLIER_TAB, prop: CSR_BOOK_PROP, fallback: CSR_BOOK_FALLBACK, tab: CSR_EARLIER_TAB, name: formNames, heads: formHeads },
    { book: mm + CSR_LOW_TAB, prop: CSR_BOOK_PROP, fallback: CSR_BOOK_FALLBACK, tab: CSR_LOW_TAB, name: ['client', 'clientname'] },
    { book: mm + CSR_CONTROL_TAB, prop: CSR_BOOK_PROP, fallback: CSR_BOOK_FALLBACK, tab: CSR_CONTROL_TAB, name: ['client', 'clientname'] },
    { book: van + CS_TRANSPORT_REQUESTS_TAB, prop: CS_TRANSPORT_VAN_PROP, fallback: CS_TRANSPORT_VAN_FALLBACK,
      tab: CS_TRANSPORT_REQUESTS_TAB, name: ['clientname'] },
    { book: van + CS_TRANSPORT_CONFLICTS_TAB, prop: CS_TRANSPORT_VAN_PROP, fallback: CS_TRANSPORT_VAN_FALLBACK,
      tab: CS_TRANSPORT_CONFLICTS_TAB, list: [/^clients?inconflict/] },
    { book: 'TrueLink Reconciliation › Transactions', prop: 'FIN_TRUELINK_SHEET_ID', tab: 'Transactions', name: ['cardholdername'] },
    { book: 'PAWS Adjustments', prop: CSF_PAWS_PROP, fallback: CSF_PAWS_FALLBACK, tab: CSF_PAWS_TAB, must: ['Name', 'Span'],
      name: ['name'] },
    { book: 'Asa Client Database › ' + CSF_SPANS_TAB, prop: CSF_CLIENT_DB_PROP, fallback: CSF_CLIENT_DB_FALLBACK,
      tab: CSF_SPANS_TAB, must: ['Client', 'Span'], name: ['client'] },
    { book: 'Billing Errors › ' + CSF_EVV_TAB, prop: CSF_MBS_PROP, fallback: CSF_MBS_FALLBACK, tab: CSF_EVV_TAB,
      must: ['Client', 'Date'], last: ['client'] }
  ];
}

/** A book tab a rename follows: { sheet, id, tab }. Throws when it is not configured, cannot be opened or lacks the tab. */
function cpRenameBookSheet_(spec) {
  if (spec.master) return { sheet: cpMasterSheet_(), id: cpClientDbId_(), tab: CP_MASTER_TAB };
  var id = '', tab = spec.tab;
  if (spec.estate) {
    var src = estateSource_(spec.estate) || {};
    id = String(src.id || '').trim();
    tab = tab || src.tab;
  } else if (spec.fallback) {
    id = locationsBookId_(spec.prop, spec.fallback);
  } else {
    id = String(hubId_(spec.prop) || '').trim();
  }
  if (!id) throw new Error('the book is not configured');
  var sheet = ssOpen_(id).getSheetByName(tab);
  if (!sheet) throw new Error('the book has no ' + tab + ' tab');
  return { sheet: sheet, id: id, tab: tab };
}

function cpRenameErr_(e) {
  return String((e && e.message) || e).slice(0, 120);
}

/** A whole-name cell renamed ("Last, First" kept so), or null when it names someone else. */
function cpRenameName_(v, rn) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (clientNameKey_(s) === rn.fold) return rn.newName;
  var parts = s.split(',');
  if (parts.length === 2 && clientNameKey_(parts[1] + ' ' + parts[0]) === rn.fold) {
    var w = rn.newName.split(' ');
    return w[w.length - 1] + ', ' + w.slice(0, -1).join(' ');
  }
  return null;
}

/** A cell that lists names, with this client's renamed; null when it does not list them. */
function cpRenameList_(v, rn) {
  var parts = String(v == null ? '' : v).split(/(\s*[;,\/&|\n]\s*|\s+and\s+)/i), hit = false;
  for (var i = 0; i < parts.length; i += 2) {
    if (parts[i].trim() && clientNameKey_(parts[i]) === rn.fold) { parts[i] = rn.newName; hit = true; }
  }
  return hit ? parts.join('') : null;
}

/** A JSON answers cell whose client fields name this client, renamed; null otherwise. */
function cpRenameJson_(v, rn) {
  var s = String(v == null ? '' : v).trim();
  if (s.charAt(0) !== '{') return null;
  var o;
  try { o = JSON.parse(s); } catch (e) { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  var hit = false;
  Object.keys(o).forEach(function (k) {
    if (String(k).toLowerCase().indexOf('client') === -1 || typeof o[k] !== 'string') return;
    var n = cpRenameName_(o[k], rn);
    if (n !== null) { o[k] = n; hit = true; }
  });
  return hit ? JSON.stringify(o) : null;
}

// One tab's cells a rename rewrites: { cells: [[row, col, before, after]] (0-based), rows, why }.
function cpRenameScan_(spec, values, rn) {
  var out = { cells: [], rows: 0, why: '' };
  if (!values || !values.length) return out;
  var fold = function (h) { return cpFold_(String(h == null ? '' : h).replace(/\([^)]*\)/g, ' ')); };
  var at = 0;
  if (spec.must) {
    at = -1;
    for (var i = 0; i < values.length && at === -1; i++) {
      var cells = values[i].map(fold);
      if (spec.must.every(function (m) { return cells.indexOf(fold(m)) !== -1; })) at = i;
    }
    if (at === -1) return out;
  }
  var head = values[at].map(fold);
  var pick = function (list, test) {
    var cols = [];
    head.forEach(function (h, c) {
      if (h && (test ? test(h) : (list || []).some(function (w) { return w instanceof RegExp ? w.test(h) : fold(w) === h; }))) cols.push(c);
    });
    return cols;
  };
  var clientKeyish = function (h) { return h.indexOf('client') !== -1 && /(key|id)$/.test(h); };
  var keyCols = spec.any ? pick(null, clientKeyish) : pick(spec.key);
  var nameCols = spec.any ? pick(null, function (h) { return h.indexOf('client') !== -1 && !clientKeyish(h); })
    : spec.bookNames ? pick(null, function (h) { return CP_BOOK_FIELDS[h] === 'name'; }) : pick(spec.name);
  var listCols = pick(spec.list), jsonCols = pick(spec.json), lastCols = pick(spec.last), idCols = pick(spec.ids);
  if (spec.one && !nameCols.length) { out.why = 'it has no client column'; return out; }
  if (spec.heads) {
    values[at].forEach(function (h, c) {
      var m = spec.heads.exec(String(h == null ? '' : h).trim());
      if (m && clientNameKey_(m[1]) === rn.fold) out.cells.push([at, c, h, String(h).replace(m[1], rn.newName)]);
    });
  }
  var where = Object.keys(spec.where || {}).map(function (c) { return [head.indexOf(fold(c)), spec.where[c]]; });
  var moves = rn.oldKey !== rn.newKey, lastMoves = rn.oldLast !== rn.newLast.toLowerCase();
  var prefixes = [['IS_' + rn.oldKey + '_', 'IS_' + rn.newKey + '_'], ['isp_' + rn.oldKey + '_', 'isp_' + rn.newKey + '_'],
                  [rn.oldKey + '|', rn.newKey + '|']];
  var named = 0;
  for (var r = at + 1; r < values.length; r++) {
    var line = values[r], put = {}, mine;
    if (where.some(function (w) { return w[0] === -1 || String(line[w[0]]) !== w[1]; })) continue;
    var keys = keyCols.map(function (c) { return String(line[c] == null ? '' : line[c]).trim(); });
    if (moves) keyCols.forEach(function (c, j) { if (keys[j] === rn.oldKey) put[c] = rn.newKey; });
    mine = !keyCols.length || keys.indexOf(rn.oldKey) !== -1 || keys.every(function (k) { return !k; });
    if (mine) {
      var hit = false;
      [[nameCols, cpRenameName_], [listCols, cpRenameList_], [jsonCols, cpRenameJson_]].forEach(function (kind) {
        kind[0].forEach(function (c) {
          var v = kind[1](line[c], rn);
          if (v !== null) { put[c] = v; hit = true; }
        });
      });
      if (hit) named++;
      if (lastMoves) {
        lastCols.forEach(function (c) {
          if (String(line[c] == null ? '' : line[c]).trim().toLowerCase() !== rn.oldLast) return;
          if (rn.lastShared) out.why = 'it names clients by last name alone, and another client shares this one';
          put[c] = rn.newLast;
        });
      }
    }
    if (!Object.keys(put).length) continue;
    if (moves) {
      idCols.forEach(function (c) {
        var v = String(line[c] == null ? '' : line[c]);
        prefixes.forEach(function (p) { if (v.indexOf(p[0]) === 0) put[c] = p[1] + v.slice(p[0].length); });
      });
    }
    var changed = false;
    Object.keys(put).forEach(function (c) {
      if (String(put[c]) === String(line[c] == null ? '' : line[c])) return;
      out.cells.push([r, Number(c), line[c], put[c]]);
      changed = true;
    });
    if (changed) out.rows++;
  }
  if (spec.one && named > 1) out.why = 'two rows carry this name';
  return out;
}

// Every cell a rename rewrites, read under the caller's lock: { writes, moved: { book: rows }, cannot: [book]…
function cpRenamePlan_(ctx, newKey, newName) {
  var last = function (n) { var w = locationsText_(n).split(' '); return w[w.length - 1]; };
  var oldLast = last(ctx.name).toLowerCase();
  var rn = {
    oldKey: ctx.key, newKey: newKey, fold: clientNameKey_(ctx.name), newName: newName, oldLast: oldLast, newLast: last(newName),
    lastShared: (ctx.all || []).some(function (c) {
      var k = String(c.client_key || '').trim() || clientNameKey_(c.name);
      return k !== ctx.key && last(c.name).toLowerCase() === oldLast;
    })
  };
  var plan = { writes: [], moved: {}, cannot: [], notes: [] };
  var take = function (label, sheet, scope, spec) {
    var res = cpRenameScan_(spec, sheet.getDataRange().getValues(), rn);
    if (res.why) { plan.cannot.push(label + ' (' + res.why + ')'); return -1; }
    res.cells.forEach(function (c) {
      plan.writes.push({ book: label, sheet: sheet, scope: scope, r: c[0] + 1, c: c[1] + 1, before: c[2], after: c[3] });
    });
    if (res.rows) plan.moved[label] = res.rows;
    return res.rows;
  };
  cpRenameHubTabs_().forEach(function (spec) {
    var label = 'the ' + spec.tab + ' tab';
    try {
      var sheet = hubTabSheet_(spec.tab);
      if (sheet) take(label, sheet, cpTabScope_(spec.tab), spec);
    } catch (e) { plan.cannot.push(label + ' (' + cpRenameErr_(e) + ')'); }
  });
  cpRenameBooks_().forEach(function (spec) {
    var opened, n;
    try { opened = cpRenameBookSheet_(spec); } catch (eO) { plan.cannot.push(spec.book + ' (' + cpRenameErr_(eO) + ')'); return; }
    var scope = '';
    try { scope = cacheScopeSheet_(opened.id, opened.tab); } catch (eS) { scope = ''; }
    try { n = take(spec.book, opened.sheet, scope, spec); } catch (eR) { plan.cannot.push(spec.book + ' (' + cpRenameErr_(eR) + ')'); return; }
    if (n === 0 && spec.master) plan.notes.push('The Asa Client Database Master has no row for this client, so only the other books carry the new name.');
    if (n > 0 && cpRenameAccess_(opened.id) === 'view') plan.cannot.push(spec.book + ' (the Hub may only view it)');
  });
  if (newKey !== ctx.key) {
    try {
      var pm = hubTabSheet_('med_patients');
      if (pm && cpRenameScan_({ key: ['client_key'] }, pm.getDataRange().getValues(), rn).cells.length) {
        plan.cannot.push('the pharmacy\'s patient match (House Supplies), which the relay keeps by the old key');
      }
    } catch (eP) { plan.cannot.push('the pharmacy\'s patient match (House Supplies) (' + cpRenameErr_(eP) + ')'); }
  }
  return plan;
}

/** 'view' when the Hub may only view the book; anything unreadable lets the write judge (cpRenameApply_ puts it back). */
function cpRenameAccess_(id) {
  try { return typeof paAccess_ === 'function' && id ? paAccess_(id) : 'unknown'; } catch (e) { return 'unknown'; }
}

function cpA1_(r, c) {
  var s = '';
  for (var n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s + r;
}

/** Writes a plan's cells, one call per tab and value; '' when all landed, else why — every cell written is put back. */
function cpRenameApply_(plan) {
  var sheets = [], groups = {}, order = [];
  plan.writes.forEach(function (w) {
    var si = sheets.indexOf(w.sheet);
    if (si === -1) { si = sheets.length; sheets.push(w.sheet); }
    var g = si + '\u0000' + String(w.after);
    if (!groups[g]) { groups[g] = []; order.push(g); }
    groups[g].push(w);
  });
  var done = [], failed = '';
  for (var i = 0; i < order.length && !failed; i++) {
    var list = groups[order[i]], sheet = list[0].sheet, value = hubCellSafe_(String(list[0].after));
    try {
      if (list.length > 1 && typeof sheet.getRangeList === 'function') {
        sheet.getRangeList(list.map(function (w) { return cpA1_(w.r, w.c); })).setValue(value);
        done = done.concat(list);
      } else {
        list.forEach(function (w) { sheet.getRange(w.r, w.c).setValue(value); done.push(w); });
      }
    } catch (e) { failed = list[0].book + ' could not be written (' + cpRenameErr_(e) + ')'; }
  }
  var stuck = 0;
  if (failed) {
    done.slice().reverse().forEach(function (w) {
      try { w.sheet.getRange(w.r, w.c).setValue(w.before); } catch (eB) { stuck++; }
    });
  }
  var bumped = {};
  done.forEach(function (w) {
    if (!w.scope || bumped[w.scope]) return;
    bumped[w.scope] = true;
    try { cacheBump_(w.scope); } catch (eC) { /* heals on its clock */ }
  });
  if (!failed) return '';
  return stuck ? 'The rename stopped: ' + failed + ', and ' + stuck + ' cells written before it could not be put back.'
               : 'Nothing was renamed: ' + failed + ', so every cell written before it was put back.';
}

/** Every cached answer of the old and the new key, the roster, the Master's index and the client's house. */
function cpRenameBump_(ctx, newKey) {
  var reads = ['clientProfileDetails', 'clientProfileCare', 'clientProfileMeds', 'clientProfileIncidents',
               'clientProfileActivity'];
  cpBump_(ctx.key, reads);
  if (newKey !== ctx.key) cpBump_(newKey, reads);
  cacheBump_('cp_clientProfileRoster_all');
  try { cacheBump_(cacheScopeSheet_(cpClientDbId_(), CP_MASTER_TAB)); } catch (eM) { /* heals on its clock */ }
  try { cacheBump_(cacheScopeSheet_(cpClientDbId_(), CP_ARCHIVE_TAB)); } catch (eA) { /* heals on its clock */ }
  var row = ctx.row || {};
  var code = locationsHouseCode_(row.house || row.houseName) || locationsCode_(row.house || row.houseName);
  if (code) { locationsBump_('locationOverview', code); locationsBump_('locationStaff', code); }
}

// Status: the client set Active or Inactive.
HUB_POLICY.clientProfileStatus = {
  file: 'ClientProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['clients'], emits: [],
  params: { client: { type: 'string' }, changes: { type: 'array' } }
};
HUB_ACTIONS.clientProfileStatus = function (payload, user) {
  if (!clientProfilesGate_(user)) return clientProfilesUnknown_();
  if (!hubIsWriter_(user)) return hubDenied_();
  var first = clientProfilesClient_(payload && payload.client);
  if (first.refused) return first.refused;
  var one = cpOneChange_(payload, 'status');
  if (one.error) return one.error;
  var want = /^active$/i.test(one.change.value) ? 'Active' : (/^(inactive|archived)$/i.test(one.change.value) ? 'Inactive' : '');
  if (!want) return { status: 400, message: 'status: Active or Inactive.' };
  var held = sheetDbGateHolds_('clients', 'update');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return cpBusy_();
  var ctx, before, notes = [];
  try {
    ctx = clientProfilesClient_(payload && payload.client);
    if (ctx.refused) return ctx.refused;
    before = cpStatusWord_(ctx);
    var stale = hubEditWitness_('status', one.change.expected, before);
    if (stale) {
      return { status: 409, message: stale.message,
               data: { written: [], refused: one.refused, current: { status: stale.data.current } } };
    }
    if (want === before) return { status: 200, data: { written: [], refused: one.refused, client_key: ctx.key } };
    var move = want === 'Inactive' ? cpBookMove_(ctx.name, CP_MASTER_TAB, CP_ARCHIVE_TAB)
                                   : cpBookMove_(ctx.name, CP_ARCHIVE_TAB, CP_MASTER_TAB);
    if (move.why) return { status: 409, message: move.why };
    if (move.absent) notes.push('Neither the Master nor the archive of old clients holds a row for this client; only the Hub record moved.');
    var got = cpStatusHubRow_(ctx, want === 'Active' ? 'active' : 'inactive');
    if (got) return got;
  } finally { lock.releaseLock(); }
  cpRenameBump_(ctx, ctx.key);
  hubEditLog_(user, 'clientProfileStatus', ctx.key, [{ field: 'status', before: before, after: want }], ['status']);
  return { status: 200, data: { written: ['status'], refused: one.refused, client_key: ctx.key, notes: notes } };
};

/** The client's Hub row takes `status` (made when there is none); the refusal, or null. */
function cpStatusHubRow_(ctx, status) {
  var target = null;
  try {
    listRows_('clients', {}).forEach(function (r) {
      var k = String(r.client_key || '').trim() || clientNameKey_(r.name);
      if (!target && k === ctx.key) target = r;
    });
  } catch (eC) {
    return { status: 503, message: 'The clients tab could not be read just now (' + String((eC && eC.message) || eC).slice(0, 120) + ').' };
  }
  var res = target ? updateRowById_('clients', { id: target.id, status: status })
                   : createRow_('clients', { id: 'CLI_' + ctx.key, client_key: ctx.key, name: ctx.name, status: status });
  return sheetDbRefused_(res);
}

/** A client book tab of the Asa Client Database; throws when it cannot be opened. */
function cpBookSheet_(tab) {
  if (tab === CP_MASTER_TAB) return cpMasterSheet_();
  var sheet = ssOpen_(cpClientDbId_()).getSheetByName(tab);
  if (!sheet) throw new Error('the book has no ' + tab + ' tab');
  return sheet;
}

// The row whose client cell folds to `name` moved from one Asa Client Database tab to the other, column by folded…
function cpBookMove_(name, from, to) {
  try {
    var src = cpBookSheet_(from), dst = cpBookSheet_(to);
    var sv = src.getDataRange().getValues(), dv = dst.getDataRange().getValues();
    var hit = cpBookRowOf_(sv, name), there = cpBookRowOf_(dv, name);
    if (hit.twin) return { why: 'Two rows of the ' + from + ' tab carry this name, so neither was moved.' };
    if (hit.absent) return there.absent ? { absent: true } : { done: true };
    if (!there.absent) return { why: 'The ' + to + ' tab already holds a row with this name, so nothing was moved.' };
    var dHead = (dv[0] || []).map(cpFold_), sHead = (sv[0] || []).map(cpFold_);
    // a header the other tab spells differently (Client / Customer) lands under the column of the same field
    var fieldOf = function (h) { return CP_BOOK_FIELDS[h] || (CP_BOOK_MASKED[h] ? '#' + CP_BOOK_MASKED[h] : ''); };
    var line = dHead.map(function () { return ''; }), lost = [];
    sHead.forEach(function (h, i) {
      var v = sv[hit.at][i];
      if (v === '' || v === null || v === undefined) return;
      var j = h ? dHead.indexOf(h) : -1;
      if (j === -1 && fieldOf(h)) j = dHead.map(fieldOf).indexOf(fieldOf(h));
      if (j === -1) lost.push(String(sv[0][i]));
      else if (line[j] === '') line[j] = v;
    });
    if (lost.length) return { why: 'The ' + to + ' tab has no column for ' + lost.slice(0, 5).join(', ') + ', so nothing was moved.' };
    dst.appendRow(line);
    try { src.deleteRow(hit.at + 1); }
    catch (eD) {
      try { dst.deleteRow(dst.getLastRow()); } catch (eU) { /* the appended row stays; the index marks the name twice */ }
      throw eD;
    }
    return { done: true };
  } catch (e) {
    return { why: 'The Asa Client Database could not be written (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
}

// The Hub's own correction to a family member or a care row the plan gives (or one the Hub adds), filed in…
HUB_POLICY.clientProfileOverride = {
  file: 'ClientProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' }, kind: { type: 'string' }, tab: { type: 'string' }, target: { type: 'string' },
            changes: { type: 'array' } }
};
HUB_ACTIONS.clientProfileOverride = function (payload, user) {
  var kind = locationsText_(payload && payload.kind).toLowerCase();
  // a care row is also clients.care's (Settings › Editions); a family member stays the master's
  var shut = kind === 'care' ? cpProfileEditDoor_(payload, user, CP_EDITION_CARE)
    : (!clientProfilesGate_(user) ? clientProfilesUnknown_() : (hubIsWriter_(user) ? null : hubDenied_()));
  if (shut) return shut;
  var ctx = clientProfilesClient_(payload && payload.client);
  if (ctx.refused) return ctx.refused;
  if (!CP_OVERRIDE_FIELDS[kind]) return { status: 400, message: 'kind: care or family.' };
  var tab = kind === 'care' ? locationsText_(payload && payload.tab).toLowerCase() : '';
  if (kind === 'care' && CP_OVERRIDE_TABS.indexOf(tab) === -1) {
    return { status: 400, message: 'tab: one of ' + CP_OVERRIDE_TABS.join(', ') + '.' };
  }
  var target = locationsText_(payload && payload.target, 200);
  var asked = hubEditChanges_(payload);
  if (asked.refused) return asked.refused;
  var live = cpOverrideLive_(ctx, kind, tab, target);
  if (live.refused) return live.refused;
  var allowed = CP_OVERRIDE_FIELDS[kind], next = {}, written = [], refused = [], stale = {};
  allowed.forEach(function (f) { next[f] = live.edit[f] || ''; });
  asked.changes.forEach(function (c) {
    if (allowed.indexOf(c.field) === -1) { refused.push({ field: c.field, why: 'Not a field this record edits.' }); return; }
    var held = hubEditWitness_(c.field, c.expected, live.edit[c.field]);
    if (held) { stale[c.field] = held.data.current; return; }
    var value = c.field === 'text' ? c.value.replace(/\r/g, '').slice(0, CP_SECTION_MAX)
                                   : c.value.replace(/\s+/g, ' ').slice(0, 500);
    if (c.field === 'removed') value = /^(yes|true|1)$/i.test(value) ? 'Yes' : '';
    next[c.field] = value;
    written.push({ field: c.field, before: c.expected, after: value });
  });
  var title = kind === 'care' ? 'record' : 'name';
  if (written.length && !next[title] && next.removed !== 'Yes') {
    refused = refused.concat(written.map(function (w) { return { field: w.field, why: 'A ' + kind + ' record needs its ' + title + '.' }; }));
    written = [];
  }
  var id = '';
  if (written.length) {
    var got = cpOverrideWrite_(ctx, kind, tab, live.target, live.id, next, user);
    if (got.refused) return got.refused;
    id = got.id;
    hubEditLog_(user, 'clientProfileOverride', id, written, []);
  }
  var data = { written: written.map(function (w) { return w.field; }), refused: refused, id: id };
  if (Object.keys(stale).length) {
    data.current = stale;
    return { status: 409, data: data, message: 'Changed since the panel was opened — reloaded, nothing was written.' };
  }
  return kind === 'care' ? cpEditSteps_({ status: 200, data: data }, 'care') : { status: 200, data: data };
};

// What the record shows now, as its read sends it: { edit, target, id } — `target` the plan row or member the…
function cpOverrideLive_(ctx, kind, tab, target) {
  var blank = {};
  CP_OVERRIDE_FIELDS[kind].forEach(function (f) { blank[f] = ''; });
  if (!target) return { edit: blank, target: '', id: '' };
  var shown = null;
  try {
    if (kind === 'family') {
      var isp = cpIspRow_(ctx.key), people = null;
      try { people = cpPeopleIndex_(); } catch (eP) { people = null; }
      cpFamily_(ctx, isp, people).forEach(function (m) { if (!shown && m.key === target) shown = m; });
    } else {
      cpCareBuild_(ctx, tab).rows.forEach(function (r) { if (!shown && r.id === target && r.edit) shown = r; });
    }
  } catch (e) {
    return { refused: { status: 503, message: 'The record could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' } };
  }
  if (!shown) return { refused: { status: 404, message: 'That record is no longer on this client\'s profile — reload it.' } };
  shown = cpScrub_(shown);
  var edit = {};
  CP_OVERRIDE_FIELDS[kind].forEach(function (f) {
    edit[f] = f === 'text' ? String(shown.text || '') : String((shown.edit && shown.edit[f]) || '');
  });
  var mine = cpOverridesFor_(ctx.key, kind);
  var added = /^CO_/.test(target) ? mine.filter(function (o) { return String(o.id) === target && !o.target; })[0] : null;
  if (added) return { edit: edit, target: '', id: String(added.id) };
  var over = mine.filter(function (o) { return String(o.target) === target && String(o.tab || '') === tab; })[0];
  return { edit: edit, target: target, id: over ? String(over.id) : '' };
}

/** Files one override row (made, or updated in place by its id) under the lock: { id } or { refused }. */
function cpOverrideWrite_(ctx, kind, tab, target, id, next, user) {
  if (!cpTabHomed_(CP_OVERRIDES_TAB)) return { refused: cpTabUnhomed_(CP_OVERRIDES_TAB) };
  var held = sheetDbGateHolds_(CP_OVERRIDES_TAB, 'update');
  if (held) return { refused: held.error };
  var lock = locationsLock_();
  if (!lock) return { refused: cpBusy_() };
  var rowId = id || ('CO_' + ctx.key + '_' + kind + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 10));
  try {
    var sheet;
    try { sheet = hubTabEnsure_(CP_OVERRIDES_TAB, CP_OVERRIDES_HEADER); }
    catch (eS) { return { refused: { status: 503, message: 'The client_overrides store is not set up (' + String((eS && eS.message) || eS).slice(0, 120) + ').' } }; }
    var head = ensureHeader_(sheet, CP_OVERRIDES_HEADER);
    var rec = { id: rowId, client_key: ctx.key, kind: kind, tab: tab, target: target,
                state: next.removed === 'Yes' ? 'removed' : '', by: locationsWho_(user), at: new Date().toISOString() };
    CP_OVERRIDE_FIELDS[kind].forEach(function (f) { if (f !== 'removed') rec[f] = next[f]; });
    var line = head.map(function (h) { return hubCellSafe_(rec[h] === undefined || rec[h] === null ? '' : String(rec[h])); });
    var values = sheet.getDataRange().getValues();
    var at = -1;
    for (var r = 1; r < values.length; r++) { if (String(values[r][head.indexOf('id')]) === rowId) { at = r; break; } }
    if (at === -1) sheet.appendRow(line);
    else sheet.getRange(at + 1, 1, 1, line.length).setValues([line]);
  } finally { lock.releaseLock(); }
  cacheBump_(cpTabScope_(CP_OVERRIDES_TAB));
  cpBump_(ctx.key, ['clientProfileCare', 'clientProfileDetails']);
  return { id: rowId };
}

/** An incident's review status (Reported, Under review, Closed), kept in incident_reviews by client_key|incident_ts. */
HUB_POLICY.clientProfileIncidentStatus = {
  file: 'ClientProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' }, incident_ts: { type: 'string' }, client_name: { type: 'string' },
            status: { type: 'string' } }
};
HUB_ACTIONS.clientProfileIncidentStatus = function (payload, user) {
  if (!clientProfilesGate_(user)) return clientProfilesUnknown_();
  if (!hubIsWriter_(user)) return hubDenied_();
  var ctx = clientProfilesClient_(payload && payload.client);
  if (ctx.refused) return ctx.refused;
  var status = locationsText_(payload && payload.status);
  var hit = null;
  CP_INCIDENT_STATUSES.forEach(function (s) { if (!hit && s.toLowerCase() === status.toLowerCase()) hit = s; });
  if (!hit) return { status: 400, message: 'status: one of ' + CP_INCIDENT_STATUSES.join(', ') + '.' };
  var ts = locationsText_(payload && payload.incident_ts, 80);
  if (!ts) return { status: 400, message: 'incident_ts: the report\'s timestamp.' };
  var witness = locationsText_(payload && payload.client_name, 200);
  if (!witness || clientNameKey_(witness) !== clientNameKey_(ctx.name)) {
    return { status: 409, message: 'That incident is not this client\'s any more — reload the incidents.' };
  }
  var found;
  try {
    found = locationsIncidentsFor_(estateRows_('uiIncidents'), [{ client_key: ctx.key, name: ctx.name }])
      .some(function (j) { return String((j.row && j.row.timestamp) || '') === ts; });
  } catch (eR) {
    return { status: 503, message: 'The incidents could not be read just now (' + String((eR && eR.message) || eR).slice(0, 120) + ').' };
  }
  if (!found) return { status: 404, message: 'No incident of this client was reported at ' + ts + '.' };
  if (!cpTabHomed_(CP_REVIEWS_TAB)) return cpTabUnhomed_(CP_REVIEWS_TAB);
  var held = sheetDbGateHolds_(CP_REVIEWS_TAB, 'update');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return { status: 409, message: 'Another write is in progress — try again in a moment.' };
  var rec;
  try {
    var sheet;
    try { sheet = hubTabEnsure_(CP_REVIEWS_TAB, CP_REVIEWS_HEADER); }
    catch (eS) { return { status: 503, message: 'The incident reviews store is not set up (' + String((eS && eS.message) || eS).slice(0, 120) + ').' }; }
    var head = ensureHeader_(sheet, CP_REVIEWS_HEADER);
    var id = ctx.key + '|' + ts;
    rec = { id: id, client_key: ctx.key, client_name: ctx.name, incident_ts: ts, status: hit,
            by: locationsWho_(user), at: new Date().toISOString() };
    var values = sheet.getDataRange().getValues();
    var at = -1;
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][head.indexOf('id')] || '').trim() === id) { at = r; break; }
    }
    if (at === -1) {
      sheet.appendRow(head.map(function (h) { return hubCellSafe_(rec[h] === undefined ? '' : String(rec[h])); }));
    } else {
      sheet.getRange(at + 1, head.indexOf('status') + 1).setValue(hit);
      sheet.getRange(at + 1, head.indexOf('by') + 1).setValue(hubCellSafe_(rec.by));
      sheet.getRange(at + 1, head.indexOf('at') + 1).setValue(rec.at);
    }
  } finally { lock.releaseLock(); }
  cacheBump_(cpTabScope_(CP_REVIEWS_TAB));
  cpBump_(ctx.key, ['clientProfileIncidents']);
  hubSysLog_(str_(user.email), 'clientProfileIncidentStatus', ctx.key, { status: 200 });
  return { status: 200, data: { saved: true, row: rec } };
};

/** The appointment pencil: the estate's header-bound update of the Dr Appt Archive, the client's name as the witness; no delete. */
HUB_POLICY.clientProfileApptSave = {
  file: 'ClientProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' }, id: { type: 'string' }, witness: { type: 'string' }, fields: {} }
};
HUB_ACTIONS.clientProfileApptSave = function (payload, user) {
  if (!clientProfilesGate_(user)) return clientProfilesUnknown_();
  if (!hubIsWriter_(user)) return hubDenied_();
  var ctx = clientProfilesClient_(payload && payload.client);
  if (ctx.refused) return ctx.refused;
  var id = locationsText_(payload && payload.id, 20);
  if (!/^r\d+$/.test(id)) return { status: 400, message: 'id: the visit\'s row, such as r42.' };
  var witness = String((payload && payload.witness) || '');
  var wk = witness.trim() ? clientNameKey_(witness) : '';
  if (!wk || cpNamesOf_(ctx)[wk] !== true) {
    return { status: 409, message: 'That visit is not this client\'s any more — reload the appointments.' };
  }
  var raw = payload && payload.fields;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { status: 400, message: 'fields: what to change.' };
  var patch = { id: id, witness: witness }, unknown = [], n = 0;
  Object.keys(raw).forEach(function (k) {
    var col = CP_APPT_FIELDS[k];
    if (!col) { unknown.push(k); return; }
    var v = raw[k];
    if (col === 'wheelchair_van_required') v = (v === true || /^(y|yes|true|1)$/i.test(String(v))) ? 'Yes' : 'No';
    patch[col] = String(v == null ? '' : v).trim().slice(0, 300);
    n++;
  });
  if (unknown.length) return { status: 422, message: 'Not an appointment field: ' + unknown.join(', ') + '.' };
  if (!n) return { status: 400, message: 'fields: nothing to save.' };
  var res = estateRoute_('drVisits', 'update', patch, user);
  if (!res || res.status !== 200) return res || { status: 503, message: 'The visit could not be saved just now.' };
  CLIENT_APPT_INDEX_ = null;
  cpBump_(ctx.key, ['clientProfileActivity']);
  hubSysLog_(str_(user.email), 'clientProfileApptSave', ctx.key, { status: 200 });
  return { status: 200, data: { saved: true, row: cpScrub_(cpApptRow_(res.data || {}, ctx, locationsToday_())) } };
};

/** Every name key the client is spelled by, the rule clientSourceAppointments matches visit rows with. */
function cpNamesOf_(ctx) {
  var names = {};
  var own = clientNameKey_(ctx.name);
  if (own) names[own] = true;
  try {
    var id = hubClientIdentity_(ctx.key);
    for (var n in (id && id.names) || {}) if (id.names[n]) names[n] = true;
  } catch (e) { /* the name alone still identifies */ }
  return names;
}

/** The filed plans in the order Read the plans takes them (by client name), and the clients whose sections are filed. */
function cpIspPlans_() {
  var plans = listRows_('isps', {}).filter(function (r) { return !!String(r.client_key || '').trim(); });
  var filed = {};
  cpOwnRows_(CP_SECTIONS_TAB).forEach(function (r) { filed[String(r.client_key || '')] = true; });
  plans.sort(function (a, b) { return String(a.client_name || '').localeCompare(String(b.client_name || '')); });
  return { plans: plans, filed: filed };
}

// The one builder of Read the plans and its sweep: re-decode one filed plan through the relay and file its sections.
function cpIspSectionsFile_(plan, files) {
  var key = String(plan.client_key).trim();
  var source = String(plan.source_file || '');
  var file = null;
  (files || ispIntakeFiles_()).forEach(function (f) { if (!file && f.name === source) file = f; });
  if (!file) return { refused: { status: 404, message: 'The plan\'s file is not in the plans folder any more.' } };
  var env = ispIntakeDecode_(file);
  if (!env || env.status !== 200 || !env.data) {
    return { refused: { status: 502, message: 'The plan could not be read: ' +
                        String((env && env.message) || 'no answer from the relay') } };
  }
  // A plan with none of the sections is refused before any write: never counted filed, never a blank over filed rows.
  var cut = clientProfileIspCut_(String(env.data.raw_text || ''));
  if (!cut.rows.length) return { refused: { status: 422, message: 'The plan carries none of the sections.' } };
  var got = cpSectionsFileCut_(key, String(plan.isp_year || ''), source, cut);
  if (got.refused) return { refused: got.refused };
  return { key: key, source: source, got: got };
}

// Read the plans: re-decode one filed plan through the relay and file its sections (isp_sections only, the client's…
HUB_POLICY.clientProfileIspSections = {
  file: 'ClientProfiles.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' } }
};
HUB_ACTIONS.clientProfileIspSections = function (payload, user) {
  if (!clientProfilesGate_(user)) return clientProfilesUnknown_();
  var asked = locationsText_(payload && payload.client, 120);
  var ctx = null;
  if (asked) {
    ctx = clientProfilesClient_(asked);
    if (ctx.refused) return ctx.refused;
  }
  var book;
  try { book = cpIspPlans_(); }
  catch (e) {
    return { status: 503, message: 'The plans could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
  var plans = book.plans, filed = book.filed;
  var plan = null;
  if (ctx) {
    plans.forEach(function (r) { if (!plan && String(r.client_key).trim() === ctx.key) plan = r; });
    if (!plan) return { status: 404, message: 'No plan is filed for this client.' };
  } else {
    plans.forEach(function (r) { if (!plan && !filed[String(r.client_key).trim()]) plan = r; });
    if (!plan) return { status: 200, data: { filed: '', pending: 0, note: 'Every filed plan already has its sections.' } };
  }
  var done = cpIspSectionsFile_(plan);
  if (done.refused) return done.refused;
  filed[done.key] = true;
  var pending = plans.filter(function (r) { return !filed[String(r.client_key).trim()]; }).length;
  hubSysLog_(str_(user.email), 'clientProfileIspSections', done.key, { status: 200 });
  return { status: 200, data: { filed: locationsText_(plan.client_name), client_key: done.key,
                                isp_year: String(plan.isp_year || ''), source_file: done.source, rows: done.got.rows,
                                sections: done.got.sections, absent: done.got.absent, pending: pending } };
};

/** The plans the sweep could not file: client key → { n: tries, next: epoch ms of the next try, status }. */
function cpIspSweepTries_() {
  var raw = '';
  try { raw = String(hubProp_(CP_ISP_SWEEP_TRIES_PROP) || ''); } catch (e) { raw = ''; }
  var map = {};
  try { map = raw ? JSON.parse(raw) : {}; } catch (eJ) { map = {}; }
  if (Object.prototype.toString.call(map) !== '[object Object]') map = {};
  return { raw: raw, map: map };
}

function cpIspSweepTriesSave_(map) {
  try { return hubPropSet_(CP_ISP_SWEEP_TRIES_PROP, JSON.stringify(map)); } catch (e) { return false; }
}

// The digest pass's share of Read the plans: up to CP_ISP_SWEEP_PER_PASS plans with no sections, in the action's…
function clientIspSectionsSweep_(left) {
  var out = { filed: 0, failed: 0, waiting: 0, shut: false };
  var low = function () { return typeof left === 'function' && left() < CP_ISP_SWEEP_FLOOR_MS; };
  if (low()) return out;
  var book = cpIspPlans_();
  var tries = cpIspSweepTries_();
  var now = new Date().getTime();
  var kept = {}, due = [], seen = {};
  book.plans.forEach(function (r) {
    var key = String(r.client_key).trim();
    if (book.filed[key] || seen[key]) return;
    seen[key] = true;
    var t = tries.map[key];
    if (t) kept[key] = t;
    if (t && now < Number(t.next || 0)) out.waiting++;
    else due.push(r);
  });
  var files = null;
  for (var i = 0; i < due.length && out.filed + out.failed < CP_ISP_SWEEP_PER_PASS; i++) {
    if (low()) break;
    if (!files) {
      files = ispIntakeFiles_();
      if (!files.length) { out.shut = true; break; }
    }
    var key = String(due[i].client_key).trim();
    var done;
    try { done = cpIspSectionsFile_(due[i], files); }
    catch (e) { done = { refused: { status: 500, message: String((e && e.message) || e).slice(0, 120) } }; }
    if (!done.refused) {
      delete kept[key];
      out.filed++;
      continue;
    }
    var n = (Number(kept[key] && kept[key].n) || 0) + 1;
    var wait = Math.min(CP_ISP_SWEEP_WAIT_MS * Math.pow(2, n - 1), CP_ISP_SWEEP_WAIT_CAP_MS);
    var status = Number(done.refused.status) || 500;
    kept[key] = { n: n, next: now + wait, status: status };
    out.failed++;
    try {
      hubSysLog_('auto-digest', 'clientIspSectionsSweep', key,
                 { status: status, message: String(done.refused.message || '').slice(0, 200) + ' (try ' + n +
                                            '; again in ' + Math.round(wait / 3600000) + 'h)' });
    } catch (eL) { /* the pass's line still counts it */ }
  }
  if (JSON.stringify(kept) !== tries.raw) cpIspSweepTriesSave_(kept);
  return out;
}
