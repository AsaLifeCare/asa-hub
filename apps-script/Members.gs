// Only an account that already signed in on its own may be invited; a member is never created here.

var PLATFORM_MEMBERS_TAB = 'platform_members';
var PLATFORM_MEMBERS_HEADER = ['member_id', 'owner_user_id', 'member_user_id',
                               'member_email', 'status', 'added_at', 'added_by',
                               'removed_at',
                               // scope: blank reads as 'work_world'; scope_by records who closed it
                               'scope', 'authorized_at', 'authorized_by', 'scope_by'];

// Born open; an owner may close the world door but never re-open one the person shut.
var MEMBER_SCOPES = ['work', 'work_world'];
function memberScopeOf_(row) {
  var v = str_(row && row.scope).toLowerCase();
  return v === 'work' ? 'work' : 'work_world';
}

function memberScopeByOf_(row) {
  return str_(row && row.scopeby).toLowerCase();
}

function memberWorldLockedByOwner_(row) {
  return memberScopeOf_(row) === 'work' && memberScopeByOf_(row) === 'member';
}

var PLATFORM_MEMBER_LIMIT = 5;

function membersSheet_() {
  return hubTabEnsure_(PLATFORM_MEMBERS_TAB, PLATFORM_MEMBERS_HEADER);
}

// Read once per execution: usersList maps every account through this.
var HUB_MEMBERS_ROWS = null;
var HUB_MEMBERS_OWNER = null;

function membersRows_() {
  if (HUB_MEMBERS_ROWS) return HUB_MEMBERS_ROWS;
  try {
    // Must read through the same workbook door the writer uses.
    HUB_MEMBERS_ROWS = readTabNormalized_(hubTabWorkbook_(PLATFORM_MEMBERS_TAB), PLATFORM_MEMBERS_TAB);
  } catch (e) {
    // FAIL-CLOSED: an unreadable tab resolves no member.
    HUB_MEMBERS_ROWS = [];
  }
  return HUB_MEMBERS_ROWS;
}

function membersRowsBump_() { HUB_MEMBERS_ROWS = null; }

function platformOwnerEmail_() {
  if (HUB_MEMBERS_OWNER !== null) return HUB_MEMBERS_OWNER;
  try { HUB_MEMBERS_OWNER = hubMasterEmail_(); } catch (e) { HUB_MEMBERS_OWNER = ''; }
  return HUB_MEMBERS_OWNER;
}

function membersOf_(ownerUserId) {
  return membersRows_().filter(function (m) {
    return str_(m.owneruserid) === str_(ownerUserId) && str_(m.status) !== 'removed';
  });
}

function membersActiveOf_(ownerUserId) {
  return membersOf_(ownerUserId).filter(function (m) { return str_(m.status) === 'active'; });
}

function memberEligible_(u) {
  if (!u) return { ok: false, why: 'No account with that e-mail exists yet — send them an invite to register first.' };
  if (str_(u.active).toLowerCase() === 'false') {
    return { ok: false, why: 'That account is deactivated.' };
  }
  if (!str_(u.lastlogin)) {
    return { ok: false, why: 'That person has an account but has never signed in — once they log in they can be added.' };
  }
  return { ok: true, why: '' };
}

function memberWorldRole_(user) {
  if (!user || user.is_service) return 'user';
  return 'owner';
}


var HUB_ROLE_RANK = { admin: 4, manager: 3, staff: 2, onboarding: 1, client: 1 };

function memberRoleRank_(role) {
  var r = HUB_ROLE_RANK[str_(role).toLowerCase()];
  return r === undefined ? 0 : r;
}

// A visit narrows, never widens: the weaker of the two roles wins.
function memberClampRole_(callerRole, visitedRole) {
  return memberRoleRank_(visitedRole) <= memberRoleRank_(callerRole)
    ? str_(visitedRole) : str_(callerRole);
}

// A visit carries only the badges both people hold.
function memberClampTypes_(callerTypes, visitedTypes) {
  var mine = userTypesFromRaw_(callerTypes).types;
  var theirs = userTypesFromRaw_(visitedTypes).types;
  var out = [];
  for (var i = 0; i < theirs.length; i++) {
    if (mine.indexOf(theirs[i]) !== -1) out.push(theirs[i]);
  }
  return out;
}

// Every refusal is 404, never 403: a 403 admits the member row exists.
function memberResolve_(rows, userRows, rawMemberId, user) {
  var wanted = str_(rawMemberId);
  if (!wanted || !user || user.is_service) return null;
  rows = rows || [];
  for (var i = 0; i < rows.length; i++) {
    var m = rows[i];
    if (str_(m.memberid) !== wanted) continue;
    if (str_(m.status) !== 'active') break;
    if (str_(m.owneruserid) !== str_(user.id)) break;
    var all = userRows || [], row = null;
    for (var u = 0; u < all.length; u++) {
      if (str_(all[u].userid) === str_(m.memberuserid)) { row = all[u]; break; }
    }
    if (!row) break;
    return {
      memberId: wanted,
      userId: str_(row.userid),
      email: str_(row.email),
      name: str_(row.displayname),
      role: str_(row.role) || 'staff',
      types: str_(row.types),
      scope: memberScopeOf_(m)
    };
  }
  return { error: { status: 404, message: 'Not found.' } };
}

function memberContext_(rawMemberId, user) {
  if (!str_(rawMemberId) || !user || user.is_service) return null;
  return memberResolve_(membersRows_(), usersAll_(), rawMemberId, user);
}

function hubMemberId_() {
  if (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX) {
    return String(HUB_MEMBER_CTX.memberId || '');
  }
  return '';
}

function hubActingUserId_(user) {
  if (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX && HUB_MEMBER_CTX.userId) {
    return String(HUB_MEMBER_CTX.userId);
  }
  return str_(user && !user.is_service ? user.id : '');
}

// WHERE A WRITE MADE DURING A VISIT LANDS: A VISIT WRITES INTO ITS OWN ENVIRONMENT.

/** The roster of this platform's members — the owner's screen. */
HUB_POLICY.platformMembersList = {
  file: 'Members.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.platformMembersList = function (payload, user) {
  // THE ROSTER IS THE CALLER'S, NOT THE VISITED PERSON'S (found live, entering a member made every member entry…
  var who = (typeof HUB_CALLER !== 'undefined' && HUB_CALLER) ? HUB_CALLER : user;
  if (!who || who.is_service || str_(who.role) !== 'admin') return hubDenied_();
  // a caller kept from worlds is handed no world door, as for a world never opened
  var noWorlds = typeof worldWithheld_ === 'function' && worldWithheld_(who);
  var mine = membersOf_(str_(who.id));
  var all = usersAll_();
  var byId = {};
  all.forEach(function (u) { byId[str_(u.userid)] = u; });
  // WHO COULD BE ADDED: the Platform users settings screen needs auto-complete for the e-mails.
  var taken = {};
  mine.forEach(function (m) { taken[str_(m.memberuserid)] = true; });
  var candidates = [];
  all.forEach(function (u) {
    if (str_(u.userid) === str_(who.id)) return;
    if (taken[str_(u.userid)]) return;
    // THE SAME FILTER usersList APPLIES, and this loop forgot it (audit, ).
    if (!tenantUserVisible_(u)) return;
    if (hubIsMasterRow_(u)) return;
    if (!memberEligible_(u).ok) return;
    candidates.push({
      user_id: str_(u.userid),
      email: str_(u.email),
      name: str_(u.displayname),
      avatar: str_(u.avatar)
    });
  });
  candidates.sort(function (a, b) { return a.email < b.email ? -1 : 1; });

  return { status: 200, data: {
    limit: PLATFORM_MEMBER_LIMIT,
    used: mine.length,
    candidates: candidates,
    members: mine.filter(function (m) {
      return !hubIsMasterRow_(byId[str_(m.memberuserid)] || { email: m.memberemail });
    }).map(function (m) {
      var u = byId[str_(m.memberuserid)] || {};
      return {
        member_id: str_(m.memberid),
        user_id: str_(m.memberuserid),
        email: str_(m.memberemail) || str_(u.email),
        name: str_(u.displayname),
        avatar: str_(u.avatar),
        title: str_(u.title),
        added_at: str_(m.addedat),
 // WHAT THEY ARE, not what visiting makes them: a person is never categorized as "user" here — they are brought in…
        role: str_(u.role) || 'staff',
        types: (typeof userTypesFromRaw_ === 'function') ? userTypesFromRaw_(u.types).types : [],
        status: str_(m.status) || 'active',
        scope: memberScopeOf_(m),
        // their world is theirs wherever it is opened
        world_role: 'owner',
        // THE WORLD'S ID, AND ONLY WHILE THE DOOR IS OPEN.
        world_id: (!noWorlds && memberScopeOf_(m) === 'work_world')
          ? (function () {
              try {
                var rows = worldRows_();
                for (var w = 0; w < rows.length; w++) {
                  if (str_(rows[w].owner_user_id) === str_(m.memberuserid)) {
                    return str_(rows[w].world_id);
                  }
                }
              } catch (eW) { /* no registry: no door, and that is honest */ }
              return '';
            })()
          : ''
      };
    })
  } };
};

// ASK FIRST: before an address is entered and the user added, an e-mail has to go out asking for authorization.
HUB_POLICY.platformMemberAsk = {
  file: 'Members.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: ['email']
};
HUB_ACTIONS.platformMemberAsk = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var email = str_(payload && payload.email).trim().toLowerCase();
  if (!email) return { status: 400, message: 'An e-mail address is required.' };
  if (email === str_(user.email).toLowerCase()) {
    return { status: 400, message: 'You are the owner of this platform — you are already here.' };
  }
  var all = usersAll_(), row = null;
  for (var i = 0; i < all.length; i++) {
    if (str_(all[i].email).toLowerCase() !== email) continue;
    // the same filter the candidate list and the eligibility check apply: a person of another place is a person…
    if (tenantUserVisible_(all[i])) row = all[i];
    break;
  }
  var verdict = memberEligible_(row);
  if (!verdict.ok) return { status: 409, message: verdict.why };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { status: 409, message: 'Another change is in progress — try again.' };
  try {
    membersRowsBump_();
    var mine = membersOf_(str_(user.id));
    if (mine.length >= PLATFORM_MEMBER_LIMIT) {
      return { status: 409, message: 'This platform is full — ' + PLATFORM_MEMBER_LIMIT + ' people is the limit.' };
    }
    for (var j = 0; j < mine.length; j++) {
      if (str_(mine[j].memberuserid) === str_(row.userid)) {
        return { status: 409, message: 'They are already here, or already asked.' };
      }
    }
    var rec = {
      member_id: 'mem_' + randomHex_(10),
      owner_user_id: str_(user.id),
      member_user_id: str_(row.userid),
      member_email: str_(row.email),
      status: 'pending',
      added_at: new Date().toISOString(),
      added_by: str_(user.email),
      removed_at: '', scope: '', authorized_at: '', authorized_by: ''
    };
    var sheet = membersSheet_();
    var header = ensureHeader_(sheet, PLATFORM_MEMBERS_HEADER);
    sheet.appendRow(header.map(function (h) { return rec[h] !== undefined ? rec[h] : ''; }));
    membersRowsBump_();

    var letter = memberAuthEmail_({
      name: str_(row.displayname), ownerName: str_(user.display_name || user.name || user.email)
    });
    var res = rpcCall_('emailSend', {
      to: email, subject: letter.subject, body: letter.text, html: letter.html,
      reason: 'platform member authorization'
    });
    hubSysLog_(user.email, 'platformMemberAsk', email, { status: 200 });
    // A LETTER THE QUIET WINDOW HELD WAS NOT ASKED: the row stands, and the screen says why nothing left rather…
    return { status: 200, data: { member_id: rec.member_id, asked: !!(res && res.ok && !res.quiet),
             why: str_(res && (res.error || res.detail)) } };
  } finally { lock.releaseLock(); }
};

/** Record the answer — by hand from the screen, or by the reply sweep. */
HUB_POLICY.platformMemberAuthorize = {
  file: 'Members.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.platformMemberAuthorize = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var id = str_(payload && payload.member_id);
  var scope = str_(payload && payload.scope).toLowerCase();
  if (MEMBER_SCOPES.indexOf(scope) === -1) {
    return { status: 400, message: 'scope must be work or work_world.' };
  }
  var sheet = membersSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('memberid'), iOwner = hdr.indexOf('owneruserid');
  for (var r = 1; r < values.length; r++) {
    if (str_(values[r][iId]) !== id) continue;
    if (str_(values[r][iOwner]) !== str_(user.id)) return { status: 404, message: 'Not found.' };
    // A DOOR THE PERSON SHUT IS NOT THE OWNER'S TO RE-OPEN.
    var rowObj = {};
    hdr.forEach(function (h, hi) { rowObj[h] = values[r][hi]; });
    if (scope === 'work_world' && memberWorldLockedByOwner_(rowObj)) {
      return { status: 403, message: 'They closed their own world. Only they can open it again.' };
    }
    var set = function (key, val) {
      var i = hdr.indexOf(key);
      if (i !== -1) sheet.getRange(r + 1, i + 1).setValue(val);
    };
    set('scope', scope);
    set('scopeby', 'owner');
    set('status', 'active');
    set('authorizedat', new Date().toISOString());
    set('authorizedby', str_(payload && payload.by) || 'recorded by the owner');
    membersRowsBump_();
    hubSysLog_(user.email, 'platformMemberAuthorize', id + ' → ' + scope, { status: 200 });
    return { status: 200, data: { ok: true, scope: scope } };
  }
  return { status: 404, message: 'Not found.' };
};

// THE UNAUTHORISED DOOR IS GONE (audit: "platformMemberAdd still exists beside platformMemberAsk — a second door…

// Remove somebody from this platform.
HUB_POLICY.platformMemberRemove = {
  file: 'Members.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.platformMemberRemove = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var id = str_(payload && payload.member_id);
  if (!id) return { status: 400, message: 'member_id is required.' };
  var sheet = membersSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('memberid'), iOwner = hdr.indexOf('owneruserid');
  var iStatus = hdr.indexOf('status'), iRemoved = hdr.indexOf('removedat');
  for (var r = 1; r < values.length; r++) {
    if (str_(values[r][iId]) !== id) continue;
    // only the owner of the row may retire it
    if (str_(values[r][iOwner]) !== str_(user.id)) return { status: 404, message: 'Not found.' };
    if (iStatus !== -1) sheet.getRange(r + 1, iStatus + 1).setValue('removed');
    if (iRemoved !== -1) sheet.getRange(r + 1, iRemoved + 1).setValue(new Date().toISOString());
    cacheBump_(PLATFORM_MEMBERS_TAB);
    membersRowsBump_();
    hubSysLog_(user.email, 'platformMemberRemove', id, { status: 200 });
    return { status: 200, data: { ok: true } };
  }
  return { status: 404, message: 'Not found.' };
};

// THE OTHER SIDE OF THE DOOR: the connection has to be endable from BOTH sides.
HUB_POLICY.platformMemberLeave = {
  file: 'Members.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.platformMemberLeave = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  var id = str_(payload && payload.member_id);
  if (!id) return { status: 400, message: 'member_id is required.' };
  var sheet = membersSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('memberid'), iMember = hdr.indexOf('memberuserid');
  var iStatus = hdr.indexOf('status'), iRemoved = hdr.indexOf('removedat');
  for (var r = 1; r < values.length; r++) {
    if (str_(values[r][iId]) !== id) continue;
    // ONLY YOUR OWN LINK.
    if (str_(values[r][iMember]) !== str_(user.id)) return { status: 404, message: 'Not found.' };
    if (iStatus !== -1) sheet.getRange(r + 1, iStatus + 1).setValue('removed');
    if (iRemoved !== -1) sheet.getRange(r + 1, iRemoved + 1).setValue(new Date().toISOString());
    cacheBump_(PLATFORM_MEMBERS_TAB);
    membersRowsBump_();
    hubSysLog_(user.email, 'platformMemberLeave', id, { status: 200 });
    return { status: 200, data: { ok: true } };
  }
  return { status: 404, message: 'Not found.' };
};

// WHICH PLATFORMS AM I STANDING ON — the list the other side never had.
HUB_POLICY.platformMemberMine = {
  file: 'Members.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.platformMemberMine = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  var me = str_(user.id);
  // a caller kept from worlds reads every link as work alone
  var noWorlds = typeof worldWithheld_ === 'function' && worldWithheld_(user);
  var rows = membersRows_(), all = usersAll_(), byId = {};
  all.forEach(function (u) { byId[str_(u.userid)] = u; });
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].memberuserid) !== me) continue;
    if (str_(rows[i].status) !== 'active') continue;
    var o = byId[str_(rows[i].owneruserid)] || {};
    out.push({
      member_id: str_(rows[i].memberid),
      owner_name: str_(o.displayname) || str_(o.email),
      owner_email: str_(o.email),
      owner_avatar: str_(o.avatar),
      added_at: str_(rows[i].addedat),
      scope: noWorlds ? 'work' : memberScopeOf_(rows[i])
    });
  }
  return { status: 200, data: { platforms: out } };
};

// Can this e-mail be invited?
HUB_POLICY.platformMemberCheck = {
  file: 'Members.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.platformMemberCheck = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var email = str_(payload && payload.email).trim().toLowerCase();
  if (!email) return { status: 400, message: 'An e-mail address is required.' };
  var all = usersAll_(), row = null;
  for (var i = 0; i < all.length; i++) {
    if (str_(all[i].email).toLowerCase() !== email) continue;
    // SOMEBODY OF ANOTHER PLACE IS SOMEBODY THIS SCREEN HAS NEVER HEARD OF (Tenant.gs).
    if (tenantUserVisible_(all[i])) row = all[i];
    break;
  }
  var verdict = memberEligible_(row);
  return { status: 200, data: {
    eligible: verdict.ok,
    reason: verdict.why,
    name: row ? str_(row.displayname) : '',
    avatar: row ? str_(row.avatar) : ''
  } };
};


// ------------------------------------------------------------------ the reply sweep — their own word, read once…

// READS ANSWERS, NEVER DECIDES: when the person replies yes by e-mail, the addition may then happen automatically.
function memberAuthSweepRun_(ownerUserId) {
  // ONLY THE ROWS THIS CALLER IS WAITING ON.
  var owner = str_(ownerUserId);
  var pending = membersRows_().filter(function (m) {
    if (str_(m.status) !== 'pending') return false;
    return !owner || str_(m.owneruserid) === owner;
  });
  if (!pending.length) return { status: 200, data: { read: 0, authorized: 0, declined: 0 } };

  var inbox = null;
  try { inbox = platformMailPost_('/mail/inbox', { limit: 50 }); } catch (e) { inbox = null; }
  if (!inbox || inbox.status !== 200) {
    return { status: 200, data: { read: 0, authorized: 0, declined: 0,
             why: 'the mailbox could not be read' } };
  }
  var threads = (inbox.data && inbox.data.threads) || [];
  var byEmail = {};
  pending.forEach(function (m) { byEmail[str_(m.memberemail).toLowerCase()] = m; });

  var authorized = 0, declined = 0, read = 0;
  for (var t = 0; t < threads.length; t++) {
    var th = threads[t];
    // the address IS the identity here: only the person asked may answer for themselves, so a reply from anybody…
    var from = memberReplyAddress_(th.from_addr);
    var hit = (from && byEmail.hasOwnProperty(from)) ? byEmail[from] : null;
    if (!hit) continue;
    read++;
    var verdict = memberAuthReadReply_(th);
    if (!verdict) continue;
    if (verdict === 'no') {
      memberAuthPatch_(str_(hit.memberid), { status: 'declined', authorizedat: new Date().toISOString(),
                                             authorizedby: 'their reply' });
      declined++;
    } else {
      memberAuthPatch_(str_(hit.memberid), { status: 'active', scope: verdict,
                                             authorizedat: new Date().toISOString(),
                                             authorizedby: 'their reply' });
      authorized++;
    }
    delete byEmail[str_(hit.memberemail).toLowerCase()];
  }
  membersRowsBump_();
  return { status: 200, data: { read: read, authorized: authorized, declined: declined } };
}

// THE SENDER'S OWN ADDRESS, and nothing that merely contains it (audit, "the reply sweep matches by SUBSTRING").
function memberReplyAddress_(raw) {
  var v = str_(raw).toLowerCase().trim();
  // The brackets first, and only then the comma: a quoted display name is allowed to contain one ("Silva, Maria"…
  var m = v.match(/<([^>]*)>/);
  v = m ? m[1] : v.split(',')[0];
  return v.replace(/^[\s"']+/, '').replace(/[\s"']+$/, '').trim();
}

/** One model read per message: which word did the human actually write? */
function memberAuthReadReply_(t) {
  var text = ('SUBJECT: ' + str_(t.subject) + '\n' + str_(t.snippet)).slice(0, 1200);
  // the plain words first — a person who answered clearly needs no model
  var flat = text.toUpperCase();
  if (/\bSTOP\b|\bNO\b|\bNAO\b|\bNÃO\b/.test(flat) && !/\bBOTH\b|\bWORK\b/.test(flat)) return 'no';
  if (/\bBOTH\b|\bAMBOS\b/.test(flat)) return 'work_world';
  if (/\bWORK\b|\bTRABALHO\b/.test(flat)) return 'work';
  if (typeof screenAiChat_ !== 'function') return null;
  var ask =
    'Somebody was asked to authorize temporarily sharing their account with a colleague. ' +
    'They could answer WORK (their work only), BOTH (work and their personal world), or NO.\n\n' +
    'MESSAGE:\n' + text + '\n\n' +
    'Which did they answer? If the message does not clearly say, answer none.\n' +
    'Reply with JSON only: {"answer":"work"|"work_world"|"no"|"none"}';
  var res = null;
  try { res = screenAiChat_(ask, 0.1, 'ai_member_reply'); } catch (e) { res = null; }
  if (!res || !res.ok) return null;
  var parsed = null;
  try { parsed = JSON.parse(str_(res.content)); } catch (e2) { parsed = null; }
  var a = parsed ? str_(parsed.answer) : '';
  return (a === 'work' || a === 'work_world' || a === 'no') ? a : null;
}

/** Patch one member row by id, header-addressed. */
function memberAuthPatch_(memberId, patch) {
  var sheet = membersSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('memberid');
  for (var r = 1; r < values.length; r++) {
    if (str_(values[r][iId]) !== str_(memberId)) continue;
    for (var k in patch) {
      if (!patch.hasOwnProperty(k)) continue;
      var c = hdr.indexOf(k);
      if (c !== -1) sheet.getRange(r + 1, c + 1).setValue(patch[k]);
    }
    return true;
  }
  return false;
}

HUB_POLICY.platformMemberSweep = {
  file: 'Members.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.platformMemberSweep = function (payload, user) {
  if (!user) return hubDenied_();
  if (!user.is_service && str_(user.role) !== 'admin') return hubDenied_();
  // a person sweeps what they asked for; the machine sweeps the platform
  return memberAuthSweepRun_(user.is_service ? '' : str_(user.id));
};


// ------------------------------------------------------------------ THE PERSON'S OWN DOOR…

// WHO CAN REACH MY WORLD, AND MY ANSWER ABOUT IT.
HUB_POLICY.myWorldAccessList = {
  file: 'Members.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  // THE DOOR REFUSES BEFORE THE ROOM GETS A SAY (2026-08-20).
  roles: ['admin', 'manager', 'staff', 'client'],
  invalidates: [], emits: []
};
HUB_ACTIONS.myWorldAccessList = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  if (typeof worldWithheld_ === 'function' && worldWithheld_(user)) return { status: 200, data: { rows: [] } };
  var me = str_(user.id);
  var all = usersAll_(), byId = {};
  all.forEach(function (u) { byId[str_(u.userid)] = u; });
  var mine = membersRows_().filter(function (m) {
    return str_(m.memberuserid) === me && str_(m.status) !== 'removed';
  });
  return { status: 200, data: {
    rows: mine.map(function (m) {
      var owner = byId[str_(m.owneruserid)] || {};
      return {
        member_id: str_(m.memberid),
        owner_name: str_(owner.displayname) || str_(owner.email),
        owner_email: str_(owner.email),
        status: str_(m.status) || 'active',
        // open unless I closed it — the door is born open now
        world_open: memberScopeOf_(m) === 'work_world',
        // and this says whether the answer on file is MINE
        closed_by_me: memberScopeByOf_(m) === 'member' && memberScopeOf_(m) === 'work'
      };
    })
  } };
};

// MY ANSWER, AND ONLY ABOUT MY OWN WORLD.
HUB_POLICY.myWorldAccessSet = {
  file: 'Members.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  // THE DOOR REFUSES BEFORE THE ROOM GETS A SAY (2026-08-20).
  roles: ['admin', 'manager', 'staff', 'client'],
  invalidates: [], emits: []
};
HUB_ACTIONS.myWorldAccessSet = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  if (typeof worldWithheld_ === 'function' && worldWithheld_(user)) return { status: 404, message: 'Not found.' };
  var id = str_(payload && payload.member_id);
  if (!id) return { status: 400, message: 'member_id is required.' };
  var open = payload && payload.open === true;
  var sheet = membersSheet_();
  var header = ensureHeader_(sheet, PLATFORM_MEMBERS_HEADER);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('memberid'), iMember = hdr.indexOf('memberuserid');
  for (var r = 1; r < values.length; r++) {
    if (str_(values[r][iId]) !== id) continue;
    // THE ROW MUST BE MINE — not mine to own, mine to BE.
    if (str_(values[r][iMember]) !== str_(user.id)) {
      return { status: 404, message: 'Not found.' };
    }
    var set = function (key, val) {
      var i = hdr.indexOf(key);
      if (i !== -1) sheet.getRange(r + 1, i + 1).setValue(val);
    };
    set('scope', open ? 'work_world' : 'work');
    set('scopeby', 'member');
    set('authorizedat', new Date().toISOString());
    set('authorizedby', 'their own choice');
    membersRowsBump_();
    hubSysLog_(user.email, 'myWorldAccessSet', id + ' → ' + (open ? 'open' : 'closed'),
               { status: 200 });
    return { status: 200, data: { ok: true, world_open: open } };
  }
  return { status: 404, message: 'Not found.' };
};
