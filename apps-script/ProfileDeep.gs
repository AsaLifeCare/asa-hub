var PROFILE_DRIVE_ROOT_PROPS = ['COMPLIANCE_SHARED_FOLDER_ID', 'PENDING_DOCS_FOLDER_ID'];
function profileDriveRoots_() {
  return PROFILE_DRIVE_ROOT_PROPS
    .map(function (k) { return hubId_(k); })
    .filter(function (v) { return !!v; });
}
var PROFILE_DEEP_CACHE_SECONDS = 6 * 3600;
// One row per user; the page reads the stored profile, re-assembled only when stale or on Refresh.
var PROFILE_STORE_TAB = 'entity_user_profiles';
var PROFILE_STORE_HEADER = ['user_id', 'name', 'name_key', 'updated_at', 'summary', 'payload'];
var PROFILE_STALE_HOURS = 6;

function profileStoreSheet_() {
  return hubTabEnsure_(PROFILE_STORE_TAB, PROFILE_STORE_HEADER);
}

function profileStoreGet_(uid) {
  try {
    var values = profileStoreSheet_().getDataRange().getValues();
    var hdr = values[0].map(normKey_);
    var iId = hdr.indexOf('userid'), iAt = hdr.indexOf('updatedat'), iPay = hdr.indexOf('payload');
    for (var r = values.length - 1; r >= 1; r--) {
      if (str_(values[r][iId]) !== uid) continue;
      var at = str_(values[r][iAt]);
      var ageH = at ? (Date.now() - new Date(at).getTime()) / 3600000 : 9999;
      var payload = null;
      try { payload = JSON.parse(str_(values[r][iPay])); } catch (eP) { payload = null; }
      if (!payload) return null;
      payload.stored_at = at;
      return { payload: payload, ageHours: ageH };
    }
  } catch (e) {}
  return null;
}

// Called by userUpdate: a save must never redraw from the store.
function profileStoreStale_(uid) {
  var sheet = profileStoreSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('userid'), iAt = hdr.indexOf('updatedat');
  if (iId === -1 || iAt === -1) return;
  for (var r = values.length - 1; r >= 1; r--) {
    if (str_(values[r][iId]) === str_(uid)) sheet.getRange(r + 1, iAt + 1).setValue('');
  }
}

// Snippets are never stored: they would exceed the 50k cell limit.
function profileStorePut_(uid, out) {
  var slim = {};
  for (var k in out) { if (out.hasOwnProperty(k) && k !== 'snippets') slim[k] = out[k]; }
  var at = new Date().toISOString();
  var blob = JSON.stringify(slim);
  if (blob.length > 45000) {
    slim.files = (slim.files || []).slice(0, 15);
    blob = JSON.stringify(slim);
    if (blob.length > 45000) blob = blob.slice(0, 45000);
  }
  var sheet = profileStoreSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('userid');
  var target = 0;
  for (var r = 1; r < values.length; r++) {
    if (str_(values[r][iId]) === uid) target = r + 1;
  }
  var line = [uid, str_(out.name), str_(out.name_key || ''), at, str_(out.summary).slice(0, 2000), blob];
  if (target) sheet.getRange(target, 1, 1, PROFILE_STORE_HEADER.length).setValues([line]);
  else sheet.appendRow(line);
  return at;
}
var PROFILE_DOC_SNIPPET_CHARS = 3000;
var PROFILE_DOC_SNIPPET_FILES = 4;

// A name seen twice becomes ambiguous: a guessed folder is worse than none.
function profileDriveIndex_() {
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get('profile_drive_idx_v1');
    if (hit) return JSON.parse(hit);
  } catch (e) { cache = null; }
  var idx = { folders: {}, unreadable: [] };
  profileDriveRoots_().forEach(function (rootId) {
    try {
      var root = DriveApp.getFolderById(rootId);
      var it = root.getFolders();
      while (it.hasNext()) {
        var f = it.next();
        var key = '';
        try { key = clientNameKey_(f.getName()); } catch (eK) { key = ''; }
        if (!key) continue;
        if (idx.folders[key]) { idx.folders[key] = { ambiguous: true }; continue; }
        idx.folders[key] = { name: f.getName(), id: f.getId(), url: f.getUrl(), root: rootId };
      }
    } catch (eR) {
      idx.unreadable.push(rootId.slice(0, 12) + '…');
    }
  });
  try { if (cache) cache.put('profile_drive_idx_v1', JSON.stringify(idx), PROFILE_DEEP_CACHE_SECONDS); } catch (e2) {}
  return idx;
}

function profileDriveFiles_(folderId) {
  var out = [];
  try {
    var it = DriveApp.getFolderById(folderId).getFiles();
    var n = 0;
    while (it.hasNext() && n < 40) {
      var f = it.next();
      out.push({
        name: f.getName(), id: f.getId(), url: f.getUrl(),
        mime: f.getMimeType(), updated: f.getLastUpdated().toISOString().slice(0, 10)
      });
      n++;
    }
  } catch (e) {}
  out.sort(function (a, b) { return a.updated < b.updated ? 1 : -1; });
  return out;
}

// PDFs and images are listed, never read.
function profileDocSnippets_(files) {
  var snippets = [];
  for (var i = 0; i < files.length && snippets.length < PROFILE_DOC_SNIPPET_FILES; i++) {
    var f = files[i];
    var text = '';
    try {
      if (f.mime === 'application/vnd.google-apps.document') {
        var res = UrlFetchApp.fetch(
          'https://docs.google.com/document/d/' + f.id + '/export?format=txt',
          { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
            muteHttpExceptions: true });
        if (res.getResponseCode() === 200) text = res.getContentText();
      } else if (String(f.mime).indexOf('text/') === 0) {
        text = DriveApp.getFileById(f.id).getBlob().getDataAsString();
      }
    } catch (e) { text = ''; }
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (text) snippets.push({ file: f.name, text: text.slice(0, PROFILE_DOC_SNIPPET_CHARS) });
  }
  return snippets;
}

function profileSynthesize_(name, facts) {
  try {
    var chat = screenAiChat_(
      'Write a work profile of ' + name + ' for their manager, from THESE FACTS ' +
      'ONLY — never invent, never guess dates. Facts: ' + JSON.stringify(facts).slice(0, 9000) +
      '. Answer with JSON: {"summary": "4-6 sentences, plain and useful", ' +
      '"highlights": ["up to 6 short bullet facts worth a glance"]}.', 0.2, 'ai_profile_summary');
    var parsed = null;
    try { parsed = JSON.parse(str_(chat && chat.content)); } catch (eJ) { parsed = null; }
    if (chat && chat.ok && parsed && str_(parsed.summary)) {
      return {
        summary: str_(parsed.summary).slice(0, 2000),
        highlights: (Array.isArray(parsed.highlights) ? parsed.highlights : [])
          .map(function (h) { return str_(h).slice(0, 160); }).filter(String).slice(0, 6),
        via: str_(chat.via)
      };
    }
  } catch (e) {}
  return { summary: '', highlights: [], via: '' };
}

HUB_POLICY.userProfileDeep = {
  file: 'ProfileDeep.gs', lane: 'read', store: 'drive',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.userProfileDeep = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var uid = str_(payload.user_id);
  if (!uid) return { status: 400, message: 'user_id is required' };
  var found = tenantUserRow_(uid);
  if (found.error) return found.error;
  var row = found.row;
  var name = str_(row.displayname) || str_(row.email);
  var key = '';
  try { key = clientNameKey_(name); } catch (e0) { key = ''; }

  var stored = profileStoreGet_(uid);
  if (payload.refresh !== true && stored && stored.ageHours < PROFILE_STALE_HOURS) {
    return { status: 200, data: stored.payload };
  }

  var out = { name: name, sources: [], unreadable: [] };

  // A client-linked account reads its ISP, never the staff sources.
  if (str_(row.clientkey)) {
    try {
      var cRows = clientsDerived_(user);
      var rec = null;
      for (var ci = 0; ci < cRows.length; ci++) {
        if (str_(cRows[ci].client_key) === str_(row.clientkey)) { rec = cRows[ci]; break; }
      }
      if (rec) {
        out.sources.push('client record (ISP)');
        out.client_key = str_(row.clientkey);
        out.summary = str_(rec.summary);
        out.ai_via = 'isp';
        var hl = [];
        if (str_(rec.dob)) hl.push('DOB ' + str_(rec.dob));
        var gname = str_(rec.guardianName) || str_(rec.guardian_name);
        if (gname && gname.toLowerCase() !== 'self') hl.push('Guardian: ' + gname);
        if (str_(rec.funding_source)) hl.push('Funding: ' + str_(rec.funding_source));
        if (str_(rec.supervision_level)) hl.push(str_(rec.supervision_level));
        out.highlights = hl;
        out.files = str_(rec.isp_doc_url)
          ? [{ name: str_(rec.isp_doc_name) || ('ISP — ' + str_(rec.name)),
               id: '', url: str_(rec.isp_doc_url), mime: 'application/pdf', updated: str_(rec.isp_year) }]
          : [];
        try {
          // listRows_ keys rows by the raw header, so both spellings are read.
          var ihRows = listRows_('istHouses', {});
          var ckName = clientNameKey_(str_(rec.name));
          for (var hi = 0; hi < ihRows.length; hi++) {
            var ih = ihRows[hi];
            var ihName = str_(ih.clientName || ih.clientname);
            var ihActive = str_(ih.active || ih.Active).toLowerCase();
            if (!ihName || ihActive === 'no') continue;
            if (clientNameKey_(ihName) !== ckName) continue;
            out.house = { code: str_(ih.house || ih.House),
                          name: str_(ih.houseName || ih.housename) };
            break;
          }
        } catch (eH) { out.unreadable.push('ist_houses'); }
        if (str_(rec.home_address)) {
          out.house = out.house || { code: '', name: '' };
          out.house.address = str_(rec.home_address);
        }
        if (out.house && out.house.code) {
          try {
            var phRows = listRows_('photos', {});
            for (var pi = 0; pi < phRows.length; pi++) {
              var ph = phRows[pi];
              if (str_(ph.title).trim().toUpperCase() === out.house.code.toUpperCase() &&
                  str_(ph.hidden).toLowerCase() !== 'true') {
                out.house.photo = str_(ph.src);
                break;
              }
            }
          } catch (eP) {}
        }
        try {
          var cf = { isp_summary: str_(rec.summary).slice(0, 1500),
                     dob: str_(rec.dob), guardian: gname || '',
                     funding: str_(rec.funding_source),
                     supervision: str_(rec.supervision_level),
                     house: out.house || null };
          var cai = profileSynthesize_(str_(rec.name), cf);
          if (cai && str_(cai.summary)) {
            out.summary = cai.summary;
            if (cai.highlights && cai.highlights.length) out.highlights = cai.highlights;
            out.ai_via = cai.via || 'ai';
          }
        } catch (eAI) {}
      } else {
        out.unreadable.push('client record (key ' + str_(row.clientkey) + ' not on the clients slice)');
      }
    } catch (eCl) {
      out.unreadable.push('client record (' + String((eCl && eCl.message) || eCl) + ')');
    }
    try { out.stored_at = profileStorePut_(uid, out); }
    catch (eSt) { out.stored_at = ''; out.store_note = 'assembled but NOT saved'; }
    return { status: 200, data: out };
  }

  // ---- the roster ----
  try {
    var roster = [];
    listRows_('people', {}).forEach(function (p) {
      var pk = '';
      try { pk = clientNameKey_(str_(p.name)); } catch (e1) { pk = ''; }
      if (pk && pk === key) {
        roster.push({ name: str_(p.name), email: str_(p.email), phone: str_(p.phone),
                      role: str_(p.role), department: str_(p.department), location: str_(p.location) });
      }
    });
    if (roster.length) { out.roster = roster[0]; out.sources.push('People roster'); }
    // Stamps a missing phone onto the users tab: fill-blank only, unique roster match only.
    try {
      if (roster.length === 1 && str_(roster[0].phone) && !str_(row.phone)) {
        var shU = hubSheet_(USERS_TAB);
        var vU = shU.getDataRange().getValues();
        var hU = vU[0].map(normKey_);
        var iIdU = hU.indexOf('userid'), iPhU = hU.indexOf('phone');
        for (var rU = 1; rU < vU.length; rU++) {
          if (str_(vU[rU][iIdU]) !== uid) continue;
          if (iPhU !== -1 && !str_(vU[rU][iPhU])) {
            shU.getRange(rU + 1, iPhU + 1).setValue(str_(roster[0].phone));
          }
          break;
        }
      }
    } catch (eF) {}
  } catch (e2) { out.unreadable.push('people roster'); }

  // ---- the certifications, with their dates ----
  try {
    var pic = certPicture_()[key];
    if (pic && pic.certs) {
      var certs = [];
      for (var ck in pic.certs) {
        if (!pic.certs.hasOwnProperty(ck)) continue;
        var cv = pic.certs[ck];
        certs.push({ cert: ck, date: str_(cv && (cv.date || cv.expires || cv)) });
      }
      if (certs.length) { out.certs = certs; out.sources.push('estate certifications'); }
    }
  } catch (e3) { out.unreadable.push('certifications'); }

  // ---- the shifts: houses, count, first/last day ----
  try {
    var houses = {}, count = 0, first = '', last = '';
    listRows_('shifts', {}).forEach(function (s) {
      var sk = '';
      try { sk = clientNameKey_(str_(s.staff)); } catch (e4) { sk = ''; }
      if (!sk || sk !== key) return;
      count++;
      houses[str_(s.house)] = true;
      var d = str_(s.date);
      if (d && (!first || d < first)) first = d;
      if (d && (!last || d > last)) last = d;
    });
    if (count) {
      out.shifts = { count: count, houses: Object.keys(houses), first: first, last: last };
      out.sources.push('shift roster');
    }
  } catch (e5) { out.unreadable.push('shifts'); }

  // ---- IST records naming them ----
  try {
    var ists = [];
    listRows_('ist', {}).forEach(function (r) {
      var ik = '';
      try { ik = clientNameKey_(str_(r.staff || r.employee || r.name)); } catch (e6) { ik = ''; }
      if (ik && ik === key) {
        ists.push({ client: str_(r.client), house: str_(r.house),
                    status: str_(r.status), due: str_(r.due || r.dueat) });
      }
    });
    if (ists.length) { out.ist = ists.slice(0, 20); out.sources.push('IST records'); }
  } catch (e7) {}

  // ---- their folder in the Drive roots ----
  var idx = profileDriveIndex_();
  (idx.unreadable || []).forEach(function (u2) { out.unreadable.push('drive root ' + u2); });
  var hitF = key ? idx.folders[key] : null;
  if (hitF && hitF.ambiguous) {
    out.unreadable.push('drive folder (two folders carry this name — not guessing)');
  } else if (hitF) {
    out.folder = { name: hitF.name, url: hitF.url };
    out.files = profileDriveFiles_(hitF.id);
    out.sources.push('Drive folder (' + out.files.length + ' files)');
    var snips = profileDocSnippets_(out.files);
    if (snips.length) {
      out.snippets = snips;
      out.sources.push('document text (' + snips.length + ' read)');
    }
  }

  // ---- the synthesis ----
  var facts = { roster: out.roster, certs: out.certs, shifts: out.shifts,
                ist: out.ist, files: (out.files || []).map(function (f) { return f.name; }),
                document_excerpts: out.snippets };
  var ai = profileSynthesize_(name, facts);
  out.summary = ai.summary;
  out.highlights = ai.highlights;
  out.ai_via = ai.via;

  out.name_key = key;
  try {
    out.stored_at = profileStorePut_(uid, out);
  } catch (e8) {
    out.unreadable.push('profile store (assembled but NOT saved)');
    try { hubSysLog_('asa-hub:profile-deep', 'profile_store_failed',
                     uid + ' — ' + String((e8 && e8.message) || e8), { status: 500 }); } catch (eL) {}
  }
  return { status: 200, data: out };
};

// Kept apart from profileDriveRoots_: merging the indexes would make matched people ambiguous.
var USER_DOCS_IDX_CACHE = 'user_docs_idx_v1';
var USER_DOCS_LOOSE_CACHE = 'user_docs_loose_v1';
var USER_DOCS_CATEGORY_ORDER = ['Background Checks', 'Medical', 'Driving', 'Training', 'Other'];

function userDocsIndex_() {
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get(USER_DOCS_IDX_CACHE);
    if (hit) return JSON.parse(hit);
  } catch (e) { cache = null; }
  var idx = { folders: {}, unreadable: false };
  try {
    var it = DriveApp.getFolderById(hubId_('PROFILE_USER_DOCS_ROOT')).getFolders();
    while (it.hasNext()) {
      var f = it.next();
      var key = '';
      try { key = clientNameKey_(f.getName()); } catch (eK) { key = ''; }
      if (!key) continue;
      if (idx.folders[key]) { idx.folders[key] = { ambiguous: true }; continue; }
      idx.folders[key] = { name: f.getName(), id: f.getId(), url: f.getUrl() };
    }
  } catch (eR) { idx.unreadable = true; }
  try { if (cache) cache.put(USER_DOCS_IDX_CACHE, JSON.stringify(idx), PROFILE_DEEP_CACHE_SECONDS); } catch (e2) {}
  return idx;
}

function userDocsLooseAll_() {
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get(USER_DOCS_LOOSE_CACHE);
    if (hit) return JSON.parse(hit);
  } catch (e) { cache = null; }
  var out = [];
  try {
    var it = DriveApp.getFolderById(hubId_('PROFILE_USER_DOCS_ROOT')).getFiles();
    var n = 0;
    while (it.hasNext() && n < 500) {
      var f = it.next();
      out.push({ name: f.getName(), id: f.getId(), url: f.getUrl(),
                 mime: f.getMimeType(), updated: f.getLastUpdated().toISOString().slice(0, 10) });
      n++;
    }
  } catch (e3) {}
  try { if (cache) cache.put(USER_DOCS_LOOSE_CACHE, JSON.stringify(out), PROFILE_DEEP_CACHE_SECONDS); } catch (e4) {}
  return out;
}

HUB_POLICY.userDriveDocs = {
  file: 'ProfileDeep.gs', lane: 'read', store: 'drive',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  params: { user_id: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.userDriveDocs = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var uid = str_(payload.user_id);
  if (!uid) return { status: 400, message: 'user_id is required' };
  var found = tenantUserRow_(uid);
  if (found.error) return found.error;
  var row = found.row;
  var name = str_(row.displayname) || str_(row.email);
  var key = '';
  try { key = clientNameKey_(name); } catch (e0) { key = ''; }

  var out = { name: name, folder: null, groups: [], loose: [], ambiguous: false, root_unreadable: false };

  var idx = userDocsIndex_();
  out.root_unreadable = !!idx.unreadable;
  var hit = key ? idx.folders[key] : null;
  if (hit && hit.ambiguous) { out.ambiguous = true; hit = null; }
  if (hit) {
    out.folder = { id: hit.id, name: hit.name, url: hit.url };
    var groups = {};
    try {
      var subs = DriveApp.getFolderById(hit.id).getFolders();
      while (subs.hasNext()) {
        var sub = subs.next();
        var files = profileDriveFiles_(sub.getId());
        if (files.length) groups[sub.getName()] = files;
      }
    } catch (eS) {}
    var seen = {};
    USER_DOCS_CATEGORY_ORDER.forEach(function (cat) {
      if (groups[cat]) { out.groups.push({ name: cat, files: groups[cat] }); seen[cat] = true; }
    });
    Object.keys(groups).sort().forEach(function (cat) {
      if (!seen[cat]) out.groups.push({ name: cat, files: groups[cat] });
    });
  }

  // Plain case-insensitive contains, never fuzzy matching.
  var needle = name.replace(/\s+/g, ' ').trim().toLowerCase();
  if (needle.length >= 5) {
    userDocsLooseAll_().forEach(function (f) {
      if (String(f.name).toLowerCase().indexOf(needle) !== -1) out.loose.push(f);
    });
    out.loose.sort(function (a, b) { return a.updated < b.updated ? 1 : -1; });
  }

  return { status: 200, data: out };
};
