/** localStorage is only the cache; user_prefs is the truth, capped at 20KB — prefs, never data. */

var PREFS_TAB = 'user_prefs';
var PREFS_MAX_BYTES = 20000;
// WHEN THIS PERSON WAS LAST RELEASED — written into their blob by a release (ReleaseUsers.gs) and owned by the…
var PREFS_RELEASED_KEY = 'asa-released-at';

/** Not the tab router: this tab lives in the preferences workbook, and routing it would open an empty one in HUB_DB. */
function prefsSheet_() {
  var ss = ssOpen_(hubId_('HUB_PREFS_ID'));
  var sheet = ss.getSheetByName(PREFS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(PREFS_TAB);
    sheet.getRange(1, 1, 1, 3).setValues([['user_id', 'prefs', 'updated_at']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

var DOC_COLLECTIONS_TAB = 'document_collections';
var DOC_COLLECTIONS_HEADER = ['id', 'label', 'icon', 'tint', 'sort', 'created_at', 'created_by'];

function docCollectionsSheet_() {
  var sheet = hubTabEnsure_(DOC_COLLECTIONS_TAB, DOC_COLLECTIONS_HEADER);
  ensureHeader_(sheet, DOC_COLLECTIONS_HEADER);
  return sheet;
}

HUB_POLICY.collectionsList = {
  file: 'Prefs.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.collectionsList = function () {
  docCollectionsSheet_();
  var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), DOC_COLLECTIONS_TAB);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!str_(rows[i].id)) continue;
    out.push({ id: str_(rows[i].id), label: str_(rows[i].label) || str_(rows[i].id),
               icon: str_(rows[i].icon) || 'folder', tint: str_(rows[i].tint) || 'blue',
               sort: Number(rows[i].sort) || 99 });
  }
  out.sort(function (a, b) { return a.sort - b.sort; });
  return { status: 200, data: { collections: out } };
};

HUB_POLICY.collectionCreate = {
  file: 'Prefs.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['documents'], emits: []
};
HUB_ACTIONS.collectionCreate = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var label = str_(payload.label);
  if (!label) return { status: 400, message: 'A name is required' };
  var id = str_(payload.id) || label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!id) return { status: 400, message: 'That name has no letters or digits to build an id from' };
  docCollectionsSheet_();
  var existing = HUB_ACTIONS.collectionsList().data.collections;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].id === id) return { status: 409, message: 'A collection called "' + existing[i].label + '" already exists.' };
  }
  hubAppendRow_(DOC_COLLECTIONS_TAB, {
    id: id, label: label, icon: str_(payload.icon) || 'folder',
    tint: str_(payload.tint) || 'blue', sort: Number(payload.sort) || (existing.length + 10),
    created_at: new Date().toISOString(), created_by: 'asa-hub:' + user.email
  });
  return { status: 200, data: { collection: { id: id, label: label,
           icon: str_(payload.icon) || 'folder', tint: str_(payload.tint) || 'blue' } } };
};

/* DOCUMENT FEEDBACK — append-only, one row per vote; a re-vote appends again and the reader shows the latest */
var DOC_FEEDBACK_TAB = 'doc_feedback';
var DOC_FEEDBACK_HEADER = ['feedback_id', 'item_kind', 'doc_id', 'doc_title', 'collection', 'vote',
                           'user_email', 'user_name', 'user_role', 'created_at'];

function docFeedbackSheet_() {
  var sheet = hubTabEnsure_(DOC_FEEDBACK_TAB, DOC_FEEDBACK_HEADER);
  ensureHeader_(sheet, DOC_FEEDBACK_HEADER);
  return sheet;
}

HUB_POLICY.docFeedback = {
  file: 'Prefs.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: [],
  invalidates: ['documents', 'videos'], emits: []
};
HUB_ACTIONS.docFeedback = function (payload, user) {
  var docId = str_(payload.doc_id);
  var vote = str_(payload.vote).toLowerCase();
  if (!docId) return { status: 400, message: 'doc_id is required' };
  if (vote !== 'up' && vote !== 'down') return { status: 400, message: 'vote must be "up" or "down"' };
  docFeedbackSheet_();
  hubAppendRow_(DOC_FEEDBACK_TAB, {
    feedback_id: 'FBK_' + randomHex_(14).toUpperCase(),
    item_kind: str_(payload.kind) || 'doc',
    doc_id: docId,
    doc_title: str_(payload.doc_title),
    collection: str_(payload.collection),
    vote: vote,
    user_email: user ? str_(user.email) : '',
    user_name: user ? str_(user.display_name || user.name) : '',
    user_role: user ? str_(user.role) : '',
    created_at: new Date().toISOString()
  });
  return { status: 200, data: docFeedbackTally_(docId) };
};

function docFeedbackTally_(docId) {
  var rows = readTabNormalized_(hubTabWorkbook_(DOC_FEEDBACK_TAB), DOC_FEEDBACK_TAB);
  var up = 0, down = 0;
  for (var i = 0; i < rows.length; i++) {
    if (docId && str_(rows[i].docid) !== docId) continue;
    if (str_(rows[i].vote) === 'up') up++; else if (str_(rows[i].vote) === 'down') down++;
  }
  return { doc_id: docId || '', up: up, down: down, total: up + down };
}

/** Every vote, newest first — the admin view ("who, when, which way"). */
HUB_POLICY.docFeedbackList = {
  file: 'Prefs.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.docFeedbackList = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  docFeedbackSheet_();
  var rows = readTabNormalized_(hubTabWorkbook_(DOC_FEEDBACK_TAB), DOC_FEEDBACK_TAB);
  var docId = str_(payload && payload.doc_id);
  var out = [];
  for (var i = rows.length - 1; i >= 0; i--) {
    if (docId && str_(rows[i].docid) !== docId) continue;
    out.push({
      item_kind: str_(rows[i].itemkind) || 'doc',
      doc_id: str_(rows[i].docid), doc_title: str_(rows[i].doctitle),
      collection: str_(rows[i].collection), vote: str_(rows[i].vote),
      user_email: str_(rows[i].useremail), user_name: str_(rows[i].username),
      user_role: str_(rows[i].userrole), created_at: str_(rows[i].createdat),
      when: hubWhenLabel_(str_(rows[i].createdat))
    });
  }
  return { status: 200, data: { votes: out, tally: docFeedbackTally_(docId) } };
};

HUB_POLICY.prefsGet = {
  file: 'Prefs.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.prefsGet = function (payload, user) {
  var sheet = prefsSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { status: 200, data: { prefs: null } };
  var hdr = values[0].map(normKey_);
  var iU = hdr.indexOf('userid'), iP = hdr.indexOf('prefs');
  for (var r = values.length - 1; r >= 1; r--) {
    if (str_(values[r][iU]) === user.id) {
      var raw = str_(values[r][iP]);
      try {
        return { status: 200, data: { prefs: raw ? JSON.parse(raw) : null } };
      } catch (err) {
        return { status: 200, data: { prefs: null } };
      }
    }
  }
  return { status: 200, data: { prefs: null } };
};

HUB_POLICY.prefsSet = {
  file: 'Prefs.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.prefsSet = function (payload, user) {
  var prefs = payload && payload.prefs;
  if (!prefs || typeof prefs !== 'object') {
    return { status: 400, message: 'prefs object required' };
  }
  var raw = JSON.stringify(prefs);
  if (raw.length > PREFS_MAX_BYTES) {
    return { status: 413, message: 'prefs blob over 20KB — preferences only, never data.' };
  }
  var sheet = prefsSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iU = hdr.indexOf('userid'), iP = hdr.indexOf('prefs'), iT = hdr.indexOf('updatedat');
  // THE LAST ROW IS THE PERSON'S — one rule for reading, writing and clearing.
  for (var r = values.length - 1; r >= 1; r--) {
    if (str_(values[r][iU]) === user.id) {
      raw = prefsKeepReleased_(prefs, values[r][iP]);
      sheet.getRange(r + 1, iP + 1).setValue(raw);
      sheet.getRange(r + 1, iT + 1).setValue(new Date().toISOString());
      return { status: 200, data: { ok: true } };
    }
  }
  sheet.appendRow([user.id, raw, new Date().toISOString()]);
  return { status: 200, data: { ok: true } };
};

// The pushed blob as it is stored, with the release stamp the server owns put back: the browser never carries…
function prefsKeepReleased_(pushed, storedRaw) {
  var out = {};
  for (var k in pushed) if (Object.prototype.hasOwnProperty.call(pushed, k)) out[k] = pushed[k];
  var had = '';
  try {
    var stored = JSON.parse(str_(storedRaw) || '{}');
    had = (stored && typeof stored === 'object') ? str_(stored[PREFS_RELEASED_KEY]) : '';
  } catch (e) { had = ''; }
  var mine = str_(out[PREFS_RELEASED_KEY]);
  if (had && (!mine || had > mine)) out[PREFS_RELEASED_KEY] = had;
  return JSON.stringify(out);
}

/* USER MENU LINKS — server-held: the master writes the whole list, everyone reads, each link carries its badges */

var USER_MENU_LINKS_TAB = 'user_menu_links';
var USER_MENU_LINKS_HEADER = ['id', 'label', 'icon', 'href', 'external', 'badges',
                              'sort', 'updated_at', 'updated_by'];

function userMenuLinksSheet_() {
  var sheet = hubTabEnsure_(USER_MENU_LINKS_TAB, USER_MENU_LINKS_HEADER);
  ensureHeader_(sheet, USER_MENU_LINKS_HEADER);
  return sheet;
}

HUB_POLICY.userMenuLinksList = {
  file: 'Prefs.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.userMenuLinksList = function (payload, user) {
  if (!user) return hubDenied_();
  userMenuLinksSheet_();
  // read through the router like the writer, or a routed tab would serve the old workbook's menu
  var rows = readTabNormalized_(hubTabWorkbook_(USER_MENU_LINKS_TAB), USER_MENU_LINKS_TAB);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!str_(rows[i].id)) continue;
    out.push({ id: str_(rows[i].id), label: str_(rows[i].label),
               icon: str_(rows[i].icon) || 'link', href: str_(rows[i].href),
               external: str_(rows[i].external).toLowerCase() === 'true',
               badges: userTypesFromRaw_(rows[i].badges).types,
               sort: Number(rows[i].sort) || 99,
               updated_at: str_(rows[i].updatedat), updated_by: str_(rows[i].updatedby) });
  }
  out.sort(function (a, b) { return a.sort - b.sort; });
  return { status: 200, data: { links: out } };
};

// the master's pen alone, 404-shaped for everyone else; what arrives replaces the whole list
HUB_POLICY.userMenuLinksSet = {
  file: 'Prefs.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.userMenuLinksSet = function (payload, user) {
  if (!user || !hubIsMaster_(str_(user.email))) {
    return { status: 404, message: 'Unknown action.' };
  }
  var links = Array.isArray(payload && payload.links) ? payload.links : null;
  if (!links) return { status: 400, message: 'links: the whole list, in order.' };
  if (links.length > 40) return { status: 400, message: 'A menu longer than 40 links is a page, not a menu.' };
  var now = new Date().toISOString();
  var lines = [];
  for (var i = 0; i < links.length; i++) {
    var l = links[i] || {};
    var label = str_(l.label).slice(0, 80);
    var href = str_(l.href).slice(0, 500);
    var external = l.external === true || str_(l.external).toLowerCase() === 'true';
    if (!label || !href) return { status: 400, message: 'Every link needs a label and a destination.' };
    if (external && !/^https?:\/\//i.test(href)) {
      return { status: 400, message: '"' + label + '": an external link must start with http(s)://.' };
    }
    if (!external && href.charAt(0) !== '/') {
      return { status: 400, message: '"' + label + '": an in-app destination must start with /.' };
    }
    lines.push([
      str_(l.id) || ('um_' + randomHex_(8)),
      label, str_(l.icon).slice(0, 40) || 'link', href,
      external ? 'true' : 'false',
      userTypesFromRaw_(l.badges).types.join(', '),   // empty = every badge
      String(i + 1), now, str_(user.email)
    ]);
  }
  var sheet = userMenuLinksSheet_();
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (eL) {
    return { status: 503, message: 'Another update is in progress — try again.' };
  }
  try {
    var last = sheet.getLastRow();
    if (last > 1) sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).clearContent();
    if (lines.length) {
      sheet.getRange(2, 1, lines.length, USER_MENU_LINKS_HEADER.length).setValues(lines);
    }
  } finally {
    lock.releaseLock();
  }
  try {
    hubSysLog_(str_(user.email), 'user_menu_links_set',
               lines.length + ' link(s) — the whole company menu, stamped ' + now, { status: 200 });
  } catch (eG) {}
  return { status: 200, data: { saved: lines.length, updated_at: now } };
};

/* APP ACCESS BY BADGE — the master's matrix, one row per app that has a rule */

var APP_BADGE_TAB = 'app_badge_access';
var APP_BADGE_HEADER = ['app_id', 'badges', 'updated_at', 'updated_by'];

function appBadgeSheet_() {
  var sheet = hubTabEnsure_(APP_BADGE_TAB, APP_BADGE_HEADER);
  ensureHeader_(sheet, APP_BADGE_HEADER);
  return sheet;
}

/** Seeded once ever (a script property is the guard); a standing rule is never touched again. */
function appAccessSeedDictated_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('APP_ACCESS_SEED_2026_08_26')) return;
  var sheet = appBadgeSheet_();
  var have = {};
  try {
    // the workbook the seed writes, or the once-guard misses a rule standing elsewhere
    readTabNormalized_(hubTabWorkbook_(APP_BADGE_TAB), APP_BADGE_TAB).forEach(function (r) {
      if (str_(r.appid)) have[str_(r.appid)] = true;
    });
  } catch (eR) { return; }
  var wanted = [
    { app: 'interviews', badge: 'INTERVIEWER',
      meta: { name: 'Interviews', tagline: 'The interviewer’s desk — score and comments per candidate' } },
    { app: 'onboarding', badge: 'ONBOARDING',
      meta: { name: 'Onboarding', tagline: 'The new hire’s six steps — packet, tutorials, questionnaire' } }
  ];
  var now = new Date().toISOString();
  var added = {}, metas = {};
  wanted.forEach(function (w) {
    if (have[w.app]) return;
    try {
      sheet.appendRow([w.app, w.badge, now, 'asa-hub:dictated-seed']);
      added[w.app] = [w.badge];
      metas[w.app] = w.meta;
      hubSysLog_('asa-hub:dictated-seed', 'app_badge_access_set',
                 w.app + ' → ' + w.badge, { status: 200 });
    } catch (eW) {}
  });
  try { props.setProperty('APP_ACCESS_SEED_2026_08_26', now); } catch (eP) { return; }
  // The release announcement is Python's (app/app_release.py).
}

/** Family → CLIENT on by default, since the matrix default-denies it; seeded once like the rows above. */
function appAccessSeedFamily_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('APP_ACCESS_SEED_FAMILY_2026_09_08')) return;
  var sheet = appBadgeSheet_();
  var have = false;
  try {
    readTabNormalized_(hubTabWorkbook_(APP_BADGE_TAB), APP_BADGE_TAB).forEach(function (r) {
      if (str_(r.appid) === 'family') have = true;
    });
  } catch (eR) { return; }
  if (have) {
    try { props.setProperty('APP_ACCESS_SEED_FAMILY_2026_09_08', new Date().toISOString()); } catch (eP2) {}
    return;
  }
  var now = new Date().toISOString();
  var added = {}, metas = {};
  try {
    sheet.appendRow(['family', 'CLIENT', now, 'asa-hub:dictated-seed']);
    added['family'] = ['CLIENT'];
    metas['family'] = { name: 'Family Portal', tagline: 'Your family member’s care, in plain words' };
    hubSysLog_('asa-hub:dictated-seed', 'app_badge_access_set',
               'family → CLIENT', { status: 200 });
  } catch (eW) { return; }
  try { props.setProperty('APP_ACCESS_SEED_FAMILY_2026_09_08', now); } catch (eP) { return; }
  // The release announcement is Python's (app/app_release.py).
}

/** Position 5.5 seats the simulator between talent-pipeline (5) and onboarding (6); seeded once. */
function appPlacementSeedDictated_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('APP_PLACEMENT_SEED_2026_08_26')) return;
  var hasRow = false, hasSection = false;
  try {
    readTabNormalized_(hubTabWorkbook_(APP_PLACEMENT_TAB), APP_PLACEMENT_TAB).forEach(function (r) {
      if (str_(r.appid) === 'simulator') hasRow = true;
      if (str_(r.sectionid) === 'custom-staff-mt1rqmb8') hasSection = true;
    });
  } catch (eR) { return; }
  if (!hasRow && hasSection) {
    try {
      var sheet = appShelfSheet_(APP_PLACEMENT_TAB, APP_PLACEMENT_HEADER);
      sheet.appendRow(['simulator', 'custom-staff-mt1rqmb8', 5.5,
                       new Date().toISOString(), 'asa-hub:dictated-seed']);
      hubSysLog_('asa-hub:dictated-seed', 'app_placement_set',
                 'simulator → STAFF, right under talent-pipeline', { status: 200 });
    } catch (eW) { return; }
  }
  try { props.setProperty('APP_PLACEMENT_SEED_2026_08_26', new Date().toISOString()); } catch (eP) {}
}

HUB_POLICY.appBadgeAccessGet = {
  file: 'Prefs.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.appBadgeAccessGet = function (payload, user) {
  if (!user) return hubDenied_();
  appBadgeSheet_();
  configBadgeSheet_();
  appTenantSheet_();
  var ss = ssOpen_(hubId_('HUB_DB_ID'));
  var rows = readTabNormalized_(ss, APP_BADGE_TAB);
  var out = {};
  for (var i = 0; i < rows.length; i++) {
    var id = str_(rows[i].appid);
    if (!id) continue;
    out[id] = userTypesFromRaw_(rows[i].badges).types;
  }
  // the other matrices ride the same execution: the cost is executions, not rows
  var cfgRows = readTabNormalized_(ss, CONFIG_BADGE_TAB);
  var cfg = {};
  for (var c = 0; c < cfgRows.length; c++) {
    var sid = str_(cfgRows[c].sectionid);
    if (!sid) continue;
    cfg[sid] = userTypesFromRaw_(cfgRows[c].badges).types;
  }
  var tenRows = readTabNormalized_(ss, APP_TENANT_TAB);
  var ten = {};
  for (var t = 0; t < tenRows.length; t++) {
    var aid = str_(tenRows[t].appid);
    if (!aid) continue;
    ten[aid] = str_(tenRows[t].tenants).split(',')
      .map(function (x) { return x.trim(); })
      .filter(String);
  }
  var cut = hubMyWorkAppsCutFor_(user);
  return { status: 200, data: { rules: hubMyWorkAppsCut_(out, cut), configRules: cfg,
                                tenantRules: hubMyWorkAppsCut_(ten, cut) } };
};

/* APP ACCESS BY TENANT — no row means every tenant; the one matrix that narrows the master, since it describes a place */

var APP_TENANT_TAB = 'app_tenant_access';
var APP_TENANT_HEADER = ['app_id', 'tenants', 'updated_at', 'updated_by'];

function appTenantSheet_() {
  var sheet = hubTabEnsure_(APP_TENANT_TAB, APP_TENANT_HEADER);
  ensureHeader_(sheet, APP_TENANT_HEADER);
  return sheet;
}

HUB_POLICY.appTenantAccessSet = {
  file: 'Prefs.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  params: { app_id: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.appTenantAccessSet = function (payload, user) {
  if (!appAccessMayEdit_(user)) {
    return { status: 404, message: 'Unknown action.' };
  }
  var appId = str_(payload.app_id).slice(0, 80);
  if (!appId) return { status: 400, message: 'app_id: which app.' };
  var list = Array.isArray(payload.tenants) ? payload.tenants : [];
  var tenants = [], seen = {};
  for (var i = 0; i < list.length; i++) {
    var id = str_(list[i]).slice(0, 80);
    if (!id || seen[id]) continue;
    seen[id] = true;
    tenants.push(id);
  }
  if (tenants.length && appIsMasterOnly_(appId)) {
    return { status: 400, message: 'This app is the master\'s alone in every place — it takes no tenant rule.' };
  }
  var sheet = appTenantSheet_();
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (eL) {
    return { status: 503, message: 'Another update is in progress — try again.' };
  }
  try {
    var values = sheet.getDataRange().getValues();
    var hdr = values[0].map(normKey_);
    var iId = hdr.indexOf('appid');
    var rowNum = 0;
    for (var r = 1; r < values.length; r++) {
      if (str_(values[r][iId]) === appId) { rowNum = r + 1; break; }
    }
    var now = new Date().toISOString();
    if (!tenants.length) {
      if (rowNum) sheet.deleteRow(rowNum);          // back to every tenant
    } else if (rowNum) {
      sheet.getRange(rowNum, 1, 1, APP_TENANT_HEADER.length)
           .setValues([[appId, tenants.join(', '), now, str_(user.email)]]);
    } else {
      sheet.appendRow([appId, tenants.join(', '), now, str_(user.email)]);
    }
    // the profile apps' gate reads these rows through the cache (ViewerScope.gs hubProfileAppRules_)
    cacheBump_(APP_TENANT_TAB);
  } finally {
    lock.releaseLock();
  }
  try {
    hubSysLog_(str_(user.email), 'app_tenant_access_set',
               appId + ' → ' + (tenants.length ? tenants.join(', ') : 'every tenant'),
               { status: 200 });
  } catch (eG) {}
  return { status: 200, data: { app_id: appId, tenants: tenants } };
};

// ====================================================================== * CONFIG ACCESS BY BADGE — beside app…

var CONFIG_BADGE_TAB = 'config_badge_access';
var CONFIG_BADGE_HEADER = ['section_id', 'badges', 'updated_at', 'updated_by'];

function configBadgeSheet_() {
  var sheet = hubTabEnsure_(CONFIG_BADGE_TAB, CONFIG_BADGE_HEADER);
  ensureHeader_(sheet, CONFIG_BADGE_HEADER);
  return sheet;
}

// WHO MAY WRITE THE SETTINGS-SECTIONS MATRIX — a reader who may edit nothing only SEES, and the ACCESS BADGE MATRIX…
function accessMatrixMayEdit_(user) {
  if (!user || user.is_service) return false;
  if (user.visiting_member || (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX)) return false;
  if (str_(user.role) !== 'admin') return false;
  if (hubIsMaster_(str_(user.email))) return true;
  // badges + role + what a worn badge currently stands in for (Profile.gs HUB_BADGE_FOLLOWS) — the 'access' row…
  var worn = (typeof userBadgesWorn_ === 'function')
    ? userBadgesWorn_(user.types, user.role)
    : userTypesFromRaw_(user.types).types;
  var role = str_(user.role).toUpperCase();
  if (role && worn.indexOf(role) === -1) worn.push(role);
  var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), CONFIG_BADGE_TAB);
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].sectionid) !== 'access') continue;
    var rule = userTypesFromRaw_(rows[i].badges).types;
    for (var b = 0; b < rule.length; b++) {
      if (worn.indexOf(rule[b]) !== -1) return true;
    }
    return false;   // a rule exists and names nobody here
  }
  return false;     // no rule written: the master alone
}

/** FAIL-CLOSED: which apps a badge or a tenant reaches is the master's pen alone; no 'access' row lifts anybody here. */
function appAccessMayEdit_(user) {
  return hubIsRealMaster_(user);
}

/** The apps no badge, tenant or override row may touch (SPA: MASTER_ONLY_APPS, lib/badgeAccess). */
function appIsMasterOnly_(appId) {
  return ['app-control'].indexOf(str_(appId)) !== -1;
}

/** A bulk lane with every master-only app's list emptied: a row there opens nothing, so none is kept and no release letter leaves. */
function appAccessMasterOnlyCleared_(lane) {
  if (!lane || typeof lane !== 'object' || Array.isArray(lane)) return lane;
  var out = {};
  for (var k in lane) {
    if (!lane.hasOwnProperty(k)) continue;
    out[k] = appIsMasterOnly_(k) ? [] : lane[k];
  }
  return out;
}

/** The per-person denial list as the users tab stores it. */
function appDenialsNormalize_(list) {
  return (Array.isArray(list) ? list : [])
    .map(function (a) { return str_(a).slice(0, 80); })
    .filter(function (a) { return !!a; })
    .slice(0, 200);
}

/** True when `sent` names exactly the apps the stored cell already denies — resending it changes nobody's access. */
function appDenialsSame_(sent, storedCell) {
  var stored = [];
  try { stored = JSON.parse(str_(storedCell) || '[]'); } catch (e) { stored = []; }
  var a = appDenialsNormalize_(sent), b = appDenialsNormalize_(stored);
  var seen = {};
  for (var i = 0; i < b.length; i++) seen[b[i]] = true;
  for (var j = 0; j < a.length; j++) {
    if (!seen[a[j]]) return false;
  }
  var mine = {};
  for (var m = 0; m < a.length; m++) mine[a[m]] = true;
  for (var n = 0; n < b.length; n++) {
    if (!mine[b[n]]) return false;
  }
  return true;
}

/** True when a bulk payload carries a badge or a tenant lane — the app half of the Apply. */
function appAccessBulkTouchesApps_(payload) {
  var lanes = ['rules', 'tenants'];
  for (var i = 0; i < lanes.length; i++) {
    var lane = payload && payload[lanes[i]];
    if (lane && typeof lane === 'object' && Object.keys(lane).length) return true;
  }
  return false;
}

HUB_POLICY.configBadgeAccessSet = {
  file: 'Prefs.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  params: { section_id: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.configBadgeAccessSet = function (payload, user) {
  if (!accessMatrixMayEdit_(user)) {
    return { status: 404, message: 'Unknown action.' };
  }
  var sectionId = str_(payload.section_id).slice(0, 80);
  if (!sectionId) return { status: 400, message: 'section_id: which settings section.' };
  var badges = userTypesFromRaw_(payload.badges).types;
  var sheet = configBadgeSheet_();
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (eL) {
    return { status: 503, message: 'Another update is in progress — try again.' };
  }
  try {
    var values = sheet.getDataRange().getValues();
    var hdr = values[0].map(normKey_);
    var iId = hdr.indexOf('sectionid');
    var rowNum = 0;
    for (var r = 1; r < values.length; r++) {
      if (str_(values[r][iId]) === sectionId) { rowNum = r + 1; break; }
    }
    var now = new Date().toISOString();
    if (!badges.length) {
      if (rowNum) sheet.deleteRow(rowNum);          // back to the section's own gate
    } else if (rowNum) {
      sheet.getRange(rowNum, 1, 1, CONFIG_BADGE_HEADER.length)
           .setValues([[sectionId, badges.join(', '), now, str_(user.email)]]);
    } else {
      sheet.appendRow([sectionId, badges.join(', '), now, str_(user.email)]);
    }
  } finally {
    lock.releaseLock();
  }
  try {
    hubSysLog_(str_(user.email), 'config_badge_access_set',
               sectionId + ' → ' + (badges.length ? badges.join(', ') : 'its own gate'),
               { status: 200 });
  } catch (eG) {}
  return { status: 200, data: { section_id: sectionId, badges: badges } };
};

// The MASTER's matrix — everyone else gets the unadvertised 404, but for an account App Control is shared with…
HUB_POLICY.appBadgeAccessSet = {
  file: 'Prefs.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  params: { app_id: { required: true, type: 'string' } },
  // a badge granted here is announced by Python (app/app_release.py), told by the relay once the save lands
  invalidates: [], emits: []
};
HUB_ACTIONS.appBadgeAccessSet = function (payload, user) {
  var door = hubAcAdminDoor_(user);
  if (door) return door;
  var appId = str_((payload || {}).app_id).slice(0, 80);
  var delegated = !appAccessMayEdit_(user);
  if (delegated) {
    var refusal = hubAcDelegateWriteRefusal_(user, [appId]);
    if (refusal) return refusal;
  }
  var badges = userTypesFromRaw_(payload.badges).types;
  if (badges.length && appIsMasterOnly_(appId)) {
    return { status: 400, message: 'This app is the master\'s alone — no badge opens it, so it takes no badge rule.' };
  }
  var sheet = appBadgeSheet_();
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (eL) {
    return { status: 503, message: 'Another update is in progress — try again.' };
  }
  var prevRaw = '';
  try {
    var values = sheet.getDataRange().getValues();
    var hdr = values[0].map(normKey_);
    var iId = hdr.indexOf('appid');
    var rowNum = 0;
    for (var r = 1; r < values.length; r++) {
      if (str_(values[r][iId]) === appId) { rowNum = r + 1; break; }
    }
    if (rowNum) prevRaw = str_(values[rowNum - 1][hdr.indexOf('badges')]);
    var now = new Date().toISOString();
    if (!badges.length) {
      if (rowNum) sheet.deleteRow(rowNum);          // back to open-to-audience
    } else if (rowNum) {
      sheet.getRange(rowNum, 1, 1, APP_BADGE_HEADER.length)
           .setValues([[appId, badges.join(', '), now, str_(user.email)]]);
    } else {
      sheet.appendRow([appId, badges.join(', '), now, str_(user.email)]);
    }
    // the profile apps' gate reads these rows through the cache (ViewerScope.gs hubProfileAppRules_)
    cacheBump_(APP_BADGE_TAB);
  } finally {
    lock.releaseLock();
  }
  // The release announcement is Python's (app/app_release.py), told by the relay once this save lands.
  try {
    hubSysLog_(str_(user.email), 'app_badge_access_set',
               appId + ' → ' + (badges.length ? badges.join(', ') : 'open to everyone') +
               (delegated ? ' (App Control access)' : ''),
               { status: 200 });
  } catch (eG) {}
  return { status: 200, data: { app_id: appId, badges: badges } };
};

// THE WHOLE MATRIX IN ONE EXECUTION — only PART of it was saving: 32 rules confirmed · 22 did not land.
HUB_POLICY.appAccessSetBulk = {
  file: 'Prefs.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  // asked inside (hubAcAdminDoor_): an account App Control is shared with need not be an admin
  roles: [],
  // NEW badges granted to an app are announced by Python (app/app_release.py), told by the relay once the save lands
  invalidates: [], emits: []
};
HUB_ACTIONS.appAccessSetBulk = function (payload, user) {
  var door = hubAcAdminDoor_(user);
  if (door) return door;
  // App Control shared with this session (AppControlDelegates.gs): badge rows of its own apps, nothing else
  var delegated = false;
  if (appAccessBulkTouchesApps_(payload) && !appAccessMayEdit_(user)) {
    var refusal = hubAcDelegateBulkRefusal_(payload, user);
    if (refusal) return refusal;
    delegated = true;
  }
  if (!delegated && !accessMatrixMayEdit_(user)) {
    return { status: 404, message: 'Unknown action.' };
  }
  var rules = appAccessMasterOnlyCleared_((payload && payload.rules) || {});
  var tenants = appAccessMasterOnlyCleared_((payload && payload.tenants) || {});
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (eL) {
    return { status: 503, message: 'Another update is in progress — try again.' };
  }
  // filled under the lock, announced after it is released
  var addedByApp = {};
  var answer = null;
  try {
    var now = new Date().toISOString();
    var by = str_(user.email);

    // ---- badges ---- empty key set = untouched = skipped, for the reason written below at the tenants block (the…
    var badgeOut = {};
    var wroteBadges = 0;
    // what each touched app allowed BEFORE this pass — the release trigger (appReleaseAutoAnnounce_) is the…
    var prevBadges = {};
    var ruleKeys = (rules && typeof rules === 'object') ? Object.keys(rules) : [];
    if (ruleKeys.length) {
      var bSheet = appBadgeSheet_();
      var bValues = bSheet.getDataRange().getValues();
      var bHdr = bValues[0].map(normKey_);
      var bI = bHdr.indexOf('appid');
      var keep = [];
      // everything the payload does NOT mention keeps its row verbatim
      for (var r = 1; r < bValues.length; r++) {
        var id = str_(bValues[r][bI]);
        if (!id) continue;
        if (rules.hasOwnProperty(id)) { prevBadges[id] = str_(bValues[r][bHdr.indexOf('badges')]); continue; }
        keep.push([id, str_(bValues[r][bHdr.indexOf('badges')]),
                   str_(bValues[r][bHdr.indexOf('updatedat')]),
                   str_(bValues[r][bHdr.indexOf('updatedby')])]);
        badgeOut[id] = str_(bValues[r][bHdr.indexOf('badges')]);
      }
      for (var appId in rules) {
        if (!rules.hasOwnProperty(appId)) continue;
        var badges = userTypesFromRaw_(rules[appId]).types;
        // an EMPTY list means open-to-audience: the row simply does not exist
        if (!badges.length) { badgeOut[appId] = ''; continue; }
        keep.push([str_(appId).slice(0, 80), badges.join(', '), now, by]);
        badgeOut[appId] = badges.join(', ');
        wroteBadges++;
      }
      appAccessRewrite_(bSheet, APP_BADGE_HEADER, keep);
    }

    // ---- tenants ---- EMPTY MEANS UNTOUCHED, AND UNTOUCHED IS FREE — the screen read "Applied, but not…
    var tenantOut = {};
    var wroteTenants = 0;
    var tenantKeys = (tenants && typeof tenants === 'object') ? Object.keys(tenants) : [];
    if (tenantKeys.length) {
      var tSheet = appTenantSheet_();
      var tValues = tSheet.getDataRange().getValues();
      var tHdr = tValues[0].map(normKey_);
      var tI = tHdr.indexOf('appid');
      var tKeep = [];
      for (var r2 = 1; r2 < tValues.length; r2++) {
        var id2 = str_(tValues[r2][tI]);
        if (!id2) continue;
        if (tenants.hasOwnProperty(id2)) continue;
        tKeep.push([id2, str_(tValues[r2][tHdr.indexOf('tenants')]),
                    str_(tValues[r2][tHdr.indexOf('updatedat')]),
                    str_(tValues[r2][tHdr.indexOf('updatedby')])]);
        tenantOut[id2] = str_(tValues[r2][tHdr.indexOf('tenants')]);
      }
      for (var appId2 in tenants) {
        if (!tenants.hasOwnProperty(appId2)) continue;
        var list = (tenants[appId2] || []).map(function (t) { return str_(t).slice(0, 80); })
                     .filter(function (t) { return !!t; });
        if (!list.length) { tenantOut[appId2] = ''; continue; }
        tKeep.push([str_(appId2).slice(0, 80), list.join(', '), now, by]);
        tenantOut[appId2] = list.join(', ');
        wroteTenants++;
      }
      appAccessRewrite_(tSheet, APP_TENANT_HEADER, tKeep);
    }

    // ---- settings sections ---- THE THIRD LIST, AND IT HAD THE SAME DISEASE — every Settings section was defined…
    var sections = (payload && payload.sections) || {};
    var sectionOut = {};
    var wroteSections = 0;
    var sectionKeys = (sections && typeof sections === 'object') ? Object.keys(sections) : [];
    if (sectionKeys.length) {
      var cSheet = configBadgeSheet_();
      var cValues = cSheet.getDataRange().getValues();
      var cHdr = cValues[0].map(normKey_);
      var cI = cHdr.indexOf('sectionid');
      var cKeep = [];
      for (var r3 = 1; r3 < cValues.length; r3++) {
        var id3 = str_(cValues[r3][cI]);
        if (!id3) continue;
        if (sections.hasOwnProperty(id3)) continue;
        cKeep.push([id3, str_(cValues[r3][cHdr.indexOf('badges')]),
                    str_(cValues[r3][cHdr.indexOf('updatedat')]),
                    str_(cValues[r3][cHdr.indexOf('updatedby')])]);
        sectionOut[id3] = str_(cValues[r3][cHdr.indexOf('badges')]);
      }
      for (var sid in sections) {
        if (!sections.hasOwnProperty(sid)) continue;
        var sBadges = userTypesFromRaw_(sections[sid]).types;
        // empty = the section's own gate decides alone; the row simply goes
        if (!sBadges.length) { sectionOut[sid] = ''; continue; }
        cKeep.push([str_(sid).slice(0, 80), sBadges.join(', '), now, by]);
        sectionOut[sid] = sBadges.join(', ');
        wroteSections++;
      }
      appAccessRewrite_(cSheet, CONFIG_BADGE_HEADER, cKeep);
    }

    cacheBump_(APP_BADGE_TAB);
    try { cacheBump_(APP_TENANT_TAB); } catch (eT) { /* the tab may be new */ }
    try { cacheBump_(CONFIG_BADGE_TAB); } catch (eC) { /* the tab may be new */ }

    // THE RELEASE TRIGGER — when an app is released, everything happens AUTOMATICALLY: badges in the NEW list that…
    for (var relId in rules) {
      if (!rules.hasOwnProperty(relId)) continue;
      var prevT = userTypesFromRaw_(prevBadges[relId] || '').types
        .map(function (x) { return str_(x).toUpperCase(); });
      var newT = userTypesFromRaw_(badgeOut[relId] || '').types
        .map(function (x) { return str_(x).toUpperCase(); });
      var addedT = [];
      for (var nt = 0; nt < newT.length; nt++) {
        if (prevT.indexOf(newT[nt]) === -1) addedT.push(newT[nt]);
      }
      if (addedT.length) addedByApp[relId] = addedT;
    }

    hubSysLog_(by, 'app_access_set_bulk',
               wroteBadges + ' badge rule(s), ' + wroteTenants + ' tenant rule(s), ' +
               wroteSections + ' section rule(s) in one pass' + (delegated ? ' (App Control access)' : ''),
               { status: 200 });
    // a delegate's echo holds its own apps' rows alone: the rest of the tab is not its to read
    var grantEcho = delegated ? hubAcDelegateFor_(user) : null;
    answer = { status: 200, data: { badges: delegated ? hubAcDelegateEcho_(grantEcho, badgeOut) : badgeOut,
                                    tenants: delegated ? {} : tenantOut,
                                    sections: delegated ? {} : sectionOut,
                                    wrote: { badges: wroteBadges, tenants: wroteTenants,
                                             sections: wroteSections } } };
  } finally {
    lock.releaseLock();
  }
  // The release announcement is Python's (app/app_release.py), told by the relay once this save lands.
  return answer;
};

// Replace a two-column access tab with `rows`, header intact, in ONE write.
function appAccessRewrite_(sheet, header, rows) {
  // ONE ROW PER ID, ALWAYS — 49 confirmed · 8 did not land, and then it changed again.
  var seen = {}, out = [];
  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i][0] || '');
    if (!id) continue;
    if (seen.hasOwnProperty(id)) { out[seen[id]] = rows[i]; continue; }
    seen[id] = out.length;
    out.push(rows[i]);
  }
  var last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, header.length).clearContent();
  if (!out.length) return;
  var need = out.length + 1;
  if (sheet.getMaxRows() < need) sheet.insertRowsAfter(sheet.getMaxRows(), need - sheet.getMaxRows());
  sheet.getRange(2, 1, out.length, header.length).setValues(out);
}

// ====================================================================== * THE WORKSPACE SHELF — intermediate…

var APP_SECTIONS_TAB = 'app_sections';
var APP_SECTIONS_HEADER = ['section_id', 'label', 'tint', 'icon', 'position',
                           'updated_at', 'updated_by'];
var APP_PLACEMENT_TAB = 'app_placement';
var APP_PLACEMENT_HEADER = ['app_id', 'section_id', 'position', 'updated_at', 'updated_by'];

function appShelfSheet_(name, header) {
  var sheet = hubTabEnsure_(name, header);
  ensureHeader_(sheet, header);
  return sheet;
}

HUB_POLICY.appShelfGet = {
  file: 'Prefs.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.appShelfGet = function (payload, user) {
  if (!user) return hubDenied_();
  appShelfSheet_(APP_SECTIONS_TAB, APP_SECTIONS_HEADER);
  appShelfSheet_(APP_PLACEMENT_TAB, APP_PLACEMENT_HEADER);
  // TWO TABS, ASKED SEPARATELY.
  var secRows = readTabNormalized_(hubTabWorkbook_(APP_SECTIONS_TAB), APP_SECTIONS_TAB);
  var sections = [];
  for (var i = 0; i < secRows.length; i++) {
    var sid = str_(secRows[i].sectionid);
    if (!sid) continue;
    sections.push({ id: sid, label: str_(secRows[i].label) || sid,
                    tint: str_(secRows[i].tint) || 'blue',
                    icon: str_(secRows[i].icon),
                    position: Number(secRows[i].position) || (i + 1) });
  }
  sections.sort(function (a, b) { return a.position - b.position; });

  var plRows = readTabNormalized_(hubTabWorkbook_(APP_PLACEMENT_TAB), APP_PLACEMENT_TAB);
  var placement = {}, ranked = {};
  var cut = hubMyWorkAppsCutFor_(user);
  for (var p = 0; p < plRows.length; p++) {
    var appId = str_(plRows[p].appid);
    var secId = str_(plRows[p].sectionid);
    if (!appId || !secId || cut.indexOf(appId) !== -1) continue;
    placement[appId] = secId;                       // last row wins
    if (!ranked[secId]) ranked[secId] = [];
    ranked[secId].push({ id: appId, at: Number(plRows[p].position) || (p + 1) });
  }
  var order = {};
  for (var key in ranked) {
    if (!Object.prototype.hasOwnProperty.call(ranked, key)) continue;
    ranked[key].sort(function (a, b) { return a.at - b.at; });
    order[key] = ranked[key].map(function (x) { return x.id; });
  }
  return { status: 200, data: { sections: sections, placement: placement, order: order } };
};

// The MASTER's pen alone — 404-shaped for everyone else.
HUB_POLICY.appShelfSet = {
  file: 'Prefs.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.appShelfSet = function (payload, user) {
  if (!user || !hubIsMaster_(str_(user.email))) {
    return { status: 404, message: 'Unknown action.' };
  }
  var sections = Array.isArray(payload && payload.sections) ? payload.sections : null;
  var placement = Array.isArray(payload && payload.placement) ? payload.placement : null;
  // BOTH HALVES OR NEITHER.
  if (!sections || !placement) {
    return { status: 400, message: 'sections and placement: the whole shelf, in order.' };
  }
  if (sections.length > 60) return { status: 400, message: 'A sidebar of 60 sections is not a sidebar.' };
  if (placement.length > 400) return { status: 400, message: 'More placements than the registry can hold.' };
  var now = new Date().toISOString();
  var secLines = [], seen = {};
  for (var i = 0; i < sections.length; i++) {
    var s = sections[i] || {};
    var sid = str_(s.id).slice(0, 80);
    var label = str_(s.label).slice(0, 60);
    if (!sid || !label) return { status: 400, message: 'Every section needs an id and a name.' };
    if (seen[sid]) return { status: 400, message: 'Two sections share the id "' + sid + '".' };
    seen[sid] = true;
    secLines.push([sid, label, str_(s.tint).slice(0, 20) || 'blue',
                   str_(s.icon).slice(0, 40), String(i + 1), now, str_(user.email)]);
  }
  var counters = {}, plLines = [];
  for (var j = 0; j < placement.length; j++) {
    var pl = placement[j] || {};
    var appId = str_(pl.app_id || pl.appId).slice(0, 80);
    var secId = str_(pl.section_id || pl.sectionId).slice(0, 80);
    if (!appId || !secId) continue;               // a half-written row is not a placement
    counters[secId] = (counters[secId] || 0) + 1;
    plLines.push([appId, secId, String(counters[secId]), now, str_(user.email)]);
  }
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (eL) {
    return { status: 503, message: 'Another update is in progress — try again.' };
  }
  try {
    var secSheet = appShelfSheet_(APP_SECTIONS_TAB, APP_SECTIONS_HEADER);
    var plSheet = appShelfSheet_(APP_PLACEMENT_TAB, APP_PLACEMENT_HEADER);
    var lastS = secSheet.getLastRow();
    if (lastS > 1) secSheet.getRange(2, 1, lastS - 1, secSheet.getLastColumn()).clearContent();
    if (secLines.length) {
      secSheet.getRange(2, 1, secLines.length, APP_SECTIONS_HEADER.length).setValues(secLines);
    }
    var lastP = plSheet.getLastRow();
    if (lastP > 1) plSheet.getRange(2, 1, lastP - 1, plSheet.getLastColumn()).clearContent();
    if (plLines.length) {
      plSheet.getRange(2, 1, plLines.length, APP_PLACEMENT_HEADER.length).setValues(plLines);
    }
  } finally {
    lock.releaseLock();
  }
  try {
    hubSysLog_(str_(user.email), 'app_shelf_set',
               secLines.length + ' section(s), ' + plLines.length + ' app(s) placed', { status: 200 });
  } catch (eG) {}
  return { status: 200, data: { sections: secLines.length, placement: plLines.length, updated_at: now } };
};

// Which Potential Clients views EXIST for anybody — the same master law the Clients and Hiring views obey: the same…
HUB_POLICY.potClientsViewsPolicy = {
  file: 'Prefs.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
// THE SAME FOUR THE SHELL KNOWS.
var POTCLIENTS_VIEW_IDS = ['unique', 'pipeline', 'compare', 'funnel'];

HUB_ACTIONS.potClientsViewsPolicy = function (payload, user) {
  if (!user) return hubDenied_();
  var raw = '';
  try { raw = str_(hiringAlerts_().potclients_views_master); } catch (e) { raw = ''; }
  var views = raw
    ? raw.split(/[,;|]/).map(function (v) { return v.trim().toLowerCase(); })
         .filter(function (v) { return POTCLIENTS_VIEW_IDS.indexOf(v) !== -1; })
    : POTCLIENTS_VIEW_IDS.slice();
  if (!views.length) views = ['pipeline'];   // a doorless app helps nobody
  return { status: 200, data: { views: views } };
};

// IT LIVES HERE, NOT IN Main.gs, AND THAT IS NOT ARBITRARY.
HUB_POLICY.hubBoot = {
  file: 'Main.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.hubBoot = function (payload, user, token) {
  // THE SPA'S FIRST WORD.
  try { if (typeof hubPropsCheck_ === 'function') hubPropsCheck_(); } catch (eB) {}
  if (!user || user.is_service) return hubDenied_();
  var out = {};
  function part(name, fn) {
    try {
      var r = fn();
      if (r && r.status === 200) out[name] = r.data;
    } catch (e) { /* one part's refusal is not the boot's failure */ }
  }
  part('prefs', function () { return HUB_ACTIONS.prefsGet({}, user, token); });
  part('access', function () { return HUB_ACTIONS.appBadgeAccessGet({}, user); });
  // these two read HUB_CALLER themselves, so a visit does not narrow them here any more than it does on their own…
  part('tenants', function () { return HUB_ACTIONS.tenantsList({}, user); });
  part('members', function () { return HUB_ACTIONS.platformMembersList({}, user); });
  return { status: 200, data: out };
};
