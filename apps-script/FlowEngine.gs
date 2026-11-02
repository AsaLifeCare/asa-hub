// ------------------------------------------------------------------ FLOW ENGINE — the generic matrix reader, for…
// The rule over this file: the hiring motor is NOT touched — this file is an ADDITIONAL, neutral engine for the…

// The platform's own runtime — the Essencial.
function flowRuntimeId_() {
  try { return String(hubProp_('HUB_APPS_RUNTIME_ID') || '').trim(); }
  catch (e) { return ''; }
}

/** The contexts hiring's engine owns. Everything else is "the rest". */
var FLOW_FOREIGN_CONTEXTS = { board: 1, hiring: 1, template: 1 };

// The Registry, read fresh every 300s: Context → { id, status, note, app }.
function flowRegistry_() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get('flow_registry_v1');
    if (hit) return JSON.parse(hit);
  } catch (e) { /* re-read */ }
  var map = {};
  try {
    var rid = flowRuntimeId_();
    if (rid) {
      var sheet = ssOpen_(rid).getSheetByName('Registry');
      if (sheet) {
        var values = sheet.getDataRange().getValues();
        var hdr = (values[0] || []).map(function (c) { return String(c || '').trim(); });
        var iCtx = hdr.indexOf('Context');
        var iId = hdr.indexOf('Spreadsheet ID');
        var iSt = hdr.indexOf('Status');
        var iNote = hdr.indexOf('Notes');
        var iApp = hdr.indexOf('App');
        if (iCtx !== -1 && iId !== -1 && iSt !== -1) {
          for (var i = 1; i < values.length; i++) {
            var ctx = String(values[i][iCtx] || '').trim().toLowerCase();
            if (!ctx || ctx.charAt(0) === '#' || map[ctx]) continue;
            if (FLOW_FOREIGN_CONTEXTS[ctx]) continue;
            var app = iApp === -1 ? '' : String(values[i][iApp] || '').trim().toLowerCase();
            if (!app) app = ctx.split(/[-.]/)[0];
            map[ctx] = { id: String(values[i][iId] || '').trim(),
                         status: String(values[i][iSt] || '').trim().toLowerCase(),
                         note: iNote === -1 ? '' : String(values[i][iNote] || '').trim(),
                         app: app };
          }
        }
      }
    }
  } catch (e2) { map = {}; }
  try { cache.put('flow_registry_v1', JSON.stringify(map), 300); } catch (e3) { /* uncached */ }
  return map;
}

function flowBookMode_(context) {
  var want = String(context || '').trim().toLowerCase();
  if (!want) return { id: '', status: '', app: '' };
  var row = flowRegistry_()[want];
  return row ? { id: row.id, status: row.status, app: row.app }
             : { id: '', status: '', app: '' };
}

/** Registry's Last Read stamp — cache-gated to 1/hour; never costs a read. */
function flowUsageStamp_(context) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'flow_lastread_' + String(context);
    if (cache.get(key)) return;
    cache.put(key, '1', 3600);
    var rid = flowRuntimeId_();
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

/** One matrix tab as row objects — 'on' or 'shadow' contexts only. */
function flowTab_(context, tabName) {
  var mode = flowBookMode_(context);
  if (!mode.id || (mode.status !== 'on' && mode.status !== 'shadow')) return [];
  return flowBookTab_(mode.id, String(context).trim().toLowerCase(), tabName);
}

// ONE READ PER EXECUTION per (book, tab) — the memo lives and dies with the request, so a Facts tab past the 100KB…
var FLOW_TAB_MEMO = {};
function flowBookTab_(sid, cacheScope, tabName) {
  var cacheKey = 'flow_mx_v1_' + cacheScope + '_' + String(tabName || '');
  if (FLOW_TAB_MEMO[cacheKey]) return FLOW_TAB_MEMO[cacheKey];
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(cacheKey);
    if (hit) {
      FLOW_TAB_MEMO[cacheKey] = JSON.parse(hit);
      return FLOW_TAB_MEMO[cacheKey];
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
  FLOW_TAB_MEMO[cacheKey] = rows;
  try { cache.put(cacheKey, JSON.stringify(rows), 300); } catch (e3) { /* uncached */ }
  return rows;
}

/* ---- the rule grammar, judged pure --------------------------------------- */

/** {"fact",<op>}, {"all":[…]}, {"any":[…]}. Blank = true; broken = FALSE. */
function flowRuleOk_(rule, facts) {
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
      if (!flowRuleOk_(all[i], facts)) return false;
    }
    return true;
  }
  if (Object.prototype.hasOwnProperty.call(rule, 'any')) {
    var any = rule.any || [];
    for (var j = 0; j < any.length; j++) {
      if (flowRuleOk_(any[j], facts)) return true;
    }
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(rule, 'fact')) {
    return flowCompare_(rule, facts[String(rule.fact)], facts);
  }
  return false;
}

// The comparator table — the same 23 operators the hiring engine speaks (its audit is why the table exists at all).
function flowCompare_(rule, got, facts) {
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

  var known = ['equals', 'equals_ci', 'not_equals', 'not_equals_ci', 'in', 'in_ci',
               'not_in', 'not_in_ci', 'starts_with', 'starts_with_ci', 'contains_ci',
               'matches', 'gte', 'gt', 'lte', 'lt', 'present', 'equals_fact',
               'equals_ci_fact', 'gte_fact', 'lt_fact', 'in_fact', 'in_ci_fact'];
  for (var op in rule) {
    if (op === 'fact' || op === 'otherwise') continue;
    if (known.indexOf(op) === -1) {
      try {
        // said once, not per evaluation (hubRuleUnknownOnce_, HiringMatrix.gs)
        if (hubRuleUnknownOnce_('flow-engine', rule.fact, op)) {
          hubSysLog_('flow-engine', 'rule_operator_unknown',
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

/** → satisfied | open | not_applicable | failed | terminal */
function flowConditionStatus_(row, facts) {
  var app = str_(row['Applicability Rule']);
  if (app && !flowRuleOk_(app, facts)) return 'not_applicable';
  if (str_(row['Terminal Rule']) && flowRuleOk_(row['Terminal Rule'], facts)) return 'terminal';
  if (str_(row['Failure Rule']) && flowRuleOk_(row['Failure Rule'], facts)) return 'failed';
  var sat = str_(row['Satisfies Rule']);
  if (!sat) return 'satisfied';
  return flowRuleOk_(sat, facts) ? 'satisfied' : 'open';
}

// The book's verdict for one rung: Requires ids hop Flow Bindings to their Conditions; a bare Condition id resolves…
function flowGateEval_(transitions, bindings, conditions, facts, from, to) {
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
    var st = flowConditionStatus_(c, facts);
    if (st === 'satisfied' || st === 'not_applicable') return true;
    reasons.push(str_(c.Truth) || id);
    return false;
  };
  var ok = true;
  var reqAll = flowIdList_(t['Requires All']);
  for (var a = 0; a < reqAll.length; a++) { if (!need(reqAll[a])) ok = false; }
  var reqAny = flowIdList_(t['Requires Any']);
  if (reqAny.length) {
    var before = reasons.length;
    var anyOk = false;
    for (var b = 0; b < reqAny.length; b++) { if (need(reqAny[b])) anyOk = true; }
    if (anyOk) reasons.length = before; else ok = false;
  }
  if (str_(t['When Rule']) && !flowRuleOk_(t['When Rule'], facts)) {
    ok = false;
    reasons.push('when: ' + str_(t['When Rule']));
  }
  return { from: from, to: to, ok: ok, reasons: reasons,
           transition: str_(t['Transition ID']) };
}

function flowIdList_(cell) {
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

/** Every fact id a condition's rules name, in reading order. */
function flowRuleFacts_(row) {
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

/* ---- the Runtime book: append, facts, queue, instances ------------------- */

// Header-matched append into a Runtime tab, under the script lock.
function flowRuntimeAppend_(tabName, vals) {
  var rid = flowRuntimeId_();
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
function flowFactPut_(subjectId, factKey, value, opts) {
  opts = opts || {};
  if (!str_(subjectId) || !str_(factKey)) return false;
  return flowRuntimeAppend_('Facts', {
    'Fact Key': String(factKey), 'Subject ID': String(subjectId),
    'Value': String(value == null ? '' : value),
    'Type': typeof value === 'boolean' ? 'boolean'
          : typeof value === 'number' ? 'number' : 'string',
    'Source': str_(opts.source), 'Evidence': str_(opts.evidence),
    'Recorded At': new Date().toISOString(), 'Recorded By': str_(opts.by),
    'Instance ID': str_(opts.instance)
  });
}

// A subject's facts off the Runtime book — append-only, last row wins.
var FLOW_FACTS_MEMO = {};
function flowFactsIndex_(rid) {
  if (FLOW_FACTS_MEMO[rid]) return FLOW_FACTS_MEMO[rid];
  var index = {};
  try {
    flowBookTab_(rid, 'rt_' + rid.slice(0, 8), 'Facts').forEach(function (r) {
      var subj = str_(r['Subject ID']);
      if (!subj) return;
      var type = str_(r.Type);
      var v = String(r.Value == null ? '' : r.Value);
      // last row wins, exactly as every reader of this tab already answers
      (index[subj] || (index[subj] = {}))[str_(r['Fact Key'])] =
        type === 'boolean' ? (v.trim() !== '' && !/^(false|no|0)$/i.test(v))
        : type === 'number' ? (isFinite(Number(v)) ? Number(v) : v)
        : v;
    });
  } catch (e) { index = {}; }
  FLOW_FACTS_MEMO[rid] = index;
  return index;
}

function flowSubjectFacts_(subjectId) {
  var want = str_(subjectId);
  if (!want) return {};
  try {
    var rid = flowRuntimeId_();
    if (!rid) return {};
    var hit = flowFactsIndex_(rid)[want];
    // a COPY: callers merge platform facts into what they are handed, and a caller writing into the shared index…
    if (!hit) return {};
    var out = {};
    for (var k in hit) out[k] = hit[k];
    return out;
  } catch (e) { return {}; }  /* absent facts refuse nothing — rules fail closed */
}

/** The write queue is a TAB: atomic append, audit trail, no 9KB ceiling. */
function flowQueuePush_(kind, subjectId, payload, opts) {
  opts = opts || {};
  if (!str_(kind)) return '';
  var id = 'Q_' + Utilities.getUuid().replace(/-/g, '').slice(0, 20).toUpperCase();
  var ok = flowRuntimeAppend_('Queue', {
    'Queue ID': id, 'Kind': String(kind), 'Subject ID': str_(subjectId),
    'Instance ID': str_(opts.instance),
    'Payload': typeof payload === 'string' ? payload : JSON.stringify(payload || {}),
    'Status': 'open', 'Enqueued At': new Date().toISOString(), 'Attempts': '0'
  });
  return ok ? id : '';
}

/** A running flow is a ROW — the type is a book, the instance lives here. */
function flowInstanceOpen_(context, subjectId, opts) {
  opts = opts || {};
  if (!str_(context) || !str_(subjectId)) return '';
  var id = 'FI_' + Utilities.getUuid().replace(/-/g, '').slice(0, 20).toUpperCase();
  var ok = flowRuntimeAppend_('Flow Instances', {
    'Instance ID': id, 'Flow': String(context),
    'Book ID': str_(opts.book) || flowBookMode_(context).id,
    'Subject ID': String(subjectId), 'Stage': str_(opts.stage),
    'Status': 'open', 'Opened At': new Date().toISOString(),
    'Opened By': str_(opts.by), 'Parent Instance': str_(opts.parent),
    'Notes': str_(opts.notes)
  });
  return ok ? id : '';
}

/* ---- the facts the platform itself can answer about a book --------------- */

// A book about a data tab can be judged by the clock only as far as the platform can SEE: whether the tab dissolved…
function flowPlatformFacts_(context, note) {
  var facts = {};
  var m = String(note || '').match(/data:\s*([A-Za-z0-9_]+)/);
  var tab = m ? m[1] : '';
  facts['context'] = String(context);
  if (!tab) return facts;
  facts['tab'] = tab;
  var dissolved = false;
  try {
    var kv = switchboardValues_('dissolved');
    dissolved = switchboardOn_(kv['*']) || switchboardOn_(kv[tab]);
  } catch (e) { dissolved = false; }
  facts[tab + '.dissolved'] = dissolved;
  var home = '';
  try { if (typeof hubTabHomeId_ === 'function') home = String(hubTabHomeId_(tab) || ''); }
  catch (e2) { home = ''; }
  facts[tab + '.moved_home'] = !!home;
  facts[tab + '.migrated'] = dissolved || !!home;
  return facts;
}

/* ---- the sweep: honest verdicts, written down ---------------------------- */

// THE REST'S CONDITIONS BECOME DURABLE.
var ENGINE_GATE_S = 20;

// HOW LONG ONE ENGINE MAY WORK IN ONE EXECUTION.
var ENGINE_BUDGET_MS = 45000;

// HOW MANY BOOKS ONE ENGINE JUDGES IN ONE PASS — and it is fifteen, measured.
var ENGINE_PASS_CAP = 15;

// NOTHING CHANGED, SO DO NOT OPEN FORTY-FIVE SPREADSHEETS TO PROVE IT.
var ENGINE_IDLE_FLOOR_MS = 600000;

/** The ledger both runners write and both runners read. */
var ENGINE_ROUNDS_TAB = 'Rounds';

// THE ROUND STAMP — "slice X passed here, over these units, at this time".
function engineRoundStamp_(name, detail) {
  detail = detail || {};
  try {
    var now = new Date().toISOString();
    var ms = Number(detail.ms) || 0;
    return flowRuntimeAppend_(ENGINE_ROUNDS_TAB, {
      'Round ID': 'RND_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16).toUpperCase(),
      'Slice': String(name),
      'Runner': 'apps-script',
      'From': detail.from === undefined ? '' : detail.from,
      'To': detail.to === undefined ? '' : detail.to,
      'Of': detail.of === undefined ? '' : detail.of,
      'Units': detail.units === undefined ? '' : detail.units,
      'Wrote': detail.wrote === undefined ? '' : detail.wrote,
      'Started At': new Date(Date.now() - ms).toISOString(),
      'Finished At': now,
      'Ms': ms,
      'Notes': detail.notes ? String(detail.notes) : ''
    });
  } catch (e) { return false; }   // a stamp must never cost the round
}

// Every round on the ledger, newest last.
var ENGINE_ROUNDS_WINDOW = 200;
var ENGINE_ROUNDS_MEMO = null;
function engineRounds_() {
  // THE LAST TWO HUNDRED ROWS, NEVER THE TAB.
  if (ENGINE_ROUNDS_MEMO) return ENGINE_ROUNDS_MEMO;
  var out = [];
  try {
    var rid = flowRuntimeId_();
    if (!rid) return [];
    var sheet = ssOpen_(rid).getSheetByName(ENGINE_ROUNDS_TAB);
    if (!sheet) return [];
    var last = sheet.getLastRow();
    if (last < 2) return [];
    var hdr = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
      .getValues()[0].map(function (c) { return String(c || '').trim(); });
    var from = Math.max(2, last - ENGINE_ROUNDS_WINDOW + 1);
    var rows = sheet.getRange(from, 1, last - from + 1, hdr.length).getValues();
    rows.forEach(function (r) {
      var o = {}, any = false;
      for (var i = 0; i < hdr.length; i++) {
        if (!hdr[i]) continue;
        var v = String(r[i] == null ? '' : r[i]);
        if (v) any = true;
        o[hdr[i]] = v;
      }
      if (any) out.push(o);
    });
  } catch (e) { out = []; }
  ENGINE_ROUNDS_MEMO = out;
  return out;
}

// THE LEDGER IS BOUNDED, and it has to be: the rule is that every pass writes a row even when it did nothing — a…
var ENGINE_ROUNDS_MAX = 2000;
function engineRoundsTrimMaybe_() {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('rounds_trimmed')) return 0;
    cache.put('rounds_trimmed', '1', 3600);
    var rid = flowRuntimeId_();
    if (!rid) return 0;
    var sheet = ssOpen_(rid).getSheetByName(ENGINE_ROUNDS_TAB);
    if (!sheet) return 0;
    var last = sheet.getLastRow();
    var over = last - 1 - ENGINE_ROUNDS_MAX;
    if (over <= 0) return 0;
    sheet.deleteRows(2, over);          // row 1 is the header
    return over;
  } catch (e) { return 0; }             // a ledger that cannot be trimmed still works
}

/** The last round a named slice recorded, whoever ran it, or null. */
function engineRoundLast_(name) {
  var want = String(name), hit = null;
  engineRounds_().forEach(function (r) {
    if (str_(r.Slice) === want) hit = r;      // newest last
  });
  return hit;
}

// HAS SOMEBODY ALREADY WALKED THIS?
function engineRangeCovered_(name, from, to, withinMs) {
  try {
    var want = String(name);
    var f = Number(from), t = Number(to);
    if (!isFinite(f) || !isFinite(t)) return false;
    var floor = Date.now() - (Number(withinMs) || 300000);
    var covered = false;
    engineRounds_().forEach(function (r) {
      if (covered || str_(r.Slice) !== want) return;
      var rf = Number(r.From), rt = Number(r.To);
      if (!isFinite(rf) || !isFinite(rt)) return;
      var at = Date.parse(str_(r['Finished At']));
      if (!isFinite(at) || at < floor) return;
      // a wrapped window (it rolled past the end and restarted) covers everything from rf to the end and from 0 to…
      if (rf <= rt ? (f >= rf && t <= rt) : (f >= rf || t <= rt)) covered = true;
    });
    return covered;
  } catch (e) { return false; }
}


// true when this engine can skip: the Facts tab has not grown since it last judged AND the floor has not expired.
function engineNothingMoved_(engineName) {
  try {
    var rid = flowRuntimeId_();
    if (!rid) return false;
    var count = 0;
    try {
      var facts = ssOpen_(rid).getSheetByName('Facts');
      count = facts ? facts.getLastRow() : 0;
    } catch (eN) { return false; }   // unreadable signal means JUDGE, never skip
    var now = Date.now();
    var key = 'ENGINE_MARK_' + String(engineName).toUpperCase();
    var was = String(hubProp_(key) || '');
    var parts = was.split('|');
    var lastCount = parseInt(parts[0], 10);
    var lastAt = parseInt(parts[1], 10);
    var fresh = isFinite(lastAt) && (now - lastAt) < ENGINE_IDLE_FLOOR_MS;
    if (fresh && isFinite(lastCount) && lastCount === count) return true;
    // about to judge — the mark is written NOW rather than after, so a pass that dies at the ceiling does not leave…
    try { hubPropSet_(key, count + '|' + now); } catch (eW) { /* judge anyway */ }
    return false;
  } catch (e) {
    return false;   // unreadable signal means JUDGE, never skip
  }
}

function flowConditionsSweepMaybe_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('flow_ci_swept')) return 0;
  if (engineNothingMoved_('flow')) {
    // always a row, never a gap — see the runtime engine's note
    engineRoundStamp_('flow', { units: 0, wrote: 0, ms: 0,
                                notes: 'skipped: no new facts since the last round' });
    return 0;
  }
  cache.put('flow_ci_swept', '1', ENGINE_GATE_S);
  return flowConditionsSweepRun_();
}

function flowConditionsSweepRun_() {
  var rid = flowRuntimeId_();
  if (!rid) return 0;
  var sheet;
  try { sheet = ssOpen_(rid).getSheetByName('Condition Instances'); }
  catch (e) { return 0; }
  if (!sheet) return 0;

  var reg = flowRegistry_();
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

 // FORTY PER PASS, BUT NOT THE SAME FORTY.
  var order = Object.keys(reg).filter(function (c) {
    return !(typeof runtimeOwnsContext_ === 'function' && runtimeOwnsContext_(c));
  }).sort();
  var cursor = 0;
  try { cursor = parseInt(hubProp_('FLOW_JUDGE_CURSOR') || '0', 10) || 0; } catch (eCur) { cursor = 0; }
  if (cursor >= order.length) cursor = 0;
  var ordered = order.slice(cursor).concat(order.slice(0, cursor));

  var wrote = 0, judged = 0, skipped = 0, walked = 0;
  // the same deadline the runtime engine keeps — see ENGINE_BUDGET_MS.
  var deadline = Date.now() + ENGINE_BUDGET_MS;
  ordered.forEach(function (ctx) {
    if (judged >= ENGINE_PASS_CAP) return;     // measured, not guessed — see the constant
    if (Date.now() > deadline) return;        // …and never a dead one
    walked++;
    var row = reg[ctx];
    if (!row || row.status !== 'on') return;
    var conditions = flowTab_(ctx, 'Conditions');
    if (!conditions.length) return;
    judged++;
    var facts = flowSubjectFacts_(ctx);
    var pf = flowPlatformFacts_(ctx, row.note);
    for (var k in pf) { if (!(k in facts)) facts[k] = pf[k]; }
    conditions.forEach(function (c) {
      var cid = str_(c['Condition ID']);
      if (!cid) return;
      var names = flowRuleFacts_(c);
      for (var n = 0; n < names.length; n++) {
        if (!(names[n] in facts)) { skipped++; return; }   // honesty law
      }
      var st = flowConditionStatus_(c, facts);
      if (st === 'not_applicable') return;
      var seen = at[cid + '|' + ctx];
      if (seen) {
        if (seen.status === st) return;        // nothing moved: no write
        sheet.getRange(seen.row, iSt + 1).setValue(st);
        if (iAt !== -1 && st === 'satisfied') {
          sheet.getRange(seen.row, iAt + 1).setValue(now);
        }
        wrote++;
        return;
      }
      if (flowRuntimeAppend_('Condition Instances', {
        'Condition Instance ID': 'CI_FL_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16).toUpperCase(),
        'Condition ID': cid, 'Subject ID': ctx, 'Instance ID': '',
        'Stage': 'standing', 'Status': st, 'Evidence': 'book ' + str_(row.id),
        'Opened At': now, 'Resolved At': st === 'satisfied' ? now : '',
        'Resolved By': 'flow-engine', 'Notes': 'judged by the generic sweep'
      })) wrote++;
    });
  });
  // Where the next pass starts.
  try {
    hubPropSet_('FLOW_JUDGE_CURSOR', String(order.length ? (cursor + walked) % order.length : 0));
  if (typeof engineRoundStamp_ === 'function') {
    engineRoundStamp_('flow', {
      from: cursor, to: (order.length ? (cursor + walked) % order.length : 0),
      of: order.length, units: walked, judged: judged, wrote: wrote,
      skipped: skipped, ms: Date.now() - (deadline - ENGINE_BUDGET_MS)
    });
  }
  } catch (eSet) { /* a cursor that cannot be saved costs a repeat, never a wrong verdict */ }
  if (wrote) {
    try {
      hubSysLog_('flow-engine', 'flow_instances_materialized',
                 wrote + ' verdict(s) written or moved across ' + judged +
                 ' book(s); ' + skipped + ' rule(s) unanswerable by the clock');
    } catch (eL) { /* the log never costs the sweep */ }
  }
  return wrote;
}

/* ---- the receiver: a tab served from the house the depot names ------------ */

// THE ESSENCIAL IS THE ONE AUTHORITY — the single source of data.
function flowHouseKey_(tab) {
  return 'HUB_HOUSE_' + String(tab || '').toUpperCase() + '_ID';
}

function flowHouseId_(tab) {
  if (!String(tab || '')) return '';
  try { return String(hubProp_(flowHouseKey_(tab)) || '').trim(); }
  catch (e) { return ''; }
}

// The house's rows for a tab, header-keyed exactly as the sheet spells them; null when the depot names no house or…
function flowHouseRows_(tab) {
  var id = flowHouseId_(tab);
  if (!id) return null;
  var rows = flowBookTab_(id, 'house_' + String(tab), String(tab));
  return rows.length ? rows : null;
}

/* ---- the schema feeder: the JSONs feed themselves ------------------------- */

// WHO FEEDS THE JSONS: this does — never a hand.
function flowSchemaSweepMaybe_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('flow_schema_swept')) return 0;
  cache.put('flow_schema_swept', '1', 21600);
  return flowSchemaSweepRun_();
}

function flowSchemaSweepRun_() {
  var rid = flowRuntimeId_();
  if (!rid) return 0;
  // the newest schema fact per tab, off the runtime's own Facts
  var have = {};
  flowBookTab_(rid, 'rt_' + rid.slice(0, 8), 'Facts').forEach(function (r) {
    var src = str_(r.Source);
    if (src.indexOf('schema:') === 0 && /\.header$/.test(src)) {
      have[src] = str_(r.Value);                 // later rows overwrite: last wins
    }
  });
  var reg = flowRegistry_();
  var now = new Date().toISOString();
 // A CAP WITHOUT A CURSOR IS A CEILING ON THE WORLD: this walked the registry from the beginning every pass and…
  var order = Object.keys(reg).sort();
  if (!order.length) return 0;
  var cursor = 0;
  try { cursor = parseInt(hubProp_('SCHEMA_FEED_CURSOR') || '0', 10) || 0; }
  catch (eSc) { cursor = 0; }
  if (cursor >= order.length) cursor = 0;
  var ordered = order.slice(cursor).concat(order.slice(0, cursor));

  var wrote = 0, walked = 0, examined = 0;
  var deadline = Date.now() + ENGINE_BUDGET_MS;
  ordered.forEach(function (ctx) {
    if (walked >= ENGINE_PASS_CAP) return;       // measured, not guessed
    if (Date.now() > deadline) return;           // …and never a dead one
    // TWO COUNTERS, TWO JOBS.
    examined++;
    var row = reg[ctx];
    if (!row || row.status !== 'on') return;
    var m = str_(row.note).match(/data:\s*([A-Za-z0-9_]+)/);
    if (!m) return;
    var tab = m[1];
    walked++;
    var hdr = null;
    try {
      // The one resolver (TabRouter.gs).
      var sheet = hubTabSheet_(tab);
      if (sheet && sheet.getLastColumn() > 0) {
        hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
          .map(function (c) { return String(c == null ? '' : c); })
          .filter(function (c) { return c.trim() !== ''; });
      }
    } catch (e) { hdr = null; }
    if (!hdr || !hdr.length) return;             // nothing readable feeds nothing
    var body = JSON.stringify(hdr);
    var src = 'schema:' + tab + '.header';
    if (have[src] === body) return;              // unchanged: no write
    if (flowRuntimeAppend_('Facts', {
      'Fact Key': 'schema.' + tab + '.header', 'Subject ID': '__schema',
      'Value': body, 'Type': '', 'Source': src, 'Evidence': '',
      'Recorded At': now, 'Recorded By': 'flow-engine', 'Instance ID': ''
    })) { have[src] = body; wrote++; }
  });
  try {
    hubPropSet_('SCHEMA_FEED_CURSOR', String((cursor + examined) % order.length));
  } catch (eSs) { /* a cursor that cannot be saved costs a repeat, never a lie */ }
  if (typeof engineRoundStamp_ === 'function') {
    engineRoundStamp_('schema-feed', {
      from: cursor, to: (cursor + examined) % order.length, of: order.length,
      units: examined, wrote: wrote,
      ms: Date.now() - (deadline - ENGINE_BUDGET_MS)
    });
  }
  if (wrote) {
    try {
      hubSysLog_('flow-engine', 'schema_headers_fed',
                 wrote + ' header(s) written across ' + walked + ' data book(s)');
    } catch (eL) { /* the log never costs the sweep */ }
  }
  return wrote;
}

/* ---- the doors ------------------------------------------------------------ */

/** The sweep, callable by hand and by the relay's service clock. */
HUB_POLICY.flowSweepNow = {
  file: 'FlowEngine.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.flowSweepNow = function (payload, user) {
  if (!user) return hubDenied_();
  if (!user.is_service && ['admin', 'manager'].indexOf(String(user.role)) === -1) {
    return hubDenied_();
  }
  var wrote = flowConditionsSweepRun_();
  var fed = 0;
  try { fed = flowSchemaSweepMaybe_(); } catch (eS) { /* verdicts still count */ }
  try {
    hubSysLog_(str_(user.email), 'flow_sweep_now',
               wrote + ' verdict(s), ' + fed + ' schema header(s)', { status: 200 });
  } catch (e) { /* logged or not, the answer stands */ }
  return { status: 200, data: { wrote: wrote, schema_fed: fed } };
};

// WATCH A BOOK JUDGE — the rest's flip-day instrument, read-only: every condition's verdict WITH the facts it asked…
HUB_POLICY.flowEval = {
  file: 'FlowEngine.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'], invalidates: [], emits: []
};
HUB_ACTIONS.flowEval = function (payload, user) {
  if (!user || (!user.is_service && user.role !== 'admin' && user.role !== 'manager')) {
    return hubDenied_();
  }
  var context = str_(payload && payload.context).toLowerCase();
  var mode = flowBookMode_(context);
  if (!mode.id) return { status: 404, message: '"' + context + '" is not in the Registry (or is hiring\'s).' };
  if (mode.status !== 'on' && mode.status !== 'shadow') {
    return { status: 409, message: '"' + context + '" is ' + (mode.status || 'blank') +
             ' — flip it to shadow or on before the book can be read.' };
  }
  var subject = str_(payload && payload.subject_id) || context;
  var facts = flowSubjectFacts_(subject);
  var reg = flowRegistry_()[context] || {};
  var pf = flowPlatformFacts_(context, reg.note);
  for (var k in pf) { if (!(k in facts)) facts[k] = pf[k]; }
  var out = [], asked = {};
  flowTab_(context, 'Conditions').forEach(function (c) {
    var names = flowRuleFacts_(c);
    var answerable = true;
    for (var n = 0; n < names.length; n++) {
      if (!(names[n] in facts)) answerable = false;
      asked[names[n]] = (names[n] in facts) ? facts[names[n]] : null;
    }
    out.push({ id: str_(c['Condition ID']), truth: str_(c.Truth),
               status: answerable ? flowConditionStatus_(c, facts) : 'unanswerable_here',
               blocking: str_(c.Blocking), owner: str_(c['Owner Role']),
               facts: names });
  });
  flowUsageStamp_(context);
  var tally = {};
  out.forEach(function (r) { tally[r.status] = (tally[r.status] || 0) + 1; });
  return { status: 200, data: { context: context, app: mode.app, book: mode.id,
                                switch: mode.status, subject: subject, tally: tally,
                                conditions: out, facts_asked: asked,
                                facts_known: Object.keys(facts).length } };
};

/** The Registry of the rest, grouped by app — the board of what is wired. */
HUB_POLICY.flowStatus = {
  file: 'FlowEngine.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'], invalidates: [], emits: []
};
HUB_ACTIONS.flowStatus = function (payload, user) {
  if (!user || (!user.is_service && user.role !== 'admin' && user.role !== 'manager')) {
    return hubDenied_();
  }
  var reg = flowRegistry_();
  var apps = {};
  Object.keys(reg).forEach(function (ctx) {
    var row = reg[ctx];
    var app = row.app || 'other';
    if (!apps[app]) apps[app] = [];
    apps[app].push({ context: ctx, status: row.status, book: row.id });
  });
  return { status: 200, data: { runtime: flowRuntimeId_(), apps: apps,
                                contexts: Object.keys(reg).length } };
};
