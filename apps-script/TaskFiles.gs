// Stores the file only; the attachments list rides the `tasks` resource write and its ownedBy gate.
HUB_POLICY.taskFileStore = {
  file: 'TaskFiles.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff', 'client', 'interviewer'],
  invalidates: [], emits: []
};
HUB_ACTIONS.taskFileStore = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  var name = str_(payload.filename) || 'attachment';
  var mime = str_(payload.mime).toLowerCase();
  var okMime = mime.indexOf('image/') === 0 || mime === 'application/pdf';
  var okExt = /\.(png|jpe?g|webp|gif|heic|pdf)$/i.test(name);
  if (!okMime && !okExt) {
    return { status: 400, message: 'Images and PDFs only.' };
  }
  var b64 = String(payload.base64 || '');
  if (!b64) return { status: 400, message: 'The file is required.' };
  // ~15MB decoded (base64 carries 4/3 of the bytes)
  if (b64.length > 21000000) {
    return { status: 400, message: 'The file is too large — up to 15MB.' };
  }
  var bytes = Utilities.base64Decode(b64);
  if (!bytes.length) return { status: 400, message: 'The file is empty.' };
  var file = taskFolderFor_(user).createFile(
    Utilities.newBlob(bytes, mime || 'application/octet-stream', name));
  // Shared with the uploader alone — never the admin list the hiring uploads use.
  try { hubShareWithUploader_(file, user); } catch (eSh) { /* owner access still stands */ }
  var url = 'https://drive.google.com/file/d/' + file.getId() + '/view';
  return { status: 200, data: { url: url, name: name, mime: mime } };
};

var TASK_PROJECT_FOLDER = '2025_07_28_new_project';

function taskFolderFor_(user) {
  var email = str_(user && user.email) || 'unknown';
  var cacheKey = 'task_folder_v3_' + sha256Hex_(email).slice(0, 16);
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get(cacheKey);
    if (hit) {
      try { return DriveApp.getFolderById(hit); } catch (eGone) {}
    }
  } catch (eC) { cache = null; }
  // The name search runs once; after that the saved id survives the project folder moving or being renamed.
  var proj = null;
  var savedId = str_(hubProp_('TASK_PROJECT_FOLDER_ID'));
  if (savedId) {
    try { proj = DriveApp.getFolderById(savedId); } catch (eById) { proj = null; }
  }
  if (!proj) {
    var projIt = DriveApp.getFoldersByName(TASK_PROJECT_FOLDER);
    proj = projIt.hasNext() ? projIt.next()
                            : DriveApp.getRootFolder().createFolder(TASK_PROJECT_FOLDER);
    try { hubPropSet_('TASK_PROJECT_FOLDER_ID', proj.getId()); } catch (eSet) {}
  }
  var byName = function (parent, name) {
    var it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
  };
  var folder = byName(byName(byName(byName(proj, 'app'), 'app-script'), 'Task Attachments'), email);
  try { if (cache) cache.put(cacheKey, folder.getId(), 21600); } catch (eP) {}
  return folder;
}
