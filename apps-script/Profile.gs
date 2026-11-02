// Additive only: columns are appended on first write, never reordered.
var USER_PROFILE_COLUMNS = ['title', 'phone', 'phones', 'emails', 'avatar', 'perm_overrides', 'system_type', 'system_hidden', 'types', 'app_denials', 'must_change',
  'released_at',
  // A blank home_tenant means headquarters.
  'home_tenant', 'tenants',
  // Owned by ContactsSync.gs and appended together so it can write them as one block.
  'people_id', 'employee_id', 'start_date', 'end_date',
  'roster_status', 'contact_sources', 'contact_synced_at',
  // 'self' when the account chose its display name itself; blank when an administrator set it (ComplianceDocs.gs)
  'name_by'];

// Orthogonal to the access role: a DIRECTOR may sign in as manager.
var SYSTEM_USER_TYPES = ['DIRECTOR', 'ADMINISTRATOR', 'FINANCES', 'HR', 'DIVISION SUPERVISOR', 'QUALITY'];

// MASTER is absent on purpose: it is derived from HUB_MASTER_EMAIL, never assigned.
var HUB_USER_TYPES = ['ADMIN', 'ADMINISTRATOR', 'PLATFORMLEAD', 'DIRECTOR', 'SUPERVISOR', 'TEAMLEAD', 'MANAGER', 'HM',
                      'STAFF', 'INTERVIEWER', 'ONBOARDING', 'ENTITY', 'GUARDIAN', 'CLIENT'];

// One way only; mirrored in src/lib/badgeFollows.ts, app/scope.py and server/badge_follows.py (check-badges.mjs).
// TEAMLEAD stands in for nobody (the operator's rule, 2026-10-29).
var HUB_BADGE_FOLLOWS = { SUPERVISOR: 'DIRECTOR', PLATFORMLEAD: 'DIRECTOR' };

// Granted and removed by the real master alone: a badge ranked over DIRECTOR is never minted by an administrator.
var HUB_MASTER_GRANTED_BADGES = ['PLATFORMLEAD'];

/** FAIL-CLOSED: null, or the refusal when a caller who is not the real master would add or remove a master-granted badge. */
function hubBadgeGrantRefused_(user, beforeRaw, afterRaw) {
  var before = userTypesFromRaw_(beforeRaw).types, after = userTypesFromRaw_(afterRaw).types;
  var moved = HUB_MASTER_GRANTED_BADGES.filter(function (b) {
    return (before.indexOf(b) !== -1) !== (after.indexOf(b) !== -1);
  });
  if (!moved.length) return null;
  var real = false;
  try { real = !!hubIsRealMaster_(user); } catch (e) { real = false; }
  if (real) return null;
  return { status: 403, message: 'Only the master grants or removes the ' + moved.join(', ') +
           ' badge. Nothing was changed.' };
}

// For comparing only: never reachable from a write path, or the equivalence would persist into the sheet.
function userBadgesWorn_(typesRaw, roleRaw) {
  var out = userTypesFromRaw_(typesRaw).types;
  var role = String(roleRaw == null ? '' : roleRaw).trim().toUpperCase();
  if (role && out.indexOf(role) === -1) out.push(role);
  var follows = [];
  for (var i = 0; i < out.length; i++) {
    var stands = HUB_BADGE_FOLLOWS[out[i]];
    if (stands && out.indexOf(stands) === -1 && follows.indexOf(stands) === -1) follows.push(stands);
  }
  return out.concat(follows);
}

// HM is derived (`derived_types`), never written; the relay and SPA derive the same badge.
var HUB_CALENDAR_BADGE = 'HM';
var HUB_CALENDAR_BADGES_CACHE_KEY = 'hub_calendar_managers:v1';
var HUB_CALENDAR_BADGES_TTL = 600;
var HUB_CALENDAR_BADGES_MEMO = null;

// Must fold exactly as the relay does.
function hubNameFold_(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function hubCalendarManagers_() {
  if (HUB_CALENDAR_BADGES_MEMO) return HUB_CALENDAR_BADGES_MEMO.map;
  var cache = null, map = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get(HUB_CALENDAR_BADGES_CACHE_KEY);
    if (hit) {
      map = JSON.parse(hit);
      HUB_CALENDAR_BADGES_MEMO = { map: map };
      return map;
    }
  } catch (eC) { cache = null; }
  try {
    var sheet = ssOpen_(hubId_('HOTLINE_CALENDAR_ID')).getSheetByName(HOTLINE_CALENDAR_TAB);
    if (sheet) {
      var byHouse = hotlineManagersByHouse_(sheet.getDataRange().getValues(), hotlineManagerToday_());
      map = {};
      Object.keys(byHouse).forEach(function (loc) {
        byHouse[loc].current.forEach(function (r) {
          var k = hubNameFold_(r.name);
          if (!k) return;
          if (!map[k]) map[k] = [];
          if (map[k].indexOf(loc) === -1) map[k].push(loc);
        });
      });
      if (cache) {
        try { cache.put(HUB_CALENDAR_BADGES_CACHE_KEY, JSON.stringify(map), HUB_CALENDAR_BADGES_TTL); }
        catch (eP) { }
      }
    }
  } catch (eR) { map = null; }
  HUB_CALENDAR_BADGES_MEMO = { map: map };
  return map;
}

function hubCalendarBadges_(u) {
  if (!u || u.is_service) return [];
  var key = hubNameFold_(u.display_name != null ? u.display_name : u.displayname);
  if (!key) return [];
  var map = hubCalendarManagers_();
  if (!map || !map[key] || !map[key].length) return [];
  var uid = String(u.id != null ? u.id : (u.userid != null ? u.userid : ''));
  try {
    var all = usersAll_();
    for (var i = 0; i < all.length; i++) {
      var o = all[i] || {};
      if (String(o.userid) === uid) continue;
      var off = String(o.active == null ? '' : o.active).trim().toUpperCase();
      if (off === 'FALSE' || off === '0' || off === 'NO' || String(o.mergedinto || '').trim()) continue;
      if (hubNameFold_(o.displayname) === key) return [];   // two live accounts, one name: neither gets it
    }
  } catch (eU) { return []; }
  return [HUB_CALENDAR_BADGE];
}

// The display name is the roster identity: an unreadable check refuses.
function hubSelfNameRefused_(uid, name) {
  var key = hubNameFold_(name);
  if (!key) return '';
  var all = null;
  try { all = usersAll_(); } catch (eU) { all = null; }
  if (!all) return 'The accounts could not be checked just now — try again in a minute.';
  var mine = null;
  for (var i = 0; i < all.length; i++) {
    if (str_((all[i] || {}).userid) === str_(uid)) { mine = all[i]; break; }
  }
  if (mine && hubNameFold_(mine.displayname) === key) return '';
  for (var j = 0; j < all.length; j++) {
    var o = all[j] || {};
    if (str_(o.userid) === str_(uid)) continue;
    var off = str_(o.active).trim().toUpperCase();
    if (off === 'FALSE' || off === '0' || off === 'NO' || str_(o.mergedinto).trim()) continue;
    if (hubNameFold_(o.displayname) === key) return 'That name belongs to another account — an administrator can change it.';
  }
  var people = null, cal = null;
  try { people = commBroadcastPeopleRows_(); } catch (eP) { people = null; }
  try { cal = commBroadcastCalendar_(); } catch (eC) { cal = null; }
  if (!people || !cal || !cal.readable) {
    return 'The staff roster could not be checked just now — try again in a minute.';
  }
  var linked = str_(mine && mine.peopleid).replace(/^people:/, '').trim();
  // a link makes the row's name the account's only where it proves itself: a recorded proof, or the sign-in e-mail on the row
  var proved = !!linked && typeof complianceDocsLinkProof_ === 'function' && !!complianceDocsLinkProof_(mine);
  var signIn = str_(mine && mine.email).toLowerCase();
  var onRoster = false, isMine = false;
  people.forEach(function (p) {
    if (hubNameFold_(p && p.name) !== key) return;
    onRoster = true;
    if (!linked || String((p && p.id) || '').replace(/^people:/, '').trim() !== linked) return;
    var rowMail = signIn.indexOf('@') !== -1 && typeof complianceDocsRosterMails_ === 'function' &&
                  complianceDocsRosterMails_(p).indexOf(signIn) !== -1;
    if (proved || rowMail) isMine = true;
  });
  Object.keys(cal.houses || {}).forEach(function (loc) {
    (cal.houses[loc].people || []).forEach(function (p) { if (p && p.key === key) onRoster = true; });
  });
  if (onRoster && !isMine) {
    return 'That name is on the staff roster — an administrator sets the name a rostered person is known by.';
  }
  return '';
}

/** FAIL-CLOSED: the account's stored display name; '' when the accounts cannot be read, so a save reads as a change. */
function hubStoredDisplayName_(uid) {
  try {
    var all = usersAll_() || [];
    for (var i = 0; i < all.length; i++) {
      if (str_((all[i] || {}).userid) === str_(uid)) return str_(all[i].displayname);
    }
  } catch (eU) { /* unreadable: nothing stored is known */ }
  return '';
}

function userBadgesWornBy_(user) {
  var worn = userBadgesWorn_(user && user.types, user && user.role);
  var derived = (user && Array.isArray(user.derived_types)) ? user.derived_types : hubCalendarBadges_(user);
  derived.forEach(function (b) { if (worn.indexOf(b) === -1) worn.push(b); });
  return worn;
}

// Unknown words are reported, never silently dropped.
function userTypesFromRaw_(raw) {
  var list = Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(/[,;|\n]+/);
  var out = [], bad = [];
  list.forEach(function (t) {
    var v = String(t || '').trim().toUpperCase();
    if (!v) return;
    if (HUB_USER_TYPES.indexOf(v) === -1) { bad.push(v); return; }
    if (out.indexOf(v) === -1) out.push(v);
  });
  return { types: out, bad: bad };
}

function userTypesCanInterview_(types) {
  var list = Array.isArray(types) ? types : userTypesFromRaw_(types).types;
  return list.indexOf('INTERVIEWER') !== -1 || list.indexOf('HM') !== -1;
}

// Always through the validator: an off-vocabulary badge cannot be ranked by any screen.
function hubUserTypesSet_(userid, rawList) {
  var sheet = hubSheet_(USERS_TAB);
  ensureHeader_(sheet, ['types']);
  var vals = sheet.getDataRange().getValues();
  var hdr = vals[0].map(normKey_);
  var idI = hdr.indexOf('userid'), tI = hdr.indexOf('types');
  if (idI === -1 || tI === -1) return false;
  var clean = userTypesFromRaw_(rawList).types;
  for (var r = vals.length - 1; r >= 1; r--) {
    if (str_(vals[r][idI]) !== str_(userid)) continue;
    sheet.getRange(r + 1, tI + 1).setValue(clean.join(', '));
    return true;
  }
  return false;
}

// `phones` is labelled JSON; `phone` always mirrors its first entry for single-phone readers.
function profileParsePhones_(raw) {
  if (Array.isArray(raw)) return raw;
  var s = str_(raw);
  if (!s) return [];
  try {
    var parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return s.split(/\s*[;,]\s*/).filter(String).map(function (part) {
      var m = part.split(':');
      return m.length > 1
        ? { label: m[0].trim(), number: m.slice(1).join(':').trim() }
        : { label: 'Phone', number: part.trim() };
    });
  }
}

function profileCleanPhones_(list) {
  var out = [];
  (Array.isArray(list) ? list : []).forEach(function (p) {
    var number = str_(p && p.number).slice(0, 40).trim();
    if (!number) return;
    out.push({ label: str_(p && p.label).slice(0, 24).trim() || 'Phone', number: number });
  });
  return out.slice(0, 8);
}

// Contact addresses only; the sign-in email is never among them.
function profileParseEmails_(raw) {
  if (Array.isArray(raw)) return raw;
  var s = str_(raw);
  if (!s) return [];
  try {
    var parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return s.split(/\s*[;,]\s*/).filter(String);
  }
}

function profileCleanEmails_(list) {
  var out = [], seen = {};
  (Array.isArray(list) ? list : profileParseEmails_(list)).forEach(function (e) {
    var v = str_(e).trim().slice(0, 120);
    var k = v.toLowerCase();
    if (!v || v.indexOf('@') === -1 || seen[k]) return;
    seen[k] = true;
    out.push(v);
  });
  return out.slice(0, 8);
}

function ensureUserProfileColumns_() {
  var sheet = hubSheet_(USERS_TAB);
  var lastCol = sheet.getLastColumn();
  var hdr = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(normKey_);
  USER_PROFILE_COLUMNS.forEach(function (c) {
    if (hdr.indexOf(normKey_(c)) === -1) {
      lastCol += 1;
      sheet.getRange(1, lastCol).setValue(c);
      hdr.push(normKey_(c));
    }
  });
}

function userSetFields_(uid, fields) {
  ensureUserProfileColumns_();
  var sheet = hubSheet_(USERS_TAB);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('userid');
  for (var r = 1; r < values.length; r++) {
    if (str_(values[r][iId]) !== str_(uid)) continue;
    for (var k in fields) {
      var i = hdr.indexOf(normKey_(k));
      if (i !== -1) sheet.getRange(r + 1, i + 1).setValue(fields[k]);
    }
    return true;
  }
  return false;
}

// Away-from-home overlay (tenant_id or 'world:<id>'): identity fields only; contacts and password stay on the account.
var USER_PLACE_PROFILES_TAB = 'user_place_profiles';
var USER_PLACE_PROFILE_HEADERS = ['user_id', 'place', 'display_name', 'title', 'avatar', 'updated_at'];

function placeProfilesSheet_() {
  return hubTabEnsure_(USER_PLACE_PROFILES_TAB, USER_PLACE_PROFILE_HEADERS);
}

function placeProfileGet_(uid, place) {
  var values = placeProfilesSheet_().getDataRange().getValues();
  if (values.length < 2) return null;
  var hdr = values[0].map(normKey_);
  var iU = hdr.indexOf('userid'), iP = hdr.indexOf('place');
  for (var r = 1; r < values.length; r++) {
    if (str_(values[r][iU]) === str_(uid) && str_(values[r][iP]) === str_(place)) {
      var row = {};
      hdr.forEach(function (k, i) { row[k] = values[r][i]; });
      return { display_name: str_(row.displayname), title: str_(row.title), avatar: str_(row.avatar) };
    }
  }
  return null;
}

function placeProfileSet_(uid, place, fields) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return false; }
  try {
    var sheet = placeProfilesSheet_();
    var values = sheet.getDataRange().getValues();
    var hdr = values[0].map(normKey_);
    var iU = hdr.indexOf('userid'), iP = hdr.indexOf('place');
    var col = function (key) { return hdr.indexOf(key) + 1; };
    for (var r = 1; r < values.length; r++) {
      if (str_(values[r][iU]) !== str_(uid) || str_(values[r][iP]) !== str_(place)) continue;
      if (fields.display_name !== undefined) sheet.getRange(r + 1, col('displayname')).setValue(fields.display_name);
      if (fields.title !== undefined) sheet.getRange(r + 1, col('title')).setValue(fields.title);
      if (fields.avatar !== undefined) sheet.getRange(r + 1, col('avatar')).setValue(fields.avatar);
      sheet.getRange(r + 1, col('updatedat')).setValue(new Date().toISOString());
      return true;
    }
    sheet.appendRow([str_(uid), str_(place),
      fields.display_name !== undefined ? fields.display_name : '',
      fields.title !== undefined ? fields.title : '',
      fields.avatar !== undefined ? fields.avatar : '',
      new Date().toISOString()]);
    return true;
  } finally {
    try { lock.releaseLock(); } catch (e2) { }
  }
}

// '' fields mean the home profile shows through; no row answers {profile:null}, never 404.
HUB_POLICY.placeProfileGet = {
  file: 'Profile.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
/** The signed-in account's own profile overlay for one place. */
HUB_ACTIONS.placeProfileGet = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  var place = str_(payload.place).slice(0, 80);
  if (!place) return { status: 400, message: 'place required' };
  return { status: 200, data: { profile: placeProfileGet_(user.id, place) } };
};

HUB_POLICY.profileUpdate = {
  file: 'Profile.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.profileUpdate = function (payload, user, token) {
  var fields = {};
  if (payload.display_name !== undefined) {
    var name = str_(payload.display_name);
    if (!name) return { status: 400, message: 'Name cannot be empty.' };
    fields.display_name = name.slice(0, 80);
    if (!str_(payload.place)) {
      var refused = hubSelfNameRefused_(user.id, fields.display_name);
      if (refused) return { status: 409, message: refused };
      // a name the account changes itself proves nothing to the certificate ledger (ComplianceDocs.gs)
      if (hubNameFold_(fields.display_name) !== hubNameFold_(hubStoredDisplayName_(user.id))) fields.name_by = 'self';
    }
  }
  if (payload.title !== undefined) fields.title = str_(payload.title).slice(0, 120);
  if (payload.phone !== undefined) fields.phone = str_(payload.phone).slice(0, 40);
  if (payload.phones !== undefined) {
    var list = profileCleanPhones_(payload.phones);
    fields.phones = JSON.stringify(list);
    fields.phone = list.length ? list[0].number : '';
  }
  if (payload.emails !== undefined) {
    fields.emails = JSON.stringify(profileCleanEmails_(payload.emails));
  }
  if (payload.avatar !== undefined) fields.avatar = str_(payload.avatar).slice(0, 500);
  // A self-chosen password clears must_change.
  if (payload.password !== undefined) {
    var newPw = String(payload.password || '');
    if (newPw.length < 8) return { status: 400, message: 'Your password needs at least 8 characters.' };
    var pwSalt = randomHex_(32);
    fields.salt = pwSalt;
    fields.pass_hash = hashPassword_(newPw, pwSalt);
    fields.must_change = '';
  }
  if (Object.keys(fields).length === 0) {
    return { status: 400, message: 'Nothing to update — send display_name, title, phone, phones, emails, password and/or avatar.' };
  }
  var place = str_(payload.place).slice(0, 80);
  if (place) {
    var overlay = {};
    ['display_name', 'title', 'avatar'].forEach(function (k) {
      if (fields[k] !== undefined) { overlay[k] = fields[k]; delete fields[k]; }
    });
    if (Object.keys(overlay).length && !placeProfileSet_(user.id, place, overlay)) {
      return { status: 503, message: 'Another update is in progress — try again.' };
    }
  }
  if (Object.keys(fields).length && !userSetFields_(user.id, fields)) {
    return { status: 404, message: 'Your user row was not found.' };
  }
  // The 6h session cache still holds the old public profile.
  if (token) {
    try { CacheService.getScriptCache().remove('sess_' + sha256Hex_(String(token))); } catch (e) { }
  }
  var all = usersAll_(), me = null;
  for (var i = 0; i < all.length; i++) {
    if (str_(all[i].userid) === str_(user.id)) me = all[i];
  }
  return { status: 200, data: { user: me ? userPublic_(me) : null } };
};

/** What the platform has heard from an account linked to a candidate: inbound messages, the phone screen's transcript and every Smart Comms send. */
HUB_POLICY.userConversations = {
  file: 'Profile.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.userConversations = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) {
    return { status: 200, data: { messages: [], transcript: null, sends: [] } };
  }
  var ss = ssOpen_(hubId_('HUB_DB_ID'));

  var messages = [];
  try {
    readTabNormalized_(ss, INBOUND_TAB).forEach(function (m) {
      if (str_(m.candidateid) !== cid) return;
      messages.push({ at: str_(m.receivedat), body: str_(m.body).slice(0, 500),
                      intent: str_(m.intent) });
    });
  } catch (e) { }
  messages.sort(function (a, b) { return a.at < b.at ? 1 : -1; });

  var transcript = null;
  try {
    var ev = hubEvidence_(cid);
    if (ev.screen) {
      transcript = {
        url: str_(ev.screen.transcripturl),
        text: str_(ev.screen.transcripttext).slice(0, 2000),
        at: str_(ev.screen.updatedat) || str_(ev.screen.createdat)
      };
      if (!transcript.url && !transcript.text) transcript = null;
    }
  } catch (e2) { transcript = null; }

  var sends = [];
  try {
    var sheet = smartLedgerSheet_();
    var last = sheet.getLastRow();
    if (last > 1) {
      sheet.getRange(2, 1, last - 1, 6).getValues().forEach(function (r) {
        var person = String(r[2] || '');
        if (person !== cid && person.indexOf(cid + ':') !== 0) return;
        sends.push({ situation: String(r[1] || ''), channel: String(r[4] || ''),
                     at: String(r[5] || '') });
      });
    }
  } catch (e3) { }
  sends.sort(function (a, b) { return a.at < b.at ? 1 : -1; });

  return { status: 200, data: {
    messages: messages.slice(0, 50), transcript: transcript, sends: sends.slice(0, 50)
  } };
};

// A read, never a sync: commsSync owns these tabs (7-day window; summaries accumulate).
HUB_POLICY.userComms = {
  file: 'Profile.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  params: { user_id: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
/** The comms picture of one account: the transcripts, messages and summaries in the Comms mirror that carry one of its numbers. */
HUB_ACTIONS.userComms = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var uid = str_(payload.user_id);
  if (!uid) return { status: 400, message: 'user_id is required' };
  var found = tenantUserRow_(uid);
  if (found.error) return found.error;
  var row = found.row;

  // Fewer than 7 digits is a fragment: matching on it would sweep strangers in.
  var digits = {};
  var take = function (p) {
    var d = commsDigits_(p).slice(-10);
    if (d.length >= 7) digits[d] = true;
  };
  [str_(row.phone)].concat(String(row.phones || '').split(/[,;|]/)).forEach(take);
  // The roster join is unique-match-only.
  try {
    var key = clientNameKey_(str_(row.displayname));
    if (key) {
      var matches = [];
      listRows_('people', {}).forEach(function (p) {
        var pk = '';
        try { pk = clientNameKey_(str_(p.name)); } catch (eK) { pk = ''; }
        if (pk && pk === key) matches.push(p);
      });
      if (matches.length === 1) take(str_(matches[0].phone));
    }
  } catch (eR) { }
  try {
    var cid = str_(row.candidateid);
    if (cid) {
      readTabNormalized_(ssOpen_(TALENT_SHEET_ID), TALENT_CANDIDATES_TAB).forEach(function (c) {
        if (str_(c.candidateid) === cid) take(str_(c.phone));
      });
    }
  } catch (eC) { }
  var dList = Object.keys(digits);
  var hits = function (cell) {
    if (!dList.length) return false;
    var s = commsDigits_(cell);
    for (var i = 0; i < dList.length; i++) { if (s.indexOf(dList[i]) !== -1) return true; }
    return false;
  };

  var out = { transcripts: [], messages: [], summaries: [],
              window_days: COMMS_WINDOW_DAYS, numbers: dList.length };
  if (!dList.length) return { status: 200, data: out };

  var comms = ssOpen_(hubId_('HUB_COMMS_ID'));
  var myCalls = {};
  try {
    readTabNormalized_(comms, 'transcripts').forEach(function (t) {
      var asParticipant = hits(t.participants);
      var asTeam = !asParticipant && hits(t.teammembers);
      if (!asParticipant && !asTeam) return;
      myCalls[str_(t.callid)] = true;
      out.transcripts.push({
        call_id: str_(t.callid), at: str_(t.transcriptcreated),
        secs: str_(t.durationsec), turns: str_(t.turns),
        line: str_(t.quonumber), participant: str_(t.participants),
        direction: str_(t.direction), status: str_(t.status),
        as: asParticipant ? 'participant' : 'team'
      });
    });
  } catch (e1) { }
  try {
    readTabNormalized_(comms, 'messages').forEach(function (m) {
      var asParticipant = hits(m.externalparticipants);
      var asTeam = !asParticipant && hits(m.teammember);
      if (!asParticipant && !asTeam) return;
      out.messages.push({
        id: str_(m.messageid), at: str_(m.messagecreated),
        direction: str_(m.direction), type: str_(m.messagetype),
        status: str_(m.status), body: str_(m.body).slice(0, 400),
        with_number: str_(m.externalparticipants),
        as: asParticipant ? 'participant' : 'team'
      });
    });
  } catch (e2) { }
  // Beyond the mirror's 7 days: the Quo Webhook Log, read-only and tail-capped (it grows forever).
  try {
    var quo = ssOpen_(hubId_('QUO_SYNC_SHEET_ID'));
    var logSheet = quo.getSheetByName('Webhook Log');
    if (logSheet && logSheet.getLastRow() >= 2) {
      var lastR = logSheet.getLastRow();
      var startR = Math.max(2, lastR - 4000 + 1);
      var logRows = logSheet.getRange(startR, 1, lastR - startR + 1, 5).getValues();
      var nameNeedle = str_(row.displayname).replace(/\s+/g, ' ').trim().toLowerCase();
      if (nameNeedle.length < 5) nameNeedle = '';
      var haveMsg = {};
      out.messages.forEach(function (m) { haveMsg[m.id] = true; });
      for (var lg = logRows.length - 1; lg >= 0; lg--) {
        var typ = String(logRows[lg][1] || '');
        if (typ !== 'message.received' && typ !== 'message.delivered') continue;
        var o;
        try { o = JSON.parse(String(logRows[lg][4] || '')).data.object; } catch (ePr) { continue; }
        var mid = String(o.id || '');
        if (!mid || haveMsg[mid]) continue;
        var body = String(o.body || '');
        var numHit = hits(String(o.from || '') + ' ' + String(o.to || ''));
        var nameHit = nameNeedle && body.toLowerCase().indexOf(nameNeedle) !== -1;
        if (!numHit && !nameHit) continue;
        haveMsg[mid] = true;
        var outg = String(o.direction) === 'outgoing';
        out.messages.push({
          id: mid, at: String(o.createdAt || ''), direction: String(o.direction || ''),
          type: (o.media && o.media.length) ? 'mms' : 'sms', status: String(o.status || ''),
          body: body.slice(0, 400),
          with_number: outg ? String(o.to || '') : String(o.from || ''),
          as: numHit ? 'participant' : 'named',
          source: 'webhook'
        });
        if (out.messages.length >= 200) break;
      }
      out.webhook_scanned = logRows.length;
    }
  } catch (eW) { }

  try {
    readTabNormalized_(comms, 'summaries').forEach(function (s) {
      if (!hits(s.participants) && !myCalls[str_(s.callid)]) return;
      out.summaries.push({
        call_id: str_(s.callid), at: str_(s.created),
        direction: str_(s.direction), secs: str_(s.durationsec),
        summary: str_(s.summary)
      });
    });
  } catch (e3) { }

  var newestFirst = function (a, b) { return a.at < b.at ? 1 : -1; };
  out.transcripts.sort(newestFirst); out.messages.sort(newestFirst); out.summaries.sort(newestFirst);
  out.transcripts = out.transcripts.slice(0, 50);
  out.messages = out.messages.slice(0, 100);
  out.summaries = out.summaries.slice(0, 50);
  return { status: 200, data: out };
};
