// execution ceiling, not payload: 25 row writes plus their gates fit the six-minute limit
var BULK_WRITE_MAX = 25;

HUB_POLICY.bulkWrite = {
  file: 'BulkWrite.gs', lane: 'write', store: 'sheet', idempotent: true,
  cost: 'seconds', roles: [], invalidates: [], emits: []
};

// One token per batch: HUB_WORLD_CTX and HUB_TENANT_CTX are per-execution, so mixing places would cross-write.
HUB_ACTIONS.bulkWrite = function (payload, user, token) {
  var writes = (payload && payload.writes) || [];
  if (!Array.isArray(writes) || !writes.length) {
    return { status: 400, message: 'writes: a list of {write_id, resource, action, payload} is required.' };
  }
  if (!user) return hubDenied_();
  var wanted = writes.slice(0, BULK_WRITE_MAX);
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (eC) { cache = null; }

  // one audit append for the whole batch, not two spreadsheet appends per entry
  var deferred = false;
  try { deferred = hubLogDeferBegin_(); } catch (eD) { deferred = false; }

  var receipts = [], ran = 0, deduped = 0;
  try {
    for (var i = 0; i < wanted.length; i++) {
      var w = wanted[i] || {};
      var wid = str_(w.write_id);
      // the receipt answers before anything runs: a re-sent batch re-runs only what never landed
      if (wid && cache) {
        var seen = null;
        try { seen = cache.get('wid_' + wid); } catch (eG) { seen = null; }
        if (seen) {
          var prior = null;
          try { prior = JSON.parse(seen); } catch (eP) { prior = { status: 200, data: { accepted: true, deduplicated: true } }; }
          receipts.push({ write_id: wid, status: Number(prior.status) || 200,
                          data: prior.data, message: prior.message || '',
                          deduplicated: true });
          deduped++;
          continue;
        }
      }
      HUB_WRITE_ID = wid;
      var env;
      try { env = bulkWriteOne_(w, user, token); } finally { HUB_WRITE_ID = ''; }
      ran++;
      if (wid && cache && env && Number(env.status) < 500) {
        try { cache.put('wid_' + wid, JSON.stringify(env).slice(0, 90000), 21600); }
        catch (eW) {}
      }
      receipts.push({ write_id: wid, status: Number(env && env.status) || 500,
                      data: env && env.data, message: (env && env.message) || '' });
    }
  } finally {
    if (deferred) { try { hubLogDeferFlush_(); } catch (eF) {} }
  }

  return {
    status: 200,
    data: {
      receipts: receipts,
      ran: ran,
      deduplicated: deduped,
      truncated: writes.length > wanted.length,
      // a batch is the call a stale deployment would answer wrongly and silently
      code: (typeof HUB_CODE_BUILD !== 'undefined') ? String(HUB_CODE_BUILD) : '',
      ran_at: new Date().toISOString()
    }
  };
};

/** Never throws. Gate order is doPost's: the away-from-home 404 precedes the policy gate, since naming a refused action leaks it. */
function bulkWriteOne_(entry, user, token) {
  var action = str_(entry && entry.action);
  var resource = str_(entry && entry.resource);
  var payload = (entry && entry.payload) || {};
  if (!action) return { status: 400, message: 'action is required.' };

  // auth would change the batch's own token under the remaining entries
  if (action.indexOf('auth') === 0) {
    return { status: 400, message: 'Auth actions cannot be batched.' };
  }
  // reads are refused by their declared lane; undeclared actions pass because the resolver only audits them
  var declared = (typeof HUB_POLICY !== 'undefined' && HUB_POLICY[action]) || null;
  // a document's bytes and its reading answer their caller alone, never under a batch's receipt
  if (action === 'list' || action === 'get' || action === 'certDocFile' || action === 'certDocRead' ||
      (declared && String(declared.lane) === 'read')) {
    return { status: 400, message: 'bulkWrite carries writes only.' };
  }

  if (HUB_ACTIONS[action]) {
    if (hubAwayTenant_() && !tenantActionAllowed_(action)) {
      return { status: 404, message: 'Unknown action.' };
    }
    // a visit narrows what may be seen; it does not change who is asking
    var actor = user;
    try {
      if (HUB_MEMBER_CTX && HUB_CALLER && hubCallerOwnAction_(action)) actor = HUB_CALLER;
    } catch (eA) { actor = user; }
    var gate = null;
    try { gate = hubPolicyGate_(action, payload, actor); }
    catch (eGate) { gate = null; }   // the door must never be the outage
    if (gate) {
      hubSysLog_(user.email, action, str_(payload.candidate_id || payload.id || ''), gate);
      return gate;
    }
    var env;
    try {
      env = HUB_ACTIONS[action](payload, actor, token);
    } catch (err) {
      env = { status: 500, message: 'Internal error: ' + (err && err.message ? err.message : String(err)) };
    }
    hubSysLog_(user.email, action,
      str_(payload.candidate_id || payload.id || payload.tab || ''), env);
    return env;
  }

  if (!resource) {
    return { status: 404, message: 'Unknown action: "' + action + '". ' +
             'If this action is new, the Apps Script may not have been published yet.' };
  }
  if (['create', 'update', 'delete'].indexOf(action) === -1) {
    return { status: 400, message: 'bulkWrite carries create, update and delete.' };
  }
  var out;
  try {
    out = route(resource, action, payload, user);
  } catch (err) {
    out = { status: 500, message: 'Internal error: ' + (err && err.message ? err.message : String(err)) };
  }
  hubSysLog_(user.email, resource + '.' + action, str_(payload.id), null);
  return out;
}
