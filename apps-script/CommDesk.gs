// Needs-human is an attention state, never a resolution: nothing here settles an obligation.

// Worst first: a disagreement may be a false record.
var COMM_DESK_REASONS = ['disagreement', 'ambiguous', 'unclear', 'exhausted'];

// No 'waived': excusing an obligation is the compliance catalogue's decision.
var COMM_DESK_ACTIONS = ['acknowledged', 'reassigned', 'took_over', 'reopened'];

// Pure: shapes what the lanes decided, never re-judges.
function commDeskRow_(intent, contribution, qualified, why, nowIso) {
  var reason = String(why || '');
  if (COMM_DESK_REASONS.indexOf(reason) === -1) return null;
  var open = ((intent && intent.bindings) || []).filter(function (b) {
    return String(b.binding_state || 'open') === 'open';
  });
  return {
    id: 'CMD_' + ((typeof commRecordId_ === 'function')
      ? commRecordId_(String((intent && intent.intent_key) || '') + '|' + reason)
      : reason),
    intent_key: String((intent && intent.intent_key) || ''),
    person_key: String((intent && intent.person_key) || ''),
    person_name: String((intent && intent.person_name) || ''),
    reason: reason,
    // Verbatim, never a paraphrase: our reading is what failed.
    said: String((contribution && contribution.text) || '').slice(0, 300),
    read_as: String((contribution && contribution.kind) || ''),
    read_why: String((contribution && contribution.why) || ''),
    open_items: open.map(function (b) { return String(b.req_id || ''); }).join(' · '),
    open_count: open.length,
    disagreements: Number((qualified && qualified.disagreements) || 0),
    state: 'open',
    raised_at: String(nowIso || ''),
    action: '', by: '', at: '', note: ''
  };
}

// Asked in order of consequence; '' when the machine handled it.
function commDeskReason_(correlation, contribution, qualified, attempts) {
  if (qualified && Number(qualified.disagreements || 0) > 0) return 'disagreement';
  if (correlation && !correlation.intent &&
      (correlation.how === 'ambiguous' || correlation.how === 'unknown-token')) {
    return 'ambiguous';
  }
  if (contribution && String(contribution.kind) === 'unclear') return 'unclear';
  var cap = (typeof commPolicy_ === 'function') ? Number(commPolicy_('max_attempts')) : 3;
  if (Number(attempts || 0) >= cap) return 'exhausted';
  return '';
}

// took_over is a lease: on expiry the item returns to the desk, contact does not resume.
function commDeskAct_(row, action, who, nowIso, note, leaseHours) {
  if (!row) return { error: 'no row' };
  var act = String(action || '');
  if (COMM_DESK_ACTIONS.indexOf(act) === -1) {
    return { error: 'a desk may not ' + (act || 'do that') +
                    ' — closing an obligation belongs to the catalogue' };
  }
  var next = {};
  Object.keys(row).forEach(function (k) { next[k] = row[k]; });
  next.action = act;
  next.by = String(who || '');
  next.at = String(nowIso || '');
  next.note = String(note || '').slice(0, 500);
  next.state = (act === 'reopened') ? 'open' : 'handled';
  if (act === 'took_over') {
    var hours = Number(leaseHours || 0) || 72;
    next.state = 'leased';
    next.lease_hours = hours;
    next.lease_until = new Date(Date.parse(String(nowIso)) + hours * 3600000).toISOString();
  }
  return next;
}

function commDeskLeaseLapsed_(row, nowMs) {
  if (!row || String(row.state) !== 'leased' || !row.lease_until) return false;
  var until = Date.parse(String(row.lease_until));
  return !isNaN(until) && until < Number(nowMs);
}
