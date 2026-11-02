// Clients are derived from the isps tab (the plans are the authority); hand-typed `clients` rows layer on top by…
// The directory table shows identity only; the row also carries the chart, served from the slice (same roles as…

var CLIENTS_FROM_ISPS_CACHE_KEY = 'clients_from_isps_v1';

// Letters and digits only — the same collision rule the people merge uses.
function clientNameKey_(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function ispClientNameKeys_() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(CLIENTS_FROM_ISPS_CACHE_KEY);
    if (hit) return JSON.parse(hit);
  } catch (e) {}
  var keys = {};
  try {
    listRows_('isps', {}).forEach(function (r) {
      var k = clientNameKey_(r.client_name);
      if (k) keys[k] = true;
    });
  } catch (e2) {
    return {};   // no isps tab: nothing is a client, which is the safe state
  }
  try { cache.put(CLIENTS_FROM_ISPS_CACHE_KEY, JSON.stringify(keys), 300); } catch (e3) {}
  return keys;
}

function withoutIspClients_(rows) {
  var clientKeys = ispClientNameKeys_();
  if (!rows || !rows.length) return rows;
  return rows.filter(function (r) {
    var k = clientNameKey_(r && r.name);
    return !(k && clientKeys[k]);
  });
}

function ispStripLabel_(line, labels) {
  var s = String(line || '').trim();
  for (var i = 0; i < labels.length; i++) {
    var re = new RegExp('^' + labels[i].replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '\\s*:?\\s*', 'i');
    if (re.test(s)) return s.replace(re, '').trim();
  }
  return s;
}

function parseGuardianFromContacts_(contacts) {
  var lines = String(contacts || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
  for (var i = 0; i < lines.length; i++) {
    if (/^guardian/i.test(lines[i]) || /guardianship/i.test(lines[i])) {
      return ispStripLabel_(lines[i], ['Guardian', 'Legal guardian', 'Guardianship of person', 'Guardianship']);
    }
  }
  return '';
}

// The guardian's segment is cut at the NEXT person's label, so another person's e-mail or phone is never taken.
var ISP_CONTACT_NEXT_LABEL = /(^|[\s.;,])(case manager|ssa|physician|pcp|doctor|father|mother|parent|sibling|brother|sister|emergency|payee|provider|home provider|employer|advocate|friend|roommate|nurse|therapist|dentist|pharmacy|other)\s*:/i;

function guardianContactSegment_(contacts) {
  var lines = String(contacts || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
  for (var i = 0; i < lines.length; i++) {
    if (!/^guardian/i.test(lines[i]) && !/guardianship/i.test(lines[i])) continue;
    var seg = lines[i];
    var m = ISP_CONTACT_NEXT_LABEL.exec(seg.replace(/^guardian[^:]*:/i, function (s) {
      return s.replace(/./g, ' ');   // blank the OWN label so it is not the cut
    }));
    if (m) seg = seg.slice(0, m.index);
    return seg;
  }
  return '';
}

function guardianEmailFromContacts_(contacts) {
  var seg = guardianContactSegment_(contacts);
  var m = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(seg);
  if (!m) return '';
  var email = m[0].replace(/[.,;]+$/, '');
  return ispEmailWhole_(email) ? email : '';
}

function guardianPhoneFromContacts_(contacts) {
  var seg = guardianContactSegment_(contacts);
  var m = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.exec(seg);
  if (!m) return '';
  var digits = m[0].replace(/\D/g, '');
  if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
  return digits.length === 10 ? ispPhone_(digits) : '';
}

function cleanGuardianName_(raw) {
  var s = String(raw || '').trim();
  if (!s) return '';
  // a leaked contacts-table header names nobody
  if (/person supported\s*\/\s*family/i.test(s)) return '';
  s = ispStripLabel_(s, ['Guardian', 'Legal guardian', 'Guardianship of person', 'Guardianship']);
  s = s.split(/\s+[-–—]\s+/)[0];
  s = s.replace(/,\s+(his|her|their|who|and|a|the)\b[\s\S]*$/i, '');
  s = s.replace(/[.,;:\s]+$/, '');
  if (s.length > 48) s = s.slice(0, 47) + '…';
  return s;
}

function shortSupervision_(raw) {
  var s = String(raw || '').trim();
  if (!s) return '';
  if (/24\s*\/?\s*7|around.the.clock|constant/i.test(s)) return '24/7 supervision';
  var first = s.split(/[.;\n]|\s+per\s+/i)[0].trim();
  if (first.length > 36) first = first.slice(0, 35) + '…';
  return first;
}

// Split on newlines and bullets, never commas: diagnosis phrases contain commas.
function ispBulletList_(text, max, itemCap) {
  var maxN = max || 8;
  var cap = itemCap || 64;
  return String(text || '')
    .split(/\n+|(?:^|\s)[•·]\s+/)
    .map(function (s) { return s.replace(/^[\s•·\-–]+/, '').trim(); })
    .filter(function (s) { return s.length > 3 && s.length < 200; })
    .map(function (s) { return s.length > cap ? s.slice(0, cap - 1) + '…' : s; })
    .slice(0, maxN);
}

// A date is cut, never re-parsed: new Date('yyyy-MM-dd') is midnight UTC, the previous day in Ohio.
function apptDay_(v) {
  var s = String(v || '').trim();
  var iso = /^(\d{4}-\d{2}-\d{2})(?:[T\s]|$)/.exec(s);
  if (iso) return iso[1];
  var us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (us) {
    return us[3] + '-' + ('0' + us[1]).slice(-2) + '-' + ('0' + us[2]).slice(-2);
  }
  var t = Date.parse(s);
  if (t) {
    var d = new Date(t);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  return '';
}

function clientToday_() {
  return Utilities.formatDate(new Date(), hiringTimeZone_(), 'yyyy-MM-dd');
}
function clientDaysAgo_(n) {
  var d = new Date();
  d.setDate(d.getDate() - n);
  return Utilities.formatDate(d, hiringTimeZone_(), 'yyyy-MM-dd');
}

var CLIENT_RECENT_APPT_DAYS = 60;

// A past day is history (a cancelled one is neither list); an unreadable day stays upcoming so a visit is not missed.
function apptBucket_(day, status, today, floor) {
  var st = String(status || '').toLowerCase();
  if (day && day < today) {
    if (st === 'cancelled' || st === 'canceled') return '';
    return day >= floor ? 'recent' : '';
  }
  if (st && st !== 'scheduled' && st !== 'rescheduled') return '';
  return 'upcoming';
}

// Visits grouped by client key once per execution, never scanned per client.
var CLIENT_APPT_INDEX_ = null;

function clientApptIndex_() {
  if (CLIENT_APPT_INDEX_) return CLIENT_APPT_INDEX_;
  var by = {};
  var whole = false;
  try {
    // The booked visits are the form responses in Dr Appt Archive (estate source drVisits); Dr Master is the doctor roster.
    estateRows_('drVisits').forEach(function (r) {
      var k = clientNameKey_(String(r.client_name || '').trim());
      if (!k) return;
      if (!by[k]) by[k] = [];
      by[k].push(r);
    });
    whole = true;
  } catch (e) {
    // A read that threw is not an empty archive: an incomplete pass is never memoised.
    whole = false;
  }
  if (!whole) return by;
  CLIENT_APPT_INDEX_ = by;
  return by;
}

var CLIENT_APPT_WINDOW_ = null;

function clientApptWindow_() {
  if (!CLIENT_APPT_WINDOW_) {
    CLIENT_APPT_WINDOW_ = { today: clientToday_(), floor: clientDaysAgo_(CLIENT_RECENT_APPT_DAYS) };
  }
  return CLIENT_APPT_WINDOW_;
}

function clientApptBucketsFromDrTab_(clientName) {
  var nameKey = clientNameKey_(clientName);
  var win = clientApptWindow_();
  var today = win.today;
  var floor = win.floor;
  var upcoming = [];
  var recent = [];
  try {
    (clientApptIndex_()[nameKey] || []).forEach(function (r) {
      var date = String(r.appointment_date || '').trim();
      if (!date) return;
      var doctor = String(r.dr_name || '').trim();
      var appt = {
        id: String(r.id || 'appt-' + (upcoming.length + recent.length)),
        date: date,
        // The clock as the sheet wrote it, carried as text; never rebuilt from an instant.
        time: String(r.appointment_start_time || '').trim(),
        title: doctor || 'Doctor visit',
        doctor: doctor,
        location: String(r.appointment_address || ''),
        notes: String(r.wheelchair_van_required || '').match(/^y/i) ? 'Wheelchair van required' : '',
        status: String(r.upcoming || '')
      };
      var bucket = apptBucket_(apptDay_(date), '', today, floor);
      if (bucket === 'upcoming') upcoming.push(appt);
      else if (bucket === 'recent') recent.push(appt);
    });
  } catch (e) {}
  upcoming.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  recent.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  return { upcoming: upcoming, recent: recent };
}

// --- The plan itself: the signed PDF, not our reading of it --- Matched when the client's name key sits inside the…
var ISP_DOCS_CACHE_KEY = 'isp_docs_index_v1';
var ISP_DOCS_MEMO = null;

function ispDocIndex_() {
  if (ISP_DOCS_MEMO) return ISP_DOCS_MEMO;
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get(ISP_DOCS_CACHE_KEY);
    if (hit) { ISP_DOCS_MEMO = JSON.parse(hit); return ISP_DOCS_MEMO; }
  } catch (e) { cache = null; }

  var files = [];
  try {
    var it = DriveApp.getFolderById(hubId_('ISP_DOCS_FOLDER_ID')).getFiles();
    while (it.hasNext()) {
      var f = it.next();
      files.push({ id: f.getId(), name: f.getName() });
    }
  } catch (e2) {
    // An unreadable folder means no link, never a wrong one; not memoised.
    return {};
  }

  var index = {};
  ISP_DOCS_MEMO = { files: files, index: index };
  try { if (cache) cache.put(ISP_DOCS_CACHE_KEY, JSON.stringify(ISP_DOCS_MEMO), 21600); } catch (e3) {}
  return ISP_DOCS_MEMO;
}

function ispDocFor_(clientName) {
  var key = clientNameKey_(clientName);
  if (!key) return { id: '', name: '', url: '' };
  var idx = ispDocIndex_();
  var files = (idx && idx.files) || [];
  var hits = [];
  for (var i = 0; i < files.length; i++) {
    if (clientNameKey_(files[i].name).indexOf(key) !== -1) hits.push(files[i]);
  }
  // Fallback for names written the other way round: every word of the FILE name is in the client's name.
  if (!hits.length && typeof ispIntakeNameWords_ === 'function') {
    var mine = ispIntakeNameWords_(clientName);
    for (var j = 0; j < files.length; j++) {
      var want = ispIntakeNameWords_(files[j].name);
      if (!want.length) continue;
      var all = true;
      for (var w = 0; w < want.length; w++) {
        if (mine.indexOf(want[w]) === -1) { all = false; break; }
      }
      if (all) hits.push(files[j]);
    }
  }
  if (hits.length !== 1) return { id: '', name: '', url: '' };
  return {
    id: hits[0].id,
    name: hits[0].name,
    url: 'https://drive.google.com/file/d/' + hits[0].id + '/view'
  };
}

// --- Demographics, read off the plan's Contact Information page (contact_block) --- Nothing is invented: a field…

var ISP_CONTACT_LABELS = ['Name', 'Preferred Name', 'Date of Birth', 'Address',
  'City, State, Zip', 'County', 'Email', 'Phone', 'Status', 'Sex', 'Medicaid #',
  'Funding Sources', 'Best way to connect', 'Additional Information', 'DODD #'];

// A known ending is the only proof an extracted e-mail is whole rather than wrapped.
var ISP_EMAIL_TLDS = ['com', 'org', 'net', 'edu', 'gov', 'us', 'co', 'io',
  'info', 'biz', 'health', 'care', 'services'];

// Closed and longest first, so 'Guardianship of Person' is never cut short to 'Guardian'.
var ISP_PEOPLE_ROLES = ['Guardianship of Person', 'Emergency Contact', 'Medical Provider',
  'Power of Attorney', 'Home Provider', 'Legal Guardian', 'Case Manager',
  'Guardian & Type', 'Guardian', 'Provider', 'Family', 'Friend', 'Parent',
  'Sibling', 'Advocate', 'Payee', 'Doctor', 'Roommate', 'Employer'];

var ISP_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

function ispDate_(value) {
  var v = String(value || '').trim();
  var m = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(v);
  if (m) {
    var mi = ISP_MONTHS.indexOf(m[1].toLowerCase());
    if (mi !== -1) {
      return m[3] + '-' + ('0' + (mi + 1)).slice(-2) + '-' + ('0' + m[2]).slice(-2);
    }
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1] : v;
}

function ispPhone_(value) {
  var d = String(value || '').replace(/\D/g, '');
  if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
  if (d.length !== 10) return String(value || '').trim();
  return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
}

// Stops at 'Important People' (its table repeats Address/Phone headers); first label wins; a value runs to the next label.
function ispContactLadder_(block) {
  var cut = String(block || '').indexOf('Important People');
  var text = cut > 0 ? block.slice(0, cut) : String(block || '');
  var lines = text.split('\n').map(function (s) { return s.trim(); });
  var at = [];
  for (var i = 0; i < lines.length; i++) {
    var bare = lines[i].replace(/:$/, '').trim();
    if (lines[i].slice(-1) === ':' && ISP_CONTACT_LABELS.indexOf(bare) !== -1) at.push([i, bare]);
  }
  // One-line labels: joining these to the cut swept table scraps into the value.
  var oneLine = { 'DODD #': true, 'Medicaid #': true, 'Phone': true, 'Email': true,
                  'County': true, 'Sex': true, 'Status': true, 'Date of Birth': true };
  var out = {};
  for (var n = 0; n < at.length; n++) {
    if (out.hasOwnProperty(at[n][1])) continue;
    var stop = n + 1 < at.length ? at[n + 1][0] : lines.length;
    var vals = lines.slice(at[n][0] + 1, stop).filter(String);
    out[at[n][1]] = (oneLine[at[n][1]] ? vals.slice(0, 1) : vals).join(' ').trim();
  }
  return out;
}

// A labelled cell ('Email: x') keeps only its value; the vocabulary is closed so a name ending in ':' survives.
var ISP_CELL_LABEL = /^(e-?mail|phone|cell(?:\s*phone)?|direct\s*line|work(?:\s*phone)?|home\s*phone|mobile|fax|tel(?:ephone)?)\s*[:\-–]\s*(.+)$/i;
function ispCellValue_(line) {
  var m = ISP_CELL_LABEL.exec(String(line || '').trim());
  return m ? m[2].trim() : String(line || '').trim();
}

function ispEmailWhole_(email) {
  var e = String(email || '');
  var dot = e.lastIndexOf('.');
  if (e.indexOf('@') === -1 || dot === -1) return false;
  return ISP_EMAIL_TLDS.indexOf(e.slice(dot + 1).toLowerCase()) !== -1;
}

// The fragment must complete a known ending, so a real `.co` followed by a street name is left alone.
function ispEmailGlue_(email, next) {
  var frag = String(next || '').trim();
  if (!frag || frag.length > 12 || !/^[A-Za-z0-9._\-]+$/.test(frag)) return '';
  var joined = String(email || '') + frag;
  return ispEmailWhole_(joined) ? joined : '';
}

// `Other - …` is a Type cell too and opens a new person; otherwise the next person's contacts join the previous row.
function ispRoleLine_(line) {
  var s = String(line || '').trim();
  if (ISP_PEOPLE_ROLES.indexOf(s) !== -1) return s;
  return /^Other\s*[-–—]\s*\S/.test(s) ? s : '';
}

function ispPeople_(block) {
  var start = String(block || '').indexOf('Important People');
  if (start === -1) return [];
  var skip = ['Important People', 'Type', 'Name/Relationship', 'Address', 'Phone'];
  var lines = block.slice(start).split('\n')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s && skip.indexOf(s.replace(/:$/, '')) === -1; });
  var people = [], cur = null, wrapped = null;
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    if (ispRoleLine_(ln)) {
      // A role word arriving before the entry has a name refines it ('Guardian & Type' then 'Guardianship of Person').
      if (cur && !cur.name) { cur.role = cur.role + ' — ' + ln; continue; }
      cur = { role: ln, name: '', address: '', email: '', phone: '' };
      people.push(cur);
      wrapped = null;
      continue;
    }
    if (!cur) continue;
    var val = ispCellValue_(ln);
    // The PDF wraps long e-mails onto the next line: glue the fragment the moment it arrives.
    if (wrapped === cur) {
      wrapped = null;
      var whole = ispEmailGlue_(cur.email, val);
      if (whole) { cur.email = whole; continue; }
    }
    if (/^[\d().+\-\s]{7,}$/.test(val)) { if (!cur.phone) cur.phone = val; }
    else if (val.indexOf('@') !== -1) {
      if (!cur.email) { cur.email = val; wrapped = ispEmailWhole_(val) ? null : cur; }
    }
    else if (!cur.name) cur.name = val;
    else cur.address = (cur.address + ' ' + val).trim();
  }
  return people;
}

function ispGuardianFromConsent_(text, clientName) {
  var m = /Person Supported\/Family\/Guardian:\s*(.+)/.exec(String(text || ''));
  if (!m) return '';
  var who = m[1].trim().replace(/[.,;]+$/, '');
  if (!who) return '';
  return clientNameKey_(who) === clientNameKey_(clientName) ? 'Self' : who;
}

function ispIdDigits_(value, maxLen) {
  var d = String(value || '').replace(/\D/g, '');
  if (!d || d.length < 4 || d.length > maxLen) return '';
  return d;
}

function ispDemographics_(block, clientName) {
  var text = String(block || '');
  if (!text) return {};
  var lad = ispContactLadder_(text);
  var people = ispPeople_(text);

  function matching(needles) {
    for (var i = 0; i < people.length; i++) {
      var hay = (people[i].role + ' ' + people[i].name).toLowerCase();
      for (var j = 0; j < needles.length; j++) {
        if (hay.indexOf(needles[j]) !== -1) return people[i];
      }
    }
    return {};
  }
  var ssa = matching(['ssa', 'case manager', 'support administrator']);
  var guardian = matching(['guardian']);
  var emergency = matching(['emergency']);

  var street = lad['Address'] || '';
  var csz = String(lad['City, State, Zip'] || '').replace(' ,', ',');
  var home = [street, csz].filter(String).join(', ').replace(/\s+/g, ' ').trim().replace(/,$/, '');

  return {
    dob: ispDate_(lad['Date of Birth'] || ''),
    home_address: home,
    county: lad['County'] || '',
    client_phone: ispPhone_(lad['Phone'] || ''),
    client_email: lad['Email'] || '',
    sex: lad['Sex'] || '',
    marital_status: lad['Status'] || '',
    // An id that is not id-shaped is refused rather than displayed.
    medicaid_id: ispIdDigits_(lad['Medicaid #'], 12),
    dodd_id: ispIdDigits_(lad['DODD #'], 9),
    funding_source: lad['Funding Sources'] || '',
    best_contact: lad['Best way to connect'] || '',
    guardian_name: guardian.name || ispGuardianFromConsent_(text, clientName),
    guardian_phone: ispPhone_(guardian.phone || ''),
    guardian_email: guardian.email || '',
    ssa_name: ssa.name || '',
    ssa_phone: ispPhone_(ssa.phone || ''),
    ssa_email: ssa.email || '',
    emergency_name: emergency.name || '',
    emergency_phone: ispPhone_(emergency.phone || '')
  };
}

// Routine, community and finances are absent on purpose: no isps column carries them.
function clientCareFromIsp_(r) {
  var personal = String(r.personal_care || '').trim();
  var mobility = String(r.mobility || '').trim();
  var daily = '';
  if (personal) daily += 'Personal care\n' + personal;
  if (mobility) daily += (daily ? '\n\n' : '') + 'Mobility\n' + mobility;
  return {
    care_communication: String(r.communication || '').trim(),
    care_safety: String(r.safety_risks || '').trim(),
    care_daily_living: daily,
    care_behavioral: String(r.behaviors || '').trim(),
    care_nutrition: String(r.diet_nutrition || '').trim()
  };
}

// The chart rides on the row, so opening one costs no Apps Script execution.
function clientDetailFromIsp_(r) {
  var conditions = ispBulletList_(r.diagnoses, 8, 56);
  var allergies = ispBulletList_(r.allergies, 6, 56);
  var medications = ispBulletList_(r.medications, 10, 72);
  var contacts = String(r.contacts || '').trim();
  var guardian = cleanGuardianName_(parseGuardianFromContacts_(contacts));
  var appts = clientApptBucketsFromDrTab_(String(r.client_name || ''));
  var out = {
    clientNumber: String(r.client_key || '').trim(),
    conditions: conditions,
    conditionCount: conditions.length,
    allergies: allergies,
    medications: medications,
    medCount: medications.length,
    upcomingAppts: appts.upcoming.length,
    guardianName: guardian,
    contacts: contacts,
    isp_year: String(r.isp_year || ''),
    goals_outcomes: String(r.goals_outcomes || '').trim(),
    important_to: String(r.important_to || '').trim(),
    important_for: String(r.important_for || '').trim(),
    appointments: appts.upcoming,
    recentAppointments: appts.recent,
    summary: String(r.medical_summary || '').trim(),
    source_file: String(r.source_file || '').trim(),
    // The capped chip lists are for the panel; the chart gets the plan's own full text.
    allergies_text: String(r.allergies || '').trim(),
    diagnoses_text: String(r.diagnoses || '').trim(),
    medications_text: String(r.medications || '').trim(),
    notes: []
  };
  var care = clientCareFromIsp_(r);
  for (var ck in care) out[ck] = care[ck];
  var demo = ispDemographics_(r.contact_block, String(r.client_name || ''));
  for (var dk2 in demo) out[dk2] = demo[dk2];
  // The contacts prose fills only what the Important People table left blank.
  if (!out.guardian_email) out.guardian_email = guardianEmailFromContacts_(contacts);
  if (!out.guardian_phone) out.guardian_phone = guardianPhoneFromContacts_(contacts);
  var doc = ispDocFor_(String(r.client_name || ''));
  out.isp_doc_url = doc.url;
  out.isp_doc_name = doc.name;
  return out;
}

function normalizeClientRow_(row) {
  if (!row) return row;
  if (!Array.isArray(row.appointments)) row.appointments = [];
  if (!Array.isArray(row.recentAppointments)) row.recentAppointments = [];
  if (!Array.isArray(row.notes)) row.notes = [];
  if (!Array.isArray(row.conditions)) row.conditions = ispBulletList_(row.conditions, 8);
  if (!Array.isArray(row.allergies)) row.allergies = ispBulletList_(row.allergies, 6);
  if (!Array.isArray(row.medications)) row.medications = ispBulletList_(row.medications, 10);
  row.conditionCount = (row.conditions || []).length;
  row.medCount = (row.medications || []).length;
  row.upcomingAppts = (row.appointments || []).length;
  if (row.guardianName) {
    row.guardianName = cleanGuardianName_(row.guardianName);
  }
  if (!row.guardianName && row.contacts) {
    row.guardianName = cleanGuardianName_(parseGuardianFromContacts_(row.contacts));
  }
  row.supervisionShort = shortSupervision_(row.supervision_level);
  return row;
}

// Exact full-name match on 'avatar' photos, only when exactly one carries the name: a near match puts a stranger's face on a care record.
function clientPhotoIndex_() {
  var count = {}, src = {};
  try {
    listRows_('photos', {}).forEach(function (r) {
      if (String(r.kind || '') !== 'avatar') return;
      if (String(r.hidden || '').toLowerCase() === 'true') return;
      var k = clientNameKey_(r.title);
      if (!k || !String(r.src || '')) return;
      count[k] = (count[k] || 0) + 1;
      src[k] = String(r.src);
    });
  } catch (e) { return {}; }
  var out = {};
  for (var k2 in src) { if (count[k2] === 1) out[k2] = src[k2]; }
  return out;
}

// A profile column the Hub row cleared (cleared_fields) stays blank over what the plan derived, its companions with it.
function clientClearedApply_(row) {
  var cleared = hubEditCleared_(row.cleared_fields);
  Object.keys(cleared).forEach(function (col) {
    if (CP_SAVE_FIELDS.indexOf(col) === -1) return;
    (CP_FIELD_NAMES[col] || [col]).forEach(function (c) { row[c] = ''; });
  });
  return row;
}

// Set only while a pack runs (clientPack): every part reads the one unnarrowed derivation; readers never change it.
var CLIENTS_DERIVED_MEMO_ = null;

function clientsDerived_(user) {
  var memo = user ? null : CLIENTS_DERIVED_MEMO_;
  if (memo && memo.rows) return memo.rows;
  var derived = {};
  var photoByName = clientPhotoIndex_();
  listRows_('isps', {}).forEach(function (r) {
    var key = String(r.client_key || '').trim();
    if (!key) return;
    derived[key] = {
      id: 'CLI_' + key,
      name: String(r.client_name || key),
      avatar: photoByName[clientNameKey_(r.client_name)] || '',
      client_key: key,
      isp_year: String(r.isp_year || ''),
      supervision_level: String(r.supervision_level || ''),
      status: 'active',
      source: 'isp'
    };
    var detail = clientDetailFromIsp_(r);
    for (var dk in detail) derived[key][dk] = detail[dk];
    normalizeClientRow_(derived[key]);
  });
  try {
    listRows_('clients', {}).forEach(function (r) {
      var key = String(r.client_key || '').trim() || clientNameKey_(r.name);
      if (!key) return;
      var base = derived[key] || {};
      var merged = {};
      for (var k1 in base) merged[k1] = base[k1];
      for (var k2 in r) { if (String(r[k2] || '') !== '') merged[k2] = r[k2]; }
      if (!merged.id) merged.id = String(r.id || 'CLI_' + key);
      derived[key] = clientClearedApply_(normalizeClientRow_(merged));
    });
  } catch (e) {}

  var out = [];
  for (var k in derived) out.push(derived[k]);
  if (user && user.role === 'client' && !user.is_service) {
    var ck = String(user.client_key || '');
    out = ck ? out.filter(function (r) { return String(r.client_key || '') === ck; }) : [];
  }
  out.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  if (memo) memo.rows = out;
  return out;
}

/** Add a client, keyed by name key so the row layers onto the ISP-derived one instead of duplicating the person. */
HUB_POLICY.clientCreate = {
  file: 'Clients.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['clients'], emits: []
};
HUB_ACTIONS.clientCreate = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var name = str_(payload && payload.name).trim();
  if (name.length < 3 || name.indexOf(' ') === -1) {
    return { status: 400, message: 'A full name (first and last) is required.' };
  }
  var key = clientNameKey_(name);
  var existing;
  try { existing = listRows_('clients', {}); } catch (e) {
    return { status: 503, message: 'The directory could not be read just now — try again in a moment.' };
  }
  // a row keyed the plan's way (first_last) or only by its name: either folding to this name is the same client
  for (var i = 0; i < existing.length; i++) {
    if (clientNameKey_(existing[i].client_key) === key || clientNameKey_(existing[i].name) === key) {
      return { status: 409, message: '"' + name + '" is already on the directory.' };
    }
  }

  var row = createRow_('clients', {
    id: 'CLI_' + key,
    client_key: key,
    name: name,
    clientNumber: str_(payload && payload.clientNumber).trim(),
    client_number: str_(payload && payload.clientNumber).trim(),
    houseName: str_(payload && payload.houseName).trim(),
    house: str_(payload && payload.houseName).trim(),
    guardianName: str_(payload && payload.guardianName).trim(),
    status: str_(payload && payload.status).trim() || 'active',
    created_by: str_(user && user.email)
  });
  if (sheetDbRefused_(row)) return sheetDbRefused_(row);
  try { hubSysLog_(str_(user && user.email), 'client_create', name, { status: 200 }); } catch (eL) {}
  return { status: 200, data: row };
};

/** Make a login for a client or their guardian (e-mail, else phone digits); the same client twice answers already, another account's login is 409. */
HUB_POLICY.clientUserCreate = {
  file: 'Clients.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  params: { client_id: { required: true, type: 'string' }, kind: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.clientUserCreate = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var kind = str_(payload.kind).toLowerCase();
  if (kind !== 'client' && kind !== 'guardian') {
    return { status: 400, message: 'kind must be client or guardian.' };
  }
  var cid = str_(payload.client_id);
  var rows;
  try { rows = clientsDerived_(user); }
  catch (eR) {
    return { status: 503, message: 'The clients could not be read (' +
      String((eR && eR.message) || eR) + ') — no account was made.' };
  }
  var rec = null;
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].id) === cid) { rec = rows[i]; break; }
  }
  if (!rec) return { status: 404, message: 'No client "' + cid + '".' };

  var digitsOf = function (v) { return String(v || '').replace(/\D+/g, ''); };
  var displayName = '', login = '', phone = '', title = '';
  if (kind === 'client') {
    displayName = str_(rec.name);
    phone = str_(rec.client_phone);
    login = str_(rec.client_email).trim().toLowerCase();
    if (!login) login = digitsOf(rec.client_phone);
    title = 'Client';
    if (!login) {
      return { status: 422, message: 'The plan holds no e-mail and no phone for ' +
        displayName + ' — there is nothing to sign in with. Fill one on the record first.' };
    }
  } else {
    displayName = str_(rec.guardianName) || str_(rec.guardian_name);
    if (!displayName || displayName.toLowerCase() === 'self') {
      return { status: 422, message: 'The plan names no separate guardian for ' +
        str_(rec.name) + ' — no guardian account can be made.' };
    }
    phone = str_(rec.guardian_phone);
    login = str_(rec.guardian_email).trim().toLowerCase();
    if (!login) login = digitsOf(rec.guardian_phone);
    title = 'Guardian of ' + str_(rec.name);
    if (!login) {
      return { status: 422, message: 'The plan holds no e-mail and no phone for guardian ' +
        displayName + ' — there is nothing to sign in with. Fill one on the record first.' };
    }
  }

  var existing = userByEmail_(login);
  if (existing) {
    if (str_(existing.clientkey) === str_(rec.client_key)) {
      return { status: 200, data: { already: true, id: str_(existing.userid), login: login } };
    }
    return { status: 409, message: 'The login "' + login + '" already belongs to another account.' };
  }

  var pw = str_(hubProp_('FIRST_USER_PASSWORD')) ||
           str_(hubProp_('ONBOARDING_USER_PASSWORD'));
  if (!pw) {
    return { status: 500, message: 'Set the FIRST_USER_PASSWORD Script Property first — ' +
             'client accounts are armed with that default.' };
  }

  ensureUserProfileColumns_();
  var usersSheet = hubSheet_(USERS_TAB);
  ensureHeader_(usersSheet, ['client_key', 'must_change']);
  var uHdr = usersSheet.getDataRange().getValues()[0].map(normKey_);
  var uCol = {};
  ['userid', 'email', 'displayname', 'role', 'salt', 'passhash', 'active', 'createdat',
   'title', 'phone', 'clientkey', 'mustchange',
   'hometenant'].forEach(function (k) { uCol[k] = uHdr.indexOf(k); });
  var salt = randomHex_(32);
  var uid = 'USR_' + randomHex_(12).toUpperCase();
  var line = [];
  for (var c = 0; c < uHdr.length; c++) line.push('');
  line[uCol.userid] = uid;
  line[uCol.email] = login;
  line[uCol.displayname] = displayName;
  line[uCol.role] = 'client';
  line[uCol.salt] = salt;
  line[uCol.passhash] = hashPassword_(pw, salt);
  line[uCol.active] = 'true';
  line[uCol.createdat] = new Date().toISOString();
  if (uCol.title !== -1) line[uCol.title] = title;
  if (uCol.phone !== -1) line[uCol.phone] = str_(phone);
  if (uCol.clientkey !== -1) line[uCol.clientkey] = str_(rec.client_key);
  // must_change: the default password is shared and a phone-digit login is no secret.
  if (uCol.mustchange !== -1) line[uCol.mustchange] = 'true';
  if (uCol.hometenant !== undefined && uCol.hometenant !== -1 && hubAwayTenant_()) {
    line[uCol.hometenant] = tenantStamp_();
  }
  usersSheet.appendRow(line);
  try {
    var fields = { types: kind === 'guardian' ? 'GUARDIAN' : 'CLIENT' };
    if (kind === 'client' && str_(rec.avatar)) fields.avatar = str_(rec.avatar).slice(0, 500);
    userSetFields_(uid, fields);
  } catch (eT) {}

  hubSysLog_(str_(user.email), 'client_user_create',
             kind + ' account for ' + str_(rec.name) + ' — signs in as ' + login +
             ' (default password)', { status: 200 });
  return { status: 200, data: { id: uid, login: login, kind: kind, defaulted: true } };
};

// --- Guardians into the general roster --- Each guardian a plan names goes onto `people`: one row per name key…

// The plans' ways of writing absence; an organisation holding guardianship is a real answer.
var GUARDIAN_NON_PERSON = ['self', 'none', 'n/a', 'na', 'no guardian',
  'no legal guardian', 'not applicable', 'unknown', 'tbd', 'n a', '-', '--'];
function guardianIsPerson_(name) {
  var s = String(name || '').trim().toLowerCase().replace(/[.]+$/, '');
  if (!s) return false;
  if (GUARDIAN_NON_PERSON.indexOf(s) !== -1) return false;
  if (/^(no|none|not)\b/.test(s) && /guardian|listed|applicable|assigned/.test(s)) return false;
  return true;
}

// A roster name: parentheticals and everything after the first comma go, so one person is not two rows.
function guardianDisplayName_(raw) {
  var s = cleanGuardianName_(raw);
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ');
  s = s.split(',')[0];
  s = s.replace(/\s{2,}/g, ' ').replace(/[\s,;:.\-]+$/, '').trim();
  return s;
}

function guardiansFromClients_(rows) {
  var list = rows || [];
  var byKey = {}, order = [], skipped = 0;
  for (var i = 0; i < list.length; i++) {
    var rec = list[i] || {};
    var raw = String(rec.guardianName || rec.guardian_name || '').trim();
    if (!guardianIsPerson_(raw)) { skipped++; continue; }
    var name = guardianDisplayName_(raw);
    if (!guardianIsPerson_(name)) { skipped++; continue; }
    var key = clientNameKey_(name);
    if (!key) { skipped++; continue; }
    var hit = Object.prototype.hasOwnProperty.call(byKey, key) ? byKey[key] : null;
    if (!hit) {
      hit = { key: key, id: 'PPL_guardian_' + key, name: name,
              email: '', phone: '', forNames: [], forKeys: {} };
      byKey[key] = hit;
      order.push(hit);
    }
    if (!hit.email) hit.email = String(rec.guardian_email || '').trim();
    if (!hit.phone) hit.phone = String(rec.guardian_phone || '').trim();
    var who = String(rec.name || '').trim();
    var wk = clientNameKey_(who);
    if (wk && !hit.forKeys[wk]) { hit.forKeys[wk] = true; hit.forNames.push(who); }
  }
  var out = [];
  for (var n = 0; n < order.length; n++) {
    out.push({ key: order[n].key, id: order[n].id, name: order[n].name,
               email: order[n].email, phone: order[n].phone,
               guardian_for: order[n].forNames.join(', ') });
  }
  return { guardians: out, skipped: skipped };
}

function guardianForMerge_(existing, addition) {
  var seen = {}, out = [];
  var take = function (text) {
    String(text || '').split(',').forEach(function (part) {
      var name = part.trim();
      var k = clientNameKey_(name);
      if (!k || seen[k]) return;
      seen[k] = true;
      out.push(name);
    });
  };
  take(existing);
  take(addition);
  return out.join(', ');
}

// Existing rows are patched cell by cell, blanks only: a whole-row write would flatten formulas and typed notes.
function guardianRosterWrite_(list, maxWrites) {
  var rows = list || [];
  var cap = maxWrites || 200;
  var sheet = sheetFor_('people');
  var header = ensureHeader_(sheet, ['id', 'name', 'role', 'status', 'email',
                                     'phone', 'guardian_for']);
  var iId = header.indexOf('id');
  if (iId === -1) return { created: 0, filled: 0, writes: 0, capped: false };

  cacheBump_(RESOURCES['people'].sheet);
  var values = sheet.getDataRange().getValues();
  var rowAt = {};
  for (var r = 1; r < values.length; r++) {
    var id = String(values[r][iId] || '').trim();
    if (id && rowAt[id] === undefined) rowAt[id] = r;
  }

  var put = function (line, key, value) {
    var ci = header.indexOf(key);
    if (ci !== -1 && String(value || '') !== '') line[ci] = value;
  };

  var created = 0, filled = 0, writes = 0;
  var now = new Date().toISOString();
  for (var g = 0; g < rows.length && writes < cap; g++) {
    var w = rows[g];
    var at = rowAt[w.id];

    if (at === undefined) {
      // One appendRow carrying everything: a second write at getLastRow() can land on another execution's row.
      var line = [];
      for (var c = 0; c < header.length; c++) line.push('');
      put(line, 'id', w.id);
      put(line, 'name', w.name);
      put(line, 'role', 'guardian');
      put(line, 'status', 'active');
      put(line, 'email', w.email);
      put(line, 'phone', w.phone);
      put(line, 'guardian_for', w.guardian_for);
      put(line, 'createdAt', now);
      put(line, 'updatedAt', now);
      sheet.appendRow(line);
      created++;
      writes++;
      continue;
    }

    var fields = [['name', w.name], ['role', 'guardian'], ['status', 'active'],
                  ['email', w.email], ['phone', w.phone]];
    var patched = 0;
    for (var f = 0; f < fields.length && writes < cap; f++) {
      var fi = header.indexOf(fields[f][0]);
      if (fi === -1 || String(fields[f][1] || '') === '') continue;
      if (String(values[at][fi] || '').trim() !== '') continue;   // fill-blank only: a typed cell is never overwritten
      sheet.getRange(at + 1, fi + 1).setValue(fields[f][1]);
      patched++;
      writes++;
    }
    var gi = header.indexOf('guardian_for');
    if (gi !== -1 && writes < cap) {
      var was = String(values[at][gi] || '').trim();
      var merged = guardianForMerge_(was, w.guardian_for);
      if (merged !== was) {
        sheet.getRange(at + 1, gi + 1).setValue(merged);
        patched++;
        writes++;
      }
    }
    if (patched) filled++;
  }

  // Bump again after writing: a reader that missed during the write would cache the old rows (SheetDb.gs).
  if (writes) cacheBumpAfterWrite_('people');
  // `capped` means work was left, not that the budget was spent.
  return { created: created, filled: filled, writes: writes, capped: g < rows.length };
}

HUB_POLICY.guardiansToRoster = {
  file: 'Clients.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: ['people'], emits: []
};
HUB_ACTIONS.guardiansToRoster = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var rows;
  try { rows = clientsDerived_(user); }
  catch (eR) {
    return { status: 503, message: 'The clients could not be read (' +
      String((eR && eR.message) || eR) + ') — no roster row was written.' };
  }
  var found = guardiansFromClients_(rows);

  // Serialised: two concurrent runs would each append the same guardian.
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (eLk) {
    return { status: 503, message: 'The roster is being written right now — try again in a moment.' };
  }
  var wrote;
  try { wrote = guardianRosterWrite_(found.guardians, 200); }
  finally { try { lock.releaseLock(); } catch (eU) {} }

  var counts = {
    examined: rows.length,
    guardians: found.guardians.length,
    created: wrote.created,
    filled: wrote.filled,
    skipped: found.skipped,
    capped: wrote.capped
  };
  try {
    hubSysLog_(str_(user.email), 'guardians_to_roster',
               counts.created + ' guardian(s) added to the roster and ' + counts.filled +
               ' filled in, from ' + counts.examined + ' client plan(s)', { status: 200 });
  } catch (eL) {}
  return { status: 200, data: counts };
};


/** Which Clients views and toolbar items the master allows; unreadable config fails open. */
HUB_POLICY.clientViewsPolicy = {
  file: 'Clients.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: []
};
// Legacy values: 'yes' or blank = everything, 'no' = nothing. Views itself is never governed.
function clientToolbarItems_(raw) {
  var all = ['share', 'export', 'add'];
  var v = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!v || v === 'yes') return all;
  if (v === 'no') return [];
  var picked = v.split(/[,;\s]+/).filter(String);
  return all.filter(function (t) { return picked.indexOf(t) !== -1; });
}

HUB_ACTIONS.clientViewsPolicy = function (payload, user) {
  var views = ['directory', 'record', 'unique'];
  var tools = ['share', 'export', 'add'];
  try {
    var cfg = (typeof hiringAlerts_ === 'function') ? hiringAlerts_() : {};
    var raw = String(cfg.clients_views_master || '').toLowerCase();
    if (raw.trim()) {
      var allowed = raw.split(/[,;\s]+/).filter(String);
      views = views.filter(function (v) { return allowed.indexOf(v) !== -1; });
    }
    tools = clientToolbarItems_(cfg.clients_toolbar_master);
  } catch (e) {}
  return { status: 200, data: { views: views, tools: tools } };
};

// --- The service plan as a filed PDF: the platform's reading of the plan, not the county's plan --- The outline…

var ISP_PDF_FOLDER = 'ASA Hub — Service Plans';

function ispPdfFolder_() {
  var root = filesRoot_();
  return filesChildByName_(root, ISP_PDF_FOLDER);
}

// Shift reading order; `critical` is read before a shift, `keep` prints even when empty.
var ISP_PDF_SECTIONS = [
  { heading: 'Allergies', field: 'allergies', weight: 'critical', keep: true },
  { heading: 'Safety & risks', field: 'safety_risks', weight: 'critical' },
  { heading: 'Supervision level', field: 'supervision_level', weight: 'critical', keep: true },
  { heading: 'Medications', field: 'medications' },
  { heading: 'Diet & nutrition', field: 'diet_nutrition' },
  { heading: 'Behaviours', field: 'behaviors' },
  { heading: 'Mobility', field: 'mobility' },
  { heading: 'Personal care', field: 'personal_care' },
  { heading: 'Communication', field: 'communication' },
  { heading: 'Diagnoses', field: 'diagnoses' },
  { heading: 'Medical summary', field: 'medical_summary' },
  { heading: 'Goals & outcomes', field: 'goals_outcomes' },
  { heading: 'Important TO them', field: 'important_to' },
  { heading: 'Important FOR them', field: 'important_for' }
];

function ispPdfBlocks_(value) {
  var raw = String(value || '').replace(/\r/g, '');
  var lines = raw.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  var bullets = [], prose = [];
  for (var i = 0; i < lines.length; i++) {
    var m = /^[•\-•\*]\s*(.+)$/.exec(lines[i]);
    if (m) bullets.push(m[1].trim());
    else if (bullets.length) bullets[bullets.length - 1] += ' ' + lines[i];
    else prose.push(lines[i]);
  }
  return { bullets: bullets, prose: prose.join(' ').trim() };
}

function ispPdfBullet_(text) {
  var t = String(text || '');
  var m = /^([^:]{3,64}):\s*([\s\S]+)$/.exec(t);
  if (!m) return '<li style="margin:0 0 7px 0;">' + mailEsc_(t) + '</li>';
  return '<li style="margin:0 0 7px 0;"><span style="font-weight:bold;">' + mailEsc_(m[1]) +
    '</span> — ' + mailEsc_(m[2]) + '</li>';
}

function ispPdfSectionBody_(value) {
  var b = ispPdfBlocks_(value);
  var out = '';
  if (b.prose) {
    out += '<p style="margin:0 0 8px 0;font:12.5px/19px Helvetica,Arial,sans-serif;color:#1c2024;">' +
      mailEsc_(b.prose) + '</p>';
  }
  if (b.bullets.length) {
    out += '<ul style="margin:0;padding:0 0 0 18px;font:12.5px/19px Helvetica,Arial,sans-serif;color:#1c2024;">';
    for (var i = 0; i < b.bullets.length; i++) out += ispPdfBullet_(b.bullets[i]);
    out += '</ul>';
  }
  return out;
}

function ispPdfFirstSentence_(value, cap) {
  var t = String(value || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  var m = /^(.{40,}?[.!?])\s/.exec(t);
  var s = m ? m[1] : t;
  var max = cap || 220;
  return s.length > max ? s.slice(0, max - 1).replace(/[\s,;]+$/, '') + '…' : s;
}

// Blank allergies print "None recorded in the plan", never nothing: a blank reads as not checked.
function ispPdfGlance_(r) {
  var esc = mailEsc_;
  var diag = ispPdfBlocks_(r.diagnoses).bullets;
  var allerg = ispPdfBlocks_(r.allergies);
  var allergText = allerg.bullets.length ? allerg.bullets.join(' · ') : (allerg.prose || '');
  var sup = ispPdfFirstSentence_(String(r.supervision_level || ''), 180);
  var rows = [
    ['Supervision', sup || 'Not recorded in the plan.', !sup],
    ['Allergies', allergText || 'None recorded in the plan.', !allergText],
    ['Conditions', diag.length ? diag.join(' · ') : (ispPdfFirstSentence_(r.diagnoses, 200) || 'None recorded in the plan.'), !diag.length]
  ];
  var html = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    'style="border-collapse:collapse;margin:0 0 4px 0;">';
  for (var i = 0; i < rows.length; i++) {
    html += '<tr>' +
      '<td valign="top" width="108" style="padding:7px 12px 7px 0;border-top:1px solid #e3e6ea;' +
      'font:bold 10px Helvetica,Arial,sans-serif;letter-spacing:1px;text-transform:uppercase;color:#5b6470;">' +
      esc(rows[i][0]) + '</td>' +
      '<td style="padding:7px 0;border-top:1px solid #e3e6ea;font:12.5px/18px Helvetica,Arial,sans-serif;color:' +
      (rows[i][2] ? '#5b6470' : '#1c2024') + ';">' + esc(rows[i][1]) + '</td></tr>';
  }
  html += '</table>';

  var summary = String(r.medical_summary || '').replace(/\s+/g, ' ').trim();
  if (summary) {
    html += '<p style="margin:12px 0 0 0;font:italic 12.5px/19px Georgia,serif;color:#2f3540;">' +
      esc(summary) + '</p>';
  }
  return html;
}

function ispPdfHtml_(row, demo) {
  var esc = mailEsc_;
  var name = str_(row.client_name);
  var year = str_(row.isp_year);
  var d = demo || {};

  var live = [];
  for (var i = 0; i < ISP_PDF_SECTIONS.length; i++) {
    var sec = ISP_PDF_SECTIONS[i];
    var value = str_(row[sec.field]);
    if (!value && !sec.keep) continue;
    live.push({ n: live.length + 1, id: 'sec-' + sec.field, heading: sec.heading,
                value: value, weight: sec.weight });
  }

  var contents = '';
  for (var c = 0; c < live.length; c++) {
    contents += '<td width="33%" valign="top" style="padding:2px 10px 2px 0;' +
      'font:11.5px/17px Helvetica,Arial,sans-serif;">' +
      '<a href="#' + live[c].id + '" style="color:#1c2024;text-decoration:none;">' +
      '<span style="color:#2f6f5f;font-weight:bold;">' + live[c].n + '.</span> ' +
      esc(live[c].heading) + '</a></td>';
    if ((c + 1) % 3 === 0) contents += '</tr><tr>';
  }

  var body = '';
  for (var s2 = 0; s2 < live.length; s2++) {
    var it = live[s2];
    var critical = it.weight === 'critical';
    body += '<div style="page-break-inside:avoid;margin:0 0 18px 0;' +
      (critical ? 'border-left:2px solid #c2410c;padding:0 0 0 14px;' : '') + '">' +
      '<h2 id="' + it.id + '" style="margin:0 0 7px 0;font:bold 11.5px Helvetica,Arial,sans-serif;' +
      'letter-spacing:1.3px;text-transform:uppercase;color:' + (critical ? '#c2410c' : '#2f6f5f') + ';' +
      'border-bottom:1px solid ' + (critical ? '#f0dfd4' : '#e3e6ea') + ';padding-bottom:5px;">' +
      '<span style="color:#c3c9d0;">' + (it.n < 10 ? '0' + it.n : it.n) + '</span> &nbsp;' + esc(it.heading) + '</h2>' +
      (it.value ? ispPdfSectionBody_(it.value)
                : '<p style="margin:0;font:12.5px/19px Helvetica,Arial,sans-serif;color:#5b6470;">' +
                  'None recorded in the plan.</p>') +
      '</div>';
  }

  var facts = [
    ['Date of birth', str_(d.dob)], ['County', str_(d.county)],
    ['Phone', hubPhoneE164_(str_(d.client_phone))], ['Guardian', str_(d.guardian_name)],
    ['Guardian phone', hubPhoneE164_(str_(d.guardian_phone))], ['S.S.A.', str_(d.ssa_name)]
  ].filter(function (f) { return f[1]; });
  var factsHtml = '';
  for (var k = 0; k < facts.length; k += 2) {
    factsHtml += '<tr>';
    for (var j = k; j < Math.min(k + 2, facts.length); j++) {
      factsHtml += '<td width="50%" valign="top" style="padding:3px 16px 3px 0;">' +
        '<span style="font:10px Helvetica,Arial,sans-serif;letter-spacing:1px;text-transform:uppercase;color:#9aa3ad;">' +
        esc(facts[j][0]) + '</span><br>' +
        '<span style="font:12.5px Helvetica,Arial,sans-serif;color:#1c2024;">' + esc(facts[j][1]) + '</span></td>';
    }
    factsHtml += '</tr>';
  }

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(name) + ' — service plan</title>' +
    // @page is only a request the converter may ignore, so the body carries its own margin too.
    '<style>@page { margin: 12mm 10mm; }</style></head>' +
    '<body style="margin:0;padding:26px 34px 30px 34px;background:#ffffff;">' +
    '<a name="top" id="top"></a>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
    '<tr><td style="border-bottom:2px solid #2f6f5f;padding:0 0 10px 0;">' +
    '<p style="margin:0 0 3px 0;font:10px Helvetica,Arial,sans-serif;letter-spacing:2px;text-transform:uppercase;color:#2f6f5f;">' +
    'ASA LifeCare · Individual Service Plan</p>' +
    '<h1 style="margin:0;font:normal 30px/36px Georgia,serif;color:#1c2024;">' + esc(name) + '</h1>' +
    '<p style="margin:3px 0 0 0;font:11.5px Helvetica,Arial,sans-serif;color:#5b6470;">' +
    (year ? 'Plan year ' + esc(year) + ' &nbsp;·&nbsp; ' : '') +
    'Printed ' + esc(hubDayOnlyLabel_(new Date().toISOString().slice(0, 10))) + '</p>' +
    '</td></tr></table>' +
    (factsHtml ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="margin:14px 0 0 0;background:#fafbfc;border-radius:8px;">' +
      '<tr><td style="padding:10px 14px;"><table role="presentation" width="100%" cellpadding="0" ' +
      'cellspacing="0" border="0">' + factsHtml + '</table></td></tr></table>' : '') +
    '<div style="page-break-inside:avoid;margin:18px 0 0 0;background:#f2f7f5;border-radius:10px;padding:14px 18px;">' +
    '<p style="margin:0 0 8px 0;font:bold 10px Helvetica,Arial,sans-serif;letter-spacing:1.6px;text-transform:uppercase;color:#2f6f5f;">' +
    'Before the shift</p>' + ispPdfGlance_(row) + '</div>' +
    '<div style="page-break-inside:avoid;margin:18px 0 22px 0;border-top:1px solid #e3e6ea;border-bottom:1px solid #e3e6ea;padding:12px 0;">' +
    '<p style="margin:0 0 8px 0;font:bold 10px Helvetica,Arial,sans-serif;letter-spacing:1.6px;text-transform:uppercase;color:#9aa3ad;">' +
    'On this page</p>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' + contents + '</tr></table></div>' +
    body +
    '<p style="margin:28px 0 0 0;font:10px/15px Helvetica,Arial,sans-serif;color:#9aa3ad;border-top:1px solid #e3e6ea;padding-top:10px;">' +
    'This document is the ASA LifeCare platform\'s reading of the Individual Service Plan, not the county\'s own ' +
    'plan. Where the two differ, the plan on file is the authority. It carries clinical information: handle it the ' +
    'way you would handle the plan itself.</p>' +
    '</body></html>';
}

HUB_POLICY.ispPlanPdf = {
  file: 'Clients.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  params: { client_key: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.ispPlanPdf = function (payload, user) {
  if (!user) return hubDenied_();
  var role = str_(user.role);
  if (['admin', 'manager', 'staff'].indexOf(role) === -1) return hubDenied_();
  var key = str_(payload && payload.client_key);
  if (!key) return { status: 400, message: 'client_key: which plan.' };

  var rows = listRows_('isps', {});
  var row = null;
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].client_key) === key || str_(rows[i].id) === key ||
        clientNameKey_(str_(rows[i].client_name)) === clientNameKey_(key)) { row = rows[i]; break; }
  }
  if (!row) return { status: 404, message: 'No service plan for "' + key + '".' };

  var demo = {};
  try { demo = ispDemographics_(row.contact_block, str_(row.client_name)); } catch (eD) { demo = {}; }
  var html = ispPdfHtml_(row, demo);
  var stamp = new Date().toISOString().slice(0, 10);
  var fileName = str_(row.client_name) + ' — service plan (' + stamp + ').pdf';
  var folder = ispPdfFolder_();
  // One file per plan per day: today's older copy is replaced, earlier days are kept.
  var existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) existing.next().setTrashed(true);
  var pdf = Utilities.newBlob(html, 'text/html', fileName).getAs('application/pdf').setName(fileName);
  var file = folder.createFile(pdf);
  try {
    hubSysLog_(str_(user.email), 'isp_plan_pdf', str_(row.client_name) + ' → ' + fileName, { status: 200 });
  } catch (eL) {}
  return { status: 200, data: {
    name: fileName,
    url: file.getUrl(),
    download_url: 'https://drive.google.com/uc?export=download&id=' + file.getId(),
    folder: folder.getName()
  } };
};

// --- Reading a plan with the model: a value is stored only if it is found in the plan text --- Runs only as a…

var ISP_CONTACTS_TAB = 'isp_contacts';
var ISP_CONTACTS_HEADER = ['client_key', 'client_name', 'guardian_name', 'guardian_relationship',
                           'guardian_email', 'guardian_phone', 'source', 'via', 'checked_at'];

function ispContactsSheet_() {
  var sheet = hubTabEnsure_(ISP_CONTACTS_TAB, ISP_CONTACTS_HEADER);
  ensureHeader_(sheet, ISP_CONTACTS_HEADER);
  return sheet;
}

var ISP_CONTACTS_CACHE = null;
function ispContactsIndex_() {
  if (ISP_CONTACTS_CACHE) return ISP_CONTACTS_CACHE;
  var out = {};
  try {
    ispContactsSheet_();
    var ss = hubTabWorkbook_(ISP_CONTACTS_TAB);
    readTabNormalized_(ss, ISP_CONTACTS_TAB).forEach(function (r) {
      var k = str_(r.clientkey);
      if (!k) return;
      out[k] = { name: str_(r.guardianname), relationship: str_(r.guardianrelationship),
                 email: str_(r.guardianemail), phone: str_(r.guardianphone),
                 source: str_(r.source), via: str_(r.via) };
    });
  } catch (e) { out = {}; }
  ISP_CONTACTS_CACHE = out;
  return out;
}

function ispTextHas_(text, value, kind) {
  var hay = String(text || '');
  var v = String(value || '').trim();
  if (!v) return false;
  if (kind === 'email') {
    // Whitespace removed on both sides re-joins an address the PDF wrapped.
    return hay.replace(/\s+/g, '').toLowerCase().indexOf(v.replace(/\s+/g, '').toLowerCase()) !== -1;
  }
  if (kind === 'phone') {
    var digits = v.replace(/\D/g, '');
    if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
    if (digits.length !== 10) return false;
    return hay.replace(/\D/g, '').indexOf(digits) !== -1;
  }
  var words = v.split(/\s+/).filter(function (w) { return w.replace(/\W/g, '').length >= 3; });
  if (!words.length) return false;
  var low = hay.toLowerCase();
  for (var i = 0; i < words.length; i++) {
    if (low.indexOf(words[i].replace(/[^\w'-]/g, '').toLowerCase()) === -1) return false;
  }
  return true;
}

// The prompt asks for a quote so the model looks for the line; the quote is never stored.
function ispGuardianExtract_(clientName, text) {
  var src = String(text || '');
  if (!src.trim()) return null;
  var prompt =
    'You are reading one Individual Service Plan for ' + String(clientName || 'a person') + '.\n' +
    'Find the GUARDIAN — the person or organisation legally responsible for them. Ignore case ' +
    'managers, SSAs, physicians, home providers, employers, family members who are NOT the guardian, ' +
    'and any agency that merely provides a service.\n\n' +
    'Rules:\n' +
    '- Copy values EXACTLY as they appear. Never correct, complete or reformat them.\n' +
    '- If a value is not written in the text, use "".\n' +
    '- If the plan says there is no guardian, or the person is their own guardian, ' +
    'return name "" and set self_or_none true.\n' +
    '- An e-mail broken across two lines is still one e-mail: join it.\n\n' +
    'Answer as JSON only:\n' +
    '{"name":"","relationship":"","email":"","phone":"","self_or_none":false,' +
    '"quote":"the sentence you took this from"}\n\n' +
    'PLAN TEXT:\n' + src.slice(0, 6000);

  var ai = screenAiChat_(prompt, 0, 'ai_isp_guardian');
  if (!ai || !ai.ok) return null;
  var got = null;
  try { got = JSON.parse(ai.content); } catch (e) { return null; }
  if (!got || got.self_or_none === true) return { name: '', email: '', phone: '', relationship: '', via: ai.via };

  var name = ispTextHas_(src, got.name, 'name') ? String(got.name).trim() : '';
  if (!name || !guardianIsPerson_(name)) return { name: '', email: '', phone: '', relationship: '', via: ai.via };
  return {
    name: guardianDisplayName_(name),
    relationship: String(got.relationship || '').trim().slice(0, 60),
    email: ispTextHas_(src, got.email, 'email') ? String(got.email).trim() : '',
    phone: ispTextHas_(src, got.phone, 'phone') ? ispPhone_(String(got.phone).trim()) : '',
    via: ai.via
  };
}

HUB_POLICY.ispContactsSweep = {
  file: 'Clients.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: ['clients'], emits: []
};
HUB_ACTIONS.ispContactsSweep = function (payload, user) {
  if (!user || str_(user.role) !== 'admin') return hubDenied_();
  var only = str_(payload && payload.client_key);
  var redo = payload && (payload.redo === true || str_(payload.redo) === 'true');
  var rows = listRows_('isps', {});
  var sheet = ispContactsSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iKey = hdr.indexOf('clientkey');
  var known = {};
  for (var r = 1; r < values.length; r++) known[str_(values[r][iKey])] = r + 1;

  var read = 0, wrote = 0, refused = 0, skipped = 0, unreadable = 0;
  for (var i = 0; i < rows.length; i++) {
    var key = str_(rows[i].client_key);
    if (!key) continue;
    if (only && key !== only) continue;
    if (known[key] && !redo) { skipped++; continue; }
    var text = [str_(rows[i].contact_block), str_(rows[i].contacts)].filter(String).join('\n\n');
    if (!text) { unreadable++; continue; }
    read++;
    var got = ispGuardianExtract_(str_(rows[i].client_name), text);
    if (!got) { refused++; continue; }
    var line = [key, str_(rows[i].client_name), got.name, got.relationship,
                got.email, got.phone, got.name ? 'read' : 'none', str_(got.via),
                new Date().toISOString()];
    if (known[key]) sheet.getRange(known[key], 1, 1, ISP_CONTACTS_HEADER.length).setValues([line]);
    else sheet.appendRow(line);
    wrote++;
  }
  ISP_CONTACTS_CACHE = null;
  try {
    hubSysLog_(str_(user.email), 'isp_contacts_sweep',
               wrote + ' plan(s) written, ' + refused + ' refused, ' + skipped + ' already known',
               { status: 200 });
  } catch (eL) {}
  return { status: 200, data: { examined: rows.length, read: read, wrote: wrote,
           refused: refused, skipped: skipped, unreadable: unreadable } };
};
