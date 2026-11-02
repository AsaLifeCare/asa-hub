// ------------------------------------------------------------------ STAFF ATTENDANCE — the mailbox hears it, the…
// When the platform mailbox receives "Late Show — Jeremiah Inman " "No Show No Call — Nikyla Compton " the platform…

var STAFF_ALERTS_TAB = 'staff_alerts';
var STAFF_ALERTS_HEADER = ['message_id', 'kind', 'person', 'when_iso', 'when_text',
                           'alerted', 'recipients', 'filed', 'seen_at', 'folder'];

// SMART COMMS OWNS THE LIST, THE WORDS AND THE SWITCH.
function staffAlertSid_(kind) {
  var noCall = String(kind) === 'no_call';
  return (typeof commSituationId_ === 'function')
    ? commSituationId_(noCall ? 'staff.no_call' : 'staff.late_show',
                       noCall ? 'staff_no_call' : 'staff_late_show')
    : (noCall ? 'staff_no_call' : 'staff_late_show');
}

// The situation behind an attendance kind, read once: { id, row, on, unreadable }.
function staffAlertSituation_(kind) {
  var sid = staffAlertSid_(kind);
  var out = { id: sid, row: null, on: false, unreadable: '' };
  try {
    if (typeof smartSituations_ !== 'function') throw new Error('the situations reader is not in this build');
    var rows = smartSituations_() || [];
    for (var i = 0; i < rows.length; i++) {
      if (str_(rows[i].id) === sid) { out.row = rows[i]; break; }
    }
  } catch (eS) {
    out.unreadable = 'the Smart Comms situations could not be read (' +
                     String((eS && eS.message) || eS).slice(0, 160) + ')';
    return out;
  }
  out.on = !!(out.row && typeof smartOn_ === 'function' && smartOn_(out.row.enabled));
  return out;
}

/** Why an attendance situation sends nothing right now, or '' when it may send. */
function staffAlertStopWhy_(read) {
  var r = read || {};
  if (r.unreadable) return r.unreadable + ' — nothing was sent; the next pass asks again';
  if (!r.row) return 'the situation ' + str_(r.id) + ' is not in the situations tab — nothing was sent';
  if (!r.on) return 'the situation ' + str_(r.id) + ' is switched off';
  return '';
}

/** {placeholder} words for an attendance alert. */
function staffAlertRender_(tpl, vars) {
  return (typeof smartRender_ === 'function') ? smartRender_(String(tpl || ''), vars || {})
                                              : String(tpl || '');
}

// THE LETTER IN THE ROW'S WORDS.
function staffAlertLetter_(read, opts, vars) {
  var row = (read && read.row) || {};
  var o = {};
  for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
  var subj = str_(row.email_subject), text = str_(row.email_text);
  if (subj) o.subject = staffAlertRender_(subj, vars);
  if (text) o.leadText = staffAlertRender_(text, vars);
  return staffAlertEmail_(o);
}

// THE TEXT LEG THIS ALERT NEVER HAD.
function staffAlertSmsPlan_(kind, vars, read) {
  var got = read || staffAlertSituation_(kind);
  if (staffAlertStopWhy_(got)) return null;
  var sit = got.row;
  var channels = (typeof smartList_ === 'function') ? smartList_(sit.channels) : [];
  if (channels.indexOf('sms') === -1) return null;
  var words = str_(sit.sms_text);
  if (!words) return null;
  var numbers = String(sit.to || '').split(/[,;]+/)
    .map(function (x) { return String(x).trim(); })
    .filter(function (x) { return x && x.indexOf('@') === -1; });
  if (!numbers.length) return null;
  return { numbers: numbers,
           body: (typeof smartRender_ === 'function') ? smartRender_(words, vars || {}) : words };
}

// The addresses on the row, and only the row: [] when it cannot be read, is absent or off, or names nobody — never…
function staffAlertRecipients_(kind, read) {
  var got = read || staffAlertSituation_(kind);
  if (staffAlertStopWhy_(got)) return [];
  return String(got.row.to || '').split(/[,;]+/).map(function (x) { return x.trim(); })
    .filter(function (x) { return x.indexOf('@') !== -1; });
}

// The addresses and numbers left once a director or the master who turned the No Call No Show alert off is taken…
function staffAlertReceivers_(kind, list) {
  if (String(kind) !== 'no_call' || typeof arKeep_ !== 'function') return list || [];
  return arKeep_('no_call', list || []);
}

/** Said once per kind per execution: a row that names nobody sends nothing. */
var STAFF_ALERT_NOBODY_SAID = {};

function staffAlertNobodySay_(read) {
  var id = str_(read && read.id);
  if (STAFF_ALERT_NOBODY_SAID[id]) return;
  STAFF_ALERT_NOBODY_SAID[id] = true;
  try {
    hubSysLog_('asa-hub:staffalerts', 'attendance_row_names_nobody',
               id + ' is on and names no address and no number in `to`, so nothing was sent — ' +
               'type the recipients on the Desk', { status: 200 });
  } catch (e) { /* the answer says it too */ }
}

// "<Category> — Name (iso)", tolerant of which dash the sender used — and the CATEGORY is open: the folders are…
function staffAlertParse_(subject) {
  var m = /^\s*([A-Za-z][A-Za-z0-9 ]{1,40}?)\s*[—–-]+\s*(.+?)\s*\(([^)]+)\)\s*$/
    .exec(String(subject || ''));
  if (!m) return null;
  var whenIso = m[3].trim();
  if (!Date.parse(whenIso)) return null;
  var label = m[1].replace(/\s+/g, ' ').trim();
  var low = label.toLowerCase();
  var kind = '', canon = '';
  // THE CATEGORIES — late call, no show, call off, and whatever else arrives.
  if (/late/.test(low)) { kind = 'late_show'; canon = 'Late Show'; }
  else if (/no\s*show|ncns|no\s*call/.test(low)) { kind = 'no_call'; canon = 'No Show No Call'; }
  else if (/call\s*off/.test(low)) { kind = 'call_off'; canon = 'Call Off'; }
  else if (/early/.test(low)) { kind = 'early_out'; canon = 'Early Out'; }
  else {
    kind = low.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    canon = label;
  }
  if (!kind) return null;
  return { kind: kind, label: canon, person: m[2].trim(), whenIso: whenIso };
}

// The folder a category files into — born on first sight, shaped so the relay's allowlist can hold it ("Staff " +…
function staffAlertFolder_(kind, label) {
  if (kind === 'late_show') return 'Staff Late Show';
  if (kind === 'no_call') return 'Staff No Call';
  if (kind === 'call_off') return 'Staff Call Off';
  if (kind === 'early_out') return 'Staff Early Out';
  var clean = String(label || '').replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return clean ? 'Staff ' + clean : 'Staff Reports';
}

// The instant in the subject, on the COMPANY's clock — the conversion of that date and time must not come out…
function staffAlertWhen_(iso) {
  var t = Date.parse(String(iso || ''));
  if (!t) return String(iso || '');
  var d = new Date(t);
  var day = Utilities.formatDate(d, 'America/New_York', 'EEE, MMM d, yyyy');
  var hm = Utilities.formatDate(d, 'America/New_York', 'HH:mm');
  if (hm === '00:00') return day;
  return day + ' at ' + Utilities.formatDate(d, 'America/New_York', 'h:mm a');
}

// A relay call that carries ONLY the service secret — the shift question needs no mailbox credentials, so none…
function staffRelayPost_(path, extra) {
  var secret = '';
  try { secret = String(hubProp_('HUB_SERVICE_SECRET') || ''); }
  catch (eS) { secret = ''; }
  if (!secret) return { status: 503, message: 'HUB_SERVICE_SECRET is not configured' };
  var payload = { service_secret: secret };
  for (var k in (extra || {})) payload[k] = extra[k];
  try {
    var r = UrlFetchApp.fetch(PLATFORM_MAIL_RELAY + path, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var env = {};
    try { env = JSON.parse(r.getContentText() || '{}'); } catch (eJ) { env = {}; }
    if (r.getResponseCode() >= 400 || !env.status) {
      var code = r.getResponseCode();
      return { status: (code >= 400 ? code : 502), message: String(env.message || 'not the relay\'s answer') };
    }
    return env;
  } catch (e) {
    return { status: 502, message: String((e && e.message) || e).slice(0, 140) };
  }
}

// The report's own words, with any raw ISO instant re-dressed on the company's clock — an hour that leaves broken…
function staffAlertQuoteText_(s) {
  return String(s || '').replace(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?/g,
    function (iso) { return staffAlertWhen_(iso); }
  );
}

/** The Ohio DAY an instant falls on — the roster is kept in days. */
function staffAlertDay_(iso) {
  var raw = String(iso || '').trim();
  // A BARE ISO DAY IS ALREADY THE DAY, and sending it through a clock loses one: `Date.parse` reads a bare…
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  var t = Date.parse(raw);
  if (!t) return '';
  return Utilities.formatDate(new Date(t), 'America/New_York', 'yyyy-MM-dd');
}

// The attendance situation a category belongs to, or '' for a category no attendance situation speaks for — a call…
function staffAlertLedgerSid_(kind) {
  if (String(kind) === 'no_call') return 'staff_no_call';
  if (String(kind) === 'late_show') return 'staff_late_show';
  return '';
}

// THE KEY ONE TELLING IS REMEMBERED BY: the situation, the person, and the DAY THE ABSENCE IS ABOUT.
function staffAlertLedgerKey_(sid, person, dayIso) {
  var nameKey = (typeof clientNameKey_ === 'function')
    ? clientNameKey_(person) : String(person || '').toLowerCase();
  return (typeof smartLedgerKey_ === 'function')
    ? smartLedgerKey_(sid, nameKey, dayIso)
    : (sid + '|' + nameKey + '|' + String(dayIso || '').slice(0, 10));
}

// "48TH · 08:00–20:00" from the roster mirror, or '' when nothing is found — the letter says so honestly rather…
function staffShiftText_(person, dayIso) {
  if (!dayIso) return '';
  var r = staffRelayPost_('/shift/of', { person: person, date: dayIso });
  if (!r || r.status !== 200 || !r.data || !r.data.found) return '';
  var shifts = r.data.shifts || [];
  // A cell with HOURS is the shift; a bare token beside it ("@ 48TH") is the same fact said twice — verified live…
  var timed = shifts.filter(function (x) { return x.start && x.end; });
  var chosen = timed.length ? timed : shifts;
  var parts = [];
  for (var i = 0; i < chosen.length; i++) {
    var sft = chosen[i];
    var span = (sft.start && sft.end) ? (sft.start + '\u2013' + sft.end) : str_(sft.status);
    parts.push((str_(sft.house) ? sft.house + ' \u00b7 ' : '') + span);
  }
  return parts.join('  +  ');
}

// When they actually ARRIVED, from the time clock (time_punches — the reconciliation uploads).
function staffArrivalText_(person, dayIso) {
  if (!dayIso) return '';
  var rows;
  try { rows = listRows_('time_punches', {}); } catch (e) { rows = []; }
  var want = String(person || '').trim().toLowerCase();
  var best = null, bestT = null;
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].date).slice(0, 10) !== dayIso) continue;
    var who = str_(rows[i].employeeName).trim().toLowerCase();
    if (who !== want) continue;
    var startTxt = str_(rows[i].start);
    if (!startTxt) continue;
    var t = Date.parse(dayIso + ' ' + startTxt);
    if (best === null || (t && (bestT === null || t < bestT))) { best = rows[i]; bestT = t || bestT; }
  }
  if (!best) return '';
  return str_(best.start) + (str_(best.location) ? ' at ' + str_(best.location) : '') + ' (time clock)';
}

// THE TWO PEOPLE WHO CAN DO SOMETHING ABOUT IT TONIGHT.
function staffAlertEscalation_(person, dayIso) {
  var out = [], why = [];
  var house = '';
  try {
    var r = staffRelayPost_('/shift/of', { person: person, date: dayIso });
    var shifts = (r && r.status === 200 && r.data && r.data.shifts) ? r.data.shifts : [];
    for (var i = 0; i < shifts.length && !house; i++) house = str_(shifts[i].house);
  } catch (eS) { house = ''; }
  if (!house) why.push('no house on the roster for that day');
  else {
    try {
      var hm = (typeof hotlineHouseManager_ === 'function') ? hotlineHouseManager_(house) : null;
      if (hm && str_(hm.phone)) out.push(str_(hm.phone));
      else why.push('the house "' + house + '" resolves to no manager with a number');
    } catch (eH) { why.push('the manager of "' + house + '" could not be read'); }
  }
  try {
    var routes = (typeof commRecordRoutes_ === 'function') ? commRecordRoutes_() : {};
    var key = (typeof clientNameKey_ === 'function') ? clientNameKey_(person) : String(person).toLowerCase();
    var sup = str_((routes[key] || {}).supervisor);
    if (!sup) why.push('the routes name no supervisor for ' + person);
    else if (sup.replace(/\D/g, '').length >= 10) out.push(sup);
    else {
      // A NAME, NOT A NUMBER.
      var found = '';
      try {
        (listRows_('people', {}) || []).forEach(function (p) {
          if (found) return;
          if (clientNameKey_(p.name) === clientNameKey_(sup)) found = str_(p.phone);
        });
      } catch (eP) { found = ''; }
      if (found) out.push(found);
      else why.push('the supervisor (' + sup + ') carries no number we may text');
    }
  } catch (eR) { why.push('the routes could not be read'); }
  if (why.length) {
    try {
      hubSysLog_('asa-hub:staffalerts', 'attendance_escalation_partial',
                 person + ': ' + why.join(' · '), { status: 200 });
    } catch (eL) { /* the numbers that did resolve still go */ }
  }
  return out;
}

var STAFF_AI_TAB = 'mail_ai_verdicts';
// `verdict` carries the category slug the reader gave, or one of two words that are not categories: 'none' — not an…
var STAFF_AI_HEADER = ['message_id', 'verdict', 'label', 'person', 'when_iso', 'via', 'seen_at'];

// ONE PASS AT A TIME, WITHOUT HOLDING THE PLATFORM STILL.
var STAFF_SWEEP_CLAIM_KEY = 'staff_sweep_running';
var STAFF_SWEEP_CLAIM_S = 12 * 60;

// EVERY MESSAGE GETS A FOLDER.
var MAIL_ROUTES_TAB = 'mail_routes';
var MAIL_ROUTES_HEADER = ['message_id', 'folder', 'via', 'filed', 'seen_at', 'hint'];

function mailRoutesSheet_() {
  var existed = !!hubTabSheet_(MAIL_ROUTES_TAB);
  var sheet = hubTabEnsure_(MAIL_ROUTES_TAB, MAIL_ROUTES_HEADER);
  // A tab written before a column existed is widened, never re-stamped.
  if (existed) ensureHeader_(sheet, MAIL_ROUTES_HEADER);
  return sheet;
}

// "Mail <Label>" — the general categorizer's folder family, shaped so the relay's allowlist can hold it (the…
function mailRouteFolder_(label) {
  var clean = String(label || '').replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return clean ? 'Mail ' + clean : 'Mail Other';
}

// The ASCII search bait for /mail/file's subject fallback — automated mail often carries no Message-ID, and…
function mailRouteHint_(subject) {
  var ascii = String(subject || '').replace(/[^\x20-\x7E]+/g, ' ').replace(/\s+/g, ' ').trim();
  return ascii.slice(0, 60);
}

// The deterministic reader — free, first.
function mailRouteRule_(t) {
  var from = str_(t.from_addr).toLowerCase();
  var to = str_(t.to).toLowerCase();
  var subj = str_(t.subject).toLowerCase();
  // The AI providers' own mail — usage caps, tier notices, model retirements.
  if (/(^|[@.])groq\.com$/.test(from) || /(^|[@.])(openai\.com|anthropic\.com|cerebras\.ai)$/.test(from)) {
    return 'Mail Free Tier';
  }
  // The two forwarded hiring mailboxes: the To header keeps the address the mail was originally sent to, and the…
  if (to.indexOf('interviewer@asalifecare.com') !== -1 ||
      subj.indexOf('interviewer@asalifecare.com') !== -1) return 'Mail Interviews';
  if (to.indexOf('onboarding@asalifecare.com') !== -1 ||
      subj.indexOf('onboarding@asalifecare.com') !== -1) return 'Mail Onboarding';
  if (/(^|[@.])github\.com$/.test(from)) return 'Mail Github';
  return '';
}

// The model reads what no rule matched — ONE call per message, ever (the mail_routes row is the memory).
function mailRouteAi_(t) {
  if (typeof screenAiChat_ !== 'function') return null;
  var textAll = ('FROM: ' + str_(t.from_addr) + '\nTO: ' + str_(t.to) +
                 '\nSUBJECT: ' + str_(t.subject) + '\n' + str_(t.snippet)).slice(0, 1200);
  var ask =
    'You sort the mailbox of a care company into folders. Read this message ' +
    'and pick its category.\n\nMESSAGE:\n' + textAll + '\n\n' +
    'Known categories: Free Tier (AI/API provider notices, usage caps, ' +
    'billing tiers), Interviews (candidates, interview scheduling), ' +
    'Onboarding (new-hire paperwork), Github (repository notifications), ' +
    'Invoices (bills, receipts), Newsletters, Security (sign-in alerts, ' +
    'password resets), Notices (automated no-reply mail).\n' +
    'Reply with JSON only: {"category":"<one of the known names, or a NEW ' +
    '1-3 word Title Case name that fits better>"}';
  var res = null;
  try { res = screenAiChat_(ask, 0.1, 'ai_mail_route'); } catch (e) { res = null; }
  if (!res || !res.ok) return null;
  var parsed = null;
  try { parsed = JSON.parse(str_(res.content)); } catch (e2) { parsed = null; }
  var label = parsed ? str_(parsed.category) : '';
  return { folder: mailRouteFolder_(label), via: str_(res.via) || 'ai' };
}

// THE SECOND READER — the kinds of e-mail and their content are read by an AI, and the model of choice is Groq.
function staffAiSheet_() {
  var existed = !!hubTabSheet_(STAFF_AI_TAB);
  var sheet = hubTabEnsure_(STAFF_AI_TAB, STAFF_AI_HEADER);
  // A tab written before a column existed is widened, never re-stamped.
  if (existed) ensureHeader_(sheet, STAFF_AI_HEADER);
  return sheet;
}

function staffAlertClassifyAi_(subject, snippet) {
  if (typeof screenAiChat_ !== 'function') return null;
  var textAll = (String(subject || '') + '\n' + String(snippet || '')).slice(0, 1200);
  var ask =
    'You sort the mailbox of a care company. Decide whether this message is a STAFF ' +
    'ATTENDANCE REPORT about one employee, and classify it.\n\n' +
    'MESSAGE:\n' + textAll + '\n\n' +
    'Known categories: late_show (arrived late), no_call (no show no call), ' +
    'call_off (called off the shift), early_out (left early).\n' +
    'Reply with JSON only:\n' +
    '{"category":"<one of the known slugs, or a NEW 1-3 word lowercase slug, or none>",' +
    '"label":"<2-3 word title for the category>",' +
    '"person":"<the employee\'s name exactly as written in the message>",' +
    '"date_iso":"<the shift date/instant from the message, ISO>"}\n' +
    'If it is not a staff attendance report, category is "none".';
  var res = null;
  try { res = screenAiChat_(ask, 0.1, 'ai_alert_classify'); } catch (e) { res = null; }
  if (!res || !res.ok) return null;
  var parsed = null;
  try { parsed = JSON.parse(str_(res.content)); } catch (e2) { parsed = null; }
  if (!parsed) return null;
  var cat = str_(parsed.category).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!cat || cat === 'none') return { none: true, via: str_(res.via) };
  // THE GATE.
  var person = str_(parsed.person);
  var hay = textAll.toLowerCase();
  var words = person.toLowerCase().split(/\s+/).filter(String);
  if (!person || !words.length ||
      !words.every(function (w) { return hay.indexOf(w) !== -1; })) {
    return { refused: true, why: 'the message never wrote that name', via: str_(res.via) };
  }
  var whenIso = str_(parsed.date_iso);
  if (!Date.parse(whenIso)) {
    return { refused: true, why: 'the date does not parse', via: str_(res.via) };
  }
  var label = str_(parsed.label).replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
  // Known slugs land in the canonical family whatever the model called them.
  if (cat === 'late_show' || cat === 'no_call' || cat === 'call_off' || cat === 'early_out') {
    label = '';
  }
  return { kind: cat, label: label, person: person, whenIso: whenIso, via: str_(res.via) };
}

function staffAlertsSheet_() {
  var existed = !!hubTabSheet_(STAFF_ALERTS_TAB);
  var sheet = hubTabEnsure_(STAFF_ALERTS_TAB, STAFF_ALERTS_HEADER);
  // A tab written before a column existed is widened, never re-stamped.
  if (existed) ensureHeader_(sheet, STAFF_ALERTS_HEADER);
  return sheet;
}

// THE SECOND SOURCE: THE TIME CLOCK ITSELF — the PsiAnywhere logins are checked, and an absence may be told by…
HUB_POLICY.staffAttendancePunch = {
  file: 'StaffAlerts.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [],
  emits: ['emailSend', 'smsSend']
};
HUB_ACTIONS.staffAttendancePunch = function (payload) {
  var data = payload || {};
  // `quiet` counts the rows the send door's quiet window held — every leg answered "not now" — and they are inside…
  var out = { told: 0, held: 0, quiet: 0, skipped: 0, off: 0, kinds: {}, why: [] };
  var work = [];
  ['late', 'no_call'].forEach(function (bucket) {
    var kind = bucket === 'late' ? 'late_show' : 'no_call';
    (data[bucket] || []).forEach(function (r) { work.push({ kind: kind, row: r || {} }); });
  });
  if (!work.length) return { status: 200, data: out };

  var today = '';
  try {
    today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  } catch (eD) { today = new Date().toISOString().slice(0, 10); }
  try { if (typeof supportDeskAttendance_ === 'function') supportDeskAttendance_(work, today); } catch (eSd) {}

  // THE LEDGER, AND A READ THAT FAILED IS NOT A LEDGER THAT IS EMPTY.
  var told = null;
  if (typeof smartAlreadySent_ === 'function') {
    try { told = smartAlreadySent_(); } catch (eL) { told = null; }
  } else {
    told = {};
  }
  if (!told) {
    out.held = work.length;
    out.why.push('the Smart Comms ledger could not be read, so nobody was told: ' +
                 'telling again what another door already said is the one mistake ' +
                 'this door cannot take back. The rows wait for the next pass.');
    try {
      hubSysLog_('asa-hub:staffalerts', 'attendance_punch_ledger_unreadable',
                 work.length + ' row(s) held: the ledger could not be read, and a ' +
                 'read that failed is not a ledger that is empty',
                 { status: 503 });
    } catch (eLu) { /* the hold is the answer */ }
    return { status: 503, message: 'The Smart Comms ledger could not be read — ' +
                                   'nothing was sent, and the next pass tries again',
             data: out };
  }

  // THE SWITCHES, READ ONCE PER KIND BEFORE ANYTHING IS SAID.
  var reads = {};
  var unreadableWhy = '';
  work.forEach(function (item) {
    if (unreadableWhy || reads[item.kind]) return;
    reads[item.kind] = staffAlertSituation_(item.kind);
    if (reads[item.kind].unreadable) unreadableWhy = reads[item.kind].unreadable;
  });
  if (unreadableWhy) {
    out.held = work.length;
    out.why.push(unreadableWhy + ', so nobody was told; the rows wait for the next pass.');
    try {
      hubSysLog_('asa-hub:staffalerts', 'attendance_punch_switch_unreadable',
                 work.length + ' row(s) held: ' + unreadableWhy, { status: 503 });
    } catch (eSu) { /* the hold is the answer */ }
    return { status: 503, message: 'The Smart Comms situations could not be read — nothing was sent, ' +
                                   'and the next pass tries again',
             data: out };
  }

  work.forEach(function (item) {
    var person = str_(item.row.person);
    if (!person) { out.skipped++; return; }
    var sid = item.kind === 'no_call' ? 'staff_no_call' : 'staff_late_show';
    /* keyed on the day the absence is about, so it is never told twice; a source without `day` means today */
    var day = str_(item.row.day) || today;
    // ONE TELLING PER PERSON PER DAY PER KIND, and the key says all three.
    var key = staffAlertLedgerKey_(sid, person, day);
    if (told[key]) { out.skipped++; return; }

    var read = reads[item.kind];
    if (staffAlertStopWhy_(read)) { out.held++; return; }

    var shiftWords = [str_(item.row.house), str_(item.row.shift_code)]
      .filter(function (x) { return x; }).join(' · ');
    // WHAT THE SOURCE ACTUALLY KNOWS, in its own words where it has them.
    var whenWords = str_(item.row.when)
      || (str_(item.row.minutes_late)
            ? (str_(item.row.minutes_late) + ' minutes after the shift began')
            : str_(item.row.shift_at));
    // WHERE THIS ONE CAME FROM, in the letter itself.
    var reportWords = str_(item.row.report).slice(0, 300)
      || 'No report was written: the time clock has no punch for this shift.';
    // WHO LEARNED IT.
    var source = str_(item.row.source) === 'form' ? 'form' : 'time_clock';
    var sent = [];
    var quietLeg = false;

    var wordVars = { person: person, when: whenWords, name: person,
                     first_name: person.split(/\s+/)[0], shift: shiftWords };
    var letter = staffAlertLetter_(read, {
      kind: item.kind, person: person, whenText: whenWords,
      shiftText: shiftWords || staffShiftText_(person, day),
      /* The clock's own arrival time, when it has one: a late punch it read. */
      arrivedText: str_(item.row.arrived),
      reportWords: reportWords,
      source: source
    }, wordVars);
    var mailTo = staffAlertRecipients_(item.kind, read);
    var plan = staffAlertSmsPlan_(item.kind, wordVars, read);
    if (!mailTo.length && !plan) { staffAlertNobodySay_(read); out.held++; return; }
    if (plan) staffAlertEscalation_(person, day).forEach(function (n) { plan.numbers.push(n); });
    // A DIRECTOR OR THE MASTER WHO TURNED THIS ALERT OFF is left out of both legs, and everyone else is told as…
    mailTo = staffAlertReceivers_(item.kind, mailTo);
    var textTo = plan ? staffAlertReceivers_(item.kind, plan.numbers) : [];
    if (!mailTo.length && !textTo.length) { out.off++; return; }
    mailTo.forEach(function (addr) {
      // ONE KEY PER ADDRESS.
      var mail = rpcCall_('emailSend', {
        to: addr, subject: letter.subject, body: letter.text, html: letter.html,
        reason: 'staff attendance (punch): ' + item.kind + ' — ' + person
      }, { idempotency_key: 'att_punch_mail_' + sid + '_' + person.slice(0, 20) + '_' + day +
                             '_' + String(addr).trim().toLowerCase() });
      if (mail && mail.sent) sent.push(mail.redirected ? '[test]' : addr);
      else if (mail && mail.quiet) quietLeg = true;
    });

    if (plan) {
      var texted = {};
      plan.numbers.forEach(function (raw, i) {
        if (textTo.indexOf(raw) === -1) return;
        var digits = String(raw).replace(/\D/g, '').slice(-10);
        if (!digits || texted[digits]) return;
        texted[digits] = true;
        var num = (typeof packetTeamCopyNumber_ === 'function') ? packetTeamCopyNumber_(raw) : '';
        if (!num) return;
        var sms = rpcCall_('smsSend', {
          to: num, body: plan.body,
          reason: 'staff attendance (punch): ' + item.kind + ' — ' + person
        }, { idempotency_key: 'att_punch_sms' + i + '_' + sid + '_' + person.slice(0, 20) + '_' + day });
        if (sms && sms.sent) sent.push(sms.redirected ? '[test]' : num);
        else if (sms && sms.quiet) quietLeg = true;
      });
    }

    if (sent.length) {
      out.told++;
      out.kinds[item.kind] = (out.kinds[item.kind] || 0) + 1;
      // RECORDED ONLY WHEN SOMETHING REALLY LEFT.
      var real = sent.filter(function (x) { return x !== '[test]'; }).length;
      if (real) {
        if (typeof smartRecord_ === 'function') {
          try { smartRecord_(key, sid, person, day, 'punch'); } catch (eR) { /* said in the log */ }
        }
        // AND THIS PASS'S OWN COPY OF THE LEDGER LEARNS IT IMMEDIATELY.
        told[key] = true;
      }
    } else if (quietLeg) {
      // COUNTED IN BOTH: `held` is what a relay that predates the window already reads as "offer it again", and…
      out.quiet++;
      out.held++;
    } else {
      out.held++;
    }
  });

  try {
    hubSysLog_('asa-hub:staffalerts', 'attendance_punch',
               out.told + ' told · ' + out.held + ' held' +
               (out.quiet ? ' (' + out.quiet + ' of them by the quiet window, until 08:00)' : '') + ' · ' +
               out.skipped +
               ' already told today · ' + (out.off ? out.off + ' turned off by every recipient · ' : '') +
               JSON.stringify(out.kinds),
               { status: 200 });
  } catch (eLg) { /* the answer is the relay's copy */ }
  return { status: 200, data: out };
};

// THE SHIFT FLOW'S DOOR: the ask before every shift and its repeats ("All set for your shift at {house} at {time}?
var STAFF_SHIFT_SITUATIONS = {
  confirm_ask: 'shift_confirm_ask',
  confirm_again: 'shift_confirm_again',
  hm_no_show: 'shift_no_show_house_manager',
  hm_confirm_no: 'shift_confirm_no_house_manager',
  late_call: 'late_call_house_manager',
  note_due: 'daily_note_due',
  login_before: 'shift_login_before',
  login_missing: 'shift_login_missing',
  early_in: 'shift_early_in',
  // GIVING A SHIFT AWAY — two consents, and a message for each of them: a HOUSE MANAGER has to approve it and the…
  handoff_ask_staff: 'shift_handoff_ask_staff',
  handoff_ask_manager: 'shift_handoff_ask_manager',
  handoff_done: 'shift_handoff_done',
  handoff_declined: 'shift_handoff_declined',
  /* the transfer's other five (server/shift_handoff.py) */
  handoff_ask_above: 'shift_handoff_ask_above',
  handoff_done_taker: 'shift_handoff_done_taker',
  handoff_done_manager: 'shift_handoff_done_manager',
  handoff_declined_taker: 'shift_handoff_declined_taker',
  handoff_declined_manager: 'shift_handoff_declined_manager',
  // THE THIRD CONSENT.
  handoff_ask_director: 'shift_handoff_ask_director',
  handoff_done_director: 'shift_handoff_done_director',
  handoff_declined_director: 'shift_handoff_declined_director',
  // APPLICATIONS CLOSED AND SOMEBODY WANTS THE SHIFT.
  open_shift_applicants: 'shift_applicants_waiting',
  /* SMS reply answers (server/sms_ears.py), to the row's own person only */
  sms_reply_applied: 'shift_reply_applied',
  sms_reply_refused: 'shift_reply_refused',
  sms_reply_unclear: 'shift_reply_unclear',
  sms_reply_answered: 'shift_reply_answered',
  // a director's RECEIVED on a punch warning, one situation per outcome, so each is worded and switched on its own…
  sms_reply_punch_open: 'shift_reply_punch_open',
  sms_reply_punch_waiting: 'shift_reply_punch_waiting',
  sms_reply_punch_closed: 'shift_reply_punch_closed',
  /* time off (server/time_off.py): each row names its own recipient */
  timeoff_ask_manager: 'time_off_ask_manager',
  timeoff_ask_above: 'time_off_ask_above',
  timeoff_ask_director: 'time_off_ask_director',
  timeoff_scheduled: 'time_off_scheduled',
  timeoff_scheduled_manager: 'time_off_scheduled_manager',
  timeoff_denied: 'time_off_denied',
  timeoff_cancelled: 'time_off_cancelled',
  timeoff_cancelled_manager: 'time_off_cancelled_manager',
  timeoff_expired: 'time_off_expired',
  // THE PUNCH PAIR (server/punch_pairs.py): every shift owes a clock-in and a clock-out of ITS OWN.
  punch_changeover: 'shift_punch_changeover',
  punch_open_entry: 'shift_punch_open_entry',
  punch_warning: 'shift_punch_warning',
  // the same warning for a shift that shares its calendar cell: a RECEIVED cannot open it, so its own words say it…
  punch_warning_by_hand: 'shift_punch_warning_by_hand'
};
// The kinds that go to the HOUSE MANAGER of the roster's house, not to the person the row is about.
var STAFF_SHIFT_TO_MANAGER = { early_in: true, hm_no_show: true, hm_confirm_no: true, late_call: true,
  handoff_ask_manager: true, open_shift_applicants: true,
  handoff_done_manager: true, handoff_declined_manager: true };
/** Handoff kinds whose recipient is not the row's own person. */
var STAFF_SHIFT_HANDOFF_TO = {
  handoff_ask_staff: 'to_staff',
  handoff_done: 'from_staff',
  handoff_declined: 'from_staff',
  handoff_done_taker: 'to_staff',
  handoff_declined_taker: 'to_staff'
};
/** Kinds that go to the directors, resolved as commCallOffTellDirectors_ does. */
var STAFF_SHIFT_TO_DIRECTORS = { handoff_ask_above: true };
// KINDS WHOSE E-MAIL IS A SITUATION OF ITS OWN: its own words, its own switch and its own Desk row, arriving off.
var STAFF_SHIFT_MAIL_SITUATIONS = { login_missing: 'shift_login_missing_mail' };
var STAFF_SHIFT_MAX_ROWS = 50;
// Who writes the shift flow's rehearsal rows — the name its row budget is kept under (Rpc.gs…
var STAFF_SHIFT_PASS_BY = 'asa-hub:staffalerts';
// The FIRST silent minute and the first minute that is not.
var STAFF_SHIFT_QUIET_FROM = '21:31';
var STAFF_SHIFT_QUIET_TO = '08:00';

/** Is this instant inside the quiet window, New York wall time? */
function staffShiftQuiet_(when) {
  var hm = Utilities.formatDate(when, 'America/New_York', 'HH:mm');
  return hm >= STAFF_SHIFT_QUIET_FROM || hm < STAFF_SHIFT_QUIET_TO;
}

// The relay's own hash of a phone: sha256 of the last ten digits, the first sixteen hex characters.
function staffShiftPhoneKey_(raw) {
  var d = String(raw || '').replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, d, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b + 256) % 256;
    return (v < 16 ? '0' : '') + v.toString(16);
  }).join('').slice(0, 16);
}

/** "8:00 AM" — the shift's start on the company's clock, or '' when unreadable. */
function staffShiftTime_(iso) {
  var t = Date.parse(String(iso || ''));
  if (!t) return '';
  return Utilities.formatDate(new Date(t), 'America/New_York', 'h:mm a');
}

// The relay's "07:30" (a New York wall clock, 24h) → "7:30 AM"; anything else travels as it came.
function staffShiftClock_(hhmm) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return String(hhmm || '');
  var h = Number(m[1]);
  if (h > 23) return String(hhmm || '');
  return ((h % 12) || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
}

// CAN THE HOTLINE CALENDAR BE READ AT ALL?
function staffShiftCalendarReadable_() {
  try {
    return !!ssOpen_(hubId_('HOTLINE_CALENDAR_ID')).getSheetByName(HOTLINE_CALENDAR_TAB);
  } catch (e) {
    return false;
  }
}

// The People house by the platform's name fold, with whether each person is ON STAFF — the contact guard's…
function staffShiftPeople_() {
  var out = { readable: false, byKey: {} };
  var rows = null;
  try { rows = withoutIspClients_(peopleMerged_(listRows_('people', {}))); } catch (e) { rows = null; }
  if (!rows) return out;
  out.readable = true;
  var onStaff = {};
  try { onStaff = (typeof cgBlockStatuses_ === 'function') ? cgBlockStatuses_() : {}; }
  catch (eS) { onStaff = {}; }
  if (!Object.keys(onStaff).length) onStaff = { active: true, admin: true };
  rows.forEach(function (p) {
    var k = clientNameKey_(p && p.name);
    if (!k) return;
    var mine = { name: str_(p.name), phone: str_(p.phone), email: str_(p.email),
                 onStaff: !!onStaff[String((p && p.status) || '').trim().toLowerCase()] };
    var held = out.byKey[k];
    if (!held || (!held.onStaff && mine.onStaff)) out.byKey[k] = mine;
  });
  return out;
}

// THE HOUSE MANAGER OF A ROSTER HOUSE — { hm, readable }.
function staffShiftHouseManager_(house, memo) {
  var want = str_(house);
  if (!want) return { hm: null, readable: true };
  var m = memo || {};
  if (!m.exact) m.exact = {};
  var hm = null;
  if (Object.prototype.hasOwnProperty.call(m.exact, want)) {
    hm = m.exact[want];
  } else {
    try { hm = hotlineHouseManager_(want); } catch (eH) { hm = null; }
    m.exact[want] = hm;
  }
  if (hm) return { hm: hm, readable: true };
  if (m.all === undefined) {
    try { m.all = (typeof hotlineHouseManagers_ === 'function') ? hotlineHouseManagers_() : null; }
    catch (eA) { m.all = null; }
  }
  var all = m.all;
  if (!all || !all.readable) return { hm: null, readable: false };
  var code = want.split(' - ').pop().trim().toUpperCase();
  var people = all.people || [];
  for (var i = 0; i < people.length; i++) {
    var loc = str_(people[i].house).toUpperCase();
    if (code && (loc === code || loc.slice(-(code.length + 3)) === ' - ' + code)) {
      return { hm: { name: str_(people[i].name), phone: str_(people[i].phone) }, readable: true };
    }
  }
  return { hm: null, readable: true };
}

/** "Mon 9/22" — the shift's own day on the company's clock, or ''. */
function staffShiftDay_(iso) {
  var t = Date.parse(String(iso || ''));
  if (!t) return '';
  return Utilities.formatDate(new Date(t), 'America/New_York', 'EEE M/d');
}

// WHAT A "DID NOT GO TO WORK" MAY SAY, from what backs it (the relay's row): a PsiAnywhere read after the deadline…
function staffShiftNoShowStatus_(r) {
  var checked = r.checked !== false, asked = r.asked !== false;
  if (checked && r.replied === true) return 'did not go to work - replied, but not YES, and no clock-in';
  if (checked && asked) return 'did not go to work - no reply and no clock-in';
  if (checked) return 'did not go to work - no clock-in';
  if (asked) return 'did not reply, and the time clock could not be checked,';
  return 'was asked only in the rehearsal book, and the time clock could not be checked,';
}

// THE SHIFTS ONE NOTE REMINDER IS ABOUT.
function staffShiftNoteShifts_(r) {
  var list = (Array.isArray(r.shifts) && r.shifts.length) ? r.shifts
    : [{ shift_at: r.shift_at, house: r.house, house_name: r.house_name }];
  var one = function (s) {
    var d = staffShiftDay_(s && s.shift_at), t = staffShiftTime_(s && s.shift_at);
    var h = str_(s && s.house_name) || str_(s && s.house) || 'your house';
    return [d, t].filter(String).join(' ') + (d || t ? ' ' : '') + 'shift at ' + h;
  };
  if (list.length === 1) return 'your ' + one(list[0]);
  return list.length + ' shifts: ' + list.map(one).join(' and ');
}

/** One placeholder set for every shift-flow situation. */
function staffShiftVars_(r, sit, sender) {
  var person = str_(r.person);
  /* a transfer: {name} is always the taker, {status} the relay's reason */
  var handoff = str_(r.kind).indexOf('handoff_') === 0;
  return {
    first_name: person.split(/\s+/)[0] || person,
    name: handoff ? (str_(r.taker) || str_(r.to_staff)) : person,
    house: str_(r.house_name) || str_(r.house) || 'your house',
    time: staffShiftTime_(r.shift_at) || str_(r.shift_code),
    day: staffShiftDay_(r.shift_at),
    minutes: String(Math.max(0, parseInt(r.minutes, 10) || 0)),
    arrived: staffShiftClock_(r.arrived),
    sender: str_(sit && sit.sender) || sender,
    // WHAT BACKS A "NOT LOGGED IN": a PsiAnywhere check that found no punch, or — when the clock could not be read…
    login_state: r.checked === false
      ? 'we could not check PsiAnywhere, so this is a reminder'
      : 'you have not logged in to PsiAnywhere yet',
    status: handoff ? (staffShiftAscii_(r.why) || 'it did not go through') : staffShiftNoShowStatus_(r),
    shifts: staffShiftNoteShifts_(r),
    approval: staffShiftAscii_(r.approval_why),
    training: staffShiftAscii_(r.training),
    reply: staffShiftAscii_(r.reply),
    ref: str_(r.ref) || str_(r.handoff_id),
    // THE HANDOFF'S OWN THREE.
    other: staffShiftHandoffOther_(r),
    shift: str_(r.value) || str_(r.shift_code),
    handoff: str_(r.handoff_id),
    // HOW MANY PEOPLE PUT THEIR NAME DOWN.
    applicants: String(Math.max(0, parseInt(r.applicants, 10) || 0)),
    // WHO IS BEING WRITTEN TO, which on this lane is not who the row is ABOUT.
    to_name: str_(r.to_name),
    to_first_name: str_(r.to_name).split(/\s+/)[0] || 'there',
    requester: str_(r.requester),
    dates: staffShiftAscii_(r.dates),
    days: str_(r.days),
    houses: Array.isArray(r.houses) ? r.houses.join(', ') : str_(r.houses),
    link: str_(r.link_path)
      ? ((typeof mailPlatformUrl_ === 'function') ? mailPlatformUrl_() : '') + str_(r.link_path) : '',
    by: str_(r.by),
    words: staffShiftAscii_(r.words),
    drafts: staffShiftAscii_(r.drafts),
    reason_line: staffShiftAscii_(r.reason_line),
    // THE PUNCH PAIR'S FACTS (server/punch_pairs.py door_row).
    staff: str_(r.staff),
    ends: staffShiftTime_(r.shift_end),
    next_shift: str_(r.next_shift),
    next_house: str_(r.next_house),
    next_time: staffShiftTime_(r.next_at),
    punched_in: staffShiftClock_(r.punched_in),
    tells: str_(r.tells),
    // A DIRECTOR'S RECEIVED, acknowledged: the call off it opened, and the one reason the relay gives for what it…
    call_off_ref: str_(r.call_off_ref),
    why: staffShiftAscii_(r.why)
  };
}

/** {other}: the giver hears the receiver's name; everyone else hears the giver's. */
function staffShiftHandoffOther_(r) {
  var kind = str_(r.kind);
  if (kind === 'handoff_done' || kind === 'handoff_declined') return str_(r.to_staff);
  if (kind.indexOf('handoff_') === 0) return str_(r.from_staff);
  return '';
}

/** A relay sentence folded to ASCII so the SMS stays GSM-7. */
function staffShiftAscii_(v) {
  var s = str_(v);
  if (!s) return '';
  s = s.replace(STAFF_SHIFT_DASHES, '-').replace(STAFF_SHIFT_SINGLE_QUOTES, '\'')
       .replace(STAFF_SHIFT_DOUBLE_QUOTES, '"').replace(STAFF_SHIFT_ELLIPSIS, '...')
       .replace(STAFF_SHIFT_WIDE_SPACES, ' ');
  try { s = s.normalize('NFD').replace(STAFF_SHIFT_ACCENTS, ''); } catch (e) { /* the folds above stand */ }
  return s;
}
/* code points keep the source ASCII */
var STAFF_SHIFT_DASHES = new RegExp('[' + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212) + ']', 'g');
var STAFF_SHIFT_SINGLE_QUOTES = new RegExp('[' + String.fromCharCode(0x2018, 0x2019, 0x201b) + ']', 'g');
var STAFF_SHIFT_DOUBLE_QUOTES = new RegExp('[' + String.fromCharCode(0x201c, 0x201d, 0x201f) + ']', 'g');
var STAFF_SHIFT_ELLIPSIS = new RegExp(String.fromCharCode(0x2026), 'g');
var STAFF_SHIFT_WIDE_SPACES = new RegExp('[' + String.fromCharCode(0x00a0, 0x2007, 0x202f) + ']', 'g');
var STAFF_SHIFT_ACCENTS = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');

// The kinds whose words also go by e-mail.
function staffShiftMails_(kind, r) {
  if (r && r.mail === true) return true;
  if (r && r.mail === false) return false;
  var k = str_(kind);
  return k.indexOf('handoff_') === 0 || k.indexOf('timeoff_') === 0 || k.indexOf('punch_') === 0;
}

// A handoff row with `person` set to the half of the pair this kind speaks to.
function staffShiftHandoffPerson_(r, which) {
  var copy = {};
  for (var k in r) copy[k] = r[k];
  copy.person = str_(r[which]);
  copy.person_key = clientNameKey_(copy.person);
  return copy;
}

/** A transfer's or a time off's e-mail beside the text; only the text's answer decides what the relay records. */
function staffShiftMail_(r, sit, vars, dial, person, res, people) {
  if (!staffShiftMails_(r.kind, r)) return;
  var ownSid = STAFF_SHIFT_MAIL_SITUATIONS[str_(r.kind)];
  if (ownSid) {
    var own = (typeof smartSituationOn_ === 'function') ? smartSituationOn_(ownSid) : null;
    if (!own) { res.email = 'held'; res.email_why = 'the situation ' + ownSid + ' is off or absent'; return; }
    sit = own;
    /* its own sender too; a copy, since the text is rendered from `vars` after this */
    if (str_(own.sender)) {
      var copy = {};
      for (var vk in vars) copy[vk] = vars[vk];
      copy.sender = str_(own.sender);
      vars = copy;
    }
  }
  var channels = (typeof smartList_ === 'function') ? smartList_(sit.channels) : [];
  if (channels.indexOf('email') === -1 || !str_(sit.email_text)) return;
  if (!people || !people.readable) { res.email = 'failed'; res.email_why = 'the People house could not be read'; return; }
  var p = people.byKey[clientNameKey_(person)];
  var to = p ? str_(p.email) : '';
  if (!to) { res.email = 'no_address'; return; }
  var subject = smartRender_(str_(sit.email_subject), vars);
  var body = smartRender_(str_(sit.email_text), vars);
  var reason = 'smart comms: ' + str_(sit.id) + ' (shift flow, e-mail)';
  if (dial !== 'send' || r.rehearsal_only === true) {
    try {
      hubRehearsalHeld_({ situation: str_(sit.id), intent_key: 'SHIFT_MAIL|' + res.id,
        person_key: clientNameKey_(person), person_name: person, purpose: 'shift', verdict: 'recorded',
        pass_by: STAFF_SHIFT_PASS_BY, reasons: 'the sending dial stands at `' + dial + '`', channel: 'email',
        to: to, subject: subject, body: body, sender_used: vars.sender, reason: reason });
    } catch (eH) { /* the text's row stands */ }
    res.email = 'recorded';
    return;
  }
  var heldMock = (typeof COMM_MOCK_CTX !== 'undefined') ? COMM_MOCK_CTX : null;
  var mail = null;
  try {
    COMM_MOCK_CTX = { situation: str_(sit.id), person_name: person, ledger_key: 'SHIFT_MAIL|' + res.id,
                      purpose: 'shift e-mail' };
    mail = rpcCall_('emailSend', { to: to, subject: subject, body: body, reason: reason },
      { idempotency_key: 'shift_mail_' + String(res.id).replace(/[^A-Za-z0-9_|:\-]/g, '').slice(0, 200) });
  } finally { COMM_MOCK_CTX = heldMock; }
  res.email = (mail && mail.sent) ? (mail.redirected ? 'redirected' : 'told')
    : (mail && (mail.rehearsed || mail.recorded_to)) ? 'recorded'
    : (mail && mail.quiet) ? 'refused_quiet'
    : (mail && mail.deduplicated) ? 'duplicate'
    : (mail && mail.gated) ? 'held' : 'failed';
}

HUB_POLICY.staffShiftReminder = {
  file: 'StaffAlerts.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [],
  emits: ['smsSend', 'emailSend']
};
HUB_ACTIONS.staffShiftReminder = function (payload, user) {
  // The relay's service identity, or an admin pressing it by hand. Nobody else.
  if (user && !user.is_service && String(user.role) !== 'admin') return hubDenied_();
  var data = payload || {};
  var rows = Array.isArray(data.rows) ? data.rows.slice(0, STAFF_SHIFT_MAX_ROWS) : [];
  var out = { results: [], counts: {} };
  if (!rows.length) return { status: 200, data: out };
  var now = new Date();
  var quiet = staffShiftQuiet_(now);
  var people = null;
  var managers = {};
  var sender = (typeof SMART_SENDER_DEFAULT !== 'undefined') ? SMART_SENDER_DEFAULT : 'ASA LifeCare';
  // THE SENDING DIAL, READ ONCE FOR THE WHOLE EXECUTION — one post is never half held and half sent.
  var dialState = (typeof commDialState_ === 'function') ? commDialState_()
    : { word: (typeof commSendDialWord_ === 'function') ? commSendDialWord_(null) : 'off', readable: true };
  var dial = String(dialState.word || 'off');
  out.dial = dialState.readable ? dial : 'unknown';
  // TEST MODE, FROM THE SAME READ AS THE DIAL (CommIntent.gs commDialRead_: on reads `record`, off reads `send`)…
  out.test_mode = !dialState.readable ? '' : dial === 'send' ? 'off' : dial === 'record' ? 'on' : '';

  rows.forEach(function (raw) {
    var r = raw || {};
    var res = { id: str_(r.id), state: '', why: '', phone_key: '' };
    var answer = function (state, why) {
      res.state = state;
      res.why = why || '';
      out.counts[state] = (out.counts[state] || 0) + 1;
      out.results.push(res);
    };
    var kind = str_(r.kind);
    try { if (typeof supportDeskShiftRow_ === 'function') supportDeskShiftRow_(kind, r); } catch (eSd) {}
    var sid = STAFF_SHIFT_SITUATIONS[kind] || '';
    if (!res.id || !sid) return answer('refused', 'not a row this door knows');
    if (quiet) {
      return answer('refused_quiet', 'inside the quiet window (' + STAFF_SHIFT_QUIET_FROM + '–' +
                    STAFF_SHIFT_QUIET_TO + ' New York): nothing is said, and the relay re-plans at ' +
                    STAFF_SHIFT_QUIET_TO);
    }
    // THE DIAL COULD NOT BE READ: nothing at all, and nothing closed — the relay offers the row again when the dial…
    if (!dialState.readable) {
      return answer('dial_unknown', 'the sending dial could not be read: nothing is said or written, and ' +
                    'the relay asks again');
    }
    // THE DIAL AT `off`: nothing at all — no read, no row, no send.
    if (dial !== 'send' && dial !== 'record') {
      return answer('dial_off', 'the sending dial stands at `' + dial + '`: nothing is said or written');
    }
    // THE SITUATION'S OWN HOLDS carry a `code`, so a lane can tell a switch that is off from the send door holding…
    var sit = (typeof smartSituationOn_ === 'function') ? smartSituationOn_(sid) : null;
    var sitRead = (!sit && typeof hubSituationRead_ === 'function') ? hubSituationRead_(sid) : null;
    if (sitRead && sitRead.unreadable) {
      res.code = 'situation_unread';
      return answer('held', sitRead.unreadable + ': whether ' + sid + ' is on cannot be told, so ' +
                    'nothing is said, and the relay offers it again');
    }
    // THE TWO READS DISAGREE: the first swallowed a failure and the second found the row on.
    if (!sit && sitRead && sitRead.on) {
      res.code = 'situation_unread';
      return answer('held', 'the situations tab could not be read the first time and read ' + sid +
                    ' as on the second: whether it is on cannot be told, so nothing is said, and the ' +
                    'relay offers it again');
    }
    if (!sit) {
      res.code = 'situation_off';
      return answer('held', 'the situation ' + sid + ' is off or absent');
    }
    var channels = (typeof smartList_ === 'function') ? smartList_(sit.channels) : [];
    if (channels.indexOf('sms') === -1 || !str_(sit.sms_text)) {
      res.code = 'no_words';
      return answer('held', 'the situation ' + sid + ' names no SMS words');
    }
    // A HANDOFF ROW CARRIES A PAIR, NOT A PERSON.
    var handoffTo = STAFF_SHIFT_HANDOFF_TO[kind];
    if (handoffTo) r = staffShiftHandoffPerson_(r, handoffTo);
    var person = str_(r.person);
    var key = clientNameKey_(person) || str_(r.person_key);
    var to = '';
    // WHO IT GOES TO, IN WORDS — for the mock outbox, whose person column says who a message is ABOUT; for a house…
    var toName = '';
    if (STAFF_SHIFT_TO_MANAGER[kind]) {
      /* the relay's house manager first; the calendar only when the row names nobody */
      var found = null;
      if (str_(r.house_manager)) {
        var hmPhone = str_(r.manager_phone);
        if (!hmPhone) {
          if (!people) people = staffShiftPeople_();
          if (!people.readable) return answer('failed', 'the People house could not be read');
          var hmRow = people.byKey[clientNameKey_(r.house_manager)];
          hmPhone = hmRow ? str_(hmRow.phone) : '';
        }
        found = { hm: { name: str_(r.house_manager), phone: hmPhone }, readable: true };
      } else {
        found = staffShiftHouseManager_(str_(r.house) || str_(r.location), managers);
      }
      // "NOBODY THERE" IS FINAL, "COULD NOT LOOK" IS NOT: an unreadable calendar answers `failed`, which the relay…
      if (!found.hm && !found.readable) {
        return answer('failed', 'the hotline calendar could not be read');
      }
      to = found.hm ? packetTeamCopyNumber_(found.hm.phone) : '';
      if (!to) return answer('no_manager', 'the hotline calendar names no manager with a number for "' +
                             (str_(r.house) || str_(r.location)) + '"');
      toName = 'the house manager' + (str_(found.hm.name) ? ' ' + str_(found.hm.name) : '');
    } else if (STAFF_SHIFT_TO_DIRECTORS[kind]) {
      /* asked above the manager: the situation's `to`, as commCallOffTellDirectors_ */
      var aud = (typeof commCallOffAudienceFrom_ === 'function') ? commCallOffAudienceFrom_(sit, {})
        : { readable: false, why: ['the directors audience cannot be resolved here'], entries: [] };
      if (!aud.readable) {
        return answer('failed', (aud.why || []).join(' · ') || 'the directors could not be resolved');
      }
      (aud.entries || []).some(function (e) {
        var dest = str_(e && e.to);
        var digits = dest.indexOf('@') === -1 ? dest.replace(/\D/g, '').slice(-10) : '';
        if (digits.length === 10) to = '+1' + digits;
        return !!to;
      });
      if (!to) return answer('no_manager', 'the directors audience resolved to no number this platform may text');
      toName = 'the directors (5558 group)';
    } else {
      if (!people) people = staffShiftPeople_();
      if (!people.readable) return answer('failed', 'the People house could not be read');
      var p = people.byKey[key];
      // A NAME THE PEOPLE HOUSE DOES NOT SPELL is a lookup miss, not "this person has no number": the same…
      if (!p) {
        res.code = 'no_person';
        return answer('no_contact', 'nobody by that name in the People house');
      }
      if (!p.onStaff) return answer('not_staff', 'the People house does not mark them on staff');
      to = packetSendableNumber_(p.phone);
      if (!to) return answer('no_contact', 'no number we may text');
      res.phone_key = staffShiftPhoneKey_(to);
      toName = str_(p.name) || person;
    }
    var vars = staffShiftVars_(r, sit, sender);
    // AND THE RECIPIENT'S OWN NAME, now that it is known.
    var plainTo = STAFF_SHIFT_TO_MANAGER[kind]
      ? str_(r.to_name) || (found && found.hm ? str_(found.hm.name) : '')
      : STAFF_SHIFT_TO_DIRECTORS[kind] ? '' : toName;
    vars.to_name = plainTo;
    vars.to_first_name = plainTo.split(/\s+/)[0] || 'there';
    /* the same message by e-mail; the directors' group has no mailbox */
    if (!STAFF_SHIFT_TO_DIRECTORS[kind]) {
      if (!people && staffShiftMails_(r.kind, r)) people = staffShiftPeople_();
      try {
        staffShiftMail_(r, sit, vars, dial, STAFF_SHIFT_TO_MANAGER[kind] ? (str_(r.house_manager) || person) : person,
                        res, people);
      } catch (eMl) { res.email = 'failed'; }
    }
    var body = smartRender_(str_(sit.sms_text), vars);
    var reason = 'smart comms: ' + sid + ' (shift flow, ' + kind + ')';
    var rehearsalOnly = r.rehearsal_only === true;
    if (dial !== 'send' || rehearsalOnly) {
      // THE DIAL AT `record`: resolved, rendered and WRITTEN DOWN — the row a person reads before moving the dial…
      var noted = '';
      var why = rehearsalOnly
        ? 'the person\'s asks went only into the rehearsal book, so this is written there and ' +
          'NOBODY WAS CONTACTED - no manager is told about somebody no ask reached'
        : (typeof commDialHeldWhy_ === 'function')
          ? commDialHeldWhy_(dial, 1, STAFF_SHIFT_TO_MANAGER[kind] ? 'the house manager of this shift'
                                      : STAFF_SHIFT_TO_DIRECTORS[kind] ? 'the directors (5558 group)'
                                      : 'the staff member of this shift')
          : 'the sending dial stands at `' + dial + '`, not `send`';
      // AND THE SAME ROW IN THE MOCK OUTBOX (Rpc.gs hubRehearsalHeld_ writes both): who it would have gone to, the…
      try {
        noted = (typeof hubRehearsalHeld_ === 'function') ? hubRehearsalHeld_({
          situation: sid, intent_key: 'SHIFT|' + res.id, person_key: key, person_name: person,
          purpose: 'shift', verdict: 'recorded', pass_by: STAFF_SHIFT_PASS_BY, reasons: why,
          channel: 'sms', to: to, body: body, sender_used: vars.sender, reason: reason,
          to_name: toName,
          held_by: rehearsalOnly ? 'rehearsal only — the asks before it reached nobody' : ''
        }) : '';
      } catch (eN) { noted = ''; }
      return answer('recorded', (rehearsalOnly ? 'rehearsal only (the asks reached nobody)'
                                               : 'the sending dial stands at `' + dial + '`') +
                    ': nobody was contacted' +
                    (noted ? ' — the message is in the rehearsal book' : ' — and the rehearsal row could ' +
                     'not be written'));
    }
    // THE REHEARSAL BOOK KNOWS WHOSE ROW THIS IS when test mode turns the send into a row there: the shift flow's…
    var heldCtx = (typeof HUB_REHEARSAL_CTX !== 'undefined') ? HUB_REHEARSAL_CTX : null;
    // AND THE MOCK OUTBOX KNOWS THE SAME: the row the door writes names the person, who it went to, the situation…
    var heldMock = (typeof COMM_MOCK_CTX !== 'undefined') ? COMM_MOCK_CTX : null;
    var sms = null;
    try {
      HUB_REHEARSAL_CTX = { pass_by: STAFF_SHIFT_PASS_BY, situation: sid, intent_key: 'SHIFT|' + res.id,
                            person_key: key, person_name: person, purpose: 'shift',
                            sender_used: vars.sender };
      COMM_MOCK_CTX = { situation: sid, person_name: person, ledger_key: 'SHIFT|' + res.id,
                        purpose: 'shift · to ' + toName };
      sms = rpcCall_('smsSend', {
        to: to, body: body, reason: reason
      }, { idempotency_key: 'shift_rem_' + String(res.id).replace(/[^A-Za-z0-9_|:\-]/g, '').slice(0, 200) });
    } finally {
      HUB_REHEARSAL_CTX = heldCtx;
      COMM_MOCK_CTX = heldMock;
    }
    // THE QUIET WINDOW AT THE SEND DOOR IS "NOT NOW", and the relay must hear it as that: `refused_quiet` is never…
    if (sms && sms.quiet) {
      return answer('refused_quiet', 'the send door\'s quiet window (' +
                    ((typeof hubQuietWords_ === 'function') ? hubQuietWords_()
                                                            : STAFF_SHIFT_QUIET_FROM + '–' + STAFF_SHIFT_QUIET_TO) +
                    '): nothing is said, and the relay re-plans at ' + STAFF_SHIFT_QUIET_TO);
    }
    if (sms && sms.sent) {
      if (!sms.redirected && typeof smartRecord_ === 'function') {
        try { smartRecord_(res.id, sid, person, str_(r.day), 'sms'); } catch (eR) { /* said in the log */ }
      }
      return answer(sms.redirected ? 'redirected' : 'told', '');
    }
    if (sms && sms.rehearsed) return answer('rehearsed', str_(sms.detail));
    if (sms && sms.recorded_to) return answer('recorded', 'written into ' + str_(sms.recorded_to));
    if (sms && sms.deduplicated) return answer('duplicate', 'this exact message already went');
    if (sms && sms.reason === 'opted_out') return answer('opted_out', str_(sms.detail));
    if (sms && sms.gated) return answer('held', str_(sms.reason) || 'the send door held it');
    return answer('failed', str_((sms && (sms.detail || sms.error)) || 'the send door gave no answer'));
  });

  try {
    hubSysLog_('asa-hub:staffalerts', 'shift_reminder',
               rows.length + ' row(s): ' + JSON.stringify(out.counts), { status: 200 });
  } catch (eLg) { /* the answer is the relay's copy */ }
  return { status: 200, data: out };
};

HUB_POLICY.staffAttendanceSweep = {
  file: 'StaffAlerts.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: [],
  invalidates: [],
  // it answers a mailbox: rpcCall_('emailSend') in its own body, and the Smart Comms lane it hands situations to…
  emits: ['emailSend', 'smsSend', 'teamAlert']
};
HUB_ACTIONS.staffAttendanceSweep = function (payload, user) {
  // The relay's service identity, or an admin pressing it by hand. Nobody else.
  if (!user) return hubDenied_();
  if (!user.is_service && String(user.role) !== 'admin') return hubDenied_();

  // SIMULATION.
  if (payload && payload.simulate) {
    var recorded = readTabNormalized_(hubTabWorkbook_(STAFF_ALERTS_TAB), STAFF_ALERTS_TAB)
      .filter(function (r) { return str_(r.kind) && str_(r.person); })
      .slice(-2);
    if (!recorded.length) {
      recorded = [{ kind: 'late_show', person: 'Jeremiah Inman', wheniso: '2026-08-15T04:00:00.000Z' }];
    }
    var simTo = staffAlertRecipients_();
    var simSent = [], simShifts = [];
    recorded.forEach(function (r) {
      var kind = str_(r.kind) === 'no_call' ? 'no_call' : 'late_show';
      var person = str_(r.person);
      var whenIso = str_(r.wheniso);
      var dayIso = staffAlertDay_(whenIso);
      var shiftText = staffShiftText_(person, dayIso);
      var arrivedText = kind === 'late_show' ? staffArrivalText_(person, dayIso) : '';
      simShifts.push(person + ': ' + (shiftText || 'no roster row') +
                     (arrivedText ? ' / arrived ' + arrivedText : ''));
      var letter = staffAlertEmail_({
        kind: kind, person: person, whenText: staffAlertWhen_(whenIso),
        shiftText: shiftText, arrivedText: arrivedText,
        reportWords: staffAlertQuoteText_(
          (kind === 'no_call' ? 'No Show No Call' : 'Late Show') +
          ' \u2014 ' + person + ' (' + whenIso + ')')
      });
      for (var i = 0; i < simTo.length; i++) {
        var out = rpcCall_('emailSend', {
          to: simTo[i], subject: '[SIMULATION] ' + letter.subject,
          body: letter.text, html: letter.html,
          reason: 'attendance letter simulation'
        });
        if (out && out.sent) simSent.push(simTo[i]);
      }
    });
    return { status: 200, data: { simulated: recorded.length, sent: simSent.length,
                                  looked_up: simShifts } };
  }

  // ONE PASS AT A TIME, AND NOBODY WAITS IN THE DOORWAY.
  var staffClaim = null;
  try { staffClaim = CacheService.getScriptCache(); } catch (eCc) { staffClaim = null; }
  var staffMine = false;
  var staffLock = null;
  try { staffLock = LockService.getScriptLock(); } catch (eLk) { staffLock = null; }
  if (staffLock && staffLock.tryLock(2000)) {
    try {
      var staffRunning = null;
      try { staffRunning = staffClaim && staffClaim.get(STAFF_SWEEP_CLAIM_KEY); }
      catch (eCg) { staffRunning = null; }
      if (!staffRunning) {
        staffMine = true;
        try { if (staffClaim) staffClaim.put(STAFF_SWEEP_CLAIM_KEY, String(new Date().getTime()),
                                             STAFF_SWEEP_CLAIM_S); } catch (eCp) { /* the pass still runs */ }
      }
    } finally {
      try { staffLock.releaseLock(); } catch (eRl0) { /* gone with the execution */ }
    }
  } else if (!staffLock) {
    // No lock service at all is not a reason to stop doing the work — it is the state this sweep ran in for weeks…
    staffMine = true;
  }
  if (!staffMine) {
    try {
      hubSysLog_('asa-hub:staff', 'staff_sweep_skipped',
                 'another attendance pass is inside its window; the next tick does this inbox',
                 { status: 200 });
    } catch (eSk) { /* the skip stands either way */ }
    return { status: 200, data: { ran: false, skipped: true,
                                  why: 'another attendance pass is running' } };
  }
  try {
  var inbox = platformMailPost_('/mail/inbox', { limit: 50 });
  if (!inbox || inbox.status !== 200) {
    return { status: 502, message: 'The mailbox did not answer: ' + String(inbox && inbox.message).slice(0, 120) };
  }
  var threads = (inbox.data && inbox.data.threads) || [];

  // What has already been handled — the tab is the memory, not this process.
  var sheet = staffAlertsSheet_();
  var seen = {};
  readTabNormalized_(hubTabWorkbook_(STAFF_ALERTS_TAB), STAFF_ALERTS_TAB).forEach(function (r) {
    if (str_(r.messageid)) seen[str_(r.messageid)] = true;
  });

  // What the model has already been asked — one message, one call, ever.
  var aiSheet = null;
  var aiSeen = {};
  // AND WHAT THE READER READ, not only its verdict.
  var aiWas = {};
  if (hubTabSheet_(STAFF_AI_TAB)) {
    readTabNormalized_(hubTabWorkbook_(STAFF_AI_TAB), STAFF_AI_TAB).forEach(function (r) {
      if (!str_(r.messageid)) return;
      aiSeen[str_(r.messageid)] = str_(r.verdict);
      aiWas[str_(r.messageid)] = { label: str_(r.label), person: str_(r.person),
                                   whenIso: str_(r.wheniso) };
    });
  }

  // WHAT THE OTHER TWO DOORS HAVE ALREADY SAID — read ONCE, before the loop.
  var toldElsewhere = {};
  if (typeof smartAlreadySent_ === 'function') {
    try { toldElsewhere = smartAlreadySent_(); }
    catch (eLed) {
      toldElsewhere = null;
      try {
        hubSysLog_('asa-hub:staff', 'staff_ledger_unreadable',
                   'the Smart Comms ledger could not be read (' +
                   String((eLed && eLed.message) || eLed).slice(0, 120) +
                   '); this pass sends without it rather than holding the reports',
                   { status: 500 });
      } catch (eLl) { /* the pass still runs */ }
    }
  }

  var alerted = 0, filedOnly = 0, toFile = {};   // folder name → items
  // Held reports — counted so a pass that handled nothing can still say that something is waiting on a person.
  var heldNoReader = 0, heldRefused = 0;
  // Reports another door had already told, reports the platform deliberately did not send — the category switched…
  var alreadyTold = 0, categoryOff = 0, gatedNotSent = 0, sendFailed = 0;
  // And reports the send door's quiet window held: left in the inbox, like a failed send but without the alarm, and…
  var heldQuiet = 0;
  // And reports whose situation could not be read: left in the inbox, nothing sent.
  var switchUnreadable = 0;
  // The summary line's Late Show list is resolved AFTER the loop, and only on a pass that actually sent something…
  var now = Date.now();

  for (var i = 0; i < threads.length; i++) {
    var t = threads[i];
    var mid = str_(t.id);
    if (!mid || seen[mid]) continue;
    var parsed = staffAlertParse_(t.subject);
    if (!parsed) {
      // The pattern could not read it: the model gets ONE look, remembered.
      var ai = null;
      if (aiSeen[mid] !== undefined) {
        // A verdict already stands.
        if (aiSeen[mid] === 'gate-refused') { seen[mid] = true; heldRefused++; continue; }
        if (!aiSeen[mid] || aiSeen[mid] === 'none') continue;
        var was = aiWas[mid] || {};
        if (!str_(was.person) || !Date.parse(str_(was.whenIso))) {
          // A remembered category with no person or no date left to rebuild is an attendance report nobody can act…
          seen[mid] = true;
          heldRefused++;
          continue;
        }
        ai = { kind: aiSeen[mid], label: str_(was.label),
               person: str_(was.person), whenIso: str_(was.whenIso) };
      } else {
        ai = staffAlertClassifyAi_(t.subject, t.snippet);
        if (!ai) {
          // HELD, NOT HANDED ON.
          seen[mid] = true;
          try {
            hubSysLog_('asa-hub:staff', 'staff_ai_refused',
                       mid + ' — no reader answered; held, and every sweep asks again',
                       { status: 200 });
          } catch (eRf) { /* the hold stands */ }
          heldNoReader++;
          continue;
        }
        if (!aiSheet) aiSheet = staffAiSheet_();   // the handle, built where it is used
        if (ai.refused) {
          // THE READER ANSWERED AND THE GATE SAID NO — a name the message never wrote, or a date that is not a date.
          aiSheet.appendRow([mid, 'gate-refused', '', '', '', str_(ai.via), new Date().toISOString()]);
          aiSeen[mid] = 'gate-refused';
          seen[mid] = true;
          heldRefused++;
          try {
            hubSysLog_('asa-hub:staff', 'staff_ai_refused',
                       mid + ' — the reader\'s answer failed the gate (' + str_(ai.why) +
                       '); held for a person, and the model is not asked again',
                       { status: 200 });
          } catch (eRg) { /* the hold stands */ }
          continue;
        }
        aiSheet.appendRow([mid, ai.none ? 'none' : ai.kind, str_(ai.label), str_(ai.person),
                           str_(ai.whenIso), str_(ai.via), new Date().toISOString()]);
        aiSeen[mid] = ai.none ? 'none' : ai.kind;
        // What the reader read, kept beside the verdict: a report whose legs fail this pass is rebuilt from it on…
        aiWas[mid] = { label: str_(ai.label), person: str_(ai.person), whenIso: str_(ai.whenIso) };
        if (ai.none) continue;
      }
      parsed = { kind: ai.kind, label: ai.label, person: ai.person, whenIso: ai.whenIso };
      // The canonical family keeps its folders whatever the model called it.
      if (parsed.kind === 'late_show') parsed.label = 'Late Show';
      if (parsed.kind === 'no_call') parsed.label = 'No Show No Call';
      if (parsed.kind === 'call_off') parsed.label = 'Call Off';
      if (parsed.kind === 'early_out') parsed.label = 'Early Out';
    }

    var whenText = staffAlertWhen_(parsed.whenIso);
    // RETRO GUARD on the message's ARRIVAL, not the shift date: a report received two days ago was somebody else's…
    var arrived = Date.parse(str_(t.date)) || now;
    var fresh = (now - arrived) < 48 * 3600 * 1000;

    // THE DAY THE ABSENCE IS ABOUT — the day the shift was, never the day the report arrived — and the key the…
    var dayIso = staffAlertDay_(parsed.whenIso);
    var ledgerSid = staffAlertLedgerSid_(parsed.kind);
    var ledgerKey = (ledgerSid && dayIso)
      ? staffAlertLedgerKey_(ledgerSid, parsed.person, dayIso) : '';
    try { if (fresh && ledgerKey && typeof supportDeskAttendanceMail_ === 'function') supportDeskAttendanceMail_(parsed, ledgerKey, dayIso); } catch (eSd) {}
    // ALREADY SAID, BY A DOOR THAT IS NOT THIS ONE.
    var heldByLedger = !!(fresh && ledgerKey && toldElsewhere && toldElsewhere[ledgerKey]);
    // AND THE DELIBERATE STOP, ASKED BEFORE THE LEGS RUN — the way the punch door asks it.
    var sitHere = (fresh && !heldByLedger) ? staffAlertSituation_(parsed.kind) : null;

    // A SWITCH NOBODY COULD READ SENDS NOTHING, AND DECIDES NOTHING.
    if (sitHere && sitHere.unreadable) {
      seen[mid] = true;
      switchUnreadable++;
      if (switchUnreadable === 1) {
        try {
          hubSysLog_('asa-hub:staff', 'staff_switch_unreadable',
                     staffAlertStopWhy_(sitHere) + ' — attendance reports stay in the inbox',
                     { status: 503 });
        } catch (eSu) { /* the report waits either way */ }
      }
      continue;
    }

    var sentTo = [];
    // THE WORD FOR A SILENCE SOMEBODY CHOSE.
    var gatedWord = '';
    if (heldByLedger) {
      alreadyTold++;
    } else if (sitHere && staffAlertStopWhy_(sitHere)) {
      /* absent or switched off: a row that is not ON sends nothing */
      categoryOff++;
      gatedWord = 'held-category-off';
    } else if (fresh) {
      // The shift and the arrival, looked up ONLY for a letter that will be sent — a filed-only pass must not spend…
      var shiftHere = staffShiftText_(parsed.person, dayIso);
      var mailVars = { person: parsed.person, when: whenText, name: parsed.person,
                       first_name: String(parsed.person).split(/\s+/)[0], shift: shiftHere };
      var letter = staffAlertLetter_(sitHere, {
        kind: parsed.kind, kindLabel: parsed.label,
        folderName: staffAlertFolder_(parsed.kind, parsed.label),
        person: parsed.person, whenText: whenText,
        shiftText: shiftHere,
        arrivedText: parsed.kind === 'late_show' ? staffArrivalText_(parsed.person, dayIso) : '',
        reportWords: staffAlertQuoteText_(str_(t.snippet)).slice(0, 300)
      }, mailVars);
      // WHAT THE LEGS ANSWERED, NOT WHETHER THE LIST ENDED UP EMPTY.
      var gatedAny = false, recordedAny = false;
      // AND THE ONE HOLD THAT ENDS BY ITSELF.
      var quietAny = false;
      // PER CATEGORY, because the two situations are two rows: Late Show and No Show No Call can now be sent to…
      var toHere = staffAlertRecipients_(parsed.kind, sitHere);
      var named = toHere.length;
      // less a director or the master who turned this alert off; everyone else on the row is told as before
      toHere = staffAlertReceivers_(parsed.kind, toHere);
      for (var r = 0; r < toHere.length; r++) {
        var out = rpcCall_('emailSend', {
          to: toHere[r], subject: letter.subject, body: letter.text,
          html: letter.html, reason: 'staff attendance: ' + parsed.kind + ' — ' + parsed.person
        });
        // a redirected send reached a tester, not this address: recorded as such, so switching test mode off does…
        if (out && out.sent) sentTo.push(out.redirected ? ('[test→testers for ' + toHere[r] + ']') : toHere[r]);
        else if (out && out.recorded_to) recordedAny = true;
        else if (out && out.quiet) quietAny = true;
        else if (out && out.gated) gatedAny = true;
      }
      // AND THE TEXT LEG, to the numbers on the same row and to the two people who can do something about it…
      var plan = staffAlertSmsPlan_(parsed.kind, mailVars, sitHere);
      if (!named && !plan) {
        // ON, AND NAMING NOBODY: nothing can be sent, and that is the row's answer rather than a transport fault…
        staffAlertNobodySay_(sitHere);
        categoryOff++;
        gatedWord = 'held-names-nobody';
      }
      if (plan) {
        var texted = {};
        staffAlertEscalation_(parsed.person, dayIso).forEach(function (n) { plan.numbers.push(n); });
        plan.numbers = staffAlertReceivers_(parsed.kind, plan.numbers);
        for (var n = 0; n < plan.numbers.length; n++) {
          var digits = String(plan.numbers[n]).replace(/\D/g, '').slice(-10);
          if (!digits || texted[digits]) continue;      // one telling per handset
          texted[digits] = true;
          var num = (typeof packetTeamCopyNumber_ === 'function')
            ? packetTeamCopyNumber_(plan.numbers[n]) : '';
          if (!num) continue;
          var sms = rpcCall_('smsSend', {
            to: num, body: plan.body,
            reason: 'staff attendance: ' + parsed.kind + ' — ' + parsed.person
          });
          if (sms && sms.sent) {
            sentTo.push(sms.redirected ? ('[test→testers for ' + num + ']') : num);
          } else if (sms && sms.recorded_to) recordedAny = true;
          else if (sms && sms.quiet) quietAny = true;
          else if (sms && sms.gated) gatedAny = true;
        }
      }
      if (!gatedWord && !toHere.length && !(plan && plan.numbers.length)) {
        // EVERY RECIPIENT LEFT TURNED THIS ALERT OFF in Settings: a decision, filed under its own word and never…
        gatedWord = 'held-receivers-off';
      }
      if (sentTo.length) alerted++;
      else if (quietAny && !recordedAny) {
        // HELD BY THE NIGHT, AND OWED IN THE MORNING: counted, and left below for the next sweep rather than filed…
        heldQuiet++;
      } else if (recordedAny || gatedAny) {
        // NOBODY WAS TOLD, AND THAT WAS THE ANSWER THE PLATFORM GAVE.
        gatedNotSent++;
        gatedWord = recordedAny ? 'recorded-not-sent' : 'gated-not-sent';
      }
      // AND THE OTHER DOORS ARE TOLD.
      var realSent = sentTo.filter(function (x) {
        return String(x).indexOf('[test→testers') !== 0;
      }).length;
      if (ledgerKey && realSent) {
        if (typeof smartRecord_ === 'function') {
          try { smartRecord_(ledgerKey, ledgerSid, parsed.person, dayIso, 'mailbox'); }
          catch (eRec) { /* smartRecord_ says a lost row in the log itself */ }
        }
        // AND THIS PASS'S OWN COPY OF THE LEDGER LEARNS IT AT ONCE.
        if (!toldElsewhere) toldElsewhere = {};
        toldElsewhere[ledgerKey] = true;
      }
    } else {
      filedOnly++;
    }

    // NOTHING LEFT, AND NOBODY CHOSE THAT.
    if (fresh && !heldByLedger && !gatedWord && !sentTo.length && heldQuiet && quietAny) {
      seen[mid] = true;
      continue;
    }
    if (fresh && !heldByLedger && !gatedWord && !sentTo.length) {
      seen[mid] = true;
      sendFailed++;
      try {
        hubSysLog_('asa-hub:staff', 'staff_send_failed',
                   mid + ' — ' + parsed.kind + ' for ' + parsed.person +
                   ': every leg refused, so it is neither filed nor remembered; ' +
                   'the next sweep tries again',
                   { status: 500 });
      } catch (eSf) { /* the retry is what matters */ }
      continue;
    }

    // A REPORT WITH NO MESSAGE-ID is remembered by what it is — kind, person, when — never by its inbox position…
    var memKey = (String(mid).indexOf('@') === -1)
      ? [parsed.kind, parsed.person, parsed.whenIso].join('|') : mid;
    var folderName = staffAlertFolder_(parsed.kind, parsed.label);
    if (!toFile[folderName]) toFile[folderName] = [];
    toFile[folderName].push({ id: mid, hint: parsed.person + ' (' + parsed.whenIso + ')' });
    var anyRedirected = sentTo.some(function (x) { return String(x).indexOf('[test→testers') === 0; });
    // 'send-failed' is not a word this column can carry any more: a report nobody was told about writes no row at…
    sheet.appendRow([mid, parsed.kind, parsed.person, parsed.whenIso, whenText,
                     fresh ? (heldByLedger ? 'already-told'
                                           : (gatedWord ||
                                              (anyRedirected ? 'sent-redirected' : 'sent')))
                           : 'skipped-old',
                     sentTo.join(', '), '', new Date().toISOString(), folderName]);
    seen[mid] = true;
    seen[memKey] = true;
  }

  // EVERYTHING ELSE GETS A FOLDER.
  var routesSheet = mailRoutesSheet_();
  var routed = {};
  readTabNormalized_(hubTabWorkbook_(MAIL_ROUTES_TAB), MAIL_ROUTES_TAB).forEach(function (r) {
    if (str_(r.messageid)) routed[str_(r.messageid)] = true;
  });
  var routedNew = 0;
  for (var g = 0; g < threads.length; g++) {
    var tg = threads[g];
    var gid = str_(tg.id);
    if (!gid || seen[gid] || routed[gid]) continue;
    var folder = mailRouteRule_(tg);
    var via = 'rule';
    if (!folder) {
      var verdict = mailRouteAi_(tg);
      if (!verdict) continue;               // no provider / no answer: next sweep retries
      folder = verdict.folder;
      via = verdict.via;
    }
    routesSheet.appendRow([gid, folder, via, '', new Date().toISOString(),
                           mailRouteHint_(tg.subject)]);
    routed[gid] = true;
    routedNew++;
  }

  // FILE the messages into their folders — after the rows, so a filing failure costs tidiness, never the alert or…
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iMid = hdr.indexOf('messageid'), iKind = hdr.indexOf('kind'), iFiled = hdr.indexOf('filed');
  var iPerson = hdr.indexOf('person'), iWhen = hdr.indexOf('wheniso'), iFolder = hdr.indexOf('folder');
  // '' = never attempted; 'not-in-inbox' = one strategy failed once — worth a second look now that the subject-hint…
  var pending = {};   // folder name → { message_id → {row, hint, second} }
  for (var v = 1; v < values.length; v++) {
    var mark = str_(values[v][iFiled]);
    if (!str_(values[v][iMid]) || (mark !== '' && mark !== 'not-in-inbox')) continue;
    // The row remembers its folder; rows from before the column derive the two original kinds and nothing else.
    var fname = iFolder !== -1 ? str_(values[v][iFolder]) : '';
    if (!fname) fname = staffAlertFolder_(str_(values[v][iKind]), '');
    if (!pending[fname]) pending[fname] = {};
    pending[fname][str_(values[v][iMid])] = {
      row: v + 1,
      hint: str_(values[v][iPerson]) + ' (' + str_(values[v][iWhen]) + ')',
      second: mark === 'not-in-inbox'
    };
  }
  var filedTotal = 0;
  for (var fname2 in pending) {
    var ids = Object.keys(pending[fname2]);
    if (!ids.length) continue;
    var items = ids.slice(0, 50).map(function (id) {
      return { id: id, hint: pending[fname2][id].hint };
    });
    var res = platformMailPost_('/mail/file', { items: items, folder: fname2 });
    if (!res || res.status !== 200) continue;
    var movedIds = (res.data && res.data.moved_ids) || [];
    var notFound = (res.data && res.data.not_found) || [];
    filedTotal += movedIds.length;
    movedIds.forEach(function (id) {
      if (pending[fname2][id]) sheet.getRange(pending[fname2][id].row, iFiled + 1).setValue('yes');
    });
    // Two strikes with two search strategies is genuinely gone — 'gone' is final and never retried; one strike…
    notFound.forEach(function (id) {
      var hit = pending[fname2][id];
      if (hit) sheet.getRange(hit.row, iFiled + 1).setValue(hit.second ? 'gone' : 'not-in-inbox');
    });
  }

  // The SAME filed/retry law for the general routes: '' rides every sweep, 'not-in-inbox' rides once more (the…
  var rv = routesSheet.getDataRange().getValues();
  var rHdr = rv[0].map(normKey_);
  var rMid = rHdr.indexOf('messageid'), rFolder = rHdr.indexOf('folder');
  var rFiled = rHdr.indexOf('filed'), rHint = rHdr.indexOf('hint');
  var routePending = {};   // folder → { message_id → {row, hint, second} }
  for (var rw = 1; rw < rv.length; rw++) {
    var rMark = str_(rv[rw][rFiled]);
    if (!str_(rv[rw][rMid]) || (rMark !== '' && rMark !== 'not-in-inbox')) continue;
    var rName = str_(rv[rw][rFolder]) || 'Mail Other';
    if (!routePending[rName]) routePending[rName] = {};
    routePending[rName][str_(rv[rw][rMid])] = {
      row: rw + 1, hint: str_(rv[rw][rHint]), second: rMark === 'not-in-inbox'
    };
  }
  var routeFiled = 0;
  for (var rName2 in routePending) {
    var rIds = Object.keys(routePending[rName2]);
    if (!rIds.length) continue;
    var rItems = rIds.slice(0, 50).map(function (id) {
      return { id: id, hint: routePending[rName2][id].hint };
    });
    var rRes = platformMailPost_('/mail/file', { items: rItems, folder: rName2 });
    if (!rRes || rRes.status !== 200) continue;
    var rMoved = (rRes.data && rRes.data.moved_ids) || [];
    var rMissing = (rRes.data && rRes.data.not_found) || [];
    routeFiled += rMoved.length;
    rMoved.forEach(function (id) {
      if (routePending[rName2][id]) routesSheet.getRange(routePending[rName2][id].row, rFiled + 1).setValue('yes');
    });
    rMissing.forEach(function (id) {
      var rHit = routePending[rName2][id];
      if (rHit) routesSheet.getRange(rHit.row, rFiled + 1).setValue(rHit.second ? 'gone' : 'not-in-inbox');
    });
  }

  // THE SUMMARY'S RECIPIENT LIST, RESOLVED ONLY WHEN THERE WAS A LETTER (the pass that counted what a quiet sweep…
  var recipients = alerted ? staffAlertRecipients_('late_show') : [];

  return { status: 200, data: {
    // `ran` is the twin of the skipped envelope above: a reader that sees matched: 0 here knows the inbox was…
    ran: true,
    matched: alerted + filedOnly, alerted: alerted, filed_only: filedOnly,
    moved: filedTotal, folders: Object.keys(pending),
    routed: routedNew, routed_moved: routeFiled,
    route_folders: Object.keys(routePending),
    // THE REPORTS STILL IN NOBODY'S HANDS, counted every pass.
    held: heldNoReader + heldRefused, held_refused: heldRefused,
    // WHAT WAS NOT SAID, AND WHY IT WAS NOT — four silences, and only one of them is a fault.
    already_told: alreadyTold, category_off: categoryOff,
    gated_not_sent: gatedNotSent, send_failed: sendFailed,
    // `held_quiet` is the fifth, and not a fault either: the send door's quiet window said "not now", the report…
    held_quiet: heldQuiet,
    // reports whose situation could not be read: in the inbox, retried
    switch_unreadable: switchUnreadable,
    recipients: recipients
  } };
  } finally {
    // The claim is dropped whatever happened — a pass that throws must not lock the lane out for the whole window.
    if (staffMine && staffClaim) {
      try { staffClaim.remove(STAFF_SWEEP_CLAIM_KEY); } catch (eRl) { /* the window expires on its own */ }
    }
  }
};

// ------------------------------------------------------------------ THE DESIGNS, RENDERED — an app that shows the…

// Every letter the platform can write, rendered with sample people so the screen shows the REAL templates — not…
function mailPreviewAll_() {
  var invite = inviteEmail_({
    name: 'Priya Raman', login: 'priya.raman@asalifecare.com',
    password: 'Welcome#2026', inviterName: 'Ty Bond'
  });
  var inviteArmed = inviteEmail_({
    name: 'Marcus Cole', login: 'marcus.cole@asalifecare.com',
    password: '', inviterName: 'Ty Bond'
  });
  var chat = chatUnreadEmail_({
    name: 'David', fromName: 'Emma Reyes',
    messages: ['Cover for the 7am at Maple? Tami called off.',
               'Never mind — Lucas took it. See you at the huddle.']
  });
  var late = staffAlertEmail_({ kind: 'late_show', person: 'Jeremiah Inman',
                                whenText: 'Sat, Aug 15, 2026',
                                shiftText: '48TH \u00b7 08:00\u201320:00',
                                arrivedText: '9:12 AM at 48TH (time clock)',
                                reportWords: 'Late Show \u2014 Jeremiah Inman (2026-08-15T04:00:00.000Z)' });
  var noCall = staffAlertEmail_({ kind: 'no_call', person: 'Nikyla Compton',
                                  whenText: 'Sat, Aug 15, 2026',
                                  shiftText: 'BM \u00b7 20:00\u201308:00' });
 // the designs
  var refPhone = referralPhoneEmail_({ name: 'Jordan Ellis' });
  var bdayStaff = birthdayEmail_({ name: 'Emma Reyes', audience: 'staff' });
  var bdayClient = birthdayEmail_({ name: 'Daniel', audience: 'client' });
  var certsRed = certsExpiredEmail_({ name: 'Alex Morgan', items: [
    { cert: 'DODD Certification', expiredOn: 'Jul 30, 2026' },
    { cert: 'CPR / First Aid', expiredOn: 'Aug 2, 2026' },
    { cert: 'Medication Delegation', expiredOn: 'Aug 10, 2026' }
  ] });
  var digest = platformDigestEmail_({ items: [
    { app: 'My asa.', status: 'live', note: 'your week, reminders and indicators \u2014 now accepts widgets from the bank' },
    { app: 'Chat', status: 'live', note: 'messages the moment they are sent; e-mail follows you when away' },
    { app: 'Kanban', status: 'live', note: 'the team wall, plus the whole projects portfolio full screen' },
    { app: 'Calendar', status: 'new', note: 'the weather on every coming day, and files pinned to days' },
    { app: 'Staff Performance', status: 'new', note: 'a 0\u201310 grade per person, explained line by line' },
    { app: 'Employee Support Hotline', status: 'new', note: 'every call heard, sorted and filed on its own' },
    { app: 'Talent Pipeline', status: 'new', note: '341 candidates scored, r\u00e9sum\u00e9s readable in place' },
    { app: 'Transportation', status: 'live', note: 'van runs, fleet, mileage and routes on one screen' },
    { app: 'Inventory', status: 'live', note: 'the pharmacy\u2019s own remaining-quantity record, per house' },
    { app: 'Books', status: 'live', note: 'a licence-clean library that grows itself' }
  ] });
  var howWorks = howItWorksEmail_({ name: 'Priya' });
 // the hiring messages' letters (moved to Smart Comms ): shipped wording of each situation row, rendered with…
  var dateAccepted = hiringNoticeEmail_({
    title: 'Hub — Date Accepted missing: Jordan Ellis',
    preheader: 'Every reading of the accepted in-person date failed.',
    facts: [{ label: 'Candidate', value: 'Jordan Ellis' },
            { label: 'Phone · Email', value: '+1 (330) 555-0148 · jordan.ellis@example.com' },
            { label: 'Screen', value: '8/10 · qualified · call 2026-08-15' }],
    bodyText: 'Hub: could not read the accepted in-person date for Jordan Ellis.\n\n' +
              'Action: open the Hiring Pipeline card and press Manual on Date accepted.'
  });
  var hiredComplete = hiringNoticeEmail_({
    title: 'Hub — Hired complete: Priya Raman',
    preheader: 'Every Hired step is green — all documentation is OK.',
    facts: [{ label: 'Candidate', value: 'Priya Raman' },
            { label: 'Phone · Email', value: '+1 (330) 555-0102 · priya.raman@example.com' }],
    bodyText: 'Hub: Priya Raman completed every Hired step — all documentation is OK.\n\n' +
              'They stay on the last step of the Hiring Pipeline for one more day, ' +
              'then move to Users as staff automatically.'
  });
  var hiredMissing = hiringNoticeEmail_({
    title: 'Hub — Hired with items MISSING: Marcus Cole',
    preheader: 'The card reached Hired with items still owed.',
    facts: [{ label: 'Candidate', value: 'Marcus Cole' },
            { label: 'Phone · Email', value: '+1 (330) 555-0177 · marcus.cole@example.com' },
            { label: 'Missing', value: 'Upload Documents — CPR card · New Hire Questionnaire' }],
    bodyText: 'Hub: Marcus Cole reached Hired, but items are missing.\n\n' +
              'They still stay one more day on the pipeline and then move to Users as ' +
              'staff — chase the missing items in the Onboarding Tracker.'
  });
  var packetAsk = packetRequestEmail_({
    subject: 'Your signed New Hire packet — ASA Lifecare',
    bodyText: 'Hi DSP,\n\n' +
              'To finish your onboarding we still need your signed New Hire packet.\n' +
              'Please check your inbox for your New Hire packet and complete it.\n\n' +
              'ASA Lifecare'
  });
  var readyStart = hiringNoticeEmail_({
    title: 'Hub — Priya Raman is ready to start',
    preheader: 'Hiring finished — a manager starts them from the board.',
    facts: [{ label: 'Staff account', value: 'Created and able to sign in' },
            { label: 'ASA Employee Database', value: 'Written' }],
    bodyText: 'Priya Raman has finished the hiring process.\n\n' +
              'Their card is at READY TO START — a manager begins their activities from the board.'
  });
  // NOBODY COULD REACH THEM.
  var unreachWords = null;
  try {
    if (typeof smartSituations_ === 'function') {
      var unreachSitId = (typeof commSituationId_ === 'function')
        ? commSituationId_('hiring.unreachable_archived', 'hiring_unreachable_archived')
        : 'hiring_unreachable_archived';
      smartSituations_().forEach(function (s) {
        if (str_(s.id) === unreachSitId) unreachWords = s;
      });
    }
  } catch (eU) { unreachWords = null; }
  function unreachFill(s) {
    return String(s || '')
      .split('{name}').join('Marcus Webb')
      .split('{tries}').join('7 time(s) over 24h')
      .split('{phone}').join('+1 330 555 0142')
      .split('{email}').join('marcus.webb@example.com');
  }
  var unreachable = hiringDiscardEmail_({
    name: 'Marcus Webb',
    reason: 'nobody could reach them — 7 time(s) over 24h on every contact we hold, no answer',
    stage: 'Outreach',
    when: '2026-08-29T14:20:00Z',
    by: 'the platform, after 7 time(s) over 24h',
    subject: unreachFill(unreachWords && unreachWords.email_subject),
    bodyText: unreachFill(unreachWords && unreachWords.email_text)
  });
  var guardianAlert = guardianAlertEmail_({ issues: [
    '14 expired requirements in the matrix',
    '2 dead write(s) in the ledger',
    'the matrix has not rebuilt in 31h'
  ] });
  return [
    { id: 'invite', label: 'Platform invitation', about: 'A new account, with the first-time password and the demand to change it.',
      subject: 'Your access to the ASA LifeCare platform', html: invite.html, text: invite.text },
    { id: 'invite-armed', label: 'Invitation — account already armed', about: 'The same letter for an account that already chose its own password: no password block.',
      subject: 'Your access to the ASA LifeCare platform', html: inviteArmed.html, text: inviteArmed.text },
    { id: 'chat-unread', label: 'Chat — messages while away', about: 'What somebody gets after five minutes away: the messages themselves, not "you have messages".',
      subject: 'Emma Reyes wrote to you', html: chat.html, text: chat.text },
    { id: 'late-show', label: 'Staff alert — Late Show', about: 'Raised automatically when the mailbox receives a Late Show report.',
      subject: late.subject, html: late.html, text: late.text },
    { id: 'no-call', label: 'Staff alert — No Show No Call', about: 'Raised automatically when the mailbox receives a No Show No Call report.',
      subject: noCall.subject, html: noCall.html, text: noCall.text },
    { id: 'referral-phone', label: 'Referral — the phone-number ask', about: 'A referral arrived with only a name and an e-mail: this asks for the one missing thing, warmly.',
      subject: refPhone.subject, html: refPhone.html, text: refPhone.text },
    { id: 'birthday-staff', label: 'Happy birthday — staff', about: 'The company’s birthday wish for a staff member. No buttons, no asks — just the wish.',
      subject: bdayStaff.subject, html: bdayStaff.html, text: bdayStaff.text },
    { id: 'birthday-client', label: 'Happy birthday — client', about: 'The same warmth in a client’s words: the ASA family celebrating their day.',
      subject: bdayClient.subject, html: bdayClient.html, text: bdayClient.text },
    { id: 'certs-expired', label: 'Certifications expired — the red letter', about: 'DODD / CPR / Med Delegation expired: the one letter allowed to wear red, with the steps back to compliance.',
      subject: certsRed.subject, html: certsRed.html, text: certsRed.text },
    { id: 'platform-status', label: 'Platform digest — status & news', about: 'One row per app: what is live, what is new this week.',
      subject: digest.subject, html: digest.html, text: digest.text },
    { id: 'how-it-works', label: 'How the platform works', about: 'The whole platform explained in sentences for a person’s first week: signing in, the workspace, the apps, how data moves.',
      subject: howWorks.subject, html: howWorks.html, text: howWorks.text },
 // the hiring messages' letters (moved to Smart Comms ) — words each one carries are edited in Settings → Smart…
    { id: 'hiring-date-accepted', label: 'Hiring — Date Accepted unreadable', about: 'Every reading of the accepted in-person date failed: the team is pointed at the card. Words: the hiring_date_accepted situation.',
      subject: dateAccepted.subject, html: dateAccepted.html, text: dateAccepted.text },
    { id: 'hired-complete', label: 'Hiring — Hired, everything green', about: 'A card reached Hired with all documentation OK. Words: the hiring_hired_complete situation.',
      subject: hiredComplete.subject, html: hiredComplete.html, text: hiredComplete.text },
    { id: 'hired-missing', label: 'Hiring — Hired with items missing', about: 'A card reached Hired still owing items — the team chases them in the Tracker. Words: the hiring_hired_missing situation.',
      subject: hiredMissing.subject, html: hiredMissing.html, text: hiredMissing.text },
    { id: 'packet-request', label: 'Hiring — the New Hire packet ask', about: 'The one hiring letter an APPLICANT reads: the signed packet is still owed. Words: the hiring_packet_request situation.',
      subject: packetAsk.subject, html: packetAsk.html, text: packetAsk.text },
    { id: 'ready-to-start', label: 'Hiring — ready to start', about: 'Hiring finished, account armed, Employee Database written. Words: the hiring_ready_to_start situation.',
      subject: readyStart.subject, html: readyStart.html, text: readyStart.text },
 // the Guardian's own letter — the one whose point is the alarm: red bar, red facts, the button to the Guardian app
    { id: 'unreachable-archived', label: 'Hiring — nobody could reach them', about: 'Seven tries across a day on every contact we hold, no answer: the card goes to the Archive and the team is told once. The only hiring letter about somebody leaving the board with no person deciding it. Words: the hiring_unreachable_archived situation.',
      subject: unreachable.subject, html: unreachable.html, text: unreachable.text },
    { id: 'guardian-alert', label: 'Guardian — the environment needs a person', about: 'The platform checked itself and something needs a person: the issues in red, the way in one button. Words: the guardian_alert situation.',
      subject: guardianAlert.subject, html: guardianAlert.html, text: guardianAlert.text }
  ];
}

HUB_POLICY.mailPreview = {
  file: 'StaffAlerts.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.mailPreview = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  return { status: 200, data: { designs: mailPreviewAll_() } };
};

// "Send me this one" — the design in a real mailbox beats the design in an iframe.
HUB_POLICY.mailPreviewSend = {
  file: 'StaffAlerts.gs', lane: 'tool', store: 'external',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { design_id: { required: true, type: 'string' } },
  invalidates: [],
  // a preview IS an e-mail — it lands in somebody's inbox like any other
  emits: ['emailSend']
};
HUB_ACTIONS.mailPreviewSend = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var to = str_(user.email);
  if (to.indexOf('@') === -1) return { status: 400, message: 'Your sign-in has no mailbox to send to.' };
  var id = str_(payload && payload.design_id);
  var all = mailPreviewAll_();
  var hit = null;
  for (var i = 0; i < all.length; i++) if (all[i].id === id) hit = all[i];
  if (!hit) return { status: 404, message: 'No design called "' + id + '".' };
  // the person pressing is the one it reaches (Rpc.gs HUB_QUIET_EXEMPT)
  var out = rpcCall_('emailSend', {
    to: to, subject: hit.subject, body: hit.text, html: hit.html,
    reason: 'design preview: ' + id
  }, { quiet_exempt: 'asked_now' });
  if (!out || !out.sent) {
    return { status: 502, message: 'The send was refused: ' + str_(out && (out.detail || out.error)) };
  }
  return { status: 200, data: { to: to, redirected: !!out.redirected } };
};
