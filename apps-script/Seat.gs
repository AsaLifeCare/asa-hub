// A finished visit must clear the seat link (the record stays), or the next person inherits it.

var SEAT_FLOWS = {
  onboarding: {
    tab: 'onboarding_packet',
    // A seat is an account, never a role: a role can be handed to anyone.
    seat_accounts: ['onboarding@asalifecare.com'],
    seat_email: 'HubEmail',
    seat_id: 'HubCandidateId',
    label: 'FullName',
    label_fallback: 'CandidateName',
    finished: 'CompletedAt',
    released_at: 'ReleasedAt',
    released_by: 'ReleasedBy',
    // Survives the seat clearing so the graduation sweep can still join a walk-up.
    durable_id: 'GradCandidateId'
  },

  interview: null
};

function seatIsSeatAccount_(user) {
  var mail = String((user && user.email) || '').trim().toLowerCase();
  if (!mail) return false;
  for (var name in SEAT_FLOWS) {
    if (!SEAT_FLOWS.hasOwnProperty(name)) continue;
    var flow = SEAT_FLOWS[name];
    var list = (flow && flow.seat_accounts) || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i]).trim().toLowerCase() === mail) return true;
    }
  }
  return false;
}

var SEAT_COMPLETE_HOOKS = {
  onboarding: function (info, user) {
    // Reuse the release's resolution so the move matches the id already stamped.
    var who = info.resolved || seatResolveCandidate_(info);
    if (!who.id) return { moved: false, reason: who.reason };
    var cid = who.id;

    var packet = { state: 'unknown' };
    try { packet = packetState_(cid) || packet; } catch (ePk) { }
    if (packet.state !== 'signed' && packet.state !== 'waived') {
      var until = packetHoldStart_(cid, info.name, packet.state, user);
      return { moved: false, held: true, hold_until: until, candidate_id: cid,
               stage: 'onboarding', packet_state: packet.state,
               reason: 'the signed New Hire packet is not on file yet' };
    }

    var moved = hubSetStatus_(cid, HUB_STAGE_TO_STATUS.hired, user);
    if (moved) {
      packetHoldClear_(cid, user);
      hubBustTalentCache_();
    }
    return { moved: moved, candidate_id: cid, stage: 'hired', packet_state: packet.state,
             reason: moved ? '' : 'candidate ' + cid + ' is not on the board' };
  }
};

// The seat id is the account's, so the typed name decides; the bound id counts only if its name matches.
function seatResolveCandidate_(info) {
  var typed = str_(info.name);
  var bound = str_(info.candidate_id);

  var byName = typed ? seatFindCandidateId_(typed) : '';
  if (byName) {
    if (bound && bound !== byName) {
      hubSysLog_('seat', 'seat_identity_mismatch',
        typed + ' → ' + byName + ' by name, but the seat was bound to ' + bound +
        ' — the name wins', { status: 200 });
    }
    return { id: byName, how: 'name' };
  }

  if (!bound) {
    return { id: '', reason: 'no pipeline record matches "' + (typed || 'this person') + '"' };
  }

  var cand = null;
  try { cand = hubEvidence_(bound).cand; } catch (e) { cand = null; }
  var boundName = cand ? str_(cand.candidatename) : '';
  if (typed && boundName && nameScore_(typed, boundName) < NAME_MATCH_MIN) {
    hubSysLog_('seat', 'seat_identity_refused',
      'the seat was bound to ' + bound + ' (' + boundName + ') but ' + typed +
      ' finished the onboarding — nothing was moved', { status: 409 });
    return { id: '', reason: 'the record linked to this screen belongs to ' + boundName +
             ', not to ' + typed + ' — a recruiter has to link the right one' };
  }
  return { id: bound, how: 'seat' };
}

function seatFindCandidateId_(name) {
  if (!nameNorm_(name)) return '';
  var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB)
    .filter(function (c) {
      return str_(c.candidateid) && str_(c.archived).toLowerCase() !== 'true';
    });
  var best = nameBest_(name, rows, function (c) { return str_(c.candidatename); });
  return best.ok ? str_(best.item.candidateid) : '';
}

// Only our seat columns: CandidateEmail is the person's own address.
function seatHeldRows_(flow, sheet, values, hdr, user) {
  var iEmail = hdr.indexOf(flow.seat_email);
  var iId = hdr.indexOf(flow.seat_id);
  var mail = String((user && user.email) || '').trim().toLowerCase();
  var cid = String((user && user.candidate_id) || '').trim();
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var byMail = iEmail !== -1 && mail && String(values[r][iEmail] == null ? '' : values[r][iEmail]).trim().toLowerCase() === mail;
    var byId = iId !== -1 && cid && String(values[r][iId] == null ? '' : values[r][iId]).trim() === cid;
    if (byMail || byId) out.push(r + 1);
  }
  return out;
}

/** End the visit: stamp it finished only when completed, then clear the seat link. */
HUB_POLICY.seatRelease = {
  file: 'Seat.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: ['candidates', 'onboarding'], emits: []
};
HUB_ACTIONS.seatRelease = function (payload, user) {
  if (!user) return hubDenied_();
  var name = str_(payload.flow);
  if (!SEAT_FLOWS.hasOwnProperty(name)) {
    return { status: 400, message: 'Unknown seat flow: "' + name + '".' };
  }
  var flow = SEAT_FLOWS[name];
  if (!flow) return { status: 200, data: { released: 0, people: [], server_side: false } };

  // Never hubTabEnsure_: a release must not create the tab it releases from.
  var sheet = hubTabSheet_(flow.tab);
  if (!sheet) return { status: 404, message: 'The ' + flow.tab + ' tab is missing.' };
  var ensureCols = [flow.finished, flow.released_at, flow.released_by];
  if (flow.durable_id) ensureCols.push(flow.durable_id);
  ensureHeader_(sheet, ensureCols);

  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var rows = seatHeldRows_(flow, sheet, values, hdr, user);
  if (!rows.length) return { status: 200, data: { released: 0, people: [], server_side: true } };

  var now = new Date().toISOString();
  var who = String((user && user.email) || '');
  var people = [];
  var followed = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var cell = function (col, v) {
      var c = hdr.indexOf(col);
      if (c !== -1) sheet.getRange(row, c + 1).setValue(v);
    };
    var read = function (col) {
      var c = hdr.indexOf(col);
      return c === -1 ? '' : String(values[row - 1][c] == null ? '' : values[row - 1][c]).trim();
    };

    var info = {
      name: read(flow.label) || read(flow.label_fallback) || '',
      candidate_id: read(flow.seat_id)
    };

    // Resolved once, with no fallback to the seat id: a wrongly stamped row is worse than none.
    info.resolved = { id: '', reason: 'the seat was released without resolving' };
    if (typeof seatResolveCandidate_ === 'function') {
      try { info.resolved = seatResolveCandidate_(info) || info.resolved; }
      catch (eWho) { }
    }

    // Releasing is always allowed; finishing twice never is (it would re-fire the hooks).
    var alreadyFinished = !!read(flow.finished);
    var finishing = payload.completed === true && !alreadyFinished;

    if (finishing) cell(flow.finished, now);
    cell(flow.released_at, now);
    cell(flow.released_by, who);
    if (finishing && flow.durable_id && info.resolved.id) {
      cell(flow.durable_id, info.resolved.id);
    }

    // Before the seat columns clear: packetFindRow_ keys on them.
    if (finishing && name === 'onboarding' && typeof obReportWrite_ === 'function') {
      try { obReportWrite_(info, user, payload); }
      catch (eRep) { }
    }

    // The link goes last: if a write above throws, the person can carry on.
    cell(flow.seat_email, '');
    cell(flow.seat_id, '');

    people.push(info.name || '(unnamed)');

    if (finishing && SEAT_COMPLETE_HOOKS[name]) {
      try {
        followed.push(SEAT_COMPLETE_HOOKS[name](info, user));
      } catch (e) {
        // Reported, never rolled back.
        followed.push({ moved: false, reason: String((e && e.message) || e) });
      }
    }
  }

  hubSysLog_(who, 'seat_release',
    name + ' · ' + people.join(', ') + (payload.completed === true ? ' · completed' : ' · handover') +
    (followed.length ? ' · ' + JSON.stringify(followed) : ''),
    { status: 200 });

  return { status: 200, data: { released: rows.length, people: people,
           server_side: true, followed: followed } };
};

/** Who this seat is holding, without changing anything. */
HUB_POLICY.seatStatus = {
  file: 'Seat.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.seatStatus = function (payload, user) {
  if (!user) return hubDenied_();
  var name = str_(payload.flow);
  if (!SEAT_FLOWS.hasOwnProperty(name)) return { status: 400, message: 'Unknown seat flow: "' + name + '".' };
  var flow = SEAT_FLOWS[name];
  if (!flow) return { status: 200, data: { held: 0, people: [], server_side: false } };

  var sheet = hubTabSheet_(flow.tab);
  if (!sheet) return { status: 404, message: 'The ' + flow.tab + ' tab is missing.' };
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var rows = seatHeldRows_(flow, sheet, values, hdr, user);
  var people = rows.map(function (row) {
    var iL = hdr.indexOf(flow.label), iF = hdr.indexOf(flow.label_fallback);
    return String((iL !== -1 && values[row - 1][iL]) || (iF !== -1 && values[row - 1][iF]) || '').trim();
  });
  return { status: 200, data: { held: rows.length, people: people, server_side: true } };
};
