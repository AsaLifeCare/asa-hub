// SCHEDULING — THE FLOWS.
// Call off, Request Off, time off, swap, take, the My Work answer, the call-off outreach and its clock, and the…

var SCHED_FLOW_ACTIONS = ['schedulingCallOff', 'schedulingRequestOff', 'schedulingTimeOff', 'schedulingSwapPropose',
                          'schedulingTake', 'schedulingWithdraw', 'schedulingAnswer'];
var SCHED_FLOW_SITUATIONS = ['sched_calloff_house', 'sched_calloff_everyone', 'sched_swap_ask',
                             'sched_swap_declined_staff', 'sched_swap_declined_manager',
                             'sched_swap_declined_director', 'sched_swap_done', 'sched_request_decided',
                             'sched_timeoff_decided', 'sched_training_ask', 'sched_training_decided',
                             'sched_exchange_ask', 'sched_exchange_done'];
var SCHED_FLOW_TZ = 'America/New_York';
var SCHED_FLOW_DUE_KEY = 'sched_due_at';
var SCHED_FLOW_ROLL_PROP = 'SCHED_ROLL_CHECKED_DAY';
var SCHED_FLOW_PHONE_OWED = 'SCHED_PHONE_OWED|';
var SCHED_FLOW_PHONE_LOCK_MS = 2000;
var SCHED_FLOW_PHONE_TRIES = 30;
var SCHED_FLOW_CLAIM_MS = 180000;
var SCHED_FLOW_RETRY_MS = 600000;
var SCHED_FLOW_TICK_BUDGET_MS = 45000;
var SCHED_FLOW_INLINE_BUDGET_MS = 25000;
var SCHED_FLOW_BLAST_MAX = 200;
var SCHED_FLOW_BLAST_BUDGET_MS = 60000;
var SCHED_FLOW_TIMEOFF_MAX_DAYS = 60;
var SCHED_FLOW_TIMED = ['day', 'morning', 'afternoon', 'evening', 'overnight'];
var SCHED_FLOW_HOLDING = ['scheduled', 'swap_in', 'taken', 'training'];
var SCHED_FLOW_OUTREACH = ['outreach_1', 'outreach_wait', 'outreach_2'];
var SCHED_FLOW_WAITING = ['waiting', 'waiting_staff', 'waiting_manager', 'waiting_director'];
var SCHED_FLOW_SWAPPABLE = ['scheduled', 'swap_in', 'taken', 'training'];
var SCHED_FLOW_STATE_WORDS = { called_off: 'called off', requested_off: 'requested off', time_off: 'time off',
                               swapped_out: 'swapped away already', open: 'an open shift' };
var SCHED_FLOW_HEADER = ['id', 'kind', 'state', 'house_code', 'date', 'date_to', 'row_id', 'person', 'person_key',
                         'person_uid', 'shift_text', 'start_min', 'end_min', 'open_row_id', 'replacement',
                         'replacement_key', 'replacement_uid', 'seats', 'reason', 'note', 'source', 'source_ref',
                         'outreach_stage', 'outreach_next_at', 'outreach_log', 'test_mode', 'created_at',
                         'created_by', 'updated_at', 'closed_at', 'closed_by'];
/** The self-test's clock: an ISO instant while a check names the hour it is about, null everywhere real. */
var SCHED_FLOW_NOW = null;

/* ---- time, words, small values ---- */

function schedFlowNow_() {
  if (SCHED_FLOW_NOW) {
    var t = Date.parse(String(SCHED_FLOW_NOW));
    if (!isNaN(t)) return t;
  }
  return Date.now();
}

function schedFlowIso_(ms) { return new Date(ms).toISOString(); }

function schedFlowDay_(ms) { return Utilities.formatDate(new Date(ms), SCHED_FLOW_TZ, 'yyyy-MM-dd'); }

function schedFlowYmd_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso == null ? '' : iso).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function schedFlowAddDays_(iso, n) {
  var p = schedFlowYmd_(iso);
  if (!p) return '';
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + Number(n || 0), 12));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

/** The instant an Ohio day begins. */
function schedFlowMidnightMs_(iso) {
  var p = schedFlowYmd_(iso);
  if (!p) return NaN;
  var probe = Date.UTC(p[0], p[1] - 1, p[2], 5);
  var hm = Utilities.formatDate(new Date(probe), SCHED_FLOW_TZ, 'HH:mm').split(':');
  return probe - (Number(hm[0]) * 60 + Number(hm[1])) * 60000;
}

// 08:00 Ohio on a day, read off the clock at noon UTC — always the same side of a 02:00 clock change as 08:00, so…
function schedFlowAt8_(iso) {
  var p = schedFlowYmd_(iso);
  if (!p) return NaN;
  var probe = Date.UTC(p[0], p[1] - 1, p[2], 12);
  var hm = Utilities.formatDate(new Date(probe), SCHED_FLOW_TZ, 'HH:mm').split(':');
  return probe - ((Number(hm[0]) * 60 + Number(hm[1])) - 480) * 60000;
}

/** The next 08:00 Ohio after `ms` — where the quiet window hands back. */
function schedFlowNext8_(ms) {
  var today = schedFlowDay_(ms);
  var at = schedFlowAt8_(today);
  return at > ms ? at : schedFlowAt8_(schedFlowAddDays_(today, 1));
}

/** Asked before anything is claimed: a clock that cannot be read is not night (hubQuietAt_). */
function schedFlowQuiet_(ms) {
  try { return typeof hubQuietAt_ === 'function' && !!hubQuietAt_(new Date(ms)); } catch (e) { return false; }
}

function schedFlowDayWords_(iso) {
  var p = schedFlowYmd_(iso);
  if (!p) return String(iso || '');
  return Utilities.formatDate(new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)), 'UTC', 'EEE M/d');
}

function schedFlowDayWord_(iso, nowMs) {
  var p = schedFlowYmd_(iso);
  if (!p) return '';
  var today = schedFlowDay_(nowMs);
  if (iso === today) return 'today';
  if (iso === schedFlowAddDays_(today, 1)) return 'tomorrow';
  return Utilities.formatDate(new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)), 'UTC', 'EEEE');
}

function schedFlowHourWord_(min) {
  var n = Number(min);
  if (str_(min) === '' || isNaN(n)) return '';
  var h = Math.floor(n / 60) % 24, m = Math.round(n % 60);
  return ((h % 12) || 12) + (m ? ':' + ('0' + m).slice(-2) : '') + (h < 12 ? 'am' : 'pm');
}

function schedFlowText_(v, max) {
  var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return max ? s.slice(0, max) : s;
}

function schedFlowJson_(raw, fallback) {
  if (raw && typeof raw === 'object') return raw;
  try { var v = JSON.parse(String(raw || '')); return (v && typeof v === 'object') ? v : fallback; }
  catch (e) { return fallback; }
}

function schedFlowHex_(seed, algo) {
  var bytes = Utilities.computeDigest(algo || Utilities.DigestAlgorithm.SHA_256, String(seed), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function schedFlowNewId_(prefix, seed) {
  return prefix + schedFlowHex_(String(seed) + '|' + schedFlowNow_() + '|' + Math.random()).slice(0, 10).toUpperCase();
}

/** One line in the system log; a log that cannot be written never stops a flow. */
function schedFlowLog_(event, what, status) {
  try { hubSysLog_('asa-hub:scheduling', event, String(what || '').slice(0, 300), { status: status }); }
  catch (e) { /* the flow stands without its line */ }
}

function schedFlowErr_(e) { return String((e && e.message) || e || 'unknown error').slice(0, 240); }

function schedFlowFail_(e) {
  var msg = schedFlowErr_(e);
  schedFlowLog_('scheduling_flow_error', msg, 503);
  return { status: 503, message: 'The calendar could not be read or written just now (' + msg + ') — nothing was changed.' };
}

function schedFlowTestWord_() {
  try { return schedTestMode_().on === false ? 'no' : 'yes'; } catch (e) { return 'yes'; }
}

function schedFlowHouseWord_(code) {
  try { return str_(schedHouseLabel_(code)) || str_(code); } catch (e) { return str_(code); }
}

function schedFlowShiftWords_(flow) {
  try {
    return str_(schedShiftWords_({ text: flow.shift_text, start_min: flow.start_min, end_min: flow.end_min })) ||
           str_(flow.shift_text);
  } catch (e) { return str_(flow.shift_text); }
}

function schedFlowLink_(house, date) {
  return '/app/scheduling/calendar?house=' + encodeURIComponent(str_(house)) + '&day=' + encodeURIComponent(str_(date));
}

/** The street of a house, from the house registry the Locations app reads; '' when it cannot be told. */
function schedFlowStreet_(house) {
  try {
    if (typeof locationsHomes_ !== 'function') return '';
    var hit = '';
    (locationsHomes_() || []).forEach(function (h) { if (h && str_(h.code) === str_(house)) hit = str_(h.address); });
    return hit;
  } catch (e) { return ''; }
}

function schedFlowShiftMs_(date, startMin, endMin) {
  var base = schedFlowMidnightMs_(date);
  return { start: base + Number(startMin) * 60000, end: base + Number(endMin) * 60000 };
}

function schedFlowTimed_(cell) {
  if (!cell || SCHED_FLOW_TIMED.indexOf(str_(cell.kind)) === -1) return false;
  if (str_(cell.start_min) === '' || str_(cell.end_min) === '') return false;
  var s = Number(cell.start_min), e = Number(cell.end_min);
  return !isNaN(s) && !isNaN(e) && e > s;
}

/** A person holds this timed shift (scheduled, swapped in or taken). */
function schedFlowHolds_(cell) {
  return schedFlowTimed_(cell) && SCHED_FLOW_HOLDING.indexOf(str_(cell.state) || 'scheduled') !== -1;
}

function schedFlowEnded_(date, endMin, nowMs) {
  return !(schedFlowShiftMs_(date, 0, endMin).end > nowMs);
}

/* ---- reads ---- */

function schedFlowGate_(user) {
  try {
    var g = schedGate_(user);
    return (g && g.open) ? g : { open: false };
  } catch (e) { return { open: false }; }
}

function schedFlowEditor_(g, house) {
  if (!g || !g.open) return false;
  if (g.is_master || g.is_director) return true;
  try { return typeof g.editorOf === 'function' && !!g.editorOf(house); } catch (e) { return false; }
}

function schedFlowFlowById_(id) {
  var hit = null;
  schedRead_('sched_flows').forEach(function (f) { if (str_(f.id) === str_(id)) hit = f; });
  return hit;
}

function schedFlowRowOf_(house, rowId) {
  var hit = null;
  schedRead_('sched_rows').forEach(function (r) {
    if (str_(r.house_code) === str_(house) && str_(r.row_id) === str_(rowId)) hit = r;
  });
  return hit;
}

/** A waiting Request Off, swap or training on this very cell — a swap's partner shift counts as its own. */
function schedFlowCellBusy_(house, rowId, date, exceptId) {
  var hit = null;
  schedRead_('sched_flows').forEach(function (f) {
    if (exceptId && str_(f.id) === str_(exceptId)) return;
    if ((f.kind !== 'request_off' && f.kind !== 'swap' && f.kind !== 'training') ||
        SCHED_FLOW_WAITING.indexOf(str_(f.state)) === -1) return;
    var ex = schedFlowExchangeOf_(f);
    var here = str_(f.house_code) === str_(house) && str_(f.row_id) === str_(rowId) && str_(f.date) === str_(date);
    var there = !!ex && str_(ex.house) === str_(house) && str_(ex.row_id) === str_(rowId) && str_(ex.date) === str_(date);
    if (here || there) hit = f;
  });
  return hit;
}

/** Why a waiting flow on the cell stops a Request Off or a swap. */
function schedFlowBusyWords_(busy) {
  return { status: 409, message: busy.kind === 'training' ? 'This shift is waiting on a training approval.'
                                                           : 'This shift already has a request waiting.' };
}

/** What waits on this cell, as an editor reads it: a swap names whoever is on its other side. */
function schedFlowPendingWhat_(busy, house, rowId, date) {
  if (busy.kind === 'training') return 'training';
  if (busy.kind === 'request_off') return 'Request Off';
  var own = str_(busy.house_code) === str_(house) && str_(busy.row_id) === str_(rowId) && str_(busy.date) === str_(date);
  return 'swap with ' + (own ? str_(busy.replacement) : str_(busy.person));
}

/** The refusal of an editor's write (or undo) over a cell a waiting flow holds. */
function schedFlowPendingWords_(busy, house, rowId, date) {
  return 'This shift has a pending ' + schedFlowPendingWhat_(busy, house, rowId, date) + ': answer it or cancel it first.';
}

// An editor changes a cell a waiting flow holds, and cancels the flow in the same write (the caller holds the…
function schedFlowCancelPending_(flow, ctx, house, rowId, date) {
  var by = str_(ctx && ctx.name) || 'An editor';
  var what = schedFlowPendingWhat_(flow, house, rowId, date);
  var line = by + ' changed the shift, so the pending ' + what + ' was cancelled.';
  var ex = schedFlowExchangeOf_(flow);
  var vars = ex ? schedFlowExchangeVars_(flow) : schedFlowVars_(flow);
  schedFlowClose_(flow, 'cancelled', by);
  schedFlowNote_(flow, line);
  schedFlowItemsSettle_(flow.id, '', 'closed', by);
  var where, title;
  if (flow.kind === 'swap') {
    where = schedFlowSwapWhere_(flow);
    title = 'Swap cancelled — ' + where;
    var hmOnly = !ctx || (!ctx.is_master && !ctx.is_director);
    var sit = hmOnly ? 'sched_swap_declined_manager' : 'sched_swap_declined_director';
    schedFlowOwe_(flow, sit, flow.person_key, vars, '');
    if (ex) {
      var theirs = JSON.parse(JSON.stringify(vars));
      theirs.house = vars.their_house; theirs.date = vars.their_date; theirs.shift = vars.their_shift;
      schedFlowOwe_(flow, sit, flow.replacement_key, theirs, '');
    }
  } else {
    where = schedFlowDayWords_(flow.date) + ' · ' + schedFlowShiftWords_(flow) + ' · ' + schedFlowHouseWord_(flow.house_code);
    title = (flow.kind === 'training' ? 'Training' : 'Request Off') + ' cancelled — ' + where;
    vars.result = 'cancelled: the shift was changed on the calendar';
    if (flow.kind === 'training') vars.trainee = str_(flow.person);
    schedFlowOwe_(flow, flow.kind === 'training' ? 'sched_training_decided' : 'sched_request_decided', flow.person_key, vars, '');
  }
  var items = [schedFlowItem_(flow, 'inbox', 'info', flow.kind === 'training' ? 'trainee' : 'requester',
                              { uid: flow.person_uid, name: flow.person, email: '' }, title, line)];
  if (flow.kind === 'swap' && str_(flow.replacement_uid)) {
    items.push(schedFlowItem_(flow, 'inbox', 'info', 'staff', { uid: flow.replacement_uid, name: flow.replacement, email: '' },
                              title, line));
  }
  schedUpsert_('sched_flows', [flow]);
  schedInbox_(items);
  return line;
}

/** The directors who can be asked: readable, and only those with an account (an item to nobody is nobody's). */
function schedFlowDirectors_(st) {
  var s = st || schedSettings_();
  if (!s || s.directors_readable === false) {
    return { readable: false, list: [], why: str_(s && s.directors_why) || 'the Scheduling directors list could not be read' };
  }
  var list = [];
  (s.directors || []).forEach(function (d) {
    if (d && str_(d.uid)) list.push({ uid: str_(d.uid), name: str_(d.name) || str_(d.email), email: str_(d.email) });
  });
  return { readable: true, list: list, why: list.length ? '' : 'no director on the Scheduling list has an account yet' };
}

function schedFlowNoDirector_(dirs) {
  return { status: 409, message: 'There is no director who can approve this: ' + (dirs.why || 'you are the only one') + '.' };
}

function schedFlowNum_(v, dflt) {
  var n = Number(v);
  return (str_(v) === '' || isNaN(n) || n < 0) ? dflt : n;
}

/** Who a write is made by, for the calendar log — the session, never a payload. */
function schedFlowActor_(user, g) {
  if (g && g.open) return g;
  var name = str_(user && user.display_name) || str_(user && user.email);
  return { open: false, uid: hubActingUserId_(user), name: name, key: '', is_master: false, is_director: false,
           editorOf: function () { return false; } };
}

function schedFlowSystem_(name) {
  return { open: false, uid: '', name: name, key: '', is_master: false, is_director: false, system: true,
           editorOf: function () { return false; } };
}

/* ---- the flow row ---- */

function schedFlowRow_(fields) {
  var row = {};
  SCHED_FLOW_HEADER.forEach(function (h) { row[h] = ''; });
  for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) row[k] = fields[k];
  var nowIso = schedFlowIso_(schedFlowNow_());
  if (!row.created_at) row.created_at = nowIso;
  row.updated_at = nowIso;
  if (!row.test_mode) row.test_mode = schedFlowTestWord_();
  if (!row.outreach_log) row.outreach_log = '{}';
  return row;
}

function schedFlowClose_(flow, state, by) {
  var nowIso = schedFlowIso_(schedFlowNow_());
  flow.state = state;
  flow.closed_at = nowIso;
  flow.closed_by = str_(by);
  flow.updated_at = nowIso;
}

function schedFlowNote_(flow, line) {
  flow.note = (str_(flow.note) ? str_(flow.note) + ' · ' : '') + line;
}

// A text owed by a flow that is not a call-off: kept on the flow (who, which words, the idempotency key) and said…
function schedFlowOwe_(flow, sit, key, vars, whileState) {
  if (!str_(key) || flow.kind === 'call_off') return;
  var log = schedFlowJson_(flow.outreach_log, {});
  log.owed = log.owed || [];
  var idem = 'sched:' + flow.id + ':' + sit + ':' + key;
  if (log.owed.some(function (o) { return o.idem === idem; })) return;
  log.owed.push({ idem: idem, sit: sit, key: str_(key), vars: vars || {}, while: whileState || '' });
  flow.outreach_log = JSON.stringify(log);
  var nowMs = schedFlowNow_();
  var at = Date.parse(str_(flow.outreach_next_at));
  if (isNaN(at) || at > nowMs) flow.outreach_next_at = schedFlowIso_(nowMs);
}

function schedFlowVars_(flow) {
  var nowMs = schedFlowNow_();
  var date = str_(flow.date);
  return {
    house: schedFlowHouseWord_(flow.house_code), date: schedFlowDayWords_(date),
    day_word: schedFlowDayWord_(date, nowMs), time: schedFlowHourWord_(flow.start_min),
    shift: schedFlowShiftWords_(flow), location: schedFlowStreet_(flow.house_code),
    original: str_(flow.person), replacement: str_(flow.replacement),
    link: (typeof mailPlatformUrl_ === 'function' ? mailPlatformUrl_() : '') + '/#' +
          schedFlowLink_(flow.house_code, date)
  };
}

/* ---- My Work / My Inbox items ---- */

/** One telling per flow, box, kind, seat, recipient and title: a second telling of another moment is its own item. */
function schedFlowItemKey_(it) {
  return [str_(it.flow_id), str_(it.box), str_(it.kind), str_(it.seat), str_(it.to_uid), str_(it.title)].join('|');
}

/** One item for one recipient (or for everyone, `to` null); an exchange's item names both shifts. */
function schedFlowItem_(flow, box, kind, seat, to, title, body) {
  var it = {
    flow_id: str_(flow.id), box: box, kind: kind, seat: seat,
    to_uid: to ? str_(to.uid) : '', to_email: to ? str_(to.email) : '', to_name: to ? str_(to.name) : '',
    title: title, body: body || '', house_code: str_(flow.house_code),
    house_label: flow.house_code ? schedFlowHouseWord_(flow.house_code) : '',
    date: str_(flow.date), shift_text: flow.shift_text ? schedFlowShiftWords_(flow) : '',
    link: flow.house_code ? schedFlowLink_(flow.house_code, flow.date) : '/app/scheduling/calendar'
  };
  var ex = schedFlowExchangeOf_(flow);
  if (ex) {
    if (str_(ex.house) !== str_(flow.house_code)) it.house_label += ' ⇄ ' + schedFlowHouseWord_(ex.house);
    it.shift_text = schedFlowDayWords_(flow.date) + ' ' + schedFlowShiftWords_(flow) + ' ⇄ ' +
                    schedFlowDayWords_(ex.date) + ' ' + schedFlowExchangeShift_(ex);
  }
  return it;
}

// Writes inbox rows, once per flow, box, kind, seat and recipient — a second call for the same telling writes…
function schedInbox_(items) {
  var list = (items || []).filter(function (it) {
    return it && (it.box === 'work' || it.box === 'inbox') && (str_(it.to_uid) || it.seat === 'everyone');
  });
  if (!list.length) return [];
  var have = {};
  schedRead_('sched_inbox').forEach(function (r) { have[schedFlowItemKey_(r)] = true; });
  var tm = schedFlowTestWord_();
  var nowIso = schedFlowIso_(schedFlowNow_());
  var rows = [];
  list.forEach(function (it) {
    var k = schedFlowItemKey_(it);
    if (have[k]) return;
    have[k] = true;
    rows.push({
      id: schedFlowNewId_('SI', k), flow_id: str_(it.flow_id), box: it.box, kind: str_(it.kind), seat: str_(it.seat),
      to_uid: it.seat === 'everyone' ? '' : str_(it.to_uid), to_email: str_(it.to_email), to_name: str_(it.to_name),
      title: str_(it.title), body: str_(it.body), house_code: str_(it.house_code), house_label: str_(it.house_label),
      date: str_(it.date), shift_text: str_(it.shift_text), state: it.box === 'work' ? 'waiting' : 'posted',
      answered_by: '', answered_at: '', note: '', link: str_(it.link), test_mode: tm, created_at: nowIso
    });
  });
  if (rows.length) schedAppend_('sched_inbox', rows);
  return rows;
}

/** Closes every waiting My Work item of a flow (optionally one seat, at some houses), naming who settled it. */
function schedFlowItemsSettle_(flowId, seat, state, by, exceptId, houses) {
  var nowIso = schedFlowIso_(schedFlowNow_());
  var changed = [];
  schedRead_('sched_inbox').forEach(function (r) {
    if (str_(r.flow_id) !== str_(flowId) || r.box !== 'work' || r.state !== 'waiting') return;
    if (seat && str_(r.seat) !== seat) return;
    if (houses && houses.length && houses.indexOf(str_(r.house_code)) === -1) return;
    if (exceptId && str_(r.id) === exceptId) return;
    r.state = state;
    r.answered_by = str_(by);
    r.answered_at = nowIso;
    changed.push(r);
  });
  if (changed.length) schedUpsert_('sched_inbox', changed);
  return changed.length;
}

/* ---- the one text door ---- */

// EVERY TEXT IS HANDED TO SMART COMMS.
function schedText_(situationId, toE164, vars, idemKey, who) {
  var p = who || {};
  return smartTell_({ situation: situationId, to: toE164, vars: vars || {}, key: idemKey,
                      person: str_(p.name), person_key: str_(p.key), occasion: str_(p.date),
                      ledger_key: str_(p.ledger_key), lane: 'scheduling', at_ms: schedFlowNow_(), prune: true });
}

/* ---- the call-off ---- */

/** Why this cell cannot be called off (or asked off), or null. */
function schedFlowHoldBar_(cell, nowMs) {
  if (cell && str_(cell.state) === 'called_off') return { status: 409, message: 'This shift is already called off.' };
  if (!cell || !schedFlowTimed_(cell)) return { status: 400, message: 'There is no timed shift in that cell.' };
  if (!schedFlowHolds_(cell)) return { status: 409, message: 'Nobody holds this shift right now (' + str_(cell.state) + ').' };
  if (schedFlowEnded_(cell.date, cell.end_min, nowMs)) return { status: 409, message: 'This shift has already ended.' };
  return null;
}

// Applies a call-off under the caller's lock: the person's cell becomes `o.state` with `o.text`, keeping the…
function schedFlowCallOffApply_(o) {
  var nowMs = schedFlowNow_();
  var cell = o.cell;
  var id = schedFlowNewId_('SF', o.house + '|' + o.rowId + '|' + o.date);
  var oldText = str_(cell.text);
  var cellFlow = o.parent_id || id;
  schedSetCell_(o.house, o.rowId, o.date,
                o.patch || { text: o.text, state: o.state, base: schedBaseOf_(cell), flow_id: cellFlow, source: 'flow:' + cellFlow },
                o.via, o.ctx, o.note || '', cellFlow);
  var open = schedOpenShift_(o.house, o.date, oldText, id, o.ctx, o.open_base || '') || {};
  var flow = schedFlowRow_({
    id: id, kind: 'call_off', state: 'outreach_1', house_code: o.house, date: o.date, row_id: o.rowId,
    person: str_(o.person.name), person_key: str_(o.person.key), person_uid: str_(o.person.uid),
    shift_text: oldText, start_min: Number(cell.start_min), end_min: Number(cell.end_min),
    open_row_id: str_(open.row_id), reason: str_(o.reason), note: str_(o.note), source: o.source,
    source_ref: str_(o.source_ref), outreach_stage: 0, outreach_next_at: schedFlowIso_(nowMs),
    created_by: str_(o.ctx && o.ctx.uid)
  });
  if (o.warn) {
    var dirs = schedFlowDirectors_(o.settings);
    if (!dirs.readable || !dirs.list.length) schedFlowNote_(flow, 'the directors were not warned: ' + dirs.why);
    var wait = schedFlowNum_(o.settings && o.settings.outreach_wait_min, 7);
    var title = 'Call off — ' + schedFlowDayWords_(o.date) + ' · ' + schedFlowShiftWords_(flow) + ' · ' +
                schedFlowHouseWord_(o.house);
    var body = str_(o.person.name) + ' called off' + (str_(o.reason) ? ' (' + str_(o.reason) + ')' : '') + '. ' +
               (o.source === 'editor' ? 'Marked by ' + str_(o.ctx && o.ctx.name) + '. ' : '') +
               (o.source === 'hotline' ? 'Heard on the hotline. ' : '') +
               'The shift is open at the top of ' + schedFlowHouseWord_(o.house) + '; the house is texted first, ' +
               'then everyone after ' + wait + ' minutes if it is still open.';
    schedInbox_(dirs.list.map(function (d) { return schedFlowItem_(flow, 'inbox', 'warning', 'director', d, title, body); }));
  }
  schedUpsert_('sched_flows', [flow]);
  schedFlowDueLower_(nowMs);
  return flow;
}

/** Expires a waiting Request Off, swap or training on a cell that has just been given up (called off or time off). */
function schedFlowExpireOn_(house, rowId, date, by) {
  var busy = schedFlowCellBusy_(house, rowId, date);
  if (!busy) return;
  schedFlowClose_(busy, 'expired', by);
  schedFlowNote_(busy, 'the shift was given up (called off or time off)');
  schedUpsert_('sched_flows', [busy]);
  schedFlowItemsSettle_(busy.id, '', 'closed', by);
  // a swap's other side is told it ended — never who gave the shift up nor why
  if (busy.kind !== 'swap') return;
  var own = str_(busy.house_code) === str_(house) && str_(busy.row_id) === str_(rowId) && str_(busy.date) === str_(date);
  var to = own ? { uid: busy.replacement_uid, name: busy.replacement, email: '' } : { uid: busy.person_uid, name: busy.person, email: '' };
  if (!str_(to.uid)) return;
  schedInbox_([schedFlowItem_(busy, 'inbox', 'info', own ? 'staff' : 'requester', to, 'Swap ended — ' + schedFlowSwapWhere_(busy),
    own ? 'The shift it was about was given up, so the swap ended before it was approved.'
        : 'The other shift in it was given up, so the swap ended before it was approved. Your shift is still yours.')]);
}

/** An editor gave a call-off's OPEN shift to somebody (Scheduling.gs schedAssignOpen_): its outreach is covered. */
function schedFlowCoveredBy_(flowId, by) {
  var co = schedFlowFlowById_(flowId);
  if (!co || co.kind !== 'call_off' || SCHED_FLOW_OUTREACH.indexOf(str_(co.state)) === -1) return null;
  schedFlowClose_(co, 'covered', by);
  schedFlowNote_(co, 'assigned by ' + str_(by));
  co.outreach_next_at = '';
  schedUpsert_('sched_flows', [co]);
  return co;
}

// One row holds one cell a day: a person already working at this house that day cannot take a second shift there…
function schedFlowSameHouseBar_(house, key, date, name) {
  var had = schedCellAt_(house, 'P:' + key, date);
  var cls = had && str_(had.text) ? schedClassify_(had.text) : null;
  if (!cls || cls.kind === 'off') return null;
  return { status: 409, message: (name === null ? 'You already have ' : name + ' already has ') + str_(had.text) +
                                 ' at ' + schedFlowHouseWord_(house) + ' that day — a row holds one shift a day.' };
}

/* ---- the outreach: stage 1 to the house, stage 2 to everyone ---- */

/** Stage 1: the house managers, then that house's roster people free for the shift — never the caller. */
function schedFlowStage1Audience_(flow) {
  var out = { readable: true, people: [], busy: 0, why: '' };
  var seen = {};
  if (str_(flow.person_key)) seen[str_(flow.person_key)] = true;
  var add = function (key, name, seat) {
    if (!key || seen[key]) return;
    seen[key] = true;
    var phone = '';
    try { phone = str_(schedPhoneOf_(key)); } catch (e) { phone = ''; }
    out.people.push({ key: key, name: name, phone: phone, seat: seat });
  };
  try {
    (schedHouseManagers_(flow.house_code) || []).forEach(function (h) { add(str_(h.key), str_(h.name), 'house_manager'); });
  } catch (eH) { out.why = 'the house managers could not be read'; }
  var rows, holds;
  try { rows = schedRead_('sched_rows'); holds = schedHoldsNow_(); }
  catch (eR) { out.readable = false; out.why = 'the house roster could not be read: ' + String((eR && eR.message) || eR); return out; }
  rows.forEach(function (r) {
    var key = str_(r.person_key);
    if (str_(r.house_code) !== str_(flow.house_code) || str_(r.row_kind) !== 'person' || !key || seen[key]) return;
    if (str_(r.active) === 'no') return;
    var clash = null;
    try {
      clash = schedClash_(key, flow.date, Number(flow.start_min), Number(flow.end_min),
                          { holds: holds, house_code: str_(flow.house_code) }) ||
              schedFlowSameHouseBar_(flow.house_code, key, flow.date, str_(r.name));
    } catch (eC) { clash = { why: 'unreadable' }; }
    if (clash) { out.busy++; return; }
    add(key, str_(r.name), 'staff');
  });
  return out;
}

/** Stage 2: every active member of staff the platform can text (allstaff), less everyone stage 1 asked. */
function schedFlowStage2Audience_(flow, told) {
  var aud = null;
  try {
    aud = SMART_TO_KEYWORDS.allstaff.resolve({ person_key: str_(flow.person_key), date: str_(flow.date),
                                               name: str_(flow.person) });
  } catch (e) { aud = null; }
  if (!aud || !aud.readable) {
    return { readable: false, people: [], why: str_(aud && aud.why) || 'the staff list could not be read' };
  }
  var skip = {};
  (told || []).forEach(function (k) { skip[k] = true; });
  if (str_(flow.person_key)) skip[str_(flow.person_key)] = true;
  var people = [];
  (aud.people || []).forEach(function (p) {
    var k = str_(p.person_key);
    if (!k || skip[k]) return;
    skip[k] = true;
    people.push({ key: k, name: str_(p.name), phone: str_(p.phone), seat: 'everyone' });
  });
  return { readable: true, people: people, why: str_(aud.why) };
}

// Says one situation to a list, one key per person, inside a deadline and a per-ring cap (the rest are `left` for…
function schedFlowSendMany_(sit, people, vars, idemBase, already, deadline, cap) {
  var t = { asked: 0, sent: 0, held: 0, refused: 0, failed: 0, no_phone: 0, quiet: false, off: false, left: 0,
            told: (already || []).slice(), why: '' };
  var done = {};
  t.told.forEach(function (k) { done[k] = true; });
  var todo = people.filter(function (p) { return !done[p.key]; });
  for (var i = 0; i < todo.length; i++) {
    if (Date.now() > deadline) { t.left = todo.length - i; t.why = 'the time budget ran out — the rest are said on the next ring'; break; }
    if (cap && t.asked >= cap) { t.left = todo.length - i; t.why = 'the cap of ' + cap + ' texts a ring — the rest on the next ring'; break; }
    var p = todo[i];
    var res = schedText_(sit, p.phone, vars, idemBase + ':' + p.key, { key: p.key, name: p.name, ledger_key: idemBase });
    if (res.state === 'off') { t.off = true; t.why = res.why; break; }
    if (res.held === 'quiet') { t.quiet = true; t.left = todo.length - i; t.why = res.why; break; }
    t.asked++;
    if (res.state === 'sent' || res.state === 'already') t.sent++;
    else if (res.state === 'held') t.held++;
    else if (res.state === 'refused') t.refused++;
    else if (res.state === 'no_phone') t.no_phone++;
    else t.failed++;
    t.told.push(p.key);
  }
  return t;
}

/** A stage's ring, added to what its earlier rings already said (a stage resumed keeps its whole count). */
function schedFlowTally_(t, nowMs, extra, prev) {
  var p = prev || {};
  var add = function (k) { return Number(t[k] || 0) + Number(p[k] || 0); };
  var e = { at: schedFlowIso_(nowMs), asked: add('asked'), sent: add('sent'), held: add('held'), refused: add('refused'),
            failed: add('failed'), no_phone: add('no_phone'), told: t.told, why: t.why, off: !!t.off, left: t.left || 0 };
  for (var k in (extra || {})) if (Object.prototype.hasOwnProperty.call(extra, k)) e[k] = extra[k];
  return e;
}

/** One due call-off flow, one step: covered and ended stop it; the quiet window moves it to 08:00. */
function schedFlowStageRun_(flow, st, deadline, r) {
  var nowMs = schedFlowNow_();
  var log = schedFlowJson_(flow.outreach_log, {});
  var stage = Number(flow.outreach_stage) || 0;
  r.state = str_(flow.state);
  r.stage = stage;
  if (schedFlowEnded_(flow.date, flow.end_min, nowMs)) {
    r.state = 'stopped'; r.next_at = ''; r.why = 'the shift ended before the outreach finished';
    return r;
  }
  var open = null;
  try { open = schedCellAt_(flow.house_code, flow.open_row_id, flow.date); }
  catch (eO) { r.next_at = schedFlowIso_(nowMs + SCHED_FLOW_RETRY_MS); r.why = 'the open shift could not be read'; return r; }
  if (!open || str_(open.state) !== 'open' || str_(open.flow_id) !== str_(flow.id)) {
    r.state = 'covered'; r.next_at = ''; r.why = 'the open shift was filled';
    return r;
  }
  var key = stage === 0 ? 'stage1' : 'stage2';
  if (schedFlowQuiet_(nowMs)) {
    r.next_at = schedFlowIso_(schedFlowNext8_(nowMs));
    r.stageKey = key;
    r.stageEntry = Object.assign({}, log[key] || {}, { held_quiet_at: schedFlowIso_(nowMs), resumes_at: r.next_at });
    return r;
  }
  // the open-shift texts never carry who called off, whatever the Desk's words ask for
  var vars = schedFlowVars_(flow);
  delete vars.original;
  delete vars.replacement;
  if (stage === 0) {
    var prev = log.stage1 || {};
    var aud = schedFlowStage1Audience_(flow);
    if (!aud.readable) {
      r.next_at = schedFlowIso_(nowMs + SCHED_FLOW_RETRY_MS);
      r.stageKey = 'stage1';
      r.stageEntry = Object.assign({}, prev, { why: aud.why, retry_at: r.next_at });
      return r;
    }
    var t1 = schedFlowSendMany_('sched_calloff_house', aud.people, vars, 'sched:' + flow.id + ':s1', prev.told,
                                deadline, 0);
    r.stageKey = 'stage1';
    r.stageEntry = schedFlowTally_(t1, nowMs, { audience: aud.people.length, busy: aud.busy,
                                                 why: [t1.why, aud.why].filter(String).join(' · ') }, prev);
    if (t1.quiet) { r.state = 'outreach_1'; r.next_at = schedFlowIso_(schedFlowNext8_(nowMs)); return r; }
    if (t1.off) { r.state = 'outreach_1'; r.next_at = schedFlowIso_(nowMs + SCHED_FLOW_RETRY_MS); return r; }
    if (t1.left) { r.state = 'outreach_1'; r.next_at = schedFlowIso_(nowMs); return r; }
    r.state = 'outreach_wait';
    r.stage = 1;
    r.next_at = schedFlowIso_(nowMs + schedFlowNum_(st && st.outreach_wait_min, 7) * 60000);
    return r;
  }
  var told1 = (log.stage1 && log.stage1.told) || [];
  var prev2 = log.stage2 || {};
  var aud2 = schedFlowStage2Audience_(flow, told1);
  if (!aud2.readable) {
    r.next_at = schedFlowIso_(nowMs + SCHED_FLOW_RETRY_MS);
    r.stageKey = 'stage2';
    r.stageEntry = Object.assign({}, prev2, { why: aud2.why, retry_at: r.next_at });
    return r;
  }
  var blastEnd = Math.min(deadline, Date.now() + SCHED_FLOW_BLAST_BUDGET_MS);
  var t2 = schedFlowSendMany_('sched_calloff_everyone', aud2.people, vars, 'sched:' + flow.id + ':s2', prev2.told,
                              blastEnd, SCHED_FLOW_BLAST_MAX);
  r.stageKey = 'stage2';
  r.stageEntry = schedFlowTally_(t2, nowMs, { audience: aud2.people.length, resolver: aud2.why }, prev2);
  if (t2.quiet) { r.state = 'outreach_2'; r.next_at = schedFlowIso_(schedFlowNext8_(nowMs)); return r; }
  if (t2.off) { r.state = 'outreach_2'; r.next_at = schedFlowIso_(nowMs + SCHED_FLOW_RETRY_MS); return r; }
  if (t2.left) { r.state = 'outreach_2'; r.next_at = schedFlowIso_(nowMs); return r; }
  r.state = 'done';
  r.stage = 2;
  r.next_at = '';
  return r;
}

/** Says the owed one-off texts of a flow; a stale one (the flow moved on) is dropped and said so. */
function schedFlowSayOwed_(flow, deadline, r) {
  var nowMs = schedFlowNow_();
  var log = schedFlowJson_(flow.outreach_log, {});
  var owed = log.owed || [];
  if (!owed.length) return r;
  if (schedFlowQuiet_(nowMs)) { r.owed_next = schedFlowIso_(schedFlowNext8_(nowMs)); return r; }
  for (var i = 0; i < owed.length; i++) {
    var o = owed[i];
    if (Date.now() > deadline) { r.owed_next = schedFlowIso_(nowMs); break; }
    if (o.while && str_(flow.state) !== o.while) {
      r.handled.push(o.idem);
      r.texts.push({ sit: o.sit, key: o.key, state: 'stale', why: 'the flow moved on before it could be said',
                     at: schedFlowIso_(nowMs) });
      continue;
    }
    var phone = '';
    try { phone = str_(schedPhoneOf_(o.key)); } catch (eP) { phone = ''; }
    var res = schedText_(o.sit, phone, o.vars || {}, o.idem, { key: o.key, date: flow.date });
    if (res.held === 'quiet') { r.owed_next = schedFlowIso_(schedFlowNext8_(nowMs)); break; }
    r.handled.push(o.idem);
    r.texts.push({ sit: o.sit, key: o.key, state: res.state, held: res.held, why: res.why, at: schedFlowIso_(nowMs) });
  }
  return r;
}

/** Does this flow want the clock? A call-off still reaching out, or any flow owing a text. */
function schedFlowWants_(f) {
  if (f.kind === 'call_off' && SCHED_FLOW_OUTREACH.indexOf(str_(f.state)) !== -1) return true;
  return (schedFlowJson_(f.outreach_log, {}).owed || []).length > 0;
}

function schedFlowDuePut_(ms, nowMs) {
  try {
    var ttl = Math.max(60, Math.min(21600, Math.ceil((ms - nowMs) / 1000) + 60));
    CacheService.getScriptCache().put(SCHED_FLOW_DUE_KEY, String(Math.round(ms)), ttl);
  } catch (e) { /* an absent stamp is read as "look now" */ }
}

/** Brings the clock's next look forward to `ms` (never back). */
function schedFlowDueLower_(ms) {
  try {
    var c = CacheService.getScriptCache();
    var cur = c.get(SCHED_FLOW_DUE_KEY);
    if (cur === null || cur === undefined || cur === '' || Number(cur) > ms) {
      c.put(SCHED_FLOW_DUE_KEY, String(Math.round(ms)), 21600);
    }
  } catch (e) { /* an absent stamp is read as "look now" */ }
}

// Stamps the clock's next look: the earliest flow due, or now when today's look is still owed, else the next day's.
function schedFlowDueStamp_(flows, nowMs) {
  var due = Infinity;
  (flows || []).forEach(function (f) {
    if (!schedFlowWants_(f)) return;
    var at = Date.parse(str_(f.outreach_next_at));
    due = Math.min(due, isNaN(at) ? nowMs : at);
  });
  var looked = '';
  try { looked = PropertiesService.getScriptProperties().getProperty(SCHED_FLOW_ROLL_PROP); } catch (e) { looked = ''; }
  var today = schedFlowDay_(nowMs);
  due = Math.min(due, looked === today ? schedFlowMidnightMs_(schedFlowAddDays_(today, 1)) + 300000 : nowMs);
  schedFlowDuePut_(due, nowMs);
  return due;
}

// The clock's daily look, stamped once per Ohio day.
function schedFlowDayLook_(nowMs) {
  var today = schedFlowDay_(nowMs);
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(SCHED_FLOW_ROLL_PROP) === today) return { checked: false };
  props.setProperty(SCHED_FLOW_ROLL_PROP, today);
  return { checked: true };
}

// Requests nobody answered before their day: a Request Off, a swap or a training whose shift has ended, a time off…
function schedFlowExpireStale_(flows, nowMs) {
  var today = schedFlowDay_(nowMs), out = [];
  (flows || []).forEach(function (f) {
    if (SCHED_FLOW_WAITING.indexOf(str_(f.state)) === -1) return;
    var ex = schedFlowExchangeOf_(f);
    // an exchange cannot finish once either shift has begun
    var gone = ex ? !(schedFlowShiftMs_(f.date, f.start_min, f.end_min).start > nowMs) ||
                    !(schedFlowShiftMs_(ex.date, ex.start_min, ex.end_min).start > nowMs)
      : (f.kind === 'request_off' || f.kind === 'swap' || f.kind === 'training')
      ? schedFlowYmd_(f.date) && str_(f.end_min) !== '' && schedFlowEnded_(f.date, f.end_min, nowMs)
      : f.kind === 'time_off' && schedFlowYmd_(f.date) && str_(f.date) < today;
    if (!gone) return;
    schedFlowClose_(f, 'expired', 'the clock');
    schedFlowNote_(f, f.kind === 'training' ? 'nobody answered before the shift ended; it stood as a training'
                                            : 'nobody answered before the day');
    out.push(f);
  });
  if (!out.length) return out;
  schedUpsert_('sched_flows', out);
  var items = [];
  out.forEach(function (f) {
    schedFlowItemsSettle_(f.id, '', 'closed', 'the day passed');
    var what = f.kind === 'time_off'
      ? 'Time off — ' + schedFlowDayWords_(f.date) + ' to ' + schedFlowDayWords_(f.date_to || f.date)
      : f.kind === 'swap' ? 'Swap — ' + schedFlowSwapWhere_(f)
      : { request_off: 'Request Off', training: 'Training' }[f.kind] + ' — ' + schedFlowDayWords_(f.date) +
        ' · ' + schedFlowShiftWords_(f) + ' · ' + schedFlowHouseWord_(f.house_code);
    items.push(schedFlowItem_(f, 'inbox', 'info', f.kind === 'training' ? 'trainee' : 'requester',
      { uid: f.person_uid, name: f.person, email: '' }, 'Not answered in time — ' + what,
      f.kind === 'training' ? 'Nobody answered before the shift ended; it stood as a training with the house manager.'
                            : 'Nobody answered before the day, so it closed and nothing changed.'));
  });
  schedInbox_(items);
  return out;
}

// Claim → say → record.
function schedFlowWork_(ids, budgetMs, lockWaitMs, withClock) {
  var out = { ran: false, claimed: 0, why: '' };
  var started = Date.now();
  var nowMs = schedFlowNow_();
  var lock = LockService.getScriptLock();
  var got = false;
  try { got = lock.tryLock(lockWaitMs); } catch (eL) { got = false; }
  if (!got) { out.why = 'the calendar lock is busy'; return out; }
  schedMemoFresh_();
  var claimed = [], st = null;
  try {
    st = schedSettings_();
    if (withClock) out.expired = schedFlowExpireStale_(schedRead_('sched_flows'), nowMs).length;
    var flows = schedRead_('sched_flows'), write = [];
    flows.forEach(function (f) {
      if (!schedFlowWants_(f)) return;
      var at = Date.parse(str_(f.outreach_next_at));
      if (!(at > nowMs) && (!ids || ids.indexOf(str_(f.id)) !== -1)) {
        claimed.push(JSON.parse(JSON.stringify(f)));
        f.outreach_next_at = schedFlowIso_(nowMs + SCHED_FLOW_CLAIM_MS);
        f.updated_at = schedFlowIso_(nowMs);
        write.push(f);
      }
    });
    if (write.length) schedUpsert_('sched_flows', write);
    if (withClock) out.day = schedFlowDayLook_(nowMs);
    schedFlowDueStamp_(flows, nowMs);
  } catch (e) {
    out.why = String((e && e.message) || e).slice(0, 300);
    schedFlowLog_('scheduling_clock_failed', out.why, 500);
    if (withClock) schedFlowDuePut_(nowMs + SCHED_FLOW_RETRY_MS, nowMs);
    return out;
  } finally {
    try { schedSettle_(); } catch (eS) { /* released regardless */ }
    try { lock.releaseLock(); } catch (eR) { /* released by the runtime at the end */ }
    schedInboxShareMaybe_();
  }
  out.ran = true;
  out.claimed = claimed.length;
  var deadline = started + budgetMs;
  var results = claimed.map(function (f) {
    var r = { id: str_(f.id), state: '', stage: 0, next_at: '', why: '', handled: [], texts: [], owed_next: '' };
    try {
      if (f.kind === 'call_off' && SCHED_FLOW_OUTREACH.indexOf(str_(f.state)) !== -1) schedFlowStageRun_(f, st, deadline, r);
      schedFlowSayOwed_(f, deadline, r);
    } catch (eF) {
      r.why = String((eF && eF.message) || eF).slice(0, 200);
      r.next_at = schedFlowIso_(schedFlowNow_() + SCHED_FLOW_RETRY_MS);
    }
    return r;
  });
  out.recorded = schedFlowRecord_(results);
  if (withClock) out.phone = schedFlowPhoneCarry_();
  out.results = results;
  return out;
}

/** The outcomes, written onto the flows as they stand now. */
function schedFlowRecord_(results) {
  if (!results.length) return 0;
  var lock = LockService.getScriptLock();
  var got = false;
  try { got = lock.tryLock(15000); } catch (eL) { got = false; }
  if (!got) {
    schedFlowLog_('scheduling_outcomes_unrecorded',
                  results.length + ' flow(s): the lock was busy; the claim lapses and the clock asks again', 409);
    return 0;
  }
  var written = 0;
  schedMemoFresh_();
  try {
    var nowMs = schedFlowNow_();
    var byId = {};
    schedRead_('sched_flows').forEach(function (f) { byId[str_(f.id)] = f; });
    var write = [];
    results.forEach(function (r) {
      var cur = byId[r.id];
      if (!cur) return;
      var log = schedFlowJson_(cur.outreach_log, {});
      if (r.stageKey) log[r.stageKey] = r.stageEntry;
      if (r.handled.length) log.owed = (log.owed || []).filter(function (o) { return r.handled.indexOf(o.idem) === -1; });
      if (r.texts.length) log.texts = (log.texts || []).concat(r.texts).slice(-60);
      if (r.why && !r.stageKey) log.last_why = r.why;
      var reaching = cur.kind === 'call_off' && SCHED_FLOW_OUTREACH.indexOf(str_(cur.state)) !== -1;
      if (reaching && r.state) {
        cur.state = r.state;
        cur.outreach_stage = r.stage;
        if (SCHED_FLOW_OUTREACH.indexOf(r.state) === -1) {
          cur.closed_at = schedFlowIso_(nowMs);
          cur.closed_by = 'outreach';
          if (r.why) schedFlowNote_(cur, r.why);
        }
      }
      var next = '';
      if (cur.kind === 'call_off' && SCHED_FLOW_OUTREACH.indexOf(str_(cur.state)) !== -1) {
        next = r.next_at || schedFlowIso_(nowMs + SCHED_FLOW_RETRY_MS);
      }
      if ((log.owed || []).length) {
        var ow = r.owed_next || schedFlowIso_(nowMs);
        if (!next || Date.parse(ow) < Date.parse(next)) next = ow;
      }
      cur.outreach_next_at = next;
      cur.outreach_log = JSON.stringify(log);
      cur.updated_at = schedFlowIso_(nowMs);
      write.push(cur);
    });
    if (write.length) schedUpsert_('sched_flows', write);
    written = write.length;
    schedFlowDueStamp_(Object.keys(byId).map(function (k) { return byId[k]; }), nowMs);
  } catch (e) {
    schedFlowLog_('scheduling_outcomes_unrecorded', schedFlowErr_(e), 500);
  } finally {
    try { schedSettle_(); } catch (eS) { /* released regardless */ }
    try { lock.releaseLock(); } catch (eR) { /* */ }
    schedInboxShareMaybe_();
  }
  return written;
}

/** After a write: say what its flows owe now, inside a budget; the clock takes whatever is left. */
function schedFlowKick_(ids) {
  if (!ids || !ids.length) return null;
  try { return schedFlowWork_(ids, SCHED_FLOW_INLINE_BUDGET_MS, 10000, false); }
  catch (e) { return { ran: false, why: String((e && e.message) || e) }; }
}

// THE CLOCK — called at the top of HUB_ACTIONS.hiringSweep on every ring.
function schedulingClockTick_() {
  var nowMs = schedFlowNow_();
  try {
    var due = CacheService.getScriptCache().get(SCHED_FLOW_DUE_KEY);
    if (due !== null && due !== undefined && due !== '' && Number(due) > nowMs) return { ran: false, due: Number(due) };
  } catch (e) { return { ran: false, why: 'the cache could not be read' }; }
  try { return schedFlowWork_(null, SCHED_FLOW_TICK_BUDGET_MS, 0, true); }
  catch (e2) { return { ran: false, why: String((e2 && e2.message) || e2) }; }
}

/* ---- the actions ---- */

// The write answer, the same envelope as Scheduling.gs schedAnswer_: the sentence, the flow, and the houses re-read…
function schedFlowWriteAnswer_(g, said, flowId, date, houses, keys) {
  var per = null;
  try { per = schedPeriodOf_(date); } catch (e) { per = null; }
  var data = { ok: true, said: said, flow_id: flowId || '', period_id: (per && per.id) || '', grids: {}, busy: {},
               test_mode: null };
  try {
    var part = schedBoardPart_(g, data.period_id, houses || [], keys || []) || {};
    data.grids = part.grids || {};
    data.busy = part.busy || {};
    data.mine = part.mine || [];
    data.waiting_on_me = part.waiting_on_me || [];
    if (part.log) data.log = part.log;
  } catch (eB) {
    data.reread = 'Saved — but the calendar could not be read back just now; refresh to see it.';
  }
  try { data.test_mode = schedTestMode_(); }
  catch (eT) { data.test_mode = { on: true, readable: false, why: 'the test-mode switch could not be read' }; }
  return { status: 200, data: data };
}

// A clash refused in the one sentence the editor's Add Shift refuses with (Scheduling.gs schedClashSentence_); a…
function schedFlowClashWords_(name, clash, g, key) {
  try { return str_(schedClashSentence_(name, clash, g || null, key || '')) || 'Not possible: ' + name + ' is not free then.'; }
  catch (e) { return 'Not possible: ' + name + ' is not free then.'; }
}

function schedFlowShiftParams_(p) {
  return { house: schedFlowText_(p.house, 40), rowId: schedFlowText_(p.row_id, 120), date: schedFlowText_(p.date, 10) };
}

HUB_POLICY.schedulingCallOff = {
  file: 'SchedulingFlows.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: ['smsSend'],
  params: { house: { type: 'string' }, row_id: { type: 'string' }, date: { type: 'string' },
            reason: { type: 'string' } }
};
HUB_ACTIONS.schedulingCallOff = function (payload, user) {
  var g = schedFlowGate_(user);
  if (!g.open) return schedRefuse_(404, 'Unknown action.');
  var p = payload || {};
  var s = schedFlowShiftParams_(p);
  var reason = schedFlowText_(p.reason, 500);
  if (!s.house || !schedFlowYmd_(s.date) || s.rowId.indexOf('P:') !== 0) {
    return schedRefuse_(400, 'Pick the person\'s shift to call off: its house, row and day.');
  }
  var own = !!g.key && s.rowId === 'P:' + g.key;
  if (!own && !schedFlowEditor_(g, s.house)) return schedRefuse_(403, 'Only your own shift can be called off here.');
  var flow = null;
  try {
    var res = schedLock_(function () {
      var nowMs = schedFlowNow_();
      var cell = schedCellAt_(s.house, s.rowId, s.date);
      var bar = schedFlowHoldBar_(cell, nowMs);
      if (bar) return bar;
      var st = schedSettings_();
      var row = schedFlowRowOf_(s.house, s.rowId) || {};
      var key = s.rowId.slice(2);
      var who = own ? { name: g.name, key: g.key, uid: g.uid } : { name: str_(row.name) || key, key: key, uid: '' };
      if (!own) { try { who.uid = str_((schedUserByKey_(key) || {}).uid); } catch (eU) { who.uid = ''; } }
      schedFlowExpireOn_(s.house, s.rowId, s.date, g.name);
      return { ok: true, flow: schedFlowCallOffApply_({
        house: s.house, rowId: s.rowId, date: s.date, cell: cell, person: who, state: 'called_off', text: 'C/O',
        via: 'call_off', source: own ? 'platform' : 'editor', source_ref: '', reason: reason, ctx: g, warn: true,
        settings: st
      }) };
    });
    if (!res || res.status) return res || schedFlowFail_('no answer from the lock');
    flow = res.flow;
  } catch (e) { return schedFlowFail_(e); }
  var kick = schedFlowKick_([flow.id]);
  hubSysLog_(str_(user && user.email), 'schedulingCallOff', s.house + ' ' + s.date, { status: 200 });
  var said = 'Called off. The shift is open at the top of ' + schedFlowHouseWord_(s.house) + ' and the directors ' +
             'are warned; ' + schedFlowKickWords_(kick, schedFlowQuiet_(schedFlowNow_()));
  return schedFlowWriteAnswer_(g, said, flow.id, s.date, [s.house], [flow.person_key]);
};

/** What the house's stage-1 texts did, as the call-off says it: sent, held by test mode, waiting, or why none went. */
function schedFlowKickWords_(kick, quiet) {
  if (quiet) return 'the texts wait for 08:00 (quiet hours).';
  var r = kick && kick.ran && kick.results && kick.results[0];
  var e = r && r.stageKey === 'stage1' ? r.stageEntry : null;
  if (!e || e.held_quiet_at) return 'the house is texted on the next clock ring.';
  if (e.off) return 'no text went out: ' + str_(e.why) + '. It is tried again every ten minutes.';
  var n = function (x, one, many) { return x + ' ' + (x === 1 ? one : many); };
  var parts = [];
  if (e.sent) parts.push(n(e.sent, 'text to the house went out', 'texts to the house went out'));
  if (e.held) parts.push(n(e.held, 'text was held by test mode', 'texts were held by test mode') + ' — nobody was contacted');
  if (e.no_phone) parts.push(n(e.no_phone, 'person has', 'people have') + ' no phone to text');
  if (e.refused || e.failed) parts.push(n(e.refused + e.failed, 'text was', 'texts were') + ' refused or failed');
  if (!parts.length) parts.push('nobody at the house was free to text; everyone is texted after the wait');
  return parts.join('; ') + (e.left ? '; the rest go out on the next clock ring.' : '.');
}

HUB_POLICY.schedulingRequestOff = {
  file: 'SchedulingFlows.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, row_id: { type: 'string' }, date: { type: 'string' },
            note: { type: 'string' } }
};
HUB_ACTIONS.schedulingRequestOff = function (payload, user) {
  var g = schedFlowGate_(user);
  if (!g.open) return schedRefuse_(404, 'Unknown action.');
  var p = payload || {};
  var s = schedFlowShiftParams_(p);
  var note = schedFlowText_(p.note, 500);
  if (!s.house || !schedFlowYmd_(s.date)) return schedRefuse_(400, 'Pick your shift: its house, row and day.');
  if (!g.key || s.rowId !== 'P:' + g.key) return schedRefuse_(403, 'Request Off is for your own shift.');
  var flow = null;
  try {
    var res = schedLock_(function () {
      var nowMs = schedFlowNow_();
      var st = schedSettings_();
      var min = schedFlowNum_(st.min_days_ahead, 7);
      if (s.date < schedFlowAddDays_(schedFlowDay_(nowMs), min)) {
        return { status: 409, message: 'Request Off needs at least ' + min + ' days\' notice — inside that, use Call Off or Swap.' };
      }
      var cell = schedCellAt_(s.house, s.rowId, s.date);
      var bar = schedFlowHoldBar_(cell, nowMs);
      if (bar) return bar;
      var busy = schedFlowCellBusy_(s.house, s.rowId, s.date);
      if (busy) return schedFlowBusyWords_(busy);
      var dirs = schedFlowDirectors_(st);
      if (!dirs.readable) return { status: 503, message: 'Nobody can approve this right now: ' + dirs.why + '.' };
      var askable = dirs.list.filter(function (d) { return d.uid !== str_(g.uid); });
      if (!askable.length) return schedFlowNoDirector_(dirs);
      var f = schedFlowRow_({
        id: schedFlowNewId_('SF', s.house + '|' + s.rowId + '|' + s.date), kind: 'request_off', state: 'waiting',
        house_code: s.house, date: s.date, row_id: s.rowId, person: g.name, person_key: g.key, person_uid: g.uid,
        shift_text: str_(cell.text), start_min: Number(cell.start_min), end_min: Number(cell.end_min), note: note,
        source: 'platform', created_by: g.uid,
        seats: JSON.stringify([{ seat: 'director', to: askable, state: 'waiting', by: '', at: '', note: '', why: '' }])
      });
      schedUpsert_('sched_flows', [f]);
      var title = 'Request Off — ' + g.name + ' · ' + schedFlowDayWords_(s.date) + ' · ' + schedFlowShiftWords_(f) +
                  ' · ' + schedFlowHouseWord_(s.house);
      var body = (note ? '"' + note + '" — ' : '') + 'Approve to open the shift at the top of the house and start ' +
                 'the call-off outreach. The first director to answer decides.';
      schedInbox_(askable.map(function (d) { return schedFlowItem_(f, 'work', 'approval', 'director', d, title, body); }));
      return { ok: true, flow: f };
    });
    if (!res || res.status) return res || schedFlowFail_('no answer from the lock');
    flow = res.flow;
  } catch (e) { return schedFlowFail_(e); }
  hubSysLog_(str_(user && user.email), 'schedulingRequestOff', s.house + ' ' + s.date, { status: 200 });
  return schedFlowWriteAnswer_(g, 'Asked. Both directors have it in My Work; the first answer decides.', flow.id, s.date,
                       [s.house], [g.key]);
};

HUB_POLICY.schedulingTimeOff = {
  file: 'SchedulingFlows.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { from: { type: 'string' }, to: { type: 'string' }, reason: { type: 'string' } }
};
HUB_ACTIONS.schedulingTimeOff = function (payload, user) {
  var g = schedFlowGate_(user);
  if (!g.open) return schedRefuse_(404, 'Unknown action.');
  var p = payload || {};
  var asked = schedFlowTimeOffAsk_(g, p, 'platform');
  if (!asked || asked.status) return asked || schedFlowFail_('no answer from the lock');
  var flow = asked.flow;
  hubSysLog_(str_(user && user.email), 'schedulingTimeOff', flow.date + '..' + flow.date_to, { status: 200 });
  // the houses with the person's rows are read back, so their "time off asked" marks are drawn at once
  var homes = [];
  try {
    schedRead_('sched_rows').forEach(function (r) {
      if (str_(r.person_key) === g.key && str_(r.active) !== 'no' && homes.indexOf(str_(r.house_code)) === -1) {
        homes.push(str_(r.house_code));
      }
    });
  } catch (eH) { homes = []; }
  return schedFlowWriteAnswer_(g, 'Asked. Both directors have it in My Work; the first answer decides.', flow.id,
                               flow.date, homes, [g.key]);
};

// Files one time-off ask for the person `g` names: the checks, the flow and the directors' My Work items, under the…
function schedFlowTimeOffAsk_(g, p, via) {
  var from = schedFlowText_(p.from, 10), to = schedFlowText_(p.to, 10) || schedFlowText_(p.from, 10);
  var reason = schedFlowText_(p.reason, 500);
  if (!schedFlowYmd_(from) || !schedFlowYmd_(to)) return schedRefuse_(400, 'Pick the first and the last day off.');
  if (to < from) return schedRefuse_(400, 'The last day comes before the first.');
  if (to > schedFlowAddDays_(from, SCHED_FLOW_TIMEOFF_MAX_DAYS - 1)) {
    return schedRefuse_(400, 'Time off is asked for at most ' + SCHED_FLOW_TIMEOFF_MAX_DAYS + ' days at a time.');
  }
  if (!g.key) return schedRefuse_(403, 'Your account is not matched to one person on the calendar, so time off cannot be filed here.');
  var flow = null;
  try {
    var res = schedLock_(function () {
      var nowMs = schedFlowNow_();
      var st = schedSettings_();
      var min = schedFlowNum_(st.min_days_ahead, 7);
      if (from < schedFlowAddDays_(schedFlowDay_(nowMs), min)) {
        return { status: 409, message: 'Time off needs at least ' + min + ' days\' notice — inside that, use Call Off or Swap.' };
      }
      var clash = null;
      schedRead_('sched_flows').forEach(function (f) {
        if (f.kind !== 'time_off' || str_(f.person_key) !== g.key) return;
        if (['waiting', 'approved', 'approved_future'].indexOf(str_(f.state)) === -1) return;
        if (str_(f.date) <= to && (str_(f.date_to) || str_(f.date)) >= from) clash = f;
      });
      if (clash) {
        return { status: 409, message: 'You already have time off asked or approved from ' + clash.date + ' to ' +
                                       (clash.date_to || clash.date) + '.' };
      }
      var dirs = schedFlowDirectors_(st);
      if (!dirs.readable) return { status: 503, message: 'Nobody can approve this right now: ' + dirs.why + '.' };
      var askable = dirs.list.filter(function (d) { return d.uid !== str_(g.uid); });
      if (!askable.length) return schedFlowNoDirector_(dirs);
      var f = schedFlowRow_({
        id: schedFlowNewId_('SF', g.key + '|' + from + '|' + to), kind: 'time_off', state: 'waiting',
        date: from, date_to: to, row_id: 'P:' + g.key, person: g.name, person_key: g.key, person_uid: g.uid,
        reason: reason, source: 'platform', source_ref: via === 'my-calendar' ? 'my-calendar' : '', created_by: g.uid,
        seats: JSON.stringify([{ seat: 'director', to: askable, state: 'waiting', by: '', at: '', note: '', why: '' }])
      });
      schedUpsert_('sched_flows', [f]);
      var title = 'Time off — ' + g.name + ' · ' + schedFlowDayWords_(from) + ' to ' + schedFlowDayWords_(to);
      var body = (reason ? '"' + reason + '" — ' : '') + 'Approve to put every shift of theirs in those days up as ' +
                 'an open shift; days beyond the last calendar period are applied when the roll creates them.';
      schedInbox_(askable.map(function (d) { return schedFlowItem_(f, 'work', 'approval', 'director', d, title, body); }));
      return { ok: true, flow: f };
    });
    if (!res || res.status) return res || schedFlowFail_('no answer from the lock');
    flow = res.flow;
  } catch (e) { return schedFlowFail_(e); }
  return { ok: true, flow: flow };
}

HUB_POLICY.schedulingSwapPropose = {
  file: 'SchedulingFlows.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: ['smsSend'],
  params: { house: { type: 'string' }, row_id: { type: 'string' }, date: { type: 'string' },
            replacement: { type: 'string' }, partner_house: { type: 'string' },
            partner_row_id: { type: 'string' }, partner_date: { type: 'string' }, note: { type: 'string' },
            override: { type: 'boolean' } }
};

/** The asker's optional note, as the partner's My Work item quotes it. */
function schedFlowAskNote_(p) {
  var note = schedFlowText_(p && p.note, 500);
  return { note: note, line: note ? ' "' + note + '"' : '' };
}
// A swap.
HUB_ACTIONS.schedulingSwapPropose = function (payload, user) {
  var g = schedFlowGate_(user);
  if (!g.open) return schedRefuse_(404, 'Unknown action.');
  var p = payload || {};
  var s = schedFlowShiftParams_(p);
  var rep = schedFlowText_(p.replacement, 120);
  if (!s.house || !schedFlowYmd_(s.date)) return schedRefuse_(400, 'Pick your shift: its house, row and day.');
  if (str_(p.partner_house) || str_(p.partner_row_id) || str_(p.partner_date)) return schedFlowExchangePropose_(g, s, p, user);
  var own = !!g.key && s.rowId === 'P:' + g.key;
  var behalf = !own && /^P:./.test(s.rowId) && !!(g.is_master || g.is_director);
  if (!own && !behalf) return schedRefuse_(403, 'A swap is for your own shift.');
  var holderKey = own ? g.key : s.rowId.slice(2);
  if (!rep || rep === holderKey) return schedRefuse_(400, 'Pick who takes the shift — somebody other than the person on it.');
  var asked = schedFlowAskNote_(p);
  var flow = null, crossed = null;
  try {
    var res = schedLock_(function () {
      var nowMs = schedFlowNow_();
      var cell = schedCellAt_(s.house, s.rowId, s.date);
      var bar = schedFlowHoldBar_(cell, nowMs);
      if (bar) return bar;
      var busy = schedFlowCellBusy_(s.house, s.rowId, s.date);
      if (busy) return schedFlowBusyWords_(busy);
      var who = schedUserByKey_(rep);
      if (!who || !str_(who.uid)) return { status: 400, message: 'Pick somebody with a platform account — they answer in My Work.' };
      var held = own ? { uid: str_(g.uid), name: str_(g.name) } : (schedUserByKey_(holderKey) || {});
      var holder = { key: holderKey, uid: str_(held.uid), name: str_(held.name) || holderKey };
      if (holder.uid && str_(who.uid) === holder.uid) return { status: 400, message: 'Pick somebody other than the person on the shift.' };
      var clash = schedClash_(rep, s.date, Number(cell.start_min), Number(cell.end_min), { house_code: s.house });
      if (clash) return { status: 409, message: schedFlowClashWords_(str_(who.name) || rep, clash, g, rep) };
      var twice = schedFlowSameHouseBar_(s.house, rep, s.date, str_(who.name) || rep);
      if (twice) return twice;
      crossed = schedPrefsAgainst_(rep, str_(who.name) || rep, s.house, s.date);
      if (crossed && p.override !== true) return schedPrefsRefusal_(crossed);
      var st = schedSettings_();
      var dirs = schedFlowDirectors_(st);
      if (!dirs.readable) return { status: 503, message: 'Nobody can approve a swap right now: ' + dirs.why + '.' };
      if (!dirs.list.some(function (d) { return d.uid !== str_(g.uid) && d.uid !== str_(who.uid) && d.uid !== holder.uid; })) {
        return { status: 409, message: 'There is no director outside this swap who can approve it.' };
      }
      var repName = str_(who.name) || rep;
      var to = { uid: str_(who.uid), name: repName, email: str_(who.email) };
      var f = schedFlowRow_({
        id: schedFlowNewId_('SF', s.house + '|' + s.rowId + '|' + s.date + '|' + rep), kind: 'swap',
        state: 'waiting_staff', house_code: s.house, date: s.date, row_id: s.rowId, person: holder.name,
        person_key: holder.key, person_uid: holder.uid, shift_text: str_(cell.text), start_min: Number(cell.start_min),
        end_min: Number(cell.end_min), replacement: repName, replacement_key: rep, replacement_uid: to.uid,
        source: 'platform', created_by: g.uid, note: asked.note,
        seats: JSON.stringify([{ seat: 'staff', to: [to], state: 'waiting', by: '', at: '', note: '', why: '' }])
      });
      if (crossed) schedFlowNote_(f, SCHED_PREFS_OVERRIDE_NOTE);
      schedFlowOwe_(f, 'sched_swap_ask', rep, schedFlowVars_(f), 'waiting_staff');
      schedUpsert_('sched_flows', [f]);
      schedInbox_([schedFlowItem_(f, 'work', 'approval', 'staff', to, schedFlowSwapTitle_(f),
                                  (own ? g.name : g.name + ', for ' + holder.name + ',') +
                                  ' asks you to take this shift.' + asked.line +
                                  ' Then the house manager and a director approve.')]);
      return { ok: true, flow: f };
    });
    if (!res || res.status) return res || schedFlowFail_('no answer from the lock');
    flow = res.flow;
  } catch (e) { return schedFlowFail_(e); }
  schedFlowKick_([flow.id]);
  hubSysLog_(str_(user && user.email), 'schedulingSwapPropose', s.house + ' ' + s.date, { status: 200 });
  if (crossed) schedPrefsOverrideLog_(user, 'schedulingSwapPropose', s.house, s.date, rep, crossed);
  return schedFlowWriteAnswer_(g, 'Asked ' + flow.replacement + '. Next the house manager, then a director.', flow.id,
                       s.date, [s.house], [holderKey, flow.replacement_key]);
};

function schedFlowSwapTitle_(f) {
  if (schedFlowExchangeOf_(f)) return 'Swap — ' + str_(f.person) + ' ⇄ ' + str_(f.replacement) + ' · ' + schedFlowSwapWhere_(f);
  return 'Swap — ' + str_(f.person) + ' → ' + str_(f.replacement) + ' · ' + schedFlowSwapWhere_(f);
}

/** Where a swap is: its day, shift and house; an exchange's two shifts, each with its house and day. */
function schedFlowSwapWhere_(f) {
  var ex = schedFlowExchangeOf_(f);
  if (!ex) return schedFlowDayWords_(f.date) + ' · ' + schedFlowShiftWords_(f) + ' · ' + schedFlowHouseWord_(f.house_code);
  return schedFlowHouseWord_(f.house_code) + ' ' + schedFlowDayWords_(f.date) + ' ' + schedFlowShiftWords_(f) + ' ⇄ ' +
         schedFlowHouseWord_(ex.house) + ' ' + schedFlowDayWords_(ex.date) + ' ' + schedFlowExchangeShift_(ex);
}

/* ---- the exchange: two people's shifts change hands, at any houses ---- */

/** The partner's shift a swap takes back (outreach_log.exchange), or null for a one-sided swap. */
function schedFlowExchangeOf_(flow) {
  if (!flow || flow.kind !== 'swap') return null;
  var ex = schedFlowJson_(flow.outreach_log, {}).exchange;
  if (!ex || typeof ex !== 'object' || !str_(ex.house) || !/^P:./.test(str_(ex.row_id)) || !schedFlowYmd_(ex.date)) return null;
  return ex;
}

function schedFlowExchangeShift_(ex) {
  return schedFlowShiftWords_({ shift_text: ex.text, start_min: ex.start_min, end_min: ex.end_min });
}

function schedFlowExchangeVars_(flow) {
  var v = schedFlowVars_(flow);
  var ex = schedFlowExchangeOf_(flow) || {};
  v.their_house = schedFlowHouseWord_(ex.house);
  v.their_date = schedFlowDayWords_(ex.date);
  v.their_shift = schedFlowExchangeShift_(ex);
  return v;
}

/** One side of an exchange as the checks read it: where, whose row, the cell as it stands now. */
function schedFlowSide_(house, rowId, date, name, uid) {
  var cell = schedCellAt_(house, rowId, date);
  return { house: str_(house), rowId: str_(rowId), date: str_(date), key: str_(rowId).slice(2), name: str_(name),
           uid: str_(uid), cell: cell, text: str_(cell && cell.text), start: Number(cell && cell.start_min),
           end: Number(cell && cell.end_min) };
}

function schedFlowSideWords_(side) {
  return schedFlowHouseWord_(side.house) + ' ' + schedFlowDayWords_(side.date) + ' ' +
         (str_(schedShiftWords_({ text: side.text })) || side.text);
}

// Why two shifts cannot change hands, or null.
function schedFlowExchangeBar_(x, y, nowMs, g, selfId) {
  var sides = [x, y], i;
  for (i = 0; i < 2; i++) {
    if (!/^P:./.test(sides[i].rowId)) {
      return { status: 400, message: 'A swap is between two people\'s shifts — never an OPEN, workshop or other row.' };
    }
  }
  if (x.key === y.key) return { status: 400, message: 'Both shifts are ' + x.name + '\'s — pick somebody else\'s shift.' };
  for (i = 0; i < 2; i++) {
    var s = sides[i];
    if (!s.cell || !schedFlowTimed_(s.cell)) {
      return { status: 400, message: s.name + ' has no timed shift at ' + schedFlowHouseWord_(s.house) + ' on ' +
                                     schedFlowDayWords_(s.date) + '.' };
    }
    var at = s.name + '\'s ' + schedFlowSideWords_(s);
    var st = str_(s.cell.state) || 'scheduled';
    if (SCHED_FLOW_SWAPPABLE.indexOf(st) === -1) {
      return { status: 409, message: at + ' is ' + (SCHED_FLOW_STATE_WORDS[st] || st) + ', so it cannot be swapped.' };
    }
    if (!(schedFlowShiftMs_(s.date, s.start, s.end).start > nowMs)) return { status: 409, message: at + ' has already started.' };
    var busy = schedFlowCellBusy_(s.house, s.rowId, s.date, selfId);
    if (busy) {
      return { status: 409, message: at + (busy.kind === 'training' ? ' is waiting on a training approval.'
                                                                     : ' already has a request waiting on it.') };
    }
  }
  var legs = [[x, y], [y, x]];
  for (i = 0; i < 2; i++) {
    var me = legs[i][0], take = legs[i][1];
    var clash = schedClash_(me.key, take.date, take.start, take.end,
                            { house_code: take.house, ignore_cell_ids: [str_(me.cell.id)] });
    if (clash) return { status: 409, message: schedFlowClashWords_(me.name, clash, g, me.key) };
    var had = schedCellAt_(take.house, me.rowId, take.date);
    var cls = had && str_(had.id) !== str_(me.cell.id) && str_(had.text) ? schedClassify_(had.text) : null;
    if (cls && cls.kind !== 'off') {
      return { status: 409, message: me.name + ' already has ' + str_(had.text) + ' at ' + schedFlowHouseWord_(take.house) +
                                     ' that day — a row holds one shift a day.' };
    }
  }
  return null;
}

/** Who would land at a house without its IST: [{ who, house, need }] — a training there, never a refusal. */
function schedFlowExchangeTraining_(x, y) {
  var out = [];
  [[x, y], [y, x]].forEach(function (leg) {
    var need = null;
    try { need = schedTrainingNeed_(leg[1].house, leg[0].key); } catch (e) { need = null; }
    if (need) out.push({ who: leg[0], house: leg[1].house, need: need });
  });
  return out;
}

function schedFlowTrainingWords_(list) {
  return list.map(function (t) {
    return t.who.name + ' has no IST at ' + schedFlowHouseWord_(t.house) + ' (' + str_(t.need.why) + '), so works it ' +
           'there as a training with the house manager — the house manager and a director approve that too.';
  }).join(' ');
}

function schedFlowExchangePropose_(g, s, p, user) {
  var y0 = { house: schedFlowText_(p.partner_house, 40), rowId: schedFlowText_(p.partner_row_id, 120),
             date: schedFlowText_(p.partner_date, 10) };
  if (!y0.house || !y0.rowId || !schedFlowYmd_(y0.date)) return schedRefuse_(400, 'Pick their shift: its house, row and day.');
  if (!/^P:./.test(s.rowId) || !/^P:./.test(y0.rowId)) {
    return schedRefuse_(400, 'A swap is between two people\'s shifts — never an OPEN, workshop or other row.');
  }
  var own = !!g.key && s.rowId === 'P:' + g.key;
  // the master and the directors swap anybody's shifts on their behalf
  if (!own && !(g.is_master || g.is_director)) return schedRefuse_(403, 'A swap is for your own shift.');
  var aKey = s.rowId.slice(2), bKey = y0.rowId.slice(2);
  if (aKey === bKey) return schedRefuse_(400, 'Both shifts are the same person\'s — pick somebody else\'s shift.');
  var asked = schedFlowAskNote_(p);
  var flow = null, training = [], crossed = [];
  try {
    schedIstWarm_();
    var res = schedLock_(function () {
      var nowMs = schedFlowNow_();
      var held = own ? { uid: str_(g.uid), name: str_(g.name) } : (schedUserByKey_(aKey) || {});
      var who = schedUserByKey_(bKey);
      if (!who || !str_(who.uid)) return { status: 400, message: 'Pick somebody with a platform account — they answer in My Work.' };
      var x = schedFlowSide_(s.house, s.rowId, s.date, str_(held.name) || aKey, held.uid);
      var y = schedFlowSide_(y0.house, y0.rowId, y0.date, str_(who.name) || bKey, who.uid);
      if (x.uid && x.uid === y.uid) return { status: 400, message: 'Both shifts are the same person\'s — pick somebody else\'s shift.' };
      var bar = schedFlowExchangeBar_(x, y, nowMs, g, '');
      if (bar) return bar;
      crossed = [];
      [[x, y], [y, x]].forEach(function (leg) {
        var c = schedPrefsAgainst_(leg[0].key, leg[0].name, leg[1].house, leg[1].date);
        if (c) crossed.push({ key: leg[0].key, house: leg[1].house, date: leg[1].date, against: c });
      });
      if (crossed.length && p.override !== true) {
        return schedPrefsRefusal_({ why: crossed.map(function (c) { return c.against.why; }).join(' '), fields: [] });
      }
      var dirs = schedFlowDirectors_(schedSettings_());
      if (!dirs.readable) return { status: 503, message: 'Nobody can approve a swap right now: ' + dirs.why + '.' };
      if (!dirs.list.some(function (d) { return d.uid !== str_(g.uid) && d.uid !== x.uid && d.uid !== y.uid; })) {
        return { status: 409, message: 'There is no director outside this swap who can approve it.' };
      }
      var trained = schedFlowExchangeTraining_(x, y);
      var to = { uid: y.uid, name: y.name, email: str_(who.email) };
      var f = schedFlowRow_({
        id: schedFlowNewId_('SF', x.house + '|' + x.rowId + '|' + x.date + '|' + y.house + '|' + y.rowId + '|' + y.date),
        kind: 'swap', state: 'waiting_staff', house_code: x.house, date: x.date, row_id: x.rowId, person: x.name,
        person_key: x.key, person_uid: x.uid, shift_text: x.text, start_min: x.start, end_min: x.end,
        replacement: y.name, replacement_key: y.key, replacement_uid: y.uid, source: 'platform', created_by: g.uid,
        note: asked.note, outreach_log: JSON.stringify({ exchange: { house: y.house, row_id: y.rowId, date: y.date, text: y.text,
                                                   start_min: y.start, end_min: y.end } }),
        seats: JSON.stringify([{ seat: 'staff', to: [to], state: 'waiting', by: '', at: '', note: '', why: '' }])
      });
      if (crossed.length) schedFlowNote_(f, SCHED_PREFS_OVERRIDE_NOTE);
      schedFlowOwe_(f, 'sched_exchange_ask', y.key, schedFlowExchangeVars_(f), 'waiting_staff');
      schedUpsert_('sched_flows', [f]);
      schedInbox_([schedFlowItem_(f, 'work', 'approval', 'staff', to, schedFlowSwapTitle_(f),
        (own ? g.name : g.name + ', for ' + x.name + ',') + ' asks to swap: you take ' + schedFlowSideWords_(x) + ' and ' +
        x.name + ' takes your ' + schedFlowSideWords_(y) + '.' + asked.line + ' Then the house manager of each house and a director ' +
        'approve.' + (trained.length ? ' ' + schedFlowTrainingWords_(trained) : ''))]);
      return { ok: true, flow: f, training: trained };
    });
    if (!res || res.status) return res || schedFlowFail_('no answer from the lock');
    flow = res.flow;
    training = res.training || [];
  } catch (e) { return schedFlowFail_(e); }
  schedFlowKick_([flow.id]);
  hubSysLog_(str_(user && user.email), 'schedulingSwapPropose', s.house + ' ' + s.date + ' ⇄ ' + y0.house + ' ' + y0.date,
             { status: 200 });
  crossed.forEach(function (c) { schedPrefsOverrideLog_(user, 'schedulingSwapPropose', c.house, c.date, c.key, c.against); });
  var houses = [s.house];
  if (houses.indexOf(y0.house) === -1) houses.push(y0.house);
  return schedFlowWriteAnswer_(g, 'Asked ' + flow.replacement + '. Next the house manager of each house, then a director.' +
                               (training.length ? ' ' + schedFlowTrainingWords_(training) : ''), flow.id, s.date, houses,
                               [aKey, bKey]);
}

// A seat answered on an exchange.
function schedFlowDecideExchange_(flow, item, word, note, actor) {
  var seat = item.seat;
  var seats = schedFlowJson_(flow.seats, []);
  var nowIso = schedFlowIso_(schedFlowNow_());
  var mark = seats.filter(function (s) {
    if (s.seat !== seat || s.state !== 'waiting') return false;
    if (seat !== 'house_manager') return true;
    return str_(s.house) === str_(item.house_code) ||
           (s.to || []).some(function (t) { return str_(t.uid) === str_(actor.uid); });
  });
  mark.forEach(function (s) {
    s.state = word === 'approve' ? 'approved' : 'declined';
    s.by = actor.name;
    s.by_uid = str_(actor.uid);
    s.at = nowIso;
    s.note = note;
  });
  flow.seats = JSON.stringify(seats);
  var settled = mark.map(function (s) { return str_(s.house); }).filter(String);
  var where = schedFlowSwapWhere_(flow);
  if (word === 'decline') {
    schedFlowClose_(flow, 'declined', actor.name);
    schedFlowItemsSettle_(flow.id, '', 'closed', actor.name, item.id);
    var sit = { staff: 'sched_swap_declined_staff', house_manager: 'sched_swap_declined_manager',
                director: 'sched_swap_declined_director' }[seat];
    var who = { staff: flow.replacement + ' declined.',
                house_manager: 'The house manager of ' + schedFlowHouseWord_(item.house_code) + ' declined.',
                director: 'The director declined.' }[seat];
    schedFlowOwe_(flow, sit, flow.person_key, schedFlowVars_(flow), '');
    schedInbox_([schedFlowItem_(flow, 'inbox', 'info', 'requester', { uid: flow.person_uid, name: flow.person, email: '' },
      'Swap declined — ' + where, who + (note ? ' "' + note + '"' : '') + ' Both shifts stay as they were.')]);
    return { said: 'Declined. ' + flow.person + ' is told.' };
  }
  var answered = {};
  seats.forEach(function (s) { if (s.by_uid) answered[s.by_uid] = true; });
  [flow.person_uid, flow.replacement_uid, flow.created_by].forEach(function (u) { if (str_(u)) answered[str_(u)] = true; });
  var vars = schedFlowExchangeVars_(flow);
  if (seat === 'staff') return schedFlowExchangeManagers_(flow, seats, answered, vars);
  if (seat === 'house_manager') {
    var left = seats.filter(function (s) { return s.seat === 'house_manager' && s.state === 'waiting'; });
    var r = left.length
      ? { said: 'Approved. Waiting on the house manager of ' +
                left.map(function (s) { return schedFlowHouseWord_(s.house); }).join(' and ') + '.' }
      : schedFlowOpenDirectorSeat_(flow, seats, answered, vars, 'Approved. ');
    r.settle_houses = settled;
    return r;
  }
  return schedFlowExchangeComplete_(flow, actor);
}

/** B accepted: one house-manager seat per house involved, asked together; a house with nobody passes to the directors. */
function schedFlowExchangeManagers_(flow, seats, answered, vars) {
  var ex = schedFlowExchangeOf_(flow);
  var houses = [str_(flow.house_code)];
  if (houses.indexOf(str_(ex.house)) === -1) houses.push(str_(ex.house));
  var nowIso = schedFlowIso_(schedFlowNow_());
  var asked = [], items = [];
  houses.forEach(function (h) {
    var hms = [], why = '';
    try {
      (schedHouseManagers_(h) || []).forEach(function (m) {
        if (!str_(m.uid) || answered[str_(m.uid)]) return;
        if (str_(m.key) === str_(flow.person_key) || str_(m.key) === str_(flow.replacement_key)) return;
        if (hms.some(function (x) { return x.uid === str_(m.uid); })) return;
        hms.push({ uid: str_(m.uid), name: str_(m.name), email: str_(m.email), key: str_(m.key) });
      });
      if (!hms.length) why = schedFlowHouseWord_(h) + ' has no house manager with an account outside this swap, so the seat passes to the directors';
    } catch (eH) { why = 'the house managers of ' + schedFlowHouseWord_(h) + ' could not be read, so the seat passes to the directors'; }
    if (!hms.length) {
      seats.push({ seat: 'house_manager', house: h, to: [], state: 'skipped', by: '', at: nowIso, note: '', why: why });
      return;
    }
    seats.push({ seat: 'house_manager', house: h, to: hms.map(function (m) { return { uid: m.uid, name: m.name, email: m.email }; }),
                 state: 'waiting', by: '', at: '', note: '', why: '' });
    asked.push(h);
    var date = h === str_(flow.house_code) ? str_(flow.date) : str_(ex.date);
    hms.forEach(function (m) {
      schedFlowOwe_(flow, 'sched_exchange_ask', m.key, vars, 'waiting_manager');
      var it = schedFlowItem_(flow, 'work', 'approval', 'house_manager', m, schedFlowSwapTitle_(flow),
        flow.replacement + ' accepted. As the house manager of ' + schedFlowHouseWord_(h) + ', approve or decline; a ' +
        'director decides last.');
      it.house_code = h;
      it.link = schedFlowLink_(h, date);
      items.push(it);
    });
  });
  flow.seats = JSON.stringify(seats);
  if (!asked.length) return schedFlowOpenDirectorSeat_(flow, seats, answered, vars, 'Accepted. ');
  flow.state = 'waiting_manager';
  schedInbox_(items);
  var names = asked.map(function (h) { return schedFlowHouseWord_(h); });
  return { said: 'Accepted. The house manager' + (names.length > 1 ? 's of ' + names.join(' and ') + ' are'
                                                                     : ' of ' + names[0] + ' is') + ' asked next.' };
}

/** Every seat said yes: both shifts are checked again, then they change hands. */
function schedFlowExchangeComplete_(flow, actor) {
  var ex = schedFlowExchangeOf_(flow);
  var nowMs = schedFlowNow_();
  var x = schedFlowSide_(flow.house_code, flow.row_id, flow.date, flow.person, flow.person_uid);
  var y = schedFlowSide_(ex.house, ex.row_id, ex.date, flow.replacement, flow.replacement_uid);
  var stale = '';
  if (x.text !== str_(flow.shift_text) || y.text !== str_(ex.text)) stale = 'A shift changed on the calendar since it was asked.';
  if (!stale) {
    // said to both people: a call-off or time off of either is only "not free" (no asker who may know why)
    var bar = schedFlowExchangeBar_(x, y, nowMs, null, flow.id);
    if (bar) stale = bar.message;
  }
  // somebody new to a house without its IST works the shift there as a training
  var trained = stale ? [] : schedFlowExchangeTraining_(x, y);
  var st = trained.length ? schedSettings_() : null;
  trained.forEach(function (t) {
    if (stale) return;
    t.plan = schedTrainingPlan_(t.house, { name: t.who.name, key: t.who.key, uid: t.who.uid }, st);
    var m = str_(t.plan.message);
    if (t.plan.status) stale = t.who.name + ' would work it as a training, but ' + m.charAt(0).toLowerCase() + m.slice(1);
  });
  var where = schedFlowSwapWhere_(flow);
  if (stale) {
    schedFlowClose_(flow, 'expired', actor.name);
    schedFlowNote_(flow, stale);
    var t0 = 'Swap could not finish — ' + where, b0 = 'Every seat approved, but it could not finish: ' + stale + ' Nothing changed.';
    schedInbox_([schedFlowItem_(flow, 'inbox', 'info', 'requester', { uid: flow.person_uid, name: flow.person, email: '' }, t0, b0),
                 schedFlowItem_(flow, 'inbox', 'info', 'staff', { uid: flow.replacement_uid, name: flow.replacement, email: '' }, t0, b0)]);
    return { said: 'Approved, but the swap could not finish: ' + stale + ' Nothing changed.' };
  }
  var need = {};
  trained.forEach(function (t) { need[t.who.key] = t; });
  var tid = function (side, take) {
    return need[side.key] ? schedFlowNewId_('SF', take.house + '|' + side.rowId + '|' + take.date + '|training') : '';
  };
  var tidX = tid(x, y), tidY = tid(y, x);
  var put = function (side, take, tidOf, base) {
    var cf = tidOf || flow.id;
    return schedSetCell_(take.house, side.rowId, take.date, { text: take.text, state: tidOf ? 'training' : 'swap_in', base: base,
                         flow_id: cf, source: 'flow:' + cf }, 'swap', actor, '', cf);
  };
  var placedX, placedY;
  // each side keeps its own pattern's base where it lands: the roll gives every shift back to its first holder
  if (x.house === y.house && x.date === y.date) {
    placedX = put(x, y, tidX, schedBaseOf_(x.cell));
    placedY = put(y, x, tidY, schedBaseOf_(y.cell));
  } else {
    var thereX = schedCellAt_(y.house, x.rowId, y.date), thereY = schedCellAt_(x.house, y.rowId, x.date);
    [x, y].forEach(function (side) {
      schedSetCell_(side.house, side.rowId, side.date, { text: '', state: 'swapped_out', base: schedBaseOf_(side.cell),
                    flow_id: flow.id, source: 'flow:' + flow.id }, 'swap', actor, '', flow.id);
    });
    schedFlowEnsureRow_(y.house, x.key, x.name, flow.id, actor);
    schedFlowEnsureRow_(x.house, y.key, y.name, flow.id, actor);
    placedX = put(x, y, tidX, schedBaseOf_(thereX));
    placedY = put(y, x, tidY, schedBaseOf_(thereY));
  }
  schedFlowClose_(flow, 'done', actor.name);
  var vars = schedFlowExchangeVars_(flow);
  schedFlowOwe_(flow, 'sched_exchange_done', x.key, vars, '');
  schedFlowOwe_(flow, 'sched_exchange_done', y.key, vars, '');
  var kick = [], notes = [], first = null;
  [[x, y, tidX, placedX], [y, x, tidY, placedY]].forEach(function (leg) {
    var t = need[leg[0].key];
    if (!t) return;
    schedTrainingOpen_({ id: leg[2], house: leg[1].house, date: leg[1].date, cell: leg[3],
                         person: { name: leg[0].name, key: leg[0].key, uid: leg[0].uid }, ist: t.need, source: 'swap',
                         source_ref: flow.id, ctx: actor, plan: t.plan, giver: leg[1].name });
    kick.push(leg[2]);
    if (!first) first = { flow_id: leg[2], why: str_(t.need.why) };
    notes.push(leg[0].name + ' works ' + schedFlowHouseWord_(leg[1].house) + ' as a training with the house manager (' +
               str_(t.need.why) + ')');
  });
  if (notes.length) schedFlowNote_(flow, notes.join('; '));
  var tail = notes.length ? ' ' + notes.join('; ') + ' — the house manager and a director approve it in My Work.' : '';
  schedInbox_([schedFlowItem_(flow, 'inbox', 'info', 'everyone', null,
    'Shifts swapped: ' + x.name + ' ⇄ ' + y.name + ' — ' + schedFlowSideWords_(x) + ' · ' + schedFlowSideWords_(y),
    'Approved by ' + actor.name + '. ' + x.name + ' now works ' + schedFlowSideWords_(y) + '; ' + y.name + ' works ' +
    schedFlowSideWords_(x) + '.' + tail)]);
  var said = { said: 'Approved. The swap is done: ' + x.name + ' has ' + schedFlowSideWords_(y) + ' and ' + y.name + ' has ' +
                     schedFlowSideWords_(x) + '.' + tail, kick: kick };
  if (first) said.training = first;
  return said;
}

HUB_POLICY.schedulingTake = {
  file: 'SchedulingFlows.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, row_id: { type: 'string' }, date: { type: 'string' }, override: { type: 'boolean' } }
};
HUB_ACTIONS.schedulingTake = function (payload, user) {
  var g = schedFlowGate_(user);
  if (!g.open) return schedRefuse_(404, 'Unknown action.');
  var s = schedFlowShiftParams_(payload || {});
  if (!s.house || !schedFlowYmd_(s.date) || s.rowId.indexOf('OPEN:') !== 0) return schedRefuse_(400, 'Pick an open shift.');
  if (!g.key) return schedRefuse_(403, 'Your account is not matched to one person on the calendar, so you cannot take a shift here.');
  var take = null, training = null, crossed = null;
  try {
    schedIstWarm_();
    var res = schedLock_(function () {
      var nowMs = schedFlowNow_();
      var open = schedCellAt_(s.house, s.rowId, s.date);
      if (!open || str_(open.state) !== 'open' || !str_(open.text)) {
        return { status: 409, message: 'Somebody else took this shift a moment ago.' };
      }
      if (!schedFlowTimed_(open)) return { status: 409, message: 'This open cell has no readable hours, so it cannot be taken here.' };
      if (schedFlowEnded_(s.date, open.end_min, nowMs)) return { status: 409, message: 'This shift has already ended.' };
      var clash = schedClash_(g.key, s.date, Number(open.start_min), Number(open.end_min), { house_code: s.house });
      if (clash) return { status: 409, message: schedFlowClashWords_(g.name, clash, g, g.key) };
      var twice = schedFlowSameHouseBar_(s.house, g.key, s.date, null);
      if (twice) return twice;
      crossed = schedPrefsAgainst_(g.key, g.name, s.house, s.date);
      if (crossed && (payload || {}).override !== true) return schedPrefsRefusal_(crossed);
      // somebody new to the house without its IST takes it as a training (refused here if nobody could approve it)
      var need = schedTrainingNeed_(s.house, g.key), plan = null;
      var me = { name: g.name, key: g.key, uid: g.uid };
      if (need) {
        plan = schedTrainingPlan_(s.house, me, schedSettings_());
        if (plan.status) return plan;
      }
      var myRow = 'P:' + g.key;
      var id = schedFlowNewId_('SF', s.house + '|' + s.rowId + '|' + s.date + '|take');
      var tid = need ? schedFlowNewId_('SF', s.house + '|' + myRow + '|' + s.date + '|training') : '';
      var f = schedFlowRow_({
        id: id, kind: 'take', state: 'done', house_code: s.house, date: s.date, row_id: myRow, person: g.name,
        person_key: g.key, person_uid: g.uid, shift_text: str_(open.text), start_min: Number(open.start_min),
        end_min: Number(open.end_min), open_row_id: s.rowId, source: 'platform', source_ref: str_(open.flow_id),
        created_by: g.uid
      });
      if (crossed) schedFlowNote_(f, SCHED_PREFS_OVERRIDE_NOTE);
      schedFlowClose_(f, 'done', g.name);
      schedFlowEnsureRow_(s.house, g.key, g.name, id, g);
      var mine = schedCellAt_(s.house, myRow, s.date);
      var cellFlow = tid || id;
      var placed = schedSetCell_(s.house, myRow, s.date, { text: str_(open.text), state: tid ? 'training' : 'taken',
                                 base: schedBaseOf_(mine), flow_id: cellFlow, source: 'flow:' + cellFlow }, 'take', g,
                                 crossed ? SCHED_PREFS_OVERRIDE_NOTE : '', cellFlow);
      // a call-off's OPEN cell is a one-off and goes; one that keeps a pattern (a genuinely open shift) keeps it
      var keepBase = str_(open.flow_id) ? str_(open.base) : str_(open.text);
      schedSetCell_(s.house, s.rowId, s.date, keepBase
        ? { text: '', state: 'taken', base: keepBase, flow_id: '', source: 'flow:' + id }
        : { text: '', state: '', base: '', flow_id: '', source: '' }, 'take', g, '', id);
      var co = str_(open.flow_id) ? schedFlowFlowById_(open.flow_id) : null;
      if (co && co.kind === 'call_off' && SCHED_FLOW_OUTREACH.indexOf(str_(co.state)) !== -1) {
        schedFlowClose_(co, 'covered', g.name);
        schedFlowNote_(co, 'taken by ' + g.name + (tid ? ' as a training' : ''));
        co.outreach_next_at = '';
        schedUpsert_('sched_flows', [co, f]);
      } else {
        schedUpsert_('sched_flows', [f]);
      }
      if (tid) {
        schedTrainingOpen_({ id: tid, house: s.house, date: s.date, cell: placed, person: me, ist: need, source: 'take',
                             source_ref: id, ctx: g, plan: plan });
      }
      var title = 'Open shift taken — ' + schedFlowDayWords_(s.date) + ' · ' + schedFlowShiftWords_(f) + ' · ' +
                  schedFlowHouseWord_(s.house);
      var body = g.name + ' took it on the Hub; the outreach for it stopped.' +
                 (tid ? ' ' + g.name + ' has no IST at ' + schedFlowHouseWord_(s.house) + ', so it is a training ' +
                        'waiting on the house manager and a director in My Work.' : '');
      var items = [];
      try {
        (schedHouseManagers_(s.house) || []).forEach(function (h) {
          if (str_(h.uid) && str_(h.uid) !== str_(g.uid)) items.push(schedFlowItem_(f, 'inbox', 'info', 'house_manager', h, title, body));
        });
      } catch (eH) { schedFlowNote_(f, 'the house managers could not be read'); }
      var dirs = schedFlowDirectors_();
      dirs.list.forEach(function (d) { items.push(schedFlowItem_(f, 'inbox', 'info', 'director', d, title, body)); });
      schedInbox_(items);
      return { ok: true, flow: f, training: tid ? { flow_id: tid, why: need.why } : null };
    });
    if (!res || res.status) return res || schedFlowFail_('no answer from the lock');
    take = res.flow;
    training = res.training;
  } catch (e) { return schedFlowFail_(e); }
  hubSysLog_(str_(user && user.email), 'schedulingTake', s.house + ' ' + s.date, { status: 200 });
  if (crossed) schedPrefsOverrideLog_(user, 'schedulingTake', s.house, s.date, g.key, crossed);
  var said = training
    ? 'It is yours as a training with the house manager, not as the DSP (' + training.why + '). The house manager and ' +
      'a director approve it in My Work; a decline puts it back up as an open shift.'
    : 'It is yours. The house manager and the directors are told.';
  var answer = schedFlowWriteAnswer_(g, said, take.id, s.date, [s.house], [g.key]);
  if (training && answer.data) answer.data.training = training;
  return answer;
};

/** The person's row at a house, added (or switched back on) when a swap or a take lands them there. */
function schedFlowEnsureRow_(house, key, name, flowId, ctx) {
  var rowId = 'P:' + key;
  var rows = schedRead_('sched_rows');
  var hit = null, order = 0, location = '';
  rows.forEach(function (r) {
    if (str_(r.house_code) !== str_(house)) return;
    order = Math.max(order, Number(r.order) || 0);
    if (!location) location = str_(r.location);
    if (str_(r.row_id) === rowId) hit = r;
  });
  var nowIso = schedFlowIso_(schedFlowNow_());
  if (hit) {
    if (str_(hit.active) === 'no') {
      hit.active = 'yes'; hit.updated_at = nowIso; hit.updated_by = str_(ctx && ctx.name);
      schedUpsert_('sched_rows', [hit]);
    }
    return hit;
  }
  var hex = schedFlowHex_(str_(house) + '|' + rowId, Utilities.DigestAlgorithm.SHA_1);
  var row = { id: 'SR_' + hex.slice(0, 16), house_code: str_(house), location: location, row_id: rowId,
              row_kind: 'person', name: str_(name) || key, person_key: key, designation: '', order: order + 1,
              active: 'yes', source: 'flow:' + flowId, updated_at: nowIso, updated_by: str_(ctx && ctx.name) };
  schedUpsert_('sched_rows', [row]);
  return row;
}

HUB_POLICY.schedulingWithdraw = {
  file: 'SchedulingFlows.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { flow_id: { type: 'string' } }
};
HUB_ACTIONS.schedulingWithdraw = function (payload, user) {
  var g = schedFlowGate_(user);
  if (!g.open) return schedRefuse_(404, 'Unknown action.');
  var flowId = schedFlowText_((payload || {}).flow_id, 20);
  if (!/^SF[0-9A-F]{10}$/.test(flowId)) return schedRefuse_(400, 'Which request? The flow id is missing.');
  var flow = null;
  try {
    var res = schedLock_(function () {
      var f = schedFlowFlowById_(flowId);
      if (!f) return { status: 404, message: 'That request is not on the calendar.' };
      if (f.kind === 'training') {
        return { status: 409, message: 'A training is not withdrawn: Call Off gives the shift up, and an editor can take it off the calendar.' };
      }
      var mineUid = str_(g.uid);
      if (!mineUid || (str_(f.created_by) !== mineUid && str_(f.person_uid) !== mineUid)) {
        return { status: 403, message: 'Only the person who asked can withdraw it.' };
      }
      if (SCHED_FLOW_WAITING.indexOf(str_(f.state)) === -1) {
        return { status: 409, message: 'This request is no longer waiting (' + str_(f.state) + ').' };
      }
      schedFlowClose_(f, 'withdrawn', g.name);
      schedUpsert_('sched_flows', [f]);
      schedFlowItemsSettle_(f.id, '', 'closed', g.name);
      return { ok: true, flow: f };
    });
    if (!res || res.status) return res || schedFlowFail_('no answer from the lock');
    flow = res.flow;
  } catch (e) { return schedFlowFail_(e); }
  hubSysLog_(str_(user && user.email), 'schedulingWithdraw', flowId, { status: 200 });
  return schedFlowWriteAnswer_(g, 'Withdrawn. Nothing on the calendar changed.', flow.id, flow.date,
                       flow.house_code ? [flow.house_code] : [], [g.key]);
};

/* ---- the answer from My Work ---- */

HUB_POLICY.schedulingAnswer = {
  file: 'SchedulingFlows.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: ['smsSend'],
  params: { item_id: { type: 'string' }, word: { type: 'string' }, note: { type: 'string' } }
};
// GATED BY THE SEAT, not by the app: the session's own account must be the item's `to_uid`, never the subject of…
HUB_ACTIONS.schedulingAnswer = function (payload, user) {
  if (!user || user.is_service) return schedRefuse_(404, 'Unknown action.');
  if (user.visiting_member || (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX)) {
    return { status: 403, message: 'Answer from your own account — not while visiting someone else.' };
  }
  var me = hubActingUserId_(user);
  if (!me) return schedRefuse_(404, 'Unknown action.');
  var p = payload || {};
  var itemId = schedFlowText_(p.item_id, 20);
  var word = schedFlowText_(p.word, 10).toLowerCase();
  var note = schedFlowText_(p.note, 500);
  if (!/^SI[0-9A-F]{10}$/.test(itemId)) return schedRefuse_(400, 'Which item? The item id is missing.');
  if (['approve', 'decline', 'seen'].indexOf(word) === -1) return schedRefuse_(400, 'Answer with approve or decline.');
  var actor = schedFlowActor_(user, schedFlowGate_(user));
  actor.uid = me;
  var out = null;
  try {
    // a swap's last seat can place somebody new to the house: the IST is read before the lock
    if (word === 'approve') schedIstWarm_();
    out = schedLock_(function () { return schedFlowAnswerLocked_(itemId, word, note, me, actor); });
    if (!out || out.status) return out || schedFlowFail_('no answer from the lock');
  } catch (e) { return schedFlowFail_(e); }
  if (out.kick && out.kick.length) schedFlowKick_(out.kick);
  hubSysLog_(str_(user.email), 'schedulingAnswer', itemId + ' ' + word, { status: 200 });
  var data = { ok: true, changed: out.changed !== false, said: out.said, state: out.state };
  if (out.training) data.training = out.training;
  return { status: 200, data: data };
};

function schedFlowAnswerLocked_(itemId, word, note, me, actor) {
  var nowIso = schedFlowIso_(schedFlowNow_());
  var item = null;
  schedRead_('sched_inbox').forEach(function (r) { if (str_(r.id) === itemId) item = r; });
  if (!item) return { status: 404, message: 'This item is not on the calendar any more.' };
  // the master is an eligible decider on every director seat, the answer recorded as the master's
  var standIn = str_(item.to_uid) !== me && !!(actor && actor.is_master) && item.box === 'work' &&
                item.seat === 'director';
  if (str_(item.to_uid) !== me && !standIn) return { status: 403, message: 'This item is waiting on someone else.' };
  if (item.box === 'inbox') {
    if (word !== 'seen') return { status: 400, message: 'An alert is only marked as seen.' };
    if (str_(item.answered_at)) return { ok: true, changed: false, said: 'Already marked as seen.', state: item.state };
    item.answered_by = actor.name;
    item.answered_at = nowIso;
    schedUpsert_('sched_inbox', [item]);
    return { ok: true, said: 'Marked as seen.', state: item.state };
  }
  if (word === 'seen') return { status: 400, message: 'Approve or decline this one.' };
  if (item.state !== 'waiting') {
    return { ok: true, changed: false, said: 'Already answered by ' + (str_(item.answered_by) || 'someone') + '.',
             state: item.state };
  }
  var flow = schedFlowFlowById_(item.flow_id);
  if (!flow) return { status: 404, message: 'The request behind this item is gone.' };
  if (str_(flow.person_uid) === me) return { status: 403, message: 'Nobody answers their own request.' };
  if (item.seat !== 'staff' && str_(flow.replacement_uid) === me) {
    return { status: 403, message: 'The person taking the shift cannot approve the swap too.' };
  }
  var exchange = !!schedFlowExchangeOf_(flow);
  if (exchange && item.seat !== 'staff' && str_(flow.created_by) === me) {
    return { status: 403, message: 'Whoever asked for the swap cannot approve it too.' };
  }
  if (standIn && schedFlowJson_(flow.seats, []).some(function (s) { return str_(s.by_uid) === me; })) {
    return { status: 403, message: 'You already answered another seat of this request.' };
  }
  var swapSeat = { staff: 'waiting_staff', house_manager: 'waiting_manager', director: 'waiting_director' };
  var wantState = { request_off: 'waiting', time_off: 'waiting', training: 'waiting' }[flow.kind] ||
                  (flow.kind === 'swap' ? swapSeat[item.seat] || '' : '');
  if (str_(flow.state) !== wantState) {
    item.state = 'closed'; item.answered_by = actor.name; item.answered_at = nowIso;
    schedUpsert_('sched_inbox', [item]);
    return { ok: true, changed: false, said: 'This request is no longer waiting on you (' + str_(flow.state) + ').',
             state: item.state };
  }
  // the decision's own writes first, the flow after them, the item and its siblings last: a write that fails part…
  var r;
  if (flow.kind === 'request_off') r = schedFlowDecideRequestOff_(flow, word, note, actor);
  else if (flow.kind === 'time_off') r = schedFlowDecideTimeOff_(flow, word, note, actor);
  else if (flow.kind === 'training') r = schedFlowDecideTraining_(flow, item, word, note, actor);
  else if (exchange) r = schedFlowDecideExchange_(flow, item, word, note, actor);
  else r = schedFlowDecideSwap_(flow, item.seat, word, note, actor);
  schedUpsert_('sched_flows', [flow]);
  item.state = word === 'approve' ? 'approved' : 'declined';
  item.answered_by = actor.name;
  item.answered_at = nowIso;
  item.note = note;
  schedUpsert_('sched_inbox', [item]);
  // an exchange's house-manager seats are one per house: an answer settles only the houses it sat for
  schedFlowItemsSettle_(flow.id, item.seat, 'superseded', actor.name, item.id, r.settle_houses);
  r.state = item.state;
  r.kick = [flow.id].concat(r.kick || []);
  return r;
}

function schedFlowSeatMark_(flow, seat, word, note, actor) {
  var seats = schedFlowJson_(flow.seats, []);
  var cur = null;
  seats.forEach(function (s) { if (s.seat === seat && s.state === 'waiting') cur = s; });
  if (cur) {
    cur.state = word === 'approve' ? 'approved' : 'declined';
    cur.by = actor.name;
    cur.by_uid = str_(actor.uid);
    cur.at = schedFlowIso_(schedFlowNow_());
    cur.note = note;
  }
  flow.seats = JSON.stringify(seats);
  return seats;
}

function schedFlowDecideRequestOff_(flow, word, note, actor) {
  schedFlowSeatMark_(flow, 'director', word, note, actor);
  var day = schedFlowDayWords_(flow.date), shift = schedFlowShiftWords_(flow), house = schedFlowHouseWord_(flow.house_code);
  var requester = { uid: flow.person_uid, name: flow.person, email: '' };
  var vars = schedFlowVars_(flow);
  if (word === 'decline') {
    schedFlowClose_(flow, 'declined', actor.name);
    vars.result = 'not approved: the shift is still yours';
    schedFlowOwe_(flow, 'sched_request_decided', flow.person_key, vars, '');
    schedInbox_([schedFlowItem_(flow, 'inbox', 'info', 'requester', requester,
      'Request Off not approved — ' + day + ' · ' + shift + ' · ' + house,
      'Not approved by ' + actor.name + (note ? ': "' + note + '"' : '.') + ' The shift is still yours.')]);
    return { said: 'Declined. ' + flow.person + ' is told.' };
  }
  var nowMs = schedFlowNow_();
  var cell = schedCellAt_(flow.house_code, flow.row_id, flow.date);
  if (schedFlowHoldBar_(cell, nowMs) || str_(cell.text) !== str_(flow.shift_text)) {
    schedFlowClose_(flow, 'expired', actor.name);
    schedFlowNote_(flow, 'the shift changed before it was approved');
    schedInbox_([schedFlowItem_(flow, 'inbox', 'info', 'requester', requester,
      'Request Off could not be applied — ' + day + ' · ' + shift + ' · ' + house,
      'Approved by ' + actor.name + ', but the shift had changed on the calendar, so nothing was done.')]);
    return { said: 'The shift changed since it was asked for, so nothing was done; ' + flow.person + ' is told.' };
  }
  var co = schedFlowCallOffApply_({
    house: flow.house_code, rowId: flow.row_id, date: flow.date, cell: cell,
    person: { name: flow.person, key: flow.person_key, uid: flow.person_uid }, state: 'requested_off', text: 'R/O',
    via: 'request_off', source: 'platform', source_ref: flow.id, parent_id: flow.id, reason: '', ctx: actor,
    warn: false, settings: schedSettings_()
  });
  flow.open_row_id = co.open_row_id;
  schedFlowClose_(flow, 'approved', actor.name);
  vars.result = 'approved: the shift is now open for cover';
  schedFlowOwe_(flow, 'sched_request_decided', flow.person_key, vars, '');
  var title = 'Request Off approved — ' + flow.person + ' · ' + day + ' · ' + shift + ' · ' + house;
  var body = 'Approved by ' + actor.name + '. The shift is open at the top of ' + house + ' and the call-off ' +
             'outreach has started.';
  var items = schedFlowDirectors_().list.map(function (d) { return schedFlowItem_(flow, 'inbox', 'info', 'director', d, title, body); });
  items.push(schedFlowItem_(flow, 'inbox', 'info', 'requester', requester, title, body));
  schedInbox_(items);
  return { said: 'Approved. The shift is open at the top of ' + house + ' and the outreach has started.', kick: [co.id] };
}

function schedFlowDecideTimeOff_(flow, word, note, actor) {
  schedFlowSeatMark_(flow, 'director', word, note, actor);
  var span = schedFlowDayWords_(flow.date) + ' to ' + schedFlowDayWords_(flow.date_to || flow.date);
  var requester = { uid: flow.person_uid, name: flow.person, email: '' };
  var vars = { dates: span };
  if (word === 'decline') {
    schedFlowClose_(flow, 'declined', actor.name);
    vars.result = 'not approved';
    schedFlowOwe_(flow, 'sched_timeoff_decided', flow.person_key, vars, '');
    schedInbox_([schedFlowItem_(flow, 'inbox', 'info', 'requester', requester, 'Time off not approved — ' + span,
      'Not approved by ' + actor.name + (note ? ': "' + note + '"' : '.') + ' Nothing on the calendar changed.')]);
    return { said: 'Declined. ' + flow.person + ' is told.' };
  }
  var nowMs = schedFlowNow_();
  var st = schedSettings_();
  var cells = schedRead_('sched_cells').filter(function (c) {
    return str_(c.row_id) === 'P:' + str_(flow.person_key) && str_(c.date) >= str_(flow.date) &&
           str_(c.date) <= str_(flow.date_to || flow.date);
  });
  var applied = [], future = [], kick = [];
  for (var day = str_(flow.date); day && day <= str_(flow.date_to || flow.date); day = schedFlowAddDays_(day, 1)) {
    if (!schedPeriodOf_(day)) { future.push(day); continue; }
    cells.forEach(function (c) {
      if (str_(c.date) !== day || !schedFlowHolds_(c) || schedFlowEnded_(day, c.end_min, nowMs)) return;
      schedFlowExpireOn_(str_(c.house_code), str_(c.row_id), day, actor.name);
      var co = schedFlowCallOffApply_({
        house: str_(c.house_code), rowId: str_(c.row_id), date: day, cell: c,
        person: { name: flow.person, key: flow.person_key, uid: flow.person_uid }, state: 'time_off', text: 'R/O',
        via: 'time_off', source: 'platform', source_ref: flow.id, parent_id: flow.id, reason: '', ctx: actor,
        warn: false, settings: st
      });
      applied.push({ date: day, house: str_(c.house_code), open_row_id: co.open_row_id, flow: co.id });
      kick.push(co.id);
    });
  }
  var log = schedFlowJson_(flow.outreach_log, {});
  log.applied = applied;
  log.future = future;
  flow.outreach_log = JSON.stringify(log);
  schedFlowClose_(flow, future.length ? 'approved_future' : 'approved', actor.name);
  if (future.length) flow.closed_at = '';
  vars.result = 'approved';
  schedFlowOwe_(flow, 'sched_timeoff_decided', flow.person_key, vars, '');
  var title = 'Time off approved — ' + flow.person + ' · ' + span;
  var body = 'Approved by ' + actor.name + '. ' + applied.length + ' shift(s) put up as open shifts with the ' +
             'call-off outreach' + (future.length ? '; ' + future.length + ' day(s) beyond the last calendar period ' +
             'are applied when the roll creates them' : '') + '.';
  var items = schedFlowDirectors_(st).list.map(function (d) { return schedFlowItem_(flow, 'inbox', 'info', 'director', d, title, body); });
  items.push(schedFlowItem_(flow, 'inbox', 'info', 'requester', requester, title, body));
  schedInbox_(items);
  return { said: 'Approved. ' + applied.length + ' shift(s) are open now' +
                 (future.length ? '; the days beyond the last period are kept for the roll' : '') + '.', kick: kick };
}

function schedFlowDecideSwap_(flow, seat, word, note, actor) {
  var seats = schedFlowSeatMark_(flow, seat, word, note, actor);
  var day = schedFlowDayWords_(flow.date), shift = schedFlowShiftWords_(flow), house = schedFlowHouseWord_(flow.house_code);
  var original = { uid: flow.person_uid, name: flow.person, email: '' };
  var vars = schedFlowVars_(flow);
  if (word === 'decline') {
    schedFlowClose_(flow, 'declined', actor.name);
    var sit = { staff: 'sched_swap_declined_staff', house_manager: 'sched_swap_declined_manager',
                director: 'sched_swap_declined_director' }[seat];
    var who = { staff: flow.replacement + ' declined.', house_manager: 'The house manager declined.',
                director: 'The director declined.' }[seat];
    schedFlowOwe_(flow, sit, flow.person_key, vars, '');
    schedInbox_([schedFlowItem_(flow, 'inbox', 'info', 'requester', original,
      'Swap declined — ' + day + ' · ' + shift + ' · ' + house, who + (note ? ' "' + note + '"' : '') +
      ' The shift is still yours.')]);
    return { said: 'Declined. ' + flow.person + ' is told.' };
  }
  var answered = {};
  seats.forEach(function (s) { if (s.by_uid) answered[s.by_uid] = true; });
  answered[str_(flow.person_uid)] = true;
  answered[str_(flow.replacement_uid)] = true;
  if (seat === 'staff') {
    var hms = [], why = '';
    try {
      (schedHouseManagers_(flow.house_code) || []).forEach(function (h) {
        if (!str_(h.uid)) return;
        if (str_(h.key) === str_(flow.person_key) || str_(h.key) === str_(flow.replacement_key) || answered[str_(h.uid)]) return;
        hms.push({ uid: str_(h.uid), name: str_(h.name), email: str_(h.email), key: str_(h.key) });
      });
      if (!hms.length) why = 'the house has no house manager with an account outside this swap, so the seat passes to the directors';
    } catch (eH) { why = 'the house managers could not be read, so the seat passes to the directors'; }
    if (hms.length) {
      seats.push({ seat: 'house_manager', to: hms.map(function (h) { return { uid: h.uid, name: h.name, email: h.email }; }),
                   state: 'waiting', by: '', at: '', note: '', why: '' });
      flow.seats = JSON.stringify(seats);
      flow.state = 'waiting_manager';
      hms.forEach(function (h) { schedFlowOwe_(flow, 'sched_swap_ask', h.key, vars, 'waiting_manager'); });
      schedInbox_(hms.map(function (h) {
        return schedFlowItem_(flow, 'work', 'approval', 'house_manager', h, schedFlowSwapTitle_(flow),
                              flow.replacement + ' accepted. As the house manager, approve or decline; a director decides last.');
      }));
      return { said: 'Accepted. The house manager is asked next.' };
    }
    seats.push({ seat: 'house_manager', to: [], state: 'skipped', by: '', at: schedFlowIso_(schedFlowNow_()), note: '', why: why });
    flow.seats = JSON.stringify(seats);
    return schedFlowOpenDirectorSeat_(flow, seats, answered, vars, 'Accepted. ');
  }
  if (seat === 'house_manager') return schedFlowOpenDirectorSeat_(flow, seats, answered, vars, 'Approved. ');
  return schedFlowSwapComplete_(flow, vars, actor);
}

function schedFlowOpenDirectorSeat_(flow, seats, answered, vars, lead) {
  var ex = schedFlowExchangeOf_(flow);
  var dirs = schedFlowDirectors_();
  var to = dirs.list.filter(function (d) { return !answered[d.uid]; });
  if (!to.length) {
    schedFlowClose_(flow, 'expired', 'the swap');
    var why = dirs.readable ? 'no director outside this swap is left to approve it' : dirs.why;
    schedFlowNote_(flow, why);
    schedInbox_([schedFlowItem_(flow, 'inbox', 'info', 'requester', { uid: flow.person_uid, name: flow.person, email: '' },
      'Swap could not finish — ' + schedFlowSwapWhere_(flow), 'It stopped before the last approval: ' + why + '. ' +
      (ex ? 'Both shifts stay as they were.' : 'The shift is still yours.'))]);
    return { said: lead + 'But ' + why + ', so the swap stopped.' };
  }
  seats.push({ seat: 'director', to: to, state: 'waiting', by: '', at: '', note: '', why: '' });
  flow.seats = JSON.stringify(seats);
  flow.state = 'waiting_director';
  to.forEach(function (d) {
    var dk = '';
    try { dk = clientNameKey_(d.name); } catch (e) { dk = ''; }
    if (dk) schedFlowOwe_(flow, ex ? 'sched_exchange_ask' : 'sched_swap_ask', dk, vars, 'waiting_director');
  });
  schedInbox_(to.map(function (d) {
    return schedFlowItem_(flow, 'work', 'approval', 'director', d, schedFlowSwapTitle_(flow), ex
      ? flow.replacement + ' accepted and the house manager seats are settled. The first director to answer decides; ' +
        'both shifts are checked again before they change hands.'
      : 'The replacement accepted and the house manager seat is settled. The first director to answer decides.');
  }));
  return { said: lead + 'A director is asked last.' };
}

/** Every seat said yes: the shift and the replacement are checked again, then the names change places. */
function schedFlowSwapComplete_(flow, vars, actor) {
  var nowMs = schedFlowNow_();
  var cell = schedCellAt_(flow.house_code, flow.row_id, flow.date);
  var stale = schedFlowHoldBar_(cell, nowMs) ? 'the shift changed on the calendar' :
              (str_(cell.text) !== str_(flow.shift_text) ? 'the shift changed on the calendar' : '');
  if (!stale) {
    var clash = schedClash_(flow.replacement_key, flow.date, Number(flow.start_min), Number(flow.end_min),
                            { house_code: str_(flow.house_code) });
    if (clash) stale = flow.replacement + ' is no longer free then';
  }
  if (!stale && schedFlowSameHouseBar_(flow.house_code, flow.replacement_key, flow.date, flow.replacement)) {
    stale = flow.replacement + ' now has another shift at ' + schedFlowHouseWord_(flow.house_code) + ' that day';
  }
  // a replacement new to the house without its IST takes the shift as a training
  var need = null, plan = null;
  var rep = { name: str_(flow.replacement), key: str_(flow.replacement_key), uid: str_(flow.replacement_uid) };
  if (!stale) {
    need = schedTrainingNeed_(flow.house_code, flow.replacement_key);
    if (need) {
      plan = schedTrainingPlan_(flow.house_code, rep, schedSettings_());
      if (plan.status) stale = flow.replacement + ' would work it as a training, and ' + str_(plan.message).replace(/\.$/, '');
    }
  }
  var day = schedFlowDayWords_(flow.date), shift = schedFlowShiftWords_(flow), house = schedFlowHouseWord_(flow.house_code);
  if (stale) {
    schedFlowClose_(flow, 'expired', actor.name);
    schedFlowNote_(flow, stale);
    var t = 'Swap could not finish — ' + day + ' · ' + shift + ' · ' + house;
    schedInbox_([schedFlowItem_(flow, 'inbox', 'info', 'requester', { uid: flow.person_uid, name: flow.person, email: '' }, t,
                                'Every seat approved, but ' + stale + ', so nothing changed.'),
                 schedFlowItem_(flow, 'inbox', 'info', 'staff', { uid: flow.replacement_uid, name: flow.replacement, email: '' }, t,
                                'Every seat approved, but ' + stale + ', so nothing changed.')]);
    return { said: 'Approved, but ' + stale + ', so the swap could not finish.' };
  }
  // each side keeps its own pattern's base: the giver the shift's (or, for a shift that came by a swap or a take…
  var text = str_(cell.text);
  var repRow = 'P:' + flow.replacement_key;
  var there = schedCellAt_(flow.house_code, repRow, flow.date);
  schedSetCell_(flow.house_code, flow.row_id, flow.date,
                { text: '', state: 'swapped_out', base: schedBaseOf_(cell), flow_id: flow.id, source: 'flow:' + flow.id },
                'swap', actor, '', flow.id);
  schedFlowEnsureRow_(flow.house_code, flow.replacement_key, flow.replacement, flow.id, actor);
  var tid = need ? schedFlowNewId_('SF', flow.house_code + '|' + repRow + '|' + flow.date + '|training') : '';
  var cellFlow = tid || flow.id;
  var placed = schedSetCell_(flow.house_code, repRow, flow.date,
                { text: text, state: tid ? 'training' : 'swap_in', base: schedBaseOf_(there), flow_id: cellFlow,
                  source: 'flow:' + cellFlow }, 'swap', actor, '', cellFlow);
  schedFlowClose_(flow, 'done', actor.name);
  schedFlowOwe_(flow, 'sched_swap_done', flow.person_key, vars, '');
  schedFlowOwe_(flow, 'sched_swap_done', flow.replacement_key, vars, '');
  if (tid) {
    schedFlowNote_(flow, flow.replacement + ' works it as a training (' + need.why + ')');
    schedTrainingOpen_({ id: tid, house: flow.house_code, date: flow.date, cell: placed, person: rep, ist: need,
                         source: 'swap', source_ref: flow.id, ctx: actor, plan: plan, giver: flow.person });
  }
  schedInbox_([schedFlowItem_(flow, 'inbox', 'info', 'everyone', null,
    'Shift swapped: ' + house + ' ' + day + ' ' + shift + ' — ' + flow.person + ' → ' + flow.replacement,
    'Approved by ' + actor.name + '.' + (tid ? ' ' + flow.replacement + ' works it as a training with the house ' +
    'manager, waiting on the house manager and a director.' : ''))]);
  if (!tid) return { said: 'Approved. The swap is done: ' + flow.replacement + ' has the shift.' };
  return { said: 'Approved. The swap is done: ' + flow.replacement + ' has the shift as a training with the house ' +
                 'manager (' + need.why + '); the house manager and a director are asked in My Work.',
           kick: [tid], training: { flow_id: tid, why: need.why } };
}

/* ---- training: somebody new to a house without its IST works a shift there beside the DSP ---- */

function schedTrainingTitle_(f) {
  return 'Training — ' + str_(f.person) + ' · ' + schedFlowDayWords_(f.date) + ' · ' + schedFlowShiftWords_(f) + ' · ' +
         schedFlowHouseWord_(f.house_code);
}

// The two seats of a training, both asked at once and never answered for anybody, whoever placed the person: the…
function schedTrainingPlan_(house, person, st) {
  var dirs = schedFlowDirectors_(st);
  if (!dirs.readable) return { status: 503, message: 'Nobody can approve a training right now: ' + dirs.why + '.' };
  var dirTo = dirs.list.filter(function (d) { return d.uid !== str_(person.uid); });
  if (!dirTo.length) {
    return { status: 409, message: 'There is no director who can approve this training: ' +
                                   (dirs.why || 'the only one is the person placed') + '.' };
  }
  var hms = [], why = '';
  try {
    (schedHouseManagers_(house) || []).forEach(function (h) {
      if (!str_(h.uid) || str_(h.key) === str_(person.key) || str_(h.uid) === str_(person.uid)) return;
      if (hms.some(function (x) { return x.uid === str_(h.uid); })) return;
      hms.push({ uid: str_(h.uid), name: str_(h.name), email: str_(h.email), key: str_(h.key) });
    });
    if (!hms.length) why = 'the house has no house manager with an account other than the trainee, so the seat passes to the directors';
  } catch (eH) { why = 'the house managers could not be read, so the seat passes to the directors'; }
  var nowIso = schedFlowIso_(schedFlowNow_());
  return {
    hms: hms, dirs: dirTo,
    seats: [
      { seat: 'house_manager', to: hms.map(function (h) { return { uid: h.uid, name: h.name, email: h.email }; }),
        state: hms.length ? 'waiting' : 'skipped', by: '', at: hms.length ? '' : nowIso, note: '', why: why },
      { seat: 'director', to: dirTo, state: 'waiting', by: '', at: '', note: '', why: '' }
    ]
  };
}

// The training flow, once the caller wrote the trainee's cell (state training, flow_id o.id) under its lock: both…
function schedTrainingOpen_(o) {
  var nowMs = schedFlowNow_();
  var cell = o.cell || {};
  var who = str_(o.person.name), by = str_(o.ctx && o.ctx.name);
  var how = { editor: 'Placed on the calendar by ' + by, assign: 'Given the open shift by ' + by,
              take: who + ' took the open shift on the Hub', swap: 'A swap with ' + str_(o.giver) }[o.source] || '';
  var f = schedFlowRow_({
    id: o.id, kind: 'training', state: 'waiting', house_code: o.house, date: o.date, row_id: 'P:' + str_(o.person.key),
    person: who, person_key: str_(o.person.key), person_uid: str_(o.person.uid), shift_text: str_(cell.text),
    start_min: Number(cell.start_min), end_min: Number(cell.end_min), seats: JSON.stringify(o.plan.seats),
    reason: str_(o.ist && o.ist.why), note: how + ' · IST ' + str_(o.ist && o.ist.state), source: o.source,
    source_ref: str_(o.source_ref), created_by: str_(o.ctx && o.ctx.uid)
  });
  var vars = schedFlowVars_(f);
  vars.trainee = who;
  var house = schedFlowHouseWord_(o.house), title = schedTrainingTitle_(f);
  var body = who + ' has no IST at ' + house + ' (' + str_(o.ist && o.ist.state) + '). ' + how + '; they work it as a ' +
             'training with the house manager, not as the DSP. Approve: the training stands. Decline: they leave the ' +
             'shift and it opens at the top with the call-off outreach. The house manager and a director both answer; ' +
             'one decline decides.';
  var items = [];
  o.plan.hms.forEach(function (h) {
    items.push(schedFlowItem_(f, 'work', 'approval', 'house_manager', h, title, body));
    schedFlowOwe_(f, 'sched_training_ask', h.key, vars, 'waiting');
  });
  o.plan.dirs.forEach(function (d) {
    items.push(schedFlowItem_(f, 'work', 'approval', 'director', d, title, body));
    var dk = '';
    try { dk = clientNameKey_(d.name); } catch (e) { dk = ''; }
    if (dk) schedFlowOwe_(f, 'sched_training_ask', dk, vars, 'waiting');
  });
  if (str_(o.person.uid)) {
    items.push(schedFlowItem_(f, 'inbox', 'info', 'trainee', { uid: o.person.uid, name: who, email: '' },
      'On a shift as a training — ' + schedFlowDayWords_(o.date) + ' · ' + schedFlowShiftWords_(f) + ' · ' + house,
      'There is no IST for you at ' + house + ' on file, so you work this shift as a training with the house manager, ' +
      'not as the DSP. The house manager and a director approve it; a decline takes you off the shift.'));
  }
  schedUpsert_('sched_flows', [f]);
  schedInbox_(items);
  schedFlowDueLower_(nowMs);
  return f;
}

/** The trainee, the house managers and the directors, each told the same thing (the directors as `dirKind`). */
function schedTrainingTold_(f, title, body, dirKind) {
  var items = [], seen = {};
  var add = function (seat, kind, to) {
    var uid = str_(to && to.uid);
    if (!uid || seen[seat + '|' + uid]) return;
    seen[seat + '|' + uid] = true;
    items.push(schedFlowItem_(f, 'inbox', kind, seat, { uid: uid, name: str_(to.name), email: str_(to.email) }, title, body));
  };
  add('trainee', 'info', { uid: f.person_uid, name: f.person });
  try {
    (schedHouseManagers_(f.house_code) || []).forEach(function (h) {
      if (str_(h.uid) !== str_(f.person_uid)) add('house_manager', 'info', h);
    });
  } catch (eH) { schedFlowNote_(f, 'the house managers could not be read to be told'); }
  schedFlowDirectors_().list.forEach(function (d) { if (d.uid !== str_(f.person_uid)) add('director', dirKind || 'info', d); });
  return items;
}

/** A seat answered on a training. Approve waits for the other seat; one decline decides. */
function schedFlowDecideTraining_(flow, item, word, note, actor) {
  var seats = schedFlowSeatMark_(flow, item.seat, word, note, actor);
  var vars = schedFlowVars_(flow);
  vars.trainee = str_(flow.person);
  if (word === 'decline') return schedTrainingDecline_(flow, actor, note, vars);
  // one person, one seat: what else waited on them in this training closes; a seat left with nobody is settled
  var other = item.seat === 'director' ? 'house_manager' : 'director';
  var nowIso = schedFlowIso_(schedFlowNow_());
  var left = 0, closed = [];
  schedRead_('sched_inbox').forEach(function (r) {
    if (str_(r.flow_id) !== str_(flow.id) || r.box !== 'work' || r.state !== 'waiting' || str_(r.seat) !== other) return;
    if (str_(r.to_uid) !== str_(actor.uid)) { left++; return; }
    r.state = 'closed';
    r.answered_by = actor.name;
    r.answered_at = nowIso;
    r.note = 'answered on the other seat';
    closed.push(r);
  });
  if (closed.length) schedUpsert_('sched_inbox', closed);
  seats.forEach(function (s) {
    if (s.seat !== other || s.state !== 'waiting' || left) return;
    s.state = 'skipped';
    s.at = nowIso;
    s.why = other === 'house_manager'
      ? actor.name + ' answered as a director and no other house manager is left, so the seat passes to the directors'
      : actor.name + ' answered as the house manager and no other director is left to answer';
  });
  flow.seats = JSON.stringify(seats);
  var open = seats.filter(function (s) { return s.state === 'waiting'; });
  if (open.length) return { said: 'Approved. Waiting on ' + (open[0].seat === 'director' ? 'a director' : 'the house manager') + '.' };
  schedFlowClose_(flow, 'approved', actor.name);
  // an editor's placement is their pattern from now on: the roll gives it to them
  var cell = schedCellAt_(flow.house_code, flow.row_id, flow.date);
  if (flow.source === 'editor' && cell && str_(cell.state) === 'training' && str_(cell.flow_id) === str_(flow.id)) {
    schedSetCell_(flow.house_code, flow.row_id, flow.date, { text: str_(cell.text), state: 'training', base: str_(cell.text),
                  flow_id: flow.id, source: str_(cell.source) }, 'training', actor, 'training approved', flow.id);
  }
  vars.result = 'approved: you work it as a training with the house manager';
  schedFlowOwe_(flow, 'sched_training_decided', flow.person_key, vars, '');
  var byWho = seats.filter(function (s) { return s.state === 'approved'; }).map(function (s) { return s.by; }).join(' and ');
  schedInbox_(schedTrainingTold_(flow, 'Training approved — ' + schedTrainingTitle_(flow).replace(/^Training — /, ''),
    'Approved by ' + byWho + '. ' + flow.person + ' works the shift as a training with the house manager, not as the DSP.'));
  return { said: 'Approved. The training stands: ' + flow.person + ' works the shift as a trainee, not as the DSP.' };
}

// Any decline: the trainee leaves the cell (back to what it held before), the shift goes to an OPEN row at the top…
function schedTrainingDecline_(flow, actor, note, vars) {
  var nowMs = schedFlowNow_();
  var house = schedFlowHouseWord_(flow.house_code);
  schedFlowClose_(flow, 'declined', actor.name);
  schedFlowItemsSettle_(flow.id, '', 'closed', actor.name);
  var cell = schedCellAt_(flow.house_code, flow.row_id, flow.date);
  var live = !!(cell && str_(cell.state) === 'training' && str_(cell.flow_id) === str_(flow.id));
  var kick = [], what = '';
  if (!live) {
    what = 'The shift had changed on the calendar, so nothing opened.';
  } else if (schedFlowEnded_(flow.date, cell.end_min, nowMs)) {
    what = 'The shift had already ended, so nothing opened.';
  } else {
    var before = str_(cell.base);
    var co = schedFlowCallOffApply_({
      house: flow.house_code, rowId: flow.row_id, date: flow.date, cell: cell,
      person: { name: flow.person, key: flow.person_key, uid: flow.person_uid },
      patch: { text: before, state: before ? 'scheduled' : '', base: '', flow_id: '', source: 'app' },
      via: 'training', source: 'training', source_ref: flow.id, reason: '', ctx: actor, warn: false,
      settings: schedSettings_(), note: 'training declined by ' + actor.name,
      open_base: flow.source === 'editor' ? str_(cell.text) : ''
    });
    flow.open_row_id = co.open_row_id;
    kick.push(co.id);
    what = 'The shift is open at the top of ' + house + ' and the call-off outreach has started.';
  }
  schedFlowNote_(flow, 'declined by ' + actor.name + (note ? ': "' + note + '"' : '') + ' — ' + what);
  vars.result = 'not approved' + (live ? ': you are off that shift' : '');
  schedFlowOwe_(flow, 'sched_training_decided', flow.person_key, vars, '');
  var title = 'Training declined — ' + schedTrainingTitle_(flow).replace(/^Training — /, '');
  var body = 'Declined by ' + actor.name + (note ? ': "' + note + '"' : '') + '. ' + flow.person + ' is off the shift. ' + what;
  var items = schedTrainingTold_(flow, title, body, 'warning');
  if (flow.source === 'swap') {
    var sw = schedFlowFlowById_(flow.source_ref);
    // the other side of the swap: the giver, or in an exchange whoever the trainee swapped with
    var otherUid = sw ? (str_(sw.person_key) === str_(flow.person_key) ? str_(sw.replacement_uid) : str_(sw.person_uid)) : '';
    var otherName = sw ? (str_(sw.person_key) === str_(flow.person_key) ? str_(sw.replacement) : str_(sw.person)) : '';
    if (otherUid) {
      items.push(schedFlowItem_(flow, 'inbox', 'info', 'staff', { uid: otherUid, name: otherName, email: '' }, title,
                                'The swap had finished, but ' + flow.person + '\'s training was not approved. ' + what));
    }
  }
  schedInbox_(items);
  return { said: 'Declined. ' + flow.person + ' is off the shift. ' + what, kick: kick };
}

/** A training still waiting that ends without an answer (taken off the calendar, or its shift given up). */
function schedTrainingEnd_(flowId, state, ctx, why) {
  var f = schedFlowFlowById_(flowId);
  if (!f || f.kind !== 'training' || str_(f.state) !== 'waiting') return null;
  var by = str_(ctx && ctx.name);
  schedFlowClose_(f, state, by);
  schedFlowNote_(f, why);
  schedUpsert_('sched_flows', [f]);
  schedFlowItemsSettle_(f.id, '', 'closed', by);
  if (str_(f.person_uid)) {
    schedInbox_([schedFlowItem_(f, 'inbox', 'info', 'trainee', { uid: f.person_uid, name: f.person, email: '' },
      'Training closed — ' + schedTrainingTitle_(f).replace(/^Training — /, ''), 'Nothing waits on it any more: ' + why + '.')]);
  }
  return f;
}

/** An editor changed a training shift's hours: the flow carries the new ones. */
function schedTrainingMoved_(flowId, cell, ctx) {
  var f = schedFlowFlowById_(flowId);
  if (!f || f.kind !== 'training' || !cell) return null;
  f.shift_text = str_(cell.text);
  f.start_min = Number(cell.start_min);
  f.end_min = Number(cell.end_min);
  f.updated_at = schedFlowIso_(schedFlowNow_());
  schedFlowNote_(f, 'hours changed to ' + str_(cell.text) + ' by ' + str_(ctx && ctx.name));
  schedUpsert_('sched_flows', [f]);
  return f;
}

/* ---- the phone hook ---- */

// A call-off heard on the hotline.
function schedulingCallOffHeard_(evt) {
  var e = evt || {};
  var out = { ok: false, state: '', flow_id: '', why: '' };
  var instance = '';
  // inside the Hotline pass: the lock is waited on briefly, and a hearing that cannot be done now is kept for the clock
  var owe = function () {
    try { out.state = schedFlowPhoneOwe_(instance, e) ? 'owed' : 'dropped'; } catch (eP) { /* logged below */ }
  };
  try {
    instance = str_(e.instance);
    if (!instance) { out.why = 'no hotline instance'; return out; }
    var res = schedLock_(function () { return schedFlowHeardLocked_(e, instance); }, SCHED_FLOW_PHONE_LOCK_MS);
    if (!res || res.status) {
      out.why = str_(res && res.message) || 'no answer from the lock';
      owe();
      schedFlowLog_('scheduling_phone_not_opened', instance + ': ' + out.why, 409);
      return out;
    }
    out.ok = true;
    out.state = res.state;
    out.flow_id = res.flow_id || '';
    out.why = res.why || '';
  } catch (err) {
    out.why = String((err && err.message) || err).slice(0, 240);
    if (instance) owe();
    schedFlowLog_('scheduling_phone_failed', instance + ': ' + out.why, 500);
  }
  return out;
}

function schedFlowHeardLocked_(e, instance) {
  var nowMs = schedFlowNow_();
  var seen = null;
  schedRead_('sched_flows').forEach(function (f) {
    if (str_(f.source_ref) === instance && (f.kind === 'call_off' || f.kind === 'phone')) seen = f;
  });
  if (seen) return { state: 'already', flow_id: seen.id };
  var name = schedFlowText_(e.employee, 120);
  var day = str_(e.shift_day);
  var key = '';
  try { key = name ? str_(clientNameKey_(name)) : ''; } catch (eK) { key = ''; }
  var why = '', found = [];
  if (str_(e.name_from) === 'phone') why = 'the name came from the caller ID only, not from what the caller said';
  else if (!key) why = 'the call did not give a name';
  else if (!schedFlowYmd_(day)) why = 'the call did not say which day';
  else {
    found = schedRead_('sched_cells').filter(function (c) {
      return str_(c.row_id) === 'P:' + key && str_(c.date) === day && schedFlowHolds_(c) &&
             !schedFlowEnded_(day, c.end_min, nowMs);
    });
    if (!found.length) why = 'no shift of theirs that day is on the calendar';
    else if (found.length > 1) why = 'they hold ' + found.length + ' shifts that day, so which one is not clear';
  }
  var st = schedSettings_();
  if (why) {
    var f = schedFlowRow_({
      id: schedFlowNewId_('SF', instance), kind: 'phone', state: 'needs_human', date: schedFlowYmd_(day) ? day : str_(e.call_day),
      person: name, person_key: key, note: why, source: 'hotline', source_ref: instance, created_by: ''
    });
    var dirs = schedFlowDirectors_(st);
    if (!dirs.list.length) schedFlowNote_(f, 'the directors were not told: ' + (dirs.why || 'nobody on the list'));
    var title = 'Phone call-off needs a human — ' + (name || 'unknown caller') + ' · ' +
                schedFlowDayWords_(schedFlowYmd_(day) ? day : str_(e.call_day));
    var body = 'The hotline heard a call-off, but nothing was opened on the calendar: ' + why + '. Find the shift ' +
               'and mark the call-off for them in Scheduling.';
    schedInbox_(dirs.list.map(function (d) { return schedFlowItem_(f, 'inbox', 'warning', 'director', d, title, body); }));
    schedUpsert_('sched_flows', [f]);
    return { state: 'needs_human', flow_id: f.id, why: why };
  }
  var c = found[0];
  var row = schedFlowRowOf_(c.house_code, c.row_id) || {};
  var uid = '';
  try { uid = str_((schedUserByKey_(key) || {}).uid); } catch (eU) { uid = ''; }
  schedFlowExpireOn_(str_(c.house_code), str_(c.row_id), day, 'Hotline');
  var co = schedFlowCallOffApply_({
    house: str_(c.house_code), rowId: str_(c.row_id), date: day, cell: c,
    person: { name: str_(row.name) || name, key: key, uid: uid }, state: 'called_off', text: 'C/O', via: 'call_off',
    source: 'hotline', source_ref: instance, reason: '', ctx: schedFlowSystem_('Hotline'), warn: true, settings: st,
    note: 'heard on the hotline'
  });
  return { state: 'opened', flow_id: co.id };
}

// A hearing that found the lock busy or failed, kept (one Script Property each, and an index) for the clock — at…
function schedFlowPhoneOwe_(instance, evt) {
  var props = PropertiesService.getScriptProperties();
  var had = schedFlowJson_(props.getProperty(SCHED_FLOW_PHONE_OWED + instance), {});
  var tries = Math.max(Number((had && had._tries) || 0), Number((evt && evt._tries) || 0)) + 1;
  var idx = schedFlowJson_(props.getProperty(SCHED_FLOW_PHONE_OWED + 'index'), []);
  if (tries > SCHED_FLOW_PHONE_TRIES) {
    props.deleteProperty(SCHED_FLOW_PHONE_OWED + instance);
    props.setProperty(SCHED_FLOW_PHONE_OWED + 'index', JSON.stringify(idx.filter(function (i) { return i !== instance; })));
    schedFlowLog_('scheduling_phone_dropped', instance + ': not heard after ' + SCHED_FLOW_PHONE_TRIES + ' tries', 500);
    return false;
  }
  var keep = {};
  for (var k in (evt || {})) if (Object.prototype.hasOwnProperty.call(evt, k)) keep[k] = evt[k];
  keep._tries = tries;
  if (idx.indexOf(instance) === -1) idx.push(instance);
  props.setProperty(SCHED_FLOW_PHONE_OWED + instance, JSON.stringify(keep).slice(0, 1500));
  props.setProperty(SCHED_FLOW_PHONE_OWED + 'index', JSON.stringify(idx.slice(-50)));
  schedFlowDueLower_(schedFlowNow_());
  return true;
}

/** The phone call-offs that found the lock busy, heard again by the clock. */
function schedFlowPhoneCarry_() {
  var done = 0, left = [];
  try {
    var props = PropertiesService.getScriptProperties();
    var idx = schedFlowJson_(props.getProperty(SCHED_FLOW_PHONE_OWED + 'index'), []);
    if (!idx.length) return 0;
    idx.forEach(function (instance) {
      var evt = schedFlowJson_(props.getProperty(SCHED_FLOW_PHONE_OWED + instance), null);
      if (evt && schedulingCallOffHeard_(evt).state === 'owed') { left.push(instance); return; }
      props.deleteProperty(SCHED_FLOW_PHONE_OWED + instance);
      if (evt) done++;
    });
    var now = schedFlowJson_(props.getProperty(SCHED_FLOW_PHONE_OWED + 'index'), []).filter(function (i) {
      return left.indexOf(i) !== -1 || idx.indexOf(i) === -1;
    });
    if (now.length) props.setProperty(SCHED_FLOW_PHONE_OWED + 'index', JSON.stringify(now));
    else props.deleteProperty(SCHED_FLOW_PHONE_OWED + 'index');
  } catch (e) { left.push('?'); }
  if (left.length) schedFlowDueLower_(schedFlowNow_() + 60000);
  return done;
}
