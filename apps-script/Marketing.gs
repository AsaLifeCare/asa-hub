var MARKETING_FOLDER = 'ASA Hub — Marketing';
var MARKETING_SS_TITLE = 'ASA Hub — Marketing';
var MARKETING_TAB = 'competitors';
var MARKETING_HEADER = [
  'id', 'name', 'aliases', 'type', 'tier', 'site', 'facebook', 'linkedin',
  'location', 'founded', 'revenue', 'staff', 'served', 'services', 'funding', 'note'
];
var MARKETING_COPY_PROP = 'MARKETING_HUB_SHEET_ID';
var MARKETING_COPY_NAME = 'Competitor Marketing';

function marketingEstateId_() {
  return hubId_('MARKETING_ESTATE_ID');
}

function marketingFolder_() {
  return filesChildByName_(filesRoot_(), MARKETING_FOLDER);
}

// A routed tab, never a file of its own: a separate file is invisible to the mirror, the checks and the bundle.
var MARKETING_HUB_TAB = 'marketing_competitors';

function marketingTreatSheet_() {
  var sheet = hubTabEnsure_(MARKETING_HUB_TAB, MARKETING_HEADER);
  ensureHeader_(sheet, MARKETING_HEADER);
  return sheet;
}

function marketingLinkKind_(url) {
  var u = String(url || '').toLowerCase();
  if (!u) return '';
  if (u.indexOf('facebook.com') !== -1) return 'facebook';
  if (u.indexOf('linkedin.com') !== -1) return 'linkedin';
  if (u.indexOf('google.com/search') !== -1 || u.indexOf('google.com/maps') !== -1) return 'search';
  if (/^https?:\/\//.test(u)) return 'site';
  return '';
}

function marketingKey_(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// makeCopy is the only touch of the estate source.
function marketingEnsureCopy_() {
  var id = str_(hubProp_(MARKETING_COPY_PROP));
  if (id) {
    try {
      var existing = DriveApp.getFileById(id);
      if (!existing.isTrashed()) return existing;
    } catch (eGone) { /* recopy below */ }
  }
  var src;
  try {
    src = DriveApp.getFileById(marketingEstateId_());
  } catch (eSrc) {
    return null;
  }
  var copy = src.makeCopy(MARKETING_COPY_NAME, marketingFolder_());
  hubPropSet_(MARKETING_COPY_PROP, copy.getId());
  return copy;
}

function marketingReadCopyLinks_(file) {
  var ss;
  try { ss = ssOpen_(file.getId()); }
  catch (eOpen) { return null; }
  var sh = ss.getSheets()[0];
  if (!sh) return null;
  var values;
  try { values = sh.getDataRange().getValues(); }
  catch (eRead) { return null; }
  var by = {};
  var order = [];
  for (var i = 0; i < values.length; i++) {
    var name = str_(values[i][0]);
    var url = str_(values[i][1]);
    if (!name) continue;
    var k = marketingKey_(name);
    if (!by[k]) {
      by[k] = { name: name, site: '', facebook: '', linkedin: '' };
      order.push(k);
    }
    if (!url) continue;
    var kind = marketingLinkKind_(url);
    if (kind === 'search') continue;
    if (kind === 'facebook' && !by[k].facebook) by[k].facebook = url;
    else if (kind === 'linkedin' && !by[k].linkedin) by[k].linkedin = url;
    else if (kind === 'site' && !by[k].site) by[k].site = url;
  }
  return { by: by, order: order };
}

// Public figures only: an agency that does not disclose says so, never an invented number.
var MARKETING_SEED = [
  { name: 'Midwest Family of Companies', aliases: 'midwest|midwest family', type: 'Provider group', tier: 'large',
    site: 'https://midwestfamilyofcompanies.com/', location: 'Massillon, OH', founded: '2000',
    revenue: '~$17.3M (2025)', staff: '—', served: '—',
    services: 'Residential + ICF | Adult day | Vocational | Nursing | PT/OT/Speech | Behavioral health',
    funding: 'Medicaid / Ohio DODD waivers',
    note: 'Most clinically integrated competitor — runs its own Intermediate Care Facility. Largest in the tracked set (4 entities).',
    facebook: 'https://www.facebook.com/MidwestFamilyofCompanies/' },
  { name: 'Siffrin', aliases: 'siffrin', type: 'Nonprofit', tier: 'mid',
    site: 'https://www.siffrin.org/', location: 'Canton, OH', founded: 'CARF since 1993',
    revenue: '$10.9M (FY24)', staff: '328', served: '—',
    services: 'Supervised Living | Residential | Community Integration | Employment | Transportation | Payee',
    funding: 'Medicaid / Ohio DODD waivers',
    note: 'Largest nonprofit after Midwest; ~85% of budget to programs. Revenue up from $9.3M (FY23).',
    linkedin: 'https://www.linkedin.com/company/siffrin-inc',
    facebook: 'https://www.facebook.com/siffrininc' },
  { name: 'The Workshops Inc (TWi)', aliases: 'twi|the workshops|the workshops inc', type: 'Nonprofit', tier: 'mid',
    site: 'https://choosetwi.com/', location: 'Canton, OH', founded: '1968',
    revenue: '$7.06M (2023)', staff: '411', served: '~400 / yr',
    services: 'Vocational training | Employment | Day programming | Transportation | Personal care',
    funding: 'Medicaid / Ohio DODD waivers',
    note: 'Vocational / employment leader with a 50+ year legacy; also sells low-cost contract labor.',
    linkedin: 'https://www.linkedin.com/company/theworkshopsinc' },
  { name: 'Legacy Caregivers', aliases: 'legacy|legacy caregivers', type: 'For-profit', tier: 'peer',
    site: 'https://www.legacycaregivers.com/', location: 'Canton, OH', founded: 'Carter family',
    revenue: 'Private', staff: '—', served: '—',
    services: 'Home health | IDD waiver supports | Community-based care',
    funding: 'Ohio DODD HCBS waivers',
    note: 'Closest direct peer to ASA — small owner-operated home-care agency; expanding across NE Ohio.',
    facebook: 'https://www.facebook.com/legacycaregivers/' },
  { name: 'House of G.R.A.C.E.', aliases: 'house of grace|house of g.r.a.c.e.|hofgrace', type: 'Residential', tier: 'peer',
    site: 'https://www.houseofgraceservices.org/', location: 'Ohio', founded: '—',
    revenue: 'Not disclosed', staff: '—', served: 'Kids · Adults · 65+',
    services: 'Residential services | All ages',
    funding: 'Medicaid, Medicare, DD Waivers (SELF / I-O / Level 1); adding Ohio Home Care Waiver',
    note: 'Smaller residential provider serving the full age range.',
    facebook: 'https://www.facebook.com/p/House-of-GRACE-Residential-Residential-Services-LLC-61573581435071/' },
  { name: 'New Leaf', aliases: 'new leaf|newleaf', type: 'Home health / IDD', tier: 'peer',
    site: 'https://www.starkdd.org/provider-services', location: 'Stark County, OH', founded: '—',
    revenue: 'Limited public data', staff: '—', served: '—',
    services: 'Home-care / IDD (verify)',
    funding: 'Ohio DODD waivers (likely)',
    note: 'Listed in the marketing sheet; limited public profile — verify the exact legal entity in the DODD directory.' }
];

function marketingMatchSeed_(name) {
  var k = marketingKey_(name);
  for (var i = 0; i < MARKETING_SEED.length; i++) {
    var s = MARKETING_SEED[i];
    if (marketingKey_(s.name) === k) return s;
    var aliases = String(s.aliases || '').split('|');
    for (var a = 0; a < aliases.length; a++) {
      if (str_(aliases[a]) === k) return s;
    }
  }
  return null;
}

function marketingRowFrom_(id, name, links, seed) {
  var s = seed || {};
  return [
    id, name, str_(s.aliases), str_(s.type) || 'Listed on sheet', str_(s.tier) || 'peer',
    str_(links && links.site) || str_(s.site),
    str_(links && links.facebook) || str_(s.facebook),
    str_(links && links.linkedin) || str_(s.linkedin),
    str_(s.location) || '—', str_(s.founded) || '—',
    str_(s.revenue) || (seed ? '' : 'Not yet curated'),
    str_(s.staff) || '—', str_(s.served) || '—',
    str_(s.services), str_(s.funding) || '—',
    str_(s.note) || (seed ? '' : 'On the competitor sheet; public figures have not been researched yet.')
  ];
}

function marketingSeedTab_(links) {
  var sheet = marketingTreatSheet_();
  if (sheet.getLastRow() > 1) return sheet;
  var seen = {};
  var rows = [];
  var order = (links && links.order) || [];
  var by = (links && links.by) || {};
  for (var i = 0; i < order.length; i++) {
    var k = order[i];
    var live = by[k];
    var seed = marketingMatchSeed_(live.name);
    var name = seed ? seed.name : live.name;
    var nk = marketingKey_(name);
    if (seen[nk]) continue;
    seen[nk] = true;
    rows.push(marketingRowFrom_(Utilities.getUuid(), name, live, seed));
  }
  for (var j = 0; j < MARKETING_SEED.length; j++) {
    var s = MARKETING_SEED[j];
    var sk = marketingKey_(s.name);
    if (seen[sk]) continue;
    seen[sk] = true;
    rows.push(marketingRowFrom_(Utilities.getUuid(), s.name, null, s));
  }
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, MARKETING_HEADER.length).setValues(rows);
  }
  return sheet;
}

function marketingReadTab_() {
  var out = [];
  // The reader must ask the writer's door, or the screen reads a file nobody writes.
  var ss = hubTabWorkbook_(MARKETING_HUB_TAB);
  // No workbook means dissolved; readTabNormalized_ then answers from the runtime.
  if (!ss) ss = ssOpen_(hubId_('HUB_DB_ID'));
  readTabNormalized_(ss, MARKETING_HUB_TAB).forEach(function (r) {
    var name = str_(r.name);
    if (!name) return;
    out.push({
      id: str_(r.id), name: name, aliases: str_(r.aliases),
      type: str_(r.type), tier: str_(r.tier) || 'peer',
      site: str_(r.site), facebook: str_(r.facebook), linkedin: str_(r.linkedin),
      location: str_(r.location), founded: str_(r.founded),
      revenue: str_(r.revenue), staff: str_(r.staff), served: str_(r.served),
      services: str_(r.services), funding: str_(r.funding), note: str_(r.note)
    });
  });
  return out;
}

function marketingMay_(user) {
  if (!user || user.is_service) return false;
  var role = str_(user.role);
  return role === 'admin' || role === 'manager' || role === 'staff';
}

HUB_POLICY.marketingCompetitors = {
  file: 'Marketing.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: []
};
HUB_ACTIONS.marketingCompetitors = function (payload, user) {
  if (!marketingMay_(user)) return hubDenied_();
  var copy = marketingEnsureCopy_();
  if (!copy) return { status: 503, message: 'The competitor sheet is not shared with the Hub account.' };

  // Ask the tab first: once it holds a row the seed does nothing, so the copy read would be wasted.
  var seeded = false;
  try { seeded = marketingTreatSheet_().getLastRow() > 1; }
  catch (eS) { seeded = false; }   // unreadable is not seeded — seed and find out

  if (!seeded) {
    var links = marketingReadCopyLinks_(copy);
    if (!links) return { status: 503, message: 'The Hub competitor sheet is unreadable.' };
    try { marketingSeedTab_(links); }
    catch (eSeed) {
      return { status: 503, message: 'The Hub marketing tab could not be written.' };
    }
  }
  var competitors;
  try { competitors = marketingReadTab_(); }
  catch (eRead) {
    return { status: 503, message: 'The Hub marketing tab is unreadable.' };
  }
  if (!competitors.length) {
    return { status: 503, message: 'The Hub marketing tab is empty.' };
  }
  return {
    status: 200,
    data: {
      sheet: MARKETING_SS_TITLE,
      drive_file_id: copy.getId(),
      competitors: competitors
    }
  };
};

// A typed rival survives the next read only because marketingSeedTab_ returns early once the tab has a row.

// Refuses a name already tracked: the same company twice is two half-records.
HUB_POLICY.marketingCompetitorAdd = {
  file: 'Marketing.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: []
};
/** Append a competitor to the Hub tab, refusing a name already tracked. */
HUB_ACTIONS.marketingCompetitorAdd = function (payload, user) {
  if (!marketingMay_(user)) return hubDenied_();
  var p = payload || {};
  var name = str_(p.name).trim();
  if (!name) return { status: 400, message: 'A competitor needs a name.' };
  var existing;
  try { existing = marketingReadTab_(); } catch (eR) { existing = []; }
  var key = marketingKey_(name);
  for (var i = 0; i < existing.length; i++) {
    if (marketingKey_(str_(existing[i].name)) === key) {
      return { status: 409, message: '"' + name + '" is already on the list.' };
    }
  }
  var sheet = marketingTreatSheet_();
  var row = [];
  var val = {
    id: Utilities.getUuid(), name: name,
    aliases: str_(p.aliases), type: str_(p.type) || 'Provider',
    // An unverified tier is 'peer', never a guess: the tier drives the comparison.
    tier: str_(p.tier) || 'peer',
    site: str_(p.site), facebook: str_(p.facebook), linkedin: str_(p.linkedin),
    location: str_(p.location), founded: str_(p.founded),
    revenue: str_(p.revenue) || '—', staff: str_(p.staff) || '—',
    served: str_(p.served) || '—', services: str_(p.services),
    funding: str_(p.funding), note: str_(p.note)
  };
  for (var h = 0; h < MARKETING_HEADER.length; h++) row.push(val[MARKETING_HEADER[h]] || '');
  sheet.appendRow(row);
  hubSysLog_(str_(user.email), 'marketing_competitor_add', name, { status: 200 });
  return { status: 200, data: { id: val.id, name: name } };
};

// Unknown is not zero: every aggregate reports how many cells it could not read.
function marketingKnown_(v) {
  var s = str_(v).trim();
  if (!s || s === '—' || s === '-' || s.toLowerCase() === 'n/a') return '';
  return s;
}

// null when there is no number to read, never 0, which would drag an average down.
function marketingMoney_(v) {
  var s = marketingKnown_(v);
  if (!s) return null;
  var m = s.replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)\s*([MmKkBb])?/);
  if (!m) return null;
  var n = parseFloat(m[1]);
  if (isNaN(n)) return null;
  var unit = String(m[2] || '').toLowerCase();
  if (unit === 'k') n *= 1e3;
  else if (unit === 'm') n *= 1e6;
  else if (unit === 'b') n *= 1e9;
  return n;
}

function marketingInt_(v) {
  var s = marketingKnown_(v);
  if (!s) return null;
  var m = s.replace(/,/g, '').match(/([0-9]+)/);
  return m ? parseInt(m[1], 10) : null;
}

function marketingServices_(v) {
  return marketingKnown_(v).split(/\s*[|,;\/]\s*/)
    .map(function (x) { return String(x).trim(); })
    .filter(function (x) { return !!x; });
}

function marketingSelf_() {
  var clients = [], people = [];
  try { clients = clientsDerived_(null) || []; } catch (eC) { clients = []; }
  try { people = listRows_('people', {}) || []; } catch (eP) { people = []; }
  var counties = {}, houses = {};
  clients.forEach(function (c) {
    var county = marketingKnown_(c.county);
    if (county) counties[county] = (counties[county] || 0) + 1;
    var addr = marketingKnown_(c.home_address);
    if (addr) houses[String(addr).split(',')[0].toLowerCase()] = true;
  });
  var countyList = [];
  for (var k in counties) countyList.push({ county: k, clients: counties[k] });
  countyList.sort(function (a, b) { return b.clients - a.clients; });
  var houseCount = 0;
  for (var h in houses) { if (houses.hasOwnProperty(h)) houseCount++; }
  return {
    name: 'ASA LifeCare',
    clients: clients.length,
    staff: people.length,
    houses: houseCount,
    counties: countyList,
    source: 'the platform itself — the client directory, the roster and the plans'
  };
}

HUB_POLICY.marketingAnalytics = {
  file: 'Marketing.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: []
};
// Stored in Script Properties against observed dependencies (depsWatch_); unchanged sources return it as is.
var MARKETING_ANALYTICS_PROP = 'MARKETING_ANALYTICS_V1';
// Split across numbered keys: one Script Property caps near 9KB and the analysis sits on that line.
var MARKETING_ANALYTICS_CHUNK = 8000;
var MARKETING_ANALYTICS_MAX_CHUNKS = 24;

function marketingStoreRead_() {
  try {
    var n = parseInt(hubProp_(MARKETING_ANALYTICS_PROP + '_N') || '0', 10);
    if (!n) return null;
    var text = '';
    for (var i = 0; i < n; i++) {
      var part = hubProp_(MARKETING_ANALYTICS_PROP + '_' + i);
      if (part === null || part === undefined) return null;   // a piece lost is no answer
      text += part;
    }
    return JSON.parse(text);
  } catch (e) { return null; }
}

function marketingStoreWrite_(obj) {
  try {
    var text = JSON.stringify(obj);
    var n = Math.ceil(text.length / MARKETING_ANALYTICS_CHUNK);
    if (n > MARKETING_ANALYTICS_MAX_CHUNKS) { marketingStoreClear_(); return; }
    // The count is written last, so a reader that sees it sees every piece.
    for (var i = 0; i < n; i++) {
      hubPropSet_(MARKETING_ANALYTICS_PROP + '_' + i,
                  text.substr(i * MARKETING_ANALYTICS_CHUNK, MARKETING_ANALYTICS_CHUNK));
    }
    hubPropSet_(MARKETING_ANALYTICS_PROP + '_N', String(n));
  } catch (e) { /* not stored is not broken — it is what happened before */ }
}

function marketingStoreClear_() {
  try { hubPropDelete_(MARKETING_ANALYTICS_PROP + '_N'); } catch (e) {}
}
// A mid-tab edit changes no size, so the fingerprint is trusted for half an hour at most.
var MARKETING_ANALYTICS_MAX_AGE_MS = 30 * 60 * 1000;

function marketingDepPairs_(keys) {
  var out = [];
  for (var i = 0; i < (keys || []).length; i++) {
    var cut = String(keys[i]).indexOf('::');
    if (cut === -1) { out.push(String(keys[i])); continue; }
    out.push({ id: String(keys[i]).slice(0, cut), tab: String(keys[i]).slice(cut + 2) });
  }
  return out;
}

function marketingSizes_(keys) {
  if (!keys || !keys.length) return {};
  try {
    var answer = bulkTabsRevs_({ tabs: marketingDepPairs_(keys) });
    return ((answer && answer.data) || {}).revs || {};
  } catch (e) { return {}; }
}

// Any unreadable size means unknown, never unchanged.
function marketingUnchanged_(was, now, keys) {
  if (!was || !now || !keys || !keys.length) return false;
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (!now[k] || now[k] === 'error') return false;
    if (was[k] !== now[k]) return false;
  }
  return true;
}

HUB_ACTIONS.marketingAnalytics = function (payload, user) {
  if (!marketingMay_(user)) return hubDenied_();

  var held = null;
  try { held = marketingStoreRead_(); } catch (eH) { held = null; }

  var forced = !!(payload && payload.refresh);
  if (!forced && held && held.deps && held.deps.length && held.data) {
    var madeAt = Date.parse(str_(held.built_at) || '') || 0;
    var fresh = madeAt && (new Date().getTime() - madeAt) <= MARKETING_ANALYTICS_MAX_AGE_MS;
    if (fresh) {
      var now = marketingSizes_(held.deps);
      if (marketingUnchanged_(held.sizes, now, held.deps)) {
        var kept = held.data;
        kept.built_at = held.built_at;
        kept.reused = true;
        return { status: 200, data: kept };
      }
    }
  }

  var watched = depsWatch_(function () { return marketingAnalyticsBuild_(); });
  var built = watched.value;
  var madeNow = new Date().toISOString();
  if (built && built.status === 200) {
    built.data.built_at = madeNow;
    built.data.reused = false;
  }
  if (built && built.status === 200) {
    marketingStoreWrite_({
      deps: watched.deps,
      sizes: marketingSizes_(watched.deps),
      data: built.data,
      built_at: madeNow
    });
  }
  return built;
};

function marketingAnalyticsBuild_() {
  var rivals;
  try { rivals = marketingReadTab_(); } catch (eR) { rivals = []; }
  if (!rivals.length) {
    return { status: 503, message: 'The Hub marketing tab is empty — open Competitors once to fill it.' };
  }
  var self = marketingSelf_();

  var tiers = {}, unknownRevenue = 0, unknownStaff = 0, unknownServed = 0;
  var revenues = [], serveds = [], staffs = [];
  var serviceCount = {}, cities = {};
  var rows = rivals.map(function (r) {
    var tier = marketingKnown_(r.tier) || 'unrecorded';
    tiers[tier] = (tiers[tier] || 0) + 1;
    var rev = marketingMoney_(r.revenue);
    var srv = marketingInt_(r.served);
    var stf = marketingInt_(r.staff);
    if (rev === null) unknownRevenue++; else revenues.push(rev);
    if (srv === null) unknownServed++; else serveds.push(srv);
    if (stf === null) unknownStaff++; else staffs.push(stf);
    var services = marketingServices_(r.services);
    services.forEach(function (s) { serviceCount[s] = (serviceCount[s] || 0) + 1; });
    var city = marketingKnown_(r.location);
    if (city) cities[city] = (cities[city] || 0) + 1;
    return {
      id: str_(r.id), name: str_(r.name), type: marketingKnown_(r.type),
      tier: tier, location: city, founded: marketingKnown_(r.founded),
      revenue: marketingKnown_(r.revenue), revenue_num: rev,
      staff: marketingKnown_(r.staff), staff_num: stf,
      served: marketingKnown_(r.served), served_num: srv,
      services: services, site: str_(r.site), note: marketingKnown_(r.note)
    };
  });

  var svc = [];
  for (var s2 in serviceCount) svc.push({ service: s2, rivals: serviceCount[s2] });
  svc.sort(function (a, b) { return b.rivals - a.rivals || a.service.localeCompare(b.service); });
  var placeList = [];
  for (var c2 in cities) placeList.push({ place: c2, rivals: cities[c2] });
  placeList.sort(function (a, b) { return b.rivals - a.rivals; });

  var med = function (list) {
    if (!list.length) return null;
    var l = list.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(l.length / 2);
    return l.length % 2 ? l[m] : (l[m - 1] + l[m]) / 2;
  };

  return {
    status: 200,
    data: {
      self: self,
      rivals: rows,
      counted: rivals.length,
      tiers: tiers,
      services: svc,
      places: placeList,
      unknown: { revenue: unknownRevenue, staff: unknownStaff, served: unknownServed },
      median: { revenue: med(revenues), staff: med(staffs), served: med(serveds) }
    }
  };
};
