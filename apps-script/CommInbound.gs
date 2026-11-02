// ------------------------------------------------------------------ COMM INBOUND — whose answer is this, and to…
// `Comms.gs` mirrors the phone system's messages, `entity_inbound_messages` is the durable side of that, and…

// How a reply token appears in a message.
var COMM_TOKEN_RE = /\b([A-Z]{2}-[A-Z0-9]{6})\b/;

// THE SAME TOKEN, SCANNED WHOLE.
var COMM_TOKEN_SCAN_RE = /\bCI-[A-Z0-9]{6}\b/g;

// Where a quoted original begins.
var COMM_QUOTE_RE = /^\s*(>|On\s.+\swrote:|Em\s.+\sescreveu:|-{2,}\s*Original Message|From:\s|De:\s|Sent:\s|\[TEST)/i;

/** What a rehearsal row says before it says anything else. */
var COMM_REHEARSAL_MARK = 'REHEARSAL (test mode, the tester answered — not the person) — ';

// The token this lane would put in a message for one intent.
function commReplyToken_(intentKey) {
  var id = (typeof commRecordId_ === 'function')
    ? commRecordId_(String(intentKey || '')) : String(intentKey || '').toUpperCase();
  return 'CI-' + String(id).replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

// WHICH INTENT DOES THIS ANSWER BELONG TO?
function commInboundCapture_(message) {
  var m = message || {};
  var nowIso = new Date().toISOString();
  var mid = String(m.message_id || '');
  if (!mid) return { ok: false, why: 'no message id' };
  if (commContributionExists_(mid)) return { ok: true, already: true };

  var who = commInboundPerson_(m);
  var stub = { person_key: (who && who.key) || '', person_name: (who && who.name) || '', intent_key: '' };
  commObserve_('replied', stub, { channel: m.channel, from: commMask_(m.from), message_id: mid,
                                  matched: !!who }, 'inbound', 'provider');
  if (!who) {
    // A REPLY FROM ONE OF OUR OWN LINES IS NOT A STRANGER.
    var ours = false;
    try {
      var d = String(m.from || '').replace(/\D/g, '').replace(/^1/, '');
      ours = (String(m.channel) === 'sms') && (typeof inboundIsOurs_ === 'function') && !!d && inboundIsOurs_(d);
      // THE E-MAIL HALF OF THE SAME FACT.
      if (!ours) ours = commInboundTester_(m.from, m.channel);
    } catch (eO) { ours = false; }
    if (ours) {
      // GATE (5).
      var rehearsed = commInboundRehearse_(m, mid, nowIso);
      if (rehearsed) return rehearsed;
      var testing = commTestMode_();
      var ownWhy = testing
        ? 'a reply from one of our own lines with NO REFERENCE in the body — every message goes to the ' +
          'tester while test mode is on, so a reply names its thread by quoting the Ref or not at all'
        : 'a reply from one of our own lines — traffic between company numbers, not somebody writing back';
      commObserve_('replied', stub, { channel: m.channel, from: commMask_(m.from), own_line: true,
                                      test_mode: testing ? 'yes' : 'no', why: ownWhy },
                   'inbound', 'the tester line');
      // THE DURABLE MARK (4).
      if (testing) {
        commContributionSave_(commInboundRehearsalRow_(m, null,
          { kind: 'unclear', claims: [], why: ownWhy }, 'dismissed', 'ambiguous', nowIso, null));
      }
      return { ok: true, matched: false, own_line: true };
    }
    // BEFORE IT IS FILED AS A STRANGER, ASK THE NUMBER.
    var roster = (String(m.channel) !== 'email' && typeof contactPhoneWho_ === 'function')
      ? contactPhoneWho_(m.from) : null;
    commObserve_('unmatched', stub, {
      channel: m.channel,
      from: commMask_(m.from),
      roster: roster ? roster.state : 'not asked',
      // Only a sole line offers a name, and it travels as a CANDIDATE.
      candidate: (roster && roster.state === 'sole') ? roster.name : '',
      candidate_from: (roster && roster.state === 'sole') ? 'phone' : '',
      why: roster ? contactWhoText_(roster)
                  : 'an address, not a number — the roster is asked by phone'
    }, 'inbound', 'provider');
    return { ok: true, matched: false };
  }

  var open = commInboundOpenIntents_(who.key);
  var corr = commCorrelate_({ text: m.text, thread_id: m.thread_id }, open);
  var text = String(m.text || '');
  var labelFor = function (id) {
    // The catalogue's one door (Certs.gs) — config first, shipped floor behind.
    return (typeof certLabels_ === 'function' && certLabels_()[id]) ? certLabels_()[id] : '';
  };

  /* A CONSENT WORD IS ACTED ON AT ONCE, thread or no thread. */
  var consent = commInboundIntent_(text);

  // THEY LET US BACK IN.
  if (consent === 'opt-in') {
    var freed = 0;
    try {
      var rel = optOutRelease_(String(m.from || ''), { email: 'asa-hub:comm' });
      freed = (rel && rel.freed) || 0;
    } catch (eR) {}
    var rowIn = commContributionRow_(m, who, corr,
      { kind: 'opt-in', claims: [],
        why: 'they asked us to contact them again' +
             (freed ? ' — ' + freed + ' suppression(s) released' : '') +
             '; nothing was said about what is still open' },
      null, 'needs_human', 'unclear', nowIso);
    commContributionSave_(rowIn);
    commObserve_('consent_changed', corr.intent || stub,
                 { channel: m.channel, intent: 'opt-in', phrase: text.slice(0, 80), released: freed,
                   contribution: rowIn.id },
                 'inbound', 'the person');
    return { ok: true, matched: true, opted_in: true, released: freed, contribution: rowIn.id };
  }

  // A STOP, AND THE WRONG NUMBER BESIDE IT.
  if (consent === 'opt-out' || consent === 'wrong-number') {
    var bad = (consent === 'wrong-number');
    try {
      // `by` NAMES THE EAR, because two of them write this list.
      optOutAdd_(String(m.from || ''), { name: who.name, source: bad ? 'wrong number' : 'comm_reply',
                                         phrase: text.slice(0, 80), messageId: mid, by: 'asa-hub:comm',
                                         scope: corr.intent ? 'staff' : '' });
    } catch (eO) {}
    var stopped = corr.intent || stub;
    commObserve_('consent_changed', stopped,
                 { channel: m.channel, intent: consent, phrase: text.slice(0, 80) }, 'inbound', 'the person');
    if (corr.intent) {
      try { commRecordUpsert_(COMM_INTENTS_HOUSE, { id: corr.intent.id, state: 'stopped', last_reply_at: nowIso }); } catch (eS) {}
      commObserve_('stopped', corr.intent, { by: bad ? 'a wrong number' : 'the person', message_id: mid },
                   'inbound', bad ? 'our own bad data' : 'the person');
    }
    commContributionSave_(commContributionRow_(m, who, corr,
      { kind: bad ? 'wrong-number' : 'stop', claims: [],
        why: bad ? 'the person on this line never applied — the number is ours to fix, not theirs to answer'
                 : 'the person asked us to stop' },
      null, 'stopped', bad ? 'wrong-number' : 'stop', nowIso));
    return { ok: true, matched: true, stopped: true, wrong_number: bad };
  }

  // ── THE THIRD WAY IN, ASKED BEFORE ANYTHING IS READ AS AN ANSWER ───────── A reply that says WE got something…
  var said = commInboundSaid_(text);
  var heard = commCorrectionRead_(said);
  if (heard.kind === 'identity' || heard.kind === 'sender') {
    return commCorrectionHandle_(m, who, corr, heard, said, nowIso);
  }
  // THE THIRD KIND GOES NOWHERE NEAR THIS PATH.
  var askNote = (heard.kind === 'ask')
    ? ' — and they say we already have it. That is a claim about an obligation, so the estate ' +
      'answers it and not this ear: it settles only where the record already agrees'
    : '';

  if (!corr.intent) {
    // ── THE CLOSE.
    var back = commCloseRepairReply_(m, who, corr, said, open, nowIso);
    if (back && back.handled) return back.result;

    var reason = commDeskReason_(corr, null, null, 0) || 'ambiguous';
    var why0 = corr.why + askNote + ((back && back.note) || '');
    // THE LADDER IS NOT WIDENED FOR A WINDOW, AND THE DESK IS TOLD WHY.
    var openWindow = (open || []).filter(commStatedIsWindowThread_)[0] || null;
    var peek = openWindow ? commStatedWindowRead_(commInboundSaid_(text)) : null;
    if (peek && peek.confident) {
      why0 += ' — and their contact-window question is one of the threads open. This reply reads as ' +
              peek.read_as + ', but reading it INTO that thread because it looks like hours would be a ' +
              'guess about which question they answered. Nothing was stored; a person decides';
    }
    var row0 = commContributionRow_(m, who, corr, { kind: 'unclear', claims: [], why: why0 }, null, 'needs_human', reason, nowIso);
    if (peek && peek.confident) {
      row0.window_read_as = String(peek.read_as || '');
      row0.window_from = String(peek.from || '');
      row0.window_to = String(peek.to || '');
      row0.window_days = String(peek.days || '');
      row0.window_stored = 'no';
    }
    commContributionSave_(row0);
    commObserve_('needs_human', stub, { reason: reason, why: why0, contribution: row0.id }, 'inbound');
    return { ok: true, matched: true, correlated: false, reason: reason };
  }

  var intent = corr.intent;
  commObserve_('correlated', intent, { how: corr.how, why: corr.why, message_id: mid }, 'inbound');

  // A WINDOW ANSWER LEAVES THE ESTATE PATH HERE, and the branch is not a shortcut — it is the only honest road for…
  if (commStatedIsWindowThread_(intent)) {
    return commStatedWindowHandle_(m, who, corr, intent, nowIso);
  }

  var contribution = commContribution_(text, intent, labelFor);
  var estate = commInboundEstate_(who.key);
  var qualified = commQualify_(intent, contribution, function (demandId) {
    return estate[String(demandId || '')] || { state: 'unknown' };
  });

  // WHERE THE ESTATE AGREES, THE BINDING SETTLES NOW — the estate is the qualifier, not the reply.
  var settledNow = [], awaiting = [];
  (qualified.results || []).forEach(function (r) {
    var b = (intent.bindings || []).filter(function (x) { return String(x.demand_id) === String(r.demand_id); })[0];
    if (!b) return;
    if (r.settle) {
      try { commRecordUpsert_(COMM_BINDINGS_HOUSE, { id: b.id, binding_state: 'settled', qualified_by: 'estate',
                                                     qualified_at: nowIso, note: 'the person said so and requirement_states agrees' }); } catch (eB) {}
      settledNow.push(String(r.demand_id));
    } else if (r.verdict === 'disagrees' || r.verdict === 'unknown') {
      awaiting.push(String(r.demand_id));
    }
  });
  var state = awaiting.length ? 'awaiting_owner' : (settledNow.length ? 'settled' : 'needs_human');
  var why = commDeskReason_(corr, contribution, qualified, 0) || '';
  if (state === 'needs_human' && !why) why = contribution.kind === 'unclear' ? 'unclear' : 'ambiguous';
  var row = commContributionRow_(m, who, corr, contribution, qualified, state, why, nowIso);
  row.settled_now = settledNow.join(' · ');
  row.awaiting = awaiting.join(' · ');
  if (askNote) {
    // NAMED, NEVER ACTED ON.
    row.correction_kind = 'ask';
    row.why = String(row.why || '') + askNote;
  }
  commContributionSave_(row);
  commObserve_('contribution', intent, { kind: contribution.kind, claims: (contribution.claims || []).length,
                                         settled_now: settledNow.length, awaiting: awaiting.length,
                                         state: state, contribution: row.id }, 'inbound');
  if (settledNow.length) {
    commObserve_('settled', intent, { demands: settledNow, by: 'estate', contribution: row.id }, 'inbound', 'estate');
  }
  if (state === 'needs_human') commObserve_('needs_human', intent, { reason: why, contribution: row.id }, 'inbound');

  /* the thread moves: answered when nothing is left open, else still asking */
  var stillOpen = (intent.bindings || []).filter(function (b) {
    return String(b.binding_state || 'open') === 'open' && settledNow.indexOf(String(b.demand_id)) === -1;
  }).length;
  try {
    commRecordUpsert_(COMM_INTENTS_HOUSE, { id: intent.id, state: stillOpen ? 'asking' : 'answered',
                                            last_reply_at: nowIso, thread_id: String(m.thread_id || intent.thread_id || '') });
  } catch (eI) {}
  return { ok: true, matched: true, correlated: true, how: corr.how, kind: contribution.kind,
           settled_now: settledNow.length, awaiting: awaiting.length, state: state, contribution: row.id };
}

// THE OTHER HALF OF THE ANSWER BACK: a reply that arrives as e-mail.
var COMM_MAIL_SWEEP_KEY = 'comm_mail_last_run';
var COMM_MAIL_SWEEP_GAP_S = 15 * 60;
var COMM_MAIL_READ = 40;

HUB_POLICY.commRepliesSweep = {
  file: 'CommInbound.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  params: { force: { type: 'boolean' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.commRepliesSweep = function (payload, user) {
  var isMachine = !!(user && user.is_service);
  if (!isMachine && (!user || String(user.role) !== 'admin')) return hubDenied_();
  var force = !!(payload && (payload.force === true || String(payload.force) === 'true'));
  if (!force) {
    var due = commMailDue_();
    if (!due) return { status: 200, data: { skipped: true, why: 'inside the fifteen-minute window' } };
  }
  // THE CLOSE RIDES THE EAR'S OWN TICK, behind its own six-hour stamp.
  var closed = null;
  try { closed = commCloseSweepMaybe_(); } catch (eX) { closed = null; }
  var swept = commMailSweep_();
  if (closed && swept && swept.data) swept.data.closed = closed;
  return swept;
};

/** The window, stamped before the work — a crash costs one pass, never a loop. */
function commMailDue_() {
  var props;
  try { props = PropertiesService.getScriptProperties(); } catch (e) { return false; }
  var last = 0;
  try { last = Number(props.getProperty(COMM_MAIL_SWEEP_KEY) || 0) || 0; } catch (e2) { last = 0; }
  var now = new Date().getTime();
  if (last && (now - last) / 1000 < COMM_MAIL_SWEEP_GAP_S) return false;
  try { props.setProperty(COMM_MAIL_SWEEP_KEY, String(now)); } catch (e3) { /* run anyway */ }
  return true;
}

/** One pass of the mailbox, looking only for replies to threads we opened. */
function commMailSweep_() {
  if (commDial_() === 'off') {
    return { status: 200, data: { skipped: true, why: 'the dial is off — nobody was asked anything' } };
  }
  var inbox;
  try { inbox = platformMailPost_('/mail/inbox', { limit: COMM_MAIL_READ }); }
  catch (e) { return { status: 502, message: 'the mailbox did not answer: ' + String((e && e.message) || e).slice(0, 120) }; }
  if (!inbox || inbox.status !== 200) {
    return { status: 502, message: 'the mailbox did not answer: ' + String(inbox && inbox.message).slice(0, 120) };
  }
  var threads = (inbox.data && inbox.data.threads) || [];
  if (!threads.length) return { status: 200, data: { read: 0, captured: 0, note: 'an empty inbox' } };

  // WHO IS A PERSON HERE.
  var by = (typeof commRecordPeopleByContact_ === 'function')
    ? commRecordPeopleByContact_() : { phone: {}, email: {} };
  var out = { read: threads.length, mine: 0, captured: 0, already: 0, not_a_person: 0, no_thread: 0,
              tester: 0, corrections: 0 };
  /* Read lazily and once — see the admission gate below. */
  var repairRows = null;

  for (var i = 0; i < threads.length; i++) {
    var t = threads[i] || {};
    var mid = String(t.id || '');
    var from = commMailAddress_(t.from_addr || t.from_name);
    if (!mid || !from) continue;
    if (!by.email[from]) {
      // THE TESTER IS NOT A STRANGER EITHER.
      if (!commInboundTester_(from, 'email')) { out.not_a_person++; continue; }
      out.tester++;
      if (commContributionExists_(mid)) { out.already++; continue; }
      try {
        var rt = commInboundCapture_({
          channel: 'email', message_id: mid, from: from, to: String(t.to || ''),
          text: String(t.snippet || ''), at: String(t.date || new Date().toISOString()),
          thread_id: '', source: 'mailbox'
        });
        if (rt && rt.ok && !rt.already) out.captured++;
      } catch (eT) {
        try { hubSysLog_('asa-hub:comm', 'comm_mail_failed', mid + ': ' + String((eT && eT.message) || eT), { status: 500 }); }
        catch (eL3) { /* the next pass retries it */ }
      }
      continue;
    }
    out.mine++;
    if (commContributionExists_(mid)) { out.already++; continue; }
    var who = by.email[from];
    // A CORRECTION IS A THREAD TOO, AND THIS GATE COULD NOT SEE IT.
    if (!commInboundOpenIntents_(who.key).length) {
      if (repairRows === null) repairRows = commInboundRepairRows_();
      if (!commInboundRepairsFor_(who.key, repairRows).length) { out.no_thread++; continue; }
      out.corrections++;
    }
    try {
      var r = commInboundCapture_({
        channel: 'email', message_id: mid, from: from, to: String(t.to || ''),
        text: String(t.snippet || ''), at: String(t.date || new Date().toISOString()),
        thread_id: '', source: 'mailbox'
      });
      if (r && r.ok && !r.already) out.captured++;
    } catch (eC) {
      try { hubSysLog_('asa-hub:comm', 'comm_mail_failed', mid + ': ' + String((eC && eC.message) || eC), { status: 500 }); }
      catch (eL) { /* the next pass retries it */ }
    }
  }
  try {
    if (out.captured) {
      hubSysLog_('asa-hub:comm', 'comm_mail_swept',
                 out.captured + ' repl(y|ies) read of ' + out.mine + ' from people we know · ' +
                 out.already + ' seen before · ' + out.no_thread + ' with nothing open' +
                 (out.corrections ? ' · ' + out.corrections + ' answering a correction' : '') +
                 (out.tester ? ' · ' + out.tester + ' from a tester (test mode)' : ''), { status: 200 });
    }
  } catch (eL2) { /* recorded either way */ }
  return { status: 200, data: out };
}

/** The bare address out of whatever the header carried. */
function commMailAddress_(v) {
  var s = String(v || '').trim();
  var m = /<([^>]+)>/.exec(s);
  if (m) s = m[1];
  s = s.toLowerCase().trim();
  return s.indexOf('@') === -1 ? '' : s;
}

/** The last four digits, for a trail that names nobody's number. */
function commMask_(v) {
  var s = String(v || '');
  return s.length > 4 ? '•••' + s.slice(-4) : s;
}

// WHAT THEY SAID ABOUT BEING CONTACTED — asked of the PLATFORM'S vocabulary, whole-message, never of a second one…
function commInboundIntent_(text) {
  var heard = '';
  /* The try is cheap insurance, not a guard: optOutIntent_ is a plain
     declaration in one global scope and its only config read is already
     wrapped, so today it cannot be missing and cannot throw. If that ever
     stops being true the shipped words below answer alone. */
  if (typeof optOutIntent_ === 'function') {
    try { heard = String(optOutIntent_(text) || ''); } catch (e) { heard = ''; }
  }
  if (heard && heard !== 'reply') return heard;
  var shipped = commInboundIntentFloor_(text);
  if (shipped === 'opt-out') return 'opt-out';
  return heard || shipped;
}

// THE SHIPPED BRAKE, asked on every reply the configured vocabulary read as ordinary — and asked of the platform's…
function commInboundIntentFloor_(text) {
  var s = String(text || '').toLowerCase().replace(/[^a-zà-ú0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  var has = function (shipped) {
    if (typeof shipped !== 'string') return false;
    return shipped.split(/[,;\n]+/)
      .map(function (p) { return String(p).trim().toLowerCase(); })
      .filter(String).indexOf(s) !== -1;
  };
  if (has(typeof OPT_OUT_PHRASES_SHIPPED !== 'undefined' ? OPT_OUT_PHRASES_SHIPPED : null)) return 'opt-out';
  if (has(typeof OPT_IN_PHRASES_SHIPPED !== 'undefined' ? OPT_IN_PHRASES_SHIPPED : null)) return 'opt-in';
  if (has(typeof WRONG_NUMBER_PHRASES_SHIPPED !== 'undefined' ? WRONG_NUMBER_PHRASES_SHIPPED : null)) return 'wrong-number';
  return 'reply';
}

/** STOP / PARE / UNSUBSCRIBE — the one question the door and the self-test ask. */
function commInboundIsStop_(text) {
  return commInboundIntent_(text) === 'opt-out';
}

/** Who wrote: the People house by phone or address. */
function commInboundPerson_(m) {
  var by = (typeof commRecordPeopleByContact_ === 'function') ? commRecordPeopleByContact_() : { phone: {}, email: {} };
  if (String(m.channel) === 'email') {
    var e = String(m.from || '').trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, '$1');
    return by.email[e] || null;
  }
  var d = String(m.from || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? (by.phone[d] || null) : null;
}

/** This person's threads still asking, with their open bindings attached. */
function commInboundOpenIntents_(personKey) {
  var who = String(personKey || '').trim().toLowerCase();
  var intents = [];
  try {
    intents = commBoardRows_(COMM_INTENTS_HOUSE).filter(function (r) {
      return String(r.person_key || '').trim().toLowerCase() === who &&
             ['asking', 'planned'].indexOf(String(r.state || '')) !== -1;
    });
  } catch (e) { intents = []; }
  if (!intents.length) return [];
  var bindings = {};
  try {
    commBoardRows_(COMM_BINDINGS_HOUSE).forEach(function (b) {
      var k = String(b.intent_key || '');
      if (!bindings[k]) bindings[k] = [];
      bindings[k].push(b);
    });
  } catch (e2) {}
  intents.forEach(function (i) { i.bindings = bindings[String(i.intent_key || '')] || []; });
  return intents;
}

/** What the estate says today about each of this person's obligations. */
function commInboundEstate_(personKey) {
  var who = String(personKey || '').trim().toLowerCase();
  var out = {};
  try {
    commRecordMatrix_().forEach(function (r) {
      if (String(r.person_key || '').trim().toLowerCase() !== who) return;
      out[who + '|' + String(r.req_id || '')] = { state: String(r.state || ''), expires: String(r.expires || '') };
    });
  } catch (e) {}
  return out;
}

function commCorrelate_(message, open) {
  var text = String((message && message.text) || '');
  var list = (open || []).filter(function (i) {
    return i && String(i.state || '') !== 'answered' && String(i.state || '') !== 'stopped';
  });
  if (!list.length) return { intent: null, how: 'none', why: 'nothing was open for this person' };

  /* 1 — THE TOKEN. Proof, not inference. */
  var m = COMM_TOKEN_RE.exec(text.toUpperCase());
  if (m) {
    var token = m[1];
    for (var i = 0; i < list.length; i++) {
      if (commReplyToken_(list[i].intent_key) === token) {
        return { intent: list[i], how: 'token', why: 'the reply quoted ' + token };
      }
    }
    // A token we do not recognise is NOT a licence to fall through and guess.
    return { intent: null, how: 'unknown-token',
             why: 'the reply quoted ' + token + ', which matches no open intent' };
  }

  /* 2 — THE PROVIDER'S OWN THREAD. */
  var thread = String((message && message.thread_id) || '');
  if (thread) {
    var byThread = list.filter(function (i) { return String(i.thread_id || '') === thread; });
    if (byThread.length === 1) {
      return { intent: byThread[0], how: 'thread', why: 'the provider threaded it' };
    }
  }

  /* 3 — EXACTLY ONE, OR NOTHING. */
  if (list.length === 1) {
    return { intent: list[0], how: 'sole-open',
             why: 'exactly one intent was open for this person' };
  }
  return { intent: null, how: 'ambiguous',
           why: list.length + ' intents are open for this person — ' +
                'which one this answers cannot be known, and guessing would ' +
                'advance an obligation nobody answered' };
}

// ------------------------------------------------------------------ TEST MODE THAT TEACHES — the rehearsal, read…

// IS THIS SENDER A TESTER?
function commInboundTester_(from, channel) {
  if (!commTestMode_()) return false;
  var redir = null;
  try { redir = (typeof hubTestRedirect_ === 'function') ? hubTestRedirect_() : null; } catch (e) { redir = null; }
  if (!redir) return false;
  var s = String(from || '').trim().toLowerCase();
  if (!s) return false;
  if (s.indexOf('@') === -1 || String(channel || '') === 'sms') {
    var d = s.replace(/\D/g, '').slice(-10);
    if (!d || d.length < 10) return false;
    return (redir.sms || []).some(function (n) { return String(n).replace(/\D/g, '').slice(-10) === d; });
  }
  var addr = commMailAddress_(s) || s;
  return (redir.emails || []).some(function (e) { return String(e).trim().toLowerCase() === addr; });
}

// EVERY REFERENCE IN THE BODY, distinct, in the order they appear.
function commInboundTokens_(text) {
  var s = String(text || '').toUpperCase();
  var out = [], m;
  COMM_TOKEN_SCAN_RE.lastIndex = 0;
  while ((m = COMM_TOKEN_SCAN_RE.exec(s)) !== null) {
    if (out.indexOf(m[0]) === -1) out.push(m[0]);
    if (out.length >= 8) break;
    if (COMM_TOKEN_SCAN_RE.lastIndex === m.index) COMM_TOKEN_SCAN_RE.lastIndex++;   // never spin on a zero-width match
  }
  COMM_TOKEN_SCAN_RE.lastIndex = 0;
  return out;
}

// WHAT THE PERSON ACTUALLY TYPED — everything above the quoted original.
function commInboundSaid_(text) {
  var lines = String(text || '').split(/\r?\n/);
  var kept = [];
  for (var i = 0; i < lines.length; i++) {
    if (COMM_QUOTE_RE.test(lines[i])) break;
    kept.push(lines[i]);
  }
  return kept.join('\n').trim();
}

// OUR OWN MESSAGE, READ BACK.
function commInboundOurEcho_(text) {
  var top = commInboundSaid_(text);
  if (!top) return /^\s*\[TEST\b/i.test(String(text || ''));
  return /^\s*\[TEST\b/i.test(top);
}

// THE THREAD A REFERENCE NAMES — across everybody, because the sender's own identity says nothing in test mode.
function commInboundTokenThread_(token) {
  var want = String(token || '').toUpperCase();
  if (!want) return null;
  var rows = [];
  try {
    rows = commBoardRows_(COMM_INTENTS_HOUSE).filter(function (r) {
      return ['asking', 'planned'].indexOf(String(r.state || '')) !== -1 &&
             String(r.intent_key || '') &&
             commReplyToken_(String(r.intent_key || '')) === want;
    });
  } catch (e) { rows = []; }
  if (rows.length !== 1) return { intent: null, found: rows.length };
  var key = String(rows[0].intent_key || '');
  var person = { key: String(rows[0].person_key || ''), name: String(rows[0].person_name || '') };
  // The bindings are attached by the reader the production path uses, so a rehearsed thread has exactly the shape a…
  var full = commInboundOpenIntents_(person.key).filter(function (i) {
    return String(i.intent_key || '') === key;
  })[0] || null;
  return { intent: full, found: rows.length, person: person };
}

// ONE REHEARSAL ROW, wearing the marks that keep it out of somebody's record.
function commInboundRehearsalRow_(m, corr, contribution, state, reason, nowIso, extra) {
  var c = corr || { intent: null, how: 'own-line', why: '' };
  var row = commContributionRow_(m, null, c, contribution, null, state, reason, nowIso);
  row.test_mode = 'yes';
  row.claims = '';
  row.settled_now = '';
  row.awaiting = '';
  row.would_settle = String((extra && extra.would_settle) || '');
  row.would_await = String((extra && extra.would_await) || '');
  row.why = COMM_REHEARSAL_MARK + String(row.why || '');
  return row;
}

// THE REHEARSED CAPTURE.
function commInboundRehearse_(m, mid, nowIso) {
  if (!commTestMode_()) return null;                       // (5) the gate, asked again at the door
  var text = String(m.text || '');
  var masked = commMask_(m.from);

  if (commInboundOurEcho_(text)) {
    commContributionSave_(commInboundRehearsalRow_(m, null,
      { kind: 'unclear', claims: [],
        why: 'the test banner opens this message, so it is one of OUR redirected messages read back ' +
             'from the tester\'s own mailbox — not an answer to it' },
      'dismissed', 'ambiguous', nowIso, null));
    return { ok: true, matched: false, own_line: true, rehearsal: false, echo: true };
  }

  var tokens = commInboundTokens_(text);
  if (!tokens.length) return null;                         // the caller keeps today's behaviour

  if (tokens.length > 1) {
    commContributionSave_(commInboundRehearsalRow_(m, null,
      { kind: 'unclear', claims: [],
        why: 'the body carries ' + tokens.length + ' references (' + tokens.join(', ') + ') — which thread ' +
             'this answers is not knowable, and the first one is a guess' },
      'dismissed', 'ambiguous', nowIso, null));
    commObserve_('unmatched', { person_key: '', person_name: '', intent_key: '' },
                 { channel: m.channel, from: masked, test_mode: 'yes', tokens: tokens.join(' · ') },
                 'inbound', 'the tester line');
    return { ok: true, matched: false, own_line: true, rehearsal: true, correlated: false, reason: 'ambiguous' };
  }

  var found = commInboundTokenThread_(tokens[0]);
  if (!found || !found.intent) {
    // THE REFERENCE MAY NAME A CORRECTION RATHER THAN A QUESTION, and that is the half of the lane the tester line…
    var rep = commInboundRepairThread_(tokens[0], '');
    if (rep) {
      var rSaid = commInboundSaid_(text);
      var rHeard = commCorrectionRead_(rSaid);
      var rAck = commAckRead_(rSaid);
      var rWould = rHeard.kind
        ? 'read this as a further correction (' + rHeard.kind + ') and put it in front of a person'
        : (rAck.ack ? 'CLOSED the correction on their acknowledgement ("' + rAck.read_as + '")'
                    : 'put it in front of a person, because ' + rAck.why);
      var rCorr = { intent: { intent_key: rep.intent_key, person_key: rep.person_key,
                              person_name: rep.person_name },
                    how: 'token',
                    why: 'the tester quoted ' + tokens[0] + ' — the reference the correction went out with' };
      var rRow = commInboundRehearsalRow_(m, rCorr,
        { kind: rAck.ack ? 'ack' : 'ack-refused', claims: [],
          why: 'the machinery would have ' + rWould }, 'needs_human', 'unclear', nowIso, null);
      rRow.repair_incident = String(rep.incident_id || '');
      rRow.correction_kind = String(rHeard.kind || '');
      rRow.why += ' · it closed nothing, enrolled nobody and left the correction exactly as open as ' +
                  'it found it, because the tester answered and the person did not';
      commContributionSave_(rRow);
      commObserve_('correlated', rCorr.intent,
                   { how: 'token', why: rCorr.why, message_id: mid, from: masked,
                     incident: rep.incident_id, test_mode: 'yes', rehearsal: true },
                   'inbound', 'the tester line');
      commObserve_('needs_human', rCorr.intent,
                   { reason: 'rehearsal', incident: rep.incident_id, contribution: rRow.id,
                     test_mode: 'yes', rehearsal: true }, 'inbound', 'the tester line');
      return { ok: true, matched: false, own_line: true, rehearsal: true, correlated: true,
               how: 'token', incident: rep.incident_id, would_close: !!rAck.ack,
               state: 'needs_human', contribution: rRow.id };
    }
    commContributionSave_(commInboundRehearsalRow_(m, null,
      { kind: 'unclear', claims: [],
        why: 'the reply quoted ' + tokens[0] + ', which matches ' +
             (found && found.found > 1 ? found.found + ' open threads' : 'no open thread') +
             ' and no correction either' },
      'dismissed', 'ambiguous', nowIso, null));
    return { ok: true, matched: false, own_line: true, rehearsal: true, correlated: false, reason: 'ambiguous' };
  }

  var intent = found.intent, person = found.person;
  var said = commInboundSaid_(text);                       // (3) meaning from the top, reference from the whole
  var labelFor = function (id) {
    // The catalogue's one door (Certs.gs) — config first, shipped floor behind.
    return (typeof certLabels_ === 'function' && certLabels_()[id]) ? certLabels_()[id] : '';
  };
  var corr = { intent: intent, how: 'token',
               why: 'the tester quoted ' + tokens[0] + ' — the reference this thread went out with' };
  commObserve_('correlated', intent,
               { how: 'token', why: corr.why, message_id: mid, from: masked,
                 test_mode: 'yes', rehearsal: true }, 'inbound', 'the tester line');

  // A REHEARSED WINDOW ANSWER IS READ AND STORED NOWHERE, on the same law as (2) above: the reading is what is…
  if (commStatedIsWindowThread_(intent)) {
    var wClaim = commStatedWindowRead_(said);
    var wWould = wClaim.confident
      ? (wClaim.kind + ' ' + (wClaim.from || '(open)') + '-' + (wClaim.to || '(open)') +
         (wClaim.days ? ' on ' + wClaim.days : ''))
      : '';
    var wRow = commInboundRehearsalRow_(m, corr,
      { kind: wClaim.confident ? 'window' : 'window-unread', claims: [],
        why: (wClaim.confident ? 'the machinery would have stored ' + wWould : 'unreadable as hours') +
             ' — ' + wClaim.why },
      'needs_human', 'unclear', nowIso, { would_settle: '', would_await: '' });
    wRow.window_read_as = String(wClaim.read_as || '');
    wRow.window_from = String(wClaim.from || '');
    wRow.window_to = String(wClaim.to || '');
    wRow.window_days = String(wClaim.days || '');
    wRow.window_stored = 'no';
    wRow.would_store = wWould;
    wRow.why += ' · it stored nothing and the thread stays open, because the tester answered and ' +
                'the person did not';
    commContributionSave_(wRow);
    commObserve_('contribution', intent,
                 { kind: wRow.kind, claims: 0, would_store: wWould, state: 'needs_human',
                   contribution: wRow.id, test_mode: 'yes', rehearsal: true },
                 'inbound', 'the tester line');
    commObserve_('needs_human', intent,
                 { reason: 'rehearsal', contribution: wRow.id, test_mode: 'yes', rehearsal: true },
                 'inbound', 'the tester line');
    return { ok: true, matched: false, own_line: true, rehearsal: true, correlated: true,
             how: 'token', intent_key: String(intent.intent_key || ''), person_key: person.key,
             kind: wRow.kind, would_store: wWould, stored: false,
             state: 'needs_human', contribution: wRow.id };
  }

  var contribution = commContribution_(said, intent, labelFor);
  var estate = commInboundEstate_(person.key);
  var qualified = commQualify_(intent, contribution, function (demandId) {
    return estate[String(demandId || '')] || { state: 'unknown' };
  });

  /* THE SAME ARITHMETIC THE PRODUCTION PATH DOES, AND NOT ONE WRITE OF IT. */
  var wouldSettle = [], wouldAwait = [];
  (qualified.results || []).forEach(function (r) {
    var b = (intent.bindings || []).filter(function (x) { return String(x.demand_id) === String(r.demand_id); })[0];
    if (!b) return;
    if (r.settle) wouldSettle.push(String(r.demand_id));
    else if (r.verdict === 'disagrees' || r.verdict === 'unknown') wouldAwait.push(String(r.demand_id));
  });

  // A CONSENT WORD IS NEWS, NOT AN INSTRUCTION — recorded on the row, acted on nowhere.
  var consent = commInboundIntent_(said);
  var consentNote = (consent && consent !== 'reply')
    ? ' · the tester said "' + consent + '", recorded and NOT acted on: the address it would suppress is ' +
      'where every message on the platform is redirected'
    : '';

  // A CORRECTION IS NEWS HERE TOO, AND NEWS IS ALL IT IS.
  var heardNote = '';
  var rehearsedHeard = commCorrectionRead_(said);
  if (rehearsedHeard.kind) {
    heardNote = ' · the tester\'s words read as a correction (' + rehearsedHeard.kind + '): ' +
                rehearsedHeard.why + '. In production this would owe that person a correction; ' +
                'here it enrolled nobody and wrote no incident';
  }

  var reason = commDeskReason_(corr, contribution, qualified, 0) || '';
  var row = commInboundRehearsalRow_(m, corr, contribution, 'needs_human', reason, nowIso,
                                     { would_settle: wouldSettle.join(' · '), would_await: wouldAwait.join(' · ') });
  // (1) IT GOES TO A PERSON, WHICH IS THE POINT — the last link of the chain proven — and it goes there saying what…
  row.why += ' · the machinery would have settled ' + (wouldSettle.length || 'nothing') +
             ' and sent ' + (wouldAwait.length || 'nothing') + ' to the owner; it did neither, because ' +
             'the tester answered and the person did not' + consentNote + heardNote;
  row.correction_kind = String(rehearsedHeard.kind || '');
  commContributionSave_(row);

  commObserve_('contribution', intent,
               { kind: contribution.kind, claims: (contribution.claims || []).length,
                 would_settle: wouldSettle.length, would_await: wouldAwait.length,
                 state: 'needs_human', contribution: row.id, test_mode: 'yes', rehearsal: true,
                 consent: consent === 'reply' ? '' : consent },
               'inbound', 'the tester line');
  commObserve_('needs_human', intent,
               { reason: reason || 'rehearsal', contribution: row.id, test_mode: 'yes', rehearsal: true },
               'inbound', 'the tester line');

  // NOTHING IS WRITTEN TO comm_intents OR comm_bindings HERE, and the absence is the feature (1): no `state`, no…
  return { ok: true, matched: false, own_line: true, rehearsal: true, correlated: true,
           how: 'token', intent_key: String(intent.intent_key || ''), person_key: person.key,
           kind: contribution.kind, would_settle: wouldSettle.length, would_await: wouldAwait.length,
           state: 'needs_human', contribution: row.id };
}

// ------------------------------------------------------------------ THE HEARING — what somebody typed, turned into…

// "Any time is fine" — a REAL ANSWER, and the one most easily confused with silence.
var COMM_STATED_ANYTIME = ['anytime', 'any time', 'anytime is fine', 'any time is fine',
  'anytime works', 'any time works', 'anytime is good', 'any time is good', 'all day',
  'whenever', 'whenever is fine', 'whenever works', 'whenever you like', 'whenever you want',
  'no preference', 'doesnt matter', 'does not matter', 'dont mind', 'do not mind', 'im flexible',
  'i am flexible', 'flexible', 'qualquer hora', 'qualquer horario', 'a qualquer hora',
  'tanto faz', 'nao importa', 'quando quiser'];

// Parts of the day, which are answers but not hours.
var COMM_STATED_VAGUE = ['morning', 'mornings', 'afternoon', 'afternoons', 'evening', 'evenings',
  'night', 'nights', 'nighttime', 'daytime', 'early', 'late', 'lunch', 'lunchtime',
  'after work', 'before work', 'after my shift', 'before my shift', 'during my shift',
  'off hours', 'business hours', 'work hours', 'manha', 'de manha', 'tarde', 'de tarde',
  'noite', 'a noite', 'horario comercial'];

// An answer that names a ROUTE rather than an hour.
var COMM_STATED_CHANNEL_RE = /\b(e-?mails?|texts?|texting|sms|call|calls|phone|ligar|ligue|whats ?app|mensagem|mensagens)\b/;

// An answer shaped like a refusal that the PLATFORM'S OWN stop words did not hear.
var COMM_STATED_REFUSAL_RE = /\b(?:dont|do not|no|never|nao|nunca)\s+(?:me|us|nos|lhe|my|our)?\s*(?:text|txt|message|msg|e-?mail|call|contact|bother|reach|mande|manda|envie|ligue|ligar)\b/;

// A range, either end optionally carrying its own marker.
var COMM_STATED_RANGE_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p|h)?(?![a-z0-9])\s*(?:-|to\b|until\b|till\b|thru\b|as\b|ate\b)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p|h)?(?![a-z0-9])/g;

// One open end.
var COMM_STATED_AFTER_RE = /\b(?:after|from|starting|a partir d[ae]s?|apos|depois d[ae]s?|depois)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p|h)?(?![a-z0-9])/;
var COMM_STATED_BEFORE_RE = /\b(?:before|until|till|by|up to|no later than|antes d[ae]s?|antes|ate as|ate)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p|h)?(?![a-z0-9])/;

// Shorter than this and whole-hour arithmetic cannot hold it — the planner compares hours (commWindowVerdict_), so…
var COMM_STATED_MIN_MINUTES = 60;

// How far a range may be stretched by the ONE inference this reader makes — that a range runs forward from its…
var COMM_STATED_MAX_INFERRED_HOURS = 14;

/** One shape, so every reader of a window claim reads the same fields. */
function commStatedClaim_(kind, from, to, days, confident, readAs, why) {
  return { kind: String(kind || 'unclear'), from: String(from || ''), to: String(to || ''),
           days: String(days || ''), confident: !!confident,
           read_as: String(readAs || ''), why: String(why || ''), channel_named: false };
}

/** Minutes since midnight → 'HH:MM'. */
function commStatedClockText_(min) {
  var m = ((Number(min) % 1440) + 1440) % 1440;
  var h = Math.floor(m / 60), mi = m % 60;
  return (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
}

// ONE TIME OFF ONE TOKEN, and whether it says so for itself.
function commStatedClock_(hour, minute, marker) {
  var h = Number(hour), mi = Number(minute || 0);
  if (isNaN(h) || isNaN(mi) || mi > 59 || h > 24) return null;
  var mk = String(marker || '').trim();
  if (mk === 'a' || mk === 'am') {
    if (h < 1 || h > 12) return null;
    return { min: (h % 12) * 60 + mi, explicit: true, meridiem: true, h12: h % 12 };
  }
  if (mk === 'p' || mk === 'pm') {
    if (h < 1 || h > 12) return null;
    return { min: ((h % 12) + 12) * 60 + mi, explicit: true, meridiem: true, h12: h % 12 };
  }
  if (mk === 'h' || h >= 13 || h === 0) {
    if (h > 23) return null;
    return { min: h * 60 + mi, explicit: true, meridiem: false, h12: h % 12 };
  }
  return { min: h * 60 + mi, explicit: false, meridiem: false, h12: h % 12 };
}

// THE DAYS SOMEBODY NAMED, and the sentence with those words taken out.
var COMM_STATED_WEEKDAY_RE = /\b(not weekends?|no weekends?|except weekends?|weekdays?|week days|during the week|mon(?:day)?\s*(?:-|to|thru|through)?\s*fri(?:day)?|dias uteis|durante a semana|nao no fim de semana)\b/;
// QUALIFIED ON PURPOSE.
var COMM_STATED_WEEKEND_RE = /\b(weekends? only|only (?:on )?weekends?|sat(?:urday)?\s*(?:,|\/|and|&|-)\s*sun(?:day)?|apenas (?:no )?fim de semana|so (?:no )?fim de semana|somente (?:no )?fim de semana)\b/;
var COMM_STATED_WEEKEND_WHOLE = ['weekend', 'weekends', 'on weekends', 'on the weekend',
  'fim de semana', 'fins de semana', 'fds'];

function commStatedDays_(s) {
  var t = String(s || '').trim();
  var flat = t.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  var days = '', hit = '';
  // The weekday readings are asked FIRST: "not weekends" contains "weekends", and a store that read it as "weekends…
  var mw = COMM_STATED_WEEKDAY_RE.exec(' ' + t + ' ');
  if (mw) { days = 'mon-fri'; hit = mw[0]; }
  else {
    var me = COMM_STATED_WEEKEND_RE.exec(' ' + t + ' ');
    if (me) { days = 'sat,sun'; hit = me[0]; }
    else if (COMM_STATED_WEEKEND_WHOLE.indexOf(flat) !== -1) { days = 'sat,sun'; hit = flat; }
  }
  // The leftover is measured on the FLATTENED sentence, so "mon-fri" and "mon fri" leave the same nothing behind…
  var hitFlat = String(hit).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  var rest = hitFlat ? (' ' + flat + ' ').split(hitFlat).join(' ') : flat;
  rest = rest.replace(/\s+/g, ' ').trim();
  return { days: days, rest: rest, said: String(hit).trim() };
}

// The sentence, flattened so one vocabulary can be asked of it: accents folded (so 'manhã' and 'manha' are one word…
function commStatedNormalise_(text) {
  var s = String(text || '').slice(0, 300).toLowerCase();
  s = s.replace(/[‐-―−]/g, '-');
  // Apostrophes are DELETED, never blanked.
  s = s.replace(/['‘’ʼ`]/g, '');
  s = s.replace(/[àáâãä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[íìîï]/g, 'i')
       .replace(/[óòôõö]/g, 'o').replace(/[úùûü]/g, 'u').replace(/ç/g, 'c');
  s = s.replace(/a\s*\.\s*m\s*\.?/g, 'am').replace(/p\s*\.\s*m\s*\.?/g, 'pm');
  s = s.replace(/\bo'?clock\b/g, '').replace(/\bhrs?\b/g, 'h');
  s = s.replace(/\b(noon|midday|meio-?\s?dia)\b/g, '12pm')
       .replace(/\b(midnight|meia-?\s?noite)\b/g, '12am');
  // "not before 10" is a statement about when to START, not when to stop, and a reader that let `before` match it…
  s = s.replace(/\bnot before\b/g, 'after').replace(/\bnao antes d[ae]s?\b/g, 'after')
       .replace(/\bnao antes\b/g, 'after')
       .replace(/\bnot after\b/g, 'before').replace(/\bnao depois d[ae]s?\b/g, 'before')
       .replace(/\bnao depois\b/g, 'before');
  return s.replace(/\s+/g, ' ').trim();
}

// A TWO-ENDED RANGE, or a refusal that says which rule refused it.
function commStatedRange_(s) {
  var found = [];
  COMM_STATED_RANGE_RE.lastIndex = 0;
  var m;
  while ((m = COMM_STATED_RANGE_RE.exec(s)) !== null) {
    found.push(m);
    if (found.length >= 4) break;
    if (COMM_STATED_RANGE_RE.lastIndex === m.index) COMM_STATED_RANGE_RE.lastIndex++;
  }
  COMM_STATED_RANGE_RE.lastIndex = 0;
  if (!found.length) return { ok: false, why: '' };
  if (found.length > 1) {
    return { ok: false, why: 'the reply holds ' + found.length + ' separate ranges, and one row ' +
                             'can carry one window — which one governs is theirs to say, not ours' };
  }
  m = found[0];
  var a = commStatedClock_(m[1], m[2], m[3]);
  var b = commStatedClock_(m[4], m[5], m[6]);
  if (!a || !b) {
    return { ok: false, why: '"' + m[0].trim() + '" is not a pair of clock times' };
  }
  var inferred = '';

  if (!a.explicit && b.explicit) {
    if (b.meridiem) {
      // ONE MARKER, SHARED — and only when the ends ascend under it.
      var shared = commStatedClock_(m[1], m[2], m[6]);
      if (!shared || shared.min >= b.min) {
        return { ok: false, why: '"' + m[0].trim() + '" carries one marker and the ends do not ' +
                                 'ascend under it, so which half of the day each end belongs to is a guess' };
      }
      a = shared;
    } else {
      a = commStatedClock_(m[1], m[2], 'h');                 // a 24-hour context, read on the same clock
      if (!a) return { ok: false, why: '"' + m[0].trim() + '" is not a pair of clock times' };
    }
  } else if (a.explicit && !b.explicit) {
    // FORWARD FROM A KNOWN START.
    var first = a.min, cand = b.min, alt = (b.min + 720) % 1440;
    var spanA = ((cand - first) + 1440) % 1440, spanB = ((alt - first) + 1440) % 1440;
    var pick = (spanA > 0 && spanA <= spanB) ? cand : alt;
    b = { min: pick, explicit: true, meridiem: true, h12: 0 };
    inferred = 'the end had no marker and a range runs forward from its start';
  } else if (!a.explicit && !b.explicit) {
    return { ok: false, why: '"' + m[0].trim() + '" carries no am/pm anywhere. The six next shifts ' +
                             'on this platform all start at 22:00, so a bare range from somebody ' +
                             'here is as likely to be the night half of the day as the day half — ' +
                             'and there is no tie-break that is not a guess about their life' };
  }

  var span = ((b.min - a.min) + 1440) % 1440;
  if (span === 0) {
    return { ok: false, why: '"' + m[0].trim() + '" begins and ends at the same time' };
  }
  if (span < COMM_STATED_MIN_MINUTES) {
    return { ok: false, why: '"' + m[0].trim() + '" is ' + span + ' minutes wide, and the planner ' +
                             'compares whole hours — honouring it would mean widening it, which is ' +
                             'the one direction a stated window must never be moved' };
  }
  if (inferred && span > COMM_STATED_MAX_INFERRED_HOURS * 60) {
    return { ok: false, why: '"' + m[0].trim() + '" only reads as a ' + Math.round(span / 60) +
                             '-hour window, which means the end was read on the wrong half of the day' };
  }
  return { ok: true, from: commStatedClockText_(a.min), to: commStatedClockText_(b.min),
           inferred: inferred,
           read_as: commStatedClockText_(a.min) + ' to ' + commStatedClockText_(b.min) +
                    (inferred ? ' (' + inferred + ')' : '') };
}

// WHAT A PERSON SAID ABOUT THEIR HOURS — a claim, or an honest refusal.
function commStatedWindowRead_(said) {
  var raw = String(said || '').trim();
  if (!raw) {
    return commStatedClaim_('unclear', '', '', '', false, '',
      'nothing above the quoted original — they sent back our own letter and typed nothing');
  }
  var s = commStatedNormalise_(raw);
  var plain = s.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  // A REFUSAL IS NOT A WINDOW, AND THIS EAR DOES NOT BRAKE.
  if (COMM_STATED_REFUSAL_RE.test(plain)) {
    return commStatedClaim_('unclear', '', '', '', false, 'reads as a refusal',
      'this reads as a refusal, and the platform\'s own stop words did not match it — so NOTHING ' +
      'was suppressed and nothing was stored. A person decides whether they meant stop, or meant ' +
      '"not by text", or were narrowing an hour');
  }

  var d = commStatedDays_(s);                 // the normalised sentence, hyphens intact: "mon-fri"
  var range = commStatedRange_(s);
  var claim = null;

  if (range.ok) {
    claim = commStatedClaim_('window', range.from, range.to, d.days, true,
      range.read_as + (d.days ? ' on ' + d.days : ''),
      'an explicit range' + (range.inferred ? ' — ' + range.inferred : '') +
      (d.days ? ', and they named the days' : ''));
  } else if (range.why) {
    return commStatedClaim_('unclear', '', '', '', false, 'a range this reader will not guess at', range.why);
  }

  if (!claim) {
    // ONE OPEN END, and the other end deliberately left empty — see the header.
    var af = COMM_STATED_AFTER_RE.exec(s);
    var bf = COMM_STATED_BEFORE_RE.exec(s);
    var bare = (af && !af[3] && Number(af[1]) < 13) ? af[0] : ((bf && !bf[3] && Number(bf[1]) < 13) ? bf[0] : '');
    if (bare) {
      return commStatedClaim_('unclear', '', '', d.days, false, 'an hour with no am or pm',
        '"' + bare.trim() + '" names one edge and no half of the day. The six next shifts on this ' +
        'platform all start at 22:00, so "' + String(af && !af[3] ? af[1] : bf[1]) + '" here is as ' +
        'likely to be the evening as the morning — and with no second end to read it against there ' +
        'is nothing to break the tie but a guess about their life');
    }
    var from = '', to = '';
    if (af) { var ca = commStatedClock_(af[1], af[2], af[3]); if (ca && ca.explicit) from = commStatedClockText_(ca.min); }
    if (bf) { var cb = commStatedClock_(bf[1], bf[2], bf[3]); if (cb && cb.explicit) to = commStatedClockText_(cb.min); }
    if (from && to) {
      var sp = ((commStatedMinutes_(to) - commStatedMinutes_(from)) + 1440) % 1440;
      if (sp < COMM_STATED_MIN_MINUTES) {
        return commStatedClaim_('unclear', '', '', '', false, 'a window narrower than an hour',
          'they named both edges and they are ' + sp + ' minutes apart; the planner compares whole ' +
          'hours and widening somebody\'s stated window is the one direction it must never move');
      }
    }
    if (from || to) {
      claim = commStatedClaim_('window', from, to, d.days, true,
        (from ? 'from ' + from : 'any time') + (to ? ' until ' + to : ' onwards') +
        (d.days ? ' on ' + d.days : ''),
        'they stated ' + (from && to ? 'both edges' : 'one edge') +
        (from && to ? '' : ' — the other is left EMPTY on purpose, because they said nothing about ' +
                           'it and the platform\'s own hours still decide it') +
        (d.days ? ', and they named the days' : ''));
    }
  }

  if (!claim) {
    /* A DAY RESTRICTION WITH NO HOURS IS STILL A RESTRICTION THEY STATED. */
    if (d.days && (!d.rest || d.rest.length <= 4)) {
      claim = commStatedClaim_('days', '', '', d.days, true, d.days,
        'they restricted the days and said nothing about hours — so the hours are left to the ' +
        'platform, which is exactly as much as they told us');
    }
  }

  if (!claim) {
    // "ANY TIME IS FINE" IS AN ANSWER.
    var bare = (d.rest || plain).replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (COMM_STATED_ANYTIME.indexOf(bare) !== -1) {
      claim = commStatedClaim_('anytime', '', '', d.days, true,
        'any time is fine' + (d.days ? ' on ' + d.days : ''),
        'they told us they have no restriction. It narrows nothing — being easy-going is not a ' +
        'request to be texted at three in the morning — and the platform\'s own hours still stand. ' +
        'What it does end is the asking');
    }
  }

  if (!claim) {
    var vague = '';
    for (var i = 0; i < COMM_STATED_VAGUE.length; i++) {
      if ((' ' + plain + ' ').indexOf(' ' + COMM_STATED_VAGUE[i] + ' ') !== -1) {
        vague = COMM_STATED_VAGUE[i]; break;
      }
    }
    if (vague) {
      claim = commStatedClaim_('unclear', '', '', d.days, false, '"' + vague + '"',
        '"' + vague + '" is an answer but it is not an hour — it is one time to one person and ' +
        'another to the next, and a clock invented for them would be ours, not theirs');
    }
  }

  if (!claim) {
    claim = commStatedClaim_('unclear', '', '', d.days, false, '',
      'nothing in this reply reads as a clock time with enough certainty to store on somebody\'s row');
  }

  // A CHANNEL IS RECORDED, NEVER ACTED ON.
  claim.channel_named = COMM_STATED_CHANNEL_RE.test(plain);
  return claim;
}

/** 'HH:MM' → minutes. Only ever called on text this file just minted. */
function commStatedMinutes_(hhmm) {
  var s = String(hhmm || '');
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
}

// IS THIS THREAD THE WINDOW QUESTION?
function commStatedIsWindowThread_(intent) {
  if (!intent) return false;
  var want = String((typeof COMM_WINDOW_ASK_PURPOSE !== 'undefined')
    ? COMM_WINDOW_ASK_PURPOSE : 'contact.window').trim().toLowerCase();
  var p = String(intent.purpose || '').trim().toLowerCase();
  if (p) return p === want;
  var key = String(intent.intent_key || '').trim().toLowerCase();
  return key.length > want.length && key.slice(-(want.length + 1)) === '|' + want;
}

// A WINDOW ANSWER, HEARD.
function commStatedWindowHandle_(m, who, corr, intent, nowIso) {
  var mid = String(m.message_id || '');
  var said = commInboundSaid_(String(m.text || ''));      // the top of the body, never our own examples
  var claim = commStatedWindowRead_(said);
  var channel = (String(m.channel) === 'email') ? 'email' : 'sms';
  var source = 'the person, by ' + channel;
  var personKey = String(intent.person_key || (who && who.key) || '');
  var personName = String((who && who.name) || intent.person_name || '');

  var stored = null;
  if (claim.confident) {
    stored = commConsentWindowSave_(personKey, personName, claim, said, source, mid, nowIso);
  }
  var ok = !!(stored && stored.ok);

  var state = 'settled', reason = '';
  var why = claim.why;
  if (!claim.confident) {
    state = 'needs_human'; reason = 'unclear';
    why = 'NOT STORED — ' + why + '. Their own words are on this row, unedited, and what they meant ' +
          'is a person\'s to read';
  } else if (!ok) {
    state = 'needs_human'; reason = 'unclear';
    why = 'READ BUT NOT STORED — we read this as ' + claim.read_as + ', and the consent store did ' +
          'not take it (' + String((stored && stored.why) || 'no answer') + '). Nothing may be ' +
          'treated as on record';
  } else {
    why = 'STORED as ' + claim.read_as + ' — ' + why +
          (stored.superseded ? '. Their earlier answer was superseded, not deleted' : '');
    if (claim.channel_named) {
      state = 'needs_human'; reason = 'unclear';
      why += '. THEY ALSO NAMED A CHANNEL: the hours are on record, the route is not — this lane ' +
             'has a store for hours and none for routes, and changing somebody\'s route on a parse ' +
             'would be the same misread with a louder consequence';
    }
  }

  var contribution = { kind: ok ? 'window' : 'window-unread', claims: [], why: why };
  var row = commContributionRow_(m, who, corr, contribution, null, state, reason, nowIso);
  // EMPTY ON PURPOSE, and it is a safety interlock rather than tidiness: HUB_ACTIONS.commContributionVerdict…
  row.claims = ''; row.settled_now = ''; row.awaiting = '';
  row.window_read_as = String(claim.read_as || '');
  row.window_from = String(claim.from || '');
  row.window_to = String(claim.to || '');
  row.window_days = String(claim.days || '');
  row.window_stored = ok ? 'yes' : 'no';
  row.window_row = ok ? String(stored.id || '') : '';
  commContributionSave_(row);

  if (ok) {
    commObserve_('consent_changed', intent,
                 { channel: m.channel, intent: 'window_stated', kind: claim.kind,
                   window_from: claim.from, window_to: claim.to, window_days: claim.days,
                   superseded: (stored.superseded || 0), row: stored.id, contribution: row.id },
                 'inbound', 'the person');
  }
  commObserve_('contribution', intent,
               { kind: contribution.kind, claims: 0, state: state, stored: ok ? 'yes' : 'no',
                 read_as: claim.read_as, contribution: row.id }, 'inbound');
  if (state === 'needs_human') {
    commObserve_('needs_human', intent, { reason: reason, why: why.slice(0, 200), contribution: row.id }, 'inbound');
  }

  // THE ASKING STOPS HERE AND IT STOPS ON A STORED FACT, not on a flag.
  try {
    commRecordUpsert_(COMM_INTENTS_HOUSE, { id: intent.id, state: 'answered', last_reply_at: nowIso,
                                            thread_id: String(m.thread_id || intent.thread_id || '') });
  } catch (eI) { /* the desk row carries the answer either way */ }

  return { ok: true, matched: true, correlated: true, how: corr.how, kind: contribution.kind,
           window: ok ? (claim.from || '(open)') + '-' + (claim.to || '(open)') : '',
           stored: ok, state: state, contribution: row.id };
}

// ------------------------------------------------------------------ THE THIRD WAY IN — the person is the one who…

// WHAT A PERSON CAN TELL US WE GOT WRONG.
var COMM_CORRECTION_KINDS = ['identity', 'sender', 'ask'];

// THE IDENTITY IS WRONG — the person we addressed is not the person reading.
var COMM_CORRECTION_IDENTITY_RE = new RegExp(
  '\\b(thats not my name|that is not my name|not my name|wrong name|wrong person|' +
  'you have the wrong person|got the wrong person|' +
  // "I AM NOT SOMEBODY" IS A CORRECTION; "I'M NOT SURE" IS A CONVERSATION.
  'i(?: a)?m not (?!sure|certain|able|going|free|available|home|working|doing|really|very|too|' +
  'interested|comfortable|happy|ready|at |in |on |the |a )[a-z]{2,}|' +
  'i dont work (there|here|for)|i no longer work|i dont work at|i left (the company|there)|' +
  'i never worked|nao trabalho mais|nunca trabalhei|nao sou (eu|essa|esse)|' +
  'nao e o meu nome|nao e meu nome|nome errado|pessoa errada)\\b');

// THE SENDER IS WRONG — we look like somebody they do not know.
var COMM_CORRECTION_SENDER_RE = new RegExp(
  '\\b(who is this|whos this|who are you|who sent this|what company (is )?(this|that)|' +
  'which company|what is this company|i dont know (this|who|what) |never heard of|' +
  'is this a scam|this is a scam|quem e (voce|isso|essa|voces)|que empresa|qual empresa|' +
  'nao conheco (essa|esta) empresa)\\b');

// THE ASK ITSELF IS WRONG — "you already have it".
var COMM_CORRECTION_ASK_RE = new RegExp(
  '\\b(you already have|already have (my|it|this)|i already sent|i sent (it|that|those|them|this)|' +
  'i sent (it )?(last|on|yesterday)|already sent (it|this|that)|' +
  'ja enviei|ja mandei|voces ja tem|voce ja tem|ja esta (com voces|enviado))\\b');

// The sentence each kind writes on its incident, so the repair board reads in English and not in this file's…
var COMM_CORRECTION_WHAT = {
  identity: 'we addressed the wrong person, or addressed them by a name or an employer that is not theirs',
  sender: 'we reached them under a sender they do not recognise',
  ask: 'we asked them for something they say we already have'
};

// WHAT DID THIS REPLY TELL US WE GOT WRONG?
function commCorrectionRead_(said) {
  var out = { kind: '', also_ask: false, read_as: '', why: '' };
  var raw = String(said || '').trim();
  if (!raw) return out;
  var s = (typeof commStatedNormalise_ === 'function')
    ? commStatedNormalise_(raw) : raw.toLowerCase();
  var plain = ' ' + s.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  var ask = COMM_CORRECTION_ASK_RE.test(plain);
  var ident = COMM_CORRECTION_IDENTITY_RE.exec(plain);
  var sender = ident ? null : COMM_CORRECTION_SENDER_RE.exec(plain);
  if (ident) { out.kind = 'identity'; out.read_as = String(ident[0] || '').trim(); }
  else if (sender) { out.kind = 'sender'; out.read_as = String(sender[0] || '').trim(); }
  else if (ask) { out.kind = 'ask'; out.read_as = 'they say we already have it'; }
  if (!out.kind) return out;
  out.also_ask = ask && out.kind !== 'ask';
  out.why = COMM_CORRECTION_WHAT[out.kind] + ' — they wrote "' + out.read_as + '"' +
            (out.also_ask ? ', and in the same breath a claim about something we asked them for' : '');
  return out;
}

// The incidents ledger, read whole, or nothing.
function commInboundRepairRows_() {
  try {
    if (typeof commRepairRows_ !== 'function') return [];
    return commRepairRows_() || [];
  } catch (e) { return []; }
}

// THE CORRECTIONS ALREADY SAID TO THIS PERSON, newest last — the threads a reply to an apology could possibly…
function commInboundRepairsFor_(personKey, rows) {
  var key = String(personKey || '').trim().toLowerCase();
  if (!key) return [];
  var all = rows || commInboundRepairRows_();
  var incidents = {};
  all.forEach(function (r) {
    if (String(r.kind || '') === 'incident') incidents[String(r.incident_id || '')] = r;
  });
  var out = [];
  all.forEach(function (r) {
    if (String(r.kind || '') !== 'person') return;
    if (String(r.person_key || '').trim().toLowerCase() !== key) return;
    var state = String(r.claim_state || 'planned');
    if (state !== 'repaired' && state !== 'claimed') return;
    var inc = incidents[String(r.incident_id || '')] || {};
    out.push({ id: String(r.id || ''), incident_id: String(r.incident_id || ''),
               intent_key: String(r.intent_key || ''),
               person_key: key, person_name: String(r.person_name || ''),
               claim_state: state, told_at: String(r.told_at || ''),
               told_channel: String(r.told_channel || ''),
               incident_state: String(inc.state || ''), what_was_wrong: String(inc.what_was_wrong || '') });
  });
  out.sort(function (a, b) { return String(a.told_at || '').localeCompare(String(b.told_at || '')); });
  return out;
}

// THE CORRECTION A REFERENCE NAMES — rung one of the ladder, over the incidents ledger instead of the intents house.
function commInboundRepairThread_(token, personKey, rows) {
  var want = String(token || '').toUpperCase();
  if (!want) return null;
  var key = String(personKey || '').trim().toLowerCase();
  var all = rows || commInboundRepairRows_();
  var incidents = {};
  all.forEach(function (r) {
    if (String(r.kind || '') === 'incident') incidents[String(r.incident_id || '')] = r;
  });
  var hit = [];
  all.forEach(function (r) {
    if (String(r.kind || '') !== 'person') return;
    var ik = String(r.intent_key || '');
    if (!ik || commReplyToken_(ik) !== want) return;
    if (key && String(r.person_key || '').trim().toLowerCase() !== key) return;
    hit.push(r);
  });
  if (hit.length !== 1) return null;
  var row = hit[0];
  var inc = incidents[String(row.incident_id || '')] || {};
  return { id: String(row.id || ''), incident_id: String(row.incident_id || ''),
           intent_key: String(row.intent_key || ''),
           person_key: String(row.person_key || '').trim().toLowerCase(),
           person_name: String(row.person_name || ''),
           claim_state: String(row.claim_state || 'planned'),
           told_at: String(row.told_at || ''), told_channel: String(row.told_channel || ''),
           incident_state: String(inc.state || ''), what_was_wrong: String(inc.what_was_wrong || '') };
}

// THE INCIDENT A SELF-REPORT BECOMES — one per person per kind, minted the same way every other incident id is, so…
function commCorrectionIncidentId_(personKey, kind) {
  if (typeof commRepairIncidentId_ !== 'function') return '';
  return commRepairIncidentId_('self.' + String(kind || ''),
                               String(personKey || '').trim().toLowerCase(), '',
                               'reported by the person');
}

// IS A CORRECTION ALREADY OWED TO THIS PERSON, AND IF NOT, OWE THEM ONE.
function commCorrectionOwed_(personKey, personName, kind, said, channel, nowIso) {
  var key = String(personKey || '').trim().toLowerCase();
  var out = { held: '', incident_id: '', incident_state: '', enrolled: false,
              ledger_ok: true, why: '' };
  if (!key || COMM_CORRECTION_KINDS.indexOf(String(kind)) === -1) {
    out.ledger_ok = false;
    out.why = 'no person key to owe a correction to';
    return out;
  }
  var all = commInboundRepairRows_();
  var incidents = {};
  all.forEach(function (r) {
    if (String(r.kind || '') === 'incident') incidents[String(r.incident_id || '')] = r;
  });
  // WORST FIRST.
  var rank = { repaired: 4, claimed: 3, planned: 2, undeliverable: 1 };
  var best = null, bestRank = 0;
  all.forEach(function (r) {
    if (String(r.kind || '') !== 'person') return;
    if (String(r.person_key || '').trim().toLowerCase() !== key) return;
    var state = String(r.claim_state || 'planned');
    var n = rank[state] || 0;
    if (n > bestRank) { bestRank = n; best = r; }
  });
  if (best) {
    out.held = String(best.claim_state || 'planned');
    out.incident_id = String(best.incident_id || '');
    out.incident_state = String((incidents[out.incident_id] || {}).state || '');
    return out;
  }

  // NOTHING IS OWED YET, SO OWE IT.
  var incidentId = commCorrectionIncidentId_(key, kind);
  if (!incidentId || typeof commRepairIncidentRow_ !== 'function' ||
      typeof commRepairPersonRow_ !== 'function' || typeof commRepairUpsert_ !== 'function') {
    out.ledger_ok = false;
    out.why = 'the incidents ledger could not be reached, so nobody was enrolled — a person owes them this';
    return out;
  }
  var quote = String(said || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  try {
    commRepairUpsert_(commRepairIncidentRow_({
      incident_id: incidentId,
      situation: '', window_from: '', window_to: '',
      what_was_wrong: COMM_CORRECTION_WHAT[kind] + ' — in their words: "' + quote + '"',
      state: 'declared', audience: 1,
      declared_by: 'the person themselves, by ' + String(channel || ''),
      declared_at: String(nowIso || ''),
      note: 'reported by the person, not detected: the audience is this one person and the ' +
            'window is blank, so no other audience can be swept into it'
    }, nowIso));
    commRepairUpsert_(commRepairPersonRow_(incidentId,
      { person_key: key, person_name: String(personName || '') }, nowIso));
    out.enrolled = true;
    out.incident_id = incidentId;
    out.incident_state = 'declared';
  } catch (e) {
    out.ledger_ok = false;
    out.incident_id = incidentId;
    out.why = 'the incidents ledger refused the row (' +
              String((e && e.message) || e).slice(0, 160) + '), so nothing is queued — a person owes them this';
  }
  return out;
}

// THEY CORRECTED US — the whole path, ending in a row on disk every time.
function commCorrectionHandle_(m, who, corr, heard, said, nowIso) {
  var mid = String(m.message_id || '');
  var channel = (String(m.channel) === 'email') ? 'email' : 'sms';
  var owed = commCorrectionOwed_(who.key, who.name, heard.kind, said, channel, nowIso);
  var state = 'awaiting_owner', reason = 'correction', close = '';
  var why = heard.why;

  if (!owed.ledger_ok) {
    state = 'needs_human'; reason = 'correction';
    why += ' · ' + owed.why;
  } else if (owed.enrolled) {
    why += ' · nobody owed them a word yet, so incident ' + owed.incident_id + ' was written with ' +
           'an audience of one — themselves. It is DECLARED and not confirmed: an admin confirms ' +
           'it and the repair pass says it through the same door every other message uses';
  } else if (owed.held === 'repaired') {
    state = 'needs_human'; reason = 'correction-again';
    why += ' · WE ALREADY CORRECTED THIS TO THEM (incident ' + owed.incident_id + ') and they are ' +
           'telling us again, so the correction did not land. No second message is sent — a ' +
           'correction is never said twice — and a person has to read this one';
  } else if (owed.held === 'undeliverable') {
    state = 'needs_human'; reason = 'correction';
    why += ' · a correction is already owed to them under incident ' + owed.incident_id +
           ' and could not be delivered by message, which is a person\'s job. This reply is the ' +
           'person, asking';
  } else if (owed.held === 'claimed' ||
             (owed.held === 'planned' && owed.incident_state === 'confirmed')) {
    state = 'dismissed'; reason = 'already-owed'; close = 'machine';
    why += ' · the correction is already ' + (owed.held === 'claimed' ? 'going out' : 'queued') +
           ' under incident ' + owed.incident_id + '. Nothing was added and nothing was said ' +
           'twice; their telling us is recorded here';
  } else {
    why += ' · a correction is already planned for them under incident ' + owed.incident_id +
           ', which nobody has confirmed yet. It waits on the same person this row does';
  }

  /* AN OBLIGATION CLAIM IN THE SAME BREATH IS NEVER CLOSED WITHOUT A PERSON. */
  if (heard.also_ask && state === 'dismissed') {
    state = 'needs_human'; reason = 'unclear'; close = '';
    why += ' · AND they said something about what we asked them for. The estate was not asked — ' +
           'this path does not settle obligations — so a person reads that half';
  }

  var contribution = { kind: 'correction:' + heard.kind, claims: [], why: why };
  var row = commContributionRow_(m, who, corr, contribution, null, state, reason, nowIso);
  // EMPTY ON PURPOSE, the same interlock the window handler keeps: commContributionVerdict settles the bindings…
  row.claims = ''; row.settled_now = ''; row.awaiting = '';
  row.correction_kind = String(heard.kind || '');
  row.repair_incident = String(owed.incident_id || '');
  if (close) { row.close = close; row.closed_at = nowIso; }
  commContributionSave_(row);

  var light = { intent_key: String((corr && corr.intent && corr.intent.intent_key) || ''),
                person_key: String(who.key || ''), person_name: String(who.name || '') };
  commObserve_('contribution', light,
               { channel: m.channel, kind: contribution.kind, correction: heard.kind,
                 incident: owed.incident_id, held: owed.held || 'nothing',
                 enrolled: owed.enrolled, state: state, contribution: row.id,
                 said: String(said || '').slice(0, 300) },
               'inbound', 'the person');
  if (close === 'machine') {
    // THE VERBATIM WORDS GO TO THE TRAIL ON EVERY SILENT CLOSE, so a week of them can be read back and argued with.
    commObserve_('dismissed', light,
                 { reason: reason, why: why.slice(0, 200), incident: owed.incident_id,
                   said: String(said || '').slice(0, 300), close: 'machine',
                   contribution: row.id }, 'inbound', 'the person');
  } else {
    commObserve_('needs_human', light,
                 { reason: reason, why: why.slice(0, 200), incident: owed.incident_id,
                   contribution: row.id }, 'inbound');
  }
  return { ok: true, matched: true, correction: heard.kind, incident: owed.incident_id,
           enrolled: owed.enrolled, held: owed.held, state: state, contribution: row.id };
}

// ------------------------------------------------------------------ THE CLOSE — the last message, and how a thread…

// ASSENT AND NOTHING ELSE, matched WHOLE — the discipline OPT_OUT_PHRASES keeps and for the same reason.
var COMM_ACK_WORDS = ['ok', 'okay', 'ok ok', 'k', 'kk', 'okey', 'okie',
  'ok thanks', 'okay thanks', 'ok thank you', 'okay thank you', 'ok thx', 'thanks ok',
  'thanks', 'thank you', 'thanks a lot', 'many thanks', 'thx', 'ty', 'cheers',
  'no worries', 'no worry', 'no problem', 'no prob', 'np', 'all good', 'its all good',
  'got it', 'understood', 'noted', 'sounds good', 'fine', 'thats fine', 'thats ok',
  'thats okay', 'alright', 'all right', 'great', 'perfect', 'appreciate it',
  'thanks for letting me know', 'thank you for letting me know', 'ok got it',
  'obrigado', 'obrigada', 'ok obrigado', 'ok obrigada', 'valeu', 'tudo bem', 'tudo bom',
  'sem problema', 'sem problemas', 'entendi', 'ok entendi', 'beleza', 'ta bom', 'ta certo',
  'esta bem', 'tranquilo', 'certo', 'ok certo', 'de nada'];

// THE EMOJI THIS READER TAKES AS ASSENT, AND ONLY THESE — thumbs up, OK hand, folded hands, white check, slight…
var COMM_ACK_EMOJI_OK = [
  String.fromCharCode(0xD83D, 0xDC4D),
  String.fromCharCode(0xD83D, 0xDC4C),
  String.fromCharCode(0xD83D, 0xDE4F),
  String.fromCharCode(0x2705),
  String.fromCharCode(0xD83D, 0xDE42),
  String.fromCharCode(0xD83D, 0xDE0A)
];

// Everything in the surrogate range, plus the arrows, symbols and the joiners that travel with them — stripped…
var COMM_ACK_EMOJI_ANY_RE = new RegExp(
  '[' + String.fromCharCode(0xD800) + '-' + String.fromCharCode(0xDBFF) + ']' +
  '[' + String.fromCharCode(0xDC00) + '-' + String.fromCharCode(0xDFFF) + ']' +
  '|[' + String.fromCharCode(0x2190) + '-' + String.fromCharCode(0x27BF) +
  String.fromCharCode(0xFE0F) + String.fromCharCode(0x200D) + ']', 'g');

/** Is the whole of this reply one of those and nothing else? */
function commAckEmojiOk_(raw) {
  var s = String(raw || '');
  for (var i = 0; i < COMM_ACK_EMOJI_OK.length; i++) {
    if (s.indexOf(COMM_ACK_EMOJI_OK[i]) !== -1) return true;
  }
  return false;
}

// A QUESTION, WITH OR WITHOUT ITS MARK.
var COMM_ACK_QUESTION_RE = new RegExp(
  '\\b(do|does|did|can|could|should|shall|will|would|is|are|was|were|am|have|has|' +
  'who|what|when|where|why|how|which|whose|still|need|needs|needed|send|sending|' +
  'quando|como|quem|qual|quais|porque|por que|preciso|precisa|posso|pode|podem|' +
  'ainda|entao|devo|tenho que|mando|envio)\\b');

// THE TURN.
var COMM_ACK_HEDGE_RE = new RegExp(
  '\\b(but|however|though|although|except|unless|anyway|actually|mas|porem|so que|' +
  'todavia|contudo|apesar)\\b');

// A negation inside a short reply changes its whole direction, and this reader has no business working out which…
var COMM_ACK_NEGATION_RE = new RegExp('\\b(not|dont|doesnt|didnt|cant|wont|never|nunca)\\b');

// Past this many words a message is saying something, and past this many characters it certainly is.
var COMM_ACK_MAX_WORDS = 6;
var COMM_ACK_MAX_CHARS = 120;

// IS THIS REPLY AN ACKNOWLEDGEMENT AND NOTHING ELSE?
function commAckRead_(said) {
  var out = { ack: false, read_as: '', why: '' };
  var raw = String(said || '').trim();
  if (!raw) {
    out.why = 'they typed nothing above the quoted original, which is not an answer to anything';
    return out;
  }
  if (raw.length > COMM_ACK_MAX_CHARS) {
    out.why = 'it runs to ' + raw.length + ' characters — nobody writes that much to say "ok"';
    return out;
  }
  if (raw.indexOf('?') !== -1 || raw.indexOf('¿') !== -1) {
    out.why = 'there is a question mark in it, and a question closed as an acknowledgement is a ' +
              'question lost for ever';
    return out;
  }
  var s = (typeof commStatedNormalise_ === 'function')
    ? commStatedNormalise_(raw) : raw.toLowerCase();
  var plain = s.replace(COMM_ACK_EMOJI_ANY_RE, ' ')
               .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  if (!plain) {
    // NOTHING BUT AN EMOJI.
    if (commAckEmojiOk_(raw) && raw.length <= 12) {
      out.ack = true;
      out.read_as = 'an emoji and nothing else';
      out.why = 'the whole reply is an emoji this platform reads as assent';
      return out;
    }
    out.why = 'nothing here but punctuation, or an emoji this reader will not translate';
    return out;
  }
  if (/\d/.test(plain)) {
    out.why = 'there is a number in it, and a number is information rather than assent';
    return out;
  }
  if (COMM_ACK_QUESTION_RE.test(' ' + plain + ' ')) {
    out.why = 'it carries a word a question is built from, with or without the mark';
    return out;
  }
  if (COMM_ACK_HEDGE_RE.test(' ' + plain + ' ')) {
    out.why = 'a friendly word and then a turn — the commonest shape there is, and the thing after ' +
              'the turn is what they wrote to say';
    return out;
  }
  if (COMM_ACK_WORDS.indexOf(plain) !== -1) {
    out.ack = true;
    out.read_as = plain;
    out.why = 'the whole message is assent and nothing else';
    return out;
  }
  if (COMM_ACK_NEGATION_RE.test(' ' + plain + ' ')) {
    out.why = 'a negation in a short reply turns it around, and which way is not this reader\'s to decide';
    return out;
  }
  var words = plain.split(' ').filter(String).length;
  if (words > COMM_ACK_MAX_WORDS) {
    out.why = words + ' words — long enough to be saying something, and this reader only closes a ' +
              'reply that is wholly assent';
    return out;
  }
  out.why = '"' + plain + '" is short and it may well be friendly, but it is not one of the ' +
            'acknowledgements this reader knows, and guessing costs somebody their question';
  return out;
}

// A REPLY TO AN APOLOGY, AND THE END OF THAT THREAD.
function commCloseRepairReply_(m, who, corr, said, open, nowIso) {
  var none = { handled: false, note: '' };
  var text = String(m.text || '');
  var tokens = commInboundTokens_(text);
  if (tokens.length > 1) return none;              // two references: the caller already refuses
  var rows = commInboundRepairRows_();
  if (!rows.length) return none;
  var thread = null, how = '';
  if (tokens.length === 1) {
    thread = commInboundRepairThread_(tokens[0], who.key, rows);
    if (!thread) return none;                      // an unknown reference is not a licence to guess
    how = 'token';
  } else {
    var mine = commInboundRepairsFor_(who.key, rows);
    if (!mine.length) return none;
    if (mine.length > 1) {
      return { handled: false,
               note: ' — and ' + mine.length + ' corrections have been said to this person, so which ' +
                     'apology this answers is no more knowable than which question it answers' };
    }
    if ((open || []).length) {
      return { handled: false,
               note: ' — a correction (incident ' + mine[0].incident_id + ') was also said to them and ' +
                     'is still open. Reading this reply into it because nothing else fits is the ' +
                     'fourth rung of the ladder, and one click of this desk finishes what it refused' };
    }
    if (commTestMode_()) {
      return { handled: false,
               note: ' — a correction (incident ' + mine[0].incident_id + ') was said to them, but test ' +
                     'mode is on: every message goes to the tester line, which many colleagues read, ' +
                     'so a reply names its thread by quoting the Ref or not at all' };
    }
    thread = mine[0];
    how = 'sole-repair';
  }

  var ack = commAckRead_(said);
  var lightCorr = { intent: { intent_key: thread.intent_key, person_key: thread.person_key,
                              person_name: thread.person_name || who.name },
                    how: how,
                    why: (how === 'token' ? 'the reply quoted ' + tokens[0] + ', the reference the ' +
                                            'correction went out with'
                                          : 'exactly one correction has been said to this person and ' +
                                            'nothing else of theirs is open') };
  var state, reason, close = '', why;
  if (ack.ack) {
    state = 'dismissed'; reason = 'acknowledged'; close = 'machine';
    why = 'CLOSED — they answered our correction with "' + ack.read_as + '" and nothing else. ' +
          'A correction asks for nothing, so an acknowledgement finishes it: there is no obligation ' +
          'to settle, nothing for an owner to decide, and their words are on this row and in the trail';
  } else {
    state = 'needs_human'; reason = 'unclear';
    why = 'THEY ANSWERED OUR CORRECTION AND THIS READER WOULD NOT CLOSE IT: ' + ack.why +
          '. Their own words are on this row, unedited. Closing a question as an acknowledgement ' +
          'loses it for ever, and they will not ask twice';
  }
  why += ' · correction ' + thread.incident_id + ', said ' +
         (thread.told_at ? 'at ' + thread.told_at : 'to them') +
         (thread.told_channel ? ' by ' + thread.told_channel : '');

  var contribution = { kind: ack.ack ? 'ack' : 'ack-refused', claims: [], why: why };
  var row = commContributionRow_(m, who, lightCorr, contribution, null, state, reason, nowIso);
  row.claims = ''; row.settled_now = ''; row.awaiting = '';
  row.repair_incident = String(thread.incident_id || '');
  if (close) { row.close = close; row.closed_at = nowIso; }
  commContributionSave_(row);

  // THE CORRECTION'S OWN ROW LEARNS THAT IT WAS ANSWERED.
  try {
    if (typeof commRepairUpsert_ === 'function') {
      commRepairUpsert_({ id: thread.id,
        note: (ack.ack ? 'answered and closed: "' : 'answered, and a person is reading it: "') +
              String(said || '').replace(/\s+/g, ' ').trim().slice(0, 160) + '"' });
    }
  } catch (eN) { /* the contribution row carries the answer either way */ }

  var light = { intent_key: thread.intent_key, person_key: thread.person_key,
                person_name: thread.person_name || who.name };
  commObserve_('correlated', light,
               { how: how, why: lightCorr.why, message_id: String(m.message_id || ''),
                 incident: thread.incident_id }, 'inbound');
  if (ack.ack) {
    commObserve_('dismissed', light,
                 { reason: 'acknowledged', close: 'machine', incident: thread.incident_id,
                   said: String(said || '').slice(0, 300), contribution: row.id },
                 'inbound', 'the person');
  } else {
    commObserve_('needs_human', light,
                 { reason: reason, why: ack.why.slice(0, 200), incident: thread.incident_id,
                   contribution: row.id }, 'inbound');
  }
  return { handled: true,
           result: { ok: true, matched: true, correlated: true, how: how, kind: contribution.kind,
                     incident: thread.incident_id, closed: !!ack.ack, state: state,
                     contribution: row.id } };
}

// ------------------------------------------------------------------ THE CLOSE, ON THE CLOCK — what finishes when…
var COMM_CLOSE_SWEEP_KEY = 'comm_close_last_run';
var COMM_CLOSE_SWEEP_GAP_S = 6 * 3600;

// How long silence has to last before it is read as an ending.
var COMM_CLOSE_SILENCE_DAYS = 7;

// And how long a row may sit on a desk before this lane says so out loud.
var COMM_CLOSE_LOUD_DAYS = 3;

// One pass writes this many rows.
var COMM_CLOSE_PER_PASS = 30;

function commCloseMs_(v) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return 0;
  var ms = Date.parse(s);
  return isNaN(ms) ? 0 : ms;
}

/** The window, stamped before the work — a crash costs one pass, never a loop. */
function commCloseSweepMaybe_() {
  var props;
  try { props = PropertiesService.getScriptProperties(); } catch (e) { return null; }
  var last = 0;
  try { last = Number(props.getProperty(COMM_CLOSE_SWEEP_KEY) || 0) || 0; } catch (e2) { last = 0; }
  var now = new Date().getTime();
  if (last && (now - last) / 1000 < COMM_CLOSE_SWEEP_GAP_S) return null;
  try { props.setProperty(COMM_CLOSE_SWEEP_KEY, String(now)); } catch (e3) { /* run anyway */ }
  return commCloseSweep_();
}

// ONE PASS OF THE ENDINGS.
function commCloseSweep_() {
  var now = new Date(), nowIso = now.toISOString(), nowMs = now.getTime();
  var out = { incidents_closed: 0, closed_on_silence: 0, closed_answered: 0,
              desk_closed: 0, escalated: 0, still_open: 0, held_by_desk: 0, undeclared: 0,
              stalled: 0, wrote: 0 };
  var repairs = commInboundRepairRows_();
  var incidents = {}, byIncident = {};
  repairs.forEach(function (r) {
    if (String(r.kind || '') === 'incident') { incidents[String(r.incident_id || '')] = r; return; }
    if (String(r.kind || '') !== 'person') return;
    var inc = String(r.incident_id || '');
    if (!byIncident[inc]) byIncident[inc] = [];
    byIncident[inc].push(r);
  });

  // THE CONTRIBUTIONS HOUSE ANSWERS TWO QUESTIONS AT ONCE: did anybody reply to this correction after it was said…
  var answeredAt = {}, openOn = {}, deskOpen = [];
  var contributions = [];
  try { contributions = commBoardRows_(COMM_CONTRIBUTIONS_HOUSE) || []; } catch (e) { contributions = []; }
  contributions.forEach(function (r) {
    var inc = String(r.repair_incident || '');
    var at = commCloseMs_(r.received_at);
    if (inc && at && at > (answeredAt[inc] || 0)) answeredAt[inc] = at;
    if (!commContributionOpen_(r)) return;
    deskOpen.push(r);
    if (inc) openOn[inc] = (openOn[inc] || 0) + 1;
  });

  /* ── the desk rows a decision on the incident has already answered ─────── */
  for (var d = 0; d < deskOpen.length && out.wrote < COMM_CLOSE_PER_PASS; d++) {
    var dr = deskOpen[d];
    var dInc = String(dr.repair_incident || '');
    if (!dInc) continue;
    // ONLY THE ROW THAT WAS WAITING ON THAT DECISION, and the gate is narrow on purpose.
    if (String(dr.state || '') !== 'awaiting_owner') continue;
    if (String(dr.reason || '') !== 'correction') continue;
    var incRow = incidents[dInc];
    if (!incRow) continue;
    var iState = String(incRow.state || '');
    // A ROW THAT WAS WAITING ON A DECISION IS OVER WHEN THE DECISION IS MADE, and it must not be left behind on the…
    if (iState === 'confirmed') {
      if (commContributionClose_(String(dr.id), 'dismissed', 'machine', 'already-owed',
            'the correction they reported was confirmed and the repair pass owes them the word — ' +
            'there is nothing left on this desk for this row', nowIso)) {
        out.wrote++; out.desk_closed++;
        openOn[dInc] = Math.max(0, (openOn[dInc] || 1) - 1);
      }
    } else if (iState === 'dismissed' || iState === 'closed') {
      if (commContributionClose_(String(dr.id), 'dismissed', 'person', 'incident-' + iState,
            'the incident they reported was ' + iState + ' by ' +
            String(incRow.confirmed_by || incRow.declared_by || 'an admin') +
            ' — a person\'s decision, and this row ends with it', nowIso)) {
        out.wrote++; out.desk_closed++;
        openOn[dInc] = Math.max(0, (openOn[dInc] || 1) - 1);
      }
    }
  }

  /* ── the incidents whose people are all finished ──────────────────────── */
  var ids = Object.keys(incidents);
  for (var n = 0; n < ids.length && out.wrote < COMM_CLOSE_PER_PASS; n++) {
    var id = ids[n];
    var inc = incidents[id];
    var state = String(inc.state || '');
    if (state === 'closed' || state === 'dismissed') continue;

    if (state !== 'confirmed') {
      // DECLARED AND NEVER ACTED ON.
      var declaredMs = commCloseMs_(inc.declared_at || inc.createdAt);
      if (!declaredMs) continue;
      var age = nowMs - declaredMs;
      if (age > COMM_CLOSE_LOUD_DAYS * 86400000 &&
          String(inc.note || '').indexOf('UNCONFIRMED') === -1) {
        try {
          commRepairUpsert_({ id: String(inc.id),
            note: String(inc.note || '') + ' · UNCONFIRMED: nobody has confirmed this correction' });
          out.wrote++; out.undeclared++;
        } catch (eU) { /* the log below is the other half */ }
        try {
          hubSysLog_('asa-hub:comm', 'comm_close_unconfirmed',
                     'incident ' + id + ' has been waiting on a decision for ' +
                     Math.floor(age / 86400000) + ' days: ' +
                     String(inc.what_was_wrong || '').slice(0, 160) +
                     ' — a correction nobody confirmed is a correction nobody made',
                     { status: 500 });
        } catch (eL) { /* the note carries it */ }
      }
      continue;
    }

    var mine = byIncident[id] || [];
    if (!mine.length) continue;                    // confirmed, nobody planned yet — the pass owes it
    var unfinished = 0, lastTold = 0;
    mine.forEach(function (p) {
      var cs = String(p.claim_state || 'planned');
      if (cs !== 'repaired' && cs !== 'undeliverable') unfinished++;
      var t = commCloseMs_(p.told_at);
      if (t > lastTold) lastTold = t;
    });
    if (unfinished) {
      // CONFIRMED, AND SOMEBODY IN IT IS STILL WAITING FOR THE WORD.
      var confirmedMs = commCloseMs_(inc.confirmed_at || inc.declared_at || inc.createdAt);
      if (!confirmedMs) continue;                  // an unknown age is not an old one
      var stalled = nowMs - confirmedMs;
      if (stalled > COMM_CLOSE_LOUD_DAYS * 86400000 &&
          String(inc.note || '').indexOf('STALLED') === -1) {
        try {
          commRepairUpsert_({ id: String(inc.id),
            note: String(inc.note || '') + ' · STALLED: ' + unfinished + ' person(s) confirmed and ' +
                  'still waiting for the word' });
          out.wrote++; out.stalled++;
        } catch (eS) { /* the log below is the other half */ }
        try {
          hubSysLog_('asa-hub:comm', 'comm_close_stalled',
                     'incident ' + id + ' was confirmed ' + Math.floor(stalled / 86400000) +
                     ' days ago and ' + unfinished + ' person(s) in it have still not been told: ' +
                     String(inc.what_was_wrong || '').slice(0, 160) +
                     ' — a correction confirmed and never said is a correction nobody made',
                     { status: 500 });
        } catch (eL3) { /* the note carries it */ }
      }
      continue;
    }
    if (!lastTold) continue;                       // nobody was ever told; it is not ours to close
    if (openOn[id]) { out.held_by_desk++; continue; }   // a person is reading their answer

    var answered = (answeredAt[id] || 0) > lastTold;
    if (!answered && (nowMs - lastTold) < COMM_CLOSE_SILENCE_DAYS * 86400000) continue;

    var why = answered
      ? 'answered, and the last word was dealt with — nothing is owed on either side'
      : 'nobody answered it in ' + COMM_CLOSE_SILENCE_DAYS + ' days. A correction asks for nothing, ' +
        'so silence is an ending and not a question left hanging; no further word is ever sent';
    try {
      commRepairUpsert_({ id: String(inc.id), state: 'closed', closed_at: nowIso,
                          note: (String(inc.note || '') ? String(inc.note) + ' · ' : '') + 'closed: ' + why });
      out.wrote++; out.incidents_closed++;
      if (answered) out.closed_answered++; else out.closed_on_silence++;
    } catch (eC) { continue; }
    commObserve_(answered ? 'dismissed' : 'unanswered',
                 { intent_key: 'repair.' + id, person_key: '', person_name: '' },
                 { incident: id, people: mine.length, why: why, close: answered ? 'person' : 'silence',
                   last_told: new Date(lastTold).toISOString() },
                 'close', 'the clock');
  }

  /* ── and the rows a person still owes an answer to ─────────────────────── */
  for (var k = 0; k < deskOpen.length && out.wrote < COMM_CLOSE_PER_PASS; k++) {
    var row = deskOpen[k];
    if (String(row.escalated_at || '')) continue;
    var at = commCloseMs_(row.received_at);
    if (!at || (nowMs - at) < COMM_CLOSE_LOUD_DAYS * 86400000) continue;
    if (!commContributionOpen_(row)) continue;
    /* THE ONLY THING A CLOCK MAY DO TO A QUESTION IS MAKE IT LOUDER. */
    if (commContributionSave_({ id: String(row.id), escalated_at: nowIso })) {
      out.wrote++; out.escalated++;
      commObserve_('escalated',
                   { intent_key: String(row.intent_key || ''), person_key: String(row.person_key || ''),
                     person_name: String(row.person_name || '') },
                   { reason: String(row.reason || ''), state: String(row.state || ''),
                     days: Math.floor((nowMs - at) / 86400000), contribution: String(row.id),
                     said: String(row.text || '').slice(0, 300) },
                   'close', 'the clock');
    }
  }
  out.still_open = Math.max(0, deskOpen.length - out.desk_closed);

  try {
    if (out.wrote) {
      hubSysLog_('asa-hub:comm', 'comm_close_swept',
                 out.incidents_closed + ' correction(s) finished (' + out.closed_on_silence +
                 ' on silence, ' + out.closed_answered + ' answered) · ' + out.desk_closed +
                 ' desk row(s) closed by a decision already made · ' + out.escalated +
                 ' waiting on a person for more than ' + COMM_CLOSE_LOUD_DAYS +
                 ' days, said out loud once · ' + out.undeclared + ' incident(s) nobody has confirmed · ' +
                 out.stalled + ' confirmed and not reaching anybody',
                 { status: (out.escalated || out.undeclared || out.stalled) ? 500 : 200 });
    }
  } catch (eL2) { /* the rows carry it */ }
  return out;
}
