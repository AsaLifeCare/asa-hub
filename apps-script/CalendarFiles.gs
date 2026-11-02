var CALENDAR_FILES_TAB = 'calendar_files';
var CALENDAR_FILES_HEADER = ['id', 'date', 'name', 'url', 'mime', 'by', 'at'];

function calendarFilesSheet_() {
  var sheet = hubTabEnsure_(CALENDAR_FILES_TAB, CALENDAR_FILES_HEADER);
  ensureHeader_(sheet, CALENDAR_FILES_HEADER);
  return sheet;
}

function calendarDayFolder_(date) {
  var month = String(date).slice(0, 7);
  var cacheKey = 'cal_folder_v1_' + month;
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get(cacheKey);
    if (hit) {
      try { return DriveApp.getFolderById(hit); } catch (eGone) {}
    }
  } catch (eC) { cache = null; }
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
  var folder = byName(byName(byName(byName(proj, 'app'), 'app-script'), 'Calendar Attachments'), month);
  try { if (cache) cache.put(cacheKey, folder.getId(), 21600); } catch (eP) {}
  return folder;
}

HUB_POLICY.calendarDayFileStore = {
  file: 'CalendarFiles.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: []
};
HUB_ACTIONS.calendarDayFileStore = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  var role = str_(user.role);
  if (role !== 'admin' && role !== 'manager' && role !== 'staff') return hubDenied_();
  var date = str_(payload.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { status: 400, message: 'A day (YYYY-MM-DD) is required.' };
  }
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
  var file = calendarDayFolder_(date).createFile(
    Utilities.newBlob(bytes, mime || 'application/octet-stream', name));
  // company-wide on purpose: link-shared view-only, unlike the uploader-only task attachments.
  var shareGate = (typeof hubGateHolds_ === 'function')
    ? hubGateHolds_('gate_calendar_file_link', {
        subject: 'link sharing on ' + name,
        body: 'a calendar day file published to anyone with the link: ' + name,
        purpose: 'a Drive publication this platform gated' })
    : { held: false };
  if (!shareGate.held) {
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (eSh) {}
  }
  var url = 'https://drive.google.com/file/d/' + file.getId() + '/view';
  var at = new Date().toISOString();
  var id = Utilities.getUuid();
  calendarFilesSheet_().appendRow([id, date, name, url, mime, str_(user.email), at]);
  var data = { id: id, date: date, name: name, url: url, mime: mime, by: str_(user.email), at: at };
  // A HELD PUBLICATION IS SAID IN THE ANSWER: the link opens for its owner only, and the screen says so.
  if (shareGate.held) {
    data.shared = false;
    data.shared_why = 'The file is pinned but private — only its owner can open the link. ' + String(shareGate.why || '');
  }
  return { status: 200, data: data };
};

HUB_POLICY.calendarDayFilesList = {
  file: 'CalendarFiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff', 'client'],
  invalidates: [], emits: []
};
HUB_ACTIONS.calendarDayFilesList = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  var from = str_(payload.from);
  var to = str_(payload.to);
  var out = [];
  try {
    // read through the router: a hard-wired HUB_DB would silently serve empty once the tab moves
    readTabNormalized_(hubTabWorkbook_(CALENDAR_FILES_TAB), CALENDAR_FILES_TAB).forEach(function (r) {
      var d = str_(r.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      if (from && d < from) return;
      if (to && d > to) return;
      out.push({ id: str_(r.id), date: d, name: str_(r.name), url: str_(r.url),
                 mime: str_(r.mime), by: str_(r.by), at: str_(r.at) });
    });
  } catch (e) {}
  return { status: 200, data: { files: out } };
};

// removes the row only; the Drive file stays because someone may still hold its shared link
HUB_POLICY.calendarDayFileRemove = {
  file: 'CalendarFiles.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: []
};
HUB_ACTIONS.calendarDayFileRemove = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  var id = str_(payload.id);
  if (!id) return { status: 400, message: 'Which file?' };
  var sheet = calendarFilesSheet_();
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (str_(values[i][0]) !== id) continue;
    var by = str_(values[i][5]);
    var role = str_(user.role);
    if (role !== 'admin' && role !== 'manager' && by !== str_(user.email)) {
      return { status: 403, message: 'Only the uploader or a manager can remove this.' };
    }
    sheet.deleteRow(i + 1);
    return { status: 200, data: { removed: id } };
  }
  return { status: 404, message: 'That file is not on the board.' };
};
