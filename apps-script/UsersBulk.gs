/** Every pass: no mail ever, idempotent, every skip reported by name; the DSP pass writes the columns clientUserCreate writes. */

function bulkStatusWanted_(status) {
  var s = String(status || '').trim().toLowerCase();
  if (s === 'on leave' || s === 'offboarding' || s === 'archived' ||
      s === 'away' || s === 'off') return false;
  return true;   // active, pending, blank and every unmapped word = "Other"
}

function bulkLoginOf_(email, phone) {
  var login = String(email || '').trim().toLowerCase();
  if (login.indexOf('@') !== -1) return login;
  var digits = String(phone || '').replace(/\D+/g, '');
  return digits.length >= 7 ? digits : '';
}


/** Every client becomes a user, through clientUserCreate; idempotent, with every skip reported by name. */
HUB_POLICY.usersFromClients = {
  file: 'UsersBulk.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.usersFromClients = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var rows;
  try { rows = clientsDerived_(user); }
  catch (eR) { return { status: 503, message: 'The clients could not be read — nothing was made.' }; }
  var made = [], already = 0, skipped = [];
  for (var i = 0; i < rows.length; i++) {
    var out = HUB_ACTIONS.clientUserCreate({ client_id: str_(rows[i].id), kind: 'client' }, user);
    if (out && out.status === 200 && out.data && out.data.already) already++;
    else if (out && out.status === 200) made.push(str_(rows[i].name) + ' → ' + str_(out.data && out.data.login));
    else skipped.push(str_(rows[i].name) + ' (' + String(out && out.message).slice(0, 90) + ')');
  }
  hubSysLog_(str_(user.email), 'users_from_clients',
             made.length + ' created, ' + already + ' already, ' + skipped.length + ' skipped',
             { status: 200 });
  return { status: 200, data: { created: made.length, already: already,
                                skipped: skipped.length, created_named: made.slice(0, 60),
                                skipped_named: skipped.slice(0, 60) } };
};


/** Every Active guardian becomes a user; a guardian the roster marks otherwise is skipped by name. */
HUB_POLICY.usersFromGuardians = {
  file: 'UsersBulk.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.usersFromGuardians = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var rows;
  try { rows = clientsDerived_(user); }
  catch (eR) { return { status: 503, message: 'The clients could not be read — nothing was made.' }; }
  // a guardian the roster marks anything but Active (or a fresh "Other") is left alone
  var rosterStatus = {};
  try {
    withoutIspClients_(peopleMerged_(listRows_('people', {}))).forEach(function (p) {
      var key = String(p.name || '').trim().toLowerCase();
      if (key) rosterStatus[key] = String(p.status || '');
    });
  } catch (eP) {}
  var made = [], already = 0, skipped = [];
  for (var i = 0; i < rows.length; i++) {
    var gname = str_(rows[i].guardianName) || str_(rows[i].guardian_name);
    if (!gname || gname.toLowerCase() === 'self') continue;
    var known = rosterStatus[gname.trim().toLowerCase()];
    if (known !== undefined && !bulkStatusWanted_(known)) {
      skipped.push(gname + ' (roster says ' + known + ')');
      continue;
    }
    var out = HUB_ACTIONS.clientUserCreate({ client_id: str_(rows[i].id), kind: 'guardian' }, user);
    if (out && out.status === 200 && out.data && out.data.already) already++;
    else if (out && out.status === 200) made.push(gname + ' → ' + str_(out.data && out.data.login));
    else skipped.push(gname + ' (' + String(out && out.message).slice(0, 90) + ')');
  }
  hubSysLog_(str_(user.email), 'users_from_guardians',
             made.length + ' created, ' + already + ' already, ' + skipped.length + ' skipped',
             { status: 200 });
  return { status: 200, data: { created: made.length, already: already,
                                skipped: skipped.length, created_named: made.slice(0, 60),
                                skipped_named: skipped.slice(0, 60) } };
};


/* IDENTITY — phone, then name key (middle initial dropped); a near name is reported for a person to settle, never folded */

function bulkNameKey_(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function bulkNameKeyNoMiddle_(v) {
  var parts = String(v || '').toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(String);
  if (parts.length >= 3) {
    parts = parts.filter(function (w, i) { return i === 0 || i === parts.length - 1 || w.length > 1; });
  }
  return parts.join('');
}

function bulkPhoneKey_(v) {
  var d = String(v || '').replace(/\D+/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

function bulkNameRatio_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  var la = a.length, lb = b.length;
  var prev = [], cur = [], i, j;
  for (j = 0; j <= lb; j++) prev[j] = j;
  for (i = 1; i <= la; i++) {
    cur[0] = i;
    for (j = 1; j <= lb; j++) {
      var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (j = 0; j <= lb; j++) prev[j] = cur[j];
  }
  var dist = prev[lb], max = Math.max(la, lb);
  return max ? (max - dist) / max : 0;
}

/** Close enough to be worth a human's eye, not close enough to act on. */
var BULK_NEAR_RATIO = 0.88;

function bulkIdentityIndex_(rows) {
  var idx = { login: {}, nameKey: {}, noMiddle: {}, phone: {}, names: [] };
  (rows || []).forEach(function (u) {
    var mail = str_(u.email).toLowerCase();
    if (mail) idx.login[mail] = str_(u.displayname) || mail;
    var disp = str_(u.displayname);
    if (disp) {
      var k = bulkNameKey_(disp);
      var nm = bulkNameKeyNoMiddle_(disp);
      if (k) { idx.nameKey[k] = disp; idx.names.push({ key: k, name: disp }); }
      if (nm) idx.noMiddle[nm] = disp;
    }
    var ph = bulkPhoneKey_(u.phone);
    if (ph) idx.phone[ph] = disp || ph;
  });
  return idx;
}

/** `how: 'near'` means not sure: a question for the caller, never a match. */
function bulkAlreadyHas_(idx, name, login, phone) {
  var mail = String(login || '').toLowerCase();
  if (mail && idx.login[mail]) return { how: 'login', who: idx.login[mail] };
  var ph = bulkPhoneKey_(phone);
  if (ph && idx.phone[ph]) return { how: 'phone', who: idx.phone[ph] };
  var k = bulkNameKey_(name);
  if (k && idx.nameKey[k]) return { how: 'name', who: idx.nameKey[k] };
  var nm = bulkNameKeyNoMiddle_(name);
  if (nm && idx.noMiddle[nm]) return { how: 'name', who: idx.noMiddle[nm] };
  var best = null, bestR = 0;
  for (var i = 0; i < idx.names.length; i++) {
    var r = bulkNameRatio_(k, idx.names[i].key);
    if (r > bestR) { bestR = r; best = idx.names[i].name; }
  }
  if (best && bestR >= BULK_NEAR_RATIO) return { how: 'near', who: best, ratio: bestR };
  return null;
}


/** The one identity gate every account-creating door asks; `near` is a question, never a match. */
function userIdentityConflict_(name, email, phone) {
  var rows;
  try { rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), USERS_TAB); }
  catch (e) { return null; }   // refusing every creation on a transient read failure is worse
  return bulkAlreadyHas_(bulkIdentityIndex_(rows), str_(name),
                         str_(email).toLowerCase(), str_(phone));
}


/** Blank-only: this runs unattended, so a cell holding anything is never overwritten. Returns cells filled. */
function bulkFillBlanks_(sheet, uHdr, uCol, rowIndexByName, name, p) {
  var at = rowIndexByName[bulkNameKey_(name)];
  if (!at) return { filled: 0, added: 0 };
  var current = sheet.getRange(at, 1, 1, uHdr.length).getValues()[0];
  var filled = 0, added = 0;

  var want = {};
  if (uCol.phone !== -1 && str_(p.phone)) want.phone = str_(p.phone);
  if (uCol.title !== -1 && str_(p.role)) want.title = str_(p.role);
  for (var k in want) {
    var c = uCol[k];
    if (c === -1 || c === undefined) continue;
    if (str_(current[c])) continue;
    sheet.getRange(at, c + 1).setValue(want[k]);
    filled++;
  }

  // a different number is appended to phones (deduped on ten digits); the singular phone is never touched
  if (uCol.phones !== undefined && uCol.phones !== -1 && str_(p.phone)) {
    var incoming = bulkPhoneKey_(p.phone);
    if (incoming && bulkPhoneKey_(current[uCol.phone]) !== incoming) {
      var list = [];
      try { list = JSON.parse(str_(current[uCol.phones]) || '[]'); } catch (eJ) { list = []; }
      if (!Array.isArray(list)) list = [];
      var seen = false;
      for (var n = 0; n < list.length; n++) {
        if (bulkPhoneKey_(list[n] && list[n].number) === incoming) { seen = true; break; }
      }
      if (!seen && list.length < 8) {
        list.push({ label: 'Roster', number: str_(p.phone).slice(0, 40) });
        sheet.getRange(at, uCol.phones + 1).setValue(JSON.stringify(list));
        added++;
      }
    }
  }
  // emails is only ever added to; the sign-in column `email` is never touched by a sync
  if (uCol.emails !== undefined && uCol.emails !== -1) {
    var mail = str_(p.email).trim();
    if (mail && mail.indexOf('@') !== -1 &&
        mail.toLowerCase() !== str_(current[uCol.email]).toLowerCase()) {
      var mails = [];
      try { mails = JSON.parse(str_(current[uCol.emails]) || '[]'); } catch (eM) { mails = []; }
      if (!Array.isArray(mails)) mails = [];
      var known = false;
      for (var m = 0; m < mails.length; m++) {
        if (str_(mails[m]).toLowerCase() === mail.toLowerCase()) { known = true; break; }
      }
      if (!known && mails.length < 8) {
        mails.push(mail.slice(0, 120));
        sheet.getRange(at, uCol.emails + 1).setValue(JSON.stringify(mails));
        added++;
      }
    }
  }
  return { filled: filled, added: added };
}


/** The General roster's DSPs become users, armed with the FIRST_USER_PASSWORD default; one pass at a time. */
HUB_POLICY.usersFromPeople = {
  file: 'UsersBulk.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.usersFromPeople = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var pw = str_(hubProp_('FIRST_USER_PASSWORD')) ||
           str_(hubProp_('ONBOARDING_USER_PASSWORD'));
  if (!pw) {
    return { status: 500, message: 'Set the FIRST_USER_PASSWORD Script Property first — ' +
             'bulk accounts are armed with that default.' };
  }
  // one pass at a time: a twin press or the relay's re-POST must not race the dedup snapshot
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { status: 409, message: 'The pass is already running — check the platform log for its counts.' };
  }
  try {
    var people;
    try { people = withoutIspClients_(peopleMerged_(listRows_('people', {}))); }
    catch (eP) { return { status: 503, message: 'The roster could not be read — nothing was made.' }; }

    var existing = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), USERS_TAB);
    var taken = {};
    existing.forEach(function (u) {
      if (str_(u.email)) taken[str_(u.email).toLowerCase()] = true;
    });
    var idx = bulkIdentityIndex_(existing);
    var near = [];
    var filledCells = 0, addedContexts = 0;
    var rowAt = {};
    existing.forEach(function (u, n) {
      var k = bulkNameKey_(str_(u.displayname));
      if (k && !rowAt[k]) rowAt[k] = n + 2;
    });

    ensureUserProfileColumns_();
    var usersSheet = hubSheet_(USERS_TAB);
    ensureHeader_(usersSheet, ['must_change']);
    var uHdr = usersSheet.getRange(1, 1, 1, usersSheet.getLastColumn()).getValues()[0].map(normKey_);
    var uCol = {};
    ['userid', 'email', 'displayname', 'role', 'salt', 'passhash', 'active', 'createdat',
     'title', 'phone', 'phones', 'emails', 'mustchange', 'types',
     'hometenant'].forEach(function (k) { uCol[k] = uHdr.indexOf(k); });

    var made = [], already = 0, skipped = [], lines = [];
    for (var i = 0; i < people.length; i++) {
      var p = people[i];
      var name = String(p.name || '').trim();
      if (!name) continue;
      if (!bulkStatusWanted_(p.status)) continue;
      var login = bulkLoginOf_(p.email, p.phone);
      var have = bulkAlreadyHas_(idx, name, login, p.phone);
      if (have && have.how === 'near') {
        near.push(name + ' ~ ' + have.who + ' (' + Math.round(have.ratio * 100) + '%)');
        continue;
      }
      if (have) {
        already++;
        try {
          var got = bulkFillBlanks_(usersSheet, uHdr, uCol, rowAt, have.who, p);
          filledCells += got.filled;
          addedContexts += got.added;
        } catch (eFill) {}
        continue;
      }
      if (!login) { skipped.push(name + ' (no e-mail and no phone on the roster)'); continue; }
      if (taken[login]) { skipped.push(name + ' (login "' + login + '" belongs to another account)'); continue; }

      var salt = randomHex_(32);
      var uid = 'USR_' + randomHex_(12).toUpperCase();
      var line = [];
      for (var c = 0; c < uHdr.length; c++) line.push('');
      line[uCol.userid] = uid;
      line[uCol.email] = login;
      line[uCol.displayname] = name;
      line[uCol.role] = 'staff';
      line[uCol.salt] = salt;
      line[uCol.passhash] = hashPassword_(pw, salt);
      line[uCol.active] = 'true';
      line[uCol.createdat] = new Date().toISOString();
      if (uCol.title !== -1) line[uCol.title] = String(p.role || '').trim();
      if (uCol.phone !== -1) line[uCol.phone] = String(p.phone || '').trim();
      if (uCol.mustchange !== -1) line[uCol.mustchange] = 'true';
      if (uCol.types !== -1) line[uCol.types] = 'STAFF';
      if (uCol.hometenant !== -1 && hubAwayTenant_()) line[uCol.hometenant] = tenantStamp_();
      lines.push(line);
      taken[login] = true;
      // the new row joins the index: two roster lines for one human in the same pass must not both land
      var nk = bulkNameKey_(name), nmk = bulkNameKeyNoMiddle_(name), pk = bulkPhoneKey_(p.phone);
      idx.login[String(login).toLowerCase()] = name;
      if (nk) { idx.nameKey[nk] = name; idx.names.push({ key: nk, name: name }); }
      if (nmk) idx.noMiddle[nmk] = name;
      if (pk) idx.phone[pk] = name;
      made.push(name + ' → ' + login);
    }
    bulkAppendRows_(usersSheet, lines, uHdr.length);
    hubSysLog_(str_(user.email), 'users_from_people',
               made.length + ' created, ' + already + ' already (' + filledCells +
               ' blank cell(s) filled, ' + addedContexts + ' extra contact(s) kept), ' + near.length +
               ' look like existing people, ' + skipped.length + ' skipped',
               { status: 200 });
    return { status: 200, data: { created: made.length, already: already,
                                  near: near.length, filled: filledCells, added: addedContexts,
                                  skipped: skipped.length, created_named: made.slice(0, 80),
                                  near_named: near.slice(0, 80),
                                  skipped_named: skipped.slice(0, 80) } };
  } finally {
    lock.releaseLock();
  }
};

/** ONE setValues for the whole pass — appendRow-per-person outran the relay's wait. */
function bulkAppendRows_(sheet, lines, width) {
  if (!lines.length) return;
  var start = sheet.getLastRow() + 1;
  var need = start + lines.length - 1;
  // setValues never grows the grid; a short sheet made it throw.
  if (sheet.getMaxRows() < need) sheet.insertRowsAfter(sheet.getMaxRows(), need - sheet.getMaxRows());
  sheet.getRange(start, 1, lines.length, width).setValues(lines);
}


/** Signed applicants become users; a hit on any known name, login, e-mail or phone reads as already. */
HUB_POLICY.usersFromSigned = {
  file: 'UsersBulk.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.usersFromSigned = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var pw = str_(hubProp_('FIRST_USER_PASSWORD')) ||
           str_(hubProp_('ONBOARDING_USER_PASSWORD'));
  if (!pw) {
    return { status: 500, message: 'Set the FIRST_USER_PASSWORD Script Property first — ' +
             'bulk accounts are armed with that default.' };
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { status: 409, message: 'The pass is already running — check the platform log for its counts.' };
  }
  try {
    var rows;
    try {
      rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), 'recruitment_contracts')
        .filter(function (r) { return str_(r.status).toLowerCase() === 'signed'; });
    } catch (eR) { return { status: 503, message: 'The contracts mirror could not be read — nothing was made.' }; }

    // a hit on any key (name, login, ContactGuard email or phone) reads `already`
    var taken = {}, namesTaken = {}, emailKeys = {}, phoneKeys = {};
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), USERS_TAB).forEach(function (u) {
      if (str_(u.email)) {
        taken[str_(u.email).toLowerCase()] = true;
        contactEmailKeys_(u.email).forEach(function (k) { emailKeys[k] = true; });
      }
      if (str_(u.displayname)) namesTaken[str_(u.displayname).trim().toLowerCase()] = true;
      var upk = contactPhoneKey_(u.phone);
      if (upk && SHARED_LINE_DIGITS.indexOf(upk) === -1) phoneKeys[upk] = true;
    });

    ensureUserProfileColumns_();
    var usersSheet = hubSheet_(USERS_TAB);
    ensureHeader_(usersSheet, ['must_change']);
    var uHdr = usersSheet.getRange(1, 1, 1, usersSheet.getLastColumn()).getValues()[0].map(normKey_);
    var uCol = {};
    ['userid', 'email', 'displayname', 'role', 'salt', 'passhash', 'active', 'createdat',
     'title', 'phone', 'mustchange', 'types',
     'hometenant'].forEach(function (k) { uCol[k] = uHdr.indexOf(k); });

    var made = [], already = 0, skipped = [], lines = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var name = str_(r.candidate);
      // never keyed by row number: the mirror is clearContents-rewritten
      var label = name || str_(r.email) || ('envelope ' + str_(r.signaturerequestid));
      if (name && namesTaken[name.toLowerCase()]) { already++; continue; }
      // every address on the envelope counts: the candidate may have signed second
      var hit = false;
      [str_(r.email)].concat(str_(r.signeremails).split('|')).forEach(function (e) {
        contactEmailKeys_(e).forEach(function (k) { if (emailKeys[k]) hit = true; });
      });
      var pk = contactPhoneKey_(r.phone);
      if (pk && SHARED_LINE_DIGITS.indexOf(pk) === -1 && phoneKeys[pk]) hit = true;
      var login = bulkLoginOf_(r.email, r.phone);
      if (login && taken[login]) hit = true;
      if (hit) { already++; continue; }
      if (!name) { skipped.push(label + ' (no signer name on the contract)'); continue; }
      if (!login) { skipped.push(label + ' (no e-mail and no phone on the signed contract)'); continue; }

      var salt = randomHex_(32);
      var uid = 'USR_' + randomHex_(12).toUpperCase();
      var line = [];
      for (var c = 0; c < uHdr.length; c++) line.push('');
      line[uCol.userid] = uid;
      line[uCol.email] = login;
      line[uCol.displayname] = name;
      line[uCol.role] = 'staff';
      line[uCol.salt] = salt;
      line[uCol.passhash] = hashPassword_(pw, salt);
      line[uCol.active] = 'true';
      line[uCol.createdat] = new Date().toISOString();
      if (uCol.title !== -1) line[uCol.title] = str_(r.title);
      // raw trimmed: hubPhoneE164_ is display-only
      if (uCol.phone !== -1) line[uCol.phone] = str_(r.phone);
      if (uCol.mustchange !== -1) line[uCol.mustchange] = 'true';
      if (uCol.types !== -1) line[uCol.types] = 'STAFF';
      if (uCol.hometenant !== -1 && hubAwayTenant_()) line[uCol.hometenant] = tenantStamp_();
      lines.push(line);
      taken[login] = true;
      namesTaken[name.toLowerCase()] = true;
      contactEmailKeys_(r.email).forEach(function (k) { emailKeys[k] = true; });
      if (pk && SHARED_LINE_DIGITS.indexOf(pk) === -1) phoneKeys[pk] = true;
      made.push(name + ' → ' + login);
    }
    bulkAppendRows_(usersSheet, lines, uHdr.length);
    hubSysLog_(str_(user.email), 'users_from_signed',
               made.length + ' created, ' + already + ' already, ' + skipped.length + ' skipped',
               { status: 200 });
    return { status: 200, data: { created: made.length, already: already,
                                  skipped: skipped.length, created_named: made.slice(0, 80),
                                  skipped_named: skipped.slice(0, 80) } };
  } finally {
    lock.releaseLock();
  }
};
