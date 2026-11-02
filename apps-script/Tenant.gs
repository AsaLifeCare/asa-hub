// Tenant context, the second isolation axis.
// No tenant on the envelope behaves exactly as before (headquarters).

var USER_TENANT_COLUMNS = ['home_tenant', 'tenants'];

// On the platform workbook, never re-pointed.
var TENANTS_TAB = 'tenants';

function tenantIdsForUser_(u) {
  var out = [];
  var home = str_(u.hometenant);
  if (home) out.push(home);
  var extra = str_(u.tenants);
  if (extra) {
    extra.split(',').forEach(function (t) {
      t = String(t || '').trim();
      if (t && out.indexOf(t) === -1) out.push(t);
    });
  }
  return out;
}

// Read once per execution.
var HUB_TENANT_ROWS = null;

function tenantsRows_() {
  if (HUB_TENANT_ROWS) return HUB_TENANT_ROWS;
  try {
    HUB_TENANT_ROWS = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TENANTS_TAB);
  } catch (e) {
    // FAIL-CLOSED: an unreadable directory narrows (the master loses reach elsewhere), it never widens.
    HUB_TENANT_ROWS = [];
  }
  return HUB_TENANT_ROWS;
}

function tenantActiveIdsFrom_(rows) {
  return (rows || [])
    .filter(function (t) { return str_(t.status) !== 'archived'; })
    .map(function (t) { return str_(t.tenantid); })
    .filter(function (id) { return !!id; });
}

function tenantAllIds_() { return tenantActiveIdsFrom_(tenantsRows_()); }

// The row typed 'hq', adopted not invented; every blank tenant cell belongs to it.
function tenantHomeFrom_(rows) {
  rows = rows || [];
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].type) === 'hq' && str_(rows[i].status) !== 'archived') {
      return str_(rows[i].tenantid);
    }
  }
  return rows.length ? str_(rows[0].tenantid) : '';
}

function tenantHomeId_() { return tenantHomeFrom_(tenantsRows_()); }

// The place is derived from the account, never declared by the browser: no envelope tenant means home_tenant.
function tenantResolve_(rows, rawTenant, who) {
  var deny = { error: { status: 404, message: 'Not found.' } };
  if (!who) return null;

  var home = tenantHomeFrom_(rows);
  var isMaster = who.is_master === true;

  var allowed = isMaster ? tenantActiveIdsFrom_(rows) : tenantIdsForUser_(who);

  var wanted = str_(rawTenant);
  if (!wanted) wanted = isMaster ? '' : str_(who.hometenant);

  // Headquarters is the absent case only for an account that belongs to it.
  if (!wanted || (home && wanted === home)) {
    if (isMaster || !allowed.length) return null;
    return allowed.indexOf(home) !== -1 ? null : deny;
  }
  if (allowed.indexOf(wanted) === -1) return deny;
  return { tenantId: wanted };
}

// null at headquarters; {error} with 404 (not 403) where the caller may not stand, so probes cannot enumerate.
function tenantContext_(rawTenant, user) {
  // A service identity stands nowhere: a tenant on its envelope would silently narrow a slice.
  if (!user || user.is_service) return null;

  var wanted = str_(rawTenant);
  var mine = str_(user.home_tenant);
  if (!wanted && !mine) return null;

  // Membership comes from the session's server-derived public user (Auth.gs userPublic_), never client input.
  return tenantResolve_(tenantsRows_(), wanted, {
    id: str_(user.id),
    email: str_(user.email),
    is_master: user.is_master === true,
    hometenant: mine,
    tenants: (user.tenants || []).join ? (user.tenants || []).join(',') : str_(user.tenants)
  });
}

function hubTenantId_() {
  if (typeof HUB_TENANT_CTX !== 'undefined' && HUB_TENANT_CTX) {
    return String(HUB_TENANT_CTX.tenantId || '');
  }
  return '';
}

function hubAwayTenant_() {
  return !!hubTenantId_();
}

// A blank tenant cell means headquarters, which keeps every place filter additive.
function tenantRowVisible_(rowTenant) {
  var here = hubTenantId_();
  var owner = str_(rowTenant);
  if (!here) return true;
  return owner === here;
}

// The master is present in every place: a franchise starts with the one account that can build it.
function tenantUserVisible_(u) {
  if (!hubAwayTenant_()) return true;
  try { if (hubIsMaster_(str_(u && u.email))) return true; } catch (e) {}
  return tenantIdsForUser_(u || {}).indexOf(hubTenantId_()) !== -1;
}

// One predicate for tenantContext_, tenantsList and userUpdate; null = everywhere.
function tenantReachIds_(user) {
  if (user && user.is_master === true) return null;
  // Admins see the whole directory: blank membership would otherwise hide the very chip that grants it.
  if (user && String(user.role) === 'admin') return null;
  var out = [];
  var home = tenantHomeId_();
  if (home) out.push(home);
  var listed = tenantIdsForUser_({
    hometenant: str_(user && user.home_tenant),
    tenants: (user && user.tenants && user.tenants.join)
      ? user.tenants.join(',') : str_(user && user.tenants)
  });
  for (var i = 0; i < listed.length; i++) {
    if (out.indexOf(listed[i]) === -1) out.push(listed[i]);
  }
  return out;
}

// Unknown ids and places the caller cannot reach are refused (either would lock a person out); blank is always allowed.
function tenantPlaceableGate_(wantedIds, user) {
  var reach = tenantReachIds_(user);
  var active = tenantActiveIdsFrom_(tenantsRows_());
  for (var i = 0; i < wantedIds.length; i++) {
    var id = str_(wantedIds[i]);
    if (!id) continue;
    if (active.indexOf(id) === -1) {
      return { status: 400, message: 'There is no active place with the id "' + id + '".' };
    }
    if (reach && reach.indexOf(id) === -1) {
      return { status: 403, message: 'You cannot place somebody where you cannot stand yourself.' };
    }
  }
  return null;
}

// The one lookup for doors taking an arbitrary user_id; 404, never 403, so existence elsewhere is not confirmed.
function tenantUserRow_(uid) {
  var id = str_(uid);
  var missing = { error: { status: 404, message: 'No user "' + id + '".' } };
  if (!id) return missing;
  var all = usersAll_();
  for (var i = 0; i < all.length; i++) {
    if (str_(all[i].userid) !== id) continue;
    return tenantUserVisible_(all[i]) ? { row: all[i] } : missing;
  }
  return missing;
}

// Default deny away from home: a named action runs there only if listed (it narrows by place, or holds no company…
var HUB_TENANT_SAFE_ACTIONS = [
  'authLogin', 'authLogout', 'authMe', 'authStatus',
  'placeProfileGet', 'profileUpdate', 'userProfileDeep',
  'prefsGet', 'prefsSet', 'appBadgeAccessGet', 'appAccessSetBulk', 'appShelfGet', 'appShelfSet',
  'userMenuLinksList', 'clientViewsPolicy', 'hiringViewsPolicy',
  'potClientsViewsPolicy', 'appsBuilt',
  'tenantsList', 'tenantEnsure', 'worldGet', 'worldEnsure', 'worldAppsList', 'worldAppUpsert',
  'worldAppDelete',
  'platformMembersList', 'platformMemberRemove',
  'myWorldAccessList', 'myWorldAccessSet',
  'platformMemberMine', 'platformMemberLeave',
  'hubBoot',
  'platformMemberCheck', 'platformMemberAsk', 'platformMemberAuthorize', 'platformMemberSweep',
  'invitesList', 'inviteSend', 'inviteRevoke',
  'playgroundGenerate', 'appBuilderUpsert', 'appUpsert', 'appDelete',
  'usersList', 'chatOverview', 'chatMessages', 'chatSend', 'chatPing',
  'chatMarkRead', 'chatReact',
  'logsList', 'companyCalendar',
  'userCreate', 'userUpdate',
  'selfTest',
  // Be Back ends an acting session wherever its target stands (BeAnother.gs); starting stays at home
  'beAnotherStop'
];

// These adapters answer above the place filter from headquarters' external workbooks: away from home they 404.
var HUB_PLACE_ADAPTERS = {
  candidates: "headquarters' hiring pipeline — one talent spreadsheet, and a candidate belongs to the company that is hiring",
  directors:  "the company's own Directory spreadsheet, appended to by directorsRoute_",
  onboarding: 'the same hiring pipeline, with the stage derived from the paperwork',
  certMatrix: "derived at read time from the estate's employee tracker",
  staffCerts: "derived at read time from the estate's employee tracker"
};

function hubAdapterPlaceGate_(resource) {
  if (!hubAwayTenant_()) return null;
  var r = String(resource || '');
  var claimed = HUB_PLACE_ADAPTERS.hasOwnProperty(r);
  if (!claimed && typeof ESTATE_SOURCES !== 'undefined' && ESTATE_SOURCES[r]) {
    // The estate's read-write mirrors: the estate stays the single writer of its own workbook.
    claimed = true;
  }
  if (!claimed) return null;
  return { status: 404, message: 'Unknown resource: "' + r + '".' };
}

// check-places.mjs: a fail-open catch in any of these must carry a FAIL-OPEN or FAIL-CLOSED marker and its reason.
var HUB_FAIL_CLOSED = [
  'hubMasterEmail_', 'tenantsRows_', 'membersRows_', 'usersAll_',
  'tenantIdsForUser_', 'tenantUserVisible_', 'tenantRowVisible_',
  'tenantResolve_', 'tenantContext_', 'memberResolve_', 'memberContext_',
  'worldResolve_', 'worldContext_', 'worldRowFor_', 'tenantUserRow_',
  'hubPlaceGate_', 'hubAdapterPlaceGate_', 'tenantActionAllowed_',
  'ACTION:chatOverview', 'ACTION:usersList', 'ACTION:platformMembersList'
];

// Allowed away while narrowing nothing, each with its reason; check-places.mjs fails any allowlisted action that neither narrows nor appears here.
var HUB_PLACE_EXEMPT = {
  placeProfileGet: 'the caller\'s own per-place profile row, keyed by their user id — the place is the KEY here, not a filter',
  profileUpdate: 'a person\'s own account row, found by their session id: the record is theirs in every place they stand',
  hubBoot: 'a courier, not a reader: it calls prefsGet, appBadgeAccessGet, tenantsList and platformMembersList and returns what they answered, so the place is narrowed four times by the four handlers that own that decision — narrowing it a fifth time here would be a second opinion about a question already settled',
  platformMemberMine: 'the caller\'s own membership rows, found by their user id — which platforms may open THEIR work is a fact about the account, not about the company face they happen to be looking at',
  platformMemberLeave: 'the caller ending their OWN link, found by their user id and refused with a 404 on every other row — narrowing it by place would make the way off somebody\'s platform unreachable from a franchise, which is the one place a person might most want it',
  prefsGet: 'one person\'s own preferences, keyed by their user id — never global, never anybody else\'s',
  prefsSet: 'one person\'s own preferences, keyed by their user id — the write targets the caller and nobody else',
  appShelfGet: 'the sidebar\'s own shape — sections and placement, configuration with no company rows in it',
  appShelfSet: 'the same shelf, and MASTER-ONLY: one account, derived from HUB_MASTER_EMAIL and never from a cell',
  appAccessSetBulk: 'MASTER-ONLY, and the per-tenant matrix it writes IS how a place is given an app — narrowing it by place would lock every place out of its own settings',
  playgroundGenerate: 'drafts an app spec from a sentence and writes nothing; the publish that follows is appBuilderUpsert, which is stamped',
  platformMemberRemove: 'retires a row the caller owns — the handler refuses any row whose owner_user_id is not the session\'s',
  platformMemberAuthorize: 'records an answer on a row the caller owns — same refusal on owner_user_id',
  platformMemberSweep: 'reads replies for the caller\'s OWN pending rows; only the machine\'s pass sweeps the platform',
  myWorldAccessList: 'the rows where the caller IS the member — their own world, found by their own user id',
  myWorldAccessSet: 'the caller\'s answer about their OWN world; the row is matched on their user id, so it cannot reach anybody else',
  appBadgeAccessGet: 'the badge matrix is platform configuration, not company rows; the tenant matrix that narrows an app is read beside it',
  userMenuLinksList: 'the shell\'s own menu, configuration with no company rows in it',
  clientViewsPolicy: 'a VIEW definition — which columns a screen shows; the rows behind it are narrowed by the resource read that follows',
  hiringViewsPolicy: 'a VIEW definition — which columns a screen shows; the rows behind it are narrowed by the resource read that follows',
  potClientsViewsPolicy: 'a VIEW definition — which columns a screen shows; the rows behind it are narrowed by the resource read that follows',
  chatMessages: 'a thread key is built from the CALLER\'s id, so only their own conversations answer; who may be written to is narrowed in chatOverview and chatSend',
  chatPing: 'counts messages addressed to the caller\'s own id and nobody else\'s',
  chatMarkRead: 'marks messages addressed to the caller\'s own id as read — it can only touch their own inbox',
  chatReact: 'reacts on a message the caller sent or received; the row is matched on their own id',
  selfTest: 'asserts the code against itself and reads no company rows',
  beAnotherStop: 'ends only the acting session the request comes from (BeAnother.gs) and reads no company rows — Be Back must answer wherever the worn account stands'
};

function tenantActionAllowed_(action) {
  return HUB_TENANT_SAFE_ACTIONS.indexOf(String(action || '')) !== -1;
}

// The tenant column is never client input: stripped on create/update (at home too), stamped from the context away.
function hubPlaceGate_(resource, action, payload) {
  // Acting as another account (BeAnother.gs): route()'s one door for every generic verb refuses their signatures.
  if (typeof beAnotherResourceGate_ === 'function') {
    var acting = beAnotherResourceGate_(resource, action);
    if (acting) return acting;
  }
  // route()'s one door for every generic write: the roster's cells are identity, so they are the writers' (Auth.gs)
  var roster = hubRosterWriteGate_(resource, action);
  if (roster) return roster;
  // and every generic verb on the MAR error books: the Medications desk's audience (Auth.gs)
  var mar = hubMarErrorsGate_(resource, action);
  if (mar) return mar;
  if (!payload) return null;
  if (action === 'create' || action === 'update') {
    try { delete payload.tenant; } catch (eDel) {}
    // a card's workbook is written by sheetBoardCreate alone, never through the generic verbs
    if (resource === 'sheetTasks') {
      try { delete payload.spreadsheet_id; delete payload.spreadsheet_url; delete payload.spreadsheet_name; }
      catch (eSb) {}
    }
  }
  if (!hubAwayTenant_()) return null;

  if (action === 'create') {
    payload.tenant = tenantStamp_();
    return null;
  }
  if (action === 'update' || action === 'delete') {
    // Writes obey the read boundary: another place's row is a 404.
    var id = str_(payload.id);
    if (!id) return null;
    var row = requireRow_(resource, id);
    if (!row.error && !tenantRowVisible_(row.tenant)) {
      return { status: 404, message: 'No "' + resource + '" record with id "' + id + '".' };
    }
    if (action === 'update') payload.tenant = tenantStamp_();
  }
  return null;
}

function tenantStamp_() {
  return hubTenantId_();
}

// --- The workbook of a place ---

var TENANT_FOLDER_NAME = 'Tenant Workbooks';

/** Give a place its own workbook, born empty; the spreadsheet id is a credential and never reaches the SPA. */
HUB_POLICY.tenantEnsure = {
  file: 'Tenant.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.tenantEnsure = function (payload, user) {
  // Master only, 404 not 403: it changes where every screen in the place reads from.
  if (!user || user.is_service) return { status: 404, message: 'Unknown action.' };
  var isMaster = false;
  try { isMaster = hubIsMaster_(str_(user.email)); } catch (eM) { isMaster = false; }
  if (!isMaster) return { status: 404, message: 'Unknown action.' };

  var id = str_(payload && payload.tenant_id) || hubTenantId_();
  if (!id) return { status: 400, message: 'tenant_id: which place.' };
  var home = tenantHomeId_();
  if (home && id === home) {
    return { status: 400, message: 'Headquarters already has the company workbook — it IS the company workbook.' };
  }

  var rows = tenantsRows_(), row = null;
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].tenantid) === id) { row = rows[i]; break; }
  }
  if (!row) return { status: 404, message: 'Not found.' };
  if (str_(row.status) === 'archived') {
    return { status: 409, message: 'That place is archived — restore it before giving it a workbook.' };
  }
  // Idempotent, and never answers with the id itself.
  if (str_(row.spreadsheetid)) {
    return { status: 200, data: { tenant_id: id, created: false } };
  }

  // Drive work stays outside the lock: this is the platform's single lock.
  var name = 'ASA Place — ' + (str_(row.name) || id);
  var ss;
  try {
    ss = SpreadsheetApp.create(name);
  } catch (eCreate) {
    return { status: 503, message: 'The workbook could not be created right now — try again in a moment.' };
  }
  try {
    DriveApp.getFileById(ss.getId())
      .moveTo(filesChildByName_(filesRoot_(), TENANT_FOLDER_NAME));
  } catch (eMove) {}

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    worldDiscard_(ss.getId());
    return { status: 409, message: 'Another change is in progress — try again in a few seconds.' };
  }
  try {
    // Re-read under the lock, past the memo, so the loser of a race finds the winner's id.
    HUB_TENANT_ROWS = null;
    var fresh = tenantsRows_(), already = '';
    for (var f = 0; f < fresh.length; f++) {
      if (str_(fresh[f].tenantid) === id) { already = str_(fresh[f].spreadsheetid); break; }
    }
    if (already) {
      worldDiscard_(ss.getId());
      return { status: 200, data: { tenant_id: id, created: false } };
    }
    var sheet = ssOpen_(hubId_('HUB_DB_ID')).getSheetByName(TENANTS_TAB);
    if (!sheet) { worldDiscard_(ss.getId()); return { status: 500, message: 'The tenants tab is missing.' }; }
    var header = ensureHeader_(sheet, TENANT_HEADERS);
    var values = sheet.getDataRange().getValues();
    var hdr = values[0].map(normKey_);
    var iId = hdr.indexOf('tenantid'), iSid = hdr.indexOf('spreadsheetid');
    if (iSid === -1) { worldDiscard_(ss.getId()); return { status: 500, message: 'The spreadsheet_id column could not be created.' }; }
    for (var r = 1; r < values.length; r++) {
      if (str_(values[r][iId]) !== id) continue;
      sheet.getRange(r + 1, iSid + 1).setValue(ss.getId());
      HUB_TENANT_ROWS = null;
      cacheBump_(TENANTS_TAB);
      hubSysLog_(user.email, 'tenantEnsure', id, { status: 200 });
      return { status: 200, data: { tenant_id: id, created: true } };
    }
    worldDiscard_(ss.getId());
    return { status: 404, message: 'Not found.' };
  } finally {
    lock.releaseLock();
  }
};
