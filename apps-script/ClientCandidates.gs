// Client Candidates: one referral at a time, read from the Potential Clients app's own row.
// Every change is a write to that same row — its stage, its notes, its log, the papers filed for it — through the…

var CC_ACTIONS = ['clientCandidateRoster', 'clientCandidateOverview', 'clientCandidateActions', 'clientCandidateIntake',
                  'clientCandidateDocuments', 'clientCandidateDocFile', 'clientCandidateActivity',
                  'clientCandidateTexts', 'clientCandidateTranscripts', 'clientCandidateTranscript'];
var CC_WRITE_ACTIONS = ['clientCandidateWrite', 'clientCandidateFile'];
var CC_PACK_PARTS = ['overview', 'actions', 'intake', 'documents', 'activity', 'texts', 'transcripts'];
// Past this a pack starts no further part, so it always answers inside the execution limit.
var CC_PACK_BUDGET_MS = 240000;
var CC_LEADS = 'potentialClients';
var CC_ACTIVITY_CAP = 400;
var CC_RECENT = 5;
var CC_CLOSING_DAYS = 14;
var CC_ALERTS_CAP = 20;
// The row's own columns this app keeps: the log of every press, the papers filed, the contact preferences.
var CC_LOG_FIELD = 'candidate_log';
var CC_DOCS_FIELD = 'candidate_docs';
var CC_PREFS_FIELD = 'contact_preferences';
var CC_LOG_CAP = 300;
var CC_LOG_CHARS = 45000;
var CC_NOTE_MAX = 900;
var CC_TZ = 'America/New_York';
var CC_FOLDER = 'Client Candidates';
var CC_FILE_MAX_B64 = 21000000;
// The intake's stages in order. A value the row already holds maps onto one for display and filtering only.
var CC_STAGES = [
  { id: 'referral', label: 'Referral', description: 'Received — nobody has worked it yet' },
  { id: 'discovery', label: 'Discovery', description: 'First call with the family or SSA' },
  { id: 'assessment', label: 'Assessment', description: 'Needs assessment & house fit' },
  { id: 'placement-review', label: 'Placement Review', description: 'Paperwork, funding and waiver checks' },
  { id: 'ready-for-intake', label: 'Ready for Intake', description: 'Cleared — admission can begin' },
  { id: 'closed', label: 'Closed', description: 'Chose another provider, deferred or on hold' }
];
var CC_STAGE_HELD = { '': 'referral', 'new': 'referral', scraped: 'referral', read: 'referral', contacted: 'discovery',
                      'isp-drafting': 'placement-review', intake: 'placement-review', converted: 'ready-for-intake',
                      'on-hold': 'closed', lost: 'closed' };
var CC_ORDER = ['referral', 'discovery', 'assessment', 'placement-review', 'ready-for-intake'];
// The intake's phases: the stages each is worked in, and the one a referral reaches once it is done.
var CC_PHASES = [
  { id: 'referral_review', title: 'Referral review', label: 'First call with the family or SSA', at: ['referral'],
    done: 'discovery' },
  { id: 'assessment', title: 'Discovery & assessment', label: 'Needs assessment & house fit',
    at: ['discovery', 'assessment'], done: 'placement-review' },
  { id: 'placement', title: 'Service fit & placement', label: 'Paperwork, funding and waiver checks',
    at: ['placement-review'], done: 'ready-for-intake' }
];
var CC_WRITE_KINDS = ['stage', 'complete', 'reopen', 'note'];
var CC_FILED = { assessment: 'Support assessment', consent: 'Consent & contact preferences' };
// The plan's sections the support assessment is built from (ClientProfiles.gs CP_CARE_FIELDS' own names).
var CC_ASSESSMENT_FIELDS = [['personal_care', 'Personal care'], ['mobility', 'Mobility'],
  ['diet_nutrition', 'Diet & nutrition'], ['communication', 'Communication'], ['medical_summary', 'Medical summary'],
  ['safety_risks', 'Safety & risks'], ['behaviors', 'Behavior support'], ['supervision_level', 'Supervision'],
  ['important_to', 'Important to'], ['important_for', 'Important for']];
var CC_SCRUB_KEYS = { id: true, key: true, candidate: true, file_id: true, call_id: true, with: true, line: true,
                      client_key: true, referral_id: true, ids: true, candidate_id: true };
var CC_DOB_RE = new RegExp('\\b(DOB|D\\.O\\.B\\.?|date of birth|birth ?date|birthday|born(?: on)?)(?:\\s+(?:is|was))?' +
  '\\s*[:#-]?\\s*(\\d{1,2}\\s*[\\/.\\-\\s]\\s*\\d{1,2}\\s*[\\/.\\-\\s]\\s*\\d{2,4}' +
  '|\\d{4}\\s*[\\/.\\-]\\s*\\d{1,2}\\s*[\\/.\\-]\\s*\\d{1,2}' +
  '|[A-Z][a-z]{2,8}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}' +
  '|\\d{1,2}(?:st|nd|rd|th)?\\s+[A-Z][a-z]{2,8}\\.?,?\\s+\\d{4})', 'gi');
var CC_MEDICAID_RE = /\b(Medicaid|MMIS)(\s*(?:no\.?|number|id|#))?\s*[:#-]?\s*#?\s*\d[\d -]{6,}\d/gi;
// An SSN with spaced separators, and a card number grouped by dots, dashes or runs of spaces.
var CC_SSN_RE = /(^|\D)\d{3}\s*[\s.-]\s*\d{2}\s*[\s.-]\s*\d{4}(?=\D|$)/g;
var CC_CARD_RE = /(^|\D)\d(?:[\s.-]{0,2}\d){12,18}(?=\D|$)/g;
// Set only while clientCandidatePack runs, so the referral rows are read once per pack.
var CC_MEMO_ = null;

var CC_APP_ID = 'client-candidates';

// FAIL-CLOSED: every read's gate.
function clientCandidatesGate_(user) {
  var g = null;
  try { g = hubProfileAppGate_(CC_APP_ID, user); } catch (e) { g = null; }
  var kind = g && g.open === true && g.scope ? g.scope.kind : '';
  return kind === 'master' || kind === 'all';
}

/** FAIL-CLOSED: the master in its own session, never a visit or a service call. The writes' and the pack's gate. */
function clientCandidatesMaster_(user) {
  try { return !!hubIsRealMaster_(user); } catch (e) { return false; }
}

function clientCandidatesUnknown_() {
  return { status: 404, message: 'Unknown action.' };
}

// ---- pure helpers ---------------------------------------------------------

function ccWhy_(what, e) {
  return what + ' could not be read (' + String((e && e.message) || e).slice(0, 120) + ').';
}

function ccText_(v, max) {
  return locationsText_(v, max);
}

/** A stage cell folded: 'Placement Review' → placement-review, 'On hold' → on-hold. */
function ccStageId_(v) {
  return String(v == null ? '' : v).trim().toLowerCase().replace(/[\s_-]+/g, '-');
}

/** The intake stage a folded stage shows as; '' for a word neither vocabulary knows. */
function ccStageOf_(stage) {
  for (var i = 0; i < CC_STAGES.length; i++) if (CC_STAGES[i].id === stage) return stage;
  return Object.prototype.hasOwnProperty.call(CC_STAGE_HELD, stage) ? CC_STAGE_HELD[stage] : '';
}

function ccStageMeta_(id) {
  for (var i = 0; i < CC_STAGES.length; i++) if (CC_STAGES[i].id === id) return CC_STAGES[i];
  return null;
}

/** The stage as the intake names it; a word it does not know, as written. */
function ccStageLabel_(stage) {
  var meta = ccStageMeta_(ccStageOf_(stage));
  if (meta) return meta.label;
  return stage ? stage.replace(/-/g, ' ').replace(/^\w/, function (c) { return c.toUpperCase(); }) : 'No stage';
}

/** Where the stage stands in the intake: 0 Referral … 4 Ready for Intake; -2 Closed; -1 a word it does not know. */
function ccStageIndex_(stage) {
  var id = ccStageOf_(stage);
  if (id === 'closed') return -2;
  return id ? CC_ORDER.indexOf(id) : -1;
}

/** A stage a press names, by its id or its label; '' when it is none of the six. */
function ccStageWanted_(v) {
  var s = ccStageId_(v);
  return ccStageMeta_(s) ? s : '';
}

function ccTruthy_(v) {
  return v === true || /^(true|yes|y|1)$/i.test(String(v == null ? '' : v).trim());
}

/** An instant as ISO text; a bare day stays a day; '' when the cell names neither. */
function ccInstant_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  var day = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.test(s) ? spDay_(s) : '';
  if (day) return day;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var t = Date.parse(s);
  return isNaN(t) ? '' : new Date(t).toISOString();
}

function ccDueState_(due, today) {
  if (!due) return '';
  if (due < today) return 'overdue';
  return due === today ? 'today' : 'upcoming';
}

/** The referral's own source, else the county portal when the scraper took it. */
function ccSource_(row) {
  return ccText_(row.source, 120) || (ccText_(row.scraped_at) ? 'County referral portal' : '');
}

function ccPlace_(zip) {
  return zip ? 'ZIP ' + zip : '';
}

// Last guard on every answer: the SSA guard (SSNs and card numbers however written, bare nine-digit runs), an SSN…
function ccScrub_(v, key) {
  if (key && CC_SCRUB_KEYS[key]) return v;
  if (typeof v === 'string') {
    return ssaScrub_(v.replace(CC_DOB_RE, '$1 [withheld]').replace(CC_MEDICAID_RE, '$1$2 [withheld]')
                      .replace(/(^|\D)\d{12}(?=\D|$)/g, '$1[withheld]').replace(CC_SSN_RE, '$1[withheld]')
                      .replace(CC_CARD_RE, '$1[withheld]'));
  }
  if (typeof v === 'number') {
    return Math.round(v) === v && String(Math.abs(v)).length === 12 ? null : ssaScrub_(v);
  }
  if (Array.isArray(v)) return v.map(function (x) { return ccScrub_(x); });
  if (v && typeof v === 'object') {
    var out = {};
    Object.keys(v).forEach(function (k) { out[k] = ccScrub_(v[k], k); });
    return out;
  }
  return ssaScrub_(v);
}

function ccEsc_(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A JSON cell as its value (the sheet hands back a parsed one, or its text); `fallback` when it holds neither. */
function ccJsonOf_(v, fallback) {
  if (v && typeof v === 'object') return v;
  var s = String(v == null ? '' : v).trim();
  if (!s) return fallback;
  try { var got = JSON.parse(s); return got && typeof got === 'object' ? got : fallback; } catch (e) { return fallback; }
}

/** The candidate's log: {at, by, kind, text} in the order they were written. */
function ccLogOf_(v) {
  var list = ccJsonOf_(v, []);
  return (Array.isArray(list) ? list : []).filter(function (e) {
    return e && typeof e === 'object' && String(e.at || '') && String(e.text || '');
  }).map(function (e) {
    return { at: String(e.at), by: String(e.by || ''), kind: String(e.kind || ''), text: String(e.text) };
  });
}

/** The log with one more entry, the oldest let go past its cap or past what a cell holds. */
function ccLogWith_(v, entry) {
  var list = ccLogOf_(v).concat([entry]);
  if (list.length > CC_LOG_CAP) list = list.slice(list.length - CC_LOG_CAP);
  while (list.length > 1 && JSON.stringify(list).length > CC_LOG_CHARS) list.shift();
  return list;
}

/** The papers filed from this app: { assessment: {…}, consent: {…} }. */
function ccDocsOf_(v) {
  var docs = ccJsonOf_(v, {});
  return docs && typeof docs === 'object' && !Array.isArray(docs) ? docs : {};
}

/** The contact preferences recorded with the consent: method, best time, who to contact. */
function ccPrefsOf_(v) {
  var p = ccJsonOf_(v, {});
  p = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  return { method: ccText_(p.method, 60), best_time: ccText_(p.best_time, 120), who: ccText_(p.who, 200) };
}

function ccPrefsWords_(p) {
  return [p.method ? 'by ' + p.method : '', p.best_time ? p.best_time : '', p.who ? 'ask for ' + p.who : '']
    .filter(String).join(' · ');
}

/** The Ohio wall clock to the second: 2026-09-28 14:03:22. */
function ccClock_(at) {
  var s = at.getUTCSeconds();
  return Utilities.formatDate(at, CC_TZ, 'yyyy-MM-dd') + ' ' + Utilities.formatDate(at, CC_TZ, 'HH:mm') + ':' +
    (s < 10 ? '0' : '') + s;
}

/** A note as one line of the referral's notes: when, who, the step it is about, then the words. */
function ccNoteLine_(at, by, about, text) {
  return ccClock_(at) + (by ? ' · ' + by : '') + ' — ' + (about ? about + ': ' : '') + text;
}

function ccNotesWith_(notes, line) {
  var s = String(notes == null ? '' : notes).trim();
  return s ? s + '\n' + line : line;
}

// ---- the referral rows and the lookup -------------------------------------

function ccLeads_() {
  var memo = CC_MEMO_;
  if (memo && memo.leads) return memo.leads;
  var rows = listRows_(CC_LEADS, {}) || [];
  var byId = {};
  rows.forEach(function (r) {
    var id = String((r && r.id) || '').trim();
    if (id && !byId[id]) byId[id] = r;
  });
  var leads = { rows: rows, byId: byId };
  if (memo) memo.leads = leads;
  return leads;
}

function ccCtxOf_(key, row) {
  return { key: key, name: ccText_(row.client_name, 160) || key, row: row, stage: ccStageId_(row.stage), memo: {} };
}

/** The referral a request names: 400 when no row carries the id, 503 when the rows cannot say. */
function ccCandidate_(raw) {
  var key = String(raw == null ? '' : raw).trim();
  var none = { refused: { status: 400, message: 'No candidate "' + key.slice(0, 120) + '" is on file.' } };
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(key)) return none;
  var leads;
  try { leads = ccLeads_(); }
  catch (e) {
    return { refused: { status: 503, message: 'The Potential Clients records could not be read just now (' +
             String((e && e.message) || e).slice(0, 120) + ') — nothing is said about this candidate.' } };
  }
  var row = leads.byId[key];
  if (!row) return none;
  return ccCtxOf_(key, row);
}

// ---- caching --------------------------------------------------------------

/** The referral's row as a version: any write to the row retires every answer built on it. */
function ccStamp_(ctx) {
  try { return String(hashCode_(JSON.stringify(ctx.row))); } catch (e) { return 'x'; }
}

/** Keyed cc_<action>_<key>; the name carries the row's version. A degraded answer is never kept. */
function ccCached_(action, ctx, producer) {
  var scope = 'cc_' + action + '_' + ctx.key;
  var value = cacheRead_(scope, 'v2_' + ccStamp_(ctx), producer);
  if (value && value.degraded) cacheBump_(scope);
  return value;
}

/** One part's scrubbed answer, built once per request and shared by every part that shows it. */
function ccData_(action, ctx, build) {
  var slot = 'a:' + action;
  if (ctx.memo[slot]) return ctx.memo[slot];
  var data = ccCached_(action, ctx, function () { return ccScrub_(build()); });
  ctx.memo[slot] = data;
  return data;
}

/** One read's answer: 503 names the source when the build throws. */
function ccServe_(what, get) {
  try { return { status: 200, data: get() }; }
  catch (e) {
    return { status: 503, message: what + ' could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
}

// ---- the roster -----------------------------------------------------------

function ccRosterRow_(row) {
  var zip = ccText_(row.postal_code, 20);
  var stage = ccStageId_(row.stage);
  return {
    key: String(row.id), referral_id: ccText_(row.referral_id, 40), name: ccText_(row.client_name, 160),
    service: ccText_(row.description, 280), stage: stage, stage_label: ccStageLabel_(stage),
    intake_stage: ccStageOf_(stage), zip: zip, county: '', location: ccPlace_(zip), next_step: ccText_(row.next_step, 200),
    owner: ccText_(row.owner, 120), source: ccSource_(row), referred_at: ccText_(row.scraped_at) || ccText_(row.createdAt),
    phone: ccText_(row.phone, 40), email: ccText_(row.email, 120), rating: ccText_(row.ai_rating, 10),
    expires: ccText_(row.expiration_date, 40), alerted: ccTruthy_(row.sms_sent), avatar: ''
  };
}

function ccRosterBuild_() {
  var leads = ccLeads_();
  var counts = {}, other = {}, seen = {}, out = [];
  leads.rows.forEach(function (r) {
    var id = String((r && r.id) || '').trim();
    if (!id || seen[id] || !ccText_(r.client_name)) return;
    seen[id] = true;
    var row = ccRosterRow_(r);
    if (row.intake_stage) counts[row.intake_stage] = (counts[row.intake_stage] || 0) + 1;
    else other[row.stage] = (other[row.stage] || 0) + 1;
    out.push(row);
  });
  out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  var stages = CC_STAGES.map(function (s) { return { id: s.id, label: s.label, count: counts[s.id] || 0 }; });
  Object.keys(other).sort().forEach(function (s) { stages.push({ id: s, label: ccStageLabel_(s), count: other[s] }); });
  return { candidates: out, stages: stages, total: out.length, why: [], degraded: false };
}

HUB_POLICY.clientCandidateRoster = {
  file: 'ClientCandidates.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: {}
};
/** The pipeline and the switcher: every referral on the Potential Clients file, with its own stage, next step and owner. */
HUB_ACTIONS.clientCandidateRoster = function (payload, user) {
  if (!clientCandidatesGate_(user)) return clientCandidatesUnknown_();
  return ccServe_('The Potential Clients records', function () { return ccScrub_(ccRosterBuild_()); });
};

// ---- the opt-out list -----------------------------------------------------

// The opt-out list's entry for the referral's phone or e-mail: {none} with neither, {hit} or {hit: null}; throws…
function ccOptOut_(ctx) {
  if (ctx.memo.optOut) return ctx.memo.optOut;
  var row = ctx.row;
  var targets = spNumbers_(row.phone).concat(String(row.email || '').indexOf('@') !== -1 ? [String(row.email).trim()] : []);
  var out;
  if (!targets.length) out = { none: true, hit: null };
  else {
    var idx = optOutIndex_();
    if (idx.error) throw new Error(idx.error);
    var hit = null;
    targets.forEach(function (t) {
      var k = optOutKey_(t);
      if (!hit && k && idx.by[k]) hit = idx.by[k];
    });
    out = { none: false, hit: hit };
  }
  ctx.memo.optOut = out;
  return out;
}

function ccOptOutWords_(hit) {
  var day = spDay_(hit.at);
  return 'The referral\'s phone or e-mail is on the opt-out list — they asked us to stop' + (day ? ' on ' + day : '') +
    (hit.scope ? ' (' + ccText_(hit.scope, 40) + ')' : '') + '.';
}

// ---- the intake: actions and the plan -------------------------------------

/** A press on this row: what it writes and which door takes it. */
function ccStep_(ctx, kind, p, stage) {
  return { action: 'clientCandidateWrite', candidate_id: ctx.key, kind: kind, item: p ? p.id : '',
           fields: { stage: ccStageMeta_(stage).label } };
}

// Each phase for the referral's stage: completed, awaiting_confirmation (worked on now) or pending, the next one…
function ccPhaseRows_(ctx) {
  var at = ccStageIndex_(ctx.stage);
  var here = at >= 0 ? CC_ORDER[at] : '';
  var states = CC_PHASES.map(function (p) {
    if (at >= CC_ORDER.indexOf(p.done)) return 'completed';
    return here && p.at.indexOf(here) !== -1 ? 'awaiting_confirmation' : 'pending';
  });
  var head = -1;
  if (at >= 0) for (var i = 0; i < states.length; i++) if (states[i] !== 'completed') { head = i; break; }
  return CC_PHASES.map(function (p, i) {
    var st = states[i], next = i === head;
    var why = '';
    if (st !== 'completed' && !next) {
      if (at === -2) why = 'Closed — Update stage moves it back into the intake first.';
      else if (at === -1) why = 'Its stage is not an intake stage — Update stage sets one first.';
      else why = 'Comes after ' + CC_PHASES[i - 1].title + '.';
    }
    return { phase: p, state: st, next: next, open: st !== 'completed' && at !== -2, why: why,
             complete: next ? ccStep_(ctx, 'complete', p, p.done) : null,
             reopen: st === 'completed' && at >= 0 ? ccStep_(ctx, 'reopen', p, p.at[0]) : null };
  });
}

function ccPhaseStates_(ctx) {
  return ccPhaseRows_(ctx).map(function (r) { return r.state; });
}

/** What needs a person now, from the referral's own row. */
function ccAttention_(ctx) {
  var row = ctx.row, out = [];
  var intake = ccStageOf_(ctx.stage);
  var closed = intake === 'ready-for-intake' || intake === 'closed';
  var today = locationsToday_();
  var ends = spDay_(row.expiration_date);
  if (!closed && ends) {
    if (ends < today) out.push('The referral window closed on ' + ends + '.');
    else if (locationsDayShift_(today, CC_CLOSING_DAYS) >= ends) out.push('The referral window closes on ' + ends + '.');
  }
  if (ccTruthy_(row.sms_sent) && ctx.stage === 'new') {
    out.push('The team was texted about this referral and nobody has opened it yet.');
  }
  if (!ccText_(row.phone) && !ccText_(row.email)) out.push('No phone or e-mail is on the referral.');
  if (!closed && !ccText_(row.owner)) out.push('No intake coordinator is set.');
  var opt = null;
  try { opt = ccOptOut_(ctx); } catch (e) { opt = null; }
  if (opt && opt.hit) out.push(ccOptOutWords_(opt.hit));
  return out;
}

/** The Update stage choices: the six intake stages, each written to the row's own stage. */
function ccStageChoices_(ctx) {
  var cur = ccStageOf_(ctx.stage);
  return CC_STAGES.map(function (s) {
    var current = s.id === cur;
    return { id: s.id, label: s.label, description: s.description, current: current,
             write: current ? null : ccStep_(ctx, 'stage', null, s.id) };
  });
}

function ccActionsBuild_(ctx) {
  var row = ctx.row, why = [];
  var at = ccStageIndex_(ctx.stage);
  var today = locationsToday_();
  var due = spDay_(row.expiration_date);
  var owner = ccText_(row.owner, 120);
  if (at === -2) why.push('The referral is Closed; the stage alone does not say how far its intake got.');
  if (at === -1) why.push('The stage "' + ccText_(row.stage, 60) + '" is not an intake stage.');
  var items = ccPhaseRows_(ctx).map(function (r) {
    var p = r.phase, st = r.state;
    var itemDue = r.open && at >= 0 ? due : '';
    return { id: p.id, label: p.label, title: p.title, stage: p.at[0], status: st === 'completed' ? 'done' :
             (st === 'awaiting_confirmation' ? 'in_progress' : 'pending'), open: r.open, is_next: r.next, owner: owner,
             due: itemDue, due_state: ccDueState_(itemDue, today), next_step: r.next ? ccText_(row.next_step, 300) : '',
             complete: r.complete, reopen: r.reopen, complete_why: r.why };
  });
  return {
    stage: ctx.stage, stage_label: ccStageLabel_(ctx.stage), closed: at === -2 || at === CC_ORDER.length - 1,
    items: items, next: items.filter(function (x) { return x.is_next; })[0] || null,
    open: items.filter(function (x) { return x.open; }).length,
    attention: ccAttention_(ctx), stages: ccStageChoices_(ctx),
    note: { action: 'clientCandidateWrite', candidate_id: ctx.key, kind: 'note',
            current: String(row.notes == null ? '' : row.notes) },
    why: why, degraded: false
  };
}

function ccActions_(ctx) {
  return ccData_('clientCandidateActions', ctx, function () { return ccActionsBuild_(ctx); });
}

function ccActionsDoor_(ctx) {
  return ccServe_('The intake actions', function () { return ccActions_(ctx); });
}

HUB_POLICY.clientCandidateActions = {
  file: 'ClientCandidates.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' } }
};
/** Actions: the intake with the family — each phase from the referral's stage, and the press that completes or reopens it. */
HUB_ACTIONS.clientCandidateActions = function (payload, user) {
  if (!clientCandidatesGate_(user)) return clientCandidatesUnknown_();
  var ctx = ccCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  return ccActionsDoor_(ctx);
};

function ccIntakeBuild_(ctx) {
  var row = ctx.row, why = [];
  var states = ccPhaseStates_(ctx);
  var at = ccStageIndex_(ctx.stage);
  var owner = ccText_(row.owner, 120);
  var log = ccLogOf_(row[CC_LOG_FIELD]);
  var plan = CC_PHASES.map(function (p, i) {
    var current = states[i] === 'awaiting_confirmation';
    var moved = '';
    log.forEach(function (e) { if (e.text === 'Completed action: ' + p.label) moved = e.at; });
    return { id: p.id, title: p.title, detail: p.label, date: states[i] === 'completed' ? moved : '', owner: owner,
             status: states[i], result: states[i] === 'completed' ? 'Reached ' + ccStageMeta_(p.done).label : '',
             comments: current ? ccText_(row.next_step, 300) : '' };
  });
  why.push('A phase carries a date only when it was completed here; the stage alone does not say when it moved.');
  if (at === -2) why.push('The referral is Closed; the stage alone does not say how far its intake got.');
  if (at === -1) why.push('The stage "' + ccText_(row.stage, 60) + '" is not an intake stage.');
  var zip = ccText_(row.postal_code, 20);
  var prefs = ccPrefsOf_(row[CC_PREFS_FIELD]);
  var preferences = [
    { label: 'Service requested', value: ccText_(row.description, 600) },
    { label: 'Frequency', value: ccText_(row.frequency, 200) },
    { label: 'Funding source', value: ccText_(row.funding_source, 80) },
    { label: 'Location', value: ccPlace_(zip) },
    { label: 'Preferred start', value: '' },
    { label: 'Important to them', value: '' }
  ];
  var support = [
    { label: 'Family / guardian', value: '' },
    { label: 'Phone', value: ccText_(row.phone, 40) },
    { label: 'E-mail', value: ccText_(row.email, 120) },
    { label: 'Referred by', value: ccSource_(row) },
    { label: 'Contact method', value: prefs.method },
    { label: 'Best time', value: prefs.best_time },
    { label: 'Who to contact', value: prefs.who }
  ];
  why.push('Not on the referral: family or guardian, a preferred start and what is important to them — the Potential ' +
           'Clients row does not carry them.');
  return { plan: plan, preferences: preferences, support: support, closed: at === -2, why: why, degraded: false };
}

function ccIntake_(ctx) {
  return ccData_('clientCandidateIntake', ctx, function () { return ccIntakeBuild_(ctx); });
}

function ccIntakeDoor_(ctx) {
  return ccServe_('The intake plan', function () { return ccIntake_(ctx); });
}

HUB_POLICY.clientCandidateIntake = {
  file: 'ClientCandidates.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' } }
};
/** Intake: referral review, discovery & assessment and service fit & placement, and what the referral says they need. */
HUB_ACTIONS.clientCandidateIntake = function (payload, user) {
  if (!clientCandidatesGate_(user)) return clientCandidatesUnknown_();
  var ctx = ccCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  return ccIntakeDoor_(ctx);
};

// ---- the client a referral became, and the plan that names them -----------

/** The client a referral ready for intake became: the one client record carrying its name; null otherwise, why says which. */
function ccClientOf_(ctx, sink) {
  if (ccStageOf_(ctx.stage) !== 'ready-for-intake') return null;
  if (ctx.memo.client !== undefined) return ctx.memo.client;
  var want = clientNameKey_(ctx.name), hits = [];
  try {
    (clientsDerived_(null) || []).forEach(function (c) {
      var name = ccText_(c && c.name);
      if (want && clientNameKey_(name) === want) {
        hits.push({ key: String(c.client_key || '').trim() || clientNameKey_(name), name: name });
      }
    });
  } catch (e) {
    sink.why.push(ccWhy_('The client records', e));
    sink.degraded = true;
    return null;
  }
  var out = null;
  if (hits.length === 1) out = hits[0];
  else if (hits.length > 1) sink.why.push('Two client records carry this name, so the client it became is not named.');
  else sink.why.push('No client record carries this name yet, so the client it became is not named.');
  ctx.memo.client = out;
  return out;
}

/** The one plan in the plans folder carrying the referral's name, and the sections read from it; none otherwise. */
function ccPlanOf_(ctx, sink) {
  if (ctx.memo.plan) return ctx.memo.plan;
  var out = { file: null, sections: [], year: '', readable: true };
  var idx = null;
  try { idx = ispDocIndex_(); } catch (e) { idx = null; }
  if (!idx || !idx.files) {
    out.readable = false;
    sink.why.push('The plans folder could not be read, so no plan file is listed.');
    sink.degraded = true;
  } else {
    var hit = null;
    try { hit = ispDocFor_(ctx.name); } catch (eD) { hit = null; }
    if (hit && hit.id) out.file = { id: String(hit.id), name: ccText_(hit.name, 160) };
  }
  if (out.file) {
    var want = clientNameKey_(ctx.name), rows = [];
    try {
      (listRows_('isps', {}) || []).forEach(function (r) {
        if (want && (String(r.client_key || '').trim() === want || clientNameKey_(r.client_name || r.name) === want)) {
          rows.push(r);
        }
      });
    } catch (eI) { sink.why.push(ccWhy_('The plans read into sections', eI)); sink.degraded = true; }
    rows.sort(function (a, b) { return String(b.isp_year || '').localeCompare(String(a.isp_year || '')); });
    var isp = rows[0];
    if (isp) {
      out.year = ccText_(isp.isp_year, 10);
      CC_ASSESSMENT_FIELDS.forEach(function (f) {
        var t = ccText_(isp[f[0]], 4000);
        if (t) out.sections.push({ key: f[0], label: f[1], text: t });
      });
    }
  }
  ctx.memo.plan = out;
  return out;
}

// ---- documents ------------------------------------------------------------

function ccDocumentsBuild_(ctx) {
  var row = ctx.row, sink = { why: [], degraded: false }, docs = [];
  var intake = ccStageOf_(ctx.stage);
  var filed = ccDocsOf_(row[CC_DOCS_FIELD]);
  var referred = spDay_(row.scraped_at) || spDay_(row.createdAt);
  var ends = spDay_(row.expiration_date);
  var told = !!(ccText_(row.description) || ccText_(row.frequency) || ccText_(row.diagnosis));
  docs.push({ id: 'referral', title: 'Referral summary', group: 'referral', group_label: 'Referral', status: 'on_file',
              date: referred, file_id: '', render: 'referral', mime: 'application/pdf', source: ccSource_(row),
              can_file: false,
              detail: told ? [ccText_(row.referral_id) ? 'Referral ' + ccText_(row.referral_id, 40) : '',
                              ends ? 'window until ' + ends : ''].filter(String).join(' · ')
                           : 'The referral names no service, frequency or diagnosis.' });

  var plan = ccPlanOf_(ctx, sink);
  var a = filed.assessment || null;
  var assessment = { id: 'assessment', title: 'Support assessment', group: 'assessment', group_label: 'Assessment',
                     status: 'pending', date: '', file_id: '', render: '', mime: '', source: '', detail: '',
                     can_file: false };
  if (a && a.file_id) {
    assessment.status = 'on_file';
    assessment.file_id = String(a.file_id);
    assessment.mime = String(a.mime || '');
    assessment.date = spDay_(a.at);
    assessment.source = 'Filed' + (a.by ? ' by ' + ccText_(a.by, 80) : '');
    assessment.detail = ccText_(a.name, 160);
  } else if (plan.sections.length) {
    assessment.status = 'on_file';
    assessment.render = 'assessment';
    assessment.mime = 'application/pdf';
    assessment.source = 'The plan on file' + (plan.year ? ' · ISP ' + plan.year : '');
    assessment.detail = 'From the plan: ' + plan.sections.map(function (s) { return s.label; }).join(', ');
  } else if (plan.file) {
    assessment.status = 'on_file';
    assessment.file_id = plan.file.id;
    assessment.mime = ssaMime_(plan.file.name);
    assessment.source = 'The plan on file';
    assessment.detail = plan.file.name + ' — not read into sections yet.';
  } else {
    assessment.can_file = intake === 'assessment';
    assessment.detail = plan.readable
      ? 'No plan on file carries this name' + (assessment.can_file ? ' — file the assessment here.'
                                                                   : '; it is filed here at the Assessment stage.')
      : 'The plans folder could not be read.';
  }
  docs.push(assessment);

  var c = filed.consent || null;
  var prefs = ccPrefsOf_(row[CC_PREFS_FIELD]);
  var consent = { id: 'consent', title: 'Consent & contact preferences', group: 'consent', group_label: 'Consent',
                  status: 'pending', date: '', file_id: '', render: '', mime: '', source: '', detail: '',
                  can_file: true, preferences: prefs };
  if (c && c.file_id) {
    consent.status = c.confirmed_at ? 'on_file' : 'in_review';
    consent.file_id = String(c.file_id);
    consent.mime = String(c.mime || '');
    consent.date = spDay_(c.at);
    consent.source = 'Filed' + (c.by ? ' by ' + ccText_(c.by, 80) : '');
    consent.detail = [ccPrefsWords_(prefs),
                      c.confirmed_at ? 'confirmed ' + spDay_(c.confirmed_at) : 'awaiting confirmation'].filter(String)
      .join(' · ');
  } else {
    consent.detail = 'No signed consent is filed yet.';
  }
  var opt = null;
  try { opt = ccOptOut_(ctx); }
  catch (eO) { sink.why.push(ccWhy_('The opt-out list', eO)); sink.degraded = true; }
  if (opt && opt.hit) {
    consent.opt_out = { at: spDay_(opt.hit.at), scope: ccText_(opt.hit.scope, 40) };
    consent.detail += ' ' + ccOptOutWords_(opt.hit);
  }
  docs.push(consent);

  if (plan.file || intake === 'ready-for-intake') {
    docs.push({ id: 'isp', title: 'Individual Service Plan', group: 'admission', group_label: 'Admission',
                status: plan.file ? 'on_file' : 'pending', date: '', file_id: plan.file ? plan.file.id : '', render: '',
                mime: plan.file ? ssaMime_(plan.file.name) : '', source: 'Plans folder', can_file: false,
                detail: plan.file ? plan.file.name : 'The plans folder holds no single plan for this name.' });
  }
  var onFile = docs.filter(function (d) { return d.status === 'on_file'; }).length;
  return { docs: docs,
           counts: { total: docs.length, on_file: onFile,
                     with_file: docs.filter(function (d) { return !!(d.file_id || d.render); }).length },
           why: sink.why, degraded: sink.degraded };
}

function ccDocuments_(ctx) {
  return ccData_('clientCandidateDocuments', ctx, function () { return ccDocumentsBuild_(ctx); });
}

function ccDocumentsDoor_(ctx) {
  return ccServe_('The documents', function () { return ccDocuments_(ctx); });
}

HUB_POLICY.clientCandidateDocuments = {
  file: 'ClientCandidates.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' } }
};
/** Documents: the referral summary, the support assessment, the consent and contact preferences, and the plan. */
HUB_ACTIONS.clientCandidateDocuments = function (payload, user) {
  if (!clientCandidatesGate_(user)) return clientCandidatesUnknown_();
  var ctx = ccCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  return ccDocumentsDoor_(ctx);
};

/** A rendered paper as HTML: the referral as the portal sent it, or the assessment read from the plan's sections. */
function ccRenderHtml_(ctx, doc) {
  var row = ctx.row, parts = [];
  var pair = function (label, value) {
    var v = ccScrub_(ccText_(value, 4000));
    if (v) parts.push('<tr><th>' + ccEsc_(label) + '</th><td>' + ccEsc_(v).replace(/\n/g, '<br>') + '</td></tr>');
  };
  var title = doc === 'referral' ? 'Referral summary' : 'Support assessment';
  if (doc === 'referral') {
    pair('Referral', row.referral_id);
    pair('Referred', spDay_(row.scraped_at) || spDay_(row.createdAt));
    pair('Referral window', spDay_(row.expiration_date));
    pair('Source', ccSource_(row));
    pair('Service requested', row.description);
    pair('Diagnosis', row.diagnosis);
    pair('Frequency', row.frequency);
    pair('Funding source', row.funding_source);
    pair('Age', row.client_age);
    pair('Gender', row.client_gender);
    pair('ZIP', row.postal_code);
    pair('AI rating', ccText_(row.ai_rating) ? ccText_(row.ai_rating, 10) + ' of 10' : '');
    pair('AI notes', row.ai_notes);
  } else {
    var plan = ccPlanOf_(ctx, { why: [], degraded: false });
    pair('From the plan', plan.file ? plan.file.name : '');
    plan.sections.forEach(function (s) { pair(s.label, s.text); });
  }
  return '<html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:11pt;color:#1d2939}' +
    'h1{font-size:16pt;margin:0 0 4pt}p{color:#667085;margin:0 0 12pt}table{border-collapse:collapse;width:100%}' +
    'th{text-align:left;vertical-align:top;width:30%;padding:6pt;border-bottom:1px solid #e4e7ec;color:#475467}' +
    'td{padding:6pt;border-bottom:1px solid #e4e7ec}</style></head><body><h1>' + ccEsc_(title) + '</h1><p>' +
    ccEsc_(ctx.name) + ' · Client Candidates</p><table>' + parts.join('') + '</table></body></html>';
}

/** HTML as PDF bytes, through Drive's own conversion. */
function ccPdf_(html, name) {
  return Utilities.newBlob(html, 'text/html', name + '.html').getAs('application/pdf').getBytes();
}

HUB_POLICY.clientCandidateDocFile = {
  file: 'ClientCandidates.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' }, file_id: { type: 'string' }, doc: { type: 'string' } }
};
// One of the candidate's documents as bytes for the platform's centred viewer: a file their Documents list names…
HUB_ACTIONS.clientCandidateDocFile = function (payload, user) {
  if (!clientCandidatesGate_(user)) return clientCandidatesUnknown_();
  var ctx = ccCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  var render = ccText_(payload && payload.doc, 40);
  var id = ccText_(payload && payload.file_id, 120);
  if (!render && !/^[A-Za-z0-9_-]{10,}$/.test(id)) return { status: 400, message: 'file_id: a Drive file id.' };
  var docs;
  try { docs = ccDocuments_(ctx).docs || []; }
  catch (eK) { return { status: 503, message: 'The documents could not be read just now — try again in a minute.' }; }
  if (render) {
    var paper = docs.filter(function (d) { return d.render === render; })[0];
    if (!paper) return { status: 404, message: 'This candidate names no such document.' };
    var bytes;
    try { bytes = ccPdf_(ccRenderHtml_(ctx, render), paper.title); }
    catch (eR) { return { status: 503, message: 'The document could not be made just now — try again in a minute.' }; }
    return { status: 200, data: { id: render, name: paper.title + '.pdf', mime: 'application/pdf', size: bytes.length,
                                  exported: true, b64: Utilities.base64Encode(bytes) } };
  }
  if (!docs.some(function (d) { return d.file_id === id; })) return { status: 404, message: 'This candidate names no such document.' };
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

// ---- the team alerts ------------------------------------------------------

// The lead alerts the outbox holds for this referral (Scraper.gs scraperNotify, one row per number), newest first…
function ccAlerts_(ctx) {
  if (ctx.memo.alerts) return ctx.memo.alerts;
  var out = { items: [], why: '', degraded: false };
  var sheet = null;
  try { sheet = hubTabSheet_(COMM_MOCK_HOUSE); } catch (e) { sheet = null; }
  if (!sheet) {
    if (ccTruthy_(ctx.row.sms_sent)) {
      out.why = 'The team was texted about this referral; the outbox could not be opened to say when.';
      out.degraded = true;
    }
  } else {
    var prefix = scraperAlertKey_(ctx.key, '');
    var cols = spReadColumns_(sheet, {
      id: { names: ['id'] }, at: { names: ['at'] }, key: { names: ['ledger_key'] }, result: { names: ['result'] },
      to: { names: ['to_masked'] }, body: { names: ['body'] }, held: { names: ['held_by'] }, pass: { names: ['pass_id'] }
    });
    var c = cols.cols;
    for (var i = 0; i < cols.n; i++) {
      if (String(c.key[i] || '').indexOf(prefix) !== 0) continue;
      out.items.push({ id: String(c.id[i] || ('row' + (i + 2))), at: ccInstant_(c.at[i]),
                       result: String(c.result[i] || '').trim().toLowerCase(), to: ccText_(c.to[i], 40),
                       body: ccText_(c.body[i], 1200), held_by: ccText_(c.held[i], 200), pass: String(c.pass[i] || '') });
    }
    out.items.sort(ssaNewest_);
    if (!out.items.length && ccTruthy_(ctx.row.sms_sent)) {
      out.why = 'The team was texted about this referral; the outbox no longer keeps when.';
    }
  }
  ctx.memo.alerts = out;
  return out;
}

var CC_ALERT_TITLES = { sent: 'The team was texted about this referral',
                        rehearsed: 'An alert about this referral went to the testers',
                        held: 'An alert about this referral was held', held_quiet: 'An alert about this referral was held',
                        refused: 'An alert about this referral was not sent',
                        failed: 'An alert about this referral did not go out' };

/** One Activity line per alert pass: when, how it ended, and to how many numbers. */
function ccAlertItems_(alerts) {
  var passes = {}, order = [];
  alerts.items.forEach(function (a) {
    var k = (a.pass || a.at.slice(0, 16)) + '|' + a.result;
    if (!passes[k]) { passes[k] = { at: a.at, result: a.result, held: a.held_by, n: 0 }; order.push(k); }
    passes[k].n++;
    if (a.at > passes[k].at) passes[k].at = a.at;
  });
  return order.map(function (k, i) {
    var p = passes[k];
    return { id: 'alert_' + (i + 1), at: p.at, kind: 'alert', title: CC_ALERT_TITLES[p.result] || 'Alert about this referral',
             body: 'To ' + p.n + ' number' + (p.n === 1 ? '' : 's') + (p.result !== 'sent' && p.held ? ' — ' + p.held : ''),
             by: 'Lead Scraper', channel: 'SMS', ok: p.result === 'sent' || p.result === 'rehearsed' ||
             p.result === 'held' || p.result === 'held_quiet', rehearsal: p.result === 'rehearsed' };
  });
}

// ---- activity -------------------------------------------------------------

var CC_EVENT_TITLES = { 'potentialClients.update': 'Referral record updated', 'potentialClients.create': 'Referral added',
                        'potentialClients.delete': 'Referral removed' };
var CC_LOG_KINDS = { stage: 'stage', step: 'step', note: 'note', document: 'document' };

function ccActivityBuild_(ctx) {
  var row = ctx.row, sink = { why: [], degraded: false }, items = [];
  var add = function (id, at, kind, title, body, by, ok, channel, rehearsal) {
    if (!at) return;
    items.push({ id: id, at: at, kind: kind, title: title, body: ccText_(body, 900), by: by || '', channel: channel || '',
                 ok: ok !== false, rehearsal: rehearsal === true });
  };
  var scraped = ccInstant_(row.scraped_at);
  if (scraped) {
    add('referral', scraped, 'referral', 'Referral received from the county referral portal',
        ccText_(row.referral_id) ? 'Referral ' + ccText_(row.referral_id, 40) : '', '', true);
  } else {
    add('referral', ccInstant_(row.createdAt), 'referral', 'Referral added', ccSource_(row), '', true);
  }
  ccLogOf_(row[CC_LOG_FIELD]).forEach(function (e, i) {
    add('log_' + (i + 1), ccInstant_(e.at), CC_LOG_KINDS[e.kind] || 'record', ccText_(e.text, 300), '',
        ccText_(e.by, 120), true);
  });
  var records = 0;
  try {
    spEventsFor_(ctx.key).forEach(function (e, i) {
      if (e.type === 'leadOpened' || CC_WRITE_ACTIONS.indexOf(e.type) !== -1) return;
      var title = CC_EVENT_TITLES[e.type];
      if (title && /\.update$/.test(e.type)) records++;
      var p = e.payload || {};
      add('evt_' + (i + 1), ccInstant_(e.at), 'record', title || ccText_(p.summary, 200) || e.type,
          p.ok === false ? ccText_(p.detail, 300) : '', String(e.actor || '').split(' (visiting')[0], p.ok !== false);
    });
    // Scraper.gs leadOpened logs the opening under the row's name and the move, as it writes them
    spEventsFor_(String(row.client_name || ctx.key) + ' new → read').forEach(function (e, i) {
      if (e.type !== 'lead_read') return;
      add('read_' + (i + 1), ccInstant_(e.at), 'stage', 'Opened after the team alert — New → Read', '',
          String(e.actor || '').split(' (visiting')[0], true);
    });
  } catch (eE) { sink.why.push(ccWhy_('The platform\'s event log', eE)); sink.degraded = true; }
  if (records) {
    sink.why.push('A change made in Potential Clients is logged as the referral record changing and who changed it, ' +
                  'not which field.');
  }
  var alerts = ccAlerts_(ctx);
  if (alerts.why) sink.why.push(alerts.why);
  if (alerts.degraded) sink.degraded = true;
  ccAlertItems_(alerts).forEach(function (x) {
    add(x.id, x.at, x.kind, x.title, x.body, x.by, x.ok, x.channel, x.rehearsal);
  });
  var ends = spDay_(row.expiration_date);
  if (ends && ends < locationsToday_()) add('window', ends, 'referral', 'Referral window closed', '', '', true);
  items.sort(ssaNewest_);
  return { items: items.slice(0, CC_ACTIVITY_CAP), total: items.length, why: sink.why, degraded: sink.degraded };
}

function ccActivity_(ctx) {
  return ccData_('clientCandidateActivity', ctx, function () { return ccActivityBuild_(ctx); });
}

function ccActivityDoor_(ctx) {
  return ccServe_('The activity', function () { return ccActivity_(ctx); });
}

HUB_POLICY.clientCandidateActivity = {
  file: 'ClientCandidates.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' } }
};
// Activity: the referral's arrival, every press logged here, every change logged on its row, its opening, the…
HUB_ACTIONS.clientCandidateActivity = function (payload, user) {
  if (!clientCandidatesGate_(user)) return clientCandidatesUnknown_();
  var ctx = ccCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  return ccActivityDoor_(ctx);
};

// ---- overview -------------------------------------------------------------

function ccOverviewBuild_(ctx) {
  var row = ctx.row, sink = { why: [], degraded: false };
  var part = function (what, get) {
    try {
      var d = get();
      (d.why || []).forEach(function (w) { if (sink.why.indexOf(w) === -1) sink.why.push(w); });
      if (d.degraded) sink.degraded = true;
      return d;
    } catch (e) { sink.why.push(ccWhy_(what, e)); sink.degraded = true; return null; }
  };
  var actions = part('The intake actions', function () { return ccActions_(ctx); });
  var docs = part('The documents', function () { return ccDocuments_(ctx); });
  var activity = part('The activity', function () { return ccActivity_(ctx); });
  var client = ccClientOf_(ctx, sink);
  var zip = ccText_(row.postal_code, 20);
  var source = ccSource_(row);
  var referred = ccText_(row.scraped_at) || ccText_(row.createdAt);
  var candidate = {
    key: ctx.key, name: ctx.name, referral_id: ccText_(row.referral_id, 40), service: ccText_(row.description, 600),
    stage: ctx.stage, stage_label: ccStageLabel_(ctx.stage), status_label: ccStageLabel_(ctx.stage),
    intake_stage: ccStageOf_(ctx.stage), location: ccPlace_(zip), county: '', zip: zip, owner: ccText_(row.owner, 120),
    source: source, referred_at: referred, phone: ccText_(row.phone, 40), email: ccText_(row.email, 120), avatar: '',
    rating: ccText_(row.ai_rating, 10), expires: ccText_(row.expiration_date, 40), alerted: ccTruthy_(row.sms_sent),
    client_key: client ? client.key : ''
  };
  var next = actions && actions.next ? actions.next : null;
  return {
    candidate: candidate,
    information: {
      full_name: ctx.name, stage_label: candidate.stage_label, phone: candidate.phone, email: candidate.email,
      source: source, referred_at: referred, service_requested: candidate.service, frequency: ccText_(row.frequency, 200),
      county: '', zip: zip, family: '', important_to_me: '', preferred_start: '', intake_coordinator: candidate.owner,
      referral_id: candidate.referral_id, age: ccText_(row.client_age, 10), gender: ccText_(row.client_gender, 20),
      diagnosis: ccText_(row.diagnosis, 600), funding_source: ccText_(row.funding_source, 80),
      expires: candidate.expires, rating: candidate.rating, notes: String(row.notes == null ? '' : row.notes)
    },
    client: client ? { key: client.key, name: client.name, href: '/app/client-profiles/profile?client=' +
                       encodeURIComponent(client.key) } : null,
    summary: ccText_(row.ai_notes, 900) || ccText_(row.description, 900),
    rating: { value: candidate.rating, notes: ccText_(row.ai_notes, 900) },
    tiles: { stage_label: candidate.stage_label, open_actions: actions ? actions.open : null,
             docs_on_file: docs ? docs.counts.on_file : null, docs_total: docs ? docs.counts.total : null },
    next: next ? { id: next.id, label: next.label, owner: next.owner, status: next.status, due: next.due,
                   due_state: next.due_state, next_step: next.next_step } : null,
    attention: actions ? actions.attention : [],
    recent: activity ? activity.items.slice(0, CC_RECENT) : [],
    opened: ccTruthy_(row.sms_sent) && ctx.stage === 'new'
      ? { action: 'leadOpened', payload: { ids: [ctx.key] } } : null,
    why: sink.why, degraded: sink.degraded
  };
}

function ccOverview_(ctx) {
  return ccData_('clientCandidateOverview', ctx, function () { return ccOverviewBuild_(ctx); });
}

function ccOverviewDoor_(ctx) {
  return ccServe_('The candidate', function () { return ccOverview_(ctx); });
}

HUB_POLICY.clientCandidateOverview = {
  file: 'ClientCandidates.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' } }
};
/** Overview: at a glance, contact and information from the referral row, the counts, the next step and recent activity. */
HUB_ACTIONS.clientCandidateOverview = function (payload, user) {
  if (!clientCandidatesGate_(user)) return clientCandidatesUnknown_();
  var ctx = ccCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  return ccOverviewDoor_(ctx);
};

// ---- texts and calls ------------------------------------------------------

/** Every phone the referral rows carry: last-ten digits → the referrals carrying it. */
function ccPhoneIndex_() {
  var memo = CC_MEMO_;
  if (memo && memo.phones) return memo.phones;
  var index = {};
  ccLeads_().rows.forEach(function (r) {
    var id = String((r && r.id) || '').trim();
    if (!id) return;
    spNumbers_(r.phone).forEach(function (d) { (index[d] = index[d] || {})['cc:' + id] = true; });
  });
  if (memo) memo.phones = index;
  return index;
}

// The referral in the shape the Staff app's text and call readers take: its phone and the numbers written in who to…
function ccStaffCtx_(ctx) {
  var shared = {};
  SHARED_LINE_DIGITS.forEach(function (d) { shared[d] = { company: true }; });
  var prefs = ccPrefsOf_(ctx.row[CC_PREFS_FIELD]);
  return { key: 'cc:' + ctx.key, name: ctx.name, account: null, master: null,
           people: { phone: ccText_(ctx.row.phone, 60), phones: spNumbers_(prefs.who), email: ccText_(ctx.row.email, 120),
                     emails: [] },
           phones_shared: shared };
}

/** Why no conversation can be attributed, or '' when one of the referral's numbers is its own. */
function ccNoPhoneWhy_(sctx) {
  if (!spNumbers_(sctx.people.phone).length && !sctx.people.phones.length) return 'no phone number is on the referral';
  var own = spOwnPhones_(sctx);
  if (Object.keys(own.mine).length) return '';
  return 'the phone number(s) on the referral are the company\'s own lines, so nothing on them is attributed';
}

/** A why line naming the other referrals that carry the same number; '' when none does. */
function ccSharedWhy_(ctx, sctx) {
  var index = {};
  try { index = ccPhoneIndex_(); } catch (e) { return ''; }
  var others = {};
  Object.keys(spOwnPhones_(sctx).mine).forEach(function (d) {
    Object.keys(index[d] || {}).forEach(function (k) { if (k !== sctx.key) others[k] = true; });
  });
  var n = Object.keys(others).length;
  return n ? 'the phone number is also on ' + n + ' other referral' + (n === 1 ? '' : 's') + ', whose conversations ' +
             'on it are listed here too' : '';
}

function ccJoinWhy_(a, b) {
  return [a, b].filter(String).join('; ');
}

function ccTextsFacts_(ctx) {
  return ccData_('clientCandidateTexts', ctx, function () {
    var sctx = ccStaffCtx_(ctx);
    var none = ccNoPhoneWhy_(sctx);
    var facts = none
      ? { counterparts: [], messages: [], coverage: { from: '', to: '', gaps: [] }, phones_matched: 0, why: none,
          degraded: false }
      : spTextsFacts_(sctx);
    if (!none) facts.why = ccJoinWhy_(facts.why, ccSharedWhy_(ctx, sctx));
    var alerts = ccAlerts_(ctx);
    facts.alerts = alerts.items.slice(0, CC_ALERTS_CAP).map(function (a) {
      return { id: a.id, at: a.at, result: a.result, to: a.to, body: a.body, held_by: a.held_by };
    });
    facts.alerts_why = alerts.why;
    if (alerts.degraded) facts.degraded = true;
    return facts;
  });
}

/** One page of one conversation, as the Staff app pages it, and the team's alerts about the referral. */
function ccTextsDoor_(ctx, payload) {
  var facts;
  try { facts = ccTextsFacts_(ctx); }
  catch (e) {
    return { status: 503, message: 'The texts could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
  var want = ccText_(payload && payload.with, 60);
  var ids = facts.counterparts.map(function (x) { return x.id; });
  var withId = ids.indexOf(want) !== -1 ? want : (ids[0] || '');
  var before = ccText_(payload && payload.before, 40);
  var thread = facts.messages.filter(function (m) { return m.line === withId && (!before || m.at < before); });
  var page = thread.slice(0, SP_TEXT_PAGE).map(function (m) { return { id: m.id, at: m.at, dir: m.dir, body: m.body, by: m.by }; });
  return { status: 200, data: { counterparts: facts.counterparts, with: withId, messages: page,
                                more: thread.length > SP_TEXT_PAGE, coverage: facts.coverage,
                                phones_matched: facts.phones_matched, alerts: facts.alerts || [],
                                alerts_why: facts.alerts_why || '', why: facts.why, degraded: !!facts.degraded } };
}

HUB_POLICY.clientCandidateTexts = {
  file: 'ClientCandidates.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' }, with: { type: 'string' }, before: { type: 'string' } }
};
// SMS: one conversation per company line with the referral's numbers, newest first, a page at a time, and the…
HUB_ACTIONS.clientCandidateTexts = function (payload, user) {
  if (!clientCandidatesGate_(user)) return clientCandidatesUnknown_();
  var ctx = ccCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  return ccTextsDoor_(ctx, payload);
};

function ccTranscripts_(ctx) {
  return ccData_('clientCandidateTranscripts', ctx, function () {
    var sctx = ccStaffCtx_(ctx);
    var none = ccNoPhoneWhy_(sctx);
    if (none) return { calls: [], categories: [], gaps: [], why: none, degraded: false };
    var got = spTranscriptsBuild_(sctx);
    got.why = ccJoinWhy_(got.why, ccSharedWhy_(ctx, sctx));
    return got;
  });
}

function ccTranscriptsDoor_(ctx) {
  return ccServe_('The calls', function () { return ccTranscripts_(ctx); });
}

HUB_POLICY.clientCandidateTranscripts = {
  file: 'ClientCandidates.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' } }
};
/** Transcripts: every call with the referral's numbers by date and category; the words open one call at a time. */
HUB_ACTIONS.clientCandidateTranscripts = function (payload, user) {
  if (!clientCandidatesGate_(user)) return clientCandidatesUnknown_();
  var ctx = ccCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  return ccTranscriptsDoor_(ctx);
};

HUB_POLICY.clientCandidateTranscript = {
  file: 'ClientCandidates.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' }, id: { type: 'string' } }
};
/** The words of one listed call, through the transcript door (its best copy and its read log). */
HUB_ACTIONS.clientCandidateTranscript = function (payload, user) {
  if (!clientCandidatesGate_(user)) return clientCandidatesUnknown_();
  var ctx = ccCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  var id = ccText_((payload && (payload.id || payload.call_id)), 60);
  if (!id) return { status: 400, message: 'id: which call.' };
  var list;
  try { list = ccTranscripts_(ctx).calls || []; }
  catch (e) { return { status: 503, message: 'The calls could not be read just now — try again in a minute.' }; }
  if (!list.some(function (c) { return c.call_id === id; })) return { status: 404, message: 'This candidate has no such call.' };
  var got = HUB_ACTIONS.commCallsTranscript({ call_id: id }, user);
  if (!got || got.status !== 200) return got;
  return { status: 200, data: ccScrub_(got.data) };
};

// ---- the writes -----------------------------------------------------------

/** The referral a press names, by its row id; '' when the shape is not one. */
function ccWriteKey_(payload) {
  var key = String((payload && payload.candidate_id) == null ? '' : payload.candidate_id).trim();
  return /^[A-Za-z0-9_-]{3,80}$/.test(key) ? key : '';
}

/** The live row, under the lock: its context, or the refusal. */
function ccLiveRow_(key) {
  var live = requireRow_(CC_LEADS, key);
  if (live && live.error) {
    return { refused: live.error.status === 404 ? { status: 400, message: 'No candidate "' + key + '" is on file.' }
                                                : live.error };
  }
  return ccCtxOf_(key, live);
}

/** What one press writes on the row as it stands: the fields, the log's line and the step a note is about. */
function ccWritePlan_(ctx, kind, payload) {
  if (kind === 'note') {
    var about = ccText_(payload && payload.item, 40);
    var ph = CC_PHASES.filter(function (p) { return p.id === about; })[0];
    return { fields: {}, text: 'Note added', log: 'note', about: ph ? ph.label : '' };
  }
  if (kind === 'stage') {
    var to = ccStageWanted_(payload && payload.stage);
    if (!to) {
      return { refused: { status: 400, message: 'stage: one of ' + CC_STAGES.map(function (s) { return s.label; })
               .join(', ') + '.' } };
    }
    if (to === ccStageOf_(ctx.stage)) {
      return { refused: { status: 409, message: ctx.name + ' is already at ' + ccStageMeta_(to).label + '.' } };
    }
    return { fields: { stage: ccStageMeta_(to).label },
             text: 'Stage: ' + ccStageLabel_(ctx.stage) + ' → ' + ccStageMeta_(to).label, log: 'stage', about: '' };
  }
  var item = ccText_(payload && payload.item, 40);
  var hit = ccPhaseRows_(ctx).filter(function (r) { return r.phase.id === item; })[0];
  if (!hit) return { refused: { status: 400, message: 'item: a step of the intake.' } };
  var step = kind === 'complete' ? hit.complete : hit.reopen;
  if (!step) {
    var why = kind === 'complete'
      ? (hit.state === 'completed' ? hit.phase.label + ' is already complete.' : hit.why || 'This step is not next.')
      : hit.phase.label + ' is not complete, so there is nothing to reopen.';
    return { refused: { status: 409, message: why } };
  }
  return { fields: { stage: step.fields.stage }, log: 'step', about: hit.phase.label,
           text: (kind === 'complete' ? 'Completed action: ' : 'Reopened action: ') + hit.phase.label };
}

HUB_POLICY.clientCandidateWrite = {
  file: 'ClientCandidates.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['potentialClients'], emits: [],
  params: { candidate_id: { type: 'string' }, kind: { type: 'string' }, stage: { type: 'string' },
            item: { type: 'string' }, note: { type: 'string' } }
};
// One press on the referral's own row, read live under the lock: Update stage, Mark complete or Reopen (the stage)…
HUB_ACTIONS.clientCandidateWrite = function (payload, user) {
  if (!clientCandidatesMaster_(user)) return clientCandidatesUnknown_();
  var key = ccWriteKey_(payload);
  if (!key) return { status: 400, message: 'candidate_id: the referral\'s row id.' };
  var kind = String((payload && payload.kind) || '');
  if (CC_WRITE_KINDS.indexOf(kind) === -1) return { status: 400, message: 'kind: stage, complete, reopen or note.' };
  var note = String((payload && payload.note) == null ? '' : payload.note).replace(/\s+/g, ' ').trim();
  if (note.length > CC_NOTE_MAX) return { status: 400, message: 'note: up to ' + CC_NOTE_MAX + ' characters.' };
  if (kind === 'note' && !note) return { status: 400, message: 'note: what the note says.' };
  if (kind === 'stage' && note) return { status: 400, message: 'note: Update stage files no note.' };
  var held = sheetDbGateHolds_(CC_LEADS, 'update');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return { status: 409, message: 'Another write is in progress — try again in a moment.' };
  var out;
  try {
    var ctx = ccLiveRow_(key);
    if (ctx.refused) return ctx.refused;
    var plan = ccWritePlan_(ctx, kind, payload);
    if (plan.refused) return plan.refused;
    var at = new Date(), by = locationsWho_(user);
    var entry = { at: at.toISOString(), by: by, kind: plan.log, text: plan.text };
    var patch = { id: key };
    Object.keys(plan.fields).forEach(function (k) { patch[k] = plan.fields[k]; });
    if (note) patch.notes = ccNotesWith_(ctx.row.notes, ccNoteLine_(at, by, plan.about, note));
    patch[CC_LOG_FIELD] = ccLogWith_(ctx.row[CC_LOG_FIELD], entry);
    var res = updateRowById_(CC_LEADS, patch);
    var refused = sheetDbRefused_(res);
    if (refused) return refused;
    var row = { id: key };
    if (patch.stage) row.stage = patch.stage;
    out = { entry: entry, row: row };
  } finally { lock.releaseLock(); }
  return { status: 200, data: out };
};

/** The referral's own folder under the platform's, made as the platform account on first use. */
function ccFolder_(key) {
  return filesChildByName_(filesChildByName_(filesRoot_(), CC_FOLDER), key);
}

function ccBytes_(b64) {
  return Utilities.base64Decode(b64);
}

function ccBlob_(bytes, mime, name) {
  return Utilities.newBlob(bytes, mime, name);
}

HUB_POLICY.clientCandidateFile = {
  file: 'ClientCandidates.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['potentialClients'], emits: [],
  params: { candidate_id: { type: 'string' }, doc: { type: 'string' }, file: {}, method: { type: 'string' },
            best_time: { type: 'string' }, contact_who: { type: 'string' }, confirm: { type: 'boolean' } }
};
// A paper filed for the referral into its own folder (a PDF or a picture): the support assessment, at the…
HUB_ACTIONS.clientCandidateFile = function (payload, user) {
  if (!clientCandidatesMaster_(user)) return clientCandidatesUnknown_();
  var key = ccWriteKey_(payload);
  if (!key) return { status: 400, message: 'candidate_id: the referral\'s row id.' };
  var doc = String((payload && payload.doc) || '');
  if (!CC_FILED[doc]) return { status: 400, message: 'doc: assessment or consent.' };
  var confirm = !!(payload && payload.confirm === true);
  if (confirm && doc !== 'consent') return { status: 400, message: 'confirm: only a filed consent is confirmed.' };
  var f = (payload && payload.file && typeof payload.file === 'object') ? payload.file : {};
  var fname = ccText_(f.filename || f.name, 180) || doc;
  var b64 = String(f.base64 || f.b64 || f.data || '').replace(/^data:[^,]*,/, '');
  var mime = confirm ? '' : complianceDocsFileType_(fname, f.mime || f.type);
  if (!confirm) {
    if (!mime) return { status: 400, message: CERT_DOC_TYPE_WORDS + ' Nothing was filed.' };
    if (!b64) return { status: 400, message: 'The file is required.' };
    if (b64.length > CC_FILE_MAX_B64) return { status: 400, message: 'The file is too large — up to 15MB.' };
  }
  var prefs = doc === 'consent' && !confirm
    ? { method: ccText_(payload.method, 60), best_time: ccText_(payload.best_time, 120), who: ccText_(payload.contact_who, 200) }
    : null;
  var held = sheetDbGateHolds_(CC_LEADS, 'update');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return { status: 409, message: 'Another write is in progress — try again in a moment.' };
  var out;
  try {
    var ctx = ccLiveRow_(key);
    if (ctx.refused) return ctx.refused;
    if (doc === 'assessment' && ccStageOf_(ctx.stage) !== 'assessment') {
      return { status: 409, message: 'The support assessment is filed at the Assessment stage — Update stage moves ' +
               ctx.name + ' there first.' };
    }
    var docs = ccDocsOf_(ctx.row[CC_DOCS_FIELD]);
    var at = new Date(), by = locationsWho_(user), text;
    if (confirm) {
      var c = docs.consent;
      if (!c || !c.file_id) return { status: 409, message: 'No signed consent is filed yet.' };
      if (c.confirmed_at) return { status: 409, message: 'The consent is already confirmed.' };
      c.confirmed_at = at.toISOString();
      c.confirmed_by = by;
      text = CC_FILED.consent + ' confirmed';
    } else {
      var bytes = ccBytes_(b64);
      if (!bytes || !bytes.length) return { status: 400, message: 'The file is empty.' };
      var name = (CC_FILED[doc] + ' - ' + key + ' - ' + fname).slice(0, 200);
      var made = ccFolder_(key).createFile(ccBlob_(bytes, mime, name));
      docs[doc] = { file_id: made.getId(), name: name, mime: mime, at: at.toISOString(), by: by };
      text = CC_FILED[doc] + ' filed';
    }
    var entry = { at: at.toISOString(), by: by, kind: 'document', text: text };
    var patch = { id: key };
    patch[CC_DOCS_FIELD] = docs;
    if (prefs) patch[CC_PREFS_FIELD] = prefs;
    patch[CC_LOG_FIELD] = ccLogWith_(ctx.row[CC_LOG_FIELD], entry);
    var res = updateRowById_(CC_LEADS, patch);
    var refused = sheetDbRefused_(res);
    if (refused) return refused;
    out = { entry: entry, row: { id: key }, doc: doc };
  } finally { lock.releaseLock(); }
  return { status: 200, data: out };
};

// ---- the relay's pack -----------------------------------------------------

/** Each part's door, past its gate, for one referral. */
function ccPackDoors_(ctx) {
  return {
    overview: function () { return ccOverviewDoor_(ctx); },
    actions: function () { return ccActionsDoor_(ctx); },
    intake: function () { return ccIntakeDoor_(ctx); },
    documents: function () { return ccDocumentsDoor_(ctx); },
    activity: function () { return ccActivityDoor_(ctx); },
    texts: function () { return ccTextsDoor_(ctx, {}); },
    transcripts: function () { return ccTranscriptsDoor_(ctx); }
  };
}

// The relay's pack: every section of one referral, each its own door's answer and cache, the referral rows read…
HUB_POLICY.clientCandidatePack = {
  file: 'ClientCandidates.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' } }
};
HUB_ACTIONS.clientCandidatePack = function (payload, user) {
  if (!user || !(user.is_service === true || clientCandidatesMaster_(user))) return clientCandidatesUnknown_();
  var started = Date.now();
  var held = CC_MEMO_, heldClients = CLIENTS_DERIVED_MEMO_;
  CC_MEMO_ = {};
  CLIENTS_DERIVED_MEMO_ = {};
  try {
    var ctx = ccCandidate_(payload && payload.candidate);
    if (ctx.refused) return ctx.refused;
    var doors = ccPackDoors_(ctx);
    var parts = {}, status = {};
    CC_PACK_PARTS.forEach(function (name) {
      if (Date.now() - started > CC_PACK_BUDGET_MS) {
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
    return { status: 200, data: { candidate: ctx.key, built_at: new Date(started).toISOString(), parts: parts,
                                  part_status: status } };
  } finally {
    CC_MEMO_ = held;
    CLIENTS_DERIVED_MEMO_ = heldClients;
  }
};
