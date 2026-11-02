// The account exists only once the invitee registers; every public refusal is the same sentence.

var INVITES_TAB = 'platform_invites';
var INVITES_HEADER = ['invite_id', 'email', 'phone', 'name', 'status', 'invited_by',
                      'invited_at', 'registered_at', 'user_id', 'expires_at', 'tenant'];

var INVITE_LINK_SECRET_PROP = 'INTERVIEW_LINK_SECRET';

var INVITE_TTL_DAYS = 14;

function invitesSheet_() {
  var sheet = hubTabEnsure_(INVITES_TAB, INVITES_HEADER);
  ensureHeader_(sheet, INVITES_HEADER);
  return sheet;
}

var HUB_INVITE_ROWS = null;
function invitesRows_() {
  if (HUB_INVITE_ROWS) return HUB_INVITE_ROWS;
  try {
    // Must read through the same workbook door the writer appends to.
    HUB_INVITE_ROWS = readTabNormalized_(hubTabWorkbook_(INVITES_TAB), INVITES_TAB);
  } catch (e) { HUB_INVITE_ROWS = []; }
  return HUB_INVITE_ROWS;
}
function invitesRowsBump_() { HUB_INVITE_ROWS = null; }

function inviteSecret_() {
  try {
    return String(hubProp_(INVITE_LINK_SECRET_PROP) || '');
  } catch (e) { return ''; }
}

function inviteSig_(inviteId) {
  var secret = inviteSecret_();
  if (!secret) return '';
  var bytes = Utilities.computeHmacSha256Signature(String(inviteId), secret);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function inviteTokenFor_(inviteId) {
  var sig = inviteSig_(inviteId);
  return sig ? inviteId + '.' + sig : '';
}

function inviteByToken_(token) {
  var raw = str_(token);
  if (!raw || raw.indexOf('.') === -1) return null;
  var parts = raw.split('.');
  var id = parts[0], sig = parts[1];
  if (!/^inv_[A-Za-z0-9]{8,}$/.test(id)) return null;
  var expect = inviteSig_(id);
  if (!expect) return null;
  var a = String(expect), b = String(sig || '');
  if (a.length !== b.length) return null;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  if (diff !== 0) return null;
  var rows = invitesRows_();
  for (var r = 0; r < rows.length; r++) {
    if (str_(rows[r].inviteid) === id) return rows[r];
  }
  return null;
}

function inviteLink_(token) {
  var base = 'https://asamylife.asalifecare.com';
  try { base = str_(mailPlatformUrl_()) || base; } catch (e) {}
  return base.replace(/\/+$/, '') + '/#/register?t=' + encodeURIComponent(token);
}



/** List every invite with its status (sent, expired or registered), newest first; the token is never echoed. */
HUB_POLICY.invitesList = {
  file: 'Invites.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.invitesList = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var nowMs = new Date().getTime();
  var out = invitesRows_()
    .filter(function (i) { return tenantRowVisible_(i.tenant); })
    .map(function (i) {
      var exp = str_(i.expiresat);
      var expired = exp && new Date(exp).getTime() < nowMs;
      var status = str_(i.status);
      return {
        invite_id: str_(i.inviteid),
        email: str_(i.email),
        phone: str_(i.phone),
        name: str_(i.name),
        // Never echo the token here.
        status: status === 'registered' ? 'registered' : (expired ? 'expired' : status || 'sent'),
        invited_at: str_(i.invitedat),
        registered_at: str_(i.registeredat),
        expires_at: exp
      };
    });
  out.sort(function (a, b) { return a.invited_at < b.invited_at ? 1 : -1; });
  return { status: 200, data: { invites: out, secret_set: !!inviteSecret_() } };
};

// THE INVITATION IN THE BOOK'S WORDS.
function inviteLetterFromRow_(row, o) {
  var opts = o || {};
  var floor = inviteRegisterEmail_(opts);
  var link = String(opts.link || '');
  var inviter = String(opts.inviterName || '').trim();
  var vars = { name: String(opts.name || '').trim(), link: link, days: String(opts.days || ''),
               inviter: inviter, by_inviter: inviter ? ' by ' + inviter : '' };
  var cell = function (k) {
    return (typeof hubAuthLetterWords_ === 'function')
      ? hubAuthLetterWords_('invitation', k, '', row) : String((row && row[k]) || '').trim();
  };
  var render = function (t) {
    return (typeof hubLetterRender_ === 'function') ? hubLetterRender_(t, vars) : String(t);
  };
  var subjCell = cell('email_subject'), textCell = cell('email_text');
  var subject = subjCell ? render(subjCell) : floor.subject;
  if (!textCell) return { subject: subject, text: floor.text, html: floor.html, words: 'template' };
  var text = render(textCell);
  var esc = function (s) { return (typeof mailEsc_ === 'function') ? mailEsc_(s) : String(s); };
  var href = esc(link);
  var blocks = text.split(/\n{2,}/).map(function (para) {
    var inner = esc(para).replace(/\n/g, '<br>');
    if (href && inner.indexOf(href) !== -1) inner = inner.split(href).join('<a href="' + href + '">' + href + '</a>');
    return mailPara_(inner);
  });
  var html = mailShell_({ title: subject, preheader: 'Create your account — you choose the password.',
                          blocks: blocks });
  return { subject: subject, text: text, html: html, words: 'row' };
}

/** Send a registration invite; an address that already has an account is refused, since userInvite is its door. */
HUB_POLICY.inviteSend = {
  file: 'Invites.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: ['email', 'sms']
};
HUB_ACTIONS.inviteSend = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  if (!inviteSecret_()) {
    return { status: 503, message: 'Set the INTERVIEW_LINK_SECRET Script Property first — ' +
             'invitation links refuse to be minted without a signing key.' };
  }
  var email = str_(payload && payload.email).trim().toLowerCase();
  var name = str_(payload && payload.name).trim();
  var phone = str_(payload && payload.phone).trim();
  if (email.indexOf('@') === -1) return { status: 400, message: 'A valid e-mail address is required.' };
  if (!name) return { status: 400, message: 'Their name is required — the letter greets a person.' };

  if (userByEmail_(email)) {
    return { status: 409, message: 'That address already has an account here. Use Users → Invite to send them their login.' };
  }
  var rows = invitesRows_();
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].email).toLowerCase() === email && str_(rows[i].status) !== 'revoked' &&
        str_(rows[i].status) !== 'registered') {
      return { status: 409, message: 'They already have an invitation waiting. Revoke it first to send a new one.' };
    }
  }

  var id = 'inv_' + randomHex_(10);
  var token = inviteTokenFor_(id);
  var expires = new Date(new Date().getTime() + INVITE_TTL_DAYS * 86400000).toISOString();
  var rec = {
    invite_id: id, email: email, phone: phone, name: name,
    status: 'sent', invited_by: str_(user.email),
    invited_at: new Date().toISOString(), registered_at: '', user_id: '',
    expires_at: expires, tenant: tenantStamp_()
  };
  var sheet = invitesSheet_();
  var header = ensureHeader_(sheet, INVITES_HEADER);
  sheet.appendRow(header.map(function (h) { return rec[h] !== undefined ? rec[h] : ''; }));
  invitesRowsBump_();

  var link = inviteLink_(token);
  var sent = { email: false, sms: false }, why = '';
  // THE SITUATION DECIDES WHETHER THE INVITATION IS SENT AT ALL.
  var inviteAllowed = (typeof hubAuthLetterAllowed_ === 'function')
    ? hubAuthLetterAllowed_('invitation') : { on: true, row: null, why: '' };
  if (!inviteAllowed.on) {
    hubSysLog_(user.email, inviteAllowed.unreadable ? 'inviteSend_switch_unreadable' : 'inviteSend_situation_off',
               email + ' — ' + inviteAllowed.why, { status: inviteAllowed.unreadable ? 502 : 200 });
    return { status: 200, data: { invite_id: id, sent: sent, why: inviteAllowed.why, link: link } };
  }
  // A failed send keeps the invitation row; the link can be sent again.
  try {
    var inviterName = str_(user.display_name || user.name);
    var letter = inviteLetterFromRow_(inviteAllowed.row || null, {
      name: name, link: link, days: INVITE_TTL_DAYS, inviterName: inviterName
    });
    var res = rpcCall_('emailSend', {
      to: email, subject: letter.subject, body: letter.text, html: letter.html,
      // The situation names itself, so the row in the mock outbox carries it.
      reason: 'smart comms: auth_invitation',
      // Auth letter: the rehearsal dial does not hold it; the opt-out brake still does.
      auth_letter: 'invitation',
      // The registration link reaches the person and never the outbox or the mail log.
      withhold: link
    });
    // SENT MEANS IT LEFT. An opted-out address answers ok and sends nothing.
    if (res && res.ok && res.sent) {
      sent.email = true;
      if (typeof hubAuthLetterLedger_ === 'function') hubAuthLetterLedger_('invitation', email, 'email');
    } else {
      why = str_(res && (res.error || res.detail || res.reason)) || 'the e-mail was refused';
    }
  } catch (eM) { why = String(eM && eM.message ? eM.message : eM); }

  if (phone) {
    try {
      // THE SMS COPY IS A TEXT LIKE EVERY OTHER.
      var smsWords = ((typeof hubAuthLetterWords_ === 'function')
        ? hubAuthLetterWords_('invitation', 'sms_text',
                              '{name}, your ASA invitation — create your account: {link}',
                              inviteAllowed.row || null)
        : '{name}, your ASA invitation — create your account: {link}')
        .split('{name}').join(name).split('{link}').join(link);
      var sres = rpcCall_('smsSend', {
        to: phone,
        body: smsWords,
        reason: 'smart comms: auth_invitation',
        withhold: link
      }, { quiet_exempt: 'sign_in' });
      if (sres && sres.ok && sres.sent) sent.sms = true;
      else if (!why) why = str_(sres && (sres.error || sres.detail || sres.reason)) || 'the SMS was refused';
    } catch (eS) { if (!why) why = String(eS && eS.message ? eS.message : eS); }
  }

  hubSysLog_(user.email, 'inviteSend', email, { status: 200 });
  return { status: 200, data: { invite_id: id, sent: sent, why: why, link: link } };
};

HUB_POLICY.inviteRevoke = {
  file: 'Invites.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.inviteRevoke = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var id = str_(payload && payload.invite_id);
  if (!id) return { status: 400, message: 'invite_id is required.' };
  var sheet = invitesSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('inviteid'), iStatus = hdr.indexOf('status');
  var iTenant = hdr.indexOf('tenant');
  for (var r = 1; r < values.length; r++) {
    if (str_(values[r][iId]) !== id) continue;
    if (!tenantRowVisible_(iTenant === -1 ? '' : values[r][iTenant])) break;
    if (str_(values[r][iStatus]) === 'registered') {
      return { status: 409, message: 'They have already registered — remove the account instead.' };
    }
    sheet.getRange(r + 1, iStatus + 1).setValue('revoked');
    invitesRowsBump_();
    hubSysLog_(user.email, 'inviteRevoke', id, { status: 200 });
    return { status: 200, data: { ok: true } };
  }
  return { status: 404, message: 'Not found.' };
};


// Public doors: no session; the token is the identity.

function inviteContextPub_(payload) {
  var row = inviteByToken_(payload && payload.t);
  var dead = { status: 404, message: 'This invitation is not valid any more. Ask for a new one.' };
  if (!row) return dead;
  if (str_(row.status) === 'revoked') return dead;
  if (str_(row.status) === 'registered') {
    return { status: 409, message: 'This invitation was already used — sign in with your e-mail instead.' };
  }
  var exp = str_(row.expiresat);
  if (exp && new Date(exp).getTime() < new Date().getTime()) return dead;
  return { status: 200, data: { name: str_(row.name), email: str_(row.email) } };
}

function inviteRegisterPub_(payload) {
  var row = inviteByToken_(payload && payload.t);
  var dead = { status: 404, message: 'This invitation is not valid any more. Ask for a new one.' };
  if (!row) return dead;
  if (str_(row.status) !== 'sent') return dead;
  var exp = str_(row.expiresat);
  if (exp && new Date(exp).getTime() < new Date().getTime()) return dead;

  var pw = String((payload && payload.password) || '');
  if (pw.length < 8) return { status: 400, message: 'Your password needs at least 8 characters.' };
  var name = str_(payload && payload.display_name).trim() || str_(row.name);
  if (hubNameFold_(name) !== hubNameFold_(row.name)) {
    var nameRefused = hubSelfNameRefused_('', name);
    if (nameRefused) return { status: 409, message: nameRefused };
  }
  var email = str_(row.email).toLowerCase();
  if (email.indexOf('@') === -1) return dead;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { status: 409, message: 'One moment — try again in a few seconds.' };
  }
  try {
    invitesRowsBump_();
    var fresh = inviteByToken_(payload && payload.t);
    if (!fresh || str_(fresh.status) !== 'sent') return dead;
    if (userByEmail_(email)) {
      return { status: 409, message: 'This invitation was already used — sign in with your e-mail instead.' };
    }
    ensureUserProfileColumns_();
    var salt = randomHex_(32);
    var uid = 'USR_' + randomHex_(12).toUpperCase();
    var sheet = hubSheet_(USERS_TAB);
    var uHdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(normKey_);
    var line = [];
    for (var c = 0; c < uHdr.length; c++) line.push('');
    var put = function (key, val) {
      var i = uHdr.indexOf(key);
      if (i !== -1) line[i] = val;
    };
    put('userid', uid);
    put('email', email);
    put('displayname', name);
    // a name the invitee chose over the invited one proves nothing to the certificate ledger (ComplianceDocs.gs)
    put('nameby', hubNameFold_(name) !== hubNameFold_(row.name) ? 'self' : '');
    put('role', 'staff');
    put('salt', salt);
    put('passhash', hashPassword_(pw, salt));
    put('active', 'true');
    put('createdat', new Date().toISOString());
    put('phone', str_(fresh.phone));
    put('hometenant', str_(fresh.tenant));
    // No must_change flag: the password is the user's own choice.
    sheet.appendRow(line);

    var iSheet = invitesSheet_();
    var iValues = iSheet.getDataRange().getValues();
    var iHdr = iValues[0].map(normKey_);
    var cId = iHdr.indexOf('inviteid');
    for (var r = 1; r < iValues.length; r++) {
      if (str_(iValues[r][cId]) !== str_(fresh.inviteid)) continue;
      if (iHdr.indexOf('status') !== -1) iSheet.getRange(r + 1, iHdr.indexOf('status') + 1).setValue('registered');
      if (iHdr.indexOf('registeredat') !== -1) iSheet.getRange(r + 1, iHdr.indexOf('registeredat') + 1).setValue(new Date().toISOString());
      if (iHdr.indexOf('userid') !== -1) iSheet.getRange(r + 1, iHdr.indexOf('userid') + 1).setValue(uid);
      break;
    }
    invitesRowsBump_();
    hubSysLog_(email, 'inviteRegister', uid, { status: 200 });
    return { status: 200, data: { token: sessionCreate_(uid),
             user: { id: uid, email: email, display_name: name, role: 'staff' } } };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
