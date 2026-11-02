var RESUME_INBOX_BATCH = 5;

var RESUME_INBOX_MAX_PAGES = 3;

// A clock, not a count: the relay gives a tool action one 110s try, and the ledger lets the next press resume.
var RESUME_INBOX_BUDGET_MS = 70000;

// Past this the rubric is skipped: a candidate filed unscored beats a batch that times out.
var RESUME_INBOX_SCORE_UNTIL_MS = 45000;

var RESUME_INBOX_UNNAMED = /^(new\s*)?resume(\s*\d+)?$|^stna\s*resume$|^cv$/i;

// Keyed on the person, not the file: the folder is flooded with copies.
var RESUME_INBOX_TAB = 'entity_resume_inbox';
var RESUME_INBOX_COLUMNS = [
  'file_id', 'person_key', 'person_name', 'filename', 'file_modified_at',
  'outcome', 'reason', 'candidate_id', 'text_chars', 'read_at', 'read_by'
];

function resumeInboxSheet_() {
  var sheet = hubTabEnsure_(RESUME_INBOX_TAB, RESUME_INBOX_COLUMNS);
  // Never widen the runtime shim's header: a positional appendRow would land every field one column off.
  if (!sheet.isRuntimeBacked) ensureHeader_(sheet, RESUME_INBOX_COLUMNS);
  return sheet;
}

function resumeInboxLedger_() {
  var by = {};
  try {
    resumeInboxSheet_();
    readTabNormalized_(hubTabWorkbook_(RESUME_INBOX_TAB) || ssOpen_(hubId_('HUB_DB_ID')),
                       RESUME_INBOX_TAB)
      .forEach(function (r) {
        var k = str_(r.personkey);
        if (!k) return;
        var prev = by[k];
        if (!prev || String(str_(r.readat)) >= String(str_(prev.readat))) by[k] = r;
      });
  } catch (e) { return {}; }
  return by;
}

// Never throws: a failed bookkeeping row must not undo a created candidate.
function resumeInboxRecord_(p, outcome, reason, extra, user) {
  try {
    resumeInboxSheet_();
    extra = extra || {};
    hubAppendRow_(RESUME_INBOX_TAB, {
      file_id: str_(p.fileId),
      person_key: str_(p.key),
      person_name: str_(p.name),
      filename: str_(p.filename),
      file_modified_at: str_(p.modifiedTime),
      outcome: str_(outcome),
      reason: str_(reason),
      candidate_id: str_(extra.candidateId),
      text_chars: extra.textChars === undefined ? '' : String(extra.textChars),
      read_at: new Date().toISOString(),
      read_by: str_(user && user.email)
    });
  } catch (e) {
    try {
      hubSysLog_(user && user.email, 'resume_inbox_ledger_failed',
                 str_(p.name) + ': ' + String((e && e.message) || e), { status: 500 });
    } catch (e2) { /* nothing left to try */ }
  }
}

function resumeInboxName_(filename) {
  var n = String(filename || '');
  n = n.replace(/\.(pdf|docx?|rtf|txt)$/i, '');
  n = n.replace(/_\d{8}_\d{6}$/, '');          // the uploader's timestamp
  n = n.replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();
  return n;
}

function resumeInboxKey_(name) {
  return String(name || '').toLowerCase().replace(/[^a-z]/g, '');
}

// The RESUME_EXTRA_FOLDERS Script Property (comma list) replaces this pair when set.
var RESUME_EXTRA_FOLDERS = [
  '1YVyiaMAi4oJ5hUmYGdX1KmXZla6bwHR_',
  '1igORZ8bHmXECSEFByu6eOdhFDCAfGHlkaaCNmTCrm5oGuJeBMLKPyk6R2ZWq_EKREG9oXjJ2'
];

function resumeInboxFolders_() {
  var out = [];
  try { var main = str_(hubId_('RESUME_INBOX_FOLDER_ID')); if (main) out.push(main); } catch (e) {}
  var extra = '';
  try { extra = str_(hubProp_('RESUME_EXTRA_FOLDERS')); } catch (e2) { extra = ''; }
  (extra ? extra.split(',') : RESUME_EXTRA_FOLDERS).forEach(function (id) {
    id = String(id).trim();
    if (id && out.indexOf(id) === -1) out.push(id);
  });
  return out;
}

// One unreadable folder is reported while the others answer; only every folder refusing is a hard error.
function resumeInboxFiles_() {
  var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  var byPerson = {}, seen = 0, truncated = false;
  var folders = resumeInboxFolders_();
  var unreadable = [];
  var readOne = 0;
  folders.forEach(function (folderId) {
    var page = '', pages = 0;
    do {
      var url = 'https://www.googleapis.com/drive/v3/files?' +
        'q=' + encodeURIComponent("'" + folderId + "' in parents and trashed=false") +
        '&fields=' + encodeURIComponent('nextPageToken,files(id,name,modifiedTime,mimeType)') +
        '&orderBy=modifiedTime%20desc&pageSize=1000&supportsAllDrives=true' +
        '&includeItemsFromAllDrives=true' + (page ? '&pageToken=' + encodeURIComponent(page) : '');
      var res = UrlFetchApp.fetch(url, { headers: auth, muteHttpExceptions: true });
      if (res.getResponseCode() >= 400) {
        unreadable.push({ folder: folderId, http: res.getResponseCode() });
        return;
      }
      var body = JSON.parse(res.getContentText());
      (body.files || []).forEach(function (f) {
        seen++;
        var name = resumeInboxName_(f.name);
        var key = resumeInboxKey_(name);
        if (!key) return;
        // Newest wins across folders: one person can have copies in two places.
        if (!byPerson[key]) {
          byPerson[key] = { name: name, key: key, fileId: f.id, filename: f.name,
                            modifiedTime: f.modifiedTime, mimeType: f.mimeType, copies: 1,
                            unnamed: RESUME_INBOX_UNNAMED.test(name) };
        } else {
          byPerson[key].copies++;
          if (String(f.modifiedTime) > String(byPerson[key].modifiedTime)) {
            byPerson[key].fileId = f.id;
            byPerson[key].filename = f.name;
            byPerson[key].modifiedTime = f.modifiedTime;
            byPerson[key].mimeType = f.mimeType;
          }
        }
      });
      page = body.nextPageToken || '';
      pages++;
      if (page && pages >= RESUME_INBOX_MAX_PAGES) { truncated = true; page = ''; }
    } while (page);
    readOne++;
  });
  if (!readOne) {
    return { error: 'None of the ' + folders.length + ' watched resume folder(s) could be read ' +
             '(HTTP ' + unreadable.map(function (u) { return u.http; }).join(', ') + '). Nothing was imported.' };
  }

  var people = [];
  for (var k in byPerson) people.push(byPerson[k]);
  people.sort(function (a, b) { return String(b.modifiedTime).localeCompare(String(a.modifiedTime)); });
  return { people: people, filesSeen: seen, truncated: truncated,
           foldersRead: readOne, unreadable: unreadable };
}

function resumeInboxKnown_() {
  var known = {};
  try {
    listRows_('candidates', {}).forEach(function (c) {
      var k = resumeInboxKey_(c.candidate_name || c.candidatename || c.name);
      if (k) known[k] = { where: 'board', status: str_(c.status) };
    });
  } catch (e) { /* named in the answer below */ }
  try {
    readTabNormalized_(hubTabWorkbook_(TALENT_CANDIDATES_TAB) || ssOpen_(hubId_('HUB_DB_ID')),
                       TALENT_CANDIDATES_TAB)
      .forEach(function (c) {
        var k = resumeInboxKey_(c.candidatename);
        if (k && !known[k]) known[k] = { where: 'board', status: str_(c.status) };
      });
  } catch (e2) { /* same */ }
  try {
    listRows_('people', {}).forEach(function (p) {
      var k = resumeInboxKey_(p.name);
      if (k && !known[k]) known[k] = { where: 'roster', status: str_(p.status) };
    });
  } catch (e3) { /* same */ }
  return known;
}

HUB_POLICY.resumeInboxScan = {
  file: 'ResumeInbox.gs', lane: 'read', store: 'drive',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.resumeInboxScan = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var got = resumeInboxFiles_();
  if (got.error) return { status: 503, message: got.error };
  var known = resumeInboxKnown_();
  var ledger = resumeInboxLedger_();

  var fresh = [], seenBefore = [], unnamed = [], readBefore = [];
  got.people.forEach(function (p) {
    var row = { name: p.name, fileId: p.fileId, filename: p.filename,
                modifiedTime: p.modifiedTime, copies: p.copies };
    if (p.unnamed) { unnamed.push(row); return; }
    // Already-read files stay listed: the ones that never became cards are exactly what a person must see.
    var past = ledger[p.key];
    if (past) {
      row.outcome = str_(past.outcome);
      row.reason = str_(past.reason);
      row.readAt = str_(past.readat);
      row.candidateId = str_(past.candidateid);
      readBefore.push(row);
      return;
    }
    var hit = known[p.key];
    if (hit) { row.knownIn = hit.where; row.status = hit.status; seenBefore.push(row); return; }
    // New on the board is not new to the company: surface documents already on file.
    if (typeof staffDocsFor_ === 'function') {
      var filed = null;
      try { filed = staffDocsFor_(p.name); } catch (eD) { filed = null; }
      if (filed && filed.docs && filed.docs.length) {
        row.docsOnFile = filed.docs.length;
        row.docTypes = filed.docs.map(function (d) { return d.type; }).join(', ');
      }
    }
    fresh.push(row);
  });

  return { status: 200, data: {
    fresh: fresh, alreadyKnown: seenBefore, unnamed: unnamed,
    readBefore: readBefore,
    filesSeen: got.filesSeen,
    foldersRead: got.foldersRead, unreadable: got.unreadable,
    truncated: !!got.truncated,
    batch: RESUME_INBOX_BATCH,
    message: fresh.length
      ? fresh.length + ' new résumé(s) waiting. ' + seenBefore.length +
        ' already on the board or the roster' +
        (readBefore.length ? ', ' + readBefore.length + ' read before' : '') +
        (unnamed.length ? ', ' + unnamed.length + ' file(s) name nobody' : '') + '.'
      : 'Nothing new in the folder.' +
        (readBefore.length ? ' ' + readBefore.length + ' were read on an earlier press.' : '') +
        (got.truncated ? ' (The scan stopped after ' + got.filesSeen + ' files.)' : '')
  } };
};

HUB_POLICY.resumeInboxImport = {
  file: 'ResumeInbox.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: ['candidates', 'phoneScreens'], emits: [],
  params: {
    limit: { type: 'number' },
    fileIds: { type: 'string' }
  }
};
HUB_ACTIONS.resumeInboxImport = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};
  var limit = Math.max(1, Math.min(Number(payload.limit) || RESUME_INBOX_BATCH, 10));

  var got = resumeInboxFiles_();
  if (got.error) return { status: 503, message: got.error };
  var known = resumeInboxKnown_();
  var ledger = resumeInboxLedger_();

  var wanted = str_(payload.fileIds);
  var picks = [];
  got.people.forEach(function (p) {
    if (picks.length >= limit) return;
    if (p.unnamed) return;
    // An explicit pick overrules the ledger.
    if (wanted) { if (wanted.indexOf(p.fileId) !== -1) picks.push(p); return; }
    if (!known[p.key] && !ledger[p.key]) picks.push(p);
  });
  if (!picks.length) {
    return { status: 200, data: { imported: [], skipped: [], message: 'Nothing new to import.' } };
  }

  var imported = [], skipped = [], startedAt = new Date().getTime(), ranOut = 0;
  var elapsed = function () { return new Date().getTime() - startedAt; };

  picks.forEach(function (p) {
    if (elapsed() > RESUME_INBOX_BUDGET_MS) { ranOut++; return; }
    var text = '', why = { reason: '' };
    try { text = hubExtractResumeText_(p.fileId, why); }
    catch (e) { text = ''; why.reason = String((e && e.message) || e); }
    if (!text) {
      var whyText = why.reason || 'the file could not be read as text';
      if (p.mimeType) whyText += ' [' + p.mimeType + ']';
      skipped.push({ name: p.name, fileId: p.fileId, why: whyText });
      resumeInboxRecord_(p, 'unreadable', whyText, { textChars: 0 }, user);
      return;
    }
    var parsed = hubParseResumeIdentity_(text);
    var first = str_(parsed.first_name), last = str_(parsed.last_name);
    // The filename may supply the name only; contact details are never guessed from it.
    if (!first || !last) {
      var parts = p.name.split(/\s+/);
      if (parts.length >= 2) { first = first || parts[0]; last = last || parts[parts.length - 1]; }
    }
    // A dialable number is the floor, the e-mail is not: de-dupe and the contact guard both work off the digits.
    if (str_(parsed.phone).replace(/\D/g, '').length < 7) {
      var whyContact = 'no usable phone number in the résumé — a card without one ' +
                       'cannot be de-duplicated or contact-guarded';
      skipped.push({ name: p.name, fileId: p.fileId, why: whyContact });
      resumeInboxRecord_(p, 'no contact', whyContact, { textChars: text.length }, user);
      return;
    }
    var scored = { fields: {}, status: 'not attempted', error: '', raw: '', hash: '', recommendation: '' };
    if (elapsed() > RESUME_INBOX_SCORE_UNTIL_MS) {
      scored.status = 'not scored — the pass was running out of time';
    } else if (typeof rubricAnalyze_ === 'function') {
      try { scored = rubricAnalyze_(text); } catch (eR) { scored.status = 'rubric threw'; scored.error = String((eR && eR.message) || eR); }
    }
    // The rubric only fills blanks, never overriding the parse the guard and de-dupe were tuned on.
    var city = str_(parsed.city) || str_(scored.fields.city);
    var state = str_(parsed.state) || str_(scored.fields.state);

    var made = HUB_ACTIONS.resumeIntakeCommit({
      first_name: first, last_name: last,
      phone: parsed.phone, email: parsed.email,
      city: city, state: state,
      resume_link: 'https://drive.google.com/file/d/' + p.fileId + '/view',
      filename: p.filename
    }, user);
    if (made && made.status === 200 && made.data) {
      var cid = str_(made.data.candidate_id);
      if (cid && typeof rubricWrite_ === 'function') {
        try { rubricWrite_(cid, scored, user, p.fileId); }
        catch (eW) { hubSysLog_(user.email, 'resume_rubric_write_failed', cid + ': ' + String((eW && eW.message) || eW), { status: 500 }); }
      }
      // Bust again after the rubric write, or the re-cached state lacks the score for the whole TTL.
      try { hubBustTalentCache_(); } catch (eB) {}
      imported.push({ name: p.name, candidate_id: cid,
                      matchedExisting: !!made.data.matched_existing,
                      score: str_(scored.fields.composite_score),
                      // Shown only, never written to decision_status: a person still presses Advance.
                      recommendation: scored.recommendation,
                      scoring: scored.status });
      resumeInboxRecord_(p, made.data.matched_existing ? 'attached' : 'imported',
                         str_(scored.status) === 'ok' ? '' : 'not scored: ' + str_(scored.status),
                         { candidateId: cid, textChars: text.length }, user);
    } else {
      var whyRefused = str_(made && made.message) || 'the create door refused';
      skipped.push({ name: p.name, why: whyRefused });
      resumeInboxRecord_(p, 'refused', whyRefused, { textChars: text.length }, user);
    }
  });

  hubSysLog_(user.email, 'resume_inbox_import',
             imported.length + ' imported, ' + skipped.length + ' skipped, ' +
             ranOut + ' out of time (' + Math.round(elapsed() / 1000) + 's)', { status: 200 });
  return { status: 200, data: {
    imported: imported, skipped: skipped,
    outOfTime: ranOut, seconds: Math.round(elapsed() / 1000),
    message: imported.length + ' imported' +
             (skipped.length ? ', ' + skipped.length + ' left for a person' : '') + '.' +
             (ranOut ? ' ' + ranOut + ' did not start — the pass ran out of time. Press again to continue.' : '')
  } };
};
