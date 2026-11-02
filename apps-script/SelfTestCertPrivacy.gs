/** Certificate uploads, the certification tracker and the compliance scorecard and matrix: the real master reads the whole of each; everyone else reads and files only their own, a name two could claim is nobody's, a roster e-mail cell never outranks the account's own name, only writers write the roster, and the contact merge links nobody by what they wrote themselves. The ledger, the tracker, the Master, the roster, the accounts and the Drive filing are stood in for. */
function stCertPrivacy_(out) {
  var keep = { rows: complianceDocsRows_, people: complianceDocsPeople_, accounts: complianceDocsAccounts_,
               store: complianceDocsStore_, master: HUB_MASTER_EMAIL_CACHE, member: HUB_MEMBER_CTX,
               matrix: certMatrixRows_, certs: staffCertRows_, onStaff: cgBlockStatuses_,
               masterRow: complianceDocsMasterRow_, active: complianceActiveRows_,
               session: HUB_SESSION_USER, svc: HUB_IS_SERVICE_REQ, world: HUB_WORLD_CTX, tenant: HUB_TENANT_CTX,
               dyn: hubDynamicResources_, builder: appBuilderRegisterResources_,
               update: updateRowById_, create: createRow_, remove: deleteRowById_,
               users: usersAll_, bPeople: commBroadcastPeopleRows_, bCal: commBroadcastCalendar_,
               setFields: userSetFields_, states: reqStatesListValues_ };
  var ledger = [
    { id: 'c1', person: 'Ann Able', cert: 'CPR / First Aid', name: 'ann.pdf', url: 'u1', by: 'ann@example.org', at: '2026-01-01' },
    { id: 'c2', person: 'Ben Baker', cert: 'DODD Certification', name: 'ben.pdf', url: 'u2', by: 'ben@example.org', at: '2026-01-02' },
    { id: 'c3', person: 'ann  ABLE', cert: 'Medication Delegation', name: 'med.pdf', url: 'u3', by: 'mia@example.org', at: '2026-01-03' },
    { id: 'c4', person: 'Cal Coe', cert: 'CPR / First Aid', name: 'cal.pdf', url: 'u4', by: 'ann@example.org', at: '2026-01-04' },
    { id: 'c5', person: '', cert: 'CPR / First Aid', name: 'blank.pdf', url: 'u5', by: 'x@example.org', at: '2026-01-05' },
    { id: 'c6', person: 'Zed Gone', cert: 'CPR / First Aid', name: 'zed.pdf', url: 'u6', by: 'mia@example.org', at: '2026-01-06' },
    { id: 'c7', person: 'Dee Doe', cert: 'CPR / First Aid', name: 'dee.pdf', url: 'u7', by: 'mia@example.org', at: '2026-01-07' },
    { id: 'c8', person: 'Eve East', cert: 'CPR / First Aid', name: 'eve.pdf', url: 'u8', by: 'mia@example.org', at: '2026-01-08' }
  ];
  var roster = [
    { id: 'p-ann', name: 'Ann Able', email: 'ann.roster@example.org', status: 'Active' },
    { id: 'p-ben', name: 'Ben Baker', status: 'Active' },
    { id: 'p-cal', name: 'Cal Coe', email: 'Cal@Example.org', status: 'Active', employee_id: 'E4' },
    { id: 'p-mia', name: 'Mia Manager', email: 'mia.roster@example.org', status: 'active' },
    { id: 'p-dee', name: 'Dee Doe', status: 'Active' },
    { id: 'p-eve1', name: 'Eve East', status: 'Active' },
    { id: 'p-eve2', name: 'Eve  east', status: 'Active' }
  ];
  var acct = function (id, name, email, extra) {
    var row = { userid: id, displayname: name, email: email, peopleid: '', active: 'TRUE', mergedinto: '' };
    Object.keys(extra || {}).forEach(function (k) { row[k] = extra[k]; });
    return row;
  };
  // a link the contact merge wrote carries what proved it (ContactsSync.gs contactsMergePlan_)
  var proven = function (how) { return JSON.stringify({ people_id: how }); };
  var accounts = [
    acct('u-ann', 'Annie', 'ann@example.org', { peopleid: 'people:p-ann', contactsources: proven('email') }),
    acct('u-ben', 'Ben Baker', 'ben@example.org'),
    acct('u-ben-old', 'Ben Baker', 'ben.old@example.org', { active: 'FALSE' }),
    acct('u-ben-merged', 'ben baker', 'ben.merged@example.org', { mergedinto: 'u-ben' }),
    acct('u-cal', 'Cal', 'cal@example.org'),
    acct('u-mia', 'Mia Manager', 'mia@example.org'),
    acct('u-ada', 'Ada Admin', 'ada@example.org'),
    acct('u-boss', 'Platform', 'boss@example.org'),
    acct('u-x', '', 'x@example.org'),
    acct('u-zed', 'Zed Gone', 'zed@example.org'),
    acct('u-dee', 'Dee Doe', 'dee@example.org'),
    acct('u-dee2', 'D. Doe', 'dee2@example.org', { peopleid: 'p-dee', contactsources: proven('email') }),
    acct('u-eve', 'Evie', 'eve@example.org', { peopleid: 'people:p-eve1', contactsources: proven('email') }),
    acct('u-fay', 'Fay', 'fay@example.org', { emails: '["cal@example.org"]', phones: '[]' }),
    acct('u-gus', 'Gus Gone', 'gus@example.org', { active: 'FALSE' })
  ];
  var rosterDown = false, accountsDown = false, ledgerDown = false, ledgerReads = 0, filed = [];
  var ids = function (answer) {
    return (answer && answer.data && answer.data.uploads || []).map(function (u) { return u.id; }).join(',');
  };
  var scopeOf = function (answer) { return answer && answer.data ? answer.data.scope : String(answer && answer.status); };
  var refused = function (answer, status, re) {
    return !!answer && answer.status === status && !answer.data && re.test(String(answer.message));
  };
  var pdf = function (person) {
    var p = { cert: 'CPR / First Aid', filename: 'card.pdf', mime: 'application/pdf', base64: 'QUJD' };
    if (person !== undefined) p.person = person;
    return p;
  };
  var who = function (id, name, email, role, extra) {
    var u = { id: id, email: email, display_name: name, role: role };
    Object.keys(extra || {}).forEach(function (k) { u[k] = extra[k]; });
    return u;
  };
  var ann = who('u-ann', 'Annie', 'ann@example.org', 'staff', { people_id: 'people:p-ann' });
  var ben = who('u-ben', 'Ben Baker', 'ben@example.org', 'staff');
  var ben2 = who('u-ben2', 'ben baker', 'ben2@example.org', 'staff');
  var cal = who('u-cal', 'Cal', 'cal@example.org', 'staff');
  var mia = who('u-mia', 'Mia Manager', 'mia@example.org', 'manager');
  var ada = who('u-ada', 'Ada Admin', 'ada@example.org', 'admin');
  var boss = who('u-boss', 'Platform', 'boss@example.org', 'admin');
  var nameless = who('u-x', '', 'x@example.org', 'staff');
  var zed = who('u-zed', 'Zed Gone', 'zed@example.org', 'staff');
  var dee = who('u-dee', 'Dee Doe', 'dee@example.org', 'staff');
  var dee2 = who('u-dee2', 'D. Doe', 'dee2@example.org', 'staff', { people_id: 'p-dee' });
  var eve = who('u-eve', 'Evie', 'eve@example.org', 'staff', { people_id: 'people:p-eve1' });
  var fay = who('u-fay', 'Fay', 'fay@example.org', 'staff');
  var gus = who('u-gus', 'Gus Gone', 'gus@example.org', 'staff');
  try {
    HUB_MASTER_EMAIL_CACHE = 'boss@example.org';
    HUB_MEMBER_CTX = null;
    complianceDocsRows_ = function () { ledgerReads++; return ledgerDown ? null : ledger.slice(); };
    complianceDocsPeople_ = function () { if (rosterDown) throw new Error('roster down'); return roster; };
    complianceDocsAccounts_ = function () { if (accountsDown) throw new Error('accounts down'); return accounts; };
    complianceDocsStore_ = function (person, cert) {
      filed.push(person);
      return { status: 200, data: { person: person, cert: cert } };
    };
    // the shipped on-staff list, whatever the live settings say
    cgBlockStatuses_ = function () { return { active: true, admin: true }; };

    // --- who sees what ---
    var mine = HUB_ACTIONS.certUploadsList({}, ann);
    stEq_(out, 'cert privacy: a staff member sees only their own uploads, matched through their roster row',
          mine.status + ' ' + ids(mine), '200 c1,c3');
    stEq_(out, 'cert privacy: that answer says it is the caller\'s own rows, under the roster name',
          mine.data.scope + ' ' + mine.data.self, 'own Ann Able');
    stEq_(out, 'cert privacy: a person named in the payload never widens the list',
          ids(HUB_ACTIONS.certUploadsList({ person: 'Ben Baker' }, ann)), 'c1,c3');
    stEq_(out, 'cert privacy: an unlinked account is matched by a display name on the roster; an inactive or merged ' +
          'account with the same name takes nothing from it',
          ids(HUB_ACTIONS.certUploadsList({}, ben)), 'c2');
    var bridged = HUB_ACTIONS.certUploadsList({}, cal);
    stEq_(out, 'cert privacy: an unlinked account whose name is not the roster\'s is matched by its sign-in e-mail ' +
          'on the one roster row carrying it', ids(bridged) + ' ' + bridged.data.self, 'c4 Cal Coe');
    var miaList = HUB_ACTIONS.certUploadsList({}, mia);
    stEq_(out, 'cert privacy: a manager sees only their own uploads, not the ones they filed for others',
          miaList.status + ' [' + ids(miaList) + ']', '200 []');
    var adaList = HUB_ACTIONS.certUploadsList({}, ada);
    stAssert_(out, 'cert privacy: an admin who is not the master and is on no roster row is refused, and told why',
              refused(adaList, 403, /not on the staff roster/), '');
    stEq_(out, 'cert privacy: that refusal is typed as the caller\'s own scope', adaList.scope, 'own');
    var every = HUB_ACTIONS.certUploadsList({}, boss);
    stEq_(out, 'cert privacy: the master sees every upload, the unnamed row included',
          every.status + ' ' + ids(every) + ' ' + every.data.scope, '200 c1,c2,c3,c4,c5,c6,c7,c8 all');
    var visitBoss = who('u-boss', 'Ann Able', 'boss@example.org', 'admin',
                        { visiting_member: 'mem_selftest', acting_for: 'u-boss' });
    stAssert_(out, 'cert privacy: a visit that wears the master\'s e-mail is not the master',
              scopeOf(HUB_ACTIONS.certUploadsList({}, visitBoss)) !== 'all', '');
    HUB_MEMBER_CTX = { memberId: 'mem_selftest', userId: 'u-ann', email: 'ann@example.org' };
    try {
      stAssert_(out, 'cert privacy: an open visit is not the master even on a session that still reads as the master',
                scopeOf(HUB_ACTIONS.certUploadsList({}, boss)) !== 'all', '');
    } finally { HUB_MEMBER_CTX = null; }
    stAssert_(out, 'cert privacy: the master address on a staff role is not the master',
              scopeOf(HUB_ACTIONS.certUploadsList({}, who('u-b2', 'Ben Baker', 'boss@example.org', 'staff'))) !== 'all', '');

    // --- a name two could claim is nobody's ---
    accounts.push(acct('u-ben2', 'ben baker', 'ben2@example.org'));
    var before = ledgerReads;
    stAssert_(out, 'cert privacy: a live namesake account makes the name nobody\'s — the list refuses and says so',
              refused(HUB_ACTIONS.certUploadsList({}, ben), 403, /shared with another account/), '');
    stAssert_(out, 'cert privacy: the namesake is refused too',
              refused(HUB_ACTIONS.certUploadsList({}, ben2), 403, /shared with another account/), '');
    stEq_(out, 'cert privacy: the ledger is not read for a shared name', ledgerReads, before);
    filed = [];
    var twinFile = HUB_ACTIONS.certDocUpload(pdf(), ben2);
    stAssert_(out, 'cert privacy: a namesake files nothing under the shared name',
              refused(twinFile, 403, /shared with another account.*Nothing was filed/) && filed.length === 0,
              JSON.stringify(twinFile) + ' filed=' + filed.join('|'));
    accounts.pop();
    stAssert_(out, 'cert privacy: an unlinked account named like a roster row linked to another account is refused',
              refused(HUB_ACTIONS.certUploadsList({}, dee), 403, /shared with another account/), '');
    stAssert_(out, 'cert privacy: and the linked account is refused too while the other shows its name',
              refused(HUB_ACTIONS.certUploadsList({}, dee2), 403, /shared with another account/), '');
    stAssert_(out, 'cert privacy: two roster rows with one name cannot be told apart — a linked account is refused',
              refused(HUB_ACTIONS.certUploadsList({}, eve), 403, /Two rows on the staff roster/), '');
    accounts.push(acct('u-mia2', 'M', 'mia.roster@example.org'));
    stAssert_(out, 'cert privacy: another account signing in with the roster row\'s e-mail claims the name too',
              refused(HUB_ACTIONS.certUploadsList({}, mia), 403, /shared with another account/), '');
    accounts.pop();
    before = ledgerReads;
    stAssert_(out, 'cert privacy: a display name on no roster row matches nothing — a renamed account cannot read a ' +
              'departed person\'s rows', refused(HUB_ACTIONS.certUploadsList({}, zed), 403, /not on the staff roster/), '');
    stEq_(out, 'cert privacy: the ledger is not read for a name off the roster', ledgerReads, before);
    stAssert_(out, 'cert privacy: an e-mail the account added to its own profile bridges to nobody',
              refused(HUB_ACTIONS.certUploadsList({}, fay), 403, /not on the staff roster/), '');
    stAssert_(out, 'cert privacy: an inactive account reads nothing',
              refused(HUB_ACTIONS.certUploadsList({}, gus), 403, /not among the active accounts/), '');

    // --- a roster cell any account can write never moves an account off its own row ---
    roster.push({ id: 'p-att', name: 'Att Acker' }, { id: 'p-vic', name: 'Vic Tim', email: 'ATT@example.org' });
    accounts.push(acct('u-att', 'Att Acker', 'att@example.org'));
    ledger.push({ id: 'c9', person: 'Vic Tim', cert: 'CPR / First Aid', name: 'vic.pdf', url: 'u9', by: 'mia@example.org', at: '2026-01-09' });
    var att = who('u-att', 'Att Acker', 'att@example.org', 'staff');
    try {
      before = ledgerReads;
      var moved = HUB_ACTIONS.certUploadsList({}, att);
      stAssert_(out, 'cert privacy: a sign-in e-mail written onto another person\'s roster row does not outrank the ' +
                'account\'s own name — the list refuses and says why', refused(moved, 403, /e-mail is on one row.*name is on another/),
                JSON.stringify(moved));
      stEq_(out, 'cert privacy: the ledger is not read when the e-mail and the name disagree', ledgerReads, before);
      filed = [];
      var movedFile = HUB_ACTIONS.certDocUpload(pdf(), att);
      stAssert_(out, 'cert privacy: nothing is filed under the row the e-mail was written onto',
                refused(movedFile, 403, /Nothing was filed/) && filed.length === 0,
                JSON.stringify(movedFile) + ' filed=' + filed.join('|'));
    } finally {
      roster.splice(roster.length - 2, 2);
      accounts.pop();
      ledger.pop();
    }
    roster.push({ id: 'p-kim', name: 'Kim Kay', email: 'kim@example.org', status: 'Admin' });
    accounts.push(acct('u-kim', 'Kim Kay', 'kim@example.org'));
    try {
      var agreed = HUB_ACTIONS.certUploadsList({}, who('u-kim', 'Kim Kay', 'kim@example.org', 'staff'));
      stEq_(out, 'cert privacy: an e-mail and a name on the same roster row still match',
            agreed.status + ' ' + (agreed.data && agreed.data.self), '200 Kim Kay');
    } finally {
      roster.pop();
      accounts.pop();
    }
    roster.push({ id: 'p-h1', name: 'Hal One', email: 'hal@example.org' }, { id: 'p-h2', name: 'Hal Two', email: 'hal@example.org' });
    accounts.push(acct('u-hal', 'Hal', 'hal@example.org'), acct('u-lo', 'Lo', 'lo@example.org', { peopleid: 'p-gone' }));
    try {
      stAssert_(out, 'cert privacy: a sign-in e-mail on two roster rows bridges to neither, and the refusal says so',
                refused(HUB_ACTIONS.certUploadsList({}, who('u-hal', 'Hal', 'hal@example.org', 'staff')), 403,
                        /more than one row of the staff roster/), '');
      stAssert_(out, 'cert privacy: a link to a row no longer on the roster says so, not "not linked"',
                refused(HUB_ACTIONS.certUploadsList({}, who('u-lo', 'Lo', 'lo@example.org', 'staff')), 403,
                        /linked to is not on the staff roster/), '');
    } finally {
      roster.splice(roster.length - 2, 2);
      accounts.splice(accounts.length - 2, 2);
    }

    // --- a departed person's row is never a newcomer's by a shared name or address ---
    roster.push({ id: 'p-zoe', name: 'Zoe Zee', status: 'Terminated' }, { id: 'p-yul', name: 'Yul Yen', email: 'yul@example.org' });
    accounts.push(acct('u-zoe-old', 'Zoe Zee', 'zoe.old@example.org', { active: 'FALSE' }),
                  acct('u-zoe', 'Zoe Zee', 'zoe@example.org'), acct('u-yul', 'Yul', 'yul@example.org'));
    ledger.push({ id: 'c10', person: 'Zoe Zee', cert: 'CPR / First Aid', name: 'zoe.pdf', url: 'u10', by: 'mia@example.org', at: '2026-01-10' });
    try {
      var zoe = who('u-zoe', 'Zoe Zee', 'zoe@example.org', 'staff');
      before = ledgerReads;
      var newcomer = HUB_ACTIONS.certUploadsList({}, zoe);
      stAssert_(out, 'cert privacy: a newcomer named like a departed person\'s roster row is refused, and told the row ' +
                'is not on staff', refused(newcomer, 403, /marked "Terminated", not on staff/), JSON.stringify(newcomer));
      stEq_(out, 'cert privacy: the ledger is not read for a row off staff', ledgerReads, before);
      stAssert_(out, 'cert privacy: that refusal does not name the departed row as the caller\'s own', newcomer.self === undefined,
                JSON.stringify(newcomer));
      filed = [];
      stEq_(out, 'cert privacy: nothing is filed under a departed person\'s row by a shared name',
            HUB_ACTIONS.certDocUpload(pdf(), zoe).status + ' ' + filed.length, '403 0');
      stAssert_(out, 'cert privacy: a row bridged by the sign-in e-mail with no status on it is not taken as on staff',
                refused(HUB_ACTIONS.certUploadsList({}, who('u-yul', 'Yul', 'yul@example.org', 'staff')), 403,
                        /carries no staff status/), '');
      var zoeIdx = accounts.indexOf(accounts.filter(function (a) { return a.userid === 'u-zoe'; })[0]);
      accounts[zoeIdx] = acct('u-zoe', 'Zoe Zee', 'zoe@example.org', { peopleid: 'p-zoe' });
      var oldLink = HUB_ACTIONS.certUploadsList({}, zoe);
      stAssert_(out, 'cert privacy: a link with no recorded proof to a departed person\'s row is refused even when the ' +
                'name agrees', refused(oldLink, 403, /older rule/), JSON.stringify(oldLink));
      accounts[zoeIdx] = acct('u-zoe', 'Zoe Zee', 'zoe@example.org', { peopleid: 'p-zoe' });
      roster[roster.length - 2] = { id: 'p-zoe', name: 'Zoe Zee', email: 'zoe@example.org', status: 'Terminated' };
      var oldLinkMail = HUB_ACTIONS.certUploadsList({}, zoe);
      stAssert_(out, 'cert privacy: and one whose row carries the sign-in e-mail must still be on staff',
                refused(oldLinkMail, 403, /marked "Terminated", not on staff/), JSON.stringify(oldLinkMail));
      roster[roster.length - 2] = { id: 'p-zoe', name: 'Zoe Zee', status: 'Terminated' };
      accounts.splice(zoeIdx, 1);
      accounts.push(acct('u-zoe2', 'Z', 'zoe2@example.org', { peopleid: 'p-zoe', contactsources: proven('name') }));
      var relinked = HUB_ACTIONS.certUploadsList({}, who('u-zoe2', 'Z', 'zoe2@example.org', 'staff', { people_id: 'p-zoe' }));
      stEq_(out, 'cert privacy: a link the merge proved reads its row whatever the row\'s status says now',
            relinked.status + ' ' + ids(relinked), '200 c10');
    } finally {
      roster.splice(roster.length - 2, 2);
      accounts = accounts.filter(function (a) { return ['u-zoe-old', 'u-zoe', 'u-yul', 'u-zoe2'].indexOf(a.userid) === -1; });
      ledger.pop();
    }

    // --- a link written by an older rule stands only on what the row still says about the account ---
    roster.push({ id: 'p-att', name: 'Att Acker', status: 'Active' },
                { id: 'p-vic', name: 'Vic Tim', email: 'vic@example.org', status: 'Active' });
    ledger.push({ id: 'c9', person: 'Vic Tim', cert: 'CPR / First Aid', name: 'vic.pdf', url: 'u9', by: 'mia@example.org', at: '2026-01-09' });
    var linkedAs = function (name, email, extra) {
      accounts.push(acct('u-link', name, email, extra));
      try { return HUB_ACTIONS.certUploadsList({}, who('u-link', name, email, 'staff')); } finally { accounts.pop(); }
    };
    try {
      before = ledgerReads;
      var legacy = linkedAs('Att Acker', 'att@example.org', { peopleid: 'p-vic' });
      stAssert_(out, 'cert privacy: an older link to another person\'s row, with the account\'s own name on its own row, ' +
                'is refused', refused(legacy, 403, /older rule/) && ids(legacy) === '', JSON.stringify(legacy));
      stEq_(out, 'cert privacy: the ledger is not read for a link nothing proves', ledgerReads, before);
      stAssert_(out, 'cert privacy: an older link on an account renamed with a middle initial reads nobody\'s documents',
                refused(linkedAs('Vic X Tim', 'mal@example.org', { peopleid: 'p-vic' }), 403, /older rule/), '');
      stAssert_(out, 'cert privacy: an older link on an account renamed off the roster reads nobody\'s documents',
                refused(linkedAs('Att A.', 'att@example.org', { peopleid: 'p-vic' }), 403, /older rule/), '');
      var byRowMail = linkedAs('Victor', 'vic@example.org', { peopleid: 'p-vic' });
      stEq_(out, 'cert privacy: an older link still stands where the row carries the sign-in e-mail',
            byRowMail.status + ' ' + ids(byRowMail), '200 c9');
      var byRowName = linkedAs('Vic Tim', 'vt@example.org', { peopleid: 'p-vic' });
      stAssert_(out, 'cert privacy: but never on the row carrying the account\'s name — a name the link could have ' +
                'let it take', refused(byRowName, 403, /older rule/) && ids(byRowName) === '', JSON.stringify(byRowName));
      var disputed = linkedAs('Att Acker', 'att@example.org', { peopleid: 'p-vic', contactsources: proven('email') });
      stAssert_(out, 'cert privacy: a proved link to one row while the account\'s own name is on another is refused',
                refused(disputed, 403, /linked to one row of the staff roster and your name is on another/), JSON.stringify(disputed));
    } finally {
      roster.splice(roster.length - 2, 2);
      ledger.pop();
    }

    // --- the contact merge links nobody by what they wrote themselves, so the ledger never follows it ---
    var mRoster = [
      { id: 'p-att', name: 'Att Acker', status: 'Active' },
      { id: 'p-vic', name: 'Vic Tim', email: 'vic@example.org', phone: '330-555-0142', status: 'Active' },
      { id: 'p-una', name: 'Una Ul', email: 'una@example.org', status: 'Active' },
      { id: 'p-two1', name: 'Tess Two', status: 'Active' },
      { id: 'p-two2', name: 'Tess Two', email: 'tess@example.org', status: 'Active' }
    ];
    var mUsers = [
      { userid: 'u-att', email: 'att@example.org', displayname: 'Att Acker', role: 'staff',
        emails: JSON.stringify(['vic@example.org']), phones: '', peopleid: '' },
      { userid: 'u-mal', email: 'mal@example.org', displayname: 'Vic X Tim', role: 'staff', emails: '', phones: '', peopleid: '' },
      { userid: 'u-ph', email: 'ph@example.org', displayname: 'Phil', role: 'staff', phone: '(330) 555-0142', phones: '', peopleid: '' },
      { userid: 'u-una', email: 'una@example.org', displayname: 'Vic Tim', role: 'staff', emails: '', phones: '', peopleid: '' },
      { userid: 'u-tess', email: 'tess@example.org', displayname: 'Tess Two', role: 'staff', emails: '', phones: '', peopleid: '' }
    ];
    var mPlan = contactsMergePlan_(mUsers, mRoster, '2026-01-01T00:00:00Z');
    var itemOf = function (uid) { return mPlan.plan.filter(function (x) { return x.user_id === uid; })[0] || null; };
    var linkOf = function (uid) { var it = itemOf(uid); return it ? (it.set.people_id || '') + ':' + it.matched_by : 'none'; };
    stEq_(out, 'cert privacy: a profile e-mail naming another person\'s roster row never links there — the account\'s own ' +
          'exact name does', linkOf('u-att'), 'p-att:name');
    var attItem = itemOf('u-att');
    stAssert_(out, 'cert privacy: and that person\'s contacts are not copied onto the account',
              !!attItem && !attItem.phones_add.length && attItem.emails_add.indexOf('vic@example.org') === -1,
              JSON.stringify(attItem));
    stEq_(out, 'cert privacy: a name with a middle initial the roster does not carry links nobody', linkOf('u-mal'), 'none');
    stEq_(out, 'cert privacy: a phone alone links nobody', linkOf('u-ph'), 'none');
    stAssert_(out, 'cert privacy: both are left for an administrator to confirm, each saying by what',
              mPlan.confirm.indexOf('Vic X Tim ~ Vic Tim (by the name without its middle)') !== -1 &&
              mPlan.confirm.indexOf('Phil ~ Vic Tim (by a phone)') !== -1, JSON.stringify(mPlan.confirm));
    stAssert_(out, 'cert privacy: a sign-in e-mail on one roster row and a name on another links neither',
              linkOf('u-una') === 'none' &&
              mPlan.ambiguous.indexOf('Vic Tim (sign-in e-mail on one roster row and name on another)') !== -1,
              JSON.stringify(mPlan.ambiguous));
    stEq_(out, 'cert privacy: a sign-in e-mail settles which of two same-named roster rows is the account\'s',
          linkOf('u-tess'), 'p-two2:email');
    var proofOf = function (uid) {
      var it = itemOf(uid);
      try { return it ? str_(JSON.parse(it.set.contact_sources).people_id) : 'none'; } catch (eJ) { return 'unreadable'; }
    };
    stEq_(out, 'cert privacy: every link the merge writes records what proved it',
          proofOf('u-att') + ' ' + proofOf('u-tess'), 'name email');
    var mAccounts = mUsers.map(function (u) {
      var it = itemOf(u.userid);
      return acct(u.userid, u.displayname, u.email, it ? { peopleid: str_(it.set.people_id), contactsources: it.set.contact_sources } : {});
    });
    var keepPeople = complianceDocsPeople_, keepAccounts = complianceDocsAccounts_;
    complianceDocsPeople_ = function () { return mRoster; };
    complianceDocsAccounts_ = function () { return mAccounts; };
    ledger.push({ id: 'c9', person: 'Vic Tim', cert: 'CPR / First Aid', name: 'vic.pdf', url: 'u9', by: 'mia@example.org', at: '2026-01-09' });
    try {
      var afterMerge = HUB_ACTIONS.certUploadsList({}, who('u-att', 'Att Acker', 'att@example.org', 'staff', { people_id: 'p-att' }));
      stEq_(out, 'cert privacy: after the merge the account with another person\'s e-mail in its profile reads only its own',
            afterMerge.status + ' [' + ids(afterMerge) + '] ' + afterMerge.data.self, '200 [] Att Acker');
      var renamed = HUB_ACTIONS.certUploadsList({}, who('u-mal', 'Vic X Tim', 'mal@example.org', 'staff'));
      stAssert_(out, 'cert privacy: after the merge the self-renamed account reads nobody\'s documents',
                refused(renamed, 403, /not on the staff roster/) && ids(renamed) === '', JSON.stringify(renamed));
      filed = [];
      var renamedFile = HUB_ACTIONS.certDocUpload(pdf(), who('u-mal', 'Vic X Tim', 'mal@example.org', 'staff'));
      stEq_(out, 'cert privacy: and files nothing under the person it was named after', renamedFile.status + ' ' + filed.length, '403 0');
    } finally {
      ledger.pop();
      complianceDocsPeople_ = keepPeople;
      complianceDocsAccounts_ = keepAccounts;
    }

    // --- the merge links only an on-staff row nobody else stands on, and a name alone only a row with no other address ---
    var sRoster = [
      { id: 'p-zoe', name: 'Zoe Zee', status: 'Terminated' },
      { id: 'p-rex', name: 'Rex Ray', status: 'Active' },
      { id: 'p-quin', name: 'Quinn Quo', status: 'Active' },
      { id: 'p-nia', name: 'Nia New', email: 'nia@roster.org', status: 'Active' },
      { id: 'p-vic', name: 'Vic Tim', email: 'vic@example.org', phone: '330-555-0142', status: 'Active' },
      { id: 'p-olo', name: 'Olo Old', status: 'Active' }
    ];
    var sUsers = [
      { userid: 'u-zoe-old', email: 'zoe.old@example.org', displayname: 'Zoe Zee', role: 'staff', active: 'FALSE',
        peopleid: 'p-zoe', contactsources: proven('name') },
      { userid: 'u-zoe', email: 'zoe@example.org', displayname: 'Zoe Zee', role: 'staff', peopleid: '' },
      { userid: 'u-rex', email: 'rex@example.org', displayname: 'R', role: 'staff', peopleid: 'p-rex', contactsources: proven('email') },
      { userid: 'u-rex2', email: 'rex2@example.org', displayname: 'Rex Ray', role: 'staff', peopleid: '' },
      { userid: 'u-q1', email: 'q1@example.org', displayname: 'Quinn Quo', role: 'staff', peopleid: '' },
      { userid: 'u-q2', email: 'q2@example.org', displayname: 'quinn quo', role: 'staff', peopleid: '' },
      { userid: 'u-sq', email: 'sq@example.org', displayname: 'Nia New', role: 'staff', peopleid: '' },
      { userid: 'u-mal', email: 'mal@example.org', displayname: 'Vic X Tim', role: 'staff', peopleid: 'p-vic' },
      { userid: 'u-olo', email: 'olo@example.org', displayname: 'Olo Old', role: 'staff', peopleid: 'p-olo',
        contactsources: '{"phone":"platform"}' }
    ];
    var sPlan = contactsMergePlan_(sUsers, sRoster, '2026-01-01T00:00:00Z', { active: true, admin: true });
    var sItem = function (uid) { return sPlan.plan.filter(function (x) { return x.user_id === uid; })[0] || null; };
    stAssert_(out, 'cert privacy: the merge never links a newcomer to a departed person\'s row by a shared name',
              !sItem('u-zoe') && sPlan.confirm.indexOf('Zoe Zee ~ Zoe Zee (the roster row is marked "Terminated", not on staff)') !== -1,
              JSON.stringify(sPlan.confirm));
    stAssert_(out, 'cert privacy: a roster row another account already stands on is linked to nobody else',
              !sItem('u-rex2') && sPlan.ambiguous.indexOf('Rex Ray (roster row already linked to another account)') !== -1,
              JSON.stringify(sPlan.ambiguous));
    stAssert_(out, 'cert privacy: a row two accounts would newly stand on is neither\'s',
              !sItem('u-q1') && !sItem('u-q2') &&
              sPlan.ambiguous.filter(function (s) { return /several accounts point at/.test(s); }).length === 2,
              JSON.stringify(sPlan.ambiguous));
    stAssert_(out, 'cert privacy: a name alone never links a row that carries another person\'s address — the name may ' +
              'have been taken before the row landed', !sItem('u-sq') &&
              sPlan.confirm.indexOf('Nia New ~ Nia New (the roster row carries another e-mail)') !== -1,
              JSON.stringify(sPlan.confirm));
    var malOld = sItem('u-mal');
    stAssert_(out, 'cert privacy: a link from an older rule that nothing proves is reported, and nothing of the row is copied',
              !malOld && sPlan.confirm.some(function (s) { return s.indexOf('Vic X Tim ~ Vic Tim (linked by an older rule') === 0; }),
              JSON.stringify({ item: malOld, confirm: sPlan.confirm }));
    var olo = sItem('u-olo');
    stAssert_(out, 'cert privacy: a link from an older rule is never proved by the account\'s name — the name may have ' +
              'come from the link — so it is reported and nothing of the row is copied',
              !olo && sPlan.confirm.indexOf('Olo Old ~ Olo Old (linked by an older rule: its sign-in e-mail is not on the row)') !== -1,
              JSON.stringify({ item: olo, confirm: sPlan.confirm }));
    var oloMail = contactsMergePlan_([{ userid: 'u-olo', email: 'olo@example.org', displayname: 'Olo Old', role: 'staff',
      peopleid: 'p-olo', contactsources: '{"phone":"platform"}' }],
      [{ id: 'p-olo', name: 'Olo Old', email: 'olo@example.org', status: 'Active' }], '2026-01-01T00:00:00Z', { active: true, admin: true });
    var oloM = oloMail.plan[0] || null;
    stAssert_(out, 'cert privacy: an older link whose row carries the sign-in e-mail has that proof recorded, and what ' +
              'was already recorded is kept', !!oloM && oloM.matched_by === 'link' &&
              JSON.parse(oloM.set.contact_sources).people_id === 'email' &&
              JSON.parse(oloM.set.contact_sources).phone === 'platform', JSON.stringify(oloM));
    var oloAgain = contactsMergePlan_([{ userid: 'u-olo', email: 'olo@example.org', displayname: 'Olo Old', role: 'staff',
      peopleid: 'p-olo', rosterstatus: oloM ? str_(oloM.set.roster_status) : '',
      contactsources: oloM ? oloM.set.contact_sources : '' }],
      [{ id: 'p-olo', name: 'Olo Old', email: 'olo@example.org', status: 'Active' }],
      '2026-01-01T01:00:00Z', { active: true, admin: true });
    stEq_(out, 'cert privacy: and the next pass writes nothing for it', oloAgain.plan.length + ' ' + oloAgain.unchanged, '0 1');
    var sAccounts = sUsers.map(function (u) {
      var it = sItem(u.userid);
      return acct(u.userid, u.displayname, u.email, {
        active: u.active || 'TRUE',
        peopleid: it && it.set.people_id ? it.set.people_id : u.peopleid,
        contactsources: it ? it.set.contact_sources : (u.contactsources || '') });
    });
    complianceDocsPeople_ = function () { return sRoster; };
    complianceDocsAccounts_ = function () { return sAccounts; };
    ledger.push({ id: 'c10', person: 'Zoe Zee', cert: 'CPR / First Aid', name: 'zoe.pdf', url: 'u10', by: 'mia@example.org', at: '2026-01-10' },
                { id: 'c9', person: 'Vic Tim', cert: 'CPR / First Aid', name: 'vic.pdf', url: 'u9', by: 'mia@example.org', at: '2026-01-09' });
    try {
      var zoeAfter = HUB_ACTIONS.certUploadsList({}, who('u-zoe', 'Zoe Zee', 'zoe@example.org', 'staff'));
      stAssert_(out, 'cert privacy: after the merge the newcomer still reads none of the departed person\'s documents',
                refused(zoeAfter, 403, /marked "Terminated", not on staff/) && ids(zoeAfter) === '', JSON.stringify(zoeAfter));
      var malAfter = HUB_ACTIONS.certUploadsList({}, who('u-mal', 'Vic X Tim', 'mal@example.org', 'staff'));
      stAssert_(out, 'cert privacy: after the merge the older link still reads nobody\'s documents',
                refused(malAfter, 403, /older rule/) && ids(malAfter) === '', JSON.stringify(malAfter));
    } finally {
      ledger.splice(ledger.length - 2, 2);
      complianceDocsPeople_ = keepPeople;
      complianceDocsAccounts_ = keepAccounts;
    }

    // --- the certification tracker: the whole of it is the master's, anyone else reads their own ---
    var trackerDown = false;
    var mRows = [
      { id: 'CERT_p-ann', name: 'Ann Able', role: 'DSP', cpr: 'valid' },
      { id: 'CERT_p-ben', name: 'Ben Baker', role: 'DSP', cpr: 'expired' },
      { id: 'CERT_p-cal', name: 'Cal Coe', role: 'DSP', cpr: 'missing' }
    ];
    var cRows = [
      { id: 'SC_annable_cpr', personName: 'Ann Able', certName: 'CPR / First Aid', status: 'valid', expiresAt: '2030-01-01' },
      { id: 'SC_benbaker_cpr', personName: 'Ben Baker', certName: 'CPR / First Aid', status: 'expired', expiresAt: '2024-01-01' },
      { id: 'SC_annable_dodd', personName: 'ann  ABLE', certName: 'DODD 8-Hour', status: 'expiring', expiresAt: '2026-10-01' }
    ];
    certMatrixRows_ = function () { if (trackerDown) throw new Error('estate down'); return mRows.slice(); };
    staffCertRows_ = function () { if (trackerDown) throw new Error('estate down'); return cRows.slice(); };
    var rowIds = function (answer) {
      return (answer && answer.data && answer.data.rows || []).map(function (r) { return r.id; }).join(',');
    };
    var allM = HUB_ACTIONS.certTrackerList({ view: 'matrix' }, boss);
    stEq_(out, 'cert tracker: the master reads every person\'s row',
          allM.status + ' ' + rowIds(allM) + ' ' + allM.data.scope, '200 CERT_p-ann,CERT_p-ben,CERT_p-cal all');
    var annM = HUB_ACTIONS.certTrackerList({ view: 'matrix' }, ann);
    stEq_(out, 'cert tracker: a staff member reads only their own matrix row, found by their roster row',
          annM.status + ' ' + rowIds(annM) + ' ' + annM.data.scope + ' ' + annM.data.self, '200 CERT_p-ann own Ann Able');
    stEq_(out, 'cert tracker: and only their own certificates, in any spelling of their roster name',
          rowIds(HUB_ACTIONS.certTrackerList({ view: 'certs' }, ann)), 'SC_annable_cpr,SC_annable_dodd');
    stEq_(out, 'cert tracker: the matrix is the view when none is named', rowIds(HUB_ACTIONS.certTrackerList({}, ann)), 'CERT_p-ann');
    stEq_(out, 'cert tracker: a person named in the payload never widens it',
          rowIds(HUB_ACTIONS.certTrackerList({ view: 'certs', person: 'Ben Baker' }, ann)), 'SC_annable_cpr,SC_annable_dodd');
    var miaT = HUB_ACTIONS.certTrackerList({ view: 'matrix' }, mia);
    stEq_(out, 'cert tracker: a manager who is not the master reads only their own',
          miaT.status + ' [' + rowIds(miaT) + '] ' + miaT.data.scope, '200 [] own');
    var eveT = HUB_ACTIONS.certTrackerList({ view: 'certs' }, eve);
    stAssert_(out, 'cert tracker: a caller whose name two roster rows carry is refused, typed as their own scope and ' +
              'naming their own row', eveT.status === 403 && !eveT.data && eveT.scope === 'own' && eveT.self === 'Eve East' &&
              /Two rows on the staff roster/.test(eveT.message), JSON.stringify(eveT));
    var adaT = HUB_ACTIONS.certTrackerList({ view: 'matrix' }, ada);
    stAssert_(out, 'cert tracker: a caller on no roster row is refused and no row is named as theirs',
              adaT.status === 403 && !adaT.data && adaT.scope === 'own' && adaT.self === undefined, JSON.stringify(adaT));
    HUB_MEMBER_CTX = { memberId: 'mem_selftest', userId: 'u-ann', email: 'ann@example.org' };
    try {
      stAssert_(out, 'cert tracker: an open visit is not the master',
                scopeOf(HUB_ACTIONS.certTrackerList({ view: 'matrix' }, boss)) !== 'all', '');
    } finally { HUB_MEMBER_CTX = null; }
    trackerDown = true;
    var blindT = HUB_ACTIONS.certTrackerList({ view: 'certs' }, ann);
    stAssert_(out, 'cert tracker: an unreadable tracker is a 503, never an empty tracker',
              blindT.status === 503 && !blindT.data && blindT.scope === 'own', JSON.stringify(blindT));
    var blindAll = HUB_ACTIONS.certTrackerList({ view: 'matrix' }, boss);
    stAssert_(out, 'cert tracker: the master\'s unreadable tracker is a 503 typed as the whole tracker',
              blindAll.status === 503 && !blindAll.data && blindAll.scope === 'all', JSON.stringify(blindAll));
    trackerDown = false;
    stEq_(out, 'cert tracker: a view it does not have is refused', HUB_ACTIONS.certTrackerList({ view: 'all' }, boss).status, 400);
    stEq_(out, 'cert tracker: a service caller and a client read nothing',
          HUB_ACTIONS.certTrackerList({}, { is_service: true, role: 'admin', email: 'boss@example.org' }).status + ' ' +
          HUB_ACTIONS.certTrackerList({}, who('u-cl', 'Cli Ent', 'cl@example.org', 'client')).status, '403 403');
    stEq_(out, 'cert tracker: the generic door lists nothing, to anyone',
          certsRoute_('certMatrix', 'list').status + ' ' + certsRoute_('staffCerts', 'list').status, '403 403');
    stAssert_(out, 'cert tracker: the generic door never builds the tracker',
              stCode_(certsRoute_).indexOf('certMatrixRows_') === -1 && stCode_(certsRoute_).indexOf('staffCertRows_') === -1, '');

    // --- a writer naming themselves in another spelling files where their own list reads ---
    roster.push({ id: 'p-mona', name: 'Mona Moss', status: 'Active' });
    accounts.push(acct('u-mo', 'Mo', 'mo@example.org', { peopleid: 'p-mona', contactsources: proven('name') }));
    try {
      var mo = who('u-mo', 'Mo', 'mo@example.org', 'manager', { people_id: 'p-mona' });
      filed = [];
      HUB_ACTIONS.certDocUpload(pdf('Mo'), mo);
      HUB_ACTIONS.certDocUpload(pdf('Cal Coe'), mo);
      stEq_(out, 'cert privacy: a manager filing under their own shown name files under their roster name; for another, ' +
            'under the name given', filed.join('|'), 'Mona Moss|Cal Coe');
    } finally {
      roster.pop();
      accounts.pop();
    }

    // --- a document filed for someone else lands under the roster's spelling, where their own list reads ---
    var masterAsks = [], masterDown = false;
    complianceDocsMasterRow_ = function (name) {
      masterAsks.push(name);
      if (masterDown) throw new Error('estate down');
      return /^cal m\.? coe$/i.test(String(name)) ? { row: { employee_id: 'E4' }, by: 'name' } : { row: null, by: '' };
    };
    filed = [];
    HUB_ACTIONS.certDocUpload(pdf('cal  COE'), mia);
    HUB_ACTIONS.certDocUpload(pdf('Cal M. Coe'), mia);
    stEq_(out, 'cert privacy: filed for another person, a document takes the roster row\'s spelling — by the name, or by ' +
          'the employee id the Employee Database gives a differently spelled one', filed.join('|'), 'Cal Coe|Cal Coe');
    var calOwn = HUB_ACTIONS.certUploadsList({}, cal);
    stAssert_(out, 'cert privacy: so a document filed under the estate\'s spelling is keyed where its owner\'s own list reads',
              calOwn.status === 200 && hubNameFold_(filed[1]) === hubNameFold_(calOwn.data.self),
              JSON.stringify({ filed: filed, self: calOwn.data && calOwn.data.self }));
    filed = [];
    HUB_ACTIONS.certDocUpload(pdf('Newt Nobody'), mia);
    stEq_(out, 'cert privacy: a name on no roster row is filed as given', filed.join('|'), 'Newt Nobody');
    filed = [];
    var twinFiled = HUB_ACTIONS.certDocUpload(pdf('Eve East'), mia);
    stAssert_(out, 'cert privacy: a name two roster rows carry files nothing — neither could read it',
              refused(twinFiled, 409, /Two rows on the staff roster carry "Eve East".*Nothing was filed/) && filed.length === 0,
              JSON.stringify(twinFiled));
    masterDown = true;
    filed = [];
    var blindMaster = HUB_ACTIONS.certDocUpload(pdf('Newt Nobody'), mia);
    stAssert_(out, 'cert privacy: an unreadable Employee Database refuses a name the roster does not carry',
              refused(blindMaster, 503, /Employee Database could not be read.*Nothing was filed/) && filed.length === 0,
              JSON.stringify(blindMaster));
    masterDown = false;
    rosterDown = true;
    filed = [];
    var blindRoster = HUB_ACTIONS.certDocUpload(pdf('Cal Coe'), mia);
    stAssert_(out, 'cert privacy: an unreadable roster refuses a writer\'s filing for someone else too',
              refused(blindRoster, 503, /roster could not be read.*Nothing was filed/) && filed.length === 0,
              JSON.stringify(blindRoster));
    rosterDown = false;

    // --- a name the ledger cannot match is told apart from no name ---
    roster.push({ id: 'p-li', name: '李明' });
    accounts.push(acct('u-li', '李明', 'li@example.org'),
                  acct('u-li2', 'Li', 'li2@example.org', { peopleid: 'p-li', contactsources: proven('name') }));
    try {
      var unfolded = HUB_ACTIONS.certUploadsList({}, who('u-li', '李明', 'li@example.org', 'staff'));
      stAssert_(out, 'cert privacy: a display name with no letters a-z or digits is refused for that, not as "no name"',
                refused(unfolded, 403, /"李明", has no letters a–z or digits/) && !/no name on file/.test(unfolded.message),
                JSON.stringify(unfolded));
      var unfoldedRow = HUB_ACTIONS.certUploadsList({}, who('u-li2', 'Li', 'li2@example.org', 'staff', { people_id: 'p-li' }));
      stAssert_(out, 'cert privacy: a linked roster row whose name the ledger cannot match says so, not "not linked"',
                refused(unfoldedRow, 403, /roster row's name, "李明", has no letters a–z or digits/) &&
                !/not linked/.test(unfoldedRow.message), JSON.stringify(unfoldedRow));
    } finally {
      roster.pop();
      accounts.splice(accounts.length - 2, 2);
    }

    // --- an identity that cannot be read refuses, before the ledger is read ---
    rosterDown = true;
    before = ledgerReads;
    var blind = HUB_ACTIONS.certUploadsList({}, ann);
    stAssert_(out, 'cert privacy: an unreadable roster refuses the list and says so — never an empty list',
              refused(blind, 503, /roster could not be read/), JSON.stringify(blind));
    stEq_(out, 'cert privacy: a refusal says it answered for the caller\'s own rows, so a screen does not read it as ' +
          'about somebody else', blind.scope, 'own');
    stEq_(out, 'cert privacy: the ledger is not read for an identity nobody could settle', ledgerReads, before);
    rosterDown = false;
    accountsDown = true;
    before = ledgerReads;
    var noAccounts = HUB_ACTIONS.certUploadsList({}, ben);
    stAssert_(out, 'cert privacy: unreadable accounts refuse the list and say so — a namesake cannot be ruled out',
              refused(noAccounts, 503, /accounts could not be read/), JSON.stringify(noAccounts));
    stEq_(out, 'cert privacy: the ledger is not read when the accounts could not be', ledgerReads, before);
    rosterDown = true;
    stEq_(out, 'cert privacy: the master\'s list depends on neither the roster nor the accounts',
          HUB_ACTIONS.certUploadsList({}, boss).status, 200);
    rosterDown = false;
    accountsDown = false;
    stAssert_(out, 'cert privacy: an account with no name refuses the list',
              refused(HUB_ACTIONS.certUploadsList({}, nameless), 403, /no name on file/), '');
    ledgerDown = true;
    var shut = HUB_ACTIONS.certUploadsList({}, ann);
    stAssert_(out, 'cert privacy: an unreadable ledger is a 503, not "nothing submitted"',
              shut.status === 503 && !shut.data && shut.scope === 'own', JSON.stringify(shut));
    var shutAll = HUB_ACTIONS.certUploadsList({}, boss);
    stAssert_(out, 'cert privacy: the master\'s unreadable ledger is a 503 typed as the whole ledger',
              shutAll.status === 503 && !shutAll.data && shutAll.scope === 'all', JSON.stringify(shutAll));
    ledgerDown = false;
    stEq_(out, 'cert privacy: a service caller reads nothing',
          HUB_ACTIONS.certUploadsList({}, { is_service: true, role: 'admin', email: 'boss@example.org' }).status, 403);
    stEq_(out, 'cert privacy: an interviewer reads nothing',
          HUB_ACTIONS.certUploadsList({}, who('u-i', 'Ivy', 'i@example.org', 'interviewer')).status, 403);

    // --- who files for whom ---
    filed = [];
    var own = HUB_ACTIONS.certDocUpload(pdf('Ann Able'), ann);
    stEq_(out, 'cert privacy: a staff member files for themselves', own.status + ' ' + filed.join('|'), '200 Ann Able');
    filed = [];
    HUB_ACTIONS.certDocUpload(pdf(), ann);
    stEq_(out, 'cert privacy: with no person named the upload is filed against the session\'s own record',
          filed.join('|'), 'Ann Able');
    filed = [];
    HUB_ACTIONS.certDocUpload(pdf(' ann able '), ann);
    stEq_(out, 'cert privacy: their own name in another spelling is filed under the roster name',
          filed.join('|'), 'Ann Able');
    filed = [];
    HUB_ACTIONS.certDocUpload(pdf('Annie'), ann);
    stEq_(out, 'cert privacy: naming the account\'s own display name files under the roster name',
          filed.join('|'), 'Ann Able');
    filed = [];
    HUB_ACTIONS.certDocUpload(pdf('Cal'), cal);
    HUB_ACTIONS.certDocUpload(pdf('Cal Coe'), cal);
    stEq_(out, 'cert privacy: an account matched by its sign-in e-mail files under the roster name, by either name',
          filed.join('|'), 'Cal Coe|Cal Coe');
    filed = [];
    var other = HUB_ACTIONS.certDocUpload(pdf('Ben Baker'), ann);
    stAssert_(out, 'cert privacy: a staff member cannot file for another person, and nothing reaches Drive',
              other.status === 403 && /own record/.test(other.message) && filed.length === 0,
              JSON.stringify(other) + ' filed=' + filed.join('|'));
    filed = [];
    HUB_ACTIONS.certDocUpload(pdf('Cal Coe'), mia);
    stEq_(out, 'cert privacy: a manager still files for a person they name (the writers\' door)', filed.join('|'), 'Cal Coe');
    filed = [];
    HUB_ACTIONS.certDocUpload(pdf('Ben Baker'), boss);
    stEq_(out, 'cert privacy: the master files for anyone', filed.join('|'), 'Ben Baker');
    filed = [];
    var visitStaff = who('u-ann', 'Ann Able', 'ann@example.org', 'staff',
                         { visiting_member: 'mem_selftest', acting_for: 'u-ann' });
    stEq_(out, 'cert privacy: a visit clamped to staff files for nobody else',
          HUB_ACTIONS.certDocUpload(pdf('Ben Baker'), visitStaff).status + ' ' + filed.length, '403 0');
    rosterDown = true;
    filed = [];
    var blindFile = HUB_ACTIONS.certDocUpload(pdf('Ann Able'), ann);
    stAssert_(out, 'cert privacy: an unreadable roster refuses the upload and says so',
              refused(blindFile, 503, /Nothing was filed/) && filed.length === 0, JSON.stringify(blindFile));
    rosterDown = false;
    accountsDown = true;
    filed = [];
    var noAccountsFile = HUB_ACTIONS.certDocUpload(pdf('Ann Able'), ann);
    stAssert_(out, 'cert privacy: unreadable accounts refuse the upload and say so',
              refused(noAccountsFile, 503, /accounts could not be read.*Nothing was filed/) && filed.length === 0,
              JSON.stringify(noAccountsFile));
    accountsDown = false;
    filed = [];
    stEq_(out, 'cert privacy: an account with no name files nothing',
          HUB_ACTIONS.certDocUpload(pdf(), nameless).status + ' ' + filed.length, '403 0');
    stEq_(out, 'cert privacy: a name off the roster files nothing',
          HUB_ACTIONS.certDocUpload(pdf('Zed Gone'), zed).status + ' ' + filed.length, '403 0');
    stEq_(out, 'cert privacy: a service caller files nothing',
          HUB_ACTIONS.certDocUpload(pdf('Ann Able'), { is_service: true, role: 'admin' }).status + ' ' + filed.length, '403 0');

    // --- the compliance scorecard and matrix: every employee's row is the master's, anyone else reads their own ---
    var masterReads = 0, estateDown = false;
    var estateRows = [
      { _name: 'Mia Manager', Employee: 'Mia Manager', Status: 'yes', 'Phone Number': '330-555-0001', Email: 'mia@example.org',
        'Train - CPR': '0', 'CPR Exp Date': '2024-01-01', 'Train - DODD': '1' },
      { _name: 'Ben Baker', Employee: 'Ben Baker', Status: 'yes', 'Phone Number': '330-555-0002', Email: 'ben@example.org',
        'Train - CPR': '0.5', 'CPR Exp Date': '2030-01-01', 'Train - DODD': '0' },
      { _name: 'Cal Coe', Employee: 'Cal Coe', Status: 'yes', 'Phone Number': '330-555-0003', Email: 'cal@example.org',
        'Train - CPR': '1', 'Train - DODD': '1' }
    ];
    complianceActiveRows_ = function () {
      masterReads++;
      if (estateDown) return { error: { status: 503, message: 'The Employee Database Master could not be read (estate down).' } };
      return { headers: ['Employee', 'Status', 'Phone Number', 'Email', 'Train - CPR', 'CPR Exp Date', 'Train - DODD'],
               rows: estateRows.slice(), skippedLabels: ['OPEN'] };
    };
    var named = function (answer, id) {
      var it = (answer && answer.data ? answer.data.items : []).filter(function (x) { return x.id === id; })[0];
      return it ? it.expired.concat(it.expiring).map(function (n) { return n.name; }).join(',') : 'none';
    };
    var everyone = HUB_ACTIONS.complianceScorecard({}, boss);
    stEq_(out, 'compliance: the master\'s scorecard counts every active employee and names each one short',
          everyone.status + ' ' + everyone.data.scope + ' ' + everyone.data.metrics.activeEmployees + ' ' + named(everyone, 'train_cpr'),
          '200 all 3 Mia Manager,Ben Baker');
    var miaScore = HUB_ACTIONS.complianceScorecard({}, mia);
    stEq_(out, 'compliance: a manager who is not the master is counted alone, under their roster name',
          miaScore.status + ' ' + miaScore.data.scope + ' ' + miaScore.data.self + ' ' + miaScore.data.metrics.activeEmployees + ' ' +
          named(miaScore, 'train_cpr') + ' [' + named(miaScore, 'train_dodd') + ']', '200 own Mia Manager 1 Mia Manager []');
    stAssert_(out, 'compliance: and nobody else\'s name or row reaches that answer',
              JSON.stringify(miaScore).indexOf('Ben Baker') === -1 && !miaScore.data.skippedLabels.length, JSON.stringify(miaScore));
    var miaGrid = HUB_ACTIONS.complianceMatrix({ tab: 'training' }, mia);
    stAssert_(out, 'compliance: the matrix answers that manager only their own row — no other person\'s dates, phone or e-mail',
              miaGrid.status === 200 && miaGrid.data.scope === 'own' && miaGrid.data.total === 1 &&
              miaGrid.data.employees.map(function (e) { return e.name; }).join(',') === 'Mia Manager' &&
              JSON.stringify(miaGrid).indexOf('330-555-0002') === -1 && JSON.stringify(miaGrid).indexOf('Ben Baker') === -1,
              JSON.stringify(miaGrid));
    var bossGrid = HUB_ACTIONS.complianceMatrix({ tab: 'training' }, boss);
    stEq_(out, 'compliance: the master\'s matrix is every active employee', bossGrid.data.scope + ' ' + bossGrid.data.total, 'all 3');
    before = masterReads;
    var adaScore = HUB_ACTIONS.complianceScorecard({}, ada);
    stAssert_(out, 'compliance: an admin who is not the master and is on no roster row is refused, as their own scope',
              refused(adaScore, 403, /not on the staff roster/) && adaScore.scope === 'own', JSON.stringify(adaScore));
    stEq_(out, 'compliance: the Master is not read for an identity nobody settled', masterReads, before);
    HUB_MEMBER_CTX = { memberId: 'mem_selftest', userId: 'u-ann', email: 'ann@example.org', role: 'staff' };
    try {
      stAssert_(out, 'compliance: an open visit is not the master',
                scopeOf(HUB_ACTIONS.complianceScorecard({}, boss)) !== 'all' &&
                scopeOf(HUB_ACTIONS.complianceMatrix({ tab: 'training' }, boss)) !== 'all', '');
    } finally { HUB_MEMBER_CTX = null; }
    stEq_(out, 'compliance: a staff member is not answered the scorecard at all',
          HUB_ACTIONS.complianceScorecard({}, ann).status, 403);
    estateRows = estateRows.slice(1);
    var absent = HUB_ACTIONS.complianceScorecard({}, mia);
    stAssert_(out, 'compliance: a manager with no active row on the Master is told so, never counted as compliant',
              absent.status === 200 && absent.data.scope === 'own' && absent.data.metrics.activeEmployees === 0 &&
              /not on an active row of the Employee Database Master/.test(absent.data.note), JSON.stringify(absent));
    estateRows = [{ _name: 'Mia Manager', Status: 'yes' }, { _name: 'mia  manager', Status: 'yes' }].concat(estateRows);
    var twice = HUB_ACTIONS.complianceMatrix({ tab: 'training' }, mia);
    stAssert_(out, 'compliance: two Master rows with the caller\'s name are refused, not both answered',
              refused(twice, 409, /Two active rows of the Employee Database carry your name/), JSON.stringify(twice));
    estateDown = true;
    var shutOwn = HUB_ACTIONS.complianceScorecard({}, mia), shutAll = HUB_ACTIONS.complianceMatrix({ tab: 'training' }, boss);
    stAssert_(out, 'compliance: an unreadable Master is a 503 typed with the scope asked',
              shutOwn.status === 503 && shutOwn.scope === 'own' && shutAll.status === 503 && shutAll.scope === 'all',
              JSON.stringify([shutOwn, shutAll]));
    estateDown = false;

    // --- the roster is the writers': a generic write to `people` asks this request's own session ---
    var gateOf = function (session, action, visit) {
      HUB_SESSION_USER = session;
      HUB_MEMBER_CTX = visit || null;
      try { return hubRosterWriteGate_('people', action); } finally { HUB_MEMBER_CTX = null; }
    };
    var gateWord = function (g) { return g ? String(g.status) : 'open'; };
    HUB_IS_SERVICE_REQ = false;
    var staffS = { id: 'u-ann', email: 'ann@example.org', role: 'staff' };
    var mgrS = { id: 'u-mia', email: 'mia@example.org', role: 'manager' };
    var admS = { id: 'u-ada', email: 'ada@example.org', role: 'admin' };
    stEq_(out, 'roster gate: a staff session writes no roster row — create, update or delete',
          [gateOf(staffS, 'create'), gateOf(staffS, 'update'), gateOf(staffS, 'delete')].map(gateWord).join(','), '403,403,403');
    stEq_(out, 'roster gate: reading the roster is not refused here',
          gateWord(gateOf(staffS, 'list')) + ',' + gateWord(gateOf(staffS, 'get')), 'open,open');
    stEq_(out, 'roster gate: a manager and an admin write it',
          [gateOf(mgrS, 'update'), gateOf(admS, 'create'), gateOf(admS, 'delete')].map(gateWord).join(','), 'open,open,open');
    stEq_(out, 'roster gate: no resolved session writes nothing', gateWord(gateOf(null, 'update')), '403');
    stEq_(out, 'roster gate: nor does the service identity', gateWord(gateOf({ is_service: true, role: 'admin' }, 'update')), '403');
    HUB_IS_SERVICE_REQ = true;
    stEq_(out, 'roster gate: nor any session on a service request', gateWord(gateOf(admS, 'update')), '403');
    HUB_IS_SERVICE_REQ = false;
    stEq_(out, 'roster gate: an admin visiting a staff member writes as that staff member',
          gateWord(gateOf(admS, 'update', { memberId: 'mem_st', userId: 'u-ann', role: 'staff' })), '403');
    stEq_(out, 'roster gate: an admin visiting a manager writes as a manager',
          gateWord(gateOf(admS, 'update', { memberId: 'mem_st', userId: 'u-mia', role: 'manager' })), 'open');
    HUB_SESSION_USER = staffS;
    stEq_(out, 'roster gate: another resource is not the roster', gateWord(hubRosterWriteGate_('teamTasks', 'update')), 'open');
    stEq_(out, 'roster gate: route()\'s place door asks it before anything else',
          gateWord(hubPlaceGate_('people', 'update', { id: 'p-ann', name: 'X' })), '403');
    var wrote = [];
    HUB_WORLD_CTX = null;
    HUB_TENANT_CTX = null;
    hubDynamicResources_ = function () { return {}; };
    appBuilderRegisterResources_ = function () {};
    updateRowById_ = function (res, p) { wrote.push('update:' + res + ':' + p.id); return { id: p.id }; };
    createRow_ = function (res) { wrote.push('create:' + res); return { id: 'new' }; };
    deleteRowById_ = function (res, id) { wrote.push('delete:' + res + ':' + id); return {}; };
    var staffU = who('u-att', 'Att Acker', 'att@example.org', 'staff');
    HUB_SESSION_USER = staffU;
    var rw = [route('people', 'update', { id: 'p-vic', email: 'att@example.org' }, staffU),
              route('people', 'create', { name: 'Vic Tim', email: 'att@example.org' }, staffU),
              route('people', 'delete', { id: 'p-vic' }, staffU)];
    stAssert_(out, 'roster gate: through route(), a staff account cannot write its sign-in e-mail onto another person\'s ' +
              'roster row, add one or remove one — nothing is written',
              rw.every(function (r) { return r && r.status === 403; }) && wrote.length === 0, JSON.stringify({ rw: rw, wrote: wrote }));
    var mgrU = who('u-mia', 'Mia Manager', 'mia@example.org', 'manager');
    HUB_SESSION_USER = mgrU;
    var mw = route('people', 'update', { id: 'p-vic', email: 'vic@example.org' }, mgrU);
    stAssert_(out, 'roster gate: a manager\'s write reaches the roster', !!mw && mw.status === 200 &&
              wrote.join('|') === 'update:people:p-vic', JSON.stringify({ mw: mw, wrote: wrote }));
    HUB_SESSION_USER = null;
    // every account the resolution answers — a later kind of session included — is noted; anything else is null
    var sessionReturns = (stCode_(sessionUser_).match(/\breturn\b[^;]*;/g) || []).map(function (r) {
      return r.replace(/^return\s*/, '').replace(/;$/, '').trim();
    });
    var placeSrc = stCode_(hubPlaceGate_), rosterAt = placeSrc.indexOf('hubRosterWriteGate_(resource, action)');
    stAssert_(out, 'roster gate: the session is noted on every answer that resolves it and cleared at every entry',
              stCode_(sessionUser_).indexOf('HUB_SESSION_USER = null') !== -1 &&
              sessionReturns.filter(function (r) { return r.indexOf('hubSessionNote_(') === 0; }).length >= 2 &&
              sessionReturns.every(function (r) { return r === 'null' || r.indexOf('hubSessionNote_(') === 0; }) &&
              stCode_(hubPropsBoot_).indexOf('HUB_SESSION_USER = null') !== -1 && rosterAt !== -1,
              JSON.stringify(sessionReturns));
    stAssert_(out, 'roster gate: a gate that refuses an acting session\'s writes outright stays ahead of it',
              placeSrc.indexOf('beAnotherResourceGate_') === -1 || placeSrc.indexOf('beAnotherResourceGate_') < rosterAt, '');

    // --- the requirement states: every person's certification expiries are the master's, anyone else reads their own ---
    var stateReads = [], statesDown = false;
    var sOld = ['person_key', 'person_name', 'req_id', 'state', 'expires', 'days_left', 'prev_state', 'since',
                'computed_at', 'tenant', 'login'];
    var sRows = [
      ['annable', 'Ann Able', 'cpr', 'expired', '2024-01-01', '-900', 'ok', '2025-01-01', '2026-01-01', '', 'ann.roster@example.org'],
      ['benbaker', 'Ben Baker', 'dodd', 'expiring', '2026-10-01', '5', 'ok', '2026-01-01', '2026-01-01', '', ''],
      ['miamanager', 'Mia Manager', 'cpr', 'ok', '2027-01-01', '400', '', '2026-01-01', '2026-01-01', '', 'mia.roster@example.org'],
      ['', 'mia  MANAGER', 'dodd', 'missing', '', '', '', '2026-01-01', '2026-01-01', '', '']
    ];
    var sHdr = sOld, sVals = sRows;
    reqStatesListValues_ = function (newest) {
      stateReads.push(newest);
      return statesDown ? null : { hdr: sHdr, values: sVals };
    };
    var stateKeys = function (answer) {
      return (answer && answer.data && answer.data.rows || []).map(function (r) { return r.person_name + '/' + r.req_id; }).join(',');
    };
    var allStates = HUB_ACTIONS.requirementStatesList({ limit: 2000 }, boss);
    stEq_(out, 'requirement states: the master reads every person\'s states, newest first, from the newest 5000 rows',
          allStates.status + ' ' + allStates.data.scope + ' ' + stateKeys(allStates) + ' ' + stateReads.join(','),
          '200 all mia  MANAGER/dodd,Mia Manager/cpr,Ben Baker/dodd,Ann Able/cpr 5000');
    stateReads = [];
    var miaStates = HUB_ACTIONS.requirementStatesList({ limit: 2000 }, mia);
    stEq_(out, 'requirement states: a manager who is not the master reads only their own, in any spelling of their ' +
          'roster name, from the whole tab', miaStates.status + ' ' + miaStates.data.scope + ' ' + miaStates.data.self + ' ' +
          stateKeys(miaStates) + ' ' + stateReads.join(','), '200 own Mia Manager mia  MANAGER/dodd,Mia Manager/cpr 0');
    stAssert_(out, 'requirement states: no other person\'s state, expiry or e-mail reaches that answer',
              JSON.stringify(miaStates).indexOf('Ben Baker') === -1 && JSON.stringify(miaStates).indexOf('2026-10-01') === -1 &&
              JSON.stringify(miaStates).indexOf('ann.roster') === -1 && JSON.stringify(allStates).indexOf('@') === -1,
              JSON.stringify(miaStates));
    stEq_(out, 'requirement states: a person named in the payload never widens an own answer',
          stateKeys(HUB_ACTIONS.requirementStatesList({ person: 'ben' }, mia)), '');
    stEq_(out, 'requirement states: the master\'s state filter still narrows',
          stateKeys(HUB_ACTIONS.requirementStatesList({ state: 'expiring' }, boss)), 'Ben Baker/dodd');
    sHdr = ['login'].concat(sOld.slice(0, 10));
    sVals = sRows.map(function (r) { return [r[10]].concat(r.slice(0, 10)); });
    stEq_(out, 'requirement states: rows are read by header name, so a tab with `login` first reads the same',
          stateKeys(HUB_ACTIONS.requirementStatesList({}, mia)) + ' ' +
          (HUB_ACTIONS.requirementStatesList({ state: 'expired' }, boss).data.rows[0] || {}).expires,
          'mia  MANAGER/dodd,Mia Manager/cpr 2024-01-01');
    sHdr = sOld;
    sVals = sRows;
    stateReads = [];
    var adaStates = HUB_ACTIONS.requirementStatesList({}, ada);
    stAssert_(out, 'requirement states: an admin who is not the master and is on no roster row is refused, as their own ' +
              'scope, before the tab is read', refused(adaStates, 403, /not on the staff roster/) && adaStates.scope === 'own' &&
              !stateReads.length, JSON.stringify(adaStates));
    stEq_(out, 'requirement states: a staff member is not answered at all', HUB_ACTIONS.requirementStatesList({}, ann).status, 403);
    HUB_MEMBER_CTX = { memberId: 'mem_selftest', userId: 'u-mia', email: 'mia@example.org', role: 'manager' };
    try {
      stAssert_(out, 'requirement states: an open visit is not the master',
                scopeOf(HUB_ACTIONS.requirementStatesList({}, boss)) !== 'all', '');
    } finally { HUB_MEMBER_CTX = null; }
    statesDown = true;
    var shutStates = HUB_ACTIONS.requirementStatesList({}, mia), shutAllStates = HUB_ACTIONS.requirementStatesList({}, boss);
    stAssert_(out, 'requirement states: an unreadable tab is a 503 typed with the scope asked, never an empty matrix',
              shutStates.status === 503 && !shutStates.data && shutStates.scope === 'own' &&
              shutAllStates.status === 503 && shutAllStates.scope === 'all', JSON.stringify([shutStates, shutAllStates]));
    statesDown = false;
    stAssert_(out, 'requirement states: whose rows are settled before the tab is read',
              stCode_(HUB_ACTIONS.requirementStatesList).indexOf('complianceWhose_(user)') !== -1 &&
              stCode_(HUB_ACTIONS.requirementStatesList).indexOf('complianceWhose_(user)') <
                stCode_(HUB_ACTIONS.requirementStatesList).indexOf('reqStatesListValues_('), '');

    // --- an older link never lets its account take the row's name, so a rename cannot re-arm it ---
    var rRoster = [{ id: 'p-att', name: 'Att Acker', status: 'Active' },
                   { id: 'p-vic', name: 'Vic Tim', status: 'Active' },
                   { id: 'p-rae', name: 'Rae Row', email: 'rae@example.org', status: 'Active' },
                   { id: 'p-pru', name: 'Pru Proof', status: 'Active' }];
    var rAccounts = [acct('u-att', 'Att Acker', 'att@example.org', { peopleid: 'p-vic' }),
                     acct('u-rae', 'R', 'rae@example.org', { peopleid: 'p-rae' }),
                     acct('u-pru', 'P', 'pru@example.org', { peopleid: 'p-pru', contactsources: proven('email') })];
    var profileWrites = [];
    usersAll_ = function () { return rAccounts; };
    commBroadcastPeopleRows_ = function () { return rRoster; };
    commBroadcastCalendar_ = function () { return { readable: true, houses: {} }; };
    userSetFields_ = function (uid, fields) { profileWrites.push(uid + ':' + JSON.stringify(fields)); return true; };
    complianceDocsPeople_ = function () { return rRoster; };
    complianceDocsAccounts_ = function () { return rAccounts; };
    ledger.push({ id: 'c9', person: 'Vic Tim', cert: 'CPR / First Aid', name: 'vic.pdf', url: 'u9', by: 'mia@example.org', at: '2026-01-09' });
    try {
      stEq_(out, 'legacy link: a proved link, or one whose row carries the sign-in e-mail, still makes the row\'s name ' +
            'the account\'s', '[' + hubSelfNameRefused_('u-pru', 'Pru Proof') + '|' + hubSelfNameRefused_('u-rae', 'Rae Row') + ']', '[|]');
      stAssert_(out, 'legacy link: a link with no proof never lets the account take its row\'s name',
                /staff roster/.test(hubSelfNameRefused_('u-att', 'Vic Tim')), hubSelfNameRefused_('u-att', 'Vic Tim'));
      var attU = who('u-att', 'Att Acker', 'att@example.org', 'staff', { people_id: 'p-vic' });
      var door = HUB_ACTIONS.profileUpdate({ display_name: 'Vic Tim' }, attU);
      stEq_(out, 'legacy link: the profile door answers the rename 409 and writes nothing',
            door.status + ' ' + profileWrites.length, '409 0');
      before = ledgerReads;
      stAssert_(out, 'legacy link: before the rename the ledger refuses it',
                refused(HUB_ACTIONS.certUploadsList({}, attU), 403, /older rule/), '');
      // a name that arrived anyway (an administrator's pen, or before the guard held) still proves nothing
      rAccounts[0] = acct('u-att', 'Vic Tim', 'att@example.org', { peopleid: 'p-vic' });
      var renamedU = who('u-att', 'Vic Tim', 'att@example.org', 'staff', { people_id: 'p-vic' });
      var afterRename = HUB_ACTIONS.certUploadsList({}, renamedU);
      stAssert_(out, 'legacy link: and after a rename to the row\'s name it still refuses — no upload, no Drive link',
                refused(afterRename, 403, /older rule/) && ids(afterRename) === '' && ledgerReads === before,
                JSON.stringify(afterRename));
      filed = [];
      stEq_(out, 'legacy link: and files nothing under that name',
            HUB_ACTIONS.certDocUpload(pdf(), renamedU).status + ' ' + filed.length, '403 0');
      stAssert_(out, 'legacy link: the tracker follows the same identity',
                refused(HUB_ACTIONS.certTrackerList({ view: 'certs' }, renamedU), 403, /older rule/), '');
      var rPlan = contactsMergePlan_([{ userid: 'u-att', email: 'att@example.org', displayname: 'Vic Tim', role: 'staff',
                                        peopleid: 'p-vic' }], rRoster, '2026-01-01T00:00:00Z', { active: true, admin: true });
      stAssert_(out, 'legacy link: the next merge pass never makes that link proved by the name',
                !rPlan.plan.length &&
                rPlan.confirm.indexOf('Vic Tim ~ Vic Tim (linked by an older rule: its sign-in e-mail is not on the row)') !== -1,
                JSON.stringify(rPlan));
    } finally {
      ledger.pop();
    }

    // --- a name the account chose itself bridges by name to nobody: it may have been taken before its row landed ---
    var nRoster = [{ id: 'p-nia', name: 'Nia New', status: 'Active' },
                   { id: 'p-oma', name: 'Oma Own', email: 'oma@example.org', status: 'Active' }];
    var nAccounts = [acct('u-sq', 'Nia New', 'sq@example.org', { nameby: 'self' }),
                     acct('u-oma', 'Oma Own', 'oma@example.org', { nameby: 'self' })];
    complianceDocsPeople_ = function () { return nRoster; };
    complianceDocsAccounts_ = function () { return nAccounts; };
    ledger.push({ id: 'c11', person: 'Nia New', cert: 'CPR / First Aid', name: 'nia.pdf', url: 'u11', by: 'mia@example.org', at: '2026-01-11' });
    try {
      var sqU = who('u-sq', 'Nia New', 'sq@example.org', 'staff');
      before = ledgerReads;
      var squat = HUB_ACTIONS.certUploadsList({}, sqU);
      stAssert_(out, 'self-chosen name: an account that chose a roster row\'s name itself reads none of that person\'s ' +
                'uploads, and is told why', refused(squat, 403, /chosen on your own account/) && ledgerReads === before,
                JSON.stringify(squat));
      filed = [];
      stEq_(out, 'self-chosen name: and files nothing under it', HUB_ACTIONS.certDocUpload(pdf(), sqU).status + ' ' + filed.length, '403 0');
      var omaOwn = HUB_ACTIONS.certUploadsList({}, who('u-oma', 'Oma Own', 'oma@example.org', 'staff'));
      stEq_(out, 'self-chosen name: the sign-in e-mail on the row still bridges, whoever chose the name',
            omaOwn.status + ' ' + (omaOwn.data && omaOwn.data.self), '200 Oma Own');
      nAccounts[0] = acct('u-sq', 'Nia New', 'sq@example.org');
      var vouchedName = HUB_ACTIONS.certUploadsList({}, sqU);
      stEq_(out, 'self-chosen name: a name an administrator set bridges as before', vouchedName.status + ' ' + ids(vouchedName), '200 c11');
      var nPlan = contactsMergePlan_([{ userid: 'u-sq', email: 'sq@example.org', displayname: 'Nia New', role: 'staff', nameby: 'self' }],
                                     nRoster, '2026-01-01T00:00:00Z', { active: true, admin: true });
      stAssert_(out, 'self-chosen name: the merge never links by a name the account chose itself, and says so',
                !nPlan.plan.length && nPlan.confirm.indexOf('Nia New ~ Nia New (the account chose that name itself)') !== -1,
                JSON.stringify(nPlan));
      var nPlan2 = contactsMergePlan_([{ userid: 'u-sq', email: 'sq@example.org', displayname: 'Nia New', role: 'staff' }],
                                      nRoster, '2026-01-01T00:00:00Z', { active: true, admin: true });
      stEq_(out, 'self-chosen name: a name an administrator set still links by the exact name',
            (nPlan2.plan[0] || {}).people_id + ':' + (nPlan2.plan[0] || {}).matched_by, 'p-nia:name');
    } finally {
      ledger.pop();
    }
    usersAll_ = function () { return [acct('u-pf', 'Pat Free', 'pf@example.org')]; };
    commBroadcastPeopleRows_ = function () { return []; };
    profileWrites = [];
    var pf = who('u-pf', 'Pat Free', 'pf@example.org', 'staff');
    HUB_ACTIONS.profileUpdate({ display_name: 'Patty Free' }, pf);
    HUB_ACTIONS.profileUpdate({ display_name: 'pat  FREE', title: 'Lead' }, pf);
    HUB_ACTIONS.profileUpdate({ title: 'Lead' }, pf);
    stEq_(out, 'self-chosen name: the profile door marks a name the account changes itself, and only a change',
          profileWrites.map(function (w) { return /"name_by":"self"/.test(w) ? 'self' : 'kept'; }).join(','), 'self,kept,kept');
    stAssert_(out, 'self-chosen name: an invitee\'s own name is marked, and an administrator\'s save of a name vouches for it',
              stCode_(inviteRegisterPub_).indexOf('put(\'nameby\'') !== -1 &&
              stCode_(HUB_ACTIONS.userUpdate).indexOf('set(\'nameby\', \'\')') !== -1 &&
              USER_PROFILE_COLUMNS.indexOf('name_by') !== -1, '');
    usersAll_ = keep.users;
    commBroadcastPeopleRows_ = keep.bPeople;
    commBroadcastCalendar_ = keep.bCal;
    userSetFields_ = keep.setFields;
    complianceDocsPeople_ = function () { if (rosterDown) throw new Error('roster down'); return roster; };
    complianceDocsAccounts_ = function () { if (accountsDown) throw new Error('accounts down'); return accounts; };

    // --- the list never reads a person out of the payload, and "the real master" is one predicate ---
    stAssert_(out, 'cert privacy: certUploadsList reads no person from the payload',
              stCode_(HUB_ACTIONS.certUploadsList).indexOf('payload.person') === -1, '');
    stAssert_(out, 'cert privacy: the ledger and App Control ask the same real-master question (Auth.gs hubIsRealMaster_)',
              stCode_(HUB_ACTIONS.certUploadsList).indexOf('hubIsRealMaster_(user)') !== -1 &&
              stCode_(complianceDocsFilesForOthers_).indexOf('hubIsRealMaster_(user)') !== -1 &&
              stCode_(appAccessMayEdit_).indexOf('hubIsRealMaster_(user)') !== -1, '');
  } finally {
    complianceDocsRows_ = keep.rows;
    complianceDocsPeople_ = keep.people;
    complianceDocsAccounts_ = keep.accounts;
    complianceDocsStore_ = keep.store;
    certMatrixRows_ = keep.matrix;
    staffCertRows_ = keep.certs;
    cgBlockStatuses_ = keep.onStaff;
    complianceDocsMasterRow_ = keep.masterRow;
    complianceActiveRows_ = keep.active;
    HUB_MASTER_EMAIL_CACHE = keep.master;
    HUB_MEMBER_CTX = keep.member;
    HUB_SESSION_USER = keep.session;
    HUB_IS_SERVICE_REQ = keep.svc;
    HUB_WORLD_CTX = keep.world;
    HUB_TENANT_CTX = keep.tenant;
    hubDynamicResources_ = keep.dyn;
    appBuilderRegisterResources_ = keep.builder;
    updateRowById_ = keep.update;
    createRow_ = keep.create;
    deleteRowById_ = keep.remove;
    usersAll_ = keep.users;
    commBroadcastPeopleRows_ = keep.bPeople;
    commBroadcastCalendar_ = keep.bCal;
    userSetFields_ = keep.setFields;
    reqStatesListValues_ = keep.states;
  }
}
