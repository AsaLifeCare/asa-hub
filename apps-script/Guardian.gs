// ------------------------------------------------------------------ GUARDIAN — the platform's health, answered by…
// This is the BACK END of that screen — the checks the platform runs against itself.

var GUARDIAN_ROLES = ['admin'];

function guardianDenied_() {
  return { status: 403, message: 'Requires an admin account' };
}

/** One check's verdict: ok | warn | fail | unknown — never absent. */
function guardianCheck_(id, label, state, detail, meta) {
  return { id: id, label: label, state: state, detail: detail || '', meta: meta || {} };
}

// THE LOG, READ ONCE, ASKED TWO QUESTIONS.
function guardianLogScan_(limit, watch) {
  var names = watch || [];
  var heard = {}, wanted = 0;
  for (var w = 0; w < names.length; w++) { heard[names[w]] = null; wanted++; }
  var blind = { state: 'unknown', rows: [], heard: heard, known: false, scanned: 0,
                since: '', complete: false };
  try {
    var sheet = logsSheet_();
    if (!sheet) { blind.detail = 'no log sheet'; return blind; }
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) {
      blind.detail = 'the log holds no rows — it can report no failure and prove no pass';
      return blind;
    }
    var hdr = values[0].map(function (h) { return String(h).trim(); });
    var iAt = hdr.indexOf('timestamp'), iAction = hdr.indexOf('action');
    var iActor = hdr.indexOf('actor_name'), iOk = hdr.indexOf('ok');
    var iSummary = hdr.indexOf('summary'), iArea = hdr.indexOf('area');
    var iDetail = hdr.indexOf('detail');
    // ALL THREE, GATED TOGETHER.
    if (iOk === -1 || iAction === -1 || iAt === -1) {
      blind.detail = 'the log has no "' + (iOk === -1 ? 'ok' : iAction === -1 ? 'action' : 'timestamp') +
                     '" column — nothing here can be counted, and none is not the answer';
      return blind;
    }

    var out = [], found = 0, scanned = 0, since = '', r;
    // Newest first.
    for (r = values.length - 1; r >= 1 && (out.length < limit || found < wanted); r--) {
      var row = values[r];
      scanned++;
      since = str_(row[iAt]);
      var action = str_(row[iAction]);
      if (wanted && (action in heard) && heard[action] === null) {
        heard[action] = {
          at: str_(row[iAt]),
          ok: str_(row[iOk]).toLowerCase() !== 'false',
          said: iDetail !== -1 ? str_(row[iDetail]).slice(0, 160) : ''
        };
        found++;
      }
      if (str_(row[iOk]).toLowerCase() === 'false' && out.length < limit) {
        out.push({
          timestamp: str_(row[iAt]),
          action: action,
          actor: iActor !== -1 ? str_(row[iActor]) : '',
          summary: iSummary !== -1 ? str_(row[iSummary]) : '',
          area: iArea !== -1 ? str_(row[iArea]) : ''
        });
      }
    }
    return {
      state: out.length ? 'warn' : 'ok',
      rows: out,
      detail: out.length + ' recent',
      heard: heard,
      known: true,
      scanned: scanned,
      // The oldest row the walk reached.
      since: since,
      // AND WHETHER IT REACHED THE END.
      complete: r < 1
    };
  } catch (e) {
    blind.detail = String(e && e.message || e);
    return blind;
  }
}

// The sheets this platform lives on still answer a read.
function guardianSheets_() {
  var tabs = [
    { tab: 'users', book: 'HUB_DB_ID' },
    { tab: 'hub_sessions', book: 'HUB_DB_ID' },
    { tab: 'system_logs', book: 'HUB_LOGS_ID' }
  ];
  var problems = [];
  for (var i = 0; i < tabs.length; i++) {
    try {
      var sh = ssOpen_(hubId_(tabs[i].book)).getSheetByName(tabs[i].tab);
      if (!sh) { problems.push(tabs[i].tab + ' missing from ' + tabs[i].book); continue; }
      sh.getRange(1, 1).getValue();   // one cell — the cheapest possible read
    } catch (e) {
      problems.push(tabs[i].tab + ': ' + String(e && e.message || e));
    }
  }
  return {
    state: problems.length ? 'fail' : 'ok',
    detail: problems.length ? problems.join('; ') : tabs.length + ' core tabs answering'
  };
}

/** The write-ledger's depth — a queue that only grows is a write failing. */
function guardianLedger_() {
  try {
    var sheet = ssOpen_(hubId_('HUB_DB_ID')).getSheetByName('write_ledger');
    if (!sheet) return { state: 'unknown', detail: 'no ledger tab' };
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return { state: 'ok', detail: 'empty', pending: 0, dead: 0 };
    var hdr = values[0].map(function (h) { return String(h).trim(); });
    var iStatus = hdr.indexOf('status');
    // NO STATUS COLUMN, NO COUNT.
    if (iStatus === -1) {
      return { state: 'unknown', pending: null, dead: null,
               detail: 'the write ledger has no "status" column — the queue could not be counted' };
    }
    var pending = 0, dead = 0;
    for (var r = 1; r < values.length; r++) {
      var s = str_(values[r][iStatus]).toLowerCase();
      if (s === 'pending' || s === 'held') pending++;
      if (s === 'dead') dead++;
    }
    return {
      state: dead > 0 ? 'fail' : pending > 10 ? 'warn' : 'ok',
      detail: pending + ' pending, ' + dead + ' dead',
      pending: pending, dead: dead
    };
  } catch (e) {
    return { state: 'unknown', detail: String(e && e.message || e) };
  }
}

/** The cortex relay link — a HEAD through the relay's own /health. */
function guardianRelay_() {
  try {
    var res = UrlFetchApp.fetch('https://asamylife.asalifecare.com/health', {
      method: 'get', muteHttpExceptions: true, followRedirects: false
    });
    var code = res.getResponseCode();
    return {
      state: code === 200 ? 'ok' : code === 401 || code === 403 ? 'ok' : 'warn',
      detail: 'HTTP ' + code,
      code: code
    };
  } catch (e) {
    return { state: 'fail', detail: String(e && e.message || e) };
  }
}

// The Guardian's own summary — one call, the whole picture.
function guardianProperties_() {
  try {
    var file = {}, store = {};
    try { file = hubPropsFile_() || {}; } catch (eF) { file = {}; }
    try { store = hubPropsStore_() || {}; } catch (eS) { store = {}; }

    var emptyConfig = [], lostRuntime = [], saltGone = false;
    var every = (typeof scriptPropEveryKey_ === 'function') ? scriptPropEveryKey_() : [];
    for (var i = 0; i < every.length; i++) {
      var k = every[i];
      var v = hubProp_(k);
      if (v) continue;
      if (k === 'HUB_PII_SALT') { saltGone = true; continue; }
      if (scriptPropIsRuntime_(k)) { lostRuntime.push(k); continue; }
      emptyConfig.push(k);
    }

    var counts = Object.keys(file).length + ' in Props.gs, ' +
                 Object.keys(store).length + ' left in the store';
    if (saltGone || emptyConfig.length) {
      var why = [];
      if (saltGone) why.push('HUB_PII_SALT is gone — a new one orphans every fingerprint');
      if (emptyConfig.length) why.push(emptyConfig.length + ' read as empty: ' + emptyConfig.join(', '));
      return { state: 'fail', detail: why.join('; '), counts: counts,
               empty: emptyConfig, lost: lostRuntime };
    }
    if (lostRuntime.length) {
      return { state: 'warn', counts: counts,
               detail: lostRuntime.length + ' the code will write again on next use: ' +
                       lostRuntime.join(', '),
               empty: [], lost: lostRuntime };
    }
    return { state: 'ok', detail: counts, counts: counts, empty: [], lost: [] };
  } catch (e) {
    return { state: 'unknown', detail: 'the properties could not be read: ' +
             String((e && e.message) || e), counts: '', empty: [], lost: [] };
  }
}

// ▶ DOES EVERY ID IN THE PROPERTIES STILL OPEN?
HUB_POLICY.guardianIds = {
  file: 'Guardian.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'], invalidates: [], emits: []
};
HUB_ACTIONS.guardianIds = function (payload, user) {
  if (!user || GUARDIAN_ROLES.indexOf(String(user.role)) === -1) return guardianDenied_();

  var started = new Date().getTime();
  var BUDGET_MS = 40 * 1000;

  // Every property whose value LOOKS like a Drive id, from wherever it is read — the file first, the store second…
  var names = (typeof scriptPropEveryKey_ === 'function') ? scriptPropEveryKey_() : [];
  var ok = [], failed = [], skipped = [], truncated = false;

  for (var i = 0; i < names.length; i++) {
    var key = names[i];
    if (!/(_ID|_ROOT|_FOLDER|FOLDER_ID|ROOT_ID)$/.test(key)) continue;
    var id = String(hubProp_(key) || '');
    if (!id) { skipped.push({ key: key, why: 'not set' }); continue; }

    if (new Date().getTime() - started > BUDGET_MS) { truncated = true; break; }

    var name = '', kind = '';
    try {
      var file = DriveApp.getFileById(id);
      name = file.getName();
      kind = (String(file.getMimeType()).indexOf('spreadsheet') !== -1) ? 'spreadsheet' : 'file';
      if (file.isTrashed()) { failed.push({ key: key, id: id, why: 'in the trash: ' + name }); continue; }
    } catch (eFile) {
      try {
        var folder = DriveApp.getFolderById(id);
        name = folder.getName();
        kind = 'folder';
        if (folder.isTrashed()) { failed.push({ key: key, id: id, why: 'in the trash: ' + name }); continue; }
      } catch (eFolder) {
        failed.push({ key: key, id: id,
                      why: String((eFolder && eFolder.message) || eFolder).slice(0, 140) });
        continue;
      }
    }
    ok.push({ key: key, kind: kind, name: name });
  }

  return { status: 200, data: {
    ok: ok, failed: failed, skipped: skipped, truncated: truncated,
    checked: ok.length + failed.length,
    state: failed.length ? 'fail' : (truncated ? 'unknown' : 'ok'),
    detail: failed.length
      ? failed.length + ' id(s) did not open: ' +
        failed.map(function (f) { return f.key; }).join(', ')
      : (ok.length + ' id(s) open' + (truncated ? ' — ran out of time before the rest' : '')),
    at: new Date().toISOString()
  } };
};

// ------------------------------------------------------------------ THE ENGINES, ASKED WHEN THEY LAST MOVED…
var GUARDIAN_ENGINE_STALL_MS = 30 * 60 * 1000;   // a judge this quiet is not idle-gated, it is stopped

// WHICH DECLARED SWEEPS NO CLOCK CALLS.
var GUARDIAN_RELAY_CLOCK_ACTIONS = [
  'staffAttendanceSweep', 'hotlineSweep', 'talentPipelineSync',
  // the phone-call lane's GAS half, rung on the same bell as the hotline — reads the transcripts inbox and…
  'commCallsSweep',
  'hiringSweep', 'staffPerfRecompute', 'snapshotBundleBuild',
  // the file digester's bell, rung by the relay's housekeeping lane every few minutes (_digest_bell — Digest.gs)
  'digestSweep',
  // the platform's contact list, handed over on the hourly tick (_staff_sweep_loop, tick % 6 — ContactsSync.gs)
  'peopleSyncFromPlatform',
  // the behaviour signals, measured from the logs mirror and filed on the same hourly tick (_behavior_handoff…
  'behaviorSignalsIngest',
  // what the graph knows about reaching somebody, handed over on the same hourly tick (_comm_routes_handoff…
  'commRoutesIngest',
  // the obligations sweep, rung on the same hourly tick (_comm_record_tick — CommRecord.gs)
  'commRecordSweep',
  // the mailbox ear, rung on the same tick behind its own fifteen-minute window (_comm_replies_tick…
  'commRepliesSweep',
  // the repair pass, rung on the hourly tick BEFORE commRecordSweep — the order is the point (_comm_repair_tick…
  'commRepairSweep',
  // the punch record, carried over on the hourly tick in capped passes — it speaks when the stored copy or the…
  'psiPunchesIngest',
  // every field of the same punches, client data included, into the full punch house: rung right after each…
  'psiPunchesFullIngest',
  // when somebody can be reached, handed over on the same hourly tick right after the punches (_comm_when_tick…
  'commWhenIngest',
  // what the phone lines carried, live half: the calls that landed since the last pass, read into facts while the…
  'commCallsIngest'
];
// ONCE A DAY, counted in ticks rather than read off a clock so a restart across the chosen hour cannot skip the day…
var GUARDIAN_RELAY_DAILY_ACTIONS = ['commProposalsIngest'];
var GUARDIAN_RELAY_EVENT_ACTIONS = ['quoIngest',
  // the gather, rung on demand after a lane mints a house (GatherDatabase.gs)
  'gatherDatabaseMove',
  // the relay's text inbox, handed over once a minute at most and ONLY while kept texts wait (_quo_handoff_loop…
  'quoIngestBatch',
  // rule 13: rung when a shift is five minutes off or a check found somebody missing (_psi_reminders_post →…
  'staffShiftReminder',
  'openShiftCovered',                 // a call-off open shift filled
  'recruitBookIngest', 'recruitTell', // the recruit book changed, or a text fell due
  'commMockWebIngest',                // held web notices waiting on the relay disk
  'callOffFromCalendar',              // a call-off marked on Calendar Builder
  'houseMedsIngest',                  // a pharmacy report committed
  'supportDeskPunch'];                // the punch board's faults changed
// ON A CLOCK, AND NOT YET EXPECTED TO SPEAK — a NARROWING of the list above, never a fourth list competing with it.
var GUARDIAN_RELAY_DORMANT_ACTIONS = [
  // THE PUNCH DOOR, WAITING ON AN ACCOUNT.
  'staffAttendancePunch'
];

function guardianCallerlessSweeps_() {
  var declared = (typeof SERVICE_SWEEP_ACTIONS !== 'undefined') ? SERVICE_SWEEP_ACTIONS : [];
  var out = [];
  for (var i = 0; i < declared.length; i++) {
    var a = declared[i];
    if (GUARDIAN_RELAY_CLOCK_ACTIONS.indexOf(a) === -1 &&
        GUARDIAN_RELAY_DAILY_ACTIONS.indexOf(a) === -1 &&
        GUARDIAN_RELAY_EVENT_ACTIONS.indexOf(a) === -1 &&
        GUARDIAN_RELAY_DORMANT_ACTIONS.indexOf(a) === -1) {
      out.push(a);
    }
  }
  return out;
}

// ------------------------------------------------------------------ THE CALL LANE, ASKED WHAT ITS SILENCE MEANS…
var GUARDIAN_CALL_LANE_ACTION = 'commCallsIngest';
// THE COMPANION ROW.
var GUARDIAN_CALL_LANE_MOVED = 'comm_calls_ingested';

function guardianCallLane_(scan) {
  var action = GUARDIAN_CALL_LANE_ACTION;
  var knows = !!(scan && scan.known);
  var heard = (scan && scan.heard) ? (scan.heard[action] || null) : null;
  var moved = (scan && scan.heard) ? (scan.heard[GUARDIAN_CALL_LANE_MOVED] || null) : null;
  var since = (scan && scan.since) || '';
  var complete = !!(scan && scan.complete);

  // WHAT LANDED, COUNTED WITHOUT READING A CELL.
  var tab = (typeof COMM_CALLS_TAB !== 'undefined') ? COMM_CALLS_TAB : 'comm_calls';
  var itemsTab = (typeof COMM_WORK_ITEMS_TAB !== 'undefined') ? COMM_WORK_ITEMS_TAB : 'comm_work_items';
  var landed = null, houseWhy = '';

  function houseRows_(name, count) {
    try {
      var id = (typeof houseIdFor_ === 'function') ? String(houseIdFor_(name) || '') : '';
      if (!id) return { why: 'the ' + name + ' house is not declared' };
      if (!count) return {};                 // declared is all this one has to prove
      var book = ssOpen_(id);
      // Either name, the old one first — a data house wears `Data` once it has been given the matrix shape, and…
      var sh = book.getSheetByName(name) ||
               book.getSheetByName(typeof HOUSE_DATA_TAB !== 'undefined' ? HOUSE_DATA_TAB : 'Data');
      if (!sh) return { why: 'the ' + name + ' pointer resolves, but neither tab is in that book' };
      return { rows: Math.max(0, sh.getLastRow() - 1) };
    } catch (eHouse) {
      return { why: 'the ' + name + ' house did not open: ' +
                    String((eHouse && eHouse.message) || eHouse).slice(0, 120) };
    }
  }

  var calls = houseRows_(tab, true);
  var matters = houseRows_(itemsTab, false);
  if (calls.why || matters.why) {
    houseWhy = [calls.why, matters.why].filter(function (w) { return !!w; }).join('; ');
    // THE 503 EXPLANATION BELONGS ONLY TO THE THING THAT CAUSES A 503.
    if ((calls.why || '').indexOf('not declared') !== -1 ||
        (matters.why || '').indexOf('not declared') !== -1) {
      houseWhy += ' — the hand-over answers 503 until both are declared, and nothing can land';
    }
  } else {
    landed = calls.rows;
  }

  function ageOf_(row) {
    if (!row || !row.at) return null;
    var at = new Date(row.at).getTime();
    return isFinite(at) ? Math.max(0, Date.now() - at) : null;
  }
  var ageMs = ageOf_(heard);
  var movedAgeMs = ageOf_(moved);
  var mins = ageMs === null ? null : Math.round(ageMs / 60000);
  var windowSaid = since ? ('the ' + (scan.scanned || 0) + ' log row(s) back to ' + since) : 'the log';
  // THE WALK'S OWN ANSWER ABOUT ITS OWN REACH.
  var reachSaid = complete
    ? windowSaid + ', which is every row the log holds'
    : windowSaid + ', and the walk stopped there rather than at the log\'s first row';

  // A SENTENCE SAID IN EVERY BRANCH THAT MEETS SILENCE, because silence here has two readings and this book cannot…
  var bothWays = 'a hand-over is logged only when the relay has something to send, so this ' +
                 'is what a healthy idle lane looks like AND what a dead relay looks like; ' +
                 'the ledger\'s parked count is the number that would tell them apart';

  var state, detail;
  if (!knows) {
    // The witness itself could not be read. Not "it never ran" — not known.
    state = 'unknown';
    detail = 'whether this lane has ever run is not known: ' + ((scan && scan.detail) || 'the log could not be read');
  } else if (heard && heard.ok === false) {
    // THE ONE THING THIS CHECK CAN PROVE IS WRONG. A logged failure.
    state = 'warn';
    detail = 'the last hand-over failed ' + mins + ' min ago' + (heard.said ? ': ' + heard.said : '');
  } else if (ageMs !== null && landed === null) {
    state = 'warn';
    detail = 'the door opened ' + mins + ' min ago, but ' + houseWhy;
  } else if (ageMs !== null) {
    state = 'ok';
    // IT ANSWERED — AND SEPARATELY, DID IT TAKE ANYTHING.
    detail = 'the door opened ' + mins + ' min ago; ' + landed + ' call row(s) in the house';
    if (movedAgeMs === null) {
      detail += ' — no logged pass of this lane has moved a row' +
                (complete ? ' in the whole log' : ' in ' + windowSaid);
    } else if (movedAgeMs > ageMs) {
      detail += ' — but the last time rows actually MOVED was ' +
                Math.round(movedAgeMs / 60000) + ' min ago' +
                (moved.said ? ': ' + moved.said : '') +
                '. A 200 is not a landing; the door reports what it refused.';
    } else if (moved.said) {
      detail += ' · ' + moved.said;
    }
  } else if (landed === null) {
    state = 'unknown';
    detail = 'no ' + action + ' row in ' + reachSaid + ', and ' + houseWhy;
  } else if (landed > 0) {
    state = 'unknown';
    detail = landed + ' call row(s) in the house and no ' + action + ' row in ' + reachSaid +
             ' — ' + bothWays;
  } else {
    state = 'unknown';
    detail = 'no ' + action + ' row in ' + reachSaid + ', and the house holds no rows: ' +
             'nothing has ever been handed over here, or nothing has ever been read to hand — ' +
             bothWays;
  }

  return {
    state: state, detail: detail,
    action: action,
    heardAt: heard ? heard.at : null,   // null = no hand-over in the window, NOT "no pass"
    heardOk: heard ? heard.ok : null,
    movedAt: moved ? moved.at : null,   // when rows last actually changed in the house
    ageMs: ageMs,
    landed: landed,                     // null = the house could not be counted
    since: since,                       // how far back the walk actually looked
    complete: complete,                 // whether it reached the log's first row
    scanned: (scan && scan.scanned) || 0
  };
}

function guardianEngines_() {
  var defs = [
    { name: 'hiring', cursorProp: 'HIRING_JUDGE_CURSOR' },
    { name: 'flow', cursorProp: 'FLOW_JUDGE_CURSOR' },
    { name: 'runtime', cursorProp: 'RUNTIME_JUDGE_CURSOR' }
  ];
  var now = Date.now();
  var out = { callerless: guardianCallerlessSweeps_() };
  for (var i = 0; i < defs.length; i++) {
    var d = defs[i];
    var cursor = null;
    try {
      var raw = String(hubProp_(d.cursorProp) || '');
      if (raw !== '') cursor = parseInt(raw, 10) || 0;
    } catch (eC) { cursor = null; }
    // The idleness mark is the cursor's only clock: written just BEFORE the pass that advances the cursor, as…
    var mark = null, ageMs = null;
    try {
      var parts = String(hubProp_('ENGINE_MARK_' + d.name.toUpperCase()) || '').split('|');
      var at = parseInt(parts[1], 10);
      if (isFinite(at)) {
        mark = { facts: parseInt(parts[0], 10) || 0, at: new Date(at).toISOString() };
        ageMs = Math.max(0, now - at);
      }
    } catch (eM) { mark = null; }
    out[d.name] = {
      cursor: cursor,              // where the last pass stopped; null = never written
      cursorAgeMs: ageMs,          // null = the engine never said when it last judged
      mark: mark,
      state: ageMs === null ? 'unknown' : (ageMs > GUARDIAN_ENGINE_STALL_MS ? 'warn' : 'ok')
    };
  }
  return out;
}

HUB_POLICY.guardianStatus = {
  file: 'Guardian.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'], invalidates: [], emits: []
};
HUB_ACTIONS.guardianStatus = function (payload, user) {
  if (!user || GUARDIAN_ROLES.indexOf(String(user.role)) === -1) return guardianDenied_();

  var sheets = guardianSheets_();
  var ledger = guardianLedger_();
  var relay = guardianRelay_();
  // ONE LOG READ, TWO ANSWERS — the newest failures, and when each watched door last opened.
  var failures = guardianLogScan_(20, [GUARDIAN_CALL_LANE_ACTION, GUARDIAN_CALL_LANE_MOVED]);
  var callLane = guardianCallLane_(failures);
  var props = guardianProperties_();

  // The self-test is a BUTTON, not a side effect — running 6,000 assertions on every screen load would spend the…
  var checks = [
    guardianCheck_('sheets', 'Core sheets', sheets.state, sheets.detail),
    guardianCheck_('ledger', 'Write ledger', ledger.state, ledger.detail,
                   { pending: ledger.pending, dead: ledger.dead }),
    guardianCheck_('relay', 'Relay link', relay.state, relay.detail,
                   { code: relay.code }),
    guardianCheck_('log', 'Recent failures', failures.state, failures.detail,
                   { count: failures.rows.length }),
    // THE CALL LANE, AND WHICH ZERO IT IS.
    guardianCheck_('callLane', 'Call hand-over', callLane.state, callLane.detail,
                   { action: callLane.action, heardAt: callLane.heardAt,
                     heardOk: callLane.heardOk, movedAt: callLane.movedAt,
                     ageMs: callLane.ageMs,
                     landed: callLane.landed, since: callLane.since,
                     complete: callLane.complete, scanned: callLane.scanned }),
    guardianCheck_('properties', 'Properties', props.state, props.detail,
                   { counts: props.counts, empty: props.empty, lost: props.lost })
  ];

  var worst = 'ok';
  for (var i = 0; i < checks.length; i++) {
    var s = checks[i].state;
    if (s === 'fail') worst = 'fail';
    else if (s === 'warn' && worst !== 'fail') worst = 'warn';
    else if (s === 'unknown' && worst === 'ok') worst = 'unknown';
  }

  return {
    status: 200,
    data: {
      overall: worst,
      checks: checks,
      engines: guardianEngines_(),
      // The relay lanes the Guardian can say something measured about, keyed by action.
      relayLanes: (function () { var m = {}; m[callLane.action] = callLane; return m; })(),
      recentFailures: failures.rows,
      at: new Date().toISOString()
    }
  };
};

// ------------------------------------------------------------------ THE GUARDIAN SPEAKS — the Smart Comms subject…
var GUARDIAN_EXPIRED_FLOOR = 10;      // expired obligations that justify a page
var GUARDIAN_STALE_HOURS = 26;        // a matrix older than this means the loop broke

function guardianSmartSubjects_() {
  var issues = [];
  try {
    // 1. The write ledger's dead letters (the Guardian's own check, reused).
    var ledger = guardianLedger_();
    if (ledger.state === 'unknown') {
      // A ledger that could not be counted is not a ledger with no dead letters in it.
      issues.push('the write ledger could not be counted: ' + ledger.detail);
    } else if (ledger.dead > 0) {
      issues.push(ledger.dead + ' dead write(s) in the ledger');
    }

    // 1b.
    var lane = guardianCallLane_(guardianLogScan_(1, [GUARDIAN_CALL_LANE_ACTION,
                                                      GUARDIAN_CALL_LANE_MOVED]));
    if (lane.state === 'warn') issues.push('call hand-over: ' + lane.detail);

    // 2. The matrix: how many expired, and whether it is still breathing.
    var ss = ssOpen_(hubId_('HUB_DB_ID'));
    var sheet = ss.getSheetByName('requirement_states');
    if (!sheet || sheet.getLastRow() < 2) {
      issues.push('the requirement matrix is empty (never rebuilt)');
    } else {
      var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues();
      var expired = 0, newest = 0;
      for (var r = 0; r < values.length; r++) {
        if (str_(values[r][3]) === 'expired') expired++;
        var comp = new Date(str_(values[r][8])).getTime();
        if (!isNaN(comp) && comp > newest) newest = comp;
      }
      if (expired > GUARDIAN_EXPIRED_FLOOR) {
        issues.push(expired + ' expired requirements in the matrix');
      }
      var ageH = newest ? (Date.now() - newest) / 3600000 : 999;
      if (ageH > GUARDIAN_STALE_HOURS) {
        issues.push('the matrix has not rebuilt in ' + Math.round(ageH) + 'h');
      }
    }
  } catch (e) {
    issues.push('guardian checks failed: ' + String((e && e.message) || e).slice(0, 120));
  }

  if (!issues.length) return [];
  return [{
    id: 'guardian',
    instance: new Date().toISOString().slice(0, 10),   // once a day, by the day
    issues: issues.join('; ')
  }];
}
