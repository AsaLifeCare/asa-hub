// WHAT A REVIEW OF THE INTEGRATED PACKAGE FOUND, EACH PINNED WHERE IT WAS FOUND.
// Every door, store and transport is stood in for and put back in a `finally`; nothing here can reach a provider or…

function stPackageRepair_(out) {
  var parts = [
    ['test mode word', stRepTestModeWord_],
    ['platform mail switch', stRepPlatformMailSwitch_],
    ['outreach switch', stRepOutreachAllowed_],
    ['mail ledger secrets', stRepMailLedgerSecrets_],
    ['release invite auth', stRepReleaseInviteAuth_],
    ['release named leg', stRepReleaseNamedLeg_],
    ['app release quiet', stRepAppReleaseQuiet_],
    ['staff alerts', stRepStaffAlerts_],
    ['invitation words', stRepInvitationWords_],
    ['user invite', stRepUserInvite_],
    ['mailbox provision', stRepMailboxEnsure_],
    ['situations read cost', stRepSituationsCost_],
    ['letter channels', stRepLetterChannels_],
    ['suggestion place', stRepSuggestionPlace_],
    ['feature grants', stRepFeatureGrants_],
    ['held book writes', stRepHeldWrites_],
    ['lanes as situations', stRepLaneSituations_],
    ['notices as situations', stRepNoticeSituations_]
  ];
  parts.forEach(function (p) {
    try { p[1](out); }
    catch (e) { stAssert_(out, 'package repair, ' + p[0] + ': the part ran', false, String((e && e.stack) || e)); }
  });
}

/** A test_mode word outside the vocabulary holds everywhere and is named. */
function stRepTestModeWord_(out) {
  var keep = {
    cfg: hiringAlerts_, log: hubSysLog_,
    why: HUB_SWITCH_UNREADABLE_WHY, said: HUB_SWITCH_UNREADABLE_SAID,
    dialMemo: COMM_DIAL_MEMO, dialUnreadable: COMM_DIAL_UNREADABLE
  };
  var got = {};
  try {
    hubSysLog_ = function () { return true; };
    var typos = ['yes', 'enabled', 'sheets', 'rehersal'];
    got.typos = typos.map(function (w) {
      var st = hubTestModeState_({ test_mode: w });
      return { w: w, on: st.on, unrecognized: st.unrecognized };
    });
    stAssert_(out, 'test mode word: a word outside the vocabulary resolves to ON and is named, never to ' +
                   'production — even with no tester listed',
              got.typos.every(function (t) { return t.on === true && t.unrecognized === t.w; }),
              JSON.stringify(got.typos));
    var blank = hubTestModeState_({ test_mode: '' });
    var blankTester = hubTestModeState_({ test_mode: '', test_redirect_sms: '+13305550101' });
    var off = hubTestModeState_({ test_mode: 'production' });
    var sheet = hubTestModeState_({ test_mode: 'paper' });
    stAssert_(out, 'test mode word: the blank cell and the known words answer as before',
              blank.on === false && blank.unrecognized === '' && blankTester.on === true &&
              off.on === false && off.unrecognized === '' && sheet.on === true && sheet.unrecognized === '',
              JSON.stringify([blank, blankTester, off, sheet]));

    hiringAlerts_ = function () { return { test_mode: 'enabled' }; };
    HUB_SWITCH_UNREADABLE_WHY = '';
    HUB_SWITCH_UNREADABLE_SAID = false;
    got.toSheet = hubRehearsalToSheet_();
    got.why = hubSwitchUnreadableWhy_();
    var redirect = hubTestRedirect_();
    got.redirect = { sheet: !!(redirect && redirect.sheet), unreadable: !!(redirect && redirect.unreadable) };
    COMM_DIAL_MEMO = '';
    got.dial = commDialRead_();
    got.dialUnreadable = COMM_DIAL_UNREADABLE;
    got.onThrew = '';
    try { hubTestModeOn_(); } catch (eOn) { got.onThrew = String((eOn && eOn.message) || eOn); }
    stAssert_(out, 'test mode word: every door holds on it — the rehearsal writer, the redirect and the ' +
                   'sending dial — and the held rows name the word',
              got.toSheet === true && got.redirect.sheet === true && got.redirect.unreadable === true &&
              got.dial !== 'send' && got.dialUnreadable === true &&
              got.why.indexOf('"enabled"') !== -1 && got.onThrew.indexOf('"enabled"') !== -1,
              JSON.stringify(got));

    var laneSrc = stCode_(HUB_ACTIONS.configLane);
    stAssert_(out, 'test mode word: the configuration lane hands the relay `unreadable` for it, so the ' +
                   'relay holds too',
              laneSrc.indexOf('testState.unrecognized') !== -1 &&
              laneSrc.indexOf('unreadable: hubTestModeUnknownWhy_(') !== -1, '');

    got.refuseTyped = hubTestModeRefusal_({ test_mode: 'yes' }, { test_mode: 'yes' });
    got.refuseWhole = hubTestModeRefusal_({ test_mode: 'onn' }, null);
    got.refuseWithLists = hubTestModeRefusal_({ test_mode: 'hold', test_redirect_sms: '+13305550101' },
                                              { test_mode: 'hold', test_redirect_sms: '+13305550101' });
    got.allowSheet = hubTestModeRefusal_({ test_mode: 'sheet' }, { test_mode: 'sheet' });
    got.allowOff = hubTestModeRefusal_({ test_mode: 'off' }, { test_mode: 'off' });
    stAssert_(out, 'test mode word: the save refuses a word outside the vocabulary whether or not the ' +
                   'tester lists were touched, and still takes both positions',
              got.refuseTyped.indexOf('"yes"') !== -1 && got.refuseWhole.indexOf('"onn"') !== -1 &&
              got.refuseWithLists.indexOf('"hold"') !== -1 &&
              got.allowSheet === '' && got.allowOff === '',
              JSON.stringify([got.refuseTyped, got.refuseWhole, got.refuseWithLists, got.allowSheet, got.allowOff]));
  } finally {
    hiringAlerts_ = keep.cfg;
    hubSysLog_ = keep.log;
    HUB_SWITCH_UNREADABLE_WHY = keep.why;
    HUB_SWITCH_UNREADABLE_SAID = keep.said;
    COMM_DIAL_MEMO = keep.dialMemo;
    COMM_DIAL_UNREADABLE = keep.dialUnreadable;
  }
}

/** The Mail app's own switch: unreadable is never a yes. */
function stRepPlatformMailSwitch_(out) {
  var keep = { cfg: hiringAlerts_, call: rpcCall_ };
  var calls = 0;
  var user = { id: 'u-st', email: 'someone@example.com', role: 'staff' };
  var letter = { to: 'person@example.com', subject: 's', body: 'b' };
  try {
    rpcCall_ = function () { calls++; return { ok: true, sent: true }; };
    hiringAlerts_ = function () { throw new Error('the config sheet did not answer'); };
    var unreadable = HUB_ACTIONS.platformMailSend(letter, user);
    hiringAlerts_ = function () { return { platform_email_enabled: 'no' }; };
    var off = HUB_ACTIONS.platformMailSend(letter, user);
    stAssert_(out, 'platform mail switch: an unreadable switch refuses with 503 and says so; switched off ' +
                   'refuses as before; nothing reaches the send door in either case',
              unreadable.status === 503 && String(unreadable.message).indexOf('could not be read') !== -1 &&
              off.status === 503 && calls === 0,
              JSON.stringify([unreadable, off]) + ' calls=' + calls);
  } finally {
    hiringAlerts_ = keep.cfg;
    rpcCall_ = keep.call;
  }
}

/** The hiring doors' switch check: an unreadable tab is never a yes. */
function stRepOutreachAllowed_(out) {
  var keep = { sits: smartSituations_, call: rpcCall_ };
  var calls = 0;
  try {
    rpcCall_ = function () { calls++; return { ok: true, sent: true }; };
    smartSituations_ = function () { throw new Error('the situations tab did not answer'); };
    var unreadable = outreachAllowed_('hiring_welcome');
    var welcome = HUB_ACTIONS.hiringWelcomeSend ? HUB_ACTIONS.hiringWelcomeSend({}, { email: 'a@x', role: 'admin' }) : null;
    smartSituations_ = function () { return [{ id: 'hiring_welcome', enabled: 'no' }]; };
    var off = outreachAllowed_('hiring_welcome');
    smartSituations_ = function () { return []; };
    var absent = outreachAllowed_('hiring_welcome');
    stAssert_(out, 'outreach switch: an unreadable situations tab refuses and says to try again; off refuses; ' +
                   'absent still lets a pressed button through',
              unreadable.ok === false && unreadable.unreadable === true &&
              String(unreadable.reason).indexOf('could not be read') !== -1 &&
              off.ok === false && !off.unreadable && absent.ok === true,
              JSON.stringify([unreadable, off, absent]));
    stAssert_(out, 'outreach switch: a sweep that stops on an unreadable tab logs that, never "is OFF"',
              outreachIdleWhy_(unreadable, 'X is OFF').indexOf('could not be read') !== -1 &&
              outreachIdleWhy_(off, 'X is OFF') === 'X is OFF', '');
    if (welcome) {
      stAssert_(out, 'outreach switch: a pressed button on an unreadable tab sends nothing',
                welcome.status === 200 && welcome.data && welcome.data.sent === false && calls === 0,
                JSON.stringify(welcome) + ' calls=' + calls);
    }
  } finally {
    smartSituations_ = keep.sits;
    rpcCall_ = keep.call;
  }
}

/** No secret reaches the mail ledger: the transport's row or a collected Sent row. */
function stRepMailLedgerSecrets_(out) {
  var keep = {
    cfg: hiringAlerts_, sits: smartSituations_, creds: platformMailCreds_, post: platformMailPost_,
    mailLog: mailLogOut_, deciders: mailAlsoTellDeciders_, log: hubSysLog_, mWrite: commMockWrite_,
    rWrite: hubRehearsalWrite_, optOut: optOutBlocked_, record: smartRecord_,
    accounts: platformMailAccounts_, seen: mailLogSeenKeys_, append: mailLogAppend_,
    unreadable: HUB_SWITCH_UNREADABLE_WHY, said: HUB_SWITCH_UNREADABLE_SAID
  };
  var logged = [], posted = [], appended = [];
  var pw = 'Fp7!st';      // shorter than the eight characters `withhold` needs
  try {
    hubSysLog_ = function () { return true; };
    commMockWrite_ = function () { };
    hubRehearsalWrite_ = function () { return 'rh-st'; };
    optOutBlocked_ = function () { return ''; };
    smartRecord_ = function () { return true; };
    mailAlsoTellDeciders_ = function (s, t, cc) { return cc; };
    platformMailCreds_ = function () { return { user: 'asa-hub@asaop.org' }; };
    platformMailPost_ = function (path, body) { posted.push({ path: path, body: body }); return { status: 200, data: {} }; };
    mailLogOut_ = function (rec) { logged.push(rec); return true; };
    hiringAlerts_ = function () { return { test_mode: 'on' }; };   // the lane holds
    HUB_SWITCH_UNREADABLE_WHY = '';
    smartSituations_ = function () {
      return [
        { id: 'user_release_invite', enabled: 'yes', channels: 'email',
          email_subject: 'Your account', email_text: 'Sign in as {login}.\n\nTemporary password: {password}' },
        { id: 'auth_invitation', enabled: 'yes' }
      ];
    };
    var told = commReleaseInviteTell_({ email: 'released@example.org', name: 'Pat Doe', login: 'released@example.org',
                                        password: pw, url: 'https://hub.example' }, 'st_rel_' + Date.now());
    var ledgerText = JSON.stringify(logged);
    stAssert_(out, 'mail ledger: a release invite leaves while the lane holds and its first password never ' +
                   'reaches the transport\'s ledger row — subject, preview or body',
              told.sent === 1 && logged.length === 1 && ledgerText.indexOf(pw) === -1 &&
              posted.length === 1 && String(posted[0].body && posted[0].body.body).indexOf(pw) !== -1,
              JSON.stringify(told) + ' ' + ledgerText.slice(0, 300));
    hubSecretsHold_([pw]);
    var scrubbed = platformMailWithhold_('Temporary password: ' + pw, null);
    hubSecretsRelease_();
    var linked = platformMailWithhold_('Open https://hub.example/reset?t=abcdef0123456789',
                                       { withhold: 'https://hub.example/reset?t=abcdef0123456789' });
    stAssert_(out, 'mail ledger: the ledger withholds a held secret and a named link alike',
              scrubbed.indexOf(pw) === -1 && linked.indexOf('abcdef0123456789') === -1,
              scrubbed + ' | ' + linked);

    platformMailAccounts_ = function () { return [{ id: '1', user: 'asa-hub@asaop.org' }]; };
    mailLogSeenKeys_ = function () { return {}; };
    mailLogAppend_ = function (rec) { appended.push(rec); };
    platformMailPost_ = function (path, body) {
      var box = String((body && body.mailbox) || '');
      return { status: 200, data: { threads: [{
        id: box || 'in1', subject: 'x', from_addr: 'a@example.org',
        snippet: box === 'sent' ? 'Open https://hub.example/reset?t=LIVE-LINK-1234 to choose one' : 'Hello there'
      }] } };
    };
    var got = mailLogCollect_(5);
    var sentRow = appended.filter(function (r) { return r.box === 'sent'; })[0] || {};
    var inRow = appended.filter(function (r) { return r.box === 'inbox'; })[0] || {};
    stAssert_(out, 'mail ledger: a letter collected from the Sent box keeps its envelope and none of its ' +
                   'words, while an inbox letter keeps its preview',
              got.collected === 2 && sentRow.preview === '' &&
              JSON.stringify(sentRow).indexOf('LIVE-LINK') === -1 && inRow.preview === 'Hello there',
              JSON.stringify(appended));
  } finally {
    hiringAlerts_ = keep.cfg; smartSituations_ = keep.sits; platformMailCreds_ = keep.creds;
    platformMailPost_ = keep.post; mailLogOut_ = keep.mailLog; mailAlsoTellDeciders_ = keep.deciders;
    hubSysLog_ = keep.log; commMockWrite_ = keep.mWrite; hubRehearsalWrite_ = keep.rWrite;
    optOutBlocked_ = keep.optOut; smartRecord_ = keep.record; platformMailAccounts_ = keep.accounts;
    mailLogSeenKeys_ = keep.seen; mailLogAppend_ = keep.append;
    HUB_SWITCH_UNREADABLE_WHY = keep.unreadable; HUB_SWITCH_UNREADABLE_SAID = keep.said;
    hubSecretsRelease_();
  }
}

/** One switch stops every invitation, and the Desk draws the release invite as its own letter. */
function stRepReleaseInviteAuth_(out) {
  var keep = { sits: smartSituations_, call: rpcCall_, optOut: optOutBlocked_, log: hubSysLog_,
               letterSaid: HUB_LETTER_UNREADABLE_SAID };
  var calls = 0;
  var person = { email: 'released@example.org', name: 'Pat Doe', login: 'released@example.org',
                 password: 'Fp7!st', url: 'https://hub.example' };
  var rel = { id: 'user_release_invite', enabled: 'yes', channels: 'email',
              email_subject: 'Your account', email_text: 'Temporary password: {password}' };
  try {
    hubSysLog_ = function () { return true; };
    HUB_LETTER_UNREADABLE_SAID = {};
    optOutBlocked_ = function () { return ''; };
    rpcCall_ = function () { calls++; return { ok: true, sent: true, receipt: 'st' }; };
    smartSituations_ = function () { return [rel, { id: 'auth_invitation', enabled: 'no' }]; };
    var off = commReleaseInviteTell_(person, 'st_auth_off');
    var reachOff = commReleaseInviteReach_(person.email);
    stAssert_(out, 'release invite: switching auth_invitation off stops the release invite too — nothing ' +
                   'is asked of the send door, and the card and the refusal name that switch',
              calls === 0 && off.sent === 0 && off.state === 'wordless' &&
              off.situation_state === 'invitation_off' && releaseBrakeOf_(off) === 'situation_invitation_off' &&
              reachOff.goes === false && reachOff.blocked_by === 'situation_invitation_off',
              JSON.stringify([off, reachOff]) + ' calls=' + calls);
    smartSituations_ = function () { return [rel, { id: 'auth_invitation', enabled: 'yes' }]; };
    var on = commReleaseInviteTell_(person, 'st_auth_on');
    stAssert_(out, 'release invite: with both rows on it is asked of the send door as before',
              calls === 1 && on.sent === 1, JSON.stringify(on));

    var rows = [rel, { id: 'auth_invitation', enabled: 'no' }, { id: 'auth_password_reset', enabled: 'yes' }];
    var src = stCode_(HUB_ACTIONS.smartCommsGet);
    stAssert_(out, 'release invite: the Desk\'s letters are every situation that claims the exemption, the ' +
                   'release invite among them, off while auth_invitation is off',
              typeof HUB_AUTH_ALSO_CLAIMED !== 'undefined' &&
              HUB_AUTH_ALSO_CLAIMED.invitation[0].id === 'user_release_invite' &&
              src.indexOf('HUB_AUTH_ALSO_CLAIMED') !== -1 && src.indexOf('also_needs: sid') !== -1 &&
              src.indexOf('smartOn_(arow.enabled) && kindOn') !== -1, '');
  } finally {
    smartSituations_ = keep.sits; rpcCall_ = keep.call; optOutBlocked_ = keep.optOut; hubSysLog_ = keep.log;
    HUB_LETTER_UNREADABLE_SAID = keep.letterSaid;
  }
}

/** A release rearms only on a leg whose words name the password. */
function stRepReleaseNamedLeg_(out) {
  var keep = { sits: smartSituations_, call: rpcCall_, optOut: optOutBlocked_, log: hubSysLog_,
               num: packetTeamCopyNumber_, shared: commReleaseSharedLine_, record: smartRecord_ };
  var pw = 'Fp7!st-1';
  var person = { email: 'released@example.org', phone: '+13305550142', name: 'Pat Doe',
                 login: 'released@example.org', password: pw, url: 'https://hub.example' };
  try {
    hubSysLog_ = function () { return true; };
    optOutBlocked_ = function () { return ''; };
    smartRecord_ = function () { return true; };
    packetTeamCopyNumber_ = function (p) { return String(p); };
    commReleaseSharedLine_ = function () { return false; };
    // the e-mail leg is refused by the transport; the text leaves
    rpcCall_ = function (name) {
      return name === 'emailSend' ? { ok: false, sent: false, error: 'transport', detail: 'refused' }
                                  : { ok: true, sent: true, receipt: 'st' };
    };
    var rows = function (smsText) {
      return [{ id: 'user_release_invite', enabled: 'yes', channels: 'email, sms', sms_text: smsText,
                email_subject: 'Your account', email_text: 'Sign in as {login}.' },
              { id: 'auth_invitation', enabled: 'yes' }];
    };
    smartSituations_ = function () { return rows('Check your e-mail for your login, {first_name}.'); };
    var unnamed = commReleaseInviteTell_(person, 'st_named_1');
    smartSituations_ = function () { return rows('Your first password is {password}'); };
    var named = commReleaseInviteTell_(person, 'st_named_2');
    stAssert_(out, 'release: a text that leaves without the password counts as sent but never as the letter ' +
                   'that names it, and the refusal says so',
              unnamed.sent === 1 && unnamed.named_sent === 0 &&
              releaseBrakeOf_(unnamed) === 'password_not_named' &&
              unnamed.why.join(' ').indexOf('do not name the password') !== -1 &&
              named.sent === 1 && named.named_sent === 1,
              JSON.stringify([unnamed, named]));
    stAssert_(out, 'release: the rearm waits on a leg that left NOW naming this press\'s password — a repeat ' +
                   'whose letter left before named another one, so it rewrites nothing',
              stCode_(HUB_ACTIONS.releaseUser).indexOf('var reached = told.named_sent > 0;') !== -1 &&
              stCode_(HUB_ACTIONS.releaseUser).indexOf("refuse('already_sent'") !== -1 &&
              stCode_(HUB_ACTIONS.releaseUser).indexOf('told.sent > 0 || told.deduplicated > 0') === -1, '');
  } finally {
    smartSituations_ = keep.sits; rpcCall_ = keep.call; optOutBlocked_ = keep.optOut; hubSysLog_ = keep.log;
    packetTeamCopyNumber_ = keep.num; commReleaseSharedLine_ = keep.shared; smartRecord_ = keep.record;
  }
}

/** An app announcement the quiet window held goes on the morning list, and the morning carries it. */
function stRepAppReleaseQuiet_(out) {
  var keep = { tell: commReleaseAppTell_, owe: hubQuietOwe_ };
  var owed = [];
  try {
    commReleaseAppTell_ = function () {
      return { sent: 0, held: 1, deduplicated: 0, held_quiet: 1, legs: ['email (held)'], why: [],
               held_reason: 'quiet_hours' };
    };
    hubQuietOwe_ = function (lane, key, data) { owed.push({ lane: lane, key: key, data: data }); return true; };
    var res = appReleaseLetterOut_({ email: 'a@example.org', uid: 'U1', name: 'A' },
                                   { id: 'cal', title: 'Calendar', objective: 'o' });
    /* one entry per app, owed by the run (appReleaseOweMorning_), never one per person */
    stAssert_(out, 'app release: a letter the quiet window held is its own answer, logged held_quiet, and owes no person',
              res.outcome === 'quiet' && res.redirected === false && res.held_reason === 'quiet_hours' &&
              owed.length === 0 && appReleaseLogMode_(res, 'manual') === 'held_quiet',
              JSON.stringify([res, owed]));
    commReleaseAppTell_ = function () {
      return { sent: 0, held: 1, deduplicated: 0, held_dial: 1, legs: ['email (held)'], why: [],
               held_reason: 'send_switch_off' };
    };
    var dial = appReleaseLetterOut_({ email: 'a@example.org', uid: 'U1', name: 'A' }, { id: 'cal' });
    stAssert_(out, 'app release: a switch that held it is named by its brake, never folded into test mode',
              dial.outcome === 'dial' && appReleaseLogMode_(dial, 'auto') === 'held_send_switch_off' &&
              appReleaseHeldBy_({}, dial).send_switch_off === 1,
              JSON.stringify(dial));
    var hot = stCode_(HUB_ACTIONS.hotlineSweep);
    stAssert_(out, 'app release: the lane has its own limits on the morning list and a carrier on the hotline pass',
              !!(HUB_QUIET_OWED_LANES.app_release && HUB_QUIET_OWED_LANES.app_release.max) &&
              typeof appReleaseQuietCarry_ === 'function' &&
              hot.indexOf('app_release: (typeof appReleaseQuietCarry_') !== -1, '');
  } finally {
    commReleaseAppTell_ = keep.tell; hubQuietOwe_ = keep.owe;
  }
}

/** Attendance alerts: an unreadable switch sends nothing, no floor under the row, the row's words. */
function stRepStaffAlerts_(out) {
  var keep = { sits: smartSituations_, call: rpcCall_, told: smartAlreadySent_, shift: staffShiftText_,
               esc: staffAlertEscalation_, record: smartRecord_, sid: commSituationId_, prop: hubProp_,
               log: hubSysLog_, nobody: STAFF_ALERT_NOBODY_SAID };
  var calls = [];
  var payload = { no_call: [{ person: 'Ann Roe', house: '48TH', shift_code: '8A-4P', day: '2026-09-22' }] };
  var row = function (over) {
    var r = { id: 'staff_no_call', enabled: 'yes', channels: 'email', to: 'lead@example.org',
              email_subject: 'NO SHOW: {person}', email_text: '{person} did not arrive ({shift}).' };
    for (var k in over) r[k] = over[k];
    return r;
  };
  try {
    hubSysLog_ = function () { return true; };
    STAFF_ALERT_NOBODY_SAID = {};
    commSituationId_ = function (k, fb) { return fb; };
    hubProp_ = function (k) { return k === 'STAFF_ALERT_TO' ? 'property.floor@example.org' : ''; };
    smartAlreadySent_ = function () { return {}; };
    staffShiftText_ = function () { return ''; };
    staffAlertEscalation_ = function () { return []; };
    smartRecord_ = function () { return true; };
    rpcCall_ = function (m, p) { calls.push({ m: m, p: p }); return { ok: true, sent: true, receipt: 'st' }; };

    smartSituations_ = function () { throw new Error('the situations tab did not answer'); };
    var unreadable = HUB_ACTIONS.staffAttendancePunch(payload);
    var noFloor = staffAlertRecipients_('no_call');
    stAssert_(out, 'attendance: an unreadable situations tab holds the punch door with 503 and reaches nobody — ' +
                   'no property and no address in code stand under the row',
              unreadable.status === 503 && calls.length === 0 && noFloor.length === 0 &&
              !/[a-z0-9.]+@[a-z0-9]/i.test(stCode_(staffAlertRecipients_)) &&
              stCode_(staffAlertRecipients_).indexOf('STAFF_ALERT_TO') === -1,
              JSON.stringify(unreadable) + ' calls=' + calls.length + ' floor=' + JSON.stringify(noFloor));

    var states = ['off', '', 'false', 'no'].map(function (w) {
      smartSituations_ = function () { return [row({ enabled: w })]; };
      var r = HUB_ACTIONS.staffAttendancePunch(payload);
      return { w: w, held: r.data && r.data.held, told: r.data && r.data.told };
    });
    smartSituations_ = function () { return []; };
    var absent = HUB_ACTIONS.staffAttendancePunch(payload);
    stAssert_(out, 'attendance: every word the switch reads as off stops the alert, and so does an absent row',
              calls.length === 0 && states.every(function (s) { return s.held === 1 && s.told === 0; }) &&
              absent.data.held === 1,
              JSON.stringify(states) + ' ' + JSON.stringify(absent));

    smartSituations_ = function () { return [row({ to: '' })]; };
    var nobody = HUB_ACTIONS.staffAttendancePunch(payload);
    stAssert_(out, 'attendance: a row that names nobody sends nothing — no fallback list',
              calls.length === 0 && nobody.data.held === 1, JSON.stringify(nobody));

    smartSituations_ = function () { return [row({})]; };
    var told = HUB_ACTIONS.staffAttendancePunch(payload);
    var mail = calls[0] || { p: {} };
    stAssert_(out, 'attendance: the letter goes to the row\'s addresses in the row\'s words, with the facts kept',
              told.data.told === 1 && calls.length === 1 && mail.p.to === 'lead@example.org' &&
              mail.p.subject === 'NO SHOW: Ann Roe' &&
              String(mail.p.body).indexOf('Ann Roe did not arrive (48TH · 8A-4P).') !== -1 &&
              String(mail.p.body).indexOf('Scheduled shift:') !== -1,
              JSON.stringify(told) + ' ' + JSON.stringify(mail.p).slice(0, 400));

    var sweep = stCode_(HUB_ACTIONS.staffAttendanceSweep);
    stAssert_(out, 'attendance: the mailbox sweep leaves a report in the inbox when the switch cannot be read, ' +
                   'and treats any row that is not on as off',
              sweep.indexOf('sitHere && sitHere.unreadable') !== -1 && sweep.indexOf('switchUnreadable++') !== -1 &&
              sweep.indexOf('staffAlertStopWhy_(sitHere)') !== -1 &&
              sweep.indexOf("str_(sitHere.enabled).toLowerCase() === 'no'") === -1, '');
  } finally {
    smartSituations_ = keep.sits; rpcCall_ = keep.call; smartAlreadySent_ = keep.told; staffShiftText_ = keep.shift;
    staffAlertEscalation_ = keep.esc; smartRecord_ = keep.record; commSituationId_ = keep.sid; hubProp_ = keep.prop;
    hubSysLog_ = keep.log; STAFF_ALERT_NOBODY_SAID = keep.nobody;
  }
}

/** The invitation's e-mail words live in its row, in both parts. */
function stRepInvitationWords_(out) {
  var link = 'https://hub.example/#/register?t=inv-abcdef0123456789';
  var row = { id: 'auth_invitation', enabled: 'yes',
              email_subject: 'Welcome aboard, {name}',
              email_text: 'Hi {name}{by_inviter}.\n\nYour link: {link}\n\nIt lasts {days} days.' };
  var fromRow = inviteLetterFromRow_(row, { name: 'Pat', link: link, days: 14, inviterName: 'Sam' });
  var blank = inviteLetterFromRow_({ id: 'auth_invitation', email_subject: '', email_text: '' },
                                   { name: 'Pat', link: link, days: 14, inviterName: '' });
  stAssert_(out, 'invitation words: the subject, the plain part and the designed part are the row\'s words, ' +
                 'the link a link; a blank row falls back to the designed template',
            fromRow.words === 'row' && fromRow.subject === 'Welcome aboard, Pat' &&
            fromRow.text.indexOf('Hi Pat by Sam.') === 0 && fromRow.text.indexOf('It lasts 14 days.') !== -1 &&
            fromRow.html.indexOf('<a href="' + link + '">') !== -1 &&
            blank.words === 'template' && blank.subject === inviteRegisterEmail_({ link: link }).subject,
            JSON.stringify({ s: fromRow.subject, t: fromRow.text, w: blank.words }));
  var send = stCode_(HUB_ACTIONS.inviteSend);
  stAssert_(out, 'invitation words: inviteSend renders the row it already read and still withholds the link',
            send.indexOf('inviteLetterFromRow_(inviteAllowed.row') !== -1 && send.indexOf('withhold: link') !== -1 &&
            send.indexOf('inviteRegisterEmail_(') === -1, '');
}

/** Settings → Users → Invite: a situation with its own switch, a held leg is not sent, no password in a book. */
function stRepUserInvite_(out) {
  var keep = { sits: smartSituations_, call: rpcCall_, sheet: hubSheet_, prop: hubProp_, log: hubSysLog_,
               num: packetSendableNumber_, url: mailPlatformUrl_, said: HUB_LETTER_UNREADABLE_SAID,
               record: smartRecord_ };
  var pw = 'Fp7!st';
  var calls = [];
  var admin = { email: 'admin@example.org', role: 'admin', display_name: 'Sam' };
  var grid = [['user_id', 'email', 'display_name', 'pass_hash', 'must_change', 'active', 'last_login', 'phone'],
              ['U1', 'pat@example.org', 'Pat Doe', '', 'true', 'true', '', '+13305550142']];
  var answer = null;
  try {
    hubSysLog_ = function () { return true; };
    smartRecord_ = function () { return true; };
    HUB_LETTER_UNREADABLE_SAID = {};
    hubProp_ = function (k) { return k === 'FIRST_USER_PASSWORD' ? pw : ''; };
    hubSheet_ = function () {
      return { getDataRange: function () { return { getValues: function () { return grid; } }; } };
    };
    packetSendableNumber_ = function (n) { return String(n || '').indexOf('+1') === 0 ? String(n) : ''; };
    mailPlatformUrl_ = function () { return 'https://hub.example'; };
    rpcCall_ = function (m, p) {
      calls.push({ m: m, p: p, recorded: hubSecretScrub_(String(p.body || '')) });
      return answer;
    };
    var row = { id: 'user_account_invite', enabled: 'yes', channels: 'email, sms',
                sms_text: 'Sign in with {login}{password_line}', email_subject: 'Welcome, {first_name}',
                email_text: 'Hi {first_name}{by_inviter}.' };

    smartSituations_ = function () { return []; };
    var absent = HUB_ACTIONS.userInvite({ user_ids: ['U1'] }, admin);
    smartSituations_ = function () { throw new Error('the situations tab did not answer'); };
    var unreadable = HUB_ACTIONS.userInvite({ user_ids: ['U1'] }, admin);
    stAssert_(out, 'user invite: a new message arrives disabled — absent, the invite reaches nobody; ' +
                   'unreadable, nobody either, and the answer says which',
              absent.status === 200 && absent.data.state === 'off' &&
              unreadable.status === 200 && unreadable.data.state === 'held' && calls.length === 0 &&
              String(absent.data.why).indexOf('user_account_invite') !== -1 &&
              String(unreadable.data.why).indexOf('could not be read') !== -1,
              JSON.stringify([absent, unreadable]));

    smartSituations_ = function () { return [row]; };
    answer = { ok: true, sent: false, gated: true, reason: 'HUB_RPC_SEND is off' };
    var held = HUB_ACTIONS.userInvite({ user_ids: ['U1'] }, admin);
    stAssert_(out, 'user invite: a held letter and a held text are not counted as sent, and the answer names the brake',
              held.data.sent.length === 0 && held.data.held.length === 1 && held.data.skipped.length === 0 &&
              held.data.state === 'held' &&
              String(held.data.held[0].why).indexOf('held (send_switch_off)') !== -1,
              JSON.stringify(held.data));

    calls.length = 0;
    answer = { ok: true, sent: true, receipt: 'st' };
    var sent = HUB_ACTIONS.userInvite({ user_ids: ['U1'] }, admin);
    var mail = calls.filter(function (c) { return c.m === 'emailSend'; })[0] || { p: {} };
    var text = calls.filter(function (c) { return c.m === 'smsSend'; })[0] || { p: {} };
    stAssert_(out, 'user invite: the row\'s words go out, the password rides both legs and is withheld from ' +
                   'every record of them',
              sent.data.sent.length === 1 && sent.data.sent[0].via === 'email+sms' &&
              mail.p.subject === 'Welcome, Pat' && String(mail.p.html).indexOf(pw) !== -1 &&
              String(text.p.body).indexOf(pw) !== -1 &&
              JSON.stringify(mail.p.withhold) === JSON.stringify([pw]) &&
              calls.every(function (c) { return c.recorded.indexOf(pw) === -1; }) &&
              String(mail.p.reason) === 'smart comms: user_account_invite',
              JSON.stringify(sent.data) + ' ' + JSON.stringify(mail.p).slice(0, 300));
    var seed = hubDisabledLetterSeeds_().filter(function (s) { return s.id === 'user_account_invite'; })[0];
    stAssert_(out, 'user invite: the situation is seeded OFF with its words in the book',
              !!seed && seed.enabled === 'no' && String(seed.email_text).length > 0 &&
              String(seed.sms_text).indexOf('{password_line}') !== -1, JSON.stringify(seed));
  } finally {
    smartSituations_ = keep.sits; rpcCall_ = keep.call; hubSheet_ = keep.sheet; hubProp_ = keep.prop;
    hubSysLog_ = keep.log; packetSendableNumber_ = keep.num; mailPlatformUrl_ = keep.url;
    HUB_LETTER_UNREADABLE_SAID = keep.said; smartRecord_ = keep.record; hubSecretsRelease_();
  }
}

/** A personal mailbox is minted only when the letter carrying its one password can leave. */
function stRepMailboxEnsure_(out) {
  var keep = { sits: smartSituations_, call: rpcCall_, post: platformMailPost_, append: hubAppendRow_,
               log: hubSysLog_, master: hubIsMaster_, toSheet: hubRehearsalToSheet_, sending: rpcSendEnabled_,
               optOut: optOutBlocked_, said: MAILBOX_HELD_SAID, letterSaid: HUB_LETTER_UNREADABLE_SAID };
  var posts = [], rows = [], logs = [], calls = [];
  var cache = CacheService.getScriptCache();
  var n = 0;
  var person = function () { n++; return { id: 'st_mbx_' + Date.now() + '_' + n, email: 'pat' + n + '@example.org', name: 'Pat Doe' }; };
  var row = function (over) {
    var r = { id: 'mailbox_credentials', enabled: 'yes', channels: 'email', exclude_values: '',
              email_subject: 'Box for {first_name}', email_text: 'Address {account} / Password {password}' };
    for (var k in over) r[k] = over[k];
    return r;
  };
  var answer = { ok: true, sent: true, receipt: 'st' };
  try {
    hubSysLog_ = function (who, type, text, env) { logs.push({ type: type, status: env && env.status }); return true; };
    HUB_LETTER_UNREADABLE_SAID = {};
    hubIsMaster_ = function (e) { return e === 'platform@example.org'; };
    hubRehearsalToSheet_ = function () { return false; };
    rpcSendEnabled_ = function () { return true; };
    optOutBlocked_ = function () { return ''; };
    platformMailPost_ = function (path, body) {
      posts.push(path);
      return { status: 200, data: { account: String(body.local) + '@asaop.org', created: true, password: 'Mb0x!pw-st' } };
    };
    hubAppendRow_ = function (tab, vals) { rows.push(vals); };
    rpcCall_ = function (m, p) { calls.push({ p: p, recorded: hubSecretScrub_(String(p.body || '')) }); return answer; };

    var u1 = person();
    smartSituations_ = function () { return []; };
    MAILBOX_HELD_SAID = false;
    mailboxEnsure_(u1);
    smartSituations_ = function () { return [row({})]; };
    hubRehearsalToSheet_ = function () { return true; };
    var u2 = person();
    mailboxEnsure_(u2);
    hubRehearsalToSheet_ = function () { return false; };
    rpcSendEnabled_ = function () { return false; };
    var u3 = person();
    mailboxEnsure_(u3);
    stAssert_(out, 'mailbox: no box is minted while its letter could not leave — the row absent (arrives off), ' +
                   'test mode on, or the sending switch off — and nothing is stamped, so the next sign-in asks again',
              posts.length === 0 && rows.length === 0 && !cache.get('mbx_' + u1.id) &&
              !cache.get('mbx_' + u2.id) && !cache.get('mbx_' + u3.id) &&
              logs.some(function (l) { return l.type === 'mailbox_provision_held'; }),
              JSON.stringify({ posts: posts, rows: rows }));

    rpcSendEnabled_ = function () { return true; };
    var master = { id: 'st_mbx_master_' + Date.now(), email: 'platform@example.org', name: 'Platform' };
    mailboxEnsure_(master);
    smartSituations_ = function () { return [row({ exclude_values: 'keeps@example.org' })]; };
    var keeper = { id: 'st_mbx_keep_' + Date.now(), email: 'keeps@example.org', name: 'Keeps Own' };
    mailboxEnsure_(keeper);
    stAssert_(out, 'mailbox: the platform\'s own account and an address on the row\'s exclude list keep their ' +
                   'own mail — no address is written in code',
              posts.length === 0 && !!cache.get('mbx_' + master.id) && !!cache.get('mbx_' + keeper.id) &&
              !/[a-z0-9._-]+@[a-z0-9-]+\.[a-z]/i.test(stCode_(mailboxEnsure_)) &&
              !/[a-z0-9._-]+@[a-z0-9-]+\.[a-z]/i.test(stCode_(mailboxLetterHeld_)), JSON.stringify(posts));

    smartSituations_ = function () { return [row({})]; };
    var u4 = person();
    var made = mailboxEnsure_(u4);
    var sent = calls[0] || { p: {} };
    stAssert_(out, 'mailbox: with the letter free to leave the box is minted, the password goes in the row\'s ' +
                   'words and never into a record',
              posts.length === 1 && !!made && rows.length === 1 && rows[0].created === 'yes' &&
              sent.p.subject === 'Box for Pat' && String(sent.p.body).indexOf('Mb0x!pw-st') !== -1 &&
              sent.recorded.indexOf('Mb0x!pw-st') === -1 && sent.p.reason === 'smart comms: mailbox_credentials',
              JSON.stringify({ rows: rows, p: sent.p }));

    answer = { ok: true, sent: false, gated: true, reason: 'opted_out', detail: 'asked to stop' };
    var u5 = person();
    mailboxEnsure_(u5);
    stAssert_(out, 'mailbox: a letter that did not leave after all is said out loud and written on the row, ' +
                   'never recorded as delivered',
              rows.length === 2 && rows[1].created.indexOf('did not leave') !== -1 &&
              logs.some(function (l) { return l.type === 'mailbox_password_not_delivered' && l.status === 500; }),
              JSON.stringify(rows));
  } finally {
    smartSituations_ = keep.sits; rpcCall_ = keep.call; platformMailPost_ = keep.post; hubAppendRow_ = keep.append;
    hubSysLog_ = keep.log; hubIsMaster_ = keep.master; hubRehearsalToSheet_ = keep.toSheet;
    rpcSendEnabled_ = keep.sending; optOutBlocked_ = keep.optOut; MAILBOX_HELD_SAID = keep.said;
    HUB_LETTER_UNREADABLE_SAID = keep.letterSaid; hubSecretsRelease_();
  }
}

/** The situations are read once per execution, cached in chunks, and the morning carry has a budget. */
function stRepSituationsCost_(out) {
  var keep = { sheet: smartSheet_, memo: SMART_SITUATIONS_MEMO, keys: hubQuietOwedKeys_, get: hubQuietOwedGet_,
               budget: HUB_QUIET_CARRY_BUDGET_MS, log: hubSysLog_, read: hubSituationRead_,
               rebuild: hubLetterRebuilder_, call: rpcCall_,
               cacheGet: smartSituationsCacheGet_, cachePut: smartSituationsCachePut_ };
  try {
    hubSysLog_ = function () { return true; };
    // the rehearsed list never reaches the cache every live execution reads
    smartSituationsCacheGet_ = function () { return ''; };
    smartSituationsCachePut_ = function () { return false; };
    /* 1. one read per execution, and each caller its own copy */
    var reads = 0;
    var grid = [SMART_HEADER.slice()];
    grid.push(SMART_HEADER.map(function (h) { return h === 'id' ? 'st_memo_row' : (h === 'enabled' ? 'yes' : ''); }));
    smartSheet_ = function () {
      reads++;
      return { getLastRow: function () { return grid.length; },
               getRange: function (r, c, nr, nc) {
                 return { getValues: function () { return grid.slice(r - 1, r - 1 + nr).map(function (row) { return row.slice(c - 1, c - 1 + nc); }); } };
               } };
    };
    smartCacheBust_();
    var a = smartSituations_();
    a[0].enabled = 'mutated by a caller';
    var b = smartSituations_();
    var c2 = smartSituations_();
    var readsBefore = reads;
    smartCacheBust_();
    smartSituations_();
    stAssert_(out, 'situations: one read per execution, every caller its own copy, and a bust reads again',
              readsBefore === 1 && reads === 2 && b[0].enabled === 'yes' && c2.length === 1,
              'reads=' + readsBefore + '/' + reads + ' ' + JSON.stringify(b));

    /* 2. a list past 100 KB is cached in chunks no larger than the limit, and reads back whole */
    var stored = {}, refused = 0;
    var fake = {
      get: function (k) { return Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : null; },
      put: function (k, v) {
        if (encodeURIComponent(String(v)).replace(/%[0-9A-F]{2}/g, 'x').length > 100000) { refused++; throw new Error('Argument too large'); }
        stored[k] = String(v);
      }
    };
    var big = [];
    for (var i = 0; i < 180; i++) big.push({ id: 'row_' + i, note: new Array(1100).join('—') });
    var text = JSON.stringify(big);
    var wrote = keep.cachePut(fake, text);
    var back = keep.cacheGet(fake);
    stAssert_(out, 'situations: a list of ' + Math.round(text.length / 1000) + 'k characters is cached in chunks ' +
                   'the cache accepts, and reads back whole',
              text.length > 190000 && wrote === true && refused === 0 && back === text, 'refused=' + refused);

    /* 3. the morning carry takes nothing once its budget is spent */
    var took = 0;
    hubQuietOwedKeys_ = function () { return [HUB_QUIET_OWED_PREFIX + 'letter|a', HUB_QUIET_OWED_PREFIX + 'letter|b']; };
    hubQuietOwedGet_ = function () { took++; return null; };
    HUB_QUIET_CARRY_BUDGET_MS = 0;
    var carry = hubQuietOwedCarry_({ letter: function () { return { state: 'carried' }; } });
    stAssert_(out, 'morning list: past its budget the carry takes no entry — each stays on the list, counted waiting',
              took === 0 && carry.waiting === 2 && carry.carried === 0, JSON.stringify(carry));
    HUB_QUIET_CARRY_BUDGET_MS = keep.budget;

    /* 4. carrying a held letter reads its situation once, not twice */
    var sitReads = 0;
    hubSituationRead_ = function (id) { sitReads++; return { row: { id: id, enabled: 'yes' }, on: true, unreadable: '' }; };
    hubLetterRebuilder_ = function () {
      return function () {
        return { letter: { situation: 'form_answer_notice', to: 'notify@example.org', vars: {},
                           subject_floor: 's', text_floor: 't' } };
      };
    };
    rpcCall_ = function () { return { ok: true, sent: true, receipt: 'st' }; };
    var said = hubLetterQuietCarry_({ situation: 'form_answer_notice', key: 'st_k', facts: { a: 1 } }, { at: '' });
    stAssert_(out, 'morning list: a held letter is carried on one read of its situation',
              said.state === 'carried' && sitReads === 1, JSON.stringify(said) + ' reads=' + sitReads);
  } finally {
    smartSheet_ = keep.sheet; SMART_SITUATIONS_MEMO = keep.memo; hubQuietOwedKeys_ = keep.keys;
    hubQuietOwedGet_ = keep.get; HUB_QUIET_CARRY_BUDGET_MS = keep.budget; hubSysLog_ = keep.log;
    hubSituationRead_ = keep.read; hubLetterRebuilder_ = keep.rebuild; rpcCall_ = keep.call;
    smartSituationsCacheGet_ = keep.cacheGet; smartSituationsCachePut_ = keep.cachePut;
    // never the rehearsed list: the next reader in this execution reads the truth again
    SMART_SITUATIONS_MEMO = null;
  }
}

/** The `channels` cell on a letter row decides which legs go. */
function stRepLetterChannels_(out) {
  var keep = { read: hubSituationRead_, call: rpcCall_, recip: hubAlertRecipients_, redirect: hubTestRedirect_,
               prop: hubProp_, mail: platformMailOut_ };
  var calls = [];
  try {
    rpcCall_ = function (m, p) { calls.push({ m: m, p: p }); return { ok: true, sent: true, receipt: 'st' }; };
    hubSituationRead_ = function (id) {
      return { row: { id: id, enabled: 'yes', channels: 'sms', email_subject: 's', email_text: 't' },
               on: true, unreadable: '' };
    };
    var letter = hubLetterSend_({ situation: 'form_answer_notice', to: 'a@example.org', vars: {}, key: 'st_ch' });
    stAssert_(out, 'channels: a letter row that names no e-mail sends nothing through the letter door',
              letter.state === 'off' && calls.length === 0, JSON.stringify(letter));

    var said = aiKeyNoticeSay_({ channels: 'email', email_text: '{report}' }, { verdict: 'ok', report: 'r', day: 'd' }, '');
    var none = aiKeyNoticeSay_({ channels: 'fax' }, { verdict: 'ok', report: 'r', day: 'd' }, '');
    var both = aiKeyNoticeSay_({}, { verdict: 'ok', report: 'r', day: 'd2' }, '');
    stAssert_(out, 'channels: the weekly key notice hands the door only the legs its row names, none when it names ' +
                   'neither, and both when the cell is blank',
              calls.length === 2 && calls[0].p.legs === 'email' && !calls[1].p.legs && none.state === 'off',
              JSON.stringify(calls.map(function (c) { return c.p.legs; })) + ' ' + JSON.stringify(none) + JSON.stringify(both.state));

    var propAsks = 0, mailed = 0;
    hubAlertRecipients_ = function () { return { sms: ['+13305550142'], emails: ['team@example.org'] }; };
    hubTestRedirect_ = function () { return null; };
    hubProp_ = function (k) { if (k === SCRAPER_OPENPHONE_PROP) propAsks++; return ''; };
    platformMailOut_ = function () { mailed++; return { sent: true }; };
    var reach = hubTeamNotify_('s', 'b', [], { text: 'report', html: '', legs: ['email'] });
    stAssert_(out, 'channels: the team transport leaves out a leg the row does not name',
              reach.sms === 0 && reach.email === 1 && mailed === 1 && propAsks === 0, JSON.stringify(reach));
  } finally {
    hubSituationRead_ = keep.read; rpcCall_ = keep.call; hubAlertRecipients_ = keep.recip;
    hubTestRedirect_ = keep.redirect; hubProp_ = keep.prop; platformMailOut_ = keep.mail;
  }
}

/** A suggestion filed at night from a place with its own book is read from that book at 08:00. */
function stRepSuggestionPlace_(out) {
  var keep = { sheet: suggestionsSheet_, creds: platformMailCreds_, open: ssOpen_, tab: hubTabWorkbook_,
               readTab: readTabNormalized_, send: hubLetterSend_, log: hubSysLog_ };
  var owed = null, readFrom = [];
  try {
    hubSysLog_ = function () { return true; };
    suggestionsSheet_ = function () {
      return { appendRow: function () {}, getParent: function () { return { getId: function () { return 'BOOK_PLACE_7'; } }; } };
    };
    platformMailCreds_ = function () { return { user: 'asa-hub@asaop.org' }; };
    hubLetterSend_ = function (o) { owed = o; return { state: 'quiet', owed: true }; };
    HUB_ACTIONS.suggestionCreate({ text: 'a better roster view' }, { email: 's@example.org', display_name: 'S', role: 'staff' });
    ssOpen_ = function (id) { return { id: id }; };
    hubTabWorkbook_ = function () { return { id: 'HQ' }; };
    readTabNormalized_ = function (wb) {
      readFrom.push(wb && wb.id);
      return [{ suggestionid: owed && owed.facts.suggestion_id, byname: 'S', byemail: 's@example.org', role: 'staff',
                text: 'a better roster view' }];
    };
    var rebuilt = suggestionNoteRebuild_(owed && owed.facts);
    stAssert_(out, 'suggestions: the letter\'s facts carry the book the row landed in, and 08:00 reads that book, ' +
                   'not headquarters\'',
              !!owed && owed.facts.book === 'BOOK_PLACE_7' && readFrom.join() === 'BOOK_PLACE_7' &&
              !!(rebuilt && rebuilt.letter) && rebuilt.letter.facts.book === 'BOOK_PLACE_7',
              JSON.stringify({ facts: owed && owed.facts, readFrom: readFrom, rebuilt: !!(rebuilt && rebuilt.letter) }));
  } finally {
    suggestionsSheet_ = keep.sheet; platformMailCreds_ = keep.creds; ssOpen_ = keep.open;
    hubTabWorkbook_ = keep.tab; readTabNormalized_ = keep.readTab; hubLetterSend_ = keep.send;
    hubSysLog_ = keep.log;
  }
}

/** A feature grant (`*_badges`) is saved only by whoever the access rule names. */
function stRepFeatureGrants_(out) {
  var keep = { may: accessMatrixMayEdit_, sheet: hiringAlertsSheet_, log: hubSysLog_ };
  var sheetAsked = 0;
  var admin = { email: 'admin@example.org', role: 'admin' };
  try {
    hubSysLog_ = function () { return true; };
    hiringAlertsSheet_ = function () { sheetAsked++; throw new Error('st: the tab is not opened here'); };
    accessMatrixMayEdit_ = function () { return false; };
    var refused = HUB_ACTIONS.hiringAlertsSet({ values: { appgrid_badges: 'STAFF', copilot_badges: 'STAFF' } }, admin);
    var myworld = HUB_ACTIONS.hiringAlertsSet({ values: { myworld_badges: 'CLIENT' } }, admin);
    accessMatrixMayEdit_ = function () { throw new Error('the access rule could not be read'); };
    var unreadable = HUB_ACTIONS.hiringAlertsSet({ values: { platform_mail_badges: 'STAFF' } }, admin);
    stAssert_(out, 'feature grants: an admin the access rule does not name is refused 403 before a cell is ' +
                   'touched, and an unreadable rule refuses too',
              refused.status === 403 && myworld.status === 403 && unreadable.status === 403 && sheetAsked === 0 &&
              String(refused.message).indexOf('appgrid_badges') !== -1,
              JSON.stringify([refused, myworld, unreadable]) + ' sheet=' + sheetAsked);
    accessMatrixMayEdit_ = function () { return true; };
    var allowed = null;
    try { allowed = HUB_ACTIONS.hiringAlertsSet({ values: { appgrid_badges: 'STAFF' } }, admin); }
    catch (eA) { allowed = { threw: String((eA && eA.message) || eA) }; }
    var other = null;
    accessMatrixMayEdit_ = function () { return false; };
    try { other = HUB_ACTIONS.hiringAlertsSet({ values: { interview_scorecard_emails: 'x@example.org' } }, admin); }
    catch (eO) { other = { threw: String((eO && eO.message) || eO) }; }
    stAssert_(out, 'feature grants: whoever the rule names reaches the save, and every other key stays on the admin gate',
              sheetAsked === 2 && !(allowed && allowed.status === 403) && !(other && other.status === 403),
              JSON.stringify([allowed, other]) + ' sheet=' + sheetAsked);
  } finally {
    accessMatrixMayEdit_ = keep.may; hiringAlertsSheet_ = keep.sheet; hubSysLog_ = keep.log;
  }
}

/** A create the book-write funnel held is answered as refused, never counted as saved. */
function stRepHeldWrites_(out) {
  var keep = { create: createRow_ };
  var n = 0;
  var held = { error: { status: 409, message: 'the send switch is on, and every create is gated with it' } };
  try {
    createRow_ = function (res, rec) { n++; return n === 1 ? rec : held; };
    var punch = function (d) {
      return { date: d, employeeRaw: 'Pat Doe', workCode: 'W', startTime: '08:00', endTime: '16:00',
               hours: 8, consumers: '', location: 'Not Found' };
    };
    var stored = reconStorePunches_([punch('2026-09-01'), punch('2026-09-02'), punch('2026-09-03')], [], 'f', 'st');
    var answer = reconStoreRefusal_(stored);
    stAssert_(out, 'held writes: an import stops at the first held row, counts only what landed and answers the ' +
                   'refusal with that count',
              stored.entries === 1 && n === 2 && !!answer && answer.status === 409 &&
              String(answer.message).indexOf('1 punch(es) were stored before the refusal') !== -1,
              JSON.stringify({ entries: stored.entries, n: n, answer: answer }));
    stAssert_(out, 'held writes: the refusal reader tells a refused write from a landed one',
              sheetDbRefused_(held) === held.error && sheetDbRefused_({ id: 'x' }) === null &&
              sheetDbRefused_(null) === null, '');
  } finally {
    createRow_ = keep.create;
  }
}

/** The fifteen hiring and back-office lanes are situations: seeded off, asked before a word leaves. */
function stRepLaneSituations_(out) {
  var keep = { sits: smartSituations_, call: rpcCall_, log: hubSysLog_, said: HUB_LANE_OFF_SAID,
               letterSaid: HUB_LETTER_UNREADABLE_SAID, team: hiringTeamRecipients_ };
  var calls = 0;
  try {
    hubSysLog_ = function () { return true; };
    HUB_LANE_OFF_SAID = {};
    HUB_LETTER_UNREADABLE_SAID = {};
    rpcCall_ = function () { calls++; return { ok: true, sent: true }; };

    var seeds = hubLaneSeeds_();
    var others = {};
    SMART_EXTRA_SITUATIONS_SEED.concat(hubGateSeeds_(), hubAuthSeeds_(), hubLetterSeeds_(),
                                       hubDisabledLetterSeeds_()).forEach(function (s) { others[s.id] = true; });
    var wordless = seeds.filter(function (s) {
      var ch = smartList_(s.channels);
      return (ch.indexOf('sms') !== -1 && !str_(s.sms_text)) || (ch.indexOf('email') !== -1 && !str_(s.email_text));
    }).map(function (s) { return s.id; });
    stAssert_(out, 'lanes: fourteen situations arrive OFF, each with words on every channel it names and an id ' +
                   'no other seed uses',
              seeds.length === 14 && seeds.every(function (s) { return s.enabled === 'no' && !others[s.id]; }) &&
              wordless.length === 0, wordless.join(', ') + ' / ' + seeds.length);

    smartSituations_ = function () { return []; };
    var absent = hubLaneSituation_('lead_alert');
    smartSituations_ = function () { throw new Error('the situations tab did not answer'); };
    var unreadable = hubLaneSituation_('lead_alert');
    smartSituations_ = function () {
      return [{ id: 'lead_alert', enabled: 'yes', channels: 'sms', sms_text: 'LEAD {client}: {notes}' },
              { id: 'hiring_interest_thanks', enabled: 'yes', channels: 'email', email_subject: '', email_text: '' }];
    };
    var on = hubLaneSituation_('lead_alert');
    var blank = hubLaneSituation_('hiring_interest_thanks');
    stAssert_(out, 'lanes: absent or unreadable is off; on, a filled cell is the words and a blank one leaves ' +
                   'the lane\'s own; the channels cell names the legs',
              absent.on === false && unreadable.on === false && unreadable.unreadable === true &&
              on.on === true && on.word('sms_text', 'floor', { client: 'Acme', notes: 'n' }) === 'LEAD Acme: n' &&
              blank.word('email_text', 'the lane\'s words', {}) === 'the lane\'s words' &&
              on.leg('sms') === true && on.leg('email') === false,
              JSON.stringify([absent.on, unreadable.on, on.on]));

    smartSituations_ = function () { return []; };
    var thanks = HUB_ACTIONS.hiringInterestThanksSend({}, { email: 'a@example.org', role: 'admin' });
    var tell = cjisSweepTell_([{ candidate_id: 'CAN_x', name: 'Pat', filename: 'r.pdf' }], 0);
    var accepted = hiringAcceptedTell_('CAN_x', 'Pat Doe', '', 'yes', null);
    stAssert_(out, 'lanes: switched off (here, not planted yet), a button answers why and the sweeps say nothing',
              calls === 0 && thanks.data && thanks.data.sent === false && tell === false &&
              accepted.emailed === false && accepted.smsed === 0,
              JSON.stringify([thanks, tell, accepted]) + ' calls=' + calls);

    var src = function (fn) { return stCode_(fn); };
    var asks = [
      [readyParkedSweepMaybe_, 'hiring_ready_parked'], [readyParkedNotify_, 'hiring_ready_parked'],
      [onboardingDoneAskSweepMaybe_, 'hiring_ready_ask'], [referralRelaySweepMaybe_, 'hiring_referral_relay'],
      [referralRelaySweepMaybe_, 'hiring_referral_discarded'], [manualAdderSweepMaybe_, 'hiring_manual_adder_ask'],
      [directorDocsSweepMaybe_, 'hiring_director_docs_missing'],
      [HUB_ACTIONS.hiringInterestThanksSend, 'hiring_interest_thanks'],
      [hiringAcceptedTell_, 'hiring_candidate_accepted'], [hiringArchiveAndTell_, 'hiring_candidate_left'],
      [manualResumeAskRun_, 'hiring_manual_resume_ask'], [cjisSweepTell_, 'hiring_cjis_report_arrived'],
      [HUB_ACTIONS.talentAuthorizationSend, 'talent_authorization_ask'], [medDelSweep_, 'med_del_skills_check'],
      [HUB_ACTIONS.scraperNotify, 'lead_alert']
    ];
    var missing = asks.filter(function (a) {
      return src(a[0]).indexOf("hubLaneSituation_('" + a[1] + "')") === -1;
    }).map(function (a) { return a[1]; });
    stAssert_(out, 'lanes: every one of the fifteen doors asks its own situation before it sends',
              missing.length === 0, missing.join(', '));
  } finally {
    smartSituations_ = keep.sits; rpcCall_ = keep.call; hubSysLog_ = keep.log; HUB_LANE_OFF_SAID = keep.said;
    HUB_LETTER_UNREADABLE_SAID = keep.letterSaid; hiringTeamRecipients_ = keep.team;
  }
}
