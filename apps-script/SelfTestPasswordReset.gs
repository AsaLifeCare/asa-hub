// FORGOT PASSWORD, RUN RATHER THAN READ (PasswordReset.gs, Auth.gs authLogin).
// A person with no session asks from the sign-in screen and gets a fresh random temporary password: by e-mail to…

/** A sheet as an array of rows, answering the calls the reset and the sign-in make. */
function stPrSheet_(header, rows) {
  var grid = [header.slice()].concat((rows || []).map(function (r) { return r.slice(); }));
  return {
    grid: grid,
    appendRow: function (r) { grid.push(r.slice()); },
    getDataRange: function () {
      return { getValues: function () { return grid.map(function (r) { return r.slice(); }); } };
    },
    getLastColumn: function () { return grid[0].length; },
    getRange: function (r, c) {
      return {
        setValue: function (v) {
          while (grid[r - 1].length < c) grid[r - 1].push('');
          grid[r - 1][c - 1] = v;
        },
        getValues: function () { return [grid[r - 1].slice()]; }
      };
    }
  };
}

function stPasswordReset_(out) {
  var keep = {
    userBy: userByEmail_, allowed: hubAuthLetterAllowed_, tempSheet: resetTempSheet_, tabSheet: hubTabSheet_,
    cfg: hiringAlerts_, creds: platformMailCreds_, post: platformMailPost_, mailLog: mailLogOut_,
    deciders: mailAlsoTellDeciders_, log: hubSysLog_, sits: smartSituations_, optOut: optOutBlocked_,
    mWrite: commMockWrite_, mDead: COMM_MOCK_DEAD, mWritten: COMM_MOCK_WRITTEN, rWrite: hubRehearsalWrite_,
    record: smartRecord_, transport: RPC_TEST_TRANSPORT, force: RPC_TEST_FORCE_ON,
    unreadable: HUB_SWITCH_UNREADABLE_WHY, unreadableSaid: HUB_SWITCH_UNREADABLE_SAID,
    boot: hubPropsBoot_, sheet: hubSheet_, mailbox: mailboxEnsure_, pub: userPublic_,
    badges: hubCalendarBadges_, human: worldHuman_, session: sessionCreate_, master: hubIsMaster_,
    shared: commReleaseSharedLine_
  };
  var stamp = String(new Date().getTime());
  var cache = CacheService.getScriptCache();
  var cacheKeys = [];
  var logs = [], mocked = [], rehearsed = [], posted = [], mailLogged = [], ledger = [], texts = [];
  var postAnswer = null;
  var GENERIC = JSON.stringify({ status: 200, data: { sent: true } });

  var PAT = 'pat.' + stamp + '@example.invalid';
  var OWN_PW = 'Own-Password-7';
  var usersHdr = ['user_id', 'email', 'display_name', 'role', 'salt', 'pass_hash', 'active',
                  'last_login', 'must_change', 'phone', 'phones'];
  var people = [
    ['U_PAT_' + stamp, PAT, 'Pat', 'staff', 'saltPAT', hashPassword_(OWN_PW, 'saltPAT'), 'true',
     '2026-01-01T00:00:00Z', '', '+13305550142', ''],
    // signs in with a number: no mailbox on the account
    ['U_NUM_' + stamp, '33055' + stamp.slice(-5), 'Num', 'staff', 's2', 'h2', 'true', '', '', '',
     JSON.stringify([{ label: 'Cell', number: '(330) 555-0143' }])],
    ['U_BLK_' + stamp, 'blk.' + stamp + '@example.invalid', 'Blk', 'staff', 's3', 'h3', 'false', '', '',
     '+13305550144', ''],
    // no address and no number: nothing can reach them
    ['U_NONE_' + stamp, 'none' + stamp, 'None', 'staff', 's4', 'h4', 'true', '', '', '', '']
  ];
  var users = stPrSheet_(usersHdr, people);
  var temps = stPrSheet_(RESET_TEMP_HEADER, []);
  var asObj = function (row) {
    var o = {};
    users.grid[0].forEach(function (h, i) { o[normKey_(h)] = row[i]; });
    return o;
  };
  var byIdent = function (ident) {
    var want = String(ident || '').trim().toLowerCase();
    for (var i = 1; i < users.grid.length; i++) {
      if (String(users.grid[i][1]).toLowerCase() === want) return asObj(users.grid[i]);
    }
    return null;
  };
  var ask = function (ident, extra) {
    var p = { identifier: ident };
    for (var k in (extra || {})) p[k] = extra[k];
    cacheKeys.push('pf_' + sha256Hex_(String(ident).toLowerCase()));
    return authForgotPub_(p);
  };
  var login = function (ident, pw) {
    cacheKeys.push('lf_' + sha256Hex_(String(ident).toLowerCase()));
    return authRoute_('authLogin', { identifier: ident, password: pw }, '');
  };
  var uidOf = function (i) { return String(people[i][0]); };
  var accountKeys = function (uid) {
    cacheKeys.push('pfa_' + sha256Hex_(uid), 'pfbusy_' + uid);
  };
  var clearCounts = function () {
    cacheKeys.forEach(function (k) { try { cache.remove(k); } catch (e) { } });
  };
  var pwIn = function (text) {
    var m = String(text || '').match(/temporary password is ([A-Za-z0-9]+)/);
    return m ? m[1] : '';
  };
  var answers = [];
  var said = function (a) { answers.push(JSON.stringify(a)); return a; };
  var logged = function (action) {
    return logs.filter(function (l) { return l.action === action; });
  };
  var everythingKept = function () {
    return JSON.stringify([logs, mocked, rehearsed, mailLogged, ledger, temps.grid]);
  };
  [0, 1, 2, 3].forEach(function (i) { accountKeys(uidOf(i)); });

  try {
    userByEmail_ = byIdent;
    hubAuthLetterAllowed_ = function () { return { on: true, row: null, unreadable: false, why: '' }; };
    resetTempSheet_ = function () { return temps; };
    hubTabSheet_ = function (tab) { return tab === RESET_TEMP_TAB ? temps : null; };
    // THE DIAL AT THE SHEET: nothing else on the platform leaves while these checks run
    hiringAlerts_ = function () { return { test_mode: 'sheet' }; };
    HUB_SWITCH_UNREADABLE_WHY = ''; HUB_SWITCH_UNREADABLE_SAID = false;
    platformMailCreds_ = function () { return { user: 'asa-hub@asaop.org', password: 'st' }; };
    platformMailPost_ = function (path, body) {
      posted.push({ path: path, body: JSON.parse(JSON.stringify(body || {})) });
      if (typeof postAnswer === 'function') return postAnswer(path, body);
      return { status: 200, data: { receipt: 'queued', message_id: '<st.' + posted.length + '@asaop.org>' } };
    };
    mailLogOut_ = function (rec) { mailLogged.push(rec || {}); return true; };
    mailAlsoTellDeciders_ = function (s, t, cc) { return cc; };
    hubSysLog_ = function (who, action, what) {
      logs.push({ who: String(who || ''), action: String(action || ''), what: String(what || '') });
      return true;
    };
    smartSituations_ = function () { return []; };
    optOutBlocked_ = function () { return ''; };
    commMockWrite_ = function (row) { mocked.push(row); };
    COMM_MOCK_DEAD = {};
    COMM_MOCK_WRITTEN = 0;
    hubRehearsalWrite_ = function (row) { rehearsed.push(row); return 'rh-' + rehearsed.length; };
    smartRecord_ = function (key, situation, person, expires, channel) {
      ledger.push({ situation: situation, person: person, channel: channel });
      return true;
    };
    RPC_TEST_TRANSPORT = function (name, params) {
      texts.push({ name: name, params: params || {} });
      return { ok: true, sent: true, gated: false, method: name, receipt: 'st-text-' + texts.length };
    };
    RPC_TEST_FORCE_ON = true;
    hubPropsBoot_ = function () { return true; };
    hubSheet_ = function (tab) { return tab === USERS_TAB ? users : stPrSheet_(['x'], []); };
    mailboxEnsure_ = function () { return null; };
    userPublic_ = function (u) {
      return { id: str_(u.userid), email: str_(u.email),
               must_change_password: str_(u.mustchange).toLowerCase() === 'true' };
    };
    hubCalendarBadges_ = function () { return []; };
    worldHuman_ = function () { return false; };
    sessionCreate_ = function (uid) { return 'st-session-' + uid; };
    hubIsMaster_ = function () { return false; };
    commReleaseSharedLine_ = function (n) { return String(n || '').replace(/\D/g, '').slice(-4) === '0188'; };

    /* ── THE DOOR: no session in front of it ────────────────────────── */
    var post = stCode_(doPost);
    stAssert_(out, 'reset: the forgot door is answered before the session gate — a person with no session reaches it',
              post.indexOf("action === 'authForgot'") !== -1 &&
              post.indexOf("action === 'authForgot'") < post.indexOf('sessionUser_(body.token)') &&
              post.indexOf("PASSWORD_RESET_DOORS = ['authForgot'") !== -1 &&
              post.indexOf('authForgotPub_(payload)') !== -1, '');
    stAssert_(out, 'reset: even a failure inside the door answers the one generic yes',
              post.indexOf("action === 'authForgot'\n        ? { status: 200, data: { sent: true } }") !== -1 ||
              /action === 'authForgot'\s*\?\s*\{ status: 200, data: \{ sent: true \} \}/.test(post), '');

    /* ── THE E-MAIL LEG ────────────────────────────────────────────── */
    var p0 = posted.length;
    var viaMail = said(ask(PAT.toUpperCase()));
    var letter = posted.length > p0 ? posted[posted.length - 1] : { body: {} };
    var pw1 = pwIn(letter.body.body);
    stAssert_(out, 'reset: the letter goes to the address on the account, through the one mail door, with a fresh ' +
                   'random temporary password in it',
              JSON.stringify(viaMail) === GENERIC && letter.path === '/mail/send' && letter.body.to === PAT &&
              pw1.length >= 10 && texts.length === 0,
              JSON.stringify({ to: letter.body.to, len: pw1.length, texts: texts.length }));
    stAssert_(out, 'reset: the letter says what the platform promised, in English, and signs in at the platform',
              String(letter.body.subject) === 'ASA MyLife — your temporary password' &&
              String(letter.body.body).indexOf('ASA MyLife: your temporary password is ' + pw1 + '.') === 0 &&
              String(letter.body.body).indexOf('Sign in at https://asamylife.asalifecare.com and choose a new one.') !== -1 &&
              String(letter.body.html).indexOf('<a href="https://asamylife.asalifecare.com">') !== -1,
              String(letter.body.body).slice(0, 200));
    stAssert_(out, 'reset: the letter passes the dial at the sheet by name, asks the relay whether the address can ' +
                   'receive mail, signs as the platform, and names the password for the relay to keep out of Sent',
              rehearsed.length === 0 && letter.body.check_reach === true && letter.body.from_name === 'ASA MyLife' &&
              JSON.stringify(letter.body.withhold || []).indexOf(pw1) !== -1,
              JSON.stringify({ reach: letter.body.check_reach, from: letter.body.from_name, rehearsed: rehearsed.length }));
    var row1 = temps.grid[temps.grid.length - 1] || [];
    var hIdx = RESET_TEMP_HEADER.indexOf('pass_hash'), sIdx = RESET_TEMP_HEADER.indexOf('salt');
    var made = new Date(row1[RESET_TEMP_HEADER.indexOf('created_at')]).getTime();
    var ends = new Date(row1[RESET_TEMP_HEADER.indexOf('expires_at')]).getTime();
    stAssert_(out, 'reset: the password is stored only as its salted hash, the way users.pass_hash is, and only ' +
                   'after the letter left',
              temps.grid.length === 2 && row1[0] === uidOf(0) && row1[hIdx] === hashPassword_(pw1, row1[sIdx]) &&
              String(row1[sIdx]).length === 32 && row1.join('|').indexOf(pw1) === -1 &&
              row1[RESET_TEMP_HEADER.indexOf('channel')] === 'email',
              JSON.stringify(row1));
    stAssert_(out, 'reset: the temporary password is short-lived — its window is minutes, never days',
              RESET_TEMP_MINUTES > 0 && RESET_TEMP_MINUTES <= 60 && ends - made === RESET_TEMP_MINUTES * 60000,
              String((ends - made) / 60000));
    stAssert_(out, 'reset: the account\'s own password is not touched by the ask — a stranger typing somebody\'s ' +
                   'address can never lock them out',
              users.grid[1][5] === hashPassword_(OWN_PW, 'saltPAT') && users.grid[1][4] === 'saltPAT', '');
    var sent1 = logged('password_reset_sent');
    stAssert_(out, 'reset: the log says it left by e-mail and carries the Message-ID the mailserver\'s log is ' +
                   'searched by',
              sent1.length === 1 && sent1[0].what.indexOf('by e-mail') !== -1 &&
              sent1[0].what.indexOf('<st.') !== -1, JSON.stringify(sent1));

    /* ── THE TEMPORARY PASSWORD, AT THE SIGN-IN ────────────────────── */
    var first = login(PAT, pw1);
    var patRow = users.grid[1];
    var mustCol = usersHdr.indexOf('must_change');
    stAssert_(out, 'sign-in: the temporary password opens a session once, and that session is sent to choose a ' +
                   'password of their own',
              first.status === 200 && first.data.user.must_change_password === true &&
              String(patRow[mustCol]) === 'true' &&
              !!String(temps.grid[1][RESET_TEMP_HEADER.indexOf('used_at')]),
              JSON.stringify(first));
    var again = login(PAT, pw1);
    stAssert_(out, 'sign-in: used once, the temporary password opens nothing again',
              again.status === 401, JSON.stringify(again));
    var own = login(PAT, OWN_PW);
    stAssert_(out, 'sign-in: the account\'s own password kept working beside it',
              own.status === 200, JSON.stringify(own));
    stAssert_(out, 'sign-in: the change the gate asks for clears the demand, and needs no old password',
              stCode_(HUB_ACTIONS.profileUpdate).indexOf("fields.must_change = ''") !== -1 &&
              stCode_(HUB_ACTIONS.profileUpdate).indexOf('fields.pass_hash = hashPassword_(newPw, pwSalt)') !== -1 &&
              stCode_(keep.pub)
                .indexOf("must_change_password: str_(u.mustchange).toLowerCase() === 'true'") !== -1, '');
    var spend = stCode_(authRoute_);
    stAssert_(out, 'sign-in: the temporary password is spent BEFORE a session is made, so it can never open two',
              spend.indexOf('resetTempSpend_(temp)') !== -1 &&
              spend.indexOf('resetTempSpend_(temp)') < spend.indexOf('sessionCreate_(str_(u.userid))'), '');

    // expiry, and only the newest one counts
    users.grid[1][mustCol] = '';
    var saltX = 'st-salt-expired-0000000000000000';
    temps.appendRow([uidOf(0), saltX, hashPassword_('Expired2Temp', saltX), 'email',
                     new Date(Date.now() - 7200000).toISOString(), new Date(Date.now() - 60000).toISOString(), '']);
    var expired = login(PAT, 'Expired2Temp');
    stAssert_(out, 'expiry: a temporary password past its window opens nothing',
              expired.status === 401 && String(users.grid[1][mustCol]) === '', JSON.stringify(expired));
    var saltO = 'st-salt-older-00000000000000000', saltN = 'st-salt-newer-00000000000000000';
    temps.appendRow([uidOf(0), saltO, hashPassword_('Older2Temp9x', saltO), 'email', new Date(Date.now() - 7200000).toISOString(),
                     new Date(Date.now() + 600000).toISOString(), '']);
    temps.appendRow([uidOf(0), saltN, hashPassword_('Newer3Temp8y', saltN), 'email', new Date(Date.now() - 7200000).toISOString(),
                     new Date(Date.now() + 600000).toISOString(), '']);
    var older = login(PAT, 'Older2Temp9x');
    var newer = login(PAT, 'Newer3Temp8y');
    stAssert_(out, 'expiry: a newer temporary password retires the older one',
              older.status === 401 && newer.status === 200, JSON.stringify([older.status, newer.status]));

    // ── THE TEXT, WHEN THE LETTER CANNOT REACH THEM ───────────────── no address on the account: the number on…
    var num = String(people[1][1]);
    var t0 = texts.length, q0 = posted.length;
    var viaNoMail = said(ask(num, { phone: '+19999999999', to: '+19999999999' }));
    var text1 = texts.length > t0 ? texts[texts.length - 1].params : {};
    var pw2 = pwIn(text1.body);
    stAssert_(out, 'text: an account with no address gets the text, at the number on the account — never the ' +
                   'one typed on the form',
              JSON.stringify(viaNoMail) === GENERIC && posted.length === q0 && texts.length === t0 + 1 &&
              text1.to === '+13305550143' && JSON.stringify(text1).indexOf('9999999') === -1,
              JSON.stringify({ to: text1.to, posted: posted.length - q0 }));
    stAssert_(out, 'text: the words are the platform\'s sentence, word for word',
              String(text1.body) === 'ASA MyLife: your temporary password is ' + pw2 +
                                     '. Sign in at https://asamylife.asalifecare.com and choose a new one.' &&
              pw2.length >= 10 && pw2 !== pw1, String(text1.body));
    stAssert_(out, 'text: it claims the reset by name, passes the dial at the sheet, and names the password to ' +
                   'withhold from every record of it',
              text1.auth_letter === 'password_reset' && rehearsed.length === 0 &&
              JSON.stringify(text1.withhold) === JSON.stringify([pw2]),
              JSON.stringify({ auth: text1.auth_letter, rehearsed: rehearsed.length }));
    var row2 = temps.grid[temps.grid.length - 1];
    stAssert_(out, 'text: the password it carried is the one stored, as a hash, marked as sent by text',
              row2[0] === uidOf(1) && row2[RESET_TEMP_HEADER.indexOf('channel')] === 'sms' &&
              row2[hIdx] === hashPassword_(pw2, row2[sIdx]) && ledger.some(function (l) {
                return l.situation === 'auth_password_reset' && l.channel === 'sms';
              }), JSON.stringify(row2));
    stAssert_(out, 'text: a shared line on the account (a house phone) never carries a password — the next number does',
              resetPhoneOnFile_({ phone: '+13305550188',
                                  phones: JSON.stringify([{ label: 'Cell', number: '330-555-0177' }]) }) === '+13305550177' &&
              resetPhoneOnFile_({ phone: '+13305550188', phones: '' }) === '', '');

    // a recorded bounce: the relay answers 422 and the text carries it
    clearCounts();
    var b0 = texts.length;
    postAnswer = function () {
      return { status: 422, message: 'undeliverable (bounced)',
               data: { undeliverable: 'bounced', bounced_at: '2026-09-29T20:57:00+00:00' } };
    };
    var viaBounce = said(ask(PAT));
    var text2 = texts.length > b0 ? texts[texts.length - 1].params : {};
    stAssert_(out, 'text: an address the relay says bounced is not mailed again — the text goes to the phone on ' +
                   'the account',
              JSON.stringify(viaBounce) === GENERIC && texts.length === b0 + 1 && text2.to === '+13305550142' &&
              logged('platform_mail_undeliverable').length === 1 &&
              logged('password_reset_sent').slice(-1)[0].what.indexOf('cannot receive mail') !== -1,
              JSON.stringify(logged('password_reset_sent').slice(-1)));
    // a send that failed outright
    clearCounts();
    var f0 = texts.length;
    postAnswer = function () { throw new Error('the relay did not answer'); };
    var viaFail = said(ask(PAT));
    var text3 = texts.length > f0 ? texts[texts.length - 1].params : {};
    stAssert_(out, 'text: a letter that could not be sent is followed by the text',
              JSON.stringify(viaFail) === GENERIC && texts.length === f0 + 1 && text3.to === '+13305550142' &&
              pwIn(text3.body) !== pwIn(text2.body), JSON.stringify(text3.to));
    postAnswer = null;

    // nothing can reach them: nothing is stored, and the log says why
    var n0 = temps.grid.length;
    var viaNothing = said(ask(String(people[3][1])));
    stAssert_(out, 'held: with no address and no number nothing is stored and the log says what could not reach them',
              JSON.stringify(viaNothing) === GENERIC && temps.grid.length === n0 &&
              logged('password_reset_held').slice(-1)[0].what.indexOf('no number on the account') !== -1,
              JSON.stringify(logged('password_reset_held')));

    /* ── THE CAPS ──────────────────────────────────────────────────── */
    clearCounts();
    var r0 = posted.length + texts.length;
    cache.put('pf_' + sha256Hex_(PAT.toLowerCase()), String(RESET_TEMP_PER_HOUR), 3600);
    var capIdent = said(ask(PAT));
    stAssert_(out, 'limit: a sign-in that already asked its share this hour sends nothing',
              JSON.stringify(capIdent) === GENERIC && posted.length + texts.length === r0 &&
              logged('password_reset_limited').slice(-1)[0].what.indexOf('this sign-in already asked') !== -1, '');
    clearCounts();
    cache.put('pfa_' + sha256Hex_(uidOf(0)), String(RESET_TEMP_PER_HOUR), 3600);
    var capAccount = said(ask(PAT));
    stAssert_(out, 'limit: an account that already asked its share sends nothing, whichever of its sign-ins asks',
              JSON.stringify(capAccount) === GENERIC && posted.length + texts.length === r0 &&
              logged('password_reset_limited').slice(-1)[0].what.indexOf('the account already asked') !== -1, '');
    clearCounts();
    var fresh = temps.grid.slice(1).filter(function (r) {
      return r[0] === uidOf(0) && new Date(r[RESET_TEMP_HEADER.indexOf('created_at')]).getTime() > Date.now() - 3600000;
    }).length;
    var capStore = said(ask(PAT));
    stAssert_(out, 'limit: the store counts the passwords the account was handed this hour, past any cache',
              fresh >= RESET_TEMP_PER_HOUR && JSON.stringify(capStore) === GENERIC &&
              posted.length + texts.length === r0 &&
              logged('password_reset_limited').slice(-1)[0].what.indexOf('temporary passwords this hour') !== -1,
              'fresh=' + fresh);
    clearCounts();
    cache.put('pfbusy_' + uidOf(0), '1', 120);
    var busy = said(ask(PAT));
    stAssert_(out, 'limit: while one reset of an account is on its way, a second ask sends nothing',
              JSON.stringify(busy) === GENERIC && posted.length + texts.length === r0 &&
              logged('password_reset_busy').length === 1, '');

    /* ── THE SAME ANSWER, WHATEVER HAPPENED ────────────────────────── */
    clearCounts();
    var stranger = 'nobody.' + stamp + '@example.invalid';
    said(ask(stranger));
    said(ask(String(people[2][1])));
    said(ask(''));
    said(authForgotPub_(null));
    hubAuthLetterAllowed_ = function () { return { on: false, row: null, unreadable: false, why: 'switched off' }; };
    said(ask(PAT));
    hubAuthLetterAllowed_ = keep.allowed;
    userByEmail_ = function () { throw new Error('the users tab did not answer'); };
    said(ask(PAT));
    userByEmail_ = byIdent;
    stAssert_(out, 'answer: sent, texted, held, limited, busy, unknown, blocked, switched off or broken — the ' +
                   'answer is the same generic yes, so the screen never tells who has an account',
              answers.length >= 14 && answers.every(function (a) { return a === GENERIC; }),
              answers.filter(function (a) { return a !== GENERIC; }).join(' | '));
    var unknown = logged('password_reset_no_account');
    stAssert_(out, 'answer: an address with no account is logged masked, never whole',
              unknown.length === 1 && unknown[0].who.indexOf(stranger) === -1 &&
              unknown[0].who.indexOf('@example.invalid') !== -1, JSON.stringify(unknown));
    stAssert_(out, 'answer: a blocked account is sent nothing',
              logged('password_reset_inactive').length === 1, '');

    /* ── NOTHING KEPT NAMES THE PASSWORD ───────────────────────────── */
    var issued = [pw1, pw2, pwIn(text2.body), pwIn(text3.body)].filter(String);
    var kept = everythingKept();
    stAssert_(out, 'secret: no log line, outbox row, rehearsal row, mail-ledger row, ledger line or stored row ' +
                   'names a temporary password',
              issued.length === 4 && issued.every(function (p) { return kept.indexOf(p) === -1; }) &&
              mocked.some(function (m) { return String(JSON.stringify(m)).indexOf('{withheld}') !== -1; }),
              issued.filter(function (p) { return kept.indexOf(p) !== -1; }).length + ' named');
    stAssert_(out, 'secret: the copy of the text the line\'s mirror files withholds it too',
              resetTextScrub_(text1.body).indexOf(pw2) === -1 &&
              resetTextScrub_(text1.body).indexOf('your temporary password is {withheld}.') !== -1 &&
              resetTextScrub_('see you at 9') === 'see you at 9' &&
              stCode_(quoHandleMessage_).indexOf('resetTextScrub_(') !== -1, resetTextScrub_(text1.body));
    stAssert_(out, 'secret: the held secret is let go when the ask ends, so it never reaches the next row written',
              HUB_RPC_SECRETS === null, JSON.stringify(HUB_RPC_SECRETS));

    /* ── NO FIXED PASSWORD ANYWHERE ────────────────────────────────── */
    var draws = {};
    var bad = [];
    for (var i = 0; i < 60; i++) {
      var d = tempPassword_();
      draws[d] = true;
      if (d.length < 10 || !/^[A-Za-z2-9]+$/.test(d) || /[0O1lIio]/.test(d)) bad.push(d);
    }
    stAssert_(out, 'random: every draw is fresh, ten characters or more, from an alphabet with no 0/O/o, 1/l/I/i',
              Object.keys(draws).length === 60 && bad.length === 0 &&
              !/[0O1lIio]/.test(TEMP_PASSWORD_ALPHABET) && TEMP_PASSWORD_LENGTH >= 10, bad.join(','));
    var doors = [authForgotPub_, resetDeliver_, resetMailLeg_, resetSmsLeg_, tempPassword_, HUB_ACTIONS.releaseUser];
    var fixed = doors.filter(function (fn) {
      var src = stCode_(fn);
      return src.indexOf('FIRST_USER_PASSWORD') !== -1 || src.indexOf('ONBOARDING_USER_PASSWORD') !== -1 ||
             src.indexOf('hubProp_(') !== -1;
    });
    stAssert_(out, 'random: neither reset reads a password from a property or a constant — the forgot door and ' +
                   'the master\'s Reset Password both mint one per press',
              fixed.length === 0 && stCode_(HUB_ACTIONS.releaseUser).indexOf('tempPassword_()') !== -1 &&
              stCode_(authForgotPub_).indexOf('tempPassword_()') !== -1, fixed.length + ' door(s)');

    /* ── THE TEXT IS THE ONE THAT PASSES THE DIAL, AND ONLY FOR THE RESET ─ */
    var h0 = rehearsed.length, s0 = texts.length;
    var inviteText = rpcCall_('smsSend', { to: '+13305550199', body: 'Your password is Abcdefgh23', reason: 'st',
                                           auth_letter: 'invitation', withhold: ['Abcdefgh23'] }, {});
    stAssert_(out, 'dial: a text claiming the invitation is still held at the sheet — only the reset\'s text ' +
                   'passes, the way the letters do',
              hubAuthTextKind_('password_reset') === 'password_reset' && hubAuthTextKind_('invitation') === '' &&
              hubAuthTextKind_('nonsense') === '' && Object.keys(HUB_AUTH_TEXTS).join(',') === 'password_reset' &&
              rehearsed.length === h0 + 1 && texts.length === s0 && !(inviteText && inviteText.sent),
              JSON.stringify(inviteText));
    stAssert_(out, 'dial: the provider door does not sink the reset\'s text and asks the dial for every other',
              stCode_(rpcOpenPhoneSms_).indexOf('hubAuthTextKind_(authKind) ? { pass: true }') !== -1 &&
              stCode_(rpcOpenPhoneSms_).indexOf('rpcSmsSinkPlan_(to, body, hubTestRedirect_())') !== -1, '');
  } catch (e) {
    stAssert_(out, 'password reset: the section ran', false, String((e && e.stack) || e));
  } finally {
    userByEmail_ = keep.userBy;
    hubAuthLetterAllowed_ = keep.allowed;
    resetTempSheet_ = keep.tempSheet;
    hubTabSheet_ = keep.tabSheet;
    hiringAlerts_ = keep.cfg;
    platformMailCreds_ = keep.creds;
    platformMailPost_ = keep.post;
    mailLogOut_ = keep.mailLog;
    mailAlsoTellDeciders_ = keep.deciders;
    hubSysLog_ = keep.log;
    smartSituations_ = keep.sits;
    optOutBlocked_ = keep.optOut;
    commMockWrite_ = keep.mWrite;
    COMM_MOCK_DEAD = keep.mDead;
    COMM_MOCK_WRITTEN = keep.mWritten;
    hubRehearsalWrite_ = keep.rWrite;
    smartRecord_ = keep.record;
    // the force flag first: while set, every other function believes sending is on
    RPC_TEST_FORCE_ON = keep.force;
    RPC_TEST_TRANSPORT = keep.transport;
    HUB_SWITCH_UNREADABLE_WHY = keep.unreadable;
    HUB_SWITCH_UNREADABLE_SAID = keep.unreadableSaid;
    hubPropsBoot_ = keep.boot;
    hubSheet_ = keep.sheet;
    mailboxEnsure_ = keep.mailbox;
    userPublic_ = keep.pub;
    hubCalendarBadges_ = keep.badges;
    worldHuman_ = keep.human;
    sessionCreate_ = keep.session;
    hubIsMaster_ = keep.master;
    commReleaseSharedLine_ = keep.shared;
    if (typeof hubSecretsRelease_ === 'function') hubSecretsRelease_();
    clearCounts();
  }
}
