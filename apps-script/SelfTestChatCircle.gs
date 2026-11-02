// A client-role account's chat: the office, its client's house, its IST and recent staff, its SSA and the logins…
function stChatCircle_(out) {
  if (typeof chatCircle_ !== 'function' || typeof chatNarrowMay_ !== 'function') {
    stAssert_(out, 'chat circle: Chat.gs declares the narrowing', false, 'missing');
    return;
  }
  var keep = { users: usersAll_, msgs: chatAllMessages_, presence: chatPresenceMap_, touch: chatTouchPresence_,
               sheet: chatSheet_, mail: chatMaybeMail_, readTab: readTabNormalized_, open: ssOpen_, id: hubId_,
               ident: hubClientIdentity_, cal: commBroadcastCalendar_, managers: hubCalendarManagers_,
               ssas: ssaIndex_, houses: hubViewerHousesOf_, staff: hubStaffVisibleForHouses_,
               people: CHAT_PEOPLE_INDEX, accounts: CHAT_ACCOUNTS_MEMO };
  var run = String(new Date().getTime()) + Math.floor(Math.random() * 1e6);
  var U = function (id) { return 'st_cc_' + run + '_' + id; };
  var row = function (id, name, role, extra) {
    var r = { userid: U(id), displayname: name, email: id + '@example.invalid', role: role, active: 'true',
              isservice: '', clientkey: '' };
    for (var k in (extra || {})) if (extra.hasOwnProperty(k)) r[k] = extra[k];
    return r;
  };
  var USERS = [
    row('cli', 'Jane Doe', 'client', { clientkey: 'jane_doe' }),
    row('grd', 'Gary Guardian', 'client', { clientkey: 'jane_doe', types: 'GUARDIAN' }),
    row('adm', 'Ada Admin', 'admin'),
    row('mgr', 'Mike Boss', 'manager'),
    row('stf', 'Ann Roe', 'staff'),
    row('far', 'Far Away', 'staff'),
    row('tw1', 'Sam Twin', 'staff'),
    row('tw2', 'Sam Twin', 'staff'),
    row('oth', 'Bob Roe', 'client', { clientkey: 'bob_roe' }),
    row('out', 'Olga Out', 'staff'),
    row('svc', 'The Platform', 'admin', { isservice: 'true' }),
    row('ssa', 'Sue Ssa', 'staff', { types: 'GUARDIAN' }),
    row('ssb', 'Sid Other', 'staff', { types: 'GUARDIAN' }),
    row('old', 'Otto Old', 'staff'),
    row('ist', 'Ivy Trained', 'staff'),
    row('isb', 'Ike Elsewhere', 'staff')
  ];
  var msg = function (id, from, to, body, read) {
    return { messageid: id, fromuser: U(from), fromname: from, touser: U(to), body: body,
             createdat: '2026-01-0' + id.slice(-1) + 'T10:00:00Z', readat: read ? '2026-01-09T10:00:00Z' : '' };
  };
  var MSGS = [
    msg('m1', 'out', 'cli', 'hello from olga'),
    msg('m2', 'oth', 'cli', 'client to client'),
    msg('m3', 'cli', 'far', 'a line nobody answered'),
    msg('m4', 'stf', 'cli', 'from ann'),
    msg('m5', 'oth', 'grd', 'client to guardian'),
    msg('m6', 'grd', 'cli', 'from family')
  ];
  var online = {};
  USERS.forEach(function (r) { online[r.userid] = new Date().toISOString(); });
  var appended = [];
  var calendar = 'ok';
  var ssaRead = 'ok';
  var forget = function (id) {
    try { CacheService.getScriptCache().remove(chatCircleKey_(U(id))); } catch (e) { /* no cache here */ }
  };
  var who = function (id, over) {
    var base = USERS.filter(function (r) { return r.userid === U(id); })[0];
    var u = { id: base.userid, role: base.role, client_key: base.clientkey, display_name: base.displayname,
              email: base.email };
    for (var k in (over || {})) if (over.hasOwnProperty(k)) u[k] = over[k];
    return u;
  };
  var ids = function (list, field) {
    return (list || []).map(function (x) { return String(x[field]).replace('st_cc_' + run + '_', ''); }).sort().join(',');
  };
  var FORGET = ['cli', 'grd', 'adm', 'stf', 'oth'];
  try {
    CHAT_PEOPLE_INDEX = null;
    CHAT_ACCOUNTS_MEMO = null;
    usersAll_ = function () { return USERS; };
    chatAllMessages_ = function () { return MSGS; };
    chatPresenceMap_ = function () { return online; };
    chatTouchPresence_ = function () {};
    chatMaybeMail_ = function () { return false; };
    chatSheet_ = function () { return { appendRow: function (r) { appended.push(r); } }; };
    ssOpen_ = function () { return {}; };
    hubId_ = function () { return 'st-db'; };
    readTabNormalized_ = function (ss, tab) {
      if (tab !== USERS_TAB) throw new Error('st: only the users tab is read here');
      return USERS;
    };
    hubClientIdentity_ = function (key) {
      return { key: key, names: {}, addrs: {}, houses: key === 'jane_doe' ? { '4708': true } : { '2704': true } };
    };
    commBroadcastCalendar_ = function () {
      if (calendar !== 'ok') throw new Error('st: the calendar is down');
      return { readable: true, houses: {
        'CAN - JH - ABD4708': { people: [{ key: 'annroe' }, { key: 'samtwin' }, { key: 'nurse' }] },
        'CAN - XX - BM2704': { people: [{ key: 'faraway' }] }
      } };
    };
    hubCalendarManagers_ = function () {
      return calendar === 'ok' ? { mikeboss: ['CAN - JH - ABD4708'], faraway: ['CAN - XX - BM2704'] } : null;
    };
    // an archived record naming Jane adds nobody, nor one the door set inactive; each live one adds the account…
    ssaIndex_ = function () {
      if (ssaRead !== 'ok') throw new Error('st: the SSA records are down');
      return { degraded: false, why: [], ssas: {
        ssa_sue: { clients: [{ client_key: 'jane_doe', archived: false, ssa_email: 'ssa@example.invalid' }] },
        ssa_sid: { clients: [{ client_key: 'bob_roe', archived: false, ssa_email: 'ssb@example.invalid' },
                             { client_key: 'jane_doe', archived: true, ssa_email: 'old@example.invalid' },
                             { client_key: 'jane_doe', archived: false, status: 'inactive',
                               ssa_email: 'ssb@example.invalid' }] }
      } };
    };
    hubViewerHousesOf_ = function (keys) {
      return { codes: keys[0] === 'jane_doe' ? ['ABD4708'] : ['BM2704'], why: [] };
    };
    // a shared name and another client's name add nobody
    hubStaffVisibleForHouses_ = function (codes) {
      return { keys: codes[0] === 'ABD4708' ? ['ivytrained', 'samtwin', 'bobroe'] : ['ikeelsewhere'], why: '' };
    };
    FORGET.forEach(forget);

    var ov = HUB_ACTIONS.chatOverview({}, who('cli'));
    var d = ov.data || {};
    stAssert_(out, 'chat circle: a client is shown the office, its house\'s manager and staff, its IST staff, its SSA ' +
                   'and its guardian — never staff of another house, another client, an archived SSA, the SSA of a ' +
                   'record the door set inactive, a service, or a name two live accounts wear',
              ov.status === 200 && ids(d.people, 'user_id') === 'adm,grd,ist,mgr,ssa,stf', JSON.stringify(ov));
    var byWith = {};
    (d.threads || []).forEach(function (t) { byWith[String(t.with_user).replace('st_cc_' + run + '_', '')] = t; });
    stAssert_(out, 'chat circle: its rail keeps the house\'s conversation, its guardian\'s and one a colleague ' +
                   'started — that one never online — and drops another client\'s and one nobody answered',
              ids(d.threads, 'with_user') === 'grd,out,stf' && byWith.stf.online === true &&
              byWith.grd.online === true && byWith.out.online === false,
              JSON.stringify(d.threads));
    stAssert_(out, 'chat circle: its unread count is its rail\'s, and the answer carries the mark the relay asks for',
              d.unread === 3 && !!d.circle && d.circle.why === '', JSON.stringify(d));

    var staffView = HUB_ACTIONS.chatOverview({}, who('adm')).data || {};
    stAssert_(out, 'chat circle: a staff account\'s rail is not narrowed and carries no mark',
              ids(staffView.people, 'user_id').split(',').length === 14 && !('circle' in staffView),
              JSON.stringify(staffView.people));

    var grd = HUB_ACTIONS.chatOverview({}, who('grd')).data || {};
    stAssert_(out, 'chat circle: a guardian signed in for the client sees the same people and its ward, and not ' +
                   'another client who wrote to it',
              ids(grd.people, 'user_id') === 'adm,cli,ist,mgr,ssa,stf' && ids(grd.threads, 'with_user') === 'cli',
              JSON.stringify(grd));

    var oth = HUB_ACTIONS.chatOverview({}, who('oth')).data || {};
    stAssert_(out, 'chat circle: another client is shown its own circle — none of this client\'s people',
              ids(oth.people, 'user_id') === 'adm,far,isb,ssb' && ids(oth.threads, 'with_user') === '',
              JSON.stringify(oth));

    var send = function (to) {
      return HUB_ACTIONS.chatSend({ to_user: U(to), body: 'hi' }, who('cli')).status;
    };
    var sent = ['stf', 'mgr', 'adm', 'out', 'grd', 'ssa', 'ist', 'far', 'oth', 'tw1', 'ssb', 'old', 'isb'].map(send);
    stAssert_(out, 'chat circle: a client writes to its circle and its guardian and answers whoever wrote first; ' +
                   'another house\'s staff, another client, a shared name and another client\'s SSA and staff are ' +
                   'Not found, and nothing is written for them',
              sent.join(',') === '200,200,200,200,200,200,200,404,404,404,404,404,404' && appended.length === 7,
              sent.join(','));

    var read = function (action, withId, as) {
      return HUB_ACTIONS[action]({ with_user: U(withId) }, who(as || 'cli')).status;
    };
    stAssert_(out, 'chat circle: a client cannot read or mark another client\'s conversation with it',
              read('chatMessages', 'oth') === 404 && read('chatMarkRead', 'oth') === 404 &&
              read('chatMessages', 'out') === 200 && read('chatMessages', 'far') === 404 &&
              read('chatMessages', 'grd') === 200 && read('chatMessages', 'ssb') === 404 &&
              read('chatMessages', 'cli', 'grd') === 200 && read('chatMessages', 'cli', 'oth') === 404, '');

    var ping = HUB_ACTIONS.chatPing({}, who('cli')).data || {};
    stAssert_(out, 'chat circle: the shell\'s count and newest line keep its guardian\'s line and leave out another ' +
                   'client\'s',
              ping.unread === 3 && ping.latest && ping.latest.body === 'from family', JSON.stringify(ping));

    var ctx = { me: U('cli'), circle: chatCircle_(who('cli'), U('cli')) };
    var rows = MSGS.map(function (m) { return { fromuser: m.fromuser, touser: m.touser }; });
    stAssert_(out, 'chat circle: a reaction is allowed only where the rail is — asked before the cell is written',
              chatNarrowMay_(ctx, U('stf'), rows) && chatNarrowMay_(ctx, U('out'), rows) &&
              chatNarrowMay_(ctx, U('grd'), rows) &&
              !chatNarrowMay_(ctx, U('oth'), rows) && !chatNarrowMay_(ctx, U('far'), rows) &&
              stCode_(HUB_ACTIONS.chatReact).indexOf('chatNarrowMay_') <
              stCode_(HUB_ACTIONS.chatReact).indexOf('setValue(JSON.stringify(map))'), '');

    var unlinked = HUB_ACTIONS.chatOverview({}, who('cli', { id: U('cli') + '_nokey', client_key: '' }));
    stAssert_(out, 'chat circle: an account linked to no client is shown the office alone, and told why',
              ids(unlinked.data.people, 'user_id') === 'adm' && /not linked/.test(unlinked.data.circle.why),
              JSON.stringify(unlinked.data));

    forget('cli');
    calendar = 'down';
    var down = HUB_ACTIONS.chatOverview({}, who('cli')).data || {};
    calendar = 'ok';
    var back = HUB_ACTIONS.chatOverview({}, who('cli')).data || {};
    stAssert_(out, 'chat circle: an unreadable calendar adds nobody from the house\'s schedule and says so — and is ' +
                   'not remembered',
              ids(down.people, 'user_id') === 'adm,grd,ist,ssa' && /could not be read/.test(down.circle.why) &&
              ids(back.people, 'user_id') === 'adm,grd,ist,mgr,ssa,stf', JSON.stringify([down.people, back.people]));

    forget('cli');
    ssaRead = 'down';
    var noSsa = HUB_ACTIONS.chatOverview({}, who('cli')).data || {};
    ssaRead = 'ok';
    var ssaBack = HUB_ACTIONS.chatOverview({}, who('cli')).data || {};
    stAssert_(out, 'chat circle: unreadable SSA records list no SSA and say so — and are not remembered',
              ids(noSsa.people, 'user_id') === 'adm,grd,ist,mgr,stf' && /SSA records could not be read/.test(noSsa.circle.why) &&
              ids(ssaBack.people, 'user_id') === 'adm,grd,ist,mgr,ssa,stf', JSON.stringify([noSsa.people, ssaBack.people]));
  } finally {
    usersAll_ = keep.users; chatAllMessages_ = keep.msgs; chatPresenceMap_ = keep.presence;
    chatTouchPresence_ = keep.touch; chatSheet_ = keep.sheet; chatMaybeMail_ = keep.mail;
    readTabNormalized_ = keep.readTab; ssOpen_ = keep.open; hubId_ = keep.id; hubClientIdentity_ = keep.ident;
    commBroadcastCalendar_ = keep.cal; hubCalendarManagers_ = keep.managers;
    ssaIndex_ = keep.ssas; hubViewerHousesOf_ = keep.houses; hubStaffVisibleForHouses_ = keep.staff;
    CHAT_PEOPLE_INDEX = keep.people; CHAT_ACCOUNTS_MEMO = keep.accounts;
    FORGET.forEach(forget);
  }
}
