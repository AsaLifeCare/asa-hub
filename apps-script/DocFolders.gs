// A room is a registry key: nothing a caller sends can name a folder id.
var DOC_ROOMS = {
  interviews: { prop: 'INTERVIEW_DOCS_FOLDER_ID', siblingName: 'interviews',
                fallback: '19BJDdwj0_1kgASStvoPWr7TPRbf-G8Ob',
                roles: ['admin', 'manager'], write: true },
  invoices:   { prop: 'INVOICE_DOCS_FOLDER_ID', siblingName: 'invoices',
                roles: ['admin', 'manager'], write: true },
  // The Drive folder is named "Audit & Legal", not "auditory".
  audits:     { prop: 'AUDIT_DOCS_FOLDER_ID', siblingName: 'audit & legal',
                fallback: '13my33Eg3JPIhfmFxC8OPltngZpMWDIKz',
                roles: ['admin'], write: true, tree: true },
  training:   { prop: 'TRAINING_DOCS_FOLDER_ID', siblingName: 'training',
                roles: ['admin', 'manager', 'staff'], write: false },
  isp:        { prop: 'ISP_DOCS_FOLDER_ID', siblingName: '',
                roles: ['admin', 'manager'], write: true },
  houses:     { prop: 'HOUSE_DOCS_FOLDER_ID', siblingName: 'house _ client books',
                roles: ['admin', 'manager'], write: true, tree: true }
};

var DOC_ROOM_LIST_CAP = 400;

function docRoomFamily_() {
  try {
    var adminId = hubProp_('ADMIN_DOCS_FOLDER_ID');
    if (!adminId) return '';
    var parents = DriveApp.getFolderById(adminId).getParents();
    return parents.hasNext() ? parents.next().getId() : '';
  } catch (e) { return ''; }
}

// Property, then fallback, then a same-named sibling of the Administration folder (cached, never stored as a property).
function docRoomFolderId_(key) {
  var room = DOC_ROOMS[key];
  if (!room) return '';
  var id = '';
  try { id = str_(hubProp_(room.prop)); } catch (eP) { id = ''; }
  if (id) return id;
  if (room.fallback) return room.fallback;
  if (!room.siblingName) return '';
  var cache = null, ck = 'docroom_' + key;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get(ck);
    if (hit) return hit;
  } catch (eC) { cache = null; }
  var family = docRoomFamily_();
  if (!family) return '';
  try {
    var want = room.siblingName.toLowerCase();
    var kids = DriveApp.getFolderById(family).getFolders();
    while (kids.hasNext()) {
      var f = kids.next();
      if (String(f.getName()).trim().toLowerCase() === want) {
        var found = f.getId();
        if (cache) { try { cache.put(ck, found, 21600); } catch (eW) {} }
        return found;
      }
    }
  } catch (eF) { return ''; }
  return '';
}

function docRoomFolder_(key) {
  var id = docRoomFolderId_(key);
  if (!id) {
    return { folder: null, reason: 'The "' + key + '" folder is not configured and could not ' +
             'be found beside the Administration folder — set the ' +
             ((DOC_ROOMS[key] || {}).prop || 'folder id') + ' property.' };
  }
  try {
    var folder = DriveApp.getFolderById(id);
    if (folder.isTrashed()) return { folder: null, reason: 'The configured folder is in the trash.' };
    return { folder: folder, id: id };
  } catch (e) {
    return { folder: null, reason: 'The platform cannot open the "' + key + '" folder — check that ' +
             'asatech@asalifecare.com has access to it.' };
  }
}

// The policy roles are the union of every room; the room's own list decides here.
function docRoomMayRead_(key, user) {
  var room = DOC_ROOMS[key];
  if (!room || !user || user.is_service) return false;
  if (str_(user.role) === 'admin') return true;
  return room.roles.indexOf(str_(user.role)) !== -1;
}

function docRoomFileShape_(f, category, casePath) {
  return {
    id: f.getId(), name: f.getName(), mime: f.getMimeType(),
    size_bytes: f.getSize(), modified_time: f.getLastUpdated().toISOString(),
    web_view_link: f.getUrl(),
    category: category || '', case_path: casePath || ''
  };
}

/** The room's files. */
HUB_POLICY.docRoomList = {
  file: 'DocFolders.gs', lane: 'read', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: []
};
HUB_ACTIONS.docRoomList = function (payload, user) {
  var key = str_(payload && payload.room);
  if (!DOC_ROOMS[key]) return { status: 400, message: 'room: one of ' + Object.keys(DOC_ROOMS).join(', ') };
  if (!docRoomMayRead_(key, user)) return { status: 404, message: 'Unknown action.' };
  var found = docRoomFolder_(key);
  if (!found.folder) return { status: 200, data: { configured: false, reason: found.reason, files: [] } };
  var out = [];
  try {
    if (DOC_ROOMS[key].tree) {
      var cats = found.folder.getFolders();
      while (cats.hasNext() && out.length < DOC_ROOM_LIST_CAP) {
        var cat = cats.next(); var catName = cat.getName();
        var direct = cat.getFiles();
        while (direct.hasNext() && out.length < DOC_ROOM_LIST_CAP) {
          out.push(docRoomFileShape_(direct.next(), catName, ''));
        }
        var cases = cat.getFolders();
        while (cases.hasNext() && out.length < DOC_ROOM_LIST_CAP) {
          var cs = cases.next(); var csName = cs.getName();
          var files = cs.getFiles();
          while (files.hasNext() && out.length < DOC_ROOM_LIST_CAP) {
            out.push(docRoomFileShape_(files.next(), catName, csName));
          }
        }
      }
      var loose = found.folder.getFiles();
      while (loose.hasNext() && out.length < DOC_ROOM_LIST_CAP) {
        out.push(docRoomFileShape_(loose.next(), '', ''));
      }
    } else {
      var it = found.folder.getFiles();
      while (it.hasNext() && out.length < DOC_ROOM_LIST_CAP) {
        out.push(docRoomFileShape_(it.next(), '', ''));
      }
    }
  } catch (e) {
    return { status: 502, message: 'Drive refused the listing: ' + String((e && e.message) || e).slice(0, 120) };
  }
  out.sort(function (a, b) { return a.modified_time < b.modified_time ? 1 : -1; });
  return { status: 200, data: { configured: true, room: key,
                                folder_name: found.folder.getName(),
                                truncated: out.length >= DOC_ROOM_LIST_CAP,
                                writable: !!DOC_ROOMS[key].write, files: out } };
};

/** Upload one file into a room — libraryUpload's discipline: base64 in, one createFile, access inherited from the folder, every write logged. */
HUB_POLICY.docRoomUpload = {
  file: 'DocFolders.gs', lane: 'write', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.docRoomUpload = function (payload, user) {
  var key = str_(payload && payload.room);
  var room = DOC_ROOMS[key];
  if (!room) return { status: 400, message: 'room: one of ' + Object.keys(DOC_ROOMS).join(', ') };
  if (!docRoomMayRead_(key, user)) return { status: 404, message: 'Unknown action.' };
  if (!room.write) return { status: 403, message: 'This room is read-only.' };
  if (!hubIsWriter_(user)) return hubDenied_();
  var name = str_(payload && payload.filename).slice(0, 180);
  var b64 = str_(payload && payload.base64);
  if (!name || !b64) return { status: 400, message: 'filename and base64 are required.' };
  var found = docRoomFolder_(key);
  if (!found.folder) return { status: 503, message: found.reason };
  try {
    var bytes = Utilities.base64Decode(b64);
    var mime = str_(payload && payload.mime) || 'application/octet-stream';
    var file = found.folder.createFile(Utilities.newBlob(bytes, mime, name));
    hubSysLog_(str_(user.email), 'doc_room_upload', key + ' — ' + name, { status: 200 });
    return { status: 200, data: docRoomFileShape_(file, '', '') };
  } catch (e) {
    return { status: 502, message: 'Drive refused the upload: ' + String((e && e.message) || e).slice(0, 120) };
  }
};

/** Trash (never remove) a file that provably lives inside the room. */
HUB_POLICY.docRoomTrash = {
  file: 'DocFolders.gs', lane: 'write', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.docRoomTrash = function (payload, user) {
  var key = str_(payload && payload.room);
  var room = DOC_ROOMS[key];
  if (!room) return { status: 400, message: 'room: one of ' + Object.keys(DOC_ROOMS).join(', ') };
  if (!user || str_(user.role) !== 'admin') return hubDenied_();
  if (!room.write) return { status: 403, message: 'This room is read-only.' };
  var fileId = str_(payload && payload.id);
  if (!fileId) return { status: 400, message: 'id is required.' };
  var found = docRoomFolder_(key);
  if (!found.folder) return { status: 503, message: found.reason };
  try {
    var file = DriveApp.getFileById(fileId);
    // Membership is walked, never trusted: the file must sit within two levels of the room.
    var ok = false;
    var parents = file.getParents();
    while (parents.hasNext() && !ok) {
      var p = parents.next();
      if (p.getId() === found.id) { ok = true; break; }
      var gp = p.getParents();
      while (gp.hasNext() && !ok) {
        var g = gp.next();
        if (g.getId() === found.id) { ok = true; break; }
        var ggp = g.getParents();
        while (ggp.hasNext() && !ok) {
          if (ggp.next().getId() === found.id) ok = true;
        }
      }
    }
    if (!ok) return { status: 403, message: 'That file is not inside the "' + key + '" room.' };
    file.setTrashed(true);
    hubSysLog_(str_(user.email), 'doc_room_trash', key + ' — ' + file.getName(), { status: 200 });
    return { status: 200, data: { trashed: true, id: fileId } };
  } catch (e) {
    return { status: 502, message: 'Drive refused: ' + String((e && e.message) || e).slice(0, 120) };
  }
};
