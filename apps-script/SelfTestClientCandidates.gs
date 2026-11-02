/** Client Candidates: the released-app gate on the reads and the master's on the presses, the Potential Clients row read through the intake's six stages, the log of every press, the papers, the alerts, the readers reused, the two write doors and the pack. */
function stClientCandidates_(out) {
  var P = 'client candidates: ';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var ANN = 'LEAD_9001', BOB = 'LEAD_9002', CY = 'LEAD_9003', DEE = 'LEAD_9004', FAY = 'LEAD_9006', GUS = 'LEAD_9007';
  var HAL = 'LEAD_9009', IVY = 'LEAD_9010', JAY = 'LEAD_9011', EVE = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
  var keep = {
    candidate: ccCandidate_, cached: ccCached_, masterCache: HUB_MASTER_EMAIL_CACHE, member: HUB_MEMBER_CTX,
    log: hubSysLog_, sheet: hubTabSheet_, list: listRows_, ssOpen: ssOpen_, hubId: hubId_, lineRow: hubLineRow_,
    lineOurs: hubLineOurs_, bytes: locationsDocBytes_, today: locationsToday_, bump: cacheBump_, optOut: optOutIndex_,
    clients: clientsDerived_, clientsMemo: CLIENTS_DERIVED_MEMO_, ispIndex: ispDocIndex_, ispFor: ispDocFor_,
    transcript: HUB_ACTIONS.commCallsTranscript, activityDoor: ccActivityDoor_, budget: CC_PACK_BUDGET_MS,
    requireRow: requireRow_, update: updateRowById_, holds: sheetDbGateHolds_, pdf: ccPdf_, folder: ccFolder_,
    rawBytes: ccBytes_, blob: ccBlob_, rules: hubProfileAppRules_, appGate: hubProfileAppGate_, users: usersAll_,
    viewerMemo: HUB_VIEWER_MEMO, clientRows: locationsClientRows_, homes: locationsHomes_, ssa: ssaIndex_
  };
  var master = { email: HUB_MASTER_ACCOUNT, role: 'admin', display_name: 'The Master' };
  var answers = [];
  var seen = function (label, r) { answers.push([label, r]); return r; };
  var clone = function (v) { return JSON.parse(JSON.stringify(v)); };
  var PRIVATE = [/(^|\D)\d{9}(\D|$)/, /(^|\D)\d{12}(\D|$)/, /(^|\D)\d{3}\s*[\s.-]\s*\d{2}\s*[\s.-]\s*\d{4}(\D|$)/,
                 /(^|\D)\d(?:[\s.-]{0,2}\d){12,18}(\D|$)/, /01\/02\/1990|01 02 1990|1990\.01\.02|2 Jan 1990/,
                 /January 2nd, 1990|SECRET/];
  var leaks = function (text) { return PRIVATE.filter(function (re) { return re.test(text); }).length > 0; };
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    HUB_MEMBER_CTX = null;
    CC_MEMO_ = null;
    var logged = [];
    hubSysLog_ = function () { logged.push(JSON.stringify(Array.prototype.slice.call(arguments))); return true; };

    // ---- declarations ----
    var READS = ['clientCandidateRoster', 'clientCandidateOverview', 'clientCandidateActions', 'clientCandidateIntake',
                 'clientCandidateDocuments', 'clientCandidateActivity', 'clientCandidateTexts',
                 'clientCandidateTranscripts'];
    var TOOLS = ['clientCandidateDocFile', 'clientCandidateTranscript'];
    var WRITES = { clientCandidateWrite: 'write', clientCandidateFile: 'tool' };
    // a read's own 404 answers whoever App Control has not opened it to, so the door lets every role through to it
    var EVERY_ROLE = '["admin","director","manager","staff","client","onboarding","interviewer"]';
    var gateLine = /^function\s*\(payload, user\)\s*\{\s*if \(!clientCandidatesGate_\(user\)\) return clientCandidatesUnknown_\(\);/;
    var masterLine = /^function\s*\(payload, user\)\s*\{\s*if \(!clientCandidatesMaster_\(user\)\) return clientCandidatesUnknown_\(\);/;
    var bad = [];
    CC_ACTIONS.concat(CC_WRITE_ACTIONS).forEach(function (a) {
      var p = HUB_POLICY[a];
      if (!p || p.file !== 'ClientCandidates.gs' || typeof HUB_ACTIONS[a] !== 'function') { bad.push(a + ': undeclared'); return; }
      if (RESOLVER_LANES.indexOf(p.lane) === -1 || RESOLVER_STORES.indexOf(p.store) === -1) bad.push(a + ': lane/store');
      var roles = WRITES[a] ? '["admin","manager"]' : EVERY_ROLE;
      if (JSON.stringify(p.roles) !== roles) bad.push(a + ': roles ' + JSON.stringify(p.roles));
      var params = p.params || {};
      Object.keys(params).forEach(function (k) { if (params[k] && params[k].required) bad.push(a + ': ' + k + ' required at the door'); });
      if (!(WRITES[a] ? masterLine : gateLine).test(stCode_(HUB_ACTIONS[a]))) bad.push(a + ': the gate is not the first line');
      if (WRITES[a]) {
        if (p.lane !== WRITES[a]) bad.push(a + ': lane ' + p.lane);
        if (p.idempotent !== false) bad.push(a + ': a press is not safe to send twice');
        if (JSON.stringify(p.invalidates) !== '["potentialClients"]' || (p.emits || []).length) bad.push(a + ': invalidates/emits');
        return;
      }
      if ((p.invalidates || []).length || (p.emits || []).length) bad.push(a + ': invalidates/emits');
      var want = READS.indexOf(a) !== -1 ? 'read' : (TOOLS.indexOf(a) !== -1 ? 'tool' : 'write');
      if (p.lane !== want) bad.push(a + ': lane ' + p.lane + ', wanted ' + want);
      if (p.idempotent !== true) bad.push(a + ': not idempotent');
    });
    stAssert_(out, P + 'the 10 reads and tools are declared in ClientCandidates.gs for every role and open with the ' +
                   'released-app gate, the 2 write doors for admin/manager and open with the master gate; none requires ' +
                   'a param before its gate; the reads are idempotent and invalidate nothing, the presses are not safe ' +
                   'to send twice and invalidate the potentialClients slice',
              bad.length === 0 && CC_ACTIONS.length === 10 && READS.length + TOOLS.length === CC_ACTIONS.length &&
              CC_WRITE_ACTIONS.join() === 'clientCandidateWrite,clientCandidateFile', bad.join('; '));
    var pol = HUB_POLICY.clientCandidatePack || {};
    stAssert_(out, P + 'pack: declared in ClientCandidates.gs as an idempotent admin read, a service read, no section ' +
                   'door, its seven parts each a door, and the service-or-master gate its first line',
              pol.file === 'ClientCandidates.gs' && pol.lane === 'read' && pol.idempotent === true &&
              JSON.stringify(pol.roles) === '["admin"]' && typeof HUB_ACTIONS.clientCandidatePack === 'function' &&
              SERVICE_READ_ACTIONS.indexOf('clientCandidatePack') !== -1 && CC_ACTIONS.indexOf('clientCandidatePack') === -1 &&
              CC_PACK_PARTS.join() === 'overview,actions,intake,documents,activity,texts,transcripts' &&
              JSON.stringify(Object.keys(ccPackDoors_({ key: 'x', row: {}, memo: {} })).sort()) ===
                JSON.stringify(CC_PACK_PARTS.slice().sort()) &&
              /^function\s*\(payload, user\)\s*\{\s*if \(!user \|\| !\(user\.is_service === true \|\| clientCandidatesMaster_\(user\)\)\) return clientCandidatesUnknown_\(\);/
                .test(stCode_(HUB_ACTIONS.clientCandidatePack)), JSON.stringify(pol));

    // ---- the stages ----
    var shown = ['new', 'scraped', 'read', '', 'contacted', 'assessment', 'isp-drafting', 'intake', 'converted', 'on-hold',
                 'lost', 'closed', 'discovery', 'placement-review', 'ready-for-intake', 'referral', 'waitlist']
      .map(function (s) { return s + ':' + ccStageOf_(s); }).join();
    stAssert_(out, P + 'stages: the six in order, and the words rows already hold shown as one of them — new, scraped and ' +
                   'read a Referral, contacted Discovery, ISP drafting and intake Placement Review, converted Ready for ' +
                   'Intake, on hold and lost Closed — anything else as written',
              CC_STAGES.map(function (s) { return s.label; }).join() ===
                'Referral,Discovery,Assessment,Placement Review,Ready for Intake,Closed' &&
              shown === 'new:referral,scraped:referral,read:referral,:referral,contacted:discovery,assessment:assessment,' +
                'isp-drafting:placement-review,intake:placement-review,converted:ready-for-intake,on-hold:closed,' +
                'lost:closed,closed:closed,discovery:discovery,placement-review:placement-review,' +
                'ready-for-intake:ready-for-intake,referral:referral,waitlist:' &&
              ccStageLabel_(ccStageId_('Placement Review')) === 'Placement Review' && ccStageLabel_('waitlist') === 'Waitlist' &&
              ccStageIndex_('closed') === -2 && ccStageIndex_('waitlist') === -1 && ccStageIndex_('converted') === 4, shown);

    // ---- the scrub ----
    var scrubbed = ccScrub_({ a: 'card 4111.1111.1111.1111', b: 'card 4111  1111  1111  1111', c: 'SSN 123 - 45 - 6789',
                              d: 'DOB: 01 02 1990', e: 'DOB 1990.01.02', f: 'DOB: 2 Jan 1990', h: 'DOB: January 2nd, 1990',
                              i: 'DOB is 01/02/1990', j: 'birthday 01/02/1990', k: 'call 330-555-0142 at 2pm',
                              l: 'seen 2026-09-21T12:00:00.000Z' });
    stAssert_(out, P + 'scrub: a card grouped by dots or runs of spaces, an SSN with spaced separators, and a date of birth ' +
                   'written spaced, dotted, day-first, with an ordinal, after "is" or as a birthday are withheld; a phone ' +
                   'number and an instant are not',
              !leaks(JSON.stringify(scrubbed)) && scrubbed.i === 'DOB [withheld]' && scrubbed.j === 'birthday [withheld]' &&
              scrubbed.k === 'call 330-555-0142 at 2pm' && scrubbed.l === 'seen 2026-09-21T12:00:00.000Z',
              JSON.stringify(scrubbed));

    // ---- the gate ---- App Control as each case writes it: no row for the app until one does; no account row…
    var RULES = { rules: {}, tenants: {} };
    var rulesBroken = false;
    hubProfileAppRules_ = function () { if (rulesBroken) throw new Error('st: App Control unreadable'); return RULES; };
    usersAll_ = function () { return []; };
    HUB_VIEWER_MEMO = null;
    var asked = 0, leadReads = 0, liveReads = 0;
    ccCandidate_ = function () { asked++; return { refused: { status: 418, message: 'st: the candidate was asked' } }; };
    listRows_ = function () { leadReads++; throw new Error('st: the referrals were read'); };
    requireRow_ = function () { liveReads++; throw new Error('st: the live row was read'); };
    var callers = [
      { email: 'admin@example.org', role: 'admin' },
      { email: 'mgr@example.org', role: 'manager' },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', is_service: true },
      { email: HUB_MASTER_ACCOUNT, role: 'manager' },
      null
    ];
    var probe = { candidate: ANN, candidate_id: ANN, file_id: 'CyPlanFile0001', id: 'AC-1', with: '3309197595',
                  kind: 'note', note: 'x', doc: 'consent', confirm: true };
    var shape = function (r) { return !!r && r.status === 404 && r.message === 'Unknown action.' && Object.keys(r).length === 2; };
    var gateLeaks = [];
    CC_ACTIONS.concat(CC_WRITE_ACTIONS).forEach(function (a) {
      callers.forEach(function (u) {
        var r = HUB_ACTIONS[a](probe, u);
        if (!shape(r)) gateLeaks.push(a + ' ' + JSON.stringify(u) + ' → ' + JSON.stringify(r));
      });
      HUB_MEMBER_CTX = { memberId: 'mem_st', userId: 'u-st', email: 'ann@example.org' };
      var inVisit = HUB_ACTIONS[a](probe, master);
      HUB_MEMBER_CTX = null;
      if (!shape(inVisit)) gateLeaks.push(a + ' in a visit → ' + JSON.stringify(inVisit));
    });
    stAssert_(out, P + 'another admin, a manager, a visit, the service identity, the master as a manager, no session and ' +
                   'the member context all get the exact 404 shape from every read and both presses, before the ' +
                   'candidate, the referrals or the live row are looked up',
              gateLeaks.length === 0 && asked === 0 && leadReads === 0 && liveReads === 0,
              gateLeaks.slice(0, 4).join(' | ') + ' asked=' + asked + ' reads=' + leadReads + ' live=' + liveReads);
    var passed = CC_ACTIONS.filter(function (a) { return a !== 'clientCandidateRoster'; }).map(function (a) {
      return a + ':' + HUB_ACTIONS[a](probe, master).status;
    });
    stAssert_(out, P + 'the master in its own session passes the gate to the candidate lookup',
              passed.every(function (s) { return /:418$/.test(s); }) && asked === passed.length, passed.join());
    asked = 0;
    var packShut = [{ email: 'admin@example.org', role: 'admin' }, { email: 'mgr@example.org', role: 'manager' },
                    { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' }, null].map(function (u) {
      return HUB_ACTIONS.clientCandidatePack(probe, u);
    });
    var packOpen = [serviceUser_(), master].map(function (u) { return HUB_ACTIONS.clientCandidatePack(probe, u).status; });
    stAssert_(out, P + 'pack: another admin, a manager, a visit and no session get the exact 404 shape before the lookup; ' +
                   'the service identity and the master in its own session reach it',
              packShut.every(shape) && packOpen.join() === '418,418' && asked === 2 && CC_MEMO_ === null,
              JSON.stringify([packShut, packOpen, asked]));

    // ---- the release: App Control opens the reads, never a write or the pack ----
    var director = { id: 'u-dir9', email: 'dir9@example.org', role: 'admin', types: ['DIRECTOR'], display_name: 'Dee9 Rector' };
    var dirManager = { id: 'u-mgr9', email: 'mgr9@example.org', role: 'manager', types: ['DIRECTOR'],
                       display_name: 'Mo9 Manager' };
    var staffer = { id: 'u-st9', email: 'st9@example.org', role: 'staff', types: ['STAFF'], display_name: 'Sal9 Staff' };
    var readsBy = function (u) {
      HUB_VIEWER_MEMO = null;
      return CC_ACTIONS.map(function (a) { return HUB_ACTIONS[a](probe, u); });
    };
    var pressesBy = function (u) {
      HUB_VIEWER_MEMO = null;
      return CC_WRITE_ACTIONS.concat(['clientCandidatePack']).map(function (a) { return HUB_ACTIONS[a](probe, u); });
    };
    var ROSTER_AT = CC_ACTIONS.indexOf('clientCandidateRoster');
    // past the gate: the roster reads the referrals, every other read looks the candidate up
    var through = function (rs) {
      return rs.every(function (r, i) { return i === ROSTER_AT ? r.status === 503 : r.status === 418; });
    };
    RULES = { rules: {}, tenants: {} };
    asked = 0; leadReads = 0; liveReads = 0;
    var unreleased = readsBy(director).concat(pressesBy(director));
    stAssert_(out, P + 'release: with no App Control row a director gets the exact 404 shape from every read, both ' +
                   'presses and the pack, before anything is read',
              unreleased.every(shape) && asked === 0 && leadReads === 0 && liveReads === 0, JSON.stringify(unreleased[0]));
    RULES = { rules: { 'client-candidates': ['DIRECTOR'] }, tenants: {} };
    asked = 0; leadReads = 0;
    var dirReads = readsBy(director), mgrReads = readsBy(dirManager);
    stAssert_(out, P + 'release: released to DIRECTOR, a director on the admin or the manager role passes every read ' +
                   'to the referrals and the candidate lookup, as the master does',
              through(dirReads) && through(mgrReads) && asked === 2 * (CC_ACTIONS.length - 1) && leadReads === 2,
              JSON.stringify(dirReads.concat(mgrReads).map(function (r) { return r.status; })) + ' asked=' + asked);
    asked = 0; leadReads = 0;
    var dirPresses = pressesBy(director).concat(pressesBy(dirManager));
    stAssert_(out, P + 'release: both presses and the pack stay the master\'s — the released director gets the exact 404 ' +
                   'shape before the candidate or the live row is looked up',
              dirPresses.every(shape) && asked === 0 && leadReads === 0 && liveReads === 0, JSON.stringify(dirPresses));
    var denied = { id: 'u-dir9', email: 'dir9@example.org', role: 'admin', types: ['DIRECTOR'], display_name: 'Dee9 Rector',
                   app_denials: ['client-candidates'] };
    var elsewhere = { id: 'u-dir9', email: 'dir9@example.org', role: 'admin', types: ['DIRECTOR'],
                      display_name: 'Dee9 Rector', home_tenant: 't-home9' };
    var visiting = { id: 'u-dir9', email: 'dir9@example.org', role: 'admin', types: ['DIRECTOR'],
                     display_name: 'Dee9 Rector', visiting_member: 'mem_1' };
    asked = 0; leadReads = 0;
    var offBadge = readsBy(staffer), offDenied = readsBy(denied), offVisit = readsBy(visiting);
    RULES = { rules: { 'client-candidates': ['DIRECTOR'] }, tenants: { 'client-candidates': ['t-other9'] } };
    var offTenant = readsBy(elsewhere);
    RULES = { rules: { 'client-candidates': ['DIRECTOR'] }, tenants: {} };
    rulesBroken = true;
    var offBroken = readsBy(director);
    rulesBroken = false;
    stAssert_(out, P + 'release: a badge the row does not name, the app removed from the account, a home tenant the app ' +
                   'is not installed for, a visit and an App Control that cannot be read all get the exact 404 shape ' +
                   'from every read, before anything is read',
              offBadge.concat(offDenied, offVisit, offTenant, offBroken).every(shape) && asked === 0 && leadReads === 0,
              JSON.stringify([offBadge[0], offDenied[0], offVisit[0], offTenant[0], offBroken[0]]));

    // a client, family and an SSA: the app is open to them in App Control, and still no referral is theirs
    locationsClientRows_ = function () { return [{ client_key: 'kay9test', name: 'Kay9 Test', house: 'ZZ9999', status: 'active' }]; };
    locationsHomes_ = function () { return []; };
    ssaIndex_ = function () {
      return { ssas: { ssa_rae9county: { key: 'ssa_rae9county', name: 'Rae9 County', emails: ['rae9@county.test'], phones: [],
                                         clients: [{ client_key: 'kay9test', ssa_email: 'rae9@county.test', archived: false }] } },
               why: [], degraded: false };
    };
    clientsDerived_ = function () { return []; };
    usersAll_ = function () {
      return [{ userid: 'u-gia9', email: 'gia9@x.test', displayname: 'Gia9 Guardian', role: 'client', types: 'GUARDIAN',
                active: 'true', appdenials: '', nameby: '' }];
    };
    var kay = { id: 'u-kay9', email: 'kay9@x.test', role: 'client', types: ['CLIENT'], client_key: 'kay9test',
                display_name: 'Kay9 Test' };
    var gia = { id: 'u-gia9', email: 'gia9@x.test', role: 'client', types: ['GUARDIAN'], client_key: 'kay9test',
                display_name: 'Gia9 Guardian' };
    var rae = { id: 'u-rae9', email: 'rae9@county.test', role: 'staff', types: ['GUARDIAN'], display_name: 'Rae9 County' };
    RULES = { rules: { 'client-candidates': ['CLIENT', 'GUARDIAN'] }, tenants: {} };
    var kinds = [kay, gia, rae].map(function (u) {
      HUB_VIEWER_MEMO = null;
      var gate = hubProfileAppGate_('client-candidates', u);
      return (gate.open ? 'open:' : 'shut:') + gate.scope.kind;
    });
    asked = 0; leadReads = 0;
    var narrowed = [kay, gia, rae].map(function (u) { return readsBy(u).concat(pressesBy(u)); });
    stAssert_(out, P + 'release: released to CLIENT and GUARDIAN, App Control opens the app to a client, family and an ' +
                   'SSA on their narrowed scope — and every read, both presses and the pack still give each of them the ' +
                   'exact 404 shape, before anything is read',
              kinds.join() === 'open:client,open:guardian,open:ssa' &&
              narrowed.every(function (rs) { return rs.every(shape); }) && asked === 0 && leadReads === 0,
              kinds.join() + ' ' + JSON.stringify(narrowed.map(function (rs) { return rs[0]; })));

    // the gate reads hubProfileAppGate_ for this app alone, and only its master and 'all' answers pass
    var askedFor = [];
    var gateSays = null;
    hubProfileAppGate_ = function (id) {
      askedFor.push(id);
      if (gateSays === 'throw') throw new Error('st: the release could not be read');
      return gateSays;
    };
    var verdicts = [
      { open: true, scope: { kind: 'master' } }, { open: true, scope: { kind: 'all' } },
      { open: false, scope: { kind: 'all' } }, { open: true, scope: { kind: 'client' } },
      { open: true, scope: { kind: 'guardian' } }, { open: true, scope: { kind: 'ssa' } },
      { open: true, scope: { kind: 'none' } }, { open: true }, null, 'throw'
    ].map(function (said) { gateSays = said; return clientCandidatesGate_(director); });
    hubProfileAppGate_ = keep.appGate;
    stAssert_(out, P + 'release: the read gate asks App Control about client-candidates alone and passes the master and ' +
                   'a release on everything; a shut answer, a narrowed scope, no scope, no answer and a check that ' +
                   'throws all refuse',
              verdicts.join() === 'true,true,false,false,false,false,false,false,false,false' &&
              askedFor.length === 10 && askedFor.every(function (id) { return id === 'client-candidates'; }),
              verdicts.join() + ' ' + askedFor.join());
    hubProfileAppRules_ = keep.rules;
    usersAll_ = keep.users;
    locationsClientRows_ = keep.clientRows;
    locationsHomes_ = keep.homes;
    ssaIndex_ = keep.ssa;
    clientsDerived_ = keep.clients;
    HUB_VIEWER_MEMO = keep.viewerMemo;
    ccCandidate_ = keep.candidate;

    // ---- fixtures ----
    ccCached_ = function (action, ctx, producer) { return producer(); };
    locationsToday_ = function () { return '2026-09-22'; };
    var annLog = [{ at: '2026-09-13T10:00:05.000Z', by: 'The Master', kind: 'note', text: 'Note added' },
                  { at: '2026-09-14T11:30:09.000Z', by: 'The Master', kind: 'step',
                    text: 'Reopened action: First call with the family or SSA' }];
    var leads = [
      { id: ANN, referral_id: 9001, client_name: 'Ann9 Lead', client_age: 34, client_gender: 'F',
        diagnosis: 'Autism; card 4111 1111 1111 1111; card 4111.1111.1111.1111', frequency: '24/7',
        description: 'Residential support 24/7', postal_code: 44709, phone: '(330) 555-0142', email: 'ann9@example.org',
        funding_source: 2, expiration_date: '10/15/26', ai_rating: 9,
        ai_notes: 'Ann9 Lead (34, F); needs 24/7 care. SSN 123-45-6789; DOB: 01/02/1990; Medicaid # 123456789012; ' +
                  'SSN 123 - 45 - 6789; DOB: January 2nd, 1990; birthday 01/02/1990; card 4111  1111  1111  1111.',
        sms_sent: true, source: '', scraped_at: '2026-09-01 14:00:00.123456+00', stage: 'read',
        owner: 'coord9@example.org', next_step: 'Call the SSA back', notes: 'Tags: family; DOB 1990.01.02',
        candidate_log: JSON.stringify(annLog) },
      { id: BOB, referral_id: 9002, client_name: 'Bob9 Assess', postal_code: '44646', phone: '330-555-0199',
        description: 'Day services', frequency: 'Weekly', expiration_date: '2026-09-10', ai_rating: '', sms_sent: false,
        scraped_at: '2026-08-20 10:00:00+00', stage: 'Assessment', owner: '', next_step: '' },
      { id: CY, referral_id: 9003, client_name: 'Cy9 Convert', postal_code: 44720, phone: '+1 330 555 0199',
        description: 'HPC', expiration_date: '2026-08-01', ai_rating: 7, stage: 'converted', owner: 'coord9@example.org',
        scraped_at: '2026-07-01 10:00:00+00' },
      { id: DEE, referral_id: 9004, client_name: 'Dee9 Lost', description: 'Respite', stage: 'lost',
        expiration_date: '2026-11-01', scraped_at: '2026-08-01 10:00:00+00' },
      { id: EVE, client_name: 'Eve9 Manual', stage: '', source: 'manual', createdAt: '2026-09-15T10:00:00.000Z' },
      { id: FAY, referral_id: 9006, client_name: 'Fay9 Hold', description: 'Respite', stage: 'On hold',
        expiration_date: '2026-12-01', scraped_at: '2026-08-02 10:00:00+00', owner: 'coord9@example.org' },
      { id: GUS, referral_id: 9007, client_name: 'Gus9 New', description: 'Supported living', stage: 'new', sms_sent: 'true',
        email: 'gus9@example.org', expiration_date: '2026-09-30', ai_rating: 9, scraped_at: '2026-09-20 10:00:00+00' },
      { id: HAL, referral_id: 9009, client_name: 'Hal9 Twin', description: 'HPC', stage: 'converted',
        owner: 'coord9@example.org', scraped_at: '2026-06-01 10:00:00+00' },
      { id: IVY, referral_id: 9010, client_name: 'Ivy9 Wait', description: 'Respite', stage: 'Waitlist',
        expiration_date: '2026-12-01', scraped_at: '2026-08-03 10:00:00+00', owner: 'coord9@example.org' },
      { id: JAY, referral_id: 9011, client_name: 'Jay9 Place', description: 'Residential', stage: 'Placement Review',
        expiration_date: '2026-12-01', scraped_at: '2026-08-04 10:00:00+00', owner: 'coord9@example.org' },
      { id: 'LEAD_9008', referral_id: 9008, client_name: '', stage: 'new' },
      { id: ANN, referral_id: 9001, client_name: 'Ann9 Duplicate', stage: 'new' }
    ];
    var isps = [{ client_key: 'cy9convert', isp_year: '2025', personal_care: 'Needs help bathing' },
                { client_key: 'cy9convert', isp_year: '2026', personal_care: 'Needs help bathing and dressing',
                  mobility: 'Walks with a cane', important_to: 'Music; DOB: 01/02/1990' }];
    leadReads = 0;
    listRows_ = function (res) {
      if (res === 'isps') return clone(isps);
      if (res !== 'potentialClients') throw new Error('st: no resource ' + res);
      leadReads++;
      return clone(leads);
    };
    var optOutAsked = 0;
    optOutIndex_ = function () {
      optOutAsked++;
      return { by: { '3305550142': { target: '+13305550142', kind: 'phone', at: '2026-09-12T10:00:00Z', scope: '',
                                     phrase: 'stop' } }, error: '' };
    };
    clientsDerived_ = function () {
      return [{ name: 'Cy9 Convert', client_key: 'cy9convert' }, { name: 'Hal9 Twin', client_key: 'hal9twin' },
              { name: 'Hal9 Twin', client_key: 'hal9twin2' }, { name: 'Other Person', client_key: 'other' }];
    };
    ispDocIndex_ = function () { return { files: [{ id: 'CyPlanFile0001', name: 'Cy9 Convert ISP.pdf' }] }; };
    ispDocFor_ = function (name) {
      return clientNameKey_(name) === 'cy9convert' ? { id: 'CyPlanFile0001', name: 'Cy9 Convert ISP.pdf', url: '' } : { id: '' };
    };
    var ev = function (id, type, actor, key, at, payload) {
      return [id, type, actor, 'action', key, '', JSON.stringify(payload || { ok: true }), 'hubSysLog_', at, ''];
    };
    var tabs = {};
    tabs[EVENTS_TAB] = stLocSheet_([EVENTS_HEADER.slice(),
      ev('e1', 'potentialClients.update', 'coord9@example.org', ANN, '2026-09-10T12:00:00.000Z'),
      ev('e2', 'leadOpened', 'dsp9@example.org', ANN, '2026-09-05T09:00:00.000Z'),
      ev('e3', 'lead_read', 'dsp9@example.org', 'Ann9 Lead new → read', '2026-09-05T09:00:00.000Z'),
      ev('e4', 'staffProfileNoteAdd', 'coord9@example.org', 'Ann9 Lead', '2026-09-06T09:00:00.000Z'),
      ev('e5', 'potentialClients.update', 'coord9@example.org (visiting mem)', ANN, '2026-09-11T12:00:00.000Z',
         { ok: false, detail: 'held by the switch' }),
      ev('e6', 'potentialClients.update', 'coord9@example.org', BOB + 'x', '2026-09-12T12:00:00.000Z'),
      ev('e7', 'clientCandidateWrite', 'boss@example.org', ANN, '2026-09-14T11:30:09.000Z'),
      ev('e8', 'lead_read', 'dsp9@example.org', 'Ann9 Lead', '2026-09-05T09:00:00.000Z')
    ]);
    tabs[COMM_MOCK_HOUSE] = stSpSheet_([
      ['id', 'at', 'pass_id', 'result', 'held_by', 'to_masked', 'body', 'ledger_key'],
      ['p1#1', '2026-09-02T09:00:00.000Z', 'p1', 'sent', '', '+1 (330) ***-0101', 'Referral 9001 rated 9: needs 24/7 care. DOB 01 02 1990',
       'scraper_lead:' + ANN + ':3305550101'],
      ['p1#2', '2026-09-02T09:00:01.000Z', 'p1', 'sent', '', '+1 (330) ***-0102', 'Referral 9001 rated 9: needs 24/7 care. DOB 01 02 1990',
       'scraper_lead:' + ANN + ':3305550102'],
      ['p1#3', '2026-09-02T09:00:02.000Z', 'p1', 'sent', '', '+1 (330) ***-0101', 'Another referral', 'scraper_lead:LEAD_9999:3305550101'],
      ['p2#1', '2026-09-21T09:00:00.000Z', 'p2', 'held', 'the quiet window', '+1 (330) ***-0101', 'Gus9 alert',
       'scraper_lead:' + GUS + ':3305550101']
    ]);
    var quoOpened = 0;
    tabs.quo_messages = stSpSheet_([
      ['message_id', 'message_created', 'direction', 'from_number', 'to_number', 'body', 'quo_number'],
      ['m1', '2026-09-07T12:00:00Z', 'incoming', '+13305550142', '+13309197595', 'Yes, call me; my SSN is 123 45 6789',
       'PNaaaa0001'],
      ['m2', '2026-09-07T13:00:00Z', 'outgoing', '+13309197595', '+13305550142', 'We will call Tuesday; card 4111.1111.1111.1111',
       'PNaaaa0001'],
      ['m3', '2026-09-08T12:00:00Z', 'incoming', '+13305550199', '+13309197595', 'shared phone text', 'PNaaaa0001'],
      ['m4', '2026-09-09T12:00:00Z', 'incoming', '+12165550000', '+13309197595', 'stranger text', 'PNaaaa0001']
    ]);
    var hot = stSpSheet_([
      ['Call ID', 'Transcript Created', 'Event Timestamp', 'Duration (sec)', 'Quo Number', 'Participant(s)', 'Team Member(s)',
       'Direction', '# Turns', 'Full Transcript', 'Speaker Transcript'],
      ['AC-1', '2026-09-06T15:00:00Z', '2026-09-06T15:00:00Z', 300, 'PNx', '+13305550142', '+13309197595', 'incoming', 20,
       'SECRET WORDS', ''],
      ['AC-2', '2026-09-08T10:00:00Z', '2026-09-08T10:00:00Z', 60, 'PNx', '+12165550000', '+13309197595', 'outgoing', 4, 'x', ''],
      ['AC-3', '2026-09-09T10:00:00Z', '2026-09-09T10:00:00Z', 60, 'PNx', '+13305550199', '+13309197595', 'incoming', 4, 'y', '']
    ]);
    hubId_ = function (k) { return k === 'HOTLINE_TRANSCRIPTS_ID' ? 'st-hot-book' : ''; };
    ssOpen_ = function (id) {
      if (id === 'st-hot-book') return { getSheetByName: function (n) { return n === HOTLINE_TRANSCRIPTS_TAB ? hot : null; } };
      throw new Error('st: no book ' + id);
    };
    hubTabSheet_ = function (t) {
      if (t === 'quo_messages') quoOpened++;
      return tabs[t] || null;
    };
    hubLineRow_ = function (v) {
      var s = String(v || '');
      if (s === 'PNaaaa0001' || s === '3309197595') {
        return { digits: '3309197595', e164: '+13309197595', name: 'Intake line', owner: 'Ivy Owner', humans: 1, shared: false };
      }
      return null;
    };
    hubLineOurs_ = function (d) { return String(d) === '3309197595'; };

    // ---- the pipeline ----
    leadReads = 0;
    var rs = seen('roster', HUB_ACTIONS.clientCandidateRoster({}, master));
    var rk = {};
    ((rs.data || {}).candidates || []).forEach(function (x) { rk[x.key] = x; });
    var counts = {};
    ((rs.data || {}).stages || []).forEach(function (s) { counts[s.id] = s.count; });
    stAssert_(out, P + 'pipeline: every named referral once (the first row of an id wins, a nameless row is left out), by ' +
                   'name, with the row\'s own stage, the intake stage it shows as, the ZIP as its place, the portal as the ' +
                   'source of a scraped row, and the six stages counted in order with a word the intake does not know ' +
                   'after them; one read of the referrals',
              rs.status === 200 && rs.data.candidates.map(function (x) { return x.key; }).join() ===
                [ANN, BOB, CY, DEE, EVE, FAY, GUS, HAL, IVY, JAY].join() &&
              rk[ANN].name === 'Ann9 Lead' && rk[ANN].stage === 'read' && rk[ANN].intake_stage === 'referral' &&
              rk[ANN].stage_label === 'Referral' && rk[ANN].location === 'ZIP 44709' && rk[ANN].zip === '44709' &&
              rk[ANN].source === 'County referral portal' && rk[ANN].alerted === true &&
              rk[ANN].next_step === 'Call the SSA back' && rk[ANN].referral_id === '9001' && rk[ANN].rating === '9' &&
              rk[BOB].stage === 'assessment' && rk[BOB].alerted === false && rk[EVE].source === 'manual' &&
              rk[EVE].referred_at === '2026-09-15T10:00:00.000Z' && rk[FAY].stage === 'on-hold' &&
              rk[FAY].intake_stage === 'closed' && rk[JAY].intake_stage === 'placement-review' && rk[IVY].intake_stage === '' &&
              !rk.LEAD_9008 &&
              rs.data.stages.map(function (s) { return s.id + ':' + s.count; }).join() ===
                'referral:3,discovery:0,assessment:1,placement-review:1,ready-for-intake:2,closed:2,waitlist:1' &&
              leadReads === 1,
              JSON.stringify(rs).slice(0, 1500));

    // ---- the lookup ----
    var none = HUB_ACTIONS.clientCandidateOverview({ candidate: 'LEAD_0000' }, master);
    var junk = HUB_ACTIONS.clientCandidateOverview({ candidate: 'a b' }, master);
    var blank = HUB_ACTIONS.clientCandidateActivity({}, master);
    stAssert_(out, P + 'an unknown, a malformed and a missing id are 400 "No candidate … is on file."',
              none.status === 400 && none.message === 'No candidate "LEAD_0000" is on file.' && junk.status === 400 &&
              blank.status === 400 && blank.message === 'No candidate "" is on file.', JSON.stringify([none, junk, blank]));
    listRows_ = function () { throw new Error('st: referrals closed'); };
    var down = HUB_ACTIONS.clientCandidateActions({ candidate: ANN }, master);
    var rsDown = HUB_ACTIONS.clientCandidateRoster({}, master);
    listRows_ = function (res) {
      if (res === 'isps') return clone(isps);
      if (res !== 'potentialClients') throw new Error('st: no resource ' + res);
      leadReads++;
      return clone(leads);
    };
    stAssert_(out, P + 'unreadable referrals are 503 for the pipeline and the lookup, never "not on file"',
              down.status === 503 && /nothing is said about this candidate/.test(down.message) && rsDown.status === 503 &&
              /Potential Clients records could not be read/.test(rsDown.message), JSON.stringify([down, rsDown]));

    // ---- actions ----
    var act = function (key) { return HUB_ACTIONS.clientCandidateActions({ candidate: key }, master); };
    var item = function (r, id) { return ((r.data || {}).items || []).filter(function (i) { return i.id === id; })[0] || {}; };
    var choice = function (r, id) { return ((r.data || {}).stages || []).filter(function (s) { return s.id === id; })[0] || {}; };
    var step = function (key, kind, it, stage) {
      return JSON.stringify({ action: 'clientCandidateWrite', candidate_id: key, kind: kind, item: it, fields: { stage: stage } });
    };
    var aa = seen('actions ann', act(ANN));
    stAssert_(out, P + 'actions: the intake\'s three phases from the intake stage — a read referral is a Referral in its ' +
                   'review, the next step is marked once and completes by moving to Discovery; the later phases wait ' +
                   'their turn and nothing open reopens; the owner, the window as due and the written next step ride along',
              aa.status === 200 && aa.data.items.map(function (i) { return i.id + ':' + i.status; }).join() ===
                'referral_review:in_progress,assessment:pending,placement:pending' &&
              aa.data.items.filter(function (i) { return i.is_next; }).length === 1 && aa.data.next.id === 'referral_review' &&
              JSON.stringify(item(aa, 'referral_review').complete) === step(ANN, 'complete', 'referral_review', 'Discovery') &&
              aa.data.items.every(function (i) { return i.reopen === null; }) &&
              item(aa, 'referral_review').due === '2026-10-15' && item(aa, 'referral_review').due_state === 'upcoming' &&
              item(aa, 'referral_review').owner === 'coord9@example.org' &&
              item(aa, 'referral_review').next_step === 'Call the SSA back' &&
              item(aa, 'assessment').complete === null && item(aa, 'assessment').complete_why === 'Comes after Referral review.' &&
              item(aa, 'placement').complete_why === 'Comes after Discovery & assessment.' && aa.data.open === 3 &&
              aa.data.attention.join('|') === 'The referral\'s phone or e-mail is on the opt-out list — they asked us to ' +
                'stop on 2026-09-12.' && aa.data.stage_label === 'Referral',
              JSON.stringify(aa.data).slice(0, 1800));
    stAssert_(out, P + 'actions: Update stage offers the six, the current one (Referral, for a read referral) with no ' +
                   'press, every other through the app\'s own write; the note names the same door',
              aa.data.stages.map(function (s) { return s.id; }).join() ===
                'referral,discovery,assessment,placement-review,ready-for-intake,closed' &&
              choice(aa, 'referral').current === true && choice(aa, 'referral').write === null &&
              JSON.stringify(choice(aa, 'closed').write) === step(ANN, 'stage', '', 'Closed') &&
              choice(aa, 'assessment').description === 'Needs assessment & house fit' &&
              JSON.stringify(aa.data.note) === JSON.stringify({ action: 'clientCandidateWrite', candidate_id: ANN,
                                                                kind: 'note', current: 'Tags: family; DOB [withheld]' }),
              JSON.stringify([aa.data.stages, aa.data.note]));
    var ab = act(BOB), ac = act(CY), ad = act(DEE), af = act(FAY), ag = act(GUS), ae = act(EVE), ai = act(IVY), aj = act(JAY);
    stAssert_(out, P + 'actions: an Assessment referral has its review done (reopened back to Referral) and completes the ' +
                   'assessment by moving to Placement Review, overdue once its window closed; Placement Review is the ' +
                   'last phase open; one Ready for Intake has nothing open and reopens each phase to its own stage',
              ab.data.items.map(function (i) { return i.status; }).join() === 'done,in_progress,pending' &&
              JSON.stringify(item(ab, 'assessment').complete) === step(BOB, 'complete', 'assessment', 'Placement Review') &&
              JSON.stringify(item(ab, 'referral_review').reopen) === step(BOB, 'reopen', 'referral_review', 'Referral') &&
              item(ab, 'assessment').due_state === 'overdue' && item(ab, 'referral_review').due === '' &&
              ab.data.attention.join('|') === 'The referral window closed on 2026-09-10.|No intake coordinator is set.' &&
              aj.data.items.map(function (i) { return i.status; }).join() === 'done,done,in_progress' &&
              JSON.stringify(item(aj, 'placement').complete) === step(JAY, 'complete', 'placement', 'Ready for Intake') &&
              ac.data.items.every(function (i) { return i.status === 'done' && !i.open && !i.complete; }) &&
              JSON.stringify(item(ac, 'assessment').reopen) === step(CY, 'reopen', 'assessment', 'Discovery') &&
              JSON.stringify(item(ac, 'placement').reopen) === step(CY, 'reopen', 'placement', 'Placement Review') &&
              ac.data.next === null && ac.data.open === 0 && ac.data.closed === true && ac.data.attention.length === 0,
              JSON.stringify([ab.data, ac.data.items]).slice(0, 1800));
    stAssert_(out, P + 'actions: a Closed referral (lost, or on hold) and one whose stage the intake does not know offer ' +
                   'no press and say why; a new, texted referral is next for its first call and its closing window and ' +
                   'the unread alert are named; a referral with no contact says so',
              ad.data.open === 0 && ad.data.next === null && ad.data.items.every(function (i) {
                return !i.complete && !i.reopen && i.complete_why === 'Closed — Update stage moves it back into the intake first.';
              }) && /is Closed/.test(ad.data.why.join(' ')) && choice(ad, 'closed').current === true &&
              af.data.next === null && choice(af, 'closed').current === true &&
              ai.data.next === null && ai.data.items.every(function (i) { return !i.complete && !i.reopen; }) &&
              /"Waitlist" is not an intake stage/.test(ai.data.why.join(' ')) &&
              item(ag, 'referral_review').status === 'in_progress' && ag.data.next.id === 'referral_review' &&
              JSON.stringify(item(ag, 'referral_review').complete) === step(GUS, 'complete', 'referral_review', 'Discovery') &&
              ag.data.attention.join('|') === 'The referral window closes on 2026-09-30.|' +
                'The team was texted about this referral and nobody has opened it yet.|No intake coordinator is set.' &&
              ae.data.attention.join('|') === 'No phone or e-mail is on the referral.|No intake coordinator is set.' &&
              choice(ae, 'referral').current === true,
              JSON.stringify([ad.data, af.data.why, ai.data.why, ag.data.attention, ae.data.attention]).slice(0, 1800));

    // ---- intake ----
    var ia = seen('intake ann', HUB_ACTIONS.clientCandidateIntake({ candidate: ANN }, master));
    var ib = HUB_ACTIONS.clientCandidateIntake({ candidate: BOB }, master);
    var ic = HUB_ACTIONS.clientCandidateIntake({ candidate: CY }, master);
    var idd = HUB_ACTIONS.clientCandidateIntake({ candidate: DEE }, master);
    var planOf = function (r) { return ((r.data || {}).plan || []).map(function (p) { return p.id + ':' + p.status; }).join(); };
    var label = function (list, l) { return ((list || []).filter(function (x) { return x.label === l; })[0] || {}).value; };
    stAssert_(out, P + 'intake: referral review, discovery & assessment and service fit & placement, each Completed, ' +
                   'Awaiting Confirmation or Pending from the intake stage, the phase worked on now carrying the written ' +
                   'next step; a phase is dated only when it was completed here, and why says so',
              ia.status === 200 && planOf(ia) === 'referral_review:awaiting_confirmation,assessment:pending,placement:pending' &&
              ia.data.plan[0].comments === 'Call the SSA back' && ia.data.plan[0].owner === 'coord9@example.org' &&
              ia.data.plan.every(function (p) { return p.date === ''; }) &&
              planOf(ib) === 'referral_review:completed,assessment:awaiting_confirmation,placement:pending' &&
              ib.data.plan[0].result === 'Reached Discovery' &&
              planOf(ic) === 'referral_review:completed,assessment:completed,placement:completed' &&
              ic.data.plan[2].result === 'Reached Ready for Intake' &&
              planOf(idd) === 'referral_review:pending,assessment:pending,placement:pending' && idd.data.closed === true &&
              /completed here/.test(ia.data.why.join(' ')),
              JSON.stringify([ia.data, ib.data.plan]).slice(0, 1800));
    stAssert_(out, P + 'intake: the preferences and the support network are the referral\'s own fields and its recorded ' +
                   'contact preferences; what the row does not carry is blank and named in why, never guessed',
              label(ia.data.preferences, 'Service requested') === 'Residential support 24/7' &&
              label(ia.data.preferences, 'Frequency') === '24/7' && label(ia.data.preferences, 'Location') === 'ZIP 44709' &&
              label(ia.data.preferences, 'Funding source') === '2' && label(ia.data.preferences, 'Preferred start') === '' &&
              label(ia.data.support, 'Family / guardian') === '' && label(ia.data.support, 'Phone') === '(330) 555-0142' &&
              label(ia.data.support, 'Referred by') === 'County referral portal' &&
              label(ia.data.support, 'Contact method') === '' &&
              /family or guardian, a preferred start and what is important to them/.test(ia.data.why.join(' ')),
              JSON.stringify([ia.data.preferences, ia.data.support]));

    // ---- documents ----
    var da = seen('documents ann', HUB_ACTIONS.clientCandidateDocuments({ candidate: ANN }, master));
    var de = HUB_ACTIONS.clientCandidateDocuments({ candidate: EVE }, master);
    var db = HUB_ACTIONS.clientCandidateDocuments({ candidate: BOB }, master);
    var dc = seen('documents cy', HUB_ACTIONS.clientCandidateDocuments({ candidate: CY }, master));
    var dh = HUB_ACTIONS.clientCandidateDocuments({ candidate: HAL }, master);
    var dget = function (r, id) { return ((r.data || {}).docs || []).filter(function (d) { return d.id === id; })[0] || {}; };
    var docsOf = function (r) { return ((r.data || {}).docs || []).map(function (d) { return d.id + ':' + d.status; }).join(); };
    stAssert_(out, P + 'documents: the referral summary is On File whenever the row is and opens rendered; the support ' +
                   'assessment and the consent are Pending until something is filed — an opt-out hit is a contact ' +
                   'preference line on the consent, never a filed paper — and the assessment is filed here at the ' +
                   'Assessment stage alone',
              da.status === 200 && docsOf(da) === 'referral:on_file,assessment:pending,consent:pending' &&
              dget(da, 'referral').render === 'referral' && dget(da, 'referral').file_id === '' &&
              dget(da, 'referral').detail === 'Referral 9001 · window until 2026-10-15' &&
              dget(da, 'referral').date === '2026-09-01' && dget(da, 'assessment').can_file === false &&
              /at the Assessment stage/.test(dget(da, 'assessment').detail) &&
              /No signed consent is filed yet\. The referral's phone or e-mail is on the opt-out list/.test(dget(da, 'consent').detail) &&
              dget(da, 'consent').opt_out.at === '2026-09-12' && da.data.counts.on_file === 1 && da.data.counts.total === 3 &&
              docsOf(de) === 'referral:on_file,assessment:pending,consent:pending' &&
              dget(db, 'assessment').can_file === true && /file the assessment here/.test(dget(db, 'assessment').detail),
              JSON.stringify([da.data, de.data, dget(db, 'assessment')]).slice(0, 1800));
    stAssert_(out, P + 'documents: a referral the one plan in the plans folder carries has its support assessment read from ' +
                   'the plan\'s newest sections (rendered) and the plan itself on file; Ready for Intake with no plan says so',
              dc.status === 200 && docsOf(dc) === 'referral:on_file,assessment:on_file,consent:pending,isp:on_file' &&
              dget(dc, 'assessment').render === 'assessment' &&
              dget(dc, 'assessment').detail === 'From the plan: Personal care, Mobility, Important to' &&
              dget(dc, 'isp').file_id === 'CyPlanFile0001' && dget(dc, 'isp').mime === 'application/pdf' &&
              dc.data.counts.with_file === 3 && dget(dh, 'isp').status === 'pending' && !dget(dh, 'isp').file_id &&
              dget(dh, 'assessment').status === 'pending',
              JSON.stringify([dc.data, dh.data]).slice(0, 1800));
    optOutIndex_ = function () { return { by: {}, error: 'The opt-out list could not be read: st' }; };
    var dx = HUB_ACTIONS.clientCandidateDocuments({ candidate: ANN }, master);
    optOutIndex_ = function () {
      optOutAsked++;
      return { by: { '3305550142': { target: '+13305550142', kind: 'phone', at: '2026-09-12T10:00:00Z', scope: '',
                                     phrase: 'stop' } }, error: '' };
    };
    stAssert_(out, P + 'documents: an unreadable opt-out list is degraded and said, never "no preference recorded"',
              dx.status === 200 && dx.data.degraded === true && dget(dx, 'consent').status === 'pending' &&
              !dget(dx, 'consent').opt_out && /opt-out list could not be read/.test(dx.data.why.join(' ')), JSON.stringify(dx.data));
    var bytesAsked = [], rendered = [];
    locationsDocBytes_ = function (id) {
      bytesAsked.push(id);
      return { name: 'plan.pdf', mime: 'application/pdf', size: 3, exported: false, b64: 'QUJD' };
    };
    ccPdf_ = function (html, name) { rendered.push([name, html]); return [37, 80, 68, 70]; };
    var f1 = HUB_ACTIONS.clientCandidateDocFile({ candidate: CY, file_id: 'CyPlanFile0001' }, master);
    var f2 = HUB_ACTIONS.clientCandidateDocFile({ candidate: ANN, file_id: 'CyPlanFile0001' }, master);
    var f3 = HUB_ACTIONS.clientCandidateDocFile({ candidate: CY, file_id: 'bad id' }, master);
    var f4 = HUB_ACTIONS.clientCandidateDocFile({ candidate: 'LEAD_0000', file_id: 'CyPlanFile0001' }, master);
    var r1 = HUB_ACTIONS.clientCandidateDocFile({ candidate: ANN, doc: 'referral' }, master);
    var r2 = HUB_ACTIONS.clientCandidateDocFile({ candidate: ANN, doc: 'assessment' }, master);
    var r3 = HUB_ACTIONS.clientCandidateDocFile({ candidate: CY, doc: 'assessment' }, master);
    ccPdf_ = keep.pdf;
    var annHtml = (rendered[0] || [])[1] || '', cyHtml = (rendered[1] || [])[1] || '';
    stAssert_(out, P + 'document door: a file the candidate\'s own list names opens as bytes; another candidate\'s file is ' +
                   '404, a malformed id and an unknown candidate 400, all before Drive; the referral summary and the ' +
                   'assessment read from the plan open as PDFs made from the row, scrubbed and escaped — a paper the list ' +
                   'does not render is 404',
              f1.status === 200 && f1.data.id === 'CyPlanFile0001' && f1.data.b64 === 'QUJD' &&
              Object.keys(f1.data).sort().join() === 'b64,exported,id,mime,name,size' && f2.status === 404 &&
              f3.status === 400 && f4.status === 400 && bytesAsked.join() === 'CyPlanFile0001' &&
              r1.status === 200 && r1.data.mime === 'application/pdf' && r1.data.name === 'Referral summary.pdf' &&
              r1.data.b64 === 'JVBERg==' && r2.status === 404 && r3.status === 200 && rendered.length === 2 &&
              /Diagnosis/.test(annHtml) && /AI rating<\/th><td>9 of 10/.test(annHtml) && /Ann9 Lead/.test(annHtml) &&
              !leaks(annHtml) && /Personal care<\/th><td>Needs help bathing and dressing/.test(cyHtml) &&
              /Cy9 Convert ISP\.pdf/.test(cyHtml) && !leaks(cyHtml),
              JSON.stringify([f1.status, f2, f3, f4, r1.status, r2, r3.status, bytesAsked, annHtml.slice(0, 400)]));

    // ---- activity ----
    var va = seen('activity ann', HUB_ACTIONS.clientCandidateActivity({ candidate: ANN }, master));
    var vi = (va.data && va.data.items) || [];
    var vb = HUB_ACTIONS.clientCandidateActivity({ candidate: BOB }, master);
    var ve = HUB_ACTIONS.clientCandidateActivity({ candidate: EVE }, master);
    var vg = HUB_ACTIONS.clientCandidateActivity({ candidate: GUS }, master);
    stAssert_(out, P + 'activity: every press logged here (with who and the second), every change the platform logged on ' +
                   'the row (a held one marked), its opening after the alert — found under the key Potential Clients ' +
                   'writes it — the team\'s alert pass and the arrival, newest first; never another row\'s line, the ' +
                   'app\'s own press twice, a line merely keyed by the name, or the opening twice',
              va.status === 200 && vi.map(function (i) { return i.kind + ':' + i.at.slice(0, 10); }).join() ===
                'step:2026-09-14,note:2026-09-13,record:2026-09-11,record:2026-09-10,stage:2026-09-05,' +
                'alert:2026-09-02,referral:2026-09-01' &&
              vi[0].title === 'Reopened action: First call with the family or SSA' && vi[0].by === 'The Master' &&
              vi[0].at === '2026-09-14T11:30:09.000Z' && vi[1].title === 'Note added' &&
              vi[2].ok === false && vi[2].body === 'held by the switch' && vi[2].by === 'coord9@example.org' &&
              vi[3].title === 'Referral record updated' && vi[3].ok === true &&
              vi[4].title === 'Opened after the team alert — New → Read' && vi[4].by === 'dsp9@example.org' &&
              vi[5].title === 'The team was texted about this referral' && vi[5].body === 'To 2 numbers' &&
              vi[5].channel === 'SMS' && vi[5].at === '2026-09-02T09:00:01.000Z' &&
              vi[6].title === 'Referral received from the county referral portal' && vi[6].body === 'Referral 9001' &&
              /not which field/.test(va.data.why.join(' ')) && va.data.degraded === false,
              JSON.stringify(va.data).slice(0, 1800));
    stAssert_(out, P + 'activity: a closed window is its own line; a hand-added referral starts at its creation; a held ' +
                   'alert is a line of its own, never "texted"',
              vb.data.items.map(function (i) { return i.id; }).join() === 'window,referral' &&
              vb.data.items[0].title === 'Referral window closed' && vb.data.why.length === 0 &&
              ve.data.items.length === 1 && ve.data.items[0].title === 'Referral added' && ve.data.items[0].body === 'manual' &&
              vg.data.items[0].title === 'An alert about this referral was held' &&
              vg.data.items[0].body === 'To 1 number — the quiet window',
              JSON.stringify([vb.data, ve.data, vg.data.items[0]]));
    var evTab = tabs[EVENTS_TAB], mockTab = tabs[COMM_MOCK_HOUSE];
    tabs[EVENTS_TAB] = { getLastRow: function () { throw new Error('st: events closed'); } };
    delete tabs[COMM_MOCK_HOUSE];
    var vx = HUB_ACTIONS.clientCandidateActivity({ candidate: ANN }, master);
    tabs[EVENTS_TAB] = evTab;
    tabs[COMM_MOCK_HOUSE] = mockTab;
    stAssert_(out, P + 'activity: an unreadable event log, or an outbox that cannot say when an alerted referral was ' +
                   'texted, is degraded and said, never an empty record; the log of presses still answers',
              vx.status === 200 && vx.data.degraded === true && /event log could not be read/.test(vx.data.why.join(' ')) &&
              /outbox could not be opened/.test(vx.data.why.join(' ')) && vx.data.items.length === 3,
              JSON.stringify(vx.data));

    // ---- overview ----
    var oa = seen('overview ann', HUB_ACTIONS.clientCandidateOverview({ candidate: ANN }, master));
    var oc = seen('overview cy', HUB_ACTIONS.clientCandidateOverview({ candidate: CY }, master));
    var og = HUB_ACTIONS.clientCandidateOverview({ candidate: GUS }, master);
    var oaText = JSON.stringify(oa);
    stAssert_(out, P + 'overview: at a glance, contact and information from the referral row (its diagnosis, age, gender, ' +
                   'funding and window too), the AI rating, the open phases and documents counted from their own ' +
                   'sections, the next phase and the newest activity; nothing keeps an SSN, a date of birth, a Medicaid ' +
                   'or a card number however written',
              oa.status === 200 && oa.data.candidate.name === 'Ann9 Lead' && oa.data.candidate.stage === 'read' &&
              oa.data.candidate.status_label === 'Referral' && oa.data.candidate.intake_stage === 'referral' &&
              oa.data.candidate.location === 'ZIP 44709' && oa.data.candidate.owner === 'coord9@example.org' &&
              oa.data.candidate.source === 'County referral portal' && oa.data.candidate.referral_id === '9001' &&
              oa.data.candidate.client_key === '' && oa.data.information.intake_coordinator === 'coord9@example.org' &&
              oa.data.information.family === '' && oa.data.information.age === '34' &&
              oa.data.information.gender === 'F' && oa.data.information.expires === '10/15/26' &&
              oa.data.information.service_requested === 'Residential support 24/7' && oa.data.rating.value === '9' &&
              oa.data.tiles.open_actions === 3 && oa.data.tiles.docs_on_file === 1 && oa.data.tiles.docs_total === 3 &&
              oa.data.next.id === 'referral_review' && oa.data.next.due === '2026-10-15' && oa.data.recent.length === 5 &&
              oa.data.recent[0].kind === 'step' && oa.data.client === null && oa.data.opened === null &&
              /DOB \[withheld\]/.test(oa.data.summary) && /Medicaid # \[withheld\]/.test(oa.data.summary) &&
              /SSN \[withheld\]/.test(oa.data.summary) && /card \[withheld\]/.test(oa.data.information.diagnosis) &&
              /birthday \[withheld\]/.test(oa.data.summary) && !leaks(oaText) && oaText.indexOf('4111') === -1,
              oaText.slice(0, 1800));
    stAssert_(out, P + 'overview: a referral Ready for Intake names the client it became and the Clients app\'s address; a ' +
                   'new, texted one carries the Potential Clients opening report',
              oc.status === 200 && oc.data.client.key === 'cy9convert' && oc.data.candidate.client_key === 'cy9convert' &&
              oc.data.client.href === '/app/client-profiles/profile?client=cy9convert' && oc.data.next === null &&
              JSON.stringify(og.data.opened) === JSON.stringify({ action: 'leadOpened', payload: { ids: [GUS] } }),
              JSON.stringify([oc.data.client, og.data.opened]));

    // ---- texts and calls ----
    quoOpened = 0;
    var ta = seen('texts ann', HUB_ACTIONS.clientCandidateTexts({ candidate: ANN }, master));
    var tb = seen('texts bob', HUB_ACTIONS.clientCandidateTexts({ candidate: BOB }, master));
    var opensForTwo = quoOpened;
    var te = HUB_ACTIONS.clientCandidateTexts({ candidate: EVE }, master);
    var taText = JSON.stringify(ta);
    stAssert_(out, P + 'texts: the Staff app\'s reader over the referral\'s own phone — one conversation per company ' +
                   'line, newest first, the referral signs what it sent and the line\'s sole holder what it sent — and ' +
                   'the team\'s alerts about the referral from the outbox as platform messages; a stranger, another ' +
                   'referral\'s alert and an SSN or a card however written never appear',
              ta.status === 200 && ta.data.with === '3309197595' && ta.data.counterparts.length === 1 &&
              ta.data.messages.map(function (m) { return m.id; }).join() === 'm2,m1' && ta.data.messages[1].by === 'Ann9 Lead' &&
              ta.data.messages[0].by === 'Ivy Owner' && ta.data.phones_matched === 1 && taText.indexOf('stranger') === -1 &&
              taText.indexOf('shared phone') === -1 && /SSN is \[withheld\]/.test(taText) && /card \[withheld\]/.test(taText) &&
              ta.data.alerts.map(function (a) { return a.id + ':' + a.result; }).join() === 'p1#2:sent,p1#1:sent' &&
              ta.data.alerts[0].to === '+1 (330) ***-0102' && /DOB \[withheld\]/.test(ta.data.alerts[0].body) &&
              taText.indexOf('Another referral') === -1 && !leaks(taText) && opensForTwo >= 2,
              taText.slice(0, 1400));
    stAssert_(out, P + 'texts: a number another referral also carries is still this one\'s — listed, and why says it is ' +
                   'shared; a referral with no phone is answered without opening the texts house',
              tb.status === 200 && tb.data.messages.map(function (m) { return m.id; }).join() === 'm3' &&
              /also on 1 other referral/.test(tb.data.why) && tb.data.alerts.length === 0 &&
              te.status === 200 && te.data.messages.length === 0 && te.data.why === 'no phone number is on the referral' &&
              quoOpened === opensForTwo, JSON.stringify([tb.data, te.data, quoOpened]));
    var ca = seen('calls ann', HUB_ACTIONS.clientCandidateTranscripts({ candidate: ANN }, master));
    var cb = seen('calls bob', HUB_ACTIONS.clientCandidateTranscripts({ candidate: BOB }, master));
    stAssert_(out, P + 'transcripts: every call with the referral\'s numbers, metadata only, never the words — a number ' +
                   'another referral carries too included, and said',
              ca.status === 200 && ca.data.calls.map(function (c) { return c.call_id; }).join() === 'AC-1' &&
              ca.data.calls[0].secs === '300' && JSON.stringify(ca).indexOf('SECRET') === -1 &&
              cb.status === 200 && cb.data.calls.map(function (c) { return c.call_id; }).join() === 'AC-3' &&
              /also on 1 other referral/.test(cb.data.why), JSON.stringify([ca, cb]).slice(0, 1200));
    var doorAsked = [];
    HUB_ACTIONS.commCallsTranscript = function (p, u) {
      doorAsked.push(p.call_id + ':' + (u && u.email));
      return { status: 200, data: { call_id: p.call_id, full_transcript: 'My SSN is 123-45-6789 and DOB: 01/02/1990; ' +
                                    'born on 2 Jan 1990; card 4111.1111.1111.1111', speaker_transcript: '', has_words: true } };
    };
    var w1 = HUB_ACTIONS.clientCandidateTranscript({ candidate: ANN, id: 'AC-1' }, master);
    var w2 = HUB_ACTIONS.clientCandidateTranscript({ candidate: ANN, id: 'AC-2' }, master);
    var w3 = HUB_ACTIONS.clientCandidateTranscript({ candidate: ANN, call_id: 'AC-1' }, master);
    var w4 = HUB_ACTIONS.clientCandidateTranscript({ candidate: ANN }, master);
    HUB_ACTIONS.commCallsTranscript = keep.transcript;
    stAssert_(out, P + 'transcript: a listed call\'s words come through the transcript door and leave scrubbed; a call ' +
                   'not listed for the referral is 404 before the door, no id 400',
              w1.status === 200 && w1.data.full_transcript ===
                'My SSN is [withheld] and DOB [withheld]; born on [withheld]; card [withheld]' &&
              w2.status === 404 && w3.status === 200 && w4.status === 400 &&
              doorAsked.join() === 'AC-1:' + HUB_MASTER_ACCOUNT + ',AC-1:' + HUB_MASTER_ACCOUNT,
              JSON.stringify([w1, w2, w4, doorAsked]));

    // ---- the relay's pack ----
    leadReads = 0;
    var heldClients = CLIENTS_DERIVED_MEMO_;
    var pack = seen('pack', HUB_ACTIONS.clientCandidatePack({ candidate: ANN }, serviceUser_()));
    var packReads = leadReads;
    var pp = (pack.data && pack.data.parts) || {};
    var ps = (pack.data && pack.data.part_status) || {};
    var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
    var parity = {
      overview: same(pp.overview, HUB_ACTIONS.clientCandidateOverview({ candidate: ANN }, master).data),
      actions: same(pp.actions, HUB_ACTIONS.clientCandidateActions({ candidate: ANN }, master).data),
      intake: same(pp.intake, HUB_ACTIONS.clientCandidateIntake({ candidate: ANN }, master).data),
      documents: same(pp.documents, HUB_ACTIONS.clientCandidateDocuments({ candidate: ANN }, master).data),
      activity: same(pp.activity, HUB_ACTIONS.clientCandidateActivity({ candidate: ANN }, master).data),
      texts: same(pp.texts, HUB_ACTIONS.clientCandidateTexts({ candidate: ANN }, master).data),
      transcripts: same(pp.transcripts, HUB_ACTIONS.clientCandidateTranscripts({ candidate: ANN }, master).data)
    };
    stAssert_(out, P + 'pack: the service reads all seven parts in one execution, each exactly its own action\'s answer, ' +
                   'the referrals read once for all of them, the memos restored after',
              pack.status === 200 && pack.data.candidate === ANN && !!pack.data.built_at &&
              CC_PACK_PARTS.every(function (n) { return ps[n] && ps[n].status === 200 && pp[n] !== undefined; }) &&
              Object.keys(parity).every(function (k) { return parity[k]; }) && packReads === 1 && CC_MEMO_ === null &&
              CLIENTS_DERIVED_MEMO_ === heldClients,
              JSON.stringify([pack.status, ps, parity, packReads]));
    ccActivityDoor_ = function () { throw new Error('st: activity closed'); };
    var broken = HUB_ACTIONS.clientCandidatePack({ candidate: ANN }, serviceUser_());
    ccActivityDoor_ = keep.activityDoor;
    CC_PACK_BUDGET_MS = -1;
    var late = HUB_ACTIONS.clientCandidatePack({ candidate: ANN }, serviceUser_());
    CC_PACK_BUDGET_MS = keep.budget;
    var pNone = HUB_ACTIONS.clientCandidatePack({ candidate: 'LEAD_0000' }, serviceUser_());
    var pJunk = HUB_ACTIONS.clientCandidatePack({ candidate: 'a b' }, serviceUser_());
    var bst = (broken.data && broken.data.part_status) || {};
    stAssert_(out, P + 'pack: a part that throws is its own 503 and the others answer; past its budget it starts no part ' +
                   'and says so part by part; an unknown or malformed id is the lookup\'s own 400, never an empty pack',
              broken.status === 200 && bst.activity.status === 503 && /activity closed/.test(bst.activity.message) &&
              !broken.data.parts.activity &&
              ['overview', 'actions', 'intake', 'documents', 'texts'].every(function (n) { return bst[n].status === 200; }) &&
              late.status === 200 && Object.keys(late.data.parts).length === 0 &&
              CC_PACK_PARTS.every(function (n) { return late.data.part_status[n].status === 503; }) &&
              pNone.status === 400 && !pNone.data && pJunk.status === 400 && CC_MEMO_ === null,
              JSON.stringify([bst, pNone, pJunk]));

    // ---- nothing private leaves, nothing is logged ----
    var runs = [];
    answers.forEach(function (pair) { if (leaks(JSON.stringify(pair[1]))) runs.push(pair[0]); });
    stAssert_(out, P + 'no answer of any read carries a 9- or 12-digit run, an SSN or a card number however written, a ' +
                   'date of birth however written or a call\'s words',
              answers.length === 13 && runs.length === 0, 'answers=' + answers.length + ' with runs: ' + runs.join(', '));
    stAssert_(out, P + 'no read writes a log line of its own — the referral\'s clinical words are never logged',
              logged.length === 0, logged.slice(0, 3).join(' | '));

    // ---- the presses ----
    var writes = [], releases = 0;
    requireRow_ = function (res, id) {
      if (res !== 'potentialClients') throw new Error('st: no live resource ' + res);
      var hit = leads.filter(function (r) { return r.id === id; })[0];
      return hit ? clone(hit) : { error: { status: 404, message: 'No "potentialClients" record with id "' + id + '".' } };
    };
    updateRowById_ = function (res, patch) {
      if (res !== 'potentialClients') throw new Error('st: no write to ' + res);
      writes.push(clone(patch));
      var hit = leads.filter(function (r) { return r.id === patch.id; })[0];
      Object.keys(patch).forEach(function (k) {
        hit[k] = (patch[k] && typeof patch[k] === 'object') ? JSON.stringify(patch[k]) : patch[k];
      });
      return clone(hit);
    };
    sheetDbGateHolds_ = function () { return null; };
    var press = function (payload) { return HUB_ACTIONS.clientCandidateWrite(payload, master); };
    var lastLog = function () { var w = writes[writes.length - 1] || {}; var l = w.candidate_log || []; return l[l.length - 1] || {}; };
    var refusals = [press({ kind: 'note', note: 'x' }), press({ candidate_id: 'a b', kind: 'note', note: 'x' }),
                    press({ candidate_id: ANN, kind: 'wipe' }), press({ candidate_id: ANN, kind: 'note', note: '  ' }),
                    press({ candidate_id: ANN, kind: 'stage', stage: 'discovery', note: 'x' }),
                    press({ candidate_id: 'LEAD_0000', kind: 'note', note: 'x' }),
                    press({ candidate_id: ANN, kind: 'stage', stage: 'nowhere' }),
                    press({ candidate_id: ANN, kind: 'stage', stage: 'Referral' }),
                    press({ candidate_id: BOB, kind: 'complete', item: 'referral_review' }),
                    press({ candidate_id: BOB, kind: 'complete', item: 'placement' }),
                    press({ candidate_id: BOB, kind: 'reopen', item: 'assessment' }),
                    press({ candidate_id: DEE, kind: 'reopen', item: 'referral_review' }),
                    press({ candidate_id: ANN, kind: 'complete', item: 'nothing' })];
    stAssert_(out, P + 'presses: no row id, a malformed one, an unknown kind, an empty note, a note on Update stage, a ' +
                   'referral not on file, a stage that is none of the six or the one it is at, a step already complete ' +
                   'or not next, one still open or closed to reopen and an unknown step are each refused, nothing written',
              refusals.map(function (r) { return r.status; }).join() === '400,400,400,400,400,400,400,409,409,409,409,409,400' &&
              refusals[5].message === 'No candidate "LEAD_0000" is on file.' &&
              refusals[7].message === 'Ann9 Lead is already at Referral.' &&
              refusals[8].message === 'First call with the family or SSA is already complete.' &&
              refusals[9].message === 'Comes after Discovery & assessment.' && writes.length === 0,
              JSON.stringify(refusals));
    var s1 = press({ candidate_id: ANN, kind: 'stage', stage: 'discovery' });
    var w1p = writes[0] || {};
    stAssert_(out, P + 'Update stage writes the stage\'s label on the row read live, and one log line "Stage: <from> → ' +
                   '<to>" with who and the second; the answer names the row\'s new stage and touches no note',
              s1.status === 200 && Object.keys(w1p).sort().join() === 'candidate_log,id,stage' && w1p.stage === 'Discovery' &&
              w1p.candidate_log.length === 3 && lastLog().text === 'Stage: Referral → Discovery' &&
              lastLog().kind === 'stage' && lastLog().by === 'The Master' &&
              /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(lastLog().at) &&
              JSON.stringify(s1.data.row) === JSON.stringify({ id: ANN, stage: 'Discovery' }) &&
              s1.data.entry.text === 'Stage: Referral → Discovery',
              JSON.stringify([s1, w1p]).slice(0, 1200));
    var c1 = press({ candidate_id: BOB, kind: 'complete', item: 'assessment', note: 'Met the family;  all agreed' });
    var c1p = writes[1] || {};
    stAssert_(out, P + 'Mark complete writes the step\'s own move and "Completed action: <step>"; its note is one line ' +
                   'appended to the notes — the Ohio time to the second, who, the step, the words — and never logged',
              c1.status === 200 && c1p.stage === 'Placement Review' &&
              /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} · The Master — Needs assessment & house fit: Met the family; all agreed$/
                .test(c1p.notes) && lastLog().text === 'Completed action: Needs assessment & house fit' &&
              lastLog().kind === 'step' && c1p.candidate_log.length === 1,
              JSON.stringify([c1, c1p]).slice(0, 1200));
    var r1p = press({ candidate_id: CY, kind: 'reopen', item: 'assessment' });
    var r1w = writes[2] || {};
    var n1 = press({ candidate_id: GUS, kind: 'note', note: 'Called the family back', item: 'referral_review' });
    var n1w = writes[3] || {};
    stAssert_(out, P + 'Reopen moves the referral back to the step\'s own stage with "Reopened action: <step>"; Add note ' +
                   'appends to the notes the row holds now, logs "Note added" and moves nothing',
              r1p.status === 200 && r1w.stage === 'Discovery' && r1w.candidate_log[0].text ===
                'Reopened action: Needs assessment & house fit' && n1.status === 200 && !('stage' in n1w) &&
              /The Master — First call with the family or SSA: Called the family back$/.test(n1w.notes) &&
              n1w.notes.split('\n').length === 1 && n1w.candidate_log[0].text === 'Note added' && !n1.data.row.stage,
              JSON.stringify([r1p, r1w, n1, n1w]).slice(0, 1400));
    var n2 = press({ candidate_id: GUS, kind: 'note', note: 'Second note' });
    var n2w = writes[4] || {};
    stAssert_(out, P + 'a second note on the same row keeps the first — the notes are read live under the lock, never ' +
                   'written whole from an older copy — and the log grows by one',
              n2.status === 200 && n2w.notes.split('\n').length === 2 && /Called the family back/.test(n2w.notes) &&
              /Second note$/.test(n2w.notes) && n2w.candidate_log.length === 2, JSON.stringify(n2w).slice(0, 800));
    var many = [];
    for (var k = 0; k < CC_LOG_CAP + 20; k++) many.push({ at: '2026-01-01T00:00:00.000Z', by: 'x', kind: 'note', text: 'n' + k });
    var capped = ccLogWith_(JSON.stringify(many), { at: '2026-09-29T00:00:00.000Z', by: 'y', kind: 'note', text: 'last' });
    stAssert_(out, P + 'the log keeps its newest ' + CC_LOG_CAP + ' lines, the oldest let go',
              capped.length === CC_LOG_CAP && capped[capped.length - 1].text === 'last' && capped[0].text === 'n21',
              capped.length + ' ' + JSON.stringify(capped[0]));

    // ---- the papers ----
    var folders = [], made = [];
    ccBytes_ = function (b64) { return b64 === 'QUJD' ? [65, 66, 67] : []; };
    ccBlob_ = function (bytes, mime, name) { return { bytes: bytes, mime: mime, name: name }; };
    ccFolder_ = function (key) {
      folders.push(key);
      return { createFile: function (blob) { made.push(blob); return { getId: function () { return 'NewFile000' + made.length; } }; } };
    };
    var file = function (payload) { return HUB_ACTIONS.clientCandidateFile(payload, master); };
    var pdf = { name: 'assessment.pdf', mime: 'application/pdf', b64: 'QUJD' };
    var before = writes.length;
    var fr = [file({ candidate_id: ANN, doc: 'photo', file: pdf }), file({ candidate_id: ANN, doc: 'assessment', file: pdf }),
              file({ candidate_id: BOB, doc: 'assessment', file: { name: 'a.exe', mime: 'application/x-msdownload', b64: 'QUJD' } }),
              file({ candidate_id: BOB, doc: 'assessment' }), file({ candidate_id: BOB, doc: 'assessment', confirm: true }),
              file({ candidate_id: ANN, doc: 'consent', confirm: true })];
    stAssert_(out, P + 'papers: an unknown paper, an assessment away from the Assessment stage, a file that is not a PDF ' +
                   'or a picture, no file, a confirmed assessment and a consent confirmed before it is filed are each ' +
                   'refused before Drive, nothing written',
              fr.map(function (r) { return r.status; }).join() === '400,409,400,400,400,409' &&
              /at the Assessment stage/.test(fr[1].message) && folders.length === 0 && writes.length === before,
              JSON.stringify(fr));
    leads.filter(function (r) { return r.id === BOB; })[0].stage = 'Assessment';
    var fa = file({ candidate_id: BOB, doc: 'assessment', file: pdf });
    var faw = writes[writes.length - 1] || {};
    var dba = HUB_ACTIONS.clientCandidateDocuments({ candidate: BOB }, master);
    stAssert_(out, P + 'papers: the support assessment is filed into the referral\'s own folder as the paper it is, ' +
                   'recorded on the row with "Support assessment filed", and is On File with its file after',
              fa.status === 200 && folders.join() === BOB && made[0].mime === 'application/pdf' &&
              made[0].name === 'Support assessment - ' + BOB + ' - assessment.pdf' && made[0].bytes.join() === '65,66,67' &&
              faw.candidate_docs.assessment.file_id === 'NewFile0001' && faw.candidate_docs.assessment.by === 'The Master' &&
              lastLog().text === 'Support assessment filed' && lastLog().kind === 'document' &&
              dget(dba, 'assessment').status === 'on_file' && dget(dba, 'assessment').file_id === 'NewFile0001',
              JSON.stringify([fa, faw, dget(dba, 'assessment')]).slice(0, 1200));
    var fc = file({ candidate_id: GUS, doc: 'consent', file: { name: 'consent.jpg', mime: 'image/jpeg', b64: 'QUJD' },
                    method: 'Phone call', best_time: 'Mornings', contact_who: 'Rosa (daughter) 330-555-0101' });
    var fcw = writes[writes.length - 1] || {};
    var dgc = HUB_ACTIONS.clientCandidateDocuments({ candidate: GUS }, master);
    var tgc = HUB_ACTIONS.clientCandidateTexts({ candidate: GUS }, master);
    var fk = file({ candidate_id: GUS, doc: 'consent', confirm: true });
    var dgk = HUB_ACTIONS.clientCandidateDocuments({ candidate: GUS }, master);
    var fk2 = file({ candidate_id: GUS, doc: 'consent', confirm: true });
    stAssert_(out, P + 'papers: the signed consent is filed with the contact preferences on the row, In Review until the ' +
                   'master confirms it, then On File; each press is one log line; the number written in who to contact ' +
                   'is searched for texts; a second confirmation is refused',
              fc.status === 200 && fcw.contact_preferences.method === 'Phone call' &&
              fcw.contact_preferences.who === 'Rosa (daughter) 330-555-0101' && !fcw.candidate_docs.consent.confirmed_at &&
              dget(dgc, 'consent').status === 'in_review' && dget(dgc, 'consent').file_id === 'NewFile0002' &&
              /by Phone call · Mornings · ask for Rosa/.test(dget(dgc, 'consent').detail) &&
              tgc.status === 200 && tgc.data.phones_matched === 1 &&
              fk.status === 200 && dget(dgk, 'consent').status === 'on_file' && /confirmed/.test(dget(dgk, 'consent').detail) &&
              lastLog().text === 'Consent & contact preferences confirmed' && fk2.status === 409,
              JSON.stringify([fc, fcw, dget(dgc, 'consent'), fk, dget(dgk, 'consent'), fk2]).slice(0, 1600));
    stAssert_(out, P + 'no press writes a log line of its own — the platform\'s log keeps the action and the key, the ' +
                   'note\'s words stay in the notes',
              logged.length === 0, logged.slice(0, 3).join(' | '));

    // ---- the cache ----
    ccCached_ = keep.cached;
    var calls = 0, retired = [];
    cacheBump_ = function (scope) { retired.push(scope); keep.bump(scope); };
    var key = 'LEAD_ST' + Date.now();
    ccCached_('clientCandidateActions', { key: key, row: { id: 'a' }, memo: {} }, function () { calls++; return { degraded: true }; });
    ccCached_('clientCandidateActions', { key: key + 'b', row: { id: 'a' }, memo: {} }, function () { calls++; return { degraded: false }; });
    ccCached_('clientCandidateActions', { key: key + 'b', row: { id: 'a' }, memo: {} }, function () { calls++; return { degraded: false }; });
    ccCached_('clientCandidateActions', { key: key + 'b', row: { id: 'a', stage: 'contacted' }, memo: {} },
              function () { calls++; return { degraded: false }; });
    cacheBump_ = keep.bump;
    stAssert_(out, P + 'a read is kept per candidate under cc_<action>_<key> and the referral row\'s version: a degraded ' +
                   'one retires its own scope, and a write that changes the row is a new version',
              calls === 3 && retired.join() === 'cc_clientCandidateActions_' + key,
              'producer calls=' + calls + ' retired=' + retired.join());

    // ---- where the app lives, and what writes ----
    var asResource = Object.keys(RESOURCES).filter(function (k) { return /^clientCandidate/i.test(k); });
    var fns = Object.keys(g).filter(function (k) { return /^(cc[A-Z]|clientCandidates)/.test(k) && typeof g[k] === 'function'; });
    var writing = [];
    fns.map(function (k) { return [k, g[k]]; })
      .concat(CC_ACTIONS.concat(CC_WRITE_ACTIONS, ['clientCandidatePack']).map(function (a) { return [a, HUB_ACTIONS[a]]; }))
      .forEach(function (pair) {
        if (/updateRowById_|createRow_|deleteRowById_|appendRow|setValues?\(|deleteRows?\(|hubTabEnsure_|insertSheet|clear\(|setTrashed|api\.(update|delete)/
            .test(stCode_(pair[1]))) writing.push(pair[0]);
      });
    var locked = CC_WRITE_ACTIONS.every(function (a) {
      var code = stCode_(HUB_ACTIONS[a]);
      return /locationsLock_\(\)/.test(code) && /finally \{ lock\.releaseLock\(\); \}/.test(code) &&
             /requireRow_|ccLiveRow_\(/.test(code) && /updateRowById_\(CC_LEADS,/.test(code);
    });
    stAssert_(out, P + 'no generic resource, no tab of its own, and only the two presses write — each the referral\'s own ' +
                   'row, read live under the lock',
              asResource.length === 0 && fns.length >= 30 && writing.slice().sort().join() ===
                'clientCandidateFile,clientCandidateWrite' && locked,
              'resources=' + asResource.join() + ' functions=' + fns.length + ' writing=' + writing.join() + ' locked=' + locked);
  } finally {
    ccCandidate_ = keep.candidate;
    ccCached_ = keep.cached;
    HUB_MASTER_EMAIL_CACHE = keep.masterCache;
    HUB_MEMBER_CTX = keep.member;
    hubSysLog_ = keep.log;
    hubTabSheet_ = keep.sheet;
    listRows_ = keep.list;
    ssOpen_ = keep.ssOpen;
    hubId_ = keep.hubId;
    hubLineRow_ = keep.lineRow;
    hubLineOurs_ = keep.lineOurs;
    locationsDocBytes_ = keep.bytes;
    locationsToday_ = keep.today;
    cacheBump_ = keep.bump;
    optOutIndex_ = keep.optOut;
    clientsDerived_ = keep.clients;
    CLIENTS_DERIVED_MEMO_ = keep.clientsMemo;
    ispDocIndex_ = keep.ispIndex;
    ispDocFor_ = keep.ispFor;
    HUB_ACTIONS.commCallsTranscript = keep.transcript;
    ccActivityDoor_ = keep.activityDoor;
    CC_PACK_BUDGET_MS = keep.budget;
    requireRow_ = keep.requireRow;
    updateRowById_ = keep.update;
    sheetDbGateHolds_ = keep.holds;
    ccPdf_ = keep.pdf;
    ccFolder_ = keep.folder;
    ccBytes_ = keep.rawBytes;
    ccBlob_ = keep.blob;
    hubProfileAppRules_ = keep.rules;
    hubProfileAppGate_ = keep.appGate;
    usersAll_ = keep.users;
    HUB_VIEWER_MEMO = keep.viewerMemo;
    locationsClientRows_ = keep.clientRows;
    locationsHomes_ = keep.homes;
    ssaIndex_ = keep.ssa;
    CC_MEMO_ = null;
  }
}
