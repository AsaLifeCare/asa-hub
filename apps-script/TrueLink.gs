var TL_URL_PROP = 'BROWSER_AUTOMATION_URL';
var TL_SECRET_PROP = 'BROWSER_AUTOMATION_BOT_SECRET';

function truelinkProp_(key) {
  try { return String(hubProp_(key) || ''); }
  catch (e) { return ''; }
}

HUB_POLICY.truelinkSync = {
  file: 'TrueLink.gs', lane: 'tool', store: 'sheet',
  // A real browser login with SMS 2FA; declaring it cheap invites retries mid-run.
  idempotent: false, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.truelinkSync = function (payload, user) {
  if (!user || user.is_service || user.role !== 'admin') return hubDenied_();

  var url = truelinkProp_(TL_URL_PROP);
  var secret = truelinkProp_(TL_SECRET_PROP);
  if (!url) {
    return { status: 503, message: 'Set ' + TL_URL_PROP + ' in Script Properties — ' +
             'the address the browser automation answers on.' };
  }
  if (!secret) {
    return { status: 503, message: 'Set ' + TL_SECRET_PROP + ' in Script Properties. ' +
             'The service refuses unauthenticated callers, which is why the old ' +
             'standalone sync was being turned away at the door.' };
  }

  // Rehearsal unless dry_run: false is sent explicitly; a rehearsal skips only the append.
  var dry = !(payload && payload.dry_run === false);

  // Blank means the service uses its own environment; never log or echo these.
  var creds = {};
  var em = truelinkProp_('TRUELINK_EMAIL');
  var pw = truelinkProp_('TRUELINK_PASSWORD');
  if (em) creds.email = em;
  if (pw) creds.password = pw;
  if ((em && !pw) || (pw && !em)) {
    return { status: 503, message: 'Only one of TRUELINK_EMAIL / TRUELINK_PASSWORD is set ' +
             'in Script Properties. Set both, or neither and let the server hold them.' };
  }

  var res = null, code = 0, text = '';
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      // The service reads the secret only from this header, never from the body.
      headers: { Authorization: 'Bearer ' + secret },
      payload: JSON.stringify({
        task: 'truelink',
        params: Object.assign({ dry_run: dry }, creds)
      }),
      muteHttpExceptions: true,
      validateHttpsCertificates: true
    });
    code = res.getResponseCode();
    text = res.getContentText();
  } catch (e) {
    hubSysLog_(str_(user.email), 'truelinkSync', 'fetch', { status: 502, message: String(e && e.message || e) });
    return { status: 502, message: 'The automation service could not be reached: ' + (e && e.message || e) };
  }

  if (code !== 200) {
    var detail = text;
    try { detail = str_(JSON.parse(text).err) || text; } catch (eP) {}
    hubSysLog_(str_(user.email), 'truelinkSync', 'http ' + code, { status: code, message: detail.slice(0, 200) });
    return { status: 502, message: 'The service answered ' + code + ': ' + String(detail).slice(0, 300) };
  }

  var body = null;
  try { body = JSON.parse(text); } catch (eB) { body = null; }
  if (!body || body.ok === false) {
    var err = body ? str_(body.err) : 'unreadable answer';
    var shot = body && body.screenshot ? ' · screenshot: ' + body.screenshot : '';
    hubSysLog_(str_(user.email), 'truelinkSync', 'task failed', { status: 500, message: (err + shot).slice(0, 200) });
    return { status: 502, message: 'The sync failed: ' + err + shot };
  }

  var r = (body.result || {});

  // Nothing is sent from here (emits stays []): Smart Comms sweeps this tab.
  var found = Number(r.dry_run ? (r.would_import || 0) : (r.imported || 0));
  var un = (r.unmatched || []);
  var runRow = createRow_('truelinkRuns', {
    at: new Date().toISOString(),
    by: str_(user.email),
    mode: r.dry_run ? 'REHEARSAL' : 'sync complete',
    verb: r.dry_run ? 'would be added' : 'added',
    found: found,
    skipped: Number(r.skipped || 0),
    unreadable: Number(r.unreadable || 0),
    tail: un.length
      ? (un.length + ' cardholder name(s) did not match a client and were NOT imported: ' +
         un.map(function (u) { return str_(u.name); }).join(', '))
      : (r.dry_run ? 'Nothing was written.' : ''),
    reported: ''
  });
  // The sync itself already ran on the relay; only its record was refused, and the answer says so rather than…
  var runRefused = sheetDbRefused_(runRow);
  if (runRefused) {
    hubSysLog_(str_(user.email), 'truelinkSync_run_row_refused', String(runRefused.message).slice(0, 200),
               { status: runRefused.status });
  }

  hubSysLog_(str_(user.email), 'truelinkSync', dry ? 'rehearsal' : 'live',
             { status: 200, message: str_(r.message) });
  return { status: 200, data: {
    dryRun: !!r.dry_run,
    imported: Number(r.imported || 0),
    wouldImport: Number(r.would_import || 0),
    skipped: Number(r.skipped || 0),
    unreadable: Number(r.unreadable || 0),
    unmatched: r.unmatched || [],
    message: str_(r.message),
    // the run's record in truelinkRuns: '' when filed, else why it was refused
    run_row_refused: runRefused ? str_(runRefused.message) : ''
  } };
};


function truelinkRunSubjects_() {
  var cutoff = Date.now() - 2 * 86400000;
  return listRows_('truelinkRuns', {}).filter(function (r) {
    var t = new Date(str_(r.at)).getTime();
    return !isNaN(t) && t >= cutoff;
  }).map(function (r) {
    return { id: str_(r.id), mode: str_(r.mode), verb: str_(r.verb),
             found: str_(r.found), skipped: str_(r.skipped),
             unreadable: str_(r.unreadable), tail: str_(r.tail) };
  });
}
