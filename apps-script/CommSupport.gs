var COMM_SUPPORT_SITUATION = 'hotline_support_request';

// More than this is a transcript the model split badly; the rest stay in the queue.
var COMM_SUPPORT_MAX_PER_PASS = 4;

function commSupportSituation_() {
  var sit = null;
  try { sit = (typeof smartSituationOn_ === 'function') ? smartSituationOn_(COMM_SUPPORT_SITUATION) : null; }
  catch (e) { return null; }
  if (!sit) return null;
  return commSupportChannels_(sit).length ? sit : null;
}

function commSupportChannels_(sit) {
  var named = (typeof smartList_ === 'function') ? smartList_(sit.channels) : [];
  var out = [];
  if (named.indexOf('sms') !== -1 && String(sit.sms_text || '').trim()) out.push('sms');
  if (named.indexOf('email') !== -1 &&
      (String(sit.email_text || '').trim() || String(sit.sms_text || '').trim())) out.push('email');
  return out;
}

function commSupportVars_(row) {
  var r = row || {};
  return {
    requestor: String(r.requestor || r.Requestor || 'somebody the row does not name'),
    type: String(r.type_of_request || r['Type of Request'] || 'not typed'),
    urgency: String(r.urgency || r.Urgency || ''),
    received: String(r.date_received || r['Date Received'] || ''),
    description: String(r.description_of_request || r['Description of Request'] || '').slice(0, 700),
    status: String(r.status || r.Status || 'New'),
    sender: (typeof SMART_SENDER_DEFAULT !== 'undefined') ? SMART_SENDER_DEFAULT : '',
    first_name: String(r.requestor || r.Requestor || '').split(/\s+/)[0] || '',
    name: String(r.requestor || r.Requestor || '')
  };
}

// Never throws: a filed request stays filed. A page the quiet window held is owed to the morning, not dropped.
function commSupportFiled_(rows, ctx) {
  var out = { requests: 0, told: 0, held: 0, skipped: 0, capped: 0, owed: 0, state: 'quiet', why: [] };
  var list = (rows || []).filter(function (r) { return r; });
  if (!list.length) return out;
  ctx = ctx || {};

  var sit = commSupportSituation_();
  if (!sit) {
    out.state = 'wordless';
    out.why.push('the situation `' + COMM_SUPPORT_SITUATION + '` is absent, switched off, or ' +
                 'has no written words on a channel it names — nothing was sent');
    return out;
  }
  if (typeof rpcCall_ !== 'function') { out.state = 'no_door'; return out; }

  var chans = commSupportChannels_(sit);
  var addresses = (typeof smartList_ === 'function') ? smartList_(sit.to) : [];
  if (!addresses.length) {
    out.state = 'nobody';
    out.why.push('the row names nobody — an empty audience is an answer, not a default');
    return out;
  }
  if (list.length > COMM_SUPPORT_MAX_PER_PASS) {
    out.capped = list.length - COMM_SUPPORT_MAX_PER_PASS;
    list = list.slice(0, COMM_SUPPORT_MAX_PER_PASS);
  }

  list.forEach(function (row, i) {
    out.requests++;
    var vars = commSupportVars_(row);
    var idem = 'support_' + String(ctx.callId || '').slice(0, 24) + '_' + i;
    var owed = [];
    addresses.forEach(function (dest, n) {
      var one = commSupportCopyTo_(dest, sit, vars, 'support request: ' + COMM_SUPPORT_SITUATION,
                                   idem + '_' + n, chans);
      if (one.sent) out.told++;
      else if (one.held) {
        out.held++;
        if (one.quiet) owed.push({ dest: String(dest), idem: idem + '_' + n });
      }
      else { out.skipped++; if (one.why) out.why.push(one.why); }
    });
    if (owed.length && typeof hubQuietOwe_ === 'function') {
      var keptForMorning = hubQuietOwe_('support', idem, {
        vars: vars, owed: owed, call_id: String(ctx.callId || ''), requestor: vars.name
      });
      if (keptForMorning) out.owed += owed.length;
      else out.why.push('the quiet window held ' + owed.length + ' page(s) about this request and the ' +
                        'morning list could NOT keep them — they will not be sent at 08:00');
    }
  });

  out.state = out.told ? 'told' : (out.held ? 'held' : 'quiet');
  try {
    hubSysLog_('asa-hub:commsupport', 'support_request_paged',
               out.requests + ' request(s) · ' + out.told + ' message(s) sent · ' + out.held +
               ' held' + (out.owed ? ' (' + out.owed + ' kept for 08:00 by the quiet window)' : '') +
               (out.capped ? ' · ' + out.capped + ' over the cap' : '') +
               (out.why.length ? ' · ' + out.why.slice(0, 2).join(' · ') : ''),
               { status: 200 });
  } catch (eL) { }
  return out;
}

function commSupportCopyTo_(dest, sit, vars, reason, idem, chans) {
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
        to: d, subject: smartRender_(sit.email_subject, vars),
        body: smartRender_(sit.email_text || sit.sms_text, vars), reason: reason
      }, { idempotency_key: idem });
    } else {
      if (chans.indexOf('sms') === -1) {
        out.why = d.slice(0, 20) + ': a number, and this row has no written text';
        return out;
      }
      // Not packetSendableNumber_: it refuses our own shared lines, and this row names two of them.
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
    out.quiet = !!res.quiet;
    out.why = d.slice(0, 20) + ': ' + String(res.reason || 'held by a brake');
    return out;
  }
  out.why = d.slice(0, 20) + ': ' + String((res && (res.error || res.detail)) || 'the send door refused');
  return out;
}

var COMM_SUPPORT_RECHECK_ROWS = 300;

// The hotline stamps "Call ID: <id>" into every row's notes; null means the queue could not be read.
function commSupportStillOpen_(callId, requestor) {
  var id = String(callId || '').trim();
  if (!id || typeof estateSheet_ !== 'function') return null;
  try {
    var handle = estateSheet_('supportQueue');
    if (!handle) return null;
    var iN = handle.keys.indexOf('notes'), iR = handle.keys.indexOf('requestor');
    var iS = handle.keys.indexOf('status');
    if (iN === -1) return null;
    var last = handle.sheet.getLastRow();
    if (last < 2) return { found: false, status: '' };
    var first = Math.max(2, last - COMM_SUPPORT_RECHECK_ROWS + 1);
    var values = handle.sheet.getRange(first, 1, last - first + 1, handle.keys.length).getValues();
    var who = String(requestor || '').trim().toLowerCase();
    for (var r = values.length - 1; r >= 0; r--) {
      if (String(values[r][iN] || '').indexOf('Call ID: ' + id) === -1) continue;
      if (who && iR !== -1 && String(values[r][iR] || '').trim().toLowerCase() !== who) continue;
      return { found: true, status: iS === -1 ? '' : String(values[r][iS] || '').trim() };
    }
    return { found: false, status: '' };
  } catch (e) { return null; }
}

// Still owed only while the row is in the queue at `New`; an unreadable queue proves nothing, so the page goes.
function commSupportQuietCarry_(data) {
  var d = data || {};
  var sit = commSupportSituation_();
  if (!sit) {
    return { state: 'stale', why: 'the situation `' + COMM_SUPPORT_SITUATION + '` was switched off or lost ' +
                                  'its words overnight — nobody was paged' };
  }
  var open = commSupportStillOpen_(d.call_id, d.requestor);
  if (open && !open.found) {
    return { state: 'stale', why: 'the request is no longer in the queue — nobody was paged' };
  }
  if (open && open.status && open.status.toLowerCase() !== 'new') {
    return { state: 'stale', why: 'somebody took the request overnight (status "' + open.status.slice(0, 30) +
                                  '") — nobody was paged' };
  }
  var chans = commSupportChannels_(sit);
  var told = 0, still = 0, why = [];
  (d.owed || []).forEach(function (o) {
    var one = commSupportCopyTo_(String(o.dest || ''), sit, d.vars || {},
                                 'support request: ' + COMM_SUPPORT_SITUATION + ' (held overnight by the quiet window)',
                                 String(o.idem || ''), chans);
    if (one.sent) told++;
    else { still++; if (one.why) why.push(one.why); }
  });
  return { state: 'carried', told: told, held: still,
           why: told + ' page(s) sent' + (open ? '' : ' (the queue could not be read, so nothing said the request ' +
                                                     'was answered)') +
                (still ? ', ' + still + ' held (' + why.slice(0, 2).join(' · ') + ')' : '') };
}
