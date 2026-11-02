var COMM_INCIDENT_SITUATION = 'hotline_incident';

// More than this in one pass is a badly split transcript; the rest stay in the tab and the cap is logged.
var COMM_INCIDENT_MAX_PER_PASS = 6;

function commIncidentSituation_() {
  var sit = null;
  try { sit = (typeof smartSituationOn_ === 'function') ? smartSituationOn_(COMM_INCIDENT_SITUATION) : null; }
  catch (e) { return null; }
  if (!sit) return null;
  var chans = commIncidentChannels_(sit);
  return chans.length ? sit : null;
}

// A channel counts only when named AND written; the send door silently refuses one with no words.
function commIncidentChannels_(sit) {
  var named = (typeof smartList_ === 'function') ? smartList_(sit.channels) : [];
  var out = [];
  if (named.indexOf('sms') !== -1 && String(sit.sms_text || '').trim()) out.push('sms');
  if (named.indexOf('email') !== -1 &&
      (String(sit.email_text || '').trim() || String(sit.sms_text || '').trim())) out.push('email');
  return out;
}

// The destinations left once a director or the master who turned the incident alert off is taken out (AlertReceive.gs).
function commIncidentReceivers_(dests) {
  return (typeof arKeep_ === 'function') ? arKeep_('incident', dests || []) : (dests || []);
}

// A retry of the same incident yields the same key; two incidents in one call yield two.
function commIncidentInstance_(row) {
  return [String(row.timestamp || '').slice(0, 19),
          String(row.client_name || '').slice(0, 40),
          String(row.incident_category || '').slice(0, 30)].join('|');
}

function commIncidentVars_(row, manager) {
  return {
    client: String(row.client_name || 'a client we could not name'),
    category: String(row.incident_category || 'uncategorised'),
    location: String(row.incident_location || 'a location that was not given'),
    date: String(row.incident_date || row.incident_reported_date || ''),
    time: String(row.incident_time || row.incident_reported_time || ''),
    dsp: String(row.your_name || row.dsp_name || 'the caller'),
    employees: String(row.employees_involved || ''),
    summary: String(row.summary_of_incident || '').slice(0, 900),
    action: String(row.immediate_action_taken || '').slice(0, 400),
    house_manager: String((manager && manager.name) || ''),
    first_name: String((manager && manager.name) || '').split(/\s+/)[0] || '',
    name: String(row.client_name || ''),
    sender: (typeof SMART_SENDER_DEFAULT !== 'undefined') ? SMART_SENDER_DEFAULT : ''
  };
}

// Never throws: a filed incident stays filed even when paging fails.
function commIncidentFiled_(rows, ctx) {
  var out = { incidents: 0, told: 0, held: 0, skipped: 0, capped: 0,
              managers: 0, owed: 0, why: [], state: 'quiet' };
  var list = (rows || []).filter(function (r) { return r && (r.client_name || r.summary_of_incident); });
  if (!list.length) return out;
  ctx = ctx || {};

  var sit = commIncidentSituation_();
  if (!sit) {
    out.state = 'wordless';
    out.why.push('the situation `' + COMM_INCIDENT_SITUATION + '` is absent, switched off, or ' +
                 'has no written words on a channel it names — nothing was sent');
    return out;
  }
  if (typeof rpcCall_ !== 'function') { out.state = 'no_door'; return out; }

  var chans = commIncidentChannels_(sit);
  var addresses = (typeof smartList_ === 'function') ? smartList_(sit.to) : [];
  // each kept entry keeps its place in the list, so its idempotency key never moves onto somebody else
  var paged = commIncidentReceivers_(addresses);
  if (paged.length < addresses.length) {
    out.why.push((addresses.length - paged.length) + ' on the list turned this alert off in Settings — not paged');
  }
  if (list.length > COMM_INCIDENT_MAX_PER_PASS) {
    out.capped = list.length - COMM_INCIDENT_MAX_PER_PASS;
    list = list.slice(0, COMM_INCIDENT_MAX_PER_PASS);
  }

  list.forEach(function (row, i) {
    out.incidents++;
    var instance = commIncidentInstance_(row);
    var manager = null;
    try {
      manager = (typeof hotlineHouseManager_ === 'function')
        ? hotlineHouseManager_(String(row.incident_location || '').trim()) : null;
    } catch (eM) { manager = null; }
    var vars = commIncidentVars_(row, manager);
    var idem = 'incident_' + String(ctx.callId || '').slice(0, 24) + '_' + i;

    var heard = {};
    var owed = [];
    addresses.forEach(function (dest, n) {
      if (paged.indexOf(dest) === -1) return;
      var one = commIncidentCopyTo_(dest, sit, vars, 'incident: ' + COMM_INCIDENT_SITUATION,
                                    idem + '_to' + n, chans);
      if (one.sent) { out.told++; heard[String(dest).replace(/\D/g, '').slice(-10)] = true; }
      else if (one.held) {
        out.held++;
        if (one.quiet) owed.push({ dest: String(dest), idem: idem + '_to' + n, hm: false });
      }
      else { out.skipped++; if (one.why) out.why.push(one.why); }
    });

    // Never a guess: a location that resolves to no manager is reported, not substituted.
    if (!manager || !String(manager.phone || '').trim()) {
      out.why.push('no house manager resolved for "' +
                   String(row.incident_location || '(no location)').slice(0, 40) +
                   '" — nobody was texted about that house');
    } else if (heard[String(manager.phone).replace(/\D/g, '').slice(-10)]) {
      out.why.push('the house manager is already on the named list — told once');
    } else if (!commIncidentReceivers_([String(manager.phone)]).length) {
      out.why.push('the house manager turned this alert off in Settings — not texted');
    } else {
      var hm = commIncidentCopyTo_(String(manager.phone), sit, vars,
                                   'incident (house manager): ' + COMM_INCIDENT_SITUATION,
                                   idem + '_hm', chans);
      if (hm.sent) { out.told++; out.managers++; }
      else if (hm.held) {
        out.held++;
        if (hm.quiet) owed.push({ dest: String(manager.phone), idem: idem + '_hm', hm: true });
      }
      else { out.skipped++; if (hm.why) out.why.push(hm.why); }
    }

    if (owed.length && typeof hubQuietOwe_ === 'function') {
      var keptForMorning = hubQuietOwe_('incident', instance + '|' + String(ctx.callId || '').slice(0, 24), {
        vars: vars, owed: owed, client: String(row.client_name || ''), ts: String(row.timestamp || ''),
        incident_date: String(row.incident_date || '')
      });
      if (keptForMorning) out.owed += owed.length;
      else out.why.push('the quiet window held ' + owed.length + ' page(s) about this incident and the ' +
                        'morning list could NOT keep them — they will not be sent at 08:00');
    }

    // Recorded only when something really left, so a held pass stays retryable.
    if (out.told && typeof smartRecord_ === 'function') {
      try {
        smartRecord_(smartLedgerKey_(COMM_INCIDENT_SITUATION, String(row.client_name || 'client'),
                                     String(row.timestamp || '').slice(0, 10)),
                     COMM_INCIDENT_SITUATION, String(row.client_name || ''),
                     String(row.incident_date || ''), chans.join('+') || 'sms');
      } catch (eL) { /* the message left either way; the ledger line is a record */ }
    }
  });

  out.state = out.told ? 'told' : (out.held ? 'held' : 'quiet');
  if (out.capped) {
    try {
      hubSysLog_('asa-hub:commincident', 'incident_page_capped',
                 out.capped + ' more incident(s) in this call were NOT paged (the cap is ' +
                 COMM_INCIDENT_MAX_PER_PASS + ') — they are filed in the tab',
                 { status: 200 });
    } catch (eC) { /* the count rides the answer too */ }
  }
  try {
    hubSysLog_('asa-hub:commincident', 'incident_paged',
               out.incidents + ' incident(s) · ' + out.told + ' message(s) sent · ' +
               out.held + ' held' + (out.owed ? ' (' + out.owed + ' kept for 08:00 by the quiet window)' : '') +
               ' · ' + out.managers + ' house manager(s) · ' +
               out.why.slice(0, 3).join(' · '), { status: 200 });
  } catch (eL2) { /* the answer is the caller's copy */ }
  return out;
}

function commIncidentCopyTo_(dest, sit, vars, reason, idem, chans) {
  var out = { sent: false, held: false, why: '' };
  var d = String(dest || '').trim();
  if (!d) return out;
  var res = null;
  try {
    if (d.indexOf('@') !== -1) {
      if (chans.indexOf('email') === -1) {
        out.why = d.slice(0, 30) + ': an address, and this row has no written letter';
        return out;
      }
      res = rpcCall_('emailSend', {
        to: d,
        subject: smartRender_(sit.email_subject, vars),
        body: smartRender_(sit.email_text || sit.sms_text, vars),
        reason: reason
      }, { idempotency_key: idem });
    } else {
      if (chans.indexOf('sms') === -1) {
        out.why = d.slice(0, 20) + ': a number, and this row has no written text';
        return out;
      }
      var num = (typeof packetTeamCopyNumber_ === 'function') ? packetTeamCopyNumber_(d) : '';
      if (!num) { out.why = d.slice(0, 20) + ' is neither an address nor a number we may text'; return out; }
      res = rpcCall_('smsSend', {
        to: num, body: smartRender_(sit.sms_text, vars), reason: reason
      }, { idempotency_key: idem });
    }
  } catch (eR) {
    out.why = d.slice(0, 20) + ': ' + String((eR && eR.message) || eR);
    return out;
  }
  if (res && res.ok && res.sent && !res.redirected) { out.sent = true; return out; }
  if (res && (res.redirected || res.gated || res.rehearsed || res.recorded_to)) {
    out.held = true;
    // A quiet-window hold is owed, not dropped: the caller puts it on the morning list.
    out.quiet = !!res.quiet;
    out.why = d.slice(0, 20) + ': ' + String(res.reason || 'held by a brake');
    return out;
  }
  out.why = d.slice(0, 20) + ': ' + String((res && (res.error || res.detail)) || 'the send door refused');
  return out;
}

// An incident stays true overnight, so the held page goes unless the row was switched off meanwhile.
function commIncidentQuietCarry_(data) {
  var d = data || {};
  var sit = commIncidentSituation_();
  if (!sit) {
    return { state: 'stale', why: 'the situation `' + COMM_INCIDENT_SITUATION + '` was switched off or ' +
                                  'lost its words overnight — nobody was paged' };
  }
  var chans = commIncidentChannels_(sit);
  var told = 0, still = 0, why = [];
  (d.owed || []).forEach(function (o) {
    // a page held overnight for somebody who has since turned this alert off is not sent
    if (!commIncidentReceivers_([String(o.dest || '')]).length) return;
    var one = commIncidentCopyTo_(String(o.dest || ''), sit, d.vars || {},
                                  (o.hm ? 'incident (house manager): ' : 'incident: ') + COMM_INCIDENT_SITUATION +
                                  ' (held overnight by the quiet window)', String(o.idem || ''), chans);
    if (one.sent) told++;
    else { still++; if (one.why) why.push(one.why); }
  });
  if (told && typeof smartRecord_ === 'function') {
    try {
      smartRecord_(smartLedgerKey_(COMM_INCIDENT_SITUATION, String(d.client || 'client'),
                                   String(d.ts || '').slice(0, 10)),
                   COMM_INCIDENT_SITUATION, String(d.client || ''), String(d.incident_date || ''),
                   chans.join('+') || 'sms');
    } catch (eL) { /* the message left either way; the ledger line is a record */ }
  }
  return { state: 'carried', told: told, held: still,
           why: told + ' page(s) sent' + (still ? ', ' + still + ' held (' + why.slice(0, 2).join(' · ') + ')' : '') };
}
