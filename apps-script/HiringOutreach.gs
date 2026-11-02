// HIRING OUTREACH — the letters and texts the pipeline sends BEFORE a candidate is a candidate, and the two it…
// WHAT THIS FILE IS FOR.

// How many candidates the shortlist letter will ever carry.
var HIRING_SHORTLIST_MAX = 10;

// ------------------------------------------------------------------ the two transports, wrapped once…

// One e-mail, sent, recorded, and REPORTED HONESTLY.
function hiringGreetFirst_(name) {
  var n = String(name || '').replace(/^\s*\[test\]\s*/i, '').trim();
  return n.split(/[\s,]+/)[0] || n;
}

// A card name fit for a subject line or a text: the [TEST] tag stripped and a multi-name rehearsal shortened to…
function hiringShortName_(name) {
  var n = String(name || '').replace(/^\s*\[test\]\s*/i, '').trim();
  var parts = n.split(/\s*,\s*/).filter(String);
  if (parts.length <= 1) return n;
  return parts[0] + ' +' + (parts.length - 1);
}

function outreachSend_(o) {
  var e = o || {};
  var letter = e.letter || {};
  var to = str_(e.to);
  // THE COPY LIST — every e-mail this platform sends carries it in copy.
  var cc = str_(e.cc);
  // The rehearsal tag on the title survives the redirect being off — see simTagSubject_ (it stays quiet while the…
  var subject = (typeof simTagSubject_ === 'function')
    ? simTagSubject_(str_(letter.subject)) : str_(letter.subject);
  var out = {
    step: str_(e.step), channel: 'email', to: to, cc: cc,
    subject: subject, sent: false, redirected: false,
    rehearsal: false, error: '', detail: ''
  };
  if (!to) {
    out.error = 'no_recipient';
    out.detail = 'nobody to write to — the address list resolved empty';
    journeyLog_({ candidate_id: e.candidate_id, name: e.name, step: e.step, channel: 'email',
                  to: '', ok: false, detail: out.detail, by: e.by });
    return out;
  }
  // THE FENCE — no letter leaves for an address outside the configured cast while sim_outbound_guard is on, test…
  var fence = (typeof simOutboundAllowed_ === 'function')
    ? simOutboundAllowed_(to + (cc ? ',' + cc : '')) : { ok: true };
  if (!fence.ok) {
    out.error = fence.reason;
    out.detail = fence.detail;
    journeyLog_({ candidate_id: e.candidate_id, name: e.name, step: e.step, channel: 'email',
                  to: to, ok: false, detail: 'BLOCKED — ' + fence.detail, by: e.by });
    return out;
  }
  var res;
  try {
    res = rpcCall_('emailSend', {
      to: to, subject: subject, body: str_(letter.text),
      html: str_(letter.html), cc: cc,
      reason: str_(e.reason) || 'hiring: ' + str_(e.step)
    });
  } catch (err) {
    res = { ok: false, error: 'threw', detail: String((err && err.message) || err) };
  }
  out.sent = !!(res && res.sent);
  out.redirected = !!(res && res.redirected);
  out.rehearsal = out.redirected;
  out.error = str_(res && (res.error || (res.gated ? 'gated' : '')));
  out.detail = str_(res && (res.detail || res.reason || ''));
  // WHERE IT WENT, not where it was addressed.
  out.delivered_to = (res && res.to) ? str_(res.to) : (out.redirected ? 'the rehearsal address' : to);
  journeyLog_({
    candidate_id: e.candidate_id, name: e.name, step: e.step, channel: 'email',
    to: to, ok: out.sent, rehearsal: out.redirected,
    detail: (out.sent ? 'sent' : 'not sent') + (out.error ? ' — ' + out.error : '') +
            (out.detail ? ': ' + out.detail : '') + ' · subject: ' + out.subject +
            (cc && out.sent && !out.redirected ? ' · cc: ' + cc : ''),
    ref: str_(e.ref), by: e.by
  });
  return out;
}

// One SMS, same contract, same honesty.
function outreachSms_(o) {
  var e = o || {};
  // simSendablePhone_ lets the CAST's shared lines through while the fence is on — production keeps the person-law…
  var to = (typeof simSendablePhone_ === 'function')
    ? simSendablePhone_(str_(e.to)) : packetSendableNumber_(str_(e.to));
  // The sheet trims the intro's trailing space, so the seam gets one back — "waiting.ASA Hub:" was the message that…
  if (str_(e.intro)) e.body = str_(e.intro).replace(/\s*$/, ' ') + str_(e.body);
  var out = { step: str_(e.step), channel: 'sms', to: to, sent: false,
              redirected: false, rehearsal: false, error: '', detail: '',
              body: str_(e.body) };
  if (!to) {
    out.error = 'no_phone';
    out.detail = 'no sendable number on the row — an unsendable number is not a silent skip';
    journeyLog_({ candidate_id: e.candidate_id, name: e.name, step: e.step, channel: 'sms',
                  to: str_(e.to), ok: false, detail: out.detail, by: e.by });
    return out;
  }
  // THE FENCE — no text leaves for a number outside the configured cast while sim_outbound_guard is on, test mode…
  var fence = (typeof simOutboundAllowed_ === 'function')
    ? simOutboundAllowed_(to) : { ok: true };
  if (!fence.ok) {
    out.error = fence.reason;
    out.detail = fence.detail;
    journeyLog_({ candidate_id: e.candidate_id, name: e.name, step: e.step, channel: 'sms',
                  to: to, ok: false, detail: 'BLOCKED — ' + fence.detail, by: e.by });
    return out;
  }
  var res;
  try {
    res = rpcCall_('smsSend', { to: to, body: str_(e.body),
                                reason: str_(e.reason) || 'hiring: ' + str_(e.step) });
  } catch (err) {
    res = { ok: false, error: 'threw', detail: String((err && err.message) || err) };
  }
  out.sent = !!(res && res.sent);
  out.redirected = !!(res && res.redirected);
  out.rehearsal = out.redirected;
  out.error = str_(res && (res.error || (res.gated ? 'gated' : '')));
  out.detail = str_(res && (res.detail || res.reason || ''));
  out.delivered_to = out.redirected ? 'the rehearsal number' : to;
  journeyLog_({
    candidate_id: e.candidate_id, name: e.name, step: e.step, channel: 'sms',
    to: to, ok: out.sent, rehearsal: out.redirected,
    detail: (out.sent ? 'sent' : 'not sent') + (out.error ? ' — ' + out.error : '') +
            (out.detail ? ': ' + out.detail : ''),
    ref: str_(e.ref), by: e.by
  });
  return out;
}

// A situation that EXISTS AND IS OFF is a refusal; a situation that does not exist is silence, and silence does not…
function outreachAllowed_(id) {
  try {
    var found = null;
    smartSituations_().forEach(function (s) { if (str_(s.id) === id) found = s; });
    if (!found) return { ok: true, sit: null };
    if (!smartOn_(found.enabled)) {
      return { ok: false, sit: found,
               reason: 'the Smart Comms situation "' + id + '" is switched off' };
    }
    return { ok: true, sit: found };
  } catch (e) {
    // FAIL-CLOSED: a switch nobody could read may be off, so nothing is sent and the person who pressed the button…
    return { ok: false, sit: null, unreadable: true,
             reason: 'the Smart Comms situations could not be read — nothing was sent; try again' };
  }
}

/** The words a sweep logs when its situation said no: off, or unreadable. */
function outreachIdleWhy_(allow, offWords) {
  return (allow && allow.unreadable) ? String(allow.reason) : String(offWords || '');
}

// ------------------------------------------------------------------ what we know about a candidate, in one shape…

// The first sentence of a summary, for a one-line "why" in a table.
function hiringFirstSentence_(text) {
  var t = String(text || '').trim();
  if (!t) return '';
  var m = t.match(/^[\s\S]*?[.!?](\s|$)/);
  return (m ? m[0] : t).trim().slice(0, 200);
}

// The facts a letter can print about somebody.
function hiringCandidateFacts_(cand, analysis) {
  var c = cand || {}, a = analysis || {};
  var facts = [];
  var where = [str_(c.city), str_(c.state)].filter(String).join(', ');
  if (str_(c.phone)) facts.push({ label: 'Phone', value: str_(c.phone) });
  if (str_(c.email)) facts.push({ label: 'E-mail', value: str_(c.email) });
  if (where) facts.push({ label: 'Where', value: where });
  if (str_(a.compositescore)) facts.push({ label: 'Resume score', value: str_(a.compositescore) + ' / 10' });
  if (str_(c.source)) facts.push({ label: 'Source', value: str_(c.source) });
  return facts;
}

// THE RANKING (step 1).
function hiringRanked_(opts) {
  var o = opts || {};
  var ss = ssOpen_(hubId_('HUB_DB_ID'));
  var byId = {};
  readTabNormalized_(ss, TALENT_RESUME_TAB).forEach(function (a) {
    if (str_(a.candidateid)) byId[str_(a.candidateid)] = a;   // last row wins
  });
  var want = {};
  (o.ids || []).forEach(function (id) { want[str_(id)] = true; });
  var skip = {};
  (o.exclude || []).forEach(function (id) { skip[str_(id)] = true; });
  var wantStage = str_(o.stage);
  var rows = [];
  readTabNormalized_(ss, TALENT_CANDIDATES_TAB).forEach(function (c) {
    var cid = str_(c.candidateid);
    if (!cid) return;
    if (skip[cid]) return;
    if (o.ids && o.ids.length) { if (!want[cid]) return; }
    else {
      var stage = talentStage_(c.status);
      if (!stage) return;                                   // an unmapped status is not a shortlist
      if (wantStage && stage !== wantStage) return;
      if (!wantStage && stage !== 'new') return;
    }
    var a = byId[cid] || {};
    var raw = str_(a.compositescore);
    var score = raw === '' ? null : parseFloat(raw);
    if (score !== null && isNaN(score)) score = null;
    rows.push({
      candidate_id: cid,
      name: str_(c.candidatename),
      score: score,
      why: hiringFirstSentence_(str_(a.summary)) || str_(a.qualification) || '',
      phone: str_(c.phone), email: str_(c.email),
      city: [str_(c.city), str_(c.state)].filter(String).join(', '),
      stage: talentStage_(c.status)
    });
  });
  rows.sort(function (x, y) {
    if (x.score === null && y.score === null) return x.name < y.name ? -1 : 1;
    if (x.score === null) return 1;          // unscored sorts last, never zero
    if (y.score === null) return -1;
    return y.score - x.score;
  });
  var limit = o.limit || HIRING_SHORTLIST_MAX;
  return { rows: rows.slice(0, limit), total: rows.length,
           unscored: rows.filter(function (r) { return r.score === null; }).length };
}

// OUR READING OF THE RANKING (step 2): there has to be an INTERPRETATION of what the analysis says.
function hiringReading_(ranked) {
  var rows = (ranked && ranked.rows) || [];
  if (!rows.length) return '';
  var lines = rows.map(function (r) {
    return '- ' + r.name + (r.score === null ? ' (not scored)' : ' (' + r.score + '/10)') +
           (r.why ? ': ' + r.why : '');
  }).join('\n');
  var prompt = bookText_('Prompts', 'ai_shortlist_reading', '')
    .split('{lines}').join(lines);
  try {
    if (prompt && typeof screenAiChat_ === 'function') {
      var ai = screenAiChat_(prompt, 0.4, 'ai_shortlist_reading');
      if (ai && ai.ok && str_(ai.content).trim()) return str_(ai.content).trim();
    }
  } catch (e) { /* the letter is worth sending without the paragraph */ }
  var scored = rows.filter(function (r) { return r.score !== null; });
  var top = scored[0];
  return 'This is our own resume scoring, read straight off the database: ' +
    scored.length + ' of ' + rows.length + ' in this list carry a score' +
    (top ? ', and ' + top.name + ' is the highest at ' + top.score + ' out of 10' : '') +
    '. The rest are listed without one — that is a resume nobody has scored yet, not a low mark.';
}

// ------------------------------------------------------------------ STEP 0 — the welcome…

HUB_POLICY.hiringWelcomeSend = {
  file: 'HiringOutreach.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { to: { required: false, type: 'string' } },
  invalidates: [], emits: ['emailSend']
};
// Tell the team the Hiring Pipeline is open, who reaches it, and how many people are already in the database…
HUB_ACTIONS.hiringWelcomeSend = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var allow = outreachAllowed_(commSituationId_('hiring.welcome', 'hiring_welcome'));
  if (!allow.ok) return { status: 200, data: { sent: false, reason: allow.reason } };

  var team = hiringTeamRecipients_();
  var to = str_(payload && payload.to) || team.emails.join(', ');
  var count = 0;
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB).forEach(function (c) {
      if (talentStage_(c.status)) count++;
    });
  } catch (e) { count = ''; }

  var letter = hiringWelcomeEmail_({
    roles: ['Admin', 'Manager', 'Interviewer'],
    candidateCount: count,
    subject: ((typeof simText_ === 'function') ? simText_('welcome_subject', '') : '') ||
      str_(allow.sit && allow.sit.email_subject) || '',
    bodyText: (typeof simText_ === 'function') ? simText_('welcome_body', '') : ''
  });
  var res = outreachSend_({
    step: 'welcome', to: to, letter: letter,
    reason: 'hiring: the team is told the pipeline is open', by: str_(user && user.email)
  });
  return { status: 200, data: res };
};

// ------------------------------------------------------------------ STEP 0 — the ask: are we hiring, and how many?

HUB_POLICY.hiringAskSend = {
  file: 'HiringOutreach.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { to: { required: false, type: 'string' } },
  invalidates: [], emits: ['emailSend']
};
// THE ASK TO THE TEAM: is hiring open at the moment, and if so how many already-analysed DSPs do they want?
HUB_ACTIONS.hiringAskSend = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var allow = outreachAllowed_(commSituationId_('hiring.ask', 'hiring_ask'));
  if (!allow.ok) return { status: 200, data: { sent: false, reason: allow.reason } };

  // TO THE DECIDERS, THE WATCHER IN COPY — the three receive it, and the asatech address alone is in copy.
  var addr = (typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
  var to = str_(payload && payload.to) ||
           (addr && addr.to) ||
           hiringTeamRecipients_().emails.join(', ');
  var cc = str_(payload && payload.to)
    ? ((typeof simCcFor_ === 'function') ? simCcFor_(to) : '')
    : ((addr && addr.cc) || '');

  // How many are analyzed and rankable — the number the letter offers.
  var analyzed = '';
  try {
    var joined = tpJoinedRows_(ssOpen_(hubId_('HUB_DB_ID')));
    if (joined.migrated) analyzed = String(tpRank_(joined.rows).length);
  } catch (eTp) { analyzed = ''; }
  if (!analyzed) {
    try {
      var pool = hiringRanked_({});
      analyzed = String(pool.total - pool.unscored);
    } catch (e) { analyzed = ''; }
  }

  var letter = hiringAskEmail_({
    candidateCount: analyzed,
    subject: (typeof simText_ === 'function') ? simText_('ask_subject', '') : '',
    bodyText: (typeof simText_ === 'function') ? simText_('ask_body', '') : ''
  });
  var res = outreachSend_({
    step: 'ask', to: to, cc: cc, letter: letter,
    reason: 'hiring: asking the team whether hiring is open', by: str_(user && user.email)
  });
  if (res.sent && typeof simTrackSend_ === 'function') {
    var tracked = simTrackSend_('ask', '', 'hiringAskSend', { to: str_(payload && payload.to) });
    res.attempt = tracked.attempt;
    res.attempts_max = tracked.of;
  }
 // THE DECIDERS ANSWER BY THEMSELVES while the auto-actor is on.
  if (res.sent && typeof simAutoTeamReply_ === 'function') {
    try { res.auto = simAutoTeamReply_('sim_pretend_ask_reply'); } catch (eAuto) { res.auto = null; }
  }
  return { status: 200, data: res };
};

// ------------------------------------------------------------------ STEP 1 — the shortlist, with our analysis…

HUB_POLICY.hiringShortlistSend = {
  file: 'HiringOutreach.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: {
    candidate_ids: { required: false, type: 'array' },
    // "more options" (step 2c): the ids already named, so the next letter is the NEXT five from the ranking window…
    exclude_ids: { required: false, type: 'array' },
    limit: { required: false, type: 'number' },
    to: { required: false, type: 'string' }
  },
  invalidates: [], emits: ['emailSend']
};
// The ranking, its criteria, and what it means — to the people who decide.
HUB_ACTIONS.hiringShortlistSend = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  return hiringShortlistCore_(payload, user);
};

function hiringShortlistCore_(payload, user) {
  var allow = outreachAllowed_(commSituationId_('hiring.shortlist', 'hiring_shortlist'));
  if (!allow.ok) return { status: 200, data: { sent: false, reason: allow.reason } };

  var p = payload || {};

  // THE WINNERS COME FROM TALENT PIPELINE → ANALYSIS: that is where the five winners are collected from.
  var rows = [];
  var source = 'analysis';
  try {
    var joined = tpJoinedRows_(ssOpen_(hubId_('HUB_DB_ID')));
    if (joined.migrated) {
      // A RETRY RE-SENDS THE SAME FIVE: the first send stored its ids on the ask; with them present the window is…
      var wantIds = (p.candidate_ids || []).map(function (id) { return str_(id); }).filter(String);
      if (wantIds.length) {
        var byId = {};
        joined.rows.forEach(function (r) { byId[str_(r.candidate_id)] = r; });
        wantIds.forEach(function (id) {
          var r = byId[id];
          if (!r) return;
          var score0 = tpRankScore_(r);
          rows.push({
            candidate_id: str_(r.candidate_id), name: str_(r.name),
            score: score0 === null ? null : score0,
            why: hiringFirstSentence_(str_(r.summary)) ||
                 (str_(r.decision) ? 'Decision: ' + str_(r.decision) : ''),
            phone: str_(r.phone), email: str_(r.email), city: str_(r.city)
          });
        });
      } else {
        var skip = {};
        (p.exclude_ids || []).forEach(function (id) { skip[str_(id)] = true; });
        var seenName = {};
        var limit = p.limit || 5;
        tpRank_(joined.rows).forEach(function (r) {
          if (rows.length >= limit) return;
          if (skip[str_(r.candidate_id)]) return;
          if (str_(r.status).toLowerCase() === 'duplicate') return;
          var nameKey = str_(r.name).toLowerCase().replace(/[^a-z]/g, '');
          if (!nameKey || seenName[nameKey]) return;
          seenName[nameKey] = true;
          var score = tpRankScore_(r);
          rows.push({
            candidate_id: str_(r.candidate_id), name: str_(r.name),
            score: score === null ? null : score,
            why: hiringFirstSentence_(str_(r.summary)) ||
                 (str_(r.decision) ? 'Decision: ' + str_(r.decision) : ''),
            phone: str_(r.phone), email: str_(r.email), city: str_(r.city)
          });
        });
      }
    }
  } catch (eTp) { rows = []; }

  // The hiring DB is the FALLBACK — an installation whose Analysis was never migrated still gets a letter, and the…
  var ranked = null;
  if (!rows.length) {
    source = 'hiring db';
    ranked = hiringRanked_({ ids: p.candidate_ids || [], exclude: p.exclude_ids || [],
                             limit: p.limit || HIRING_SHORTLIST_MAX });
    rows = ranked.rows.map(function (r) {
      return { candidate_id: r.candidate_id, name: r.name, score: r.score,
               why: r.why, phone: r.phone, email: r.email, city: r.city };
    });
  }
  if (!rows.length) {
    return { status: 200, data: { sent: false, reason: 'nobody_to_rank',
             detail: 'neither the Analysis nor the hiring DB has anybody to rank — a letter ' +
                     'with an empty table says nothing' } };
  }

 // TO THE DECIDERS, THE WATCHER IN COPY — the team-letter law.
  var addr = (typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
  var to = str_(p.to) || (addr && addr.to) || hiringTeamRecipients_().emails.join(', ');
  var cc = str_(p.to)
    ? ((typeof simCcFor_ === 'function') ? simCcFor_(to) : '')
    : ((addr && addr.cc) || '');
  var letter = hiringShortlistEmail_({
    rows: rows.map(function (r) {
      return { name: r.name, score: r.score === null ? '' : r.score, why: r.why,
               phone: r.phone, email: r.email, city: r.city };
    }),
    reading: source === 'analysis'
      ? 'These are the Analysis winners, in order — the same ranking the Talent Pipeline ' +
        'Analysis screen shows, computed by the same formula. Reply with the names you want ' +
        'us to proceed with, OK for all of them, or ask for more options.'
      : hiringReading_(ranked),
    // THE CRITERIA, NAMED — criteria A, B, C, D are stated outright — the Analysis screen's own formula, said in…
    criteria: source === 'analysis'
      ? [
          'Nota — the resume composite (skills 1.5 · experience 1.5 · job history 1.0 · ' +
            'certifications 0.5) brought to a 0–10 scale',
          'Qualification — +0.5 when the phone-screen qualification passed',
          'Screen checks — +0.25 when all six are true (DODD, CPR, Med Delegation, ' +
            'licence, vehicle, insurance)',
          'Red flags — −0.75 each (short tenure, no certs, stale experience). ' +
            'Eligible: decision Advance, CJIS not failed, screen not rejected.'
        ]
      : [
          'Skills — weight 1.5 of the composite (0–10)',
          'Experience — weight 1.5 (years of caregiving, recency, tenure)',
          'Job history — weight 1.0 (consistency, agencies, leadership)',
          'Certifications — weight 0.5 (DODD, CPR, Med, licences). Red flags are named per ' +
            'row; an unscored resume prints a dash, never a zero.'
        ],
    subject: ((typeof simText_ === 'function') ? simText_('shortlist_subject', '') : '') ||
      str_(allow.sit && allow.sit.email_subject) || '',
    bodyText: (typeof simText_ === 'function') ? simText_('shortlist_body', '') : ''
  });
  var res = outreachSend_({
    step: 'shortlist', to: to, cc: cc, letter: letter,
    reason: 'hiring: the Analysis winners and our reading of them', by: str_(user && user.email)
  });
  if (res.sent && source === 'analysis' && !(p.candidate_ids || []).length) {
    // THE COLLECTION CONSUMES: a FRESH collection's five leave the Analysis pool and the ranking re-runs by itself…
    var rehearsing = false;
    try {
      if (typeof hubTestModeState_ === 'function') rehearsing = !!hubTestModeState_().on;
    } catch (eT2) {}
    var detail;
    if (rehearsing) {
      detail = 'five collected from the Talent Pipeline Analysis (rehearsal — the real pool is not consumed)';
    } else {
      var got = 0;
      try {
        got = tpMarkCollected_(rows.map(function (r) { return str_(r.candidate_id); }),
                               str_(user && user.email));
      } catch (eCol) {}
      detail = 'five collected from the Talent Pipeline Analysis — ' + got +
               ' left the pool; the Analysis re-ranks itself and the next collection sees the next five';
    }
    try {
      journeyLog_({ candidate_id: '', name: '', step: 'shortlist', channel: 'record',
                    ok: true, detail: detail, by: str_(user && user.email) });
    } catch (eJr) {}
  }
  if (res.sent && typeof simTrackSend_ === 'function') {
    // The ask remembers ITS five — the retry pass re-presents the same letter.
    var tracked = simTrackSend_('shortlist', '', 'hiringShortlistSend',
      { limit: p.limit || 5, exclude_ids: p.exclude_ids || [],
        candidate_ids: rows.map(function (r) { return str_(r.candidate_id); }) });
    res.attempt = tracked.attempt;
    res.attempts_max = tracked.of;
  }
  res.source = source;
  res.ranked = rows;
  res.unscored = rows.filter(function (r) { return r.score === null; }).length;
  res.pool = ranked ? ranked.total : rows.length;
  // The journey carries one line per candidate NAMED in the letter, so a person's own card says they were put in…
  rows.forEach(function (r) {
    journeyLog_({ candidate_id: r.candidate_id, name: r.name, step: 'shortlist',
                  channel: 'email', to: to, ok: res.sent,
                  detail: 'named among the winners' +
                          (r.score === null ? ' (not scored)' : ' at ' + r.score) +
                          ' — source: ' + source,
                  by: str_(user && user.email) });
  });
  // THE DECIDERS CHOOSE BY THEMSELVES while the auto-actor is on — the choice births the card with every chosen…
  if (res.sent && !(payload && payload.no_auto) && typeof simAutoTeamReply_ === 'function') {
    try { res.auto = simAutoTeamReply_('sim_pretend_interest_reply'); } catch (eAuto) { res.auto = null; }
  }
  return { status: 200, data: res };
}

// ------------------------------------------------------------------ STEP 3 — thanking whoever answered…

HUB_POLICY.hiringInterestThanksSend = {
  file: 'HiringOutreach.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: {
 // Optional: absent falls back to the configured deciders (Arthur and Ty), with the copy list in Cc.
    to: { required: false, type: 'string' },
    about: { required: false, type: 'string' },
    candidate_id: { required: false, type: 'string' }
  },
  invalidates: [], emits: ['emailSend']
};
// Somebody replied with a name or another contact — say thank you and say what happens next.
HUB_ACTIONS.hiringInterestThanksSend = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  // A Smart Comms situation (hiring_interest_thanks): off, the button sends nothing and says so.
  var thanksSit = hubLaneSituation_('hiring_interest_thanks');
  if (!thanksSit.on || !thanksSit.leg('email')) {
    return { status: 200, data: { sent: false, reason: thanksSit.why || 'the situation hiring_interest_thanks writes no letter' } };
  }
  var p = payload || {};
  var addr = (typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
  var to = str_(p.to) || (addr && addr.to) || '';
  var cc = str_(p.to)
    ? ((typeof simCcFor_ === 'function') ? simCcFor_(to) : '')
    : ((addr && addr.cc) || '');
  var about = str_(p.about);
  if (!about) {
    // THE WHOLE GROUP THAT WAS CHOSEN — five chosen means five in the e-mail; four chosen would mean four.
    try {
      var convLines = journeyFor_('') || [];
      for (var li = convLines.length - 1; li >= 0; li--) {
        var ln = convLines[li];
        if (!str_(ln.candidate_id) && str_(ln.step) === 'interest' &&
            str_(ln.title) === 'The team chose who to proceed with' && str_(ln.name)) {
          about = str_(ln.name);
          break;
        }
      }
    } catch (eJ) { /* the letter still thanks without names */ }
  }
  var thanksWho = hiringTeamName_(to.split(',')[0]);
  var thanksVars = { who: thanksWho || 'there', about: about || 'them' };
  var letter = hiringInterestThanksEmail_({
    who: thanksWho, about: about,
    subject: thanksSit.word('email_subject', ((typeof simText_ === 'function') ? simText_('thanks_subject', '') : '')
      .replace(/\{about\}/g, about || 'them'), thanksVars),
    bodyText: thanksSit.word('email_text', ((typeof simText_ === 'function') ? simText_('thanks_body', '') : '')
      .replace(/\{who\}/g, thanksWho || 'there').replace(/\{about\}/g, about || 'them'), thanksVars)
  });
  var res = outreachSend_({
    candidate_id: str_(p.candidate_id), name: about,
    step: 'interest_thanks', to: to, cc: cc, letter: letter,
    reason: 'smart comms: hiring_interest_thanks', by: str_(user && user.email)
  });
  return { status: 200, data: res };
};

// ------------------------------------------------------------------ STEP 4 — the text to a candidate we only have…

HUB_POLICY.hiringOutreachSms = {
  file: 'HiringOutreach.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' } },
  invalidates: ['candidates'], emits: ['smsSend']
};
// "A recruiter will call you about an opportunity — are you interested?" The recruiter is NAMED in the message…
HUB_ACTIONS.hiringOutreachSms = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload && payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var allow = outreachAllowed_(commSituationId_('hiring.outreach', 'hiring_outreach'));
  if (!allow.ok) return { status: 200, data: { sent: false, reason: allow.reason } };

  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  var name = str_(ev.cand.candidatename);
  var first = hiringGreetFirst_(name);

  // OPT-OUT IS ANSWERED BY THE PLATFORM'S OWN PREDICATE, asked EARLY so the screen can say why nothing will go…
  if (typeof optOutBlocked_ === 'function') {
    try {
      var stopped = optOutBlocked_(str_(ev.cand.phone));
      if (stopped) {
        return { status: 200, data: { sent: false, reason: 'opted_out', detail: stopped } };
      }
    } catch (e) { /* the sender refuses on an unreadable list; it is not our call */ }
  }

  var recruiter = str_((payload && payload.recruiter) || '');
  // The config cell ALWAYS wins — type a name in sim_recruiter_name and every letter says it.
  if (!recruiter && typeof simCfgVal_ === 'function') {
    recruiter = simCfgVal_('sim_recruiter_name');
  }
  if (!recruiter) {
    // THE ONE WHO CHOSE IS THE ONE WHO WANTS TO TALK — the letter used to name the first of the team list, whoever…
    try {
      var chLines = journeyFor_('') || [];
      for (var ci = chLines.length - 1; ci >= 0; ci--) {
        var cl = chLines[ci];
        if (!str_(cl.candidate_id) && str_(cl.step) === 'interest' &&
            str_(cl.title) === 'The team chose who to proceed with') {
          var cm = str_(cl.detail).match(/reply from ([^\s(]+)/);
          if (cm) recruiter = hiringTeamName_(cm[1]);
          break;
        }
      }
    } catch (eRec) { recruiter = ''; }
  }
  if (!recruiter) {
    var team = hiringTeamRecipients_();
    recruiter = team.names[(team.emails[0] || '').toLowerCase()] ||
      bookText_('Strings', 'outreach.recruiter.floor', '');
  }
  var body = str_(allow.sit && allow.sit.sms_text) ||
    bookText_('Strings', 'outreach.sms.floor', '').split('{first}').join(first);
  body = body.replace(/\{first_name\}/g, first).replace(/\{name\}/g, name)
             .replace(/\{recruiter\}/g, recruiter);

  var res = outreachSms_({
    candidate_id: cid, name: name, step: 'outreach_sms',
    to: str_(ev.cand.phone), body: body,
    reason: 'hiring: first contact by text', by: str_(user && user.email)
  });
  hubBustTalentCache_();
  return { status: 200, data: res };
};

// ------------------------------------------------------------------ STEP 4 — the outreach, BOTH channels, several…

HUB_POLICY.hiringOutreachSend = {
  file: 'HiringOutreach.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: {
    candidate_ids: { required: false, type: 'array' },
    candidate_id: { required: false, type: 'string' }
  },
  invalidates: ['candidates'], emits: ['emailSend', 'smsSend']
};
// SEND SMS AND E-MAIL, and although the screen pretends only one was selected it works for several.
HUB_ACTIONS.hiringOutreachSend = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var p = payload || {};
  var allow = outreachAllowed_(commSituationId_('hiring.outreach', 'hiring_outreach'));
  if (!allow.ok) return { status: 200, data: { sent: false, reason: allow.reason } };

  var ids = [];
  if (Array.isArray(p.candidate_ids)) ids = p.candidate_ids.map(function (x) { return str_(x); });
  if (str_(p.candidate_id)) ids.push(str_(p.candidate_id));
  ids = ids.filter(function (x) { return /^CAN_[A-Za-z0-9]{6,}$/.test(x); });
  if (!ids.length && typeof hiringSimCard_ === 'function') {
    var card = hiringSimCard_();
    if (card) ids = [str_(card.candidateid)];
  }
  if (!ids.length) return { status: 400, message: 'Which candidate(s)? None was named and no rehearsal card exists.' };
  if (ids.length > 25) return { status: 400, message: 'Up to 25 candidates in one press.' };

  var recruiter = str_(p.recruiter);
  if (!recruiter) {
    var team = hiringTeamRecipients_();
    recruiter = team.names[(team.emails[0] || '').toLowerCase()] ||
      bookText_('Strings', 'outreach.recruiter.floor', '');
  }

  var results = [];
  ids.forEach(function (cid) {
    var ev = hubEvidence_(cid);
    if (!ev.cand) { results.push({ candidate_id: cid, error: 'no such candidate' }); return; }
    var name = str_(ev.cand.candidatename);
    var first = hiringGreetFirst_(name);
    var one = { candidate_id: cid, name: name, sms: null, email: null };

    // Opted out is answered early so the screen can say why nothing went.
    if (typeof optOutBlocked_ === 'function') {
      try {
        var stopped = optOutBlocked_(str_(ev.cand.phone));
        if (stopped) { one.sms = { sent: false, reason: 'opted_out', detail: stopped }; }
      } catch (eO) { /* the sender refuses on an unreadable list */ }
    }
    if (!one.sms) {
      var smsBody = (typeof simText_ === 'function' ? simText_('outreach_sms', '') : '') ||
        str_(allow.sit && allow.sit.sms_text) ||
        bookText_('Strings', 'outreach.sms.floor', '').split('{first}').join(first);
      smsBody = smsBody.replace(/\{first_name\}/g, first).replace(/\{name\}/g, name)
                       .replace(/\{recruiter\}/g, recruiter);
      one.sms = outreachSms_({
        candidate_id: cid, name: name, step: 'outreach_sms',
        to: str_(ev.cand.phone), body: smsBody,
        intro: (typeof simQuoIntro_ === 'function')
          ? simQuoIntro_(bookText_('Strings', 'purpose.first_contact', '')) : '',
        reason: 'hiring: first contact by text', by: str_(user && user.email)
      });
    }

    var email = str_(ev.cand.email);
    if (email.indexOf('@') !== -1) {
      var letter = hiringOutreachEmail_({
        name: name, recruiter: recruiter,
        subject: (typeof simText_ === 'function') ? simText_('outreach_email_subject', '') : '',
        bodyText: ((typeof simText_ === 'function') ? simText_('outreach_email_body', '') : '')
          .replace(/\{first_name\}/g, first).replace(/\{name\}/g, name)
          .replace(/\{recruiter\}/g, recruiter)
      });
      one.email = outreachSend_({
        candidate_id: cid, name: name, step: 'outreach_sms', to: email,
        cc: (typeof simCcFor_ === 'function') ? simCcFor_(email) : '',
        letter: letter,
        reason: 'hiring: first contact by letter', by: str_(user && user.email)
      });
    } else {
      one.email = { sent: false, reason: 'no_email' };
    }

    if (((one.sms && one.sms.sent) || (one.email && one.email.sent)) &&
        typeof simTrackSend_ === 'function') {
      var tracked = simTrackSend_('outreach', cid, 'hiringOutreachSend', { candidate_ids: [cid] });
      one.attempt = tracked.attempt;
      one.attempts_max = tracked.of;
    }
 // THE CANDIDATE ANSWERS BY ITSELF while the auto-actor is on: a real SMS from the actor line, a real letter from…
    if (((one.sms && one.sms.sent) || (one.email && one.email.sent)) &&
        typeof simAutoOutreachReply_ === 'function') {
      try { one.auto = simAutoOutreachReply_(cid, user); } catch (eAuto) { one.auto = null; }
    }
    results.push(one);
  });
  hubBustTalentCache_();
  var anySent = results.some(function (r) {
    return (r.sms && r.sms.sent) || (r.email && r.email.sent);
  });
  return { status: 200, data: {
    sent: anySent,
    redirected: results.some(function (r) {
      return (r.sms && r.sms.redirected) || (r.email && r.email.redirected);
    }),
    candidates: results
  } };
};

// THE ANSWER TO THAT TEXT (step 4, second half).
var QUO_INBOUND_LINE = null;

// THE SHEET MIRROR DIED ON 5/7 — THE PROVIDER IS THE LANE NOW, so a reply SMS lands automatically.
function quoInboundPull_(cid, name, phone) {
  var out = { pulled: 0, error: '' };
  var digits = String(phone || '').replace(/\D/g, '').replace(/^1/, '');
  if (digits.length !== 10) { out.error = 'no_number'; return out; }
  var apiKey = hubProp_(typeof SCRAPER_OPENPHONE_PROP !== 'undefined'
    ? SCRAPER_OPENPHONE_PROP : 'OPENPHONE_API_KEY');
  if (!apiKey) { out.error = 'no_provider_key'; return out; }
  if (!QUO_INBOUND_LINE) {
    try {
      var lines = UrlFetchApp.fetch('https://api.openphone.com/v1/phone-numbers',
        { headers: { Authorization: apiKey }, muteHttpExceptions: true });
      if (lines.getResponseCode() === 200) {
        ((JSON.parse(lines.getContentText()) || {}).data || []).forEach(function (p) {
          if (String(p.name) === 'Automations') {
            QUO_INBOUND_LINE = { id: str_(p.id), number: str_(p.number) };
          }
        });
      }
    } catch (eL) { QUO_INBOUND_LINE = null; }
  }
  if (!QUO_INBOUND_LINE || !QUO_INBOUND_LINE.id) { out.error = 'no_sending_line'; return out; }
  var res;
  try {
    res = UrlFetchApp.fetch('https://api.openphone.com/v1/messages?phoneNumberId=' +
      encodeURIComponent(QUO_INBOUND_LINE.id) +
      '&participants[]=' + encodeURIComponent('+1' + digits) + '&maxResults=20',
      { headers: { Authorization: apiKey }, muteHttpExceptions: true });
  } catch (eF) { out.error = 'provider_unreachable'; return out; }
  if (res.getResponseCode() !== 200) { out.error = 'provider_' + res.getResponseCode(); return out; }
  var msgs = [];
  try { msgs = (JSON.parse(res.getContentText()) || {}).data || []; } catch (eP) { msgs = []; }
  if (!msgs.length) return out;
  var have = {};
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), INBOUND_TAB).forEach(function (m) {
      var id = str_(m.messageid);
      if (id) have[id] = true;
    });
  } catch (eR) { out.error = 'inbound_unreadable'; return out; }  // never double-file blind
  msgs.forEach(function (m) {
    if (str_(m.direction) !== 'incoming') return;
    // OUR OWN LINE IS NOT SOMEBODY WRITING BACK.
    var fromDigits = str_(m.from).replace(/\D/g, '').slice(-10);
    if (typeof inboundIsOurs_ === 'function' && inboundIsOurs_(fromDigits)) return;
    var mid = str_(m.id);
    if (!mid || have[mid]) return;
    var body = str_(m.text || m.content || m.body);
    // A STOP is filed as a stop and kept on the list, as the other ears do.
    var intent = (typeof optOutIntent_ === 'function' && optOutIntent_(body)) || 'reply';
    if (intent === 'opt-out' || intent === 'wrong-number') {
      try {
        optOutAdd_(str_(m.from), { name: name, candidateId: cid,
                                   source: intent === 'opt-out' ? 'sms reply' : 'wrong number',
                                   phrase: body.slice(0, 120), messageId: mid, by: 'asa-hub:outreach',
                                   scope: intent === 'wrong-number' ? optOutScopeForLine_(QUO_INBOUND_LINE.number) : '' });
      } catch (eO) {}
    }
    hubAppendRow_(INBOUND_TAB, {
      message_id: mid,
      received_at: str_(m.createdAt),
      from_number: str_(m.from),
      from_key: str_(m.from).replace(/\D/g, '').slice(-10),
      candidate_id: str_(cid),
      person_name: str_(name),
      body: body,
      intent: intent,
      our_number: QUO_INBOUND_LINE.number,
      recorded_at: new Date().toISOString()
    });
    out.pulled++;
  });
  return out;
}

function hiringOutreachReplyScan_(cid, user) {
  var out = { checked: 0, matched: false, announced: false, reply: '' };
  var name = '', phone = '';
  try {
    var ev = hubEvidence_(cid);
    if (!ev.cand) return out;
    name = str_(ev.cand.candidatename);
    phone = str_(ev.cand.phone);
  } catch (e) { return out; }
  // The provider's copy first, the tab second — a real SMS reply reaches the same rows the pretend writes, and the…
  try { out.pull = quoInboundPull_(cid, name, phone); } catch (eQ) { /* the tab still answers */ }

  var already = false;
  var journey = journeyFor_(cid) || [];
  journey.forEach(function (j) { if (j.step === 'outreach_reply') already = true; });

  var yes = null;
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), INBOUND_TAB).forEach(function (m) {
      if (str_(m.candidateid) !== cid) return;
      out.checked++;
      // PUNCTUATION OUT BEFORE THE MATCH, and the pattern carries no apostrophe of its own: "I'm interested" and…
      var body = str_(m.body).trim().toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
      var oreYes = bookWordsRegex_('words.outreach.yes', 'start');
      if (oreYes && oreYes.test(body)) {
        yes = m;                                   // last one wins
      }
    });
  } catch (e) { return out; }
  if (!yes) return out;

  out.matched = true;
  out.reply = str_(yes.body);
  // The asking ended the moment they answered — the retry clock must not text a person who already said yes.
  if (typeof simAskAnswer_ === 'function') simAskAnswer_(['outreach'], 'the candidate', cid);
  if (already) return out;                         // said once, not once per sweep

  var told = hiringAcceptedTell_(cid, name, phone, str_(yes.body), user);
  out.announced = !!told.emailed;
  out.sms_told = told.smsed;
  return out;
}

// STEP 5 — THEY SAID YES, TOLD PROPERLY: an e-mail and an OpenPhone message go to Arthur and Ty saying the recruit…
function hiringAcceptedTell_(cid, name, phone, reply, user) {
  // Subjects and texts carry the SHORT name — the card keeps the full five.
  name = (typeof hiringShortName_ === 'function') ? hiringShortName_(name) : name;
  var out = { emailed: false, smsed: 0 };
  // A Smart Comms situation (hiring_candidate_accepted): off, the team is not told; the acceptance stands.
  var accSit = hubLaneSituation_('hiring_candidate_accepted');
  if (!accSit.on) { out.why = accSit.why; return out; }
  var accVars = { name: name, reply: str_(reply).slice(0, 300), phone: phone || '(no number on file)' };
  var actors = (typeof hiringSimActors_ === 'function') ? hiringSimActors_() : null;
  var addr = (typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
  var to = (addr && addr.to) || hiringTeamRecipients_().emails.join(', ');
  var email = '';
  try { email = str_(hubEvidence_(cid).cand.email); } catch (e) { email = ''; }

  var letter = hiringAcceptedEmail_({
    name: name, reply: str_(reply), phone: phone, email: email,
    subject: accSit.word('email_subject', ((typeof simText_ === 'function') ? simText_('accepted_subject', '') : '')
      .replace(/\{name\}/g, name), accVars),
    bodyText: accSit.word('email_text', ((typeof simText_ === 'function') ? simText_('accepted_body', '') : '')
      .replace(/\{name\}/g, name).replace(/\{reply\}/g, str_(reply).slice(0, 300))
      .replace(/\{phone\}/g, phone || '(no number on file)'), accVars)
  });
  if (accSit.leg('email')) {
    var res = outreachSend_({
      candidate_id: cid, name: name, step: 'outreach_reply',
      to: to, cc: (addr && addr.cc) || '',
      letter: letter,
      reason: 'smart comms: hiring_candidate_accepted',
      by: str_(user && user.email) || 'asa-hub:sweep'
    });
    out.emailed = !!res.sent;
  }

  // And the Quo message to the team's own numbers — who is writing, why, and what is next, in one text.
  var numbers = !accSit.leg('sms') ? [] : (actors && actors.decider_sms && actors.decider_sms.length)
    ? actors.decider_sms
    : ((actors && actors.team_sms.length) ? actors.team_sms : []);
  var smsBody = accSit.word('sms_text', ((typeof simText_ === 'function') ? simText_('accepted_sms', '') : '')
      .replace(/\{name\}/g, name).replace(/\{phone\}/g, phone || '') ||
    bookText_('Strings', 'accepted.sms.floor', '')
      .split('{phone_line}').join(phone
        ? bookText_('Strings', 'accepted.phone_line.floor', '').split('{phone}').join(phone)
        : '')
      .split('{name}').join(name), accVars);
  numbers.forEach(function (n) {
    var r = outreachSms_({
      candidate_id: cid, name: name, step: 'outreach_reply', to: n, body: smsBody,
      intro: (typeof simQuoIntro_ === 'function')
        ? simQuoIntro_(bookText_('Strings', 'purpose.accepted', '')) : '',
      reason: 'smart comms: hiring_candidate_accepted',
      by: str_(user && user.email) || 'asa-hub:sweep'
    });
    if (r.sent) out.smsed++;
  });
  return out;
}

HUB_POLICY.hiringScreenCallSend = {
  file: 'HiringOutreach.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' } },
  invalidates: [], emits: ['emailSend', 'smsSend']
};
// STEP 5.2 — the hub answers the candidate who said yes: call the interview evaluation line (the 4040), finish the…
HUB_ACTIONS.hiringScreenCallSend = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload && payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  // THE SWITCH AND THE WORDS ARE A SITUATION ROW — everything is configured in smart comms, nothing is left welded…
  var scSit = (typeof outreachAllowed_ === 'function')
    ? outreachAllowed_(commSituationId_('hiring.screen.invitation', 'hiring_screen_call')) : { ok: true, sit: null };
  if (!scSit.ok) {
    return { status: 200, data: { sent: false, reason: 'situation_off', detail: scSit.reason } };
  }
  // THE CARD MAY HAVE MOVED ON.
  if (str_(ev.cand.archived).toLowerCase() === 'true' ||
      talentStage_(str_(ev.cand.status)) !== 'phone-screen') {
    try { simAskAnswer_(['screen_call'], 'the card moved on — the machine lets go', cid); } catch (eG) {}
    return { status: 200, data: { sent: false, reason: 'card_moved_on' } };
  }
  try {
    var scDone = false;
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), 'entity_phone_screens').forEach(function (p) {
      if (str_(p.candidateid) === cid) scDone = true;
    });
    if (scDone) {
      try { simAskAnswer_(['screen_call'], 'a screen is already on the record', cid); } catch (eG2) {}
      return { status: 200, data: { sent: false, reason: 'screen_recorded' } };
    }
  } catch (eSc) { /* unreadable tab — the send may still go; the settler closes it later */ }
  var name = str_(ev.cand.candidatename);
  var first = hiringGreetFirst_(name);
  var actors = (typeof hiringSimActors_ === 'function') ? hiringSimActors_() : null;
  var line = (actors && actors.screen_line) || '';
  if (!line) {
    return { status: 200, data: { sent: false, reason: 'no_screen_line',
             detail: 'sim_screen_line is empty — there is no number to tell them to call' } };
  }

  var out = { sent: false, email: null, sms: null, line: line };
  // The situation row FIRST — that is the screen this is edited on — then the hiring_sim_config cell, so words…
  var scLabel = line.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') || line;
  var scWords_ = function (sitKey, cfgKey, floor) {
    var v = str_(scSit.sit && scSit.sit[sitKey]);
    if (!v && typeof simText_ === 'function') v = simText_(cfgKey, '');
    return String(v || floor)
      .replace(/\{first_name\}/g, first).replace(/\{name\}/g, name)
      .replace(/\{screen_line\}/g, scLabel).replace(/\{line\}/g, scLabel);
  };
  var email = str_(ev.cand.email);
  if (email.indexOf('@') !== -1) {
    var letter = hiringScreenCallEmail_({
      name: name, line: line,
      subject: scWords_('email_subject', 'screen_call_subject',
                        bookText_('Strings', 'screen_call.subject.floor', '')),
      bodyText: scWords_('email_text', 'screen_call_body',
                         bookText_('Strings', 'screen_call.body.floor', ''))
    });
    out.email = outreachSend_({
      candidate_id: cid, name: name, step: 'screen_call', to: email,
      cc: (typeof simCcFor_ === 'function') ? simCcFor_(email) : '',
      letter: letter,
      reason: 'hiring: telling the candidate to call the evaluation line',
      by: str_(user && user.email)
    });
  } else {
    out.email = { sent: false, reason: 'no_email' };
  }
  out.sms = outreachSms_({
    candidate_id: cid, name: name, step: 'screen_call',
    to: str_(ev.cand.phone),
    body: scWords_('sms_text', 'screen_call_sms',
                   bookText_('Strings', 'screen_call.sms.floor', '')),
    intro: (typeof simQuoIntro_ === 'function')
      ? simQuoIntro_(bookText_('Strings', 'purpose.screen_call', '')) : '',
    reason: 'hiring: telling the candidate to call the evaluation line',
    by: str_(user && user.email)
  });
  out.sent = !!((out.email && out.email.sent) || (out.sms && out.sms.sent));
  out.redirected = !!((out.email && out.email.redirected) || (out.sms && out.sms.redirected));
  // the wait enters the book: the redo loop (screenRedoSweepMaybe_) watches every OPEN screen_call ask until a…
  if (out.sent && typeof simTrackSend_ === 'function') {
    try { simTrackSend_('screen_call', cid, 'hiringScreenCallSend', { candidate_id: cid }); } catch (eT) {}
  }
  return { status: 200, data: out };
};

// STEP 11'S LOOP — when a call does not work out (hung up before the end, too much noise, any other reason) the…
var SCREEN_REDO_SEEN_PROP = 'SCREEN_REDO_SEEN';

function screenRedoSweepMaybe_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('screen_redo_sweep')) return;
  cache.put('screen_redo_sweep', '1', 900);

  // THE SWITCH AND THE WORDS ARE A SITUATION ROW — smart comms owns both — and this nudge had neither, like every…
  var rdSit = (typeof outreachAllowed_ === 'function')
    ? outreachAllowed_(commSituationId_('hiring.screen.redo', 'hiring_screen_redo')) : { ok: true, sit: null };
  if (!rdSit.ok) {
    if (typeof tpSweepIdle_ === 'function') {
      tpSweepIdle_('screen-redo', outreachIdleWhy_(rdSit, 'hiring_screen_redo is OFF in Smart Comms — a cut call is ' +
                   'not answered with a fresh invitation to call again'));
    }
    return;
  }
  var rdWords_ = function (sitKey, cfgKey, floor, first, lineLabel) {
    var v = str_(rdSit.sit && rdSit.sit[sitKey]);
    if (!v && typeof simText_ === 'function') v = simText_(cfgKey, '');
    return String(v || floor)
      .replace(/\{first_name\}/g, first)
      .replace(/\{screen_line\}/g, lineLabel).replace(/\{line\}/g, lineLabel);
  };

  var open;
  try {
    open = simAskRows_().filter(function (r) {
      return str_(r.state) === 'open' && str_(r.step) === 'screen_call';
    });
  } catch (e) { return; }
  if (!open.length) return;

  var props = PropertiesService.getScriptProperties();
  var seen = {};
  try { seen = JSON.parse(str_(props.getProperty(SCREEN_REDO_SEEN_PROP)) || '{}'); } catch (eS) { seen = {}; }

  var trans;
  try { trans = readTabNormalized_(ssOpen_(hubId_('HUB_COMMS_ID')), 'transcripts'); }
  catch (eT2) { return; }

  open.forEach(function (r) {
    var cid = str_(r.candidateid);
    var ev;
    try { ev = hubEvidence_(cid); } catch (eE) { return; }
    if (!ev || !ev.cand) return;
    var name = str_(ev.cand.candidatename);
    var digits = str_(ev.cand.phone).replace(/\D/g, '').replace(/^1/, '');
    // …and while the redirect is live, the TESTER's call counts for the card (simTesterKeys_, empty in production)…
    var redoKeys = (digits.length === 10 ? [digits] : []);
    try {
      ((typeof simTesterKeys_ === 'function') ? simTesterKeys_() : { digits: [] })
        .digits.forEach(function (d) { if (redoKeys.indexOf(d) === -1) redoKeys.push(d); });
    } catch (eTk) { /* production keeps the candidate's own number */ }
    if (!redoKeys.length) return;

    var newest = null;
    trans.forEach(function (t) {
      var who = str_(t.participants).replace(/\D/g, '');
      var hit = false;
      for (var rk = 0; rk < redoKeys.length; rk++) {
        if (who.indexOf(redoKeys[rk]) !== -1) { hit = true; break; }
      }
      if (!hit) return;
      var at = str_(t.transcriptcreated) || str_(t.receivedat);
      if (!newest || at > newest.at) {
        newest = { at: at, id: str_(t.callid),
                   text: str_(t.speakertranscript) || str_(t.fulltranscript) };
      }
    });
    if (!newest) return;                       // no call yet — keep waiting

    if (hubCallComplete_(newest.text)) {
      simAskAnswer_(['screen_call'], 'a complete call arrived (' + newest.id + ')', cid);
      journeyLog_({ candidate_id: cid, name: name, step: 'screen_watch', channel: 'record',
                    ok: true, detail: 'the candidate\'s call reached its goodbye — the loop rests; the evaluation reads it next',
                    by: 'asa-hub:screen-redo' });
      return;
    }
    if (seen[newest.id]) return;               // this bad call was already nudged

    var actors = (typeof hiringSimActors_ === 'function') ? hiringSimActors_() : null;
    var line = (actors && actors.screen_line) || '';
    var first = hiringGreetFirst_(name);
    var subject = rdWords_('email_subject', 'screen_redo_subject',
                           bookText_('Strings', 'screen_redo.subject.floor', ''), first, line);
    var bodyText = rdWords_('email_text', 'screen_redo_body',
                            bookText_('Strings', 'screen_redo.body.floor', ''), first, line);
    var html = mailShell_({
      eyebrow: 'ASA LifeCare',
      title: bookText_('Strings', 'screen_redo.title', ''),
      preheader: bookText_('Strings', 'screen_redo.preheader', ''),
      blocks: bodyText.split('\n\n').map(function (p) { return mailPara_(mailEsc_(p).replace(/\n/g, '<br>')); }),
      cta: null,
      footnote: bookText_('Strings', 'screen_redo.footnote', '')
    });
    var sentAny = false;
    var email = str_(ev.cand.email);
    if (email.indexOf('@') !== -1) {
      var rm = outreachSend_({ candidate_id: cid, name: name, step: 'screen_watch',
        to: email, cc: '', letter: { subject: subject, text: bodyText, html: html },
        reason: 'hiring: the screening call was cut — asking for one more try',
        by: 'asa-hub:screen-redo' });
      sentAny = sentAny || !!(rm && rm.sent);
    }
    var phone = (typeof simSendablePhone_ === 'function')
      ? simSendablePhone_(str_(ev.cand.phone)) : str_(ev.cand.phone);
    if (phone) {
      var smsBody = rdWords_('sms_text', 'screen_redo_sms',
        bookText_('Strings', 'screen_redo.sms.floor', ''), first, line);
      var rs = outreachSms_({ candidate_id: cid, name: name, step: 'screen_watch', to: phone,
        body: smsBody,
        intro: (typeof simQuoIntro_ === 'function') ? simQuoIntro_(bookText_('Strings', 'purpose.screen_redo', '')) : '',
        reason: 'hiring: the screening call was cut — asking for one more try',
        by: 'asa-hub:screen-redo' });
      sentAny = sentAny || !!(rs && rs.sent);
    }
    if (sentAny) {
      seen[newest.id] = new Date().toISOString();
      props.setProperty(SCREEN_REDO_SEEN_PROP, JSON.stringify(seen));
      journeyLog_({ candidate_id: cid, name: name, step: 'screen_watch', channel: 'email',
                    ok: true, detail: 'THE LOOP: the call (' + newest.id + ') ended without a goodbye — cut. ' +
                            'The candidate was asked to call again, e-mail and text together; the watch continues.',
                    by: 'asa-hub:screen-redo' });
    }
  });
}

HUB_POLICY.hiringAcceptedNotify = {
  file: 'HiringOutreach.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' } },
  invalidates: [], emits: ['emailSend', 'smsSend']
};
// The simulator's step 5 button: announce the acceptance NOW — e-mail to Arthur and Ty with the copy list, Quo…
HUB_ACTIONS.hiringAcceptedNotify = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload && payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  var name = str_(ev.cand.candidatename);
  // Their actual last reply, when one is on file — the letter quotes it.
  var reply = '';
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), INBOUND_TAB).forEach(function (m) {
      if (str_(m.candidateid) === cid && str_(m.body)) reply = str_(m.body);
    });
  } catch (e) { reply = ''; }
  var told = hiringAcceptedTell_(cid, name, str_(ev.cand.phone), reply, user);
  return { status: 200, data: { sent: told.emailed, emailed: told.emailed,
           sms_told: told.smsed, reply_quoted: reply.slice(0, 120) } };
};

HUB_POLICY.hiringOutreachReplyCheck = {
  file: 'HiringOutreach.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' } },
  invalidates: [], emits: ['emailSend']
};
// Read the replies now — the tester and the simulator both need to do this WITHOUT waiting for the 900-second…
HUB_ACTIONS.hiringOutreachReplyCheck = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload && payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  return { status: 200, data: hiringOutreachReplyScan_(cid, user) };
};

// ------------------------------------------------------------------ STEP 5 — the referral who is only an e-mail…

HUB_POLICY.hiringResumeRequestSend = {
  file: 'HiringOutreach.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: {
    candidate_id: { required: false, type: 'string' },
    to: { required: false, type: 'string' },
    name: { required: false, type: 'string' },
    referrer: { required: false, type: 'string' }
  },
  invalidates: [], emits: ['emailSend']
};
// Ask the person themselves for the two things the process cannot start without.
HUB_ACTIONS.hiringResumeRequestSend = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
 // The workbook's flagged gap closed: this sender finally has its situation row — the switch lives there, the words…
  var allow = outreachAllowed_(commSituationId_('hiring.resume.request', 'hiring_resume_request'));
  if (!allow.ok) return { status: 200, data: { sent: false, reason: allow.reason } };
  var p = payload || {};
  var cid = str_(p.candidate_id);
  var to = str_(p.to), name = str_(p.name);
  if (cid) {
    var ev = hubEvidence_(cid);
    if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
    to = to || str_(ev.cand.email);
    name = name || str_(ev.cand.candidatename);
  }
  if (!to) {
    return { status: 200, data: { sent: false, reason: 'no_email',
             detail: 'this step is for somebody we can only reach by e-mail — and there is none' } };
  }
  // Who vouched.
  var rrWho = str_(p.referrer);
  if (!rrWho && cid) {
    var rrBook = referralLadderBookRow_(cid);
    if (rrBook) rrWho = str_(rrBook.referrername);
  }
  var rrFirst = hiringGreetFirst_(name);
  var letter = hiringResumeRequestEmail_({
    name: name, referrer: rrWho,
    subject: ((typeof simText_ === 'function') ? simText_('resume_request_subject', '') : '')
      .replace(/\{first_name\}/g, rrFirst).replace(/\{name\}/g, name),
    bodyText: ((typeof simText_ === 'function') ? simText_('resume_request_body', '') : '')
      .replace(/\{first_name\}/g, rrFirst).replace(/\{name\}/g, name)
      .replace(/\{referrer\}/g, rrWho || bookText_('Strings', 'resume_request.referrer.floor', ''))
  });
  var res = outreachSend_({
    candidate_id: cid, name: name, step: 'resume_request', to: to,
    cc: (cid && typeof simIsRehearsalCid_ === 'function' && simIsRehearsalCid_(cid) &&
         typeof simCcFor_ === 'function') ? simCcFor_(to) : '',
    letter: letter,
    reason: 'hiring: asking a referral for a resume and a phone', by: str_(user && user.email)
  });
 // THE ASK ENTERS THE BOOK: the retry pass re-asks configured clock, the ear (referralContactScanRun_) reads their…
  if (cid && res && res.sent) {
    try { simTrackSend_('resume_request', cid, 'hiringResumeRequestSend', { candidate_id: cid }); } catch (eT) {}
    try { if (typeof referralBookSet_ === 'function') referralBookSet_(cid, { state: 'contacting' }); } catch (eBk) {}
    journeyLog_({ candidate_id: cid, name: name, step: 'resume_request', channel: 'email',
                  ok: true,
                  detail: 'the ask entered the book — re-asked on the configured clock; the ' +
                          'ear reads their reply for a phone, the folder scan for a resume',
                  by: str_(user && user.email) });
  }
  return { status: 200, data: res };
};

// ------------------------------------------------------------------ STEP 5's LADDER — a referral nobody can reach…

// The indications book's row for one candidate — last row wins, null when the tab (or the row) does not exist yet.
function referralLadderBookRow_(cid) {
  if (!cid) return null;
  try {
    // The LIVE row wins over informational ones: a duplicate knock appends an 'already_known' row with the SAME…
    var LIVE = { received: 1, contacting: 1, asking_referrer: 1 };
    var live = null, any = null;
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), 'entity_referrals').forEach(function (r) {
      if (str_(r.candidateid) !== str_(cid)) return;
      any = r;
      if (LIVE[str_(r.state)]) live = r;
    });
    return live || any;
  } catch (e) { return null; }
}

// The ladder's one closer: both asks shut, the book resolved, the journey told — so a settle found by any ear reads…
function referralLadderSettle_(cid, name, what, channel) {
  try { simAskAnswer_(['resume_request', 'referral_relay'], 'they answered with ' + what, cid); } catch (eA) {}
  try {
    if (typeof referralBookSet_ === 'function') {
      referralBookSet_(cid, { state: 'resolved', state_detail: what });
    }
  } catch (eB) {}
  journeyLog_({ candidate_id: cid, name: name, step: 'resume_request', channel: channel,
                ok: true,
                detail: 'sanado — ' + what + '; the walk continues at the pipeline\'s step 3',
                by: 'asa-hub:referral-ear' });
}

// THE EAR OF THE LADDER (a and its answers, as dictated).
function referralContactScanRun_() {
  var out = { checked: 0, judged: 0, settled: 0 };
  var asks;
  try {
    asks = simAskRows_().filter(function (r) {
      var st = str_(r.state), sp = str_(r.step);
      return (st === 'open' || st === 'exhausted') &&
             (sp === 'resume_request' || sp === 'referral_relay');
    });
  } catch (e) { return out; }
  if (!asks.length) return out;

  var byCid = {};
  asks.forEach(function (r) {
    var cid = str_(r.candidateid);
    if (!cid) return;
    (byCid[cid] = byCid[cid] || {})[str_(r.step)] = true;
  });

  // one mailbox read for the whole pass — the interest scan's shape
  var threads = [];
  if (typeof platformMailPost_ === 'function') {
    try {
      var inbox = platformMailPost_('/mail/inbox', { limit: 50 });
      if (inbox && inbox.status === 200) threads = (inbox.data && inbox.data.threads) || [];
    } catch (eM) { threads = []; }
  }

  // the memo — never judge blind: an unreadable memo ends the pass
  var judged = {}, memo = null;
  try {
    var ss = ssOpen_(hubId_('HUB_DB_ID'));
    memo = hubTabEnsure_(HIRING_SIM_AI_TAB, HIRING_SIM_AI_HEADER);
    readTabNormalized_(ss, HIRING_SIM_AI_TAB).forEach(function (r) {
      if (str_(r.messageid)) judged[str_(r.messageid)] = str_(r.verdict);
    });
  } catch (eJ) { return out; }

  /** Remember one verdict; false = unmemoed, so nothing may act on it. */
  var memoPut = function (mid, phone) {
    try { memo.appendRow([mid, phone ? 'ref_phone' : 'ref_none', str_(phone), 'rule', new Date().toISOString()]); }
    catch (eW) { return false; }
    judged[mid] = phone ? 'ref_phone' : 'ref_none';
    out.judged++;
    return true;
  };

  // The first phone-shaped digit run in a text that is NOT `notDigits` — the referrer sending their own number back…
  var runFind = function (text, notDigits) {
    var runRe = /\+?\d[\d\s().\/-]{7,}\d/g, mm;
    while ((mm = runRe.exec(String(text || ''))) !== null) {
      var dd = mm[0].replace(/\D/g, '');
      if (dd.length < 10 || dd.length > 13) continue;
      if (notDigits && dd.slice(-10) === notDigits) continue;
      if (typeof SHARED_LINE_DIGITS !== 'undefined' &&
          SHARED_LINE_DIGITS.indexOf(dd.slice(-10)) !== -1) continue;
      return mm[0].trim();
    }
    return '';
  };

  Object.keys(byCid).forEach(function (cid) {
    out.checked++;
    var ev;
    try { ev = hubEvidence_(cid); } catch (eE) { return; }
    if (!ev || !ev.cand) return;
    if (str_(ev.cand.archived).toLowerCase() === 'true') return;   // the ladder already ended
    var name = str_(ev.cand.candidatename);

    // already settled by the world — a number on the row, or the folder's resume
    if (str_(ev.cand.phone).replace(/\D/g, '').length >= 10) {
      out.settled++;
      referralLadderSettle_(cid, name, 'a phone number already on their row', 'record');
      return;
    }
    if (str_(ev.cand.resumelink)) {
      out.settled++;
      referralLadderSettle_(cid, name, 'a resume on file (resume_link on the row)', 'record');
      return;
    }

    // A found phone lands on the row (status stays) and settles the asks.
    var stamp = function (phone, what, channel) {
      try {
        hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, { phone: phone },
                            { email: 'asa-hub:referral-ear' }, false);
      } catch (eW2) { return false; }
      try { if (typeof hubBustTalentCache_ === 'function') hubBustTalentCache_(); } catch (eB2) {}
      out.settled++;
      referralLadderSettle_(cid, name, what, channel);
      return true;
    };

    // 1 — the person's own reply, off the platform mailbox
    var candEmail = str_(ev.cand.email).toLowerCase();
    if (candEmail.indexOf('@') !== -1) {
      for (var i = 0; i < threads.length; i++) {
        var t = threads[i] || {};
        if (str_(t.from_addr).toLowerCase().indexOf(candEmail) === -1) continue;
        var mid = 'ref:' + str_(t.id || (str_(t.date) + '|' + str_(t.subject)));
        if (judged[mid] !== undefined) continue;
        var body = str_(t.snippet);
        if (!body) continue;
        var phone = '';
        try {
          var found = (typeof referralContactFind_ === 'function') ? referralContactFind_(body) : null;
          phone = str_(found && found.phone);
        } catch (eF) { phone = ''; }
        // a quoted signature carrying one of OUR lines is not their phone
        if (phone && typeof SHARED_LINE_DIGITS !== 'undefined' &&
            SHARED_LINE_DIGITS.indexOf(phone.replace(/\D/g, '').slice(-10)) !== -1) phone = '';
        if (phone) {
          // stamp FIRST — a failed write leaves the message unjudged, so the answer is re-read next pass; only a…
          if (stamp(phone, 'their own reply carried a phone (•••' + phone.replace(/\D/g, '').slice(-4) + ')', 'email')) {
            memoPut(mid, phone);
          }
          return;
        }
        memoPut(mid, '');
      }
    }

    // 2 — the referrer's answers, once the relay is on them
    if (!byCid[cid]['referral_relay']) return;
    var book = referralLadderBookRow_(cid);
    if (!book) return;
    var refName = str_(book.referrername) || bookText_('Strings', 'referral_relay.referrer.floor', '');
    var refDigits = str_(book.referrerphone).replace(/\D/g, '').slice(-10);

    // (i) by text — mirror their thread in under its OWN key ('REF:'+cid), so the outreach reply scan (candidateid…
    if (refDigits.length === 10) {
      try { quoInboundPull_('REF:' + cid, refName, str_(book.referrerphone)); } catch (eP) {}
      var hitSms = '', hitMid = '';
      try {
        readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), INBOUND_TAB).forEach(function (m) {
          if (hitSms) return;
          // BOTH keys: one referrer may vouch for two people — their thread is filed per candidate ('REF:'+cid) and…
          if (str_(m.candidateid) !== 'REF:' + cid) return;
          if (str_(m.fromkey) !== refDigits) return;
          var mid2 = 'ref:' + (str_(m.messageid) || (str_(m.receivedat) + '|' + refDigits));
          if (judged[mid2] !== undefined) return;
          var phone2 = runFind(str_(m.body), refDigits);
          if (phone2) { hitSms = phone2; hitMid = mid2; return; }
          memoPut(mid2, '');
        });
      } catch (eI) { /* the e-mail half still reads */ }
      if (hitSms) {
        // stamp first, memo after — same law as the person's reply above
        if (stamp(hitSms, refName + ' sent their number by text (•••' + hitSms.replace(/\D/g, '').slice(-4) + ')', 'sms')) {
          memoPut(hitMid, hitSms);
        }
        return;
      }
    }

    // (ii) by letter — the same mailbox read, the referrer as the sender gate
    var refEmail = str_(book.referreremail).toLowerCase();
    if (refEmail.indexOf('@') !== -1) {
      for (var j = 0; j < threads.length; j++) {
        var t2 = threads[j] || {};
        if (str_(t2.from_addr).toLowerCase().indexOf(refEmail) === -1) continue;
        var mid3 = 'ref:' + str_(t2.id || (str_(t2.date) + '|' + str_(t2.subject)));
        if (judged[mid3] !== undefined) continue;
        var body3 = str_(t2.snippet);
        if (!body3) continue;
        var phone3 = '';
        try {
          var found3 = (typeof referralContactFind_ === 'function') ? referralContactFind_(body3) : null;
          phone3 = str_(found3 && found3.phone);
        } catch (eF3) { phone3 = ''; }
        if (phone3 && phone3.replace(/\D/g, '').slice(-10) === refDigits) phone3 = '';
        if (phone3 && typeof SHARED_LINE_DIGITS !== 'undefined' &&
            SHARED_LINE_DIGITS.indexOf(phone3.replace(/\D/g, '').slice(-10)) !== -1) phone3 = '';
        if (phone3) {
          if (stamp(phone3, refName + ' answered with their number (•••' + phone3.replace(/\D/g, '').slice(-4) + ')', 'email')) {
            memoPut(mid3, phone3);
          }
          return;
        }
        memoPut(mid3, '');
      }
    }
  });
  return out;
}

// THE MOUTH OF THE LADDER (b, c and d, as dictated).
function referralOhioMorningAfter_(last) {
  try {
    var tz = 'America/New_York';
    var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var thatDay = Utilities.formatDate(last, tz, 'yyyy-MM-dd');
    if (today <= thatDay) return false;
    return parseInt(Utilities.formatDate(new Date(), tz, 'H'), 10) >= 8;
  } catch (e) { return false; }                   // an unreadable clock waits
}

function referralRelaySweepMaybe_() {
  // service reads only + the throttle — the hiringSimSweepMaybe_ idiom
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('referral_relay_sweep')) return;
  cache.put('referral_relay_sweep', '1', 900);

  var asks;
  try { asks = simAskRows_(); } catch (e) { return; }
  var byCid = {};
  asks.forEach(function (r) {
    var cid = str_(r.candidateid);
    if (!cid) return;
    var sp = str_(r.step);
    if (sp !== 'resume_request' && sp !== 'referral_relay') return;
    var slot = byCid[cid] = byCid[cid] || {};
    slot[sp] = str_(r.state);                     // last row wins
    if (sp === 'referral_relay') { slot.relay = r; slot.relayRounds = (slot.relayRounds || 0) + 1; }
    if (sp === 'resume_request') slot.person = r;
  });

  Object.keys(byCid).forEach(function (cid) {
    if (byCid[cid]['resume_request'] !== 'exhausted') return;
    var ev;
    try { ev = hubEvidence_(cid); } catch (eE) { return; }
    if (!ev || !ev.cand) return;
    if (str_(ev.cand.archived).toLowerCase() === 'true') return;
    // still reachable? the EAR settles it — this mouth stays shut
    if (str_(ev.cand.phone).replace(/\D/g, '').length >= 10) return;
    if (str_(ev.cand.resumelink)) return;

    var book = referralLadderBookRow_(cid);
    if (!book) return;                            // not the referral door's candidate
    var bookState = str_(book.state);
    if (bookState === 'discarded' || bookState === 'resolved') return;   // the guard

    var name = str_(ev.cand.candidatename);
    var first = hiringGreetFirst_(name);
    var refName = str_(book.referrername) || bookText_('Strings', 'referral_relay.referrer.floor', '');
    var refEmail = str_(book.referreremail);
    var relayState = byCid[cid]['referral_relay'] || '';

    // THE NUMBER, NORMALIZED AND FENCED like every other SMS leg: '+1' + ten digits, and the platform's own…
    var refDigits10 = str_(book.referrerphone).replace(/\D/g, '').replace(/^1/, '').slice(-10);
    if (refDigits10.length === 10 && typeof SHARED_LINE_DIGITS !== 'undefined' &&
        SHARED_LINE_DIGITS.indexOf(refDigits10) !== -1) refDigits10 = '';
    var refPhone = refDigits10.length === 10 ? '+1' + refDigits10 : '';
    var hasContact = !!refPhone || refEmail.indexOf('@') !== -1;

    // THE REHEARSAL FENCE, IRON: a [TEST] card's relay NEVER reaches the book's real contacts — the letter is…
    var rehearsal26 = false;
    try {
      rehearsal26 = (typeof commsIsTestCandidate_ === 'function') && commsIsTestCandidate_(ev.cand);
    } catch (eTst) { rehearsal26 = false; }

    // THE GRACE CLOCK (b/c wait for a human): the person's asking must be QUIET for its own interval past the last…
    var quietPast = function (row, fallbackMins) {
      if (!row) return true;
      var mins = parseInt(str_(row.intervalminutes), 10) || fallbackMins || 30;
      var last = new Date(str_(row.lastsentat) || str_(row.createdat)).getTime();
      if (isNaN(last)) return true;
      return (Date.now() - last) >= mins * 60000;
    };

    var fill = function (s) {
      return String(s || '').replace(/\{name\}/g, name)
        .replace(/\{first_name\}/g, first).replace(/\{referrer\}/g, refName);
    };

    // One relay round — text and/or letter, whichever the book holds.
    var relayVars = { name: name, first_name: first, referrer: refName };
    var relaySend = function (attempt) {
      // A Smart Comms situation (hiring_referral_relay): off, nothing leaves and nothing is booked.
      var relaySit = hubLaneSituation_('hiring_referral_relay');
      if (!relaySit.on) return false;
      var suffix = attempt > 1 ? '_a' + attempt : '';
      var sentAny = false;
      if (refPhone && relaySit.leg('sms')) {
        var smsBody = relaySit.word('sms_text',
          fill((typeof simText_ === 'function') ? simText_('referral_relay_sms', '') : '') ||
          bookText_('Strings', 'referral_relay.sms.floor', '').split('{name}').join(name), relayVars);
        if (typeof simTagSubject_ === 'function') smsBody = simTagSubject_(smsBody);
        if (rehearsal26) {
          // narrated, never sent — the fence
          journeyLog_({ candidate_id: cid, name: name, step: 'resume_request', channel: 'sms',
                        ok: true, rehearsal: true,
                        detail: 'THE LADDER (rehearsal): the text to ' + refName +
                                ' is narrated, never sent — a rehearsal reaches no real referrer',
                        by: 'asa-hub:referral-ladder' });
          sentAny = true;
        } else {
        var rs = rpcCall_('smsSend',
          { to: refPhone, body: smsBody,
            reason: 'smart comms: hiring_referral_relay' },
          { idempotency_key: 'ref_relay_sms_' + cid + suffix });
        // a deduplicated receipt IS a send that landed — booking must follow
        sentAny = sentAny || !!(rs && (rs.sent || rs.deduplicated));
        journeyLog_({ candidate_id: cid, name: name, step: 'resume_request', channel: 'sms',
                      to: refPhone, ok: !!(rs && (rs.sent || rs.deduplicated)),
                      detail: 'THE LADDER: ' + name + ' never answered — ' + refName +
                              ' is asked by text for a phone or a resume (attempt ' + attempt + ')' +
                              ((rs && (rs.sent || rs.deduplicated)) ? '' : ' — not sent: ' + (str_(rs && (rs.error || rs.reason)) || 'refused')),
                      by: 'asa-hub:referral-ladder' });
        }
      }
      if (refEmail.indexOf('@') !== -1 && relaySit.leg('email')) {
        var subject = relaySit.word('email_subject',
          fill((typeof simText_ === 'function') ? simText_('referral_relay_subject', '') : '') ||
          bookText_('Strings', 'referral_relay.subject.floor', '').split('{name}').join(name), relayVars);
        if (typeof simTagSubject_ === 'function') subject = simTagSubject_(subject);
        var bodyText = relaySit.word('email_text',
          fill((typeof simText_ === 'function') ? simText_('referral_relay_body', '') : '') ||
          bookText_('Strings', 'referral_relay.body.floor', '')
            .split('{referrer}').join(refName).split('{name}').join(name), relayVars);
        var html = mailShell_({
          eyebrow: 'ASA LifeCare',
          title: bookText_('Strings', 'referral_relay.title', '').split('{name}').join(name),
          preheader: bookText_('Strings', 'referral_relay.preheader', ''),
          blocks: bodyText.split(/\n{2,}/).map(function (p2) {
            return mailPara_(mailEsc_(p2).replace(/\n/g, '<br>'));
          }),
          cta: null,
          footnote: bookText_('Strings', 'referral_relay.footnote', '')
        });
        // THE FENCE on the letter leg: a rehearsal's relay goes to the ACTOR mailbox — a tester answers AS the…
        var mailTo = refEmail;
        if (rehearsal26) {
          var addr26 = (typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
          mailTo = (addr26 && addr26.to) || '';
          if (!mailTo) {
            // no actor mailbox configured — say so; silence would read as a stall
            journeyLog_({ candidate_id: cid, name: name, step: 'resume_request', channel: 'email',
                          ok: false, rehearsal: true,
                          detail: 'THE LADDER (rehearsal): no actor mailbox (sim_team_email) — the letter leg is skipped',
                          by: 'asa-hub:referral-ladder' });
          }
        }
        if (mailTo) {
        var rm = rpcCall_('emailSend',
          { to: mailTo, subject: subject, body: bodyText, html: html,
            reason: 'smart comms: hiring_referral_relay' },
          { idempotency_key: 'ref_relay_mail_' + cid + suffix });
        sentAny = sentAny || !!(rm && (rm.sent || rm.deduplicated));
        journeyLog_({ candidate_id: cid, name: name, step: 'resume_request', channel: 'email',
                      to: mailTo, ok: !!(rm && (rm.sent || rm.deduplicated)),
                      detail: 'THE LADDER: ' + name + ' never answered — ' + refName +
                              ' is asked by letter for a phone or a resume (attempt ' + attempt + ')' +
                              (rehearsal26 ? ' (rehearsal — redirected to the actor mailbox)' : '') +
                              ((rm && (rm.sent || rm.deduplicated)) ? '' : ' — not sent: ' + (str_(rm && (rm.error || rm.reason)) || 'refused')),
                      by: 'asa-hub:referral-ladder' });
        }
      }
      return sentAny;
    };

    // b/c — the first relay, only after the person's asking sat quiet.
    if (!relayState && (bookState === 'contacting' || bookState === 'received') && hasContact) {
      if (!quietPast(byCid[cid].person)) return;
      if (relaySend(1)) {
        try { simTrackSend_('referral_relay', cid, 'referralRelaySweepMaybe_', { candidate_id: cid }); } catch (eT) {}
        try { if (typeof referralBookSet_ === 'function') referralBookSet_(cid, { state: 'asking_referrer' }); } catch (eB) {}
      }
      return;
    }

    // the relay's own re-asks — the retry pass only re-presses HUB_ACTIONS
    if (relayState === 'open' && byCid[cid].relay) {
      var row = byCid[cid].relay;
      var count = parseInt(str_(row.sentcount), 10) || 0;
      var maxA = parseInt(str_(row.maxattempts), 10) || 1;
      var mins = parseInt(str_(row.intervalminutes), 10) || 30;
      var last = new Date(str_(row.lastsentat)).getTime();
      if (count >= maxA) return;                  // the retry pass says it ended
      if (!isNaN(last) && Date.now() - last < mins * 60000) return;
      if (relaySend(count + 1)) {
        try { simTrackSend_('referral_relay', cid, 'referralRelaySweepMaybe_', { candidate_id: cid }); } catch (eT2) {}
      }
      return;
    }

    // THE SECOND DAY, as dictated: the first seven ended unanswered — a fresh seven starts the next Ohio morning…
    if (relayState === 'exhausted' && hasContact && (byCid[cid].relayRounds || 1) < 2) {
      var lastTry = new Date(str_(byCid[cid].relay && byCid[cid].relay.lastsentat) ||
                             str_(byCid[cid].relay && byCid[cid].relay.createdat));
      if (isNaN(lastTry.getTime()) || !referralOhioMorningAfter_(lastTry)) return;
      if (relaySend(1)) {
        try { simTrackSend_('referral_relay', cid, 'referralRelaySweepMaybe_', { candidate_id: cid }); } catch (eT3) {}
        journeyLog_({ candidate_id: cid, name: name, step: 'resume_request', channel: 'record',
                      ok: true, title: 'The second day of asking begins',
                      detail: 'yesterday\'s seven to ' + refName + ' went unanswered — a fresh ' +
                              'seven starts this Ohio morning, asking for any contact they hold',
                      by: 'asa-hub:referral-ladder' });
      }
      return;
    }

    // d — the discard: the relay ended unanswered, or there was never anybody to relay to — and the last asking sat…
    if (relayState === 'exhausted' || (!relayState && !hasContact)) {
      if (!quietPast(relayState === 'exhausted' ? byCid[cid].relay : byCid[cid].person)) return;
      var when = new Date().toISOString();
      var reason = 'The referral could not be reached — nobody had a phone or a resume';
      try {
        ensureHeader_(hubSheet_(TALENT_CANDIDATES_TAB),
                      ['archived', 'archived_at', 'archived_by', 'archived_reason']);
        hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, {
          archived: 'true', archived_at: when,
          archived_by: 'asa-hub:referral-ladder', archived_reason: reason
        }, { email: 'asa-hub:referral-ladder' }, false);
        try { if (typeof hubBustTalentCache_ === 'function') hubBustTalentCache_(); } catch (eB3) {}
      } catch (eW) {
        hubSysLog_('asa-hub:referral-ladder', 'referral_discard_mark_failed',
                   cid + ' — ' + String((eW && eW.message) || eW), { status: 500 });
        return;                                   // unmarked = untold; the next pass retries
      }
      try {
        if (typeof referralBookSet_ === 'function') {
          referralBookSet_(cid, { state: 'discarded', state_detail: reason });
        }
      } catch (eB4) { /* the archive mark above already ended the walk */ }

      // ONE letter to the team only — hiringArchiveAndTell_'s send block, on the ladder's own cells and key ("o…
      var discSit = hubLaneSituation_('hiring_referral_discarded');
      if (discSit.on && discSit.leg('email')) try {
        var team = hiringTeamRecipients_();
        var rehearsal = (typeof simIsRehearsalCid_ === 'function') && simIsRehearsalCid_(cid);
        var addr = (rehearsal && typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
        var to = (addr && addr.to) || team.emails.join(', ');
        var discVars = { name: name || cid, first_name: first, referrer: refName, reason: reason };
        var letter = hiringDiscardEmail_({
          name: name || cid, reason: reason, stage: 'Referral outreach', when: when,
          by: 'asa-hub:referral-ladder',
          subject: discSit.word('email_subject',
            fill((typeof simText_ === 'function') ? simText_('referral_discard_subject', '') : '') ||
            (name + ' was discarded from our selection processes'), discVars),
          bodyText: discSit.word('email_text',
            fill((typeof simText_ === 'function') ? simText_('referral_discard_body', '') : ''), discVars)
        });
        var subj = (typeof simTagSubject_ === 'function') ? simTagSubject_(str_(letter.subject)) : str_(letter.subject);
        var rd = rpcCall_('emailSend',
          { to: to, cc: (addr && addr.cc) || '', subject: subj,
            body: str_(letter.text), html: str_(letter.html),
            reason: 'smart comms: hiring_referral_discarded' },
          { idempotency_key: 'ref_discard_' + cid });
        journeyLog_({ candidate_id: cid, name: name, step: 'resume_request', channel: 'email',
                      to: to, ok: !!(rd && (rd.sent || rd.deduplicated)),
                      title: 'The ladder ended — the referral was discarded',
                      detail: reason + ' — soft-archived; Arthur and Ty told once' +
                              ((rd && (rd.sent || rd.deduplicated)) ? '' : ' (the letter did not go: ' +
                               (str_(rd && (rd.error || rd.reason)) || 'refused') + ')'),
                      by: 'asa-hub:referral-ladder' });
      } catch (eS) {
        hubSysLog_('asa-hub:referral-ladder', 'referral_discard_notice_failed',
                   cid + ' — ' + String((eS && eS.message) || eS), { status: 500 });
      }
      // both asks close, so no ear or retry ever revisits this card
      try { simAskAnswer_(['resume_request', 'referral_relay'], 'the ladder ended — discarded', cid); } catch (eA2) {}
    }
  });
}

// ------------------------------------------------------------------ STEP 6 — the background check has to be asked…

// Where the originals live.
var HIRING_ORIGINAL_DOCS_PROP = 'HUB_FOLDER_ORIGINAL_DOCS';

// The folder a person should be pointed at.
function hiringOriginalDocsUrl_() {
  var id = '';
  try {
    id = String(hubProp_(HIRING_ORIGINAL_DOCS_PROP) || '') ||
         String(hubId_('COMPLIANCE_SHARED_FOLDER_ID') || '');
  } catch (e) { id = ''; }
  return id ? 'https://drive.google.com/drive/folders/' + id : '';
}

HUB_POLICY.hiringCjisRequestSend = {
  file: 'HiringOutreach.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' }, to: { required: false, type: 'string' } },
  invalidates: ['candidates'], emits: ['emailSend']
};
/** Ask the team for the CJIS result, and say both ways of returning it. */
HUB_ACTIONS.hiringCjisRequestSend = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload && payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var allow = outreachAllowed_(commSituationId_('hiring.cjis.request', 'hiring_cjis_request'));
  if (!allow.ok) return { status: 200, data: { sent: false, reason: allow.reason } };

  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  var name = str_(ev.cand.candidatename);
  // ALREADY CLEARED IS NOT A REQUEST.
  if (hubCjisCleared_(ev.analysis)) {
    return { status: 200, data: { sent: false, reason: 'already_cleared',
             detail: name + ' is already CJIS cleared with a report attached' } };
  }
  // A decider already answered YES — we know where the report is; asking again teaches the team to ignore the…
  if (str_(ev.analysis.cjisstatus).toLowerCase() === 'on file') {
    return { status: 200, data: { sent: false, reason: 'already_on_file',
             detail: 'a decider said the candidate sent it — the report lands in the folder whenever it lands' } };
  }
  var rehearsal = (typeof simIsRehearsalCid_ === 'function') && simIsRehearsalCid_(cid);

  // THE FOLDER FIRST: the ask's own premise — "I see that we do not have the CJIS in the folder" — must be TRUE…
  try {
    var idx = cjisFolderIndex_();
    var hit = (!idx.error && idx.people) ? idx.people[cjisKey_(name)] : null;
    if (hit) {
      var fileUrl = 'https://drive.google.com/file/d/' + hit.fileId + '/view';
      if (!rehearsal) cjisAttach_(cid, fileUrl, hit.filename, user);
      try { if (typeof hubBustTalentCache_ === 'function') hubBustTalentCache_(); } catch (eB) {}
      try { simAskAnswer_(['cjis_request'], 'the report is in the folder (' + hit.filename + ')', cid); } catch (eA) {}
      journeyLog_({ candidate_id: cid, name: name, step: 'cjis_request', channel: 'folder', ok: true,
                    detail: 'the report is ALREADY in the designated folder (' + hit.filename + ')' +
                            (rehearsal ? ' — a rehearsal match is shown, never attached'
                                       : ' — attached; nobody was asked for what we already have'),
                    by: str_(user && user.email) });
      return { status: 200, data: { sent: false, reason: 'already_in_folder',
               filename: hit.filename, attached: !rehearsal } };
    }
  } catch (eIdx) { /* an unreadable folder never blocks the ask */ }

  var team = hiringTeamRecipients_();
  var addr = (rehearsal && typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
  var to = str_(payload.to) || (addr && addr.to) || team.emails.join(', ');
  var letter = hiringCjisRequestEmail_({
    name: name,
    folderUrl: hiringOriginalDocsUrl_(),
    status: str_(ev.analysis.cjisstatus),
    subject: ((typeof simText_ === 'function') ? simText_('cjis_request_subject', '') : '')
      .replace(/\{name\}/g, name),
    bodyText: ((typeof simText_ === 'function') ? simText_('cjis_request_body', '') : '')
      .replace(/\{name\}/g, name).replace(/\{status\}/g, str_(ev.analysis.cjisstatus))
  });
  var res = outreachSend_({
    candidate_id: cid, name: name, step: 'cjis_request',
    to: to,
    cc: (addr && addr.cc) || '',
    letter: letter,
    reason: 'hiring: the background check is holding a candidate', by: str_(user && user.email)
  });

  // THE NUDGE RIDES WITH THE LETTER, together with the e-mail — one Quo text per decider with the same question, so…
  if (res && res.sent) {
    var actors = (typeof hiringSimActors_ === 'function') ? hiringSimActors_() : null;
    var numbers = (actors && actors.decider_sms && actors.decider_sms.length) ? actors.decider_sms : [];
    var smsBody = ((typeof simText_ === 'function') ? simText_('cjis_nudge_sms', '') : '')
        .replace(/\{name\}/g, name) ||
      bookText_('Strings', 'cjis_request.sms.floor', '').split('{name}').join(name);
    var smsed = 0;
    numbers.forEach(function (n) {
      var r = outreachSms_({
        candidate_id: cid, name: name, step: 'cjis_request', to: n, body: smsBody,
        intro: (typeof simQuoIntro_ === 'function') ? simQuoIntro_(bookText_('Strings', 'purpose.cjis_request', '').split('{name}').join(name)) : '',
        reason: 'hiring: asking the deciders whether the CJIS reached them',
        by: str_(user && user.email)
      });
      if (r.sent) smsed++;
    });
    try { simTrackSend_('cjis_request', cid, 'hiringCjisRequestSend', { candidate_id: cid }); } catch (eT) {}
    // the rehearsal answers itself: the actor playing Arthur says YES through the real reading lane, then does his…
    var auto = null;
    if (!payload.no_auto) {
      try { if (typeof simAutoCjisAnswer_ === 'function') auto = simAutoCjisAnswer_(cid, user); } catch (eAu) {}
    }
    return { status: 200, data: { sent: true, smsed: smsed, email: res, auto: auto || undefined } };
  }
  return { status: 200, data: res };
};

// THE EAR FOR THE CJIS ASK — a YES fills the dot; anything else leaves things exactly as they were.
function cjisAskScanRun_() {
  var out = { checked: 0, yes: 0, no: 0 };
  var rows;
  try {
    rows = simAskRows_().filter(function (r) {
      return str_(r.state) === 'open' && str_(r.step) === 'cjis_request';
    });
  } catch (e) { return out; }
  if (!rows.length) return out;
  var actors = (typeof hiringSimActors_ === 'function') ? hiringSimActors_() : null;
  var numbers = (actors && actors.decider_sms) ? actors.decider_sms : [];
  var keys = {};
  numbers.forEach(function (n) {
    var k = String(n).replace(/\D/g, '').slice(-10);
    if (k) keys[k] = true;
  });
  rows.forEach(function (r) {
    var cid = str_(r.candidateid);
    out.checked++;
    numbers.forEach(function (n) { try { quoInboundPull_(cid, 'a decider', n); } catch (eP) {} });
    var since = str_(r.lastsentat) || str_(r.createdat);
    var verdict = '', by = '';
    try {
      readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), INBOUND_TAB).forEach(function (m) {
        if (!keys[str_(m.fromkey)]) return;
        if (str_(m.receivedat) < since) return;
        var s = str_(m.body).trim().toLowerCase().replace(/[!.\s]+$/, '');
        var cjY = bookWordsRegex_('words.cjis.yes', 'start');
        var cjN = bookWordsRegex_('words.cjis.no', 'start');
        if (cjY && cjY.test(s)) {
          verdict = 'yes'; by = str_(m.fromnumber);
        } else if (cjN && cjN.test(s)) {
          verdict = 'no'; by = str_(m.fromnumber);
        }
      });
    } catch (eR) {}
    if (!verdict) return;
    var evName = '';
    try { var ev2 = hubEvidence_(cid); evName = ev2 && ev2.cand ? str_(ev2.cand.candidatename) : ''; } catch (eE) {}
    if (verdict === 'yes') {
      out.yes++;
      try { hubSetFieldLastRow_(TALENT_RESUME_TAB, cid, { cjis_status: 'On file' }, { email: 'asa-hub:cjis-ear' }, true); } catch (eW) {}
      try { if (typeof hubBustTalentCache_ === 'function') hubBustTalentCache_(); } catch (eB2) {}
      simAskAnswer_(['cjis_request'], 'a decider answered YES (' + by + ') — On file', cid);
      journeyLog_({ candidate_id: cid, name: evName, step: 'cjis_request', channel: 'sms', ok: true,
                    detail: 'the decider answered YES — the candidate sent the CJIS to him. The dot fills (On file); the report itself lands in the folder whenever it lands.',
                    by: 'asa-hub:cjis-ear' });
    } else {
      out.no++;
      simAskAnswer_(['cjis_request'], 'a decider answered NO (' + by + ') — unchanged', cid);
      journeyLog_({ candidate_id: cid, name: evName, step: 'cjis_request', channel: 'sms', ok: true,
                    detail: 'the decider answered NO — nothing changes ("continuamos na mesma"): CJIS never blocks, and the square keeps saying it is owed.',
                    by: 'asa-hub:cjis-ear' });
    }
  });
  return out;
}

// ------------------------------------------------------------------ STEP 8 — the decision that belongs to a person…

HUB_POLICY.hiringDecisionAskSend = {
  file: 'HiringOutreach.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' }, sms: { required: false, type: 'boolean' } },
  invalidates: [], emits: ['emailSend', 'smsSend']
};
// The phone screen is read; ask the owners to advance or decline.
HUB_ACTIONS.hiringDecisionAskSend = function (payload, user) {
  return hiringDecisionAskCore_(payload || {}, user);
};

// Extracted (2026-08-24) so the one-press evaluation (step 5.4) reaches the same letter and Quo nudge TEXTUALLY…
function hiringDecisionAskCore_(payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload && payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var allow = outreachAllowed_(commSituationId_('hiring.decision.request', 'hiring_decision_ask'));
  if (!allow.ok) return { status: 200, data: { sent: false, reason: allow.reason } };

  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  var s = ev.screen || {};
  var name = hiringShortName_(str_(ev.cand.candidatename));
  var team = hiringTeamRecipients_();
  var rehearsal = (typeof simIsRehearsalCid_ === 'function') && simIsRehearsalCid_(cid);
  var actors = (rehearsal && typeof hiringSimActors_ === 'function') ? hiringSimActors_() : null;
  var addr = (rehearsal && typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
  var to = (addr && addr.to) || team.emails.join(', ');

  var letter = hiringDecisionAskEmail_({
    name: name,
    score: str_(s.screenscore),
    summary: str_(s.qualification),
    reportUrl: str_(s.phonescreenreporturl),
    subject: ((typeof simText_ === 'function') ? simText_('decision_ask_subject', '') : '')
      .replace(/\{name\}/g, name),
    bodyText: ((typeof simText_ === 'function') ? simText_('decision_ask_body', '') : '')
      .replace(/\{name\}/g, name)
  });
  var res = outreachSend_({
    candidate_id: cid, name: name, step: 'decision_ask',
    to: to,
    cc: (addr && addr.cc) || '',
    letter: letter,
    reason: 'hiring: the owners decide after the phone screen', by: str_(user && user.email)
  });

  // The text is a nudge, not the message: it says a decision is waiting and where, never the candidate's own words.
  var sms = [];
  if (payload.sms !== false) {
    var numbers = [];
    if (actors && actors.decider_sms && actors.decider_sms.length) numbers = actors.decider_sms;
    else if (actors && actors.team_sms.length) numbers = actors.team_sms;
    else {
      try { numbers = hubCfgList_((typeof hiringAlerts_ === 'function' ? hiringAlerts_() : {}).sms_recipients) || []; }
      catch (e) { numbers = []; }
    }
    numbers.forEach(function (n) {
      sms.push(outreachSms_({
        candidate_id: cid, name: name, step: 'decision_ask', to: n,
        body: ((typeof simText_ === 'function') ? simText_('decision_ask_sms', '') : '')
                .replace(/\{name\}/g, name) ||
              bookText_('Strings', 'decision_ask.sms.floor', '').split('{name}').join(name),
        intro: (rehearsal && typeof simQuoIntro_ === 'function')
          ? simQuoIntro_(bookText_('Strings', 'purpose.decision_ask', '')) : '',
        reason: 'hiring: nudging the owners for a decision', by: str_(user && user.email)
      }));
    });
  }
  res.sms = sms;
  // THE DECIDERS RELEASE BY THEMSELVES while the auto-actor is on — ADVANCE through the same checkpoint door a…
  if (res.sent && typeof simAutoDecisionAdvance_ === 'function') {
    try { res.auto = simAutoDecisionAdvance_(cid); } catch (eAuto) { res.auto = null; }
  }
  return { status: 200, data: res };
}

// ------------------------------------------------------------------ STEP 11 — somebody leaves the process…

// SOMEBODY LEAVES THE PROCESS — the one implementation of it.
function hiringArchiveAndTell_(cid, reason, user, stageWas) {
  var out = { marked: false, told: false };
  var name = '', stage = str_(stageWas);
  try {
    var ev = hubEvidence_(cid);
    if (ev.cand) {
      name = str_(ev.cand.candidatename);
      if (!stage) stage = talentStage_(ev.cand.status) || str_(ev.cand.status);
    }
  } catch (e) { /* the letter can still name the id */ }
  var when = new Date().toISOString();

  try {
    // THE ARCHIVE'S OWN COLUMN NAMES (talentNoNumberList reads exactly these).
    ensureHeader_(hubSheet_(TALENT_CANDIDATES_TAB),
                  ['archived', 'archived_at', 'archived_reason']);
    out.marked = !!hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, {
      archived: 'true', archived_at: when, archived_reason: str_(reason)
    }, user, false);
  } catch (eW) {
    hubSysLog_('asa-hub:hiring', 'archive_mark_failed',
               cid + ' — ' + String((eW && eW.message) || eW), { status: 500 });
  }

  // A Smart Comms situation (hiring_candidate_left): off, the archive stands and nobody is told.
  var leftSit = hubLaneSituation_('hiring_candidate_left');
  if (!leftSit.on || !leftSit.leg('email')) {
    out.why = leftSit.why || 'the situation hiring_candidate_left writes no letter';
    return out;
  }
  try {
    var team = hiringTeamRecipients_();
    var rehearsal = (typeof simIsRehearsalCid_ === 'function') && simIsRehearsalCid_(cid);
    var addr = (rehearsal && typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
    var to = (addr && addr.to) || team.emails.join(', ');
    var leftVars = { name: name || cid, stage: stage, reason: str_(reason) };
    var letter = hiringDiscardEmail_({
      name: name || cid, reason: str_(reason), stage: stage, when: when,
      by: str_(user && user.email),
      subject: leftSit.word('email_subject', ((typeof simText_ === 'function') ? simText_('discard_subject', '') : '')
        .replace(/\{name\}/g, name || cid), leftVars),
      bodyText: leftSit.word('email_text', ((typeof simText_ === 'function') ? simText_('discard_body', '') : '')
        .replace(/\{name\}/g, name || cid), leftVars)
    });
    var res = outreachSend_({
      candidate_id: cid, name: name, step: 'discarded',
      to: to,
      cc: (addr && addr.cc) || '',
      letter: letter,
      reason: 'smart comms: hiring_candidate_left', by: str_(user && user.email)
    });
    out.told = !!res.sent;
    out.send = res;
  } catch (eS) {
    hubSysLog_('asa-hub:hiring', 'archive_notice_failed',
               cid + ' — ' + String((eS && eS.message) || eS), { status: 500 });
  }
  return out;
}

HUB_POLICY.hiringDiscard = {
  file: 'HiringOutreach.gs', lane: 'tool', store: 'sheet',
  // 'tool' AND NOT 'write' IS THE TIER, DECLARED (see snapshot_service.py: the relay reads this lane and gives a…
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: {
    candidate_id: { required: true, type: 'string' },
    reason: { required: true, type: 'string' }
  },
  invalidates: ['candidates'], emits: ['emailSend']
};
// Take somebody out of the process: the status moves to the archived value, the reason is written on their row, the…
HUB_ACTIONS.hiringDiscard = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var p = payload || {};
  var cid = str_(p.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var why = str_(p.reason);
  if (!why) return { status: 400, message: 'a reason is required — the Archive is a record, not a bin' };

  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  var stage = talentStage_(ev.cand.status) || str_(ev.cand.status);

  var wrote = false;
  try {
    // THE STATUS GOES THROUGH hubSetStatus_ and nothing else: it logs the move, it is what the board and the sweeps…
    wrote = hubSetStatus_(cid, 'Not Hiring', user);
  } catch (e) {
    return { status: 500, message: 'could not write the candidate row: ' + String((e && e.message) || e) };
  }
  hubBustTalentCache_();

  // The marking and the letter are hiringArchiveAndTell_'s, so the three Decline paths and this button cannot drift…
  var done = hiringArchiveAndTell_(cid, why, user, stage);
  var res = done.send || { sent: false, reason: 'the notice could not be built' };
  res.moved = wrote;
  res.archived = done.marked;
  res.stage_was = stage;
  return { status: 200, data: res };
};

// ------------------------------------------------------------------ THE ADDED MANUALLY MACHINE…

// A card somebody TYPED IN BY HAND has no referrer to lean on and no flow behind it — until now it just sat at…

// The Added Manually door's own predicate — see the header above.
function manualCardIs_(c) {
  if (!c) return false;
  if (talentStage_(c.status) !== 'new') return false;
  if (str_(c.archived).toLowerCase() === 'true') return false;
  // A CONTACT WE CAN ACTUALLY USE.
  if (!str_(c.phone) && !str_(c.email)) return false;
  return true;
}

// WHAT WE SAY DEPENDS ON HOW THEY GOT HERE, and getting this wrong is not a detail: telling somebody who filled in…
function manualCardOrigin_(c) {
  var by = str_(c && c.createdby);
  var src = str_(c && c.source).toLowerCase();
  if (src.indexOf('application') !== -1) return 'applied';
  if (by.indexOf('asa-hub-resume:') === 0) return 'resume';
  if (by.indexOf('asa-hub-talent-auth:') === 0) return 'store';
  return 'named';
}

// The opening line for each origin — the words live in the book's Strings tab (open.applied / open.resume /…
function manualCardOpening_(origin, first) {
  var key = 'open.' + (origin === 'applied' || origin === 'resume' || origin === 'store'
    ? origin : 'named');
  return bookText_('Strings', key, '').split('{first}').join(first);
}

// WHO ADDED THEM: the substring after created_by's last ':' must be an address; their users-tab row supplies the…
function manualAdderFor_(cand) {
  var cb = str_(cand && cand.createdby);
  var email = cb.slice(cb.lastIndexOf(':') + 1).trim();
  if (email.indexOf('@') === -1) return null;
  var out = { email: email, name: email, phone: '' };
  try {
    usersAll_().forEach(function (u) {
      if (str_(u.email).toLowerCase() !== email.toLowerCase()) return;
      out.name = str_(u.displayname) || email;
      out.phone = str_(u.phone);
    });
  } catch (e) { /* the address alone still carries the letter */ }
  return out;
}

// The house soft-archive, the manual door's stamp.
function manualSoftArchive_(cid, reason) {
  try {
    ensureHeader_(hubSheet_(TALENT_CANDIDATES_TAB),
                  ['archived', 'archived_at', 'archived_by', 'archived_reason']);
    hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, {
      archived: 'true', archived_at: new Date().toISOString(),
      archived_by: 'asa-hub:manual-ladder', archived_reason: str_(reason)
    }, { email: 'asa-hub:manual-ladder' }, false);
  } catch (eW) {
    hubSysLog_('asa-hub:manual-ladder', 'manual_archive_mark_failed',
               cid + ' — ' + String((eW && eW.message) || eW), { status: 500 });
    return false;
  }
  try { if (typeof hubBustTalentCache_ === 'function') hubBustTalentCache_(); } catch (eB) {}
  return true;
}

HUB_POLICY.manualContactSend = {
  file: 'HiringOutreach.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' } },
  invalidates: ['candidates'], emits: ['emailSend', 'smsSend']
};
// First contact for a hand-added card: no referrer to name — a colleague at ASA LifeCare gave us the name — both…
HUB_ACTIONS.manualContactSend = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload && payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  // THE CARD MAY HAVE MOVED ON since the ask was booked (discarded by a person, advanced by the walk) — the retry…
  if (str_(ev.cand.archived).toLowerCase() === 'true' ||
      talentStage_(str_(ev.cand.status)) !== 'new') {
    try { simAskAnswer_(['manual_contact', 'manual_adder'], 'the card moved on — the machine lets go', cid); } catch (eGone) {}
    return { status: 200, data: { sent: false, reason: 'card_moved_on' } };
  }
  // THE SWITCH IS A SITUATION ROW, like every other message in this file — smart comms owns it.
  var sit = outreachAllowed_(commSituationId_('hiring.first_contact', 'hiring_first_contact'));
  if (!sit.ok) {
    return { status: 200, data: { sent: false, reason: 'situation_off', detail: sit.reason } };
  }
  var name = str_(ev.cand.candidatename);
  var first = hiringGreetFirst_(name);
  var out = { sent: false, email: null, sms: null };
  // The origin-aware first sentence, resolved once and carried into whichever words win below as {opening}.
  var opening = manualCardOpening_(manualCardOrigin_(ev.cand), first);
  var fillFc = function (s) {
    return String(s || '').replace(/\{opening\}/g, opening)
      .replace(/\{first_name\}/g, first).replace(/\{name\}/g, name);
  };
  // WHERE THE WORDS COME FROM, and the order is the whole fix.
  var fcWords_ = function (sitKey, cfgKey, floor) {
    var v = str_(sit.sit && sit.sit[sitKey]);
    if (!v && typeof simText_ === 'function') v = simText_(cfgKey, '');
    return fillFc(v || floor);
  };

  // Opted out is answered early so the sweep can say why nothing went.
  if (typeof optOutBlocked_ === 'function') {
    try {
      var stopped = optOutBlocked_(str_(ev.cand.phone));
      if (stopped) out.sms = { sent: false, reason: 'opted_out', detail: stopped };
    } catch (eO) { /* the sender refuses on an unreadable list */ }
  }
  if (!out.sms) {
    var smsBody = fcWords_('sms_text', 'manual_contact_sms', '{opening}');
    out.sms = outreachSms_({
      candidate_id: cid, name: name, step: 'manual_contact',
      to: str_(ev.cand.phone), body: smsBody,
      intro: (typeof simQuoIntro_ === 'function')
        ? simQuoIntro_(bookText_('Strings', 'purpose.first_contact', '')) : '',
      reason: 'hiring: first contact for a hand-added card', by: str_(user && user.email)
    });
  }

  var email = str_(ev.cand.email);
  if (email.indexOf('@') !== -1) {
    var subject = fcWords_('email_subject', 'manual_contact_subject',
                           bookText_('Strings', 'manual_contact.subject.floor', ''));
    var bodyText = fcWords_('email_text', 'manual_contact_body',
                            bookText_('Strings', 'manual_contact.body.floor', ''));
    // The letter's own heading follows the opening rather than announcing a referrer to somebody who applied…
    var applied = manualCardOrigin_(ev.cand) === 'applied';
    var html = mailShell_({
      eyebrow: 'ASA LifeCare',
      title: bookText_('Strings', applied ? 'manual_contact.title.applied'
                                          : 'manual_contact.title.talk', ''),
      preheader: bookText_('Strings', applied ? 'manual_contact.preheader.applied'
                                              : 'manual_contact.preheader.talk', ''),
      blocks: bodyText.split(/\n{2,}/).map(function (p) {
        return mailPara_(mailEsc_(p).replace(/\n/g, '<br>'));
      }),
      cta: null,
      footnote: bookText_('Strings', 'manual_contact.footnote', '')
    });
    out.email = outreachSend_({
      candidate_id: cid, name: name, step: 'manual_contact', to: email,
      cc: (typeof simCcFor_ === 'function') ? simCcFor_(email) : '',
      letter: { subject: subject, text: bodyText, html: html },
      reason: 'hiring: first contact for a hand-added card', by: str_(user && user.email)
    });
  } else {
    out.email = { sent: false, reason: 'no_email' };
  }

  out.sent = !!((out.email && out.email.sent) || (out.sms && out.sms.sent));
  out.redirected = !!((out.email && out.email.redirected) || (out.sms && out.sms.redirected));
  // A TOTAL refusal still enters the book: the clock then governs the retries (max_attempts bounds them) instead of…
  if (!out.sent && typeof simTrackSend_ === 'function') {
    try {
      simTrackSend_('manual_contact', cid, 'manualContactSend', { candidate_id: cid });
      journeyLog_({ candidate_id: cid, name: name, step: 'manual_contact', channel: 'record',
                    ok: false, title: 'Nothing could be sent',
                    detail: 'both legs refused (' +
                            str_(out.sms && (out.sms.reason || out.sms.error)) + ' / ' +
                            str_(out.email && (out.email.reason || out.email.error)) +
                            ') — the clock retries on the book, bounded by its attempts',
                    by: str_(user && user.email) });
    } catch (eBk) {}
  }
  if (out.sent && typeof simTrackSend_ === 'function') {
    var tracked = simTrackSend_('manual_contact', cid, 'manualContactSend', { candidate_id: cid });
    out.attempt = tracked.attempt;
    out.attempts_max = tracked.of;
    if (tracked.attempt === 1) {
      // once — the retry pass narrates every later attempt on its own
      journeyLog_({ candidate_id: cid, name: name, step: 'manual_contact', channel: 'record',
                    ok: true, title: 'The manual first-contact entered the book',
                    detail: 'a hand-added card — both legs went through the outreach transports; ' +
                            're-asked on the manual clock until they answer, call the screen line, ' +
                            'or whoever added them decides',
                    by: str_(user && user.email) });
    }
  }
  hubBustTalentCache_();
  return { status: 200, data: out };
};

// THE EAR OF THE MANUAL MACHINE — deterministic only, one verdict per message ever (the HIRING_SIM_AI_TAB memo with…
function manualContactScanRun_() {
  var out = { checked: 0, judged: 0, contacted: 0, adder_acted: 0 };
  var asks;
  try {
    asks = simAskRows_().filter(function (r) {
      var st = str_(r.state), sp = str_(r.step);
      return (st === 'open' || st === 'exhausted') &&
             (sp === 'manual_contact' || sp === 'manual_adder' ||
              sp === 'phone_collect' || sp === 'phone_confirm');
    });
  } catch (e) { return out; }
  if (!asks.length) return out;

  var byCid = {};
  asks.forEach(function (r) {
    var cid = str_(r.candidateid);
    if (!cid) return;
    var slot = (byCid[cid] = byCid[cid] || {});
    slot[str_(r.step)] = true;
    // THE FLOOR: an old thread is history, not an answer — only words that arrived AFTER the ask was born may count…
    if (str_(r.step) === 'manual_contact') slot.sinceContact = str_(r.createdat);
    else if (str_(r.step) === 'phone_collect') { slot.sinceCollect = str_(r.createdat); slot.collectState = str_(r.state); }
    else if (str_(r.step) === 'phone_confirm') { slot.sinceConfirm = str_(r.createdat); slot.confirmState = str_(r.state); }
    else slot.sinceAdder = str_(r.createdat);
  });

  // one mailbox read for the whole pass — the referral ear's shape
  var threads = [];
  if (typeof platformMailPost_ === 'function') {
    try {
      var inbox = platformMailPost_('/mail/inbox', { limit: 50 });
      if (inbox && inbox.status === 200) threads = (inbox.data && inbox.data.threads) || [];
    } catch (eM) { threads = []; }
  }

  // the memo — never judge blind: an unreadable memo ends the pass
  var judged = {}, memo = null;
  try {
    var ss = ssOpen_(hubId_('HUB_DB_ID'));
    memo = hubTabEnsure_(HIRING_SIM_AI_TAB, HIRING_SIM_AI_HEADER);
    readTabNormalized_(ss, HIRING_SIM_AI_TAB).forEach(function (r) {
      if (str_(r.messageid)) judged[str_(r.messageid)] = str_(r.verdict);
    });
  } catch (eJ) { return out; }

  /** Remember one verdict; false = unmemoed, so nothing may rely on it. */
  var memoPut = function (mid, verdict) {
    try { memo.appendRow([mid, verdict, '', 'rule', new Date().toISOString()]); }
    catch (eW) { return false; }
    judged[mid] = verdict;
    out.judged++;
    return true;
  };

  Object.keys(byCid).forEach(function (cid) {
    out.checked++;
    var ev;
    try { ev = hubEvidence_(cid); } catch (eE) { return; }
    if (!ev || !ev.cand) return;
    if (str_(ev.cand.archived).toLowerCase() === 'true') return;   // the machine already ended
    var name = str_(ev.cand.candidatename);
    var digits = str_(ev.cand.phone).replace(/\D/g, '').replace(/^1/, '').slice(-10);
    // a shared company line identifies nobody — the SMS half stays shut on one
    if (typeof SHARED_LINE_DIGITS !== 'undefined' &&
        SHARED_LINE_DIGITS.indexOf(digits) !== -1) digits = '';
    // …unless the redirect is live, in which case the tester IS who we wrote to, and their reply is the card's…
    var testers = (typeof simTesterKeys_ === 'function') ? simTesterKeys_() : { digits: [], emails: [] };

    // Contact landed: both asks settle, the journey tells it, and the NEXT STEP fires as ONE pair…
    var contact = function (what, channel, text) {
      // SETTLE FIRST — a settle that closed nothing must leave the message unjudged, so the answer is re-read next…
      var closed = 0;
      try { closed = simAskAnswer_(['manual_contact', 'manual_adder'], 'they answered — the walk continues', cid); } catch (eA) { closed = 0; }
      if (!closed) return false;
      out.contacted++;
      var words = String(text || '');
      var mcNoRe = bookWordsRegex_('words.contact.no', 'any');
      var mcYesRe = bookWordsRegex_('words.contact.yes', 'any');
      var saidNo = !!(mcNoRe && mcNoRe.test(words));
      var saidYes = !saidNo && !!(mcYesRe && mcYesRe.test(words));
      if (saidYes) {
        try { hubSetStatus_(cid, HUB_STAGE_TO_STATUS['phone-screen'], { email: 'asa-hub:manual-ladder' }); } catch (eMv) {}
        journeyLog_({ candidate_id: cid, name: name, step: 'manual_contact', channel: channel,
                      ok: true, title: 'They said YES — moved to Phone Screen',
                      detail: 'the invitation was accepted (' + what + ') — the card advances by itself',
                      by: 'asa-hub:manual-ladder' });
      } else if (saidNo) {
        try {
          ensureHeader_(hubSheet_(TALENT_CANDIDATES_TAB),
                        ['archived', 'archived_at', 'archived_by', 'archived_reason']);
          hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, {
            archived: 'true', archived_at: new Date().toISOString(),
            archived_by: 'asa-hub:manual-ladder',
            archived_reason: 'they declined the invitation to the selection process'
          }, { email: 'asa-hub:manual-ladder' }, false);
          try { if (typeof hubBustTalentCache_ === 'function') hubBustTalentCache_(); } catch (eB) {}
        } catch (eArc) {}
        journeyLog_({ candidate_id: cid, name: name, step: 'manual_contact', channel: channel,
                      ok: true, title: 'They said NO — archived',
                      detail: 'the invitation was declined (' + what + ') — nothing deleted, it comes back whole',
                      by: 'asa-hub:manual-ladder' });
      } else {
        journeyLog_({ candidate_id: cid, name: name, step: 'manual_contact', channel: channel,
                      ok: true, title: 'Contact landed — waiting for a clear YES or NO',
                      detail: 'they replied (' + what + ') but the words carried neither a yes nor a no; the asking rests and a person decides',
                      by: 'asa-hub:manual-ladder' });
      }
      return true;
    };


    // 0 — THE PHONE-COLLECTION PAIR, as dictated, before anything else: an e-mail-only candidate was asked BY…
    if (byCid[cid].collectState === 'open') {
      var pcMail = str_(ev.cand.email).toLowerCase();
      var pcKeys = (pcMail.indexOf('@') !== -1 ? [pcMail] : []).concat(testers.emails);
      for (var pi = 0; pi < threads.length; pi++) {
        var pt = threads[pi] || {};
        var pFrom = str_(pt.from_addr).toLowerCase();
        var pHit = false;
        for (var pk = 0; pk < pcKeys.length; pk++) {
          if (pcKeys[pk] && pFrom.indexOf(pcKeys[pk]) !== -1) { pHit = true; break; }
        }
        if (!pHit) continue;
        if (byCid[cid].sinceCollect && str_(pt.date) && str_(pt.date) < byCid[cid].sinceCollect) continue;
        var pMid = 'man:' + str_(pt.id || (str_(pt.date) + '|' + str_(pt.subject)));
        if (judged[pMid] !== undefined) continue;
        var pNum = '';
        var pm = String(str_(pt.snippet)).match(/[+(]?\d[\d\s().-]{8,}\d/);
        if (pm) pNum = pm[0].replace(/\D/g, '').replace(/^1/, '').slice(-10);
        if (pNum.length === 10) {
          try {
            hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, { phone: '+1' + pNum },
                                { email: 'asa-hub:phone-collect' }, false);
            try { if (typeof hubBustTalentCache_ === 'function') hubBustTalentCache_(); } catch (eB2) {}
          } catch (eW2) { continue; }             // unwritten = unjudged — re-read next pass
          try { simAskAnswer_(['phone_collect'], 'their letter carried a number', cid); } catch (eA2) {}
          journeyLog_({ candidate_id: cid, name: name, step: 'phone_collect', channel: 'email',
                        ok: true, title: 'A phone number arrived',
                        detail: 'their letter carried +1' + pNum + ' — the confirmation text begins',
                        by: 'asa-hub:phone-collect' });
          try {
            HUB_ACTIONS.hiringPhoneConfirmSend({ candidate_id: cid },
              { role: 'manager', email: 'phone-collect@service.local', id: 'SVC_PHONE_COLLECT' });
          } catch (eCf) { /* the retry rung re-presses */ }
          memoPut(pMid, 'phone_collect');
          out.contacted++;
          return;
        }
        memoPut(pMid, 'phone_collect_no_number');  // judged, so never re-read forever
      }
    }
    if (byCid[cid].confirmState === 'open') {
      var cfDigits = str_(ev.cand.phone).replace(/\D/g, '').replace(/^1/, '').slice(-10);
      var cfKeys = (cfDigits.length === 10 ? [cfDigits] : []).concat(testers.digits);
      if (cfKeys.length) {
        if (cfDigits.length === 10) { try { quoInboundPull_('MAN:' + cid, name, str_(ev.cand.phone)); } catch (eP3) {} }
        var cfMid = '', cfText = '';
        try {
          readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), INBOUND_TAB).forEach(function (m2) {
            if (cfMid) return;
            if (str_(m2.candidateid) !== 'MAN:' + cid) return;
            if (cfKeys.indexOf(str_(m2.fromkey)) === -1) return;
            if (byCid[cid].sinceConfirm && str_(m2.receivedat) < byCid[cid].sinceConfirm) return;
            var mid2 = 'man:' + (str_(m2.messageid) || (str_(m2.receivedat) + '|' + str_(m2.fromkey)));
            if (judged[mid2] !== undefined) return;
            cfMid = mid2; cfText = str_(m2.body);
          });
        } catch (eI2) { /* next pass re-reads */ }
        var pcYes = bookWordsRegex_('words.phone_confirm.yes', 'any');
        if (cfMid && pcYes && pcYes.test(cfText)) {
          try { simAskAnswer_(['phone_confirm'], 'they confirmed the number', cid); } catch (eA3) {}
          try { hubSetStatus_(cid, HUB_STAGE_TO_STATUS['phone-screen'], { email: 'asa-hub:phone-collect' }); } catch (eMv2) {}
          journeyLog_({ candidate_id: cid, name: name, step: 'phone_confirm', channel: 'sms',
                        ok: true, title: 'Phone confirmed — moved to Phone Screen',
                        detail: 'they answered the confirmation text — the phone is verified and the card advances',
                        by: 'asa-hub:phone-collect' });
          memoPut(cfMid, 'phone_confirm');
          out.contacted++;
          return;
        }
        if (cfMid) memoPut(cfMid, 'phone_confirm_unclear');
      }
    }
    if (byCid[cid].collectState === 'exhausted' || byCid[cid].confirmState === 'exhausted') {
      // the dictated ending: the team is told once that the phone could not be collected — then the exhausted ask…
      var cfSit = (typeof smartSituationOn_ === 'function')
        ? smartSituationOn_(commSituationId_('hiring.contact_failed', 'hiring_contact_failed')) : null;
      if (cfSit) {
        var cfFill = function (t) {
          return String(t || '').split('{name}').join(name || cid)
            .split('{email}').join(str_(ev.cand.email) || '-')
            .split('{phone}').join(str_(ev.cand.phone) || '-');
        };
        try {
          var cfRehearsal = (typeof commsIsTestCandidate_ === 'function') && commsIsTestCandidate_(ev.cand);
          var cfAddr = (cfRehearsal && typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
          var cfTeam = (typeof hiringTeamRecipients_ === 'function') ? hiringTeamRecipients_() : { emails: [], sms: [] };
          var cfTo = (cfAddr && cfAddr.to) || (cfTeam.emails || []).join(', ');
          if (cfTo) {
            rpcCall_('emailSend', {
              to: cfTo, cc: (cfAddr && cfAddr.cc) || '',
              subject: (typeof simTagSubject_ === 'function')
                ? simTagSubject_(cfFill(str_(cfSit.email_subject))) : cfFill(str_(cfSit.email_subject)),
              body: cfFill(str_(cfSit.email_text)),
              reason: 'hiring: could not collect a phone for ' + (name || cid)
            }, { idempotency_key: 'phone_fail_mail_' + cid });
          }
          var cfSms = cfFill(str_(cfSit.sms_text));
          if (cfSms) {
            (cfTeam.sms || []).forEach(function (n2) {
              var num2 = (typeof simSendablePhone_ === 'function') ? simSendablePhone_(n2) : n2;
              if (!num2) return;
              rpcCall_('smsSend', { to: num2, body: cfSms,
                reason: 'hiring: could not collect a phone for ' + (name || cid) },
                { idempotency_key: 'phone_fail_sms_' + cid + '_' + String(num2).replace(/\D/g, '') });
            });
          }
        } catch (eTf) {
          hubSysLog_('asa-hub:phone-collect', 'contact_failed_notice_error',
                     cid + ' — ' + String((eTf && eTf.message) || eTf), { status: 500 });
        }
        try { simAskAnswer_(['phone_collect', 'phone_confirm'], 'the team was told collection failed', cid); } catch (eA4) {}
        journeyLog_({ candidate_id: cid, name: name, step: 'phone_collect', channel: 'record',
                      ok: false, title: 'The team was told — no phone could be collected',
                      detail: 'every configured try went out unanswered; Arthur and Ty were written once',
                      by: 'asa-hub:phone-collect' });
      }
    }

    // 1 — the candidate's own answer, either channel: the reply IS the return
    if (byCid[cid]['manual_contact']) {
      // (i) their SMS — mirrored in under its OWN key ('MAN:'+cid), so the outreach reply scan never reads these…
      var smsKeys = (digits.length === 10 ? [digits] : []).concat(testers.digits);
      if (smsKeys.length) {
        // one pull per key — the tester's thread is a different conversation from the candidate's, and only the…
        if (digits.length === 10) { try { quoInboundPull_('MAN:' + cid, name, str_(ev.cand.phone)); } catch (eP) {} }
        testers.digits.forEach(function (d) {
          try { quoInboundPull_('MAN:' + cid, name, '+1' + d); } catch (eP2) {}
        });
        var hitMid = '', hitText = '';
        try {
          readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), INBOUND_TAB).forEach(function (m) {
            if (hitMid) return;
            if (str_(m.candidateid) !== 'MAN:' + cid) return;
            if (smsKeys.indexOf(str_(m.fromkey)) === -1) return;
            // the floor — history is not an answer
            if (byCid[cid].sinceContact && str_(m.receivedat) < byCid[cid].sinceContact) return;
            var mid = 'man:' + (str_(m.messageid) || (str_(m.receivedat) + '|' + str_(m.fromkey)));
            if (judged[mid] !== undefined) return;
            hitMid = mid;                          // ANY inbound message AFTER the ask IS the contact
            hitText = str_(m.body);                // …and its WORDS are the verdict now
          });
        } catch (eI) { /* the e-mail half still reads */ }
        if (hitMid) {
          // act first, memo after — an unmemoed act re-reads next pass
          if (contact('their own text reply', 'sms', hitText)) memoPut(hitMid, 'man_contact');
          return;
        }
      }
      // (ii) their e-mail reply — the platform mailbox, their address as the gate, and the tester's address beside…
      var candEmail = str_(ev.cand.email).toLowerCase();
      var mailKeys = (candEmail.indexOf('@') !== -1 ? [candEmail] : []).concat(testers.emails);
      if (mailKeys.length) {
        for (var i = 0; i < threads.length; i++) {
          var t = threads[i] || {};
          var fromAddr = str_(t.from_addr).toLowerCase();
          var matched = false;
          for (var mk = 0; mk < mailKeys.length; mk++) {
            if (fromAddr.indexOf(mailKeys[mk]) !== -1) { matched = true; break; }
          }
          if (!matched) continue;
          // the floor — a letter older than the ask is history
          if (byCid[cid].sinceContact && str_(t.date) && str_(t.date) < byCid[cid].sinceContact) continue;
          var mid1 = 'man:' + str_(t.id || (str_(t.date) + '|' + str_(t.subject)));
          if (judged[mid1] !== undefined) continue;
          if (contact('their own letter', 'email', str_(t.snippet))) memoPut(mid1, 'man_contact');
          return;
        }
      }
    }

    // 2 — the adder's answers, once the relay is on them
    if (!byCid[cid]['manual_adder']) return;
    var adder = manualAdderFor_(ev.cand);
    if (!adder) return;
    var adderDigits = str_(adder.phone).replace(/\D/g, '').replace(/^1/, '').slice(-10);
    // a shared company line is nobody's own thread — the letter gate remains
    if (typeof SHARED_LINE_DIGITS !== 'undefined' &&
        SHARED_LINE_DIGITS.indexOf(adderDigits) !== -1) adderDigits = '';

    // One verdict on the adder's words — deterministic, never a model.
    var adderJudge = function (body, mid, channel) {
      // THE ADDER'S OWN WORDS ONLY: quoted reply tails carry OUR letter — which says WITHDRAW twice by design — so…
      var s = String(body || '').split(/\r?\n\s*>|\bOn .{0,80} wrote:/)[0];
      var awRe = bookWordsRegex_('words.adder.withdraw', 'any');
      if (awRe && awRe.test(s)) {
        // stamp first, memo after — an unmarked card must be re-read
        if (manualSoftArchive_(cid, 'Withdrawn by the person who added them')) {
          try { simAskAnswer_(['manual_contact', 'manual_adder'], adder.name + ' withdrew the candidacy', cid); } catch (eA1) {}
          out.adder_acted++;
          journeyLog_({ candidate_id: cid, name: name, step: 'manual_contact', channel: channel,
                        ok: true, title: 'The adder withdrew the candidacy',
                        detail: adder.name + ' answered WITHDRAW — soft-archived ' +
                                '(Withdrawn by the person who added them); both asks closed',
                        by: 'asa-hub:manual-ladder' });
          memoPut(mid, 'man_withdraw');
        }
        return true;
      }
      var wrRe = bookWordsRegex_('words.adder.wrong', 'any');
      if (wrRe && wrRe.test(s)) {
        if (manualSoftArchive_(cid, 'The contacts were confirmed wrong')) {
          try { simAskAnswer_(['manual_contact', 'manual_adder'], adder.name + ' confirmed the contacts wrong', cid); } catch (eA2) {}
          out.adder_acted++;
          journeyLog_({ candidate_id: cid, name: name, step: 'manual_contact', channel: channel,
                        ok: true, title: 'The contacts were confirmed wrong',
                        detail: adder.name + ' says the contacts are wrong — soft-archived; ' +
                                'a corrected card can be added again',
                        by: 'asa-hub:manual-ladder' });
          memoPut(mid, 'man_wrong');
        }
        return true;
      }
      // anything else — said once per message, and the door stays open
      journeyLog_({ candidate_id: cid, name: name, step: 'manual_contact', channel: channel,
                    ok: true, title: 'The adder answered',
                    detail: 'the adder answered — the door stays open: "' + s.slice(0, 120) + '"',
                    by: 'asa-hub:manual-ladder' });
      memoPut(mid, 'man_open');
      return false;
    };

    // (i) by text — the thread mirrored in under its OWN key ('ADD:'+cid)
    if (adderDigits.length === 10) {
      try { quoInboundPull_('ADD:' + cid, adder.name, adder.phone); } catch (eP2) {}
      var rows2 = [];
      try {
        readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), INBOUND_TAB).forEach(function (m) {
          if (str_(m.candidateid) !== 'ADD:' + cid) return;
          if (str_(m.fromkey) !== adderDigits) return;
          // the floor — only words after the adder was asked may judge
          if (byCid[cid].sinceAdder && str_(m.receivedat) < byCid[cid].sinceAdder) return;
          rows2.push(m);
        });
      } catch (eI2) { rows2 = []; }
      for (var k = 0; k < rows2.length; k++) {
        var mid2 = 'man:' + (str_(rows2[k].messageid) || (str_(rows2[k].receivedat) + '|' + adderDigits));
        if (judged[mid2] !== undefined) continue;
        if (adderJudge(str_(rows2[k].body), mid2, 'sms')) return;
      }
    }
    // (ii) by letter — the same mailbox read, the adder's address as the gate
    if (adder.email.indexOf('@') !== -1) {
      for (var j = 0; j < threads.length; j++) {
        var t2 = threads[j] || {};
        if (str_(t2.from_addr).toLowerCase().indexOf(adder.email.toLowerCase()) === -1) continue;
        if (byCid[cid].sinceAdder && str_(t2.date) && str_(t2.date) < byCid[cid].sinceAdder) continue;
        var mid3 = 'man:' + str_(t2.id || (str_(t2.date) + '|' + str_(t2.subject)));
        if (judged[mid3] !== undefined) continue;
        if (adderJudge(str_(t2.snippet), mid3, 'email')) return;
      }
    }
  });
  return out;
}

// MOUTH #1 — the machine's entry.
function manualContactSweepMaybe_() {
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('manual_contact_sweep')) return;
  cache.put('manual_contact_sweep', '1', 900);

  // A PASS THAT DOES NOTHING SAYS WHY.
  var fcSit = (typeof outreachAllowed_ === 'function')
    ? outreachAllowed_(commSituationId_('hiring.first_contact', 'hiring_first_contact')) : { ok: true };
  if (!fcSit.ok) {
    if (typeof tpSweepIdle_ === 'function') {
      tpSweepIdle_('manual-ladder', outreachIdleWhy_(fcSit,
                   'hiring_first_contact is OFF in Smart Comms — nobody standing at New ' +
                   'is spoken to, and the queue stays blocked behind them'));
    }
    return;
  }

  var booked = {};
  try {
    simAskRows_().forEach(function (r) {
      var sp = str_(r.step);
      if (sp !== 'manual_contact' && sp !== 'phone_collect' && sp !== 'phone_confirm') return;
      var bCid = str_(r.candidateid);
      if (bCid) booked[bCid] = true;              // any state — asked is asked
    });
  } catch (e) {
    // NEVER press blind: an unreadable book would re-first-contact every already-asked card off-clock.
    return;
  }

  // ARMED FROM NOW: the machine works only cards born AFTER it first ran — the standing backlog of hand-typed 'New'…
  var props = PropertiesService.getScriptProperties();
  var armedAt = str_(props.getProperty('MANUAL_MACHINE_ARMED_AT'));
  var armedCell = '';
  try { armedCell = str_(simCfgVal_('sim_manual_armed_from')); } catch (eAc) { armedCell = ''; }
  if (armedCell) {
 // A bare date means the START of that day — must include everything stamped on the 1st, not everything after…
    armedAt = /^\d{4}-\d{2}-\d{2}$/.test(armedCell) ? (armedCell + 'T00:00:00.000Z') : armedCell;
  }
  if (!armedAt) {
    armedAt = new Date().toISOString();
    try {
      props.setProperty('MANUAL_MACHINE_ARMED_AT', armedAt);
      hubSysLog_('asa-hub:manual-ladder', 'manual_machine_armed',
                 'cards born after ' + armedAt + ' enter the contact machine', { status: 200 });
    } catch (eArm) { return; }                    // unstamped = unarmed
  }

  var actor = { role: 'manager', email: 'hiring-manual-sweep@service.local', id: 'SVC_HIRING_SIM' };
  var pressed = 0;
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB).forEach(function (c) {
      if (pressed >= 10) return;                  // budget — the next pass takes the next ten
      if (!manualCardIs_(c)) return;
      if (str_(c.createdat) < armedAt) return;    // born before the arming — never touched
      var cid = str_(c.candidateid);
      if (!cid || booked[cid]) return;
      booked[cid] = true;                         // one press per pass, whatever it answers
      try {
        // WHICH DOOR, as dictated: a card holding a phone gets invitation (both legs); an e-mail-only card first…
        if (str_(c.phone)) {
          HUB_ACTIONS.manualContactSend({ candidate_id: cid }, actor);
        } else {
          HUB_ACTIONS.hiringPhoneCollectAsk({ candidate_id: cid }, actor);
        }
        pressed++;
      } catch (eP) {
        hubSysLog_('asa-hub:manual-ladder', 'manual_contact_press_failed',
                   cid + ' — ' + String((eP && eP.message) || eP), { status: 500 });
      }
    });
  } catch (eC) { /* an unreadable tab — the next pass reads again */ }

  if (!pressed && typeof tpSweepIdle_ === 'function') {
    tpSweepIdle_('manual-ladder',
                 'ran and spoke to nobody — every card at New is already in the ask book, ' +
                 'or was born before ' + armedAt);
  }

  // mouth #2 (its own throttle) and the 4040 door ride the same pass
  try { manualAdderSweepMaybe_(); }
  catch (eA) {
    hubSysLog_('asa-hub:manual-ladder', 'manual_adder_sweep_error',
               String((eA && eA.message) || eA), { status: 500 });
  }
  try { manualCallDoorRun_(); }
  catch (eD) {
    hubSysLog_('asa-hub:manual-ladder', 'manual_call_door_error',
               String((eD && eD.message) || eD), { status: 500 });
  }
}

// MOUTH #2 — THE ADDER RELAY AND THE DISCARD (b and c, as dictated).
function manualAdderSweepMaybe_() {
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('manual_adder_sweep')) return;
  cache.put('manual_adder_sweep', '1', 900);

  var asks;
  try { asks = simAskRows_(); } catch (e) { return; }
  var byCid = {};
  asks.forEach(function (r) {
    var cid = str_(r.candidateid);
    if (!cid) return;
    var sp = str_(r.step);
    if (sp !== 'manual_contact' && sp !== 'manual_adder') return;
    var slot = byCid[cid] = byCid[cid] || {};
    slot[sp] = str_(r.state);                     // last row wins
    if (sp === 'manual_contact') slot.contact = r;
    if (sp === 'manual_adder') slot.adder = r;
  });

  // THE GRACE CLOCK: 'exhausted' alone can mean two sweep ticks — the asking must sit quiet its own interval past…
  var quietPast = function (row, fallbackMins) {
    if (!row) return true;
    var mins = parseInt(str_(row.intervalminutes), 10) || fallbackMins || 30;
    var last = new Date(str_(row.lastsentat) || str_(row.createdat)).getTime();
    if (isNaN(last)) return true;
    return (Date.now() - last) >= mins * 60000;
  };

  Object.keys(byCid).forEach(function (cid) {
    if (byCid[cid]['manual_contact'] !== 'exhausted') return;
    var ev;
    try { ev = hubEvidence_(cid); } catch (eE) { return; }
    if (!ev || !ev.cand) return;
    if (str_(ev.cand.archived).toLowerCase() === 'true') return;
    var name = str_(ev.cand.candidatename);
    var first = hiringGreetFirst_(name);
    var adder = manualAdderFor_(ev.cand);
    var adderState = byCid[cid]['manual_adder'] || '';

    // the screen line the letter offers — the phone-screen door
    var actors = (typeof hiringSimActors_ === 'function') ? hiringSimActors_() : null;
    var line = (actors && actors.screen_line) ||
      ((typeof COMMS_SCREEN_LINES !== 'undefined' && COMMS_SCREEN_LINES.length)
        ? '+1' + COMMS_SCREEN_LINES[0] : '');
    var lineLabel = line.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') || line;

    // THE CANDIDATE'S DATA, printed for the adder — blank facts left out
    var dataLines = ['Name: ' + (name || cid)];
    if (str_(ev.cand.phone)) dataLines.push('Phone: ' + str_(ev.cand.phone));
    if (str_(ev.cand.email)) dataLines.push('E-mail: ' + str_(ev.cand.email));
    if (str_(ev.cand.source)) dataLines.push('Source: ' + str_(ev.cand.source));
    if (str_(ev.cand.createdat)) dataLines.push('Applied: ' + str_(ev.cand.createdat).slice(0, 10));
    var dataText = dataLines.join('\n');

    // THE REHEARSAL FENCE, IRON — the referral relay's exact pattern: a [TEST] card's letter goes to the actor…
    var rehearsal26 = false;
    try {
      rehearsal26 = (typeof commsIsTestCandidate_ === 'function') && commsIsTestCandidate_(ev.cand);
    } catch (eTst) { rehearsal26 = false; }

    var fill = function (s) {
      return String(s || '').replace(/\{name\}/g, name).replace(/\{first_name\}/g, first)
        .replace(/\{adder\}/g, (adder && adder.name) || 'you')
        .replace(/\{data\}/g, dataText).replace(/\{screen_line\}/g, lineLabel);
    };

    // One adder round — the letter always, the text when a number exists.
    var adderVars = { name: name, first_name: first, adder: (adder && adder.name) || 'you',
                      data: dataText, screen_line: lineLabel };
    var adderSend = function (attempt) {
      // A Smart Comms situation (hiring_manual_adder_ask): off, nothing leaves and nothing is booked.
      var adderSit = hubLaneSituation_('hiring_manual_adder_ask');
      if (!adderSit.on) return false;
      var suffix = attempt > 1 ? '_a' + attempt : '';
      var sentAny = false;
      var subject = adderSit.word('email_subject',
        fill((typeof simText_ === 'function') ? simText_('manual_adder_subject', '') : '') ||
        bookText_('Strings', 'manual_adder.subject.floor', '').split('{name}').join(name), adderVars);
      if (typeof simTagSubject_ === 'function') subject = simTagSubject_(subject);
      var bodyText = adderSit.word('email_text',
        fill((typeof simText_ === 'function') ? simText_('manual_adder_body', '') : '') ||
        bookText_('Strings', 'manual_adder.body.floor', '')
          .split('{adder}').join((adder && adder.name) ||
            bookText_('Strings', 'manual_adder.greeting.floor', ''))
          .split('{name}').join(name)
          .split('{line}').join(lineLabel)
          .split('{data}').join(dataText), adderVars);
      var html = mailShell_({
        eyebrow: 'ASA LifeCare',
        title: bookText_('Strings', 'manual_adder.title', '').split('{name}').join(name),
        preheader: bookText_('Strings', 'manual_adder.preheader', ''),
        blocks: bodyText.split(/\n{2,}/).map(function (p2) {
          return mailPara_(mailEsc_(p2).replace(/\n/g, '<br>'));
        }),
        cta: null,
        footnote: bookText_('Strings', 'manual_adder.footnote', '')
      });
      var mailTo = adderSit.leg('email') ? adder.email : '';
      if (rehearsal26 && mailTo) {
        var addr26 = (typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
        mailTo = (addr26 && addr26.to) || '';
        if (!mailTo) {
          journeyLog_({ candidate_id: cid, name: name, step: 'manual_contact', channel: 'email',
                        ok: false, rehearsal: true,
                        detail: 'THE ADDER ASK (rehearsal): no actor mailbox (sim_team_email) — the letter leg is skipped',
                        by: 'asa-hub:manual-ladder' });
        }
      }
      if (mailTo) {
        var rm = rpcCall_('emailSend',
          { to: mailTo, subject: subject, body: bodyText, html: html,
            reason: 'smart comms: hiring_manual_adder_ask' },
          { idempotency_key: 'man_adder_mail_' + cid + suffix });
        sentAny = sentAny || !!(rm && (rm.sent || rm.deduplicated));
        journeyLog_({ candidate_id: cid, name: name, step: 'manual_contact', channel: 'email',
                      to: mailTo, ok: !!(rm && (rm.sent || rm.deduplicated)),
                      title: 'The adder is asked',
                      detail: 'nobody could reach ' + name + ' — ' + adder.name +
                              ' (who added them) is asked by letter: withdraw, or reach them ' +
                              'yourself; the screen line starts the phone screening (attempt ' + attempt + ')' +
                              (rehearsal26 ? ' (rehearsal — redirected to the actor mailbox)' : '') +
                              ((rm && (rm.sent || rm.deduplicated)) ? '' : ' — not sent: ' +
                               (str_(rm && (rm.error || rm.reason)) || 'refused')),
                      by: 'asa-hub:manual-ladder' });
      }
      var adderDigits = str_(adder.phone).replace(/\D/g, '').replace(/^1/, '').slice(-10);
      if (adderDigits.length === 10 && typeof SHARED_LINE_DIGITS !== 'undefined' &&
          SHARED_LINE_DIGITS.indexOf(adderDigits) !== -1) adderDigits = '';   // a shared line is nobody
      if (adderDigits.length === 10 && adderSit.leg('sms')) {
        var smsBody = adderSit.word('sms_text',
          fill((typeof simText_ === 'function') ? simText_('manual_adder_sms', '') : '') ||
          bookText_('Strings', 'manual_adder.sms.floor', '')
            .split('{name}').join(name).split('{line}').join(lineLabel), adderVars);
        if (typeof simTagSubject_ === 'function') smsBody = simTagSubject_(smsBody);
        if (rehearsal26) {
          // narrated, never sent — the fence
          journeyLog_({ candidate_id: cid, name: name, step: 'manual_contact', channel: 'sms',
                        ok: true, rehearsal: true,
                        detail: 'THE ADDER ASK (rehearsal): the text to ' + adder.name +
                                ' is narrated, never sent — a rehearsal reaches no real adder',
                        by: 'asa-hub:manual-ladder' });
          sentAny = true;
        } else {
          var rs = rpcCall_('smsSend',
            { to: '+1' + adderDigits, body: smsBody,
              reason: 'smart comms: hiring_manual_adder_ask' },
            { idempotency_key: 'man_adder_sms_' + cid + suffix });
          sentAny = sentAny || !!(rs && (rs.sent || rs.deduplicated));
          journeyLog_({ candidate_id: cid, name: name, step: 'manual_contact', channel: 'sms',
                        to: '+1' + adderDigits, ok: !!(rs && (rs.sent || rs.deduplicated)),
                        detail: 'the adder ask by text to ' + adder.name + ' (attempt ' + attempt + ')' +
                                ((rs && (rs.sent || rs.deduplicated)) ? '' : ' — not sent: ' +
                                 (str_(rs && (rs.error || rs.reason)) || 'refused')),
                        by: 'asa-hub:manual-ladder' });
        }
      }
      return sentAny;
    };

    /** The dictated end — the soft-archive, no letter. */
    var discard = function (why) {
      if (!manualSoftArchive_(cid, 'Nobody could reach them — seven tries and the person who added them could not help')) return;
      try { simAskAnswer_(['manual_contact', 'manual_adder'], 'the machine ended — discarded', cid); } catch (eA3) {}
      journeyLog_({ candidate_id: cid, name: name, step: 'manual_contact', channel: 'record',
                    ok: true, title: 'The manual machine ended — discarded',
                    detail: 'nobody could reach them — ' + why +
                            '. Soft-archived with everything the card carried; no letter ' +
                            '(the dictation archives silently here).',
                    by: 'asa-hub:manual-ladder' });
    };

    // b — the first adder ask, only after the person's asking sat quiet
    if (!adderState) {
      if (!quietPast(byCid[cid].contact, 60)) return;
      if (!adder) {
        // the stamp holds no address — there is nobody to ask (c, early)
        discard('the created_by stamp names no address to ask');
        return;
      }
      if (adderSend(1)) {
        try { simTrackSend_('manual_adder', cid, 'manualAdderSweepMaybe_', { candidate_id: cid }); } catch (eT1) {}
      }
      return;
    }

    // the adder's own re-asks — the retry pass only re-presses HUB_ACTIONS
    if (adderState === 'open' && byCid[cid].adder && adder) {
      var row = byCid[cid].adder;
      var count = parseInt(str_(row.sentcount), 10) || 0;
      var maxA = parseInt(str_(row.maxattempts), 10) || 1;
      var mins = parseInt(str_(row.intervalminutes), 10) || 720;
      var last = new Date(str_(row.lastsentat)).getTime();
      if (count >= maxA) return;                  // the retry pass says it ended
      if (!isNaN(last) && Date.now() - last < mins * 60000) return;
      if (adderSend(count + 1)) {
        try { simTrackSend_('manual_adder', cid, 'manualAdderSweepMaybe_', { candidate_id: cid }); } catch (eT2) {}
      }
      return;
    }

    // c — the adder's asking ended too, and sat quiet its full interval
    if (adderState === 'exhausted') {
      if (!quietPast(byCid[cid].adder, 720)) return;
      discard('seven tries, then the person who added them was asked twice and could not help');
    }
  });
}

/** One entry per call, ever — the SEEN-once memo the 4040 door keeps. */
var MANUAL_CALL_SEEN_PROP = 'MANUAL_CALL_SEEN';

// MOUTH #3 — THE 4040 DOOR.
HUB_POLICY.hiringWhere = {
  file: 'HiringOutreach.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
// WHERE IS THIS PERSON, WHAT IS WAITING, AND WHAT IS STOPPING IT — the testing side is simplified, while still…
HUB_ACTIONS.hiringWhere = function (payload, user) {
  if (!user || (!user.is_service && user.role !== 'admin' && user.role !== 'manager')) {
    return hubDenied_();
  }
  var cid = str_(payload && payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  var c = ev.cand;
  var stage = talentStage_(str_(c.status));
  var blocked = [], waiting = [];

  // 1 — the switch, the fence, the redirect: the three that decide whether a word can leave at all, in the order…
  var sit = { ok: true };
  try { sit = outreachAllowed_(commSituationId_('hiring.first_contact', 'hiring_first_contact')); }
  catch (eS) { sit = { ok: false, unreadable: true, reason: 'the Smart Comms situations could not be read' }; }
  if (!sit.ok) blocked.push(outreachIdleWhy_(sit, 'the Smart Comms situation "hiring_first_contact" is OFF — ' +
                            'nobody standing at New is spoken to'));
  var guard = false;
  try { guard = simOutboundGuard_(); } catch (eG) { guard = false; }
  var test = { on: false, sms: [], emails: [] };
  try { test = hubTestModeState_(); } catch (eT) { test = { on: false, sms: [], emails: [] }; }
  if (guard && !test.on) {
    blocked.push('the fence (sim_outbound_guard) is ON and test mode is OFF — only the ' +
                 'configured cast can be written to');
  }

  // 2 — the book: what was asked, how far it got, and when the clock is next up
  var asks = [];
  try {
    simAskRows_().forEach(function (r) {
      if (str_(r.candidateid) !== cid) return;
      var sent = parseInt(str_(r.sentcount), 10) || 0;
      var max = parseInt(str_(r.maxattempts), 10) || 1;
      var mins = parseInt(str_(r.intervalminutes), 10) || 30;
      var last = new Date(str_(r.lastsentat) || str_(r.createdat)).getTime();
      var due = isNaN(last) ? '' : new Date(last + mins * 60000).toISOString();
      asks.push({ step: str_(r.step), state: str_(r.state), sent: sent, of: max,
                  every_minutes: mins, last_sent_at: str_(r.lastsentat), next_due_at: due });
      if (str_(r.state) === 'open') {
        waiting.push('"' + str_(r.step) + '" is on try ' + sent + ' of ' + max +
                     ', next one due ' + (due || 'as soon as the chain passes'));
      }
    });
  } catch (eA) { blocked.push('the ask book could not be read — no machine presses blind'); }

  // 3 — who may answer for this card.
  var own = str_(c.phone).replace(/\D/g, '').replace(/^1/, '').slice(-10);
  var shared = (typeof SHARED_LINE_DIGITS !== 'undefined' &&
                SHARED_LINE_DIGITS.indexOf(own) !== -1);
  var testers = { digits: [], emails: [] };
  try { testers = simTesterKeys_(); } catch (eK) { testers = { digits: [], emails: [] }; }
  var replyFrom = (own && !shared ? [own] : []).concat(testers.digits);
  var replyMail = (str_(c.email).indexOf('@') !== -1 ? [str_(c.email).toLowerCase()] : [])
                    .concat(testers.emails);

  // 4 — the human gate for the stage they stand at
  var gate = { ok: false, reasons: [] };
  try { gate = hubGateFor_(ev, stage) || gate; } catch (eGa) {}
  (gate.reasons || []).forEach(function (r) { waiting.push('to advance: ' + str_(r)); });

  return { status: 200, data: {
    candidate: { id: cid, name: str_(c.candidatename), status: str_(c.status), stage: stage,
                 archived: str_(c.archived).toLowerCase() === 'true',
                 phone: str_(c.phone), email: str_(c.email),
                 origin: (typeof manualCardOrigin_ === 'function') ? manualCardOrigin_(c) : '' },
    // the SAME predicate the sweep uses to decide whether to speak at all
    the_ladder_may_speak: (typeof manualCardIs_ === 'function') ? manualCardIs_(c) : null,
    fences: { situation_on: !!sit.ok, outbound_guard: guard, test_mode: test.on,
              redirects_to: { sms: test.sms || [], email: test.emails || [] } },
    asks: asks,
    a_reply_counts_from: { sms: replyFrom, email: replyMail },
    gate: { can_advance: !!gate.ok, to: str_(gate.to || ''), needs: gate.reasons || [] },
    blocked_by: blocked,
    waiting_for: waiting
  } };
};

HUB_POLICY.hiringPhoneCollectAsk = {
  file: 'HiringOutreach.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' } },
  invalidates: ['candidates'], emits: ['emailSend']
};
// THE PHONE-COLLECTION LETTER, as dictated: an e-mail-only candidate at New is asked BY LETTER for a number — seven…
HUB_ACTIONS.hiringPhoneCollectAsk = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload && payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  var sit = (typeof outreachAllowed_ === 'function')
    ? outreachAllowed_(commSituationId_('hiring.phone.collect', 'hiring_phone_collect')) : { ok: true, sit: null };
  if (!sit.ok) return { status: 200, data: { sent: false, reason: 'situation_off', detail: sit.reason } };
  // the card may have moved on — or the number may already be here
  if (str_(ev.cand.archived).toLowerCase() === 'true' ||
      talentStage_(str_(ev.cand.status)) !== 'new') {
    try { simAskAnswer_(['phone_collect'], 'the card moved on — the machine lets go', cid); } catch (eG) {}
    return { status: 200, data: { sent: false, reason: 'card_moved_on' } };
  }
  if (str_(ev.cand.phone)) {
    try { simAskAnswer_(['phone_collect'], 'a phone is already on the card', cid); } catch (eG2) {}
    return { status: 200, data: { sent: false, reason: 'phone_present' } };
  }
  var email = str_(ev.cand.email);
  if (email.indexOf('@') === -1) return { status: 200, data: { sent: false, reason: 'no_email' } };
  var name = str_(ev.cand.candidatename);
  var first = hiringGreetFirst_(name);
  var fill = function (t) {
    return String(t || '').split('{first_name}').join(first).split('{name}').join(name);
  };
  var subject = fill(str_(sit.sit && sit.sit.email_subject) ||
    bookText_('Strings', 'phone_collect.subject.floor', ''));
  var bodyText = fill(str_(sit.sit && sit.sit.email_text) ||
    bookText_('Strings', 'phone_collect.body.floor', '').split('{first}').join(first));
  var html = mailShell_({
    eyebrow: 'ASA LifeCare',
    title: bookText_('Strings', 'phone_collect.title', ''),
    preheader: bookText_('Strings', 'phone_collect.preheader', ''),
    blocks: bodyText.split(/\n{2,}/).map(function (pg) {
      return mailPara_(mailEsc_(pg).replace(/\n/g, '<br>'));
    }),
    cta: null, footnote: bookText_('Strings', 'phone_collect.footnote', '')
  });
  var res = outreachSend_({
    candidate_id: cid, name: name, step: 'phone_collect', to: email,
    cc: (typeof simCcFor_ === 'function') ? simCcFor_(email) : '',
    letter: { subject: subject, text: bodyText, html: html },
    reason: 'hiring: collecting a phone number by letter', by: str_(user && user.email)
  });
  if (res && res.sent) {
    try { simTrackSend_('phone_collect', cid, 'hiringPhoneCollectAsk', { candidate_id: cid }); } catch (eT) {}
  }
  return { status: 200, data: { sent: !!(res && res.sent) } };
};

HUB_POLICY.hiringPhoneConfirmSend = {
  file: 'HiringOutreach.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' } },
  invalidates: ['candidates'], emits: ['smsSend']
};
// THE CONFIRMATION TEXT, as dictated: the number that arrived by letter is texted — "reply YES to confirm you…
HUB_ACTIONS.hiringPhoneConfirmSend = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload && payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  var sit = (typeof outreachAllowed_ === 'function')
    ? outreachAllowed_(commSituationId_('hiring.phone.confirm', 'hiring_phone_confirm')) : { ok: true, sit: null };
  if (!sit.ok) return { status: 200, data: { sent: false, reason: 'situation_off', detail: sit.reason } };
  if (str_(ev.cand.archived).toLowerCase() === 'true' ||
      talentStage_(str_(ev.cand.status)) !== 'new') {
    try { simAskAnswer_(['phone_confirm'], 'the card moved on — the machine lets go', cid); } catch (eG) {}
    return { status: 200, data: { sent: false, reason: 'card_moved_on' } };
  }
  if (!str_(ev.cand.phone)) return { status: 200, data: { sent: false, reason: 'no_phone' } };
  var name = str_(ev.cand.candidatename);
  var first = hiringGreetFirst_(name);
  var body = String(str_(sit.sit && sit.sit.sms_text) ||
    bookText_('Strings', 'phone_confirm.sms.floor', ''))
    .split('{first_name}').join(first).split('{name}').join(name);
  var res = outreachSms_({
    candidate_id: cid, name: name, step: 'phone_confirm',
    to: str_(ev.cand.phone), body: body,
    intro: (typeof simQuoIntro_ === 'function') ? simQuoIntro_(bookText_('Strings', 'purpose.phone_confirm', '')) : '',
    reason: 'hiring: confirming the collected phone number', by: str_(user && user.email)
  });
  if (res && res.sent) {
    try { simTrackSend_('phone_confirm', cid, 'hiringPhoneConfirmSend', { candidate_id: cid }); } catch (eT) {}
  }
  return { status: 200, data: { sent: !!(res && res.sent) } };
};

HUB_POLICY.manualResumeAsk = {
  file: 'HiringOutreach.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' } },
  invalidates: ['candidates'], emits: ['emailSend', 'smsSend']
};
// THE RÉSUMÉ ASK, AS A RUNG INSTEAD OF A SHOUT — rungs 2 and 3 are corrected here.
HUB_ACTIONS.manualResumeAsk = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload && payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  // THE CARD MAY HAVE MOVED ON since the ask was booked — the retry pass presses blind, so the door re-checks and…
  if (str_(ev.cand.archived).toLowerCase() === 'true' ||
      talentStage_(str_(ev.cand.status)) !== 'new') {
    try { simAskAnswer_(['manual_resume'], 'the card moved on — the machine lets go', cid); } catch (eG) {}
    return { status: 200, data: { sent: false, reason: 'card_moved_on' } };
  }
  var res = manualResumeAskRun_(cid, str_(ev.cand.candidatename), ev.cand);
  if (res.have) {
    // IT ARRIVED — the ask is over, whoever it was waiting on.
    try { simAskAnswer_(['manual_resume'], 'the resume is on the card', cid); } catch (eA) {}
    return { status: 200, data: { sent: false, reason: 'resume_present', note: res.note } };
  }
  if (res.sent) {
    try { simTrackSend_('manual_resume', cid, 'manualResumeAsk', { candidate_id: cid }); } catch (eT) {}
  }
  return { status: 200, data: { sent: res.sent, note: res.note } };
};

// The folders, then the two legs.
function manualResumeAskRun_(cid, name, cand) {
  var actor = { role: 'manager', email: 'manual-ladder@service.local' };
  // the folders first — the scan LISTS (it writes nothing), so the match is read off its answer and attached…
  var have = str_(cand && cand.resumelink);
  if (!have && typeof resumeInboxKey_ === 'function') {
    try {
      var scan = HUB_ACTIONS.resumeInboxScan({}, actor);
      var sd = (scan && scan.data) || {};
      var myKey = resumeInboxKey_(name.replace(/^\s*\[test\]\s*/i, ''));
      var hitLink = '';
      [].concat(sd.fresh || [], sd.alreadyKnown || [], sd.readBefore || []).forEach(function (p) {
        if (!hitLink && myKey && resumeInboxKey_(str_(p.name)) === myKey && p.fileId) {
          hitLink = 'https://drive.google.com/file/d/' + p.fileId + '/view';
        }
      });
      if (hitLink) {
        var att = HUB_ACTIONS.resumeAttach({ candidate_id: cid, resume_link: hitLink }, actor);
        if (att && att.status === 200) have = hitLink;
      }
    } catch (eScan) { /* still missing — the ask below names it */ }
  }
  if (have) {
    return { have: true, sent: false,
             note: 'the resume was already in the folders — collected, nobody asked' };
  }
  // A Smart Comms situation (hiring_manual_resume_ask): off, nobody is asked and no rung is spent.
  var resSit = hubLaneSituation_('hiring_manual_resume_ask');
  if (!resSit.on) return { have: false, sent: false, note: resSit.why };
  {
    var first = hiringGreetFirst_(name);
    var resVars = { name: name, first_name: first };
    // THE RETURN LAW: things reach us BY E-MAIL or land in the two special folders — a text is a nudge, never the…
    var smsBody = resSit.word('sms_text', ((typeof simText_ === 'function') ? simText_('manual_resume_sms', '') : '')
        .replace(/\{first_name\}/g, first).replace(/\{name\}/g, name) ||
      ('Great to hear from you, ' + first + '! The next step is your resume — please ' +
       'e-mail it to asa-hub@asaop.org (replying to our letter works) and we take it from there.'), resVars);
    var rs = !resSit.leg('sms') ? null : outreachSms_({
      candidate_id: cid, name: name, step: 'manual_contact',
      to: str_(cand && cand.phone), body: smsBody,
      intro: (typeof simQuoIntro_ === 'function') ? simQuoIntro_(bookText_('Strings', 'purpose.manual_resume', '')) : '',
      reason: 'smart comms: hiring_manual_resume_ask', by: 'asa-hub:manual-ladder'
    });
    // FILLED, never raw: the shipped resume_request cells carry {first_name} and {referrer} — a manual card has no…
    var mSub = (((typeof simText_ === 'function') ? simText_('resume_request_subject', '') : '') || '')
      .replace(/^REFERRAL\s*[-—]\s*/i, '')
      .replace(/\{first_name\}/g, first).replace(/\{name\}/g, name)
      .replace(/\{referrer\}/g, bookText_('Strings', 'manual_resume.referrer.floor', ''));
    var mBody = (((typeof simText_ === 'function') ? simText_('resume_request_body', '') : '') || '')
      .replace(/\{first_name\}/g, first).replace(/\{name\}/g, name)
      .replace(/\{referrer\}/g, bookText_('Strings', 'manual_resume.referrer.floor', ''));
    var letter = hiringResumeRequestEmail_({
      name: name, first_name: first,
      referrer: bookText_('Strings', 'manual_resume.referrer.floor', ''),
      subject: resSit.word('email_subject', mSub || bookText_('Strings', 'manual_resume.subject.floor', ''), resVars),
      bodyText: resSit.word('email_text', mBody, resVars)
    });
    var rm = !resSit.leg('email') ? null : outreachSend_({
      step: 'manual_contact', to: str_(cand && cand.email), letter: letter,
      reason: 'smart comms: hiring_manual_resume_ask', by: 'asa-hub:manual-ladder'
    });
    return {
      have: false,
      // A leg that was refused is not a rung: with both refused nothing was asked, and burning an attempt on it…
      sent: !!((rs && rs.sent) || (rm && rm.sent)),
      note: 'the resume asked by text' + ((rs && rs.sent) ? '' : ' (text refused)') +
            ' and by letter' + ((rm && rm.sent) ? '' : ' (letter refused)')
    };
  }
}

function manualNextStepAsks_(cid, name, cand) {
  var actor = { role: 'manager', email: 'manual-ladder@service.local' };
  var notes = [];
 // The résumé, through the door the retry pass can press again.
  try {
    var rr = HUB_ACTIONS.manualResumeAsk({ candidate_id: cid }, actor);
    notes.push(str_((rr && rr.data && rr.data.note)) || 'the resume ask did not run');
  } catch (eR) { notes.push('the resume ask did not run — the retry rung re-asks'); }
  // the CJIS — Arthur's own folder-first ask; no_auto keeps the press cheap
  try {
    var cj = HUB_ACTIONS.hiringCjisRequestSend({ candidate_id: cid, no_auto: true }, actor);
    var d = (cj && cj.data) || {};
    notes.push('CJIS: ' + (str_(d.state) || (d.sent ? 'asked from Arthur' : str_(d.reason)) || 'asked'));
  } catch (eC) { notes.push('the CJIS ask did not run — the recheck rung retries'); }
  journeyLog_({ candidate_id: cid, name: name, step: 'manual_contact', channel: 'record',
                ok: true, title: 'The next step fires — resume and CJIS',
                detail: notes.join(' · '), by: 'asa-hub:manual-ladder' });
}

function manualCallDoorRun_() {
  var asks;
  try {
    asks = simAskRows_().filter(function (r) {
      var st = str_(r.state), sp = str_(r.step);
      // ANSWERING US MUST NOT CLOSE THE DOOR.
      return (st === 'open' || st === 'exhausted' || st === 'answered') &&
             (sp === 'manual_contact' || sp === 'manual_adder' || sp === 'manual_resume');
    });
  } catch (e) { return; }
  if (!asks.length) return;
  var cids = {};
  asks.forEach(function (r) { if (str_(r.candidateid)) cids[str_(r.candidateid)] = true; });

  var props = PropertiesService.getScriptProperties();
  var seen = {};
  try { seen = JSON.parse(str_(props.getProperty(MANUAL_CALL_SEEN_PROP)) || '{}'); } catch (eS) { seen = {}; }

  var trans;
  try { trans = readTabNormalized_(ssOpen_(hubId_('HUB_COMMS_ID')), 'transcripts'); }
  catch (eT) { return; }

  Object.keys(cids).forEach(function (cid) {
    var ev;
    try { ev = hubEvidence_(cid); } catch (eE) { return; }
    if (!ev || !ev.cand) return;
    if (str_(ev.cand.archived).toLowerCase() === 'true') return;
 // THE STAGE IS THE SAFETY.
    if (talentStage_(str_(ev.cand.status)) !== 'new') return;
    var name = str_(ev.cand.candidatename);
    var digits = str_(ev.cand.phone).replace(/\D/g, '').replace(/^1/, '').slice(-10);
    // a shared company line identifies nobody — never a door key
    var ownKey = (digits.length === 10 &&
                  !(typeof SHARED_LINE_DIGITS !== 'undefined' &&
                    SHARED_LINE_DIGITS.indexOf(digits) !== -1)) ? digits : '';
    // …and while the redirect is live, the tester's line is a door key too: they are who the ask was actually…
    var doorTesters = (typeof simTesterKeys_ === 'function') ? simTesterKeys_() : { digits: [] };
    var doorKeys = (ownKey ? [ownKey] : []).concat(doorTesters.digits || []);
    if (!doorKeys.length) return;

    var newest = null;
    trans.forEach(function (t) {
      if (!commsIsScreenLine_(String(t.quonumber || '').replace(/\D/g, '').slice(-10))) return;
      var callId = str_(t.callid);
      if (!callId || seen[callId]) return;
      var parts = String(t.participants || '').replace(/\D/g, '');
      var hitKey = false;
      for (var dk = 0; dk < doorKeys.length; dk++) {
        if (parts.indexOf(doorKeys[dk]) !== -1) { hitKey = true; break; }
      }
      if (!hitKey) return;
      var at = str_(t.transcriptcreated) || str_(t.receivedat);
      if (!newest || at > newest.at) newest = { at: at, id: callId, row: t };
    });
    if (!newest) return;                          // no call yet — the asks keep working
    var text = str_(newest.row.speakertranscript) || str_(newest.row.fulltranscript);
    if (!text) return;
    // a cut or hung-up call is not an entry — they can simply call again
    if (!hubCallComplete_(str_(newest.row.fulltranscript) || text)) return;
    if (!commsScreenUsable_(newest.row.durationsec, text).ok) return;

    // THE CONTRACT ORDER — the phone-tab row FIRST … and ONCE per call: a pass that appended but failed the move…
    var haveRow = false;
    try {
      readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_PHONE_TAB).forEach(function (p) {
        if (str_(p.transcriptcallid) === newest.id && str_(p.candidateid) === cid) haveRow = true;
      });
    } catch (eHv) { haveRow = false; }
    try {
      if (!haveRow) {
        ensureHeader_(hubSheet_(TALENT_PHONE_TAB),
          ['candidate_id', 'screen_status', 'screen_date', 'screened_by',
           'transcript_text', 'transcript_call_id', 'transcript_created', 'transcript_pulled_at']);
        hubAppendRow_(TALENT_PHONE_TAB, {
          candidate_id: cid,
          screen_status: 'Completed',
          screen_date: str_(newest.row.transcriptcreated),
          screened_by: 'asa-hub:manual-ladder',
          transcript_text: (typeof commsCap_ === 'function') ? commsCap_(text) : text,
          transcript_call_id: newest.id,
          transcript_created: str_(newest.row.transcriptcreated),
          transcript_pulled_at: new Date().toISOString(),
          phone_screen_id: 'PS_' + randomHex_(16).toUpperCase()
        });
      }
    } catch (eW) {
      hubSysLog_('asa-hub:manual-ladder', 'manual_call_row_failed',
                 cid + ' — ' + String((eW && eW.message) || eW), { status: 500 });
      return;                                     // no row, no move — the next pass retries
    }
    // … THEN the status; a failed move settles NOTHING and spends NOTHING — the row above is once-per-call, so the…
    var moved = true;
    try { hubSetStatus_(cid, HUB_STAGE_TO_STATUS['phone-screen'], { email: 'manual-ladder' }); }
    catch (eM) {
      moved = false;
      hubSysLog_('asa-hub:manual-ladder', 'manual_call_move_failed',
                 cid + ' — ' + String((eM && eM.message) || eM), { status: 500 });
    }
    if (!moved) return;
    try { simAskAnswer_(['manual_contact', 'manual_adder'], 'they called the screen line (' + newest.id + ')', cid); } catch (eA) {}
    var actors = (typeof hiringSimActors_ === 'function') ? hiringSimActors_() : null;
    var line = (actors && actors.screen_line) || '';
    var lineLabel = line.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') || line || 'the screen line';
    journeyLog_({ candidate_id: cid, name: name, step: 'manual_contact', channel: 'record',
                  ok: true, title: 'They called the screen line',
                  detail: 'they called the ' + lineLabel + ' (' + newest.id + ') — entered by ' +
                          'the phone screening door; the screen machinery takes it from here',
                  by: 'asa-hub:manual-ladder' });
    // SITUATION 10 rides the entry: the resume (folders first) + the CJIS
    try { manualNextStepAsks_(cid, name, ev.cand); } catch (eNx2) {}
    // stamp first, memo after — the entry landed, so the call is spent
    seen[newest.id] = new Date().toISOString();
    try { props.setProperty(MANUAL_CALL_SEEN_PROP, JSON.stringify(seen)); } catch (eP) {}
    try { if (typeof hubBustTalentCache_ === 'function') hubBustTalentCache_(); } catch (eB) {}
  });
}

// ------------------------------------------------------------------ THE DIRECTOR FAST LANE'S COLLECTOR…

// A DIRECTOR CARD entered at Onboarding through the EXISTING intake fast lane — Add Candidate, source Referral…
function directorDocsSweepMaybe_() {
  // service reads only + the throttle — the hiringSimSweepMaybe_ idiom
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('director_docs_sweep')) return;
  cache.put('director_docs_sweep', '1', 900);

  // the director cards — fast-laned, standing at onboarding, on the board
  var rows;
  try { rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB); }
  catch (e) { return; }
  var byId = {};
  rows.forEach(function (c) {
    var cid = str_(c.candidateid);
    if (cid) byId[cid] = c;                       // last row wins
  });
  var cards = [];
  Object.keys(byId).forEach(function (cid) {
    var c = byId[cid];
    if (typeof TALENT_EXCLUDE_IDS !== 'undefined' && TALENT_EXCLUDE_IDS.indexOf(cid) !== -1) return;
    if (str_(c.archived).toLowerCase() === 'true') return;
    // fast_lane_at holds the INSERTED STAGE — a director's card is the one fast-laned straight INTO onboarding, not…
    if (str_(c.fastlaneat) !== 'onboarding') return;
    if (talentStage_(c.status) !== 'onboarding') return;
    cards.push(c);
  });
  if (!cards.length) return;

  // the analyses, one read — the CJIS truth lives on these rows.
  var analyses = {};
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_RESUME_TAB).forEach(function (a) {
      var aid = str_(a.candidateid);
      if (aid) analyses[aid] = a;                 // last row wins
    });
  } catch (eAn) { return; }

  // the folders first — ONE press for the whole pass, only while needed
  var actor = { role: 'manager', email: 'director-docs-sweep@service.local', id: 'SVC_HIRING_SIM' };
  var scanHit = {};                               // name key → drive link
  var needResume = cards.some(function (c) { return !str_(c.resumelink); });
  if (needResume && typeof resumeInboxKey_ === 'function') {
    try {
      var scan = HUB_ACTIONS.resumeInboxScan({}, actor);
      var d = (scan && scan.data) || {};
      // every bucket the scan answers with — a director card's person is usually alreadyKnown (they are on the…
      [].concat(d.fresh || [], d.alreadyKnown || [], d.readBefore || []).forEach(function (p) {
        var k = resumeInboxKey_(str_(p.name));
        if (k && p.fileId && !scanHit[k]) {
          scanHit[k] = 'https://drive.google.com/file/d/' + p.fileId + '/view';
        }
      });
    } catch (eScan) { /* an unreadable folder never blocks the ask below */ }
  }

  // the ask book, one read — the LIVE row per card (last row wins)
  var book = {};
  try {
    simAskRows_().forEach(function (r) {
      if (str_(r.step) !== 'director_docs') return;
      var bCid = str_(r.candidateid);
      if (bCid) book[bCid] = r;
    });
  } catch (eBk) { book = {}; }

  // the cast, resolved once for the pass
  var team = (typeof hiringTeamRecipients_ === 'function') ? hiringTeamRecipients_() : { emails: [] };
  var actors = (typeof hiringSimActors_ === 'function') ? hiringSimActors_() : null;
  var deciderSms = (actors && actors.decider_sms) ? actors.decider_sms : [];

  cards.forEach(function (c) {
    var cid = str_(c.candidateid);
    var name = str_(c.candidatename) || cid;

    // the folder's resume, attached BEFORE anybody is asked (fill-blank)
    var haveResume = !!str_(c.resumelink);
    if (!haveResume) {
      var key = '';
      try {
        key = (typeof resumeInboxKey_ === 'function')
          ? resumeInboxKey_(name.replace(/^\s*\[test\]\s*/i, '')) : '';
      } catch (eK) { key = ''; }
      if (key && scanHit[key]) {
        try {
          var att = HUB_ACTIONS.resumeAttach({ candidate_id: cid, resume_link: scanHit[key] }, actor);
          if (att && att.status === 200) {
            haveResume = true;
            journeyLog_({ candidate_id: cid, name: name, step: 'director_docs', channel: 'drive',
                          ok: true, title: 'The resume came out of the folders',
                          detail: 'the special folders held ' + name + '\'s resume — attached to the ' +
                                  'card (fill-blank); nobody had to be asked for it',
                          by: 'asa-hub:director-docs' });
          }
        } catch (eAt) { /* still missing — the ask below names it */ }
      }
    }

    // the CJIS — the SAME truth the ch.21 mint gate reads (Hired.gs)
    var a = analyses[cid] || {};
    var haveCjis = hubCjisCleared_(a) || !!str_(a.cjisreporturl);

    // both pieces stand → the ask closes; the mint sweep takes it from here
    if (haveResume && haveCjis) {
      var closed = 0;
      try { closed = simAskAnswer_(['director_docs'], 'collected', cid); } catch (eC) { closed = 0; }
      if (closed) {
        journeyLog_({ candidate_id: cid, name: name, step: 'director_docs', channel: 'record',
                      ok: true, title: 'Both pieces stand',
                      detail: 'collected from the folders — the onboarding mint gate has what it needs',
                      by: 'asa-hub:director-docs' });
      }
      return;
    }

    var missing = (!haveResume && !haveCjis) ? 'the resume and the CJIS report'
                : (!haveResume ? 'the resume' : 'the CJIS report');

    // THE REHEARSAL FENCE — the ready_ask sweep's addressing, the relay's narrated text leg: a [TEST] card pages…
    var rehearsal = (typeof commsIsTestCandidate_ === 'function') && commsIsTestCandidate_(c);
    var addr = (rehearsal && typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
    var to = (addr && addr.to) || team.emails.join(', ');

    var fill = function (s) {
      return String(s || '').replace(/\{name\}/g, name).replace(/\{missing\}/g, missing);
    };

    // One director-docs round — the letter to Arthur and Ty, the Quo texts to the deciders.
    var askSend = function (attempt) {
      // A Smart Comms situation (hiring_director_docs_missing): off, nothing leaves and nothing is booked.
      var docsSit = hubLaneSituation_('hiring_director_docs_missing');
      if (!docsSit.on) return false;
      var docsVars = { name: name, missing: missing };
      var suffix = attempt > 1 ? '_a' + attempt : '';
      var sentAny = false;
      var subject = docsSit.word('email_subject',
        fill((typeof simText_ === 'function') ? simText_('director_docs_subject', '') : '') ||
        fill(bookText_('Strings', 'director_docs.subject.floor', '')), docsVars);
      var bodyText = docsSit.word('email_text',
        fill((typeof simText_ === 'function') ? simText_('director_docs_body', '') : '') ||
        fill(bookText_('Strings', 'director_docs.body.floor', '')), docsVars);
      var link = mailPlatformUrl_() + '/app/hiring/candidate?id=' + cid;
      var html = mailShell_({
        eyebrow: 'ASA Hub — Hiring',
        title: fill(bookText_('Strings', 'director_docs.title', '')),
        preheader: bookText_('Strings', 'director_docs.preheader', ''),
        blocks: [
          mailFact_(bookText_('Strings', 'notice.fact.candidate', ''), name, false),
          mailFact_(bookText_('Strings', 'director_docs.fact.missing_label', ''), missing, false)
        ].concat(bodyText.split(/\n{2,}/).map(function (p2) {
          return mailPara_(mailEsc_(p2).replace(/\n/g, '<br>'));
        })),
        cta: { label: bookText_('Strings', 'notice.cta.open_candidate', ''), href: link },
        footnote: bookText_('Strings', 'director_docs.footnote', '')
      });
      var subjOut = (rehearsal && typeof simTagSubject_ === 'function') ? simTagSubject_(subject) : subject;
      if (to && docsSit.leg('email')) {
        try {
          var rm = rpcCall_('emailSend', { to: to, cc: (addr && addr.cc) || '', subject: subjOut,
            body: bodyText, html: html,
            reason: 'smart comms: hiring_director_docs_missing'
          }, { idempotency_key: 'director_docs_mail_' + cid + suffix });
          sentAny = sentAny || !!(rm && (rm.sent || rm.deduplicated));
          journeyLog_({ candidate_id: cid, name: name, step: 'director_docs', channel: 'email',
                        to: to, ok: !!(rm && (rm.sent || rm.deduplicated)), rehearsal: rehearsal,
                        title: 'Arthur and Ty are asked for the pieces',
                        detail: 'the director card is missing ' + missing + ' — asked by letter, ' +
                                'both return paths named (attempt ' + attempt + ')' +
                                (rehearsal ? ' (rehearsal — redirected to the actor mailbox)' : '') +
                                ((rm && (rm.sent || rm.deduplicated)) ? '' : ' — not sent: ' +
                                 (str_(rm && (rm.error || rm.reason)) || 'refused')),
                        by: 'asa-hub:director-docs' });
        } catch (eM) { /* the Quo half below still tries */ }
      }
      var smsBody = docsSit.word('sms_text',
        fill((typeof simText_ === 'function') ? simText_('director_docs_sms', '') : '') ||
        ('ASA LifeCare hiring — ' + name + ' entered onboarding on the director fast lane and ' +
         'we are missing ' + missing + '. Reply to the e-mail with the file(s), or drop them ' +
         'in the special folder — the folder is instant.'), docsVars);
      if (!docsSit.leg('sms')) {
        /* the row names no text: no Quo leg, narrated or sent */
      } else if (rehearsal) {
        // narrated, never sent — the fence
        journeyLog_({ candidate_id: cid, name: name, step: 'director_docs', channel: 'sms',
                      ok: true, rehearsal: true,
                      detail: 'THE DIRECTOR ASK (rehearsal): the Quo texts to the deciders are ' +
                              'narrated, never sent — a rehearsal pages nobody',
                      by: 'asa-hub:director-docs' });
        sentAny = true;
      } else {
        deciderSms.forEach(function (n) {
          try {
            var rs = rpcCall_('smsSend', { to: n, body: smsBody,
              reason: 'smart comms: hiring_director_docs_missing'
            }, { idempotency_key: 'director_docs_sms_' + cid + '_' + String(n).replace(/\D/g, '') + suffix });
            if (rs && (rs.sent || rs.deduplicated)) sentAny = true;
          } catch (eS) { /* next number */ }
        });
      }
      return sentAny;
    };

    var row = book[cid] || null;
    var state = row ? str_(row.state) : '';

    // the first ask — the FIRST send books it, once ever per card
    if (!state) {
      if (askSend(1)) {
        try { simTrackSend_('director_docs', cid, 'directorDocsSweepMaybe_', { candidate_id: cid }); } catch (eT) {}
      }
      return;
    }

    // the re-asks live HERE — the retry pass only re-presses HUB_ACTIONS
    if (state === 'open') {
      var count = parseInt(str_(row.sentcount), 10) || 0;
      var maxA = parseInt(str_(row.maxattempts), 10) || 1;
      var mins = parseInt(str_(row.intervalminutes), 10) || 720;
      var last = new Date(str_(row.lastsentat)).getTime();
      if (count >= maxA) return;                  // the retry pass says it ended
      if (!isNaN(last) && Date.now() - last < mins * 60000) return;
      if (askSend(count + 1)) {
        try { simTrackSend_('director_docs', cid, 'directorDocsSweepMaybe_', { candidate_id: cid }); } catch (eT2) {}
      }
      return;
    }
    // exhausted or answered: the asking ended — the folder watch above keeps looking every pass, and a late file…
  });
}

// ------------------------------------------------------------------ UNREACHABLE — seven tries, then the archive…

// SEVEN TRIES AND NOTHING BACK: after seven attempts on the phone and/or the e-mail the card moves to the archive…
var SCREEN_CALL_PER_PASS = 5;

function screenCallSweepMaybe_() {
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('screen_call_sweep')) return;
  cache.put('screen_call_sweep', '1', 900);

  var sit = (typeof outreachAllowed_ === 'function')
    ? outreachAllowed_(commSituationId_('hiring.screen.invitation', 'hiring_screen_call')) : { ok: true };
  if (!sit.ok) {
    if (typeof tpSweepIdle_ === 'function') {
      tpSweepIdle_('screen-call', outreachIdleWhy_(sit, 'hiring_screen_call is OFF in Smart Comms — nobody standing ' +
                   'at Phone Screen is told to call the line, and nothing ages them out'));
    }
    return;
  }

  // Never press blind: an unreadable book would re-ask everybody from rung one.
  var booked = {};
  try {
    simAskRows_().forEach(function (r) {
      if (str_(r.step) !== 'screen_call') return;
      var c = str_(r.candidateid);
      if (c) booked[c] = true;                    // any state — asked is asked
    });
  } catch (eB) { return; }

  var db;
  try { db = ssOpen_(hubId_('HUB_DB_ID')); } catch (eD) { return; }
  // Somebody who already has a screen on the record is not waiting to call.
  var screened = {};
  try {
    readTabNormalized_(db, 'entity_phone_screens').forEach(function (r) {
      var c = str_(r.candidateid);
      if (c) screened[c] = true;
    });
  } catch (eS) { return; }                        // unreadable ⇒ ask nobody

  var actor = { role: 'manager', email: 'screen-call-sweep@service.local', id: 'SVC_SCREEN_CALL' };
  var pressed = 0, names = [];
  try {
    readTabNormalized_(db, TALENT_CANDIDATES_TAB).forEach(function (c) {
      if (pressed >= SCREEN_CALL_PER_PASS) return;
      if (str_(c.archived).toLowerCase() === 'true') return;
      if (talentStage_(str_(c.status)) !== 'phone-screen') return;
      var cid = str_(c.candidateid);
      if (!cid || booked[cid] || screened[cid]) return;
      if (!str_(c.phone) && !str_(c.email)) return;   // nothing to write to
      booked[cid] = true;                            // one press per pass
      try {
        var r = HUB_ACTIONS.hiringScreenCallSend({ candidate_id: cid }, actor);
        var d = (r && r.data) || {};
 // 200 is not 'sent' — the lesson.
        if (!d.sent) {
          hubSysLog_('asa-hub:screen-call', 'screen_call_refused',
                     cid + ' — ' + str_(d.reason || 'nothing went out'), { status: 200 });
          return;
        }
        pressed++;
        names.push(str_(c.candidatename) || cid);
      } catch (eP) {
        hubSysLog_('asa-hub:screen-call', 'screen_call_press_failed',
                   cid + ' — ' + String((eP && eP.message) || eP), { status: 500 });
      }
    });
  } catch (eC) { return; }

  if (pressed) {
    hubSysLog_('asa-hub:screen-call', 'screen_call_asked',
               pressed + ' card(s) at Phone Screen were asked to call the line: ' +
               names.join(', ').slice(0, 300), { status: 200 });
  } else if (typeof tpSweepIdle_ === 'function') {
    tpSweepIdle_('screen-call', 'nobody at Phone Screen is waiting to be asked — each one ' +
                 'already has a screen on the record, or is already in the ask book');
  }
}

var TEST_CARD_PER_PASS = 5;

function testCardArchiveMaybe_() {
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('test_card_archive')) return;
  cache.put('test_card_archive', '1', 900);

  var days = parseInt(simCfgVal_('sim_archive_test_days'), 10);
  if (isNaN(days) || days <= 0) {
    if (typeof tpSweepIdle_ === 'function') {
      tpSweepIdle_('test-cards', 'sim_archive_test_days is 0 — rehearsal cards stay on the ' +
                   'board, and a rehearsal standing at New counts against the floor');
    }
    return;
  }
  var cutoff = Date.now() - days * 86400000;

  var db;
  try { db = ssOpen_(hubId_('HUB_DB_ID')); } catch (eD) { return; }
  var rows;
  try { rows = readTabNormalized_(db, TALENT_CANDIDATES_TAB); } catch (eR) { return; }

  var done = 0, names = [];
  for (var i = 0; i < rows.length && done < TEST_CARD_PER_PASS; i++) {
    var c = rows[i];
    if (str_(c.archived).toLowerCase() === 'true') continue;
    if (typeof commsIsTestCandidate_ !== 'function' || !commsIsTestCandidate_(c)) continue;
    // The last TOUCH, not the birth: a rehearsal being walked right now is not old news, whatever day its card was…
    var when = new Date(str_(c.updatedat) || str_(c.createdat)).getTime();
    if (isNaN(when) || when > cutoff) continue;

    var cid = str_(c.candidateid);
    var name = str_(c.candidatename) || cid;
    try {
      ensureHeader_(hubSheet_(TALENT_CANDIDATES_TAB),
                    ['archived', 'archived_at', 'archived_by', 'archived_reason']);
      hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, {
        archived: 'true', archived_at: new Date().toISOString(),
        archived_by: 'asa-hub:test-cards',
        archived_reason: 'a rehearsal card, untouched for ' + days + ' day(s) — archived so ' +
                         'it stops counting against the release floor. Nothing was deleted.'
      }, { email: 'asa-hub:test-cards' }, false);
      try { if (typeof hubBustTalentCache_ === 'function') hubBustTalentCache_(); } catch (eB) {}
      done++;
      names.push(name);
    } catch (eW) {
      hubSysLog_('asa-hub:test-cards', 'test_card_archive_failed',
                 cid + ' — ' + String((eW && eW.message) || eW), { status: 500 });
    }
  }

  if (done) {
    hubSysLog_('asa-hub:test-cards', 'test_cards_archived',
               done + ' rehearsal card(s) archived after ' + days + ' quiet day(s): ' +
               names.join(', ').slice(0, 300), { status: 200 });
  } else if (typeof tpSweepIdle_ === 'function') {
    tpSweepIdle_('test-cards', 'no rehearsal card has been sitting still for ' + days + ' day(s)');
  }
}

var UNREACHABLE_PER_PASS = 5;

// WHAT THEIR OWN ASK ACTUALLY DID, in words, for the archive reason.
function unreachableTriesSaid_(ask) {
  var n = parseInt(str_(ask && ask.sentcount), 10) || 0;
  if (!n) return 'every configured try';
  var mins = parseInt(str_(ask && ask.intervalminutes), 10) || 0;
  var hours = Math.round((n * mins) / 60);
  return n + ' time(s)' + (hours ? ' over ' + hours + 'h' : '');
}

function unreachableArchiveSweepMaybe_() {
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('unreachable_sweep')) return;
  cache.put('unreachable_sweep', '1', 900);

  var sit = (typeof smartSituationOn_ === 'function')
    ? smartSituationOn_(commSituationId_('hiring.unreachable_archived', 'hiring_unreachable_archived')) : null;
  if (!sit) {
    // THE SWITCH IS THE SITUATION ROW, and a pass that does nothing says so — silence is how the whole hiring lane…
    if (typeof tpSweepIdle_ === 'function') {
      tpSweepIdle_('unreachable',
                   'hiring_unreachable_archived is OFF — nobody is archived for never ' +
                   'answering, and the queue stays blocked behind them');
    }
    return;
  }

  var db;
  try { db = ssOpen_(hubId_('HUB_DB_ID')); } catch (eD) { return; }

  // The outreach asks that ran out of tries.
  var TRIED_STEPS = ['outreach', 'manual_contact'];
  var spent = {};
  try {
    simAskRows_().forEach(function (r) {
      if (TRIED_STEPS.indexOf(str_(r.step)) === -1) return;
      if (str_(r.state) !== 'exhausted') return;
      // THE ROW IS THE RECORD, NOT THE CELL.
      spent[str_(r.candidateid)] = r;
    });
  } catch (eA) { return; }
  var cids = Object.keys(spent);
  if (!cids.length) {
    if (typeof tpSweepIdle_ === 'function') {
      tpSweepIdle_('unreachable', 'nobody has run out of outreach tries');
    }
    return;
  }

  var cards = {};
  try {
    readTabNormalized_(db, TALENT_CANDIDATES_TAB).forEach(function (r) {
      cards[str_(r.candidateid)] = r;
    });
  } catch (eC) { return; }

  var done = 0, names = [];
  for (var i = 0; i < cids.length && done < UNREACHABLE_PER_PASS; i++) {
    var cid = cids[i];
    var cand = cards[cid];
    if (!cand) continue;
    // ONLY SOMEBODY STILL STANDING WHERE THE SILENCE MATTERS.
    if (str_(cand.archived).toLowerCase() === 'true') continue;
    if (talentStage_(str_(cand.status)) !== 'new') continue;

    var name = str_(cand.candidatename);
    var when = new Date().toISOString();
    // Their OWN ask's history — the two ladders run on different clocks, so this is per candidate and never a…
    var said = unreachableTriesSaid_(spent[cid]);
    var reason = 'nobody could reach them — ' + said +
                 ' on every contact we hold, no answer';

    // 1 — the archive.
    try {
      ensureHeader_(hubSheet_(TALENT_CANDIDATES_TAB),
                    ['archived', 'archived_at', 'archived_by', 'archived_reason']);
      hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, {
        archived: 'true', archived_at: when,
        archived_by: 'asa-hub:unreachable', archived_reason: reason
      }, { email: 'asa-hub:unreachable' }, false);
      try { if (typeof hubBustTalentCache_ === 'function') hubBustTalentCache_(); } catch (eB) {}
    } catch (eW) {
      hubSysLog_('asa-hub:unreachable', 'unreachable_archive_failed',
                 cid + ' — ' + String((eW && eW.message) || eW), { status: 500 });
      continue;
    }

    // 2 — the telling.
    var vars = { name: name || cid, candidate: name || cid, tries: said,
                 phone: str_(cand.phone), email: str_(cand.email) };
    function fill(s) {
      var o = String(s || '');
      for (var k in vars) { if (vars.hasOwnProperty(k)) o = o.split('{' + k + '}').join(vars[k]); }
      return o;
    }
    try {
      var team = hiringTeamRecipients_();
      var rehearsal = (typeof simIsRehearsalCid_ === 'function') && simIsRehearsalCid_(cid);
      var addr = (rehearsal && typeof simTeamAddress_ === 'function') ? simTeamAddress_() : null;
      var to = (addr && addr.to) || team.emails.join(', ');
      var letter = hiringDiscardEmail_({
        name: name || cid, reason: reason, stage: 'Outreach', when: when,
        by: 'the platform, after ' + said,
        subject: fill(str_(sit.email_subject)),
        bodyText: fill(str_(sit.email_text))
      });
      rpcCall_('emailSend', {
        to: to, cc: (addr && addr.cc) || '',
        subject: (typeof simTagSubject_ === 'function')
          ? simTagSubject_(str_(letter.subject)) : str_(letter.subject),
        body: str_(letter.text), html: str_(letter.html),
        reason: 'hiring: nobody could reach ' + (name || cid) + ' — archived'
      }, { idempotency_key: 'unreach_mail_' + cid });

      var body = fill(str_(sit.sms_text));
      if (body) {
        (team.sms || []).forEach(function (n) {
          var num = (typeof simSendablePhone_ === 'function') ? simSendablePhone_(n) : n;
          if (!num) return;
          rpcCall_('smsSend', { to: num, body: body,
                                reason: 'hiring: ' + (name || cid) + ' archived, unreachable' },
                   { idempotency_key: 'unreach_sms_' + cid + '_' + num });
        });
      }
    } catch (eS) {
      // THE ARCHIVE STANDS EITHER WAY.
      hubSysLog_('asa-hub:unreachable', 'unreachable_notice_failed',
                 cid + ' — ' + String((eS && eS.message) || eS), { status: 500 });
    }

    // 3 — close the ask, so no ear or retry ever revisits the card.
    try { simAskAnswer_(TRIED_STEPS, 'archived — nobody could reach them', cid); } catch (eC2) {}
    try {
      journeyLog_({ candidate_id: cid, name: name, step: 'outreach', channel: 'record', ok: true,
                    title: 'Nobody could reach them — archived',
                    detail: reason + '. The team was told once, and the next name in the ' +
                            'queue comes in on this same pass.',
                    by: 'asa-hub:unreachable' });
    } catch (eJ) {}
    done++;
    names.push(name || cid);
  }
  if (done) {
    // The pass can hold cards from BOTH ladders, which ran on different clocks, so the summary counts people and…
    hubSysLog_('asa-hub:unreachable', 'unreachable_archived',
               done + ' archived after every configured try with no answer: ' +
               names.join(', ').slice(0, 300), { status: 200 });
  }
}
