// The source documents never go into the repository: the contact list holds personal mobile numbers.


// one row per section: a cell holds 50,000 characters and a whole document runs past that
var POLICY_HEADERS = ['id', 'doc_id', 'title', 'collection', 'updatedAt', 'driveUrl',
                      'seq', 'heading', 'text'];

var POLICY_CELL_MAX = 40000;

function policySlug_(title) {
  return 'pol-' + String(title || '')
    .replace(/\.(pdf|docx?)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function policyIsHeading_(line) {
  var s = String(line || '').trim();
  if (s.length < 2 || s.length > 70) return false;
  if (/[.,;:]$/.test(s)) return false;
  if (/^\d/.test(s)) return false;
  if (s.split(/\s+/).length > 9) return false;
  return s === s.toUpperCase() || /^[A-Z]/.test(s);
}

function policySections_(text) {
  var lines = String(text || '').replace(/\u00a0/g, ' ').split(/\r?\n/);
  var out = [], cur = { heading: '', body: [] };
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    if (policyIsHeading_(line)) {
      if (cur.heading || cur.body.length) out.push(cur);
      cur = { heading: line, body: [] };
    } else {
      cur.body.push(line);
    }
  }
  if (cur.heading || cur.body.length) out.push(cur);
  var sections = [];
  for (var k = 0; k < out.length; k++) {
    if (!out[k].body.length && !out[k].heading) continue;
    sections.push({ heading: out[k].heading, text: out[k].body.join('\n') });
  }
  return sections;
}

function policyAuth_() {
  return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
}

function policyExportText_(fileId) {
  var res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId +
    '/export?mimeType=text/plain&supportsAllDrives=true',
    { headers: policyAuth_(), muteHttpExceptions: true });
  return res.getResponseCode() === 200 ? res.getContentText() : '';
}

/** Drive's export, never DocumentApp: its /auth/documents scope would send every user back through consent. */
function policyText_(file) {
  if (file.getMimeType() === MimeType.GOOGLE_DOCS) {
    return policyExportText_(file.getId());
  }
  var copyId = '';
  try {
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + file.getId() + '/copy?supportsAllDrives=true',
      {
        method: 'post',
        contentType: 'application/json',
        headers: policyAuth_(),
        payload: JSON.stringify({
          name: 'tmp-policy-' + file.getId(),
          mimeType: MimeType.GOOGLE_DOCS
        }),
        muteHttpExceptions: true
      });
    if (res.getResponseCode() !== 200) return '';
    copyId = String(JSON.parse(res.getContentText()).id || '');
    return copyId ? policyExportText_(copyId) : '';
  } catch (e) {
    return '';
  } finally {
    if (copyId) {
      try { DriveApp.getFileById(copyId).setTrashed(true); } catch (e2) {}
    }
  }
}

/** Pull the Drive folder into the `policies` tab, rewritten wholesale as a mirror of Drive. */
HUB_POLICY.policiesImport = {
  file: 'Policies.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.policiesImport = function (payload, user) {
  if (!user || user.role !== 'admin') return hubDenied_();
  var folderId = str_(payload && payload.folder_id) || hubId_('POLICIES_FOLDER_ID');
  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFiles();
  var rows = [], contacts = [], titles = [], skipped = [];

  while (files.hasNext()) {
    var file = files.next();
    var title = String(file.getName()).replace(/\.(pdf|docx?)$/i, '');
    var text = policyText_(file);
    if (!text) { skipped.push(file.getName()); continue; }

    var docId = policySlug_(file.getName());
    // contacts are their own resource: trainees read policies, only employees read personal mobiles
    var isContacts = /contact list/i.test(title);
    var target = isContacts ? contacts : rows;
    var meta = {
      doc_id: docId,
      title: title,
      collection: isContacts ? 'contacts' : 'policies',
      updatedAt: file.getLastUpdated().toISOString(),
      driveUrl: file.getUrl()
    };

    var sections = policySections_(text);
    for (var k = 0; k < sections.length; k++) {
      // an oversized section spans rows; the screen rejoins consecutive parts of one heading
      var body = sections[k].text;
      var part = 0;
      do {
        var slice = body.slice(0, POLICY_CELL_MAX);
        body = body.slice(POLICY_CELL_MAX);
        target.push({
          id: docId + '-' + (k + 1) + (part ? '-' + part : ''),
          doc_id: meta.doc_id, title: meta.title, collection: meta.collection,
          updatedAt: meta.updatedAt, driveUrl: meta.driveUrl,
          seq: target.length + 1,
          heading: part === 0 ? sections[k].heading : '',
          text: slice
        });
        part++;
      } while (body.length);
    }
    titles.push(title);
  }

  policiesWriteTab_('policies', rows);
  policiesWriteTab_('contactLists', contacts);

  return { status: 200, data: {
    imported: titles.length,
    titles: titles,
    policy_rows: rows.length,
    contact_rows: contacts.length,
    skipped: skipped
  } };
};

/** Rewrites wholesale: a row Drive dropped would show a retired policy as current. */
function policiesWriteTab_(tab, rows) {
  var sheet = ensureTab_(tab, POLICY_HEADERS);
  // the router may have created a three-column tab first, so the header is restated every time
  sheet.getRange(1, 1, 1, POLICY_HEADERS.length).setValues([POLICY_HEADERS]);
  if (sheet.getLastColumn() > POLICY_HEADERS.length) {
    sheet.getRange(1, POLICY_HEADERS.length + 1, 1,
                   sheet.getLastColumn() - POLICY_HEADERS.length).clearContent();
  }
  sheet.setFrozenRows(1);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }
  if (rows.length) {
    var values = rows.map(function (r) {
      return POLICY_HEADERS.map(function (h) { return hubCellSafe_(r[h]); });
    });
    sheet.getRange(2, 1, values.length, POLICY_HEADERS.length).setValues(values);
  }
  cacheBump_(tab);
}
