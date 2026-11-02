function hubExtractResumeText_(fileId, why) {
  var note = function (msg) { if (why) why.reason = msg; };
  var token = ScriptApp.getOAuthToken();
  var auth = { Authorization: 'Bearer ' + token };
  var copy = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId +
      '/copy?supportsAllDrives=true',
    { method: 'post', contentType: 'application/json', headers: auth,
      payload: JSON.stringify({ mimeType: 'application/vnd.google-apps.document', name: 'hub-extract-tmp' }),
      muteHttpExceptions: true });
  if (copy.getResponseCode() >= 400) {
    var body = String(copy.getContentText() || '');
    var msg = '';
    try { msg = String(((JSON.parse(body) || {}).error || {}).message || ''); } catch (eP) { msg = ''; }
    note(hiringRenderMail_(bookText_('Strings', 'resume.fail.convert_refused', ''),
                           { code: String(copy.getResponseCode()),
                             detail: msg ? ': ' + msg : '' }));
    return '';
  }
  var docId = JSON.parse(copy.getContentText()).id;
  var text = '';
  try {
    var exp = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + docId + '/export?mimeType=text%2Fplain',
      { headers: auth, muteHttpExceptions: true });
    if (exp.getResponseCode() < 400) text = exp.getContentText();
    else note(hiringRenderMail_(bookText_('Strings', 'resume.fail.export', ''),
                                { code: String(exp.getResponseCode()) }));
  } catch (err) {
    note(hiringRenderMail_(bookText_('Strings', 'resume.fail.export_threw', ''),
                           { error: String((err && err.message) || err) }));
  }
  try {
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + docId +
      '?supportsAllDrives=true',
      { method: 'delete', headers: auth, muteHttpExceptions: true });
  } catch (err) { /* temp doc left in trash-able state; non-fatal */ }
  var out = String(text || '').slice(0, 20000);
  if (!out.trim()) {
    note(why && why.reason ? why.reason
      : bookText_('Strings', 'resume.fail.no_text', ''));
    return '';
  }
  return out;
}

// Deterministic, never a model: the identity comes from the resume, not the session.
function hubParseResumeIdentity_(text) {
  var out = { first_name: '', last_name: '', phone: '', email: '', city: '', state: '' };
  var emailM = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (emailM) out.email = emailM[0].toLowerCase();
  var phoneMs = text.match(/(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g) || [];
  for (var p = 0; p < phoneMs.length; p++) {
    var digits = phoneMs[p].replace(/[^\d]/g, '').replace(/^1/, '');
    if (digits.length === 10 && SHARED_LINE_DIGITS.indexOf(digits) === -1) {
      out.phone = digits;
      break;
    }
  }
  var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(String);
  for (var i = 0; i < Math.min(lines.length, 8); i++) {
    var l = lines[i];
    if (l.indexOf('@') !== -1 || /\d{3}/.test(l) || l.length > 48) continue;
    var words = l.split(/\s+/);
    if (words.length >= 2 && words.length <= 4 &&
        words.every(function (w) { return /^[A-Za-zÀ-ÿ'.\-]+$/.test(w); })) {
      out.first_name = words[0].replace(/[^A-Za-zÀ-ÿ'\-]/g, '');
      out.last_name = words.slice(1).join(' ');
      break;
    }
  }
  for (var j = 0; j < Math.min(lines.length, 15); j++) {
    var cs = lines[j].match(/([A-Za-z .]{2,30}),\s*([A-Z]{2})\b/);
    if (cs) { out.city = cs[1].trim(); out.state = cs[2]; break; }
  }
  return out;
}

function hubFindDuplicate_(digits, email) {
  if (digits && SHARED_LINE_DIGITS.indexOf(digits) !== -1) digits = '';
  var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB);
  for (var i = 0; i < rows.length; i++) {
    var c = rows[i];
    var cid = str_(c.candidateid);
    if (!cid || TALENT_EXCLUDE_IDS.indexOf(cid) !== -1) continue;
    if (str_(c.archived).toLowerCase() === 'true') continue;
    // An off-board card never absorbs a new intake; re-applicants get a fresh card.
    if (!talentStage_(c.status)) continue;
    var cDigits = str_(c.phone).replace(/\D/g, '').replace(/^1/, '');
    if (SHARED_LINE_DIGITS.indexOf(cDigits) !== -1) cDigits = '';
    if ((digits && cDigits === digits) || (email && str_(c.email).toLowerCase() === email)) {
      return { id: cid, name: str_(c.candidatename) };
    }
  }
  return null;
}

function hubAttachResumeLink_(cid, url, user) {
  var sheet = hubSheet_(TALENT_CANDIDATES_TAB);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var iId = hdr.indexOf('candidate_id'), iLink = hdr.indexOf('resume_link');
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][iId]).trim() !== cid) continue;
    if (!String(values[r][iLink] || '').trim()) {
      sheet.getRange(r + 1, iLink + 1).setValue(url);
    }
    return true;
  }
  return false;
}

/** Parse a résumé and answer what is missing, so the form can say so up front instead of refusing at the end. */
HUB_POLICY.resumeParse = {
  file: 'ResumeIntake.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.resumeParse = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var stored = hubDriveFileObj_(payload, 'resume.pdf', '', user);
  var text = hubExtractResumeText_(stored.id);
  var parsed = text ? hubParseResumeIdentity_(text) : { first_name: '', last_name: '', phone: '', email: '', city: '', state: '' };
  var complete = !!(parsed.first_name && parsed.last_name && parsed.phone && parsed.email);
  return { status: 200, data: {
    resume_link: stored.url,
    filename: str_(payload.filename) || 'resume.pdf',
    extracted: !!text,
    complete: complete,
    parsed: parsed
  } };
};

/** Attach the résumé to the matched candidate, chosen on a duplicate match. */
HUB_POLICY.resumeAttach = {
  file: 'ResumeIntake.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['candidates'], emits: []
};
HUB_ACTIONS.resumeAttach = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  var link = str_(payload.resume_link);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid) || !link) {
    return { status: 400, message: bookText_('Strings', 'refuse.resume.attach_args', '') };
  }
  var ok = hubAttachResumeLink_(cid, link, user);
  hubBustTalentCache_();
  if (ok) {
    try {
      if (typeof rubricEnsureForCandidate_ === 'function') {
        SpreadsheetApp.flush();
        rubricEnsureForCandidate_(cid, user, rubricFileId_(link));
      }
    } catch (eSc) { /* the nota can wait */ }
  }
  return ok ? { status: 200, data: { candidate_id: cid, attached: true } }
            : { status: 404, message: hiringRenderMail_(
                bookText_('Strings', 'refuse.no_candidate', ''), { id: cid }) };
};

/** A parsed résumé becomes a candidate: first name, last name and phone are the floor, the e-mail is wanted and never demanded. */
HUB_POLICY.resumeIntakeCommit = {
  file: 'ResumeIntake.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: ['candidates', 'phoneScreens'], emits: []
};
HUB_ACTIONS.resumeIntakeCommit = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var first = str_(payload.first_name), last = str_(payload.last_name);
  var phone = str_(payload.phone), email = str_(payload.email).toLowerCase();
  var link = str_(payload.resume_link);
  var identity = hubIntakeIdentityCheck_(first, last, phone, email);
  if (!identity.ok) return { status: 400, message: identity.message };
  var digits = phone.replace(/\D/g, '').replace(/^1/, '');
  var dup = hubFindDuplicate_(digits, email);
  if (dup) {
    // No silent absorption: report the match and let a person choose.
    return { status: 200, data: { candidate_id: dup.id, candidate_name: dup.name,
             matched_existing: true } };
  }
  var name = (first + ' ' + last).trim();
  // A staff contact never opens a card: checked after the duplicate check and before the row exists.
  var guard = contactGuard_(phone, email, { name: name, trusted: true });
  if (guard && guard.severity !== 'warn' && cgEnforces_('auth')) {
    if (guard.severity === 'unverified') {
      return { status: 503, message: contactGuardMessage_(guard) };
    }
    if (!cgOverrideAllowed_(user, payload)) {
      return { status: 409, message: contactGuardMessage_(guard), staff_conflict: true };
    }
    cgLogOverride_(user, payload, name, guard);
  }
  var id = 'CAN_' + randomHex_(20).toUpperCase();
  var now = new Date().toISOString();
  hubAppendRow_(TALENT_CANDIDATES_TAB, {
    candidate_id: id, candidate_name: name, first_name: first, last_name: last,
    phone: phone, email: email, city: str_(payload.city), state: str_(payload.state),
    status: 'New', resume_link: link,
    created_at: now, updated_at: now, created_by: 'asa-hub-resume:' + user.email
  });
  hubAppendRow_(TALENT_RESUME_TAB, {
    candidate_id: id,
    summary: hiringRenderMail_(bookText_('Strings', 'resume.on_file_summary', ''),
                               { file: str_(payload.filename) ||
                                       bookText_('Strings', 'resume.unnamed', '') }),
    created_at: now, updated_at: now, created_by: 'asa-hub:' + user.email
  });
  if (typeof commsIsOperatorCard_ === 'function' &&
      commsIsOperatorCard_({ phone: phone, email: email })) {
    try { commsPurgeOperatorScreens_(id, user); } catch (ePg) { /* never blocks intake */ }
  }
  hubBustTalentCache_();
  try {
    if (typeof rubricEnsureForCandidate_ === 'function') {
      SpreadsheetApp.flush();
      rubricEnsureForCandidate_(id, user, str_(payload.file_id) || rubricFileId_(link));
    }
  } catch (eSc) { /* the nota can wait */ }
  // Queued only after the row exists: the decoder must anchor on the candidate id, never a name.
  try {
    if (typeof pipelineQueueDecode_ === 'function') {
      var resumeFile = str_(payload.file_id) ||
        (typeof rubricFileId_ === 'function' ? str_(rubricFileId_(link)) : '');
      pipelineQueueDecode_(resumeFile, id, name, 'resume',
                           str_(payload.filename) || 'resume', user);
    }
  } catch (eQ) { /* the card exists; the reading can be asked for again */ }
  return { status: 200, data: { candidate_id: id, candidate_name: name, matched_existing: false } };
};

// Split on purpose: Google drops long anonymous POSTs, so store answers fast and the SPA polls extract.
HUB_POLICY.resumeStore = {
  file: 'ResumeIntake.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
/** Split on purpose: Google's front drops long anonymous POSTs and OCR takes 30-60s, so this only stores the PDF and resumeExtract does the slow work. */
HUB_ACTIONS.resumeStore = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var stored = hubDriveFileObj_(payload, 'resume.pdf', '', user);
  return { status: 200, data: { file_id: stored.id, resume_link: stored.url,
           filename: str_(payload.filename) || 'resume.pdf' } };
};

/** Cached per file id: the same PDF is never OCR'd twice. */
HUB_POLICY.resumeExtract = {
  file: 'ResumeIntake.gs', lane: 'read', store: 'drive',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.resumeExtract = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var fid = str_(payload.file_id);
  if (!fid) return { status: 400, message: bookText_('Strings', 'refuse.resume.file_id', '') };
  var cache = CacheService.getScriptCache();
  var done = cache.get('rpd_' + fid);
  if (done) return { status: 200, data: JSON.parse(done) };
  if (cache.get('rpw_' + fid)) return { status: 200, data: { working: true } };
  cache.put('rpw_' + fid, '1', 300);
  var text = '';
  try { text = hubExtractResumeText_(fid); } catch (err) { /* parsed empty */ }
  var parsed = text ? hubParseResumeIdentity_(text)
                    : { first_name: '', last_name: '', phone: '', email: '', city: '', state: '' };
  var out = { working: false, extracted: !!text,
              complete: !!(parsed.first_name && parsed.last_name && parsed.phone && parsed.email),
              parsed: parsed };
  cache.put('rpd_' + fid, JSON.stringify(out), 600);
  cache.remove('rpw_' + fid);
  return { status: 200, data: out };
};
