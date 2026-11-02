var STAFF_DOCS_SHEET_TAB = 'Responses';

// The archive gives presence only; dates come from the form, never from a filename.
function staffDocsFolderId_() { return hubId_('COMPLIANCE_SHARED_FOLDER_ID'); }

var STAFF_DOCS_CACHE_KEY = 'staff_docs_index_v1';
var STAFF_DOCS_CACHE_SECONDS = 900;
var STAFF_DOCS_MAX_PAGES = 4;

var STAFF_DOC_TYPES = [
  { prior: 'DODD Training Certificate', id: 'dodd_8hr', course: 'dodd', col: 'dodd_8_hour_exp' },
  { prior: 'CPR / 1st Aid Certificate', id: 'cpr', course: 'cpr', col: 'cpr_exp_date' },
  { prior: 'Drivers License / OH ID', id: 'drivers_license', col: 'license_exp_date' },
  { prior: 'Car Insurance Card', id: 'car_insurance', col: 'insurance_exp_date' },
  { prior: 'HS Diploma / Transcripts / GED', id: 'hs_diploma', col: '' },
  { prior: 'Social Security Card / Birth Certificate', id: 'ss_birth_cert', col: '' },
  { prior: 'Med Del Cert', id: 'med_del', col: '',
    refuse: 'the delegation engine owns the Med Del dates' }
];

function staffDocType_(label) {
  var want = String(label || '').trim().toLowerCase();
  for (var i = 0; i < STAFF_DOC_TYPES.length; i++) {
    if (STAFF_DOC_TYPES[i].prior.toLowerCase() === want) return STAFF_DOC_TYPES[i];
  }
  return null;
}

// The course's column in the settings first; the typed one is the floor.
function staffDocsCol_(known) {
  if (!known) return '';
  if (known.course && typeof certMasterColumnsFor_ === 'function') {
    try {
      var named = certMasterColumnsFor_(known.course);
      if (named.length) return named[0];
    } catch (e) { /* the typed column answers */ }
  }
  return known.col || '';
}

function staffDocsKey_(name) {
  return String(name || '').toLowerCase().replace(/[^a-z]/g, '');
}

// No Date is constructed: parsing then reformatting a plain day can shift it.
function staffDocsDate_(stamp) {
  var m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(stamp || ''));
  if (!m) return '';
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return m[1] + '-' + m[2] + '-' + m[3];
}

function staffDocsParse_(filename) {
  var base = String(filename || '').replace(/\.[a-z0-9]{2,5}$/i, '');
  var parts = base.split(' - ');
  if (parts.length < 2) return null;
  var name = parts[0].trim();
  var stamp = '';
  var last = parts[parts.length - 1].trim();
  if (/^\d{8}$/.test(last)) { stamp = last; parts.pop(); }
  var type = parts.slice(1).join(' - ').trim();
  if (!name || !type) return null;
  // The filename date is only stripped, never returned.
  return { name: name, type: type, stampSeen: !!stamp };
}

function staffDocsIndex_() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(STAFF_DOCS_CACHE_KEY);
    if (hit) return JSON.parse(hit);
  } catch (e) { }

  var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  var byPerson = {}, page = '', pages = 0, seen = 0, truncated = false;
  do {
    var url = 'https://www.googleapis.com/drive/v3/files?' +
      'q=' + encodeURIComponent("'" + staffDocsFolderId_() + "' in parents and trashed=false") +
      '&fields=' + encodeURIComponent('nextPageToken,files(id,name,modifiedTime)') +
      '&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true' +
      (page ? '&pageToken=' + encodeURIComponent(page) : '');
    var res = UrlFetchApp.fetch(url, { headers: auth, muteHttpExceptions: true });
    if (res.getResponseCode() >= 400) {
      // Unreadable is not empty: "no documents" would ask for papers already handed in.
      return { error: 'The document archive could not be read (HTTP ' +
               res.getResponseCode() + ').' };
    }
    var body = JSON.parse(res.getContentText());
    (body.files || []).forEach(function (f) {
      seen++;
      var p = staffDocsParse_(f.name);
      if (!p) return;
      var known = staffDocType_(p.type);
      var key = staffDocsKey_(p.name);
      if (!key) return;
      if (!byPerson[key]) byPerson[key] = { name: p.name, docs: [] };
      byPerson[key].docs.push({
        type: p.type, id: known ? known.id : '', col: staffDocsCol_(known),
        refuse: known && known.refuse ? known.refuse : '',
        fileId: f.id, at: f.modifiedTime
      });
    });
    page = body.nextPageToken || '';
    pages++;
    if (page && pages >= STAFF_DOCS_MAX_PAGES) { truncated = true; break; }
  } while (page);

  var out = { people: byPerson, filesSeen: seen, truncated: truncated };
  try { cache.put(STAFF_DOCS_CACHE_KEY, JSON.stringify(out), STAFF_DOCS_CACHE_SECONDS); }
  catch (e2) { }
  return out;
}

function staffDocsDay_(v) {
  var s = str_(v);
  if (!s) return '';
  var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  var us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (us) {
    var mo = us[1].length === 1 ? '0' + us[1] : us[1];
    var d = us[2].length === 1 ? '0' + us[2] : us[2];
    return us[3] + '-' + mo + '-' + d;
  }
  return '';
}

function staffDocsDated_() {
  var rows = [];
  try {
    rows = readTabNormalized_(ssOpen_(hubId_('STAFF_DOCS_SHEET_ID')), STAFF_DOCS_SHEET_TAB);
  } catch (e) {
    return { error: 'The staff documentation form could not be read.' };
  }
  var out = [], certOnly = 0, undated = 0, unknownType = 0;
  rows.forEach(function (r) {
    var name = str_(r.yourname);
    var label = str_(r.selectdocument);
    if (!name || !label) return;
    var known = staffDocType_(label);
    if (!known) { unknownType++; return; }
    var exp = staffDocsDay_(r.dateofexpiration);
    var cert = staffDocsDay_(r.dateofcertification);
    if (!exp) { if (cert) certOnly++; else undated++; return; }
    var col = staffDocsCol_(known);
    if (!col || known.refuse) return;
    out.push({ key: staffDocsKey_(name), name: name, type: label,
               field: col, expires: exp, certified: cert,
               link: str_(r.uploadyourdocumentonedocumentperphoto) });
  });
  // Newest expiry LAST per person+field wins: a renewal supersedes.
  out.sort(function (a, b) { return String(a.expires).localeCompare(String(b.expires)); });
  var best = {};
  out.forEach(function (d) { best[d.key + '|' + d.field] = d; });
  var latest = [];
  for (var k in best) if (Object.prototype.hasOwnProperty.call(best, k)) latest.push(best[k]);
  return { dated: latest, certOnly: certOnly, undated: undated, unknownType: unknownType };
}

var STAFF_DOCS_FORM_MEMO = null;

function staffDocsFormIndex_() {
  if (STAFF_DOCS_FORM_MEMO) return STAFF_DOCS_FORM_MEMO;
  var out = { ok: true, people: {} };
  try {
    readTabNormalized_(ssOpen_(hubId_('STAFF_DOCS_SHEET_ID')), STAFF_DOCS_SHEET_TAB)
      .forEach(function (r) {
        var key = staffDocsKey_(r.yourname);
        if (!key) return;
        if (!out.people[key]) out.people[key] = { name: str_(r.yourname), rows: [] };
        out.people[key].rows.push(r);
      });
  } catch (e) {
    return { ok: false, people: {} };
  }
  STAFF_DOCS_FORM_MEMO = out;
  return out;
}

// A blank name answers nothing, never everything.
function staffDocsFor_(name) {
  var key = staffDocsKey_(name);
  if (!key) return null;
  var docs = [], who = str_(name);
  var form = staffDocsFormIndex_();
  var mine = form.people[key];
  if (mine) {
    who = mine.name || who;
    mine.rows.forEach(function (r) {
      docs.push({ type: str_(r.selectdocument), from: 'form',
                  link: str_(r.uploadyourdocumentonedocumentperphoto),
                  expires: staffDocsDay_(r.dateofexpiration),
                  certified: staffDocsDay_(r.dateofcertification) });
    });
  }
  // The archive holds papers the form never saw; neither alone is the whole truth.
  var idx = staffDocsIndex_();
  if (!idx.error && idx.people[key]) {
    who = idx.people[key].name || who;
    idx.people[key].docs.forEach(function (d) {
      var already = false;
      for (var i = 0; i < docs.length; i++) {
        if (String(docs[i].type).toLowerCase() === String(d.type).toLowerCase()) { already = true; break; }
      }
      if (!already) docs.push({ type: d.type, from: 'archive', fileId: d.fileId });
    });
  }
  return docs.length ? { name: who, docs: docs } : null;
}

HUB_POLICY.staffDocsScan = {
  file: 'StaffDocs.gs', lane: 'read', store: 'drive',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { name: { type: 'string' } }
};
HUB_ACTIONS.staffDocsScan = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};
  var idx = staffDocsIndex_();
  if (idx.error) return { status: 503, message: idx.error };

  var one = str_(payload.name);
  if (one) {
    var mine = idx.people[staffDocsKey_(one)];
    return { status: 200, data: { name: one, found: !!mine,
             docs: mine ? mine.docs : [],
             message: mine ? mine.docs.length + ' document(s) on file.'
                           : 'Nothing on file under that name.' } };
  }

  var dated = staffDocsDated_();
  if (dated.error) return { status: 503, message: dated.error };
  var fillable = dated.dated.slice().sort(function (a, b) {
    return String(b.expires).localeCompare(String(a.expires));
  });

  return { status: 200, data: {
    people: Object.keys(idx.people).length,
    filesSeen: idx.filesSeen,
    truncated: !!idx.truncated,
    fillable: fillable.slice(0, 400),
    fillableTotal: fillable.length,
    // A certification date is never written as an expiry.
    certOnlyNoExpiry: dated.certOnly,
    undated: dated.undated,
    unknownType: dated.unknownType,
    message: fillable.length + ' expiry date(s) come from the form. ' +
             dated.certOnly + ' submission(s) carry only a certification date and ' +
             'date nothing. The Master keeps whatever it already has; only blanks are filled.'
  } };
};

HUB_POLICY.staffDocsApplyDates = {
  file: 'StaffDocs.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: ['certMatrix', 'staffCerts'], emits: [],
  params: {
    limit: { type: 'number' },
    name: { type: 'string' }
  }
};
HUB_ACTIONS.staffDocsApplyDates = function (payload, user) {
  if (!user || user.is_service || user.role !== 'admin') return hubDenied_();
  payload = payload || {};
  var limit = Math.max(1, Math.min(Number(payload.limit) || 25, 100));
  var only = staffDocsKey_(str_(payload.name));

  var dated = staffDocsDated_();
  if (dated.error) return { status: 503, message: dated.error };

  // Refusals spend slots too, so without a saved cursor every press retries the same window.
  var order = dated.dated.slice().sort(function (a, b) {
    return String(a.key + '|' + a.field).localeCompare(String(b.key + '|' + b.field));
  });
  var cursor = 0;
  if (!only) {
    try { cursor = parseInt(hubProp_('STAFF_DOCS_APPLY_CURSOR') || '0', 10) || 0; }
    catch (eC) { cursor = 0; }
  }
  if (!(cursor >= 0) || cursor >= order.length) cursor = 0;
  var ordered = order.slice(cursor).concat(order.slice(0, cursor));

  var wrote = [], skipped = [], done = 0, examined = 0;
  for (var i = 0; i < ordered.length && done < limit; i++) {
    var d = ordered[i];
    examined++;
    if (only && d.key !== only) continue;

    // expected '' makes this fill-blank only.
    var res = emp360WriteCell_({
      employeeId: d.name, field: d.field, value: d.expires, expected: ''
    }, user, true);
    done++;
    if (res && res.status === 200) {
      wrote.push({ name: d.name, field: d.field, value: d.expires, type: d.type });
    } else {
      // 409 is the ordinary case: a date a person typed outranks the form.
      skipped.push({ name: d.name, field: d.field, value: d.expires,
                     why: str_(res && res.message) || 'refused' });
    }
  }

  if (!only && order.length) {
    try {
      hubPropSet_('STAFF_DOCS_APPLY_CURSOR', String((cursor + examined) % order.length));
    } catch (eS) { }
  }

  hubSysLog_(user.email, 'staff_docs_apply_dates',
             wrote.length + ' written, ' + skipped.length + ' left alone' +
             (only ? '' : ' (from ' + cursor + ' of ' + order.length + ')'), { status: 200 });
  return { status: 200, data: {
    wrote: wrote, skipped: skipped,
    total: order.length, from: only ? 0 : cursor, examined: examined,
    message: wrote.length + ' date(s) filled from the archive' +
             (skipped.length ? ', ' + skipped.length + ' left as they were' : '') + '.' +
             (only ? '' : ' ' + examined + ' of ' + order.length +
                          ' archive entries looked at, starting at ' +
                          (order.length ? cursor + 1 : 0) +
                          '; the next press carries on from where this one stopped.')
  } };
};
