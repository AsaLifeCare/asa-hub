// Public doors.
// A reset hands the person a fresh random temporary password: by e-mail to the address on file, and by text to the…

var RESET_TAB = 'password_resets';
var RESET_TTL_MINUTES = 60;
var RESET_HEADER = ['token_hash', 'user_id', 'email', 'created_at',
                    'expires_at', 'used_at'];

// THE TEMPORARY PASSWORD IS A SECOND CREDENTIAL, NEVER A REPLACEMENT.
var RESET_TEMP_TAB = 'temp_passwords';
var RESET_TEMP_HEADER = ['user_id', 'salt', 'pass_hash', 'channel', 'created_at', 'expires_at', 'used_at'];
var RESET_TEMP_MINUTES = 30;
// per account, whichever of its e-mails asked, counted from the store; the typed address has its own cap too
var RESET_TEMP_PER_HOUR = 3;
var RESET_SIGN_IN_URL = 'https://asamylife.asalifecare.com';
var RESET_SMS_FLOOR = 'ASA MyLife: your temporary password is {password}. Sign in at {url} and choose a new one.';
var RESET_SUBJECT_FLOOR = 'ASA MyLife — your temporary password';
var RESET_MAIL_FLOOR = 'ASA MyLife: your temporary password is {password}.\n\n' +
                       'Sign in at {url} and choose a new one.\n\n' +
                       'It works once, within {minutes} minutes. If you did not ask for it, ignore this message — ' +
                       'your current password still works.';
// The text's words must keep this phrase: it is how the line's mirror (Quo.gs, quo_inbox.py) finds the key to withhold.
var RESET_SMS_PHRASE = /temporary password is \{password\}/i;
var RESET_TEXT_SECRET_RE = /(temporary password is\s+)[A-Za-z0-9]{6,64}/gi;

/** A copy of a text the platform keeps (the line's mirror) carries the words, never the temporary password. */
function resetTextScrub_(text) {
  var mark = (typeof HUB_WITHHELD_WORDS !== 'undefined') ? HUB_WITHHELD_WORDS : '{withheld}';
  return String(text == null ? '' : text).replace(RESET_TEXT_SECRET_RE, '$1' + mark);
}

function resetSheet_() {
  return hubTabEnsure_(RESET_TAB, RESET_HEADER);
}

function resetTempSheet_() {
  return hubTabEnsure_(RESET_TEMP_TAB, RESET_TEMP_HEADER);
}

// Constant-time on purpose.
function resetHashMatches_(a, b) {
  var x = String(a || ''), y = String(b || '');
  if (!x || x.length !== y.length) return false;
  var diff = 0;
  for (var i = 0; i < x.length; i++) diff |= (x.charCodeAt(i) ^ y.charCodeAt(i));
  return diff === 0;
}

function resetRowByToken_(token) {
  var raw = str_(token);
  if (raw.length < 24) return null;
  var want = sha256Hex_(raw);
  var values = resetSheet_().getDataRange().getValues();
  var hdr = (values[0] || []).map(normKey_);
  var iH = hdr.indexOf('tokenhash'), iU = hdr.indexOf('userid'),
      iE = hdr.indexOf('email'), iX = hdr.indexOf('expiresat'),
      iUsed = hdr.indexOf('usedat');
  if (iH === -1) return null;
  for (var r = values.length - 1; r >= 1; r--) {
    if (!resetHashMatches_(str_(values[r][iH]), want)) continue;
    if (str_(values[r][iUsed])) return null;
    var exp = str_(values[r][iX]);
    if (exp && new Date(exp).getTime() < new Date().getTime()) return null;
    return { row: r + 1, user_id: str_(values[r][iU]), email: str_(values[r][iE]),
             used_col: iUsed + 1 };
  }
  return null;
}

/** The designed part of a letter, drawn from its own words: paragraphs, and the link as a link. */
function resetLetterHtml_(text, link) {
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var href = esc(link);
  return String(text || '').split(/\n{2,}/).map(function (para) {
    var inner = esc(para).replace(/\n/g, '<br>');
    if (href && inner.indexOf(href) !== -1) {
      inner = inner.split(href).join('<a href="' + href + '">' + href + '</a>');
    }
    return '<p>' + inner + '</p>';
  }).join('');
}

function resetSignInUrl_() {
  var base = RESET_SIGN_IN_URL;
  try { base = str_(mailPlatformUrl_()) || base; } catch (e) { }
  return base.replace(/#.*$/, '').replace(/\/+$/, '');
}

/** The store read once: { sheet, hdr, values }. */
function resetTempRead_(sheet) {
  var values = sheet ? sheet.getDataRange().getValues() : [];
  return { sheet: sheet, hdr: (values[0] || []).map(normKey_), values: values };
}

/** How many temporary passwords this account was handed since `sinceMs`. */
function resetTempIssuedSince_(t, uid, sinceMs) {
  var iU = t.hdr.indexOf('userid'), iC = t.hdr.indexOf('createdat'), n = 0;
  if (iU === -1 || iC === -1) return 0;
  for (var r = 1; r < t.values.length; r++) {
    if (str_(t.values[r][iU]) !== uid) continue;
    var at = new Date(str_(t.values[r][iC])).getTime();
    if (!isNaN(at) && at >= sinceMs) n++;
  }
  return n;
}

/** The account's NEWEST temporary password while it is still good (unused, inside its window), else null. */
function resetTempLive_(t, uid, nowMs) {
  var iU = t.hdr.indexOf('userid'), iS = t.hdr.indexOf('salt'), iH = t.hdr.indexOf('passhash'),
      iX = t.hdr.indexOf('expiresat'), iUsed = t.hdr.indexOf('usedat');
  if (iU === -1 || iS === -1 || iH === -1 || iX === -1 || iUsed === -1) return null;
  for (var r = t.values.length - 1; r >= 1; r--) {
    if (str_(t.values[r][iU]) !== uid) continue;
    if (str_(t.values[r][iUsed])) return null;
    var exp = new Date(str_(t.values[r][iX])).getTime();
    if (isNaN(exp) || exp <= nowMs) return null;
    return { row: r + 1, salt: str_(t.values[r][iS]), hash: str_(t.values[r][iH]), used_col: iUsed + 1 };
  }
  return null;
}

// THE SIGN-IN'S SECOND QUESTION (Auth.gs authLogin): does `pass` match this account's live temporary password?
function resetTempMatch_(u, pass) {
  try {
    var uid = str_(u && u.userid);
    if (!uid || !pass) return null;
    var sheet = (typeof hubTabSheet_ === 'function') ? hubTabSheet_(RESET_TEMP_TAB) : null;
    if (!sheet) return null;
    var live = resetTempLive_(resetTempRead_(sheet), uid, Date.now());
    if (!live || !live.salt || !live.hash) return null;
    if (!resetHashMatches_(hashPassword_(String(pass), live.salt), live.hash)) return null;
    return { sheet: sheet, uid: uid, row: live.row, used_col: live.used_col, hash: live.hash };
  } catch (e) { return null; }
}

/** Marks the matched temporary password used, under the lock and only if it is still the live one; false otherwise. */
function resetTempSpend_(hit) {
  var lock = null;
  try {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) { lock = null; return false; }
    var live = resetTempLive_(resetTempRead_(hit.sheet), hit.uid, Date.now());
    if (!live || live.row !== hit.row || live.hash !== hit.hash) return false;
    hit.sheet.getRange(hit.row, hit.used_col).setValue(new Date().toISOString());
    return true;
  } catch (e) {
    return false;
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (eR) { } }
  }
}

/** A sign-in a log may name: the first letter and the domain of an address, the last four of a number. */
function resetMask_(ident) {
  var s = str_(ident);
  var at = s.indexOf('@');
  if (at > 0) return s.charAt(0) + '•••' + s.slice(at);
  return s.length > 4 ? '•••' + s.slice(-4) : '•••';
}

function resetMailable_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str_(email));
}

// THE NUMBER ON THE ACCOUNT, never one typed on the form: `phone`, then each entry of `phones`, the first one that…
function resetPhoneOnFile_(u) {
  var candidates = [str_(u && u.phone)];
  var list = (typeof profileParsePhones_ === 'function') ? profileParsePhones_(u && u.phones) : [];
  for (var i = 0; i < list.length; i++) candidates.push(str_(list[i] && list[i].number));
  for (var j = 0; j < candidates.length; j++) {
    var raw = candidates[j];
    if (!raw) continue;
    var num = (typeof packetTeamCopyNumber_ === 'function') ? packetTeamCopyNumber_(raw) : '';
    if (!num) continue;
    if (typeof commReleaseSharedLine_ === 'function' && commReleaseSharedLine_(raw)) continue;
    return num;
  }
  return '';
}

// THE WORDS: the situation's cells when they name {password}, else the code's.
function resetWords_(allowed) {
  var row = (allowed && allowed.row) || null;
  var cell = function (field, floor) {
    return (typeof hubAuthLetterWords_ === 'function')
      ? String(hubAuthLetterWords_('password_reset', field, floor, row)) : floor;
  };
  var mail = cell('email_text', RESET_MAIL_FLOOR);
  var mailOwn = mail.indexOf('{password}') !== -1;
  var sms = cell('sms_text', RESET_SMS_FLOOR);
  return {
    subject: mailOwn ? cell('email_subject', RESET_SUBJECT_FLOOR) : RESET_SUBJECT_FLOOR,
    mail: mailOwn ? mail : RESET_MAIL_FLOOR,
    sms: RESET_SMS_PHRASE.test(sms) ? sms : RESET_SMS_FLOOR
  };
}

function resetFill_(text, vars) {
  var out = String(text || '');
  for (var k in vars) {
    if (Object.prototype.hasOwnProperty.call(vars, k)) out = out.split('{' + k + '}').join(String(vars[k]));
  }
  return out;
}

/** The letter, as an authentication letter that asks the relay whether the address can receive mail first. */
function resetMailLeg_(email, subject, body, pw) {
  var out = null, why = '';
  try {
    out = platformMailOut_(email, subject, body, resetLetterHtml_(body, resetSignInUrl_()), '', '',
                           { auth_letter: 'password_reset', lane: 'platform', reason: 'the temporary password',
                             withhold: pw, reach: true });
  } catch (e) { why = String((e && e.message) || e).slice(0, 160); }
  if (out && out.undeliverable) why = 'the address cannot receive mail (' + str_(out.undeliverable) + ')';
  var sent = !!(out && out.sent);
  // THE ROW GOES IN THE BOOK EVERYBODY READS, whichever way it went — with the password withheld.
  try {
    if (typeof hubAuthLetterNote_ === 'function') {
      hubAuthLetterNote_('password_reset', {
        to: email, subject: subject, body: body, withhold: pw, sent: sent,
        receipt: str_(out && out.receipt), why: why || 'the letter did not leave this platform'
      });
    }
  } catch (eRow) { /* the letter is the point; the row is the record of it */ }
  // the Message-ID is what the mailserver's log and the recipient's admin search find the letter by
  return sent ? { sent: true, receipt: str_(out.receipt) + (str_(out.message_id) ? ' ' + str_(out.message_id) : '') }
              : { sent: false, why: why || 'the letter did not leave this platform' };
}

/** The text, through the one door. It claims the kind (Rpc.gs HUB_AUTH_TEXTS), so the dial does not hold it. */
function resetSmsLeg_(phone, text, pw, uid) {
  var res = null;
  try {
    res = rpcCall_('smsSend', { to: phone, body: text, reason: 'smart comms: auth_password_reset',
                                auth_letter: 'password_reset', withhold: [pw] },
                   { idempotency_key: 'pwreset_' + uid + '_' + randomHex_(12) });
  } catch (e) { return { sent: false, why: String((e && e.message) || e).slice(0, 160) }; }
  if (res && res.ok && res.sent && !res.redirected) {
    try {
      if (typeof hubAuthLetterLedger_ === 'function') hubAuthLetterLedger_('password_reset', phone, 'sms');
    } catch (eL) { }
    return { sent: true, receipt: str_(res.receipt) };
  }
  return { sent: false, why: str_(res && (res.reason || res.error || res.detail)) || 'the text did not leave' };
}

// E-MAIL FIRST, TO THE ADDRESS ON FILE; THE TEXT WHEN THE LETTER CANNOT REACH THEM — no address on the account, a…
function resetDeliver_(u, pw, allowed) {
  var email = str_(u.email);
  var words = resetWords_(allowed);
  var vars = { password: pw, url: resetSignInUrl_(), minutes: String(RESET_TEMP_MINUTES), email: email };
  var out = { channel: '', receipt: '', why: [] };
  if (resetMailable_(email)) {
    var m = resetMailLeg_(email, resetFill_(words.subject, vars), resetFill_(words.mail, vars), pw);
    if (m.sent) { out.channel = 'email'; out.receipt = m.receipt; return out; }
    out.why.push('email: ' + m.why);
  } else {
    out.why.push('email: no address on the account');
  }
  var phone = resetPhoneOnFile_(u);
  if (!phone) {
    out.why.push('sms: no number on the account that may carry a password');
    return out;
  }
  var s = resetSmsLeg_(phone, resetFill_(words.sms, vars), pw, str_(u.userid));
  if (s.sent) { out.channel = 'sms'; out.receipt = s.receipt; return out; }
  out.why.push('sms: ' + s.why);
  return out;
}

function resetSay_(actor, action, what, status) {
  try { hubSysLog_(actor, action, what, { status: status || 200 }); } catch (e) { }
}

// Always the same generic answer, so who has an account never leaks.
function authForgotPub_(payload) {
  var generic = { status: 200, data: { sent: true } };
  var cache = null, busyKey = '';
  var held = false;
  try {
    // the sign-in the person uses: an address, or the number a number-only account signs in with
    var ident = str_(payload && payload.identifier).toLowerCase();
    if (!ident || ident.length > 160) return generic;
    cache = CacheService.getScriptCache();
    var key = 'pf_' + sha256Hex_(ident);
    var asks = parseInt(cache.get(key) || '0', 10);
    if (asks >= RESET_TEMP_PER_HOUR) {
      resetSay_(resetMask_(ident), 'password_reset_limited', 'this sign-in already asked ' + asks + ' times this hour');
      return generic;
    }
    cache.put(key, String(asks + 1), 3600);

    var u = userByEmail_(ident);
    if (!u) {
      resetSay_(resetMask_(ident), 'password_reset_no_account', 'no account signs in with it — nothing was sent');
      return generic;
    }
    if (str_(u.active).toLowerCase() === 'false') {
      resetSay_(str_(u.email), 'password_reset_inactive', 'the account is blocked — nothing was sent');
      return generic;
    }
    var uid = str_(u.userid);

    // THE SITUATION DECIDES WHETHER ANYTHING IS SENT AT ALL — AND IT IS ASKED BEFORE A PASSWORD EXISTS.
    var allowed = (typeof hubAuthLetterAllowed_ === 'function')
      ? hubAuthLetterAllowed_('password_reset') : { on: true, row: null, why: '' };
    if (!allowed.on) {
      resetSay_(str_(u.email), allowed.unreadable ? 'password_reset_switch_unreadable' : 'password_reset_situation_off',
                allowed.why, allowed.unreadable ? 502 : 200);
      try {
        if (typeof hubAuthLetterNote_ === 'function') {
          hubAuthLetterNote_('password_reset', { to: str_(u.email), subject: RESET_SUBJECT_FLOOR,
                                                 body: '(no password was made)', sent: false, why: allowed.why });
        }
      } catch (eOff) { /* the ask still answers the same generic yes */ }
      return generic;
    }

    // ONE ASK PER ACCOUNT AT A TIME, without the script lock: a public door must not hold every writer while a…
    if (cache.get('pfbusy_' + uid)) {
      resetSay_(str_(u.email), 'password_reset_busy', 'a reset for this account was already on its way — nothing more was sent', 409);
      return generic;
    }
    busyKey = 'pfbusy_' + uid;
    cache.put(busyKey, '1', 120);
    // every ask that gets this far counts for the account, whichever of its sign-ins typed it and whether or not…
    var triesKey = 'pfa_' + sha256Hex_(uid);
    var tries = parseInt(cache.get(triesKey) || '0', 10);
    if (tries >= RESET_TEMP_PER_HOUR) {
      resetSay_(str_(u.email), 'password_reset_limited',
                'the account already asked ' + tries + ' times this hour — nothing was sent');
      return generic;
    }
    cache.put(triesKey, String(tries + 1), 3600);
    var store = resetTempRead_(resetTempSheet_());
    var recent = resetTempIssuedSince_(store, uid, Date.now() - 3600000);
    if (recent >= RESET_TEMP_PER_HOUR) {
      resetSay_(str_(u.email), 'password_reset_limited',
                'the account was handed ' + recent + ' temporary passwords this hour — nothing was sent');
      return generic;
    }

    // LETTER FIRST, CREDENTIAL AFTER: only a password that reached the person becomes one.
    var pw = tempPassword_();
    if (typeof hubSecretsHold_ === 'function') { hubSecretsHold_([pw]); held = true; }
    var sent = resetDeliver_(u, pw, allowed);
    if (!sent.channel) {
      resetSay_(str_(u.email), 'password_reset_held',
                'no temporary password reached the person — ' + sent.why.join(' · '), 502);
      return generic;
    }
    var salt = randomHex_(32);
    var now = new Date();
    try {
      store.sheet.appendRow([uid, salt, hashPassword_(pw, salt), sent.channel, now.toISOString(),
                             new Date(now.getTime() + RESET_TEMP_MINUTES * 60000).toISOString(), '']);
    } catch (eW) {
      resetSay_(str_(u.email), 'password_reset_not_stored',
                'the temporary password left by ' + sent.channel + ' but could not be stored, so it will not work: ' +
                String((eW && eW.message) || eW).slice(0, 120), 500);
      return generic;
    }
    resetSay_(str_(u.email), 'password_reset_sent',
              'temporary password sent by ' + (sent.channel === 'sms' ? 'text' : 'e-mail') +
              (sent.receipt ? ' (' + sent.receipt + ')' : '') +
              (sent.why.length ? ' — ' + sent.why.join(' · ') : ''), 200);
  } catch (e) {
    resetSay_('asa-hub:auth', 'password_reset_failed', String((e && e.name) || 'Error'), 500);
  } finally {
    if (held && typeof hubSecretsRelease_ === 'function') hubSecretsRelease_();
    if (busyKey && cache) { try { cache.remove(busyKey); } catch (eR) { } }
  }
  return generic;
}

var RESET_LINK_DEAD = 'This link is not valid any more. Use Forgot password on the sign-in page — it sends a ' +
                      'temporary password instead.';

function authResetContextPub_(payload) {
  var dead = { status: 404, message: RESET_LINK_DEAD };
  try {
    var hit = resetRowByToken_(payload && payload.t);
    if (!hit) return dead;
    return { status: 200, data: { email: hit.email } };
  } catch (e) { return dead; }
}

function authResetSubmitPub_(payload) {
  var dead = { status: 404, message: RESET_LINK_DEAD };
  var pw = String((payload && payload.password) || '');
  if (pw.length < 8) return { status: 400, message: 'Your password needs at least 8 characters.' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { status: 409, message: 'One moment — try again in a few seconds.' };
  }
  try {
    var hit = resetRowByToken_(payload && payload.t);
    if (!hit) return dead;
    var sheet = hubSheet_(USERS_TAB);
    var values = sheet.getDataRange().getValues();
    var hdr = (values[0] || []).map(normKey_);
    var iId = hdr.indexOf('userid'), iS = hdr.indexOf('salt'),
        iH = hdr.indexOf('passhash'), iM = hdr.indexOf('mustchange');
    if (iId === -1 || iS === -1 || iH === -1) return dead;
    for (var r = 1; r < values.length; r++) {
      if (str_(values[r][iId]) !== hit.user_id) continue;
      var salt = randomHex_(32);
      sheet.getRange(r + 1, iS + 1).setValue(salt);
      sheet.getRange(r + 1, iH + 1).setValue(hashPassword_(pw, salt));
      if (iM !== -1) sheet.getRange(r + 1, iM + 1).setValue('');
      resetSheet_().getRange(hit.row, hit.used_col).setValue(new Date().toISOString());
      try { usersRowsBump_(); } catch (eB) { }
      try { hubSysLog_(hit.email, 'password_reset_done', 'via reset link', { status: 200 }); }
      catch (eL) { }
      return { status: 200, data: { ok: true } };
    }
    return dead;
  } catch (e) {
    return { status: 500, message: 'The password could not be saved — try the link again.' };
  } finally {
    try { lock.releaseLock(); } catch (eR) { }
  }
}
