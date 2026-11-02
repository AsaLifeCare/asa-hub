// ------------------------------------------------------------------ LINE DIRECTORY — the company's own phone…
// This tree answers THREE different phone-line questions and had one hand-typed array of four ten-digit strings to…

// ------------------------------------------------------------- the rungs THE RUNGS, CHEAPEST FIRST, AND WHY EACH…

// The last good directory, as JSON.
var LINE_DIR_PROP = 'HUB_LINE_DIRECTORY';

// The shared read cache.
var LINE_DIR_CACHE_KEY = 'hub_line_directory_v1';

// SIX HOURS, WHICH IS CacheService's OWN CEILING (21600s) — and the clocks it has to beat are why the ceiling is…
var LINE_DIR_CACHE_SECONDS = 21600;

// Past this, the stored copy still ANSWERS and says it is old.
var LINE_DIR_STALE_HOURS = 72;

// HOW LONG A SHUT ROAD STAYS SHUT before anybody knocks again.
var LINE_DIR_FAIL_KEY = 'hub_line_directory_shut_v1';
var LINE_DIR_FAIL_SECONDS = 900;

// NEVER A LINE, whatever any source says.
var LINE_DIR_NEVER = ['3303440430'];

// SEATS THAT ARE NOT PEOPLE.
var LINE_DIR_SERVICE_SEATS = ['abd documents', 'asa tech', 'asatech',
                              'automations', 'api', 'integration'];

// THE DECLARED ROLES — the half no database knows; owners come from the provider.
var LINE_ROLE_WORDS = {
  '3307544040': 'Manager',
  '3309195558': 'Software Specialist',
  '3309195559': 'Administration',
  '3309197595': 'HR-Administration',
  '3309197779': 'Director',
  '9377166410': 'Director'
};

/** Held for THIS execution, so the several readers in one pass parse once. */
var LINE_DIR_MEMO_ = null;

/* ------------------------------------------------------------------ keys */

// The same key every other reader of a phone number in this repo computes: digits, last ten.
function hubLineKey_(v) {
  var d = String(v == null ? '' : v).replace(/\D+/g, '');
  if (d.length >= 11 && d.charAt(0) === '1') d = d.slice(1);
  d = d.slice(-10);
  return d.length === 10 ? d : '';
}

// A provider line id ('PNmUmHyA17').
function hubLineIsProviderId_(v) {
  return /^PN[A-Za-z0-9]{6,}$/.test(String(v == null ? '' : v).trim());
}

// The declared shared lines, asked and never copied.
function hubLineSharedFloor_() {
  try {
    if (typeof hubSharedLineDigits_ === 'function') return hubSharedLineDigits_();
  } catch (e) { /* fall through to the declaration itself */ }
  var out = [];
  if (typeof SHARED_LINE_DIGITS !== 'undefined' && SHARED_LINE_DIGITS) {
    for (var i = 0; i < SHARED_LINE_DIGITS.length; i++) {
      var k = hubLineKey_(SHARED_LINE_DIGITS[i]);
      if (k && out.indexOf(k) === -1) out.push(k);
    }
  }
  return out;
}

/* --------------------------------------------------------- the two shapes */

// One row, from whichever source produced it.
function hubLineRowBuild_(id, number, name, users, forwardTo) {
  var digits = hubLineKey_(number);
  if (!digits) return null;
  if (LINE_DIR_NEVER.indexOf(digits) !== -1) return null;
  var seats = 0, humans = 0, ownerNamed = '', firstHuman = '', people = [];
  (users || []).forEach(function (u) {
    var nm = String((u && (u.name || ((String((u && u.firstName) || '') + ' ' +
              String((u && u.lastName) || '')).trim()) || u.email)) || '').trim();
    seats++;
    if (!nm) return;
    var isSeat = LINE_DIR_SERVICE_SEATS.indexOf(nm.toLowerCase()) !== -1;
    var role = String((u && u.role) || '').toLowerCase();
    people.push({ name: nm, role: role, service: isSeat });
    if (isSeat) return;
    humans++;
    if (!firstHuman) firstHuman = nm;
    // THE PROVIDER'S OWN WORD, OR NOTHING.
    if (role === 'owner' && !ownerNamed) ownerNamed = nm;
  });
  var owner = ownerNamed || (humans === 1 ? firstHuman : '');
  return {
    digits: digits,
    e164: '+1' + digits,
    id: String(id || ''),
    name: String(name || ''),
    owner: owner,
    people: people,
    seats: seats,
    humans: humans,
    forward_to: hubLineKey_(forwardTo),
    role: '',
    role_known: false,
    shared: false,
    shared_why: ''
  };
}

// The forward, whatever shape it arrives in.
function hubLineForward_(p) {
  if (!p) return '';
  var v = p.forwardTo || p.forward || p.forwarding || '';
  if (v && typeof v === 'object') v = v.to || v.number || v.phoneNumber || '';
  return String(v || '');
}

/** The provider's /v1/phone-numbers payload → rows. */
function hubLineFromProvider_(data) {
  var out = [];
  ((data && data.data) || []).forEach(function (p) {
    var row = hubLineRowBuild_(p && p.id, p && p.number, p && p.name,
                               (p && p.users) || [], hubLineForward_(p));
    if (row) out.push(row);
  });
  return out;
}

// The platform's asa_openphone_lines rows → the same shape.
function hubLineFromPlatform_(rows) {
  var out = [];
  (rows || []).forEach(function (r) {
    var users = (r && (r.assigned_users || r.users)) || [];
    if (typeof users === 'string') {
      try { users = JSON.parse(users); } catch (e) { users = []; }
    }
    var row = hubLineRowBuild_(r && r.id, r && r.number, r && r.name,
                               users, (r && r.forward_to) || hubLineForward_(r));
    if (row) out.push(row);
  });
  return out;
}

/* ------------------------------------------------------------ the verdict */

// SHARED, DERIVED — and derived from three facts, not from a seat count.
function hubLineDeriveShared_(rows) {
  var floor = hubLineSharedFloor_();
  var forwardTargets = {};
  (rows || []).forEach(function (r) {
    if (r.forward_to) forwardTargets[r.forward_to] = r.digits;
  });
  (rows || []).forEach(function (r) {
    var why = [];
    if (r.humans > 1) why.push(r.humans + ' people hold it');
    if (forwardTargets[r.digits]) why.push('+1' + forwardTargets[r.digits] + ' forwards to it');
    if (floor.indexOf(r.digits) !== -1) why.push('declared a shared line');
    r.shared = why.length > 0;
    r.shared_why = why.join(' · ');
    r.forwards_from = forwardTargets[r.digits] || '';
    var word = LINE_ROLE_WORDS[r.digits];
    r.role = word ? String(word) : '';
    r.role_known = !!word;
  });
  return rows;
}

/* -------------------------------------------------------------- the store */

function hubLineStored_() {
  var raw = '';
  try { raw = String(hubProp_(LINE_DIR_PROP) || ''); } catch (e) { raw = ''; }
  if (!raw) return null;
  var got = null;
  try { got = JSON.parse(raw); } catch (eJ) { return null; }
  if (!got || !got.lines || !got.lines.length) return null;
  return got;
}

function hubLineStore_(dir) {
  try { hubPropSet_(LINE_DIR_PROP, JSON.stringify(dir)); } catch (e) { /* the cache still answers */ }
  try {
    CacheService.getScriptCache().put(LINE_DIR_CACHE_KEY, JSON.stringify(dir), LINE_DIR_CACHE_SECONDS);
  } catch (eC) { /* the property still answers */ }
  // The road is open again: forget that it was shut, or a fifteen-minute refusal would outlive the recovery that…
  try { CacheService.getScriptCache().remove(LINE_DIR_FAIL_KEY); } catch (eF) { /* it expires anyway */ }
}

// THE ROAD IS SHUT, REMEMBERED.
function hubLineRoadShut_() {
  try { return !!CacheService.getScriptCache().get(LINE_DIR_FAIL_KEY); }
  catch (e) { return false; }
}
function hubLineRoadShutNote_(why) {
  try {
    CacheService.getScriptCache().put(LINE_DIR_FAIL_KEY, String(why || 'shut').slice(0, 200),
                                      LINE_DIR_FAIL_SECONDS);
  } catch (e) { /* no cache: we simply knock again, which is the old behaviour */ }
}
function hubLineRoadShutWhy_() {
  try { return String(CacheService.getScriptCache().get(LINE_DIR_FAIL_KEY) || ''); }
  catch (e) { return ''; }
}

/** How old the copy is, in hours, or -1 when it cannot be told. */
function hubLineAgeHours_(at) {
  var t = new Date(String(at || '')).getTime();
  if (isNaN(t)) return -1;
  return Math.max(0, Math.round((new Date().getTime() - t) / 36000) / 100);
}

/* ------------------------------------------------------------ the fetches */

/** The provider, once. Never logs or returns the key. */
function hubLineProviderFetch_() {
  var key = '';
  try {
    key = String(hubProp_(typeof SCRAPER_OPENPHONE_PROP !== 'undefined'
      ? SCRAPER_OPENPHONE_PROP : 'OPENPHONE_API_KEY') || '');
  } catch (eK) { key = ''; }
  if (!key) return { ok: false, why: 'no OPENPHONE_API_KEY in Script Properties' };
  var res;
  try {
    res = UrlFetchApp.fetch('https://api.openphone.com/v1/phone-numbers',
      { method: 'get', headers: { Authorization: key }, muteHttpExceptions: true });
  } catch (e) {
    return { ok: false, why: 'the provider was unreachable: ' + String((e && e.message) || e) };
  }
  if (res.getResponseCode() !== 200) {
    return { ok: false, why: 'the provider answered ' + res.getResponseCode() };
  }
  var got = null;
  try { got = JSON.parse(res.getContentText() || '{}'); } catch (eJ) {
    return { ok: false, why: 'the provider answered something that is not JSON' };
  }
  var rows = hubLineFromProvider_(got);
  if (!rows.length) {
    // A list with no lines in it is not a company with no lines.
    return { ok: false, why: 'the provider listed no lines — refused rather than stored as "we own none"' };
  }
  return { ok: true, rows: rows };
}

/* ------------------------------------------------------------ the answer */

// THE DIRECTORY.
function hubLines_(force) {
  if (!force && LINE_DIR_MEMO_) return LINE_DIR_MEMO_;

  if (!force) {
    var hit = '';
    try { hit = CacheService.getScriptCache().get(LINE_DIR_CACHE_KEY) || ''; } catch (eC) { hit = ''; }
    if (hit) {
      try {
        var cached = JSON.parse(hit);
        if (cached && cached.lines && cached.lines.length) {
          LINE_DIR_MEMO_ = cached;
          return cached;
        }
      } catch (eJ) { /* a corrupt cache entry is simply not a cache entry */ }
    }

    // RUNG 1, WHICH USED TO BE RUNG 4.
    var held = hubLineStored_();
    if (held) {
      var heldAge = hubLineAgeHours_(held.at);
      if (heldAge >= 0 && heldAge <= (LINE_DIR_CACHE_SECONDS / 3600)) {
        // `source` IS WHERE THIS ANSWER CAME FROM, NOT WHERE THE FACTS WERE BORN.
        var warm = {
          ok: true, at: held.at, source: 'stored', stored_from: held.source || '',
          stale: false, why: 'the copy stored ' + heldAge + ' hour(s) ago, inside the refresh window',
          lines: hubLineDeriveShared_(held.lines)
        };
        try {
          CacheService.getScriptCache().put(LINE_DIR_CACHE_KEY, JSON.stringify(warm),
                                            LINE_DIR_CACHE_SECONDS);
        } catch (eP) { /* the property answered; the cache is an optimisation */ }
        LINE_DIR_MEMO_ = warm;
        return warm;
      }
    }

    // AND WE DO NOT KNOCK ON A DOOR THAT JUST REFUSED.
    if (held && hubLineRoadShut_()) {
      var shutAge = hubLineAgeHours_(held.at);
      var shutOut = {
        ok: false, at: held.at, source: 'stored', stored_from: held.source || '',
        stale: shutAge < 0 || shutAge > LINE_DIR_STALE_HOURS,
        why: (hubLineRoadShutWhy_() || 'the provider refused') +
             ' — not asked again for ' + LINE_DIR_FAIL_SECONDS + 's; answering with the copy stored ' +
             (shutAge < 0 ? 'at an unreadable time' : shutAge + ' hour(s) ago'),
        lines: hubLineDeriveShared_(held.lines)
      };
      LINE_DIR_MEMO_ = shutOut;
      return shutOut;
    }
  }

  var got = hubLineProviderFetch_();
  if (got.ok) {
    var fresh = {
      ok: true, at: new Date().toISOString(), source: 'provider', stale: false, why: '',
      lines: hubLineDeriveShared_(got.rows)
    };
    hubLineStore_(fresh);
    LINE_DIR_MEMO_ = fresh;
    return fresh;
  }

  // THE ROAD WAS SHUT.
  hubLineRoadShutNote_(got.why);
  var stored = hubLineStored_();
  if (stored) {
    var age = hubLineAgeHours_(stored.at);
    var out = {
      ok: false, at: stored.at, source: 'stored',
      stale: age < 0 || age > LINE_DIR_STALE_HOURS,
      why: got.why + ' — answering with the copy stored ' +
           (age < 0 ? 'at an unreadable time' : age + ' hour(s) ago'),
      lines: hubLineDeriveShared_(stored.lines)
    };
    LINE_DIR_MEMO_ = out;
    return out;
  }

  // NOTHING STORED EITHER.
  var floorRows = [];
  hubLineSharedFloor_().forEach(function (d) {
    floorRows.push({
      digits: d, e164: '+1' + d, id: '', name: '', owner: '', people: [],
      seats: 0, humans: 0, forward_to: '', forwards_from: '',
      role: LINE_ROLE_WORDS[d] ? String(LINE_ROLE_WORDS[d]) : '',
      role_known: !!LINE_ROLE_WORDS[d],
      shared: true, shared_why: 'declared a shared line'
    });
  });
  var floorOut = {
    ok: false, at: '', source: 'declaration', stale: true,
    why: got.why + ' — and nothing was stored, so only the declared shared ' +
         'lines answer. This is NOT the list of lines we own.',
    lines: floorRows
  };
  LINE_DIR_MEMO_ = floorOut;
  return floorOut;
}

/* ----------------------------------------------------------- the readers */

// One line, by its digits OR by its provider id.
function hubLineRow_(v) {
  var raw = String(v == null ? '' : v).trim();
  if (!raw) return null;
  var dir = hubLines_();
  var key = hubLineKey_(raw);
  for (var i = 0; i < dir.lines.length; i++) {
    if (key && dir.lines[i].digits === key) return dir.lines[i];
    if (!key && dir.lines[i].id && dir.lines[i].id === raw) return dir.lines[i];
  }
  return null;
}

// (C) IS THIS ONE OF OUR OWN LINES — every line we hold, shared or personal.
function hubLineOurs_(v) {
  var key = hubLineKey_(v);
  if (!key) return false;
  var dir = hubLines_();
  for (var i = 0; i < dir.lines.length; i++) if (dir.lines[i].digits === key) return true;
  return false;
}

// (B) DOES THIS NUMBER NAME A PERSON — false when it does.
function hubLineSharedForIdentity_(v) {
  var key = hubLineKey_(v);
  if (!key) return false;
  if (hubLineSharedFloor_().indexOf(key) !== -1) return true;
  var row = null;
  try { row = hubLineRow_(key); } catch (e) { row = null; }
  return !!(row && row.shared);
}

// (A) WHO OWNS THIS LINE — a NAME, or ''.
function hubLineWho_(v) {
  var row = hubLineRow_(v);
  // `person` IS THE ONLY FIELD A SCREEN MAY PUT NEXT TO A CALL.
  if (!row) return { name: '', role: '', owner: '', person: '', shared: false, known: false };
  var person = '';
  try { person = hubLinePersonForCall_(row.digits); } catch (e) { person = ''; }
  return { name: row.name, role: row.role, owner: row.owner, person: person,
           shared: !!row.shared, known: true };
}

// The org answer, safe for (B): the owner's name ONLY when one human holds a line that nothing forwards to and…
function hubLinePersonForCall_(v) {
  if (hubLineSharedForIdentity_(v)) return '';
  // AND A COPY NOBODY COULD CHECK DOES NOT NAME PEOPLE.
  var dir = null;
  try { dir = hubLines_(); } catch (eD) { dir = null; }
  if (!dir || (!dir.ok && dir.stale)) return '';
  var row = hubLineRow_(v);
  if (!row || row.humans !== 1) return '';
  return row.owner || '';
}

// HOW A HUMAN READS A LINE IN A REPORT.
function hubLineLabel_(v) {
  var raw = String(v == null ? '' : v).trim();
  var row = hubLineRow_(raw);
  if (!row) {
    if (hubLineIsProviderId_(raw)) return raw + ' · a provider line id we could not resolve';
    if (!raw) return '(no line)';
    var key = hubLineKey_(raw);
    if (!key) return raw;
    // A FAILED LOOK IS NOT A NEGATIVE FINDING.
    var dir = null;
    try { dir = hubLines_(); } catch (eD) { dir = null; }
    if (!dir || !dir.ok) {
      return '+1' + key + ' · not in the copy we could read (' +
             ((dir && dir.source) || 'nothing answered') + ') — NOT a line we know we do not own';
    }
    return '+1' + key + ' · not one of our lines';
  }
  var bits = [row.e164];
  if (row.name) bits.push(row.name);
  if (row.role) bits.push(row.role);
  else if (row.owner) bits.push('owner ' + row.owner + ' · role not named');
  if (row.shared) bits.push('shared — ' + row.shared_why);
  return bits.join(' · ');
}

/* ------------------------------------------------------ the line to send from */

/** The line a word names: id, number, provider name, then role; a role held by two lines names neither. Never throws. */
function hubLineSenderMatch_(rows, word) {
  var w = String(word == null ? '' : word).trim();
  if (!w) return { line: null, why: 'no line was named' };
  var list = [];
  (rows || []).forEach(function (r) {
    if (!r) return;
    var digits = hubLineKey_(r.number || r.digits || r.e164 || '');
    list.push({ row: r, id: String(r.id || ''), digits: digits, name: String(r.name || '').trim(),
                role: String(r.role || (digits && LINE_ROLE_WORDS[digits]) || '').trim() });
  });
  var lower = w.toLowerCase();
  var pick = function (test) {
    var hits = list.filter(test);
    return hits.length === 1 ? hits[0] : (hits.length > 1 ? 'many' : null);
  };
  var byId = hubLineIsProviderId_(w) ? pick(function (l) { return l.id === w; }) : null;
  if (byId && byId !== 'many') return { line: byId.row, via: 'id' };
  var key = hubLineKey_(w);
  if (key) {
    var byNum = pick(function (l) { return l.digits === key; });
    if (byNum && byNum !== 'many') return { line: byNum.row, via: 'number' };
    return { line: null, why: 'no line of ours has the number ' + w };
  }
  var byName = pick(function (l) { return l.name && l.name.toLowerCase() === lower; });
  if (byName === 'many') return { line: null, why: 'more than one of our lines is called "' + w + '"' };
  if (byName) return { line: byName.row, via: 'name' };
  var byRole = pick(function (l) { return l.role && l.role.toLowerCase() === lower; });
  if (byRole === 'many') {
    return { line: null, why: '"' + w + '" is the role of more than one of our lines — name the line ' +
                              'by its number instead' };
  }
  if (byRole) return { line: byRole.row, via: 'role' };
  return { line: null, why: 'no line of ours answers to "' + w + '"' };
}

/** May a `from_line` cell hold this word — { ok, why, names }. */
function hubLineSenderKnown_(word) {
  var w = String(word == null ? '' : word).trim();
  if (!w) return { ok: true, why: '', names: [] };
  var dir = null;
  try { dir = hubLines_(); } catch (e) { dir = null; }
  var rows = (dir && dir.lines) || [];
  var m = hubLineSenderMatch_(rows, w);
  var names = [];
  rows.forEach(function (r) {
    var label = r.role || r.name;
    if (label && names.indexOf(label) === -1) names.push(label);
  });
  return { ok: !!m.line, why: m.line ? '' : m.why, names: names };
}

/* ------------------------------------------------------------- the census */

// THE CALLS THAT CARRY NO LINE, COUNTED AND NAMED.
function hubLineCallCensus_() {
  var rows = null;
  try {
    rows = readTabNormalized_(ssOpen_(hubId_('HUB_COMMS_ID')), 'transcripts');
  } catch (e) {
    // MISSING IS NOT ZERO: a census that could not read is not a census of nothing, and it must never be printed as…
    return { ok: false, why: 'the comms mirror could not be read: ' + String((e && e.message) || e),
             calls: 0, by_line: {}, no_line: null };
  }
  var byLine = {}, noLine = { calls: 0, empty: 0, by_provider_id: {}, resolved: 0 };
  (rows || []).forEach(function (t) {
    var raw = String((t && t.quonumber) || '').trim();
    var key = hubLineKey_(raw);
    if (!key) {
      noLine.calls++;
      if (hubLineIsProviderId_(raw)) {
        var row = hubLineRow_(raw);
        var seen = noLine.by_provider_id[raw] ||
                   (noLine.by_provider_id[raw] = { calls: 0, resolves_to: row ? row.e164 : '',
                                                   named: row ? (row.name || row.owner) : '' });
        seen.calls++;
        if (row) { noLine.resolved++; key = row.digits; }
      } else {
        noLine.empty++;
      }
      if (!key) return;
    }
    var L = byLine[key] || (byLine[key] = { calls: 0, label: hubLineLabel_(key),
                                            shared: hubLineSharedForIdentity_(key),
                                            ours: hubLineOurs_(key) });
    L.calls++;
  });
  return {
    ok: true, why: '', window_days: (typeof COMMS_WINDOW_DAYS !== 'undefined' ? COMMS_WINDOW_DAYS : null),
    calls: (rows || []).length, by_line: byLine, no_line: noLine
  };
}

/* ---------------------------------------------------------------- doors */

// `store` IS ONE OF SIX WORDS, not a sentence about the absence of one.
HUB_POLICY.lineDirectory = {
  file: 'LineDirectory.gs', lane: 'read', store: 'external',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { refresh: { required: false, type: 'boolean' },
            census: { required: false, type: 'boolean' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.lineDirectory = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  if (['admin', 'manager'].indexOf(str_(user.role)) === -1) return hubDenied_();
  var dir = hubLines_(!!(payload && payload.refresh));
  var out = {
    ok: dir.ok, source: dir.source, at: dir.at, stale: !!dir.stale, why: dir.why,
    lines: dir.lines, shared_floor: hubLineSharedFloor_(),
    never: LINE_DIR_NEVER
  };
  if (payload && payload.census) out.census = hubLineCallCensus_();
  return { status: 200, data: out };
};

// THE PLATFORM'S COPY, HANDED OVER — asa_openphone_lines rows, the same rows server/line_directory.py builds.
HUB_POLICY.lineDirectorySync = {
  file: 'LineDirectory.gs', lane: 'tool', store: 'external',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  params: { rows: { required: true, type: 'array' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.lineDirectorySync = function (payload, user) {
  var isMachine = !!(user && user.is_service);
  if (!isMachine && (!user || str_(user.role) !== 'admin')) return hubDenied_();
  var rows = payload && payload.rows;
  if (!Array.isArray(rows) || !rows.length) {
    return { status: 400, message: 'No rows — the line directory is left as it is.' };
  }
  var built = hubLineFromPlatform_(rows);
  if (!built.length) {
    return { status: 400, message: 'No row carried a usable number — nothing was stored.' };
  }
  var dir = {
    ok: true, at: new Date().toISOString(), source: 'platform', stale: false,
    why: '', lines: hubLineDeriveShared_(built)
  };
  hubLineStore_(dir);
  LINE_DIR_MEMO_ = dir;
  var shared = dir.lines.filter(function (r) { return r.shared; }).length;
  var half = dir.lines.filter(function (r) { return !r.role_known; }).length;
  try {
    hubSysLog_(isMachine ? 'asa-hub:lines' : str_(user.email), 'line_directory_sync',
      dir.lines.length + ' line(s) from the platform · ' + shared + ' shared · ' +
      half + ' with an owner and no role' +
      (str_(payload.source_at) ? ' · list as of ' + str_(payload.source_at) : ''),
      { status: 200 });
  } catch (eL) { /* the directory landed; the note is not the thing */ }
  return { status: 200, data: { stored: dir.lines.length, shared: shared,
                                role_missing: half, received: rows.length } };
};

// ▶ THE LINES, FOR A HUMAN — every line named, its owner, its role, whether it names anybody, and the calls that…
function runLineDirectory() {
  var dir = hubLines_(true);
  var census = hubLineCallCensus_();
  var out = { ok: dir.ok, source: dir.source, at: dir.at, why: dir.why,
              lines: dir.lines, census: census };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
