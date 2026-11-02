// THE SWITCH THAT COULD NOT BE READ, THE DOORS THAT NEVER ASKED IT, AND THE LETTERS THAT LEAVE ANYWAY.
// Three laws are pinned here, and the first is the one that makes the other two worth anything: 1.

/** A cache that lives only as long as the check that made it. */
function stSgMemCache_() {
  var m = {};
  var api = {
    gets: 0,
    get: function (k) { api.gets++; return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    put: function (k, v) { m[k] = String(v); },
    remove: function (k) { delete m[k]; },
    clear: function () { m = {}; }
  };
  return api;
}

/** A stand-in for the situations tab that smartCommsSet reads and writes by position. */
function stSgSmartSheet_(rows) {
  var grid = [SMART_HEADER.slice()];
  rows.forEach(function (r) {
    grid.push(SMART_HEADER.map(function (h) { return r[h] == null ? '' : String(r[h]); }));
  });
  return {
    grid: grid,
    getLastRow: function () { return grid.length; },
    getRange: function (r, c, nr, nc) {
      return {
        getValues: function () {
          var out = [];
          for (var i = 0; i < (nr || 1); i++) {
            var row = grid[r - 1 + i] || [];
            out.push(row.slice(c - 1, c - 1 + (nc || 1)));
          }
          return out;
        },
        setValues: function (v) {
          for (var i = 0; i < v.length; i++) {
            for (var j = 0; j < v[i].length; j++) grid[r - 1 + i][c - 1 + j] = v[i][j];
          }
        }
      };
    }
  };
}

function stSmartGate_(out) {
  var keep = {
    cfg: hiringAlerts_, rWrite: hubRehearsalWrite_, mWrite: commMockWrite_,
    mDead: COMM_MOCK_DEAD, mWritten: COMM_MOCK_WRITTEN,
    creds: platformMailCreds_, post: platformMailPost_, mailLog: mailLogOut_,
    deciders: mailAlsoTellDeciders_, log: hubSysLog_, prop: hubProp_,
    sitOn: smartSituationOn_, sits: smartSituations_,
    unreadable: HUB_SWITCH_UNREADABLE_WHY, unreadableSaid: HUB_SWITCH_UNREADABLE_SAID,
    gateSaid: HUB_GATE_SAID, gateMemo: HUB_GATE_ARMED_MEMO, gateCache: hubGatesArmedCache_,
    letterSaid: HUB_LETTER_UNREADABLE_SAID
  };
  var rehearsed = [], mocked = [], posted = [];
  var got = {};
  var mem = stSgMemCache_();
  try {
    hubRehearsalWrite_ = function (row) { rehearsed.push(row); return 'rh-' + rehearsed.length; };
    commMockWrite_ = function (row) { mocked.push(row); };
    COMM_MOCK_DEAD = {};
    COMM_MOCK_WRITTEN = 0;
    hubSysLog_ = function () { return true; };
    hubProp_ = function () { return ''; };
    platformMailCreds_ = function () { return { user: 'asa-hub@asaop.org' }; };
    platformMailPost_ = function (path, body) {
      posted.push({ path: path, to: String((body && body.to) || '') });
      return { status: 200 };
    };
    mailAlsoTellDeciders_ = function (s, t, cc) { return cc; };
    mailLogOut_ = function () { return true; };
    hubGatesArmedCache_ = function () { return mem; };
    HUB_GATE_ARMED_MEMO = null;

    /* ── 1. THE UNREADABLE SWITCH, AT EVERY READER ────────────────────── */
    hiringAlerts_ = function () { throw new Error('the config sheet did not answer'); };
    HUB_SWITCH_UNREADABLE_WHY = '';
    HUB_SWITCH_UNREADABLE_SAID = false;

    var redirect = hubTestRedirect_();
    got.redirect = { sheet: !!(redirect && redirect.sheet),
                     unreadable: !!(redirect && redirect.unreadable),
                     sms: (redirect && redirect.sms || []).length,
                     emails: (redirect && redirect.emails || []).length };
    got.toSheet = hubRehearsalToSheet_();

    var p0 = posted.length;
    got.mailOut = platformMailOut_('person@example.com', 's', 'b', '', '', '',
                                   { lane: 'st', reason: 'st: the unreadable switch' });
    got.sinkThrew = '';
    try { platformMailSink_('person2@example.com', 's', 'b', '', ''); }
    catch (eSink) { got.sinkThrew = String((eSink && eSink.message) || eSink); }
    got.simSms = simActorSmsOut_('+13305550105', 'hi', 'the candidate');
    got.postedWhileUnreadable = posted.length - p0;
    got.why = hubSwitchUnreadableWhy_();

    /* the row says WHY, in the outbox a person reads */
    commMockNote_('smsSend', { to: '+13305550101', body: 'x', reason: 'st: unreadable' }, {},
                  { ok: true, sent: false, gated: true, rehearsed: true, method: 'smsSend' });
    var lastMock = mocked.length ? mocked[mocked.length - 1] : {};
    got.rowSaysWhy = String(lastMock.held_by || '').indexOf('could not be read') !== -1;
    got.rowSwitchWord = String(lastMock.test_mode || '');

    /* an opt-out list nobody could read is refused as that read, never as a person's stop */
    commMockNote_('smsSend', { to: '+13305550102', body: 'x', reason: 'st: opt-out unread' }, {},
                  { ok: true, sent: false, gated: true, reason: 'opted_out', method: 'smsSend',
                    detail: 'The opt-out list could not be read: Service Spreadsheets timed out' });
    var unreadRow = mocked.length ? mocked[mocked.length - 1] : {};
    commMockNote_('smsSend', { to: '+13305550103', body: 'x', reason: 'st: opt-out throw' }, {},
                  { ok: true, sent: false, gated: true, reason: 'opted_out', method: 'smsSend',
                    detail: 'The opt-out list could not be checked: timed out' });
    var uncheckedRow = mocked.length ? mocked[mocked.length - 1] : {};
    commMockNote_('smsSend', { to: '+13305550104', body: 'x', reason: 'st: opted out' }, {},
                  { ok: true, sent: false, gated: true, reason: 'opted_out', method: 'smsSend',
                    detail: 'This person asked us to stop.' });
    var stopRow = mocked.length ? mocked[mocked.length - 1] : {};
    stAssert_(out, 'the outbox: an opt-out list that could not be read is refused as that read, never as ' +
                   'the person asking us to stop',
              String(unreadRow.result) === 'refused' &&
              String(unreadRow.held_by) === 'the opt-out list could not be read' &&
              String(uncheckedRow.held_by) === 'the opt-out list could not be read' &&
              String(stopRow.held_by) === 'the person asked us to stop',
              JSON.stringify([unreadRow.held_by, uncheckedRow.held_by, stopRow.held_by]));

    stAssert_(out, 'the switch: an unreadable configuration HOLDS at hubTestRedirect_ — the sheet ' +
                   'position, no tester, and the reason carried on the answer',
              got.redirect.sheet === true && got.redirect.unreadable === true &&
              got.redirect.sms === 0 && got.redirect.emails === 0, JSON.stringify(got.redirect));
    stAssert_(out, 'the switch: an unreadable configuration HOLDS at hubRehearsalToSheet_',
              got.toSheet === true, String(got.toSheet));
    stAssert_(out, 'the switch: an unreadable configuration HOLDS at platformMailOut_ — the letter is ' +
                   'written into the rehearsal house and nothing is posted to a mailbox',
              !!(got.mailOut && got.mailOut.rehearsed) && got.mailOut.sent === false &&
              got.postedWhileUnreadable === 0,
              JSON.stringify(got.mailOut) + ' posted=' + got.postedWhileUnreadable);
    stAssert_(out, 'the switch: an unreadable configuration HOLDS at platformMailSink_ — it throws the ' +
                   'rehearsal refusal rather than handing back the real address',
              got.sinkThrew.indexOf('rehearsal_sheet') === 0, got.sinkThrew);
    stAssert_(out, 'the switch: an unreadable configuration HOLDS at simActorSmsOut_ — the one SMS that ' +
                   'reaches the provider with no door above it sends nothing',
              got.simSms === '', String(got.simSms));
    stAssert_(out, 'the switch: a hold on an unreadable switch is never silent — the words name the ' +
                   'read that failed, and the row in the outbox carries them',
              got.why.indexOf('could not be read') !== -1 && got.rowSaysWhy === true &&
              got.rowSwitchWord === 'unreadable',
              got.why + ' | ' + JSON.stringify(lastMock.held_by) + ' | ' + got.rowSwitchWord);

    /* ── 2. THE TEAM NOTICE GOES THROUGH THE DOOR WITH THE BRAKES ─────── */
    stAssert_(out, 'team notices: the helper hands them to rpcCall_(\'teamAlert\'), which is where the ' +
                   'quiet window, the sending switch, the receipt and the mock row live',
              stCode_(hubTeamAlert_).indexOf("rpcCall_('teamAlert'") !== -1 &&
              stCode_(hubTeamAlert_).indexOf('idempotency_key') !== -1, '');
    stAssert_(out, 'team notices: the four lanes that called the transport directly no longer do — the ' +
                   'graduation, the Hired alert, the weekly key check and the phone-screen escalation',
              stCode_(hubBecomingStaffSweep_).indexOf('hubTeamNotify_(') === -1 &&
              stCode_(hubHiredAlert_).indexOf('hubTeamNotify_(') === -1 &&
              stCode_(hubHiredAlert_).indexOf('hubTeamAlert_(') !== -1 &&
              stCode_(aiKeyNotice_).indexOf('hubTeamNotify_(') === -1 &&
              stCode_(aiKeyNotice_).indexOf('aiKeyNoticeSay_(') !== -1 &&
              stCode_(aiKeyNoticeSay_).indexOf('hubTeamNotify_(') === -1 &&
              stCode_(aiKeyNoticeSay_).indexOf('hubTeamAlert_(') !== -1 &&
              stCode_(hubDateAcceptedEscalate_).indexOf('hubTeamNotify_(') === -1 &&
              stCode_(hubDateAcceptedEscalate_).indexOf('hubTeamAlert_(') !== -1, '');
    stAssert_(out, 'team notices: the e-mail leg keeps its own words — a report is not shortened to the ' +
                   'length of the text message beside it (`mail_text`)',
              !!(HUB_RPC.teamAlert && HUB_RPC.teamAlert.params &&
                 HUB_RPC.teamAlert.params.mail_text) &&
              stCode_(rpcSend_).indexOf('str_(params.mail_text)') !== -1, '');

    /* ── 3. THE GATES ARRIVE OFF, AND HOLD ONLY WHEN ARMED ────────────── */
    var seeds = hubGateSeeds_();
    got.gateSeeds = seeds.length;
    got.gatesArmedAtBirth = seeds.filter(function (s) { return String(s.enabled) !== 'no'; }).length;
    stAssert_(out, 'the gates: every door that reaches the world without a word arrives OFF — a publish ' +
                   'never changes what a door does',
              seeds.length === HUB_GATES.length && got.gatesArmedAtBirth === 0,
              seeds.length + ' seed(s), ' + got.gatesArmedAtBirth + ' armed');
    stAssert_(out, 'the gates: each seed says what it reaches and what holding it costs, so arming one ' +
                   'is a decision made with the consequence in front of it',
              seeds.every(function (s) {
                return String(s.note).indexOf('Reaches:') !== -1 &&
                       String(s.note).indexOf('costs:') !== -1;
              }), '');

    // The armed map is remembered for the execution and kept in its small cache, so both are cleared between the…
    HUB_GATE_SAID = {};
    HUB_GATE_ARMED_MEMO = null;
    mem.clear();
    smartSituations_ = function () { return [{ id: 'gate_book_write_funnel', enabled: 'no' }]; };
    got.gateOffWhileHolding = hubGateHolds_('gate_book_write_funnel', { subject: 's' });
    smartSituations_ = function () { return [{ id: 'gate_book_write_funnel', enabled: 'yes' }]; };
    HUB_GATE_SAID = {};
    HUB_GATE_ARMED_MEMO = null;
    mem.clear();
    var gm0 = mocked.length;
    got.gateOnWhileHolding = hubGateHolds_('gate_book_write_funnel', { subject: 's' });
    got.gateRow = mocked.length - gm0;
    stAssert_(out, 'the gates: an UNARMED gate never holds, even with the lane holding — off is the ' +
                   'platform exactly as it stands',
              got.gateOffWhileHolding.held === false, JSON.stringify(got.gateOffWhileHolding));
    stAssert_(out, 'the gates: an ARMED gate holds while the lane holds, says why, and leaves one row ' +
                   'in the book a person reads',
              got.gateOnWhileHolding.held === true &&
              String(got.gateOnWhileHolding.why).length > 0 && got.gateRow === 1,
              JSON.stringify(got.gateOnWhileHolding) + ' rows=' + got.gateRow);
    stAssert_(out, 'the gates: the book-write funnel answers the refusal shape its callers already read ' +
                   '— never a write that quietly did not happen',
              stCode_(sheetDbGateHolds_).indexOf('status: 409') !== -1 &&
              stCode_(createRow_).indexOf('sheetDbGateHolds_') !== -1 &&
              stCode_(updateRowById_).indexOf('sheetDbGateHolds_') !== -1 &&
              stCode_(deleteRowById_).indexOf('sheetDbGateHolds_') !== -1, '');

    // THE RESOURCE DOOR'S GATE LIVES IN Main.gs, WHICH SHIPS APART.
    var routeSrc = (typeof route === 'function') ? stCode_(route) : '';
    var routeAsks = routeSrc.indexOf('hubResourceGate_(resource, action)') !== -1;
    var wiredNow = hubGateWired_('gate_resource_write_door');
    stAssert_(out, 'the gates: the Desk says the resource door\'s gate is wired exactly when this build\'s ' +
                   'route asks it',
              wiredNow.wired === routeAsks && (routeAsks || wiredNow.why.indexOf('Main.gs') !== -1),
              JSON.stringify(wiredNow) + ' routeAsks=' + routeAsks);
    if (routeAsks && typeof hubResourceGate_ === 'function') {
      stAssert_(out, 'the gates: the resource door asks its own gate on all three verbs, and a create the ' +
                     'funnel refused is no longer answered as 200',
                stCode_(hubResourceGate_).indexOf('gate_resource_write_door') !== -1 &&
                routeSrc.indexOf('created.error && created.error.status') !== -1, '');
    } else {
      stAssert_(out, 'the gates: without the route change, the funnel\'s card says a held create is still ' +
                     'answered as saved by the resource door',
                hubGateCaveat_('gate_book_write_funnel').indexOf('Main.gs') !== -1,
                hubGateCaveat_('gate_book_write_funnel'));
    }

    /* ── 4. THE TWO LETTERS THAT LEAVE WHILE THE LANE HOLDS ───────────── */
    var authSeeds = hubAuthSeeds_();
    stAssert_(out, 'the letters: the authentication letters arrive ON — they already send',
              authSeeds.length === 2 && authSeeds.every(function (s) { return String(s.enabled) === 'yes'; }),
              JSON.stringify(authSeeds.map(function (s) { return s.id + '=' + s.enabled; })));

    /* the lane is holding (the switch still throws), and the letter still leaves */
    posted.length = 0;
    got.authMail = platformMailOut_('locked.out@example.com', 'reset', 'link', '', '', '',
                                    { auth_letter: 'password_reset', lane: 'st',
                                      reason: 'smart comms: auth_password_reset' });
    got.authPosted = posted.length;
    commMockNote_('emailSend', { to: 'locked.out@example.com', subject: 'reset', body: 'link',
                                 reason: 'smart comms: auth_password_reset',
                                 auth_letter: 'password_reset' }, {},
                  { ok: true, sent: true, method: 'emailSend', receipt: 'st' });
    var authRow = mocked.length ? mocked[mocked.length - 1] : {};
    stAssert_(out, 'the letters: an authentication letter is DELIVERED while the lane is holding — a ' +
                   'person locked out cannot be helped by a letter in a mockup',
              !!(got.authMail && got.authMail.sent) && got.authPosted === 1 &&
              !(got.authMail && got.authMail.rehearsed),
              JSON.stringify(got.authMail) + ' posted=' + got.authPosted);
    stAssert_(out, 'the letters: and its row SAYS OUT LOUD that it left while the lane was holding — it ' +
                   'is never a silent exception',
              String(authRow.result) === 'sent' &&
              String(authRow.held_by).indexOf('delivered while the lane was holding') === 0,
              JSON.stringify({ result: authRow.result, held_by: authRow.held_by }));

    /* the switch beats the exemption in the one direction the dial does not */
    smartSituations_ = function () {
      return [{ id: 'auth_password_reset', enabled: 'no' }, { id: 'auth_invitation', enabled: 'yes' }];
    };
    got.resetOff = hubAuthLetterAllowed_('password_reset');
    got.inviteOn = hubAuthLetterAllowed_('invitation');
    smartSituations_ = function () { return []; };
    got.absentIsYes = hubAuthLetterAllowed_('password_reset');
    stAssert_(out, 'the letters: switched OFF on the Desk the letter does not send at all — the switch ' +
                   'beats the exemption in that direction, and the dial does not',
              got.resetOff.on === false && got.inviteOn.on === true &&
              String(got.resetOff.why).indexOf('switched off') !== -1,
              JSON.stringify(got.resetOff));
    stAssert_(out, 'the letters: a row the seed has not planted yet is a YES — nobody waits on a ' +
                   'migration to get back into their own account',
              got.absentIsYes.on === true, JSON.stringify(got.absentIsYes));
    stAssert_(out, 'the letters: both doors ask the switch before they send, and the reset takes its ' +
                   'words from the situation rather than from the code',
              stCode_(authForgotPub_).indexOf('hubAuthLetterAllowed_') !== -1 &&
              stCode_(resetWords_).indexOf('hubAuthLetterWords_') !== -1 &&
              stCode_(resetDeliver_).indexOf('resetWords_(allowed)') !== -1 &&
              stCode_(HUB_ACTIONS.inviteSend).indexOf('hubAuthLetterAllowed_') !== -1, '');

    /* ── 5. THE DESK, OFF THE READ IT ALREADY MAKES ───────────────────── */
    smartSituations_ = keep.sits;
    var deskRows = [{ id: 'gate_book_write_funnel', enabled: 'yes' }];
    got.desk = hubGateDesk_(deskRows);
    stAssert_(out, 'the Desk: the gates are shaped from the rows the desk already read — one pass over ' +
                   'them, never one backend ask per door',
              stCode_(hubGateDesk_).indexOf('smartSituations_(') === -1 &&
              stCode_(HUB_ACTIONS.smartCommsGet).indexOf('hubGateDesk_(rows)') !== -1, '');
    stAssert_(out, 'the Desk: it is handed every gate with its switch, what it reaches, what holding it ' +
                   'costs and whether it is wired, plus the two letters and whether each is on',
              got.desk.gates.length === HUB_GATES.length &&
              got.desk.gates.filter(function (g) { return g.armed; }).length === 1 &&
              got.desk.gates.every(function (g) { return typeof g.wired === 'boolean'; }) &&
              stCode_(HUB_ACTIONS.smartCommsGet).indexOf('auth_letters:') !== -1,
              JSON.stringify(got.desk.lane));
    stAssert_(out, 'the Desk: the relay reads the same switches off the configuration lane, so a gate ' +
                   'is one situation and not two',
              stCode_(HUB_ACTIONS.configLane).indexOf('smart_gates') !== -1 &&
              stCode_(HUB_ACTIONS.configLane).indexOf('hubGatesArmedRead_(') !== -1, '');
  } catch (e) {
    stAssert_(out, 'smart gate: the section ran', false, String((e && e.stack) || e));
  } finally {
    hiringAlerts_ = keep.cfg;
    hubRehearsalWrite_ = keep.rWrite;
    commMockWrite_ = keep.mWrite;
    COMM_MOCK_DEAD = keep.mDead;
    COMM_MOCK_WRITTEN = keep.mWritten;
    platformMailCreds_ = keep.creds;
    platformMailPost_ = keep.post;
    mailLogOut_ = keep.mailLog;
    mailAlsoTellDeciders_ = keep.deciders;
    hubSysLog_ = keep.log;
    hubProp_ = keep.prop;
    smartSituationOn_ = keep.sitOn;
    smartSituations_ = keep.sits;
    HUB_SWITCH_UNREADABLE_WHY = keep.unreadable;
    HUB_SWITCH_UNREADABLE_SAID = keep.unreadableSaid;
    HUB_GATE_SAID = keep.gateSaid;
    hubGatesArmedCache_ = keep.gateCache;
    // Never the rehearsed map: the next door in this execution reads the truth again.
    HUB_GATE_ARMED_MEMO = null;
    HUB_LETTER_UNREADABLE_SAID = keep.letterSaid;
  }
}

// WHAT A REVIEW OF THE ABOVE FOUND, EACH PINNED WHERE IT WAS FOUND.
function stSmartGateReview_(out) {
  var keep = {
    cfg: hiringAlerts_, rWrite: hubRehearsalWrite_, mWrite: commMockWrite_,
    mDead: COMM_MOCK_DEAD, mWritten: COMM_MOCK_WRITTEN,
    creds: platformMailCreds_, post: platformMailPost_, postOwn: platformMailPostOwn_,
    ownBox: platformMailOwnBox_, mailLog: mailLogOut_,
    deciders: mailAlsoTellDeciders_, log: hubSysLog_, prop: hubProp_, propSet: hubPropSet_,
    sitOn: smartSituationOn_, sits: smartSituations_, smartSheet: smartSheet_,
    bust: smartCacheBust_, repair: commRepairOnWordsChanged_, record: smartRecord_,
    userBy: userByEmail_, resetSheet: resetSheet_, resetTemp: resetTempSheet_, optOut: optOutIndex_,
    teamAlert: hubTeamAlert_, stress: HUB_ACTIONS.aiKeyStress,
    qKeys: hubQuietOwedKeys_, qGet: hubQuietOwedGet_, qSet: hubQuietOwedSet_, qDel: hubQuietOwedDel_,
    readTab: readTabNormalized_, ssOpen: ssOpen_, hubId: hubId_,
    docIndex: onboardingDocIndex_, obDone: hubOnboardingDone_, testCand: commsIsTestCandidate_,
    digestSweep: digestSweepMaybe_, formBySlug: formBySlug_, requireRow: requireRow_,
    quietNow: HUB_QUIET_NOW, transport: RPC_TEST_TRANSPORT, force: RPC_TEST_FORCE_ON,
    unreadable: HUB_SWITCH_UNREADABLE_WHY, unreadableSaid: HUB_SWITCH_UNREADABLE_SAID,
    gateSaid: HUB_GATE_SAID, gateCache: hubGatesArmedCache_,
    letterSaid: HUB_LETTER_UNREADABLE_SAID, reread: HUB_GATE_REREAD_DONE
  };
  var NIGHT = '2026-09-23T03:00:00Z';                  // inside the quiet window, New York
  var DAY = (typeof ST_QUIET_DAYTIME !== 'undefined') ? ST_QUIET_DAYTIME : '2026-09-22T16:00:00Z';
  var mem = stSgMemCache_();
  var logs = [], mocked = [], rehearsed = [], posted = [], mailLogged = [], ledger = [], sent = [];
  var store = {};
  var readSwitchOff = function () { return { test_mode: 'off' }; };
  var readSwitchOn = function () { return { test_mode: 'on' }; };
  var unreadableSwitch = function () { throw new Error('the config sheet did not answer'); };
  var fresh = function () {
    HUB_GATE_ARMED_MEMO = null; HUB_GATE_SAID = {}; mem.clear();
    HUB_SWITCH_UNREADABLE_WHY = ''; HUB_SWITCH_UNREADABLE_SAID = false;
    HUB_LETTER_UNREADABLE_SAID = {}; HUB_GATE_REREAD_DONE = false;
  };
  var stamp = String(new Date().getTime());
  try {
    hubSysLog_ = function (who, what, msg) { logs.push(String(what) + ' ' + String(msg || '')); return true; };
    hubRehearsalWrite_ = function (row) { rehearsed.push(row); return 'rh-' + rehearsed.length; };
    commMockWrite_ = function (row) { mocked.push(row); };
    COMM_MOCK_DEAD = {};
    COMM_MOCK_WRITTEN = 0;
    hubProp_ = function () { return ''; };
    platformMailCreds_ = function () { return { user: 'asa-hub@asaop.org' }; };
    platformMailPost_ = function (path, body) {
      posted.push({ path: path, to: String((body && body.to) || ''), body: String((body && body.body) || '') });
      return { status: 200 };
    };
    mailLogOut_ = function (rec) { mailLogged.push(rec || {}); return true; };
    mailAlsoTellDeciders_ = function (s, t, cc) { return cc; };
    smartRecord_ = function (key, situation, person, expires, channel) {
      ledger.push({ key: key, situation: situation, person: person, channel: channel });
      return true;
    };
    optOutIndex_ = function () { return { by: {}, error: '' }; };
    hubGatesArmedCache_ = function () { return mem; };
    hubQuietOwedKeys_ = function () { return Object.keys(store); };
    hubQuietOwedGet_ = function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; };
    hubQuietOwedSet_ = function (k, v) { store[k] = String(v); };
    hubQuietOwedDel_ = function (k) { delete store[k]; };
    RPC_TEST_TRANSPORT = function (name, params) {
      sent.push({ name: name, params: params || {} });
      return name === 'teamAlert'
        ? { ok: true, sent: true, gated: false, method: name, receipt: 'team:1sms+1email' }
        : { ok: true, sent: true, gated: false, method: name, receipt: 'st-' + sent.length };
    };
    RPC_TEST_FORCE_ON = true;
    HUB_QUIET_NOW = DAY;
    fresh();

    // ── H2.
    hiringAlerts_ = readSwitchOff;
    var newSeeds = hubGateSeeds_().concat(hubAuthSeeds_(), hubLetterSeeds_());
    var fakeTab = stSgSmartSheet_(newSeeds);
    smartSheet_ = function () { return fakeTab; };
    smartCacheBust_ = function () { };
    commRepairOnWordsChanged_ = function () { return null; };
    var refusedSaves = [];
    newSeeds.forEach(function (s) {
      var row = {};
      SMART_HEADER.forEach(function (h) { row[h] = s[h] == null ? '' : String(s[h]); });
      row.enabled = smartOn_(s.enabled) ? 'no' : 'yes';
      var r = HUB_ACTIONS.smartCommsSet({ rows: [row] }, { role: 'admin', email: 'selftest@asa' });
      if (!r || r.status !== 200) refusedSaves.push(s.id + ': ' + String(r && r.message).slice(0, 120));
    });
    var enabledCol = SMART_HEADER.indexOf('enabled');
    var flippedAll = newSeeds.every(function (s, i) {
      return String(fakeTab.grid[i + 1][enabledCol]) === (smartOn_(s.enabled) ? 'no' : 'yes');
    });
    stAssert_(out, 'seeds: every gate and letter row the seed plants can be switched from the Desk — the ' +
                   'save refuses none of them',
              refusedSaves.length === 0 && flippedAll, refusedSaves.join(' | '));
    stAssert_(out, 'seeds: no new row parks prose in `to` — a lane that resolves its own audience leaves it ' +
                   'blank and says who in its note',
              newSeeds.every(function (s) { return smartList_(s.to).length === 0 || smartAddressable_(s.to); }),
              newSeeds.filter(function (s) { return smartList_(s.to).length && !smartAddressable_(s.to); })
                .map(function (s) { return s.id; }).join(', '));

    /* ── M7. EVERY NEW SEED SPELLS ITS WORDS ──────────────────────────── */
    var silent = newSeeds.filter(function (s) {
      return ['sms_text', 'email_subject', 'email_text'].some(function (f) {
        return !Object.prototype.hasOwnProperty.call(s, f);
      });
    }).map(function (s) { return s.id; });
    stAssert_(out, 'seeds: every new row spells all three word cells — a silent one would be planted ' +
                   'wearing the credential-expiry letter',
              silent.length === 0, silent.join(', '));
    var resetSeed = hubAuthSeeds_()[0];
    var html = resetLetterHtml_('Hello {x}.\n\nOpen https://hub.example/#/reset?t=abc123XYZ now.',
                                'https://hub.example/#/reset?t=abc123XYZ');
    stAssert_(out, 'seeds: the reset letter\'s designed part is drawn from its row\'s words, and so is the ' +
                   'invitation\'s — both letters carry their words in the row',
              html.indexOf('<p>Hello {x}.</p>') !== -1 &&
              html.indexOf('<a href="https://hub.example/#/reset?t=abc123XYZ">') !== -1 &&
              String(resetSeed.email_text).indexOf('{password}') !== -1 &&
              RESET_SMS_PHRASE.test(String(resetSeed.sms_text)) &&
              String(hubAuthSeeds_()[1].email_text).indexOf('{link}') !== -1 &&
              String(hubAuthSeeds_()[1].email_subject) !== '' &&
              HUB_AUTH_LETTER_WORDS.invitation === 'row' &&
              HUB_AUTH_LETTER_WORDS.password_reset === 'row', html.slice(0, 160));

    /* ── H4 / M9. THE TEMPORARY PASSWORD: ASKED FIRST, NEVER IN A BOOK ── */
    var tempStore = stPrSheet_(RESET_TEMP_HEADER, []);
    var mintedCount = function () { return tempStore.grid.length - 1; };
    userByEmail_ = function (e) { return { userid: 'U_ST_' + stamp, email: e, active: 'true' }; };
    resetTempSheet_ = function () { return tempStore; };
    hiringAlerts_ = function () { return { test_mode: 'sheet' }; };   // the lane is holding
    var resetRows = function (enabled) {
      return [{ id: 'auth_password_reset', enabled: enabled, kind: 'letter',
                email_subject: 'Reset for {email}', email_text: resetSeed.email_text }];
    };
    // switched off
    fresh();
    smartSituations_ = function () { return resetRows('no'); };
    var m0 = mocked.length, pz = posted.length;
    authForgotPub_({ identifier: 'st-reset-off-' + stamp + '@example.invalid' });
    var offRow = mocked.length > m0 ? mocked[mocked.length - 1] : {};
    stAssert_(out, 'reset: switched off, NO temporary password is made and nothing is posted — the switch is ' +
                   'asked before a way into the account exists',
              mintedCount() === 0 && posted.length === pz &&
              String(offRow.held_by).indexOf('switched off') !== -1 &&
              String(offRow.body).indexOf('temporary password is') === -1,
              'minted=' + mintedCount() + ' posted=' + (posted.length - pz) + ' ' + JSON.stringify(offRow.held_by));
    // unreadable situations tab
    fresh();
    smartSituations_ = function () { throw new Error('the situations tab did not answer'); };
    m0 = mocked.length; pz = posted.length;
    var l0 = logs.length;
    authForgotPub_({ identifier: 'st-reset-unread-' + stamp + '@example.invalid' });
    var unreadRow = mocked.length > m0 ? mocked[mocked.length - 1] : {};
    var unreadLogged = logs.slice(l0).some(function (l) { return l.indexOf('could not be read') !== -1; });
    stAssert_(out, 'reset: a situations tab that cannot be read HOLDS the letter — no password, nothing ' +
                   'posted, the log and the outbox row both say the read failed',
              mintedCount() === 0 && posted.length === pz && unreadLogged &&
              String(unreadRow.held_by).indexOf('could not be read') !== -1,
              'minted=' + mintedCount() + ' logged=' + unreadLogged + ' ' + JSON.stringify(unreadRow.held_by));
    // switched on, lane holding
    fresh();
    smartSituations_ = function () { return resetRows('yes'); };
    m0 = mocked.length; pz = posted.length;
    var ml0 = mailLogged.length, lg0 = ledger.length;
    authForgotPub_({ identifier: 'st-reset-on-' + stamp + '@example.invalid' });
    var onRow = mocked.length > m0 ? mocked[mocked.length - 1] : {};
    var delivered = posted.length > pz ? posted[posted.length - 1] : { body: '' };
    var logged = mailLogged.length > ml0 ? mailLogged[mailLogged.length - 1] : { body: '' };
    var givenPw = (String(delivered.body).match(/temporary password is ([A-Za-z0-9]+)/) || [])[1] || '';
    stAssert_(out, 'reset: on, the letter is DELIVERED while the lane holds and carries the temporary ' +
                   'password — the person is the one reader of it',
              mintedCount() === 1 && posted.length === pz + 1 && givenPw.length >= 10,
              'minted=' + mintedCount() + ' posted=' + (posted.length - pz));
    stAssert_(out, 'reset: the outbox row and the mail log WITHHOLD the password — a book every administrator ' +
                   'reads is never a way into somebody else\'s account',
              !!givenPw && String(onRow.body).indexOf(givenPw) === -1 &&
              String(onRow.body).indexOf('{withheld}') !== -1 &&
              String(logged.body || '').indexOf(givenPw) === -1 &&
              String(onRow.result) === 'sent',
              JSON.stringify({ row: String(onRow.body).slice(0, 200), log: String(logged.body || '').slice(0, 120) }));
    stAssert_(out, 'reset: a delivered letter gets its line in smart_comms_sent, the ledger every message has',
              ledger.length === lg0 + 1 && ledger[ledger.length - 1].situation === 'auth_password_reset',
              JSON.stringify(ledger.slice(lg0)));
    stAssert_(out, 'reset: the subject is the row\'s words, filled in',
              String(onRow.subject).indexOf('Reset for st-reset-on-') === 0, String(onRow.subject));
    // the invitation withholds its link on both legs, and its SMS copy claims nothing
    var inviteSrc = stCode_(HUB_ACTIONS.inviteSend);
    stAssert_(out, 'invitation: both legs name the link to withhold, only the LETTER claims the ' +
                   'authentication exemption, and a leg counts as sent only when it left',
              inviteSrc.split('withhold: link').length - 1 === 2 &&
              inviteSrc.split('auth_letter:').length - 1 === 1 &&
              inviteSrc.indexOf('sres.ok && sres.sent') !== -1 &&
              inviteSrc.indexOf('res.ok && res.sent') !== -1, '');
    // the withheld words, at every record
    var rh = hubRehearsalMsgFor_('smsSend', { to: '+13305550100', body: 'go to https://x.example/inv?t=SECRET123',
                                              withhold: 'https://x.example/inv?t=SECRET123', reason: 'st' });
    var safe = rpcSafeParams_({ to: '+13305550100', body: 'https://x.example/inv?t=SECRET123',
                                withhold: 'https://x.example/inv?t=SECRET123' });
    stAssert_(out, 'withhold: the rehearsal row and the echoed parameters never carry a withheld secret',
              String(rh.body).indexOf('SECRET123') === -1 && String(rh.body).indexOf('{withheld}') !== -1 &&
              JSON.stringify(safe).indexOf('SECRET123') === -1, JSON.stringify({ rh: rh.body, safe: safe }));
    // an unreadable letter switch is said once and holds both letters
    fresh();
    smartSituations_ = function () { throw new Error('no answer'); };
    l0 = logs.length;
    var aR = hubAuthLetterAllowed_('password_reset');
    var aR2 = hubAuthLetterAllowed_('password_reset');
    var aI = hubAuthLetterAllowed_('invitation');
    var saidCount = logs.slice(l0).filter(function (l) { return l.indexOf('letter_switch_unreadable') === 0; }).length;
    stAssert_(out, 'letters: an unreadable switch is a NO for both authentication letters, never a yes — ' +
                   'and it is logged once per letter, not once per ask',
              aR.on === false && aR.unreadable === true && aI.on === false && aR2.on === false &&
              saidCount === 2, JSON.stringify(aR) + ' said=' + saidCount);

    /* ── H3. A ONE-SHOT TEAM ALERT THE QUIET WINDOW HELD IS KEPT FOR 08:00 ─ */
    fresh();
    hiringAlerts_ = readSwitchOff;
    smartSituations_ = function () { return []; };
    HUB_QUIET_NOW = NIGHT;
    var night = hubTeamAlert_({ subject: 'st', body: 'st', reason: 'st: quiet', key: 'st_sg_quiet_' + stamp });
    HUB_QUIET_NOW = DAY;
    var day = hubTeamAlert_({ subject: 'st', body: 'st', reason: 'st: day', key: 'st_sg_day_' + stamp });
    stAssert_(out, 'team alert: the answer tells a quiet hold from a delivery — only told (or already ' +
                   'told) may stamp a lane done',
              night.state === 'quiet' && night.done === false && day.state === 'told' && day.done === true,
              JSON.stringify({ night: night, day: day }));
    // the Hired alert, held at night, owed, and carried at 08:00 while still true
    smartSituationOn_ = function (id) {
      return { id: id, enabled: 'yes', sms_text: 'Hired: {name}', email_subject: 'Hired: {name}', email_text: 'Hired: {name}' };
    };
    var card = { candidateid: 'CAN_STSG01', candidatename: 'Pat Test', phone: '', email: '',
                 status: HUB_STAGE_TO_STATUS.hired, archived: '' };
    HUB_QUIET_NOW = NIGHT;
    var hiredNight = hubHiredAlert_(card, { missing: [], manual: true }, '');
    var owedHired = hubTeamAlertOwe_('hired', 'hired|' + card.candidateid, { cid: card.candidateid });
    stAssert_(out, 'hired: an alert the quiet window holds answers quiet and can be kept for the morning list — and ' +
                   'the graduation sweep raises none itself: Python raises it from the hired_complete_at stamp',
              hiredNight.state === 'quiet' && owedHired === true &&
              Object.keys(store).some(function (k) { return k.indexOf('team_alert|hired|CAN_STSG01') !== -1; }) &&
              stCode_(hubHiredSweep_).indexOf('hubHiredAlert_(') === -1 &&
              stCode_(hubHiredSweep_).indexOf('hubTeamAlertOwe_(') === -1,
              JSON.stringify(hiredNight) + ' owed=' + owedHired + ' ' + Object.keys(store).join(','));
    ssOpen_ = function () { return {}; };
    hubId_ = function () { return 'st'; };
    onboardingDocIndex_ = function () { return {}; };
    hubOnboardingDone_ = function () { return { how: 'manual', q: true, t: true }; };
    commsIsTestCandidate_ = function () { return false; };
    var cardRows = [card];
    readTabNormalized_ = function (ss, tab) { return tab === TALENT_CANDIDATES_TAB ? cardRows : []; };
    HUB_QUIET_NOW = DAY;
    var s0 = sent.length;
    var carried = hubTeamAlertQuietCarry_({ kind: 'hired', cid: card.candidateid });
    var carriedSent = sent.slice(s0).filter(function (x) { return x.name === 'teamAlert'; });
    cardRows = [{ candidateid: 'CAN_STSG01', candidatename: 'Pat Test', archived: 'true', status: HUB_STAGE_TO_STATUS.hired }];
    var staleArchived = hubTeamAlertQuietCarry_({ kind: 'hired', cid: card.candidateid });
    stAssert_(out, 'hired: at 08:00 the card is read again — still on the pipeline, the alert is said, ' +
                   'marked as held overnight; archived overnight, it is let go',
              carried.state === 'carried' && carriedSent.length === 1 &&
              String(carriedSent[0].params.reason).indexOf('held overnight by the quiet window') !== -1 &&
              staleArchived.state === 'stale' && String(staleArchived.why).indexOf('archived') !== -1,
              JSON.stringify({ carried: carried, stale: staleArchived, sent: carriedSent.length }));
    // the Date Accepted escalation: held at night, owed, never stamped until it ends
    HUB_QUIET_NOW = NIGHT;
    var esc = hubDateAcceptedEscalate_({ cand: { candidateid: 'CAN_STSG02', candidatename: 'Sam Test' }, screen: {} },
                                       { score: 7, qualification: 'Qualified', report_url: '' });
    HUB_QUIET_NOW = DAY;
    stAssert_(out, 'date accepted: an escalation the quiet window holds is owed for 08:00 and is NOT an ' +
                   'answer that stamps the row; told, already told and switched off are — and neither screen door ' +
                   'escalates itself: Python raises it from the analysed screen',
              esc.state === 'quiet' && esc.owed === true && hubDateAcceptedSettled_(esc) === false &&
              hubDateAcceptedSettled_({ done: true }) === true &&
              hubDateAcceptedSettled_({ state: 'off' }) === true &&
              hubDateAcceptedSettled_({ state: 'held' }) === false &&
              Object.keys(store).some(function (k) { return k.indexOf('team_alert|date_accepted|CAN_STSG02') !== -1; }) &&
              stCode_(HUB_ACTIONS.screenAnalyze).indexOf('hubDateAcceptedEscalate_(') === -1 &&
              stCode_(HUB_ACTIONS.screenForceError).indexOf('hubDateAcceptedEscalate_(') === -1,
              JSON.stringify(esc));
    stAssert_(out, 'morning list: the hotline pass hands the team alerts and the letters to their carriers',
              stCode_(HUB_ACTIONS.hotlineSweep).indexOf('team_alert:') !== -1 &&
              stCode_(HUB_ACTIONS.hotlineSweep).indexOf('hubTeamAlertQuietCarry_') !== -1 &&
              stCode_(HUB_ACTIONS.hotlineSweep).indexOf('letter:') !== -1 &&
              stCode_(HUB_ACTIONS.hotlineSweep).indexOf('hubLetterQuietCarry_') !== -1, '');
    stAssert_(out, 'morning list: a carrier this build does not have lets the entry go and says why',
              hubTeamAlertQuietCarry_({ kind: 'nothing_by_this_name' }).state === 'stale', '');

    /* ── H3 / M3. THE WEEKLY KEY CHECK ────────────────────────────────── */
    var stamps = [], stressed = 0;
    hubPropSet_ = function (k, v) { stamps.push(k); return true; };
    HUB_ACTIONS.aiKeyStress = function () { stressed++; return { status: 200, data: {} }; };
    HUB_QUIET_NOW = NIGHT;
    aiKeySweepMaybe_();
    HUB_QUIET_NOW = DAY;
    stAssert_(out, 'ai keys: the weekly sweep does not start inside the quiet window — its notice would ' +
                   'be held, and its clock would drift into the night',
              stamps.length === 0 && stressed === 0, 'stamps=' + stamps.join(',') + ' stressed=' + stressed);
    var alerted = [];
    hubTeamAlert_ = function (w) { alerted.push(w); return { done: true, state: 'told', why: '' }; };
    fresh();
    smartSituations_ = function () { return [{ id: 'ai_keys_weekly_check', enabled: 'no' }]; };
    var kOff = aiKeyNotice_('all fine', 0, 'the report');
    fresh();
    smartSituations_ = function () {
      return [{ id: 'ai_keys_weekly_check', enabled: 'yes', sms_text: 'K: {verdict}{retired_line}',
                email_subject: 'Keys{retired_count}', email_text: 'R: {report}' }];
    };
    var kOn = aiKeyNotice_('all fine', 2, 'the report');
    fresh();
    smartSituations_ = function () { throw new Error('no answer'); };
    var kUnread = aiKeyNotice_('all fine', 0, 'the report');
    stAssert_(out, 'ai keys: the notice obeys its own switch, speaks the row\'s words with the measurement ' +
                   'filled in, and an unreadable switch tells nobody',
              kOff.state === 'off' && kUnread.state === 'unreadable' && alerted.length === 1 &&
              alerted[0].body === 'K: all fine 2 retired.' && alerted[0].subject === 'Keys (2 retired)' &&
              alerted[0].mail_text === 'R: the report' &&
              String(alerted[0].reason).indexOf('ai_keys_weekly_check') !== -1,
              JSON.stringify({ off: kOff, unread: kUnread, alerted: alerted }));
    hubTeamAlert_ = keep.teamAlert;

    /* ── M8. A FORM'S NOTICES ARE LETTERS THROUGH THE ONE DOOR ────────── */
    fresh();
    hiringAlerts_ = readSwitchOff;
    smartSituations_ = function () {
      return [{ id: 'form_answer_notice', enabled: 'yes', email_subject: 'New: {form_title}', email_text: '{answers}' }];
    };
    var form = { notify_to: 'desk@example.invalid', title: 'Intake', slug: 'intake',
                 fields: JSON.stringify([{ key: 'a', label: 'A' }]) };
    s0 = sent.length;
    var fDay = formNotify_(form, { name: 'Pat' }, { a: 'yes' }, 'SUB_ST_' + stamp);
    var fSent = sent.slice(s0);
    HUB_QUIET_NOW = NIGHT;
    var fNight = formNotify_(form, { name: 'Pat' }, { a: 'yes' }, 'SUB_ST_N_' + stamp);
    var owedKey = Object.keys(store).filter(function (k) { return k.indexOf('letter|form_answer|SUB_ST_N_') !== -1; })[0];
    HUB_QUIET_NOW = DAY;
    var owedEntry = owedKey ? JSON.parse(store[owedKey]) : null;
    // at 08:00 the answer is read again from its row: the form and the filed answer stand in
    formBySlug_ = function (slug) { return slug === 'intake' ? form : null; };
    requireRow_ = function (res, id) {
      return { id: id, name: 'Pat', email: '', phone: '', answers: JSON.stringify({ a: 'yes' }) };
    };
    s0 = sent.length;
    var fCarried = owedEntry ? hubLetterQuietCarry_(owedEntry.data, owedEntry) : { state: 'missing' };
    var fCarriedSent = sent.slice(s0);
    stAssert_(out, 'forms: an answer\'s notice is a Smart Comms letter — the row\'s words through rpcCall_, ' +
                   'kept for 08:00 at night and carried in the morning',
              fDay && fDay.state === 'told' && fSent.length === 1 && fSent[0].name === 'emailSend' &&
              fSent[0].params.subject === 'New: Intake' &&
              String(fSent[0].params.body).indexOf('A: yes') !== -1 &&
              String(fSent[0].params.reason) === 'smart comms: form_answer_notice' &&
              fNight && fNight.state === 'quiet' && fNight.owed === true && !!owedEntry &&
              fCarried.state === 'carried' && fCarriedSent.length === 1 &&
              String(fCarriedSent[0].params.reason).indexOf('held overnight') !== -1,
              JSON.stringify({ day: fDay, night: fNight, carried: fCarried }));
    smartSituations_ = function () { return [{ id: 'form_answer_notice', enabled: 'no' }]; };
    fresh();
    s0 = sent.length;
    var fOff = formNotify_(form, { name: 'Pat' }, { a: 'yes' }, 'SUB_ST_OFF_' + stamp);
    stAssert_(out, 'forms: switched off, the notice is not sent, and neither door mails a form\'s address ' +
                   'straight through the transport any more',
              fOff && fOff.state === 'off' && sent.length === s0 &&
              stCode_(formNotify_).indexOf('platformMailOut_(') === -1 &&
              stCode_(digestStalledSay_).indexOf('platformMailOut_(') === -1 &&
              stCode_(digestStalledSay_).indexOf('hubLetterSend_(') !== -1 &&
              stCode_(digestStalledLetter_).indexOf("situation: 'form_file_stalled'") !== -1,
              JSON.stringify(fOff));

    /* ── M1. THE OWN-MAILBOX DOOR HOLDS ON AN UNREADABLE SWITCH ───────── */
    fresh();
    hiringAlerts_ = unreadableSwitch;
    var ownPosts = 0;
    platformMailOwnBox_ = function () { return 'me@asaop.org'; };
    platformMailPostOwn_ = function () { ownPosts++; return { status: 200 }; };
    // A whole config that cannot be read stops at the Mail app's own switch.
    var ownWhole = HUB_ACTIONS.platformMailSend({ from_account: 'mine', to: 'friend@example.invalid',
                                                  subject: 's', body: 'b' },
                                                { email: 'st@asa', role: 'staff' });
    stAssert_(out, 'own mailbox: a configuration that cannot be read refuses at the Mail app\'s switch, ' +
                   'nothing posted',
              ownWhole && ownWhole.status === 503 && ownPosts === 0, JSON.stringify(ownWhole));
    // The Mail app's switch answers; the send switch itself cannot be read.
    fresh();
    hiringAlerts_ = function () { return { test_mode: 'st-unknown-word' }; };
    m0 = mocked.length;
    var own = HUB_ACTIONS.platformMailSend({ from_account: 'mine', to: 'friend@example.invalid',
                                             subject: 's', body: 'b' },
                                           { email: 'st@asa', role: 'staff' });
    var ownRow = mocked.length > m0 ? mocked[mocked.length - 1] : {};
    stAssert_(out, 'own mailbox: an unreadable switch HOLDS a letter sent from a person\'s own box — ' +
                   'nothing posted, the row and the answer say the read failed',
              ownPosts === 0 && own && own.data && own.data.sent === false && own.data.unreadable === true &&
              String(ownRow.held_by).indexOf('could not be read') !== -1 &&
              stCode_(HUB_ACTIONS.platformMailSend).indexOf('ownHeld = false') === -1,
              JSON.stringify(own && own.data) + ' posts=' + ownPosts + ' ' + JSON.stringify(ownRow.held_by));

    /* ── M5. AN UNREADABLE SITUATIONS TAB HOLDS THE DOORS THAT REACH A PERSON ─ */
    fresh();
    hiringAlerts_ = readSwitchOn;
    smartSituations_ = function () { throw new Error('the situations tab did not answer'); };
    var grantHeld = hubGateHolds_('gate_drive_grant_reader', { subject: 'st' });
    var funnelHeld = hubGateHolds_('gate_book_write_funnel', { subject: 'st' });
    fresh();
    hiringAlerts_ = readSwitchOff;
    smartSituations_ = function () { throw new Error('the situations tab did not answer'); };
    var grantOff = hubGateHolds_('gate_drive_grant_reader', { subject: 'st' });
    stAssert_(out, 'gates: while the lane holds, a situations tab that cannot be read HOLDS a door that ' +
                   'hands a person something for ever, and keeps a door that writes the Hub\'s own books ' +
                   'acting; with the switch off, neither holds',
              grantHeld.held === true && grantHeld.unreadable === true &&
              String(grantHeld.why).indexOf('could not be read') !== -1 &&
              funnelHeld.held === false && grantOff.held === false,
              JSON.stringify({ grant: grantHeld, funnel: funnelHeld, off: grantOff }));
    /* M4: the digest gate holds the engine's digester as well as the relay's worker */
    fresh();
    hiringAlerts_ = readSwitchOn;
    smartSituations_ = function () { return [{ id: 'gate_digest_writes', enabled: 'yes' }]; };
    var digests = 0, keepSweep = digestSweepMaybe_;
    digestSweepMaybe_ = function () { digests++; };
    var dHeld = HUB_ACTIONS.digestSweep({}, { is_service: true, email: 'service' });
    fresh();
    hiringAlerts_ = readSwitchOff;
    var dRan = HUB_ACTIONS.digestSweep({}, { is_service: true, email: 'service' });
    digestSweepMaybe_ = keepSweep;
    stAssert_(out, 'gates: armed with the lane holding, the digest gate stops the engine\'s digester too; ' +
                   'with the switch off it sweeps',
              dHeld && dHeld.data && dHeld.data.held === true && dRan && dRan.data && dRan.data.swept === true &&
              digests === 1, JSON.stringify({ held: dHeld && dHeld.data, ran: dRan && dRan.data, digests: digests }));
    stAssert_(out, 'gates: every door that hands a person something that cannot be taken back is marked so',
              ['gate_drive_grant_reader', 'gate_screening_report_share', 'gate_calendar_file_link',
               'gate_wellbeing_image_link', 'gate_mail_provision'].every(function (id) {
                return hubGateSpec_(id) && hubGateSpec_(id).person === true;
              }) && !hubGateSpec_('gate_book_write_funnel').person, '');

    /* ── M6. ONE SMALL READ PER EXECUTION, NOT ONE SITUATIONS READ PER SAVE ─ */
    fresh();
    hiringAlerts_ = readSwitchOff;
    var sitReads = 0;
    smartSituations_ = function () { sitReads++; return [{ id: 'gate_book_write_funnel', enabled: 'no' }]; };
    mem.gets = 0;
    for (var w = 0; w < 200; w++) sheetDbGateHolds_('candidates', 'update');
    var firstExecution = { reads: sitReads, gets: mem.gets };
    HUB_GATE_ARMED_MEMO = null;                      // the next execution, same cache
    for (var w2 = 0; w2 < 200; w2++) sheetDbGateHolds_('candidates', 'create');
    stAssert_(out, 'gates: four hundred writes across two executions cost ONE situations read and one small ' +
                   'cache read per execution — the armed map is remembered for the execution and kept in ' +
                   'its own small cache',
              firstExecution.reads === 1 && firstExecution.gets === 1 && sitReads === 1 && mem.gets === 2,
              'first execution ' + JSON.stringify(firstExecution) + ', then reads=' + sitReads + ' gets=' + mem.gets);
    stAssert_(out, 'gates: a save on the Desk drops the armed map with the situations cache',
              stCode_(keep.bust).indexOf('hubGatesArmedBust_') !== -1, '');

    /* ── L1–L5 ────────────────────────────────────────────────────────── */
    fresh();
    hiringAlerts_ = unreadableSwitch;
    var ab = HUB_ACTIONS.rpcAbilities({}, { role: 'admin', email: 'st@asa' });
    stAssert_(out, 'abilities: an unreadable switch is reported as its own position, and no team alert is ' +
                   'listed as escaping the switch',
              ab && ab.data && ab.data.test_mode.position === 'unreadable' &&
              (ab.data.always_sends || []).length === 0 &&
              String(ab.data.test_mode_note).indexOf('COULD NOT BE READ') !== -1,
              JSON.stringify(ab && ab.data && ab.data.test_mode));
    var facts = smartScheduleFacts_([{ id: 'l1', kind: 'letter', send_at: '09:00' }, { id: 'g1', kind: 'gate' }]);
    stAssert_(out, 'desk: a letter and a gate are never drawn as kept by a sweep\'s hours',
              facts.l1.honored === false && facts.g1.honored === false, JSON.stringify(facts));
    fresh();
    l0 = logs.length;
    hubSwitchUnreadable_('st one', new Error('a'));
    hubSwitchUnreadable_('st two', new Error('b'));
    var unreadableLines = logs.slice(l0).filter(function (l) { return l.indexOf('test_mode_unreadable') === 0; }).length;
    hiringAlerts_ = readSwitchOff;
    hubRehearsalToSheet_();
    stAssert_(out, 'switch: an outage is logged once per execution, and a later read that answers clears ' +
                   'it — rows written after it never carry the outage\'s words',
              unreadableLines === 1 && hubSwitchUnreadableWhy_() === '', 'lines=' + unreadableLines +
              ' why=' + hubSwitchUnreadableWhy_());
  } catch (e) {
    stAssert_(out, 'smart gate, reviewed: the section ran', false, String((e && e.stack) || e));
  } finally {
    hiringAlerts_ = keep.cfg;
    hubRehearsalWrite_ = keep.rWrite;
    commMockWrite_ = keep.mWrite;
    COMM_MOCK_DEAD = keep.mDead;
    COMM_MOCK_WRITTEN = keep.mWritten;
    platformMailCreds_ = keep.creds;
    platformMailPost_ = keep.post;
    platformMailPostOwn_ = keep.postOwn;
    platformMailOwnBox_ = keep.ownBox;
    mailLogOut_ = keep.mailLog;
    mailAlsoTellDeciders_ = keep.deciders;
    hubSysLog_ = keep.log;
    hubProp_ = keep.prop;
    hubPropSet_ = keep.propSet;
    smartSituationOn_ = keep.sitOn;
    smartSituations_ = keep.sits;
    smartSheet_ = keep.smartSheet;
    smartCacheBust_ = keep.bust;
    commRepairOnWordsChanged_ = keep.repair;
    smartRecord_ = keep.record;
    userByEmail_ = keep.userBy;
    resetSheet_ = keep.resetSheet;
    resetTempSheet_ = keep.resetTemp;
    try { CacheService.getScriptCache().remove('pfa_' + sha256Hex_('U_ST_' + stamp)); } catch (eC) { }
    optOutIndex_ = keep.optOut;
    hubTeamAlert_ = keep.teamAlert;
    HUB_ACTIONS.aiKeyStress = keep.stress;
    hubQuietOwedKeys_ = keep.qKeys;
    hubQuietOwedGet_ = keep.qGet;
    hubQuietOwedSet_ = keep.qSet;
    hubQuietOwedDel_ = keep.qDel;
    readTabNormalized_ = keep.readTab;
    ssOpen_ = keep.ssOpen;
    hubId_ = keep.hubId;
    onboardingDocIndex_ = keep.docIndex;
    hubOnboardingDone_ = keep.obDone;
    commsIsTestCandidate_ = keep.testCand;
    digestSweepMaybe_ = keep.digestSweep;
    formBySlug_ = keep.formBySlug;
    requireRow_ = keep.requireRow;
    // The force flag first: while set, every other function believes sending is on.
    RPC_TEST_FORCE_ON = keep.force;
    RPC_TEST_TRANSPORT = keep.transport;
    HUB_QUIET_NOW = keep.quietNow;
    HUB_SWITCH_UNREADABLE_WHY = keep.unreadable;
    HUB_SWITCH_UNREADABLE_SAID = keep.unreadableSaid;
    HUB_GATE_SAID = keep.gateSaid;
    hubGatesArmedCache_ = keep.gateCache;
    HUB_GATE_ARMED_MEMO = null;
    HUB_LETTER_UNREADABLE_SAID = keep.letterSaid;
    HUB_GATE_REREAD_DONE = keep.reread;
  }
}

// WHAT A SECOND REVIEW FOUND, EACH PINNED WHERE IT WAS FOUND.
function stSmartGateSecondPass_(out) {
  var keep = {
    cfg: hiringAlerts_, mWrite: commMockWrite_, mDead: COMM_MOCK_DEAD, mWritten: COMM_MOCK_WRITTEN,
    rWrite: hubRehearsalWrite_, log: hubSysLog_, sits: smartSituations_, optOut: optOutIndex_,
    quietSeen: commMockQuietSeen_,
    qKeys: hubQuietOwedKeys_, qGet: hubQuietOwedGet_, qSet: hubQuietOwedSet_, qDel: hubQuietOwedDel_,
    transport: RPC_TEST_TRANSPORT, force: RPC_TEST_FORCE_ON, quietNow: HUB_QUIET_NOW,
    formBySlug: formBySlug_, requireRow: requireRow_, readTab: readTabNormalized_,
    tabWb: hubTabWorkbook_, sugSheet: suggestionsSheet_, hex: randomHex_, creds: platformMailCreds_,
    mailOut: platformMailOut_, fanOut: rpcFanOutSms_, phone: rpcOpenPhoneSms_, team: hubTeamNotify_,
    redirect: hubTestRedirect_, sendOn: rpcSendEnabled_, ssOpen: ssOpen_, held: commMockHeld_,
    gateCache: hubGatesArmedCache_, gateSaid: HUB_GATE_SAID, reread: HUB_GATE_REREAD_DONE,
    letterSaid: HUB_LETTER_UNREADABLE_SAID,
    unreadable: HUB_SWITCH_UNREADABLE_WHY, unreadableSaid: HUB_SWITCH_UNREADABLE_SAID,
    dialMemo: COMM_DIAL_MEMO, dialUnreadable: COMM_DIAL_UNREADABLE
  };
  var NIGHT = '2026-09-23T03:00:00Z';
  var NIGHT_ISO = new Date(NIGHT).toISOString();
  var DAY = (typeof ST_QUIET_DAYTIME !== 'undefined') ? ST_QUIET_DAYTIME : '2026-09-22T16:00:00Z';
  var stamp = String(new Date().getTime());
  var mem = stSgMemCache_();
  var store = {}, sent = [], logs = [], mocked = [];
  var providerCalls = [];
  var off = {};
  var letterRows = hubLetterSeeds_();
  var situations = function () {
    return letterRows.map(function (s) {
      var r = {};
      for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) r[k] = s[k];
      if (off[r.id]) r.enabled = 'no';
      return r;
    });
  };
  var fresh = function () {
    HUB_GATE_ARMED_MEMO = null; HUB_GATE_SAID = {}; mem.clear(); HUB_GATE_REREAD_DONE = false;
    HUB_SWITCH_UNREADABLE_WHY = ''; HUB_SWITCH_UNREADABLE_SAID = false; HUB_LETTER_UNREADABLE_SAID = {};
  };
  var letterKeys = function () {
    return Object.keys(store).filter(function (k) { return k.indexOf(HUB_QUIET_OWED_PREFIX + 'letter|') === 0; });
  };
  var books = { formSubmissions: {}, formFiles: {} };
  var failing = {};
  try {
    hiringAlerts_ = function () { return { test_mode: 'off' }; };
    commMockWrite_ = function (row) { mocked.push(row || {}); };
    COMM_MOCK_DEAD = {};
    COMM_MOCK_WRITTEN = 0;
    hubRehearsalWrite_ = function () { return 'rh-st'; };
    hubSysLog_ = function (who, what, msg) { logs.push(String(what) + ' ' + String(msg || '')); return true; };
    smartSituations_ = situations;
    optOutIndex_ = function () { return { by: {}, error: '' }; };
    commMockQuietSeen_ = function () { return false; };
    hubQuietOwedKeys_ = function () { return Object.keys(store); };
    hubQuietOwedGet_ = function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; };
    hubQuietOwedSet_ = function (k, v) { store[k] = String(v); };
    hubQuietOwedDel_ = function (k) { delete store[k]; };
    hubGatesArmedCache_ = function () { return mem; };
    RPC_TEST_TRANSPORT = function (name, params) {
      sent.push({ name: name, params: params || {} });
      return name === 'teamAlert'
        ? { ok: true, sent: true, gated: false, method: name, receipt: 'team:1sms+1email' }
        : { ok: true, sent: true, gated: false, method: name, receipt: 'st2-' + sent.length };
    };
    RPC_TEST_FORCE_ON = true;
    // the provider floor: nothing below may reach a phone or an inbox
    rpcOpenPhoneSms_ = function () { providerCalls.push('sms'); return { ok: false, sent: false, error: 'self_test_floor' }; };
    hubTeamNotify_ = function () { providerCalls.push('team'); return { sms: 0, email: 0 }; };
    platformMailOut_ = function () { providerCalls.push('mail'); return { sent: false, receipt: '' }; };
    formBySlug_ = function (slug) { return String(slug) === 'intake' ? form : null; };
    requireRow_ = function (res, id) {
      if (failing[res]) throw new Error('the ' + res + ' book did not answer');
      var book = books[res] || {};
      return Object.prototype.hasOwnProperty.call(book, id) ? book[id] : { error: { status: 404, message: 'no row' } };
    };
    var form = { slug: 'intake', title: 'Intake', notify_to: 'desk@example.invalid',
                 fields: JSON.stringify([{ key: 'a', label: 'A' }]) };
    fresh();

    /* ── 1. A FORM ANSWERED ALL NIGHT IS SAID WHOLE AT 08:00 ──────────── */
    HUB_QUIET_NOW = NIGHT;
    var nightSaid = [];
    var file = function (id, name, answer) {
      books.formSubmissions[id] = { id: id, name: name, email: '', phone: '', answers: JSON.stringify({ a: answer }) };
      nightSaid.push(formNotify_(form, { name: name }, { a: answer }, id));
    };
    for (var i = 1; i <= 13; i++) file('SUB2_' + stamp + '_' + i, 'Pat ' + i, 'answer ' + i);
    var big = new Array(10241).join('x');
    file('SUB2_' + stamp + '_big', 'Big Answer', big);
    var nightKeys = letterKeys();
    var widest = 0;
    nightKeys.forEach(function (k) { widest = Math.max(widest, String(store[k]).length); });
    var nightSent = sent.length;
    stAssert_(out, 'letters: fourteen answers filed inside the quiet window — one of them ten kilobytes — are ' +
                   'each KEPT for 08:00, and each entry is its ids, never its words',
              nightSaid.length === 14 && nightSaid.every(function (x) { return x && x.state === 'quiet' && x.owed === true; }) &&
              nightKeys.length === 14 && widest < 1500 && nightSent === 0,
              JSON.stringify({ states: nightSaid.map(function (x) { return x && (x.state + ':' + x.owed); }),
                               keys: nightKeys.length, widest: widest, sent: nightSent }).slice(0, 400));
    HUB_QUIET_NOW = DAY;
    var s0 = sent.length;
    var morning = hubQuietOwedCarry_({ letter: hubLetterQuietCarry_ });
    var morningSent = sent.slice(s0);
    var bigLetter = morningSent.filter(function (m) { return String(m.params.body).indexOf(big) !== -1; });
    stAssert_(out, 'letters: at 08:00 every one of the fourteen is read again from its row and said — the ten ' +
                   'kilobyte answer whole — and the list is empty after',
              morning.carried === 14 && morning.stale === 0 && morningSent.length === 14 &&
              morningSent.every(function (m) {
                return m.name === 'emailSend' && m.params.to === 'desk@example.invalid' &&
                       m.params.subject === 'Intake — a new answer' &&
                       String(m.params.reason).indexOf('held overnight by the quiet window') !== -1;
              }) && bigLetter.length === 1 && letterKeys().length === 0,
              JSON.stringify({ morning: morning, sent: morningSent.length, big: bigLetter.length }).slice(0, 400));

    /* ── 2. AN ANSWER GONE IS LET GO; AN UNREADABLE BOOK KEEPS IT ─────── */
    HUB_QUIET_NOW = NIGHT;
    var goneId = 'SUB2_' + stamp + '_gone', unreadId = 'SUB2_' + stamp + '_unread';
    file(goneId, 'Gone', 'withdrawn');
    file(unreadId, 'Unread', 'still here');
    HUB_QUIET_NOW = DAY;
    delete books.formSubmissions[goneId];
    // the answers book fails for the first morning pass only
    var answersFail = true;
    requireRow_ = (function (inner) {
      return function (res, id) {
        if (answersFail && res === FORM_SUBMISSIONS_RES && id === unreadId) throw new Error('the answers tab did not answer');
        return inner(res, id);
      };
    })(requireRow_);
    s0 = sent.length;
    var morningA = hubQuietOwedCarry_({ letter: hubLetterQuietCarry_ });
    var keptKey = letterKeys().filter(function (k) { return k.indexOf(unreadId) !== -1; })[0];
    var keptAt = keptKey ? JSON.parse(store[keptKey]).at : '';
    answersFail = false;
    var morningB = hubQuietOwedCarry_({ letter: hubLetterQuietCarry_ });
    stAssert_(out, 'letters: an answer removed overnight is let go; an answers book that cannot be read KEEPS ' +
                   'the letter for the next pass with the instant it was first held, and the next pass says it',
              morningA.carried === 0 && morningA.stale === 1 && morningA.kept === 1 &&
              String(morningA.why.join(' ')).indexOf('no longer filed') !== -1 &&
              keptAt === NIGHT_ISO && morningB.carried === 1 && sent.length - s0 === 1 &&
              letterKeys().length === 0,
              JSON.stringify({ a: morningA, keptAt: keptAt, b: morningB }).slice(0, 400));

    /* ── 3. EVERY REFUSAL OF THE MORNING LIST IS LOGGED, WITH ITS REASON ─ */
    var l0 = logs.length;
    var tooBig = hubQuietOwe_('support', 'st2-big-' + stamp, { words: new Array(7001).join('w') });
    for (var f = 0; f < HUB_QUIET_OWED_MAX; f++) hubQuietOwe_('support', 'st2-full-' + stamp + '-' + f, { n: f });
    var overFull = hubQuietOwe_('support', 'st2-full-' + stamp + '-over', { n: 99 });
    var refusals = logs.slice(l0).filter(function (l) { return l.indexOf('quiet_owed_refused') === 0; });
    stAssert_(out, 'morning list: a page too large and a list already full are each refused OUT LOUD, the ' +
                   'log naming which — a letter lane keeps many more, and larger, than a page lane',
              tooBig === false && overFull === false && refusals.length === 2 &&
              refusals[0].indexOf('characters') !== -1 && refusals[1].indexOf('already holds') !== -1 &&
              hubQuietOwedLimits_('letter').max > HUB_QUIET_OWED_MAX,
              refusals.join(' | ').slice(0, 400));
    Object.keys(store).forEach(function (k) { if (k.indexOf('|support|') !== -1) delete store[k]; });

    /* ── 4. A STALLED FILE'S LETTER, READ AGAIN AT 08:00 ──────────────── */
    var led = DIGEST_LEDGERS.filter(function (l) { return !!l.sub; })[0];
    var stalledRow = function (id) {
      var r = { id: id, form_slug: 'intake', digest_state: 'stalled' };
      r[led.name] = 'clip-' + id + '.mp4';
      books[led.res] = books[led.res] || {};
      books[led.res][id] = r;
      return r;
    };
    HUB_QUIET_NOW = NIGHT;
    var stillStalled = stalledRow('FF2_' + stamp + '_a'), readAfter = stalledRow('FF2_' + stamp + '_b');
    digestStalledSay_(stillStalled, led, 'st');
    digestStalledSay_(readAfter, led, 'st');
    var stalledOwed = letterKeys().length;
    HUB_QUIET_NOW = DAY;
    books[led.res][readAfter.id].digest_state = 'done';
    s0 = sent.length;
    var stalledCarry = hubQuietOwedCarry_({ letter: hubLetterQuietCarry_ });
    var stalledSent = sent.slice(s0);
    stAssert_(out, 'stalled file: held at night as its row\'s id, said at 08:00 while the row still says ' +
                   'stalled, and let go when the file was read after all',
              stalledOwed === 2 && stalledCarry.carried === 1 && stalledCarry.stale === 1 &&
              stalledSent.length === 1 &&
              String(stalledSent[0].params.subject).indexOf(stillStalled[led.name]) !== -1 &&
              String(stalledCarry.why.join(' ')).indexOf('no longer stalled') !== -1,
              JSON.stringify({ owed: stalledOwed, carry: stalledCarry }).slice(0, 400));

    /* ── 5. THE PLATFORM'S OWN MAILBOX, THROUGH THE ONE DOOR ──────────── */
    var sugRows = [], hexN = 0;
    suggestionsSheet_ = function () { return { appendRow: function (r) { sugRows.push(r); } }; };
    randomHex_ = function (n) { hexN++; return ('H' + hexN + 'S' + stamp + '0000000000').slice(0, n); };
    platformMailCreds_ = function () { return { user: 'asa-hub@asaop.org' }; };
    hubTabWorkbook_ = function () { return {}; };
    readTabNormalized_ = function (wb, tab) {
      if (tab !== SUGGESTIONS_TAB) return [];
      return sugRows.map(function (r) {
        return { suggestionid: r[0], createdat: r[1], byemail: r[2], byname: r[3], role: r[4], text: r[5] };
      });
    };
    var who = { email: 'pat@asa.invalid', display_name: 'Pat Staff', role: 'staff' };
    s0 = sent.length;
    var sugDay = HUB_ACTIONS.suggestionCreate({ text: 'More shade in the yard ' + stamp }, who);
    var sugDaySent = sent.slice(s0);
    HUB_QUIET_NOW = NIGHT;
    var sugNight = HUB_ACTIONS.suggestionCreate({ text: 'A second kettle ' + stamp }, who);
    var sugOwed = letterKeys().filter(function (k) { return k.indexOf('suggestion|') !== -1; }).length;
    HUB_QUIET_NOW = DAY;
    s0 = sent.length;
    var sugCarry = hubQuietOwedCarry_({ letter: hubLetterQuietCarry_ });
    var sugCarried = sent.slice(s0);
    stAssert_(out, 'mailbox: a suggestion\'s copy is a letter through the one door — saved first, told to the ' +
                   'platform\'s own mailbox in the row\'s words by day, kept as its id at night and said at 08:00',
              sugDay.status === 200 && sugNight.status === 200 && sugRows.length === 2 &&
              sugDaySent.length === 1 && sugDaySent[0].params.to === 'asa-hub@asaop.org' &&
              sugDaySent[0].params.subject === 'Suggestion — Pat Staff' &&
              String(sugDaySent[0].params.reason) === 'smart comms: suggestion_mailbox_note' &&
              sugOwed === 1 && sugCarry.carried === 1 && sugCarried.length === 1 &&
              String(sugCarried[0].params.body).indexOf('A second kettle') !== -1 &&
              stCode_(HUB_ACTIONS.suggestionCreate).indexOf('platformMailOut_(') === -1,
              JSON.stringify({ day: sugDaySent.length, owed: sugOwed, carry: sugCarry }).slice(0, 400));
    var coRow = function (n) {
      return { id: 'CO2_' + stamp + '_' + n, type: 'Call Off', employee_name: 'Sam ' + n, date: '2026-09-24' };
    };
    var coRows = [coRow(1), coRow(2), coRow(3)];
    s0 = sent.length;
    var coDay = callOffsMailPass_(coRows, 1, 'asa-hub@asaop.org');
    var coDaySent = sent.slice(s0);
    HUB_QUIET_NOW = NIGHT;
    var coNightRows = [coRow(4), coRow(5)];
    s0 = sent.length;
    var coNight = callOffsMailPass_(coNightRows, 1, 'asa-hub@asaop.org');
    var coNightSent = sent.length - s0;
    HUB_QUIET_NOW = DAY;
    off.calloff_mailbox_note = true;
    s0 = sent.length;
    var coOff = callOffsMailPass_([coRow(6), coRow(7)], 1, 'asa-hub@asaop.org');
    var coOffSent = sent.length - s0;
    off.calloff_mailbox_note = false;
    rpcSendEnabled_ = function () { return false; };
    var coHeld = callOffsMailPass_([coRow(8)], 1, 'asa-hub@asaop.org');
    rpcSendEnabled_ = keep.sendOn;
    stAssert_(out, 'mailbox: each new call-off is a letter through the one door — told by day; at night the ' +
                   'pass STOPS on the held row so the next pass after 08:00 asks again, and keeps nothing; ' +
                   'switched off or held by a brake, the cursor moves past it',
              coDay.reached === 4 && coDay.counts.told === 3 && coDaySent.length === 3 &&
              coDaySent[0].params.subject === 'Call Off — Sam 1 (2026-09-24)' &&
              String(coDaySent[0].params.reason) === 'smart comms: calloff_mailbox_note' &&
              coNight.reached === 1 && coNight.stopped.indexOf('quiet') === 0 && coNightSent === 0 &&
              letterKeys().filter(function (k) { return k.indexOf('calloff_note') !== -1; }).length === 0 &&
              coOff.reached === 3 && coOff.counts.off === 2 && coOffSent === 0 &&
              coHeld.reached === 2 && coHeld.counts.held === 1 &&
              stCode_(callOffsMailSweepMaybe_).indexOf('platformMailOut_(') === -1,
              JSON.stringify({ day: coDay, night: coNight, off: coOff, held: coHeld }).slice(0, 500));
    var ab = HUB_ACTIONS.rpcAbilities({}, { role: 'admin', email: 'st@asa' });
    stAssert_(out, 'abilities: the doors that still call the mail transport themselves are named, each with why',
              !!(ab && ab.data && (ab.data.direct_doors || []).length === 2 &&
                 ab.data.direct_doors.every(function (d) { return d.door && d.why; })),
              JSON.stringify(ab && ab.data && ab.data.direct_doors));

    /* ── 6. THE WEEKLY KEY NOTICE KEEPS ITS MEASUREMENT, AND IS KEPT ──── */
    letterRows = letterRows.map(function (s) {
      if (s.id !== 'ai_keys_weekly_check') return s;
      return { id: s.id, enabled: 'yes', kind: 'letter', sms_text: 'K: {verdict}{retired_line}',
               email_subject: 'Keys{retired_count}', email_text: 'R: {report}' };
    });
    var lines = [];
    for (var ln = 0; ln < 400; ln++) lines.push('  · key ' + ln + ' — answered, throttled once, answered again');
    var longReport = lines.join('\n');
    HUB_QUIET_NOW = NIGHT;
    var kNight = aiKeyNotice_('3 ok', 1, longReport);
    var kKey = Object.keys(store).filter(function (k) { return k.indexOf('team_alert|ai_keys|') !== -1; })[0];
    var kEntry = kKey ? JSON.parse(store[kKey]) : null;
    stAssert_(out, 'ai keys: a notice held at night keeps what it MEASURED — a report too long for the list is ' +
                   'cut to fit and says so, rather than refused and lost',
              kNight.state === 'quiet' && kNight.owed === true && !!kEntry &&
              String(store[kKey]).length <= HUB_QUIET_OWED_BYTES && kEntry.data.report_cut === true &&
              String(kEntry.data.report).indexOf('did not fit') !== -1 && kEntry.data.verdict === '3 ok' &&
              kEntry.data.retired_count === 1,
              JSON.stringify({ night: kNight, len: kKey ? String(store[kKey]).length : 0 }));
    HUB_QUIET_NOW = DAY;
    smartSituations_ = function () { throw new Error('the situations tab did not answer'); };
    fresh();
    var kUnread = hubQuietOwedCarry_({ team_alert: hubTeamAlertQuietCarry_ });
    var kKeptAt = kKey && store[kKey] ? JSON.parse(store[kKey]).at : '';
    smartSituations_ = situations;
    fresh();
    s0 = sent.length;
    var kCarry = hubQuietOwedCarry_({ team_alert: hubTeamAlertQuietCarry_ });
    var kSent = sent.slice(s0).filter(function (m) { return m.name === 'teamAlert'; });
    stAssert_(out, 'ai keys: a switch that cannot be read at 08:00 KEEPS the notice for the next pass (first ' +
                   'instant kept); readable, it is said in the row\'s words with the measurement filled in',
              kUnread.kept === 1 && kUnread.carried === 0 && kKeptAt === NIGHT_ISO &&
              kCarry.carried === 1 && kSent.length === 1 &&
              kSent[0].params.subject === 'Keys (1 retired)' && kSent[0].params.body === 'K: 3 ok 1 retired.' &&
              String(kSent[0].params.mail_text).indexOf('R: ') === 0 &&
              String(kSent[0].params.mail_text).indexOf('did not fit') !== -1 &&
              String(kSent[0].params.reason).indexOf('held overnight') !== -1,
              JSON.stringify({ unread: kUnread, keptAt: kKeptAt, carry: kCarry }).slice(0, 400));
    // a team-alert carrier whose read THREW keeps its entry too
    ssOpen_ = function () { throw new Error('the candidates book did not answer'); };
    var thrown = hubTeamAlertQuietCarry_({ kind: 'hired', cid: 'CAN_ST2_' + stamp },
                                         { key: 'hired|CAN_ST2_' + stamp, at: NIGHT_ISO });
    var thrownKey = Object.keys(store).filter(function (k) { return k.indexOf('team_alert|hired|CAN_ST2_') !== -1; })[0];
    ssOpen_ = keep.ssOpen;
    stAssert_(out, 'team alert: a carrier whose read threw could not tell whether the alert is still true — ' +
                   'the entry goes back on the list, never let go as stale',
              thrown.state === 'kept' && !!thrownKey && JSON.parse(store[thrownKey]).at === NIGHT_ISO,
              JSON.stringify(thrown));
    if (thrownKey) delete store[thrownKey];

    /* ── 7. A PERSON DOOR READS THE MAP TWICE BEFORE AN OUTAGE HOLDS IT ─ */
    hiringAlerts_ = function () { return { test_mode: 'on' }; };
    // the held row's own readers ask the situations too; only the armed map's reads are counted here
    var heldRows = 0;
    commMockHeld_ = function () { heldRows++; };
    var reads = 0;
    smartSituations_ = function () {
      reads++;
      if (reads === 1) throw new Error('one hiccup');
      return [{ id: 'gate_drive_grant_reader', enabled: 'no' }];
    };
    fresh();
    var hiccup = hubGateHolds_('gate_drive_grant_reader', { subject: 'st' });
    var hiccupReads = reads;
    reads = 0;
    smartSituations_ = function () { reads++; throw new Error('the situations tab did not answer'); };
    fresh();
    var outage = hubGateHolds_('gate_drive_grant_reader', { subject: 'st' });
    var outage2 = hubGateHolds_('gate_calendar_file_link', { subject: 'st' });
    stAssert_(out, 'gates: one failed read does not hold a person door — it reads the map once more; only a ' +
                   'second failure holds, and the third door in the same execution does not read a third time',
              hiccup.held === false && hiccupReads === 2 &&
              outage.held === true && String(outage.why).indexOf('(asked twice)') !== -1 &&
              outage2.held === true && reads === 2 && heldRows === 2,
              JSON.stringify({ hiccup: hiccup, hiccupReads: hiccupReads, outage: outage.held, reads: reads,
                               rows: heldRows }));
    commMockHeld_ = keep.held;
    stAssert_(out, 'gates: a door left private by its gate says so in its own answer — the calendar file, the ' +
                   'generated image and the phone-screen report — so the screen never promises a link that ' +
                   'opens for nobody',
              stCode_(HUB_ACTIONS.calendarDayFileStore).indexOf('data.shared = false') !== -1 &&
              stCode_(HUB_ACTIONS.calendarDayFileStore).indexOf('shared_why') !== -1 &&
              stCode_(wbGenerateImageFile_).indexOf('shared_why') !== -1 &&
              stCode_(HUB_ACTIONS.screenAnalyze).indexOf('report_share: reportShare') !== -1 &&
              stCode_(hubShareWithAdmins_).indexOf('held_why') !== -1, '');

    /* ── 8. A SECRET NEVER REACHES A TESTER'S COPY ────────────────────── */
    RPC_TEST_TRANSPORT = null;
    RPC_TEST_FORCE_ON = false;
    var mailed = [], texted = [];
    rpcSendEnabled_ = function () { return true; };
    hubTestRedirect_ = function () {
      return { sms: ['+13305550100'], emails: ['tester@example.invalid'], sheet: false, shared: [] };
    };
    platformMailOut_ = function (to, subject, body, html) {
      mailed.push({ to: to, subject: subject, body: body, html: html });
      return { sent: true, receipt: 'st2-mail' };
    };
    rpcFanOutSms_ = function (name, list, body) { texted.push(String(body || '')); return { ok: true, sent: true }; };
    var secret = 'S3cret-Passw0rd-' + stamp;
    rpcSend_('emailSend', HUB_RPC.emailSend, { to: 'owner@example.invalid', subject: 'Your mailbox',
                                               body: 'Password: ' + secret, withhold: secret, reason: 'st' });
    rpcSend_('emailSend', HUB_RPC.emailSend, { to: 'owner@example.invalid', subject: 'Plain',
                                               body: 'nothing secret here', reason: 'st' });
    var link = 'https://hub.example/#/register?t=TOKEN' + stamp;
    rpcSend_('smsSend', HUB_RPC.smsSend, { to: '+13305550199', body: 'Join: ' + link, withhold: link, reason: 'st' });
    rpcSendEnabled_ = keep.sendOn;
    hubTestRedirect_ = keep.redirect;
    rpcFanOutSms_ = keep.fanOut;
    platformMailOut_ = function () { providerCalls.push('mail'); return { sent: false, receipt: '' }; };
    RPC_TEST_FORCE_ON = true;
    stAssert_(out, 'withhold: a letter redirected to the testers carries the placeholder, never the secret — ' +
                   'the mailbox password and a registration link reach only their owner',
              mailed.length === 2 && mailed[0].to === 'tester@example.invalid' &&
              String(mailed[0].body).indexOf(secret) === -1 && String(mailed[0].body).indexOf('{withheld}') !== -1 &&
              String(mailed[1].body).indexOf('nothing secret here') !== -1 &&
              texted.length === 1 && texted[0].indexOf('TOKEN' + stamp) === -1 &&
              stCode_(mailboxEnsure_).indexOf('withhold: String(env.data.password)') !== -1,
              JSON.stringify({ mailed: mailed.map(function (m) { return m.body.slice(-60); }), texted: texted }));

    /* ── 9. THE RESOURCE DOOR'S GATE, AND WHEN A SWITCH ACTS ──────────── */
    RPC_TEST_TRANSPORT = keep.transport;
    hiringAlerts_ = function () { return { test_mode: 'on' }; };
    smartSituations_ = function () { return [{ id: 'gate_resource_write_door', enabled: 'yes' }]; };
    fresh();
    var resHeld = (typeof hubResourceGate_ === 'function') ? hubResourceGate_('staff', 'create') : 'missing';
    smartSituations_ = function () { return [{ id: 'gate_resource_write_door', enabled: 'no' }]; };
    fresh();
    var resOpen = (typeof hubResourceGate_ === 'function') ? hubResourceGate_('staff', 'create') : 'missing';
    var wired = hubGateWired_('gate_resource_write_door');
    var routeAsks = (typeof route === 'function') && stCode_(route).indexOf('hubResourceGate_(') !== -1;
    stAssert_(out, 'resource door: its gate is ready outside Main.gs — armed while the lane holds it answers ' +
                   '409, off it answers nothing — and the Desk says it is not wired until the route asks it',
              resHeld && resHeld.status === 409 && resOpen === null &&
              wired.wired === routeAsks && (routeAsks || wired.why.indexOf('hubResourceGate_') !== -1),
              JSON.stringify({ held: resHeld, open: resOpen, wired: wired }));
    var desk = hubGateDesk_([]);
    stAssert_(out, 'the Desk: the gate board says when a switch acts — at once from the Desk, up to the armed ' +
                   'map\'s lifetime for a cell typed straight into the tab',
              String(desk.lag).indexOf('typed straight into the situations tab') !== -1 &&
              String(desk.lag).indexOf(Math.round(HUB_GATE_ARMED_TTL_S / 60) + ' minutes') !== -1,
              String(desk.lag));
    stAssert_(out, 'second pass: no provider was knocked on — every door here was a stand-in',
              providerCalls.length === 0, providerCalls.join(','));
  } catch (e) {
    stAssert_(out, 'smart gate, second pass: the section ran', false, String((e && e.stack) || e));
  } finally {
    // The force flag first: while set, every other function believes sending is on.
    RPC_TEST_FORCE_ON = keep.force;
    RPC_TEST_TRANSPORT = keep.transport;
    hiringAlerts_ = keep.cfg;
    commMockWrite_ = keep.mWrite;
    COMM_MOCK_DEAD = keep.mDead;
    COMM_MOCK_WRITTEN = keep.mWritten;
    hubRehearsalWrite_ = keep.rWrite;
    hubSysLog_ = keep.log;
    smartSituations_ = keep.sits;
    optOutIndex_ = keep.optOut;
    commMockQuietSeen_ = keep.quietSeen;
    hubQuietOwedKeys_ = keep.qKeys;
    hubQuietOwedGet_ = keep.qGet;
    hubQuietOwedSet_ = keep.qSet;
    hubQuietOwedDel_ = keep.qDel;
    HUB_QUIET_NOW = keep.quietNow;
    formBySlug_ = keep.formBySlug;
    requireRow_ = keep.requireRow;
    readTabNormalized_ = keep.readTab;
    hubTabWorkbook_ = keep.tabWb;
    suggestionsSheet_ = keep.sugSheet;
    randomHex_ = keep.hex;
    platformMailCreds_ = keep.creds;
    platformMailOut_ = keep.mailOut;
    rpcFanOutSms_ = keep.fanOut;
    rpcOpenPhoneSms_ = keep.phone;
    hubTeamNotify_ = keep.team;
    hubTestRedirect_ = keep.redirect;
    rpcSendEnabled_ = keep.sendOn;
    ssOpen_ = keep.ssOpen;
    commMockHeld_ = keep.held;
    hubGatesArmedCache_ = keep.gateCache;
    HUB_GATE_ARMED_MEMO = null;
    HUB_GATE_SAID = keep.gateSaid;
    HUB_GATE_REREAD_DONE = keep.reread;
    HUB_LETTER_UNREADABLE_SAID = keep.letterSaid;
    HUB_SWITCH_UNREADABLE_WHY = keep.unreadable;
    HUB_SWITCH_UNREADABLE_SAID = keep.unreadableSaid;
    COMM_DIAL_MEMO = keep.dialMemo;
    COMM_DIAL_UNREADABLE = keep.dialUnreadable;
  }
}
