// ------------------------------------------------------------------ COMM RECORD — the rehearsal, written down…
// `CommIntent.gs` works out who owes what.

// The service sweep's own pace.
var COMM_RECORD_SWEEP_KEY = 'comm_record_last_run';
var COMM_RECORD_SWEEP_GAP_S = 6 * 3600;

// THE SWEEP DOES NOT FIT IN ONE EXECUTION, SO IT STOPS AND REMEMBERS.
var COMM_RECORD_CURSOR_KEY = 'comm_record_cursor';

// THE EVIDENCE HOUSE (the design's comm_attempts).
var COMM_ATTEMPTS_HOUSE = 'comm_attempts';
// THE ROW REMEMBERS WHAT WE SAID, NOT WHAT WE WROTE.
var COMM_ATTEMPTS_HEADER = ['id', 'createdAt', 'intent_key', 'person_key', 'attempt', 'channel',
                            'to_masked', 'receipt', 'error', 'redirected', 'doubt', 'test_mode', 'at',
                            'words_sha', 'situation', 'sender_used', 'words_known'];
var COMM_RECORD_BUDGET_MS = 90 * 1000;

// ONE INTENT, AS THE TWO ROWS IT BECOMES.
function commRecordRows_(intent, verdict, nowIso, prior) {
  prior = prior || {};
  if (!intent) return null;
  var key = String(intent.intent_key || '');
  var reasons = (verdict && verdict.reasons) || [];
  var head = {
    id: 'CMI_' + commRecordId_(key),
    intent_key: key,
    purpose: String(intent.purpose || ''),
    person_key: String(intent.person_key || ''),
    person_name: String(intent.person_name || ''),
    // THE STATE SURVIVES A RE-PLAN.
    state: (prior.state && ['asking', 'answered', 'stopped'].indexOf(String(prior.state)) !== -1)
      ? String(prior.state) : String(intent.state || 'planned'),
    open_count: (intent.bindings || []).filter(function (b) {
      return String(b.binding_state || 'open') === 'open';
    }).length,
    worst: String(intent.worst || ''),
    dial: String((verdict && verdict.dial) || 'off'),
    // WHAT THE POLICY DECIDED, not whether the dial let it act — those are different questions and the dial has its…
    verdict: verdict ? String(verdict.policy || 'unplanned') : 'unplanned',
    reasons: reasons.join(' · '),
    channel: String((verdict && verdict.channel) || ''),
    route_tried: ((verdict && verdict.route_tried) || []).join(' · '),
    carried: (intent.bindings || []).length,
    deferred: Number(intent.deferred || 0),
    planned_at: String(nowIso || ''),
    // THE PACING MEMORY RIDES FORWARD.
    last_asked_at: String(prior.last_asked_at || ''),
    attempts: Number(prior.attempts) || 0,
    // TWO MEMORIES, NEVER ONE.
    test_attempts: Number(prior.test_attempts) || 0,
    test_last_asked_at: String(prior.test_last_asked_at || ''),
    test_mode: (verdict && verdict.test) ? 'yes' : 'no',
    // ESCALATION IS A FACT ON THE ROW, not a flag dropped on the floor: the policy computed it and nobody read it.
    escalate: (verdict && verdict.escalate) ? 'yes' : 'no',
    escalate_why: (verdict && verdict.escalate)
      ? (reasons.filter(function (r) { return r.indexOf('attempts:') === 0; })[0] || 'attempt budget')
      : '',
    // WHO THE GRAPH WOULD TELL.
    escalate_to: String((verdict && verdict.supervisor) || ''),
    escalate_to_confidence: String((verdict && verdict.supervisor_confidence) || ''),
    /* the proof a reply can quote — rung one of CommInbound's ladder */
    reply_token: (typeof commReplyToken_ === 'function') ? commReplyToken_(key) : '',
    tenant: ''
  };
  var bands = {};
  ((verdict && verdict.parts) || []).forEach(function (p) {
    (p.bindings || []).forEach(function (b) { bands[String(b.demand_id || b.req_id)] = p.band; });
  });
  var rows = (intent.bindings || []).map(function (b) {
    return {
      id: 'CMB_' + commRecordId_(key + '|' + String(b.demand_id || '')),
      intent_key: key,
      demand_id: String(b.demand_id || ''),
      person_key: String(intent.person_key || ''),
      req_id: String(b.req_id || ''),
      state: String(b.state || ''),
      expires: String(b.expires || ''),
      days_left: (b.days_left === null || b.days_left === undefined) ? '' : String(b.days_left),
      band: bands[String(b.demand_id || b.req_id)] || '',
      binding_state: String(b.binding_state || 'open'),
      // WHAT THIS ONE ASK ALSO SETTLES.
      also: ((b.also || []).join(' · ')),
      settles: ((b.settles || []).join(' · '))
      // `qualified_by`, `qualified_at` and `note` are DELIBERATELY ABSENT.
    };
  });
  return { intent: head, bindings: rows };
}

/** A stable id from a stable key — same need, same row, every sweep. */
function commRecordId_(key) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(key || ''));
  var out = '';
  for (var i = 0; i < digest.length && out.length < 16; i++) {
    var b = (digest[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out.toUpperCase();
}

// THE SWEEP.
function commRecordSweep_(user, opts) {
  opts = opts || {};
  var dial = commDial_();
  if (dial === 'off') {
    return { status: 200, data: { skipped: true, dial: dial,
             note: 'the dial is off — nothing was planned and nothing was written' } };
  }
  var now = new Date();
  var nowIso = now.toISOString();
  var nowMs = now.getTime();

  var matrix = [];
  try { matrix = commRecordMatrix_(); } catch (e) { matrix = []; }
  if (!matrix.length) {
    return { status: 200, data: { skipped: true, why: 'the obligations matrix answered nothing' } };
  }

  // THE ROSTER IS A LAW HERE.
  var roster = commRecordRoster_();
  // ONE VOICE PER CREDENTIAL.
  var owned = commRecordOwnedReqs_();
  var ownedDropped = 0;
  var byPerson = {};
  matrix.forEach(function (r) {
    var k = String(r.person_key || '').trim().toLowerCase();
    if (!k) return;
    if (owned[String(r.req_id || '')]) { ownedDropped++; return; }
    if (!byPerson[k]) byPerson[k] = { name: String(r.person_name || ''), rows: [] };
    byPerson[k].rows.push(r);
  });

  var planned = commIntentsFrom_(byPerson, { roster: roster, now: nowIso });

  /* A CURSOR ONLY MEANS SOMETHING OVER A STABLE ORDER. */
  var queue = planned.intents.slice().sort(function (a, b) {
    var x = String(a.intent_key || ''), y = String(b.intent_key || '');
    return x < y ? -1 : (x > y ? 1 : 0);
  });

  /* what the previous passes already asked, who can be reached, and the words */
  var prior = commRecordPrior_();
  var priorBindings = commRecordPriorBindings_();
  // THE OLD GENERATION.
  var retired = commRecordRetireOldKeys_(prior, priorBindings, nowIso);
  var people = commRecordPeople_();
  var routes = commRecordRoutes_();
  var consent = commRecordConsentRows_();
  var quietFrom = commPolicy_('quiet_from'), quietTo = commPolicy_('quiet_to');
  var situation = (typeof commSituationFor_ === 'function') ? commSituationFor_('compliance.owed') : null;
  var test = (typeof commTestMode_ === 'function') ? commTestMode_() : false;
  var tz = Session.getScriptTimeZone();
  var localHour = Number(Utilities.formatDate(now, tz, 'H'));
  var localDay = Number(Utilities.formatDate(now, tz, 'u')) % 7;   // Sunday = 0
  var labelFor = function (id) {
    // The catalogue's one door (Certs.gs) — config first, shipped floor behind.
    return (typeof certLabels_ === 'function' && certLabels_()[id]) ? certLabels_()[id] : '';
  };

  var cursor = commRecordCursor_();
  if (cursor >= queue.length) cursor = 0;
  var startedAt = new Date().getTime();
  var wrote = 0, sent = 0, redirected = 0, gated = 0, held = 0, noRoute = 0, noWords = 0, doubts = 0, i = cursor;
  for (; i < queue.length; i++) {
    if (wrote && (new Date().getTime() - startedAt) > COMM_RECORD_BUDGET_MS) break;
    var intent = queue[i];
    var was = prior[String(intent.intent_key || '')] || {};
    // A THREAD THE PERSON STOPPED IS NEVER RE-PLANNED.
    if (String(was.state || '') === 'stopped') { held++; continue; }
    // THE MEMORY OF THIS MODE.
    var mem = commRecordMemory_(was, test);
    var attempts = mem.attempts;
    var lastMs = mem.lastMs;
    // the hours the cortex says they are awake narrow the platform's quiet hours — narrowed, never widened
    var quiet = (typeof commCortexWindowFrom_ === 'function')
      ? commCortexWindowFrom_(routes[String(intent.person_key || '')] || null, quietFrom, quietTo)
      : null;
    var verdict = commPlanVerdict_(intent, {
      attempts: attempts, lastAskedMs: lastMs, nowMs: nowMs,
      localHour: localHour, localDay: localDay, test: test, quiet: quiet
    });
    var routeRow = routes[String(intent.person_key || '')] || {};
    verdict.supervisor = String(routeRow.supervisor || '');
    verdict.supervisor_confidence = String(routeRow.supervisor_confidence || '');

    // the route: consent asked per channel — the canonical store's rows for this person, refusals from the opt-out…
    var person = commRecordContact_(people, routes, intent.person_key);
    var channels = situation ? commRecordChannels_(situation) : ['sms', 'email'];
    var route = commRouteFor_(consent[String(intent.person_key || '')] || [],
                              commRecordRefused_(person), intent.purpose, channels, nowMs);
    if (!route.ok && test) {
      // recorded, not enforced: the recipient is a tester either way
      route = { ok: true, channel: channels[0] || 'email', why: route.why + ' — not enforced in test mode', tried: route.tried };
    }
    verdict.channel = route.channel || '';
    verdict.route_tried = route.tried || [];
    verdict.reasons.push('route: ' + route.why);

    var rows = commRecordRows_(intent, verdict, nowIso, was);
    if (!rows) continue;
    try {
      commRecordUpsert_(COMM_INTENTS_HOUSE, rows.intent);
      for (var bi = 0; bi < rows.bindings.length; bi++) {
        commRecordUpsert_(COMM_BINDINGS_HOUSE, rows.bindings[bi]);
      }
      // THE THREAD MOVED ON: bindings written on an earlier pass and not carried now are settled (no longer open in…
      commRecordSupersede_(intent, rows, priorBindings[String(intent.intent_key || '')] || [],
                           byPerson[String(intent.person_key || '')], nowIso);
      wrote++;
    } catch (eW) { continue; /* one person failing must not cost the whole rehearsal */ }

    if (verdict.escalate && !(was.escalate === 'yes')) {
      // the first time a thread crosses the budget is a committed result: it is a person's job now.
      commObserve_('escalated', intent, { attempts: attempts, why: verdict.reasons.join(' · '),
                                          escalate_to: verdict.supervisor,
                                          escalate_to_confidence: verdict.supervisor_confidence,
                                          suggested_by: verdict.supervisor ? 'the graph (MANAGED_BY)' : '' }, 'sweep');
      if (attempts >= Number(commPolicy_('max_attempts')) && !test) {
        commObserve_('unanswered', intent, { attempts: attempts, last_asked_at: mem.lastIso }, 'sweep');
      }
    }
    if (!verdict.send) { held++; continue; }
    var allowed = commDispatchAllowed_(intent, verdict, route);
    if (!allowed.ok) { noRoute++; continue; }
    if (!situation) { noWords++; continue; }
    if (!person || (!person.phone && !person.email)) { noRoute++; continue; }

    var item = commDispatchItem_(intent, person, situation);
    if (!item) continue;
    // CLAIM THE ATTEMPT FIRST, FAIL CLOSED.
    var claim = commRecordClaim_(rows.intent.id, test, attempts + 1, nowIso, '');
    if (!claim) { held++; continue; }               // could not write the claim: do not send
    var out = commRecordSend_(item, situation, person, route, attempts, labelFor);
    // TWO ROWS FOR ONE SEND, AND THAT IS CORRECT.
    var evidenceId = commRecordAttempt_(intent, attempts + 1, out, test, nowIso);
    commObserve_(out.sent ? (out.redirected ? 'redirected' : 'sent') : (out.doubt ? 'doubt' : 'held'), intent,
                 { attempt: attempts + 1, attempt_id: evidenceId, channel: out.channel,
                   receipt: out.receipt, error: out.error,
                   items: item.binding_count, test_mode: test }, 'sweep');
    if (out.sent) {
      sent++;
      if (out.redirected) redirected++;
      try { commRecordUpsert_(COMM_INTENTS_HOUSE, { id: rows.intent.id, state: 'asking', channel: out.channel }); }
      catch (eC) { /* the claim already paces it */ }
      try {
        if (typeof smartRecord_ === 'function') {
          // A REHEARSAL IS WRITTEN UNDER THE REHEARSAL KEY.
          var ledgerKey = (out.redirected && typeof smartRehearsalKey_ === 'function')
            ? smartRehearsalKey_(item.key) : item.key;
          smartRecord_(ledgerKey, String(situation.id || ''), item.name, item.expires,
                       out.redirected ? 'rehearsal' : out.channel);
        }
      } catch (eL) { /* recorded on the intent row either way */ }
    } else if (out.doubt) {
      // A DOUBT KEEPS THE CLAIM.
      doubts++;
      try { commRecordUpsert_(COMM_INTENTS_HOUSE, { id: rows.intent.id, last_error: out.error }); } catch (eD) {}
    } else {
      if (out.gated) gated++;
      commRecordClaim_(rows.intent.id, test, attempts, String(mem.lastIso || ''), '');   // given back
    }
  }
  var done = i >= queue.length;
  commRecordCursorSet_(done || !wrote ? 0 : i, done || !wrote);

  try {
    hubSysLog_(str_(user && user.email) || 'asa-hub:comm', 'comm_record_swept',
               wrote + ' intent(s) recorded · ' + sent + ' sent' +
               (redirected ? ' (' + redirected + ' to the testers)' : '') +
               ' · ' + held + ' held · ' + gated + ' gated · ' + noRoute + ' unreachable' +
               (doubts ? ' · ' + doubts + ' in doubt (claim kept)' : '') +
               (ownedDropped ? ' · ' + ownedDropped + ' obligation(s) left to the reminder lane' : '') +
               (retired ? ' · ' + retired + ' old-generation row(s) superseded' : '') +
               (noWords ? ' · no situation carries compliance.owed' : '') +
               ' · ' + planned.skipped.off_roster + ' off roster' +
               (done ? '' : ' · paused at ' + i + ' of ' + queue.length + ', resuming next tick'),
               { status: 200 });
  } catch (eL2) { /* recorded either way */ }

  return { status: 200, data: {
    dial: dial, test_mode: test, intents: wrote, sent: sent, redirected: redirected,
    held: held, gated: gated, unreachable: noRoute, no_words: noWords, doubts: doubts,
    left_to_reminders: ownedDropped, superseded: retired,
    people_considered: Object.keys(byPerson).length,
    planned: queue.length, resumed_from: cursor, complete: done,
    skipped: planned.skipped,
    note: dial === 'send'
      ? (test ? 'sent — every message went to the testers, nobody else.' : 'sent.')
      : 'planned and written down. Nothing was sent — the dial says ' + dial + '.' } };
}

/** The pacing memory of ONE mode, read off a prior row. */
function commRecordMemory_(was, test) {
  var out = { attempts: 0, lastMs: 0, lastIso: '' };
  if (!was) return out;
  var a, l;
  if (test) { a = was.test_attempts; l = was.test_last_asked_at; }
  else {
    // a row without the column is a row from the test era; it does not count
    if (String(was.test_mode || '') !== 'no') return out;
    a = was.attempts; l = was.last_asked_at;
  }
  out.attempts = Number(a) || 0;
  out.lastIso = l ? String(l) : '';
  var ms = out.lastIso ? new Date(out.lastIso).getTime() : 0;
  out.lastMs = isNaN(ms) ? 0 : ms;
  return out;
}

/** Write the attempt count of the current mode. True when the write landed. */
function commRecordClaim_(id, test, attempts, lastIso, channel) {
  var row = { id: id };
  if (test) { row.test_attempts = attempts; row.test_last_asked_at = lastIso; }
  else { row.attempts = attempts; row.last_asked_at = lastIso; }
  if (channel) row.channel = channel;
  try { commRecordUpsert_(COMM_INTENTS_HOUSE, row); return true; }
  catch (e) { return false; }
}

/** Which req_ids an ON reminder situation already speaks for. */
function commRecordOwnedReqs_() {
  var out = {};
  try {
    var reqs = (typeof requirementsForSmart_ === 'function') ? (requirementsForSmart_() || []) : [];
    reqs.forEach(function (r) {
      var sit = str_(r.consequence);
      if (!sit || !str_(r.req_id)) return;
      if (typeof smartSituationOn_ === 'function' && smartSituationOn_(sit)) out[str_(r.req_id)] = sit;
    });
  } catch (e) { /* nothing owned means the bundle carries everything, which is the safe direction */ }
  return out;
}

/** The binding rows already in the house, grouped by intent_key. */
function commRecordPriorBindings_() {
  var out = {};
  try {
    commBoardRows_(COMM_BINDINGS_HOUSE).forEach(function (b) {
      var k = String(b.intent_key || '');
      if (!k) return;
      if (!out[k]) out[k] = [];
      out[k].push(b);
    });
  } catch (e) { /* a first pass has nothing to supersede */ }
  return out;
}

/** The cortex's route rows, by person_key — read once per pass. */
function commRecordRoutes_() {
  var out = {};
  try {
    var tab = (typeof COMM_ROUTES_TAB !== 'undefined') ? COMM_ROUTES_TAB : 'comm_routes';
    commBoardRows_(tab).forEach(function (r) {
      var k = String(r.person_key || '').trim().toLowerCase();
      if (k && !out[k]) out[k] = r;
    });
  } catch (e) { /* no routes: the platform default stands */ }
  return out;
}

/** The canonical consent store's rows, by the same name key the matrix uses. */
function commRecordConsentRows_() {
  var out = {};
  try {
    var tab = (typeof COMM_CONSENT_TAB !== 'undefined') ? COMM_CONSENT_TAB : 'entity_comm_consent';
    commBoardRows_(tab).forEach(function (r) {
      var k = clientNameKey_(r.entity_name || '');
      if (!k) return;
      if (!out[k]) out[k] = [];
      out[k].push(r);
    });
  } catch (e) { /* unreadable store: silence, judged by the rule */ }
  return out;
}

// Where to reach somebody: the People house first, the cortex's proposal when the house is silent — the proposal…
function commRecordContact_(people, routes, personKey) {
  var k = String(personKey || '').trim().toLowerCase();
  var p = people[k] || null;
  var r = routes[k] || null;
  if (!p && !r) return null;
  return {
    name: String((p && p.name) || (r && r.name) || ''),
    phone: str_(p && p.phone) || str_(r && r.phone),
    email: str_(p && p.email) || str_(r && r.email)
  };
}

/** Settle or defer the bindings a thread no longer carries — on their rows. */
function commRecordSupersede_(intent, rows, prior, group, nowIso) {
  if (!prior || !prior.length) return;
  var carried = {};
  (rows.bindings || []).forEach(function (b) { carried[String(b.demand_id || '')] = 1; });
  var stillOpen = {};
  ((group && group.rows) || []).forEach(function (r) {
    if (COMM_OPEN_STATES.indexOf(String(r.state || '')) !== -1) {
      stillOpen[String(r.person_key || '') + '|' + String(r.req_id || '')] = 1;
    }
  });
  prior.forEach(function (b) {
    var d = String(b.demand_id || '');
    if (!d || carried[d]) return;
    var state = String(b.binding_state || 'open');
    if (state === 'settled') return;                      // already closed, by whoever closed it
    if (!stillOpen[d]) {
      if (state === 'settled') return;
      commRecordUpsert_(COMM_BINDINGS_HOUSE, { id: b.id, binding_state: 'settled',
        qualified_by: 'engine', qualified_at: nowIso, note: 'no longer open in requirement_states' });
    } else if (state !== 'deferred') {
      commRecordUpsert_(COMM_BINDINGS_HOUSE, { id: b.id, binding_state: 'deferred',
        note: 'still open; outside the cap this pass' });
    }
  });
}

// THE TRAIL (the design's comm_observations).
var COMM_OBSERVATIONS_HOUSE = 'comm_observations';
var COMM_OBSERVATIONS_HEADER = ['event_id', 'type', 'actor', 'subject_type', 'subject_key',
                                'subject_name', 'intent_key', 'payload', 'source', 'at', 'tenant'];
var COMM_OBSERVATION_TYPES = ['sent', 'redirected', 'doubt', 'held', 'escalated', 'unanswered',
                              'replied', 'unmatched', 'correlated', 'contribution', 'needs_human',
                              'settled', 'dismissed', 'stopped', 'consent_changed'];

function commObservationRow_(type, intent, payload, source, actor, nowIso) {
  var body = '';
  try { body = JSON.stringify(payload || {}); } catch (eJ) { body = '{}'; }
  if (body.length > 2000) body = body.slice(0, 2000);
  return {
    event_id: 'cmo_' + commRecordId_(String(type) + '|' + String((intent && intent.intent_key) || '') + '|' + String(nowIso || '') + '|' + body.slice(0, 80)),
    type: String(type || ''),
    actor: String(actor || 'asa-hub:comm'),
    subject_type: 'person',
    subject_key: String((intent && intent.person_key) || ''),
    subject_name: String((intent && intent.person_name) || (intent && intent.name) || ''),
    intent_key: String((intent && intent.intent_key) || ''),
    payload: body,
    source: String(source || 'sweep'),
    at: String(nowIso || new Date().toISOString()),
    tenant: ''
  };
}

/** Append one observation. Never throws, never upserts. Returns the event id or ''. */
function commObserve_(type, intent, payload, source, actor) {
  if (COMM_OBSERVATION_TYPES.indexOf(String(type)) === -1) return '';
  try {
    var row = commObservationRow_(type, intent, payload, source, actor, new Date().toISOString());
    var sheet = hubTabEnsure_(COMM_OBSERVATIONS_HOUSE, COMM_OBSERVATIONS_HEADER);
    var header = ensureHeader_(sheet, Object.keys(row));
    sheet.appendRow(header.map(function (h) { return serialize_(row[h]); }));
    return row.event_id;
  } catch (e) { return ''; }
}

/** One attempt, as the evidence row it becomes. Pure. */
function commAttemptRow_(intent, attempt, out, test, nowIso) {
  var to = String((out && out.to) || '');
  // WHAT WAS SAID, CARRIED BY THE SEND RESULT.
  var sha = String((out && out.words_sha) || '');
  var situation = String((out && out.situation) || '');
  var sender = String((out && out.sender_used) || '');
  return {
    id: 'CMA_' + commRecordId_(String(intent.intent_key || '') + '|' + attempt + '|' + nowIso),
    intent_key: String(intent.intent_key || ''),
    person_key: String(intent.person_key || ''),
    attempt: Number(attempt) || 0,
    channel: String((out && out.channel) || ''),
    to_masked: to ? ('•••' + to.slice(-4)) : '',
    receipt: String((out && out.receipt) || ''),
    error: String((out && out.error) || ''),
    redirected: (out && out.redirected) ? 'yes' : 'no',
    doubt: (out && out.doubt) ? 'yes' : 'no',
    test_mode: test ? 'yes' : 'no',
    at: String(nowIso || ''),
    words_sha: sha,
    situation: situation,
    sender_used: sender,
    // WHICH UNKNOWN A BLANK IS — the header's comment argues it.
    words_known: (sha || situation || sender) ? 'yes' : 'no'
  };
}

// WHAT ONE EVIDENCE ROW CAN SAY ABOUT THE WORDS.
function commAttemptWordsState_(row) {
  var r = row || {};
  var cell = function (k) {
    return String(r[k] === null || r[k] === undefined ? '' : r[k]).trim();
  };
  if (cell('words_sha') || cell('situation') || cell('sender_used')) return 'said';
  return cell('words_known').toLowerCase() === 'no' ? 'unknown' : 'predates';
}

// Append the evidence.
function commRecordAttempt_(intent, attempt, out, test, nowIso) {
  try {
    var sheet = hubTabEnsure_(COMM_ATTEMPTS_HOUSE, COMM_ATTEMPTS_HEADER);
    var row = commAttemptRow_(intent, attempt, out, test, nowIso);
    row.createdAt = nowIso;
    var header = ensureHeader_(sheet, Object.keys(row));
    sheet.appendRow(header.map(function (h) { return serialize_(row[h]); }));
    return row.id;
  } catch (e) { return ''; /* the intent row still carries the claim */ }
}

// How many old-generation threads one pass retires.
var COMM_RECORD_RETIRE_BATCH = 8;

// Mark rows of the payload-keyed generation superseded, a batch per pass.
function commRecordRetireOldKeys_(prior, priorBindings, nowIso) {
  var n = 0;
  var startedAt = new Date().getTime();
  Object.keys(prior || {}).forEach(function (k) {
    if (n >= COMM_RECORD_RETIRE_BATCH) return;
    if (new Date().getTime() - startedAt > 60 * 1000) return;   // the main loop still needs its budget
    if (String(k).split('|').length < 3) return;                // the thread key has one bar
    var row = prior[k];
    if (String(row.state || '') === 'superseded') return;
    try {
      commRecordUpsert_(COMM_INTENTS_HOUSE, { id: row.id, state: 'superseded',
        reasons: 'superseded ' + nowIso + ' — the key became the thread (person|purpose); see the live row' });
      ((priorBindings || {})[k] || []).forEach(function (b) {
        if (String(b.binding_state || '') === 'superseded') return;
        commRecordUpsert_(COMM_BINDINGS_HOUSE, { id: b.id, binding_state: 'superseded',
          note: 'superseded with its intent ' + nowIso });
      });
      n++;
    } catch (e) { /* the next pass retires it */ }
  });
  return n;
}

/** The intent rows already in the house, by intent_key — the pacing memory. */
function commRecordPrior_() {
  var out = {};
  try {
    commBoardRows_(COMM_INTENTS_HOUSE).forEach(function (r) {
      var k = String(r.intent_key || '');
      if (k) out[k] = r;
    });
  } catch (e) { /* a first pass has nothing to remember */ }
  return out;
}

// Who can be reached, by the same name key the matrix uses — the People house, read the way Smart Comms reads it.
function commRecordPeople_() {
  var out = {};
  try {
    var people = withoutIspClients_(peopleMerged_(listRows_('people', {})));
    people.forEach(function (p) {
      var k = clientNameKey_(p && p.name);
      if (!k || out[k]) return;
      out[k] = { name: String(p.name || ''), phone: str_(p.phone), email: str_(p.email) };
    });
  } catch (e) { /* nobody reachable is a real answer, and it is recorded */ }
  return out;
}

/** Who a phone or an address belongs to — the People house, keyed both ways. */
function commRecordPeopleByContact_() {
  var out = { phone: {}, email: {} };
  try {
    var people = withoutIspClients_(peopleMerged_(listRows_('people', {})));
    people.forEach(function (p) {
      var k = clientNameKey_(p && p.name);
      if (!k) return;
      var d = String(p.phone || '').replace(/\D/g, '').slice(-10);
      if (d.length === 10 && !out.phone[d]) out.phone[d] = { key: k, name: String(p.name || '') };
      var e = String(p.email || '').trim().toLowerCase();
      if (e && !out.email[e]) out.email[e] = { key: k, name: String(p.name || '') };
    });
  } catch (e) { /* nobody matched is a real answer, and it is observed */ }
  return out;
}

/** The channels a situation lists, in its order; sms then email when silent. */
function commRecordChannels_(situation) {
  var list = (typeof smartList_ === 'function') ? smartList_(situation.channels) : [];
  list = (list || []).map(function (c) { return String(c).trim().toLowerCase(); }).filter(String);
  return list.length ? list : ['sms', 'email'];
}

// What the opt-out list says about this person, per channel.
function commRecordRefused_(person) {
  var out = { sms: false, email: false };
  if (!person) return out;
  try { if (person.phone && optOutBlocked_(person.phone)) out.sms = true; } catch (e) { out.sms = true; }
  try { if (person.email && optOutBlocked_(person.email)) out.email = true; } catch (e2) { out.email = true; }
  return out;
}

// ONE INTENT, HANDED TO THE TRANSPORT.
function commRecordSend_(item, situation, person, route, attempts, labelFor) {
  var vars = commDispatchVars_(item, situation, labelFor);
  var order = [String(route.channel || '')].concat(commRecordChannels_(situation))
    .filter(function (c, idx, arr) { return c && arr.indexOf(c) === idx; });
  var res = { sent: false, channel: '', redirected: false, gated: false, doubt: false, error: '', receipt: '', to: '' };
  // WORDS NOBODY WROTE ARE NOT WORDS.
  var unwritten = function (field) {
    try {
      return (typeof smartUnwrittenWords_ === 'function') && smartUnwrittenWords_(situation, field);
    } catch (eU) { return false; }
  };
  // THE IDENTITY OF THE WORDS, FROM THE ONE FUNCTION THAT MAY MINT IT.
  var sha = '';
  try { if (typeof commRepairWordsSha_ === 'function') sha = commRepairWordsSha_(situation || {}); }
  catch (eH) { sha = ''; }
  res.words_sha = String(sha || '');
  res.situation = String((situation && situation.id) || (item && item.situation) || '');
  // THE SENDER AS RENDERED — `vars.sender`, the exact string substituted into the message, not a second resolution…
  res.sender_used = String((vars && vars.sender) || '');
  for (var i = 0; i < order.length; i++) {
    var ch = order[i];
    var r = null;
    if (ch === 'sms') {
      var to = (typeof packetSendableNumber_ === 'function') ? packetSendableNumber_(person.phone) : str_(person.phone);
      if (!to || !str_(situation.sms_text)) continue;
      if (unwritten('sms_text')) {
        res.error = 'the text behind this situation is a generic letter nobody wrote for it — refused';
        continue;
      }
      res.to = to;
      r = rpcCall_('smsSend', { to: to, body: smartRender_(situation.sms_text, vars),
                                reason: 'comms: ' + item.situation + ' · ' + item.intent_key },
                   { idempotency_key: 'ci_' + item.intent_key + '_' + (attempts + 1) });
    } else if (ch === 'email') {
      if (!str_(person.email) || !str_(situation.email_subject)) continue;
      if (unwritten('email_subject') || unwritten('email_text')) {
        res.error = 'the letter behind this situation is a generic credential e-mail nobody ' +
                    'wrote for it — refused';
        continue;
      }
      res.to = str_(person.email);
      r = rpcCall_('emailSend', { to: str_(person.email),
                                  subject: smartRender_(situation.email_subject, vars),
                                  body: smartRender_(situation.email_text, vars),
                                  reason: 'comms: ' + item.situation + ' · ' + item.intent_key },
                   { idempotency_key: 'ci_mail_' + item.intent_key + '_' + (attempts + 1) });
    } else continue;
    if (r && r.ok && (r.sent || r.deduplicated)) {
      // a deduplicated receipt IS a send that landed (HiringOutreach reads it the same way); read as "try the next…
      res.sent = true; res.channel = ch; res.redirected = !!r.redirected;
      res.receipt = str_(r.receipt);
      return res;
    }
    if (r && r.ok && r.gated) { res.gated = true; res.error = str_(r.reason); return res; }
    if (r && !r.ok) {
      res.error = str_(r.error);
      // A DOUBT IS NOT A NO.
      if (commRecordIsDoubt_(res.error)) { res.doubt = true; res.channel = ch; return res; }
    }
  }
  return res;
}

/** Which transport answers mean "we do not know" rather than "no". */
function commRecordIsDoubt_(error) {
  var e = String(error || '').toLowerCase();
  if (!e) return false;
  if (e === 'transport' || e === 'threw' || e === 'provider_bad_shape') return true;
  if (/^provider_5\d\d$/.test(e)) return true;
  if (/^provider_4\d\d$/.test(e)) return false;
  if (e === 'opted_out' || e === 'missing_param' || e === 'no_provider_key' ||
      e === 'no_sending_line' || e === 'undeclared_method' || e === 'test_redirect_no_sms' ||
      e === 'test_redirect_no_email') return false;
  return true;                                   // unknown answers are doubts
}

// THE DOOR THE RELAY RINGS.
HUB_POLICY.commRecordSweep = {
  file: 'CommRecord.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'minutes',
  roles: ['admin'],
  params: { force: { type: 'boolean' } },
  invalidates: [], emits: ['smsSend', 'emailSend']
};
HUB_ACTIONS.commRecordSweep = function (payload, user) {
  var isMachine = !!(user && user.is_service);
  if (!isMachine && (!user || String(user.role) !== 'admin')) return hubDenied_();
  if (payload && (payload.force === true || String(payload.force) === 'true')) {
    return commRecordSweep_(user, { force: true });
  }
  var r = commRecordSweepMaybe_();
  return r || { status: 200, data: { skipped: true,
                                     why: 'inside the six-hour window, or the dial is off' } };
};

/** How far the last pass got. Zero when there is nothing to resume. */
function commRecordCursor_() {
  try {
    return Number(PropertiesService.getScriptProperties()
      .getProperty(COMM_RECORD_CURSOR_KEY) || 0) || 0;
  } catch (e) { return 0; }
}

// Record the resume point, and decide whether the six-hour window stands.
function commRecordCursorSet_(at, settled) {
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty(COMM_RECORD_CURSOR_KEY, String(at));
    if (!settled) props.deleteProperty(COMM_RECORD_SWEEP_KEY);
  } catch (e) { /* the next tick re-decides from whatever survived */ }
}

// THE OBLIGATIONS MATRIX, READ BY HEADER NAME.
function commRecordMatrix_() {
  var sheet = reqStatesSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var width = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, width).getValues()[0]
    .map(function (h) { return String(h || '').trim(); });
  var values = sheet.getRange(2, 1, last - 1, width).getValues();
  var at = {};
  header.forEach(function (h, i) { if (h && at[h] === undefined) at[h] = i; });
  var pick = function (row, name) {
    return at[name] === undefined ? '' : String(row[at[name]] === null ? '' : row[at[name]]).trim();
  };
  return values.map(function (row) {
    return {
      person_key: pick(row, 'person_key'),
      person_name: pick(row, 'person_name'),
      req_id: pick(row, 'req_id'),
      state: pick(row, 'state'),
      expires: pick(row, 'expires'),
      days_left: pick(row, 'days_left')
    };
  }).filter(function (r) { return r.person_key && r.req_id; });
}

// THE WINDOW ON THE CLOCK.
function commRecordSweepMaybe_() {
  if (commDial_() === 'off') return null;
  var props;
  try { props = PropertiesService.getScriptProperties(); } catch (e) { return null; }
  var last = 0;
  try { last = Number(props.getProperty(COMM_RECORD_SWEEP_KEY) || 0) || 0; } catch (e2) { last = 0; }
  var now = new Date().getTime();
  if (last && (now - last) / 1000 < COMM_RECORD_SWEEP_GAP_S) return null;
  // STAMPED BEFORE THE WORK, not after.
  try { props.setProperty(COMM_RECORD_SWEEP_KEY, String(now)); } catch (e3) { /* run anyway */ }
  return commRecordSweep_(null);
}

// THE BOARD — what the rehearsal decided, for a screen to read.
HUB_POLICY.commBoard = {
  file: 'CommRecord.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.commBoard = function (payload, user) {
  if (!user || ['admin', 'director', 'manager'].indexOf(String(user.role)) === -1) {
    return hubDenied_();
  }
  var intents = commBoardRows_(COMM_INTENTS_HOUSE);
  var bindings = commBoardRows_(COMM_BINDINGS_HOUSE);
  var byIntent = {};
  bindings.forEach(function (b) {
    var k = String(b.intent_key || '');
    if (!byIntent[k]) byIntent[k] = [];
    byIntent[k].push(b);
  });
  var rows = intents.map(function (i) {
    var mine = byIntent[String(i.intent_key || '')] || [];
    i.items = mine;
    return i;
  });
  return { status: 200, data: {
    rows: rows,
    dial: commDial_(),
    // WHAT THE SCREEN MUST SAY WHEN IT IS EMPTY, said here rather than guessed there: an empty board at `off` is…
    note: commDial_() === 'off'
      ? 'The dial is off. Nothing is planned and nothing is written.'
      : (rows.length ? '' : 'The dial is on; the sweep has not come round yet.')
  } };
};

/** One house, as objects keyed by its own header. */
function commBoardRows_(tab) {
  var sheet;
  try { sheet = hubTabSheet_(tab); } catch (e) { return []; }
  if (!sheet) return [];
  var values;
  try { values = sheet.getDataRange().getValues(); } catch (e2) { return []; }
  if (!values || values.length < 2) return [];
  var header = values[0].map(String);
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = {}, empty = true;
    for (var c = 0; c < header.length; c++) {
      row[header[c]] = values[r][c];
      if (values[r][c] !== '' && values[r][c] !== null) empty = false;
    }
    if (!empty) out.push(row);
  }
  return out;
}

// Who may be spoken to at all: the active roster, flattened by name.
var COMM_ROSTER_ACTIVE = ['yes', 'admin'];

function commRecordRoster_() {
  var out = {};
  try {
    var rows = (typeof certReadTab_ === 'function') ? certReadTab_(certSourceTab_('master')) : [];
    rows.forEach(function (r) {
      if (COMM_ROSTER_ACTIVE.indexOf(str_(r.status).toLowerCase()) === -1) return;
      var name = str_(r.employee) || (str_(r.firstname) + ' ' + str_(r.lastname));
      var k = (typeof clientNameKey_ === 'function') ? clientNameKey_(name) : '';
      if (k) out[k] = 1;
    });
  } catch (e) { /* an empty roster asks nobody, which is the safe direction */ }
  return out;
}

// Upsert by id into a declared house — the ONE door, as ever.
function commRecordUpsert_(tab, row) {
  var sheet = hubTabSheet_(tab);
  if (!sheet) return;
  var found = findRowIndex_(sheet, row.id);
  row.updatedAt = new Date().toISOString();
  if (!found) row.createdAt = row.updatedAt;
  var header = ensureHeader_(sheet, Object.keys(row));
  if (!found) {
    sheet.appendRow(header.map(function (h) { return serialize_(row[h]); }));
    return;
  }
  var range = sheet.getRange(found, 1, 1, header.length);
  var existing = range.getValues()[0];
  range.setValues([header.map(function (h, i) {
    return Object.prototype.hasOwnProperty.call(row, h) ? serialize_(row[h]) : existing[i];
  })]);
}
