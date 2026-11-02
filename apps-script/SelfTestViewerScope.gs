/** Viewer scope: the master, the App Control row, the client, family and the SSA behind GUARDIAN, the staff. */
function stViewerScope_(out) {
  var P = 'viewer scope: ';
  if (typeof hubViewerScope_ !== 'function' || typeof hubProfileAppGate_ !== 'function' ||
      typeof hubStaffVisibleForHouses_ !== 'function') {
    stAssert_(out, P + 'ViewerScope.gs declares the three helpers', false, 'missing');
    return;
  }
  var keep = {
    rules: hubProfileAppRules_, rulesRead: hubProfileAppRulesRead_, clientRows: locationsClientRows_,
    homes: locationsHomes_, ssa: ssaIndex_, users: usersAll_, ist: locationsIstRows_, cal: locationsCalendar_,
    punches: locationsPunches_, today: locationsToday_, prop: hubProp_, member: HUB_MEMBER_CTX,
    masterCache: HUB_MASTER_EMAIL_CACHE, memo: HUB_VIEWER_MEMO, derived: clientsDerived_, master: cpMasterIndex_
  };
  var fresh = function () { HUB_VIEWER_MEMO = null; HUB_MEMBER_CTX = null; };
  var j = function (x) { return JSON.stringify(x); };
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    fresh();

    stAssert_(out, P + 'SSA is no badge: SSAs wear GUARDIAN, and a cell holding SSA is reported, never kept',
              HUB_USER_TYPES.indexOf('SSA') === -1 && userTypesFromRaw_('SSA').bad.join() === 'SSA' &&
              HUB_VIEWER_OPENS.ssa.join() === 'GUARDIAN', j(HUB_USER_TYPES));

    // ---- fixtures ----
    var RULES = { rules: {}, tenants: {} };
    var rulesBroken = false;
    hubProfileAppRules_ = function () {
      if (rulesBroken) throw new Error('st: App Control unreadable');
      return RULES;
    };
    var clientReads = 0;
    locationsClientRows_ = function () {
      clientReads++;
      return [
        { client_key: 'kay9test', name: 'Kay9 Test', house: 'ZZ9999', home_address: '9999 Test Ave NW', status: 'active' },
        { client_key: 'lee9other', name: 'Lee9 Other', house: '', home_address: '1000 Queue St, Apt B', status: 'active' },
        { client_key: 'pat9solo', name: 'Pat9 Solo', house: 'QQ1000', home_address: '', status: 'active' },
        { client_key: 'mo9late', name: 'Mo9 Late', house: 'RR2000', home_address: '', status: 'active' },
        { client_key: 'old9gone', name: 'Old9 Gone', house: 'ZZ9999', home_address: '', status: 'inactive' }
      ];
    };
    locationsHomes_ = function () {
      return [{ code: 'ZZ9999', home_name: 'ZZ - Test House', address: '9999 Test Ave NW' },
              { code: 'QQ1000', home_name: 'QQ - Queue House', address: '1000 Queue St, Apt B' }];
    };
    // the guardian each ward's record names: the Hub row, else the Asa Client Database row
    clientsDerived_ = function () {
      return [{ client_key: 'kay9test', name: 'Kay9 Test', guardianName: 'Self' },
              { client_key: 'lee9other', name: 'Lee9 Other', guardianName: 'Gia9 Guardian' },
              { client_key: 'pat9solo', name: 'Pat9 Solo', guardianName: '' }];
    };
    cpMasterIndex_ = function () {
      return { rows: { pat9solo: { ambiguous: false, fields: { guardian_name: 'Pa9 Parent (father)' } } } };
    };
    var DENISE = 'denise9.alvarez@starkdd.org';
    var INDEX = {
      ssas: {
        ssa_denise9alvarez: { key: 'ssa_denise9alvarez', name: 'Denise9 Alvarez', emails: [DENISE], phones: [],
                              clients: [
          { client_key: 'kay9test', ssa_email: DENISE, archived: false },
          { client_key: 'lee9other', ssa_email: '', archived: false },
          { client_key: 'old9gone', ssa_email: DENISE, archived: true },
          // set inactive by the door: not archived, and no longer live
          { client_key: 'ina9door', ssa_email: DENISE, archived: false, status: 'inactive' }] },
        ssa_rex9retired: { key: 'ssa_rex9retired', name: 'Rex9 Retired', emails: ['rex9@stardd.org'], phones: [],
                           clients: [{ client_key: 'pat9solo', ssa_email: 'rex9@stardd.org', archived: false },
                                     { client_key: 'rex9door', ssa_email: 'rex9@stardd.org', archived: false,
                                       status: 'inactive' }] },
        ssa_sam9twin: { key: 'ssa_sam9twin', name: 'Sam9 Twin', emails: ['sam9a@x.test', 'sam9b@y.test'], phones: [],
                        clients: [
          { client_key: 'mo9late', ssa_email: 'sam9a@x.test', archived: false },
          { client_key: 'nia9none', ssa_email: 'sam9b@y.test', archived: false },
          { client_key: 'zed9blank', ssa_email: '', archived: false }] },
        // two SSAs with one name and no e-mail on their records, told apart only by their phones
        ssa_ned9twin: { key: 'ssa_ned9twin', name: 'Ned9 Twin', emails: [], phones: ['3305550101', '3305550102'],
                        clients: [{ client_key: 'ned9ward', ssa_email: '', archived: false }] },
        ssa_uma9unclaimed: { key: 'ssa_uma9unclaimed', name: 'Uma9 Unclaimed', emails: ['uma9@county.test'],
                             phones: [], clients: [{ client_key: 'uma9ward', ssa_email: 'uma9@county.test',
                                                     archived: false }] }
      },
      why: [], degraded: false
    };
    var index = INDEX, indexReads = 0;
    ssaIndex_ = function () { indexReads++; if (!index) throw new Error('st: records unreadable'); return index; };
    var row = function (id, email, name, role, types, extra) {
      var r = { userid: id, email: email, displayname: name, role: role, types: types, active: 'true',
                appdenials: '', nameby: '' };
      Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; });
      return r;
    };
    var ACCOUNTS = [
      row('u-kay', 'kay9@x.test', 'Kay9 Test', 'client', 'CLIENT', { clientkey: 'kay9test' }),
      row('u-gia', 'gia9@x.test', 'Gia9 Guardian (mother)', 'client', 'GUARDIAN', { clientkey: 'lee9other' }),
      row('u-giaself', 'gs9@x.test', 'Gia9 Guardian', 'client', 'GUARDIAN', { clientkey: 'lee9other', nameby: 'self' }),
      row('u-olga', 'olga9@x.test', 'Olga9 Other', 'client', 'GUARDIAN', { clientkey: 'lee9other' }),
      row('u-pa', 'pa9@x.test', 'Pa9 Parent', 'client', 'GUARDIAN', { clientkey: 'pat9solo' }),
      row('u-den', DENISE, 'D Alvarez', 'staff', 'GUARDIAN'),
      row('u-sama', 'sam9a@x.test', 'Sam A', 'staff', 'GUARDIAN'),
      row('u-rex', 'rex9.personal@x.test', 'Rex9 Retired', 'staff', 'GUARDIAN'),
      row('u-samn', 'sam9c@z.test', 'Sam9 Twin', 'staff', 'GUARDIAN'),
      row('u-ned', 'ned9@z.test', 'Ned9 Twin', 'staff', 'GUARDIAN'),
      row('u-uma', 'uma9.home@z.test', 'Uma9 Unclaimed', 'staff', 'GUARDIAN', { nameby: 'self' }),
      row('u-nob', 'nobody9@x.test', 'Nobody9 Here', 'staff', 'GUARDIAN'),
      row('u-eve', 'eve9@x.test', 'Eve9 Else', 'staff', 'GUARDIAN', { emails: j([DENISE]) }),
      row('u-bo', 'bo9@asa.test', 'Bo9 Both', 'staff', 'STAFF, GUARDIAN')
    ];
    var accounts = ACCOUNTS, accountsBroken = false;
    usersAll_ = function () { if (accountsBroken) throw new Error('st: accounts unreadable'); return accounts; };

    var master = { id: 'u-master', email: HUB_MASTER_ACCOUNT, role: 'admin', display_name: 'The Master', types: [] };
    var staff = { id: 'u-staff', email: 'sally9@asa.test', role: 'staff', types: ['STAFF'], display_name: 'Sally9 Staff' };
    var kay = { id: 'u-kay', email: 'kay9@x.test', role: 'client', types: ['CLIENT'], client_key: 'kay9test',
                display_name: 'Kay9 Test' };
    var unlinked = { id: 'u-nokey', email: 'nk9@x.test', role: 'client', types: ['CLIENT'], client_key: '',
                     display_name: 'No9 Key' };
    var staffyClient = { id: 'u-kay2', email: 'kay2@x.test', role: 'client', types: ['CLIENT', 'STAFF'],
                         client_key: 'kay9test', display_name: 'Kay9 Two' };
    var guardianOf = function (id, email, name, key) {
      return { id: id, email: email, role: 'client', types: ['GUARDIAN'], client_key: key, display_name: name };
    };
    var gia = guardianOf('u-gia', 'gia9@x.test', 'Gia9 Guardian (mother)', 'lee9other');
    var giaSelf = guardianOf('u-giaself', 'gs9@x.test', 'Gia9 Guardian', 'lee9other');
    var olga = guardianOf('u-olga', 'olga9@x.test', 'Olga9 Other', 'lee9other');
    var pa = guardianOf('u-pa', 'pa9@x.test', 'Pa9 Parent', 'pat9solo');
    // an SSA's account: GUARDIAN on a staff role, which is also what a blank role reads as
    var guardianStaff = function (id, email, name) {
      return { id: id, email: email, role: 'staff', types: ['GUARDIAN'], display_name: name };
    };
    var denise = guardianStaff('u-den', ' Denise9.Alvarez@StarkDD.org ', 'D Alvarez');
    var samA = guardianStaff('u-sama', 'sam9a@x.test', 'Sam A');
    var rex = guardianStaff('u-rex', 'rex9.personal@x.test', 'Rex9 Retired');
    var samByName = guardianStaff('u-samn', 'sam9c@z.test', 'Sam9 Twin');
    var ned = guardianStaff('u-ned', 'ned9@z.test', 'Ned9 Twin');
    var uma = guardianStaff('u-uma', 'uma9.home@z.test', 'Uma9 Unclaimed');
    var nobody = guardianStaff('u-nob', 'nobody9@x.test', 'Nobody9 Here');
    var eve = guardianStaff('u-eve', 'eve9@x.test', 'Eve9 Else');
    eve.emails = [DENISE];
    var bo = { id: 'u-bo', email: 'bo9@asa.test', role: 'staff', types: ['STAFF', 'GUARDIAN'], display_name: 'Bo9 Both' };
    // a badge that currently stands in for another, read from the table so the two can still part
    var follower = Object.keys(HUB_BADGE_FOLLOWS)[0] || '';
    var followed = follower ? HUB_BADGE_FOLLOWS[follower] : '';
    var wearer = { id: 'u-tl', email: 'tl9@asa.test', role: 'staff', types: follower ? [follower] : [],
                     display_name: 'Tl9 Lead' };
    var APP = 'client-profiles';
    var gate = function (u) { fresh(); return hubProfileAppGate_(APP, u); };
    var scope = function (u) { fresh(); return hubViewerScope_(u); };
    var shape = function (s) {
      return s.kind + '|' + s.client_keys.join(',') + '|' + s.house_codes.join(',') + '|' + s.ssa_keys.join(',') + '|' +
             s.family_keys.join(',');
    };

    // ---- the master ----
    RULES = { rules: {}, tenants: {} };
    var mg = gate(master);
    stAssert_(out, P + 'the real master opens an app with no App Control row, and sees everything',
              mg.open === true && mg.scope.kind === 'master' && scope(master).kind === 'master', j(mg));
    HUB_MEMBER_CTX = { memberId: 'mem_st', userId: 'u-kay', email: 'kay9@x.test' };
    var mInVisit = hubProfileAppGate_(APP, master);
    var sInVisit = hubViewerScope_(master);
    HUB_MEMBER_CTX = null;
    var visitMaster = gate({ id: 'u-master', email: HUB_MASTER_ACCOUNT, role: 'admin', types: [],
                             visiting_member: 'mem_1' });
    stAssert_(out, P + 'inside a visit the master is never the master: a visit with no visited row, or a master ' +
                   'session under a visit context, is shut and sees nobody',
              mInVisit.open === false && sInVisit.kind === 'none' && visitMaster.open === false &&
              visitMaster.scope.kind === 'none', j([mInVisit, sInVisit, visitMaster]));

    // ---- an unreleased app ----
    clientReads = 0; indexReads = 0;
    var shutAll = [staff, kay, gia, denise, wearer].map(gate);
    stAssert_(out, P + 'an app with no App Control row is shut to staff, a client, family, an SSA and a follower ' +
                   '— and no client or SSA record is read to say so',
              shutAll.every(function (g) { return g.open === false && g.scope.kind === 'none'; }) &&
              clientReads === 0 && indexReads === 0, j(shutAll));

    // ---- CLIENT ----
    RULES = { rules: { 'client-profiles': ['CLIENT'] }, tenants: {} };
    var gk = gate(kay);
    stAssert_(out, P + 'released to CLIENT: the client opens it on their own key, their own house and their SSA — ' +
                   'no family record of their own',
              gk.open === true && shape(gk.scope) === 'client|kay9test|ZZ9999|ssa_denise9alvarez|', j(gk));
    var gina = gate({ id: 'u-ina', email: 'ina9@x.test', role: 'client', types: ['CLIENT'], client_key: 'ina9door',
                      display_name: 'Ina9 Door' });
    stAssert_(out, P + 'released to CLIENT: a client the door set inactive keeps its own key, and its SSA no longer ' +
                   'answers it',
              gina.open === true && shape(gina.scope) === 'client|ina9door|||', j(gina));
    indexReads = 0;
    var gu = gate(unlinked), gs = gate(staff), gd = gate(denise);
    stAssert_(out, P + 'released to CLIENT: an unlinked client, a staff member and an SSA stay shut — the SSA ' +
                   'without a record read',
              gu.open === false && gu.scope.kind === 'none' && /not linked/.test(gu.scope.why) &&
              gs.open === false && gd.open === false && indexReads === 0, j([gu, gs, gd]));
    var gg = gate(gia);
    stAssert_(out, P + 'released to CLIENT: family, a client-role GUARDIAN no record names as an SSA, opens it for ' +
                   'their ward — the house found by the registry address, and the family record the ward\'s own ' +
                   'record names',
              gg.open === true && shape(gg.scope) === 'guardian|lee9other|QQ1000|ssa_denise9alvarez|fam_gia9guardian',
              j(gg));
    var gpa = gate(pa);
    stAssert_(out, P + 'family: when the ward\'s Hub row names no guardian, the Asa Client Database row does',
              gpa.open === true && shape(gpa.scope) === 'guardian|pat9solo|QQ1000|ssa_rex9retired|fam_pa9parent',
              j(gpa));
    var gself = gate(giaSelf), golga = gate(olga);
    stAssert_(out, P + 'family: a name the account chose itself, or one the ward\'s record does not name as ' +
                   'guardian, is no family record — the ward is still theirs',
              gself.open === true && shape(gself.scope) === 'guardian|lee9other|QQ1000|ssa_denise9alvarez|' &&
              /chose its name itself/.test(gself.scope.why) &&
              golga.open === true && shape(golga.scope) === 'guardian|lee9other|QQ1000|ssa_denise9alvarez|' &&
              /does not name this account/.test(golga.scope.why), j([gself, golga]));

    // ---- GUARDIAN ----
    RULES = { rules: { 'client-profiles': ['GUARDIAN'] }, tenants: {} };
    var gGia = gate(gia), gDen = gate(denise);
    stAssert_(out, P + 'released to GUARDIAN alone: family and an SSA both open it, each on their own scope; the ' +
                   'client does not',
              gGia.open === true && gGia.scope.kind === 'guardian' && gDen.open === true &&
              gDen.scope.kind === 'ssa' && gate(kay).open === false, j([gGia, gDen]));
    var gNob = gate(nobody), gBo = gate(bo);
    stAssert_(out, P + 'released to GUARDIAN alone: a staff-role account let in only by GUARDIAN never sees ' +
                   'everything — family on a staff role links no ward and stays shut, STAFF worn beside it or not',
              gNob.open === false && gNob.scope.kind === 'none' && /not linked/.test(gNob.scope.why) &&
              gBo.open === false && gBo.scope.kind === 'none', j([gNob, gBo]));

    // ---- STAFF and the others ----
    RULES = { rules: { 'client-profiles': ['STAFF'] }, tenants: {} };
    var gsc = gate(staffyClient);
    stAssert_(out, P + 'released to STAFF: a client-role account wearing STAFF is still a client, and stays shut',
              gsc.open === false && scope(staffyClient).kind === 'client', j(gsc));
    var gst = gate(staff), gbo = gate(bo);
    stAssert_(out, P + 'released to STAFF: staff open it and see everything, family wearing STAFF too',
              gst.open === true && shape(gst.scope) === 'all||||' && gbo.open === true && gbo.scope.kind === 'all',
              j([gst, gbo]));
    if (follower) {
      RULES = { rules: { 'client-profiles': [followed] }, tenants: {} };
      stAssert_(out, P + 'released to a badge another currently follows: the follower opens it through the fold',
                gate(wearer).open === true && gate(wearer).scope.kind === 'all' && gate(staff).open === false,
                follower + ' → ' + followed);
    }
    RULES = { rules: { 'client-profiles': ['STAFF'] }, tenants: {} };
    var denied = gate({ id: 'u-staff', email: 'sally9@asa.test', role: 'staff', types: ['STAFF'],
                        app_denials: ['client-profiles'] });
    stAssert_(out, P + 'a personal denial shuts it', denied.open === false && /removed/.test(denied.scope.why), j(denied));
    RULES = { rules: { 'client-profiles': ['STAFF'] }, tenants: { 'client-profiles': ['akron'] } };
    var away = gate({ id: 'u-staff', email: 'sally9@asa.test', role: 'staff', types: ['STAFF'], home_tenant: 'canton' });
    stAssert_(out, P + 'a tenant row that leaves out the home tenant shuts it; no home tenant narrows nothing',
              away.open === false && gate(staff).open === true, j(away));
    RULES = { rules: { 'client-profiles': ['STAFF'] }, tenants: {} };
    rulesBroken = true;
    var blind = [gate(staff), gate(master)];
    rulesBroken = false;
    stAssert_(out, P + 'App Control unreadable: shut for staff with the reason, still open for the master',
              blind[0].open === false && /could not be read/.test(blind[0].scope.why) && blind[1].open === true,
              j(blind));
    var denStaff = gate(denise);
    RULES = { rules: { 'client-profiles': ['STAFF', 'GUARDIAN'] }, tenants: {} };
    var denBoth = gate(denise);
    stAssert_(out, P + 'an SSA on a staff role: released to STAFF it stays shut, and released to STAFF and ' +
                   'GUARDIAN it sees only its own clients — never everything',
              denStaff.open === false && denBoth.open === true &&
              shape(denBoth.scope) === 'ssa|kay9test|ZZ9999|ssa_denise9alvarez|', j([denStaff, denBoth]));

    // ---- a wide badge ticked beside a narrow one ---- STAFF ticked beside GUARDIAN, on the sign-in e-mail the SSA…
    var boSsa = { id: 'u-bos', email: DENISE, role: 'staff', types: ['STAFF', 'GUARDIAN'], display_name: 'D Alvarez' };
    RULES = { rules: { 'client-profiles': ['GUARDIAN'] }, tenants: {} };
    var bosGuardian = gate(boSsa);
    RULES = { rules: { 'client-profiles': ['STAFF'] }, tenants: {} };
    var bosStaff = gate(boSsa);
    index = JSON.parse(j(INDEX));
    delete index.ssas.ssa_rex9retired.clients[0].ssa_email;
    var boStale = gate(bo), bosStale = gate(boSsa), denStale = gate(denise);
    index = null;
    var boUnread = gate(bo);
    index = INDEX;
    stAssert_(out, P + 'released to STAFF: STAFF ticked beside GUARDIAN sees everything, whether the SSA records ' +
                   'match the account, are being refreshed or cannot be read; released to GUARDIAN alone the same ' +
                   'account is still only the SSA',
              bosGuardian.open === true && shape(bosGuardian.scope) === 'ssa|kay9test|ZZ9999|ssa_denise9alvarez|' &&
              bosStaff.open === true && shape(bosStaff.scope) === 'all||||' &&
              boStale.open === true && boStale.scope.kind === 'all' &&
              bosStale.open === true && bosStale.scope.kind === 'all' &&
              boUnread.open === true && boUnread.scope.kind === 'all',
              j([bosGuardian, bosStaff, boStale, bosStale, boUnread]));
    stAssert_(out, P + 'released to STAFF: the word a staff role reads as never widens an SSA — GUARDIAN ticked ' +
                   'alone stays shut, and shut on records being refreshed',
              gate(denise).open === false && gate(denise).scope.kind === 'none' &&
              denStale.open === false && /refreshed/.test(denStale.scope.why), j([gate(denise), denStale]));
    var kayStaffGuard = { id: 'u-kay3', email: 'kay3@x.test', role: 'client', types: ['CLIENT', 'STAFF', 'GUARDIAN'],
                          client_key: 'kay9test', display_name: 'Kay9 Three' };
    var scStaff = gate(staffyClient), scStaffGuard = gate(kayStaffGuard);
    RULES = { rules: { 'client-profiles': ['STAFF', 'CLIENT'] }, tenants: {} };
    var scBoth = gate(staffyClient);
    stAssert_(out, P + 'a client-role account wearing STAFF is still narrowed: shut when released to STAFF, GUARDIAN ' +
                   'ticked too, and its own client scope when released to STAFF and CLIENT',
              scStaff.open === false && scStaffGuard.open === false && scStaffGuard.scope.kind === 'none' &&
              scBoth.open === true && shape(scBoth.scope) === 'client|kay9test|ZZ9999|ssa_denise9alvarez|',
              j([scStaff, scStaffGuard, scBoth]));
    if (follower) {
      var leadGuard = { id: 'u-tlg', email: DENISE, role: 'staff', types: [follower, 'GUARDIAN'],
                        display_name: 'D Alvarez' };
      RULES = { rules: { 'client-profiles': [followed] }, tenants: {} };
      var lg = gate(leadGuard);
      stAssert_(out, P + 'released to a badge another follows: the follower ticked beside GUARDIAN sees everything',
                lg.open === true && lg.scope.kind === 'all', follower + ' → ' + followed + ' ' + j(lg));
    }

    // ---- SSA ----
    RULES = { rules: { 'client-profiles': ['GUARDIAN'] }, tenants: {} };
    var gden = gate(denise);
    stAssert_(out, P + 'SSA by sign-in e-mail (case and spaces aside): only the records naming that address — ' +
                   'never one under the same name without it, never an archived client nor one the door set inactive',
              gden.open === true && shape(gden.scope) === 'ssa|kay9test|ZZ9999|ssa_denise9alvarez|', j(gden));
    index = JSON.parse(j(INDEX));
    index.ssas.ssa_denise9alvarez.clients[3].status = 'Active';
    var denBack = gate(denise);
    index.ssas.ssa_denise9alvarez.clients[0].status = 'inactive';
    index.ssas.ssa_denise9alvarez.clients[3].status = 'inactive';
    var denNone = gate(denise);
    index = INDEX;
    stAssert_(out, P + 'SSA: a client set active again is reached again; with every client inactive the SSA is still ' +
                   'itself and reaches no client',
              denBack.open === true && shape(denBack.scope) === 'ssa|ina9door,kay9test|ZZ9999|ssa_denise9alvarez|' &&
              denNone.open === true && shape(denNone.scope) === 'ssa|||ssa_denise9alvarez|', j([denBack, denNone]));
    var gsa = gate(samA);
    stAssert_(out, P + 'SSA by e-mail under a name two e-mails share: only the records naming that address',
              gsa.open === true && shape(gsa.scope) === 'ssa|mo9late|RR2000|ssa_sam9twin|', j(gsa));
    var geve = gate(eve);
    stAssert_(out, P + 'an address the account added to its own profile makes it no SSA',
              geve.open === false && geve.scope.kind === 'none' && /not linked/.test(geve.scope.why), j(geve));
    var grex = gate(rex);
    stAssert_(out, P + 'SSA by name when no record names the e-mail and exactly one SSA carries the name the ' +
                   'account\'s row holds — never a client the door set inactive',
              grex.open === true && shape(grex.scope) === 'ssa|pat9solo|QQ1000|ssa_rex9retired|', j(grex));
    var gtwin = gate(samByName), gned = gate(ned), guma = gate(uma), gnob = gate(nobody);
    stAssert_(out, P + 'SSA by name refused, and shut: a name two e-mails share, two namesakes with no e-mail and ' +
                   'two phones, a name the account chose itself; a name no SSA carries is family, and unlinked',
              gtwin.open === false && gtwin.scope.kind === 'none' && /More than one SSA/.test(gtwin.scope.why) &&
              gned.open === false && gned.scope.kind === 'none' && /More than one SSA/.test(gned.scope.why) &&
              guma.open === false && guma.scope.kind === 'none' && /chose its name itself/.test(guma.scope.why) &&
              gnob.open === false && gnob.scope.kind === 'none' && /not linked/.test(gnob.scope.why),
              j([gtwin, gned, guma, gnob]));
    accounts = ACCOUNTS.concat([row('u-rex2', 'r2@x.test', 'Rex9 Retired', '', '')]);
    var clashName = gate(rex);
    accounts = ACCOUNTS.concat([row('u-rex3', 'rex9@stardd.org', 'Somebody9 Else', '', '')]);
    var clashMail = gate(rex);
    accounts = ACCOUNTS.concat([row('u-rex4', 'r4@x.test', 'Rex9 Retired', '', '', { active: 'false' })]);
    var offClash = gate(rex);
    accountsBroken = true;
    var noAccounts = gate(rex);
    accountsBroken = false;
    accounts = ACCOUNTS;
    stAssert_(out, P + 'SSA by name refused when another live account carries the name or the SSA\'s e-mail, or ' +
                   'the accounts cannot be read; an inactive namesake does not block it',
              clashName.open === false && clashMail.open === false && offClash.open === true &&
              noAccounts.open === false && /could not be read/.test(noAccounts.scope.why),
              j([clashName, clashMail, noAccounts]));
    index = JSON.parse(j(INDEX));
    index.degraded = true;
    index.why = ['st: the archive could not be read.'];
    var degradedName = gate(rex), degradedMail = gate(denise), degradedFamily = gate(gia);
    index = JSON.parse(j(INDEX));
    delete index.ssas.ssa_rex9retired.clients[0].ssa_email;
    var stale = gate(denise);
    index = null;
    var unread = gate(denise), unreadFamily = gate(gia);
    index = INDEX;
    stAssert_(out, P + 'SSA records partly read: still matched by e-mail with the reason, never by name; records ' +
                   'without per-record e-mails or unreadable: an SSA sees nothing; an SSA check that cannot be told ' +
                   'adds nothing and says why, and family still sees its own ward',
              degradedName.open === false && degradedMail.open === true && /archive/.test(degradedMail.scope.why) &&
              degradedFamily.open === true &&
              shape(degradedFamily.scope) === 'guardian|lee9other|QQ1000|ssa_denise9alvarez|fam_gia9guardian' &&
              /cannot be told/.test(degradedFamily.scope.why) &&
              stale.open === false && /refreshed/.test(stale.scope.why) &&
              unread.open === false && /could not be read/.test(unread.scope.why) && unreadFamily.open === true &&
              shape(unreadFamily.scope) === 'guardian|lee9other|QQ1000||fam_gia9guardian' &&
              /could not be read/.test(unreadFamily.scope.why),
              j([degradedName, degradedFamily, stale, unread, unreadFamily]));

    // ---- narrowed scopes add up ---- GUARDIAN on a client link, signed in with the e-mail an SSA's records name…
    var ssaFamily = { id: 'u-dua', email: DENISE, role: 'client', types: ['GUARDIAN'], client_key: 'pat9solo',
                      display_name: 'Pa9 Parent' };
    accounts = ACCOUNTS.concat([row('u-dua', DENISE, 'Pa9 Parent', 'client', 'GUARDIAN', { clientkey: 'pat9solo' })]);
    RULES = { rules: { 'client-profiles': ['GUARDIAN'] }, tenants: {} };
    var sfBoth = gate(ssaFamily);
    RULES = { rules: { 'client-profiles': ['CLIENT'] }, tenants: {} };
    var sfClient = gate(ssaFamily);
    RULES = { rules: { 'client-profiles': ['GUARDIAN'] }, tenants: {} };
    index = JSON.parse(j(INDEX));
    delete index.ssas.ssa_sam9twin.clients[0].ssa_email;
    var sfStale = gate(ssaFamily);
    index = INDEX;
    accounts = ACCOUNTS;
    stAssert_(out, P + 'an SSA who is also family: both scopes together under the SSA\'s kind — its clients and its ' +
                   'ward, their houses, its own SSA key only (a ward\'s SSA is another person) and its family record; released to CLIENT alone, only the ward; ' +
                   'records being refreshed, the ward with the reason',
              sfBoth.open === true && shape(sfBoth.scope) ===
                'ssa|kay9test,pat9solo|QQ1000,ZZ9999|ssa_denise9alvarez|fam_pa9parent' &&
              sfClient.open === true && sfStale.open === true &&
              shape(sfClient.scope) === 'guardian|pat9solo|QQ1000|ssa_rex9retired|fam_pa9parent' &&
              shape(sfStale.scope) === shape(sfClient.scope) && /refreshed/.test(sfStale.scope.why),
              j([sfBoth, sfClient, sfStale]));
    var clientFamily = { id: 'u-gia', email: 'gia9@x.test', role: 'client', types: ['CLIENT', 'GUARDIAN'],
                         client_key: 'lee9other', display_name: 'Gia9 Guardian (mother)' };
    var cfByGuardian = gate(clientFamily);
    RULES = { rules: { 'client-profiles': ['CLIENT'] }, tenants: {} };
    var cfByClient = gate(clientFamily);
    stAssert_(out, P + 'CLIENT and GUARDIAN ticked on one client link: the linked record and the family record the ' +
                   'ward\'s record names, under the family kind, released to either badge',
              cfByGuardian.open === true && cfByClient.open === true &&
              shape(cfByGuardian.scope) === 'guardian|lee9other|QQ1000|ssa_denise9alvarez|fam_gia9guardian' &&
              shape(cfByClient.scope) === shape(cfByGuardian.scope), j([cfByGuardian, cfByClient]));
    RULES = { rules: { 'client-profiles': ['CLIENT'] }, tenants: {} };
    stAssert_(out, P + 'the scope without an app: every badge worn counts — an SSA is still an SSA on a staff role, ' +
                   'STAFF worn beside GUARDIAN is everything',
              shape(scope(kay)) === 'client|kay9test|ZZ9999|ssa_denise9alvarez|' &&
              shape(scope(denise)) === 'ssa|kay9test|ZZ9999|ssa_denise9alvarez|' &&
              scope(bo).kind === 'all' && scope(staff).kind === 'all' && scope(null).kind === 'none' &&
              scope({ is_service: true, email: HUB_MASTER_ACCOUNT, role: 'admin' }).kind === 'none', '');

    // ---- a visit ----
    HUB_VIEWER_MEMO = null;
    HUB_MEMBER_CTX = { memberId: 'mem_1', userId: 'u-kay', email: 'kay9@x.test' };
    var visit = { id: 'u-kay', email: 'kay9@x.test', display_name: 'Kay9 Test', role: 'client', types: [],
                  visiting_member: 'mem_1' };
    var gv = hubProfileAppGate_(APP, visit);
    HUB_MEMBER_CTX = null;
    stAssert_(out, P + 'a visit is the visited account\'s view: its client link and its CLIENT badge read from its ' +
                   'own row, never the master\'s',
              gv.open === true && shape(gv.scope) === 'client|kay9test|ZZ9999|ssa_denise9alvarez|', j(gv));

    // ---- per execution ----
    fresh();
    indexReads = 0;
    hubViewerScope_(denise);
    hubViewerScope_(denise);
    var once = indexReads;
    stAssert_(out, P + 'the scope is held per viewer for the execution, and the first call of a request drops it',
              once === 1 && stCode_(hubPropsBoot_).indexOf('HUB_VIEWER_MEMO = null') !== -1, 'reads=' + once);
    var rulesReads = 0;
    hubProfileAppRules_ = keep.rules;
    hubProfileAppRulesRead_ = function () { rulesReads++; return { rules: { x: ['STAFF'] }, tenants: {} }; };
    var cache = CacheService.getScriptCache();
    try {
      cache.put('ver_' + APP_BADGE_TAB, 'stviewer' + Date.now(), 60);
      var r1 = hubProfileAppRules_(), r2 = hubProfileAppRules_();
      stAssert_(out, P + 'App Control\'s rows are read through the cache once per version, and both of App ' +
                     'Control\'s per-app doors retire it with the bulk one',
                rulesReads === 1 && j(r1) === j(r2) && r1.rules.x.join() === 'STAFF' &&
                stCode_(keep.rules).indexOf('cacheRead_(APP_BADGE_TAB') !== -1 &&
                stCode_(keep.rules).indexOf('cacheVersion_(APP_TENANT_TAB)') !== -1 &&
                stCode_(HUB_ACTIONS.appBadgeAccessSet).indexOf('cacheBump_(APP_BADGE_TAB)') !== -1 &&
                stCode_(HUB_ACTIONS.appTenantAccessSet).indexOf('cacheBump_(APP_TENANT_TAB)') !== -1 &&
                stCode_(HUB_ACTIONS.appAccessSetBulk).indexOf('cacheBump_(APP_BADGE_TAB)') !== -1,
                'reads=' + rulesReads);
    } finally {
      cacheBump_(APP_BADGE_TAB);
    }

    // ---- who a client or a family sees on staff ----
    var istBroken = false;
    locationsIstRows_ = function () {
      if (istBroken) throw new Error('st: IST unreadable');
      return [{ house: 'ZZ9999', clientName: 'Kay9 Test', staffName: 'Ivy9 Ist' },
              { house: 'QQ1000', clientName: 'Pat9 Solo', staffName: 'Quinn9 Other' }];
    };
    var calOk = true;
    locationsCalendar_ = function () {
      if (!calOk) return { cal: null, why: 'the Calendar Archive could not be read (st)' };
      return { cal: { tz: 'America/New_York', values: [
        ['Location', 'Employee', 'Designation', 'Shift', 'Date'],
        ['CAN - ZZ9999', 'Cal9 Recent', '', '', '2026-09-10'],
        ['ZZ9999', 'Cal9 Old', '', '', '2026-07-01'],
        ['ZZ9999', 'Fut9 Later', '', '', '2026-10-01'],
        ['QQ1000', 'Other9 House', '', '', '2026-09-20'],
        ['ZZ9999', 'OPEN', '', '', '2026-09-15'],
        ['ZZ9999', 'Edge9 Day', '', '', '2026-08-23']] }, why: '' };
    };
    locationsPunches_ = function () {
      return { rows: [{ house: 'ZZ9999', location_name: '', date_iso: '2026-09-20', employee: 'Pun9 Recent' },
                      { house: 'ZZ9999', location_name: '', date_iso: '2026-06-01', employee: 'Pun9 Old' }], why: '' };
    };
    locationsToday_ = function () { return '2026-09-22'; };
    var propDays = '';
    hubProp_ = function (k) { return k === HUB_VIEWER_DAYS_PROP ? propDays : ''; };
    var seen = function (codes, days) { HUB_VIEWER_MEMO = null; return hubStaffVisibleForHouses_(codes, days); };
    var d30 = seen(['ZZ9999']);
    stAssert_(out, P + 'staff visible at a house on a fixed clock, 30 days by default: an IST there, a Calendar ' +
                   'Archive day inside the window (its first day included), a punch — never an older day, a future ' +
                   'day, another house or a label',
              d30.keys.join() === 'cal9recent,edge9day,ivy9ist,pun9recent' && d30.why === '', j(d30));
    var d120 = seen(['zz9999'], 120), both = seen(['ZZ9999', 'QQ1000', 'nope']);
    stAssert_(out, P + 'staff visible: a wider window reaches older days; two houses are both houses',
              d120.keys.join() === 'cal9old,cal9recent,edge9day,ivy9ist,pun9old,pun9recent' &&
              both.keys.join() === 'cal9recent,edge9day,ivy9ist,other9house,pun9recent,quinn9other', j([d120, both]));
    propDays = '10';
    var d10 = seen(['ZZ9999']);
    propDays = 'soon';
    var dBad = seen(['ZZ9999']);
    propDays = '';
    stAssert_(out, P + 'staff visible: the window is the HUB_VIEWER_RECENT_DAYS property; a word there is 30',
              d10.keys.join() === 'ivy9ist,pun9recent' && dBad.keys.join() === d30.keys.join() &&
              hubViewerDays_() === 30, j([d10, dBad]));
    calOk = false;
    istBroken = true;
    var blindStaff = seen(['ZZ9999']);
    calOk = true;
    istBroken = false;
    stAssert_(out, P + 'staff visible: a source that cannot be read adds nobody and says so',
              blindStaff.keys.join() === 'pun9recent' && /Calendar Archive could not be read/.test(blindStaff.why) &&
              /IST records could not be read/.test(blindStaff.why), j(blindStaff));
    var none = seen(['nope', '']);
    stAssert_(out, P + 'staff visible: no house code, nobody', none.keys.length === 0 && none.why === '', j(none));

    // ---- who a client sees on staff: this week's shifts ----
    var calReads = 0;
    locationsCalendar_ = function () {
      calReads++;
      if (!calOk) return { cal: null, why: 'the Calendar Archive could not be read (st)' };
      return { cal: { tz: 'America/New_York', values: [
        ['Location', 'Employee', 'Designation', 'Shift', 'Date'],
        ['CAN - ZZ9999', 'Mon9 First', '', '', '09/21/2026'],
        ['ZZ9999', 'Sun9 Last', '', '', '2026-09-27'],
        ['ZZ9999', 'Sun9 Before', '', '', '2026-09-20'],
        ['ZZ9999', 'Mon9 After', '', '', '2026-09-28'],
        ['QQ1000', 'Other9 House', '', '', '2026-09-22'],
        ['ZZ9999', 'OPEN', '', '', '2026-09-23'],
        ['ZZ9999', 'Ahead9 Thisweek', '', '', '2026-09-25']] }, why: '' };
    };
    var week = function (codes) { HUB_VIEWER_MEMO = null; return hubStaffScheduledForHouses_(codes); };
    var wk = week(['zz9999']);
    calReads = 0;
    var again = hubStaffScheduledForHouses_(['ZZ9999']);
    stAssert_(out, P + 'staff this week: the Calendar Archive\'s shifts at the house from its Monday to its Sunday, days ' +
                   'still ahead included — never the Sunday before, the Monday after, another house, a label, an IST ' +
                   'record or a punch — held for the execution',
              wk.keys.join() === 'ahead9thisweek,mon9first,sun9last' && wk.week === '2026-09-21' && wk.why === '' &&
              j(again) === j(wk) && calReads === 0, j([wk, again, calReads]));
    locationsToday_ = function () { return '2026-09-27'; };
    var onSunday = week(['ZZ9999']);
    locationsToday_ = function () { return '2026-09-28'; };
    var nextWeek = week(['ZZ9999']);
    locationsToday_ = function () { return '2026-09-22'; };
    calOk = false;
    var blindWeek = week(['ZZ9999']);
    calOk = true;
    var nobodyWeek = week(['nope']);
    stAssert_(out, P + 'staff this week: a Sunday is still its Monday\'s week, the next Monday starts the next; an ' +
                   'archive that cannot be read adds nobody and says so; no house code, nobody',
              onSunday.week === '2026-09-21' && onSunday.keys.join() === wk.keys.join() &&
              nextWeek.week === '2026-09-28' && nextWeek.keys.join() === 'mon9after' &&
              blindWeek.keys.length === 0 && /Calendar Archive could not be read/.test(blindWeek.why) &&
              nobodyWeek.keys.length === 0 && nobodyWeek.week === '2026-09-21',
              j([onSunday, nextWeek, blindWeek, nobodyWeek]));
  } finally {
    hubProfileAppRules_ = keep.rules;
    hubProfileAppRulesRead_ = keep.rulesRead;
    locationsClientRows_ = keep.clientRows;
    locationsHomes_ = keep.homes;
    ssaIndex_ = keep.ssa;
    usersAll_ = keep.users;
    clientsDerived_ = keep.derived;
    cpMasterIndex_ = keep.master;
    locationsIstRows_ = keep.ist;
    locationsCalendar_ = keep.cal;
    locationsPunches_ = keep.punches;
    locationsToday_ = keep.today;
    hubProp_ = keep.prop;
    HUB_MEMBER_CTX = keep.member;
    HUB_MASTER_EMAIL_CACHE = keep.masterCache;
    HUB_VIEWER_MEMO = null;
  }
}
