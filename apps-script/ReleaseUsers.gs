var RELEASE_FIRST_LOGIN_PREF_KEYS = ['asa-tour-seen', 'asa-playground-intro-seen', 'asa-myworld-intro-seen'];

/** Admin is not enough: an admin must not reset another person's password. */
function releaseMasterOnly_(user) {
  if (!user || user.is_service) return true;
  if (str_(user.role) !== 'admin') return true;
  return !hubIsMaster_(str_(user.email));
}

function releaseFindUser_(uid) {
  var sheet = hubSheet_(USERS_TAB);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('userid');
  for (var r = 1; r < values.length; r++) {
    if (str_(values[r][iId]) === uid) return { sheet: sheet, row: r, values: values, hdr: hdr };
  }
  return null;
}

// The person's preference row.
function releasePrefsFor_(uid) {
  var sheet = prefsSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = (values[0] || []).map(normKey_);
  if (values.length < 2) return { sheet: sheet, row: -1, hdr: hdr, prefs: {}, unreadable: false };
  var iU = hdr.indexOf('userid'), iP = hdr.indexOf('prefs');
  for (var r = values.length - 1; r >= 1; r--) {
    if (str_(values[r][iU]) !== uid) continue;
    try {
      var parsed = JSON.parse(str_(values[r][iP]) || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { sheet: sheet, row: r, hdr: hdr, prefs: parsed, unreadable: false };
      }
    } catch (e) { /* answered below */ }
    return { sheet: sheet, row: r, hdr: hdr, prefs: {}, unreadable: true };
  }
  return { sheet: sheet, row: -1, hdr: hdr, prefs: {}, unreadable: false };
}

// EVERY MARK IS A LIST OF USER IDS, NOT A YES.
function releaseMarkList_(v) {
  if (Array.isArray(v)) return v.map(function (x) { return str_(x); });
  var raw = str_(v);
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(function (x) { return str_(x); });
  } catch (e) { /* a value that is not a list names nobody */ }
  return [];
}

/** True only when THIS person's id is in the list the browser pushed up. */
function releaseMarks_(prefs, uid) {
  var out = {};
  var who = str_(uid);
  RELEASE_FIRST_LOGIN_PREF_KEYS.forEach(function (k) {
    out[k] = who ? releaseMarkList_((prefs || {})[k]).indexOf(who) !== -1 : false;
  });
  return out;
}

// THE MARK IS REWRITTEN, NEVER DELETED.
function releaseClearMarks_(prefs, uid) {
  var who = str_(uid);
  var touched = [];
  RELEASE_FIRST_LOGIN_PREF_KEYS.forEach(function (k) {
    var list = releaseMarkList_(prefs[k]);
    if (prefs[k] === undefined && !list.length) return;
    var kept = list.filter(function (x) { return x !== who; });
    if (kept.length === list.length && prefs[k] !== undefined &&
        str_(prefs[k]) === JSON.stringify(kept)) return;
    prefs[k] = JSON.stringify(kept);
    touched.push(k);
  });
  return touched;
}

// The marks taken off this person, and the release stamped into their blob (PREFS_RELEASED_KEY, Prefs.gs): a…
function releaseClearMarksFor_(uid, stamp) {
  var held = releasePrefsFor_(uid);
  if (held.unreadable) throw new Error('their preference row does not parse, so it was left exactly as it is');
  var touched = releaseClearMarks_(held.prefs, uid);
  held.prefs[PREFS_RELEASED_KEY] = stamp;
  var raw = JSON.stringify(held.prefs);
  if (held.row !== -1) {
    var iP = held.hdr.indexOf('prefs'), iT = held.hdr.indexOf('updatedat');
    if (iP === -1) throw new Error('the preferences tab has no "prefs" column');
    held.sheet.getRange(held.row + 1, iP + 1).setValue(raw);
    if (iT !== -1) held.sheet.getRange(held.row + 1, iT + 1).setValue(stamp);
  } else {
    held.sheet.appendRow([uid, raw, stamp]);
  }
  return touched;
}

// A RELEASE ENDS THE SESSIONS IT REARMS.
function releaseEndSessions_(uid) {
  var out = { ended: 0, complete: false, error: '' };
  try {
    var sheet = hubSheet_(SESSIONS_TAB);
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) { out.complete = true; return out; }
    var hdr = values[0].map(normKey_);
    var iTok = hdr.indexOf('tokenhash'), iUid = hdr.indexOf('userid');
    if (iTok === -1 || iUid === -1) {
      out.error = 'the sessions tab has no token_hash / user_id column';
      return out;
    }
    var cache = null;
    try { cache = CacheService.getScriptCache(); } catch (eC) { cache = null; }
    var iActing = hdr.indexOf('actingrealuserid');
    var ended = [];
    for (var r = values.length - 1; r >= 1; r--) {
      if (str_(values[r][iUid]) !== str_(uid)) continue;
      if (cache) {
        try { cache.remove('sess_' + str_(values[r][iTok])); } catch (eR) { /* the row still goes */ }
      }
      if (iActing !== -1 && str_(values[r][iActing]) && typeof beAnotherLogEnded_ === 'function') {
        beAnotherLogEnded_(str_(values[r][iActing]), str_(uid), 'the account worn was released');
      }
      sheet.deleteRow(r + 1);
      ended.push(str_(values[r][iTok]));
      out.ended++;
    }
    // the acting sessions those sessions started (BeAnother.gs) end with them
    if (typeof beAnotherEndChildren_ === 'function') {
      for (var k = 0; k < ended.length; k++) {
        var kids = beAnotherEndChildren_(ended[k], sheet, 'the account that started it was released');
        if (kids.error) { out.error = kids.error; return out; }
        out.ended += kids.ended;
      }
    }
    out.complete = true;
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  return out;
}

// TEST MODE, READ AS WHAT IT IS — on, off, or unknown.
function releaseTestMode_() {
  try {
    if (typeof hubTestModeOn_ !== 'function') throw new Error('the test-mode reader is not loaded');
    return { word: hubTestModeOn_() ? 'on' : 'off', readable: true, error: '' };
  } catch (e) {
    return { word: 'unknown', readable: false, error: String((e && e.message) || e) };
  }
}

HUB_POLICY.releaseUserStatus = {
  file: 'ReleaseUsers.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  params: { user_id: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.releaseUserStatus = function (payload, user) {
  if (releaseMasterOnly_(user)) return hubDenied_();
  var uid = str_(payload.user_id);
  var found = releaseFindUser_(uid);
  if (!found) return { status: 404, message: 'No user "' + uid + '".' };
  var hdr = found.hdr, row = found.values[found.row];
  var at = function (name) { var i = hdr.indexOf(name); return i === -1 ? '' : str_(row[i]); };
  var types = (typeof userTypesFromRaw_ === 'function') ? userTypesFromRaw_(at('types')).types : [];
  var prefs = releasePrefsFor_(uid);
  var inactive = at('active').toLowerCase() !== 'true';
  var mustChange = at('mustchange').toLowerCase() === 'true';
  var email = at('email');

  // WOULD THE LETTER REACH THEM — said on the card, before the press.
  var mode = releaseTestMode_();
  var reach;
  if (!mode.readable) {
    reach = { goes: false, blocked_by: 'test_mode_unreadable',
              why: ['the test-mode switch could not be read (' + mode.error + ') — nothing may be sent ' +
                    'until it can, so a release is refused'] };
  } else if (email.indexOf('@') === -1) {
    reach = { goes: false, blocked_by: 'no_mailbox',
              why: ['the account signs in with a number, so there is no mailbox for the letter'] };
  } else {
    reach = (typeof commReleaseInviteReach_ === 'function')
      ? commReleaseInviteReach_(email)
      : { goes: false, blocked_by: 'no_door', why: ['the release lane is not loaded'] };
  }

  var willClear = [
    'password reset to a new random temporary password, named only in the letter',
    'the password-change gate armed for the next sign-in',
    'the last-login record, so sign-in is treated as the first one',
    'every session they have open — ended at the backend, so their next action asks them to sign in',
    'the welcome-tour mark — the tour runs again',
    'the playground-intro mark — the explainer runs again',
    'the my-world welcome mark — its sequence runs again'
  ];
  // Reactivation belongs in the list the master reads, not only in a pill above the button: a blocked account is an…
  if (inactive) {
    willClear.unshift('the account is reactivated — a blocked sign-in works again');
  }
  return { status: 200, data: {
    user_id: uid,
    email: email,
    display_name: at('displayname'),
    role: at('role'),
    types: types,
    /* folded through HUB_BADGE_FOLLOWS so a badge standing in for DIRECTOR previews what it will be shown; role excluded */
    director: ((typeof userBadgesWorn_ === 'function')
      ? userBadgesWorn_(at('types'), '') : types).indexOf('DIRECTOR') !== -1,
    active: !inactive,
    armed: !!at('passhash'),
    must_change: mustChange,
    last_login: at('lastlogin'),
    released_at: at('releasedat'),
    // A PASSWORD OF THEIR OWN: they signed in, or the gate stands down on a password that is set.
    signed_in_before: !!at('lastlogin') || (!!at('passhash') && !mustChange),
    /* null when the preference row does not parse: unknown, not "not seen" */
    marks: prefs.unreadable ? null : releaseMarks_(prefs.prefs, uid),
    marks_error: prefs.unreadable ? 'their preference row does not parse' : '',
    test_mode: mode.word,
    test_mode_error: mode.error,
    /* true when the letter would reach nobody; `blocked_by` names why */
    sending_holds: !reach.goes,
    blocked_by: reach.blocked_by,
    hold_why: reach.why,
    will_clear: willClear
  } };
};

HUB_POLICY.releaseUser = {
  // lane tool, not write: on the write tier a cold run past ~8s answers {accepted:true} and the screen reads as dead
  file: 'ReleaseUsers.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin'],
  params: { user_id: { required: true, type: 'string' },
            /* the deliberate second answer to a refusal — never a default */
            anyway: { required: false, type: 'boolean' },
            /* one per press, minted by the screen: a re-sent press is the same letter */
            press_id: { required: false, type: 'string' } },
  invalidates: [], emits: ['emailSend', 'smsSend']
};
/** The four cells a release must write; a tab missing any of them is refused whole. */
var RELEASE_REQUIRED_COLUMNS = ['salt', 'passhash', 'mustchange', 'lastlogin'];

// THE REARM, ALL OR NOTHING.
function releaseRearm_(sheet, r, hdr, rowValues, writes) {
  var done = [];
  try {
    for (var i = 0; i < writes.length; i++) {
      var idx = hdr.indexOf(writes[i].name);
      if (idx === -1) continue;
      var before = rowValues[idx];
      sheet.getRange(r, idx + 1).setValue(writes[i].value);
      done.push({ col: idx + 1, before: before === undefined || before === null ? '' : before });
    }
    return { ok: true, error: '', restored: true };
  } catch (e) {
    var restored = true;
    for (var j = done.length - 1; j >= 0; j--) {
      try { sheet.getRange(r, done[j].col).setValue(done[j].before); } catch (eB) { restored = false; }
    }
    return { ok: false, error: String((e && e.message) || e), restored: restored };
  }
}

/** The invite, asked of the one door. Never throws: a throw is an answer that nothing left. */
function releaseTellInvite_(person, idem) {
  try {
    if (typeof commReleaseInviteTell_ !== 'function') {
      return { sent: 0, held: 0, deduplicated: 0, legs: [], held_reason: '', situation_state: '',
               why: ['the release lane is not loaded'], state: 'no_door' };
    }
    return commReleaseInviteTell_(person, idem);
  } catch (e) {
    return { sent: 0, held: 0, deduplicated: 0, legs: [], held_reason: '', situation_state: '',
             why: ['the invite could not be built: ' + String((e && e.message) || e)], state: 'no_door' };
  }
}

/** WHICH BRAKE stopped the letter, in one word the screen has a sentence for. */
function releaseBrakeOf_(told) {
  if (told.state === 'not_asked') return 'test_mode_unreadable';
  if ((told.sent > 0 || told.deduplicated > 0) && !(told.named_sent > 0 || told.named_deduplicated > 0)) {
    return 'password_not_named';
  }
  if (told.state === 'wordless') return 'situation_' + (str_(told.situation_state) || 'off');
  if (told.held) return str_(told.held_reason) || 'held';
  if (told.state === 'no_door') return 'no_door';
  return 'not_delivered';
}

HUB_ACTIONS.releaseUser = function (payload, user) {
  if (releaseMasterOnly_(user)) return hubDenied_();
  var uid = str_(payload.user_id);
  var found = releaseFindUser_(uid);
  if (!found) return { status: 404, message: 'No user "' + uid + '".' };

  // A FRESH RANDOM PASSWORD PER PRESS, never a shared constant: the letter is the only place it is written.
  var tempPw = tempPassword_();

  ensureUserProfileColumns_();
  found = releaseFindUser_(uid); // re-read: the header may have just grown
  var sheet = found.sheet, hdr = found.hdr, r = found.row + 1;
  var rowValues = found.values[found.row];

  // EVERY CELL RESOLVED BEFORE THE FIRST ONE IS WRITTEN — a tab missing one of these used to fail halfway…
  var absent = RELEASE_REQUIRED_COLUMNS.filter(function (c) { return hdr.indexOf(c) === -1; });
  if (absent.length) {
    return { status: 500,
             message: 'The users tab has no "' + absent[0] + '" column, so a release cannot ' +
                      'rearm this account. Nothing was changed.' };
  }

  var email = str_(rowValues[hdr.indexOf('email')]);
  var who = str_(rowValues[hdr.indexOf('displayname')]) || email;
  if (email.indexOf('@') === -1) {
    return { status: 400, message: '"' + who + '" signs in with a number, not an address — there is no mailbox to send the invite to.' };
  }

  var anyway = payload && payload.anyway === true;
  // THE KEY NAMES THE PRESS.
  var pressId = str_(payload && payload.press_id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) ||
                String(Date.now());
  var mode = releaseTestMode_();

  var refuse = function (brake, why, told) {
    var t = told || { held: 0, held_reason: '', legs: [] };
    var lead = brake === 'password_not_named'
      ? 'The password did not reach "' + who + '"'
      : brake === 'already_sent'
        ? 'This press already went to "' + who + '"'
        : 'Nothing reached "' + who + '"';
    try {
      hubSysLog_(str_(user.email), 'release_user_refused',
                 uid + ' — nothing changed; ' + lead + ': ' + why.slice(0, 2).join(' · '),
                 { status: 409 });
    } catch (eL) { /* the refusal still stands */ }
    return { status: 409,
             message: lead + ': ' + why.slice(0, 2).join(' · ') +
                      (brake === 'already_sent' ? '. Nothing was changed by this repeat.'
                                                : '. Nothing was changed — their own password still works.'),
             data: { user_id: uid, email: email, display_name: who, cleared: [], emailed: false,
                     held: t.held > 0, held_reason: str_(t.held_reason), outcome: 'refused',
                     test_mode: mode.word, blocked_by: brake, legs: t.legs || [], why: why } };
  };

  // AN UNREADABLE SWITCH SENDS NOTHING.
  if (!mode.readable && !anyway) {
    return refuse('test_mode_unreadable',
                  ['the test-mode switch could not be read (' + mode.error + '), so nothing may be sent'],
                  null);
  }

  // THE LETTER FIRST, THE CREDENTIAL AFTER.
  var phone = releasePhoneAt_(found.values, found.row, releaseUserCols_(hdr));
  var told = mode.readable
    ? releaseTellInvite_({ email: email, phone: phone, name: who, login: email,
                           password: tempPw, url: mailPlatformUrl_() },
                         'release_' + uid + '_' + pressId)
    : { sent: 0, held: 0, deduplicated: 0, legs: [], held_reason: '', situation_state: '',
        why: ['nothing was asked of the send door: the test-mode switch could not be read (' +
              mode.error + ')'],
        state: 'not_asked' };
  // Rearmed only on a leg that left NOW and whose words name this password.
  var reached = told.named_sent > 0;
  if (!reached && !anyway) {
    if (told.named_deduplicated > 0) {
      return refuse('already_sent', ['its letter left before, naming the password that press made — every ' +
                                     'press makes a new one, so press again to send a fresh letter'], told);
    }
    return refuse(releaseBrakeOf_(told), told.why.length ? told.why : ['the send door answered nothing'], told);
  }

  var now = new Date().toISOString();
  var inactive = str_(rowValues[hdr.indexOf('active')]).toLowerCase() !== 'true';
  var salt = randomHex_(32);
  var writes = [
    { name: 'salt', value: salt },
    { name: 'passhash', value: hashPassword_(tempPw, salt) },
    { name: 'mustchange', value: 'true' },
    // an empty last_login is what sends authLogin down its first-sign-in path
    { name: 'lastlogin', value: '' },
    // the record of when this account was last handed back to its owner
    { name: 'releasedat', value: now }
  ];
  if (inactive) writes.push({ name: 'active', value: 'true' });
  var rearm = releaseRearm_(sheet, r, hdr, rowValues, writes);
  if (!rearm.ok) {
    var lead = reached ? 'The invite reached "' + who + '", but the account could not be rearmed: '
                       : 'The account could not be rearmed: ';
    try {
      hubSysLog_(str_(user.email), 'release_user', uid + ' — rearm failed: ' + rearm.error +
                 (rearm.restored ? ' (every cell put back)' : ' (NOT every cell could be put back)'),
                 { status: 500 });
    } catch (eL2) { /* the answer below still says it */ }
    return { status: 500,
             message: lead + rearm.error + '. ' +
                      (rearm.restored
                        ? 'Every cell was put back, so their own password still works — press Release again.'
                        : 'Some cells could not be put back — check their row before anybody signs in.'),
             data: { user_id: uid, email: email, display_name: who, cleared: [], emailed: reached,
                     outcome: 'rearm_failed', rearm_error: rearm.error, restored: rearm.restored,
                     test_mode: mode.word, legs: told.legs, why: told.why } };
  }

  var cleared = [];
  if (inactive) cleared.push('account reactivated — a blocked sign-in works again');
  cleared.push(reached
    ? 'password reset to a new random temporary password, named only in the letter; password-change gate armed'
    : 'password reset to a new random password nobody was told — they get in with Forgot password on the ' +
      'sign-in page; password-change gate armed');
  cleared.push('last-login record cleared');

  // AFTER THE REARM NOTHING MAY THROW.
  var warnings = [];
  // A LIVE SESSION OUTLIVES THE ROW unless it is ended here: the gate, the tour and the whole first sign-in only…
  var sessions = releaseEndSessions_(uid);
  var ended = sessions.complete ? sessions.ended : null;
  if (!sessions.complete) {
    warnings.push('the open sessions could not be ' +
                  (sessions.ended ? 'all ended (' + sessions.ended + ' were)' : 'read') +
                  ' — any session they hold may still be live: ' + sessions.error);
  } else if (sessions.ended) {
    cleared.push(sessions.ended + ' open session(s) ended at the backend — their next action asks ' +
                 'them to sign in; a copy the relay cached may keep serving read-only views until it expires');
  } else {
    cleared.push('no open session to end — the next sign-in is the first one');
  }
  try {
    var touched = releaseClearMarksFor_(uid, now);
    if (touched.length) {
      cleared.push('welcome marks cleared (' + touched.join(', ') + ') — the sequences run again');
    }
  } catch (eM) {
    warnings.push('the welcome marks could not be cleared — the tour may not run again: ' +
                  String((eM && eM.message) || eM));
  }

  // SENT, ALREADY SENT, HELD AND NOTHING-SENT are the four answers, and only the last two can follow a rearm — and…
  var outcome = told.sent ? 'sent' : (told.deduplicated ? 'already_sent'
                                    : (told.held ? 'held' : 'nothing_sent'));
  try {
    hubSysLog_(str_(user.email), 'release_user',
               uid + ' — rearmed, ' + told.sent + ' sent · ' + told.held + ' held (' + who + ')' +
               (anyway && !reached ? ' · rearmed anyway' : '') +
               (told.why.length ? ' · ' + told.why.slice(0, 2).join(' · ') : '') +
               (warnings.length ? ' · ' + warnings.join(' · ') : ''),
               { status: 200 });
  } catch (eL3) { /* the release happened; its log line is not worth a 500 */ }
  return { status: 200,
           message: reached
             ? ''
             : 'The account was rearmed as you chose, and nothing reached "' + who + '": ' +
               (told.why.slice(0, 2).join(' · ') || 'the send door answered nothing') +
               '. Nobody knows the new password — they get in with Forgot password on the sign-in page.',
           data: {
    user_id: uid,
    email: email,
    display_name: who,
    cleared: cleared,
    emailed: reached,
    held: told.held > 0,
    // WHICH BRAKE, not "the mockup" for all of them: an opt-out and the quiet window are held too, and no switch…
    held_reason: str_(told.held_reason),
    outcome: outcome,
    test_mode: mode.word,
    released_anyway: !!(anyway && !reached),
    /* null when the sessions could not all be ended — unknown, never zero */
    sessions_ended: ended,
    warnings: warnings,
    legs: told.legs,
    why: told.why
  } };
};

/* APP RELEASE ANNOUNCEMENT — only released accounts whose badges open the app hear about it */

var APP_RELEASE_ANNOUNCED_PROP = 'APP_RELEASE_ANNOUNCED';
var APP_RELEASE_TIME_BUDGET_MS = 240000;   // stop early, answer, resume

/** Type badges, the role uppercased, and whatever a worn badge stands in for (HUB_BADGE_FOLLOWS). */
function releaseAnnounceTokens_(typesRaw, role) {
  var out = {};
  var t = (typeof userBadgesWorn_ === 'function')
    ? userBadgesWorn_(typesRaw, role)
    : ((typeof userTypesFromRaw_ === 'function') ? userTypesFromRaw_(typesRaw).types : []);
  t.forEach(function (x) { out[str_(x).toUpperCase()] = true; });
  var r = str_(role).toUpperCase();
  if (r) out[r] = true;
  return out;
}

function releaseUserCols_(uHdr) {
  var col = function (n) { return uHdr.indexOf(n); };
  return { active: col('active'), email: col('email'), name: col('displayname'),
           hidden: col('systemhidden'), types: col('types'), role: col('role'),
           den: col('appdenials'), uid: col('userid'), rel: col('releasedat'),
           /* either column may be the only one holding a number */
           phone: col('phone'), phones: col('phones') };
}

function releasePhoneAt_(values, r, c) {
  var raw = '';
  if (c.phone !== -1) raw = str_(values[r][c.phone]);
  if (!raw && c.phones !== -1) {
    // `phones` is labelled JSON; splitting it on commas handed the text a fragment of JSON as a number
    var list = (typeof profileParsePhones_ === 'function')
      ? profileParsePhones_(values[r][c.phones])
      : str_(values[r][c.phones]).split(/[,;]+/).map(function (n) { return { number: n }; });
    for (var i = 0; i < list.length && !raw; i++) raw = str_(list[i] && list[i].number);
  }
  return str_(raw).trim();
}

// WHOSE BADGES OPEN THIS APP — the access question, and only that.
function appReleaseMatches_(uValues, r, c, appId, badgeList) {
  if (!badgeList || !badgeList.length) return '';
  var uid = c.uid === -1 ? '' : str_(uValues[r][c.uid]);
  if (!uid) return '';
  if (str_(uValues[r][c.active]).toLowerCase() !== 'true') return '';
  var email = str_(uValues[r][c.email]);
  if (email.indexOf('@') === -1) return '';
  if (c.hidden !== -1 && str_(uValues[r][c.hidden]).toLowerCase() === 'true') return '';
  if (c.den !== -1) {
    try {
      var den = JSON.parse(str_(uValues[r][c.den]) || '[]');
      if (Array.isArray(den) && den.indexOf(appId) !== -1) return '';
    } catch (eD) { /* an unreadable denial list never widens access */ }
  }
  var mine = releaseAnnounceTokens_(uValues[r][c.types], uValues[r][c.role]);
  for (var b = 0; b < badgeList.length; b++) { if (mine[badgeList[b]]) return email.toLowerCase(); }
  return '';
}

// WHO IS TOLD: a RELEASED account — `released_at` on the row, stamped only by the master's own Release press.
function appReleaseReleased_(uValues, r, c) {
  if (c.rel === -1) return false;
  return !!str_(uValues[r][c.rel]);
}

// WHO HAS ALREADY BEEN TOLD ABOUT THIS APP — read from `app_release_log`, the record of the letters themselves, so…
function appReleaseAlreadyTold_() {
  var out = { map: {}, declined: {}, readable: false, error: '' };
  try {
    var sheet = hubTabEnsure_('app_release_log',
                              ['id', 'at', 'app_id', 'title', 'user_id', 'email', 'mode', 'sent']);
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) { out.readable = true; return out; }
    var hdr = values[0].map(normKey_);
    var iApp = hdr.indexOf('appid'), iUid = hdr.indexOf('userid'),
        iMail = hdr.indexOf('email'), iSent = hdr.indexOf('sent'),
        iMode = hdr.indexOf('mode'), iAt = hdr.indexOf('at');
    if (iApp === -1 || iSent === -1) {
      out.error = 'the app_release_log tab has no app_id / sent column';
      return out;
    }
    var noteDeclined = function (key, atMs) {
      if (!out.declined[key] || out.declined[key] < atMs) out.declined[key] = atMs;
    };
    for (var r = 1; r < values.length; r++) {
      var app = str_(values[r][iApp]);
      var uid = iUid === -1 ? '' : str_(values[r][iUid]);
      var mail = iMail === -1 ? '' : str_(values[r][iMail]).toLowerCase();
      if (str_(values[r][iSent]).toLowerCase() !== 'true') {
        if (iMode === -1 || iAt === -1 || str_(values[r][iMode]).toLowerCase() !== 'declined') continue;
        var atMs = values[r][iAt] ? new Date(values[r][iAt]).getTime() : NaN;
        if (isNaN(atMs)) continue;
        if (app && uid) noteDeclined(app + '|' + uid, atMs);
        if (app && mail) noteDeclined(app + '|' + mail, atMs);
        continue;
      }
      if (app && uid) out.map[app + '|' + uid] = true;
      if (app && mail) out.map[app + '|' + mail] = true;
    }
    out.readable = true;
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  return out;
}

function appReleaseWasTold_(told, appId, uid, email) {
  return !!(told[appId + '|' + str_(uid)] || told[appId + '|' + str_(email).toLowerCase()]);
}

// A PERSON'S OWN STOP SETTLES THEM FOR THE DEBT BEING CARRIED: declined for this app at or after `sinceMs`.
function appReleaseDeclinedSince_(declined, appId, uid, email, sinceMs) {
  if (!declined || isNaN(sinceMs)) return false;
  var at = Math.max(Number(declined[appId + '|' + str_(uid)]) || 0,
                    Number(declined[appId + '|' + str_(email).toLowerCase()]) || 0);
  return at > 0 && at >= sinceMs;
}

// ONE ANSWER PER PERSON, never two: sent, already sent, then the hold that can still end — the configuration, the…
function appReleaseLetterOut_(who, app) {
  var told = (typeof commReleaseAppTell_ === 'function')
    ? commReleaseAppTell_(who, app,
                          'apprel_' + str_(app && app.id).slice(0, 24) + '_' +
                          str_(who && who.uid).slice(0, 24))
    : { sent: 0, held: 0, deduplicated: 0, legs: [], why: ['the release lane is not loaded'], state: 'no_door' };
  var outcome = told.sent > 0 ? 'sent'
    : (told.deduplicated || 0) > 0 ? 'already_sent'
    : told.held_dial ? 'dial'
    : told.held_quiet ? 'quiet'
    : told.unchecked ? 'unchecked'
    : told.declined ? 'declined'
    : told.held ? 'dial'
    : (told.state === 'wordless' || told.state === 'no_door') ? 'silenced'
    : 'failed';
  // The brake that held it, by name — the screen counts a switch's holds by it.
  var heldReason = (outcome === 'sent' || outcome === 'already_sent' || !(told.held > 0))
    ? '' : (str_(told.held_reason) || 'held');
  return { sent: outcome === 'sent', deduplicated: outcome === 'already_sent',
           redirected: outcome === 'dial', outcome: outcome, held_reason: heldReason,
           legs: told.legs || [], why: told.why || [] };
}

// The row a letter leaves in app_release_log, by its one answer: the quiet window is `held_quiet`, test mode…
function appReleaseLogMode_(res, mode) {
  if (res.sent || res.outcome === 'failed') return mode;
  if (res.deduplicated) return 'already_sent';
  if (res.outcome === 'quiet') return 'held_quiet';
  if (res.redirected) {
    var brake = str_(res.held_reason);
    return (!brake || brake === 'rehearsal' || brake === 'held') ? 'rehearsal' : 'held_' + brake;
  }
  return res.outcome || mode;
}

/** Counts one letter a switch held under the brake that held it. */
function appReleaseHeldBy_(map, res) {
  var k = str_(res && res.held_reason) || 'held';
  map[k] = (map[k] || 0) + 1;
  return map;
}

/** The counts one run keeps; `silenced` is the sentence that stopped it, if any. */
function appReleaseTally_() {
  return { sent: 0, already_sent: 0, held_dial: 0, held_quiet: 0, declined: 0, unchecked: 0,
           failed: 0, silenced: '' };
}

function appReleaseCount_(tally, res) {
  var k = res.outcome;
  if (k === 'sent') tally.sent++;
  else if (k === 'already_sent') tally.already_sent++;
  else if (k === 'dial') tally.held_dial++;
  else if (k === 'quiet') tally.held_quiet++;
  else if (k === 'declined') tally.declined++;
  else if (k === 'unchecked') tally.unchecked++;
  else if (k === 'silenced') tally.silenced = str_(res.why && res.why[0]) || 'the situation went silent';
  else tally.failed++;
}

// EVERYBODY WHO CAN STILL BE TOLD WAS TOLD — the once-per-app stamp's rule.
function appReleaseComplete_(tally, toldBefore) {
  return !tally.silenced && !tally.held_dial && !tally.held_quiet && !tally.unchecked &&
         !tally.failed && (tally.sent + tally.already_sent + (Number(toldBefore) || 0)) > 0;
}

/** The badges the access matrix opens this app to; throws when the matrix cannot be read. */
function appReleaseBadgesFor_(appId) {
  var bValues = appBadgeSheet_().getDataRange().getValues();
  var bHdr = (bValues[0] || []).map(normKey_);
  var bI = bHdr.indexOf('appid'), bB = bHdr.indexOf('badges');
  if (bI === -1 || bB === -1) throw new Error('the access matrix has no app_id / badges header');
  for (var br = 1; br < bValues.length; br++) {
    if (str_(bValues[br][bI]) === appId) {
      return userTypesFromRaw_(bValues[br][bB]).types
        .map(function (x) { return str_(x).toUpperCase(); });
    }
  }
  return [];
}

// ONTO THE MORNING LIST (Rpc.gs hubQuietOwe_): one entry per app, never one per person — a night of badge saves…
function appReleaseOweMorning_(appId, badges, name, tagline, whole, since) {
  if (typeof hubQuietOwe_ !== 'function') return false;
  var data = {
    app_id: appId, badges: (badges || []).map(function (b) { return str_(b).toUpperCase(); }),
    whole: !!whole, name: str_(name), tagline: str_(tagline),
    since: str_(since) || new Date().toISOString()
  };
  try {
    if (!hubQuietOwe_('app_release', appId, data)) return false;
    return appReleaseOwedFold_(appId, data);
  } catch (e) { return false; }
}

/** Folds `data` into the app's entry on the list; true when the entry holds it. */
function appReleaseOwedFold_(appId, data) {
  if (typeof hubQuietOwedName_ !== 'function' || typeof hubQuietLocked_ !== 'function') return false;
  var name = hubQuietOwedName_('app_release', appId);
  return !!hubQuietLocked_(function () {
    try {
      var raw = hubQuietOwedGet_(name);
      // taken by a pass between the owe and this read: put this debt back, the pass skips everybody it already told
      var entry = raw ? JSON.parse(raw)
                      : { lane: 'app_release', key: appId, at: new Date().toISOString(), data: {} };
      var old = entry.data || {};
      var badges = (Array.isArray(old.badges) ? old.badges : []).slice();
      (data.badges || []).forEach(function (b) { if (badges.indexOf(b) === -1) badges.push(b); });
      var since = [str_(old.since), str_(data.since)].filter(String).sort()[0] || str_(data.since);
      var merged = {
        app_id: appId, badges: badges, whole: !!(old.whole || data.whole),
        name: str_(data.name) || str_(old.name), tagline: str_(data.tagline) || str_(old.tagline),
        since: since
      };
      if (raw && JSON.stringify(merged) === JSON.stringify(old)) return true;
      entry.data = merged;
      var body = JSON.stringify(entry);
      // the same size the list itself keeps for this lane
      var limit = (typeof hubQuietOwedLimits_ === 'function') ? hubQuietOwedLimits_('app_release').bytes
        : ((typeof HUB_QUIET_OWED_BYTES !== 'undefined') ? HUB_QUIET_OWED_BYTES : 0);
      if (limit && body.length > limit) return false;
      hubQuietOwedSet_(name, body);
      return true;
    } catch (e) { return false; }
  });
}

/** The quiet window's own words and its last minute, from Rpc.gs's one declaration. */
function appReleaseQuietWords_() {
  return (typeof hubQuietWords_ === 'function') ? hubQuietWords_() : 'the quiet hours';
}

function appReleaseQuietEnd_() {
  return (typeof HUB_QUIET_TO !== 'undefined' && HUB_QUIET_TO) ? String(HUB_QUIET_TO) : 'the end of the quiet hours';
}

/** The app situation's state, asked once, with its sentence. */
function appReleaseSituationNow_() {
  if (typeof commReleaseSituationRead_ !== 'function') {
    return { state: 'unreadable', why: 'the release lane is not loaded — nobody was written to' };
  }
  var read = commReleaseSituationRead_(COMM_RELEASE_APP_SITUATION);
  return { state: read.state,
           why: read.state === 'on' ? '' : commReleaseSituationWhy_(COMM_RELEASE_APP_SITUATION, read) };
}

// The told-log's rows in one write; answers whether they landed.
function appReleaseLogRows_(rows) {
  if (!rows.length) return true;
  try {
    var keys = ['id', 'at', 'app_id', 'title', 'user_id', 'email', 'mode', 'sent'];
    var sheet = hubTabEnsure_('app_release_log', keys);
    ensureHeader_(sheet, keys);
    var hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h).trim(); });
    var out = rows.map(function (o) {
      return hdr.map(function (k) { return o[k] != null ? o[k] : ''; });
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, out.length, hdr.length).setValues(out);
    return true;
  } catch (eLg) {
    try {
      hubSysLog_('asa-hub:app-release', 'app_release_log_unwritten',
                 rows.length + ' row(s) of app_release_log could NOT be written (' +
                 String((eLg && eLg.message) || eLg).slice(0, 160) +
                 ') — whoever they name is not known as told, and may be written to again', { status: 500 });
    } catch (eL) { /* the caller's answer says it too */ }
    return false;
  }
}

HUB_POLICY.appReleaseAnnounce = {
  // lane tool for the releaseUser reason: the answer is the product
  file: 'ReleaseUsers.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: ['emailSend', 'smsSend']
};
HUB_ACTIONS.appReleaseAnnounce = function (payload, user) {
  if (releaseMasterOnly_(user)) return hubDenied_();
  var appId = str_(payload.app_id);
  if (!appId) return { status: 400, message: 'Which app? app_id is required.' };
  var title = str_(payload.title) || appId;
  var objective = str_(payload.objective);
  var resume = Math.max(0, Number(payload.resume) || 0);
  // the deliberate "send it once more": past the once-per-app stamp AND past who was already told
  var again = payload.again === true;
  // what earlier pages of this same run left owed, and whom they told — the stamp is about the whole run, and one…
  var outstanding = Math.max(0, Number(payload.outstanding) || 0);
  var toldBefore = Math.max(0, Number(payload.told_before) || 0);

  var props = PropertiesService.getScriptProperties();
  var seen = {};
  try { seen = JSON.parse(str_(props.getProperty(APP_RELEASE_ANNOUNCED_PROP)) || '{}'); } catch (eS) { seen = {}; }
  // THE STAMP NO LONGER REFUSES THE PRESS.
  var announcedBefore = str_(seen[appId]);

  // no matrix row (or an empty one) means the master's alone: announce nothing
  var badgeList = appReleaseBadgesFor_(appId);
  if (!badgeList.length) {
    return { status: 400, message: 'The ' + title + ' app has no badges on the access matrix — ' +
             'nobody but the master can open it yet. Give it badges first; the release then announces itself.' };
  }

  // ONE QUESTION TO THE BOOK BEFORE ANYBODY IS WRITTEN TO.
  var sitNow = appReleaseSituationNow_();
  var refuseNotRun = function (why, brake) {
    hubSysLog_(str_(user.email), 'app_release_announce', appId + ' — not run: ' + why, { status: 409 });
    return { status: 409,
             message: 'The ' + title + ' announcement was not sent: ' + why + '.',
             data: { app_id: appId, title: title, situation_state: sitNow.state, blocked_by: brake } };
  };
  if (sitNow.state !== 'on' && sitNow.state !== 'unreadable') {
    return refuseNotRun(sitNow.why, 'situation_' + sitNow.state);
  }

  // THE QUIET WINDOW HOLDS IT UNTIL THE MORNING, and says so before anything runs.
  if (typeof hubQuietAt_ === 'function' && hubQuietAt_()) {
    if (again) {
      return { status: 409,
               message: 'Inside the quiet window (' + appReleaseQuietWords_() + ') nothing reaches a ' +
                        'person, and a second sending to everybody cannot wait for the morning. ' +
                        'Nobody was written to — send it again after ' + appReleaseQuietEnd_() + '.' };
    }
    var keptNight = appReleaseOweMorning_(appId, badgeList, title, objective, true);
    hubSysLog_(str_(user.email), 'app_release_announce',
               appId + ' — inside the quiet window: ' +
               (keptNight ? 'owed for the first pass after ' + appReleaseQuietEnd_()
                          : 'the morning list could NOT keep it') +
               ' — nobody was written to', { status: keptNight ? 200 : 409 });
    if (!keptNight) {
      return { status: 409,
               message: 'Inside the quiet window (' + appReleaseQuietWords_() + ') nothing reaches a ' +
                        'person, and the morning list could not keep this announcement. Nobody was ' +
                        'written to — send it again after ' + appReleaseQuietEnd_() + '.' };
    }
    return { status: 200, data: {
      app_id: appId, title: title, quiet_owed: true,
      sent: 0, held: 0, failed: 0, done: true, resume: 0
    } };
  }
  if (sitNow.state === 'unreadable') return refuseNotRun(sitNow.why, 'situation_unreadable');

  // AN UNREADABLE TEST-MODE SWITCH WRITES NOBODY.
  var modeNow = releaseTestMode_();
  if (!modeNow.readable) {
    return refuseNotRun('the test-mode switch could not be read (' + modeNow.error + '), so nobody may ' +
                        'be written to — press again once it reads', 'test_mode_unreadable');
  }

  // NOBODY HEARS THE SAME APP TWICE — the screen promises it, and the button is the one path that never asked.
  var told = appReleaseAlreadyTold_();
  if (!told.readable && !again) {
    return { status: 409, message: 'The app_release_log could not be read (' + told.error + '), so who has ' +
             'been told about ' + title + ' is unknown. Nothing was sent — press again once it reads.' };
  }

  var url = (typeof mailPlatformUrl_ === 'function') ? mailPlatformUrl_() : '';
  // a workspace whose users tab never grew the profile columns would otherwise answer "eligible: 0, sent: 0, done…
  ensureUserProfileColumns_();
  var uSheet = hubSheet_(USERS_TAB);
  var uValues = uSheet.getDataRange().getValues();
  var uHdr = uValues[0].map(normKey_);
  var c = releaseUserCols_(uHdr);

  // one letter per address; on a resume, rows already ridden refill the seen-set unsent
  var sentTo = {};
  var started = Date.now();
  var eligible = 0, matched = 0, notReleased = 0, alreadyTold = 0;
  var tally = appReleaseTally_();
  // the letters a switch held, counted by the brake that held each
  var heldBy = {};
  var stoppedAt = 0;
  var logRows = [];
  for (var r = 1; r < uValues.length; r++) {
    var email = appReleaseMatches_(uValues, r, c, appId, badgeList);
    if (!email || sentTo[email]) continue;
    sentTo[email] = true;
    matched++;
    // MATCHED AND ADDRESSED ARE TWO NUMBERS: a badge holder who was never released is counted, not written to.
    if (!appReleaseReleased_(uValues, r, c)) { notReleased++; continue; }
    eligible++;
    if (resume && r < resume) continue;
    var uid = str_(uValues[r][c.uid]);
    if (!again && appReleaseWasTold_(told.map, appId, uid, email)) { alreadyTold++; continue; }
    if (Date.now() - started > APP_RELEASE_TIME_BUDGET_MS) { stoppedAt = r; break; }
    var res = appReleaseLetterOut_(
      { email: email, phone: releasePhoneAt_(uValues, r, c),
        name: str_(uValues[r][c.name]), uid: uid },
      { id: appId, title: title, objective: objective, url: url });
    // A HELD LETTER IS NOT A REFUSED ONE, an already-sent one is neither, and not every hold is the dial: each…
    appReleaseCount_(tally, res);
    if (res.outcome === 'dial') appReleaseHeldBy_(heldBy, res);
    if (res.outcome === 'silenced') break;
    logRows.push({ id: 'arl_' + Utilities.getUuid().split('-')[0],
                   at: new Date().toISOString(), app_id: appId, title: title,
                   user_id: uid, email: email,
                   mode: appReleaseLogMode_(res, 'manual'),
                   sent: (res.sent || res.deduplicated) ? 'true' : 'false' });
  }
  var logged = appReleaseLogRows_(logRows);

  var done = !stoppedAt;
  /* A run that crossed into the quiet window owes what it held to the morning. */
  var quietOwed = false;
  if (tally.held_quiet && !again) quietOwed = appReleaseOweMorning_(appId, badgeList, title, objective, true);
  // THE ONCE-PER-APP STAMP MEANS EVERYBODY WHO CAN STILL BE TOLD WAS TOLD: a hold of the dial or the window, an…
  if (done && !outstanding && appReleaseComplete_(tally, alreadyTold + toldBefore)) {
    seen[appId] = new Date().toISOString();
    props.setProperty(APP_RELEASE_ANNOUNCED_PROP, JSON.stringify(seen));
  }
  hubSysLog_(str_(user.email), 'app_release_announce',
             appId + ' — ' + tally.sent + ' letter(s) sent' +
             (alreadyTold ? ', ' + alreadyTold + ' already told' : '') +
             (tally.already_sent ? ', ' + tally.already_sent + ' already sent' : '') +
             (tally.held_dial ? ', ' + tally.held_dial + ' held' : '') +
             (tally.held_quiet ? ', ' + tally.held_quiet + ' held by the quiet window' +
               (quietOwed ? ' (owed to the morning list)' : '') : '') +
             (tally.declined ? ', ' + tally.declined + ' declined (opted out)' : '') +
             (tally.unchecked ? ', ' + tally.unchecked + ' not written to (opt-out list unreadable)' : '') +
             (tally.failed ? ', ' + tally.failed + ' refused' : '') +
             (tally.silenced ? ', stopped: ' + tally.silenced : '') +
             (logged ? '' : ', the told-log could NOT be written') +
             (done ? '' : ', paused at row ' + stoppedAt + ' (time budget)'),
             { status: !logged ? 500 : (done ? 200 : 206) });
  return { status: 200, data: {
    app_id: appId, title: title,
    // `eligible` is who was ADDRESSED — released and the badges open the app; `matched` is everybody the badges…
    eligible: eligible, matched: matched, not_released: notReleased,
    already_told: alreadyTold, already_sent: tally.already_sent, sent: tally.sent,
    // `held` is the dial alone — the hold a switch releases — and `held_by` names the switch per letter
    held: tally.held_dial, held_by: heldBy,
    held_quiet: tally.held_quiet, quiet_owed: quietOwed,
    declined: tally.declined, unchecked: tally.unchecked,
    failed: tally.failed, stopped: tally.silenced,
    announced_before: announcedBefore,
    // false when the told-log did not land: a later press may write to these people again
    log_written: logged,
    done: done, resume: stoppedAt || 0
  } };
};

// THE AUTOMATIC PASS RIDES SOMEBODY ELSE'S EXECUTION — the badge save's, and after its lock is released — so it…
var APP_RELEASE_AUTO_BUDGET_MS = 60000;
var APP_RELEASE_AUTO_MAX_LETTERS = 40;

// Called by appBadgeAccessSet / appAccessSetBulk and the seeds; only newly added badges are addressed, and it never…
function appReleaseAutoAnnounce_(addedByApp, appMeta, opts) {
  var summary = {};
  var forCarry = !!(opts && opts.carry);
  try {
    // Settings > My Work's app list: an app kept to the master's own session is announced to nobody
    var mastersOnly = (typeof hubMyWorkAppsRead_ === 'function') ? hubMyWorkAppsRead_() : [];
    var appIds = Object.keys(addedByApp || {}).filter(function (a) {
      return (addedByApp[a] || []).length > 0 && mastersOnly.indexOf(a) === -1;
    });
    if (!appIds.length) return summary;
    var upper = function (list) { return list.map(function (x) { return str_(x).toUpperCase(); }); };
    var metaOf = function (appId) { return (appMeta && appMeta[appId]) || {}; };

    /* Owes every app of this pass to the list, writes nobody, says it once. */
    var deferAll = function (why, quiet) {
      var keptAll = true;
      appIds.forEach(function (appId) {
        var m = metaOf(appId);
        // a debt the carry handed back keeps its own reach and its own age
        var kept = appReleaseOweMorning_(appId, upper(addedByApp[appId]), str_(m.name) || appId,
                                         str_(m.tagline), !!m.whole, str_(m.since));
        keptAll = keptAll && kept;
        summary[appId] = { sent: 0, deferred: true, kept_for_later: kept, why: why };
      });
      hubSysLog_('asa-hub:app-release', 'app_release_announce',
                 '[' + appIds.join(', ') + '] auto — ' + why + ': ' +
                 (keptAll ? (quiet ? 'owed to the morning list' : 'kept for the next pass')
                          : 'the list could NOT keep it') +
                 ' — nobody was written to',
                 { status: !keptAll ? 500 : (quiet ? 200 : 503) });
      return summary;
    };

    // one question to the book for the whole pass — a switched-off situation is a state, not one refusal per person
    var sitNow = appReleaseSituationNow_();
    if (sitNow.state !== 'on' && sitNow.state !== 'unreadable') {
      appIds.forEach(function (appId) { summary[appId] = { sent: 0, silenced: sitNow.why }; });
      hubSysLog_('asa-hub:app-release', 'app_release_announce',
                 '[' + appIds.join(', ') + '] auto — not run: ' + sitNow.why, { status: 200 });
      return summary;
    }
    // THE QUIET WINDOW OWES IT TO THE MORNING.
    if (typeof hubQuietAt_ === 'function' && hubQuietAt_()) {
      return deferAll('inside the quiet window (' + appReleaseQuietWords_() + ')', true);
    }
    /* AN UNREADABLE BOOK IS NOT A SWITCHED-OFF ONE: the announcement waits. */
    if (sitNow.state === 'unreadable') return deferAll(sitNow.why.replace(/ — nobody was written to$/, ''), false);
    // AN UNREADABLE TEST-MODE SWITCH WRITES NOBODY.
    var modeNow = releaseTestMode_();
    if (!modeNow.readable) {
      return deferAll('the test-mode switch could not be read (' + modeNow.error + ')', false);
    }
    // AN OPT-OUT LIST THAT CANNOT BE READ HOLDS THE WHOLE PASS.
    if (typeof optOutIndex_ === 'function') {
      var optIdx = null;
      try { optIdx = optOutIndex_(); }
      catch (eOpt) { optIdx = { error: 'the opt-out list could not be read: ' + String((eOpt && eOpt.message) || eOpt) }; }
      if (optIdx && optIdx.error) return deferAll(String(optIdx.error).replace(/\.\s*$/, ''), false);
    }

    var props = PropertiesService.getScriptProperties();
    var seen = {};
    try { seen = JSON.parse(str_(props.getProperty(APP_RELEASE_ANNOUNCED_PROP)) || '{}'); }
    catch (eS) { seen = {}; }
    var told = appReleaseAlreadyTold_();
    if (!told.readable) {
      return deferAll('the app_release_log could not be read, so who was already told is unknown (' +
                      told.error + ')', false);
    }
    var url = (typeof mailPlatformUrl_ === 'function') ? mailPlatformUrl_() : '';
    var uSheet = hubSheet_(USERS_TAB);
    var uValues = uSheet.getDataRange().getValues();
    var uHdr = uValues[0].map(normKey_);
    var c = releaseUserCols_(uHdr);
    var started = Date.now();
    var letters = 0;
    var stamped = false;
    appIds.forEach(function (appId) {
      var meta = metaOf(appId);
      var title = str_(meta.name) || appId;
      var objective = str_(meta.tagline);
      var added = upper(addedByApp[appId]);
      var sentTo = {}, unwritten = 0, alreadyTold = 0, declinedBefore = 0;
      var logRows = [];
      var tally = appReleaseTally_();
      // the carry's debt: whoever declined it since it was owed is not asked again
      var sinceMs = forCarry ? Date.parse(str_(meta.since)) : NaN;
      for (var r = 1; r < uValues.length; r++) {
        var email = appReleaseMatches_(uValues, r, c, appId, added);
        if (!email || sentTo[email]) continue;
        sentTo[email] = true;
        if (!appReleaseReleased_(uValues, r, c)) continue;
        var uid = str_(uValues[r][c.uid]);
        if (appReleaseWasTold_(told.map, appId, uid, email)) { alreadyTold++; continue; }
        if (appReleaseDeclinedSince_(told.declined, appId, uid, email, sinceMs)) { declinedBefore++; continue; }
        if (letters >= APP_RELEASE_AUTO_MAX_LETTERS ||
            Date.now() - started > APP_RELEASE_AUTO_BUDGET_MS) { unwritten++; continue; }
        letters++;
        var res = appReleaseLetterOut_(
          { email: email, phone: releasePhoneAt_(uValues, r, c),
            name: str_(uValues[r][c.name]), uid: uid },
          { id: appId, title: title, objective: objective, url: url });
        // THE SAME ANSWERS THE BUTTON KEEPS.
        appReleaseCount_(tally, res);
        if (res.outcome === 'silenced') break;
        if (res.sent || res.deduplicated) told.map[appId + '|' + uid] = true;
        logRows.push({ id: 'arl_' + Utilities.getUuid().split('-')[0],
                       at: new Date().toISOString(), app_id: appId, title: title,
                       user_id: uid, email: email,
                       mode: appReleaseLogMode_(res, 'auto'),
                       sent: (res.sent || res.deduplicated) ? 'true' : 'false' });
      }
      // THE TOLD-LOG BEFORE THE KEEPING: the next pass skips only whom it names, so a carry whose rows did not land…
      var logged = appReleaseLogRows_(logRows);
      // a pass that crossed into the quiet window, or met an opt-out list it could not read, owes those people to…
      var kept = ((tally.held_quiet && (logged || !forCarry)) || (tally.unchecked && !forCarry))
        ? appReleaseOweMorning_(appId, added, title, objective, !!meta.whole, str_(meta.since)) : false;
      /* the stamp the button reads, written only when everybody who can still be told was */
      if (!unwritten && appReleaseComplete_(tally, alreadyTold) && (tally.sent || !seen[appId])) {
        seen[appId] = new Date().toISOString(); stamped = true;
      }
      var rehearsed = tally.held_dial, failed = tally.failed;
      if (tally.sent || failed || rehearsed || tally.already_sent || unwritten || tally.held_quiet ||
          tally.declined || tally.unchecked || tally.silenced || declinedBefore || !logged) {
        hubSysLog_('asa-hub:app-release', 'app_release_announce',
                   appId + ' auto — released to [' + added.join(', ') + ']: ' + tally.sent +
                   ' letter(s)' + (tally.already_sent ? ', ' + tally.already_sent + ' already sent' : '') +
                   (rehearsed ? ', ' + rehearsed + ' held' : '') +
                   (tally.held_quiet ? ', ' + tally.held_quiet + ' held by the quiet window' +
                     (kept ? ' (owed to the morning list)'
                           : (forCarry && !logged) ? '' : ' (the morning list could NOT keep them)') : '') +
                   (tally.declined ? ', ' + tally.declined + ' declined (opted out)' : '') +
                   (declinedBefore ? ', ' + declinedBefore + ' not asked again (opted out since it was owed)' : '') +
                   (tally.unchecked ? ', ' + tally.unchecked + ' not written to (opt-out list unreadable' +
                     (forCarry ? ')' : kept ? ', kept for the next pass)' : ', the list could NOT keep them)') : '') +
                   (failed ? ', ' + failed + ' refused' : '') +
                   (tally.silenced ? ', stopped: ' + tally.silenced : '') +
                   (logged ? '' : ', the told-log could NOT be written') +
                   /* the carry says itself whether the rest is kept */
                   (unwritten ? ', ' + unwritten + ' not written to (time budget)' +
                                (forCarry ? '' : ' — press Announce on Release Users to finish') : ''),
                   { status: !logged ? 500 : failed ? 502 : (unwritten ? 206 : 200) });
      }
      summary[appId] = { sent: tally.sent, already_sent: tally.already_sent, held_dial: rehearsed,
                         held_quiet: tally.held_quiet, declined: tally.declined, unchecked: tally.unchecked,
                         declined_before: declinedBefore, failed: failed, unwritten: unwritten,
                         silenced: tally.silenced, kept_for_later: kept, log_written: logged };
    });
    if (stamped) {
      try { props.setProperty(APP_RELEASE_ANNOUNCED_PROP, JSON.stringify(seen)); } catch (eP) {}
    }
  } catch (eAuto) {
    try {
      hubSysLog_('asa-hub:app-release', 'app_release_announce_error',
                 String((eAuto && eAuto.message) || eAuto), { status: 500 });
    } catch (eLog) {}
  }
  return summary;
}

// THE MORNING, FOR AN ANNOUNCEMENT THE NIGHT HELD (Rpc.gs hubQuietOwedCarry_).
function appReleaseQuietCarry_(data) {
  var appId = str_(data && data.app_id);
  if (!appId) return { state: 'stale', why: 'an entry naming no app' };
  // back onto the list: `carried` only when letters went this pass
  var keep = function (why, moved) {
    var kept = appReleaseOweMorning_(appId, Array.isArray(data.badges) ? data.badges : [], data.name,
                                     data.tagline, !!data.whole, str_(data.since));
    return kept ? { state: moved ? 'carried' : 'kept', why: why + ' — kept for the next pass' }
                : { state: 'stale', why: why + ' — and the list could not keep it' };
  };
  var horizon = (typeof HUB_QUIET_OWED_HORIZON_MS !== 'undefined') ? HUB_QUIET_OWED_HORIZON_MS : 36 * 3600 * 1000;
  var sinceMs = Date.parse(str_(data.since));
  if (!isNaN(sinceMs) && Date.now() - sinceMs > horizon) {
    return { state: 'stale', why: appId + ': owed since ' + str_(data.since).slice(0, 16) +
                                  ', more than a day and a half — let go' };
  }
  var now = null;
  try { now = appReleaseBadgesFor_(appId); }
  catch (eB) {
    return keep(appId + ': the access matrix could not be read (' +
                String((eB && eB.message) || eB).slice(0, 160) + ')');
  }
  var owedTo = (Array.isArray(data.badges) ? data.badges : [])
    .map(function (b) { return str_(b).toUpperCase(); });
  var still = data.whole ? now.slice() : owedTo.filter(function (b) { return now.indexOf(b) !== -1; });
  if (!still.length) {
    return { state: 'stale', why: appId + (data.whole ? ' no longer opens to anybody'
                                                      : ' no longer opens to the badges it was owed to') };
  }
  var byApp = {}; byApp[appId] = still;
  var meta = {};
  meta[appId] = { name: str_(data.name) || appId, tagline: str_(data.tagline),
                  whole: !!data.whole, since: str_(data.since) };
  var sum = (appReleaseAutoAnnounce_(byApp, meta, { carry: true }) || {})[appId];
  if (!sum) return keep(appId + ': the pass answered nothing');
  if (sum.silenced) return { state: 'stale', why: appId + ': ' + sum.silenced };
  if (sum.deferred) {
    return sum.kept_for_later
      ? { state: 'kept', why: appId + ': ' + sum.why + ' — kept for the next pass' }
      : { state: 'stale', why: appId + ': ' + sum.why + ' — and the list could not keep it' };
  }
  var n = function (k) { return Number(sum[k]) || 0; };
  var told = n('sent') + n('already_sent');
  var logLost = sum.log_written === false;
  // a person's own stop settles them for this debt only while it has an age (appReleaseDeclinedSince_)
  var declinedSettle = !isNaN(sinceMs);
  // whom the next pass skips that this one did not — only once the told-log holds them
  var moved = logLost ? 0 : told + (declinedSettle ? n('declined') : 0);
  // every letter the next pass meets first again
  var spent = n('held_dial') + n('held_quiet') + n('unchecked') + n('failed') +
              (declinedSettle ? 0 : n('declined'));
  var said = appId + ': ' + told + ' told' +
             (n('held_dial') ? ', ' + n('held_dial') + ' held by a switch — press Announce once it is off' : '') +
             (n('held_quiet') ? ', ' + n('held_quiet') + ' held by the quiet window' +
               (sum.kept_for_later || logLost ? '' : ' (the morning list could not keep them)') : '') +
             (n('failed') ? ', ' + n('failed') + ' refused' : '') +
             (n('declined') ? ', ' + n('declined') + ' declined (opted out)' : '') +
             (n('declined_before') ? ', ' + n('declined_before') + ' not asked again (opted out since it was owed)' : '') +
             (n('unchecked') ? ', ' + n('unchecked') + ' not written to — the opt-out list could not be read' : '') +
             (n('unwritten') ? ', ' + n('unwritten') + ' not written to yet (time budget)' : '') +
             (logLost ? ', the told-log could not be written' : '');
  var finish = n('held_dial') ? '' : '; press Announce on Release Users to finish';
  // A TOLD-LOG THAT DID NOT LAND IS NO PROGRESS.
  if (logLost && (n('unwritten') || n('unchecked') || n('held_quiet'))) {
    return { state: 'stale',
             why: said + ' — let go, since the next pass would write to the same people again; ' +
                  'press Announce on Release Users once it writes' };
  }
  // the window began during the pass, and the pass put the app back for the morning itself
  if (n('held_quiet') && sum.kept_for_later) {
    return { state: told ? 'carried' : 'kept', why: said + ' — owed to the morning list again' };
  }
  // KEPT ONLY WHILE THE PASS MOVES.
  if (n('unwritten') || n('unchecked')) {
    if (moved && moved >= spent) return keep(said, told > 0);
    return { state: 'stale',
             why: said + ' — let go, since the next pass would spend its letters on the same people again' +
                  finish };
  }
  // everybody the pass could reach was asked; one that told nobody said nothing, and the list logs why
  if (!told) {
    return { state: 'stale',
             why: (spent || n('declined') || n('declined_before') || logLost)
               ? said + ' — let go' + (n('failed') ? finish : '')
               : appId + ': nobody released is still owed it — let go' };
  }
  return { state: 'carried', why: said };
}
