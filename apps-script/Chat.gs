// Person-to-person chat: a thread is the messages between two people, keyed by the pair; no thread table.
// Executions are the cost: the overview read stamps presence, a conversation reads after an `after` cursor.

var CHAT_MESSAGES_TAB = 'chat_messages';
// New columns are appended, never inserted: older rows read back as empty (e.g. no reactions).
var CHAT_MESSAGES_HEADER = ['message_id', 'thread_key', 'from_user', 'from_name', 'to_user',
                            'body', 'created_at', 'read_at', 'reactions'];
var CHAT_PRESENCE_TAB = 'chat_presence';
var CHAT_PRESENCE_HEADER = ['user_id', 'name', 'seen_at'];
var CHAT_NOTICE_TAB = 'chat_notice';
var CHAT_NOTICE_HEADER = ['thread_key', 'to_user', 'notified_at'];

// Six minutes: a tab with a live stream stamps presence only every five (chatPresence.ts PING_LIVE_MS).
var CHAT_ONLINE_MS = 6 * 60 * 1000;
var CHAT_AWAY_MS = 5 * 60 * 1000;
var CHAT_NOTICE_EVERY_MS = 30 * 60 * 1000;

function chatSheet_(name, header) {
  // Resolved once: this runs several times per request and the resolver behind hubTabSheet_ is not free.
  var sheet = hubTabSheet_(name);
  if (sheet) { ensureHeader_(sheet, header); return sheet; }
  return hubTabEnsure_(name, header);
}

// Accounts fold onto one person only through a `same_as` cell somebody filled in, never by matching names.
var CHAT_PEOPLE_INDEX = null;

function chatPeopleIndex_() {
  if (CHAT_PEOPLE_INDEX) return CHAT_PEOPLE_INDEX;
  var byAccount = {};
  try {
    (usersAll_() || []).forEach(function (u) {
      var id = str_(u.userid);
      var sameAs = str_(u.sameas) || str_(u.mergedinto) || str_(u.personid);
      if (!id || !sameAs || sameAs === id) return;
      byAccount[id] = sameAs;
    });
    for (var acct in byAccount) {
      if (!byAccount.hasOwnProperty(acct)) continue;
      var seen = {}, at = byAccount[acct];
      while (byAccount[at] && !seen[at]) { seen[at] = true; at = byAccount[at]; }
      byAccount[acct] = at;
    }
  } catch (e) {
    // Unreadable means no folding at all, never a wrong folding.
    byAccount = {};
  }
  CHAT_PEOPLE_INDEX = byAccount;
  return CHAT_PEOPLE_INDEX;
}

function chatPersonId_(userId) {
  var id = str_(userId);
  if (!id) return '';
  var map = chatPeopleIndex_();
  return str_(map[id]) || id;
}

function chatPersonAccounts_(personId) {
  var want = chatPersonId_(personId);
  var out = [want];
  var map = chatPeopleIndex_();
  for (var acct in map) {
    if (map.hasOwnProperty(acct) && str_(map[acct]) === want && out.indexOf(acct) === -1) {
      out.push(acct);
    }
  }
  return out;
}

function chatThreadKey_(a, b) {
  var x = chatPersonId_(a), y = chatPersonId_(b);
  if (!x || !y) return '';
  return (x < y ? x + '|' + y : y + '|' + x);
}

function chatPersonOnline_(presence, personId, ms) {
  var accounts = chatPersonAccounts_(personId);
  for (var i = 0; i < accounts.length; i++) {
    if (chatIsOnline_((presence || {})[accounts[i]], ms)) return true;
  }
  return false;
}

// Derived from the row's pair, not its stored thread_key, so folded accounts share a thread without rewrites.
function chatRowKey_(row) {
  return chatThreadKey_(str_(row && row.fromuser), str_(row && row.touser));
}

function chatOtherId_(key, me) {
  var parts = str_(key).split('|');
  if (parts.length !== 2) return '';
  return parts[0] === str_(me) ? parts[1] : parts[0];
}

function chatAllMessages_() {
  chatSheet_(CHAT_MESSAGES_TAB, CHAT_MESSAGES_HEADER);
  // Read through the same router the writer uses; a hard-wired HUB_DB reads another workbook.
  return readTabNormalized_(hubTabWorkbook_(CHAT_MESSAGES_TAB), CHAT_MESSAGES_TAB);
}

function chatTouchPresence_(userId, name) {
  var uid = str_(userId);
  if (!uid) return;
  // an acting session (BeAnother.gs) is not the person being here
  if (typeof beAnotherActive_ === 'function' && beAnotherActive_()) return;
  var sheet = chatSheet_(CHAT_PRESENCE_TAB, CHAT_PRESENCE_HEADER);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('userid'), iName = hdr.indexOf('name'), iSeen = hdr.indexOf('seenat');
  var now = new Date().toISOString();
  for (var r = 1; r < values.length; r++) {
    if (str_(values[r][iId]) === uid) {
      sheet.getRange(r + 1, iSeen + 1).setValue(now);
      if (name && !str_(values[r][iName])) sheet.getRange(r + 1, iName + 1).setValue(str_(name));
      return;
    }
  }
  sheet.appendRow([uid, str_(name), now]);
}

function chatPresenceMap_() {
  chatSheet_(CHAT_PRESENCE_TAB, CHAT_PRESENCE_HEADER);
  var rows = readTabNormalized_(hubTabWorkbook_(CHAT_PRESENCE_TAB), CHAT_PRESENCE_TAB);
  var out = {};
  for (var i = 0; i < rows.length; i++) {
    var id = str_(rows[i].userid);
    if (id) out[id] = str_(rows[i].seenat);
  }
  return out;
}

function chatIsOnline_(seenAt, windowMs) {
  var t = Date.parse(str_(seenAt));
  if (!t) return false;
  return (Date.now() - t) < (windowMs || CHAT_ONLINE_MS);
}

// --- A client-role account's circle --- A client, or a guardian signed in for one, is shown the office (admins and…

var CHAT_CIRCLE_TTL_S = 600;
var CHAT_ACCOUNTS_MEMO = null;

function chatNarrowed_(user) {
  if (!user || user.is_service) return false;
  var role = str_(user.role).toLowerCase();
  return role === 'client' || role === 'guardian';
}

// person id -> {client, office}; folded name, sign-in e-mail and (for client-role accounts) client key -> the live…
function chatAccountIndex_() {
  var rows = usersAll_() || [];
  if (CHAT_ACCOUNTS_MEMO && CHAT_ACCOUNTS_MEMO.rows === rows) return CHAT_ACCOUNTS_MEMO;
  var byPerson = {}, byName = {}, byEmail = {}, byClient = {};
  var wear = function (map, key, pid) {
    if (!key) return;
    var worn = map[key] || (map[key] = []);
    if (worn.indexOf(pid) === -1) worn.push(pid);
  };
  for (var i = 0; i < rows.length; i++) {
    var u = rows[i] || {};
    var uid = str_(u.userid);
    if (!uid || str_(u.isservice).toLowerCase() === 'true') continue;
    var pid = chatPersonId_(uid);
    var p = byPerson[pid] || (byPerson[pid] = { client: false, office: false });
    var role = str_(u.role).toLowerCase();
    if (role === 'client' || role === 'guardian') p.client = true;
    if (role === 'admin' || hubIsMaster_(str_(u.email))) p.office = true;
    var off = str_(u.active).toUpperCase();
    if (off === 'FALSE' || off === '0' || off === 'NO' || str_(u.mergedinto)) continue;
    wear(byName, hubNameFold_(u.displayname), pid);
    wear(byEmail, str_(u.email).toLowerCase(), pid);
    if (role === 'client' || role === 'guardian') wear(byClient, str_(u.clientkey), pid);
  }
  CHAT_ACCOUNTS_MEMO = { rows: rows, byPerson: byPerson, byName: byName, byEmail: byEmail, byClient: byClient };
  return CHAT_ACCOUNTS_MEMO;
}

function chatCircleKey_(me) {
  return 'chat_circle|v2|' + str_(me);
}

// The people who serve one client beyond its house's calendar: {ids, why, lasting}.
function chatServingIds_(key, me, idx) {
  var ids = {}, why = [], lasting = true;
  var staffOnly = function (pid) {
    var p = idx.byPerson[pid];
    if (pid !== me && p && !p.client) ids[pid] = true;
  };
  (idx.byClient[key] || []).forEach(function (pid) { if (pid !== me) ids[pid] = true; });
  try {
    var ssas = ssaIndex_();
    var mails = {};
    Object.keys(ssas.ssas || {}).forEach(function (k) {
      (ssas.ssas[k].clients || []).forEach(function (c) {
        if (clientLive_(c) && str_(c.client_key) === key && c.ssa_email) mails[str_(c.ssa_email).toLowerCase()] = true;
      });
    });
    Object.keys(mails).forEach(function (m) {
      var worn = idx.byEmail[m] || [];
      if (worn.length === 1) staffOnly(worn[0]);
    });
    if (ssas.degraded) why.push('Not every client record could be read, so its SSA may be missing.');
  } catch (eS) {
    why.push('The SSA records could not be read just now, so its SSA is not listed.');
    lasting = false;
  }
  try {
    var houses = hubViewerHousesOf_([key]);
    var staff = hubStaffVisibleForHouses_(houses.codes);
    (staff.keys || []).forEach(function (k) {
      var worn = idx.byName[k] || [];
      if (worn.length === 1) staffOnly(worn[0]);
    });
    if ((houses.why || []).length || staff.why) {
      why.push('Not every record of its house\'s staff could be read, so some of them may be missing.');
    }
  } catch (eH) {
    why.push('Its house\'s staff records could not be read just now, so they are not listed.');
    lasting = false;
  }
  return { ids: ids, why: why.join(' '), lasting: lasting };
}

/** {ids, why}: the people a client-role account's chat shows. What cannot be read adds nobody. */
function chatCircle_(user, me) {
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (eC) { cache = null; }
  if (cache) {
    try {
      var held = cache.get(chatCircleKey_(me));
      if (held) return JSON.parse(held);
    } catch (eH) { /* read it again */ }
  }
  var idx = chatAccountIndex_();
  var ids = {}, why = '', lasting = true;
  Object.keys(idx.byPerson).forEach(function (pid) {
    var p = idx.byPerson[pid];
    if (p.office && !p.client && pid !== me) ids[pid] = true;
  });
  var key = hubClientKeyOf_(user);
  var houses = {};
  if (!key) {
    why = 'This account is not linked to a client yet, so only the office is listed.';
  } else {
    // FAIL-CLOSED: a client whose house cannot be named is shown no house
    try { houses = hubClientIdentity_(key).houses || {}; } catch (eI) { houses = {}; lasting = false; }
    if (!Object.keys(houses).length) {
      why = 'The house on this client\'s record cannot be matched to the hotline calendar, so its schedule adds nobody.';
    }
  }
  if (Object.keys(houses).length) {
    var ours = function (loc) {
      return hubRowIsClients_({ location: loc }, { clientByHouse: ['location'] }, { houses: houses });
    };
    var names = {}, read = false;
    var cal = null;
    try { cal = commBroadcastCalendar_(); } catch (eB) { cal = null; }
    if (cal && cal.readable) {
      read = true;
      Object.keys(cal.houses || {}).forEach(function (loc) {
        if (!ours(loc)) return;
        (cal.houses[loc].people || []).forEach(function (hp) { if (hp && hp.key) names[hp.key] = true; });
      });
    }
    var managers = null;
    try { managers = hubCalendarManagers_(); } catch (eM) { managers = null; }
    if (managers) {
      read = true;
      Object.keys(managers).forEach(function (k) {
        if ((managers[k] || []).some(ours)) names[k] = true;
      });
    }
    if (!read) {
      why = 'The hotline calendar could not be read just now, so its schedule adds nobody.';
      lasting = false;
    }
    Object.keys(names).forEach(function (k) {
      var worn = idx.byName[k] || [];
      if (worn.length !== 1 || worn[0] === me) return;
      var hp = idx.byPerson[worn[0]];
      if (hp && !hp.client) ids[worn[0]] = true;
    });
  }
  if (key) {
    var serving = chatServingIds_(key, me, idx);
    Object.keys(serving.ids).forEach(function (pid) { ids[pid] = true; });
    if (serving.why) why = why ? why + ' ' + serving.why : serving.why;
    if (!serving.lasting) lasting = false;
  }
  var out = { ids: ids, why: why };
  if (cache && lasting) {
    try { cache.put(chatCircleKey_(me), JSON.stringify(out), CHAT_CIRCLE_TTL_S); } catch (eP) { /* read again next time */ }
  }
  return out;
}

/** A narrowed caller's word on one person: in the circle, or not a client and has written to them here. */
function chatNarrowMay_(ctx, other, msgs) {
  var pid = chatPersonId_(other);
  if (!pid || pid === ctx.me) return false;
  if (ctx.circle.ids[pid]) return true;
  var p = chatAccountIndex_().byPerson[pid];
  if (!p || p.client) return false;
  var key = chatThreadKey_(ctx.me, pid);
  var rows = msgs || chatAllMessages_();
  for (var i = 0; i < rows.length; i++) {
    if (chatRowKey_(rows[i]) === key && chatPersonId_(rows[i].fromuser) === pid) return true;
  }
  return false;
}

function chatNarrowCtx_(user, me) {
  return chatNarrowed_(user) ? { me: me, circle: chatCircle_(user, me) } : null;
}

// --- Reads ---

/** The whole left rail in one call: people, my threads, last lines and unread counts; stamps my presence. */
HUB_POLICY.chatOverview = {
  file: 'Chat.gs', lane: 'read', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.chatOverview = function (payload, user) {
  if (!user) return hubDenied_();
  // hubActingUserId_, not user.id: inside a visit `user.id` stays the caller's.
  var me = chatPersonId_(hubActingUserId_(user));
  if (!me) return { status: 400, message: 'This session has no account id.' };
  // A visit never stamps presence: presence is a person at a keyboard.
  if (!hubMemberId_()) chatTouchPresence_(me, str_(user.display_name || user.name));

  var presence = chatPresenceMap_();
  var msgs = chatAllMessages_();
  // a client or a guardian: its circle, and whoever wrote to it first
  var narrow = chatNarrowCtx_(user, me);
  var wrote = {};
  var threads = {}, unreadTotal = 0;
  for (var i = 0; i < msgs.length; i++) {
    var key = chatRowKey_(msgs[i]);
    if (!key || key.indexOf(me) === -1) continue;
    // Containing the id is not being one of the pair: one id may prefix another.
    var pair = key.split('|');
    if (pair[0] !== me && pair[1] !== me) continue;
    var t = threads[key];
    if (!t) {
      t = threads[key] = { thread_key: key, with_user: chatOtherId_(key, me),
                           with_name: '', last: '', last_at: '', unread: 0 };
    }
    var at = str_(msgs[i].createdat);
    if (at >= t.last_at) {
      t.last_at = at;
      t.last = str_(msgs[i].body).slice(0, 140);
      t.last_from = str_(msgs[i].fromuser);
    }
    if (chatPersonId_(msgs[i].touser) === me && !str_(msgs[i].readat)) { t.unread++; unreadTotal++; }
    if (str_(msgs[i].fromuser) === t.with_user && !t.with_name) t.with_name = str_(msgs[i].fromname);
    if (chatPersonId_(msgs[i].fromuser) === t.with_user) wrote[key] = true;
  }

  var people = [];
  try {
    var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), USERS_TAB);
    for (var u = 0; u < rows.length; u++) {
      var uid = chatPersonId_(rows[u].userid);
      if (!uid || uid === me) continue;
      // One entry per person: an account folded into another is skipped.
      if (uid !== str_(rows[u].userid)) continue;
      if (narrow && !narrow.circle.ids[uid]) continue;
      if (str_(rows[u].active).toLowerCase() !== 'true') continue;
      if (str_(rows[u].isservice).toLowerCase() === 'true') continue;
      if (hubIsMasterRow_(rows[u])) continue;
      if (!tenantUserVisible_(rows[u])) continue;
      people.push({
        user_id: uid,
        name: str_(rows[u].displayname) || str_(rows[u].email),
        title: str_(rows[u].title),
        avatar: str_(rows[u].avatar),
        online: chatPersonOnline_(presence, uid),
        seen_at: str_(presence[uid] || '')
      });
    }
  } catch (eU) { people = []; }
  people.sort(function (a, b) {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  var list = [];
  // Away from home a thread shows only when its other end belongs to this place.
  var visibleTo = {};
  if (hubAwayTenant_()) {
    try {
      usersAll_().forEach(function (uu) {
        if (tenantUserVisible_(uu)) visibleTo[str_(uu.userid)] = true;
      });
    } catch (eV) {
      // FAIL-CLOSED: an empty map hides every thread away from home; null would disable the filter.
      visibleTo = {};
    }
  }
  var byPerson = narrow ? chatAccountIndex_().byPerson : null;
  if (narrow) unreadTotal = 0;
  for (var k in threads) {
    if (!Object.prototype.hasOwnProperty.call(threads, k)) continue;
    var th = threads[k];
    if (visibleTo && hubAwayTenant_() && !visibleTo[str_(th.with_user)]) continue;
    var shown = !narrow || !!narrow.circle.ids[th.with_user];
    if (!shown) {
      var other = byPerson[th.with_user];
      if (!other || other.client || !wrote[k]) continue;
    }
    if (!th.with_name) {
      for (var p = 0; p < people.length; p++) {
        if (people[p].user_id === th.with_user) { th.with_name = people[p].name; break; }
      }
    }
    th.online = shown ? chatPersonOnline_(presence, th.with_user) : false;
    if (narrow) unreadTotal += th.unread;
    list.push(th);
  }
  list.sort(function (a, b) { return a.last_at < b.last_at ? 1 : -1; });

  var data = { me: me, threads: list, people: people, unread: unreadTotal };
  // the mark the relay asks for before it carries a narrowed rail
  if (narrow) data.circle = { why: str_(narrow.circle.why) };
  return { status: 200, data: data };
};

/** One conversation, read after the `after` cursor so a quiet thread answers with nothing. */
HUB_POLICY.chatMessages = {
  file: 'Chat.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  params: { with_user: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.chatMessages = function (payload, user) {
  if (!user) return hubDenied_();
  var me = chatPersonId_(hubActingUserId_(user));
  var other = str_(payload && payload.with_user);
  var key = chatThreadKey_(me, other);
  if (!key) return { status: 400, message: 'with_user: whose conversation.' };
  var after = str_(payload && payload.after);
  var msgs = chatAllMessages_();
  var narrow = chatNarrowCtx_(user, me);
  if (narrow && !chatNarrowMay_(narrow, other, msgs)) return { status: 404, message: 'Not found.' };
  var out = [], seenAfter = !after;
  for (var i = 0; i < msgs.length; i++) {
    if (chatRowKey_(msgs[i]) !== key) continue;
    var id = str_(msgs[i].messageid);
    if (!seenAfter) { if (id === after) seenAfter = true; continue; }
    out.push({
      id: id, from_user: str_(msgs[i].fromuser), from_name: str_(msgs[i].fromname),
      body: str_(msgs[i].body), created_at: str_(msgs[i].createdat),
      read_at: str_(msgs[i].readat), mine: chatPersonId_(msgs[i].fromuser) === me
    });
  }
  // A cursor the tab no longer holds re-reads the whole thread (reset) instead of "nothing new" forever.
  var stale = !!after && !seenAfter;
  if (stale) {
    out = [];
    for (var j = 0; j < msgs.length; j++) {
      if (chatRowKey_(msgs[j]) !== key) continue;
      out.push({
        id: str_(msgs[j].messageid), from_user: str_(msgs[j].fromuser),
        from_name: str_(msgs[j].fromname), body: str_(msgs[j].body),
        created_at: str_(msgs[j].createdat), read_at: str_(msgs[j].readat),
        mine: str_(msgs[j].fromuser) === me
      });
    }
  }
  if (out.length > 300) out = out.slice(out.length - 300);
  // Reactions travel whole every time: they land on old messages the cursor never re-reads.
  var reactions = {};
  for (var k = 0; k < msgs.length; k++) {
    if (chatRowKey_(msgs[k]) !== key) continue;
    var packed = chatReactionsOf_(msgs[k]);
    if (packed) reactions[str_(msgs[k].messageid)] = packed;
  }
  return { status: 200, data: { messages: out, reset: stale, reactions: reactions } };
};

function chatReactionsOf_(row) {
  var raw = str_(row && row.reactions);
  if (!raw) return null;
  var parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  var out = null;
  for (var emoji in parsed) {
    if (!parsed.hasOwnProperty(emoji)) continue;
    var ids = parsed[emoji];
    if (!ids || !ids.length) continue;
    if (!out) out = {};
    out[emoji] = ids;
  }
  return out;
}

// --- Writes ---

/** Send a message; it is on the tab before the best-effort e-mail is attempted. */
HUB_POLICY.chatSend = {
  file: 'Chat.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: [],
  params: { to_user: { required: true, type: 'string' }, body: { required: true, type: 'string' } },
  invalidates: [], emits: ['emailSend']
};
HUB_ACTIONS.chatSend = function (payload, user) {
  // Threads have no table, so refusing the send is what keeps places apart.
  if (hubAwayTenant_()) {
    var toId = str_(payload && payload.to_user);
    var all = usersAll_(), okTo = false;
    for (var ci = 0; ci < all.length; ci++) {
      if (str_(all[ci].userid) !== toId) continue;
      okTo = tenantUserVisible_(all[ci]);
      break;
    }
    if (!okTo) return { status: 404, message: 'Not found.' };
  }
  if (!user) return hubDenied_();
  if (user.is_service) return { status: 403, message: 'A service session does not chat.' };
  var me = chatPersonId_(user.user_id || user.id);
  var to = str_(payload && payload.to_user);
  var body = str_(payload && payload.body).slice(0, 4000);
  if (!to) return { status: 400, message: 'to_user: whom you are writing to.' };
  if (!body) return { status: 400, message: 'An empty message is not sent.' };
  if (to === me || chatPersonId_(to) === me) return { status: 400, message: 'You cannot write to yourself here.' };
  var narrow = chatNarrowCtx_(user, me);
  if (narrow && !chatNarrowMay_(narrow, to, null)) return { status: 404, message: 'Not found.' };
  var key = chatThreadKey_(me, to);

  var id = chatSendId_(HUB_WRITE_ID, user.user_id || user.id) || ('msg_' + randomHex_(12));
  var now = chatSendAt_(payload && payload.at);
  var myName = str_(user.display_name || user.name) || str_(user.email);
  chatSheet_(CHAT_MESSAGES_TAB, CHAT_MESSAGES_HEADER)
    .appendRow([id, key, me, myName, to, body, now, '', '']);

  var mailed = false;
  try { mailed = chatMaybeMail_(key, me, myName, to); } catch (eM) { mailed = false; }
  return { status: 200, data: { id: id, created_at: now, thread_key: key, emailed: mailed } };
};

// A send the relay kept first is named by its write id and the account it runs as, so the relay knew the row's id…
function chatSendId_(writeId, account) {
  var wid = str_(writeId), acct = str_(account);
  if (!wid || !acct) return '';
  return 'msg_' + sha256Hex_(wid + '\n' + acct).slice(0, 24);
}

// The moment the relay took the send, when it names one: never more than two minutes ahead, never a day old.
function chatSendAt_(at) {
  var now = Date.now();
  var t = Date.parse(str_(at));
  if (!t || t > now + 2 * 60 * 1000 || t < now - 24 * 3600 * 1000) return new Date(now).toISOString();
  return new Date(t).toISOString();
}

// Only after five minutes away, at most one letter per thread per half hour, carrying the messages themselves.
function chatMaybeMail_(key, fromId, fromName, toId) {
  var presence = chatPresenceMap_();
  if (chatPersonOnline_(presence, toId, CHAT_AWAY_MS)) return false;

  var noticeSheet = chatSheet_(CHAT_NOTICE_TAB, CHAT_NOTICE_HEADER);
  var values = noticeSheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iKey = hdr.indexOf('threadkey'), iTo = hdr.indexOf('touser'), iAt = hdr.indexOf('notifiedat');
  var row = 0;
  for (var r = 1; r < values.length; r++) {
    // The throttle is per person, not per account.
    if (str_(values[r][iKey]) === key &&
        chatPersonId_(values[r][iTo]) === chatPersonId_(toId)) { row = r + 1; break; }
  }
  if (row) {
    var last = Date.parse(str_(values[row - 1][iAt]));
    if (last && (Date.now() - last) < CHAT_NOTICE_EVERY_MS) return false;
  }

  var to = null;
  var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), USERS_TAB);
  for (var u = 0; u < rows.length; u++) {
    if (str_(rows[u].userid) !== toId) continue;
    to = { email: str_(rows[u].email), name: str_(rows[u].displayname) };
    break;
  }
  if (!to || to.email.indexOf('@') === -1) return false;   // a digits login has no mailbox

  var msgs = chatAllMessages_(), unread = [];
  for (var i = 0; i < msgs.length; i++) {
    if (chatRowKey_(msgs[i]) !== key) continue;
    if (chatPersonId_(msgs[i].touser) !== chatPersonId_(toId)) continue;
    if (str_(msgs[i].readat)) continue;
    unread.push(str_(msgs[i].body));
  }
  if (!unread.length) return false;

  var letter = chatUnreadEmail_({ name: to.name.split(' ')[0], fromName: fromName, messages: unread });
  var res = rpcCall_('emailSend', {
    to: to.email, subject: letter.subject, body: letter.text, html: letter.html,
    reason: 'chat message while signed out'
  });
  // `ok` is not `sent`: a held letter must not stamp the throttle or report emailed.
  if (!res || !res.ok || !res.sent) return false;

  var stamp = new Date().toISOString();
  if (row) noticeSheet.getRange(row, iAt + 1).setValue(stamp);
  else noticeSheet.appendRow([key, chatPersonId_(toId), stamp]);
  return true;
}

/** Toggle my reaction on a message; re-read and written under the lock so two reactions never erase each other. */
HUB_POLICY.chatReact = {
  file: 'Chat.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: [],
  params: {
    message_id: { required: true, type: 'string' },
    emoji: { required: true, type: 'string' }
  },
  invalidates: [], emits: []
};
HUB_ACTIONS.chatReact = function (payload, user) {
  if (!user) return hubDenied_();
  if (user.is_service) return { status: 403, message: 'A service session does not chat.' };
  var me = chatPersonId_(user.user_id || user.id);
  var msgId = str_(payload && payload.message_id);
  var emoji = str_(payload && payload.emoji).slice(0, 16);
  if (!msgId) return { status: 400, message: 'message_id: which message.' };
  if (!emoji) return { status: 400, message: 'emoji: which reaction.' };
  var narrow = chatNarrowCtx_(user, me);

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) {
    return { status: 503, message: 'The chat is busy — try that again.' };
  }
  try {
    var sheet = chatSheet_(CHAT_MESSAGES_TAB, CHAT_MESSAGES_HEADER);
    var values = sheet.getDataRange().getValues();
    var hdr = values[0].map(normKey_);
    var iId = hdr.indexOf('messageid'), iFrom = hdr.indexOf('fromuser'),
        iTo = hdr.indexOf('touser'), iReact = hdr.indexOf('reactions');
    if (iReact === -1) return { status: 500, message: 'The reactions column is missing.' };
    for (var r = 1; r < values.length; r++) {
      if (str_(values[r][iId]) !== msgId) continue;
      if (chatPersonId_(values[r][iFrom]) !== me && chatPersonId_(values[r][iTo]) !== me) {
        return { status: 404, message: 'No such message.' };
      }
      if (narrow) {
        var pairRows = values.slice(1).map(function (v) { return { fromuser: v[iFrom], touser: v[iTo] }; });
        var otherEnd = chatPersonId_(values[r][iFrom]) === me ? values[r][iTo] : values[r][iFrom];
        if (!chatNarrowMay_(narrow, str_(otherEnd), pairRows)) return { status: 404, message: 'No such message.' };
      }
      var map = {};
      try { map = JSON.parse(str_(values[r][iReact]) || '{}') || {}; } catch (e2) { map = {}; }
      var ids = map[emoji] || [];
      var at = ids.indexOf(me);
      if (at === -1) ids.push(me); else ids.splice(at, 1);
      if (ids.length) map[emoji] = ids; else delete map[emoji];
      sheet.getRange(r + 1, iReact + 1).setValue(JSON.stringify(map));
      chatTouchPresence_(me, str_(user.display_name || user.name));
      // to_user lets the relay wake the other screen without reading the sheet.
      var other = chatPersonId_(values[r][iFrom]) === me ? str_(values[r][iTo]) : str_(values[r][iFrom]);
      return { status: 200, data: { message_id: msgId, reactions: map, on: at === -1, to_user: other } };
    }
    return { status: 404, message: 'No such message.' };
  } finally {
    lock.releaseLock();
  }
};

/** Everything this person has read in one conversation, marked. */
HUB_POLICY.chatMarkRead = {
  file: 'Chat.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  params: { with_user: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.chatMarkRead = function (payload, user) {
  if (!user) return hubDenied_();
  var me = chatPersonId_(user.user_id || user.id);
  var key = chatThreadKey_(me, str_(payload && payload.with_user));
  if (!key) return { status: 400, message: 'with_user: whose conversation.' };
  var narrow = chatNarrowCtx_(user, me);
  if (narrow && !chatNarrowMay_(narrow, str_(payload && payload.with_user), null)) {
    return { status: 404, message: 'Not found.' };
  }
  var sheet = chatSheet_(CHAT_MESSAGES_TAB, CHAT_MESSAGES_HEADER);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iKey = hdr.indexOf('threadkey'), iTo = hdr.indexOf('touser'), iRead = hdr.indexOf('readat');
  var now = new Date().toISOString(), marked = 0;
  var iFromR = hdr.indexOf('fromuser');
  for (var r = 1; r < values.length; r++) {
    if (chatThreadKey_(str_(values[r][iFromR]), str_(values[r][iTo])) !== key) continue;
    if (chatPersonId_(values[r][iTo]) !== me) continue;
    if (str_(values[r][iRead])) continue;
    sheet.getRange(r + 1, iRead + 1).setValue(now);
    marked++;
  }
  chatTouchPresence_(me, str_(user.display_name || user.name));
  return { status: 200, data: { marked: marked } };
};

/** The shell's heartbeat: stamps presence (online = the platform is open) and returns the unread count and newest line. */
HUB_POLICY.chatPing = {
  file: 'Chat.gs', lane: 'read', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.chatPing = function (payload, user) {
  if (!user) return hubDenied_();
  var me = chatPersonId_(user.user_id || user.id);
  if (!me) return { status: 200, data: { unread: 0, latest: null } };
  chatTouchPresence_(me, str_(user.display_name || user.name));
  var msgs = chatAllMessages_();
  // a narrowed caller counts what its rail shows: a line from another client, or from nobody on record, is not
  var idx = chatNarrowed_(user) ? chatAccountIndex_() : null;
  var byPerson = idx ? idx.byPerson : null;
  var sameClient = {};
  var ck = idx ? hubClientKeyOf_(user) : '';
  if (ck) (idx.byClient[ck] || []).forEach(function (pid) { sameClient[pid] = true; });
  var unread = 0, latest = null;
  for (var i = 0; i < msgs.length; i++) {
    if (chatPersonId_(msgs[i].touser) !== me) continue;
    if (str_(msgs[i].readat)) continue;
    if (byPerson) {
      var from = chatPersonId_(msgs[i].fromuser);
      var sender = byPerson[from];
      if (!sender || (sender.client && !sameClient[from])) continue;
    }
    unread++;
    var at = str_(msgs[i].createdat);
    if (!latest || at > latest.at) {
      latest = { id: str_(msgs[i].messageid), at: at, from_user: str_(msgs[i].fromuser),
                 from_name: str_(msgs[i].fromname), body: str_(msgs[i].body).slice(0, 140) };
    }
  }
  // `me` lets the shell catch a second sign-in swapping the session under an open tab.
  return { status: 200, data: { unread: unread, latest: latest,
           me: me, me_name: str_(user.display_name || user.name) } };
};
