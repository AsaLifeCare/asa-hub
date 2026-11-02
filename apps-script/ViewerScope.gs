// Who a released profile app answers, and how far it may see.
// The master sees everything; a CLIENT their own record; a GUARDIAN the clients the SSA records name them for, and…

var HUB_VIEWER_DAYS_PROP = 'HUB_VIEWER_RECENT_DAYS';
var HUB_VIEWER_DAYS_DEFAULT = 30;
// Badges that narrow a viewer rather than widen one; a visit keeps the visited account's.
var HUB_VIEWER_NARROW = ['GUARDIAN', 'CLIENT'];
// The only words that open an app to a narrowed viewer; App Control releases to SSAs by GUARDIAN.
var HUB_VIEWER_OPENS = { client: ['CLIENT'], guardian: ['CLIENT', 'GUARDIAN'], ssa: ['GUARDIAN'] };
// Narrowed kinds, narrowest first: a scope merged from several is named by the widest.
var HUB_VIEWER_KIND_RANK = ['client', 'guardian', 'ssa'];
// Per execution; hubPropsBoot_ drops it.
var HUB_VIEWER_MEMO = null;

function hubViewerMemo_() {
  if (!HUB_VIEWER_MEMO) HUB_VIEWER_MEMO = { scope: {}, staff: {} };
  return HUB_VIEWER_MEMO;
}

function hubViewerScopeOf_(kind, why) {
  return { kind: kind, client_keys: [], house_codes: [], ssa_keys: [], family_keys: [], why: why || '' };
}

function hubViewerWhy_(what, e) {
  return what + ' could not be read (' + String((e && e.message) || e).slice(0, 120) + ').';
}

/** How many days back a shift or punch at a house still counts; the script property, else 30. */
function hubViewerDays_() {
  var raw = '';
  try { raw = str_(hubProp_(HUB_VIEWER_DAYS_PROP)); } catch (e) { raw = ''; }
  var n = /^\d{1,3}$/.test(raw) ? Number(raw) : 0;
  return n >= 1 && n <= 366 ? n : HUB_VIEWER_DAYS_DEFAULT;
}

/** The account's own live users row; null when there is none. Throws when the accounts cannot be read. */
function hubViewerRowOf_(id) {
  var row = null;
  (usersAll_() || []).forEach(function (u) {
    if (!row && str_(u.userid) === str_(id) && !str_(u.mergedinto)) row = u;
  });
  return row;
}

// FAIL-CLOSED: whose view a request is — the session's own account, or during a visit the visited account read from…
function hubViewerOf_(user) {
  if (!user || user.is_service) return null;
  var visit = str_(user.visiting_member);
  var ctx = (typeof HUB_MEMBER_CTX !== 'undefined') ? HUB_MEMBER_CTX : null;
  if (!visit) {
    if (ctx) return null;
    return { user: user, client_key: hubClientKeyOf_(user),
             denials: Array.isArray(user.app_denials) ? user.app_denials : [] };
  }
  var row = null;
  try { row = hubViewerRowOf_(user.id); } catch (e) { return null; }
  if (!row) return null;
  var types = userTypesFromRaw_(user.types).types;
  userTypesFromRaw_(row.types).types.forEach(function (t) {
    if (HUB_VIEWER_NARROW.indexOf(t) !== -1 && types.indexOf(t) === -1) types.push(t);
  });
  var denials = [];
  try { denials = JSON.parse(str_(row.appdenials) || '[]'); } catch (eD) { denials = []; }
  return {
    user: { id: str_(user.id), email: str_(row.email) || str_(user.email),
            display_name: str_(row.displayname) || str_(user.display_name), role: str_(user.role),
            types: types, home_tenant: str_(user.home_tenant), visiting_member: visit },
    client_key: str_(user.role) === 'client' ? str_(row.clientkey) : '',
    denials: Array.isArray(denials) ? denials : []
  };
}

// The display name an account may be matched by, read from its own row: { known, name, self, why }.
function hubViewerNamed_(u) {
  var row;
  try { row = hubViewerRowOf_(u && u.id); } catch (e) {
    return { known: false, name: '', self: false, why: hubViewerWhy_('The accounts', e) };
  }
  if (!row) {
    return { known: false, name: '', self: false, why: 'This account\'s own row could not be found, so its name ' +
                                                       'matches nothing.' };
  }
  return { known: true, name: str_(row.displayname), self: complianceDocsSelfNamed_(row), why: '' };
}

/** The houses these clients live in now, as Locations counts a house's current clients. */
function hubViewerHousesOf_(keys) {
  var out = { codes: [], why: [] };
  var rows;
  try { rows = locationsClientRows_(); } catch (e) { out.why.push(hubViewerWhy_('The client records', e)); return out; }
  var homes = null;
  try { homes = locationsHomes_(); } catch (eH) { out.why.push(hubViewerWhy_('The house registry', eH)); }
  out.codes = hubViewerHousesFrom_(keys, rows, homes);
  return out;
}

/** hubViewerHousesOf_ over client rows and a house registry already read: the sorted house codes. */
function hubViewerHousesFrom_(keys, rows, homes) {
  var want = {};
  (keys || []).forEach(function (k) { if (k) want[k] = true; });
  var mine = (rows || []).filter(function (c) { return want[c.client_key] && locationsClientCurrent_(c); });
  var codes = {};
  mine.forEach(function (c) { var hc = locationsHouseCode_(c.house); if (hc) codes[hc] = true; });
  (homes || []).forEach(function (h) {
    if (h && h.code && !codes[h.code] && locationsClientsAt_(h.code, h, mine).length) codes[h.code] = true;
  });
  return Object.keys(codes).sort();
}

/** The SSAs whose records name these clients while they are live (clientLive_). */
function hubViewerSsasOf_(keys) {
  var out = { keys: [], why: [] };
  var want = {};
  (keys || []).forEach(function (k) { if (k) want[k] = true; });
  var idx;
  try { idx = ssaIndex_(); } catch (e) { out.why.push(hubViewerWhy_('The SSA records', e)); return out; }
  Object.keys(idx.ssas || {}).forEach(function (k) {
    var live = (idx.ssas[k].clients || []).some(function (c) { return clientLive_(c) && want[c.client_key]; });
    if (live) out.keys.push(k);
  });
  out.keys.sort();
  return out;
}

/** 'fam_' + the folded name, as the Families app keys a family member; '' for a blank or a non-person. */
function hubViewerFamilyKey_(name) {
  var n = locationsText_(guardianDisplayName_(name), 120);
  if (!n || !guardianIsPerson_(n)) return '';
  var fold = clientNameKey_(n);
  return fold.length >= 3 ? 'fam_' + fold : '';
}

/** The family key of the guardian the ward's own record names: its Hub row, else its Asa Client Database row. */
function hubViewerWardGuardianKey_(clientKey) {
  var row = null;
  (clientsDerived_(null) || []).forEach(function (c) {
    if (!row && str_(c.client_key) === str_(clientKey)) row = c;
  });
  if (!row) return '';
  var raw = locationsText_(row.guardianName || row.guardian_name, 200);
  if (!raw) {
    var m = (cpMasterIndex_().rows || {})[clientNameKey_(row.name)];
    raw = m && !m.ambiguous ? locationsText_((m.fields || {}).guardian_name, 200) : '';
  }
  return hubViewerFamilyKey_(raw);
}

/** The family record that is a guardian's own: the one the ward's record names, when the account carries that name. */
function hubViewerFamilyOf_(v) {
  var named = hubViewerNamed_(v.user);
  if (!named.known) return { keys: [], why: named.why };
  if (named.self) return { keys: [], why: 'This account chose its name itself, so no family record is its own.' };
  var mine = hubViewerFamilyKey_(named.name);
  if (!mine) {
    return { keys: [], why: 'This account\'s name is not a family member\'s name, so no family record is its own.' };
  }
  var ward;
  try { ward = hubViewerWardGuardianKey_(v.client_key); } catch (e) {
    return { keys: [], why: hubViewerWhy_('The ward\'s record', e) };
  }
  if (ward !== mine) {
    return { keys: [], why: 'The ward\'s record does not name this account as its guardian, so no family record is ' +
                            'its own.' };
  }
  return { keys: [mine], why: '' };
}

function hubViewerClientScope_(kind, v) {
  if (!v.client_key) {
    return hubViewerScopeOf_('none', 'This account is not linked to a client, so it is shown nothing.');
  }
  var out = hubViewerScopeOf_(kind);
  out.client_keys = [v.client_key];
  var houses = hubViewerHousesOf_(out.client_keys);
  var ssas = hubViewerSsasOf_(out.client_keys);
  out.house_codes = houses.codes;
  out.ssa_keys = ssas.keys;
  var why = houses.why.concat(ssas.why);
  if (kind === 'guardian') {
    var fam = hubViewerFamilyOf_(v);
    out.family_keys = fam.keys;
    if (fam.why) why.push(fam.why);
  }
  out.why = why.join(' ');
  return out;
}

/** Live accounts other than this one. */
function hubViewerOthers_(v) {
  return (usersAll_() || []).filter(function (u) {
    if (!u || str_(u.userid) === str_(v.id) || str_(u.mergedinto)) return false;
    var off = str_(u.active).toUpperCase();
    return off !== 'FALSE' && off !== '0' && off !== 'NO';
  });
}

// Whether a GUARDIAN's name makes it an SSA: { is: 'ssa', key, clients } when exactly one SSA on fully read records…
function hubViewerSsaByName_(v, idx) {
  var named = hubViewerNamed_(v);
  if (!named.known) return { is: 'unknown', why: named.why };
  if (idx.degraded) {
    return { is: 'unknown', why: 'Not every client record could be read, so whether this account is an SSA cannot ' +
                                 'be told.' };
  }
  var key = ssaKeyOf_(named.name);
  var s = key ? (idx.ssas || {})[key] : null;
  if (!s) return { is: 'family' };
  var no = function (why) {
    return { is: 'unknown', why: why + ', so it is not matched by name and is shown nothing.' };
  };
  if (named.self) return no('This account chose its name itself and an SSA on the records carries it');
  var mails = s.emails || [];
  if (mails.length > 1 || (s.phones || []).length > 1) {
    return no('More than one SSA on the records may carry this name');
  }
  var others;
  try { others = hubViewerOthers_(v); } catch (e) { return { is: 'unknown', why: hubViewerWhy_('The accounts', e) }; }
  var fold = key.slice(4);
  var clash = others.some(function (u) {
    return clientNameKey_(u.displayname) === fold || (!!mails[0] && str_(u.email).toLowerCase() === mails[0]);
  });
  if (clash) return no('Another account carries this name or the SSA\'s e-mail on the records');
  return { is: 'ssa', key: key, clients: (s.clients || []).filter(clientLive_)
                                                        .map(function (c) { return c.client_key; }) };
}

// FAIL-CLOSED: whether a GUARDIAN account is an SSA.
function hubViewerSsaMatch_(v) {
  var idx;
  try { idx = ssaIndex_(); } catch (e) { return { is: 'unknown', why: hubViewerWhy_('The SSA records', e) }; }
  var email = str_(v.email).toLowerCase();
  var keys = {}, clients = {}, stale = false;
  Object.keys(idx.ssas || {}).forEach(function (k) {
    (idx.ssas[k].clients || []).forEach(function (c) {
      if (c.ssa_email === undefined) { stale = true; return; }
      if (!email || c.ssa_email !== email) return;
      keys[k] = true;
      // a client set inactive, or archived, is no longer reached; the SSA keeps its live ones
      if (clientLive_(c)) clients[c.client_key] = true;
    });
  });
  if (stale) return { is: 'unknown', why: 'The SSA records are being refreshed, so nothing is shown yet.' };
  if (!Object.keys(keys).length) {
    var named = hubViewerSsaByName_(v, idx);
    if (named.is !== 'ssa') return named;
    keys[named.key] = true;
    named.clients.forEach(function (k2) { clients[k2] = true; });
  }
  var out = hubViewerScopeOf_('ssa');
  out.ssa_keys = Object.keys(keys).sort();
  out.client_keys = Object.keys(clients).sort();
  var houses = hubViewerHousesOf_(out.client_keys);
  out.house_codes = houses.codes;
  out.why = houses.why.concat(idx.degraded ? (idx.why || []) : []).join(' ');
  return { is: 'ssa', scope: out };
}

// One scope from the narrowed parts that resolved: every key of each, the widest kind, every reason.
function hubViewerScopeMerge_(parts, whys) {
  var kind = '';
  parts.forEach(function (p) {
    if (HUB_VIEWER_KIND_RANK.indexOf(p.kind) > HUB_VIEWER_KIND_RANK.indexOf(kind)) kind = p.kind;
  });
  var out = hubViewerScopeOf_(kind);
  ['client_keys', 'house_codes', 'ssa_keys', 'family_keys'].forEach(function (f) {
    var seen = {};
    parts.forEach(function (p) {
      if (f === 'ssa_keys' && kind === 'ssa' && p.kind !== 'ssa') return;
      (p[f] || []).forEach(function (k) { if (k) seen[k] = true; });
    });
    out[f] = Object.keys(seen).sort();
  });
  var said = [];
  parts.map(function (p) { return p.why; }).concat(whys).forEach(function (w) {
    if (w && said.indexOf(w) === -1) said.push(w);
  });
  out.why = said.join(' ');
  return out;
}

// The scope from the words that count: every badge the viewer wears, or with `rule` only those an App Control row…
function hubViewerScopeBuild_(user, rule) {
  if (!user || user.is_service) return hubViewerScopeOf_('none', 'No person is signed in.');
  var real = false;
  try { real = !!hubIsRealMaster_(user); } catch (e) { real = false; }
  if (real) return hubViewerScopeOf_('master');
  var v = hubViewerOf_(user);
  if (!v) return hubViewerScopeOf_('none', 'Whose view this is could not be told, so nothing is shown.');
  var words = userBadgesWorn_(v.user.types, v.user.role);
  var counted = rule ? words.filter(function (w) { return rule.indexOf(w) !== -1; }) : words;
  var shut = rule ? 'This app is not open to this account\'s badges.'
                  : 'This account wears no badge these apps answer.';
  var opens = function (kind) {
    return HUB_VIEWER_OPENS[kind].some(function (w) { return counted.indexOf(w) !== -1; });
  };
  if (!counted.length) return hubViewerScopeOf_('none', shut);
  var client = str_(v.user.role).toLowerCase() === 'client';
  // the badges ticked on the account, never the word its role reads as: an SSA is GUARDIAN on a staff role
  var ticked = userBadgesWorn_(v.user.types, '');
  var wide = function (w) { return HUB_VIEWER_NARROW.indexOf(w) === -1; };
  if (!client && counted.some(function (w) { return ticked.indexOf(w) !== -1 && wide(w); })) {
    return hubViewerScopeOf_('all');
  }
  var parts = [], whys = [], unlinked = '', ssa = null;
  if (words.indexOf('GUARDIAN') !== -1) {
    ssa = hubViewerSsaMatch_(v.user);
    if (ssa.is === 'unknown') whys.push(ssa.why);
    if (ssa.is === 'ssa' && opens('ssa')) parts.push(ssa.scope);
  }
  if (!client && (!ssa || ssa.is === 'family') && counted.some(wide)) return hubViewerScopeOf_('all');
  // an account's one client link is its own record as a CLIENT and its ward's as family, so family covers the client
  var kind = words.indexOf('GUARDIAN') !== -1 ? 'guardian' : (words.indexOf('CLIENT') !== -1 ? 'client' : '');
  if (kind && opens(kind)) {
    var own = hubViewerClientScope_(kind, v);
    if (own.kind !== 'none') parts.push(own); else unlinked = own.why;
  }
  if (!parts.length) return hubViewerScopeOf_('none', whys.join(' ') || unlinked || shut);
  return hubViewerScopeMerge_(parts, whys);
}

/** hubViewerScope_ for the words `rule` names (null: every word worn), held per viewer and rule for the execution. */
function hubViewerScopeFor_(user, rule) {
  var ctx = (typeof HUB_MEMBER_CTX !== 'undefined') ? HUB_MEMBER_CTX : null;
  var memoKey = '';
  try {
    memoKey = user ? JSON.stringify([str_(user.id), str_(user.email), str_(user.role), user.types || [],
                                     str_(user.client_key), str_(user.display_name), str_(user.visiting_member),
                                     !!user.is_service, ctx ? str_(ctx.memberId) + ':' + str_(ctx.userId) : '',
                                     rule ? rule.slice().sort() : null]) : '';
  } catch (eK) { memoKey = ''; }
  var memo = hubViewerMemo_().scope;
  if (memoKey && memo.hasOwnProperty(memoKey)) return JSON.parse(memo[memoKey]);
  var scope = hubViewerScopeBuild_(user, rule || null);
  if (memoKey) memo[memoKey] = JSON.stringify(scope);
  return scope;
}

// FAIL-CLOSED: { kind: 'master'|'all'|'client'|'guardian'|'ssa'|'none', client_keys, house_codes, ssa_keys…
function hubViewerScope_(user) {
  return hubViewerScopeFor_(user, null);
}

/** App Control's badge and tenant rows, through the cache its own writes retire. Throws when they cannot be read. */
function hubProfileAppRules_() {
  var tv = 'x';
  try { tv = cacheVersion_(APP_TENANT_TAB); } catch (e) { tv = 'x'; }
  return cacheRead_(APP_BADGE_TAB, 'profile_gate_' + tv, hubProfileAppRulesRead_);
}

function hubProfileAppRulesRead_() {
  var ss = ssOpen_(hubId_('HUB_DB_ID'));
  var rules = {}, tenants = {};
  readTabNormalized_(ss, APP_BADGE_TAB).forEach(function (r) {
    var id = str_(r.appid);
    if (id) rules[id] = userTypesFromRaw_(r.badges).types;
  });
  readTabNormalized_(ss, APP_TENANT_TAB).forEach(function (r) {
    var id = str_(r.appid);
    if (id) tenants[id] = str_(r.tenants).split(',').map(function (x) { return x.trim(); }).filter(String);
  });
  return { rules: rules, tenants: tenants };
}

// FAIL-CLOSED: { open, scope } for one app.
function hubProfileAppGate_(appId, user) {
  var id = str_(appId);
  var closed = function (why) { return { open: false, scope: hubViewerScopeOf_('none', why) }; };
  if (!id) return closed('No app was named.');
  if (!user || user.is_service) return closed('No person is signed in.');
  var real = false;
  try { real = !!hubIsRealMaster_(user); } catch (e) { real = false; }
  if (real) return { open: true, scope: hubViewerScopeOf_('master') };
  var v = hubViewerOf_(user);
  if (!v) return closed('Whose view this is could not be told.');
  if (v.denials.indexOf(id) !== -1) return closed('This app was removed from this account in App Control.');
  var got;
  try { got = hubProfileAppRules_(); } catch (eR) { return closed(hubViewerWhy_('App Control', eR)); }
  var rule = ((got && got.rules) || {})[id] || [];
  if (rule.length && hubMyWorkAppsCutFor_(user).indexOf(id) !== -1) rule = [];
  if (!rule.length) return closed('No badge is written for this app in App Control, so it is the master\'s alone.');
  var tenants = ((got && got.tenants) || {})[id] || [];
  var home = str_(v.user.home_tenant);
  if (home && tenants.length && tenants.indexOf(home) === -1) {
    return closed('This app is not installed for this account\'s home tenant.');
  }
  var scope = hubViewerScopeFor_(user, rule);
  return { open: scope.kind !== 'none', scope: scope };
}

// { keys, why }: the folded staff names with an IST record at one of these houses, or on its Calendar Archive or…
function hubStaffVisibleForHouses_(houseCodes, days) {
  var codes = [];
  (Array.isArray(houseCodes) ? houseCodes : [houseCodes]).forEach(function (c) {
    var hc = locationsHouseCode_(c);
    if (hc && codes.indexOf(hc) === -1) codes.push(hc);
  });
  codes.sort();
  var n = (days === undefined || days === null || days === '') ? hubViewerDays_() : Number(days);
  if (!(n >= 0 && n <= 3660) || Math.floor(n) !== n) n = hubViewerDays_();
  if (!codes.length) return { keys: [], why: '' };
  var today = locationsToday_();
  var memo = hubViewerMemo_().staff, memoKey = codes.join(',') + '|' + n + '|' + today;
  if (memo.hasOwnProperty(memoKey)) return JSON.parse(memo[memoKey]);
  var since = locationsDayShift_(today, -n);
  var want = {}, seen = {}, why = [];
  codes.forEach(function (c) { want[c] = true; });
  try {
    (locationsIstRows_() || []).forEach(function (r) {
      if (!want[locationsHouseCode_(r.house)]) return;
      var name = locationsText_(r.staffName);
      var k = locationsIsPerson_(name) ? clientNameKey_(name) : '';
      if (k) seen[k] = true;
    });
  } catch (eI) { why.push(hubViewerWhy_('The IST records', eI)); }
  var cal = locationsCalendar_(), psi = locationsPunches_();
  var said = function (s) {
    s = String(s || 'a source could not be read');
    return s.charAt(0).toUpperCase() + s.slice(1) + '.';
  };
  if (!cal.cal) why.push(said(cal.why));
  if (!psi.rows) why.push(said(psi.why));
  codes.forEach(function (code) {
    locationsStaffMerge_(code, cal.cal, psi.rows, today, {}).staff.forEach(function (p) {
      if (p.last_day >= since) seen[p.key] = true;
    });
  });
  var out = { keys: Object.keys(seen).sort(), why: why.join(' ') };
  memo[memoKey] = JSON.stringify(out);
  return out;
}

// { keys, why, week }: the folded staff names on this week's shifts (its Monday to its Sunday, the Monday `week`)…
function hubStaffScheduledForHouses_(houseCodes) {
  var codes = [];
  (Array.isArray(houseCodes) ? houseCodes : [houseCodes]).forEach(function (c) {
    var hc = locationsHouseCode_(c);
    if (hc && codes.indexOf(hc) === -1) codes.push(hc);
  });
  codes.sort();
  var week = myFamilyWeek_('', locationsToday_());
  if (!codes.length || !week) return { keys: [], why: '', week: week };
  var memo = hubViewerMemo_().staff, memoKey = 'week|' + codes.join(',') + '|' + week;
  if (memo.hasOwnProperty(memoKey)) return JSON.parse(memo[memoKey]);
  var end = locationsDayShift_(week, 6);
  var want = {}, seen = {}, why = '';
  codes.forEach(function (c) { want[c] = true; });
  var got = locationsCalendar_();
  if (!got.cal) {
    var s = String(got.why || 'the Calendar Archive could not be read');
    why = s.charAt(0).toUpperCase() + s.slice(1) + '.';
  } else {
    var values = got.cal.values || [];
    var head = (values[0] || []).map(function (h) { return String(h || '').trim().toLowerCase(); });
    var col = function (name, fb) { var i = head.indexOf(name); return i === -1 ? fb : i; };
    var cLoc = col('location', 0), cName = col('employee', 1), cDate = col('date', 4);
    for (var r = 1; r < values.length; r++) {
      var line = values[r] || [];
      if (!want[locationsCode_(line[cLoc])]) continue;
      var day = commBroadcastDay_(line[cDate], got.cal.tz);
      if (!day || day < week || day > end) continue;
      var name = locationsText_(line[cName]);
      if (!locationsIsPerson_(name)) continue;
      var k = clientNameKey_(name);
      if (k) seen[k] = true;
    }
  }
  var out = { keys: Object.keys(seen).sort(), why: why, week: week };
  memo[memoKey] = JSON.stringify(out);
  return out;
}
