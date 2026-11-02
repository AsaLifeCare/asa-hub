// THE MATRIX ENGINE.
// Thirteen module books in the declared matrix, one Runtime book holding the Registry (context → spreadsheet id →…

function hiringRuntimeId_() {
  try { return String(hubProp_('HUB_HIRING_RUNTIME_ID') || '').trim(); }
  catch (e) { return ''; }
}

// OUR RUNTIME IS THE ESSENCIAL.
function hubRuntimeId_() {
  try {
    var id = String(hubProp_('HUB_APPS_RUNTIME_ID') || '').trim();
    if (id) return id;
  } catch (e) { /* fall through */ }
  return hiringRuntimeId_();
}

/** Every runtime book, ours first. A new runtime is one property. */
function hiringRuntimeIds_() {
  var out = [];
  ['HUB_APPS_RUNTIME_ID', 'HUB_HIRING_RUNTIME_ID'].forEach(function (key) {
    var id = '';
    try { id = String(hubProp_(key) || '').trim(); } catch (e) { id = ''; }
    if (id && out.indexOf(id) === -1) out.push(id);
  });
  return out;
}

/** The runtime book a context's operation is written to — its own, else ours. */
function hiringRuntimeFor_(context) {
  var row = hiringRegistry_()[String(context || '').trim().toLowerCase()];
  return (row && row.runtime) || hubRuntimeId_();
}

function hiringBookFor_(context) {
  var mode = hiringBookMode_(context);
  if (!mode.id || mode.status !== 'on') return '';
  hiringUsageStamp_(String(context).trim().toLowerCase());
  return mode.id;
}

function hiringBookMode_(context) {
  var want = String(context || '').trim().toLowerCase();
  if (!want) return { id: '', status: '' };
  var row = hiringRegistry_()[want];
  return row ? { id: row.id, status: row.status } : { id: '', status: '' };
}

function hiringRegistry_() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get('hiring_registry_v1');
    if (hit) return JSON.parse(hit);
  } catch (e) { /* re-read */ }
  var map = hiringRegistryReadSheet_();
  if (map === null) map = hiringRegistryCompiled_() || {};
  try { cache.put('hiring_registry_v1', JSON.stringify(map), 300); } catch (e2) { /* uncached */ }
  return map;
}

// The Registry tabs of every runtime, merged; each row remembers which runtime declared it.
function hiringRegistryReadSheet_() {
  var ids = hiringRuntimeIds_();
  if (!ids.length) return null;
  var map = {}, read = 0;
  ids.forEach(function (rid) {
    try {
      var sheet = ssOpen_(rid).getSheetByName('Registry');
      if (!sheet) return;
      var values = sheet.getDataRange().getValues();
      var hdr = (values[0] || []).map(function (c) { return String(c || '').trim(); });
      var iCtx = hdr.indexOf('Context');
      var iId = hdr.indexOf('Spreadsheet ID');
      var iSt = hdr.indexOf('Status');
      var iNote = hdr.indexOf('Notes');
      if (iCtx === -1 || iId === -1 || iSt === -1) return;
      read++;
      for (var i = 1; i < values.length; i++) {
        var ctx = String(values[i][iCtx] || '').trim().toLowerCase();
        if (!ctx || ctx.charAt(0) === '#' || map[ctx]) continue;
        map[ctx] = { id: String(values[i][iId] || '').trim(),
                     status: String(values[i][iSt] || '').trim().toLowerCase(),
                     // The note says which legacy tab a data book describes ("… (data: hiring_journey)"); the…
                     note: iNote === -1 ? '' : String(values[i][iNote] || '').trim(),
                     runtime: rid };
      }
    } catch (e) { /* one unreadable runtime must not silence the others */ }
  });
  return read ? map : null;
}

function hiringRegistryCompiled_() {
  try {
    var body = hubProp_('HIRING_REGISTRY');
    return body ? JSON.parse(body) : null;
  } catch (e) { return null; }
}

// Bakes the registry shadow property — rides the sweep.
var HIRING_REGISTRY_BAKE_EVERY_S = 600;
function hiringRegistryCompileMaybe_() {
  try {
    var gate = CacheService.getScriptCache();
    if (gate.get('hiring_registry_baked')) return;
    gate.put('hiring_registry_baked', '1', HIRING_REGISTRY_BAKE_EVERY_S);
  } catch (eG) { /* an unreadable cache bakes, never skips */ }
  try {
    var map = hiringRegistryReadSheet_();
    if (map && Object.keys(map).length) {
      hubPropSet_('HIRING_REGISTRY', JSON.stringify(map));
    }
  } catch (e) { /* the previous bake keeps answering */ }
  // the door map rides the same clock — requests never compile it (12s login)
  try { hiringActionMapCompile_(); } catch (e2) { /* the previous bake answers */ }
}

/** Registry's Last Read stamp — cache-gated to 1/hour; never costs a read. */
function hiringUsageStamp_(context) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'hiring_lastread_' + String(context);
    if (cache.get(key)) return;
    cache.put(key, '1', 3600);
    var rid = hiringRuntimeFor_(context);
    if (!rid) return;
    var sheet = ssOpen_(rid).getSheetByName('Registry');
    if (!sheet) return;
    var values = sheet.getDataRange().getValues();
    var hdr = (values[0] || []).map(function (c) { return String(c || '').trim(); });
    var iCtx = hdr.indexOf('Context');
    var iAt = hdr.indexOf('Last Read');
    if (iCtx === -1 || iAt === -1) return;
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][iCtx] || '').trim().toLowerCase() === String(context)) {
        sheet.getRange(i + 1, iAt + 1).setValue(new Date().toISOString());
        return;
      }
    }
  } catch (e) { /* a stamp must never cost a read */ }
}

/** One matrix tab as row objects, cached 300s; [] whenever it cannot answer. */
function hiringMatrixTab_(context, tabName) {
  var mode = hiringBookMode_(context);
  if (!mode.id || (mode.status !== 'on' && mode.status !== 'shadow')) return [];
  return hiringBookTab_(mode.id, String(context).trim().toLowerCase(), tabName);
}

// ONE READ PER EXECUTION per (book, tab), whatever CacheService thinks.
var HIRING_TAB_MEMO = {};
/** The one spelling of a (book, tab) key — the memo and the cache share it. */
function hiringBookTabKey_(cacheScope, tabName) {
  return 'hiring_mx_v1_' + cacheScope + '_' + String(tabName || '');
}
function hiringBookTab_(sid, cacheScope, tabName) {
  var cacheKey = hiringBookTabKey_(cacheScope, tabName);
  if (HIRING_TAB_MEMO[cacheKey]) return HIRING_TAB_MEMO[cacheKey];
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(cacheKey);
    if (hit) {
      HIRING_TAB_MEMO[cacheKey] = JSON.parse(hit);
      return HIRING_TAB_MEMO[cacheKey];
    }
  } catch (e) { /* re-read */ }
  var rows = [];
  try {
    var sheet = ssOpen_(sid).getSheetByName(String(tabName || ''));
    if (sheet) {
      var values = sheet.getDataRange().getValues();
      var hdr = (values[0] || []).map(function (c) { return String(c || '').trim(); });
      for (var i = 1; i < values.length; i++) {
        var row = {}, any = false;
        for (var j = 0; j < hdr.length; j++) {
          if (!hdr[j]) continue;
          var v = String(values[i][j] == null ? '' : values[i][j]);
          if (v) any = true;
          row[hdr[j]] = v;
        }
        if (any) rows.push(row);
      }
    }
  } catch (e2) { rows = []; }
  HIRING_TAB_MEMO[cacheKey] = rows;
  try { cache.put(cacheKey, JSON.stringify(rows), 300); } catch (e3) { /* uncached */ }
  return rows;
}

// The matrix rule grammar: {"fact","equals"|"equals_ci"|"gte"}, {"all":[…]}, {"any":[…]}.
function hiringRuleOk_(rule, facts) {
  if (rule == null || rule === '') return true;
  if (typeof rule === 'string') {
    var s = rule.trim();
    if (!s) return true;
    try { rule = JSON.parse(s); } catch (e) { return false; }
  }
  if (typeof rule !== 'object') return false;
  facts = facts || {};
  if (Object.prototype.hasOwnProperty.call(rule, 'all')) {
    var all = rule.all || [];
    for (var i = 0; i < all.length; i++) {
      if (!hiringRuleOk_(all[i], facts)) return false;
    }
    return true;
  }
  if (Object.prototype.hasOwnProperty.call(rule, 'any')) {
    var any = rule.any || [];
    for (var j = 0; j < any.length; j++) {
      if (hiringRuleOk_(any[j], facts)) return true;
    }
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(rule, 'fact')) {
    var got = facts[String(rule.fact)];
    return hiringCompare_(rule, got, facts);
  }
  return false;
}

// ONE COMPARATOR TABLE, BECAUSE THE BOOKS ALREADY SPEAK THIS LANGUAGE.
function hiringCompare_(rule, got, facts) {
  var s = String(got == null ? '' : got);
  var low = s.trim().toLowerCase();
  var num = Number(s);

  function list(v) {
    if (Object.prototype.toString.call(v) === '[object Array]') return v;
    return [v];
  }
  function inList(v, ci) {
    var arr = list(v);
    for (var i = 0; i < arr.length; i++) {
      var one = String(arr[i]);
      if (ci ? one.trim().toLowerCase() === low : one === s) return true;
    }
    return false;
  }
  function other(key) {
    return String(facts[String(rule[key])] == null ? '' : facts[String(rule[key])]);
  }
  function has(k) { return Object.prototype.hasOwnProperty.call(rule, k); }

  if (has('equals')) {
    if (typeof rule.equals === 'boolean') {
      return (got === true || low === 'true') === rule.equals;
    }
    return s === String(rule.equals);
  }
  if (has('equals_ci')) return low === String(rule.equals_ci).trim().toLowerCase();
  if (has('not_equals')) return s !== String(rule.not_equals);
  if (has('not_equals_ci')) return low !== String(rule.not_equals_ci).trim().toLowerCase();
  if (has('in')) return inList(rule['in'], false);
  if (has('in_ci')) return inList(rule.in_ci, true);
  if (has('not_in')) return !inList(rule.not_in, false);
  if (has('not_in_ci')) return !inList(rule.not_in_ci, true);
  if (has('starts_with')) return s.indexOf(String(rule.starts_with)) === 0;
  if (has('starts_with_ci')) {
    return low.indexOf(String(rule.starts_with_ci).trim().toLowerCase()) === 0;
  }
  if (has('contains_ci')) {
    return low.indexOf(String(rule.contains_ci).trim().toLowerCase()) !== -1;
  }
  if (has('matches')) {
    // The pattern comes from configuration, never from a person's input.
    try { return new RegExp(String(rule.matches)).test(s); } catch (e) { return false; }
  }
  if (has('gte')) return isFinite(num) && num >= Number(rule.gte);
  if (has('gt')) return isFinite(num) && num > Number(rule.gt);
  if (has('lte')) return isFinite(num) && num <= Number(rule.lte);
  if (has('lt')) return isFinite(num) && num < Number(rule.lt);
  if (has('present')) return (s.trim() !== '') === (rule.present !== false);

  // …and the family that compares one fact with another.
  if (has('equals_fact')) return s === other('equals_fact');
  if (has('equals_ci_fact')) return low === other('equals_ci_fact').trim().toLowerCase();
  if (has('gte_fact')) {
    var g = Number(other('gte_fact'));
    return isFinite(num) && isFinite(g) && num >= g;
  }
  if (has('lt_fact')) {
    var l = Number(other('lt_fact'));
    return isFinite(num) && isFinite(l) && num < l;
  }
  if (has('in_fact') || has('in_ci_fact')) {
    var raw = other(has('in_fact') ? 'in_fact' : 'in_ci_fact');
    var parts = raw.split(/[,;|]/);
    for (var k = 0; k < parts.length; k++) {
      var one = parts[k].trim();
      if (has('in_fact') ? one === s : one.toLowerCase() === low) return true;
    }
    return false;
  }

  // 'present_and_not_equals_ci' STAYS UNREAD ON PURPOSE.
  var known = ['equals', 'equals_ci', 'not_equals', 'not_equals_ci', 'in', 'in_ci',
               'not_in', 'not_in_ci', 'starts_with', 'starts_with_ci', 'contains_ci',
               'matches', 'gte', 'gt', 'lte', 'lt', 'present', 'equals_fact',
               'equals_ci_fact', 'gte_fact', 'lt_fact', 'in_fact', 'in_ci_fact'];
  for (var op in rule) {
    if (op === 'fact' || op === 'otherwise') continue;
    if (known.indexOf(op) === -1) {
      try {
        if (hubRuleUnknownOnce_('matrix-engine', rule.fact, op)) {
          hubSysLog_('matrix-engine', 'rule_operator_unknown',
                     'the rule on ' + String(rule.fact) + ' uses "' + op +
                     '", which this engine does not implement — read as NOT satisfied',
                     { status: 500 });
        }
      } catch (eL) { /* logging must not decide the verdict */ }
      return false;
    }
  }
  // A bare {"fact": x}: present, and not the word false.
  return got != null && s !== '' && low !== 'false';
}

// An unknown operator still refuses every time, but is LOGGED once per (engine, fact, operator) per execution and…
var HUB_RULE_UNKNOWN_SAID = {};

function hubRuleUnknownOnce_(engine, fact, op) {
  var key = ('rule_op_unknown:' + String(engine) + ':' + String(op) + ':' +
             String(fact)).slice(0, 240);
  if (HUB_RULE_UNKNOWN_SAID[key]) return false;
  HUB_RULE_UNKNOWN_SAID[key] = true;
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get(key)) return false;
    cache.put(key, '1', 21600);
  } catch (e) { /* no cache: the execution's own guard still holds */ }
  return true;
}

/* ---- facts out of the evidence already in hand --------------------------- */

var HIRING_EVIDENCE_TABS = {
  entity_candidates: function (ev) { return ev.cand; },
  entity_resume_analyses: function (ev) { return ev.analysis; },
  entity_phone_screens: function (ev) { return ev.screen; },
  entity_screens: function (ev) { return ev.screen; },
  recruitment_contracts: function (ev) { return ev.app; },
  entity_interviews: hiringEvidenceInterview_,
  entity_in_person_interviews: hiringEvidenceInterview_
};

function hiringEvidenceInterview_(ev) {
  if (!ev.__iv && typeof interviewFor_ === 'function') {
    try { ev.__iv = interviewFor_(str_(ev.cand && ev.cand.candidateid)) || {}; }
    catch (e) { ev.__iv = {}; }
  }
  return ev.__iv;
}

// The code's OWN predicates, callable by the name a Fact row declares — never a copy of the logic (the self-test's…
var HIRING_FACT_RESOLVERS = {
  interviewScored_: function (ev) {
    return typeof interviewScored_ === 'function'
      ? !!interviewScored_(hiringEvidenceInterview_(ev)) : undefined;
  },
  hubCjisCleared_: function (ev) {
    return typeof hubCjisCleared_ === 'function'
      ? !!hubCjisCleared_(ev.analysis || {}) : undefined;
  }
};

/** Facts the module book names, valued from `ev`. Unanswerable = absent. */
function hiringFactsFromEvidence_(context, ev) {
  var facts = {};
  hiringMatrixTab_(context, 'Facts').forEach(function (row) {
    var id = str_(row['Fact ID']);
    if (!id) return;
    var got = hiringFactFromRow_(row, ev);
    if (got.ok) facts[id] = got.value;
  });
  return facts;
}

// One Fact row against the evidence: resolver first, then the source list (any cell answers), then the single…
function hiringFactFromRow_(row, ev) {
  var resolver = str_(row['Current Resolver']);
  if (resolver) {
    var fn = HIRING_FACT_RESOLVERS[resolver];
    if (fn) {
      var v = fn(ev);
      return v === undefined ? { ok: false } : { ok: true, value: v };
    }
    return { ok: false };
  }
  var many = hiringIdList_(row['Current Sources']);
  if (many.length) {
    var anyTrue = false, first = '';
    for (var i = 0; i < many.length; i++) {
      var cell = hiringEvidenceCell_(many[i], ev);
      if (cell.ok && hiringCellTruthy_(cell.value)) {
        anyTrue = true;
        if (!first) first = String(cell.value);
      }
    }
    return { ok: true,
             value: str_(row.Type) === 'boolean' ? anyTrue : first };
  }
  var one = hiringEvidenceCell_(row['Current Source'], ev);
  if (!one.ok) return { ok: false };
  return { ok: true, value: hiringFactValue_(one.value, str_(row.Type)) };
}

function hiringEvidenceCell_(source, ev) {
  var src = str_(source);
  var dot = src.indexOf('.');
  if (dot === -1) return { ok: false };
  var tab = HIRING_EVIDENCE_TABS[src.slice(0, dot)];
  if (!tab) return { ok: false };
  var holder = tab(ev);
  if (!holder) return { ok: false };
  var col = src.slice(dot + 1).replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
  if (!(col in holder)) return { ok: false };
  return { ok: true, value: holder[col] };
}

// Sheet-boolean: a cell is true unless empty, false, no or 0 — a URL in a boolean-typed column means "present", not…
function hiringCellTruthy_(raw) {
  var s = String(raw == null ? '' : raw).trim();
  return s !== '' && !/^(false|no|0)$/i.test(s);
}

function hiringFactValue_(raw, type) {
  var s = String(raw == null ? '' : raw);
  if (type === 'boolean') return hiringCellTruthy_(s);
  if (type === 'number') {
    var n = Number(s);
    return isFinite(n) ? n : s;
  }
  return s;
}

/* ---- conditions and transitions, evaluated pure -------------------------- */

/** → satisfied | open | not_applicable | failed | terminal */
function hiringConditionStatus_(row, facts) {
  var app = str_(row['Applicability Rule']);
  if (app && !hiringRuleOk_(app, facts)) return 'not_applicable';
  if (str_(row['Terminal Rule']) && hiringRuleOk_(row['Terminal Rule'], facts)) return 'terminal';
  if (str_(row['Failure Rule']) && hiringRuleOk_(row['Failure Rule'], facts)) return 'failed';
  var sat = str_(row['Satisfies Rule']);
  if (!sat) return 'satisfied';
  return hiringRuleOk_(sat, facts) ? 'satisfied' : 'open';
}

// The book's verdict for one rung.
function hiringGateEval_(transitions, bindings, conditions, facts, from, to) {
  var t = null;
  for (var i = 0; i < transitions.length; i++) {
    var f = str_(transitions[i].From), g = str_(transitions[i].To);
    if ((f === from || f === '*') && g === to) { t = transitions[i]; break; }
  }
  if (!t) return null;
  var hop = {};
  (bindings || []).forEach(function (b) {
    var bid = str_(b['Binding ID']);
    if (bid) hop[bid] = str_(b['Condition ID']);
  });
  var byId = {};
  conditions.forEach(function (c) { byId[str_(c['Condition ID'])] = c; });
  var reasons = [];
  var need = function (id) {
    var c = byId[hop[id] || id];
    if (!c) { reasons.push('condition "' + id + '" is not in the book'); return false; }
    var st = hiringConditionStatus_(c, facts);
    if (st === 'satisfied' || st === 'not_applicable') return true;
    reasons.push(str_(c.Truth) || id);
    return false;
  };
  var ok = true;
  var reqAll = hiringIdList_(t['Requires All']);
  for (var a = 0; a < reqAll.length; a++) { if (!need(reqAll[a])) ok = false; }
  var reqAny = hiringIdList_(t['Requires Any']);
  if (reqAny.length) {
    var before = reasons.length;
    var anyOk = false;
    for (var b = 0; b < reqAny.length; b++) { if (need(reqAny[b])) anyOk = true; }
    if (anyOk) reasons.length = before; else ok = false;
  }
  if (str_(t['When Rule']) && !hiringRuleOk_(t['When Rule'], facts)) {
    ok = false;
    reasons.push('when: ' + str_(t['When Rule']));
  }
  return { from: from, to: to, ok: ok, reasons: reasons,
           transition: str_(t['Transition ID']) };
}

function hiringIdList_(cell) {
  var s = str_(cell);
  if (!s) return [];
  try {
    var arr = JSON.parse(s);
    if (Object.prototype.toString.call(arr) === '[object Array]') {
      return arr.map(function (x) { return String(x); });
    }
  } catch (e) { /* not JSON — a bare id */ }
  return [s];
}

/* ---- the ride: shadow compares, on serves, everything fails to code ------ */

function hiringGateRide_(ev, code) {
  try {
    if (!code || !code.from || !code.to) return code;
    var mode = hiringBookMode_('board');
    if (!mode.id || (mode.status !== 'shadow' && mode.status !== 'on')) return code;
    var facts = hiringFactsFromEvidence_('board', ev);
    var book = hiringGateEval_(hiringMatrixTab_('board', 'Transitions'),
                               hiringMatrixTab_('board', 'Flow Bindings'),
                               hiringMatrixTab_('board', 'Conditions'),
                               facts, code.from, code.to);
    hiringUsageStamp_('board');
    if (!book) return code;
    if (book.ok !== code.ok) hiringShadowLog_('board', ev, code, book);
    return mode.status === 'on' ? book : code;
  } catch (e) { return code; }
}

/** Divergence, logged at most once an hour per rung — signal, not noise. */
function hiringShadowLog_(context, ev, code, book) {
  try {
    var key = 'hiring_shadow_' + context + '_' + code.from + '_' + code.to;
    var cache = CacheService.getScriptCache();
    if (cache.get(key)) return;
    cache.put(key, '1', 3600);
    hubSysLog_('matrix-shadow', 'gate_divergence',
               context + ' ' + code.from + '→' + code.to +
               ' — book says ' + (book.ok ? 'OPEN' : 'CLOSED: ' + book.reasons.join('; ')) +
               ' · code says ' + (code.ok ? 'OPEN' : 'CLOSED: ' + code.reasons.join('; ')) +
               ' · ' + str_(ev.cand && ev.cand.candidateid),
               { status: 409 });
  } catch (e) { /* a lost log must never cost the gate */ }
}

/** Stage Hooks rows for one stage (and optionally one hook name). */
function hiringHooksFor_(context, stageId, hook) {
  var out = [];
  hiringMatrixTab_(context, 'Stage Hooks').forEach(function (r) {
    var s = str_(r['Stage ID']);
    if ((s === String(stageId) || s === '*') &&
        (!hook || str_(r.Hook) === String(hook))) out.push(r);
  });
  return out;
}

// The card's squares in shadow: each book Condition carrying a Legacy Checklist ID is compared against the drawn…
function hiringChecklistRide_(items, ev, stage) {
  try {
    var mode = hiringBookMode_('board');
    if (!mode.id || (mode.status !== 'shadow' && mode.status !== 'on')) return items;
    var facts = hiringFactsFromEvidence_('board', ev);
    var byId = {};
    (items || []).forEach(function (it) { byId[str_(it.id)] = it; });
    // The card draws its blocks progressively by stage; a condition bound beyond the card's stage is honestly…
    var order = (typeof TALENT_STAGE_ORDER !== 'undefined') ? TALENT_STAGE_ORDER : [];
    var here = order.indexOf(String(stage || ''));
    var boundAt = {};
    hiringMatrixTab_('board', 'Flow Bindings').forEach(function (b) {
      var cid = str_(b['Condition ID']);
      var at = order.indexOf(str_(b['Stage ID']));
      if (!cid || at === -1) return;
      if (!(cid in boundAt) || at < boundAt[cid]) boundAt[cid] = at;
    });
    var who = str_(ev.cand && ev.cand.candidateid);
    hiringMatrixTab_('board', 'Conditions').forEach(function (c) {
      var legacy = str_(c['Legacy Checklist ID']);
      if (!legacy) return;
      var st = hiringConditionStatus_(c, facts);
      var item = byId[legacy];
      if (!item) {
        var at = boundAt[str_(c['Condition ID'])];
        var due = at !== undefined && here !== -1 && at <= here;
        if (due && st !== 'not_applicable') {
          hiringShadowSquare_(legacy, st, 'absent from the card', who);
        }
        return;
      }
      var bookDone = st === 'satisfied';
      var codeDone = str_(item.status) === 'done';
      if (bookDone !== codeDone) {
        hiringShadowSquare_(legacy, st, 'card says ' + str_(item.status), who);
      }
    });
  } catch (e) { /* the squares must never pay for the shadow */ }
  return items;
}

// THE CONDITION INSTANCES BECOME DURABLE — the critical gap the matrix's own Review Guide names…
function hiringConditionsSweepMaybe_() {
  try {
    if (hiringBookMode_('board').status !== 'on') return;
    // the Board's decline rule reaches the live cell on the machine lane, once; a failure is said once per six…
    try { hiringBoardDeclineRuleOnce_(); } catch (eDr) {
      try {
        var saidDr = CacheService.getScriptCache();
        if (!saidDr.get('board_decline_rule_failed')) {
          saidDr.put('board_decline_rule_failed', '1', 21600);
          hubSysLog_('matrix-engine', 'board_decline_rule_failed',
                     String((eDr && eDr.message) || eDr), { status: 500 });
        }
      } catch (eSd) { /* the next pass tries again either way */ }
    }
    var cache = CacheService.getScriptCache();
    if (cache.get('hiring_ci_swept')) return;
    if (typeof engineNothingMoved_ === 'function' && engineNothingMoved_('hiring')) {
      if (typeof engineRoundStamp_ === 'function') {
        engineRoundStamp_('hiring', { units: 0, wrote: 0, ms: 0,
                                      notes: 'skipped: no new facts since the last round' });
      }
      return;
    }
    cache.put('hiring_ci_swept', '1', ENGINE_GATE_S);
    var rows = readTabNormalized_(hubDb_(TALENT_CANDIDATES_TAB), TALENT_CANDIDATES_TAB) || [];
    // AND THE SAME DISEASE WAS HERE, hiding behind a different spelling (found by auditing how the OTHER engines…
    var wrote = 0, seen = 0, examined = 0, ended = 0;
    var cursor = 0;
    try { cursor = parseInt(hubProp_('HIRING_JUDGE_CURSOR') || '0', 10) || 0; }
    catch (eHc) { cursor = 0; }
    if (rows.length && cursor >= rows.length) cursor = 0;
    var ordered = rows.length ? rows.slice(cursor).concat(rows.slice(0, cursor)) : [];
    // the same wall the other engines keep (ENGINE_BUDGET_MS, FlowEngine): two hundred candidates is a count, and…
    var deadline = Date.now() + ENGINE_BUDGET_MS;
    for (var i = 0; i < ordered.length && i < 200; i++) {
      if (Date.now() > deadline) break;
      examined++;
      var cand = ordered[i];
      if (String(cand.archived || '').toLowerCase() === 'true') continue;
      seen++;
      var evC = { cand: cand };
      wrote += hiringConditionsMaterialize_('board', evC, str_(cand.status));
      ended += hiringTerminalEndsRun_('board', evC);
    }
    try {
      if (rows.length) {
        hubPropSet_('HIRING_JUDGE_CURSOR', String((cursor + examined) % rows.length));
      }
    } catch (eHs) { /* a cursor that cannot be saved costs a repeat, never a gap */ }
    if (wrote) {
      hubSysLog_('matrix-instances', 'condition_instances_materialized',
                 wrote + ' instance(s) written or moved across ' + seen + ' subject(s)');
    }
    if (ended) {
      hubSysLog_('matrix-engine', 'terminal_ended_runs',
                 ended + ' candidate(s) left the process on a terminal decline');
    }
  } catch (e) { /* the sweep must never fail on this */ }
  try { hiringDataConditionsSweepMaybe_(); } catch (e2) { /* the same rule */ }
}

// A DECLINE AT THE IN-PERSON INTERVIEW ENDS THE WHOLE PROCESS.
var HIRING_TERMINAL_ENDS_RUN = {
  'hiring.interview_recommendation': { stage: 'interview', fact: 'hiring.interview.recommendation', word: 'decline' }
};

function hiringTerminalEndsRun_(context, ev) {
  var cand = ev && ev.cand;
  var cid = str_(cand && cand.candidateid);
  if (!cid || str_(cand.archived).toLowerCase() === 'true') return 0;
  var stage = talentStage_(cand.status);
  var ended = 0;
  try {
    var facts = null;
    hiringMatrixTab_(context, 'Conditions').forEach(function (c) {
      if (ended) return;
      var id = str_(c['Condition ID']);
      var end = HIRING_TERMINAL_ENDS_RUN[id];
      if (!end || !stage || end.stage !== stage) return;
      if (facts === null) facts = hiringFactsFromEvidence_(context, ev);
      if (!hiringTerminalIsTheWord_(context, c, end, facts)) return;
      var claim = hubDecisionClaim_(cid, 2000);
      if (claim !== 'claimed') return;
      try {
        var now = hubEvidenceFresh_(cid);
        var fc = now && now.cand;
        if (!fc || str_(fc.archived).toLowerCase() === 'true' || talentStage_(fc.status) !== end.stage) return;
        if (!hiringTerminalIsTheWord_(context, c, end, hiringFactsFromEvidence_(context, now))) return;
        var iv = hiringEvidenceInterview_(now) || {};
        var by = { email: 'auto-interview-decline' };
        hubSetStatus_(cid, 'Not Hiring', by);
        hiringArchiveAndTell_(cid, 'Interview declined' +
          (str_(iv.interviewername) ? ' by ' + str_(iv.interviewername).slice(0, 120) : '') +
          (str_(iv.score) ? ' — score ' + str_(iv.score) : '') +
          ' · the run ended on the Board rule ' + id, by, end.stage);
        hubBustTalentCache_();
        ended = 1;
      } finally {
        hubDecisionRelease_(cid);
      }
    });
  } catch (e) {
    // said once per candidate per six hours; the next pass tries again
    try {
      var said = CacheService.getScriptCache();
      if (!said.get('terminal_end_failed_' + cid)) {
        said.put('terminal_end_failed_' + cid, '1', 21600);
        hubSysLog_('matrix-engine', 'terminal_end_run_failed',
                   cid + ' — ' + String((e && e.message) || e), { status: 500 });
      }
    } catch (eS) { /* the next pass tries again either way */ }
  }
  return ended;
}

// Terminal by the Board's cell AND by the one ending word.
function hiringTerminalIsTheWord_(context, c, end, facts) {
  if (hiringConditionStatus_(c, facts) !== 'terminal') return false;
  if (str_(facts && facts[end.fact]).toLowerCase() === end.word) return true;
  try {
    var said = CacheService.getScriptCache();
    var key = 'terminal_not_the_word_' + str_(context) + '_' + str_(c['Condition ID']);
    if (!said.get(key)) {
      said.put(key, '1', 21600);
      hubSysLog_('matrix-engine', 'terminal_rule_broader_than_the_word',
                 str_(c['Condition ID']) + '.Terminal Rule reads terminal over "' +
                 str_(facts && facts[end.fact]) + '" — only a "' + end.word + '" ends a run, so nobody ' +
                 'was closed on it: ' + str_(c['Terminal Rule']), { status: 200 });
    }
  } catch (e) { /* the refusal stands without its log line */ }
  return false;
}

// THE BOARD'S DECLINE RULE, MOVED ONCE IN THE LIVE BOOK.
var HIRING_BOARD_DECLINE_CONDITION = 'hiring.interview_recommendation';
var HIRING_BOARD_DECLINE_BEFORE =
  '{"fact":"hiring.interview.recommendation","present_and_not_equals_ci":"advance"}';
var HIRING_BOARD_DECLINE_AFTER =
  '{"fact":"hiring.interview.recommendation","equals_ci":"decline"}';
var HIRING_BOARD_DECLINE_MARK = 'HIRING_BOARD_DECLINE_RULE_MOVED';

function hiringBoardDeclineRuleOnce_(sheetIn) {
  if (!sheetIn) {
    var cur = null;
    hiringMatrixTab_('board', 'Conditions').forEach(function (c) {
      if (str_(c['Condition ID']) === HIRING_BOARD_DECLINE_CONDITION) cur = str_(c['Terminal Rule']);
    });
    if (cur === null) return { done: false, reason: 'the board carries no such condition' };
    if (cur === HIRING_BOARD_DECLINE_AFTER) return { done: false, reason: 'already' };
  }
  if (str_(hubProp_(HIRING_BOARD_DECLINE_MARK))) return { done: false, reason: 'already' };
  var sheet = sheetIn;
  if (!sheet) {
    var bookId = hiringBookMode_('board').id;
    sheet = bookId ? ssOpen_(bookId).getSheetByName('Conditions') : null;
  }
  if (!sheet) return { done: false, reason: 'the board could not be opened' };
  var values = sheet.getDataRange().getValues();
  var hdr = (values[0] || []).map(function (h) { return String(h || '').trim(); });
  var iCid = hdr.indexOf('Condition ID'), iT = hdr.indexOf('Terminal Rule');
  if (iCid === -1 || iT === -1) return { done: false, reason: 'the columns are not there' };
  var wrote = false, kept = '', found = false;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][iCid] || '').trim() !== HIRING_BOARD_DECLINE_CONDITION) continue;
    found = true;
    var words = String(values[r][iT] == null ? '' : values[r][iT]).trim();
    if (words === HIRING_BOARD_DECLINE_BEFORE) {
      sheet.getRange(r + 1, iT + 1).setValue(HIRING_BOARD_DECLINE_AFTER);
      wrote = true;
    } else if (words !== HIRING_BOARD_DECLINE_AFTER) {
      var n = iT + 1, letters = '';
      while (n > 0) { letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters; n = Math.floor((n - 1) / 26); }
      kept = 'Conditions!' + letters + String(r + 1) + ' (' + HIRING_BOARD_DECLINE_CONDITION +
             '.Terminal Rule) holds words somebody wrote, and they stand: ' + words;
    }
    break;
  }
  hubPropSet_(HIRING_BOARD_DECLINE_MARK, new Date().toISOString());
  if (wrote) {
    var key = hiringBookTabKey_('board', 'Conditions');
    try { delete HIRING_TAB_MEMO[key]; } catch (eM) { /* the next read is fresh anyway */ }
    try { CacheService.getScriptCache().remove(key); } catch (eC) { /* the 300s TTL retires it */ }
  }
  hubSysLog_('matrix-engine', kept ? 'board_decline_rule_kept' : 'board_decline_rule_moved',
             wrote ? HIRING_BOARD_DECLINE_CONDITION + '.Terminal Rule now reads ' + HIRING_BOARD_DECLINE_AFTER +
                     ' — a Decline ends the run, Hold stays open'
             : (kept || (found ? 'the cell already carries the decline rule — nothing written'
                               : HIRING_BOARD_DECLINE_CONDITION + ' is not on the board — nothing written')),
             { status: 200 });
  return { done: true, wrote: wrote, kept: kept };
}

// THE OTHER BOOKS' CONDITIONS GET USED TOO.
function hiringDataConditionsSweepMaybe_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('hiring_data_ci_swept')) return 0;
  cache.put('hiring_data_ci_swept', '1', 3600);
  var rid = hubRuntimeId_();
  if (!rid) return 0;
  var sheet = ssOpen_(rid).getSheetByName('Condition Instances');
  if (!sheet) return 0;

  var reg = hiringRegistry_();
  var now = new Date().toISOString();
  var values = sheet.getDataRange().getValues();
  var hdr = (values[0] || []).map(function (c) { return String(c || '').trim(); });
  var iCid = hdr.indexOf('Condition ID'), iSub = hdr.indexOf('Subject ID'),
      iSt = hdr.indexOf('Status'), iAt = hdr.indexOf('Resolved At');
  if (iCid === -1 || iSub === -1 || iSt === -1) return 0;
  var at = {};
  for (var r = 1; r < values.length; r++) {
    at[str_(values[r][iCid]) + '|' + str_(values[r][iSub])] = {
      row: r + 1, status: str_(values[r][iSt]) };
  }

  // A CAP WITHOUT A CURSOR IS NOT A CAP, IT IS A CEILING ON THE WORLD (found while replicating the wall to every…
  var order = Object.keys(reg).sort();
  var cursor = 0;
  try { cursor = parseInt(hubProp_('MIGRATION_JUDGE_CURSOR') || '0', 10) || 0; }
  catch (eMc) { cursor = 0; }
  if (!order.length) return 0;
  if (cursor >= order.length) cursor = 0;
  var ordered = order.slice(cursor).concat(order.slice(0, cursor));

  var wrote = 0, judged = 0, walked = 0;
  var deadline = Date.now() + ENGINE_BUDGET_MS;
  ordered.forEach(function (ctx) {
    if (judged >= ENGINE_PASS_CAP) return;     // measured, not guessed
    if (Date.now() > deadline) return;        // …and never a dead one
    walked++;
    var row = reg[ctx];
    if (!row || row.status !== 'on') return;
    var note = str_(row.note || '');
    var m = note.match(/data:\s*([A-Za-z0-9_]+)/);
    if (!m) return;                            // only the data books answer here
    var tab = m[1];
    judged++;
    var status;
    // A tab leaves HUB_DB by two roads and the book map only knows one of them: without the house lane every…
    var moved = false;
    try { moved = (typeof houseMoved_ === 'function') && houseMoved_(tab); } catch (eH) { moved = false; }
    if (hiringTabDissolved_(tab)) {
      status = 'satisfied';                    // it lives in the depot
    } else if (moved || (typeof hubTabHomeId_ === 'function' && hubTabHomeId_(tab))) {
      status = 'satisfied';                    // it moved — its house, else its book
    } else {
      status = 'open';                         // still in HUB_DB, wave pending
    }
    var cid = tab + '.migrated';
    var seen = at[cid + '|' + tab];
    if (seen) {
      if (seen.status === status) return;
      sheet.getRange(seen.row, iSt + 1).setValue(status);
      if (iAt !== -1 && status === 'satisfied') {
        sheet.getRange(seen.row, iAt + 1).setValue(now);
      }
      wrote++;
      return;
    }
    if (hiringRuntimeAppend_('Condition Instances', {
      'Condition Instance ID': 'CI_MIG_' + tab.replace(/[^A-Za-z0-9]+/g, '').toUpperCase().slice(0, 22),
      'Condition ID': cid, 'Subject ID': tab, 'Instance ID': '',
      'Stage': 'migration', 'Status': status, 'Evidence': 'book ' + str_(row.id),
      'Opened At': now, 'Resolved At': status === 'satisfied' ? now : '',
      'Resolved By': 'migration-sweep', 'Notes': 'answered from the platform itself'
    })) wrote++;
  });
  // the cursor moves by what was WALKED, never by the cap — so the next pass opens at the first book this one did…
  try {
    hubPropSet_('MIGRATION_JUDGE_CURSOR', String((cursor + walked) % order.length));
  } catch (eMs) { /* a cursor that cannot be saved costs a repeat, never a wrong verdict */ }
  if (typeof engineRoundStamp_ === 'function') {
    engineRoundStamp_('migration', {
      from: cursor, to: (cursor + walked) % order.length, of: order.length,
      units: walked, judged: judged, wrote: wrote,
      ms: Date.now() - (deadline - ENGINE_BUDGET_MS)
    });
  }
  if (wrote) {
    hubSysLog_('matrix-instances', 'migration_instances_materialized',
               wrote + ' migration verdict(s) written or moved across ' + judged + ' book(s)');
  }
  return wrote;
}

// ONE READ OF THE CONDITION INSTANCES TAB PER EXECUTION, NOT ONE PER SUBJECT (the twenty-second lane).
var HIRING_CI_SNAP_MEMO = {};
function hiringConditionsSnapshot_(rid) {
  var key = String(rid || '');
  if (HIRING_CI_SNAP_MEMO[key]) return HIRING_CI_SNAP_MEMO[key];
  // iStage is carried and unused, exactly as the per-subject read carried it — a column index nobody asks for is…
  var snap = { sheet: null, values: [], hdr: [], iCid: -1, iSub: -1, iSt: -1,
               iStage: -1, iAt: -1, added: {} };
  try {
    var sheet = ssOpen_(key).getSheetByName('Condition Instances');
    if (sheet) {
      var values = sheet.getDataRange().getValues();
      var hdr = (values[0] || []).map(function (c) { return String(c || '').trim(); });
      snap.sheet = sheet;
      snap.values = values;
      snap.hdr = hdr;
      snap.iCid = hdr.indexOf('Condition ID');
      snap.iSub = hdr.indexOf('Subject ID');
      snap.iSt = hdr.indexOf('Status');
      snap.iStage = hdr.indexOf('Stage');
      snap.iAt = hdr.indexOf('Resolved At');
    }
  } catch (e) { snap.sheet = null; }  // an unreadable tab writes nothing, as before
  HIRING_CI_SNAP_MEMO[key] = snap;
  return snap;
}

function hiringConditionsMaterialize_(context, ev, stage) {
  try {
    var ctx = String(context || 'board');
    var mode = hiringBookMode_(ctx);
    if (!mode.id || mode.status !== 'on') return 0;
    var subject = str_(ev && ev.cand && ev.cand.candidateid);
    if (!subject) return 0;
    var rid = hiringRuntimeFor_(ctx);
    if (!rid) return 0;
    // the tab is read once for the whole execution — see hiringConditionsSnapshot_
    var snap = hiringConditionsSnapshot_(rid);
    var sheet = snap.sheet;
    if (!sheet) return 0;

    var facts = hiringFactsFromEvidence_(ctx, ev);
    var now = new Date().toISOString();
    var values = snap.values;
    var iCid = snap.iCid, iSub = snap.iSub, iSt = snap.iSt, iAt = snap.iAt;
    if (iCid === -1 || iSub === -1 || iSt === -1) return 0;

    var at = {};
    for (var r = 1; r < values.length; r++) {
      if (str_(values[r][iSub]) !== subject) continue;
      at[str_(values[r][iCid])] = { row: r + 1, status: str_(values[r][iSt]) };
    }
    // rows this same execution appended are younger than the snapshot: a row of 0 says "it exists but I do not know…
    var mine = snap.added[subject];
    if (mine) {
      for (var k in mine) { if (!at[k]) at[k] = { row: 0, status: mine[k] }; }
    }

    var wrote = 0;
    hiringMatrixTab_(ctx, 'Conditions').forEach(function (c) {
      var cid = str_(c['Condition ID']);
      if (!cid) return;
      var st = hiringConditionStatus_(c, facts);
      if (st === 'not_applicable') return;
      var seen = at[cid];
      if (seen) {
        if (seen.status === st) return;          // nothing moved: no write
        if (!seen.row) return;                   // appended this pass — the next one moves it
        sheet.getRange(seen.row, iSt + 1).setValue(st);
        if (iAt !== -1) sheet.getRange(seen.row, iAt + 1).setValue(now);
        wrote++;
        return;
      }
      var ok = hiringRuntimeAppend_('Condition Instances', {
        'Condition Instance ID': 'CI_' + Utilities.getUuid().replace(/-/g, '').slice(0, 18).toUpperCase(),
        'Condition ID': cid, 'Subject ID': subject, 'Instance ID': '',
        'Stage': String(stage || ''), 'Status': st, 'Evidence': '',
        'Opened At': now, 'Resolved At': st === 'satisfied' ? now : '',
        'Resolved By': 'matrix', 'Notes': 'materialized from the book'
      }, ctx);
      if (ok) {
        wrote++;
        if (!snap.added[subject]) snap.added[subject] = {};
        snap.added[subject][cid] = st;
      }
    });
    return wrote;
  } catch (e) { return 0; }
}

function hiringShadowSquare_(id, bookStatus, detail, who) {
  try {
    var key = 'hiring_shsq_' + id;
    var cache = CacheService.getScriptCache();
    if (cache.get(key)) return;
    cache.put(key, '1', 3600);
    hubSysLog_('matrix-shadow', 'square_divergence',
               id + ' — book says ' + bookStatus + ' · ' + detail +
               (who ? ' · ' + who : ''), { status: 409 });
  } catch (e) { /* silence */ }
}

/* ---- the Runtime book: facts, queue, instances --------------------------- */

// Header-matched append into a Runtime tab, under the script lock.
function hiringRuntimeAppend_(tabName, vals, context) {
  var rid = hiringRuntimeFor_(context);
  if (!rid) return false;
  var lock = LockService.getScriptLock();
  var held = false;
  try {
    held = lock.tryLock(5000);
    if (!held) return false;
    var sheet = ssOpen_(rid).getSheetByName(String(tabName || ''));
    if (!sheet) return false;
    var hdr = (sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
      .getValues()[0] || []).map(function (c) { return String(c || '').trim(); });
    if (!hdr.filter(String).length) return false;
    sheet.appendRow(hdr.map(function (h) {
      return vals[h] !== undefined ? hubCellSafe_(vals[h]) : '';
    }));
    return true;
  } catch (e) { return false; }
  finally { if (held) { try { lock.releaseLock(); } catch (eR) { /* released */ } } }
}

/** One durable truth about a subject. Parallel flows meet HERE. */
function hiringFactPut_(subjectId, factKey, value, opts) {
  opts = opts || {};
  if (!str_(subjectId) || !str_(factKey)) return false;
  return hiringRuntimeAppend_('Facts', {
    'Fact Key': String(factKey), 'Subject ID': String(subjectId),
    'Value': String(value == null ? '' : value),
    'Type': typeof value === 'boolean' ? 'boolean'
          : typeof value === 'number' ? 'number' : 'string',
    'Source': str_(opts.source), 'Evidence': str_(opts.evidence),
    'Recorded At': new Date().toISOString(), 'Recorded By': str_(opts.by),
    'Instance ID': str_(opts.instance)
  }, opts.context);
}

// A subject's facts off the Runtime book — append-only, last row wins.
var HIRING_FACTS_MEMO = {};
function hiringFactsIndex_(rid) {
  if (HIRING_FACTS_MEMO[rid]) return HIRING_FACTS_MEMO[rid];
  var index = {};
  try {
    hiringBookTab_(rid, 'rt_' + rid.slice(0, 8), 'Facts').forEach(function (r) {
      var subj = str_(r['Subject ID']);
      if (!subj) return;
      // last row wins, exactly as every other reader of this tab answers
      (index[subj] || (index[subj] = {}))[str_(r['Fact Key'])] =
        hiringFactValue_(r.Value, str_(r.Type));
    });
  } catch (e) { index = {}; }
  HIRING_FACTS_MEMO[rid] = index;
  return index;
}

function hiringSubjectFacts_(subjectId, context) {
  var want = str_(subjectId);
  if (!want) return {};
  try {
    var rid = hiringRuntimeFor_(context);
    if (!rid) return {};
    var hit = hiringFactsIndex_(rid)[want];
    // a COPY: callers merge their own facts into what they are handed, and a caller writing into the shared index…
    if (!hit) return {};
    var out = {};
    for (var k in hit) out[k] = hit[k];
    return out;
  } catch (e) { return {}; }  /* absent facts refuse nothing — rules fail closed */
}

/** The write queue is a TAB: atomic append, audit trail, no 9KB ceiling. */
function hiringQueuePush_(kind, subjectId, payload, opts) {
  opts = opts || {};
  if (!str_(kind)) return '';
  var id = 'Q_' + Utilities.getUuid().replace(/-/g, '').slice(0, 20).toUpperCase();
  var ok = hiringRuntimeAppend_('Queue', {
    'Queue ID': id, 'Kind': String(kind), 'Subject ID': str_(subjectId),
    'Instance ID': str_(opts.instance),
    'Payload': typeof payload === 'string' ? payload : JSON.stringify(payload || {}),
    'Status': 'open', 'Enqueued At': new Date().toISOString(), 'Attempts': '0'
  }, opts.context);
  return ok ? id : '';
}

/** A running flow is a ROW — the type is a book, the instance lives here. */
function hiringInstanceOpen_(flow, subjectId, opts) {
  opts = opts || {};
  if (!str_(flow) || !str_(subjectId)) return '';
  var id = 'FI_' + Utilities.getUuid().replace(/-/g, '').slice(0, 20).toUpperCase();
  var ok = hiringRuntimeAppend_('Flow Instances', {
    'Instance ID': id, 'Flow': String(flow),
    'Book ID': str_(opts.book) || hiringBookFor_(flow),
    'Subject ID': String(subjectId), 'Stage': str_(opts.stage),
    'Status': 'open', 'Opened At': new Date().toISOString(),
    'Opened By': str_(opts.by), 'Parent Instance': str_(opts.parent),
    'Notes': str_(opts.notes)
  }, flow);
  return ok ? id : '';
}

// Mint a parallel flow: copy the Registry's template book, register the context OFF.
HUB_POLICY.hiringFlowMint = {
  file: 'HiringMatrix.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin'], invalidates: [], emits: []
};
HUB_ACTIONS.hiringFlowMint = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var name = str_(payload && payload.name).toLowerCase();
  if (!/^[a-z][a-z0-9_-]{2,40}$/.test(name)) {
    return { status: 400, message: 'name: a lowercase slug, 3–41 chars (a-z 0-9 _ -).' };
  }
  var reg = hiringRegistry_();
  if (reg[name]) return { status: 409, message: '"' + name + '" is already registered.' };
  var tpl = reg.template;
  if (!tpl || !tpl.id) return { status: 400, message: 'the Registry has no template row.' };
  var copy = '';
  try {
    copy = DriveApp.getFileById(tpl.id).makeCopy('ASA Flow — ' + name).getId();
  } catch (e) {
    return { status: 502, message: 'the template could not be copied: ' + String((e && e.message) || e) };
  }
  var ok = hiringRuntimeAppend_('Registry', {
    'Context': name, 'Spreadsheet ID': copy, 'Status': 'off',
    'Notes': 'flow minted by ' + str_(user.email) + ' ' + new Date().toISOString()
  });
  if (!ok) {
    return { status: 502, message: 'the book was copied (' + copy + ') but the Registry row ' +
             'could not be written — add it by hand.' };
  }
  try { CacheService.getScriptCache().remove('hiring_registry_v1'); } catch (e2) { /* rebuilt */ }
  return { status: 200, data: { context: name, book: copy, status: 'off' } };
};

/* ---- the runtime answers for a tab that is gone -------------------------- */

// A LEGACY TAB, REBUILT FROM THE RUNTIME.
var HIRING_LEGACY_MEMO = {};

function hiringLegacyRows_(tabName) {
  var tab = String(tabName || '');
  if (!tab) return null;
  if (HIRING_LEGACY_MEMO.hasOwnProperty(tab)) return HIRING_LEGACY_MEMO[tab];
  var cacheKey = 'hiring_legacy_v1_' + tab;
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(cacheKey);
    // THE MEMO WAS FILLED ON THE SLOW PATH AND NOT ON THE FAST ONE .
    if (hit) {
      HIRING_LEGACY_MEMO[tab] = JSON.parse(hit);
      return HIRING_LEGACY_MEMO[tab];
    }
  } catch (e) { /* re-read */ }
  var rows = null;
  try {
    var rid = hubRuntimeId_();
    if (!rid) { HIRING_LEGACY_MEMO[tab] = null; return null; }
    var want = 'dissolution:' + tab + '.';
    var bySubject = {}, order = [];
    hiringBookTab_(rid, 'rt_' + rid.slice(0, 8), 'Facts').forEach(function (f) {
      var src = str_(f.Source);
      if (src.indexOf(want) !== 0) return;
      var sub = str_(f['Subject ID']);
      if (!sub) return;
      if (!bySubject[sub]) { bySubject[sub] = {}; order.push(sub); }
      bySubject[sub][src.slice(want.length)] = str_(f.Value);
    });
    if (!order.length) { HIRING_LEGACY_MEMO[tab] = null; return null; }
    var keyCol = HIRING_TAB_KEY[tab] || 'candidateid';
    rows = [];
    order.forEach(function (sub) {
      var row = bySubject[sub];
      // A row the platform deleted stays deleted: the fact is the tombstone.
      if (String(row.__deleted || '').toLowerCase() === 'true') return;
      if (!row[keyCol]) row[keyCol] = sub;
      rows.push(row);
    });
  } catch (e2) { HIRING_LEGACY_MEMO[tab] = null; return null; }
  try { cache.put(cacheKey, JSON.stringify(rows), 300); } catch (e3) { /* uncached */ }
  HIRING_LEGACY_MEMO[tab] = rows;
  return rows;
}

// The tab's RAW header, captured into the depot at dissolution time as a fact stamped schema:<tab>.header (a prefix…
function hiringLegacyHeader_(tabName) {
  var tab = String(tabName || '');
  if (!tab) return null;
  var cacheKey = 'hiring_rawhdr_v1_' + tab;
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(cacheKey);
    if (hit) {
      var cached = JSON.parse(hit);
      if (cached && cached.length) return cached;  // an empty hit is a miss
    }
  } catch (e) { /* re-read */ }
  var hdr = null;
  try {
    var rid = hubRuntimeId_();
    var want = 'schema:' + tab + '.header';
    hiringBookTab_(rid, 'rt_' + rid.slice(0, 8), 'Facts').some(function (f) {
      if (str_(f.Source) !== want) return false;
      hdr = JSON.parse(str_(f.Value));
      return true;
    });
  } catch (e2) { hdr = null; }
  // Only a header that was FOUND is cached.
  if (hdr && hdr.length) {
    try { cache.put(cacheKey, JSON.stringify(hdr), 3600); } catch (e3) { /* uncached */ }
  }
  return hdr;
}

/** The rebuilt rows under their RAW column names — what a slice expects. */
function hiringLegacyRawRows_(tabName) {
  var rows = hiringLegacyRows_(tabName);
  if (rows === null) return null;
  var hdr = hiringLegacyHeader_(tabName);
  if (!hdr || !hdr.length) return rows;
  var back = {};
  hdr.forEach(function (h) {
    back[String(h).replace(/[^A-Za-z0-9]+/g, '').toLowerCase()] = String(h);
  });
  return rows.map(function (row) {
    var out = {};
    Object.keys(row).forEach(function (k) { out[back[k] || k] = row[k]; });
    return out;
  });
}

// EVERY hiring tab dissolves — none is left behind.
var HIRING_DISSOLVABLE_TABS = [
  'entity_candidates', 'entity_resume_analyses', 'entity_phone_screens',
  'entity_in_person_interviews', 'entity_onboardings', 'entity_hiring_events',
  'entity_resume_inbox', 'hiring_journey', 'hiring_sim_asks', 'hiring_sim_ai',
  'hiring_sim_config', 'hiring_policy', 'hiring_alerts_config',
  'interview_asks', 'interview_ask_ai', 'onboarding_packet',
  'recruitment_config', 'recruitment_contracts', 'recruitment_docs',
  'candidate_documents', 'candidates', 'tp_candidates', 'tp_resume',
  'tp_screens'
];

/** The column that identifies a row. Absent = candidate_id, the default. */
var HIRING_TAB_KEY = {
  hiring_sim_config: 'key', hiring_alerts_config: 'key',
  recruitment_config: 'key', hiring_policy: 'key',
  recruitment_contracts: 'signaturerequestid',
  recruitment_docs: 'signaturerequestid',
  hiring_sim_ai: 'messageid', interview_ask_ai: 'messageid',
  entity_resume_inbox: 'fileid', candidate_documents: 'docrowid',
  entity_hiring_events: 'eventid', hiring_journey: 'journeyid',
  hiring_sim_asks: 'simaskid', interview_asks: 'askid'
};

/** The subject id of one row of a tab: its own key, else the candidate. */
function hiringRowKey_(tabName, row) {
  var col = HIRING_TAB_KEY[String(tabName || '')] || 'candidateid';
  var v = row ? (row[col] || row[col.replace(/_/g, '')]) : '';
  if (!v && col !== 'candidateid') v = row ? (row.candidateid || row.candidate_id) : '';
  return String(v == null ? '' : v).trim();
}

// IS THIS TAB DISSOLVED?
function hiringTabDissolved_(tabName) {
  var tab = String(tabName || '');
  if (!tab || HIRING_DISSOLVABLE_TABS.indexOf(tab) === -1) return false;
  var set = hiringDissolvedSet_();
  return set['*'] === true || set[tab] === true;
}

function hiringDissolvedSet_() {
  var set = {};
  try {
    var kv = switchboardValues_('dissolved');
    Object.keys(kv).forEach(function (t) {
      if (switchboardOn_(kv[t])) set[t] = true;
    });
  } catch (e) { set = {}; }
  return set;
}

// A WRITE TO A DISSOLVED TAB, LANDED IN THE RUNTIME.
function hiringLegacyWrite_(tabName, subjectId, fields, by) {
  var tab = String(tabName || ''), sub = str_(subjectId);
  if (!tab || !sub || !fields) return false;
  var rid = hubRuntimeId_();
  if (!rid) return false;
  var now = new Date().toISOString(), wrote = 0, landed = [];
  for (var col in fields) {
    if (!col) continue;
    var key = normKey_ ? normKey_(col) : String(col).replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
    // THE TOMBSTONE IS READ BY ITS RAW NAME, so it must not be normalised.
    if (String(col) === '__deleted') key = '__deleted';
    var fact = {
      'Fact Key': 'legacy.' + tab + '.' + key, 'Subject ID': sub,
      'Value': String(fields[col] == null ? '' : fields[col]),
      'Type': '', 'Source': 'dissolution:' + tab + '.' + key,
      'Evidence': '', 'Recorded At': now,
      'Recorded By': str_(by) || 'runtime-write', 'Instance ID': ''
    };
    if (hiringRuntimeAppend_('Facts', fact)) { wrote++; landed.push(fact); }
  }
  if (wrote) {
    hiringFactsReadBack_(rid, landed);
    try {
      var c = CacheService.getScriptCache();
      c.remove('hiring_legacy_v1_' + tab);
      // and the per-execution memo, or this very write reads its own stale copy
      try { HIRING_LEGACY_MEMO[tab] = undefined; delete HIRING_LEGACY_MEMO[tab]; } catch (eM) {}
      try { delete RUNTIME_SHEET_MEMO[tab]; } catch (eS) {}
      // The cheap fingerprint bulkTabsRevs_ reads instead of rebuilding.
      c.put('hiring_legacy_rev_' + tab, String(new Date().getTime()), 21600);
    } catch (e) { /* the 300s TTL retires it anyway */ }
  }
  return wrote > 0;
}

// A WRITE IS READ BACK BY THE EXECUTION THAT MADE IT.
function hiringFactsReadBack_(rid, landed) {
  if (!rid || !landed || !landed.length) return;
  var key = hiringBookTabKey_('rt_' + String(rid).slice(0, 8), 'Facts');
  var memo = HIRING_TAB_MEMO[key];
  if (memo && memo.length) {
    landed.forEach(function (f) {
      var row = {};
      for (var k in f) row[k] = String(f[k] == null ? '' : f[k]);
      memo.push(row);
    });
  }
  try { CacheService.getScriptCache().remove(key); } catch (e) { /* the 300s TTL retires it */ }
}

// FORGET WHAT THIS EXECUTION KNOWS ABOUT THESE TABS, so the next read is the sheet as it stands (hubEvidenceFresh_).
function hiringLegacyForget_(tabs) {
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (eC) { cache = null; }
  (tabs || []).forEach(function (t) {
    var tab = String(t || '');
    if (!tab) return;
    delete HIRING_LEGACY_MEMO[tab];
    try { delete RUNTIME_SHEET_MEMO[tab]; } catch (eS) { /* no shim was built */ }
    if (cache) { try { cache.remove('hiring_legacy_v1_' + tab); } catch (eR) { /* the 300s TTL retires it */ } }
  });
  var rid = '';
  try { rid = str_(hubRuntimeId_()); } catch (eI) { rid = ''; }
  if (!rid) return;
  var key = hiringBookTabKey_('rt_' + rid.slice(0, 8), 'Facts');
  delete HIRING_TAB_MEMO[key];
  if (cache) { try { cache.remove(key); } catch (eF) { /* the 300s TTL retires it */ } }
}

/* ---- the books reach every app: one door check --------------------------- */

// THE SEAM THE APP BOOKS ACT THROUGH.
function hiringActionPolicy_(action) {
  var name = str_(action);
  if (!name) return null;
  return hiringActionMap_()[name] || null;
}

// SWEEP-FED, NEVER BUILT ON A USER'S REQUEST.
function hiringActionMap_() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get('hiring_actionmap_v1');
    if (hit) return JSON.parse(hit);
  } catch (e) { /* fall to the bake */ }
  try {
    var baked = hubProp_('HIRING_ACTIONMAP');
    if (baked) {
      var map = JSON.parse(baked);
      try { cache.put('hiring_actionmap_v1', baked, 300); } catch (eC) { /* uncached */ }
      return map;
    }
  } catch (e2) { /* fall to silence */ }
  return {};
}

// The compile the requests no longer do — rides the machine sweep.
function hiringActionMapCompile_() {
  try {
    var gate = CacheService.getScriptCache();
    if (gate.get('hiring_actionmap_baked')) return;
    gate.put('hiring_actionmap_baked', '1', HIRING_REGISTRY_BAKE_EVERY_S);
  } catch (eG) { /* an unreadable cache compiles, never skips */ }
  var map = {};
  try {
    var reg = hiringRegistry_();
    for (var ctx in reg) {
      if (reg[ctx].status !== 'on' && reg[ctx].status !== 'shadow') continue;
      hiringMatrixTab_(ctx, 'Actions').forEach(function (r) {
        var h = str_(r.Handler);
        if (h.indexOf('gas:') !== 0) return;
        var fn = h.slice(4);
        if (!fn || map[fn]) return;
        map[fn] = { context: ctx, status: str_(r.Status).toLowerCase(),
                    mode: str_(r.Mode).toLowerCase() };
      });
    }
  } catch (e) { return; /* the previous bake keeps answering */ }
  try {
    var body = JSON.stringify(map);
    hubPropSet_('HIRING_ACTIONMAP', body);
    CacheService.getScriptCache().put('hiring_actionmap_v1', body, 300);
  } catch (e2) { /* the previous bake keeps answering */ }
}

var HIRING_DOOR_CLOSED = ['off', 'disabled', 'retired', 'closed'];

// The book's word on a door: an envelope to refuse with, or null to let the call through.
function hiringDoorRefusal_(action, user) {
  try {
    var pol = hiringActionPolicy_(action);
    if (!pol || HIRING_DOOR_CLOSED.indexOf(pol.status) === -1) return null;
    var mode = hiringBookMode_(pol.context);
    if (mode.status !== 'on') {
      hiringShadowDoor_(action, pol);
      return null;
    }
    hiringUsageStamp_(pol.context);
    return { status: 403, message: bookText_('Strings', 'refuse.door.closed_by_book', '')
             .split('{action}').join(String(action)).split('{context}').join(pol.context) ||
             'That door is closed in the ' + pol.context + ' book.' };
  } catch (e) { return null; }
}

function hiringShadowDoor_(action, pol) {
  try {
    var key = 'hiring_shdoor_' + String(action);
    var cache = CacheService.getScriptCache();
    if (cache.get(key)) return;
    cache.put(key, '1', 3600);
    hubSysLog_('matrix-shadow', 'door_would_close',
               String(action) + ' — the ' + pol.context + ' book says "' + pol.status +
               '"; the context is not on, so the call passed', { status: 409 });
  } catch (e) { /* silence */ }
}

/* ---- the flip-day instrument --------------------------------------------- */

// WATCH A BOOK JUDGE A REAL PERSON.
HUB_POLICY.hiringMatrixEval = {
  file: 'HiringMatrix.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'], invalidates: [], emits: []
};
HUB_ACTIONS.hiringMatrixEval = function (payload, user) {
  if (!user || (!user.is_service && user.role !== 'admin' && user.role !== 'manager')) {
    return hubDenied_();
  }
  var context = str_(payload && payload.context).toLowerCase();
  var subject = str_(payload && payload.subject_id);
  var mode = hiringBookMode_(context);
  if (!mode.id) return { status: 404, message: '"' + context + '" is not in any Registry.' };
  if (mode.status !== 'on' && mode.status !== 'shadow') {
    return { status: 409, message: '"' + context + '" is ' + (mode.status || 'blank') +
             ' — flip it to shadow or on before the book can be read.' };
  }
  var facts = hiringSubjectFacts_(subject, context);
  // The hiring board also answers from the tabs the card is drawn from, so a verdict here is the same one the ride…
  if (subject && (context === 'board' || context === 'hiring')) {
    try {
      var ev = hubEvidence_(subject);
      var fromEv = hiringFactsFromEvidence_(context, ev);
      for (var k in fromEv) { if (!(k in facts)) facts[k] = fromEv[k]; }
    } catch (eEv) { /* the runtime's own facts still answer */ }
  }
  var out = [], asked = {};
  hiringMatrixTab_(context, 'Conditions').forEach(function (c) {
    var st = hiringConditionStatus_(c, facts);
    var names = hiringRuleFacts_(c);
    names.forEach(function (n) { asked[n] = (n in facts) ? facts[n] : null; });
    out.push({ id: str_(c['Condition ID']), truth: str_(c.Truth), status: st,
               legacy: str_(c['Legacy Checklist ID']),
               blocking: str_(c.Blocking), owner: str_(c['Owner Role']),
               facts: names });
  });
  var tally = {};
  out.forEach(function (r) { tally[r.status] = (tally[r.status] || 0) + 1; });
  return { status: 200, data: { context: context, book: mode.id, switch: mode.status,
                                subject: subject, tally: tally, conditions: out,
                                facts_asked: asked,
                                facts_known: Object.keys(facts).length } };
};

/** Every fact id a condition's rules name, in reading order. */
function hiringRuleFacts_(row) {
  var seen = {}, out = [];
  ['Applicability Rule', 'Satisfies Rule', 'Partial Rule', 'Failure Rule', 'Terminal Rule']
    .forEach(function (col) {
      var s = str_(row[col]);
      if (!s) return;
      var m = s.match(/"fact"\s*:\s*"([^"]+)"/g) || [];
      m.forEach(function (hit) {
        var id = hit.replace(/^"fact"\s*:\s*"/, '').replace(/"$/, '');
        if (!seen[id]) { seen[id] = 1; out.push(id); }
      });
    });
  return out;
}

HUB_POLICY.hiringMatrixStatus = {
  file: 'HiringMatrix.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'], invalidates: [], emits: []
};
HUB_ACTIONS.hiringMatrixStatus = function (payload, user) {
  if (!user || (!user.is_service && user.role !== 'admin' && user.role !== 'manager')) {
    return hubDenied_();
  }
  var ids = hiringRuntimeIds_();
  if (!ids.length) return { status: 200, data: { runtime: '', rows: [] } };
  var deep = !!(payload && payload.deep);
  var rows = [];
  try {
    ids.forEach(function (rid) {
      var sheet = ssOpen_(rid).getSheetByName('Registry');
      var values = sheet ? sheet.getDataRange().getValues() : [];
      var hdr = (values[0] || []).map(function (c) { return String(c || '').trim(); });
      var iCtx = hdr.indexOf('Context');
      var iId = hdr.indexOf('Spreadsheet ID');
      var iSt = hdr.indexOf('Status');
      var iAt = hdr.indexOf('Last Read');
      for (var i = 1; i < values.length; i++) {
        var ctx = String(values[i][iCtx] || '').trim();
        if (!ctx || ctx.charAt(0) === '#') continue;
        var row = { context: ctx, runtime: rid,
                    status: String(values[i][iSt] || '').trim().toLowerCase(),
                    last_read: iAt === -1 ? '' : String(values[i][iAt] || ''),
                    book: String(values[i][iId] || '').trim() };
        if (deep && row.book) {
          try { row.tabs = ssOpen_(row.book).getSheets().length; row.opens = true; }
          catch (eO) { row.opens = false; }
        }
        rows.push(row);
      }
    });
  } catch (e) {
    return { status: 502, message: String((e && e.message) || e) };
  }
  return { status: 200, data: { runtime: ids.join(','), runtimes: ids, rows: rows } };
};
