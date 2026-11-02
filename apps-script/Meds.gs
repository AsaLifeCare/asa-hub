// Column names are kept exactly as the intranet wrote them (`Id - Auto`, `Discountinued`); readers depend on them.
var MEDS_TAB = 'medications';

// A client may read, but this action bypasses the resource gate: the handler must narrow to their own chart.
function medsMayRead_(user) {
  if (!user || user.is_service) return false;
  return ['admin', 'manager', 'staff', 'client'].indexOf(String(user.role)) !== -1;
}
function medsMayWrite_(user) {
  if (!user || user.is_service) return false;
  return ['admin', 'manager'].indexOf(String(user.role)) !== -1;
}

// FAIL-CLOSED: the chart's writers as before; else a clients.medication holder, for a client they read. A key → its client.
function medsClientDoor_(user, key) {
  var writer = medsMayWrite_(user);
  var shut = writer ? null : cpProfileEditDoor_({ client: key }, user, CP_EDITION_MEDS);
  if (shut) return { refused: shut };
  if (key) return clientProfilesClient_(key);
  return writer ? {} : { refused: { status: 400, message: 'client: the client key the roster gives.' } };
}

function medsFirstUrl_(v) {
  var m = String(v || '').match(/https:\/\/\S+/);
  return m ? m[0].replace(/\]$/, '') : '';
}

/** The merged read: eMAR rows (active only) plus the ISP narrative per client. */
HUB_POLICY.clientMedsIsp = {
  file: 'Meds.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  // Must match medsMayRead_: hubPolicyGate_ runs before the handler.
  roles: ['admin', 'manager', 'staff', 'client'],
  invalidates: [], emits: []
};
HUB_ACTIONS.clientMedsIsp = function (payload, user) {
  if (!medsMayRead_(user)) return hubDenied_();
  var clients = {};
  var key = function (name) { return String(name || '').replace(/\s+/g, ' ').trim().toLowerCase(); };
  try {
    listRows_('isps', {}).forEach(function (r) {
      var k = key(r.client_name);
      if (!k) return;
      clients[k] = { client: str_(r.client_name).trim(), isp_year: str_(r.isp_year),
                     isp_text: str_(r.medications).slice(0, 4000), meds: [] };
    });
  } catch (eIsp) { }
  var emar;
  try {
    emar = readTabNormalized_(hubTabWorkbook_(MEDS_TAB), MEDS_TAB);
  } catch (e) {
    return { status: 503, message: 'The chart did not open — the Hub workbook did not answer.' };
  }
  emar.forEach(function (r) {
    if (str_(r.discountinued)) return;
    var k = key(r.client);
    if (!k) return;
    var c = clients[k] = clients[k] || { client: str_(r.client).trim(), isp_year: '', isp_text: '', meds: [] };
    var name = str_(r.prescriptionname).trim();
    if (!name) return;
    var times = String(r.administrationtimes || '').match(/\d{3,4}/g) || [];
    var prnTxt = str_(r.prn);
    c.meds.push({
      id: str_(r.idauto),
      name: name,
      dose: str_(r.dosage).trim(),
      route: str_(r.medtype).trim(),
      times: times.map(function (t) { t = ('0000' + t).slice(-4); return t.slice(0, 2) + ':' + t.slice(2); }),
      prn: /prn|as needed/i.test(prnTxt),
      freq: prnTxt.trim(),
      image: medsFirstUrl_(r.medpictures),
      source: 'emar'
    });
  });
  var out = Object.keys(clients).map(function (k) { return clients[k]; })
    .sort(function (a, b) { return a.client.toLowerCase() < b.client.toLowerCase() ? -1 : 1; });
  // No client_key means no chart at all.
  if (str_(user && user.role) === 'client' && !(user && user.is_service)) {
    var ck = hubClientKeyOf_(user);
    if (!ck) return { status: 200, data: { clients: [] } };
    var id = hubClientIdentity_(ck);
    out = out.filter(function (c) { return !!id.names[clientNameKey_(str_(c.client))]; });
  }
  return { status: 200, data: { clients: out } };
};

/** Add a medication: a header-bound append to the eMAR tab itself. */
HUB_POLICY.emarMedAdd = {
  file: 'Meds.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: []
};
HUB_ACTIONS.emarMedAdd = function (payload, user) {
  var p = payload || {};
  // Clients names its client by client_key: the row is filed under that client's own name
  var ctx = medsClientDoor_(user, p.client_key);
  if (ctx.refused) return ctx.refused;
  var client = str_(ctx.name || p.client).trim();
  var name = str_(p.name).trim();
  if (!client) return { status: 400, message: 'Which client?' };
  if (!name) return { status: 400, message: 'The medicine needs a name.' };
  var sheet = hubTabSheet_(MEDS_TAB);
  if (!sheet) return { status: 503, message: 'The chart tab did not open.' };
  var width = sheet.getLastColumn();
  var hdr = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
  var maxId = 0;
  var idCol = hdr.indexOf('Id - Auto');
  if (idCol !== -1 && sheet.getLastRow() > 1) {
    sheet.getRange(2, idCol + 1, sheet.getLastRow() - 1, 1).getValues().forEach(function (v) {
      var n = Number(v[0]); if (isFinite(n) && n > maxId) maxId = n;
    });
  }
  var times = String(p.times || '').match(/\d{3,4}/g) || [];
  var fields = {
    'Id - Auto': String(maxId + 1),
    'Client': client,
    'PrescriptionName': name,
    'Dosage': str_(p.dose).trim(),
    'AdministrationTimes': times.map(function (t) { return '"' + ('0000' + t).slice(-4) + '"'; }).join(' '),
    'MedType': str_(p.route).trim() || 'Tablet',
    'PRN': str_(p.freq).trim() || (String(p.prn) === 'true' ? 'PRN' : 'Daily'),
    'Added': str_(user.display_name) || str_(user.email),
    'Added Date': new Date().toISOString().slice(0, 10)
  };
  var row = hdr.map(function (h) { return fields[h] !== undefined ? fields[h] : ''; });
  sheet.appendRow(row);
  // Without the bump the cached tab hides the new row for a whole TTL.
  try { cacheBumpAfterWrite_('medications'); } catch (eB) {}
  hubSysLog_(str_(user.email), 'emarMedAdd', client + ' — ' + name, { status: 200 });
  if (!ctx.key) return { status: 200, data: { id: fields['Id - Auto'] } };
  return cpEditSteps_({ status: 200, data: { id: fields['Id - Auto'], written: ['name', 'dose', 'times', 'route', 'freq'] } },
                      'meds');
};

/** Delete a medication: the exact row, found by its Id - Auto, taken off the source. */
HUB_POLICY.emarMedDelete = {
  file: 'Meds.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: []
};
HUB_ACTIONS.emarMedDelete = function (payload, user) {
  // Clients names the client by key: only that client's row is taken off
  var ctx = medsClientDoor_(user, payload && payload.client);
  if (ctx.refused) return ctx.refused;
  var id = str_(payload && payload.id);
  if (!id) return { status: 400, message: 'Which medicine?' };
  var sheet = hubTabSheet_(MEDS_TAB);
  if (!sheet) return { status: 503, message: 'The chart tab did not open.' };
  var width = sheet.getLastColumn();
  var hdr = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
  var idCol = hdr.indexOf('Id - Auto');
  var nameCol = hdr.indexOf('PrescriptionName');
  var clientCol = hdr.indexOf('Client');
  var last = sheet.getLastRow();
  if (idCol === -1 || last < 2) return { status: 404, message: 'The chart holds no such row.' };
  var ids = sheet.getRange(2, idCol + 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) {
      if (ctx.key && (clientCol === -1 ||
          clientNameKey_(sheet.getRange(i + 2, clientCol + 1).getValue()) !== clientNameKey_(ctx.name))) {
        return { status: 409, message: 'This medicine is not on this client\'s chart (it has moved) — nothing was removed.' };
      }
      var medName = nameCol !== -1 ? String(sheet.getRange(i + 2, nameCol + 1).getValue()) : id;
      sheet.deleteRow(i + 2);
      try { cacheBumpAfterWrite_('medications'); } catch (eB) {}
      hubSysLog_(str_(user.email), 'emarMedDelete', medName, { status: 200 });
      if (!ctx.key) return { status: 200, data: { removed: id } };
      return cpEditSteps_({ status: 200, data: { removed: id, written: ['removed'], refused: [] } }, 'meds');
    }
  }
  return { status: 404, message: 'No medicine with id "' + id + '" on the chart.' };
};

// The medication edit: the field the panel sends → the eMAR column it writes.
var MEDS_EDIT_COLUMNS = { name: 'PrescriptionName', dose: 'Dosage', times: 'AdministrationTimes', route: 'MedType',
                          freq: 'PRN', discontinued: 'Discountinued' };

function medsTimesOf_(v) {
  return (String(v == null ? '' : v).replace(/:/g, '').match(/\d{3,4}/g) || []).map(function (t) {
    t = ('0000' + t).slice(-4); return t.slice(0, 2) + ':' + t.slice(2);
  });
}

/** A medication row's edit fields as the panel opens on them (times as HH:MM) — the witness too. */
function medsEditRaw_(row) {
  var out = {};
  Object.keys(MEDS_EDIT_COLUMNS).forEach(function (f) {
    var v = locationsText_(deserialize_(row[MEDS_EDIT_COLUMNS[f]]), 500);
    out[f] = f === 'times' ? medsTimesOf_(v).join(' ') : v;
  });
  return out;
}

/** Edit a medication in place: its row by Id - Auto, still this client's, each cell witnessed. The master's or its edition's. */
HUB_POLICY.emarMedUpdate = {
  file: 'Meds.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' }, id: { type: 'string' }, changes: { type: 'array' } }
};
HUB_ACTIONS.emarMedUpdate = function (payload, user) {
  var shut = cpProfileEditDoor_(payload, user, CP_EDITION_MEDS);
  if (shut) return shut;
  var ctx = clientProfilesClient_(payload && payload.client);
  if (ctx.refused) return ctx.refused;
  var id = str_(payload && payload.id).trim();
  if (!/^[A-Za-z0-9_.\-]{1,64}$/.test(id)) return { status: 400, message: 'id: the medicine\'s chart id.' };
  var asked = hubEditChanges_(payload);
  if (asked.refused) return asked.refused;
  var written = [], refused = [], stale = {};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { status: 503, message: 'The chart is busy — try again in a moment.' };
  try {
    var sheet = hubTabSheet_(MEDS_TAB);
    if (!sheet) return { status: 503, message: 'The chart tab did not open.' };
    var values = sheet.getDataRange().getValues();
    var hdr = (values[0] || []).map(String);
    var idCol = hdr.indexOf('Id - Auto'), clientCol = hdr.indexOf('Client');
    var hits = [];
    for (var i = 1; i < values.length && idCol !== -1; i++) if (String(values[i][idCol]) === id) hits.push(i);
    if (hits.length !== 1) return { status: hits.length ? 409 : 404, message: hits.length ? 'Two chart rows carry this id; neither was edited — reload the chart.' : 'No medicine with this id is on the chart.' };
    var r = hits[0];
    if (clientCol === -1 || clientNameKey_(values[r][clientCol]) !== clientNameKey_(ctx.name)) {
      return { status: 409, message: 'This medicine is not on this client\'s chart (it has moved) — nothing was written.' };
    }
    var row = {};
    hdr.forEach(function (h, c) { row[h] = values[r][c]; });
    var live = cpScrub_(medsEditRaw_(row));
    asked.changes.forEach(function (c) {
      var col = MEDS_EDIT_COLUMNS[c.field];
      if (!col) { refused.push({ field: c.field, why: 'Not a field this panel edits.' }); return; }
      var at = hdr.indexOf(col);
      if (at === -1) { refused.push({ field: c.field, why: 'The chart has no ' + col + ' column.' }); return; }
      var held = hubEditWitness_(c.field, c.expected, live[c.field]);
      if (held) { stale[c.field] = held.data.current; return; }
      if (c.field === 'name' && !c.value) { refused.push({ field: c.field, why: 'The medicine needs a name.' }); return; }
      var value = c.field === 'times'
        ? medsTimesOf_(c.value).map(function (t) { return '"' + t.replace(':', '') + '"'; }).join(' ')
        : c.value.replace(/\s+/g, ' ').slice(0, 500);
      sheet.getRange(r + 1, at + 1).setValue(hubCellSafe_(value));
      written.push({ field: c.field, before: c.expected, after: value });
    });
  } finally {
    try { lock.releaseLock(); } catch (eR) { /* released with the execution */ }
  }
  if (written.length) {
    try { cacheBumpAfterWrite_('medications'); } catch (eB) {}
    cpBump_(ctx.key, ['clientProfileMeds']);
    hubEditLog_(user, 'emarMedUpdate', ctx.key + ' #' + id, written, []);
  }
  var data = { written: written.map(function (w) { return w.field; }), refused: refused };
  if (Object.keys(stale).length) {
    data.current = stale;
    return { status: 409, data: data,
             message: written.length ? 'Some fields changed since the panel was opened — reloaded; the others were saved.'
                                     : 'Changed since the panel was opened — reloaded, nothing was written.' };
  }
  return cpEditSteps_({ status: 200, data: data }, 'meds');
};

// --- MAR import: a one-time paged copy of the eMAR pass log into mar_entries ---

var MAR_IMPORT_PROP = 'MAR_IMPORT_CURSOR';
var MAR_IMPORT_GEN_PROP = 'MAR_IMPORT_GEN';
var MAR_IMPORT_GEN = '4';   // bump = forget the old copy and re-copy the source
var MAR_IMPORT_SRC_ID = '1epBvwaEn-m-JRG9NCMw0QIQdq3zUwJf4L4QgE027jxI';
var MAR_IMPORT_PAGE = 1000;

// Exact header names only: substring matching let "IdClient" steal the client slot.
var MAR_IMPORT_MAP = {
  'client name': 'client',
  'med passer': 'administeredBy',
  'name': 'medication',
  'pass time': 'schedule',
  'type': 'status',
  'date': 'date'
};

// Format in the SOURCE's zone, not cellText_: 1899 time cells carry an LMT offset there.
function marImportCellText_(v, tz) {
  if (!(v instanceof Date) || isNaN(v.getTime())) return String(v == null ? '' : v);
  if (v.getFullYear() < 1900) return Utilities.formatDate(v, tz, 'h:mm a');
  var day = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  var hm = Utilities.formatDate(v, tz, 'HH:mm:ss');
  return hm === '00:00:00' ? day : day + ' ' + hm.slice(0, 5);
}

// Found by its "Med Passer" header, not by name: 'EmarData' is the prescriptions list.
function marImportSourceSheet_() {
  var book = SpreadsheetApp.openById(MAR_IMPORT_SRC_ID);
  var sheets = book.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    if (sh.getLastRow() < 1 || sh.getLastColumn() < 1) continue;
    var hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h).trim().toLowerCase(); });
    if (hdr.indexOf('med passer') !== -1) return sh;
  }
  return null;
}

// Keeps the app's own rows (ids not starting with emar_).
function marImportWipe_(dest, keys) {
  var kept = [];
  var lastRow = dest.getLastRow();
  var lastCol = dest.getLastColumn();
  if (lastRow > 1 && lastCol > 0) {
    var oldHdr = dest.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function (h) { return String(h).trim(); });
    var idAt = oldHdr.indexOf('id');
    var vals = dest.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (var i = 0; i < vals.length; i++) {
      var id = idAt === -1 ? '' : String(vals[i][idAt] || '');
      if (id && id.indexOf('emar_') !== 0) {
        var obj = {};
        for (var c = 0; c < oldHdr.length; c++) {
          if (oldHdr[c]) obj[oldHdr[c]] = vals[i][c];
        }
        kept.push(obj);
      }
    }
  }
  dest.clear();
  dest.getRange(1, 1, 1, keys.length).setValues([keys]);
  // Plain text before rows land, or the sheet re-types "8:00 PM" into a time value.
  var schedAt = keys.indexOf('schedule');
  if (schedAt !== -1) {
    dest.getRange(2, schedAt + 1, Math.max(1, dest.getMaxRows() - 1), 1).setNumberFormat('@');
  }
  if (kept.length) {
    var out = kept.map(function (o) {
      return keys.map(function (k) { return o[k] != null ? o[k] : ''; });
    });
    dest.getRange(2, 1, out.length, keys.length).setValues(out);
  }
}

function marImportSweepMaybe_() {
  var props = PropertiesService.getScriptProperties();
  var gen = String(props.getProperty(MAR_IMPORT_GEN_PROP) || '');
  var cur = String(props.getProperty(MAR_IMPORT_PROP) || '');
  if (gen === MAR_IMPORT_GEN && cur === 'done') return;

  var src = null;
  try { src = marImportSourceSheet_(); } catch (e) { src = null; }
  if (!src) {
    hubSysLog_('asa-hub:mar-import', 'mar_import_source_unreachable',
               'no tab with a "Med Passer" header in the eMAR workbook — the pass log ' +
               'moved or the workbook is not shared with the platform account', { status: 500 });
    return;
  }

  var srcTz = src.getParent().getSpreadsheetTimeZone();
  var width = src.getLastColumn();
  var hdr = src.getRange(1, 1, 1, width).getValues()[0]
    .map(function (h) { return String(h).trim(); });

  var claimed = {};
  var target = hdr.map(function (h) {
    if (!h) return '';
    var ck = MAR_IMPORT_MAP[h.toLowerCase()] || '';
    if (ck && !claimed[ck]) { claimed[ck] = true; return ck; }
    return 'src_' + h.replace(/[^A-Za-z0-9_]+/g, '_').toLowerCase();
  });
  var keys = ['id', 'source_row', 'client', 'medication', 'schedule',
              'administeredBy', 'status', 'date'];
  target.forEach(function (t) { if (t && keys.indexOf(t) === -1) keys.push(t); });

  // Born with `keys`: ensureHeader_ only appends columns.
  var dest = hubTabEnsure_('mar_entries', keys);

  if (gen !== MAR_IMPORT_GEN) {
    marImportWipe_(dest, keys);
    props.setProperty(MAR_IMPORT_GEN_PROP, MAR_IMPORT_GEN);
    props.deleteProperty(MAR_IMPORT_PROP);
    cur = '';
  }

  var last = src.getLastRow();
  if (last < 2) { props.setProperty(MAR_IMPORT_PROP, 'done'); return; }
  var start = Math.max(2, Number(cur) || 2);
  var end = Math.min(last, start + MAR_IMPORT_PAGE - 1);
  var values = src.getRange(start, 1, end - start + 1, width).getValues();

  ensureHeader_(dest, keys);
  var destHdr = dest.getRange(1, 1, 1, dest.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });

  var out = [];
  for (var r = 0; r < values.length; r++) {
    var srcRowNum = start + r;
    var row = { id: 'emar_' + srcRowNum, source_row: 'emar:' + srcRowNum };
    for (var c = 0; c < hdr.length; c++) {
      if (!target[c]) continue;
      var v = values[r][c];
      if (v instanceof Date) v = marImportCellText_(v, srcTz);
      row[target[c]] = String(v == null ? '' : v);
    }
    out.push(destHdr.map(function (h) { return row[h] != null ? row[h] : ''; }));
  }
  if (out.length) {
    dest.getRange(dest.getLastRow() + 1, 1, out.length, destHdr.length).setValues(out);
  }
  if (end >= last) {
    props.setProperty(MAR_IMPORT_PROP, 'done');
    hubSysLog_('asa-hub:mar-import', 'mar_import_complete',
               (end - 1) + ' pass(es) copied from the eMAR pass log into mar_entries — the ' +
               'tab is OURS now; the app feeds it from here on', { status: 200 });
  } else {
    props.setProperty(MAR_IMPORT_PROP, String(end + 1));
    hubSysLog_('asa-hub:mar-import', 'mar_import_page',
               'rows ' + start + '-' + end + ' of ' + last + ' copied into mar_entries',
               { status: 200 });
  }
}
