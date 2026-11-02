// Release Users' counting: each letter's outcome, the run's tally and the once-per-app stamp, the send door's own…
// The app lane and the book are stood in for.
function stReleaseCount_(out) {
  /* ---- the door's own answers, sorted by the kind of hold ---------------- */
  stEq_(out, 'release count: the quiet window\'s answer is a quiet hold',
        commReleaseHoldKind_(hubQuietAnswer_('emailSend', { to: 'a@asa' })), 'quiet');
  stEq_(out, 'release count: a person\'s stop is declined',
        commReleaseHoldKind_({ ok: true, sent: false, gated: true, reason: 'opted_out', detail: 'a@asa said stop' }),
        'declined');
  // THE DOOR'S OWN SENTENCES for a list it could not read, taken from the code that writes them: optOutIndex_'s…
  var unreadWords = (/'(The opt-out list could not be read: )'/.exec(stCode_(optOutIndex_)) || [])[1] || '';
  var uncheckedWords = (/'(The opt-out list could not be checked: )'/.exec(stCode_(rpcCall_)) || [])[1] || '';
  stAssert_(out, 'release count: the two sentences of an unreadable opt-out list are still where the door writes them',
            !!unreadWords && !!uncheckedWords, 'the counting below matches on them');
  stEq_(out, 'release count: an opt-out list that could not be read is not a stop',
        commReleaseHoldKind_({ ok: true, sent: false, gated: true, reason: 'opted_out',
                               detail: unreadWords + 'Service Spreadsheets timed out' }), 'unchecked');
  stEq_(out, 'release count: nor is one whose read threw at the door',
        commReleaseHoldKind_({ ok: true, sent: false, gated: true, reason: 'opted_out',
                               detail: uncheckedWords + 'timeout' }), 'unchecked');
  stEq_(out, 'release count: and its hold is named as a list nobody could read, never as a stop',
        commReleaseHeldReason_({ gated: true, reason: 'opted_out', detail: unreadWords + 'x' }),
        'opt_out_unreadable');
  stEq_(out, 'release count: the rehearsal sheet is the dial',
        commReleaseHoldKind_({ ok: true, sent: false, gated: true, rehearsed: true, reason: 'rehearsal_sheet' }), 'dial');
  stEq_(out, 'release count: the sending switch is the dial',
        commReleaseHoldKind_({ ok: true, sent: false, gated: true, reason: 'HUB_RPC_SEND is off' }), 'dial');

  /* ---- one letter, one outcome, with the app lane stood in for ----------- */
  var keep = { tell: commReleaseAppTell_, on: (typeof smartSituations_ === 'function') ? smartSituations_ : null };
  var outcomeOf = function (answer) {
    commReleaseAppTell_ = function () { return answer; };
    return appReleaseLetterOut_({ email: 'a@asa', uid: 'U1', name: 'A' }, { id: 'cal', title: 'Calendar' });
  };
  var shapes = {};
  try {
    shapes.dial = outcomeOf({ sent: 0, held: 1, held_dial: 1, legs: ['email (held)'], why: ['email: rehearsal'] });
    shapes.optout = outcomeOf({ sent: 0, held: 1, declined: 1, legs: ['email (held)'], why: ['email: opted_out'] });
    shapes.quiet = outcomeOf({ sent: 0, held: 1, held_quiet: 1, legs: ['email (held)'], why: ['email: quiet_hours'] });
    shapes.both = outcomeOf({ sent: 0, held: 2, declined: 1, held_quiet: 1, legs: [], why: [] });
    shapes.wordless = outcomeOf({ sent: 0, held: 0, state: 'wordless', legs: [],
                                  why: ['the situation `app_release_announced` is absent, switched off'] });
    shapes.already = outcomeOf({ sent: 0, held: 0, deduplicated: 1, state: 'already', legs: [], why: [] });
    shapes.refused = outcomeOf({ sent: 0, held: 0, state: 'quiet', legs: [], why: ['email: transport'] });
    shapes.sent = outcomeOf({ sent: 1, held: 1, declined: 1, legs: ['email', 'sms (held)'], why: [] });
  } finally {
    commReleaseAppTell_ = keep.tell;
  }
  stEq_(out, 'release count: a dial hold is a rehearsal and not sent',
        shapes.dial.outcome + '|' + shapes.dial.redirected + '|' + shapes.dial.sent, 'dial|true|false');
  stEq_(out, 'release count: an opt-out is declined, and never a rehearsal',
        shapes.optout.outcome + '|' + shapes.optout.redirected, 'declined|false');
  stEq_(out, 'release count: a quiet hold is its own outcome', shapes.quiet.outcome, 'quiet');
  stEq_(out, 'release count: a letter the morning can still send is held, not declined', shapes.both.outcome, 'quiet');
  stEq_(out, 'release count: a situation gone silent stops the run, not one refusal per person',
        shapes.wordless.outcome, 'silenced');
  stEq_(out, 'release count: a letter the door already sent is not refused', shapes.already.outcome, 'already_sent');
  stEq_(out, 'release count: only a letter nothing held and nothing sent is refused', shapes.refused.outcome, 'failed');
  stEq_(out, 'release count: one leg out is a letter sent', shapes.sent.outcome, 'sent');

  var tally = appReleaseTally_();
  [shapes.sent, shapes.optout, shapes.optout].forEach(function (r) { appReleaseCount_(tally, r); });
  stEq_(out, 'release count: sent and declined are two numbers, and nothing is refused',
        tally.sent + '/' + tally.declined + '/' + tally.failed + '/' + tally.held_dial, '1/2/0/0');
  stEq_(out, 'release count: a person\'s stop does not keep the app from being announced',
        appReleaseComplete_(tally), true);
  var held = appReleaseTally_();
  [shapes.sent, shapes.dial].forEach(function (r) { appReleaseCount_(held, r); });
  stEq_(out, 'release count: a dial hold keeps the stamp waiting', appReleaseComplete_(held), false);
  var quiet = appReleaseTally_();
  [shapes.sent, shapes.quiet].forEach(function (r) { appReleaseCount_(quiet, r); });
  stEq_(out, 'release count: so does a quiet hold', appReleaseComplete_(quiet), false);
  var nobody = appReleaseTally_();
  appReleaseCount_(nobody, shapes.optout);
  stEq_(out, 'release count: a run that told nobody is not announced', appReleaseComplete_(nobody), false);
  stEq_(out, 'release count: a last page of stops after earlier pages told people closes the run',
        appReleaseComplete_(nobody, 3), true);
  var stopped = appReleaseTally_();
  [shapes.sent, shapes.wordless].forEach(function (r) { appReleaseCount_(stopped, r); });
  stAssert_(out, 'release count: a silenced run carries the sentence and no refusal',
            stopped.silenced.indexOf('switched off') !== -1 && stopped.failed === 0 && !appReleaseComplete_(stopped),
            JSON.stringify(stopped));

  /* ---- the run asks where the situation stands once, in its own words -------- */
  var rowsNow = [];
  var bookThrows = false;
  var states = {};
  try {
    smartSituations_ = function () {
      if (bookThrows) throw new Error('the book is down');
      return rowsNow;
    };
    var row = function (enabled, words) {
      return { id: 'app_release_announced', enabled: enabled, channels: 'sms, email',
               sms_text: words, email_text: words, email_subject: 'x' };
    };
    rowsNow = [row('yes', 'Open')];
    states.on = appReleaseSituationNow_();
    rowsNow = [row('no', 'Open')];
    states.off = appReleaseSituationNow_();
    rowsNow = [row('yes', '')];
    states.wordless = appReleaseSituationNow_();
    rowsNow = [];
    states.absent = appReleaseSituationNow_();
    bookThrows = true;
    states.unreadable = appReleaseSituationNow_();
  } finally {
    if (keep.on) smartSituations_ = keep.on;
  }
  stEq_(out, 'release count: the situation\'s five states are five answers',
        [states.on.state, states.off.state, states.wordless.state, states.absent.state, states.unreadable.state].join(','),
        'on,off,wordless,absent,unreadable');
  stAssert_(out, 'release count: an unreadable book says so, never "switched off"',
            /could not be read/.test(states.unreadable.why) && !/switched off/.test(states.unreadable.why),
            states.unreadable.why);
  stAssert_(out, 'release count: a switched-off situation says so, and that nobody was written to',
            /switched off/.test(states.off.why) && /nobody was written to/.test(states.off.why) && states.on.why === '',
            states.off.why);

  /* ---- the morning carry is registered where the morning happens ------------ */
  stAssert_(out, 'release count: the hotline pass carries an announcement the night held',
            typeof HUB_ACTIONS.hotlineSweep === 'function' &&
            stCode_(HUB_ACTIONS.hotlineSweep).indexOf('app_release: (typeof appReleaseQuietCarry_') !== -1,
            'an announcement owed to the morning list with no carrier is let go as stale');

  // ---- the morning carry keeps a debt only while it moves ------------------ The pass it hands the debt to is…
  var keepC = { auto: appReleaseAutoAnnounce_, badges: appReleaseBadgesFor_, owe: appReleaseOweMorning_ };
  var carry = {};
  var owedAgain = [];
  try {
    appReleaseBadgesFor_ = function () { return ['DIRECTOR']; };
    appReleaseOweMorning_ = function (appId) { owedAgain.push(appId); return true; };
    var debt = { app_id: 'cal', badges: ['DIRECTOR'], name: 'Calendar', since: new Date().toISOString() };
    appReleaseAutoAnnounce_ = function () { return { cal: { sent: 0, held_dial: 40, unwritten: 5 } }; };
    carry.held = appReleaseQuietCarry_(debt);
    carry.heldOwed = owedAgain.length;
    var asked = null;
    appReleaseAutoAnnounce_ = function (byApp, meta, opts) { asked = opts; return { cal: { sent: 40, unwritten: 5 } }; };
    carry.moved = appReleaseQuietCarry_(debt);
    carry.movedOwed = owedAgain.length - carry.heldOwed;
    carry.askedForCarry = !!(asked && asked.carry);
    var owedBefore = function () { return owedAgain.length; };
    var o0 = owedBefore();
    // refusals dominate: one told, thirty-nine refused, the same thirty-nine met first again
    appReleaseAutoAnnounce_ = function () { return { cal: { sent: 1, failed: 39, unwritten: 5 } }; };
    carry.refused = appReleaseQuietCarry_(debt);
    carry.refusedOwed = owedBefore() - o0;
    o0 = owedBefore();
    // the list read before the pass and failed at the door, nobody told
    appReleaseAutoAnnounce_ = function () { return { cal: { sent: 0, unchecked: 40, unwritten: 5 } }; };
    carry.unchecked = appReleaseQuietCarry_(debt);
    carry.uncheckedOwed = owedBefore() - o0;
    o0 = owedBefore();
    appReleaseAutoAnnounce_ = function () { return { cal: { sent: 30, unchecked: 10, unwritten: 5 } }; };
    carry.uncheckedMoved = appReleaseQuietCarry_(debt);
    carry.uncheckedMovedOwed = owedBefore() - o0;
    o0 = owedBefore();
    // forty told, and none of it reached the told-log: the next pass would meet the same forty
    appReleaseAutoAnnounce_ = function () { return { cal: { sent: 40, unwritten: 5, log_written: false } }; };
    carry.logLost = appReleaseQuietCarry_(debt);
    carry.logLostOwed = owedBefore() - o0;
    o0 = owedBefore();
    // forty stops and nobody told: the next pass skips them, so it moved
    appReleaseAutoAnnounce_ = function () { return { cal: { sent: 0, declined: 40, unwritten: 5 } }; };
    carry.declined = appReleaseQuietCarry_(debt);
    carry.declinedOwed = owedBefore() - o0;
    o0 = owedBefore();
    appReleaseAutoAnnounce_ = function () {
      return { cal: { sent: 0, deferred: true, kept_for_later: true,
                      why: 'the test-mode switch could not be read (no answer)' } };
    };
    carry.deferred = appReleaseQuietCarry_(debt);
    appReleaseBadgesFor_ = function () { throw new Error('the matrix timed out'); };
    carry.matrix = appReleaseQuietCarry_(debt);
    carry.matrixOwed = owedBefore() - o0;
  } finally {
    appReleaseAutoAnnounce_ = keepC.auto; appReleaseBadgesFor_ = keepC.badges; appReleaseOweMorning_ = keepC.owe;
  }
  stAssert_(out, 'release count: a morning pass every letter of which a switch held lets the debt go and says so',
            carry.held.state === 'stale' && carry.heldOwed === 0 &&
            /held by a switch — press Announce once it is off/.test(carry.held.why),
            JSON.stringify(carry.held));
  stAssert_(out, 'release count: a morning pass that told people keeps the rest for the next pass',
            carry.moved.state === 'carried' && carry.movedOwed === 1 && /kept for the next pass/.test(carry.moved.why),
            JSON.stringify(carry.moved));
  stAssert_(out, 'release count: the carry tells the pass it is the carry, so the pass leaves the keeping to it',
            carry.askedForCarry === true, 'the pass put unchecked people back on every pass itself');
  stAssert_(out, 'release count: a pass that spent more letters on refusals than it told lets the debt go',
            carry.refused.state === 'stale' && carry.refusedOwed === 0 && /39 refused/.test(carry.refused.why) &&
            /press Announce on Release Users to finish/.test(carry.refused.why),
            JSON.stringify(carry.refused));
  stAssert_(out, 'release count: so does one the door answered "could not be checked" for everybody',
            carry.unchecked.state === 'stale' && carry.uncheckedOwed === 0 &&
            /opt-out list could not be read/.test(carry.unchecked.why),
            JSON.stringify(carry.unchecked));
  stAssert_(out, 'release count: one that told most before the list failed keeps the rest',
            carry.uncheckedMoved.state === 'carried' && carry.uncheckedMovedOwed === 1,
            JSON.stringify(carry.uncheckedMoved));
  stAssert_(out, 'release count: a pass whose told-log did not land lets the debt go and names the log',
            carry.logLost.state === 'stale' && carry.logLostOwed === 0 &&
            /the told-log could not be written/.test(carry.logLost.why) &&
            /press Announce on Release Users once it writes/.test(carry.logLost.why),
            JSON.stringify(carry.logLost));
  stAssert_(out, 'release count: a pass that met only stops still moved — kept, never counted as said',
            carry.declined.state === 'kept' && carry.declinedOwed === 1,
            JSON.stringify(carry.declined));
  var sinceNow = Date.now();
  var stops = { 'cal|U1': sinceNow + 1000, 'cal|b@asa': sinceNow - 1000 };
  stAssert_(out, 'release count: a stop settles a person only for a debt owed before it',
            appReleaseDeclinedSince_(stops, 'cal', 'U1', 'a@asa', sinceNow) === true &&
            appReleaseDeclinedSince_(stops, 'cal', 'U2', 'b@asa', sinceNow) === false &&
            appReleaseDeclinedSince_(stops, 'cal', 'U1', 'a@asa', NaN) === false &&
            appReleaseDeclinedSince_(stops, 'mail', 'U1', 'a@asa', sinceNow) === false,
            'a stop older than the debt, a debt with no age, or another app settles nobody');
  stAssert_(out, 'release count: a read that did not land is kept, never counted as said',
            carry.deferred.state === 'kept' && carry.matrix.state === 'kept' && carry.matrixOwed === 1 &&
            /access matrix could not be read \(the matrix timed out\)/.test(carry.matrix.why),
            JSON.stringify([carry.deferred, carry.matrix]));

  // ---- the books keep the words, never the first password ------------------- Both legs of a release invite…
  var secret = 'Qx7!pw';
  var keepB = {
    sheet: hubRehearsalToSheet_, rWrite: hubRehearsalWrite_, write: commMockWrite_,
    dead: COMM_MOCK_DEAD, written: COMM_MOCK_WRITTEN, now: HUB_QUIET_NOW,
    optIdx: (typeof optOutIndex_ === 'function') ? optOutIndex_ : null,
    creds: platformMailCreds_, post: platformMailPost_, mailLog: mailLogOut_,
    deciders: mailAlsoTellDeciders_, log: hubSysLog_, transport: RPC_TEST_TRANSPORT,
    secrets: HUB_RPC_SECRETS
  };
  var rhRows = [], mockRows = [], mailRows = [], posted = [], legs = {};
  try {
    hubSecretsHold_([secret]);
    HUB_QUIET_NOW = '2026-09-22T16:00:00Z';
    if (keepB.optIdx) optOutIndex_ = function () { return { by: {}, error: '' }; };
    COMM_MOCK_DEAD = {};
    COMM_MOCK_WRITTEN = 0;
    RPC_TEST_TRANSPORT = null;
    hubSysLog_ = function () {};
    commMockWrite_ = function (row) { mockRows.push(row); };
    hubRehearsalWrite_ = function (row) { rhRows.push(row); return String(row.id || 'rh'); };
    hubRehearsalToSheet_ = function () { return true; };
    platformMailCreds_ = function () { return { user: 'hub@asa.example' }; };
    platformMailPost_ = function (path, extra) { posted.push(extra || {}); return { status: 200 }; };
    mailAlsoTellDeciders_ = function (subject, to, cc) { return cc; };
    mailLogOut_ = function (rec) { mailRows.push(rec); };
    legs.sms = rpcCall_('smsSend', { to: '+13305550101', body: 'Sign in with ' + secret + ' today.',
                                     reason: 'release: user_release_invite', withhold: [secret] }, {});
    legs.mail = rpcCall_('emailSend', { to: 'rin@asa.example', subject: 'Your account is ready',
                                        body: 'Temporary password: ' + secret, reason: 'release: user_release_invite',
                                        auth_letter: 'invitation', withhold: [secret] }, {});
  } catch (eB) {
    legs.error = String((eB && eB.message) || eB);
  } finally {
    hubRehearsalToSheet_ = keepB.sheet; hubRehearsalWrite_ = keepB.rWrite; commMockWrite_ = keepB.write;
    COMM_MOCK_DEAD = keepB.dead; COMM_MOCK_WRITTEN = keepB.written; HUB_QUIET_NOW = keepB.now;
    if (keepB.optIdx) optOutIndex_ = keepB.optIdx;
    platformMailCreds_ = keepB.creds; platformMailPost_ = keepB.post; mailLogOut_ = keepB.mailLog;
    mailAlsoTellDeciders_ = keepB.deciders; hubSysLog_ = keepB.log; RPC_TEST_TRANSPORT = keepB.transport;
    HUB_RPC_SECRETS = keepB.secrets;
  }
  var keeps = function (row) {
    var words = String((row && row.body) || (row && row.preview) || '') + ' ' + String((row && row.subject) || '');
    return words.indexOf(secret) === -1 && words.indexOf(HUB_WITHHELD_WORDS) !== -1 &&
           words.replace(/\{withheld\}/g, '').indexOf('withheld') === -1;
  };
  stAssert_(out, 'release count: the held text leaves a rehearsal row with the words and without the password',
            !legs.error && rhRows.length === 1 && keeps(rhRows[0]),
            legs.error || JSON.stringify(rhRows.map(function (r) { return r.body; })));
  stAssert_(out, 'release count: both legs leave a mock row with the words and without the password',
            mockRows.length === 2 && mockRows.every(keeps),
            JSON.stringify(mockRows.map(function (r) { return r.body; })));
  stAssert_(out, 'release count: the letter that left leaves a mail log row without the password',
            !!legs.mail && legs.mail.sent === true && mailRows.length === 1 && keeps(mailRows[0]),
            JSON.stringify({ sent: legs.mail && legs.mail.sent, log: mailRows }));
  stAssert_(out, 'release count: and the letter itself carries the password to the person',
            posted.length === 1 && String(posted[0].body || '').indexOf(secret) !== -1,
            JSON.stringify(posted.map(function (p) { return p.body; })));
  stAssert_(out, 'release count: a held secret and a named one are withheld in the same one word',
            (function () {
              var held = HUB_RPC_SECRETS;
              try {
                hubSecretsHold_([secret]);
                var scrubbed = hubSecretScrub_('use ' + secret);
                return scrubbed === hubWithhold_('use ' + secret, [secret]) && scrubbed === 'use ' + HUB_WITHHELD_WORDS;
              } finally { HUB_RPC_SECRETS = held; }
            })(),
            'the mail log ran the held net first and the mock outbox the named one, and each wrote its own word');
  stAssert_(out, 'release count: parameters echoed back never carry a withheld secret',
            JSON.stringify(rpcSafeParams_({ to: '+13305550101', body: 'use ' + secret,
                                            subject: secret, withhold: [secret] })).indexOf(secret) === -1,
            'the refusals hand their parameters back to the caller');
}
