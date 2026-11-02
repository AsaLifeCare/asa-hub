// SSA: one Service and Support Administrator at a time, read from the client records that name them.
// The reads open as App Control releases the app (hubProfileAppGate_): the master and every widening badge see…

var SSA_APP_ID = 'ssa-profiles';
var SSA_ACTIONS = ['ssaProfileRoster', 'ssaProfileOverview', 'ssaProfileDocuments', 'ssaProfileActivity',
                   'ssaProfileNotes', 'ssaProfileDocFile', 'ssaProfileNoteAdd'];
var SSA_NOTES_TAB = 'ssa_notes';
var SSA_NOTES_HEADER = ['id', 'ssa_key', 'ssa_name', 'body', 'by', 'at'];
var SSA_NOTE_MAX = 4000;
// Last, each current client's own view of the SSA, cut from the parts before it as the actions cut it for that client.
var SSA_PACK_PARTS = ['overview', 'documents', 'activity', 'notes', 'client_views'];
// Past this a pack starts no further part, so it always answers inside the execution limit.
var SSA_PACK_BUDGET_MS = 240000;
var SSA_FOLLOWUP_DAYS = 60;
var SSA_ACTIVITY_DAYS = 365;
var SSA_ACTIVITY_CAP = 400;
// A board's e-mail domain names its agency; a free mailbox names none.
var SSA_AGENCIES = { 'starkdd.org': 'Stark County Board of DD', 'stardd.org': 'Stark County Board of DD' };
var SSA_FREE_MAIL = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'aol.com', 'icloud.com', 'live.com',
                     'msn.com', 'att.net', 'sbcglobal.net'];
var SSA_MIMES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
                  doc: 'application/msword',
                  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
// Set only while ssaPack runs, so the client records are read once per pack.
var SSA_INDEX_MEMO_ = null;

// FAIL-CLOSED: { open, scope } for a read — the master in its own session always; anyone else only as App Control…
function ssaProfilesGate_(user) {
  if (ssaProfilesMaster_(user)) {
    return { open: true, scope: { kind: 'master', client_keys: [], house_codes: [], ssa_keys: [], family_keys: [],
                                  why: '' } };
  }
  var got = null;
  try { got = hubProfileAppGate_(SSA_APP_ID, user); } catch (e) { got = null; }
  return got && got.open === true && got.scope ? got : { open: false, scope: null };
}

/** FAIL-CLOSED: the master in its own session, never a visit or a service call — the writes' and the pack's gate. */
function ssaProfilesMaster_(user) {
  try { return !!hubIsRealMaster_(user); } catch (e) { return false; }
}

function ssaProfilesUnknown_() {
  return { status: 404, message: 'Unknown action.' };
}

// What a scope cuts: null for the master and every widening badge (everything); else the SSAs and the clients it…
function ssaProfilesCut_(scope) {
  var kind = str_(scope && scope.kind);
  if (kind === 'master' || kind === 'all') return null;
  var known = ['client', 'guardian', 'ssa'].indexOf(kind) !== -1;
  var set = function (list) {
    var o = {};
    if (known && Array.isArray(list)) list.forEach(function (k) { if (str_(k)) o[str_(k)] = true; });
    return o;
  };
  return { kind: kind, ssas: set(scope && scope.ssa_keys), clients: set(scope && scope.client_keys) };
}

/** Whether a cut viewer asks for an SSA outside their scope, the key read as ssaProfilesSsa_ reads it. */
function ssaProfilesOutside_(cut, payload) {
  if (!cut) return false;
  return cut.ssas[String(payload && payload.ssa != null ? payload.ssa : '').trim()] !== true;
}

/** A copy of an answer with some fields replaced. */
function ssaWith_(data, over) {
  var out = {};
  Object.keys(data || {}).forEach(function (k) { out[k] = data[k]; });
  Object.keys(over || {}).forEach(function (k) { out[k] = over[k]; });
  return out;
}

/** A door's answer as a cut viewer may see it; any other answer as it is. */
function ssaCutAnswer_(got, cut, fn) {
  if (!cut || !got || got.status !== 200 || !got.data) return got;
  return { status: 200, data: fn(got.data, cut) };
}

// Settings > My Work's SSA parts (AlertsConfig.gs MYWORK_HIDE_KEYS), by the name an answer gives each.
var SSA_HIDE_PARTS = { updated: 'ssa_updated', county: 'ssa_county', count: 'ssa_count', role: 'ssa_role' };

// What every session but the master's own leaves out of SSA — the same for every caller, so the relay's pack…
function ssaDisplay_() {
  var read = null;
  try { read = (typeof hubMyWorkHideRead_ === 'function') ? hubMyWorkHideRead_() : null; } catch (e) { read = null; }
  if (!read) return null;
  var hidden = {};
  Object.keys(SSA_HIDE_PARTS).forEach(function (k) { hidden[k] = read[SSA_HIDE_PARTS[k]] === true; });
  return { hidden: hidden };
}

/** A read's answer with the display on it, outside its cache; any other answer as it is. */
function ssaShown_(got) {
  if (!got || got.status !== 200 || !got.data) return got;
  var display = ssaDisplay_();
  return display ? { status: 200, data: ssaWith_(got.data, { display: display }) } : got;
}

function ssaMine_(cut, key) {
  return cut.clients[String(key || '')] === true;
}

// ---- pure helpers ---------------------------------------------------------

function ssaWhy_(what, e) {
  return what + ' could not be read (' + String((e && e.message) || e).slice(0, 120) + ').';
}

/** 'ssa_' + the folded name, the relay's own fold; '' for a blank or a non-person ("N/A", "none"). */
function ssaKeyOf_(name) {
  var n = locationsText_(name, 200);
  if (!n || !guardianIsPerson_(n)) return '';
  var fold = clientNameKey_(n);
  return fold.length >= 3 ? 'ssa_' + fold : '';
}

function ssaEmail_(v) {
  var s = locationsText_(v, 200).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(s) ? s : '';
}

function ssaAgency_(email) {
  var m = /@([a-z0-9.-]+\.[a-z]{2,})$/.exec(String(email || '').trim().toLowerCase());
  if (!m) return '';
  if (SSA_AGENCIES[m[1]]) return SSA_AGENCIES[m[1]];
  return SSA_FREE_MAIL.indexOf(m[1]) === -1 ? m[1] : '';
}

/** The most common non-blank value, the first seen on a tie. */
function ssaMost_(list) {
  var count = {}, best = '', n = 0;
  (list || []).forEach(function (v) {
    var s = String(v || '');
    if (!s) return;
    count[s] = (count[s] || 0) + 1;
    if (count[s] > n) { best = s; n = count[s]; }
  });
  return best;
}

/** What the active clients' records say most, else what any record says. */
function ssaPick_(list) {
  return ssaMost_(list.filter(function (x) { return x.active; }).map(function (x) { return x.v; })) ||
         ssaMost_(list.map(function (x) { return x.v; }));
}

function ssaMime_(name) {
  var m = /\.([a-z0-9]{2,5})\s*$/i.exec(String(name || ''));
  return (m && SSA_MIMES[m[1].toLowerCase()]) || '';
}

/** An instant as ISO text: a Date, an ISO cell as written, any other date text parsed; '' otherwise. */
function ssaWhen_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  var s = String(v == null ? '' : v).trim();
  if (!s || /^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  var t = Date.parse(s);
  return isNaN(t) ? '' : new Date(t).toISOString();
}

function ssaNewest_(a, b) {
  return a.at < b.at ? 1 : (a.at > b.at ? -1 : 0);
}

// Last guard on every SSA answer: cpScrub_, and an SSN or a card number written with separators never leaves either…
function ssaScrub_(v, key) {
  if (key && CP_SCRUB_KEYS[key]) return v;
  if (typeof v === 'string') {
    return cpScrub_(v.replace(/(^|\D)\d{3}[\s.-]\d{2}[\s.-]\d{4}(?=\D|$)/g, '$1[withheld]')
                     .replace(/(^|\D)\d(?:[ -]?\d){12,18}(?=\D|$)/g, '$1[withheld]'));
  }
  if (Array.isArray(v)) return v.map(function (x) { return ssaScrub_(x); });
  if (v && typeof v === 'object') {
    var out = {};
    Object.keys(v).forEach(function (k) { out[k] = ssaScrub_(v[k], k); });
    return out;
  }
  return cpScrub_(v);
}

function ssaAddresses_(cells) {
  var out = {};
  (cells || []).forEach(function (c) {
    (String(c == null ? '' : c).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).forEach(function (a) {
      out[a.toLowerCase()] = true;
    });
  });
  return out;
}

/** The ISP span's end against today: overdue, to_schedule inside the window, current; '' with no span. */
function ssaFollowupState_(end, today) {
  var left = end ? csfDays_(today, end) : null;
  if (left === null) return '';
  if (left < 0) return 'overdue';
  return left <= SSA_FOLLOWUP_DAYS ? 'to_schedule' : 'current';
}

// ---- the index ------------------------------------------------------------

// Every SSA the client records name, keyed ssa_<folded name>: the active clients as the Clients app reads them (the…
function ssaIndexBuild_() {
  var why = [], degraded = false;
  var active = null, master = null, arch = null, photos = {};
  try { active = clientsDerived_(null); } catch (eC) { why.push(ssaWhy_('The client records', eC)); degraded = true; }
  try { master = cpMasterIndex_(); } catch (eM) { why.push(ssaWhy_('The Asa Client Database', eM)); degraded = true; }
  try { arch = cpArchiveIndex_(); } catch (eA) { why.push(ssaWhy_('The archive of old clients', eA)); degraded = true; }
  if (!active && !arch) throw new Error(why.join(' '));
  try { photos = clientPhotoIndex_(); } catch (eP) { photos = {}; }
  var ssas = {}, seen = {}, names = {};
  var take = function (rec, client) {
    var key = ssaKeyOf_(rec.ssa_name);
    if (!key) return;
    var s = ssas[key] || (ssas[key] = { names: [], phones: [], emails: [], counties: [], clients: [] });
    var live = clientLive_(client);
    s.names.push({ v: locationsText_(rec.ssa_name, 120), active: live });
    var phone = cpPhone_(rec.ssa_phone);
    if (spDigits10_(phone)) s.phones.push({ v: phone, active: live });
    var email = ssaEmail_(rec.ssa_email);
    if (email) s.emails.push({ v: email, active: live });
    var county = locationsText_(rec.county, 80);
    if (county) s.counties.push({ v: county, active: live });
    // the e-mail this one record names, so an account is matched per record (ViewerScope.gs)
    client.ssa_email = email;
    s.clients.push(client);
  };
  (active || []).forEach(function (c) {
    var row = cpRosterRow_(c, photos);
    if (!row.client_key || seen[row.client_key]) return;
    seen[row.client_key] = true;
    names[clientNameKey_(row.name)] = true;
    var m = master ? master.rows[clientNameKey_(row.name)] : null;
    // set inactive, its Master row went to the archive: that row still names its SSA
    if (!m && arch && !clientLive_(row)) m = arch.rows[clientNameKey_(row.name)] || null;
    var mf = m && !m.ambiguous ? m.fields : {};
    var src = locationsText_(c.ssa_name) ? c : mf;
    var same = function (o) { return clientNameKey_(o.ssa_name) === clientNameKey_(src.ssa_name) ? o : {}; };
    var a = same(c), b = same(mf);
    take({ ssa_name: src.ssa_name, ssa_phone: a.ssa_phone || b.ssa_phone, ssa_email: a.ssa_email || b.ssa_email,
           county: c.county },
         { client_key: row.client_key, name: row.name, house: row.house, status: row.status, avatar: row.avatar,
           isp_year: row.isp_year, isp_signed: cpDay_(c.isp_signed_date || mf.isp_signed_date), archived: false });
  });
  if (arch) {
    arch.order.forEach(function (k) {
      var hit = arch.rows[k];
      if (!hit || hit.ambiguous || seen[k] || names[k]) return;
      seen[k] = true;
      var f = hit.fields || {};
      take({ ssa_name: f.ssa_name, ssa_phone: f.ssa_phone, ssa_email: f.ssa_email, county: '' },
           { client_key: k, name: locationsText_(hit.name), house: locationsText_(f.house), status: 'inactive',
             avatar: String(photos[k] || ''), isp_year: '', isp_signed: cpDay_(f.isp_signed_date), archived: true });
    });
  }
  var out = {}, phones = {};
  Object.keys(ssas).forEach(function (k) {
    var s = ssas[k];
    s.clients.sort(function (x, y) {
      return (x.status === y.status ? 0 : (x.status === 'active' ? -1 : 1)) || x.name.localeCompare(y.name);
    });
    var digits = {}, emails = {};
    s.phones.forEach(function (p) { digits[spDigits10_(p.v)] = true; });
    s.emails.forEach(function (e) { emails[e.v] = true; });
    Object.keys(digits).forEach(function (d) { (phones[d] = phones[d] || {})[k] = true; });
    var email = ssaPick_(s.emails);
    out[k] = {
      key: k, name: ssaPick_(s.names), phone: ssaPick_(s.phones), email: email, agency: ssaAgency_(email),
      county: ssaPick_(s.counties), avatar: String(photos[k.slice(4)] || ''),
      status: s.clients.some(clientLive_) ? 'active' : 'inactive',
      clients: s.clients, phones: Object.keys(digits), emails: Object.keys(emails)
    };
  });
  return { ssas: out, phones: phones, why: why, degraded: degraded };
}

function ssaIndexDeps_() {
  var deps = [cpTabScope_('clients'), cpTabScope_('isps'), cpTabScope_('photos')];
  try {
    var id = cpClientDbId_();
    deps.push(cacheScopeSheet_(id, CP_MASTER_TAB), cacheScopeSheet_(id, CP_ARCHIVE_TAB));
  } catch (e) { deps.push('ssa_books'); }
  return deps;
}

function ssaIndex_() {
  var memo = SSA_INDEX_MEMO_;
  if (memo && memo.value) return memo.value;
  var value = ssaCached_('index', 'all', 'all', ssaIndexDeps_(), ssaIndexBuild_);
  if (memo) memo.value = value;
  return value;
}

/** The SSA a request names: 400 when no client record names the key, 503 when the records cannot say. */
function ssaProfilesSsa_(raw) {
  var key = String(raw == null ? '' : raw).trim();
  var none = { refused: { status: 400, message: 'No SSA "' + key.slice(0, 120) + '" is on file.' } };
  if (!/^ssa_[a-z0-9]{3,120}$/.test(key)) return none;
  var idx;
  try { idx = ssaIndex_(); }
  catch (e) {
    return { refused: { status: 503, message: 'The client records could not be read just now (' +
             String((e && e.message) || e).slice(0, 120) + ') — nothing is said about this SSA.' } };
  }
  var s = idx.ssas[key];
  if (!s) {
    if (idx.degraded) {
      return { refused: { status: 503, message: 'Not every client record could be read just now (' +
               idx.why.join(' ').slice(0, 200) + ') — nothing is said about this SSA.' } };
    }
    return none;
  }
  return { key: key, name: s.name, ssa: s, index: idx, why: idx.why.slice(), degraded: !!idx.degraded };
}

// ---- caching --------------------------------------------------------------

/** Keyed ssa_<action>_<key>; the name carries the part and the versions of what it reads. A degraded answer is never kept. */
function ssaCached_(action, key, part, depScopes, producer) {
  var scope = 'ssa_' + action + '_' + key;
  var name = 'v1_' + String(part || 'all');
  (depScopes || []).forEach(function (s) {
    if (!s) return;
    try { name += '_' + cacheVersion_(s); } catch (e) { name += '_x'; }
  });
  var value = cacheRead_(scope, name, producer);
  if (value && value.degraded) cacheBump_(scope);
  return value;
}

function ssaBump_(action, key) {
  cacheBump_('ssa_' + action + '_' + key);
}

/** One read's answer: 503 names the source when the build throws. */
function ssaServe_(action, ctx, deps, what, build) {
  try {
    return { status: 200, data: ssaCached_(action, ctx.key, 'all', deps, function () { return ssaScrub_(build()); }) };
  } catch (e) {
    return { status: 503, message: what + ' could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
}

function ssaIspsByKey_() {
  var out = {};
  listRows_('isps', {}).forEach(function (r) {
    var k = String(r.client_key || '').trim();
    if (k && !out[k]) out[k] = r;
  });
  return out;
}

// ---- the roster -----------------------------------------------------------

/** Every SSA, or with a cut only the SSAs in it, each counting only the clients in it. */
function ssaRosterBuild_(cut) {
  var idx = ssaIndex_();
  var keys = Object.keys(idx.ssas);
  if (cut) keys = keys.filter(function (k) { return cut.ssas[k] === true; });
  var ssas = keys.map(function (k) {
    var s = idx.ssas[k];
    var n = cut ? s.clients.filter(function (c) { return ssaMine_(cut, c.client_key); }).length : s.clients.length;
    return { key: s.key, name: s.name, phone: s.phone, email: s.email, agency: s.agency, county: s.county,
             clients: n, status: s.status, avatar: s.avatar };
  });
  ssas.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return { ssas: ssas, why: idx.why.slice(), degraded: !!idx.degraded };
}

HUB_POLICY.ssaProfileRoster = {
  file: 'SsaProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: {}
};
/** The switcher: every SSA the session may see, active when one of their clients is; `viewer` says how far it sees. */
HUB_ACTIONS.ssaProfileRoster = function (payload, user) {
  var gate = ssaProfilesGate_(user);
  if (!gate.open) return ssaProfilesUnknown_();
  var cut = ssaProfilesCut_(gate.scope);
  try {
    var data = cut ? ssaScrub_(ssaRosterBuild_(cut))
                   : ssaCached_('ssaProfileRoster', 'all', 'all', ssaIndexDeps_(), function () {
                       return ssaScrub_(ssaRosterBuild_(null));
                     });
    return { status: 200, data: ssaWith_(data, { viewer: str_(gate.scope.kind) }) };
  } catch (e) {
    return { status: 503, message: 'The SSA list could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
};

// ---- overview -------------------------------------------------------------

function ssaOverviewBuild_(ctx) {
  var s = ctx.ssa, why = ctx.why.slice(), degraded = ctx.degraded;
  var labels = {};
  try { locationsHomes_().forEach(function (h) { if (h.code && h.home_name) labels[h.code] = h.home_name; }); }
  catch (eH) { why.push(ssaWhy_('The house registry', eH)); degraded = true; }
  return {
    ssa: { key: s.key, name: s.name, phone: s.phone, email: s.email, agency: s.agency, county: s.county,
           office_address: '', avatar: s.avatar, status: s.status },
    clients: s.clients.map(function (c) {
      var code = locationsHouseCode_(c.house) || locationsCode_(c.house);
      return { client_key: c.client_key, name: c.name, house: c.house, house_label: (code && labels[code]) || c.house,
               avatar: c.avatar, status: c.status };
    }),
    why: why, degraded: degraded
  };
}

/** A cut viewer's overview: the SSA's details and only the clients in their scope. */
function ssaOverviewCut_(data, cut) {
  return ssaWith_(data, { clients: (data.clients || []).filter(function (c) { return ssaMine_(cut, c.client_key); }) });
}

function ssaOverviewDoor_(payload, cut) {
  var ctx = ssaProfilesSsa_(payload && payload.ssa);
  if (ctx.refused) return ctx.refused;
  return ssaShown_(ssaCutAnswer_(ssaServe_('ssaProfileOverview', ctx, ssaIndexDeps_(), 'The SSA', function () {
    return ssaOverviewBuild_(ctx);
  }), cut, ssaOverviewCut_));
}

HUB_POLICY.ssaProfileOverview = {
  file: 'SsaProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { ssa: { type: 'string' } }
};
/** Overview: the SSA's details and every client whose record names them, the active ones first. */
HUB_ACTIONS.ssaProfileOverview = function (payload, user) {
  var gate = ssaProfilesGate_(user);
  if (!gate.open) return ssaProfilesUnknown_();
  var cut = ssaProfilesCut_(gate.scope);
  if (ssaProfilesOutside_(cut, payload)) return ssaProfilesUnknown_();
  return ssaOverviewDoor_(payload, cut);
};

// ---- documents ------------------------------------------------------------

// Each client's plan — with its file when the plans folder holds exactly one, else listed with none — and the plan…
function ssaDocumentsBuild_(ctx) {
  var s = ctx.ssa, why = ctx.why.slice(), degraded = ctx.degraded;
  var docs = [], seen = {};
  // a row with no file is kept once by its own id
  var add = function (d) {
    var k = d.file_id ? 'f:' + d.file_id : 'r:' + d.id;
    if (seen[k]) return;
    seen[k] = true;
    docs.push(d);
  };
  var byKey = {}, byName = {};
  s.clients.forEach(function (c) { byKey[c.client_key] = c; byName[clientNameKey_(c.name)] = c; });
  var isps = {};
  try { isps = ssaIspsByKey_(); } catch (eI) { why.push(ssaWhy_('The plans', eI)); degraded = true; }
  var folder = null;
  try { folder = ispDocIndex_(); } catch (eF) { folder = null; }
  var folderOk = !!(folder && folder.files);
  if (!folderOk) {
    why.push('The plans folder could not be read, so no plan file is listed.');
    degraded = true;
  }
  s.clients.forEach(function (c) {
    var isp = isps[c.client_key];
    var doc = { id: '' };
    if (folderOk) {
      try { doc = ispDocFor_(c.name) || { id: '' }; } catch (eD) { doc = { id: '' }; }
    }
    if (!doc.id && !isp) return;
    var year = locationsText_(isp && isp.isp_year, 80);
    add({ id: 'isp_' + c.client_key,
          title: (doc.id && locationsText_(doc.name)) || ('Individual Service Plan' + (year ? ' ' + year : '')),
          kind: 'isp', client_key: c.client_key, client_name: c.name, date: c.isp_signed || cpDay_(isp && isp.loaded_at),
          file_id: String(doc.id || ''), mime: doc.id ? ssaMime_(doc.name) : '',
          source: doc.id ? 'Plans folder' : 'Plan on file' });
  });
  try {
    clientFilesFor_(Object.keys(byKey), Object.keys(byName)).forEach(function (r) {
      var c = byKey[String(r.client_key || '').trim()] || byName[clientNameKey_(r.client_name)];
      if (!c || !cpPlanFile_(r)) return;
      var fid = String(r.drive_id || '') || locationsDriveId_(r.url);
      add({ id: 'cf_' + (String(r.id || '') || fid), title: locationsText_(r.title) || locationsText_(r.folder) || 'Client document',
            kind: 'client_doc', client_key: c.client_key, client_name: c.name,
            date: cpDay_(r.issued_on) || cpDay_(r.file_date), file_id: fid,
            mime: locationsText_(r.mime_type) || ssaMime_(r.title),
            source: 'Client files' + (locationsText_(r.folder) ? ' · ' + locationsText_(r.folder) : '') });
    });
  } catch (eC) { why.push(ssaWhy_('The client files', eC)); degraded = true; }
  docs.sort(function (a, b) { return (a.date < b.date ? 1 : (a.date > b.date ? -1 : 0)) || a.title.localeCompare(b.title); });
  return { docs: docs, why: why, degraded: degraded };
}

function ssaDocDeps_() {
  return ssaIndexDeps_().concat([cpTabScope_('client_files')]);
}

function ssaDocuments_(ctx) {
  return ssaCached_('ssaProfileDocuments', ctx.key, 'all', ssaDocDeps_(), function () {
    return ssaScrub_(ssaDocumentsBuild_(ctx));
  });
}

/** A cut viewer's documents: only those of the clients in their scope. */
function ssaDocumentsCut_(data, cut) {
  return ssaWith_(data, { docs: (data.docs || []).filter(function (d) { return ssaMine_(cut, d.client_key); }) });
}

function ssaDocumentsDoor_(payload, cut) {
  var ctx = ssaProfilesSsa_(payload && payload.ssa);
  if (ctx.refused) return ctx.refused;
  return ssaCutAnswer_(ssaServe_('ssaProfileDocuments', ctx, ssaDocDeps_(), 'The documents', function () {
    return ssaDocumentsBuild_(ctx);
  }), cut, ssaDocumentsCut_);
}

HUB_POLICY.ssaProfileDocuments = {
  file: 'SsaProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { ssa: { type: 'string' } }
};
/** Documents: each of the SSA's clients' plans and the plan files the Clients app lists for them, newest first. */
HUB_ACTIONS.ssaProfileDocuments = function (payload, user) {
  var gate = ssaProfilesGate_(user);
  if (!gate.open) return ssaProfilesUnknown_();
  var cut = ssaProfilesCut_(gate.scope);
  if (ssaProfilesOutside_(cut, payload)) return ssaProfilesUnknown_();
  return ssaDocumentsDoor_(payload, cut);
};

HUB_POLICY.ssaProfileDocFile = {
  file: 'SsaProfiles.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { ssa: { type: 'string' }, file_id: { type: 'string' } }
};
/** One of the SSA's documents as bytes for the platform's centred viewer; only a file their Documents list names. */
HUB_ACTIONS.ssaProfileDocFile = function (payload, user) {
  var gate = ssaProfilesGate_(user);
  if (!gate.open) return ssaProfilesUnknown_();
  var cut = ssaProfilesCut_(gate.scope);
  if (ssaProfilesOutside_(cut, payload)) return ssaProfilesUnknown_();
  var ctx = ssaProfilesSsa_(payload && payload.ssa);
  if (ctx.refused) return ctx.refused;
  var id = locationsText_(payload && payload.file_id, 120);
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return { status: 400, message: 'file_id: a Drive file id.' };
  var docs;
  try {
    docs = ssaDocuments_(ctx).docs || [];
    if (cut) docs = ssaDocumentsCut_({ docs: docs }, cut).docs;
  }
  catch (eK) { return { status: 503, message: 'The documents could not be read just now — try again in a minute.' }; }
  if (!docs.some(function (d) { return d.file_id === id; })) return { status: 404, message: 'This SSA names no such document.' };
  var got;
  try { got = locationsDocBytes_(id); }
  catch (e) {
    var gone = /not found|no item|does not exist|trashed/i.test(String((e && e.message) || e));
    return gone ? { status: 404, message: 'The file is no longer in the drive.' }
                : { status: 503, message: 'The document could not be opened just now — try again in a minute.' };
  }
  if (got.refused) return got.refused;
  return { status: 200, data: { id: id, name: got.name, mime: got.mime, size: got.size, exported: got.exported, b64: got.b64 } };
};

// ---- activity -------------------------------------------------------------

/** The SSA's phones that name them alone: one another SSA also carries, or a company line, is dropped. */
function ssaOwnPhones_(ctx) {
  var mine = {}, shared = 0;
  (ctx.ssa.phones || []).forEach(function (d) {
    var others = Object.keys((ctx.index.phones || {})[d] || {}).filter(function (k) { return k !== ctx.key; });
    var ours = false;
    try { ours = !!hubLineOurs_(d); } catch (e) { ours = false; }
    if (others.length || ours) { shared++; return; }
    mine[d] = true;
  });
  return { mine: mine, shared: shared };
}

/** Texts on the company lines to or from the SSA's own phones since `since`; the words are the message's own. */
function ssaTexts_(own, since) {
  var sheet = hubTabSheet_('quo_messages');
  if (!sheet) throw new Error('the texts house (quo_messages) could not be opened');
  var cols = spReadColumns_(sheet, {
    id: { names: ['message_id'] }, created: { names: ['message_created'] }, event: { names: ['event_at'] },
    received: { names: ['received_at'] }, dir: { names: ['direction'] }, from: { names: ['from_number'] },
    to: { names: ['to_number'] }, body: { names: ['body'] }, quo: { names: ['quo_number'] }
  });
  var c = cols.cols, out = [];
  var hit = function (d) { return own.mine[d]; };
  for (var i = 0; i < cols.n; i++) {
    var dir = String(c.dir[i] || '').trim().toLowerCase();
    var incoming = dir === 'incoming' || dir === 'inbound';
    if (!spNumbers_(incoming ? c.from[i] : c.to[i]).some(hit)) continue;
    var at = ssaWhen_(c.created[i]) || ssaWhen_(c.event[i]) || ssaWhen_(c.received[i]);
    if (!at || at.slice(0, 10) < since) continue;
    var quo = String(c.quo[i] || '').trim();
    var line = spNumbers_(incoming ? c.to[i] : c.from[i]).filter(function (d) { return !own.mine[d]; })[0] || quo;
    var who = spLineOf_(line, quo);
    out.push({ id: 'sms_' + String(c.id[i] || ('row' + (i + 2))), at: at, incoming: incoming, line: who.label,
               owner: who.owner, body: String(c.body[i] == null ? '' : c.body[i]) });
  }
  return out;
}

/** Calls with the SSA's own phones in the hotline book and the transcripts house; metadata only, never the words. */
function ssaCalls_(own, since, why) {
  var calls = {}, degraded = false;
  var hit = function (d) { return own.mine[d]; };
  var take = function (id, at, secs, direction, team) {
    if (!id || calls[id] || !at || at.slice(0, 10) < since) return;
    calls[id] = { id: 'call_' + id, at: at, secs: String(secs == null ? '' : secs), direction: String(direction || '').toLowerCase(),
                  line: team ? '+1' + team : '' };
  };
  var hot = null;
  try {
    var hotId = String(hubId_('HOTLINE_TRANSCRIPTS_ID') || '');
    if (hotId) hot = ssOpen_(hotId).getSheetByName(HOTLINE_TRANSCRIPTS_TAB);
  } catch (eH) { hot = null; }
  if (!hot) { why.push('The hotline transcripts book could not be opened, so its calls are not listed.'); degraded = true; }
  else {
    var hc = spReadColumns_(hot, {
      id: { names: ['Call ID'], at: HOTLINE_COLS.CALL_ID }, created: { names: ['Transcript Created'], at: 1 },
      event: { names: ['Event Timestamp'], at: HOTLINE_COLS.EVENT_TS }, secs: { names: ['Duration (sec)'], at: 3 },
      who: { names: ['Participant(s)'], at: HOTLINE_COLS.PARTICIPANTS }, team: { names: ['Team Member(s)'], at: HOTLINE_COLS.TEAM },
      dir: { names: ['Direction'] }
    });
    var h = hc.cols;
    for (var i = 0; i < hc.n; i++) {
      if (!spNumbers_(h.who[i]).some(hit)) continue;
      take(String(h.id[i] || '').trim(), ssaWhen_(h.event[i]) || ssaWhen_(h.created[i]), h.secs[i], h.dir[i],
           spNumbers_(h.team[i])[0]);
    }
  }
  try {
    var qt = hubTabSheet_('quo_transcripts');
    if (qt) {
      var qc = spReadColumns_(qt, {
        id: { names: ['call_id'] }, created: { names: ['transcript_created'] }, event: { names: ['event_at'] },
        secs: { names: ['duration_s'] }, dir: { names: ['direction'] }, who: { names: ['participants'] },
        team: { names: ['team_members'] }
      });
      var q = qc.cols;
      for (var j = 0; j < qc.n; j++) {
        if (!spNumbers_(q.who[j]).some(hit)) continue;
        take(String(q.id[j] || '').trim(), ssaWhen_(q.created[j]) || ssaWhen_(q.event[j]), q.secs[j], q.dir[j],
             spNumbers_(q.team[j])[0]);
      }
    }
  } catch (eQ) { why.push(ssaWhy_('The transcripts house', eQ)); degraded = true; }
  return { calls: Object.keys(calls).map(function (k) { return calls[k]; }), degraded: degraded };
}

/** The mail log's envelopes to, from or copying one of the SSA's addresses since `since`. */
function ssaMail_(emails, since) {
  var sheet = hubTabSheet_(MAIL_LOG_TAB);
  if (!sheet) throw new Error('the mail log (' + MAIL_LOG_TAB + ') could not be opened');
  var cols = spReadColumns_(sheet, {
    id: { names: ['id'] }, at: { names: ['at'] }, dir: { names: ['direction'] }, from: { names: ['from'] },
    to: { names: ['to'] }, cc: { names: ['cc'] }, subject: { names: ['subject'] }, preview: { names: ['preview'] }
  });
  var c = cols.cols, out = [];
  for (var i = 0; i < cols.n; i++) {
    var seen = ssaAddresses_([c.from[i], c.to[i], c.cc[i]]);
    if (!emails.some(function (e) { return seen[e]; })) continue;
    var at = ssaWhen_(c.at[i]);
    if (!at || at.slice(0, 10) < since) continue;
    var from = ssaAddresses_([c.from[i]]);
    out.push({ id: 'mail_' + String(c.id[i] || ('row' + (i + 2))), at: at,
               from_ssa: emails.some(function (e) { return from[e]; }), from: locationsText_(c.from[i], 200),
               subject: locationsText_(c.subject[i], 200), preview: String(c.preview[i] == null ? '' : c.preview[i]) });
  }
  return out;
}

function ssaNotesSheet_(create) {
  return create ? hubTabEnsure_(SSA_NOTES_TAB, SSA_NOTES_HEADER) : hubTabSheet_(SSA_NOTES_TAB);
}

/** One SSA's notes, newest first; [] while the tab is unborn. */
function ssaNotesFor_(key) {
  var sheet = ssaNotesSheet_(false);
  if (!sheet) return [];
  return locationsTabRows_(sheet).filter(function (r) { return String(r.ssa_key || '') === key; }).map(function (r) {
    return { id: String(r.id || ''), at: String(r.at || ''), by: String(r.by || ''), body: String(r.body || '') };
  }).sort(ssaNewest_);
}

function ssaActivityBuild_(ctx) {
  var s = ctx.ssa, why = ctx.why.slice(), degraded = ctx.degraded;
  var since = locationsDayShift_(locationsToday_(), -SSA_ACTIVITY_DAYS);
  var items = [];
  var add = function (id, at, kind, title, body, by, clientKey) {
    var when = ssaWhen_(at);
    if (!when) return;
    items.push({ id: id, at: when, kind: kind, title: title, body: locationsText_(body, 240), by: by || '',
                 client_key: clientKey || '' });
  };
  try {
    ssaNotesFor_(s.key).forEach(function (n) { add('note_' + n.id, n.at, 'note', 'Admin note', n.body, n.by, ''); });
  } catch (eN) { why.push(ssaWhy_('The SSA notes', eN)); degraded = true; }
  var isps = {};
  try { isps = ssaIspsByKey_(); } catch (eI) { why.push(ssaWhy_('The plans', eI)); degraded = true; }
  s.clients.forEach(function (c) {
    var isp = isps[c.client_key];
    var year = locationsText_((isp && isp.isp_year) || c.isp_year, 80);
    add('record_' + c.client_key, c.isp_signed || cpDay_(isp && isp.loaded_at), 'record', 'Named SSA — ' + c.name,
        (c.isp_signed ? 'ISP signed' : 'ISP on file') + (year ? ' · ' + year : ''), '', c.client_key);
  });
  var own = ssaOwnPhones_(ctx);
  var mine = Object.keys(own.mine).length;
  if (own.shared) {
    why.push(own.shared + ' phone number(s) on the records also belong to another SSA or to a company line, so texts ' +
             'and calls on them are not attributed.');
  }
  if (mine) {
    try {
      ssaTexts_(own, since).forEach(function (t) {
        add(t.id, t.at, 'sms', (t.incoming ? 'Text from ' + s.name : 'Text to ' + s.name) + ' · ' + t.line, t.body,
            t.incoming ? s.name : t.owner, '');
      });
    } catch (eT) { why.push(ssaWhy_('The texts', eT)); degraded = true; }
    try {
      var got = ssaCalls_(own, since, why);
      if (got.degraded) degraded = true;
      got.calls.forEach(function (k) {
        var mins = Number(k.secs) > 0 ? Math.max(1, Math.round(Number(k.secs) / 60)) + ' min' : '';
        add(k.id, k.at, 'call', (k.direction === 'outgoing' ? 'Call to ' : 'Call with ') + s.name,
            [k.line, mins].filter(String).join(' · '), '', '');
      });
    } catch (eK) { why.push(ssaWhy_('The calls', eK)); degraded = true; }
  }
  if (s.emails.length) {
    try {
      ssaMail_(s.emails, since).forEach(function (m) {
        add(m.id, m.at, 'mail', m.subject || '(no subject)', m.preview, m.from_ssa ? s.name : m.from, '');
      });
    } catch (eM) { why.push(ssaWhy_('The mail log', eM)); degraded = true; }
  }
  items.sort(ssaNewest_);
  var today = locationsToday_();
  var rank = { overdue: 0, to_schedule: 1, current: 2, '': 3 };
  var followups = s.clients.filter(clientLive_).map(function (c) {
    var isp = isps[c.client_key];
    var span = csfSpan_((isp && isp.isp_year) || c.isp_year);
    var due = span ? span.end : '';
    return { client_key: c.client_key, name: c.name, what: 'ISP review', due: due, status: ssaFollowupState_(due, today) };
  }).sort(function (a, b) {
    return (rank[a.status] - rank[b.status]) || (a.due < b.due ? -1 : (a.due > b.due ? 1 : 0)) || a.name.localeCompare(b.name);
  });
  return { items: items.slice(0, SSA_ACTIVITY_CAP), total: items.length, followups: followups,
           phones_matched: mine, why: why, degraded: degraded };
}

// An SSA's own activity: never the admin notes; the records and follow-ups of the clients in their scope; the…
function ssaActivityCut_(data, cut, ctx) {
  var comms = ((ctx && ctx.ssa && ctx.ssa.emails) || []).length <= 1;
  var items = (data.items || []).filter(function (i) {
    if (i.kind === 'note') return false;
    if (i.kind === 'record') return ssaMine_(cut, i.client_key);
    return comms;
  });
  var why = (data.why || []).slice();
  if (!comms) {
    why.push('The client records give this SSA more than one e-mail, so texts, calls and e-mails are not shown.');
  }
  return ssaWith_(data, { items: items, total: items.length, why: why,
                          followups: (data.followups || []).filter(function (f) { return ssaMine_(cut, f.client_key); }) });
}

function ssaActivityDoor_(payload, cut) {
  var ctx = ssaProfilesSsa_(payload && payload.ssa);
  if (ctx.refused) return ctx.refused;
  return ssaCutAnswer_(ssaServe_('ssaProfileActivity', ctx, ssaIndexDeps_(), 'The activity', function () {
    return ssaActivityBuild_(ctx);
  }), cut, function (d) { return ssaActivityCut_(d, cut, ctx); });
}

HUB_POLICY.ssaProfileActivity = {
  file: 'SsaProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { ssa: { type: 'string' } }
};
/** Activity: notes, texts, calls, e-mails and the records naming the SSA, newest first, and each client's ISP review. */
HUB_ACTIONS.ssaProfileActivity = function (payload, user) {
  var gate = ssaProfilesGate_(user);
  if (!gate.open) return ssaProfilesUnknown_();
  var cut = ssaProfilesCut_(gate.scope);
  // a client or family sees no correspondence; an SSA their own
  if (cut && cut.kind !== 'ssa') return ssaProfilesUnknown_();
  if (ssaProfilesOutside_(cut, payload)) return ssaProfilesUnknown_();
  return ssaActivityDoor_(payload, cut);
};

// ---- notes ----------------------------------------------------------------

function ssaNotesDoor_(payload) {
  var ctx = ssaProfilesSsa_(payload && payload.ssa);
  if (ctx.refused) return ctx.refused;
  return ssaShown_(ssaServe_('ssaProfileNotes', ctx, [], 'The SSA notes', function () {
    return { notes: ssaNotesFor_(ctx.key) };
  }));
}

HUB_POLICY.ssaProfileNotes = {
  file: 'SsaProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { ssa: { type: 'string' } }
};
/** Admin notes about the SSA, newest first; internal, so never to a cut viewer. */
HUB_ACTIONS.ssaProfileNotes = function (payload, user) {
  var gate = ssaProfilesGate_(user);
  if (!gate.open || ssaProfilesCut_(gate.scope)) return ssaProfilesUnknown_();
  return ssaNotesDoor_(payload);
};

HUB_POLICY.ssaProfileNoteAdd = {
  file: 'SsaProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { ssa: { type: 'string' }, body: { type: 'string' } }
};
/** File an admin note about the SSA; the filer and the time are the session's. The master's alone. */
HUB_ACTIONS.ssaProfileNoteAdd = function (payload, user) {
  if (!ssaProfilesMaster_(user)) return ssaProfilesUnknown_();
  var ctx = ssaProfilesSsa_(payload && payload.ssa);
  if (ctx.refused) return ctx.refused;
  var body = String((payload && payload.body) || '').trim();
  if (!body) return { status: 400, message: 'body: what the note says.' };
  if (body.length > SSA_NOTE_MAX) return { status: 400, message: 'body: up to ' + SSA_NOTE_MAX + ' characters.' };
  var held = sheetDbGateHolds_(SSA_NOTES_TAB, 'create');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return { status: 409, message: 'Another write is in progress — try again in a moment.' };
  var note;
  try {
    var sheet;
    try { sheet = ssaNotesSheet_(true); }
    catch (eS) { return { status: 503, message: 'The SSA notes store is not set up (' + String((eS && eS.message) || eS).slice(0, 120) + ').' }; }
    note = { id: 'SSAN_' + Utilities.getUuid(), ssa_key: ctx.key, ssa_name: ctx.name, body: body, by: locationsWho_(user),
             at: new Date().toISOString() };
    locationsAppend_(sheet, SSA_NOTES_HEADER, note);
  } finally { lock.releaseLock(); }
  ['ssaProfileNotes', 'ssaProfileActivity', 'ssaProfileOverview'].forEach(function (a) { ssaBump_(a, ctx.key); });
  hubSysLog_(str_(user.email), 'ssaProfileNoteAdd', ctx.key, { status: 200 });
  return { status: 200, data: { note: { id: note.id, at: note.at, by: note.by, body: note.body } } };
};

// ---- the relay's pack -----------------------------------------------------

/** Each part's door, past its gate, asked for one SSA; the client views read the parts gathered before them. */
function ssaPackDoors_(key, parts) {
  var ask = { ssa: key };
  return {
    overview: function () { return ssaOverviewDoor_(ask); },
    documents: function () { return ssaDocumentsDoor_(ask); },
    activity: function () { return ssaActivityDoor_(ask); },
    notes: function () { return ssaNotesDoor_(ask); },
    client_views: function () { return ssaClientViews_(key, parts || {}); }
  };
}

// { <client key>: view } for each live client of the SSA (clientLive_) — the one SSA its record names — with the…
function ssaClientViews_(key, parts) {
  if (!parts.overview || !parts.documents) {
    return { status: 503, message: 'Not cut: the overview or the documents did not answer.' };
  }
  var ctx = ssaProfilesSsa_(key);
  if (ctx.refused) return ctx.refused;
  var out = {};
  (ctx.ssa.clients || []).forEach(function (c) {
    var k = String((c && c.client_key) || '');
    if (!k || !clientLive_(c) || out[k]) return;
    var cut = { kind: 'client', ssas: {}, clients: {} };
    cut.ssas[key] = true;
    cut.clients[k] = true;
    out[k] = {
      roster: ssaWith_(ssaScrub_(ssaRosterBuild_(cut)), { viewer: 'client' }),
      overview: ssaOverviewCut_(parts.overview, cut),
      documents: ssaDocumentsCut_(parts.documents, cut)
    };
  });
  return { status: 200, data: out };
}

// The relay's pack: overview, documents, activity and notes of one SSA, each its own door's answer and cache, the…
HUB_POLICY.ssaPack = {
  file: 'SsaProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: [],
  params: { ssa: { type: 'string' } }
};
HUB_ACTIONS.ssaPack = function (payload, user) {
  if (!user || !(user.is_service === true || ssaProfilesMaster_(user))) return ssaProfilesUnknown_();
  var started = Date.now();
  var heldClients = CLIENTS_DERIVED_MEMO_, heldIndex = SSA_INDEX_MEMO_;
  CLIENTS_DERIVED_MEMO_ = {};
  SSA_INDEX_MEMO_ = {};
  try {
    var ctx = ssaProfilesSsa_(payload && payload.ssa);
    if (ctx.refused) return ctx.refused;
    var parts = {}, status = {};
    var doors = ssaPackDoors_(ctx.key, parts);
    SSA_PACK_PARTS.forEach(function (name) {
      if (Date.now() - started > SSA_PACK_BUDGET_MS) {
        status[name] = { status: 503, message: 'This part was not gathered in this pack; it is read on its own.' };
        return;
      }
      try {
        var got = doors[name]();
        if (got && got.status === 200 && got.data !== undefined && got.data !== null) {
          parts[name] = got.data;
          status[name] = { status: 200 };
        } else {
          status[name] = { status: Number(got && got.status) || 503,
                           message: String((got && got.message) || 'This part did not answer.').slice(0, 200) };
        }
      } catch (e) {
        status[name] = { status: 503, message: 'This part could not be read just now (' +
                         String((e && e.message) || e).slice(0, 120) + ').' };
      }
    });
    return { status: 200, data: { ssa: ctx.key, built_at: new Date(started).toISOString(), parts: parts,
                                  part_status: status } };
  } finally {
    CLIENTS_DERIVED_MEMO_ = heldClients;
    SSA_INDEX_MEMO_ = heldIndex;
  }
};
