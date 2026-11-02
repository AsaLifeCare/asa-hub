var OPEN_SHIFT_COVERED_SITUATION = 'open_shift_covered';
var OPEN_SHIFT_COVERED_MAX_ROWS = 6;
// No row starts past this: the relay gives up at 180 s.
var OPEN_SHIFT_COVERED_START_BUDGET_MS = 100000;
var OPEN_SHIFT_COVERED_SENDING_STALE_MS = 10 * 60 * 1000;
var OPEN_SHIFT_COVERED_PASS_BY = 'asa-hub:open-shift-covered';
var OPEN_SHIFT_COVERED_HISTORY = 25;
var OPEN_SHIFT_COVERED_NEVER = ['employee', 'reason', 'called_off_by', 'caller'];

function openShiftCoveredStr_(v) { return String(v == null ? '' : v).trim(); }

function openShiftCoveredDayBefore_(iso) {
  var t = Date.parse(String(iso || '') + 'T12:00:00Z');
  return isNaN(t) ? '' : new Date(t - 86400000).toISOString().slice(0, 10);
}

function openShiftCoveredMatch_(r, rows) {
  var out = { rows: [], why: '', ambiguous: false };
  var who = openShiftCoveredStr_(r.called_off_by || r.open_row);
  var day = openShiftCoveredStr_(r.col_iso).slice(0, 10);
  if (!who || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    out.why = 'the row names no caller or no day';
    return out;
  }
  var key = (typeof clientNameKey_ === 'function') ? clientNameKey_(who) : who.toLowerCase();
  var tokens = who.toLowerCase().split(/[^a-z0-9]+/).filter(function (t) { return t.length >= 2; });
  var code = commCallOffHouseCode_(r.location);
  var before = openShiftCoveredDayBefore_(day);
  var exact = [], loose = [];
  Object.keys(rows || {}).forEach(function (id) {
    var c = rows[id] || {};
    if (!commCallOffSpeaksTo_(openShiftCoveredStr_(c.kind), 'everyone')) return;
    var aud = commCallOffAudienceRead_(c.everyone_audience);
    var shiftDay = commCallOffDate_(c.shift_date);
    // A hotline call-off row may be dated the day before the shift it opened.
    var dayOk = aud.day ? aud.day === day
      : (shiftDay === day || (shiftDay === before && openShiftCoveredStr_(c.source) === 'hotline'));
    if (!dayOk) return;
    var theirs = commCallOffHouseCode_(aud.house);
    if (code && theirs && code !== theirs) return;
    if (key && openShiftCoveredStr_(c.person_key) === key) { exact.push(c); return; }
    var words = ' ' + openShiftCoveredStr_(c.person_name).toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
    if (tokens.length >= 2 && tokens.every(function (t) { return words.indexOf(' ' + t + ' ') !== -1; })) {
      loose.push(c);
    }
  });
  if (exact.length) { out.rows = exact; return out; }
  var people = {};
  loose.forEach(function (c) { people[openShiftCoveredStr_(c.person_key) || openShiftCoveredStr_(c.id)] = true; });
  if (Object.keys(people).length > 1) {
    out.ambiguous = true;
    out.why = Object.keys(people).length + ' different people\'s call-offs match "' + who + '" on ' + day +
              ' — nobody is told rather than the wrong people';
    return out;
  }
  if (loose.length) { out.rows = loose; return out; }
  out.why = 'no call-off this platform recorded for "' + who + '" on ' + day +
            (code ? ' at ' + code : '') + ' — the URGENT OPEN SHIFT it would follow was never sent from here';
  return out;
}

function openShiftCoveredHeard_(matched, nowMs) {
  var out = { heard: 'none', audience: [], why: [], deferred: [] };
  var rank = { none: 0, unknown: 1, written: 2, testers: 3, real: 4 };
  var best = 'none', sending = false, seen = {};
  (matched || []).forEach(function (c) {
    var prod = openShiftCoveredStr_(c.everyone_state), test = openShiftCoveredStr_(c.everyone_test_state);
    var aud = commCallOffAudienceRead_(c.everyone_audience);
    var kind = 'none';
    if (prod === 'told' || prod === 'partial') kind = 'real';
    else if (test === 'told' || test === 'partial' || test === 'rehearsed') kind = 'testers';
    else if (prod === 'sending' || test === 'sending') {
      var at = Date.parse(openShiftCoveredStr_(c.everyone_at));
      if (!isNaN(at) && nowMs - at < OPEN_SHIFT_COVERED_SENDING_STALE_MS) { sending = true; return; }
      kind = 'unknown';
      out.why.push('its URGENT OPEN SHIFT pass was cut short while sending and never said who it reached');
    }
    else if (prod === 'recorded') kind = 'written';
    else if (prod === 'deferred') { out.deferred.push(c); return; }
    else {
      out.why.push('its URGENT OPEN SHIFT ended `' + (prod || test || 'blank') + '` and reached nobody');
      return;
    }
    if (kind !== 'unknown' && !aud.readable) {
      kind = 'unknown';
      out.why.push('its URGENT OPEN SHIFT went out before the platform kept who it reached');
    }
    if (kind !== 'unknown') {
      aud.to.forEach(function (a) {
        var k = commCallOffAddressKey_(a.to);
        if (!k || seen[k]) return;
        seen[k] = true;
        out.audience.push(a);
      });
    }
    if (rank[kind] > rank[best]) best = kind;
  });
  if (sending) { out.heard = 'sending'; return out; }
  if (best === 'none' && out.deferred.length) { out.heard = 'deferred'; return out; }
  out.heard = best;
  return out;
}

function openShiftCoveredSituation_() {
  var sit = commCallOffOtherSituation_(OPEN_SHIFT_COVERED_SITUATION);
  if (!sit) return null;
  return commCallOffChannelsWithWords_(sit).indexOf('sms') === -1 ? null : sit;
}

function openShiftCoveredVars_(r, sit, nowMs) {
  var label = commCallOffHouseLabel_(r.location);
  var day = openShiftCoveredStr_(r.col_iso).slice(0, 10);
  return {
    house: openShiftCoveredStr_(r.house_name) || (label ? label + ' home' : ''),
    time: commCallOffHourWord_(openShiftCoveredStr_(r.start_hm)),
    day_word: commCallOffDayWord_(day, nowMs),
    location: openShiftCoveredStr_(r.address),
    date: day,
    sender: openShiftCoveredStr_(sit && sit.sender) ||
            ((typeof SMART_SENDER_DEFAULT !== 'undefined') ? SMART_SENDER_DEFAULT : '')
  };
}

function openShiftCoveredWords_(sit, vars) {
  var banned = new RegExp('[ \\t]*\\{(' + OPEN_SHIFT_COVERED_NEVER.join('|') + ')\\}', 'g');
  var lines = String((sit && sit.sms_text) || '').split('\n');
  var kept = [];
  lines.forEach(function (line) {
    var clean = line.replace(banned, '');
    if (clean !== line && !/\{\w+\}/.test(clean)) return;
    kept.push(clean);
  });
  var copy = {};
  for (var k in (sit || {})) if (Object.prototype.hasOwnProperty.call(sit, k)) copy[k] = sit[k];
  copy.sms_text = commCallOffUrgentPrune_(kept.join('\n'), vars);
  return copy;
}

function openShiftCoveredPut_(matched, patch) {
  (matched || []).forEach(function (c) {
    var p = { id: String(c.id) };
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) p[k] = patch[k];
    try { commRecordUpsert_(COMM_CALLOFF_HOUSE, p); } catch (e) { }
  });
}

function openShiftCoveredEnd_(matched, state, why, count, env, rehearsal) {
  var cols = COMM_CALLOFF_STATE_COLS.covered;
  var patch = {};
  patch[rehearsal ? cols.test : cols.prod] = state;
  patch[cols.why] = (rehearsal ? COMM_CALLOFF_REHEARSAL_MARK : '') + String(why || '').slice(0, COMM_CALLOFF_WHY_MAX);
  patch[cols.at] = env.nowIso;
  if (count !== undefined) patch.covered_count = String(count);
  openShiftCoveredPut_(matched, patch);
}

function openShiftCoveredFilledWords_(r) {
  var by = openShiftCoveredStr_(r.filled_by);
  var how = openShiftCoveredStr_(r.filled_how);
  var said = how === 'approved' ? 'applied and approved' : how === 'assigned' ? 'assigned by the house manager'
           : how ? 'taken (' + how + ')' : 'filled';
  return by ? 'filled by ' + by + ', ' + said : said;
}

function openShiftCoveredOne_(r, env) {
  var res = { id: openShiftCoveredStr_(r && r.id), state: '', why: '', count: '' };
  var done = function (state, why, count) {
    res.state = state;
    res.why = String(why || '');
    res.count = count === undefined ? '' : String(count);
    return res;
  };
  if (!res.id || !openShiftCoveredStr_(r.col_iso) || !openShiftCoveredStr_(r.called_off_by || r.open_row)) {
    return done('refused', 'not a row this door knows — it needs the shift, its day and the call-off it came from');
  }
  var m = openShiftCoveredMatch_(r, env.rows);
  if (!m.rows.length) {
    // The pool may learn of a call-off before the hotline pass records it.
    return done(m.ambiguous ? 'nobody_heard' : 'not_yet', m.why);
  }
  // Stamped first, even in the quiet window, so a held ask is dropped at 08:00.
  var cols = COMM_CALLOFF_STATE_COLS.covered;
  var filledAt = openShiftCoveredStr_(r.filled_at) || env.nowIso;
  openShiftCoveredPut_(m.rows.filter(function (c) { return !openShiftCoveredStr_(c.covered_filled_at); }),
                       { covered_filled_at: filledAt });
  var already = m.rows.filter(function (c) {
    var s = openShiftCoveredStr_(c[cols.prod]), t = openShiftCoveredStr_(c[cols.test]);
    return (s && s !== 'planned') || (t && t !== 'planned');
  });
  if (already.length) {
    return done('duplicate', 'this shift\'s "covered" already ended `' +
                (openShiftCoveredStr_(already[0][cols.prod]) || openShiftCoveredStr_(already[0][cols.test])) +
                '` — one follow-up per shift');
  }
  var endMs = Date.parse(openShiftCoveredStr_(r.shift_end));
  var filled = openShiftCoveredFilledWords_(r);
  if (!isNaN(endMs) && endMs <= env.nowMs) {
    var staleWhy = 'the shift (' + openShiftCoveredStr_(r.col_iso) + ') is over — nobody is told it is covered';
    openShiftCoveredEnd_(m.rows, 'stale', staleWhy + ' · ' + filled, undefined, env, false);
    return done('stale', staleWhy);
  }
  var heard = openShiftCoveredHeard_(m.rows, env.nowMs);
  if (heard.heard === 'sending') {
    return done('not_yet', 'its URGENT OPEN SHIFT is still being sent — the follow-up waits for it to finish');
  }
  if (heard.heard === 'deferred') {
    var dropWhy = 'the URGENT OPEN SHIFT was still held for ' +
                  ((typeof HUB_QUIET_TO !== 'undefined') ? HUB_QUIET_TO : '08:00') +
                  ' and is dropped instead: the shift is covered, nobody is asked and nobody needs telling';
    openShiftCoveredEnd_(heard.deferred, 'ask_dropped', dropWhy + ' · ' + filled, undefined, env, false);
    return done('ask_dropped', dropWhy);
  }
  if (env.quiet) {
    return done('refused_quiet', 'inside the quiet window (' + commCallOffQuietWords_() + '): nothing is said, ' +
                'the fill is written down, and the relay offers it again at ' +
                ((typeof HUB_QUIET_TO !== 'undefined') ? HUB_QUIET_TO : '08:00'));
  }
  if (heard.heard === 'none') {
    var noneWhy = heard.why.join(' · ') || 'its URGENT OPEN SHIFT reached nobody';
    openShiftCoveredEnd_(m.rows, 'nobody_heard', noneWhy + ' — so nobody is told it is covered · ' + filled,
                         undefined, env, false);
    return done('nobody_heard', noneWhy + ' — so nobody is told it is covered');
  }
  if (heard.heard === 'unknown' || !heard.audience.length) {
    var unknownWhy = (heard.why.join(' · ') || 'its URGENT OPEN SHIFT kept no audience') +
                     ' — nobody new is ever texted, so nobody is told it is covered';
    openShiftCoveredEnd_(m.rows, 'unknown_audience', unknownWhy + ' · ' + filled, undefined, env, false);
    return done('unknown_audience', unknownWhy);
  }
  var sit = env.sit;
  if (!sit) {
    var offWhy = 'the situation `' + OPEN_SHIFT_COVERED_SITUATION + '` is off on the Desk or has no text to send';
    openShiftCoveredEnd_(m.rows, 'held', offWhy + ' · ' + filled, undefined, env, false);
    return done('held', offWhy);
  }
  if (!env.dialReadable) {
    return done('dial_unknown', 'the sending dial could not be read: nothing is said, and the relay asks again');
  }
  var vars = openShiftCoveredVars_(r, sit, env.nowMs);
  if (!vars.house && !vars.day_word) {
    return done('refused', 'the follow-up could not say which shift — no house and no day');
  }
  var sitNow = openShiftCoveredWords_(sit, vars);
  var n = heard.audience.length;
  var instance = openShiftCoveredStr_(m.rows[0].instance) || openShiftCoveredStr_(m.rows[0].id);
  var person = openShiftCoveredStr_(m.rows[0].person_name);
  var withName = function (a) {
    var o = {};
    for (var k in vars) if (Object.prototype.hasOwnProperty.call(vars, k)) o[k] = vars[k];
    o.name = openShiftCoveredStr_(a && a.name);
    o.first_name = o.name.split(/\s+/)[0] || '';
    return o;
  };

  if (!commDialHandsOver_(env.dial)) {
    var heldWhy = commDialHeldWhy_(env.dial, n, 'the people this call-off\'s URGENT OPEN SHIFT reached') +
                  ' · ' + filled;
    var wrote = 0;
    try {
      if (typeof hubRehearsalHeld_ === 'function') {
        hubRehearsalHeld_({
          channel: 'sms', to: heard.audience.map(function (a) { return a.to; }).join(', '),
          situation: OPEN_SHIFT_COVERED_SITUATION,
          intent_key: 'CO|' + instance + '|covered',
          person_key: openShiftCoveredStr_(m.rows[0].person_key), person_name: person,
          purpose: COMM_CALLOFF_SUBJECT_PURPOSE, sender_used: vars.sender,
          verdict: 'recorded', reasons: heldWhy,
          body: smartRender_(sitNow.sms_text, withName(heard.audience[0])),
          reason: 'call off: ' + OPEN_SHIFT_COVERED_SITUATION,
          pass_by: OPEN_SHIFT_COVERED_PASS_BY
        });
        wrote = 1;
      }
    } catch (eH) { wrote = 0; }
    openShiftCoveredEnd_(m.rows, 'recorded', heldWhy, '0/' + n, env, false);
    return done('recorded', 'the sending dial stands at `' + env.dial + '`: ' + n + ' resolved and NOBODY WAS ' +
                'CONTACTED' + (wrote ? ' — the words are in the rehearsal book and the mock outbox'
                                     : ' — and the rehearsal row could not be written'), '0/' + n);
  }
  if (heard.heard !== 'real') {
    var neverWhy = heard.heard === 'testers'
      ? 'its URGENT OPEN SHIFT reached only the testers, in test mode'
      : 'its URGENT OPEN SHIFT was only written down while the dial held it';
    neverWhy += ' — nobody was asked, so nobody is told it is covered';
    openShiftCoveredEnd_(m.rows, 'nobody_heard', neverWhy + ' · ' + filled, undefined, env, false);
    return done('nobody_heard', neverWhy);
  }

  // Asked again: one post can span a minute or more.
  if (commCallOffQuietNow_()) {
    return done('refused_quiet', 'inside the quiet window (' + commCallOffQuietWords_() + '): nothing is said, ' +
                'the fill is written down, and the relay offers it again at ' +
                ((typeof HUB_QUIET_TO !== 'undefined') ? HUB_QUIET_TO : '08:00'));
  }
  var claimed = m.rows.filter(function (c) {
    return commCallOffClaim_(String(c.id), env.test, env.nowIso, 'covered');
  });
  if (!claimed.length) return done('duplicate', 'already claimed by another pass — one follow-up per shift');
  var rehearsal = !!env.test;
  openShiftCoveredEnd_(claimed, 'sending', 'sending to ' + n + ' · ' + filled, '0/' + n, env, rehearsal);
  var chans = commCallOffChannelsWithWords_(sitNow);
  var started = Date.now();
  var stopped = '';
  var sent = 0, redirected = 0, asked = 0, why = '';
  var idem = 'osc_' + String(claimed[0].id).slice(0, 40) + '_';
  for (var i = 0; i < heard.audience.length; i++) {
    if (i >= COMM_CALLOFF_BLAST_MAX) { stopped = 'the cap of ' + COMM_CALLOFF_BLAST_MAX + ' copies'; break; }
    if (Date.now() - started > COMM_CALLOFF_BLAST_BUDGET_MS) {
      stopped = 'the ' + Math.round(COMM_CALLOFF_BLAST_BUDGET_MS / 1000) + '-second budget';
      break;
    }
    if (commCallOffQuietNow_()) { stopped = 'the quiet window (' + commCallOffQuietWords_() + ')'; break; }
    var a = heard.audience[i];
    var one = commCallOffCopyTo_(a.to, sitNow, withName(a), 'call off: ' + OPEN_SHIFT_COVERED_SITUATION,
                                 idem + commCallOffAddressKey_(a.to), chans);
    asked++;
    if (one.sent) sent++;
    if (one.redirected) redirected++;
    else if (!one.sent && why.length < 400) why += (why ? ' · ' : '') + String(one.why || '');
  }
  if (stopped && asked === 0) {
    var backWhy = 'the pass stopped at ' + stopped + ' before its first copy — nothing was said';
    var nightNow = commCallOffQuietNow_();
    openShiftCoveredEnd_(claimed, 'planned', backWhy + ' · ' + filled, undefined, env, rehearsal);
    return done(nightNow ? 'refused_quiet' : 'not_yet', backWhy + ', and the relay offers it again' +
                (nightNow ? ' at ' + ((typeof HUB_QUIET_TO !== 'undefined') ? HUB_QUIET_TO : '08:00') : ''));
  }
  var state = commCallOffEnding_(sent, redirected, asked);
  if (state === 'nobody') state = 'held';
  var said = sent + ' of ' + n + ' told' + (redirected ? ', ' + redirected + ' rehearsed at the testers' : '');
  if (stopped) {
    var notTold = asked - sent - redirected;
    if (sent > 0 || redirected > 0) state = 'partial';
    said = n + ' reached by the ask: ' + sent + ' told' +
           (redirected ? ', ' + redirected + ' rehearsed at the testers' : '') +
           (notTold > 0 ? ', ' + notTold + ' held, refused or failed at the send door' : '') +
           ', ' + (n - asked) + ' NEVER ASKED — the pass stopped at ' + stopped +
           ' and a follow-up is never retried (the ones already told would hear it twice)';
  }
  var endWhy = said + (why ? ' · ' + why : '') + ' · ' + filled;
  openShiftCoveredEnd_(claimed, state, endWhy, sent + '/' + n, env, rehearsal);
  if ((sent > 0 || redirected > 0) && typeof smartRecord_ === 'function') {
    try {
      var key = 'CO|' + instance + '|covered';
      var rehearsed = !sent && redirected;
      smartRecord_((rehearsed && typeof smartRehearsalKey_ === 'function') ? smartRehearsalKey_(key) : key,
                   OPEN_SHIFT_COVERED_SITUATION, person, openShiftCoveredStr_(r.col_iso).slice(0, 10),
                   rehearsed ? 'rehearsal' : 'sms');
    } catch (eL) { }
  }
  return done(state, said + (why ? ' · ' + why : ''), sent + '/' + n);
}

/** Take the open-shift fills the relay hands over, answering one result for every row offered. */
HUB_POLICY.openShiftCovered = {
  file: 'CommOpenShiftCovered.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [],
  emits: ['smsSend', 'emailSend']
};
HUB_ACTIONS.openShiftCovered = function (payload, user) {
  if (!user || (!user.is_service && String(user.role) !== 'admin')) return hubDenied_();
  var data = payload || {};
  var rows = Array.isArray(data.rows) ? data.rows.slice(0, OPEN_SHIFT_COVERED_MAX_ROWS) : [];
  var out = { results: [], counts: {}, dial: '' };
  if (!rows.length) return { status: 200, data: out };
  var now = new Date();
  var dialState = { word: 'off', readable: false };
  try { dialState = commDialState_(); } catch (eD) { dialState = { word: 'off', readable: false }; }
  var callOffs = {};
  var readable = true;
  try { callOffs = commCallOffRows_(); } catch (eR) { readable = false; }
  var env = {
    now: now, nowMs: now.getTime(), nowIso: now.toISOString(),
    quiet: commCallOffQuietNow_(),
    dial: String(dialState.word || 'off'), dialReadable: dialState.readable !== false,
    test: (typeof commTestMode_ === 'function') ? !!commTestMode_() : false,
    rows: callOffs, sit: openShiftCoveredSituation_()
  };
  out.dial = env.dialReadable ? env.dial : 'unknown';
  var begun = Date.now();
  rows.forEach(function (raw, i) {
    var r = raw || {};
    var res;
    // Re-read after each fill: the previous one may have written its ending.
    if (i > 0 && readable) {
      try { env.rows = commCallOffRows_(); } catch (eAgain) { readable = false; }
    }
    if (!readable) {
      res = { id: openShiftCoveredStr_(r.id), state: 'failed', count: '',
              why: 'the call-off house could not be read — "we cannot see" is not "nobody was asked"' };
    } else if (Date.now() - begun > OPEN_SHIFT_COVERED_START_BUDGET_MS) {
      res = { id: openShiftCoveredStr_(r.id), state: 'not_yet', count: '',
              why: 'this execution spent its time on the rows before it; the relay offers it again' };
    } else {
      try { res = openShiftCoveredOne_(r, env); }
      catch (e) {
        res = { id: openShiftCoveredStr_(r.id), state: 'failed', count: '',
                why: 'the lane threw: ' + String((e && e.message) || e).slice(0, 200) };
      }
    }
    out.counts[res.state] = (out.counts[res.state] || 0) + 1;
    out.results.push(res);
  });
  try {
    hubSysLog_('asa-hub:comm', 'open_shift_covered',
               rows.length + ' fill(s): ' + JSON.stringify(out.counts), { status: 200 });
  } catch (eLg) { }
  return { status: 200, data: out };
};

/** What the covered-shift follow-ups did, for the Broadcast page; house managers and above. */
HUB_POLICY.openShiftCoveredBoard = {
  file: 'CommOpenShiftCovered.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  // Open to every session; the handler decides by badge.
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.openShiftCoveredBoard = function (payload, user) {
  var who = (typeof commBroadcastWho_ === 'function') ? commBroadcastWho_(user) : { ok: false, why: '' };
  var out = { can_see: !!who.ok, why: String(who.why || ''), situation: openShiftCoveredSituationState_(),
              items: [], error: '' };
  if (!who.ok) return { status: 200, data: out };
  var rows = {};
  try { rows = commCallOffRows_(); }
  catch (e) {
    out.error = 'the call-off house could not be read — this list is one that could not be seen, not an empty one';
    return { status: 200, data: out };
  }
  var cols = COMM_CALLOFF_STATE_COLS.covered;
  var items = [];
  Object.keys(rows).forEach(function (id) {
    var c = rows[id] || {};
    var prod = openShiftCoveredStr_(c[cols.prod]), test = openShiftCoveredStr_(c[cols.test]);
    var filledAt = openShiftCoveredStr_(c.covered_filled_at);
    if (!prod && !test && !filledAt) return;
    var aud = commCallOffAudienceRead_(c.everyone_audience);
    var state = prod || test || 'waiting';
    items.push({
      id: String(c.id || id),
      day: aud.day || commCallOffDate_(c.shift_date),
      house: commCallOffHouseLabel_(aud.house) || '',
      state: state,
      rehearsal: !prod && !!test,
      why: openShiftCoveredMasked_(c[cols.why]),
      at: openShiftCoveredStr_(c[cols.at]) || filledAt,
      filled_at: filledAt,
      count: openShiftCoveredStr_(c.covered_count),
      audience: aud.readable ? aud.to.length : null,
      ask: openShiftCoveredStr_(c.everyone_state) || openShiftCoveredStr_(c.everyone_test_state)
    });
  });
  items.sort(function (a, b) { return String(a.at) < String(b.at) ? 1 : String(a.at) > String(b.at) ? -1 : 0; });
  out.items = items.slice(0, OPEN_SHIFT_COVERED_HISTORY);
  return { status: 200, data: out };
};

function openShiftCoveredMasked_(why) {
  return String(why || '').replace(/\+?\d[\d\s().-]{8,}\d/g, function (m) {
    var d = m.replace(/\D/g, '');
    return d.length >= 10 ? '•••' + d.slice(-4) : m;
  });
}

function openShiftCoveredSituationState_() {
  var out = { id: OPEN_SHIFT_COVERED_SITUATION, on: false, found: false, sms_text: '' };
  try {
    smartSituations_().forEach(function (s) {
      if (String(s.id) !== OPEN_SHIFT_COVERED_SITUATION) return;
      out.found = true;
      out.sms_text = String(s.sms_text || '');
    });
  } catch (e) { }
  try { out.on = !!openShiftCoveredSituation_(); } catch (e2) { out.on = false; }
  return out;
}
