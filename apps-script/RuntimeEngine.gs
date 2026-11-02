// Judging is borrowed from FlowEngine so two engines never disagree on a verdict; only the book list and cursor are ours.
var RUNTIME_CTX_PREFIX = 'data.';

function runtimeOwnsContext_(context) {
  return String(context || '').toLowerCase().indexOf(RUNTIME_CTX_PREFIX) === 0;
}

function runtimeRegistry_() {
  var all = {};
  try { all = flowRegistry_() || {}; } catch (e) { return {}; }
  var mine = {};
  Object.keys(all).forEach(function (ctx) {
    if (runtimeOwnsContext_(ctx)) mine[ctx] = all[ctx];
  });
  return mine;
}

function runtimeConditionsSweepMaybe_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('runtime_ci_swept')) return 0;
  // A skip is still stamped: "nothing changed" is a result.
  if (typeof engineNothingMoved_ === 'function' && engineNothingMoved_('runtime')) {
    if (typeof engineRoundStamp_ === 'function') {
      engineRoundStamp_('runtime', { units: 0, wrote: 0, ms: 0,
                                     notes: 'skipped: no new facts since the last round' });
    }
    return 0;
  }
  cache.put('runtime_ci_swept', '1', ENGINE_GATE_S);
  return runtimeConditionsSweepRun_();
}

// Own cursor: sharing FlowEngine's would make the two fight over one position.
function runtimeConditionsSweepRun_() {
  var rid = flowRuntimeId_();
  if (!rid) return 0;
  var sheet;
  try { sheet = ssOpen_(rid).getSheetByName('Condition Instances'); }
  catch (e) { return 0; }
  if (!sheet) return 0;

  var reg = runtimeRegistry_();
  var order = Object.keys(reg).sort();
  if (!order.length) return 0;

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

  var cursor = 0;
  try { cursor = parseInt(hubProp_('RUNTIME_JUDGE_CURSOR') || '0', 10) || 0; } catch (eC) { cursor = 0; }
  if (cursor >= order.length) cursor = 0;
  // The Rounds ledger is read before the work so a relay slice's window is not redone; unreadable means not covered.
  var window = Math.min(RUNTIME_JUDGE_CAP, order.length);
  if (typeof engineRangeCovered_ === 'function' &&
      engineRangeCovered_('runtime', cursor, cursor + window, 300000)) {
    try {
      hubPropSet_('RUNTIME_JUDGE_CURSOR', String((cursor + window) % order.length));
    } catch (eJ) { }
    // A round is always stamped, even a skip: a gap cannot be told from an engine that never ran.
    if (typeof engineRoundStamp_ === 'function') {
      engineRoundStamp_('runtime', {
        from: cursor, to: (cursor + window) % order.length, of: order.length,
        units: 0, wrote: 0, ms: 0,
        notes: 'skipped: another runner already covered this window'
      });
    }
    return 0;
  }
  var ordered = order.slice(cursor).concat(order.slice(0, cursor));

  var wrote = 0, judged = 0, skipped = 0, walked = 0, appended = [];
  // The time budget is the real bound against the six-minute limit; the count cap is a cruder second one.
  var deadline = Date.now() + ENGINE_BUDGET_MS;
  ordered.forEach(function (ctx) {
    if (judged >= RUNTIME_JUDGE_CAP) return;
    if (Date.now() > deadline) return;
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
      // A rule whose facts cannot be answered is skipped, never guessed.
      var names = flowRuleFacts_(c);
      for (var n = 0; n < names.length; n++) {
        if (!(names[n] in facts)) { skipped++; return; }
      }
      var st = flowConditionStatus_(c, facts);
      if (st === 'not_applicable') return;
      var seen = at[cid + '|' + ctx];
      if (seen) {
        if (seen.status === st) return;
        sheet.getRange(seen.row, iSt + 1).setValue(st);
        if (iAt !== -1 && st === 'satisfied') sheet.getRange(seen.row, iAt + 1).setValue(now);
        wrote++;
        return;
      }
      var line = [];
      for (var h = 0; h < hdr.length; h++) {
        var name = hdr[h];
        line.push(name === 'Condition Instance ID'
                    ? 'CI_RT_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16).toUpperCase()
                  : name === 'Condition ID' ? cid
                  : name === 'Subject ID' ? ctx
                  : name === 'Status' ? st
                  : name === 'Resolved At' ? (st === 'satisfied' ? now : '')
                  : name === 'Source' ? 'runtime-engine'
                  : '');
      }
      appended.push(line);
      wrote++;
    });
  });

  if (appended.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, appended.length, hdr.length).setValues(appended);
  }
  try {
    hubPropSet_('RUNTIME_JUDGE_CURSOR', String((cursor + walked) % order.length));
  } catch (eS) { }
  if (typeof engineRoundStamp_ === 'function') {
    engineRoundStamp_('runtime', {
      from: cursor, to: (cursor + walked) % order.length, of: order.length,
      units: walked, judged: judged, wrote: wrote, skipped: skipped,
      ms: Date.now() - (deadline - ENGINE_BUDGET_MS)
    });
  }
  if (wrote) {
    try {
      hubSysLog_('runtime-engine', 'runtime_conditions_judged',
                 wrote + ' verdict(s) across ' + judged + ' data book(s); ' +
                 skipped + ' rule(s) unanswerable by the clock');
    } catch (eL) { }
  }
  return wrote;
}

var RUNTIME_JUDGE_CAP = ENGINE_PASS_CAP;

HUB_POLICY.runtimeSweepNow = {
  lane: 'write', roles: ['admin', 'manager'], idempotent: true, cost: 'seconds',
  invalidates: [], emits: []
};
HUB_ACTIONS.runtimeSweepNow = function (payload, user) {
  if (!user) return hubDenied_();
  if (!user.is_service && ['admin', 'manager'].indexOf(String(user.role)) === -1) {
    return hubDenied_();
  }
  var wrote = runtimeConditionsSweepRun_();
  var reg = runtimeRegistry_();
  try {
    hubSysLog_(str_(user.email), 'runtime_sweep_now',
               wrote + ' verdict(s) over ' + Object.keys(reg).length + ' data book(s)',
               { status: 200 });
  } catch (e) { }
  return { status: 200, data: { wrote: wrote, books: Object.keys(reg).length } };
};
