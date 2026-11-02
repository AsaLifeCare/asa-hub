// ------------------------------------------------------------------ EMPLOYEE SUPPORT HOTLINE — the 5558 line…
// An Employee Support Hotline app.

var HOTLINE_CONFIG_TAB = 'hotline_config';
var HOTLINE_LOG_TAB = 'hotline_log';
var HOTLINE_LOG_HEADER = ['call_id', 'at', 'caller', 'items', 'kinds', 'status', 'via'];

/** The transcripts sheet the Quo webhook fills — the old world's inbox. */
var HOTLINE_TRANSCRIPTS_TAB = 'Transcripts';
// Column indices, 0-based — the receiver's own layout (DSP_TRANS in the legacy).
var HOTLINE_COLS = { CALL_ID: 0, EVENT_TS: 2, PARTICIPANTS: 5, TEAM: 6, TRANSCRIPT: 10, PROCESSED: 15 };

// The Calendar Archive — locations and the ** house-manager rows the call-off situation names (read-only, exactly…
var HOTLINE_CALENDAR_TAB = 'Calendar Archive';

// THE DEFAULT PROMPT — a faithful reconstruction of the legacy Doc's contract (the Doc itself was not shared with…
var HOTLINE_DEFAULT_PROMPT =
  'You process voicemail/call transcripts from the Employee Support Hotline of a company ' +
  'running group homes for adults with developmental disabilities in Ohio. Direct support ' +
  'professionals (DSPs) call this line to leave daily notes about clients, report incidents, ' +
  'ask for help, and call off shifts.\n\n' +
  'You receive a JSON payload: {transcript, client_names, staff_names, call_id, caller_phone, ' +
  'call_timestamp, reporting_date, location_names, request_types, daily_note_categories}.\n\n' +
  'Read the transcript and emit ONE work item PER DISTINCT MATTER as NDJSON — one JSON object ' +
  'per line, nothing else. Every object carries "work_type": "DailyNote" | "Incident" | "Request".\n\n' +
  'RULES THAT OUTRANK EVERYTHING:\n' +
  '- Use ONLY what the transcript says. Never invent a name, a date, a client or an event.\n' +
  '- Match names against client_names and staff_names; use the list spelling when the caller ' +
  'clearly means that person. A name you cannot match stays exactly as spoken.\n' +
  '- Dates: resolve relative words ("today", "tomorrow") against reporting_date. Format yyyy-MM-dd.\n' +
  '- One call often carries several matters — a daily note AND a call off is two lines.\n' +
  '- A matter that fits nothing else is a Request, its "Type of Request" taken from request_types.\n\n' +
  'DailyNote: ONE object PER CATEGORY the caller reported — a note about a client\'s sleep and ' +
  'meals is two DailyNote lines, never one line holding both. Every DailyNote of the call ' +
  'carries the same call_id and timestamp.\n' +
  'DailyNote fields: {"work_type":"DailyNote","timestamp":call_timestamp,"call_id":...,' +
  '"reporting_date":...,"dsp_name":"<the caller, matched>","caller_phone":...,' +
  '"client_name":"<matched client or empty>",' +
  '"category":"<one value copied exactly from daily_note_categories; other when none fits>",' +
  '"response":"<what was reported for that category only, in the caller\'s meaning>"}\n\n' +
  'Incident fields: {"work_type":"Incident","Timestamp":call_timestamp,"Your Name":"<caller>",' +
  '"Client Name":...,"Incident Category":...,"Incident Location":...,"Incident Date":...,' +
  '"Incident Time":...,"Incident Reported Date":reporting_date,"Incident Reported Time":...,' +
  '"Employees Involved":...,"Summary of Incident":...,"Immediate Action Taken":...,' +
  '"Cause and Contributing Factors":...,"Prevention Plan":...}\n\n' +
  'Request fields: {"work_type":"Request","Status":"New","Urgency":"Low|Medium|High",' +
  '"Date Received":reporting_date,"Requestor":"<caller, matched>","Requestor Phone":caller_phone,' +
  '"Type of Request":"<one value copied exactly from request_types>",' +
  '"Description of Request":"<what they need, complete>"}\n' +
  'A call off is ALWAYS "Type of Request":"Schedule - Call Off", Urgency "High", and the ' +
  'description names the shift date and the reason the caller gave.';

// THE SHIPPED WORDS THIS FILE HAS RETIRED, kept only as their SHA-256.
var HOTLINE_RETIRED_PROMPT_SHA256 = [
  'a2ac966ba3d89b08804d29079a4f00204c0452ca1f807392d27c3c2d88aca12b'
];
/** Which prompt the last config read handed out: 'stored' | 'shipped' | 'superseded'. */
var HOTLINE_PROMPT_FROM = '';

function hotlinePromptRetired_(text) {
  var t = String(text == null ? '' : text);
  if (!t) return false;
  var digest = '';
  try { digest = sha256Hex_(t); } catch (e) { return false; }
  return HOTLINE_RETIRED_PROMPT_SHA256.indexOf(digest) !== -1;
}

function hotlineConfigSheet_() {
  return hubTabEnsure_(HOTLINE_CONFIG_TAB, ['key', 'value']);
}

function hotlineLogSheet_() {
  // A log written before a column existed still has to grow it; a fresh tab was stamped with the whole header…
  var existed = !!hubTabSheet_(HOTLINE_LOG_TAB);
  var sheet = hubTabEnsure_(HOTLINE_LOG_TAB, HOTLINE_LOG_HEADER);
  if (existed) ensureHeader_(sheet, HOTLINE_LOG_HEADER);
  return sheet;
}

// THE READING FLOOR, IN DAYS — never a date, because a date in code is a date that rots.
var HOTLINE_MAX_AGE_DAYS = 14;

// THE CONFIG IS ASKED OF THE SHEET ONCE AN HOUR, NOT ONCE A PASS.
var HOTLINE_CONFIG_TTL_S = 3600;
var HOTLINE_CONFIG_CACHE_KEY = 'hotline_config_over_v1';
var HOTLINE_CONFIG_MEMO = null;
/** Which of them answered: 'cache' | 'sheet' | 'default' | 'unreadable'. */
var HOTLINE_CONFIG_FROM = '';

/** The save is the apply: drop the entry so the next read goes to the tab. */
function hotlineConfigForget_() {
  HOTLINE_CONFIG_MEMO = null;
  HOTLINE_CONFIG_FROM = '';
  try { CacheService.getScriptCache().remove(HOTLINE_CONFIG_CACHE_KEY); }
  catch (e) { /* an uncleared entry costs at most the TTL above */ }
}

function hotlineConfigOverrides_() {
  if (HOTLINE_CONFIG_MEMO) return HOTLINE_CONFIG_MEMO;
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (eC) { cache = null; }
  if (cache) {
    try {
      var hit = cache.get(HOTLINE_CONFIG_CACHE_KEY);
      if (hit) {
        HOTLINE_CONFIG_MEMO = JSON.parse(hit);
        HOTLINE_CONFIG_FROM = 'cache';
        return HOTLINE_CONFIG_MEMO;
      }
    } catch (eH) { /* an unreadable entry is a miss, never an answer */ }
  }
  var over = {};
  try {
    readTabNormalized_(hubTabWorkbook_(HOTLINE_CONFIG_TAB), HOTLINE_CONFIG_TAB).forEach(function (r) {
      var k = str_(r.key);
      if (k && r.value !== undefined && str_(r.value) !== '') over[k] = str_(r.value);
    });
  } catch (e) {
    // "NOT THERE" AND "WOULD NOT OPEN" ARE NOT THE SAME EMPTY.
    var missing = String((e && e.message) || e).indexOf('tab missing') !== -1;
    HOTLINE_CONFIG_FROM = missing ? 'default' : 'unreadable';
    HOTLINE_CONFIG_MEMO = {};
    return HOTLINE_CONFIG_MEMO;
  }
  HOTLINE_CONFIG_FROM = 'sheet';
  HOTLINE_CONFIG_MEMO = over;
  if (cache) {
    try { cache.put(HOTLINE_CONFIG_CACHE_KEY, JSON.stringify(over), HOTLINE_CONFIG_TTL_S); }
    catch (eP) { /* uncached is slow, never wrong */ }
  }
  return HOTLINE_CONFIG_MEMO;
}

function hotlineConfig_() {
  var out = {
    enabled: 'on',
    team_phone: '+13309195558',
    prompt: HOTLINE_DEFAULT_PROMPT,
    max_per_sweep: '6',
    max_age_days: String(HOTLINE_MAX_AGE_DAYS)
  };
  var over = hotlineConfigOverrides_();
  for (var k in over) if (over.hasOwnProperty(k)) out[k] = over[k];
  HOTLINE_PROMPT_FROM = over.hasOwnProperty('prompt') ? 'stored' : 'shipped';
  if (HOTLINE_PROMPT_FROM === 'stored' && hotlinePromptRetired_(out.prompt)) {
    out.prompt = HOTLINE_DEFAULT_PROMPT;
    HOTLINE_PROMPT_FROM = 'superseded';
  }
  return out;
}

HUB_POLICY.hotlineConfigGet = {
  file: 'Hotline.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'instant',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.hotlineConfigGet = function (payload, user) {
  if (!user || user.is_service || ['admin', 'manager'].indexOf(str_(user.role)) === -1) return hubDenied_();
  var cfg = hotlineConfig_();
  cfg.default_prompt = HOTLINE_DEFAULT_PROMPT;
  // The desk's status strip: the last calls, newest first — and the tab now holds REFUSALS as well as completions…
  var strip = hotlineLogStrip_();
  cfg.processed_total = strip.processed_total;
  cfg.blocked_total = strip.blocked_total;
  cfg.log_tail = strip.tail;
  // WHERE THE WORDS ON THIS SCREEN CAME FROM.
  cfg.config_from = HOTLINE_CONFIG_FROM;
  // And whether the prompt shown is the stored one, or the shipped one standing in for a stored copy of a retired…
  cfg.prompt_from = HOTLINE_PROMPT_FROM;
  return { status: 200, data: cfg };
};

// THE DESK STRIP — ten lines and two totals, read by RANGE.
function hotlineLogStrip_() {
  var out = { tail: [], processed_total: 0, blocked_total: 0 };
  var sheet = null;
  try { sheet = hubTabSheet_(HOTLINE_LOG_TAB); } catch (eS) { sheet = null; }
  if (!sheet) return out;
  try {
    var last = sheet.getLastRow();
    var cols = sheet.getLastColumn();
    if (last < 2 || cols < 1) return out;
    // By NAME, never by position: a data house may carry its columns in its own order, and a strip that reads the…
    var head = sheet.getRange(1, 1, 1, cols).getValues()[0].map(normKey_);
    var iStatus = head.indexOf('status');
    if (iStatus >= 0) {
      var statuses = sheet.getRange(2, iStatus + 1, last - 1, 1).getValues();
      for (var s = 0; s < statuses.length; s++) {
        if (str_(statuses[s][0]) === 'blocked') out.blocked_total++;
      }
    }
    out.processed_total = (last - 1) - out.blocked_total;
    var from = Math.max(2, last - 9);
    var rows = sheet.getRange(from, 1, last - from + 1, cols).getValues();
    for (var r = rows.length - 1; r >= 0; r--) {
      var line = hotlineLogLine_(rows[r], head);
      // readTabNormalized_ dropped empty rows and a range read cannot; a blank line on the strip would read as a…
      if (line.call_id || line.at) out.tail.push(line);
    }
  } catch (eR) { /* an unreadable audit is an empty strip, never a dead screen */ }
  return out;
}

function hotlineLogLine_(line, head) {
  function cell(name) {
    var i = head.indexOf(name);
    return i >= 0 ? str_(line[i]) : '';
  }
  return { call_id: cell('callid'), at: cell('at'), caller: cell('caller'),
           items: cell('items'), kinds: cell('kinds'),
           status: cell('status') || 'processed', via: cell('via') };
}

// Edit, apply, and it is in production — the save IS the apply: the next sweep reads this tab.
HUB_POLICY.hotlineConfigSet = {
  file: 'Hotline.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.hotlineConfigSet = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var allowed = ['enabled', 'team_phone', 'prompt', 'max_per_sweep', 'max_age_days'];
  var sheet = hotlineConfigSheet_();
  var values = sheet.getDataRange().getValues();
  var wrote = [];
  for (var a = 0; a < allowed.length; a++) {
    var k = allowed[a];
    if (payload[k] === undefined) continue;
    var v = String(payload[k]);
    var found = false;
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim() === k) {
        sheet.getRange(i + 1, 2).setValue(v);
        found = true;
        break;
      }
    }
    if (!found) sheet.appendRow([k, v]);
    wrote.push(k);
  }
  // THE SAVE IS THE APPLY, and it stays that way now the read is held for an hour: dropping the entry here is what…
  if (wrote.length) hotlineConfigForget_();
  hubSysLog_(str_(user.email), 'hotline_config_set', wrote.join(', '), { status: 200 });
  return { status: 200, data: { applied: wrote } };
};

// A CALL'S ROWS FOR ONE ESTATE SHEET, IN ONE WRITE — header-bound: it writes ONLY columns the sheet already has, by…
var HOTLINE_WRITE_LOCK_MS = 2000;

function hotlineEstateAppendRows_(resource, objs) {
  var out = { landed: 0, error: '' };
  var list = objs || [];
  if (!list.length) return out;
  try {
    var handle = estateSheet_(resource);
    if (!handle) throw new Error('estate sheet missing: ' + resource);
    var width = handle.keys.length;
    var lines = [];
    for (var o = 0; o < list.length; o++) {
      var line = [];
      for (var c = 0; c < width; c++) {
        var k = handle.keys[c];
        line.push(k && list[o][k] !== undefined ? list[o][k] : '');
      }
      lines.push(line);
    }
    var lock = null;
    if (lines.length > 1) {
      try {
        lock = LockService.getScriptLock();
        if (!lock.tryLock(HOTLINE_WRITE_LOCK_MS)) lock = null;
      } catch (eL) { lock = null; }
    }
    if (lock) {
      try {
        var sheet = handle.sheet;
        var first = sheet.getLastRow() + 1;
        var need = first + lines.length - 1;
        var grid = sheet.getMaxRows();
        if (grid < need) sheet.insertRowsAfter(grid, need - grid);
        sheet.getRange(first, 1, lines.length, width).setValues(lines);
        SpreadsheetApp.flush();
        out.landed = lines.length;
      } finally {
        try { lock.releaseLock(); } catch (eR) { /* the execution ending releases it */ }
      }
    } else {
      for (var i = 0; i < lines.length; i++) {
        handle.sheet.appendRow(lines[i]);
        out.landed++;
      }
    }
  } catch (e) {
    out.error = String((e && e.message) || e).slice(0, 200);
  }
  // The hotline queue is ALSO read as ESTATE_SOURCES.supportQueue and as Emp360's work queue — the same physical…
  if (out.landed) {
    try {
      var hsrc = estateSource_(resource);
      if (hsrc) cacheBump_(cacheScopeSheet_(hsrc.id, hsrc.tab));
    } catch (eB) { /* reads catch up on TTL */ }
  }
  return out;
}

// ONE ROW PER CLIENT AND CATEGORY, AND NEVER MORE THAN HOTLINE_NOTE_ROWS_MAX ROWS FROM ONE CALL.
var HOTLINE_NOTE_ROWS_MAX = 20;

function hotlineNoteRows_(notes, max) {
  var cap = Math.max(2, Number(max) || HOTLINE_NOTE_ROWS_MAX);
  var rows = [], at = {}, merged = 0;
  function low(v) { return str_(v).toLowerCase(); }
  var list = notes || [];
  for (var i = 0; i < list.length; i++) {
    var n = list[i] || {};
    var key = [low(n.client_name), low(n.category), low(n.reporting_date), low(n.dsp_name)].join('|');
    var row = null;
    if (at.hasOwnProperty(key)) {
      row = rows[at[key]];
      merged++;
    } else {
      row = { note: n, parts: [] };
      at[key] = rows.length;
      rows.push(row);
    }
    var said = str_(n.response);
    if (said && row.parts.map(low).indexOf(low(said)) === -1) row.parts.push(said);
  }
  var capped = Math.max(0, rows.length - cap);
  if (capped) {
    var rest = rows.slice(cap - 1);
    var distinct = function (field) {
      var seen = {}, out = [];
      for (var r = 0; r < rest.length; r++) {
        var v = str_(rest[r].note[field]);
        if (v && !seen[v.toLowerCase()]) { seen[v.toLowerCase()] = true; out.push(v); }
      }
      return out;
    };
    var clients = distinct('client_name'), days = distinct('reporting_date');
    var callers = distinct('dsp_name'), categories = distinct('category');
    var pieces = [];
    for (var p = 0; p < rest.length; p++) {
      var label = [];
      var nn = rest[p].note;
      if (clients.length > 1 && str_(nn.client_name)) label.push(str_(nn.client_name));
      if (days.length > 1 && str_(nn.reporting_date)) label.push(str_(nn.reporting_date));
      if (callers.length > 1 && str_(nn.dsp_name)) label.push(str_(nn.dsp_name));
      if (categories.length > 1) label.push(str_(nn.category));
      var text = rest[p].parts.join('; ');
      pieces.push(label.length ? label.join(', ') + (text ? ': ' + text : '') : text);
    }
    var head = rest[0].note, fold = {};
    for (var f in head) if (head.hasOwnProperty(f)) fold[f] = head[f];
    fold.client_name = clients.join(', ');
    fold.category = categories.length === 1 ? categories[0] : 'other';
    rows = rows.slice(0, cap - 1).concat([{ note: fold, parts: pieces.filter(String) }]);
  }
  var filed = [];
  for (var w = 0; w < rows.length; w++) {
    var line = {};
    for (var g in rows[w].note) if (rows[w].note.hasOwnProperty(g)) line[g] = rows[w].note[g];
    line.response = rows[w].parts.join('; ');
    filed.push(line);
  }
  return { rows: filed, merged: merged, capped: capped };
}

// WHERE THE NAME ON THIS ROW CAME FROM — written on every request, including the ones the phone could not name.
function hotlineNameNote_(fill) {
  if (!fill) return '';
  if (fill.from === 'person') return 'Requestor as stated on the call.';
  return contactWhoText_(fill.who);
}

// THE CALL BEHIND THE ROW, WRITTEN ON THE ROW.
function hotlineCallStamp_(text, callId) {
  var id = str_(callId);
  var line = String(text == null ? '' : text);
  if (id) line = line + ' Call ID: ' + id;
  return line.replace(/\s+/g, ' ').trim();
}

// THE KINDS OF REQUEST — a list that GROWS, kept where it can be seen.
var HOTLINE_REQUEST_TYPES_TAB = 'CommRequestTypes';
var HOTLINE_REQUEST_TYPES_HEADER = ['type', 'source', 'added_at', 'call_id'];
var HOTLINE_CALL_OFF_TYPE = 'Schedule - Call Off';
var HOTLINE_REQUEST_TYPE_MAX = 60;
var HOTLINE_REQUEST_AREAS = ['Admin', 'ADP', 'Finances', 'Operations', 'PSI', 'Safety',
                             'Schedule', 'Training', 'Other'];
var HOTLINE_REQUEST_TYPES_FLOOR = [
  'Admin - Employee Termination Letters',
  'Admin - Employee Verification Letters',
  'Admin - Employee Details',
  'Training - DODD Annual',
  'Training - Med Del',
  'Training - CPR',
  'Training - Other',
  'ADP - Pay Stubs',
  'ADP - Request Access to ADP',
  'ADP - Update Information',
  'Schedule - Time Off Request',
  'Schedule - Call Off',
  'Schedule - Shift Changes',
  'Finances - Request for Client Funds',
  'Finances - Request for New Client Card',
  'Finances - Request for Company Spending',
  'Finances - Request for New Company Card',
  'PSI - Time Entries',
  'PSI - Reset Password',
  'PSI - Troubleshooting',
  'Other - General Requests'
];
/** Which list the last read answered with: 'book' | 'floor'. */
var HOTLINE_REQUEST_TYPES_FROM = '';
/** How long the learner waits for the script lock, and how far into a pass it may still start. */
var HOTLINE_LEARN_LOCK_MS = 2000;
var HOTLINE_LEARN_BUDGET_MS = 240000;

// WHAT A MODEL WRITES WHEN IT HAS NOTHING TO SAY.
var HOTLINE_REQUEST_TYPE_PLACEHOLDER =
  /^(?:(?:undetermined|unknown|unclear|unspecified|not (?:specified|stated|mentioned|provided|given|clear|sure|determined|applicable))\b.*|n\/?a|none|null|undefined|other|others|misc|miscellaneous|general|tbd|to be determined|\?+|-+)$/i;

// ONE SPELLING PER TYPE.
function hotlineRequestTypeNorm_(raw) {
  var s = String(raw == null ? '' : raw).replace(/[ \t\u00a0\u2007\u202f]+/g, ' ').trim();
  s = s.replace(/ *[\u2012\u2013\u2014\u2015\u2212] */g, ' - ')
       .replace(/ +- *| *- +/g, ' - ')
       .replace(/[ .;,]+$/, '');
  if (!s) return '';
  var m = /^([A-Za-z]+) *[-:]+ *(\S.*)$/.exec(s);
  if (m) {
    for (var a = 0; a < HOTLINE_REQUEST_AREAS.length; a++) {
      if (HOTLINE_REQUEST_AREAS[a].toLowerCase() === m[1].toLowerCase()) {
        return HOTLINE_REQUEST_AREAS[a] + ' - ' + m[2];
      }
    }
  }
  return s;
}

// The comparison key: the one spelling, case folded, and each half of it reduced to letters and digits.
function hotlineRequestTypeWord_(w) {
  if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (w.length > 3 && /s$/.test(w) && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

function hotlineRequestTypeHalf_(s) {
  return String(s || '').split(/[^a-z0-9]+/).filter(String).map(hotlineRequestTypeWord_).join('');
}

function hotlineRequestTypeKey_(raw) {
  var t = hotlineRequestTypeNorm_(raw).toLowerCase();
  var cut = t.indexOf(' - ');
  if (cut === -1) return hotlineRequestTypeHalf_(t);
  return hotlineRequestTypeHalf_(t.slice(0, cut)) + ' - ' + hotlineRequestTypeHalf_(t.slice(cut + 3));
}

// DOES THIS LOOK LIKE A CALL OFF?
function hotlineRequestTypeCallOffish_(raw) {
  var t = hotlineRequestTypeNorm_(raw);
  if (/\bcall(?:ed|ing|s)?[\s-]*(?:off|out)s?\b|\bcall(?:off|out)s?\b/i.test(t)) return true;
  return hotlineRequestTypeCallOffWords_(t);
}

// THE SAME QUESTION ASKED OF THE LETTERS, NOT THE SPELLING.
var HOTLINE_CALL_OFF_WORDS = ['calloff', 'calledoff', 'callingoff', 'callsoff',
                              'callout', 'calledout', 'callingout', 'callsout'];

function hotlineRequestTypeCallOffWords_(raw) {
  var words = String(raw == null ? '' : raw).toLowerCase().replace(/0/g, 'o')
    .split(/[^a-z]+/).filter(String);
  var grams = [];
  for (var w = 0; w < words.length; w++) {
    grams.push(words[w]);
    if (w + 1 < words.length) grams.push(words[w] + words[w + 1]);
  }
  for (var g = 0; g < grams.length; g++) {
    var s = grams[g].replace(/s$/, '');
    if (HOTLINE_CALL_OFF_WORDS.indexOf(s) !== -1) return true;
    if (s.charAt(0) !== 'c' || s.length < 6 || s.length > 8) continue;
    if (nameLev_(s, 'calloff') <= 1 || nameLev_(s, 'callout') <= 1) return true;
  }
  return false;
}

// "Scheduling - Call Offs", "Schedule: Calloff", "Schedule Call Off" with no separator at all, a bare "Call-Off"…
function hotlineRequestTypeCallOffTwin_(raw) {
  return /^(?:schedul(?:e|es|ing)\s*[-:]*\s*)?call[\s-]*offs?$/i.test(hotlineRequestTypeNorm_(raw));
}

// IS THIS A KIND OF REQUEST, or something that only sits where one should?
function hotlineRequestTypeShape_(raw) {
  var text = String(raw == null ? '' : raw);
  if (/[\r\n]/.test(text)) return false;
  var t = hotlineRequestTypeNorm_(text);
  if (!t || t.length > HOTLINE_REQUEST_TYPE_MAX) return false;
  if (!/^[A-Za-z0-9 &\/'(),.+-]+$/.test(t)) return false;
  var parts = t.split(' - ');
  if (parts.length !== 2) return false;
  var area = parts[0], label = parts[1];
  if (!/^[A-Za-z][A-Za-z0-9&\/]*(?: [A-Za-z0-9&\/]+){0,2}$/.test(area)) return false;
  if (!/[A-Za-z]{2}/.test(label)) return false;
  if (!/^other$/i.test(area) && HOTLINE_REQUEST_TYPE_PLACEHOLDER.test(area)) return false;
  if (HOTLINE_REQUEST_TYPE_PLACEHOLDER.test(label)) return false;
  return true;
}

// The live list: the book's switched-on types in the book's order, then every floor type the book does not mention.
function hotlineRequestTypes_() {
  var rows = [];
  try { rows = hubBookRows_(HOTLINE_REQUEST_TYPES_TAB) || []; } catch (eB) { rows = []; }
  var out = [], seen = {}, off = {}, fromBook = 0;
  var callOffKey = hotlineRequestTypeKey_(HOTLINE_CALL_OFF_TYPE);
  for (var o = 0; o < rows.length; o++) {
    if (hubBookOn_(rows[o])) continue;
    var offKey = hotlineRequestTypeKey_(rows[o].type);
    if (offKey && offKey !== callOffKey) off[offKey] = true;
  }
  function add(value) {
    var t = hotlineRequestTypeNorm_(value);
    var k = hotlineRequestTypeKey_(t);
    if (!t || !k || seen[k] || off[k]) return false;
    if (k !== callOffKey && hotlineRequestTypeCallOffish_(t)) return false;
    seen[k] = true;
    out.push(t);
    return true;
  }
  for (var r = 0; r < rows.length; r++) {
    if (hubBookOn_(rows[r]) && add(rows[r].type)) fromBook++;
  }
  for (var f = 0; f < HOTLINE_REQUEST_TYPES_FLOOR.length; f++) add(HOTLINE_REQUEST_TYPES_FLOOR[f]);
  HOTLINE_REQUEST_TYPES_FROM = fromBook ? 'book' : 'floor';
  return out;
}

// Already a type, in ANY state — the floor, a switched-on row, or a row switched off.
function hotlineRequestTypeKnown_(type) {
  var k = hotlineRequestTypeKey_(type);
  if (!k) return false;
  for (var f = 0; f < HOTLINE_REQUEST_TYPES_FLOOR.length; f++) {
    if (hotlineRequestTypeKey_(HOTLINE_REQUEST_TYPES_FLOOR[f]) === k) return true;
  }
  var rows = [];
  try { rows = hubBookRows_(HOTLINE_REQUEST_TYPES_TAB) || []; } catch (eB) { rows = []; }
  for (var r = 0; r < rows.length; r++) {
    if (hotlineRequestTypeKey_(rows[r].type) === k) return true;
  }
  return false;
}

// A NEAR TWIN IS NOT A NEW KIND OF REQUEST.
var HOTLINE_REQUEST_TYPE_FILLER = { request: 1, for: 1, of: 1, the: 1, a: 1, an: 1, to: 1, and: 1 };

function hotlineRequestTypeWords_(label, area) {
  var areaWords = String(area || '').toLowerCase().split(/[^a-z0-9]+/).filter(String)
    .map(hotlineRequestTypeWord_);
  return String(label || '').toLowerCase().split(/[^a-z0-9]+/).filter(String)
    .map(hotlineRequestTypeWord_)
    .filter(function (w) { return !HOTLINE_REQUEST_TYPE_FILLER[w] && areaWords.indexOf(w) === -1; });
}

function hotlineRequestTypeNear_(a, b) {
  var ta = hotlineRequestTypeNorm_(a), tb = hotlineRequestTypeNorm_(b);
  var ca = ta.indexOf(' - '), cb = tb.indexOf(' - ');
  if (ca === -1 || cb === -1) return false;
  var areaA = ta.slice(0, ca), areaB = tb.slice(0, cb);
  var wa = hotlineRequestTypeWords_(ta.slice(ca + 3), areaA);
  var wb = hotlineRequestTypeWords_(tb.slice(cb + 3), areaB);
  if (!wa.length || !wb.length) return false;
  if (hotlineRequestTypeHalf_(areaA.toLowerCase()) !== hotlineRequestTypeHalf_(areaB.toLowerCase())) return false;
  var ja = wa.join(''), jb = wb.join('');
  if (ja === jb) return true;
  if (Math.abs(wa.length - wb.length) === 1) {
    var longer = wa.length > wb.length ? wa : wb;
    var shorter = (wa.length > wb.length ? wb : wa).join(' ');
    for (var i = 0; i < longer.length; i++) {
      if (longer.slice(0, i).concat(longer.slice(i + 1)).join(' ') === shorter) return true;
    }
  }
  if (ja.replace(/[^0-9]/g, '') !== jb.replace(/[^0-9]/g, '')) return false;
  var shortest = Math.min(ja.length, jb.length);
  var allowed = shortest >= 8 ? 2 : (shortest >= 5 ? 1 : 0);
  return allowed > 0 && nameLev_(ja, jb) <= allowed;
}

/** The existing type a coined one is a near twin of — the floor first, then the book in any state — or ''. */
function hotlineRequestTypeNearOf_(type, extra) {
  var have = HOTLINE_REQUEST_TYPES_FLOOR.slice();
  var rows = [];
  try { rows = hubBookRows_(HOTLINE_REQUEST_TYPES_TAB) || []; } catch (eB) { rows = []; }
  for (var r = 0; r < rows.length; r++) have.push(str_(rows[r].type));
  have = have.concat(extra || []);
  for (var i = 0; i < have.length; i++) {
    if (have[i] && hotlineRequestTypeNear_(type, have[i])) return hotlineRequestTypeNorm_(have[i]);
  }
  return '';
}

// The spelling the ROW gets: the list's own when the model meant a listed type in other capitals, spacing or…
function hotlineRequestTypeCanon_(type, known) {
  var t = hotlineRequestTypeNorm_(type);
  var k = hotlineRequestTypeKey_(t);
  if (!t) return '';
  if (k === hotlineRequestTypeKey_(HOTLINE_CALL_OFF_TYPE)) return HOTLINE_CALL_OFF_TYPE;
  if (hotlineRequestTypeCallOffTwin_(t)) return HOTLINE_CALL_OFF_TYPE;
  var list = known || [];
  for (var i = 0; i < list.length; i++) {
    if (hotlineRequestTypeKey_(list[i]) === k) return hotlineRequestTypeNorm_(list[i]);
  }
  return t;
}

// THE RULE THE CODE OWNS, appended after whatever prompt is configured.
function hotlineRequestTypeRule_(types) {
  var areas = [], seen = {};
  function addArea(a) {
    var name = String(a || '').trim();
    if (!name || seen[name.toLowerCase()]) return;
    if (!/^[A-Za-z][A-Za-z0-9&\/]*(?: [A-Za-z0-9&\/]+){0,2}$/.test(name)) return;
    seen[name.toLowerCase()] = true;
    areas.push(name);
  }
  for (var a = 0; a < HOTLINE_REQUEST_AREAS.length; a++) addArea(HOTLINE_REQUEST_AREAS[a]);
  for (var t = 0; t < (types || []).length; t++) {
    var parts = String(types[t]).split(' - ');
    if (parts.length === 2) addArea(parts[0]);
  }
  return '\n\nTYPE OF REQUEST — THIS RULE REPLACES ANY LIST OF REQUEST TYPES WRITTEN ABOVE:\n' +
    '- "Type of Request" is ONE value copied exactly, character for character, from request_types in the INPUT.\n' +
    '- Only when none of them fits, coin a new one shaped "<Area> - <Label>", at most ' +
    HOTLINE_REQUEST_TYPE_MAX + ' characters, using an existing area when one fits (' +
    areas.join(', ') + ').\n' +
    '- A call off is ALWAYS "' + HOTLINE_CALL_OFF_TYPE + '".\n' +
    '- Never a placeholder such as "Other", "Undetermined" or "Not specified" as the type.';
}

// A TYPE THE MODEL HAD TO COIN IS WRITTEN BACK INTO THE BOOK — once.
function hotlineRequestTypeLearn_(type, callId) {
  var t = hotlineRequestTypeNorm_(type);
  var out = { learned: false, type: t, why: '' };
  function say(action, status, message) {
    try {
      hubSysLog_('asa-hub:hotline', action, t, { status: status, message: message });
    } catch (eL) { /* the trail is best effort; the answer still carries it */ }
  }
  try {
    if (!t) { out.why = 'empty'; return out; }
    if (hotlineRequestTypeKnown_(t)) { out.why = 'known'; return out; }
    if (hotlineRequestTypeCallOffish_(t)) {
      out.why = 'call_off_twin';
      say('hotline_type_refused', 422, 'a call-off-looking type other than ' + HOTLINE_CALL_OFF_TYPE +
          ' pages nobody, so it is filed as written and never learned');
      return out;
    }
    if (!hotlineRequestTypeShape_(type)) { out.why = 'shape'; return out; }
    var twinOf = hotlineRequestTypeNearOf_(t, []);
    if (twinOf) {
      out.why = 'near_known';
      say('hotline_type_refused', 409, 'too close to the existing type "' + twinOf +
          '" to be a new kind of request, so it is filed as written and never learned');
      return out;
    }
    var bookId = String(hubId_('HUB_GENERIC_CONFIG_ID') || '');
    if (!bookId) {
      out.why = 'no_book';
      say('hotline_type_refused', 503, 'HUB_GENERIC_CONFIG_ID is not set; the type was filed but not learned');
      return out;
    }
    // A tab nobody made is not this lane's to make — one door makes tabs (TabRouter.gs), and the words book is not…
    var sheet = ssOpen_(bookId).getSheetByName(HOTLINE_REQUEST_TYPES_TAB);
    if (!sheet) {
      out.why = 'no_tab';
      say('hotline_type_refused', 404, 'the words book has no ' + HOTLINE_REQUEST_TYPES_TAB +
          ' tab; the type was filed but not learned');
      return out;
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(HOTLINE_LEARN_LOCK_MS)) {
      out.why = 'busy';
      say('hotline_type_refused', 503, 'the script lock was busy; the next call of this kind tries again');
      return out;
    }
    var wrote = false;
    try {
      var lastCol = sheet.getLastColumn();
      var head = lastCol > 0
        ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
            return String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
          })
        : [];
      var want = hotlineRequestTypeKey_(t);
      var iType = head.indexOf('type');
      var lastRow = sheet.getLastRow();
      if (iType >= 0 && lastRow > 1) {
        var cells = sheet.getRange(2, iType + 1, lastRow - 1, 1).getValues();
        for (var c = 0; c < cells.length; c++) {
          if (hotlineRequestTypeKey_(cells[c][0]) === want) { out.why = 'known'; return out; }
        }
        // A twin another execution learned a moment ago is in the sheet, not the held copy.
        for (var n = 0; n < cells.length && !twinOf; n++) {
          if (str_(cells[n][0]) && hotlineRequestTypeNear_(t, cells[n][0])) {
            twinOf = hotlineRequestTypeNorm_(cells[n][0]);
          }
        }
      }
      if (!twinOf) {
        var missing = HOTLINE_REQUEST_TYPES_HEADER.filter(function (k) { return head.indexOf(k) === -1; });
        if (missing.length) {
          sheet.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
          head = head.concat(missing);
        }
        var line = [];
        for (var h = 0; h < head.length; h++) line.push('');
        line[head.indexOf('type')] = t;
        line[head.indexOf('source')] = 'hotline';
        line[head.indexOf('added_at')] = new Date().toISOString();
        line[head.indexOf('call_id')] = str_(callId);
        sheet.appendRow(line);
        wrote = true;
      }
    } finally {
      try { lock.releaseLock(); } catch (eR) { /* the execution ending releases it */ }
    }
    if (twinOf) {
      out.why = 'near_known';
      say('hotline_type_refused', 409, 'too close to the existing type "' + twinOf +
          '" to be a new kind of request, so it is filed as written and never learned');
    }
    if (wrote) {
      // The held copies still describe the book as it was a moment ago.
      try { CacheService.getScriptCache().remove('hub_book_' + HOTLINE_REQUEST_TYPES_TAB); }
      catch (eC) { /* an uncleared entry costs at most the book's ten minutes */ }
      try { delete HUB_BOOK_MEMO[HOTLINE_REQUEST_TYPES_TAB]; } catch (eM) { /* re-read next execution */ }
      out.learned = true;
      say('hotline_type_learned', 200, 'coined for call ' + (str_(callId) || 'with no id'));
    }
  } catch (e) {
    out.why = 'threw';
    say('hotline_type_refused', 500, 'the type was filed but not learned: ' +
        String((e && e.message) || e).slice(0, 200));
  }
  return out;
}

// WHAT TO LEARN IS COLLECTED DURING THE PASS, NOT LEARNED DURING IT.
function hotlineLearnQueue_(queue, type, callId, offered) {
  var k = hotlineRequestTypeKey_(type);
  if (!k || !queue) return false;
  var have = (offered || []).concat(queue.map(function (q) { return q.type; }));
  for (var i = 0; i < have.length; i++) {
    if (hotlineRequestTypeKey_(have[i]) === k) return false;
  }
  queue.push({ type: hotlineRequestTypeNorm_(type), call_id: str_(callId) });
  return true;
}

// THE LEARNING, AFTER THE PASS AND INSIDE A BUDGET.
var HOTLINE_LEARN_MAX_PER_PASS = 3;

function hotlineLearnAfterPass_(queue, startedMs) {
  var out = { learned: [], deferred: 0, capped: 0 };
  var list = queue || [];
  for (var i = 0; i < list.length; i++) {
    if (Date.now() - Number(startedMs || 0) > HOTLINE_LEARN_BUDGET_MS) {
      out.deferred = list.length - i;
      break;
    }
    if (out.learned.length >= HOTLINE_LEARN_MAX_PER_PASS) {
      out.capped = list.length - i;
      break;
    }
    var learnt = hotlineRequestTypeLearn_(list[i].type, list[i].call_id);
    if (learnt && learnt.learned) out.learned.push(learnt.type);
  }
  return out;
}

// THE CATEGORIES OF A DAILY NOTE — the controlled list the old processor filed by, read from where the agency keeps…
var HOTLINE_FIELD_RULES_TAB = 'FieldRules';
var HOTLINE_NOTE_CATEGORIES_FLOOR = [
  'incidents', 'sleep_quality', 'activities_and_interactions', 'food_liquids', 'bms',
  'admin_tasks', 'mental_health_rating', 'mental_health', 'mobility', 'other',
  'urination', 'hygiene', 'housekeeping', 'physical_health', 'eating_habits'
];
/** Which list the last read answered with: 'book' | 'floor'. */
var HOTLINE_NOTE_CATEGORIES_FROM = '';

/** "Sleep Quality" → "sleep_quality": the snake spelling the notes are filed under. */
function hotlineNoteCategoryKey_(raw) {
  return String(raw == null ? '' : raw).toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** The categories inside a rules cell, in its order — [] when it names none. */
function hotlineNoteCategoriesParse_(text) {
  var s = String(text == null ? '' : text);
  var m = /list\s*:?\s*\(([^)]*)\)/i.exec(s) || /\(([^)]*)\)/.exec(s);
  if (!m) return [];
  var out = [], seen = {};
  var parts = m[1].split(/[,;\n]+/);
  for (var i = 0; i < parts.length; i++) {
    var k = hotlineNoteCategoryKey_(parts[i]);
    if (!k || seen[k] || !/^[a-z][a-z0-9_]*$/.test(k)) continue;
    seen[k] = true;
    out.push(k);
  }
  return out;
}

/** The live list: the book's cell when it parses, the floor otherwise; "other" always. */
function hotlineNoteCategories_() {
  var rows = [];
  try {
    var src = estateSource_('supportQueue');
    rows = (src && src.id) ? (emp360ReadTab_(src.id, HOTLINE_FIELD_RULES_TAB) || []) : [];
  } catch (eR) { rows = []; }
  var list = [];
  for (var r = 0; r < rows.length; r++) {
    if (hotlineNoteCategoryKey_(rows[r].output_table) !== 'daily_notes') continue;
    if (hotlineNoteCategoryKey_(rows[r].field_name) !== 'category') continue;
    list = hotlineNoteCategoriesParse_(rows[r].allowed_values_format);
    if (list.length) break;
  }
  HOTLINE_NOTE_CATEGORIES_FROM = list.length ? 'book' : 'floor';
  if (!list.length) list = HOTLINE_NOTE_CATEGORIES_FLOOR.slice();
  if (list.indexOf('other') === -1) list.push('other');
  return list;
}

// The category the ROW gets: the list's own spelling when the model wrote a listed category in other capitals or…
function hotlineNoteCategory_(raw, categories) {
  var k = hotlineNoteCategoryKey_(raw);
  var list = categories || [];
  if (k) {
    for (var i = 0; i < list.length; i++) {
      if (hotlineNoteCategoryKey_(list[i]) === k) return list[i];
    }
  }
  return 'other';
}

// THE DAILY NOTE RULE THE CODE OWNS, beside the request-types rule and for the same reason: a stored prompt can…
function hotlineDailyNoteRule_() {
  return '\n\nDAILY NOTES — THIS RULE REPLACES ANY DAILY NOTE CATEGORY LIST OR NOTE SHAPE WRITTEN ABOVE:\n' +
    '- Emit ONE "DailyNote" object PER CATEGORY the caller reported. A note about a client\'s sleep ' +
    'and meals is two DailyNote lines, never one line holding both.\n' +
    '- "category" is ONE value copied exactly, character for character, from daily_note_categories in the INPUT.\n' +
    '- "response" holds only what was reported for that category, in the caller\'s meaning.\n' +
    '- Every DailyNote of the call carries the same "call_id" and "timestamp".\n' +
    '- What fits no listed category is "other".';
}

// ONE CLIENT PER ROW, said after the prompt like the two rules above.
function hotlineClientRule_() {
  return '\n\nCLIENT NAMES — ONE CLIENT PER OBJECT:\n' +
    '- "client_name" on a DailyNote and "Client Name" on an Incident hold exactly ONE client.\n' +
    '- A note or an incident about two clients is one object per client, each naming its own client.';
}

// THE CLIENT ON THE ROW — the list's spelling only when the name is theirs.
function hotlineClientName_(spoken, clientNames) {
  var said = str_(spoken);
  var list = clientNames || [];
  if (!said || !list.length) return said;
  try {
    if (hotlineClientNamesMany_(said)) return said;
    var saidKey = nameTokens_(said).all.join(' ');
    for (var e = 0; e < list.length; e++) {
      if (saidKey && nameTokens_(list[e]).all.join(' ') === saidKey) return str_(list[e]);
    }
    var best = nameBest_(said, list, function (n) { return String(n || ''); });
    if (!best || !best.ok || !str_(best.matched_name)) return said;
    for (var i = 0; i < list.length; i++) {
      if (nameTokens_(list[i]).core.join(' ') === best.key) continue;
      var score = nameScore_(said, list[i]);
      if (score >= NAME_MATCH_MIN && best.score - score < NAME_MATCH_GAP) return said;
    }
    var saidCore = nameTokens_(said).core, gotCore = nameTokens_(best.matched_name).core;
    for (var s = 0; s < saidCore.length; s++) {
      var paired = false;
      for (var g = 0; g < gotCore.length && !paired; g++) paired = nameSim_(saidCore[s], gotCore[g]) >= 0.7;
      if (!paired) return said;
    }
    return str_(best.matched_name);
  } catch (eN) {
    return said;
  }
}

// DOES THIS CELL NAME MORE THAN ONE PERSON?
function hotlineClientNamesMany_(said) {
  var text = String(said == null ? '' : said);
  var named = text.split(/\s*(?:[,;&\/+]|\band\b)\s*/i).filter(function (p) {
    return nameTokens_(p).all.length > 0;
  });
  if (named.length < 2) return false;
  var surnameFirst = named.length === 2 && /^[^,;&\/+]*,[^,;&\/+]*$/.test(text) &&
    !/\band\b/i.test(text) && nameTokens_(text.split(',')[0]).all.length === 1;
  return !surnameFirst;
}

// ONE CALL, ONE ID AND ONE INSTANT on every row it files.
function hotlineCallFacts_(callId, callTs, items) {
  var id = str_(callId), at = str_(callTs);
  var list = items || [];
  for (var i = 0; i < list.length && (!id || !at); i++) {
    var it = list[i] || {};
    if (!id) id = str_(it.call_id);
    if (!at) at = str_(it.timestamp) || str_(it['Timestamp']);
  }
  return { call_id: id, at: at };
}

/** The context the model reads under the prompt — OUR directories. */
function hotlineContext_() {
  var clientNames = [];
  try {
    clientNames = clientsDerived_(serviceUser_()).map(function (r) { return str_(r.name); }).filter(String);
  } catch (eC) { clientNames = []; }
  var staffNames = [];
  try {
    staffNames = withoutIspClients_(peopleMerged_(listRows_('people', {})))
      .map(function (p) { return String(p.name || '').trim(); }).filter(String);
  } catch (eS) { staffNames = []; }
  var locationNames = [];
  try {
    var cal = ssOpen_(hubId_('HOTLINE_CALENDAR_ID')).getSheetByName(HOTLINE_CALENDAR_TAB);
    if (cal && cal.getLastRow() > 1) {
      var vals = cal.getRange('A2:A' + cal.getLastRow()).getValues();
      var seen = {};
      for (var i = 0; i < vals.length; i++) {
        var loc = String(vals[i][0] || '').trim();
        if (loc) seen[loc] = true;
      }
      locationNames = Object.keys(seen).sort();
    }
  } catch (eL) { locationNames = []; }
  // Never empty: an unreadable book answers with the floor (hotlineRequestTypes_), and an unreadable rules tab with…
  var requestTypes = hotlineRequestTypes_();
  var noteCategories = hotlineNoteCategories_();
  return { clientNames: clientNames, staffNames: staffNames, locationNames: locationNames,
           requestTypes: requestTypes, noteCategories: noteCategories };
}

/** NDJSON in, work items out — fences stripped, bad lines dropped, ported. */
function hotlineParseNdjson_(raw) {
  var cleaned = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  var items = [];
  cleaned.split('\n').forEach(function (line) {
    line = line.trim();
    if (!line) return;
    try { items.push(JSON.parse(line)); } catch (e) { /* one bad line, not a bad call */ }
  });
  return items;
}

/** "CAN - 38TH - ABD2005" matched from the request words — ported as-is. */
function hotlineLocation_(item, locationNames) {
  var desc = String(item['Description of Request'] || '').toLowerCase();
  for (var i = 0; i < locationNames.length; i++) {
    var parts = locationNames[i].split(' - ');
    for (var p = 1; p < parts.length; p++) {
      var seg = parts[p].trim().toLowerCase();
      if (seg && desc.indexOf(seg) >= 0) return locationNames[i];
    }
  }
  return '';
}

/** Days either side of today a ** row still counts; matches shift_requests.MANAGERS_CURRENT_DAYS. */
var HOTLINE_MANAGER_CURRENT_DAYS = 7;

/** The calendar's Date cell as 'yyyy-MM-dd' — month/day/year as the sheet writes it, or ISO; '' otherwise. */
function hotlineRowDay_(v) {
  var s = String(v || '').trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  var iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : '';
}

/** ** rows per location — { anchor, current }; the latest row, never the first, as shift_requests.managers_from_rows. */
function hotlineManagersByHouse_(data, todayIso) {
  var head = ((data && data[0]) || []).map(function (h) { return String(h || '').trim().toLowerCase(); });
  var dateCol = head.indexOf('date');
  var tz = 'America/New_York';
  var shift = function (days) {
    var c = String(todayIso).split('-');
    return Utilities.formatDate(new Date(Date.UTC(Number(c[0]), Number(c[1]) - 1, Number(c[2]) + days, 12)),
                                'UTC', 'yyyy-MM-dd');
  };
  var lo = shift(-HOTLINE_MANAGER_CURRENT_DAYS), hi = shift(HOTLINE_MANAGER_CURRENT_DAYS);
  var per = {};
  for (var i = 1; i < (data || []).length; i++) {
    if (String(data[i][2] || '').trim() !== '**') continue;
    var loc = String(data[i][0] || '').trim();
    var row = { name: String(data[i][1] || '').trim(), phone: String(data[i][3] || '').trim(),
                house: loc, order: i };
    if (!loc || !row.name) continue;
    var cell = dateCol >= 0 ? data[i][dateCol] : '';
    row.day = cell instanceof Date ? Utilities.formatDate(cell, tz, 'yyyy-MM-dd') : hotlineRowDay_(cell);
    (per[loc] = per[loc] || []).push(row);
  }
  var out = {};
  Object.keys(per).forEach(function (loc) {
    var past = null, ahead = null, last = null, near = [];
    per[loc].forEach(function (r) {
      last = r;
      if (!r.day) return;
      if (r.day <= todayIso) { if (!past || r.day >= past.day) past = r; }
      else if (!ahead || r.day < ahead.day) ahead = r;
      if (r.day >= lo && r.day <= hi) near.push(r);
    });
    var anchor = past || ahead || last;
    near.sort(function (a, b) { return a.day === b.day ? b.order - a.order : (a.day < b.day ? 1 : -1); });
    var current = [anchor], seen = {};
    seen[anchor.name.toLowerCase() + '|' + anchor.phone] = true;
    near.forEach(function (r) {
      var k = r.name.toLowerCase() + '|' + r.phone;
      if (seen[k]) return;
      seen[k] = true;
      current.push(r);
    });
    out[loc] = { anchor: anchor, current: current };
  });
  return out;
}

/** Today on the company's clock, as the calendar's rows are compared against it. */
function hotlineManagerToday_() {
  return Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
}

/** Every house's current managers, behind the `housemanagers` keyword; an unreadable calendar answers readable:false. */
function hotlineHouseManagers_() {
  var out = { readable: false, rows: 0, people: [], why: '' };
  try {
    var sheet = ssOpen_(hubId_('HOTLINE_CALENDAR_ID')).getSheetByName(HOTLINE_CALENDAR_TAB);
    if (!sheet) {
      out.why = 'the hotline calendar has no tab named ' + HOTLINE_CALENDAR_TAB;
      return out;
    }
    var data = sheet.getDataRange().getValues();
    out.readable = true;
    out.rows = Math.max(0, data.length - 1);
    var byHouse = hotlineManagersByHouse_(data, hotlineManagerToday_());
    Object.keys(byHouse).forEach(function (loc) {
      byHouse[loc].current.forEach(function (r) {
        out.people.push({ name: r.name, phone: r.phone, house: loc });
      });
    });
  } catch (e) {
    out.why = String((e && e.message) || e);
  }
  return out;
}

/** The house manager of a location — the most recent ** row (hotlineManagersByHouse_), the one the situation names. */
function hotlineHouseManager_(location) {
  if (!location) return null;
  try {
    var sheet = ssOpen_(hubId_('HOTLINE_CALENDAR_ID')).getSheetByName(HOTLINE_CALENDAR_TAB);
    if (!sheet) return null;
    var got = hotlineManagersByHouse_(sheet.getDataRange().getValues(), hotlineManagerToday_())[location];
    return got ? { name: got.anchor.name, phone: got.anchor.phone } : null;
  } catch (e) { /* no manager found is an honest answer */ }
  return null;
}

// IS THIS CALL THE HOTLINE'S?
function hotlineTeamMatch_(cell, want) {
  var w = String(want || '').replace(/\D/g, '');
  if (!w) return false;
  var parts = String(cell || '').split(/[,;|\/]+/);
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].replace(/\D/g, '') === w) return true;
  }
  return false;
}

// The last line of the audit — the floor a repeating refusal is deduped against.
var HOTLINE_LOG_LAST_KEY = null;

// THE FACT, NOT THE PERMUTATION.
function hotlineLogKey_(callId, status, via) {
  return str_(callId) + '|' + str_(status) + '|' + str_(via).replace(/_\d+/g, '_');
}

function hotlineLogLastKey_() {
  if (HOTLINE_LOG_LAST_KEY !== null) return HOTLINE_LOG_LAST_KEY;
  HOTLINE_LOG_LAST_KEY = '';
  try {
    var sheet = hubTabSheet_(HOTLINE_LOG_TAB);
    if (!sheet) return HOTLINE_LOG_LAST_KEY;
    var last = sheet.getLastRow();
    var cols = sheet.getLastColumn();
    if (last < 2 || cols < 1) return HOTLINE_LOG_LAST_KEY;
    var row = sheet.getRange(last, 1, 1, cols).getValues()[0];
    HOTLINE_LOG_LAST_KEY = hotlineLogKey_(row[0], row[5], row[6]);
  } catch (e) { /* unreadable is '' — the refusal gets written, which is the safe way to be wrong */ }
  return HOTLINE_LOG_LAST_KEY;
}

// A REFUSAL IS WRITTEN DOWN — the other half of the audit.
function hotlineLogBlocked_(callId, caller, why) {
  var key = hotlineLogKey_(callId, 'blocked', why);
  if (hotlineLogLastKey_() === key) return false;
  try {
    hotlineLogSheet_().appendRow([str_(callId), new Date().toISOString(), str_(caller),
                                  0, '', 'blocked', str_(why)]);
    HOTLINE_LOG_LAST_KEY = key;
  } catch (e) { /* the return value still carries it */ }
  // The platform's own trail too, under an actor that is NOT the service identity — hubSysLog_ drops a service…
  hubSysLog_('asa-hub:hotline', 'hotline_blocked', str_(callId),
             { status: 502, message: str_(why) });
  return true;
}

// ONE CALL, HANDED OVER BY THE RELAY'S WEBHOOK DOOR, AS THE INBOX ROW.
var HOTLINE_CALL_ID_RE = /^AC[0-9A-Za-z]{32}$/;

/** The turns that are objects; anything else is not a turn. */
function hotlineDialogueTurns_(dialogue) {
  if (!Array.isArray(dialogue)) return [];
  return dialogue.filter(function (t) { return !!t && typeof t === 'object'; });
}

/** userId → the first number it spoke from (buildUserIdToPhoneMap). */
function hotlineDialoguePhones_(turns) {
  var map = {};
  for (var i = 0; i < turns.length; i++) {
    var t = turns[i];
    if (t.userId && t.identifier && !map.hasOwnProperty(t.userId)) map[t.userId] = t.identifier;
  }
  return map;
}

/** "[m:ss] <speaker>: words", one line per turn (formatTranscript's `separated`). */
function hotlineDialogueText_(dialogue) {
  var turns = hotlineDialogueTurns_(dialogue);
  var phones = hotlineDialoguePhones_(turns);
  var lines = [];
  for (var i = 0; i < turns.length; i++) {
    var t = turns[i];
    var sec = t.start ? (Math.round(Number(t.start)) || 0) : 0;
    var speaker = t.identifier || '';
    if (!speaker && t.userId) speaker = (phones.hasOwnProperty(t.userId) ? phones[t.userId] : '') || t.userId;
    var mins = Math.floor(sec / 60), secs = sec % 60;
    lines.push('[' + mins + ':' + (secs < 10 ? '0' : '') + secs + '] ' + speaker + ': ' + (t.content || ''));
  }
  return lines.join('\n');
}

/** The company side: each userId once, as its number (extractTeamMemberPhones). */
function hotlineDialogueTeam_(dialogue) {
  var turns = hotlineDialogueTurns_(dialogue);
  var phones = hotlineDialoguePhones_(turns);
  var seen = {}, out = [];
  for (var i = 0; i < turns.length; i++) {
    var uid = turns[i].userId || '';
    if (!uid || seen.hasOwnProperty(uid)) continue;
    seen[uid] = true;
    out.push((phones.hasOwnProperty(uid) ? phones[uid] : '') || uid);
  }
  return out.join(', ');
}

/** The outside side: numbers with no userId, never the line (extractExternalParticipants). */
function hotlineDialogueCallers_(dialogue, linePhone) {
  var turns = hotlineDialogueTurns_(dialogue);
  var line = String(linePhone || '');
  var seen = {}, out = [];
  for (var i = 0; i < turns.length; i++) {
    var id = turns[i].identifier || '';
    if (!id || seen.hasOwnProperty(id)) continue;
    if (line && id === line) continue;
    if (turns[i].userId) continue;
    seen[id] = true;
    out.push(id);
  }
  return out.join(', ');
}

/** An instant cell as the receiver wrote it: a Date, or '' when there is none. */
function hotlineCallInstant_(value) {
  if (!value) return '';
  var d = new Date(value);
  return isNaN(d.getTime()) ? '' : d;
}

// The receiver's row for one call, at HOTLINE_COLS — or null when the id is not a call id or there is not one turn.
function hotlineCallRow_(call) {
  if (!call || typeof call !== 'object') return null;
  var id = String(call.call_id == null ? '' : call.call_id);
  if (!HOTLINE_CALL_ID_RE.test(id)) return null;
  var turns = hotlineDialogueTurns_(call.dialogue);
  if (!turns.length) return null;
  var row = [];
  for (var c = 0; c <= HOTLINE_COLS.PROCESSED; c++) row.push('');
  var duration = Number(call.duration);
  row[HOTLINE_COLS.CALL_ID] = id;
  row[1] = hotlineCallInstant_(call.created);                    // Transcript Created
  row[HOTLINE_COLS.EVENT_TS] = hotlineCallInstant_(call.event_ts);
  row[3] = duration ? Math.round(duration) : '';                 // Duration (sec)
  row[HOTLINE_COLS.PARTICIPANTS] = hotlineDialogueCallers_(turns, '');
  row[HOTLINE_COLS.TEAM] = hotlineDialogueTeam_(turns);
  row[8] = turns.length;                                         // # Turns
  row[9] = turns.map(function (t) { return t.content || ''; }).join(' ');   // Full Transcript
  row[HOTLINE_COLS.TRANSCRIPT] = hotlineDialogueText_(turns);
  return row;
}

// THE CLAIM ON A CALL — taken before the call is read, by the fast path and the clock alike, so two executions…
var HOTLINE_CLAIM_TTL_S = 420;
var HOTLINE_CLAIM_FILED_TTL_S = 21600;
var HOTLINE_CLAIM_LOCK_MS = 5000;

function hotlineClaimKey_(callId) {
  return 'hotline:claim:' + str_(callId);
}

/** 'filed' | 'busy' | '' (nobody holds it, or the key would not read). Takes nothing. */
function hotlineClaimPeek_(callId) {
  try {
    var held = String(CacheService.getScriptCache().get(hotlineClaimKey_(callId)) || '');
    if (held === 'filed') return 'filed';
    if (held.indexOf('claimed') === 0) return 'busy';
  } catch (e) { /* a rehearsal writes nothing either way */ }
  return '';
}

/** 'claimed' (this execution owns it) | 'busy' | 'filed' | 'lock' | 'cache'. */
function hotlineClaim_(callId, via) {
  var lock = null;
  try { lock = LockService.getScriptLock(); } catch (eL) { lock = null; }
  if (!lock) return 'lock';
  try { if (!lock.tryLock(HOTLINE_CLAIM_LOCK_MS)) return 'lock'; } catch (eT) { return 'lock'; }
  try {
    var cache = CacheService.getScriptCache();
    var key = hotlineClaimKey_(callId);
    var held = String(cache.get(key) || '');
    if (held === 'filed') return 'filed';
    if (held.indexOf('claimed') === 0) return 'busy';
    cache.put(key, 'claimed:' + str_(via), HOTLINE_CLAIM_TTL_S);
    return 'claimed';
  } catch (eC) {
    return 'cache';   // the claim store, not the lock: named apart
  } finally {
    try { lock.releaseLock(); } catch (eR) { /* the execution ending releases it */ }
  }
}

function hotlineClaimFiled_(callId) {
  try { CacheService.getScriptCache().put(hotlineClaimKey_(callId), 'filed', HOTLINE_CLAIM_FILED_TTL_S); }
  catch (e) { /* the audit's processed row still says it */ }
}

/** Let go of a claim this execution will not file under; `filed` is never let go. */
function hotlineClaimRelease_(callId) {
  try {
    var cache = CacheService.getScriptCache();
    var key = hotlineClaimKey_(callId);
    if (String(cache.get(key) || '').indexOf('claimed') === 0) cache.remove(key);
  } catch (e) { /* it expires after HOTLINE_CLAIM_TTL_S */ }
}

// The calls the audit holds as filed: one read of call_id..status, and only `processed` rows count — the desk's own…
function hotlineFiledCallIds_(logSheet) {
  var out = {};
  if (!logSheet) return out;
  var last = logSheet.getLastRow();
  var cols = Math.min(6, logSheet.getMaxColumns());
  if (last < 2 || cols < 1) return out;
  var rows = logSheet.getRange(2, 1, last - 1, cols).getValues();
  for (var r = 0; r < rows.length; r++) {
    var id = str_(rows[r][0]);
    if (id && str_(rows[r][5]).toLowerCase() === 'processed') out[id] = true;
  }
  return out;
}

/** A filed call's inbox row is marked, never read again. No inbox, nothing to mark. */
function hotlineReconcileRow_(sheet, rowNumber) {
  if (!sheet) return false;
  try {
    sheet.getRange(rowNumber, HOTLINE_COLS.PROCESSED + 1).setValue('Yes');
    return true;
  } catch (e) { return false; }   // still filed; the next pass marks it
}

// THE CLAIM'S UNANSWERED ZEROS, one reason (`lock_busy`) with its cause named.
function hotlineClaimLeft_(census, fast) {
  var lock = Number(census && census.lock_busy) || 0;
  var store = Number(census && census.claim_unreadable) || 0;
  if (!lock && !store) return null;
  var why = store > 0
    ? 'The claim store (CacheService) would not answer for ' + store + ' waiting call(s)' +
      (lock > 0 ? ' and the script lock was busy for ' + lock : '') + ', so they were left for the next try.'
    : 'The script lock was busy, so ' + lock + ' waiting call(s) were left for the next try.';
  return { status: (fast || store > 0) ? 503 : 200, message: why };
}

// THE SHARED CELL, MARKED FOR A CALL THE WEBHOOK DOOR FILED — after its rows, its audit line and its page, never…
function hotlineInboxMark_(callId) {
  var id = str_(callId);
  if (!id) return false;
  try {
    var sheet = ssOpen_(hubId_('HOTLINE_TRANSCRIPTS_ID')).getSheetByName(HOTLINE_TRANSCRIPTS_TAB);
    if (!sheet) return false;
    var last = sheet.getLastRow();
    if (last < 2) return false;
    var hits = sheet.getRange(2, HOTLINE_COLS.CALL_ID + 1, last - 1, 1)
      .createTextFinder(id).matchEntireCell(true).findAll() || [];
    var marked = false;
    for (var h = 0; h < hits.length; h++) {
      var cell = sheet.getRange(hits[h].getRow(), HOTLINE_COLS.PROCESSED + 1);
      if (String(cell.getValue() || '').trim()) continue;   // theirs or ours — owned
      cell.setValue('Yes');
      marked = true;
    }
    return marked;
  } catch (e) { return false; }
}

// ONE PAGE TAIL AT A TIME.
var HOTLINE_TAIL_KEY = 'hotline:tail';
var HOTLINE_TAIL_TTL_S = 120;
var HOTLINE_TAIL_WAIT_MS = 45000;
var HOTLINE_TAIL_STEP_MS = 1000;
var HOTLINE_TAIL_LOCK_MS = 1000;

/** The marker's token when taken; '' when the tail runs without one. */
function hotlineTailTake_(waitMs, key) {
  var k = str_(key) || HOTLINE_TAIL_KEY;
  var token = String(Date.now()) + ':' + Math.random().toString(36).slice(2, 10);
  var deadline = Date.now() + Math.max(0, Number(waitMs) || 0);
  var lock = null;
  try { lock = LockService.getScriptLock(); } catch (eL) { lock = null; }
  if (!lock) return '';
  for (;;) {
    var locked = false;
    try { locked = lock.tryLock(HOTLINE_TAIL_LOCK_MS) === true; } catch (eT) { locked = false; }
    if (locked) {
      try {
        var cache = CacheService.getScriptCache();
        if (!cache.get(k)) { cache.put(k, token, HOTLINE_TAIL_TTL_S); return token; }
      } catch (eC) {
        return '';   // no marker store: nothing to wait on
      } finally {
        try { lock.releaseLock(); } catch (eR) { /* the execution ending releases it */ }
      }
    }
    if (Date.now() + HOTLINE_TAIL_STEP_MS > deadline) return '';
    Utilities.sleep(HOTLINE_TAIL_STEP_MS);
  }
}

/** Clears the marker only while it is still this tail's own. */
function hotlineTailRelease_(token, key) {
  if (!token) return;
  var k = str_(key) || HOTLINE_TAIL_KEY;
  try {
    var cache = CacheService.getScriptCache();
    if (String(cache.get(k) || '') === String(token)) cache.remove(k);
  } catch (e) { /* it expires after HOTLINE_TAIL_TTL_S */ }
}

// HOW FAR INTO A PASS A CALL MAY STILL BE OPENED.
var HOTLINE_OPEN_BUDGET_MS = 180000;

HUB_POLICY.hotlineSweep = {
  file: 'Hotline.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: [],
  invalidates: [],
  // IT REACHES PEOPLE THROUGH SMART COMMS.
  emits: ['smsSend', 'emailSend', 'teamAlert']
};
HUB_ACTIONS.hotlineSweep = function (payload, user) {
  // The relay's clock, or an admin's hand — the attendance sweep's own rule.
  if (!user) return hubDenied_();
  if (!user.is_service && String(user.role) !== 'admin') return hubDenied_();
  // ONE CALL, handed over by the relay's webhook door — the service only, since the words it carries are filed as…
  var fast = !!payload && Object.prototype.hasOwnProperty.call(payload, 'call');
  if (fast && !user.is_service) return hubDenied_();

  // IS PSI ANYWHERE ANSWERING?
  var psiHanded = psiVerdictFrom_(payload && payload.psi, 'the call');

  // WHY THIS ACTION KEEPS A CENSUS INSTEAD OF A COUNT.
  var census = {
    mode: fast ? 'call' : 'sweep', // one call from the webhook door, or the inbox pass
    processed: 0, items: 0, kinds: [],
    scanned: 0,        // rows looked at
    candidates: 0,     // the hotline's own, unprocessed, with words in them
    attempted: 0,      // candidates inside the reading floor that were opened
    blocked: 0,        // opened, and the model would not answer
    held: 0,           // the hotline's own, but older than the reading floor
    no_transcript: 0,  // the hotline's own, unprocessed, and empty
    item_failures: 0,  // read, but a work item would not file
    capped: false,
    out_of_time: false, // stopped before opening a call because the pass clock ran out
    notes_merged: 0,   // daily notes folded into a row of the same client and category
    notes_capped: 0,   // note rows past HOTLINE_NOTE_ROWS_MAX, folded into each call's last row
    config: '',        // where this pass's orders came from
    prompt: '',        // 'stored' | 'shipped' | 'superseded' (a stored copy of a retired default)
    request_types: '', // which list the model was offered: 'book' | 'floor'
    note_categories: '', // which daily-note categories it was offered: 'book' | 'floor'
    types_learned: 0,  // new kinds of request written back into the book
    types_deferred: 0, // coined types the pass had no time left to learn
    types_capped: 0,   // coined types past the per-pass learning cap
    reconciled: 0,     // already filed: marked on the inbox, never read again
    claimed_elsewhere: 0, // another execution holds the call's claim
    lock_busy: 0,      // the claim could not be taken; the call is left for later
    claim_unreadable: 0, // the claim store would not answer; the call is left for later
    filed_set: '',     // the audit's filed calls: 'read' | 'none' (no tab answered) | 'unreadable'
    // ms since the pass started, as each mark was last reached
    timing: { context_ms: null, model_ms: null, filed_ms: null, total_ms: null },
    reason: ''
  };
  var passStartedMs = Date.now();
  function hotlineDone_(status, reason, message) {
    census.reason = reason;
    census.timing.total_ms = Date.now() - passStartedMs;
    var env = { status: status, data: census };
    if (message) env.message = message;
    return env;
  }

  // WHAT THE QUIET WINDOW HELD LAST NIGHT, SAID NOW IF IT IS STILL TRUE (CommCallOff.gs section 7B).
  if (!fast && typeof commCallOffQuietCarry_ === 'function') {
    try { census.quiet_carried = commCallOffQuietCarry_(); }
    catch (eQc) { census.quiet_carried = { error: String((eQc && eQc.message) || eQc) }; }
  }
  // AND THE ONE-SHOT PAGES THE WINDOW HELD (Rpc.gs hubQuietOwedCarry_): an incident, a support request, a PSI…
  if (!fast && typeof hubQuietOwedCarry_ === 'function') {
    try {
      census.quiet_owed = hubQuietOwedCarry_({
        incident: (typeof commIncidentQuietCarry_ === 'function') ? commIncidentQuietCarry_ : null,
        support: (typeof commSupportQuietCarry_ === 'function') ? commSupportQuietCarry_ : null,
        psi: (typeof commPsiQuietCarry_ === 'function') ? commPsiQuietCarry_ : null,
        // an app announcement held overnight, or while its reads could not answer, to whoever it still applies to
        app_release: (typeof appReleaseQuietCarry_ === 'function') ? appReleaseQuietCarry_ : null,
        /* a broadcast held overnight, unless withdrawn */
        broadcast: (typeof commBroadcastQuietCarry_ === 'function') ? commBroadcastQuietCarry_ : null,
        // a one-shot team alert (the Hired alert, the Date Accepted escalation, the weekly key notice), said only…
        team_alert: (typeof hubTeamAlertQuietCarry_ === 'function') ? hubTeamAlertQuietCarry_ : null,
        /* a letter a door fired (a form's notices), while its situation is on */
        letter: (typeof hubLetterQuietCarry_ === 'function') ? hubLetterQuietCarry_ : null,
        /* an employee loan request, while it still waits */
        staff_loan: (typeof elQuietCarry_ === 'function') ? elQuietCarry_ : null
      });
    } catch (eQo) { census.quiet_owed = { error: String((eQo && eQo.message) || eQo) }; }
  }
  var callRow = null;
  if (fast) {
    census.call_id = '';
    census.inbox_marked = false;   // the shared Processed cell, marked after the tail
    callRow = hotlineCallRow_(payload.call);
    if (!callRow) return hotlineDone_(400, 'bad_call', 'The call needs an AC call id and at least one turn.');
    census.call_id = callRow[HOTLINE_COLS.CALL_ID];
  }

  var cfg = hotlineConfig_();
  census.config = HOTLINE_CONFIG_FROM;
  census.prompt = HOTLINE_PROMPT_FROM;
  // OFF IS A DECISION, and a decision must be legible.
  if (String(cfg.enabled).toLowerCase() !== 'on') {
    census.enabled = false;
    return hotlineDone_(200, 'disabled');
  }
  if (typeof screenAiChat_ !== 'function') {
    return hotlineDone_(503, 'no_provider', 'No model provider is configured.');
  }
  var simulate = !!(payload && payload.simulate);

  // ONE CALL never opens the inbox: its row is the one the receiver would write.
  var transSheet = null;
  if (!fast) {
    try {
      transSheet = ssOpen_(hubId_('HOTLINE_TRANSCRIPTS_ID')).getSheetByName(HOTLINE_TRANSCRIPTS_TAB);
    } catch (eT) { transSheet = null; }
    if (!transSheet) return hotlineDone_(502, 'inbox_unreadable', 'The transcripts sheet did not open.');
  } else if (!hotlineTeamMatch_(callRow[HOTLINE_COLS.TEAM], cfg.team_phone)) {
    return hotlineDone_(200, 'not_this_line');
  }

  // ONLY THE COLUMNS THE LOOP READS.
  var data = [[], callRow];
  if (transSheet) {
    var lastRow = transSheet.getLastRow();
    var wantCols = Math.min(HOTLINE_COLS.PROCESSED + 1, transSheet.getMaxColumns());
    data = lastRow > 0 && wantCols > 0
      ? transSheet.getRange(1, 1, lastRow, wantCols).getValues()
      : [];
  }
  var context = null;   // built on FIRST matching row — most sweeps find nothing
  var maxPer = Math.max(1, Math.min(20, parseInt(cfg.max_per_sweep, 10) || 6));
  // THE FLOOR IS A NUMBER OF DAYS, resolved to an instant once per pass.
  var maxAgeDays = Math.max(1, parseInt(cfg.max_age_days, 10) || HOTLINE_MAX_AGE_DAYS);
  var floorMs = Date.now() - maxAgeDays * 86400000;
  var processed = 0, itemsTotal = 0, kindsAll = [], simulated = [];
  var firstRefusal = '';
  var toLearn = [];   // coined request types, learned after the pass (hotlineLearnAfterPass_)
  // THE LOG HANDLE IS BUILT AT FIRST USE, exactly like `context` below it.
  var log = null;
  var filedSet = null;   // the audit's filed calls, read at the first openable row with an id

  // WHY THE GRID IS STILL READ IN FULL, EVERY PASS — and what would change it.
  census.scanned = Math.max(0, data.length - 1);
  // THE CAP COUNTS ATTEMPTS, NOT SUCCESSES.
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!hotlineTeamMatch_(row[HOTLINE_COLS.TEAM], cfg.team_phone)) continue;
    if (String(row[HOTLINE_COLS.PROCESSED] || '').trim()) continue;   // theirs or ours — owned
    var transcript = String(row[HOTLINE_COLS.TRANSCRIPT] || '').trim();
    // AN EMPTY CELL ON ONE OF OUR OWN ROWS IS NOT NOTHING — it is a call this lane cannot read.
    if (!transcript) { census.no_transcript++; continue; }
    var callId = String(row[HOTLINE_COLS.CALL_ID] || '');
    // AN ODD TIMESTAMP CELL MUST NOT TAKE THE WHOLE PASS DOWN.
    var callTs = '';
    try {
      if (row[HOTLINE_COLS.EVENT_TS]) {
        var when = new Date(row[HOTLINE_COLS.EVENT_TS]);
        if (!isNaN(when.getTime())) callTs = when.toISOString();
      }
    } catch (eD) { callTs = ''; }
    var reportingDate = callTs ? Utilities.formatDate(new Date(callTs), 'America/New_York', 'yyyy-MM-dd') : '';
    // BEHIND THE FLOOR IS THE SEALED LANE'S WORK, not this one's.
    var callMs = callTs ? Date.parse(callTs) : NaN;
    var behindFloor = !!(callMs && !isNaN(callMs) && callMs < floorMs);
    // FILED IS FILED: a call the audit holds as processed — the fast path files before the inbox row lands — is…
    if (callId && !behindFloor && !filedSet) {
      try {
        var logRead = hubTabSheet_(HOTLINE_LOG_TAB);
        filedSet = hotlineFiledCallIds_(logRead);
        census.filed_set = logRead ? 'read' : 'none';
      } catch (eF) { filedSet = {}; census.filed_set = 'unreadable'; }
    }
    if (callId && !behindFloor && filedSet[callId] === true) {
      if (!simulate) hotlineReconcileRow_(transSheet, i + 1);
      census.reconciled++;
      continue;
    }
    census.candidates++;
    if (behindFloor) { census.held++; continue; }

    var callerPhone = String(row[HOTLINE_COLS.PARTICIPANTS] || '');

    // THE CAP IS TESTED HERE, against a call this pass would really have opened — asked at the top of the loop it…
    if (census.attempted >= maxPer) { census.capped = true; break; }
    // AND THE CLOCK IS ASKED BEFORE A CALL IS OPENED, never inside one — the first call included, and again once…
    if (Date.now() - passStartedMs > HOTLINE_OPEN_BUDGET_MS) {
      census.capped = true; census.out_of_time = true; break;
    }

    // THE CLAIM, before anything is read for the call.
    var ownsClaim = false;
    if (callId) {
      var claim = simulate ? hotlineClaimPeek_(callId) : hotlineClaim_(callId, fast ? 'call' : 'sweep');
      if (claim === 'filed') {
        if (!simulate) hotlineReconcileRow_(transSheet, i + 1);
        census.reconciled++;
        continue;
      }
      if (claim === 'busy') { census.claimed_elsewhere++; continue; }
      if (claim === 'cache') { census.claim_unreadable++; continue; }
      if (!simulate && claim !== 'claimed') { census.lock_busy++; continue; }
      ownsClaim = claim === 'claimed';
    }

    if (!context) {
      context = hotlineContext_();
      census.request_types = HOTLINE_REQUEST_TYPES_FROM;
      census.note_categories = HOTLINE_NOTE_CATEGORIES_FROM;
      census.timing.context_ms = Date.now() - passStartedMs;
      if (Date.now() - passStartedMs > HOTLINE_OPEN_BUDGET_MS) {
        if (ownsClaim) hotlineClaimRelease_(callId);   // not opened, so not ours to hold
        census.capped = true; census.out_of_time = true; break;
      }
    }
    census.attempted++;

    var userPayload = JSON.stringify({
      transcript: transcript,
      client_names: context.clientNames,
      staff_names: context.staffNames,
      call_id: callId || null,
      caller_phone: callerPhone || null,
      call_timestamp: callTs || null,
      reporting_date: reportingDate || null,
      location_names: context.locationNames,
      request_types: context.requestTypes,
      daily_note_categories: context.noteCategories
    });
    // The configured prompt first, then the rules the code owns about types and daily notes — AFTER it, because the…
    var ask = cfg.prompt + hotlineRequestTypeRule_(context.requestTypes) + hotlineDailyNoteRule_() +
      hotlineClientRule_() +
      '\n\nRespond ONLY with valid NDJSON. One JSON object per line. No markdown, no commentary.' +
      '\n\nINPUT:\n' + userPayload;

    // THE LINE THIS WHOLE ACTION WAS SILENT BEHIND.
    var res = null;
    try { res = screenAiChat_(ask, 0.1, 'ai_hotline_manager'); }
    catch (eA) { res = { ok: false, error: 'threw(' + String((eA && eA.message) || eA).slice(0, 90) + ')' }; }
    census.timing.model_ms = Date.now() - passStartedMs;
    if (!res || !res.ok) {
      var why = str_(res && res.error) || 'the model returned no answer';
      census.blocked++;
      if (!firstRefusal) firstRefusal = why;
      if (!simulate) hotlineLogBlocked_(callId, callerPhone, why);
      if (ownsClaim) hotlineClaimRelease_(callId);   // unfiled: the next pass may open it
      continue;
    }

    var items = hotlineParseNdjson_(res.content);
    if (simulate) {
      simulated.push({ call_id: callId, caller: callerPhone, items: items });
      processed++;
      continue;   // a rehearsal writes nothing and marks nothing
    }

    var kinds = [];
    // THE INBOX'S OWN FACTS OUTRANK THE MODEL'S ECHO OF THEM.
    var facts = hotlineCallFacts_(callId, callTs, items);
    // EVERY ITEM IS READ INTO ITS ROW FIRST, AND NOTHING IS WRITTEN UNTIL ALL OF THEM ARE.
    var noteRows = [], incidentRows = [], requests = [], callOffOrdinal = 0, psiOrdinal = 0;
    for (var j = 0; j < items.length; j++) {
      var item = items[j] || {};
      var wt = String(item.work_type || '');
      try {
        if (wt === 'DailyNote') {
          // ONE ROW PER CATEGORY, as the old processor wrote them: the model is told so, and a category off the…
          noteRows.push({
            timestamp: facts.at,
            call_id: facts.call_id,
            reporting_date: str_(item.reporting_date) || reportingDate,
            dsp_name: str_(item.dsp_name),
            caller_phone: str_(item.caller_phone) || callerPhone,
            client_name: hotlineClientName_(item.client_name, context.clientNames),
            category: hotlineNoteCategory_(item.category, context.noteCategories),
            response: str_(item.response)
          });
        } else if (wt === 'Incident') {
          incidentRows.push({
            // The incidents sheet has no call column, so this instant IS the link: the screen pairs a row with the…
            timestamp: facts.at,
            your_name: str_(item['Your Name']),
            client_name: hotlineClientName_(item['Client Name'], context.clientNames),
            incident_category: str_(item['Incident Category']),
            incident_location: str_(item['Incident Location']),
            incident_date: str_(item['Incident Date']),
            incident_time: str_(item['Incident Time']),
            incident_reported_date: str_(item['Incident Reported Date']) || reportingDate,
            incident_reported_time: str_(item['Incident Reported Time']),
            employees_involved: str_(item['Employees Involved']),
            summary_of_incident: str_(item['Summary of Incident']),
            immediate_action_taken: str_(item['Immediate Action Taken']),
            cause_and_contributing_factors: str_(item['Cause and Contributing Factors']),
            prevention_plan: str_(item['Prevention Plan'])
          });
        } else if (wt === 'Request') {
          // WHEN THE TRANSCRIPT COULD NOT HEAR A NAME, ASK THE NUMBER.
          var reqPhone = str_(item['Requestor Phone']) || callerPhone;
          var reqWho = contactNameFill_(str_(item['Requestor']), reqPhone);
          // ONE SPELLING ON THE ROW.
          var reqType = hotlineRequestTypeCanon_(item['Type of Request'], context.requestTypes);
          var isCallOff = hotlineRequestTypeKey_(reqType) === hotlineRequestTypeKey_(HOTLINE_CALL_OFF_TYPE);
          if (isCallOff) reqType = HOTLINE_CALL_OFF_TYPE;
          // IS THIS SOMEBODY REPORTING THAT PSI ANYWHERE IS NOT WORKING?
          var psiSaw = psiRead_(reqType, str_(item['Description of Request']));
          var psiVerdict = null, psiNote = '';
          if (psiSaw.verdict === 'outage') {
            try { psiVerdict = psiHanded || psiRelayVerdict_(); } catch (ePsi) { psiVerdict = null; }
            psiNote = psiVerdict ? psiProofNote_(psiVerdict) : '';
          }
          // A PROVEN OUTAGE IS THE ONE URGENCY THIS PLATFORM MAY RAISE ITSELF.
          var reqUrgency = str_(item['Urgency']) || 'Low';
          if (psiVerdict && psiVerdict.state === 'down') reqUrgency = 'High';
          requests.push({
            item: item, who: reqWho, type: reqType, callOff: isCallOff,
            // THE VERDICT TRAVELS TO THE SPEAKING LANE ON THE SAME RECORD, so the row that landed and the message…
            psi: psiVerdict,
            psiInstance: psiVerdict ? (callId || 'call') + ':psi:' + (psiOrdinal++) : '',
            // THE PAGE'S IDENTITY IS THE CALL AND WHICH OF ITS CALL OFFS THIS IS — never the item's position among…
            instance: isCallOff ? (callId || 'call') + ':calloff:' + (callOffOrdinal++) : '',
            row: {
              status: str_(item['Status']) || 'New',
              urgency: reqUrgency,
              date_received: str_(item['Date Received']) || reportingDate,
              requestor: reqWho.name,
              requestor_phone: reqPhone,
              type_of_request: reqType,
              description_of_request: str_(item['Description of Request']),
              // HOW THE ROW LEARNED THE NAME, on every row — a reader must never have to guess whether the person…
              notes: hotlineCallStamp_(
                psiNote ? hotlineNameNote_(reqWho) + ' ' + psiNote : hotlineNameNote_(reqWho),
                facts.call_id)
            }
          });
        } else {
          kinds.push(wt || '?');
        }
      } catch (eW) {
        // The row is still marked below, on purpose — the call HAS been read and re-reading it would file…
        census.item_failures++;
        kinds.push(wt + '!failed');
      }
    }

    var queued = hotlineEstateAppendRows_('supportQueue', requests.map(function (r) { return r.row; }));
    // AND SOMEBODY IS TOLD ABOUT A REQUEST (package 3: a new support request is paged to the support leads).
    if (!simulate && queued.landed) {
      try {
        if (typeof commSupportFiled_ === 'function') {
          var asked = requests.slice(0, queued.landed)
            .filter(function (r) { return r && !r.callOff; })
            .map(function (r) { return r.row; });
          if (asked.length) commSupportFiled_(asked, { callId: callId });
        }
      } catch (eSup) {
        hubSysLog_('asa-hub:hotline', 'support_page_failed',
                   String((eSup && eSup.message) || eSup), { status: 500 });
      }
    }
    if (!simulate && queued.landed && typeof supportDeskFiled_ === 'function') { try { supportDeskFiled_(requests.slice(0, queued.landed).map(function (r) { return r.row; }), { callId: callId }); } catch (eSd) {} }
    for (var q = 0; q < requests.length; q++) {
      var rq = requests[q], rqItem = rq.item, rqWho = rq.who;
      // A queue row that did not land is not a call off anybody may be paged about: nothing on the queue says it…
      if (q >= queued.landed) { census.item_failures++; kinds.push('Request!failed'); continue; }
      try {
        // The row has landed; a type nobody listed is WRITTEN DOWN to become vocabulary once the pass is marked and…
        if (!rq.callOff) hotlineLearnQueue_(toLearn, rq.type, facts.call_id, context.requestTypes);
        if (rq.callOff) {
          var loc = hotlineLocation_(rqItem, context.locationNames);
          var mgr = hotlineHouseManager_(loc);
          // callOffs lives in its own data HOUSE — the generic writer rides the seam, mints the id and the trio…
          var coRow = createRow_('callOffs', {
            timestamp: new Date().toISOString(),
            employee_name: rqWho.name,
            date: str_(rqItem['Date Received']) || reportingDate,
            type: 'Call Off',
            notes: str_(rqItem['Description of Request']),
            your_name: 'Auto-processed (Hub)',
            call_id: facts.call_id,
            name_from: rqWho.from
          });
          if (coRow && coRow.error) throw new Error(coRow.error.message);
          // THE CALL-OFF IS ANSWERED IN THIS SAME EXECUTION (CommCallOff.gs).
          commCallOffRecorded_({
            employee_name: rqWho.name,
            name_from: rqWho.from,
            type: 'Call Off',
            date: str_(rqItem['Date Received']) || reportingDate
          }, rq.instance, 'hotline', {
            manager: mgr ? (mgr.name + (mgr.phone ? ' ' + hubPhoneE164_(mgr.phone) : '')) : '',
            house: loc || '',
            // THE REASON, WORD FOR WORD — for the 5558 group ALONE: the reason goes only to the directors and the…
            reason: str_(rqItem['Description of Request']),
            // THE DAY IT IS ABOUT, read out of the same words as a DATE and nothing else: 'Date Received' is the…
            shift_day: commCallOffShiftDayFrom_(str_(rqItem['Description of Request']),
                                                commCallOffDate_(str_(rqItem['Date Received']) || reportingDate)),
            day_from_call: true
          });
          // THE NOTIFICATION IS A SITUATION — Smart Comms decides who hears it and on which channel; nothing here…
          hotlineCallOffQueue_({
            instance: rq.instance,
            employee: (rqWho.from ? rqWho.name : '') || 'Unknown employee',
            date: str_(rqItem['Date Received']) || reportingDate,
            reason: str_(rqItem['Description of Request']) || 'No reason given',
            location: loc || 'unknown location',
            manager: mgr ? (mgr.name + (mgr.phone ? ' ' + hubPhoneE164_(mgr.phone) : '')) : ''
          });
          try {
            if (typeof schedulingCallOffHeard_ === 'function') {
              var schedCallDay = commCallOffDate_(str_(rqItem['Date Received']) || reportingDate);
              schedulingCallOffHeard_({ source: 'hotline', instance: rq.instance, employee: rqWho.name,
                                        name_from: rqWho.from, call_day: schedCallDay,
                                        shift_day: commCallOffShiftDayFrom_(str_(rqItem['Description of Request']),
                                                                            schedCallDay) });
            }
          } catch (eSched) {}
        }
        // AND THE CALLER WHO REPORTED PSI ANYWHERE DOWN IS ANSWERED IN THIS SAME EXECUTION (CommPsi.gs), with the…
        if (rq.psi) {
          commPsiReported_({
            requestor: rqWho.name,
            name_from: rqWho.from,
            date_received: str_(rqItem['Date Received']) || reportingDate
          }, rq.psiInstance, rq.psi);
        }
        kinds.push('Request');
      } catch (eQ) {
        census.item_failures++;
        kinds.push('Request!failed');
      }
    }

    // The incidents sheet has no call column: every row of the call carries the call's instant, and they land…
    var filedIncidents = hotlineEstateAppendRows_('uiIncidents', incidentRows);
    for (var x = 0; x < incidentRows.length; x++) {
      if (x < filedIncidents.landed) kinds.push('Incident');
      else { census.item_failures++; kinds.push('Incident!failed'); }
    }
    // AND SOMEBODY IS TOLD (the rule: when an incident is filed, Ty Bond hears by text and by e-mail, and the house…
    if (!simulate && filedIncidents.landed) {
      try {
        if (typeof commIncidentFiled_ === 'function') {
          var paged = commIncidentFiled_(incidentRows.slice(0, filedIncidents.landed),
                                         { callId: callId, nowIso: new Date().toISOString() });
          if (paged && paged.told) kinds.push('IncidentPaged:' + paged.told);
          else if (paged && paged.state && paged.state !== 'quiet') kinds.push('Incident' + paged.state);
        }
      } catch (eIn) {
        hubSysLog_('asa-hub:hotline', 'incident_page_failed',
                   String((eIn && eIn.message) || eIn), { status: 500 });
      }
    }
    if (!simulate && filedIncidents.landed && typeof supportDeskIncidents_ === 'function') { try { supportDeskIncidents_(incidentRows.slice(0, filedIncidents.landed), 'hotline'); } catch (eSd) {} }

    // The notes, folded to one row per client and category and never more than HOTLINE_NOTE_ROWS_MAX of them — what…
    var notePlan = hotlineNoteRows_(noteRows, HOTLINE_NOTE_ROWS_MAX);
    census.notes_merged += notePlan.merged;
    census.notes_capped += notePlan.capped;
    var filedNotes = hotlineEstateAppendRows_('dailyNotes', notePlan.rows);
    for (var y = 0; y < notePlan.rows.length; y++) {
      if (y < filedNotes.landed) kinds.push('DailyNote');
      else { census.item_failures++; kinds.push('DailyNote!failed'); }
    }
    if (notePlan.capped) kinds.push('+' + notePlan.capped + ' capped');

    // OWN THE ROW — the same cell the legacy marks, so neither side ever processes it twice — and audit it on our…
    if (transSheet) transSheet.getRange(i + 1, HOTLINE_COLS.PROCESSED + 1).setValue('Yes');
    // The audit line is one call's only durable mark when it came through the webhook door; the claim says filed…
    try {
      if (!log) log = hotlineLogSheet_();   // the handle, built where it is used
      log.appendRow([callId, new Date().toISOString(), callerPhone,
                     items.length, kinds.join(','), 'processed', str_(res.via)]);
      census.timing.filed_ms = Date.now() - passStartedMs;
    } finally {
      if (callId) {
        hotlineClaimFiled_(callId);
        if (filedSet) filedSet[callId] = true;
      }
    }
    // A completion moved the tab's last line, so the refusal memo above is stale — dropped rather than guessed at.
    HOTLINE_LOG_LAST_KEY = null;
    processed++;
    itemsTotal += items.length;
    kindsAll = kindsAll.concat(kinds);
  }

  // The situations the loop queued ride the SAME sweep the rest of the platform's escalations ride — one tail at a…
  if (!simulate && kindsAll.length) {
    var tailToken = hotlineTailTake_(HOTLINE_TAIL_WAIT_MS);
    try { smartEventSweep_({}); } catch (eSm) { /* the rows stand; the next sweep sends */ }
    finally { hotlineTailRelease_(tailToken); }
  }

  // AND OUR OWN COPY OF WHAT WAS JUST FILED — what is ours has to be in our own database.
  if (!simulate && kindsAll.length && typeof laneMirrorAfterFiling_ === 'function') {
    try {
      laneMirrorAfterFiling_(['uiIncidents', 'supportQueue', 'dailyNotes']);
    } catch (eMi) {
      hubSysLog_('asa-hub:hotline', 'lane_mirror_failed',
                 String((eMi && eMi.message) || eMi), { status: 200 });
    }
  }

  // Every call is marked and audited and every page is on its way; only now does a coined type become vocabulary…
  if (!simulate && toLearn.length) {
    // A learner that threw learned nothing it can vouch for: every type it was handed is counted as not learned…
    var grown = { learned: [], deferred: toLearn.length, capped: 0 };
    try { grown = hotlineLearnAfterPass_(toLearn, passStartedMs); } catch (eG) { /* counted above */ }
    census.types_learned = grown.learned.length;
    census.types_deferred = grown.deferred;
    census.types_capped = grown.capped || 0;
    if (grown.deferred > 0) {
      hubSysLog_('asa-hub:hotline', 'hotline_type_deferred', String(grown.deferred),
                 { status: 503, message: 'the pass used its time before ' + grown.deferred +
                   ' coined type(s) could be learned; the next call that coins one collects it again' });
    }
    if (census.types_capped > 0) {
      hubSysLog_('asa-hub:hotline', 'hotline_type_capped', String(census.types_capped),
                 { status: 429, message: 'the pass learned its ' + HOTLINE_LEARN_MAX_PER_PASS +
                   ' new type(s); ' + census.types_capped +
                   ' more wait for the next call that coins one' });
    }
  }

  // ONE CALL FILED BY THE WEBHOOK DOOR owns the shared cell too, once its tail has run — never the inbox before the…
  if (fast && !simulate && processed > 0) {
    census.inbox_marked = hotlineInboxMark_(census.call_id);
  }

  census.processed = processed;
  census.items = itemsTotal;
  census.kinds = kindsAll;
  if (simulate) {
    // THE REHEARSAL TOLD THE SAME LIE, on a screen.
    census.simulate = true;
    census.calls = simulated.length;
    census.items = simulated;
    if (!processed && census.blocked > 0) {
      return hotlineDone_(502, 'blocked',
        'The rehearsal could not read ' + census.blocked + ' waiting call(s): ' + firstRefusal);
    }
    if (!processed && census.out_of_time) {
      return hotlineDone_(502, 'out_of_time',
        'The rehearsal ran out of time before it could open a waiting call.');
    }
    return hotlineDone_(200, processed ? 'rehearsed'
                             : (census.claimed_elsewhere > 0 ? 'claimed_elsewhere'
                             : (census.reconciled > 0 ? 'already_filed'
                             : (census.held > 0 ? 'held_only' : 'nothing_new'))));
  }
  // WHICH ZERO IS THIS?
  if (processed > 0) return hotlineDone_(200, census.capped ? 'processed_capped' : 'processed');
  if (census.blocked > 0) {
    return hotlineDone_(502, 'blocked',
      'The hotline could not read ' + census.blocked + ' waiting call(s): ' + firstRefusal);
  }
  // A PASS THAT RAN OUT OF CLOCK BEFORE IT OPENED A SINGLE WAITING CALL is a zero it could not help, and a lane…
  if (census.out_of_time) {
    return hotlineDone_(502, 'out_of_time',
      'The hotline ran out of time before it could open a waiting call; the next pass opens it.');
  }
  // A LANE THAT DOES NOT KNOW ITS OWN ORDERS IS A THIRD KIND OF ZERO.
  if (census.config === 'unreadable') {
    return hotlineDone_(502, 'config_unreadable',
      'The hotline could not read hotline_config and had no held copy — this pass ran on shipped defaults.');
  }
  // THE CLAIM'S THREE ZEROS.
  var claimLeft = hotlineClaimLeft_(census, fast);
  if (claimLeft) return hotlineDone_(claimLeft.status, 'lock_busy', claimLeft.message);
  if (census.claimed_elsewhere > 0) return hotlineDone_(200, 'claimed_elsewhere');
  if (census.reconciled > 0) return hotlineDone_(200, 'already_filed');
  // BEHIND THE FLOOR, AND WAITING ON THE PHONE SYSTEM, are the two zeros that are neither a failure nor an empty…
  if (census.held > 0) return hotlineDone_(200, 'held_only');
  if (census.no_transcript > 0) return hotlineDone_(200, 'awaiting_transcript');
  return hotlineDone_(200, 'nothing_new');
};

// The queued call-off situations of the last two days — the smart comms subject rows.
var HOTLINE_CALLOFF_TAB = 'hotline_calloff_queue';
var HOTLINE_CALLOFF_HEADER = ['instance', 'employee', 'date', 'reason', 'location', 'manager', 'queued_at'];

function hotlineCallOffQueue_(row) {
  // A queue written before a column existed still has to grow it; a fresh tab was stamped with the whole header…
  var existed = !!hubTabSheet_(HOTLINE_CALLOFF_TAB);
  var sheet = hubTabEnsure_(HOTLINE_CALLOFF_TAB, HOTLINE_CALLOFF_HEADER);
  if (existed) ensureHeader_(sheet, HOTLINE_CALLOFF_HEADER);
  sheet.appendRow([str_(row.instance), str_(row.employee), str_(row.date),
                   str_(row.reason).slice(0, 300), str_(row.location), str_(row.manager),
                   new Date().toISOString()]);
}

/** Subject rows for smartEventSweep_ — recent queue rows, id'd per call-off. */
function hotlineSmartSubjects_() {
  var floor = Date.now() - 2 * 86400000;
  var out = [];
  try {
    readTabNormalized_(hubTabWorkbook_(HOTLINE_CALLOFF_TAB), HOTLINE_CALLOFF_TAB).forEach(function (r) {
      var t = Date.parse(str_(r.queuedat));
      if (!t || t < floor) return;
      out.push({ id: str_(r.instance), instance: str_(r.instance),
                 employee: str_(r.employee), date: str_(r.date),
                 reason: str_(r.reason), location: str_(r.location),
                 manager: str_(r.manager) });
    });
  } catch (e) { /* no queue yet */ }
  return out;
}
