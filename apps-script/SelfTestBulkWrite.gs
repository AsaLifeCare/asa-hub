function stbwInstall_(name, fn, policy) {
  HUB_ACTIONS[name] = fn;
  HUB_POLICY[name] = policy || { file: 'SelfTestBulkWrite.gs', lane: 'write', store: 'sheet',
                                 idempotent: true, cost: 'instant', roles: [], invalidates: [], emits: [] };
}
function stbwRemove_(name) {
  delete HUB_ACTIONS[name];
  delete HUB_POLICY[name];
}

function stBulkWrite_(out) {
  var user = { email: 'selftest@asa', role: 'admin', is_service: false };
  var seen, env, r;

  /* ---------- 1. N entries, N receipts, in order, each run once -------- */
  seen = [];
  stbwInstall_('stbwEcho', function (payload) {
    seen.push(String(payload && payload.mark));
    return { status: 200, data: { mark: payload.mark } };
  });
  env = HUB_ACTIONS.bulkWrite({ writes: [
    { write_id: 'stbw-A', action: 'stbwEcho', payload: { mark: 'a' } },
    { write_id: 'stbw-B', action: 'stbwEcho', payload: { mark: 'b' } },
    { write_id: 'stbw-C', action: 'stbwEcho', payload: { mark: 'c' } }
  ] }, user, 'tok');
  stAssert_(out, 'bulkWrite: three entries answer three receipts, in order',
            env.status === 200 && env.data.receipts.length === 3 &&
            env.data.receipts[0].write_id === 'stbw-A' &&
            env.data.receipts[2].write_id === 'stbw-C',
            'a receipt out of order is a receipt the caller cannot match to its write');
  stAssert_(out, 'bulkWrite: each entry ran exactly once, in the order sent',
            seen.join(',') === 'a,b,c',
            'ran: ' + seen.join(','));
  stAssert_(out, 'bulkWrite: the handler answer rides its own receipt',
            env.data.receipts[1].status === 200 && env.data.receipts[1].data.mark === 'b',
            'the caller must be able to read what each write returned');
  stAssert_(out, 'bulkWrite: ran counts the entries that executed',
            env.data.ran === 3 && env.data.deduplicated === 0 && env.data.truncated === false,
            JSON.stringify({ ran: env.data.ran, dedup: env.data.deduplicated }));

  /* ---------- 2. EXACTLY-ONCE: a seen write_id never runs again -------- */
  seen = [];
  env = HUB_ACTIONS.bulkWrite({ writes: [
    { write_id: 'stbw-A', action: 'stbwEcho', payload: { mark: 'a' } },
    { write_id: 'stbw-D', action: 'stbwEcho', payload: { mark: 'd' } }
  ] }, user, 'tok');
  stAssert_(out, 'bulkWrite: a re-sent batch re-runs ONLY what never landed',
            seen.join(',') === 'd',
            'ran again: ' + seen.join(',') + ' — a duplicated write is the whole reason receipts exist');
  stAssert_(out, 'bulkWrite: the replayed entry answers its RECORDED receipt',
            env.data.receipts[0].deduplicated === true &&
            env.data.receipts[0].status === 200 &&
            env.data.receipts[0].data.mark === 'a',
            'a dedup that answers nothing is indistinguishable from a lost write');
  stAssert_(out, 'bulkWrite: the receipt key is doPost\'s key, not a second one',
            CacheService.getScriptCache().get('wid_stbw-A') !== null,
            'if the keys differ, a single re-send after a batch re-executes the write');

  /* ---------- 3. one entry\'s failure costs the others nothing --------- */
  seen = [];
  stbwInstall_('stbwBoom', function () { throw new Error('deliberate'); });
  stbwInstall_('stbwRefuse', function () { return { status: 409, message: 'no' }; });
  env = HUB_ACTIONS.bulkWrite({ writes: [
    { write_id: 'stbw-E', action: 'stbwEcho', payload: { mark: 'e' } },
    { write_id: 'stbw-F', action: 'stbwBoom', payload: {} },
    { write_id: 'stbw-G', action: 'stbwRefuse', payload: {} },
    { write_id: 'stbw-H', action: 'stbwEcho', payload: { mark: 'h' } }
  ] }, user, 'tok');
  stAssert_(out, 'bulkWrite: an entry that THROWS answers 500 and stops nothing',
            env.data.receipts[1].status === 500 && seen.join(',') === 'e,h',
            'ran: ' + seen.join(',') + ' — one bad row must not cost the other twenty-four');
  stAssert_(out, 'bulkWrite: a validation refusal is that entry\'s own answer',
            env.data.receipts[2].status === 409 && env.data.receipts[3].status === 200,
            'the refusal must be findable per entry, not for the batch');
  stAssert_(out, 'bulkWrite: a 5xx is NOT written to the receipt cache',
            CacheService.getScriptCache().get('wid_stbw-F') === null,
            'remembering a failure as a receipt would refuse the retry that would have worked');

  /* ---------- 4. what may never ride a batch --------------------------- */
  r = bulkWriteOne_({ action: 'authLogout', payload: {} }, user, 'tok');
  stAssert_(out, 'bulkWrite: auth actions are refused',
            r.status === 400,
            'a token that changes underneath the batch makes every later entry position-dependent');
  // assert the message: the generic router also answers 400, so a status alone cannot tell the guards apart
  r = bulkWriteOne_({ action: 'list', resource: 'candidates', payload: {} }, user, 'tok');
  stAssert_(out, 'bulkWrite: a read is refused BY THE READ GUARD — this is a write door',
            r.status === 400 && String(r.message).indexOf('carries writes only') !== -1,
            'refused with: ' + String(r && r.message));
  r = bulkWriteOne_({ action: 'get', resource: 'candidates', payload: {} }, user, 'tok');
  stAssert_(out, 'bulkWrite: get is refused by the same guard',
            r.status === 400 && String(r.message).indexOf('carries writes only') !== -1,
            'refused with: ' + String(r && r.message));
  var readRan = false;
  stbwInstall_('stbwNamedRead', function () { readRan = true; return { status: 200, data: {} }; },
               { file: 'SelfTestBulkWrite.gs', lane: 'read', store: 'sheet', idempotent: true,
                 cost: 'instant', roles: [], invalidates: [], emits: [] });
  r = bulkWriteOne_({ action: 'stbwNamedRead', payload: {} }, user, 'tok');
  stAssert_(out, 'bulkWrite: a NAMED action declared lane:read is refused, and never runs',
            r.status === 400 && String(r.message).indexOf('carries writes only') !== -1 &&
            readRan === false,
            'status ' + r.status + ', ran=' + readRan +
            ' — a read hidden inside a batch is a read the counters cannot rank');
  stbwRemove_('stbwNamedRead');

  var toolRan = false;
  stbwInstall_('stbwNamedTool', function () { toolRan = true; return { status: 200, data: {} }; },
               { file: 'SelfTestBulkWrite.gs', lane: 'tool', store: 'sheet', idempotent: true,
                 cost: 'instant', roles: [], invalidates: [], emits: [] });
  r = bulkWriteOne_({ action: 'stbwNamedTool', payload: {} }, user, 'tok');
  stAssert_(out, 'bulkWrite: a lane:tool action still rides — tools write',
            r.status === 200 && toolRan === true,
            'refusing tools would exclude the maintenance jobs this door exists for');
  stbwRemove_('stbwNamedTool');

  r = bulkWriteOne_({ action: '', payload: {} }, user, 'tok');
  stAssert_(out, 'bulkWrite: an entry with no action is refused', r.status === 400, '');
  r = bulkWriteOne_({ action: 'stbwNotAThing', payload: {} }, user, 'tok');
  stAssert_(out, 'bulkWrite: an unknown action with no resource says so',
            r.status === 404, 'a silent skip would look like a landed write');
  r = bulkWriteOne_({ action: 'patch', resource: 'candidates', payload: {} }, user, 'tok');
  stAssert_(out, 'bulkWrite: the generic router takes create/update/delete only',
            r.status === 400, 'anything else is a verb this door does not carry');

  /* ---------- 5. the ceiling is honest --------------------------------- */
  var many = [], i;
  for (i = 0; i < BULK_WRITE_MAX + 5; i++) {
    many.push({ write_id: 'stbw-cap-' + i, action: 'stbwEcho', payload: { mark: i } });
  }
  seen = [];
  env = HUB_ACTIONS.bulkWrite({ writes: many }, user, 'tok');
  stAssert_(out, 'bulkWrite: the cap holds and SAYS it truncated',
            env.data.receipts.length === BULK_WRITE_MAX && env.data.truncated === true &&
            seen.length === BULK_WRITE_MAX,
            'a silent truncation is a batch whose tail nobody can account for');

  /* ---------- 6. the envelope itself ----------------------------------- */
  env = HUB_ACTIONS.bulkWrite({ writes: [] }, user, 'tok');
  stAssert_(out, 'bulkWrite: an empty list is a 400, not an empty success',
            env.status === 400, 'answering 200 to nothing hides a caller bug');
  env = HUB_ACTIONS.bulkWrite({ writes: 'not-a-list' }, user, 'tok');
  stAssert_(out, 'bulkWrite: a non-list is a 400', env.status === 400, '');
  env = HUB_ACTIONS.bulkWrite({ writes: [{ write_id: 'x', action: 'stbwEcho', payload: {} }] }, null, 'tok');
  stAssert_(out, 'bulkWrite: no user, no batch',
            env.status === 401 || env.status === 403,
            'the batch must never be a way to act without an identity');
  env = HUB_ACTIONS.bulkWrite({ writes: [
    { write_id: 'stbw-code', action: 'stbwEcho', payload: {} }] }, user, 'tok');
  stAssert_(out, 'bulkWrite: the answer names the engine that ran it',
            String(env.data.code || '') !== '',
            'a stale deployment is the one thing a batch would get wrong silently');

  stbwRemove_('stbwEcho'); stbwRemove_('stbwBoom'); stbwRemove_('stbwRefuse');

  // ---------- 7.
  stbwInstall_('stbwAway', function () { return { status: 200, data: { ran: true } }; });
  var heldCtx = (typeof HUB_TENANT_CTX !== 'undefined') ? HUB_TENANT_CTX : null;
  var awayRan = false;
  stbwInstall_('stbwAwayRan', function () { awayRan = true; return { status: 200, data: {} }; });
  HUB_TENANT_CTX = { tenantId: 'stbw_franchise' };
  r = bulkWriteOne_({ action: 'stbwAwayRan', payload: {} }, user, 'tok');
  HUB_TENANT_CTX = heldCtx;
  stAssert_(out, 'bulkWrite: away from home an undeclared action is Unknown, and never runs',
            r.status === 404 && String(r.message).indexOf('Unknown action') !== -1 && awayRan === false,
            'status ' + r.status + ', ran=' + awayRan +
            ' — a franchise must be told the action does not exist; naming it is itself the leak');
  stbwRemove_('stbwAway'); stbwRemove_('stbwAwayRan');

  var one = stCode_(bulkWriteOne_);
  stAssert_(out, 'bulkWrite: the away-from-home gate is asked BEFORE the policy gate',
            one.indexOf('hubAwayTenant_') !== -1 &&
            one.indexOf('hubPolicyGate_') !== -1 &&
            one.indexOf('hubAwayTenant_') < one.indexOf('hubPolicyGate_'),
            'order matters: a refusal that names the action leaks that it exists');
  stAssert_(out, 'bulkWrite: a visit still acts as the CALLER for own-actions',
            one.indexOf('hubCallerOwnAction_') !== -1 && one.indexOf('HUB_CALLER') !== -1,
            'a visit narrows what may be SEEN; it does not change who is asking');
  stAssert_(out, 'bulkWrite: every entry lands in the system log',
            one.indexOf('hubSysLog_') !== -1,
            'a batch must not be a way to write without a trail');
  stAssert_(out, 'bulkWrite: the generic branch calls route, never respond_',
            one.indexOf('route(') !== -1 && one.indexOf('respond_(') === -1,
            'respond_ answers a TextOutput; a receipt needs the envelope');

  /* ---------- 8. the audit rows are held, then released (the append itself cannot run here) */
  var began = hubLogDeferBegin_();
  stAssert_(out, 'audit deferral: begin holds', began === true && !!HUB_LOG_DEFER, '');
  hubSysLog_('selftest@asa', 'stbwEcho', 'target-1', { status: 200 });
  hubSysLog_('selftest@asa', 'stbwEcho', 'target-2', { status: 200 });
  stAssert_(out, 'audit deferral: the rows are HELD, not appended one by one',
            !!HUB_LOG_DEFER && HUB_LOG_DEFER.logs.length === 2,
            'held: ' + (HUB_LOG_DEFER ? HUB_LOG_DEFER.logs.length : 'nothing'));
  stAssert_(out, 'audit deferral: a held row has exactly the header\'s columns',
            HUB_LOG_DEFER.logs[0].length === LOGS_HEADER.length,
            'a row of the wrong width lands under the wrong headings forever');
  stAssert_(out, 'audit deferral: the row still says who, what and to what',
            String(HUB_LOG_DEFER.logs[0][1]) === 'selftest@asa' &&
            String(HUB_LOG_DEFER.logs[0][2]) === 'stbwEcho' &&
            String(HUB_LOG_DEFER.logs[1][3]) === 'target-2',
            'deferring must change WHEN a row is written, never WHAT it says');
  stAssert_(out, 'audit deferral: the immutable trail is held beside it',
            HUB_LOG_DEFER.events.length === 2 &&
            HUB_LOG_DEFER.events[0].length === EVENTS_HEADER.length,
            'two doors, one fact — holding only one of them splits the truth');
  hubLogDeferFlush_();
  stAssert_(out, 'audit deferral: the flush releases the hold',
            HUB_LOG_DEFER === null,
            'a buffer left standing swallows every log row after it, in silence');

  HUB_LOG_DEFER = { logs: [['stranded']], events: [] };
  hubLogDeferBegin_();
  stAssert_(out, 'audit deferral: a buffer stranded by a killed execution is replaced',
            !!HUB_LOG_DEFER && HUB_LOG_DEFER.logs.length === 0,
            'Apps Script reuses globals across warm starts — a leftover would eat the next request');
  hubLogDeferFlush_();

  stAssert_(out, 'audit deferral: outside a batch nothing is held',
            HUB_LOG_DEFER === null,
            'the single-write path must be byte-identical to what it always was');
  var syslog = stCode_(hubSysLog_);
  stAssert_(out, 'audit deferral: the log sheet is not even OPENED while holding',
            syslog.indexOf('HUB_LOG_DEFER ? null : logsSheet_()') !== -1,
            'logsSheet_ re-reads the header to heal it — that is a round trip per entry');
}
