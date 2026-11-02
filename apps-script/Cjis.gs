var CJIS_CACHE_KEY = 'cjis_folder_index_v1';
var CJIS_CACHE_SECONDS = 900;
var CJIS_MAX_PAGES = 4;

// Must match the résumé inbox and staff archive keys, so one person keys one way.
function cjisKey_(name) {
  return String(name || '').toLowerCase().replace(/[^a-z]/g, '');
}

// Same chain as the request letter's docs folder; CJIS_FOLDER_ID is only the fallback.
function cjisFolderId_() {
  var id = '';
  try { id = String(hubProp_(HIRING_ORIGINAL_DOCS_PROP) || ''); } catch (e1) { id = ''; }
  if (!id) { try { id = String(hubId_('COMPLIANCE_SHARED_FOLDER_ID') || ''); } catch (e2) { id = ''; } }
  if (!id) { try { id = String(hubId_('CJIS_FOLDER_ID') || ''); } catch (e3) { id = ''; } }
  return id;
}

function cjisFolderIds_() {
  var out = [];
  var main = cjisFolderId_();
  if (main) out.push(main);
  try {
    var extra = '';
    try { extra = str_(hubProp_('RESUME_EXTRA_FOLDERS')); } catch (e0) { extra = ''; }
    var list = extra ? extra.split(',')
      : (typeof RESUME_EXTRA_FOLDERS !== 'undefined' ? RESUME_EXTRA_FOLDERS : []);
    list.forEach(function (id) {
      id = String(id).trim();
      if (id && out.indexOf(id) === -1) out.push(id);
    });
  } catch (e) {}
  return out;
}

function cjisFolderIndex_() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(CJIS_CACHE_KEY);
    if (hit) return JSON.parse(hit);
  } catch (e) {}

  var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  var byPerson = {}, seen = 0, truncated = false, unparsed = [];
  var unreadable = [], readOne = 0;
  cjisFolderIds_().forEach(function (folderId) {
    var page = '', pages = 0;
    do {
      var url = 'https://www.googleapis.com/drive/v3/files?' +
        'q=' + encodeURIComponent("'" + folderId + "' in parents and trashed=false") +
        '&fields=' + encodeURIComponent('nextPageToken,files(id,name,modifiedTime,mimeType)') +
        '&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true' +
        (page ? '&pageToken=' + encodeURIComponent(page) : '');
      var res = UrlFetchApp.fetch(url, { headers: auth, muteHttpExceptions: true });
      if (res.getResponseCode() >= 400) {
        unreadable.push({ folder: folderId, http: res.getResponseCode() });
        return;
      }
      var body = JSON.parse(res.getContentText());
      (body.files || []).forEach(function (f) {
        seen++;
        var name = cjisNameFrom_(f.name);
        var key = cjisKey_(name);
        if (!key) { unparsed.push(f.name); return; }
        var prev = byPerson[key];
        if (!prev || String(f.modifiedTime) > String(prev.at)) {
          byPerson[key] = { name: name, fileId: f.id, filename: f.name,
                            at: f.modifiedTime, mimeType: f.mimeType };
        }
      });
      page = body.nextPageToken || '';
      pages++;
      if (page && pages >= CJIS_MAX_PAGES) { truncated = true; page = ''; }
    } while (page);
    readOne++;
  });
  if (!readOne) {
    return { error: 'None of the watched CJIS folder(s) could be read (HTTP ' +
             unreadable.map(function (u) { return u.http; }).join(', ') + ').' };
  }

  var out = { people: byPerson, filesSeen: seen, truncated: truncated,
              unparsed: unparsed.slice(0, 20), unparsedCount: unparsed.length,
              unreadable: unreadable, error: '' };
  try { cache.put(CJIS_CACHE_KEY, JSON.stringify(out), CJIS_CACHE_SECONDS); }
  catch (e2) {}
  return out;
}

// A filename with no readable name is reported, never guessed onto someone.
function cjisNameFrom_(filename) {
  var raw = String(filename || '').replace(/\.[A-Za-z0-9]{2,5}$/, '');
  // The folder's `<Name> - <Document type> - <YYYYMMDD>` convention first, as StaffDocs.gs reads it.
  var tries = [];
  var dash = raw.split(' - ');
  if (dash.length > 1) tries.push(dash[0]);
  tries.push(raw);

  for (var t = 0; t < tries.length; t++) {
    var got = cjisCleanName_(tries[t]);
    if (got) return got;
  }
  return '';
}

function cjisCleanName_(text) {
  var n = String(text || '');
  // Separators first: `_` is a word character, so a \b stopword rule would miss it.
  n = n.replace(/[_\-.]+/g, ' ');
  var comma = n.match(/^\s*([A-Za-zÀ-ÿ'’]+)\s*,\s*([A-Za-zÀ-ÿ'’]+)/);
  if (comma) n = comma[2] + ' ' + comma[1] + ' ' + n.replace(comma[0], ' ');
  n = n.replace(CJIS_NOT_A_NAME, ' ');
  n = n.replace(/\b\d{1,2}[\s\/]\d{1,2}[\s\/]\d{2,4}\b/g, ' ');
  n = n.replace(/\d+/g, ' ');
  n = n.replace(/[^A-Za-zÀ-ÿ'’ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  var words = n.split(' ').filter(function (w) { return w.length > 1; });
  // Two words or nothing: a single word matches the wrong person too often.
  return words.length >= 2 ? words.slice(0, 3).join(' ') : '';
}

var CJIS_NOT_A_NAME = new RegExp('\\b(' + [
  'cjis', 'bci', 'fbi', 'rapback', 'background', 'report', 'reports', 'check',
  'checks', 'result', 'results', 'copy', 'of', 'the', 'and',
  'dodd', 'training', 'certificate', 'certificates', 'cert', 'certs',
  'cpr', 'st', 'aid', 'first', 'hs', 'diploma', 'transcripts', 'ged',
  'drivers', 'driver', 'license', 'licence', 'oh', 'id', 'social', 'security',
  'card', 'birth', 'car', 'insurance', 'med', 'del', 'mandt', 'mandtt'
].join('|') + ')\\b', 'gi');

function cjisCandidates_() {
  var out = [];
  try {
    var ss = ssOpen_(hubId_('HUB_DB_ID'));
    var cands = readTabNormalized_(ss, TALENT_CANDIDATES_TAB);
    var analyses = readTabNormalized_(ss, TALENT_RESUME_TAB);
    var byId = {};
    analyses.forEach(function (a) { var c = str_(a.candidateid); if (c) byId[c] = a; });
    var docs = {};
    try { docs = onboardingDocIndex_() || {}; } catch (eD) { docs = {}; }
    cands.forEach(function (c) {
      if (str_(c.archived).toLowerCase() === 'true') return;
      var id = str_(c.candidateid);
      if (!id) return;
      var a = byId[id] || {};
      var mine = docs[id] || {};
      var bg = mine['background_check'];
      // A rehearsal card must never take a real person's report.
      var isTest = false;
      try {
        isTest = (typeof commsIsTestCandidate_ === 'function') ? commsIsTestCandidate_(c) : false;
      } catch (eT) { isTest = false; }
      out.push({
        id: id, name: str_(c.candidatename), status: str_(c.status), isTest: isTest,
        cjisStatus: str_(a.cjisstatus), cjisUrl: str_(a.cjisreporturl),
        hasDoc: !!(bg && (bg.status === 'uploaded' || bg.status === 'verified'))
      });
    });
  } catch (e) { return { error: String((e && e.message) || e), rows: [] }; }
  return { error: '', rows: out };
}

HUB_POLICY.cjisScan = {
  file: 'Cjis.gs', lane: 'read', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'], invalidates: [], emits: []
};
HUB_ACTIONS.cjisScan = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var idx = cjisFolderIndex_();
  if (idx.error) return { status: 503, message: idx.error + ' Nothing was read.' };
  var who = cjisCandidates_();
  if (who.error) return { status: 503, message: 'The board could not be read: ' + who.error };

  var found = [], already = [], none = [], rehearsals = [];
  who.rows.forEach(function (c) {
    var hit = idx.people[cjisKey_(c.name)];
    var row = { candidate_id: c.id, name: c.name, status: c.status,
                cjis_status: c.cjisStatus, has_doc: c.hasDoc };
    if (c.isTest) { if (hit) { row.filename = hit.filename; rehearsals.push(row); } return; }
    if (!hit) { none.push(row); return; }
    row.filename = hit.filename;
    row.file_url = 'https://drive.google.com/file/d/' + hit.fileId + '/view';
    row.at = hit.at;
    if (c.cjisUrl && c.hasDoc) { already.push(row); return; }
    found.push(row);
  });

  return { status: 200, data: {
    found: found, already: already, without: none, rehearsals: rehearsals,
    filesSeen: idx.filesSeen, truncated: !!idx.truncated,
    unparsed: idx.unparsed, unparsedCount: idx.unparsedCount,
    message: found.length
      ? found.length + ' report(s) on file that this platform did not know about. ' +
        already.length + ' already attached, ' + none.length + ' with nothing in the folder.' +
        (idx.unparsedCount ? ' ' + idx.unparsedCount + ' file(s) name nobody — open those by hand.' : '')
      : 'Nothing new: ' + already.length + ' already attached, ' + none.length +
        ' with no report in the folder.'
  } };
};

HUB_POLICY.cjisApply = {
  file: 'Cjis.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: ['candidates', 'onboarding'], emits: [],
  params: { candidate_ids: { type: 'string' } }
};
HUB_ACTIONS.cjisApply = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var idx = cjisFolderIndex_();
  if (idx.error) return { status: 503, message: idx.error + ' Nothing was written.' };
  var who = cjisCandidates_();
  if (who.error) return { status: 503, message: 'The board could not be read: ' + who.error };

  var wanted = str_(payload && payload.candidate_ids);
  var done = [], skipped = [];
  who.rows.forEach(function (c) {
    if (wanted && wanted.indexOf(c.id) === -1) return;
    if (c.isTest) { skipped.push({ name: c.name, why: 'a test card — no report is attached' }); return; }
    var hit = idx.people[cjisKey_(c.name)];
    if (!hit) return;
    if (c.cjisUrl && c.hasDoc) { skipped.push({ name: c.name, why: 'already attached' }); return; }
    var url = 'https://drive.google.com/file/d/' + hit.fileId + '/view';

    // Attach only: Clear/Verified green the checklist, and no filename may write them.
    var wrote = cjisAttach_(c.id, url, hit.filename, user);
    if (wrote.error) { skipped.push({ name: c.name, why: wrote.error }); return; }
    done.push({ candidate_id: c.id, name: c.name, filename: hit.filename, file_url: url });
  });

  hubSysLog_(user.email, 'cjis_folder_apply',
             done.length + ' attached, ' + skipped.length + ' skipped', { status: 200 });
  return { status: 200, data: {
    attached: done, skipped: skipped,
    message: done.length
      ? done.length + ' report(s) attached and marked on file. ' +
        'None was marked Clear — a person still reads the report and decides.'
      : 'Nothing to attach.'
  } };
};

function cjisAttach_(cid, url, filename, user) {
  try {
    var sheet = hubSheet_(TALENT_RESUME_TAB);
    var values = sheet.getDataRange().getValues();
    var hdr = values[0].map(function (h) { return String(h).trim(); });
    var iId = hdr.indexOf('candidate_id'), iSt = hdr.indexOf('cjis_status'),
        iUrl = hdr.indexOf('cjis_report_url');
    if (iId === -1 || iSt === -1 || iUrl === -1) {
      return { error: 'entity_resume_analyses is missing the cjis columns' };
    }
    var at = 0;
    for (var r = 1; r < values.length; r++) if (String(values[r][iId]).trim() === cid) at = r + 1;
    if (at) {
      // Never overwrite a verdict a person already recorded.
      var st = String(values[at - 1][iSt] || '').trim().toLowerCase();
      if (!st || st === 'pending' || st === 'on file') sheet.getRange(at, iSt + 1).setValue('On file');
      if (!String(values[at - 1][iUrl] || '').trim()) sheet.getRange(at, iUrl + 1).setValue(url);
    } else {
      hubAppendRow_(TALENT_RESUME_TAB, {
        candidate_id: cid, cjis_status: 'On file', cjis_report_url: url,
        created_at: new Date().toISOString(), created_by: 'asa-hub:cjis-folder'
      });
    }
    try { hubBustTalentCache_(); } catch (eB) {}
  } catch (e) { return { error: String((e && e.message) || e) }; }

  try {
    hubAppendRow_(DOCS_TAB, {
      doc_row_id: 'DOC_' + randomHex_(16).toUpperCase(),
      candidate_id: cid, doc_id: 'background_check',
      doc_label: 'Background check (BCI)',
      status: 'uploaded', review_status: 'pending',
      file_url: url, file_name: str_(filename),
      uploaded_by: 'asa-hub:cjis-folder:' + str_(user && user.email),
      uploaded_at: new Date().toISOString(),
      notes: 'found in the CJIS folder — the report exists; the verdict is still a person\'s'
    });
  } catch (e2) {
    hubSysLog_('asa-hub:cjis', 'cjis_doc_record_failed',
               cid + ': ' + String((e2 && e2.message) || e2), { status: 500 });
  }
  return { error: '' };
}

// ---- the sweep: the folder is the only observable, so it is looked at on machine passes ----
var CJIS_SWEEP_FLAG = 'cjis_folder_sweep_ran';
var CJIS_SWEEP_SECONDS = 1800;

function cjisSweepActor_() {
  return { role: 'admin', email: 'cjis-folder@service.local', id: 'SVC_CJIS_FOLDER' };
}

function cjisFolderSweepMaybe_() {
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get(CJIS_SWEEP_FLAG)) return;
  cache.put(CJIS_SWEEP_FLAG, '1', CJIS_SWEEP_SECONDS);
  try { cjisFolderSweepRun_(); }
  catch (e) {
    hubSysLog_('auto-cjis-folder', 'cjis_folder_sweep_error',
               String((e && e.message) || e), { status: 500 });
  }
}

// A candidate whose cjis_filed journey line exists is never announced again.
function cjisFolderSweepRun_() {
  var idx = cjisFolderIndex_();
  if (idx.error) {
    // An unreadable folder must never read as an empty one.
    hubSysLog_('auto-cjis-folder', 'cjis_folder_unreadable', idx.error, { status: 503 });
    return { error: idx.error };
  }
  var who = cjisCandidates_();
  if (who.error) return { error: who.error };

  var told = {};
  try {
    var seen = (typeof journeyFor_ === 'function') ? journeyFor_('') : [];
    (seen || []).forEach(function (l) {
      if (l.step === 'cjis_filed') told[l.candidate_id] = true;
    });
  } catch (eJ) { told = {}; }

  var actor = cjisSweepActor_();
  var attached = [], matchedNames = {};
  who.rows.forEach(function (c) {
    var hit = idx.people[cjisKey_(c.name)];
    if (!hit) return;
    matchedNames[cjisKey_(c.name)] = true;
    if (c.isTest) return;
    if (c.cjisUrl && c.hasDoc) return;
    var url = 'https://drive.google.com/file/d/' + hit.fileId + '/view';
    var wrote = cjisAttach_(c.id, url, hit.filename, actor);
    if (wrote.error) {
      hubSysLog_('auto-cjis-folder', 'cjis_attach_failed',
                 c.id + ' — ' + wrote.error, { status: 500 });
      return;
    }
    attached.push({ candidate_id: c.id, name: c.name, filename: hit.filename, url: url });
    if (typeof journeyLog_ === 'function') {
      journeyLog_({ candidate_id: c.id, name: c.name, step: 'cjis_filed',
                    channel: 'drive', to: '', ok: true, ref: str_(hit.fileId),
                    detail: 'found in the CJIS folder as "' + str_(hit.filename) +
                            '" and attached — the verdict is still a person’s',
                    by: 'asa-hub:cjis-folder' });
    }
  });

  var orphans = 0;
  try {
    Object.keys(idx.people || {}).forEach(function (k) { if (!matchedNames[k]) orphans++; });
  } catch (eO) { orphans = 0; }

  var fresh = attached.filter(function (a) { return !told[a.candidate_id]; });
  if (fresh.length) cjisSweepTell_(fresh, orphans);

  if (attached.length || orphans) {
    hubSysLog_('auto-cjis-folder', 'cjis_folder_sweep',
               attached.length + ' attached, ' + orphans + ' file(s) matching nobody',
               { status: 200 });
  }
  return { attached: attached.length, announced: fresh.length, orphans: orphans };
}

// One letter per pass, never one per person.
function cjisSweepTell_(rows, orphans) {
  // A Smart Comms situation (hiring_cjis_report_arrived): off, the reports are attached and nobody is told.
  var sit = hubLaneSituation_('hiring_cjis_report_arrived');
  if (!sit.on || !sit.leg('email')) return false;
  var team = [];
  try { team = (hiringTeamRecipients_().emails || []); } catch (e) { team = []; }
  if (!team.length) return;

  var lines = rows.map(function (r) {
    return '  ' + r.name + ' — ' + r.filename;
  }).join('\n');
  var cjisVars = { count: String(rows.length), lines: lines,
                   orphans_line: orphans ? '\n\n' + orphans + ' file(s) in that folder match nobody on the board.' : '' };
  var body = 'The background check turned up in the folder for ' +
    (rows.length === 1 ? 'one candidate' : rows.length + ' candidates') +
    ', and it is on their card:\n\n' + lines +
    '\n\nIt is marked ON FILE and nothing stronger. Clear and Verified are what let somebody ' +
    'out of New, and no filename is allowed to answer that — somebody still reads the report.' +
    (orphans ? '\n\n' + orphans + ' file(s) in that folder match nobody on the board. That is ' +
      'normal when a candidate uploads their own — but nobody can see it unless it is said.' : '');

  var letter = hiringNoticeEmail_({
    title: sit.word('email_subject', 'A background check arrived — ' + rows.length + ' candidate(s)', cjisVars),
    bodyText: sit.word('email_text', body, cjisVars),
    facts: rows.slice(0, 5).map(function (r) { return { label: r.name, value: r.filename }; })
  });
  var res = rpcCall_('emailSend', {
    to: team.join(', '), subject: letter.subject, body: letter.text, html: letter.html,
    reason: 'smart comms: hiring_cjis_report_arrived'
  }, { idempotency_key: 'cjis_sweep_' + rows.map(function (r) { return r.candidate_id; }).join('_') });
  return !!(res && res.sent);
}

function runCjisFolderSweep() {
  var out = cjisFolderSweepRun_();
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/** Look now rather than waiting up to half an hour for the rider. */
HUB_POLICY.cjisFolderSweepNow = {
  file: 'Cjis.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['candidates', 'onboarding'], emits: ['emailSend']
};
HUB_ACTIONS.cjisFolderSweepNow = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var out;
  try { out = cjisFolderSweepRun_(); }
  catch (e) { return { status: 500, message: String((e && e.message) || e) }; }
  return { status: 200, data: out || {} };
};
