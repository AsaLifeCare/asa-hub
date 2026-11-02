/** Time off's half of the send door; People, the calendar and the relay are stood in for. */
function stTimeOff_(out) {
  var seeds = {};
  SMART_EXTRA_SITUATIONS_SEED.forEach(function (s) { seeds[s.id] = s; });
  var kinds = Object.keys(STAFF_SHIFT_SITUATIONS).filter(function (k) { return k.indexOf('timeoff_') === 0; });
  stAssert_(out, 'time off: the door knows nine kinds, each a seeded situation, on, with SMS and e-mail words',
            kinds.length === 9 && kinds.every(function (k) {
              var s = seeds[STAFF_SHIFT_SITUATIONS[k]];
              return !!s && s.enabled === 'yes' && s.kind === 'shift_clock' && s.channels === 'sms, email' &&
                     s.to === '' && !!str_(s.sms_text) && !!str_(s.email_subject) && !!str_(s.email_text);
            }), JSON.stringify(kinds));
  var asks = ['time_off_ask_manager', 'time_off_ask_above', 'time_off_ask_director'];
  stAssert_(out, 'time off: every ask carries YES {ref} and NO {ref}, and the link to the Hub',
            asks.every(function (id) {
              var t = seeds[id].sms_text;
              return t.indexOf('YES {ref}') !== -1 && t.indexOf('NO {ref}') !== -1 && t.indexOf('{link}') !== -1;
            }), '');
  stAssert_(out, 'time off: no situation has a {reason} placeholder, and every word is plain ASCII',
            kinds.every(function (k) {
              var s = seeds[STAFF_SHIFT_SITUATIONS[k]];
              var all = s.sms_text + s.email_subject + s.email_text;
              return all.indexOf('{reason}') === -1 && /^[\x20-\x7E\n]*$/.test(all);
            }), '');
  stAssert_(out, 'time off: no kind is sent to the house\'s calendar manager or the directors\' group — each row ' +
                 'names its own recipient',
            kinds.every(function (k) { return !STAFF_SHIFT_TO_MANAGER[k] && !STAFF_SHIFT_TO_DIRECTORS[k] &&
                                              !STAFF_SHIFT_HANDOFF_TO[k]; }), '');

  var keep = { on: smartSituationOn_, people: staffShiftPeople_, hm: hotlineHouseManager_,
               hms: hotlineHouseManagers_, rpc: rpcCall_, quiet: staffShiftQuiet_,
               held: (typeof hubRehearsalHeld_ === 'function') ? hubRehearsalHeld_ : null,
               record: (typeof smartRecord_ === 'function') ? smartRecord_ : null };
  /* the stand-in door answers `sent`, so the ledger it writes is stood in too */
  var sent = [], noted = [], hmAsked = 0, ledgered = [];
  var row = function (kind, person, extra) {
    var r = { id: 'TO00000000F1:' + kind + ':' + clientNameKey_(person), kind: kind, person: person,
              person_key: clientNameKey_(person), to_name: person, requester: 'Ann Roe',
              dates: 'Tue 9/30 - Thu 10/2', days: '3 days', house_name: '48TH (B)', house: 'ABD1711',
              houses: ['ABD1711'], ref: 'TO00000000F1', link_path: '/#/app/timeoff/requests?ref=TO00000000F1',
              approval_why: 'Mia Manager manages 48TH (B)', by: 'Mia Manager', words: 'short staffed',
              drafts: '1 shift(s) are open drafts: Tue 9/30 7A-3P at 48TH (B).',
              reason_line: 'A reason was given - read it on the Hub.', day: '2026-09-30' };
    for (var k in (extra || {})) r[k] = extra[k];
    return r;
  };
  var rows = [row('timeoff_ask_manager', 'Mia Manager'), row('timeoff_ask_director', 'Ty Bond'),
              row('timeoff_denied', 'Ann Roe'),
              row('timeoff_ask_manager', 'Mia Manager', { id: 'TO00000000F2:timeoff_ask_manager:miamanager',
                                                          ref: 'TO00000000F2', dates: 'Tue 9/30', days: '1 day' })];
  var runs = {};
  try {
    staffShiftQuiet_ = function () { return false; };
    smartSituationOn_ = function (id) {
      if (!seeds[id]) return null;
      var copy = {};
      for (var k in seeds[id]) copy[k] = seeds[id][k];
      return copy;
    };
    staffShiftPeople_ = function () {
      return { readable: true, byKey: {
        miamanager: { name: 'Mia Manager', phone: '(330) 555-0201', email: 'mia@example.org', onStaff: true },
        tybond: { name: 'Ty Bond', phone: '(330) 555-0202', email: 'ty@example.org', onStaff: true },
        annroe: { name: 'Ann Roe', phone: '(330) 555-0203', email: '', onStaff: true } } };
    };
    hotlineHouseManager_ = function () { hmAsked++; return { name: 'Somebody Else', phone: '3305559999' }; };
    hotlineHouseManagers_ = function () { hmAsked++; return { readable: true, people: [] }; };
    rpcCall_ = function (m, p, o) {
      sent.push({ m: m, p: p, mock: (typeof COMM_MOCK_CTX !== 'undefined' && COMM_MOCK_CTX)
        ? String(COMM_MOCK_CTX.situation || '') : '' });
      return { ok: true, sent: true };
    };
    smartRecord_ = function (key) { ledgered.push(key); return true; };
    hubRehearsalHeld_ = function (w) { noted.push(w); return 'rh-' + noted.length; };
    ['send', 'record'].forEach(function (word) {
      var s0 = sent.length, n0 = noted.length;
      var res = stWithDial_(word, function () {
        return HUB_ACTIONS.staffShiftReminder({ rows: rows }, { is_service: true });
      });
      runs[word] = { res: res, sent: sent.slice(s0), noted: noted.slice(n0) };
    });
    staffShiftQuiet_ = function () { return true; };
    runs.quiet = { res: stWithDial_('send', function () {
      return HUB_ACTIONS.staffShiftReminder({ rows: rows }, { is_service: true }); }) };
  } catch (e) {
    runs.error = String((e && e.message) || e);
  } finally {
    smartSituationOn_ = keep.on; staffShiftPeople_ = keep.people; hotlineHouseManager_ = keep.hm;
    hotlineHouseManagers_ = keep.hms; rpcCall_ = keep.rpc; staffShiftQuiet_ = keep.quiet;
    if (keep.held) hubRehearsalHeld_ = keep.held;
    if (keep.record) smartRecord_ = keep.record;
  }
  stAssert_(out, 'time off: the four rows told at `send` went to the stand-in ledger — a run in the editor writes ' +
                 'no made-up send to the real one',
            ledgered.join(',') === rows.map(function (r) { return r.id; }).join(',') &&
            smartRecord_ === keep.record, JSON.stringify(ledgered));
  var states = function (w) {
    return (((runs[w] || {}).res || {}).data || { results: [] }).results.map(function (r) { return r.state; });
  };
  var sms = ((runs.send || {}).sent || []).filter(function (s) { return s.m === 'smsSend'; });
  var mail = ((runs.send || {}).sent || []).filter(function (s) { return s.m === 'emailSend'; });
  stAssert_(out, 'time off: at `send` each row goes through the one send door to its own named person — never to ' +
                 'the calendar\'s house manager',
            !runs.error && states('send').join(',') === 'told,told,told,told' &&
            sms.map(function (s) { return s.p.to; }).join(',') ===
              '+13305550201,+13305550202,+13305550203,+13305550201' &&
            hmAsked === 0, JSON.stringify({ err: runs.error, states: states('send'), hm: hmAsked }));
  stAssert_(out, 'time off: the words render the requester, the dates, the day count, the ref and the Hub link',
            sms.length === 4 && sms[0].p.body.indexOf('Ann Roe asks for time off Tue 9/30 - Thu 10/2 (3 days, 48TH (B)).') === 0 &&
            sms[0].p.body.indexOf('YES TO00000000F1') !== -1 &&
            sms[0].p.body.indexOf('https://asamylife.asalifecare.com/#/app/timeoff/requests?ref=TO00000000F1') !== -1 &&
            sms[2].p.body.indexOf('was not approved by Mia Manager: short staffed') !== -1 &&
            sms[3].p.body.indexOf('Ann Roe asks for time off Tue 9/30 (1 day, 48TH (B)).') === 0 &&
            sms.every(function (s) { return s.p.body.indexOf('{') === -1; }),
            sms.map(function (s) { return s.p.body; }).join(' || '));
  stAssert_(out, 'time off: the same words go by e-mail to whoever has an address, through the same door',
            mail.length === 3 && mail[0].p.to === 'mia@example.org' && mail[1].p.to === 'ty@example.org' &&
            mail[0].p.subject.indexOf('[TO00000000F1]') !== -1 && mail[0].p.body.indexOf('Open it on the Hub:') !== -1,
            JSON.stringify(mail.map(function (m) { return [m.p.to, m.p.subject]; })));
  stAssert_(out, 'time off: the mock outbox knows the situation of every send (test mode writes its row there)',
            sms.every(function (s) { return s.mock.indexOf('time_off_') === 0; }), JSON.stringify(sms.map(function (s) {
              return s.mock; })));
  var rec = runs.record || {};
  stAssert_(out, 'time off: at `record` nobody is contacted — every message is a rehearsal row, answered `recorded`',
            (rec.sent || []).length === 0 && states('record').every(function (s) { return s === 'recorded'; }) &&
            (rec.noted || []).some(function (n) { return n.situation === 'time_off_ask_manager'; }),
            JSON.stringify(states('record')));
  stAssert_(out, 'time off: inside the quiet window every row is `refused_quiet`, which the relay keeps owed',
            states('quiet').length === 4 && states('quiet').every(function (s) { return s === 'refused_quiet'; }),
            JSON.stringify(states('quiet')));

  /* THE URGENT BLAST LEAVES OUT WHOEVER IS ON TIME OFF THAT DAY. */
  var heldCo = { list: listRows_, merge: peopleMerged_, isp: withoutIspClients_, send: packetSendableNumber_,
                 opt: optOutBlocked_, status: cgBlockStatuses_, relay: staffRelayPost_ };
  var asked = [], awayAnswer = null, withAway = null, relayDown = null, noDay = null;
  try {
    listRows_ = function (h) {
      return String(h) === 'people' ? [{ name: 'Jane Doe', status: 'active', phone: '+13305551111' },
                                       { name: 'Bob Coe', status: 'active', phone: '+13305552222' }] : [];
    };
    peopleMerged_ = function (r) { return r; };
    withoutIspClients_ = function (r) { return r; };
    cgBlockStatuses_ = function () { return { active: true, admin: true }; };
    packetSendableNumber_ = function (v) {
      var d = String(v || '').replace(/\D/g, '');
      return d.length >= 10 ? '+1' + d.slice(-10) : '';
    };
    optOutBlocked_ = function () { return ''; };
    staffRelayPost_ = function (path, extra) { asked.push([path, extra]); return awayAnswer; };
    awayAnswer = { status: 200, data: { readable: true, keys: ['janedoe'], names: ['Jane Doe'] } };
    withAway = commCallOffEveryoneAudience_({ date: '2026-09-30' });
    awayAnswer = { status: 502, message: 'the relay could not be reached' };
    relayDown = commCallOffEveryoneAudience_({ date: '2026-09-30' });
    asked.length = 0;
    noDay = commCallOffEveryoneAudience_({});
  } catch (e2) {
    withAway = { error: String((e2 && e2.message) || e2) };
  } finally {
    listRows_ = heldCo.list; peopleMerged_ = heldCo.merge; withoutIspClients_ = heldCo.isp;
    packetSendableNumber_ = heldCo.send; optOutBlocked_ = heldCo.opt; cgBlockStatuses_ = heldCo.status;
    staffRelayPost_ = heldCo.relay;
  }
  stAssert_(out, 'time off: the URGENT OPEN SHIFT leaves out the people the relay names as on time off that day, ' +
                 'and says how many',
            withAway && !withAway.error && withAway.people.length === 1 && withAway.people[0].name === 'Bob Coe' &&
            withAway.counted.time_off === 1 && withAway.why.indexOf('on approved time off that day') !== -1,
            JSON.stringify(withAway));
  stAssert_(out, 'time off: when the relay does not answer the blast still goes, and says who could not be left out',
            relayDown && relayDown.people.length === 2 &&
            relayDown.missing.indexOf('who is on approved time off could not be read') !== -1, JSON.stringify(relayDown));
  stAssert_(out, 'time off: with no day to ask about, the relay is not asked',
            noDay && noDay.people.length === 2 && asked.length === 0, JSON.stringify(asked));
}
