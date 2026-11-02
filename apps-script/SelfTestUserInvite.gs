// SETTINGS → USERS → INVITE IS THE INVITATION.
// The door hands a person the way into an account (a sign-in and a first password), so its letter claims the…

function stUserInviteDoor_(out) {
  var keep = { sits: smartSituations_, call: rpcCall_, sheet: hubSheet_, prop: hubProp_, log: hubSysLog_,
               num: packetSendableNumber_, url: mailPlatformUrl_, said: HUB_LETTER_UNREADABLE_SAID,
               record: smartRecord_, shared: commReleaseSharedLine_ };
  var pw = 'Fp7!st-9';
  var calls = [];
  var ledger = [];
  var admin = { email: 'admin@example.org', role: 'admin', display_name: 'Sam' };
  var head = ['user_id', 'email', 'display_name', 'pass_hash', 'must_change', 'active', 'last_login', 'phone'];
  var grid = [head, ['U1', 'pat@example.org', 'Pat Doe', '', 'true', 'true', '', '+13305550142']];
  var answers = {};
  var row = function (enabled, channels) {
    return { id: 'user_account_invite', enabled: enabled, channels: channels || 'email, sms',
             sms_text: 'Sign in with {login}{password_line}', email_subject: 'Welcome, {first_name}',
             email_text: 'Hi {first_name}{by_inviter}.' };
  };
  var invite = function (ids) {
    calls.length = 0;
    ledger.length = 0;
    return HUB_ACTIONS.userInvite({ user_ids: ids || ['U1'] }, admin);
  };
  try {
    hubSysLog_ = function () { return true; };
    HUB_LETTER_UNREADABLE_SAID = {};
    hubProp_ = function (k) { return k === 'FIRST_USER_PASSWORD' ? pw : ''; };
    hubSheet_ = function () {
      return { getDataRange: function () { return { getValues: function () { return grid; } }; } };
    };
    packetSendableNumber_ = function (n) { return String(n || '').indexOf('+1') === 0 ? String(n) : ''; };
    mailPlatformUrl_ = function () { return 'https://hub.example'; };
    commReleaseSharedLine_ = function () { return false; };
    smartRecord_ = function (key, sit, who, exp, channel) { ledger.push([sit, who, channel]); return true; };
    rpcCall_ = function (m, p) {
      calls.push({ m: m, p: p });
      var a = answers[m];
      if (typeof a === 'function') return a(p);
      return a;
    };

    // ── the switches: the invitation's first, then the letter's own ──────────
    smartSituations_ = function () { return [row('yes'), { id: 'auth_invitation', enabled: 'no' }]; };
    var kindOff = invite();
    stAssert_(out, 'user invite door: auth_invitation off stops it — even with its own row on, nobody is written ' +
                   'to, and the answer is `off` naming the invitation\'s switch',
              kindOff.status === 200 && kindOff.data.state === 'off' && kindOff.data.situation === 'auth_invitation' &&
              kindOff.data.planted === true &&
              String(kindOff.data.why).indexOf('stops every invitation') !== -1 && calls.length === 0,
              JSON.stringify(kindOff));
    smartSituations_ = function () { throw new Error('the situations tab did not answer'); };
    var kindUnread = invite();
    stAssert_(out, 'user invite door: an unreadable switch HOLDS the press — nobody is written to, and the answer ' +
                   'is `held` with the reason, never a silent no and never a send',
              kindUnread.status === 200 && kindUnread.data.state === 'held' &&
              kindUnread.data.situation === 'auth_invitation' && kindUnread.data.planted === null &&
              String(kindUnread.data.why).indexOf('could not be read') !== -1 && calls.length === 0,
              JSON.stringify(kindUnread));
    smartSituations_ = function () { return [row('no'), { id: 'auth_invitation', enabled: 'yes' }]; };
    var ownOff = invite();
    stAssert_(out, 'user invite door: its own row off stops it too, named as its own switch — a new message ' +
                   'arrives disabled',
              ownOff.data.state === 'off' && ownOff.data.situation === 'user_account_invite' &&
              ownOff.data.planted === true && calls.length === 0,
              JSON.stringify(ownOff));
    smartSituations_ = function () { return [{ id: 'auth_invitation', enabled: 'yes' }]; };
    var ownAbsent = invite();
    stAssert_(out, 'user invite door: its own row not planted yet stops it, and the answer says the row is not ' +
                   'there yet (`planted` false) rather than that somebody switched it off',
              ownAbsent.data.state === 'off' && ownAbsent.data.situation === 'user_account_invite' &&
              ownAbsent.data.planted === false &&
              String(ownAbsent.data.why).indexOf('not in the situations tab yet') !== -1 && calls.length === 0,
              JSON.stringify(ownAbsent));

    // ── the claim: on the letter, never on the text ────────────────────────────
    smartSituations_ = function () { return [row('yes'), { id: 'auth_invitation', enabled: 'yes' }]; };
    answers = { emailSend: { ok: true, sent: true, receipt: 'st' }, smsSend: { ok: true, sent: true, receipt: 'st' } };
    var both = invite();
    var mail = calls.filter(function (c) { return c.m === 'emailSend'; })[0] || { p: {} };
    var text = calls.filter(function (c) { return c.m === 'smsSend'; })[0] || { p: {} };
    stAssert_(out, 'user invite door: the letter claims the invitation kind and the text claims nothing — the ' +
                   'split every invitation makes',
              mail.p.auth_letter === 'invitation' && text.p.auth_letter === undefined &&
              String(mail.p.reason) === 'smart comms: user_account_invite' &&
              String(text.p.reason) === 'smart comms: user_account_invite',
              JSON.stringify([mail.p.auth_letter, text.p.auth_letter, mail.p.reason]));
    stAssert_(out, 'user invite door: both legs left — `sent`, by both, and one ledger line under its own situation',
              both.data.state === 'sent' && both.data.sent.length === 1 && both.data.sent[0].via === 'email+sms' &&
              ledger.length === 1 && ledger[0][0] === 'user_account_invite' && ledger[0][2] === 'email+sms',
              JSON.stringify([both.data, ledger]));

    // ── DELIVERED WHILE THE LANE HOLDS: the letter leaves, the text is held ──
    answers = { emailSend: { ok: true, sent: true, receipt: 'st' },
                smsSend: { ok: true, sent: false, rehearsed: true, reason: 'test mode is on' } };
    var lane = invite();
    stAssert_(out, 'user invite door: with the lane holding, the letter still leaves and the held text is said ' +
                   'beside it — never counted, never hidden',
              lane.data.state === 'sent' && lane.data.sent[0].via === 'email' &&
              String(lane.data.sent[0].why).indexOf('the text held (rehearsal)') !== -1 && ledger.length === 1,
              JSON.stringify(lane.data));

    // ── held, already, refused: each in its own words, none counted as sent ──
    answers = { emailSend: { ok: true, sent: false, gated: true, reason: 'quiet_hours', quiet: true },
                smsSend: { ok: true, sent: false, gated: true, reason: 'HUB_RPC_SEND is off' } };
    var held = invite();
    stAssert_(out, 'user invite door: every leg held is `held`, each brake named, and no ledger line',
              held.data.state === 'held' && held.data.held.length === 1 && held.data.sent.length === 0 &&
              String(held.data.held[0].why).indexOf('the letter held (quiet_hours)') !== -1 &&
              String(held.data.held[0].why).indexOf('the text held (send_switch_off)') !== -1 && ledger.length === 0,
              JSON.stringify(held.data));
    smartSituations_ = function () { return [row('yes', 'sms'), { id: 'auth_invitation', enabled: 'yes' }]; };
    answers = { smsSend: { ok: true, sent: false, deduplicated: true } };
    var again = invite();
    stAssert_(out, 'user invite door: a re-press whose text already left is `already` — not sent again, and not ' +
                   'called sent',
              again.data.state === 'already' && again.data.sent.length === 0 && again.data.held.length === 1 &&
              again.data.held[0].state === 'already' &&
              String(again.data.held[0].why).indexOf('already went out') !== -1 && ledger.length === 0,
              JSON.stringify(again.data));
    smartSituations_ = function () { return [row('yes', 'email'), { id: 'auth_invitation', enabled: 'yes' }]; };
    answers = { emailSend: { ok: true, sent: false, reason: 'opted_out' } };
    var stop = invite();
    stAssert_(out, 'user invite door: an opt-out is a refusal in the person\'s words — the exemption never steps ' +
                   'over somebody who asked us to stop',
              stop.data.state === 'refused' && stop.data.skipped.length === 1 &&
              String(stop.data.skipped[0].why).indexOf('the person asked us to stop') !== -1,
              JSON.stringify(stop.data));
    answers = { emailSend: function () { throw new Error('the transport fell over'); } };
    var threw = invite();
    stAssert_(out, 'user invite door: a send door that throws is a refusal with its reason, never a lost answer',
              threw.status === 200 && threw.data.state === 'refused' &&
              String(threw.data.skipped[0].why).indexOf('the transport fell over') !== -1,
              JSON.stringify(threw.data));

    // ── a first password is never texted to a shared line ─────────────────────
    smartSituations_ = function () { return [row('yes'), { id: 'auth_invitation', enabled: 'yes' }]; };
    answers = { emailSend: { ok: true, sent: true, receipt: 'st' }, smsSend: { ok: true, sent: true, receipt: 'st' } };
    commReleaseSharedLine_ = function (n) { return String(n) === '+13305550142'; };
    var shared = invite();
    var sharedTexts = calls.filter(function (c) { return c.m === 'smsSend'; }).length;
    stAssert_(out, 'user invite door: a first password is not texted to a shared line — the text is refused and ' +
                   'said beside the letter that left, and no text is handed to the door',
              shared.data.state === 'sent' && shared.data.sent[0].via === 'email' && sharedTexts === 0 &&
              String(shared.data.sent[0].why).indexOf('shared line') !== -1,
              JSON.stringify([shared.data, sharedTexts]));
    commReleaseSharedLine_ = undefined;
    var blind = invite();
    var blindTexts = calls.filter(function (c) { return c.m === 'smsSend'; }).length;
    stAssert_(out, 'user invite door: without the shared-line reader the password text is refused, never sent blind',
              blind.data.state === 'sent' && blindTexts === 0 &&
              String(blind.data.sent[0].why).indexOf('could not be asked') !== -1,
              JSON.stringify([blind.data, blindTexts]));
    commReleaseSharedLine_ = function () { return false; };

    // ── several accounts: the press is `mixed`, each list says its own ─────────
    smartSituations_ = function () { return [row('yes', 'email'), { id: 'auth_invitation', enabled: 'yes' }]; };
    grid = [head, ['U1', 'pat@example.org', 'Pat Doe', '', 'true', 'true', '', ''],
            ['U2', 'lee@example.org', 'Lee Roe', '', 'true', 'false', '', '']];
    answers = { emailSend: { ok: true, sent: true, receipt: 'st' } };
    var mixed = invite(['U1', 'U2']);
    stAssert_(out, 'user invite door: one sent and one refused is `mixed`, and the refused one says why',
              mixed.data.state === 'mixed' && mixed.data.sent.length === 1 && mixed.data.skipped.length === 1 &&
              String(mixed.data.skipped[0].why).indexOf('not active') !== -1,
              JSON.stringify(mixed.data));

    // ── the Desk and the book ──────────────────────────────────────────────────
    var claimed = (typeof HUB_AUTH_ALSO_CLAIMED !== 'undefined' && HUB_AUTH_ALSO_CLAIMED.invitation) || [];
    var seed = hubDisabledLetterSeeds_().filter(function (s) { return s.id === 'user_account_invite'; })[0] || {};
    stAssert_(out, 'user invite door: the Desk draws it under the invitation, sending only while both rows are on, ' +
                   'and its seed arrives off and says so',
              claimed.some(function (a) { return a.id === 'user_account_invite' && String(a.door).indexOf('Users') !== -1; }) &&
              seed.enabled === 'no' && String(seed.note).indexOf('auth_invitation are both on') !== -1 &&
              String(HUB_AUTH_LETTERS.invitation).indexOf('HubCore.gs') !== -1,
              JSON.stringify([claimed, seed.enabled]));
  } finally {
    smartSituations_ = keep.sits; rpcCall_ = keep.call; hubSheet_ = keep.sheet; hubProp_ = keep.prop;
    hubSysLog_ = keep.log; packetSendableNumber_ = keep.num; mailPlatformUrl_ = keep.url;
    HUB_LETTER_UNREADABLE_SAID = keep.said; smartRecord_ = keep.record; commReleaseSharedLine_ = keep.shared;
    if (typeof hubSecretsRelease_ === 'function') hubSecretsRelease_();
  }
}
