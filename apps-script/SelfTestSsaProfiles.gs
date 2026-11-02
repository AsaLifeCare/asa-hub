// SSA: the gate App Control opens and the scope cuts, the writes kept the master's, the SSAs read from the client…
function stSsaProfiles_(out) {
  var P = 'ssa profiles: ';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var DENISE = 'ssa_denise9alvarez';
  var keep = {
    ssa: ssaProfilesSsa_, cached: ssaCached_, masterCache: HUB_MASTER_EMAIL_CACHE, member: HUB_MEMBER_CTX,
    log: hubSysLog_, ensure: hubTabEnsure_, sheet: hubTabSheet_, holds: sheetDbGateHolds_, listRows: listRows_,
    derived: clientsDerived_, master: cpMasterIndex_, archive: cpArchiveIndex_, photos: clientPhotoIndex_,
    homes: locationsHomes_, today: locationsToday_, docIndex: ispDocIndex_, doc: ispDocFor_, lineRow: hubLineRow_,
    lineOurs: hubLineOurs_, hubId: hubId_, ssOpen: ssOpen_, bytes: locationsDocBytes_, bump: cacheBump_,
    activityDoor: ssaActivityDoor_, budget: SSA_PACK_BUDGET_MS, rules: hubProfileAppRules_, users: usersAll_,
    appGate: hubProfileAppGate_, clientRows: locationsClientRows_, viewerMemo: HUB_VIEWER_MEMO,
    hideRead: hubMyWorkHideRead_
  };
  // Settings > My Work's switches as the answers read them; unread unless a case sets them
  var hide = null;
  var master = { email: HUB_MASTER_ACCOUNT, role: 'admin', display_name: 'The Master' };
  var answers = [];
  var seen = function (label, r) { answers.push([label, r]); return r; };
  // App Control as the gate reads it; every test below names the row it stands on
  var released = { rules: {}, tenants: {} }, ruleReads = 0;
  var release = function (badges) {
    released = { rules: badges ? { 'ssa-profiles': badges } : {}, tenants: {} };
    HUB_VIEWER_MEMO = null;
  };
  var cfxUndo = stCfxStub_();
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    HUB_MEMBER_CTX = null;
    CLIENTS_DERIVED_MEMO_ = null;
    SSA_INDEX_MEMO_ = null;
    HUB_VIEWER_MEMO = null;
    hubProfileAppRules_ = function () { ruleReads++; return released; };
    hubMyWorkHideRead_ = function () {
      if (!hide) throw new Error('st: the display switches are not read here');
      return hide;
    };
    usersAll_ = function () { return []; };

    // ---- declarations ----
    var READS = ['ssaProfileRoster', 'ssaProfileOverview', 'ssaProfileDocuments', 'ssaProfileActivity', 'ssaProfileNotes'];
    var TOOLS = ['ssaProfileDocFile'];
    var WIDE = '["admin","director","manager","staff","client","onboarding","interviewer"]';
    var bad = [];
    SSA_ACTIONS.forEach(function (a) {
      var p = HUB_POLICY[a];
      if (!p || p.file !== 'SsaProfiles.gs' || typeof HUB_ACTIONS[a] !== 'function') { bad.push(a + ': undeclared'); return; }
      if (RESOLVER_LANES.indexOf(p.lane) === -1 || RESOLVER_STORES.indexOf(p.store) === -1) bad.push(a + ': lane/store');
      var want = READS.indexOf(a) !== -1 ? 'read' : (TOOLS.indexOf(a) !== -1 ? 'tool' : 'write');
      var roles = want === 'write' ? '["admin","manager"]' : WIDE;
      if (JSON.stringify(p.roles) !== roles) bad.push(a + ': roles ' + JSON.stringify(p.roles));
      if ((p.invalidates || []).length || (p.emits || []).length) bad.push(a + ': invalidates/emits');
      var params = p.params || {};
      Object.keys(params).forEach(function (k) { if (params[k] && params[k].required) bad.push(a + ': ' + k + ' required at the door'); });
      if (p.lane !== want) bad.push(a + ': lane ' + p.lane + ', wanted ' + want);
      if (want === 'read' && p.idempotent !== true) bad.push(a + ': a read not idempotent');
      var first = want === 'write'
        ? /^function\s*\(payload, user\)\s*\{\s*if \(!ssaProfilesMaster_\(user\)\) return ssaProfilesUnknown_\(\);/
        : /^function\s*\(payload, user\)\s*\{\s*var gate = ssaProfilesGate_\(user\);\s*if \(!gate\.open(?: \|\| ssaProfilesCut_\(gate\.scope\))?\) return ssaProfilesUnknown_\(\);/;
      if (!first.test(stCode_(HUB_ACTIONS[a]))) bad.push(a + ': the gate is not the first line');
    });
    stAssert_(out, P + 'all 7 actions are declared in SsaProfiles.gs on their lane, the reads for every role App Control ' +
                   'can release to and the write for admin/manager, invalidate and emit nothing, require no param ' +
                   'before the gate, and open with it: the App Control gate for a read, the master\'s for the write',
              bad.length === 0 && SSA_ACTIONS.length === 7, bad.join('; '));
    var pol = HUB_POLICY.ssaPack || {};
    stAssert_(out, P + 'pack: declared in SsaProfiles.gs as an idempotent admin read, a service read, no section door, ' +
                   'its parts each a door — the client views last — and the service-or-master gate its first line',
              pol.file === 'SsaProfiles.gs' && pol.lane === 'read' && pol.idempotent === true &&
              JSON.stringify(pol.roles) === '["admin"]' && typeof HUB_ACTIONS.ssaPack === 'function' &&
              SERVICE_READ_ACTIONS.indexOf('ssaPack') !== -1 && SSA_ACTIONS.indexOf('ssaPack') === -1 &&
              SSA_PACK_PARTS.join() === 'overview,documents,activity,notes,client_views' &&
              JSON.stringify(Object.keys(ssaPackDoors_('x')).sort()) === JSON.stringify(SSA_PACK_PARTS.slice().sort()) &&
              /^function\s*\(payload, user\)\s*\{\s*if \(!user \|\| !\(user\.is_service === true \|\| ssaProfilesMaster_\(user\)\)\) return ssaProfilesUnknown_\(\);/
                .test(stCode_(HUB_ACTIONS.ssaPack)), JSON.stringify(pol));

    // ---- the gate, with no App Control row ----
    release(null);
    var asked = 0;
    ssaProfilesSsa_ = function () { asked++; return { refused: { status: 418, message: 'st: the SSA was asked' } }; };
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
    var probe = { ssa: DENISE, file_id: 'KayIspFile12345', body: 'x' };
    var shape = function (r) { return !!r && r.status === 404 && r.message === 'Unknown action.' && Object.keys(r).length === 2; };
    var leaks = [];
    SSA_ACTIONS.forEach(function (a) {
      callers.forEach(function (u) {
        var r = HUB_ACTIONS[a](probe, u);
        if (!shape(r)) leaks.push(a + ' ' + JSON.stringify(u) + ' → ' + JSON.stringify(r));
      });
      HUB_MEMBER_CTX = { memberId: 'mem_st', userId: 'u-st', email: 'ann@example.org' };
      var inVisit = HUB_ACTIONS[a](probe, master);
      HUB_MEMBER_CTX = null;
      if (!shape(inVisit)) leaks.push(a + ' in a visit → ' + JSON.stringify(inVisit));
    });
    stAssert_(out, P + 'with no App Control row, another admin, a manager, a visit, the service identity, the master as a ' +
                   'manager, no session and the member context all get the exact 404 shape before the SSA or the ' +
                   'clients are looked up',
              leaks.length === 0 && asked === 0 && derivedCalls === 0,
              leaks.slice(0, 4).join(' | ') + ' asked=' + asked + ' derived=' + derivedCalls);
    var readsBefore = ruleReads;
    var passed = SSA_ACTIONS.filter(function (a) { return a !== 'ssaProfileRoster'; }).map(function (a) {
      return a + ':' + HUB_ACTIONS[a](probe, master).status;
    });
    stAssert_(out, P + 'the master in its own session passes the gate to the SSA lookup with no App Control row, ' +
                   'App Control never read',
              passed.every(function (s) { return /:418$/.test(s); }) && asked === passed.length &&
              ruleReads === readsBefore, passed.join() + ' ruleReads=' + (ruleReads - readsBefore));
    asked = 0;
    var packShut = [{ email: 'admin@example.org', role: 'admin' }, { email: 'mgr@example.org', role: 'manager' },
                    { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' }, null].map(function (u) {
      return HUB_ACTIONS.ssaPack(probe, u);
    });
    var packOpen = [serviceUser_(), master].map(function (u) { return HUB_ACTIONS.ssaPack(probe, u).status; });
    stAssert_(out, P + 'pack: another admin, a manager, a visit and no session get the exact 404 shape before the lookup; ' +
                   'the service identity and the master in its own session reach it',
              packShut.every(shape) && packOpen.join() === '418,418' && asked === 2 && CLIENTS_DERIVED_MEMO_ === null &&
              SSA_INDEX_MEMO_ === null, JSON.stringify([packShut, packOpen, asked]));
    ssaProfilesSsa_ = keep.ssa;

    // ---- fixtures ----
    ssaCached_ = function (action, key, part, deps, producer) { return producer(); };
    var derived = [
      { client_key: 'kay9test', id: 'CLI_kay9test', name: 'Kay9 Test', house: 'ZZ9999', status: 'active',
        avatar: 'https://img/kay.png', isp_year: 'January 1, 2026 - October 15, 2026', ssa_name: 'Denise9 Alvarez',
        ssa_phone: '(330) 555-0171', ssa_email: 'Denise9.Alvarez@starkdd.org', county: 'Stark',
        isp_signed_date: '2026-01-05', medications: ['secret pill'], diagnoses_text: 'dx words' },
      { client_key: 'lee9other', id: 'CLI_lee9other', name: 'Lee9 Other', house: 'QQ1000', status: 'active',
        isp_year: 'March 1, 2026 - February 28, 2027', ssa_name: 'denise9  ALVAREZ', county: 'Stark' },
      { client_key: 'mo9late', id: 'CLI_mo9late', name: 'Mo9 Late', house: 'ZZ9999', status: 'active',
        isp_year: 'June 1, 2025 - May 31, 2026' },
      { client_key: 'pat9solo', id: 'CLI_pat9solo', name: 'Pat9 Solo', house: 'QQ1000', status: 'active', isp_year: '',
        ssa_name: 'Sam9 Other', ssa_phone: '330-919-7595', ssa_email: 'sam9@gmail.com' },
      { client_key: 'nia9none', id: 'CLI_nia9none', name: 'Nia9 None', house: 'QQ1000', status: 'active', ssa_name: 'N/A' }
    ];
    derivedCalls = 0;
    clientsDerived_ = function () { derivedCalls++; return derived.slice(); };
    var masterValues = [['Client', 'SSA', 'SSA #', 'SSA Email', 'ISP', 'SSN'],
      ['Kay9 Test', 'Someone9 Else', '3305550999', 'someone9@else.org', '01/05/2026', '900-11-4544'],
      ['Mo9 Late', 'Denise9 Alvarez', '(330) 555-0171', 'denise9.alvarez@starkdd.org', '02/03/2025', '']];
    var archValues = [['Customer', 'SSA', 'SSA #', 'SSA Email', 'House', 'ISP'],
      ['Old9 Gone', 'Denise9 Alvarez', '3305550171', 'denise9.alvarez@starkdd.org', 'QQ1000', '03/04/2024'],
      ['Arch9 Only', 'Rex9 Retired', '3305550444', 'rex9@stardd.org', 'QQ1000', ''],
      ['Kay9 Test', 'Denise9 Alvarez', '', '', '', '']];
    cpMasterIndex_ = function () { return cpBookIndexFrom_(masterValues, 'America/New_York'); };
    cpArchiveIndex_ = function () { return cpBookIndexFrom_(archValues, 'America/New_York'); };
    clientPhotoIndex_ = function () { return { rex9retired: 'https://img/rex.png' }; };
    locationsHomes_ = function () { return [{ code: 'ZZ9999', home_name: 'ZZ - Test House', address: '9999 Test Ave NW' }]; };
    locationsToday_ = function () { return '2026-09-22'; };
    var tables = {
      isps: [{ client_key: 'kay9test', client_name: 'Kay9 Test', isp_year: 'January 1, 2026 - October 15, 2026',
               loaded_at: '2026-02-01T10:00:00Z', source_file: 'Kay9 Test ISP.pdf' },
             { client_key: 'mo9late', client_name: 'Mo9 Late', isp_year: 'June 1, 2025 - May 31, 2026',
               loaded_at: '2025-06-02T10:00:00Z', source_file: 'Mo9 Late ISP.pdf' }],
      clientFiles: [
        { id: 'cf1', client_key: 'lee9other', client_name: 'Lee9 Other', title: 'Lee9 ISP 2026', folder: 'ISP & AMFM',
          drive_id: 'LeeIspFile12345', issued_on: '2026-03-01', mime_type: 'application/pdf' },
        { id: 'cf2', client_key: 'kay9test', client_name: 'Kay9 Test', title: 'Letter from Denise9 Alvarez',
          folder: 'Correspondence', drive_id: 'DeniseLetter123', file_date: '2026-08-01' },
        { id: 'cf3', client_key: 'kay9test', client_name: 'Kay9 Test', title: 'Social Security card', folder: 'Identity',
          doc_kind: 'ssn_card', drive_id: 'KaySsnFile12345' },
        { id: 'cf4', client_key: 'kay9test', client_name: 'Kay9 Test', title: 'Dentist letter', folder: 'Medical',
          drive_id: 'DentistFile1234' },
        { id: 'cf5', client_key: 'pat9solo', client_name: 'Pat9 Solo', title: 'Pat9 ISP', folder: 'ISP',
          drive_id: 'PatIspFile12345' },
        { id: 'cf6', client_key: 'kay9test', client_name: 'Kay9 Test', title: 'Denise9 Alvarez id card',
          doc_kind: 'state_id', drive_id: 'DeniseIdFile123' },
        { id: 'cf7', client_key: '', client_name: 'Old9 Gone', title: 'Old9 Gone Support Plan',
          drive_id: 'OldPlanFile1234', file_date: '2024-03-04' },
        { id: 'cf8', client_key: 'kay9test', client_name: 'Kay9 Test', title: 'Lunch with Denise9 Alvarez receipt',
          digest_category: 'receipt_invoice', doc_kind: 'receipt', drive_id: 'DeniseRcpt12345', file_date: '2026-08-02' },
        { id: 'cf9', client_key: 'kay9test', client_name: 'Kay9 Test', title: 'Medicaid card sent to Denise9 Alvarez',
          doc_kind: 'medicaid_card', drive_id: 'KayCardFile1234', file_date: '2026-08-03' }]
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
    var logged = [];
    hubSysLog_ = function () { logged.push(JSON.stringify(Array.prototype.slice.call(arguments))); return true; };

    // ---- the roster ----
    derivedCalls = 0;
    var rs = seen('roster', HUB_ACTIONS.ssaProfileRoster({}, master));
    var rk = {};
    ((rs.data || {}).ssas || []).forEach(function (x) { rk[x.key] = x; });
    var dn = rk[DENISE] || {};
    stAssert_(out, P + 'roster: one SSA per folded name across the active clients (the Hub row, else the Master row), ' +
                   'the archive of old clients, sorted by name; spellings, phone and e-mail from the records; "N/A" is ' +
                   'no SSA; the agency from a board domain, none from a free mailbox; inactive when only old clients remain',
              rs.status === 200 && rs.data.ssas.map(function (x) { return x.key; }).join() ===
                DENISE + ',ssa_rex9retired,ssa_sam9other' &&
              dn.name === 'Denise9 Alvarez' && dn.clients === 4 && dn.status === 'active' && dn.phone === '(330) 555-0171' &&
              dn.email === 'denise9.alvarez@starkdd.org' && dn.agency === 'Stark County Board of DD' && dn.county === 'Stark' &&
              rk.ssa_sam9other.agency === '' && rk.ssa_rex9retired.status === 'inactive' &&
              rk.ssa_rex9retired.agency === 'Stark County Board of DD' && rk.ssa_rex9retired.avatar === 'https://img/rex.png' &&
              !rk.ssa_na && !rk.ssa_someone9else && JSON.stringify(rs).indexOf('3305550999') === -1 &&
              JSON.stringify(rs).indexOf('555-0999') === -1 && derivedCalls === 1,
              JSON.stringify(rs));

    // ---- the lookup ----
    var none = HUB_ACTIONS.ssaProfileOverview({ ssa: 'ssa_nobody9' }, master);
    var junk = HUB_ACTIONS.ssaProfileOverview({ ssa: 'a b' }, master);
    var blank = HUB_ACTIONS.ssaProfileActivity({}, master);
    stAssert_(out, P + 'an unknown, a malformed or a missing SSA key is 400 "No SSA … is on file."',
              none.status === 400 && none.message === 'No SSA "ssa_nobody9" is on file.' && junk.status === 400 &&
              /^No SSA ".*" is on file\.$/.test(junk.message) && blank.status === 400 && blank.message === 'No SSA "" is on file.',
              JSON.stringify([none, junk, blank]));

    // ---- overview ----
    var ov = seen('overview', HUB_ACTIONS.ssaProfileOverview({ ssa: DENISE }, master));
    var ovc = (ov.data && ov.data.clients) || [];
    stAssert_(out, P + 'overview: the SSA\'s details with no office address on file, and every client whose record names ' +
                   'them — the active ones by name, then the archived — with the registry\'s house label; identity only',
              ov.status === 200 && ov.data.ssa.key === DENISE && ov.data.ssa.office_address === '' &&
              ov.data.ssa.phone === '(330) 555-0171' && ov.data.ssa.status === 'active' &&
              ovc.map(function (c) { return c.client_key + ':' + c.status; }).join() ===
                'kay9test:active,lee9other:active,mo9late:active,old9gone:inactive' &&
              ovc[0].house_label === 'ZZ - Test House' && ovc[1].house_label === 'QQ1000' && ovc[0].avatar === 'https://img/kay.png' &&
              Object.keys(ovc[0]).sort().join() === 'avatar,client_key,house,house_label,name,status' &&
              Array.isArray(ov.data.why) && ov.data.why.length === 0 && JSON.stringify(ov).indexOf('secret pill') === -1 &&
              JSON.stringify(ov).indexOf('dx words') === -1, JSON.stringify(ov));

    // ---- documents ----
    var dc = seen('documents', HUB_ACTIONS.ssaProfileDocuments({ ssa: DENISE }, master));
    var dd = (dc.data && dc.data.docs) || [];
    stAssert_(out, P + 'documents: each client\'s plan (the archived one\'s too) — one the plans folder holds no single ' +
                   'file for listed with none — and the plan files the Clients app lists, newest first; never an ' +
                   'identity paper, a receipt, a card, a letter that only names the SSA, or another SSA\'s client\'s file',
              dc.status === 200 && dd.map(function (d) { return d.file_id || d.id; }).join() ===
                'LeeIspFile12345,KayIspFile12345,isp_mo9late,OldIspFile12345,OldPlanFile1234' &&
              dd[1].kind === 'isp' && dd[1].client_key === 'kay9test' && dd[1].date === '2026-01-05' &&
              dd[1].mime === 'application/pdf' && dd[2].kind === 'isp' && dd[2].file_id === '' && dd[2].mime === '' &&
              dd[2].title === 'Individual Service Plan June 1, 2025 - May 31, 2026' && dd[2].date === '2025-02-03' &&
              dd[3].kind === 'isp' && dd[3].date === '2024-03-04' && dd[0].kind === 'client_doc' &&
              dd[0].mime === 'application/pdf' && dd[4].client_key === 'old9gone' && dc.data.why.length === 0,
              JSON.stringify(dc));
    var bytesAsked = [];
    locationsDocBytes_ = function (id) {
      bytesAsked.push(id);
      return { name: 'plan.pdf', mime: 'application/pdf', size: 3, exported: false, b64: 'QUJD' };
    };
    var f1 = HUB_ACTIONS.ssaProfileDocFile({ ssa: DENISE, file_id: 'KayIspFile12345' }, master);
    var f2 = HUB_ACTIONS.ssaProfileDocFile({ ssa: DENISE, file_id: 'PatIspFile12345' }, master);
    var f3 = HUB_ACTIONS.ssaProfileDocFile({ ssa: DENISE, file_id: 'KaySsnFile12345' }, master);
    var f4 = HUB_ACTIONS.ssaProfileDocFile({ ssa: DENISE, file_id: 'bad id' }, master);
    var f5 = HUB_ACTIONS.ssaProfileDocFile({ ssa: 'ssa_nobody9', file_id: 'KayIspFile12345' }, master);
    var fNamed = ['DeniseLetter123', 'DeniseRcpt12345', 'KayCardFile1234', 'DentistFile1234'].map(function (id) {
      return HUB_ACTIONS.ssaProfileDocFile({ ssa: DENISE, file_id: id }, master).status;
    });
    stAssert_(out, P + 'document door: a file the SSA\'s own list names opens as bytes in clientProfileDocFile\'s shape; ' +
                   'another SSA\'s client\'s file, an identity paper, and a letter, receipt, card or medical paper the ' +
                   'Clients app does not serve are 404 even when they name the SSA; a malformed id and an unknown SSA ' +
                   '400, all before Drive is asked',
              f1.status === 200 && f1.data.id === 'KayIspFile12345' && f1.data.b64 === 'QUJD' &&
              Object.keys(f1.data).sort().join() === 'b64,exported,id,mime,name,size' && f2.status === 404 &&
              f3.status === 404 && f4.status === 400 && f5.status === 400 && fNamed.join() === '404,404,404,404' &&
              bytesAsked.join() === 'KayIspFile12345',
              JSON.stringify([f1.status, f2, f3, f4, f5, fNamed, bytesAsked]));
    ispDocIndex_ = function () { return {}; };
    var dcShut = HUB_ACTIONS.ssaProfileDocuments({ ssa: DENISE }, master);
    ispDocIndex_ = function () { return { files: [], index: {} }; };
    stAssert_(out, P + 'documents: an unreadable plans folder is said in why and the answer is degraded, never an empty ' +
                   'list passed off as no plans; each plan on file is still listed, with no file',
              dcShut.status === 200 && dcShut.data.degraded === true &&
              dcShut.data.why.some(function (w) { return /plans folder could not be read/.test(w); }) &&
              dcShut.data.docs.filter(function (d) { return d.kind === 'isp'; }).map(function (d) {
                return d.id + ':' + d.file_id;
              }).join() === 'isp_kay9test:,isp_mo9late:', JSON.stringify(dcShut));

    // ---- activity ----
    tabs.quo_messages = stSpSheet_([
      ['message_id', 'message_created', 'direction', 'from_number', 'to_number', 'body', 'quo_number'],
      ['m1', '2026-09-01T12:00:00Z', 'incoming', '+13305550171', '+13309197595',
       'Kay9 review next week; her SSN is 123 45 6789, card 4111 1111 1111 1111', 'PNaaaa0001'],
      ['m2', '2026-09-02T12:00:00Z', 'outgoing', '+13309197595', '+13305550171', 'Confirmed, ref 987654323', 'PNaaaa0001'],
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
    tabs[MAIL_LOG_TAB] = stSpSheet_([MAIL_LOG_HEADER.slice(),
      ['ML1', 'Tue, 08 Sep 2026 14:00:00 -0400', 'in', '1', 'asa-hub@asaop.org', 'inbox',
       'Denise9 Alvarez <denise9.alvarez@starkdd.org>', 'asa-hub@asaop.org', '', 'ISP meeting',
       'Can we meet Tuesday? SSN 123.45.6789, card 4111-1111-1111-1111',
       'mailbox', '', '', '1/inbox/1', ''],
      ['ML2', '2026-09-09T10:00:00Z', 'out', '1', 'asa-hub@asaop.org', 'sent', 'asa-hub@asaop.org', 'someone@else.org', '',
       'Other matter', 'not hers', 'platform', '', '', '', ''],
      ['ML3', '2026-09-10T10:00:00Z', 'out', '1', 'asa-hub@asaop.org', 'sent', 'asa-hub@asaop.org', 'guardian@example.org',
       'DENISE9.ALVAREZ@starkdd.org', 'Copy of the plan', 'Attached', 'platform', '', '', '', '']
    ]);
    var ac = seen('activity', HUB_ACTIONS.ssaProfileActivity({ ssa: DENISE }, master));
    var items = (ac.data && ac.data.items) || [];
    var acText = JSON.stringify(ac);
    stAssert_(out, P + 'activity: the e-mails to, from or copying the SSA, the calls and texts on the company lines with ' +
                   'the SSA\'s own phone, and each record naming them, newest first; the SSA signs what they sent and ' +
                   'the line\'s sole holder what it sent; a stranger, a text older than a year, a call\'s words, a ' +
                   'nine-digit run, and an SSN or card number written with spaces, dots or dashes never appear',
              ac.status === 200 && items.map(function (i) { return i.kind + ':' + i.id; }).join() ===
                'mail:mail_ML3,mail:mail_ML1,call:call_AC1,sms:sms_m2,sms:sms_m1,record:record_kay9test,' +
                'record:record_mo9late,record:record_old9gone' &&
              items[1].by === 'Denise9 Alvarez' && items[1].title === 'ISP meeting' && items[0].by === 'asa-hub@asaop.org' &&
              items[4].by === 'Denise9 Alvarez' && items[4].title === 'Text from Denise9 Alvarez · HR line' &&
              items[3].by === 'Hera Owner' && items[2].body === '+13309197595 · 2 min' &&
              items[5].client_key === 'kay9test' && items[5].at === '2026-01-05' && items[6].at === '2025-02-03' &&
              ac.data.phones_matched === 1 && acText.indexOf('stranger') === -1 && acText.indexOf('too old') === -1 &&
              acText.indexOf('2165550000') === -1 && acText.indexOf('SECRET') === -1 && acText.indexOf('not hers') === -1 &&
              acText.indexOf('987654323') === -1 && !/45.6789|4111/.test(acText) &&
              /SSN is \[withheld\], card \[withheld\]/.test(items[4].body) &&
              /SSN \[withheld\], card \[withheld\]/.test(items[1].body) && !hot.readCols[10] && !hot.readCols[11],
              acText.slice(0, 1800));
    var fu = (ac.data && ac.data.followups) || [];
    stAssert_(out, P + 'follow-ups: one ISP review per active client from the plan span — overdue past its end, to schedule ' +
                   'within 60 days, current after — the overdue first; an archived client has none',
              fu.map(function (f) { return f.client_key + ':' + f.status + ':' + f.due; }).join() ===
                'mo9late:overdue:2026-05-31,kay9test:to_schedule:2026-10-15,lee9other:current:2027-02-28' &&
              fu.every(function (f) { return f.what === 'ISP review'; }), JSON.stringify(fu));
    var sam = HUB_ACTIONS.ssaProfileActivity({ ssa: 'ssa_sam9other' }, master);
    var shared = ssaOwnPhones_({ key: 'ssa_a', ssa: { phones: ['3305550888'] },
                                index: { phones: { '3305550888': { ssa_a: true, ssa_b: true } } } });
    stAssert_(out, P + 'activity: a phone that is a company line or another SSA\'s is not attributed and why says so; a plan ' +
                   'with no readable span is a follow-up of unknown status',
              sam.status === 200 && sam.data.phones_matched === 0 && sam.data.items.every(function (i) { return i.kind !== 'sms'; }) &&
              sam.data.why.some(function (w) { return /not attributed/.test(w); }) &&
              sam.data.followups.length === 1 && sam.data.followups[0].status === '' && sam.data.followups[0].due === '' &&
              shared.shared === 1 && Object.keys(shared.mine).length === 0, JSON.stringify([sam, shared]));
    hubId_ = function () { return ''; };
    var acShut = HUB_ACTIONS.ssaProfileActivity({ ssa: DENISE }, master);
    stAssert_(out, P + 'activity: an unopenable hotline book is said in why and the answer is degraded, the texts still listed',
              acShut.status === 200 && acShut.data.degraded === true &&
              acShut.data.why.some(function (w) { return /hotline transcripts book could not be opened/.test(w); }) &&
              acShut.data.items.some(function (i) { return i.kind === 'sms'; }), JSON.stringify(acShut.data.why));
    hubId_ = function (k) { return k === 'HOTLINE_TRANSCRIPTS_ID' ? 'st-hot-book' : ''; };

    // ---- a source that cannot be read ----
    cpMasterIndex_ = function () { throw new Error('st: master closed'); };
    var rsDeg = HUB_ACTIONS.ssaProfileRoster({}, master);
    var ovDeg = HUB_ACTIONS.ssaProfileOverview({ ssa: DENISE }, master);
    var noneDeg = HUB_ACTIONS.ssaProfileOverview({ ssa: 'ssa_nobody9' }, master);
    cpMasterIndex_ = function () { return cpBookIndexFrom_(masterValues, 'America/New_York'); };
    clientsDerived_ = function () { throw new Error('st: clients closed'); };
    cpArchiveIndex_ = function () { throw new Error('st: archive closed'); };
    var rsDown = HUB_ACTIONS.ssaProfileRoster({}, master);
    var ovDown = HUB_ACTIONS.ssaProfileOverview({ ssa: DENISE }, master);
    clientsDerived_ = function () { derivedCalls++; return derived.slice(); };
    cpArchiveIndex_ = function () { return cpBookIndexFrom_(archValues, 'America/New_York'); };
    stAssert_(out, P + 'an unreadable Master is one why sentence and a degraded answer; an SSA it alone would name is 503, ' +
                   'never "not on file"; with neither the clients nor the archive readable the list and the lookup are 503',
              rsDeg.status === 200 && rsDeg.data.degraded === true &&
              rsDeg.data.why.join(' ') === 'The Asa Client Database could not be read (st: master closed).' &&
              ovDeg.status === 200 && ovDeg.data.clients.length === 3 && noneDeg.status === 503 &&
              rsDown.status === 503 && ovDown.status === 503, JSON.stringify([rsDeg.data.why, noneDeg, rsDown, ovDown]));

    // ---- the relay's pack ----
    derivedCalls = 0;
    var memoSeen = [];
    clientsDerived_ = function (u) { derivedCalls++; memoSeen.push(!u && !!CLIENTS_DERIVED_MEMO_); return derived.slice(); };
    var pack = seen('pack', HUB_ACTIONS.ssaPack({ ssa: DENISE }, serviceUser_()));
    var pp = (pack.data && pack.data.parts) || {};
    var ps = (pack.data && pack.data.part_status) || {};
    var packReads = derivedCalls;
    clientsDerived_ = function () { derivedCalls++; return derived.slice(); };
    var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
    var parity = {
      overview: same(pp.overview, HUB_ACTIONS.ssaProfileOverview({ ssa: DENISE }, master).data),
      documents: same(pp.documents, HUB_ACTIONS.ssaProfileDocuments({ ssa: DENISE }, master).data),
      activity: same(pp.activity, HUB_ACTIONS.ssaProfileActivity({ ssa: DENISE }, master).data),
      notes: same(pp.notes, HUB_ACTIONS.ssaProfileNotes({ ssa: DENISE }, master).data)
    };
    stAssert_(out, P + 'pack: the service reads every part in one execution, each exactly its own action\'s answer, ' +
                   'the client records read once for all of them, and both memos dropped after',
              pack.status === 200 && pack.data.ssa === DENISE && !!pack.data.built_at &&
              SSA_PACK_PARTS.every(function (n) { return ps[n] && ps[n].status === 200 && pp[n] !== undefined; }) &&
              Object.keys(parity).every(function (k) { return parity[k]; }) && packReads === 1 &&
              memoSeen.every(Boolean) && CLIENTS_DERIVED_MEMO_ === null && SSA_INDEX_MEMO_ === null,
              JSON.stringify([pack.status, ps, parity, packReads, memoSeen]));
    ssaActivityDoor_ = function () { throw new Error('st: activity closed'); };
    var broken = HUB_ACTIONS.ssaPack({ ssa: DENISE }, serviceUser_());
    ssaActivityDoor_ = keep.activityDoor;
    SSA_PACK_BUDGET_MS = -1;
    var late = HUB_ACTIONS.ssaPack({ ssa: DENISE }, serviceUser_());
    SSA_PACK_BUDGET_MS = keep.budget;
    var pNone = HUB_ACTIONS.ssaPack({ ssa: 'ssa_nobody9' }, serviceUser_());
    var pJunk = HUB_ACTIONS.ssaPack({ ssa: 'a b' }, serviceUser_());
    var bst = (broken.data && broken.data.part_status) || {};
    stAssert_(out, P + 'pack: a part that throws is its own 503 and the others answer; past its budget it starts no part and ' +
                   'says so part by part; an unknown or malformed key is the lookup\'s own 400, never an empty pack',
              broken.status === 200 && bst.activity.status === 503 && /activity closed/.test(bst.activity.message) &&
              !broken.data.parts.activity && ['overview', 'documents', 'notes'].every(function (n) { return bst[n].status === 200; }) &&
              late.status === 200 && Object.keys(late.data.parts).length === 0 &&
              SSA_PACK_PARTS.every(function (n) { return late.data.part_status[n].status === 503; }) &&
              pNone.status === 400 && !pNone.data && pJunk.status === 400 && CLIENTS_DERIVED_MEMO_ === null &&
              SSA_INDEX_MEMO_ === null, JSON.stringify([bst, pNone, pJunk]));

    // ---- Settings > My Work's SSA parts ----
    hide = { header: true, inbox_sources: true, ssa_updated: true, ssa_county: true, ssa_count: false, ssa_role: true };
    var HIDDEN = JSON.stringify({ hidden: { updated: true, county: true, count: false, role: true } });
    var shownOf = function (r) { return JSON.stringify(r && r.data && r.data.display); };
    var hOv = HUB_ACTIONS.ssaProfileOverview({ ssa: DENISE }, master);
    var hNotes = HUB_ACTIONS.ssaProfileNotes({ ssa: DENISE }, master);
    var hDocs = HUB_ACTIONS.ssaProfileDocuments({ ssa: DENISE }, master);
    var hAct = HUB_ACTIONS.ssaProfileActivity({ ssa: DENISE }, master);
    var hPack = HUB_ACTIONS.ssaPack({ ssa: DENISE }, serviceUser_());
    var hCut = ssaOverviewDoor_({ ssa: DENISE }, ssaProfilesCut_({ kind: 'ssa', ssa_keys: [DENISE], client_keys: ['kay9test'] }));
    var hp = (hPack.data && hPack.data.parts) || {};
    hide = null;
    var uOv = HUB_ACTIONS.ssaProfileOverview({ ssa: DENISE }, master);
    stAssert_(out, P + 'Settings > My Work: the overview and the notes carry the four SSA parts, the same for the master, ' +
                   'the relay\'s pack and a cut viewer — the page, not the answer, shows the master everything; ' +
                   'documents and activity carry none; switches that cannot be read put no display on any answer',
              shownOf(hOv) === HIDDEN && shownOf(hNotes) === HIDDEN && shownOf({ data: hp.overview }) === HIDDEN &&
              shownOf({ data: hp.notes }) === HIDDEN && shownOf(hCut) === HIDDEN &&
              hCut.data.clients.map(function (c) { return c.client_key; }).join() === 'kay9test' &&
              !('display' in hDocs.data) && !('display' in hAct.data) && !('display' in hp.documents) &&
              !('display' in hp.activity) && uOv.status === 200 && !('display' in uOv.data) &&
              JSON.stringify(uOv.data.ssa) === JSON.stringify(hOv.data.ssa),
              JSON.stringify([shownOf(hOv), shownOf(hNotes), shownOf({ data: hp.overview }), shownOf(hCut),
                              Object.keys(hDocs.data), Object.keys(uOv.data)]));

    // ---- notes ----
    var notes = stLocSheet_([]);
    var ensured = [];
    hubTabEnsure_ = function (tab, header) {
      ensured.push(tab);
      if (HUB_TAB_BORN_HOME.indexOf(tab) === -1) throw new Error('st: ' + tab + ' is not born home');
      if (tab !== SSA_NOTES_TAB) throw new Error('st: no other tab');
      if (!notes.grid.length) notes.grid.push(header.slice());
      tabs[SSA_NOTES_TAB] = notes;
      return notes;
    };
    var bumped = [];
    cacheBump_ = function (scope) { bumped.push(scope); };
    var nBefore = HUB_ACTIONS.ssaProfileNotes({ ssa: DENISE }, master);
    var nBad = [
      HUB_ACTIONS.ssaProfileNoteAdd({ ssa: DENISE, body: '   ' }, master),
      HUB_ACTIONS.ssaProfileNoteAdd({ ssa: DENISE, body: new Array(4002).join('y') }, master),
      HUB_ACTIONS.ssaProfileNoteAdd({ ssa: 'ssa_nobody9', body: 'x' }, master)
    ].map(function (r) { return r.status; });
    sheetDbGateHolds_ = function () { return { error: { status: 409, message: 'st: held' } }; };
    var nHeld = HUB_ACTIONS.ssaProfileNoteAdd({ ssa: DENISE, body: 'x' }, master);
    sheetDbGateHolds_ = function () { return null; };
    stAssert_(out, P + 'notes: a read makes nothing; an empty or over-long body and an unknown SSA are 400, the held funnel ' +
                   '409 — none of them makes the tab or writes a log line',
              nBefore.status === 200 && nBefore.data.notes.length === 0 && nBad.join() === '400,400,400' &&
              nHeld.status === 409 && ensured.length === 0 && notes.grid.length === 0 && logged.length === 0,
              JSON.stringify([nBefore, nBad, nHeld, ensured, logged]));
    var nAdd = HUB_ACTIONS.ssaProfileNoteAdd({ ssa: DENISE, body: '=HYPERLINK("http://x") private words', by: 'Mallory',
                                               id: 'forged', at: '1999-01-01' }, master);
    var nh = notes.grid[0] || [];
    var nr = notes.grid[1] || [];
    var ncol = function (hd) { return nr[nh.indexOf(hd)]; };
    stAssert_(out, P + 'notes: the first write makes the born-home tab through hubTabEnsure_; the filer, time and id are the ' +
                   'server\'s, text is kept from being a formula, the three reads it changes are retired, and the log ' +
                   'names the SSA key and never the words',
              nAdd.status === 200 && ensured.join() === SSA_NOTES_TAB && nh.join() === SSA_NOTES_HEADER.join() &&
              ncol('ssa_key') === DENISE && ncol('ssa_name') === 'Denise9 Alvarez' && ncol('by') === 'The Master' &&
              /^SSAN_/.test(ncol('id')) && ncol('at') !== '1999-01-01' && ncol('body') === '\'=HYPERLINK("http://x") private words' &&
              Object.keys(nAdd.data.note).sort().join() === 'at,body,by,id' &&
              ['ssaProfileNotes', 'ssaProfileActivity', 'ssaProfileOverview'].every(function (a) {
                return bumped.indexOf('ssa_' + a + '_' + DENISE) !== -1;
              }) && logged.length === 1 && logged[0].indexOf('ssaProfileNoteAdd') !== -1 &&
              logged[0].indexOf(DENISE) !== -1 && logged[0].indexOf('private words') === -1,
              JSON.stringify([nAdd, notes.grid, bumped, logged]));
    var nAfter = HUB_ACTIONS.ssaProfileNotes({ ssa: DENISE }, master);
    var acAfter = HUB_ACTIONS.ssaProfileActivity({ ssa: DENISE }, master);
    var otherNotes = HUB_ACTIONS.ssaProfileNotes({ ssa: 'ssa_rex9retired' }, master);
    stAssert_(out, P + 'notes: the read shows the note to its SSA alone, and the activity lists it',
              nAfter.status === 200 && nAfter.data.notes.length === 1 && /private words/.test(nAfter.data.notes[0].body) &&
              otherNotes.data.notes.length === 0 &&
              acAfter.data.items.some(function (i) { return i.kind === 'note' && i.title === 'Admin note'; }),
              JSON.stringify([nAfter, otherNotes, acAfter.data.items.slice(0, 2)]));
    cacheBump_ = keep.bump;

    // ---- released: App Control opens the reads, the scope cuts them, the writes stay the master's ----
    locationsClientRows_ = function () {
      return derived.map(function (c) {
        return { client_key: c.client_key, name: c.name, house: c.house, home_address: '', status: c.status };
      });
    };
    var lookups = 0;
    ssaProfilesSsa_ = function (raw) { lookups++; return keep.ssa(raw); };
    var staffer = { id: 'u-st9', email: 'sally9@asa.test', role: 'staff', types: ['STAFF'], display_name: 'Sally9 Staff' };
    var kayAcct = { id: 'u-kay9', email: 'kay9@x.test', role: 'client', types: ['CLIENT'], client_key: 'kay9test',
                    display_name: 'Kay9 Test' };
    var denAcct = { id: 'u-den9', email: ' Denise9.Alvarez@StarkDD.org ', role: 'staff', types: ['GUARDIAN'],
                    display_name: 'D Alvarez' };
    var every = function (u, key) {
      return {
        roster: HUB_ACTIONS.ssaProfileRoster({}, u), overview: HUB_ACTIONS.ssaProfileOverview({ ssa: key }, u),
        documents: HUB_ACTIONS.ssaProfileDocuments({ ssa: key }, u), activity: HUB_ACTIONS.ssaProfileActivity({ ssa: key }, u),
        notes: HUB_ACTIONS.ssaProfileNotes({ ssa: key }, u)
      };
    };
    var noteBy = function (u) { return HUB_ACTIONS.ssaProfileNoteAdd({ ssa: DENISE, body: 'not theirs to file' }, u); };
    var docBy = function (u, key, id) { return HUB_ACTIONS.ssaProfileDocFile({ ssa: key, file_id: id }, u); };
    var gridBefore = notes.grid.length, logBefore = logged.length;

    release(null);
    derivedCalls = 0;
    var shutNone = [every(staffer, DENISE), every(kayAcct, DENISE), every(denAcct, DENISE)];
    release(['HM']);
    var shutOther = [every(staffer, DENISE), every(kayAcct, DENISE), every(denAcct, DENISE)];
    var allShut = function (list) {
      return list.every(function (set) { return Object.keys(set).every(function (k) { return shape(set[k]); }); });
    };
    stAssert_(out, P + 'unreleased — no App Control row, or a row naming none of their badges — a staff member, a ' +
                   'client and an SSA get the exact 404 shape on every read, before any client record is read',
              allShut(shutNone) && allShut(shutOther) && derivedCalls === 0,
              JSON.stringify([shutNone[0].roster, shutOther[0].overview]) + ' derived=' + derivedCalls);

    release(['STAFF']);
    var mAll = every(master, DENISE), sAll = every(staffer, DENISE);
    var bare = function (r) {
      var d = r && r.data ? ssaWith_(r.data, {}) : null;
      if (d) delete d.viewer;
      return JSON.stringify([r && r.status, d]);
    };
    var alike = Object.keys(mAll).filter(function (k) { return bare(mAll[k]) !== bare(sAll[k]); });
    var sDoc = docBy(staffer, DENISE, 'KayIspFile12345');
    var sNote = noteBy(staffer);
    var sPack = HUB_ACTIONS.ssaPack({ ssa: DENISE }, staffer);
    stAssert_(out, P + 'released to STAFF: a staff member reads every part exactly as the master does — the roster, ' +
                   'overview, documents, activity with the admin note, the notes and a document — told apart only by ' +
                   'the roster\'s viewer; the note write and the pack stay the master\'s, nothing filed or logged',
              alike.length === 0 && mAll.roster.data.viewer === 'master' && sAll.roster.data.viewer === 'all' &&
              sAll.notes.data.notes.length === 1 &&
              sAll.activity.data.items.some(function (i) { return i.kind === 'note'; }) && sDoc.status === 200 &&
              shape(sNote) && shape(sPack) && notes.grid.length === gridBefore && logged.length === logBefore,
              JSON.stringify([alike, sAll.roster.data.viewer, sDoc.status, sNote, sPack]));

    release(['CLIENT']);
    var kc = seen('client', every(kayAcct, DENISE));
    var kcDocs = (kc.documents.data && kc.documents.data.docs) || [];
    var kcRoster = (kc.roster.data && kc.roster.data.ssas) || [];
    lookups = 0;
    var kcOut = [HUB_ACTIONS.ssaProfileOverview({ ssa: 'ssa_sam9other' }, kayAcct),
                 HUB_ACTIONS.ssaProfileDocuments({ ssa: 'ssa_sam9other' }, kayAcct),
                 docBy(kayAcct, 'ssa_sam9other', 'PatIspFile12345'),
                 HUB_ACTIONS.ssaProfileOverview({ ssa: 'ssa_nobody9' }, kayAcct)];
    var kcLookups = lookups;
    var kcOwn = docBy(kayAcct, DENISE, 'KayIspFile12345');
    var kcOther = docBy(kayAcct, DENISE, 'LeeIspFile12345');
    stAssert_(out, P + 'released to CLIENT: a client sees their own SSA alone, with only their own record — the roster ' +
                   'counting it, the overview listing it, their own plan and nothing of the SSA\'s other clients; no ' +
                   'activity, no admin notes, no note write; another SSA or an unknown key is the exact 404 shape ' +
                   'before any lookup',
              kc.roster.status === 200 && kc.roster.data.viewer === 'client' &&
              kcRoster.map(function (s) { return s.key + ':' + s.clients; }).join() === DENISE + ':1' &&
              kc.overview.status === 200 &&
              kc.overview.data.clients.map(function (c) { return c.client_key; }).join() === 'kay9test' &&
              kc.overview.data.ssa.key === DENISE && kcDocs.length > 0 &&
              kcDocs.every(function (d) { return d.client_key === 'kay9test'; }) &&
              kcDocs.some(function (d) { return d.file_id === 'KayIspFile12345'; }) &&
              shape(kc.activity) && shape(kc.notes) && shape(noteBy(kayAcct)) && kcOut.every(shape) && kcLookups === 0 &&
              kcOwn.status === 200 && kcOther.status === 404 && JSON.stringify(kc).indexOf('Lee9 Other') === -1 &&
              notes.grid.length === gridBefore,
              JSON.stringify([kc.roster, kc.overview.data && kc.overview.data.clients, kcDocs, kcOut, kcLookups,
                              kcOwn.status, kcOther]).slice(0, 1800));
    var kpack = HUB_ACTIONS.ssaPack({ ssa: DENISE }, serviceUser_());
    var kviews = ((kpack.data || {}).parts || {}).client_views || {};
    var current = ssaIndex_().ssas[DENISE].clients.filter(function (c) { return !c.archived; })
      .map(function (c) { return c.client_key; }).sort();
    var kview = kviews.kay9test || {};
    var sameAs = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
    stAssert_(out, P + 'pack: each current client of the SSA has its own view — the roster, overview and documents ' +
                   'exactly as the actions answer that client — no activity or notes, and an archived client none',
              kpack.status === 200 && kpack.data.part_status.client_views.status === 200 &&
              Object.keys(kviews).sort().join() === current.join() && current.indexOf('kay9test') !== -1 &&
              current.length >= 2 && Object.keys(kview).sort().join() === 'documents,overview,roster' &&
              sameAs(kview.roster, kc.roster.data) && sameAs(kview.overview, kc.overview.data) &&
              sameAs(kview.documents, kc.documents.data) && JSON.stringify(kview).indexOf('Lee9 Other') === -1 &&
              JSON.stringify(kviews).indexOf('private words') === -1,
              JSON.stringify([Object.keys(kviews), current, kview, kc.roster.data]).slice(0, 1800));
    var staffOnClient = every(staffer, DENISE);
    stAssert_(out, P + 'released to CLIENT only: a staff member stays shut',
              allShut([staffOnClient]), JSON.stringify(staffOnClient.roster));

    release(['GUARDIAN']);
    var ds = seen('ssa', every(denAcct, DENISE));
    var dsItems = (ds.activity.data && ds.activity.data.items) || [];
    var dsDocs = ((ds.documents.data && ds.documents.data.docs) || []).map(function (d) { return d.file_id || d.id; });
    var dsOther = [HUB_ACTIONS.ssaProfileOverview({ ssa: 'ssa_rex9retired' }, denAcct),
                   HUB_ACTIONS.ssaProfileActivity({ ssa: 'ssa_rex9retired' }, denAcct)];
    stAssert_(out, P + 'released to GUARDIAN: an SSA matched by the records\' e-mail sees themselves alone, with only ' +
                   'the clients whose records carry that e-mail — a record naming them with no e-mail and an archived ' +
                   'client are cut from the overview, documents, records and follow-ups; their own texts, calls and ' +
                   'e-mail stay; never an admin note, the notes or the note write; another SSA is the 404 shape',
              ds.roster.status === 200 && ds.roster.data.viewer === 'ssa' &&
              ds.roster.data.ssas.map(function (s) { return s.key + ':' + s.clients; }).join() === DENISE + ':2' &&
              ds.overview.data.clients.map(function (c) { return c.client_key; }).join() === 'kay9test,mo9late' &&
              dsDocs.sort().join() === 'KayIspFile12345,isp_mo9late' &&
              dsItems.filter(function (i) { return i.kind === 'record'; }).map(function (i) { return i.client_key; })
                .join() === 'kay9test,mo9late' &&
              ['sms', 'call', 'mail'].every(function (k) { return dsItems.some(function (i) { return i.kind === k; }); }) &&
              !dsItems.some(function (i) { return i.kind === 'note'; }) && ds.activity.data.total === dsItems.length &&
              ds.activity.data.followups.map(function (f) { return f.client_key; }).sort().join() === 'kay9test,mo9late' &&
              shape(ds.notes) && shape(noteBy(denAcct)) && dsOther.every(shape) &&
              JSON.stringify(ds).indexOf('Lee9 Other') === -1 && JSON.stringify(ds).indexOf('Old9 Gone') === -1 &&
              JSON.stringify(ds).indexOf('private words') === -1,
              JSON.stringify([ds.roster.data, ds.overview.data && ds.overview.data.clients, dsDocs,
                              dsItems.map(function (i) { return i.kind + ':' + i.id; })]).slice(0, 1800));
    var twoMails = ssaActivityCut_({
      items: [{ kind: 'sms', id: 's' }, { kind: 'mail', id: 'm' }, { kind: 'call', id: 'c' }, { kind: 'note', id: 'n' },
              { kind: 'record', id: 'r1', client_key: 'a1' }, { kind: 'record', id: 'r2', client_key: 'b2' }],
      followups: [{ client_key: 'a1' }, { client_key: 'b2' }], why: [], total: 6
    }, ssaProfilesCut_({ kind: 'ssa', ssa_keys: ['ssa_x'], client_keys: ['a1'] }), { ssa: { emails: ['a@x.test', 'b@y.test'] } });
    stAssert_(out, P + 'an SSA the records give two e-mails is shown no texts, calls or e-mails, and why says so',
              twoMails.items.map(function (i) { return i.id; }).join() === 'r1' && twoMails.total === 1 &&
              twoMails.followups.map(function (f) { return f.client_key; }).join() === 'a1' &&
              /more than one e-mail/.test(twoMails.why.join(' ')), JSON.stringify(twoMails));

    hubProfileAppGate_ = function (app, u) {
      return app === 'ssa-profiles' && u && u.id === 'u-fam9' ? { open: true, scope: famScope } : { open: false, scope: null };
    };
    var famAcct = { id: 'u-fam9', email: 'fam9@x.test', role: 'client', types: ['GUARDIAN'], client_key: 'lee9other' };
    var famScope = { kind: 'guardian', client_keys: ['lee9other'], house_codes: [], ssa_keys: [DENISE], family_keys: [],
                     why: '' };
    var fam = seen('family', every(famAcct, DENISE));
    var famDocs = ((fam.documents.data && fam.documents.data.docs) || []).map(function (d) { return d.file_id || d.id; });
    famScope = { kind: 'onlooker', client_keys: ['kay9test'], house_codes: [], ssa_keys: [DENISE], family_keys: [], why: '' };
    var odd = every(famAcct, DENISE);
    hubProfileAppGate_ = function () { throw new Error('st: the gate broke'); };
    var broke = every(staffer, DENISE);
    hubProfileAppGate_ = keep.appGate;
    stAssert_(out, P + 'family: their ward\'s SSA alone with only the ward — overview and plan — and no activity or ' +
                   'notes; a scope kind this app does not know sees no SSA and opens none; a gate that throws is shut',
              fam.roster.data.viewer === 'guardian' &&
              fam.roster.data.ssas.map(function (s) { return s.key + ':' + s.clients; }).join() === DENISE + ':1' &&
              fam.overview.data.clients.map(function (c) { return c.client_key; }).join() === 'lee9other' &&
              famDocs.join() === 'LeeIspFile12345' && shape(fam.activity) && shape(fam.notes) &&
              odd.roster.status === 200 && odd.roster.data.ssas.length === 0 && shape(odd.overview) &&
              shape(odd.documents) && shape(odd.activity) && shape(odd.notes) && allShut([broke]),
              JSON.stringify([fam.roster.data, famDocs, odd.roster.data, broke.roster]));
    ssaProfilesSsa_ = keep.ssa;

    // ---- no answer carries a nine-digit run or a clinical field ----
    var runs = [];
    answers.forEach(function (pair) {
      var text = JSON.stringify(pair[1]);
      if (/(^|\D)\d{9}(\D|$)/.test(text) || /(^|\D)\d{3}[\s.-]\d{2}[\s.-]\d{4}(\D|$)/.test(text) ||
          /(^|\D)\d(?:[ -]?\d){12,18}(\D|$)/.test(text) || /secret pill|dx words|900-11-4544/.test(text)) runs.push(pair[0]);
    });
    stAssert_(out, P + 'no answer of any read carries a 9-digit run, an SSN shape, a card number or a clinical field of ' +
                   'the clients',
              answers.length >= 5 && runs.length === 0, 'answers=' + answers.length + ' with runs: ' + runs.join(', '));

    // ---- a client set inactive, and the SSA who represents them ---- ann9one's SSA is on its Master row alone…
    var casc = {
      derived: [
        { client_key: 'ann9one', id: 'CLI_ann9one', name: 'Ann9 One', house: 'ZZ9999', status: 'active' },
        { client_key: 'bob9two', id: 'CLI_bob9two', name: 'Bob9 Two', house: 'ZZ9999', status: 'active',
          ssa_name: 'Vic9 Double', ssa_email: 'vic9@starkdd.org' },
        { client_key: 'cy9three', id: 'CLI_cy9three', name: 'Cy9 Three', house: 'QQ1000', status: '',
          ssa_name: 'Vic9 Double' },
        { client_key: 'eve9five', id: 'CLI_eve9five', name: 'Eve9 Five', house: 'QQ1000', status: 'active' }],
      master: [['Client', 'SSA', 'SSA #', 'SSA Email'], ['Ann9 One', 'Una9 Single', '3305550181', 'una9@starkdd.org']],
      arch: [['Customer', 'SSA', 'SSA #', 'SSA Email'], ['Eve9 Five', 'Xan9 Stale', '', 'xan9@starkdd.org']]
    };
    clientsDerived_ = function () { return JSON.parse(JSON.stringify(casc.derived)); };
    cpMasterIndex_ = function () { return cpBookIndexFrom_(casc.master, 'America/New_York'); };
    cpArchiveIndex_ = function () { return cpBookIndexFrom_(casc.arch, 'America/New_York'); };
    clientPhotoIndex_ = function () { return {}; };
    var cascOf = function () {
      var built = ssaIndexBuild_(), said = {};
      Object.keys(built.ssas).forEach(function (k) {
        var s = built.ssas[k];
        said[k] = s.status + ':' + s.clients.map(function (c) { return c.client_key + '=' + c.status; }).join(',') +
                  (k === 'ssa_una9single' ? ':' + s.email : '');
      });
      return said;
    };
    var cascStart = cascOf();
    // the door sets ann9one and bob9two inactive: their Hub rows say so, and ann9one's Master row moves to the archive
    casc.derived[0].status = 'inactive';
    casc.derived[1].status = 'inactive';
    casc.master = [casc.master[0]];
    casc.arch = casc.arch.concat([['Ann9 One', 'Una9 Single', '3305550181', 'una9@starkdd.org']]);
    var cascOff = cascOf();
    casc.derived[2].status = 'Inactive';
    var cascAll = cascOf();
    // and back: the Hub rows active, the row moved back to the Master
    casc.derived.forEach(function (c) { c.status = 'Active'; });
    casc.master = casc.master.concat([['Ann9 One', 'Una9 Single', '3305550181', 'una9@starkdd.org']]);
    casc.arch = casc.arch.slice(0, 2);
    var cascBack = cascOf();
    stAssert_(out, P + 'cascade: an SSA whose one client is live is active; a blank status is live; an old archive row ' +
                   'never names an SSA for a live client',
              cascStart.ssa_una9single === 'active:ann9one=active:una9@starkdd.org' &&
              cascStart.ssa_vic9double === 'active:bob9two=active,cy9three=active' &&
              !cascStart.ssa_xan9stale && Object.keys(cascStart).length === 2, JSON.stringify(cascStart));
    stAssert_(out, P + 'cascade: the SSA of a client set inactive turns inactive when no other client of theirs is live — ' +
                   'the link kept from the archive row when the SSA was on the Master row alone — and stays active ' +
                   'while another client is live',
              cascOff.ssa_una9single === 'inactive:ann9one=inactive:una9@starkdd.org' &&
              cascOff.ssa_vic9double === 'active:cy9three=active,bob9two=inactive' &&
              !cascOff.ssa_xan9stale && Object.keys(cascOff).length === 2, JSON.stringify(cascOff));
    stAssert_(out, P + 'cascade: with the last live client set inactive the SSA turns inactive, every client still listed',
              cascAll.ssa_vic9double === 'inactive:bob9two=inactive,cy9three=inactive', JSON.stringify(cascAll));
    stAssert_(out, P + 'cascade: setting the clients active again brings their SSAs back, exactly as before',
              JSON.stringify(cascBack) === JSON.stringify(cascStart), JSON.stringify([cascBack, cascStart]));
    clientsDerived_ = function () { derivedCalls++; return derived.slice(); };
    cpMasterIndex_ = function () { return cpBookIndexFrom_(masterValues, 'America/New_York'); };
    cpArchiveIndex_ = function () { return cpBookIndexFrom_(archValues, 'America/New_York'); };
    clientPhotoIndex_ = function () { return { rex9retired: 'https://img/rex.png' }; };

    // ---- the cache ----
    ssaCached_ = keep.cached;
    var calls = 0, key = 'st_' + Date.now();
    ssaCached_('ssaProfileActivity', key, 'all', [], function () { calls++; return { degraded: true }; });
    ssaCached_('ssaProfileActivity', key + 'b', 'all', [], function () { calls++; return { degraded: false }; });
    ssaCached_('ssaProfileActivity', key + 'b', 'all', [], function () { calls++; return { degraded: false }; });
    stAssert_(out, P + 'a read is kept per SSA under ssa_<action>_<key>; a degraded one retires its own scope',
              calls === 2, 'producer calls=' + calls);

    // ---- where the notes live ----
    var asResource = Object.keys(RESOURCES).filter(function (k) {
      return /^ssaProfile/i.test(k) || (RESOURCES[k] && RESOURCES[k].sheet === SSA_NOTES_TAB);
    });
    stAssert_(out, P + 'ssa_notes is no generic resource and no slice, and is born in the Apps book like staff_notes',
              asResource.length === 0 && HUB_TAB_HOME.ssa_notes === 'HUB_APPS_BOOK_ID' &&
              HUB_TAB_HOME.ssa_notes === HUB_TAB_HOME.staff_notes && HUB_TAB_BORN_HOME.indexOf('ssa_notes') !== -1,
              asResource.join());

    // ---- no delete anywhere ----
    var fns = Object.keys(g).filter(function (k) { return /^(ssa[A-Z]|ssaProfiles)/.test(k) && typeof g[k] === 'function'; });
    var deleting = [];
    fns.map(function (k) { return [k, g[k]]; }).concat(SSA_ACTIONS.concat(['ssaPack']).map(function (a) { return [a, HUB_ACTIONS[a]]; }))
      .forEach(function (pair) {
        if (/deleteRows?\(|deleteRowById_|deleteSheet|clearContents?\(|\.clear\(|setTrashed|api\.delete/.test(stCode_(pair[1]))) {
          deleting.push(pair[0]);
        }
      });
    stAssert_(out, P + 'no SSA code path deletes, clears or trashes anything',
              fns.length >= 30 && deleting.length === 0, 'functions=' + fns.length + ' deleting=' + deleting.join());
  } finally {
    cfxUndo();
    ssaProfilesSsa_ = keep.ssa;
    ssaCached_ = keep.cached;
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
    ssaActivityDoor_ = keep.activityDoor;
    SSA_PACK_BUDGET_MS = keep.budget;
    hubProfileAppRules_ = keep.rules;
    usersAll_ = keep.users;
    hubProfileAppGate_ = keep.appGate;
    locationsClientRows_ = keep.clientRows;
    HUB_VIEWER_MEMO = keep.viewerMemo;
    hubMyWorkHideRead_ = keep.hideRead;
    CLIENTS_DERIVED_MEMO_ = null;
    SSA_INDEX_MEMO_ = null;
  }
}
