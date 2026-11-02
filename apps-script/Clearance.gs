// An overlay on the matrix: never writes the estate sheets, and the estate's "expired" always wins.

var CLEARANCE_TAB = 'staff_clearance';

// Under the six-minute ceiling: a run killed there saves no cursor.
var CLEARANCE_OCR_BUDGET_MS = 240000;

// The matrix's vocabulary (Certs.gs), not the document catalogue's.
var CLEARANCE_CREDENTIALS = ['dodd', 'cpr', 'med1', 'med2', 'med3', 'mais', 'money', 'mandt'];

// Only two on purpose: licence, insurance and diploma must never paint compliance green.
var CLEARANCE_FROM_DOC = {
  dodd_8hr: 'dodd',
  cpr: 'cpr'
};

function clearanceSheet_() {
  return hubTabEnsure_(CLEARANCE_TAB, [
    'clearance_id', 'person_key', 'person_name', 'candidate_id', 'credential',
    'evidence_kind', 'file_id', 'state_ref', 'issued_on', 'expires_on',
    'decision', 'verified_by', 'verified_at', 'source'
  ]);
}

// A receipt ('submitted'), never a verdict; must never throw into the upload.
function clearanceRecordUpload_(docId, name, cid, fileId, expiresOn, user, opts) {
  // Accepts a document id or a credential, but only if it lands on a real matrix column.
  var credential = CLEARANCE_FROM_DOC[str_(docId)] ||
                   (CLEARANCE_CREDENTIALS.indexOf(str_(docId)) !== -1 ? str_(docId) : '');
  if (!credential) return null;
  var o = opts || {};
  try {
    var sheet = clearanceSheet_();
    var now = new Date().toISOString();
    sheet.appendRow([
      'CLR_' + randomHex_(16).toUpperCase(),
      clientNameKey_(name), str_(name), str_(cid), credential,
      'document', str_(fileId), '', str_(o.issued_on), str_(expiresOn),
      'submitted', '', '', str_(o.source) || 'hub:onboarding'
    ]);
    hubSysLog_(user && user.email, 'clearance_submitted',
      str_(name) + ' — ' + credential + ' document on file', { status: 200 });
    return credential;
  } catch (e) {
    hubSysLog_('asa-hub:clearance', 'clearance_record_failed',
      str_(docId) + ' — ' + (e && e.message ? e.message : e), { status: 500 });
    return null;
  }
}

// Keyed by clientNameKey_ (Certs.gs joins on it); the last row per person×credential wins.
function clearanceOverlay_() {
  var out = {};
  try {
    var values = clearanceSheet_().getDataRange().getValues();
    if (values.length < 2) return out;
    var hdr = values[0].map(normKey_);
    var col = {};
    ['personkey', 'credential', 'decision', 'expireson', 'evidencekind', 'fileid', 'stateref', 'personname']
      .forEach(function (k) { col[k] = hdr.indexOf(k); });
    if (col.personkey === -1 || col.credential === -1) return out;
    for (var r = 1; r < values.length; r++) {
      var pk = String(values[r][col.personkey] || '').trim();
      var cred = String(values[r][col.credential] || '').trim().toLowerCase();
      if (!pk || CLEARANCE_CREDENTIALS.indexOf(cred) === -1) continue;
      var rec = {
        decision: String(values[r][col.decision] || '').trim().toLowerCase(),
        expires_on: col.expireson === -1 ? '' : String(values[r][col.expireson] || '').trim(),
        evidence_kind: col.evidencekind === -1 ? '' : String(values[r][col.evidencekind] || '').trim(),
        file_id: col.fileid === -1 ? '' : String(values[r][col.fileid] || '').trim(),
        state_ref: col.stateref === -1 ? '' : String(values[r][col.stateref] || '').trim(),
        name: col.personname === -1 ? '' : String(values[r][col.personname] || '').trim()
      };
      if (!rec.file_id && !rec.state_ref && rec.decision !== 'revoked') continue;
      (out[pk] = out[pk] || {})[cred] = rec;
    }
  } catch (e) {
    hubSysLog_('asa-hub:clearance', 'clearance_overlay_failed', '', { status: 500 });
  }
  return out;
}

// Never compare expiries as strings; null means unreadable and must never count as expired.
function clearanceExpiryMs_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return null;
  var m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (!m) m = (function () {
    var u = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return u ? [s, u[3], u[1], u[2]] : null;
  })();
  if (!m) {
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  var y = Number(m[1]), mo = Number(m[2]), day = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || day < 1 || day > 31) return null;
  var dt = new Date(y, mo - 1, day);
  // Round-trip rejects dates the Date constructor silently corrected (Feb 30).
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== day) return null;
  return dt.getTime();
}

// Order: revoked → expired; past expiry → expired; the estate's expired/expiring wins; only 'missing' is lifted.
function clearanceApply_(byPerson) {
  var overlay = clearanceOverlay_();
  var todayMs = (function () {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  })();
  for (var pk in overlay) {
    if (!Object.prototype.hasOwnProperty.call(overlay, pk)) continue;
    var creds = overlay[pk];
    var person = byPerson[pk];
    if (!person) {
      // certMatrixRows_ reads a known person as valid: every column must be stated 'missing' first.
      person = byPerson[pk] = { name: '', certs: {} };
      CLEARANCE_CREDENTIALS.forEach(function (c) {
        person.certs[c] = { status: 'missing', expires: '' };
      });
    }
    CLEARANCE_CREDENTIALS.forEach(function (cred) {
      var rec = creds[cred];
      if (!rec) return;
      if (!person.name && rec.name) person.name = rec.name;
      var cell = person.certs[cred] || { status: 'missing', expires: '' };
      if (rec.decision === 'revoked') {
        person.certs[cred] = { status: 'expired', expires: cell.expires || '' };
        return;
      }
      var expMs = clearanceExpiryMs_(rec.expires_on);
      if (expMs !== null && expMs < todayMs) {
        person.certs[cred] = { status: 'expired', expires: rec.expires_on };
        return;
      }
      var current = String(cell.status || '').toLowerCase();
      if (current === 'expired' || current === 'expiring') return;
      if (current && current !== 'missing') return;
      // Only certMatrixRows_'s words (valid|expiring|expired|missing); the real word rides in `evidence`.
      var verified = rec.decision === 'verified';
      person.certs[cred] = {
        status: verified ? 'valid' : 'expiring',
        expires: rec.expires_on || '',
        evidence: verified ? 'verified' : 'submitted'
      };
    });
  }
  return byPerson;
}

// Drive REST on purpose: the Advanced Drive Service would force every user through consent again.
function clearanceOcrText_(fileId) {
  var copyId = '';
  try {
    var token = ScriptApp.getOAuthToken();
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId + '/copy?fields=id',
      { method: 'post', contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + token },
        payload: JSON.stringify({ mimeType: MimeType.GOOGLE_DOCS }),
        muteHttpExceptions: true });
    if (res.getResponseCode() >= 400) return '';
    copyId = String(JSON.parse(res.getContentText()).id || '');
    if (!copyId) return '';
    return DocumentApp.openById(copyId).getBody().getText();
  } catch (e) {
    return '';
  } finally {
    if (copyId) { try { DriveApp.getFileById(copyId).setTrashed(true); } catch (e2) { } }
  }
}

// Order matters: a labelled expiry always beats "Date Completed" and bare dates.
var CLEARANCE_EXPIRY_LABEL =
  /(?:expir\w*|valid\s+(?:through|until|thru)|good\s+(?:through|thru|until)|renew(?:al)?\s*(?:by|date)?|\bexp\b)[^0-9]{0,20}([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i;
var CLEARANCE_COMPLETED_LABEL =
  /(?:date\s+completed|completion\s+date|completed\s+on)[^0-9]{0,10}([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i;
var CLEARANCE_NOT_EXPIRY =
  /(?:d\.?o\.?b\.?|date\s+of\s+birth|birth\s*date|\biss\b|issued?(?:\s+on)?)[^0-9]{0,10}$/i;

function clearanceIsoDate_(raw) {
  var parts = String(raw).replace(/-/g, '/').split('/');
  var mm = parseInt(parts[0], 10), dd = parseInt(parts[1], 10), yy = parts[2];
  if (yy.length === 2) yy = '20' + yy;
  var yyyy = parseInt(yy, 10);
  if (!(mm >= 1 && mm <= 12) || !(dd >= 1 && dd <= 31) || !(yyyy >= 2000 && yyyy <= 2100)) return '';
  return yyyy + '-' + ('0' + mm).slice(-2) + '-' + ('0' + dd).slice(-2);
}

// '' rather than a guess: a wrong expiry is believed.
function clearanceDateFromText_(text, credential) {
  var s = String(text || '');
  if (!s) return '';

  var m = s.match(CLEARANCE_EXPIRY_LABEL);
  if (m) return clearanceIsoDate_(m[1]);

  if (credential === 'cpr') {
    m = s.match(CLEARANCE_COMPLETED_LABEL);
    if (m) return clearanceIsoDate_(m[1]);
  }

  // An ID's first bare date is the holder's DOB.
  if (credential === 'id') return '';

  var re = /([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/g, hit;
  while ((hit = re.exec(s)) !== null) {
    var before = s.slice(Math.max(0, hit.index - 24), hit.index);
    if (CLEARANCE_NOT_EXPIRY.test(before)) continue;
    var iso = clearanceIsoDate_(hit[1]);
    if (iso) return iso;
  }
  return '';
}


// Kept out of the upload on purpose: OCR is slow and must never cost somebody their document.
HUB_POLICY.clearanceReadDates = {
  file: 'Clearance.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: ['certMatrix'], emits: []
};
HUB_ACTIONS.clearanceReadDates = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var limit = Math.min(parseInt(str_(payload.limit), 10) || 10, 25);
  var sheet = clearanceSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iFile = hdr.indexOf('fileid'), iExp = hdr.indexOf('expireson'),
      iCred = hdr.indexOf('credential'), iKind = hdr.indexOf('evidencekind');
  if (iFile === -1 || iExp === -1) return { status: 500, message: 'staff_clearance is missing columns.' };

  // A saved cursor rotates the queue: unreadable documents must not hold its front forever.
  var order = [];
  for (var r = values.length - 1; r >= 1; r--) {
    var f0 = String(values[r][iFile] || '').trim();
    if (!f0 || String(values[r][iExp] || '').trim()) continue;
    if (iKind !== -1 && String(values[r][iKind] || '').trim() !== 'document') continue;
    order.push(r);
  }
  var cursor = 0;
  try { cursor = parseInt(hubProp_('CLEARANCE_OCR_CURSOR') || '0', 10) || 0; }
  catch (eC) { cursor = 0; }
  if (cursor >= order.length) cursor = 0;
  var ordered = order.slice(cursor).concat(order.slice(0, cursor));

  var read = 0, found = 0;
  var deadline = Date.now() + CLEARANCE_OCR_BUDGET_MS;
  for (var q = 0; q < ordered.length && read < limit; q++) {
    if (Date.now() > deadline) break;
    var row = ordered[q];
    read++;
    var iso = clearanceDateFromText_(clearanceOcrText_(String(values[row][iFile] || '').trim()),
                                     String(values[row][iCred] || '').trim());
    if (!iso) continue;
    sheet.getRange(row + 1, iExp + 1).setValue(iso);
    found++;
  }
  if (order.length) {
    try { hubPropSet_('CLEARANCE_OCR_CURSOR', String((cursor + read) % order.length)); }
    catch (eS) { }
  }
  var left = Math.max(0, order.length - read);
  hubSysLog_(user.email, 'clearance_read_dates',
    read + ' document(s) read, ' + found + ' date(s) found, ' +
    left + ' still waiting for a date', { status: 200 });
  return { status: 200, data: { read: read, found: found, pending: left } };
};

// Editor-only, read-only probe: do the legacy "Staff Docs" folder ids point at anything?
function debugLegacyTaxonomy() {
  var roots = {
    EMPLOYEE_FILES_ROOT: hubId_('PROFILE_USER_DOCS_ROOT'),
    CANDIDATE_DOCS_ROOT: hubId_('LEGACY_CANDIDATE_DOCS_ROOT'),
    ASA_LIFECARE_ROOT: hubId_('LEGACY_ASA_ROOT')
  };
  var out = {};
  for (var label in roots) {
    if (!Object.prototype.hasOwnProperty.call(roots, label)) continue;
    try {
      var folder = DriveApp.getFolderById(roots[label]);
      var kids = folder.getFolders();
      var names = [];
      while (kids.hasNext() && names.length < 12) names.push(kids.next().getName());
      out[label] = { exists: true, name: folder.getName(), subfolders_sample: names };
    } catch (e) {
      out[label] = { exists: false, error: String((e && e.message) || e).slice(0, 120) };
    }
  }
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// Not routed through certsRoute_: that door must keep answering 405 to every write.
HUB_POLICY.clearanceSet = {
  file: 'Clearance.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['certMatrix'], emits: []
};
HUB_ACTIONS.clearanceSet = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var name = str_(payload.person_name);
  var cred = str_(payload.credential).toLowerCase();
  var decision = str_(payload.decision).toLowerCase();
  if (!name) return { status: 400, message: 'person_name is required.' };
  if (CLEARANCE_CREDENTIALS.indexOf(cred) === -1) {
    return { status: 400, message: 'Unknown credential "' + cred + '".' };
  }
  if (['submitted', 'verified', 'revoked'].indexOf(decision) === -1) {
    return { status: 400, message: 'decision must be submitted, verified or revoked.' };
  }
  var fileId = str_(payload.file_id), stateRef = str_(payload.state_ref);
  if (decision === 'verified' && !fileId && !stateRef) {
    return { status: 409,
      message: 'Verified needs the evidence: attach the document or record the state reference.' };
  }
  var now = new Date().toISOString();
  clearanceSheet_().appendRow([
    'CLR_' + randomHex_(16).toUpperCase(),
    clientNameKey_(name), name, str_(payload.candidate_id), cred,
    str_(payload.evidence_kind) || (stateRef ? 'state_registry' : 'document'),
    fileId, stateRef, str_(payload.issued_on), str_(payload.expires_on),
    decision, str_(user.email), now, 'hub:manual'
  ]);
  hubSysLog_(user.email, 'clearance_set',
    name + ' — ' + cred + ' ' + decision, { status: 200 });
  return { status: 200, data: { person: name, credential: cred, decision: decision } };
};
