// The resolver: every action declares HUB_POLICY.<action> beside its handler; an undeclared action is a defect.
// Policies stay pure literals: the build reads them statically to emit the manifest the relay obeys.

var RESOLVER_LANES = ['read', 'write', 'tool', 'auth'];

var RESOLVER_STORES = ['slice', 'json', 'table', 'sheet', 'drive', 'external'];

// `minutes` must never ride the eight-second lane; `instant` may be coalesced.
var RESOLVER_COSTS = ['instant', 'seconds', 'minutes'];

var RESOLVER_MODE_PROP = 'RESOLVER_MODE';
var RESOLVER_HEALTH_TAB = 'resolver_health';
var RESOLVER_ACTIONS_TAB = 'resolver_actions';

var RESOLVER_HEALTH_HEADER = [
  'at', 'mode', 'declared', 'undeclared', 'actions_total',
  'exec_reads', 'exec_writes', 'slice_reads', 'exec_share',
  'queue_pending', 'queue_oldest_s', 'queue_dead', 'stale_claims',
  'duplicates', 'note'
];

var RESOLVER_ACTIONS_HEADER = [
  'action', 'file', 'lane', 'store', 'idempotent', 'cost',
  'roles', 'invalidates', 'emits', 'declared'
];

// 'audit' counts undeclared actions and refuses nothing; 'strict' refuses them with a 501.
function resolverMode_() {
  try {
    var m = String(hubProp_(RESOLVER_MODE_PROP) || '').toLowerCase();
    return m === 'strict' ? 'strict' : 'audit';
  } catch (e) { return 'audit'; }
}

// The single reader of a policy: gate, audit, manifest and settings all come through here.
function hubPolicyFor_(action) {
  var p = HUB_POLICY[String(action || '')];
  return p || null;
}

function resolverAllActions_() {
  var out = [];
  for (var k in HUB_ACTIONS) {
    if (HUB_ACTIONS.hasOwnProperty(k) && typeof HUB_ACTIONS[k] === 'function') out.push(k);
  }
  return out.sort();
}

// The door, not the room: roles and required params only; every handler keeps its own rules.
function hubPolicyGate_(action, payload, user) {
  // Acting as another account (BeAnother.gs): Be Back always passes, and the person's credentials and the switches are refused.
  if (typeof beAnotherPolicyGate_ === 'function') {
    var acting = beAnotherPolicyGate_(action);
    if (acting === 'pass') return null;
    if (acting) return acting;
  }
  // A book's Actions tab Status can close a door before the declaration is read.
  if (typeof hiringDoorRefusal_ === 'function') {
    var byBook = hiringDoorRefusal_(action, user);
    if (byBook) return byBook;
  }
  var pol = hubPolicyFor_(action);
  if (!pol) {
    if (resolverMode_() !== 'strict') return null;
    return { status: 501, message: 'Action "' + action + '" has no declared ' +
      'policy. It cannot be routed safely — declare HUB_POLICY.' + action + '.' };
  }
  // Empty roles = any signed-in session. A granted `perm` is a second way in, never a narrowing.
  var roles = pol.roles || [];
  var granted = !!(pol.perm && user && user.overrides &&
                   user.overrides[pol.perm] === true);
  if (roles.length && user && !user.is_service && !granted) {
    if (roles.indexOf(String(user.role)) === -1) {
      return { status: 403, message: 'This action is for ' + roles.join(' or ') +
               (pol.perm ? ', or anyone granted "' + pol.perm + '" in Settings → Access control' : '') + '.' };
    }
  }
  var params = pol.params || {};
  for (var key in params) {
    if (!params.hasOwnProperty(key)) continue;
    var rule = params[key] || {};
    var val = payload ? payload[key] : undefined;
    var missing = (val === undefined || val === null || val === '');
    if (rule.required && missing) {
      return { status: 400, message: 'Missing required parameter: ' + key + '.' };
    }
    if (!missing && rule.type) {
      var actual = Array.isArray(val) ? 'array' : typeof val;
      if (actual !== rule.type) {
        return { status: 400, message: key + ' must be ' + rule.type + ', got ' + actual + '.' };
      }
    }
  }
  return null;
}

function resolverAudit_() {
  var all = resolverAllActions_();
  var undeclared = [];
  var byLane = {};
  for (var i = 0; i < all.length; i++) {
    var pol = hubPolicyFor_(all[i]);
    if (!pol) { undeclared.push(all[i]); continue; }
    var lane = String(pol.lane || '?');
    byLane[lane] = (byLane[lane] || 0) + 1;
  }
  var invalid = [];
  for (var k in HUB_POLICY) {
    if (!HUB_POLICY.hasOwnProperty(k)) continue;
    var p = HUB_POLICY[k];
    if (RESOLVER_LANES.indexOf(String(p.lane)) === -1) invalid.push(k + ': lane=' + p.lane);
    else if (p.store && RESOLVER_STORES.indexOf(String(p.store)) === -1) invalid.push(k + ': store=' + p.store);
    else if (p.cost && RESOLVER_COSTS.indexOf(String(p.cost)) === -1) invalid.push(k + ': cost=' + p.cost);
    if (all.indexOf(k) === -1) invalid.push(k + ': declared but no handler');
  }
  return {
    mode: resolverMode_(),
    actions_total: all.length,
    declared: all.length - undeclared.length,
    undeclared_count: undeclared.length,
    undeclared: undeclared,
    invalid: invalid,
    by_lane: byLane
  };
}

function resolverManifest_() {
  var all = resolverAllActions_();
  var actions = {};
  for (var i = 0; i < all.length; i++) {
    var pol = hubPolicyFor_(all[i]);
    if (!pol) continue;
    actions[all[i]] = {
      lane: pol.lane,
      store: pol.store || '',
      idempotent: pol.idempotent === true,
      cost: pol.cost || 'seconds',
      roles: pol.roles || [],
      invalidates: pol.invalidates || [],
      emits: pol.emits || []
    };
  }
  return { version: 1, emitted_at: new Date().toISOString(),
           mode: resolverMode_(), actions: actions,
           stages: (typeof HUB_STAGE_POLICY !== 'undefined') ? HUB_STAGE_POLICY : {} };
}

// Report tabs: nothing at runtime reads them back, so editing a cell changes nothing.
function resolverTab_(name, header) {
  var ss = ssOpen_(hubId_('HUB_LOGS_ID'));
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  var width = Math.max(1, sheet.getLastColumn());
  var hdr = sheet.getRange(1, 1, 1, width).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  if (!hdr[0]) {
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  // Widen the grid before writing a new column: setValues() past the last column throws.
  var missing = header.filter(function (h) { return hdr.indexOf(h) === -1; });
  if (missing.length) {
    if (sheet.getMaxColumns() < hdr.length + missing.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(),
        hdr.length + missing.length - sheet.getMaxColumns());
    }
    sheet.getRange(1, hdr.length + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function resolverHealthWrite_(metrics) {
  metrics = metrics || {};
  try {
    var audit = resolverAudit_();
    var sheet = resolverTab_(RESOLVER_HEALTH_TAB, RESOLVER_HEALTH_HEADER);
    var num = function (v) { return (v === undefined || v === null || v === '') ? '' : Number(v); };
    sheet.appendRow([
      new Date().toISOString(),
      audit.mode,
      audit.declared,
      audit.undeclared_count,
      audit.actions_total,
      num(metrics.exec_reads), num(metrics.exec_writes), num(metrics.slice_reads),
      num(metrics.exec_share),
      num(metrics.queue_pending), num(metrics.queue_oldest_s), num(metrics.queue_dead),
      num(metrics.stale_claims), num(metrics.duplicates),
      String(metrics.note || '').slice(0, 300)
    ]);
    return { ok: true, undeclared: audit.undeclared_count };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function resolverActionsWrite_() {
  var all = resolverAllActions_();
  var rows = [];
  for (var i = 0; i < all.length; i++) {
    var a = all[i];
    var pol = hubPolicyFor_(a);
    rows.push([
      a,
      pol && pol.file ? pol.file : '',
      pol ? String(pol.lane || '') : '',
      pol ? String(pol.store || '') : '',
      pol ? (pol.idempotent === true ? 'yes' : 'no') : '',
      pol ? String(pol.cost || '') : '',
      pol && pol.roles ? pol.roles.join(', ') : '',
      pol && pol.invalidates ? pol.invalidates.join(', ') : '',
      pol && pol.emits ? pol.emits.join(', ') : '',
      pol ? 'yes' : 'NO'
    ]);
  }
  var sheet = resolverTab_(RESOLVER_ACTIONS_TAB, RESOLVER_ACTIONS_HEADER);
  var last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).clearContent();
  if (rows.length) {
    if (sheet.getMaxRows() < rows.length + 1) {
      sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 1 - sheet.getMaxRows());
    }
    if (sheet.getMaxColumns() < RESOLVER_ACTIONS_HEADER.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(),
        RESOLVER_ACTIONS_HEADER.length - sheet.getMaxColumns());
    }
    sheet.getRange(2, 1, rows.length, RESOLVER_ACTIONS_HEADER.length).setValues(rows);
  }
  return { rows: rows.length };
}

/** The resolver's audit: how many actions are declared, which are not, which declarations are invalid, and the count per lane. */
HUB_POLICY.resolverAudit = {
  file: 'Resolver.gs', lane: 'read', store: 'json', idempotent: true,
  cost: 'instant', roles: ['admin'], invalidates: [], emits: []
};
HUB_ACTIONS.resolverAudit = function (payload, user) {
  if (!user || (String(user.role) !== 'admin' && !user.is_service)) return hubDenied_();
  return { status: 200, data: resolverAudit_() };
};

HUB_POLICY.resolverManifest = {
  file: 'Resolver.gs', lane: 'read', store: 'json', idempotent: true,
  cost: 'instant', roles: ['admin'], invalidates: [], emits: []
};
HUB_ACTIONS.resolverManifest = function (payload, user) {
  if (!user || (String(user.role) !== 'admin' && !user.is_service)) return hubDenied_();
  return { status: 200, data: resolverManifest_() };
};

/** The relay posts what it measured; this appends one health row per rebuild. */
HUB_POLICY.resolverHealth = {
  file: 'Resolver.gs', lane: 'write', store: 'sheet', idempotent: true,
  cost: 'seconds', roles: ['admin'], invalidates: [], emits: []
};
HUB_ACTIONS.resolverHealth = function (payload, user) {
  if (!user || (String(user.role) !== 'admin' && !user.is_service)) return hubDenied_();
  var health = resolverHealthWrite_(payload || {});
  var inventory = null;
  if (payload && (payload.refresh_inventory === true || String(payload.refresh_inventory) === 'true')) {
    inventory = resolverActionsWrite_();
  }
  return { status: 200, data: { health: health, inventory: inventory } };
};

// --- Editor entry points ---

function runResolverAudit() {
  var out = resolverAudit_();
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

function runResolverPublish() {
  var inventory = resolverActionsWrite_();
  var health = resolverHealthWrite_({ note: 'published from the editor' });
  var out = { inventory: inventory, health: health, audit: resolverAudit_() };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

function runResolverStrict() {
  var audit = resolverAudit_();
  if (audit.undeclared_count > 0 || audit.invalid.length) {
    var out = { armed: false, why: 'still ' + audit.undeclared_count + ' undeclared and ' +
                audit.invalid.length + ' invalid', undeclared: audit.undeclared, invalid: audit.invalid };
    Logger.log(JSON.stringify(out, null, 2));
    return out;
  }
  hubPropSet_(RESOLVER_MODE_PROP, 'strict');
  Logger.log('resolver: strict');
  return { armed: true, actions: audit.actions_total };
}

function runResolverAudit_Off() {
  hubPropSet_(RESOLVER_MODE_PROP, 'audit');
  return { armed: false, mode: 'audit' };
}
