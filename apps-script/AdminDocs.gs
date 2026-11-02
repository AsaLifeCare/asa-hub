// Never borrow another lane's folder property; unset means "not configured".
var PROP_ADMIN_DOCS_FOLDER = 'ADMIN_DOCS_FOLDER_ID';

function adminDocsFolder_() {
  var id = hubProp_(PROP_ADMIN_DOCS_FOLDER);
  if (!id) return { folder: null, configured: false };
  try {
    var folder = DriveApp.getFolderById(id);
    if (folder.isTrashed()) return { folder: null, configured: true, error: 'The configured folder is in the trash.' };
    return { folder: folder, configured: true };
  } catch (e) {
    return { folder: null, configured: true, error: 'The platform cannot open the configured folder — check that ' +
             'asatech@asalifecare.com has access to it.' };
  }
}

function adminDocsFileShape_(f) {
  return {
    id: f.getId(),
    name: f.getName(),
    mime: f.getMimeType(),
    size_bytes: f.getSize(),
    modified_time: f.getLastUpdated().toISOString(),
    web_view_link: f.getUrl()
  };
}

/** The Administration folder's files, newest first. */
HUB_POLICY.adminDocsList = {
  file: 'AdminDocs.gs', lane: 'read', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.adminDocsList = function (payload, user) {
  var found = adminDocsFolder_();
  if (!found.folder) {
    return {
      status: 200,
      data: {
        configured: false,
        reason: found.configured
          ? (found.error || 'The configured folder cannot be opened.')
          : 'The Administration Drive folder is not configured — set the ' + PROP_ADMIN_DOCS_FOLDER + ' property.',
        files: []
      }
    };
  }
  var files = [];
  var it = found.folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed()) continue;
    files.push(adminDocsFileShape_(f));
  }
  files.sort(function (a, b) { return a.modified_time < b.modified_time ? 1 : -1; });
  return {
    status: 200,
    data: {
      configured: true,
      folder_id: found.folder.getId(),
      folder_name: found.folder.getName(),
      folder_url: found.folder.getUrl(),
      updated_at: new Date().toISOString(),
      files: files
    }
  };
};

/** Store one file in the Administration folder, using the Library upload's transport (base64 to blob to createFile). */
HUB_POLICY.adminDocUpload = {
  file: 'AdminDocs.gs', lane: 'write', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['documents'], emits: []
};
HUB_ACTIONS.adminDocUpload = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var found = adminDocsFolder_();
  if (!found.folder) {
    return { status: 409, message: found.configured
      ? (found.error || 'The configured folder cannot be opened.')
      : 'The Administration Drive folder is not configured — set the ' + PROP_ADMIN_DOCS_FOLDER + ' property.' };
  }

  var b64 = String(payload.base64 || '');
  if (!b64) return { status: 400, message: 'No file attached' };
  var bytes = Utilities.base64Decode(b64);
  if (!bytes.length) return { status: 400, message: 'The file is empty' };
  if (bytes.length > 25 * 1024 * 1024) return { status: 400, message: 'The file is over 25MB' };

  var original = str_(payload.filename) || 'admin-doc';
  var mime = str_(payload.mime_type) || 'application/octet-stream';
  // No setSharing(): the file inherits the folder's access.
  var file = found.folder.createFile(Utilities.newBlob(bytes, mime, original));

  hubSysLog_(user && user.email, 'admin_doc_upload', original, { status: 200 });

  return { status: 200, data: adminDocsFileShape_(file) };
};

// Trashes only a direct child of the configured folder; an id alone is not permission.
HUB_POLICY.adminDocDelete = {
  file: 'AdminDocs.gs', lane: 'write', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['documents'], emits: []
};
HUB_ACTIONS.adminDocDelete = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var fileId = str_(payload.file_id);
  if (!fileId) return { status: 400, message: 'file_id is required' };
  var found = adminDocsFolder_();
  if (!found.folder) {
    return { status: 409, message: found.configured
      ? (found.error || 'The configured folder cannot be opened.')
      : 'The Administration Drive folder is not configured — set the ' + PROP_ADMIN_DOCS_FOLDER + ' property.' };
  }

  var file;
  try { file = DriveApp.getFileById(fileId); } catch (e) {
    return { status: 404, message: 'No such file — or the platform cannot see it.' };
  }
  var inside = false, parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === found.folder.getId()) { inside = true; break; }
  }
  if (!inside) {
    return { status: 403, message: 'That file is not in the Administration folder — refused.' };
  }
  if (file.isTrashed()) return { status: 200, data: { file_id: fileId, trashed: true } };

  var name = file.getName();
  file.setTrashed(true);
  hubSysLog_(user && user.email, 'admin_doc_delete', fileId + ' (' + name + ')', { status: 200 });

  return { status: 200, data: { file_id: fileId, name: name, trashed: true } };
};
