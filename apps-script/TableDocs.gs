// A mirror shortcut that cannot be placed is logged and never costs the upload.

var TABLE_DOCS_FOLDER_ID = '1WG2BpkRX-PQXe427Ku-o6JV9ALJQKe_b';
var TABLE_DOCS_SIBLING_FILES = [
  '1TBx2U6gVyoQk6ijr72Wr67S-e-hkUIoS',
  '1Fm9VRgH_kgsgXTsgu3qumT9i4Ag02axL'
];

function tableDocsFileId_(env) {
  try {
    var d = (env && env.data) || {};
    var link = str_(d.resume_link) || str_(d.url) || str_(d.link) || str_(d.file_url);
    if (!link) return '';
    var m = String(link).match(/\/d\/([-\w]{20,})/) || String(link).match(/[?&]id=([-\w]{20,})/);
    return m ? m[1] : '';
  } catch (e) { return ''; }
}

function tableDocsMirror_(fileId) {
  if (!fileId) return 0;
  var placed = 0;
  var folders = [];
  try { folders.push(DriveApp.getFolderById(TABLE_DOCS_FOLDER_ID)); }
  catch (e) {}
  for (var i = 0; i < TABLE_DOCS_SIBLING_FILES.length; i++) {
    try {
      var parents = DriveApp.getFileById(TABLE_DOCS_SIBLING_FILES[i]).getParents();
      if (parents.hasNext()) folders.push(parents.next());
    } catch (e2) {}
  }
  for (var f = 0; f < folders.length; f++) {
    try { folders[f].createShortcut(fileId); placed++; }
    catch (e3) {}
  }
  if (placed < 3) {
    try {
      hubSysLog_('table-docs', 'doc_mirror_partial',
                 placed + ' of 3 doors placed for file ' + fileId, { status: 200 });
    } catch (eL) {}
  }
  return placed;
}

HUB_POLICY.tableDocUpload = {
  file: 'TableDocs.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  params: {
    candidate_id: { required: true, type: 'string' },
    item_id: { required: true, type: 'string' },
    filename: { required: true, type: 'string' },
    base64: { required: true, type: 'string' },
    candidate_name: { required: false, type: 'string' }
  },
  roles: ['admin', 'manager'],
  invalidates: ['candidates'], emits: []
};
HUB_ACTIONS.tableDocUpload = function (payload, user) {
  if (!user || user.is_service ||
      ['admin', 'manager'].indexOf(String(user.role)) === -1) {
    return hubDenied_();
  }
  var item = str_(payload && payload.item_id);
  if (!item) return { status: 400, message: 'item_id is required.' };
  var env;
  try {
    if (item === 'resume') {
      env = HUB_ACTIONS.resumeUpload(payload, user);
    } else if (item === 'cjis') {
      env = HUB_ACTIONS.cjisUpload(payload, user);
    } else if (str_(payload.doc_id)) {
      env = HUB_ACTIONS.docUpload(payload, user);
    } else {
      // Amber items have no doc_id; their file goes to the platform uploads folder.
      var cid = str_(payload.candidate_id);
      if (!cid) return { status: 400, message: 'candidate_id is required.' };
      var name = str_(payload.filename) || (item + '.bin');
      var obj = hubDriveFileObj_(payload, item + '-' + cid + '-' + name, '', user);
      try {
        if (typeof journeyLog_ === 'function') {
          journeyLog_(cid, 'document', item, 'ok',
                      str_(user.email) + ' uploaded ' + name + ' for ' + item, obj.url);
        }
      } catch (eJ) {}
      env = { status: 200, data: { url: obj.url, id: obj.id, item: item } };
    }
  } catch (e) {
    return { status: 500, message: 'Upload failed: ' + String((e && e.message) || e) };
  }
  if (env && env.status === 200) {
    var fileId = tableDocsFileId_(env);
    var mirrored = tableDocsMirror_(fileId);
    try { env.data = env.data || {}; env.data.mirrored = mirrored; } catch (e2) {}
    try { env.data.decoding = tableDocsDecode_(fileId, payload, user, item); }
    catch (eD) {}
  }
  return env;
};

// A formFiles ledger row is what gets this file decoded; the candidate id anchors it.
function tableDocsDecode_(fileId, payload, user, item) {
  return pipelineQueueDecode_(fileId, str_(payload && payload.candidate_id),
                              str_(payload && payload.candidate_name),
                              item, str_(payload && payload.filename) || (item + '.bin'),
                              user);
}

// The id is the anchor; the name is only for humans reading the row.
function pipelineQueueDecode_(fileId, candidateId, candidateName, fieldKey, fileName, user) {
  if (!fileId) return 'no file id';
  var cid = str_(candidateId);
  if (!cid) return 'no candidate';
  if (typeof createRow_ !== 'function') return 'no ledger';
  var name = str_(fileName) || (str_(fieldKey) + '.bin');
  var who = str_(candidateName);
  var item = str_(fieldKey);
  var filed = createRow_(FORM_FILES_RES, {
    form_slug: '(pipeline)', submission_id: '',
    field_key: String(item || '').slice(0, 80),
    anchor_id: cid, anchor_name: who,
    file_id: fileId, file_url: '', file_name: name,
    mime_type: '', size_bytes: '',
    uploaded_by_name: str_(user && user.name), uploaded_by_email: str_(user && user.email),
    digest_state: 'pending', digest_kind: '', digest_category: '',
    digest_dates: '', digest_names: '', digest_text_chars: '',
    digest_text: '', digest_json: '', digest_error: '', digested_at: ''
  });
  if (filed && filed.error) return 'ledger row refused';
  try {
    hubSysLog_(str_(user && user.email), 'table_doc_queued_for_decode',
               item + ' — ' + name + ' for ' + cid, { status: 200 });
  } catch (eL) {}
  return 'queued';
}
