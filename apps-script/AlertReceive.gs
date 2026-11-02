/**
 * SETTINGS > ALERTS I RECEIVE — each director, and the master, chooses for themselves whether three alerts reach them:
 * No Call No Show, "<person> is not punching in" (the first missing clock-in or clock-out of a shift) and Incident
 * filed. Every one ships on. Turned off, that alert leaves that one person out on every channel it reaches them — the
 * My Inbox item, the text, the e-mail — decided at send time; the person the alert is about and everybody else it
 * reaches are told exactly as before. Never a global switch: the automations themselves run as Settings > My Work says.
 *
 * Kept in the Support Requests settings house, one row per person (`receive_off:<uid>`, the parts turned off), and
 * carried to the relay on the config lane (`alert_receive_off`), where the master's copy of the directors' alerts and
 * the bell's no-call notice are cut the same way. A row counts only while its person holds the section — a director on
 * the list, or the master: one left behind by somebody no longer a director cuts nobody. Settings that cannot be read
 * cut nobody.
 */

var AR_PARTS = ['no_call', 'punch', 'incident'];
var AR_KEY_PREFIX = 'receive_off:';
var AR_ACTIONS = ['alertReceiveGet', 'alertReceiveSet'];
var AR_CACHE_KEY = 'ar_receive_off';
// a copy a read filled may predate a save it raced, so it lives briefly; a save's own copy stands until the next save
var AR_READ_TTL = 600;
var AR_SAVE_TTL = 21600;

function arIsPart_(part) { return AR_PARTS.indexOf(sdStr_(part)) !== -1; }

/** The parts a stored cell names, in catalogue order, each once; anything else in it is ignored. */
function arPartsOf_(raw) {
  var named = sdStr_(raw).toLowerCase().split(/[,;\s]+/);
  return AR_PARTS.filter(function (p) { return named.indexOf(p) !== -1; });
}

/** The rows as kept: { readable, set_up, why, off: { uid: { part: true } } }. Throws nothing. */
function arStoredRead_() {
  var out = { readable: true, set_up: sdHouseReady_(SD_TABS.settings), why: '', off: {} };
  if (!out.set_up) return out;
  try {
    sdRead_(SD_TABS.settings).forEach(function (r) {
      var key = sdStr_(r.key);
      if (key.indexOf(AR_KEY_PREFIX) !== 0) return;
      var uid = key.slice(AR_KEY_PREFIX.length);
      var parts = arPartsOf_(r.value);
      if (!uid || !parts.length) return;
      out.off[uid] = {};
      parts.forEach(function (p) { out.off[uid][p] = true; });
    });
  } catch (e) {
    return { readable: false, set_up: true, why: sdErr_(e), off: {} };
  }
  return out;
}

function arCachePut_(stored, ttl) {
  try {
    CacheService.getScriptCache().put(AR_CACHE_KEY, JSON.stringify({ set_up: stored.set_up, off: stored.off }), ttl);
  } catch (e) { /* the next read asks the house */ }
}

function arCacheDrop_() {
  try { CacheService.getScriptCache().remove(AR_CACHE_KEY); } catch (e) {}
}

/** The rows, once per execution: the cache first, the house when the cache has none. */
function arStored_() {
  if (sdHas_(SD_MEMO, '__receive')) return SD_MEMO.__receive;
  var out = null;
  try {
    var hit = CacheService.getScriptCache().get(AR_CACHE_KEY);
    var got = hit ? JSON.parse(hit) : null;
    if (got && got.off && typeof got.off === 'object') {
      out = { readable: true, set_up: got.set_up !== false, why: '', off: got.off };
    }
  } catch (eC) { out = null; }
  if (!out) {
    out = arStoredRead_();
    if (out.readable) arCachePut_(out, AR_READ_TTL);
  }
  SD_MEMO.__receive = out;
  return out;
}

/** The master account's id; '' when it cannot be read. */
function arMasterUid_() {
  if (sdHas_(SD_MEMO, '__ar_master')) return SD_MEMO.__ar_master;
  var uid = '';
  try {
    var u = userByEmail_(hubMasterEmail_());
    uid = u ? sdStr_(u.userid) : '';
  } catch (e) { uid = ''; }
  SD_MEMO.__ar_master = uid;
  return uid;
}

/** 'master' | 'director' | '' — whether this account holds the section now. */
function arHolder_(uid) {
  var id = sdStr_(uid);
  if (!id) return '';
  if (id === arMasterUid_()) return 'master';
  return sdDirectors_().list.some(function (d) { return d.uid === id; }) ? 'director' : '';
}

/** uid → { part: true } for the holders alone; {} when nobody turned anything off, or nothing could be read. */
function arOff_() {
  if (sdHas_(SD_MEMO, '__ar_off')) return SD_MEMO.__ar_off;
  var out = {};
  try {
    var st = arStored_();
    Object.keys(st.off || {}).forEach(function (uid) { if (arHolder_(uid)) out[uid] = st.off[uid]; });
  } catch (e) { out = {}; }
  SD_MEMO.__ar_off = out;
  return out;
}

/** FAIL-OPEN: whether this account receives this alert; false only for a holder who turned it off. */
function arReceives_(uid, part) {
  try {
    var off = arOff_()[sdStr_(uid)];
    return !(off && off[part] === true);
  } catch (e) { return true; }
}

/** The people (each carrying `uid`) this alert still reaches; the list itself for any other alert. */
function arReceivers_(people, part) {
  var list = people || [];
  if (!arIsPart_(part)) return list;
  return list.filter(function (p) { return arReceives_(p && p.uid, part); });
}

// The addresses and last-ten digits that reach only holders who turned this alert off.
function arDropped_(part) {
  var out = { emails: {}, digits: {}, any: false };
  var off = arOff_();
  var mine = {};
  Object.keys(off).forEach(function (uid) { if (off[uid][part] === true) mine[uid] = true; });
  if (!Object.keys(mine).length) return out;
  var owners = { emails: {}, digits: {} };
  var own = function (bag, k, uid) { (bag[k] = bag[k] || {})[uid] = true; };
  (usersAll_() || []).forEach(function (u) {
    if (!sdLive_(u)) return;
    var uid = sdStr_(u.userid);
    if (!uid) return;
    [u.email].concat(profileParseEmails_(u.emails)).forEach(function (e) {
      var k = sdStr_(e).toLowerCase();
      if (k.indexOf('@') > 0) own(owners.emails, k, uid);
    });
    var phones = [u.phone];
    profileParsePhones_(u.phones).forEach(function (p) { phones.push(p && p.number); });
    phones.forEach(function (n) {
      var d = String(n == null ? '' : n).replace(/\D/g, '').slice(-10);
      if (d.length === 10) own(owners.digits, d, uid);
    });
  });
  ['emails', 'digits'].forEach(function (bag) {
    Object.keys(owners[bag]).forEach(function (k) {
      var who = Object.keys(owners[bag][k]);
      if (who.every(function (uid) { return mine[uid]; })) { out[bag][k] = true; out.any = true; }
    });
  });
  return out;
}

/** FAIL-OPEN: the destinations (addresses and numbers) left once every holder who turned this alert off is out. */
function arKeep_(part, dests) {
  var list = dests || [];
  if (!arIsPart_(part) || !list.length) return list;
  try {
    var drop = arDropped_(part);
    if (!drop.any) return list;
    return list.filter(function (d) {
      var s = sdStr_(d);
      if (s.indexOf('@') !== -1) return !drop.emails[s.toLowerCase()];
      var digits = s.replace(/\D/g, '').slice(-10);
      return !(digits.length === 10 && drop.digits[digits]);
    });
  } catch (e) { return list; }
}

/** uid → the parts turned off, for the config lane: the holders alone, and only what each turned off. */
function arLane_() {
  var off = arOff_();
  var out = {};
  Object.keys(off).forEach(function (uid) {
    var parts = AR_PARTS.filter(function (p) { return off[uid][p] === true; });
    if (parts.length) out[uid] = parts;
  });
  return out;
}

/** The master's own session, or a director on the list; null for anybody else, the service, and a visit. */
function arGate_(user) {
  if (!user || user.is_service || sdVisiting_(user)) return null;
  var uid = sdStr_(user.id);
  if (!uid) return null;
  var master = false;
  try { master = !!hubIsRealMaster_(user); } catch (e) { master = false; }
  if (master) return { uid: uid, as: 'master', name: sdActorName_(user) };
  var dirs = sdDirectors_();
  if (dirs.list.some(function (d) { return d.uid === uid; })) return { uid: uid, as: 'director', name: sdActorName_(user) };
  return null;
}

function arAnswer_(g, off, setUp) {
  var receive = {};
  AR_PARTS.forEach(function (p) { receive[p] = !(off && off[p] === true); });
  return { as: g.as, receive: receive, saveable: setUp !== false,
           why: setUp === false ? 'The Support Requests settings are not set up yet, so a choice cannot be kept.' : '' };
}

HUB_POLICY.alertReceiveGet = {
  file: 'AlertReceive.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: []
};
/** The caller's own three choices; 404 for anybody who does not hold the section. */
HUB_ACTIONS.alertReceiveGet = function (payload, user) {
  var g = arGate_(user);
  if (!g) return sdRefuse_(404, 'Unknown action.');
  var st = arStored_();
  if (!st.readable) {
    return sdRefuse_(503, 'Your alert choices could not be read just now (' + st.why + ') — every alert still reaches you.');
  }
  return { status: 200, data: arAnswer_(g, st.off[g.uid], st.set_up) };
};

HUB_POLICY.alertReceiveSet = {
  file: 'AlertReceive.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { part: { type: 'string' }, receive: { type: 'boolean' } }
};
/** One of the caller's own choices, under the lock; the row is the caller's, never a payload's. */
HUB_ACTIONS.alertReceiveSet = function (payload, user) {
  var g = arGate_(user);
  if (!g) return sdRefuse_(404, 'Unknown action.');
  var part = sdStr_(payload && payload.part);
  if (!arIsPart_(part)) return sdRefuse_(400, 'Choose one of ' + AR_PARTS.join(', ') + '.');
  if (typeof (payload && payload.receive) !== 'boolean') return sdRefuse_(400, 'receive must be true or false.');
  var res;
  try {
    res = sdLock_(function () {
      sdMemoDrop_(SD_TABS.settings);
      var fresh = arStoredRead_();
      if (!fresh.readable) return sdRefuse_(503, 'Your alert choices could not be read (' + fresh.why + ') — nothing was changed.');
      if (!fresh.set_up) {
        return sdRefuse_(503, 'The Support Requests settings are not set up yet, so the choice cannot be kept — nothing was changed.');
      }
      var off = {};
      AR_PARTS.forEach(function (p) { if (fresh.off[g.uid] && fresh.off[g.uid][p]) off[p] = true; });
      if (payload.receive) delete off[part]; else off[part] = true;
      sdUpsert_(SD_TABS.settings, [{ key: AR_KEY_PREFIX + g.uid,
                                     value: AR_PARTS.filter(function (p) { return off[p]; }).join(', '),
                                     note: g.name + ' (' + g.as + ') — the alerts turned off in Settings',
                                     updated_at: sdIso_(sdNowMs_()), updated_by: g.name }]);
      if (Object.keys(off).length) fresh.off[g.uid] = off; else delete fresh.off[g.uid];
      arCachePut_(fresh, AR_SAVE_TTL);
      return { ok: true, off: off };
    });
  } catch (e) {
    arCacheDrop_();
    return sdRefuse_(503, 'Your choice could not be written (' + sdErr_(e) + ') — nothing was changed.');
  }
  if (!res || res.status) return res || sdRefuse_(503, 'No answer from the lock.');
  sdMemoDrop_(SD_TABS.settings);
  try { hubSysLog_(sdStr_(user.email), 'alertReceiveSet', part + ' ' + (payload.receive ? 'on' : 'off'), { status: 200 }); }
  catch (eL) {}
  return { status: 200, data: arAnswer_(g, res.off, true) };
};
