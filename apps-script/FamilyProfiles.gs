// Families: one family member of the clients at a time — the client record's guardian, the plan's family among its…
// The reads answer whom the app's App Control row releases it to, cut by the viewer scope (ViewerScope.gs); the…

var FAM_APP_ID = 'family-profiles';
var FAM_ACTIONS = ['familyProfileRoster', 'familyProfileOverview', 'familyProfileDocuments', 'familyProfileActivity',
                   'familyProfileNotes', 'familyProfileDocFile', 'familyProfileNoteAdd', 'familyProfileCallSchedule',
                   'familyProfileIncidentTie', 'familyProfileSave'];
// A narrowed viewer's cut: what it is, and the activity a client or a family member keeps of its own clients.
var FAM_VIEW_KINDS = ['all', 'client', 'guardian', 'ssa'];
var FAM_NARROW_KINDS = ['isp', 'calendar', 'incident'];
var FAM_NOTES_TAB = 'family_notes';
// kind: a note (blank on the first rows) or an incident filed from this app, tied by client_key and incident_ts.
var FAM_NOTES_HEADER = ['id', 'family_key', 'family_name', 'body', 'by', 'at', 'kind', 'client_key', 'incident_ts'];
var FAM_NOTE_MAX = 4000;
var FAM_CALL_PRIORITIES = ['normal', 'high', 'urgent'];
var FAM_CALL_SOURCE = 'families';
var FAM_CALL_LABEL = 'Family call';
var FAM_CALL_WEEK_DAYS = 7;
var FAM_PACK_PARTS = ['overview', 'documents', 'activity', 'notes'];
// Past this a pack starts no further part, so it always answers inside the execution limit.
var FAM_PACK_BUDGET_MS = 240000;
// The relay's index of the whole app: what every open of Families starts on, for every family member at once.
var FAM_INDEX_PARTS = ['roster', 'aliases', 'overviews', 'notes'];
var FAM_ACTIVITY_DAYS = 365;
var FAM_CALENDAR_AHEAD_DAYS = 30;
var FAM_ACTIVITY_CAP = 400;
var FAM_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var FAM_MIMES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
                  doc: 'application/msword',
                  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
// A family word in a relationship, a role or a name's own parenthesis; the longer spellings first.
var FAM_WORDS = new RegExp('\\b(step-?(?:mother|father|mom|dad|sister|brother|son|daughter|parent)|' +
  '(?:mother|father|sister|brother|son|daughter)[- ]in[- ]law|in-laws?|' +
  'grand(?:mother|father|ma|pa|parents?|son|daughter|child(?:ren)?)|great[- ]?(?:aunt|uncle)|' +
  'half[- ]?(?:brother|sister)|mother|father|mom|mommy|mum|dad|daddy|parents?|sisters?|brothers?|siblings?|' +
  'aunt|auntie|uncle|cousin|son|daughter|spouse|wife|husband|niece|nephew|family|relative)\\b', 'i');
// Roles the plan gives people who are never the family, whatever else the row says.
var FAM_NOT_FAMILY_ROLES = new RegExp('\\b(ssa|case manager|case ?worker|support administrat\\w*|physician|doctor|pcp|' +
  'medical provider|home provider|provider|employer|therapist|pharmacy|payee|nurse|dentist|roommate|social worker|' +
  'job coach|coordinator|counsel+or|psychiatrist|psychologist|teacher|dsp)\\b', 'i');
// The plan's Important People table ends at the first of these, or at any section the Clients app stops at.
var FAM_PLAN_TABLE_END = /^(Important Places|Important To\b|Important For\b|Discovery Assessment)/i;
// A record relationship that says only that they are the guardian; any other with no family word is no family tie.
var FAM_BARE_GUARDIAN_REL = /^(n\/?a|none|unknown|guardian|legal guardian|guardian(ship)? of (the )?person)$/i;
var FAM_APPOINTED_TEXT = /\b(state|court)[- ]appointed\b|\bprofessional (guardian|services)\b|\bguardianship services\b|\bagency\b/i;
// A name that is an organisation, never a person.
var FAM_ORG = new RegExp('\\b(services?|agency|inc|llc|board|office|probate|guardianship|program|center|centre|' +
  'association|trust|bank|hospital|clinic|department|dept|court|corp|company|group|foundation|society|county|' +
  'ministries)\\b', 'i');
// A client file is listed only when it is a plan the Clients door serves or a guardianship paper, and never one of these.
var FAM_DOC_REFUSED_CATEGORIES = ['identity', 'medical', 'receipt_invoice', 'insurance'];
var FAM_DOC_REFUSED_FOLDER = /\b(funds|receipts?)\b/i;
var FAM_GUARDIANSHIP_DOC = /guardianship|letters? of (authority|guardianship)/i;
var FAM_SOURCE_LABELS = { record: 'Client record', isp: 'ISP important people', directory: 'People directory' };
// Set only while familyPack runs, so the books are read once per pack.
var FAM_INDEX_MEMO_ = null;

/** FAIL-CLOSED: the master in its own session, never a visit or a service call — the writes' gate. */
function familyProfilesMasterGate_(user) {
  try { return !!hubIsRealMaster_(user); } catch (e) { return false; }
}

// FAIL-CLOSED: how far this session reads Families — { kind, scope, user } — or null.
function familyProfilesGate_(user) {
  if (familyProfilesMasterGate_(user)) return { kind: 'master', scope: null, user: user };
  var gate = null;
  try { gate = hubProfileAppGate_(FAM_APP_ID, user); } catch (e) { gate = null; }
  var kind = gate && gate.open && gate.scope ? str_(gate.scope.kind) : '';
  if (FAM_VIEW_KINDS.indexOf(kind) === -1) return null;
  return { kind: kind, scope: gate.scope, user: user };
}

function familyProfilesUnknown_() {
  return { status: 404, message: 'Unknown action.' };
}

// ---- pure helpers ---------------------------------------------------------

function famWhy_(what, e) {
  return what + ' could not be read (' + String((e && e.message) || e).slice(0, 120) + ').';
}

function famTitle_(s) {
  var t = String(s || '').trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/** The family word a text carries, first letter up ("his mom" → "Mom"); '' when none. */
function famRelation_(text) {
  var m = FAM_WORDS.exec(String(text == null ? '' : text));
  return m ? famTitle_(m[1]) : '';
}

/** 'fam_' + the folded display name; '' for a blank, a non-person ("Self", "N/A") or an organisation. */
function famKeyOf_(name) {
  var n = locationsText_(name, 200);
  if (!n || !guardianIsPerson_(n) || FAM_ORG.test(n)) return '';
  var fold = clientNameKey_(n);
  return fold.length >= 3 ? 'fam_' + fold : '';
}

// A roster name: labels, parentheticals and everything after the first comma go (the guardian roster's own rule)…
function famName_(raw) {
  var s = locationsText_(guardianDisplayName_(raw), 120);
  return s.replace(/\s*[\/\-–—]\s*([^\/\-–—]*)$/, function (all, tail) { return FAM_WORDS.test(tail) ? '' : all; }).trim();
}

/** A plan person's key: none for a bare relationship; a first name alone is keyed to its client and names nobody beyond it. */
function famPlanKey_(name, clientFold) {
  if (famOnlyRelation_(name)) return '';
  var k = famKeyOf_(name);
  return k && famTokens_(name).length < 2 ? k + clientFold : k;
}

/** A name that is only a relationship ("Mom", "Brother") names nobody. */
function famOnlyRelation_(name) {
  var t = locationsText_(name).replace(/[^a-z\s-]/gi, '').trim();
  var m = FAM_WORDS.exec(t);
  return !!m && m.index === 0 && m[0].length === t.length;
}

function famEmail_(v) {
  var s = locationsText_(v, 200).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(s) ? s : '';
}

/** A plan cell's address without the relationship word the table wrapped onto its start. */
function famAddress_(v) {
  var s = locationsText_(v, 300);
  var m = FAM_WORDS.exec(s);
  if (m && !/[^\s(]/.test(s.slice(0, m.index))) s = s.slice(m.index + m[0].length);
  return s.replace(/^[\s(),:;\-–—]+/, '').trim();
}

function famTokens_(name) {
  return locationsText_(name).split(' ').map(clientNameKey_).filter(String);
}

function famRelClass_(rel) {
  var r = String(rel || '').trim().toLowerCase();
  if (/^(mom|mother|mommy|mum)$/.test(r)) return 'mother';
  if (/^(dad|father|daddy)$/.test(r)) return 'father';
  return '';
}

// Two ties of one client are one person: the same surname and the same first three letters with no phone or e-mail…
function famSamePerson_(a, b) {
  var ta = famTokens_(a.name), tb = famTokens_(b.name);
  var phoneA = spDigits10_(a.phone), phoneB = spDigits10_(b.phone);
  if (ta.length >= 2 && tb.length >= 2 && ta[ta.length - 1] === tb[tb.length - 1] &&
      ta[0].length >= 3 && ta[0].slice(0, 3) === tb[0].slice(0, 3)) {
    return !(phoneA && phoneB && phoneA !== phoneB) && !(a.email && b.email && a.email !== b.email);
  }
  var cls = famRelClass_(a.relationship);
  if (!cls || cls !== famRelClass_(b.relationship)) return false;
  return (!!phoneA && phoneA === phoneB) || (!!a.email && a.email === b.email);
}

// The record's guardian as a tie: family (a family word in the relationship, else in the plan's guardian line), not…
function famRecordTie_(rel, segment) {
  var r = locationsText_(rel, 80);
  var said = famRelation_(r);
  if (said) return { family: true, relationship: said };
  if (r && !FAM_BARE_GUARDIAN_REL.test(r.replace(/[.\s]+$/, ''))) return { family: false, relationship: r };
  said = famRelation_(segment);
  if (said) return { family: true, relationship: said };
  if (FAM_APPOINTED_TEXT.test(String(segment || ''))) return { family: false, relationship: '' };
  return { family: null, relationship: 'Guardian' };
}

// One of the plan's important people as a family tie, or null: never a role that is not family, and the…
function famPlanTie_(p) {
  var role = locationsText_(p && p.role, 120);
  if (!role || FAM_NOT_FAMILY_ROLES.test(role)) return null;
  var said = famRelation_(p.name) || famRelation_(role);
  return said ? { family: true, relationship: said } : null;
}

/** The most common non-blank value, the first seen on a tie. */
function famMost_(list) {
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
function famPick_(list) {
  return famMost_(list.filter(function (x) { return x.active; }).map(function (x) { return x.v; })) ||
         famMost_(list.map(function (x) { return x.v; }));
}

function famMime_(name) {
  var m = /\.([a-z0-9]{2,5})\s*$/i.exec(String(name || ''));
  return (m && FAM_MIMES[m[1].toLowerCase()]) || '';
}

/** An instant as ISO text: a Date, an ISO cell as written, any other date text parsed; '' otherwise. */
function famWhen_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  var s = String(v == null ? '' : v).trim();
  if (!s || /^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  var t = Date.parse(s);
  return isNaN(t) ? '' : new Date(t).toISOString();
}

function famNewest_(a, b) {
  return a.at < b.at ? 1 : (a.at > b.at ? -1 : 0);
}

/** "2026-09-15" → "Sep 15, 2026"; anything else as it is. */
function famDayWords_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? FAM_MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1] : String(iso || '');
}

/** A cell names the person when one of their whole folded names sits inside it. */
function famNamed_(names, cells) {
  var keys = (names || []).map(clientNameKey_).filter(function (k) { return k.length >= 5; });
  if (!keys.length) return false;
  return (cells || []).some(function (c) {
    var hay = clientNameKey_(c);
    return !!hay && keys.some(function (k) { return hay.indexOf(k) !== -1; });
  });
}

// A client file Families lists: a plan the Clients door serves (cpPlanFile_) or a guardianship paper — never an…
function famDocServed_(r) {
  if (!r || FAM_DOC_REFUSED_CATEGORIES.indexOf(String(r.digest_category || '').trim().toLowerCase()) !== -1) return false;
  if (FAM_DOC_REFUSED_FOLDER.test(String(r.folder || ''))) return false;
  if (cpPlanFile_(r)) return true;
  if (/ssn|social.?security|identity|licen[cs]e|state_id|birth|passport/i.test(String(r.doc_kind || ''))) return false;
  return String(r.doc_kind || '').trim().toLowerCase() === 'guardianship' ||
         FAM_GUARDIANSHIP_DOC.test(String(r.title || '') + ' ' + String(r.folder || ''));
}

// Last guard on every Families answer: cpScrub_, and an SSN or a card number written with spaces, dots or dashes…
function famScrub_(v, key) {
  if (key && CP_SCRUB_KEYS[key]) return v;
  if (typeof v === 'string') {
    return cpScrub_(v.replace(/(^|\D)\d{3}[\s.-]\d{2}[\s.-]\d{4}(?=\D|$)/g, '$1[withheld]')
                     .replace(/(^|\D)\d(?:[ -]?\d){12,18}(?=\D|$)/g, '$1[withheld]'));
  }
  if (Array.isArray(v)) return v.map(function (x) { return famScrub_(x); });
  if (v && typeof v === 'object') {
    var out = {};
    Object.keys(v).forEach(function (k) { out[k] = famScrub_(v[k], k); });
    return out;
  }
  return cpScrub_(v);
}

/** A Drive file a record cell points at (a link or a bare id); '' for "Yes", "No" and the like. */
function famDriveId_(v) {
  var s = locationsText_(v, 500);
  return locationsDriveId_(s) || (/^[A-Za-z0-9_-]{25,}$/.test(s) ? s : '');
}

function famHouseCode_(house) {
  return locationsHouseCode_(house) || locationsCode_(house);
}

// ---- the index ------------------------------------------------------------

/** A client's Master fields less the columns its Hub record cleared on purpose (cleared_fields). */
function famMasterKept_(fields, row) {
  var out = {};
  Object.keys(fields || {}).forEach(function (k) { out[k] = fields[k]; });
  Object.keys(hubEditCleared_(row && row.cleared_fields)).forEach(function (col) {
    (CP_FIELD_NAMES[col] || [col]).forEach(function (n) { delete out[n]; });
  });
  return out;
}

function famIspsByKey_() {
  var out = {};
  listRows_('isps', {}).forEach(function (r) {
    var k = String(r.client_key || '').trim();
    if (k && !out[k]) out[k] = r;
  });
  return out;
}

/** The plans' important-people sections, by client key; {} while the tab is unborn. */
function famPlanSections_() {
  var out = {};
  cpOwnRows_(CP_SECTIONS_TAB).forEach(function (r) {
    if (String(r.section || '') !== 'important_people') return;
    var k = String(r.client_key || '').trim();
    if (k) (out[k] = out[k] || []).push(r);
  });
  return out;
}

// The Important People table alone: page furniture out (the table runs across pages), and nothing past the next…
function famPlanTable_(text) {
  var lines = cpPlanLines_(text);
  var at = -1;
  for (var i = 0; i < lines.length && at === -1; i++) if (/^Important People\b/i.test(lines[i])) at = i;
  if (at === -1) return '';
  var stop = new RegExp('^(?:' + CP_STOP_LABELS.filter(function (l) { return l !== 'Important People'; }).join('|') + ')', 'i');
  var out = [lines[at]];
  for (var j = at + 1; j < lines.length; j++) {
    if (FAM_PLAN_TABLE_END.test(lines[j]) || stop.test(lines[j])) break;
    out.push(lines[j]);
  }
  return out.join('\n');
}

/** The plan's Important People for one client: the filed section of its plan year, else the contact page. */
function famPlanPeople_(key, isp, sections) {
  var text = '';
  var year = locationsText_(isp && isp.isp_year);
  (sections[key] || []).forEach(function (r) {
    if (!text || String(r.isp_year) === year) text = String(r.text || '');
  });
  if (!text && isp) text = String(isp.contact_block || '');
  var table = famPlanTable_(text);
  return { text: table, people: ispPeople_(table) };
}

// Every family member the clients' records name, keyed fam_<folded name>: the record's guardian (the Hub row, else…
function famIndexBuild_() {
  var why = [], degraded = false;
  var active = null, master = null, arch = null, photos = {}, isps = {}, sections = {}, people = [];
  try { active = clientsDerived_(null); } catch (eC) { why.push(famWhy_('The client records', eC)); degraded = true; }
  try { master = cpMasterIndex_(); } catch (eM) { why.push(famWhy_('The Asa Client Database', eM)); degraded = true; }
  try { arch = cpArchiveIndex_(); } catch (eA) { why.push(famWhy_('The archive of old clients', eA)); degraded = true; }
  if (!active && !arch) throw new Error(why.join(' '));
  try { photos = clientPhotoIndex_(); } catch (eP) { photos = {}; }
  try { isps = famIspsByKey_(); } catch (eI) { why.push(famWhy_('The plans', eI)); degraded = true; }
  try { sections = famPlanSections_(); } catch (eS) { why.push(famWhy_('The plans\' important people', eS)); degraded = true; }
  try { people = listRows_('people', {}); } catch (eD) { why.push(famWhy_('The people directory', eD)); degraded = true; people = []; }

  var clients = [], byFold = {}, seen = {}, hub = {};
  var recordTie = function (cl, name, rel, segment, phone, email, address, plan) {
    var judged = famRecordTie_(rel, segment);
    var n = famName_(name);
    var tie = { key: famKeyOf_(n), name: n, relationship: judged.relationship, family: judged.family, source: 'record',
                phone: cpPhone_(phone), email: famEmail_(email), address: locationsText_(address, 300),
                in_plan: famNamed_([n, name], [plan]) };
    if (tie.key) { cl.record_key = tie.key; cl.ties.push(tie); }
  };
  (active || []).forEach(function (c) {
    var row = cpRosterRow_(c, photos);
    if (!row.client_key || seen[row.client_key]) return;
    seen[row.client_key] = true;
    var fold = clientNameKey_(row.name);
    var m = master ? master.rows[fold] : null;
    // set inactive, its Master row went to the archive: that row still names its guardian
    if (!m && arch && !clientLive_(row)) m = arch.rows[fold] || null;
    var mf = m && !m.ambiguous ? famMasterKept_(m.fields, c) : {};
    var isp = isps[row.client_key] || null;
    var plan = famPlanPeople_(row.client_key, isp, sections);
    var planText = [plan.text, isp && isp.contact_block, isp && isp.contacts, c.contacts].join('\n');
    var cl = { client_key: row.client_key, fold: fold, name: row.name, house: row.house, status: row.status,
               avatar: row.avatar, isp_year: locationsText_((isp && isp.isp_year) || row.isp_year),
               isp_day: cpDay_(c.isp_signed_date || mf.isp_signed_date) || cpDay_(isp && isp.loaded_at),
               papers: famDriveId_(c.guardianship_papers || mf.guardianship_papers), archived: false,
               record_key: '', record_blank: false, ties: [] };
    var gHub = locationsText_(c.guardianName || c.guardian_name, 200);
    var gMaster = locationsText_(mf.guardian_name, 200);
    cl.record_blank = !gHub && !gMaster;
    var src = guardianIsPerson_(gHub) ? c : (!gHub && guardianIsPerson_(gMaster) ? mf : null);
    if (src) {
      if (src === c) hub[row.client_key] = true;
      var gRaw = src === c ? gHub : gMaster;
      var same = function (o, n) { return clientNameKey_(famName_(n)) === clientNameKey_(famName_(gRaw)) ? o : {}; };
      var a = same(c, gHub), b = same(mf, gMaster);
      recordTie(cl, gRaw, a.guardian_relationship || b.guardian_relationship, guardianContactSegment_(c.contacts),
                a.guardian_phone || b.guardian_phone, a.guardian_email || b.guardian_email,
                a.guardian_address || b.guardian_address, planText);
    }
    var planSeen = {};
    plan.people.forEach(function (p) {
      var n = famName_(p.name);
      var k = famPlanKey_(n, fold);
      if (!k || planSeen[k] || k === 'fam_' + fold) return;
      var judged = famPlanTie_(p);
      if (!judged) return;
      planSeen[k] = true;
      cl.ties.push({ key: k, name: n, relationship: judged.relationship, family: true, source: 'isp',
                     phone: cpPhone_(p.phone), email: famEmail_(p.email), address: famAddress_(p.address), in_plan: true });
    });
    clients.push(cl);
    byFold[fold] = cl;
  });
  if (arch) {
    arch.order.forEach(function (k) {
      var hit = arch.rows[k];
      if (!hit || hit.ambiguous || seen[k] || byFold[k]) return;
      seen[k] = true;
      var f = hit.fields || {};
      var cl = { client_key: k, fold: k, name: locationsText_(hit.name), house: locationsText_(f.house), status: 'inactive',
                 avatar: String(photos[k] || ''), isp_year: '', isp_day: cpDay_(f.isp_signed_date),
                 papers: famDriveId_(f.guardianship_papers), archived: true, record_key: '',
                 record_blank: !locationsText_(f.guardian_name), ties: [] };
      if (guardianIsPerson_(f.guardian_name)) {
        recordTie(cl, f.guardian_name, f.guardian_relationship, '', f.guardian_phone, f.guardian_email,
                  f.guardian_address, '');
      }
      clients.push(cl);
      byFold[k] = cl;
    });
  }

  // One person under two spellings of one client's record and plan answers to the record's key.
  var aliases = {};
  clients.forEach(function (cl) {
    var rec = null;
    cl.ties.forEach(function (t) { if (t.source === 'record') rec = t; });
    if (!rec) return;
    cl.ties.forEach(function (t) {
      if (t === rec || t.key === rec.key || aliases[t.key]) return;
      if (famSamePerson_(rec, t)) aliases[t.key] = rec.key;
    });
  });
  var canon = function (k) { return aliases[k] || k; };

  var dir = {};
  (people || []).forEach(function (p) {
    var isGuardian = String(p.role || '').trim().toLowerCase() === 'guardian' || !!locationsText_(p.guardian_for);
    if (!isGuardian) return;
    var n = famName_(p.name);
    var k = canon(famKeyOf_(n));
    if (!k) return;
    dir[k] = dir[k] || { person_id: String(p.id || ''), avatar: locationsText_(p.avatar, 500) };
    String(p.guardian_for || '').split(',').forEach(function (who) {
      var cl = byFold[clientNameKey_(who)];
      if (!cl) return;
      if (!(cl.record_key ? canon(cl.record_key) === k : cl.record_blank)) return;
      cl.ties.push({ key: k, name: n, relationship: 'Guardian', family: null, source: 'directory',
                     phone: cpPhone_(p.phone), email: famEmail_(p.email), address: '', in_plan: false });
    });
  });

  var acc = {};
  var rank = function (t) { return t.family === true ? (t.source === 'record' ? 0 : 1) : (t.family === null ? 2 : 3); };
  clients.forEach(function (cl) {
    var live = clientLive_(cl);
    cl.ties.forEach(function (t) {
      var k = canon(t.key);
      var a = acc[k] || (acc[k] = { names: [], phones: [], emails: [], addresses: [], byClient: {},
                                    family: false, unknown: false, appointed: false });
      if (t.family === true) a.family = true; else if (t.family === null) a.unknown = true; else a.appointed = true;
      a.names.push({ v: t.name, active: live });
      if (spDigits10_(t.phone)) a.phones.push({ v: t.phone, active: live });
      if (t.email) a.emails.push({ v: t.email, active: live });
      if (t.address) a.addresses.push({ v: t.address, active: live });
      var had = a.byClient[cl.client_key] ||
        (a.byClient[cl.client_key] = { client: cl, tie: t, in_plan: false, sources: {} });
      had.sources[t.source] = true;
      if (t.in_plan) had.in_plan = true;
      if (rank(t) < rank(had.tie)) had.tie = t;
    });
  });

  var families = {}, phones = {}, houses = {};
  Object.keys(acc).forEach(function (k) {
    var a = acc[k];
    if (!a.family && !(a.unknown && !a.appointed)) return;
    var mine = Object.keys(a.byClient).map(function (ck) { return a.byClient[ck]; })
      .filter(function (x) { return x.tie.family !== false; });
    if (!mine.length) return;
    mine.sort(function (x, y) {
      return (x.client.status === y.client.status ? 0 : (x.client.status === 'active' ? -1 : 1)) ||
             x.client.name.localeCompare(y.client.name);
    });
    var rels = [], relSeen = {};
    mine.forEach(function (x) {
      var r = x.tie.relationship || 'Guardian';
      if (!relSeen[r.toLowerCase()]) { relSeen[r.toLowerCase()] = true; rels.push(r); }
    });
    var digits = {};
    a.phones.forEach(function (p) { digits[spDigits10_(p.v)] = true; });
    Object.keys(digits).forEach(function (d) { (phones[d] = phones[d] || {})[k] = true; });
    var name = famPick_(a.names);
    var nameSeen = {}, names = [];
    a.names.forEach(function (x) { if (!nameSeen[x.v]) { nameSeen[x.v] = true; names.push(x.v); } });
    var d = dir[k] || {};
    var from = {};
    mine.forEach(function (x) { Object.keys(x.sources).forEach(function (s) { from[s] = true; }); });
    var fam = {
      key: k, name: name, names: names, relationships: rels, relationship: rels[0] || 'Guardian',
      phone: famPick_(a.phones), email: famPick_(a.emails), address: famPick_(a.addresses),
      avatar: d.avatar || String(photos[k.slice(4)] || ''), person_id: d.person_id || '',
      sources: ['record', 'isp', 'directory'].filter(function (s) { return from[s]; })
        .map(function (s) { return FAM_SOURCE_LABELS[s]; }),
      status: mine.some(function (x) { return clientLive_(x.client); }) ? 'active' : 'inactive',
      phones: Object.keys(digits),
      clients: mine.map(function (x) {
        var c = x.client;
        return { client_key: c.client_key, name: c.name, relationship: x.tie.relationship || 'Guardian', house: c.house,
                 status: c.status, avatar: c.avatar, isp_year: c.isp_year, isp_day: c.isp_day, papers: c.papers,
                 archived: c.archived, in_plan: !!x.in_plan };
      })
    };
    fam.clients.forEach(function (c) {
      var code = c.status === 'active' ? famHouseCode_(c.house) : '';
      if (code) (houses[code] = houses[code] || {})[k] = true;
    });
    families[k] = fam;
  });
  // the family member each client's own record names as its guardian
  var records = {};
  clients.forEach(function (cl) { if (cl.record_key) records[cl.client_key] = canon(cl.record_key); });
  return { families: families, aliases: aliases, phones: phones, houses: houses, records: records, hub: hub, why: why,
           degraded: degraded };
}

function famIndexDeps_() {
  var deps = [cpTabScope_('clients'), cpTabScope_('isps'), cpTabScope_('photos'), cpTabScope_('people'),
              cpTabScope_(CP_SECTIONS_TAB)];
  try {
    var id = cpClientDbId_();
    deps.push(cacheScopeSheet_(id, CP_MASTER_TAB), cacheScopeSheet_(id, CP_ARCHIVE_TAB));
  } catch (e) { deps.push('fam_books'); }
  return deps;
}

function famIndex_() {
  var memo = FAM_INDEX_MEMO_;
  if (memo && memo.value) return memo.value;
  var value = famCached_('index', 'all', 'records', famIndexDeps_(), famIndexBuild_);
  if (memo) memo.value = value;
  return value;
}

/** The family member a request names: 400 when no record names the key, 503 when the records cannot say. */
function familyProfilesFamily_(raw) {
  var key = String(raw == null ? '' : raw).trim();
  var none = { refused: { status: 400, message: 'No family member "' + key.slice(0, 120) + '" is on file.' } };
  if (!/^fam_[a-z0-9]{3,120}$/.test(key)) return none;
  var idx;
  try { idx = famIndex_(); }
  catch (e) {
    return { refused: { status: 503, message: 'The client records could not be read just now (' +
             String((e && e.message) || e).slice(0, 120) + ') — nothing is said about this family member.' } };
  }
  var canon = (idx.aliases || {})[key] || key;
  var f = idx.families[canon];
  if (!f) {
    if (idx.degraded) {
      return { refused: { status: 503, message: 'Not every client record could be read just now (' +
               idx.why.join(' ').slice(0, 200) + ') — nothing is said about this family member.' } };
    }
    return none;
  }
  return { key: canon, name: f.name, family: f, index: idx, why: idx.why.slice(), degraded: !!idx.degraded };
}

// ---- caching --------------------------------------------------------------

/** Keyed fam_<action>_<key>; the name carries the part and the versions of what it reads. A degraded answer is never kept. */
function famCached_(action, key, part, depScopes, producer) {
  var scope = 'fam_' + action + '_' + key;
  var name = 'v1_' + String(part || 'all');
  (depScopes || []).forEach(function (s) {
    if (!s) return;
    try { name += '_' + cacheVersion_(s); } catch (e) { name += '_x'; }
  });
  var value = cacheRead_(scope, name, producer);
  if (value && value.degraded) cacheBump_(scope);
  return value;
}

function famBump_(action, key) {
  cacheBump_('fam_' + action + '_' + key);
}

/** One read's answer: 503 names the source when the build throws. */
function famServe_(action, ctx, deps, what, build) {
  try {
    return { status: 200, data: famCached_(action, ctx.key, 'all', deps, function () { return famScrub_(build()); }) };
  } catch (e) {
    return { status: 503, message: what + ' could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
}

/** A section's door past its gate: the family member the payload names, then its answer. */
function famDoor_(payload, answer) {
  var ctx = familyProfilesFamily_(payload && payload.family);
  if (ctx.refused) return ctx.refused;
  return answer(ctx);
}

// ---- the viewer's cut -----------------------------------------------------

function famViewAll_(view) {
  return view.kind === 'master' || view.kind === 'all';
}

/** The clients a narrowed viewer is drawn to, as a set. */
function famViewClients_(view) {
  var out = {};
  ((view.scope && view.scope.client_keys) || []).forEach(function (k) { if (str_(k)) out[str_(k)] = true; });
  return out;
}

/** What the screen is told of its view: the kind, and whether the admin notes are open to it. */
function famViewWords_(view) {
  return { kind: view.kind, notes: famViewAll_(view) };
}

// A family viewer's own family records: those its scope names, and the one a ward's own record names under the name…
function famGuardianKeys_(view, idx, wards) {
  var out = {};
  var canon = function (k) { return (idx.aliases || {})[k] || k; };
  var tied = function (k) {
    var f = (idx.families || {})[k];
    return !!f && f.clients.some(function (c) { return wards[c.client_key]; });
  };
  ((view.scope && view.scope.family_keys) || []).forEach(function (k) {
    var key = canon(str_(k));
    if (tied(key)) out[key] = true;
  });
  var named = null;
  try { named = hubViewerNamed_(view.user); } catch (e) { named = null; }
  if (!named || !named.known || named.self) return out;
  var mine = canon(famKeyOf_(famName_(named.name)));
  if (!mine || !tied(mine)) return out;
  Object.keys(wards).forEach(function (w) { if ((idx.records || {})[w] === mine) out[mine] = true; });
  return out;
}

// The family members a narrowed viewer may open: a client or an SSA the family of its own clients, a family member…
function famViewOpens_(view, idx) {
  var mine = famViewClients_(view);
  if (view.kind === 'guardian') return famGuardianKeys_(view, idx, mine);
  var out = {};
  Object.keys(idx.families || {}).forEach(function (k) {
    if (idx.families[k].clients.some(function (c) { return mine[c.client_key]; })) out[k] = true;
  });
  return out;
}

/** The family member a request names, as familyProfilesFamily_ says; to a narrowed viewer any key it may not open is 404. */
function famViewFamily_(view, payload) {
  var ctx = familyProfilesFamily_(payload && payload.family);
  if (famViewAll_(view)) return ctx;
  if (ctx.refused) return ctx.refused.status === 503 ? ctx : { refused: familyProfilesUnknown_() };
  return famViewOpens_(view, ctx.index)[ctx.key] ? ctx : { refused: familyProfilesUnknown_() };
}

// One section for this view: the door's own answer to a viewer who sees everything; to a narrowed one a section it…
function famViewServe_(view, payload, answer, cut) {
  var all = famViewAll_(view);
  if (!all && !cut) return familyProfilesUnknown_();
  var ctx = famViewFamily_(view, payload);
  if (ctx.refused) return ctx.refused;
  var got = answer(ctx);
  if (all || !got || got.status !== 200) return got;
  return { status: 200, data: famScrub_(cut(view, ctx, got.data)) };
}

/** The switcher for a narrowed viewer: the family members it may open, each drawn from its own clients alone. */
function famRosterCut_(view, idx) {
  var mine = famViewClients_(view);
  var open = famViewOpens_(view, idx);
  var families = Object.keys(open).map(function (k) {
    var f = idx.families[k];
    var cl = f.clients.filter(function (c) { return mine[c.client_key]; });
    return { key: f.key, name: f.name, relationship: (cl[0] && cl[0].relationship) || f.relationship, phone: f.phone,
             email: f.email, clients: cl.length, avatar: f.avatar,
             status: cl.some(clientLive_) ? 'active' : 'inactive' };
  });
  families.sort(function (a, b) { return a.name.localeCompare(b.name); });
  var why = idx.why.slice();
  if (!families.length && view.scope && str_(view.scope.why)) why.push(str_(view.scope.why));
  return { families: families, why: why, degraded: !!idx.degraded };
}

/** Overview for a narrowed viewer: the details, and only its own clients with the relationships to them. */
function famOverviewCut_(view, ctx, data) {
  var mine = famViewClients_(view);
  var clients = (data.clients || []).filter(function (c) { return mine[c.client_key]; });
  var rels = [], seen = {};
  clients.forEach(function (c) {
    var r = c.relationship || 'Guardian';
    if (!seen[r.toLowerCase()]) { seen[r.toLowerCase()] = true; rels.push(r); }
  });
  var f = data.family || {};
  return {
    family: { key: f.key, name: f.name, relationships: rels, phone: f.phone, email: f.email, address: f.address,
              avatar: f.avatar, sources: (f.sources || []).slice(), person_id: '',
              status: clients.some(clientLive_) ? 'active' : 'inactive' },
    clients: clients, why: (data.why || []).slice(), degraded: !!data.degraded
  };
}

/** Documents for a narrowed viewer: its own clients' alone. */
function famDocumentsCut_(view, ctx, data) {
  var mine = famViewClients_(view);
  return { docs: (data.docs || []).filter(function (d) { return mine[d.client_key]; }), why: (data.why || []).slice(),
           degraded: !!data.degraded };
}

/** The house a FAMILY shift item is at, from its id (cal_<code>_<first day>). */
function famCalCode_(id) {
  var s = String(id || '');
  var at = s.lastIndexOf('_');
  return s.indexOf('cal_') === 0 && at > 4 ? s.slice(4, at) : '';
}

// Activity for a narrowed viewer: the plans naming them, the FAMILY shifts at its own clients' houses and its own…
function famActivityCut_(view, ctx, data) {
  var mine = famViewClients_(view);
  var codes = {};
  ctx.family.clients.forEach(function (c) {
    var code = mine[c.client_key] && c.status === 'active' ? famHouseCode_(c.house) : '';
    if (code) codes[code] = true;
  });
  var ssa = view.kind === 'ssa';
  var whole = ssa && ctx.family.clients.every(function (c) { return mine[c.client_key]; });
  var items = (data.items || []).filter(function (x) {
    if (x.kind === 'calendar') return !!codes[famCalCode_(x.id)];
    if (FAM_NARROW_KINDS.indexOf(x.kind) !== -1) return !!mine[x.client_key];
    if (x.kind === 'scheduled_call') return ssa && !!mine[x.client_key];
    return whole && (x.kind === 'sms' || x.kind === 'call');
  });
  return { items: items, total: items.length, phones_matched: whole ? data.phones_matched : 0,
           why: (data.why || []).slice(), degraded: !!data.degraded };
}

// ---- the roster -----------------------------------------------------------

function famRosterBuild_() {
  var idx = famIndex_();
  var families = Object.keys(idx.families).map(function (k) {
    var f = idx.families[k];
    return { key: f.key, name: f.name, relationship: f.relationship, phone: f.phone, email: f.email,
             clients: f.clients.length, status: f.status, avatar: f.avatar };
  });
  families.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return { families: families, why: idx.why.slice(), degraded: !!idx.degraded };
}

// Every read names each account role a release can reach: familyProfilesGate_ decides, not the role.
HUB_POLICY.familyProfileRoster = {
  file: 'FamilyProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: {}
};
// The switcher: every family member a client record or plan names, active when one of their clients is — to a…
HUB_ACTIONS.familyProfileRoster = function (payload, user) {
  var view = familyProfilesGate_(user);
  if (!view) return familyProfilesUnknown_();
  var got;
  try {
    got = famViewAll_(view) ? famCached_('familyProfileRoster', 'all', 'all', famIndexDeps_(), function () {
      return famScrub_(famRosterBuild_());
    }) : famScrub_(famRosterCut_(view, famIndex_()));
  } catch (e) {
    return { status: 503, message: 'The family list could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
  return { status: 200, data: { families: got.families, why: got.why, degraded: got.degraded, view: famViewWords_(view) } };
};

// ---- overview -------------------------------------------------------------

function famOverviewBuild_(ctx) {
  var f = ctx.family, why = ctx.why.slice(), degraded = ctx.degraded;
  var labels = {};
  try { locationsHomes_().forEach(function (h) { if (h.code && h.home_name) labels[h.code] = h.home_name; }); }
  catch (eH) { why.push(famWhy_('The house registry', eH)); degraded = true; }
  return {
    family: { key: f.key, name: f.name, relationships: f.relationships.slice(), phone: f.phone, email: f.email,
              address: f.address, avatar: f.avatar, status: f.status, sources: f.sources.slice(),
              person_id: f.person_id },
    clients: f.clients.map(function (c) {
      var code = famHouseCode_(c.house);
      return { client_key: c.client_key, name: c.name, relationship: c.relationship, house: c.house,
               house_label: (code && labels[code]) || c.house, avatar: c.avatar, status: c.status };
    }),
    why: why, degraded: degraded
  };
}

function famOverviewAnswer_(ctx) {
  return famServe_('familyProfileOverview', ctx, famIndexDeps_(), 'The family member', function () {
    return famOverviewBuild_(ctx);
  });
}

function famOverviewDoor_(payload) {
  return famDoor_(payload, famOverviewAnswer_);
}

HUB_POLICY.familyProfileOverview = {
  file: 'FamilyProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { family: { type: 'string' }, edit: { type: 'boolean' } }
};
// Overview: the family member's details and every client they are family of, the active ones first.
HUB_ACTIONS.familyProfileOverview = function (payload, user) {
  var view = familyProfilesGate_(user);
  if (!view) return familyProfilesUnknown_();
  var got = famViewServe_(view, payload, famOverviewAnswer_, famOverviewCut_);
  if (view.kind !== 'master' || !(payload && payload.edit === true) || !got || got.status !== 200) return got;
  var ctx = familyProfilesFamily_(payload.family);
  if (ctx.refused) return ctx.refused;
  var data = {};
  Object.keys(got.data || {}).forEach(function (k) { data[k] = got.data[k]; });
  data.edit = famEditOf_(ctx);
  return { status: 200, data: data };
};

// ---- documents ------------------------------------------------------------

/** Guardianship papers the record links, each client's plan, and the client files famDocServed_ lets through. */
function famDocumentsBuild_(ctx) {
  var f = ctx.family, why = ctx.why.slice(), degraded = ctx.degraded;
  var docs = [], seen = {};
  var add = function (d) {
    if (!d.file_id || seen[d.file_id]) return;
    seen[d.file_id] = true;
    docs.push(d);
  };
  var byKey = {}, byName = {};
  f.clients.forEach(function (c) { byKey[c.client_key] = c; byName[clientNameKey_(c.name)] = c; });
  f.clients.forEach(function (c) {
    if (!c.papers) return;
    add({ id: 'gp_' + c.client_key, title: 'Guardianship papers — ' + c.name, kind: 'guardianship',
          client_key: c.client_key, client_name: c.name, date: '', file_id: c.papers, mime: '', source: 'Client record' });
  });
  var folder = null;
  try { folder = ispDocIndex_(); } catch (eF) { folder = null; }
  if (!folder || !folder.files) {
    why.push('The plans folder could not be read, so no plan file is listed.');
    degraded = true;
  } else {
    f.clients.forEach(function (c) {
      var doc = { id: '' };
      try { doc = ispDocFor_(c.name); } catch (eD) { doc = { id: '' }; }
      if (!doc.id) return;
      add({ id: 'isp_' + c.client_key, title: locationsText_(doc.name) || 'Individual Service Plan', kind: 'isp',
            client_key: c.client_key, client_name: c.name, date: c.isp_day, file_id: String(doc.id),
            mime: famMime_(doc.name), source: 'Plans folder' });
    });
  }
  try {
    clientFilesFor_(Object.keys(byKey), Object.keys(byName)).forEach(function (r) {
      var c = byKey[String(r.client_key || '').trim()] || byName[clientNameKey_(r.client_name)];
      if (!c || !famDocServed_(r)) return;
      var fid = String(r.drive_id || '') || locationsDriveId_(r.url);
      add({ id: 'cf_' + (String(r.id || '') || fid), title: locationsText_(r.title) || locationsText_(r.folder) || 'Client document',
            kind: 'client_doc', client_key: c.client_key, client_name: c.name,
            date: cpDay_(r.issued_on) || cpDay_(r.file_date), file_id: fid,
            mime: locationsText_(r.mime_type) || famMime_(r.title),
            source: 'Client files' + (locationsText_(r.folder) ? ' · ' + locationsText_(r.folder) : '') });
    });
  } catch (eC) { why.push(famWhy_('The client files', eC)); degraded = true; }
  docs.sort(function (a, b) { return (a.date < b.date ? 1 : (a.date > b.date ? -1 : 0)) || a.title.localeCompare(b.title); });
  return { docs: docs, why: why, degraded: degraded };
}

function famDocDeps_() {
  return famIndexDeps_().concat([cpTabScope_('client_files')]);
}

function famDocuments_(ctx) {
  return famCached_('familyProfileDocuments', ctx.key, 'all', famDocDeps_(), function () {
    return famScrub_(famDocumentsBuild_(ctx));
  });
}

function famDocumentsAnswer_(ctx) {
  return famServe_('familyProfileDocuments', ctx, famDocDeps_(), 'The documents', function () {
    return famDocumentsBuild_(ctx);
  });
}

function famDocumentsDoor_(payload) {
  return famDoor_(payload, famDocumentsAnswer_);
}

HUB_POLICY.familyProfileDocuments = {
  file: 'FamilyProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { family: { type: 'string' } }
};
/** Documents: the family member's clients' guardianship papers and plans, newest first. */
HUB_ACTIONS.familyProfileDocuments = function (payload, user) {
  var view = familyProfilesGate_(user);
  if (!view) return familyProfilesUnknown_();
  return famViewServe_(view, payload, famDocumentsAnswer_, famDocumentsCut_);
};

HUB_POLICY.familyProfileDocFile = {
  file: 'FamilyProfiles.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { family: { type: 'string' }, file_id: { type: 'string' } }
};
// One of the family member's documents as bytes for the platform's centred viewer; only a file their list names…
HUB_ACTIONS.familyProfileDocFile = function (payload, user) {
  var view = familyProfilesGate_(user);
  if (!view) return familyProfilesUnknown_();
  var ctx = famViewFamily_(view, payload);
  if (ctx.refused) return ctx.refused;
  var id = locationsText_(payload && payload.file_id, 120);
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return { status: 400, message: 'file_id: a Drive file id.' };
  var docs;
  try {
    docs = famDocuments_(ctx);
    docs = (famViewAll_(view) ? docs : famDocumentsCut_(view, ctx, docs)).docs || [];
  } catch (eK) { return { status: 503, message: 'The documents could not be read just now — try again in a minute.' }; }
  if (!docs.some(function (d) { return d.file_id === id; })) {
    return { status: 404, message: 'This family member names no such document.' };
  }
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

/** The phones that name this family member alone: one another family member also carries, or a company line, is dropped. */
function famOwnPhones_(ctx) {
  var mine = {}, shared = 0;
  (ctx.family.phones || []).forEach(function (d) {
    var others = Object.keys((ctx.index.phones || {})[d] || {}).filter(function (k) { return k !== ctx.key; });
    var ours = false;
    try { ours = !!hubLineOurs_(d); } catch (e) { ours = false; }
    if (others.length || ours) { shared++; return; }
    mine[d] = true;
  });
  return { mine: mine, shared: shared };
}

/** Texts on the company lines to or from the family member's own phones since `since`; the words are the message's own. */
function famTexts_(own, since) {
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
    var at = famWhen_(c.created[i]) || famWhen_(c.event[i]) || famWhen_(c.received[i]);
    if (!at || at.slice(0, 10) < since) continue;
    var quo = String(c.quo[i] || '').trim();
    var line = spNumbers_(incoming ? c.to[i] : c.from[i]).filter(function (d) { return !own.mine[d]; })[0] || quo;
    var who = spLineOf_(line, quo);
    out.push({ id: 'sms_' + String(c.id[i] || ('row' + (i + 2))), at: at, incoming: incoming, line: who.label,
               owner: who.owner, body: String(c.body[i] == null ? '' : c.body[i]) });
  }
  return out;
}

/** Calls with the family member's own phones in the hotline book and the transcripts house; metadata only, never the words. */
function famCalls_(own, since, why) {
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
      take(String(h.id[i] || '').trim(), famWhen_(h.event[i]) || famWhen_(h.created[i]), h.secs[i], h.dir[i],
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
        take(String(q.id[j] || '').trim(), famWhen_(q.created[j]) || famWhen_(q.event[j]), q.secs[j], q.dir[j],
             spNumbers_(q.team[j])[0]);
      }
    }
  } catch (eQ) { why.push(famWhy_('The transcripts house', eQ)); degraded = true; }
  return { calls: Object.keys(calls).map(function (k) { return calls[k]; }), degraded: degraded };
}

// The house calendars' FAMILY cells at the houses in `codes` between `since` and `until`, as runs of consecutive…
function famFamilyShifts_(codes, since, until) {
  var got = locationsCalendar_();
  if (!got.cal || !got.cal.values) throw new Error(got.why || 'the Calendar Archive could not be read');
  var values = got.cal.values, tz = got.cal.tz;
  var head = (values[0] || []).map(function (h) { return String(h || '').trim().toLowerCase(); });
  var col = function (names, fb) {
    for (var i = 0; i < names.length; i++) { var at = head.indexOf(names[i]); if (at !== -1) return at; }
    return fb;
  };
  var cLoc = col(['location'], 0), cName = col(['employee'], 1), cDate = col(['date'], 4);
  var cStart = col(['start time', 'start', 'shift start', 'time in', 'shift'], -1);
  var cEnd = col(['end time', 'end', 'shift end', 'time out'], -1);
  var byCode = {};
  for (var r = 1; r < values.length; r++) {
    var line = values[r] || [];
    if (!/^family\b/i.test(locationsText_(line[cName]))) continue;
    var code = locationsCode_(line[cLoc]);
    if (!code || !codes[code]) continue;
    var day = commBroadcastDay_(line[cDate], tz);
    if (!day || day < since || day > until) continue;
    var d = byCode[code] = byCode[code] || {};
    if (!d[day]) {
      d[day] = { start: cStart === -1 ? '' : spTime_(line[cStart], tz), end: cEnd === -1 ? '' : spTime_(line[cEnd], tz) };
    }
  }
  var runs = [];
  Object.keys(byCode).sort().forEach(function (code) {
    var days = Object.keys(byCode[code]).sort(), run = null;
    days.forEach(function (day) {
      var t = byCode[code][day], time = t.start && t.end ? t.start + '–' + t.end : (t.start || t.end);
      if (run && locationsDayShift_(run.to, 1) === day) {
        run.to = day;
        run.count++;
        if (run.time !== time) run.time = '';
        return;
      }
      run = { code: code, from: day, to: day, count: 1, time: time };
      runs.push(run);
    });
  });
  return runs;
}

/** The scheduled calls this app filed: the master's own Task Board cards that carry the family key. */
function famCallsFor_(key) {
  var master = null;
  try { master = userByEmail_(hubMasterEmail_()); } catch (e) { master = null; }
  var masterId = str_(master && master.id);
  if (!masterId) throw new Error('the master account could not be found');
  var cfg = RESOURCES.tasks;
  return listRows_('tasks', {}).filter(function (r) {
    return str_(r.family_key) === key && str_(r.source) === FAM_CALL_SOURCE && hubOwnerOf_(r, cfg) === masterId;
  });
}

function famTaskState_(column) {
  var col = str_(column);
  return MY_FAMILY_TASK_WORDS[col] || (col ? famTitle_(col) : 'Open');
}

function famNotesSheet_(create) {
  return create ? hubTabEnsure_(FAM_NOTES_TAB, FAM_NOTES_HEADER) : hubTabSheet_(FAM_NOTES_TAB);
}

/** One family member's rows of the notes tab, notes and incident ties both; [] while the tab is unborn. */
function famOwnRows_(key) {
  var sheet = famNotesSheet_(false);
  if (!sheet) return [];
  return locationsTabRows_(sheet).filter(function (r) { return String(r.family_key || '') === key; });
}

/** The notes among a family member's rows, newest first. */
function famNotesOf_(rows) {
  return rows.filter(function (r) { return String(r.kind || 'note') === 'note'; }).map(function (r) {
    return { id: String(r.id || ''), at: String(r.at || ''), by: String(r.by || ''), body: String(r.body || '') };
  }).sort(famNewest_);
}

function famNotesFor_(key) {
  return famNotesOf_(famOwnRows_(key));
}

/** An incident report as client_key|its timestamp to the second; '' without both. */
function famIncidentKey_(clientKey, ts) {
  var ck = String(clientKey || '').trim();
  var at = famWhen_(ts);
  return ck && at ? ck + '|' + at.slice(0, 19).replace(' ', 'T') : '';
}

/** The incidents filed from this app for a family member, by famIncidentKey_. */
function famIncidentTiesOf_(rows) {
  var out = {};
  rows.forEach(function (r) {
    if (String(r.kind || '') !== 'incident') return;
    var k = famIncidentKey_(r.client_key, r.incident_ts);
    if (k) out[k] = true;
  });
  return out;
}

function famActivityBuild_(ctx) {
  var f = ctx.family, why = ctx.why.slice(), degraded = ctx.degraded;
  var today = locationsToday_();
  var since = locationsDayShift_(today, -FAM_ACTIVITY_DAYS);
  var items = [];
  // scrubbed before the cut, so no number is left half-cut past the scrub
  var add = function (id, at, kind, title, body, by, clientKey) {
    var when = famWhen_(at);
    if (!when) return;
    items.push({ id: id, at: when, kind: kind, title: title, body: locationsText_(famScrub_(String(body == null ? '' : body)), 240),
                 by: by || '', client_key: clientKey || '' });
  };
  var byKey = {};
  f.clients.forEach(function (c) { byKey[c.client_key] = c; });
  var own = [];
  try { own = famOwnRows_(f.key); } catch (eN) { why.push(famWhy_('The family notes', eN)); degraded = true; }
  famNotesOf_(own).forEach(function (n) { add('note_' + n.id, n.at, 'note', 'Admin note', n.body, n.by, ''); });
  var ties = famIncidentTiesOf_(own);
  f.clients.forEach(function (c) {
    if (!c.in_plan) return;
    add('isp_' + c.client_key, c.isp_day, 'isp', 'Named in ' + c.name + '\'s ISP',
        c.relationship + (c.isp_year ? ' · ISP ' + c.isp_year : ''), '', c.client_key);
  });
  var own = famOwnPhones_(ctx);
  var mine = Object.keys(own.mine).length;
  if (own.shared) {
    why.push(own.shared + ' phone number(s) on the records also belong to another family member or to a company line, ' +
             'so texts and calls on them are not attributed.');
  }
  if (mine) {
    try {
      famTexts_(own, since).forEach(function (t) {
        add(t.id, t.at, 'sms', (t.incoming ? 'Text from ' + f.name : 'Text to ' + f.name) + ' · ' + t.line, t.body,
            t.incoming ? f.name : t.owner, '');
      });
    } catch (eT) { why.push(famWhy_('The texts', eT)); degraded = true; }
    try {
      var got = famCalls_(own, since, why);
      if (got.degraded) degraded = true;
      got.calls.forEach(function (k) {
        var mins = Number(k.secs) > 0 ? Math.max(1, Math.round(Number(k.secs) / 60)) + ' min' : '';
        add(k.id, k.at, 'call', (k.direction === 'outgoing' ? 'Call to ' : 'Call with ') + f.name,
            [k.line, mins].filter(String).join(' · '), '', '');
      });
    } catch (eK) { why.push(famWhy_('The calls', eK)); degraded = true; }
  }
  var codes = {}, codeClient = {};
  f.clients.forEach(function (c) {
    var code = c.status === 'active' ? famHouseCode_(c.house) : '';
    if (!code) return;
    codes[code] = true;
    codeClient[code] = codeClient[code] === undefined ? c.client_key : '';
  });
  if (Object.keys(codes).length) {
    try {
      var labels = {};
      try { locationsHomes_().forEach(function (h) { if (h.code && h.home_name) labels[h.code] = h.home_name; }); }
      catch (eH) { labels = {}; }
      var shared = {};
      famFamilyShifts_(codes, since, locationsDayShift_(today, FAM_CALENDAR_AHEAD_DAYS)).forEach(function (run) {
        var label = labels[run.code] || run.code;
        var range = run.count > 1 ? famDayWords_(run.from) + ' – ' + famDayWords_(run.to) + ' · ' + run.count + ' shifts'
                                  : famDayWords_(run.from);
        add('cal_' + run.code + '_' + run.from, run.to, 'calendar',
            run.count > 1 ? 'Family coverage shifts' : 'Family coverage shift',
            [label, range, run.time].filter(String).join(' · '), '', codeClient[run.code] || '');
        var others = Object.keys((ctx.index.houses || {})[run.code] || {}).length;
        if (others > 1) shared[run.code] = others;
      });
      Object.keys(shared).forEach(function (code) {
        why.push('The house calendar at ' + (labels[code] || code) + ' writes FAMILY without a name, and ' + shared[code] +
                 ' family members have clients there, so its shifts are listed for each of them.');
      });
    } catch (eS) {
      why.push('The Calendar Archive could not be read (' + String((eS && eS.message) || eS).slice(0, 120) +
               '), so no FAMILY shift is listed.');
      degraded = true;
    }
  }
  try {
    famCallsFor_(f.key).forEach(function (r) {
      var c = byKey[str_(r.client_key)];
      var due = cpDay_(r.due);
      add('task_' + str_(r.id), str_(r.createdAt), 'scheduled_call',
          'Call scheduled' + (c ? ' — ' + c.name : ''),
          [due ? 'Due ' + famDayWords_(due) : '', famTitle_(r.priority || 'normal') + ' priority', famTaskState_(r.column)]
            .filter(String).join(' · '), '', c ? c.client_key : '');
    });
  } catch (eC) { why.push(famWhy_('The scheduled calls', eC)); degraded = true; }
  try {
    var joined = locationsIncidentsFor_(estateRows_('uiIncidents'),
      f.clients.map(function (c) { return { client_key: c.client_key, name: c.name }; }));
    joined.forEach(function (j) {
      var row = j.row || {};
      // filed from this app, or naming them in its own words
      if (!ties[famIncidentKey_(j.client_key, row.timestamp)] &&
          !famNamed_(f.names, [row.summary_of_incident, row.immediate_action_taken, row.cause_and_contributing_factors,
                               row.prevention_plan, row.your_name, row.employees_involved])) return;
      var day = cpDay_(j.incident_date) || cpDay_(row.timestamp);
      if (!day || day < since) return;
      add('inc_' + j.id, day, 'incident', 'Incident — ' + j.client_name +
          (j.incident_category ? ' · ' + locationsText_(j.incident_category, 80) : ''),
          cpGist_(row.summary_of_incident), j.your_name, j.client_key);
    });
  } catch (eI) { why.push(famWhy_('The incidents', eI)); degraded = true; }
  items.sort(famNewest_);
  return { items: items.slice(0, FAM_ACTIVITY_CAP), total: items.length, phones_matched: mine, why: why,
           degraded: degraded };
}

function famActivityDeps_() {
  return famIndexDeps_().concat([cpTabScope_('tasks'), cpEstateScope_('uiIncidents')]);
}

function famActivityAnswer_(ctx) {
  return famServe_('familyProfileActivity', ctx, famActivityDeps_(), 'The activity', function () {
    return famActivityBuild_(ctx);
  });
}

function famActivityDoor_(payload) {
  return famDoor_(payload, famActivityAnswer_);
}

HUB_POLICY.familyProfileActivity = {
  file: 'FamilyProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { family: { type: 'string' } }
};
// Activity: notes, texts, calls, the plans naming them, FAMILY shifts, scheduled calls and the incidents filed from…
HUB_ACTIONS.familyProfileActivity = function (payload, user) {
  var view = familyProfilesGate_(user);
  if (!view) return familyProfilesUnknown_();
  return famViewServe_(view, payload, famActivityAnswer_, famActivityCut_);
};

// ---- notes ----------------------------------------------------------------

function famNotesAnswer_(ctx) {
  return famServe_('familyProfileNotes', ctx, [], 'The family notes', function () { return { notes: famNotesFor_(ctx.key) }; });
}

function famNotesDoor_(payload) {
  return famDoor_(payload, famNotesAnswer_);
}

HUB_POLICY.familyProfileNotes = {
  file: 'FamilyProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { family: { type: 'string' } }
};
/** Admin notes about the family member, newest first; internal, so never to a narrowed viewer. */
HUB_ACTIONS.familyProfileNotes = function (payload, user) {
  var view = familyProfilesGate_(user);
  if (!view) return familyProfilesUnknown_();
  return famViewServe_(view, payload, famNotesAnswer_, null);
};

HUB_POLICY.familyProfileNoteAdd = {
  file: 'FamilyProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { family: { type: 'string' }, body: { type: 'string' } }
};
/** File an admin note about the family member; the filer and the time are the session's. */
HUB_ACTIONS.familyProfileNoteAdd = function (payload, user) {
  if (!familyProfilesMasterGate_(user)) return familyProfilesUnknown_();
  var ctx = familyProfilesFamily_(payload && payload.family);
  if (ctx.refused) return ctx.refused;
  var body = String((payload && payload.body) || '').trim();
  if (!body) return { status: 400, message: 'body: what the note says.' };
  if (body.length > FAM_NOTE_MAX) return { status: 400, message: 'body: up to ' + FAM_NOTE_MAX + ' characters.' };
  var held = sheetDbGateHolds_(FAM_NOTES_TAB, 'create');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return { status: 409, message: 'Another write is in progress — try again in a moment.' };
  var note;
  try {
    var sheet;
    try { sheet = famNotesSheet_(true); }
    catch (eS) { return { status: 503, message: 'The family notes store is not set up (' + String((eS && eS.message) || eS).slice(0, 120) + ').' }; }
    note = { id: 'FAMN_' + Utilities.getUuid(), family_key: ctx.key, family_name: ctx.name, body: body,
             by: locationsWho_(user), at: new Date().toISOString(), kind: 'note' };
    locationsAppend_(sheet, FAM_NOTES_HEADER, note);
  } finally { lock.releaseLock(); }
  ['familyProfileNotes', 'familyProfileActivity', 'familyProfileOverview'].forEach(function (a) { famBump_(a, ctx.key); });
  hubSysLog_(str_(user.email), 'familyProfileNoteAdd', ctx.key, { status: 200 });
  return { status: 200, data: famScrub_({ note: { id: note.id, at: note.at, by: note.by, body: note.body } }) };
};

// ---- an incident filed from here ------------------------------------------

HUB_POLICY.familyProfileIncidentTie = {
  file: 'FamilyProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { family: { type: 'string' }, client_key: { type: 'string' }, incident_ts: { type: 'string' } }
};
// Tie an incident filed from this app (Clients' own door into the estate's UI Reports) to the family member: one of…
HUB_ACTIONS.familyProfileIncidentTie = function (payload, user) {
  if (!familyProfilesMasterGate_(user)) return familyProfilesUnknown_();
  var ctx = familyProfilesFamily_(payload && payload.family);
  if (ctx.refused) return ctx.refused;
  var ck = locationsText_(payload && payload.client_key, 120);
  var client = null;
  ctx.family.clients.forEach(function (c) { if (!client && c.client_key === ck) client = c; });
  if (!client) return { status: 400, message: 'client_key: one of this family member\'s clients.' };
  var ts = locationsText_(payload && payload.incident_ts, 80);
  var tie = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(ts) ? famIncidentKey_(client.client_key, ts) : '';
  if (!tie) return { status: 400, message: 'incident_ts: the report\'s timestamp, as it was filed.' };
  var held = sheetDbGateHolds_(FAM_NOTES_TAB, 'create');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return { status: 409, message: 'Another write is in progress — try again in a moment.' };
  var had = false;
  try {
    var sheet;
    try { sheet = famNotesSheet_(true); }
    catch (eS) { return { status: 503, message: 'The family notes store is not set up (' + String((eS && eS.message) || eS).slice(0, 120) + ').' }; }
    had = !!famIncidentTiesOf_(locationsTabRows_(sheet).filter(function (r) {
      return String(r.family_key || '') === ctx.key;
    }))[tie];
    if (!had) {
      locationsAppend_(sheet, FAM_NOTES_HEADER, {
        id: 'FAMI_' + Utilities.getUuid(), family_key: ctx.key, family_name: ctx.name, body: '', by: locationsWho_(user),
        at: new Date().toISOString(), kind: 'incident', client_key: client.client_key, incident_ts: ts });
    }
  } finally { lock.releaseLock(); }
  famBump_('familyProfileActivity', ctx.key);
  hubSysLog_(str_(user.email), 'familyProfileIncidentTie', ctx.key, { status: 200 });
  return { status: 200, data: { tie: { family: ctx.key, client_key: client.client_key, incident_ts: ts, already: had } } };
};

// ---- scheduling a call ----------------------------------------------------

HUB_POLICY.familyProfileCallSchedule = {
  file: 'FamilyProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { family: { type: 'string' }, client_key: { type: 'string' }, date: { type: 'string' },
            priority: { type: 'string' }, details: { type: 'string' } }
};
// Schedule a call with the family member about one of their clients: a card on the filer's own Task Board, filed…
HUB_ACTIONS.familyProfileCallSchedule = function (payload, user) {
  if (!familyProfilesMasterGate_(user)) return familyProfilesUnknown_();
  var ctx = familyProfilesFamily_(payload && payload.family);
  if (ctx.refused) return ctx.refused;
  var f = ctx.family;
  var ck = locationsText_(payload && payload.client_key, 120);
  var client = null;
  f.clients.forEach(function (c) { if (!client && c.client_key === ck) client = c; });
  if (!client) return { status: 400, message: 'client_key: one of this family member\'s clients.' };
  var date = locationsText_(payload && payload.date, 20);
  var today = locationsToday_();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || locationsDayShift_(locationsDayShift_(date, 1), -1) !== date) {
    return { status: 400, message: 'date: a day, yyyy-mm-dd.' };
  }
  if (date < today) return { status: 400, message: 'date: today or later.' };
  var priority = locationsText_(payload && payload.priority, 20).toLowerCase() || 'normal';
  if (FAM_CALL_PRIORITIES.indexOf(priority) === -1) {
    return { status: 400, message: 'priority: one of ' + FAM_CALL_PRIORITIES.join(', ') + '.' };
  }
  var details = String((payload && payload.details) || '').trim();
  if (details.length > FAM_NOTE_MAX) return { status: 400, message: 'details: up to ' + FAM_NOTE_MAX + ' characters.' };
  var lines = [details, 'For: ' + f.name + (client.relationship ? ' (' + client.relationship + ')' : ''),
               'Client: ' + client.name, f.phone ? 'Phone: ' + f.phone : ''].filter(String);
  var card = {
    title: hubCellSafe_('Call ' + f.name + ' — ' + client.name), description: hubCellSafe_(lines.join('\n')),
    column: date <= locationsDayShift_(today, FAM_CALL_WEEK_DAYS) ? 'this-week' : 'backlog',
    priority: priority, due: date, tint: 'peach', labels: [FAM_CALL_LABEL],
    family_key: ctx.key, client_key: client.client_key, source: FAM_CALL_SOURCE
  };
  var res = route('tasks', 'create', card, user);
  if (!res || res.status !== 200) {
    return { status: Number(res && res.status) || 503, message: String((res && res.message) || 'The call was not filed.') };
  }
  var refused = sheetDbRefused_(res.data);
  if (refused) return refused;
  var made = res.data || {};
  famBump_('familyProfileActivity', ctx.key);
  hubSysLog_(str_(user.email), 'familyProfileCallSchedule', ctx.key, { status: 200 });
  return { status: 200, data: { call: {
    id: str_(made.id), at: str_(made.createdAt), due: date, priority: priority, client_key: client.client_key,
    client_name: client.name, details: details, state: famTaskState_(made.column), board: 'Task Board'
  } } };
};

// ---- the member's details, edited -----------------------------------------

// The member's own fields and the client record column each lands in, on every record that names them.
var FAM_EDIT_COLUMNS = { name: 'guardianName', phone: 'guardian_phone', email: 'guardian_email', address: 'guardian_address' };
// One client's own tie, as `<prefix><client_key>`: that record's relationship and guardianship papers.
var FAM_EDIT_TIE = { rel_: 'guardian_relationship', papers_: 'guardianship_papers' };
// The member's fields their people-directory row carries too.
var FAM_EDIT_PERSON = ['name', 'phone', 'email', 'avatar'];
var FAM_EDIT_FIELD = /^[a-z][a-z0-9_]{0,63}$/;

/** Why a client's tie is not edited here, { why, door }; null when that client's own Hub record names the member. */
function famEditTieLock_(c, idx, key) {
  if (c.archived) return { why: 'The archive of old clients names this tie; the archive is not edited here.', door: '' };
  if ((idx.records || {})[c.client_key] !== key) {
    return { why: 'The client\'s record does not name this family member; the tie comes from the plan\'s important ' +
                  'people or the people directory.', door: 'the client\'s ISP' };
  }
  if (!(idx.hub || {})[c.client_key]) {
    return { why: 'Only the Asa Client Database Master names this guardian, not the client\'s Hub record.', door: 'Clients' };
  }
  return null;
}

/** Whether a sign-in already uses this email or phone; the users tab is read, never written. */
function famEditAccount_(email, phone) {
  var asks = [String(email || '').trim().toLowerCase(), String(phone || '').replace(/\D+/g, ''), spDigits10_(phone)];
  return asks.some(function (a) {
    if (!a) return false;
    try { return !!userByEmail_(a); } catch (e) { return false; }
  });
}

// What the edit panel opens on: each field as the profile shows it now (the witness), the fields edited elsewhere…
function famEditOf_(ctx) {
  var f = ctx.family, idx = ctx.index;
  var raw = { name: f.name, phone: f.phone, email: f.email, address: f.address };
  if (f.person_id) raw.avatar = f.avatar;
  var locked = {}, ties = [], records = [];
  f.clients.forEach(function (c) {
    var rel = 'rel_' + c.client_key, papers = 'papers_' + c.client_key;
    var lock = famEditTieLock_(c, idx, ctx.key);
    if (!lock) records.push(c.client_key);
    ties.push({ client_key: c.client_key, name: c.name, status: c.status, why: lock ? lock.why : '' });
    if (!FAM_EDIT_FIELD.test(papers)) return;
    raw[rel] = c.relationship || 'Guardian';
    raw[papers] = c.papers || '';
    if (lock) { locked[rel] = lock; locked[papers] = lock; }
  });
  var none = { why: 'No client\'s Hub record names this family member, so their details are edited where the tie is ' +
                    'written.', door: 'the client\'s ISP' };
  if (!records.length) {
    locked.name = none;
    locked.address = none;
    if (!f.person_id) { locked.phone = none; locked.email = none; }
  }
  return famScrub_({ raw: raw, locked: locked, ties: ties, records: records, person_id: f.person_id || '',
                     account: famEditAccount_(f.email, f.phone) });
}

/** Why `value` is refused for `field`; '' when it may be written. */
function famEditCheck_(field, value, ctx) {
  if (field === 'name') {
    if (!value) return 'A family member keeps a name.';
    var k = famKeyOf_(famName_(value));
    if (!k) return 'Not a person\'s name (a relationship, "Self" or an organisation).';
    var to = (ctx.index.aliases || {})[k] || k;
    if (to !== ctx.key && ctx.index.families[to]) return 'Another family member is on file under this name.';
  }
  if (field === 'phone' && value && !spDigits10_(value)) return 'A phone number has ten digits.';
  if (field === 'email' && value && !famEmail_(value)) return 'Not an email address.';
  if (field === 'avatar' && value && !/^https:\/\/\S+$/.test(value)) return 'A photo is an https link.';
  return '';
}

/** The member's notes moved to the new key under the lock; the count moved, or -1 when the lock was not had. */
function famEditMoveNotes_(from, to, name) {
  var sheet = famNotesSheet_(false);
  if (!sheet) return 0;
  var lock = locationsLock_();
  if (!lock) return -1;
  var moved = 0;
  try {
    var values = sheet.getDataRange().getValues();
    var head = (values[0] || []).map(function (h) { return String(h || '').trim(); });
    var kc = head.indexOf('family_key'), nc = head.indexOf('family_name');
    if (kc === -1) return 0;
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][kc] || '') !== from) continue;
      sheet.getRange(r + 1, kc + 1).setValue(to);
      if (nc !== -1) sheet.getRange(r + 1, nc + 1).setValue(hubCellSafe_(name));
      moved++;
    }
  } finally { lock.releaseLock(); }
  return moved;
}

HUB_POLICY.familyProfileSave = {
  file: 'FamilyProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['clients', 'people'], emits: [],
  params: { family: { type: 'string' }, changes: { type: 'array' } }
};
// The member's details edited in place, { family, changes: [{ field, value, expected }] }: name, phone, email and…
HUB_ACTIONS.familyProfileSave = function (payload, user) {
  if (!familyProfilesMasterGate_(user)) return familyProfilesUnknown_();
  var ctx = familyProfilesFamily_(payload && payload.family);
  if (ctx.refused) return ctx.refused;
  var asked = hubEditChanges_(payload);
  if (asked.refused) return asked.refused;
  if (ctx.degraded) {
    return { status: 503, message: 'Not every client record could be read just now, so nothing was written.' };
  }
  var edit = famEditOf_(ctx);
  var byClient = {}, person = {}, written = [], refused = [], stale = {}, rename = '';
  asked.changes.forEach(function (c) {
    if (!Object.prototype.hasOwnProperty.call(edit.raw, c.field)) {
      refused.push({ field: c.field, why: 'Not a field this app edits.' });
      return;
    }
    if (edit.locked[c.field]) { refused.push({ field: c.field, why: edit.locked[c.field].why }); return; }
    var held = hubEditWitness_(c.field, c.expected, edit.raw[c.field]);
    if (held) { stale[c.field] = held.data.current; return; }
    var value = c.value.replace(/\s+/g, ' ').slice(0, 500);
    var why = famEditCheck_(c.field, value, ctx);
    if (why) { refused.push({ field: c.field, why: why }); return; }
    var col = FAM_EDIT_COLUMNS[c.field];
    if (col) {
      edit.records.forEach(function (ck) { (byClient[ck] = byClient[ck] || {})[col] = value; });
    } else {
      Object.keys(FAM_EDIT_TIE).forEach(function (pre) {
        if (c.field.indexOf(pre) !== 0) return;
        var ck = c.field.slice(pre.length);
        if (edit.records.indexOf(ck) !== -1) (byClient[ck] = byClient[ck] || {})[FAM_EDIT_TIE[pre]] = value;
      });
    }
    if (edit.person_id && FAM_EDIT_PERSON.indexOf(c.field) !== -1) person[c.field] = value;
    if (c.field === 'name') rename = value;
    written.push({ field: c.field, before: c.expected, after: value });
  });

  var failed = {}, clientKeys = [], notes = [];
  var names = {};
  ctx.family.clients.forEach(function (c) { names[c.client_key] = c.name; });
  var fieldOf = function (ck, column) {
    var hit = '';
    Object.keys(FAM_EDIT_COLUMNS).forEach(function (f) { if (FAM_EDIT_COLUMNS[f] === column) hit = f; });
    Object.keys(FAM_EDIT_TIE).forEach(function (pre) { if (FAM_EDIT_TIE[pre] === column) hit = pre + ck; });
    return hit;
  };
  Object.keys(byClient).forEach(function (ck) {
    var fail = function (cols, why) {
      cols.forEach(function (column) {
        var f = fieldOf(ck, column);
        if (f && !failed[f]) failed[f] = 'Not saved on ' + (names[ck] || ck) + '\'s record: ' + why;
      });
    };
    var cols = Object.keys(byClient[ck]);
    var checked = clientProfileSaveFields_(byClient[ck]);
    if (checked.refused) { fail(cols, checked.refused.message); return; }
    var cctx = clientProfilesClient_(ck);
    if (cctx.refused || cctx.archived) {
      fail(cols, cctx.refused ? cctx.refused.message : 'the client is in the archive of old clients.');
      return;
    }
    var got = cpProfileWrite_(cctx, checked.fields, '');
    if (got.refused) { fail(cols, got.refused.message); return; }
    got.failed.forEach(function (x) { fail([x.column], x.why); });
    clientKeys.push(ck);
  });
  if (Object.keys(person).length) {
    var patch = { id: edit.person_id };
    Object.keys(person).forEach(function (k) { patch[k] = hubCellSafe_(person[k]); });
    var res = null;
    try { res = route('people', 'update', patch, user); } catch (eP) { res = { status: 503, message: String((eP && eP.message) || eP) }; }
    var pRefused = res && res.status === 200 ? sheetDbRefused_(res.data) : (res || { message: 'no answer' });
    if (pRefused) {
      var pWhy = 'The people directory row was not updated: ' + String(pRefused.message || '').slice(0, 160);
      Object.keys(person).forEach(function (f) { if (!failed[f]) failed[f] = pWhy; });
    }
  }
  written = written.filter(function (w) {
    if (!failed[w.field]) return true;
    refused.push({ field: w.field, why: failed[w.field] });
    return false;
  });

  var family = ctx.key;
  var renamed = rename && written.some(function (w) { return w.field === 'name'; });
  if (renamed) {
    var to = famKeyOf_(famName_(rename));
    if (to && to !== ctx.key) {
      var moved = famEditMoveNotes_(ctx.key, to, famName_(rename));
      if (moved === -1) notes.push('Another write held the notes just now, so they stay under the old name.');
      family = to;
    }
  }
  if (written.length) {
    ['familyProfileOverview', 'familyProfileDocuments', 'familyProfileActivity', 'familyProfileNotes'].forEach(function (a) {
      famBump_(a, ctx.key);
      if (family !== ctx.key) famBump_(a, family);
    });
    famBump_('familyProfileRoster', 'all');
    famBump_('index', 'all');
    hubEditLog_(user, 'familyProfileSave', ctx.key + (family !== ctx.key ? ' → ' + family : ''), written, []);
  }
  var data = { written: written.map(function (w) { return w.field; }), refused: refused, family: family,
               client_keys: clientKeys,
               readonly: edit.ties.filter(function (t) { return t.why; })
                 .map(function (t) { return { client_key: t.client_key, name: t.name, why: t.why }; }) };
  if (notes.length) data.notes = notes;
  if (Object.keys(stale).length) {
    data.current = stale;
    return { status: 409, data: data,
             message: written.length ? 'Some fields changed since the panel was opened — reloaded; the others were saved.'
                                     : 'Changed since the panel was opened — reloaded, nothing was written.' };
  }
  return { status: 200, data: data };
};

// ---- the relay's pack -----------------------------------------------------

/** Each part's door, past its gate, asked for one family member. */
function famPackDoors_(key) {
  var ask = { family: key };
  return {
    overview: function () { return famOverviewDoor_(ask); },
    documents: function () { return famDocumentsDoor_(ask); },
    activity: function () { return famActivityDoor_(ask); },
    notes: function () { return famNotesDoor_(ask); }
  };
}

// The relay's pack: overview, documents, activity and notes of one family member, each its own door's answer and…
HUB_POLICY.familyPack = {
  file: 'FamilyProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: [],
  params: { family: { type: 'string' } }
};
HUB_ACTIONS.familyPack = function (payload, user) {
  if (!user || !user.is_service) return familyProfilesUnknown_();
  var started = Date.now();
  var heldClients = CLIENTS_DERIVED_MEMO_, heldIndex = FAM_INDEX_MEMO_;
  CLIENTS_DERIVED_MEMO_ = {};
  FAM_INDEX_MEMO_ = {};
  try {
    var ctx = familyProfilesFamily_(payload && payload.family);
    if (ctx.refused) return ctx.refused;
    var doors = famPackDoors_(ctx.key);
    var parts = {}, status = {};
    FAM_PACK_PARTS.forEach(function (name) {
      if (Date.now() - started > FAM_PACK_BUDGET_MS) {
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
    return { status: 200, data: { family: ctx.key, built_at: new Date(started).toISOString(), parts: parts,
                                  part_status: status } };
  } finally {
    CLIENTS_DERIVED_MEMO_ = heldClients;
    FAM_INDEX_MEMO_ = heldIndex;
  }
};

// ---- the relay's index of the whole app -------------------------------------

/** Every family member's rows of the notes tab, by family key: the tab read once; {} while it is unborn. */
function famNotesRowsByKey_() {
  var sheet = famNotesSheet_(false);
  var out = {};
  if (!sheet) return out;
  locationsTabRows_(sheet).forEach(function (r) {
    var k = String(r.family_key || '');
    if (k) (out[k] = out[k] || []).push(r);
  });
  return out;
}

// The relay's index of the whole app — what every open of Families starts on: the roster, each family member's…
HUB_POLICY.familyIndexPack = {
  file: 'FamilyProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: [],
  params: {}
};
HUB_ACTIONS.familyIndexPack = function (payload, user) {
  if (!user || !user.is_service) return familyProfilesUnknown_();
  var started = Date.now();
  var heldClients = CLIENTS_DERIVED_MEMO_, heldIndex = FAM_INDEX_MEMO_;
  CLIENTS_DERIVED_MEMO_ = {};
  FAM_INDEX_MEMO_ = {};
  var failed = function (e) {
    return { status: 503, message: 'This part could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  };
  try {
    var parts = {}, status = {};
    var answer = function () {
      return { status: 200, data: { built_at: new Date(started).toISOString(), parts: parts, part_status: status } };
    };
    var idx;
    try { idx = famIndex_(); }
    catch (eI) {
      FAM_INDEX_PARTS.forEach(function (name) { status[name] = failed(eI); });
      return answer();
    }
    try {
      var roster = famScrub_(famRosterBuild_());
      parts.roster = { families: roster.families, why: roster.why, degraded: roster.degraded };
      status.roster = { status: 200 };
    } catch (eR) { status.roster = failed(eR); }
    var aliases = {};
    Object.keys(idx.aliases || {}).forEach(function (k) { if (idx.families[idx.aliases[k]]) aliases[k] = idx.aliases[k]; });
    parts.aliases = aliases;
    status.aliases = { status: 200 };
    var notes = null;
    try { notes = famNotesRowsByKey_(); } catch (eN) { status.notes = failed(eN); }
    var overviews = {}, written = {}, left = 0, broken = 0;
    Object.keys(idx.families).sort().forEach(function (k) {
      if (Date.now() - started > FAM_PACK_BUDGET_MS) { left++; return; }
      var ctx = familyProfilesFamily_(k);
      if (ctx.refused) { broken++; return; }
      try { overviews[ctx.key] = famScrub_(famOverviewBuild_(ctx)); } catch (eO) { broken++; }
      if (notes) written[ctx.key] = famScrub_({ notes: famNotesOf_(notes[ctx.key] || []) });
    });
    var short = left ? left + ' family member(s) were not gathered in this pack; theirs are read on their own.' : '';
    parts.overviews = overviews;
    status.overviews = short || broken ? { status: 200, missing: left + broken, message: short } : { status: 200 };
    if (notes) {
      parts.notes = written;
      status.notes = short ? { status: 200, missing: left, message: short } : { status: 200 };
    }
    return answer();
  } finally {
    CLIENTS_DERIVED_MEMO_ = heldClients;
    FAM_INDEX_MEMO_ = heldIndex;
  }
};
