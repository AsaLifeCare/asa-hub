/** How long one acting session may live, counted from its created_at; never longer than the master's own. */
var BE_ANOTHER_TTL_MS = 2 * 3600 * 1000;
/**
 * The script cache holds a resolved child this long at most. A cached child is
 * re-checked only for its clock and the master constant, so this is how long
 * a parent row deleted by hand, or a master or target blocked, can lag.
 */
var BE_ANOTHER_CACHE_S = 60;
var BE_ANOTHER_REAL_COL = 'acting_real_user_id';
var BE_ANOTHER_PARENT_COL = 'parent_token_hash';

/**
 * REFUSED WHILE ACTING — action → what it would have done, in the words the
 * refusal says. The person's own record and credentials, speaking as them to
 * other people, their e-mail, accounts and roles, App Control and the badge
 * matrix, the master-only doors and the switches every message obeys (so the
 * test-mode dial can never move from inside somebody else's session).
 */
var BE_ANOTHER_REFUSED = {
  profileUpdate: 'changing their name, photo, password, phones or e-mails',
  prefsSet: 'saving their preferences',
  myWorldAccessSet: 'changing who may open their world',
  platformMemberAsk: 'inviting somebody onto their platform',
  platformMemberAuthorize: 'letting somebody onto their platform',
  platformMemberRemove: 'removing somebody from their platform',
  platformMemberLeave: 'leaving a platform in their name',
  platformMemberSweep: 'sweeping their platform invitations',
  chatSend: 'sending a chat message in their name',
  chatReact: 'reacting in their name',
  chatMarkRead: 'marking their messages read',
  platformMailInbox: 'opening e-mail — it stays with your own sign-in',
  platformMailMessage: 'opening e-mail — it stays with your own sign-in',
  platformMailAttachment: 'opening e-mail — it stays with your own sign-in',
  platformMailMark: 'changing e-mail — it stays with your own sign-in',
  platformMailMove: 'changing e-mail — it stays with your own sign-in',
  platformMailUnread: 'reading e-mail counts — they stay with your own sign-in',
  platformMailSend: 'sending e-mail — it stays with your own sign-in',
  platformMailAccountAdd: 'adding a mailbox — it stays with your own sign-in',
  mailPreviewSend: 'sending e-mail — it stays with your own sign-in',
  mailLogCollect: 'collecting the mail log — it stays with your own sign-in',
  userCreate: 'creating accounts',
  userUpdate: 'changing accounts, roles or access',
  userDelete: 'removing accounts',
  usersArm: 'arming accounts',
  userActivate: 'activating accounts',
  userInvite: 'inviting accounts',
  inviteSend: 'sending invitations',
  inviteRevoke: 'revoking invitations',
  clientUserCreate: 'creating client accounts',
  releaseUser: 'releasing accounts',
  appReleaseAnnounce: 'announcing an app release',
  userMergeManual: 'merging accounts',
  usersContactMergeApply: 'merging account contacts',
  peopleMergeApply: 'merging people',
  usersFromPeople: 'creating accounts from the roster',
  usersFromSigned: 'creating accounts from signed paperwork',
  usersFromClients: 'creating client accounts',
  usersFromGuardians: 'creating guardian accounts',
  usersPhoneBackfill: 'rewriting account phones',
  usersQuoEnrich: 'rewriting account contacts',
  appBadgeAccessSet: 'changing App Control',
  appAccessSetBulk: 'changing App Control',
  configBadgeAccessSet: 'changing which badges reach a setting',
  appTenantAccessSet: 'changing which places reach an app',
  appShelfSet: 'rearranging the workspace sections',
  userMenuLinksSet: 'changing the company menu',
  hiringAlertsSet: 'changing the platform switches and test mode',
  smartCommsSet: 'changing the message switches and test mode',
  scriptPropSet: 'changing a script property',
  tenantEnsure: 'creating a place',
  tenantUpsert: 'changing a place',
  masterOverview: 'the master overview',
  questionnaireSubmit: 'answering a questionnaire in their name',
  certDocUpload: 'filing a document on a record in their name',
  beAnotherStart: 'acting as a third account — press Be Back first',
  beAnotherList: 'picking another account — press Be Back first'
};

/**
 * REFUSED WHILE ACTING, on the generic lane — resource → what a write would
 * have been. A row here is the person's own signature: it would read as
 * theirs, and only the system log would say otherwise. Asked by hubPlaceGate_
 * (Tenant.gs), the one door route() passes for every generic verb.
 */
var BE_ANOTHER_REFUSED_RESOURCES = {
  policyAcks: 'acknowledging a policy in their name',
  marEntries: 'signing a medication record in their name'
};

/**
 * Handlers whose own source touches sessions, passwords or access and are NOT
 * refused, each with the reason. The self-test's drift guard fails any new
 * such handler that is in neither list.
 */
var BE_ANOTHER_ALLOWED_WRITERS = {
  beAnotherStop: 'ends only the acting session it is called from — Be Back must always work',
  appBadgeAccessGet: 'reads App Control to draw it; every door that writes it is refused above'
};

/**
 * Helpers the drift guard reaches from an allowed handler (up to three calls
 * deep) that touch sessions, passwords or access, each with the reason. A
 * helper that asks beAnotherActive_() itself needs no entry.
 */
var BE_ANOTHER_ALLOWED_HELPERS = {
  userPublic_: 'reads a person\'s app denials to answer who they are; writes nothing',
  sheetBoardMayAddMore_: 'reads the badge matrix to answer whether one more board fits; writes nothing',
  istConfigMayEdit_: 'reads which badges may edit the IST config; writes nothing',
  hubViewerOf_: 'reads the visited account\'s own row, denials included, to tell whose view a read is; writes nothing',
  hubProfileAppRules_: 'reads App Control\'s badge and tenant rows to gate a profile read; writes nothing',
  appAccessSeedDictated_: 'seeded once ever behind a script property — the platform\'s own migration',
  appAccessSeedFamily_: 'seeded once ever behind a script property — the platform\'s own migration'
};

/** The acting context of THIS request, or null (set only by sessionUser_). */
function beAnotherActive_() {
  return (typeof HUB_BE_ANOTHER !== 'undefined' && HUB_BE_ANOTHER) ? HUB_BE_ANOTHER : null;
}

function beAnotherUserRow_(uid) {
  var all = usersAll_();
  for (var i = 0; i < all.length; i++) {
    if (str_(all[i].userid) === str_(uid)) return all[i];
  }
  return null;
}

function beAnotherLive_(row) {
  return !!row && str_(row.active).toLowerCase() !== 'false' && !str_(row.mergedinto);
}

/**
 * The halves that live in other files, present in THIS build — '' when whole,
 * else the one missing. Without them a start would mint a child an older
 * sessionUser_ resolves as a plain session: no refusal, no silence.
 * FAIL-CLOSED: a part that cannot be read is missing.
 */
function beAnotherWired_() {
  try {
    if (typeof HUB_BE_ANOTHER === 'undefined') return 'Auth.gs (the acting context)';
    if (String(sessionUser_).indexOf('beAnotherResolveRow_') === -1) return 'Auth.gs (the child resolution)';
    if (String(hubPolicyGate_).indexOf('beAnotherPolicyGate_') === -1) return 'Resolver.gs (the refusals)';
    if (String(hubSysLog_).indexOf('beAnotherActive_') === -1) return 'SysLog.gs (the silence while acting)';
    if (String(hubPlaceGate_).indexOf('beAnotherResourceGate_') === -1) return 'Tenant.gs (the generic refusals)';
    if (!tenantActionAllowed_('beAnotherStop')) return 'Tenant.gs (Be Back wherever the target stands)';
    if (String(hubPropsBoot_).indexOf('HUB_BE_ANOTHER') === -1) return 'SheetDb.gs (the reset at every request)';
    if (String(HUB_ACTIONS.hubBoot).indexOf('hubPropsBoot_(') !== -1) return 'Prefs.gs (the boot keeps the context)';
    if (String(chatTouchPresence_).indexOf('beAnotherActive_') === -1) return 'Chat.gs (no presence while acting)';
    if (String(formPublicSubmitPub_).indexOf('beAnotherActive_') === -1) return 'Forms.gs (no signer while acting)';
    if (String(onboardingEnsureUser_).indexOf('beAnotherActive_') === -1) return 'Hired.gs (no login minted while acting)';
    return '';
  } catch (e) {
    return 'a part that could not be read (' + String((e && e.message) || e) + ')';
  }
}

/** Who may list, start: the hardcoded master, as themselves, at home, visiting nobody. */
function beAnotherMayStart_(user) {
  if (!user || user.is_service) return false;
  if (beAnotherActive_()) return false;
  if (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX) return false;
  if (typeof HUB_CALLER !== 'undefined' && HUB_CALLER) return false;
  return hubIsMaster_(str_(user.email));
}

/**
 * A child row, resolved as its target — or null.
 * FAIL-CLOSED: anything unreadable, missing or not the master's is nobody.
 */
function beAnotherResolveRow_(values, hdr, r, th, cache) {
  try {
    var row = values[r];
    var iTok = hdr.indexOf('tokenhash'), iUid = hdr.indexOf('userid'), iExp = hdr.indexOf('expiresat');
    var iCreated = hdr.indexOf('createdat');
    var iReal = hdr.indexOf(normKey_(BE_ANOTHER_REAL_COL));
    var iParent = hdr.indexOf(normKey_(BE_ANOTHER_PARENT_COL));
    if (iTok === -1 || iUid === -1 || iExp === -1 || iCreated === -1 || iReal === -1 || iParent === -1) return null;
    var now = Date.now();
    // the TTL counts from created_at, written once: a slide that lands on this row by index cannot stretch it
    var created = new Date(str_(row[iCreated])).getTime();
    if (!(created > 0)) return null;
    var until = Math.min(new Date(str_(row[iExp])).getTime(), created + BE_ANOTHER_TTL_MS);
    if (!(until > now)) return null;
    var realId = str_(row[iReal]), parentTh = str_(row[iParent]), targetId = str_(row[iUid]);
    if (!realId || !parentTh || !targetId || parentTh === th || targetId === realId) return null;
    var parent = null;
    for (var p = 1; p < values.length; p++) {
      if (str_(values[p][iTok]) === parentTh) { parent = values[p]; break; }
    }
    // the parent: a live session of the real account, and never a child itself
    if (!parent || str_(parent[iReal]) || str_(parent[iUid]) !== realId) return null;
    if (!(new Date(str_(parent[iExp])).getTime() > now)) return null;
    var real = beAnotherUserRow_(realId), target = beAnotherUserRow_(targetId);
    if (!beAnotherLive_(real) || !hubIsMaster_(str_(real.email))) return null;
    if (!beAnotherLive_(target) || hubIsMaster_(str_(target.email))) return null;
    var pub = userPublic_(target);
    // the platform mailbox stays with the real sign-in
    pub.mail_reader = false;
    var ctx = {
      real: { id: realId, email: str_(real.email), display_name: str_(real.displayname) },
      target: { id: targetId, email: str_(target.email), display_name: str_(target.displayname),
                role: str_(target.role) || 'staff' },
      until: new Date(until).toISOString(), th: th, parent_th: parentTh
    };
    HUB_BE_ANOTHER = ctx;
    try {
      cache.put('sess_' + th, JSON.stringify({ be: 1, user: pub, real: ctx.real, target: ctx.target,
                                               until: ctx.until, parent_th: parentTh }),
                Math.max(1, Math.min(BE_ANOTHER_CACHE_S, Math.floor((until - now) / 1000))));
    } catch (eC) { /* the sheet answers next time */ }
    return pub;
  } catch (e) {
    HUB_BE_ANOTHER = null;
    return null;
  }
}

/** A cached child, re-checked: its clock and the hardcoded master. FAIL-CLOSED. */
function beAnotherFromCache_(parsed, th, cache) {
  try {
    var until = new Date(str_(parsed && parsed.until)).getTime();
    var ok = parsed && parsed.user && parsed.real && parsed.target && until > Date.now() &&
      hubIsMaster_(str_(parsed.real.email)) && !hubIsMaster_(str_(parsed.user.email)) &&
      str_(parsed.user.id) === str_(parsed.target.id);
    if (!ok) {
      try { cache.remove('sess_' + th); } catch (eR) { /* the entry expires by itself */ }
      return null;
    }
    HUB_BE_ANOTHER = { real: parsed.real, target: parsed.target, until: str_(parsed.until), th: th,
                       parent_th: str_(parsed.parent_th) };
    return parsed.user;
  } catch (e) {
    HUB_BE_ANOTHER = null;
    return null;
  }
}

/**
 * Delete every child of one parent session, and their cache entries (a new
 * start, the master's sign-out, a release).
 */
function beAnotherEndChildren_(parentTh, sheet, why) {
  var out = { ended: 0, complete: false, error: '' };
  if (!parentTh) { out.complete = true; return out; }
  try {
    sheet = sheet || hubSheet_(SESSIONS_TAB);
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) { out.complete = true; return out; }
    var hdr = values[0].map(normKey_);
    var iTok = hdr.indexOf('tokenhash'), iParent = hdr.indexOf(normKey_(BE_ANOTHER_PARENT_COL));
    var iUid = hdr.indexOf('userid'), iReal = hdr.indexOf(normKey_(BE_ANOTHER_REAL_COL));
    // no column means no child was ever minted here
    if (iParent === -1) { out.complete = true; return out; }
    var cache = null;
    try { cache = CacheService.getScriptCache(); } catch (eC) { cache = null; }
    for (var r = values.length - 1; r >= 1; r--) {
      if (str_(values[r][iParent]) !== str_(parentTh)) continue;
      if (cache && iTok !== -1) {
        try { cache.remove('sess_' + str_(values[r][iTok])); } catch (eR) { /* the row still goes */ }
      }
      sheet.deleteRow(r + 1);
      out.ended++;
      beAnotherLogEnded_(iReal !== -1 ? str_(values[r][iReal]) : '', iUid !== -1 ? str_(values[r][iUid]) : '',
                         why || 'the session that started it ended');
    }
    out.complete = true;
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  return out;
}

/** Delete one child row by its own token hash (Be Back). */
function beAnotherEndOne_(th) {
  var out = { ended: 0, error: '' };
  try {
    var sheet = hubSheet_(SESSIONS_TAB);
    var values = sheet.getDataRange().getValues();
    var hdr = (values[0] || []).map(normKey_);
    var iTok = hdr.indexOf('tokenhash'), iReal = hdr.indexOf(normKey_(BE_ANOTHER_REAL_COL));
    if (iTok === -1 || iReal === -1) return out;
    for (var r = values.length - 1; r >= 1; r--) {
      if (str_(values[r][iTok]) !== th || !str_(values[r][iReal])) continue;
      sheet.deleteRow(r + 1);
      out.ended++;
    }
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  try { CacheService.getScriptCache().remove('sess_' + th); } catch (eC) { /* expires in minutes */ }
  return out;
}

/** A start or stop leaves no record anywhere. */
function beAnotherLog_(action, real, target, env) {}

/** A child ended by anything but Be Back leaves no record either. */
function beAnotherLogEnded_(realId, targetId, why) {}

/**
 * The auth answers' `be_another` block, computed from the session just
 * resolved: acting → both identities; the plain master → acting null; anybody
 * else → undefined, so the key is absent and nothing of it is drawn.
 */
function beAnotherAuthBlock_(me) {
  if (!me || me.is_service) return undefined;
  var ba = beAnotherActive_();
  if (ba) {
    if (!ba.target || str_(ba.target.id) !== str_(me.id)) return undefined;
    var until = new Date(str_(ba.until)).getTime();
    return {
      real: { id: str_(ba.real.id), email: str_(ba.real.email), display_name: str_(ba.real.display_name) },
      acting: { id: str_(me.id), display_name: str_(me.display_name), email: str_(me.email),
                role: str_(me.role), types: me.types || [], until: str_(ba.until),
                expires_in_ms: Math.max(0, until - Date.now()) }
    };
  }
  if (hubIsMaster_(str_(me.email))) {
    return { real: { id: str_(me.id), email: str_(me.email), display_name: str_(me.display_name) },
             acting: null };
  }
  return undefined;
}

function beAnotherRefusal_(what) {
  var ba = beAnotherActive_();
  var name = ba && ba.target ? (str_(ba.target.display_name) || str_(ba.target.email)) : '';
  return { status: 409, code: 'be_another_refused',
           message: 'Not while acting as ' + (name || 'another account') + ': ' + what +
                    '. Press Be Back to do this as yourself.' };
}

/**
 * The policy door's first question: 'pass' for Be Back, a refusal for the
 * list above, null otherwise. Reads only the acting context and the map.
 */
function beAnotherPolicyGate_(action) {
  if (!beAnotherActive_()) return null;
  try {
    var a = String(action || '');
    if (a === 'beAnotherStop') return 'pass';
    if (!Object.prototype.hasOwnProperty.call(BE_ANOTHER_REFUSED, a)) return null;
    return beAnotherRefusal_(BE_ANOTHER_REFUSED[a]);
  } catch (e) {
    // FAIL-CLOSED: doPost reads a throwing gate as no gate, so a gate that cannot decide refuses
    return beAnotherRefusal_('this could not be checked');
  }
}

/** The generic lane's question (hubPlaceGate_): a refusal for a write on the list above, null otherwise. */
function beAnotherResourceGate_(resource, action) {
  if (!beAnotherActive_()) return null;
  try {
    var a = String(action || '');
    if (a !== 'create' && a !== 'update' && a !== 'delete') return null;
    var r = String(resource || '');
    if (!Object.prototype.hasOwnProperty.call(BE_ANOTHER_REFUSED_RESOURCES, r)) return null;
    return beAnotherRefusal_(BE_ANOTHER_REFUSED_RESOURCES[r]);
  } catch (e) {
    // FAIL-CLOSED: a write that cannot be checked while acting is refused
    return beAnotherRefusal_('this could not be checked');
  }
}

/** Every account worth acting as: merged rows and the master left out, blocked ones marked. */
function beAnotherAccounts_() {
  var out = [];
  usersAll_().forEach(function (u) {
    var id = str_(u.userid), email = str_(u.email);
    if (!id || str_(u.mergedinto) || hubIsMaster_(email)) return;
    out.push({
      id: id, display_name: str_(u.displayname), email: email, role: str_(u.role) || 'staff',
      types: (typeof userTypesFromRaw_ === 'function') ? userTypesFromRaw_(u.types).types : [],
      title: str_(u.title), avatar: str_(u.avatar),
      active: str_(u.active).toLowerCase() !== 'false',
      home_tenant: str_(u.hometenant),
      system_hidden: str_(u.systemhidden).toLowerCase() === 'true'
    });
  });
  out.sort(function (a, b) {
    var x = (a.display_name || a.email).toLowerCase(), y = (b.display_name || b.email).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return out;
}

var BE_ANOTHER_UNKNOWN = { status: 404, message: 'Unknown action.' };

/** Every account the master may act as, with their badges — the master's session alone. */
HUB_POLICY.beAnotherList = {
  file: 'BeAnother.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  // any session reaches the handler, which answers 404 to everybody but the master
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.beAnotherList = function (payload, user) {
  if (!beAnotherMayStart_(user)) return BE_ANOTHER_UNKNOWN;
  var missing = beAnotherWired_();
  if (missing) {
    return { status: 503, message: 'Be Another is not whole in this build — ' + missing +
             ' is missing, so there is nobody to pick until it is published.' };
  }
  var accounts;
  try { accounts = beAnotherAccounts_(); } catch (e) {
    return { status: 503, message: 'The accounts could not be read (' + String((e && e.message) || e) +
             ') — there is nobody to pick until they can.' };
  }
  return { status: 200, data: { accounts: accounts, ttl_minutes: Math.round(BE_ANOTHER_TTL_MS / 60000) } };
};

/** Start acting as another account: a child session bound to this master session. */
HUB_POLICY.beAnotherStart = {
  file: 'BeAnother.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  // any session reaches the handler, which answers 404 to everybody but the master; no declared
  // params either — the door checks them first, and a 400 there would admit the action exists
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.beAnotherStart = function (payload, user, token) {
  // a visit never reaches the comparisons below: the session is the master's own, visiting nobody
  if (!beAnotherMayStart_(user) || (typeof HUB_CALLER !== 'undefined' && HUB_CALLER)) return BE_ANOTHER_UNKNOWN;
  if (typeof hubAwayTenant_ === 'function' && hubAwayTenant_()) return BE_ANOTHER_UNKNOWN;
  var parentTh = token ? sha256Hex_(String(token)) : '';
  if (!parentTh) return BE_ANOTHER_UNKNOWN;
  var missing = beAnotherWired_();
  if (missing) {
    return { status: 503, message: 'Be Another is not whole in this build — ' + missing +
             ' is missing, so nothing was started.' };
  }
  var targetId = (payload && typeof payload.id === 'string') ? str_(payload.id) : '';
  if (!targetId) return { status: 400, message: 'Pick the account to act as.' };
  var target = beAnotherUserRow_(targetId);
  if (!target) return { status: 404, message: 'No account with that id.' };
  if (str_(target.mergedinto)) {
    return { status: 409, message: 'That account was merged into another one — pick the keeper instead.' };
  }
  if (str_(target.active).toLowerCase() === 'false') {
    return { status: 409, message: 'That account is blocked — it sees nothing to act as.' };
  }
  // only the master reaches this line, so the master's own row is the one account never worn
  if (hubIsMaster_(str_(target.email))) {
    return { status: 409, message: 'That is your own account — there is nobody else to be.' };
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { status: 503, message: 'Another sign-in change is being written — press again in a moment.' };
  }
  var child = '', until = 0;
  try {
    var sheet = hubSheet_(SESSIONS_TAB);
    var header = ensureHeader_(sheet, [BE_ANOTHER_REAL_COL, BE_ANOTHER_PARENT_COL]);
    var hdr = header.map(normKey_);
    var values = sheet.getDataRange().getValues();
    var iTok = hdr.indexOf('tokenhash'), iUid = hdr.indexOf('userid'), iCreated = hdr.indexOf('createdat');
    var iExp = hdr.indexOf('expiresat'), iSeen = hdr.indexOf('lastseen');
    var iReal = hdr.indexOf(normKey_(BE_ANOTHER_REAL_COL)), iParent = hdr.indexOf(normKey_(BE_ANOTHER_PARENT_COL));
    // created_at too: the child's two hours are counted from it (beAnotherResolveRow_)
    if (iTok === -1 || iUid === -1 || iExp === -1 || iCreated === -1 || iReal === -1 || iParent === -1) {
      return { status: 503, message: 'The sessions tab is missing a column — nothing was started.' };
    }
    var parent = null;
    for (var r = 1; r < values.length; r++) {
      if (str_(values[r][iTok]) === parentTh) { parent = values[r]; break; }
    }
    var now = Date.now();
    var pExp = parent ? new Date(str_(parent[iExp])).getTime() : 0;
    // the parent is this very session: the master's own, live, and never a child
    if (!parent || str_(parent[iUid]) !== str_(user.id) || str_(parent[iReal]) || !(pExp > now)) {
      return BE_ANOTHER_UNKNOWN;
    }
    var ended = beAnotherEndChildren_(parentTh, sheet, 'a new acting session replaced it');
    if (ended.error) {
      return { status: 503, message: 'The earlier acting session could not be ended (' + ended.error +
               ') — nothing was started.' };
    }
    child = randomHex_(48);
    until = Math.min(pExp, now + BE_ANOTHER_TTL_MS);
    var row = [];
    for (var c = 0; c < header.length; c++) row.push('');
    var at = new Date(now).toISOString();
    row[iTok] = sha256Hex_(child);
    row[iUid] = targetId;
    row[iCreated] = at;
    row[iExp] = new Date(until).toISOString();
    if (iSeen !== -1) row[iSeen] = at;
    row[iReal] = str_(user.id);
    row[iParent] = parentTh;
    sheet.appendRow(row);
  } finally {
    lock.releaseLock();
  }
  var pub = userPublic_(target);
  pub.mail_reader = false;
  try { pub.derived_types = hubCalendarBadges_(pub); } catch (eD) { pub.derived_types = []; }
  var real = { id: str_(user.id), email: str_(user.email), display_name: str_(user.display_name) };
  var untilIso = new Date(until).toISOString();
  var acting = { id: pub.id, display_name: pub.display_name, email: pub.email, role: pub.role,
                 types: pub.types || [], until: untilIso, expires_in_ms: Math.max(0, until - Date.now()) };
  beAnotherLog_('beAnother.start', real, pub, { status: 200, message: 'acting until ' + untilIso });
  return { status: 200, data: { token: child, user: pub, be_another: { real: real, acting: acting } } };
};

/** Be Back: end the acting session this request comes from. */
HUB_POLICY.beAnotherStop = {
  file: 'BeAnother.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  // any session reaches the handler: Be Back must work whatever the target's role
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.beAnotherStop = function (payload, user, token) {
  var ba = beAnotherActive_();
  var th = token ? sha256Hex_(String(token)) : '';
  if (!ba || !th || !user || user.is_service || str_(ba.th) !== th ||
      !hubIsMaster_(str_(ba.real && ba.real.email))) {
    return BE_ANOTHER_UNKNOWN;
  }
  var ended = beAnotherEndOne_(th);
  if (ended.error) {
    return { status: 503, message: 'The acting session could not be ended (' + ended.error +
             ') — it ends by itself at ' + str_(ba.until) + '.' };
  }
  beAnotherLog_('beAnother.stop', ba.real, ba.target, { status: 200, message: 'Be Back' });
  return { status: 200, data: { ok: true, ended: ended.ended } };
};
