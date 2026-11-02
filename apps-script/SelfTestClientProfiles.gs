/** A plan's text with three routines (morning, bedtime, overnight), page furniture and a template question. */
var ST_CP_PLAN = [
  'OhioISP - Kay Test', 'Page 1', 'ISP Span Dates: 01/01/2026 - 12/31/2026',
  'Daily Life & Employment',
  'What does her evening look like?',
  'Kay likes a slow morning with coffee before her day',
  'program.',
  'At bedtime staff help her lay out clothes for the next day.',
  'Overnight checks happen every two hours. Her SSN 900114544 is never typed here.',
  'Page 2'
].join('\n');

var ST_CP_PLAN_PEOPLE = [
  'Contact Information', 'Name:', 'Kay Test',
  'Important People', 'Type', 'Name/Relationship', 'Address', 'Phone',
  'Guardian', 'Gail Guard', '12 Elm St', '(330) 555-0101',
  'Case Manager', 'Sam Support', 'sam@county.org', '(330) 555-0102',
  'Great Things About Kay', 'She laughs easily and loves music.',
  'Outcomes and Experiences', 'Kay will cook one meal a week.',
  'Paid Supports:', 'Homemaker Personal Care', 'Asa LifeCare', 'Weekly',
  'Funding Source:', 'Individual Options Waiver', 'Adult Day Support', 'Daily',
  'Informed Consent'
].join('\n');

// Every account role App Control may release the Clients reads to; the gate decides.
var ST_CP_READ_ROLES = ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'];

/** Clients: the master-only gate, the identity-only roster, the masks, the joins, the cut, the buckets and the write doors. */
function stClientProfiles_(out) {
  var P = 'client profiles: ';
  // a hold on the rename door would stop its own test
  CP_RENAME_HELD = false;
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var keep = {
    client: clientProfilesClient_, derived: clientsDerived_, archive: cpArchiveIndex_, master: cpMasterIndex_,
    masterData: cpMasterDataIndex_, cached: clientProfilesCached_, masterCache: HUB_MASTER_EMAIL_CACHE,
    member: HUB_MEMBER_CTX, log: hubSysLog_, ensure: hubTabEnsure_, sheet: hubTabSheet_, holds: sheetDbGateHolds_,
    estate: estateRows_, list: listRows_, create: createRow_, update: updateRowById_, homes: locationsHomes_,
    photos: clientPhotoIndex_, doc: ispDocFor_, route: estateRoute_, files: ispIntakeFiles_, decode: ispIntakeDecode_,
    identity: hubClientIdentity_, tabHome: HUB_TAB_HOME, bornHome: HUB_TAB_BORN_HOME,
    prop: hubProp_, propSet: hubPropSet_, rules: hubProfileAppRules_, masterSheet: cpMasterSheet_,
    renameBook: cpRenameBookSheet_
  };
  var master = { email: HUB_MASTER_ACCOUNT, role: 'admin' };
  var answers = [];
  var seen = function (label, r) { answers.push([label, r]); return r; };
  stClientFilesIndex_(out);
  var cfxUndo = stCfxStub_();
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    HUB_MEMBER_CTX = null;

    // ---- declarations ----
    var bad = [];
    var READS = ['clientProfileRoster', 'clientProfileDetails', 'clientProfileCare', 'clientProfileMeds',
                 'clientProfileIncidents', 'clientProfileActivity'];
    var TOOLS = ['clientProfileDocFile', 'clientProfileIspSections'];
    var OPEN_ROLES = JSON.stringify(ST_CP_READ_ROLES);
    CP_ACTIONS.forEach(function (a) {
      var p = HUB_POLICY[a];
      if (!p || p.file !== 'ClientProfiles.gs' || typeof HUB_ACTIONS[a] !== 'function') { bad.push(a + ': undeclared'); return; }
      if (RESOLVER_LANES.indexOf(p.lane) === -1 || RESOLVER_STORES.indexOf(p.store) === -1) bad.push(a + ': lane/store');
      // the profile pencil and the care rows are also their editions' (Settings › Editions), which a staff account may hold
      var roles = a === 'clientProfileIspSections' ? '["admin"]'
        : (READS.indexOf(a) !== -1 || a === 'clientProfileDocFile' ? OPEN_ROLES
          : (a === 'clientProfileSave' || a === 'clientProfileOverride' ? '["admin","manager","staff"]' : '["admin","manager"]'));
      if (JSON.stringify(p.roles) !== roles) bad.push(a + ': roles ' + JSON.stringify(p.roles));
      var inv = ['clientProfileSave', 'clientProfileRename', 'clientProfileStatus'].indexOf(a) !== -1 ? '["clients"]' : '[]';
      if (JSON.stringify(p.invalidates || []) !== inv || (p.emits || []).length) bad.push(a + ': invalidates/emits');
      var params = p.params || {};
      Object.keys(params).forEach(function (k) { if (params[k] && params[k].required) bad.push(a + ': ' + k + ' required at the door'); });
      var want = READS.indexOf(a) !== -1 ? 'read' : (TOOLS.indexOf(a) !== -1 ? 'tool' : 'write');
      if (p.lane !== want) bad.push(a + ': lane ' + p.lane + ', wanted ' + want);
      if (want === 'read' && p.idempotent !== true) bad.push(a + ': a read not idempotent');
    });
    var retired = ['clientProfileAppointments', 'clientProfileTransport', 'clientProfileSources', 'clientProfileFunds',
                   'clientProfileBilling'].filter(function (a) { return HUB_POLICY[a] || HUB_ACTIONS[a]; });
    stAssert_(out, P + 'every action is declared in ClientProfiles.gs on its lane — the reads and the document for every ' +
                   'account role App Control may release them to, the writes for admin/manager (the plan reader admin ' +
                   'only) — invalidating nothing but the profile save\'s clients slice, and requiring no param before the ' +
                   'gate; the sections read from their own apps have no second door here',
              bad.length === 0 && CP_ACTIONS.length === 14 && retired.length === 0, bad.concat(retired).join('; '));

    // ---- the gate (no App Control row: the master's alone) ----
    hubProfileAppRules_ = function () { return { rules: {}, tenants: {} }; };
    HUB_VIEWER_MEMO = null;
    var asked = 0;
    clientProfilesClient_ = function () { asked++; return { refused: { status: 418, message: 'st: the client was asked' } }; };
    var callers = [
      { email: 'admin@example.org', role: 'admin' },
      { email: 'mgr@example.org', role: 'manager' },
      { id: 'u-st9', email: 'st9@example.org', role: 'staff', types: ['STAFF'] },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', is_service: true },
      { email: HUB_MASTER_ACCOUNT, role: 'manager' },
      null
    ];
    var probe = { client: 'kay_test', tab: 'plans', id: 'r5', file_id: 'abcdefghijkl', status: 'Closed',
                  incident_ts: 't', client_name: 'Kay Test', witness: 'Kay Test', fields: { outcome: 'x' } };
    var leaks = [];
    var shape = function (r) { return !!r && r.status === 404 && r.message === 'Unknown action.' && Object.keys(r).length === 2; };
    CP_ACTIONS.forEach(function (a) {
      callers.forEach(function (u) {
        var r = HUB_ACTIONS[a](probe, u);
        if (!shape(r)) leaks.push(a + ' ' + JSON.stringify(u) + ' → ' + JSON.stringify(r));
      });
      HUB_MEMBER_CTX = { memberId: 'mem_st', userId: 'u-st', email: 'ann@example.org' };
      var inVisit = HUB_ACTIONS[a](probe, master);
      HUB_MEMBER_CTX = null;
      if (!shape(inVisit)) leaks.push(a + ' in a visit → ' + JSON.stringify(inVisit));
    });
    stAssert_(out, P + 'with no App Control row: a non-master, a manager, a staff member, a visit, the service identity ' +
                   'and no session all get the docRoom 404 shape, before the client is looked up',
              leaks.length === 0 && asked === 0, leaks.slice(0, 4).join(' | ') + ' asked=' + asked);
    var passed = CP_ACTIONS.filter(function (a) { return a !== 'clientProfileRoster'; }).map(function (a) {
      return a + ':' + HUB_ACTIONS[a](probe, master).status;
    });
    stAssert_(out, P + 'the master in its own session passes the gate to the client lookup',
              passed.every(function (s) { return /:418$/.test(s); }), passed.join(', '));
    clientProfilesClient_ = keep.client;

    // ---- fixtures ----
    clientProfilesCached_ = function (action, key, part, deps, producer) { return cpScrub_(producer()); };
    var derived = [
      { id: 'CLI_kay_test', client_key: 'kay_test', name: 'Kay Test', house: 'ZZ9999', home_address: '9999 Test Ave NW, Canton, OH',
        status: 'active', isp_year: '2026', avatar: 'https://example.org/kay.jpg', guardianName: 'Gail Guard',
        guardian_relationship: 'Mother', dob: '1990-10-01', medicaid_id: '112233445566',
        medications: ['secret pill'], diagnoses_text: 'Condition text', allergies_text: 'Peanuts',
        house_manager: 'Hal Manager', house_manager_phone: '3305550199' },
      { client_key: 'lee_other', name: 'Lee Other', house: 'QQ1000', status: 'active', isp_year: '2025' },
      { client_key: 'old_gone', name: 'Old Gone', house: 'QQ1000', status: 'inactive', isp_year: '' }
    ];
    clientsDerived_ = function () { return derived.slice(); };
    clientPhotoIndex_ = function () { return { archiveone: 'https://example.org/a1.jpg' }; };
    var MASTER_HEAD = ['Client', 'SSN', 'DC PIN #', 'DC Exp Date', 'DC Security Code', 'Medicaid #', 'Outcome',
                       'Payee Rep', 'Payee Rep #', 'Guardian #', 'SSA', 'SSA Email', 'Food Stamp', 'Workshop',
                       'Birthdate', 'Login Username', 'Password'];
    var masterValues = [MASTER_HEAD,
      ['Kay  Test', '900-11-4544', '8264', '11/29', '739', '112233445566', 'Community living', 'Pat Payee', '3305550123',
       '(330) 555-0101', 'Sam Support', 'sam@county.org', 'Yes', 'Bright Days', '10/01/1990', 'kaylogin', 'hunter2'],
      ['Twin Name', '111-22-3333', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['Twin Name', '111-22-4444', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']];
    var mdValues = [['Customer', 'TL Debit Card Number', 'DC PIN #'], ['Kay Test', '4000 1234 1234 4812', '']];
    var archValues = [['Customer', 'SSN', 'House', 'Status', 'DC Security Code'],
                      ['Archive One', '900114545', 'QQ1000', 'Discharged', '123'],
                      ['Kay Test', '900114544', 'ZZ9999', '', '']];
    cpMasterIndex_ = function () { return cpBookIndexFrom_(masterValues, 'America/New_York'); };
    cpMasterDataIndex_ = function () { return cpBookIndexFrom_(mdValues, 'America/New_York'); };
    cpArchiveIndex_ = function () { return cpBookIndexFrom_(archValues, 'America/New_York'); };
    locationsHomes_ = function () { return [{ code: 'ZZ9999', home_name: 'ZZ - Test House', address: '9999 Test Ave NW' }]; };
    ispDocFor_ = function (name) {
      return clientNameKey_(name) === 'kaytest' ? { id: 'IspDocFile1234567', name: 'Kay Test ISP.pdf', url: '' } : { id: '', name: '', url: '' };
    };
    var tables = {
      isps: [{ client_key: 'kay_test', client_name: 'Kay Test', isp_year: '2026', source_file: 'Kay Test ISP.pdf',
               loaded_at: '2026-02-01T10:00:00Z', page_count: 30,
               personal_care: '• Needs prompts to brush teeth. Ref 900114544 was typed here by mistake.',
               mobility: 'Walks independently.', diagnoses: '• Condition A\n• Condition B', allergies: 'Peanuts',
               goals_outcomes: '• Cook one meal a week', important_to: 'Music', contact_block: ST_CP_PLAN_PEOPLE }],
      people: [{ id: 'PPL_guardian_gailguard', name: 'Gail Guard', avatar: 'https://example.org/g.jpg' },
               { id: 'PPL_sam', name: 'Sam Support' }],
      clients: [],
      clientFiles: [{ id: 'cf1', client_key: 'kay_test', client_name: 'Kay Test', title: 'Kay Test ISP 2025',
                      folder: 'ISP', drive_id: 'OldIspFile12345', expires_on: '2025-12-31', issued_on: '2025-01-01' },
                    { id: 'cf2', client_key: 'lee_other', client_name: 'Lee Other', title: 'Lee ISP', drive_id: 'LeeIspFile1234' },
                    { id: 'cf3', client_key: 'kay_test', client_name: 'Kay Test', title: 'Social Security card',
                      folder: 'Identity', doc_kind: 'ssn_card', drive_id: 'SsnCardFile12345' },
                    { id: 'cf4', client_key: 'kay_test', client_name: 'Kay Test', title: 'ISP packet scan',
                      folder: 'ISP', doc_kind: 'state_id', digest_category: 'identity', drive_id: 'IdInIspFile12345' },
                    { id: 'cf5', client_key: 'kay_test', client_name: 'Kay Test', title: 'Dentist letter',
                      folder: 'Medical', drive_id: 'LetterFile12345' }],
      medications: [{ 'Id - Auto': '7', Client: 'Kay Test', PrescriptionName: 'Med A', Dosage: '5 mg', MedType: 'Tablet',
                      PRN: 'Daily', AdministrationTimes: '"0800" "2000"', 'Added Date': '2026-03-01', Discountinued: '' },
                    { 'Id - Auto': '8', Client: 'Kay Test', PrescriptionName: 'Med B', Discountinued: 'Yes',
                      'Discountinued Date': '2026-05-01', 'Added Date': '2025-01-02' },
                    { 'Id - Auto': '9', Client: 'Lee Other', PrescriptionName: 'Med C' }],
      financeTransactions: [
        { id: 't1', client: 'Kay Test', date: '2026-09-02', amount: -18.5, receiptFileId: 'ReceiptFile12345' }],
      clientNotes: [{ id: 'n1', client_key: 'kay_test', note: 'Called the pharmacy.', entry_date: '2026-09-10' }]
    };
    listRows_ = function (res) {
      if (!tables.hasOwnProperty(res)) throw new Error('st: no table ' + res);
      return JSON.parse(JSON.stringify(tables[res]));
    };
    var estate = {
      drVisits: [{ id: 'r5', client_name: 'Kay  Test', dr_name: 'Dr Who', appointment_date: '2026-09-30',
                   appointment_start_time: '10:00', appointment_address: '1 Clinic Rd', wheelchair_van_required: 'Yes', manager: 'Hal' },
                 { id: 'r6', client_name: 'Kay Test', dr_name: 'Dr Past', appointment_date: '2026-09-01', upcoming: 'No' },
                 { id: 'r7', client_name: 'Lee Other', dr_name: 'Dr Else', appointment_date: '2026-09-25' }],
      uiIncidents: [{ id: 'r2', timestamp: '2026-09-10T14:00:00.000Z', client_name: 'Kay Test', your_name: 'Ann Staff',
                      incident_category: 'Fall, Minor injury (rash, bruise)', incident_date: '2026-09-10', incident_time: '09:30',
                      employees_involved: 'Ann Staff, Bo Staff', summary_of_incident: 'Slipped.', comments: 'not a column' },
                    { id: 'r3', timestamp: '2026-09-11T14:00:00.000Z', client_name: 'Lee Other', incident_category: 'Fall' }],
      drAppointments: [{ client: 'Kay Test', dr_name: 'Dr Who', specialist: 'Cardiology', phone: '3305550111', active_or_discontinued: 'Active' },
                       { client: 'Kay Test', dr_name: 'Dr Gone', active_or_discontinued: 'Discontinued' }],
      dailyNotes: [{ id: 'r9', client_name: 'Kay Test', category: 'Behavior', response: 'Calm day.', dsp_name: 'Ann Staff', reporting_date: '2026-09-12' }]
    };
    estateRows_ = function (res) { return JSON.parse(JSON.stringify(estate[res] || [])); };
    var grids = {};
    hubTabSheet_ = function (tab) { return grids[tab] || null; };
    hubTabEnsure_ = function (tab, header) {
      if (tab !== CP_SECTIONS_TAB && tab !== CP_REVIEWS_TAB) throw new Error('st: no other tab ' + tab);
      if (!grids[tab]) grids[tab] = stLocSheet_([header.slice()]);
      return grids[tab];
    };
    sheetDbGateHolds_ = function () { return null; };
    var logged = [];
    hubSysLog_ = function (who, kind, target) { logged.push(kind + ':' + target); return true; };

    // ---- the roster ----
    var rActive = seen('roster', HUB_ACTIONS.clientProfileRoster({}, master));
    var rAll = seen('roster inactive', HUB_ACTIONS.clientProfileRoster({ show_inactive: true }, master));
    var keysOk = rActive.status === 200 && rAll.data.clients.every(function (c) {
      return Object.keys(c).sort().join() === 'avatar,client_id,client_key,house,isp_year,name,status';
    });
    var allText = JSON.stringify(rAll);
    stAssert_(out, P + 'the roster is identity only (key, record id, name, status, house, photo, plan year) and active by ' +
                   'default; Show Inactive adds the archive of old clients, masked, and a client on both lists once',
              keysOk && rActive.data.clients.map(function (c) { return c.client_key; }).join() === 'kay_test,lee_other' &&
              rActive.data.clients[0].client_id === 'CLI_kay_test' && rAll.data.clients[0].client_id === '' &&
              rAll.data.clients.map(function (c) { return c.client_key + ':' + c.status; }).join() ===
                'archiveone:inactive,kay_test:active,lee_other:active,old_gone:inactive' &&
              rAll.data.clients[0].avatar === 'https://example.org/a1.jpg' && rAll.data.inactive_why === '' &&
              allText.indexOf('secret pill') === -1 && allText.indexOf('Peanuts') === -1 && allText.indexOf('900114545') === -1,
              JSON.stringify([rActive, rAll]));
    cpArchiveIndex_ = function () { throw new Error('st: archive closed'); };
    var rClosed = HUB_ACTIONS.clientProfileRoster({ show_inactive: 'true' }, master);
    stAssert_(out, P + 'an unreadable archive still answers the current clients and says why the inactive ones are missing',
              rClosed.status === 200 && rClosed.data.clients.length === 3 && /archive/.test(rClosed.data.inactive_why) &&
              rClosed.data.degraded === true, JSON.stringify(rClosed));
    cpArchiveIndex_ = function () { return cpBookIndexFrom_(archValues, 'America/New_York'); };

    // ---- the client ----
    clientProfilesClient_ = keep.client;
    var cBad = clientProfilesClient_('a b'), cNone = clientProfilesClient_('nobody_here');
    var cArch = clientProfilesClient_('archiveone'), cKay = clientProfilesClient_('kay_test');
    stAssert_(out, P + 'a client resolves by its exact key, else the archive by its key; a malformed key is 400 and an ' +
                   'unknown one 404 — never a guess',
              cBad.refused && cBad.refused.status === 400 && cNone.refused && cNone.refused.status === 404 &&
              cArch.archived === true && cArch.row.status === 'inactive' && cKay.archived === false && cKay.name === 'Kay Test',
              JSON.stringify([cBad, cNone, cArch.archived, cKay.key]));

    // ---- the masks ----
    var m1 = clientProfileMask_({ ssn: '900-11-4544', tl_card: '4000 1234 1234 4812', dc_exp: '11/29',
                                  dc_security_code: '739', dc_pin: '8264' });
    var m2 = clientProfileMask_({ ssn: 'N/A', dc_pin: '-', dc_exp: '' });
    var m3 = clientProfileMask_({ ssn: '12345', tl_card: '4812' });
    stAssert_(out, P + 'the mask sends an SSN\'s and a card\'s last four, and presence alone for the expiry, the ' +
                   'security code and the PIN; a word for nothing is not on file, a malformed SSN has no last four',
              JSON.stringify(m1) === JSON.stringify({ ssn_last4: '4544', ssn_on_file: true, tl_card_last4: '4812',
                dc_exp_on_file: true, dc_security_code_on_file: true, dc_pin_on_file: true }) &&
              m2.ssn_on_file === false && m2.ssn_last4 === null && m2.dc_pin_on_file === false && m2.dc_exp_on_file === false &&
              m3.ssn_last4 === null && m3.ssn_on_file === true && m3.tl_card_last4 === '4812', JSON.stringify([m1, m2, m3]));
    var idx = cpBookIndexFrom_(masterValues, 'America/New_York');
    var idxText = JSON.stringify(idx);
    stAssert_(out, P + 'a client book is read through its mapped columns only: the SSN, DC cells, login and password never ' +
                   'enter the index, and a name two rows carry is ambiguous and empty',
              idx.rows.kaytest && idx.rows.kaytest.mask.ssn_last4 === '4544' && idx.rows.kaytest.fields.dob === '1990-10-01' &&
              idx.rows.kaytest.fields.payee_rep_phone === '(330) 555-0123' && idx.rows.twinname.ambiguous === true &&
              idxText.indexOf('900-11-4544') === -1 && idxText.indexOf('11/29') === -1 && idxText.indexOf('8264') === -1 &&
              idxText.indexOf('hunter2') === -1 && idxText.indexOf('kaylogin') === -1 && idxText.indexOf('111-22') === -1,
              idxText);
    var det = seen('details', HUB_ACTIONS.clientProfileDetails({ client: 'kay_test' }, master));
    var detText = JSON.stringify(det);
    var d = det.data || {};
    stAssert_(out, P + 'the profile carries the masks and nothing raw: SSN •••-••-4544, card last four 4812, the DC ' +
                   'cells as on file; no source cell of these columns is anywhere in the answer',
              det.status === 200 && d.identity.ssn_last4 === '4544' && d.identity.ssn_on_file === true &&
              d.financial.tl_card_last4 === '4812' && d.financial.dc_exp_on_file === true &&
              d.financial.dc_security_code_on_file === true && d.financial.dc_pin_on_file === true &&
              detText.indexOf('900-11-4544') === -1 && detText.indexOf('900114544') === -1 &&
              detText.indexOf('4000 1234') === -1 && detText.indexOf('4000123412344812') === -1 &&
              detText.indexOf('11/29') === -1 && detText.indexOf('"739"') === -1 && detText.indexOf('8264') === -1 &&
              detText.indexOf('hunter2') === -1, detText);
    stAssert_(out, P + 'the profile is the Hub row first, the Master for what it lacks: age from the birthday, the house ' +
                   'label from the registry, the guardian linked to their people row, the family from the plan\'s table',
              d.client.age === 35 && d.client.initials === 'KT' && d.home.house_code === 'ZZ9999' &&
              d.home.house_label === 'ZZ - Test House' && d.home.house_manager_phone === '(330) 555-0199' &&
              d.guardian.name === 'Gail Guard' && d.guardian.person_id === 'PPL_guardian_gailguard' &&
              d.guardian.ssa_person_id === 'PPL_sam' && d.services.outcome === 'Community living' &&
              d.services.isp_file_id === 'IspDocFile1234567' && d.financial.payee_rep === 'Pat Payee' &&
              d.identity.medicaid_id === '112233445566' &&
              d.family.map(function (f) { return f.name + ':' + f.relationship; }).join() === 'Gail Guard:Guardian,Sam Support:Case Manager' &&
              detText.indexOf('secret pill') === -1, detText);
    var scrubbed = cpScrub_({ a: 'SSN 900114544 here', b: 'card 4000123412344812', c: '900-11-4544', d: '(330) 555-0101',
                              m: '112233445566', id: 'keep900114544id', n: 123456789 });
    stAssert_(out, P + 'the last guard withholds a bare 9-digit or 13-19-digit run and an SSN shape, and leaves phones, ' +
                   'a 12-digit Medicaid # and ids alone',
              scrubbed.a === 'SSN [withheld] here' && scrubbed.b === 'card [withheld]' && scrubbed.c === '[withheld]' &&
              scrubbed.d === '(330) 555-0101' && scrubbed.m === '112233445566' && scrubbed.id === 'keep900114544id' &&
              scrubbed.n === null, JSON.stringify(scrubbed));

    // ---- the plan's sections ----
    var cut = clientProfileIspCut_(ST_CP_PLAN);
    var routines = cut.rows.filter(function (r) { return CP_ROUTINES.some(function (x) { return x.section === r.section; }); });
    var cutText = JSON.stringify(cut);
    stAssert_(out, P + 'isp_sections: a plan with morning, bedtime and overnight gives three routine rows in the plan\'s own ' +
                   'sentences, lists the other six routines as absent, and drops the template question and the page furniture',
              routines.map(function (r) { return r.section; }).join() === 'morning,bedtime,overnight' &&
              routines[0].text === 'Kay likes a slow morning with coffee before her day program.' &&
              ['afternoon', 'evening', 'meals', 'hygiene', 'sleep', 'wake'].every(function (s) { return cut.absent.indexOf(s) !== -1; }) &&
              cutText.indexOf('evening look like') === -1 && cutText.indexOf('Page 2') === -1 && cutText.indexOf('OhioISP') === -1,
              cutText);
    var cut2 = clientProfileIspCut_(ST_CP_PLAN_PEOPLE);
    var bySec = {};
    cut2.rows.forEach(function (r) { (bySec[r.section] = bySec[r.section] || []).push(r); });
    stAssert_(out, P + 'isp_sections: the whole Important People table (read back by ispPeople_), each Paid Supports and ' +
                   'Funding Source block, Great Things and Outcomes are filed verbatim',
              bySec.important_people && ispPeople_(bySec.important_people[0].text).length === 2 &&
              bySec.services && bySec.services.length === 2 && bySec.services[0].record === 'Homemaker Personal Care' &&
              bySec.great_things && bySec.great_things[0].text === 'She laughs easily and loves music.' &&
              bySec.outcomes && bySec.outcomes[0].text === 'Kay will cook one meal a week.' &&
              cut2.absent.indexOf('equipment') !== -1, JSON.stringify(cut2));
    var early = HUB_ACTIONS.clientProfileCare({ client: 'kay_test', tab: 'daily' }, master);
    stAssert_(out, P + 'before the plan is cut into sections no routine is called absent — the answer says the plan ' +
                   'has not been read yet',
              early.status === 200 && early.data.absent.indexOf('morning') === -1 &&
              early.data.absent.indexOf('personal_care') === -1 && /not been read into sections/.test(early.data.why),
              JSON.stringify(early));
    grids[CP_SECTIONS_TAB] = stLocSheet_([CP_SECTIONS_HEADER.slice(),
      ['IS_lee_other_morning', 'lee_other', '2025', 'morning', 'Morning', '- keep me', 'Lee.pdf', 'x']]);
    var w1 = clientProfileIspSectionsFrom_('kay_test', '2026', ST_CP_PLAN, 'Kay Test ISP.pdf');
    var w2 = clientProfileIspSectionsFrom_('kay_test', '2026', ST_CP_PLAN, 'Kay Test ISP.pdf');
    var sg = grids[CP_SECTIONS_TAB].grid;
    var live = sg.slice(1).filter(function (r) { return r.join('') !== ''; });
    stAssert_(out, P + 'isp_sections: filing replaces the client\'s rows in place — another client\'s rows are kept (a ' +
                   'leading dash kept from being a formula), and a second run does not grow the tab',
              !w1.refused && !w2.refused && w2.rows === 3 &&
              live.filter(function (r) { return r[1] === 'kay_test'; }).length === 3 &&
              live.filter(function (r) { return r[1] === 'lee_other'; }).length === 1 &&
              live[0][5] === '\'- keep me' && sg.length === 5, JSON.stringify(sg));
    var careDaily = seen('care daily', HUB_ACTIONS.clientProfileCare({ client: 'kay_test', tab: 'daily' }, master));
    var cd = careDaily.data || {};
    stAssert_(out, P + 'Daily care lists every routine the plan writes (Current for this plan year) and names the ones ' +
                   'it does not, beside the plan\'s personal care and mobility',
              careDaily.status === 200 &&
              cd.rows.map(function (r) { return r.record; }).join() === 'Morning,Bedtime,Overnight,Personal care,Mobility' &&
              cd.rows[0].status === 'Current' && cd.absent.indexOf('evening') !== -1 && cd.absent.indexOf('morning') === -1 &&
              cd.statuses.join() === 'Current' && JSON.stringify(cd).indexOf('900114544') === -1 &&
              cd.rows[3].text.indexOf('Ref [withheld] was typed') !== -1, JSON.stringify(careDaily));
    var carePlans = seen('care plans', HUB_ACTIONS.clientProfileCare({ client: 'kay_test', tab: 'plans' }, master));
    var careTeam = seen('care team', HUB_ACTIONS.clientProfileCare({ client: 'kay_test', tab: 'team' }, master));
    ['health', 'goals', 'home'].forEach(function (t) { seen('care ' + t, HUB_ACTIONS.clientProfileCare({ client: 'kay_test', tab: t }, master)); });
    var badTab = HUB_ACTIONS.clientProfileCare({ client: 'kay_test', tab: 'secrets' }, master);
    var team = (careTeam.data && careTeam.data.people) || [];
    stAssert_(out, P + 'Care plans: the filed plan is Current and an expired plan document Expired; Care team: the ' +
                   'record\'s people, the plan\'s and the client\'s active doctors, once each; an unknown tab is 400',
              carePlans.status === 200 && carePlans.data.rows.map(function (r) { return r.status; }).join() === 'Current,Expired' &&
              carePlans.data.rows[0].file_id === 'IspDocFile1234567' && carePlans.data.rows[1].file_id === 'OldIspFile12345' &&
              team.map(function (p) { return p.name; }).join() === 'Gail Guard,Sam Support,Hal Manager,Pat Payee,Dr Who' &&
              team[0].avatar === 'https://example.org/g.jpg' && team[4].relationship === 'Cardiology' && badTab.status === 400,
              JSON.stringify([carePlans, team]));

    // ---- medication ----
    var meds = seen('meds', HUB_ACTIONS.clientProfileMeds({ client: 'kay_test', tab: 'meds' }, master));
    var medsBare = HUB_ACTIONS.clientProfileMeds({ client: 'kay_test' }, master);
    var medsAdmin = HUB_ACTIONS.clientProfileMeds({ client: 'kay_test', tab: 'admin' }, master);
    stAssert_(out, P + 'Medication › Medications: Active before Discontinued from the eMAR list, the default tab; ' +
                   'Administration and Refills are not read here (400) — they read their own apps',
              meds.data.rows.map(function (r) { return r.record + ':' + r.status; }).join() === 'Med A:Active,Med B:Discontinued' &&
              meds.data.rows[0].details === '5 mg · Tablet · Daily · 08:00 20:00' && medsBare.status === 200 &&
              medsBare.data.rows.length === 2 && medsAdmin.status === 400, JSON.stringify([meds, medsBare, medsAdmin]));

    // ---- the appointment row the pencil answers with ----
    var today = '2026-09-22';
    var ctxKay = clientProfilesClient_('kay_test');
    var b = [cpApptRow_({ appointment_date: '2026-09-01' }, ctxKay, today).status,
             cpApptRow_({ appointment_date: '2026-09-30' }, ctxKay, today).status,
             cpApptRow_({ appointment_date: '', upcoming: 'Yes' }, ctxKay, today).status,
             cpApptRow_({ appointment_date: '', upcoming: 'No' }, ctxKay, today).status,
             cpApptRow_({ appointment_date: '9/25/2026' }, ctxKay, today).date,
             cpApptRow_({ id: 'r5', client_name: 'Kay  Test', wheelchair_van_required: 'Yes' }, ctxKay, today).witness];
    stAssert_(out, P + 'an appointment row: a past day is Past, today onward Upcoming, an unreadable day follows the ' +
                   'Upcoming? cell, the witness its own name cell',
              b.join() === 'Past,Upcoming,Upcoming,Past,2026-09-25,Kay  Test', JSON.stringify(b));

    // ---- incidents and their review status ----
    var inc0 = seen('incidents', HUB_ACTIONS.clientProfileIncidents({ client: 'kay_test' }, master));
    var st1 = [
      HUB_ACTIONS.clientProfileIncidentStatus({ client: 'kay_test', incident_ts: '2026-09-10T14:00:00.000Z', client_name: 'Kay Test', status: 'Lost' }, master),
      HUB_ACTIONS.clientProfileIncidentStatus({ client: 'kay_test', incident_ts: '2026-09-10T14:00:00.000Z', client_name: 'Lee Other', status: 'Closed' }, master),
      HUB_ACTIONS.clientProfileIncidentStatus({ client: 'kay_test', incident_ts: '2026-09-11T14:00:00.000Z', client_name: 'Kay Test', status: 'Closed' }, master)
    ].map(function (r) { return r.status; });
    var put1 = HUB_ACTIONS.clientProfileIncidentStatus({ client: 'kay_test', incident_ts: '2026-09-10T14:00:00.000Z',
                                                          client_name: 'Kay Test', status: 'under review' }, master);
    var put2 = HUB_ACTIONS.clientProfileIncidentStatus({ client: 'kay_test', incident_ts: '2026-09-10T14:00:00.000Z',
                                                          client_name: 'Kay Test', status: 'Closed' }, master);
    var inc1 = seen('incidents after', HUB_ACTIONS.clientProfileIncidents({ client: 'kay_test' }, master));
    var rg = grids[CP_REVIEWS_TAB] ? grids[CP_REVIEWS_TAB].grid : [];
    var r0 = (inc0.data && inc0.data.rows[0]) || {};
    var r1 = (inc1.data && inc1.data.rows[0]) || {};
    stAssert_(out, P + 'incidents: the client\'s reports only, Reported until reviewed, the categories paren-aware and the ' +
                   'employees a list; the status is kept by client_key|incident_ts, one row updated in place',
              inc0.data.rows.length === 1 && r0.status === 'Reported' && r0.categories.length === 2 &&
              r0.employees_involved.join('|') === 'Ann Staff|Bo Staff' && r0.house_code === 'ZZ9999' &&
              st1.join() === '400,409,404' && put1.status === 200 && put1.data.row.status === 'Under review' &&
              put2.status === 200 && rg.length === 2 && rg[1][0] === 'kay_test|2026-09-10T14:00:00.000Z' &&
              r1.status === 'Closed' && r1.status_by === HUB_MASTER_ACCOUNT && JSON.stringify(inc1).indexOf('not a column') === -1,
              JSON.stringify([inc0, st1, put1, put2, rg, inc1]));

    // ---- activity ----
    var act = seen('activity', HUB_ACTIONS.clientProfileActivity({ client: 'kay_test' }, master));
    stAssert_(out, P + 'Activity: every client-bearing row newest first, in the table\'s shape',
              act.status === 200 && act.data.rows[0].date === '2026-09-30' &&
              act.data.counts.visits === 2 && act.data.counts.incidents === 1 && act.data.counts.daily_notes === 1 &&
              act.data.counts.client_notes === 1 && act.data.counts.med_changes === 3 && act.data.rows[0].status === 'Doctor visit',
              JSON.stringify(act));

    // ---- the relay's pack ----
    var pol = HUB_POLICY.clientPack || {};
    stAssert_(out, P + 'pack: declared in ClientProfiles.gs as an idempotent read, a service read, and no section door',
              pol.file === 'ClientProfiles.gs' && pol.lane === 'read' && pol.idempotent === true &&
              JSON.stringify(pol.roles) === '["admin"]' && typeof HUB_ACTIONS.clientPack === 'function' &&
              SERVICE_READ_ACTIONS.indexOf('clientPack') !== -1 && CP_ACTIONS.indexOf('clientPack') === -1 &&
              CP_PACK_PARTS.length === 21 && JSON.stringify(Object.keys(cpPackDoors_('x')).sort()) ===
                JSON.stringify(CP_PACK_PARTS.slice().sort()) &&
              ['activity', 'transport', 'mar'].every(function (n) {
                return CP_PACK_PARTS.indexOf(n + '_own') === CP_PACK_PARTS.indexOf(n) + 1;
              }) && CP_PACK_PARTS[0] === 'roster_own', JSON.stringify(pol));
    var sourceDoors = { appointments: 'csApptDoor_', transport: 'csTransportDoor_', mar: 'csmDoor_', refills: 'csrDoor_',
                        funds: 'csfFundsDoor_', billing: 'csfBillingDoor_' };
    var sourceActions = { appointments: 'clientSourceAppointments', transport: 'clientSourceTransport', mar: 'clientSourceMar',
                          refills: 'clientSourceRefills', funds: 'clientSourceFunds', billing: 'clientSourceBilling' };
    var doorKeep = {};
    Object.keys(sourceDoors).forEach(function (p) { doorKeep[p] = g[sourceDoors[p]]; });
    var derivedKeep = clientsDerived_, budgetKeep = CP_PACK_BUDGET_MS;
    try {
      var doorAsks = [];
      Object.keys(sourceDoors).forEach(function (p) {
        g[sourceDoors[p]] = function (ask) {
          doorAsks.push(p + ':' + JSON.stringify(ask));
          return { status: 200, data: { door: p, client: ask && ask.client } };
        };
      });
      var memoSeen = [];
      clientsDerived_ = function (u) { memoSeen.push(!u && !!CLIENTS_DERIVED_MEMO_); return derived.slice(); };
      var packShut = [master, { email: 'admin@example.org', role: 'admin' }, null,
                      { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' }].map(function (u) {
        var r = HUB_ACTIONS.clientPack({ client: 'kay_test' }, u);
        return r.status + ':' + r.message;
      });
      stAssert_(out, P + 'pack: every session — the master\'s own included — and no session get "Unknown action.", before the ' +
                     'client is looked up',
                packShut.join('|') === ['404:Unknown action.', '404:Unknown action.', '404:Unknown action.',
                                        '404:Unknown action.'].join('|') && memoSeen.length === 0, packShut.join(' | '));
      var pack = seen('pack', HUB_ACTIONS.clientPack({ client: 'kay_test' }, serviceUser_()));
      var pp = (pack.data && pack.data.parts) || {};
      var ps = (pack.data && pack.data.part_status) || {};
      stAssert_(out, P + 'pack: the service reads every part in one execution, the roster derived once for all of ' +
                     'them, and the memo is dropped after',
                pack.status === 200 && pack.data.client === 'kay_test' && !!pack.data.built_at &&
                CP_PACK_PARTS.every(function (n) { return ps[n] && ps[n].status === 200 && pp[n] !== undefined; }) &&
                memoSeen.length > 0 && memoSeen.every(Boolean) && CLIENTS_DERIVED_MEMO_ === null,
                JSON.stringify([pack.status, ps, memoSeen, CLIENTS_DERIVED_MEMO_]));
      var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
      var parity = {
        details: same(pp.details, HUB_ACTIONS.clientProfileDetails({ client: 'kay_test' }, master).data),
        meds: same(pp.meds, HUB_ACTIONS.clientProfileMeds({ client: 'kay_test', tab: 'meds' }, master).data),
        activity: same(pp.activity, HUB_ACTIONS.clientProfileActivity({ client: 'kay_test' }, master).data)
      };
      CP_CARE_TABS.forEach(function (t) {
        parity['care_' + t] = same(pp['care_' + t], HUB_ACTIONS.clientProfileCare({ client: 'kay_test', tab: t }, master).data);
      });
      Object.keys(sourceActions).forEach(function (p) {
        parity[p] = same(pp[p], HUB_ACTIONS[sourceActions[p]]({ client: 'kay_test' }, master).data) &&
                    same(pp[p], { door: p, client: 'kay_test' });
      });
      var incNow = HUB_ACTIONS.clientProfileIncidents({ client: 'kay_test' }, master).data;
      var rv = (pp.reviews && pp.reviews.reviews) || {};
      parity.reviews = incNow.rows.every(function (r) {
        var hit = rv['kay_test|' + r.incident_ts];
        return hit ? hit.status === r.status && hit.by === r.status_by && hit.at === r.status_at : r.status === 'Reported';
      }) && Object.keys(rv).length === 1 && same(pp.reviews.statuses, CP_INCIDENT_STATUSES);
      stAssert_(out, P + 'pack: each part is its own door\'s answer — the record, the six care tabs, the medications and the ' +
                     'activity exactly as their actions answer the master, the review statuses the incidents read, and ' +
                     'the six source doors the very ones their actions ask, each once with the client alone',
                Object.keys(parity).every(function (k) { return parity[k]; }) &&
                doorAsks.slice(0, 6).sort().join() === Object.keys(sourceDoors).map(function (p) {
                  return p + ':{"client":"kay_test"}';
                }).sort().join(), JSON.stringify([parity, doorAsks.slice(0, 6)]));
      var packText = JSON.stringify(pack);
      stAssert_(out, P + 'pack: the record inside it carries the masks and nothing raw, and no part a 9-digit run',
                pp.details.identity.ssn_last4 === '4544' && pp.details.financial.tl_card_last4 === '4812' &&
                packText.indexOf('900-11-4544') === -1 && packText.indexOf('900114544') === -1 &&
                packText.indexOf('4000 1234') === -1 && packText.indexOf('hunter2') === -1, packText.slice(0, 400));
      csmDoor_ = function () { throw new Error('st: papers closed'); };
      csfFundsDoor_ = function () { return { status: 404, message: 'No client "kay_test" is on file.' }; };
      var broken = HUB_ACTIONS.clientPack({ client: 'kay_test' }, serviceUser_());
      var bst = broken.data.part_status;
      stAssert_(out, P + 'pack: a part that throws is its own 503 — and so is the client\'s own cut of it — and a door\'s ' +
                     'refusal its own status; the other parts answer and the memo is dropped',
                broken.status === 200 && bst.mar.status === 503 && /papers closed/.test(bst.mar.message) && !broken.data.parts.mar &&
                bst.mar_own.status === 503 && !broken.data.parts.mar_own &&
                bst.funds.status === 404 && !broken.data.parts.funds &&
                CP_PACK_PARTS.filter(function (n) { return ['mar', 'mar_own', 'funds'].indexOf(n) === -1; }).every(function (n) {
                  return bst[n].status === 200 && broken.data.parts[n] !== undefined;
                }) && CLIENTS_DERIVED_MEMO_ === null, JSON.stringify(bst));
      CP_PACK_BUDGET_MS = -1;
      var late = HUB_ACTIONS.clientPack({ client: 'kay_test' }, serviceUser_());
      CP_PACK_BUDGET_MS = budgetKeep;
      var none = HUB_ACTIONS.clientPack({ client: 'nobody_here' }, serviceUser_());
      var junk = HUB_ACTIONS.clientPack({ client: 'a b' }, serviceUser_());
      stAssert_(out, P + 'pack: past its budget it starts no part and says so part by part; an unknown client is the ' +
                     'lookup\'s own 404 and a malformed key its 400, never an empty pack',
                late.status === 200 && Object.keys(late.data.parts).length === 0 &&
                CP_PACK_PARTS.every(function (n) { return late.data.part_status[n].status === 503; }) &&
                none.status === 404 && !none.data && junk.status === 400 && CLIENTS_DERIVED_MEMO_ === null,
                JSON.stringify([late.data.part_status.details, none, junk]));
    } finally {
      Object.keys(sourceDoors).forEach(function (p) { g[sourceDoors[p]] = doorKeep[p]; });
      clientsDerived_ = derivedKeep;
      CP_PACK_BUDGET_MS = budgetKeep;
      CLIENTS_DERIVED_MEMO_ = null;
    }
    var photoReads = 0;
    clientPhotoIndex_ = function () { photoReads++; return {}; };
    CLIENTS_DERIVED_MEMO_ = {};
    var once = [keep.derived(null), keep.derived(null)];
    var narrowed = keep.derived({ role: 'client', client_key: 'kay_test' });
    CLIENTS_DERIVED_MEMO_ = null;
    var fresh = keep.derived(null);
    clientPhotoIndex_ = function () { return { archiveone: 'https://example.org/a1.jpg' }; };
    stAssert_(out, P + 'pack: while a pack runs the unnarrowed roster is derived once and shared; a narrowed read and a ' +
                   'read outside a pack derive their own',
              once[0] === once[1] && photoReads === 3 && narrowed !== once[0] && fresh !== once[0] &&
              once[0].map(function (c) { return c.client_key; }).join() === fresh.map(function (c) { return c.client_key; }).join(),
              JSON.stringify({ photoReads: photoReads, keys: once[0].map(function (c) { return c.client_key; }) }));

    // ---- documents ----
    var kay = clientProfilesClient_('kay_test');
    var docBad = HUB_ACTIONS.clientProfileDocFile({ client: 'kay_test', file_id: 'x' }, master);
    var docOther = HUB_ACTIONS.clientProfileDocFile({ client: 'kay_test', file_id: 'LeeIspFile1234' }, master);
    var docReceipt = HUB_ACTIONS.clientProfileDocFile({ client: 'kay_test', file_id: 'ReceiptFile12345' }, master);
    var docSsn = HUB_ACTIONS.clientProfileDocFile({ client: 'kay_test', file_id: 'SsnCardFile12345' }, master);
    stAssert_(out, P + 'documents: the plan and the plan-labelled client files are known; another client\'s file, a receipt ' +
                   '(Client Funds\' own door serves those), an identity paper even filed under ISP, and a file the Plans ' +
                   'list does not show are 404, a malformed id 400, before Drive is touched',
              cpDocKnown_(kay, 'IspDocFile1234567') && cpDocKnown_(kay, 'OldIspFile12345') && !cpDocKnown_(kay, 'ReceiptFile12345') &&
              !cpDocKnown_(kay, 'LeeIspFile1234') && !cpDocKnown_(kay, 'SsnCardFile12345') && !cpDocKnown_(kay, 'IdInIspFile12345') &&
              !cpDocKnown_(kay, 'LetterFile12345') && docOther.status === 404 && docReceipt.status === 404 &&
              docSsn.status === 404 && docBad.status === 400,
              JSON.stringify([docBad, docOther, docReceipt, docSsn]));

    // ---- the profile pencil ----
    var fr = [clientProfileSaveFields_({ ssn: '900114544' }), clientProfileSaveFields_({ tl_card: '4812' }),
              clientProfileSaveFields_({ dc_pin: '1' }), clientProfileSaveFields_({ ssn_last4: '4544' }),
              clientProfileSaveFields_({ favorite: 'x' }), clientProfileSaveFields_({})];
    var okFields = clientProfileSaveFields_({ guardian_name: 'Jo Doe', house_manager: '=cmd()' });
    var unsafe = CP_SAVE_FIELDS.filter(function (k) { return CP_NEVER_WRITTEN.test(cpFold_(k)); });
    stAssert_(out, P + 'the profile save refuses SSN, card, DC and PIN names (422) and unknown fields (422), maps the ' +
                   'guardian alias, keeps text from being a formula, and no allowlisted column looks sensitive',
              fr.map(function (r) { return r.refused && r.refused.status; }).join() === '422,422,422,422,422,400' &&
              okFields.fields.guardianName === 'Jo Doe' && okFields.fields.house_manager === '\'=cmd()' && unsafe.length === 0,
              JSON.stringify([fr, okFields, unsafe]));
    var made = [], patched = [];
    createRow_ = function (res, rec) { made.push([res, rec]); return rec; };
    updateRowById_ = function (res, rec) { patched.push([res, rec]); return rec; };
    var s1 = HUB_ACTIONS.clientProfileSave({ client: 'kay_test', fields: { outcome: 'Work', ssn: '1' } }, master);
    var s2 = HUB_ACTIONS.clientProfileSave({ client: 'kay_test', fields: { outcome: 'Work' } }, master);
    tables.clients = [{ id: 'CLI_kay_test', client_key: 'kay_test', name: 'Kay Test' }];
    var s3 = HUB_ACTIONS.clientProfileSave({ client: 'kay_test', fields: { workshop_phone: '3305550100' } }, master);
    var s4 = HUB_ACTIONS.clientProfileSave({ client: 'archiveone', fields: { outcome: 'x' } }, master);
    stAssert_(out, P + 'the profile save writes only what passed: a new clients row keyed to the client when none exists, ' +
                   'else that row by id; an archived client is not edited',
              s1.status === 422 && s2.status === 200 && made.length === 1 && made[0][0] === 'clients' &&
              made[0][1].id === 'CLI_kay_test' && made[0][1].client_key === 'kay_test' && made[0][1].outcome === 'Work' &&
              s3.status === 200 && patched.length === 1 && patched[0][1].id === 'CLI_kay_test' &&
              Object.keys(patched[0][1]).sort().join() === 'id,workshop_phone' && s4.status === 409 &&
              s2.data.saved === true, JSON.stringify([s1, s2, s3, s4, made, patched]));

    // ---- the appointment pencil ----
    var routed = [];
    estateRoute_ = function (res, action, payload) {
      routed.push([res, action, payload]);
      return { status: 200, data: { id: payload.id, client_name: payload.witness, appointment_date: payload.appointment_date,
                                    wheelchair_van_required: payload.wheelchair_van_required } };
    };
    var a1 = HUB_ACTIONS.clientProfileApptSave({ client: 'kay_test', id: 'r5', witness: 'Kay  Test',
                                                 fields: { date: '2026-10-01', van: true } }, master);
    var aBad = [HUB_ACTIONS.clientProfileApptSave({ client: 'kay_test', id: '5', witness: 'Kay Test', fields: { date: 'x' } }, master),
                HUB_ACTIONS.clientProfileApptSave({ client: 'kay_test', id: 'r5', witness: 'Lee Other', fields: { date: 'x' } }, master),
                HUB_ACTIONS.clientProfileApptSave({ client: 'kay_test', id: 'r5', witness: 'Kay Test', fields: { status: 'x' } }, master)]
      .map(function (r) { return r.status; });
    stAssert_(out, P + 'the appointment save is the estate\'s header-bound update of drVisits with the client\'s name as ' +
                   'witness; a bad row id is 400, another client\'s row 409, an unknown field 422; nothing else is routed',
              a1.status === 200 && routed.length === 1 && routed[0][0] === 'drVisits' && routed[0][1] === 'update' &&
              routed[0][2].appointment_date === '2026-10-01' && routed[0][2].wheelchair_van_required === 'Yes' &&
              a1.data.row.date === '2026-10-01' && aBad.join() === '400,409,422', JSON.stringify([a1, aBad, routed]));
    hubClientIdentity_ = function (k) {
      var id = { key: k, names: {} };
      id.names[k] = true;
      if (k === 'kay_test') id.names.kaytest = id.names.kaylynntest = true;
      return id;
    };
    var aAlias = HUB_ACTIONS.clientProfileApptSave({ client: 'kay_test', id: 'r5', witness: 'Kay-Lynn Test',
                                                     fields: { time: '11:00' } }, master);
    var aStranger = HUB_ACTIONS.clientProfileApptSave({ client: 'kay_test', id: 'r5', witness: 'Kay Lynn Other',
                                                        fields: { time: '11:00' } }, master);
    hubClientIdentity_ = keep.identity;
    stAssert_(out, P + 'the appointment save accepts a witness spelled by any name the client is known by (the rule the ' +
                   'appointments read matches rows with), and still refuses a name that is not the client\'s',
              aAlias.status === 200 && routed.length === 2 && routed[1][2].witness === 'Kay-Lynn Test' &&
              aStranger.status === 409, JSON.stringify([aAlias, aStranger]));

    // ---- read the plans ----
    ispIntakeFiles_ = function () { return [{ id: 'PlanFile12345', name: 'Kay Test ISP.pdf' }]; };
    ispIntakeDecode_ = function () { return { status: 200, data: { raw_text: ST_CP_PLAN } }; };
    grids[CP_SECTIONS_TAB] = stLocSheet_([CP_SECTIONS_HEADER.slice()]);
    var run1 = HUB_ACTIONS.clientProfileIspSections({}, master);
    var run2 = HUB_ACTIONS.clientProfileIspSections({}, master);
    tables.isps[0].source_file = 'Moved.pdf';
    var run3 = HUB_ACTIONS.clientProfileIspSections({ client: 'kay_test' }, master);
    stAssert_(out, P + 'Read the plans: one plan per run, the next one with no sections; nothing left says so; a plan ' +
                   'whose file left the folder is 404',
              run1.status === 200 && run1.data.client_key === 'kay_test' && run1.data.rows === 3 && run1.data.pending === 0 &&
              run2.status === 200 && run2.data.filed === '' && run3.status === 404, JSON.stringify([run1, run2, run3]));
    stAssert_(out, P + 'the plan intake files every new plan\'s sections right after its isps row',
              stCode_(ispIntakeOnce_).indexOf('clientProfileIspSectionsFrom_(') > stCode_(ispIntakeOnce_).indexOf('createRow_(ISP_INTAKE_TAB'),
              'IspIntake.gs ispIntakeOnce_');
    var cc = [];
    createRow_ = function (res, rec) { cc.push(rec); return rec; };
    tables.clients = [];
    HUB_ACTIONS.clientCreate({ name: 'Zed Test', houseName: 'ABD1305', clientNumber: '77' }, master);
    stAssert_(out, P + 'Add client files the house and the client number under the columns Locations and the profile read',
              cc.length === 1 && cc[0].house === 'ABD1305' && cc[0].client_number === '77' && cc[0].houseName === 'ABD1305',
              JSON.stringify(cc));

    // ---- no answer carries an SSN or a card number ----
    var runs = [];
    answers.forEach(function (pair) {
      var text = JSON.stringify(pair[1]);
      if (/(^|\D)\d{9}(\D|$)/.test(text) || /(^|\D)\d{13,19}(\D|$)/.test(text) ||
          /(^|\D)\d{3}-\d{2}-\d{4}(\D|$)/.test(text)) runs.push(pair[0]);
    });
    stAssert_(out, P + 'no answer of any read carries a 9-digit or 13-19-digit run or an SSN shape',
              answers.length >= 13 && runs.length === 0, 'answers=' + answers.length + ' with runs: ' + runs.join(', '));

    // ---- the cache ----
    clientProfilesCached_ = keep.cached;
    var calls = 0, key = 'st_' + Date.now();
    clientProfilesCached_('clientProfileActivity', key, 'all', [], function () { calls++; return { degraded: true }; });
    clientProfilesCached_('clientProfileActivity', key + 'b', 'all', [], function () { calls++; return { degraded: false }; });
    clientProfilesCached_('clientProfileActivity', key + 'b', 'all', [], function () { calls++; return { degraded: false }; });
    stAssert_(out, P + 'a read is kept per client under cp_<action>_<client_key>; a degraded one retires its own scope',
              calls === 2 && keep.cached === clientProfilesCached_, 'producer calls=' + calls);

    // ---- no delete anywhere, logs name the client key only ----
    var fns = Object.keys(g).filter(function (k) { return /^(cp[A-Z]|clientProfile)/.test(k) && typeof g[k] === 'function'; });
    var deleting = [];
    fns.map(function (k) { return [k, g[k]]; }).concat(CP_ACTIONS.map(function (a) { return [a, HUB_ACTIONS[a]]; }))
      .forEach(function (pair) {
        var code = stCode_(pair[1]);
        // the status move takes a book row out only after its copy is appended to the other tab
        if (pair[0] === 'cpBookMove_' && code.indexOf('appendRow(') !== -1 &&
            code.indexOf('appendRow(') < code.indexOf('deleteRow(') && !/deleteRows\(|deleteSheet|clear/.test(code)) return;
        if (/deleteRows?\(|deleteRowById_|deleteSheet|clearContents?\(|\.clear\(|['"]delete['"]|api\.delete|setTrashed/.test(code)) deleting.push(pair[0]);
      });
    stAssert_(out, P + 'no Clients code path deletes a row, a tab, a record or a file (the status move appends before it takes the row out)',
              fns.length >= 40 && deleting.length === 0, 'functions=' + fns.length + ' deleting=' + deleting.join());
    var mine = logged.filter(function (l) { return /^clientProfile/.test(l); });
    stAssert_(out, P + 'writes log the client key and nothing else',
              mine.length === 7 && mine.every(function (l) { return /^clientProfile\w+:kay_test$/.test(l); }),
              logged.join(' | '));
    var refusals = [
      HUB_ACTIONS.clientProfileIncidentStatus({ client: 'kay_test', incident_ts: '2026-09-10T14:00:00.000Z', client_name: 'Lee Other', status: 'Closed' }, master),
      HUB_ACTIONS.clientProfileIncidentStatus({ client: 'kay_test', incident_ts: '2026-09-11T14:00:00.000Z', client_name: 'Kay Test', status: 'Closed' }, master),
      HUB_ACTIONS.clientProfileApptSave({ client: 'kay_test', id: 'r5', witness: 'Lee Other', fields: { date: 'x' } }, master),
      HUB_ACTIONS.clientProfileSave({ client: 'archiveone', fields: { outcome: 'x' } }, master),
      HUB_ACTIONS.clientProfileIspSections({ client: 'kay_test' }, master)
    ];
    tables.isps = [];
    refusals.push(HUB_ACTIONS.clientProfileIspSections({ client: 'kay_test' }, master));
    var named = refusals.filter(function (r) { return /kay|archive one|\.pdf/i.test(String(r.message || '')); });
    stAssert_(out, P + 'a refusal\'s message (written to the system log) names no client and no plan file',
              refusals.map(function (r) { return r.status; }).join() === '409,404,409,409,404,404' && named.length === 0,
              JSON.stringify(refusals));

    // ---- the record edit (clientProfileSave changes) ----
    var editKeep = { cached: clientProfilesCached_, homes: locationsHomes_, create: createRow_, update: updateRowById_,
                     clients: tables.clients };
    clientProfilesCached_ = function (a, k, part, deps, producer) { return cpScrub_(producer()); };
    locationsHomes_ = function () {
      return [{ code: 'ZZ9999', home_name: 'ZZ - Test House' }, { code: 'QQ1000', home_name: 'QQ - Other House' }];
    };
    var masterGrid = [['Client', 'House', 'Status'], ['Kay  Test', 'ZZ9999', 'Active'], ['Lee Other', 'QQ1000', 'Active'],
                      ['Lee Other', 'QQ1000', 'Active']];
    cpMasterSheet_ = function () { return stLocSheet_(masterGrid); };
    tables.clients = [{ id: 'CLI_kay_test', client_key: 'kay_test', name: 'Kay Test' }];
    var edited = [];
    updateRowById_ = function (res, rec) { edited.push([res, rec]); return rec; };
    createRow_ = function (res, rec) { edited.push([res, rec]); return rec; };
    logged.length = 0;
    var opened = HUB_ACTIONS.clientProfileDetails({ client: 'kay_test' }, master).data;
    var oe = opened.edit || {};
    var notMaster = HUB_ACTIONS.clientProfileSave({ client: 'kay_test',
      changes: [{ field: 'outcome', value: 'Work', expected: oe.outcome }] }, { email: 'mgr@example.org', role: 'manager' });
    var eStale = HUB_ACTIONS.clientProfileSave({ client: 'kay_test',
      changes: [{ field: 'outcome', value: 'Work', expected: 'Day program' }] }, master);
    stAssert_(out, P + 'edit: the panel opens on the profile\'s own pick (the Master\'s outcome, the Hub\'s house) with the ' +
                   'houses Locations lists; a non-master gets the app\'s 404 and a stale expected is 409 with what the ' +
                   'record holds now, nothing written',
              oe.outcome === 'Community living' && oe.house === 'ZZ9999' && oe.guardian_name === 'Gail Guard' &&
              opened.houses.length === 2 && shape(notMaster) && eStale.status === 409 &&
              eStale.data.current.outcome === 'Community living' && eStale.data.written.length === 0 && edited.length === 0,
              JSON.stringify([oe, notMaster, eStale, edited]));
    var eLocked = HUB_ACTIONS.clientProfileSave({ client: 'kay_test',
      changes: ['ssn', 'tl_card', 'dc_exp', 'dc_security_code', 'dc_pin', 'name', 'status', 'favorite'].map(function (f) {
        return { field: f, value: '1', expected: '' };
      }) }, master);
    var whyOf = {};
    ((eLocked.data && eLocked.data.refused) || []).forEach(function (r) { whyOf[r.field] = r.why; });
    stAssert_(out, P + 'edit: SSN, TL card, DC and PIN are refused as protected, the name and the status each with its ' +
                   'reason, an unknown field as not this app\'s; nothing is written',
              eLocked.status === 200 && eLocked.data.written.length === 0 && edited.length === 0 &&
              ['ssn', 'tl_card', 'dc_exp', 'dc_security_code', 'dc_pin'].every(function (f) { return whyOf[f] === CP_EDIT_PROTECTED; }) &&
              whyOf.name === CP_EDIT_LOCKED.name && whyOf.status === CP_EDIT_LOCKED.status && /Not a field/.test(whyOf.favorite),
              JSON.stringify(eLocked));
    var eOk = HUB_ACTIONS.clientProfileSave({ client: 'kay_test', changes: [
      { field: 'outcome', value: '', expected: oe.outcome }, { field: 'house', value: 'qq1000', expected: oe.house },
      { field: 'initials', value: 'KAT', expected: oe.initials }, { field: 'isp_signed_date', value: '2026-01-15', expected: oe.isp_signed_date }
    ] }, master);
    var line = logged.filter(function (l) { return /^clientProfileSave:/.test(l); });
    stAssert_(out, P + 'edit: the written fields land on the Hub row, a cleared one named in cleared_fields; the house is ' +
                   'written through to the Master row the name matches; the log names the fields and no value',
              eOk.status === 200 && eOk.data.written.join() === 'outcome,house,initials,isp_signed_date' &&
              edited.length === 1 && edited[0][1].id === 'CLI_kay_test' && edited[0][1].outcome === '' &&
              edited[0][1].house === 'QQ1000' && edited[0][1].initials === 'KAT' && edited[0][1].cleared_fields === 'outcome' &&
              masterGrid[1][1] === 'QQ1000' && masterGrid[2][1] === 'QQ1000' &&
              line.join() === 'clientProfileSave:kay_test: outcome, house, initials, isp_signed_date',
              JSON.stringify([eOk, edited, masterGrid, logged]));
    var eTwin = HUB_ACTIONS.clientProfileSave({ client: 'lee_other',
      changes: [{ field: 'house', value: 'ZZ9999', expected: 'QQ1000' }] }, master);
    var eNowhere = HUB_ACTIONS.clientProfileSave({ client: 'kay_test',
      changes: [{ field: 'house', value: 'AB1234', expected: oe.house }] }, master);
    stAssert_(out, P + 'edit: a house two Master rows carry the name of is refused and nothing moves; a house Locations does ' +
                   'not list is refused',
              eTwin.status === 200 && eTwin.data.written.length === 0 && /Two rows/.test(eTwin.data.refused[0].why) &&
              masterGrid[2][1] === 'QQ1000' && masterGrid[3][1] === 'QQ1000' && edited.length === 1 &&
              eNowhere.data.refused.length === 1 && /registry/.test(eNowhere.data.refused[0].why),
              JSON.stringify([eTwin, eNowhere, masterGrid]));
    derived[0].cleared_fields = 'outcome,house';
    var cleared = HUB_ACTIONS.clientProfileDetails({ client: 'kay_test' }, master).data;
    delete derived[0].cleared_fields;
    tables.isps = [];
    tables.clients = [{ id: 'CLI_kay_test', client_key: 'kay_test', name: 'Kay Test', house: '', houseName: 'ZZ9999',
                        outcome: '', cleared_fields: 'house' }];
    var derivedNow = keep.derived(null).filter(function (c) { return c.client_key === 'kay_test'; })[0] || {};
    stAssert_(out, P + 'edit: a cleared field stays blank — the profile no longer falls back to the Master\'s outcome, and ' +
                   'the roster derivation blanks the cleared house with its companion column',
              cleared.services.outcome === '' && cleared.edit.outcome === '' && cleared.home.house_code === '' &&
              cleared.financial.payee_rep === 'Pat Payee' && derivedNow.house === '' && derivedNow.houseName === '' &&
              derivedNow.cleared_fields === 'house', JSON.stringify([cleared.services, cleared.home, derivedNow]));

    // ---- the medication edit (emarMedUpdate) ----
    grids.medications = stLocSheet_([
      ['Id - Auto', 'Client', 'PrescriptionName', 'Dosage', 'MedType', 'PRN', 'AdministrationTimes', 'Discountinued'],
      ['7', 'Kay Test', 'Med A', '5 mg', 'Tablet', 'Daily', '"0800" "2000"', ''],
      ['9', 'Lee Other', 'Med C', '', '', '', '', '']]);
    var medRows = HUB_ACTIONS.clientProfileMeds({ client: 'kay_test' }, master).data.rows;
    var medOpen = (medRows.filter(function (r) { return r.id === '7'; })[0] || {}).edit || {};
    var mNot = HUB_ACTIONS.emarMedUpdate({ client: 'kay_test', id: '7',
      changes: [{ field: 'dose', value: '10 mg', expected: medOpen.dose }] }, { email: 'mgr@example.org', role: 'manager' });
    var mStale = HUB_ACTIONS.emarMedUpdate({ client: 'kay_test', id: '7',
      changes: [{ field: 'dose', value: '10 mg', expected: '1 mg' }] }, master);
    var mOther = HUB_ACTIONS.emarMedUpdate({ client: 'kay_test', id: '9',
      changes: [{ field: 'dose', value: '10 mg', expected: '' }] }, master);
    var mOk = HUB_ACTIONS.emarMedUpdate({ client: 'kay_test', id: '7', changes: [
      { field: 'dose', value: '10 mg', expected: medOpen.dose }, { field: 'times', value: '09:00 21:00', expected: medOpen.times },
      { field: 'discontinued', value: 'Yes', expected: medOpen.discontinued }, { field: 'ssn', value: '1', expected: '' }] }, master);
    var mg = grids.medications.grid;
    var mLine = logged.filter(function (l) { return /^emarMedUpdate:/.test(l); });
    stAssert_(out, P + 'medication edit: the chart row opens with its cells (times as HH:MM); a non-master gets the 404, a ' +
                   'stale cell 409 with what it holds, another client\'s row 409; the changed cells are written by the ' +
                   'row\'s Id - Auto, an unknown field refused, and the log names the fields only',
              medOpen.dose === '5 mg' && medOpen.times === '08:00 20:00' && medOpen.discontinued === '' && shape(mNot) &&
              mStale.status === 409 && mStale.data.current.dose === '5 mg' && mOther.status === 409 &&
              mOk.status === 200 && mOk.data.written.join() === 'dose,times,discontinued' && mOk.data.refused.length === 1 &&
              mg[1][3] === '10 mg' && mg[1][6] === '"0900" "2100"' && mg[1][7] === 'Yes' && mg[2][3] === '' &&
              mLine.join() === 'emarMedUpdate:kay_test #7: dose, times, discontinued' &&
              HUB_POLICY.emarMedUpdate.file === 'Meds.gs' && HUB_POLICY.emarMedUpdate.roles.join() === 'admin,manager,staff',
              JSON.stringify([medOpen, mNot, mStale, mOther, mOk, mg, mLine]));
    clientProfilesCached_ = editKeep.cached;
    locationsHomes_ = editKeep.homes;
    createRow_ = editKeep.create;
    updateRowById_ = editKeep.update;
    tables.clients = editKeep.clients;
    cpMasterSheet_ = keep.masterSheet;

    // ---- the Hub's corrections to the plan's family and care rows (clientProfileOverride) ----
    var p2Keep = { ensure: hubTabEnsure_, book: cpBookSheet_, create: createRow_, update: updateRowById_, clients: tables.clients, isps: tables.isps };
    tables.isps = [{ client_key: 'kay_test', client_name: 'Kay Test', isp_year: '2026', personal_care: 'Needs prompts to brush teeth.',
                     contact_block: ST_CP_PLAN_PEOPLE }];
    var mgr = { email: 'mgr@example.org', role: 'manager' };
    var uuidKeep = Utilities.getUuid, uuidN = 0;
    Utilities.getUuid = function () { return 'st-uuid-' + (++uuidN); };
    hubTabEnsure_ = function (tab, header) {
      if (!grids[tab]) grids[tab] = stLocSheet_([header.slice()]);
      return grids[tab];
    };
    delete grids[CP_OVERRIDES_TAB];
    logged.length = 0;
    var fam0 = HUB_ACTIONS.clientProfileDetails({ client: 'kay_test' }, master).data.family;
    var sam = fam0.filter(function (f) { return f.name === 'Sam Support'; })[0] || { edit: {} };
    var gail = fam0.filter(function (f) { return f.name === 'Gail Guard'; })[0] || { edit: {} };
    var ov = function (p, u) { return HUB_ACTIONS.clientProfileOverride(p, u || master); };
    var oNot = ov({ client: 'kay_test', kind: 'family', target: sam.key,
                    changes: [{ field: 'relationship', value: 'SSA', expected: sam.edit.relationship }] }, mgr);
    var oStale = ov({ client: 'kay_test', kind: 'family', target: sam.key,
                      changes: [{ field: 'relationship', value: 'SSA', expected: 'Nobody' }] });
    var oSam = ov({ client: 'kay_test', kind: 'family', target: sam.key,
                    changes: [{ field: 'relationship', value: 'SSA', expected: sam.edit.relationship }] });
    var oNew = ov({ client: 'kay_test', kind: 'family', target: '', changes: [{ field: 'name', value: 'Nia Neighbor', expected: '' },
                  { field: 'relationship', value: 'Friend', expected: '' }] });
    var oGone = ov({ client: 'kay_test', kind: 'family', target: gail.key,
                     changes: [{ field: 'removed', value: 'Yes', expected: '' }] });
    var oNameless = ov({ client: 'kay_test', kind: 'family', target: '', changes: [{ field: 'phone', value: '1', expected: '' }] });
    var fam1 = HUB_ACTIONS.clientProfileDetails({ client: 'kay_test' }, master).data.family;
    var care0 = HUB_ACTIONS.clientProfileCare({ client: 'kay_test', tab: 'daily' }, master).data.rows;
    var pc = care0.filter(function (r) { return r.edit && /personal_care/.test(r.id); })[0] || {};
    var oCare = ov({ client: 'kay_test', kind: 'care', tab: 'daily', target: pc.id,
                     changes: [{ field: 'text', value: 'Brushes with one reminder.', expected: pc.text }] });
    var oPlans = ov({ client: 'kay_test', kind: 'care', tab: 'plans', target: '', changes: [{ field: 'record', value: 'x', expected: '' }] });
    var care1 = HUB_ACTIONS.clientProfileCare({ client: 'kay_test', tab: 'daily' }, master).data.rows;
    var pc1 = care1.filter(function (r) { return r.id === pc.id; })[0] || {};
    var oLines = logged.filter(function (l) { return /^clientProfileOverride:/.test(l); });
    stAssert_(out, P + 'overrides: a family member or care row is corrected, added or hidden in client_overrides (made on ' +
                   'the first write) and the readers lay it over the plan; a non-master gets the 404, a stale field 409, a ' +
                   'nameless member and a plans row are refused; the log names fields only',
              shape(oNot) && oStale.status === 409 && oSam.status === 200 && oNew.status === 200 && oGone.status === 200 &&
              oNameless.data.written.length === 0 && oPlans.status === 400 && oCare.status === 200 &&
              fam1.map(function (f) { return f.name + ':' + f.relationship; }).join() === 'Sam Support:SSA,Nia Neighbor:Friend' &&
              grids[CP_OVERRIDES_TAB].grid.length === 5 && pc1.text === 'Brushes with one reminder.' &&
              pc1.source === 'Edited in the Hub' && oLines.length === 4 &&
              oLines.every(function (l) { return /^clientProfileOverride:CO_kay_test_(family|care)_\w+: [a-z, ]+$/.test(l); }),
              JSON.stringify([oNot, oStale, oNameless, oPlans, fam1, pc1, oLines]));

    // ---- the rename (clientProfileRename) ----
    var renMaster = [['Client', 'House'], ['Kay  Test', 'ZZ9999'], ['Lee Other', 'QQ1000']];
    cpMasterSheet_ = function () { return stLocSheet_(renMaster); };
    grids.clients = stLocSheet_([['id', 'client_key', 'name'], ['CLI_kay_test', 'kay_test', 'Kay Test'],
                                 ['CLI_lee_other', 'lee_other', 'Lee Other']]);
    grids.isps = stLocSheet_([['id', 'client_key', 'client_name'], ['ISP_kay_test', 'kay_test', 'Kay Test']]);
    grids.photos = stLocSheet_([['title', 'kind'], ['Kay Test', 'avatar'], ['Kay Test', 'document']]);
    var rn = function (value, expected, u) {
      return HUB_ACTIONS.clientProfileRename({ client: 'kay_test', changes: [{ field: 'name', value: value, expected: expected }] }, u || master);
    };
    var renBooks = {
      'Dr Appointments › Dr Appt Archive': [['Timestamp', 'Client Name', 'Dr Name'], ['t1', 'Kay Test', 'Dr A'], ['t2', 'Lee Other', 'Dr B']],
      'Missing Medications › Form Responses 4': [['Timestamp', 'Select Client:', 'Kay Test: Medications'], ['t1', 'Test, Kay', 'Med A']],
      'Van Calendar › Conflicts': [['Date', 'Clients in Conflict'], ['2026-01-02', 'Lee Other; Kay Test']]
    };
    var renBroken = '';
    cpRenameBookSheet_ = function (spec) {
      if (spec.book === renBroken) throw new Error('the book could not be opened');
      if (spec.master) return { sheet: cpMasterSheet_(), id: '', tab: CP_MASTER_TAB };
      return { sheet: stLocSheet_(renBooks[spec.book] || [['Client']]), id: '', tab: spec.tab || '' };
    };
    grids.mar_entries = stLocSheet_([['id', 'client', 'client_key'], ['p1', 'Kay Test', ''], ['p2', 'Kay Test', 'lee_other']]);
    var rNot = rn('Kay Newname', 'Kay Test', mgr), rStale = rn('Kay Newname', 'Kay Other'), rClash = rn('Lee Other', 'Kay Test');
    var rBad = rn('Kay', 'Kay Test');
    renBroken = 'UIs and MUIs';
    var rCannot = rn('Kay Newname', 'Kay Test');
    var cannotUntouched = renMaster[1][0] === 'Kay  Test' && grids.medications.grid[1][1] === 'Kay Test' &&
                          renBooks['Dr Appointments › Dr Appt Archive'][1][1] === 'Kay Test';
    renBroken = '';
    var rOk = rn('Kay Newname', 'Kay Test');
    stAssert_(out, P + 'rename: a book that cannot be opened refuses the whole rename and is named, nothing written; ' +
                   'otherwise the eMAR, the pass log (rows of this client\'s key or none), the Dr Appt Archive, the ' +
                   'refill form\'s client cell ("Last, First") and its medication column, and a conflict list follow',
              rCannot.status === 409 && /^UIs and MUIs \(/.test((rCannot.data.cannot_follow || [])[0] || '') && cannotUntouched &&
              rOk.status === 200 && grids.medications.grid[1][1] === 'Kay Newname' && grids.medications.grid[2][1] === 'Lee Other' &&
              grids.mar_entries.grid[1][1] === 'Kay Newname' && grids.mar_entries.grid[2][1] === 'Kay Test' &&
              renBooks['Dr Appointments › Dr Appt Archive'][1][1] === 'Kay Newname' &&
              renBooks['Dr Appointments › Dr Appt Archive'][2][1] === 'Lee Other' &&
              renBooks['Missing Medications › Form Responses 4'][0][2] === 'Kay Newname: Medications' &&
              renBooks['Missing Medications › Form Responses 4'][1][1] === 'Newname, Kay' &&
              renBooks['Van Calendar › Conflicts'][1][1] === 'Lee Other; Kay Newname' &&
              rOk.data.moved['the medications tab'] === 1 && rOk.data.moved['Dr Appointments › Dr Appt Archive'] === 1,
              JSON.stringify([rCannot, rOk.data && rOk.data.moved, renBooks, grids.medications.grid, grids.mar_entries.grid]));
    var ovRow = grids[CP_OVERRIDES_TAB].grid.filter(function (r) { return r[3] === 'daily'; })[0] || [];
    stAssert_(out, P + 'rename: the Master row the old name matches, the Hub clients and plan rows, the avatar and the ' +
                   'overrides move to the new name and key under one lock; a non-master gets the 404, a stale name 409, a ' +
                   'name another client carries 409, a single word 400; the answer carries the new key',
              shape(rNot) && rStale.status === 409 && rClash.status === 409 && rBad.status === 400 && rOk.status === 200 &&
              rOk.data.client_key === 'kay_newname' && rOk.data.written.join() === 'name' &&
              renMaster[1][0] === 'Kay Newname' && renMaster[2][0] === 'Lee Other' &&
              grids.clients.grid[1].join() === 'CLI_kay_test,kay_newname,Kay Newname' && grids.clients.grid[2][1] === 'lee_other' &&
              grids.isps.grid[1].join() === 'ISP_kay_test,kay_newname,Kay Newname' &&
              grids.photos.grid[1][0] === 'Kay Newname' && grids.photos.grid[2][0] === 'Kay Test' &&
              ovRow[1] === 'kay_newname' && ovRow[4] === pc.id.replace('isp_kay_test_', 'isp_kay_newname_') &&
              logged.indexOf('clientProfileRename:kay_test → kay_newname: name') !== -1,
              JSON.stringify([rNot, rStale, rClash, rBad, rOk, renMaster, grids.clients.grid, ovRow]));

    // ---- the status (clientProfileStatus) ----
    var stMaster = [['Client', 'House', 'Status'], ['Kay  Test', 'ZZ9999', 'Active']];
    var stArch = [['Customer', 'House', 'Status'], ['Archive One', 'QQ1000', 'Discharged']];
    var bookOf = function (grid) {
      var s = stLocSheet_(grid);
      s.deleteRow = function (r) { grid.splice(r - 1, 1); };
      return s;
    };
    cpBookSheet_ = function (tab) { return bookOf(tab === CP_MASTER_TAB ? stMaster : stArch); };
    var hubRows = [];
    tables.clients = [{ id: 'CLI_kay_test', client_key: 'kay_test', name: 'Kay Test' }];
    updateRowById_ = function (res, rec) { hubRows.push(['update', rec]); return rec; };
    createRow_ = function (res, rec) { hubRows.push(['create', rec]); return rec; };
    var st = function (client, value, expected, u) {
      return HUB_ACTIONS.clientProfileStatus({ client: client, changes: [{ field: 'status', value: value, expected: expected }] }, u || master);
    };
    var sNot = st('kay_test', 'Inactive', 'Active', mgr), sStale = st('kay_test', 'Inactive', 'Inactive');
    var sOff = st('kay_test', 'Inactive', 'Active');
    var sBack = st('archiveone', 'Active', 'Inactive');
    stAssert_(out, P + 'status: Inactive moves the Master row to the archive of old clients (Client lands under Customer) ' +
                   'and marks the Hub row inactive; Active moves an archived client back and makes its Hub row; a ' +
                   'non-master gets the 404 and a stale status 409',
              shape(sNot) && sStale.status === 409 && sOff.status === 200 && sBack.status === 200 &&
              stMaster.length === 2 && stMaster[1].join() === 'Archive One,QQ1000,Discharged' &&
              stArch.length === 2 && stArch[1].join() === 'Kay  Test,ZZ9999,Active' &&
              hubRows.length === 2 && hubRows[0][0] === 'update' && hubRows[0][1].status === 'inactive' &&
              hubRows[1][0] === 'create' && hubRows[1][1].client_key === 'archiveone' && hubRows[1][1].status === 'active' &&
              logged.indexOf('clientProfileStatus:kay_test: status "Active" → "Inactive"') !== -1,
              JSON.stringify([sNot, sStale, sOff, sBack, stMaster, stArch, hubRows]));
    hubTabEnsure_ = p2Keep.ensure;
    cpBookSheet_ = p2Keep.book;
    createRow_ = p2Keep.create;
    updateRowById_ = p2Keep.update;
    tables.clients = p2Keep.clients;
    tables.isps = p2Keep.isps;
    Utilities.getUuid = uuidKeep;
    cpMasterSheet_ = keep.masterSheet;
    cpRenameBookSheet_ = keep.renameBook;
    delete grids.mar_entries;
    delete grids.clients;
    delete grids.isps;
    delete grids.photos;

    // ---- the digest pass files the plans no screen asked for ----
    var TRIES = CP_ISP_SWEEP_TRIES_PROP, HOUR = 3600000;
    var propStore = {}, propWrites = 0;
    hubProp_ = function (k) { return k === TRIES ? (propStore[k] || '') : keep.prop(k); };
    hubPropSet_ = function (k, v) {
      if (k !== TRIES) throw new Error('st: no other property ' + k);
      propWrites++;
      propStore[k] = String(v);
      return true;
    };
    var marks = function () { return JSON.parse(propStore[TRIES] || '{}'); };
    var decoded = [], listed = 0, deltaReads = false, folderEmpty = false;
    ispIntakeFiles_ = function () {
      listed++;
      if (folderEmpty) return [];
      return ['Ann Alpha ISP.pdf', 'Bea Beta ISP.pdf', 'Di Delta ISP.pdf', 'Eve Epsilon ISP.pdf', 'Fay Phi ISP.pdf',
              'Gil Omega ISP.pdf'].map(function (n, i) { return { id: 'SweepFile' + i, name: n }; });
    };
    ispIntakeDecode_ = function (f) {
      decoded.push(f.name);
      if (/Delta/.test(f.name) && !deltaReads) return { status: 502, message: 'st: the relay timed out' };
      return { status: 200, data: { raw_text: ST_CP_PLAN } };
    };
    tables.isps = [
      { client_key: 'gil_omega', client_name: 'Gil Omega', isp_year: '2026', source_file: 'Gil Omega ISP.pdf' },
      { client_key: 'eve_eps', client_name: 'Eve Epsilon', isp_year: '2026', source_file: 'Eve Epsilon ISP.pdf' },
      { client_key: 'cy_gamma', client_name: 'Cy Gamma', isp_year: '2026', source_file: 'Cy Gamma ISP.pdf' },
      { client_key: 'bea_beta', client_name: 'Bea Beta', isp_year: '2026', source_file: 'Bea Beta ISP.pdf' },
      { client_key: 'ann_alpha', client_name: 'Ann Alpha', isp_year: '2026', source_file: 'Ann Alpha ISP.pdf' },
      { client_key: 'di_delta', client_name: 'Di Delta', isp_year: '2026', source_file: 'Di Delta ISP.pdf' },
      { client_key: 'fay_phi', client_name: 'Fay Phi', isp_year: '2026', source_file: 'Fay Phi ISP.pdf' },
      { client_key: ' ', client_name: 'Aaron Nokey', isp_year: '2026', source_file: 'Ann Alpha ISP.pdf' }
    ];
    grids[CP_SECTIONS_TAB] = stLocSheet_([CP_SECTIONS_HEADER.slice(),
      ['IS_bea_beta_morning', 'bea_beta', '2026', 'morning', 'Morning', 'Filed already.', 'Bea Beta ISP.pdf', 'x']]);
    var plenty = function () { return 170000; };
    var asks = 0;
    var swFloor = clientIspSectionsSweep_(function () { return CP_ISP_SWEEP_FLOOR_MS - 1; });
    var floorQuiet = decoded.length === 0 && listed === 0 && propWrites === 0;
    var swMid = clientIspSectionsSweep_(function () { asks++; return asks < 3 ? 170000 : 30000; });
    stAssert_(out, P + 'the plan sweep: under the floor it reads nothing; the floor is asked before every plan, so a ' +
                   'pass that runs low mid-way stops after the plan it was filing',
              CP_ISP_SWEEP_FLOOR_MS >= 30000 && swFloor.filed === 0 && swFloor.failed === 0 && floorQuiet &&
              swMid.filed === 1 && swMid.failed === 0 && asks === 3 && decoded.join() === 'Ann Alpha ISP.pdf',
              JSON.stringify([swFloor, swMid, asks, decoded]));
    var swC = clientIspSectionsSweep_(plenty);
    var afterC = marks();
    var nowC = new Date().getTime();
    var swD = clientIspSectionsSweep_(plenty);
    var swE = clientIspSectionsSweep_(plenty);
    var writesBeforeIdle = propWrites, listedBeforeIdle = listed, decodedBeforeIdle = decoded.length;
    var swF = clientIspSectionsSweep_(plenty);
    stAssert_(out, P + 'the plan sweep takes only plans with no sections, by client name, at most two a pass; a plan ' +
                   'already filed and a row with no client key are never read, and a pass with nothing due lists no ' +
                   'folder, reads no plan and writes no property',
              CP_ISP_SWEEP_PER_PASS === 2 &&
              swC.filed === 0 && swC.failed === 2 && swD.filed === 2 && swD.failed === 0 && swD.waiting === 2 &&
              swE.filed === 1 && swE.waiting === 2 && swF.filed === 0 && swF.failed === 0 && swF.waiting === 2 &&
              decoded.join() === 'Ann Alpha ISP.pdf,Di Delta ISP.pdf,Eve Epsilon ISP.pdf,Fay Phi ISP.pdf,Gil Omega ISP.pdf' &&
              propWrites === writesBeforeIdle && listed === listedBeforeIdle && decoded.length === decodedBeforeIdle,
              JSON.stringify([swC, swD, swE, swF, decoded, propWrites, writesBeforeIdle]));
    var cyC = afterC.cy_gamma || {}, diC = afterC.di_delta || {};
    stAssert_(out, P + 'the plan sweep backs off a plan whose file is gone (404) and one the relay could not read ' +
                   '(502) for an hour, in the script property, and says each in the log by client key',
              Object.keys(afterC).sort().join() === 'cy_gamma,di_delta' && cyC.n === 1 && cyC.status === 404 &&
              diC.n === 1 && diC.status === 502 && cyC.next > nowC + HOUR - 60000 && cyC.next <= nowC + HOUR &&
              scriptPropIsRuntime_(TRIES) &&
              logged.filter(function (l) { return /^clientIspSectionsSweep:/.test(l); }).join() ===
                'clientIspSectionsSweep:cy_gamma,clientIspSectionsSweep:di_delta',
              JSON.stringify([afterC, logged.slice(-3)]));
    var dueNow = marks();
    dueNow.cy_gamma.next = 0;
    dueNow.di_delta.next = 0;
    propStore[TRIES] = JSON.stringify(dueNow);
    deltaReads = true;
    var swG = clientIspSectionsSweep_(plenty);
    var afterG = marks(), nowG = new Date().getTime();
    var filedRows = grids[CP_SECTIONS_TAB].grid.slice(1).filter(function (r) { return r.join('') !== ''; });
    var rowsOf = function (k) { return filedRows.filter(function (r) { return r[1] === k; }).length; };
    stAssert_(out, P + 'the plan sweep retries a plan once its wait is over: a second failure waits two hours, a ' +
                   'plan that reads is filed and its mark dropped; a failing plan is never filed',
              swG.filed === 1 && swG.failed === 1 && Object.keys(afterG).join() === 'cy_gamma' &&
              afterG.cy_gamma.n === 2 && afterG.cy_gamma.next > nowG + 2 * HOUR - 60000 &&
              afterG.cy_gamma.next <= nowG + 2 * HOUR && rowsOf('cy_gamma') === 0 && rowsOf('bea_beta') === 1 &&
              ['ann_alpha', 'di_delta', 'eve_eps', 'fay_phi', 'gil_omega'].every(function (k) { return rowsOf(k) === 3; }),
              JSON.stringify([swG, afterG, filedRows.map(function (r) { return r[1]; })]));
    propStore[TRIES] = JSON.stringify({ cy_gamma: { n: 2, next: 0, status: 404 } });
    folderEmpty = true;
    var swH = clientIspSectionsSweep_(plenty);
    var afterH = marks();
    folderEmpty = false;
    propStore[TRIES] = '[1,2]';
    var odd1 = cpIspSweepTries_().map;
    propStore[TRIES] = '{not json';
    var odd2 = cpIspSweepTries_().map;
    stAssert_(out, P + 'a plans folder that lists nothing stops the pass and marks no plan; a property that is not a ' +
                   'map reads as no marks',
              swH.shut === true && swH.failed === 0 && swH.filed === 0 && afterH.cy_gamma.n === 2 &&
              JSON.stringify(odd1) === '{}' && JSON.stringify(odd2) === '{}', JSON.stringify([swH, afterH, odd1, odd2]));
    propStore = {};
    clientProfilesClient_ = function (k) { return { key: k, name: k }; };
    var sweptAnn = filedRows.filter(function (r) { return r[1] === 'ann_alpha'; }).map(function (r) { return r.slice(0, 7).join('|'); });
    var byHand = HUB_ACTIONS.clientProfileIspSections({ client: 'ann_alpha' }, master);
    var handAnn = grids[CP_SECTIONS_TAB].grid.slice(1).filter(function (r) { return r[1] === 'ann_alpha'; })
      .map(function (r) { return r.slice(0, 7).join('|'); });
    var nextByHand = HUB_ACTIONS.clientProfileIspSections({}, master);
    clientProfilesClient_ = keep.client;
    stAssert_(out, P + 'Read the plans answers as before through the same builder: the rows it files for a plan are ' +
                   'the rows the sweep filed; with no client it takes the next plan with no sections, back-off or not',
              byHand.status === 200 && Object.keys(byHand.data).sort().join() ===
                'absent,client_key,filed,isp_year,pending,rows,sections,source_file' &&
              byHand.data.rows === 3 && byHand.data.pending === 1 && byHand.data.source_file === 'Ann Alpha ISP.pdf' &&
              sweptAnn.length === 3 && sweptAnn.join() === handAnn.join() &&
              nextByHand.status === 404 && /not in the plans folder/.test(nextByHand.message),
              JSON.stringify([byHand, nextByHand, sweptAnn, handAnn]));
    var noneText = { 'Aa Empty ISP.pdf': '', 'Ab Scanned ISP.pdf': 'OhioISP - Ab Scanned\nPage 1\nPage 2',
                     'Ann Alpha ISP.pdf': '' };
    decoded = [];
    ispIntakeFiles_ = function () {
      return ['Aa Empty ISP.pdf', 'Ab Scanned ISP.pdf', 'Ann Alpha ISP.pdf', 'Bob Real ISP.pdf']
        .map(function (n, i) { return { id: 'NoneFile' + i, name: n }; });
    };
    ispIntakeDecode_ = function (f) {
      decoded.push(f.name);
      return { status: 200, data: { raw_text: noneText.hasOwnProperty(f.name) ? noneText[f.name] : ST_CP_PLAN } };
    };
    tables.isps = [
      { client_key: 'bob_real', client_name: 'Bob Real', isp_year: '2026', source_file: 'Bob Real ISP.pdf' },
      { client_key: 'ab_scan', client_name: 'Ab Scanned', isp_year: '2026', source_file: 'Ab Scanned ISP.pdf' },
      { client_key: 'ann_alpha', client_name: 'Ann Alpha', isp_year: '2026', source_file: 'Ann Alpha ISP.pdf' },
      { client_key: 'aa_empty', client_name: 'Aa Empty', isp_year: '2026', source_file: 'Aa Empty ISP.pdf' }
    ];
    var swI = clientIspSectionsSweep_(plenty);
    var afterI = marks(), nowI = new Date().getTime();
    var swJ = clientIspSectionsSweep_(plenty);
    var afterJ = marks();
    var liveRows = function (k) {
      return grids[CP_SECTIONS_TAB].grid.slice(1).filter(function (r) { return r[1] === k; });
    };
    var aaI = afterI.aa_empty || {}, abI = afterI.ab_scan || {};
    stAssert_(out, P + 'the plan sweep: a plan that decodes to no text, or to text with none of the sections, files ' +
                   'nothing, is never counted filed, waits out the back-off (422), and the next plan by name is filed ' +
                   'on the following pass',
              swI.filed === 0 && swI.failed === 2 && Object.keys(afterI).sort().join() === 'aa_empty,ab_scan' &&
              aaI.n === 1 && aaI.status === 422 && abI.n === 1 && abI.status === 422 &&
              aaI.next > nowI + HOUR - 60000 && aaI.next <= nowI + HOUR &&
              swJ.filed === 1 && swJ.failed === 0 && swJ.waiting === 2 &&
              Object.keys(afterJ).sort().join() === 'aa_empty,ab_scan' && afterJ.aa_empty.n === 1 &&
              decoded.join() === 'Aa Empty ISP.pdf,Ab Scanned ISP.pdf,Bob Real ISP.pdf' &&
              liveRows('aa_empty').length === 0 && liveRows('ab_scan').length === 0 && liveRows('bob_real').length === 3,
              JSON.stringify([swI, swJ, afterI, afterJ, decoded]));
    clientProfilesClient_ = function (k) { return { key: k, name: k }; };
    var noneByHand = HUB_ACTIONS.clientProfileIspSections({ client: 'ann_alpha' }, master);
    clientProfilesClient_ = keep.client;
    var keptAnn = liveRows('ann_alpha').map(function (r) { return r.slice(0, 7).join('|'); });
    stAssert_(out, P + 'Read the plans on a filed client whose plan now decodes to no section refuses 422 and keeps ' +
                   'the rows filed before',
              noneByHand.status === 422 && /none of the sections/.test(noneByHand.message) &&
              !/ann|alpha|\.pdf/i.test(noneByHand.message) && keptAnn.join() === handAnn.join(),
              JSON.stringify([noneByHand, keptAnn]));
    var actCode = stCode_(HUB_ACTIONS.clientProfileIspSections), sweepCode = stCode_(clientIspSectionsSweep_);
    var digestCode = stCode_(digestSweepMaybe_);
    stAssert_(out, P + 'the action and the sweep share one plan list and one builder (neither decodes on its own); ' +
                   'the sweep asks no session gate, the action still does; the digest pass no longer calls the sweep ' +
                   '(the plans\' sections are read again on Python)',
              /cpIspPlans_\(/.test(actCode) && /cpIspSectionsFile_\(/.test(actCode) && !/ispIntakeDecode_/.test(actCode) &&
              /cpIspPlans_\(/.test(sweepCode) && /cpIspSectionsFile_\(/.test(sweepCode) &&
              !/ispIntakeDecode_|clientProfilesGate_/.test(sweepCode) && /clientProfilesGate_\(user\)/.test(actCode) &&
              digestCode.indexOf('clientIspSectionsSweep_(') === -1, 'digestSweepMaybe_ / clientIspSectionsSweep_');
    hubProp_ = keep.prop;
    hubPropSet_ = keep.propSet;

    // ---- a SheetDb.gs that does not home the new tabs files nothing ----
    var gridEnsure = hubTabEnsure_, ensured = [];
    hubTabEnsure_ = function (tab) { ensured.push(tab); throw new Error('st: the tab would be created'); };
    var olderHome = {};
    Object.keys(keep.tabHome).forEach(function (t) { if (t !== CP_SECTIONS_TAB && t !== CP_REVIEWS_TAB) olderHome[t] = keep.tabHome[t]; });
    HUB_TAB_HOME = olderHome;
    HUB_TAB_BORN_HOME = ['house_notes'];
    var unhomed = [clientProfileIspSectionsFrom_('kay_test', '2026', ST_CP_PLAN, 'plan.pdf').refused,
                   HUB_ACTIONS.clientProfileIncidentStatus({ client: 'kay_test', incident_ts: '2026-09-10T14:00:00.000Z',
                                                             client_name: 'Kay Test', status: 'Closed' }, master)];
    HUB_TAB_HOME = keep.tabHome;
    HUB_TAB_BORN_HOME = keep.bornHome;
    hubTabEnsure_ = gridEnsure;
    stAssert_(out, P + 'with a SheetDb.gs that does not declare isp_sections and incident_reviews born in the Care book, both ' +
                   'writes refuse 503 before any tab is made (never in the Hub DB)',
              ensured.length === 0 && unhomed.every(function (r) { return !!r && r.status === 503 && /no home in the Care book/.test(r.message); }),
              JSON.stringify([unhomed, ensured]));

    // ---- where the new tabs live ----
    var asResource = Object.keys(RESOURCES).filter(function (k) {
      return /^clientProfile/i.test(k) || (RESOURCES[k] && (RESOURCES[k].sheet === CP_SECTIONS_TAB || RESOURCES[k].sheet === CP_REVIEWS_TAB));
    });
    stAssert_(out, P + 'isp_sections and incident_reviews are no generic resource and no slice, and are born in the Care book',
              asResource.length === 0 && HUB_TAB_HOME.isp_sections === 'HUB_CARE_BOOK_ID' &&
              HUB_TAB_HOME.incident_reviews === 'HUB_CARE_BOOK_ID' &&
              HUB_TAB_BORN_HOME.indexOf('isp_sections') !== -1 && HUB_TAB_BORN_HOME.indexOf('incident_reviews') !== -1,
              asResource.join());
  } finally {
    clientProfilesClient_ = keep.client;
    clientsDerived_ = keep.derived;
    cpArchiveIndex_ = keep.archive;
    cpMasterIndex_ = keep.master;
    cpMasterDataIndex_ = keep.masterData;
    cfxUndo();
    clientProfilesCached_ = keep.cached;
    HUB_MASTER_EMAIL_CACHE = keep.masterCache;
    HUB_MEMBER_CTX = keep.member;
    hubSysLog_ = keep.log;
    hubTabEnsure_ = keep.ensure;
    hubTabSheet_ = keep.sheet;
    hubProp_ = keep.prop;
    hubPropSet_ = keep.propSet;
    sheetDbGateHolds_ = keep.holds;
    estateRows_ = keep.estate;
    listRows_ = keep.list;
    createRow_ = keep.create;
    updateRowById_ = keep.update;
    locationsHomes_ = keep.homes;
    clientPhotoIndex_ = keep.photos;
    ispDocFor_ = keep.doc;
    estateRoute_ = keep.route;
    ispIntakeFiles_ = keep.files;
    ispIntakeDecode_ = keep.decode;
    hubClientIdentity_ = keep.identity;
    HUB_TAB_HOME = keep.tabHome;
    HUB_TAB_BORN_HOME = keep.bornHome;
    hubProfileAppRules_ = keep.rules;
    cpMasterSheet_ = keep.masterSheet;
    cpRenameBookSheet_ = keep.renameBook;
    HUB_VIEWER_MEMO = null;
  }
  stClientProfilesViewer_(out);
}

// Clients as App Control releases it: staff on every client, a client, family or an SSA on their own, the office's…
function stClientProfilesViewer_(out) {
  var P = 'client profiles, viewer: ';
  CP_RENAME_HELD = false;
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var DOORS = ['csApptDoor_', 'csTransportDoor_', 'csmDoor_', 'csrDoor_', 'csfFundsDoor_', 'csfBillingDoor_'];
  var keep = {
    gate: hubProfileAppGate_, rules: hubProfileAppRules_, client: clientProfilesClient_, cached: clientProfilesCached_,
    roster: cpRosterBuild_, csmClient: csmClient_, csfClient: csfClient_, scanRoster: csmScanRoster_,
    estate: estateRows_, list: listRows_, own: cpOwnRows_, users: usersAll_, member: HUB_MEMBER_CTX,
    masterCache: HUB_MASTER_EMAIL_CACHE, service: HUB_IS_SERVICE_REQ, doors: {}
  };
  DOORS.forEach(function (d) { keep.doors[d] = g[d]; });
  var j = function (x) { return JSON.stringify(x); };
  var shut = function (r) { return !!r && r.status === 404 && r.message === 'Unknown action.' && Object.keys(r).length === 2; };
  var cfxUndo = stCfxStub_();
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    HUB_MEMBER_CTX = null;
    HUB_IS_SERVICE_REQ = false;
    var RULES = { rules: {}, tenants: {} };
    hubProfileAppRules_ = function () { return RULES; };
    // a client, family or an SSA as ViewerScope.gs scopes them (stViewerScope_ proves the scopes themselves)
    var SCOPES = {
      'u-cl9': { kind: 'client', client_keys: ['kay9'], house_codes: ['ZZ9999'], ssa_keys: [], family_keys: [], why: '' },
      'u-fa9': { kind: 'guardian', client_keys: ['kay9'], house_codes: ['ZZ9999'], ssa_keys: [], family_keys: [], why: '' },
      'u-ss9': { kind: 'ssa', client_keys: ['kay9', 'lee9'], house_codes: ['ZZ9999'], ssa_keys: ['ssa_x'], family_keys: [],
                 why: '' },
      'u-no9': { kind: 'ssa', client_keys: [], house_codes: [], ssa_keys: [], family_keys: [], why: '' },
      'u-odd': { kind: 'house', client_keys: ['kay9'], house_codes: [], ssa_keys: [], family_keys: [], why: '' }
    };
    var gateAsks = [];
    hubProfileAppGate_ = function (app, u) {
      gateAsks.push(app);
      var s = u && !u.visiting_member && SCOPES[u.id];
      return s ? { open: true, scope: s } : keep.gate(app, u);
    };
    var who = function (id, role, types) { return { id: id, email: id + '@example.org', role: role, types: types }; };
    var master = { email: HUB_MASTER_ACCOUNT, role: 'admin' };
    var staff = who('u-st9', 'staff', ['STAFF']);
    var client = who('u-cl9', 'client', ['CLIENT']);
    var family = who('u-fa9', 'client', ['GUARDIAN']);
    var ssa = who('u-ss9', 'staff', ['GUARDIAN']);
    var nobody = who('u-no9', 'staff', ['GUARDIAN']);
    var odd = who('u-odd', 'staff', ['GUARDIAN']);

    // every door answers a marker past its gate; nothing is read
    var asked = 0;
    var refuse = function () { asked++; return { refused: { status: 418, message: 'st: the client was asked' } }; };
    clientProfilesClient_ = refuse;
    csmClient_ = refuse;
    csfClient_ = refuse;
    csmScanRoster_ = function () { asked++; throw new Error('st: the scan was reached'); };
    var TRANSPORT = { client: { client_key: 'kay9' },
                      tabs: { calendar: { rows: [{ id: 't1' }] }, history: { rows: [{ id: 't1' }] },
                              vehicles: { rows: [{ id: 'v1' }] }, mileage: { rows: [{ id: 'm1', employee: 'Sam9 Shift' }] } },
                      sources: [{ id: 'van_requests' }, { id: 'fleet' }, { id: 'repairs' }, { id: 'psi_punches' },
                                { id: 'dr_visits' }] };
    var MAR = { client: { client_key: 'kay9' },
                tabs: { papers: { rows: [{ id: 'p1' }] }, passes: { rows: [{ id: 's1' }] },
                        errors: { rows: [{ id: 'e1' }], why: 'st: the audit is partly read' } }, degraded: true };
    DOORS.forEach(function (d) {
      g[d] = function (ask) {
        asked++;
        if (d === 'csTransportDoor_') return { status: 200, data: JSON.parse(j(TRANSPORT)) };
        if (d === 'csmDoor_') return { status: 200, data: JSON.parse(j(MAR)) };
        return { status: 200, data: { door: d, client: ask && ask.client } };
      };
    });
    clientProfilesCached_ = function (a, k, part, deps, producer) { return cpScrub_(producer()); };
    cpRosterBuild_ = function () {
      return { clients: [{ client_key: 'kay9', name: 'Kay9 Test' }, { client_key: 'lee9', name: 'Lee9 Other' },
                         { client_key: 'mo9', name: 'Mo9 Else' }], inactive_why: '', degraded: false };
    };

    var READS = ['clientProfileDetails', 'clientProfileCare', 'clientProfileMeds', 'clientProfileIncidents',
                 'clientProfileActivity', 'clientProfileDocFile', 'clientSourceAppointments', 'clientSourceTransport',
                 'clientSourceMar', 'clientSourceMarDocFile', 'clientSourceMarImportScan', 'clientSourceRefills',
                 'clientSourceFunds', 'clientSourceBilling', 'clientSourceFinanceFile'];
    var OFFICE = ['clientSourceRefills', 'clientSourceBilling', 'clientSourceMarImportScan'];
    var WRITES = ['clientProfileSave', 'clientProfileIncidentStatus', 'clientProfileApptSave', 'clientProfileIspSections',
                  'clientProfileRename', 'clientProfileStatus', 'clientProfileOverride'];
    var probe = function (key) {
      return { client: key, tab: 'plans', file_id: 'abcdefghijkl', id: 'abcdefghijkl', status: 'Closed', incident_ts: 't',
                client_name: 'Kay9 Test', witness: 'Kay9 Test', fields: { outcome: 'x' } };
    };
    var passed = function (r) {
      return !!r && (r.status === 418 || r.status === 200 || (r.status === 503 && /scan was reached/.test(r.message)));
    };
    var ask = function (a, u, key) { HUB_VIEWER_MEMO = null; return HUB_ACTIONS[a](probe(key), u); };
    var roster = function (u) { HUB_VIEWER_MEMO = null; return HUB_ACTIONS.clientProfileRoster({}, u); };
    var sweep = function (list, u, key, want) {
      return list.filter(function (a) { var r = ask(a, u, key); return !(want === 'open' ? passed(r) : shut(r)); });
    };

    // ---- the policies ----
    var badRoles = [];
    READS.concat(['clientProfileRoster']).forEach(function (a) {
      if (j((HUB_POLICY[a] || {}).roles) !== j(ST_CP_READ_ROLES)) badRoles.push(a + ' ' + j((HUB_POLICY[a] || {}).roles));
    });
    WRITES.forEach(function (a) {
      var want = a === 'clientProfileIspSections' ? '["admin"]'
        : (a === 'clientProfileSave' || a === 'clientProfileOverride' ? '["admin","manager","staff"]' : '["admin","manager"]');
      if (j((HUB_POLICY[a] || {}).roles) !== want) badRoles.push(a + ' ' + j((HUB_POLICY[a] || {}).roles));
    });
    stAssert_(out, P + 'every read of Clients and of its six sections\' doors is declared for every account role App ' +
                   'Control may release it to — the gate decides — and every write keeps its admin/manager (the plan ' +
                   'reader admin; the profile pencil and the care rows also their editions\' staff) declaration',
              badRoles.length === 0, badRoles.join('; '));

    // ---- released to STAFF ----
    RULES = { rules: { 'client-profiles': ['STAFF'] }, tenants: {} };
    asked = 0;
    var staffShut = sweep(READS, staff, 'mo9', 'open');
    var staffRoster = roster(staff);
    stAssert_(out, P + 'released to STAFF: a staff member opens every read of Clients and its sections\' doors on any ' +
                   'client, and the roster is every client, read as "all"',
              staffShut.length === 0 && asked === READS.length && staffRoster.status === 200 &&
              staffRoster.data.viewer === 'all' && staffRoster.data.clients.length === 3, j([staffShut, staffRoster]));
    var fullTrips = ask('clientSourceTransport', staff, 'mo9');
    var fullMar = ask('clientSourceMar', staff, 'mo9');
    stAssert_(out, P + 'released to STAFF: Transportation and Administration are the whole answers, the fleet, the miles ' +
                   'and the errors audit included',
              j(fullTrips.data) === j(TRANSPORT) && j(fullMar.data) === j(MAR), j([fullTrips, fullMar]));
    asked = 0;
    var staffWrites = sweep(WRITES, staff, 'mo9', 'shut');
    stAssert_(out, P + 'released to STAFF: every write still answers the 404 before anything is looked up',
              staffWrites.length === 0 && asked === 0, j(staffWrites) + ' asked=' + asked);

    // ---- another app released, or none ----
    RULES = { rules: { 'locations': ['STAFF'], 'client-profiles': ['CLIENT'] }, tenants: {} };
    asked = 0;
    var notStaff = sweep(READS, staff, 'kay9', 'shut');
    var notStaffRoster = roster(staff);
    RULES = { rules: {}, tenants: {} };
    asked = 0;
    var masterOpen = sweep(READS, master, 'mo9', 'open');
    var masterRoster = roster(master);
    stAssert_(out, P + 'when App Control names none of a staff member\'s badges they get the 404 on every read before ' +
                   'anything is looked up; the master in its own session opens every door with no row at all',
              notStaff.length === 0 && shut(notStaffRoster) && masterOpen.length === 0 && masterRoster.status === 200 &&
              masterRoster.data.viewer === 'master' && masterRoster.data.clients.length === 3,
              j([notStaff, notStaffRoster, masterOpen]));

    // ---- a visit ----
    RULES = { rules: { 'client-profiles': ['STAFF'] }, tenants: {} };
    usersAll_ = function () {
      return [{ userid: 'u-st9', email: 'st9@example.org', displayname: 'St9 Staff', role: 'staff', types: 'STAFF',
                active: 'true', appdenials: '' }];
    };
    HUB_MEMBER_CTX = { memberId: 'mem_st9', userId: 'u-st9', email: 'st9@example.org' };
    var visiting = { id: 'u-st9', email: 'st9@example.org', role: 'staff', types: ['STAFF'], visiting_member: 'mem_st9' };
    asked = 0;
    var visitReads = sweep(READS, visiting, 'mo9', 'open');
    var visitWrites = sweep(WRITES, visiting, 'mo9', 'shut');
    var visitRoster = roster(visiting);
    RULES = { rules: {}, tenants: {} };
    var visitShut = sweep(READS, visiting, 'mo9', 'shut');
    HUB_MEMBER_CTX = null;
    stAssert_(out, P + 'a visit reads as the visited account: a released staff member\'s view opens every read and no ' +
                   'write, and with no row the visit is shut like the member',
              visitReads.length === 0 && visitWrites.length === 0 && visitRoster.data.viewer === 'all' &&
              visitShut.length === 0, j([visitReads, visitWrites, visitShut, visitRoster]));

    // ---- a client, family and an SSA ----
    var mine = function (u) { var r = roster(u); return r.status === 200 ? r.data.viewer + ':' + r.data.clients.map(function (c) { return c.client_key; }).join(',') : r.status; };
    stAssert_(out, P + 'a client, family and an SSA get the roster of their own clients and the word they read as',
              mine(client) === 'client:kay9' && mine(family) === 'guardian:kay9' && mine(ssa) === 'ssa:kay9,lee9',
              [mine(client), mine(family), mine(ssa)].join(' | '));
    asked = 0;
    var outside = [client, family, ssa].map(function (u) {
      return sweep(READS, u, 'mo9', 'shut').concat(sweep(READS, u, 'nobody9', 'shut'));
    });
    stAssert_(out, P + 'a client outside their scope, on the records or not, is the 404 on every door before anything ' +
                   'is looked up',
              outside.every(function (l) { return l.length === 0; }) && asked === 0, j(outside) + ' asked=' + asked);
    var OWN = READS.filter(function (a) { return OFFICE.indexOf(a) === -1; });
    var clientOpen = sweep(OWN, client, 'kay9', 'open').concat(sweep(OWN, family, 'kay9', 'open'));
    var clientOffice = sweep(OFFICE, client, 'kay9', 'shut').concat(sweep(OFFICE, family, 'kay9', 'shut'));
    stAssert_(out, P + 'a client and family open their own record — profile, care, medications, incidents, activity, the ' +
                   'plan, appointments, trips, administration and its papers, funds and their documents — and get the ' +
                   '404 on the office\'s Refills, Billing and drive scan',
              clientOpen.length === 0 && clientOffice.length === 0, j([clientOpen, clientOffice]));
    var ssaOpen = sweep(READS, ssa, 'lee9', 'open');
    var ssaScanAll = HUB_ACTIONS.clientSourceMarImportScan({}, ssa);
    RULES = { rules: { 'client-profiles': ['STAFF'] }, tenants: {} };
    var staffScanAll = HUB_ACTIONS.clientSourceMarImportScan({}, staff);
    stAssert_(out, P + 'an SSA opens every door on their own clients, the office\'s parts included, but never the drive ' +
                   'scan of every client; a released staff member scans every client',
              ssaOpen.length === 0 && shut(ssaScanAll) && passed(staffScanAll), j([ssaOpen, ssaScanAll, staffScanAll]));
    var ownTrips = ask('clientSourceTransport', family, 'kay9').data || {};
    var ssaTrips = ask('clientSourceTransport', ssa, 'kay9').data || {};
    stAssert_(out, P + 'Transportation to a client or family: their trips (Calendar, History) without the fleet, the ' +
                   'miles on shifts or those books; an SSA gets the whole answer',
              j(Object.keys(ownTrips.tabs || {}).sort()) === '["calendar","history"]' &&
              ownTrips.sources.map(function (s) { return s.id; }).join() === 'van_requests,dr_visits' &&
              j(ownTrips).indexOf('Sam9 Shift') === -1 && j(ssaTrips) === j(TRANSPORT), j([ownTrips, ssaTrips]));
    var ownMar = ask('clientSourceMar', client, 'kay9').data || {};
    var ssaMar = ask('clientSourceMar', ssa, 'kay9').data || {};
    stAssert_(out, P + 'Administration to a client or family: the papers and the passes without the MAR errors audit ' +
                   '(and not degraded by it); an SSA gets the whole answer',
              j(Object.keys(ownMar.tabs || {}).sort()) === '["papers","passes"]' && ownMar.degraded === false &&
              j(ssaMar) === j(MAR), j([ownMar, ssaMar]));
    asked = 0;
    var writesShut = [client, family, ssa].map(function (u) { return sweep(WRITES, u, 'kay9', 'shut'); });
    stAssert_(out, P + 'every write answers the 404 to a client, family and an SSA, on their own client too, before ' +
                   'anything is looked up',
              writesShut.every(function (l) { return l.length === 0; }) && asked === 0, j(writesShut) + ' asked=' + asked);
    var noKeys = [roster(nobody)].concat(READS.map(function (a) { return ask(a, nobody, 'kay9'); }));
    var oddKind = [roster(odd)].concat(READS.map(function (a) { return ask(a, odd, 'kay9'); }));
    HUB_IS_SERVICE_REQ = true;
    var onService = READS.map(function (a) { return ask(a, staff, 'kay9'); });
    HUB_IS_SERVICE_REQ = false;
    stAssert_(out, P + 'a scope that names no client, a kind the app does not know, and a service request are shut on ' +
                   'every door',
              noKeys.every(shut) && oddKind.every(shut) && onService.every(shut), j([noKeys[0], oddKind[0], onService[0]]));

    // ---- the activity a client or family reads ----
    var ctx = { key: 'kay9', name: 'Kay9 Test', row: {}, archived: false, all: [] };
    clientProfilesClient_ = function (raw) {
      return String(raw) === 'kay9' ? ctx : { refused: { status: 404, message: 'No client "' + raw + '" is on file.' } };
    };
    var reads = [], parts = [];
    clientProfilesCached_ = function (a, k, part, deps, producer) { parts.push(part); return cpScrub_(producer()); };
    estateRows_ = function (r) {
      reads.push(r);
      if (r === 'dailyNotes') {
        return [{ id: 'd1', client_name: 'Kay9 Test', category: 'Day', response: 'Staff words.', dsp_name: 'Sam9',
                  reporting_date: '2026-09-10' }];
      }
      if (r === 'drVisits') {
        return [{ id: 'v1', client_name: 'Kay9 Test', dr_name: 'Lee', appointment_date: '2026-09-12',
                  appointment_address: '1 Clinic Rd', manager: 'Hal9' }];
      }
      return [];
    };
    listRows_ = function (r) {
      reads.push(r);
      if (r === 'clientNotes') return [{ id: 'n1', client_key: 'kay9', note: 'Office words.', entry_date: '2026-09-11', contact: 'Ann9' }];
      if (r === 'medications') return [{ 'Id - Auto': '7', Client: 'Kay9 Test', PrescriptionName: 'Med9', Dosage: '1', 'Added Date': '2026-09-01' }];
      return [];
    };
    cpOwnRows_ = function (tab) {
      reads.push(tab);
      return tab === LOCATION_NOTES_TAB ? [{ id: 'h1', client_key: 'kay9', priority: 'high', house: 'ZZ9999', at: '2026-09-13',
                                              details: 'House words.', by: 'Hal9' }] : [];
    };
    var whole = ask('clientProfileActivity', staff, 'kay9').data || {};
    var wholeReads = reads.slice();
    reads = [];
    var own = ask('clientProfileActivity', family, 'kay9').data || {};
    var ownReads = reads.slice();
    var kindsOf = function (a) { return (a.rows || []).map(function (r) { return r.kind; }).sort().join(); };
    var ownText = j(own);
    stAssert_(out, P + 'Activity to a client or family: the incidents, visits and medication changes alone — the daily, ' +
                   'client and house notes never read, counted, offered or cached with the whole trail; staff get all of it',
              kindsOf(whole) === 'client_note,daily_note,house_note,med_added,visit' &&
              kindsOf(own) === 'med_added,visit' && own.total === 2 &&
              !('daily_notes' in (own.counts || {})) && !('client_notes' in (own.counts || {})) &&
              !('house_notes' in (own.counts || {})) &&
              (own.kinds || []).join().indexOf('note') === -1 && (whole.kinds || []).length === 7 &&
              ['Staff words.', 'Office words.', 'House words.'].every(function (w) { return ownText.indexOf(w) === -1; }) &&
              ownReads.indexOf('dailyNotes') === -1 && ownReads.indexOf('clientNotes') === -1 &&
              ownReads.indexOf(LOCATION_NOTES_TAB) === -1 && wholeReads.indexOf('dailyNotes') !== -1 &&
              j(parts) === '["all","own"]', j([own, ownReads, parts]));

    // ---- the relay's pack, as the client itself is answered ----
    var clientAsks = {
      roster_own: function () { return roster(client); },
      details: function () { return HUB_ACTIONS.clientProfileDetails({ client: 'kay9' }, client); },
      meds: function () { return HUB_ACTIONS.clientProfileMeds({ client: 'kay9', tab: 'meds' }, client); },
      incidents: function () { return HUB_ACTIONS.clientProfileIncidents({ client: 'kay9' }, client); },
      activity_own: function () { return HUB_ACTIONS.clientProfileActivity({ client: 'kay9' }, client); },
      appointments: function () { return HUB_ACTIONS.clientSourceAppointments({ client: 'kay9' }, client); },
      transport_own: function () { return HUB_ACTIONS.clientSourceTransport({ client: 'kay9' }, client); },
      mar_own: function () { return HUB_ACTIONS.clientSourceMar({ client: 'kay9' }, client); },
      funds: function () { return HUB_ACTIONS.clientSourceFunds({ client: 'kay9' }, client); }
    };
    CP_CARE_TABS.forEach(function (t) {
      clientAsks['care_' + t] = function () { return HUB_ACTIONS.clientProfileCare({ client: 'kay9', tab: t }, client); };
    });
    var familyReads = function () {
      return j([roster(family), ask('clientProfileActivity', family, 'kay9'), ask('clientSourceMar', family, 'kay9'),
                ask('clientSourceTransport', family, 'kay9'), ask('clientProfileDetails', family, 'kay9')]);
    };
    var familyBefore = familyReads();
    var cpk = HUB_ACTIONS.clientPack({ client: 'kay9' }, serviceUser_());
    var cpp = (cpk.data && cpk.data.parts) || {}, cps = (cpk.data && cpk.data.part_status) || {};
    var unlike = Object.keys(clientAsks).filter(function (n) {
      HUB_VIEWER_MEMO = null;
      var want = clientAsks[n]();
      if (want.status !== 200) return (cps[n] || {}).status !== want.status;
      return (cps[n] || {}).status !== 200 || j(cpp[n]) !== j(want.data);
    });
    var ownText = j([cpp.roster_own, cpp.activity_own, cpp.transport_own, cpp.mar_own]);
    stAssert_(out, P + 'pack: the client\'s own parts — roster, activity, transport and administration — and the ' +
                   'record, care, medications, incidents, appointments and funds are each exactly the action\'s answer ' +
                   'to the client itself; the own parts carry no note, fleet, miles or errors audit',
              cpk.status === 200 && unlike.length === 0 && cpp.roster_own.viewer === 'client' &&
              cpp.roster_own.clients.map(function (c) { return c.client_key; }).join() === 'kay9' &&
              ['Staff words.', 'Office words.', 'House words.', 'Sam9 Shift', '"vehicles"', '"mileage"', '"errors"']
                .every(function (w) { return ownText.indexOf(w) === -1; }) &&
              !!cpp.activity && !!cpp.transport && !!cpp.mar, j([unlike, cps]).slice(0, 1500));
    stAssert_(out, P + 'pack: a family member\'s answers are the same after the pack as before it',
              familyReads() === familyBefore, familyBefore.slice(0, 300));
  } finally {
    hubProfileAppGate_ = keep.gate;
    hubProfileAppRules_ = keep.rules;
    clientProfilesClient_ = keep.client;
    clientProfilesCached_ = keep.cached;
    cpRosterBuild_ = keep.roster;
    csmClient_ = keep.csmClient;
    csfClient_ = keep.csfClient;
    csmScanRoster_ = keep.scanRoster;
    estateRows_ = keep.estate;
    listRows_ = keep.list;
    cpOwnRows_ = keep.own;
    usersAll_ = keep.users;
    DOORS.forEach(function (d) { g[d] = keep.doors[d]; });
    HUB_MEMBER_CTX = keep.member;
    HUB_MASTER_EMAIL_CACHE = keep.masterCache;
    HUB_IS_SERVICE_REQ = keep.service;
    HUB_VIEWER_MEMO = null;
    cfxUndo();
  }
}

/** client_files through the index's own grouping, from the test's listRows_ table — never the script cache. The undo. */
function stCfxStub_() {
  var keep = { rows: cfxSheetRows_, state: cfxState_, whole: clientFileWhole_ };
  cfxSheetRows_ = function () { return listRows_('clientFiles', {}); };
  cfxState_ = function () { return cfxBuild_('', null); };
  clientFileWhole_ = function (slim) {
    return listRows_('clientFiles', {}).filter(function (r) {
      return String(r.id || '') === String(slim.id || '') && String(r.drive_id || '') === String(slim.drive_id || '');
    })[0] || null;
  };
  return function () { cfxSheetRows_ = keep.rows; cfxState_ = keep.state; clientFileWhole_ = keep.whole; };
}

/** The slim index: candidates by key and folded name in sheet order, a lost group rebuilt, nothing read twice. */
function stClientFilesIndex_(out) {
  var P = 'client files index: ';
  var keep = { rows: cfxSheetRows_, state: cfxState_, memo: CFX_MEMO_, chunk: CFX_CHUNK };
  var store = {}, reads = 0;
  var cache = {
    get: function (k) { return store.hasOwnProperty(k) ? store[k] : null; },
    getAll: function (ks) { var o = {}; ks.forEach(function (k) { if (store.hasOwnProperty(k)) o[k] = store[k]; }); return o; },
    putAll: function (o) { Object.keys(o).forEach(function (k) { store[k] = o[k]; }); }
  };
  var ids = function (rows) { return rows.map(function (r) { return r.id; }).join(); };
  try {
    CFX_CHUNK = 40;
    CFX_MEMO_ = {};
    cfxSheetRows_ = function () {
      reads++;
      return [{ id: 'a1', client_key: 'kay', client_name: 'Kay Test', title: 'Kay ISP', drive_id: 'driveA0000001',
                url: 'https://drive.google.com/file/d/driveA0000001/view', digest_text: 'LONG OCR', _row: 2 },
              { id: 'b1', client_key: '', client_name: 'Kay  Test', title: 'Loose paper', drive_id: '',
                url: 'https://drive.google.com/file/d/driveB0000001/view', _row: 3 },
              { id: 'c1', client_key: 'lee', client_name: 'Kay Test', title: 'Misfiled', _row: 4 },
              { id: 'd1', client_key: 'lee', client_name: 'Lee Other', title: 'Lee plan', _row: 5 },
              { id: 'e1', client_key: 'zed', client_name: 'Zed Else', title: 'Zed plan', _row: 6 }];
    };
    // the test's own cache under its own base: the script cache is never written
    cfxState_ = function () {
      var n = parseInt(cache.get('cfxT:m:n'), 10);
      return n > 0 ? { base: 'cfxT', cache: cache, man: JSON.parse(cfxJoin_(cache, 'cfxT:m', n)), texts: {} }
                   : cfxBuild_('cfxT', cache);
    };
    cfxBuild_('cfxT', cache);
    var all = clientFilesAll_();
    var kay = clientFilesFor_(['kay'], ['kaytest']);
    stAssert_(out, P + 'the cache holds every group in parts under one manifest; no digest column is kept; a url naming ' +
                   'the row\'s own drive id is dropped, any other kept',
              reads === 1 && ids(all) === 'a1,b1,c1,d1,e1' && all.every(function (r) { return r.digest_text === undefined; }) &&
              all[0].url === '' && /driveB/.test(all[1].url) && all[0]._row === 2 &&
              Object.keys(store).some(function (k) { return /^cfxT:g\d+:1$/.test(k); }) && store['cfxT:m:n'] !== undefined,
              JSON.stringify(all).slice(0, 300));
    stAssert_(out, P + 'a client\'s candidates are its key\'s group and every group carrying its folded name, in sheet ' +
                   'order; the reader\'s own match narrows them',
              ids(kay) === 'a1,b1,c1,d1' && reads === 1, ids(kay));
    delete store['cfxT:g0:0'];
    var again = clientFilesAll_();
    stAssert_(out, P + 'a group the cache lost is rebuilt from the sheet, never answered as empty',
              ids(again) === 'a1,b1,c1,d1,e1' && reads === 2, ids(again) + ' ' + reads);
  } catch (e) {
    stAssert_(out, P + 'ran', false, String(e && e.message || e));
  } finally {
    cfxSheetRows_ = keep.rows;
    cfxState_ = keep.state;
    CFX_MEMO_ = keep.memo;
    CFX_CHUNK = keep.chunk;
  }
}
