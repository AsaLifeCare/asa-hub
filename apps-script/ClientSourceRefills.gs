// Clients › Medication › Refills: the house managers' Missing Medications book, read for one client, as App Control…
// The relay's ?client= check in erp_house_meds (server/snapshot_service.py) decides the pharmacy's half.

var CSR_BOOK_PROP = 'HUB_MISSING_MEDS_SHEET_ID';
var CSR_BOOK_FALLBACK = '19Umc82evptvKj7GLG2RNdr6VhKDnX0Mp6C1paX6Gw1w';
var CSR_LIVE_TAB = 'Form Responses 4';
var CSR_EARLIER_TAB = 'Form Responses 1';
var CSR_LOW_TAB = 'Low Refills';
var CSR_CONTROL_TAB = 'Medication Control';
var CSR_COPY_RESOURCE = 'missingMedications';
var CSR_CACHE_S = 60;
var CSR_TZ = 'America/New_York';
var CSR_ACTIONS = ['clientSourceRefills'];
var CSR_CLOSED = /^(completed|resolved|received|closed|done)\b/i;
var CSR_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
var CSR_MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// FAIL-CLOSED: the master in its own session, else a reader App Control releases Clients to whose scope names the…
function clientSourceRefillsGate_(user, client) {
  try {
    if (typeof HUB_IS_SERVICE_REQ !== 'undefined' && HUB_IS_SERVICE_REQ) return false;
    if (hubIsRealMaster_(user)) return true;
    var reader = clientProfilesReaderFor_(user, client);
    return !!reader && reader.kind !== 'client' && reader.kind !== 'guardian';
  } catch (e) { return false; }
}

function csrText_(v, max) {
  var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return max ? s.slice(0, max) : s;
}

function csrToday_() {
  try { return locationsToday_(); } catch (e) { return new Date().toISOString().slice(0, 10); }
}

function csrIso_(y, mo, d) {
  if (!(y >= 1900 && y <= 2200 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return '';
  var t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return '';
  return t.toISOString().slice(0, 10);
}

/** A day as the book writes it ("9/30/2025", "Thursday, December 12, 2024", ISO) → YYYY-MM-DD; '' otherwise. */
function csrDay_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, CSR_TZ, 'yyyy-MM-dd');
  var s = csrText_(v);
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return csrIso_(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(s);
  if (m) return csrIso_(m[3].length === 2 ? 2000 + (+m[3]) : +m[3], +m[1], +m[2]);
  m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(s);
  if (m && CSR_MONTHS[m[1].slice(0, 3).toLowerCase()]) return csrIso_(+m[3], CSR_MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  return '';
}

/** An ISO day as the tab draws its dates ("Sep 30, 2026"); '' for anything else. */
function csrDayLabel_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? CSR_MONTH_LABELS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : '';
}

/** A form timestamp ("9/22/2025 9:51:14") → "2025-09-22T09:51:14", the book's own wall clock; '' otherwise. */
function csrAt_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, CSR_TZ, 'yyyy-MM-dd') + 'T' +
    Utilities.formatDate(v, CSR_TZ, 'HH:mm') + ':00';
  var s = csrText_(v);
  var day = csrDay_(s);
  if (!day) return '';
  var at = s.search(/[ T]\d{1,2}:\d{2}/);
  var t = at === -1 ? null : /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/.exec(s.slice(at + 1));
  if (!t) return day;
  var h = +t[1];
  if (t[4]) h = (h % 12) + (/p/i.test(t[4]) ? 12 : 0);
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return day + 'T' + pad(h) + ':' + t[2] + ':' + (t[3] || '00');
}

/** A cell that is a plain number, as text; '' for a blank or a word. */
function csrNum_(v) {
  var s = csrText_(v).replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? s : '';
}

function csrBookId_() {
  var id = '';
  try { id = String(hubProp_(CSR_BOOK_PROP) || '').trim(); } catch (e) { id = ''; }
  return id || CSR_BOOK_FALLBACK;
}

/** {book, why}: the form book, or the sentence saying why it could not be opened. */
function csrBook_() {
  try {
    var book = ssOpen_(csrBookId_());
    return book ? { book: book, why: '' } : { book: null, why: 'the Missing Medications book could not be opened' };
  } catch (e) {
    return { book: null, why: 'the Missing Medications book could not be opened (' + String((e && e.message) || e).slice(0, 120) + ')' };
  }
}

/** One tab as display text keyed by its own header: {head, rows, why}; rows is null when the tab cannot be read. */
function csrGrid_(book, tab) {
  if (!book) return { head: [], rows: null, why: 'the book is not open' };
  try {
    var sheet = book.getSheetByName(tab);
    if (!sheet) return { head: [], rows: null, why: 'the book has no ' + tab + ' tab' };
    var values = sheet.getDataRange().getDisplayValues();
    var head = (values[0] || []).map(function (h) { return csrText_(h); });
    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var o = { _row: r + 1 }, empty = true;
      for (var c = 0; c < head.length; c++) {
        if (!head[c]) continue;
        var v = csrText_(values[r][c], 2000);
        if (v) empty = false;
        if (!o[head[c]]) o[head[c]] = v;
      }
      if (!empty) rows.push(o);
    }
    return { head: head, rows: rows, why: '' };
  } catch (e) {
    return { head: [], rows: null, why: tab + ' could not be read (' + String((e && e.message) || e).slice(0, 120) + ')' };
  }
}

/** The first header matching the pattern; '' when the tab has none. */
function csrHead_(head, re) {
  for (var i = 0; i < head.length; i++) if (head[i] && re.test(head[i])) return head[i];
  return '';
}

/** The row's cell under the header the pattern names. */
function csrCell_(row, head, re) {
  var h = csrHead_(head, re);
  return h ? csrText_(row[h]) : '';
}

/** Every normalised name this client is written down under, and whether another client shares one. */
function csrNames_(key, rows) {
  var names = {};
  try {
    var ident = hubClientIdentity_(key);
    for (var n in ident.names) if (ident.names.hasOwnProperty(n) && n) names[n] = true;
  } catch (e) { names[key] = true; }
  var shared = false;
  (rows || []).forEach(function (r) {
    if (str_(r.client_key) === key) { var own = clientNameKey_(r.name); if (own) names[own] = true; }
  });
  (rows || []).forEach(function (r) {
    if (str_(r.client_key) !== key && names[clientNameKey_(r.name)]) shared = true;
  });
  return { names: names, shared: shared };
}

function csrTab_(rows, kpis, why, asOf, note) {
  return { rows: rows || [], kpis: kpis || {}, why: why || '', as_of: asOf || '', note: note || '' };
}

function csrNewest_(list) {
  var best = '';
  list.forEach(function (v) { if (v && v > best) best = v; });
  return best;
}

/** A Missing Medications report row, from the live form, the earlier form or the Hub's copy. */
function csrReport_(o) {
  var record = o.medications || o.note || o.issue || 'Medication not named';
  var runsOut = csrDayLabel_(o.runs_out) || o.runs_out_text;
  var details = [o.issue, runsOut ? 'runs out ' + runsOut : '']
    .filter(function (x) { return !!x; }).join(' · ');
  return {
    id: o.id, record: csrText_(record, 300), date: o.reported_at.slice(0, 10), details: details,
    status: o.status || 'Reported', source: o.source, form: o.form,
    reported_at: o.reported_at, reporter: o.reporter, issue: o.issue, medications: o.medications,
    runs_out: o.runs_out, runs_out_text: o.runs_out_text, note: o.note, office_note: o.office_note,
    house: o.house || '', dr: o.dr || '', otc: o.otc || '', notes: o.notes || ''
  };
}

/** The reports a form tab holds for these names. The live form files the medication under a column per client. */
function csrFormRows_(grid, names, form, label) {
  var h = grid.head;
  var clientCol = csrHead_(h, /^(select client:?|client name|client)$/i);
  if (!clientCol) return { rows: null, why: 'the ' + label + ' has no client column' };
  var medCols = {};
  h.forEach(function (x) {
    var m = /^(.+?)\s*:\s*medications?\s*$/i.exec(x);
    if (m) medCols[clientNameKey_(m[1])] = x;
  });
  var office = h.filter(function (x) { return /^column \d+$/i.test(x); });
  var out = [];
  grid.rows.forEach(function (r) {
    var who = clientNameKey_(r[clientCol]);
    if (!who || !names[who]) return;
    var own = medCols[who] ? csrText_(r[medCols[who]]) : '';
    var runsText = csrCell_(r, h, /^expected date to run out/i);
    out.push(csrReport_({
      id: form + '-' + r._row, form: form, source: label,
      reported_at: csrAt_(csrCell_(r, h, /^timestamp$/i)),
      reporter: csrCell_(r, h, /^your name$/i),
      issue: csrCell_(r, h, /issue related|^issue description$/i),
      medications: own || csrCell_(r, h, /^medication\(s\) name$/i),
      runs_out: csrDay_(runsText), runs_out_text: runsText,
      note: csrCell_(r, h, /^if you don.?t see/i),
      office_note: office.map(function (c) { return csrText_(r[c]); }).filter(function (x) { return !!x; }).join(' · '),
      status: csrCell_(r, h, /^status$/i),
      house: csrCell_(r, h, /^house$/i), dr: csrCell_(r, h, /^dr$/i), otc: csrCell_(r, h, /^otc$/i),
      notes: csrCell_(r, h, /^notes$/i)
    }));
  });
  return { rows: out, why: '' };
}

/** The Hub's own copy of the live form (missing_medications), for when the book cannot be opened. */
function csrCopyRows_(key, names) {
  try {
    var out = [];
    listRows_(CSR_COPY_RESOURCE, {}).forEach(function (r) {
      if (str_(r.client_key) !== key && !names[clientNameKey_(r.client_name)]) return;
      var runsText = csrText_(r.expected_runout);
      out.push(csrReport_({
        id: 'copy-' + csrText_(r.id), form: 'copy', source: 'Missing Medications (Hub copy)',
        reported_at: csrAt_(r.reported_at), reporter: csrText_(r.reporter), issue: csrText_(r.issue),
        medications: csrText_(r.medications), runs_out: csrDay_(runsText), runs_out_text: runsText,
        note: csrText_(r.free_text), office_note: '', status: csrText_(r.status)
      }));
    });
    return { rows: out, why: '' };
  } catch (e) {
    return { rows: null, why: 'the Hub copy could not be read either (' + String((e && e.message) || e).slice(0, 120) + ')' };
  }
}

function csrReportsKpis_(rows, today) {
  var open = rows.filter(function (r) { return !CSR_CLOSED.test(r.status); });
  var ahead = open.map(function (r) { return r.runs_out; }).filter(function (d) { return d && d >= today; }).sort();
  return { reports: rows.length, open: open.length, next_run_out: ahead[0] || '',
           last_reported: csrNewest_(rows.map(function (r) { return r.date; })) };
}

/** Missing Medications reports: the live form and the earlier one; the Hub's copy when the book is shut. */
function csrReports_(opened, key, names, today) {
  var byNewest = function (a, b) { return a.reported_at < b.reported_at ? 1 : a.reported_at > b.reported_at ? -1 : 0; };
  if (!opened.book) {
    var copy = csrCopyRows_(key, names);
    if (!copy.rows) return csrTab_([], {}, opened.why + '; ' + copy.why, '', '');
    if (!copy.rows.length) return csrTab_([], {}, opened.why + '; the Hub\'s copy of the form holds no report for this client', '', '');
    copy.rows.sort(byNewest);
    return csrTab_(copy.rows, csrReportsKpis_(copy.rows, today),
                   opened.why + '. These are the Hub\'s copy of the form, which stopped at its last report.',
                   csrNewest_(copy.rows.map(function (r) { return r.date; })), '');
  }
  var live = csrGrid_(opened.book, CSR_LIVE_TAB);
  var earlier = csrGrid_(opened.book, CSR_EARLIER_TAB);
  var rows = [], why = [];
  var liveRows = live.rows ? csrFormRows_(live, names, 'live', 'Missing Medications form') : { rows: null, why: live.why };
  if (liveRows.rows) rows = rows.concat(liveRows.rows); else why.push(liveRows.why);
  var earlierRows = earlier.rows ? csrFormRows_(earlier, names, 'earlier', 'earlier Missing Medications form')
                                 : { rows: null, why: earlier.why };
  if (earlierRows.rows) rows = rows.concat(earlierRows.rows); else why.push(earlierRows.why);
  if (!liveRows.rows && !earlierRows.rows) return csrTab_([], {}, why.join('; '), '', '');
  rows.sort(byNewest);
  var asOf = live.rows ? csrNewest_(live.rows.map(function (r) {
    return csrAt_(csrCell_(r, live.head, /^timestamp$/i)).slice(0, 10);
  })) : '';
  return csrTab_(rows, csrReportsKpis_(rows, today), why.join('; '), asOf, '');
}

/** Low Refills: the office's refill worklist, one row per medication running out. */
function csrLowRefills_(opened, names) {
  if (!opened.book) return csrTab_([], {}, opened.why, '', '');
  var g = csrGrid_(opened.book, CSR_LOW_TAB);
  if (!g.rows) return csrTab_([], {}, g.why, '', '');
  var h = g.head;
  var clientCol = csrHead_(h, /^client( name)?$/i);
  if (!clientCol) return csrTab_([], {}, 'the ' + CSR_LOW_TAB + ' tab has no client column', '', '');
  var rows = [];
  g.rows.forEach(function (r) {
    if (!names[clientNameKey_(r[clientCol])]) return;
    var med = csrCell_(r, h, /^med(ication)?$/i);
    var refills = csrCell_(r, h, /^#\s*of refills$/i);
    var otc = csrCell_(r, h, /^otc$/i);
    var dr = csrCell_(r, h, /^dr$/i);
    var contact = csrCell_(r, h, /^contact dr$/i);
    rows.push({
      id: 'low-' + r._row, record: med || 'Medication not named', date: csrDay_(contact),
      details: [refills ? 'Refills: ' + refills : '', otc, dr].filter(function (x) { return !!x; }).join(' · '),
      status: csrCell_(r, h, /^status$/i) || 'No status', source: 'Low Refills',
      refills: refills, otc: otc, dr: dr, dr_phone: csrCell_(r, h, /^dr\s*#$/i), house: csrCell_(r, h, /^house$/i),
      manager: csrCell_(r, h, /^manager$/i), contact_dr: contact, notes: csrCell_(r, h, /^notes$/i),
      pharmacy_received: csrCell_(r, h, /received$/i), important: /^y/i.test(csrCell_(r, h, /^important med/i))
    });
  });
  var open = rows.filter(function (r) { return !CSR_CLOSED.test(r.status); }).length;
  return csrTab_(rows, { rows: rows.length, outstanding: open }, '', '', '');
}

/** Medication Control: the house's medication list, with the refill columns it carries (days supply, next due). */
function csrControl_(opened, names, today) {
  if (!opened.book) return csrTab_([], {}, opened.why, '', '');
  var g = csrGrid_(opened.book, CSR_CONTROL_TAB);
  if (!g.rows) return csrTab_([], {}, g.why, '', '');
  var h = g.head;
  var clientCol = csrHead_(h, /^client( name)?$/i);
  if (!clientCol) return csrTab_([], {}, 'the ' + CSR_CONTROL_TAB + ' tab has no client column', '', '');
  var rows = [];
  g.rows.forEach(function (r) {
    if (!names[clientNameKey_(r[clientCol])]) return;
    var due = csrDay_(csrCell_(r, h, /^next refill due$/i));
    var written = csrNum_(csrCell_(r, h, /^qty written$/i));
    var dispensed = csrNum_(csrCell_(r, h, /^qty dispensed$/i));
    var remaining = csrNum_(csrCell_(r, h, /^qty remaining$/i));
    var physician = csrCell_(r, h, /^physician name$/i);
    var qty = [written ? 'written ' + written : '', dispensed ? 'dispensed ' + dispensed : '',
               remaining ? remaining + ' remaining' : ''].filter(function (x) { return !!x; }).join(', ');
    rows.push({
      id: 'control-' + r._row, record: csrCell_(r, h, /^medication name$/i) || 'Medication not named', date: due,
      details: [qty, physician].filter(function (x) { return !!x; }).join(' · '),
      status: due ? (due <= today ? 'Due' : 'Scheduled') : 'No due date', source: 'Medication Control',
      physician: physician, physician_no: csrCell_(r, h, /^phys\w*\s*no\.?$/i),
      qty_written: written, qty_dispensed: dispensed, qty_remaining: remaining,
      days_supply: csrNum_(csrCell_(r, h, /^days supply$/i)), buffer_days: csrNum_(csrCell_(r, h, /^buffer days$/i)),
      refill_status: csrCell_(r, h, /^refill status$/i), next_refill_due: due,
      notes: csrCell_(r, h, /^notes/i)
    });
  });
  var dated = rows.filter(function (r) { return !!r.next_refill_due; }).length;
  var supplied = rows.filter(function (r) { return !!r.days_supply; }).length;
  var note = rows.length && !dated && !supplied
    ? 'Medication Control lists these medications but writes no Days Supply or Next Refill Due for this client, ' +
      'so no refill date is shown.' : '';
  return csrTab_(rows, { rows: rows.length, with_due_date: dated,
                         due: rows.filter(function (r) { return r.status === 'Due'; }).length }, '', '', note);
}

/** The whole answer for one client; `degraded` when any source could not be read. */
function csrAnswer_(client, joined) {
  var today = csrToday_();
  var opened = csrBook_();
  var tabs = {};
  if (joined.shared) {
    var shared = 'Another client on file carries this name, so rows filed by name cannot be told apart.';
    tabs.reports = csrTab_([], {}, shared, '', '');
    tabs.low_refills = csrTab_([], {}, shared, '', '');
    tabs.control = csrTab_([], {}, shared, '', '');
  } else {
    tabs.reports = csrReports_(opened, client.client_key, joined.names, today);
    tabs.low_refills = csrLowRefills_(opened, joined.names);
    tabs.control = csrControl_(opened, joined.names, today);
  }
  var degraded = false;
  for (var t in tabs) if (tabs.hasOwnProperty(t) && tabs[t].why) degraded = true;
  return { client: client.client_key, name: client.name, today: today, tabs: tabs, degraded: degraded };
}

/** Keyed csr_<action>_<client_key>, fresh for CSR_CACHE_S seconds; a degraded answer is never kept. */
function csrCached_(action, key, producer) {
  var scope = 'csr_' + action + '_' + key;
  var value = cacheRead_(scope, 'v1_' + Math.floor(Date.now() / (CSR_CACHE_S * 1000)), producer);
  if (value && value.degraded) cacheBump_(scope);
  return value;
}

/** Refills for one client: Missing Medications reports (live form, earlier form), Low Refills, Medication Control. */
HUB_POLICY.clientSourceRefills = {
  file: 'ClientSourceRefills.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' } }
};
HUB_ACTIONS.clientSourceRefills = function (payload, user) {
  if (!clientSourceRefillsGate_(user, payload && payload.client)) return { status: 404, message: 'Unknown action.' };
  return csrDoor_(payload);
};

/** Past the gate — the door's answer, and the relay pack's part (clientPack). */
function csrDoor_(payload) {
  var key = csrText_(payload && payload.client, 120);
  if (!key) return { status: 400, message: 'A client is required.' };
  var derived;
  try { derived = clientsDerived_(null); }
  catch (e) {
    return { status: 503, message: 'The clients could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
  var row = null;
  for (var i = 0; i < derived.length; i++) if (str_(derived[i].client_key) === key) { row = derived[i]; break; }
  if (!row) return { status: 404, message: 'No such client.' };
  var client = { client_key: key, name: csrText_(row.name) };
  var data = csrCached_('clientSourceRefills', key, function () { return csrAnswer_(client, csrNames_(key, derived)); });
  return { status: 200, data: data };
}
