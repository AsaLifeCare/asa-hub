// Families: the gate and the viewer's cut, the family read from the records, plans and directory, documents…
function stFamilyProfiles_(out) {
  var P = 'family profiles: ';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var PAT = 'fam_pat9foster';
  var keep = {
    appGate: hubProfileAppGate_, named: hubViewerNamed_,
    family: familyProfilesFamily_, cached: famCached_, masterCache: HUB_MASTER_EMAIL_CACHE, member: HUB_MEMBER_CTX,
    log: hubSysLog_, ensure: hubTabEnsure_, sheet: hubTabSheet_, holds: sheetDbGateHolds_, listRows: listRows_,
    derived: clientsDerived_, master: cpMasterIndex_, archive: cpArchiveIndex_, photos: clientPhotoIndex_,
    homes: locationsHomes_, today: locationsToday_, docIndex: ispDocIndex_, doc: ispDocFor_, lineRow: hubLineRow_,
    lineOurs: hubLineOurs_, hubId: hubId_, ssOpen: ssOpen_, bytes: locationsDocBytes_, bump: cacheBump_,
    calendar: locationsCalendar_, estate: estateRows_, userByEmail: userByEmail_, route: route,
    activityDoor: famActivityDoor_, budget: FAM_PACK_BUDGET_MS, profileWrite: cpProfileWrite_, lock: locationsLock_
  };
  var master = { id: 'u-master', email: HUB_MASTER_ACCOUNT, role: 'admin', display_name: 'The Master' };
  var answers = [];
  var seen = function (label, r) { answers.push([label, r]); return r; };
  var cfxUndo = stCfxStub_();
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    HUB_MEMBER_CTX = null;
    CLIENTS_DERIVED_MEMO_ = null;
    FAM_INDEX_MEMO_ = null;

    // ---- declarations ----
    var READS = ['familyProfileRoster', 'familyProfileOverview', 'familyProfileDocuments', 'familyProfileActivity',
                 'familyProfileNotes'];
    var TOOLS = ['familyProfileDocFile'];
    var READ_ROLES = '["admin","director","manager","staff","client","onboarding","interviewer"]';
    var bad = [];
    FAM_ACTIONS.forEach(function (a) {
      var p = HUB_POLICY[a];
      if (!p || p.file !== 'FamilyProfiles.gs' || typeof HUB_ACTIONS[a] !== 'function') { bad.push(a + ': undeclared'); return; }
      if (RESOLVER_LANES.indexOf(p.lane) === -1 || RESOLVER_STORES.indexOf(p.store) === -1) bad.push(a + ': lane/store');
      var inv = a === 'familyProfileSave' ? '["clients","people"]' : '[]';
      if (JSON.stringify(p.invalidates || []) !== inv || (p.emits || []).length) bad.push(a + ': invalidates/emits');
      var params = p.params || {};
      Object.keys(params).forEach(function (k) { if (params[k] && params[k].required) bad.push(a + ': ' + k + ' required at the door'); });
      var want = READS.indexOf(a) !== -1 ? 'read' : (TOOLS.indexOf(a) !== -1 ? 'tool' : 'write');
      if (p.lane !== want) bad.push(a + ': lane ' + p.lane + ', wanted ' + want);
      if (want === 'read' && p.idempotent !== true) bad.push(a + ': a read not idempotent');
      var roles = want === 'write' ? '["admin","manager"]' : READ_ROLES;
      if (JSON.stringify(p.roles) !== roles) bad.push(a + ': roles ' + JSON.stringify(p.roles));
      var first = want === 'write'
        ? /^function\s*\(payload, user\)\s*\{\s*if \(!familyProfilesMasterGate_\(user\)\) return familyProfilesUnknown_\(\);/
        : /^function\s*\(payload, user\)\s*\{\s*var view = familyProfilesGate_\(user\);\s*if \(!view\) return familyProfilesUnknown_\(\);/;
      if (!first.test(stCode_(HUB_ACTIONS[a]))) bad.push(a + ': the gate is not the first line');
    });
    stAssert_(out, P + 'all 10 actions are declared in FamilyProfiles.gs on their lane — the reads for every role a release ' +
                   'can reach, the writes for admin/manager — emit nothing, invalidate nothing but the edit\'s clients ' +
                   'and people, require no param before the gate, and open with the gate: the reads with the released ' +
                   'one, the writes with the master\'s',
              bad.length === 0 && FAM_ACTIONS.length === 10, bad.join('; '));
    var pol = HUB_POLICY.familyPack || {};
    stAssert_(out, P + 'pack: declared in FamilyProfiles.gs as an idempotent admin read, a service read, no section ' +
                   'door, its four parts each a door, and the service-only gate its first line',
              pol.file === 'FamilyProfiles.gs' && pol.lane === 'read' && pol.idempotent === true &&
              JSON.stringify(pol.roles) === '["admin"]' && typeof HUB_ACTIONS.familyPack === 'function' &&
              SERVICE_READ_ACTIONS.indexOf('familyPack') !== -1 && FAM_ACTIONS.indexOf('familyPack') === -1 &&
              FAM_PACK_PARTS.join() === 'overview,documents,activity,notes' &&
              JSON.stringify(Object.keys(famPackDoors_('x')).sort()) === JSON.stringify(FAM_PACK_PARTS.slice().sort()) &&
              /^function\s*\(payload, user\)\s*\{\s*if \(!user \|\| !user\.is_service\) return familyProfilesUnknown_\(\);/
                .test(stCode_(HUB_ACTIONS.familyPack)), JSON.stringify(pol));

    // ---- the gate ----
    var gateAsked = [];
    var gateScope = null;
    hubProfileAppGate_ = function (app) {
      gateAsked.push(app);
      return gateScope ? { open: true, scope: JSON.parse(JSON.stringify(gateScope)) } : { open: false, scope: { kind: 'none' } };
    };
    var asked = 0;
    familyProfilesFamily_ = function () { asked++; return { refused: { status: 418, message: 'st: the family was asked' } }; };
    var derivedCalls = 0;
    clientsDerived_ = function () { derivedCalls++; throw new Error('st: the clients were read'); };
    var callers = [
      { email: 'admin@example.org', role: 'admin' },
      { email: 'mgr@example.org', role: 'manager' },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', is_service: true },
      { email: HUB_MASTER_ACCOUNT, role: 'manager' },
      null
    ];
    var probe = { family: PAT, file_id: 'KayIspFile12345', body: 'x', client_key: 'kay9test', date: '2026-09-25',
                  incident_ts: '2026-08-25T10:00:00.000Z' };
    var shape = function (r) { return !!r && r.status === 404 && r.message === 'Unknown action.' && Object.keys(r).length === 2; };
    var leaks = [];
    FAM_ACTIONS.forEach(function (a) {
      callers.forEach(function (u) {
        var r = HUB_ACTIONS[a](probe, u);
        if (!shape(r)) leaks.push(a + ' ' + JSON.stringify(u) + ' → ' + JSON.stringify(r));
      });
      HUB_MEMBER_CTX = { memberId: 'mem_st', userId: 'u-st', email: 'ann@example.org' };
      var inVisit = HUB_ACTIONS[a](probe, master);
      HUB_MEMBER_CTX = null;
      if (!shape(inVisit)) leaks.push(a + ' in a visit → ' + JSON.stringify(inVisit));
    });
    var readsAsked = FAM_ACTIONS.filter(function (a) { return HUB_POLICY[a].lane !== 'write'; }).length * (callers.length + 1);
    stAssert_(out, P + 'with no App Control row naming their badges, another admin, a manager, a visit, the service ' +
                   'identity, the master as a manager, no session and the member context all get the exact 404 shape ' +
                   'before the family or the clients are looked up; each read asks the gate of family-profiles, a write ' +
                   'never does',
              leaks.length === 0 && asked === 0 && derivedCalls === 0 && gateAsked.length === readsAsked &&
              gateAsked.every(function (x) { return x === 'family-profiles'; }),
              leaks.slice(0, 4).join(' | ') + ' asked=' + asked + ' derived=' + derivedCalls + ' gate=' + gateAsked.length);
    gateAsked = [];
    var passed = FAM_ACTIONS.filter(function (a) { return a !== 'familyProfileRoster'; }).map(function (a) {
      return a + ':' + HUB_ACTIONS[a](probe, master).status;
    });
    stAssert_(out, P + 'the master in its own session passes the gate to the family lookup without asking App Control',
              passed.every(function (s) { return /:418$/.test(s); }) && asked === passed.length && gateAsked.length === 0,
              passed.join() + ' gate=' + gateAsked.length);
    asked = 0;
    var packShut = [{ email: 'admin@example.org', role: 'admin' }, { email: 'mgr@example.org', role: 'manager' },
                    { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' }, master, null].map(function (u) {
      return HUB_ACTIONS.familyPack(probe, u);
    });
    var packOpen = HUB_ACTIONS.familyPack(probe, serviceUser_()).status;
    stAssert_(out, P + 'pack: every session — the master\'s own included — and no session get the exact 404 shape before ' +
                   'the lookup; the service identity reaches it',
              packShut.every(shape) && packOpen === 418 && asked === 1 && CLIENTS_DERIVED_MEMO_ === null &&
              FAM_INDEX_MEMO_ === null, JSON.stringify([packShut, packOpen, asked]));
    familyProfilesFamily_ = keep.family;

    // ---- fixtures ----
    famCached_ = function (action, key, part, deps, producer) { return producer(); };
    var derived = [
      { client_key: 'kay9test', id: 'CLI_kay9test', name: 'Kay9 Test', house: 'ZZ9999', status: 'active',
        avatar: 'https://img/kay.png', isp_year: 'January 1, 2026 - October 15, 2026', isp_signed_date: '2026-01-05',
        guardianName: 'Pat9 Foster', guardian_relationship: 'Mom', guardian_phone: '(330) 555-0171',
        guardian_email: 'Pat9@Example.org', guardian_address: '12 Oak St, Canton',
        guardianship_papers: 'https://drive.google.com/file/d/PapersFile12345/view',
        contacts: 'Guardian: Pat9 Foster (Mom) - Guardian and payee', medications: ['secret pill'], diagnoses_text: 'dx words' },
      { client_key: 'lee9other', id: 'CLI_lee9other', name: 'Lee9 Other', house: 'QQ1000', status: 'active',
        guardianName: 'Pat9 Foster', guardian_relationship: 'Mother', guardianship_papers: 'Yes' },
      { client_key: 'mo9late', id: 'CLI_mo9late', name: 'Mo9 Late', house: 'ZZ9999', status: 'active',
        guardianName: 'Denise9 Hollen', guardian_relationship: 'State Appointed', guardian_phone: '330-555-0444' },
      { client_key: 'nia9none', id: 'CLI_nia9none', name: 'Nia9 None', house: 'QQ1000', status: 'active',
        guardianName: 'Self', guardian_relationship: 'n/a' },
      { client_key: 'bo9blank', id: 'CLI_bo9blank', name: 'Bo9 Blank', house: 'ZZ9999', status: 'active' },
      { client_key: 'cy9unknown', id: 'CLI_cy9unknown', name: 'Cy9 Unknown', house: 'RR2000', status: 'active',
        guardianName: 'Tami9 Gardner', guardian_relationship: '',
        contacts: 'Guardian: Tami9 Gardner - Guardian (Guardianship of Person); 1058 Heyl Rd, Wooster, Wayne County' },
      { client_key: 'ora9org', id: 'CLI_ora9org', name: 'Ora9 Org', house: 'RR2000', status: 'active',
        guardianName: 'Coleman9 Professional Services', guardian_relationship: '' },
      { client_key: 'ivy9client', id: 'CLI_ivy9client', name: 'Ivy9 Client', house: 'RR2000', status: 'active',
        guardianName: 'Gus9 Buddy', guardian_relationship: 'Friend' },
      { client_key: 'jo9client', id: 'CLI_jo9client', name: 'Jo9 Client', house: 'RR2000', status: 'active' }
    ];
    derivedCalls = 0;
    clientsDerived_ = function () { derivedCalls++; return derived.slice(); };
    var masterValues = [['Client', 'Guardian', 'Guardian #', 'Guardian Email', 'Guardian Relationship', 'SSN'],
      ['Kay9 Test', 'Someone9 Else', '3305550999', 'someone9@else.org', 'Friend', '900-11-4544'],
      ['Lee9 Other', 'Pat9 Foster', '(330) 555-0171', 'pat9@example.org', 'Mother', ''],
      ['Jo9 Client', 'Al9 Lawyer', '', 'al9@law.org', 'Attorney', '']];
    var archValues = [['Customer', 'Guardian', 'Guardian #', 'Guardian Relationship', 'House', 'ISP'],
      ['Old9 Gone', 'Pat9 Foster', '3305550171', 'Mom', 'QQ1000', '03/04/2024'],
      ['Arch9 Only', 'Rex9 Retired', '3305550333', 'Father', 'QQ1000', ''],
      ['Kay9 Test', 'Pat9 Foster', '', '', '', '']];
    cpMasterIndex_ = function () { return cpBookIndexFrom_(masterValues, 'America/New_York'); };
    cpArchiveIndex_ = function () { return cpBookIndexFrom_(archValues, 'America/New_York'); };
    clientPhotoIndex_ = function () { return { rex9retired: 'https://img/rex.png' }; };
    locationsHomes_ = function () { return [{ code: 'ZZ9999', home_name: 'ZZ - Test House', address: '9999 Test Ave NW' }]; };
    locationsToday_ = function () { return '2026-09-22'; };
    var plan = ['Important People', 'Type', 'Name/Relationship', 'Address', 'Phone',
      'Guardian', 'Patricia9 Foster (Mother)', '12 Oak St', '330-555-0171',
      'Case Manager', 'Sam9 Case', 'sam9@case.org',
      'Family', 'Tom9 Test (Brother)', '330-555-0199',
      'Doctor', 'Dr9 Who',
      'Friend', 'Fran9 Friend'].join('\n');
    var tables = {
      isps: [{ client_key: 'kay9test', client_name: 'Kay9 Test', isp_year: 'January 1, 2026 - October 15, 2026',
               loaded_at: '2026-02-01T10:00:00Z', contact_block: '' },
             { client_key: 'lee9other', client_name: 'Lee9 Other', isp_year: 'March 1, 2026 - February 28, 2027',
               loaded_at: '2026-03-02T10:00:00Z', contact_block: 'Important People\nType\nFriend\nFran9 Friend' }],
      people: [
        { id: 'PPL_guardian_pat9foster', name: 'Pat9 Foster', role: 'guardian', status: 'active',
          guardian_for: 'Kay9 Test, Lee9 Other', avatar: 'https://img/pat.png', phone: '3305550171' },
        { id: 'PPL_guardian_denise9hollen', name: 'Denise9 Hollen', role: 'guardian', guardian_for: 'Mo9 Late' },
        { id: 'PPL_guardian_ghost9guardian', name: 'Ghost9 Guardian', role: 'guardian', guardian_for: 'Nia9 None' },
        { id: 'PPL_guardian_becky9barnes', name: 'Becky9 Barnes', role: 'guardian', guardian_for: 'Bo9 Blank',
          email: 'becky9@example.org' },
        { id: 'p-staff', name: 'Stan9 Staff', role: 'staff', phone: '3305550555' }],
      clientFiles: [
        { id: 'cf1', client_key: 'kay9test', client_name: 'Kay9 Test', title: 'Guardianship letters of authority',
          folder: 'Legal', drive_id: 'GuardLetters123', issued_on: '2026-02-01', mime_type: 'application/pdf' },
        { id: 'cf2', client_key: 'kay9test', client_name: 'Kay9 Test', title: 'Letter from Pat9 Foster',
          folder: 'Correspondence', drive_id: 'Pat9Letter12345', file_date: '2026-08-01' },
        { id: 'cf3', client_key: 'kay9test', client_name: 'Kay9 Test', title: 'Social Security card of Pat9 Foster',
          folder: 'Identity', doc_kind: 'ssn_card', drive_id: 'KaySsnFile12345' },
        { id: 'cf4', client_key: 'kay9test', client_name: 'Kay9 Test', title: 'Dentist letter', folder: 'Medical',
          drive_id: 'DentistFile1234' },
        { id: 'cf5', client_key: 'nia9none', client_name: 'Nia9 None', title: 'Consent form', drive_id: 'NiaConsent12345' },
        { id: 'cf6', client_key: '', client_name: 'Lee9 Other', title: 'Media consent', drive_id: 'MediaConsent123',
          issued_on: '2026-03-01' },
        { id: 'cf7', client_key: 'kay9test', client_name: 'Kay9 Test', title: 'HIPAA medical release consent',
          doc_kind: 'consent_release', digest_category: 'legal', drive_id: 'MedConsent12345', issued_on: '2026-05-01' },
        { id: 'cf8', client_key: 'kay9test', client_name: 'Kay9 Test', title: 'Prior authorization - wheelchair',
          doc_kind: 'prior_authorization', digest_category: 'care_plan', drive_id: 'PriorAuth123456', issued_on: '2026-05-02' },
        { id: 'cf9', client_key: 'kay9test', client_name: 'Kay9 Test', title: 'Receipt paid by Pat9 Foster', folder: 'Receipts',
          doc_kind: 'receipt', digest_category: 'receipt_invoice', drive_id: 'PatReceipt12345', issued_on: '2026-05-03' },
        { id: 'cf10', client_key: 'kay9test', client_name: 'Kay9 Test',
          title: 'Benefit letter - Stark County Job and Family Services', doc_kind: 'benefit_letter',
          digest_category: 'receipt_invoice', drive_id: 'JfsLetter123456', issued_on: '2026-05-04' },
        { id: 'cf11', client_key: 'kay9test', client_name: 'Kay9 Test', title: 'Self-admin assessment',
          doc_kind: 'self_admin_assessment', digest_category: 'medical', drive_id: 'SelfAdmin123456', issued_on: '2026-05-05' },
        { id: 'cf12', client_key: 'kay9test', client_name: 'Kay9 Test', title: 'Behavior Support Plan', folder: 'Plans',
          drive_id: 'BspFile12345678', issued_on: '2026-04-01' },
        { id: 'cf13', client_key: '', client_name: 'Lee9 Other', title: 'Probate court entry', doc_kind: 'guardianship',
          digest_category: 'legal', drive_id: 'ProbateEntry123', issued_on: '2025-12-01' }],
      tasks: [
        { id: 'T1', title: 'Call Pat9 Foster — Kay9 Test', column: 'this-week', priority: 'high', due: '2026-09-25',
          ownerId: 'u-master', family_key: PAT, client_key: 'kay9test', source: 'families',
          createdAt: '2026-09-15T09:00:00Z' },
        { id: 'T2', title: 'Forged', column: 'backlog', priority: 'normal', due: '2026-09-26', ownerId: 'u-other',
          family_key: PAT, client_key: 'kay9test', source: 'families', createdAt: '2026-09-16T09:00:00Z' },
        { id: 'T3', title: 'Own card', column: 'backlog', priority: 'normal', ownerId: 'u-master', family_key: PAT,
          createdAt: '2026-09-17T09:00:00Z' }]
    };
    listRows_ = function (res) {
      if (!tables.hasOwnProperty(res)) throw new Error('st: no table ' + res);
      return JSON.parse(JSON.stringify(tables[res]));
    };
    ispDocIndex_ = function () { return { files: [{ id: 'KayIspFile12345' }, { id: 'OldIspFile12345' }], index: {} }; };
    ispDocFor_ = function (name) {
      var k = clientNameKey_(name);
      if (k === 'kay9test') return { id: 'KayIspFile12345', name: 'Kay9 Test ISP.pdf', url: '' };
      if (k === 'old9gone') return { id: 'OldIspFile12345', name: 'Old9 Gone ISP 2024.pdf', url: '' };
      return { id: '', name: '', url: '' };
    };
    var tabs = {};
    tabs[CP_SECTIONS_TAB] = stLocSheet_([CP_SECTIONS_HEADER.slice(),
      ['IS_kay9test_important_people', 'kay9test', 'January 1, 2026 - October 15, 2026', 'important_people',
       'Important people', plan, 'Kay9 Test ISP.pdf', '2026-02-01T10:00:00Z']]);
    hubTabSheet_ = function (t) { return tabs[t] || null; };
    hubTabEnsure_ = function (t) { throw new Error('st: no tab ' + t); };
    sheetDbGateHolds_ = function () { return null; };
    hubLineRow_ = function (v) {
      var s = String(v || '');
      if (s === 'PNaaaa0001' || s === '3309197595') {
        return { digits: '3309197595', e164: '+13309197595', name: 'HR line', owner: 'Hera Owner', humans: 1, shared: false };
      }
      return null;
    };
    hubLineOurs_ = function (d) { return String(d) === '3309197595'; };
    hubId_ = function () { return ''; };
    userByEmail_ = function (e) { return String(e) === HUB_MASTER_ACCOUNT ? { id: 'u-master', email: e } : null; };
    var calValues = [['Location', 'Employee', 'Designation', 'Notes', 'Date', 'Start Time', 'End Time'],
      ['ZZ - Test House - ZZ9999', 'FAMILY', '', '', '2026-09-01', '16:30', '07:00'],
      ['ZZ - Test House - ZZ9999', 'FAMILY', '', '', '2026-09-02', '16:30', '07:00'],
      ['ZZ - Test House - ZZ9999', 'FAMILY', '', '', '2026-09-03', '16:30', '07:00'],
      ['ZZ - Test House - ZZ9999', 'FAMILY', '', '', '2026-09-10', '16:30', '07:00'],
      ['ZZ - Test House - ZZ9999', 'FAMILY', '', '', '2026-10-01', '16:30', '07:00'],
      ['ZZ - Test House - ZZ9999', 'FAMILY', '', '', '2026-11-30', '16:30', '07:00'],
      ['ZZ - Test House - ZZ9999', 'FAMILY', '', '', '2025-01-01', '16:30', '07:00'],
      ['ZZ - Test House - ZZ9999', 'Jane9 Staff', '', '', '2026-09-04', '07:00', '15:00'],
      ['QQ - Other House - QQ1000', 'Family', '', '', '2026-09-05', '', ''],
      ['RR - Third House - RR2000', 'FAMILY', '', '', '2026-09-12', '08:00', '20:00'],
      ['XX - Far House - XX3000', 'FAMILY', '', '', '2026-09-12', '08:00', '20:00']];
    var calReads = 0;
    locationsCalendar_ = function () { calReads++; return { cal: { values: calValues, tz: 'America/New_York' }, why: '' }; };
    var incidents = [
      { id: 'INC1', timestamp: '2026-08-20T10:00:00Z', your_name: 'Dee9 Dsp', client_name: 'Kay9 Test',
        incident_category: 'Fall', incident_date: '2026-08-20',
        summary_of_incident: 'Kay9 slipped; Pat9 Foster was called and came to the house.' },
      { id: 'INC2', timestamp: '2026-08-21T10:00:00Z', your_name: 'Dee9 Dsp', client_name: 'Kay9 Test',
        incident_category: 'Behavior', incident_date: '2026-08-21', summary_of_incident: 'No family named here.' },
      { id: 'INC3', timestamp: '2026-08-22T10:00:00Z', your_name: 'Dee9 Dsp', client_name: 'Nia9 None',
        incident_category: 'Fall', incident_date: '2026-08-22', summary_of_incident: 'Pat9 Foster visited.' },
      { id: 'INC4', timestamp: '2026-08-25T10:00:00.000Z', your_name: 'The Master', client_name: 'Kay9 Test',
        incident_category: 'Other', incident_date: '2026-08-25', summary_of_incident: 'Picked up late from the house.' },
      { id: 'INC5', timestamp: '2026-08-25T10:00:00.000Z', your_name: 'The Master', client_name: 'Lee9 Other',
        incident_category: 'Other', incident_date: '2026-08-25', summary_of_incident: 'Same minute, another client.' }];
    estateRows_ = function (r) { if (r !== 'uiIncidents') throw new Error('st: no estate ' + r); return incidents.slice(); };
    var logged = [];
    hubSysLog_ = function () { logged.push(JSON.stringify(Array.prototype.slice.call(arguments))); return true; };

    // ---- the relationship words ----
    var tie = function (rel, seg) { var t = famRecordTie_(rel, seg); return t.family + ':' + t.relationship; };
    var words = [famRelation_('his mom'), famRelation_('Grandmother'), famRelation_('Step-father'),
                 famRelation_('Mother-in-law'), famRelation_('Johnson'), famRelation_('Case Manager')];
    stAssert_(out, P + 'a family word is found whole — mom, grandmother, step-father, mother-in-law — never inside a name; ' +
                   'a record\'s relationship decides first, then its guardian line; state or court appointed, a friend, ' +
                   'an attorney or any other relationship with no family word is no family; a bare "guardian" or "n/a" ' +
                   'leaves it to the guardian line',
              words.join() === 'Mom,Grandmother,Step-father,Mother-in-law,,' &&
              tie('Mom', '') === 'true:Mom' && tie('State Appointed', '') === 'false:State Appointed' &&
              tie('Friend', '') === 'false:Friend' && tie('Attorney', 'Al9 - Guardian') === 'false:Attorney' &&
              tie('Case Manager', '') === 'false:Case Manager' && tie('Neighbor', '') === 'false:Neighbor' &&
              tie('Legal Guardian', 'Pat9 - Parent/Guardian') === 'true:Parent' && tie('Guardian.', '') === 'null:Guardian' &&
              tie('n/a', '') === 'null:Guardian' && tie('Guardianship of Person', '') === 'null:Guardian' &&
              tie('', 'Cathy9 Clauss - Parent/Guardian (Richard\'s mom)') === 'true:Parent' &&
              tie('', 'Coleman - court-appointed guardian') === 'false:' &&
              tie('', 'Tami9 - Guardian; Wayne County') === 'null:Guardian' &&
              famPlanTie_({ role: 'Case Manager', name: 'Sam9 (sister)' }) === null &&
              famPlanTie_({ role: 'Friend', name: 'Fran9 Friend' }) === null &&
              famPlanTie_({ role: 'Family', name: 'Tom9 Test' }).relationship === 'Family' &&
              famPlanTie_({ role: 'Other - Aunt', name: 'Ann9' }).relationship === 'Aunt' &&
              famKeyOf_('Coleman9 Professional Services') === '' && famKeyOf_('Self') === '' &&
              famKeyOf_('Pat9 Foster') === PAT && famAddress_('Mother 12 Oak St') === '12 Oak St' &&
              famAddress_('12 Brother Ave') === '12 Brother Ave',
              JSON.stringify(words));

    var runOn = famPlanPeople_('x9', { contact_block: ['Contact Information', 'Important People:', 'Type:', 'Family',
      'Frank9', '12 Elm St', 'OhioISP - X9 Y', 'Page 2', 'ISP Span Dates: March 1, 2026 - February 28, 2027', 'Friend',
      'Fran9 Friend', '1 Main St', 'Discovery Assessment Summary', 'It is important that his mother and family call.']
      .join('\n') }, {});
    stAssert_(out, P + 'plan: the Important People table is read across its page breaks and stops at the next section, so ' +
                   'no later sentence becomes an address or a relationship; a relationship written onto a name is cut ' +
                   'off it; a bare relationship names nobody; a first name alone is keyed to its client',
              runOn.people.map(function (p) { return p.role + ':' + p.name + ':' + p.address; }).join('|') ===
                'Family:Frank9:12 Elm St|Friend:Fran9 Friend:1 Main St' && famPlanTie_(runOn.people[1]) === null &&
              famName_('Jennifer9 Waters/Sister') === 'Jennifer9 Waters' && famName_('Ann9 Lee- Sister in Law') === 'Ann9 Lee' &&
              famName_('Mary9 Smith-Jones') === 'Mary9 Smith-Jones' && famRelation_('Ann9 Lee- Sister in Law') === 'Sister in law' &&
              famPlanKey_('Mom', 'x9') === '' && famPlanKey_('Frank9', 'richard9clark') === 'fam_frank9richard9clark' &&
              famPlanKey_('Tom9 Test', 'x9') === 'fam_tom9test',
              JSON.stringify(runOn.people));

    // ---- the roster ----
    derivedCalls = 0;
    var rs = seen('roster', HUB_ACTIONS.familyProfileRoster({}, master));
    var rk = {};
    ((rs.data || {}).families || []).forEach(function (x) { rk[x.key] = x; });
    var pat = rk[PAT] || {};
    stAssert_(out, P + 'roster: one family member per folded name across the active clients, the plans, the directory and ' +
                   'the archive, sorted by name; the plan\'s "Patricia9 Foster" is the record\'s "Pat9 Foster"; never ' +
                   'a state-appointed guardian, "Self", an organisation, a case manager, a doctor or a friend; a ' +
                   'directory guardian only where the record agrees or names nobody; inactive when only old clients remain',
              rs.status === 200 && rs.data.families.map(function (x) { return x.key; }).join() ===
                'fam_becky9barnes,' + PAT + ',fam_rex9retired,fam_tami9gardner,fam_tom9test' &&
              pat.name === 'Pat9 Foster' && pat.clients === 3 && pat.status === 'active' && pat.relationship === 'Mom' &&
              pat.phone === '(330) 555-0171' && pat.email === 'pat9@example.org' && pat.avatar === 'https://img/pat.png' &&
              rk.fam_becky9barnes.relationship === 'Guardian' && rk.fam_becky9barnes.email === 'becky9@example.org' &&
              rk.fam_tami9gardner.relationship === 'Guardian' && rk.fam_tom9test.relationship === 'Brother' &&
              rk.fam_tom9test.phone === '(330) 555-0199' && rk.fam_rex9retired.status === 'inactive' &&
              rk.fam_rex9retired.relationship === 'Father' && rk.fam_rex9retired.avatar === 'https://img/rex.png' &&
              JSON.stringify(rs).indexOf('3305550999') === -1 && JSON.stringify(rs).indexOf('Someone9') === -1 &&
              derivedCalls === 1, JSON.stringify(rs));
    var friend = HUB_ACTIONS.familyProfileOverview({ family: 'fam_gus9buddy' }, master);
    var lawyer = HUB_ACTIONS.familyProfileOverview({ family: 'fam_al9lawyer' }, master);
    stAssert_(out, P + 'roster: a guardian the client record calls a friend, or the Asa Client Database an attorney, is ' +
                   'never listed as family, and their key is not on file',
              !rk.fam_gus9buddy && !rk.fam_al9lawyer && JSON.stringify(rs).indexOf('Gus9') === -1 &&
              JSON.stringify(rs).indexOf('Al9') === -1 && friend.status === 400 && lawyer.status === 400,
              JSON.stringify([friend, lawyer]));

    // ---- the lookup ----
    var none = HUB_ACTIONS.familyProfileOverview({ family: 'fam_nobody9' }, master);
    var junk = HUB_ACTIONS.familyProfileOverview({ family: 'a b' }, master);
    var blank = HUB_ACTIONS.familyProfileActivity({}, master);
    var appointed = HUB_ACTIONS.familyProfileOverview({ family: 'fam_denise9hollen' }, master);
    var alias = HUB_ACTIONS.familyProfileOverview({ family: 'fam_patricia9foster' }, master);
    stAssert_(out, P + 'an unknown, a malformed, a missing or an appointed guardian\'s key is 400 "No family member … is ' +
                   'on file."; the plan\'s spelling of a merged person answers as the record\'s key',
              none.status === 400 && none.message === 'No family member "fam_nobody9" is on file.' && junk.status === 400 &&
              blank.status === 400 && blank.message === 'No family member "" is on file.' && appointed.status === 400 &&
              alias.status === 200 && alias.data.family.key === PAT,
              JSON.stringify([none, junk, blank, appointed, alias.status]));

    // ---- overview ----
    var ov = seen('overview', HUB_ACTIONS.familyProfileOverview({ family: PAT }, master));
    var ovc = (ov.data && ov.data.clients) || [];
    stAssert_(out, P + 'overview: the details with each relationship the records write, the sources, and every client ' +
                   'they are family of — the active ones by name, then the archived — with the registry\'s house label; ' +
                   'identity only',
              ov.status === 200 && ov.data.family.key === PAT && ov.data.family.relationships.join() === 'Mom,Mother' &&
              ov.data.family.address === '12 Oak St, Canton' && ov.data.family.person_id === 'PPL_guardian_pat9foster' &&
              ov.data.family.sources.join() === 'Client record,ISP important people,People directory' &&
              ovc.map(function (c) { return c.client_key + ':' + c.relationship + ':' + c.status; }).join() ===
                'kay9test:Mom:active,lee9other:Mother:active,old9gone:Mom:inactive' &&
              ovc[0].house_label === 'ZZ - Test House' && ovc[1].house_label === 'QQ1000' && ovc[0].avatar === 'https://img/kay.png' &&
              Object.keys(ovc[0]).sort().join() === 'avatar,client_key,house,house_label,name,relationship,status' &&
              Array.isArray(ov.data.why) && ov.data.why.length === 0 && JSON.stringify(ov).indexOf('secret pill') === -1 &&
              JSON.stringify(ov).indexOf('dx words') === -1, JSON.stringify(ov));

    // ---- documents ----
    var dc = seen('documents', HUB_ACTIONS.familyProfileDocuments({ family: PAT }, master));
    var dd = (dc.data && dc.data.docs) || [];
    stAssert_(out, P + 'documents: the guardianship papers the record links, each client\'s plan (the archived one\'s too), ' +
                   'the plan files the Clients door lists and the guardianship papers among the client files, newest ' +
                   'first; never a letter or receipt that names them, a consent, a prior authorization, a benefit letter, ' +
                   'a medical or identity paper, or another family\'s client\'s file',
              dc.status === 200 && dd.map(function (d) { return d.file_id; }).join() ===
                'BspFile12345678,GuardLetters123,KayIspFile12345,ProbateEntry123,OldIspFile12345,PapersFile12345' &&
              dd[2].kind === 'isp' && dd[2].client_key === 'kay9test' && dd[2].date === '2026-01-05' &&
              dd[2].mime === 'application/pdf' && dd[4].date === '2024-03-04' && dd[5].kind === 'guardianship' &&
              dd[0].kind === 'client_doc' && dd[3].client_key === 'lee9other' && dc.data.why.length === 0,
              JSON.stringify(dc));
    var bytesAsked = [];
    locationsDocBytes_ = function (id) {
      bytesAsked.push(id);
      return { name: 'plan.pdf', mime: 'application/pdf', size: 3, exported: false, b64: 'QUJD' };
    };
    var f1 = HUB_ACTIONS.familyProfileDocFile({ family: PAT, file_id: 'KayIspFile12345' }, master);
    var f2 = HUB_ACTIONS.familyProfileDocFile({ family: PAT, file_id: 'NiaConsent12345' }, master);
    var f3 = HUB_ACTIONS.familyProfileDocFile({ family: PAT, file_id: 'KaySsnFile12345' }, master);
    var f4 = HUB_ACTIONS.familyProfileDocFile({ family: PAT, file_id: 'bad id' }, master);
    var f5 = HUB_ACTIONS.familyProfileDocFile({ family: 'fam_nobody9', file_id: 'KayIspFile12345' }, master);
    var f6 = HUB_ACTIONS.familyProfileDocFile({ family: PAT, file_id: 'BspFile12345678' }, master);
    var refusedDocs = ['Pat9Letter12345', 'MediaConsent123', 'MedConsent12345', 'PriorAuth123456', 'PatReceipt12345',
                       'JfsLetter123456', 'SelfAdmin123456', 'DentistFile1234'].map(function (id) {
      return id + ':' + HUB_ACTIONS.familyProfileDocFile({ family: PAT, file_id: id }, master).status;
    });
    stAssert_(out, P + 'document door: a file the family member\'s own list names opens as bytes in ' +
                   'clientProfileDocFile\'s shape; another family\'s client\'s file, an identity paper, a letter or ' +
                   'receipt naming them, a medical consent, a prior authorization, a JFS benefit letter and a medical ' +
                   'paper labelled a plan are 404, a malformed id and an unknown family member 400, all before Drive is asked',
              f1.status === 200 && f1.data.id === 'KayIspFile12345' && f1.data.b64 === 'QUJD' &&
              Object.keys(f1.data).sort().join() === 'b64,exported,id,mime,name,size' && f2.status === 404 &&
              f3.status === 404 && f4.status === 400 && f5.status === 400 && f6.status === 200 &&
              refusedDocs.every(function (s) { return /:404$/.test(s); }) &&
              bytesAsked.join() === 'KayIspFile12345,BspFile12345678',
              JSON.stringify([f1.status, f2, f3, f4, f5, f6.status, refusedDocs, bytesAsked]));
    ispDocIndex_ = function () { return {}; };
    var dcShut = HUB_ACTIONS.familyProfileDocuments({ family: PAT }, master);
    ispDocIndex_ = function () { return { files: [], index: {} }; };
    stAssert_(out, P + 'documents: an unreadable plans folder is said in why and the answer is degraded, never an empty ' +
                   'list passed off as no plans',
              dcShut.status === 200 && dcShut.data.degraded === true &&
              dcShut.data.why.some(function (w) { return /plans folder could not be read/.test(w); }) &&
              dcShut.data.docs.every(function (d) { return d.kind !== 'isp'; }), JSON.stringify(dcShut));

    // ---- activity ----
    tabs.quo_messages = stSpSheet_([
      ['message_id', 'message_created', 'direction', 'from_number', 'to_number', 'body', 'quo_number'],
      ['m1', '2026-09-01T12:00:00Z', 'incoming', '+13305550171', '+13309197595', 'Kay9 had a good week?', 'PNaaaa0001'],
      ['m2', '2026-09-02T12:00:00Z', 'outgoing', '+13309197595', '+13305550171', 'Yes, ref 987654323', 'PNaaaa0001'],
      ['m3', '2026-09-03T12:00:00Z', 'incoming', '+12165550000', '+13309197595', 'stranger text', 'PNaaaa0001'],
      ['m4', '2025-01-01T12:00:00Z', 'incoming', '+13305550171', '+13309197595', 'too old text', 'PNaaaa0001']
    ]);
    var hot = stSpSheet_([
      ['Call ID', 'Transcript Created', 'Event Timestamp', 'Duration (sec)', 'Quo Number', 'Participant(s)', 'Team Member(s)',
       'Direction', '# Turns', 'Full Transcript', 'Speaker Transcript'],
      ['AC1', '2026-09-04T10:00:00Z', '2026-09-04T10:00:00Z', 120, 'PNx', '+13305550171', '+13309197595', 'incoming', 8,
       'SECRET WORDS', 'A: SECRET WORDS'],
      ['AC2', '2026-09-05T10:00:00Z', '2026-09-05T10:00:00Z', 60, 'PNx', '+12165550000', '+13309197595', 'incoming', 4,
       'other words', '']
    ]);
    hubId_ = function (k) { return k === 'HOTLINE_TRANSCRIPTS_ID' ? 'st-hot-book' : ''; };
    ssOpen_ = function (id) {
      if (id !== 'st-hot-book') throw new Error('st: no book');
      return { getSheetByName: function (n) { return n === HOTLINE_TRANSCRIPTS_TAB ? hot : null; } };
    };
    var ac = seen('activity', HUB_ACTIONS.familyProfileActivity({ family: PAT }, master));
    var items = (ac.data && ac.data.items) || [];
    var acText = JSON.stringify(ac);
    var byId = {};
    items.forEach(function (i) { byId[i.id] = i; });
    stAssert_(out, P + 'activity: the FAMILY shifts at their clients\' houses as runs of days, the master\'s own scheduled ' +
                   'call cards, the calls and texts on the company lines with their own phone, the incidents that name ' +
                   'them and the plan naming them, newest first; a stranger, a text older than a year, a call\'s words, a ' +
                   'forged or unmarked card, another client\'s incident and a nine-digit run never appear',
              ac.status === 200 && items.map(function (i) { return i.kind + ':' + i.id; }).join() ===
                'calendar:cal_ZZ9999_2026-10-01,scheduled_call:task_T1,calendar:cal_ZZ9999_2026-09-10,' +
                'calendar:cal_QQ1000_2026-09-05,call:call_AC1,calendar:cal_ZZ9999_2026-09-01,sms:sms_m2,sms:sms_m1,' +
                'incident:inc_INC1,isp:isp_kay9test' &&
              byId['cal_ZZ9999_2026-09-01'].at === '2026-09-03' &&
              byId['cal_ZZ9999_2026-09-01'].body === 'ZZ - Test House · Sep 1, 2026 – Sep 3, 2026 · 3 shifts · 16:30–07:00' &&
              byId['cal_ZZ9999_2026-09-01'].title === 'Family coverage shifts' &&
              byId['cal_ZZ9999_2026-09-01'].client_key === 'kay9test' &&
              byId['cal_QQ1000_2026-09-05'].title === 'Family coverage shift' &&
              byId['cal_QQ1000_2026-09-05'].body === 'QQ1000 · Sep 5, 2026' &&
              byId.task_T1.title === 'Call scheduled — Kay9 Test' &&
              byId.task_T1.body === 'Due Sep 25, 2026 · High priority · This week' &&
              byId.sms_m1.by === 'Pat9 Foster' && byId.sms_m1.title === 'Text from Pat9 Foster · HR line' &&
              byId.sms_m2.by === 'Hera Owner' && byId.call_AC1.body === '+13309197595 · 2 min' &&
              byId.inc_INC1.title === 'Incident — Kay9 Test · Fall' && byId.inc_INC1.client_key === 'kay9test' &&
              byId.isp_kay9test.title === 'Named in Kay9 Test\'s ISP' && byId.isp_kay9test.at === '2026-01-05' &&
              ac.data.phones_matched === 1 && acText.indexOf('stranger') === -1 && acText.indexOf('too old') === -1 &&
              acText.indexOf('2165550000') === -1 && acText.indexOf('SECRET') === -1 && acText.indexOf('Forged') === -1 &&
              acText.indexOf('INC2') === -1 && acText.indexOf('INC3') === -1 && acText.indexOf('INC4') === -1 &&
              acText.indexOf('INC5') === -1 && acText.indexOf('987654323') === -1 &&
              !hot.readCols[10] && !hot.readCols[11], acText.slice(0, 2400));
    stAssert_(out, P + 'activity: a FAMILY cell at a house where several family members have clients is listed for each ' +
                   'of them and why says so; a house with one family member says nothing',
              ac.data.why.length === 1 &&
              /house calendar at ZZ - Test House writes FAMILY without a name, and 3 family members/.test(ac.data.why[0]),
              JSON.stringify(ac.data.why));
    var tami = HUB_ACTIONS.familyProfileActivity({ family: 'fam_tami9gardner' }, master);
    var shared = famOwnPhones_({ key: 'fam_a', family: { phones: ['3305550888', '3309197595'] },
                                 index: { phones: { '3305550888': { fam_a: true, fam_b: true }, '3309197595': { fam_a: true } } } });
    stAssert_(out, P + 'activity: a family member alone at a house gets its FAMILY shift with no why; a phone another ' +
                   'family member or a company line carries is not attributed',
              tami.status === 200 && tami.data.items.map(function (i) { return i.id; }).join() === 'cal_RR2000_2026-09-12' &&
              tami.data.items[0].body === 'RR2000 · Sep 12, 2026 · 08:00–20:00' && tami.data.why.length === 0 &&
              shared.shared === 2 && Object.keys(shared.mine).length === 0, JSON.stringify([tami, shared]));
    hubId_ = function () { return ''; };
    locationsCalendar_ = function () { return { cal: null, why: 'the Calendar Archive could not be read (st: closed)' }; };
    userByEmail_ = function () { return null; };
    var acShut = HUB_ACTIONS.familyProfileActivity({ family: PAT }, master);
    locationsCalendar_ = function () { calReads++; return { cal: { values: calValues, tz: 'America/New_York' }, why: '' }; };
    userByEmail_ = function (e) { return String(e) === HUB_MASTER_ACCOUNT ? { id: 'u-master', email: e } : null; };
    hubId_ = function (k) { return k === 'HOTLINE_TRANSCRIPTS_ID' ? 'st-hot-book' : ''; };
    stAssert_(out, P + 'activity: an unopenable hotline book, an unreadable Calendar Archive and a master account that ' +
                   'cannot be found are each said in why and the answer is degraded, the texts still listed',
              acShut.status === 200 && acShut.data.degraded === true &&
              acShut.data.why.some(function (w) { return /hotline transcripts book could not be opened/.test(w); }) &&
              acShut.data.why.some(function (w) { return /Calendar Archive could not be read .*no FAMILY shift is listed/.test(w); }) &&
              acShut.data.why.some(function (w) { return /scheduled calls could not be read/.test(w); }) &&
              acShut.data.items.some(function (i) { return i.kind === 'sms'; }) &&
              acShut.data.items.every(function (i) { return i.kind !== 'calendar' && i.kind !== 'scheduled_call'; }),
              JSON.stringify(acShut.data.why));

    // ---- a source that cannot be read ----
    cpMasterIndex_ = function () { throw new Error('st: master closed'); };
    var rsDeg = HUB_ACTIONS.familyProfileRoster({}, master);
    var noneDeg = HUB_ACTIONS.familyProfileOverview({ family: 'fam_nobody9' }, master);
    cpMasterIndex_ = function () { return cpBookIndexFrom_(masterValues, 'America/New_York'); };
    clientsDerived_ = function () { throw new Error('st: clients closed'); };
    cpArchiveIndex_ = function () { throw new Error('st: archive closed'); };
    var rsDown = HUB_ACTIONS.familyProfileRoster({}, master);
    var ovDown = HUB_ACTIONS.familyProfileOverview({ family: PAT }, master);
    clientsDerived_ = function () { derivedCalls++; return derived.slice(); };
    cpArchiveIndex_ = function () { return cpBookIndexFrom_(archValues, 'America/New_York'); };
    stAssert_(out, P + 'an unreadable Master is one why sentence and a degraded answer; a key it alone might name is 503, ' +
                   'never "not on file"; with neither the clients nor the archive readable the list and the lookup are 503',
              rsDeg.status === 200 && rsDeg.data.degraded === true &&
              rsDeg.data.why.join(' ') === 'The Asa Client Database could not be read (st: master closed).' &&
              noneDeg.status === 503 && rsDown.status === 503 && ovDown.status === 503,
              JSON.stringify([rsDeg.data.why, noneDeg, rsDown, ovDown]));

    // ---- the relay's pack ----
    derivedCalls = 0;
    var memoSeen = [];
    clientsDerived_ = function (u) { derivedCalls++; memoSeen.push(!u && !!CLIENTS_DERIVED_MEMO_); return derived.slice(); };
    var pack = seen('pack', HUB_ACTIONS.familyPack({ family: PAT }, serviceUser_()));
    var pp = (pack.data && pack.data.parts) || {};
    var ps = (pack.data && pack.data.part_status) || {};
    var packReads = derivedCalls;
    clientsDerived_ = function () { derivedCalls++; return derived.slice(); };
    var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
    var parity = {
      overview: same(pp.overview, HUB_ACTIONS.familyProfileOverview({ family: PAT }, master).data),
      documents: same(pp.documents, HUB_ACTIONS.familyProfileDocuments({ family: PAT }, master).data),
      activity: same(pp.activity, HUB_ACTIONS.familyProfileActivity({ family: PAT }, master).data),
      notes: same(pp.notes, HUB_ACTIONS.familyProfileNotes({ family: PAT }, master).data)
    };
    stAssert_(out, P + 'pack: the service reads all four parts in one execution, each exactly its own action\'s answer, ' +
                   'the client records read once for all of them, and both memos dropped after',
              pack.status === 200 && pack.data.family === PAT && !!pack.data.built_at &&
              FAM_PACK_PARTS.every(function (n) { return ps[n] && ps[n].status === 200 && pp[n] !== undefined; }) &&
              Object.keys(parity).every(function (k) { return parity[k]; }) && packReads === 1 &&
              memoSeen.every(Boolean) && CLIENTS_DERIVED_MEMO_ === null && FAM_INDEX_MEMO_ === null,
              JSON.stringify([pack.status, ps, parity, packReads, memoSeen]));
    famActivityDoor_ = function () { throw new Error('st: activity closed'); };
    var broken = HUB_ACTIONS.familyPack({ family: PAT }, serviceUser_());
    famActivityDoor_ = keep.activityDoor;
    FAM_PACK_BUDGET_MS = -1;
    var late = HUB_ACTIONS.familyPack({ family: PAT }, serviceUser_());
    FAM_PACK_BUDGET_MS = keep.budget;
    var pNone = HUB_ACTIONS.familyPack({ family: 'fam_nobody9' }, serviceUser_());
    var pJunk = HUB_ACTIONS.familyPack({ family: 'a b' }, serviceUser_());
    var bst = (broken.data && broken.data.part_status) || {};
    stAssert_(out, P + 'pack: a part that throws is its own 503 and the others answer; past its budget it starts no part and ' +
                   'says so part by part; an unknown or malformed key is the lookup\'s own 400, never an empty pack',
              broken.status === 200 && bst.activity.status === 503 && /activity closed/.test(bst.activity.message) &&
              !broken.data.parts.activity && ['overview', 'documents', 'notes'].every(function (n) { return bst[n].status === 200; }) &&
              late.status === 200 && Object.keys(late.data.parts).length === 0 &&
              FAM_PACK_PARTS.every(function (n) { return late.data.part_status[n].status === 503; }) &&
              pNone.status === 400 && !pNone.data && pJunk.status === 400 && CLIENTS_DERIVED_MEMO_ === null &&
              FAM_INDEX_MEMO_ === null, JSON.stringify([bst, pNone, pJunk]));

    // ---- notes ----
    var notes = stLocSheet_([]);
    var ensured = [];
    hubTabEnsure_ = function (tab, header) {
      ensured.push(tab);
      if (HUB_TAB_BORN_HOME.indexOf(tab) === -1) throw new Error('st: ' + tab + ' is not born home');
      if (tab !== FAM_NOTES_TAB) throw new Error('st: no other tab');
      if (!notes.grid.length) notes.grid.push(header.slice());
      tabs[FAM_NOTES_TAB] = notes;
      return notes;
    };
    var bumped = [];
    cacheBump_ = function (scope) { bumped.push(scope); };
    var nBefore = HUB_ACTIONS.familyProfileNotes({ family: PAT }, master);
    var nBad = [
      HUB_ACTIONS.familyProfileNoteAdd({ family: PAT, body: '   ' }, master),
      HUB_ACTIONS.familyProfileNoteAdd({ family: PAT, body: new Array(4002).join('y') }, master),
      HUB_ACTIONS.familyProfileNoteAdd({ family: 'fam_nobody9', body: 'x' }, master)
    ].map(function (r) { return r.status; });
    sheetDbGateHolds_ = function () { return { error: { status: 409, message: 'st: held' } }; };
    var nHeld = HUB_ACTIONS.familyProfileNoteAdd({ family: PAT, body: 'x' }, master);
    sheetDbGateHolds_ = function () { return null; };
    stAssert_(out, P + 'notes: a read makes nothing; an empty or over-long body and an unknown family member are 400, the ' +
                   'held funnel 409 — none of them makes the tab or writes a log line',
              nBefore.status === 200 && nBefore.data.notes.length === 0 && nBad.join() === '400,400,400' &&
              nHeld.status === 409 && ensured.length === 0 && notes.grid.length === 0 && logged.length === 0,
              JSON.stringify([nBefore, nBad, nHeld, ensured, logged]));
    var nAdd = HUB_ACTIONS.familyProfileNoteAdd({ family: PAT, body: '=HYPERLINK("http://x") private words', by: 'Mallory',
                                                  id: 'forged', at: '1999-01-01' }, master);
    var nh = notes.grid[0] || [];
    var nr = notes.grid[1] || [];
    var ncol = function (hd) { return nr[nh.indexOf(hd)]; };
    stAssert_(out, P + 'notes: the first write makes the born-home tab through hubTabEnsure_; the filer, time and id are ' +
                   'the server\'s, text is kept from being a formula, the three reads it changes are retired, and the ' +
                   'log names the family key and never the words',
              nAdd.status === 200 && ensured.join() === FAM_NOTES_TAB && nh.join() === FAM_NOTES_HEADER.join() &&
              ncol('family_key') === PAT && ncol('family_name') === 'Pat9 Foster' && ncol('by') === 'The Master' &&
              /^FAMN_/.test(ncol('id')) && ncol('at') !== '1999-01-01' && ncol('body') === '\'=HYPERLINK("http://x") private words' &&
              Object.keys(nAdd.data.note).sort().join() === 'at,body,by,id' &&
              ['familyProfileNotes', 'familyProfileActivity', 'familyProfileOverview'].every(function (a) {
                return bumped.indexOf('fam_' + a + '_' + PAT) !== -1;
              }) && logged.length === 1 && logged[0].indexOf('familyProfileNoteAdd') !== -1 &&
              logged[0].indexOf(PAT) !== -1 && logged[0].indexOf('private words') === -1,
              JSON.stringify([nAdd, notes.grid, bumped, logged]));
    var nAfter = HUB_ACTIONS.familyProfileNotes({ family: PAT }, master);
    var acAfter = HUB_ACTIONS.familyProfileActivity({ family: PAT }, master);
    var otherNotes = HUB_ACTIONS.familyProfileNotes({ family: 'fam_tom9test' }, master);
    stAssert_(out, P + 'notes: the read shows the note to its family member alone, and the activity lists it',
              nAfter.status === 200 && nAfter.data.notes.length === 1 && /private words/.test(nAfter.data.notes[0].body) &&
              otherNotes.data.notes.length === 0 &&
              acAfter.data.items.some(function (i) { return i.kind === 'note' && i.title === 'Admin note'; }),
              JSON.stringify([nAfter, otherNotes, acAfter.data.items.slice(0, 2)]));

    // ---- the relay's index of the whole app ----
    var ipol = HUB_POLICY.familyIndexPack || {};
    var indexShut = [{ email: 'admin@example.org', role: 'admin' }, { email: HUB_MASTER_ACCOUNT, role: 'admin',
                     visiting_member: 'mem_1' }, master, null].map(function (u) { return HUB_ACTIONS.familyIndexPack({}, u); });
    stAssert_(out, P + 'index: declared in FamilyProfiles.gs as an idempotent admin read taking no parameter, a service read, ' +
                   'no section door, and every session — the master\'s own included — gets the exact 404 shape',
              ipol.file === 'FamilyProfiles.gs' && ipol.lane === 'read' && ipol.idempotent === true &&
              JSON.stringify(ipol.roles) === '["admin"]' && Object.keys(ipol.params || {}).length === 0 &&
              SERVICE_READ_ACTIONS.indexOf('familyIndexPack') !== -1 && FAM_ACTIONS.indexOf('familyIndexPack') === -1 &&
              FAM_INDEX_PARTS.join() === 'roster,aliases,overviews,notes' && indexShut.every(shape) &&
              /^function\s*\(payload, user\)\s*\{\s*if \(!user \|\| !user\.is_service\) return familyProfilesUnknown_\(\);/
                .test(stCode_(HUB_ACTIONS.familyIndexPack)), JSON.stringify([ipol, indexShut]));
    derivedCalls = 0;
    memoSeen = [];
    clientsDerived_ = function (u) { derivedCalls++; memoSeen.push(!u && !!CLIENTS_DERIVED_MEMO_); return derived.slice(); };
    var notesReads = 0;
    hubTabSheet_ = function (t) { if (t === FAM_NOTES_TAB) notesReads++; return tabs[t] || null; };
    var ix = seen('index', HUB_ACTIONS.familyIndexPack({}, serviceUser_()));
    var ixReads = derivedCalls;
    hubTabSheet_ = function (t) { return tabs[t] || null; };
    clientsDerived_ = function () { derivedCalls++; return derived.slice(); };
    var ixp = (ix.data && ix.data.parts) || {};
    var ixs = (ix.data && ix.data.part_status) || {};
    var ixKeys = ((ixp.roster || {}).families || []).map(function (x) { return x.key; });
    var ixRoster = HUB_ACTIONS.familyProfileRoster({}, master).data;
    var ixOdd = ixKeys.filter(function (k) {
      return JSON.stringify(ixp.overviews[k]) !== JSON.stringify(HUB_ACTIONS.familyProfileOverview({ family: k }, master).data) ||
             JSON.stringify(ixp.notes[k]) !== JSON.stringify(HUB_ACTIONS.familyProfileNotes({ family: k }, master).data);
    });
    var ixAliases = Object.keys(ixp.aliases || {}).filter(function (a) {
      return ixp.aliases[a] !== HUB_ACTIONS.familyProfileOverview({ family: a }, master).data.family.key;
    });
    stAssert_(out, P + 'index: the service reads the roster and every family member\'s overview and admin notes in one ' +
                   'execution, each exactly its own door\'s answer to the master, with the keys one person answers to under ' +
                   'another spelling; the client records and the notes tab read once, and both memos dropped after',
              ix.status === 200 && !!ix.data.built_at &&
              FAM_INDEX_PARTS.every(function (n) { return ixs[n] && ixs[n].status === 200 && ixp[n] !== undefined; }) &&
              JSON.stringify(ixp.roster.families) === JSON.stringify(ixRoster.families) &&
              JSON.stringify(ixp.roster.why) === JSON.stringify(ixRoster.why) && ixKeys.length >= 4 &&
              ixKeys.indexOf(PAT) !== -1 && Object.keys(ixp.overviews).length === ixKeys.length && ixOdd.length === 0 &&
              ixp.notes[PAT].notes.length === 1 && Object.keys(ixp.aliases).length >= 1 && ixAliases.length === 0 &&
              ixReads === 1 && notesReads === 1 && memoSeen.every(Boolean) && CLIENTS_DERIVED_MEMO_ === null &&
              FAM_INDEX_MEMO_ === null, JSON.stringify([ix.status, ixs, ixOdd, ixAliases, ixReads, notesReads, memoSeen]));
    hubTabSheet_ = function (t) { if (t === FAM_NOTES_TAB) throw new Error('st: notes closed'); return tabs[t] || null; };
    var ixNoNotes = HUB_ACTIONS.familyIndexPack({}, serviceUser_());
    hubTabSheet_ = function (t) { return tabs[t] || null; };
    FAM_PACK_BUDGET_MS = -1;
    var ixLate = HUB_ACTIONS.familyIndexPack({}, serviceUser_());
    FAM_PACK_BUDGET_MS = keep.budget;
    clientsDerived_ = function () { throw new Error('st: clients closed'); };
    cpArchiveIndex_ = function () { throw new Error('st: archive closed'); };
    var ixDown = HUB_ACTIONS.familyIndexPack({}, serviceUser_());
    clientsDerived_ = function () { derivedCalls++; return derived.slice(); };
    cpArchiveIndex_ = function () { return cpBookIndexFrom_(archValues, 'America/New_York'); };
    var nn = (ixNoNotes.data || {}).part_status || {}, nl = (ixLate.data || {}).part_status || {};
    var nd = (ixDown.data || {}).part_status || {};
    stAssert_(out, P + 'index: an unreadable notes tab is its own 503 and the roster and overviews still answer; past its ' +
                   'budget it gathers no family member and says how many are left, the roster still whole; with the ' +
                   'records unreadable every part is a 503 and nothing is passed off as an empty app',
              ixNoNotes.status === 200 && nn.notes.status === 503 && /notes closed/.test(nn.notes.message) &&
              !ixNoNotes.data.parts.notes && nn.roster.status === 200 && nn.overviews.status === 200 &&
              ixLate.status === 200 && Object.keys(ixLate.data.parts.overviews).length === 0 &&
              nl.overviews.missing === ixKeys.length && /not gathered/.test(nl.overviews.message) &&
              ixLate.data.parts.roster.families.length === ixKeys.length &&
              ixDown.status === 200 && FAM_INDEX_PARTS.every(function (n) { return nd[n] && nd[n].status === 503; }) &&
              Object.keys(ixDown.data.parts).length === 0 && CLIENTS_DERIVED_MEMO_ === null && FAM_INDEX_MEMO_ === null,
              JSON.stringify([nn, nl, nd]));

    // ---- a released viewer ----
    var viewer = { id: 'u-viewer', email: 'viewer@example.org', role: 'staff', display_name: 'Vi9 Ewer' };
    var scopeOf = function (kind, clients, families, why) {
      return { kind: kind, client_keys: clients || [], house_codes: [], ssa_keys: [], family_keys: families || [],
               why: why || '' };
    };
    var as = function (scope, action, payload) {
      gateScope = scope;
      try { return HUB_ACTIONS[action](payload || {}, viewer); } finally { gateScope = null; }
    };
    var ids = function (r, list, field) {
      return (((r && r.data) || {})[list] || []).map(function (x) { return x[field || 'key']; }).join();
    };
    var shut = shape;
    var writes = function (scope) {
      return [as(scope, 'familyProfileNoteAdd', { family: PAT, body: 'x' }),
              as(scope, 'familyProfileCallSchedule', { family: PAT, client_key: 'kay9test', date: '2026-09-25' }),
              as(scope, 'familyProfileIncidentTie', { family: PAT, client_key: 'kay9test',
                                                      incident_ts: '2026-08-25T10:00:00.000Z' })];
    };
    var gridAt = notes.grid.length, tasksAt = tables.tasks.length, logAt = logged.length;
    var named = { known: false, name: '', self: false };
    hubViewerNamed_ = function () { return JSON.parse(JSON.stringify(named)); };

    var unreleased = FAM_ACTIONS.filter(function (a) { return !shut(as(null, a, probe)); });
    stAssert_(out, P + 'viewer: a STAFF account on an app App Control has not released to it gets the exact 404 shape on ' +
                   'every read and write',
              unreleased.length === 0, unreleased.join(' | '));

    var mRoster = HUB_ACTIONS.familyProfileRoster({}, master);
    var ALL = scopeOf('all');
    var sRoster = as(ALL, 'familyProfileRoster');
    var sameAs = function (action, payload) {
      return JSON.stringify(as(ALL, action, payload)) === JSON.stringify(HUB_ACTIONS[action](payload, master));
    };
    var staffSame = ['familyProfileOverview', 'familyProfileDocuments', 'familyProfileActivity', 'familyProfileNotes']
      .filter(function (a) { return !sameAs(a, { family: PAT }); });
    var staffFile = as(ALL, 'familyProfileDocFile', { family: PAT, file_id: 'ProbateEntry123' });
    var staffWrites = writes(ALL);
    stAssert_(out, P + 'viewer: a released STAFF account sees everything the master sees — the roster, every section and ' +
                   'every document — and is told its view (all, notes open); every write is still the master\'s 404 ' +
                   'and writes nothing',
              sRoster.status === 200 && JSON.stringify(sRoster.data.families) === JSON.stringify(mRoster.data.families) &&
              JSON.stringify(sRoster.data.view) === '{"kind":"all","notes":true}' &&
              mRoster.data.view.kind === 'master' && mRoster.data.view.notes === true && staffSame.length === 0 &&
              staffFile.status === 200 && staffWrites.every(shut) && notes.grid.length === gridAt &&
              tables.tasks.length === tasksAt && logged.length === logAt,
              JSON.stringify([sRoster.data && sRoster.data.view, staffSame, staffFile.status, staffWrites]));

    var KAY = scopeOf('client', ['kay9test']);
    var cRoster = as(KAY, 'familyProfileRoster');
    var cPat = ((cRoster.data || {}).families || [])[0] || {};
    var cOv = seen('client overview', as(KAY, 'familyProfileOverview', { family: PAT }));
    var cDocs = seen('client documents', as(KAY, 'familyProfileDocuments', { family: PAT }));
    var cAct = seen('client activity', as(KAY, 'familyProfileActivity', { family: PAT }));
    var cText = JSON.stringify([cRoster, cOv, cDocs, cAct]);
    stAssert_(out, P + 'viewer: a client sees only the family members of their own record, each drawn from that record ' +
                   'alone — the relationship to them, one client, their own documents, and of the activity only the plan ' +
                   'naming them, the FAMILY shifts at their own house and their own incidents; never another client, a ' +
                   'text, a call, a scheduled call or an admin note',
              cRoster.status === 200 && ids(cRoster, 'families') === PAT + ',fam_tom9test' &&
              JSON.stringify(cRoster.data.view) === '{"kind":"client","notes":false}' &&
              cPat.clients === 1 && cPat.relationship === 'Mom' && cPat.status === 'active' &&
              cOv.status === 200 && ids(cOv, 'clients', 'client_key') === 'kay9test' &&
              cOv.data.family.relationships.join() === 'Mom' && cOv.data.family.person_id === '' &&
              cDocs.status === 200 &&
              ids(cDocs, 'docs', 'file_id') === 'BspFile12345678,GuardLetters123,KayIspFile12345,PapersFile12345' &&
              cAct.status === 200 && ids(cAct, 'items', 'id') ===
                'cal_ZZ9999_2026-10-01,cal_ZZ9999_2026-09-10,cal_ZZ9999_2026-09-01,inc_INC1,isp_kay9test' &&
              cAct.data.total === 5 && cAct.data.phones_matched === 0 &&
              ['Lee9', 'Old9', 'lee9other', 'QQ1000', 'private words', 'good week', 'task_T1', 'call_AC1']
                .every(function (w) { return cText.indexOf(w) === -1; }),
              cText.slice(0, 2400));
    var cShut = [as(KAY, 'familyProfileNotes', { family: PAT }),
                 as(KAY, 'familyProfileOverview', { family: 'fam_tami9gardner' }),
                 as(KAY, 'familyProfileActivity', { family: 'fam_rex9retired' }),
                 as(KAY, 'familyProfileOverview', { family: 'fam_nobody9' }),
                 as(KAY, 'familyProfileDocuments', { family: 'a b' }),
                 as(KAY, 'familyProfileDocFile', { family: PAT, file_id: 'ProbateEntry123' }),
                 as(KAY, 'familyProfileDocFile', { family: 'fam_tami9gardner', file_id: 'KayIspFile12345' })];
    var cFile = as(KAY, 'familyProfileDocFile', { family: PAT, file_id: 'KayIspFile12345' });
    var cWrites = writes(KAY);
    stAssert_(out, P + 'viewer: to a client the admin notes, a family member of another client, an unknown or malformed ' +
                   'key and any key outside their own are the exact 404 shape, never "not on file"; a document of ' +
                   'another client is refused, their own opens; every write is 404 and writes nothing',
              cShut.slice(0, 5).every(shut) && cShut[5].status === 404 &&
              cShut[5].message === 'This family member names no such document.' && shut(cShut[6]) &&
              cFile.status === 200 && cFile.data.id === 'KayIspFile12345' && cWrites.every(shut) &&
              notes.grid.length === gridAt && tables.tasks.length === tasksAt && logged.length === logAt,
              JSON.stringify([cShut, cFile.status, cWrites]));

    named = { known: true, name: 'Pat9 Foster/Mom', self: false };
    var FAMILY = scopeOf('guardian', ['kay9test'], []);
    var gRoster = as(FAMILY, 'familyProfileRoster');
    var gOv = as(FAMILY, 'familyProfileOverview', { family: PAT });
    var gShut = [as(FAMILY, 'familyProfileOverview', { family: 'fam_tom9test' }),
                 as(FAMILY, 'familyProfileNotes', { family: PAT })];
    var theirFold = hubViewerFamilyKey_('Pat9 Foster/Mom');
    stAssert_(out, P + 'viewer: a family member sees only their own record — the one their ward\'s record names, found ' +
                   'under the name the account carries as Families folds it ("Pat9 Foster/Mom" is Pat9 Foster) though ' +
                   'the viewer scope\'s own fold named no record — drawn from their ward alone; another family member ' +
                   'of the ward and the admin notes are 404',
              theirFold !== PAT && gRoster.status === 200 && ids(gRoster, 'families') === PAT &&
              JSON.stringify(gRoster.data.view) === '{"kind":"guardian","notes":false}' &&
              gOv.status === 200 && ids(gOv, 'clients', 'client_key') === 'kay9test' && gShut.every(shut),
              JSON.stringify([theirFold, gRoster, gOv.status, gShut]));
    named = { known: true, name: 'Pat9 Foster', self: true };
    var gSelf = as(scopeOf('guardian', ['kay9test'], [], 'st: no family record is its own'), 'familyProfileRoster');
    named = { known: true, name: 'Tom9 Test', self: false };
    var gOther = as(FAMILY, 'familyProfileRoster');
    named = { known: false, name: '', self: false };
    var gScoped = as(scopeOf('guardian', ['kay9test'], ['fam_patricia9foster']), 'familyProfileRoster');
    var gForeign = as(scopeOf('guardian', ['kay9test'], ['fam_tami9gardner']), 'familyProfileRoster');
    stAssert_(out, P + 'viewer: a name the account chose itself, or the name of a family member the ward\'s record does ' +
                   'not name as guardian, opens no record and the switcher says why; a record the viewer scope names ' +
                   'opens under its canonical key, and one not tied to the ward never',
              gSelf.status === 200 && gSelf.data.families.length === 0 &&
              gSelf.data.why.indexOf('st: no family record is its own') !== -1 &&
              gOther.status === 200 && gOther.data.families.length === 0 &&
              ids(gScoped, 'families') === PAT && gForeign.status === 200 && gForeign.data.families.length === 0,
              JSON.stringify([gSelf, gOther, gScoped, gForeign]));

    var SSA1 = scopeOf('ssa', ['kay9test']);
    var aRoster = as(SSA1, 'familyProfileRoster');
    var aAct = seen('ssa activity', as(SSA1, 'familyProfileActivity', { family: PAT }));
    var SSA3 = scopeOf('ssa', ['kay9test', 'lee9other', 'old9gone']);
    var wAct = as(SSA3, 'familyProfileActivity', { family: PAT });
    var mAct = HUB_ACTIONS.familyProfileActivity({ family: PAT }, master);
    var mNoNotes = mAct.data.items.filter(function (i) { return i.kind !== 'note'; }).map(function (i) { return i.id; }).join();
    var wDocs = as(SSA3, 'familyProfileDocuments', { family: PAT });
    var aShut = [as(SSA3, 'familyProfileNotes', { family: PAT }), as(SSA1, 'familyProfileOverview', { family: 'fam_tami9gardner' })];
    var aWrites = writes(SSA3);
    stAssert_(out, P + 'viewer: an SSA sees the families of their own clients cut to those clients — the calls scheduled ' +
                   'about them too, the texts and calls only when every client of the family member is theirs — and ' +
                   'never an admin note; a family outside their clients and every write are 404',
              aRoster.status === 200 && ids(aRoster, 'families') === PAT + ',fam_tom9test' &&
              JSON.stringify(aRoster.data.view) === '{"kind":"ssa","notes":false}' &&
              ids(aAct, 'items', 'id') ===
                'cal_ZZ9999_2026-10-01,task_T1,cal_ZZ9999_2026-09-10,cal_ZZ9999_2026-09-01,inc_INC1,isp_kay9test' &&
              wAct.status === 200 && ids(wAct, 'items', 'id') === mNoNotes && wAct.data.phones_matched === 1 &&
              JSON.stringify(wDocs.data.docs) === JSON.stringify(HUB_ACTIONS.familyProfileDocuments({ family: PAT }, master).data.docs) &&
              aShut.every(shut) && aWrites.every(shut) && notes.grid.length === gridAt &&
              tables.tasks.length === tasksAt && logged.length === logAt,
              JSON.stringify([aRoster, ids(aAct, 'items', 'id'), ids(wAct, 'items', 'id'), mNoNotes, aShut, aWrites]));
    hubViewerNamed_ = keep.named;

    // ---- an incident filed from here ----
    logged = [];
    bumped = [];
    var tBad = [
      HUB_ACTIONS.familyProfileIncidentTie({ family: PAT, client_key: 'nia9none', incident_ts: '2026-08-25T10:00:00.000Z' }, master),
      HUB_ACTIONS.familyProfileIncidentTie({ family: PAT, client_key: 'kay9test', incident_ts: 'yesterday' }, master),
      HUB_ACTIONS.familyProfileIncidentTie({ family: PAT, client_key: 'kay9test', incident_ts: '' }, master),
      HUB_ACTIONS.familyProfileIncidentTie({ family: 'fam_nobody9', client_key: 'kay9test',
                                             incident_ts: '2026-08-25T10:00:00.000Z' }, master)
    ].map(function (r) { return r.status; });
    var gridBefore = notes.grid.length;
    var tAdd = HUB_ACTIONS.familyProfileIncidentTie({ family: PAT, client_key: 'kay9test',
                                                      incident_ts: '2026-08-25T10:00:00.000Z', by: 'Mallory' }, master);
    var tAgain = HUB_ACTIONS.familyProfileIncidentTie({ family: PAT, client_key: 'kay9test',
                                                        incident_ts: '2026-08-25T10:00:00.000Z' }, master);
    var tr = notes.grid[gridBefore] || [];
    var tcol = function (hd) { return tr[notes.grid[0].indexOf(hd)]; };
    var acTied = HUB_ACTIONS.familyProfileActivity({ family: PAT }, master);
    var nTied = HUB_ACTIONS.familyProfileNotes({ family: PAT }, master);
    var tiedIds = acTied.data.items.map(function (i) { return i.id; });
    stAssert_(out, P + 'incident: a client not theirs, a timestamp that is not the report\'s and an unknown family member ' +
                   'are 400; an incident filed from here is tied once by its client and report timestamp, the filer the ' +
                   'session\'s, and Activity lists it though its words never name them — never another client\'s report ' +
                   'of the same second — while the notes stay notes',
              tBad.join() === '400,400,400,400' && tAdd.status === 200 && tAdd.data.tie.already === false &&
              tAgain.status === 200 && tAgain.data.tie.already === true && notes.grid.length === gridBefore + 1 &&
              tcol('kind') === 'incident' && tcol('client_key') === 'kay9test' &&
              tcol('incident_ts') === '2026-08-25T10:00:00.000Z' && tcol('by') === 'The Master' && /^FAMI_/.test(tcol('id')) &&
              tiedIds.indexOf('inc_INC4') !== -1 && tiedIds.indexOf('inc_INC5') === -1 &&
              nTied.data.notes.length === 1 && bumped.indexOf('fam_familyProfileActivity_' + PAT) !== -1 &&
              logged.length === 2 && logged[0].indexOf('familyProfileIncidentTie') !== -1,
              JSON.stringify([tBad, tAdd, tAgain, tr, tiedIds, nTied.data.notes.length, logged]));

    // ---- scheduling a call ----
    var routed = [];
    route = function (resource, action, payload, user) {
      routed.push({ resource: resource, action: action });
      var held = hubOwnedGate_(resource, RESOURCES[resource], action, payload, user);
      if (held) return held;
      var row = JSON.parse(JSON.stringify(payload));
      row.id = 'T' + (tables.tasks.length + 1);
      row.createdAt = '2026-09-22T12:00:00Z';
      tables.tasks.push(row);
      return { status: 200, data: row };
    };
    logged = [];
    bumped = [];
    var cBad = [
      HUB_ACTIONS.familyProfileCallSchedule({ family: PAT, client_key: 'nia9none', date: '2026-09-25' }, master),
      HUB_ACTIONS.familyProfileCallSchedule({ family: PAT, client_key: 'kay9test', date: '2026-02-30' }, master),
      HUB_ACTIONS.familyProfileCallSchedule({ family: PAT, client_key: 'kay9test', date: '25/09/2026' }, master),
      HUB_ACTIONS.familyProfileCallSchedule({ family: PAT, client_key: 'kay9test', date: '2026-09-21' }, master),
      HUB_ACTIONS.familyProfileCallSchedule({ family: PAT, client_key: 'kay9test', date: '2026-09-25', priority: 'low' }, master),
      HUB_ACTIONS.familyProfileCallSchedule({ family: PAT, client_key: 'kay9test', date: '2026-09-25',
                                              details: new Array(4002).join('d') }, master),
      HUB_ACTIONS.familyProfileCallSchedule({ family: 'fam_nobody9', client_key: 'kay9test', date: '2026-09-25' }, master)
    ].map(function (r) { return r.status; });
    stAssert_(out, P + 'call: a client not theirs, a day that does not exist or is not yyyy-mm-dd, a day already past, a ' +
                   'priority outside normal/high/urgent, over-long details and an unknown family member are 400 before ' +
                   'the Task Board is asked',
              cBad.join() === '400,400,400,400,400,400,400' && routed.length === 0 && logged.length === 0,
              JSON.stringify([cBad, routed]));
    var cAdd = HUB_ACTIONS.familyProfileCallSchedule({ family: PAT, client_key: 'kay9test', date: '2026-09-25',
                                                       priority: 'High', details: '=Ask about the ISP meeting',
                                                       ownerId: 'u-mallory' }, master);
    var card = tables.tasks[tables.tasks.length - 1];
    stAssert_(out, P + 'call: filed through the Task Board\'s own door as a card on the filer\'s board — the owner seized ' +
                   'from the session, due that day at that priority, this week when within seven days, labelled, ' +
                   'carrying the family and client keys, its text kept from being a formula; the activity is retired ' +
                   'and the log names the family key and never the details',
              cAdd.status === 200 && routed.length === 1 && routed[0].resource === 'tasks' && routed[0].action === 'create' &&
              card.ownerId === 'u-master' && card.title === 'Call Pat9 Foster — Kay9 Test' && card.column === 'this-week' &&
              card.priority === 'high' && card.due === '2026-09-25' && JSON.stringify(card.labels) === '["Family call"]' &&
              card.family_key === PAT && card.client_key === 'kay9test' && card.source === 'families' &&
              card.description.indexOf('\'=Ask about the ISP meeting') === 0 &&
              card.description.indexOf('For: Pat9 Foster (Mom)') !== -1 && card.description.indexOf('Phone: (330) 555-0171') !== -1 &&
              cAdd.data.call.client_name === 'Kay9 Test' && cAdd.data.call.state === 'This week' &&
              cAdd.data.call.board === 'Task Board' && cAdd.data.call.id === card.id &&
              bumped.indexOf('fam_familyProfileActivity_' + PAT) !== -1 && logged.length === 1 &&
              logged[0].indexOf('familyProfileCallSchedule') !== -1 && logged[0].indexOf('ISP meeting') === -1,
              JSON.stringify([cAdd, card, bumped, logged]));
    var cLater = HUB_ACTIONS.familyProfileCallSchedule({ family: PAT, client_key: 'lee9other', date: '2026-10-20' }, master);
    var acCalls = HUB_ACTIONS.familyProfileActivity({ family: PAT }, master);
    var callIds = acCalls.data.items.filter(function (i) { return i.kind === 'scheduled_call'; }).map(function (i) { return i.id; });
    route = function () { return { status: 200, data: { error: { status: 409, message: 'st: held' } } }; };
    var cHeld = HUB_ACTIONS.familyProfileCallSchedule({ family: PAT, client_key: 'kay9test', date: '2026-09-25' }, master);
    route = keep.route;
    stAssert_(out, P + 'call: a later day goes to the backlog, both cards show in the activity as scheduled calls, and a ' +
                   'held book write is its own refusal, never a call answered as filed',
              cLater.status === 200 && tables.tasks[tables.tasks.length - 1].column === 'backlog' &&
              callIds.length === 3 && callIds.indexOf('task_T1') !== -1 && cHeld.status === 409,
              JSON.stringify([cLater, callIds, cHeld]));

    // ---- a number written with separators never leaves ----
    var nearCut = new Array(234).join('A') + ' 246813579 tail';
    tabs.quo_messages = stSpSheet_([
      ['message_id', 'message_created', 'direction', 'from_number', 'to_number', 'body', 'quo_number'],
      ['m5', '2026-09-10T12:00:00Z', 'incoming', '+13305550171', '+13309197595',
       'my ssn is 123 45 6789, again ssn 123.45.6789, card 4111 1111 1111 1111 and 4111-1111-1111-1111', 'PNaaaa0001'],
      ['m6', '2026-09-11T12:00:00Z', 'incoming', '+13305550171', '+13309197595', nearCut, 'PNaaaa0001']
    ]);
    var scNote = HUB_ACTIONS.familyProfileNoteAdd({ family: PAT, body: 'SSN 321 54 9876, card 5500 0000 0000 0004' }, master);
    var scAct = seen('activity with separated numbers', HUB_ACTIONS.familyProfileActivity({ family: PAT }, master));
    var scNotes = seen('notes with separated numbers', HUB_ACTIONS.familyProfileNotes({ family: PAT }, master));
    var scPack = seen('pack with separated numbers', HUB_ACTIONS.familyPack({ family: PAT }, serviceUser_()));
    var scText = JSON.stringify([scNote, scAct, scNotes, scPack]);
    var scLeft = ['123 45 6789', '123.45.6789', '4111 1111 1111 1111', '4111-1111-1111-1111', '246813', '321 54 9876',
                  '5500 0000 0000 0004'].filter(function (s) { return scText.indexOf(s) !== -1; });
    var scIds = ((scAct.data && scAct.data.items) || []).map(function (i) { return i.id; });
    var scPs = (scPack.data && scPack.data.part_status) || {};
    stAssert_(out, P + 'an SSN written with spaces or dots, a card number written with spaces or dashes, and a number ' +
                   'the 240-character cut would leave half-cut never leave in a text, a note, the activity or the pack',
              scNote.status === 200 && scAct.status === 200 && scIds.indexOf('sms_m5') !== -1 &&
              scIds.indexOf('sms_m6') !== -1 && scNotes.status === 200 && scPs.activity && scPs.activity.status === 200 &&
              scPs.notes && scPs.notes.status === 200 && scLeft.length === 0 &&
              (scText.match(/\[withheld\]/g) || []).length >= 6,
              'left: ' + scLeft.join(' | ') + ' ' + scText.slice(0, 1600));

    // ---- the member's details edited ----
    var fw = [], routedP = [];
    cpProfileWrite_ = function (cctx, fields) {
      fw.push([cctx.key, JSON.parse(JSON.stringify(fields))]);
      return { id: 'CLI_' + cctx.key, failed: [], notes: [] };
    };
    route = function (resource, action, p) {
      routedP.push([resource, action, JSON.parse(JSON.stringify(p))]);
      return { status: 200, data: { id: p.id } };
    };
    locationsLock_ = function () { return { releaseLock: function () {} }; };
    logged = [];
    var ovPlain = HUB_ACTIONS.familyProfileOverview({ family: PAT }, master);
    var ov = HUB_ACTIONS.familyProfileOverview({ family: PAT, edit: true }, master);
    var ed = (ov.data && ov.data.edit) || { raw: {}, locked: {}, records: [] };
    stAssert_(out, P + 'edit: the master\'s overview asked for it carries the witness — the member\'s fields on the two ' +
                   'client records that name them, the archived tie locked with its reason, the directory row, no ' +
                   'sign-in — and without the ask carries none',
              ov.status === 200 && !(ovPlain.data && ovPlain.data.edit) && ed.records.join() === 'kay9test,lee9other' &&
              ed.raw.name === 'Pat9 Foster' && ed.raw.rel_kay9test === 'Mom' && ed.person_id === 'PPL_guardian_pat9foster' &&
              /archive/.test((ed.locked.rel_old9gone || {}).why) && !ed.locked.name && ed.account === false,
              JSON.stringify(ed));
    var famSave = function (changes) { return HUB_ACTIONS.familyProfileSave({ family: PAT, changes: changes }, master); };
    var sStale = famSave([{ field: 'phone', value: '330-555-0100', expected: '(330) 555-0000' }]);
    var sShut = famSave([{ field: 'rel_old9gone', value: 'Aunt', expected: ed.raw.rel_old9gone },
                         { field: 'guardian_ssn', value: '1', expected: '' },
                         { field: 'name', value: 'Tom9 Test', expected: ed.raw.name },
                         { field: 'email', value: 'not-an-email', expected: ed.raw.email }]);
    stAssert_(out, P + 'edit: a stale witness is 409 with what the profile shows now; an archived tie, a field it does ' +
                   'not edit, a name another member holds and a malformed email are each refused with a reason — ' +
                   'nothing is written or logged',
              sStale.status === 409 && sStale.data.current.phone === ed.raw.phone && sShut.status === 200 &&
              sShut.data.written.length === 0 && sShut.data.refused.length === 4 && fw.length === 0 &&
              routedP.length === 0 && logged.length === 0, JSON.stringify([sStale, sShut]));
    var sOk = famSave([{ field: 'phone', value: '330-555-0100', expected: ed.raw.phone },
                       { field: 'rel_kay9test', value: 'Mother', expected: 'Mom' }]);
    stAssert_(out, P + 'edit: the phone lands on both client records that name the member and on their directory row, the ' +
                   'relationship on that client\'s record alone; the archived tie comes back read-only and the log ' +
                   'names the fields, never the number',
              sOk.status === 200 && sOk.data.written.join() === 'phone,rel_kay9test' && fw.length === 2 &&
              JSON.stringify(fw[0]) === '["kay9test",{"guardian_phone":"330-555-0100","guardian_relationship":"Mother"}]' &&
              JSON.stringify(fw[1]) === '["lee9other",{"guardian_phone":"330-555-0100"}]' &&
              routedP.length === 1 && routedP[0][0] === 'people' && routedP[0][1] === 'update' &&
              routedP[0][2].id === 'PPL_guardian_pat9foster' && routedP[0][2].phone === '330-555-0100' &&
              sOk.data.client_keys.join() === 'kay9test,lee9other' && sOk.data.family === PAT &&
              sOk.data.readonly.length === 1 && logged.length === 1 && logged[0].indexOf('555-0100') === -1 &&
              logged[0].indexOf('phone') !== -1, JSON.stringify([sOk, fw, routedP, logged]));
    fw = [];
    routedP = [];
    var NEW_KEY = 'fam_pat9newname';
    var sRen = famSave([{ field: 'name', value: 'Pat9 Newname', expected: ed.raw.name }]);
    var keyCol = (notes.grid[0] || []).indexOf('family_key');
    var notesOf = function (k) { return notes.grid.slice(1).filter(function (r) { return r[keyCol] === k; }).length; };
    stAssert_(out, P + 'edit: a rename writes the name on both records and the directory row, moves the member\'s notes ' +
                   'to the new key under the lock and answers the new key',
              sRen.status === 200 && sRen.data.family === NEW_KEY && fw.length === 2 &&
              fw.every(function (w) { return w[1].guardianName === 'Pat9 Newname'; }) && routedP.length === 1 &&
              routedP[0][2].name === 'Pat9 Newname' && notesOf(NEW_KEY) >= 1 && notesOf(PAT) === 0 &&
              bumped.indexOf('fam_familyProfileOverview_' + NEW_KEY) !== -1, JSON.stringify([sRen, notes.grid]));
    cacheBump_ = keep.bump;

    // ---- no answer carries a nine-digit run or a clinical field ----
    var runs = [];
    answers.forEach(function (pair) {
      var text = JSON.stringify(pair[1]);
      if (/(^|\D)\d{9}(\D|$)/.test(text) || /(^|\D)\d{3}-\d{2}-\d{4}(\D|$)/.test(text) ||
          /secret pill|dx words|900-11-4544/.test(text)) runs.push(pair[0]);
    });
    stAssert_(out, P + 'no answer of any read carries a 9-digit run, an SSN shape or a clinical field of the clients',
              answers.length >= 5 && runs.length === 0, 'answers=' + answers.length + ' with runs: ' + runs.join(', '));

    // ---- a client set inactive, and the family linked to them ---- gil9one's guardian is on its Master row alone…
    var casc = {
      derived: [
        { client_key: 'gil9one', id: 'CLI_gil9one', name: 'Gil9 One', house: 'ZZ9999', status: 'active' },
        { client_key: 'ike9two', id: 'CLI_ike9two', name: 'Ike9 Two', house: 'ZZ9999', status: 'active',
          guardianName: 'Kim9 Double', guardian_relationship: 'Mother' },
        { client_key: 'jay9three', id: 'CLI_jay9three', name: 'Jay9 Three', house: 'QQ1000', status: '',
          guardianName: 'Kim9 Double', guardian_relationship: 'Mother' },
        { client_key: 'lu9four', id: 'CLI_lu9four', name: 'Lu9 Four', house: 'QQ1000', status: 'active' }],
      master: [['Client', 'Guardian', 'Guardian #', 'Guardian Relationship'],
               ['Gil9 One', 'Hal9 Single', '3305550182', 'Father']],
      arch: [['Customer', 'Guardian', 'Guardian #', 'Guardian Relationship'], ['Lu9 Four', 'Max9 Stale', '', 'Father']]
    };
    clientsDerived_ = function () { return JSON.parse(JSON.stringify(casc.derived)); };
    cpMasterIndex_ = function () { return cpBookIndexFrom_(casc.master, 'America/New_York'); };
    cpArchiveIndex_ = function () { return cpBookIndexFrom_(casc.arch, 'America/New_York'); };
    var cascOf = function () {
      var built = famIndexBuild_(), said = {};
      Object.keys(built.families).forEach(function (k) {
        var f = built.families[k];
        said[k] = f.status + ':' + f.clients.map(function (c) { return c.client_key + '=' + c.status; }).join(',') +
                  (k === 'fam_hal9single' ? ':' + f.relationship : '');
      });
      return said;
    };
    var cascStart = cascOf();
    // the door sets gil9one and ike9two inactive: their Hub rows say so, and gil9one's Master row moves to the archive
    casc.derived[0].status = 'inactive';
    casc.derived[1].status = 'inactive';
    casc.master = [casc.master[0]];
    casc.arch = casc.arch.concat([['Gil9 One', 'Hal9 Single', '3305550182', 'Father']]);
    var cascOff = cascOf();
    casc.derived[2].status = 'Inactive';
    var cascAll = cascOf();
    // and back: the Hub rows active, the row moved back to the Master
    casc.derived.forEach(function (c) { c.status = 'Active'; });
    casc.master = casc.master.concat([['Gil9 One', 'Hal9 Single', '3305550182', 'Father']]);
    casc.arch = casc.arch.slice(0, 2);
    var cascBack = cascOf();
    stAssert_(out, P + 'cascade: a family member whose one client is live is active; a blank status is live; an old ' +
                   'archive row never names family for a live client',
              cascStart.fam_hal9single === 'active:gil9one=active:Father' &&
              cascStart.fam_kim9double === 'active:ike9two=active,jay9three=active' &&
              !cascStart.fam_max9stale && Object.keys(cascStart).length === 2, JSON.stringify(cascStart));
    stAssert_(out, P + 'cascade: the family of a client set inactive turns inactive unless linked to another live client ' +
                   '— the link kept from the archive row when the guardian was on the Master row alone',
              cascOff.fam_hal9single === 'inactive:gil9one=inactive:Father' &&
              cascOff.fam_kim9double === 'active:jay9three=active,ike9two=inactive' &&
              !cascOff.fam_max9stale && Object.keys(cascOff).length === 2, JSON.stringify(cascOff));
    stAssert_(out, P + 'cascade: with the last live client set inactive the family member turns inactive, every client ' +
                   'still listed',
              cascAll.fam_kim9double === 'inactive:ike9two=inactive,jay9three=inactive', JSON.stringify(cascAll));
    stAssert_(out, P + 'cascade: setting the clients active again brings their family back, exactly as before',
              JSON.stringify(cascBack) === JSON.stringify(cascStart), JSON.stringify([cascBack, cascStart]));
    clientsDerived_ = function () { derivedCalls++; return derived.slice(); };
    cpMasterIndex_ = function () { return cpBookIndexFrom_(masterValues, 'America/New_York'); };
    cpArchiveIndex_ = function () { return cpBookIndexFrom_(archValues, 'America/New_York'); };

    // ---- the cache ----
    famCached_ = keep.cached;
    var calls = 0, key = 'st_' + Date.now();
    famCached_('familyProfileActivity', key, 'all', [], function () { calls++; return { degraded: true }; });
    famCached_('familyProfileActivity', key + 'b', 'all', [], function () { calls++; return { degraded: false }; });
    famCached_('familyProfileActivity', key + 'b', 'all', [], function () { calls++; return { degraded: false }; });
    stAssert_(out, P + 'a read is kept per family member under fam_<action>_<key>; a degraded one retires its own scope',
              calls === 2, 'producer calls=' + calls);

    // ---- where the notes live ----
    var asResource = Object.keys(RESOURCES).filter(function (k) {
      return /^familyProfile/i.test(k) || (RESOURCES[k] && RESOURCES[k].sheet === FAM_NOTES_TAB);
    });
    stAssert_(out, P + 'family_notes is no generic resource and no slice, and is born in the Apps book like staff_notes',
              asResource.length === 0 && HUB_TAB_HOME.family_notes === 'HUB_APPS_BOOK_ID' &&
              HUB_TAB_HOME.family_notes === HUB_TAB_HOME.staff_notes && HUB_TAB_BORN_HOME.indexOf('family_notes') !== -1,
              asResource.join());

    // ---- no delete anywhere ----
    var fns = Object.keys(g).filter(function (k) { return /^(fam[A-Z]|familyProfiles)/.test(k) && typeof g[k] === 'function'; });
    var deleting = [];
    fns.map(function (k) { return [k, g[k]]; }).concat(FAM_ACTIONS.concat(['familyPack']).map(function (a) { return [a, HUB_ACTIONS[a]]; }))
      .forEach(function (pair) {
        if (/deleteRows?\(|deleteRowById_|deleteSheet|clearContents?\(|\.clear\(|setTrashed|api\.delete/.test(stCode_(pair[1]))) {
          deleting.push(pair[0]);
        }
      });
    stAssert_(out, P + 'no Families code path deletes, clears or trashes anything',
              fns.length >= 40 && deleting.length === 0, 'functions=' + fns.length + ' deleting=' + deleting.join());
  } finally {
    cfxUndo();
    hubProfileAppGate_ = keep.appGate;
    hubViewerNamed_ = keep.named;
    familyProfilesFamily_ = keep.family;
    famCached_ = keep.cached;
    HUB_MASTER_EMAIL_CACHE = keep.masterCache;
    HUB_MEMBER_CTX = keep.member;
    hubSysLog_ = keep.log;
    hubTabEnsure_ = keep.ensure;
    hubTabSheet_ = keep.sheet;
    sheetDbGateHolds_ = keep.holds;
    listRows_ = keep.listRows;
    clientsDerived_ = keep.derived;
    cpMasterIndex_ = keep.master;
    cpArchiveIndex_ = keep.archive;
    clientPhotoIndex_ = keep.photos;
    locationsHomes_ = keep.homes;
    locationsToday_ = keep.today;
    ispDocIndex_ = keep.docIndex;
    ispDocFor_ = keep.doc;
    hubLineRow_ = keep.lineRow;
    hubLineOurs_ = keep.lineOurs;
    hubId_ = keep.hubId;
    ssOpen_ = keep.ssOpen;
    locationsDocBytes_ = keep.bytes;
    cacheBump_ = keep.bump;
    locationsCalendar_ = keep.calendar;
    estateRows_ = keep.estate;
    userByEmail_ = keep.userByEmail;
    route = keep.route;
    famActivityDoor_ = keep.activityDoor;
    FAM_PACK_BUDGET_MS = keep.budget;
    cpProfileWrite_ = keep.profileWrite;
    locationsLock_ = keep.lock;
    CLIENTS_DERIVED_MEMO_ = null;
    FAM_INDEX_MEMO_ = null;
  }
}
