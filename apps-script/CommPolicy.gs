// Every rule is a row in the words book and these are only floors; this file decides and never acts.

// quiet_* use the script timezone, not the recipient's; per person the window may only grow.
var COMM_POLICY_FLOOR = {
  quiet_from: 21,
  quiet_to: 8,
  min_gap_hours: 72,
  max_attempts: 3,
  weekend_ok: false,
  escalate_after: 2,
  // The gap follows the urgency band: one gap times the cap made lapsed credentials a two-week queue.
  gap_overdue_hours: 36,
  gap_soon_hours: 72,
  gap_open_hours: 168,
  // Test mode records quiet hours, attempts and consent without enforcing them; only this pace holds (0 = off).
  test_gap_hours: 24
};

function commTestMode_() {
  try { return !!(typeof hubTestRedirect_ === 'function' && hubTestRedirect_()); }
  catch (e) { return false; }
}

function commPolicy_(key) {
  var floor = COMM_POLICY_FLOOR[key];
  try {
    if (typeof digestSetting_ === 'function') {
      if (typeof floor === 'number') return digestSetting_('comm_' + key, floor, 0, 9999);
      var raw = String(digestSetting_('comm_' + key, floor ? 'yes' : 'no') || '');
      return raw.trim().toLowerCase() === 'yes';
    }
  } catch (e) { /* the floor is the answer */ }
  return floor;
}

// A priority is never a permission: it only sets how long a message waits at an already-open door.
var COMM_PRIORITY_ORDER = ['safety', 'repair', 'ask', 'notice'];

// The powers are code; which ids carry each priority is a book row.
var COMM_PRIORITIES = {
  // The only priority that may wake a person; uncapped until delivered or taken by a person.
  safety: { name: 'safety',
            skip_gap: true, skip_quiet: true, skip_weekend: true,
            cap: 'none', droppable: false,
            why: 'somebody could be hurt' },

  // Skips gap and weekend but never quiet hours; said once, on its own thread, never on the ask it apologises for.
  repair: { name: 'repair',
            skip_gap: true, skip_quiet: false, skip_weekend: true,
            cap: 1, droppable: false,
            why: 'we owe them a word' },

  // The floor: anything whose priority cannot be resolved lands here.
  ask: { name: 'ask',
         skip_gap: false, skip_quiet: false, skip_weekend: false,
         cap: 'book', droppable: false,
         why: 'they owe us something' },

  // Obeys everything `ask` obeys and may also be dropped when a pass runs out of budget.
  notice: { name: 'notice',
            skip_gap: false, skip_quiet: false, skip_weekend: false,
            cap: 'book', droppable: true,
            why: 'worth knowing, never urgent' }
};

// Floors of the book's comm_priority_<priority> lists; `ask` has none because it is the floor.
var COMM_PRIORITY_FLOOR = {
  safety: '',
  repair: 'correction.owed,correction_notice',
  // Listed, never claimed: a lane hands over its situation id, and only this row makes it `notice`.
  notice: 'call_off_acknowledged'
};

function commPriorityIds_(priority) {
  var key = String(priority || '');
  var floor = COMM_PRIORITY_FLOOR[key];
  if (floor === undefined) return [];
  var raw = floor;
  try {
    if (typeof digestSetting_ === 'function') {
      raw = String(digestSetting_('comm_priority_' + key, floor));
    }
  } catch (e) { raw = floor; /* the floor is the answer */ }
  return String(raw || '').split(/[,;\n]/).map(function (s) {
    return String(s || '').trim().toLowerCase();
  }).filter(function (s) { return !!s; });
}

// Walked in ladder order, so an id listed twice gets the higher priority.
function commPriorityFor_(id) {
  var want = String(id || '').trim().toLowerCase();
  if (!want) return 'ask';
  for (var i = 0; i < COMM_PRIORITY_ORDER.length; i++) {
    var p = COMM_PRIORITY_ORDER[i];
    if (p === 'ask') continue;
    if (commPriorityIds_(p).indexOf(want) !== -1) return p;
  }
  return 'ask';
}

/** The powers of a priority; an unspellable one is an ordinary ask. */
function commPriorityRule_(priority) {
  return COMM_PRIORITIES[String(priority || '')] || COMM_PRIORITIES.ask;
}

// THE PRIORITY OF ONE PLAN — from declared ids, never from its contents.
function commPriorityOf_(intent, ctx) {
  ctx = ctx || {};
  var ids = [];
  if (ctx.priority_id) ids.push(ctx.priority_id);
  if (ctx.situation) ids.push(ctx.situation);
  if (intent && intent.purpose) ids.push(intent.purpose);
  for (var i = 0; i < ids.length; i++) {
    var word = commPriorityFor_(ids[i]);
    if (word !== 'ask') {
      return { priority: word, id: String(ids[i]).trim().toLowerCase(),
               why: word + ' (' + commPriorityRule_(word).why + ') — declared for `' +
                    String(ids[i]).trim().toLowerCase() + '`' };
    }
  }
  return { priority: 'ask', id: ids.length ? String(ids[0]).trim().toLowerCase() : '',
           why: 'ask (' + COMM_PRIORITIES.ask.why + ') — nothing above it is declared for this' +
                (ids.length ? ' (`' + String(ids[0]).trim().toLowerCase() + '`)' : '') };
}

/** How many attempts this priority may spend. 0 means no cap at all. */
function commAttemptCapFor_(priority) {
  var rule = commPriorityRule_(priority);
  if (rule.cap === 'none') return 0;
  if (typeof rule.cap === 'number') return rule.cap;
  return Number(commPolicy_('max_attempts'));
}

// IS THIS A MOMENT WE MAY SPEAK?
function commWindowVerdict_(localHour, localDay, quiet, priority) {
  var rule = commPriorityRule_(priority);
  // `Number('')` is 0, not NaN — so an isNaN guard alone reads "we do not know this person's hour" as MIDNIGHT…
  var unknown = (localHour === '' || localHour === null || localHour === undefined);
  var h = unknown ? NaN : Number(localHour);
  if (isNaN(h)) return { ok: true, why: 'no local clock for this person — the platform default stands' };
  // the platform's hours, unless the caller narrowed them with the cortex — narrowed, never widened (CommCortex.gs…
  var from = Number(quiet && quiet.from !== undefined ? quiet.from : commPolicy_('quiet_from'));
  var to = Number(quiet && quiet.to !== undefined ? quiet.to : commPolicy_('quiet_to'));
  var inQuiet = (from > to) ? (h >= from || h < to) : (h >= from && h < to);
  if (inQuiet) {
    if (rule.skip_quiet) {
      return { ok: true, skipped: 'quiet hours',
               why: h + ':00 local and sent anyway — priority ' + rule.name +
                    ' is the only one that may wake somebody' };
    }
    return { ok: false, defer: true,
             why: 'quiet hours for this person (' + h + ':00 local' +
                  (quiet && quiet.why ? '; ' + quiet.why : '') + ')' };
  }
  var dayKnown = !(localDay === '' || localDay === null || localDay === undefined);
  var day = dayKnown ? Number(localDay) : NaN;
  if (!commPolicy_('weekend_ok') && (day === 0 || day === 6)) {
    if (rule.skip_weekend) {
      // The rule guards against being ASKED to do work on a day off.
      return { ok: true, skipped: 'the weekend',
               why: 'a weekend, and priority ' + rule.name + ' is not held by it — it asks for nothing' };
    }
    return { ok: false, defer: true, why: 'a weekend, and compliance is not urgent enough to cost one' };
  }
  return { ok: true, why: 'inside the window' };
}

// HAS THIS ALREADY BEEN ASKED RECENTLY ENOUGH?
function commGapVerdict_(lastAskedMs, nowMs, band, priority) {
  var rule = commPriorityRule_(priority);
  if (rule.skip_gap) {
    return { ok: true, skipped: 'the gap',
             why: 'not paced — priority ' + rule.name + ' is not another ask, and the gap counts asks' };
  }
  if (!lastAskedMs) return { ok: true, why: 'never asked' };
  var hours = (Number(nowMs) - Number(lastAskedMs)) / 3600000;
  var gap = commGapFor_(band);
  if (hours < gap) {
    return { ok: false, defer: true,
             why: 'asked ' + Math.round(hours) + 'h ago; the floor is ' + gap + 'h' };
  }
  return { ok: true, why: Math.round(hours) + 'h since the last ask' };
}

// The test-mode pace: one setting, 0 switches it off.
function commTestGapVerdict_(lastAskedMs, nowMs, priority) {
  var rule = commPriorityRule_(priority);
  if (rule.skip_gap) {
    return { ok: true, skipped: 'the test pace',
             why: 'not paced — priority ' + rule.name + ' is not another ask (test pace)' };
  }
  var gap = Number(commPolicy_('test_gap_hours'));
  if (!(gap > 0)) return { ok: true, why: 'test mode, no pace' };
  if (!lastAskedMs) return { ok: true, why: 'never asked' };
  var hours = (Number(nowMs) - Number(lastAskedMs)) / 3600000;
  if (hours < gap) {
    return { ok: false, defer: true,
             why: 'asked ' + Math.round(hours) + 'h ago; the test pace is ' + gap + 'h' };
  }
  return { ok: true, why: Math.round(hours) + 'h since the last ask (test pace ' + gap + 'h)' };
}

// HOW LONG TO WAIT BEFORE ASKING AGAIN, given what the message was about.
function commGapFor_(band) {
  var key = { overdue: 'gap_overdue_hours', soon: 'gap_soon_hours',
              open: 'gap_open_hours' }[String(band || '')];
  if (!key) return Number(commPolicy_('min_gap_hours'));
  return Number(commPolicy_(key));
}

// IS THERE ANY POINT ASKING AGAIN?
function commAttemptVerdict_(attempts, priority) {
  var n = Number(attempts) || 0;
  var rule = commPriorityRule_(priority);
  var cap = commAttemptCapFor_(priority);
  var after = Number(commPolicy_('escalate_after'));
  if (cap === 0) {
    return { ok: true, escalate: n >= after,
             why: 'attempt ' + (n + 1) + ', uncapped — priority ' + rule.name +
                  ' is tried until it is delivered or a person takes it' };
  }
  if (n >= cap) {
    return { ok: false, defer: false, escalate: true,
             why: (typeof rule.cap === 'number')
               ? 'priority ' + rule.name + ' is said once per person and this one is spent — ' +
                 'it is a person\'s job now, and never a retry'
               : n + ' attempts with no answer — this is a person\'s job now, not a reminder\'s' };
  }
  return { ok: true, escalate: n >= after,
           why: 'attempt ' + (n + 1) + ' of ' + cap +
                ((typeof rule.cap === 'number') ? ' (priority ' + rule.name + ')' : '') };
}

// MAY THESE RIDE IN ONE MESSAGE?
function commConsolidate_(bindings) {
  var groups = {};
  (bindings || []).forEach(function (b) {
    var band = commUrgencyBand_(b);
    if (!groups[band]) groups[band] = [];
    groups[band].push(b);
  });
  return ['overdue', 'soon', 'open'].filter(function (band) {
    return groups[band] && groups[band].length;
  }).map(function (band) {
    return { band: band, bindings: groups[band] };
  });
}

// The three bands a message can honestly speak in.
function commUrgencyBand_(b) {
  var state = String(b && b.state || '');
  if (state === 'expired') return 'overdue';
  if (state === 'expiring') return 'soon';
  return 'open';
}

// THE WHOLE VERDICT FOR ONE INTENT, with every reason it reached.
function commPlanVerdict_(intent, ctx) {
  ctx = ctx || {};
  var reasons = [];
  var skipped = [];
  var verdict = { send: true, defer: false, escalate: false };
  var test = (ctx.test === undefined) ? commTestMode_() : !!ctx.test;
  verdict.test = test;
  var soft = ' — not enforced in test mode';

  // Resolved from declared ids before anything else, so that no rule below can be consulted without it and no…
  var pri = commPriorityOf_(intent, ctx);
  verdict.priority = pri.priority;
  verdict.priority_id = pri.id;
  verdict.droppable = !!commPriorityRule_(pri.priority).droppable;
  reasons.push('priority: ' + pri.why);

  verdict.parts = commConsolidate_(intent && intent.bindings);

  var att = commAttemptVerdict_(ctx.attempts, verdict.priority);
  if (att.escalate) verdict.escalate = true;
  if (!att.ok && test) reasons.push('attempts: ' + att.why + soft);
  else {
    reasons.push('attempts: ' + att.why);
    if (!att.ok) { verdict.send = false; verdict.defer = !!att.defer; }
  }

  if (verdict.send) {
    // The band the message LEADS with decides its pace — the consolidation already grouped by urgency, so the first…
    var lead = (verdict.parts && verdict.parts[0]) ? verdict.parts[0].band : '';
    var gap = test ? commTestGapVerdict_(ctx.lastAskedMs, ctx.nowMs, verdict.priority)
                   : commGapVerdict_(ctx.lastAskedMs, ctx.nowMs, lead, verdict.priority);
    reasons.push('gap: ' + gap.why);
    if (gap.skipped) skipped.push(gap.skipped);
    if (!gap.ok) { verdict.send = false; verdict.defer = true; }
  }

  if (verdict.send) {
    var win = commWindowVerdict_(ctx.localHour, ctx.localDay, ctx.quiet, verdict.priority);
    if (!win.ok && test) reasons.push('window: ' + win.why + soft);
    else {
      reasons.push('window: ' + win.why);
      if (win.skipped) skipped.push(win.skipped);
      if (!win.ok) { verdict.send = false; verdict.defer = true; }
    }
  }

  // ONE LINE THAT SAYS THE QUEUE WAS JUMPED, and which priority allowed it.
  verdict.skipped = skipped;
  if (skipped.length) {
    reasons.push('skipped: ' + skipped.join(', ') + ' — priority ' + verdict.priority + ' allows it');
  }

  verdict.reasons = reasons;
  verdict.dial = (typeof commDial_ === 'function') ? commDial_() : 'off';

  // WHAT THE POLICY DECIDED IS KEPT SEPARATE FROM WHETHER IT MAY ACT.
  verdict.policy = verdict.send ? 'would send' : (verdict.defer ? 'held' : 'blocked');
  if (verdict.dial !== 'send') {
    verdict.send = false;
    reasons.push('dial: ' + verdict.dial + ' — worked out, not handed over');
  }
  return verdict;
}


// ====================================================================== THE SENDING DIAL, IN ONE VOCABULARY…

// THE WORD THE DIAL IS ON, FOR A LANE THAT DOES NOT GO THROUGH THE LADDER.
function commSendDialWord_(ctx) {
  var word = String((ctx && ctx.dial) || '');
  if (!word) {
    try { word = (typeof commDial_ === 'function') ? String(commDial_()) : 'off'; }
    catch (eD) { word = 'off'; }
  }
  return word || 'off';
}

// Only one word hands a message to the transport.
function commDialHandsOver_(word) {
  return String(word || '') === 'send';
}

// THE ONE SENTENCE FOR A MESSAGE THE DIAL HELD.
function commDialHeldWhy_(dial, resolvedCount, what) {
  return 'the sending dial stands at `' + String(dial || 'off') + '`, not `send`: ' +
         (what ? String(what) + ' ' : 'this audience ') +
         'was resolved (' + String(resolvedCount) + ') and written down, and NOBODY WAS ' +
         'CONTACTED. The turn is still owed — nothing was claimed, so this row can still take ' +
         // AND IT IS NOT A QUEUE, WHICH THE OLD SENTENCE LET SOMEBODY BELIEVE.
         'it. IT IS NOT A QUEUE: nothing re-sends this one, so turning test mode off — the dial ' +
         'follows it — hands over the NEXT call-off or the next caller, and what stands for this ' +
         'one is the mock outbox, the rehearsal book and this row.';
}
