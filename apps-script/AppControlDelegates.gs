// SETTINGS > APP CONTROL ACCESS — App Control shared with a person, app by app.
// The master names an account, the exact apps that account sees inside App Control, and whether it may change them…
var MYWORK_AC_DELEGATES_KEY = 'mywork_appcontrol_delegates';

/** App Control is shared with employees: the roles a delegation answers for. */
var AC_DELEGATE_ROLES = ['admin', 'manager', 'staff'];

/** How many accounts one list may hold. */
var AC_DELEGATE_MAX = 100;

/** An app list as a delegation keeps it: each id once, never a control id, never a master-only app. */
function hubAcDelegateApps_(list) {
  var out = [];
  (Array.isArray(list) ? list : []).forEach(function (a) {
    var id = String(a == null ? '' : a).trim().slice(0, 80);
    if (!id || id.indexOf('.') !== -1 || appIsMasterOnly_(id) || out.indexOf(id) !== -1) return;
    out.push(id);
  });
  return out.slice(0, 200);
}

// FAIL-CLOSED: the stored list as [{ id, apps, may_change }], each account once; a cell that is blank, malformed or…
function hubAcDelegatesParse_(raw) {
  var text = String(raw == null ? '' : raw).trim();
  if (!text) return [];
  var list;
  try { list = JSON.parse(text); } catch (e) { return []; }
  if (!Array.isArray(list)) return [];
  var out = [], seen = {};
  list.slice(0, AC_DELEGATE_MAX).forEach(function (d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;
    var id = String(d.id == null ? '' : d.id).trim().slice(0, 80);
    if (!id || seen['k:' + id]) return;
    seen['k:' + id] = true;
    out.push({ id: id, apps: hubAcDelegateApps_(d.apps), may_change: d.may_change === true });
  });
  return out;
}

/** FAIL-CLOSED: the list as the config tab holds it; a tab that cannot be read delegates nothing. */
function hubAcDelegatesRead_() {
  var cfg;
  try { cfg = hiringAlerts_() || {}; } catch (e) { return []; }
  return hubAcDelegatesParse_(cfg[MYWORK_AC_DELEGATES_KEY]);
}

/** The app a matrix row belongs to: the row id itself, or what stands before the dot of a control's id. */
function hubAcRuleApp_(ruleId) {
  var s = String(ruleId == null ? '' : ruleId).trim();
  var dot = s.indexOf('.');
  return dot > 0 ? s.slice(0, dot) : s;
}

// FAIL-CLOSED: the delegation this session holds, { apps, may_change }, or null.
function hubAcDelegateFor_(user) {
  try {
    if (!user || user.is_service === true || user.visiting_member) return null;
    if (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX) return null;
    if (appAccessMayEdit_(user) || hubIsMaster_(String(user.email || ''))) return null;
    if (AC_DELEGATE_ROLES.indexOf(String(user.role || '').trim().toLowerCase()) === -1) return null;
    var id = String(user.id || '').trim();
    if (!id) return null;
    var all = hubAcDelegatesRead_();
    for (var i = 0; i < all.length; i++) {
      if (all[i].id !== id) continue;
      return all[i].apps.length ? { apps: all[i].apps.slice(), may_change: all[i].may_change === true } : null;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// FAIL-CLOSED: a delegation answers at home alone — never inside a world, never from a place away from home (the…
function hubAcDelegateAtHome_() {
  try {
    if (typeof HUB_WORLD_CTX !== 'undefined' && HUB_WORLD_CTX) return false;
    if (typeof hubAwayTenant_ === 'function' && hubAwayTenant_()) return false;
    return true;
  } catch (e) {
    return false;
  }
}

/** Does this delegation reach this matrix row (an app on its list, or a control inside one)? */
function hubAcDelegateCovers_(grant, ruleId) {
  if (!grant || !Array.isArray(grant.apps)) return false;
  var app = hubAcRuleApp_(ruleId);
  return !!app && !appIsMasterOnly_(app) && grant.apps.indexOf(app) !== -1;
}

/** The delegation as the session's own auth answer carries it (authMe, authLogin `app_control`); null without one. */
function hubAcDelegatePublic_(user) {
  var g = hubAcDelegateFor_(user);
  return g ? { apps: g.apps.slice(), may_change: g.may_change } : null;
}

/** The accounts whose May change is on: the relay lets their App Control writes through to the doors, which decide. */
function hubAcDelegateWritersRead_() {
  return hubAcDelegatesRead_()
    .filter(function (d) { return d.may_change && d.apps.length; })
    .map(function (d) { return d.id; });
}

// The role check App Control's write doors used to declare (roles: ['admin']), asked inside them now so an account…
function hubAcAdminDoor_(user) {
  if (!user || user.is_service) return null;
  if (String(user.role || '') === 'admin') return null;
  if (hubAcDelegateFor_(user)) return null;
  return { status: 403, message: 'This action is for admin.' };
}

// Why this session may not write these matrix rows, as the answer to send; null when it may, as a delegate.
function hubAcDelegateWriteRefusal_(user, ruleIds) {
  var g = hubAcDelegateAtHome_() ? hubAcDelegateFor_(user) : null;
  if (!g) return { status: 404, message: 'Unknown action.' };
  if (!g.may_change) {
    return { status: 403, message: 'App Control is shared with you to view. Changing it is the master\'s to allow. ' +
             'Nothing was saved.' };
  }
  var ids = Array.isArray(ruleIds) ? ruleIds : [];
  var outside = ids.filter(function (id) { return !hubAcDelegateCovers_(g, id); })
    .map(function (id) { return String(id == null ? '' : id).slice(0, 80) || '(no app named)'; });
  if (!ids.length || outside.length) {
    return { status: 403, message: 'Outside the apps the master shared with you: ' +
             (outside.join(', ') || 'no app named') + '. Nothing was saved.' };
  }
  return null;
}

// A delegate's bulk Apply: badge rows of its own apps and nothing else.
function hubAcDelegateBulkRefusal_(payload, user) {
  var g = hubAcDelegateAtHome_() ? hubAcDelegateFor_(user) : null;
  if (!g) return { status: 404, message: 'Unknown action.' };
  var lane = function (name) {
    var v = payload && payload[name];
    return (v && typeof v === 'object') ? Object.keys(v) : [];
  };
  if (g.may_change && (lane('tenants').length || lane('sections').length)) {
    return { status: 403, message: 'Which places an app belongs to and who reaches a settings section are the ' +
             'master\'s alone. Nothing was saved.' };
  }
  return hubAcDelegateWriteRefusal_(user, lane('rules'));
}

// The words a delegate's write hands the release letter (ReleaseUsers.gs appReleaseAutoAnnounce_): an app's name…
function hubAcDelegateMetaOne_(meta) {
  var m = (meta && typeof meta === 'object' && !Array.isArray(meta)) ? meta : {};
  var plain = function (v, n) { return str_(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, n).trim(); };
  return { name: plain(m.name, 80), tagline: plain(m.tagline, 160) };
}

/** A bulk Apply's app_meta as a delegate may hand it on: its own apps alone, each through hubAcDelegateMetaOne_. */
function hubAcDelegateMeta_(grant, map) {
  var out = {};
  if (!map || typeof map !== 'object' || Array.isArray(map)) return out;
  // the payload's own keys may shadow hasOwnProperty: asked of the prototype, so this never throws
  for (var k in map) {
    if (Object.prototype.hasOwnProperty.call(map, k) && hubAcDelegateCovers_(grant, k)) {
      out[k] = hubAcDelegateMetaOne_(map[k]);
    }
  }
  return out;
}

/** A copy of a bulk echo holding only the rows this delegation reaches. */
function hubAcDelegateEcho_(grant, map) {
  var out = {};
  if (!map || typeof map !== 'object') return out;
  for (var k in map) {
    if (map.hasOwnProperty(k) && hubAcDelegateCovers_(grant, k)) out[k] = map[k];
  }
  return out;
}

/** The master's own read of the list, for Settings > App Control access. Everybody else gets the unadvertised 404. */
HUB_POLICY.appControlDelegatesGet = {
  file: 'AppControlDelegates.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.appControlDelegatesGet = function (payload, user) {
  if (!appAccessMayEdit_(user)) return { status: 404, message: 'Unknown action.' };
  var cfg;
  try { cfg = hiringAlerts_() || {}; } catch (e) {
    // never answered as "nobody": a list saved over one nobody read would replace it
    return { status: 503, message: 'The platform config could not be read, so the list is not shown. Try again.' };
  }
  var raw = String(cfg[MYWORK_AC_DELEGATES_KEY] == null ? '' : cfg[MYWORK_AC_DELEGATES_KEY]).trim();
  var list = hubAcDelegatesParse_(raw);
  var malformed = false;
  if (raw) {
    try { malformed = !Array.isArray(JSON.parse(raw)); } catch (eP) { malformed = true; }
  }
  return { status: 200, data: { delegates: list, malformed: malformed } };
};

// The master saves the whole list.
HUB_POLICY.appControlDelegatesSet = {
  file: 'AppControlDelegates.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  params: { delegates: { required: true, type: 'array' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.appControlDelegatesSet = function (payload, user) {
  if (!appAccessMayEdit_(user)) return { status: 404, message: 'Unknown action.' };
  var sent = payload && payload.delegates;
  if (!Array.isArray(sent)) return { status: 400, message: 'delegates: the whole list, one entry per person.' };
  if (sent.length > AC_DELEGATE_MAX) {
    return { status: 400, message: 'At most ' + AC_DELEGATE_MAX + ' people may be on the list.' };
  }
  var byId = {};
  usersAll_().forEach(function (u) {
    var uid = str_(u.userid);
    if (uid) byId['k:' + uid] = u;
  });
  var out = [], seen = {};
  for (var i = 0; i < sent.length; i++) {
    var d = (sent[i] && typeof sent[i] === 'object') ? sent[i] : {};
    var id = str_(d.id).slice(0, 80);
    if (!id) return { status: 400, message: 'Every entry names an account. Nothing was saved.' };
    if (seen['k:' + id]) return { status: 400, message: 'The same account is on the list twice. Nothing was saved.' };
    seen['k:' + id] = true;
    var row = byId['k:' + id];
    if (!row) return { status: 400, message: 'No account "' + id + '". Nothing was saved.' };
    var name = str_(row.displayname) || str_(row.email) || id;
    if (hubIsMaster_(str_(row.email))) {
      return { status: 400, message: 'The master account holds App Control whole; it is never put on this list. ' +
               'Nothing was saved.' };
    }
    var role = (str_(row.role) || 'staff').toLowerCase();
    if (AC_DELEGATE_ROLES.indexOf(role) === -1) {
      return { status: 400, message: 'App Control is shared with employees only (admin, manager or staff); ' + name +
               ' is ' + role + '. Nothing was saved.' };
    }
    var rawApps = Array.isArray(d.apps) ? d.apps : [];
    for (var a = 0; a < rawApps.length; a++) {
      var aid = str_(rawApps[a]);
      if (appIsMasterOnly_(aid)) {
        return { status: 400, message: 'App Control itself is the master\'s alone and is never shared. Nothing was saved.' };
      }
      if (aid.indexOf('.') !== -1) {
        return { status: 400, message: 'An app is shared whole, never one control of it (' + aid.slice(0, 80) +
                 '). Nothing was saved.' };
      }
    }
    var apps = hubAcDelegateApps_(rawApps);
    if (!apps.length) {
      return { status: 400, message: 'Choose at least one app for ' + name + ', or take them off the list. ' +
               'Nothing was saved.' };
    }
    out.push({ id: id, apps: apps, may_change: d.may_change === true });
  }
  var values = {};
  values[MYWORK_AC_DELEGATES_KEY] = out.length ? JSON.stringify(out) : '';
  var saved = HUB_ACTIONS.hiringAlertsSet({ values: values }, user);
  if (!saved || saved.status !== 200) return saved || { status: 500, message: 'The config door gave no answer.' };
  try {
    hubSysLog_(str_(user.email), 'app_control_access_set', out.length + ' account(s) on the list', { status: 200 });
  } catch (eG) {}
  return { status: 200, data: { delegates: out } };
};

// A delegate's own read, for App Control: its list, May change, and each listed app's rows of the badge matrix (the…
HUB_POLICY.appControlDelegateGet = {
  file: 'AppControlDelegates.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.appControlDelegateGet = function (payload, user) {
  var grant = hubAcDelegateAtHome_() ? hubAcDelegateFor_(user) : null;
  if (!grant) return { status: 404, message: 'Unknown action.' };
  var all = (hubProfileAppRules_() || {}).rules || {};
  var rules = {};
  for (var rid in all) {
    if (!all.hasOwnProperty(rid) || !hubAcDelegateCovers_(grant, rid)) continue;
    rules[rid] = Array.isArray(all[rid]) ? all[rid].slice() : [];
  }
  return { status: 200, data: { apps: grant.apps.slice(), may_change: grant.may_change, rules: rules } };
};
