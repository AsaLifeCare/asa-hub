// ------------------------------------------------------------------ COMM REPAIR — when the platform owes somebody…
// `commUrgencyBand_` is the urgency of the ITEM — how overdue a credential is.


// ====================================================================== 1 — THE DETECTOR…

// WHAT THE DATA CAN AND CANNOT ANSWER TODAY.

// The three columns the detector reads off the evidence row, named once so the detector, the report and the…
var COMM_REPAIR_NEEDED_COLUMNS = ['words_sha', 'situation', 'sender_used'];

// THE WORDS AS RESOLVED AT SEND TIME, HASHED — and deliberately NOT the delivered body.
function commRepairWordsSha_(situation) {
  var s = situation || {};
  var parts = [
    String(s.id || ''),
    String(s.sms_text || ''),
    String(s.email_subject || ''),
    String(s.email_text || ''),
    commRepairSenderOf_(s)
  // a separator no template carries, so "sender A + body B" can never hash the same as "sender AB + empty body"
  ].join('\n@@|@@\n');
  try {
    if (typeof commRecordId_ === 'function') return commRecordId_(parts);
  } catch (e) { /* the long way below */ }
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, parts);
  var out = '';
  for (var i = 0; i < digest.length && out.length < 16; i++) {
    var b = (digest[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out.toUpperCase();
}

// THE SENDER A SITUATION RESOLVES TO NOW — the situation's own cell, and the code constant only when the cell is…
function commRepairSenderOf_(situation) {
  var cell = String((situation && situation.sender) || '').trim();
  if (cell) return cell;
  try { return (typeof SMART_SENDER_DEFAULT !== 'undefined') ? String(SMART_SENDER_DEFAULT) : ''; }
  catch (e) { return ''; }
}

// THE SITUATION ROW BY ID, WHETHER OR NOT IT IS ON.
function commRepairSituation_(id) {
  var want = String(id || '').trim();
  if (!want) return null;
  var found = null;
  try {
    if (typeof smartSituations_ === 'function') {
      smartSituations_().forEach(function (s) {
        if (String(s.id || '').trim() === want) found = s;
      });
    }
  } catch (e) { found = null; }
  if (found) return found;
  try { return (typeof smartSituationOn_ === 'function') ? smartSituationOn_(want) : null; }
  catch (e2) { return null; }
}

// S1 / S3 — DO PEOPLE HOLD WORDS WE WOULD NO LONGER SAY?
function commRepairDrift_(opts) {
  opts = opts || {};
  var fromMs = commRepairMs_(opts.from, 0);
  var toMs = commRepairMs_(opts.to, new Date().getTime());
  var rows = [];
  try {
    if (typeof commBoardRows_ === 'function' && typeof COMM_ATTEMPTS_HOUSE !== 'undefined') {
      rows = commBoardRows_(COMM_ATTEMPTS_HOUSE) || [];
    }
  } catch (e) { rows = []; }

  var carries = { words_sha: false, situation: false, sender_used: false };
  var inWindow = 0;
  var groups = {};
  rows.forEach(function (r) {
    var at = commRepairMs_(r.at, 0);
    if (!at || at < fromMs || at > toMs) return;
    inWindow++;
    COMM_REPAIR_NEEDED_COLUMNS.forEach(function (c) {
      if (String(r[c] === null || r[c] === undefined ? '' : r[c]).trim()) carries[c] = true;
    });
    var sit = String(r.situation || '').trim();
    if (!sit) return;
    var sha = String(r.words_sha || '').trim();
    var sender = String(r.sender_used || '').trim();
    if (!sha && !sender) return;
    var k = sit + '|' + sha + '|' + sender;
    if (!groups[k]) {
      groups[k] = { situation: sit, words_sha: sha, sender_used: sender,
                    people: {}, first_at: String(r.at || ''), last_at: String(r.at || ''),
                    redirected: 0, test_mode: 0 };
    }
    var g = groups[k];
    if (String(r.redirected || '') === 'yes') { g.redirected++; return; }
    if (String(r.test_mode || '') === 'yes') { g.test_mode++; return; }
    var who = String(r.person_key || '').trim().toLowerCase();
    if (who) g.people[who] = String(r.at || '');
    if (String(r.at || '') < g.first_at) g.first_at = String(r.at || '');
    if (String(r.at || '') > g.last_at) g.last_at = String(r.at || '');
  });

  if (!carries.situation || (!carries.words_sha && !carries.sender_used)) {
    return {
      computable: false,
      attempts_in_window: inWindow,
      needs_columns: COMM_REPAIR_NEEDED_COLUMNS,
      why: 'no attempt row in this window says what was said. The columns (' +
           COMM_REPAIR_NEEDED_COLUMNS.join(', ') + ') exist, but every row here predates them ' +
           'or was written by a caller that did not go through commRecordSend_, and a blank is ' +
           'an unknown rather than an agreement. The audience half (commRepairAudience_) is the ' +
           'honest answer for a window like this: a person declares the situation and the ' +
           'window, and the platform counts exactly who holds it.'
    };
  }

  var changed = [];
  Object.keys(groups).forEach(function (k) {
    var g = groups[k];
    var sit = commRepairSituation_(g.situation);
    if (!sit) return;                                  // a situation we can no longer read proves nothing
    var nowSha = commRepairWordsSha_(sit);
    var nowSender = commRepairSenderOf_(sit);
    var senderMoved = !!(g.sender_used && g.sender_used !== nowSender);
    var wordsMoved = !!(g.words_sha && g.words_sha !== nowSha);
    if (!senderMoved && !wordsMoved) return;
    var people = Object.keys(g.people);
    if (!people.length) return;
    changed.push({
      situation: g.situation,
      audience: people.length,
      people: people,
      window_from: g.first_at, window_to: g.last_at,
      sender_then: g.sender_used, sender_now: nowSender,
      words_sha_then: g.words_sha, words_sha_now: nowSha,
      what_moved: senderMoved ? (wordsMoved ? 'the sender and the words' : 'the sender') : 'the words',
      dropped_redirected: g.redirected, dropped_test: g.test_mode
    });
  });

  return {
    computable: true,
    attempts_in_window: inWindow,
    changed: changed,
    limit: 'this proves the words CHANGED and who holds the old ones. It cannot know the old ' +
           'ones were wrong — a person declares that, and the audience is already counted.'
  };
}

// S1b — THE AUDIENCE, COMPUTABLE TODAY AND WITH NO NEW COLUMN.
function commRepairAudience_(situationId, fromIso, toIso) {
  var want = String(situationId || '').trim();
  var fromMs = commRepairMs_(fromIso, 0);
  var toMs = commRepairMs_(toIso, new Date().getTime());
  var out = { situation: want, from: String(fromIso || ''), to: String(toIso || ''),
              people: [], count: 0,
              dropped: { rehearsal: 0, redirected: 0, test_mode: 0, unkeyed: 0 },
              read: 0 };
  if (!want) return out;

  var seen = {};
  var rows = commRepairLedgerRows_();
  out.read = rows.length;
  rows.forEach(function (r) {
    if (String(r.situation || '').trim() !== want) return;
    var at = commRepairMs_(r.at, 0);
    if (!at || at < fromMs || at > toMs) return;
    if (String(r.channel || '').trim().toLowerCase() === 'rehearsal') { out.dropped.rehearsal++; return; }
    if (String(r.key || '').indexOf('REHEARSAL|') === 0) { out.dropped.rehearsal++; return; }
    var key = commRepairPersonKeyFrom_(r.key, r.person);
    if (!key) { out.dropped.unkeyed++; return; }
    if (seen[key]) return;
    seen[key] = { person_key: key, person_name: String(r.person || ''), at: String(r.at || ''),
                  channel: String(r.channel || '') };
  });

  // THE SECOND FILTER, from our own evidence: a send this lane recorded as redirected or in test mode reached the…
  commRepairAttemptsIn_(want, fromMs, toMs).forEach(function (a) {
    var k = String(a.person_key || '').trim().toLowerCase();
    if (!k || !seen[k]) return;
    if (String(a.redirected || '') === 'yes') { delete seen[k]; out.dropped.redirected++; return; }
    if (String(a.test_mode || '') === 'yes') { delete seen[k]; out.dropped.test_mode++; }
  });

  Object.keys(seen).forEach(function (k) { out.people.push(seen[k]); });
  out.count = out.people.length;
  return out;
}

// WHOSE KEY IS THIS LEDGER ROW?
function commRepairPersonKeyFrom_(rawKey, personName) {
  var key = String(rawKey || '').trim();
  if (key.indexOf('REHEARSAL|') === 0) key = key.slice('REHEARSAL|'.length);
  var parts = key.split('|');
  var candidate = '';
  if (parts[0] === 'CI' && parts.length >= 2) candidate = parts[1];
  else if (parts.length >= 2) candidate = parts[1];
  candidate = String(candidate || '').trim().toLowerCase();
  if (candidate) return candidate;
  try {
    return (typeof clientNameKey_ === 'function') ? String(clientNameKey_(personName) || '') : '';
  } catch (e) { return ''; }
}

// The catalogue's ledger, newest rows only — a bounded read, because this house grows for ever and an incident is…
var COMM_REPAIR_LEDGER_READ = 5000;

function commRepairLedgerRows_() {
  var out = [];
  try {
    if (typeof smartLedgerSheet_ !== 'function') return out;
    var sheet = smartLedgerSheet_();
    var last = sheet.getLastRow();
    if (last < 2) return out;
    var start = Math.max(2, last - (COMM_REPAIR_LEDGER_READ - 1));
    var values = sheet.getRange(start, 1, last - start + 1, 6).getValues();
    values.forEach(function (v) {
      out.push({ key: String(v[0] || ''), situation: String(v[1] || ''), person: String(v[2] || ''),
                 expires: String(v[3] || ''), channel: String(v[4] || ''), at: String(v[5] || '') });
    });
  } catch (e) { /* an unreadable ledger is an empty audience, and it is said out loud */ }
  return out;
}

// Our own evidence rows for a situation in a window.
function commRepairAttemptsIn_(situationId, fromMs, toMs) {
  var out = [];
  try {
    commRepairAttemptRows_().forEach(function (r) {
      var at = commRepairMs_(r.at, 0);
      if (!at || at < fromMs || at > toMs) return;
      var sit = String(r.situation || '').trim();
      if (sit && situationId && sit !== situationId) return;
      out.push(r);
    });
  } catch (e) { /* no evidence is not proof of a clean send, and the caller says so */ }
  return out;
}

// A time, as milliseconds, or the fallback.
function commRepairMs_(v, fallback) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return fallback;
  var ms = Date.parse(s);
  return isNaN(ms) ? fallback : ms;
}

// ====================================================================== 2 — THE INCIDENT, AS A ROW…

// THE INCIDENT IS A ROW, NOT A PERSON, AND NOT A PURPOSE ON THE THREAD.
var COMM_REPAIRS_HOUSE = 'comm_repairs';
var COMM_REPAIRS_HEADER = [
  'id', 'createdAt', 'updatedAt', 'kind',
  // THE INCIDENT
  'incident_id', 'situation', 'window_from', 'window_to', 'what_was_wrong',
  // THE OLD WORDS, AS THEIR OWN IDENTITY.
  'words_sha_then', 'sender_then',
  // `audience` is a COUNT, not a position.
  'state', 'priority', 'audience',
  'declared_by', 'declared_at', 'confirmed_by', 'confirmed_at', 'closed_at', 'note',
  // THE PERSON (kind = person), riding the same house
  'intent_key', 'person_key', 'person_name', 'told_at', 'told_channel',
  // WHICH PATH HOLDS THE CLAIM, and — for path B — the thread whose message carries the line.
  'claim_state', 'claimed_at', 'claim_path', 'claim_host_key', 'attempt_id', 'receipt',
  // TWO MEMORIES, the same law the intent row keeps: a redirected send reached a tester and the real person is…
  'test_claim_state', 'test_claimed_at',
  'undeliverable_why', 'tenant'
];

// An incident's life.
var COMM_REPAIR_STATES = ['candidate', 'declared', 'confirmed', 'closed', 'dismissed'];

// One person's, inside an incident.
var COMM_REPAIR_PERSON_STATES = ['planned', 'claimed', 'repaired', 'undeliverable', 'collapsed'];

// The purpose a correction travels under.
var COMM_REPAIR_PURPOSE = 'correction.owed';

// The situation that carries the words, when one has been written.
var COMM_REPAIR_SITUATION_FLOOR = 'correction_notice';

// The desk's fifth reason.
var COMM_REPAIR_DESK_REASON = 'undeliverable';

// WHAT WAS TAKEN OUT OF THIS FILE, so nobody hunts for a scheduler that no longer exists.

// The cheap question a quiet execution pays: one property read, so the backstop door can return without touching a…
var COMM_REPAIR_OWED_KEY = 'comm_repair_owed';

// PATH A'S HONEST SHAPE, AND THE ONLY NUMBERS THAT DECIDE IT.
var COMM_REPAIR_HEAD_PEOPLE = 3;
var COMM_REPAIR_HEAD_MS = 6 * 1000;

// What one continuation (or one ring of the backstop door) may spend.
var COMM_REPAIR_RUN_MS = 3.5 * 60 * 1000;

// HOW LONG A PROVISIONAL CLAIM BINDS BEFORE IT IS GIVEN BACK.
var COMM_REPAIR_CLAIM_TTL_MS = 10 * 60 * 1000;

// ONE CORRECTION PER PERSON PER BREATH, ACROSS INCIDENTS.
var COMM_REPAIR_BREATH_MS = 15 * 60 * 1000;

// THE TESTER'S PHONE IS A GROUP, AND THIS IS THE WHOLE ANSWER TO IT.
var COMM_REPAIR_TEST_CAP = 1;

// The SMS a joined message may not exceed.
var COMM_REPAIR_LEAD_SMS_MAX = 306;

// The handler name the one-shot continuation carries.
var COMM_REPAIR_WAKE_FN = 'commRepairContinue';

// WHAT PRIORITY A CORRECTION TRAVELS AT — asked of the ladder next door, never decided here.
function commRepairPriority_() {
  try {
    return (typeof commPriorityFor_ === 'function') ? commPriorityFor_(COMM_REPAIR_PURPOSE) : 'ask';
  } catch (e) { return 'ask'; }
}

// A stable id from a stable key, through the lane's own minter when it is loaded.
function commRepairId_(key) {
  try { if (typeof commRecordId_ === 'function') return commRecordId_(key); }
  catch (e) { /* the long way */ }
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(key || ''));
  var out = '';
  for (var i = 0; i < digest.length && out.length < 16; i++) {
    var b = (digest[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out.toUpperCase();
}

// THE THREAD-SHAPED KEY, so a repair rides the evidence and trail houses unchanged.
function commRepairIntentKey_(personKey, incidentId) {
  return String(personKey || '').trim().toLowerCase() + '|repair.' + String(incidentId || '');
}

// The incident id: what was wrong, where, and when — so declaring the same incident twice is one row, and a second…
function commRepairIncidentId_(situation, fromIso, toIso, what) {
  return 'RPI' + commRepairId_([String(situation || ''), String(fromIso || ''),
                                String(toIso || ''), String(what || '')].join('|')).slice(0, 12);
}

// One incident, as the row it becomes.
function commRepairIncidentRow_(incident, nowIso) {
  var id = String(incident.incident_id || '');
  return {
    id: 'RPI_' + commRepairId_(id),
    kind: 'incident',
    incident_id: id,
    situation: String(incident.situation || ''),
    window_from: String(incident.window_from || ''),
    window_to: String(incident.window_to || ''),
    what_was_wrong: String(incident.what_was_wrong || '').slice(0, 500),
    // Blank for an incident a person declared after the fact — that one is found by its window.
    words_sha_then: String(incident.words_sha_then || ''),
    sender_then: String(incident.sender_then || ''),
    state: (COMM_REPAIR_STATES.indexOf(String(incident.state || '')) !== -1)
      ? String(incident.state) : 'candidate',
    priority: commRepairPriority_(),
    audience: Number(incident.audience) || 0,
    declared_by: String(incident.declared_by || ''),
    declared_at: String(incident.declared_at || nowIso || ''),
    note: String(incident.note || '').slice(0, 500)
  };
}

/** One person inside an incident, as the row it becomes. Pure. */
function commRepairPersonRow_(incidentId, person, nowIso) {
  var key = String((person && person.person_key) || '').trim().toLowerCase();
  return {
    id: 'RPP_' + commRepairId_(String(incidentId) + '|' + key),
    kind: 'person',
    incident_id: String(incidentId || ''),
    intent_key: commRepairIntentKey_(key, incidentId),
    person_key: key,
    person_name: String((person && person.person_name) || ''),
    told_at: String((person && person.at) || ''),
    told_channel: String((person && person.channel) || ''),
    claim_state: 'planned',
    createdAt: String(nowIso || '')
  };
}

/** One incident by its id, or null. */
function commRepairIncidentBy_(incidentId) {
  var want = String(incidentId || '');
  if (!want) return null;
  var found = null;
  commRepairRows_().forEach(function (r) {
    if (String(r.kind || '') !== 'incident') return;
    if (String(r.incident_id || '') === want) found = r;
  });
  return found;
}

// Read the house, or nothing.
function commRepairRows_() {
  try {
    if (typeof commBoardRows_ !== 'function') return [];
    return commBoardRows_(COMM_REPAIRS_HOUSE) || [];
  } catch (e) { return []; }
}

// Upsert into the house — and REFUSE to invent it inside HUB_DB.
function commRepairUpsert_(row) {
  var sheet = null;
  try { sheet = (typeof hubTabSheet_ === 'function') ? hubTabSheet_(COMM_REPAIRS_HOUSE) : null; }
  catch (eS) { sheet = null; }
  if (!sheet) {
    var declared = false;
    try { declared = (typeof houseMoved_ === 'function') ? !!houseMoved_(COMM_REPAIRS_HOUSE) : true; }
    catch (eH) { declared = true; }
    if (!declared) {
      throw new Error('`' + COMM_REPAIRS_HOUSE + '` has no house yet. Mint it (the comm houses\' ' +
                      'own tool) before declaring an incident — a tab invented in HUB_DB would be ' +
                      'orphaned the day the pointer answers.');
    }
  }
  sheet = hubTabEnsure_(COMM_REPAIRS_HOUSE, COMM_REPAIRS_HEADER);
  var found = findRowIndex_(sheet, row.id);
  row.updatedAt = new Date().toISOString();
  if (!found) row.createdAt = row.createdAt || row.updatedAt;
  var header = ensureHeader_(sheet, Object.keys(row));
  if (!found) {
    sheet.appendRow(header.map(function (h) { return serialize_(row[h]); }));
    return true;
  }
  // A ROW HERE HAS TWO OWNERS — the pass owns what it planned, a person owns what they declared.
  var range = sheet.getRange(found, 1, 1, header.length);
  var existing = range.getValues()[0];
  range.setValues([header.map(function (h, i) {
    return Object.prototype.hasOwnProperty.call(row, h) ? serialize_(row[h]) : existing[i];
  })]);
  return true;
}

// THE CHEAP QUESTION, AND THE ONLY ONE A QUIET EXECUTION PAYS.
function commRepairStamp_(rows) {
  var n = 0;
  try {
    (rows || commRepairRows_()).forEach(function (r) {
      if (String(r.kind || '') !== 'person') return;
      var state = String(r.claim_state || 'planned');
      if (state === 'planned' || state === 'claimed') n++;
    });
  } catch (e) { return -1; }
  try { PropertiesService.getScriptProperties().setProperty(COMM_REPAIR_OWED_KEY, String(n)); }
  catch (e2) { /* the force door is the way back */ }
  return n;
}

function commRepairOwedCount_() {
  try {
    return Number(PropertiesService.getScriptProperties().getProperty(COMM_REPAIR_OWED_KEY) || 0) || 0;
  } catch (e) { return 0; }
}

// ====================================================================== 3 — ONCE-NESS…

// THE MARK THAT MAKES "NEVER BOTH" TRUE, AND IT IS A CLAIM RATHER THAN A FLAG.
function commRepairClaim_(incidentId, personKey, test, nowIso, path, hostKey) {
  var id = 'RPP_' + commRepairId_(String(incidentId || '') + '|' +
                                  String(personKey || '').trim().toLowerCase());
  var lock = null;
  try { lock = LockService.getScriptLock(); } catch (eL) { lock = null; }
  // NO LOCK, NO CLAIM.
  if (!lock) return false;
  try { if (!lock.tryLock(20000)) return false; } catch (eT) { return false; }
  try {
    var row = null;
    commRepairRows_().forEach(function (r) { if (String(r.id || '') === id) row = r; });
    if (!row) return false;                             // nothing planned for this person
    var stateCol = test ? 'test_claim_state' : 'claim_state';
    var atCol = test ? 'test_claimed_at' : 'claimed_at';
    var current = String(row[stateCol] || 'planned');
    if (current !== 'planned' && current !== '') return false; // claimed, told, collapsed, or a person's job
    var next = { id: id };
    next[stateCol] = 'claimed';
    next[atCol] = String(nowIso || new Date().toISOString());
    next.claim_path = String(path || 'A');
    next.claim_host_key = String(hostKey || '');
    try { commRepairUpsert_(next); return true; }
    catch (e) { return false; }
  } finally {
    try { lock.releaseLock(); } catch (eR) { /* the execution ending releases it */ }
  }
}

// SETTLING A PROVISIONAL CLAIM — the other half of "never both", and the half that keeps a failure from swallowing…
function commRepairSettle_(row, nowMs) {
  var out = { id: String((row && row.id) || ''), changed: false, to: '', why: '' };
  if (!row || String(row.kind || '') !== 'person') return out;
  // WHICHEVER MEMORY HOLDS THE CLAIM.
  var test = false;
  if (String(row.claim_state || 'planned') === 'claimed') test = false;
  else if (String(row.test_claim_state || 'planned') === 'claimed') test = true;
  else return out;
  out.test = test;
  if (String(row.claim_path || 'A') !== 'B') return out;     // path A settles itself, in its own breath
  var hostKey = String(row.claim_host_key || '');
  var since = commRepairMs_(test ? row.test_claimed_at : row.claimed_at, 0);
  var age = (nowMs || new Date().getTime()) - (since || 0);
  var ev = hostKey ? commRepairHostEvidence_(hostKey, since) : null;

  var fields = {};
  if (!ev) {
    if (age < COMM_REPAIR_CLAIM_TTL_MS) { out.why = 'in flight'; return out; }
    out.changed = true; out.to = 'planned';
    out.why = 'the line was rendered and no send followed it — the host message never reached the ' +
              'transport, so nothing was said and the debt stands';
    fields.note = out.why;
  } else if (String(ev.redirected || '') === 'yes' || String(ev.test_mode || '') === 'yes') {
    // IT REACHED THE TESTERS.
    out.changed = true; out.to = test ? 'repaired' : 'planned';
    out.why = 'the host message was redirected to the testers' +
              (test ? ' — which is what test mode is, and the real person is still owed'
                    : ' — the person was never told');
    if (test) { fields.told_at = String(ev.at || ''); fields.told_channel = 'rehearsal'; }
    else fields.note = out.why;
  } else if (String(ev.doubt || '') === 'yes') {
    out.changed = true; out.to = 'repaired';
    out.why = 'in doubt: ' + String(ev.error || '') + ' — it may have landed, and a correction is ' +
              'never said twice';
    fields.told_at = String(ev.at || ''); fields.told_channel = String(ev.channel || '');
    fields.attempt_id = String(ev.id || ''); fields.undeliverable_why = out.why;
  } else if (String(ev.receipt || '')) {
    out.changed = true; out.to = 'repaired';
    out.why = 'it rode the front of a message that landed — no extra message, which is the point ' +
              'of this path';
    fields.told_at = String(ev.at || ''); fields.told_channel = String(ev.channel || '');
    fields.attempt_id = String(ev.id || ''); fields.receipt = String(ev.receipt || '');
  } else {
    out.changed = true; out.to = 'planned';
    out.why = 'the host message was refused (' + (String(ev.error || '') || 'no receipt') +
              ') — nothing was said, and the front of the next message carries it';
    fields.note = out.why;
  }
  if (!out.changed) return out;
  fields.claim_path = ''; fields.claim_host_key = '';
  commRepairMark_(String(row.incident_id || ''), String(row.person_key || ''), out.to, fields, test);
  return out;
}

// Settle every provisional claim in a set of rows, and answer the rows as they now stand.
function commRepairSettleAll_(rows, nowMs) {
  var at = nowMs || new Date().getTime();
  (rows || []).forEach(function (r) {
    var res = commRepairSettle_(r, at);
    if (!res.changed) return;
    r[res.test ? 'test_claim_state' : 'claim_state'] = res.to;
    if (res.to === 'planned') {
      r.claim_path = ''; r.claim_host_key = '';
      r[res.test ? 'test_claimed_at' : 'claimed_at'] = '';
    }
  });
  return rows || [];
}

// The evidence house, read ONCE per execution.
var COMM_REPAIR_ATTEMPTS_MEMO = null;

function commRepairAttemptRows_() {
  if (COMM_REPAIR_ATTEMPTS_MEMO) return COMM_REPAIR_ATTEMPTS_MEMO;
  var rows = [];
  try {
    if (typeof commBoardRows_ === 'function' && typeof COMM_ATTEMPTS_HOUSE !== 'undefined') {
      rows = commBoardRows_(COMM_ATTEMPTS_HOUSE) || [];
    }
  } catch (e) { rows = []; }
  COMM_REPAIR_ATTEMPTS_MEMO = rows;
  return rows;
}

// The evidence row a host thread left behind at or after a moment, newest first.
function commRepairHostEvidence_(intentKey, sinceMs) {
  var want = String(intentKey || '');
  if (!want) return null;
  var best = null;
  try {
    commRepairAttemptRows_().forEach(function (r) {
      if (String(r.intent_key || '') !== want) return;
      var at = commRepairMs_(r.at, 0);
      // A MINUTE OF SLACK, because the claim is written before the send and two clocks (the script's and the…
      if (!at || at < (sinceMs || 0) - 60000) return;
      if (!best || at >= commRepairMs_(best.at, 0)) best = r;
    });
  } catch (e) { return null; }
  return best;
}

// WHAT THIS PERSON IS STILL OWED, SETTLED AND IN ORDER — the one question both paths ask before they speak, and the…
function commRepairOwedFor_(personKey, rows, nowMs) {
  var key = String(personKey || '').trim().toLowerCase();
  var out = [];
  if (!key) return out;
  var all = commRepairSettleAll_(rows || commRepairRows_(), nowMs);
  var confirmed = {};
  all.forEach(function (r) {
    if (String(r.kind || '') === 'incident' && String(r.state || '') === 'confirmed') {
      confirmed[String(r.incident_id || '')] = r;
    }
  });
  all.forEach(function (r) {
    if (String(r.kind || '') !== 'person') return;
    if (String(r.person_key || '').trim().toLowerCase() !== key) return;
    if (String(r.claim_state || 'planned') !== 'planned') return;
    var inc = confirmed[String(r.incident_id || '')];
    if (!inc) return;                                   // declared but not confirmed says nothing to anybody
    out.push({ person: r, incident: inc,
               at: commRepairMs_(inc.confirmed_at || inc.declared_at || inc.createdAt, 0) });
  });
  out.sort(function (a, b) { return a.at - b.at; });
  return out;
}

// WAS THIS PERSON TOLD ANYTHING BY THIS LANE IN THE LAST BREATH?
function commRepairInBreath_(personKey, rows, nowMs) {
  var key = String(personKey || '').trim().toLowerCase();
  var at = nowMs || new Date().getTime();
  var hit = false;
  (rows || []).forEach(function (r) {
    if (hit) return;
    if (String(r.kind || '') !== 'person') return;
    if (String(r.person_key || '').trim().toLowerCase() !== key) return;
    var told = commRepairMs_(r.told_at, 0);
    if (told && (at - told) < COMM_REPAIR_BREATH_MS) hit = true;
  });
  return hit;
}

// THE ENDING OF ONE PERSON'S REPAIR.
function commRepairMark_(incidentId, personKey, state, fields, test) {
  if (COMM_REPAIR_PERSON_STATES.indexOf(String(state)) === -1) return false;
  var id = 'RPP_' + commRepairId_(String(incidentId || '') + '|' +
                                  String(personKey || '').trim().toLowerCase());
  var row = { id: id };
  row[test ? 'test_claim_state' : 'claim_state'] = String(state);
  Object.keys(fields || {}).forEach(function (k) { row[k] = fields[k]; });
  try { commRepairUpsert_(row); return true; }
  catch (e) { return false; }
}

// ====================================================================== 4 — CAN THIS PERSON BE REACHED AT ALL?

// THE ROUTE FOR A CORRECTION — every gate an ask passes, asked the same way.
function commRepairReachable_(personKey, people, routes, consent, channels, nowMs) {
  var person = (typeof commRecordContact_ === 'function')
    ? commRecordContact_(people, routes, personKey) : null;
  if (!person || (!person.phone && !person.email)) {
    return { ok: false, why: 'no contact in the People house — a person has to find them' };
  }
  var refused = (typeof commRecordRefused_ === 'function') ? commRecordRefused_(person) : {};
  if (refused && (refused.sms || refused.email)) {
    var wrong = commRepairWrongNumber_(person);
    if (wrong) {
      return { ok: false, person: person,
               why: 'suppressed as a wrong number — the likeliest person to have received ' +
                    'something not meant for them, and the one we may not text. A person owes ' +
                    'them this, on the desk.' };
    }
  }
  var route = (typeof commRouteFor_ === 'function')
    ? commRouteFor_((consent || {})[String(personKey || '').trim().toLowerCase()] || [],
                    refused, COMM_REPAIR_PURPOSE, channels, nowMs)
    : { ok: false, why: 'no consent reader' };
  if (!route.ok) return { ok: false, person: person, why: route.why, tried: route.tried };
  return { ok: true, person: person, channel: route.channel, why: route.why, tried: route.tried };
}

/** Was this person suppressed because the number was ours to get wrong? */
function commRepairWrongNumber_(person) {
  try {
    var tab = (typeof OPT_OUT_TAB !== 'undefined') ? OPT_OUT_TAB : 'entity_opt_outs';
    var keys = {};
    if (person && person.phone && typeof optOutKey_ === 'function') keys[optOutKey_(person.phone)] = 1;
    if (person && person.email && typeof optOutKey_ === 'function') keys[optOutKey_(person.email)] = 1;
    var hit = false;
    (commBoardRows_(tab) || []).forEach(function (r) {
      if (String(r.released_at || '')) return;
      if (!keys[String(r.target_key || '')]) return;
      if (String(r.source || '').trim().toLowerCase() === 'wrong number') hit = true;
    });
    return hit;
  } catch (e) { return false; }
}

// IS THE PURPOSE EVEN DECLARED?
function commRepairPurposeDeclared_() {
  try {
    return (typeof COMM_EMPLOYMENT_PURPOSES !== 'undefined') &&
           COMM_EMPLOYMENT_PURPOSES.indexOf(COMM_REPAIR_PURPOSE) !== -1;
  } catch (e) { return false; }
}

// ====================================================================== 5 — THE WAY OUT…

// THE WORDS A CORRECTION TRAVELS IN — the catalogue's, never this file's.
function commRepairSituationNow_() {
  var sit = null;
  try { sit = (typeof commSituationFor_ === 'function') ? commSituationFor_(COMM_REPAIR_PURPOSE) : null; }
  catch (e) { sit = null; }
  if (sit) return sit;
  try {
    return (typeof smartSituationOn_ === 'function')
      ? smartSituationOn_(COMM_REPAIR_SITUATION_FLOOR) : null;
  } catch (e2) { return null; }
}

// THE THREAD, AS THE THREE FIELDS EVERY HOUSE IN THIS LANE READS.
function commRepairLight_(incidentId, personKey, personName) {
  var key = String(personKey || '').trim().toLowerCase();
  return {
    intent_key: commRepairIntentKey_(key, incidentId),
    person_key: key,
    person_name: String(personName || ''),
    purpose: COMM_REPAIR_PURPOSE,
    bindings: []
  };
}

// THE SHAPE THE TRANSPORT ALREADY KNOWS — `commDispatchItem_`'s, built for a message that carries no obligation.
function commRepairItem_(light, situation, person, incident) {
  return {
    situation: String((situation && situation.id) || ''),
    // THE HUMAN SENTENCE, CARRIED AS A VARIABLE AND NOTHING MORE.
    correction: String((incident && incident.what_was_wrong) || ''),
    key: 'CI|' + String(light.intent_key || ''),
    name: String(light.person_name || ''),
    name_key: String(light.person_key || ''),
    phone: String((person && person.phone) || ''),
    email: String((person && person.email) || ''),
    credential: String((situation && situation.credential) || ''),
    // A CORRECTION SPEAKS OF NO DEADLINE.
    expires: '', days_left: '',
    channels: (situation && situation.channels && situation.channels.length)
      ? situation.channels : ['email'],
    rehearsal: false, rehearsed: false,
    config: situation,
    intent_key: String(light.intent_key || ''),
    bindings: [], binding_count: 0, raw_bindings: []
  };
}

// MAY WE SPEAK TO THIS PERSON, NOW?
function commRepairVerdict_(light, situation, routes, quiet, ctx) {
  // NO LADDER, NO MESSAGE.
  if (typeof commPlanVerdict_ !== 'function') {
    return { send: false, defer: true, policy: 'blocked',
             reasons: ['the priority ladder could not be asked — nothing is said without it'] };
  }
  var narrowed = null;
  try {
    narrowed = (typeof commCortexWindowFrom_ === 'function')
      ? commCortexWindowFrom_(routes[light.person_key] || null, quiet.from, quiet.to, light.person_key)
      : null;
  } catch (e) { narrowed = null; }
  return commPlanVerdict_(light, {
    priority_id: COMM_REPAIR_PURPOSE,
    situation: String((situation && situation.id) || ''),
    attempts: 0, lastAskedMs: 0, nowMs: ctx.nowMs,
    localHour: ctx.localHour, localDay: ctx.localDay,
    test: ctx.test, quiet: narrowed
  });
}

// AND THEN IT IS SAID — through the lane's one door, and written down three times because three different readers…
function commRepairSay_(incidentId, light, situation, person, route, test, nowIso, labelFor, incident) {
  var item = commRepairItem_(light, situation, person, incident);
  var out;
  try {
    out = commRecordSend_(item, situation, person, route, 0, labelFor);
  } catch (eS) {
    // A THROW IS A DOUBT, the law `commRecordIsDoubt_` already keeps: the provider may have taken it before the…
    out = { sent: false, gated: false, doubt: true, redirected: false,
            channel: String(route && route.channel || ''), receipt: '',
            error: 'threw: ' + String((eS && eS.message) || eS) };
  }
  out.attempt_id = commRecordAttempt_(light, 1, out, test, nowIso);
  try {
    commObserve_(out.sent ? (out.redirected ? 'redirected' : 'sent')
                          : (out.doubt ? 'doubt' : 'held'),
                 light, { attempt: 1, attempt_id: out.attempt_id, channel: out.channel,
                          receipt: out.receipt, error: out.error, incident: incidentId,
                          purpose: COMM_REPAIR_PURPOSE, test_mode: !!test }, 'repair');
  } catch (eO) { /* the person row carries the ending either way */ }
  if (out.sent) {
    try {
      if (typeof smartRecord_ === 'function') {
        var ledgerKey = (out.redirected && typeof smartRehearsalKey_ === 'function')
          ? smartRehearsalKey_(item.key) : item.key;
        smartRecord_(ledgerKey, String(situation.id || ''), item.name, '',
                     out.redirected ? 'rehearsal' : out.channel);
      }
    } catch (eL) { /* recorded on the person row either way */ }
  }
  return out;
}

// A CORRECTION NOBODY CAN BE SENT IS A PERSON'S JOB, AND IT SAYS SO OUT LOUD.
function commRepairEscalate_(incidentId, light, why, test) {
  try {
    commObserve_('needs_human', light,
                 { incident: incidentId, reason: COMM_REPAIR_DESK_REASON,
                   why: String(why || '').slice(0, 300), test_mode: !!test }, 'repair');
  } catch (e) { /* the row carries it */ }
  try {
    hubSysLog_('asa-hub:comm', 'comm_repair_undeliverable',
               (String(light.person_name || '') || String(light.person_key || '')) +
               ' holds words we have since corrected and cannot be told by message: ' +
               String(why || '') + ' · incident ' + String(incidentId || '') +
               ' — a person owes them this',
               { status: 500 });
  } catch (e2) { /* the row and the trail carry it */ }
}

// ====================================================================== 6 — THE TWO PATHS…

// THERE ARE EXACTLY TWO WAYS A CORRECTION REACHES SOMEBODY, AND A PERSON TAKES ONE OR THE OTHER — NEVER BOTH.

// S1c — THE AUDIENCE OF A KNOWN VERSION, WHICH NEEDS NO WINDOW AT ALL.
function commRepairAudienceBySha_(situationId, wordsSha, senderUsed) {
  var want = String(situationId || '').trim();
  var sha = String(wordsSha || '').trim();
  var sender = String(senderUsed || '').trim();
  var out = { situation: want, words_sha: sha, sender_used: sender,
              people: [], count: 0, read: 0,
              dropped: { redirected: 0, test_mode: 0, unknown_words: 0, unkeyed: 0 } };
  if (!want || (!sha && !sender)) return out;
  var seen = {};
  try {
    commRepairAttemptRows_().forEach(function (r) {
      out.read++;
      if (String(r.situation || '').trim() !== want) return;
      var rowSha = String(r.words_sha || '').trim();
      var rowSender = String(r.sender_used || '').trim();
      if (!rowSha && !rowSender) { out.dropped.unknown_words++; return; }
      // THE DIGEST DECIDES WHEN IT EXISTS, and the sender only when it does not: the digest already includes the…
      var holds = sha ? (rowSha === sha) : (rowSender === sender);
      if (!holds) return;
      if (String(r.redirected || '') === 'yes') { out.dropped.redirected++; return; }
      if (String(r.test_mode || '') === 'yes') { out.dropped.test_mode++; return; }
      // A SEND THAT NEVER LANDED IS NOT AN AUDIENCE.
      if (!String(r.receipt || '') && String(r.error || '') && String(r.doubt || '') !== 'yes') return;
      var key = String(r.person_key || '').trim().toLowerCase();
      if (!key) { out.dropped.unkeyed++; return; }
      if (!seen[key]) seen[key] = { person_key: key, person_name: '', at: String(r.at || ''),
                                    channel: String(r.channel || '') };
    });
  } catch (e) { return out; }
  Object.keys(seen).forEach(function (k) { out.people.push(seen[k]); });
  out.count = out.people.length;
  return out;
}

// The earliest moment anybody in an audience was told.
function commRepairEarliest_(people) {
  var best = '';
  (people || []).forEach(function (p) {
    var at = String((p && p.at) || '');
    if (!at) return;
    if (!best || at < best) best = at;
  });
  return best;
}

// The audience of an incident, by whichever question it can answer: the exact digest when the save discovered it…
function commRepairAudienceOf_(incident) {
  var sha = String((incident && incident.words_sha_then) || '');
  var sender = String((incident && incident.sender_then) || '');
  if (sha || sender) {
    return commRepairAudienceBySha_(String(incident.situation || ''), sha, sender);
  }
  return commRepairAudience_(String((incident && incident.situation) || ''),
                             String((incident && incident.window_from) || ''),
                             String((incident && incident.window_to) || ''));
}

// ---------------------------------------------------------------------- 6a — THE ENGINE BOTH PATHS' FAST HALF…

// EVERYTHING ONE EXECUTION NEEDS IN ORDER TO SPEAK, READ ONCE.
function commRepairContext_(opts) {
  opts = opts || {};
  var now = new Date();
  var tz = Session.getScriptTimeZone();
  var ctx = {
    now: now, nowIso: now.toISOString(), nowMs: now.getTime(),
    // THE BUDGET CLOCK STARTS WHEN THE READING IS DONE, at the bottom of this function.
    startedAt: now.getTime(),
    budgetMs: Number(opts.budgetMs) || COMM_REPAIR_RUN_MS,
    maxPeople: Number(opts.maxPeople) || 0,          // 0 = as many as the budget allows
    said: 0, spoken: {},
    // THE LOCAL CLOCK IS THE PLATFORM'S, exactly as the compliance lane reads it: this file must not guess…
    localHour: Number(Utilities.formatDate(now, tz, 'H')),
    localDay: Number(Utilities.formatDate(now, tz, 'u')) % 7,   // Sunday = 0
    people: (typeof commRecordPeople_ === 'function') ? commRecordPeople_() : {},
    routes: (typeof commRecordRoutes_ === 'function') ? commRecordRoutes_() : {},
    consent: (typeof commRecordConsentRows_ === 'function') ? commRecordConsentRows_() : {},
    purposeOk: commRepairPurposeDeclared_(),
    test: (typeof commTestMode_ === 'function') ? commTestMode_() : false,
    dial: (typeof commDial_ === 'function') ? commDial_() : 'off'
  };
  // THE HOURS ARE READ ONCE, AND NOT SENDING IS THE FALLBACK.
  ctx.hoursOk = (typeof commPolicy_ === 'function');
  ctx.quiet = ctx.hoursOk ? { from: commPolicy_('quiet_from'), to: commPolicy_('quiet_to') } : {};
  // THE ONE DOOR, ASKED FOR ONCE.
  ctx.canSay = ctx.hoursOk && (typeof commRecordSend_ === 'function');
  // THE WORDS OF THE CORRECTION, not the words that were wrong.
  ctx.situation = commRepairSituationNow_();
  ctx.channels = (ctx.situation && typeof commRecordChannels_ === 'function')
    ? commRecordChannels_(ctx.situation) : ['sms', 'email'];
  ctx.labelFor = function (id) {
    // The catalogue's one door (Certs.gs) — config first, shipped floor behind.
    return (typeof certLabels_ === 'function' && certLabels_()[id]) ? certLabels_()[id] : '';
  };
  ctx.startedAt = new Date().getTime();
  ctx.read_ms = ctx.startedAt - ctx.nowMs;
  return ctx;
}

// Has this execution spent what it was given?
function commRepairSpent_(ctx) {
  if (ctx.maxPeople && ctx.said >= ctx.maxPeople) return true;
  return (new Date().getTime() - ctx.startedAt) > ctx.budgetMs;
}

// ONE INCIDENT, CARRIED AS FAR AS THIS EXECUTION CAN CARRY IT.
function commRepairDeliver_(incident, ctx, known, stats) {
  var incidentId = String(incident.incident_id || '');
  var audience = commRepairAudienceOf_(incident);
  var existing = known[incidentId] || {};
  var testSaid = 0;

  // WHAT THE TESTERS ALREADY HEARD ABOUT THIS INCIDENT.
  if (ctx.test) {
    Object.keys(existing).forEach(function (k) {
      var st = String(existing[k].test_claim_state || '');
      if (st === 'claimed' || st === 'repaired') testSaid++;
    });
  }

  for (var i = 0; i < audience.people.length; i++) {
    if (commRepairSpent_(ctx)) { stats.left_for_later++; continue; }
    var who = audience.people[i];
    var key = String(who.person_key || '').trim().toLowerCase();
    if (!key) continue;
    if (!who.person_name && ctx.people[key]) who.person_name = String(ctx.people[key].name || '');
    var had = existing[key] || null;

    // THE ONCE-NESS AND THE RESUME ARE THE SAME ROW.
    if (had) {
      var prod = String(had.claim_state || 'planned');
      var mine = String(had[ctx.test ? 'test_claim_state' : 'claim_state'] || 'planned');
      if ((prod && prod !== 'planned') || (mine && mine !== 'planned')) { stats.already++; continue; }
    }

    // THE ROUTE IS RESOLVED ONCE PER PERSON and serves both halves: the row that says whether they can be reached…
    var reach = ctx.purposeOk
      ? commRepairReachable_(key, ctx.people, ctx.routes, ctx.consent, ctx.channels, ctx.nowMs) : null;

    if (!had) {
      var row = commRepairPersonRow_(incidentId, who, ctx.nowIso);
      // AN UNDECLARED PURPOSE IS OUR FAULT, NOT THE PERSON'S.
      if (!ctx.purposeOk) {
        try { commRepairUpsert_(row); stats.planned++; } catch (eW0) { break; }
        existing[key] = row;
        continue;
      }
      if (!reach.ok) {
        row.claim_state = 'undeliverable';
        row.undeliverable_why = String(reach.why || '').slice(0, 300);
        try { commRepairUpsert_(row); stats.undeliverable++; }
        catch (eW1) { break; /* one person failing must not cost the incident */ }
        existing[key] = row;
        commRepairEscalate_(incidentId, commRepairLight_(incidentId, key, who.person_name),
                            reach.why, ctx.test);
        continue;
      }
      row.told_channel = String(reach.channel || '');
      try { commRepairUpsert_(row); stats.planned++; } catch (eW2) { break; }
      existing[key] = row;
      had = row;
    } else if (ctx.purposeOk && !reach.ok) {
      // PLANNED ONCE, UNREACHABLE NOW — an opt-out arrived, or the contact went away.
      commRepairMark_(incidentId, key, 'undeliverable',
                      { undeliverable_why: String(reach.why || '').slice(0, 300) }, ctx.test);
      stats.undeliverable++;
      commRepairEscalate_(incidentId, commRepairLight_(incidentId, key, who.person_name),
                          reach.why, ctx.test);
      continue;
    }

    /* ── and then the word itself ──────────────────────────────────────── */
    if (!ctx.purposeOk || !ctx.situation || !ctx.canSay || !reach || !reach.ok) continue;

    // ONE CORRECTION PER PERSON PER BREATH, ACROSS INCIDENTS.
    if (ctx.spoken[key] || commRepairInBreath_(key, ctx.rows, ctx.nowMs)) {
      stats.held_for_breath++;
      commRepairMark_(incidentId, key, 'planned',
                      { note: 'held: this person was told about another incident in the same ' +
                              'breath, and two apologies minutes apart is worse than one late one' },
                      ctx.test);
      continue;
    }

    // THE TESTER'S PHONE IS A GROUP.
    if (ctx.test && testSaid >= COMM_REPAIR_TEST_CAP) {
      commRepairMark_(incidentId, key, 'collapsed',
                      { undeliverable_why: 'test mode: every destination is the testers\' one ' +
                                           'group number, so this incident sends one message and ' +
                                           'no more. This person is still owed the real thing.' },
                      true);
      stats.collapsed++;
      continue;
    }

    var light = commRepairLight_(incidentId, key, who.person_name);
    var verdict = commRepairVerdict_(light, ctx.situation, ctx.routes, ctx.quiet,
                                     { nowMs: ctx.nowMs, localHour: ctx.localHour,
                                       localDay: ctx.localDay, test: ctx.test });
    if (!verdict.send) {
      // TWO SILENCES, COUNTED APART.
      if (String(verdict.policy || '') === 'would send') stats.held_by_dial++;
      else { stats.deferred++; stats.wants_wake = true; }
      continue;
    }
    // CLAIM FIRST, FAIL CLOSED, AND UNDER THE LOCK.
    if (!commRepairClaim_(incidentId, key, ctx.test, ctx.nowIso, 'A', '')) { stats.already++; continue; }
    ctx.said++;
    ctx.spoken[key] = true;
    if (ctx.test) testSaid++;
    var out = commRepairSay_(incidentId, light, ctx.situation, reach.person, reach,
                             ctx.test, ctx.nowIso, ctx.labelFor, incident);
    if (out.sent) {
      stats.said++;
      if (out.redirected) stats.redirected++;
      commRepairMark_(incidentId, key, 'repaired',
                      { told_at: ctx.nowIso, told_channel: String(out.channel || ''),
                        attempt_id: String(out.attempt_id || ''),
                        receipt: String(out.receipt || '') }, ctx.test);
    } else if (out.doubt) {
      // A DOUBT KEEPS THE CLAIM, and the ending is `repaired` with the doubt written on the row: the provider may…
      stats.doubts++;
      commRepairMark_(incidentId, key, 'repaired',
                      { told_at: ctx.nowIso, told_channel: String(out.channel || ''),
                        attempt_id: String(out.attempt_id || ''),
                        undeliverable_why: 'in doubt: ' + String(out.error || '') +
                                           ' — it may have landed, and a correction is never ' +
                                           'said twice' }, ctx.test);
    } else {
      // ONLY ONE KIND OF GATE IS THE PERSON'S.
      var why = String(out.error || 'the transport said no');
      if (out.gated && why !== 'opted_out') {
        stats.gated++;
        commRepairMark_(incidentId, key, 'planned',
                        { note: 'held at the door: ' + why + ' — not said, not spent',
                          claim_path: '', claim_host_key: '' }, ctx.test);
        delete ctx.spoken[key];
        if (ctx.test) testSaid--;
      } else {
        stats.undeliverable++;
        commRepairMark_(incidentId, key, 'undeliverable',
                        { told_channel: String(out.channel || ''),
                          attempt_id: String(out.attempt_id || ''),
                          undeliverable_why: (out.gated ? 'gated: ' : 'refused: ') + why }, ctx.test);
        commRepairEscalate_(incidentId, light, (out.gated ? 'gated: ' : 'refused: ') + why, ctx.test);
      }
    }
  }

  try { commRepairUpsert_({ id: String(incident.id), audience: audience.count || 0 }); }
  catch (eC) { /* the count is a reading, and the person rows are the truth */ }
  return audience;
}

/** A fresh stats sheet, so every caller reports the same words. */
function commRepairStats_() {
  return { incidents: 0, planned: 0, said: 0, redirected: 0, deferred: 0, held_by_dial: 0,
           gated: 0, doubts: 0, undeliverable: 0, already: 0, collapsed: 0,
           held_for_breath: 0, left_for_later: 0, wants_wake: false };
}

// CARRY EVERY CONFIRMED INCIDENT AS FAR AS THIS EXECUTION CAN.
function commRepairRun_(user, opts) {
  opts = opts || {};
  var stats = commRepairStats_();

  // ONE READ OF THE HOUSE FIRST, and everything this run needs taken out of it.
  var all = commRepairSettleAll_(commRepairRows_());
  var incidents = [];
  var known = {};
  all.forEach(function (r) {
    if (String(r.kind || '') === 'incident') {
      if (String(r.state || '') === 'confirmed') incidents.push(r);
      return;
    }
    if (String(r.kind || '') !== 'person') return;
    var inc = String(r.incident_id || '');
    if (!known[inc]) known[inc] = {};
    known[inc][String(r.person_key || '')] = r;
  });
  // THE FRESH ONES FIRST, WHEN THE CALLER NAMED THEM.
  var only = opts.incident_ids || (opts.incident_id ? [opts.incident_id] : null);
  if (only && only.length) {
    var want = {};
    only.forEach(function (x) { want[String(x)] = true; });
    incidents = incidents.filter(function (r) { return want[String(r.incident_id || '')]; });
  }
  if (!incidents.length) {
    commRepairStamp_(all);
    return { status: 200, data: { incidents: 0, still_owed: commRepairOwedCount_(),
                                  note: 'nothing is owed.' } };
  }

  var ctx = commRepairContext_(opts);
  ctx.rows = all;

  for (var n = 0; n < incidents.length; n++) {
    if (commRepairSpent_(ctx)) { stats.left_for_later++; break; }
    commRepairDeliver_(incidents[n], ctx, known, stats);
    stats.incidents++;
  }

  var owed = commRepairStamp_();
  var noWords = !ctx.situation;
  try {
    hubSysLog_(str_(user && user.email) || 'asa-hub:comm', 'comm_repair_run',
               stats.incidents + ' incident(s) · ' + stats.planned + ' owed a word · ' +
               stats.said + ' told' + (stats.redirected ? ' (' + stats.redirected + ' to the testers)' : '') +
               ' · ' + stats.deferred + ' deferred (quiet hours) · ' +
               stats.held_by_dial + ' held by the dial · ' +
               (stats.collapsed ? stats.collapsed + ' collapsed (the testers\' group number) · ' : '') +
               (stats.held_for_breath ? stats.held_for_breath + ' held (a second incident in one breath) · ' : '') +
               (stats.gated ? stats.gated + ' held at the transport door (claim given back) · ' : '') +
               stats.undeliverable + ' undeliverable — a person owes them this · ' +
               (stats.doubts ? stats.doubts + ' in doubt (claim kept) · ' : '') +
               stats.already + ' already spoken for · ' + owed + ' still owed' +
               (noWords ? ' · NO WORDS: no situation carries ' + COMM_REPAIR_PURPOSE +
                          ' and `' + COMM_REPAIR_SITUATION_FLOOR + '` is absent or off' : '') +
               (ctx.test ? ' · TEST MODE: one message per incident to the testers\' group number, ' +
                           'and every real person is still owed' : '') +
               (ctx.purposeOk ? '' : ' · WARNING: ' + COMM_REPAIR_PURPOSE +
                            ' is not in COMM_EMPLOYMENT_PURPOSES — nothing was said to anybody, ' +
                            'because judging the route on that would mark a whole audience ' +
                            'undeliverable for a missing string'),
               { status: (ctx.purposeOk && !noWords) ? 200 : 500 });
  } catch (eL) { /* recorded on the rows either way */ }

  return { status: 200, data: {
    incidents: stats.incidents, planned: stats.planned, said: stats.said,
    redirected: stats.redirected, deferred: stats.deferred, held_by_dial: stats.held_by_dial,
    held_at_the_door: stats.gated, held_for_breath: stats.held_for_breath,
    collapsed: stats.collapsed, doubts: stats.doubts, undeliverable: stats.undeliverable,
    already_spoken_for: stats.already, left_for_later: stats.left_for_later,
    still_owed: owed, wants_wake: stats.wants_wake, read_ms: ctx.read_ms,
    test_mode: ctx.test, dial: ctx.dial, purpose_declared: ctx.purposeOk, words: !noWords,
    priority: commRepairPriority_(),
    note: stats.said
      ? (ctx.test ? 'said — one message per incident, to the testers, and the people are still owed.'
                  : 'said, through the same door as every other message.')
      : 'nothing was said this run — ' +
        (!ctx.purposeOk ? COMM_REPAIR_PURPOSE + ' is not a declared employment purpose'
         : (!ctx.canSay ? 'the lane\'s one transport door could not be asked'
         : (noWords ? 'no situation carries the correction'
         : (ctx.dial !== 'send' ? 'the dial says ' + ctx.dial
                                : 'everybody reachable is already spoken for, or deferred')))) } };
}

// ---------------------------------------------------------------------- 6b — PATH A: THE SECOND HALF OF THE SAVE…

// THIS IS NOT A JOB THAT RUNS LATER.
function commRepairOnWordsChanged_(changes, user) {
  var out = { discovered: 0, incidents: [], said: 0, audience: 0, skipped: [], woke: '' };
  if (!changes || !changes.length) return out;
  var nowIso = new Date().toISOString();

  var fresh = [];
  for (var i = 0; i < changes.length; i++) {
    var c = changes[i] || {};
    var before = c.before || {};
    var after = c.after || {};
    var id = String(after.id || before.id || '');
    if (!id) continue;
    // THE COMPARISON IS THE DETECTOR'S OWN RECIPE, on both sides.
    var shaThen = commRepairWordsSha_(before);
    var shaNow = commRepairWordsSha_(after);
    var senderThen = commRepairSenderOf_(before);
    var senderNow = commRepairSenderOf_(after);
    if (shaThen === shaNow && senderThen === senderNow) {
      out.skipped.push(id + ': the words did not move');
      continue;
    }
    if (!c.correct_audience) {
      // THE WORDS MOVED AND NOBODY CALLED IT A MISTAKE.
      out.skipped.push(id + ': the words moved, and nothing was declared wrong — an improvement');
      continue;
    }
    var what = String(c.what_was_wrong || '').trim();
    if (!what) { out.skipped.push(id + ': declared wrong with no sentence saying what — nothing was sent'); continue; }
    var incidentId = commRepairIncidentId_(id, shaThen, shaNow, what);
    if (commRepairIncidentBy_(incidentId)) {
      out.skipped.push(id + ': this exact correction is already on the ledger');
      continue;
    }
    var audience = commRepairAudienceBySha_(id, shaThen, senderThen);
    var row = commRepairIncidentRow_({
      incident_id: incidentId, situation: id,
      // THE WINDOW IS A READING, NOT THE QUESTION.
      window_from: commRepairEarliest_(audience.people),
      window_to: nowIso,
      words_sha_then: shaThen, sender_then: senderThen,
      what_was_wrong: what,
      // DECLARED AND CONFIRMED IN ONE BREATH, and only here.
      state: 'confirmed', audience: audience.count,
      declared_by: str_(user && user.email), declared_at: nowIso
    }, nowIso);
    // `commRepairIncidentRow_` builds the DECLARED half and deliberately knows nothing about confirming — the two…
    row.confirmed_by = str_(user && user.email);
    row.confirmed_at = nowIso;
    try { commRepairUpsert_(row); }
    catch (e) {
      out.skipped.push(id + ': the incident could not be written — ' + String((e && e.message) || e));
      continue;
    }
    out.discovered++;
    out.audience += audience.count;
    out.incidents.push({ incident_id: incidentId, situation: id, audience: audience.count,
                         what_moved: (shaThen !== shaNow)
                           ? (senderThen !== senderNow ? 'the sender and the words' : 'the words')
                           : 'the sender' });
    fresh.push(incidentId);
  }

  if (!out.discovered) return out;
  commRepairStamp_();

  // THE HEAD — a few people, for real, before the screen comes back, and only from the incidents this save just…
  var head = commRepairRun_(user, { incident_ids: fresh,
                                    budgetMs: COMM_REPAIR_HEAD_MS,
                                    maxPeople: COMM_REPAIR_HEAD_PEOPLE });
  out.said = Number((head.data && head.data.said) || 0);
  out.head = head.data || {};

  // AND THE REST, HANDED ON.
  out.woke = commRepairWakeFor_(head.data || {}, true);
  return out;
}

// ---------------------------------------------------------------------- 6c — THE CONTINUATION, WHICH IS NOT A…

// Where the pending one-shot is pointed, so a second one is not minted on top of it and an earlier need can replace…
var COMM_REPAIR_WAKE_KEY = 'comm_repair_wake_at';

// THE ONE-SHOT THAT CARRIES THE REST, AND WHY IT IS NOT THE THING THAT WAS JUST TAKEN OUT OF THIS FILE.
function commRepairWake_(whenMs, why) {
  var at = Number(whenMs) || (new Date().getTime() + 1000);
  var props = null;
  try { props = PropertiesService.getScriptProperties(); } catch (eP) { props = null; }
  var pendingAt = 0;
  try { pendingAt = props ? (Number(props.getProperty(COMM_REPAIR_WAKE_KEY) || 0) || 0) : 0; }
  catch (eR) { pendingAt = 0; }

  var existing = [];
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === COMM_REPAIR_WAKE_FN) existing.push(t);
    });
  } catch (eG) { return 'the triggers could not be read — the backstop door carries it'; }

  // A PENDING WAKE THAT IS ALREADY SOON ENOUGH IS THE ANSWER.
  if (existing.length && pendingAt && pendingAt <= at + 1000) {
    return 'a continuation is already pending for ' + new Date(pendingAt).toISOString();
  }
  // An earlier need replaces a later wake, and a wake with no memory of when it fires is replaced on principle — a…
  try { existing.forEach(function (t) { ScriptApp.deleteTrigger(t); }); } catch (eD) { /* mint anyway */ }

  try {
    // `after` FOR THE NEAR ONE, `at` FOR THE FAR ONE.
    var delay = at - new Date().getTime();
    var builder = ScriptApp.newTrigger(COMM_REPAIR_WAKE_FN).timeBased();
    if (delay < 5 * 60 * 1000) builder.after(Math.max(1, delay)).create();
    else builder.at(new Date(at)).create();
  } catch (eC) {
    try { if (props) props.deleteProperty(COMM_REPAIR_WAKE_KEY); } catch (eX) { /* nothing to undo */ }
    try {
      hubSysLog_('asa-hub:comm', 'comm_repair_wake_failed',
                 'the continuation could not be minted (' + String((eC && eC.message) || eC) +
                 ') — the corrections are written down and the backstop door carries them, ' +
                 'which costs up to an hour', { status: 500 });
    } catch (eL) { /* the rows carry it */ }
    return 'no continuation: ' + String((eC && eC.message) || eC);
  }
  try { if (props) props.setProperty(COMM_REPAIR_WAKE_KEY, String(at)); } catch (eS) { /* one duplicate at worst */ }
  return 'a continuation fires at ' + new Date(at).toISOString() +
         (why ? ' — ' + why : '');
}

// WHEN THE REST SHOULD FOLLOW — and the whole of the quiet-hours answer.
function commRepairWakeFor_(result, progressed) {
  var data = result || {};
  var more = Number(data.left_for_later || 0) + Number(data.still_owed || 0);
  if (!more && !data.wants_wake) return 'nothing is left to carry';
  var now = new Date();
  var quietFrom = (typeof commPolicy_ === 'function') ? Number(commPolicy_('quiet_from')) : 21;
  var quietTo = (typeof commPolicy_ === 'function') ? Number(commPolicy_('quiet_to')) : 8;
  var h = now.getHours();
  var inQuiet = (quietFrom > quietTo) ? (h >= quietFrom || h < quietTo) : (h >= quietFrom && h < quietTo);
  if (!inQuiet) {
    // NOTHING MOVED, AND THE HOUR IS NOT THE REASON.
    if (!progressed) {
      return 'nothing moved and the hour is not the reason — the backstop door carries it';
    }
    return commRepairWake_(now.getTime() + 1000, 'the rest of the audience');
  }
  var at = new Date(now.getTime());
  at.setHours(quietTo, 0, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  // A minute past the hour, because a wake that lands on the boundary can be read by `commWindowVerdict_` as the…
  at = new Date(at.getTime() + 60000);
  return commRepairWake_(at.getTime(),
                         'quiet hours — the one wait a correction is allowed, and it waits as an A');
}

// THE CONTINUATION ITSELF.
function commRepairContinue() {
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === COMM_REPAIR_WAKE_FN) ScriptApp.deleteTrigger(t);
    });
  } catch (eD) { /* it fires once either way */ }
  try { PropertiesService.getScriptProperties().deleteProperty(COMM_REPAIR_WAKE_KEY); }
  catch (eP) { /* at worst a duplicate trigger */ }

  var res;
  try { res = commRepairRun_(null, { budgetMs: COMM_REPAIR_RUN_MS }); }
  catch (e) {
    try {
      hubSysLog_('asa-hub:comm', 'comm_repair_continue_error',
                 String((e && e.message) || e) + ' — the debts are written down and the backstop ' +
                 'door carries them', { status: 500 });
    } catch (eL) { /* the rows carry it */ }
    return;
  }
  var data = (res && res.data) || {};
  // PROGRESS IS THE CONDITION FOR CHAINING.
  var progress = Number(data.said || 0) + Number(data.planned || 0) + Number(data.undeliverable || 0);
  if (progress || data.wants_wake) commRepairWakeFor_(data, progress > 0);
}

// ---------------------------------------------------------------------- 6d — PATH B: THE FRONT OF THE NEXT MESSAGE…

// THE APOLOGY AS THE FIRST LINE OF THE NEXT THING WE SAY, WHICH IS HOW A PERSON WOULD DO IT.
function commRepairLead_(item, situation, baseVars) {
  if (!item || !situation) return null;
  if (item.rehearsal || item.rehearsed) return null;
  var personKey = String(item.name_key || '').trim().toLowerCase();
  var hostKey = String(item.intent_key || '');
  if (!personKey || !hostKey) return null;
  if (commRepairOwedCount_() <= 0) return null;

  var corr = commRepairSituationNow_();
  if (!corr) return null;                              // no words, and this file writes none
  if (String(corr.id || '') === String(situation.id || '')) return null;

  var nowMs = new Date().getTime();
  var rows = commRepairRows_();
  var owed = commRepairOwedFor_(personKey, rows, nowMs);
  if (!owed.length) return null;
  if (commRepairInBreath_(personKey, rows, nowMs)) return null;

  var debt = owed[0];                                  // the oldest mistake, and only ever one
  var vars = commRepairLeadVars_(item, corr, debt.incident);
  var smsLine = str_(smartRender_(corr.sms_text, vars));
  var mailLine = str_(smartRender_(corr.email_text, vars));
  if (!smsLine && !mailLine) return null;

  // EVERY BODY THIS MESSAGE COULD GO OUT AS MUST BE ABLE TO CARRY THE LINE, AND THAT IS DECIDED BEFORE THE CLAIM.
  var smsLive = !!str_(situation.sms_text);
  var mailLive = !!str_(situation.email_subject) && !!str_(situation.email_text);
  if (!smsLive && !mailLive) return null;
  // THE SLOT IS CHOSEN BY COMPARING STRINGS, so a situation whose subject is the same string as one of its bodies…
  var subj = String(situation.email_subject || '');
  if (subj && (subj === String(situation.sms_text || '') ||
               subj === String(situation.email_text || ''))) return null;
  if (smsLive) {
    if (!smsLine) return null;                         // an SMS body with no SMS apology to lead it
    var hostSms = str_(smartRender_(situation.sms_text, baseVars || {}));
    if ((smsLine + '\n\n' + hostSms).length > COMM_REPAIR_LEAD_SMS_MAX) return null;
  }
  if (mailLive && !mailLine) return null;

  var lead = {
    line_sms: smsLine, line_email: mailLine,
    sms_tpl: String(situation.sms_text || ''),
    email_tpl: String(situation.email_text || ''),
    subject_tpl: String(situation.email_subject || ''),
    incident_id: String(debt.incident.incident_id || ''),
    person_key: personKey, host_key: hostKey,
    used: '', why: ''
  };

  var test = (typeof commTestMode_ === 'function') ? commTestMode_() : false;
  if (!commRepairClaim_(String(debt.incident.incident_id || ''), personKey, test,
                        new Date(nowMs).toISOString(), 'B', hostKey)) {
    return null;                                       // spoken for — path A has them, and says so
  }
  return lead;
}

// THE WORDS OF THE LEAD — the catalogue's, rendered with this person's name and the human sentence about what was…
function commRepairLeadVars_(item, corr, incident) {
  var name = String((item && item.name) || '');
  return {
    first_name: name.split(/\s+/)[0] || '',
    name: name,
    expires: '', days_left: '',
    credential: (typeof smartCredentialLabel_ === 'function') ? smartCredentialLabel_(corr || {}) : '',
    items: '0',
    correction: String((incident && incident.what_was_wrong) || ''),
    sender: commRepairSenderOf_(corr || {})
  };
}

// ====================================================================== 7 — THE DOORS…

// WHAT CHANGED, AND WHO HOLDS THE OLD WORDS.
HUB_POLICY.commRepairScan = {
  file: 'CommRepair.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { situation: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.commRepairScan = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var situation = str_(payload && payload.situation);
  var from = str_(payload && payload.from);
  var to = str_(payload && payload.to);
  var out = { drift: commRepairDrift_({ from: from, to: to }),
              priority: commRepairPriority_(),
              gates: 'priority paces; it never permits. The opt-out list, the dial, the send ' +
                     'switch and the test redirect are asked exactly as they are for an ask.',
              purpose_declared: commRepairPurposeDeclared_() };
  if (situation) out.audience = commRepairAudience_(situation, from, to);
  return { status: 200, data: out };
};

// A PERSON DECLARES THE MISTAKE.
HUB_POLICY.commRepairDeclare = {
  file: 'CommRepair.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin'],
  params: { situation: { type: 'string', required: true },
            from: { type: 'string', required: true },
            to: { type: 'string', required: true },
            what_was_wrong: { type: 'string', required: true } },
  invalidates: [], emits: []
};
HUB_ACTIONS.commRepairDeclare = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var situation = str_(payload && payload.situation);
  var from = str_(payload && payload.from);
  var to = str_(payload && payload.to);
  var what = str_(payload && payload.what_was_wrong);
  if (!situation || !from || !to || !what) {
    return { status: 400, message: 'a situation, a window and what was wrong are all required — ' +
                                   'an incident nobody can describe is one nobody can confirm' };
  }
  if (commRepairMs_(from, -1) < 0 || commRepairMs_(to, -1) < 0) {
    return { status: 400, message: 'the window must be two readable times' };
  }
  var nowIso = new Date().toISOString();
  var incidentId = commRepairIncidentId_(situation, from, to, what);
  // THE SAME INCIDENT DECLARED TWICE IS ONE ROW, and the second declaration must not walk a confirmed incident back…
  var already = commRepairIncidentBy_(incidentId);
  if (already) {
    return { status: 200, data: { incident_id: incidentId, state: String(already.state || ''),
                                  audience: Number(already.audience) || 0,
                                  note: 'already declared — nothing was changed' } };
  }
  var audience = commRepairAudience_(situation, from, to);
  var row = commRepairIncidentRow_({
    incident_id: incidentId, situation: situation, window_from: from, window_to: to,
    what_was_wrong: what, state: 'declared', audience: audience.count,
    declared_by: str_(user && user.email), declared_at: nowIso
  }, nowIso);
  try { commRepairUpsert_(row); }
  catch (e) { return { status: 500, message: 'the incident could not be written: ' + String(e && e.message || e) }; }
  commRepairStamp_();
  return { status: 200, data: { incident_id: incidentId, audience: audience.count,
                                dropped: audience.dropped,
                                state: 'declared',
                                next: 'confirm it, and it goes at once — confirming mints the ' +
                                      'same one-shot continuation the save does. Nothing waits ' +
                                      'for a tick; the only wait is quiet hours, and that one ' +
                                      'ends at the top of the window.' } };
};

// AND THEN IT GOES.
HUB_POLICY.commRepairConfirm = {
  file: 'CommRepair.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  params: { incident_id: { type: 'string', required: true },
            decision: { type: 'string' }, note: { type: 'string' } },
  invalidates: [], emits: ['smsSend', 'emailSend']
};
HUB_ACTIONS.commRepairConfirm = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var incidentId = str_(payload && payload.incident_id);
  if (!incidentId) return { status: 400, message: 'which incident?' };
  // NO CONFIRMING SOMETHING NOBODY DECLARED.
  var incident = commRepairIncidentBy_(incidentId);
  if (!incident) {
    return { status: 404, message: 'no incident by that id — declare it first, with the situation ' +
                                   'and the window it happened in' };
  }
  var decision = str_(payload && payload.decision).toLowerCase() || 'confirm';
  var state = (decision === 'dismiss') ? 'dismissed' : (decision === 'close' ? 'closed' : 'confirmed');
  var nowIso = new Date().toISOString();
  var row = { id: 'RPI_' + commRepairId_(incidentId), state: state,
              note: str_(payload && payload.note).slice(0, 500) };
  if (state === 'confirmed') { row.confirmed_by = str_(user && user.email); row.confirmed_at = nowIso; }
  else { row.closed_at = nowIso; }
  try { commRepairUpsert_(row); }
  catch (e) { return { status: 500, message: String(e && e.message || e) }; }
  var owed = commRepairStamp_();
  if (state !== 'confirmed') {
    return { status: 200, data: { incident_id: incidentId, state: state, still_owed: owed } };
  }
  // THE HEAD, HERE, IN THIS EXECUTION — the same shape the save carries, for the same reason: a person who has just…
  var head = commRepairRun_(user, { incident_id: incidentId,
                                    budgetMs: COMM_REPAIR_HEAD_MS,
                                    maxPeople: COMM_REPAIR_HEAD_PEOPLE });
  var woke = commRepairWakeFor_((head && head.data) || {}, true);
  return { status: 200, data: { incident_id: incidentId, state: state, still_owed: commRepairStamp_(),
                                said: Number((head.data && head.data.said) || 0),
                                head: head.data || {}, continuation: woke,
                                timing: 'the first few are already sent. The rest follow in the ' +
                                        'continuation, which Apps Script fires within seconds — ' +
                                        'and nothing is scheduled at all beyond that. Quiet hours ' +
                                        'are the one allowed wait: a correction owed at 02:00 ' +
                                        'waits for the top of the window and goes then, still as ' +
                                        'path A.' } };
};

// THE BACKSTOP, AND IT IS NO LONGER THE MECHANISM.
HUB_POLICY.commRepairSweep = {
  file: 'CommRepair.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin'],
  params: { force: { type: 'boolean' } },
  // IT REACHES PEOPLE NOW, and the registry has to say so — the same two the compliance sweep declares, because it…
  invalidates: [], emits: ['smsSend', 'emailSend']
};
HUB_ACTIONS.commRepairSweep = function (payload, user) {
  var isMachine = !!(user && user.is_service);
  if (!isMachine && (!user || String(user.role) !== 'admin')) return hubDenied_();
  var force = !!(payload && (payload.force === true || String(payload.force) === 'true'));
  if (!force && commRepairOwedCount_() <= 0) {
    return { status: 200, data: { skipped: true, still_owed: 0,
                                  why: 'nobody is owed a word. This door is the backstop, not the ' +
                                       'clock — a correction goes on the discovery that creates ' +
                                       'it, or on the front of the next message its lane sends.' } };
  }
  return commRepairRun_(user, { budgetMs: COMM_REPAIR_RUN_MS });
};

// THE BOARD — the incidents and who inside them is still owed a word.
HUB_POLICY.commRepairBoard = {
  file: 'CommRepair.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { incident_id: { type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.commRepairBoard = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var want = str_(payload && payload.incident_id);
  var incidents = [], owed = [], inFlight = [], undelivered = [], collapsed = [];
  commRepairSettleAll_(commRepairRows_()).forEach(function (r) {
    if (String(r.kind || '') === 'incident') {
      if (want && String(r.incident_id || '') !== want) return;
      incidents.push(r);
      return;
    }
    if (String(r.kind || '') !== 'person') return;
    if (want && String(r.incident_id || '') !== want) return;
    var state = String(r.claim_state || 'planned');
    if (state === 'repaired') return;
    if (state === 'undeliverable') { undelivered.push(r); return; }
    if (state === 'claimed') { inFlight.push(r); return; }
    if (String(r.test_claim_state || '') === 'collapsed') collapsed.push(r);
    owed.push(r);
  });
  return { status: 200, data: { incidents: incidents, owed: owed, in_flight: inFlight,
                                undeliverable: undelivered, collapsed_in_test: collapsed,
                                still_owed: commRepairStamp_(),
                                purpose_declared: commRepairPurposeDeclared_(),
                                priority: commRepairPriority_(),
                                // The two words the screen must not mix up.
                                reading: 'owed = nobody has taken them. in_flight = a claim is ' +
                                         'held and settles itself from the evidence. ' +
                                         'collapsed_in_test = the testers\' group number saw one ' +
                                         'message for the whole incident, and these people are ' +
                                         'still owed the real one.' } };
};
