// Scheduling flows: the policies, every flow walked end to end over an in-memory calendar (call off and its two…
function stSchedulingFlows_(out) {
  var P = 'scheduling flows: ';
  var G = (typeof globalThis !== 'undefined') ? globalThis : this;

  // ---- declarations ----
  var WIDE = '["admin","director","manager","staff"]';
  var SENDS = { schedulingCallOff: true, schedulingSwapPropose: true, schedulingAnswer: true };
  var bad = [];
  SCHED_FLOW_ACTIONS.forEach(function (a) {
    var p = HUB_POLICY[a];
    if (!p || p.file !== 'SchedulingFlows.gs' || typeof HUB_ACTIONS[a] !== 'function') { bad.push(a + ': undeclared'); return; }
    if (p.lane !== 'tool' || p.store !== 'sheet') bad.push(a + ': lane/store ' + p.lane + '/' + p.store);
    if (JSON.stringify(p.roles) !== WIDE) bad.push(a + ': roles ' + JSON.stringify(p.roles));
    if ((p.invalidates || []).length) bad.push(a + ': invalidates');
    if (JSON.stringify(p.emits || []) !== (SENDS[a] ? '["smsSend"]' : '[]')) bad.push(a + ': emits ' + JSON.stringify(p.emits));
    var params = p.params || {};
    Object.keys(params).forEach(function (k) {
      if (params[k] && params[k].required) bad.push(a + ': ' + k + ' required at the door');
      if (!params[k] || ['string', 'boolean'].indexOf(params[k].type) === -1) bad.push(a + ': ' + k + ' untyped');
    });
  });
  stAssert_(out, P + 'seven actions in SchedulingFlows.gs, lane tool, the wide roles (the gate decides), typed params ' +
                 'required at none, invalidating no slice, and smsSend declared exactly where a text can leave',
            bad.length === 0 && SCHED_FLOW_ACTIONS.length === 7, bad.join('; '));

  var seeds = {};
  SMART_EXTRA_SITUATIONS_SEED.forEach(function (s) { seeds[s.id] = s; });
  var seedBad = [];
  SCHED_FLOW_SITUATIONS.forEach(function (id) {
    var s = seeds[id];
    if (!s) { seedBad.push(id + ' absent'); return; }
    if (s.enabled !== 'yes' || s.kind !== 'letter' || s.channels !== 'sms' || !String(s.sms_text || '').trim()) {
      seedBad.push(id + ' ' + s.enabled + '/' + s.kind + '/' + s.channels);
    }
    if (/\{(reason|employee|name|first_name|caller)\}/.test(String(s.sms_text))) seedBad.push(id + ' names the caller or the reason');
    if (/[^\x00-\x7F]/.test(String(s.sms_text))) seedBad.push(id + ' leaves the GSM alphabet');
  });
  stAssert_(out, P + 'the thirteen sched_* situations (the two of the training and the two of the exchange among them) ' +
                 'are seeded ON as letters with SMS words, ASCII only, and none can say who called off or why',
            seedBad.length === 0 && SCHED_FLOW_SITUATIONS.length === 13 &&
            SCHED_FLOW_SITUATIONS.indexOf('sched_training_ask') !== -1 &&
            SCHED_FLOW_SITUATIONS.indexOf('sched_training_decided') !== -1 &&
            String((seeds.sched_training_ask || {}).sms_text).indexOf('{trainee}') !== -1 &&
            ['sched_exchange_ask', 'sched_exchange_done'].every(function (id) {
              var t = String((seeds[id] || {}).sms_text || '');
              return t.indexOf('{their_shift}') !== -1 && t.indexOf('{their_house}') !== -1 && t.indexOf('{their_date}') !== -1;
            }), seedBad.join('; '));
  ['sched_calloff_house', 'sched_calloff_everyone'].forEach(function (id) {
    var t = String((seeds[id] || {}).sms_text || '');
    stAssert_(out, P + id + ' is the URGENT layout: house, day, hour and street',
              /URGENT OPEN SHIFT/.test(t) && t.indexOf('{house}') !== -1 && t.indexOf('{day_word}') !== -1 &&
              t.indexOf('{time}') !== -1 && t.indexOf('{location}') !== -1, t);
  });

  // ---- Smart Comms says every text ----
  var schedCode = [];
  for (var gn in G) {
    if (/^sched/.test(gn) && typeof G[gn] === 'function') schedCode.push({ n: gn, c: stCode_(G[gn]) });
  }
  Object.keys(HUB_ACTIONS).forEach(function (a) {
    if (/^scheduling/.test(a) && typeof HUB_ACTIONS[a] === 'function') schedCode.push({ n: a, c: stCode_(HUB_ACTIONS[a]) });
  });
  var talks = schedCode.filter(function (f) {
    return /\b(rpcCall_|smartRender_|smartSituationOn_)\s*\(/.test(f.c);
  }).map(function (f) { return f.n; });
  stAssert_(out, P + 'Scheduling never renders words, reads a switch or knocks the door: schedText_ hands each text to ' +
                 'smartTell_ and no scheduling function calls rpcCall_, smartRender_ or smartSituationOn_',
            talks.length === 0 && schedCode.length > 20 && typeof schedFlowWords_ === 'undefined' &&
            /\bsmartTell_\s*\(/.test(stCode_(schedText_)), talks.join(', ') + ' / ' + schedCode.length + ' scanned');

  // ---- the hooks ----
  var sweep = stCode_(HUB_ACTIONS.hiringSweep);
  stAssert_(out, P + 'the clock left hiringSweep: the relay rings Python\'s (app/scheduling_clock*) on its fast beat',
            sweep.indexOf('schedulingClockTick_()') === -1, '');
  var hot = stCode_(HUB_ACTIONS.hotlineSweep);
  var heardAt = hot.indexOf('schedulingCallOffHeard_({');
  stAssert_(out, P + 'the phone hook sits inside the call-off branch right after the queue row, guarded and wrapped, ' +
                 'with the instance, the name, its provenance and the two days',
            heardAt !== -1 && heardAt > hot.indexOf('hotlineCallOffQueue_({') &&
            hot.indexOf("typeof schedulingCallOffHeard_ === 'function'") !== -1 &&
            hot.slice(heardAt, heardAt + 400).indexOf("source: 'hotline'") !== -1 &&
            hot.slice(heardAt, heardAt + 400).indexOf('instance: rq.instance') !== -1 &&
            hot.slice(heardAt, heardAt + 400).indexOf('name_from: rqWho.from') !== -1 &&
            hot.slice(heardAt, heardAt + 400).indexOf('shift_day: commCallOffShiftDayFrom_(') !== -1 &&
            hot.slice(hot.lastIndexOf('try {', heardAt), heardAt).indexOf('if (typeof schedulingCallOffHeard_') !== -1, '');

  // ---- the stand-ins ----
  var STUBS = ['schedGate_', 'schedRefuse_', 'schedRead_', 'schedUpsert_', 'schedAppend_', 'schedLock_', 'schedBump_',
               'schedSettings_', 'schedPeriodOf_', 'schedCellAt_', 'schedClash_', 'schedSetCell_', 'schedOpenShift_',
               'schedHouseManagers_', 'schedUserByKey_', 'schedPhoneOf_', 'schedHouseLabel_', 'schedShiftWords_',
               'schedBoardPart_', 'schedRoll_', 'schedTestMode_', 'rpcCall_', 'smartSituationOn_', 'locationsHomes_',
               'hubSysLog_', 'smartRecord_', 'hubSituationRead_', 'schedTrainingNeed_', 'schedIstWarm_'];
  var keep = {};
  STUBS.forEach(function (n) { keep[n] = G[n]; });
  var keepVars = { now: SCHED_FLOW_NOW, due: SCHED_FLOW_DUE_KEY, roll: SCHED_FLOW_ROLL_PROP, owed: SCHED_FLOW_PHONE_OWED,
                   member: (typeof HUB_MEMBER_CTX !== 'undefined') ? HUB_MEMBER_CTX : null,
                   resolve: SMART_TO_KEYWORDS.allstaff.resolve, sha1: Utilities.DigestAlgorithm.SHA_1,
                   told: SMART_TELL_LEDGERED };
  SMART_TELL_LEDGERED = {};
  SCHED_FLOW_DUE_KEY = 'sched_due_at_selftest';
  SCHED_FLOW_ROLL_PROP = 'SCHED_ROLL_CHECKED_DAY_SELFTEST';
  SCHED_FLOW_PHONE_OWED = 'SCHED_PHONE_OWED_SELFTEST|';
  if (!Utilities.DigestAlgorithm.SHA_1) Utilities.DigestAlgorithm.SHA_1 = 'sha1';
  HUB_MEMBER_CTX = null;

  var K = { ana: clientNameKey_('Ana Smith'), bob: clientNameKey_('Bob Jones'), cara: clientNameKey_('Cara Lee'),
            dan: clientNameKey_('Dan Ray'), eve: clientNameKey_('Eve Tan'), fay: clientNameKey_('Fay Ode'),
            gus: clientNameKey_('Gus Pak'), zed: clientNameKey_('Zed Nobody') };
  var PEOPLE = {
    ana: { uid: 'U_ANA', name: 'Ana Smith', email: 'ana@x', role: 'staff' },
    bob: { uid: 'U_BOB', name: 'Bob Jones', email: 'bob@x', role: 'staff' },
    cara: { uid: 'U_CARA', name: 'Cara Lee', email: 'cara@x', role: 'staff' },
    dan: { uid: 'U_DAN', name: 'Dan Ray', email: 'dan@x', role: 'staff' },
    eve: { uid: 'U_EVE', name: 'Eve Tan', email: 'eve@x', role: 'staff' },
    fay: { uid: 'U_FAY', name: 'Fay Ode', email: 'fay@x', role: 'staff' },
    gus: { uid: 'U_GUS', name: 'Gus Pak', email: 'gus@x', role: 'staff' },
    ty: { uid: 'U_TY', name: 'Ty Bond', email: 'ty@x', role: 'admin' },
    brit: { uid: 'U_BRIT', name: 'Brittany Anderson', email: 'brit@x', role: 'staff' },
    boss: { uid: 'U_BOSS', name: 'Master', email: 'master@x', role: 'admin' }
  };
  var PHONES = { ana: '+13305550001', bob: '+13305550002', cara: '+13305550003', eve: '+13305550005',
                 fay: '+13305550006', gus: '+13305550007' };
  var keyToWho = {};
  Object.keys(K).forEach(function (w) { keyToWho[K[w]] = w; });
  keyToWho[clientNameKey_('Ty Bond')] = 'ty';
  keyToWho[clientNameKey_('Brittany Anderson')] = 'brit';
  PHONES.ty = '+13305550008';
  PHONES.brit = '+13305550009';
  var SHIFT = { '8A-4P': { kind: 'day', start_min: 480, end_min: 960 },
                '4P-12A': { kind: 'evening', start_min: 960, end_min: 1440 },
                '12A-8A': { kind: 'overnight', start_min: 0, end_min: 480 } };
  var user = function (w) { return { id: PEOPLE[w].uid, email: PEOPLE[w].email, display_name: PEOPLE[w].name, role: PEOPLE[w].role }; };

  var db, sent, rolls, reads, lockBusy, settings, dirsReadable, gateOpen;
  var copy = function (o) { return JSON.parse(JSON.stringify(o)); };
  var cellOf = function (house, rowId, date, text, state, extra) {
    var c = { id: 'SC_' + house + '|' + rowId + '|' + date, period_id: 'P2026-09-28', house_code: house, date: date,
              row_id: rowId, text: text, kind: (SHIFT[text] || { kind: 'ro' }).kind,
              start_min: SHIFT[text] ? SHIFT[text].start_min : '', end_min: SHIFT[text] ? SHIFT[text].end_min : '',
              hours: '', token: '', color: '', state: state || 'scheduled', base: '', flow_id: '', source: 'seed:x',
              note: '', updated_at: '', updated_by: '' };
    for (var k in (extra || {})) c[k] = extra[k];
    return c;
  };
  var rowOf = function (house, w, designation, order) {
    return { id: 'SR_' + house + '|P:' + K[w], house_code: house, location: 'CAN - X - ' + house, row_id: 'P:' + K[w],
             row_kind: 'person', name: PEOPLE[w].name, person_key: K[w], designation: designation || '', order: order,
             active: 'yes', source: 'seed:x', updated_at: '', updated_by: '' };
  };
  var reset = function () {
    db = {
      sched_cells: [
        cellOf('BM4060', 'P:' + K.ana, '2026-10-05', '4P-12A'),
        cellOf('BM4060', 'P:' + K.ana, '2026-10-06', '8A-4P'),
        cellOf('BM4060', 'P:' + K.ana, '2026-10-20', '8A-4P'),
        cellOf('BM4060', 'P:' + K.ana, '2026-10-21', '8A-4P'),
        cellOf('FT4801', 'P:' + K.eve, '2026-10-05', '4P-12A'),
        cellOf('FT4801', 'P:' + K.eve, '2026-10-06', '8A-4P'),
        cellOf('BM4060', 'P:' + K.fay, '2026-10-07', '8A-4P'),
        cellOf('FT4801', 'P:' + K.fay, '2026-10-07', '4P-12A')
      ],
      sched_rows: [
        { id: 'SR_BM4060|OPEN:1', house_code: 'BM4060', location: 'CAN - BM - BM4060', row_id: 'OPEN:1', row_kind: 'open',
          name: 'OPEN', person_key: '', designation: '', order: 0, active: 'yes' },
        rowOf('BM4060', 'cara', '**', 1), rowOf('BM4060', 'ana', '', 2), rowOf('BM4060', 'bob', '', 3),
        rowOf('BM4060', 'dan', '', 4), rowOf('BM4060', 'eve', '', 5), rowOf('BM4060', 'fay', '', 6),
        rowOf('FT4801', 'eve', '', 1), rowOf('FT4801', 'fay', '', 2)
      ],
      sched_flows: [], sched_inbox: [], log: []
    };
    sent = []; rolls = []; reads = 0; lockBusy = false; dirsReadable = true; gateOpen = true;
    settings = {
      readable: true, why: '', directors: [{ email: 'ty@x', uid: 'U_TY', name: 'Ty Bond' },
                                          { email: 'brit@x', uid: 'U_BRIT', name: 'Brittany Anderson' }],
      directors_readable: true, directors_why: '', cycle_days: 28, roll_lead_days: 7, outreach_wait_min: 7,
      min_days_ahead: 7, periods: [{ id: 'P2026-09-28', first: '2026-09-28', last: '2026-10-25', state: 'live' }],
      houses: [{ code: 'BM4060', location: 'CAN - BM - BM4060', short: 'BM' },
               { code: 'FT4801', location: 'CAN - FT - FT4801', short: 'FT' }]
    };
    try { CacheService.getScriptCache().remove(SCHED_FLOW_DUE_KEY); } catch (e) { /* */ }
    try {
      var pr = PropertiesService.getScriptProperties();
      [SCHED_FLOW_ROLL_PROP, SCHED_FLOW_PHONE_OWED + 'index'].forEach(function (k) { pr.deleteProperty(k); });
    } catch (e2) { /* */ }
  };
  var find = function (tab, pred) { return db[tab].filter(pred); };
  var cellAt = function (house, rowId, date) {
    return find('sched_cells', function (c) { return c.house_code === house && c.row_id === rowId && c.date === date; })[0] || null;
  };
  var upsert = function (tab, rows) {
    rows.forEach(function (r) {
      var i = -1;
      db[tab].forEach(function (x, j) { if (x.id === r.id) i = j; });
      if (i === -1) db[tab].push(copy(r)); else db[tab][i] = copy(r);
    });
  };

  G.schedRefuse_ = function (status, message) { return { status: status, message: message }; };
  G.schedGate_ = function (u) {
    var w = null;
    Object.keys(PEOPLE).forEach(function (k) { if (u && PEOPLE[k].uid === u.id) w = k; });
    if (!w || !gateOpen) return { open: false };
    return { open: true, uid: PEOPLE[w].uid, name: PEOPLE[w].name, key: K[w] || clientNameKey_(PEOPLE[w].name),
             is_master: w === 'boss', is_director: w === 'ty' || w === 'brit',
             editorOf: function (h) { return w === 'cara' && h === 'BM4060'; } };
  };
  G.schedRead_ = function (tab) {
    reads++;
    if (!db[tab]) throw new Error('the ' + tab + ' house could not be read');
    return copy(db[tab]);
  };
  G.schedUpsert_ = function (tab, rows) { upsert(tab, rows); };
  G.schedAppend_ = function (tab, rows) { rows.forEach(function (r) { db[tab].push(copy(r)); }); };
  G.schedLock_ = function (fn) {
    if (lockBusy) return { status: 409, message: 'Somebody else is changing the calendar right now — try again.' };
    return fn();
  };
  G.schedBump_ = function () {};
  G.schedSettings_ = function () {
    var s = copy(settings);
    if (!dirsReadable) { s.directors = []; s.directors_readable = false; s.directors_why = 'the directors cell is unreadable'; }
    return s;
  };
  G.schedPeriodOf_ = function (date) {
    var hit = null;
    settings.periods.forEach(function (p) { if (date >= p.first && date <= p.last) hit = p; });
    return hit;
  };
  G.schedCellAt_ = function (h, r, d) { var c = cellAt(h, r, d); return c ? copy(c) : null; };
  G.schedClash_ = function (key, date, s, e) {
    var hit = null;
    db.sched_cells.forEach(function (c) {
      if (c.row_id !== 'P:' + key || c.date !== date) return;
      var off = ['called_off', 'requested_off', 'time_off'].indexOf(c.state) !== -1;
      if (!off && (c.start_min === '' || !c.text)) return;
      if (off || (Number(c.start_min) < e && s < Number(c.end_min))) {
        hit = { house_code: c.house_code, date: date, text: c.text, why: off ? 'off that day' : c.text + ' at ' + c.house_code };
      }
    });
    return hit;
  };
  G.schedSetCell_ = function (h, r, d, patch, via, ctx, note, flowId) {
    var c = cellAt(h, r, d);
    db.log.push({ house: h, row: r, date: d, was: c ? c.text : '', now: patch.text, state: patch.state, via: via,
                  by: ctx && ctx.name, flow: flowId });
    if (!patch.text && !patch.state) {
      db.sched_cells = db.sched_cells.filter(function (x) { return x !== c; });
      return null;
    }
    if (!c) { c = cellOf(h, r, d, patch.text, patch.state); db.sched_cells.push(c); }
    var sh = SHIFT[patch.text];
    c.text = patch.text; c.state = patch.state; c.base = patch.base; c.flow_id = patch.flow_id; c.source = patch.source;
    c.kind = sh ? sh.kind : (patch.text ? 'ro' : '');
    c.start_min = sh ? sh.start_min : ''; c.end_min = sh ? sh.end_min : '';
    return copy(c);
  };
  G.schedOpenShift_ = function (h, d, text, flowId) {
    var opens = find('sched_rows', function (r) { return r.house_code === h && r.row_kind === 'open'; });
    var free = null;
    opens.forEach(function (r) { if (!free && !cellAt(h, r.row_id, d)) free = r.row_id; });
    if (!free) {
      free = 'OPEN:' + (opens.length + 1);
      db.sched_rows.push({ id: 'SR_' + h + '|' + free, house_code: h, row_id: free, row_kind: 'open', name: 'OPEN',
                           person_key: '', designation: '', order: 0, active: 'yes' });
    }
    db.sched_cells.push(cellOf(h, free, d, text, 'open', { flow_id: flowId, source: 'flow:' + flowId }));
    return { row_id: free };
  };
  G.schedHouseManagers_ = function (h) {
    return h === 'BM4060' ? [{ name: 'Cara Lee', key: K.cara, uid: 'U_CARA', email: 'cara@x' }] : [];
  };
  G.schedUserByKey_ = function (key) {
    var w = keyToWho[key];
    return w && PEOPLE[w] ? { uid: PEOPLE[w].uid, email: PEOPLE[w].email, name: PEOPLE[w].name, role: PEOPLE[w].role } : null;
  };
  G.schedPhoneOf_ = function (key) { return PHONES[keyToWho[key]] || ''; };
  G.schedHouseLabel_ = function (h) { return { BM4060: 'BM', FT4801: 'FT' }[h] || h; };
  G.schedShiftWords_ = function (c) { return c.text; };
  G.schedBoardPart_ = function () { return { grids: {}, busy: {}, mine: [] }; };
  G.schedRoll_ = function (ctx, dry) { rolls.push({ ctx: ctx, dry: dry }); return { ok: true }; };
  G.schedTestMode_ = function () { return { on: true, readable: true, why: '' }; };
  G.rpcCall_ = function (method, params, opts) {
    sent.push({ method: method, to: params.to, body: params.body, reason: params.reason, key: opts && opts.idempotency_key });
    return { ok: true, sent: true };
  };
  G.smartSituationOn_ = function (id) { return seeds[id] && seeds[id].enabled === 'yes' ? seeds[id] : null; };
  G.smartRecord_ = function () { return true; };
  G.hubSituationRead_ = function (id) {
    return { row: seeds[id] || null, on: !!(seeds[id] && seeds[id].enabled === 'yes'), unreadable: '' };
  };
  G.locationsHomes_ =function () { return [{ code: 'BM4060', address: '123 Main St' }, { code: 'FT4801', address: '9 Elm Rd' }]; };
  G.hubSysLog_ = function () { return true; };
  // the IST is the data layer's (SelfTestScheduling.gs walks the training over it): here everybody is trained
  G.schedTrainingNeed_ = function () { return null; };
  G.schedIstWarm_ = function () { return { readable: true }; };
  SMART_TO_KEYWORDS.allstaff.resolve = function (facts) {
    var people = [];
    ['ana', 'bob', 'cara', 'eve', 'fay', 'gus'].forEach(function (w) {
      if (K[w] !== facts.person_key) people.push({ person_key: K[w], name: PEOPLE[w].name, phone: PHONES[w] });
    });
    return { ok: true, readable: true, people: people, why: people.length + ' can be texted' };
  };

  var act = function (a, w, payload) { return HUB_ACTIONS[a](payload, user(w)); };
  var flowsOf = function (kind) { return find('sched_flows', function (f) { return f.kind === kind; }); };
  var itemsOf = function (pred) { return find('sched_inbox', pred); };
  var byPhone = {};
  Object.keys(PHONES).forEach(function (w) { byPhone[PHONES[w]] = w; });
  var toOf = function (list) { return list.map(function (s) { return byPhone[s.to]; }).sort().join(','); };
  var answer = function (w, item, word, note) { return act('schedulingAnswer', w, { item_id: item.id, word: word, note: note || '' }); };
  var itemFor = function (flowId, uid, box) {
    return itemsOf(function (i) { return i.flow_id === flowId && i.to_uid === uid && i.box === (box || 'work'); })[0];
  };

  try {
    // ---- the gate ----
    reset();
    gateOpen = false;
    var shut = SCHED_FLOW_ACTIONS.filter(function (a) { return a !== 'schedulingAnswer'; }).map(function (a) {
      return act(a, 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-20', flow_id: 'SF0000000000',
                             from: '2026-10-20', to: '2026-10-21' }).status;
    });
    stAssert_(out, P + 'a closed app gate answers every flow action 404-shaped — the answer from My Work is the one exception',
              shut.every(function (s) { return s === 404; }), JSON.stringify(shut));

    // ---- call off: stage 1, the wait, stage 2 ----
    reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    PropertiesService.getScriptProperties().setProperty(SCHED_FLOW_ROLL_PROP, '2026-10-05');
    var co = act('schedulingCallOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-05', reason: 'flu' });
    var coFlow = flowsOf('call_off')[0] || {};
    var mine = cellAt('BM4060', 'P:' + K.ana, '2026-10-05') || {};
    var open1 = cellAt('BM4060', 'OPEN:1', '2026-10-05') || {};
    stAssert_(out, P + 'Call Off: the cell becomes C/O (base kept), the shift lands on the first free OPEN row, and the ' +
                   'flow is a call_off from the platform',
              co.status === 200 && co.data.ok === true && co.data.flow_id === coFlow.id &&
              mine.text === 'C/O' && mine.state === 'called_off' && mine.base === '4P-12A' &&
              open1.text === '4P-12A' && open1.state === 'open' && open1.flow_id === coFlow.id &&
              coFlow.open_row_id === 'OPEN:1' && coFlow.source === 'platform' && coFlow.reason === 'flu',
              JSON.stringify({ co: co, mine: mine, open1: open1, flow: coFlow }));
    var s1 = sent.filter(function (s) { return s.reason === 'scheduling: sched_calloff_house'; });
    var log1 = JSON.parse(coFlow.outreach_log || '{}').stage1 || {};
    stAssert_(out, P + 'stage 1 goes at once to the house manager and the house\'s free staff — never the caller, ' +
                   'never someone busy elsewhere, one key per person — and the flow then waits',
              toOf(s1) === 'bob,cara,fay' && coFlow.state === 'outreach_wait' && Number(coFlow.outreach_stage) === 1 &&
              log1.sent === 3 && log1.no_phone === 1 && log1.busy === 1 &&
              s1.every(function (s) { return /^sched:SF[0-9A-F]{10}:s1:/.test(s.key); }) &&
              Date.parse(coFlow.outreach_next_at) === Date.parse('2026-10-05T14:07:00Z'),
              JSON.stringify({ sent: s1, flow: coFlow }));
    stAssert_(out, P + 'the open-shift text says house, day, hour and street, and never who called off nor why',
              s1.length > 0 && s1.every(function (s) {
                return /URGENT OPEN SHIFT/.test(s.body) && s.body.indexOf('BM') !== -1 && s.body.indexOf('today') !== -1 &&
                       s.body.indexOf('4pm') !== -1 && s.body.indexOf('123 Main St') !== -1 &&
                       s.body.indexOf('Ana') === -1 && s.body.indexOf('flu') === -1 && !/\{\w+\}/.test(s.body);
              }), s1.length ? s1[0].body : 'nothing sent');
    var warn = itemsOf(function (i) { return i.flow_id === coFlow.id && i.kind === 'warning'; });
    stAssert_(out, P + 'both directors get the CALL OFF warning in My Inbox → Alerts, with the reason (they may see it)',
              warn.length === 2 && warn.every(function (i) {
                return i.box === 'inbox' && i.seat === 'director' && i.state === 'posted' &&
                       i.title === 'Call off — Mon 10/5 · 4P-12A · BM' && i.body.indexOf('flu') !== -1 &&
                       i.link === '/app/scheduling/calendar?house=BM4060&day=2026-10-05' && i.test_mode === 'yes';
              }) && warn.map(function (i) { return i.to_uid; }).sort().join() === 'U_BRIT,U_TY', JSON.stringify(warn));
    var again = act('schedulingCallOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-05' });
    stEq_(out, P + 'a second Call Off of the same shift is refused', again.status, 409);
    var other = act('schedulingCallOff', 'bob', { house: 'BM4060', row_id: 'P:' + K.fay, date: '2026-10-07' });
    stEq_(out, P + 'staff cannot call off somebody else\'s shift', other.status, 403);

    sent = []; reads = 0;
    SCHED_FLOW_NOW = '2026-10-05T14:03:00Z';
    var early = schedulingClockTick_();
    stAssert_(out, P + 'the clock before the wait costs one cache read: no house is read, nothing is sent',
              early.ran === false && reads === 0 && sent.length === 0, JSON.stringify(early) + ' reads=' + reads);
    SCHED_FLOW_NOW = '2026-10-05T14:08:00Z';
    var tick2 = schedulingClockTick_();
    var s2 = sent.filter(function (s) { return s.reason === 'scheduling: sched_calloff_everyone'; });
    coFlow = flowsOf('call_off')[0];
    stAssert_(out, P + 'after the wait, still open: stage 2 to everyone the staff list resolves, less the caller and ' +
                   'stage 1, and the flow is done',
              tick2.ran === true && toOf(s2) === 'eve,gus' && coFlow.state === 'done' &&
              Number(coFlow.outreach_stage) === 2 && !coFlow.outreach_next_at &&
              s2.every(function (s) { return s.body.indexOf('Ana') === -1 && /^sched:SF[0-9A-F]{10}:s2:/.test(s.key); }),
              JSON.stringify({ tick: tick2.claimed, sent: s2.map(function (s) { return s.to; }), flow: coFlow.state }));
    sent = [];
    SCHED_FLOW_NOW = '2026-10-05T14:20:00Z';
    CacheService.getScriptCache().remove(SCHED_FLOW_DUE_KEY);
    schedulingClockTick_();
    stEq_(out, P + 'a done call-off is never texted again, even when the clock stamp is lost', sent.length, 0);

    // ---- the quiet window ----
    reset();
    SCHED_FLOW_NOW = '2026-10-06T02:00:00Z';
    act('schedulingCallOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-06' });
    var qFlow = flowsOf('call_off')[0] || {};
    stAssert_(out, P + 'a call-off at 22:00 opens the shift at once and holds every text to 08:00 Ohio',
              sent.length === 0 && (cellAt('BM4060', 'OPEN:1', '2026-10-06') || {}).state === 'open' &&
              qFlow.state === 'outreach_1' && Date.parse(qFlow.outreach_next_at) === Date.parse('2026-10-06T12:00:00Z'),
              JSON.stringify({ sent: sent.length, flow: qFlow }));
    SCHED_FLOW_NOW = '2026-10-06T11:00:00Z';
    schedulingClockTick_();
    var stillQuiet = sent.length;
    SCHED_FLOW_NOW = '2026-10-06T12:00:30Z';
    schedulingClockTick_();
    qFlow = flowsOf('call_off')[0];
    stAssert_(out, P + 'at 08:00 the held stage 1 goes out and the wait starts then',
              stillQuiet === 0 && toOf(sent) === 'bob,cara,fay' && qFlow.state === 'outreach_wait', toOf(sent) + ' ' + qFlow.state);

    // ---- covered stops it; the take race ----
    reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    act('schedulingCallOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-05' });
    var notFree = act('schedulingTake', 'eve', { house: 'BM4060', row_id: 'OPEN:1', date: '2026-10-05' });
    var took = act('schedulingTake', 'bob', { house: 'BM4060', row_id: 'OPEN:1', date: '2026-10-05' });
    var late = act('schedulingTake', 'fay', { house: 'BM4060', row_id: 'OPEN:1', date: '2026-10-05' });
    var bobCell = cellAt('BM4060', 'P:' + K.bob, '2026-10-05') || {};
    var cov = flowsOf('call_off')[0];
    var takeFlow = flowsOf('take')[0] || {};
    var takeInfo = itemsOf(function (i) { return i.flow_id === takeFlow.id; });
    stAssert_(out, P + 'take: someone busy elsewhere is refused; the first free taker gets it at once, the open cell ' +
                   'empties, the outreach is covered; the second taker is refused',
              notFree.status === 409 && took.status === 200 && late.status === 409 &&
              bobCell.text === '4P-12A' && bobCell.state === 'taken' && !cellAt('BM4060', 'OPEN:1', '2026-10-05') &&
              cov.state === 'covered' && takeFlow.state === 'done',
              JSON.stringify({ notFree: notFree, took: took.status, late: late, bob: bobCell, cov: cov.state }));
    stAssert_(out, P + 'take: the house manager and both directors get the informative in My Inbox',
              takeInfo.length === 3 && takeInfo.every(function (i) { return i.box === 'inbox' && i.kind === 'info'; }) &&
              takeInfo.map(function (i) { return i.to_uid; }).sort().join() === 'U_BRIT,U_CARA,U_TY', JSON.stringify(takeInfo));
    sent = [];
    SCHED_FLOW_NOW = '2026-10-05T14:09:00Z';
    schedulingClockTick_();
    stEq_(out, P + 'covered before stage 2: nobody else is texted', sent.length, 0);

    // ---- Request Off ----
    reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    var soon = act('schedulingRequestOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-06' });
    var rq = act('schedulingRequestOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-20', note: 'wedding' });
    var rqFlow = flowsOf('request_off')[0] || {};
    var rqItems = itemsOf(function (i) { return i.flow_id === rqFlow.id; });
    stAssert_(out, P + 'Request Off inside the notice is refused; outside it asks both directors in My Work and ' +
                   'changes nothing on the calendar yet',
              soon.status === 409 && rq.status === 200 && rqFlow.state === 'waiting' && rqItems.length === 2 &&
              rqItems.every(function (i) { return i.box === 'work' && i.kind === 'approval' && i.seat === 'director' && i.state === 'waiting'; }) &&
              cellAt('BM4060', 'P:' + K.ana, '2026-10-20').text === '8A-4P',
              JSON.stringify({ soon: soon, rq: rq.status, items: rqItems.length }));
    var notSeat = answer('bob', itemFor(rqFlow.id, 'U_TY'), 'approve');
    var tyAns = answer('ty', itemFor(rqFlow.id, 'U_TY'), 'approve');
    rqFlow = flowsOf('request_off')[0];
    var britItem = itemFor(rqFlow.id, 'U_BRIT');
    var britAns = answer('brit', britItem, 'decline');
    var roCell = cellAt('BM4060', 'P:' + K.ana, '2026-10-20') || {};
    var roOpen = cellAt('BM4060', 'OPEN:1', '2026-10-20') || {};
    var roChild = flowsOf('call_off')[0] || {};
    stAssert_(out, P + 'Request Off approved by the first director: R/O on the cell (base kept), the shift OPEN at the ' +
                   'top, the call-off outreach running; the other director\'s item superseded and told who answered',
              notSeat.status === 403 && tyAns.status === 200 && tyAns.data.changed === true &&
              rqFlow.state === 'approved' && roCell.text === 'R/O' && roCell.state === 'requested_off' &&
              roCell.base === '8A-4P' && roOpen.state === 'open' && roChild.source_ref === rqFlow.id &&
              roChild.state === 'outreach_wait' && britItem.state === 'superseded' && britItem.answered_by === 'Ty Bond' &&
              britAns.status === 200 && britAns.data.changed === false && britAns.data.said === 'Already answered by Ty Bond.',
              JSON.stringify({ notSeat: notSeat, ty: tyAns, flow: rqFlow.state, cell: roCell, brit: britAns }));
    var rqInfo = itemsOf(function (i) { return i.flow_id === rqFlow.id && i.box === 'inbox'; });
    var decided = sent.filter(function (s) { return s.reason === 'scheduling: sched_request_decided'; });
    stAssert_(out, P + 'after the approval both directors and the requester get the informative, and the requester ' +
                   'a text; no call-off warning for an approved request',
              rqInfo.length === 3 && rqInfo.map(function (i) { return i.to_uid; }).sort().join() === 'U_ANA,U_BRIT,U_TY' &&
              toOf(decided) === 'ana' && decided[0].body.indexOf('approved') !== -1 &&
              itemsOf(function (i) { return i.kind === 'warning'; }).length === 0,
              JSON.stringify({ info: rqInfo.length, decided: decided }));
    act('schedulingRequestOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-21' });
    var rq2 = flowsOf('request_off').filter(function (f) { return f.date === '2026-10-21'; })[0];
    sent = [];
    var dec = answer('brit', itemFor(rq2.id, 'U_BRIT'), 'decline', 'short staffed');
    rq2 = flowsOf('request_off').filter(function (f) { return f.date === '2026-10-21'; })[0];
    stAssert_(out, P + 'Request Off declined: nothing changes, the requester is texted and alerted',
              dec.status === 200 && rq2.state === 'declined' && cellAt('BM4060', 'P:' + K.ana, '2026-10-21').text === '8A-4P' &&
              toOf(sent) === 'ana' && sent[0].body.indexOf('not approved') !== -1 &&
              itemsOf(function (i) { return i.flow_id === rq2.id && i.seat === 'requester'; }).length === 1 &&
              itemFor(rq2.id, 'U_TY').state === 'superseded', JSON.stringify({ dec: dec, flow: rq2.state, sent: sent }));

    // ---- the seat ----
    reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    act('schedulingRequestOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-20' });
    var sf = flowsOf('request_off')[0];
    db.sched_inbox.push({ id: 'SI00000000AA', flow_id: sf.id, box: 'work', kind: 'approval', seat: 'director',
                          to_uid: 'U_ANA', state: 'waiting', title: 't' });
    var self = answer('ana', { id: 'SI00000000AA' }, 'approve');
    HUB_MEMBER_CTX = { userId: 'U_TY', memberId: 'M1' };
    var visit = answer('ty', itemFor(sf.id, 'U_TY'), 'approve');
    HUB_MEMBER_CTX = null;
    var twice1 = answer('ty', itemFor(sf.id, 'U_TY'), 'decline');
    var twice2 = answer('ty', itemFor(sf.id, 'U_TY'), 'approve');
    var badWord = answer('ty', itemFor(sf.id, 'U_TY'), 'maybe');
    stAssert_(out, P + 'the answer is the seat\'s: never the subject, never during a visit, once — a second answer ' +
                   'changes nothing and says who answered',
              self.status === 403 && visit.status === 403 && twice1.status === 200 && twice1.data.changed === true &&
              twice2.status === 200 && twice2.data.changed === false && twice2.data.said === 'Already answered by Ty Bond.' &&
              badWord.status === 400 && flowsOf('request_off')[0].state === 'declined',
              JSON.stringify({ self: self, visit: visit, twice2: twice2, bad: badWord }));
    dirsReadable = false;
    var noDirs = act('schedulingRequestOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-21' });
    var coNoDirs = act('schedulingCallOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-21' });
    dirsReadable = true;
    stAssert_(out, P + 'an unreadable directors list refuses what needs a director, and a Call Off still happens ' +
                   '(the missing warning written on the flow)',
              noDirs.status === 503 && coNoDirs.status === 200 &&
              flowsOf('call_off').some(function (f) { return /directors were not warned/.test(f.note); }),
              JSON.stringify(noDirs));

    // ---- the master stands in on a director seat ----
    reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    act('schedulingRequestOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-20' });
    var mf = flowsOf('request_off')[0];
    db.sched_inbox.push({ id: 'SI00000000AB', flow_id: mf.id, box: 'work', kind: 'approval', seat: 'house_manager',
                          to_uid: 'U_CARA', state: 'waiting', title: 't' });
    db.sched_inbox.push({ id: 'SI00000000AC', flow_id: mf.id, box: 'inbox', kind: 'warning', seat: 'director',
                          to_uid: 'U_TY', state: 'posted', title: 't' });
    var mOther = answer('boss', { id: 'SI00000000AB' }, 'approve');
    var mAlert = answer('boss', { id: 'SI00000000AC' }, 'seen');
    HUB_MEMBER_CTX = { userId: 'U_BOSS', memberId: 'M1' };
    var mVisit = answer('boss', itemFor(mf.id, 'U_TY'), 'approve');
    HUB_MEMBER_CTX = null;
    var mBob = answer('bob', itemFor(mf.id, 'U_TY'), 'approve');
    var mAns = answer('boss', itemFor(mf.id, 'U_TY'), 'approve');
    mf = flowsOf('request_off')[0];
    var mSeat = (JSON.parse(mf.seats || '[]').filter(function (s) { return s.seat === 'director'; })[0]) || {};
    var mTy = itemFor(mf.id, 'U_TY'), mBrit = itemFor(mf.id, 'U_BRIT');
    var mTold = itemsOf(function (i) { return i.flow_id === mf.id && i.box === 'inbox' && i.kind === 'info'; });
    stAssert_(out, P + 'the master decides a director seat as a director does, recorded as the master\'s: the seat, the ' +
                   'item and the sibling name the master; never another seat, never an alert addressed to a director, never ' +
                   'during a visit, and an account that is neither still cannot; the informatives go to the same people',
              mOther.status === 403 && mAlert.status === 403 && mVisit.status === 403 && mBob.status === 403 &&
              mAns.status === 200 && mAns.data.changed === true && mf.state === 'approved' &&
              mSeat.state === 'approved' && mSeat.by === 'Master' && mSeat.by_uid === 'U_BOSS' &&
              mTy.state === 'approved' && mTy.answered_by === 'Master' && mBrit.state === 'superseded' &&
              mBrit.answered_by === 'Master' &&
              mTold.map(function (i) { return i.to_uid; }).sort().join() === 'U_ANA,U_BRIT,U_TY',
              JSON.stringify({ other: mOther, alert: mAlert, visit: mVisit, bob: mBob, ans: mAns, seat: mSeat,
                               ty: mTy, brit: mBrit, told: mTold.map(function (i) { return i.to_uid; }) }));
    act('schedulingRequestOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-21' });
    var mf2 = flowsOf('request_off').filter(function (f) { return f.date === '2026-10-21'; })[0];
    db.sched_flows.forEach(function (f) {
      if (f.id !== mf2.id) return;
      var seats = JSON.parse(f.seats || '[]');
      seats.push({ seat: 'house_manager', state: 'approved', by: 'Master', by_uid: 'U_BOSS' });
      f.seats = JSON.stringify(seats);
    });
    var mTwice = answer('boss', itemFor(mf2.id, 'U_TY'), 'approve');
    stAssert_(out, P + '…and never fills a second seat of a request the master already answered',
              mTwice.status === 403 && /another seat/.test(mTwice.message) &&
              flowsOf('request_off').filter(function (f) { return f.date === '2026-10-21'; })[0].state === 'waiting',
              JSON.stringify(mTwice));

    // ---- withdraw ----
    reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    act('schedulingRequestOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-20' });
    var wf = flowsOf('request_off')[0];
    var wBob = act('schedulingWithdraw', 'bob', { flow_id: wf.id });
    var wAna = act('schedulingWithdraw', 'ana', { flow_id: wf.id });
    var wAgain = act('schedulingWithdraw', 'ana', { flow_id: wf.id });
    stAssert_(out, P + 'only the requester withdraws, only while waiting; the items close',
              wBob.status === 403 && wAna.status === 200 && wAgain.status === 409 &&
              flowsOf('request_off')[0].state === 'withdrawn' &&
              itemsOf(function (i) { return i.flow_id === wf.id; }).every(function (i) { return i.state === 'closed'; }),
              JSON.stringify({ bob: wBob, again: wAgain }));

    // ---- time off ----
    reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    var tSoon = act('schedulingTimeOff', 'ana', { from: '2026-10-08', to: '2026-10-09' });
    var tBack = act('schedulingTimeOff', 'ana', { from: '2026-10-20', to: '2026-10-19' });
    var tOk = act('schedulingTimeOff', 'ana', { from: '2026-10-19', to: '2026-10-27', reason: 'vacation' });
    var tf = flowsOf('time_off')[0] || {};
    var tAns = answer('brit', itemFor(tf.id, 'U_BRIT'), 'approve');
    tf = flowsOf('time_off')[0];
    var t20 = cellAt('BM4060', 'P:' + K.ana, '2026-10-20') || {};
    var t21 = cellAt('BM4060', 'P:' + K.ana, '2026-10-21') || {};
    var tLog = JSON.parse(tf.outreach_log || '{}');
    stAssert_(out, P + 'time off: inside the notice and backwards are refused; approved, each day in a live period ' +
                   'puts the person\'s shift up as OPEN with the outreach, and the days beyond the last period wait ' +
                   'for the roll',
              tSoon.status === 409 && tBack.status === 400 && tOk.status === 200 && tAns.status === 200 &&
              tf.state === 'approved_future' && t20.text === 'R/O' && t20.state === 'time_off' && t20.base === '8A-4P' &&
              t21.state === 'time_off' && flowsOf('call_off').length === 2 &&
              (tLog.future || []).join() === '2026-10-26,2026-10-27' && (tLog.applied || []).length === 2 &&
              sent.some(function (s) { return s.reason === 'scheduling: sched_timeoff_decided' && s.to === PHONES.ana; }),
              JSON.stringify({ soon: tSoon, back: tBack, flow: tf && tf.state, log: tLog }));
    var tInfo = itemsOf(function (i) { return i.flow_id === tf.id && i.box === 'inbox'; });
    stAssert_(out, P + 'time off approved: both directors and the requester get the informative',
              tInfo.map(function (i) { return i.to_uid; }).sort().join() === 'U_ANA,U_BRIT,U_TY', JSON.stringify(tInfo));
    reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    act('schedulingTimeOff', 'ana', { from: '2026-10-20', to: '2026-10-21' });
    var tf2 = flowsOf('time_off')[0];
    var dup = act('schedulingTimeOff', 'ana', { from: '2026-10-21', to: '2026-10-22' });
    answer('ty', itemFor(tf2.id, 'U_TY'), 'approve');
    var live = flowsOf('time_off')[0];
    reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    act('schedulingTimeOff', 'ana', { from: '2026-10-20', to: '2026-10-21' });
    var tf3 = flowsOf('time_off')[0];
    sent = [];
    answer('ty', itemFor(tf3.id, 'U_TY'), 'decline');
    stAssert_(out, P + 'time off wholly inside a live period is approved outright; an overlapping ask is refused; a ' +
                   'decline changes nothing and tells the requester',
              live.state === 'approved' && dup.status === 409 && flowsOf('time_off')[0].state === 'declined' &&
              cellAt('BM4060', 'P:' + K.ana, '2026-10-20').text === '8A-4P' && toOf(sent) === 'ana' &&
              sent[0].body.indexOf('not approved') !== -1, JSON.stringify({ live: live.state, dup: dup }));

    // ---- swap: three seats in turn ----
    reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    var swBusy = act('schedulingSwapPropose', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-06', replacement: K.eve });
    var swNobody = act('schedulingSwapPropose', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-06', replacement: K.zed });
    var swMe = act('schedulingSwapPropose', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-06', replacement: K.ana });
    var sw = act('schedulingSwapPropose', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-06', replacement: K.gus });
    var swf = flowsOf('swap')[0] || {};
    var askStaff = sent.filter(function (s) { return s.reason === 'scheduling: sched_swap_ask'; });
    stAssert_(out, P + 'swap: the replacement must be free, have an account and not be you; then they alone are asked ' +
                   '(My Work + a text)',
              swBusy.status === 409 && swNobody.status === 400 && swMe.status === 400 && sw.status === 200 &&
              swf.state === 'waiting_staff' && toOf(askStaff) === 'gus' &&
              itemsOf(function (i) { return i.flow_id === swf.id; }).map(function (i) { return i.to_uid + ':' + i.seat; }).join() === 'U_GUS:staff',
              JSON.stringify({ busy: swBusy, nobody: swNobody, me: swMe, flow: swf.state, ask: askStaff.length }));
    var wrongSeat = answer('ty', itemFor(swf.id, 'U_GUS'), 'approve');
    sent = [];
    answer('gus', itemFor(swf.id, 'U_GUS'), 'approve');
    swf = flowsOf('swap')[0];
    var askHm = sent.filter(function (s) { return s.reason === 'scheduling: sched_swap_ask'; });
    stAssert_(out, P + 'swap: nobody answers another\'s seat; the replacement\'s yes asks the house manager next',
              wrongSeat.status === 403 && swf.state === 'waiting_manager' && toOf(askHm) === 'cara' &&
              !!itemFor(swf.id, 'U_CARA'), JSON.stringify({ wrong: wrongSeat, state: swf.state }));
    sent = [];
    answer('cara', itemFor(swf.id, 'U_CARA'), 'approve');
    swf = flowsOf('swap')[0];
    var askDir = sent.filter(function (s) { return s.reason === 'scheduling: sched_swap_ask'; });
    stAssert_(out, P + 'swap: the house manager\'s yes asks both directors',
              swf.state === 'waiting_director' && toOf(askDir) === 'brit,ty' && !!itemFor(swf.id, 'U_TY') &&
              !!itemFor(swf.id, 'U_BRIT'), JSON.stringify({ state: swf.state, ask: toOf(askDir) }));
    sent = [];
    answer('brit', itemFor(swf.id, 'U_BRIT'), 'approve');
    swf = flowsOf('swap')[0];
    var outCell = cellAt('BM4060', 'P:' + K.ana, '2026-10-06') || {};
    var inCell = cellAt('BM4060', 'P:' + K.gus, '2026-10-06') || {};
    var gusRow = find('sched_rows', function (r) { return r.house_code === 'BM4060' && r.row_id === 'P:' + K.gus; })[0];
    var everyone = itemsOf(function (i) { return i.flow_id === swf.id && i.seat === 'everyone'; });
    var doneTexts = sent.filter(function (s) { return s.reason === 'scheduling: sched_swap_done'; });
    stAssert_(out, P + 'swap: a director\'s yes swaps the names — the original\'s cell empties (base kept), the ' +
                   'replacement gets the shift on a row added for them — everyone is told, and both are texted',
              swf.state === 'done' && outCell.text === '' && outCell.state === 'swapped_out' && outCell.base === '8A-4P' &&
              inCell.text === '8A-4P' && inCell.state === 'swap_in' && !!gusRow && /^SR_[0-9a-f]{16}$/.test(gusRow.id) &&
              everyone.length === 1 && everyone[0].to_uid === '' && everyone[0].box === 'inbox' &&
              everyone[0].title === 'Shift swapped: BM Tue 10/6 8A-4P — Ana Smith → Gus Pak' &&
              toOf(doneTexts) === 'ana,gus' && itemFor(swf.id, 'U_TY').state === 'superseded',
              JSON.stringify({ state: swf.state, out: outCell, in: inCell, row: gusRow, all: everyone, texts: toOf(doneTexts) }));

    // the house manager is the replacement → the seat passes to the directors
    reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    act('schedulingSwapPropose', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-06', replacement: K.cara });
    var hf = flowsOf('swap')[0];
    answer('cara', itemFor(hf.id, 'U_CARA'), 'approve');
    hf = flowsOf('swap')[0];
    var hSeats = JSON.parse(hf.seats);
    stAssert_(out, P + 'swap: when the house manager is in the swap the seat is skipped with why, and the directors ' +
                   'are asked — one person never fills two seats',
              hf.state === 'waiting_director' && hSeats[1].seat === 'house_manager' && hSeats[1].state === 'skipped' &&
              !!hSeats[1].why && hSeats[2].seat === 'director' &&
              hSeats[2].to.map(function (d) { return d.uid; }).sort().join() === 'U_BRIT,U_TY',
              JSON.stringify(hSeats));

    // each decline says its own words to the original
    [['staff', 'gus', 'sched_swap_declined_staff', 'Gus Pak declined'],
     ['house_manager', 'cara', 'sched_swap_declined_manager', 'house manager declined'],
     ['director', 'ty', 'sched_swap_declined_director', 'director declined']].forEach(function (c) {
      reset();
      SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
      act('schedulingSwapPropose', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-06', replacement: K.gus });
      var df = flowsOf('swap')[0];
      if (c[0] !== 'staff') answer('gus', itemFor(df.id, 'U_GUS'), 'approve');
      if (c[0] === 'director') answer('cara', itemFor(df.id, 'U_CARA'), 'approve');
      sent = [];
      answer(c[1], itemFor(df.id, PEOPLE[c[1]].uid), 'decline');
      df = flowsOf('swap')[0];
      var t = sent.filter(function (s) { return s.reason === 'scheduling: ' + c[2]; });
      var info = itemsOf(function (i) { return i.flow_id === df.id && i.seat === 'requester'; });
      stAssert_(out, P + 'swap declined at the ' + c[0] + ' seat: the swap ends, the original is texted (' + c[2] +
                     ', with house, date and time) and alerted, and the calendar is untouched',
                df.state === 'declined' && toOf(t) === 'ana' && t[0].body.indexOf(c[3]) !== -1 &&
                t[0].body.indexOf('BM') !== -1 && t[0].body.indexOf('Tue 10/6') !== -1 && t[0].body.indexOf('8A-4P') !== -1 &&
                info.length === 1 && cellAt('BM4060', 'P:' + K.ana, '2026-10-06').text === '8A-4P',
                JSON.stringify({ state: df.state, sent: sent }));
    });

    // ---- the phone hook ----
    reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    var h1 = schedulingCallOffHeard_({ source: 'hotline', instance: 'AC1:calloff:0', employee: 'Ana Smith', name_from: 'person',
                                       call_day: '2026-10-05', shift_day: '2026-10-05' });
    var hFlow = flowsOf('call_off')[0] || {};
    var h1b = schedulingCallOffHeard_({ source: 'hotline', instance: 'AC1:calloff:0', employee: 'Ana Smith', name_from: 'person',
                                        call_day: '2026-10-05', shift_day: '2026-10-05' });
    stAssert_(out, P + 'phone: the one shift that day opens the same call-off (source hotline, the instance kept), the ' +
                   'directors are warned, the hook itself sends nothing, and a second hearing opens nothing',
              h1.ok === true && h1.state === 'opened' && hFlow.source === 'hotline' && hFlow.source_ref === 'AC1:calloff:0' &&
              cellAt('BM4060', 'P:' + K.ana, '2026-10-05').state === 'called_off' && sent.length === 0 &&
              itemsOf(function (i) { return i.flow_id === hFlow.id && i.kind === 'warning'; }).length === 2 &&
              h1b.state === 'already' && flowsOf('call_off').length === 1, JSON.stringify({ h1: h1, h1b: h1b }));
    var hNone = schedulingCallOffHeard_({ instance: 'AC2:calloff:0', employee: 'Bob Jones', name_from: 'person',
                                          call_day: '2026-10-05', shift_day: '2026-10-05' });
    var hTwo = schedulingCallOffHeard_({ instance: 'AC3:calloff:0', employee: 'Fay Ode', name_from: 'person',
                                         call_day: '2026-10-06', shift_day: '2026-10-07' });
    var hCid = schedulingCallOffHeard_({ instance: 'AC4:calloff:0', employee: 'Ana Smith', name_from: 'phone',
                                         call_day: '2026-10-05', shift_day: '2026-10-06' });
    var phones = flowsOf('phone');
    var human = itemsOf(function (i) { return /^Phone call-off needs a human — /.test(i.title); });
    stAssert_(out, P + 'phone: no shift, two shifts, or a caller-ID name → nothing opens; a needs_human flow and a ' +
                   'warning to both directors each',
              hNone.state === 'needs_human' && hTwo.state === 'needs_human' && hCid.state === 'needs_human' &&
              phones.length === 3 && phones.every(function (f) { return f.state === 'needs_human' && f.source === 'hotline'; }) &&
              human.length === 6 && human.some(function (i) { return i.title === 'Phone call-off needs a human — Bob Jones · Mon 10/5'; }) &&
              cellAt('BM4060', 'P:' + K.ana, '2026-10-06').text === '8A-4P' && flowsOf('call_off').length === 1,
              JSON.stringify({ none: hNone, two: hTwo, cid: hCid, human: human.length }));
    var keepRead = G.schedRead_;
    G.schedRead_ = function () { throw new Error('the house is down'); };
    var hDown = null, threw = false;
    try { hDown = schedulingCallOffHeard_({ instance: 'AC5:calloff:0', employee: 'Ana Smith', name_from: 'person', shift_day: '2026-10-05' }); }
    catch (eT) { threw = true; }
    G.schedRead_ = keepRead;
    lockBusy = true;
    var hBusy = schedulingCallOffHeard_({ instance: 'AC6:calloff:0', employee: 'Ana Smith', name_from: 'person',
                                          call_day: '2026-10-06', shift_day: '2026-10-06' });
    lockBusy = false;
    var owedNow = PropertiesService.getScriptProperties().getProperty(SCHED_FLOW_PHONE_OWED + 'AC6:calloff:0');
    SCHED_FLOW_NOW = '2026-10-05T14:01:00Z';
    schedulingClockTick_();
    stAssert_(out, P + 'phone: an unreadable house never throws and the hearing is kept for the clock, as a busy lock ' +
                   'is; the clock opens it on the next ring',
              !threw && hDown && hDown.ok === false && hDown.state === 'owed' && hBusy.state === 'owed' && !!owedNow &&
              !PropertiesService.getScriptProperties().getProperty(SCHED_FLOW_PHONE_OWED + 'AC6:calloff:0') &&
              flowsOf('call_off').some(function (f) { return f.source_ref === 'AC6:calloff:0'; }),
              JSON.stringify({ down: hDown, busy: hBusy }));

    // ---- the clock never extends the calendar ----
    reset();
    SCHED_FLOW_NOW = '2026-10-19T14:00:00Z';
    var looked = schedulingClockTick_();
    CacheService.getScriptCache().remove(SCHED_FLOW_DUE_KEY);
    schedulingClockTick_();
    stAssert_(out, P + 'the clock never rolls the calendar forward, even inside the old lead: the next weeks come from ' +
                   'the Builder',
              rolls.length === 0 && !(looked && looked.roll), JSON.stringify(rolls));

    // ---- the words ----
    stEq_(out, P + 'a sentence whose value is missing is left out, never shown as a gap',
          smartPruneUnfilled_(smartRender_('URGENT\nCan you at {time}? Located at {location}.\nThanks - {sender}',
                                           { time: '8am', sender: 'us' })),
          'URGENT\nCan you at 8am?\nThanks - us');
    stAssert_(out, P + 'Ohio days: midnight, 08:00 after a night, and the day words',
              schedFlowMidnightMs_('2026-10-05') === Date.parse('2026-10-05T04:00:00Z') &&
              schedFlowMidnightMs_('2026-12-05') === Date.parse('2026-12-05T05:00:00Z') &&
              schedFlowNext8_(Date.parse('2026-10-06T02:00:00Z')) === Date.parse('2026-10-06T12:00:00Z') &&
              schedFlowNext8_(Date.parse('2026-10-06T13:00:00Z')) === Date.parse('2026-10-07T12:00:00Z') &&
              schedFlowHourWord_(960) === '4pm' && schedFlowHourWord_(450) === '7:30am' &&
              schedFlowDayWords_('2026-10-05') === 'Mon 10/5', '');
    stAssert_(out, P + 'the days the clocks move: a night held to 08:00 is given back at 08:00 local, never at 07:00 or ' +
                   '09:00',
              schedFlowNext8_(Date.parse('2026-11-01T05:00:00Z')) === Date.parse('2026-11-01T13:00:00Z') &&
              schedFlowNext8_(Date.parse('2026-11-01T12:00:00Z')) === Date.parse('2026-11-01T13:00:00Z') &&
              schedFlowNext8_(Date.parse('2026-03-08T06:00:00Z')) === Date.parse('2026-03-08T12:00:00Z'),
              [schedFlowNext8_(Date.parse('2026-11-01T05:00:00Z')), schedFlowNext8_(Date.parse('2026-03-08T06:00:00Z'))]
                .map(function (m) { return new Date(m).toISOString(); }).join());

    stSchedFlowsMore_(out, P, {
      reset: reset, act: act, answer: answer, itemFor: itemFor, flowsOf: flowsOf, itemsOf: itemsOf, cellAt: cellAt,
      cellOf: cellOf, toOf: toOf, K: K, PEOPLE: PEOPLE, seeds: seeds, G: G,
      db: function () { return db; }, sent: function () { return sent; }, clearSent: function () { sent = []; },
      rolls: function () { return rolls; }, setLockBusy: function (v) { lockBusy = v; }
    });
    stSchedFlowsExchange_(out, P, {
      reset: reset, act: act, answer: answer, itemFor: itemFor, flowsOf: flowsOf, itemsOf: itemsOf, cellAt: cellAt,
      cellOf: cellOf, rowOf: rowOf, toOf: toOf, K: K, PEOPLE: PEOPLE, G: G, user: user,
      db: function () { return db; }, sent: function () { return sent; }, clearSent: function () { sent = []; }
    });
  } finally {
    STUBS.forEach(function (n) { G[n] = keep[n]; });
    try { CacheService.getScriptCache().remove(SCHED_FLOW_DUE_KEY); } catch (e1) { /* */ }
    try {
      var props = PropertiesService.getScriptProperties();
      props.deleteProperty(SCHED_FLOW_ROLL_PROP);
      ['AC5:calloff:0', 'AC6:calloff:0', 'AC9:calloff:0', 'index'].forEach(function (i) { props.deleteProperty(SCHED_FLOW_PHONE_OWED + i); });
    } catch (e2) { /* */ }
    SCHED_FLOW_NOW = keepVars.now;
    SCHED_FLOW_DUE_KEY = keepVars.due;
    SCHED_FLOW_ROLL_PROP = keepVars.roll;
    SCHED_FLOW_PHONE_OWED = keepVars.owed;
    HUB_MEMBER_CTX = keepVars.member;
    SMART_TO_KEYWORDS.allstaff.resolve = keepVars.resolve;
    SMART_TELL_LEDGERED = keepVars.told;
    if (!keepVars.sha1) delete Utilities.DigestAlgorithm.SHA_1;
  }
}

// The outreach's honesty and the clock's housekeeping, over the same stand-ins (`t` hands over stSchedulingFlows_'s…
function stSchedFlowsMore_(out, P, t) {
  var G = t.G, K = t.K;
  var keep = { house: t.seeds.sched_calloff_house, blast: SCHED_FLOW_BLAST_MAX, tries: SCHED_FLOW_PHONE_TRIES,
               setCell: G.schedSetCell_, roll: G.schedRoll_, holds: G.schedHoldsNow_, syslog: G.hubSysLog_ };
  var s1Of = function () { return t.sent().filter(function (s) { return s.reason === 'scheduling: sched_calloff_house'; }); };
  try {
    // ---- an off situation is retried, never "done"; the call-off says so ----
    t.reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    PropertiesService.getScriptProperties().setProperty(SCHED_FLOW_ROLL_PROP, '2026-10-05');
    var off = {};
    for (var k in keep.house) off[k] = keep.house[k];
    off.enabled = 'no';
    t.seeds.sched_calloff_house = off;
    var coOff = t.act('schedulingCallOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-05' });
    var fOff = t.flowsOf('call_off')[0] || {};
    var logOff = JSON.parse(fOff.outreach_log || '{}').stage1 || {};
    t.seeds.sched_calloff_house = keep.house;
    SCHED_FLOW_NOW = '2026-10-05T14:11:00Z';
    CacheService.getScriptCache().remove(SCHED_FLOW_DUE_KEY);
    schedulingClockTick_();
    var fOn = t.flowsOf('call_off')[0] || {};
    stAssert_(out, P + 'a situation that is off holds the stage open and tries again (the call-off says no text went ' +
                   'out); once it is on, stage 1 goes — it never ends "done" with nobody told',
              coOff.status === 200 && /no text went out/.test(coOff.data.said) && fOff.state === 'outreach_1' &&
              logOff.off === true && Date.parse(fOff.outreach_next_at) === Date.parse('2026-10-05T14:10:00Z') &&
              fOn.state === 'outreach_wait' && t.toOf(s1Of()) === 'bob,cara,fay',
              JSON.stringify({ said: coOff.data && coOff.data.said, off: fOff.state, log: logOff, on: fOn.state }));

    // ---- the call-off says what its texts did ----
    t.reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    var calls = 0;
    G.schedHoldsNow_ = function () { calls++; return keep.holds(); };
    var coSent = t.act('schedulingCallOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-05' });
    G.schedHoldsNow_ = keep.holds;
    stAssert_(out, P + 'the call-off says how many texts went out and who had no phone; the house\'s free people are ' +
                   'found from one read of every hold',
              coSent.status === 200 && /3 texts to the house went out; 1 person has no phone to text\./.test(coSent.data.said) &&
              calls === 1, (coSent.data && coSent.data.said) + ' / holds read ' + calls);

    // ---- one row, one shift a day: the house's own staff already working there that day are not asked ----
    t.reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    t.db().sched_cells.push(t.cellOf('BM4060', 'P:' + K.bob, '2026-10-05', '8A-4P'));
    var withName = {};
    for (var k2 in keep.house) withName[k2] = keep.house[k2];
    withName.sms_text = 'URGENT OPEN SHIFT {original} called off. The {shift} at {house} {day_word}. Take it: {link}';
    t.seeds.sched_calloff_house = withName;
    t.act('schedulingCallOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-05' });
    t.seeds.sched_calloff_house = keep.house;
    var s1 = s1Of();
    stAssert_(out, P + 'stage 1 skips a house person who already works there that day (they could not take it), and an ' +
                   'open-shift text never carries who called off — even words on the Desk that ask for {original}',
              t.toOf(s1) === 'cara,fay' && s1.length === 2 && s1.every(function (s) {
                return s.body.indexOf('Ana') === -1 && /The 4P-12A at BM today/.test(s.body);
              }), JSON.stringify(s1));

    // ---- stage 2 is capped per ring, never cut short ----
    t.reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    PropertiesService.getScriptProperties().setProperty(SCHED_FLOW_ROLL_PROP, '2026-10-05');
    SCHED_FLOW_BLAST_MAX = 1;
    t.act('schedulingCallOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-05' });
    SCHED_FLOW_NOW = '2026-10-05T14:08:00Z';
    schedulingClockTick_();
    var ring1 = t.flowsOf('call_off')[0];
    var s2a = t.sent().filter(function (s) { return s.reason === 'scheduling: sched_calloff_everyone'; }).length;
    schedulingClockTick_();
    var ring2 = t.flowsOf('call_off')[0];
    var s2 = t.sent().filter(function (s) { return s.reason === 'scheduling: sched_calloff_everyone'; });
    SCHED_FLOW_BLAST_MAX = keep.blast;
    stAssert_(out, P + 'stage 2 texts at most the cap a ring and leaves the rest for the next ring: it ends done only ' +
                   'when everyone was asked',
              s2a === 1 && ring1.state === 'outreach_2' && ring2.state === 'done' && t.toOf(s2) === 'eve,gus' &&
              (JSON.parse(ring2.outreach_log).stage2 || {}).sent === 2,
              JSON.stringify({ first: ring1.state, then: ring2.state, sent: t.toOf(s2) }));

    // ---- requests nobody answered before their day ----
    t.reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    t.act('schedulingRequestOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-20' });
    t.act('schedulingTimeOff', 'ana', { from: '2026-10-20', to: '2026-10-20' });
    t.act('schedulingRequestOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-21' });
    SCHED_FLOW_NOW = '2026-10-21T13:00:00Z';
    CacheService.getScriptCache().remove(SCHED_FLOW_DUE_KEY);
    schedulingClockTick_();
    var rqs = t.flowsOf('request_off'), tos = t.flowsOf('time_off');
    var gone = rqs.filter(function (f) { return f.date === '2026-10-20'; })[0];
    var still = rqs.filter(function (f) { return f.date === '2026-10-21'; })[0];
    stAssert_(out, P + 'the clock closes as expired a Request Off whose shift has ended and a time off whose first day ' +
                   'has passed — their items closed, the requester told — and leaves one still to come waiting',
              gone.state === 'expired' && tos[0].state === 'expired' && still.state === 'waiting' &&
              t.itemsOf(function (i) { return i.flow_id === gone.id && i.box === 'work'; }).every(function (i) { return i.state === 'closed'; }) &&
              t.itemsOf(function (i) { return i.flow_id === gone.id && i.seat === 'requester'; }).length === 1 &&
              !!t.itemFor(still.id, 'U_TY') && t.itemFor(still.id, 'U_TY').state === 'waiting',
              JSON.stringify([gone.state, tos[0].state, still.state]));

    // ---- the answer writes its decision before it marks the item ----
    t.reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    t.act('schedulingRequestOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-20' });
    var rf = t.flowsOf('request_off')[0];
    var stub = G.schedSetCell_;
    G.schedSetCell_ = function () { throw new Error('the cells house is down'); };
    var broke = t.answer('ty', t.itemFor(rf.id, 'U_TY'), 'approve');
    G.schedSetCell_ = stub;
    var afterBroke = [t.flowsOf('request_off')[0].state, t.itemFor(rf.id, 'U_TY').state, t.itemFor(rf.id, 'U_BRIT').state];
    var again = t.answer('ty', t.itemFor(rf.id, 'U_TY'), 'approve');
    stAssert_(out, P + 'a decision whose write fails leaves the request and both items waiting, so it can be answered ' +
                   'again — never an approved item over an unchanged calendar',
              broke.status === 503 && afterBroke.join() === 'waiting,waiting,waiting' && again.status === 200 &&
              t.flowsOf('request_off')[0].state === 'approved', JSON.stringify([broke, afterBroke, again.status]));

    // ---- a call-off by phone or a time off ends a waiting request on that shift ----
    t.reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    t.act('schedulingSwapPropose', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-06', replacement: K.gus });
    var heard = schedulingCallOffHeard_({ instance: 'AC9:calloff:0', employee: 'Ana Smith', name_from: 'person',
                                          call_day: '2026-10-05', shift_day: '2026-10-06' });
    var swGone = t.flowsOf('swap')[0];
    t.act('schedulingRequestOff', 'ana', { house: 'BM4060', row_id: 'P:' + K.ana, date: '2026-10-21' });
    t.act('schedulingTimeOff', 'ana', { from: '2026-10-21', to: '2026-10-21' });
    t.answer('ty', t.itemFor(t.flowsOf('time_off')[0].id, 'U_TY'), 'approve');
    var rqGone = t.flowsOf('request_off')[0];
    stAssert_(out, P + 'a phone call-off and an approved time off each expire the waiting swap or Request Off on the ' +
                   'shift they take, and close its items',
              heard.state === 'opened' && swGone.state === 'expired' && rqGone.state === 'expired' &&
              t.itemFor(swGone.id, 'U_GUS').state === 'closed' && t.itemFor(rqGone.id, 'U_BRIT').state === 'closed',
              JSON.stringify([heard.state, swGone.state, rqGone.state]));

    // ---- one row, one shift a day: take and swap ----
    t.reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    t.db().sched_cells.push(t.cellOf('BM4060', 'OPEN:1', '2026-10-06', '4P-12A', 'open'));
    var twiceTake = t.act('schedulingTake', 'ana', { house: 'BM4060', row_id: 'OPEN:1', date: '2026-10-06' });
    t.db().sched_cells.push(t.cellOf('BM4060', 'P:' + K.ana, '2026-10-07', '12A-8A'));
    var twiceSwap = t.act('schedulingSwapPropose', 'fay', { house: 'BM4060', row_id: 'P:' + K.fay, date: '2026-10-07',
                                                            replacement: K.ana });
    stAssert_(out, P + 'a take refuses somebody already working at that house that day (a handover is free, the row ' +
                   'holds one cell), and so does a swap\'s replacement; nothing changes',
              twiceTake.status === 409 && /^You already have 8A-4P at BM that day/.test(twiceTake.message) &&
              t.cellAt('BM4060', 'OPEN:1', '2026-10-06').state === 'open' &&
              t.cellAt('BM4060', 'P:' + K.ana, '2026-10-06').text === '8A-4P' &&
              twiceSwap.status === 409 && /^Ana Smith already has 12A-8A at BM that day/.test(twiceSwap.message) &&
              t.flowsOf('swap').length === 0 && t.flowsOf('take').length === 0,
              JSON.stringify([twiceTake, twiceSwap]));

    // ---- the clock says nothing of a roll ----
    t.reset();
    var logged = [];
    G.hubSysLog_ = function (a, ev, what) { logged.push(ev + ' ' + what); return true; };
    G.schedRoll_ = function () { logged.push('roll called'); return { ok: true }; };
    SCHED_FLOW_NOW = '2026-10-19T14:00:00Z';
    var tick = schedulingClockTick_();
    G.schedRoll_ = keep.roll;
    G.hubSysLog_ = keep.syslog;
    stAssert_(out, P + 'the clock never calls the roll and logs nothing of one',
              !(tick && tick.roll) && !logged.some(function (l) { return /roll/.test(l); }), JSON.stringify([tick, logged]));

    // ---- the phone hook's tries ----
    t.reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    SCHED_FLOW_PHONE_TRIES = 2;
    t.setLockBusy(true);
    var tries = [1, 2, 3].map(function () {
      return schedulingCallOffHeard_({ instance: 'AC9:calloff:0', employee: 'Ana Smith', name_from: 'person',
                                       call_day: '2026-10-05', shift_day: '2026-10-05' }).state;
    });
    t.setLockBusy(false);
    SCHED_FLOW_PHONE_TRIES = keep.tries;
    stAssert_(out, P + 'phone: a hearing the lock keeps refusing is kept for the clock a bounded number of times, then ' +
                   'dropped and said in the system log — the hook waits on the lock only briefly',
              tries.join() === 'owed,owed,dropped' &&
              !PropertiesService.getScriptProperties().getProperty(SCHED_FLOW_PHONE_OWED + 'AC9:calloff:0') &&
              stCode_(schedulingCallOffHeard_).indexOf('SCHED_FLOW_PHONE_LOCK_MS') !== -1 && SCHED_FLOW_PHONE_LOCK_MS <= 2000,
              tries.join());
  } finally {
    t.seeds.sched_calloff_house = keep.house;
    SCHED_FLOW_BLAST_MAX = keep.blast;
    SCHED_FLOW_PHONE_TRIES = keep.tries;
    G.schedSetCell_ = keep.setCell;
    G.schedRoll_ = keep.roll;
    G.schedHoldsNow_ = keep.holds;
    G.hubSysLog_ = keep.syslog;
    t.setLockBusy(false);
  }
}

// The exchange: two people's shifts change hands, at one house or two.
function stSchedFlowsExchange_(out, P, t) {
  var G = t.G, K = t.K;
  var keep = { clash: G.schedClash_, hms: G.schedHouseManagers_, gate: G.schedGate_, need: G.schedTrainingNeed_ };
  var BM = 'BM4060', FT = 'FT4801';
  var at = function (w, house, date) { return { house: house, row_id: 'P:' + K[w], date: date }; };
  var ask = function (who, a, b, extra) {
    var p = { house: a.house, row_id: a.row_id, date: a.date, partner_house: b.house, partner_row_id: b.row_id,
              partner_date: b.date };
    for (var k in (extra || {})) p[k] = extra[k];
    return t.act('schedulingSwapPropose', who, p);
  };
  var swaps = function () { return t.flowsOf('swap'); };
  var put = function (house, w, date, text, state) { t.db().sched_cells.push(t.cellOf(house, 'P:' + K[w], date, text, state)); };
  var exOf = function (f) { return (JSON.parse(f.outreach_log || '{}') || {}).exchange || null; };
  var hmItems = function (f) { return t.itemsOf(function (i) { return i.flow_id === f.id && i.seat === 'house_manager' && i.box === 'work'; }); };
  var world = function () {
    t.reset();
    SCHED_FLOW_NOW = '2026-10-05T14:00:00Z';
    PropertiesService.getScriptProperties().setProperty(SCHED_FLOW_ROLL_PROP, '2026-10-05');
  };
  try {
    G.schedClash_ = function (key, date, s, e, opts) {
      var ignore = (opts && opts.ignore_cell_ids) || [];
      var hit = null;
      t.db().sched_cells.forEach(function (c) {
        if (hit || c.row_id !== 'P:' + key || c.date !== date || ignore.indexOf(c.id) !== -1) return;
        var off = ['called_off', 'requested_off', 'time_off'].indexOf(c.state) !== -1;
        if (!off && (c.start_min === '' || !c.text || c.state === 'swapped_out')) return;
        if (off || (Number(c.start_min) < e && s < Number(c.end_min))) {
          hit = { house_code: c.house_code, date: date, text: c.text, why: off ? 'off' : 'overlap' };
        }
      });
      return hit;
    };
    G.schedHouseManagers_ = function (h) {
      if (h === BM) return [{ name: 'Cara Lee', key: K.cara, uid: 'U_CARA', email: 'cara@x' }];
      if (h === FT) return [{ name: 'Dan Ray', key: K.dan, uid: 'U_DAN', email: 'dan@x' }];
      return [];
    };

    // ---- a cross-house exchange, seat by seat ----
    world();
    var x1 = at('ana', BM, '2026-10-06'), y1 = at('eve', FT, '2026-10-06');
    var p1 = ask('ana', x1, y1);
    var f1 = swaps()[0] || {};
    var e1 = exOf(f1) || {};
    var askEve = t.sent().filter(function (s) { return s.reason === 'scheduling: sched_exchange_ask'; });
    var busy = ask('fay', at('fay', BM, '2026-10-07'), y1);
    var desk = typeof sdSchedDescription_ === 'function' ? sdSchedDescription_(f1) : '';
    stAssert_(out, P + 'exchange: Support Requests reads both shifts of it',
              /^Swap: Ana Smith ⇄ Eve Tan — .*8A-4P at BM · .*8A-4P at FT$/.test(desk), desk);
    stAssert_(out, P + 'exchange: Ana\'s BM shift for Eve\'s FT shift is asked of Eve alone (My Work + a text that ' +
                   'names both shifts); the partner shift rides in the flow\'s own JSON, and it is busy for anyone else',
              p1.status === 200 && f1.state === 'waiting_staff' && f1.person === 'Ana Smith' && f1.replacement === 'Eve Tan' &&
              e1.house === FT && e1.row_id === 'P:' + K.eve && e1.date === '2026-10-06' && e1.text === '8A-4P' &&
              t.toOf(askEve) === 'eve' && /takes Eve Tan's 8A-4P shift at FT on Tue 10\/6/.test(askEve[0].body) &&
              t.itemsOf(function (i) { return i.flow_id === f1.id; }).map(function (i) { return i.to_uid + ':' + i.seat; }).join() === 'U_EVE:staff' &&
              t.itemFor(f1.id, 'U_EVE').house_label === 'BM ⇄ FT' &&
              t.itemFor(f1.id, 'U_EVE').shift_text === 'Tue 10/6 8A-4P ⇄ Tue 10/6 8A-4P' &&
              busy.status === 409 && /already has a request waiting/.test(busy.message),
              JSON.stringify({ p1: p1.status, msg: p1.message, state: f1.state, ex: e1, busy: busy }));
    t.clearSent();
    t.answer('eve', t.itemFor(f1.id, 'U_EVE'), 'approve');
    f1 = swaps()[0];
    var hm1 = hmItems(f1);
    var seats1 = JSON.parse(f1.seats);
    stAssert_(out, P + 'exchange: Eve\'s yes asks the house manager of EACH house at once — Cara for BM, Dan for FT — ' +
                   'one seat per house',
              f1.state === 'waiting_manager' && hm1.length === 2 &&
              hm1.some(function (i) { return i.to_uid === 'U_CARA' && i.house_code === BM; }) &&
              hm1.some(function (i) { return i.to_uid === 'U_DAN' && i.house_code === FT; }) &&
              seats1.filter(function (s) { return s.seat === 'house_manager' && s.state === 'waiting'; }).length === 2,
              JSON.stringify({ state: f1.state, hm: hm1.map(function (i) { return i.to_uid + '@' + i.house_code; }), seats: seats1 }));
    var cAns = t.answer('cara', t.itemFor(f1.id, 'U_CARA'), 'approve');
    f1 = swaps()[0];
    var danWaits = t.itemFor(f1.id, 'U_DAN').state;
    t.answer('dan', t.itemFor(f1.id, 'U_DAN'), 'approve');
    f1 = swaps()[0];
    stAssert_(out, P + 'exchange: BM\'s yes leaves FT\'s seat waiting (never superseded); FT\'s yes asks the directors',
              cAns.status === 200 && /Waiting on the house manager of FT/.test(cAns.data.said) && danWaits === 'waiting' &&
              f1.state === 'waiting_director' && !!t.itemFor(f1.id, 'U_TY') && !!t.itemFor(f1.id, 'U_BRIT'),
              JSON.stringify({ said: cAns.data && cAns.data.said, dan: danWaits, state: f1.state }));
    t.clearSent();
    var dAns = t.answer('brit', t.itemFor(f1.id, 'U_BRIT'), 'approve');
    f1 = swaps()[0];
    var anaOut = t.cellAt(BM, 'P:' + K.ana, '2026-10-06') || {}, eveOut = t.cellAt(FT, 'P:' + K.eve, '2026-10-06') || {};
    var anaIn = t.cellAt(FT, 'P:' + K.ana, '2026-10-06') || {}, eveIn = t.cellAt(BM, 'P:' + K.eve, '2026-10-06') || {};
    var anaRow = t.db().sched_rows.filter(function (r) { return r.house_code === FT && r.row_id === 'P:' + K.ana; })[0];
    var all1 = t.itemsOf(function (i) { return i.flow_id === f1.id && i.seat === 'everyone'; });
    var done1 = t.sent().filter(function (s) { return s.reason === 'scheduling: sched_exchange_done'; });
    stAssert_(out, P + 'exchange: a director\'s yes swaps both shifts — each old cell empties as swapped_out with its ' +
                   'base kept, each lands as swap_in (a row added at the new house), everyone is told both shifts, both are texted',
              dAns.status === 200 && f1.state === 'done' &&
              anaOut.text === '' && anaOut.state === 'swapped_out' && anaOut.base === '8A-4P' &&
              eveOut.text === '' && eveOut.state === 'swapped_out' && eveOut.base === '8A-4P' &&
              anaIn.text === '8A-4P' && anaIn.state === 'swap_in' && eveIn.text === '8A-4P' && eveIn.state === 'swap_in' &&
              !!anaRow && all1.length === 1 &&
              all1[0].title === 'Shifts swapped: Ana Smith ⇄ Eve Tan — BM Tue 10/6 8A-4P · FT Tue 10/6 8A-4P' &&
              t.toOf(done1) === 'ana,eve' && t.itemFor(f1.id, 'U_TY').state === 'superseded',
              JSON.stringify({ said: dAns.data && dAns.data.said, state: f1.state, anaOut: anaOut.state, anaIn: anaIn.state,
                               eveIn: eveIn.state, all: all1.map(function (i) { return i.title; }), texts: t.toOf(done1) }));
    var roll1 = schedRollPlan_({ id: 'P2026-09-28', first: '2026-09-28', last: '2026-10-25' },
                               { id: 'P2026-10-26', first: '2026-10-26', last: '2026-11-22' },
                               t.db().sched_cells, t.db().sched_rows, t.db().sched_flows, {}, 'T', 'test');
    var rolled = function (plan, house, w, date) {
      var hit = plan.cells.filter(function (c) { return c.house_code === house && c.row_id === 'P:' + K[w] && c.date === date; })[0];
      return hit ? hit.text : '';
    };
    stAssert_(out, P + 'exchange: the roll gives each shift back to its first holder — Ana BM, Eve FT — and drops ' +
                   'the swapped-in copies',
              rolled(roll1, BM, 'ana', '2026-11-03') === '8A-4P' && rolled(roll1, FT, 'eve', '2026-11-03') === '8A-4P' &&
              rolled(roll1, FT, 'ana', '2026-11-03') === '' && rolled(roll1, BM, 'eve', '2026-11-03') === '',
              JSON.stringify([rolled(roll1, BM, 'ana', '2026-11-03'), rolled(roll1, FT, 'eve', '2026-11-03'),
                              rolled(roll1, FT, 'ana', '2026-11-03'), rolled(roll1, BM, 'eve', '2026-11-03')]));

    // ---- one house, the same day: the two cells trade their shifts ----
    world();
    put(BM, 'bob', '2026-10-06', '4P-12A');
    var p2 = ask('ana', at('ana', BM, '2026-10-06'), at('bob', BM, '2026-10-06'));
    var f2 = swaps()[0] || {};
    t.answer('bob', t.itemFor(f2.id, 'U_BOB'), 'approve');
    f2 = swaps()[0];
    var oneSeat = JSON.parse(f2.seats).filter(function (s) { return s.seat === 'house_manager'; });
    t.answer('cara', t.itemFor(f2.id, 'U_CARA'), 'approve');
    t.answer('ty', t.itemFor(f2.id, 'U_TY'), 'approve');
    f2 = swaps()[0];
    var ana2 = t.cellAt(BM, 'P:' + K.ana, '2026-10-06') || {}, bob2 = t.cellAt(BM, 'P:' + K.bob, '2026-10-06') || {};
    var roll2 = schedRollPlan_({ id: 'P2026-09-28', first: '2026-09-28', last: '2026-10-25' },
                               { id: 'P2026-10-26', first: '2026-10-26', last: '2026-11-22' },
                               t.db().sched_cells, t.db().sched_rows, t.db().sched_flows, {}, 'T', 'test');
    stAssert_(out, P + 'exchange at one house the same day: one house-manager seat; Ana\'s cell becomes 4P-12A and ' +
                   'Bob\'s 8A-4P (swap_in, each keeping its own base), and the roll gives each back their own',
              p2.status === 200 && oneSeat.length === 1 && oneSeat[0].house === BM && f2.state === 'done' &&
              ana2.text === '4P-12A' && ana2.state === 'swap_in' && ana2.base === '8A-4P' &&
              bob2.text === '8A-4P' && bob2.state === 'swap_in' && bob2.base === '4P-12A' &&
              rolled(roll2, BM, 'ana', '2026-11-03') === '8A-4P' && rolled(roll2, BM, 'bob', '2026-11-03') === '4P-12A',
              JSON.stringify({ p2: p2.status, msg: p2.message, seats: oneSeat, state: f2.state, ana: ana2, bob: bob2 }));

    // ---- one house, two days ----
    world();
    put(BM, 'bob', '2026-10-07', '8A-4P');
    ask('ana', at('ana', BM, '2026-10-06'), at('bob', BM, '2026-10-07'));
    var f3 = swaps()[0] || {};
    t.answer('bob', t.itemFor(f3.id, 'U_BOB'), 'approve');
    t.answer('cara', t.itemFor(f3.id, 'U_CARA'), 'approve');
    t.answer('brit', t.itemFor(f3.id, 'U_BRIT'), 'approve');
    f3 = swaps()[0];
    stAssert_(out, P + 'exchange at one house on two days: Ana works Bob\'s Wednesday and Bob Ana\'s Tuesday',
              f3.state === 'done' && t.cellAt(BM, 'P:' + K.ana, '2026-10-07').text === '8A-4P' &&
              t.cellAt(BM, 'P:' + K.bob, '2026-10-06').text === '8A-4P' &&
              t.cellAt(BM, 'P:' + K.ana, '2026-10-06').state === 'swapped_out' &&
              t.cellAt(BM, 'P:' + K.bob, '2026-10-07').state === 'swapped_out', f3.state);

    // ---- every refusal ----
    world();
    put(FT, 'eve', '2026-10-08', 'OFF');
    put(FT, 'eve', '2026-10-09', '8A-4P', 'training');
    t.db().sched_flows.push({ id: 'SFTRAINING01', kind: 'training', state: 'waiting', house_code: FT, row_id: 'P:' + K.eve,
                              date: '2026-10-09', person_key: K.eve, outreach_log: '{}' });
    put(BM, 'bob', '2026-10-20', '4P-12A');
    put(FT, 'eve', '2026-10-07', '8A-4P');
    put(BM, 'ana', '2026-10-07', 'C/O', 'called_off');
    var r = {
      same: ask('ana', at('ana', BM, '2026-10-06'), at('ana', BM, '2026-10-05')),
      open: ask('ana', at('ana', BM, '2026-10-06'), { house: BM, row_id: 'OPEN:1', date: '2026-10-06' }),
      nobody: ask('ana', at('ana', BM, '2026-10-06'), at('zed', BM, '2026-10-06')),
      untimed: ask('ana', at('ana', BM, '2026-10-06'), at('eve', FT, '2026-10-08')),
      training: ask('ana', at('ana', BM, '2026-10-06'), at('eve', FT, '2026-10-09')),
      aBusy: ask('ana', at('ana', BM, '2026-10-06'), at('eve', FT, '2026-10-05')),
      bBusy: ask('fay', at('fay', BM, '2026-10-07'), at('eve', FT, '2026-10-06')),
      off: ask('ana', at('ana', BM, '2026-10-06'), at('fay', FT, '2026-10-07')),
      twice: ask('ana', at('ana', BM, '2026-10-06'), at('bob', BM, '2026-10-20')),
      notMine: ask('bob', at('ana', BM, '2026-10-06'), at('eve', FT, '2026-10-06'))
    };
    SCHED_FLOW_NOW = '2026-10-05T21:00:00Z';
    r.started = ask('ana', at('ana', BM, '2026-10-05'), at('eve', FT, '2026-10-06'));
    var why = function (k) { return r[k].status + ' ' + (r[k].message || ''); };
    stAssert_(out, P + 'exchange refusals, each in its own sentence: the same person, an OPEN row, no account, no ' +
                   'timed shift, a training still waiting, A or B not free for the other\'s shift, off that day, a second ' +
                   'shift at one house, somebody else\'s shift, already started — and nothing is filed',
              r.same.status === 400 && /same person/.test(r.same.message) &&
              r.open.status === 400 && /never an OPEN/.test(r.open.message) &&
              r.nobody.status === 400 && /platform account/.test(r.nobody.message) &&
              r.untimed.status === 400 && /has no timed shift at FT on Thu 10\/8/.test(r.untimed.message) &&
              r.training.status === 409 && /FT Fri 10\/9 8A-4P is waiting on a training approval/.test(r.training.message) &&
              r.aBusy.status === 409 && /^Not possible: Ana Smith is already at BM 4P-12A that day/.test(r.aBusy.message) &&
              r.bBusy.status === 409 && /^Not possible: Eve Tan is already at FT 8A-4P that day/.test(r.bBusy.message) &&
              r.off.status === 409 && /Ana Smith/.test(r.off.message) &&
              r.twice.status === 409 && /^Ana Smith already has 8A-4P at BM that day/.test(r.twice.message) &&
              r.notMine.status === 403 &&
              r.started.status === 409 && /has already started/.test(r.started.message) && swaps().length === 0,
              Object.keys(r).map(function (k) { return k + ': ' + why(k); }).join(' | '));

    // ---- seats: the partner and the proposer never sit; a house with no house manager passes ----
    world();
    G.schedHouseManagers_ = function (h) {
      if (h === BM) return [{ name: 'Cara Lee', key: K.cara, uid: 'U_CARA', email: 'cara@x' }];
      if (h === FT) return [{ name: 'Eve Tan', key: K.eve, uid: 'U_EVE', email: 'eve@x' }];
      return [];
    };
    G.schedGate_ = function (u) {
      var g = keep.gate(u);
      if (g && g.open && g.uid === 'U_TY') g.is_master = true;
      return g;
    };
    var pm = ask('ty', at('ana', BM, '2026-10-06'), at('eve', FT, '2026-10-06'));
    var fm = swaps()[0] || {};
    t.answer('eve', t.itemFor(fm.id, 'U_EVE'), 'approve');
    fm = swaps()[0];
    var sm = JSON.parse(fm.seats);
    var ftSeat = sm.filter(function (s) { return s.seat === 'house_manager' && s.house === FT; })[0] || {};
    t.answer('cara', t.itemFor(fm.id, 'U_CARA'), 'approve');
    fm = swaps()[0];
    stAssert_(out, P + 'exchange seats: the master swaps anybody\'s shift; FT\'s only house manager is the partner, so ' +
                   'that seat passes to the directors with why; the director seat never asks the proposer — Brittany alone',
              pm.status === 200 && fm.created_by === 'U_TY' && ftSeat.state === 'skipped' && /FT has no house manager/.test(ftSeat.why) &&
              fm.state === 'waiting_director' && !!t.itemFor(fm.id, 'U_BRIT') && !t.itemFor(fm.id, 'U_TY'),
              JSON.stringify({ pm: pm.status, msg: pm.message, seats: sm, state: fm.state }));
    G.schedGate_ = keep.gate;
    G.schedHouseManagers_ = function (h) {
      if (h === BM) return [{ name: 'Cara Lee', key: K.cara, uid: 'U_CARA', email: 'cara@x' }];
      if (h === FT) return [{ name: 'Dan Ray', key: K.dan, uid: 'U_DAN', email: 'dan@x' }];
      return [];
    };

    // ---- a decline at one house's seat ends it for both houses ----
    world();
    ask('ana', at('ana', BM, '2026-10-06'), at('eve', FT, '2026-10-06'));
    var fd = swaps()[0] || {};
    t.answer('eve', t.itemFor(fd.id, 'U_EVE'), 'approve');
    t.clearSent();
    t.answer('dan', t.itemFor(fd.id, 'U_DAN'), 'decline', 'short that day');
    fd = swaps()[0];
    var dt = t.sent().filter(function (s) { return s.reason === 'scheduling: sched_swap_declined_manager'; });
    var told = t.itemsOf(function (i) { return i.flow_id === fd.id && i.seat === 'requester'; });
    stAssert_(out, P + 'exchange declined by FT\'s house manager: it ends, BM\'s waiting item closes, Ana is texted ' +
                   '(the declined words) and told, and neither calendar moves',
              fd.state === 'declined' && t.itemFor(fd.id, 'U_CARA').state === 'closed' && t.toOf(dt) === 'ana' &&
              told.length === 1 && /The house manager of FT declined/.test(told[0].body) &&
              t.cellAt(BM, 'P:' + K.ana, '2026-10-06').text === '8A-4P' && t.cellAt(FT, 'P:' + K.eve, '2026-10-06').text === '8A-4P',
              JSON.stringify({ state: fd.state, cara: t.itemFor(fd.id, 'U_CARA').state, texts: t.toOf(dt), told: told.length }));

    // ---- the last seat checks everything again ----
    world();
    ask('ana', at('ana', BM, '2026-10-06'), at('eve', FT, '2026-10-06'));
    var fc = swaps()[0] || {};
    t.answer('eve', t.itemFor(fc.id, 'U_EVE'), 'approve');
    t.answer('cara', t.itemFor(fc.id, 'U_CARA'), 'approve');
    t.answer('dan', t.itemFor(fc.id, 'U_DAN'), 'approve');
    t.db().sched_cells.push(t.cellOf('XX0001', 'P:' + K.ana, '2026-10-06', '8A-4P'));
    var late = t.answer('ty', t.itemFor(fc.id, 'U_TY'), 'approve');
    fc = swaps()[0];
    var lateTold = t.itemsOf(function (i) { return i.flow_id === fc.id && /^Swap could not finish/.test(i.title); });
    stAssert_(out, P + 'exchange: a clash that appears before the director answers stops it at the last seat — ' +
                   'expired, nothing moves, both people told why',
              late.status === 200 && /could not finish: Not possible: Ana Smith is already at XX0001 8A-4P that day/.test(late.data.said) &&
              fc.state === 'expired' && lateTold.length === 2 &&
              t.cellAt(BM, 'P:' + K.ana, '2026-10-06').text === '8A-4P' && !t.cellAt(FT, 'P:' + K.ana, '2026-10-06'),
              JSON.stringify({ said: late.data && late.data.said, state: fc.state, told: lateTold.length }));

    // ---- a newcomer without the house's IST: a warning, then a training ----
    world();
    G.schedTrainingNeed_ = function (house, key) {
      return house === FT && key === K.ana ? { has: false, state: 'missing', why: 'no IST for FT on file' } : null;
    };
    var pt = ask('ana', at('ana', BM, '2026-10-06'), at('eve', FT, '2026-10-06'));
    var ft = swaps()[0] || {};
    t.answer('eve', t.itemFor(ft.id, 'U_EVE'), 'approve');
    t.answer('cara', t.itemFor(ft.id, 'U_CARA'), 'approve');
    t.answer('dan', t.itemFor(ft.id, 'U_DAN'), 'approve');
    var tAns = t.answer('ty', t.itemFor(ft.id, 'U_TY'), 'approve');
    G.schedTrainingNeed_ = keep.need;
    var anaFt = t.cellAt(FT, 'P:' + K.ana, '2026-10-06') || {};
    var tr = t.flowsOf('training')[0] || {};
    stAssert_(out, P + 'exchange: a newcomer without the house\'s IST is warned of, never refused — the swap is asked, ' +
                   'and at the end Ana works FT as a training (its own flow, both seats) while Eve takes BM outright',
              pt.status === 200 && /has no IST at FT/.test(pt.data.said) && swaps()[0].state === 'done' &&
              anaFt.state === 'training' && tr.source === 'swap' && tr.source_ref === ft.id && tr.state === 'waiting' &&
              t.cellAt(BM, 'P:' + K.eve, '2026-10-06').state === 'swap_in' && !!(tAns.data && tAns.data.training),
              JSON.stringify({ said: pt.data && pt.data.said, cell: anaFt.state, training: tr.state }));

    // ---- the partner gives their shift up while it waits: the asker is told it ended ----
    world();
    ask('ana', at('ana', BM, '2026-10-06'), at('eve', FT, '2026-10-06'));
    var fg = swaps()[0] || {};
    var gone = t.act('schedulingCallOff', 'eve', { house: FT, row_id: 'P:' + K.eve, date: '2026-10-06' });
    fg = swaps()[0] || {};
    var ended = t.itemsOf(function (i) { return i.flow_id === fg.id && /^Swap ended — /.test(i.title); });
    stAssert_(out, P + 'exchange: the partner calling off their shift ends it, its items close, and the asker alone is ' +
                   'told it ended — without who gave the shift up or why',
              gone.status === 200 && fg.state === 'expired' && t.itemFor(fg.id, 'U_EVE').state === 'closed' &&
              ended.length === 1 && ended[0].to_uid === 'U_ANA' && /Your shift is still yours/.test(ended[0].body) &&
              ended[0].body.indexOf('Eve') === -1,
              JSON.stringify({ call: gone.status, msg: gone.message, state: fg.state, ended: ended }));

    // ---- nobody answered before a shift began ----
    world();
    ask('ana', at('ana', BM, '2026-10-06'), at('eve', FT, '2026-10-06'));
    SCHED_FLOW_NOW = '2026-10-06T12:30:00Z';
    PropertiesService.getScriptProperties().setProperty(SCHED_FLOW_ROLL_PROP, '2026-10-06');
    CacheService.getScriptCache().remove(SCHED_FLOW_DUE_KEY);
    schedulingClockTick_();
    var fe = swaps()[0] || {};
    stAssert_(out, P + 'exchange: once either shift has begun the clock closes it as expired and its items close',
              fe.state === 'expired' && t.itemFor(fe.id, 'U_EVE').state === 'closed', fe.state);
  } finally {
    G.schedClash_ = keep.clash;
    G.schedHouseManagers_ = keep.hms;
    G.schedGate_ = keep.gate;
    G.schedTrainingNeed_ = keep.need;
  }
}
