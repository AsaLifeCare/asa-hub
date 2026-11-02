// Clients › Medication › Administration: the client's MARS papers (client_files), the eMAR pass log (mar_entries)…
// Clinical rows leave only through these doors and the relay's service-only pack (clientPack, ClientProfiles.gs)…

var CSM_ACTIONS = ['clientSourceMar', 'clientSourceMarDocFile', 'clientSourceMarImportScan'];
var CSM_TABS = ['papers', 'passes', 'errors'];
var CSM_TZ = 'America/New_York';
var CSM_TEXT_MAX = 200000;
var CSM_FOLDER_PROP = 'HUB_CLIENTS_FOLDER_ID';
var CSM_FOLDER_FALLBACK = '1sm8RbpmYWlRCD6cVjRCTePZW8F5721xQ';
var CSM_SCAN_BUDGET_MS = 60000;
var CSM_SCAN_LIST_CAP = 1000;
var CSM_PASS_WORDS = { pass: 'Recorded', cancel: 'Not given', discontinued: 'Discontinued', breakdown: 'Breakdown' };
var CSM_PASS_STATUSES = ['Recorded', 'Not given', 'Discontinued', 'Breakdown'];
// The eMAR's pass-time columns, in the order a date cell with no day falls back on them.
var CSM_PASS_TIME_COLUMNS = [['schedule', 'pass time'], ['src_prn_pass_time', 'PRN pass time']];
var CSM_PAPER_STATUSES = ['Latest', 'Earlier', 'Undated'];
var CSM_ERROR_KINDS = [['missed', 'Missed'], ['wrong day', 'Wrong day'], ['unavailable', 'Unavailable'],
                       ['no staff', 'No staff'], ['controlled', 'Controlled']];
var CSM_ERROR_MARKS = ['circled', 'initialed', 'explained'];
var CSM_ERROR_STATUSES = ['Missed', 'Wrong day', 'Unavailable', 'No staff', 'Controlled', 'Marked', 'Not flagged'];
// The eMAR pilot signed most passes with the platform's shared account; said so, never hidden.
var CSM_SHARED_SIGNER = 'asatech';
var CSM_SHARED_SIGNER_WORDS = 'System account (eMAR pilot)';
var CSM_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
                  'october', 'november', 'december'];
// The Clients drive: tops that are not a person, and the one that holds the inactive clients one level down.
var CSM_SYSTEM_TOP = /^(0 - |Templates|Leases|Pictures|House Documentation|Potential New Clients)/i;
var CSM_INACTIVE_TOP = /^0 - Client Inactive/i;
var CSM_MAR_NAME = /(^|[^a-z])mars?([^a-z]|$)/i;

// FAIL-CLOSED: the Clients reader for this client — the master in its own session, else as App Control releases…
function csmGate_(user, client, any) {
  try {
    if (hubIsRealMaster_(user)) return { kind: 'master', keys: null };
    if (any) {
      var wide = clientProfilesReader_(user);
      return wide && !wide.keys ? wide : null;
    }
    return clientProfilesReaderFor_(user, client) || null;
  } catch (e) { return null; }
}

/** A client or a family member: their own papers and passes, never the office's errors audit. */
function csmOwnOnly_(reader) {
  return !!reader && (reader.kind === 'client' || reader.kind === 'guardian');
}

function csmOwn_(data) {
  var out = {}, tabs = {};
  Object.keys(data || {}).forEach(function (k) { out[k] = data[k]; });
  Object.keys((data && data.tabs) || {}).forEach(function (t) { if (t !== 'errors') tabs[t] = data.tabs[t]; });
  out.tabs = tabs;
  out.degraded = Object.keys(tabs).some(function (t) { return !!(tabs[t] && tabs[t].why); });
  return out;
}

function csmUnknown_() {
  return { status: 404, message: 'Unknown action.' };
}

function csmWhy_(e) {
  return String((e && e.message) || e).slice(0, 120);
}

function csmText_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

function csmNum_(v) {
  var s = String(v == null ? '' : v).replace(/,/g, '').trim();
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : 0;
}

function csmPad_(n) { return (n < 10 ? '0' : '') + n; }

/** yyyy-MM-dd for a real calendar day; '' otherwise. */
function csmValidDay_(y, m, d) {
  if (!(y >= 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDate() !== d) return '';
  return y + '-' + csmPad_(m) + '-' + csmPad_(d);
}

function csmClock_(h, mi, ap) {
  var hh = Number(h);
  if (ap) hh = hh % 12 + (/p/i.test(ap) ? 12 : 0);
  return hh >= 0 && hh <= 23 ? csmPad_(hh) + ':' + mi : '';
}

function csmInstant_(s) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) || !/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return null;
  var t = new Date(s);
  return isNaN(t.getTime()) ? null : t;
}

/** A day cell as New York's calendar day: a Date, an instant or an ISO day; '' for anything else. */
function csmIsoDay_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, CSM_TZ, 'yyyy-MM-dd');
  var s = csmText_(v);
  var t = csmInstant_(s);
  if (t) return Utilities.formatDate(t, CSM_TZ, 'yyyy-MM-dd');
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  return m ? csmValidDay_(+m[1], +m[2], +m[3]) : '';
}

function csmMonthOf_(word) {
  var w = String(word || '').toLowerCase();
  for (var i = 0; i < CSM_MONTHS.length; i++) {
    if (w === CSM_MONTHS[i] || w === CSM_MONTHS[i].slice(0, 3)) return i + 1;
  }
  return 0;
}

function csmMonthWords_(ym) {
  var m = /^(\d{4})-(\d{2})/.exec(String(ym || ''));
  if (!m) return '';
  var name = CSM_MONTHS[Number(m[2]) - 1] || '';
  return name ? name.charAt(0).toUpperCase() + name.slice(1) + ' ' + m[1] : '';
}

/** 2025-07-03 → Jul 3, 2025. */
function csmDayWords_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  var name = m ? CSM_MONTHS[Number(m[2]) - 1] || '' : '';
  return name ? name.charAt(0).toUpperCase() + name.slice(1, 3) + ' ' + Number(m[3]) + ', ' + m[1] : '';
}

/** 15:32 → 3:32 PM. */
function csmClockWords_(hhmm) {
  var m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return String(hhmm || '');
  var h = Number(m[1]);
  return (h % 12 === 0 ? 12 : h % 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
}

function csmSize_(bytes) {
  if (!bytes) return '';
  if (bytes >= 1048576) return (Math.round(bytes / 104857.6) / 10) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

/** The date a file name states (the drive indexer's rule), ISO; never invented. */
function csmFileDate_(name) {
  var s = String(name || '');
  var ok = function (y, mo, d) {
    if (!(y >= 2000 && y <= 2100)) return '';
    return csmValidDay_(y, mo, mo === 2 && d > 28 ? 28 : d);
  };
  var m = /\b(\d{1,2})[_\-\/.](\d{1,2})[_\-\/.](20\d{2})\b/.exec(s);
  if (m) return ok(+m[3], +m[1], +m[2]);
  m = /\b(\d{1,2})\.(\d{1,2})\.(\d{2})\b/.exec(s);
  if (m) return ok(2000 + Number(m[3]), +m[1], +m[2]);
  m = /\b(20\d{2})[-_](\d{1,2})[-_](\d{1,2})\b/.exec(s);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = /(20\d{2})\s+([A-Za-z]+)/.exec(s);
  if (m && csmMonthOf_(m[2])) return ok(+m[1], csmMonthOf_(m[2]), 1);
  m = /([A-Za-z]+)\s+(20\d{2})/.exec(s);
  if (m && csmMonthOf_(m[1])) return ok(+m[2], csmMonthOf_(m[1]), 1);
  return '';
}

/** First and last word of a person's name, letters only (the drive indexer's folder key). */
function csmFlKey_(name) {
  var toks = String(name || '').toLowerCase().replace(/[^a-z ]+/g, '').split(/\s+/)
    .filter(function (t) { return !!t; });
  return toks.length >= 2 ? toks[0] + '_' + toks[toks.length - 1] : (toks[0] || '');
}

// ---- the client ------------------------------------------------------------

/** The roster row a client_key names (a row with no key answers to its folded name) and every spelling of it. */
function csmClient_(raw) {
  var key = String(raw == null ? '' : raw).trim();
  if (!key || key.length > 120) return { refused: { status: 400, message: 'client: a client_key.' } };
  var rows;
  try { rows = clientsDerived_(null); }
  catch (e) { return { refused: { status: 503, message: 'The clients could not be read just now (' + csmWhy_(e) + ').' } }; }
  var hit = null, roster = {}, folds = {}, people = [];
  (rows || []).forEach(function (c) {
    var ck = String(c.client_key || '').trim() || clientNameKey_(c.name);
    if (!ck) return;
    roster[ck] = true;
    var fold = clientNameKey_(c.name), fl = csmFlKey_(c.name);
    if (fold) folds[fold] = ck;
    if (fl) folds['fl:' + fl] = ck;
    people.push({ key: ck, name: csmText_(c.name) });
    if (!hit && ck === key) hit = c;
  });
  if (!hit) return { refused: { status: 404, message: 'No client "' + key + '" is on the roster.' } };
  var names = {};
  var id = null;
  try { id = hubClientIdentity_(key); } catch (eI) { id = null; }
  Object.keys((id && id.names) || {}).forEach(function (n) { if (n) names[n] = true; });
  var own = clientNameKey_(hit.name);
  if (own) names[own] = true;
  return { key: key, name: csmText_(hit.name), names: names, roster: roster, folds: folds, people: people };
}

/** A row belongs to the client by its key; a row with no roster key, by its folded name. Never another client's key. */
function csmOwns_(c, key, name) {
  var k = csmText_(key);
  if (k === c.key) return true;
  if (k && c.roster[k]) return false;
  var n = clientNameKey_(name);
  return !!n && !!c.names[n];
}

function csmNewest_(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if ((a.time || '') !== (b.time || '')) return (a.time || '') < (b.time || '') ? 1 : -1;
  return (b.order || 0) - (a.order || 0);
}

/** The statuses the rows carry, every kind an error row names included, in the vocabulary's order. */
function csmStatuses_(rows, vocabulary) {
  var seen = {};
  rows.forEach(function (r) {
    seen[r.status] = true;
    (r.kinds || []).forEach(function (k) { seen[k] = true; });
  });
  var out = vocabulary.filter(function (s) { return seen[s]; });
  Object.keys(seen).sort().forEach(function (s) { if (out.indexOf(s) === -1) out.push(s); });
  return out;
}

// ---- the MARS papers (client_files, doc_kind mar) ----------------------------

function csmPapersOf_(c, all) {
  return (all || []).filter(function (r) {
    return csmText_(r.doc_kind).toLowerCase() === 'mar' && csmOwns_(c, r.client_key, r.client_name);
  });
}

function csmDigestWords_(state) {
  var s = csmText_(state).toLowerCase();
  if (s === 'done') return 'OCR read';
  if (!s || s === 'pending') return 'OCR pending';
  return 'OCR ' + s;
}

function csmPapersTab_(c, all) {
  var asOf = '', indexed = '';
  (all || []).forEach(function (r) {
    var at = csmIsoDay_(r.createdAt);
    if (at > indexed) indexed = at;
    if (csmText_(r.doc_kind).toLowerCase() !== 'mar') return;
    var d = csmIsoDay_(r.file_date);
    if (d > asOf) asOf = d;
  });
  var mine = csmPapersOf_(c, all);
  var latest = '';
  mine.forEach(function (r) { var d = csmIsoDay_(r.file_date); if (d.slice(0, 7) > latest) latest = d.slice(0, 7); });
  var rows = mine.map(function (r, i) {
    var day = csmIsoDay_(r.file_date);
    var month = day.slice(0, 7);
    var size = csmNum_(r.size_bytes);
    var kind = csmText_(r.kind).toUpperCase();
    var folder = csmText_(r.folder);
    return {
      id: csmText_(r.id) || 'paper_' + i, record: csmText_(r.title) || 'MARS paper', date: day, time: '', order: i,
      details: [csmMonthWords_(month), kind, csmSize_(size), folder ? 'Folder: ' + folder : '',
                csmDigestWords_(r.digest_state)].filter(function (x) { return !!x; }).join(' · '),
      status: !day ? 'Undated' : (month === latest ? 'Latest' : 'Earlier'),
      file_id: csmText_(r.drive_id), title: csmText_(r.title), month: month, kind: kind, mime: csmText_(r.mime_type),
      size_bytes: size, folder: folder, modified_time: csmText_(r.modified_time), indexed_at: csmIsoDay_(r.createdAt),
      digest_state: csmText_(r.digest_state), has_text: !!csmText_(r.text_file), text_chars: csmNum_(r.digest_text_chars)
    };
  });
  rows.sort(csmNewest_);
  var months = {};
  var k = { papers: rows.length, months: 0, latest: '', with_text: 0, undated: 0 };
  rows.forEach(function (r) {
    if (r.month) months[r.month] = true;
    if (r.date > k.latest) k.latest = r.date;
    if (r.has_text) k.with_text++;
    if (!r.date) k.undated++;
    delete r.order;
  });
  k.months = Object.keys(months).length;
  return { rows: rows, kpis: k, statuses: csmStatuses_(rows, CSM_PAPER_STATUSES), as_of: asOf, indexed_at: indexed, why: '' };
}

// ---- the eMAR pass log (mar_entries) -----------------------------------------

function csmSourceRow_(v, i) {
  var m = /(\d+)\s*$/.exec(csmText_(v));
  return m ? Number(m[1]) : 1e9 + i;
}

// One pass date as the tab holds it: {day, other, time}.
function csmPassDate_(v) {
  var out = { day: '', other: '', time: '' };
  var t = v instanceof Date ? (isNaN(v.getTime()) ? null : v) : csmInstant_(csmText_(v));
  if (t) {
    out.time = Utilities.formatDate(t, CSM_TZ, 'HH:mm');
    var w = /^(\d{4})-(\d{2})-(\d{2})$/.exec(Utilities.formatDate(t, CSM_TZ, 'yyyy-MM-dd'));
    if (Number(w[1]) < 1900) return out;
    return csmSwappable_(out, +w[1], +w[2], +w[3]);
  }
  var s = csmText_(v);
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(:\d{2})?)?$/.exec(s);
  if (m) {
    if (m[4] === undefined || m[6]) {
      out.day = csmValidDay_(+m[1], +m[2], +m[3]);
      if (m[4] !== undefined) out.time = csmClock_(m[4], m[5], '');
      return out;
    }
    out.time = csmClock_(m[4], m[5], '');
    return csmSwappable_(out, +m[1], +m[2], +m[3]);
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(?:(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?)?$/.exec(s);
  if (m) {
    var ap = m[6] || '';
    if (m[4] !== undefined) out.time = csmClock_(m[4], m[5], ap);
    var dm = csmValidDay_(+m[3], +m[2], +m[1]), md = csmValidDay_(+m[3], +m[1], +m[2]);
    // AM/PM is the month-first locale; a 24-hour clock is day-first
    var first = ap ? md : dm, second = ap ? dm : md;
    out.day = first || second;
    out.other = first && second && first !== second ? second : '';
    return out;
  }
  m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/.exec(s);
  if (m) out.time = csmClock_(m[1], m[2], m[3] || '');
  return out;
}

function csmSwappable_(out, y, mo, d) {
  out.day = csmValidDay_(y, mo, d);
  var swap = csmValidDay_(y, d, mo);
  out.other = out.day && swap && swap !== out.day ? swap : '';
  return out;
}

// The whole log with each pass's day settled.
function csmPassLog_(rows) {
  var log = (rows || []).map(function (r, i) {
    var d = csmPassDate_(r.date), from = '';
    if (!d.day) {
      CSM_PASS_TIME_COLUMNS.some(function (col) {
        var alt = csmPassDate_(r[col[0]]);
        if (!alt.day) return false;
        d = alt;
        from = col[1];
        return true;
      });
    }
    return { r: r, order: csmSourceRow_(r.source_row, i), day: d.day, other: d.other, time: d.time, from: from,
             fixed: false, unsure: false };
  });
  var seq = log.slice().sort(function (a, b) { return a.order - b.order; });
  var prev = [], next = [], last = '', ahead = '';
  for (var i = 0; i < seq.length; i++) {
    prev.push(last);
    if (seq[i].day && !seq[i].other) last = seq[i].day;
  }
  for (var j = seq.length - 1; j >= 0; j--) {
    next[j] = ahead;
    if (seq[j].day && !seq[j].other) ahead = seq[j].day;
  }
  seq.forEach(function (p, k) {
    if (!p.other) return;
    var fits = function (d) { return (!prev[k] || d >= prev[k]) && (!next[k] || d <= next[k]); };
    var asWritten = fits(p.day), swapped = fits(p.other);
    if (swapped && !asWritten) { p.day = p.other; p.fixed = true; }
    else if (!asWritten || swapped) p.unsure = true;
  });
  return log;
}

// A pass-time cell that holds a whole date-time, not a due clock: its day is the pass's settled day when either…
function csmStamp_(v, p) {
  var s = csmPassDate_(v);
  if (!s.day) return null;
  var day = p.day && (s.day === p.day || s.other === p.day) ? p.day : (s.other ? '' : s.day);
  return {
    day: day, time: s.time, agrees: !!p.day && day === p.day,
    words: day ? csmDayWords_(day) + (s.time ? ' · ' + csmClockWords_(s.time) : '')
               : '"' + csmText_(v) + '" as written — it reads two ways'
  };
}

/** A stamp is drawn only when it says more than the pass's own day and clock. */
function csmStampWords_(stamp, time) {
  return stamp && !(stamp.agrees && (!stamp.time || stamp.time === time)) ? stamp.words : '';
}

function csmPassRow_(p) {
  var r = p.r;
  var raw = csmText_(r.status);
  var word = CSM_PASS_WORDS[raw.toLowerCase()] || raw || 'No status';
  var signed = csmText_(r.administeredBy);
  var by = signed.toLowerCase() === CSM_SHARED_SIGNER ? CSM_SHARED_SIGNER_WORDS : signed;
  var withheld = csmText_(r.src_withheld_type);
  var reason = word === 'Recorded' ? '' : withheld;
  var prn = /^prn$/i.test(csmText_(r.src_prn));
  var prnReason = csmText_(r.src_prn_reason);
  var stamp = csmStamp_(r.schedule, p), prnStamp = csmStamp_(r.src_prn_pass_time, p);
  var time = p.time || (stamp && stamp.agrees ? stamp.time : '');
  // "Due" is only a clock the pass was scheduled for; a whole date-time there is when the pass happened
  var schedule = stamp ? '' : csmText_(r.schedule);
  var passTime = csmStampWords_(stamp, time);
  var prnTime = prnStamp ? csmStampWords_(prnStamp, time) : csmText_(r.src_prn_pass_time);
  var dose = [csmText_(r.src_dosage), csmText_(r.src_medtype)].filter(function (x) { return !!x; }).join(' ');
  return {
    id: csmText_(r.id) || 'pass_' + p.order, record: csmText_(r.medication) || 'Medication not named',
    date: p.day, time: time, order: p.order,
    details: [schedule ? 'Due ' + schedule : '', passTime ? 'Pass time ' + passTime : '', dose,
              prn ? 'PRN' + (prnReason ? ': ' + prnReason : '') : '', reason ? 'Reason: ' + reason : '',
              by ? 'By ' + by : ''].filter(function (x) { return !!x; }).join(' · '),
    status: word, reason: reason, schedule: schedule, pass_time: passTime, schedule_as_written: csmText_(r.schedule),
    dose: csmText_(r.src_dosage), form: csmText_(r.src_medtype), prn: prn, prn_reason: prnReason,
    prn_time: prnTime, prn_time_as_written: csmText_(r.src_prn_pass_time), given_by: by, signed_as: signed,
    withheld: withheld, comment: csmText_(r.src_comment), instructions: csmText_(r.src_instructions),
    blood_pressure: csmText_(r.src_bloodpressure), blood_sugar: csmText_(r.src_bloodsugar),
    quantity_remaining: csmText_(r.src_qntyremaining), source_status: raw, date_as_written: csmText_(r.date),
    date_from: p.from, date_fixed: p.fixed, date_unsure: p.unsure, source_row: csmText_(r.source_row)
  };
}

function csmPassesTab_(c, all) {
  var log = csmPassLog_(all);
  var asOf = '';
  var rows = [];
  log.forEach(function (p) {
    if (p.day > asOf) asOf = p.day;
    if (c.names[clientNameKey_(csmText_(p.r.client))]) rows.push(csmPassRow_(p));
  });
  rows.sort(csmNewest_);
  var k = { passes: rows.length, recorded: 0, not_given: 0, discontinued: 0, breakdown: 0, prn: 0,
            dates_fixed: 0, days_from_pass_time: 0, no_day: 0, first: '', last: '' };
  rows.forEach(function (r) {
    if (r.status === 'Recorded') k.recorded++;
    else if (r.status === 'Not given') k.not_given++;
    else if (r.status === 'Discontinued') k.discontinued++;
    else if (r.status === 'Breakdown') k.breakdown++;
    if (r.prn) k.prn++;
    if (r.date_fixed) k.dates_fixed++;
    if (r.date_from) k.days_from_pass_time++;
    if (!r.date) k.no_day++;
    else {
      if (!k.first || r.date < k.first) k.first = r.date;
      if (r.date > k.last) k.last = r.date;
    }
    delete r.order;
  });
  return { rows: rows, kpis: k, statuses: csmStatuses_(rows, CSM_PASS_STATUSES), as_of: asOf, why: '' };
}

// ---- the MAR errors audit (mar_errors) ----------------------------------------

/** The audit's day: m/d/yyyy, m/d/yy, or m/d with the row's year; the first day of a range; '' when it names none. */
function csmErrorDay_(v, year) {
  var iso = csmIsoDay_(v);
  if (iso) return iso;
  var m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2})(?!\d))?/.exec(csmText_(v));
  if (!m) return '';
  var yr = csmText_(year);
  var y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : (/^\d{4}$/.test(yr) ? Number(yr) : 0);
  return y ? csmValidDay_(y, +m[1], +m[2]) : '';
}

function csmFold_(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z]+/g, ' ').trim();
}

/** The letters of a value that is only initials ('TC', 't.c.', 'kh'); '' for a name or anything else. */
function csmInitialsOnly_(v) {
  var s = csmText_(v);
  var letters = s.replace(/[^A-Za-z]/g, '');
  if (!/^[A-Za-z]{2,3}$/.test(letters) || /[^A-Za-z.\s]/.test(s) || /[A-Za-z]{2,}\s/.test(s)) return '';
  return letters === letters.toUpperCase() || letters === letters.toLowerCase() ? letters.toUpperCase() : '';
}

/** A full name's initials: first and last word, and every word when there are more than two. */
function csmNameInitials_(name) {
  if (csmInitialsOnly_(name)) return [];
  var words = String(name || '').replace(/\([^)]*\)/g, ' ').replace(/[^A-Za-z ]+/g, '').split(/\s+/)
    .filter(function (w) { return !!w; });
  if (words.length < 2) return [];
  var fl = (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
  var all = words.map(function (w) { return w.charAt(0); }).join('').toUpperCase();
  return all === fl ? [fl] : [fl, all];
}

/** The initials an audit row is filed under when its key and name are only initials (and agree); '' otherwise. */
function csmFiledInitials_(c, r) {
  var key = csmText_(r.client_key), name = csmText_(r.client_name);
  if (key && c.roster[key]) return '';
  var said = [key, name].filter(function (x) { return !!x; });
  if (!said.length && csmText_(r.initials)) said = [csmText_(r.initials)];
  var letters = said.map(csmInitialsOnly_);
  if (!letters.length || letters.some(function (l) { return !l || l !== letters[0]; })) return '';
  return letters[0];
}

// This client's initials and whether each names the client alone: no other roster client has them, and no person…
function csmInitialsOf_(c, errors, files) {
  var own = csmNameInitials_(c.name);
  var claims = {};
  var claim = function (letters, who) { (claims[letters] = claims[letters] || {})[who] = true; };
  (c.people || []).forEach(function (p) { csmNameInitials_(p.name).forEach(function (l) { claim(l, 'key:' + p.key); }); });
  // a name that is a roster client's (by its fold, or first and last word) is already claimed by that client's key
  var loose = function (r) {
    var key = csmText_(r.client_key);
    if (key && c.roster[key]) return;
    var plain = csmText_(r.client_name).replace(/\([^)]*\)/g, ' ');
    var fold = clientNameKey_(plain);
    if (!fold || c.names[fold] || c.folds[fold] || c.names[clientNameKey_(r.client_name)] ||
        c.folds['fl:' + csmFlKey_(plain)]) return;
    csmNameInitials_(plain).forEach(function (l) { claim(l, 'name:' + fold); });
  };
  (errors || []).forEach(loose);
  (files || []).forEach(loose);
  var sole = {};
  own.forEach(function (l) {
    var who = Object.keys(claims[l] || {});
    sole[l] = !!files && who.length === 1 && who[0] === 'key:' + c.key;
  });
  return {
    own: own, sole: sole,
    why: !files ? 'the MARS papers index could not be read, so nobody else can be ruled out'
                : 'another client, or a person the records name in full, has the same initials'
  };
}

function csmErrorRow_(r, day, i, by, filed) {
  var flags = csmText_(r.flags).split(',').map(function (f) { return f.trim(); }).filter(function (f) { return !!f; });
  var kinds = [], marks = [];
  CSM_ERROR_KINDS.forEach(function (kind) {
    if (flags.some(function (f) { return csmFold_(f).indexOf(kind[0]) !== -1; })) kinds.push(kind[1]);
  });
  flags.forEach(function (f) { if (CSM_ERROR_MARKS.indexOf(csmFold_(f)) !== -1) marks.push(f); });
  var problem = csmText_(r.problem), time = csmText_(r.time), notes = csmText_(r.notes), staff = csmText_(r.staff);
  return {
    id: csmText_(r.id) || 'error_' + i, record: csmText_(r.medication) || 'Medication not named', date: day, time: '',
    order: i,
    details: [by === 'initials' ? 'Filed as ' + filed : '', problem ? 'Problem: ' + problem : '',
              time ? 'Time: ' + time : '', notes, staff ? 'Staff: ' + staff : '']
      .filter(function (x) { return !!x; }).join(' · '),
    status: kinds[0] || (marks.length ? 'Marked' : 'Not flagged'),
    flags: flags, kinds: kinds, marks: marks, problem: problem, pass_time: time, notes: notes, staff: staff,
    passer: csmText_(r.passer), reading: csmText_(r.reading), end_date: csmErrorDay_(r.end_date, r.year),
    date_as_written: csmText_(r.error_date), matched_by: by, filed_as: by === 'initials' ? filed : '',
    source: [csmText_(r.source_book), csmText_(r.source_tab)].filter(function (x) { return !!x; }).join(' › ')
  };
}

// The audit's rows for the client: by key, by a folded name when the key is no roster key, and by initials alone…
function csmErrorsTab_(c, all, files) {
  var asOf = '';
  var rows = [];
  var initials = csmInitialsOf_(c, all, files);
  var byInitials = 0, held = 0;
  (all || []).forEach(function (r, i) {
    var day = csmErrorDay_(r.error_date, r.year);
    if (day > asOf) asOf = day;
    if (csmOwns_(c, r.client_key, r.client_name)) {
      rows.push(csmErrorRow_(r, day, i, csmText_(r.client_key) === c.key ? 'key' : 'name', ''));
      return;
    }
    var filed = csmFiledInitials_(c, r);
    if (!filed || !initials.sole.hasOwnProperty(filed)) return;
    if (!initials.sole[filed]) { held++; return; }
    byInitials++;
    rows.push(csmErrorRow_(r, day, i, 'initials', filed));
  });
  rows.sort(csmNewest_);
  var k = { errors: rows.length, missed: 0, wrong_day: 0, unavailable: 0, no_staff: 0, controlled: 0,
            undated: 0, first: '', latest: '', by_initials: byInitials, initials_held: held };
  var slot = { 'Missed': 'missed', 'Wrong day': 'wrong_day', 'Unavailable': 'unavailable', 'No staff': 'no_staff',
               'Controlled': 'controlled' };
  rows.forEach(function (r) {
    r.kinds.forEach(function (kind) { k[slot[kind]]++; });
    if (!r.date) k.undated++;
    else {
      if (!k.first || r.date < k.first) k.first = r.date;
      if (r.date > k.latest) k.latest = r.date;
    }
    delete r.order;
  });
  return { rows: rows, kpis: k, statuses: csmStatuses_(rows, CSM_ERROR_STATUSES), as_of: asOf, why: '',
           initials: initials.own.join(' / '), initials_why: held ? initials.why : '' };
}

// ---- the answer --------------------------------------------------------------

/** A source that cannot be read answers its tab with why, never an empty table dressed as zero. */
function csmTab_(what, fn) {
  try { return fn(); }
  catch (e) { return { rows: [], kpis: {}, statuses: [], why: what + ' could not be read (' + csmWhy_(e) + ')' }; }
}

function csmBuild_(c) {
  var files = null, filesFailed = null;
  try { files = clientFilesAll_(); } catch (e) { filesFailed = e; }
  var tabs = {
    papers: csmTab_('the MARS papers index', function () {
      if (filesFailed) throw filesFailed;
      return csmPapersTab_(c, files);
    }),
    passes: csmTab_('the eMAR pass log', function () { return csmPassesTab_(c, listRows_('marEntries', {})); }),
    errors: csmTab_('the MAR errors audit', function () { return csmErrorsTab_(c, listRows_('marErrors', {}), files); })
  };
  var degraded = CSM_TABS.some(function (t) { return !!tabs[t].why; });
  return { client: { client_key: c.key, name: c.name }, tabs: tabs, degraded: degraded };
}

/** Keyed csm_<action>_<client>; the name carries the minute and the versions of the tabs it reads. A degraded answer is never kept. */
function csmCached_(action, key, depScopes, producer) {
  var scope = 'csm_' + action + '_' + key;
  var name = 'v2_' + Math.floor(new Date().getTime() / 60000);
  (depScopes || []).forEach(function (s) {
    try { name += '_' + cacheVersion_(s); } catch (e) { name += '_x'; }
  });
  var value = cacheRead_(scope, name, producer);
  if (value && value.degraded) cacheBump_(scope);
  return value;
}

/** Administration, per client: the MARS papers, the eMAR passes (days corrected in this read) and the MAR errors audit. */
HUB_POLICY.clientSourceMar = {
  file: 'ClientSourceMar.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' } }
};
HUB_ACTIONS.clientSourceMar = function (payload, user) {
  var reader = csmGate_(user, payload && payload.client);
  if (!reader) return csmUnknown_();
  var got = csmDoor_(payload);
  return got && got.status === 200 && csmOwnOnly_(reader) ? { status: 200, data: csmOwn_(got.data) } : got;
};

/** Past the gate — the door's answer, and the relay pack's part (clientPack). */
function csmDoor_(payload) {
  var c = csmClient_(payload && payload.client);
  if (c.refused) return c.refused;
  var data = csmCached_('clientSourceMar', c.key,
    [cacheScope_('client_files'), cacheScope_('mar_entries'), cacheScope_('mar_errors')],
    function () { return csmBuild_(c); });
  return { status: 200, data: data };
}

// One MARS paper of the client, as bytes for the platform's own viewer with its OCR digest; part 'text' answers the…
HUB_POLICY.clientSourceMarDocFile = {
  file: 'ClientSourceMar.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' }, file_id: { type: 'string' }, part: { type: 'string' } }
};
HUB_ACTIONS.clientSourceMarDocFile = function (payload, user) {
  if (!csmGate_(user, payload && payload.client)) return csmUnknown_();
  var c = csmClient_(payload && payload.client);
  if (c.refused) return c.refused;
  var id = String((payload && payload.file_id) || '').trim().slice(0, 120);
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return { status: 400, message: 'file_id: a Drive file id.' };
  var part = String((payload && payload.part) || 'file').trim().toLowerCase();
  if (part !== 'file' && part !== 'text') return { status: 400, message: 'part: file or text.' };
  var paper = null;
  try {
    csmPapersOf_(c, clientFilesFor_([c.key], Object.keys(c.names))).forEach(function (r) {
      if (!paper && csmText_(r.drive_id) === id) paper = r;
    });
  } catch (e) {
    return { status: 503, message: 'The MARS papers index could not be read just now (' + csmWhy_(e) + ').' };
  }
  if (!paper) return { status: 404, message: 'This client names no such MARS paper.' };
  var title = csmText_(paper.title);
  if (part === 'text') return csmPaperText_(id, title, csmText_(paper.text_file));
  // the digest is this paper's row alone, never the index
  try { paper = clientFileWhole_(paper); } catch (eW) {
    return { status: 503, message: 'The paper\'s OCR digest could not be read just now (' + csmWhy_(eW) + ').' };
  }
  if (!paper) return { status: 404, message: 'This client names no such MARS paper.' };
  var got;
  try { got = locationsDocBytes_(id); }
  catch (eB) {
    var gone = /not found|no item|does not exist|trashed/i.test(csmWhy_(eB));
    return gone ? { status: 404, message: 'The file is no longer in the drive.' }
                : { status: 503, message: 'The document could not be opened just now — try again in a minute.' };
  }
  if (got.refused) return got.refused;
  return { status: 200, data: {
    id: id, name: got.name || title, mime: got.mime, size: got.size, exported: got.exported, b64: got.b64,
    digest: { text: String(paper.digest_text == null ? '' : paper.digest_text), state: csmText_(paper.digest_state),
              chars: csmNum_(paper.digest_text_chars), has_text: !!csmText_(paper.text_file) }
  } };
};

function csmPaperText_(id, title, textFile) {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(textFile)) return { status: 404, message: 'No OCR text is on file for this paper.' };
  var text;
  try { text = csmDriveText_(textFile); }
  catch (e) {
    return /not found|no item|does not exist|trashed/i.test(csmWhy_(e))
      ? { status: 404, message: 'The OCR text is no longer in the drive.' }
      : { status: 503, message: 'The OCR text could not be read just now — try again in a minute.' };
  }
  var s = String(text == null ? '' : text);
  return { status: 200, data: { id: id, name: title, text: s.slice(0, CSM_TEXT_MAX), chars: s.length,
                                truncated: s.length > CSM_TEXT_MAX } };
}

function csmDriveText_(id) {
  return DriveApp.getFileById(id).getBlob().getDataAsString();
}

// ---- the import scan (a dry run) ----------------------------------------------

function csmFolderId_() {
  var id = '';
  try { id = String(hubProp_(CSM_FOLDER_PROP) || '').trim(); } catch (e) { id = ''; }
  return id || CSM_FOLDER_FALLBACK;
}

function csmClientsRoot_() {
  return DriveApp.getFolderById(csmFolderId_());
}

/** The roster by the drive's folder keys; a key two clients share names nobody. */
function csmScanRoster_() {
  var byFl = {}, byFold = {};
  var put = function (map, k, who) {
    if (!k) return;
    var had = map.hasOwnProperty(k) ? map[k] : undefined;
    map[k] = had === undefined || (had && had.key === who.key) ? who : null;
  };
  (clientsDerived_(null) || []).forEach(function (c) {
    var key = String(c.client_key || '').trim() || clientNameKey_(c.name);
    if (!key) return;
    var who = { key: key, name: csmText_(c.name) };
    put(byFl, csmFlKey_(c.name), who);
    put(byFold, clientNameKey_(c.name), who);
  });
  return { byFl: byFl, byFold: byFold };
}

function csmFolderClient_(name, roster) {
  var fold = clientNameKey_(name), fl = csmFlKey_(name);
  if (fold && roster.byFold.hasOwnProperty(fold)) return roster.byFold[fold];
  return fl && roster.byFl.hasOwnProperty(fl) ? roster.byFl[fl] : null;
}

// Every MARS paper in the Clients drive that client_files does not hold yet: the files in each client folder's MARS…
function csmScan_(only, roster, have, deadline) {
  var out = { folders: 0, indexed: 0, missing: [], unmatched: [], partial: false, why: '' };
  var clock = function () { return new Date().getTime(); };
  var stop = function () {
    if (clock() <= deadline) return false;
    out.partial = true;
    out.why = out.why || 'the scan stopped at its time budget; what is listed is what it reached';
    return true;
  };
  var queue = [];
  var tops = csmClientsRoot_().getFolders();
  while (tops.hasNext()) {
    var top = tops.next();
    var tn = String(top.getName()).trim();
    if (CSM_INACTIVE_TOP.test(tn)) {
      var subs = top.getFolders();
      while (subs.hasNext()) queue.push({ f: subs.next(), area: 'inactive' });
    } else if (!CSM_SYSTEM_TOP.test(tn)) {
      queue.push({ f: top, area: 'active' });
    }
  }
  var note = function (file, path, who, folderName, area, named) {
    var id = String(file.getId());
    if (have[id]) { out.indexed++; return; }
    if (out.missing.length >= CSM_SCAN_LIST_CAP) {
      out.partial = true;
      out.why = 'more than ' + CSM_SCAN_LIST_CAP + ' papers are missing; the first ' + CSM_SCAN_LIST_CAP + ' are listed';
      return;
    }
    var name = String(file.getName());
    var at = file.getLastUpdated();
    out.missing.push({
      drive_id: id, name: name, mime: String(file.getMimeType()), size_bytes: Number(file.getSize()) || 0,
      modified_time: at instanceof Date ? at.toISOString() : csmText_(at), folder: path || area, area: area,
      client_key: who ? who.key : '', client_name: who ? who.name : folderName, file_date: csmFileDate_(name),
      named_mar: named
    });
  };
  for (var q = 0; q < queue.length; q++) {
    if (stop()) break;
    var folder = queue[q].f, area = queue[q].area;
    var folderName = String(folder.getName()).trim();
    var who = csmFolderClient_(folderName, roster);
    if (only && (!who || who.key !== only.key)) continue;
    out.folders++;
    if (!who) out.unmatched.push(folderName);
    var files = folder.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      if (CSM_MAR_NAME.test(String(f.getName()))) note(f, '', who, folderName, area, true);
    }
    var walk = [{ f: folder, path: '', depth: 0 }];
    while (walk.length && !stop()) {
      var cur = walk.shift();
      var kids = cur.f.getFolders();
      while (kids.hasNext()) {
        var kid = kids.next();
        var kn = String(kid.getName()).trim();
        var path = cur.path ? cur.path + '/' + kn : kn;
        if (/^mars?$/i.test(kn)) {
          var inside = kid.getFiles();
          while (inside.hasNext()) {
            var g = inside.next();
            note(g, path, who, folderName, area, CSM_MAR_NAME.test(String(g.getName())));
          }
        } else if (cur.depth < 1) {
          walk.push({ f: kid, path: path, depth: cur.depth + 1 });
        }
      }
    }
  }
  out.missing.sort(function (a, b) {
    if (a.client_name !== b.client_name) return a.client_name < b.client_name ? -1 : 1;
    return a.file_date === b.file_date ? (a.name < b.name ? -1 : 1) : (a.file_date < b.file_date ? 1 : -1);
  });
  return out;
}

/** The MARS papers in the client folders that client_files does not hold yet — a dry run: nothing is written. */
HUB_POLICY.clientSourceMarImportScan = {
  file: 'ClientSourceMar.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' } }
};
HUB_ACTIONS.clientSourceMarImportScan = function (payload, user) {
  var raw = payload && payload.client;
  var named = raw !== undefined && raw !== null && String(raw).trim() !== '';
  var reader = csmGate_(user, raw, !named);
  if (!reader || csmOwnOnly_(reader)) return csmUnknown_();
  var only = null;
  if (named) {
    only = csmClient_(raw);
    if (only.refused) return only.refused;
  }
  var roster, have = {};
  try { roster = csmScanRoster_(); }
  catch (eR) { return { status: 503, message: 'The clients could not be read just now (' + csmWhy_(eR) + ').' }; }
  try {
    (clientFilesAll_() || []).forEach(function (r) {
      var id = csmText_(r.drive_id);
      if (id) have[id] = true;
    });
  } catch (eI) {
    return { status: 503, message: 'The MARS papers index could not be read, so nothing can be called new (' +
             csmWhy_(eI) + ').' };
  }
  var out;
  try { out = csmScan_(only, roster, have, new Date().getTime() + CSM_SCAN_BUDGET_MS); }
  catch (eS) {
    return { status: 503, message: 'The Clients drive could not be read just now (' + csmWhy_(eS) + ').' };
  }
  if (only && !out.folders) out.why = 'no folder in the Clients drive names this client';
  return { status: 200, data: {
    dry_run: true, scope: only ? only.key : 'all',
    client: only ? { client_key: only.key, name: only.name } : null,
    folders: out.folders, indexed: out.indexed, missing_count: out.missing.length, missing: out.missing,
    unmatched_folders: out.unmatched, partial: out.partial, why: out.why
  } };
};
