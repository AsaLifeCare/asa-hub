// Pure: nothing in this file sends, writes a sheet or calls a model, so the self-test can prove it.

// Named _HOUSE, never _TAB: every .gs shares one global scope, and a _TAB name here overwrote the hiring lane's.
var COMM_INTENTS_HOUSE = 'comm_intents';
var COMM_BINDINGS_HOUSE = 'comm_bindings';

// `stopped` is a decision somebody recorded, never a timeout.
var COMM_INTENT_STATES = ['planned', 'asking', 'answered', 'stopped'];

var COMM_OPEN_STATES = ['missing', 'expiring', 'expired'];

// Deferred, never dropped: what the cap holds back stays open and rides the next intent.
var COMM_BINDINGS_PER_INTENT = 6;

// Who and why only: a key carrying the demand set would change every sweep and lose the pacing memory.
function commIntentKey_(personKey, purpose) {
  var who = String(personKey || '').trim().toLowerCase();
  var why = String(purpose || '').trim().toLowerCase();
  return [who, why].join('|');
}

function commIntentSupersede_(existing, fresh) {
  if (!existing || !fresh) return null;
  if (String(existing.intent_key) !== String(fresh.intent_key)) return null;
  var was = (existing.demand_ids || []).map(String).sort();
  var now = (fresh.demand_ids || []).map(String).sort();
  if (was.join(',') === now.join(',')) return null;
  var has = {};
  now.forEach(function (d) { has[d] = 1; });
  var had = {};
  was.forEach(function (d) { had[d] = 1; });
  return {
    intent_key: String(existing.intent_key),
    added: now.filter(function (d) { return !had[d]; }),
    dropped: was.filter(function (d) { return !has[d]; }),
    why: 'the same thread, with its open set moved on'
  };
}

// One check recorded in several columns travels as one binding, but only while every date agrees.
var COMM_SAME_EVIDENCE = [
  ['nurse_aide', 'offender', 'sex_offender']
];

function commFoldEvidence_(bindings) {
  var out = [], taken = {};
  for (var g = 0; g < COMM_SAME_EVIDENCE.length; g++) {
    var group = COMM_SAME_EVIDENCE[g];
    var members = (bindings || []).filter(function (b) {
      return group.indexOf(String(b.req_id || '')) !== -1;
    });
    if (members.length < 2) continue;
    var first = String(members[0].expires || '');
    var same = members.every(function (b) { return String(b.expires || '') === first; });
    if (!same) continue;
    // The lead is the most urgent member: agreeing dates do not mean agreeing states.
    var ordered = members.slice().sort(commBindingSort_);
    var lead = {};
    Object.keys(ordered[0]).forEach(function (k) { lead[k] = ordered[0][k]; });
    lead.also = ordered.slice(1).map(function (b) { return String(b.req_id || ''); });
    lead.settles = ordered.map(function (b) { return String(b.demand_id || ''); });
    out.push(lead);
    members.forEach(function (b) { taken[String(b.demand_id || '')] = 1; });
  }
  (bindings || []).forEach(function (b) {
    if (!taken[String(b.demand_id || '')]) out.push(b);
  });
  return out;
}

// Must run after the evidence fold: sorting first let a folded lead outrank an expired obligation.
function commBindingSort_(x, y) {
  var d = commUrgency_(x.state) - commUrgency_(y.state);
  if (d !== 0) return d;
  var xd = x.days_left === null ? 99999 : x.days_left;
  var yd = y.days_left === null ? 99999 : y.days_left;
  if (xd !== yd) return xd - yd;
  return x.req_id < y.req_id ? -1 : (x.req_id > y.req_id ? 1 : 0);
}

function commBindingsFor_(rows) {
  return commFoldEvidence_((rows || [])
    .filter(function (r) {
      return COMM_OPEN_STATES.indexOf(String(r && r.state || '')) !== -1;
    })
    .map(function (r) {
      var days = parseInt(String(r.days_left || ''), 10);
      return {
        demand_id: String(r.person_key || '') + '|' + String(r.req_id || ''),
        req_id: String(r.req_id || ''),
        state: String(r.state || ''),
        expires: String(r.expires || ''),
        days_left: isNaN(days) ? null : days,
        binding_state: 'open'
      };
    })).sort(commBindingSort_);
}

// Never `rank[state] || 9`: expired ranks 0, which is falsy.
function commUrgency_(state) {
  var rank = { expired: 0, expiring: 1, missing: 2 };
  var n = rank[String(state || '')];
  return n === undefined ? 9 : n;
}

// The roster is asked first: most of the engine's output is about people who do not work here.
function commIntentFor_(personKey, personName, rows, opts) {
  opts = opts || {};
  var who = String(personKey || '').trim().toLowerCase();
  if (!who) return null;
  if (opts.roster && !opts.roster[who]) return null;

  var all = commBindingsFor_(rows);
  if (!all.length) return null;

  var carried = all.slice(0, COMM_BINDINGS_PER_INTENT);
  var deferred = all.length - carried.length;
  var purpose = String(opts.purpose || 'compliance.owed');
  var ids = carried.map(function (b) { return b.demand_id; });

  return {
    intent_key: commIntentKey_(who, purpose),
    person_key: who,
    person_name: String(personName || ''),
    purpose: purpose,
    state: 'planned',
    bindings: carried,
    demand_ids: ids,
    deferred: deferred,
    worst: carried[0] ? carried[0].state : '',
    created_at: String(opts.now || '')
  };
}

function commIntentsFrom_(byPerson, opts) {
  opts = opts || {};
  var intents = [];
  var skipped = { off_roster: 0, nothing_open: 0 };
  Object.keys(byPerson || {}).forEach(function (key) {
    var group = byPerson[key] || {};
    var rows = group.rows || [];
    var who = String(key || '').trim().toLowerCase();
    if (opts.roster && !opts.roster[who]) { skipped.off_roster++; return; }
    var intent = commIntentFor_(who, group.name, rows, opts);
    if (!intent) { skipped.nothing_open++; return; }
    intents.push(intent);
  });
  intents.sort(function (a, b) {
    var d = commUrgency_(a.worst) - commUrgency_(b.worst);
    if (d !== 0) return d;
    return b.bindings.length - a.bindings.length;
  });
  return { intents: intents, skipped: skipped };
}

// A qualification advances its own demand only; the intent is answered when nothing is left open.
function commIntentQualify_(intent, demandId, verdict) {
  if (!intent) return null;
  var next = {};
  Object.keys(intent).forEach(function (k) { next[k] = intent[k]; });
  var known = false;
  next.bindings = (intent.bindings || []).map(function (b) {
    if (String(b.demand_id) !== String(demandId)) return b;
    known = true;
    var copy = {};
    Object.keys(b).forEach(function (k) { copy[k] = b[k]; });
    copy.binding_state = String(verdict || 'satisfied');
    return copy;
  });
  if (!known) {
    return { error: 'this intent was never asking about ' + String(demandId) };
  }
  var open = next.bindings.filter(function (b) { return b.binding_state === 'open'; });
  next.state = open.length ? 'asking' : 'answered';
  next.open_count = open.length;
  return next;
}

// The dial is derived from test mode (on: record, off: send, unreadable: off); the comm_dial cell is never read.
var COMM_DIAL_MEMO = '';
// An unreadable 'off' is flagged and never memoised, so a lane that records it never closes on one hiccup.
var COMM_DIAL_UNREADABLE = false;

function commDial_() {
  if (COMM_DIAL_MEMO) return COMM_DIAL_MEMO;
  var v = commDialRead_();
  if (!COMM_DIAL_UNREADABLE) COMM_DIAL_MEMO = v;
  return v;
}

function commDialState_() {
  var word = (typeof commSendDialWord_ === 'function') ? commSendDialWord_(null) : commDial_();
  return { word: word, readable: !(word === 'off' && COMM_DIAL_UNREADABLE) };
}

function commDialRead_() {
  COMM_DIAL_UNREADABLE = false;
  try {
    if (typeof hubTestModeOn_ !== 'function') throw new Error('the test-mode reader is absent');
    return hubTestModeOn_() ? 'record' : 'send';
  } catch (e) {
    COMM_DIAL_UNREADABLE = true;
    return 'off';
  }
}
