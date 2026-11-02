/** Clients · Appointments: the master-only gate, the client's name join, the shaping of visits and doctors, and a failing source saying why. */
function stClientSourceAppointments_(out) {
  var P = 'client appointments: ';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var KEY = 'zz_selftest_appt';

  // ---- declarations ----
  var bad = [];
  CS_APPT_ACTIONS.forEach(function (a) {
    var p = HUB_POLICY[a];
    if (!p || p.file !== 'ClientSourceAppointments.gs' || typeof HUB_ACTIONS[a] !== 'function') { bad.push(a + ': undeclared'); return; }
    if (p.lane !== 'read' || p.idempotent !== true) bad.push(a + ': not an idempotent read');
    if (RESOLVER_STORES.indexOf(p.store) === -1 || RESOLVER_COSTS.indexOf(p.cost) === -1) bad.push(a + ': store/cost');
    if (JSON.stringify(p.roles) !== JSON.stringify(ST_CP_READ_ROLES)) bad.push(a + ': roles ' + JSON.stringify(p.roles));
    if ((p.invalidates || []).length || (p.emits || []).length) bad.push(a + ': invalidates/emits');
    var params = p.params || {};
    Object.keys(params).forEach(function (k) { if (params[k] && params[k].required) bad.push(a + ': ' + k + ' required at the door'); });
  });
  var asResource = Object.keys(RESOURCES).filter(function (k) {
    return /^clientSource/i.test(k) || [CS_APPT_FUTURE, CS_APPT_ARCHIVE].indexOf(String(RESOURCES[k].sheet)) !== -1;
  });
  stAssert_(out, P + 'the door is a read declared in its own file for every role App Control may release Clients to, ' +
                 'requiring nothing before the gate, and no RESOURCE reads its store or the Future Apts tab',
            bad.length === 0 && CS_APPT_ACTIONS.length === 1 && asResource.length === 0,
            bad.concat(asResource).join('; '));

  // ---- nothing is logged ----
  var loud = Object.keys(g).filter(function (name) { return /^csAppt/.test(name) && typeof g[name] === 'function'; })
    .map(function (name) { return [name, g[name]]; })
    .concat(CS_APPT_ACTIONS.map(function (a) { return [a, HUB_ACTIONS[a]]; }))
    .filter(function (pair) { return /Logger\.log|console\.|hubSysLog_|hubLog_|appendRow|setValue/.test(stCode_(pair[1])); })
    .map(function (pair) { return pair[0]; });
  stAssert_(out, P + 'the door logs no line and writes no cell', loud.length === 0, loud.join(', '));

  var keep = {
    client: csApptClient_, derived: clientsDerived_, estate: estateRows_, tab: csApptTabRows_, today: csApptToday_,
    masterCache: HUB_MASTER_EMAIL_CACHE, member: HUB_MEMBER_CTX, service: HUB_IS_SERVICE_REQ, rules: hubProfileAppRules_
  };
  var master = { email: HUB_MASTER_ACCOUNT, role: 'admin' };
  // a version no clock can repeat, so every read here is produced, never a held answer
  var fresh = 0;
  var retire = function () {
    CacheService.getScriptCache().put('ver_csa_appts_' + KEY, 'st' + (++fresh) + '_' + Date.now(), 21600);
  };
  var ask = function (payload, held) {
    if (!held) retire();
    return HUB_ACTIONS.clientSourceAppointments(payload, master);
  };
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    HUB_MEMBER_CTX = null;
    HUB_IS_SERVICE_REQ = false;

    // ---- the gate (no App Control row: the master's alone) ----
    hubProfileAppRules_ = function () { return { rules: {}, tenants: {} }; };
    HUB_VIEWER_MEMO = null;
    var asked = 0;
    csApptClient_ = function () { asked++; return { refused: { status: 418, message: 'st: the client was asked' } }; };
    var callers = [
      { email: 'admin@example.org', role: 'admin' },
      { email: 'mgr@example.org', role: 'manager' },
      { id: 'u-st9', email: 'st9@example.org', role: 'staff', types: ['STAFF'] },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', is_service: true },
      { email: HUB_MASTER_ACCOUNT, role: 'manager' },
      null
    ];
    var shape = function (r) { return !!r && r.status === 404 && r.message === 'Unknown action.' && Object.keys(r).length === 2; };
    var leaks = [];
    CS_APPT_ACTIONS.forEach(function (a) {
      callers.forEach(function (u) {
        var r = HUB_ACTIONS[a]({ client: KEY }, u);
        if (!shape(r)) leaks.push(a + ' ' + JSON.stringify(u) + ' → ' + JSON.stringify(r));
      });
      HUB_MEMBER_CTX = { memberId: 'mem_st', userId: 'u-st', email: 'ann@example.org' };
      var inVisit = HUB_ACTIONS[a]({ client: KEY }, master);
      HUB_MEMBER_CTX = null;
      if (!shape(inVisit)) leaks.push(a + ' in a visit → ' + JSON.stringify(inVisit));
      HUB_IS_SERVICE_REQ = true;
      var asService = HUB_ACTIONS[a]({ client: KEY }, master);
      HUB_IS_SERVICE_REQ = false;
      if (!shape(asService)) leaks.push(a + ' as the service → ' + JSON.stringify(asService));
    });
    stAssert_(out, P + 'with no App Control row: a non-master, a manager, a staff member, a visit, the service identity ' +
                   'and no session all get the 404 shape before the client is looked up', leaks.length === 0 && asked === 0,
              leaks.slice(0, 4).join(' | ') + ' asked=' + asked);
    var passed = HUB_ACTIONS.clientSourceAppointments({ client: KEY }, master);
    stAssert_(out, P + 'the master in its own session passes the gate to the client lookup',
              passed && passed.status === 418, JSON.stringify(passed));
    csApptClient_ = keep.client;

    // ---- the client ----
    clientsDerived_ = function () {
      return [{ client_key: KEY, name: 'Kenny Marsh', home_address: '1 Main St, Canton' },
              { client_key: 'zz_selftest_other', name: 'Kenny Marshall', home_address: '' }];
    };
    var blank = ask({ client: '  ' });
    var none = ask({ client: 'zz_selftest_nobody' });
    clientsDerived_ = function () { throw new Error('st: isps closed'); };
    var closed = ask({ client: KEY });
    stAssert_(out, P + 'no key is 400, an unknown key is 404 without a guess, unreadable clients are 503',
              blank.status === 400 && none.status === 404 && closed.status === 503 && /clients could not be read/.test(closed.message),
              JSON.stringify([blank, none, closed]));
    clientsDerived_ = function () {
      return [{ client_key: KEY, name: 'Kenny Marsh', home_address: '1 Main St, Canton' },
              { client_key: 'zz_selftest_other', name: 'Kenny Marshall', home_address: '' }];
    };

    // ---- the clock ----
    var clocks = ['14:00', '9:05:00 AM', '12:00:00 AM', '12:30 PM', '2026-09-28T18:30:00.000Z', 'after lunch', '']
      .map(function (v) { var c = csApptClock_(v); return c.label + '/' + c.hm; });
    stAssert_(out, P + 'a start time reads as typed or as a time cell, on a 12-hour clock; words stay as written',
              clocks.join('|') === '2:00 PM/14:00|9:05 AM/09:05|12:00 AM/00:00|12:30 PM/12:30|2:30 PM/14:30|after lunch/|/',
              clocks.join('|'));

    // ---- the join and the shaping ----
    var archive = [
      { id: 'r2', timestamp: '2026-09-01T12:00:00.000Z', client_name: 'Kenny Marsh', dr_name: 'Dr. Ann Smith (Family Practice)',
        appointment_date: '2026-09-30T04:00:00.000Z', appointment_start_time: '14:00', appointment_address: '1 Main St',
        wheelchair_van_required: 'Yes', manager: 'Secret Manager', manager_phone: '3305550000', upcoming: 'Yes' },
      { id: 'r3', timestamp: '2023/02/20 11:02:55 AM GMT-3', client_name: 'kenny  marsh', dr_name: 'Mercy Dental',
        appointment_date: 'Tuesday, February 21, 2023', appointment_start_time: '9:05:00 AM', appointment_address: '1320 Mercy Dr',
        wheelchair_van_required: 'No' },
      { id: 'r4', client_name: 'Kenny Marshall', dr_name: 'Dr Other', appointment_date: '10/01/2026',
        appointment_start_time: '1:00:00 PM', appointment_address: 'Elsewhere' },
      { id: 'r5', client_name: 'Kenny Marsh', dr_name: 'Dr Jones', appointment_date: '9/1/2026',
        appointment_start_time: '3:20:00 PM', appointment_address: '5 Oak' },
      { id: 'r6', client_name: 'Kenny Marsh', dr_name: 'Dr Smith', appointment_date: '10/15/2026',
        appointment_start_time: '10:00 AM', appointment_address: '1 Main St' }
    ];
    var future = [
      { id: 'r2', client_name: 'Kenny Marsh', dr_name: 'Dr. Ann Smith (Family Practice)', appointment_date: '9/30/2026',
        appointment_start_time: '2:00:00 PM', appointment_address: '1 Main St' },
      { id: 'r3', client_name: 'Kenny Marsh', dr_name: 'Dr New', appointment_date: '11/2/2026',
        appointment_start_time: '8:00:00 AM', appointment_address: '9 Elm' },
      { id: 'r4', client_name: 'Kenny Marshall', dr_name: 'Dr Other', appointment_date: '10/2/2026' }
    ];
    var doctorsTab = [
      { id: 'r2', client: 'Kenny Marsh', dr_name: 'Dr. Ann Smith', specialist: 'Primary', status: 'Active',
        phone: '330-555-0101', fax: '', address: '1 Main St', next_visit: '', last_visit: '', standard_freq: '', notes: '' },
      { id: 'r3', client: 'Kenny Marsh', dr_name: 'Mercy Dental', specialist: 'Dental', status: '', active_or_discontinued: 'Active' },
      { id: 'r4', client: 'Kenny Marsh', dr_name: 'Dr. Bo Jones', specialist: 'Podiatrist', status: 'Old' },
      { id: 'r5', client: 'Kenny Marshall', dr_name: 'Dr Other', specialist: 'Primary', status: 'Active' },
      { id: 'r6', client: 'Kenny Marsh', dr_name: 'Dr. Cy Jones', specialist: 'Neurologist', status: 'Active' }
    ];
    var fail = {};
    estateRows_ = function (res) {
      if (fail[res]) throw new Error('st: ' + res + ' closed');
      if (res === 'drVisits') return fail.emptyArchive ? [] : archive;
      if (res === 'drAppointments') return doctorsTab;
      return [];
    };
    csApptTabRows_ = function (tab) {
      if (fail.future) throw new Error('st: future closed');
      return tab === CS_APPT_FUTURE ? future : [];
    };
    csApptToday_ = function () { return '2026-09-28'; };

    var got = ask({ client: KEY });
    var d = (got && got.data) || {};
    var v = ((d.tabs || {}).visits) || {};
    var dr = ((d.tabs || {}).doctors) || {};
    var vBy = {};
    (v.rows || []).forEach(function (r) { vBy[r.id] = r; });
    stAssert_(out, P + 'the client\'s visits only, joined by folded name: upcoming soonest first, then past newest first',
              got.status === 200 && d.client && d.client.client_key === KEY && d.client.name === 'Kenny Marsh' &&
              (v.rows || []).map(function (r) { return r.id + ':' + r.status; }).join() ===
                'r2:Upcoming,r6:Upcoming,future:r3:Upcoming,r5:Past,r3:Past' && d.degraded === false,
              JSON.stringify(v.rows && v.rows.map(function (r) { return r.id + ':' + r.status; })));
    var r2 = vBy.r2 || {}, r3 = vBy.r3 || {}, f3 = vBy['future:r3'] || {};
    stAssert_(out, P + 'a visit carries the mockup\'s columns: its day cut from any date form, the clock, the doctor, ' +
                   'the address and the van; a Future Apts twin is marked, a Future-only visit added and not editable; ' +
                   'the witness is the name cell as the estate\'s update reads it back',
              r2.date === '2026-09-30' && r2.time === '2:00 PM' && r2.time_24 === '14:00' && r2.client_name === 'Kenny Marsh' &&
              r2.dr_name === 'Dr. Ann Smith (Family Practice)' && r2.dr_address === '1 Main St' && r2.van === true &&
              r2.record === r2.dr_name && r2.details === '1 Main St' && r2.editable === true && r2.witness === 'Kenny Marsh' &&
              r2.also_in.join() === CS_APPT_FUTURE && r2.source === CS_APPT_ARCHIVE &&
              r3.date === '2023-02-21' && r3.time === '9:05 AM' && r3.van === false && r3.van_answer === 'No' &&
              r3.witness === 'kenny  marsh' && r3.client_name === 'kenny marsh' &&
              f3.source === CS_APPT_FUTURE && f3.editable === false && f3.date === '2026-11-02' && f3.also_in.length === 0,
              JSON.stringify([r2, r3, f3]));
    var text = JSON.stringify(d);
    stAssert_(out, P + 'no other client, and no manager, manager phone or Upcoming? cell reaches the answer',
              text.indexOf('Kenny Marshall') === -1 && text.indexOf('Dr Other') === -1 && text.indexOf('Secret Manager') === -1 &&
              text.indexOf('3305550000') === -1 && !('manager' in r2) && !('manager_phone' in r2) && !('upcoming' in r2),
              text.slice(0, 400));
    var k = v.kpis || {};
    stAssert_(out, P + 'the visit figures: total, upcoming, past, upcoming with the van, next and last day',
              k.total === 5 && k.upcoming === 3 && k.past === 2 && k.upcoming_van === 1 && k.next_date === '2026-09-30' &&
              k.last_date === '2026-09-01' && (v.statuses || []).join() === 'Upcoming,Past' && !v.why && !!v.as_of,
              JSON.stringify(v.kpis));
    var dBy = {};
    (dr.rows || []).forEach(function (r) { dBy[r.id] = r; });
    var smith = dBy.r2 || {}, mercy = dBy.r3 || {}, bo = dBy.r4 || {};
    stAssert_(out, P + 'the doctors: the client\'s Dr Master rows, active first; the status falls back to Active or ' +
                   'Discontinued; a visit joins a doctor only on a name-word no other doctor of the client shares',
              (dr.rows || []).map(function (r) { return r.id; }).join() === 'r3,r6,r2,r4' &&
              mercy.status === 'Active' && mercy.last_seen === '2023-02-21' && mercy.date === '' &&
              smith.next_booked && smith.next_booked.date === '2026-09-30' && smith.next_booked.id === 'r2' &&
              smith.date === '2026-09-30' && smith.next_visit_source === 'visits' && smith.phone === '330-555-0101' &&
              bo.next_booked === null && (vBy.r5 || {}).doctor_id === '' && r2.doctor_id === 'r2' &&
              (vBy.r6 || {}).doctor_id === 'r2' && r3.doctor_id === 'r3' &&
              JSON.stringify(dr.kpis) === '{"total":4,"active":3,"other":1}' && !dr.why,
              JSON.stringify([dr.rows, dr.kpis]));

    // ---- a source that cannot be read says why ----
    fail = { drVisits: true };
    var noArchive = ask({ client: KEY }).data;
    fail = { drAppointments: true };
    var noMaster = ask({ client: KEY }).data;
    fail = { future: true };
    var noFuture = ask({ client: KEY }).data;
    fail = { emptyArchive: true };
    var emptyArchive = ask({ client: KEY }).data;
    fail = {};
    var back = ask({ client: KEY }, true).data;
    var nv = noArchive.tabs.visits, nm = noMaster.tabs.doctors, nf = noFuture.tabs.visits, ne = emptyArchive.tabs.visits;
    stAssert_(out, P + 'an unreadable archive answers its tab with why and no figures, never zero; the Future Apts rows ' +
                   'it could read still show',
              /Dr Appt Archive could not be read/.test(nv.why) && nv.kpis === null && noArchive.degraded === true &&
              nv.rows.map(function (r) { return r.id; }).join() === 'future:r2,future:r3' &&
              noArchive.tabs.doctors.rows.length === 4, JSON.stringify(nv));
    stAssert_(out, P + 'an unreadable Dr Master, an unreadable Future Apts and an archive with no row at all each say why',
              /Dr Master tab could not be read/.test(nm.why) && nm.kpis === null && nm.rows.length === 0 &&
              /Future Apts tab could not be read/.test(nf.why) && nf.kpis && nf.kpis.total === 4 &&
              /answered no row at all/.test(ne.why) && ne.kpis === null,
              JSON.stringify([nm, nf.why, nf.kpis, ne.why]));
    stAssert_(out, P + 'a degraded answer is not kept: the next read, the sources back, is whole',
              back.degraded === false && back.tabs.visits.kpis && back.tabs.visits.kpis.total === 5 &&
              !back.tabs.visits.why && !back.tabs.doctors.why, JSON.stringify(back.tabs.visits.why || ''));
  } finally {
    csApptClient_ = keep.client;
    clientsDerived_ = keep.derived;
    estateRows_ = keep.estate;
    csApptTabRows_ = keep.tab;
    csApptToday_ = keep.today;
    HUB_MASTER_EMAIL_CACHE = keep.masterCache;
    HUB_MEMBER_CTX = keep.member;
    HUB_IS_SERVICE_REQ = keep.service;
    hubProfileAppRules_ = keep.rules;
    HUB_VIEWER_MEMO = null;
    try { retire(); } catch (e) {}
  }
}
