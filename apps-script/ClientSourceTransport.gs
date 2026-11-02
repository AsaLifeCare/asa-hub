// Clients app › Transportation: one client's van trips, the shared fleet and the miles on shifts, read where they…
// Read as App Control releases Clients (csTransportGate_); a client or a family member is answered their trips…

var CS_TRANSPORT_ACTIONS = ['clientSourceTransport'];
var CS_TRANSPORT_VAN_PROP = 'HUB_VAN_CALENDAR_SHEET_ID';
var CS_TRANSPORT_VAN_FALLBACK = '15W2-gLb-Sn3ScLXxzdjZyDuVIZELNlhLK3C1rP21ngg';
var CS_TRANSPORT_REQUESTS_TAB = 'Requests';
var CS_TRANSPORT_CONFLICTS_TAB = 'Conflicts';
var CS_TRANSPORT_FORM_SLUG = 'van-calendar';
var CS_TRANSPORT_CACHE_S = 60;
var CS_TRANSPORT_CACHE_MAX = 95000;
var CS_TRANSPORT_TZ = 'America/New_York';
// Every status a trip can carry; the history KPIs count the first three.
var CS_TRANSPORT_STATUSES = ['Needs assignment', 'Scheduled', 'Completed', 'Check date', 'No booking', 'Cancelled'];
var CS_TRANSPORT_AVAILABILITY = ['Available', 'Partly Booked', 'Booked', 'Maintenance'];
var CS_TRANSPORT_RULE = 'Scheduled: a booked van on a day still ahead. Completed: a booked day that has passed — the ' +
  'Van Calendar records no drop-off. Needs assignment: a van-required day ahead with no vehicle booked, or one listed ' +
  'in an open conflict. No booking: a past van-required visit the Van Calendar never booked. Check date: the day ' +
  'is earlier than the request that booked it.';
var CS_TRANSPORT_AVAILABILITY_RULE = 'Booked when the day\'s bookings cover the van\'s whole observed window (the ' +
  'earliest start to the latest end on any request); Partly Booked with any booking; Maintenance while an open repair ' +
  'names the vehicle.';

// What a client or a family member is never answered: the office's fleet and the units billed on shifts.
var CS_TRANSPORT_OFFICE_TABS = ['vehicles', 'mileage'];
var CS_TRANSPORT_OFFICE_SOURCES = ['repairs', 'fleet', 'psi_punches'];

// FAIL-CLOSED: the Clients reader for this client — the master in its own session, else as App Control releases…
function csTransportGate_(user, client) {
  try {
    if (hubIsRealMaster_(user)) return { kind: 'master', keys: null };
    return clientProfilesReaderFor_(user, client) || null;
  } catch (e) { return null; }
}

/** A client's or a family's answer: their trips (Calendar, History) without the fleet, the miles or their books. */
function csTransportOwn_(data) {
  var out = {}, tabs = {};
  Object.keys(data || {}).forEach(function (k) { out[k] = data[k]; });
  Object.keys((data && data.tabs) || {}).forEach(function (t) {
    if (CS_TRANSPORT_OFFICE_TABS.indexOf(t) === -1) tabs[t] = data.tabs[t];
  });
  out.tabs = tabs;
  out.sources = ((data && data.sources) || []).filter(function (s) {
    return CS_TRANSPORT_OFFICE_SOURCES.indexOf(s && s.id) === -1;
  });
  return out;
}

function csTransportErr_(e) {
  return String((e && e.message) || e).slice(0, 120);
}

function csTransportToday_() {
  var now = (typeof hubQuietNow_ === 'function') ? hubQuietNow_() : new Date();
  try { return Utilities.formatDate(now, CS_TRANSPORT_TZ, 'yyyy-MM-dd'); }
  catch (e) { return now.toISOString().slice(0, 10); }
}

function csTransportText_(v, max) {
  var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return max ? s.slice(0, max) : s;
}

/** "11/17/2025", "11/17/2025 10:14:07", "2025-11-17…", "Wednesday, September 25, 2024" → "2025-11-17"; '' otherwise. */
function csTransportDay_(v) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    try { return Utilities.formatDate(v, CS_TRANSPORT_TZ, 'yyyy-MM-dd'); } catch (e) { return v.toISOString().slice(0, 10); }
  }
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  // An instant (…T02:00:00Z) is a day in New York, not in UTC.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    var at = new Date(s);
    if (!isNaN(at.getTime())) return csTransportDay_(at);
  }
  var y, m, d;
  var iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/.exec(s);
  var us = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:\s|,|$)/.exec(s);
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else if (us) { m = +us[1]; d = +us[2]; y = +us[3]; if (y < 100) y += 2000; }
  else if (/^(?:[A-Za-z]+,\s*)?[A-Za-z]{3,}\.?\s+\d{1,2},?\s+\d{4}$/.test(s)) {
    var t = Date.parse(s.replace(/^[A-Za-z]+,\s*(?=[A-Za-z]{3,}\.?\s+\d)/, ''));
    if (isNaN(t)) return '';
    var dt = new Date(t);
    y = dt.getFullYear(); m = dt.getMonth() + 1; d = dt.getDate();
  } else return '';
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return '';
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
}

/** "9:45:00 AM", "9:45 am", "14:05" → minutes after midnight; null for anything else. */
function csTransportClock_(v) {
  var s = String(v == null ? '' : v).trim();
  var m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:([AaPp])\.?\s*[Mm]\.?)?$/.exec(s);
  if (!m) return null;
  var h = +m[1], min = +m[2];
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0);
  } else if (h > 23) return null;
  return h * 60 + min;
}

function csTransportClockLabel_(min) {
  if (min === null || min === undefined || isNaN(min)) return '';
  var h = Math.floor(min / 60), mm = min % 60;
  return ((h % 12) || 12) + ':' + ('0' + mm).slice(-2) + ' ' + (h < 12 ? 'AM' : 'PM');
}

/** "5:30 PM - 6:00 PM" → {start, end} in minutes; nulls when a side does not read. */
function csTransportSpan_(v) {
  var parts = String(v == null ? '' : v).split(/\s*[-–—]\s*|\s+to\s+/i);
  return { start: csTransportClock_(parts[0]), end: parts.length > 1 ? csTransportClock_(parts[1]) : null };
}

/** A person's folded name both ways round when the cell is "Last, First" or "First, Last". */
function csTransportNameKeys_(v) {
  var s = String(v == null ? '' : v).trim();
  var out = [];
  var k = clientNameKey_(s);
  if (k) out.push(k);
  var parts = s.split(',');
  if (parts.length === 2) {
    var r = clientNameKey_(parts[1] + ' ' + parts[0]);
    if (r && out.indexOf(r) === -1) out.push(r);
  }
  return out;
}

function csTransportNamed_(names, v) {
  return csTransportNameKeys_(v).some(function (k) { return !!names[k]; });
}

/** The client a request names: 400 blank, 503 unreadable, 404 unknown; never a guess. */
function csTransportClient_(raw) {
  var key = String(raw == null ? '' : raw).trim();
  if (!key) return { refused: { status: 400, message: 'client: a client_key.' } };
  var rows;
  try { rows = clientsDerived_(null) || []; }
  catch (e) { return { refused: { status: 503, message: 'The clients could not be read (' + csTransportErr_(e) + ').' } }; }
  var hit = null;
  rows.forEach(function (r) {
    if (hit || !r) return;
    var k = String(r.client_key || '').trim() || clientNameKey_(r.name);
    if (k === key) hit = r;
  });
  if (!hit) return { refused: { status: 404, message: 'No client with that client_key is on file.' } };
  var client = { client_key: key, name: csTransportText_(hit.name) || key };
  var names = {};
  [client.name, key].forEach(function (v) { csTransportNameKeys_(v).forEach(function (n) { names[n] = true; }); });
  if (typeof hubClientIdentity_ === 'function') {
    try {
      var id = hubClientIdentity_(key);
      for (var n in ((id && id.names) || {})) names[n] = true;
    } catch (eId) { /* the key and the name still identify */ }
  }
  return { client: client, names: names };
}

/** Kept 60 s; a degraded answer is never kept. */
function csTransportCache_(key, producer) {
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
  if (cache) {
    try {
      var hit = cache.get(key);
      if (hit) return JSON.parse(hit);
    } catch (eHit) { /* a miss */ }
  }
  var value = producer();
  if (cache && value && !value.degraded) {
    try {
      var text = JSON.stringify(value);
      if (text.length < CS_TRANSPORT_CACHE_MAX) cache.put(key, text, CS_TRANSPORT_CACHE_S);
    } catch (ePut) { /* served uncached */ }
  }
  return value;
}

// ---- the Van Calendar book --------------------------------------------------

function csTransportBookId_() {
  var id = '';
  try { id = String(hubProp_(CS_TRANSPORT_VAN_PROP) || '').trim(); } catch (e) { id = ''; }
  return id || CS_TRANSPORT_VAN_FALLBACK;
}

function csTransportHeadIndex_(head, patterns) {
  var at = {};
  Object.keys(patterns).forEach(function (k) {
    at[k] = -1;
    for (var i = 0; i < head.length; i++) {
      if (patterns[k].test(head[i])) { at[k] = i; break; }
    }
  });
  return at;
}

// The Requests tab as display text.
function csTransportRequests_(values) {
  var head = (values[0] || []).map(function (h) { return String(h == null ? '' : h).trim().toLowerCase(); });
  var C = csTransportHeadIndex_(head, {
    status: /^status$/, event: /^event id$/, vehicle: /^select vehicle$/, ts: /^timestamp$/, staff: /^your name$/,
    client: /^client name$/, date: /^date\b/, start: /^start time$/, end: /^end time$/, why: /^why\b/,
    dest: /^destination/
  });
  if (C.client < 0 || C.date < 0) throw new Error('the Requests tab has no Client Name or Date column');
  var out = { rows: [], total: 0, realigned: 0, unread: 0 };
  for (var r = 1; r < values.length; r++) {
    var line = (values[r] || []).map(function (v) { return String(v == null ? '' : v).trim(); });
    if (!line.some(function (v) { return v !== ''; })) continue;
    out.total++;
    var shifted = C.event >= 0 && !!csTransportDay_(line[C.client]) && !csTransportDay_(line[C.date]) &&
                  csTransportClock_(line[C.date]) !== null;
    if (shifted) {
      line = line.slice(0, C.event).concat([''], line.slice(C.event));
      out.realigned++;
    }
    var get = function (k) { return C[k] >= 0 ? csTransportText_(line[C[k]]) : ''; };
    var day = csTransportDay_(get('date'));
    if (!day || !get('client')) { out.unread++; continue; }
    out.rows.push({
      row: r + 1, status: get('status'), event_id: get('event'), vehicle: get('vehicle'), requested_at: get('ts'),
      staff: get('staff'), client: get('client'), date: day, start: get('start'), end: get('end'),
      reason: get('why'), destination: get('dest'), realigned: shifted
    });
  }
  return out;
}

function csTransportConflicts_(values) {
  var head = (values[0] || []).map(function (h) { return String(h == null ? '' : h).trim().toLowerCase(); });
  var C = csTransportHeadIndex_(head, {
    status: /^status$/, date: /^date$/, clients: /^clients? in conflict/, time: /^conflict time/, notes: /^notes?$/
  });
  if (C.clients < 0 || C.date < 0) throw new Error('the Conflicts tab has no Date or Clients in Conflict column');
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var line = values[r] || [];
    var get = function (k) { return C[k] >= 0 ? csTransportText_(line[C[k]]) : ''; };
    var day = csTransportDay_(get('date'));
    if (!day || !get('clients')) continue;
    rows.push({ row: r + 1, status: get('status'), date: day, clients: get('clients'), time: get('time'),
                notes: C.notes >= 0 ? csTransportText_(line[C.notes], 300) : '' });
  }
  return rows;
}

/** Both tabs, kept 60 s together; a tab that did not read carries its sentence and nothing is kept. */
function csTransportBook_() {
  var id = csTransportBookId_();
  return csTransportCache_('cst_book_v1_' + id, function () {
    var out = { id: id, requests: null, conflicts: null, requests_why: '', conflicts_why: '', total: 0,
                realigned: 0, unread: 0, degraded: false };
    var ss = null;
    try { ss = ssOpen_(id); } catch (eO) {
      out.requests_why = out.conflicts_why = 'the Van Calendar book could not be opened (' + csTransportErr_(eO) + ')';
      out.degraded = true;
      return out;
    }
    try {
      var rq = ss.getSheetByName(CS_TRANSPORT_REQUESTS_TAB);
      if (!rq) throw new Error('the book has no ' + CS_TRANSPORT_REQUESTS_TAB + ' tab');
      var parsed = csTransportRequests_(rq.getDataRange().getDisplayValues());
      out.requests = parsed.rows;
      out.total = parsed.total;
      out.realigned = parsed.realigned;
      out.unread = parsed.unread;
    } catch (eR) {
      out.requests_why = 'the Van Calendar requests could not be read (' + csTransportErr_(eR) + ')';
      out.degraded = true;
    }
    try {
      var cf = ss.getSheetByName(CS_TRANSPORT_CONFLICTS_TAB);
      if (!cf) throw new Error('the book has no ' + CS_TRANSPORT_CONFLICTS_TAB + ' tab');
      out.conflicts = csTransportConflicts_(cf.getDataRange().getDisplayValues());
    } catch (eC) {
      out.conflicts_why = 'the Van Calendar conflicts could not be read (' + csTransportErr_(eC) + ')';
      out.degraded = true;
    }
    return out;
  });
}

// ---- the other sources ------------------------------------------------------

/** The Hub form's own submissions (slug van-calendar, van-calendar-2, …), shaped as book requests. */
function csTransportFormRows_() {
  var rows;
  try { rows = listRows_('formSubmissions', {}) || []; }
  catch (e) { return { rows: null, why: 'the Hub form submissions could not be read (' + csTransportErr_(e) + ')' }; }
  var out = [];
  rows.forEach(function (s) {
    var slug = String((s && s.form_slug) || '').trim().toLowerCase();
    if (slug !== CS_TRANSPORT_FORM_SLUG && slug.indexOf(CS_TRANSPORT_FORM_SLUG + '-') !== 0) return;
    var a = {};
    try { a = JSON.parse(String(s.answers || '{}')) || {}; } catch (eA) { a = {}; }
    var day = csTransportDay_(a.date_day_client_needs_the_van);
    if (!day || !String(a.client_name || '').trim()) return;
    out.push({
      id: String(s.id || ''), status: String(s.state || ''), vehicle: csTransportText_(a.select_vehicle),
      requested_at: String(s.submitted_at || ''), staff: csTransportText_(a.your_name || s.name),
      client: csTransportText_(a.client_name), date: day, start: csTransportText_(a.start_time),
      end: csTransportText_(a.end_time), reason: csTransportText_(a.why_does_the_client_need_the_van),
      destination: csTransportText_(a.destination_address, 300)
    });
  });
  return { rows: out, why: '' };
}

function csTransportVisitRows_() {
  try {
    var rows = (estateRows_('drVisits') || []).filter(function (r) {
      return /^y/i.test(String((r && r.wheelchair_van_required) || '').trim());
    });
    return { rows: rows, why: '' };
  } catch (e) {
    return { rows: null, why: 'the Dr Appt Archive could not be read (' + csTransportErr_(e) + ')' };
  }
}

/** Dr Appt Archive's cache version: an appointment save retires the kept trips with it. */
function csTransportVisitsVersion_() {
  try {
    var src = estateSource_('drVisits');
    return String(cacheVersion_(cacheScopeSheet_(src ? src.id : '', src ? src.tab : '')));
  } catch (e) { return 'x'; }
}

function csTransportRepairRows_() {
  try { return { rows: estateRows_('workOrders') || [], why: '' }; }
  catch (e) { return { rows: null, why: 'the repairs could not be read (' + csTransportErr_(e) + ')' }; }
}

function csTransportFleetRows_() {
  try { return { rows: listRows_('fleetVehicles', {}) || [], why: '' }; }
  catch (e) { return { rows: null, why: 'the fleet list could not be read (' + csTransportErr_(e) + ')' }; }
}

/** Only the punches that logged units, with the feed's newest day; kept 60 s for every client. */
function csTransportPunchRows_() {
  return csTransportCache_('cst_punch_v1', function () {
    try {
      var sheet = psiPunchesFullSheet_();
      if (!sheet) return { rows: null, why: 'the PSI punch house is not declared', degraded: true };
      var newest = '', rows = [];
      (psiPunchesRows_(sheet).rows || []).forEach(function (p) {
        var d = csTransportDay_(p.date_iso);
        if (d > newest) newest = d;
        if (!(Number(String(p.transportation_units == null ? '' : p.transportation_units).replace(/,/g, '')) > 0)) return;
        rows.push({ id: String(p.id || p.single_entry_id || ''), employee: p.employee, date_iso: p.date_iso,
                    date_service: p.date_service, start_time: p.start_time, end_time: p.end_time, hours: p.hours,
                    transportation_units: p.transportation_units, work_code: p.work_code, status: p.status,
                    consumer_1: p.consumer_1, consumer_2: p.consumer_2, consumer_3: p.consumer_3 });
      });
      return { rows: rows, newest: newest, why: '' };
    } catch (e) {
      return { rows: null, why: 'the PSI punches could not be read (' + csTransportErr_(e) + ')', degraded: true };
    }
  });
}

// ---- the trips --------------------------------------------------------------

function csTransportTrip_(src, id, r) {
  var start = csTransportClock_(r.start), end = csTransportClock_(r.end);
  return {
    id: id, source: src, sheet_row: r.row || 0, date: r.date,
    start: start, end: end,
    time: csTransportClockLabel_(start) || r.start || '', end_time: csTransportClockLabel_(end) || r.end || '',
    reason: r.reason || '', destination: r.destination || '', staff: r.staff || '',
    requested_at: r.requested_at || '', requested_on: csTransportDay_(r.requested_at),
    vehicle: r.vehicle || '', event_id: r.event_id || '', book_status: r.status || '', realigned: !!r.realigned,
    requests: 1, dr_name: '', dr_address: '', visit_id: '', conflict: '', conflict_time: '', conflict_open: false
  };
}

function csTransportTripKey_(t) {
  return t.date + '|' + (t.start === null ? t.time : t.start) + '|' + clientNameKey_(t.vehicle);
}

/** A trip's status from its own facts (CS_TRANSPORT_RULE). */
function csTransportStatus_(t, today) {
  if (/cancel/i.test(t.book_status)) return 'Cancelled';
  var ahead = t.date >= today;
  if (!t.vehicle) return ahead ? 'Needs assignment' : 'No booking';
  if (ahead) return t.conflict_open ? 'Needs assignment' : 'Scheduled';
  if (t.requested_on && t.requested_on > t.date) return 'Check date';
  return 'Completed';
}

/** Hub form requests the book does not already carry (same client, day and start). */
function csTransportFormOnly_(requests, form) {
  var seen = {};
  (requests || []).forEach(function (r) {
    var ck = csTransportNameKeys_(r.client)[0] || '';
    seen[ck + '|' + r.date + '|' + csTransportClock_(r.start)] = true;
    seen[ck + '|' + r.date + '|any'] = true;
  });
  return (form || []).filter(function (r) {
    var ck = csTransportNameKeys_(r.client)[0] || '';
    var start = csTransportClock_(r.start);
    return !seen[ck + '|' + r.date + '|' + start] && !(start === null && seen[ck + '|' + r.date + '|any']);
  });
}

/** Does a cell listing people ("A, B & C") name this client? The whole cell is tried too, for "Last, First". */
function csTransportListNames_(names, cell) {
  return csTransportNamed_(names, cell) ||
    String(cell || '').split(/\s*(?:,|;|&|\/|\n|\band\b)\s*/i).some(function (p) { return csTransportNamed_(names, p); });
}

/** The client's trips: book requests, then Hub form requests, then van visits no request covers. */
function csTransportTrips_(names, src, today) {
  var trips = [], byKey = {}, bookedDay = {}, byDay = {};
  // The same day, clock and vehicle filed twice is one trip: the first row stands, a blank it left is filled.
  var add = function (t) {
    var k = csTransportTripKey_(t);
    var was = byKey[k];
    if (!was) { byKey[k] = t; trips.push(t); return; }
    was.requests += 1;
    ['end', 'end_time', 'staff', 'destination', 'reason', 'event_id'].forEach(function (f) {
      if ((was[f] === '' || was[f] === null) && t[f] !== '' && t[f] !== null) was[f] = t[f];
    });
  };
  // the vehicle calendar's own trips first; a Van Calendar row it imported is then shown once, as that trip
  ((src.vc && src.vc.rows) || []).forEach(function (t) { trips.push(t); });
  (src.requests || []).forEach(function (r) {
    if (src.vc && src.vc.refs && src.vc.refs['van_calendar:r' + r.row]) return;
    if (csTransportNamed_(names, r.client)) add(csTransportTrip_('van_calendar', 'vc' + r.row, r));
  });
  (src.form || []).forEach(function (r) {
    if (csTransportNamed_(names, r.client)) add(csTransportTrip_('hub_form', 'hf' + r.id, r));
  });
  trips.forEach(function (t) { (bookedDay[t.date] = bookedDay[t.date] || []).push(t); });
  (src.visits || []).forEach(function (v) {
    if (!csTransportNamed_(names, v.client_name)) return;
    var day = csTransportDay_(v.appointment_date);
    if (!day) return;
    var dr = csTransportText_(v.dr_name), addr = csTransportText_(v.appointment_address, 300);
    var at = csTransportClock_(v.appointment_start_time);
    var booked = bookedDay[day];
    if (booked && booked.length) {
      var free = booked.filter(function (t) { return !t.visit_id; });
      free.sort(function (a, b) {
        var da = (a.start === null || at === null) ? 0 : Math.abs(a.start - at);
        var db = (b.start === null || at === null) ? 0 : Math.abs(b.start - at);
        return da - db;
      });
      if (free.length) { free[0].visit_id = String(v.id || ''); free[0].dr_name = dr; free[0].dr_address = addr; }
      return;
    }
    var t = csTransportTrip_('dr_visits', 'dv' + String(v.id || ''), {
      date: day, start: String(v.appointment_start_time || ''), end: '', reason: '', destination: addr,
      staff: csTransportText_(v.manager), requested_at: String(v.timestamp || ''), vehicle: '', status: ''
    });
    t.visit_id = String(v.id || '');
    t.dr_name = dr;
    t.dr_address = addr;
    trips.push(t);
  });
  trips.forEach(function (t) { (byDay[t.date] = byDay[t.date] || []).push(t); });
  (src.conflicts || []).forEach(function (c) {
    if (!csTransportListNames_(names, c.clients)) return;
    var span = csTransportSpan_(c.time);
    (byDay[c.date] || []).forEach(function (t) {
      var overlaps = span.start === null || t.start === null ||
        (t.start <= (span.end === null ? span.start : span.end) && (t.end === null ? t.start : t.end) >= span.start);
      if (!overlaps) return;
      t.conflict = c.status || 'Listed';
      t.conflict_time = c.time;
      t.conflict_open = /unresolv/i.test(c.status) || !/resolv|closed|done|cleared|fixed/i.test(c.status);
    });
  });
  trips.forEach(function (t) {
    if (t.source === 'vehicle_calendar') return;
    t.status = csTransportStatus_(t, today);
    t.record = t.reason || (t.dr_name ? t.dr_name : '') || 'Van trip';
    t.assignment = t.vehicle;
    t.reserved_time = t.time ? (t.end_time ? t.time + ' – ' + t.end_time : t.time) : '';
    t.details = [t.vehicle || 'No vehicle booked', t.reserved_time, t.destination || t.dr_address].filter(function (x) { return !!x; }).join(' · ');
  });
  return trips;
}

function csTransportByDay_(dir) {
  return function (a, b) {
    if (a.date !== b.date) return dir * (a.date < b.date ? -1 : 1);
    var x = a.start === null ? 9999 : a.start, y = b.start === null ? 9999 : b.start;
    return dir * (x - y);
  };
}

// ---- the fleet --------------------------------------------------------------

/** The earliest start and latest end on any request with both clocks: the van's observed day. */
function csTransportWindow_(requests) {
  var lo = null, hi = null;
  (requests || []).forEach(function (r) {
    var s = csTransportClock_(r.start), e = csTransportClock_(r.end);
    if (s === null || e === null || e <= s) return;
    if (lo === null || s < lo) lo = s;
    if (hi === null || e > hi) hi = e;
  });
  return lo === null ? null : { start: lo, end: hi };
}

function csTransportCovers_(bookings, win) {
  if (!win) return false;
  var spans = bookings.filter(function (b) { return b.start !== null && b.end !== null && b.end > b.start; })
    .map(function (b) { return [b.start, b.end]; })
    .sort(function (a, b) { return a[0] - b[0]; });
  var reach = win.start;
  for (var i = 0; i < spans.length; i++) {
    if (spans[i][0] > reach) return false;
    if (spans[i][1] > reach) reach = spans[i][1];
    if (reach >= win.end) return true;
  }
  return reach >= win.end;
}

/** "Wheelchair Van - 1" → "wheelchairvan": a repair filed against the plain name still names the one van. */
function csTransportBaseKey_(name) {
  return clientNameKey_(String(name || '').replace(/\s*(?:[-#–]\s*|\bno\.?\s*|\bunit\s*)\d+\s*$/i, ''));
}

/** Every vehicle any request names or the fleet list holds, with its availability on `date`. */
function csTransportVehicles_(names, src, date, tripIds) {
  var byKey = {}, order = [];
  var vehicleFor = function (name) {
    var key = clientNameKey_(name);
    if (!key) return null;
    if (!byKey[key]) {
      byKey[key] = { key: key, name: csTransportText_(name), requests: 0, clients: {}, first: '', last: '', bookings: [],
                     seen: {}, fleet: null, repairs: [], open: [] };
      order.push(key);
    }
    return byKey[key];
  };
  var reqs = (src.requests || []).concat(src.form || []);
  reqs.forEach(function (r) {
    var v = vehicleFor(r.vehicle);
    if (!v) return;
    v.requests++;
    var ck = csTransportNameKeys_(r.client)[0] || '';
    if (ck) v.clients[ck] = true;
    if (!v.first || r.date < v.first) v.first = r.date;
    if (!v.last || r.date > v.last) v.last = r.date;
    if (r.date !== date) return;
    var start = csTransportClock_(r.start), end = csTransportClock_(r.end);
    var seenKey = ck + '|' + (start === null ? r.start : start);
    if (v.seen[seenKey]) return;
    v.seen[seenKey] = true;
    var mine = csTransportNamed_(names, r.client);
    var tripKey = r.date + '|' + (start === null ? csTransportText_(r.start) : start) + '|' + v.key;
    v.bookings.push({
      start: start, end: end, time: csTransportClockLabel_(start) || r.start, end_time: csTransportClockLabel_(end) || r.end,
      mine: mine, trip_id: mine ? ((tripIds || {})[tripKey] || '') : '',
      record: mine ? r.reason : '', destination: mine ? r.destination : '', who: mine ? 'This client' : 'Another client'
    });
  });
  // the vehicle calendar's platform trips that day, on the vehicle any of its names already lists
  ((src.vc && src.vc.bookings) || []).forEach(function (b) {
    if (b.date !== date) return;
    var hit = '';
    [b.vehicle].concat(b.aliases || []).forEach(function (a) { var k = clientNameKey_(a); if (!hit && k && byKey[k]) hit = k; });
    var v = hit ? byKey[hit] : vehicleFor(b.vehicle);
    if (!v) return;
    var mine = csTransportNamed_(names, b.client);
    v.bookings.push({ start: b.start, end: b.end, time: b.time, end_time: b.end_time, mine: mine, trip_id: mine ? b.id : '',
                      record: mine ? b.record : '', destination: mine ? b.destination : '',
                      who: mine ? 'This client' : 'Another client' });
  });
  (src.fleet || []).forEach(function (f) {
    if (/retired/i.test(String(f.status || ''))) return;
    var keys = [clientNameKey_(f.unit), clientNameKey_(f.vehicle)].filter(function (k) { return !!k; });
    (f.aliases || []).forEach(function (a) { var k = clientNameKey_(a); if (k && keys.indexOf(k) === -1) keys.push(k); });
    var v = null;
    keys.forEach(function (k) { if (!v && byKey[k]) v = byKey[k]; });
    if (!v) v = vehicleFor(f.unit || f.vehicle);
    if (!v) return;
    v.fleet = { unit: csTransportText_(f.unit), vehicle: csTransportText_(f.vehicle), year: csTransportText_(f.year),
                plate: csTransportText_(f.plate), status: csTransportText_(f.status) };
  });
  var bases = {};
  order.forEach(function (k) { var b = csTransportBaseKey_(byKey[k].name); if (b) (bases[b] = bases[b] || []).push(k); });
  (src.repairs || []).forEach(function (r) {
    var target = clientNameKey_(r.select_address_vehicle);
    if (!target) return;
    var key = byKey[target] ? target : (bases[target] && bases[target].length === 1 ? bases[target][0] : '');
    if (!key) return;
    var v = byKey[key];
    var status = csTransportText_(r.status);
    var rep = { id: String(r.id || ''), date: csTransportDay_(r.timestamp), issue: csTransportText_(r.please_describe_the_issue, 300),
                repair_type: csTransportText_(r.repair_type), status: status || 'Open',
                resolution: csTransportText_(r.resolution_notes, 300) };
    v.repairs.push(rep);
    if (!/complet|cancel|closed|done|resolved/i.test(status) && (!rep.date || rep.date <= date)) v.open.push(rep);
  });
  var win = csTransportWindow_(reqs);
  var rows = order.map(function (k) {
    var v = byKey[k];
    v.bookings.sort(function (a, b) { return (a.start === null ? 9999 : a.start) - (b.start === null ? 9999 : b.start); });
    var status = v.open.length || (v.fleet && /service|shop|repair/i.test(v.fleet.status)) ? 'Maintenance'
      : !v.bookings.length ? 'Available' : csTransportCovers_(v.bookings, win) ? 'Booked' : 'Partly Booked';
    var clients = Object.keys(v.clients).length;
    var facts = [];
    if (v.fleet) facts.push([v.fleet.vehicle, v.fleet.year, v.fleet.plate].filter(function (x) { return !!x; }).join(' · '));
    if (v.requests) facts.push('Named on ' + v.requests + ' request' + (v.requests === 1 ? '' : 's') + ' for ' + clients +
                              ' client' + (clients === 1 ? '' : 's') + ', ' + v.first + ' to ' + v.last);
    v.repairs.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return {
      id: 'veh_' + k, record: v.name, vehicle: v.name, date: date, status: status,
      details: facts.filter(function (x) { return !!x; }).join('; ') || 'On the fleet list',
      requests_total: v.requests, clients_total: clients, first_date: v.first, last_date: v.last,
      bookings: v.bookings, maintenance: v.open, repairs: v.repairs.slice(0, 10), fleet: v.fleet
    };
  });
  rows.sort(function (a, b) { return b.requests_total - a.requests_total || a.vehicle.localeCompare(b.vehicle); });
  return { rows: rows, window: win ? { start: csTransportClockLabel_(win.start), end: csTransportClockLabel_(win.end) } : null };
}

// ---- the miles on shifts ----------------------------------------------------

function csTransportMiles_(names, punches) {
  var rows = [];
  (punches || []).forEach(function (p) {
    var units = Number(String(p.transportation_units == null ? '' : p.transportation_units).replace(/,/g, ''));
    if (!(units > 0)) return;
    var withClient = [p.consumer_1, p.consumer_2, p.consumer_3].some(function (c) { return csTransportNamed_(names, c); });
    if (!withClient) return;
    var day = csTransportDay_(p.date_iso) || csTransportDay_(p.date_service);
    if (!day) return;
    var start = csTransportText_(p.start_time), end = csTransportText_(p.end_time);
    rows.push({
      id: 'psi' + String(p.id || p.single_entry_id || rows.length), record: csTransportText_(p.employee) || 'Shift',
      date: day, status: 'Logged', units: Math.round(units * 100) / 100,
      details: units + ' transportation unit' + (units === 1 ? '' : 's') + (start ? ' · ' + start + (end ? ' – ' + end : '') : '') +
               (p.work_code ? ' · ' + csTransportText_(p.work_code) : ''),
      employee: csTransportText_(p.employee), start_time: start, end_time: end, hours: csTransportText_(p.hours),
      work_code: csTransportText_(p.work_code), psi_status: csTransportText_(p.status)
    });
  });
  rows.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  return rows;
}

// ---- the answer -------------------------------------------------------------

function csTransportJoin_(list) {
  return list.filter(function (x) { return !!x; }).join('; ');
}

/** Pure: every source in hand (rows, or null with why) → the four tabs. */
function csTransportAnswer_(ctx) {
  var today = ctx.today, date = ctx.date, book = ctx.book;
  var src = {
    requests: book.requests, conflicts: book.conflicts, form: csTransportFormOnly_(book.requests, ctx.form.rows),
    visits: ctx.visits.rows, repairs: ctx.repairs.rows, fleet: ctx.fleet.rows
  };
  if (ctx.vc) {
    src.vc = ctx.vc;
    if (ctx.vc.vehicles && ctx.vc.vehicles.length) src.fleet = (src.fleet || []).concat(ctx.vc.vehicles);
  }
  var trips = csTransportTrips_(ctx.names, src, today);
  var tripIds = {};
  trips.forEach(function (t) { tripIds[csTransportTripKey_(t)] = t.id; });
  var bookRead = book.requests !== null;
  var readNote = bookRead && book.unread ? book.unread + ' Van Calendar request row' + (book.unread === 1 ? '' : 's') +
    ' carried no readable day or client and are not shown' : '';
  var tripWhy = csTransportJoin_([book.requests_why, book.conflicts_why, ctx.visits.why, ctx.form.why]);
  var newest = '';
  (book.requests || []).concat(ctx.form.rows || []).forEach(function (r) {
    var d = csTransportDay_(r.requested_at);
    if (d > newest) newest = d;
  });
  var count = function (s) { return trips.filter(function (t) { return t.status === s; }).length; };
  var statuses = CS_TRANSPORT_STATUSES.filter(function (s) { return count(s) > 0; });
  var vehiclesSeen = [];
  trips.forEach(function (t) { if (t.vehicle && vehiclesSeen.indexOf(t.vehicle) === -1) vehiclesSeen.push(t.vehicle); });
  var history = trips.slice().sort(csTransportByDay_(-1));
  // The grid's own cut of each trip; the whole trip is its history row, found by id.
  var calendar = trips.slice().sort(csTransportByDay_(1)).map(function (t) {
    return { id: t.id, record: t.record, date: t.date, details: t.details, status: t.status, time: t.time,
             end_time: t.end_time, vehicle: t.vehicle, destination: t.destination || t.dr_address };
  });
  var conflicts = [];
  (book.conflicts || []).forEach(function (c) {
    if (csTransportListNames_(ctx.names, c.clients)) {
      conflicts.push({ date: c.date, time: c.time, status: c.status || 'Listed', notes: c.notes });
    }
  });

  var fleet = bookRead ? csTransportVehicles_(ctx.names, src, date, tripIds) : { rows: [], window: null };
  var vkpi = function (s) { return fleet.rows.filter(function (v) { return v.status === s; }).length; };
  var vehiclesWhy = bookRead ? csTransportJoin_([ctx.repairs.why ? ctx.repairs.why + ', so no repair is shown as maintenance' : '',
                                                 ctx.fleet.why, ctx.form.why])
                             : book.requests_why;

  var punches = ctx.punches.rows;
  var miles = punches === null ? [] : csTransportMiles_(ctx.names, punches);
  var units = 0;
  miles.forEach(function (m) { units += m.units; });
  var milesAsOf = ctx.punches.newest || '';
  if (!milesAsOf) (punches || []).forEach(function (p) { var d = csTransportDay_(p.date_iso); if (d > milesAsOf) milesAsOf = d; });

  var tab = function (body, why, asOf, note) {
    if (why) body.why = why;
    if (asOf) body.as_of = asOf;
    if (note) body.note = note;
    return body;
  };
  var answer = {
    client: ctx.client, today: today, date: date, rule: CS_TRANSPORT_RULE,
    degraded: !bookRead || book.conflicts === null || ctx.visits.rows === null || ctx.form.rows === null ||
              ctx.repairs.rows === null || ctx.fleet.rows === null || punches === null,
    sources: [
      { id: 'van_requests', label: 'Van Calendar › Requests', rows: bookRead ? book.total : null,
        realigned: book.realigned || 0, why: book.requests_why },
      { id: 'van_conflicts', label: 'Van Calendar › Conflicts', rows: book.conflicts === null ? null : book.conflicts.length,
        why: book.conflicts_why },
      { id: 'hub_form', label: 'Hub form › Van Calendar', rows: ctx.form.rows === null ? null : ctx.form.rows.length, why: ctx.form.why },
      { id: 'dr_visits', label: 'Dr Appt Archive › van required', rows: ctx.visits.rows === null ? null : ctx.visits.rows.length,
        why: ctx.visits.why },
      { id: 'repairs', label: 'Repairs', rows: ctx.repairs.rows === null ? null : ctx.repairs.rows.length, why: ctx.repairs.why },
      { id: 'fleet', label: 'Fleet vehicles', rows: ctx.fleet.rows === null ? null : ctx.fleet.rows.length, why: ctx.fleet.why },
      { id: 'psi_punches', label: 'PSI punches › transportation units', rows: punches === null ? null : punches.length,
        why: ctx.punches.why }
    ],
    tabs: {
      calendar: tab({
        rows: calendar,
        kpis: bookRead ? { trips: calendar.length, upcoming: calendar.filter(function (t) { return t.date >= today; }).length,
                           vehicles: vehiclesSeen.length } : null,
        vehicles: vehiclesSeen,
        range: calendar.length ? { first: calendar[0].date, last: calendar[calendar.length - 1].date } : null
      }, tripWhy, newest, readNote),
      history: tab({
        rows: history,
        kpis: bookRead ? { needs_assignment: count('Needs assignment'), scheduled: count('Scheduled'), completed: count('Completed') } : null,
        statuses: statuses, conflicts: conflicts, rule: CS_TRANSPORT_RULE
      }, tripWhy, newest, readNote),
      vehicles: tab({
        rows: fleet.rows,
        kpis: bookRead ? { vehicles: fleet.rows.length, available: vkpi('Available'), partly_booked: vkpi('Partly Booked'),
                           booked: vkpi('Booked'), maintenance: vkpi('Maintenance') } : null,
        date: date, window: fleet.window, statuses: CS_TRANSPORT_AVAILABILITY, rule: CS_TRANSPORT_AVAILABILITY_RULE
      }, vehiclesWhy, newest),
      mileage: tab({
        rows: miles,
        kpis: punches === null ? null : { shifts: miles.length, units: Math.round(units * 100) / 100,
                                          first: miles.length ? miles[miles.length - 1].date : '',
                                          last: miles.length ? miles[0].date : '' }
      }, ctx.punches.why, milesAsOf)
    }
  };
  if (ctx.vc) {
    answer.sources.push({ id: 'vehicle_calendar', label: 'Transportation › Trips',
                          rows: ctx.vc.why ? null : (ctx.vc.rows || []).length, why: ctx.vc.why || '' });
  }
  return answer;
}

/** The vehicle calendar's part of a client's answer; absent or failing, today's answer stands and one source says why. */
function csTransportVcPart_(client, names) {
  if (typeof vcClientTrips_ !== 'function') return null;
  try {
    return vcClientTrips_(client.client_key, client.name, names);
  } catch (e) {
    return { rows: [], refs: {}, vehicles: [], bookings: [],
             why: 'the Transportation trips could not be read (' + csTransportErr_(e) + ')' };
  }
}

function csTransportVcVersion_() {
  if (typeof vcVersion_ !== 'function') return '';
  try { return String(vcVersion_() || ''); } catch (e) { return ''; }
}

// ---- the door ---------------------------------------------------------------

/** Transportation: the client's van trips (calendar, history), the shared fleet on a day, the miles on shifts. */
HUB_POLICY.clientSourceTransport = {
  file: 'ClientSourceTransport.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' }, date: { type: 'string' } }
};
HUB_ACTIONS.clientSourceTransport = function (payload, user) {
  var reader = csTransportGate_(user, payload && payload.client);
  if (!reader) return { status: 404, message: 'Unknown action.' };
  var got = csTransportDoor_(payload);
  if (got && got.status === 200 && (reader.kind === 'client' || reader.kind === 'guardian')) {
    return { status: 200, data: csTransportOwn_(got.data) };
  }
  return got;
};

/** Past the gate — the door's answer, and the relay pack's part (clientPack, today's). */
function csTransportDoor_(payload) {
  var who = csTransportClient_(payload && payload.client);
  if (who.refused) return who.refused;
  var today = csTransportToday_();
  var rawDate = String((payload && payload.date) || '').trim();
  var date = rawDate ? csTransportDay_(rawDate) : today;
  if (!date || (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate))) {
    return { status: 400, message: 'date: a day as yyyy-mm-dd.' };
  }
  var vcv = csTransportVcVersion_();
  var data = csTransportCache_('cst_transport_v1_' + who.client.client_key + '_' + date + '_' + today + '_' +
                               (vcv ? vcv + '_' : '') + csTransportVisitsVersion_(), function () {
    return csTransportAnswer_({
      client: who.client, names: who.names, today: today, date: date,
      book: csTransportBook_(), form: csTransportFormRows_(), visits: csTransportVisitRows_(),
      repairs: csTransportRepairRows_(), fleet: csTransportFleetRows_(), punches: csTransportPunchRows_(),
      vc: csTransportVcPart_(who.client, who.names)
    });
  });
  return { status: 200, data: data };
}
