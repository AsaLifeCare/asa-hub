// ------------------------------------------------------------------ AUTH — users + sessions live in the Hub's own…
// Hashing: salted SHA-256 iterated 5000× (GAS has no bcrypt — honest tradeoff for a self-contained internal tool).

function sha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) {
      var v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    }).join('');
}

function hashPassword_(password, salt) {
  var h = salt + ':' + password;
  for (var i = 0; i < 5000; i++) h = sha256Hex_(h + salt);
  return h;
}

function randomHex_(n) {
  var s = '';
  while (s.length < n) s += sha256Hex_(Utilities.getUuid() + Math.random());
  return s.slice(0, n);
}

// Read aloud or typed from a phone: no 0/O/o, no 1/I/l/i.
var TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
var TEMP_PASSWORD_LENGTH = 12;

/** A fresh random password per call, never a constant; rejection sampling keeps every character equally likely. */
function tempPassword_(n) {
  var len = Math.max(10, n || TEMP_PASSWORD_LENGTH);
  var abc = TEMP_PASSWORD_ALPHABET;
  var limit = 256 - (256 % abc.length);
  var out = '', round = 0;
  while (out.length < len && round < 64) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + ':' + Math.random() + ':' + Date.now() + ':' + (round++),
      Utilities.Charset.UTF_8);
    for (var i = 0; i < bytes.length && out.length < len; i++) {
      var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
      if (b < limit) out += abc.charAt(b % abc.length);
    }
  }
  if (out.length < len) throw new Error('tempPassword_: no randomness to draw from');
  return out;
}

function hubSheet_(name) {
  // A dissolved tab is answered by the runtime, and written there too: the handle every writer holds is the seam…
  var shim = (typeof runtimeSheetFor_ === 'function') ? runtimeSheetFor_(name) : null;
  if (shim) return shim;
  // A MOVED tab is written at its house (HouseFlip.gs) — same seam, same law.
  var house = (typeof houseSheetFor_ === 'function') ? houseSheetFor_(name) : null;
  if (house) return house;
  var sheet = ssOpen_(hubId_('HUB_DB_ID')).getSheetByName(name);
  if (!sheet) throw new Error('Hub tab missing: ' + name);
  // THE MEMO DIES WHERE THE WRITES ARE (C4).
  if (name === USERS_TAB && typeof HUB_USERS_ROWS !== 'undefined') HUB_USERS_ROWS = null;
  return sheet;
}

// ALL USER ROWS, READ ONCE PER EXECUTION (C4).
var HUB_USERS_ROWS = null;

function usersAll_() {
  if (HUB_USERS_ROWS) return HUB_USERS_ROWS;
  HUB_USERS_ROWS = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), USERS_TAB);
  return HUB_USERS_ROWS;
}

/** Drop the memo after a write to the users tab. */
function usersRowsBump_() { HUB_USERS_ROWS = null; }

// WHICH CANDIDATE AN ADDRESS BELONGS TO — indexed once, not scanned per row.
var HUB_CANDIDATE_BY_EMAIL = null;

function candidateEmailIndex_() {
  if (HUB_CANDIDATE_BY_EMAIL) return HUB_CANDIDATE_BY_EMAIL;
  var idx = {};
  try {
    var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB);
    for (var i = 0; i < rows.length; i++) {
      var e = str_(rows[i].email).toLowerCase();
      // first row wins: the same address twice is a duplicate candidate, and guessing which one is "the" record is…
      if (e && !idx.hasOwnProperty(e)) idx[e] = str_(rows[i].candidateid);
    }
  } catch (e2) { /* candidates tab not readable — no link, not an error */ }
  HUB_CANDIDATE_BY_EMAIL = idx;
  return HUB_CANDIDATE_BY_EMAIL;
}

function userPublic_(u) {
  // Profile columns are additive and may be absent on older sheets.
  var overrides = {};
  try { overrides = JSON.parse(str_(u.permoverrides) || '{}') || {}; } catch (e) { overrides = {}; }
  // Empty = headquarters alone; the master's reach is derived, never a cell.
  var tenantHome = str_(u.hometenant);
  var tenantList = [];
  try { tenantList = tenantIdsForUser_(u); } catch (eT) { tenantList = []; }
  return { id: str_(u.userid), email: str_(u.email),
           display_name: str_(u.displayname), role: str_(u.role) || 'staff',
           home_tenant: tenantHome,
           tenants: tenantList,
           world_role: (function () {
             try { return memberWorldRole_({ id: str_(u.userid), email: str_(u.email) }); }
             catch (eW) { return 'owner'; }
           })(),
           // Fixed in code (HUB_MASTER_ACCOUNT), never a users cell: anything reachable from Settings is escalatable.
           is_master: hubIsMaster_(str_(u.email)),
           title: str_(u.title), phone: str_(u.phone),
           // `phone` above stays the first entry so existing readers keep working.
           phones: profileParsePhones_(u.phones),
           emails: profileParseEmails_(u.emails),
           // false = no password set yet (awaiting, not locked).
           armed: Boolean(str_(u.passhash)),
           avatar: str_(u.avatar),
           overrides: overrides,
           candidate_id: str_(u.candidateid) || candidateIdByEmail_(str_(u.email)),
           // Set by an admin; never inferred from a name or an email.
           client_key: str_(u.clientkey),
           people_id: str_(u.peopleid),
           roster_status: str_(u.rosterstatus),
           employee_id: str_(u.employeeid),
           start_date: str_(u.startdate),
           end_date: str_(u.enddate),
           contact_sources: (function () {
             try {
               var cs = JSON.parse(str_(u.contactsources) || '{}');
               return (cs && typeof cs === 'object' && !Array.isArray(cs)) ? cs : {};
             } catch (eCs) { return {}; }
           })(),
           contact_synced_at: str_(u.contactsyncedat),
           system_type: str_(u.systemtype),
           // Hidden from the config surfaces only; the account itself is untouched.
           system_hidden: str_(u.systemhidden).toLowerCase() === 'true',
           types: (typeof userTypesFromRaw_ === 'function') ? userTypesFromRaw_(u.types).types : [],
           must_change_password: str_(u.mustchange).toLowerCase() === 'true',
           app_denials: (function () {
             try {
               var d = JSON.parse(str_(u.appdenials) || '[]');
               return Array.isArray(d) ? d : [];
             } catch (eD) { return []; }
           })(),
           // Shell features are computed here, never client-side.
           mail_reader: (typeof platformMailCanRead_ === 'function')
             ? platformMailCanRead_({ email: str_(u.email), types: str_(u.types), is_service: false })
             : false,
           copilot_star: hubShellFeatureOn_('copilot_badges', u.types, u.email, u.role),
           apps_grid: hubShellFeatureOn_('appgrid_badges', u.types, u.email, u.role),
           smartcomms_widget: hubShellFeatureOn_('smartcomms_widget_badges', u.types, u.email, u.role),
           // Every active account has My world; no badge setting may take it away.
           my_world: true,
           franchise_view: hubGrantedFeatureOn_('franchise_view_badges', u.types, str_(u.email), u.role) };
}

/** The candidate whose email matches this account, if any. */
function candidateIdByEmail_(email) {
  var needle = String(email || '').trim().toLowerCase();
  if (!needle) return '';
  var idx = candidateEmailIndex_();
  return idx.hasOwnProperty(needle) ? idx[needle] : '';
}

// ONE ACCOUNT FROM ANY OF THE PERSON'S E-MAILS.
function userByEmail_(email) {
  var needle = String(email || '').trim().toLowerCase();
  if (!needle) return null;
  var all = usersAll_();
  for (var i = 0; i < all.length; i++) {
    if (str_(all[i].mergedinto)) continue;
    if (str_(all[i].email).toLowerCase() === needle) return all[i];
  }
  // THE EXTRAS ARE READ BY THE DOOR THAT WRITES THEM.
  var hit = null, hits = 0;
  for (var j = 0; j < all.length; j++) {
    if (str_(all[j].mergedinto)) continue;
    var raw = all[j].emails;
    var extras = (typeof profileParseEmails_ === 'function')
      ? profileParseEmails_(raw).map(function (e) { return str_(e).trim().toLowerCase(); })
      : String(raw || '').toLowerCase().split(/[,;|\s]+/);
    if (extras.indexOf(needle) !== -1) { hit = all[j]; hits++; }
  }
  return hits === 1 ? hit : null;
}

function sessionCreate_(userId) {
  var token = randomHex_(48);
  var now = new Date();
  var expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
  hubSheet_(SESSIONS_TAB).appendRow([
    sha256Hex_(token), userId, now.toISOString(), expires.toISOString(), now.toISOString()
  ]);
  return token;
}

// THE ACTING CONTEXT OF THIS REQUEST (BeAnother.gs) — null unless the token sessionUser_ just resolved is a child…
var HUB_BE_ANOTHER = null;

function sessionUser_(token) {
  HUB_BE_ANOTHER = null;
  HUB_SESSION_USER = null;
  if (!token) return null;
  var th = sha256Hex_(String(token));
  var cache = CacheService.getScriptCache();
  var hit = cache.get('sess_' + th);
  if (hit) {
    var cached = JSON.parse(hit);
    // FAIL-CLOSED: a cached child is re-checked, and without BeAnother.gs it is nobody
    if (cached && cached.be) {
      return hubSessionNote_((typeof beAnotherFromCache_ === 'function') ? beAnotherFromCache_(cached, th, cache) : null);
    }
    return hubSessionNote_(cached);
  }

  var sheet = hubSheet_(SESSIONS_TAB);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;
  var hdr = values[0].map(normKey_);
  var iTok = hdr.indexOf('tokenhash'), iUid = hdr.indexOf('userid');
  var iExp = hdr.indexOf('expiresat'), iSeen = hdr.indexOf('lastseen');
  var iActing = hdr.indexOf('actingrealuserid');
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][iTok]) !== th) continue;
    var exp = new Date(str_(values[r][iExp]));
    if (!(exp.getTime() > Date.now())) return null;  // expired
    // A CHILD SESSION (Be Another) resolves as its target only through the master's live session; it never slides.
    if (iActing !== -1 && str_(values[r][iActing])) {
      return hubSessionNote_((typeof beAnotherResolveRow_ === 'function')
        ? beAnotherResolveRow_(values, hdr, r, th, cache) : null);
    }
    var uid = String(values[r][iUid]);
    var all = usersAll_(), u = null;
    for (var i = 0; i < all.length; i++) {
      if (str_(all[i].userid) === uid) { u = all[i]; break; }
    }
    if (!u || str_(u.active).toLowerCase() === 'false') return null;
    var pub = userPublic_(u);
    // Sliding TTL: refresh at most once a day to keep writes rare.
    var seen = new Date(str_(values[r][iSeen]));
    if (isNaN(seen.getTime()) || Date.now() - seen.getTime() > 86400000) {
      sheet.getRange(r + 1, iExp + 1).setValue(new Date(Date.now() + SESSION_DAYS * 86400000).toISOString());
      sheet.getRange(r + 1, iSeen + 1).setValue(new Date().toISOString());
    }
    cache.put('sess_' + th, JSON.stringify(pub), 21600);
    return hubSessionNote_(pub);
  }
  return null;
}

function sessionDestroy_(token) {
  if (!token) return;
  var th = sha256Hex_(String(token));
  CacheService.getScriptCache().remove('sess_' + th);
  var sheet = hubSheet_(SESSIONS_TAB);
  var values = sheet.getDataRange().getValues();
  var hdr = values.length ? values[0].map(normKey_) : [];
  var iTok = hdr.indexOf('tokenhash');
  var iUid = hdr.indexOf('userid'), iActing = hdr.indexOf('actingrealuserid');
  for (var r = values.length - 1; r >= 1; r--) {
    if (String(values[r][iTok]) !== th) continue;
    if (iActing !== -1 && str_(values[r][iActing]) && typeof beAnotherLogEnded_ === 'function') {
      beAnotherLogEnded_(str_(values[r][iActing]), str_(values[r][iUid]), 'the acting session signed out');
    }
    sheet.deleteRow(r + 1);
  }
  // the acting sessions this one started die with it
  if (typeof beAnotherEndChildren_ === 'function') beAnotherEndChildren_(th, sheet, 'the master signed out');
}

// SIGN-IN LANES.
var ROLE_LANE = {};
var LANE_ROLES = {};

/** null when the sign-in is allowed, otherwise the refusal envelope. */
function authLaneCheck_(role, lane) {
  role = String(role || 'staff');
  lane = String(lane || '');
  var required = ROLE_LANE[role];
  if (required && lane !== required) {
    return { status: 403, message: 'This account signs in through the ' + required.toUpperCase() +
      ' link at the bottom of the page.' };
  }
  if (lane && LANE_ROLES[lane] && LANE_ROLES[lane].indexOf(role) === -1) {
    return { status: 403, message: 'That link is for the ' + lane + ' account — use the normal form.' };
  }
  return null;
}

function authRoute_(action, payload, token) {
  payload = payload || {};
  HUB_BE_ANOTHER = null;
  switch (action) {
    case 'authStatus':
      return { status: 200, data: { needsBootstrap: usersAll_().length === 0 } };

    case 'authBootstrap': {
      if (usersAll_().length > 0) {
        return { status: 409, message: 'Setup already completed — sign in instead.' };
      }
      var name = str_(payload.display_name), email = str_(payload.email).toLowerCase();
      var pw = String(payload.password || '');
      if (!name || email.indexOf('@') === -1 || pw.length < 8) {
        return { status: 400, message: 'Name, a valid email and a password of at least 8 characters are required.' };
      }
      var salt = randomHex_(32);
      var uid = 'USR_' + randomHex_(12).toUpperCase();
      hubSheet_(USERS_TAB).appendRow([
        uid, email, name, 'admin', salt, hashPassword_(pw, salt),
        'true', new Date().toISOString(), new Date().toISOString()
      ]);
      return { status: 200, data: { token: sessionCreate_(uid),
               user: { id: uid, email: email, display_name: name, role: 'admin' } } };
    }

    case 'authLogin': {
      // THE PLATFORM OPENING FOR A PERSON is the other start-up moment: a sign-in that resolved no database id…
      try { if (typeof hubPropsBoot_ === 'function') hubPropsBoot_(); } catch (eB) {}
      var ident = str_(payload.identifier).toLowerCase();
      var pass = String(payload.password || '');
      if (!ident || !pass) return { status: 400, message: 'Email and password are required.' };
      // Light rate limit: 8 failures / 15 min per identifier.
      var cache = CacheService.getScriptCache();
      var fkey = 'lf_' + sha256Hex_(ident);
      var fails = parseInt(cache.get(fkey) || '0', 10);
      if (fails >= 8) return { status: 429, message: 'Too many attempts — try again in a few minutes.' };
      var u = userByEmail_(ident);
      var ok = false;
      if (u) ok = hashPassword_(pass, str_(u.salt)) === str_(u.passhash);
      // THE SECOND CREDENTIAL (PasswordReset.gs): a temporary password a reset handed out, good once and briefly.
      var temp = null;
      if (u && !ok && typeof resetTempMatch_ === 'function') {
        temp = resetTempMatch_(u, pass);
        ok = !!temp;
      }
      // BLOCKED SPEAKS ITS NAME: a deactivated account with the RIGHT password is told it is blocked — never a…
      if (ok && str_(u.active).toLowerCase() === 'false') {
        return { status: 423, code: 'account_blocked',
                 message: 'This account is blocked. Contact asa-hub@asaop.org.' };
      }
      if (!ok) {
        cache.put(fkey, String(fails + 1), 900);
        return { status: 401, message: 'Invalid credentials' };
      }
      // Right password, wrong door: lane-bound accounts are refused here (checked AFTER the password so this never…
      var laneErr = authLaneCheck_(str_(u.role), payload.lane);
      if (laneErr) return laneErr;
      // SPENT BEFORE IT OPENS ANYTHING: a temporary password that could not be marked used signs nobody in, so it…
      if (temp) {
        if (!resetTempSpend_(temp)) return { status: 401, message: 'Invalid credentials' };
        u.mustchange = 'true';
      }
      cache.remove(fkey);
      // THE PERSONAL MAILBOX IS READY BY THE TIME THEY ARE IN: ensured on sign-in, memoised, never blocking the…
      try { if (typeof mailboxEnsure_ === 'function') mailboxEnsure_(u); }
      catch (eMbx) { /* a mail hiccup must never cost a sign-in */ }
      // stamp last_login (best effort) — and, on the FIRST one ever, the must-change demand.
      try {
        var sheet = hubSheet_(USERS_TAB);
        var values = sheet.getDataRange().getValues();
        var hdr = values[0].map(normKey_);
        var iLast = hdr.indexOf('lastlogin');
        // NEVER ENTERED = STILL WEARING THE SHARED DEFAULT.
        var iMust = hdr.indexOf('mustchange');
        if (iMust === -1) {
          // Older sheet: the column is additive, so create it now (once) — otherwise a never-entered account has…
          ensureUserProfileColumns_();
          iMust = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
            .map(normKey_).indexOf('mustchange');
        }
        // BY user_id, not by the typed address: a person may sign in with any of their e-mails (userByEmail_…
        var iId = hdr.indexOf('userid');
        for (var r = 1; r < values.length; r++) {
          if (str_(values[r][iId]) !== str_(u.userid)) continue;
          // a temporary password is a key for this one sign-in: the person chooses their own next
          if (iMust !== -1 && temp) {
            sheet.getRange(r + 1, iMust + 1).setValue('true');
          } else if (iMust !== -1 && !str_(values[r][iLast]) && !str_(values[r][iMust])) {
            sheet.getRange(r + 1, iMust + 1).setValue('true');
            // stamped BEFORE the answer is built, so this very sign-in lands on the gate instead of one free pass…
            u.mustchange = 'true';
          }
          sheet.getRange(r + 1, iLast + 1).setValue(new Date().toISOString());
          break;
        }
      } catch (err) { /* non-fatal */ }
      // THE WORLD IS THERE WHEN THEY ARRIVE.
      var freshUser = userPublic_(u);
      // the badge a current ** row wears, from the first answer on (Profile.gs)
      freshUser.derived_types = hubCalendarBadges_(freshUser);
      freshUser.stamps_hidden = hubStampsHidden_();
      freshUser.record_notes_hidden = hubRecordNotesHidden_();
      // the session's own answer: false reads exactly as Worlds not offered
      freshUser.my_world = !hubMyWorldHiddenFor_(freshUser);
      // the same for My asa. and Bookmarks: false reads exactly as never offered
      freshUser.my_asa = !hubMyAsaHiddenFor_(freshUser);
      // Settings > App Control access: the apps App Control is shared on, present only for an account on the list
      var acLogin = (typeof hubAcDelegatePublic_ === 'function') ? hubAcDelegatePublic_(freshUser) : null;
      if (acLogin) freshUser.app_control = acLogin;
      try {
        if (typeof worldHuman_ === 'function' && worldHuman_(freshUser) &&
            typeof worldRowFor_ === 'function' && !worldRowFor_(freshUser) &&
            typeof HUB_ACTIONS.worldEnsure === 'function') {
          HUB_ACTIONS.worldEnsure({}, freshUser);
        }
      } catch (eWL) { /* the sign-in stands; authMe mints on the next read */ }
      var loginData = { token: sessionCreate_(str_(u.userid)), user: freshUser };
      // Be Another's controls are drawn only when the server names the hardcoded master
      if (hubIsMaster_(str_(u.email))) {
        loginData.be_another = { real: { id: freshUser.id, email: freshUser.email,
                                         display_name: freshUser.display_name }, acting: null };
      }
      return { status: 200, data: loginData };
    }

    case 'authMe': {
      var me = sessionUser_(token);
      // AN ACTIVE USER SIMPLY HAS THEIR WORLD: every active account has My world enabled, always — and an account…
      var acting = (typeof beAnotherActive_ === 'function') ? beAnotherActive_() : null;
      if (me && !me.is_service) {
        try {
          if (!acting && typeof worldHuman_ === 'function' && worldHuman_(me) &&
              typeof worldRowFor_ === 'function' && !worldRowFor_(me) &&
              typeof HUB_ACTIONS.worldEnsure === 'function') {
            HUB_ACTIONS.worldEnsure({}, me);
          }
        } catch (eW) { /* the session stands; the card still mints on press */ }
        /* read every boot, never cached or written, so it follows the calendar */
        me.derived_types = hubCalendarBadges_(me);
        me.stamps_hidden = hubStampsHidden_();
        me.record_notes_hidden = hubRecordNotesHidden_();
        me.my_world = !hubMyWorldHiddenFor_(me);
        me.my_asa = !hubMyAsaHiddenFor_(me);
        var acMe = (typeof hubAcDelegatePublic_ === 'function') ? hubAcDelegatePublic_(me) : null;
        if (acMe) me.app_control = acMe;
      }
      if (!me) return { status: 401, message: 'Authentication required.' };
      var meData = { user: me };
      // computed from the token just resolved, never from a leftover global; absent for everyone but the master
      var block = (typeof beAnotherAuthBlock_ === 'function') ? beAnotherAuthBlock_(me) : undefined;
      if (block) meData.be_another = block;
      return { status: 200, data: meData };
    }

    case 'authLogout':
      sessionDestroy_(token);
      return { status: 200, data: { ok: true } };

    default:
      return { status: 400, message: 'Unknown auth action: "' + action + '".' };
  }
}

// The one master, fixed in code: no property, sheet or screen can name another.
var HUB_MASTER_ACCOUNT = 'asatech@asalifecare.com';
// Self-tests may point this at a fixture; production never assigns it.
var HUB_MASTER_EMAIL_CACHE = null;
function hubMasterEmail_() {
  if (HUB_MASTER_EMAIL_CACHE !== null) return HUB_MASTER_EMAIL_CACHE;
  HUB_MASTER_EMAIL_CACHE = HUB_MASTER_ACCOUNT;
  return HUB_MASTER_EMAIL_CACHE;
}
function hubIsMaster_(email) {
  var m = hubMasterEmail_();
  return !!m && m === String(email || '').trim().toLowerCase();
}

/** The one filter every list of users applies: the master account is never a row in one. Lookups, sign-in and gates still read it. */
function hubIsMasterRow_(row) {
  return !!row && hubIsMaster_(str_(row.email));
}

/** FAIL-CLOSED: the master in its own session. A visit wears the visited account's e-mail, and any admin can record a visit to the master, so an open visit never counts. */
function hubIsRealMaster_(user) {
  if (!user || user.is_service) return false;
  if (user.visiting_member || (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX)) return false;
  if (str_(user.role) !== 'admin') return false;
  return hubIsMaster_(str_(user.email));
}

// THE ACCOUNT THIS REQUEST'S SESSION TOKEN RESOLVED TO (sessionUser_), for the one gate route() (Main.gs) hands no…
var HUB_SESSION_USER = null;

function hubSessionNote_(u) {
  HUB_SESSION_USER = u || null;
  return u;
}

/** FAIL-CLOSED: whom a generic verb acts for — the session's account, or during a visit the visited account at the weaker of the two roles (Main.gs doPost); null with no resolved session and for the service identity. */
function hubRequestCaller_() {
  var u = (typeof HUB_SESSION_USER !== 'undefined') ? HUB_SESSION_USER : null;
  if (!u || u.is_service) return null;
  if (typeof HUB_IS_SERVICE_REQ !== 'undefined' && HUB_IS_SERVICE_REQ) return null;
  var visit = (typeof HUB_MEMBER_CTX !== 'undefined') ? HUB_MEMBER_CTX : null;
  if (visit) {
    return { id: str_(visit.userId), role: memberClampRole_(u.role, visit.role),
             visiting_member: str_(visit.memberId), is_service: false };
  }
  return u;
}

// FAIL-CLOSED: a roster row's name and e-mail decide whose certificates an account reads and files…
function hubRosterWriteGate_(resource, action) {
  if (resource !== 'people') return null;
  if (action !== 'create' && action !== 'update' && action !== 'delete') return null;
  var caller = hubRequestCaller_();
  if (caller && hubIsWriter_(caller)) return null;
  return { status: 403, message: 'The staff roster is written by an administrator or a manager — its names and ' +
           'e-mails decide whose records an account reads. Nothing was changed.' };
}

// FAIL-CLOSED: MAR errors and missing-medication reports are clinical rows about named clients, and no screen reads…
function hubMarErrorsGate_(resource, action) {
  if (resource !== 'marErrors' && resource !== 'missingMedications') return null;
  var u = (typeof HUB_SESSION_USER !== 'undefined') ? HUB_SESSION_USER : null;
  if ((u && u.is_service) || (typeof HUB_IS_SERVICE_REQ !== 'undefined' && HUB_IS_SERVICE_REQ)) return null;
  var caller = hubRequestCaller_();
  var reads = action === 'list' || action === 'get';
  if (caller && ['admin', 'director', 'manager'].indexOf(String(caller.role)) !== -1 &&
      (reads || hubIsWriter_(caller))) return null;
  return { status: 403, message: 'The medication error records are for admins, directors and managers.' };
}


/** A shell button gated by badge CSV in hiring_alerts_config. Empty = on. */
function hubShellFeatureOn_(key, typesRaw, email, roleRaw) {
  // the MASTER never loses a shell button (the Apply pass filled copilot_badges and the star left even the master's…
  try { if (email && typeof hubIsMaster_ === 'function' && hubIsMaster_(String(email))) return true; } catch (e0) { /* fall through */ }
  var cfg = '';
  try { cfg = str_((typeof hiringAlerts_ === 'function' ? hiringAlerts_() : {})[key]); } catch (e) { /* on */ }
  if (!cfg.trim()) return true;
  // A PERSON WEARS THEIR BADGES AND THEIR ROLE (the copilot star was enabled for everyone and a client account…
  var have = hubBadgeHaystack_(typesRaw, roleRaw);
  return cfg.split(',').some(function (b) {
    b = b.trim().toUpperCase();
    return !!b && have.indexOf(b) !== -1;
  });
}


// THE WORDS A CSV RULE IS COMPARED AGAINST — badges, role word, and whatever one of those currently stands in for…
function hubBadgeHaystack_(typesRaw, roleRaw) {
  var have = String(typesRaw || '').toUpperCase();
  var roleWord = String(roleRaw || '').toUpperCase().trim();
  if (roleWord) have = have ? (have + ',' + roleWord) : roleWord;
  if (typeof HUB_BADGE_FOLLOWS !== 'undefined') {
    for (var worn in HUB_BADGE_FOLLOWS) {
      if (!Object.prototype.hasOwnProperty.call(HUB_BADGE_FOLLOWS, worn)) continue;
      if (have.indexOf(worn) !== -1) have = have + ',' + HUB_BADGE_FOLLOWS[worn];
    }
  }
  return have;
}


// A master-plus-grant shell feature: the master always; else a badge from the CSV.
function hubGrantedFeatureOn_(key, typesRaw, email, roleRaw) {
  try { if (typeof hubIsMaster_ === 'function' && hubIsMaster_(String(email || ''))) return true; } catch (e) { /* fall through */ }
  var cfg = '';
  try { cfg = str_((typeof hiringAlerts_ === 'function' ? hiringAlerts_() : {})[key]); } catch (e2) { cfg = ''; }
  if (!cfg.trim()) return false;
  // the same fold as hubShellFeatureOn_ above, and for the same reason
  var have = hubBadgeHaystack_(typesRaw, roleRaw);
  return cfg.split(',').some(function (b) {
    b = b.trim().toUpperCase();
    return !!b && have.indexOf(b) !== -1;
  });
}
