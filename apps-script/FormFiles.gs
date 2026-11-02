// The folder is a registry key, never an id a caller sends.
var FORM_UPLOAD_CONTEXTS = {
  forms: {
    prop: 'HUB_FORM_UPLOADS_FOLDER_ID',
    folderName: 'Asa Hub - Form',
    label: 'Form uploads',
    digest_profile: 'default',
    max_files: 5,
    max_mb: 20,
    accept: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'docx', 'xlsx', 'csv', 'txt',
             'json', 'xml', 'tsv', 'md', 'zip',
             'html', 'htm', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'css', 'py',
             'sql', 'yml', 'yaml',
             'mp4', 'mov', 'm4v', 'webm', '3gp', 'm4a', 'mp3', 'wav'],
    // Session door only; the public form door is keyed by the link token.
    roles: ['admin', 'manager']
  },
  // Accepts every known type; DIGEST_TYPE_NEVER still refuses anything meant to run.
  lab: {
    prop: 'HUB_FORM_UPLOADS_FOLDER_ID',
    folderName: 'Asa Hub - Form',
    label: 'Decoder lab',
    digest_profile: 'default',
    max_files: 10,
    max_mb: 25,
    accept: '*',
    roles: ['admin', 'manager']
  },
  // Same folder finReceiptFolder_ resolves (FINANCE_RECEIPTS_FOLDER_ID).
  finance: {
    prop: 'FINANCE_RECEIPTS_FOLDER_ID',
    folderName: 'ASA Hub — Client Receipts',
    label: 'Finance receipts',
    digest_profile: 'default',
    max_files: 10,
    max_mb: 20,
    accept: ['pdf', 'png', 'jpg', 'jpeg', 'webp'],
    roles: ['admin', 'manager']
  }
};

// 30MB arrives as ~42.4MB on the wire, near Apps Script's ~50MB POST ceiling: never raise it; use the resumable lane.
var FORM_FILE_MAX_BYTES = 30 * 1024 * 1024;

var FORM_FILE_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', txt: 'text/plain',
  json: 'application/json', xml: 'application/xml', tsv: 'text/tab-separated-values',
  md: 'text/markdown',
  zip: 'application/zip',
  // Source text is safe only because nothing serves these files from our own domain.
  html: 'text/html', htm: 'text/html',
  js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
  ts: 'text/plain', tsx: 'text/plain', jsx: 'text/javascript',
  css: 'text/css', py: 'text/x-python', sql: 'text/plain',
  yml: 'text/yaml', yaml: 'text/yaml',
  heic: 'image/heic',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v',
  webm: 'video/webm', '3gp': 'video/3gpp',
  m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav',
  ogg: 'audio/ogg'
};

var FORM_FILES_RES = 'formFiles';

// Contact block first, then name- and address-shaped answers; never a guessed uploader.
function formFileUploader_(submission) {
  var name = str_(submission && submission.name);
  var email = str_(submission && submission.email);
  if (name && email) return { name: name, email: email };
  var answers = submission && submission.answers;
  if (typeof answers === 'string') {
    try { answers = JSON.parse(answers || '{}'); } catch (e) { answers = null; }
  }
  if (answers && typeof answers === 'object') {
    var keys = Object.keys(answers);
    for (var i = 0; i < keys.length; i++) {
      var k = String(keys[i]).toLowerCase();
      var v = String(answers[keys[i]] == null ? '' : answers[keys[i]]).trim();
      if (!v) continue;
      if (!name && /(^|_)(full_?name|your_?name|name)$/.test(k) &&
          v.length < 80 && v.indexOf('{') === -1) name = v;
      if (!email && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) email = v;
    }
  }
  return { name: name, email: email };
}

function formFileExt_(name) {
  var m = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return m ? m[1] : '';
}

// A found-by-name id is only cached, never written to the prop store.
function formUploadsFolderId_(contextKey) {
  var ctx = FORM_UPLOAD_CONTEXTS[String(contextKey || 'forms')];
  if (!ctx) return { id: '', reason: 'Unknown upload context "' + contextKey + '".' };
  var id = '';
  try { id = String(hubProp_(ctx.prop) || '').trim(); } catch (eP) { id = ''; }
  if (id) return { id: id, reason: '' };
  var cacheKey = 'form_upload_folder_' + String(contextKey || 'forms');
  try {
    var cache = CacheService.getScriptCache();
    var hit = cache.get(cacheKey);
    if (hit) return { id: hit, reason: '' };
    var it = DriveApp.getFoldersByName(ctx.folderName);
    if (it.hasNext()) {
      var found = it.next().getId();
      cache.put(cacheKey, found, 21600);
      return { id: found, reason: '' };
    }
  } catch (eD) { /* falls through to the honest reason */ }
  return { id: '', reason: 'The "' + ctx.folderName + '" folder is not reachable — ' +
           'paste its Drive id into the ' + ctx.prop + ' property.' };
}

function formFileFieldCheck_(f) {
  var key = String((f && f.key) || '');
  var ctxKey = String((f && f.context) || 'forms');
  if (!FORM_UPLOAD_CONTEXTS[ctxKey]) {
    return 'Question "' + key + '" names an unknown upload context "' + ctxKey + '".';
  }
  var maxFiles = Number((f && f.max_files) || FORM_UPLOAD_CONTEXTS[ctxKey].max_files);
  if (!(maxFiles >= 1 && maxFiles <= 10)) {
    return 'Question "' + key + '" allows ' + maxFiles + ' files — 1 to 10 is the range.';
  }
  if (f && f.accept && f.accept.length) {
    for (var i = 0; i < f.accept.length; i++) {
      var knownTypes = (typeof digestFileTypes_ === 'function')
        ? digestFileTypes_() : FORM_FILE_TYPES;
      if (!knownTypes[String(f.accept[i]).toLowerCase()]) {
        return 'Question "' + key + '" accepts ".' + f.accept[i] +
               '", which this platform does not carry.';
      }
    }
  }
  return '';
}

// Shared by the public and session doors so their rules cannot drift apart.
function formFileStoreCore_(ctxKey, allow, filename, base64, namePrefix) {
  var ctx = FORM_UPLOAD_CONTEXTS[ctxKey];
  if (!ctx) return { error: { status: 400, message: 'Unknown upload context "' + ctxKey + '".' } };
  filename = String(filename || '').trim().slice(0, 180) || 'file';
  var ext = formFileExt_(filename);
  var known = (typeof digestFileTypes_ === 'function') ? digestFileTypes_() : FORM_FILE_TYPES;
  // '*' means every type the words book knows; unknown extensions are still refused.
  var okList = (allow && allow.length) ? allow
    : (ctx.accept === '*' ? Object.keys(known) : ctx.accept);
  if (!ext || okList.indexOf(ext) === -1 || !known[ext]) {
    return { error: { status: 400, message: 'That file type is not accepted here. Allowed: ' +
             okList.map(function (a) { return '.' + a; }).join(', ') + '.' } };
  }
  var bytes;
  try { bytes = Utilities.base64Decode(String(base64 || '')); }
  catch (eB) { return { error: { status: 400, message: 'The file did not arrive whole — please try again.' } }; }
  if (!bytes.length) return { error: { status: 400, message: 'The file arrived empty.' } };
  var cap = Math.min(FORM_FILE_MAX_BYTES, (Number(ctx.max_mb) || 20) * 1024 * 1024);
  if (bytes.length > cap) {
    return { error: { status: 400, message: 'That file is ' + Math.round(bytes.length / 1048576) +
             'MB — ' + Math.round(cap / 1048576) + 'MB is the ceiling per file.' } };
  }
  var where = formUploadsFolderId_(ctxKey);
  if (!where.id) return { error: { status: 503, message: where.reason } };
  var folder;
  try { folder = DriveApp.getFolderById(where.id); }
  catch (eF) { return { error: { status: 503, message: 'The upload folder did not answer — please try again.' } }; }
  // One intake folder for every form; the decoder's category shelves inside it do the cataloguing.
  var sub = 'asa-documents';
  if (typeof digestVocab_ === 'function') {
    try {
      var named = (digestVocab_().settings || {}).documents_folder;
      if (typeof named === 'string' && named) sub = named;
    } catch (eN) { /* the default is the answer */ }
  }
  sub = String(sub).trim().toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  // Never the originals folder: a form titled "Database" would otherwise post straight into it.
  try {
    var reserved = (typeof FORM_ORIGINALS_NAME === 'string')
      ? FORM_ORIGINALS_NAME.toLowerCase() : 'database';
    if (sub && sub === reserved) sub = sub + '-files';
  } catch (eRes) { /* the name guard is a courtesy, never a wall */ }
  if (sub) {
    try {
      var kids = folder.getFoldersByName(sub);
      folder = kids.hasNext() ? kids.next() : folder.createFolder(sub);
    } catch (eSub) { /* the parent still receives — organization, not a wall */ }
  }
  var mime = known[ext];
  // The stored name derives from the page's upload key, so a retry finds the same file (with or without `pending__`).
  var key = String(arguments.length > 6 ? arguments[6] : '')
    .replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  var stamp = new Date().toISOString().replace(/[:.]/g, '-');
  var storedName = (namePrefix || '') + (key || stamp) + '__' + filename;
  if (key) {
    var names = [storedName, key + '__' + filename];
    for (var nn = 0; nn < names.length; nn++) {
      try {
        var seen = folder.getFilesByName(names[nn]);
        if (seen.hasNext()) {
          var already = seen.next();
          // A retry must answer the same handle, identity included, as a first try.
          var againSha = '';
          try {
            if (bytes.length <= HUB_ASSET_HASH_MAX_BYTES) {
              againSha = hubHex_(Utilities.computeDigest(
                Utilities.DigestAlgorithm.SHA_256, bytes));
            }
          } catch (eD) { againSha = ''; }
          return {
            file_id: already.getId(),
            file_url: already.getUrl(),
            file_name: filename,
            mime_type: mime,
            size_bytes: bytes.length,
            asset_id: againSha ? ('AST_' + againSha.slice(0, 32))
                               : ('AST_u' + already.getId().slice(0, 24)),
            id_source: againSha ? 'content' : 'minted',
            sha256: againSha,
            reused: true
          };
        }
      } catch (eS) { /* a search that cannot answer just means we create */ }
    }
  }
  var put = hubAssetPut_(bytes, storedName, mime, folder, { reuse_by: 'none' });
  // Bytes are committed; everything after can fail and be retried against this capture.
  try {
    assetEvent_('asset_captured', put.asset_id,
                { type: 'form', key: String(ctxKey || ''), name: filename },
                { file_id: put.file_id, bytes: put.size_bytes,
                  mime: put.mime_type, id_source: put.id_source,
                  hash_note: put.hash_note }, 'formFileStoreCore_');
  } catch (eE) { /* the trail is not the work */ }
  return {
    file_id: put.file_id,
    file_url: put.file_url,
    file_name: filename,
    mime_type: mime,
    size_bytes: bytes.length,
    asset_id: put.asset_id,
    id_source: put.id_source,
    sha256: put.sha256,
    hash_note: put.hash_note
  };
}

// Public door: no HUB_POLICY row on purpose; gated like formPublicSubmitPub_ (slug + token + open).
function formPublicFileStorePub_(payload) {
  if (formPubThrottled_('file', 900)) {
    return { status: 429, message: 'Too many uploads right now — please try again shortly.' };
  }
  var row = formBySlug_(payload && payload.f);
  var token = String((payload && payload.t) || '');
  if (!row || !token || token !== str_(row.token) ||
      str_(row.archived).toLowerCase() === 'true') {
    return { status: 404, message: 'This link is not valid. Ask whoever sent it for a fresh one.' };
  }
  if (['open', 'testing'].indexOf(str_(row.status).toLowerCase()) === -1) {
    return { status: 410, message: str_(row.closed_message) || 'This form is closed.' };
  }
  var fields = formFields_(row);
  var fileField = null;
  var wantKey = String((payload && payload.key) || '');
  for (var i = 0; i < fields.length; i++) {
    if (String(fields[i].kind) === 'file' &&
        (!wantKey || String(fields[i].key) === wantKey)) { fileField = fields[i]; break; }
  }
  if (!fileField) {
    return { status: 400, message: 'This form does not ask for a file.' };
  }
  var ctxKey = String(fileField.context || 'forms');
  var allow = (fileField.accept && fileField.accept.length) ? fileField.accept : null;
  // pending__ until a submit claims it, so orphans stay visible by prefix.
  var got = formFileStoreCore_(ctxKey, allow,
    (payload && payload.filename), (payload && payload.base64),
    'pending__', str_(row.slug), (payload && payload.upload_id));
  if (got.error) return got.error;
  try {
    hubSysLog_('asa-hub:form', 'form_file_stored',
               str_(row.slug) + ' — ' + got.file_name + ' (' + got.size_bytes + ' bytes)',
               { status: 200 });
  } catch (eL) { /* stored either way */ }
  return { status: 200, data: got };
}

// Mints a Drive resumable session so large bytes bypass Apps Script; no HUB_POLICY row (public door).
function formPublicFileSessionPub_(payload) {
  if (formPubThrottled_('file', 900)) {
    return { status: 429, message: 'Too many uploads right now — please try again shortly.' };
  }
  var p = payload || {};
  var row = formBySlug_(p.f);
  var token = String(p.t || '');
  if (!row || !token || token !== str_(row.token) ||
      str_(row.archived).toLowerCase() === 'true') {
    return { status: 404, message: 'This link is not valid. Ask whoever sent it for a fresh one.' };
  }
  if (['open', 'testing'].indexOf(str_(row.status).toLowerCase()) === -1) {
    return { status: 410, message: str_(row.closed_message) || 'This form is closed.' };
  }
  var fields = formFields_(row);
  var wantKey = String(p.key || '').trim();
  var fileField = null;
  for (var i = 0; i < fields.length; i++) {
    if (String(fields[i].kind) === 'file' &&
        (!wantKey || String(fields[i].key) === wantKey)) { fileField = fields[i]; break; }
  }
  if (!fileField) return { status: 400, message: 'This form does not ask for a file.' };

  var filename = String(p.filename || '').trim().slice(0, 180) || 'file';
  var ext = formFileExt_(filename);
  var known = (typeof digestFileTypes_ === 'function') ? digestFileTypes_() : FORM_FILE_TYPES;
  var allow = (fileField.accept && fileField.accept.length)
    ? fileField.accept : FORM_UPLOAD_CONTEXTS[String(fileField.context || 'forms')].accept;
  if (!ext || allow.indexOf(ext) === -1 || !known[ext]) {
    return { status: 400, message: 'That file type is not accepted here. Allowed: ' +
             allow.map(function (a) { return '.' + a; }).join(', ') + '.' };
  }
  var size = Number(p.size_bytes || 0);
  var cap = FORM_FILE_MAX_BYTES * 10;
  if (typeof digestSetting_ === 'function') {
    cap = digestSetting_('session_max_mb', Math.round(cap / 1048576), 30, 2000) * 1048576;
  }
  if (!(size > 0)) return { status: 400, message: 'The upload did not say how big it is.' };
  if (size > cap) {
    return { status: 400, message: 'That file is ' + Math.round(size / 1048576) +
             'MB — ' + Math.round(cap / 1048576) + 'MB is the ceiling.' };
  }
  var ctxKey = String(fileField.context || 'forms');
  var where = formUploadsFolderId_(ctxKey);
  if (!where.id) return { status: 503, message: where.reason };
  var folderId = where.id;
  var sub = 'asa-documents';
  if (typeof digestVocab_ === 'function') {
    try {
      var namedFolder = (digestVocab_().settings || {}).documents_folder;
      if (typeof namedFolder === 'string' && namedFolder) sub = namedFolder;
    } catch (eNF) { /* the default is the answer */ }
  }
  sub = String(sub).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60);
  if (sub) {
    try {
      var parent = DriveApp.getFolderById(where.id);
      var kids = parent.getFoldersByName(sub);
      folderId = (kids.hasNext() ? kids.next() : parent.createFolder(sub)).getId();
    } catch (eSub) { folderId = where.id; }
  }
  var key = String(p.upload_id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  var stored = 'pending__' + (key || String(new Date().getTime())) + '__' + filename;
  try {
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
      { method: 'post',
        contentType: 'application/json; charset=UTF-8',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
                   'X-Upload-Content-Type': known[ext],
                   'X-Upload-Content-Length': String(size) },
        payload: JSON.stringify({ name: stored, parents: [folderId] }),
        muteHttpExceptions: true, followRedirects: false });
    if (res.getResponseCode() >= 400) {
      return { status: 503, message: 'The upload could not be started — please try again.' };
    }
    var headers = res.getAllHeaders() || {};
    var session = '';
    for (var h in headers) {
      if (String(h).toLowerCase() === 'location') { session = String(headers[h]); break; }
    }
    if (!session) {
      return { status: 503, message: 'The upload could not be started — please try again.' };
    }
    try {
      hubSysLog_('asa-hub:form', 'form_file_session',
                 str_(row.slug) + ' — ' + filename + ' (' + Math.round(size / 1048576) + 'MB)',
                 { status: 200 });
    } catch (eL) { /* the session stands either way */ }
    return { status: 200, data: { session: session, file_name: filename,
                                  mime_type: known[ext], stored_name: stored } };
  } catch (e) {
    return { status: 503, message: 'The upload could not be started — please try again.' };
  }
}

// Session door: the ledger row is filed at once, since there is no submission to wait for.
HUB_POLICY.formFileStore = {
  file: 'FormFiles.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { context: { required: true, type: 'string' },
            filename: { required: true, type: 'string' },
            base64: { required: true, type: 'string' },
            ref: { required: false, type: 'string' },
            upload_id: { required: false, type: 'string' } },
  // formFiles is NEVER_SNAPSHOT: there is no slice to invalidate.
  invalidates: [], emits: []
};
HUB_ACTIONS.formFileStore = function (payload, user) {
  var p = payload || {};
  var ctxKey = String(p.context || '').trim();
  var ctx = FORM_UPLOAD_CONTEXTS[ctxKey];
  if (!ctx) return { status: 400, message: 'Unknown upload context "' + ctxKey + '".' };
  var roles = ctx.roles || ['admin'];
  if (!user || roles.indexOf(String(user.role)) === -1) {
    return { status: 403, message: 'This upload lane is for: ' + roles.join(', ') + '.' };
  }
  var got = formFileStoreCore_(ctxKey, null, p.filename, p.base64, '',
    String(p.ref || ctxKey), p.upload_id);
  if (got.error) return got.error;
  var filed = createRow_(FORM_FILES_RES, {
    form_slug: '(' + ctxKey + ')', submission_id: '',
    field_key: String(p.ref || '').slice(0, 80),
    file_id: got.file_id, file_url: got.file_url, file_name: got.file_name,
    asset_id: str_(got.asset_id), sha256: str_(got.sha256),
    mime_type: got.mime_type, size_bytes: String(got.size_bytes),
    uploaded_by_name: str_(user.name), uploaded_by_email: str_(user.email),
    digest_state: 'pending', digest_kind: '', digest_category: '',
    digest_dates: '', digest_names: '', digest_text_chars: '',
    digest_text: '', digest_json: '', digest_error: '', digested_at: ''
  });
  if (filed && filed.error) return { status: 503, message: 'Stored, but the ledger row did not save — retry.' };
  try {
    hubSysLog_(str_(user.email), 'form_file_stored_app',
               ctxKey + ' — ' + got.file_name + ' (' + got.size_bytes + ' bytes)',
               { status: 200 });
  } catch (eL2) { /* filed either way */ }
  return { status: 200, data: got };
};

// Ledger rows and the pending__ rename ride ctx.after, filed only once the submission lands.
function formFileAnswer_(f, raw, ctx) {
  var handles = [];
  try {
    var got = (typeof raw === 'string') ? JSON.parse(raw || '[]') : (raw || []);
    if (Object.prototype.toString.call(got) === '[object Array]') handles = got;
  } catch (eP) { handles = []; }
  if (!handles.length) return { v: '' };

  var ctxKey = String(f.context || 'forms');
  var maxFiles = Number(f.max_files || FORM_UPLOAD_CONTEXTS[ctxKey].max_files || 5);
  if (handles.length > maxFiles) {
    return { error: '"' + String(f.label || f.key) + '" takes at most ' + maxFiles + ' file(s).' };
  }
  var where = formUploadsFolderId_(ctxKey);
  if (!where.id) return { error: where.reason };

  var seen = {};
  var kept = [];
  for (var i = 0; i < handles.length; i++) {
    var fid = String((handles[i] && handles[i].file_id) || '').trim();
    if (!fid || seen[fid]) continue;
    seen[fid] = true;
    var file;
    try { file = DriveApp.getFileById(fid); }
    catch (eG) { return { error: 'One of the uploaded files could not be found — please re-attach it.' }; }
    // The claimed id must live under our folder (any depth, hop-limited), or a submit could launder a Drive id.
    var ok = false;
    try {
      var climb = file.getParents();
      var hops = 0;
      while (climb.hasNext() && !ok && hops < 8) {
        var par = climb.next();
        if (par.getId() === where.id) { ok = true; break; }
        climb = par.getParents();
        hops++;
      }
    } catch (ePar) { ok = false; }
    if (!ok) return { error: 'One of the attached files does not belong to this form.' };
    kept.push({ file: file, fid: fid,
                name: String((handles[i] && handles[i].file_name) || file.getName()).slice(0, 180),
                mime: String((handles[i] && handles[i].mime_type) || ''),
                size: Number((handles[i] && handles[i].size_bytes) || 0) });
  }
  if (!kept.length) return { v: '' };

  var fieldKey = String(f.key || '');
  var slug = str_(ctx.row.slug);
  ctx.after.push(function (submission) {
    var subId = str_(submission && submission.id);
    var filed = [];
    for (var k = 0; k < kept.length; k++) {
      var h = kept[k];
      // Deduped against the ledger so a doubled submit never mints twin rows.
      var already = false;
      try {
        var rows = listRows_(FORM_FILES_RES, {}) || [];
        for (var r = 0; r < rows.length; r++) {
          if (str_(rows[r].file_id) === h.fid) { already = true; break; }
        }
      } catch (eR) { already = false; }
      if (already) continue;
      var by = formFileUploader_(submission);
      // Identity comes from the Drive object stamped at capture, never from the browser.
      var mark = (typeof hubAssetOf_ === 'function') ? hubAssetOf_(h.file) : {};
      var made = createRow_(FORM_FILES_RES, {
        form_slug: slug, submission_id: subId, field_key: fieldKey,
        file_id: h.fid, file_url: h.file.getUrl(), file_name: h.name,
        asset_id: str_(mark.asset_id), sha256: str_(mark.sha256),
        mime_type: h.mime, size_bytes: String(h.size || ''),
        uploaded_by_name: by.name,
        uploaded_by_email: by.email,
        digest_state: 'pending', digest_kind: '', digest_category: '',
        digest_dates: '', digest_names: '', digest_text_chars: '',
        digest_text: '', digest_json: '', digest_error: '', digested_at: ''
      });
      // A refused ledger row is no row: the file keeps its pending__ name and is said in the log.
      var refusedL = sheetDbRefused_(made);
      if (refusedL) {
        try {
          hubSysLog_('asa-hub:forms', 'form_file_row_refused',
                     slug + ':' + fieldKey + ' — ' + h.name + ': ' + String(refusedL.message).slice(0, 160),
                     { status: refusedL.status });
        } catch (eLr) { /* the answer below is unchanged */ }
        continue;
      }
      try {
        var nm = h.file.getName();
        if (nm.indexOf('pending__') === 0) h.file.setName(nm.slice('pending__'.length));
      } catch (eN) { /* the row is the record; the name is cosmetics */ }
      filed.push(str_(made && made.id));
    }
    // Decoded on arrival, budgeted because a person waits; the rest stays pending for the sweep.
    var began = new Date().getTime();
    var led = null;
    for (var L = 0; typeof DIGEST_LEDGERS !== 'undefined' && L < DIGEST_LEDGERS.length; L++) {
      if (DIGEST_LEDGERS[L].res === FORM_FILES_RES) led = DIGEST_LEDGERS[L];
    }
    for (var d = 0; led && d < filed.length; d++) {
      if (!filed[d]) continue;
      // Must stay before the claim: a reserved file this loop will not read is a lock with no owner.
      if (d >= digestSetting_('arrival_files', 1, 0, 12) ||
          new Date().getTime() - began > 25000) {
        break;
      }
      // Claim with `working` before reading; updateRowById_ returns failure rather than throwing.
      var claimed = null;
      try {
        claimed = updateRowById_(FORM_FILES_RES, { id: filed[d], digest_state: 'working' });
      } catch (eClaim) { claimed = null; }
      if (!claimed || claimed.error) continue;
      // Any failure from here must release the claim, or the row hides from both lanes for hours.
      var landed = false;
      try {
        var fresh = requireRow_(FORM_FILES_RES, filed[d]);
        if (fresh && !fresh.error) {
          var verdict = digestOne_(fresh, led);
          if (verdict) {
            verdict.id = filed[d];
            verdict.digested_at = new Date().toISOString();
            var wrote = updateRowById_(FORM_FILES_RES, verdict);
            landed = !!(wrote && !wrote.error);
          }
        }
      } catch (eDg) {
        try {
          hubSysLog_('asa-hub:form', 'form_decode_on_arrival_failed',
                     String(eDg && eDg.message || eDg).slice(0, 160), { status: 500 });
        } catch (eL4) { /* released below either way */ }
      }
      if (!landed) {
        try { updateRowById_(FORM_FILES_RES, { id: filed[d], digest_state: 'pending' }); }
        catch (eRel) { /* the stalled sweep is the last net */ }
      }
    }
  });

  var compact = kept.map(function (h) {
    return { file_id: h.fid, file_name: h.name, size_bytes: h.size };
  });
  return { v: JSON.stringify(compact) };
}

// Admin read door

/** The form files ledger for admins and managers, filtered by form or submission. */
HUB_POLICY.formFilesList = {
  file: 'FormFiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { form_slug: { required: false, type: 'string' },
            submission_id: { required: false, type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.formFilesList = function (payload, user) {
  var p = payload || {};
  var rows = [];
  try { rows = listRows_(FORM_FILES_RES, {}) || []; } catch (e) { rows = []; }
  var slug = String(p.form_slug || '').trim().toLowerCase();
  var sub = String(p.submission_id || '').trim();
  var out = [];
  // digest_text is trimmed to a preview unless `full: true`.
  var full = (p.full === true || String(p.full) === 'true');
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (slug && str_(r.form_slug).toLowerCase() !== slug) continue;
    if (sub && str_(r.submission_id) !== sub) continue;
    if (full) { out.push(r); continue; }
    var copy = {};
    for (var k in r) {
      if (Object.prototype.hasOwnProperty.call(r, k)) copy[k] = r[k];
    }
    copy.digest_text = str_(r.digest_text).slice(0, 600);
    out.push(copy);
  }
  return { status: 200, data: { files: out } };
};
