// Clients · Appointments: the Dr Appointments app's own book, one client at a time, read as App Control releases…
// Dr Appt Archive holds the booked visits, Future Apts the upcoming view of the same form, Dr Master the doctors.

var CS_APPT_ACTIONS = ['clientSourceAppointments'];
var CS_APPT_ARCHIVE = 'Dr Appt Archive';
var CS_APPT_FUTURE = 'Future Apts';
var CS_APPT_MASTER = 'Dr Master';
var CS_APPT_STATUSES = ['Upcoming', 'Past'];
var CS_APPT_TTL_MS = 60000;
// Words that name a title, a kind of practice or a street, never the doctor.
var CS_APPT_NOT_A_NAME = ['dr', 'doctor', 'md', 'do', 'np', 'pa', 'pac', 'dds', 'dmd', 'od', 'phd', 'aprn', 'cnp',
  'fnp', 'rn', 'lpn', 'the', 'and', 'of', 'at', 'in', 'for', 'with', 'clinic', 'health', 'healthcare', 'medical',
  'medicine', 'center', 'centre', 'family', 'practice', 'group', 'associates', 'office', 'hospital', 'care',
  'services', 'dental', 'dentistry', 'dentist', 'therapy', 'physical', 'eye', 'vision', 'foot', 'ankle', 'podiatry',
  'orthopedic', 'orthopedics', 'urgent', 'statcare', 'partners', 'inc', 'llc', 'lab', 'labs', 'st', 'ave', 'rd',
  'nw', 'ne', 'sw', 'se', 'suite', 'ste'];

// FAIL-CLOSED: the Clients reader for this client — the master in its own session, else as App Control releases…
function csApptGate_(user, client) {
  try {
    if (!user || user.is_service) return null;
    if (typeof HUB_IS_SERVICE_REQ !== 'undefined' && HUB_IS_SERVICE_REQ) return null;
    if (hubIsRealMaster_(user)) return { kind: 'master', keys: null };
    return clientProfilesReaderFor_(user, client) || null;
  } catch (e) { return null; }
}

function csApptUnknown_() {
  return { status: 404, message: 'Unknown action.' };
}

function csApptWhy_(what, e) {
  return what + ' could not be read (' + String((e && e.message) || e).slice(0, 120) + ')';
}

function csApptText_(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

function csApptToday_() {
  var now = (typeof hubQuietNow_ === 'function') ? hubQuietNow_() : new Date();
  try { return Utilities.formatDate(now, 'America/New_York', 'yyyy-MM-dd'); }
  catch (e) { return now.toISOString().slice(0, 10); }
}

/** The start time as typed: "2:00:00 PM", a time cell ("14:00") or an instant → { label: "2:00 PM", hm: "14:00" }. */
function csApptClock_(v) {
  var s = csApptText_(v);
  if (!s) return { label: '', hm: '' };
  var h = -1, m = 0;
  var ampm = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])\.?\s*m\.?$/i.exec(s);
  var bare = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (ampm) {
    h = parseInt(ampm[1], 10) % 12 + (/p/i.test(ampm[3]) ? 12 : 0);
    m = parseInt(ampm[2], 10);
  } else if (bare) {
    h = parseInt(bare[1], 10);
    m = parseInt(bare[2], 10);
  } else if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !isNaN(Date.parse(s))) {
    try {
      var hm = Utilities.formatDate(new Date(Date.parse(s)), 'America/New_York', 'HH:mm').split(':');
      h = parseInt(hm[0], 10);
      m = parseInt(hm[1], 10);
    } catch (e) { h = -1; }
  }
  if (h < 0 || h > 23 || m > 59) return { label: s, hm: '' };
  var label = ((h % 12) || 12) + ':' + ('0' + m).slice(-2) + ' ' + (h < 12 ? 'AM' : 'PM');
  return { label: label, hm: ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2) };
}

/** The client a request names, with every name key the platform spells them by. */
function csApptClient_(raw) {
  var key = csApptText_(raw);
  if (!key || key.length > 120) return { refused: { status: 400, message: 'client: a client key, as the Clients app names it.' } };
  var rows;
  try { rows = clientsDerived_(null); }
  catch (e) { return { refused: { status: 503, message: csApptWhy_('The clients', e) + '.' } }; }
  var hit = null;
  for (var i = 0; i < rows.length && !hit; i++) if (csApptText_(rows[i].client_key) === key) hit = rows[i];
  if (!hit) return { refused: { status: 404, message: 'No client with that key is on file.' } };
  var names = {};
  try {
    var id = hubClientIdentity_(key);
    for (var n in (id && id.names) || {}) if (id.names[n]) names[n] = true;
  } catch (eId) { /* the row's own name below still identifies */ }
  var own = clientNameKey_(hit.name);
  if (own) names[own] = true;
  return { key: key, name: csApptText_(hit.name), names: names };
}

/** Every row of one tab of the Dr Appointments book, header-keyed; a missing tab throws, never answers []. */
function csApptTabRows_(tab) {
  var src = estateSource_('drVisits');
  if (!src || !src.id) throw new Error('the Dr Appointments book is not configured');
  return cacheRead_(cacheScopeSheet_(src.id, tab), 'csAppt_' + tab, function () {
    try { depNote_(src.id, tab); } catch (eDep) {}
    var ss = ssOpen_(src.id);
    var sheet = ss.getSheetByName(tab);
    if (!sheet) throw new Error('the book has no "' + tab + '" tab');
    var tz = ss.getSpreadsheetTimeZone();
    var values = sheet.getDataRange().getValues();
    var rows = [];
    if (values.length < 2) return rows;
    var keys = values[0].map(estateKey_);
    for (var i = 1; i < values.length; i++) {
      var row = { id: 'r' + (i + 1) }, empty = true;
      for (var c = 0; c < keys.length; c++) {
        if (!keys[c]) continue;
        var v = estateCell_(values[i][c], tz);
        if (v) empty = false;
        row[keys[c]] = v;
      }
      if (!empty) rows.push(row);
    }
    return rows;
  });
}

/** One whole source: its rows, or why it could not be read. An archive that answers no row at all is not read. */
function csApptSource_(what, read, wholeMayBeEmpty) {
  try {
    var rows = read();
    if (!rows.length && !wholeMayBeEmpty) return { rows: null, why: what + ' answered no row at all' };
    return { rows: rows, why: '' };
  } catch (e) {
    return { rows: null, why: csApptWhy_(what, e) };
  }
}

function csApptMine_(rows, col, names) {
  return (rows || []).filter(function (r) {
    var k = clientNameKey_(csApptText_(r[col]));
    return !!k && names[k] === true;
  });
}

/** A visit as the table draws it; the columns manager, manager_phone and upcoming? are not read. */
function csApptVisit_(r, source, today) {
  var day = apptDay_(r.appointment_date);
  var clock = csApptClock_(r.appointment_start_time);
  var dr = csApptText_(r.dr_name);
  var address = csApptText_(r.appointment_address);
  var van = csApptText_(r.wheelchair_van_required);
  var status = apptBucket_(day, '', today, '') === 'upcoming' ? 'Upcoming' : 'Past';
  var archived = source === CS_APPT_ARCHIVE;
  return {
    id: (archived ? '' : 'future:') + String(r.id || ''),
    record: dr || 'Doctor visit', date: day, details: address, status: status,
    client_name: csApptText_(r.client_name), time: clock.label, time_24: clock.hm,
    dr_name: dr, dr_address: address, van: /^y/i.test(van), van_answer: van,
    date_written: csApptText_(r.appointment_date), submitted: csApptText_(r.timestamp),
    // the witness is the name cell as the estate's update reads it back, spaces and all
    source: source, also_in: [], editable: archived, witness: String(r.client_name == null ? '' : r.client_name), doctor_id: ''
  };
}

function csApptSame_(v) {
  return [clientNameKey_(v.client_name), v.date, v.time_24 || clientNameKey_(v.time), clientNameKey_(v.dr_name)].join('|');
}

/** Upcoming soonest first, then past newest first; an undated upcoming visit last among the upcoming. */
function csApptOrder_(a, b) {
  if (a.status !== b.status) return a.status === 'Upcoming' ? -1 : 1;
  var ka = (a.date || '9999-99-99') + ' ' + (a.time_24 || '99:99');
  var kb = (b.date || '9999-99-99') + ' ' + (b.time_24 || '99:99');
  if (ka === kb) return 0;
  return (a.status === 'Upcoming') === (ka < kb) ? -1 : 1;
}

/** The archive's visits with every Future Apts row it does not already carry; a carried one is marked, not doubled. */
function csApptVisits_(archive, future, today) {
  var rows = (archive || []).map(function (r) { return csApptVisit_(r, CS_APPT_ARCHIVE, today); });
  var byKey = {};
  rows.forEach(function (v) {
    var k = csApptSame_(v);
    if (!byKey[k]) byKey[k] = [];
    byKey[k].push(v);
  });
  (future || []).forEach(function (r) {
    var v = csApptVisit_(r, CS_APPT_FUTURE, today);
    var twins = byKey[csApptSame_(v)] || [];
    var twin = null;
    for (var i = 0; i < twins.length && !twin; i++) if (twins[i].also_in.indexOf(CS_APPT_FUTURE) === -1) twin = twins[i];
    if (twin) twin.also_in.push(CS_APPT_FUTURE);
    else rows.push(v);
  });
  rows.sort(csApptOrder_);
  return rows;
}

function csApptWords_(name) {
  return String(name || '').toLowerCase().split(/[^a-z]+/).filter(function (w) {
    return w.length >= 2 && CS_APPT_NOT_A_NAME.indexOf(w) === -1;
  });
}

function csApptDoctor_(r) {
  var nextWritten = csApptText_(r.next_visit);
  var next = apptDay_(nextWritten);
  return {
    id: String(r.id || ''), record: csApptText_(r.dr_name) || 'Doctor', date: next,
    details: csApptText_(r.specialist), status: csApptText_(r.status) || csApptText_(r.active_or_discontinued),
    specialist: csApptText_(r.specialist), dr_name: csApptText_(r.dr_name), address: csApptText_(r.address),
    phone: csApptText_(r.phone), fax: csApptText_(r.fax), next_visit: nextWritten,
    next_visit_source: next ? 'sheet' : '', next_booked: null, last_visit: csApptText_(r.last_visit),
    last_seen: '', standard_freq: csApptText_(r.standard_freq), notes: csApptText_(r.notes),
    active_or_discontinued: csApptText_(r.active_or_discontinued)
  };
}

// A visit names a doctor when the doctor's last name-word is in the visit's doctor field and no other doctor of…
function csApptJoin_(doctors, visits) {
  var marks = {};
  doctors.forEach(function (d) {
    var w = csApptWords_(d.dr_name);
    d._mark = w.length ? w[w.length - 1] : '';
    if (d._mark) marks[d._mark] = (marks[d._mark] || 0) + 1;
  });
  var byId = {};
  doctors.forEach(function (d) { byId[d.id] = d; });
  visits.forEach(function (v) {
    var words = csApptWords_(v.dr_name);
    var hits = doctors.filter(function (d) { return d._mark && marks[d._mark] === 1 && words.indexOf(d._mark) !== -1; });
    if (hits.length === 1) v.doctor_id = hits[0].id;
  });
  visits.forEach(function (v) {
    var d = v.doctor_id ? byId[v.doctor_id] : null;
    if (!d || !v.date) return;
    if (v.status === 'Upcoming' && (!d.next_booked || v.date < d.next_booked.date)) {
      d.next_booked = { date: v.date, time: v.time, id: v.id };
    }
    if (v.status === 'Past' && v.date > d.last_seen) d.last_seen = v.date;
  });
  doctors.forEach(function (d) {
    delete d._mark;
    if (!d.date && d.next_booked) { d.date = d.next_booked.date; d.next_visit_source = 'visits'; }
  });
}

function csApptVisitKpis_(rows) {
  var up = rows.filter(function (v) { return v.status === 'Upcoming'; });
  var past = rows.filter(function (v) { return v.status === 'Past'; });
  var next = up.filter(function (v) { return v.date; })[0] || null;
  var last = past.filter(function (v) { return v.date; })[0] || null;
  return { total: rows.length, upcoming: up.length, past: past.length,
           upcoming_van: up.filter(function (v) { return v.van; }).length,
           next_date: next ? next.date : '', last_date: last ? last.date : '' };
}

function csApptDoctorKpis_(rows) {
  var active = rows.filter(function (d) { return /^active$/i.test(d.status); }).length;
  return { total: rows.length, active: active, other: rows.length - active };
}

function csApptStatusesOf_(rows) {
  var seen = {}, out = [];
  rows.forEach(function (r) { if (r.status && !seen[r.status]) { seen[r.status] = true; out.push(r.status); } });
  return out.sort();
}

/** The whole answer for one client; a source that did not answer says why on its tab, and its figures stay null. */
function csApptBuild_(ctx) {
  var asOf = new Date().toISOString();
  var today = csApptToday_();
  var archive = csApptSource_('The Dr Appt Archive', function () { return estateRows_('drVisits'); }, false);
  var future = csApptSource_('The Future Apts tab', function () { return csApptTabRows_(CS_APPT_FUTURE); }, true);
  var master = csApptSource_('The Dr Master tab', function () { return estateRows_('drAppointments'); }, false);

  var visits = csApptVisits_(csApptMine_(archive.rows, 'client_name', ctx.names),
                             csApptMine_(future.rows, 'client_name', ctx.names), today);
  var doctors = csApptMine_(master.rows, 'client', ctx.names).map(csApptDoctor_);
  csApptJoin_(doctors, visits);
  doctors.sort(function (a, b) {
    var aa = /^active$/i.test(a.status) ? 0 : 1, bb = /^active$/i.test(b.status) ? 0 : 1;
    return (aa - bb) || a.specialist.localeCompare(b.specialist) || a.dr_name.localeCompare(b.dr_name);
  });

  var visitWhy = [archive.why, future.why].filter(String).join('; ');
  var visitTab = { rows: visits, kpis: archive.rows ? csApptVisitKpis_(visits) : null,
                   statuses: CS_APPT_STATUSES.slice(), as_of: asOf };
  if (visitWhy) visitTab.why = visitWhy + '.';
  var doctorTab = { rows: doctors, kpis: master.rows ? csApptDoctorKpis_(doctors) : null,
                    statuses: csApptStatusesOf_(doctors), as_of: asOf };
  if (master.why) doctorTab.why = master.why + '.';
  return { client: { client_key: ctx.key, name: ctx.name },
           tabs: { visits: visitTab, doctors: doctorTab },
           degraded: !!(visitWhy || master.why) };
}

/** Keyed csa_appts_<client_key>, at most a minute old; the name carries the tabs' versions. A degraded answer is never kept. */
function csApptCached_(key, producer) {
  var scope = 'csa_appts_' + key;
  var name = 'v1_' + Math.floor(Date.now() / CS_APPT_TTL_MS);
  var src = null;
  try { src = estateSource_('drVisits'); } catch (e) { src = null; }
  [CS_APPT_ARCHIVE, CS_APPT_FUTURE, CS_APPT_MASTER].forEach(function (tab) {
    try { name += '_' + cacheVersion_(cacheScopeSheet_(src ? src.id : '', tab)); } catch (e) { name += '_x'; }
  });
  var value = cacheRead_(scope, name, producer);
  if (value && value.degraded) cacheBump_(scope);
  return value;
}

/** Appointments: the client's booked visits (Dr Appt Archive with Future Apts) and their doctors (Dr Master). */
HUB_POLICY.clientSourceAppointments = {
  file: 'ClientSourceAppointments.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' } }
};
HUB_ACTIONS.clientSourceAppointments = function (payload, user) {
  if (!csApptGate_(user, payload && payload.client)) return csApptUnknown_();
  return csApptDoor_(payload);
};

/** Past the gate — the door's answer, and the relay pack's part (clientPack). */
function csApptDoor_(payload) {
  var ctx = csApptClient_(payload && payload.client);
  if (ctx.refused) return ctx.refused;
  var data;
  try {
    data = csApptCached_(ctx.key, function () { return csApptBuild_(ctx); });
  } catch (e) {
    return { status: 503, message: csApptWhy_('The appointments', e) + '.' };
  }
  return { status: 200, data: data };
}
