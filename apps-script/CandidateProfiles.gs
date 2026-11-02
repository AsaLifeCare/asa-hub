// Staff Candidates: one candidate at a time, read from the Hiring app's own records.
// Every change is a Hiring door named on the answer, pressed through candidateProfileDoor, which files the press on…

var CND_ACTIONS = ['candidateProfileRoster', 'candidateProfileOverview', 'candidateProfileActions',
                   'candidateProfileInterviews', 'candidateProfileDocuments', 'candidateProfileDocFile',
                   'candidateProfileActivity', 'candidateProfileTexts', 'candidateProfileTranscripts',
                   'candidateProfileTranscript', 'candidateProfileNoteAdd', 'candidateProfileDoor',
                   'candidateProfileResume'];
// The résumé is not a pack part: its file is read only when Information asks, never for a neighbour.
var CND_PACK_PARTS = ['overview', 'actions', 'interviews', 'documents', 'activity', 'texts', 'transcripts'];
// Every section's own action, retired together when a press lands.
var CND_PART_ACTIONS = ['candidateProfileOverview', 'candidateProfileActions', 'candidateProfileInterviews',
                        'candidateProfileDocuments', 'candidateProfileActivity', 'candidateProfileTexts',
                        'candidateProfileTranscripts', 'candidateProfileResume'];
// Sections whose answer also stands on the candidate's own document rows, which no board row carries in full.
var CND_DOC_BOUND = { candidateProfileDocuments: true, candidateProfileOverview: true };
// Past this a pack starts no further part, so it always answers inside the execution limit.
var CND_PACK_BUDGET_MS = 240000;
// journeyLog_ keeps 900 characters of a line's detail.
var CND_NOTE_MAX = 900;
var CND_ACTIVITY_CAP = 400;
var CND_RECENT = 5;
var CND_STATUS_TAB = 'log_status_history';
// The board's own phase words, used when an answer names a stage.
var CND_STAGE_LABELS = { 'new': 'New', 'phone-screen': 'Phone Screen', interview: 'Interview', onboarding: 'Onboarding',
                         hired: 'Hired', ready: 'Ready to start' };
var CND_ONBOARDING_STAGES = ['onboarding', 'hired', 'ready'];
// A checklist item's Hiring door: the action, the form it needs and the stage the door itself insists on.
var CND_DOORS = {
  'resume-decision': { action: 'setDecision', fields: { checkpoint: 'resume-decision', value: 'Advance' } },
  'advance-decision': { action: 'setDecision', fields: { checkpoint: 'advance-decision', value: 'Advance' },
                        stage: 'phone-screen' },
  transcript: { action: 'screenManualComplete', form: 'notes', stage: 'phone-screen' },
  'ai-report': { action: 'screenManualComplete', form: 'notes', stage: 'phone-screen' },
  'screen-details': { action: 'screenManualComplete', form: 'notes', stage: 'phone-screen' },
  'interview-scheduled': { action: 'hiringScheduleCreate', form: 'schedule', fields: { event_type: 'in_person_interview' },
                           stage: 'interview' },
  'interview-scorecard': { action: 'interviewSave', form: 'scorecard', stage: 'interview' },
  'interview-recommendation': { action: 'interviewSave', form: 'scorecard', stage: 'interview' },
  'new-hire-packet': { action: 'packetWaive', form: 'note' },
  'onboarding-complete': { action: 'onboardingManualComplete', form: 'notes', stage: 'onboarding' },
  resume: { action: 'tableDocUpload', form: 'upload', fields: { item_id: 'resume' } },
  cjis: { action: 'tableDocUpload', form: 'upload', fields: { item_id: 'cjis' } }
};
var CND_MACHINE_ITEMS = ['application', 'staff-account', 'internal-docs-fill'];
// A press files one line on the hiring journey under this step; a stage row this close to a stage press is its echo.
var CND_PRESS_STEP = 'staff_candidates';
var CND_PRESS_ECHO_MS = 600000;
var CND_PRESS_TITLES = { complete: 'Mark complete', stage: 'Update stage', upload: 'Document filed',
                         document: 'Document filed' };
// Each door's name as the panel says it (candidateModel.ts DOOR_WORDS); the deposit's as the answer says it.
var CND_DOOR_TITLES = { setDecision: 'Advance', screenManualComplete: 'Manual phone screen',
                        hiringScheduleCreate: 'Schedule the interview', interviewSave: 'Interview scorecard',
                        packetWaive: 'New Hire packet on file', onboardingManualComplete: 'Manual onboarding',
                        tableDocUpload: 'Upload the file', moveStage: 'Move the stage', hiringDiscard: 'Not hiring',
                        docUpload: 'Onboarding Documents' };
// The doors a press may open, each with the form fields it takes under the name the door reads them by.
var CND_DOOR_FIELDS = {
  setDecision: {}, moveStage: {},
  screenManualComplete: { notes: 'notes' },
  hiringScheduleCreate: { date: 'date', time: 'time', location: 'location', with_name: 'with_name', notes: 'notes' },
  interviewSave: { interviewer_name: 'interviewer_name', score: 'score', recommendation: 'recommendation',
                   notes: 'comments' },
  packetWaive: { notes: 'note' },
  onboardingManualComplete: { notes: 'notes' },
  hiringDiscard: { notes: 'reason' },
  tableDocUpload: { filename: 'filename', mime_type: 'mime_type', base64: 'base64' }
};
// document catalog id → the checklist id the upload door files it under
var CND_ITEM_OF_DOC = { dropbox_packet: 'new-hire-packet', dodd_8hr: 'dodd-cert', cpr_first_aid: 'cpr-cert',
                        med_del: 'med-cert', drivers_id: 'drivers-license', hs_diploma: 'diploma', ss_birth: 'ss-card',
                        background_check: 'cjis' };
// document catalog id → the kinds the decoder may read that paper as (Digest.gs DIGEST_DOC_KINDS)
var CND_PAPER_KINDS = {
  dropbox_packet: ['offer_letter', 'work_authorization', 'tax_form', 'agreement'],
  background_check: ['background_check'], dodd_8hr: ['dodd_certification'], cpr_first_aid: ['cpr_first_aid'],
  med_del: ['med_admin_cert'], drivers_id: ['drivers_licence', 'state_id'], hs_diploma: ['diploma'],
  ss_birth: ['ssn_card', 'birth_certificate'], car_insurance: ['auto_insurance']
};
// The checklist steps that take a paper: the catalog id it is kept under (the résumé has none), whether the step's…
var CND_STEP_PAPERS = {
  resume: { doc: '', label: 'Résumé', kinds: ['application_resume'], word: true },
  cjis: { doc: 'background_check', pdf: true },
  'new-hire-packet': { doc: 'dropbox_packet' }
};
// What the decoder reads words off: a PDF or a picture of the paper; a Word file only where the step's door takes one.
var CND_PAPER_EXTS = ['pdf', 'jpg', 'jpeg', 'png', 'gif'];
var CND_WORD_TYPES = { doc: 'application/msword',
                       docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
var CND_WORD_TYPE_WORDS = 'A PDF, a Word document, or a PNG, JPEG, GIF, WebP or HEIC picture.';
// The name a paper is read under: none, so what it is comes from its own words, never from what the file is called.
var CND_PAPER_UNNAMED = '-';
// The whole New Hire packet in one paper's own words: its offer letter, and at least one of its forms.
var CND_PACKET_SHOWS = [['offer_letter'], ['work_authorization', 'tax_form']];
// cjisUpload's engine vocabulary: the background result a person picks when the report is filed.
var CND_CJIS_STATUSES = ['Pending', 'Clear', 'Verified', 'Disqualified'];
var CND_KIND_WORDS = { application_resume: 'résumé or application', offer_letter: 'offer letter', tax_form: 'tax form',
                       agreement: 'signed agreement' };
var CND_WHERE = { hiring: 'the Hiring record', onboarding: 'Onboarding Documents',
                  both: 'Onboarding Documents and the Hiring record' };
// The Onboarding Documents deposit (Files.gs, the candidate's own folder and catalog row): pressed only inside Add…
var CND_DEPOSIT_DOOR = 'docUpload';
// the decoder's own kind floor for a paper taken as what it is asked to be (certReadVerdict_)
var CND_PAPER_FLOOR = 10;
var CND_SCRUB_KEYS = { id: true, key: true, candidate_id: true, file_id: true, call_id: true, srid: true, doc_id: true,
                       with: true, line: true };
var CND_DOB_RE = /\b(DOB|D\.O\.B\.?|date of birth|birth ?date|born(?: on)?)\s*[:#-]?\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2,8}\.? \d{1,2},? \d{4})/gi;
var CND_CJIS_RE = /\b(CJIS|BCI|FBI)(\s*(?:report|case|ref(?:erence)?|no\.?|number|id|#))?\s*[:#-]?\s*#?\s*(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{4,}/gi;
// Set only while candidatePack runs, so the board and the candidate records are read once per pack.
var CND_MEMO_ = null;
var CND_APP_ID = 'staff-candidates';
// The reads a narrowed reader may make; every other read is the app's 404 to them.
var CND_NARROW_READS = ['candidateProfileRoster', 'candidateProfileOverview', 'candidateProfileInterviews'];
var CND_NARROW_WHY = 'Not every hiring record could be read just now, so a candidate tied to these houses may be missing.';
var CND_EVENT_DONE = /^(completed?|done|held|attended)$/;

/** FAIL-CLOSED: the master in its own session, never a visit or a service call. Every write's gate. */
function candidateProfilesGate_(user) {
  try { return !!hubIsRealMaster_(user); } catch (e) { return false; }
}

/** FAIL-CLOSED: the reader's scope when App Control opens the app to them (the real master always); null otherwise. */
function cndViewer_(user) {
  var g = null;
  try { g = hubProfileAppGate_(CND_APP_ID, user); } catch (e) { g = null; }
  return g && g.open === true && g.scope && g.scope.kind !== 'none' ? g.scope : null;
}

/** The master and every released badge that does not narrow: the whole app. */
function cndWide_(scope) {
  return !!scope && (scope.kind === 'master' || scope.kind === 'all');
}

function candidateProfilesUnknown_() {
  return { status: 404, message: 'Unknown action.' };
}

// ---- pure helpers ---------------------------------------------------------

function cndWhy_(what, e) {
  return what + ' could not be read (' + String((e && e.message) || e).slice(0, 120) + ').';
}

function cndStageLabel_(stage) {
  return CND_STAGE_LABELS[stage] || String(stage || '');
}

/** Who a hiring record names, without the platform's own prefix or the time it appends. */
function cndBy_(v) {
  var s = locationsText_(v, 200).replace(/^asa-hub:(manual-screen:|manual-onboarding:)?/i, '');
  return s.split(' at ')[0].split(' — ')[0].trim();
}

function cndDueState_(due, today) {
  if (!due) return '';
  if (due < today) return 'overdue';
  return due === today ? 'today' : 'upcoming';
}

// Last guard on every answer: the SSA guard (SSNs and card numbers however written, bare nine-digit runs), and a…
function cndScrub_(v, key) {
  if (key && CND_SCRUB_KEYS[key]) return v;
  if (typeof v === 'string') return ssaScrub_(v.replace(CND_DOB_RE, '$1 [withheld]').replace(CND_CJIS_RE, '$1$2 [withheld]'));
  if (Array.isArray(v)) return v.map(function (x) { return cndScrub_(x); });
  if (v && typeof v === 'object') {
    var out = {};
    Object.keys(v).forEach(function (k) { out[k] = cndScrub_(v[k], k); });
    return out;
  }
  return ssaScrub_(v);
}

function cndOpen_(item) {
  return !!item && (item.status === 'pending' || item.status === 'missing');
}

/** The board's next step: the first open item of the phase they stand in, else the first one left behind. */
function cndNextSteps_(row) {
  var inPhase = {};
  (row.checklist || []).forEach(function (c) { if (c.stage === row.stage) inPhase[c.id] = true; });
  var open = (row.checklist || []).filter(cndOpen_);
  var next = open.filter(function (c) { return inPhase[c.id]; });
  var behind = open.filter(function (c) { return !inPhase[c.id]; });
  return { next: next, behind: behind, head: next[0] || behind[0] || null };
}

/** What needs a person beyond the checklist, as the Hiring app's Actions view reads the row. */
function cndAttention_(row) {
  var out = [];
  if (row.urgency && row.urgency !== 'none') {
    out.push((row.urgency === 'red' ? 'Needs a decision' : 'Running late') + (row.urgencyWhy ? ' — ' + row.urgencyWhy : ''));
  }
  if (row.lastReply && row.lastReply.unread) {
    out.push(row.lastReply.unread + ' unread repl' + (row.lastReply.unread === 1 ? 'y' : 'ies'));
  }
  if (row.optedOut) out.push('Opted out of texts — no message may leave for them');
  if (row.parked && row.parked.notices) {
    out.push('Parked at Ready to start — the deciders have been told ' + row.parked.notices + ' time' +
             (row.parked.notices === 1 ? '' : 's'));
  }
  var resume = (row.checklist || []).filter(function (c) { return c.id === 'resume'; })[0];
  if (resume && (resume.status === 'done' || resume.status === 'auto') &&
      (row.resumeScorecard === null || row.resumeScorecard === undefined)) {
    out.push('Resume on file and not scored');
  }
  return out;
}

/** needs_you (attention), missing (the next step is not on file), waiting (a step is open) or clear. */
function cndStatusWord_(row, steps) {
  if (cndAttention_(row).length) return 'needs_you';
  if (!steps.head) return 'clear';
  return steps.head.status === 'missing' ? 'missing' : 'waiting';
}

/** A checklist item's Hiring door, or why it has none here. */
function cndDoor_(ctx, item) {
  if (ctx.archived) return { door: null, why: 'This candidate is out of the Hiring pipeline.' };
  var d = CND_DOORS[item.id];
  if (!d) {
    if (item.id === 'staff-account-armed') return { door: null, why: 'An admin sets the first password on the account in Users.' };
    return { door: null, why: CND_MACHINE_ITEMS.indexOf(item.id) !== -1 ? 'The platform does this by itself.'
                                                                        : 'The Hiring app has no door for this step.' };
  }
  if (d.stage && d.stage !== ctx.row.stage) return { door: null, why: 'Its door opens at ' + cndStageLabel_(d.stage) + '.' };
  var payload = { candidate_id: ctx.key };
  Object.keys(d.fields || {}).forEach(function (k) { payload[k] = d.fields[k]; });
  return { door: { action: d.action, form: d.form || '', payload: payload }, why: '' };
}

/** The New Hire packet signed through its envelope, or attested on file by hand. */
function cndPacketSigned_(row) {
  return !!row && !!row.packet && (row.packet.state === 'signed' || row.packet.state === 'waived');
}

/** A kind of paper as the answer says it: "a background check". */
function cndKindWords_(kind) {
  var k = str_(kind);
  return certReadA_(CND_KIND_WORDS[k] || CERT_READ_KIND_WORDS[k] || k.replace(/_/g, ' '));
}

/** What a paper may read as, in words; '' when the decoder is not taught it. */
function cndExpects_(kinds) {
  return (kinds || []).map(cndKindWords_).join(' or ');
}

/** The extensions a step's paper is taken in: a PDF only, or a PDF or a picture, and a Word file where its door takes one. */
function cndPaperExts_(spec) {
  if (spec && spec.pdf) return ['pdf'];
  return CND_PAPER_EXTS.concat(spec && spec.word ? Object.keys(CND_WORD_TYPES) : []);
}

// What a checklist step takes as a paper, or null: what it asks for, what the decoder must read it as, where it is…
function cndStepPaper_(ctx, item, catalog) {
  var spec = CND_STEP_PAPERS[item.id];
  if (!spec || ctx.archived) return null;
  var signed = cndPacketSigned_(ctx.row);
  if (item.id === 'new-hire-packet' && signed) {
    var held = {};
    held[spec.doc] = true;
    (ctx.row.checklist || []).forEach(function (c) {
      var own = CND_STEP_PAPERS[c.id];
      if (own && own.doc && cndOpen_(c)) held[own.doc] = true;
    });
    var choices = (catalog || []).filter(function (c) { return !held[c.doc_id]; }).map(function (c) {
      return { doc_id: c.doc_id, label: c.label, expects: cndExpects_(CND_PAPER_KINDS[c.doc_id]) };
    });
    return choices.length ? { asks: 'The new hire\'s documents', expects: '', where: CND_WHERE.onboarding,
                              pdf_only: false, exts: cndPaperExts_(null), statuses: [], choices: choices } : null;
  }
  if (!cndOpen_(item)) return null;
  var label = spec.label;
  (catalog || []).forEach(function (c) { if (spec.doc && c.doc_id === spec.doc) label = c.label; });
  var where = !spec.doc ? CND_WHERE.hiring
    : (item.id === 'cjis' ? (signed ? CND_WHERE.both : CND_WHERE.hiring) : CND_WHERE.onboarding);
  return { asks: label || spec.doc, expects: cndExpects_(spec.kinds || CND_PAPER_KINDS[spec.doc]), where: where,
           pdf_only: !!spec.pdf, exts: cndPaperExts_(spec),
           statuses: item.id === 'cjis' ? CND_CJIS_STATUSES.slice() : [], choices: [] };
}

/** The same minimal card candidateProfileGet answers for a candidate the board no longer carries. */
function cndArchivedRow_(cid, raw) {
  var name = str_(raw.candidatename) || (str_(raw.firstname) + ' ' + str_(raw.lastname)).trim() || cid;
  return {
    id: cid, name: name, avatar: '', role: 'Direct Support Professional',
    stage: talentStage_(str_(raw.status)) || '', status: str_(raw.status),
    archived: str_(raw.archived).toLowerCase() === 'true',
    archived_at: str_(raw.archivedat), archived_reason: str_(raw.archivedreason),
    email: str_(raw.email), phone: str_(raw.phone), city: str_(raw.city), state: str_(raw.state),
    source: str_(raw.source), appliedAt: str_(raw.createdat), owner: str_(raw.assignedto), score: null,
    resumeLink: str_(raw.resumelink), tpCandidateId: str_(raw.tpcandidateid), application: null, packet: null,
    summary: '', summaryTimeline: [], checklist: []
  };
}

// ---- the board and the lookup ---------------------------------------------

function cndBoard_() {
  var memo = CND_MEMO_;
  if (memo && memo.board) return memo.board;
  var rows = talentCandidatesRead_() || [];
  var byId = {};
  rows.forEach(function (r) { if (r && r.id) byId[String(r.id)] = r; });
  var board = { rows: rows, byId: byId };
  if (memo) memo.board = board;
  return board;
}

/** Every candidate row the Hiring app keeps, archived ones too. */
function cndRawRows_() {
  var memo = CND_MEMO_;
  if (memo && memo.raw) return memo.raw;
  var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB);
  if (memo) memo.raw = rows;
  return rows;
}

/** The candidate a request names: 400 when no hiring record carries the id, 503 when the records cannot say. */
function cndCandidate_(raw) {
  var key = String(raw == null ? '' : raw).trim();
  var none = { refused: { status: 400, message: 'No candidate "' + key.slice(0, 120) + '" is on file.' } };
  if (!/^CAN_[A-Za-z0-9]{6,80}$/.test(key) || TALENT_EXCLUDE_IDS.indexOf(key) !== -1) return none;
  var board;
  try { board = cndBoard_(); }
  catch (e) {
    return { refused: { status: 503, message: 'The hiring board could not be read just now (' +
             String((e && e.message) || e).slice(0, 120) + ') — nothing is said about this candidate.' } };
  }
  var row = board.byId[key] || null;
  var archived = false;
  if (!row) {
    var hit = null;
    try {
      cndRawRows_().forEach(function (r) { if (str_(r.candidateid) === key) hit = r; });
    } catch (eR) {
      return { refused: { status: 503, message: 'The candidate records could not be read just now (' +
               String((eR && eR.message) || eR).slice(0, 120) + ') — nothing is said about this candidate.' } };
    }
    if (!hit) return none;
    row = cndArchivedRow_(key, hit);
    archived = true;
  }
  return { key: key, name: str_(row.name) || key, row: row, archived: archived, memo: {} };
}

function cndEvidence_(ctx) {
  if (!ctx.memo.ev) ctx.memo.ev = hubEvidence_(ctx.key);
  return ctx.memo.ev;
}

/** The hiring evidence, or an empty one with the reason said in the build's sink. */
function cndEvidenceOr_(ctx, sink) {
  try { return cndEvidence_(ctx) || { cand: null, analysis: {}, screen: null }; }
  catch (e) {
    sink.why.push(cndWhy_('The hiring records', e));
    sink.degraded = true;
    return { cand: null, analysis: {}, screen: null };
  }
}

/** candidateProfileGet's joins: the interview scorecard and the onboarding record. */
function cndExtras_(ctx, ev) {
  if (!ctx.memo.extras) ctx.memo.extras = candidateProfileExtras_(ctx.key, ev && ev.cand);
  return ctx.memo.extras || { interview: null, onboarding: null };
}

// ---- caching --------------------------------------------------------------

/** The candidate's board row as a version: any Hiring write that changes the row retires every answer built on it. */
function cndStamp_(ctx) {
  try { return String(hashCode_(JSON.stringify(ctx.row))); } catch (e) { return 'x'; }
}

// The candidate's own document rows as a version: an upload, a review or a superseded paper retires the answers…
function cndDocsStamp_(ctx) {
  if (ctx.memo.docStamp) return ctx.memo.docStamp;
  try {
    var mine = [];
    cndDocsRows_().forEach(function (r) {
      if (String(r.candidate_id || '') !== ctx.key) return;
      mine.push([r.doc_id, r.status, r.file_id, r.file_url, r.superseded_by, r.issued_on, r.expires_on]
        .map(function (v) { return String(v === undefined || v === null ? '' : v); }).join('|'));
    });
    ctx.memo.docStamp = String(hashCode_(mine.join('\n')));
  } catch (e) { ctx.memo.docStamp = 'x'; }
  return ctx.memo.docStamp;
}

// Keyed cnd_<action>_<key>; the name carries the row's version, and the document rows' for the sections that show…
function cndCached_(action, ctx, producer) {
  var scope = 'cnd_' + action + '_' + ctx.key;
  var name = 'v1_' + cndStamp_(ctx) + (CND_DOC_BOUND[action] ? '_' + cndDocsStamp_(ctx) : '');
  var value = cacheRead_(scope, name, producer);
  if (value && value.degraded) cacheBump_(scope);
  return value;
}

function cndBump_(action, key) {
  cacheBump_('cnd_' + action + '_' + key);
}

/** One part's scrubbed answer, built once per request and shared by every part that shows it. */
function cndData_(action, ctx, build) {
  var slot = 'a:' + action;
  if (ctx.memo[slot]) return ctx.memo[slot];
  var data = cndCached_(action, ctx, function () { return cndScrub_(build()); });
  ctx.memo[slot] = data;
  return data;
}

/** One read's answer: 503 names the source when the build throws. */
function cndServe_(what, get) {
  try { return { status: 200, data: get() }; }
  catch (e) {
    return { status: 503, message: what + ' could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
}

// ---- the roster -----------------------------------------------------------

function cndRosterRow_(row) {
  var steps = cndNextSteps_(row);
  return {
    key: String(row.id), name: str_(row.name), position: str_(row.role) || 'Direct Support Professional',
    stage: str_(row.stage), stage_label: cndStageLabel_(row.stage),
    location: [str_(row.city), str_(row.state)].filter(String).join(', '),
    next_step: steps.head ? str_(steps.head.label) : '', next_owner: steps.head ? str_(steps.head.owner) : '',
    next_id: steps.head ? str_(steps.head.id) : '', packet: row.packet ? str_(row.packet.state) : '',
    recruiter: cndBy_(row.owner), status: cndStatusWord_(row, steps), urgency: str_(row.urgency) || 'none',
    applied_at: talentIsoDay_(row.appliedAt),
    days_at_stage: row.daysAtStage !== null && row.daysAtStage !== undefined ? row.daysAtStage : (row.daysInStage || 0),
    avatar: str_(row.avatar)
  };
}

/** The roster in the board's stage order, and how many stand at each stage. */
function cndRosterOf_(rows, shape, extra) {
  var counts = {};
  var out = rows.map(function (r) {
    counts[r.stage] = (counts[r.stage] || 0) + 1;
    return shape(r);
  });
  out.sort(function (a, b) {
    return (TALENT_STAGE_ORDER.indexOf(a.stage) - TALENT_STAGE_ORDER.indexOf(b.stage)) || a.name.localeCompare(b.name);
  });
  var answer = {
    candidates: out,
    stages: TALENT_STAGE_ORDER.map(function (s) { return { id: s, label: cndStageLabel_(s), count: counts[s] || 0 }; }),
    why: [], degraded: false
  };
  Object.keys(extra || {}).forEach(function (k) { answer[k] = extra[k]; });
  return answer;
}

function cndRosterBuild_() {
  return cndRosterOf_(cndBoard_().rows, cndRosterRow_);
}

// ---- a narrowed reader: a client, a family member or an SSA ----------------

// A place a hiring record names, as a house code: the code itself, the one registry house its words name by code or…
function cndHouseOf_(v, homes, addr) {
  var s = locationsText_(v, 200);
  if (!s) return '';
  var code = locationsHouseCode_(s) || locationsCode_(s);
  if (code) return code;
  var up = s.toUpperCase(), fold = clientNameKey_(s);
  var named = (homes || []).filter(function (h) {
    return new RegExp('(^|[^A-Z0-9])' + h.code + '(?![0-9])').test(up) || (!!fold && clientNameKey_(h.home_name) === fold);
  });
  if (named.length) return named.length === 1 ? named[0].code : '';
  return locationsAddrOwner_(addr || {}, s).code;
}

// FAIL-CLOSED: the board's candidates the Hiring app ties to one of these houses — the house on their onboarding…
function cndTies_(codes, board) {
  var want = {};
  (codes || []).forEach(function (c) { var hc = locationsHouseCode_(c); if (hc) want[hc] = true; });
  var houses = Object.keys(want).sort();
  var out = { keys: {}, events: {}, places: {}, degraded: false };
  if (!houses.length) return out;
  var onBoard = {}, byName = {};
  (board.rows || []).forEach(function (r) {
    var k = String(r.id);
    onBoard[k] = true;
    var n = clientNameKey_(r.name);
    if (n.length >= 3) (byName[n] = byName[n] || []).push(k);
  });
  var tie = function (k) { if (onBoard[k]) out.keys[k] = true; };
  var tieName = function (fold) { (byName[fold] || []).forEach(tie); };
  var homes = [];
  try { homes = locationsHomes_() || []; } catch (eH) { out.degraded = true; }
  homes.forEach(function (h) { if (want[h.code]) out.places[h.code] = locationsText_(h.home_name, 120) || h.code; });
  var addr = locationsAddrIndex_(homes, []);
  var placeOf = function (v) { return cndHouseOf_(v, homes, addr); };
  var ss = null;
  // a tab not born yet holds nothing to tie; one that cannot be read is said
  var tab = function (name, each) {
    try {
      if (!hubTabSheet_(name)) return;
      if (!ss) ss = ssOpen_(hubId_('HUB_DB_ID'));
      readTabNormalized_(ss, name).forEach(each);
    } catch (e) { out.degraded = true; }
  };
  tab(ONBOARDING_TAB, function (r) { if (want[placeOf(r.house)]) tie(str_(r.candidateid)); });
  tab(HIRING_EVENTS_TAB, function (r) {
    var cid = str_(r.candidateid), status = str_(r.status).toLowerCase();
    if (!str_(r.eventid) || !onBoard[cid] || status === 'cancelled') return;
    var code = placeOf(r.location);
    if (!want[code]) return;
    tie(cid);
    (out.events[cid] = out.events[cid] || []).push({
      id: str_(r.eventid), type: str_(r.eventtype), date: hiringDateText_(r.date), time: hiringTimeText_(r.time),
      house: code, with_name: locationsText_(r.withname, 120), status: status });
  });
  var cal = null;
  try { cal = locationsCalendar_().cal; } catch (eC) { cal = null; }
  if (cal && cal.values) {
    var today = locationsToday_();
    var head = (cal.values[0] || []).map(function (h) { return String(h || '').trim().toLowerCase(); });
    var col = function (name, fb) { var i = head.indexOf(name); return i === -1 ? fb : i; };
    var cLoc = col('location', 0), cName = col('employee', 1), cDate = col('date', 4);
    for (var i = 1; i < cal.values.length; i++) {
      var line = cal.values[i] || [];
      if (!want[locationsCode_(line[cLoc])]) continue;
      var day = commBroadcastDay_(line[cDate], cal.tz);
      if (day && day > today) tieName(clientNameKey_(locationsText_(line[cName])));
    }
  } else {
    out.degraded = true;
  }
  var seen = null;
  try { seen = hubStaffVisibleForHouses_(houses); } catch (eS) { seen = null; }
  if (!seen || seen.why) out.degraded = true;
  ((seen && seen.keys) || []).forEach(tieName);
  return out;
}

function cndNarrowRow_(row) {
  return { key: String(row.id), name: str_(row.name), position: str_(row.role) || 'Direct Support Professional',
           stage: str_(row.stage), stage_label: cndStageLabel_(row.stage), avatar: str_(row.avatar) };
}

function cndNarrowWhy_(ties) {
  return ties.degraded ? [CND_NARROW_WHY] : [];
}

/** The board and the candidates on it tied to the reader's houses. */
function cndNarrowView_(scope) {
  var board = cndBoard_();
  return { board: board, ties: cndTies_(scope.house_codes, board) };
}

function cndNarrowRoster_(scope) {
  var v = cndNarrowView_(scope);
  var rows = v.board.rows.filter(function (r) { return v.ties.keys[String(r.id)]; });
  return cndRosterOf_(rows, cndNarrowRow_, { viewer: scope.kind, why: cndNarrowWhy_(v.ties), degraded: v.ties.degraded });
}

// A narrowed reader's candidate: one on the board tied to their houses, else the app's own 404, never whether the…
function cndNarrowCandidate_(scope, raw) {
  var key = String(raw == null ? '' : raw).trim();
  var v;
  try { v = cndNarrowView_(scope); }
  catch (e) { return { refused: { status: 503, message: 'The hiring board could not be read just now.' } }; }
  var row = v.ties.keys[key] ? v.board.byId[key] : null;
  if (!row) return { refused: candidateProfilesUnknown_() };
  return { key: key, row: row, ties: v.ties };
}

/** The basic card: name, photo, position and stage. */
function cndNarrowOverview_(scope, hit) {
  var c = cndNarrowRow_(hit.row);
  return {
    candidate: { key: c.key, name: c.name, position: c.position, stage: c.stage, stage_label: c.stage_label,
                 status_label: c.stage_label, archived: false, avatar: c.avatar },
    information: { full_name: c.name, stage_label: c.stage_label, position: c.position },
    viewer: scope.kind, why: cndNarrowWhy_(hit.ties), degraded: hit.ties.degraded
  };
}

/** The interviews and meet-and-greets booked at the reader's houses, by day; never a score, a note or a result. */
function cndNarrowInterviews_(scope, hit) {
  var plan = (hit.ties.events[hit.key] || []).slice().sort(function (a, b) {
    var x = a.date + 'T' + (a.time || '00:00'), y = b.date + 'T' + (b.time || '00:00');
    return x < y ? -1 : (x > y ? 1 : 0);
  }).map(function (e) {
    return { id: 'event_' + e.id, title: HIRING_EVENT_TYPES[e.type] || 'Meeting', date: e.date, owner: e.with_name,
             status: CND_EVENT_DONE.test(e.status) ? 'completed' : 'scheduled',
             detail: [hit.ties.places[e.house] || e.house, e.time].filter(String).join(' · '), result: '', comments: '' };
  });
  return { plan: plan, preferences: {}, viewer: scope.kind, why: cndNarrowWhy_(hit.ties), degraded: hit.ties.degraded };
}

/** A narrowed reader's answer for one candidate, past the tie to their houses. */
function cndNarrowServe_(scope, payload, build) {
  var hit = cndNarrowCandidate_(scope, payload && payload.candidate);
  if (hit.refused) return hit.refused;
  return cndServe_('The candidate', function () { return cndScrub_(build(scope, hit)); });
}

HUB_POLICY.candidateProfileRoster = {
  file: 'CandidateProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: {}
};
// The pipeline and the switcher: every candidate on the Hiring board, with the board's own next step; a narrowed…
HUB_ACTIONS.candidateProfileRoster = function (payload, user) {
  var scope = cndViewer_(user);
  if (!scope) return candidateProfilesUnknown_();
  return cndServe_('The hiring board', function () {
    return cndScrub_(cndWide_(scope) ? cndRosterBuild_() : cndNarrowRoster_(scope));
  });
};

// ---- actions --------------------------------------------------------------

/** The day each open item falls due: the onboarding window's end, and the booked interview. */
function cndDues_(ctx) {
  var row = ctx.row, out = {};
  var until = row.onboardingWindow && row.onboardingWindow.until ? talentIsoDay_(row.onboardingWindow.until) : '';
  if (until && row.stage === 'onboarding') { out['new-hire-packet'] = until; out['onboarding-complete'] = until; }
  if (row.stage === 'interview') {
    var iv = interviewFor_(ctx.key);
    var when = iv && str_(iv.scheduledfor) ? talentIsoDay_(iv.scheduledfor) : '';
    if (when) { out['interview-scorecard'] = when; out['interview-recommendation'] = when; }
  }
  return out;
}

/** Where the card may go from here: the gate's next stage through its door, and out of the process. */
function cndStageMoves_(ctx, gate) {
  var stage = ctx.row.stage;
  var moves = TALENT_STAGE_ORDER.map(function (s) {
    var o = { id: s, label: cndStageLabel_(s), current: s === stage, reachable: false, door: null, why: '' };
    if (o.current) return o;
    if (ctx.archived) { o.why = 'This candidate is out of the Hiring pipeline.'; return o; }
    if (!gate) { o.why = 'The stage gate could not be read just now.'; return o; }
    if (s !== gate.to) {
      o.why = TALENT_STAGE_ORDER.indexOf(gate.to) !== -1
        ? 'The Hiring pipeline moves one stage at a time — from ' + cndStageLabel_(stage) + ' the next stage is ' +
          cndStageLabel_(gate.to) + '.'
        : 'From ' + cndStageLabel_(stage) + ' the next step is ' + (gate.reasons || []).join('; ') + '.';
      return o;
    }
    if (stage === 'onboarding') {
      o.reachable = true;
      o.door = { action: 'onboardingManualComplete', form: 'notes', payload: { candidate_id: ctx.key } };
      o.why = 'Onboarding is completed with Manual onboarding, which records who attests it and when.';
      return o;
    }
    o.reachable = !!gate.ok;
    if (gate.ok) o.door = { action: 'moveStage', form: '', payload: { candidate_id: ctx.key, to_stage: s } };
    else o.why = 'Still needed: ' + (gate.reasons || []).join('; ') + '.';
    return o;
  });
  moves.push({ id: 'not-hiring', label: 'Not hiring', current: false, reachable: !ctx.archived,
               door: ctx.archived ? null : { action: 'hiringDiscard', form: 'reason', payload: { candidate_id: ctx.key } },
               why: ctx.archived ? 'This candidate is out of the Hiring pipeline.'
                                 : 'Takes them out of the process; the reason is required and the team is told.' });
  return moves;
}

function cndActionsBuild_(ctx) {
  var row = ctx.row, sink = { why: [], degraded: false };
  var steps = cndNextSteps_(row);
  var headId = steps.head ? steps.head.id : '';
  var dues = {};
  try { dues = cndDues_(ctx); } catch (eD) { sink.why.push(cndWhy_('The interview date', eD)); sink.degraded = true; }
  var today = locationsToday_();
  var catalog = null;
  var paperOf = function (c) {
    if (!CND_STEP_PAPERS[c.id] || ctx.archived) return null;
    if (catalog === null) {
      try { catalog = cndCatalog_(); }
      catch (eC) { catalog = []; sink.why.push(cndWhy_('The document catalog', eC)); sink.degraded = true; }
    }
    return cndStepPaper_(ctx, c, catalog);
  };
  var items = (row.checklist || []).map(function (c) {
    var open = cndOpen_(c);
    var due = open ? (dues[c.id] || '') : '';
    var door = open ? cndDoor_(ctx, c) : { door: null, why: '' };
    return { id: str_(c.id), label: str_(c.label), status: str_(c.status), open: open, owner: str_(c.owner),
             stage: str_(c.stage), stage_label: cndStageLabel_(c.stage), in_phase: c.stage === row.stage,
             is_next: c.id === headId, due: due, due_state: cndDueState_(due, today), complete: door.door,
             complete_why: door.why, skipped_by: str_(c.skippedBy), paper: paperOf(c) };
  });
  var gate = null;
  if (!ctx.archived) {
    try { gate = hubGate_(cndEvidence_(ctx)); }
    catch (eG) { sink.why.push(cndWhy_('The stage gate', eG)); sink.degraded = true; }
  }
  return {
    stage: str_(row.stage), stage_label: cndStageLabel_(row.stage), archived: ctx.archived,
    items: items, next: items.filter(function (i) { return i.is_next; })[0] || null,
    open: items.filter(function (i) { return i.open; }).length,
    attention: cndAttention_(row), status: cndStatusWord_(row, steps),
    gate: gate ? { from: str_(gate.from), to: str_(gate.to), ok: !!gate.ok, reasons: gate.reasons || [] } : null,
    stages: cndStageMoves_(ctx, gate), why: sink.why, degraded: sink.degraded
  };
}

function cndActions_(ctx) {
  return cndData_('candidateProfileActions', ctx, function () { return cndActionsBuild_(ctx); });
}

function cndActionsDoor_(ctx) {
  return cndServe_('The hiring actions', function () { return cndActions_(ctx); });
}

HUB_POLICY.candidateProfileActions = {
  file: 'CandidateProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' } }
};
/** Actions: the Hiring checklist, the board's next step, each open item's Hiring door and where the card may move. */
HUB_ACTIONS.candidateProfileActions = function (payload, user) {
  if (!cndWide_(cndViewer_(user))) return candidateProfilesUnknown_();
  var ctx = cndCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  return cndActionsDoor_(ctx);
};

// ---- interviews -----------------------------------------------------------

/** The candidate's interview ask (last wins); null when there is none. */
function cndAskFor_(key) {
  var hit = null;
  interviewAskRows_().forEach(function (a) { if (str_(a.candidateid) === key) hit = a; });
  return hit;
}

function cndPreferences_(s, a, ob) {
  var yes = function (v) { return spYesNo_(v) === 'yes'; };
  var shifts = [], hours = [];
  if (yes(s.shiftday)) shifts.push('Day');
  if (yes(s.shiftafternoon)) shifts.push('Afternoon');
  if (yes(s.shiftnight)) shifts.push('Night');
  if (yes(s.hoursft)) hours.push('Full time');
  if (yes(s.hourspt)) hours.push('Part time');
  if (yes(s.hoursprn)) hours.push('PRN');
  return {
    shifts: shifts, hours: hours, every_other_weekend: spYesNo_(s.everyotherweekend), male_care: spYesNo_(s.malecare),
    behavioral_care: spYesNo_(s.behavioralcare), drivers_license: spYesNo_(s.hasdl), vehicle: spYesNo_(s.hasvehicle),
    insurance: spYesNo_(s.hasinsurance),
    certificates: { dodd: spYesNo_(s.certdodd), cpr_first_aid: spYesNo_(s.certcprfirstaid), med_del: spYesNo_(s.certmeddel) },
    best_in_person: str_(s.bestinpersondaytime), availability: str_(a.scheduleavailability),
    earliest_start: ob ? talentIsoDay_(ob.earliest_start_date) : '', preferred_location: ob ? str_(ob.house) : ''
  };
}

/** A slot as the Ohio day and clock it names: an instant converted, a written 'YYYY-MM-DD HH:MM' as written. */
function cndSlot_(v) {
  var s = str_(v);
  var m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (!m) return { day: talentIsoDay_(s), time: '' };
  if (/T\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    var d = new Date(s);
    if (!isNaN(d.getTime())) return { day: talentIsoDay_(s), time: Utilities.formatDate(d, hubSheetTz_(), 'HH:mm') };
  }
  return { day: m[1], time: m[2] ? (m[2].length === 1 ? '0' + m[2] : m[2]) + ':' + m[3] : '' };
}

/** The candidate's latest in-person interview on the hiring calendar — its slot, room and who holds it — or null. */
function cndInterviewEvent_(key) {
  var sheet = hubTabSheet_(HIRING_EVENTS_TAB);
  if (!sheet) return null;
  var hit = null;
  locationsTabRows_(sheet).forEach(function (r) {
    if (str_(r.candidate_id) !== key || str_(r.event_type) !== 'in_person_interview') return;
    if (str_(r.status).toLowerCase() === 'cancelled') return;
    hit = r;
  });
  if (!hit) return null;
  return { day: hiringDateText_(hit.date), time: hiringTimeText_(hit.time), location: locationsText_(hit.location, 160),
           with_name: locationsText_(hit.with_name, 120) };
}

function cndInterviewsBuild_(ctx) {
  var row = ctx.row, sink = { why: [], degraded: false };
  var ev = cndEvidenceOr_(ctx, sink);
  var x = cndExtras_(ctx, ev);
  var ask = null;
  try { ask = cndAskFor_(ctx.key); } catch (eA) { sink.why.push(cndWhy_('The interview asks', eA)); sink.degraded = true; }
  var booked = null;
  try { booked = cndInterviewEvent_(ctx.key); }
  catch (eE) { sink.why.push(cndWhy_('The hiring calendar', eE)); sink.degraded = true; }
  var s = ev.screen || null, a = ev.analysis || {}, iv = x.interview, ob = x.onboarding;
  var at = TALENT_STAGE_ORDER.indexOf(row.stage);

  var screenDone = !!s && (str_(s.screenstatus).toLowerCase() === 'completed' || str_(s.manualscreen).toLowerCase() === 'true');
  var screen = {
    id: 'phone_screen', title: 'Phone screen',
    date: s ? (talentIsoDay_(s.screendate) || talentIsoDay_(s.transcriptcreated)) : '',
    owner: s ? cndBy_(s.screenedby) : '',
    status: screenDone ? 'completed' : (s ? 'awaiting_confirmation' : 'pending'),
    result: s ? [str_(s.finalresult) || (screenDone ? 'Decision pending' : ''), str_(s.qualification)].filter(String).join(' · ') : '',
    comments: s ? str_(s.notes) : ''
  };

  var scored = !!iv && !!str_(iv.interviewer_name) && str_(iv.score) !== '';
  var slot = '';
  if (ask) {
    slot = str_(ask.confirmeddate) ? str_(ask.confirmeddate) + ' ' + str_(ask.confirmedtime)
         : (str_(ask.pickeddate) ? str_(ask.pickeddate) + ' ' + str_(ask.pickedtime) : '');
  }
  var ivDate = (iv && str_(iv.scheduled_for)) || slot.trim();
  var inFlight = !!ivDate || !!(ask && str_(ask.state)) || !!booked;
  var when = cndSlot_(ivDate);
  if (booked && booked.day && (!when.day || (when.day === booked.day && !when.time))) {
    when = { day: booked.day, time: booked.time };
  }
  var interview = {
    id: 'interview', title: 'Structured interview',
    date: ivDate ? talentIsoDay_(ivDate) || ivDate : when.day, owner: iv ? str_(iv.interviewer_name) : '',
    status: scored ? 'completed' : (inFlight ? 'awaiting_confirmation' : 'pending'),
    detail: scored ? '' : (ask && str_(ask.state) && str_(ask.state) !== 'confirmed'
      ? 'The slot is not confirmed yet.' : (ivDate || booked ? 'Booked — the scorecard completes it.' : '')),
    result: scored ? [str_(iv.recommendation), 'score ' + str_(iv.score) + '/' + INTERVIEW_SCORE_MAX].filter(String).join(' · ') : '',
    comments: iv ? str_(iv.comments) : '',
    day: when.day, time: when.time, interviewed_at: iv ? str_(iv.interviewed_at) : '',
    score: iv ? str_(iv.score) : '', score_max: INTERVIEW_SCORE_MAX, recommendation: iv ? str_(iv.recommendation) : '',
    with_name: booked ? booked.with_name : '', location: booked ? booked.location : ''
  };

  var obDone = at > TALENT_STAGE_ORDER.indexOf('onboarding') ||
               !!(ob && ob.questionnaire_done && ob.tutorials_done);
  var raw = ev.cand || {};
  var handoff = {
    id: 'onboarding', title: 'Onboarding handoff',
    date: ob ? (talentIsoDay_(ob.start_date) || talentIsoDay_(ob.date_moved)) : '',
    owner: cndBy_(raw.manualonboardingby),
    status: obDone ? 'completed' : (row.stage === 'onboarding' ? 'awaiting_confirmation' : 'pending'),
    result: ob ? [ob.questionnaire_done ? 'Questionnaire done' : '', ob.tutorials_done ? 'Tutorials done' : '',
                  str_(raw.manualonboardingmethod) === 'attested' ? 'Attested by e-mail' : ''].filter(String).join(' · ') : '',
    comments: ob ? str_(ob.notes) : ''
  };
  return { plan: [screen, interview, handoff], preferences: cndPreferences_(s || {}, a, ob),
           why: sink.why, degraded: sink.degraded };
}

function cndInterviews_(ctx) {
  return cndData_('candidateProfileInterviews', ctx, function () { return cndInterviewsBuild_(ctx); });
}

function cndInterviewsDoor_(ctx) {
  return cndServe_('The interview plan', function () { return cndInterviews_(ctx); });
}

HUB_POLICY.candidateProfileInterviews = {
  file: 'CandidateProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' } }
};
// Interviews: the phone screen, the structured interview and the onboarding handoff, and what the candidate…
HUB_ACTIONS.candidateProfileInterviews = function (payload, user) {
  var scope = cndViewer_(user);
  if (!scope) return candidateProfilesUnknown_();
  if (!cndWide_(scope)) return cndNarrowServe_(scope, payload, cndNarrowInterviews_);
  var ctx = cndCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  return cndInterviewsDoor_(ctx);
};

// ---- documents ------------------------------------------------------------

/** The hiring documents tab's rows, read once per request (per pack); [] while the tab is unborn. */
function cndDocsRows_() {
  var memo = CND_MEMO_;
  if (memo && memo.docs) return memo.docs;
  var sheet = hubTabSheet_(DOCS_TAB);
  var rows = sheet ? locationsTabRows_(sheet) : [];
  if (memo) memo.docs = rows;
  return rows;
}

/** The candidate's latest, not superseded, hiring document row per catalog id; {} while the tab is unborn. */
function cndHiringDocs_(key) {
  var out = {};
  cndDocsRows_().forEach(function (r) {
    if (String(r.candidate_id || '') !== key || String(r.superseded_by || '')) return;
    var id = String(r.doc_id || '');
    if (id) out[id] = r;
  });
  return out;
}

/** The document catalog as the Hiring app keeps it, else its shipped copy; never seeded from here. */
function cndCatalog_() {
  var sheet = null;
  try { sheet = hubTabSheet_(DOC_CATALOG_TAB); } catch (e) { sheet = null; }
  var rows = sheet ? locationsTabRows_(sheet).filter(function (r) { return !!String(r.doc_id || '').trim(); }) : [];
  if (!rows.length) rows = DOC_CATALOG_DEFAULT.slice();
  return rows.map(function (r) {
    return { doc_id: String(r.doc_id).trim(), label: locationsText_(r.label, 120) || String(r.doc_id),
             required: r.required === true || String(r.required).toLowerCase() === 'yes', sort: Number(r.sort) || 99 };
  }).sort(function (x, y) { return x.sort - y.sort; });
}

/** The Drive copy of a signed application the Hiring app already fetched; '' until somebody opened it there. */
function cndApplicationFile_(srid) {
  var sheet = hubTabSheet_(RECRUIT_DOCS_TAB);
  if (!sheet || !srid) return '';
  var id = '';
  locationsTabRows_(sheet).forEach(function (r) {
    if (String(r.signature_request_id || '').trim() === srid) id = locationsDriveId_(r.doc_url) || id;
  });
  return id;
}

/** The Onboarding app's twelve rows for this candidate, from the same readers it uses. */
function cndOnboardingChecklist_(ctx, ev, ob) {
  var c = ev.cand;
  if (!c) return null;
  var docs = onboardingDocIndex_()[ctx.key] || {};
  if (str_(c.docsfolderid)) docs.__folder = true;
  var stage = onboardingStageOf_(c.status, docs, ob ? ob.start_date : '');
  var packet = null;
  try { packet = packetState_(c); } catch (eP) { packet = null; }
  var certs = {};
  try {
    var pic = certPicture_() || {};
    var k = clientNameKey_(str_(c.candidatename));
    if (k && pic[k]) certs = pic[k].certs || {};
  } catch (eC) { certs = {}; }
  return onboardingChecklist_(docs, stage, (ev.analysis || {}).cjisstatus, packet, certs);
}

function cndDocumentsBuild_(ctx) {
  var row = ctx.row, sink = { why: [], degraded: false }, docs = [];
  var ev = cndEvidenceOr_(ctx, sink);
  var x = cndExtras_(ctx, ev);
  var a = ev.analysis || {};
  var files = {};
  try { files = cndHiringDocs_(ctx.key); }
  catch (eF) { sink.why.push(cndWhy_('The hiring documents', eF)); sink.degraded = true; }
  var fileOf = function (r) { return r ? (String(r.file_id || '') || locationsDriveId_(r.file_url)) : ''; };
  var here = function (r) { var st = String((r && r.status) || '').toLowerCase(); return st === 'uploaded' || st === 'verified'; };
  var upload = function (itemId, docId) {
    if (ctx.archived) return null;
    var p = { candidate_id: ctx.key, item_id: itemId };
    if (docId) p.doc_id = docId;
    return { action: 'tableDocUpload', form: 'upload', payload: p };
  };
  var item = function (id) { return (row.checklist || []).filter(function (c) { return c.id === id; })[0] || null; };

  var app = row.application || null;
  if (app && str_(app.srid)) {
    var signed = str_(app.status).toLowerCase() === 'signed';
    var appFile = '';
    try { appFile = cndApplicationFile_(str_(app.srid)); }
    catch (eA) { sink.why.push(cndWhy_('The fetched applications', eA)); }
    docs.push({ id: 'application', title: 'Application', group: 'application', status: signed ? 'on_file' : 'pending',
                date: talentIsoDay_(app.signedAt || app.appliedAt), expires: '', file_id: appFile,
                mime: appFile ? 'application/pdf' : '', srid: signed ? str_(app.srid) : '', source: 'Dropbox Sign',
                verified: false, upload: null });
  }

  var resumeId = locationsDriveId_(row.resumeLink);
  var resumeItem = item('resume');
  var resumeHere = !!str_(row.resumeLink) || (!!resumeItem && (resumeItem.status === 'done' || resumeItem.status === 'auto'));
  docs.push({ id: 'resume', title: 'Résumé', group: 'application', status: resumeHere ? 'on_file' : 'pending',
              date: talentIsoDay_(a.analyzedat), expires: '', file_id: resumeId, mime: '',
              url: resumeId ? '' : str_(row.resumeLink), source: 'Hiring', verified: false,
              upload: resumeHere ? null : upload('resume', '') });

  var s = ev.screen || null;
  if (s) {
    var report = locationsDriveId_(s.phonescreenreporturl);
    docs.push({ id: 'screen_report', title: 'Phone screen report', group: 'interview', status: report ? 'on_file' : 'pending',
                date: talentIsoDay_(s.screendate), expires: '', file_id: report, mime: '', source: 'Phone screen',
                verified: false, upload: null });
  }

  var iv = x.interview;
  var scored = !!iv && !!str_(iv.interviewer_name) && str_(iv.score) !== '';
  docs.push({ id: 'interview_notes', title: 'Interview notes', group: 'interview', status: scored ? 'on_file' : 'pending',
              date: iv ? (talentIsoDay_(iv.interviewed_at) || talentIsoDay_(iv.scheduled_for)) : '', expires: '',
              file_id: '', mime: '', source: 'Interview scorecard', verified: false, upload: null,
              record: scored ? { interviewer: str_(iv.interviewer_name), score: str_(iv.score),
                                 recommendation: str_(iv.recommendation), comments: str_(iv.comments),
                                 interviewed_at: str_(iv.interviewed_at) } : null });

  var cj = files.background_check && here(files.background_check) ? files.background_check : null;
  var cjFile = fileOf(cj) || locationsDriveId_(a.cjisreporturl);
  var cleared = hubCjisCleared_(a);
  var cjHere = cleared || !!cjFile;
  docs.push({ id: 'cjis', title: 'Background check (CJIS)', group: 'screening', status: cjHere ? 'on_file' : 'pending',
              result: str_(a.cjisstatus), date: cj ? talentIsoDay_(cj.uploaded_at) : '', expires: '', file_id: cjFile,
              mime: cj ? str_(cj.mime_type) : '', source: 'Hiring', verified: cleared,
              upload: cjHere ? null : upload('cjis', '') });

  var reached = CND_ONBOARDING_STAGES.indexOf(row.stage) !== -1;
  var signedPacket = cndPacketSigned_(row);
  cndCatalog_().forEach(function (c) {
    if (c.doc_id === 'background_check') return;
    var r = files[c.doc_id] && here(files[c.doc_id]) ? files[c.doc_id] : null;
    var byEnvelope = c.doc_id === 'dropbox_packet' && signedPacket;
    if (!reached && !r) return;
    var onFile = !!r || byEnvelope;
    docs.push({ id: 'doc_' + c.doc_id, doc_id: c.doc_id, title: c.label, group: 'onboarding',
                status: onFile ? 'on_file' : 'pending', required: c.required,
                date: r ? (talentIsoDay_(r.issued_on) || talentIsoDay_(r.uploaded_at)) : '',
                expires: r ? talentIsoDay_(r.expires_on) : '', file_id: fileOf(r), mime: r ? str_(r.mime_type) : '',
                source: r ? 'Onboarding documents' : (byEnvelope ? 'Dropbox Sign' : 'Onboarding documents'),
                verified: !!r && String(r.status).toLowerCase() === 'verified',
                upload: onFile ? null : upload(CND_ITEM_OF_DOC[c.doc_id] || c.doc_id, c.doc_id) });
  });

  if (reached) {
    try {
      var list = cndOnboardingChecklist_(ctx, ev, x.onboarding);
      if (list) {
        docs.push({ id: 'onboarding_checklist', title: 'Onboarding checklist', group: 'onboarding',
                    status: list.every(function (i) { return i.status === 'done' || i.status === 'auto'; }) ? 'on_file' : 'pending',
                    date: '', expires: '', file_id: '', mime: '', source: 'Onboarding', verified: false, upload: null,
                    items: list });
      }
    } catch (eO) { sink.why.push(cndWhy_('The onboarding checklist', eO)); sink.degraded = true; }
  }
  var onFileN = docs.filter(function (d) { return d.status === 'on_file'; }).length;
  return { docs: docs,
           counts: { total: docs.length, on_file: onFileN, with_file: docs.filter(function (d) { return !!d.file_id; }).length },
           why: sink.why, degraded: sink.degraded };
}

function cndDocuments_(ctx) {
  return cndData_('candidateProfileDocuments', ctx, function () { return cndDocumentsBuild_(ctx); });
}

function cndDocumentsDoor_(ctx) {
  return cndServe_('The documents', function () { return cndDocuments_(ctx); });
}

HUB_POLICY.candidateProfileDocuments = {
  file: 'CandidateProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' } }
};
/** Documents: the application and résumé, the interview papers, the background check and the onboarding documents. */
HUB_ACTIONS.candidateProfileDocuments = function (payload, user) {
  if (!cndWide_(cndViewer_(user))) return candidateProfilesUnknown_();
  var ctx = cndCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  return cndDocumentsDoor_(ctx);
};

HUB_POLICY.candidateProfileDocFile = {
  file: 'CandidateProfiles.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' }, file_id: { type: 'string' } }
};
/** One of the candidate's documents as bytes for the platform's centred viewer; only a file their Documents list names. */
HUB_ACTIONS.candidateProfileDocFile = function (payload, user) {
  if (!cndWide_(cndViewer_(user))) return candidateProfilesUnknown_();
  var ctx = cndCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  var id = locationsText_(payload && payload.file_id, 120);
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return { status: 400, message: 'file_id: a Drive file id.' };
  var docs;
  try { docs = cndDocuments_(ctx).docs || []; }
  catch (eK) { return { status: 503, message: 'The documents could not be read just now — try again in a minute.' }; }
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

// ---- activity -------------------------------------------------------------

/** The candidate's stage moves, as every status write in the platform files them. */
function cndStatusHistory_(key) {
  if (!hubTabSheet_(CND_STATUS_TAB)) return [];
  return readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), CND_STATUS_TAB).filter(function (h) {
    return str_(h.candidateid) === key;
  }).map(function (h) {
    return { at: str_(h.timestamp), from: str_(h.fromstatus), to: str_(h.tostatus), by: str_(h.actor) };
  });
}

function cndActivityBuild_(ctx) {
  var sink = { why: [], degraded: false }, items = [];
  var journey = null;
  try { journey = journeyFor_(ctx.key); } catch (eJ) { journey = null; }
  if (journey === null) {
    sink.why.push('The hiring journey could not be read, so its steps are not listed.');
    sink.degraded = true;
  }
  var moves = [];
  (journey || []).forEach(function (j) {
    var ref = str_(j.ref), kind = j.step === 'note' ? 'note' : 'step';
    if (j.step === CND_PRESS_STEP) {
      kind = ref.indexOf('stage:') === 0 ? 'stage'
           : (ref.indexOf('upload:') === 0 || ref.indexOf('document:') === 0 ? 'document' : 'record');
      if (kind === 'stage') moves.push({ to: ref.slice(6), at: Date.parse(str_(j.at)) || 0 });
    }
    items.push({ id: 'jrn_' + str_(j.id), at: str_(j.at), kind: kind, step: str_(j.step),
                 title: str_(j.title) || str_(j.step), body: locationsText_(j.detail, 900), channel: str_(j.channel),
                 ok: j.ok !== false, rehearsal: !!j.rehearsal, by: cndBy_(j.by) });
  });
  // the status row a stage press wrote is the same move the press's own line already says
  var echo = function (h) {
    var to = talentStage_(h.to) || str_(h.to).toLowerCase().replace(/[^a-z]+/g, '-');
    var at = Date.parse(h.at) || 0;
    return moves.some(function (m) { return m.to === to && Math.abs(m.at - at) <= CND_PRESS_ECHO_MS; });
  };
  try {
    cndStatusHistory_(ctx.key).forEach(function (h, i) {
      if (echo(h)) return;
      var from = talentStage_(h.from), to = talentStage_(h.to);
      items.push({ id: 'stage_' + (i + 1), at: h.at, kind: 'stage', step: 'stage',
                   title: 'Stage: ' + (from ? cndStageLabel_(from) : h.from || 'New') + ' → ' + (to ? cndStageLabel_(to) : h.to),
                   body: '', channel: '', ok: true, rehearsal: false, by: cndBy_(h.by) });
    });
  } catch (eH) { sink.why.push(cndWhy_('The stage history', eH)); sink.degraded = true; }
  items.sort(ssaNewest_);
  return { items: items.slice(0, CND_ACTIVITY_CAP), total: items.length, why: sink.why, degraded: sink.degraded };
}

function cndActivity_(ctx) {
  return cndData_('candidateProfileActivity', ctx, function () { return cndActivityBuild_(ctx); });
}

function cndActivityDoor_(ctx) {
  return cndServe_('The activity', function () { return cndActivity_(ctx); });
}

HUB_POLICY.candidateProfileActivity = {
  file: 'CandidateProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' } }
};
/** Activity: every hiring step, note and stage move the Hiring app logged for the candidate, newest first. */
HUB_ACTIONS.candidateProfileActivity = function (payload, user) {
  if (!cndWide_(cndViewer_(user))) return candidateProfilesUnknown_();
  var ctx = cndCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  return cndActivityDoor_(ctx);
};

// ---- overview -------------------------------------------------------------

function cndOverviewBuild_(ctx) {
  var row = ctx.row, sink = { why: [], degraded: false };
  var ev = cndEvidenceOr_(ctx, sink);
  var x = cndExtras_(ctx, ev);
  var a = ev.analysis || {}, ob = x.onboarding;
  var part = function (what, get) {
    try {
      var d = get();
      (d.why || []).forEach(function (w) { if (sink.why.indexOf(w) === -1) sink.why.push(w); });
      if (d.degraded) sink.degraded = true;
      return d;
    } catch (e) { sink.why.push(cndWhy_(what, e)); sink.degraded = true; return null; }
  };
  var actions = part('The hiring actions', function () { return cndActions_(ctx); });
  var docs = part('The documents', function () { return cndDocuments_(ctx); });
  var activity = part('The activity', function () { return cndActivity_(ctx); });
  var years = str_(a.totalyearscaregiving);
  var candidate = {
    key: ctx.key, name: ctx.name, position: str_(row.role) || 'Direct Support Professional', stage: str_(row.stage),
    stage_label: cndStageLabel_(row.stage),
    status_label: ctx.archived ? (str_(row.status) || 'Archived') : cndStageLabel_(row.stage),
    archived: ctx.archived, archived_reason: ctx.archived ? str_(row.archived_reason) : '',
    location: [str_(row.city), str_(row.state)].filter(String).join(', '), recruiter: cndBy_(row.owner),
    source: str_(row.source), applied_at: talentIsoDay_(row.appliedAt), phone: str_(row.phone), email: str_(row.email),
    avatar: str_(row.avatar), days_at_stage: row.daysAtStage !== null && row.daysAtStage !== undefined ? row.daysAtStage : null
  };
  return {
    candidate: candidate,
    information: {
      full_name: ctx.name, stage_label: candidate.status_label, phone: candidate.phone, email: candidate.email,
      source: candidate.source, applied_at: candidate.applied_at, position: candidate.position,
      availability: str_(a.scheduleavailability), experience: years ? years + ' years caregiving' : str_(a.careexperience),
      preferred_location: ob ? str_(ob.house) : '',
      earliest_start: ob ? (talentIsoDay_(ob.earliest_start_date) || talentIsoDay_(ob.start_date)) : '',
      recruiter: candidate.recruiter
    },
    summary: str_(row.summary) || str_(a.summary),
    tiles: { stage_label: candidate.status_label, open_actions: actions ? actions.open : null,
             docs_on_file: docs ? docs.counts.on_file : null, docs_total: docs ? docs.counts.total : null },
    next: actions && actions.next ? { id: actions.next.id, label: actions.next.label, owner: actions.next.owner,
                                      status: actions.next.status, due: actions.next.due,
                                      due_state: actions.next.due_state } : null,
    attention: actions ? actions.attention : [],
    recent: activity ? activity.items.slice(0, CND_RECENT) : [],
    why: sink.why, degraded: sink.degraded
  };
}

function cndOverview_(ctx) {
  return cndData_('candidateProfileOverview', ctx, function () { return cndOverviewBuild_(ctx); });
}

function cndOverviewDoor_(ctx) {
  return cndServe_('The candidate', function () { return cndOverview_(ctx); });
}

HUB_POLICY.candidateProfileOverview = {
  file: 'CandidateProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' } }
};
// Overview: at a glance, contact, information, the documents and actions counted, the next step and recent…
HUB_ACTIONS.candidateProfileOverview = function (payload, user) {
  var scope = cndViewer_(user);
  if (!scope) return candidateProfilesUnknown_();
  if (!cndWide_(scope)) return cndNarrowServe_(scope, payload, cndNarrowOverview_);
  var ctx = cndCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  return cndOverviewDoor_(ctx);
};

// ---- texts and calls ------------------------------------------------------

/** A name or an e-mail as a person's mark: lower case, the punctuation and spacing gone; '' when too short to say. */
function cndMark_(v) {
  var s = String(v === undefined || v === null ? '' : v).toLowerCase().replace(/[\s.,'’"()_-]+/g, ' ').trim();
  return s.length >= 3 ? s : '';
}

// Every phone the Hiring app's candidate rows carry: last-ten digits → the candidates carrying it, each candidate's…
function cndPhoneIndex_() {
  var memo = CND_MEMO_;
  if (memo && memo.phones) return memo.phones;
  var out = { index: {}, own: {}, who: {}, why: '' };
  var take = function (cid, v, name, email) {
    var w = out.who[cid] = out.who[cid] || { names: {}, emails: {} };
    if (cndMark_(name)) w.names[cndMark_(name)] = true;
    if (cndMark_(email)) w.emails[cndMark_(email)] = true;
    if (!str_(v)) return;
    (out.own[cid] = out.own[cid] || []).push(str_(v));
    spNumbers_(v).forEach(function (d) { (out.index[d] = out.index[d] || {})[cid] = true; });
  };
  cndBoard_().rows.forEach(function (r) { take(String(r.id), r.phone, r.name, r.email); });
  try {
    cndRawRows_().forEach(function (r) {
      if (!str_(r.candidateid)) return;
      take(str_(r.candidateid), r.phone, str_(r.candidatename) || (str_(r.firstname) + ' ' + str_(r.lastname)), r.email);
    });
  } catch (e) {
    out.why = 'the candidate records could not be read (' + String((e && e.message) || e).slice(0, 120) +
              '), so a phone another candidate also carries is not known';
  }
  if (memo) memo.phones = out;
  return out;
}

// The candidate in the shape the Staff app's text and call readers take: their phones, and who else carries each.
function cndStaffCtx_(ctx) {
  var found = cndPhoneIndex_();
  var mine = found.who[ctx.key] || { names: {}, emails: {} };
  var names = {}, emails = {};
  Object.keys(mine.names).forEach(function (n) { names[n] = true; });
  Object.keys(mine.emails).forEach(function (m) { emails[m] = true; });
  if (cndMark_(ctx.name)) names[cndMark_(ctx.name)] = true;
  if (cndMark_(ctx.row.email)) emails[cndMark_(ctx.row.email)] = true;
  var same = function (k) {
    var w = found.who[k];
    if (!w) return false;
    return Object.keys(w.names).some(function (n) { return names[n]; }) ||
           Object.keys(w.emails).some(function (m) { return emails[m]; });
  };
  var shared = {};
  Object.keys(found.index).forEach(function (d) {
    var o = {};
    Object.keys(found.index[d]).forEach(function (k) { if (k === ctx.key || !same(k)) o[k] = true; });
    shared[d] = o;
  });
  SHARED_LINE_DIGITS.forEach(function (d) {
    var o = { company: true };
    Object.keys(shared[d] || {}).forEach(function (k) { o[k] = true; });
    shared[d] = o;
  });
  return { key: ctx.key, name: ctx.name, account: null, master: null,
           people: { phone: str_(ctx.row.phone), phones: found.own[ctx.key] || [], email: str_(ctx.row.email), emails: [] },
           phones_shared: shared, why: found.why };
}

/** A Staff reader's answer for the candidate, with what the phone index could not say added to its why. */
function cndStaffRead_(ctx, read) {
  var sctx = cndStaffCtx_(ctx);
  var out = read(sctx);
  if (sctx.why) {
    out.why = [out.why, sctx.why].filter(String).join('; ');
    out.degraded = true;
  }
  return out;
}

function cndTextsFacts_(ctx) {
  return cndData_('candidateProfileTexts', ctx, function () { return cndStaffRead_(ctx, spTextsFacts_); });
}

/** One page of one conversation, as the Staff app pages it. */
function cndTextsDoor_(ctx, payload) {
  var facts;
  try { facts = cndTextsFacts_(ctx); }
  catch (e) {
    return { status: 503, message: 'The texts could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
  var want = locationsText_(payload && payload.with, 60);
  var ids = facts.counterparts.map(function (x) { return x.id; });
  var withId = ids.indexOf(want) !== -1 ? want : (ids[0] || '');
  var before = locationsText_(payload && payload.before, 40);
  var thread = facts.messages.filter(function (m) { return m.line === withId && (!before || m.at < before); });
  var page = thread.slice(0, SP_TEXT_PAGE).map(function (m) { return { id: m.id, at: m.at, dir: m.dir, body: m.body, by: m.by }; });
  return { status: 200, data: { counterparts: facts.counterparts, with: withId, messages: page,
                                more: thread.length > SP_TEXT_PAGE, coverage: facts.coverage,
                                phones_matched: facts.phones_matched, why: facts.why, degraded: !!facts.degraded } };
}

HUB_POLICY.candidateProfileTexts = {
  file: 'CandidateProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' }, with: { type: 'string' }, before: { type: 'string' } }
};
/** SMS: one conversation per company line with the candidate's own phones, newest first, a page at a time. */
HUB_ACTIONS.candidateProfileTexts = function (payload, user) {
  if (!cndWide_(cndViewer_(user))) return candidateProfilesUnknown_();
  var ctx = cndCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  return cndTextsDoor_(ctx, payload);
};

/** The calls with the candidate's own phones, and the phone screen the Hiring app keeps; metadata only. */
function cndTranscriptsBuild_(ctx) {
  var sink = { why: [], degraded: false };
  var out = cndStaffRead_(ctx, spTranscriptsBuild_);
  var ev = cndEvidenceOr_(ctx, sink);
  var s = ev.screen || null;
  var calls = out.calls || [];
  if (s && (str_(s.transcripttext) || str_(s.transcripturl))) {
    var callId = str_(s.transcriptcallid);
    var hit = callId ? calls.filter(function (c) { return c.call_id === callId; })[0] : null;
    if (hit) {
      hit.kind = 'Phone screen';
      if (hit.categories.indexOf('Phone screen') === -1) hit.categories.unshift('Phone screen');
    } else {
      calls.push({ call_id: 'screen', at: str_(s.transcriptcreated) || str_(s.screendate), secs: '', direction: '', line: '',
                   turns: '', kind: 'Phone screen', categories: ['Phone screen'] });
    }
    calls.sort(function (a, b) { return a.at < b.at ? 1 : (a.at > b.at ? -1 : 0); });
    var count = {};
    calls.forEach(function (c) { (c.categories || []).forEach(function (cat) { count[cat] = (count[cat] || 0) + 1; }); });
    out.categories = Object.keys(count).sort().map(function (name) { return { name: name, count: count[name] }; });
  }
  out.calls = calls;
  if (sink.why.length) out.why = [out.why].concat(sink.why).filter(String).join('; ');
  if (sink.degraded) out.degraded = true;
  return out;
}

function cndTranscripts_(ctx) {
  return cndData_('candidateProfileTranscripts', ctx, function () { return cndTranscriptsBuild_(ctx); });
}

function cndTranscriptsDoor_(ctx) {
  return cndServe_('The calls', function () { return cndTranscripts_(ctx); });
}

HUB_POLICY.candidateProfileTranscripts = {
  file: 'CandidateProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' } }
};
/** Transcripts: the candidate's calls and phone screen by date and category; the words open one call at a time. */
HUB_ACTIONS.candidateProfileTranscripts = function (payload, user) {
  if (!cndWide_(cndViewer_(user))) return candidateProfilesUnknown_();
  var ctx = cndCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  return cndTranscriptsDoor_(ctx);
};

HUB_POLICY.candidateProfileTranscript = {
  file: 'CandidateProfiles.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' }, id: { type: 'string' } }
};
/** The words of one listed call through the transcript door, or of the phone screen the Hiring app keeps. */
HUB_ACTIONS.candidateProfileTranscript = function (payload, user) {
  if (!cndWide_(cndViewer_(user))) return candidateProfilesUnknown_();
  var ctx = cndCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  var id = locationsText_(payload && payload.id, 60);
  if (!id) return { status: 400, message: 'id: which call.' };
  var list;
  try { list = cndTranscripts_(ctx).calls || []; }
  catch (e) { return { status: 503, message: 'The calls could not be read just now — try again in a minute.' }; }
  var hit = list.filter(function (c) { return c.call_id === id; })[0];
  if (!hit) return { status: 404, message: 'This candidate has no such call.' };
  var got = null;
  if (id !== 'screen') {
    got = commCallsTranscriptRead_(id, user);
    var spoke = !!got && got.status === 200 && !!got.data && got.data.has_words !== false;
    if (spoke || hit.kind !== 'Phone screen') {
      if (!got || got.status !== 200) return got;
      return { status: 200, data: cndScrub_(cndLineNamed_(got.data)) };
    }
  }
  // the phone screen: the words the Hiring record filed, when the call's own inboxes no longer hold them
  var s;
  try { s = cndEvidence_(ctx).screen || {}; }
  catch (eS) { return { status: 503, message: 'The phone screen could not be read just now — try again in a minute.' }; }
  if (!str_(s.transcripttext) && got) return got.status === 200 ? { status: 200, data: cndScrub_(got.data) } : got;
  // the words are a call's words: the read is logged with who asked, as the transcript door logs its own
  try { hubSysLog_(str_(user && user.email), 'candidateProfileTranscript', ctx.key, { status: 200 }); } catch (eL) {}
  return { status: 200, data: cndScrub_(cndScreenWords_(s, id)) };
};

/** A transcript answer with its company line's name, when the platform's line book names it. */
function cndLineNamed_(data) {
  var d = data && typeof data === 'object' ? data : {};
  if (d.line_name || !str_(d.line)) return d;
  var out = {};
  Object.keys(d).forEach(function (k) { out[k] = d[k]; });
  try {
    var ln = hubLineRow_(spNumbers_(d.line)[0] || d.line);
    if (ln && ln.name) out.line_name = str_(ln.name);
  } catch (e) { /* the number stands for the line */ }
  return out;
}

// "[0:05] +13305550142: Hello" — a line the speaker transcript writes per turn.
var CND_TURN_RE = /^\s*\[\d{1,3}:\d{2}(?::\d{2})?\]\s*[^:\n]{0,80}?\s*:/m;

// The phone screen's words as the Hiring record filed them: turn by turn when the text carries its speakers and…
function cndScreenWords_(s, id) {
  var words = str_(s.transcripttext);
  var turns = CND_TURN_RE.test(words);
  var line = '';
  if (turns) {
    (typeof COMMS_SCREEN_LINES !== 'undefined' ? COMMS_SCREEN_LINES : []).forEach(function (d) {
      var spoken = new RegExp('^\\s*\\[[^\\]]*\\]\\s*\\+?1?[\\s().-]*' + String(d).split('').join('[\\s().-]*') + '\\s*:', 'm');
      if (!line && spoken.test(words)) line = '+1' + d;
    });
  }
  return cndLineNamed_({ call_id: id, at: str_(s.transcriptcreated) || str_(s.screendate), line: line, direction: '',
                         duration_sec: '', full_transcript: words, speaker_transcript: turns ? words : '',
                         has_words: !!words, kind: 'Phone screen' });
}

// ---- the résumé -----------------------------------------------------------

// One file's reading is kept this long under its id: the same résumé is never converted twice in that time.
var CND_RESUME_TTL_S = 21600;
var CND_RESUME_CAP = { work: 12, education: 6, items: 30, item: 90, summary: 700 };
var CND_RESUME_HEADS = [
  ['summary', /^(?:(?:professional|career|personal)\s+)?(?:summary|profile|objective|about me|overview)(?:\s+of qualifications)?$/i],
  ['work', /^(?:(?:professional|work|employment|relevant|career|job|caregiving)\s+)?(?:experience|history|employment)(?:\s+history)?$/i],
  ['certifications', /^(?:certifications?|certificates?|licen[cs]es?|credentials|(?:certifications?|licen[cs]es?)\s*(?:and|&)\s*(?:certifications?|licen[cs]es?)|training\s*(?:and|&)\s*certifications?)$/i],
  ['education', /^(?:education(?:al background)?|academic background|schooling|education\s*(?:and|&)\s*training)$/i],
  ['skills', /^(?:(?:key|core|professional|technical|relevant)\s+)?(?:skills|competencies|qualifications|abilities|strengths)(?:\s*(?:and|&)\s*(?:abilities|qualifications|strengths))?$/i],
  ['languages', /^languages?(?:\s+spoken)?$/i],
  ['availability', /^availability$/i],
  ['other', /^(?:references?|volunteer(?:\s+(?:experience|work))?|activities|interests|hobbies|awards?|honors|achievements?|accomplishments|projects?|contact(?:\s+information)?|personal\s+information|additional\s+information)$/i]
];
var CND_MON = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
var CND_WHEN = '(?:' + CND_MON + '\\s*,?\\s*\\d{4}|\\d{1,2}\\s*/\\s*\\d{4}|\\d{1,2}\\s*/\\s*\\d{2}(?!\\d)|(?:19|20)\\d{2})';
var CND_RANGE_RE = new RegExp('\\(?(' + CND_WHEN + ')\\s*(?:-|–|—|to|until|thru|through)\\s*(' + CND_WHEN +
                              '|present|current|now|today)\\)?', 'i');
var CND_ROLE_RE = /\b(?:aide|assistant|professional|dsp|caregiver|care ?giver|nurse|technician|tech|manager|supervisor|coordinator|specialist|associate|cashier|clerk|driver|cook|server|attendant|worker|representative|counselou?r|teacher|lead|director|stna|cna|hha|lpn|rn|provider|helper|housekeeper|companion|intern|agent|operator|officer|trainer|instructor|administrator|receptionist|secretary|stocker|sitter|nanny|therapist|mentor|advocate|volunteer|crew)\b/i;
var CND_ORG_RE = /\b(?:inc|llc|ltd|corp|corporation|company|services?|care|health|healthcare|homes?|hospital|center|centre|agency|group|living|residential|school|university|college|stores?|restaurant|clinic|facility|nursing|rehab|foundation|church|academy|department|county|ministries|solutions|partners|enterprises|systems|community|village|manor|gardens|walmart|kroger|target|amazon|mcdonald'?s)\b/i;
var CND_ORG_ONLY_RE = /\b(?:inc|llc|ltd|corp|corporation|company|hospital|center|centre|agency|school|university|college|stores?|restaurant|clinic|foundation|church|department|county|walmart|kroger|target|amazon|mcdonald'?s)\b/i;
var CND_PLACE_RE = /^[A-Za-z][A-Za-z .'-]{1,40},\s*[A-Z]{2}\.?$/;
var CND_DEGREE_RE = /\b(?:diploma|g\.?e\.?d|associate'?s?|bachelor'?s?|master'?s?|doctorate|ph\.?d|degree|certificate|coursework|program|stna|cna|lpn|nursing|a\.a\.s?|b\.s\.n?|b\.a|m\.s|m\.b\.a)\b/i;
var CND_SCHOOL_RE = /\b(?:school|college|university|academy|institute|community|polytechnic|vocational|jvs|univ)\b/i;
var CND_CREDENTIALS = [
  ['CPR', /\bCPR\b/i], ['First Aid', /\bfirst[\s-]aid\b/i], ['BLS', /\bBLS\b|basic life support/i],
  ['STNA', /\bSTNA\b|state[\s-]tested nurs(?:e|ing) aide/i],
  ['CNA', /\bCNA\b|certified nurs(?:e|ing) (?:aide|assistant)/i], ['HHA', /\bHHA\b/], ['DODD', /\bDODD\b/i],
  // a duty ("medication administration") is not a credential: only the delegation, the aide, or a certified pass
  ['Medication administration', /\bmed(?:ication)?s?\.?\s*(?:del(?:egation)?|aide)\b|\bQMA\b|\bmed(?:ication)?s?\.?\s*(?:pass|admin(?:istration)?)\s+(?:certif|cert\b|trained|training)/i],
  ['MUI', /\bMUI\b/], ['Driver\'s license', /driver'?s'?\s+licen[cs]e|\bvalid\s+(?:ohio\s+)?(?:DL|driver)/i],
  ['CDL', /\bCDL\b/], ['Food handler', /\bserv\s?safe\b|food handler/i], ['LPN', /\bLPN\b/], ['RN', /\bRN\b/],
  ['Crisis prevention', /\bCPI\b|crisis prevention|\bMANDT\b/i]
];
var CND_LANGS = ['English', 'Spanish', 'French', 'Arabic', 'Somali', 'Nepali', 'Swahili', 'Portuguese', 'Haitian Creole',
                 'Vietnamese', 'Mandarin', 'Cantonese', 'Chinese', 'Russian', 'Ukrainian', 'German', 'Italian', 'Hindi', 'Urdu',
                 'Tagalog', 'American Sign Language', 'Amharic', 'Yoruba', 'Twi', 'Korean', 'Japanese', 'Polish', 'Romanian',
                 'Turkish', 'Farsi', 'Bengali', 'Punjabi', 'Kinyarwanda', 'Burmese', 'Albanian', 'Bosnian', 'Greek',
                 'Hebrew', 'Hmong', 'Tigrinya', 'Oromo', 'Wolof', 'Lingala', 'Pashto', 'Dari'];
var CND_STREET_RE = /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Z0-9][A-Za-z0-9.'-]*\s+){0,4}(?:St|ST|Street|STREET|Ave|AVE|Avenue|AVENUE|Rd|RD|Road|ROAD|Blvd|BLVD|Boulevard|Dr|DR|Drive|DRIVE|Ln|LN|Lane|LANE|Ct|CT|Court|COURT|Way|WAY|Pl|PL|Place|Pkwy|Parkway|Cir|Circle|Ter|Terrace|Hwy|Highway|Trl|Trail)\b\.?(?:\s*,?\s*(?:Apt|APT|Apartment|Unit|UNIT|Suite|Ste|#)\.?\s*[\w-]+)?/g;

// An item that was only a street, an e-mail or a phone is left out whole.
var CND_CONTACT_WITHHELD_RE = /\[(?:address|e-mail|phone) withheld\]/;

/** What a résumé value may show: no street, box or ZIP, no e-mail, phone or licence number. */
function cndResumeClean_(v) {
  return String(v == null ? '' : v)
    .replace(CND_STREET_RE, '[address withheld]')
    .replace(/\bP\.?\s*O\.?\s*Box\s+\d+/gi, '[address withheld]')
    .replace(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/g, '$1')
    .replace(/\b\d{5}-\d{4}\b/g, '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[e-mail withheld]')
    .replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/g, '[phone withheld]')
    .replace(/\b(licen[cs]e|lic\.?|permit|number|no\.)\s*(?:#|:|no\.?)?\s*[A-Z]{0,3}\d[A-Z0-9-]{4,}/gi, '$1 [withheld]')
    .replace(/\s+/g, ' ').replace(/^[\s,;|:–—-]+|[\s,;|:–—-]+$/g, '').trim();
}

/** A line without its bullet, and whether it had one. */
function cndResumeBullet_(line) {
  var s = String(line || '').replace(/ /g, ' ').trim();
  var m = /^(?:[•·▪●◦○■□➢►>*]|[-–—](?=\s))\s*/.exec(s);
  return { text: m ? s.slice(m[0].length).trim() : s, bullet: !!m };
}

/** The section a line opens, or ''. */
function cndResumeHead_(line) {
  var t = String(line || '').replace(/^[\s#*•·=_|-]+|[\s:*•·=_|-]+$/g, '').replace(/\s+/g, ' ');
  if (!t || t.length > 48) return '';
  for (var i = 0; i < CND_RESUME_HEADS.length; i++) if (CND_RESUME_HEADS[i][1].test(t)) return CND_RESUME_HEADS[i][0];
  return '';
}

/** The text's lines by the section they stand under; what comes before the first heading is `head`. */
function cndResumeSections_(text) {
  var out = { head: [] }, at = 'head';
  String(text || '').split(/\r?\n/).forEach(function (raw) {
    var line = raw.replace(/ /g, ' ').replace(/\s+$/, '');
    if (!line.trim()) return;
    var h = cndResumeHead_(line);
    if (h) { at = h; out[at] = out[at] || []; return; }
    var m = /^\s*([A-Za-z][A-Za-z &/]{2,40}?)\s*:\s*(\S.*)$/.exec(line);
    var inline = m ? cndResumeHead_(m[1]) : '';
    if (inline) { (out[inline] = out[inline] || []).push(m[2].trim()); return; }
    // "Available to start: …", "Preferred location: …" — facts, never a list's items
    if (/^\s*(?:availab(?:ility|le)[^:]{0,24}|(?:earliest )?start(?:ing)? date|preferred (?:work )?location|location preference|willing to (?:work|relocate)[^:]{0,24})\s*:/i.test(line) ||
        /^\s*available\s+(?:to start\s+)?(?:immediately|now|asap|right away)\b/i.test(line)) {
      (out.facts = out.facts || []).push(line.trim());
      return;
    }
    (out[at] = out[at] || []).push(line.trim());
  });
  return out;
}

/** A header line's pieces: split on the separators résumés use, a trailing "City, ST" its own piece. */
function cndResumeParts_(s) {
  var out = [];
  String(s || '').split(/\s*(?:\||•|·|\t|\s{3,}|\s[–—-]\s)\s*/).forEach(function (p) {
    var t = p.replace(/^[\s,;:()–—-]+|[\s,;:()–—-]+$/g, '');
    if (!t) return;
    var at = /^(.+?)\s+at\s+(.+)$/i.exec(t);
    if (at && CND_ROLE_RE.test(at[1])) { out.push(at[1]); t = at[2]; }
    var place = /^(.*?),\s*([A-Za-z][A-Za-z .'-]{1,40},\s*[A-Z]{2})\.?$/.exec(t);
    if (place && place[1]) { out.push(place[1].trim(), place[2].trim()); return; }
    out.push(t);
  });
  return out;
}

function cndResumeJob_(parts, from, to) {
  var job = { role: '', employer: '', place: '', from: cndResumeClean_(from), to: cndResumeClean_(to) };
  var rest = [];
  parts.forEach(function (p) {
    if (!job.place && CND_PLACE_RE.test(p)) { job.place = p.replace(/\.$/, ''); return; }
    if (!job.role && CND_ROLE_RE.test(p) && !CND_ORG_ONLY_RE.test(p)) { job.role = p; return; }
    rest.push(p);
  });
  job.employer = rest.filter(function (p) { return CND_ORG_RE.test(p); })[0] || rest[0] || '';
  if (!job.role) job.role = rest.filter(function (p) { return p !== job.employer; })[0] || '';
  job.role = cndResumeClean_(job.role).slice(0, CND_RESUME_CAP.item);
  job.employer = cndResumeClean_(job.employer).slice(0, CND_RESUME_CAP.item);
  job.place = cndResumeClean_(job.place);
  if (CND_CONTACT_WITHHELD_RE.test(job.employer)) job.employer = '';
  return job;
}

/** Each job the work section dates: its role, employer and place from the lines it heads, and the span as written. */
function cndResumeWork_(lines) {
  var rows = (lines || []).map(cndResumeBullet_);
  var used = {}, jobs = [];
  var usable = function (j) {
    return j >= 0 && j < rows.length && !used[j] && !rows[j].bullet && !CND_RANGE_RE.test(rows[j].text) &&
           rows[j].text.length <= 90;
  };
  rows.forEach(function (r, i) {
    var m = CND_RANGE_RE.exec(r.text);
    if (!m || jobs.length >= CND_RESUME_CAP.work) return;
    used[i] = true;
    var parts = cndResumeParts_(r.text.replace(m[0], ' '));
    for (var j = i - 1; j >= i - 2 && usable(j); j--) { parts = cndResumeParts_(rows[j].text).concat(parts); used[j] = true; }
    for (var k = i + 1; parts.length < 2 && k <= i + 2 && usable(k); k++) {
      parts = parts.concat(cndResumeParts_(rows[k].text));
      used[k] = true;
    }
    var job = cndResumeJob_(parts, m[1], m[2]);
    if (job.role || job.employer) jobs.push(job);
  });
  return jobs;
}

/** Each school, degree or course in the education section, with its year. */
function cndResumeEducation_(lines) {
  var out = [], cur = null;
  var push = function () {
    if (cur && (cur.school || cur.degree) && out.length < CND_RESUME_CAP.education) out.push(cur);
    cur = null;
  };
  (lines || []).forEach(function (raw) {
    var text = cndResumeBullet_(raw).text;
    var years = text.match(/\b(?:19|20)\d{2}\b/g) || [];
    var bare = text.replace(CND_RANGE_RE, ' ').replace(/\b(?:graduated|expected|completed|class of)\b:?/gi, ' ')
      .replace(/\b(?:19|20)\d{2}\b/g, ' ');
    cndResumeParts_(bare).forEach(function (p) {
      if (CND_PLACE_RE.test(p)) { if (cur && !cur.place) cur.place = p.replace(/\.$/, ''); return; }
      var degree = CND_DEGREE_RE.test(p), school = !degree && CND_SCHOOL_RE.test(p);
      if (!degree && !school) return;
      if (!cur || (degree && cur.degree) || (school && cur.school)) { push(); cur = { school: '', degree: '', year: '', place: '' }; }
      if (degree) cur.degree = cndResumeClean_(p).slice(0, CND_RESUME_CAP.item);
      else cur.school = cndResumeClean_(p).slice(0, CND_RESUME_CAP.item);
    });
    if (cur && !cur.year && years.length) cur.year = years[years.length - 1];
  });
  push();
  return out;
}

/** A list section's items: bullets and commas split, each kept short, each once. */
function cndResumeItems_(lines, split) {
  var out = [], seen = {};
  (lines || []).forEach(function (raw) {
    var text = cndResumeBullet_(raw).text;
    (split ? text.split(/\s*[,;•·|]\s*/) : [text]).forEach(function (p) {
      var t = cndResumeClean_(p).slice(0, CND_RESUME_CAP.item);
      var k = t.toLowerCase();
      if (t.length < 2 || seen[k] || out.length >= CND_RESUME_CAP.items || CND_CONTACT_WITHHELD_RE.test(t)) return;
      seen[k] = true;
      out.push(t);
    });
  });
  return out;
}

/** Items added to a list only when none already names them. */
function cndResumeUnion_(list, more) {
  var out = (list || []).slice();
  (more || []).forEach(function (m) {
    var low = String(m).toLowerCase();
    if (!out.some(function (x) { return String(x).toLowerCase().indexOf(low) !== -1; })) out.push(m);
  });
  return out.slice(0, CND_RESUME_CAP.items);
}

// A résumé's text read deterministically: the summary, each job the work section dates, the schools, the…
function cndResumeParse_(text) {
  var sec = cndResumeSections_(text);
  var credText = [].concat(sec.certifications || [], sec.summary || [], sec.skills || [], sec.education || [],
                           sec.head || []).join('\n');
  var creds = [];
  CND_CREDENTIALS.forEach(function (c) { if (c[1].test(credText)) creds.push(c[0]); });
  var langLines = (sec.languages || []).concat(String(text || '').split(/\r?\n/).filter(function (l) {
    return /\b(?:bilingual|fluent|languages?|speaks?|native)\b/i.test(l);
  }));
  var langs = [];
  CND_LANGS.forEach(function (name) {
    if (new RegExp('\\b' + name + '\\b', 'i').test(langLines.join('\n'))) langs.push(name);
  });
  var work = cndResumeWork_(sec.work || []);
  var all = String(text || '');
  var avail = (sec.availability || []).join(' ');
  if (!avail) {
    var am = /^\s*(?:availability|available)\s*[:–—-]\s*(.{3,160})$/im.exec(all);
    avail = am ? am[1] : '';
  }
  var start = /\b(?:available to start|availability date|start date|can start|able to start|available (?:starting|from|beginning))\b\s*[:–—-]?\s*(immediately|asap|right away|now|[A-Za-z]{3,9}\.? \d{1,2},? \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Za-z]{3,9}\.? \d{4})/i.exec(all);
  var soon = /\bavailable\s+(?:to start\s+)?(immediately|right away|asap)\b/i.exec(all);
  var wants = /\b(?:preferred (?:work )?location|location preference|willing to (?:work|relocate) (?:in|to)|seeking (?:an? )?(?:[A-Za-z]+ ){0,3}(?:position|role|job|work) in|open to work(?:ing)? in)\s*[:–—-]?\s*([A-Za-z][A-Za-z ,'-]{2,60})/i.exec(all);
  var home = typeof hubParseResumeIdentity_ === 'function' ? hubParseResumeIdentity_(all) : { city: '', state: '' };
  var years = work.map(function (j) {
    var y = /\b((?:19|20)\d{2})\b/.exec(j.from) || /\/\s*(\d{2})$/.exec(j.from);
    return y ? Number(y[1].length === 2 ? '20' + y[1] : y[1]) : null;
  }).filter(function (y) { return y !== null; });
  var latest = work[0] || null;
  return {
    summary: cndResumeClean_((sec.summary || []).map(function (l) { return cndResumeBullet_(l).text; }).join(' '))
      .slice(0, CND_RESUME_CAP.summary),
    work: work,
    education: cndResumeEducation_(sec.education || []),
    certifications: cndResumeUnion_(cndResumeItems_(sec.certifications, false), creds),
    skills: cndResumeItems_(sec.skills, true),
    languages: cndResumeUnion_(cndResumeItems_(sec.languages, true).filter(function (l) { return l.length <= 40; }), langs),
    experience: work.length ? work.length + ' job' + (work.length === 1 ? '' : 's') + ' listed' +
      (years.length ? ' since ' + Math.min.apply(null, years) : '') +
      (latest ? ' — latest: ' + (latest.role || latest.employer) +
                (latest.role && latest.employer ? ' at ' + latest.employer : '') : '') : '',
    availability: cndResumeClean_(avail).slice(0, 160),
    earliest_start: start ? cndResumeClean_(start[1]).replace(/^(asap|right away|now|immediately)$/i, 'Immediately')
                          : (soon ? 'Immediately' : ''),
    preferred_location: wants ? cndResumeClean_(wants[1].split(/[.;]|\s+(?:where|to|that|so|which|with|and I)\b/i)[0]).slice(0, 60) : '',
    home: [str_(home.city), str_(home.state)].filter(String).join(', ')
  };
}

/** A résumé file's reading, kept per file id: its text is converted once, then read from the cache. */
function cndResumeText_(fid) {
  var cache = null, key = 'cnd_resume_v1_' + fid;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  } catch (e) { cache = null; }
  var why = {};
  var text = hubExtractResumeText_(fid, why);
  var out = text ? cndResumeParse_(text)
                 : { unreadable: 'The résumé file holds no text the platform can read' +
                                 (why.reason ? ' (' + String(why.reason).slice(0, 120) + ')' : '') + '.' };
  try { if (cache) cache.put(key, JSON.stringify(out), CND_RESUME_TTL_S); } catch (e2) { /* read again next time */ }
  return out;
}

/** A list the rubric's reply already carries — strings, or rows named the way a model names them. */
function cndResumeRawList_(v) {
  if (Array.isArray(v)) return v;
  var s = str_(v);
  return s ? s.split(/\s*[,;]\s*/) : [];
}

/** What the scored analysis already read from the résumé: its fields, and any list its reply carried. */
function cndResumeStored_(a) {
  var raw = {};
  try { raw = JSON.parse(str_(a.rawpromptoutputjson) || '{}') || {}; } catch (e) { raw = {}; }
  var get = function (o, keys) {
    for (var i = 0; i < keys.length; i++) if (str_(o[keys[i]])) return str_(o[keys[i]]);
    return '';
  };
  var work = cndResumeRawList_(raw.WorkHistory || raw.work_history || raw.Jobs).map(function (x) {
    if (typeof x === 'string') return cndResumeWork_([x])[0] || null;
    var o = x && typeof x === 'object' ? x : {};
    var job = { role: cndResumeClean_(get(o, ['Role', 'Title', 'Position', 'JobTitle', 'role', 'title'])),
                employer: cndResumeClean_(get(o, ['Employer', 'Company', 'Organization', 'employer', 'company'])),
                place: cndResumeClean_(get(o, ['Location', 'City', 'location'])),
                from: cndResumeClean_(get(o, ['Start', 'StartDate', 'From', 'start', 'from'])),
                to: cndResumeClean_(get(o, ['End', 'EndDate', 'To', 'end', 'to'])) };
    return job.role || job.employer ? job : null;
  }).filter(Boolean).slice(0, CND_RESUME_CAP.work);
  var education = cndResumeRawList_(raw.Education || raw.education).map(function (x) {
    if (typeof x === 'string') return cndResumeEducation_([x])[0] || null;
    var o = x && typeof x === 'object' ? x : {};
    var ed = { school: cndResumeClean_(get(o, ['School', 'Institution', 'school'])),
               degree: cndResumeClean_(get(o, ['Degree', 'Program', 'degree'])),
               year: get(o, ['Year', 'GraduationYear', 'year']).slice(0, 4), place: '' };
    return ed.school || ed.degree ? ed : null;
  }).filter(Boolean).slice(0, CND_RESUME_CAP.education);
  var years = str_(a.totalyearscaregiving);
  var clean = function (list) {
    return list.map(function (x) { return cndResumeClean_(x).slice(0, CND_RESUME_CAP.item); }).filter(function (x) {
      return x.length >= 2 && !CND_CONTACT_WITHHELD_RE.test(x);
    }).slice(0, CND_RESUME_CAP.items);
  };
  return {
    summary: cndResumeClean_(a.summary).slice(0, CND_RESUME_CAP.summary),
    work: work, education: education,
    certifications: clean(cndResumeRawList_(a.listedcertifications)),
    skills: clean(cndResumeRawList_(raw.Skills || raw.skills)),
    languages: clean(cndResumeRawList_(a.languages)).filter(function (l) { return l.length <= 40; }),
    experience: years ? years + ' years caregiving' : cndResumeClean_(a.careexperience),
    availability: cndResumeClean_(a.scheduleavailability),
    home: [str_(a.city), str_(a.state)].filter(String).join(', '),
    analysis: { highest_responsibility: cndResumeClean_(a.highestresponsibility), dsp_agencies: str_(a.numdspagencies),
                avg_tenure: str_(a.avgtenureperjob), months_since_last: str_(a.monthssincelastexperience) }
  };
}

// Staff Candidates' résumé read: what the scored analysis already holds first, the file's own text only for what it…
function cndResumeBuild_(ctx) {
  var row = ctx.row, sink = { why: [], degraded: false };
  var ev = cndEvidenceOr_(ctx, sink);
  var a = ev.analysis || {};
  var fid = locationsDriveId_(row.resumeLink) || (/^[A-Za-z0-9_-]{10,}$/.test(str_(a.sourceassetid)) ? str_(a.sourceassetid) : '');
  var stored = cndResumeStored_(a);
  var scored = !!(str_(a.analyzedat) || str_(a.compositescore) || stored.summary);
  var parsed = null;
  if (fid && !(stored.work.length && stored.education.length && stored.skills.length)) {
    try { parsed = cndResumeText_(fid); }
    catch (e) { sink.why.push(cndWhy_('The résumé file', e)); sink.degraded = true; }
    if (parsed && parsed.unreadable) { sink.why.push(parsed.unreadable); parsed = null; }
  }
  var p = parsed || {};
  var wants = str_(p.preferred_location);
  var home = str_(p.home) || stored.home;
  return {
    on_file: !!fid || scored, file_read: !!parsed, analyzed_at: str_(a.analyzedat),
    fields: {
      experience: stored.experience || str_(p.experience),
      availability: stored.availability || str_(p.availability),
      preferred_location: wants || home, preferred_basis: wants ? 'stated' : (home ? 'home' : ''),
      earliest_start: str_(p.earliest_start)
    },
    summary: stored.summary || str_(p.summary),
    work: stored.work.length ? stored.work : (p.work || []),
    education: stored.education.length ? stored.education : (p.education || []),
    certifications: cndResumeUnion_(stored.certifications, p.certifications || []),
    skills: stored.skills.length ? stored.skills : (p.skills || []),
    languages: cndResumeUnion_(stored.languages, p.languages || []),
    analysis: stored.analysis,
    why: sink.why, degraded: sink.degraded
  };
}

function cndResumeDoor_(ctx) {
  return cndServe_('The résumé', function () {
    return cndData_('candidateProfileResume', ctx, function () { return cndResumeBuild_(ctx); });
  });
}

HUB_POLICY.candidateProfileResume = {
  file: 'CandidateProfiles.gs', lane: 'read', store: 'drive',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' } }
};
// Information's résumé: the fields the hiring record lacks and the résumé answers, and its work, schools…
HUB_ACTIONS.candidateProfileResume = function (payload, user) {
  if (!cndWide_(cndViewer_(user))) return candidateProfilesUnknown_();
  var ctx = cndCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  return cndResumeDoor_(ctx);
};

// ---- the note -------------------------------------------------------------

HUB_POLICY.candidateProfileNoteAdd = {
  file: 'CandidateProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' }, body: { type: 'string' } }
};
/** A note on the candidate's hiring journey, the record the Hiring app shows; the filer and the time are the session's. */
HUB_ACTIONS.candidateProfileNoteAdd = function (payload, user) {
  if (!candidateProfilesGate_(user)) return candidateProfilesUnknown_();
  var ctx = cndCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  var body = String((payload && payload.body) || '').trim();
  if (!body) return { status: 400, message: 'body: what the note says.' };
  if (body.length > CND_NOTE_MAX) return { status: 400, message: 'body: up to ' + CND_NOTE_MAX + ' characters.' };
  var held = sheetDbGateHolds_(HIRING_JOURNEY_TAB, 'create');
  if (held) return held.error;
  var by = str_(user && user.email);
  var at = new Date().toISOString();
  var id = journeyLog_({ candidate_id: ctx.key, name: ctx.name, step: 'note', title: 'Note', channel: 'note', ok: true,
                         detail: body, by: by });
  if (!id) return { status: 503, message: 'The note could not be filed on the hiring journey just now — try again in a minute.' };
  ['candidateProfileActivity', 'candidateProfileOverview'].forEach(function (a) { cndBump_(a, ctx.key); });
  hubSysLog_(by, 'candidateProfileNoteAdd', ctx.key, { status: 200 });
  return { status: 200, data: { note: { id: 'jrn_' + id, at: at, by: by, body: body }, candidate: ctx.key } };
};

// ---- a press on a Hiring door ---------------------------------------------

function cndDoorTitle_(action) {
  return CND_DOOR_TITLES[action] || String(action || '');
}

// The door a press names — a checklist step to complete, a stage to move to, a paper to file — found on the…
function cndPressFind_(ctx, press, item) {
  var refuse = function (status, message) { return { refused: { status: status, message: message } }; };
  if (press === 'complete' || press === 'stage') {
    var a = cndActionsBuild_(ctx);
    if (press === 'complete') {
      var hit = a.items.filter(function (i) { return i.id === item; })[0];
      if (!hit) return refuse(400, 'This step is not on ' + ctx.name + '\'s hiring record.');
      if (!hit.open) return refuse(409, hit.label + ' is already complete on the hiring record. Nothing was written.');
      if (!hit.complete) return refuse(409, (hit.complete_why || 'No press here closes this step.') + ' Nothing was written.');
      return { door: hit.complete, ref: 'complete:' + hit.id, detail: hit.label + ' — ' + cndDoorTitle_(hit.complete.action) };
    }
    var to = a.stages.filter(function (s) { return s.id === item; })[0];
    if (!to || to.current) return refuse(400, 'item: a stage the card may move to.');
    if (!to.reachable || !to.door) return refuse(409, (to.why || 'The card may not move there from here.') + ' Nothing was written.');
    return { door: to.door, ref: 'stage:' + to.id, detail: cndStageLabel_(ctx.row.stage) + ' → ' + to.label };
  }
  if (press === 'upload') {
    var doc = cndDocumentsBuild_(ctx).docs.filter(function (d) { return d.id === item; })[0];
    if (!doc) return refuse(400, 'This document is not on ' + ctx.name + '\'s hiring record.');
    if (!doc.upload) {
      return refuse(409, doc.title + (doc.status === 'on_file' ? ' is already on file.' : ' is not filed from here.') +
                         ' Nothing was written.');
    }
    return { door: doc.upload, ref: 'upload:' + doc.id, detail: doc.title };
  }
  return refuse(400, 'press: complete, stage, upload or document.');
}

// The door's own payload as the answer named it, the form fields that door takes, and nothing else; null for a door…
function cndPressPayload_(ctx, door, fields) {
  var takes = CND_DOOR_FIELDS[door.action];
  if (!takes) return null;
  var p = {};
  Object.keys(door.payload || {}).forEach(function (k) { p[k] = door.payload[k]; });
  p.candidate_id = ctx.key;
  var f = fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {};
  Object.keys(takes).forEach(function (k) {
    var v = f[k];
    if (v === undefined || v === null || v === '' || typeof v === 'object') return;
    p[takes[k]] = String(v);
  });
  if (door.action === 'tableDocUpload') {
    p.candidate_name = ctx.name;
    p.email = str_(ctx.row.email);
  }
  return p;
}

/** The Hiring door itself. A decision is its one writer's, handed on exactly as HUB_ACTIONS.setDecision hands it. */
function cndDoorRun_(action, payload, user) {
  if (action === 'setDecision') return hubSetDecision_(payload, user, { attest: true });
  return HUB_ACTIONS[action](payload, user);
}

/** What the door's own answer adds to the line: where the card went (a stage press already says it), or that it stayed. */
function cndPressOutcome_(press, data) {
  var d = data && typeof data === 'object' ? data : {};
  if (d.moved === false && d.stage) return '; the card stays at ' + cndStageLabel_(d.stage);
  if (press === 'stage') return '';
  if (d.moved_to) return '; moved to ' + cndStageLabel_(d.moved_to);
  if (d.moved === true && d.stage) return '; moved to ' + cndStageLabel_(d.stage);
  return '';
}

HUB_POLICY.candidateProfileDoor = {
  // 'tool': the product is the door's own answer — moved, declined, refused and why — never a receipt in its place
  file: 'CandidateProfiles.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  // the doors it presses: a decision, a stage move or a manual onboarding can write the new hire their login
  invalidates: ['candidates', 'phoneScreens', 'onboarding'], emits: ['emailSend'],
  params: { candidate: { type: 'string' }, press: { type: 'string' }, item: { type: 'string' },
            fields: { type: 'object' } }
};
// One Hiring door the candidate's answer names — Mark complete, Update stage, Upload, or Add document once the…
HUB_ACTIONS.candidateProfileDoor = function (payload, user) {
  if (!candidateProfilesGate_(user)) return candidateProfilesUnknown_();
  var ctx = cndCandidate_(payload && payload.candidate);
  if (ctx.refused) return ctx.refused;
  var press = str_(payload.press), item = locationsText_(payload.item, 120);
  if (press === 'document') return cndDocumentDoor_(ctx, item, payload.fields, user);
  var found;
  try { found = cndPressFind_(ctx, press, item); }
  catch (eF) { return { status: 503, message: cndWhy_('The hiring record', eF) + ' Nothing was written.' }; }
  if (found.refused) return found.refused;
  var inner = cndPressPayload_(ctx, found.door, payload.fields);
  if (!inner) return { status: 409, message: 'This screen does not open that door; the Hiring card does.' };
  var held = sheetDbGateHolds_(HIRING_JOURNEY_TAB, 'create');
  if (held) return held.error;
  var gate = null;
  try { gate = hubPolicyGate_(found.door.action, inner, user); }
  catch (eG) { gate = null; }
  if (gate) return gate;
  var by = str_(user && user.email);
  var env;
  try { env = cndDoorRun_(found.door.action, inner, user); }
  catch (e) { env = { status: 500, message: 'Internal error: ' + String((e && e.message) || e).slice(0, 200) }; }
  if (!env || typeof env !== 'object') env = { status: 500, message: 'The Hiring door did not answer.' };
  hubSysLog_(by, found.door.action, ctx.key, env);
  if (Number(env.status) !== 200) return env;
  var detail = found.detail + (press === 'upload' && inner.filename ? ': ' + locationsText_(inner.filename, 120) : '') +
               cndPressOutcome_(press, env.data);
  var title = CND_PRESS_TITLES[press];
  var at = new Date().toISOString();
  var id = journeyLog_({ candidate_id: ctx.key, name: ctx.name, step: CND_PRESS_STEP, title: title, ok: true,
                         detail: detail, ref: found.ref, by: by });
  try { hubBustTalentCache_(); } catch (eB) { /* the row's own clock retires it */ }
  CND_PART_ACTIONS.forEach(function (a) { cndBump_(a, ctx.key); });
  return { status: 200, data: {
    candidate: ctx.key, door: found.door.action, answer: env.data === undefined ? null : cndScrub_(env.data),
    logged: !!id, entry: id ? { id: 'jrn_' + id, at: at, by: by, title: title, body: detail } : null,
    why: id ? '' : 'The Hiring door wrote it, but the press could not be filed on the hiring journey just now.' } };
};

// ---- a step's paper, read before any door takes it ------------------------

// The paper a document press is for, on the candidate's own answer as it stands now: the step, the catalog id, the…
function cndPaperFind_(ctx, itemId, docId) {
  var refuse = function (status, message) { return { refused: { status: status, message: message } }; };
  var hit = cndActionsBuild_(ctx).items.filter(function (i) { return i.id === itemId; })[0];
  if (!hit) return refuse(400, 'This step is not on ' + ctx.name + '\'s hiring record.');
  var paper = hit.paper;
  if (!paper) {
    return refuse(409, hit.label + (CND_STEP_PAPERS[hit.id] && !hit.open ? ' is already complete on the hiring record.'
                                                                       : ' takes no document from here.') +
                       ' Nothing was written.');
  }
  var spec = CND_STEP_PAPERS[hit.id];
  var signed = cndPacketSigned_(ctx.row);
  if (paper.choices.length) {
    var chosen = paper.choices.filter(function (c) { return c.doc_id === docId; })[0];
    if (!chosen) return refuse(400, 'doc: which of the new hire\'s documents this is.');
    return { step: hit, doc_id: chosen.doc_id, label: chosen.label, kinds: CND_PAPER_KINDS[chosen.doc_id] || [],
             pdf: false, word: false, where: paper.where, signed: signed, other: true };
  }
  return { step: hit, doc_id: spec.doc, label: paper.asks, kinds: spec.kinds || CND_PAPER_KINDS[spec.doc] || [],
           pdf: !!spec.pdf, word: !!spec.word, where: paper.where, signed: signed, other: false };
}

// A Word file's type — FAIL-CLOSED as complianceDocsFileType_: the name's extension decides and a type sent must…
function cndWordType_(name, mime) {
  var ext = ((/\.([a-z0-9]+)$/i.exec(str_(name)) || [])[1] || '').toLowerCase();
  var sent = str_(mime).toLowerCase().split(';')[0].trim();
  var own = Object.prototype.hasOwnProperty.call(CND_WORD_TYPES, ext) ? CND_WORD_TYPES[ext] : '';
  if (own) return complianceDocsTypeLoose_(sent) || sent === own ? own : '';
  if (ext) return '';
  return Object.keys(CND_WORD_TYPES).some(function (k) { return CND_WORD_TYPES[k] === sent; }) ? sent : '';
}

// The file a press hands in, as the doors take it — a picture or a PDF up to 15MB, or a Word file where the step's…
function cndPaperFile_(found, f) {
  var no = function (message) { return { refused: { status: 400, message: message + ' Nothing was written.' } }; };
  var name = locationsText_(f.filename, 200) || 'document';
  var mime = complianceDocsFileType_(name, f.mime_type) || (found.word ? cndWordType_(name, f.mime_type) : '');
  if (!mime) return no(found.word ? CND_WORD_TYPE_WORDS : CERT_DOC_TYPE_WORDS);
  if (found.pdf && mime !== 'application/pdf') {
    return no('The Hiring record keeps ' + found.label + ' as a PDF — a PDF of the paper, please.');
  }
  var b64 = typeof f.base64 === 'string' ? f.base64 : '';
  if (!b64) return no('The file is required.');
  // base64 carries 4/3 of the bytes
  if (b64.length > Math.ceil(CERT_DOC_MAX_BYTES / 3) * 4) return no('The file is too large — up to 15MB.');
  return { name: name, mime: mime, b64: b64 };
}

// 'match' when the paper prints the candidate's first and last name together, 'other' when the name it prints is…
function cndNamedIn_(text, seen, who) {
  var t = nameTokens_(who).all;
  if (t.length >= 2) {
    var first = t[0], last = t[t.length - 1];
    var hay = ' ' + nameNorm_(text) + ' ';
    if (new RegExp(' ' + first + '(?: [a-z0-9]{1,20}){0,2} ' + last + ' | ' + last + ' ' + first + ' ').test(hay)) {
      return 'match';
    }
  }
  if (!str_(seen)) return 'unread';
  return nameScore_(seen, who) >= NAME_MATCH_MIN ? 'match' : 'other';
}

// What a background check says, read whole and line by line: one line that reads a record outweighs any line that…
function cndCheckResult_(words) {
  var lines = String(words || '').split(/\n+/);
  for (var i = 0; i < lines.length; i++) {
    if (digestCheckResult_(lines[i]).result === 'records') return 'records';
  }
  return digestCheckResult_(words).result;
}

/** Which of `kinds` the paper's own words carry a word of, under the words book the decoder reads by. */
function cndKindsSeen_(text, kinds) {
  var body = digestPlainDashes_(String(text || '').slice(0, DIGEST_SCAN_CAP).toLowerCase());
  var seen = {};
  digestKinds_().forEach(function (row) {
    if (kinds.indexOf(row[0]) === -1) return;
    if ((row[2] || []).some(function (n) { return !!n && body.indexOf(String(n)) !== -1; })) seen[row[0]] = true;
  });
  return seen;
}

// The decoder's reading of the file — Digest.gs, the engine the Decoder Lab's verdicts come from — under the words…
function cndPaperRead_(found, file, who) {
  var unread = function (paper) { return { paper: paper, named: 'unread', result: '', packet: false }; };
  if (/^image\/hei[cf]$/.test(file.mime)) return unread({ state: 'heic', chars: 0 });
  var text = '';
  try { text = String(digestUploadText_(file.b64, file.mime, file.name) || '').replace(/\n{3,}/g, '\n\n').trim(); }
  catch (e) { return unread({ state: 'error', chars: 0, why: String((e && e.message) || e).slice(0, 160) }); }
  var today = locationsToday_();
  var whole = found.step.id === 'new-hire-packet' && !found.other;
  var got = certReadWithVocab_(found.kinds, function () {
    return { paper: digestPaperFromText_(text, CND_PAPER_UNNAMED, today),
             seen: whole ? cndKindsSeen_(text, [].concat.apply([], CND_PACKET_SHOWS)) : {} };
  });
  var paper = got.paper;
  var words = digestRedact_(text, paper.kind).text;
  return { paper: paper, named: cndNamedIn_(words, paper.person_seen, who),
           result: paper.kind === 'background_check' ? cndCheckResult_(words) : '',
           packet: whole && CND_PACKET_SHOWS.every(function (any) {
             return any.some(function (k) { return got.seen[k] === true; });
           }) };
}

// Whether the reading is the paper the step asks for — pure, FAIL-CLOSED as certReadVerdict_: read, one of the…
function cndPaperVerdict_(found, read, who) {
  var p = (read && read.paper) || {};
  var kind = str_(p.kind);
  var named = str_(read && read.named) || 'unread';
  var out = { verified: false, reason: '', read_as: kind ? cndKindWords_(kind) : '', why: '',
              reading: { state: str_(p.state) || 'error', kind: kind, kind_words: kind ? cndKindWords_(kind) : '',
                         person_seen: str_(p.person_seen), name_check: named,
                         issued_on: complianceDocsDay_(p.issued_on), expires_on: complianceDocsDay_(p.expires_on),
                         result: str_(read && read.result) } };
  var no = function (reason, why) { out.reason = reason; out.why = why; return out; };
  if (p.state === 'heic') return no('unread', 'This photo format cannot be read — a JPG or a PDF of the same paper can.');
  if (p.state === 'error') {
    return no('unread', 'The decoder could not read this file' + (p.why ? ' (' + str_(p.why) + ')' : '') + '. A smaller ' +
                        'scan or a clearer photo of the same paper may read.');
  }
  if (p.state !== 'read' || !Number(p.chars)) return no('unread', CERT_READ_WORDS.empty);
  var kinds = found.kinds || [];
  if (!kinds.length) return no('untaught', 'The decoder is not taught what ' + found.label + ' looks like, so it cannot tell.');
  if (!kind) return no('kind', 'What this paper is could not be told from its words.');
  if (kinds.indexOf(kind) === -1) return no('kind', 'This reads as ' + out.read_as + ' — not ' + found.label + '.');
  if (Number(p.kind_score || 0) < CND_PAPER_FLOOR) {
    return no('faint', 'This reads only faintly as ' + out.read_as + ', so it is not taken as ' + found.label + '.');
  }
  if (named === 'other') return no('person', 'This paper names ' + str_(p.person_seen) + ', not ' + who + '.');
  out.verified = true;
  out.why = named === 'unread' ? 'No name could be read on it.' : '';
  return out;
}

/** The background result on the Hiring record now, in the engine's own words; '' when there is none. Throws unread. */
function cndCjisOnFile_(ctx) {
  var now = str_(((cndEvidence_(ctx) || {}).analysis || {}).cjisstatus).toLowerCase();
  return CND_CJIS_STATUSES.filter(function (s) { return s.toLowerCase() === now; })[0] || '';
}

// The background result a filing keeps when no person picked one — never a Clear the reading made: Disqualified…
function cndCjisKept_(onFile, v, taken) {
  if (onFile === 'Disqualified') return onFile;
  if ((onFile === 'Clear' || onFile === 'Verified') && taken && v.reading.result !== 'records') return onFile;
  return 'Pending';
}

// What the panel pre-selects for the person to confirm or change — a suggestion only: what a filing keeps, else…
function cndCjisSuggested_(onFile, v, taken) {
  var kept = cndCjisKept_(onFile, v, taken);
  if (kept !== 'Pending') return kept;
  return taken && v.reading.name_check === 'match' && v.reading.result === 'clear' ? 'Clear' : 'Pending';
}

// Whether filing the paper closes its step on the Hiring board, and why not: the background check when the result…
function cndPaperCloses_(found, read, taken, status) {
  if (found.other) return { closes: null, why: '' };
  var step = found.step.id;
  if (step === 'cjis') {
    var done = status === 'Clear' || status === 'Verified';
    return { closes: done, why: done ? '' : 'A ' + status + ' background result leaves the step open.' };
  }
  if (step !== 'new-hire-packet') return { closes: true, why: '' };
  if (taken && read.packet) return { closes: true, why: '' };
  return { closes: false,
           why: (taken ? 'It reads as one form of the packet, not the whole signed packet (an offer letter with its ' +
                         'I-9 or W-4)'
                       : 'It is not read as the signed packet') +
                ', so it is deposited in Onboarding Documents and the step stays open until Mark complete says the ' +
                'signed packet is on file.' };
}

// The doors that file the paper, in order.
function cndPaperDoors_(ctx, found, file, v, override, status, closes) {
  var taken = v.verified && !override;
  var said = 'Filed from Staff Candidates' + (v.read_as ? '; read as ' + v.read_as : '') + (override ? '; override' : '');
  var base = function (extra) {
    var p = { candidate_id: ctx.key, filename: file.name, mime_type: file.mime, base64: file.b64,
              candidate_name: ctx.name, email: str_(ctx.row.email) };
    Object.keys(extra).forEach(function (k) { p[k] = extra[k]; });
    return p;
  };
  var dated = function (p) {
    if (taken && v.reading.issued_on) p.issued_on = v.reading.issued_on;
    if (taken && v.reading.expires_on) p.expires_on = v.reading.expires_on;
    p.notes = said;
    return p;
  };
  var step = found.step.id;
  if (found.other) {
    var item = CND_ITEM_OF_DOC[found.doc_id] || found.doc_id;
    // the Hiring table's upload files these two on the Hiring record itself, never in Onboarding Documents
    if (item === 'cjis' || item === 'resume') {
      return [{ action: CND_DEPOSIT_DOOR, payload: dated(base({ doc_id: found.doc_id })) }];
    }
    return [{ action: 'tableDocUpload', payload: dated(base({ item_id: item, doc_id: found.doc_id })) }];
  }
  if (step === 'cjis') {
    var doors = [{ action: 'tableDocUpload', payload: base({ item_id: 'cjis', status: status }) }];
    if (found.signed) doors.push({ action: CND_DEPOSIT_DOOR, payload: dated(base({ doc_id: found.doc_id })) });
    return doors;
  }
  if (step === 'new-hire-packet') {
    var packet = [{ action: 'tableDocUpload', payload: dated(base({ item_id: step, doc_id: found.doc_id })) }];
    if (closes) {
      packet.push({ action: 'packetWaive', fileOf: 0,
                    payload: { candidate_id: ctx.key, note: 'Signed packet filed from Staff Candidates: ' + file.name +
                                                            ' (read as the whole packet: ' + v.read_as + ' and its forms)' } });
    }
    return packet;
  }
  return [{ action: 'tableDocUpload', payload: base({ item_id: step }) }];
}

/** The Drive id a door filed the paper as, off its own answer; '' when it names none. */
function cndFiledId_(env) {
  var d = (env && env.data) || {};
  return str_(d.doc && d.doc.file_id) || locationsDriveId_(d.resume_link || d.cjis_report_url || d.url || '');
}

/** Each door in order, past its own declared gate; the first refusal stops the rest. */
function cndPaperRun_(ctx, doors, user, by) {
  var ran = [];
  for (var i = 0; i < doors.length; i++) {
    var d = doors[i];
    if (d.fileOf !== undefined) {
      var fid = cndFiledId_(ran[d.fileOf] && ran[d.fileOf].env);
      if (fid) d.payload.file_id = fid;
    }
    var env = null;
    try { env = hubPolicyGate_(d.action, d.payload, user); } catch (eG) { env = null; }
    if (!env) {
      try { env = cndDoorRun_(d.action, d.payload, user); }
      catch (e) { env = { status: 500, message: 'Internal error: ' + String((e && e.message) || e).slice(0, 200) }; }
      if (!env || typeof env !== 'object') env = { status: 500, message: 'The Hiring door did not answer.' };
      hubSysLog_(by, d.action, ctx.key, env);
    }
    ran.push({ action: d.action, env: env });
    if (Number(env.status) !== 200) break;
  }
  return ran;
}

// Add document: the step's paper read by the decoder and held against what the step asks for before any door takes…
function cndDocumentDoor_(ctx, itemId, fields, user) {
  var f = fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {};
  var found;
  try { found = cndPaperFind_(ctx, itemId, str_(f.doc)); }
  catch (eF) { return { status: 503, message: cndWhy_('The hiring record', eF) + ' Nothing was written.' }; }
  if (found.refused) return found.refused;
  var file = cndPaperFile_(found, f);
  if (file.refused) return file.refused;
  var cjis = found.step.id === 'cjis' && !found.other;
  var picked = cjis ? str_(f.cjis_status) : '';
  if (picked && CND_CJIS_STATUSES.indexOf(picked) === -1) {
    return { status: 400, message: 'cjis_status: ' + CND_CJIS_STATUSES.join(', ') + '. Nothing was written.' };
  }
  var check = f.check === true;
  if (!check) {
    var held = sheetDbGateHolds_(HIRING_JOURNEY_TAB, 'create');
    if (held) return held.error;
  }
  var onFile = '';
  if (cjis) {
    try { onFile = cndCjisOnFile_(ctx); }
    catch (eE) {
      // a result nobody picked is never written over one that could not be read
      if (!check && !picked) {
        return { status: 503, message: cndWhy_('The background result on file', eE) + ' Pick the result, or try again. ' +
                                       'Nothing was written.' };
      }
    }
  }
  var read = cndPaperRead_(found, file, ctx.name);
  var v = cndPaperVerdict_(found, read, ctx.name);
  var override = f.confirm_mismatch === true && !v.verified;
  var taken = v.verified && !override;
  var status = !cjis ? '' : (check ? cndCjisSuggested_(onFile, v, taken) : (picked || cndCjisKept_(onFile, v, taken)));
  var shut = cndPaperCloses_(found, read, taken, status);
  var answer = { candidate: ctx.key, item: found.step.id, doc_id: found.doc_id, asks: found.label,
                 expects: cndExpects_(found.kinds), where: found.where, file_name: cndScrub_(file.name),
                 verified: v.verified, reason: v.reason, read_as: v.read_as, why: cndScrub_(v.why),
                 reading: cndScrub_(v.reading), cjis_status: status, cjis_on_file: onFile, closes: shut.closes,
                 closes_why: shut.why, check: check, filed: false, override: false };
  if (check) return { status: 200, data: answer };
  if (!v.verified && !override) {
    answer.why = (answer.why ? answer.why + ' ' : '') + 'Nothing was written.';
    return { status: 200, data: answer };
  }
  var by = str_(user && user.email);
  var ran = cndPaperRun_(ctx, cndPaperDoors_(ctx, found, file, v, override, status, shut.closes), user, by);
  if (!ran.length || Number(ran[0].env.status) !== 200) {
    return ran.length ? ran[0].env : { status: 500, message: 'No Hiring door took the paper.' };
  }
  var short = ran.filter(function (r) { return Number(r.env.status) !== 200; })[0] || null;
  var detail = cndScrub_(found.label + ' — ' + file.name + ' (' + (v.read_as ? 'read as ' + v.read_as : 'not read') +
                         (override ? ', override' : '') + ')' + (cjis ? '; background result ' + status : '') +
                         (found.step.id === 'new-hire-packet' && !found.other
                           ? (shut.closes ? '; New Hire packet on file' : '; the step stays open') : ''));
  var at = new Date().toISOString();
  var id = journeyLog_({ candidate_id: ctx.key, name: ctx.name, step: CND_PRESS_STEP, title: CND_PRESS_TITLES.document,
                         ok: true, detail: detail, by: by,
                         ref: 'document:' + found.step.id + (found.other ? ':' + found.doc_id : '') });
  try { hubBustTalentCache_(); } catch (eB) { /* the row's own clock retires it */ }
  CND_PART_ACTIONS.forEach(function (a) { cndBump_(a, ctx.key); });
  answer.filed = true;
  answer.override = override;
  answer.doors = ran.map(function (r) { return { action: r.action, status: Number(r.env.status) || 0 }; });
  answer.logged = !!id;
  answer.entry = id ? { id: 'jrn_' + id, at: at, by: by, title: CND_PRESS_TITLES.document, body: detail } : null;
  answer.filing_why = [
    short ? cndDoorTitle_(short.action) + ' did not take it: ' + cndScrub_(locationsText_(short.env.message, 200)) : '',
    id ? '' : 'The paper was filed, but its line could not be filed on the hiring journey just now.'
  ].filter(String).join(' ');
  return { status: 200, data: answer };
}

// ---- the relay's pack -----------------------------------------------------

/** Each part's door, past its gate, for one candidate. */
function cndPackDoors_(ctx) {
  return {
    overview: function () { return cndOverviewDoor_(ctx); },
    actions: function () { return cndActionsDoor_(ctx); },
    interviews: function () { return cndInterviewsDoor_(ctx); },
    documents: function () { return cndDocumentsDoor_(ctx); },
    activity: function () { return cndActivityDoor_(ctx); },
    texts: function () { return cndTextsDoor_(ctx, {}); },
    transcripts: function () { return cndTranscriptsDoor_(ctx); }
  };
}

// The relay's pack: every section of one candidate, each its own door's answer and cache, the board and the…
HUB_POLICY.candidatePack = {
  file: 'CandidateProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: [],
  params: { candidate: { type: 'string' } }
};
HUB_ACTIONS.candidatePack = function (payload, user) {
  if (!user || !(user.is_service === true || candidateProfilesGate_(user))) return candidateProfilesUnknown_();
  var started = Date.now();
  var held = CND_MEMO_;
  CND_MEMO_ = {};
  try {
    var ctx = cndCandidate_(payload && payload.candidate);
    if (ctx.refused) return ctx.refused;
    var doors = cndPackDoors_(ctx);
    var parts = {}, status = {};
    CND_PACK_PARTS.forEach(function (name) {
      if (Date.now() - started > CND_PACK_BUDGET_MS) {
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
    CND_MEMO_ = held;
  }
};
