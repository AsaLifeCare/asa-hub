// MY FAMILY — My Work, My Calendar and My Inbox for a client-role account: a client, or a guardian signed in for…
// One read, `myFamily {part}`, reached through the relay's three doors with the person's own token.

var MY_FAMILY_PARTS = ['calendar', 'work', 'inbox'];
var MY_FAMILY_CACHE_S = 60;
var MY_FAMILY_NEW_STAFF_DAYS = 14;
var MY_FAMILY_TZ = 'America/New_York';
var MY_FAMILY_ROW_CAP = 200;

/** The App Control row that releases each source to a client-role account (it must name CLIENT). Every part gates on it. */
var MY_FAMILY_SOURCE_APP = {
  appointments: 'dr-appointments', manager: 'houses', suggestions: 'suggestions',
  tasks: 'taskboard', sheet_tasks: 'taskboard-sheet', repairs: 'house-repair'
};

var MY_FAMILY_LABEL = {
  appointments: 'Doctor appointments', manager: 'House manager', suggestions: 'Your suggestions',
  tasks: 'Your task cards', sheet_tasks: 'Your sheet task cards', repairs: 'House repairs',
  new_staff: 'New staff'
};

var MY_FAMILY_TASK_WORDS = { backlog: 'Backlog', 'this-week': 'This week', 'in-progress': 'In progress',
                             review: 'Review', done: 'Done' };

/** A client's or a guardian's own My Work, My Calendar or My Inbox, cut to the account's own client. */
HUB_POLICY.myFamily = {
  file: 'MyFamily.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['client'],
  invalidates: [], emits: []
};
HUB_ACTIONS.myFamily = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'client') {
    return { status: 403, message: 'This read is for client and guardian accounts.' };
  }
  if (str_(user.visiting_member)) {
    return { status: 403, message: 'This read answers the signed-in account; it is not drawn inside a visit.' };
  }
  var part = str_(payload && payload.part);
  if (MY_FAMILY_PARTS.indexOf(part) === -1) return { status: 400, message: 'part is calendar, work or inbox.' };
  var now = new Date();
  var today = myFamilyToday_(now);
  var week = '';
  if (part === 'calendar') {
    week = myFamilyWeek_(payload && payload.week, today);
    if (!week) return { status: 400, message: 'week is a day written YYYY-MM-DD.' };
  }
  var cache = null, ck = 'myfam|' + part + '|' + str_(user.id) + '|' + week;
  try { cache = CacheService.getScriptCache(); } catch (eC) { cache = null; }
  if (cache) {
    try {
      var held = cache.get(ck);
      if (held) return { status: 200, data: JSON.parse(held) };
    } catch (eH) { /* read again */ }
  }
  var data = myFamilyAnswer_(part, user, { now: now, today: today, week: week });
  if (cache) {
    try { cache.put(ck, JSON.stringify(data), MY_FAMILY_CACHE_S); } catch (eP) { /* too big to hold: read again next time */ }
  }
  return { status: 200, data: data };
};

/** 'guardian' when the account wears GUARDIAN, else 'client'. Wording only. */
function myFamilyViewer_(user) {
  var types = (typeof userTypesFromRaw_ === 'function') ? userTypesFromRaw_(user && user.types).types : [];
  return types.indexOf('GUARDIAN') !== -1 ? 'guardian' : 'client';
}

function myFamilyToday_(now) {
  return Utilities.formatDate(now, MY_FAMILY_TZ, 'yyyy-MM-dd');
}

function myFamilyShift_(iso, days) {
  var c = String(iso).split('-');
  var d = new Date(Date.UTC(Number(c[0]), Number(c[1]) - 1, Number(c[2]) + days, 12));
  return d.toISOString().slice(0, 10);
}

/** The Monday of the asked day's week, or of today's; '' when the day cannot be read. */
function myFamilyWeek_(asked, today) {
  var day = str_(asked) || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  var c = day.split('-');
  var d = new Date(Date.UTC(Number(c[0]), Number(c[1]) - 1, Number(c[2]), 12));
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) return '';
  return myFamilyShift_(day, -((d.getUTCDay() + 6) % 7));
}

/** A cell as the day it names in New York: a Date, an ISO day or instant, or M/D/YYYY; '' when it names none. */
function myFamilyDay_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, MY_FAMILY_TZ, 'yyyy-MM-dd');
  var s = str_(v);
  if (!s) return '';
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
  if (iso) {
    if (!iso[4] || !/(z|[+-]\d{2}:?\d{2})$/i.test(iso[4])) return iso[1] + '-' + iso[2] + '-' + iso[3];
    var t = Date.parse(s);
    return t ? Utilities.formatDate(new Date(t), MY_FAMILY_TZ, 'yyyy-MM-dd') : '';
  }
  var us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return us[3] + '-' + ('0' + us[1]).slice(-2) + '-' + ('0' + us[2]).slice(-2);
  return '';
}

function myFamilyRef_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(text), Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < 5; i++) hex += ('0' + ((bytes[i] + 256) % 256).toString(16)).slice(-2);
  return hex;
}

function myFamilyWhy_(e) {
  return String((e && e.message) || e || 'no answer').slice(0, 160);
}

function myFamilySource_(key, state, why, count) {
  return { key: key, label: MY_FAMILY_LABEL[key] || key, state: state, why: why || '',
           count: state === 'ok' || state === 'empty' ? (count || 0) : null };
}

// Which source apps are open to this account, by the reader the App Control screen itself uses (appBadgeAccessGet)…
function myFamilyAccess_(user) {
  var got = null;
  try { got = HUB_ACTIONS.appBadgeAccessGet({}, user); } catch (e) {
    return { readable: false, why: 'Whether this is open to this account could not be read (' + myFamilyWhy_(e) + ').' };
  }
  if (!got || got.status !== 200 || !got.data) {
    return { readable: false, why: 'Whether this is open to this account could not be read.' };
  }
  var rules = got.data.rules || {}, tenants = got.data.tenantRules || {};
  var denied = (user && user.app_denials) || [];
  var home = str_(user && user.home_tenant);
  return {
    readable: true, why: '',
    opens: function (appId) {
      if (denied.indexOf(appId) !== -1) return false;
      if ((rules[appId] || []).indexOf('CLIENT') === -1) return false;
      var t = tenants[appId] || [];
      return !(home && t.length && t.indexOf(home) === -1);
    }
  };
}

/** A gated source's verdict before it is read: null when open, else its source line. */
function myFamilyGate_(key, access) {
  if (!access.readable) return myFamilySource_(key, 'unreadable', access.why);
  if (!access.opens(MY_FAMILY_SOURCE_APP[key])) {
    return myFamilySource_(key, 'not_applicable', 'This is not open to this account in App Control.');
  }
  return null;
}

/** One resource through its own adapter, cut to this client: { rows } or { error }. */
function myFamilyRows_(resource, user, key) {
  var got;
  try { got = route(resource, 'list', {}, user); } catch (e) {
    return { error: 'could not be read (' + myFamilyWhy_(e) + ')' };
  }
  if (!got || got.status !== 200) {
    return { error: 'could not be read' + (got && got.message ? ' (' + String(got.message).slice(0, 160) + ')' : '') };
  }
  var cfg = (typeof RESOURCES !== 'undefined' && RESOURCES[resource]) || {};
  return { rows: hubClientNarrowList_(resource, cfg, Array.isArray(got.data) ? got.data : [], key) };
}

function myFamilyWard_(user, key) {
  var got = myFamilyRows_('clients', user, key);
  if (got.error) return '';
  for (var i = 0; i < got.rows.length; i++) {
    if (str_(got.rows[i].client_key) === key) return str_(got.rows[i].name);
  }
  return '';
}

function myFamilyAnswer_(part, user, opts) {
  var key = hubClientKeyOf_(user);
  var viewer = myFamilyViewer_(user);
  var out = { family: true, part: part, viewer: viewer, linked: !!key, ward: { name: '' }, why: '',
              today: opts.today, read_at: opts.now.toISOString() };
  if (!key) {
    out.why = 'This account is not linked to a client yet, so nothing about anybody is shown. The office links it.';
    return out;
  }
  out.ward.name = myFamilyWard_(user, key);
  var id = hubClientIdentity_(key);
  var ctx = { user: user, key: key, id: id, viewer: viewer, ward: out.ward.name, today: opts.today,
              access: myFamilyAccess_(user) };
  if (part === 'calendar') myFamilyCalendar_(ctx, opts.week, out);
  else if (part === 'work') myFamilyWork_(ctx, out);
  else myFamilyInbox_(ctx, out);
  return out;
}

function myFamilyHasAny_(map) {
  for (var k in map) if (map.hasOwnProperty(k)) return true;
  return false;
}

// ---- calendar: the week at their own house — the staff on shift and their own doctor appointments — and the manager ----

// The week's shifts are My Calendar's own, released by its App Control row.
MY_FAMILY_SOURCE_APP.shifts = 'my-calendar';
MY_FAMILY_LABEL.shifts = 'Shifts at the house';

var MY_FAMILY_MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10,
  november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sept: 9, sep: 9, oct: 10,
  nov: 11, dec: 12
};
var MY_FAMILY_MONTH_RE = '(january|february|march|april|may|june|july|august|september|october|november|december|' +
                         'jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\\.?';
// A sheet day number (days after 1899-12-30) from 2000 to 2099.
var MY_FAMILY_SERIAL_FROM = 36526;
var MY_FAMILY_SERIAL_TO = 73050;

/** 'YYYY-MM-DD' when the year, month and day make a real day (a two-digit year is this century's); '' otherwise. */
function myFamilyYmd_(y, m, d) {
  var yy = Number(y), mm = Number(m), dd = Number(d);
  if (String(y).length <= 2) yy += 2000;
  if (!(yy >= 1900 && yy <= 2199 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return '';
  var t = new Date(Date.UTC(yy, mm - 1, dd, 12));
  return t.getUTCMonth() === mm - 1 && t.getUTCDate() === dd ? t.toISOString().slice(0, 10) : '';
}

/** A month and day written without a year: that day in the year that puts it nearest to today. */
function myFamilyNearest_(m, d, today) {
  var y = Number(String(today).slice(0, 4)), at = Date.parse(today + 'T12:00:00Z'), best = '', gap = Infinity;
  [y - 1, y, y + 1].forEach(function (yy) {
    var iso = myFamilyYmd_(yy, m, d);
    var g = iso ? Math.abs(Date.parse(iso + 'T12:00:00Z') - at) : Infinity;
    if (g < gap) { gap = g; best = iso; }
  });
  return best;
}

// The day an appointment's date cell names, however it was written: a date cell or an instant (its day in New…
function myFamilyApptDay_(v, today) {
  if (v instanceof Date) return myFamilyDay_(v);
  var s = str_(v).replace(/\s+/g, ' ');
  if (!s) return '';
  var on = today || myFamilyToday_(new Date());
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\S*(z|[+-]\d{2}:?\d{2})$/i.test(s)) return myFamilyDay_(s);
  var m = /(?:^|\D)(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?!\d)/.exec(s);
  if (m) return myFamilyYmd_(m[1], m[2], m[3]);
  m = /(?:^|\D)(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4}|\d{2})(?!\d)/.exec(s);
  if (m) {
    var a = Number(m[1]), b = Number(m[2]);
    return a > 12 && b <= 12 ? myFamilyYmd_(m[3], b, a) : myFamilyYmd_(m[3], a, b);
  }
  m = new RegExp('\\b' + MY_FAMILY_MONTH_RE + '\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4})\\b)?', 'i').exec(s);
  if (m) {
    var mm = MY_FAMILY_MONTHS[m[1].toLowerCase()];
    return m[3] ? myFamilyYmd_(m[3], mm, m[2]) : myFamilyNearest_(mm, Number(m[2]), on);
  }
  m = new RegExp('(?:^|\\D)(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?' + MY_FAMILY_MONTH_RE + '\\b(?:,?\\s*(\\d{4})\\b)?', 'i')
    .exec(s);
  if (m) {
    var mm2 = MY_FAMILY_MONTHS[m[2].toLowerCase()];
    return m[3] ? myFamilyYmd_(m[3], mm2, m[1]) : myFamilyNearest_(mm2, Number(m[1]), on);
  }
  m = /(?:^|[^\d\/])(\d{1,2})\/(\d{1,2})(?![\d\/])/.exec(s);
  if (m) return myFamilyNearest_(Number(m[1]), Number(m[2]), on);
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    var n = Math.floor(Number(s));
    if (n >= MY_FAMILY_SERIAL_FROM && n <= MY_FAMILY_SERIAL_TO) {
      return new Date(Date.UTC(1899, 11, 30, 12) + n * 86400000).toISOString().slice(0, 10);
    }
  }
  return '';
}

/** A time of day as 'HH:mm': a time cell, an instant, '7:00 AM', '7A' or '19:00'; '' when none is written. */
function myFamilyClock_(v, tz) {
  var at = null;
  if (v instanceof Date) at = v;
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str_(v))) at = new Date(Date.parse(str_(v)));
  if (at) {
    if (isNaN(at.getTime())) return '';
    try { return Utilities.formatDate(at, tz || MY_FAMILY_TZ, 'HH:mm'); } catch (e) { return ''; }
  }
  var n = myFamilyMinutes_(v);
  return n === 9999 ? '' : ('0' + Math.floor(n / 60)).slice(-2) + ':' + ('0' + (n % 60)).slice(-2);
}

/** A doctor row as an appointment; null for a discontinued doctor, whose next_visit is no appointment. */
function myFamilyAppointment_(r) {
  if (/discon/i.test(str_(r.active_or_discontinued))) return null;
  return { day: myFamilyDay_(r.next_visit), title: str_(r.specialist) || 'Doctor appointment',
           doctor: str_(r.dr_name), time: str_(r.start_time || r.time), place: str_(r.address),
           status: str_(r.status) };
}

/** Minutes after midnight of '9:00 AM', '9 pm' or '14:30'; 9999 for a time it cannot read, so that one sorts last. */
function myFamilyMinutes_(t) {
  var m = str_(t).match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(?:([ap])\.?\s*m?\.?)?$/i);
  if (!m) return 9999;
  var h = Number(m[1]), min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return 9999;
  if (m[3]) {
    if (h < 1 || h > 12) return 9999;
    return ((h % 12) + (/p/i.test(m[3]) ? 12 : 0)) * 60 + min;
  }
  if (!m[2] || h > 23) return 9999;
  return h * 60 + min;
}

// The client's own doctor appointments in the week, from its appointment source (csApptBuild_, the Clients app's)…
function myFamilyAppointments_(ctx, week, to) {
  var appts = { rows: [], next: null, undated: 0 };
  var shut = myFamilyGate_('appointments', ctx.access);
  if (shut) { appts.source = shut; return appts; }
  var unread = function (why) {
    appts.source = myFamilySource_('appointments', 'unreadable', why);
    return appts;
  };
  var client = csApptClient_(ctx.key);
  if (client.refused) {
    return unread('The appointments could not be read (' + String(client.refused.message || '').slice(0, 160) + ').');
  }
  var data;
  try { data = csApptCached_(client.key, function () { return csApptBuild_(client); }); } catch (e) {
    return unread('The appointments could not be read (' + myFamilyWhy_(e) + ').');
  }
  var tabs = (data && data.tabs) || {};
  var visits = tabs.visits || {}, doctors = tabs.doctors || {};
  var whys = [str_(visits.why), str_(doctors.why)].filter(String);
  if (!visits.kpis && !doctors.kpis) return unread(whys.join(' ') || 'The appointments could not be read.');
  var byId = {}, booked = {}, all = [];
  (doctors.rows || []).forEach(function (d) { byId[d.id] = d; });
  (visits.rows || []).forEach(function (v) {
    var d = v.doctor_id ? byId[v.doctor_id] : null;
    var a = { day: myFamilyApptDay_(v.date_written, ctx.today), title: (d && str_(d.specialist)) || 'Doctor appointment',
              doctor: str_(v.dr_name), time: str_(v.time), place: str_(v.dr_address), status: '' };
    if (d && a.day) booked[d.id + '|' + a.day] = true;
    all.push(a);
  });
  (doctors.rows || []).forEach(function (d) {
    if (/discon/i.test(str_(d.active_or_discontinued))) return;
    var written = str_(d.next_visit);
    // a doctor with no next visit of its own but a booked one is that booked visit
    if (!written && d.next_booked) return;
    var day = myFamilyApptDay_(written, ctx.today);
    if (day && booked[d.id + '|' + day]) return;
    all.push({ day: day, title: str_(d.specialist) || 'Doctor appointment', doctor: str_(d.dr_name), time: '',
               place: str_(d.address), status: '' });
  });
  var order = function (a, b) {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    return myFamilyMinutes_(a.time) - myFamilyMinutes_(b.time);
  };
  all.forEach(function (a) {
    if (!a.day) { appts.undated++; return; }
    if (a.day >= week && a.day <= to) appts.rows.push(a);
    else if (a.day > to && (!appts.next || order(a, appts.next) < 0)) appts.next = a;
  });
  appts.rows.sort(order);
  appts.source = myFamilySource_('appointments', appts.rows.length ? 'ok' : 'empty',
    whys.length ? whys.join(' ') + ' What could be read is shown.' : '', appts.rows.length);
  return appts;
}

// FAIL-CLOSED: the staff shifts of the week at the houses this client lives in (hubViewerHousesOf_), from the…
function myFamilyShifts_(ctx, week, to) {
  var out = { rows: [], drawn: [], houses: [] };
  var shut = myFamilyGate_('shifts', ctx.access);
  if (shut) { out.source = shut; return out; }
  var houses;
  try { houses = hubViewerHousesOf_([ctx.key]); } catch (eH) { houses = { codes: [], why: [myFamilyWhy_(eH)] }; }
  if (!(houses.codes || []).length) {
    out.source = myFamilySource_('shifts', 'unreadable', (houses.why || []).join(' ') ||
      'The house on this record cannot be matched to a house on the calendar, so no shift is shown.');
    return out;
  }
  out.houses = houses.codes.slice();
  var got = locationsCalendar_();
  if (!got || !got.cal || !got.cal.values) {
    out.source = myFamilySource_('shifts', 'unreadable', 'The house calendar could not be read' +
      (got && got.why ? ' (' + String(got.why).slice(0, 160) + ')' : '') + '.');
    return out;
  }
  var want = {};
  out.houses.forEach(function (c) { want[c] = true; });
  var values = got.cal.values, tz = got.cal.tz;
  var head = (values[0] || []).map(function (h) { return String(h == null ? '' : h).trim().toLowerCase(); });
  var col = function (names, fb) {
    for (var i = 0; i < names.length; i++) { var at = head.indexOf(names[i]); if (at !== -1) return at; }
    return fb;
  };
  var cLoc = col(['location'], 0), cName = col(['employee'], 1), cDate = col(['date'], 4);
  var cStart = col(['start time', 'start', 'shift start', 'time in'], -1);
  var cEnd = col(['end time', 'end', 'shift end', 'time out'], -1);
  var drawn = {}, seen = {};
  for (var r = 1; r < values.length; r++) {
    var line = values[r] || [];
    var day = commBroadcastDay_(line[cDate], tz);
    if (!day || day < week || day > to) continue;
    drawn[day] = true;
    if (!want[locationsCode_(line[cLoc])]) continue;
    var name = locationsText_(line[cName], 80);
    if (!locationsIsPerson_(name)) continue;
    var start = cStart === -1 ? '' : myFamilyClock_(line[cStart], tz);
    var end = cEnd === -1 ? '' : myFamilyClock_(line[cEnd], tz);
    var k = day + '|' + clientNameKey_(name) + '|' + start + '|' + end;
    if (seen[k]) continue;
    seen[k] = true;
    out.rows.push({ day: day, staff: name, start: start, end: end });
  }
  out.rows.sort(function (a, b) {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    if (a.start !== b.start) return !a.start ? 1 : !b.start ? -1 : a.start < b.start ? -1 : 1;
    return a.staff.localeCompare(b.staff);
  });
  out.drawn = Object.keys(drawn).sort();
  out.source = myFamilySource_('shifts', out.rows.length ? 'ok' : 'empty', '', out.rows.length);
  return out;
}

function myFamilyCalendar_(ctx, week, out) {
  var to = myFamilyShift_(week, 6);
  out.week = { from: week, to: to, prev: myFamilyShift_(week, -7), next: myFamilyShift_(week, 7),
               this: myFamilyWeek_('', ctx.today) };
  try { out.shifts = myFamilyShifts_(ctx, week, to); } catch (eS) {
    out.shifts = { rows: [], drawn: [], houses: [], source: myFamilySource_('shifts', 'unreadable',
      'The shifts could not be read (' + myFamilyWhy_(eS) + ').') };
  }
  try { out.appointments = myFamilyAppointments_(ctx, week, to); } catch (eA) {
    out.appointments = { rows: [], next: null, undated: 0, source: myFamilySource_('appointments', 'unreadable',
      'The appointments could not be read (' + myFamilyWhy_(eA) + ').') };
  }

  var mgr = { rows: [] };
  var shutM = myFamilyGate_('manager', ctx.access);
  if (shutM) {
    mgr.source = shutM;
  } else if (!myFamilyHasAny_(ctx.id.houses)) {
    mgr.source = myFamilySource_('manager', 'unreadable',
      'The house on this record cannot be matched to a house on the hotline calendar, so no manager is named.');
  } else {
    var all = null;
    try { all = hotlineHouseManagers_(); } catch (eM) { all = { readable: false, why: myFamilyWhy_(eM) }; }
    if (!all || !all.readable) {
      mgr.source = myFamilySource_('manager', 'unreadable',
        'The hotline calendar could not be read' + (all && all.why ? ' (' + String(all.why).slice(0, 160) + ')' : '') + '.');
    } else {
      var seen = {};
      hubClientNarrowList_('hotlineManagers', { clientScoped: true, clientByHouse: ['house'] }, all.people || [], ctx.key)
        .forEach(function (p) {
          var k = str_(p.name).toLowerCase() + '|' + str_(p.phone);
          if (!str_(p.name) || seen[k]) return;
          seen[k] = true;
          mgr.rows.push({ name: str_(p.name), phone: str_(p.phone) });
        });
      mgr.source = myFamilySource_('manager', mgr.rows.length ? 'ok' : 'empty',
        mgr.rows.length ? '' : 'The hotline calendar names no manager for this house.', mgr.rows.length);
    }
  }
  out.manager = mgr;
}

// ---- work: what this account filed, and the repairs at the house ----

function myFamilyWork_(ctx, out) {
  var sources = [], rows = [];
  var add = function (key, fn) {
    var shut = myFamilyGate_(key, ctx.access);
    if (shut) { sources.push(shut); return; }
    var got;
    try { got = fn(); } catch (e) { got = { error: 'could not be read (' + myFamilyWhy_(e) + ')' }; }
    if (got.error) { sources.push(myFamilySource_(key, 'unreadable', MY_FAMILY_LABEL[key] + ' ' + got.error + '.')); return; }
    if (got.why) { sources.push(myFamilySource_(key, 'unreadable', got.why)); return; }
    got.rows.forEach(function (r) { r.source = key; rows.push(r); });
    sources.push(myFamilySource_(key, got.rows.length ? 'ok' : 'empty', '', got.rows.length));
  };
  add('suggestions', function () { return myFamilySuggestions_(ctx.user); });
  add('tasks', function () { return myFamilyTasks_('tasks', ctx); });
  add('sheet_tasks', function () { return myFamilyTasks_('sheetTasks', ctx); });
  add('repairs', function () { return myFamilyRepairs_(ctx); });
  rows.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
  out.sources = sources;
  out.rows = rows.slice(0, MY_FAMILY_ROW_CAP);
  out.capped = rows.length > MY_FAMILY_ROW_CAP;
  out.actions = { state: 'not_applicable', why: 'Actions are asked of staff; nothing is asked of this account here.' };
}

/** This account's own suggestions, matched on the e-mail it signed in with. */
function myFamilySuggestions_(user) {
  var mine = str_(user && user.email).toLowerCase();
  if (!mine) return { why: 'This account carries no e-mail, so no suggestion can be tied to it.' };
  var rows = [];
  readTabNormalized_(hubTabWorkbook_(SUGGESTIONS_TAB), SUGGESTIONS_TAB).forEach(function (r) {
    if (!str_(r.suggestionid) || str_(r.byemail).toLowerCase() !== mine) return;
    rows.push({ id: 'sug:' + str_(r.suggestionid), title: str_(r.text).slice(0, 160) || 'Suggestion',
                status: 'Sent', at: myFamilyDay_(r.createdat) });
  });
  return { rows: rows };
}

function myFamilyTasks_(resource, ctx) {
  var got = myFamilyRows_(resource, ctx.user, ctx.key);
  if (got.error) return got;
  return { rows: got.rows.map(function (r) {
    var col = str_(r.column).toLowerCase();
    return { id: (resource === 'tasks' ? 'task:' : 'sheet:') + str_(r.id), title: str_(r.title) || 'Task card',
             status: MY_FAMILY_TASK_WORDS[col] || str_(r.column) || 'Open',
             at: myFamilyDay_(r.updatedAt || r.createdAt) };
  }) };
}

/** Repairs filed against the house on this record: the status and the day, nothing of the job. */
function myFamilyRepairs_(ctx) {
  if (!myFamilyHasAny_(ctx.id.addrs)) {
    return { why: 'No home address on this record can be matched to a repair, so none is listed.' };
  }
  var got = myFamilyRows_('workOrders', ctx.user, ctx.key);
  if (got.error) return got;
  return { rows: got.rows.map(function (r) {
    var at = myFamilyDay_(r.timestamp || r.date);
    return { id: 'rep:' + myFamilyRef_(str_(r.timestamp) + '|' + str_(r.select_address_vehicle)),
             title: 'A repair at the house', status: str_(r.status) || 'Filed', at: at };
  }) };
}

// ---- inbox: the staff new to the houses the client lives in now, and those houses; nothing else ----

// The staff who serve the client's houses (hubStaffVisibleForHouses_) whose first day at one of them, on the…
function myFamilyInbox_(ctx, out) {
  out.heads = [];
  out.items = [];
  out.house_codes = [];
  out.houses_why = '';
  out.window_days = MY_FAMILY_NEW_STAFF_DAYS;
  var said = function (state, why, count, gap) {
    var h = myFamilySource_('new_staff', state, why, count);
    h.gap = gap || '';
    out.heads.push(h);
  };
  var houses;
  try { houses = hubViewerHousesOf_([ctx.key]); } catch (e) {
    houses = { codes: [], why: [hubViewerWhy_('The houses on this record', e)] };
  }
  var codes = (houses.codes || []).filter(function (c) { return !!locationsHouseCode_(c); });
  var housesWhy = (houses.why || []).join(' ');
  if (!codes.length) {
    out.houses_why = housesWhy || 'No house on record is where this client lives now, so nothing at a house is listed.';
    said('unreadable', out.houses_why);
    return;
  }
  out.house_codes = codes;
  out.houses_why = housesWhy;
  var memo = LOCATION_PACK_MEMO_;
  var seen = null, cal = null, psi = null, first = {};
  // the Calendar Archive and the punches are read once, for the staff rule and the first days alike
  LOCATION_PACK_MEMO_ = memo || {};
  try {
    seen = hubStaffVisibleForHouses_(codes);
    cal = locationsCalendar_();
    psi = locationsPunches_();
    codes.forEach(function (code) {
      if (!cal.cal && !psi.rows) return;
      locationsStaffMerge_(code, cal.cal, psi.rows, ctx.today, {}).staff.forEach(function (p) {
        var was = first[p.key];
        if (!was || p.first_day < was.day) first[p.key] = { day: p.first_day, name: p.name, code: code };
      });
    });
  } catch (e) {
    said('unreadable', 'The staff at the house could not be read (' + myFamilyWhy_(e) + ').');
    return;
  } finally {
    LOCATION_PACK_MEMO_ = memo;
  }
  if (!cal.cal && !psi.rows) {
    said('unreadable', 'Neither the Calendar Archive nor the PSI punches could be read, so no first day is known.');
    return;
  }
  var serves = {};
  ((seen && seen.keys) || []).forEach(function (k) { serves[k] = true; });
  var from = myFamilyShift_(ctx.today, 1 - MY_FAMILY_NEW_STAFF_DAYS);
  var where = ctx.viewer === 'guardian' ? (ctx.ward ? ctx.ward + '’s house' : 'the house') : 'your house';
  Object.keys(first).forEach(function (k) {
    var f = first[k];
    if (!serves[k] || !f.day || f.day < from || f.day > ctx.today) return;
    out.items.push({ id: 'fam:staff:' + myFamilyRef_(f.code + '|' + k + '|' + f.day), type: 'new_staff',
                     title: 'New staff at ' + where + ': ' + locationsText_(f.name, 80), at: f.day, flag: false,
                     staff: k });
  });
  out.items.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
  said(out.items.length ? 'ok' : 'empty', '', out.items.length,
       [housesWhy, (seen && seen.why) || ''].filter(String).join(' '));
}
