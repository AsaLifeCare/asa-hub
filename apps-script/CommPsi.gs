// Answers the hotline caller who reported PSI Anywhere down, in the same execution, from the relay's verdict.
// up → psyanywhere_false_message; down → psyanywhere_true_message plus its escalation list; unknown or no verdict…

var COMM_PSI_UP_SITUATION = 'psyanywhere_false_message';
var COMM_PSI_DOWN_SITUATION = 'psyanywhere_true_message';

// Must stay in COMM_EMPLOYMENT_PURPOSES, or everyone without an explicit grant is unreachable.
var COMM_PSI_PURPOSE = 'shift';

// Longer than an execution may live, so a retried pass cannot say the same thing twice.
var COMM_PSI_CLAIM_SECONDS = 21600;

var COMM_PSI_TEAM_WINDOW_SECONDS = 3600;


// --- 1. The facts (an allow-list) ---

// Only the name, how it was learned, the day and the key leave; the call transcript never does.
function commPsiFacts_(row) {
  var r = row || {};
  var name = String(r.requestor || r.employee_name || r.name || '').trim();
  var from = String(r.name_from || '').trim();
  if (typeof contactNameFill_ === 'function') {
    var fill = contactNameFill_(name, r.requestor_phone || r.caller_phone || r.phone || '');
    name = fill.name;
    if (!from) from = fill.from;
  } else if (!from && name) {
    from = 'person';
  }
  return {
    name: name,
    name_from: from,
    date: String(r.date_received || r.date || '').slice(0, 10),
    person_key: (from && typeof clientNameKey_ === 'function') ? clientNameKey_(name) : ''
  };
}

function commPsiPurposeOk_() {
  return (typeof COMM_EMPLOYMENT_PURPOSES !== 'undefined') &&
         COMM_EMPLOYMENT_PURPOSES.indexOf(COMM_PSI_PURPOSE) !== -1;
}

// smartSituationOn_ answers only the switch; a row whose words are blank must say nothing on every leg.
function commPsiHasWords_(situation) {
  if (!situation) return false;
  var chans = (typeof commRecordChannels_ === 'function')
    ? commRecordChannels_(situation)
    : ['sms', 'email'];
  for (var i = 0; i < chans.length; i++) {
    if (chans[i] === 'sms' && String(situation.sms_text || '').trim()) return true;
    if (chans[i] === 'email' && String(situation.email_subject || '').trim()) return true;
  }
  return false;
}

function commPsiSituation_(id) {
  var sit = null;
  try {
    sit = (typeof smartSituationOn_ === 'function') ? smartSituationOn_(id) : null;
  } catch (e) { return null; }
  return commPsiHasWords_(sit) ? sit : null;
}

// Claimed per call and situation, so a pass that died after speaking cannot speak again.
function commPsiClaim_(situationId, instance) {
  var key = 'psi_said:' + String(situationId || '') + '|' + String(instance || '');
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get(key)) return false;
    cache.put(key, '1', COMM_PSI_CLAIM_SECONDS);
    return true;
  } catch (e) {
    // An unreadable cache still speaks: the send door's idempotency key refuses a duplicate.
    return true;
  }
}

// Only for an answer the quiet window held, so the morning (commPsiQuietCarry_) can still say it.
function commPsiClaimRelease_(situationId, instance) {
  try {
    CacheService.getScriptCache().remove('psi_said:' + String(situationId || '') + '|' + String(instance || ''));
  } catch (e) {}
}

// The outage hour is anchored at the first page, never rolled forward; an outage still standing after it pages…
function commPsiWindowKey_(situationId, state) {
  return 'psi_outage:' + String(situationId || '') + '|' + String(state || '');
}

function commPsiWindowClaim_(situationId, state, dial) {
  var out = { first: true, callers: 1, since_ms: 0, held_dial: '', superseded: false };
  var key = commPsiWindowKey_(situationId, state);
  var now = Date.now();
  var word = String(dial || '');
  try {
    var cache = CacheService.getScriptCache();
    var hit = cache.get(key);
    var held = hit ? JSON.parse(hit) : null;
    var openedAt = held && Number(held.at) ? Number(held.at) : 0;
    var ageMs = openedAt ? now - openedAt : 0;
    if (openedAt && ageMs >= 0 && ageMs < COMM_PSI_TEAM_WINDOW_SECONDS * 1000) {
      var heldDial = String((held && held.dial) || '');
      // An hour opened under a dial that handed nothing over yields to the first caller whose dial sends.
      if (heldDial && heldDial !== 'send' && word === 'send') {
        out.superseded = true;
        out.callers = (Number(held.n) || 0) + 1;
        out.since_ms = ageMs;
        cache.put(key, JSON.stringify({ at: now, n: out.callers, dial: word }),
                  COMM_PSI_TEAM_WINDOW_SECONDS);
        return out;
      }
      out.first = false;
      out.callers = (Number(held.n) || 0) + 1;
      out.since_ms = ageMs;
      out.held_dial = heldDial;
      var leftS = Math.ceil((COMM_PSI_TEAM_WINDOW_SECONDS * 1000 - ageMs) / 1000);
      cache.put(key, JSON.stringify({ at: openedAt, n: out.callers, dial: heldDial }),
                Math.max(1, leftS));
      return out;
    }
    cache.put(key, JSON.stringify({ at: now, n: 1, dial: word }), COMM_PSI_TEAM_WINDOW_SECONDS);
  } catch (e) {}
  return out;
}

// Released when every copy failed, and by a proved recovery (`up`), so the next outage pages.
function commPsiWindowRelease_(situationId, state) {
  try {
    var cache = CacheService.getScriptCache();
    var key = commPsiWindowKey_(situationId, state);
    var stood = !!cache.get(key);
    cache.remove(key);
    return stood;
  } catch (e) {
    return false;
  }
}

// The transport's shape only: there is no field here for prose to arrive in.
function commPsiItem_(facts, situation, person, instance, verdict) {
  var key = 'PSI|' + String(instance || '') + '|' + String(facts.person_key || '');
  return {
    situation: String((situation && situation.id) || ''),
    key: key,
    name: String(facts.name || ''),
    name_key: String(facts.person_key || ''),
    phone: String((person && person.phone) || ''),
    email: String((person && person.email) || ''),
    credential: String((situation && situation.credential) || ''),
    expires: String(facts.date || ''),
    days_left: '',
    // The minute the relay took the proof, never our clock.
    status_at: psiStampAt_(verdict),
    channels: (situation && situation.channels && situation.channels.length)
      ? situation.channels : ['sms'],
    rehearsal: false, rehearsed: false,
    config: situation,
    correction: '',
    intent_key: key,
    bindings: [], binding_count: 0, raw_bindings: []
  };
}


// --- 2. The one caller ---

// Held by the dial: one row in comm_rehearsal with the words, the audience and the reason. Never throws.
function commPsiRehearse_(res, item, situation, person, route) {
  if (typeof hubRehearsalHeld_ !== 'function' || !situation) return 0;
  var vars = {};
  try {
    vars = (typeof commDispatchVars_ === 'function')
      ? commDispatchVars_(item, situation, function () { return ''; }) : {};
  } catch (eV) { vars = {}; }
  // One row, for the channel commRecordSend_ would really use: it stops at the first with an address and words.
  var order = [String((route && route.channel) || '')]
    .concat((typeof commRecordChannels_ === 'function') ? commRecordChannels_(situation) : ['sms'])
    .filter(function (c, i, arr) { return c && arr.indexOf(c) === i; });
  var pick = null;
  for (var c = 0; c < order.length && !pick; c++) {
    if (order[c] === 'sms' && String((person && person.phone) || '').trim() &&
        String(situation.sms_text || '').trim()) {
      pick = { channel: 'sms', to: String(person.phone) };
    } else if (order[c] === 'email' && String((person && person.email) || '').trim() &&
               String(situation.email_subject || '').trim()) {
      pick = { channel: 'email', to: String(person.email) };
    }
  }
  if (!pick) return 0;
  var wrote = 0;
  {
    var isMail = pick.channel === 'email';
    try {
      hubRehearsalHeld_({
        channel: pick.channel,
        to: pick.to,
        situation: String(situation.id || ''),
        intent_key: String((item && item.intent_key) || ''),
        person_key: String((item && item.name_key) || ''),
        person_name: String((item && item.name) || ''),
        purpose: COMM_PSI_PURPOSE,
        sender_used: String(vars.sender || ''),
        verdict: String(res.state || ''),
        reasons: String(res.why || ''),
        consent: String((route && route.why) || ''),
        subject: isMail ? smartRender_(situation.email_subject, vars) : '',
        body: isMail ? smartRender_(situation.email_text || situation.sms_text, vars)
                     : smartRender_(situation.sms_text, vars),
        reason: 'psi: ' + String(situation.id || ''),
        pass_by: 'asa-hub:comm-psi'
      });
      wrote++;
    } catch (eB) {}
  }
  return wrote;
}

// Every ending is a value, never a throw: the queue row has landed and must not be unwound.
function commPsiSpeakOne_(facts, instance, situation, verdict) {
  var res = { said: false, state: 'held', why: '', channel: '' };

  if (!commPsiPurposeOk_()) {
    res.why = COMM_PSI_PURPOSE + ' is not in COMM_EMPLOYMENT_PURPOSES — every person without ' +
              'an explicit consent row would be judged unreachable for a missing string';
    return res;
  }
  if (typeof commRecordSend_ !== 'function') {
    res.why = 'the send door is absent from this build';
    return res;
  }
  if (!facts.person_key) {
    res.why = 'the request names nobody this lane can key';
    return res;
  }
  // A name from the caller ID is a candidate, never somebody to text.
  if (String(facts.name_from || '') === 'phone') {
    res.why = 'who this was came from the caller ID, not from anybody saying it';
    return res;
  }

  var people = {}, routes = {}, consent = {};
  try { people = (typeof commRecordPeople_ === 'function') ? commRecordPeople_() : {}; } catch (e1) { people = {}; }
  try { routes = (typeof commRecordRoutes_ === 'function') ? commRecordRoutes_() : {}; } catch (e2) { routes = {}; }
  try { consent = (typeof commRecordConsentRows_ === 'function') ? commRecordConsentRows_() : {}; } catch (e3) { consent = {}; }

  var person = (typeof commRecordContact_ === 'function')
    ? commRecordContact_(people, routes, facts.person_key) : null;
  if (!person || (!person.phone && !person.email)) {
    res.why = 'no contact in the People house — a person has to find them';
    return res;
  }
  var refused = (typeof commRecordRefused_ === 'function') ? commRecordRefused_(person) : {};
  var channels = (typeof commRecordChannels_ === 'function')
    ? commRecordChannels_(situation) : ['sms'];
  var route = (typeof commRouteFor_ === 'function')
    ? commRouteFor_(consent[String(facts.person_key || '').trim().toLowerCase()] || [],
                    refused, COMM_PSI_PURPOSE, channels, Date.now())
    : { ok: false, why: 'no consent reader' };
  if (!route.ok) { res.why = route.why; return res; }

  var item = commPsiItem_(facts, situation, person, instance, verdict);

  // This leg bypasses commPlanVerdict_, so it asks the sending dial itself, before the claim.
  var psiDial = commSendDialWord_(null);
  if (!commDialHandsOver_(psiDial)) {
    res.state = 'recorded';
    res.channel = String(route.channel || '');
    res.why = commDialHeldWhy_(psiDial, 1, 'the caller who reported it');
    res.rehearsal_rows = commPsiRehearse_(res, item, situation, person, route);
    return res;
  }

  if (!commPsiClaim_(String(situation.id || ''), instance)) {
    res.state = 'already';
    res.why = 'already told — one answer per caller per call';
    return res;
  }

  var out;
  try {
    out = commRecordSend_(item, situation, person, route, 0, function () { return ''; });
  } catch (eS) {
    // A throw is a doubt (the provider may have taken it), so the claim stays down.
    out = { sent: false, doubt: true, channel: String(route.channel || ''),
            error: 'threw: ' + String((eS && eS.message) || eS) };
  }
  res.said = !!out.sent;
  res.channel = String(out.channel || '');
  if (out.sent && !out.redirected) { res.state = 'told'; res.why = 'answered on ' + res.channel; }
  else if (out.sent && out.redirected) { res.state = 'rehearsed'; res.why = 'test mode — the testers heard it'; }
  else if (out.doubt) { res.state = 'doubt'; res.why = 'the transport may have taken it: ' + String(out.error || ''); }
  else if (out.gated && String(out.error || '') === 'quiet_hours') {
    // Quiet window: nothing left, so the claim is given back and the answer is owed to the morning.
    commPsiClaimRelease_(String(situation.id || ''), instance);
    res.state = 'held_quiet';
    res.why = 'held by the quiet window — owed to the morning';
  }
  else { res.why = String(out.error || 'the send door refused'); }

  if (out.sent) {
    try {
      if (typeof smartRecord_ === 'function') {
        var ledgerKey = (out.redirected && typeof smartRehearsalKey_ === 'function')
          ? smartRehearsalKey_(item.key) : item.key;
        smartRecord_(ledgerKey, String(situation.id || ''), item.name,
                     String(facts.date || ''), out.redirected ? 'rehearsal' : out.channel);
      }
    } catch (eL) {}
  }
  return res;
}


// --- 3. The people who can act on an outage ---

// Team copies: `@` = e-mail, else a number via packetTeamCopyNumber_ (packetSendableNumber_ refuses our own lines).
function commPsiTeamRehearse_(out, situation, dests, channel, body, subject) {
  if (typeof hubRehearsalHeld_ !== 'function' || !dests.length) return 0;
  try {
    hubRehearsalHeld_({
      channel: channel,
      to: dests.join(', '),
      situation: String(situation.id || ''),
      intent_key: 'PSI|escalation|' + String(situation.id || ''),
      person_name: 'the escalation list',
      purpose: COMM_PSI_PURPOSE,
      verdict: 'recorded',
      reasons: out.why.join(' · '),
      subject: subject,
      body: body,
      reason: 'psi outage: ' + String(situation.id || ''),
      pass_by: 'asa-hub:comm-psi'
    });
    return 1;
  } catch (e) { return 0; }
}

function commPsiTellTeam_(situation, verdict, facts, instance, said) {
  // `redirected` (reached the testers) is counted apart from `held` (did not happen).
  var out = { sent: 0, held: 0, redirected: 0, callers: 0, recorded: 0, rehearsal_rows: 0, why: [] };
  if (typeof rpcCall_ !== 'function') { out.why.push('no send door'); return out; }
  var list = (typeof smartList_ === 'function')
    ? smartList_(situation.to).concat(smartList_(situation.cc)) : [];
  if (!list.length) {
    out.why.push('the situation names nobody to escalate to');
    return out;
  }
  var teamDial = commSendDialWord_(null);
  var stands = commPsiWindowClaim_(String(situation.id || ''),
                                   String(verdict && verdict.state), teamDial);
  out.callers = stands.callers;
  if (!stands.first) {
    out.why.push('this outage was already escalated ' +
                 Math.round(stands.since_ms / 60000) + ' min ago — caller ' + stands.callers +
                 ' rides that page rather than repeating it' +
                 (stands.held_dial && stands.held_dial !== 'send'
                   ? ' (that page was HELD BY THE DIAL at `' + stands.held_dial + '` and reached ' +
                     'nobody; it stands so a record run shows the shape a release would produce, ' +
                     'and the first caller after the dial moves pages for real)'
                   : ''));
    return out;
  }
  if (stands.superseded) {
    out.why.push('the standing page for this outage was held by the dial and reached nobody, so ' +
                 'this caller pages for real and the hour restarts here');
  }

  var vars = {};
  try {
    vars = (typeof commDispatchBaseVars_ === 'function')
      ? commDispatchBaseVars_({ name: String(facts.name || ''), raw_bindings: [],
                                expires: String(facts.date || ''), intent_key: '' }, situation,
                              function () { return ''; })
      : {};
  } catch (eV) { vars = {}; }
  vars.status_at = psiStampAt_(verdict);

  var lead = psiTeamLead_(verdict, facts.name_from === 'person' ? facts.name : '', said);
  var render = function (tpl) {
    var body = (typeof smartRender_ === 'function') ? smartRender_(tpl, vars) : String(tpl || '');
    return body ? lead + '\n\n' + body : lead;
  };
  var subject = 'PSI Anywhere is down — ' +
                ((typeof str_ === 'function' ? str_(situation.label) : String(situation.label || '')) ||
                 'the hotline heard it first');

  // These copies go straight to rpcCall_, which never reads the comm dial, so the dial is asked here.
  if (!commDialHandsOver_(teamDial)) {
    out.recorded = list.length;
    out.held = list.length;
    out.why.push(commDialHeldWhy_(teamDial, list.length,
                                  'the people who can act on an outage'));
    var mails = [], texts = [];
    for (var h = 0; h < list.length; h++) {
      var one = String(list[h] || '').trim();
      if (!one) continue;
      if (one.indexOf('@') !== -1) mails.push(one);
      else texts.push(one);
    }
    if (texts.length) {
      out.rehearsal_rows += commPsiTeamRehearse_(out, situation, texts, 'sms',
                                                 render(situation.sms_text), '');
    }
    if (mails.length) {
      out.rehearsal_rows += commPsiTeamRehearse_(out, situation, mails, 'email',
                                                 render(situation.email_text || situation.sms_text),
                                                 subject);
    }
    return out;
  }

  for (var i = 0; i < list.length; i++) {
    var dest = String(list[i] || '').trim();
    if (!dest) continue;
    var idem = 'psi_team' + i + '_' + String(situation.id || '') + '_' + String(instance || '').slice(0, 40);
    try {
      var res;
      if (dest.indexOf('@') !== -1) {
        res = rpcCall_('emailSend', { to: dest, subject: subject,
                                      body: render(situation.email_text || situation.sms_text),
                                      reason: 'psi outage: ' + String(situation.id || '') },
                       { idempotency_key: idem });
      } else {
        var num = (typeof packetTeamCopyNumber_ === 'function')
          ? packetTeamCopyNumber_(dest) : '';
        if (!num) {
          out.held++;
          out.why.push(String(dest).slice(0, 20) + ' is neither an e-mail nor a number we may text');
          continue;
        }
        res = rpcCall_('smsSend', { to: num, body: render(situation.sms_text),
                                    reason: 'psi outage: ' + String(situation.id || '') },
                       { idempotency_key: idem });
      }
      // Count the answer, not the call: rpcCall_ reports gated/redirected/ok:false without throwing. A dedup receipt is a page.
      if (res && res.ok && (res.sent || res.deduplicated) && !res.redirected) {
        out.sent++;
      } else if (res && res.redirected) {
        out.held++;
        out.redirected++;
        out.why.push(String(dest).slice(0, 20) + ': test mode — the testers heard it, not the escalation list');
      } else if (res && res.ok && res.gated) {
        out.held++;
        if (res.quiet) out.quiet = (out.quiet || 0) + 1;
        out.why.push(String(dest).slice(0, 20) + ': held at the send door (' +
                     String(res.reason || res.detail || 'gated') + ')');
      } else {
        out.held++;
        out.why.push(String(dest).slice(0, 20) + ': ' +
                     String((res && (res.error || res.detail)) || 'the send door refused'));
      }
    } catch (eR) {
      out.held++;
      out.why.push(String(dest).slice(0, 20) + ': ' + String((eR && eR.message) || eR));
    }
  }
  // Nobody reached: give the hour back so the next caller pages. A rehearsal keeps it, or testers get paged per caller.
  if (stands.first && !out.sent && !out.redirected) {
    commPsiWindowRelease_(String(situation.id || ''), String(verdict && verdict.state));
    out.why.push('nobody was reached, so the hour was not claimed — the next caller pages');
  } else if (stands.first && !out.sent && out.redirected) {
    out.why.push('REHEARSAL: ' + out.redirected + ' copy(ies) went to the testers and nobody on ' +
                 'the escalation list was reached — the hour is held anyway, because under the ' +
                 'test dial the next caller would rehearse at them again rather than page ' +
                 'anybody real');
  }
  return out;
}


// --- 4. The door the hotline calls ---

// Called by hotlineSweep right after the queue row lands; never throws.
function commPsiReported_(row, instance, verdict, morning) {
  var out = { spoke: false, state: 'held', situation: '', why: '', escalated: 0, callers: 0,
              held: 0, recorded: 0, rehearsal_rows: 0, recovered: false, owed: false };
  var withRecovery = function () {
    if (out.recovered) {
      out.why = (out.why ? out.why + ' · ' : '') +
        'PsiAnywhere answered again, so the outage window was closed — a new outage pages';
    }
    return out;
  };
  try {
    var state = String((verdict && verdict.state) || '');
    if (state !== 'up' && state !== 'down') {
      out.state = 'not_owed';
      out.why = verdict
        ? 'the check did not settle — nothing is claimed to a caller about an unknown'
        : 'no verdict reached this call, and no verdict is not an outage';
      return out;
    }
    // A proved `up` closes the outage window, before any gate below.
    if (state === 'up' && commPsiWindowRelease_(COMM_PSI_DOWN_SITUATION, 'down')) {
      out.recovered = true;
    }

    var inst = String(instance || '');
    if (!inst) {
      out.why = 'no instance — "never twice" cannot be kept without a stable identity';
      return withRecovery();
    }
    var id = state === 'down' ? COMM_PSI_DOWN_SITUATION : COMM_PSI_UP_SITUATION;
    out.situation = id;
    var situation = commPsiSituation_(id);
    if (!situation) {
      out.why = 'the situation `' + id + '` is absent, switched off, or still has no words';
      return withRecovery();
    }

    var facts = commPsiFacts_(row);
    var runCaller = !morning || !!morning.caller;
    var runTeam = !morning || !!morning.team;
    var said = runCaller ? commPsiSpeakOne_(facts, inst, situation, verdict)
                         : (morning.said || { said: false, state: 'held', why: '' });
    out.spoke = !!said.said;
    out.state = said.state;
    out.why = said.why;
    out.rehearsal_rows = Number(runCaller && said.rehearsal_rows) || 0;

    var teamQuiet = 0;
    if (state === 'down' && runTeam) {
      var team = commPsiTellTeam_(situation, verdict, facts, inst, said);
      teamQuiet = (!team.sent && Number(team.quiet)) || 0;
      out.escalated = team.sent;
      out.callers = team.callers;
      out.held = team.held;
      out.recorded = team.recorded || 0;
      out.rehearsal_rows += Number(team.rehearsal_rows) || 0;
      if (team.why.length) out.why = (out.why ? out.why + ' · ' : '') + team.why.join(' · ');
    }
    if (!morning && (said.state === 'held_quiet' || teamQuiet) && typeof hubQuietOwe_ === 'function') {
      out.owed = hubQuietOwe_('psi', inst, {
        row: { requestor: String(facts.name || ''), name_from: String(facts.name_from || ''),
               date_received: String(facts.date || '') },
        instance: inst, state: state,
        caller: said.state === 'held_quiet', team: !!teamQuiet,
        said: { said: false, state: String(said.state || ''), why: String(said.why || '').slice(0, 300),
                channel: String(said.channel || '') }
      });
      out.why = (out.why ? out.why + ' · ' : '') +
        (out.owed ? 'the quiet window held ' + (said.state === 'held_quiet' ? 'her answer' : '') +
                    (said.state === 'held_quiet' && teamQuiet ? ' and ' : '') + (teamQuiet ? 'the page' : '') +
                    ' — said at 08:00 if PsiAnywhere is still ' + state
                  : 'the quiet window held it and the morning list could NOT keep it — it will not be said');
    }
    withRecovery();
    try {
      hubSysLog_('asa-hub:comm', 'psi_answered',
                 id + ' · ' + state + ' · caller: ' + out.state +
                 (out.why ? ' (' + String(out.why).slice(0, 160) + ')' : '') +
                 (state === 'down' ? ' · escalation: ' + out.escalated + ' copy(ies) reached' +
                                     (out.held ? ', ' + out.held + ' held' : '') +
                                     (out.recorded ? ' (the sending dial held ' + out.recorded +
                                                     ' — resolved and written down, nobody ' +
                                                     'contacted)' : '') : '') +
                 (out.rehearsal_rows ? ' · ' + out.rehearsal_rows + ' row(s) in ' +
                                       (typeof HUB_REHEARSAL_HOUSE !== 'undefined'
                                         ? HUB_REHEARSAL_HOUSE : 'the rehearsal house') : ''),
                 { status: 200 });
    } catch (eLg) {}
  } catch (e) {
    out.why = 'the lane threw and the row still stands: ' + String((e && e.message) || e);
    try {
      hubSysLog_('asa-hub:comm', 'psi_lane_error', out.why, { status: 500 });
    } catch (eL) {}
  }
  return out;
}

// The morning rerun (hubQuietOwedCarry_), only if PSI Anywhere is still what it was; an unknown says nothing.
function commPsiQuietCarry_(data) {
  var d = data || {};
  var was = String(d.state || '');
  var v = null;
  try { v = (typeof psiRelayVerdict_ === 'function') ? psiRelayVerdict_() : null; } catch (e) { v = null; }
  var now = String((v && v.state) || '');
  if (now !== 'up' && now !== 'down') {
    return { state: 'stale', why: 'nobody could say whether PsiAnywhere is still ' + (was || 'what it was') +
                                  ' — nothing is said about an unknown' };
  }
  if (now !== was) {
    return { state: 'stale', why: 'PsiAnywhere was ' + was + ' last night and is ' + now + ' now — ' +
                                  'what the night held is no longer true' };
  }
  var res = commPsiReported_(d.row || {}, String(d.instance || ''), v,
                             { caller: !!d.caller, team: !!d.team, said: d.said || null });
  return { state: 'carried', why: 'caller: ' + String(res.state || '') + ' · escalation: ' +
                                  String(res.escalated || 0) + ' copy(ies) reached' };
}
