// Speaks every day, clean or not; compares folded display names only, never e-mails.
var DUP_SCAN_SITUATION = 'pattern_scan_daily';

var DUP_SCAN_LEDGER_PERSON = 'platform';

var DUP_SCAN_NAMES_MAX = 4;

function dupScanDay_() {
  try { return Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd'); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}

function dupScanGroups_(rows) {
  var groups = {};
  (rows || []).forEach(function (u) {
    var id = str_(u.userid);
    var name = str_(u.displayname);
    if (!id || !name) return;
    var key = (typeof clientNameKey_ === 'function') ? clientNameKey_(name) : name.toLowerCase();
    if (!key) return;
    if (!groups[key]) groups[key] = { name: name, accounts: [] };
    groups[key].accounts.push({ id: id, email: str_(u.email), last: str_(u.lastlogin) });
  });
  var out = [];
  for (var key in groups) {
    if (groups.hasOwnProperty(key) && groups[key].accounts.length > 1) out.push(groups[key]);
  }
  out.sort(function (a, b) { return b.accounts.length - a.accounts.length; });
  return out;
}

function dupScanFinding_(groups, scanned) {
  if (!groups.length) {
    return { clean: true, count: 0, scanned: scanned,
             finding: 'no duplicates in the system',
             detail: scanned + ' accounts checked, none of them the same person twice' };
  }
  var names = groups.slice(0, DUP_SCAN_NAMES_MAX).map(function (g) {
    return g.name + ' (' + g.accounts.length + ')';
  });
  var more = groups.length - names.length;
  return {
    clean: false, count: groups.length, scanned: scanned,
    finding: groups.length + (groups.length === 1 ? ' duplicate: ' : ' duplicates: ') +
             names.join(', ') + (more > 0 ? ' +' + more : ''),
    detail: names.join(' · ') + (more > 0 ? ' and ' + more + ' more' : '')
  };
}

function dupScanRun_(opts) {
  opts = opts || {};
  var out = { scanned: 0, duplicates: 0, told: 0, held: 0, state: 'quiet', why: '' };
  var rows = [];
  try { rows = usersAll_() || []; }
  catch (e) {
    // A failed read must never become an all-clear.
    out.state = 'unread';
    out.why = 'the accounts could not be read — nothing was said';
    try {
      hubSysLog_('asa-hub:dupscan', 'dup_scan_unread', String((e && e.message) || e), { status: 500 });
    } catch (eL) {}
    return out;
  }
  out.scanned = rows.length;
  var groups = dupScanGroups_(rows);
  out.duplicates = groups.length;
  var found = dupScanFinding_(groups, rows.length);

  var day = dupScanDay_();
  if (!opts.force) {
    var told = {};
    try { told = (typeof smartAlreadySent_ === 'function') ? smartAlreadySent_() : {}; }
    catch (eT) { told = {}; }
    var key = (typeof smartLedgerKey_ === 'function')
      ? smartLedgerKey_(DUP_SCAN_SITUATION, DUP_SCAN_LEDGER_PERSON, day)
      : (DUP_SCAN_SITUATION + '|' + DUP_SCAN_LEDGER_PERSON + '|' + day);
    if (told[key]) { out.state = 'already'; out.why = 'said once today'; return out; }
    out.ledger_key = key;
  }

  var sit = null;
  try { sit = (typeof smartSituationOn_ === 'function') ? smartSituationOn_(DUP_SCAN_SITUATION) : null; }
  catch (eS) { sit = null; }
  if (!sit) {
    out.state = 'wordless';
    out.why = 'the situation `' + DUP_SCAN_SITUATION + '` is absent or switched off';
    return out;
  }
  var chans = (typeof smartList_ === 'function') ? smartList_(sit.channels) : [];
  var vars = {
    finding: found.finding, count: String(found.count), scanned: String(found.scanned),
    day: day, detail: found.detail,
    sender: (typeof SMART_SENDER_DEFAULT !== 'undefined') ? SMART_SENDER_DEFAULT : '',
    name: '', first_name: ''
  };
  var sent = 0, recorded = 0;
  ((typeof smartList_ === 'function') ? smartList_(sit.to) : []).forEach(function (dest, i) {
    var d = String(dest || '').trim();
    if (!d) return;
    var res = null;
    try {
      if (d.indexOf('@') !== -1) {
        if (chans.indexOf('email') === -1 || !str_(sit.email_text || sit.sms_text)) return;
        res = rpcCall_('emailSend', {
          to: d, subject: smartRender_(sit.email_subject, vars),
          body: smartRender_(sit.email_text || sit.sms_text, vars),
          reason: 'pattern scan ' + day + ': ' + DUP_SCAN_SITUATION
        }, { idempotency_key: 'dupscan_mail' + i + '_' + day });
      } else {
        if (chans.indexOf('sms') === -1 || !str_(sit.sms_text)) return;
        // Two of the three are company lines, which the outside door drops silently.
        var num = (typeof packetTeamCopyNumber_ === 'function') ? packetTeamCopyNumber_(d) : '';
        if (!num) return;
        res = rpcCall_('smsSend', {
          to: num, body: smartRender_(sit.sms_text, vars), reason: 'pattern scan ' + day + ': ' + DUP_SCAN_SITUATION
        }, { idempotency_key: 'dupscan_sms' + i + '_' + day });
      }
    } catch (eR) { return; }
    if (res && res.ok && res.sent && !res.redirected) sent++;
    // A recorded message counts as told, or the day is never marked and it repeats hourly.
    else if (res && res.recorded_to) recorded++;
    else if (res && (res.gated || res.redirected || res.rehearsed)) out.held++;
  });
  out.told = sent;
  out.recorded = recorded;
  out.state = sent ? 'told' : (recorded ? 'recorded' : (out.held ? 'held' : 'quiet'));

  // A held day stays unmarked so it is retried once the dial moves.
  if ((sent || recorded) && out.ledger_key && typeof smartRecord_ === 'function') {
    try {
      smartRecord_(out.ledger_key, DUP_SCAN_SITUATION, DUP_SCAN_LEDGER_PERSON, day,
                   recorded && !sent ? 'recorded' : (chans.join('+') || 'sms'));
    } catch (eW) {}
  }
  try {
    hubSysLog_('asa-hub:dupscan', 'dup_scan',
               out.scanned + ' account(s) · ' + out.duplicates + ' duplicate(s) · ' +
               out.told + ' told · ' + out.held + ' held · ' + found.detail,
               { status: 200 });
  } catch (eL2) {}
  return out;
}

// The daily scan is Python's (app/dup_scan*.py), rung by the relay's clock.
function dupScanSweepMaybe_() {
  return { skipped: 'python' };
}

function runPatternScanNow() {
  var out = dupScanRun_({ force: true });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
