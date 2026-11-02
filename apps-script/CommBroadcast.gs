var COMM_BROADCAST_SITUATION = 'staff_broadcast';

// Resolved through HUB_HOUSE_COMM_BROADCASTS_ID, never by tab name.
var COMM_BROADCAST_HOUSE = 'comm_broadcasts';

// Mint order (tools/mint_comm_broadcasts_house.py); ensureHeader_ only appends.
var COMM_BROADCAST_HEADER = [
  'id', 'createdAt', 'updatedAt',
  'client_id', 'by_email', 'by_name', 'by_badges',
  'audience', 'audience_label', 'house', 'meddel',
  'message', 'signature', 'body_sample',
  'state', 'count', 'sent', 'recorded', 'held', 'refused', 'failed', 'pending', 'withdrawn',
  'test_mode', 'dial', 'why', 'warnings', 'dropped',
  'recipients', 'next_index', 'audience_sha',
  'withdrawn_by', 'withdrawn_at', 'finished_at'
];

var COMM_BROADCAST_TEXT_MIN = 2;

var COMM_BROADCAST_TEXT_MAX = 1400;
var COMM_BROADCAST_SIGNATURE_MAX = 160;

var COMM_BROADCAST_SMS_MAX = 1600;

// A guard against a runaway resolver, not an audience limit.
var COMM_BROADCAST_MAX = 200;

// Stays under the relay's 110 s wait with room for the resolve.
var COMM_BROADCAST_BUDGET_MS = 75000;
var COMM_BROADCAST_CARRY_BUDGET_MS = 45000;

var COMM_BROADCAST_MARK_EVERY = 20;

var COMM_BROADCAST_STALE_MS = 3 * 60 * 1000;

var COMM_BROADCAST_HISTORY = 25;

var COMM_BROADCAST_HOUSE_DAYS = 28;

// An open shift never says why or who; these words warn, never block.
var COMM_BROADCAST_REASON_WORDS = 'emergency, hospital, hospitalized, sick, illness, family, ' +
  'injured, injury, accident, surgery, funeral, passed away, died, death, doctor, covid, car trouble, ' +
  'called off, call off, calling off, called out, call out, calling out, no call, no show';

// A follower of DIRECTOR (HUB_BADGE_FOLLOWS) is folded in by userBadgesWorn_; TEAMLEAD follows nobody (2026-10-29).
var COMM_BROADCAST_ABOVE = ['DIRECTOR', 'ADMINISTRATOR', 'ADMIN'];

// hm: a house manager may choose it; staff: the reason warning applies; cc: the Cc cell joins.
var COMM_BROADCAST_AUDIENCES = {
  allstaff: { label: 'All staff', hm: true, staff: true, cc: true },
  meddel: { label: 'Only Med Del', hm: true, staff: true, cc: true },
  house: { label: 'One house', hm: true, staff: true, cc: false },
  leadership: { label: 'Leadership', hm: false, staff: false, cc: true },
  prn: { label: 'PRN', hm: true, staff: true, cc: false }
};

var COMM_BROADCAST_OPTIONAL = ['signature', 'first_name', 'name', 'sender_name', 'house'];

var COMM_BROADCAST_PRN_PATH = '/erp-lanes/broadcast/prn';

var COMM_BROADCAST_PASS_BY = 'asa-hub:comm-broadcast';
var COMM_BROADCAST_CAL_CACHE_KEY = 'comm_broadcast_calendar:v1';
var COMM_BROADCAST_CAL_TTL = 600;

var COMM_BROADCAST_CAL_MEMO = null;

function commBroadcastWho_(user) {
  var out = { ok: false, above: false, hm: false, master: false, email: '', name: '', badges: [], why: '' };
  if (!user || user.is_service) {
    out.why = 'a broadcast is written by a person, from their own session';
    return out;
  }
  out.email = String(user.email || '').trim().toLowerCase();
  out.name = String(user.display_name || user.email || '').trim();
  try { out.badges = userBadgesWornBy_(user); } catch (eB) { out.badges = []; }
  try { out.master = !!(out.email && hubIsMaster_(out.email)); } catch (eM) { out.master = false; }
  out.above = out.master || COMM_BROADCAST_ABOVE.some(function (b) { return out.badges.indexOf(b) !== -1; });
  out.hm = out.badges.indexOf('HM') !== -1;
  out.ok = out.above || out.hm;
  if (!out.ok) {
    out.why = 'broadcasting is for a house manager (their own house and all staff) and, for every ' +
              'audience, a director, team lead, administrator or the master';
  }
  return out;
}

function commBroadcastDenied_(who) {
  return { status: 403, message: String((who && who.why) || 'Broadcasting is not open to this account.') };
}

function commBroadcastCache_() {
  return CacheService.getScriptCache();
}

function commBroadcastCalendarRows_() {
  var ss = ssOpen_(hubId_('HOTLINE_CALENDAR_ID'));
  var tab = (typeof HOTLINE_CALENDAR_TAB !== 'undefined') ? HOTLINE_CALENDAR_TAB : 'Calendar Archive';
  var sheet = ss.getSheetByName(tab);
  if (!sheet) throw new Error('the hotline calendar has no tab named ' + tab);
  var tz = '';
  try { tz = String(ss.getSpreadsheetTimeZone() || ''); } catch (eT) { tz = ''; }
  return { values: sheet.getDataRange().getValues(), tz: tz || 'America/New_York' };
}

function commBroadcastDay_(value, tz) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    try { return Utilities.formatDate(value, tz || 'America/New_York', 'yyyy-MM-dd'); }
    catch (eF) { return ''; }
  }
  var s = String(value == null ? '' : value).trim();
  var us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (us) {
    var y = Number(us[3]);
    if (y < 100) y += 2000;
    return y + '-' + ('0' + us[1]).slice(-2) + '-' + ('0' + us[2]).slice(-2);
  }
  var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return iso ? iso[1] + '-' + iso[2] + '-' + iso[3] : '';
}

function commBroadcastDayMinus_(iso, days) {
  var t = Date.parse(String(iso || '') + 'T12:00:00Z');
  return isNaN(t) ? '' : new Date(t - Number(days || 0) * 86400000).toISOString().slice(0, 10);
}

function commBroadcastToday_() {
  var now = (typeof hubQuietNow_ === 'function') ? hubQuietNow_() : new Date();
  try { return Utilities.formatDate(now, 'America/New_York', 'yyyy-MM-dd'); }
  catch (e) { return now.toISOString().slice(0, 10); }
}

function commBroadcastHouseDays_() {
  try {
    if (typeof digestSetting_ === 'function') {
      return Number(digestSetting_('comm_broadcast_house_days', COMM_BROADCAST_HOUSE_DAYS, 1, 366));
    }
  } catch (e) { /* the floor is the answer */ }
  return COMM_BROADCAST_HOUSE_DAYS;
}

function commBroadcastCalendar_(opts) {
  var fresh = !!(opts && opts.fresh);
  if (COMM_BROADCAST_CAL_MEMO && !fresh) return COMM_BROADCAST_CAL_MEMO;
  var cache = null;
  try { cache = commBroadcastCache_(); } catch (eC) { cache = null; }
  if (cache && !fresh) {
    try {
      var hit = cache.get(COMM_BROADCAST_CAL_CACHE_KEY);
      if (hit) { COMM_BROADCAST_CAL_MEMO = JSON.parse(hit); return COMM_BROADCAST_CAL_MEMO; }
    } catch (eH) { /* read it again */ }
  }
  var out = { readable: false, why: '', from: '', houses: {}, order: [], managers: [], rows: 0 };
  var got = null;
  try { got = commBroadcastCalendarRows_(); } catch (eR) {
    out.why = 'the hotline calendar could not be read (' + String((eR && eR.message) || eR).slice(0, 120) +
              ') — that is "we cannot see", never "nobody works there"';
    return out;
  }
  var values = (got && got.values) || [];
  out.readable = true;
  var head = (values[0] || []).map(function (h) { return String(h || '').trim().toLowerCase(); });
  var col = function (name, fallback) {
    var i = head.indexOf(name);
    return i === -1 ? fallback : i;
  };
  // By header first, by Hotline.gs positions when a header is missing.
  var cLoc = col('location', 0), cName = col('employee', 1), cDes = col('designation', 2);
  var cPhone = col('phone', 3), cDate = col('date', 4);
  out.from = commBroadcastDayMinus_(commBroadcastToday_(), commBroadcastHouseDays_());
  for (var r = 1; r < values.length; r++) {
    var line = values[r] || [];
    var loc = String(line[cLoc] == null ? '' : line[cLoc]).trim();
    var name = String(line[cName] == null ? '' : line[cName]).trim();
    if (!loc || !name) continue;
    var upper = name.toUpperCase();
    if (upper === 'OPEN' || upper.indexOf('WORKSHOP') !== -1) continue;
    var day = commBroadcastDay_(line[cDate], got.tz);
    if (!day || day < out.from) continue;
    var key = clientNameKey_(name);
    if (!key) continue;
    var house = out.houses[loc];
    if (!house) house = out.houses[loc] = { location: loc, label: commCallOffHouseLabel_(loc), people: {} };
    var p = house.people[key];
    if (!p) p = house.people[key] = { name: name, key: key, meddel: false, manager: false, phone: '' };
    var des = String(line[cDes] == null ? '' : line[cDes]).trim();
    if (des.indexOf('*') !== -1) p.meddel = true;
    if (des === '**') p.manager = true;
    var ph = String(line[cPhone] == null ? '' : line[cPhone]).trim();
    if (!p.phone && ph) p.phone = ph;
    out.rows++;
  }
  Object.keys(out.houses).forEach(function (loc) {
    var h = out.houses[loc];
    var list = Object.keys(h.people).map(function (k) { return h.people[k]; });
    list.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
    h.people = list;
    list.forEach(function (p) {
      if (!p.manager) return;
      out.managers.push({ name: p.name, key: p.key, location: loc,
                          phone_key: String(p.phone || '').replace(/\D/g, '').slice(-10) });
    });
  });
  out.order = Object.keys(out.houses).sort(function (a, b) {
    return out.houses[a].label.toLowerCase() < out.houses[b].label.toLowerCase() ? -1 : 1;
  });
  COMM_BROADCAST_CAL_MEMO = out;
  if (cache) {
    try { cache.put(COMM_BROADCAST_CAL_CACHE_KEY, JSON.stringify(out), COMM_BROADCAST_CAL_TTL); }
    catch (eP) { /* uncached: the next page read opens the book again */ }
  }
  return out;
}

// A shared line names nobody; an unreadable answer counts as shared.
function commBroadcastSharedKey_(v) {
  var k = String(v == null ? '' : v).replace(/\D/g, '').slice(-10);
  if (k.length !== 10) return false;
  try {
    if (typeof hubLineSharedForIdentity_ === 'function' && hubLineSharedForIdentity_(k)) return true;
    if (typeof hubSharedLine_ === 'function' && hubSharedLine_(k)) return true;
  } catch (e) { return true; }
  return false;
}

function commBroadcastIdentity_(user) {
  var out = { nameKey: '', phones: {}, from: '' };
  var addPhone = function (v) {
    var d = String(v == null ? '' : v).replace(/\D/g, '').slice(-10);
    if (d.length === 10 && !commBroadcastSharedKey_(d)) out.phones[d] = true;
  };
  var pid = String((user && user.people_id) || '').replace(/^people:/, '').trim();
  if (pid) {
    var rows = null;
    try { rows = commBroadcastPeopleRows_(); } catch (eR) { rows = null; }
    var mine = null;
    (rows || []).forEach(function (p) { if (!mine && p && String(p.id || '') === pid) mine = p; });
    if (mine && clientNameKey_(mine.name)) {
      out.nameKey = clientNameKey_(mine.name);
      addPhone(mine.phone);
      out.from = 'roster';
      return out;
    }
  }
  out.nameKey = clientNameKey_(user && user.display_name);
  addPhone(user && user.phone);
  var list = [];
  try { list = (typeof profileParsePhones_ === 'function') ? profileParsePhones_(user && user.phones) : []; }
  catch (eP) { list = []; }
  (list || []).forEach(function (p) { addPhone(p && typeof p === 'object' ? p.number : p); });
  out.from = 'profile';
  return out;
}

function commBroadcastOwnHouses_(user, cal) {
  var out = { houses: [], via: '' };
  var who = commBroadcastIdentity_(user);
  var byName = [], byPhone = [];
  ((cal && cal.managers) || []).forEach(function (m) {
    if (who.nameKey && m.key === who.nameKey) { if (byName.indexOf(m.location) === -1) byName.push(m.location); }
    else if (m.phone_key && who.phones[m.phone_key] && !commBroadcastSharedKey_(m.phone_key)) {
      if (byPhone.indexOf(m.location) === -1) byPhone.push(m.location);
    }
  });
  out.houses = byName.length ? byName : byPhone;
  out.via = byName.length ? 'name' : (byPhone.length ? 'phone' : '');
  return out;
}

function commBroadcastPeopleRows_() {
  return withoutIspClients_(peopleMerged_(listRows_('people', {})));
}

function commBroadcastPeople_() {
  var out = { readable: false, why: '', byKey: {}, onStaff: {} };
  var rows = null;
  try { rows = commBroadcastPeopleRows_(); } catch (e) { rows = null; }
  if (!rows) {
    out.why = 'the People house could not be read — nobody was resolved, which is a refusal and not an ' +
              'empty company';
    return out;
  }
  out.readable = true;
  var onStaff = {};
  try { onStaff = (typeof cgBlockStatuses_ === 'function') ? cgBlockStatuses_() : {}; } catch (eS) { onStaff = {}; }
  if (!Object.keys(onStaff).length) onStaff = { active: true, admin: true };
  out.onStaff = onStaff;
  rows.forEach(function (p) {
    var key = clientNameKey_(p && p.name);
    if (!key) return;
    var mine = { name: String(p.name || '').trim(), phone: String(p.phone || '').trim(),
                 status: String(p.status || '').trim().toLowerCase() };
    var cur = out.byKey[key];
    if (!cur || (!onStaff[cur.status] && onStaff[mine.status]) ||
        (onStaff[cur.status] === onStaff[mine.status] && !cur.phone && mine.phone)) {
      out.byKey[key] = mine;
    }
  });
  return out;
}

function commBroadcastClientKeys_() {
  try { return (typeof ispClientNameKeys_ === 'function') ? (ispClientNameKeys_() || {}) : {}; }
  catch (e) { return {}; }
}

// A Staff Preferences note that only mentions PRN is reported, not counted.
function commBroadcastPrn_() {
  var out = { readable: false, names: [], mentions: [], why: '', as_of: '' };
  var r = null;
  try {
    r = (typeof staffRelayPost_ === 'function') ? staffRelayPost_(COMM_BROADCAST_PRN_PATH, {}) : null;
  } catch (e) { r = null; }
  if (!r || Number(r.status) !== 200 || !r.data) {
    out.why = 'the PRN list is the Staff Preferences mirror the relay reads, and the relay did not answer (' +
              String((r && ((r.status || '') + ' ' + (r.message || ''))) || 'no answer').trim().slice(0, 120) +
              ') — that is "we cannot see", never "nobody is PRN"';
    return out;
  }
  var d = r.data;
  if (d.readable === false) {
    out.why = 'the Staff Preferences mirror could not be read: ' + String(d.why || '').slice(0, 160);
    return out;
  }
  out.readable = true;
  out.names = (d.names || []).map(function (n) { return String(n || '').trim(); }).filter(String);
  out.mentions = (d.mentions || []).slice(0, 20);
  out.as_of = String(d.as_of || '');
  return out;
}

function commBroadcastSpec_(payload) {
  var p = payload || {};
  var audience = String(p.audience || '').trim().toLowerCase();
  var isHouse = audience === 'house';
  var meddel = isHouse && (p.meddel === true || String(p.meddel || '').toLowerCase() === 'yes' ||
                           String(p.meddel || '').toLowerCase() === 'true');
  return {
    audience: audience,
    house: isHouse ? String(p.house || '').trim() : '',
    meddel: meddel,
    message: String(p.message == null ? '' : p.message).replace(/\r\n?/g, '\n').trim(),
    signature: String(p.signature == null ? '' : p.signature).replace(/\r\n?/g, '\n').trim()
  };
}

function commBroadcastAudienceLabel_(spec) {
  var def = COMM_BROADCAST_AUDIENCES[spec.audience];
  if (!def) return spec.audience;
  if (spec.audience === 'house') {
    return 'One house — ' + commCallOffHouseLabel_(spec.house) + (spec.meddel ? ', Med Del only' : '');
  }
  return def.label;
}

function commBroadcastAllowed_(spec, who, cal, user) {
  var def = COMM_BROADCAST_AUDIENCES[spec.audience];
  if (!def) return 'Choose who the broadcast goes to: ' + Object.keys(COMM_BROADCAST_AUDIENCES).join(', ') + '.';
  if (!who.ok) return who.why;
  if (spec.audience === 'house') {
    if (!cal || !cal.readable) return '';
    if (!cal.houses[spec.house]) {
      return 'That house is not on the calendar in the window this lane reads — pick one of the houses listed.';
    }
  }
  if (who.above) return '';
  if (!def.hm) {
    return def.label + ' reaches the directors\' group and every house manager, so it is sent by a director, ' +
           'team lead, administrator or the master.';
  }
  if (spec.audience === 'house') {
    var own = commBroadcastOwnHouses_(user, cal);
    if (own.houses.indexOf(spec.house) === -1) {
      return 'A house manager writes to the staff of their own house — the calendar names you as the ' +
             'manager of ' + (own.houses.length
               ? own.houses.map(commCallOffHouseLabel_).join(', ')
               : 'no house in the window it reads') + '.';
    }
  }
  return '';
}

function commBroadcastAudienceOut_(spec) {
  return { readable: true, why: [], notes: [], entries: [], seen: {}, dropped: {},
           label: commBroadcastAudienceLabel_(spec), counted: { duplicate: 0 } };
}

var COMM_BROADCAST_DROP_WORDS = {
  client: 'is a client, never staff',
  not_on_staff: 'is not on staff in People (the status column)',
  no_number: 'carries no number',
  not_textable: 'carries a shared company line or a number we cannot text',
  opted_out: 'asked us to stop',
  opt_out_unreadable: 'the opt-out list could not be read, so nobody is texted rather than somebody who asked us to stop',
  not_found: 'is on the PRN list and nowhere else we can find a number',
  cc_address: 'is an e-mail address in the Cc cell, and a broadcast is a text'
};

function commBroadcastDrop_(out, reason, name, howMany) {
  var d = out.dropped[reason];
  if (!d) d = out.dropped[reason] = { reason: reason, label: COMM_BROADCAST_DROP_WORDS[reason] || reason,
                                       count: 0, names: [] };
  d.count += (howMany === undefined) ? 1 : Number(howMany) || 0;
  if (d.names.length < 60 && name) d.names.push(String(name));
}

function commBroadcastAdd_(out, e) {
  var to = String(e.to || '').trim();
  var key = to.replace(/\D/g, '').slice(-10);
  if (key.length !== 10) { commBroadcastDrop_(out, 'not_textable', e.name); return; }
  if (out.seen[key]) { out.counted.duplicate++; return; }
  var blocked = '';
  try { blocked = (typeof optOutBlocked_ === 'function') ? optOutBlocked_(to) : ''; }
  catch (eO) { blocked = 'unreadable'; }
  if (blocked) {
    // Any answer other than a person's stop is the list failing, which refuses too.
    var stop = /^This person asked us to stop/.test(String(blocked));
    commBroadcastDrop_(out, stop ? 'opted_out' : 'opt_out_unreadable', e.name);
    return;
  }
  out.seen[key] = true;
  out.entries.push({ name: String(e.name || '').trim(), to: '+1' + key, key: key,
                     from: String(e.from || ''), group: !!e.group });
}

function commBroadcastFromCalendar_(people, ctx, out) {
  (people || []).forEach(function (cp) {
    var key = cp.key || clientNameKey_(cp.name);
    if (!key) return;
    if (ctx.clients[key]) { commBroadcastDrop_(out, 'client', cp.name); return; }
    var p = ctx.people.byKey[key];
    if (p && !ctx.people.onStaff[p.status]) { commBroadcastDrop_(out, 'not_on_staff', cp.name); return; }
    var num = (p && p.phone) ? packetSendableNumber_(p.phone) : '';
    var from = 'people';
    if (!num && cp.phone) {
      num = packetSendableNumber_(cp.phone);
      from = 'calendar';
    }
    if (!num) {
      commBroadcastDrop_(out, ((p && p.phone) || cp.phone) ? 'not_textable' : 'no_number', cp.name);
      return;
    }
    commBroadcastAdd_(out, { name: (p && p.name) || cp.name, to: num, from: from });
  });
}

function commBroadcastFromKeyword_(word, out, fromLabel) {
  var got = null;
  try { got = SMART_TO_KEYWORDS[word].resolve({}); } catch (e) { got = null; }
  if (!got || (got.readable !== undefined ? !got.readable : !got.ok)) {
    out.readable = false;
    out.why.push('`' + word + '` could not be resolved: ' + String((got && got.why) || 'the house behind it ' +
                 'did not answer') + ' — that is "we cannot see", never "this reaches nobody"');
    return;
  }
  (got.people || []).forEach(function (p) {
    var phone = String((p && p.phone) || '');
    commBroadcastAdd_(out, { name: String((p && p.name) || ''), to: phone,
                             from: fromLabel || ('keyword:' + word),
                             group: word === 'directors' || commBroadcastSharedKey_(phone) });
  });
  if (got.counted) {
    if (got.counted.no_phone) commBroadcastDrop_(out, 'no_number', '', got.counted.no_phone);
    if (got.counted.refused) commBroadcastDrop_(out, 'opted_out', '', got.counted.refused);
  }
}

function commBroadcastFromCc_(sit, out) {
  var cells = [];
  try { cells = smartList_(sit && sit.cc); } catch (e) { cells = []; }
  cells.forEach(function (entry) {
    var word = (typeof smartToKeyword_ === 'function') ? smartToKeyword_(entry) : '';
    if (word) { commBroadcastFromKeyword_(word, out, 'cc:' + word); return; }
    if (String(entry).indexOf('@') !== -1) { commBroadcastDrop_(out, 'cc_address', ''); return; }
    var num = (typeof packetTeamCopyNumber_ === 'function') ? packetTeamCopyNumber_(entry) : '';
    if (!num) { commBroadcastDrop_(out, 'not_textable', ''); return; }
    commBroadcastAdd_(out, { name: '', to: num, from: 'cc' });
  });
}

// `refused` and `readable: false` are never an empty list and never sent to.
function commBroadcastResolve_(spec, who, user, sit) {
  var out = commBroadcastAudienceOut_(spec);
  var needsCal = spec.audience === 'house' || spec.audience === 'meddel' || spec.audience === 'prn';
  var cal = needsCal ? commBroadcastCalendar_() : null;
  var refused = commBroadcastAllowed_(spec, who, cal, user);
  if (refused) { out.refused = refused; out.readable = false; return commBroadcastAudienceDone_(out); }
  var ctx = null;
  var needCtx = function () {
    if (ctx) return ctx;
    ctx = { people: commBroadcastPeople_(), clients: commBroadcastClientKeys_() };
    if (!ctx.people.readable) { out.readable = false; out.why.push(ctx.people.why); }
    return ctx;
  };
  if (spec.audience === 'allstaff') {
    commBroadcastFromKeyword_('allstaff', out, 'keyword:allstaff');
  } else if (spec.audience === 'leadership') {
    commBroadcastFromKeyword_('housemanagers', out, 'keyword:housemanagers');
    commBroadcastFromKeyword_('directors', out, 'keyword:directors');
  } else if (spec.audience === 'house' || spec.audience === 'meddel') {
    if (!cal.readable) { out.readable = false; out.why.push(cal.why); return commBroadcastAudienceDone_(out); }
    if (!needCtx().people.readable) return commBroadcastAudienceDone_(out);
    var people = [];
    if (spec.audience === 'house') {
      people = (cal.houses[spec.house] || { people: [] }).people.filter(function (p) {
        return !spec.meddel || p.meddel;
      });
    } else {
      var byKey = {};
      cal.order.forEach(function (loc) {
        cal.houses[loc].people.forEach(function (p) {
          if (!p.meddel) return;
          if (!byKey[p.key]) byKey[p.key] = { name: p.name, key: p.key, phone: p.phone };
          else if (!byKey[p.key].phone && p.phone) byKey[p.key].phone = p.phone;
        });
      });
      people = Object.keys(byKey).map(function (k) { return byKey[k]; });
    }
    commBroadcastFromCalendar_(people, ctx, out);
  } else if (spec.audience === 'prn') {
    var prn = commBroadcastPrn_();
    if (!prn.readable) { out.readable = false; out.why.push(prn.why); return commBroadcastAudienceDone_(out); }
    if (!needCtx().people.readable) return commBroadcastAudienceDone_(out);
    var calPhones = {};
    if (cal && cal.readable) {
      cal.order.forEach(function (loc) {
        cal.houses[loc].people.forEach(function (p) { if (p.phone && !calPhones[p.key]) calPhones[p.key] = p.phone; });
      });
    }
    var prnPeople = [];
    prn.names.forEach(function (n) {
      var k = clientNameKey_(n);
      if (!k) return;
      if (!ctx.people.byKey[k] && !calPhones[k]) { commBroadcastDrop_(out, 'not_found', n); return; }
      prnPeople.push({ name: n, key: k, phone: calPhones[k] || '' });
    });
    commBroadcastFromCalendar_(prnPeople, ctx, out);
    if (prn.mentions.length) {
      out.notes.push(prn.mentions.length + ' Staff Preferences note(s) mention PRN beside other words and were ' +
                     'not counted: ' + prn.mentions.map(function (m) {
                       return String(m.name || '') + (m.note ? ' ("' + String(m.note).slice(0, 40) + '")' : '');
                     }).join(', '));
    }
  }
  if (COMM_BROADCAST_AUDIENCES[spec.audience].cc && sit) commBroadcastFromCc_(sit, out);
  return commBroadcastAudienceDone_(out);
}

function commBroadcastAudienceDone_(out) {
  var main = out.entries.filter(function (e) { return String(e.from).indexOf('cc') !== 0; });
  var cc = out.entries.filter(function (e) { return String(e.from).indexOf('cc') === 0; });
  main.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
  out.entries = main.concat(cc);
  if (out.counted.duplicate) {
    out.notes.push(out.counted.duplicate + ' number(s) appeared twice and are texted once');
  }
  out.dropped = Object.keys(out.dropped).map(function (k) { return out.dropped[k]; });
  delete out.seen;
  return out;
}

// The send is refused if the list changed since the preview.
function commBroadcastSha_(entries) {
  var keys = (entries || []).map(function (e) { return String(e.key || ''); }).sort().join(',');
  try {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, keys)
      .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('').slice(0, 20);
  } catch (e) { return String(keys.length) + ':' + keys.slice(0, 40); }
}

function commBroadcastTextProblem_(message, signature) {
  var m = String(message == null ? '' : message).trim();
  var s = String(signature == null ? '' : signature).trim();
  if (m.replace(/\s+/g, '').length < COMM_BROADCAST_TEXT_MIN) {
    return 'Write the message first — an empty or one-character text is never sent to a group.';
  }
  if (m.length > COMM_BROADCAST_TEXT_MAX) {
    return 'The message is ' + m.length + ' characters; a broadcast carries at most ' + COMM_BROADCAST_TEXT_MAX +
           ' so it arrives as one text.';
  }
  if (s.length > COMM_BROADCAST_SIGNATURE_MAX) {
    return 'The signature is ' + s.length + ' characters; it may be at most ' + COMM_BROADCAST_SIGNATURE_MAX + '.';
  }
  return '';
}

function commBroadcastReasonWords_() {
  var raw = COMM_BROADCAST_REASON_WORDS;
  try {
    if (typeof digestSetting_ === 'function') {
      raw = String(digestSetting_('comm_broadcast_reason_words', COMM_BROADCAST_REASON_WORDS) || raw);
    }
  } catch (e) { raw = COMM_BROADCAST_REASON_WORDS; }
  return raw.split(/[,;\n]+/).map(function (w) { return String(w).trim().toLowerCase(); }).filter(String);
}

function commBroadcastReasonHits_(text) {
  var fold = function (s) { return ' ' + String(s || '').toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim() + ' '; };
  var t = fold(text);
  var hits = [];
  commBroadcastReasonWords_().forEach(function (w) {
    var ww = fold(w);
    if (ww.trim() && t.indexOf(ww) !== -1 && hits.indexOf(w) === -1) hits.push(w);
  });
  return hits;
}

// An empty optional placeholder closes its own gap; typed text is never touched.
var COMM_BROADCAST_GAP = '\u0001';

function commBroadcastRender_(tpl, vars) {
  var v = vars || {};
  var S = COMM_BROADCAST_GAP;
  var lines = String(tpl == null ? '' : tpl).replace(/\r\n?/g, '\n').split('\n');
  var out = [];
  lines.forEach(function (line) {
    var emptied = false;
    var rendered = line.replace(/\{(\w+)\}/g, function (m, k) {
      var val = v[k];
      if (val !== undefined && val !== null && String(val) !== '') return String(val).split(S).join('');
      if (COMM_BROADCAST_OPTIONAL.indexOf(k) !== -1) { emptied = true; return S; }
      return m;
    });
    if (emptied) {
      if (!/[A-Za-z0-9]/.test(rendered.split(S).join(''))) return;
      rendered = rendered
        .replace(new RegExp('^[ \\t]*' + S + '[ \\t]*[,;:\\-–—]*[ \\t]*'), '')
        .replace(new RegExp('[ \\t]*[,;:\\-–—]*[ \\t]*' + S + '[ \\t]*$'), '')
        .replace(new RegExp('[ \\t]*' + S + '[ \\t]*([,.;:!?])', 'g'), '$1')
        .replace(new RegExp('[ \\t]*' + S + '[ \\t]*', 'g'), ' ')
        .split(S).join('');
    }
    out.push(rendered);
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
}

function commBroadcastVars_(row, r) {
  var name = (r && !r.g) ? String(r.n || '').trim() : '';
  return {
    message: String(row.message || ''),
    signature: String(row.signature || ''),
    first_name: name.split(/\s+/)[0] || '',
    name: name,
    sender_name: String(row.by_name || ''),
    sender: (typeof SMART_SENDER_DEFAULT !== 'undefined') ? SMART_SENDER_DEFAULT : '',
    house: row.house ? commCallOffHouseLabel_(row.house) : '',
    audience: String(row.audience_label || '')
  };
}

function commBroadcastLongest_(sit, row, entries) {
  var longest = '';
  var sample = (entries || []).slice(0, COMM_BROADCAST_MAX);
  if (!sample.length) sample = [{ n: '' }];
  sample.forEach(function (e) {
    var text = commBroadcastRender_(sit.sms_text, commBroadcastVars_(row, { n: e.name || e.n, g: e.group || e.g }));
    if (text.length > longest.length) longest = text;
  });
  return longest;
}

// A template without `{message}` cannot speak.
function commBroadcastSituation_() {
  var sit = null;
  try { sit = (typeof smartSituationOn_ === 'function') ? smartSituationOn_(COMM_BROADCAST_SITUATION) : null; }
  catch (e) { return null; }
  if (!sit) return null;
  var chans = (typeof smartList_ === 'function') ? smartList_(sit.channels) : [];
  if (chans.indexOf('sms') === -1) return null;
  if (String(sit.sms_text || '').indexOf('{message}') === -1) return null;
  return sit;
}

function commBroadcastSituationState_() {
  var out = { id: COMM_BROADCAST_SITUATION, on: false, found: false, sms_text: '', cc_count: 0, why: '' };
  var row = null;
  try {
    smartSituations_().forEach(function (s) { if (String(s.id) === COMM_BROADCAST_SITUATION) row = s; });
  } catch (e) { row = null; }
  if (row) {
    out.found = true;
    out.sms_text = String(row.sms_text || '');
    try { out.cc_count = (typeof smartList_ === 'function') ? smartList_(row.cc).length : 0; }
    catch (eC) { out.cc_count = 0; }
  }
  out.on = !!commBroadcastSituation_();
  if (!out.on) {
    out.why = !row
      ? 'the situation `' + COMM_BROADCAST_SITUATION + '` is not in the situations tab yet — it is planted on the ' +
        'first read after the publish that carries it'
      : 'the situation `' + COMM_BROADCAST_SITUATION + '` is switched off on the Desk, does not name sms, or its ' +
        'words have lost {message} — nothing can be sent until it is on with the words in place';
  }
  return out;
}

function commBroadcastMode_() {
  var dial = { word: 'off', readable: false };
  try { dial = commDialState_(); } catch (eD) { dial = { word: 'off', readable: false }; }
  var test = false;
  try { test = (typeof commTestMode_ === 'function') && commTestMode_(); } catch (eT) { test = false; }
  var quiet = false;
  try { quiet = (typeof hubQuietAt_ === 'function') && hubQuietAt_(); } catch (eQ) { quiet = false; }
  var sending = false;
  try { sending = (typeof rpcSendEnabled_ === 'function') && rpcSendEnabled_(); } catch (eS) { sending = false; }
  return {
    test_mode: test ? 'on' : 'off',
    dial: String(dial.word || 'off'),
    dial_readable: dial.readable !== false,
    quiet_now: !!quiet,
    quiet_words: (typeof hubQuietWords_ === 'function') ? hubQuietWords_() : '21:31–07:59 New York',
    quiet_until: (typeof HUB_QUIET_TO !== 'undefined') ? HUB_QUIET_TO : '08:00',
    send_switch: sending ? 'on' : 'off'
  };
}

// Nothing is sent until the house is declared; no fallback to the core workbook.
function commBroadcastHouseReady_() {
  try { return !!(typeof houseMoved_ === 'function' && houseMoved_(COMM_BROADCAST_HOUSE)); }
  catch (e) { return false; }
}

function commBroadcastSheet_() {
  if (!commBroadcastHouseReady_()) {
    throw new Error('the broadcast house (' + COMM_BROADCAST_HOUSE + ') is not declared yet — ' +
                    'tools/mint_comm_broadcasts_house.py mints it');
  }
  return hubTabEnsure_(COMM_BROADCAST_HOUSE, COMM_BROADCAST_HEADER);
}

var COMM_BROADCAST_JSON_COLS = ['recipients', 'dropped'];

function commBroadcastRows_() {
  var sheet = commBroadcastSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0].map(function (h) { return String(h || '').trim(); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var obj = {};
    for (var c = 0; c < header.length; c++) {
      if (!header[c]) continue;
      var v = values[r][c];
      if (COMM_BROADCAST_JSON_COLS.indexOf(header[c]) !== -1) {
        try { obj[header[c]] = JSON.parse(String(v || '[]')); } catch (eJ) { obj[header[c]] = []; }
      } else if (Object.prototype.toString.call(v) === '[object Date]') {
        obj[header[c]] = (typeof cellText_ === 'function') ? cellText_(v) : v.toISOString();
      } else {
        obj[header[c]] = v;
      }
    }
    if (obj.id) out.push(obj);
  }
  return out;
}

function commBroadcastCell_(v) {
  var s = serialize_(v);
  return (typeof hubCellSafe_ === 'function') ? hubCellSafe_(s) : s;
}

function commBroadcastPut_(row) {
  var sheet = commBroadcastSheet_();
  var header = ensureHeader_(sheet, COMM_BROADCAST_HEADER);
  var nowIso = new Date().toISOString();
  row.updatedAt = nowIso;
  var found = findRowIndex_(sheet, row.id);
  if (!found) {
    if (!row.createdAt) row.createdAt = nowIso;
    sheet.appendRow(header.map(function (h) {
      return Object.prototype.hasOwnProperty.call(row, h) ? commBroadcastCell_(row[h]) : '';
    }));
    return;
  }
  var range = sheet.getRange(found, 1, 1, header.length);
  var existing = range.getValues()[0];
  range.setValues([header.map(function (h, i) {
    return Object.prototype.hasOwnProperty.call(row, h) ? commBroadcastCell_(row[h]) : existing[i];
  })]);
}

function commBroadcastFind_(id) {
  var hit = null;
  commBroadcastRows_().forEach(function (r) { if (String(r.id) === String(id)) hit = r; });
  if (hit && !Array.isArray(hit.recipients)) hit.recipients = [];
  return hit;
}

function commBroadcastSafePut_(row) {
  try { commBroadcastPut_(row); return true; }
  catch (e) {
    try {
      hubSysLog_('asa-hub:commbroadcast', 'broadcast_row_lost',
                 String(row && row.id) + ': ' + String((e && e.message) || e), { status: 500 });
    } catch (eL) { /* the answer carries it */ }
    return false;
  }
}

// Sender plus the page's key, so a double press is one broadcast.
function commBroadcastId_(email, clientId) {
  var seed = String(email || '').toLowerCase() + '|' + String(clientId || '');
  try {
    return 'BC_' + Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, seed)
      .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('').slice(0, 16);
  } catch (e) { return 'BC_' + String(clientId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16); }
}

function commBroadcastAlready_(row, spec, who) {
  var norm = function (v) { return String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim(); };
  var differs = '';
  if (norm(row.audience).toLowerCase() !== norm(spec.audience).toLowerCase()) differs = 'the audience';
  else if (norm(row.house) !== norm(spec.house)) differs = 'the house';
  else if ((String(row.meddel || '') === 'yes') !== !!spec.meddel) differs = 'the Med Del filter';
  else if (norm(row.message) !== norm(spec.message)) differs = 'the message';
  else if (norm(row.signature) !== norm(spec.signature)) differs = 'the signature';
  if (differs) {
    return { status: 409, message: 'This page\'s key already carried a different broadcast (' + differs +
                                   ' changed) — nothing was sent. Review it again and send.' };
  }
  return { status: 200, data: { already: true, broadcast: commBroadcastPublic_(row, who, true) } };
}

function commBroadcastTally_(row) {
  var t = { sent: 0, recorded: 0, held: 0, refused: 0, failed: 0, pending: 0, withdrawn: 0 };
  (row.recipients || []).forEach(function (r) {
    var o = String(r.o || 'pending');
    if (Object.prototype.hasOwnProperty.call(t, o)) t[o]++;
  });
  Object.keys(t).forEach(function (k) { row[k] = t[k]; });
  row.count = (row.recipients || []).length;
  return t;
}

function commBroadcastState_(row, nowMs) {
  var state = String(row.state || '');
  if (state === 'sending') {
    var at = Date.parse(String(row.updatedAt || row.createdAt || ''));
    if (!isNaN(at) && (Number(nowMs) || Date.now()) - at > COMM_BROADCAST_STALE_MS) return 'interrupted';
  }
  return state;
}

// A quiet-window answer stays pending.
function commBroadcastOutcome_(res) {
  if (!res) return { o: 'failed', w: 'the send door gave no answer' };
  if (res.quiet) return { o: 'pending', quiet: true, w: 'held by the quiet window' };
  if (res.recorded_to) return { o: 'recorded', w: 'written into ' + String(res.recorded_to) };
  if (res.rehearsed) {
    return res.rehearsal_recorded === false
      ? { o: 'held', w: 'test mode: nothing was sent, and the row could not be written' }
      : { o: 'recorded', w: 'test mode: a row in the mock outbox, nobody contacted' };
  }
  if (res.redirected) return { o: 'recorded', w: 'test mode redirected it to the testers' };
  if (res.ok && res.sent) return { o: 'sent', w: '' };
  if (res.ok && res.deduplicated) return { o: 'sent', w: 'already sent under this broadcast' };
  if (res.ok && String(res.reason || '') === 'opted_out') return { o: 'refused', w: 'asked us to stop' };
  if (res.ok && res.gated) return { o: 'held', w: String(res.reason || res.detail || 'a brake held it') };
  return { o: 'failed', w: String(res.error || res.detail || 'the send door refused') };
}

function commBroadcastSendOne_(row, r, body, seq) {
  var heldR = (typeof HUB_REHEARSAL_CTX !== 'undefined') ? HUB_REHEARSAL_CTX : null;
  var heldM = (typeof COMM_MOCK_CTX !== 'undefined') ? COMM_MOCK_CTX : null;
  var intent = 'BC|' + String(row.id) + '|' + String(r.k);
  var why = String(row.audience_label || '') + ' · written by ' + String(row.by_name || '');
  try {
    HUB_REHEARSAL_CTX = { pass_id: 'RHP_' + String(row.id), pass_by: COMM_BROADCAST_PASS_BY, seq: seq + 1,
                          intent_key: intent, person_key: String(r.k), person_name: r.g ? '' : String(r.n || ''),
                          situation: COMM_BROADCAST_SITUATION, purpose: 'broadcast',
                          sender_used: String(row.by_name || ''), verdict: 'broadcast', reasons: why };
    COMM_MOCK_CTX = { situation: COMM_BROADCAST_SITUATION, purpose: 'broadcast · ' + why,
                      person_name: r.g ? '' : String(r.n || ''), ledger_key: intent };
    return rpcCall_('smsSend', { to: String(r.t), body: body, reason: 'broadcast: ' + COMM_BROADCAST_SITUATION },
                    { idempotency_key: 'bc_' + String(row.id) + '_' + String(r.k) });
  } catch (e) {
    return { ok: false, sent: false, gated: false, error: 'transport', detail: String((e && e.message) || e) };
  } finally {
    HUB_REHEARSAL_CTX = heldR;
    COMM_MOCK_CTX = heldM;
  }
}

// Resumable: each copy carries its own idempotency key.
function commBroadcastSendLoop_(row, sit, budgetMs) {
  var list = row.recipients || [];
  var started = Date.now();
  var res = { asked: 0, quiet: false, stopped: '', sent_any: false };
  var i = Math.max(0, Number(row.next_index) || 0);
  for (; i < list.length; i++) {
    var r = list[i];
    if (String(r.o || 'pending') !== 'pending') continue;
    if (res.asked >= COMM_BROADCAST_MAX) { res.stopped = 'the cap of ' + COMM_BROADCAST_MAX + ' copies'; break; }
    if (Date.now() - started > (Number(budgetMs) || COMM_BROADCAST_BUDGET_MS)) {
      res.stopped = 'the ' + Math.round((Number(budgetMs) || COMM_BROADCAST_BUDGET_MS) / 1000) + '-second budget';
      break;
    }
    var body = commBroadcastRender_(sit.sms_text, commBroadcastVars_(row, r));
    var got = commBroadcastOutcome_(commBroadcastSendOne_(row, r, body, i));
    if (got.quiet) { res.quiet = true; break; }
    r.o = got.o;
    if (got.w) r.w = String(got.w).slice(0, 120); else delete r.w;
    res.asked++;
    if (r.o === 'sent') res.sent_any = true;
    if (res.asked % COMM_BROADCAST_MARK_EVERY === 0) {
      row.next_index = i + 1;
      commBroadcastTally_(row);
      commBroadcastSafePut_(row);
    }
  }
  row.next_index = i;
  var t = commBroadcastTally_(row);
  if (!t.pending) {
    row.state = 'done';
    row.finished_at = new Date().toISOString();
    row.why = commBroadcastEnding_(t);
  } else if (res.quiet) {
    row.state = 'held_quiet';
  } else {
    row.state = 'partial';
    row.why = t.pending + ' not asked yet — the pass stopped at ' + (res.stopped || 'its budget') +
              '; Continue sends the rest, and a copy that already left is never sent twice';
  }
  return res;
}

// Never "sent" for what a brake held.
function commBroadcastEnding_(t) {
  var parts = [];
  if (t.sent) parts.push(t.sent + ' sent');
  if (t.recorded) parts.push(t.recorded + ' recorded in the mock outbox — nobody contacted');
  if (t.held) parts.push(t.held + ' held by a brake — nothing sent');
  if (t.refused) parts.push(t.refused + ' refused (asked us to stop)');
  if (t.failed) parts.push(t.failed + ' failed');
  if (t.withdrawn) parts.push(t.withdrawn + ' withdrawn');
  return parts.join(' · ') || 'nothing to send';
}

function commBroadcastHoldForMorning_(row) {
  var words = (typeof hubQuietWords_ === 'function') ? hubQuietWords_() : '21:31–07:59 New York';
  var until = (typeof HUB_QUIET_TO !== 'undefined') ? HUB_QUIET_TO : '08:00';
  var kept = false;
  try { kept = (typeof hubQuietOwe_ === 'function') && hubQuietOwe_('broadcast', String(row.id), { id: String(row.id) }); }
  catch (eO) { kept = false; }
  commBroadcastTally_(row);
  if (kept) {
    row.state = 'held_quiet';
    row.why = 'held by the quiet window (' + words + '): nobody was contacted — the first pass after ' + until +
              ' sends it, unless it is withdrawn first';
  } else {
    row.state = 'partial';
    row.why = 'held by the quiet window (' + words + ') and it could NOT be kept for the morning (the list is ' +
              'full) — it will not go by itself; press Continue after ' + until;
  }
  var pending = (row.recipients || []).filter(function (r) { return String(r.o || 'pending') === 'pending'; });
  try {
    if (typeof commMockHeld_ === 'function' && pending.length) {
      commMockHeld_({
        channel: 'sms', to: pending.map(function (r) { return String(r.t); }).join(', '),
        situation: COMM_BROADCAST_SITUATION, intent_key: 'BC|' + String(row.id),
        purpose: 'broadcast', to_name: String(row.audience_label || ''), reasons: row.why,
        subject: '', body: String(row.body_sample || ''), reason: 'broadcast: ' + COMM_BROADCAST_SITUATION
      }, 'the quiet window (' + words + ')', true);
    }
  } catch (eM) { /* the broadcast row carries the count and the reason */ }
  return kept;
}

function commBroadcastAfterPass_(row, run) {
  if (run && run.sent_any && typeof smartRecord_ === 'function') {
    try {
      smartRecord_(smartLedgerKey_(COMM_BROADCAST_SITUATION, String(row.id), new Date().toISOString().slice(0, 10)),
                   COMM_BROADCAST_SITUATION, String(row.audience_label || ''), '', 'sms');
    } catch (eL) { /* the copies left either way; the ledger line is a record */ }
  }
  try {
    hubSysLog_('asa-hub:commbroadcast', 'broadcast_pass',
               String(row.id) + ' · ' + String(row.audience_label || '') + ' · by ' + String(row.by_name || '') +
               ' · ' + String(row.state) + ' · ' + commBroadcastEnding_(commBroadcastTally_(row)) +
               (row.pending ? ' · ' + row.pending + ' pending' : ''), { status: 200 });
  } catch (eS) { /* the row carries it */ }
}

function commBroadcastClaim_(id, allowed) {
  var lock = null;
  try { lock = LockService.getScriptLock(); if (!lock.tryLock(10000)) lock = null; } catch (eL) { lock = null; }
  if (!lock) return { refused: 'another broadcast pass holds the lock — try again in a moment', busy: true };
  try {
    var row = commBroadcastFind_(id);
    if (!row) return { refused: 'no broadcast with that id' };
    var state = commBroadcastState_(row, Date.now());
    if (allowed.indexOf(state) === -1) return { refused: 'this broadcast is ' + state + ' — nothing to do', row: row };
    row.state = 'sending';
    commBroadcastPut_(row);
    return { row: row };
  } finally {
    try { lock.releaseLock(); } catch (eR) { /* the execution releases it */ }
  }
}

function commBroadcastDialNow_() {
  try { return commDialState_(); } catch (e) { return { word: 'off', readable: false }; }
}

// A broadcast confirmed as a mock never goes real after test mode turns off.
function commBroadcastMockMoved_(row, dial) {
  var stamped = String((row && row.dial) || '');
  var wasMock = String((row && row.test_mode) || '') === 'on' || (stamped !== '' && !commDialHandsOver_(stamped));
  if (!wasMock) return '';
  if (!dial || dial.readable === false || !commDialHandsOver_(dial.word)) return '';
  return 'Confirmed while test mode was on, and test mode is off now — the rest was never sent, so a line ' +
         'written as a test cannot reach real phones; write it again to send it to people';
}

function commBroadcastStop_(row, why, eachWhy) {
  row.state = 'stopped';
  (row.recipients || []).forEach(function (r) {
    if (String(r.o || 'pending') === 'pending') { r.o = 'held'; r.w = String(eachWhy || why).slice(0, 120); }
  });
  commBroadcastTally_(row);
  row.why = String(why || '');
  row.finished_at = new Date().toISOString();
}

// The script cache may drop a receipt early, so it is trusted for less than its TTL.
var COMM_BROADCAST_RECEIPT_MARGIN_MS = 30 * 60 * 1000;

function commBroadcastReceiptsGone_(row, state, nowMs) {
  if (state !== 'interrupted') return false;
  var at = Date.parse(String(row.updatedAt || row.createdAt || ''));
  var ttlMs = ((typeof RPC_RECEIPT_TTL_S !== 'undefined') ? Number(RPC_RECEIPT_TTL_S) : 21600) * 1000;
  return !isNaN(at) && (Number(nowMs) || Date.now()) - at > ttlMs - COMM_BROADCAST_RECEIPT_MARGIN_MS;
}

function commBroadcastReceiptsGoneWhy_(row) {
  var pending = (row.recipients || []).filter(function (r) { return String(r.o || 'pending') === 'pending'; }).length;
  var unsure = Math.min(pending, COMM_BROADCAST_MARK_EVERY - 1);
  var ttlMs = ((typeof RPC_RECEIPT_TTL_S !== 'undefined') ? Number(RPC_RECEIPT_TTL_S) : 21600) * 1000;
  var hours = Math.round((ttlMs - COMM_BROADCAST_RECEIPT_MARGIN_MS) / 360000) / 10;
  return 'This pass was cut short more than ' + hours + ' hours ago, and the receipts that stop a second text have ' +
         'expired — up to ' + unsure + ' of the ' + pending + ' not marked may already have it, so it is not ' +
         'continued. Withdraw it, and reach the rest another way if it still matters.';
}

function commBroadcastMask_(to) {
  return (typeof rpcMaskTo_ === 'function') ? rpcMaskTo_(to) : '•••' + String(to || '').slice(-4);
}

// The page gets names and last four digits; full numbers stay in the house.
function commBroadcastPublic_(row, who, withRecipients) {
  var recipients = Array.isArray(row.recipients) ? row.recipients : [];
  var mine = !!who && String(row.by_email || '').toLowerCase() === String(who.email || '');
  var state = commBroadcastState_(row, Date.now());
  var t = { sent: 0, recorded: 0, held: 0, refused: 0, failed: 0, pending: 0, withdrawn: 0 };
  recipients.forEach(function (r) {
    var o = String(r.o || 'pending');
    if (Object.prototype.hasOwnProperty.call(t, o)) t[o]++;
  });
  var may = mine || !!(who && who.above);
  var quietNow = false;
  try { quietNow = (typeof hubQuietAt_ === 'function') && hubQuietAt_(); } catch (eQ) { quietNow = false; }
  var live = ['held_quiet', 'carrying', 'partial', 'interrupted'].indexOf(state) !== -1 && t.pending > 0;
  var mockMoved = live ? commBroadcastMockMoved_(row, commBroadcastDialNow_()) : '';
  var receiptsGone = live && !mockMoved && commBroadcastReceiptsGone_(row, state, Date.now());
  var holdWhy = mockMoved || (receiptsGone ? commBroadcastReceiptsGoneWhy_(row) : '');
  var dropped = row.dropped;
  if (typeof dropped === 'string') { try { dropped = JSON.parse(dropped || '[]'); } catch (eD) { dropped = []; } }
  return {
    id: String(row.id), at: String(row.createdAt || ''), updated_at: String(row.updatedAt || ''),
    by_name: String(row.by_name || ''), mine: mine,
    audience: String(row.audience || ''), audience_label: String(row.audience_label || ''),
    house: String(row.house || ''), meddel: String(row.meddel || '') === 'yes',
    message: String(row.message || ''), signature: String(row.signature || ''),
    body_sample: String(row.body_sample || ''),
    state: state, count: recipients.length, tally: t,
    test_mode: String(row.test_mode || ''), dial: String(row.dial || ''),
    why: String(row.why || ''), warnings: String(row.warnings || ''),
    dropped: (Array.isArray(dropped) ? dropped : []).map(function (d) {
      return { reason: String(d.reason || ''), label: String(d.label || ''), count: Number(d.count) || 0 };
    }),
    withdrawn_by: String(row.withdrawn_by || ''), withdrawn_at: String(row.withdrawn_at || ''),
    hold_why: holdWhy,
    can_continue: may && t.pending > 0 && !quietNow && !holdWhy &&
                  ['partial', 'interrupted', 'carrying'].indexOf(state) !== -1,
    can_withdraw: may && t.pending > 0 &&
                  ['held_quiet', 'carrying', 'partial', 'interrupted'].indexOf(state) !== -1,
    can_resend: may && (state === 'stopped' || !!mockMoved),
    recipients: withRecipients ? recipients.map(function (r) {
      return { name: String(r.n || ''), to: commBroadcastMask_(r.t), from: String(r.f || ''),
               outcome: String(r.o || 'pending'), why: String(r.w || '') };
    }) : []
  };
}

function commBroadcastPreviewOut_(spec, aud, sit, who) {
  var def = COMM_BROADCAST_AUDIENCES[spec.audience] || {};
  var sampleRow = { message: spec.message, signature: spec.signature, by_name: who.name, house: spec.house,
                    audience_label: aud.label };
  var first = aud.entries[0] || null;
  var sample = sit ? commBroadcastRender_(sit.sms_text,
    commBroadcastVars_(sampleRow, first ? { n: first.name, g: first.group } : { n: '' })) : '';
  var longest = sit ? commBroadcastLongest_(sit, sampleRow, aud.entries) : '';
  var hits = def.staff ? commBroadcastReasonHits_(spec.message + '\n' + spec.signature) : [];
  return {
    audience: spec.audience, audience_label: aud.label, house: spec.house,
    house_label: spec.house ? commCallOffHouseLabel_(spec.house) : '', meddel: spec.meddel,
    readable: !!aud.readable, refused: String(aud.refused || ''), why: aud.why, notes: aud.notes,
    count: aud.entries.length, cap: COMM_BROADCAST_MAX, over_cap: aud.entries.length > COMM_BROADCAST_MAX,
    recipients: aud.entries.map(function (e) {
      return { name: e.name || (e.from.indexOf('cc') === 0 ? 'Cc cell' : ''), to: commBroadcastMask_(e.to),
               from: e.from };
    }),
    dropped: aud.dropped,
    audience_sha: commBroadcastSha_(aud.entries),
    sample: sample, chars: longest.length, too_long: longest.length > COMM_BROADCAST_SMS_MAX,
    reason_words: hits,
    situation: commBroadcastSituationState_(),
    mode: commBroadcastMode_()
  };
}

/** The page's one read; anybody signed in may ask, and the answer says who may send. */
HUB_POLICY.staffBroadcastBoard = {
  file: 'CommBroadcast.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  // Every signed-in session may ask; the handler decides by badge.
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.staffBroadcastBoard = function (payload, user) {
  var who = commBroadcastWho_(user);
  var out = {
    can_send: who.ok, above: who.above, hm: who.hm, master: who.master, why: who.why, name: who.name,
    audiences: [], houses: [], own_houses_via: '',
    situation: null, mode: null, house_ready: false,
    calendar: { readable: false, why: '', from: '' },
    limits: { text_min: COMM_BROADCAST_TEXT_MIN, text_max: COMM_BROADCAST_TEXT_MAX,
              signature_max: COMM_BROADCAST_SIGNATURE_MAX, cap: COMM_BROADCAST_MAX },
    history: [], history_error: ''
  };
  if (!who.ok) return { status: 200, data: out };
  out.situation = commBroadcastSituationState_();
  out.mode = commBroadcastMode_();
  out.house_ready = commBroadcastHouseReady_();
  var cal = commBroadcastCalendar_();
  out.calendar = { readable: !!cal.readable, why: String(cal.why || ''), from: String(cal.from || '') };
  var own = who.above ? null : commBroadcastOwnHouses_(user, cal);
  if (own) out.own_houses_via = own.via;
  var locations = who.above ? (cal.order || []) : (own ? own.houses : []);
  out.houses = locations.filter(function (loc) { return !!(cal.houses || {})[loc]; }).map(function (loc) {
    var h = cal.houses[loc];
    return { location: loc, label: h.label, people: h.people.length,
             meddel: h.people.filter(function (p) { return p.meddel; }).length };
  });
  Object.keys(COMM_BROADCAST_AUDIENCES).forEach(function (id) {
    var def = COMM_BROADCAST_AUDIENCES[id];
    var allowed = who.above || def.hm;
    var why = '';
    if (!allowed) why = def.label + ' is sent by a director, team lead, administrator or the master.';
    else if (id === 'house' && !out.houses.length) {
      allowed = false;
      why = !cal.readable ? String(cal.why || 'the calendar could not be read')
          : who.above ? 'the calendar lists no house in the window it reads'
          : 'the calendar names you as the manager of no house in the window it reads';
    }
    out.audiences.push({ id: id, label: def.label, allowed: allowed, why: why });
  });
  try {
    var rows = commBroadcastRows_().filter(function (r) {
      return who.above || String(r.by_email || '').toLowerCase() === who.email;
    });
    rows.sort(function (a, b) { return String(a.createdAt) < String(b.createdAt) ? 1 : -1; });
    out.history = rows.slice(0, COMM_BROADCAST_HISTORY).map(function (r) {
      if (!Array.isArray(r.recipients)) {
        try { r.recipients = JSON.parse(String(r.recipients || '[]')); } catch (eJ) { r.recipients = []; }
      }
      return commBroadcastPublic_(r, who, true);
    });
  } catch (eH) {
    out.history_error = String((eH && eH.message) || eH).slice(0, 200);
  }
  return { status: 200, data: out };
};

/** The preview: recipients, exclusions, the rendered message, warnings. */
HUB_POLICY.staffBroadcastPreview = {
  file: 'CommBroadcast.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  params: { audience: { required: true, type: 'string' }, message: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.staffBroadcastPreview = function (payload, user) {
  var who = commBroadcastWho_(user);
  if (!who.ok) return commBroadcastDenied_(who);
  var spec = commBroadcastSpec_(payload);
  var problem = commBroadcastTextProblem_(spec.message, spec.signature);
  if (problem) return { status: 400, message: problem };
  var sit = commBroadcastSituation_();
  var aud = commBroadcastResolve_(spec, who, user, sit);
  if (aud.refused) return { status: 403, message: aud.refused };
  return { status: 200, data: commBroadcastPreviewOut_(spec, aud, sit, who) };
};

/** The send: re-resolves and refuses a changed audience, writes the row first, then one door per copy. */
HUB_POLICY.staffBroadcastSend = {
  file: 'CommBroadcast.gs', lane: 'tool', store: 'sheet',
  // The same client_id is the same broadcast: a second press answers the first.
  idempotent: true, cost: 'minutes',
  roles: [],
  params: { audience: { required: true, type: 'string' }, message: { required: true, type: 'string' },
            client_id: { required: true, type: 'string' }, audience_sha: { required: true, type: 'string' } },
  invalidates: [], emits: ['smsSend']
};
HUB_ACTIONS.staffBroadcastSend = function (payload, user) {
  var who = commBroadcastWho_(user);
  if (!who.ok) return commBroadcastDenied_(who);
  var spec = commBroadcastSpec_(payload);
  var problem = commBroadcastTextProblem_(spec.message, spec.signature);
  if (problem) return { status: 400, message: problem };
  var clientId = String((payload && payload.client_id) || '').trim();
  if (clientId.length < 8) return { status: 400, message: 'The page sends its own key with a broadcast; this one carried none.' };
  var sit = commBroadcastSituation_();
  if (!sit) return { status: 409, message: commBroadcastSituationState_().why };
  if (!commBroadcastHouseReady_()) {
    return { status: 503, message: 'The broadcast house is not minted yet, and a broadcast is never sent without ' +
                                   'its row — tools/mint_comm_broadcasts_house.py mints it.' };
  }
  var dial = { word: 'off', readable: false };
  try { dial = commDialState_(); } catch (eD) { dial = { word: 'off', readable: false }; }
  if (!dial.readable) {
    return { status: 503, message: 'The test-mode switch could not be read, and a broadcast does not go out on a ' +
                                   'guess — try again in a minute.' };
  }
  var id = commBroadcastId_(who.email, clientId);
  var existing = null;
  try { existing = commBroadcastFind_(id); } catch (eF) {
    return { status: 503, message: 'The broadcast house could not be read: ' + String((eF && eF.message) || eF) };
  }
  if (existing) return commBroadcastAlready_(existing, spec, who);
  var aud = commBroadcastResolve_(spec, who, user, sit);
  if (aud.refused) return { status: 403, message: aud.refused };
  if (!aud.readable) return { status: 503, message: aud.why.join(' · ') || 'the audience could not be resolved' };
  if (!aud.entries.length) return { status: 409, message: 'This audience resolves to nobody this platform may text.' };
  if (aud.entries.length > COMM_BROADCAST_MAX) {
    return { status: 409, message: aud.entries.length + ' recipients is over the ' + COMM_BROADCAST_MAX +
                                   ' this lane allows — a resolver that went wrong, never a list that grew.' };
  }
  if (commBroadcastSha_(aud.entries) !== String((payload && payload.audience_sha) || '')) {
    return { status: 200, data: { changed: true, sent_nothing: true,
                                  preview: commBroadcastPreviewOut_(spec, aud, sit, who) } };
  }
  var rowShape = { message: spec.message, signature: spec.signature, by_name: who.name, house: spec.house,
                   audience_label: aud.label };
  var longest = commBroadcastLongest_(sit, rowShape, aud.entries);
  if (longest.length > COMM_BROADCAST_SMS_MAX) {
    return { status: 400, message: 'With the words on the Desk around it the text would be ' + longest.length +
                                   ' characters, over the provider\'s ' + COMM_BROADCAST_SMS_MAX + '. Shorten it.' };
  }
  var def = COMM_BROADCAST_AUDIENCES[spec.audience];
  var warnings = def.staff ? commBroadcastReasonHits_(spec.message + '\n' + spec.signature) : [];
  var recipients = aud.entries.map(function (e) {
    var r = { n: e.name, t: e.to, k: e.key, f: e.from, o: 'pending' };
    if (e.group) r.g = 1;
    return r;
  });
  var row = {
    id: id, client_id: clientId, by_email: who.email, by_name: who.name, by_badges: who.badges.join(','),
    audience: spec.audience, audience_label: aud.label, house: spec.house, meddel: spec.meddel ? 'yes' : '',
    message: spec.message, signature: spec.signature,
    body_sample: commBroadcastRender_(sit.sms_text, commBroadcastVars_(rowShape, recipients[0])),
    state: 'sending', test_mode: (commBroadcastMode_().test_mode), dial: String(dial.word),
    why: '', warnings: warnings.join(', '),
    dropped: aud.dropped.map(function (d) { return { reason: d.reason, label: d.label, count: d.count }; }),
    recipients: recipients, next_index: 0, audience_sha: commBroadcastSha_(aud.entries)
  };
  commBroadcastTally_(row);
  var lock = null;
  try { lock = LockService.getScriptLock(); if (!lock.tryLock(10000)) lock = null; } catch (eL) { lock = null; }
  if (!lock) return { status: 409, message: 'Another broadcast is being written at this moment — try again.' };
  try {
    var twin = commBroadcastFind_(id);
    if (twin) return commBroadcastAlready_(twin, spec, who);
    commBroadcastPut_(row);
  } catch (eW) {
    return { status: 503, message: 'The broadcast row could not be written, so nothing was sent: ' +
                                   String((eW && eW.message) || eW) };
  } finally {
    try { lock.releaseLock(); } catch (eR) { /* the execution releases it */ }
  }
  var quietNow = false;
  try { quietNow = hubQuietAt_(); } catch (eQ) { quietNow = false; }
  var run = { asked: 0, quiet: false, stopped: '', sent_any: false };
  if (quietNow) {
    commBroadcastHoldForMorning_(row);
  } else {
    run = commBroadcastSendLoop_(row, sit, COMM_BROADCAST_BUDGET_MS);
    if (run.quiet) commBroadcastHoldForMorning_(row);
  }
  commBroadcastSafePut_(row);
  commBroadcastAfterPass_(row, run);
  return { status: 200, data: { broadcast: commBroadcastPublic_(row, who, true) } };
};

/** Continue from where a stopped pass stopped; the sender or anybody above. */
HUB_POLICY.staffBroadcastContinue = {
  file: 'CommBroadcast.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: [],
  params: { id: { required: true, type: 'string' } },
  invalidates: [], emits: ['smsSend']
};
HUB_ACTIONS.staffBroadcastContinue = function (payload, user) {
  var who = commBroadcastWho_(user);
  if (!who.ok) return commBroadcastDenied_(who);
  var id = String((payload && payload.id) || '').trim();
  var row = null;
  try { row = commBroadcastFind_(id); } catch (eF) {
    return { status: 503, message: 'The broadcast house could not be read: ' + String((eF && eF.message) || eF) };
  }
  if (!row) return { status: 404, message: 'No broadcast with that id.' };
  if (!who.above && String(row.by_email || '').toLowerCase() !== who.email) {
    return { status: 403, message: 'Only the person who wrote it, or a director, team lead, administrator or the ' +
                                   'master, may continue a broadcast.' };
  }
  var sit = commBroadcastSituation_();
  if (!sit) return { status: 409, message: commBroadcastSituationState_().why };
  var dial = { word: 'off', readable: false };
  try { dial = commDialState_(); } catch (eD) { dial = { word: 'off', readable: false }; }
  if (!dial.readable) {
    return { status: 503, message: 'The test-mode switch could not be read, and a broadcast does not go out on a ' +
                                   'guess — try again in a minute.' };
  }
  var quietNow = false;
  try { quietNow = hubQuietAt_(); } catch (eQ) { quietNow = false; }
  if (quietNow) {
    return { status: 409, message: 'Inside the quiet window (' + hubQuietWords_() + ') nothing reaches a person — ' +
                                   'continue after ' + HUB_QUIET_TO + '.' };
  }
  // Read before the claim, which overwrites the state.
  var seenMs = Date.now();
  if (commBroadcastReceiptsGone_(row, commBroadcastState_(row, seenMs), seenMs)) {
    return { status: 200, data: { refused: commBroadcastReceiptsGoneWhy_(row),
                                  broadcast: commBroadcastPublic_(row, who, true) } };
  }
  var claim = commBroadcastClaim_(id, ['partial', 'interrupted', 'carrying']);
  if (claim.refused) {
    return { status: 200, data: { refused: claim.refused,
                                  broadcast: claim.row ? commBroadcastPublic_(claim.row, who, true) : null } };
  }
  row = claim.row;
  var moved = commBroadcastMockMoved_(row, dial);
  if (moved) {
    commBroadcastStop_(row, moved, 'confirmed while test mode was on — never sent');
    commBroadcastSafePut_(row);
    commBroadcastAfterPass_(row, null);
    return { status: 200, data: { refused: moved, broadcast: commBroadcastPublic_(row, who, true) } };
  }
  var run = commBroadcastSendLoop_(row, sit, COMM_BROADCAST_BUDGET_MS);
  if (run.quiet) commBroadcastHoldForMorning_(row);
  commBroadcastSafePut_(row);
  commBroadcastAfterPass_(row, run);
  return { status: 200, data: { broadcast: commBroadcastPublic_(row, who, true) } };
};

/** Withdraw: recipients not yet asked are never asked. */
HUB_POLICY.staffBroadcastWithdraw = {
  file: 'CommBroadcast.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  params: { id: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.staffBroadcastWithdraw = function (payload, user) {
  var who = commBroadcastWho_(user);
  if (!who.ok) return commBroadcastDenied_(who);
  var id = String((payload && payload.id) || '').trim();
  var lock = null;
  try { lock = LockService.getScriptLock(); if (!lock.tryLock(10000)) lock = null; } catch (eL) { lock = null; }
  if (!lock) return { status: 409, message: 'A broadcast pass holds the lock — try again in a moment.' };
  var row = null;
  try {
    row = commBroadcastFind_(id);
    if (!row) return { status: 404, message: 'No broadcast with that id.' };
    if (!who.above && String(row.by_email || '').toLowerCase() !== who.email) {
      return { status: 403, message: 'Only the person who wrote it, or a director, team lead, administrator or the ' +
                                     'master, may withdraw a broadcast.' };
    }
    var state = commBroadcastState_(row, Date.now());
    if (['held_quiet', 'carrying', 'partial', 'interrupted'].indexOf(state) === -1) {
      return { status: 200, data: { refused: 'this broadcast is ' + state + ' — there is nothing left to withdraw',
                                    broadcast: commBroadcastPublic_(row, who, true) } };
    }
    (row.recipients || []).forEach(function (r) {
      if (String(r.o || 'pending') === 'pending') { r.o = 'withdrawn'; r.w = 'withdrawn before it was sent'; }
    });
    row.state = 'withdrawn';
    row.withdrawn_by = who.name;
    row.withdrawn_at = new Date().toISOString();
    var t = commBroadcastTally_(row);
    row.why = 'withdrawn by ' + who.name + ' — ' + t.withdrawn + ' never asked' +
              (t.sent || t.recorded ? ' · before that: ' + commBroadcastEnding_(t) : '');
    commBroadcastPut_(row);
  } catch (eW) {
    return { status: 503, message: 'The broadcast could not be withdrawn: ' + String((eW && eW.message) || eW) };
  } finally {
    try { lock.releaseLock(); } catch (eR) { /* the execution releases it */ }
  }
  try {
    hubSysLog_('asa-hub:commbroadcast', 'broadcast_withdrawn', String(row.id) + ' · ' + row.why, { status: 200 });
  } catch (eS) { /* the row carries it */ }
  return { status: 200, data: { broadcast: commBroadcastPublic_(row, who, true) } };
};

function commBroadcastQuietCarry_(data) {
  var id = String((data && data.id) || '');
  var again = function (why) {
    var kept = false;
    try { kept = hubQuietOwe_('broadcast', id, { id: id }); } catch (eO) { kept = false; }
    return kept ? { state: 'carried', why: why + ' — kept for the next pass' }
                : { state: 'stale', why: why + ' — and the list could not keep it' };
  };
  var withdrawnWhy = function (r) {
    return 'withdrawn by ' + String(r.withdrawn_by || 'its author') + ' — nobody was contacted';
  };
  var row = null;
  try { row = commBroadcastFind_(id); } catch (eF) {
    return again('the broadcast house could not be read (' + String((eF && eF.message) || eF).slice(0, 80) + ')');
  }
  if (!row) return { state: 'stale', why: 'the broadcast is no longer in its house' };
  if (String(row.state) === 'withdrawn') return { state: 'stale', why: withdrawnWhy(row) };
  if (['held_quiet', 'carrying'].indexOf(String(row.state)) === -1) {
    return { state: 'stale', why: 'nothing left to carry — it is ' + String(row.state) };
  }
  var dial = commBroadcastDialNow_();
  if (!dial.readable) return again('the test-mode switch could not be read');
  var claim = null;
  try { claim = commBroadcastClaim_(id, ['held_quiet', 'carrying']); } catch (eC) {
    return again('the broadcast house could not be read (' + String((eC && eC.message) || eC).slice(0, 80) + ')');
  }
  if (claim.refused) {
    if (claim.busy) return again(claim.refused);
    if (!claim.row) return { state: 'stale', why: claim.refused };
    var nowState = commBroadcastState_(claim.row, Date.now());
    if (nowState === 'withdrawn') return { state: 'stale', why: withdrawnWhy(claim.row) };
    return { state: 'stale', why: 'nothing left to carry — it is ' + nowState };
  }
  row = claim.row;
  var sit = commBroadcastSituation_();
  if (!sit) {
    commBroadcastStop_(row, 'the situation `' + COMM_BROADCAST_SITUATION + '` was switched off or lost its words ' +
                            'overnight — nobody was contacted', 'the row was switched off overnight');
    commBroadcastSafePut_(row);
    return { state: 'stale', why: row.why };
  }
  var moved = commBroadcastMockMoved_(row, dial);
  if (moved) {
    commBroadcastStop_(row, moved, 'confirmed while test mode was on — never sent');
    commBroadcastSafePut_(row);
    commBroadcastAfterPass_(row, null);
    return { state: 'stale', why: row.why };
  }
  var run = commBroadcastSendLoop_(row, sit, COMM_BROADCAST_CARRY_BUDGET_MS);
  if (row.state === 'partial') {
    var kept = false;
    try { kept = hubQuietOwe_('broadcast', id, { id: id }); } catch (eK) { kept = false; }
    row.state = kept ? 'carrying' : 'partial';
    row.why = kept ? row.pending + ' still to send — the next hotline pass continues it'
                   : row.pending + ' still to send — press Continue to finish it';
  } else if (run.quiet) {
    commBroadcastHoldForMorning_(row);
  }
  commBroadcastSafePut_(row);
  commBroadcastAfterPass_(row, run);
  return { state: 'carried', why: String(row.id) + ': ' + commBroadcastEnding_(commBroadcastTally_(row)) };
}
