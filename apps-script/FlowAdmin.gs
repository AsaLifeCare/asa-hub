// Hiring cadences: how many times each step asks and how long it waits between asks.

// The numbers freeze into the ask row at its first send; flowCadenceRearm carries a change onto asks in flight.
var FLOW_CADENCE_STEPS = [
  { id: 'ask', retry: 'pass', action: 'hiringAskSend' },
  { id: 'shortlist', retry: 'pass', action: 'hiringShortlistSend' },
  { id: 'outreach', retry: 'pass', action: 'hiringOutreachSend' },
  { id: 'screen_call', retry: 'pass', action: 'hiringScreenCallSend' },
  { id: 'resume_request', retry: 'pass', action: 'hiringResumeRequestSend' },
  { id: 'cjis_request', retry: 'pass', action: 'hiringCjisRequestSend' },
  { id: 'manual_contact', retry: 'pass', action: 'manualContactSend' },
  { id: 'invite', retry: 'pass', action: 'interviewInviteSend' },
  { id: 'referral_relay', retry: 'own', action: 'referralRelaySweepMaybe_' },
  { id: 'manual_adder', retry: 'own', action: 'manualAdderSweepMaybe_' },
  { id: 'director_docs', retry: 'own', action: 'directorDocsSweepMaybe_' },
  { id: 'ready_parked', retry: 'own', action: '' },
  { id: 'ready_ask', retry: 'once', action: '' }
];

// Words live in the book's Steps tab: cadence.<id>.label, cadence.<id>.asks, cadence.retry.<kind>.
function flowCadenceWords_() {
  return (typeof bookKv_ === 'function') ? bookKv_('Steps') : {};
}

// Resolve as simCfgVal_ does: a blank step cell takes the shipped default BEFORE the global cell.
function flowCadenceSource_(cfg, perKey, allKey) {
  var per = str_(cfg[perKey]);
  if (per) return { from: 'step', key: perKey, value: per };
  var perDefault = '';
  for (var i = 0; i < HIRING_SIM_CFG_DEFAULTS.length; i++) {
    if (HIRING_SIM_CFG_DEFAULTS[i].key === perKey) {
      perDefault = str_(HIRING_SIM_CFG_DEFAULTS[i].value) || simTextDefault_(perKey);
      break;
    }
  }
  if (perDefault) return { from: 'shipped', key: perKey, value: perDefault };
  var all = str_(cfg[allKey]);
  if (all) return { from: 'global', key: allKey, value: all };
  return { from: 'shipped', key: allKey, value: '' };
}

function flowCadences_() {
  var cfg = {};
  try { cfg = (typeof hiringSimCfg_ === 'function') ? hiringSimCfg_() : {}; } catch (eC) { cfg = {}; }

  // An unreadable book is not an empty one.
  var open = {}, bookOk = true;
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), HIRING_SIM_ASKS_TAB).forEach(function (r) {
      if (str_(r.state) !== 'open') return;
      var s = str_(r.step);
      if (!open[s]) open[s] = [];
      open[s].push({ max: parseInt(str_(r.maxattempts), 10) || 0,
                     mins: parseInt(str_(r.intervalminutes), 10) || 0,
                     sent: parseInt(str_(r.sentcount), 10) || 0 });
    });
  } catch (eB) {
    bookOk = false;
    hubSysLog_('asa-hub:flow-admin', 'cadence_book_unreadable',
               String((eB && eB.message) || eB), { status: 500 });
  }

  var words = flowCadenceWords_();
  var rows = FLOW_CADENCE_STEPS.map(function (s) {
    var force = simAttemptsFor_(s.id);
    var rowsOpen = open[s.id] || [];
    var drift = 0;
    rowsOpen.forEach(function (o) {
      if (o.max !== force.attempts || o.mins !== force.minutes) drift++;
    });
    return {
      id: s.id,
      label: str_(words['cadence.' + s.id + '.label']),
      asks: str_(words['cadence.' + s.id + '.asks']),
      retry: s.retry,
      retry_words: str_(words['cadence.retry.' + s.retry]),
      action: s.action,
      attempts: force.attempts, minutes: force.minutes,
      attempts_source: flowCadenceSource_(cfg, 'sim_attempts_' + s.id, 'sim_attempts'),
      minutes_source: flowCadenceSource_(cfg, 'sim_retry_minutes_' + s.id, 'sim_retry_minutes'),
      attempts_key: 'sim_attempts_' + s.id,
      minutes_key: 'sim_retry_minutes_' + s.id,
      open: rowsOpen.length,
      drifting: drift
    };
  });

  return {
    rows: rows,
    book_readable: bookOk,
    global_attempts: parseInt(str_(cfg.sim_attempts), 10) || 1,
    global_minutes: parseInt(str_(cfg.sim_retry_minutes), 10) || 30,
    floor_minutes: 5, cap_attempts: 50
  };
}

function flowCadencesRoute_(action, payload, user) {
  if (!user || (!user.is_service && !hubIsWriter_(user))) {
    return { status: 403, message: 'The asking rhythm is for the hiring team.' };
  }
  if (action !== 'list' && action !== 'get') {
    return { status: 405, message: 'Cadence cells are edited through Settings.' };
  }
  return { status: 200, data: flowCadences_() };
}

/** Carry the current cadence numbers onto the asks already in flight for one step. */
HUB_POLICY.flowCadenceRearm = {
  file: 'FlowAdmin.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  params: { step: { required: true, type: 'string' } },
  invalidates: ['hiringCadences'],
  emits: []
};
HUB_ACTIONS.flowCadenceRearm = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var step = str_(payload.step).trim();
  var known = false;
  FLOW_CADENCE_STEPS.forEach(function (s) { if (s.id === step) known = true; });
  if (!known) {
    return { status: 400, message: 'There is no asking step "' + step + '". They are ' +
             FLOW_CADENCE_STEPS.map(function (s) { return s.id; }).join(', ') + '.' };
  }
  var force = simAttemptsFor_(step);
  var sheet, values, hdr;
  try {
    sheet = simAskSheet_();
    values = sheet.getDataRange().getValues();
    hdr = values[0].map(normKey_);
  } catch (e) {
    return { status: 500, message: 'The ask book could not be opened: ' +
             String((e && e.message) || e) };
  }
  var iStep = hdr.indexOf('step'), iState = hdr.indexOf('state');
  var iMax = hdr.indexOf('maxattempts'), iMins = hdr.indexOf('intervalminutes');
  if (iStep === -1 || iState === -1 || iMax === -1 || iMins === -1) {
    return { status: 500, message: 'The ask book is missing a column this needs.' };
  }
  var touched = 0;
  for (var r = 1; r < values.length; r++) {
    if (str_(values[r][iStep]) !== step) continue;
    if (str_(values[r][iState]) !== 'open') continue;
    var curMax = parseInt(str_(values[r][iMax]), 10) || 0;
    var curMin = parseInt(str_(values[r][iMins]), 10) || 0;
    if (curMax === force.attempts && curMin === force.minutes) continue;
    sheet.getRange(r + 1, iMax + 1).setValue(String(force.attempts));
    sheet.getRange(r + 1, iMins + 1).setValue(String(force.minutes));
    touched++;
  }
  hubSysLog_(str_(user && user.email), 'flow_cadence_rearm',
             step + ' — ' + touched + ' open ask(s) now run on ' +
             force.attempts + '×' + force.minutes + 'min', { status: 200 });
  return { status: 200, data: { step: step, rearmed: touched,
                                attempts: force.attempts, minutes: force.minutes } };
};

