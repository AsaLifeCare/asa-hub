// ------------------------------------------------------------------ COMM WINDOW ASK — the platform asks, instead…
// While no answer has come back, ask once a day, fifteen minutes before the shift.

// THE PURPOSE — and this is the decision that costs something either way.
var COMM_WINDOW_ASK_PURPOSE = 'contact.window';

// The words, by id.
var COMM_WINDOW_ASK_SITUATION = 'contact_window_ask';

// THE BAND — `ask`, and the argument for the other one is real.
var COMM_WINDOW_ASK_PRIORITY = 'ask';

// THE DIALS.
var COMM_WINDOW_ASK_FLOOR = {
  max_asks: 3,       // then it is a person's job, and never a fourth message
  gap_hours: 0       // off: the calendar day is the pace
};

/** One dial, read the way `commPolicy_` reads its own. */
function commWindowAskSetting_(key) {
  var floor = COMM_WINDOW_ASK_FLOOR[key];
  try {
    if (typeof digestSetting_ === 'function') {
      return Number(digestSetting_('comm_window_ask_' + key, floor, 0, 9999));
    }
  } catch (e) { /* the floor is the answer */ }
  return Number(floor);
}

// The service sweep's window.
var COMM_WINDOW_ASK_SWEEP_KEY = 'comm_window_ask_last_run';
var COMM_WINDOW_ASK_SWEEP_GAP_S = 9 * 60;
var COMM_WINDOW_ASK_BUDGET_MS = 60 * 1000;

// THE MOMENT — from the person's own next shift, and from nowhere else.
function commWindowAskMoments_(nowMs) {
  if (typeof commWhenRows_ !== 'function') return null;
  var rows;
  try { rows = commWhenRows_(); } catch (e) { return null; }
  // `|| []` here would read the reader's refusal as an empty roster — the one confusion this lane cannot afford.
  if (rows === null || rows === undefined) return null;
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    if (String(r.state || '') !== 'reachable') continue;
    var from = Date.parse(String(r.window_from || ''));
    var to = Date.parse(String(r.window_to || ''));
    if (isNaN(from) || isNaN(to)) continue;
    if (nowMs < from || nowMs > to) continue;
    // KEYED THE PLATFORM'S OWN WAY.
    var key = (typeof clientNameKey_ === 'function')
      ? clientNameKey_(r.name || r.person_key) : String(r.person_key || '');
    if (!key) continue;
    out.push({
      person_key: key,
      name: String(r.name || ''),
      window_from: String(r.window_from || ''),
      window_to: String(r.window_to || ''),
      moment_at: String(r.moment_at || ''),
      shift_at: String(r.shift_at || ''),
      only_by_this_rule: (r.only_by_this_rule === true || String(r.only_by_this_rule) === 'true' ||
                          String(r.only_by_this_rule).toLowerCase() === 'yes'),
      why: String(r.why || '')
    });
  }
  return out;
}

// THE QUIET HOURS, ANSWERED BY THE PERSON INSTEAD OF BY THE PLATFORM.
function commWindowAskQuiet_(moment) {
  if (!moment || !moment.window_from) return null;   // unproven: the platform's hours stand
  return { from: 0, to: 0,
           why: 'their own shift starts at ' + String(moment.shift_at || '').slice(11, 16) +
                ' — measured from the roster, not assumed; the company-wide quiet hours are a ' +
                'stand-in for being asleep and this person is provably awake' };
}

// HAS THIS PERSON ALREADY ANSWERED?
function commWindowAskAnswered_(prior, consentRows) {
  var state = String((prior && prior.state) || '');
  if (state === 'answered') return { answered: true, why: 'they replied — the thread is answered' };
  if (state === 'stopped') return { answered: true, why: 'they asked us to stop' };
  var said = commWindowAskStatedWindow_(consentRows);
  if (said) return { answered: true, why: 'a window is already on record: ' + said };
  return { answered: false, why: '' };
}

// WHAT THE CONSENT HOUSE HOLDS ABOUT THIS PERSON'S HOURS, or ''.
function commWindowAskStatedWindow_(consentRows) {
  var rows = consentRows || [];
  for (var i = 0; i < rows.length; i++) {
    var from = String((rows[i] && rows[i].window_from) || '').trim();
    var to = String((rows[i] && rows[i].window_to) || '').trim();
    if (from || to) return (from || '?') + '-' + (to || '?');
  }
  return '';
}

// ONCE A DAY MEANS ONCE.
function commWindowAskDayKey_(ms) {
  try {
    return Utilities.formatDate(new Date(Number(ms)), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  } catch (e) { return String(new Date(Number(ms)).toISOString()).slice(0, 10); }
}

function commWindowAskDayVerdict_(lastAskedMs, nowMs) {
  if (!lastAskedMs) return { ok: true, why: 'never asked' };
  if (commWindowAskDayKey_(lastAskedMs) === commWindowAskDayKey_(nowMs)) {
    return { ok: false, defer: true, why: 'already asked today — once a day means once' };
  }
  var gap = commWindowAskSetting_('gap_hours');
  if (gap > 0) {
    var hours = (Number(nowMs) - Number(lastAskedMs)) / 3600000;
    if (hours < gap) {
      return { ok: false, defer: true,
               why: 'asked ' + Math.round(hours) + 'h ago; this lane\'s floor is ' + gap + 'h' };
    }
  }
  return { ok: true, why: 'not asked today' };
}

// IS THERE ANY POINT ASKING AGAIN — and what happens when there is not.
function commWindowAskAttemptVerdict_(attempts) {
  var n = Number(attempts) || 0;
  var cap = commWindowAskSetting_('max_asks');
  var after = Number(commPolicy_('escalate_after'));
  if (cap > 0 && n >= cap) {
    return { ok: false, defer: false, escalate: true, spent: true,
             why: n + ' asks with no answer — this lane stops here for good; asking somebody ' +
                  'this every day for ever is harassment, and it is a person\'s job now' };
  }
  return { ok: true, escalate: cap > 0 && n >= after,
           why: 'ask ' + (n + 1) + (cap > 0 ? ' of ' + cap : ' (uncapped by the book)') };
}

// The situation, by the book's re-point or by this lane's floor.
function commWindowAskSituation_() {
  var sit = null;
  try {
    if (typeof commSituationFor_ === 'function') sit = commSituationFor_(COMM_WINDOW_ASK_PURPOSE);
  } catch (e) { sit = null; }
  if (sit) return sit;
  try {
    return (typeof smartSituationOn_ === 'function')
      ? smartSituationOn_(COMM_WINDOW_ASK_SITUATION) : null;
  } catch (e2) { return null; }
}

// The intent this lane plans: one person, one question, no obligations.
function commWindowAskIntent_(moment) {
  return {
    intent_key: commIntentKey_(moment.person_key, COMM_WINDOW_ASK_PURPOSE),
    purpose: COMM_WINDOW_ASK_PURPOSE,
    person_key: String(moment.person_key || ''),
    person_name: String(moment.name || ''),
    state: 'planned',
    // EMPTY, AND THAT IS THE TRUTH ON THE ROW.
    bindings: [],
    worst: '',
    deferred: 0
  };
}

// The shape the transport carries.
function commWindowAskItem_(intent, person, situation) {
  return {
    situation: String(situation.id || ''),
    key: 'CI|' + String(intent.intent_key || ''),
    name: String(intent.person_name || ''),
    name_key: String(intent.person_key || ''),
    phone: String((person && person.phone) || ''),
    email: String((person && person.email) || ''),
    credential: '',
    expires: '',
    days_left: '',
    channels: (situation.channels && situation.channels.length) ? situation.channels : ['sms', 'email'],
    rehearsal: false,
    rehearsed: false,
    config: situation,
    intent_key: String(intent.intent_key || ''),
    bindings: [],
    binding_count: 0,
    raw_bindings: []
  };
}

// THE SWEEP.
function commWindowAskSweep_(user, opts) {
  opts = opts || {};
  var dial = commDial_();
  if (dial === 'off') {
    return { status: 200, data: { skipped: true, dial: dial,
             note: 'the dial is off — nothing was planned and nothing was written' } };
  }
  var now = new Date();
  var nowIso = now.toISOString();
  var nowMs = now.getTime();

  var moments = commWindowAskMoments_(nowMs);
  if (moments === null) {
    // THE READER DID NOT ANSWER.
    var why = 'no reader answers for the shift moments (commWhenRows_)';
    try {
      if (typeof commWhenRefusal_ === 'function') why = commWhenRefusal_() || why;
    } catch (eW) { /* the floor sentence stands */ }
    try {
      hubSysLog_(str_(user && user.email) || 'asa-hub:comm', 'comm_window_ask_no_reader',
                 why + ' — nobody was asked. This lane never picks an hour of its own.',
                 { status: 200 });
    } catch (eL) { /* the answer below says it too */ }
    return { status: 200, data: { skipped: true, why: why + ' — nobody was asked',
                                  dial: dial } };
  }
  if (!moments.length) {
    return { status: 200, data: { asked: 0, considered: 0, dial: dial,
             note: 'nobody is inside their window this minute' } };
  }

  // THE HOUSE MUST ALREADY EXIST.
  var houseReady = false;
  try { houseReady = !!hubTabSheet_(COMM_INTENTS_HOUSE); } catch (eH) { houseReady = false; }
  if (!houseReady) {
    return { status: 200, data: { skipped: true, dial: dial,
             why: 'the ' + COMM_INTENTS_HOUSE + ' house has not been minted — this lane writes it, ' +
                  'it does not create it' } };
  }

  var situation = commWindowAskSituation_();
  var roster = commRecordRoster_();
  var prior = commRecordPrior_();
  var people = commRecordPeople_();
  var routes = commRecordRoutes_();
  var consent = commRecordConsentRows_();
  var test = commTestMode_();
  var tz = Session.getScriptTimeZone();
  var localDay = Number(Utilities.formatDate(now, tz, 'u')) % 7;   // Sunday = 0
  var localHour = Number(Utilities.formatDate(now, tz, 'H'));

  var considered = 0, wrote = 0, sent = 0, redirected = 0, held = 0, answered = 0;
  var offRoster = 0, noRoute = 0, spent = 0, doubts = 0, gated = 0;
  var startedAt = new Date().getTime();

  for (var i = 0; i < moments.length; i++) {
    if (wrote && (new Date().getTime() - startedAt) > COMM_WINDOW_ASK_BUDGET_MS) break;
    var moment = moments[i];
    considered++;

    // THE ROSTER IS A LAW HERE TOO.
    if (!roster[moment.person_key]) { offRoster++; continue; }

    var intent = commWindowAskIntent_(moment);
    var was = prior[String(intent.intent_key || '')] || {};
    var rows = consent[moment.person_key] || [];

    var done = commWindowAskAnswered_(was, rows);
    if (done.answered) {
      answered++;
      // A THREAD STILL SAYING `asking` ABOUT A QUESTION ALREADY ANSWERED is two harms, not a cosmetic one: the…
      if (was.id && ['asking', 'planned'].indexOf(String(was.state || '')) !== -1) {
        try {
          commRecordUpsert_(COMM_INTENTS_HOUSE, { id: was.id, state: 'answered',
                                                  reasons: 'answered — ' + done.why });
          commObserve_('settled', intent, { by: 'the answer on record', why: done.why }, 'sweep');
        } catch (eA) { /* the next pass sees the same answer and tries again */ }
      }
      continue;
    }

    var mem = commRecordMemory_(was, test);
    var reasons = ['priority: ' + COMM_WINDOW_ASK_PRIORITY +
                   ' — it asks a person for something, so it joins the queue it is in'];
    reasons.push('moment: ' + (moment.why || 'inside the window before their shift'));

    var verdict = { send: true, defer: false, escalate: false, test: test,
                    priority: COMM_WINDOW_ASK_PRIORITY, priority_id: COMM_WINDOW_ASK_PURPOSE,
                    droppable: false, parts: [], skipped: [], reasons: reasons };

    var att = commWindowAskAttemptVerdict_(mem.attempts);
    // NAMED `attempts:` AND NOT `asks:` — `commRecordRows_` copies the reason that begins with that word into…
    reasons.push('attempts: ' + att.why);
    if (att.escalate) verdict.escalate = true;
    if (!att.ok) { verdict.send = false; verdict.defer = !!att.defer; if (att.spent) spent++; }

    if (verdict.send) {
      var day = commWindowAskDayVerdict_(mem.lastMs, nowMs);
      reasons.push('pace: ' + day.why);
      if (!day.ok) { verdict.send = false; verdict.defer = true; }
    }

    // THE ROUTE.
    var person = commRecordContact_(people, routes, moment.person_key);
    var channels = situation ? commRecordChannels_(situation) : ['sms', 'email'];
    var refused = commRecordRefused_(person);
    var route = commRouteFor_(rows, refused, COMM_WINDOW_ASK_PURPOSE, channels, nowMs);
    if (!route.ok && test) {
      // SOFTENED ONLY WHERE THE `NO` CAME FROM SILENCE.
      var open = channels.filter(function (ch) { return !refused[ch]; });
      if (open.length) {
        route = { ok: true, channel: open[0],
                  why: route.why + ' — not enforced in test mode', tried: route.tried };
      } else {
        route = { ok: false, channel: '',
                  why: route.why + ' — and a refusal is never softened, test mode or not',
                  tried: route.tried };
      }
    }
    reasons.push('route: ' + route.why);
    verdict.channel = route.channel || '';
    verdict.route_tried = route.tried || [];
    // NO PERMITTED ROUTE IS A BLOCK, NEVER A HOLD.
    var blockedByConsent = !route.ok;
    if (blockedByConsent) { verdict.send = false; verdict.defer = false; }

    if (verdict.send) {
      var win = commWindowVerdict_(localHour, localDay, commWindowAskQuiet_(moment),
                                   COMM_WINDOW_ASK_PRIORITY);
      reasons.push('window: ' + win.why);
      if (!win.ok) { verdict.send = false; verdict.defer = true; }
    }

    // THE WORDS ARE PART OF THE VERDICT, not a discovery made after the row was written.
    if (!situation) {
      verdict.send = false;
      verdict.defer = false;
      reasons.push('words: no situation carries this question — `' + COMM_WINDOW_ASK_SITUATION +
                   '` is off or absent, and a publish never switches a sender on');
    }
    // Somebody with no number and no address cannot be asked anything, and that is a fact about the estate rather…
    var unreachable = !person || (!person.phone && !person.email);
    if (unreachable) {
      verdict.send = false;
      verdict.defer = false;
      reasons.push('reach: the People house holds neither a number nor an address for them');
    }

    verdict.policy = verdict.send ? 'would send' : (verdict.defer ? 'held' : 'blocked');
    verdict.dial = dial;
    if (dial !== 'send') {
      verdict.send = false;
      reasons.push('dial: ' + dial + ' — worked out, not handed over');
    }

    // THE THREAD IS WRITTEN WHATEVER THE VERDICT, in the shape every other thread in this house wears…
    var built = commRecordRows_(intent, verdict, nowIso, was);
    if (!built) continue;
    try { commRecordUpsert_(COMM_INTENTS_HOUSE, built.intent); wrote++; }
    catch (eW) { continue; /* one person failing must not cost the pass */ }

    if (att.spent && String(was.escalate || '') !== 'yes') {
      commObserve_('escalated', intent, { attempts: mem.attempts, why: att.why }, 'sweep');
      if (!test) {
        commObserve_('unanswered', intent, { attempts: mem.attempts, last_asked_at: mem.lastIso,
                                             why: 'the ceiling was reached — this lane asks no more' },
                     'sweep');
      }
    }
    if (!verdict.send) {
      if (blockedByConsent || unreachable) noRoute++; else held++;
      continue;
    }

    var item = commWindowAskItem_(intent, person, situation);
    // CLAIM FIRST, FAIL CLOSED — a lost write may cost one ask, never a second message (CommRecord.gs' own law, and…
    var claim = commRecordClaim_(built.intent.id, test, mem.attempts + 1, nowIso, '');
    if (!claim) { held++; continue; }
    var out = commRecordSend_(item, situation, person, route, mem.attempts, function () { return ''; });
    var evidenceId = commRecordAttempt_(intent, mem.attempts + 1, out, test, nowIso);
    commObserve_(out.sent ? (out.redirected ? 'redirected' : 'sent') : (out.doubt ? 'doubt' : 'held'),
                 intent, { attempt: mem.attempts + 1, attempt_id: evidenceId, channel: out.channel,
                           receipt: out.receipt, error: out.error, test_mode: test,
                           asking: 'when we may reach them' }, 'sweep');
    if (out.sent) {
      sent++;
      if (out.redirected) redirected++;
      try { commRecordUpsert_(COMM_INTENTS_HOUSE, { id: built.intent.id, state: 'asking',
                                                    channel: out.channel }); } catch (eC) {}
      try {
        if (typeof smartRecord_ === 'function') {
          // THE LEDGER READS BY KEY, and a redirected send reached the testers and not the person — written under…
          var ledgerKey = (out.redirected && typeof smartRehearsalKey_ === 'function')
            ? smartRehearsalKey_(item.key) : item.key;
          smartRecord_(ledgerKey, String(situation.id || ''), item.name, '',
                       out.redirected ? 'rehearsal' : out.channel);
        }
      } catch (eL2) { /* the intent row carries it either way */ }
    } else if (out.doubt) {
      // A DOUBT KEEPS THE CLAIM: the provider may have taken it, and giving the ask back would send it twice.
      doubts++;
      try { commRecordUpsert_(COMM_INTENTS_HOUSE, { id: built.intent.id, last_error: out.error }); } catch (eD) {}
    } else {
      if (out.gated) gated++;
      commRecordClaim_(built.intent.id, test, mem.attempts, String(mem.lastIso || ''), '');
    }
  }

  try {
    hubSysLog_(str_(user && user.email) || 'asa-hub:comm', 'comm_window_ask_swept',
               considered + ' inside a window · ' + wrote + ' thread(s) written · ' + sent + ' asked' +
               (redirected ? ' (' + redirected + ' to the testers)' : '') +
               ' · ' + answered + ' already answered · ' + held + ' held · ' + spent + ' at the ceiling' +
               ' · ' + offRoster + ' off roster · ' + noRoute + ' unreachable' +
               (doubts ? ' · ' + doubts + ' in doubt (claim kept)' : '') +
               (situation ? '' : ' · the words are off, so nothing was handed over'),
               { status: 200 });
  } catch (eL3) { /* recorded either way */ }

  return { status: 200, data: {
    dial: dial, test_mode: test, considered: considered, threads: wrote, asked: sent,
    redirected: redirected, answered: answered, held: held, at_ceiling: spent,
    off_roster: offRoster, unreachable: noRoute, doubts: doubts, gated: gated,
    words: situation ? String(situation.id || '') : '',
    note: dial === 'send'
      ? (test ? 'asked — every message went to the testers, nobody else.' : 'asked.')
      : 'planned and written down. Nothing was sent — the dial says ' + dial + '.' } };
}

// The window on the clock.
function commWindowAskSweepMaybe_() {
  if (commDial_() === 'off') return null;
  var props;
  try { props = PropertiesService.getScriptProperties(); } catch (e) { return null; }
  var last = 0;
  try { last = Number(props.getProperty(COMM_WINDOW_ASK_SWEEP_KEY) || 0) || 0; } catch (e2) { last = 0; }
  var now = new Date().getTime();
  if (last && (now - last) / 1000 < COMM_WINDOW_ASK_SWEEP_GAP_S) return null;
  // Stamped before the work: a pass that dies halfway must not run again on the very next tick, which is how a…
  try { props.setProperty(COMM_WINDOW_ASK_SWEEP_KEY, String(now)); } catch (e3) { /* run anyway */ }
  return commWindowAskSweep_(null);
}

// THE DOOR THE RELAY RINGS.
HUB_POLICY.commWindowAskSweep = {
  file: 'CommWindowAsk.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin'],
  params: { force: { type: 'boolean' } },
  invalidates: [], emits: ['smsSend', 'emailSend']
};
HUB_ACTIONS.commWindowAskSweep = function (payload, user) {
  var isMachine = !!(user && user.is_service);
  if (!isMachine && (!user || String(user.role) !== 'admin')) return hubDenied_();
  if (payload && (payload.force === true || String(payload.force) === 'true')) {
    return commWindowAskSweep_(user, { force: true });
  }
  var r = commWindowAskSweepMaybe_();
  return r || { status: 200, data: { skipped: true,
                                     why: 'inside this lane\'s window, or the dial is off' } };
};

// ──────────────────────────────────────────────────────────────────────── WHERE THE ANSWER LIVES — the half this…
