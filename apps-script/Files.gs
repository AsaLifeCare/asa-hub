// Folders are addressed by Drive id, never by name; identity documents only inherit folder sharing.

var FILES_DOCS_NAME = 'Onboarding Documents';
var FILES_UPLOADS_NAME = 'Uploads';
var FILES_LIBRARY_NAME = 'Library Files';

var PROP_FILES_ROOT = 'HUB_FOLDER_ROOT_ID';
var PROP_FILES_DOCS = 'HUB_FOLDER_DOCS_ID';
var PROP_FILES_UPLOADS = 'HUB_FOLDER_UPLOADS_ID';
var PROP_FILES_LIBRARY = 'HUB_FOLDER_LIBRARY_ID';

var DOCS_TAB = 'candidate_documents';
var DOC_CATALOG_TAB = 'document_catalog';

// Status and evidence stay in separate columns.
var DOCS_HEADER = [
  'doc_row_id', 'candidate_id', 'candidate_name', 'doc_id', 'doc_label',
  'status', 'review_status', 'file_id', 'file_url', 'file_name', 'mime_type',
  'size_bytes', 'issued_on', 'expires_on', 'uploaded_by', 'uploaded_at',
  'verified_by', 'verified_at', 'superseded_by', 'notes'
];

var DOC_CATALOG_DEFAULT = [
  { doc_id: 'dropbox_packet', label: 'New Hire Packet (Dropbox Sign)', kind: 'signature', required: 'yes', renewal_months: '', applies_to: 'everyone', sort: 1 },
  { doc_id: 'dodd_8hr', label: '8-Hr DODD Training Certificate', kind: 'certificate', required: 'yes', renewal_months: 12, applies_to: 'everyone', sort: 2 },
  { doc_id: 'cpr_first_aid', label: 'CPR / First Aid Certificate', kind: 'certificate', required: 'yes', renewal_months: 24, applies_to: 'everyone', sort: 3 },
  { doc_id: 'med_del', label: 'Med Delegation Certificate', kind: 'certificate', required: 'no', renewal_months: 12, applies_to: 'med del role', sort: 4 },
  { doc_id: 'drivers_id', label: "Driver's License / State ID", kind: 'document', required: 'yes', renewal_months: '', applies_to: 'everyone', sort: 5 },
  { doc_id: 'hs_diploma', label: 'HS Diploma / GED', kind: 'document', required: 'no', renewal_months: '', applies_to: 'everyone', sort: 6 },
  { doc_id: 'ss_birth', label: 'SS Card / Birth Certificate', kind: 'document', required: 'yes', renewal_months: '', applies_to: 'everyone', sort: 7 },
  { doc_id: 'background_check', label: 'Background check (BCI)', kind: 'screening', required: 'yes', renewal_months: '', applies_to: 'everyone', sort: 8 },
  { doc_id: 'car_insurance', label: 'Car Insurance Card', kind: 'document', required: 'no', renewal_months: 12, applies_to: 'drivers', sort: 9 }
];

function filesById_(id) {
  if (!id) return null;
  try {
    var f = DriveApp.getFolderById(String(id));
    return f.isTrashed() ? null : f;
  } catch (e) {
    return null;
  }
}

function filesChildByName_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function filesRoot_() {
  var pinned = filesById_(hubId_('HUB_PLATFORM_FOLDER_ID'));
  if (pinned) {
    hubPropSet_(PROP_FILES_ROOT, pinned.getId());
    return pinned;
  }
  var cached = filesById_(hubProp_(PROP_FILES_ROOT));
  if (cached) return cached;

  var root = null;
  try {
    var parents = DriveApp.getFileById(hubId_('HUB_DB_ID')).getParents();
    if (parents.hasNext()) root = parents.next();
  } catch (e) { root = null; }
  if (!root) root = DriveApp.getRootFolder();
  hubPropSet_(PROP_FILES_ROOT, root.getId());
  return root;
}

// A dedicated spreadsheet in the platform folder, never a tab on HUB_DB.
function filesEnsureHubSpreadsheet_(propKey, title, tabName, header) {
  var id = str_(hubProp_(propKey));
  var ss = null;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (eOpen) { ss = null; }
  }
  if (!ss) {
    var it = filesRoot_().getFilesByName(title);
    while (it.hasNext()) {
      var file = it.next();
      if (String(file.getMimeType()).indexOf('spreadsheet') !== -1) {
        ss = SpreadsheetApp.openById(file.getId());
        break;
      }
    }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(title);
    try { DriveApp.getFileById(ss.getId()).moveTo(filesRoot_()); }
    catch (eMove) { }
  }
  hubPropSet_(propKey, ss.getId());
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName(tabName);
    if (header && header.length) {
      sheet.clear();
      sheet.getRange(1, 1, 1, header.length).setValues([header]);
      sheet.setFrozenRows(1);
    }
  } else if (header && header.length) {
    ensureHeader_(sheet, header);
  }
  return sheet;
}

function filesBranch_(name, propKey) {
  var cached = filesById_(hubProp_(propKey));
  if (cached) return cached;
  var folder = filesChildByName_(filesRoot_(), name);
  hubPropSet_(propKey, folder.getId());
  return folder;
}

// Never creates: filesBranch_ would create the folder and stamp a property during a dry run.
function filesScreenFolderIfAny_() {
  var cached = filesById_(hubProp_(PROP_FILES_SCREEN));
  if (cached) return cached;
  var it = filesRoot_().getFoldersByName(FILES_SCREEN_NAME);
  return it.hasNext() ? it.next() : null;
}

function filesDocsFolder_() { return filesBranch_(FILES_DOCS_NAME, PROP_FILES_DOCS); }
function filesUploadsFolder_() { return filesBranch_(FILES_UPLOADS_NAME, PROP_FILES_UPLOADS); }
function filesLibraryFolder_() { return filesBranch_(FILES_LIBRARY_NAME, PROP_FILES_LIBRARY); }

function filesMoveInto_(file, folder) {
  var parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folder.getId()) return false;
  }
  file.moveTo(folder);
  return true;
}

function filesEnsureCandidateColumn_() {
  var sheet = hubSheet_(TALENT_CANDIDATES_TAB);
  var hdr = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  if (hdr.indexOf('docs_folder_id') !== -1) return hdr;
  sheet.getRange(1, hdr.length + 1).setValue('docs_folder_id');
  return hdr.concat(['docs_folder_id']);
}

// The folder name is cosmetic; the id on the candidate row is what counts.
function filesCandidateFolder_(cid) {
  var sheet = hubSheet_(TALENT_CANDIDATES_TAB);
  filesEnsureCandidateColumn_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var iId = hdr.indexOf('candidate_id');
  var iName = hdr.indexOf('candidate_name');
  var iFolder = hdr.indexOf('docs_folder_id');

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][iId]).trim() !== cid) continue;
    var cached = filesById_(values[r][iFolder]);
    if (cached) return { folder: cached, name: String(values[r][iName] || '').trim() };

    var name = String(values[r][iName] || '').trim() || cid;
    var folder = filesChildByName_(filesDocsFolder_(), name + ' — ' + cid);
    sheet.getRange(r + 1, iFolder + 1).setValue(folder.getId());
    return { folder: folder, name: name };
  }
  throw new Error('Unknown candidate: ' + cid);
}

function filesEnsureDocsTab_() {
  var existed = !!hubTabSheet_(DOCS_TAB);
  var sheet = hubTabEnsure_(DOCS_TAB, DOCS_HEADER);
  // The runtime has no row 1 to widen: stamping it would only add ghost columns.
  if (!existed || sheet.isRuntimeBacked) return sheet;
  var hdr = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var missing = DOCS_HEADER.filter(function (h) { return hdr.indexOf(h) === -1; });
  if (missing.length) sheet.getRange(1, hdr.length + 1, 1, missing.length).setValues([missing]);
  return sheet;
}

function filesCatalog_() {
  var keys = ['doc_id', 'label', 'kind', 'required', 'renewal_months', 'applies_to', 'sort'];
  var existed = !!hubTabSheet_(DOC_CATALOG_TAB);
  var sheet = hubTabEnsure_(DOC_CATALOG_TAB, keys);
  // Seed only an empty catalog: the resolver also answers null on a transient failure.
  if (!existed && sheet.getLastRow() < 2) {
    var rows = DOC_CATALOG_DEFAULT.map(function (d) {
      return keys.map(function (k) { return d[k] === undefined ? '' : d[k]; });
    });
    sheet.getRange(2, 1, rows.length, keys.length).setValues(rows);
  }
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    if (!String(values[r][hdr.indexOf('doc_id')] || '').trim()) continue;
    var row = {};
    for (var c = 0; c < hdr.length; c++) row[hdr[c]] = values[r][c];
    row.required = String(row.required).toLowerCase() === 'yes' || row.required === true;
    out.push(row);
  }
  out.sort(function (a, b) { return (Number(a.sort) || 99) - (Number(b.sort) || 99); });
  return out;
}

function filesDocRows_(cid) {
  var sheet = filesEnsureDocsTab_();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][hdr.indexOf('candidate_id')]).trim() !== cid) continue;
    var row = {};
    for (var c = 0; c < hdr.length; c++) row[hdr[c]] = serialize_(values[r][c]);
    row._row = r + 1;
    out.push(row);
  }
  return out;
}

function filesDocState_(cid) {
  var rows = filesDocRows_(cid);
  var latest = {};
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].superseded_by)) continue;
    latest[str_(rows[i].doc_id)] = rows[i];
  }
  return filesCatalog_().map(function (c) {
    var row = latest[c.doc_id] || null;
    return {
      doc_id: c.doc_id,
      label: c.label,
      kind: c.kind,
      required: c.required,
      applies_to: c.applies_to,
      renewal_months: c.renewal_months,
      status: row ? str_(row.status) : 'missing',
      review_status: row ? str_(row.review_status) : '',
      file_url: row ? str_(row.file_url) : '',
      file_name: row ? str_(row.file_name) : '',
      issued_on: row ? str_(row.issued_on) : '',
      expires_on: row ? str_(row.expires_on) : '',
      uploaded_at: row ? str_(row.uploaded_at) : '',
      uploaded_by: row ? str_(row.uploaded_by) : ''
    };
  });
}

function filesExpiry_(issuedOn, renewalMonths, given) {
  if (str_(given)) return str_(given);
  var months = Number(renewalMonths);
  if (!str_(issuedOn) || !months) return '';
  var d = new Date(str_(issuedOn));
  if (isNaN(d.getTime())) return '';
  d.setMonth(d.getMonth() + months);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

function filesMayWrite_(user, cid) {
  if (hubIsWriter_(user)) return true;
  // A trainee files only their own documents, and only while the onboarding window is open.
  if (user && user.role === 'onboarding') {
    var u = userByEmail_(user.email);
    if (!u) return false;
    var linked = str_(u.candidateid) || candidateIdByEmail_(str_(u.email));
    if (linked !== cid) return false;
    if (typeof onboardingWindowOpen_ === 'function') return onboardingWindowOpen_(cid);
    return true;
  }
  return false;
}

/** The requirement catalog (what the onboarding step draws). */
HUB_POLICY.docCatalog = {
  file: 'Files.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.docCatalog = function () {
  return { status: 200, data: { catalog: filesCatalog_() } };
};

/** "Which candidate am I?", read fresh from the users tab, never from the cached session. */
HUB_POLICY.myCandidate = {
  file: 'Files.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.myCandidate = function (payload, user) {
  if (!user) return { status: 401, message: 'Sign in first' };
  var u = userByEmail_(str_(user.email));
  var cid = u ? (str_(u.candidateid) || candidateIdByEmail_(str_(u.email))) : '';
  return { status: 200, data: { candidate_id: cid } };
};

/** Catalog + this candidate's state, plus a link to their Drive folder. */
HUB_POLICY.docList = {
  file: 'Files.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'onboarding'],
  invalidates: [], emits: []
};
HUB_ACTIONS.docList = function (payload, user) {
  var cid = str_(payload.candidate_id);
  if (!cid) return { status: 400, message: 'candidate_id is required' };
  if (!filesMayWrite_(user, cid) && !hubIsWriter_(user)) return hubDenied_();
  var items = filesDocState_(cid);
  var done = items.filter(function (i) { return i.status === 'uploaded' || i.status === 'verified'; }).length;
  var folder = null;
  try { folder = filesCandidateFolder_(cid).folder; } catch (e) { folder = null; }
  return {
    status: 200,
    data: {
      candidate_id: cid,
      items: items,
      uploaded: done,
      total: items.length,
      required_missing: items.filter(function (i) {
        return i.required && i.status !== 'uploaded' && i.status !== 'verified';
      }).map(function (i) { return i.label; }),
      folder_id: folder ? folder.getId() : '',
      folder_url: folder ? folder.getUrl() : ''
    }
  };
};

/** Store one document in the candidate's folder; a re-upload supersedes, nothing is deleted. */
HUB_POLICY.docUpload = {
  file: 'Files.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'onboarding'],
  invalidates: ['onboarding'], emits: []
};
HUB_ACTIONS.docUpload = function (payload, user) {
  var cid = str_(payload.candidate_id);
  var docId = str_(payload.doc_id);
  if (!cid || !docId) return { status: 400, message: 'candidate_id and doc_id are required' };
  if (!filesMayWrite_(user, cid)) return hubDenied_();

  var cat = null, catalog = filesCatalog_();
  for (var i = 0; i < catalog.length; i++) if (catalog[i].doc_id === docId) cat = catalog[i];
  if (!cat) return { status: 400, message: 'Unknown document type: ' + docId };

  var b64 = String(payload.base64 || '');
  if (!b64) return { status: 400, message: 'No file attached' };
  var bytes = Utilities.base64Decode(b64);
  if (!bytes.length) return { status: 400, message: 'The file is empty' };
  if (bytes.length > 15 * 1024 * 1024) return { status: 400, message: 'The file is over 15MB' };

  var found = filesCandidateFolder_(cid);
  var today = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
  var original = str_(payload.filename) || (docId + '.bin');
  var name = docId + '__' + today + '__' + original;
  var mime = str_(payload.mime_type) || 'application/octet-stream';
  // No setSharing(): identity documents inherit the folder's access.
  var file = found.folder.createFile(Utilities.newBlob(bytes, mime, name));

  var rows = filesDocRows_(cid);
  var sheet = filesEnsureDocsTab_();
  var hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var rowId = 'DOC_' + randomHex_(16).toUpperCase();
  for (var r = 0; r < rows.length; r++) {
    if (str_(rows[r].doc_id) === docId && !str_(rows[r].superseded_by)) {
      var iSup = hdr.indexOf('superseded_by');
      if (iSup !== -1) sheet.getRange(rows[r]._row, iSup + 1).setValue(rowId);
    }
  }

  var issued = str_(payload.issued_on);
  var vals = {
    doc_row_id: rowId,
    candidate_id: cid,
    candidate_name: found.name,
    doc_id: docId,
    doc_label: cat.label,
    status: 'uploaded',
    review_status: 'pending',
    file_id: file.getId(),
    file_url: 'https://drive.google.com/file/d/' + file.getId() + '/view',
    file_name: original,
    mime_type: mime,
    size_bytes: bytes.length,
    issued_on: issued,
    expires_on: filesExpiry_(issued, cat.renewal_months, payload.expires_on),
    uploaded_by: 'asa-hub:' + (user && user.email ? user.email : 'unknown'),
    uploaded_at: new Date().toISOString(),
    verified_by: '',
    verified_at: '',
    superseded_by: '',
    notes: str_(payload.notes)
  };
  hubAppendRow_(DOCS_TAB, vals);
  hubSysLog_(user && user.email, 'doc_upload', cid + ':' + docId, { status: 200 });

  return { status: 200, data: { doc: vals, state: filesDocState_(cid) } };
};

/** Reviewer decision: uploaded means a file arrived, verified means a person checked it. */
HUB_POLICY.docReview = {
  file: 'Files.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['onboarding'], emits: []
};
HUB_ACTIONS.docReview = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id), docId = str_(payload.doc_id);
  var decision = str_(payload.decision).toLowerCase();
  if (!cid || !docId) return { status: 400, message: 'candidate_id and doc_id are required' };
  if (decision !== 'verified' && decision !== 'returned') {
    return { status: 400, message: 'decision must be "verified" or "returned"' };
  }
  var sheet = filesEnsureDocsTab_();
  var hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var rows = filesDocRows_(cid), hit = null;
  for (var r = 0; r < rows.length; r++) {
    if (str_(rows[r].doc_id) === docId && !str_(rows[r].superseded_by)) hit = rows[r];
  }
  if (!hit) return { status: 404, message: 'No document on file for ' + docId };

  var set = {
    status: decision === 'verified' ? 'verified' : 'returned',
    review_status: decision,
    verified_by: 'asa-hub:' + user.email,
    verified_at: new Date().toISOString()
  };
  if (str_(payload.issued_on)) set.issued_on = str_(payload.issued_on);
  if (str_(payload.expires_on)) set.expires_on = str_(payload.expires_on);
  if (str_(payload.notes)) set.notes = str_(payload.notes);
  for (var k in set) {
    var i = hdr.indexOf(k);
    if (i !== -1) sheet.getRange(hit._row, i + 1).setValue(set[k]);
  }
  hubSysLog_(user.email, 'doc_review:' + decision, cid + ':' + docId, { status: 200 });
  return { status: 200, data: { state: filesDocState_(cid) } };
};

/** Idempotent organiser: folders inside the platform folder, stray uploads adopted, tabs prepared. */
HUB_POLICY.filesSetup = {
  file: 'Files.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.filesSetup = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var root = filesRoot_();
  var docs = filesDocsFolder_();
  var uploads = filesUploadsFolder_();

  var adopted = [];
  try {
    var legacy = DriveApp.getFoldersByName(UPLOADS_FOLDER);
    while (legacy.hasNext()) {
      var lf = legacy.next();
      if (lf.getId() === uploads.getId()) continue;
      var inside = false, ps = lf.getParents();
      while (ps.hasNext()) if (ps.next().getId() === root.getId()) inside = true;
      if (!inside) { lf.moveTo(root); adopted.push(lf.getName()); }
    }
  } catch (e2) { }

  filesEnsureDocsTab_();
  filesCatalog_();
  filesEnsureCandidateColumn_();

  return {
    status: 200,
    data: {
      platform_folder: { id: root.getId(), name: root.getName(), url: root.getUrl() },
      documents: { id: docs.getId(), url: docs.getUrl() },
      uploads: { id: uploads.getId(), url: uploads.getUrl() },
      adopted: adopted,
      note: 'Everything sits inside the platform folder and is addressed by id — moving or renaming it in Drive is safe.'
    }
  };
};

/** Store a file in the Library folder and return its URL; sharing is inherited, never widened. */
HUB_POLICY.libraryUpload = {
  file: 'Files.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.libraryUpload = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();

  var b64 = String(payload.base64 || '');
  if (!b64) return { status: 400, message: 'No file attached' };
  var bytes = Utilities.base64Decode(b64);
  if (!bytes.length) return { status: 400, message: 'The file is empty' };
  if (bytes.length > 25 * 1024 * 1024) return { status: 400, message: 'The file is over 25MB' };

  var original = str_(payload.filename) || 'library-file';
  var mime = str_(payload.mime_type) || 'application/octet-stream';
  var stamp = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
  var file = filesLibraryFolder_().createFile(Utilities.newBlob(bytes, mime, stamp + '__' + original));

  hubSysLog_(user && user.email, 'library_upload', original, { status: 200 });

  return {
    status: 200,
    data: {
      file_id: file.getId(),
      file_url: 'https://drive.google.com/file/d/' + file.getId() + '/view',
      file_name: original,
      mime_type: mime,
      size_bytes: bytes.length
    }
  };
};

// Resolved when called, never top-level: top-level code runs in file order, before these ids exist.
function hubOwnSheets_() {
  return [
    { id: hubId_('HUB_PREFS_ID'), label: 'Prefs' },
    { id: hubId_('HUB_DIRECTORY_ID'), label: 'Directory' },
    { id: hubId_('HUB_LOGS_ID'), label: 'Logs' },
    { id: hubId_('HUB_COMMS_ID'), label: 'Comms' }
  ];
}

HUB_POLICY.filesGatherSheets = {
  file: 'Files.gs', lane: 'write', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.filesGatherSheets = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var dry = payload.dry_run === true || String(payload.dry_run) === 'true';
  var root = filesRoot_();
  var moved = [], already = [], refused = [], unreachable = [];

  hubOwnSheets_().forEach(function (s) {
    if (!s.id) {
      unreachable.push(s.label + ' — no spreadsheet id is defined for it in the code');
      return;
    }
    var file = null;
    try { file = DriveApp.getFileById(s.id); } catch (e) {
      unreachable.push(s.label + ' — ' + String((e && e.message) || e));
      return;
    }
    var name = file.getName();
    // The name is the permission: only "ASA Hub …" files are ours to move.
    if (!/^ASA\s*Hub/i.test(name)) {
      refused.push(name + ' — not an ASA Hub sheet; left where it is');
      return;
    }
    var here = false;
    var parents = file.getParents();
    while (parents.hasNext()) { if (parents.next().getId() === root.getId()) { here = true; break; } }
    if (here) { already.push(name); return; }
    if (dry) { moved.push(name + ' (would move)'); return; }
    try {
      file.moveTo(root);
      moved.push(name);
    } catch (eM) {
      unreachable.push(name + ' — could not move: ' + String((eM && eM.message) || eM));
    }
  });

  hubSysLog_(user.email, 'files_gather_sheets',
    'root=' + root.getName() + '; moved ' + moved.length + ', already there ' + already.length +
    ', refused ' + refused.length + (dry ? ' (dry run)' : ''), { status: 200 });

  return { status: 200, data: {
    dry_run: dry, folder: root.getName(), folder_id: root.getId(),
    moved: moved, already_there: already,
    not_ours: refused, could_not_read: unreachable
  } };
};

function runGatherSystemSheets() {
  var out = HUB_ACTIONS.filesGatherSheets({}, { role: 'admin', email: 'editor' });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

var FILES_SCREEN_NAME = 'Screen Reports';
var PROP_FILES_SCREEN = 'HUB_FOLDER_SCREEN_ID';

function filesScreenFolder_() { return filesBranch_(FILES_SCREEN_NAME, PROP_FILES_SCREEN); }

// Batched, since Drive moves are slow: run again until left_to_do is 0.
HUB_POLICY.filesGatherScreenReports = {
  file: 'Files.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.filesGatherScreenReports = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var dry = payload.dry_run === true || String(payload.dry_run) === 'true';
  var limit = parseInt(payload.limit, 10) || 60;

  var home = filesScreenFolder_();
  var moved = [], skipped = 0, failed = [], seen = 0, more = 0;

  var it = DriveApp.searchFiles('title contains "Screen Report" and trashed = false');
  while (it.hasNext()) {
    var file = it.next();
    var name = file.getName();
    if (!/screen\s*report/i.test(name)) continue;
    seen++;
    if (moved.length >= limit) { more++; continue; }

    var here = false;
    var parents = file.getParents();
    while (parents.hasNext()) { if (parents.next().getId() === home.getId()) { here = true; break; } }
    if (here) { skipped++; continue; }
    if (dry) { moved.push(name + ' (would move)'); continue; }
    try {
      file.moveTo(home);
      moved.push(name);
    } catch (e) {
      failed.push(name + ' — ' + String((e && e.message) || e));
    }
  }

  hubSysLog_(user.email, 'files_gather_screen_reports',
    seen + ' found; moved ' + moved.length + ', already there ' + skipped +
    ', failed ' + failed.length + ', left ' + more + (dry ? ' (dry run)' : ''), { status: 200 });

  return { status: 200, data: {
    dry_run: dry, folder: FILES_SCREEN_NAME, folder_id: home.getId(),
    found: seen, moved: moved.length, already_there: skipped,
    left_to_do: more, could_not_move: failed,
    names: moved.slice(0, 40)
  } };
};

function runGatherScreenReports() {
  var out = HUB_ACTIONS.filesGatherScreenReports({}, { role: 'admin', email: 'editor' });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// Read at call time, for the same load-order reason as hubOwnSheets_.
function filesEstateIds_() {
  return [hubId_('CERT_SOURCE_ID'), hubId_('LEGACY_TALENT_SHEET_ID'), hubId_('LEGACY_PORTAL_SHEET_ID'),
          hubId_('QUO_SYNC_SHEET_ID'), hubId_('PRIOR_DOCS_SHEET_ID')]
    .filter(function (id) { return !!id; });
}
function filesOwnIds_() {
  return [hubId_('HUB_DB_ID'), hubId_('HUB_PREFS_ID'), hubId_('HUB_DIRECTORY_ID'), hubId_('HUB_LOGS_ID'), hubId_('HUB_COMMS_ID')]
    .filter(function (id) { return !!id; });
}

// Only 'ours' may move; estate and unknown are reported and left alone.
function filesClassify_(file) {
  var id = file.getId(), name = file.getName();
  if (filesOwnIds_().indexOf(id) !== -1) return 'ours';
  if (filesEstateIds_().indexOf(id) !== -1) return 'estate';
  if (/^ASA\s*Hub/i.test(name)) return 'ours';
  if (/screen\s*report/i.test(name)) return 'ours';
  return 'unknown';
}

HUB_POLICY.filesSurveyFolder = {
  file: 'Files.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.filesSurveyFolder = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var dry = payload.dry_run !== false && String(payload.dry_run) !== 'false';  // SAFE BY DEFAULT
  var raw = str_(payload.folder_id) || str_(payload.url);
  var m = raw.match(/[-\w]{25,}/);
  var id = m ? m[0] : '';
  if (!id) return { status: 400, message: 'Give the folder id or its Drive link.' };

  var folder = null;
  try { folder = DriveApp.getFolderById(id); } catch (e1) { folder = null; }
  if (!folder) {
    try {
      var f = DriveApp.getFileById(id);
      var ps = f.getParents();
      if (ps.hasNext()) folder = ps.next();
    } catch (e2) { folder = null; }
  }
  if (!folder) {
    return { status: 404, message: 'That id is neither a folder I can open nor a file with a parent I can read.' };
  }

  var home = filesRoot_();
  // Lazy: a dry run must never create the destination.
  var screensCache;
  var screensDest = function () {
    if (screensCache === undefined) {
      screensCache = dry ? filesScreenFolderIfAny_() : filesScreenFolder_();
    }
    return screensCache;
  };
  var limit = parseInt(payload.limit, 10) || 120;
  var moved = [], estate = [], unknown = [], failed = [], seen = 0, notReached = 0;

  var walk = function (dir, depth) {
    if (depth > 3) { notReached++; return; }
    var it = dir.getFiles();
    while (it.hasNext()) {
      var file = it.next();
      seen++;
      if (moved.length >= limit) { notReached++; continue; }
      var kind = filesClassify_(file);
      var name = file.getName();
      if (kind === 'estate') { estate.push(name); continue; }
      if (kind === 'unknown') {
        unknown.push(name + '  [' + file.getMimeType().split('.').pop() + ']');
        continue;
      }
      var wantsScreens = /screen\s*report/i.test(name);
      var dest = wantsScreens ? screensDest() : home;
      if (!dest) { moved.push(name + ' → ' + FILES_SCREEN_NAME + ' (would move)'); continue; }
      var here = false, ps2 = file.getParents();
      while (ps2.hasNext()) { if (ps2.next().getId() === dest.getId()) { here = true; break; } }
      if (here) continue;
      if (dry) { moved.push(name + ' → ' + dest.getName() + ' (would move)'); continue; }
      try { file.moveTo(dest); moved.push(name + ' → ' + dest.getName()); }
      catch (eM) { failed.push(name + ' — ' + String((eM && eM.message) || eM)); }
    }
    var subs = dir.getFolders();
    while (subs.hasNext()) walk(subs.next(), depth + 1);
  };
  walk(folder, 0);

  hubSysLog_(user.email, 'files_survey_folder',
    folder.getName() + ': ' + seen + ' file(s); ' + moved.length + ' ours, ' +
    estate.length + ' estate, ' + unknown.length + ' unknown' + (dry ? ' (dry run)' : ''),
    { status: 200 });

  return { status: 200, data: {
    dry_run: dry, surveyed: folder.getName(), files_seen: seen,
    moved: moved, could_not_move: failed,
    estate_left_alone: estate,
    unknown_left_alone: unknown.slice(0, 80),
    unknown_total: unknown.length,
    not_reached: notReached
  } };
};

function runSurveyFolder(urlOrId) {
  var out = HUB_ACTIONS.filesSurveyFolder({ url: urlOrId || '' }, { role: 'admin', email: 'editor' });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

function runSurveyFolderApply(urlOrId) {
  var out = HUB_ACTIONS.filesSurveyFolder({ url: urlOrId || '', dry_run: false },
    { role: 'admin', email: 'editor' });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// Editor scratch bench, mirrored here so a push does not erase it.
function test(){
  // runGatherScreenReports(); runGatherSystemSheets();
  HUB_ACTIONS.filesGatherScreenReports({dry_run:true},{role:'admin',email:'editor'})
  // runSurveyFolder('https://drive.google.com/file/d/1US4pB2t0OIJN0JZjxH-DIinCVFDPzrUX/view')…
}

// Folder import writes rows only: files are never copied, moved or renamed.

function driveIdFromUrl_(value) {
  var v = String(value || '').trim();
  if (!v) return '';
  if (/^[A-Za-z0-9_-]{16,}$/.test(v)) return v;
  var m = /\/folders\/([A-Za-z0-9_-]{16,})/.exec(v) ||
          /\/d\/([A-Za-z0-9_-]{16,})/.exec(v) ||
          /[?&]id=([A-Za-z0-9_-]{16,})/.exec(v);
  return m ? m[1] : '';
}

// Shortcuts resolve to their target in the walk; images and spreadsheets stay out.
var DOCS_IMPORT_MIME = {
  'application/vnd.google-apps.document': 'doc',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'text/markdown': 'md',
  'text/x-markdown': 'md',
  'text/plain': 'txt',
  'application/rtf': 'doc'
};

HUB_POLICY.docsImportFolder = {
  file: 'Files.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  params: { url: { required: true, type: 'string' } },
  invalidates: ['documents'], emits: []
};
HUB_ACTIONS.docsImportFolder = function (payload, user) {
  if (!user || str_(user.role) !== 'admin') return hubDenied_();
  var folderId = driveIdFromUrl_(payload && payload.url);
  if (!folderId) {
    return { status: 400, message: 'Paste the folder\'s Drive link (the one with /folders/ in it).' };
  }
  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
    if (folder.isTrashed()) return { status: 404, message: 'That folder is in the trash.' };
  } catch (e) {
    return { status: 404, message: 'The platform cannot open that folder — check the link, and that ' +
             'asatech@asalifecare.com has access to it.' };
  }
  var category = str_(payload.category) || folder.getName();
  var collection = str_(payload.collection) || category;
  var deep = payload.include_subfolders === true || str_(payload.include_subfolders) === 'true';

  // Keyed by Drive id, so a second run adds only what is new.
  var have = {};
  try {
    listRows_('documents', {}).forEach(function (row) {
      var id = driveIdFromUrl_(str_(row.url));
      if (id) have[id] = true;
    });
  } catch (eH) { have = {}; }

  var added = [], skippedKnown = 0, skippedKind = 0, refusedKinds = {}, seenFolders = {}, cap = 300;
  function walk(f, depth) {
    if (added.length >= cap) return;
    var fid = f.getId();
    if (seenFolders[fid]) return;          // a shortcut loop is not a hierarchy
    seenFolders[fid] = true;
    var it = f.getFiles();
    while (it.hasNext() && added.length < cap) {
      var file = it.next();
      var mime = file.getMimeType();
      if (mime === 'application/vnd.google-apps.shortcut') {
        try {
          var target = DriveApp.getFileById(file.getTargetId());
          file = target;
          mime = target.getMimeType();
        } catch (eS) {
          skippedKind++;
          refusedKinds['broken shortcut'] = (refusedKinds['broken shortcut'] || 0) + 1;
          continue;
        }
      }
      var kind = DOCS_IMPORT_MIME[mime];
      if (!kind) {
        skippedKind++;
        var label = String(mime || 'unknown').split('/').pop().replace('vnd.google-apps.', '');
        refusedKinds[label] = (refusedKinds[label] || 0) + 1;
        continue;
      }
      var id = file.getId();
      if (have[id]) { skippedKnown++; continue; }
      have[id] = true;
      added.push({
        title: file.getName(),
        url: file.getUrl(),
        category: category,
        collection: collection,
        addedAt: new Date().toISOString()
      });
    }
    if (!deep || depth >= 3) return;
    var subs = f.getFolders();
    while (subs.hasNext() && added.length < cap) walk(subs.next(), depth + 1);
  }
  walk(folder, 0);

  for (var i = 0; i < added.length; i++) {
    // Same door as a hand-typed row, so an imported row is indistinguishable.
    var refusedD = sheetDbRefused_(createRow_('documents', added[i]));
    if (refusedD) {
      return { status: refusedD.status, message: refusedD.message + ' — ' + i + ' of ' + added.length +
               ' document(s) were listed before the refusal; the rest were not.' };
    }
  }
  var refused = Object.keys(refusedKinds).map(function (k) {
    return refusedKinds[k] + ' ' + k;
  }).join(', ');
  try {
    hubSysLog_(str_(user.email), 'docs_import_folder',
               folder.getName() + ' → ' + added.length + ' document(s), ' +
               skippedKnown + ' already listed, ' + skippedKind + ' refused' +
               (refused ? ' (' + refused + ')' : ''),
               { status: 200 });
  } catch (eL) {}
  return { status: 200, data: {
    folder: folder.getName(), added: added.length,
    skipped: skippedKnown + skippedKind,
    already_listed: skippedKnown, refused_kind: skippedKind, refused_kinds: refused,
    capped: added.length >= cap,
    titles: added.slice(0, 12).map(function (a) { return a.title; })
  } };
};
