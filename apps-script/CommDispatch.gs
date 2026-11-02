// Sends nothing: translates an intent for the Smart Comms sweep, which owns channels, words and the ledger.

// Fails closed: an absent or OFF situation is null, and null sends nothing.
var COMM_SITUATION_FLOOR = { 'compliance.owed': 'compliance_bundle' };

function commSituationFor_(purpose) {
  var key = String(purpose || '');
  var id = '';
  try { if (typeof commBindings_ === 'function') id = String((commBindings_() || {})[key] || ''); }
  catch (e) { id = ''; }
  if (!id) id = COMM_SITUATION_FLOOR[key] || '';
  if (!id) return null;
  try { return (typeof smartSituationOn_ === 'function') ? smartSituationOn_(id) : null; }
  catch (e2) { return null; }
}

// A correction joins as the message's lead variable, never as a second send.
function commDispatchVars_(item, situation, labelFor) {
  var vars = commDispatchBaseVars_(item, situation, labelFor);
  try {
    if (typeof commRepairLead_ === 'function' && typeof SMART_LEAD_KEY !== 'undefined') {
      var lead = commRepairLead_(item, situation, vars);
      if (lead) vars[SMART_LEAD_KEY] = lead;
    }
  } catch (e) {
    // A correction that throws must not cost the message; the debt stays in comm_repairs.
    try {
      hubSysLog_('asa-hub:comm', 'comm_repair_lead_error',
                 'the correction could not be joined to ' + String((item && item.intent_key) || '') +
                 ': ' + String((e && e.message) || e) + ' — the message went without it and the ' +
                 'debt still stands', { status: 500 });
    } catch (eL) { }
  }
  return vars;
}

function commDispatchBaseVars_(item, situation, labelFor) {
  var name = String((item && item.name) || '');
  var bindings = (item && item.raw_bindings) || [];
  return {
    first_name: name.split(/\s+/)[0] || '',
    name: name,
    expires: String((item && item.expires) || ''),
    days_left: String((item && item.days_left) === '' ? '' : (item && item.days_left)),
    credential: commDispatchSummary_(bindings, labelFor) ||
                ((typeof smartCredentialLabel_ === 'function') ? smartCredentialLabel_(situation || {}) : ''),
    items: String(bindings.length),
    sender: String((situation && situation.sender) || (typeof SMART_SENDER_DEFAULT !== 'undefined' ? SMART_SENDER_DEFAULT : '')),
    // Empty unless set; smartRender_ leaves an unfilled placeholder visible, so misuse reads as broken.
    correction: String((item && item.correction) || ''),
    status_at: String((item && item.status_at) || ''),
    token: (typeof commReplyToken_ === 'function') ? commReplyToken_(item && item.intent_key) : ''
  };
}

function commDispatchItem_(intent, person, situation) {
  if (!intent || !situation) return null;
  var bindings = (intent.bindings || []).filter(function (b) {
    return String(b.binding_state || 'open') === 'open';
  });
  if (!bindings.length) return null;

  // The earliest date: commConsolidate_ already grouped these into one urgency band.
  var soonest = '';
  var left = null;
  bindings.forEach(function (b) {
    var d = (b.days_left === null || b.days_left === undefined) ? null : Number(b.days_left);
    if (d !== null && (left === null || d < left)) { left = d; soonest = String(b.expires || ''); }
    if (left === null && !soonest && b.expires) soonest = String(b.expires);
  });

  return {
    situation: String(situation.id || ''),
    key: 'CI|' + String(intent.intent_key || ''),
    name: String(intent.person_name || ''),
    name_key: String(intent.person_key || ''),
    phone: String((person && person.phone) || ''),
    email: String((person && person.email) || ''),
    credential: String(situation.credential || ''),
    expires: soonest,
    days_left: left === null ? '' : left,
    channels: (situation.channels && situation.channels.length)
      ? situation.channels : ['email'],
    rehearsal: false,
    rehearsed: false,
    config: situation,
    // Ignored by the sweep; the recorder writes these to comm_bindings.
    intent_key: String(intent.intent_key || ''),
    bindings: bindings.map(function (b) { return String(b.demand_id || ''); }),
    binding_count: bindings.length,
    raw_bindings: bindings
  };
}

function commDispatchSummary_(bindings, labelFor) {
  var names = (bindings || []).map(function (b) {
    var id = String(b.req_id || b.demand_id || '');
    var label = labelFor ? String(labelFor(id) || '') : '';
    return label || id;
  }).filter(Boolean);
  if (!names.length) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return names[0] + ' and ' + names[1];
  var shown = names.slice(0, 2).join(', ');
  var rest = names.length - 2;
  return shown + ' and ' + rest + ' more';
}

// The dial is checked here too, even though the recorder checks it.
function commDispatchAllowed_(intent, verdict, consent) {
  if (!intent) return { ok: false, why: 'no intent', blocked: ['no intent'] };

  // Every gate is asked, so a refusal names all its reasons, not just the first.
  var blocked = [];

  var dial = (typeof commDial_ === 'function') ? commDial_() : 'off';
  if (dial !== 'send') blocked.push('the dial says ' + dial + ' — nothing is handed over');

  if (!verdict || !verdict.send) {
    blocked.push('the policy did not clear it: ' +
                 ((verdict && verdict.reasons) || []).join(' · '));
  }
  if (!consent || !consent.ok) {
    blocked.push('no permitted route: ' + ((consent && consent.why) || 'unknown'));
  }
  var open = (intent.bindings || []).filter(function (b) {
    return String(b.binding_state || 'open') === 'open';
  });
  if (!open.length) blocked.push('every obligation in this intent is already settled');

  if (blocked.length) return { ok: false, why: blocked.join(' · '), blocked: blocked };
  return { ok: true, why: 'cleared: ' + open.length + ' open via ' + consent.channel, blocked: [] };
}
