var TALENT_SHEET_ID = hubId_('HUB_DB_ID');
var TALENT_CANDIDATES_TAB = 'entity_candidates';
var TALENT_RESUME_TAB = 'entity_resume_analyses';
var TALENT_PHONE_TAB = 'entity_phone_screens';
// `internal-docs` is a checklist line, not a stage; old statuses read through the aliases in talentStage_.
var TALENT_STAGE_ORDER = ['new', 'phone-screen', 'interview', 'onboarding', 'hired', 'ready'];

var TALENT_TERMINAL_STATUS = ['not hiring'];

function talentTerminal_(status) {
  return TALENT_TERMINAL_STATUS.indexOf(str_(status).toLowerCase()) !== -1;
}
// Test rows kept off the board.
var TALENT_EXCLUDE_IDS = [
  'CAN_7DF46D98345D8F032F02',
  'CAN_24A360F6398D5015B3CD'
];

// Company lines are never identity; the literal floor answers when LineDirectory.gs cannot be reached.
var SHARED_LINE_DIGITS = ['3307544040', '3309195558', '3309195559'];
var TALENT_CACHE_KEY = 'hub_talent_candidates_v1';
// A miss reads four full tabs; every write busts the cache, so the TTL is only a ceiling.
var TALENT_CACHE_SECONDS = 600;

// Must match the slice's roles; the INTERVIEWER badge counts as the role.
function talentLiveAllowed_(user) {
  if (!user) return false;
  if (user.is_service) return true;
  if (['admin', 'director', 'manager', 'interviewer'].indexOf(str_(user.role)) !== -1) return true;
  if (typeof userTypesCanInterview_ === 'function' &&
      userTypesCanInterview_(str_(user.types))) return true;
  return false;
}

function talentRoute_(action, payload, user) {
  // `undefined` is an older two-argument caller and is allowed; null is refused.
  if (user !== undefined && !talentLiveAllowed_(user)) {
    return { status: 403, message: bookText_('Strings', 'refuse.talent.not_team', '') };
  }
  switch (action) {
    case 'list':
      return { status: 200, data: talentCandidates_() };
    case 'get': {
      var id = payload && payload.id;
      var rows = talentCandidates_();
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].id === id) return { status: 200, data: rows[i] };
      }
      return { status: 404, message: hiringRenderMail_(
        bookText_('Strings', 'refuse.talent.no_record', ''), { id: id }) };
    }
    case 'create':
    case 'update':
    case 'delete':
      return { status: 405, message: bookText_('Strings', 'refuse.talent.read_only', '') };
    default:
      return { status: 400, message: hiringRenderMail_(
        bookText_('Strings', 'refuse.talent.unknown_action', ''), { action: action }) };
  }
}

function talentCandidates_() {
  var hit = CacheService.getScriptCache().get(TALENT_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  var out = talentCandidatesRead_();
  // The graduation clock rides read traffic.
  try { hubHiredSweepMaybe_(); } catch (eSweep) {}
  return out;
}

// No sweep rider: a profile click must send nothing.
function talentCandidatesRead_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(TALENT_CACHE_KEY);
  if (hit) return JSON.parse(hit);

  var ss = ssOpen_(TALENT_SHEET_ID);
  var cands = readTabNormalized_(ss, TALENT_CANDIDATES_TAB);
  var analyses = readTabNormalized_(ss, TALENT_RESUME_TAB);
  var screens = readTabNormalized_(ss, TALENT_PHONE_TAB);

  var analysisByCandidate = {};
  analyses.forEach(function (a) {
    var cid = str_(a.candidateid);
    if (cid) analysisByCandidate[cid] = a;
  });
  var screenByCandidate = {};
  screens.forEach(function (s) {
    var cid = str_(s.candidateid);
    if (cid) screenByCandidate[cid] = s;
  });

  // Ask the router, never this workbook: the replies tab left HUB_DB.
  var replyByCandidate = {};
  try {
    if (typeof INBOUND_TAB !== 'undefined' && hubTabSheet_(INBOUND_TAB)) {
      readTabNormalized_(ss, INBOUND_TAB).forEach(function (m) {
        var cid = str_(m.candidateid);
        if (!cid || str_(m.intent) !== 'reply') return;
        var prev = replyByCandidate[cid];
        var at = str_(m.receivedat);
        if (!prev) prev = replyByCandidate[cid] = { at: '', body: '', unread: 0 };
        if (!str_(m.seenat)) prev.unread++;
        if (at >= prev.at) { prev.at = at; prev.body = str_(m.body); }
      });
    }
  } catch (eIn) { replyByCandidate = {}; }

  // Files actually on this platform, which a `done` checklist item does not imply.
  var docsByCandidate = {};
  try {
    if (typeof DOCS_TAB !== 'undefined' && hubTabSheet_(DOCS_TAB)) {
      readTabNormalized_(ss, DOCS_TAB).forEach(function (d) {
        var cid = str_(d.candidateid);
        var doc = str_(d.docid);
        if (!cid || !doc) return;
        if (str_(d.supersededby)) return;
        var st = str_(d.status).toLowerCase();
        if (st !== 'uploaded' && st !== 'verified') return;
        if (!str_(d.fileurl)) return;
        (docsByCandidate[cid] = docsByCandidate[cid] || []).push(doc);
      });
    }
  } catch (eDocs) { docsByCandidate = {}; }

  var sinceByCandidate = talentStageArrivals_(ss);

  // Read once and handed to packetState_, which otherwise re-reads the whole mirror per card.
  var recruitRows = [];
  try { if (typeof packetMirrorRows_ === 'function') recruitRows = packetMirrorRows_(); }
  catch (eRec) { recruitRows = []; }

  var parkedByCandidate = {};
  try {
    if (typeof simAskRows_ === 'function') {
      simAskRows_().forEach(function (a) {
        if (str_(a.step) !== 'ready_parked') return;
        var pid = str_(a.candidateid);
        if (!pid) return;
        parkedByCandidate[pid] = {                      // last row wins
          notices: parseInt(str_(a.sentcount), 10) || 0,
          of: parseInt(str_(a.maxattempts), 10) || 0,
          lastAt: str_(a.lastsentat),
          openedAt: str_(a.createdat)
        };
      });
    }
  } catch (eParked) { parkedByCandidate = {}; }

  var out = [];
  cands.forEach(function (c) {
    var id = str_(c.candidateid);
    if (!id) return;
    if (TALENT_EXCLUDE_IDS.indexOf(id) !== -1) return;
    if (str_(c.archived).toLowerCase() === 'true') return;
    var stage = talentStage_(c.status);
    if (!stage) return;
    var arrival = (sinceByCandidate[id] || {})[stage] || '';
    // Notices from a previous stay at this stage do not count toward this one.
    var park = parkedByCandidate[id] || null;
    if (park && arrival && str_(park.openedAt) < arrival) park = null;
    out.push(talentRecord_(c, analysisByCandidate[id] || {}, screenByCandidate[id] || null,
                           stage, replyByCandidate[id] || null, docsByCandidate[id] || [],
                           arrival, park, recruitRows));
  });

  cache.put(TALENT_CACHE_KEY, JSON.stringify(out), TALENT_CACHE_SECONDS);
  return out;
}

// One reader for the board and the parking machine; blank is legal, never guessed from updated_at.
function talentStageArrivals_(ss) {
  var out = {};
  try {
    // Existence via the router (the tab left HUB_DB); the read below routes to the house itself.
    if (!hubTabSheet_('log_status_history')) return out;
    readTabNormalized_(ss, 'log_status_history').forEach(function (h) {
      var hid = str_(h.candidateid);
      var to = talentStage_(str_(h.tostatus));
      var at = str_(h.timestamp);
      if (!hid || !to || !at) return;
      var slot = out[hid] = out[hid] || {};
      // The latest arrival wins: a person who moved back and forward stands there since the second time.
      if (!slot[to] || at > slot[to]) slot[to] = at;
    });
  } catch (e) { return {}; }
  return out;
}

function readTabNormalized_(ss, tabName) {
  try { depNote_(ss.getId(), tabName); } catch (eDep) {}
  // The dissolved declaration is the gate, never the presence of facts: an archive must not outvote a live tab.
  var rebuilt = (typeof hiringTabDissolved_ === 'function' &&
                 hiringTabDissolved_(tabName) &&
                 typeof hiringLegacyRows_ === 'function')
    ? hiringLegacyRows_(tabName) : null;
  if (rebuilt) return rebuilt;
  var sheet = null;
  if (String(ss.getId()) === String(hubId_('HUB_DB_ID')) &&
      typeof houseSheetFor_ === 'function') {
    sheet = houseSheetFor_(tabName);
  }
  // Not getSheetByName: a converted house keeps its rows under the matrix name.
  if (!sheet) sheet = (typeof hubHouseTabIn_ === 'function')
    ? hubHouseTabIn_(ss, tabName) : ss.getSheetByName(tabName);
  if (!sheet) throw new Error('Talent tab missing: ' + tabName);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0].map(normKey_);
  var isHubDb = String(ss.getId()) === String(hubId_('HUB_DB_ID'));
  var tz = null;
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var line = values[r];
    var empty = true;
    for (var e = 0; e < line.length; e++) {
      if (line[e] !== '' && line[e] !== null) { empty = false; break; }
    }
    if (empty) continue;
    var obj = {};
    for (var c = 0; c < header.length; c++) {
      if (!header[c]) continue;
      var v = line[c];
      if (v instanceof Date) {
        // toISOString() throws on an invalid Date; one bad cell must not sink the tab.
        if (isNaN(v.getTime())) {
          v = '';
        } else if (isHubDb) {
          var t = cellText_(v);
          v = (t === null ? '' : t);
        } else {
          if (tz === null) tz = ss.getSpreadsheetTimeZone();
          v = estateCell_(v, tz);
        }
      }
      obj[header[c]] = v;
    }
    rows.push(obj);
  }
  return rows;
}

function normKey_(h) {
  return String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function str_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function talentDbStr_(v) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    var t = cellText_(v);
    return t === null ? '' : t;
  }
  return str_(v);
}

// An unmapped status silently drops the card: add aliases, never remove them.
function talentStage_(status) {
  var map = {
    'new': 'new',
    'phone screen': 'phone-screen',
    'phone-screen': 'phone-screen',
    'in person': 'interview',
    'interview': 'interview',
    'onboarding': 'onboarding',
    'ready': 'ready',
    'ready to start': 'ready',
    'hired': 'hired',
    // Merged stages: rows still carry these statuses, so never delete them.
    'becoming staff': 'hired',
    'becoming-staff': 'hired',
    'minimal internal documentation ready': 'hired',
    'internal-docs': 'hired'
  };
  return map[str_(status).toLowerCase()] || null;
}

function talentRecord_(c, a, ps, stage, reply, docsOnFile, stageSince, parked, recruitRows) {
  var id = str_(c.candidateid);
  var name = str_(c.candidatename) ||
    (str_(c.firstname) + ' ' + str_(c.lastname)).trim() || id;
  var createdAt = str_(c.createdat);
  var updatedAt = str_(c.updatedat);
  var score = parseFloat(str_(c.score));
  var owner = str_(c.assignedto);
  // Worked out once here so board and drawer never disagree.
  var urg = { level: 'none', why: '', source: '' };
  try {
    if (typeof hubCardUrgency_ === 'function') urg = hubCardUrgency_(c) || urg;
  } catch (eU) {}
  var pk = null;
  if (typeof packetState_ === 'function') {
    try { pk = packetState_(c, recruitRows || null); } catch (eP) { /* the card still draws */ }
  }
  var app = null;
  if (typeof applicationFor_ === 'function') {
    try { app = applicationFor_(c, recruitRows || [], pk); } catch (eA) { app = null; }
  }
  return {
    id: id,
    name: name,
    urgency: urg.level,
    urgencyWhy: urg.why,
    urgencySource: urg.source || '',
    onboardingWindow: (function () {
      if (stage !== 'onboarding' || typeof obOnboardingWindow_ !== 'function') return null;
      try {
        var w = obOnboardingWindow_(c);
        if (w.open && !str_(w.until)) return null;
        return { open: w.open !== false, until: str_(w.until),
                 reason: str_(w.reason), anchored_on: str_(w.anchored_on) };
      } catch (eW) { return null; }
    })(),
    role: 'Direct Support Professional',
    // Empty on purpose: Avatar then draws initials, never an icon.
    avatar: '',
    stage: stage,
    source: talentSource_(c),
    docsOnFile: docsOnFile || [],
    referralName: str_(c.referralname) || talentReferrerFromSource_(str_(c.source)),
    referralPhone: str_(c.referralphone),
    addedBy: str_(c.createdby),
    daysInStage: daysSince_(stage === 'new' ? createdAt : (updatedAt || createdAt)),
    // Not daysInStage, which counts from the row's last touch; use this for "since when".
    stageSince: str_(stageSince),
    daysAtStage: str_(stageSince) ? daysSince_(str_(stageSince)) : null,
    parked: parked ? { notices: parked.notices || 0, of: parked.of || 0,
                       lastAt: str_(parked.lastAt) } : null,
    score: isNaN(score) ? null : Math.max(0, Math.min(5, Math.round(score / 2))),
    appliedAt: createdAt,
    email: str_(c.email),
    phone: str_(c.phone),
    city: str_(c.city),
    state: str_(c.state),
    owner: owner,
    ownerAvatar: '',          // the recruiter is a person too — same rule
    resumeLink: str_(c.resumelink),
    resumeFileLabel: str_(c.resumelink) ? 'Open resume' : '',
    tpCandidateId: str_(c.tpcandidateid),
    // Informational only, never a gate.
    resumeScorecard: (function () {
      var n = parseFloat(str_(a.compositescore));
      return isNaN(n) ? null : n;
    })(),
    summary: str_(a.summary),
    summaryTimeline: talentTimeline_(c, a, ps),
    // Machine dates so nothing parses the timeline's wording; the verdict stays verbatim (three answers).
    screenDate: ps ? talentIsoDay_(ps.screendate) : '',
    screenResult: ps ? str_(ps.finalresult) : '',
    screenStatus: ps ? str_(ps.screenstatus) : '',
    // The signing day, not packet_checked_at; often legitimately empty.
    packetSignedAt: pk ? talentIsoDay_(pk.signed) : '',
    application: app || null,
    checklist: talentChecklist_(c, a, ps, stage, app),
    packet: (pk && typeof packetChip_ === 'function') ? packetChip_(pk.state) : null,
    // 'left_alone' stays its own state: a human had already started the row.
    internalDocs: (function () {
      var at = str_(c.internaldocsat), note = str_(c.internaldocsnote);
      if (!at) return { state: 'pending', note: '', at: '' };
      var low = note.toLowerCase();
      var state = low.indexOf('left alone') === 0 ? 'left_alone'
                : low.indexOf('not filled') === 0 ? 'failed' : 'filled';
      return { state: state, note: note, at: at };
    })(),
    packetHold: (typeof packetHold_ === 'function')
      ? (function () { try { return packetHold_(c); } catch (eH) { return null; } })()
      : null,
    // null, never {}, when they have never written back.
    lastReply: reply && reply.at
      ? { at: reply.at, body: reply.body, unread: reply.unread }
      : null,
    optedOut: (typeof optOutIsSuppressed_ === 'function')
      ? (function () { try { return optOutIsSuppressed_(str_(c.phone)) || ''; } catch (eB) { return ''; } })()
      : ''
  };
}

function talentSource_(c) {
  var explicit = str_(c.source);
  if (explicit) return explicit;
  var email = str_(c.email).toLowerCase();
  var createdBy = str_(c.createdby).toLowerCase();
  if (email.indexOf('@lead.asalifecare.com') !== -1 || createdBy.indexOf('sweep') !== -1) return 'SMS';
  return 'Direct';
}

/** Admin door for tests: edit a candidate's parameters from the pipeline drawer. */
HUB_POLICY.candidateEdit = {
  file: 'Talent.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: ['candidates'], emits: []
};
HUB_ACTIONS.candidateEdit = function (payload, user) {
  if (!user || user.role !== 'admin') return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: bookText_('Strings', 'refuse.candidate_id', '') };
  var allowed = {
    email: 'email', phone: 'phone',
    first_name: 'firstname', last_name: 'lastname',
    source: 'source', applied_at: 'createdat',
    city: 'city', state: 'state'
  };
  // The runtime shim first: a dissolved tab opened by name is null.
  var sheet = (typeof runtimeSheetFor_ === 'function' && runtimeSheetFor_(TALENT_CANDIDATES_TAB)) ||
              ssOpen_(TALENT_SHEET_ID).getSheetByName(TALENT_CANDIDATES_TAB);
  if (!sheet) return { status: 500, message: bookText_('Strings', 'refuse.talent.tab_missing', '') };
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('candidateid');
  if (iId === -1) return { status: 500, message: bookText_('Strings', 'refuse.talent.no_id_column', '') };
  if (payload.source !== undefined && hdr.indexOf('source') === -1) {
    sheet.getRange(1, sheet.getLastColumn() + 1).setValue('source');
    hdr.push('source');
  }
  for (var r = 1; r < values.length; r++) {
    if (talentDbStr_(values[r][iId]) !== cid) continue;
    // The intake collision rule guards edits too, measured against what the row will become.
    if (payload.phone !== undefined || payload.email !== undefined) {
      var colOf_ = function (key) { var i = hdr.indexOf(key); return i === -1 ? '' : talentDbStr_(values[r][i]); };
      var newPhone = payload.phone !== undefined ? str_(payload.phone) : colOf_('phone');
      var newEmail = payload.email !== undefined ? str_(payload.email) : colOf_('email');
      var editName = str_(payload.first_name || '') || colOf_('firstname');
      editName = (editName + ' ' + (str_(payload.last_name || '') || colOf_('lastname'))).trim() ||
                 colOf_('candidatename');
      var eGuard = contactGuard_(newPhone, newEmail,
        { self_candidate_id: cid, name: editName, trusted: true });
      if (eGuard && eGuard.severity !== 'warn' && cgEnforces_('auth')) {
        if (eGuard.severity === 'unverified') {
          return { status: 503, message: contactGuardMessage_(eGuard) };
        }
        if (!cgOverrideAllowed_(user, payload)) {
          return { status: 409, message: contactGuardMessage_(eGuard), staff_conflict: true };
        }
        cgLogOverride_(user, payload, editName, eGuard);
      }
    }
    var changed = [];
    for (var k in allowed) {
      if (payload[k] === undefined) continue;
      var col = hdr.indexOf(allowed[k]);
      if (col === -1) continue;
      sheet.getRange(r + 1, col + 1).setValue(str_(payload[k]).slice(0, 200));
      changed.push(k);
    }
    if (!changed.length) return { status: 400, message: bookText_('Strings', 'refuse.talent.nothing_to_change', '') };
    // Screens read candidate_name, so a first/last rename recomposes it.
    if (payload.first_name !== undefined || payload.last_name !== undefined) {
      var iFn = hdr.indexOf('firstname');
      var iLn = hdr.indexOf('lastname');
      var iNm = hdr.indexOf('candidatename');
      if (iNm !== -1) {
        var fn = payload.first_name !== undefined ? str_(payload.first_name)
          : (iFn !== -1 ? talentDbStr_(values[r][iFn]) : '');
        var ln = payload.last_name !== undefined ? str_(payload.last_name)
          : (iLn !== -1 ? talentDbStr_(values[r][iLn]) : '');
        var full = (fn + ' ' + ln).replace(/\s+/g, ' ').trim();
        if (full) {
          sheet.getRange(r + 1, iNm + 1).setValue(full.slice(0, 200));
          changed.push('candidate_name');
        }
      }
    }
    var iUpd = hdr.indexOf('updatedat');
    if (iUpd !== -1) sheet.getRange(r + 1, iUpd + 1).setValue(new Date().toISOString());
    var iBy = hdr.indexOf('updatedby');
    if (iBy !== -1) sheet.getRange(r + 1, iBy + 1).setValue('candidate-edit:' + str_(user.email));
    hubBustTalentCache_();
    hubSysLog_(user && user.email, 'candidate_edit', cid + ' — ' + changed.join(', '), { status: 200 });
    return { status: 200, data: { id: cid, changed: changed } };
  }
  return { status: 404, message: hiringRenderMail_(
    bookText_('Strings', 'refuse.no_candidate', ''), { id: cid }) };
};

function daysSince_(iso) {
  if (!iso) return 0;
  var t = new Date(iso).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function hashCode_(s) {
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Ids and statuses are protocol the SPA compares; only the sentences come from the book.
function cpWord_(key) { return bookText_('Strings', 'checkpoint.' + key, ''); }
function cpOwner_(key) { return bookText_('Strings', 'owner.' + key, ''); }

function talentChecklist_(c, a, ps, stage, app) {
  var resumeOnFile = !!(str_(c.resumelink) || str_(a.analyzedat) || str_(a.compositescore) || str_(a.summary));
  var cjis = str_(a.cjisstatus).toLowerCase();
  var cjisReport = str_(a.cjisreporturl);
  var decision = str_(a.decisionstatus).toLowerCase();
  // Vocabulary must stay exact: cjis Clear/Verified and decision/final_result Advance are the engine's gates.
  var items = [];
  // No application envelope, no item: many cards never had one to sign.
  if (app && app.srid) {
    items.push({ id: 'application', label: cpWord_('application'),
      owner: cpOwner_('candidate'), stage: 'new',
                 status: str_(app.status).toLowerCase() === 'signed' ? 'done'
                       : (str_(app.status).toLowerCase() === 'declined' ? 'missing' : 'pending') });
  }
  items = items.concat([
    // Non-blocking: still reads 'missing', but no gate waits for it.
    { id: 'resume', label: cpWord_('resume'), owner: cpOwner_('candidate'), stage: 'new', upload: true,
      status: resumeOnFile ? 'done' : 'missing' },
    // 'done' only per hubCjisCleared_; a decider's YES shows as pending. Non-blocking either way.
    { id: 'cjis', label: cpWord_('cjis'), owner: cpOwner_('hr'), stage: 'new', upload: true,
      status: hubCjisCleared_(a) ? 'done'
            : ((cjis === 'clear' || cjis === 'verified' || cjis === 'on file' || cjisReport) ? 'pending' : 'missing') },
    { id: 'resume-decision', label: cpWord_('resume_decision'), owner: cpOwner_('recruiter'), stage: 'new',
      status: decision === 'advance' ? 'done' : 'pending' }
  ]);

  if (TALENT_STAGE_ORDER.indexOf(stage) >= TALENT_STAGE_ORDER.indexOf('phone-screen')) {
    var s = ps || {};
    var completed = str_(s.screenstatus).toLowerCase() === 'completed';
    var finalResult = str_(s.finalresult).toLowerCase();
    // A manual screen counts as done for every evidence checkpoint.
    var manualScreen = str_(s.manualscreen).toLowerCase() === 'true';
    items.push(
      { id: 'transcript', label: cpWord_('transcript'), owner: cpOwner_('auto'), stage: 'phone-screen',
        status: manualScreen ? 'done' : (str_(s.transcripturl) || str_(s.transcripttext)) ? 'auto' : 'pending' },
      // The analysis is the checkpoint, not the best-effort Drive doc.
      { id: 'ai-report', label: cpWord_('ai_report'), owner: cpOwner_('auto'), stage: 'phone-screen',
        status: manualScreen ? 'done' : (str_(s.phonescreenreporturl) || str_(s.screenscore)) ? 'auto' : 'pending' },
      { id: 'screen-details', label: cpWord_('screen_details'), owner: cpOwner_('recruiter'), stage: 'phone-screen',
        status: manualScreen || completed ? 'done' : 'pending' },
      // Never implied by the call happening: hubGate_ requires it to reach Interview.
      { id: 'advance-decision', label: cpWord_('advance_decision'), owner: cpOwner_('recruiter'), stage: 'phone-screen',
        status: finalResult === 'advance' ? 'done' : 'pending' }
    );
  }

  if (TALENT_STAGE_ORDER.indexOf(stage) >= TALENT_STAGE_ORDER.indexOf('interview')) {
    var iv = interviewFor_(str_(c.candidateid)) || {};
    var rec = str_(iv.recommendation).toLowerCase();
    items.push(
      { id: 'interview-scheduled', label: cpWord_('interview_scheduled'),
        owner: cpOwner_('recruiter'), stage: 'interview',
        status: str_(iv.scheduledfor) ? 'done' : 'pending' },
      { id: 'interview-scorecard', label: cpWord_('interview_scorecard'),
        owner: cpOwner_('interviewer'), stage: 'interview',
        status: interviewScored_(iv) ? 'done' : 'pending' },
      { id: 'interview-recommendation', label: cpWord_('interview_recommendation'),
        owner: cpOwner_('interviewer'), stage: 'interview',
        status: rec === 'advance' ? 'done' : 'pending' }
    );
  }
  if (TALENT_STAGE_ORDER.indexOf(stage) >= TALENT_STAGE_ORDER.indexOf('onboarding') &&
      typeof packetState_ === 'function') {
    var pk = null;
    try { pk = packetState_(c); } catch (ePk) { pk = null; }
    if (pk) {
      // 'missing' only for an envelope that exists unsigned; not finding it is not their debt.
      var pkStatus = (pk.state === 'signed' || pk.state === 'waived') ? 'done'
        : (pk.state === 'unsigned' ? 'missing' : 'pending');
      var pkLabel = cpWord_('packet');
      if (pk.state === 'signed') pkLabel += cpWord_('packet.signed');
      else if (pk.state === 'waived') {
        pkLabel += cpWord_('packet.on_file') +
          (pk.waived_by ? ' (' + str_(pk.waived_by).split(' — ')[0] + ')' : '');
      } else if (pk.state === 'unsigned') pkLabel += cpWord_('packet.unsigned');
      else if (pk.state === 'ambiguous') pkLabel += cpWord_('packet.ambiguous');
      else pkLabel += cpWord_('packet.not_found');
      var hold = (typeof packetHold_ === 'function') ? packetHold_(c) : null;
      if (hold && pkStatus !== 'done') {
        pkLabel = cpWord_(hold.escalate ? 'packet.held_late' : 'packet.held');
        pkStatus = 'missing';
      }
      items.push({
        id: 'new-hire-packet', label: pkLabel, owner: cpOwner_('hr'), stage: 'onboarding',
        status: pkStatus, packetState: pk.state,
        packetHold: hold ? hold.phase : ''
      });
    }

    if (typeof hubOnboardingDone_ === 'function') {
      var ob = null;
      try { ob = hubOnboardingDone_(c); } catch (eOb) { ob = null; }
      // hubOnboardingDone_ answers ok on an unreadable tab, so that case stays silent.
      if (ob && !ob.unreadable) {
        var left = [];
        if (!ob.q) left.push(cpWord_('onboarding.questionnaire'));
        if (!ob.t) left.push(cpWord_('onboarding.tutorials'));
        items.push({
          id: 'onboarding-complete', stage: 'onboarding', owner: cpOwner_('candidate'),
          label: ob.ok
            ? cpWord_('onboarding.done') + (ob.how === 'manual' ? cpWord_('onboarding.manual') : '')
            : cpWord_('onboarding.open') + (left.length ? ' (' + left.join(', ') + ')' : ''),
          status: ob.ok ? 'done' : 'pending'
        });
      }
    }
  }

  // Graduation: three steps that fail independently, and one never retries.
  if (stage === 'hired') {
    var held = str_(c.graduationheld);
    var acct = str_(c.staffuserid);
    items.push({
      id: 'staff-account', owner: cpOwner_('auto'), stage: 'hired',
      label: held ? hiringRenderMail_(cpWord_('account.held'), { why: held })
           : acct ? cpWord_('account.created')
                  : cpWord_('account.creating'),
      // A held graduation never finishes on its own, so it reads 'missing'.
      status: held ? 'missing' : (acct ? 'done' : 'pending')
    });
    // hubHiredGraduate_ writes no passhash: nobody can sign in until an admin sets a password.
    if (acct) {
      var armed = str_(c.staffuserarmed).toLowerCase() === 'true';
      items.push({
        id: 'staff-account-armed', owner: cpOwner_('hr'), stage: 'hired',
        label: cpWord_(armed ? 'signin.armed' : 'signin.no_password'),
        status: armed ? 'done' : 'missing'
      });
    }
    var idAt = str_(c.internaldocsat), idNote = str_(c.internaldocsnote);
    var idLow = idNote.toLowerCase();
    items.push({
      id: 'internal-docs-fill',
      label: !idAt ? cpWord_('empdb.filling')
           : idLow.indexOf('left alone') === 0 ? cpWord_('empdb.taken')
           : idLow.indexOf('not filled') === 0
               ? hiringRenderMail_(cpWord_('empdb.failed'), { why: idNote.slice(0, 120) })
           : cpWord_('empdb.on_file'),
      owner: cpOwner_('hr'), stage: 'hired',
      // A failed fill is never retried, so it reads 'missing', not 'pending'.
      status: !idAt ? 'pending'
            : idLow.indexOf('not filled') === 0 ? 'missing'
            : idLow.indexOf('left alone') === 0 ? 'auto' : 'done'
    });
  }

  var fastAt = str_(c.fastlaneat);
  if (fastAt) {
    var cut = TALENT_STAGE_ORDER.indexOf(fastAt);
    var byWhom = str_(c.fastlaneby).split(' at ')[0];
    if (cut > 0) {
      items.forEach(function (it) {
        var at = TALENT_STAGE_ORDER.indexOf(str_(it.stage));
        if (at === -1 || at >= cut) return;
        if (it.status === 'done' || it.status === 'auto') return;
        it.status = 'auto';
        it.label = it.label + hiringRenderMail_(cpWord_('skipped'),
          { stage: HUB_STAGE_TO_STATUS[fastAt] || fastAt });
        it.skippedBy = byWhom;
      });
    }
  }

  return hiringChecklistRide_(items, { cand: c, analysis: a, screen: ps, app: app }, stage);
}

var HUB_TZ_CACHE = null;

function hubTzUsable_(tz) {
  if (!tz) return false;
  try { Utilities.formatDate(new Date(), tz, 'yyyy'); return true; }
  catch (e) { return false; }
}

// Pinned, never discovered: the spreadsheet's Etc/GMT would print every label in UTC.
function hubSheetTz_() { return 'America/New_York'; }

var HUB_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Built from the digits: parsing a bare day makes UTC midnight, printed a day early here.
function hubDayOnlyLabel_(v) {
  if (v === null || v === undefined) return '';
  var s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  var m = Number(s.slice(5, 7));
  var d = Number(s.slice(8, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) return '';
  return HUB_MONTH_NAMES[m - 1] + ' ' + d + ', ' + Number(s.slice(0, 4));
}

function hubWhenLabel_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var dayOnly = hubDayOnlyLabel_(v);
  if (dayOnly) return dayOnly;
  var d = (v instanceof Date) ? v : new Date(String(v));
  if (isNaN(d.getTime())) return String(v);
  var tz = hubSheetTz_();
  var time = Utilities.formatDate(d, tz, 'HH:mm');
  return time === '00:00'
    ? Utilities.formatDate(d, tz, 'MMM d, yyyy')
    : Utilities.formatDate(d, tz, 'MMM d, yyyy') + ' · ' + Utilities.formatDate(d, tz, 'h:mm a');
}

function hubDayLabel_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var dayOnly = hubDayOnlyLabel_(v);
  if (dayOnly) return dayOnly;
  var d = (v instanceof Date) ? v : new Date(String(v));
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  return Utilities.formatDate(d, hubSheetTz_(), 'MMM d, yyyy');
}

// A bare day is returned untouched; only a value with a clock is resolved in the pinned zone.
function talentIsoDay_(v) {
  if (v === null || v === undefined) return '';
  var s = String(v).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var d = (v instanceof Date) ? v : new Date(s);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, hubSheetTz_(), 'yyyy-MM-dd');
}

function talentTimeline_(c, a, ps) {
  var entries = [];
  entries.push({
    time: hubDayLabel_(c.createdat),
    text: 'Applied via ' + talentSource_(c),
    tint: 'blue'
  });
  var summary = str_(a.summary);
  if (summary) {
    entries.push({
      time: 'Resume analysis',
      text: summary.length > 420 ? summary.slice(0, 420) + '…' : summary,
      tint: 'lavender'
    });
  }
  var cjis = str_(a.cjisstatus);
  if (cjis) {
    entries.push({ time: 'CJIS', text: 'Background result: ' + cjis, tint: 'amber' });
  }
  var decision = str_(a.decisionstatus);
  if (decision) {
    entries.push({ time: 'Resume decision', text: decision, tint: 'mint' });
  }
  if (ps) {
    var bits = [];
    if (str_(ps.screenstatus)) bits.push(str_(ps.screenstatus));
    if (str_(ps.bestinpersondaytime)) bits.push('in-person ' + hubWhenLabel_(ps.bestinpersondaytime));
    if (str_(ps.finalresult)) bits.push('decision: ' + str_(ps.finalresult));
    entries.push({
      time: 'Phone screen' + (str_(ps.screendate) ? ' · ' + hubDayLabel_(ps.screendate) : ''),
      text: bits.length ? bits.join(' · ') : 'Screening opened',
      tint: 'peach'
    });
  }
  return entries;
}

// Archived, never deleted.
HUB_POLICY.talentArchive = {
  file: 'Talent.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['candidates'], emits: []
};
HUB_ACTIONS.talentArchive = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var ids = payload && payload.candidate_ids;
  if (!ids || !ids.length) return { status: 400, message: bookText_('Strings', 'refuse.talent.pick_one', '') };
  if (ids.length > 200) return { status: 400, message: bookText_('Strings', 'refuse.talent.too_many', '') };
  var hide = payload.archived !== false;

  var sheet = hubSheet_(TALENT_CANDIDATES_TAB);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var iId = hdr.indexOf('candidate_id');
  if (iId === -1) return { status: 500, message: bookText_('Strings', 'refuse.talent.no_id_column', '') };
  ensureHeader_(sheet, ['archived', 'archived_at', 'archived_by', 'archived_reason']);
  hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });

  var wanted = {};
  for (var k = 0; k < ids.length; k++) wanted[String(ids[k]).trim()] = true;
  var now = new Date().toISOString();
  var reason = str_(payload.reason).slice(0, 200);
  var done = 0;

  for (var r = 1; r < values.length; r++) {
    if (!wanted[String(values[r][iId]).trim()]) continue;
    var row = r + 1;
    var put = function (col, v) {
      var i = hdr.indexOf(col);
      if (i !== -1) sheet.getRange(row, i + 1).setValue(v);
    };
    put('archived', hide ? 'TRUE' : 'FALSE');
    put('archived_at', hide ? now : '');
    put('archived_by', hide ? String((user && user.email) || '') : '');
    put('archived_reason', hide ? reason : '');
    done++;
  }

  hubBustTalentCache_();
  hubSysLog_(user && user.email, hide ? 'talent_archive' : 'talent_unarchive',
             done + ' candidate(s)' + (reason ? ' · ' + reason : ''), { status: 200 });
  return { status: 200, data: { changed: done, archived: hide } };
};

/** Candidates without a phone number: who is on the board but cannot be phoned. */
HUB_POLICY.talentNoNumberList = {
  file: 'Talent.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
var TALENT_ARCHIVE_CACHE_KEY = 'hub_talent_archive_v1';
HUB_ACTIONS.talentNoNumberList = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  // Cached; hubBustTalentCache_ drops it on every candidate write.
  var aCache = CacheService.getScriptCache();
  var aHit = aCache.get(TALENT_ARCHIVE_CACHE_KEY);
  if (aHit) {
    try { return { status: 200, data: JSON.parse(aHit) }; } catch (eA) { /* read on */ }
  }
  var rows = [];
  var counts = { total: 0, with_email: 0, with_referral: 0, nothing: 0, archived: 0,
                 discarded_with_phone: 0 };
  try {
    var all = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB);
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      var id = str_(c.candidateid);
      if (!id || TALENT_EXCLUDE_IDS.indexOf(id) !== -1) continue;
      // A nameless row is a ghost from hubSetFieldLastRow_, not a person.
      var name = str_(c.candidatename);
      if (!name) continue;
      var email = str_(c.email);
      var refPhone = str_(c.referralphone);
      var archived = str_(c.archived).toLowerCase() === 'true';
      // Archived rows are always listed, or a discarded candidate with a phone appears nowhere.
      if (!archived && packetSendableNumber_(str_(c.phone))) continue;
      counts.total++;
      if (email) counts.with_email++;
      if (packetSendableNumber_(refPhone)) counts.with_referral++;
      if (!email && !packetSendableNumber_(refPhone)) counts.nothing++;
      if (archived) counts.archived++;
      if (archived && packetSendableNumber_(str_(c.phone))) counts.discarded_with_phone++;

      rows.push({
        id: id,
        name: name,
        status: str_(c.status),
        stage: talentStage_(str_(c.status)) || '',
        email: email,
        phone_raw: str_(c.phone),
        referral_name: str_(c.referralname) || talentReferrerFromSource_(str_(c.source)),
        referral_phone: refPhone,
        source: str_(c.source),
        applied_at: str_(c.createdat),
        phone_status: str_(c.phonestatus),
        phone_ask_at: str_(c.phoneaskat),
        archived: archived,
        archived_at: str_(c.archivedat),
        archived_reason: str_(c.archivedreason),
        resume_link: str_(c.resumelink),
        is_test: (typeof commsIsTestCandidate_ === 'function') ? !!commsIsTestCandidate_(c) : false
      });
    }
  } catch (e) {
    return { status: 500, message: hiringRenderMail_(
      bookText_('Strings', 'refuse.talent.unreadable', ''),
      { error: String((e && e.message) || e) }) };
  }
  rows.sort(function (a, b) { return String(b.applied_at).localeCompare(String(a.applied_at)); });
  var aAnswer = { rows: rows, counts: counts };
  try { aCache.put(TALENT_ARCHIVE_CACHE_KEY, JSON.stringify(aAnswer), 600); }
  catch (ePut) { /* over the ceiling or unavailable — the read still answered */ }
  return { status: 200, data: aAnswer };
};

// Legacy rows carry the referrer only inside the free-text `source`.
function talentReferrerFromSource_(source) {
  var m = /^\s*referral\s*[—-]\s*(.+)$/i.exec(String(source || ''));
  return m ? m[1].trim() : '';
}
