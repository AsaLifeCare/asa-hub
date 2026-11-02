// ReleaseUsers.gs resolves who hears; `Goes to` is never read, so no cell can mail one person's password to another.
var COMM_RELEASE_INVITE_SITUATION = 'user_release_invite';

var COMM_RELEASE_APP_SITUATION = 'app_release_announced';

// The row, and WHICH absence it is.
function commReleaseSituationRead_(id) {
  var rows = null;
  try {
    if (typeof smartSituations_ !== 'function') throw new Error('the situations reader is not loaded');
    rows = smartSituations_();
  } catch (e) {
    return { sit: null, state: 'unreadable', error: String((e && e.message) || e) };
  }
  var sit = null;
  (rows || []).forEach(function (s) { if (String((s && s.id) || '').trim() === id) sit = s; });
  if (!sit) return { sit: null, state: 'absent', error: '' };
  var on = (typeof smartOn_ === 'function') ? smartOn_(sit.enabled) : false;
  if (!on) return { sit: null, state: 'off', error: '' };
  if (!commReleaseChannels_(sit).length) return { sit: null, state: 'wordless', error: '' };
  return { sit: sit, state: 'on', error: '' };
}

function commReleaseSituation_(id) {
  return commReleaseSituationRead_(id).sit;
}

/** The sentence for a row that cannot speak, per state. */
function commReleaseSituationWhy_(id, read) {
  var state = String((read && read.state) || '');
  if (state === 'unreadable') {
    return 'the Smart Comms situations could not be read (' + String(read.error || 'no answer') +
           ') — nobody was written to';
  }
  if (state === 'absent') return 'the situation `' + id + '` does not exist in Smart Comms — nobody was written to';
  if (state === 'off') return 'the situation `' + id + '` is switched off in Smart Comms — nobody was written to';
  return 'the situation `' + id + '` has no written words on a channel it names — nobody was written to';
}

function commReleaseChannels_(sit) {
  var named = (typeof smartList_ === 'function') ? smartList_(sit.channels) : [];
  var out = [];
  if (named.indexOf('sms') !== -1 && String(sit.sms_text || '').trim()) out.push('sms');
  if (named.indexOf('email') !== -1 &&
      (String(sit.email_text || '').trim() || String(sit.sms_text || '').trim())) out.push('email');
  return out;
}

function commReleaseBlocks_(text) {
  return String(text || '').split(/\n{2,}/)
    .map(function (p) { return String(p).trim(); })
    .filter(String)
    .map(function (p) { return mailPara_(mailEsc_(p).replace(/\n/g, '<br>')); });
}

function commReleaseSharedLine_(num) {
  try {
    return (typeof hubSharedLine_ === 'function') ? !!hubSharedLine_(num) : false;
  } catch (e) { return false; }
}

// WHICH BRAKE HELD IT, IN ONE WORD.
function commReleaseHeldReason_(res) {
  if (!res) return '';
  if (res.rehearsed || res.redirected) return 'rehearsal';
  if (res.recorded_to) return 'recorded_to';
  var reason = String(res.reason || '');
  if (reason === 'opted_out') return commReleaseOptOutUnread_(res.detail) ? 'opt_out_unreadable' : 'opted_out';
  if (reason === 'quiet_hours') return 'quiet_hours';
  if (reason.indexOf('HUB_RPC_SEND') !== -1) return 'send_switch_off';
  return reason || 'held';
}

// AN OPT-OUT LIST THAT COULD NOT BE READ IS NOT A PERSON WHO SAID STOP.
var COMM_RELEASE_OPT_OUT_UNREAD = /opt-out list could not be (read|checked)/i;

function commReleaseOptOutUnread_(detail) {
  return COMM_RELEASE_OPT_OUT_UNREAD.test(String(detail || ''));
}

// WHAT KIND OF HOLD, for counting.
function commReleaseHoldKind_(res) {
  if (!res) return 'dial';
  var reason = String(res.reason || '');
  if (res.quiet || reason === 'quiet_hours') return 'quiet';
  if (reason === 'opted_out') return commReleaseOptOutUnread_(res.detail) ? 'unchecked' : 'declined';
  return 'dial';
}

// `sent` and `held` are never added together: a rehearsal is not a person being told.
function commReleaseTell_(sit, chans, vars, who, reason, idem, html, secret, authKind) {
  // `named_sent` / `named_deduplicated` count only the legs whose delivered words carry the secret: the words live…
  var out = { sent: 0, held: 0, deduplicated: 0, legs: [], why: [], held_reason: '',
              held_dial: 0, held_quiet: 0, declined: 0, unchecked: 0,
              named_sent: 0, named_deduplicated: 0 };
  // A first-password letter is a sign-in letter: the quiet window does not hold it.
  var quietExempt = secret ? 'sign_in' : '';
  // The secret itself, when the caller names it: every record of both legs withholds it.
  var secretText = (typeof secret === 'string') ? secret : '';
  var email = String((who && who.email) || '').trim();
  var phone = String((who && who.phone) || '').trim();
  var names = function () {
    if (!secretText) return false;
    var esc = (typeof mailEsc_ === 'function') ? String(mailEsc_(secretText)) : secretText;
    for (var i = 0; i < arguments.length; i++) {
      var w = String(arguments[i] == null ? '' : arguments[i]);
      if (w.indexOf(secretText) !== -1 || (esc && w.indexOf(esc) !== -1)) return true;
    }
    return false;
  };

  var land = function (channel, res, label, named) {
    if (res && res.ok && res.sent && !res.redirected) {
      out.sent++; out.legs.push(channel);
      if (named) out.named_sent++;
      else if (secretText) out.why.push(label + ': it left, but its words do not name the password');
      return;
    }
    // ALREADY SENT IS NOT REFUSED.
    if (res && res.deduplicated) {
      out.deduplicated++; out.legs.push(channel + ' (already sent)');
      if (named) out.named_deduplicated++;
      out.why.push(label + ': this exact letter already went out — not sent again');
      return;
    }
    if (res && (res.redirected || res.gated || res.rehearsed || res.recorded_to)) {
      out.held++; out.legs.push(channel + ' (held)');
      if (!out.held_reason) out.held_reason = commReleaseHeldReason_(res);
      var kind = commReleaseHoldKind_(res);
      if (kind === 'quiet') out.held_quiet++;
      else if (kind === 'declined') out.declined++;
      else if (kind === 'unchecked') out.unchecked++;
      else out.held_dial++;
      // an opt-out's sentence says whether somebody said stop or the list could not be read
      out.why.push(label + ': ' + String((String(res.reason || '') === 'opted_out' && res.detail) ||
                                         res.reason || 'held by a brake'));
      return;
    }
    out.why.push(label + ': ' + String((res && (res.error || res.detail)) || 'the send door refused'));
  };

  if (email && email.indexOf('@') !== -1 && chans.indexOf('email') !== -1) {
    var res = null, letterNames = false;
    try {
      var letter = {
        to: email,
        subject: smartRender_(sit.email_subject, vars),
        body: smartRender_(sit.email_text || sit.sms_text, vars),
        html: html || '',
        reason: reason
      };
      if (secretText) letter.withhold = [secretText];
      if (authKind) letter.auth_letter = String(authKind);
      letterNames = names(letter.body, letter.html);
      res = rpcCall_('emailSend', letter,
                     { idempotency_key: idem + '_email', quiet_exempt: quietExempt });
    } catch (eE) { out.why.push('email: ' + String((eE && eE.message) || eE)); res = null; }
    if (res) land('email', res, 'email', letterNames);
  } else if (chans.indexOf('email') === -1) {
    out.why.push('email: this row has no written letter');
  } else {
    out.why.push('email: the account signs in with a number, so there is no mailbox');
  }

  if (chans.indexOf('sms') === -1) {
    out.why.push('sms: this row has no written text');
  } else if (!phone) {
    out.why.push('sms: no number on the account');
  } else if (secret && commReleaseSharedLine_(phone)) {
    // A temporary password is never texted to a shared line; the refusal is reported, not swallowed.
    out.why.push('sms: that number is a shared line — a temporary password is not texted there');
  } else {
    var num = (typeof packetTeamCopyNumber_ === 'function') ? packetTeamCopyNumber_(phone) : '';
    if (!num) {
      out.why.push('sms: ' + phone.slice(0, 20) + ' is not a number we may text');
    } else {
      var sres = null, textNames = false;
      try {
        var text = { to: num, body: smartRender_(sit.sms_text, vars), reason: reason };
        if (secretText) text.withhold = [secretText];
        textNames = names(text.body);
        sres = rpcCall_('smsSend', text, { idempotency_key: idem + '_sms', quiet_exempt: quietExempt });
      } catch (eS) { out.why.push('sms: ' + String((eS && eS.message) || eS)); sres = null; }
      if (sres) land('sms', sres, 'sms', textNames);
    }
  }
  return out;
}

// THE INVITE IS THE INVITATION — the letter that hands a released person the way into their account, so it claims…
var COMM_RELEASE_INVITE_AUTH_KIND = 'invitation';

// ONE SWITCH STOPS EVERY INVITATION.
function commReleaseInviteAuthGate_() {
  var gate = null;
  try {
    gate = (typeof hubAuthLetterAllowed_ === 'function')
      ? hubAuthLetterAllowed_(COMM_RELEASE_INVITE_AUTH_KIND)
      : { on: false, unreadable: true, why: 'the authentication letters\' switch is not in this build' };
  } catch (e) {
    gate = { on: false, unreadable: true, why: String((e && e.message) || e) };
  }
  if (gate && gate.on) return null;
  var sid = (typeof hubAuthSituationId_ === 'function')
    ? hubAuthSituationId_(COMM_RELEASE_INVITE_AUTH_KIND) : 'auth_invitation';
  return gate && gate.unreadable
    ? { state: 'unreadable',
        why: 'the invitation situation (' + sid + ') could not be read — nobody was written to' }
    : { state: 'invitation_off',
        why: 'the invitation situation (' + sid + ') is switched off in Smart Comms, and it stops every ' +
             'invitation, the release invite too — nobody was written to' };
}

// NEVER THROWS.
function commReleaseInviteTell_(person, idem) {
  var out = { sent: 0, held: 0, deduplicated: 0, legs: [], why: [],
              state: 'quiet', held_reason: '', situation_state: '' };
  try {
    return commReleaseInviteBuild_(out, person, idem);
  } catch (e) {
    out.why.push('the invite could not be built: ' + String((e && e.message) || e));
    out.state = 'no_door';
    return out;
  }
}

// WOULD THE LETTER GO — read before the press, for the card the master reads.
function commReleaseInviteReach_(email) {
  var read = commReleaseSituationRead_(COMM_RELEASE_INVITE_SITUATION);
  if (!read.sit) {
    return { goes: false, blocked_by: 'situation_' + read.state,
             why: [commReleaseSituationWhy_(COMM_RELEASE_INVITE_SITUATION, read)] };
  }
  var authStop = commReleaseInviteAuthGate_();
  if (authStop) return { goes: false, blocked_by: 'situation_' + authStop.state, why: [authStop.why] };
  if (commReleaseChannels_(read.sit).indexOf('email') === -1) {
    return { goes: false, blocked_by: 'situation_wordless',
             why: ['the situation `' + COMM_RELEASE_INVITE_SITUATION + '` writes no letter — only a text, ' +
                   'which test mode and the sending switch still hold'] };
  }
  var stopped = '';
  try {
    stopped = (typeof optOutBlocked_ === 'function') ? String(optOutBlocked_(email) || '') : '';
  } catch (e) {
    stopped = 'The opt-out list could not be checked: ' + String((e && e.message) || e);
  }
  if (stopped) {
    return { goes: false, blocked_by: commReleaseOptOutUnread_(stopped) ? 'opt_out_unreadable' : 'opted_out',
             why: ['email: ' + stopped] };
  }
  return { goes: true, blocked_by: '', why: [] };
}

function commReleaseInviteBuild_(out, person, idem) {
  var p = person || {};
  var read = commReleaseSituationRead_(COMM_RELEASE_INVITE_SITUATION);
  var sit = read.sit;
  out.situation_state = read.state;
  if (!sit) {
    out.state = 'wordless';
    out.why.push(commReleaseSituationWhy_(COMM_RELEASE_INVITE_SITUATION, read));
    return out;
  }
  var authStop = commReleaseInviteAuthGate_();
  if (authStop) {
    out.state = 'wordless';
    out.situation_state = authStop.state;
    out.why.push(authStop.why);
    return out;
  }
  if (typeof rpcCall_ !== 'function') {
    out.state = 'no_door';
    out.why.push('the send door is not loaded — nobody was written to');
    return out;
  }

  var chans = commReleaseChannels_(sit);
  var full = String(p.name || '').trim();
  var url = String(p.url || ((typeof mailPlatformUrl_ === 'function') ? mailPlatformUrl_() : ''));
  var vars = {
    first_name: full.split(/\s+/)[0] || '',
    name: full,
    login: String(p.login || ''),
    password: String(p.password || ''),
    url: url,
    sender: (typeof SMART_SENDER_DEFAULT !== 'undefined') ? SMART_SENDER_DEFAULT : ''
  };

  // Login and password ride as mono blocks so an O and a 0 can be told apart.
  var blocks = commReleaseBlocks_(smartRender_(sit.email_text || sit.sms_text, vars));
  if (vars.login) blocks.splice(1, 0, mailFact_('Your sign-in', vars.login, true));
  if (vars.password) blocks.splice(2, 0, mailFact_('Temporary password', vars.password, true));
  var html = (typeof mailShell_ === 'function') ? mailShell_({
    eyebrow: 'ASA Hub',
    title: smartRender_(sit.email_subject, vars),
    preheader: 'Your account is ready to use.',
    blocks: blocks,
    cta: url ? { label: 'Open the platform', href: url } : null,
    footnote: 'This temporary password was made for you alone, and the platform asks you to ' +
              'choose your own the first time you sign in with it.'
  }) : '';

  // THE WORDS ARE WRITTEN DOWN; THE CREDENTIAL IS NOT.
  var secret = String(vars.password || '');
  var told;
  try {
    if (secret && typeof hubSecretsHold_ === 'function') hubSecretsHold_([secret]);
    told = commReleaseTell_(sit, chans, vars,
                            { email: p.email, phone: p.phone },
                            'release: ' + COMM_RELEASE_INVITE_SITUATION,
                            String(idem || 'release_invite'), html, secret || true,
                            COMM_RELEASE_INVITE_AUTH_KIND);
  } finally {
    if (secret && typeof hubSecretsRelease_ === 'function') hubSecretsRelease_();
  }
  out.sent = told.sent; out.held = told.held; out.legs = told.legs; out.why = told.why;
  out.deduplicated = told.deduplicated || 0;
  out.named_sent = told.named_sent || 0;
  out.named_deduplicated = told.named_deduplicated || 0;
  out.held_reason = told.held_reason || '';
  out.state = out.sent ? 'told' : (out.held ? 'held' : (out.deduplicated ? 'already' : 'quiet'));

  // Ledger only when something really left, so a held pass stays retryable.
  if (out.sent && typeof smartRecord_ === 'function') {
    try {
      smartRecord_(smartLedgerKey_(COMM_RELEASE_INVITE_SITUATION, String(p.login || full),
                                   new Date().toISOString().slice(0, 10)),
                   COMM_RELEASE_INVITE_SITUATION, full, '', out.legs.join('+') || 'email');
    } catch (eL) { }
  }
  return out;
}

function commReleaseAppTell_(person, app, idem) {
  var out = { sent: 0, held: 0, deduplicated: 0, legs: [], why: [],
              state: 'quiet', held_reason: '' };
  var p = person || {}, a = app || {};
  var read = commReleaseSituationRead_(COMM_RELEASE_APP_SITUATION);
  var sit = read.sit;
  if (!sit) {
    out.state = 'wordless';
    out.why.push(commReleaseSituationWhy_(COMM_RELEASE_APP_SITUATION, read));
    return out;
  }
  if (typeof rpcCall_ !== 'function') { out.state = 'no_door'; return out; }

  var chans = commReleaseChannels_(sit);
  var full = String(p.name || '').trim();
  var url = String(a.url || ((typeof mailPlatformUrl_ === 'function') ? mailPlatformUrl_() : ''));
  var title = String(a.title || a.id || 'a new app');
  var vars = {
    first_name: full.split(/\s+/)[0] || '',
    name: full,
    app_title: title,
    objective: String(a.objective || ''),
    url: url,
    sender: (typeof SMART_SENDER_DEFAULT !== 'undefined') ? SMART_SENDER_DEFAULT : ''
  };

  var blocks = commReleaseBlocks_(smartRender_(sit.email_text || sit.sms_text, vars));
  if (vars.objective) blocks.splice(1, 0, mailFact_('Objective', vars.objective, false));
  var html = (typeof mailShell_ === 'function') ? mailShell_({
    eyebrow: 'ASA Hub',
    title: title + ' is now open to you',
    preheader: 'An app on your workspace just opened to you.',
    blocks: blocks,
    cta: url ? { label: 'Open the platform', href: url } : null,
    footnote: 'You are receiving this because your access opens ' + mailEsc_(title) +
              ' on the ASA Hub.'
  }) : '';

  // THE REASON ENDS AT THE SITUATION'S ID.
  var told = commReleaseTell_(sit, chans, vars,
                              { email: p.email, phone: p.phone },
                              'release: ' + COMM_RELEASE_APP_SITUATION,
                              String(idem || 'release_app'), html, false);
  out.sent = told.sent; out.held = told.held; out.legs = told.legs; out.why = told.why;
  out.deduplicated = told.deduplicated || 0;
  out.held_reason = told.held_reason || '';
  // the kind of each hold rides up, so a run counts the dial apart from a stop
  out.held_dial = told.held_dial || 0;
  out.held_quiet = told.held_quiet || 0;
  out.declined = told.declined || 0;
  out.unchecked = told.unchecked || 0;
  out.state = out.sent ? 'told' : (out.held ? 'held' : (out.deduplicated ? 'already' : 'quiet'));
  return out;
}
