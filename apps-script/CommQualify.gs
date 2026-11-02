// Communication never closes a business condition: a reply is evidence to check, never a verdict.

var COMM_QUALIFY_VERDICTS = ['agrees', 'disagrees', 'unknown'];

// `current` is re-read now, never the planned copy; a claim the record contradicts is a disagreement.
function commQualifyOne_(binding, claim, current) {
  var said = String((claim && claim.kind) || 'unclear');
  var now = String((current && current.state) || '');

  if (!now) {
    return { verdict: 'unknown', settle: false,
             why: 'the obligations matrix holds nothing for this item right now' };
  }
  if (now === 'ok' || now === 'na') {
    return { verdict: 'agrees', settle: true,
             why: 'the estate holds it as ' + now + ' — the claim and the record agree' };
  }
  if (said === 'declined') {
    return { verdict: 'agrees', settle: false,
             why: 'they said it is not done, and the record says the same' };
  }
  return { verdict: 'disagrees', settle: false,
           why: 'they said it is handled; the estate still reads ' + now +
                ' — worth a look, not a settlement' };
}

var COMM_CONTRIBUTIONS_HOUSE = 'comm_contributions';
var COMM_CONTRIBUTION_STATES = ['awaiting_owner', 'needs_human', 'settled', 'dismissed', 'stopped'];
var COMM_CONTRIBUTION_VERDICTS = ['settled', 'not_settled', 'dismissed'];

var COMM_CONTRIBUTION_TERMINAL_STATES = ['settled', 'dismissed', 'stopped'];
var COMM_CONTRIBUTION_OPEN_STATES = ['awaiting_owner', 'needs_human'];

var COMM_CONTRIBUTION_CLOSERS = ['machine', 'person', 'silence'];

// The whole list of reasons a row may close without a person; a closing power must stay enumerable.
var COMM_CONTRIBUTION_SILENT_CLOSES = ['acknowledged', 'already-owed', 'already-told',
                                       'test-rehearsal', 'silence'];

function commContributionRow_(m, who, corr, contribution, qualified, state, reason, nowIso) {
  var intent = (corr && corr.intent) || {};
  return {
    id: 'CMC_' + commRecordId_(String(m.message_id || '')),
    intent_key: String(intent.intent_key || ''),
    person_key: String((who && who.key) || intent.person_key || ''),
    person_name: String((who && who.name) || intent.person_name || ''),
    channel: String(m.channel || ''),
    message_id: String(m.message_id || ''),
    thread_id: String(m.thread_id || ''),
    received_at: String(m.at || nowIso || ''),
    text: String(m.text || '').slice(0, 2000),
    correlation: String((corr && corr.how) || ''),
    kind: String((contribution && contribution.kind) || ''),
    claims: ((contribution && contribution.claims) || []).map(function (b) { return String(b.demand_id || b.req_id || ''); }).join(' · '),
    why: String((contribution && contribution.why) || (corr && corr.why) || ''),
    settled_now: '', awaiting: '',
    state: String(state || 'needs_human'),
    reason: String(reason || ''),
    verdict: '', verdict_by: '', verdict_at: '', note: '',
    // `yes` marks a rehearsal: the same stamp comm_intents and comm_attempts carry.
    test_mode: '',
    // repair_incident is the same mark the notice-now and ride-along paths take, so nobody is apologised to twice.
    correction_kind: '', repair_incident: '',
    close: '', closed_at: '',
    // A mark, not a clock: an unanswered row never times out into silence.
    escalated_at: ''
  };
}

function commContributionOpen_(row) {
  return COMM_CONTRIBUTION_OPEN_STATES.indexOf(String((row && row.state) || '')) !== -1;
}

// Refuses unknown states, closers and unlisted reasons, so no caller can invent a quiet ending.
function commContributionClose_(id, state, by, reason, why, nowIso, extra) {
  var rowId = String(id || '');
  if (!rowId) return false;
  if (COMM_CONTRIBUTION_TERMINAL_STATES.indexOf(String(state)) === -1) return false;
  if (COMM_CONTRIBUTION_CLOSERS.indexOf(String(by)) === -1) return false;
  if (String(by) !== 'person' && COMM_CONTRIBUTION_SILENT_CLOSES.indexOf(String(reason)) === -1) return false;
  var row = { id: rowId, state: String(state), reason: String(reason || ''),
              close: String(by), closed_at: String(nowIso || new Date().toISOString()),
              note: String(why || '').slice(0, 500) };
  Object.keys(extra || {}).forEach(function (k) { row[k] = extra[k]; });
  return commContributionSave_(row);
}

function commContributionExists_(messageId) {
  var id = 'CMC_' + commRecordId_(String(messageId || ''));
  try {
    var sheet = hubTabSheet_(COMM_CONTRIBUTIONS_HOUSE);
    return !!(sheet && findRowIndex_(sheet, id));
  } catch (e) { return false; }
}

function commContributionSave_(row) {
  try { commRecordUpsert_(COMM_CONTRIBUTIONS_HOUSE, row); return true; } catch (e) { return false; }
}

/** The owner's word: an admin, director or manager settles, refuses or dismisses what a reply proposed. */
HUB_POLICY.commContributionVerdict = {
  file: 'CommQualify.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager'],
  params: { id: { required: true, type: 'string' }, verdict: { required: true, type: 'string' }, note: { type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.commContributionVerdict = function (payload, user) {
  if (!user || ['admin', 'director', 'manager'].indexOf(String(user.role)) === -1) return hubDenied_();
  var id = str_(payload && payload.id), verdict = str_(payload && payload.verdict);
  if (!id || COMM_CONTRIBUTION_VERDICTS.indexOf(verdict) === -1) {
    return { status: 400, message: 'A contribution id and a verdict (settled · not_settled · dismissed) are required.' };
  }
  var row = null;
  try { commBoardRows_(COMM_CONTRIBUTIONS_HOUSE).forEach(function (r) { if (String(r.id) === id) row = r; }); } catch (e) {}
  if (!row) return { status: 404, message: 'No such contribution.' };
  var nowIso = new Date().toISOString();
  var by = str_(user.email);
  var intent = { intent_key: String(row.intent_key || ''), person_key: String(row.person_key || ''), person_name: String(row.person_name || '') };
  var closed = [];
  if (verdict === 'settled') {
    var demands = String(row.awaiting || '').split(' · ').concat(String(row.claims || '').split(' · '))
      .map(function (d) { return d.trim(); }).filter(function (d, i, a) { return d && a.indexOf(d) === i; });
    var bindings = [];
    try { bindings = commBoardRows_(COMM_BINDINGS_HOUSE).filter(function (b) { return String(b.intent_key) === intent.intent_key; }); } catch (e2) {}
    bindings.forEach(function (b) {
      if (demands.indexOf(String(b.demand_id)) === -1) return;
      if (String(b.binding_state || 'open') === 'settled') return;
      try { commRecordUpsert_(COMM_BINDINGS_HOUSE, { id: b.id, binding_state: 'settled', qualified_by: by, qualified_at: nowIso,
                                                     note: str_(payload && payload.note) || 'settled by the demand\'s owner' }); closed.push(String(b.demand_id)); } catch (e3) {}
    });
    var stillOpen = bindings.filter(function (b) {
      return String(b.binding_state || 'open') === 'open' && closed.indexOf(String(b.demand_id)) === -1;
    }).length;
    var intentRow = null;
    try { commBoardRows_(COMM_INTENTS_HOUSE).forEach(function (r) { if (String(r.intent_key) === intent.intent_key && String(r.state) !== 'superseded') intentRow = r; }); } catch (e4) {}
    if (intentRow && !stillOpen) { try { commRecordUpsert_(COMM_INTENTS_HOUSE, { id: intentRow.id, state: 'answered' }); } catch (e5) {} }
    commObserve_('settled', intent, { demands: closed, by: by, contribution: id }, 'desk', by);
  } else {
    commObserve_(verdict === 'dismissed' ? 'dismissed' : 'contribution', intent, { verdict: verdict, by: by, contribution: id }, 'desk', by);
  }
  // not_settled leaves the row open on purpose; the endings are stamped as a person's close, never the machine's.
  var ended = (verdict === 'settled' || verdict === 'dismissed');
  commContributionSave_({ id: id, state: verdict === 'settled' ? 'settled' : (verdict === 'dismissed' ? 'dismissed' : 'awaiting_owner'),
                          verdict: verdict, verdict_by: by, verdict_at: nowIso, note: str_(payload && payload.note),
                          close: ended ? 'person' : '', closed_at: ended ? nowIso : '' });
  return { status: 200, data: { id: id, verdict: verdict, settled: closed } };
};

/** What waits for a person: contributions awaiting the owner or needing a human. */
HUB_POLICY.commReplies = {
  file: 'CommQualify.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.commReplies = function (payload, user) {
  if (!user || ['admin', 'director', 'manager'].indexOf(String(user.role)) === -1) return hubDenied_();
  var rows = [];
  try { rows = commBoardRows_(COMM_CONTRIBUTIONS_HOUSE); } catch (e) { rows = []; }
  var all = !!(payload && payload.all);
  var out = rows.filter(function (r) { return all || commContributionOpen_(r); });
  out.sort(function (a, b) { return String(b.received_at || '').localeCompare(String(a.received_at || '')); });
  // Silent closes are counted beside the open rows, so the closing power stays visible.
  var closedAlone = rows.filter(function (r) {
    return String(r.close || '') === 'machine' &&
           COMM_CONTRIBUTION_SILENT_CLOSES.indexOf(String(r.reason || '')) !== -1;
  }).length;
  return { status: 200, data: { rows: out.slice(0, 500),
    open: rows.filter(commContributionOpen_).length,
    closed_by_the_machine: closedAlone, total: rows.length } };
};

function commQualify_(intent, contribution, lookup) {
  var claims = (contribution && contribution.claims) || [];
  var open = ((intent && intent.bindings) || []).filter(function (b) {
    return String(b.binding_state || 'open') === 'open';
  });
  var claimed = {};
  claims.forEach(function (c) { claimed[String(c.demand_id || c.req_id)] = 1; });

  var results = claims.map(function (b) {
    var id = String(b.demand_id || b.req_id);
    var current = lookup ? lookup(id) : null;
    var got = commQualifyOne_(b, contribution, current);
    return {
      demand_id: id, req_id: String(b.req_id || ''),
      claimed: String((contribution && contribution.kind) || ''),
      verdict: got.verdict, settle: got.settle, why: got.why
    };
  });

  var untouched = open.filter(function (b) {
    return !claimed[String(b.demand_id || b.req_id)];
  }).map(function (b) { return String(b.demand_id || b.req_id); });

  return {
    results: results,
    settled: results.filter(function (r) { return r.settle; }).length,
    disagreements: results.filter(function (r) { return r.verdict === 'disagrees'; }).length,
    // Returned so a caller never treats a partly answered intent as done.
    untouched: untouched,
    all_answered: untouched.length === 0 && results.length > 0
  };
}
