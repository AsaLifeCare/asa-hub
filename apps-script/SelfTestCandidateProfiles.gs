/** The board's own next step, as the Hiring app's Actions view derives it: the phase's first open item, else the first left behind. */
function stCndBoardHead_(row) {
  var open = (row.checklist || []).filter(function (c) { return c.status === 'pending' || c.status === 'missing'; });
  var phase = (row.checklist || []).filter(function (c) { return c.stage === row.stage; }).map(function (c) { return c.id; });
  var next = open.filter(function (c) { return phase.indexOf(c.id) !== -1; });
  var behind = open.filter(function (c) { return phase.indexOf(c.id) === -1; });
  return (next[0] || behind[0] || { id: '' }).id;
}

/** Staff Candidates: the released-app gate and the narrowed reader's cut, the Hiring board and records read as the Hiring app reads them, the doors named, the note and the pack. */
function stCandidateProfiles_(out) {
  var P = 'candidate profiles: ';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var ANN = 'CAN_ANN9TEST0001', BOB = 'CAN_BOB9ONBOARD01', CY = 'CAN_CY9INTERVIEW1', EVE = 'CAN_EVE9HIRED0001';
  var DEE = 'CAN_DEE9GONE00001', ANN_BEFORE = 'CAN_ANN9EARLIER01';
  var keep = {
    rules: hubProfileAppRules_, users: usersAll_, clientRows: locationsClientRows_, homes: locationsHomes_,
    ssa: ssaIndex_, derived: clientsDerived_, cal: locationsCalendar_, visible: hubStaffVisibleForHouses_,
    viewerMemo: HUB_VIEWER_MEMO,
    candidate: cndCandidate_, cached: cndCached_, masterCache: HUB_MASTER_EMAIL_CACHE, member: HUB_MEMBER_CTX,
    log: hubSysLog_, sheet: hubTabSheet_, holds: sheetDbGateHolds_, board: talentCandidatesRead_,
    readTab: readTabNormalized_, ssOpen: ssOpen_, hubId: hubId_, evidence: hubEvidence_, ivFor: interviewFor_,
    obRow: onboardingRowFor_, obDone: hubOnboardingDone_, gate: hubGate_, asks: interviewAskRows_,
    packet: packetState_, certs: certPicture_, journey: journeyFor_, journeyLog: journeyLog_, lineRow: hubLineRow_,
    lineOurs: hubLineOurs_, bytes: locationsDocBytes_, today: locationsToday_, bump: cacheBump_,
    transcript: commCallsTranscriptRead_, activityDoor: cndActivityDoor_, budget: CND_PACK_BUDGET_MS,
    policyGate: hubPolicyGate_, decide: hubSetDecision_, bust: hubBustTalentCache_, hiring: {},
    extract: hubExtractResumeText_,
    docUpload: HUB_ACTIONS.docUpload, uploadText: digestUploadText_, vocab: DIGEST_VOCAB, roster: DIGEST_ROSTER
  };
  Object.keys(CND_DOOR_FIELDS).forEach(function (a) { keep.hiring[a] = HUB_ACTIONS[a]; });
  var master = { email: HUB_MASTER_ACCOUNT, role: 'admin', display_name: 'The Master' };
  var answers = [];
  var seen = function (label, r) { answers.push([label, r]); return r; };
  var clone = function (v) { return JSON.parse(JSON.stringify(v)); };
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    HUB_MEMBER_CTX = null;
    HUB_VIEWER_MEMO = null;
    CND_MEMO_ = null;
    // App Control as the test says it is: nothing released until a case writes a row
    var RULES = { rules: {}, tenants: {} };
    hubProfileAppRules_ = function () { return RULES; };
    var accounts = [];
    usersAll_ = function () { return accounts; };

    // ---- declarations ----
    var READS = ['candidateProfileRoster', 'candidateProfileOverview', 'candidateProfileActions',
                 'candidateProfileInterviews', 'candidateProfileDocuments', 'candidateProfileActivity',
                 'candidateProfileTexts', 'candidateProfileTranscripts', 'candidateProfileResume'];
    var TOOLS = ['candidateProfileDocFile', 'candidateProfileTranscript'];
    var DOOR = 'candidateProfileDoor';
    var WRITES = ['candidateProfileNoteAdd', DOOR];
    var READ_ROLES = '["admin","director","manager","staff","client","onboarding","interviewer"]';
    var bad = [];
    CND_ACTIONS.forEach(function (a) {
      var p = HUB_POLICY[a];
      if (!p || p.file !== 'CandidateProfiles.gs' || typeof HUB_ACTIONS[a] !== 'function') { bad.push(a + ': undeclared'); return; }
      if (RESOLVER_LANES.indexOf(p.lane) === -1 || RESOLVER_STORES.indexOf(p.store) === -1) bad.push(a + ': lane/store');
      var writes = WRITES.indexOf(a) !== -1;
      if (JSON.stringify(p.roles) !== (writes ? '["admin","manager"]' : READ_ROLES)) bad.push(a + ': roles ' + JSON.stringify(p.roles));
      if (a !== DOOR && ((p.invalidates || []).length || (p.emits || []).length)) bad.push(a + ': invalidates/emits');
      var params = p.params || {};
      Object.keys(params).forEach(function (k) { if (params[k] && params[k].required) bad.push(a + ': ' + k + ' required at the door'); });
      var want = READS.indexOf(a) !== -1 ? 'read' : (TOOLS.indexOf(a) !== -1 || a === DOOR ? 'tool' : 'write');
      if (p.lane !== want) bad.push(a + ': lane ' + p.lane + ', wanted ' + want);
      if (want === 'read' && p.idempotent !== true) bad.push(a + ': a read not idempotent');
      var first = writes
        ? /^function\s*\(payload, user\)\s*\{\s*if \(!candidateProfilesGate_\(user\)\) return candidateProfilesUnknown_\(\);/
        : (CND_NARROW_READS.indexOf(a) !== -1
          ? /^function\s*\(payload, user\)\s*\{\s*var scope = cndViewer_\(user\);\s*if \(!scope\) return candidateProfilesUnknown_\(\);/
          : /^function\s*\(payload, user\)\s*\{\s*if \(!cndWide_\(cndViewer_\(user\)\)\) return candidateProfilesUnknown_\(\);/);
      if (!first.test(stCode_(HUB_ACTIONS[a]))) bad.push(a + ': the gate is not the first line');
    });
    stAssert_(out, P + 'all 13 actions are declared in CandidateProfiles.gs on their lane — the reads for every role a ' +
                   'release may reach, the note and the press for admin/manager — the reads and the note invalidate ' +
                   'and emit nothing, none requires a param before the gate, each read opens with the App Control ' +
                   'gate (the roster, the overview and the interviews narrowed, the rest the résumé among them the ' +
                   'wide reader\'s alone) and each write with the master\'s',
              bad.length === 0 && CND_ACTIONS.length === 13 &&
              CND_NARROW_READS.join() === 'candidateProfileRoster,candidateProfileOverview,candidateProfileInterviews' &&
              CND_APP_ID === 'staff-candidates', bad.join('; '));
    var dp = HUB_POLICY[DOOR] || {};
    var named = {};
    Object.keys(CND_DOORS).forEach(function (k) { named[CND_DOORS[k].action] = true; });
    ['moveStage', 'hiringDiscard', 'onboardingManualComplete', 'tableDocUpload'].forEach(function (a) { named[a] = true; });
    var unopened = Object.keys(named).filter(function (a) { return !CND_DOOR_FIELDS[a]; });
    var undeclared = Object.keys(CND_DOOR_FIELDS).filter(function (a) {
      return !HUB_POLICY[a] || HUB_POLICY[a].file === 'CandidateProfiles.gs' || typeof HUB_ACTIONS[a] !== 'function' ||
             !CND_DOOR_TITLES[a];
    });
    stAssert_(out, P + 'the press: a tool-lane write that is never sent twice, declaring the slices and the letter its ' +
                   'Hiring doors write; every door an answer names is one it opens, each a Hiring app action with a title',
              dp.lane === 'tool' && dp.idempotent === false &&
              JSON.stringify(dp.invalidates) === '["candidates","phoneScreens","onboarding"]' &&
              JSON.stringify(dp.emits) === '["emailSend"]' && unopened.length === 0 && undeclared.length === 0,
              JSON.stringify([dp, unopened, undeclared]));
    var pol = HUB_POLICY.candidatePack || {};
    stAssert_(out, P + 'pack: declared in CandidateProfiles.gs as an idempotent admin read, a service read, no section ' +
                   'door, its seven parts each a door, and the service-or-master gate its first line',
              pol.file === 'CandidateProfiles.gs' && pol.lane === 'read' && pol.idempotent === true &&
              JSON.stringify(pol.roles) === '["admin"]' && typeof HUB_ACTIONS.candidatePack === 'function' &&
              SERVICE_READ_ACTIONS.indexOf('candidatePack') !== -1 && CND_ACTIONS.indexOf('candidatePack') === -1 &&
              CND_PACK_PARTS.join() === 'overview,actions,interviews,documents,activity,texts,transcripts' &&
              JSON.stringify(Object.keys(cndPackDoors_({ key: 'x', row: {}, memo: {} })).sort()) ===
                JSON.stringify(CND_PACK_PARTS.slice().sort()) &&
              /^function\s*\(payload, user\)\s*\{\s*if \(!user \|\| !\(user\.is_service === true \|\| candidateProfilesGate_\(user\)\)\) return candidateProfilesUnknown_\(\);/
                .test(stCode_(HUB_ACTIONS.candidatePack)), JSON.stringify(pol));

    // ---- the gate ----
    var asked = 0, boardReads = 0;
    cndCandidate_ = function () { asked++; return { refused: { status: 418, message: 'st: the candidate was asked' } }; };
    talentCandidatesRead_ = function () { boardReads++; throw new Error('st: the board was read'); };
    var callers = [
      { email: 'admin@example.org', role: 'admin' },
      { email: 'mgr@example.org', role: 'manager' },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', is_service: true },
      { email: HUB_MASTER_ACCOUNT, role: 'manager' },
      null
    ];
    var probe = { candidate: ANN, file_id: 'AnnResumeFile123', id: 'AC-2', body: 'x' };
    var shape = function (r) { return !!r && r.status === 404 && r.message === 'Unknown action.' && Object.keys(r).length === 2; };
    var leaks = [];
    CND_ACTIONS.forEach(function (a) {
      callers.forEach(function (u) {
        var r = HUB_ACTIONS[a](probe, u);
        if (!shape(r)) leaks.push(a + ' ' + JSON.stringify(u) + ' → ' + JSON.stringify(r));
      });
      HUB_MEMBER_CTX = { memberId: 'mem_st', userId: 'u-st', email: 'ann@example.org' };
      var inVisit = HUB_ACTIONS[a](probe, master);
      HUB_MEMBER_CTX = null;
      if (!shape(inVisit)) leaks.push(a + ' in a visit → ' + JSON.stringify(inVisit));
    });
    stAssert_(out, P + 'with no App Control row, another admin, a manager, a visit, the service identity, the master as ' +
                   'a manager, no session and the member context all get the exact 404 shape before the candidate or ' +
                   'the board is looked up',
              leaks.length === 0 && asked === 0 && boardReads === 0,
              leaks.slice(0, 4).join(' | ') + ' asked=' + asked + ' board=' + boardReads);
    var passed = CND_ACTIONS.filter(function (a) { return a !== 'candidateProfileRoster'; }).map(function (a) {
      return a + ':' + HUB_ACTIONS[a](probe, master).status;
    });
    stAssert_(out, P + 'the master in its own session passes the gate to the candidate lookup',
              passed.every(function (s) { return /:418$/.test(s); }) && asked === passed.length, passed.join());
    asked = 0;
    var packShut = [{ email: 'admin@example.org', role: 'admin' }, { email: 'mgr@example.org', role: 'manager' },
                    { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' }, null].map(function (u) {
      return HUB_ACTIONS.candidatePack(probe, u);
    });
    var packOpen = [serviceUser_(), master].map(function (u) { return HUB_ACTIONS.candidatePack(probe, u).status; });
    stAssert_(out, P + 'pack: another admin, a manager, a visit and no session get the exact 404 shape before the lookup; ' +
                   'the service identity and the master in its own session reach it',
              packShut.every(shape) && packOpen.join() === '418,418' && asked === 2 && CND_MEMO_ === null,
              JSON.stringify([packShut, packOpen, asked]));
    cndCandidate_ = keep.candidate;

    // ---- fixtures ----
    cndCached_ = function (action, ctx, producer) { return producer(); };
    locationsToday_ = function () { return '2026-09-22'; };
    var board = [
      { id: ANN, name: 'Ann9 Test', role: 'Direct Support Professional', stage: 'phone-screen', phone: '(330) 555-0142',
        email: 'ann9@example.org', city: 'Canton', state: 'OH', owner: 'asa-hub:recruiter9@example.org', source: 'Indeed',
        appliedAt: '2026-09-01T14:00:00Z', urgency: 'none', daysInStage: 5, daysAtStage: 4, avatar: '',
        summary: 'Five years of care. SSN 123-45-6789 on the form; DOB: 01/02/1990; BCI report #A12345; CJIS: Clear.',
        resumeLink: 'https://drive.google.com/file/d/AnnResumeFile123/view', resumeScorecard: 7.5,
        application: { srid: 'srAnn9Envelope', title: 'Application', status: 'signed', appliedAt: '2026-08-30',
                       signedAt: '2026-08-31' },
        packet: null, onboardingWindow: null, lastReply: { at: '2026-09-10T12:00:00Z', body: 'yes', unread: 1 },
        checklist: [
          { id: 'application', label: 'Application', owner: 'Candidate', stage: 'new', status: 'done' },
          { id: 'resume', label: 'Resume', owner: 'Candidate', stage: 'new', status: 'done' },
          { id: 'cjis', label: 'CJIS', owner: 'HR', stage: 'new', status: 'missing' },
          { id: 'resume-decision', label: 'Resume decision', owner: 'Recruiter', stage: 'new', status: 'done' },
          { id: 'transcript', label: 'Transcript', owner: 'Auto', stage: 'phone-screen', status: 'auto' },
          { id: 'ai-report', label: 'AI report', owner: 'Auto', stage: 'phone-screen', status: 'pending' },
          { id: 'screen-details', label: 'Screen details', owner: 'Recruiter', stage: 'phone-screen', status: 'pending' },
          { id: 'advance-decision', label: 'Advance decision', owner: 'Recruiter', stage: 'phone-screen', status: 'pending' }] },
      { id: BOB, name: 'Bob9 Onboard', role: 'Direct Support Professional', stage: 'onboarding', phone: '330-555-0177',
        email: 'bob9@example.org', city: 'Akron', state: 'OH', owner: 'recruiter9@example.org', source: 'Referral — Ann9',
        appliedAt: '2026-08-01T14:00:00Z', urgency: 'amber', urgencyWhy: 'the packet is late', resumeLink: '',
        application: null, packet: { state: 'unsigned', label: 'Sent, not signed' },
        onboardingWindow: { open: true, until: '2026-09-20T23:59:59.000Z', reason: '', anchored_on: '' },
        checklist: [
          { id: 'application', label: 'Application', owner: 'Candidate', stage: 'new', status: 'pending' },
          { id: 'resume', label: 'Resume', owner: 'Candidate', stage: 'new', status: 'missing' },
          { id: 'new-hire-packet', label: 'New Hire Packet', owner: 'HR', stage: 'onboarding', status: 'missing' },
          { id: 'onboarding-complete', label: 'Onboarding open', owner: 'Candidate', stage: 'onboarding', status: 'pending' }] },
      { id: CY, name: 'Cy9 Interview', role: 'Direct Support Professional', stage: 'interview', phone: '330 555 0199',
        email: '', city: '', state: '', owner: '', source: 'Direct', appliedAt: '2026-08-20T14:00:00Z', urgency: 'none',
        checklist: [
          { id: 'cjis', label: 'CJIS', owner: 'HR', stage: 'new', status: 'done' },
          { id: 'advance-decision', label: 'Advance decision', owner: 'Recruiter', stage: 'phone-screen', status: 'pending' },
          { id: 'interview-scheduled', label: 'Interview scheduled', owner: 'Recruiter', stage: 'interview', status: 'done' },
          { id: 'interview-scorecard', label: 'Interview scorecard', owner: 'Interviewer', stage: 'interview', status: 'pending' },
          { id: 'interview-recommendation', label: 'Recommendation', owner: 'Interviewer', stage: 'interview', status: 'pending' }] },
      { id: EVE, name: 'Eve9 Hired', role: 'Direct Support Professional', stage: 'hired', phone: '', email: 'eve9@example.org',
        city: 'Canton', state: 'OH', owner: '', source: 'Direct', appliedAt: '2026-07-01T14:00:00Z', urgency: 'none',
        checklist: [
          { id: 'cjis', label: 'CJIS', owner: 'HR', stage: 'new', status: 'missing' },
          { id: 'staff-account', label: 'Account created', owner: 'Auto', stage: 'hired', status: 'done' },
          { id: 'internal-docs-fill', label: 'Employee Database filled', owner: 'HR', stage: 'hired', status: 'done' }] }
    ];
    var raw = [
      { candidateid: ANN, candidatename: 'Ann9 Test', phone: '(330) 555-0142', status: 'Phone Screen' },
      { candidateid: BOB, candidatename: 'Bob9 Onboard', phone: '330-555-0177', status: 'Onboarding', email: 'bob9@example.org' },
      { candidateid: CY, candidatename: 'Cy9 Interview', phone: '330 555 0199', status: 'In Person' },
      { candidateid: EVE, candidatename: 'Eve9 Hired', phone: '', status: 'Hired' },
      { candidateid: DEE, candidatename: 'Dee9 Gone', phone: '+1 330 555 0199', status: 'Not Hiring', archived: 'TRUE',
        archivedreason: 'Declined after the phone screen', createdat: '2026-07-01T10:00:00Z', city: 'Canton', state: 'OH',
        source: 'Direct' },
      // the same person's earlier card: a re-applicant gets a fresh one, and this one keeps the phone
      { candidateid: ANN_BEFORE, candidatename: 'Ann9  Test', phone: '330.555.0142', status: 'Not Hiring', archived: 'TRUE',
        archivedreason: 'Withdrew', createdat: '2026-03-01T10:00:00Z' }
    ];
    var history = [
      { timestamp: '2026-09-04T12:00:00Z', candidateid: ANN, fromstatus: 'New', tostatus: 'Phone Screen', actor: 'recruiter9@example.org' },
      { timestamp: '2026-09-01T12:00:00Z', candidateid: BOB, fromstatus: 'In Person', tostatus: 'Onboarding', actor: 'asa-hub:sweep' }
    ];
    var evidence = {};
    evidence[ANN] = { cand: raw[0], analysis: { summary: '', cjisstatus: '', cjisreporturl: '', totalyearscaregiving: '5',
                                                scheduleavailability: 'Weekdays and every other weekend',
                                                analyzedat: '2026-09-02T10:00:00Z' },
                      screen: { screendate: '2026-09-05', screenstatus: '', finalresult: '', notes: 'Prefers days',
                                transcripttext: 'Hello, my SSN is 123 45 6789. Goodbye.', transcriptcallid: 'AC-SCREEN-1',
                                transcriptcreated: '2026-09-05T15:00:00Z', shiftday: 'TRUE', shiftnight: 'no',
                                hoursft: 'Yes', everyotherweekend: 'yes', hasdl: 'yes', hasvehicle: 'no',
                                certcprfirstaid: 'yes', bestinpersondaytime: 'Tuesday morning',
                                backgrounddisclosure: 'SECRET DISCLOSURE',
                                phonescreenreporturl: 'https://docs.google.com/document/d/AnnScreenReport1/edit' } };
    evidence[BOB] = { cand: raw[1], analysis: { cjisstatus: 'Clear',
                                                cjisreporturl: 'https://drive.google.com/file/d/BobCjisReport1/view' },
                      screen: { screendate: '2026-08-05', screenstatus: 'Completed', finalresult: 'Advance', manualscreen: 'true',
                                screenedby: 'asa-hub:manual-screen:recruiter9@example.org', notes: '' } };
    evidence[CY] = { cand: raw[2], analysis: {}, screen: null };
    evidence[EVE] = { cand: raw[3], analysis: {}, screen: { screenstatus: 'Completed', finalresult: 'Advance',
                                                            transcripttext: 'Eve words, DOB: 03/04/1985', transcriptcallid: '',
                                                            transcriptcreated: '2026-07-05T15:00:00Z' } };
    evidence[DEE] = { cand: raw[4], analysis: {}, screen: null };
    var evReads = {};
    hubEvidence_ = function (cid) { evReads[cid] = (evReads[cid] || 0) + 1; return clone(evidence[cid] || { cand: null, analysis: {}, screen: null }); };
    boardReads = 0;
    talentCandidatesRead_ = function () { boardReads++; return clone(board); };
    var rawReads = 0;
    readTabNormalized_ = function (ss, tab) {
      if (tab === TALENT_CANDIDATES_TAB) { rawReads++; return clone(raw); }
      if (tab === CND_STATUS_TAB) return clone(history);
      throw new Error('st: no tab ' + tab);
    };
    hubId_ = function (k) { return k === 'HUB_DB_ID' ? 'st-db' : (k === 'HOTLINE_TRANSCRIPTS_ID' ? 'st-hot-book' : ''); };
    var ivRows = {};
    ivRows[CY] = { scheduledfor: '2026-09-25T14:00:00Z', interviewername: '', score: '', comments: '', recommendation: '' };
    ivRows[EVE] = { scheduledfor: '2026-08-10T14:00:00Z', interviewername: 'Ivy9 Interviewer', score: '8',
                    comments: 'Kind and calm; DOB: 03/04/1985', recommendation: 'Advance', interviewedat: '2026-08-10T15:00:00Z' };
    interviewFor_ = function (cid) { return ivRows[cid] ? clone(ivRows[cid]) : null; };
    onboardingRowFor_ = function (cid) {
      return cid === BOB ? { startingstatus: '', earlieststartdate: '2026-10-01', startdate: '', house: 'ZZ9999',
                             notes: 'Needs a Saturday start', datemovedtoonboarding: '2026-09-01T10:00:00Z' } : null;
    };
    hubOnboardingDone_ = function (c) {
      var id = str_(c && c.candidateid);
      if (id === BOB) return { ok: false, how: '', q: true, t: false };
      if (id === EVE) return { ok: true, how: 'portal', q: true, t: true };
      return { ok: false, how: '', q: false, t: false };
    };
    var gates = {};
    gates[ANN] = { from: 'phone-screen', to: 'interview', ok: false, reasons: ['screen Completed', 'advance decision Advance'] };
    gates[BOB] = { from: 'onboarding', to: 'hired', ok: false, reasons: ['Onboarding is completed with the button'] };
    gates[CY] = { from: 'interview', to: 'onboarding', ok: true, reasons: [] };
    gates[EVE] = { from: 'hired', to: 'ready', ok: false, reasons: ['the graduation has not finished'] };
    var gateCalls = 0;
    hubGate_ = function (ev) { gateCalls++; return clone(gates[str_(ev && ev.cand && ev.cand.candidateid)] || {}); };
    interviewAskRows_ = function () { return [{ candidateid: CY, state: 'picked', pickeddate: '2026-09-25', pickedtime: '14:00' }]; };
    packetState_ = function () { return { state: 'unsigned' }; };
    certPicture_ = function () { return {}; };
    var journeys = {};
    journeys[ANN] = [
      { id: 'JRN1', candidate_id: ANN, step: 'welcome', title: 'Welcome text', channel: 'sms', ok: true,
        detail: 'Sent to (330) 555-0142; SSN 123-45-6789', at: '2026-09-01T15:00:00Z', by: 'asa-hub:hiring', rehearsal: false },
      { id: 'JRN2', candidate_id: ANN, step: 'note', title: 'Note', channel: 'note', ok: true, detail: 'Called her back',
        at: '2026-09-06T10:00:00Z', by: 'recruiter9@example.org', rehearsal: false }];
    // presses from this app: a stage move (its status row is the same move) and a paper filed
    journeys[BOB] = [
      { id: 'JRN3', candidate_id: BOB, step: 'staff_candidates', title: 'Update stage', channel: '', ok: true,
        detail: 'Interview → Onboarding', ref: 'stage:onboarding', at: '2026-09-01T12:00:20Z', by: HUB_MASTER_ACCOUNT,
        rehearsal: false },
      { id: 'JRN4', candidate_id: BOB, step: 'staff_candidates', title: 'Document filed', channel: '', ok: true,
        detail: 'Driver\'s License / State ID: licence.pdf', ref: 'upload:doc_drivers_id', at: '2026-09-02T10:00:05Z',
        by: HUB_MASTER_ACCOUNT, rehearsal: false }];
    journeyFor_ = function (cid) { return cid === EVE ? null : clone(journeys[cid] || []); };
    var tabs = {};
    tabs[CND_STATUS_TAB] = stLocSheet_([['timestamp']]);
    tabs[DOCS_TAB] = stLocSheet_([DOCS_HEADER.slice()].concat([
      [BOB, 'drivers_id', 'uploaded', 'BobLicenceFile1', '', '2026-09-02T10:00:00Z', '', ''],
      [BOB, 'dodd_8hr', 'verified', 'BobDoddCert0001', '', '2026-08-20T10:00:00Z', '2026-08-15', '2027-08-15'],
      [BOB, 'ss_birth', 'uploaded', 'BobOldSsFile001', 'DOC_NEWER', '2026-08-01T10:00:00Z', '', ''],
      [ANN, 'hs_diploma', 'uploaded', 'AnnDiplomaFile1', '', '2026-09-03T10:00:00Z', '', '']
    ].map(function (r) {
      var line = DOCS_HEADER.map(function () { return ''; });
      var put = function (h, v) { line[DOCS_HEADER.indexOf(h)] = v; };
      put('candidate_id', r[0]); put('doc_id', r[1]); put('status', r[2]); put('file_id', r[3]); put('superseded_by', r[4]);
      put('uploaded_at', r[5]); put('issued_on', r[6]); put('expires_on', r[7]); put('doc_label', r[1]);
      return line;
    })));
    var eventRow = function (cid, type, date, time, location, withName, status) {
      var line = HIRING_EVENTS_HEADER.map(function () { return ''; });
      var put = function (h, v) { line[HIRING_EVENTS_HEADER.indexOf(h)] = v; };
      put('event_id', 'HEV_' + cid + date); put('candidate_id', cid); put('event_type', type); put('date', date);
      put('time', time); put('location', location); put('with_name', withName); put('status', status);
      return line;
    };
    tabs[HIRING_EVENTS_TAB] = stLocSheet_([HIRING_EVENTS_HEADER.slice(),
      eventRow(CY, 'in_person_interview', '2026-09-25', '10:00', 'Main office, Canton', 'Ivy9 Interviewer', 'scheduled'),
      eventRow(CY, 'in_person_interview', '2026-09-30', '09:00', 'Elsewhere', 'Someone Else', 'cancelled'),
      eventRow(CY, 'start_date', '2026-10-05', '', 'House 9', 'Mgr', 'scheduled'),
      eventRow(ANN, 'orientation', '2026-09-26', '11:00', 'Office', 'Ori Entation', 'scheduled')]);
    tabs[RECRUIT_DOCS_TAB] = stLocSheet_([['signature_request_id', 'doc_url', 'fetched_at', 'fetched_by'],
      ['srAnn9Envelope', 'https://drive.google.com/file/d/AnnAppPdfFile1/view', '2026-09-03T10:00:00Z', 'x@example.org']]);
    tabs.quo_messages = stSpSheet_([
      ['message_id', 'message_created', 'direction', 'from_number', 'to_number', 'body', 'quo_number'],
      ['m1', '2026-09-07T12:00:00Z', 'incoming', '+13305550142', '+13309197595', 'I can come Tuesday; my SSN is 123 45 6789',
       'PNaaaa0001'],
      ['m2', '2026-09-07T13:00:00Z', 'outgoing', '+13309197595', '+13305550142', 'See you then', 'PNaaaa0001'],
      ['m3', '2026-09-08T12:00:00Z', 'incoming', '+13305550199', '+13309197595', 'shared phone text', 'PNaaaa0001'],
      ['m4', '2026-09-09T12:00:00Z', 'incoming', '+12165550000', '+13309197595', 'stranger text', 'PNaaaa0001']
    ]);
    var hot = stSpSheet_([
      ['Call ID', 'Transcript Created', 'Event Timestamp', 'Duration (sec)', 'Quo Number', 'Participant(s)', 'Team Member(s)',
       'Direction', '# Turns', 'Full Transcript', 'Speaker Transcript'],
      ['AC-SCREEN-1', '2026-09-05T15:00:00Z', '2026-09-05T15:00:00Z', 300, 'PNx', '+13305550142', '+13309197595', 'incoming', 20,
       'SECRET WORDS', ''],
      ['AC-2', '2026-09-08T10:00:00Z', '2026-09-08T10:00:00Z', 60, 'PNx', '+13305550142', '+13309197595', 'outgoing', 4, 'more', ''],
      ['AC-3', '2026-09-09T10:00:00Z', '2026-09-09T10:00:00Z', 60, 'PNx', '+12165550000', '+13309197595', 'incoming', 4, 'x', '']
    ]);
    ssOpen_ = function (id) {
      if (id === 'st-hot-book') return { getSheetByName: function (n) { return n === HOTLINE_TRANSCRIPTS_TAB ? hot : null; } };
      if (id === 'st-db') return { getId: function () { return 'st-db'; } };
      throw new Error('st: no book ' + id);
    };
    hubTabSheet_ = function (t) { return tabs[t] || null; };
    hubLineRow_ = function (v) {
      var s = String(v || '');
      if (s === 'PNaaaa0001' || s === '3309197595') {
        return { digits: '3309197595', e164: '+13309197595', name: 'HR line', owner: 'Hera Owner', humans: 1, shared: false };
      }
      return null;
    };
    hubLineOurs_ = function (d) { return String(d) === '3309197595'; };
    sheetDbGateHolds_ = function () { return null; };
    var logged = [];
    hubSysLog_ = function () { logged.push(JSON.stringify(Array.prototype.slice.call(arguments))); return true; };

    // ---- the pipeline ----
    boardReads = 0;
    var rs = seen('roster', HUB_ACTIONS.candidateProfileRoster({}, master));
    var rk = {};
    ((rs.data || {}).candidates || []).forEach(function (x) { rk[x.key] = x; });
    stAssert_(out, P + 'pipeline: every candidate on the Hiring board and no one else, in stage order, with position, ' +
                   'location, recruiter and the stage counts; one board read',
              rs.status === 200 && rs.data.candidates.map(function (x) { return x.key; }).join() === [ANN, CY, BOB, EVE].join() &&
              !rk[DEE] && rk[ANN].position === 'Direct Support Professional' && rk[ANN].location === 'Canton, OH' &&
              rk[ANN].recruiter === 'recruiter9@example.org' && rk[ANN].stage_label === 'Phone Screen' &&
              rk[ANN].applied_at === '2026-09-01' && rk[CY].location === '' &&
              rs.data.stages.map(function (s) { return s.id + ':' + s.count; }).join() ===
                'new:0,phone-screen:1,interview:1,onboarding:1,hired:1,ready:0' && boardReads === 1,
              JSON.stringify(rs).slice(0, 1500));
    var headsOk = board.every(function (r) {
      var want = stCndBoardHead_(r);
      var label = (r.checklist.filter(function (c) { return c.id === want; })[0] || { label: '' }).label;
      return rk[r.id].next_step === label;
    });
    stAssert_(out, P + 'pipeline: the next step is the board\'s own — the phase\'s first open item (AI report, not the ' +
                   'CJIS left behind), else the first left behind (CJIS at Hired); the status says who needs a person',
              headsOk && rk[ANN].next_step === 'AI report' && rk[EVE].next_step === 'CJIS' &&
              rk[BOB].next_step === 'New Hire Packet' && rk[CY].next_step === 'Interview scorecard' &&
              rk[ANN].status === 'needs_you' && rk[BOB].status === 'needs_you' && rk[CY].status === 'waiting' &&
              rk[EVE].status === 'missing', JSON.stringify(rk));
    stAssert_(out, P + 'pipeline: each line names its next step\'s checklist id — what the Pipeline opens from it — and ' +
                   'the New Hire packet\'s state as the board reads it',
              board.every(function (r) { return rk[r.id].next_id === stCndBoardHead_(r); }) &&
              rk[ANN].next_id === 'ai-report' && rk[CY].next_id === 'interview-scorecard' &&
              rk[BOB].next_id === 'new-hire-packet' && rk[BOB].packet === 'unsigned' && rk[ANN].packet === '' &&
              rk[EVE].next_id === 'cjis', JSON.stringify(rk));

    // ---- the lookup ----
    var none = HUB_ACTIONS.candidateProfileOverview({ candidate: 'CAN_NOBODY0001' }, master);
    var junk = HUB_ACTIONS.candidateProfileOverview({ candidate: 'a b' }, master);
    var blank = HUB_ACTIONS.candidateProfileActivity({}, master);
    var testRow = HUB_ACTIONS.candidateProfileOverview({ candidate: TALENT_EXCLUDE_IDS[0] }, master);
    stAssert_(out, P + 'an unknown, a malformed, a missing and a test-row candidate id are 400 "No candidate … is on file."',
              none.status === 400 && none.message === 'No candidate "CAN_NOBODY0001" is on file.' && junk.status === 400 &&
              blank.status === 400 && blank.message === 'No candidate "" is on file.' && testRow.status === 400,
              JSON.stringify([none, junk, blank, testRow]));
    talentCandidatesRead_ = function () { throw new Error('st: board closed'); };
    var down = HUB_ACTIONS.candidateProfileActions({ candidate: ANN }, master);
    var rsDown = HUB_ACTIONS.candidateProfileRoster({}, master);
    talentCandidatesRead_ = function () { boardReads++; return clone(board); };
    readTabNormalized_ = function (ss, tab) { throw new Error('st: records closed ' + tab); };
    var rawDown = HUB_ACTIONS.candidateProfileOverview({ candidate: DEE }, master);
    var onBoard = HUB_ACTIONS.candidateProfileActions({ candidate: ANN }, master);
    readTabNormalized_ = function (ss, tab) {
      if (tab === TALENT_CANDIDATES_TAB) { rawReads++; return clone(raw); }
      if (tab === CND_STATUS_TAB) return clone(history);
      throw new Error('st: no tab ' + tab);
    };
    stAssert_(out, P + 'an unreadable board is 503 for the pipeline and the lookup; unreadable candidate records are 503 ' +
                   'for a candidate the board does not carry, never "not on file", and a board candidate still answers',
              down.status === 503 && /hiring board could not be read/.test(down.message) && rsDown.status === 503 &&
              rawDown.status === 503 && /nothing is said about this candidate/.test(rawDown.message) &&
              onBoard.status === 200, JSON.stringify([down, rsDown, rawDown, onBoard.status]));

    // ---- actions ----
    var aa = seen('actions ann', HUB_ACTIONS.candidateProfileActions({ candidate: ANN }, master));
    var ai = {};
    ((aa.data || {}).items || []).forEach(function (i) { ai[i.id] = i; });
    var st = {};
    ((aa.data || {}).stages || []).forEach(function (s) { st[s.id] = s; });
    stAssert_(out, P + 'actions: the Hiring checklist as the board carries it, the next step marked once, each open item ' +
                   'with the exact Hiring door that completes it and no door on a closed one',
              aa.status === 200 && aa.data.items.length === 8 && aa.data.next.id === 'ai-report' &&
              aa.data.items.filter(function (i) { return i.is_next; }).length === 1 && aa.data.open === 4 &&
              JSON.stringify(ai['ai-report'].complete) ===
                JSON.stringify({ action: 'screenManualComplete', form: 'notes', payload: { candidate_id: ANN } }) &&
              JSON.stringify(ai['advance-decision'].complete) === JSON.stringify({ action: 'setDecision', form: '',
                payload: { candidate_id: ANN, checkpoint: 'advance-decision', value: 'Advance' } }) &&
              JSON.stringify(ai.cjis.complete) ===
                JSON.stringify({ action: 'tableDocUpload', form: 'upload', payload: { candidate_id: ANN, item_id: 'cjis' } }) &&
              ai.cjis.in_phase === false && ai['resume-decision'].complete === null && ai.transcript.complete === null &&
              aa.data.status === 'needs_you' && aa.data.attention.join() === '1 unread reply',
              JSON.stringify(aa.data).slice(0, 1800));
    stAssert_(out, P + 'actions: the stage select offers the gate\'s next stage through moveStage only when the gate is ' +
                   'open, says what is still needed when it is not, and Not hiring through hiringDiscard',
              st['phone-screen'].current === true && st.interview.reachable === false && st.interview.door === null &&
              st.interview.why === 'Still needed: screen Completed; advance decision Advance.' &&
              /one stage at a time/.test(st.onboarding.why) && st['not-hiring'].reachable === true &&
              JSON.stringify(st['not-hiring'].door) ===
                JSON.stringify({ action: 'hiringDiscard', form: 'reason', payload: { candidate_id: ANN } }),
              JSON.stringify(aa.data.stages));
    var ab = HUB_ACTIONS.candidateProfileActions({ candidate: BOB }, master);
    var ac = HUB_ACTIONS.candidateProfileActions({ candidate: CY }, master);
    var ae = HUB_ACTIONS.candidateProfileActions({ candidate: EVE }, master);
    var by = function (r, id) { return ((r.data || {}).items || []).filter(function (i) { return i.id === id; })[0] || {}; };
    var stageOf = function (r, id) { return ((r.data || {}).stages || []).filter(function (s) { return s.id === id; })[0] || {}; };
    stAssert_(out, P + 'actions: the onboarding window\'s end is the packet\'s due day (overdue past it) and the booked ' +
                   'interview the scorecard\'s; a door a later stage cannot use says where it opens; the platform\'s ' +
                   'own steps have no door; Onboarding → Hired is Manual onboarding, an open gate is moveStage',
              by(ab, 'new-hire-packet').due === '2026-09-20' && by(ab, 'new-hire-packet').due_state === 'overdue' &&
              by(ab, 'new-hire-packet').complete.action === 'packetWaive' &&
              by(ab, 'onboarding-complete').complete.action === 'onboardingManualComplete' &&
              by(ab, 'application').complete === null && by(ab, 'application').complete_why === 'The platform does this by itself.' &&
              by(ab, 'resume').complete.payload.item_id === 'resume' &&
              stageOf(ab, 'hired').reachable === true && stageOf(ab, 'hired').door.action === 'onboardingManualComplete' &&
              by(ac, 'interview-scorecard').due === '2026-09-25' && by(ac, 'interview-scorecard').due_state === 'upcoming' &&
              by(ac, 'interview-scorecard').complete.action === 'interviewSave' &&
              by(ac, 'interview-scorecard').complete.form === 'scorecard' &&
              by(ac, 'advance-decision').complete === null &&
              by(ac, 'advance-decision').complete_why === 'Its door opens at Phone Screen.' &&
              JSON.stringify(stageOf(ac, 'onboarding').door) ===
                JSON.stringify({ action: 'moveStage', form: '', payload: { candidate_id: CY, to_stage: 'onboarding' } }) &&
              ae.data.next.id === 'cjis' && ae.data.status === 'missing' &&
              stageOf(ae, 'ready').why === 'Still needed: the graduation has not finished.',
              JSON.stringify([ab.data, ac.data.items, ae.data.next]).slice(0, 1800));
    var gatesBefore = gateCalls;
    var ad = HUB_ACTIONS.candidateProfileActions({ candidate: DEE }, master);
    stAssert_(out, P + 'actions: a candidate out of the pipeline reads as the minimal card — no item, no door, no move, ' +
                   'the gate never asked',
              ad.status === 200 && ad.data.archived === true && ad.data.items.length === 0 && ad.data.gate === null &&
              ad.data.stages.every(function (s) { return !s.reachable && !s.door; }) && gateCalls === gatesBefore,
              JSON.stringify(ad));

    // ---- interviews ----
    var ia = seen('interviews ann', HUB_ACTIONS.candidateProfileInterviews({ candidate: ANN }, master));
    var ic = HUB_ACTIONS.candidateProfileInterviews({ candidate: CY }, master);
    var ie = seen('interviews eve', HUB_ACTIONS.candidateProfileInterviews({ candidate: EVE }, master));
    var ib = HUB_ACTIONS.candidateProfileInterviews({ candidate: BOB }, master);
    var pa = (ia.data || {}).plan || [], pc = (ic.data || {}).plan || [], pe = (ie.data || {}).plan || [];
    var pb = (ib.data || {}).plan || [];
    var pref = (ia.data || {}).preferences || {};
    stAssert_(out, P + 'interviews: the phone screen, the structured interview and the onboarding handoff, each Completed, ' +
                   'Awaiting Confirmation or Pending from the Hiring records, with its date, owner and result',
              ia.status === 200 && pa.map(function (p) { return p.id + ':' + p.status; }).join() ===
                'phone_screen:awaiting_confirmation,interview:pending,onboarding:pending' &&
              pa[0].date === '2026-09-05' && pa[0].comments === 'Prefers days' &&
              pc[1].status === 'awaiting_confirmation' && pc[1].date === '2026-09-25' &&
              pc[1].detail === 'The slot is not confirmed yet.' &&
              pe[1].status === 'completed' && pe[1].owner === 'Ivy9 Interviewer' && pe[1].result === 'Advance · score 8/10' &&
              pe[1].comments === 'Kind and calm; DOB [withheld]' && pe[2].status === 'completed' &&
              pb[0].status === 'completed' && pb[0].owner === 'recruiter9@example.org' && pb[0].result === 'Advance' &&
              pb[2].status === 'awaiting_confirmation' && pb[2].date === '2026-09-01' && pb[2].result === 'Questionnaire done' &&
              pb[2].comments === 'Needs a Saturday start',
              JSON.stringify([pa, pc[1], pe, pb]).slice(0, 1800));
    stAssert_(out, P + 'interviews: the structured interview carries what its panel shows — the slot as the Ohio day and ' +
                   'clock, the room and who holds it from the hiring calendar (a cancelled booking skipped), and once ' +
                   'signed who held it, when, the score out of the scorecard\'s maximum and the recommendation',
              pc[1].day === '2026-09-25' && pc[1].time === '10:00' && pc[1].location === 'Main office, Canton' &&
              pc[1].with_name === 'Ivy9 Interviewer' && pc[1].score === '' && pc[1].interviewed_at === '' &&
              pe[1].owner === 'Ivy9 Interviewer' && pe[1].day === '2026-08-10' && pe[1].time === '10:00' &&
              pe[1].interviewed_at === '2026-08-10T15:00:00Z' && pe[1].score === '8' && pe[1].score_max === 10 &&
              pe[1].recommendation === 'Advance' && pe[1].with_name === '' &&
              pa[1].day === '' && pa[1].with_name === '' && pa[1].status === 'pending' &&
              JSON.stringify(cndSlot_('2026-09-25 9:30')) === JSON.stringify({ day: '2026-09-25', time: '09:30' }) &&
              JSON.stringify(cndSlot_('2026-09-25')) === JSON.stringify({ day: '2026-09-25', time: '' }),
              JSON.stringify([pc[1], pe[1], pa[1]]).slice(0, 1500));
    stAssert_(out, P + 'interviews: the preferences are the phone screen\'s own answers and the onboarding record\'s, and ' +
                   'the background disclosure never leaves',
              pref.shifts.join() === 'Day' && pref.hours.join() === 'Full time' && pref.every_other_weekend === 'yes' &&
              pref.drivers_license === 'yes' && pref.vehicle === 'no' && pref.certificates.cpr_first_aid === 'yes' &&
              pref.best_in_person === 'Tuesday morning' && pref.availability === 'Weekdays and every other weekend' &&
              ib.data.preferences.earliest_start === '2026-10-01' && ib.data.preferences.preferred_location === 'ZZ9999' &&
              JSON.stringify([ia, ib, ic, ie]).indexOf('SECRET DISCLOSURE') === -1, JSON.stringify(pref));

    // ---- documents ----
    var da = seen('documents ann', HUB_ACTIONS.candidateProfileDocuments({ candidate: ANN }, master));
    var db = seen('documents bob', HUB_ACTIONS.candidateProfileDocuments({ candidate: BOB }, master));
    var dget = function (r, id) { return ((r.data || {}).docs || []).filter(function (d) { return d.id === id; })[0] || {}; };
    stAssert_(out, P + 'documents: the signed application with the copy the Hiring app fetched, the résumé, the phone ' +
                   'screen report, the interview notes and the background check, On File or Pending; an onboarding ' +
                   'paper already on file is listed before onboarding',
              da.status === 200 && da.data.docs.map(function (d) { return d.id + ':' + d.status; }).join() ===
                'application:on_file,resume:on_file,screen_report:on_file,interview_notes:pending,cjis:pending,' +
                'doc_hs_diploma:on_file' &&
              dget(da, 'application').file_id === 'AnnAppPdfFile1' && dget(da, 'application').srid === 'srAnn9Envelope' &&
              dget(da, 'resume').file_id === 'AnnResumeFile123' && dget(da, 'screen_report').file_id === 'AnnScreenReport1' &&
              JSON.stringify(dget(da, 'cjis').upload) ===
                JSON.stringify({ action: 'tableDocUpload', form: 'upload', payload: { candidate_id: ANN, item_id: 'cjis' } }) &&
              da.data.counts.total === 6 && da.data.counts.on_file === 4,
              JSON.stringify(da.data).slice(0, 1800));
    var chk = dget(db, 'onboarding_checklist');
    stAssert_(out, P + 'documents: at onboarding every catalog paper is listed — a superseded upload is not on file, an ' +
                   'unsigned packet is Pending with the upload door the board uses — a cleared CJIS opens its report, and ' +
                   'the Onboarding app\'s twelve rows ride as the checklist',
              db.status === 200 && dget(db, 'cjis').status === 'on_file' && dget(db, 'cjis').file_id === 'BobCjisReport1' &&
              dget(db, 'cjis').verified === true && dget(db, 'doc_drivers_id').file_id === 'BobLicenceFile1' &&
              dget(db, 'doc_dodd_8hr').verified === true && dget(db, 'doc_dodd_8hr').expires === '2027-08-15' &&
              dget(db, 'doc_ss_birth').status === 'pending' && dget(db, 'doc_ss_birth').file_id === '' &&
              dget(db, 'doc_dropbox_packet').status === 'pending' &&
              JSON.stringify(dget(db, 'doc_dropbox_packet').upload.payload) ===
                JSON.stringify({ candidate_id: BOB, item_id: 'new-hire-packet', doc_id: 'dropbox_packet' }) &&
              chk.status === 'pending' && (chk.items || []).length === 12 &&
              chk.items.filter(function (i) { return i.id === 'background-check'; })[0].status === 'done' &&
              chk.items.filter(function (i) { return i.id === 'dodd-cert'; })[0].status === 'done' &&
              !db.data.docs.some(function (d) { return d.id === 'doc_background_check'; }),
              JSON.stringify(db.data).slice(0, 1800));
    var bytesAsked = [];
    locationsDocBytes_ = function (id) {
      bytesAsked.push(id);
      return { name: 'resume.pdf', mime: 'application/pdf', size: 3, exported: false, b64: 'QUJD' };
    };
    var f1 = HUB_ACTIONS.candidateProfileDocFile({ candidate: ANN, file_id: 'AnnResumeFile123' }, master);
    var f2 = HUB_ACTIONS.candidateProfileDocFile({ candidate: ANN, file_id: 'BobDoddCert0001' }, master);
    var f3 = HUB_ACTIONS.candidateProfileDocFile({ candidate: BOB, file_id: 'BobOldSsFile001' }, master);
    var f4 = HUB_ACTIONS.candidateProfileDocFile({ candidate: ANN, file_id: 'bad id' }, master);
    var f5 = HUB_ACTIONS.candidateProfileDocFile({ candidate: 'CAN_NOBODY0001', file_id: 'AnnResumeFile123' }, master);
    stAssert_(out, P + 'document door: a file the candidate\'s own list names opens as bytes in the SSA door\'s shape; ' +
                   'another candidate\'s file and a superseded upload are 404, a malformed id and an unknown candidate ' +
                   '400, all before Drive is asked',
              f1.status === 200 && f1.data.id === 'AnnResumeFile123' && f1.data.b64 === 'QUJD' &&
              Object.keys(f1.data).sort().join() === 'b64,exported,id,mime,name,size' && f2.status === 404 &&
              f3.status === 404 && f4.status === 400 && f5.status === 400 && bytesAsked.join() === 'AnnResumeFile123',
              JSON.stringify([f1.status, f2, f3, f4, f5, bytesAsked]));

    // ---- activity ----
    var va = seen('activity ann', HUB_ACTIONS.candidateProfileActivity({ candidate: ANN }, master));
    var vi = (va.data && va.data.items) || [];
    var ve = HUB_ACTIONS.candidateProfileActivity({ candidate: EVE }, master);
    stAssert_(out, P + 'activity: the hiring journey\'s steps and notes and the stage moves, newest first, the filer ' +
                   'without the platform\'s prefix; an unreadable journey is said and degraded, never an empty record',
              va.status === 200 && vi.map(function (i) { return i.kind + ':' + i.id; }).join() ===
                'note:jrn_JRN2,stage:' + vi[1].id + ',step:jrn_JRN1' &&
              vi[1].title === 'Stage: New → Phone Screen' && vi[2].by === 'hiring' && vi[0].by === 'recruiter9@example.org' &&
              /SSN \[withheld\]/.test(vi[2].body) && ve.status === 200 && ve.data.degraded === true &&
              /hiring journey could not be read/.test(ve.data.why.join(' ')), JSON.stringify([va, ve]).slice(0, 1500));
    var vb = HUB_ACTIONS.candidateProfileActivity({ candidate: BOB }, master);
    var vbi = (vb.data && vb.data.items) || [];
    stAssert_(out, P + 'activity: a press from this app is its own line — a paper filed is a document, a stage press a ' +
                   'stage move — and the status row that same move wrote is not listed twice',
              vb.status === 200 && vbi.map(function (i) { return i.kind + ':' + i.id; }).join() ===
                'document:jrn_JRN4,stage:jrn_JRN3' && vbi[1].title === 'Update stage' &&
              vbi[1].body === 'Interview → Onboarding' && vbi[1].by === HUB_MASTER_ACCOUNT, JSON.stringify(vb).slice(0, 1200));

    // ---- overview ----
    var oa = seen('overview ann', HUB_ACTIONS.candidateProfileOverview({ candidate: ANN }, master));
    var od = seen('overview dee', HUB_ACTIONS.candidateProfileOverview({ candidate: DEE }, master));
    var oaText = JSON.stringify(oa);
    stAssert_(out, P + 'overview: at a glance, contact and information from the board row and the résumé analysis, the ' +
                   'open actions and documents counted from their own sections, the board\'s next step and the newest ' +
                   'activity; the summary keeps no SSN, date of birth or background-check number',
              oa.status === 200 && oa.data.candidate.location === 'Canton, OH' && oa.data.candidate.applied_at === '2026-09-01' &&
              oa.data.candidate.recruiter === 'recruiter9@example.org' && oa.data.information.experience === '5 years caregiving' &&
              oa.data.information.availability === 'Weekdays and every other weekend' &&
              oa.data.tiles.open_actions === 4 && oa.data.tiles.docs_on_file === 4 && oa.data.tiles.docs_total === 6 &&
              oa.data.next.id === 'ai-report' && oa.data.recent[0].id === 'jrn_JRN2' &&
              /DOB \[withheld\]/.test(oa.data.summary) && /BCI report \[withheld\]/.test(oa.data.summary) &&
              /CJIS: Clear/.test(oa.data.summary) && oaText.indexOf('123-45-6789') === -1 && oaText.indexOf('01/02/1990') === -1 &&
              oaText.indexOf('A12345') === -1,
              oaText.slice(0, 1800));
    stAssert_(out, P + 'overview: a candidate out of the pipeline opens read-only as the Hiring app\'s minimal card, its ' +
                   'status and reason said',
              od.status === 200 && od.data.candidate.archived === true && od.data.candidate.status_label === 'Not Hiring' &&
              od.data.candidate.archived_reason === 'Declined after the phone screen' && od.data.next === null,
              JSON.stringify(od).slice(0, 1200));

    // ---- texts and calls ----
    var ta = seen('texts ann', HUB_ACTIONS.candidateProfileTexts({ candidate: ANN }, master));
    var tc = HUB_ACTIONS.candidateProfileTexts({ candidate: CY }, master);
    var taText = JSON.stringify(ta);
    stAssert_(out, P + 'texts: the Staff app\'s reader over the candidate\'s own phone — one conversation per company ' +
                   'line, newest first, the candidate signs what they sent and the line\'s sole holder what it sent; ' +
                   'a stranger and an SSN written with spaces never appear',
              ta.status === 200 && ta.data.with === '3309197595' && ta.data.counterparts.length === 1 &&
              ta.data.messages.map(function (m) { return m.id; }).join() === 'm2,m1' && ta.data.messages[1].by === 'Ann9 Test' &&
              ta.data.messages[0].by === 'Hera Owner' && ta.data.phones_matched === 1 && taText.indexOf('stranger') === -1 &&
              taText.indexOf('shared phone') === -1 && /SSN is \[withheld\]/.test(taText), taText.slice(0, 1200));
    stAssert_(out, P + 'texts: a phone another candidate\'s record also carries names neither of them, and why says so',
              tc.status === 200 && tc.data.phones_matched === 0 && tc.data.messages.length === 0 &&
              /also belong to someone else/.test(tc.data.why), JSON.stringify(tc));
    var tb = HUB_ACTIONS.candidateProfileTexts({ candidate: ANN_BEFORE }, master);
    var cb = HUB_ACTIONS.candidateProfileTranscripts({ candidate: ANN_BEFORE }, master);
    stAssert_(out, P + 'texts and calls: a re-applicant\'s earlier card on the same phone under the same name is the ' +
                   'same person, not someone else — the new card and the earlier one both read the texts and the calls',
              !/someone else/.test(String(ta.data.why || '')) && tb.status === 200 && tb.data.phones_matched === 1 &&
              tb.data.messages.map(function (m) { return m.id; }).join() === 'm2,m1' && cb.status === 200 &&
              cb.data.calls.map(function (c) { return c.call_id; }).join() === 'AC-2,AC-SCREEN-1',
              JSON.stringify([ta.data.why, tb, cb]).slice(0, 1500));
    var ca = seen('calls ann', HUB_ACTIONS.candidateProfileTranscripts({ candidate: ANN }, master));
    var ce = HUB_ACTIONS.candidateProfileTranscripts({ candidate: EVE }, master);
    stAssert_(out, P + 'transcripts: the calls with the candidate\'s own phone, the one the phone screen names marked as ' +
                   'the phone screen, a screen with no listed call its own entry; metadata only, never the words',
              ca.status === 200 && ca.data.calls.map(function (c) { return c.call_id + ':' + c.kind; }).join() ===
                'AC-2:,AC-SCREEN-1:Phone screen' &&
              ca.data.categories.map(function (c) { return c.name + ':' + c.count; }).join() === 'Phone screen:1' &&
              JSON.stringify(ca).indexOf('SECRET') === -1 && ce.status === 200 &&
              ce.data.calls.map(function (c) { return c.call_id; }).join() === 'screen', JSON.stringify([ca, ce]).slice(0, 1500));
    var doorAsked = [];
    commCallsTranscriptRead_ = function (id, u) {
      doorAsked.push(id + ':' + (u && u.email));
      return { status: 200, data: { call_id: id, full_transcript: 'My SSN is 123-45-6789 and DOB: 01/02/1990',
                                    speaker_transcript: '', has_words: true } };
    };
    var w1 = HUB_ACTIONS.candidateProfileTranscript({ candidate: ANN, id: 'AC-2' }, master);
    var w2 = HUB_ACTIONS.candidateProfileTranscript({ candidate: ANN, id: 'AC-3' }, master);
    var w3 = HUB_ACTIONS.candidateProfileTranscript({ candidate: EVE, id: 'screen' }, master);
    var w4 = HUB_ACTIONS.candidateProfileTranscript({ candidate: ANN, id: 'screen' }, master);
    var w5 = HUB_ACTIONS.candidateProfileTranscript({ candidate: ANN }, master);
    commCallsTranscriptRead_ = keep.transcript;
    stAssert_(out, P + 'transcript: a listed call\'s words come through the transcript reader and leave scrubbed; the phone ' +
                   'screen\'s words come from the Hiring record; a call not listed for the candidate is 404, no id 400',
              w1.status === 200 && w1.data.full_transcript === 'My SSN is [withheld] and DOB [withheld]' &&
              w2.status === 404 && w3.status === 200 && w3.data.full_transcript === 'Eve words, DOB [withheld]' &&
              w3.data.has_words === true && w4.status === 404 && w5.status === 400 &&
              doorAsked.join() === 'AC-2:' + HUB_MASTER_ACCOUNT, JSON.stringify([w1, w2, w3, w4, w5, doorAsked]));
    doorAsked = [];
    logged = [];
    commCallsTranscriptRead_ = function (id) {
      doorAsked.push(id);
      if (id === 'AC-SCREEN-1') return { status: 404, message: 'no transcript on file for that call' };
      return { status: 200, data: { call_id: id, line: '+13309197595', full_transcript: 'words', speaker_transcript: '',
                                    has_words: true } };
    };
    var w6 = HUB_ACTIONS.candidateProfileTranscript({ candidate: ANN, id: 'AC-SCREEN-1' }, master);
    var w7 = HUB_ACTIONS.candidateProfileTranscript({ candidate: ANN, id: 'AC-2' }, master);
    var eveWords = evidence[EVE].screen.transcripttext;
    evidence[EVE].screen.transcripttext = '[0:00] +1 (330) 754-4040: Thanks for calling the screening line.\n' +
                                          '[0:05] +13305550000: Hi, DOB: 03/04/1985\nstill talking';
    var w8 = HUB_ACTIONS.candidateProfileTranscript({ candidate: EVE, id: 'screen' }, master);
    evidence[EVE].screen.transcripttext = eveWords;
    commCallsTranscriptRead_ = keep.transcript;
    stAssert_(out, P + 'transcript: a phone screen whose call the inboxes no longer hold answers the Hiring record\'s own ' +
                   'words, scrubbed; screen words written turn by turn come back as the speaker transcript with the ' +
                   'screening line as ours; a company line the line book names carries its name; each read of the ' +
                   'record\'s words is logged with who asked, never the words',
              w6.status === 200 && w6.data.call_id === 'AC-SCREEN-1' &&
              w6.data.full_transcript === 'Hello, my SSN is [withheld]. Goodbye.' && w6.data.speaker_transcript === '' &&
              w6.data.has_words === true && w7.status === 200 && w7.data.line_name === 'HR line' &&
              w8.status === 200 && w8.data.speaker_transcript === w8.data.full_transcript &&
              /DOB \[withheld\]/.test(w8.data.speaker_transcript) && w8.data.line === '+1' + COMMS_SCREEN_BOT_LINE &&
              doorAsked.join() === 'AC-SCREEN-1,AC-2' && logged.length === 2 &&
              logged.every(function (l) { return l.indexOf('candidateProfileTranscript') !== -1 && l.indexOf(HUB_MASTER_ACCOUNT) !== -1; }) &&
              logged.join().indexOf('Hello') === -1 && logged.join().indexOf('screening line') === -1,
              JSON.stringify([w6, w7, w8, doorAsked, logged]).slice(0, 1500));

    // ---- the résumé ----
    var RESUME = [
      'Maria Q. Lopez',
      '1234 Maple Ave NW, Apt 5, Canton, OH 44702',
      '(330) 555-0111 | maria.resume@example.org',
      'DOB: 01/02/1990 · SSN 123-45-6789',
      'SUMMARY',
      'Compassionate DSP with 7 years of residential care.',
      'PROFESSIONAL EXPERIENCE',
      'Direct Support Professional',
      'Bright Path Residential Services, Canton, OH',
      'June 2019 – Present',
      '• Supported four residents with daily living and medication administration',
      'Home Health Aide | Comfort Keepers | 03/2016 - 05/2019',
      '- Personal care for elderly clients at 77 Oak Street',
      'Cashier — Walmart Supercenter — 2014 to 2016',
      'EDUCATION',
      'Canton South High School, Canton, OH — Diploma, 2012',
      'Stark State College — STNA Program (2016)',
      'CERTIFICATIONS & LICENSES',
      'CPR / First Aid (American Red Cross)',
      'STNA, State of Ohio, License #OH12345678',
      'Valid Ohio driver\'s license',
      'SKILLS',
      'Personal care, Meal preparation; Medication administration • Behavior support',
      'Languages: English (native), Spanish (conversational)',
      'Availability: Weekdays and evenings',
      'Available to start: October 6, 2026',
      'Preferred location: Canton or North Canton',
      'REFERENCES',
      'Jane Roe, 330-555-0199'
    ].join('\n');
    var extracts = [];
    hubExtractResumeText_ = function (fid, why) {
      extracts.push(fid);
      if (fid === 'BobThrowsFile01') throw new Error('st: Drive refused the copy');
      if (fid === 'AnnResumeFile123') return RESUME;
      if (why) why.reason = 'st: a scanned page';
      return '';
    };
    var ra = seen('resume ann', HUB_ACTIONS.candidateProfileResume({ candidate: ANN }, master));
    var ra2 = HUB_ACTIONS.candidateProfileResume({ candidate: ANN }, master);
    var rd = ra.data || {};
    var raText = JSON.stringify(ra);
    stAssert_(out, P + 'résumé: each job the work section dates — role, employer, place and span, whatever the layout — ' +
                   'the schools with their year, the credentials its sections name and the ones its words imply, the ' +
                   'skills, the languages and the summary',
              ra.status === 200 && rd.on_file === true && rd.file_read === true && (rd.work || []).length === 3 &&
              JSON.stringify(rd.work[0]) === JSON.stringify({ role: 'Direct Support Professional',
                employer: 'Bright Path Residential Services', place: 'Canton, OH', from: 'June 2019', to: 'Present' }) &&
              rd.work[1].role === 'Home Health Aide' && rd.work[1].employer === 'Comfort Keepers' &&
              rd.work[1].from === '03/2016' && rd.work[1].to === '05/2019' &&
              rd.work[2].role === 'Cashier' && rd.work[2].employer === 'Walmart Supercenter' && rd.work[2].from === '2014' &&
              JSON.stringify(rd.education) === JSON.stringify([
                { school: 'Canton South High School', degree: 'Diploma', year: '2012', place: 'Canton, OH' },
                { school: 'Stark State College', degree: 'STNA Program', year: '2016', place: '' }]) &&
              JSON.stringify(rd.certifications) === JSON.stringify(['CPR / First Aid (American Red Cross)',
                'STNA, State of Ohio, License [withheld]', 'Valid Ohio driver\'s license']) &&
              rd.skills.join('|') === 'Personal care|Meal preparation|Medication administration|Behavior support' &&
              rd.languages.join('|') === 'English (native)|Spanish (conversational)' &&
              rd.summary === 'Compassionate DSP with 7 years of residential care.',
              raText.slice(0, 1800));
    stAssert_(out, P + 'résumé: the fields the record may lack — experience and availability from the scored analysis ' +
                   'first, where they want to work as stated, the earliest start — and the file converted once for ' +
                   'two reads',
              rd.fields.experience === '5 years caregiving' && rd.fields.availability === 'Weekdays and every other weekend' &&
              rd.fields.preferred_location === 'Canton or North Canton' && rd.fields.preferred_basis === 'stated' &&
              rd.fields.earliest_start === 'October 6, 2026' && extracts.join() === 'AnnResumeFile123' &&
              JSON.stringify(ra2.data) === JSON.stringify(ra.data),
              JSON.stringify([rd.fields, extracts]));
    stAssert_(out, P + 'résumé: nothing of the contact block or a reference leaves — no street, ZIP, phone, e-mail, date ' +
                   'of birth, SSN or licence number — and a street inside a duty line is withheld',
              ['1234 Maple', '44702', '555-0111', 'maria.resume', '01/02/1990', '123-45-6789', 'OH12345678', 'Jane Roe',
               '555-0199', '77 Oak'].every(function (w) { return raText.indexOf(w) === -1; }),
              raText.slice(0, 1500));
    var alt = cndResumeParse_(['JOHN DOE', '456 Oak Street', 'Akron, OH 44301', 'john@example.com | 330.555.1212', '',
      'OBJECTIVE', 'Seeking a DSP position in Akron where I can help adults live independently.', '',
      'WORK EXPERIENCE', 'Jan 2020 - Dec 2021 | Walmart | Stocker', '- Stocked shelves',
      'ABC Care Services — Caregiver (2018-2020)', '  • Helped with meals',
      'Sunrise Homes, Akron, OH', 'Direct Care Worker', '05/2022 – Current', '• Med pass for 6 residents', '',
      'EDUCATION', 'Akron North High School — GED, 2014', '', 'SKILLS', '• Patience', '• Cooking',
      '• Valid driver\'s license; CPR certified', '• Medication administration', '',
      'Languages: Bilingual English/Spanish', 'Available immediately'].join('\n'));
    var altText = JSON.stringify(alt);
    stAssert_(out, P + 'résumé: another layout reads the same way — the span first, last or on its own line, pipes and ' +
                   'dashes, credentials a skills list names (a duty is not one), "available immediately", the place ' +
                   'an objective names — and still nothing of the contact block',
              alt.work.map(function (j) { return [j.role, j.employer, j.place, j.from, j.to].join('/'); }).join('|') ===
                'Stocker/Walmart//Jan 2020/Dec 2021|Caregiver/ABC Care Services//2018/2020|' +
                'Direct Care Worker/Sunrise Homes/Akron, OH/05/2022/Current' &&
              alt.education.length === 1 && alt.education[0].degree === 'GED' &&
              alt.education[0].school === 'Akron North High School' && alt.education[0].year === '2014' &&
              alt.certifications.join() === 'CPR,Driver\'s license' && alt.skills.indexOf('Available immediately') === -1 &&
              alt.earliest_start === 'Immediately' && alt.preferred_location === 'Akron' &&
              alt.experience === '3 jobs listed since 2018 — latest: Stocker at Walmart' &&
              ['456 Oak', '44301', '555.1212', 'john@'].every(function (w) { return altText.indexOf(w) === -1; }),
              altText.slice(0, 1500));
    var eveAnalysis = evidence[EVE].analysis;
    evidence[EVE].analysis = {
      analyzedat: '2026-07-02T10:00:00Z', compositescore: '7', summary: 'Steady DSP; lives at 9 Elm Street.',
      listedcertifications: 'CPR, First Aid', languages: 'English', totalyearscaregiving: '3', city: 'Akron', state: 'OH',
      sourceassetid: 'EveResumeFile01',
      rawpromptoutputjson: JSON.stringify({ WorkHistory: [{ Employer: 'Sunrise Homes', Title: 'DSP', Start: '2020', End: 'Present' }],
                                            Education: ['Akron North High School — Diploma 2015'], Skills: ['Cooking', 'Driving'] })
    };
    var re = HUB_ACTIONS.candidateProfileResume({ candidate: EVE }, master);
    evidence[EVE].analysis = eveAnalysis;
    var rc = HUB_ACTIONS.candidateProfileResume({ candidate: CY }, master);
    var bobLink = board[1].resumeLink;
    board[1].resumeLink = 'https://drive.google.com/file/d/BobScanOnly0001/view';
    var rbScan = HUB_ACTIONS.candidateProfileResume({ candidate: BOB }, master);
    board[1].resumeLink = 'https://drive.google.com/file/d/BobThrowsFile01/view';
    var rbThrow = HUB_ACTIONS.candidateProfileResume({ candidate: BOB }, master);
    board[1].resumeLink = bobLink;
    var red = re.data || {};
    stAssert_(out, P + 'résumé: what the scored analysis already read is used before the file — no conversion when it ' +
                   'carries the work, the schools and the skills; its home is where they live, said as that',
              re.status === 200 && red.file_read === false && extracts.indexOf('EveResumeFile01') === -1 &&
              red.work[0].employer === 'Sunrise Homes' && red.work[0].role === 'DSP' && red.work[0].to === 'Present' &&
              red.education[0].school === 'Akron North High School' && red.education[0].degree === 'Diploma' &&
              red.education[0].year === '2015' && red.skills.join() === 'Cooking,Driving' &&
              red.certifications.join() === 'CPR,First Aid' && red.fields.experience === '3 years caregiving' &&
              red.fields.preferred_location === 'Akron, OH' && red.fields.preferred_basis === 'home' &&
              red.summary === 'Steady DSP; lives at [address withheld]',
              JSON.stringify(re).slice(0, 1500));
    stAssert_(out, P + 'résumé: no file and no analysis is "not on file" with nothing converted; a file with no readable ' +
                   'text says so without failing the read; a conversion that throws is said and degraded, never kept',
              rc.status === 200 && rc.data.on_file === false && rc.data.work.length === 0 && rc.data.fields.experience === '' &&
              rbScan.status === 200 && rbScan.data.file_read === false && rbScan.data.degraded === false &&
              /no text the platform can read \(st: a scanned page\)/.test(rbScan.data.why.join(' ')) &&
              rbThrow.status === 200 && rbThrow.data.degraded === true && /Drive refused the copy/.test(rbThrow.data.why.join(' ')) &&
              extracts.join() === 'AnnResumeFile123,BobScanOnly0001,BobThrowsFile01',
              JSON.stringify([rc, rbScan, rbThrow, extracts]).slice(0, 1500));
    hubExtractResumeText_ = keep.extract;

    // ---- the note ----
    var filed = [];
    journeyLog_ = function (o) { filed.push(clone(o)); return 'JRN_NOTE01'; };
    var bumped = [];
    cacheBump_ = function (scope) { bumped.push(scope); };
    logged = [];
    var nBad = [
      HUB_ACTIONS.candidateProfileNoteAdd({ candidate: ANN, body: '   ' }, master),
      HUB_ACTIONS.candidateProfileNoteAdd({ candidate: ANN, body: new Array(CND_NOTE_MAX + 2).join('y') }, master),
      HUB_ACTIONS.candidateProfileNoteAdd({ candidate: 'CAN_NOBODY0001', body: 'x' }, master)
    ].map(function (r) { return r.status; });
    sheetDbGateHolds_ = function () { return { error: { status: 409, message: 'st: held' } }; };
    var nHeld = HUB_ACTIONS.candidateProfileNoteAdd({ candidate: ANN, body: 'x' }, master);
    sheetDbGateHolds_ = function () { return null; };
    stAssert_(out, P + 'note: an empty or over-long body and an unknown candidate are 400, the held funnel 409 — none of ' +
                   'them reaches the hiring journey or writes a log line',
              nBad.join() === '400,400,400' && nHeld.status === 409 && filed.length === 0 && logged.length === 0,
              JSON.stringify([nBad, nHeld, filed, logged]));
    var nAdd = HUB_ACTIONS.candidateProfileNoteAdd({ candidate: ANN, body: '  Called her back; private words  ',
                                                     by: 'Mallory', id: 'forged', step: 'hired' }, master);
    stAssert_(out, P + 'note: filed on the hiring journey through journeyLog_ — the record the Hiring app reads — as a ' +
                   'note step under the candidate, the filer the session\'s; the sections it changes are retired and the ' +
                   'log names the candidate and never the words',
              nAdd.status === 200 && filed.length === 1 && filed[0].candidate_id === ANN && filed[0].name === 'Ann9 Test' &&
              filed[0].step === 'note' && filed[0].title === 'Note' && filed[0].channel === 'note' &&
              filed[0].detail === 'Called her back; private words' && filed[0].by === HUB_MASTER_ACCOUNT &&
              nAdd.data.note.id === 'jrn_JRN_NOTE01' && nAdd.data.note.by === HUB_MASTER_ACCOUNT &&
              nAdd.data.candidate === ANN &&
              ['candidateProfileActivity', 'candidateProfileOverview'].every(function (a) {
                return bumped.indexOf('cnd_' + a + '_' + ANN) !== -1;
              }) && logged.length === 1 && logged[0].indexOf('candidateProfileNoteAdd') !== -1 &&
              logged[0].indexOf(ANN) !== -1 && logged[0].indexOf('private words') === -1,
              JSON.stringify([nAdd, filed, bumped, logged]));
    journeyLog_ = function () { return ''; };
    var nLost = HUB_ACTIONS.candidateProfileNoteAdd({ candidate: ANN, body: 'x' }, master);
    stAssert_(out, P + 'note: a journey line that could not be written is 503, never a note reported as filed',
              nLost.status === 503 && !nLost.data, JSON.stringify(nLost));
    journeyLog_ = keep.journeyLog;
    cacheBump_ = keep.bump;

    // ---- a press on a Hiring door ----
    var pressed = [], gated = [], busts = 0;
    var answerOf = {};
    Object.keys(CND_DOOR_FIELDS).forEach(function (a) {
      HUB_ACTIONS[a] = function (p, u) {
        pressed.push([a, clone(p), u && u.email]);
        return answerOf[a] || { status: 200, data: { ok: true, candidate_id: p.candidate_id } };
      };
    });
    hubSetDecision_ = function (p, u, how) {
      pressed.push(['setDecision', clone(p), u && u.email, !!(how && how.attest)]);
      return { status: 200, data: { value: p.value, moved_to: 'interview' } };
    };
    hubPolicyGate_ = function (a, p) { gated.push(a + ':' + p.candidate_id); return null; };
    hubBustTalentCache_ = function () { busts++; };
    filed = [];
    journeyLog_ = function (o) { filed.push(clone(o)); return 'JRN_PRESS' + filed.length; };
    bumped = [];
    cacheBump_ = function (scope) { bumped.push(scope); };
    logged = [];
    var press = function (cid, kind, item, fields) {
      return HUB_ACTIONS.candidateProfileDoor({ candidate: cid, press: kind, item: item, fields: fields }, master);
    };
    var p1 = press(ANN, 'complete', 'ai-report', { notes: 'Screened by voice; private words', score: '9',
                                                   candidate_id: 'CAN_SOMEONE0009', base64: 'QUJD' });
    var all7 = CND_PART_ACTIONS.every(function (a) { return bumped.indexOf('cnd_' + a + '_' + ANN) !== -1; });
    stAssert_(out, P + 'press: Mark complete presses the door the step\'s own answer names, for this candidate, with ' +
                   'only the fields that door takes, past its own declared gate; the press is filed on the hiring ' +
                   'journey — who, the step, the door — the sections and the board retired, the log never the words',
              p1.status === 200 && pressed.length === 1 && pressed[0][0] === 'screenManualComplete' &&
              JSON.stringify(pressed[0][1]) === JSON.stringify({ candidate_id: ANN, notes: 'Screened by voice; private words' }) &&
              pressed[0][2] === HUB_MASTER_ACCOUNT && gated.join() === 'screenManualComplete:' + ANN &&
              filed.length === 1 && filed[0].candidate_id === ANN && filed[0].name === 'Ann9 Test' &&
              filed[0].step === 'staff_candidates' && filed[0].title === 'Mark complete' &&
              filed[0].detail === 'AI report — Manual phone screen' && filed[0].ref === 'complete:ai-report' &&
              filed[0].by === HUB_MASTER_ACCOUNT && all7 && busts === 1 && p1.data.logged === true &&
              p1.data.entry.body === 'AI report — Manual phone screen' && p1.data.door === 'screenManualComplete' &&
              JSON.stringify([filed, logged]).indexOf('private words') === -1 &&
              logged.length === 1 && logged[0].indexOf('screenManualComplete') !== -1 && logged[0].indexOf(ANN) !== -1,
              JSON.stringify([p1, pressed, gated, filed, logged]).slice(0, 1800));
    pressed = []; filed = []; gated = [];
    var p2 = press(ANN, 'complete', 'advance-decision', {});
    stAssert_(out, P + 'press: the advance decision is its one writer\'s, attested as the signed-in board\'s Accept, and ' +
                   'the line says where the card went',
              p2.status === 200 && pressed.length === 1 && pressed[0][0] === 'setDecision' && pressed[0][3] === true &&
              JSON.stringify(pressed[0][1]) ===
                JSON.stringify({ candidate_id: ANN, checkpoint: 'advance-decision', value: 'Advance' }) &&
              filed.length === 1 && filed[0].detail === 'Advance decision — Advance; moved to Interview',
              JSON.stringify([p2, pressed, filed]));
    pressed = []; filed = []; gated = []; bumped = []; busts = 0;
    var refusals = [
      press(ANN, 'complete', 'resume-decision', {}), press(ANN, 'complete', 'transcript', {}),
      press(ANN, 'complete', 'no-such-step', {}), press(ANN, 'stage', 'interview', {}), press(ANN, 'stage', 'phone-screen', {}),
      press(ANN, 'reopen', 'ai-report', {}), press(DEE, 'stage', 'new', {}), press(BOB, 'upload', 'doc_drivers_id', {}),
      press('CAN_NOBODY0001', 'complete', 'ai-report', {})
    ];
    stAssert_(out, P + 'press: a closed step, a step with no door here, an unknown step, a stage the gate holds, the ' +
                   'current stage, an unknown press, a candidate out of the pipeline, a paper on file and an unknown ' +
                   'candidate are refused before any door, and nothing is filed or retired',
              refusals.map(function (r) { return r.status; }).join() === '409,409,400,409,400,400,409,409,400' &&
              /Still needed: screen Completed/.test(refusals[3].message) && /out of the Hiring pipeline/.test(refusals[6].message) &&
              /already on file/.test(refusals[7].message) && pressed.length === 0 && gated.length === 0 &&
              filed.length === 0 && bumped.length === 0 && busts === 0,
              JSON.stringify(refusals).slice(0, 1800));
    answerOf.moveStage = { status: 400, already_at: 'onboarding', message: 'Cy9 Interview is already at Onboarding — reload to see it.' };
    var p3 = press(CY, 'stage', 'onboarding', {});
    delete answerOf.moveStage;
    var p3Filed = filed.length;
    var p4 = press(CY, 'stage', 'onboarding', { notes: 'x' });
    stAssert_(out, P + 'press: the door\'s own refusal comes back whole — already_at included — and files nothing; a ' +
                   'stage move presses moveStage with the stage its answer named and files "from → to"',
              p3.status === 400 && p3.already_at === 'onboarding' && p3Filed === 0 && p4.status === 200 &&
              JSON.stringify(pressed[pressed.length - 1]) ===
                JSON.stringify(['moveStage', { candidate_id: CY, to_stage: 'onboarding' }, HUB_MASTER_ACCOUNT]) &&
              filed.length === 1 && filed[0].title === 'Update stage' && filed[0].detail === 'Interview → Onboarding' &&
              filed[0].ref === 'stage:onboarding',
              JSON.stringify([p3, p4, pressed, filed]).slice(0, 1500));
    pressed = []; filed = [];
    var file = { filename: 'card.pdf', mime_type: 'application/pdf', base64: 'QUJD', notes: 'not for this door' };
    var p5 = press(BOB, 'upload', 'doc_car_insurance', file);
    var p6 = press(BOB, 'upload', 'doc_ss_birth', file);
    stAssert_(out, P + 'press: Upload files the paper through the Hiring table\'s upload door with the catalog id its ' +
                   'answer named — one the board\'s own map does not know included — and the line names the paper',
              p5.status === 200 && p6.status === 200 && pressed.length === 2 &&
              JSON.stringify(pressed[0][1]) === JSON.stringify({ candidate_id: BOB, item_id: 'car_insurance',
                doc_id: 'car_insurance', filename: 'card.pdf', mime_type: 'application/pdf', base64: 'QUJD',
                candidate_name: 'Bob9 Onboard', email: 'bob9@example.org' }) &&
              pressed[1][1].item_id === 'ss-card' && pressed[1][1].doc_id === 'ss_birth' &&
              filed[0].title === 'Document filed' && filed[0].detail === 'Car Insurance Card: card.pdf' &&
              filed[0].ref === 'upload:doc_car_insurance' && filed[1].detail === 'SS Card / Birth Certificate: card.pdf',
              JSON.stringify([p5, pressed, filed]).slice(0, 1500));
    pressed = []; filed = [];
    answerOf.onboardingManualComplete = { status: 200, data: { completed: true, moved: false, stage: 'onboarding' } };
    var pHeld = press(BOB, 'stage', 'hired', { notes: 'Walked through by e-mail' });
    answerOf.onboardingManualComplete = { status: 200, data: { completed: true, moved: true, stage: 'hired' } };
    var pMoved = press(BOB, 'complete', 'onboarding-complete', {});
    delete answerOf.onboardingManualComplete;
    stAssert_(out, P + 'press: the line says what the door did — a move to Hired the packet held says the card stays, a ' +
                   'manual onboarding that moved the card says where it went',
              pHeld.status === 200 && pMoved.status === 200 &&
              filed.map(function (f) { return f.detail; }).join(' | ') ===
                'Onboarding → Hired; the card stays at Onboarding | Onboarding open — Manual onboarding; moved to Hired' &&
              pressed[0][1].notes === 'Walked through by e-mail',
              JSON.stringify([pHeld, pMoved, filed, pressed]).slice(0, 1500));
    pressed = []; filed = [];
    hubPolicyGate_ = function () { return { status: 403, message: 'st: the door\'s gate' }; };
    var p7 = press(ANN, 'complete', 'ai-report', {});
    hubPolicyGate_ = function () { return null; };
    sheetDbGateHolds_ = function () { return { error: { status: 409, message: 'st: held' } }; };
    var p8 = press(ANN, 'complete', 'ai-report', {});
    sheetDbGateHolds_ = function () { return null; };
    stAssert_(out, P + 'press: the door\'s own declared gate and a held journey refuse before the door, and nothing is filed',
              p7.status === 403 && p8.status === 409 && pressed.length === 0 && filed.length === 0,
              JSON.stringify([p7, p8, pressed, filed]));
    journeyLog_ = function () { return ''; };
    var p9 = press(ANN, 'complete', 'ai-report', {});
    stAssert_(out, P + 'press: a door that landed is never reported as refused — when its line cannot be filed the ' +
                   'answer says so',
              p9.status === 200 && pressed.length === 1 && p9.data.logged === false && p9.data.entry === null &&
              /could not be filed on the hiring journey/.test(p9.data.why), JSON.stringify(p9));
    journeyLog_ = keep.journeyLog;
    cacheBump_ = keep.bump;
    hubPolicyGate_ = keep.policyGate;
    hubSetDecision_ = keep.decide;
    hubBustTalentCache_ = keep.bust;
    Object.keys(keep.hiring).forEach(function (a) { HUB_ACTIONS[a] = keep.hiring[a]; });

    // ---- a step's paper: read by the decoder before any door takes it ---- the code's own decoder tables…
    DIGEST_VOCAB = { kinds: [], categories: [], labels: [], issuers: [], orgs: [], drawers: [], credentials: [],
                     answers: [], expects: [], zip: {}, types: {}, settings: {}, bad: 0, source: 'seed', v: 'seed' };
    DIGEST_ROSTER = [];
    var PAPERS = {
      'bci.pdf': 'Ohio Attorney General\nBureau of Criminal Investigation\nWebCheck Background Check Result\n' +
                 'Name: Ann9 Test\nDate of Birth: 01/02/1990\nSSN: 123-45-6789\nBCI Completion Date: 09/10/2026\n' +
                 'Result: No Record Found',
      'cpr.pdf': 'American Red Cross Training Services\nCertificate of Completion\nAnn9 Test\n' +
                 'has successfully completed requirements for\nAdult First Aid/CPR/AED\nDate Completed: 4/17/2026\n' +
                 'Valid Until: 4/17/2028',
      'other.pdf': 'Ohio Attorney General\nBureau of Criminal Investigation\nWebCheck Background Check Result\n' +
                   'Name: Zed Other\nBCI Completion Date: 09/10/2026\nResult: No Record Found',
      'eve-bci.pdf': 'Ohio Attorney General\nBureau of Criminal Investigation\nWebCheck Background Check Result\n' +
                     'Name: Eve9 Hired\nBCI Completion Date: 09/12/2026\nConvictions on file: see the attached criminal history',
      'packet.pdf': 'Offer of Employment\nDear Bob9 Onboard,\nWe are pleased to offer you the position. Your rate of pay ' +
                    'is 15.00 an hour and your start date of October 1.\nEmployment Eligibility Verification\nForm I-9\n' +
                    'Employee Name: Bob9 Onboard\nDate signed: 09/20/2026',
      'licence.jpg': 'OHIO\nDriver License\nBOB9 ONBOARD\nDOB 01/02/1990\nISS 03/01/2025\nEXP 04/17/2029\nClass D\n' +
                     'Bureau of Motor Vehicles',
      'resume.docx': 'Bob9 Onboard\nProfessional Summary\nFive years of direct care.\nWork Experience\nCaregiver\nSkills\n' +
                     'Education',
      // one agency clear, the other with convictions: the record wins
      'mixed.pdf': 'Ohio Attorney General\nBureau of Criminal Investigation\nWebCheck Background Check Result\n' +
                   'Name: Ann9 Test\nBCI Completion Date: 09/10/2026\nFBI: No record found\n' +
                   'BCI: Convictions on file - see the attached criminal history',
      // what a file is called is not what it is
      'CJIS_Ann9_Test.pdf': 'Thanks for shopping with us\nNot found items will be refunded\nTotal 12.00',
      'Resume.pdf': 'Dear grandma,\nthe garden is lovely this year and the tomatoes are red.',
      // one form of the packet, not the packet
      'w4.pdf': 'Form W-4\nEmployee\'s Withholding Certificate\nBob9 Onboard\nDate signed: 09/20/2026',
      'bob-bci.pdf': 'Ohio Attorney General\nBureau of Criminal Investigation\nWebCheck Background Check Result\n' +
                     'Name: Bob9 Onboard\nBCI Completion Date: 09/14/2026\nResult: No Record Found'
    };
    var readAsked = [];
    var evStub = hubEvidence_;
    var onFileAs = function (cid, st) { evidence[cid].analysis.cjisstatus = st; };
    digestUploadText_ = function (b64, mime, name) {
      readAsked.push(name + ':' + mime);
      if (name === 'broken.pdf') throw new Error('st: Drive would not convert it');
      return PAPERS[name] || '';
    };
    pressed = []; gated = []; busts = 0; filed = []; bumped = []; logged = [];
    answerOf = {};
    var doorAnswer = function (a, p) {
      if (answerOf[a]) return answerOf[a];
      if (a === 'tableDocUpload' && p.item_id === 'resume') {
        return { status: 200, data: { resume_link: 'https://drive.google.com/file/d/ResumeFiled0001/view' } };
      }
      if (a === 'tableDocUpload' && p.item_id === 'cjis') {
        return { status: 200, data: { cjis_status: p.status, cjis_report_url: 'https://drive.google.com/file/d/CjisFiled00001/view' } };
      }
      if (a === 'packetWaive') return { status: 200, data: { candidate_id: p.candidate_id, state: 'waived', released: false } };
      return { status: 200, data: { doc: { file_id: 'DocFiled000001', doc_id: p.doc_id } } };
    };
    ['tableDocUpload', 'packetWaive', 'docUpload'].forEach(function (a) {
      HUB_ACTIONS[a] = function (p, u) { pressed.push([a, clone(p), u && u.email]); return doorAnswer(a, p); };
    });
    hubPolicyGate_ = function (a, p) { gated.push(a + ':' + p.candidate_id); return null; };
    hubBustTalentCache_ = function () { busts++; };
    journeyLog_ = function (o) { filed.push(clone(o)); return 'JRN_DOC' + filed.length; };
    cacheBump_ = function (scope) { bumped.push(scope); };
    var paper = function (cid, item, name, mime, extra) {
      var f = { filename: name, mime_type: mime, base64: 'QUJD' };
      Object.keys(extra || {}).forEach(function (k) { f[k] = extra[k]; });
      return HUB_ACTIONS.candidateProfileDoor({ candidate: cid, press: 'document', item: item, fields: f }, master);
    };
    var nothing = function () { return pressed.length + gated.length + filed.length + bumped.length + busts; };
    var privateOut = function (r) {
      var s = JSON.stringify(r);
      return s.indexOf('01/02/1990') === -1 && s.indexOf('1990-01-02') === -1 && s.indexOf('123-45-6789') === -1 &&
             s.indexOf('6789') === -1;
    };

    var pa = HUB_ACTIONS.candidateProfileActions({ candidate: ANN }, master);
    var pb = HUB_ACTIONS.candidateProfileActions({ candidate: BOB }, master);
    stAssert_(out, P + 'document: each open step that takes a paper says what it asks for, what the decoder must read ' +
                   'it as, where it is filed and the files it takes — the background check a PDF on the Hiring record ' +
                   'with the four results a person picks from, the résumé on the Hiring record also as a Word file, ' +
                   'the unsigned New Hire packet into Onboarding Documents; a closed step and a step with no paper ' +
                   'take none',
              by(pa, 'cjis').paper && by(pa, 'cjis').paper.asks === 'Background check (BCI)' &&
              by(pa, 'cjis').paper.expects === 'a background check' && by(pa, 'cjis').paper.where === 'the Hiring record' &&
              by(pa, 'cjis').paper.pdf_only === true && by(pa, 'cjis').paper.exts.join() === 'pdf' &&
              by(pa, 'cjis').paper.statuses.join() === 'Pending,Clear,Verified,Disqualified' &&
              by(pa, 'resume').paper === null &&
              by(pa, 'ai-report').paper === null && by(pa, 'application').paper === null &&
              by(pb, 'resume').paper.asks === 'Résumé' && by(pb, 'resume').paper.expects === 'a résumé or application' &&
              by(pb, 'resume').paper.where === 'the Hiring record' &&
              by(pb, 'resume').paper.exts.join() === 'pdf,jpg,jpeg,png,gif,doc,docx' &&
              by(pb, 'resume').paper.statuses.length === 0 &&
              by(pb, 'new-hire-packet').paper.where === 'Onboarding Documents' &&
              by(pb, 'new-hire-packet').paper.exts.join() === 'pdf,jpg,jpeg,png,gif' &&
              by(pb, 'new-hire-packet').paper.choices.length === 0 && by(pb, 'onboarding-complete').paper === null,
              JSON.stringify([by(pa, 'cjis').paper, by(pb, 'resume').paper, by(pb, 'new-hire-packet').paper]));

    var d1 = paper(ANN, 'cjis', 'bci.pdf', 'application/pdf', { check: true });
    stAssert_(out, P + 'document: a check reads the paper and answers what the decoder read — a background check, ' +
                   'the candidate\'s own name, its result and its date — against what the step asks, with Clear only ' +
                   'as the result it suggests for a person to confirm, and writes nothing; no date of birth or SSN leaves',
              d1.status === 200 && d1.data.verified === true && d1.data.reason === '' && d1.data.check === true &&
              d1.data.filed === false && d1.data.read_as === 'a background check' &&
              d1.data.reading.name_check === 'match' && d1.data.reading.result === 'clear' &&
              d1.data.reading.issued_on === '2026-09-10' && d1.data.cjis_status === 'Clear' &&
              d1.data.cjis_on_file === '' && d1.data.closes === true &&
              d1.data.asks === 'Background check (BCI)' && readAsked.join() === 'bci.pdf:application/pdf' &&
              nothing() === 0 && privateOut(d1), JSON.stringify(d1));

    var d2 = paper(ANN, 'cjis', 'bci.pdf', 'application/pdf', { cjis_status: 'Clear' });
    stAssert_(out, P + 'document: a paper that reads as what the step asks is filed through the step\'s own Hiring ' +
                   'door — the background check with the result the person picked — past that door\'s gate; before ' +
                   'the packet is signed nothing goes to Onboarding Documents; one line on the hiring journey says ' +
                   'what was filed, what it was read as and the result written, and the sections are read again',
              d2.status === 200 && d2.data.filed === true && d2.data.override === false && pressed.length === 1 &&
              JSON.stringify(pressed[0]) === JSON.stringify(['tableDocUpload', { candidate_id: ANN, filename: 'bci.pdf',
                mime_type: 'application/pdf', base64: 'QUJD', candidate_name: 'Ann9 Test', email: 'ann9@example.org',
                item_id: 'cjis', status: 'Clear' }, HUB_MASTER_ACCOUNT]) &&
              gated.join() === 'tableDocUpload:' + ANN && filed.length === 1 && filed[0].step === 'staff_candidates' &&
              filed[0].title === 'Document filed' && filed[0].ref === 'document:cjis' &&
              filed[0].detail === 'Background check (BCI) — bci.pdf (read as a background check); background result Clear' &&
              filed[0].by === HUB_MASTER_ACCOUNT && busts === 1 &&
              CND_PART_ACTIONS.every(function (a) { return bumped.indexOf('cnd_' + a + '_' + ANN) !== -1; }) &&
              d2.data.where === 'the Hiring record' && d2.data.logged === true && d2.data.entry.id === 'jrn_JRN_DOC1' &&
              d2.data.cjis_status === 'Clear' && d2.data.closes === true &&
              d2.data.doors.map(function (x) { return x.action + ':' + x.status; }).join() === 'tableDocUpload:200' &&
              privateOut(d2) && privateOut(filed) && privateOut(logged), JSON.stringify([d2, pressed, filed]).slice(0, 1800));

    // ---- the background result: a person's, never the reading's ----
    var result = function (cid, name, extra) {
      pressed = []; filed = [];
      var r = paper(cid, 'cjis', name, 'application/pdf', extra);
      return [r.status, r.data ? r.data.cjis_status : r.message, pressed.length ? pressed[0][1].status : '-'].join('|');
    };
    var rNone = result(ANN, 'bci.pdf', {});
    var rMixedCheck = result(ANN, 'mixed.pdf', { check: true });
    var rMixed = paper(ANN, 'cjis', 'mixed.pdf', 'application/pdf', { check: true });
    onFileAs(ANN, 'Clear');
    var rKeepClear = result(ANN, 'bci.pdf', {});
    var rKeepRecords = result(ANN, 'mixed.pdf', {});
    var rKeepOverride = result(ANN, 'cpr.pdf', { confirm_mismatch: true });
    onFileAs(ANN, 'verified');
    var rKeepVerified = result(ANN, 'bci.pdf', {});
    onFileAs(ANN, 'Disqualified');
    var rDqCheck = result(ANN, 'bci.pdf', { check: true });
    var rDq = result(ANN, 'bci.pdf', {});
    var rPicked = result(ANN, 'bci.pdf', { cjis_status: 'Verified' });
    onFileAs(ANN, '');
    readAsked = [];
    var rBadPick = result(ANN, 'bci.pdf', { cjis_status: 'Cleared' });
    var badReads = readAsked.length;
    hubEvidence_ = function () { throw new Error('st: the analyses are shut'); };
    var rShut = result(ANN, 'bci.pdf', {});
    var rShutPicked = result(ANN, 'bci.pdf', { cjis_status: 'Pending' });
    hubEvidence_ = evStub;
    stAssert_(out, P + 'document: the background result is never one the reading made — with no result picked a clear ' +
                   'paper files Pending; a report whose one line reads convictions reads records and suggests Pending ' +
                   'though another line reads no record; a Clear or Verified on file stands only under a paper taken as ' +
                   'a background check that reads no record, Disqualified always; a person\'s pick is written as picked; ' +
                   'a pick outside the engine\'s four is refused before the decoder reads; an unreadable result on file ' +
                   'is never written over unless a person picked one',
              rNone === '200|Pending|Pending' && rMixedCheck === '200|Pending|-' &&
              rMixed.data.verified === true && rMixed.data.reading.result === 'records' &&
              rKeepClear === '200|Clear|Clear' && rKeepRecords === '200|Pending|Pending' &&
              rKeepOverride === '200|Pending|Pending' && rKeepVerified === '200|Verified|Verified' &&
              rDqCheck === '200|Disqualified|-' && rDq === '200|Disqualified|Disqualified' &&
              rPicked === '200|Verified|Verified' &&
              /^400\|cjis_status: Pending, Clear, Verified, Disqualified\. Nothing was written\.\|-$/.test(rBadPick) &&
              badReads === 0 && /^503\|The background result on file could not be read/.test(rShut) &&
              /Nothing was written\.\|-$/.test(rShut) && rShutPicked === '200|Pending|Pending',
              JSON.stringify([rNone, rMixedCheck, rMixed.data && rMixed.data.reading, rKeepClear, rKeepRecords,
                              rKeepOverride, rKeepVerified, rDqCheck, rDq, rPicked, rBadPick, badReads, rShut,
                              rShutPicked]));

    // ---- what a paper is comes from its words, never its file name ----
    pressed = []; gated = []; busts = 0; filed = []; bumped = []; logged = [];
    var dName = paper(ANN, 'cjis', 'CJIS_Ann9_Test.pdf', 'application/pdf');
    var dNameResume = paper(BOB, 'resume', 'Resume.pdf', 'application/pdf', { check: true });
    stAssert_(out, P + 'document: a paper whose words are not a background check is not one because its file is named ' +
                   'CJIS — a receipt reading "not found" is read as nothing and files nothing — and a letter named ' +
                   'Resume is no résumé',
              dName.status === 200 && dName.data.verified === false && dName.data.reason === 'kind' &&
              dName.data.read_as === '' && dName.data.reading.result === '' && dName.data.filed === false &&
              dNameResume.data.verified === false && dNameResume.data.reason === 'kind' && nothing() === 0,
              JSON.stringify([dName, dNameResume]).slice(0, 1500));

    pressed = []; gated = []; busts = 0; filed = []; bumped = []; logged = [];
    var d3 = paper(ANN, 'cjis', 'cpr.pdf', 'application/pdf');
    var d4 = paper(ANN, 'cjis', 'other.pdf', 'application/pdf');
    var d5 = paper(ANN, 'cjis', 'broken.pdf', 'application/pdf');
    var d5b = paper(ANN, 'cjis', 'blank.pdf', 'application/pdf');
    var d5c = paper(BOB, 'resume', 'photo.heic', 'image/heic', { check: true });
    stAssert_(out, P + 'document: a paper that reads as something else, one that names someone else, one the decoder ' +
                   'could not read and one with no words answer verified:false with what it was read as, why and the ' +
                   'reason a screen words it by, and change nothing — no door, no journey line, no section retired',
              d3.status === 200 && d3.data.verified === false && d3.data.filed === false && d3.data.reason === 'kind' &&
              d3.data.read_as === 'a CPR / First Aid card' &&
              d3.data.why === 'This reads as a CPR / First Aid card — not Background check (BCI). Nothing was written.' &&
              d4.status === 200 && d4.data.verified === false && d4.data.reading.name_check === 'other' &&
              d4.data.reason === 'person' && d4.data.read_as === 'a background check' &&
              /names Zed Other, not Ann9 Test/.test(d4.data.why) && d5.status === 200 && d5.data.verified === false &&
              d5.data.reason === 'unread' && d5.data.reading.state === 'error' &&
              /decoder could not read this file \(st: Drive would not convert it\)/.test(d5.data.why) &&
              d5b.data.reason === 'unread' && d5b.data.reading.state === 'empty' &&
              d5c.status === 200 && d5c.data.reason === 'unread' && d5c.data.reading.state === 'heic' && nothing() === 0,
              JSON.stringify([d3, d4, d5, d5b, d5c]).slice(0, 1800));

    var d6 = paper(ANN, 'cjis', 'cpr.pdf', 'application/pdf', { confirm_mismatch: true });
    stAssert_(out, P + 'document: the master may file a paper that does not match anyway — it goes through the same ' +
                   'door, the background check Pending for a person to decide, and the journey line says override',
              d6.status === 200 && d6.data.filed === true && d6.data.override === true && d6.data.verified === false &&
              pressed.length === 1 && pressed[0][1].status === 'Pending' && filed.length === 1 &&
              d6.data.closes === false && d6.data.closes_why === 'A Pending background result leaves the step open.' &&
              filed[0].detail === 'Background check (BCI) — cpr.pdf (read as a CPR / First Aid card, override); ' +
                                  'background result Pending',
              JSON.stringify([d6, pressed, filed]).slice(0, 1500));

    pressed = []; gated = []; busts = 0; filed = []; bumped = []; logged = []; readAsked = [];
    var d7 = paper(BOB, 'new-hire-packet', 'packet.pdf', 'application/pdf');
    stAssert_(out, P + 'document: an unsigned New Hire packet on paper whose words show the whole packet — its offer ' +
                   'letter and its I-9 — is filed into Onboarding Documents through the Hiring table\'s upload with its ' +
                   'catalog id, with the date read off it, then attested on file by packetWaive naming that very file ' +
                   '— the step the Hiring board shows closes',
              d7.status === 200 && d7.data.filed === true && d7.data.where === 'Onboarding Documents' &&
              d7.data.closes === true && d7.data.closes_why === '' &&
              pressed.map(function (x) { return x[0]; }).join() === 'tableDocUpload,packetWaive' &&
              pressed[0][1].item_id === 'new-hire-packet' && pressed[0][1].doc_id === 'dropbox_packet' &&
              pressed[0][1].issued_on === '2026-09-20' &&
              pressed[0][1].notes === 'Filed from Staff Candidates; read as an offer letter' &&
              pressed[1][1].candidate_id === BOB && pressed[1][1].file_id === 'DocFiled000001' &&
              pressed[1][1].note === 'Signed packet filed from Staff Candidates: packet.pdf (read as the whole packet: ' +
                                     'an offer letter and its forms)' &&
              gated.join() === 'tableDocUpload:' + BOB + ',packetWaive:' + BOB && filed.length === 1 &&
              filed[0].ref === 'document:new-hire-packet' &&
              filed[0].detail === 'New Hire Packet (Dropbox Sign) — packet.pdf (read as an offer letter); New Hire ' +
                                  'packet on file',
              JSON.stringify([d7, pressed, filed]).slice(0, 1800));

    pressed = []; gated = []; filed = [];
    var d7c = paper(BOB, 'new-hire-packet', 'w4.pdf', 'application/pdf', { check: true });
    var d7w = paper(BOB, 'new-hire-packet', 'w4.pdf', 'application/pdf');
    var d7o = paper(BOB, 'new-hire-packet', 'cpr.pdf', 'application/pdf', { confirm_mismatch: true });
    stAssert_(out, P + 'document: one form of the packet — a lone W-4 — is taken as that form and deposited in ' +
                   'Onboarding Documents, but never attested as the signed packet: no packetWaive, the step stays open ' +
                   'for Mark complete and the answer says why; a paper filed anyway attests nothing either',
              d7c.data.verified === true && d7c.data.read_as === 'a tax form' && d7c.data.closes === false &&
              /one form of the packet, not the whole signed packet/.test(d7c.data.closes_why) &&
              d7w.data.filed === true && d7w.data.closes === false && d7o.data.filed === true && d7o.data.closes === false &&
              /is not read as the signed packet/.test(d7o.data.closes_why) &&
              pressed.map(function (x) { return x[0]; }).join() === 'tableDocUpload,tableDocUpload' &&
              pressed[0][1].doc_id === 'dropbox_packet' && pressed[1][1].issued_on === undefined &&
              filed.length === 2 && /; the step stays open$/.test(filed[0].detail),
              JSON.stringify([d7c, d7w, d7o, pressed, filed]).slice(0, 1800));

    pressed = []; gated = []; filed = [];
    board[3].packet = { state: 'signed', label: 'Signed' };
    var d8 = paper(EVE, 'cjis', 'eve-bci.pdf', 'application/pdf');
    stAssert_(out, P + 'document: once the New Hire packet is signed a background check is filed through the step\'s ' +
                   'own door — Pending, with no result picked and records on file — and deposited in Onboarding ' +
                   'Documents under its catalog id',
              d8.status === 200 && d8.data.filed === true && d8.data.where === 'Onboarding Documents and the Hiring record' &&
              d8.data.reading.result === 'records' && d8.data.cjis_status === 'Pending' &&
              pressed.map(function (x) { return x[0]; }).join() === 'tableDocUpload,docUpload' &&
              pressed[0][1].status === 'Pending' && pressed[1][1].doc_id === 'background_check' &&
              pressed[1][1].candidate_id === EVE && pressed[1][1].issued_on === '2026-09-12' &&
              d8.data.doors.map(function (x) { return x.action + ':' + x.status; }).join() === 'tableDocUpload:200,docUpload:200',
              JSON.stringify([d8, pressed]).slice(0, 1500));
    pressed = []; filed = [];
    answerOf.docUpload = { status: 500, message: 'st: the folder is shut' };
    var d9 = paper(EVE, 'cjis', 'eve-bci.pdf', 'application/pdf');
    delete answerOf.docUpload;
    stAssert_(out, P + 'document: a deposit that fails after the step\'s own door landed is said, never reported as ' +
                   'nothing filed',
              d9.status === 200 && d9.data.filed === true && filed.length === 1 &&
              d9.data.filing_why === 'Onboarding Documents did not take it: st: the folder is shut',
              JSON.stringify(d9));

    var boardBob = clone(board[1]);
    board[1].packet = { state: 'signed', label: 'Signed' };
    board[1].checklist = board[1].checklist.map(function (c) {
      return c.id === 'new-hire-packet' ? { id: c.id, label: c.label, owner: c.owner, stage: c.stage, status: 'done' } : c;
    });
    var ps1 = HUB_ACTIONS.candidateProfileActions({ candidate: BOB }, master);
    var choices = (by(ps1, 'new-hire-packet').paper || { choices: [] }).choices;
    pressed = []; gated = []; filed = [];
    var d10 = paper(BOB, 'new-hire-packet', 'licence.jpg', 'image/jpeg', { doc: 'drivers_id' });
    var d11 = paper(BOB, 'new-hire-packet', 'licence.jpg', 'image/jpeg', {});
    var d12 = paper(BOB, 'new-hire-packet', 'licence.jpg', 'image/jpeg', { doc: 'dropbox_packet' });
    var pressed10 = pressed.slice(), filed10 = filed.slice();
    pressed = []; gated = []; filed = [];
    var d13 = paper(BOB, 'new-hire-packet', 'bob-bci.pdf', 'application/pdf', { doc: 'background_check' });
    var pressed13 = pressed.slice();
    board[1].checklist = board[1].checklist.concat([{ id: 'cjis', label: 'CJIS', owner: 'HR', stage: 'new', status: 'pending' }]);
    var withCjis = (by(HUB_ACTIONS.candidateProfileActions({ candidate: BOB }, master), 'new-hire-packet').paper ||
                    { choices: [] }).choices;
    board[1] = boardBob;
    stAssert_(out, P + 'document: once the New Hire packet is signed its step takes the new hire\'s other papers — ' +
                   'every catalog paper but the packet\'s own — each read as itself and filed into Onboarding Documents ' +
                   'through the door the Documents section uploads with, the dates read off it and never the date of ' +
                   'birth; which paper it is must be said',
              choices.map(function (c) { return c.doc_id; }).join() ===
                'dodd_8hr,cpr_first_aid,med_del,drivers_id,hs_diploma,ss_birth,background_check,car_insurance' &&
              choices.filter(function (c) { return c.doc_id === 'drivers_id'; })[0].expects ===
                'a driver\'s license or a state ID' &&
              d10.status === 200 && d10.data.verified === true && d10.data.filed === true && d10.data.closes === null &&
              d10.data.where === 'Onboarding Documents' && pressed10.length === 1 &&
              JSON.stringify(pressed10[0][1]) === JSON.stringify({ candidate_id: BOB, filename: 'licence.jpg',
                mime_type: 'image/jpeg', base64: 'QUJD', candidate_name: 'Bob9 Onboard', email: 'bob9@example.org',
                item_id: 'drivers-license', doc_id: 'drivers_id', issued_on: '2025-03-01', expires_on: '2029-04-17',
                notes: 'Filed from Staff Candidates; read as a driver\'s license' }) &&
              filed10.length === 1 && filed10[0].ref === 'document:new-hire-packet:drivers_id' &&
              d11.status === 400 && d12.status === 400 && /which of the new hire/.test(d11.message) &&
              privateOut(d10) && privateOut(pressed10), JSON.stringify([choices, d10, pressed10, d11, d12]).slice(0, 1800));
    stAssert_(out, P + 'document: with the CJIS step closed, a background check the new hire brings is one of those ' +
                   'papers — deposited in Onboarding Documents under its catalog id with the date read off it, through ' +
                   'the deposit itself and never the Hiring table\'s CJIS upload, so no background result is written; ' +
                   'while the CJIS step is open it stays that step\'s paper',
              d13.status === 200 && d13.data.verified === true && d13.data.filed === true && d13.data.cjis_status === '' &&
              pressed13.length === 1 && pressed13[0][0] === 'docUpload' &&
              JSON.stringify(pressed13[0][1]) === JSON.stringify({ candidate_id: BOB, filename: 'bob-bci.pdf',
                mime_type: 'application/pdf', base64: 'QUJD', candidate_name: 'Bob9 Onboard', email: 'bob9@example.org',
                doc_id: 'background_check', issued_on: '2026-09-14',
                notes: 'Filed from Staff Candidates; read as a background check' }) &&
              withCjis.map(function (c) { return c.doc_id; }).indexOf('background_check') === -1 && withCjis.length === 7,
              JSON.stringify([d13, pressed13, withCjis]).slice(0, 1800));

    // ---- a Word résumé, where the résumé's own door takes one ----
    pressed = []; gated = []; filed = []; readAsked = [];
    var DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    var w1 = paper(BOB, 'resume', 'resume.docx', DOCX);
    var w2 = paper(BOB, 'resume', 'resume.docx', '');
    var w3 = paper(BOB, 'resume', 'resume.docx', 'text/plain');
    var w4 = paper(ANN, 'cjis', 'resume.docx', DOCX);
    var boardBobWord = clone(board[1]);
    board[1].packet = { state: 'signed', label: 'Signed' };
    board[1].checklist = board[1].checklist.map(function (c) {
      return c.id === 'new-hire-packet' ? { id: c.id, label: c.label, owner: c.owner, stage: c.stage, status: 'done' } : c;
    });
    var w5 = paper(BOB, 'new-hire-packet', 'licence.docx', DOCX, { doc: 'drivers_id' });
    board[1] = boardBobWord;
    stAssert_(out, P + 'document: the résumé step takes a Word résumé — read by the decoder and filed through the ' +
                   'résumé\'s own door as that type — while a Word file with a type that disagrees, a Word file where ' +
                   'the door keeps a PDF and a Word file for the new hire\'s papers are refused before anything is read',
              w1.status === 200 && w1.data.verified === true && w1.data.read_as === 'a résumé or application' &&
              w1.data.filed === true && w2.status === 200 && w2.data.filed === true &&
              pressed.map(function (x) { return x[0] + ':' + x[1].item_id + ':' + x[1].mime_type; }).join() ===
                'tableDocUpload:resume:' + DOCX + ',tableDocUpload:resume:' + DOCX &&
              readAsked.join() === 'resume.docx:' + DOCX + ',resume.docx:' + DOCX &&
              w3.status === 400 && w3.message === CND_WORD_TYPE_WORDS + ' Nothing was written.' &&
              w4.status === 400 && w4.message === CERT_DOC_TYPE_WORDS + ' Nothing was written.' &&
              w5.status === 400 && w5.message === CERT_DOC_TYPE_WORDS + ' Nothing was written.',
              JSON.stringify([w1, w2, w3, w4, w5, pressed.map(function (x) { return x[0]; })]).slice(0, 1800));

    pressed = []; gated = []; busts = 0; filed = []; bumped = []; logged = []; readAsked = [];
    var dBad = [
      paper(ANN, 'ai-report', 'bci.pdf', 'application/pdf'), paper(ANN, 'resume', 'bci.pdf', 'application/pdf'),
      paper(ANN, 'no-such-step', 'bci.pdf', 'application/pdf'), paper(ANN, 'cjis', 'bci.jpg', 'image/jpeg'),
      paper(ANN, 'cjis', 'notes.txt', 'text/plain'), paper(ANN, 'cjis', 'bci.pdf', 'application/pdf', { base64: '' }),
      paper(DEE, 'cjis', 'bci.pdf', 'application/pdf'), paper('CAN_NOBODY0001', 'cjis', 'bci.pdf', 'application/pdf')
    ];
    stAssert_(out, P + 'document: a step with no paper, a closed step, an unknown step, a picture where the door keeps ' +
                   'a PDF, a file that is not a picture or a PDF, no file, a candidate out of the pipeline and an ' +
                   'unknown one are refused before the decoder reads anything, and nothing is written',
              dBad.map(function (r) { return r.status; }).join() === '409,409,400,400,400,400,400,400' &&
              /takes no document/.test(dBad[0].message) && /already complete/.test(dBad[1].message) &&
              /as a PDF/.test(dBad[3].message) && readAsked.length === 0 && nothing() === 0,
              JSON.stringify(dBad).slice(0, 1800));

    sheetDbGateHolds_ = function () { return { error: { status: 409, message: 'st: held' } }; };
    var dHeld = paper(ANN, 'cjis', 'bci.pdf', 'application/pdf');
    var heldReads = readAsked.length;
    var dHeldCheck = paper(ANN, 'cjis', 'bci.pdf', 'application/pdf', { check: true });
    sheetDbGateHolds_ = function () { return null; };
    answerOf.tableDocUpload = { status: 400, message: 'st: the Hiring door refused' };
    var dRefused = paper(ANN, 'cjis', 'bci.pdf', 'application/pdf');
    delete answerOf.tableDocUpload;
    hubPolicyGate_ = function () { return { status: 403, message: 'st: the door\'s gate' }; };
    var dGated = paper(ANN, 'cjis', 'bci.pdf', 'application/pdf');
    hubPolicyGate_ = function (a, p) { gated.push(a + ':' + p.candidate_id); return null; };
    stAssert_(out, P + 'document: a held journey refuses the filing before the decoder reads, but not the check; the ' +
                   'step\'s own door refusing, or its gate, comes back whole and files no line',
              dHeld.status === 409 && dHeldCheck.status === 200 && dHeldCheck.data.verified === true &&
              heldReads === 0 &&
              dRefused.status === 400 && dRefused.message === 'st: the Hiring door refused' && dGated.status === 403 &&
              filed.length === 0 && busts === 0, JSON.stringify([dHeld, dRefused, dGated, filed]));

    readAsked = [];
    var denied = [{ email: 'admin@example.org', role: 'admin' }, { email: 'mgr@example.org', role: 'manager' },
                  { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' }, null].map(function (u) {
      return HUB_ACTIONS.candidateProfileDoor({ candidate: ANN, press: 'document', item: 'cjis',
        fields: { filename: 'bci.pdf', mime_type: 'application/pdf', base64: 'QUJD', confirm_mismatch: true } }, u);
    });
    stAssert_(out, P + 'document: anyone but the master in its own session gets the exact 404 shape, and the decoder ' +
                   'never reads their file',
              denied.every(shape) && readAsked.length === 0, JSON.stringify([denied, readAsked]));

    journeys[CY] = [{ id: 'JRN5', candidate_id: CY, step: 'staff_candidates', title: 'Document filed', channel: '', ok: true,
                      detail: 'Background check (BCI) — bci.pdf (read as a background check)', ref: 'document:cjis',
                      at: '2026-09-21T10:00:00Z', by: HUB_MASTER_ACCOUNT, rehearsal: false }];
    var vc = HUB_ACTIONS.candidateProfileActivity({ candidate: CY }, master);
    delete journeys[CY];
    stAssert_(out, P + 'document: the paper\'s line on the hiring journey reads as a document in the activity',
              vc.status === 200 && vc.data.items[0].kind === 'document' && vc.data.items[0].title === 'Document filed',
              JSON.stringify(vc).slice(0, 800));
    stAssert_(out, P + 'document: the decoder reads the words once and keeps them nowhere — no sheet, no Drive file, no ' +
                   'delete in Staff Candidates; the scratch copy is the decoder\'s own and its own finally deletes it',
              !/hubAppendRow_|createFile|setTrashed|appendRow/.test([cndPaperRead_, cndPaperVerdict_, cndDocumentDoor_]
                .map(stCode_).join('\n')) &&
              /DIGEST_TMP_NAME/.test(stCode_(keep.uploadText)) && /finally/.test(stCode_(keep.uploadText)) &&
              /method: 'delete'/.test(stCode_(keep.uploadText)), '');

    journeyLog_ = keep.journeyLog;
    cacheBump_ = keep.bump;
    hubPolicyGate_ = keep.policyGate;
    hubBustTalentCache_ = keep.bust;
    board[3].packet = undefined;
    Object.keys(keep.hiring).forEach(function (a) { HUB_ACTIONS[a] = keep.hiring[a]; });
    HUB_ACTIONS.docUpload = keep.docUpload;
    digestUploadText_ = keep.uploadText;
    DIGEST_VOCAB = keep.vocab;
    DIGEST_ROSTER = keep.roster;

    // ---- the relay's pack ----
    boardReads = 0;
    rawReads = 0;
    evReads = {};
    var pack = seen('pack', HUB_ACTIONS.candidatePack({ candidate: ANN }, serviceUser_()));
    var pp = (pack.data && pack.data.parts) || {};
    var ps = (pack.data && pack.data.part_status) || {};
    var packReads = [boardReads, rawReads, evReads[ANN] || 0].join();
    var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
    var parity = {
      overview: same(pp.overview, HUB_ACTIONS.candidateProfileOverview({ candidate: ANN }, master).data),
      actions: same(pp.actions, HUB_ACTIONS.candidateProfileActions({ candidate: ANN }, master).data),
      interviews: same(pp.interviews, HUB_ACTIONS.candidateProfileInterviews({ candidate: ANN }, master).data),
      documents: same(pp.documents, HUB_ACTIONS.candidateProfileDocuments({ candidate: ANN }, master).data),
      activity: same(pp.activity, HUB_ACTIONS.candidateProfileActivity({ candidate: ANN }, master).data),
      texts: same(pp.texts, HUB_ACTIONS.candidateProfileTexts({ candidate: ANN }, master).data),
      transcripts: same(pp.transcripts, HUB_ACTIONS.candidateProfileTranscripts({ candidate: ANN }, master).data)
    };
    stAssert_(out, P + 'pack: the service reads all seven parts in one execution, each exactly its own action\'s answer, ' +
                   'the board, the candidate records and the hiring evidence read once for all of them, the memo dropped after',
              pack.status === 200 && pack.data.candidate === ANN && !!pack.data.built_at &&
              CND_PACK_PARTS.every(function (n) { return ps[n] && ps[n].status === 200 && pp[n] !== undefined; }) &&
              Object.keys(parity).every(function (k) { return parity[k]; }) && packReads === '1,1,1' && CND_MEMO_ === null,
              JSON.stringify([pack.status, ps, parity, packReads]));
    cndActivityDoor_ = function () { throw new Error('st: activity closed'); };
    var broken = HUB_ACTIONS.candidatePack({ candidate: ANN }, serviceUser_());
    cndActivityDoor_ = keep.activityDoor;
    CND_PACK_BUDGET_MS = -1;
    var late = HUB_ACTIONS.candidatePack({ candidate: ANN }, serviceUser_());
    CND_PACK_BUDGET_MS = keep.budget;
    var pNone = HUB_ACTIONS.candidatePack({ candidate: 'CAN_NOBODY0001' }, serviceUser_());
    var pJunk = HUB_ACTIONS.candidatePack({ candidate: 'a b' }, serviceUser_());
    var bst = (broken.data && broken.data.part_status) || {};
    stAssert_(out, P + 'pack: a part that throws is its own 503 and the others answer; past its budget it starts no part ' +
                   'and says so part by part; an unknown or malformed id is the lookup\'s own 400, never an empty pack',
              broken.status === 200 && bst.activity.status === 503 && /activity closed/.test(bst.activity.message) &&
              !broken.data.parts.activity &&
              ['overview', 'actions', 'documents', 'texts'].every(function (n) { return bst[n].status === 200; }) &&
              late.status === 200 && Object.keys(late.data.parts).length === 0 &&
              CND_PACK_PARTS.every(function (n) { return late.data.part_status[n].status === 503; }) &&
              pNone.status === 400 && !pNone.data && pJunk.status === 400 && CND_MEMO_ === null,
              JSON.stringify([bst, pNone, pJunk]));

    // ---- a released app: who reads what ----
    var viewerTabs = {};
    viewerTabs[ONBOARDING_TAB] = [{ candidateid: BOB, house: 'ZZ9999', notes: 'SECRET ONBOARDING NOTE' },
                                  { candidateid: DEE, house: 'ZZ9999' }];
    viewerTabs[HIRING_EVENTS_TAB] = [
      { eventid: 'HEV_CY1', candidateid: CY, eventtype: 'in_person_interview', date: '2026-09-25', time: '14:00',
        location: 'Zeta House', withname: 'Gia9 Guardian', notes: 'SECRET EVENT NOTE', status: 'scheduled' },
      { eventid: 'HEV_CY2', candidateid: CY, eventtype: 'phone_screen', date: '2026-09-05', time: '',
        location: 'Queue House', withname: '', notes: '', status: 'completed' },
      { eventid: 'HEV_EVE', candidateid: EVE, eventtype: 'start_date', date: '2026-10-01', time: '', location: 'ZZ9999',
        withname: '', notes: '', status: 'cancelled' },
      { eventid: 'HEV_DEE', candidateid: DEE, eventtype: 'orientation', date: '2026-07-10', time: '', location: 'ZZ9999',
        withname: '', notes: '', status: 'scheduled' }];
    tabs[ONBOARDING_TAB] = stLocSheet_([['candidate_id', 'house']]);
    tabs[HIRING_EVENTS_TAB] = stLocSheet_([HIRING_EVENTS_HEADER.slice()]);
    var viewerTabsBroken = {};
    var boardTabs = readTabNormalized_;
    readTabNormalized_ = function (ss, tab) {
      if (viewerTabsBroken[tab]) throw new Error('st: ' + tab + ' unreadable');
      return viewerTabs[tab] ? clone(viewerTabs[tab]) : boardTabs(ss, tab);
    };
    locationsHomes_ = function () {
      return [{ code: 'ZZ9999', home_name: 'Zeta House', address: '9999 Test Ave NW' },
              { code: 'QQ1000', home_name: 'Queue House', address: '1000 Queue St' }];
    };
    locationsClientRows_ = function () {
      return [{ client_key: 'kay9test', name: 'Kay9 Test', house: 'ZZ9999', home_address: '', status: 'active' },
              { client_key: 'lee9other', name: 'Lee9 Other', house: 'QQ1000', home_address: '', status: 'active' }];
    };
    var SSA_MAIL = 'denise9@starkdd.test';
    ssaIndex_ = function () {
      return { ssas: { ssa_denise9alvarez: { key: 'ssa_denise9alvarez', name: 'Denise9 Alvarez', emails: [SSA_MAIL],
                                             phones: [], clients: [{ client_key: 'lee9other', ssa_email: SSA_MAIL,
                                                                     archived: false }] } },
               why: [], degraded: false };
    };
    clientsDerived_ = function () { return []; };
    // a shift booked ahead at ZZ9999 ties Eve; the one already worked at QQ1000 is the staff rule's to say
    locationsCalendar_ = function () {
      return { cal: { tz: 'America/New_York', values: [['Location', 'Employee', 'Designation', 'Shift', 'Date'],
                                                        ['Zeta ZZ9999', 'Eve9 Hired', '', 'Day', '2026-09-30'],
                                                        ['Queue QQ1000', 'Eve9 Hired', '', 'Day', '2026-09-01']] },
               why: '' };
    };
    var visibleAsked = [];
    hubStaffVisibleForHouses_ = function (codes) {
      visibleAsked.push(codes.join());
      return { keys: codes.indexOf('QQ1000') !== -1 ? ['ann9test'] : [], why: '' };
    };
    accounts = [
      { userid: 'u-gia9', email: 'gia9@x.test', displayname: 'Gia9 Guardian', role: 'client', types: 'GUARDIAN',
        clientkey: 'kay9test', active: 'true', appdenials: '', nameby: '' },
      { userid: 'u-den9', email: SSA_MAIL, displayname: 'D Alvarez', role: 'staff', types: 'GUARDIAN', active: 'true',
        appdenials: '', nameby: '' }];
    var staffU = { id: 'u-sal9', email: 'sally9@asa.test', role: 'staff', types: ['STAFF'], display_name: 'Sally9 Staff' };
    var clientU = { id: 'u-kay9', email: 'kay9@x.test', role: 'client', types: ['CLIENT'], client_key: 'kay9test',
                    display_name: 'Kay9 Test' };
    var familyU = { id: 'u-gia9', email: 'gia9@x.test', role: 'client', types: ['GUARDIAN'], client_key: 'kay9test',
                    display_name: 'Gia9 Guardian' };
    var ssaU = { id: 'u-den9', email: SSA_MAIL, role: 'staff', types: ['GUARDIAN'], display_name: 'D Alvarez' };
    var viewers = [['staff', staffU], ['client', clientU], ['family', familyU], ['ssa', ssaU]];
    var release = function (badges) {
      RULES = { rules: {}, tenants: {} };
      if (badges) RULES.rules[CND_APP_ID] = badges;
      HUB_VIEWER_MEMO = null;
    };
    var lookups = 0;
    cndCandidate_ = function (raw) { lookups++; return keep.candidate(raw); };
    var viewerFiled = 0, viewerPressed = 0;
    journeyLog_ = function () { viewerFiled++; return 'JRN_VIEWER'; };
    Object.keys(CND_DOOR_FIELDS).forEach(function (a) {
      HUB_ACTIONS[a] = function () { viewerPressed++; return { status: 200, data: {} }; };
    });
    hubSetDecision_ = function () { viewerPressed++; return { status: 200, data: {} }; };
    var everyAction = CND_ACTIONS.concat(['candidatePack']);
    var askAll = function (u, candidate) {
      return everyAction.filter(function (a) {
        return !shape(HUB_ACTIONS[a]({ candidate: candidate, file_id: 'AnnResumeFile123', id: 'AC-2', body: 'x',
                                       press: 'complete', item: 'ai-report' }, u));
      });
    };

    release(null);
    boardReads = 0;
    lookups = 0;
    var unreleased = viewers.map(function (v) { return v[0] + ':' + askAll(v[1], ANN).join('|'); });
    release(['STAFF']);
    var staffOnly = viewers.slice(1).map(function (v) { return v[0] + ':' + askAll(v[1], BOB).join('|'); });
    stAssert_(out, P + 'released: with no App Control row the staff account, a client, family and an SSA get the exact ' +
                   '404 shape from every action and the pack; a row naming STAFF alone still shuts the client, family ' +
                   'and the SSA out — nothing looked up, no board read',
              unreleased.join() === 'staff:,client:,family:,ssa:' && staffOnly.join() === 'client:,family:,ssa:' &&
              lookups === 0 && boardReads === 0, JSON.stringify([unreleased, staffOnly, lookups, boardReads]));

    var sameAsMaster = [];
    var viewerExtracts = 0;
    hubExtractResumeText_ = function () { viewerExtracts++; return 'SKILLS\nPatience, Cooking'; };
    ['candidateProfileRoster', 'candidateProfileOverview', 'candidateProfileActions', 'candidateProfileInterviews',
     'candidateProfileDocuments', 'candidateProfileActivity', 'candidateProfileTexts', 'candidateProfileTranscripts',
     'candidateProfileResume']
      .forEach(function (a) {
        var byStaff = HUB_ACTIONS[a]({ candidate: ANN }, staffU), byMaster = HUB_ACTIONS[a]({ candidate: ANN }, master);
        if (byStaff.status !== 200 || JSON.stringify(byStaff) !== JSON.stringify(byMaster)) sameAsMaster.push(a);
      });
    hubExtractResumeText_ = keep.extract;
    var staffFile = HUB_ACTIONS.candidateProfileDocFile({ candidate: ANN, file_id: 'AnnResumeFile123' }, staffU);
    var masterRoster = HUB_ACTIONS.candidateProfileRoster({}, master);
    var wordsAsked = [];
    commCallsTranscriptRead_ = function (id, u) {
      wordsAsked.push(id + ':' + (u && u.email));
      return { status: 200, data: { call_id: id, full_transcript: 'Words, DOB: 01/02/1990', speaker_transcript: '',
                                    has_words: true } };
    };
    var staffWords = HUB_ACTIONS.candidateProfileTranscript({ candidate: ANN, id: 'AC-2' }, staffU);
    commCallsTranscriptRead_ = keep.transcript;
    var staffAdminDoor = HUB_ACTIONS.commCallsTranscript({ call_id: 'AC-2' }, staffU);
    stAssert_(out, P + 'released to STAFF: the staff account reads every section, the résumé, a document and a listed call\'s words ' +
                   '(past this gate, not the admin-only transcript door, which still refuses it) exactly as the master ' +
                   'does, and the master\'s answers carry no viewer mark',
              sameAsMaster.length === 0 && staffFile.status === 200 && staffFile.data.id === 'AnnResumeFile123' &&
              staffWords.status === 200 && staffWords.data.full_transcript === 'Words, DOB [withheld]' &&
              wordsAsked.join() === 'AC-2:sally9@asa.test' && staffAdminDoor.status === 403 &&
              masterRoster.status === 200 && !masterRoster.data.hasOwnProperty('viewer'),
              JSON.stringify([sameAsMaster, staffWords, wordsAsked, staffAdminDoor]));

    release(['STAFF', 'CLIENT', 'GUARDIAN']);
    visibleAsked = [];
    var roster = function (u) { return HUB_ACTIONS.candidateProfileRoster({}, u); };
    var rClient = seen('narrow roster client', roster(clientU));
    var rFamily = seen('narrow roster family', roster(familyU));
    var rSsa = seen('narrow roster ssa', roster(ssaU));
    var keysOf = function (r) { return ((r.data || {}).candidates || []).map(function (c) { return c.key; }).join(); };
    var basic = [rClient, rFamily, rSsa].every(function (r) {
      return r.status === 200 && r.data.candidates.every(function (c) {
        return Object.keys(c).sort().join() === 'avatar,key,name,position,stage,stage_label';
      });
    });
    stAssert_(out, P + 'narrowed roster: a client and family see the candidates tied to their house — the house on the ' +
                   'onboarding record, an interview booked there by its name, a shift booked ahead — and the SSA those ' +
                   'tied to their client\'s house through the staff rule and an event there; each the basic line only, ' +
                   'in stage order, counted, and marked with whose view it is',
              keysOf(rClient) === [CY, BOB, EVE].join() && keysOf(rFamily) === keysOf(rClient) &&
              keysOf(rSsa) === [ANN, CY].join() && basic &&
              rClient.data.viewer === 'client' && rFamily.data.viewer === 'guardian' && rSsa.data.viewer === 'ssa' &&
              rClient.data.stages.map(function (s) { return s.id + ':' + s.count; }).join() ===
                'new:0,phone-screen:0,interview:1,onboarding:1,hired:1,ready:0' &&
              rClient.data.degraded === false && rClient.data.why.length === 0 &&
              visibleAsked.indexOf('ZZ9999') !== -1 && visibleAsked.indexOf('QQ1000') !== -1,
              JSON.stringify([rClient, rSsa, visibleAsked]).slice(0, 1500));

    var oBob = seen('narrow overview bob', HUB_ACTIONS.candidateProfileOverview({ candidate: BOB }, clientU));
    var oText = JSON.stringify(oBob);
    var outside = [
      HUB_ACTIONS.candidateProfileOverview({ candidate: ANN }, clientU),
      HUB_ACTIONS.candidateProfileOverview({ candidate: 'CAN_NOBODY0001' }, clientU),
      HUB_ACTIONS.candidateProfileOverview({ candidate: DEE }, familyU),
      HUB_ACTIONS.candidateProfileInterviews({ candidate: 'a b' }, familyU),
      HUB_ACTIONS.candidateProfileOverview({ candidate: BOB }, ssaU)
    ];
    stAssert_(out, P + 'narrowed overview: the basic card — name, photo, position, stage — never a phone, an e-mail, ' +
                   'the recruiter, the summary, the onboarding notes or a count; a candidate outside their houses, one ' +
                   'not on file, one out of the process and a malformed id are all the same 404',
              oBob.status === 200 && oBob.data.viewer === 'client' && oBob.data.candidate.name === 'Bob9 Onboard' &&
              oBob.data.candidate.stage === 'onboarding' &&
              Object.keys(oBob.data.candidate).sort().join() ===
                'archived,avatar,key,name,position,stage,stage_label,status_label' &&
              ['0177', 'bob9@example.org', 'Akron', 'recruiter9', 'Referral', 'Needs a Saturday start', 'SECRET',
               'tiles', 'summary', 'recent'].every(function (w) { return oText.indexOf(w) === -1; }) &&
              outside.every(shape), JSON.stringify([oBob, outside]).slice(0, 1500));

    var iCy = seen('narrow interviews client', HUB_ACTIONS.candidateProfileInterviews({ candidate: CY }, clientU));
    var iCySsa = seen('narrow interviews ssa', HUB_ACTIONS.candidateProfileInterviews({ candidate: CY }, ssaU));
    var iEve = HUB_ACTIONS.candidateProfileInterviews({ candidate: EVE }, familyU);
    var planOf = function (r) {
      return ((r.data || {}).plan || []).map(function (p) { return [p.id, p.title, p.date, p.status, p.owner, p.detail].join('/'); });
    };
    stAssert_(out, P + 'narrowed interviews: only the meetings booked at the reader\'s own house — the date, the kind, ' +
                   'who it is with and where — never the event\'s notes, a score, a result or the candidate\'s ' +
                   'preferences; a cancelled one is gone',
              iCy.status === 200 && planOf(iCy).join() ===
                'event_HEV_CY1/In-person interview/2026-09-25/scheduled/Gia9 Guardian/Zeta House · 14:00' &&
              planOf(iCySsa).join() === 'event_HEV_CY2/Phone screen/2026-09-05/completed//Queue House' &&
              iEve.status === 200 && iEve.data.plan.length === 0 && JSON.stringify(iCy.data.preferences) === '{}' &&
              JSON.stringify([iCy, iCySsa]).indexOf('SECRET') === -1 && iCy.data.viewer === 'client',
              JSON.stringify([iCy, iCySsa, iEve]).slice(0, 1500));

    lookups = 0;
    var wideOnly = ['candidateProfileActions', 'candidateProfileDocuments', 'candidateProfileDocFile',
                    'candidateProfileActivity', 'candidateProfileTexts', 'candidateProfileTranscripts',
                    'candidateProfileTranscript', 'candidateProfileResume'];
    var leaked = [];
    [[clientU, BOB], [familyU, CY], [ssaU, ANN]].forEach(function (pair) {
      wideOnly.forEach(function (a) {
        var r = HUB_ACTIONS[a]({ candidate: pair[1], file_id: 'AnnResumeFile123', id: 'AC-2' }, pair[0]);
        if (!shape(r)) leaked.push(a + ' ' + pair[0].id);
      });
    });
    stAssert_(out, P + 'narrowed: the actions, documents and their files, the activity, the texts, the calls and their ' +
                   'words, the résumé are the exact 404 shape for a client, family and an SSA, even on a candidate tied to their ' +
                   'house, before the candidate is looked up',
              leaked.length === 0 && lookups === 0, leaked.join() + ' lookups=' + lookups);

    var writesShut = [];
    [staffU, clientU, familyU, ssaU].forEach(function (u) {
      [HUB_ACTIONS.candidateProfileNoteAdd({ candidate: BOB, body: 'x' }, u),
       HUB_ACTIONS.candidateProfileDoor({ candidate: CY, press: 'stage', item: 'onboarding', fields: {} }, u),
       HUB_ACTIONS.candidatePack({ candidate: BOB }, u)].forEach(function (r, i) {
        if (!shape(r)) writesShut.push(u.id + ':' + i);
      });
    });
    stAssert_(out, P + 'released or not, the note, a press on a Hiring door and the pack stay the master\'s: the staff ' +
                   'account, a client, family and an SSA get the 404 shape and nothing is filed or pressed',
              writesShut.length === 0 && viewerFiled === 0 && viewerPressed === 0,
              writesShut.join() + ' filed=' + viewerFiled + ' pressed=' + viewerPressed);

    viewerTabsBroken[HIRING_EVENTS_TAB] = true;
    var rDown = roster(clientU);
    viewerTabsBroken = {};
    var eventsTab = tabs[HIRING_EVENTS_TAB];
    delete tabs[HIRING_EVENTS_TAB];
    var rUnborn = roster(clientU);
    tabs[HIRING_EVENTS_TAB] = eventsTab;
    stAssert_(out, P + 'narrowed: a hiring source that cannot be read ties nobody — the candidate it alone tied is not ' +
                   'listed — and the answer is degraded with one plain line that names no source; a tab not born yet ' +
                   'ties nobody and degrades nothing',
              rDown.status === 200 && keysOf(rDown) === [BOB, EVE].join() && rDown.data.degraded === true &&
              rDown.data.why.join() === CND_NARROW_WHY && JSON.stringify(rDown).indexOf('unreadable') === -1 &&
              rUnborn.status === 200 && keysOf(rUnborn) === [BOB, EVE].join() && rUnborn.data.degraded === false,
              JSON.stringify([rDown, rUnborn]).slice(0, 800));

    var homes = locationsHomes_();
    var addr = locationsAddrIndex_(homes, []);
    var places = ['ZZ9999', 'Visit at Zeta ZZ9999', 'the QQ1000 porch', 'Queue House', '1000 Queue St, Canton', 'Office', '']
      .map(function (v) { return cndHouseOf_(v, homes, addr); });
    stAssert_(out, P + 'a hiring record\'s place is a house by its code, a registry code in its words, the house\'s ' +
                   'name or its address, and nothing else',
              places.join() === 'ZZ9999,ZZ9999,QQ1000,QQ1000,QQ1000,,', places.join());

    cndCandidate_ = keep.candidate;
    journeyLog_ = keep.journeyLog;
    hubSetDecision_ = keep.decide;
    Object.keys(keep.hiring).forEach(function (a) { HUB_ACTIONS[a] = keep.hiring[a]; });
    readTabNormalized_ = boardTabs;
    delete tabs[ONBOARDING_TAB];
    delete tabs[HIRING_EVENTS_TAB];
    release(null);

    // ---- no answer carries a nine-digit run, an SSN, a card, a date of birth or a background-check number ----
    var runs = [];
    answers.forEach(function (pair) {
      var text = JSON.stringify(pair[1]);
      if (/(^|\D)\d{9}(\D|$)/.test(text) || /(^|\D)\d{3}[\s.-]\d{2}[\s.-]\d{4}(\D|$)/.test(text) ||
          /(^|\D)\d(?:[ -]?\d){12,18}(\D|$)/.test(text) || /01\/02\/1990|03\/04\/1985|A12345|SECRET/.test(text)) runs.push(pair[0]);
    });
    stAssert_(out, P + 'no answer of any read carries a 9-digit run, an SSN shape, a card number, a date of birth, a ' +
                   'background-check number or a call\'s words',
              answers.length >= 12 && runs.length === 0, 'answers=' + answers.length + ' with runs: ' + runs.join(', '));

    // ---- the cache ----
    cndCached_ = keep.cached;
    var calls = 0, retired = [];
    cacheBump_ = function (scope) { retired.push(scope); keep.bump(scope); };
    var key = 'CAN_ST' + Date.now();
    cndCached_('candidateProfileActions', { key: key, row: { id: 'a' }, memo: {} }, function () { calls++; return { degraded: true }; });
    cndCached_('candidateProfileActions', { key: key + 'b', row: { id: 'a' }, memo: {} }, function () { calls++; return { degraded: false }; });
    cndCached_('candidateProfileActions', { key: key + 'b', row: { id: 'a' }, memo: {} }, function () { calls++; return { degraded: false }; });
    cndCached_('candidateProfileActions', { key: key + 'b', row: { id: 'a', stage: 'new' }, memo: {} },
               function () { calls++; return { degraded: false }; });
    cacheBump_ = keep.bump;
    stAssert_(out, P + 'a read is kept per candidate under cnd_<action>_<key> and the board row\'s version: a degraded one ' +
                   'retires its own scope, and a Hiring write that changes the row is a new version',
              calls === 3 && retired.join() === 'cnd_candidateProfileActions_' + key,
              'producer calls=' + calls + ' retired=' + retired.join());
    var dkey = 'CAN_STD' + Date.now();
    var docTab = function (rows) {
      return stLocSheet_([DOCS_HEADER.slice()].concat(rows.map(function (r) {
        var line = DOCS_HEADER.map(function () { return ''; });
        line[DOCS_HEADER.indexOf('candidate_id')] = dkey;
        line[DOCS_HEADER.indexOf('doc_id')] = r[0];
        line[DOCS_HEADER.indexOf('status')] = r[1];
        line[DOCS_HEADER.indexOf('file_id')] = r[2];
        return line;
      })));
    };
    var built = [];
    var build = function (what) { return function () { built.push(what); return { degraded: false }; }; };
    var dctx = function () { return { key: dkey, row: { id: 'same row' }, memo: {} }; };
    var heldTab = tabs[DOCS_TAB];
    tabs[DOCS_TAB] = docTab([['drivers_id', 'uploaded', 'DocFileOne0001']]);
    cndCached_('candidateProfileDocuments', dctx(), build('docs'));
    cndCached_('candidateProfileActions', dctx(), build('actions'));
    cndCached_('candidateProfileDocuments', dctx(), build('docs'));
    tabs[DOCS_TAB] = docTab([['drivers_id', 'uploaded', 'DocFileOne0001'], ['car_insurance', 'uploaded', 'DocFileTwo0001']]);
    cndCached_('candidateProfileDocuments', dctx(), build('docs'));
    cndCached_('candidateProfileOverview', dctx(), build('overview'));
    cndCached_('candidateProfileActions', dctx(), build('actions'));
    tabs[DOCS_TAB] = heldTab;
    stAssert_(out, P + 'documents and the overview also carry the candidate\'s own document rows\' version: a paper filed ' +
                   'by any app is a new version though the board row has not changed; the other sections keep theirs',
              built.join() === 'docs,actions,docs,overview', built.join());

    // ---- where the app lives ----
    var asResource = Object.keys(RESOURCES).filter(function (k) { return /^candidateProfile|^candidatePack$/i.test(k); });
    stAssert_(out, P + 'no generic resource and no tab of its own: the note lives on the hiring journey',
              asResource.length === 0 && typeof CND_NOTES_TAB === 'undefined' &&
              /journeyLog_\(/.test(stCode_(HUB_ACTIONS.candidateProfileNoteAdd)) &&
              !/hubTabEnsure_|appendRow|setValue/.test(stCode_(HUB_ACTIONS.candidateProfileNoteAdd)), asResource.join());

    // ---- no delete anywhere ----
    var fns = Object.keys(g).filter(function (k) { return /^(cnd[A-Z]|candidateProfiles)/.test(k) && typeof g[k] === 'function'; });
    var deleting = [];
    fns.map(function (k) { return [k, g[k]]; }).concat(CND_ACTIONS.concat(['candidatePack']).map(function (a) { return [a, HUB_ACTIONS[a]]; }))
      .forEach(function (pair) {
        if (/deleteRows?\(|deleteRowById_|deleteSheet|clearContents?\(|\.clear\(|setTrashed|api\.delete/.test(stCode_(pair[1]))) {
          deleting.push(pair[0]);
        }
      });
    stAssert_(out, P + 'no Staff Candidates code path deletes, clears or trashes anything',
              fns.length >= 40 && deleting.length === 0, 'functions=' + fns.length + ' deleting=' + deleting.join());
  } finally {
    hubProfileAppRules_ = keep.rules;
    usersAll_ = keep.users;
    locationsClientRows_ = keep.clientRows;
    locationsHomes_ = keep.homes;
    ssaIndex_ = keep.ssa;
    clientsDerived_ = keep.derived;
    locationsCalendar_ = keep.cal;
    hubStaffVisibleForHouses_ = keep.visible;
    HUB_VIEWER_MEMO = keep.viewerMemo;
    cndCandidate_ = keep.candidate;
    cndCached_ = keep.cached;
    HUB_MASTER_EMAIL_CACHE = keep.masterCache;
    HUB_MEMBER_CTX = keep.member;
    hubSysLog_ = keep.log;
    hubTabSheet_ = keep.sheet;
    sheetDbGateHolds_ = keep.holds;
    talentCandidatesRead_ = keep.board;
    readTabNormalized_ = keep.readTab;
    ssOpen_ = keep.ssOpen;
    hubId_ = keep.hubId;
    hubEvidence_ = keep.evidence;
    interviewFor_ = keep.ivFor;
    onboardingRowFor_ = keep.obRow;
    hubOnboardingDone_ = keep.obDone;
    hubGate_ = keep.gate;
    interviewAskRows_ = keep.asks;
    packetState_ = keep.packet;
    certPicture_ = keep.certs;
    journeyFor_ = keep.journey;
    journeyLog_ = keep.journeyLog;
    hubLineRow_ = keep.lineRow;
    hubLineOurs_ = keep.lineOurs;
    locationsDocBytes_ = keep.bytes;
    locationsToday_ = keep.today;
    cacheBump_ = keep.bump;
    commCallsTranscriptRead_ = keep.transcript;
    cndActivityDoor_ = keep.activityDoor;
    CND_PACK_BUDGET_MS = keep.budget;
    hubPolicyGate_ = keep.policyGate;
    hubSetDecision_ = keep.decide;
    hubBustTalentCache_ = keep.bust;
    hubExtractResumeText_ = keep.extract;
    Object.keys(keep.hiring).forEach(function (a) { HUB_ACTIONS[a] = keep.hiring[a]; });
    HUB_ACTIONS.docUpload = keep.docUpload;
    digestUploadText_ = keep.uploadText;
    DIGEST_VOCAB = keep.vocab;
    DIGEST_ROSTER = keep.roster;
    CND_MEMO_ = null;
  }
}
