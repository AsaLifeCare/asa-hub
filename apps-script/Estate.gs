// ------------------------------------------------------------------ ESTATE — the four data apps, read from and…
// drAppointments Dr Appointments (Responses) › Dr Master workOrders House Repair Requests › Repairs uiIncidents Asa…
var ESTATE_SOURCES = {
  // callOffs LEFT (kill list 10).
  drAppointments: { prop: 'ESTATE_DR_ID', tab: 'Dr Master' },
  // THE VISITS THEMSELVES — it was not working and was not collecting the clients' appointments at all.
  drVisits:       { prop: 'ESTATE_DR_ID', tab: 'Dr Appt Archive' },
  workOrders:     { prop: 'ESTATE_REPAIRS_ID', tab: 'Repairs' },
  // WHAT EACH HOUSE OWNS — House Supplies has to be filled in.
  houseInventory: { prop: 'ESTATE_REPAIRS_ID', tab: 'House Inventory List' },
  uiIncidents:    { prop: 'ESTATE_UI_ID', tab: 'UIs and MUIs' },
  // THE HOTLINE'S TWO REMAINING SHEETS (the Employee Support Hotline port).
  supportQueue:   { prop: 'EMP360_WORK_QUEUE_ID', tab: 'Requests' },
  dailyNotes:     { prop: 'ESTATE_NOTES_ID', tab: 'Notes' }
};

// One source, its id resolved.
function estateSource_(resource) {
  var src = ESTATE_SOURCES[String(resource || '')];
  if (!src) return null;
  return { id: hubId_(src.prop), tab: src.tab, prop: src.prop };
}

// The column an edit/delete checks before touching a row, per resource — the one field that identifies WHOSE record…
var ESTATE_WITNESS = {
  drAppointments: 'client',
  drVisits:       'client_name',
  workOrders:     'select_address_vehicle',
  houseInventory: 'item',
  uiIncidents:    'client_name',
  supportQueue:   'requestor',
  dailyNotes:     'dsp_name'
};

/** Where a soft-delete leaves its mark, when the sheet has such a column. */
var ESTATE_STATUS_COL = {
  workOrders:     'status',
  drAppointments: 'active_or_discontinued'
};

/** "Urgency Level (1-Low : 5-High)" → "urgency_level"; "Your Name:" → "your_name". */
function estateKey_(header) {
  return String(header || '')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}


// A cell holding only a TIME comes back as a Date on 30 Dec 1899 — the epoch Sheets uses for time-only values — and…
function estateCell_(v, tz) {
  if (!(v instanceof Date)) return String(v == null ? '' : v);
  if (v.getFullYear() < 1900) return Utilities.formatDate(v, tz, 'HH:mm');
  return v.toISOString();
}

/** All rows of one source, header-keyed, cached via the chunked tab cache. */
function estateRows_(resource) {
  var src = estateSource_(resource);
  return cacheRead_(cacheScopeSheet_(src.id, src.tab), resource, function () {
    try { depNote_(src.id, src.tab); } catch (eDep) {}
    var ss = ssOpen_(src.id);
    var sheet = ss.getSheetByName(src.tab);
    if (!sheet) return [];
    var tz = ss.getSpreadsheetTimeZone();
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return [];
    var keys = values[0].map(estateKey_);
    var rows = [];
    for (var i = 1; i < values.length; i++) {
      var row = { id: 'r' + (i + 1) }, empty = true;
      for (var c = 0; c < keys.length; c++) {
        if (!keys[c]) continue;
        var v = estateCell_(values[i][c], tz);
        if (v) empty = false;
        row[keys[c]] = v;
      }
      if (!empty) rows.push(row);
    }
    return rows;
  });
}

/** The live sheet handle + its normalized header keys. */
function estateSheet_(resource) {
  var src = estateSource_(resource);
  var ss = ssOpen_(src.id);
  var sheet = ss.getSheetByName(src.tab);
  if (!sheet) return null;
  var width = sheet.getLastColumn();
  if (width < 1) return null;
  var header = sheet.getRange(1, 1, 1, width).getValues()[0];
  return { sheet: sheet, keys: header.map(estateKey_), tz: ss.getSpreadsheetTimeZone() };
}

/** "r42" → 42, and nothing else. */
function estateRowNum_(id) {
  var m = /^r(\d+)$/.exec(String(id || ''));
  var n = m ? parseInt(m[1], 10) : 0;
  return n >= 2 ? n : 0;
}

/** One row of the live sheet, header-keyed (no cache — this is the check). */
function estateReadRow_(handle, rowNum) {
  if (rowNum > handle.sheet.getLastRow()) return null;
  var values = handle.sheet.getRange(rowNum, 1, 1, handle.keys.length).getValues()[0];
  var row = { id: 'r' + rowNum };
  for (var c = 0; c < handle.keys.length; c++) {
    if (!handle.keys[c]) continue;
    row[handle.keys[c]] = estateCell_(values[c], handle.tz);
  }
  return row;
}

// Did this row move under us?
function estateRowMatches_(resource, row, payload) {
  var key = ESTATE_WITNESS[resource];
  if (!key || !payload || payload.witness === undefined || payload.witness === null) return true;
  return String(row[key] || '').trim() === String(payload.witness).trim();
}

// FILING.
var ESTATE_FILE_ROLES = ['admin', 'manager', 'staff', 'client'];
var ESTATE_FILE_COLUMNS = {
  uiIncidents: ['timestamp', 'your_name', 'client_name', 'incident_category', 'incident_location',
                'incident_date', 'incident_time', 'incident_reported_date', 'incident_reported_time',
                'employees_involved', 'summary_of_incident', 'immediate_action_taken',
                'cause_and_contributing_factors', 'prevention_plan'],
  workOrders:  ['timestamp', 'select_address_vehicle', 'repair_type', 'urgency_level',
                'please_describe_the_issue']
};

/** The client's name and street as the platform's merge spells them; null when not on file. */
function estateClientOf_(key) {
  var found = null;
  clientsDerived_(null).forEach(function (r) {
    if (!found && str_(r.client_key) === key) found = { name: str_(r.name), address: str_(r.home_address) };
  });
  return found;
}

// A non-writer's create, checked before the sheet is opened: the role files, only the form's columns are kept, the…
function estateFileGate_(resource, payload, user) {
  var cols = ESTATE_FILE_COLUMNS[resource];
  if (!cols || !user || user.is_service || ESTATE_FILE_ROLES.indexOf(str_(user.role)) === -1) {
    return { status: 403, message: 'Filing is for clients, staff, managers and admins.' };
  }
  Object.keys(payload).forEach(function (k) {
    if (cols.indexOf(k) === -1) delete payload[k];
  });
  if (resource === 'uiIncidents') payload.your_name = str_(user.display_name) || str_(user.email);
  if (str_(user.role) !== 'client') return null;

  // 404, never 403: a refusal must not say whether the client is on file
  var key = str_(user.client_key);
  var me = key ? estateClientOf_(key) : null;
  var none = { status: 404, message: 'No "' + resource + '" record here.' };
  if (!me) return none;
  if (resource === 'uiIncidents') payload.client_name = me.name;
  if (resource === 'workOrders' && hubAddrKey_(payload.select_address_vehicle) !== hubAddrKey_(me.address)) {
    payload.select_address_vehicle = me.address;
  }
  var cfg = (typeof RESOURCES !== 'undefined' && RESOURCES[resource]) || {};
  return hubClientRowGate_(resource, cfg, payload, key) ? none : null;
}

function estateMoved_(resource) {
  return { status: 409, message: 'That row has moved in the "' + resource + '" sheet since you opened it — ' +
    'reload the screen so you are editing the right one.' };
}

/** Read-write router for the four estate resources. */
function estateRoute_(resource, action, payload, user) {
  // The sheet this resource actually lives in — the writes below retire IT, not a label shared by all seven sources.
  var src = estateSource_(resource) || { id: '', tab: '' };
  if (action === 'list') {
    var rows = estateRows_(resource);
    var q = payload && payload.q ? String(payload.q).toLowerCase() : '';
    if (q) {
      rows = rows.filter(function (r) {
        return Object.keys(r).some(function (k) {
          return String(r[k]).toLowerCase().indexOf(q) !== -1;
        });
      });
    }
    return { status: 200, data: rows };
  }
  if (action === 'get') {
    var id = payload && payload.id;
    var all = estateRows_(resource);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return { status: 200, data: all[i] };
    return { status: 404, message: 'No row "' + id + '" in ' + resource + '.' };
  }

  if (action !== 'create' && action !== 'update' && action !== 'delete') {
    return { status: 400, message: 'Unknown action: "' + action + '".' };
  }
  if (!hubIsWriter_(user)) {
    if (action !== 'create' || !ESTATE_FILE_COLUMNS[resource]) return hubDenied_();
    payload = payload || {};
    var refused = estateFileGate_(resource, payload, user);
    if (refused) return refused;
  }

  var handle = estateSheet_(resource);
  if (!handle) return { status: 500, message: 'The "' + resource + '" sheet could not be opened.' };

  // One writer at a time on a sheet the estate's forms also append to.
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    return { status: 503, message: 'The sheet is busy — try again in a moment.' };
  }
  try {
    if (action === 'create') {
      var line = [];
      for (var c = 0; c < handle.keys.length; c++) {
        var k = handle.keys[c];
        var v = (k && payload && payload[k] !== undefined) ? payload[k] : '';
        line.push(hubCellSafe_(v));
      }
      handle.sheet.appendRow(line);
      cacheBump_(cacheScopeSheet_(src.id, src.tab));
      if (resource === 'uiIncidents' && typeof supportDeskIncidents_ === 'function') { try { supportDeskIncidents_([estateReadRow_(handle, handle.sheet.getLastRow())], 'platform'); } catch (eSd) {} }
      return { status: 200, data: estateReadRow_(handle, handle.sheet.getLastRow()) };
    }

    var rowNum = estateRowNum_(payload && payload.id);
    if (!rowNum) return { status: 400, message: 'A row id like "r42" is required.' };
    var current = estateReadRow_(handle, rowNum);
    if (!current) return { status: 404, message: 'No row "' + payload.id + '" in ' + resource + '.' };
    if (!estateRowMatches_(resource, current, payload)) return estateMoved_(resource);

    if (action === 'update') {
      var wrote = 0;
      for (var j = 0; j < handle.keys.length; j++) {
        var key = handle.keys[j];
        // HEADER-BOUND: only columns this sheet already has, and only the ones the caller actually sent.
        if (!key || !payload || payload[key] === undefined) continue;
        handle.sheet.getRange(rowNum, j + 1).setValue(hubCellSafe_(payload[key]));
        wrote++;
      }
      if (!wrote) return { status: 400, message: 'Nothing to update — no known column was sent.' };
      cacheBump_(cacheScopeSheet_(src.id, src.tab));
      return { status: 200, data: estateReadRow_(handle, rowNum) };
    }

    // delete — soft where the sheet can carry the mark, hard where it cannot
    var statusKey = ESTATE_STATUS_COL[resource];
    var statusCol = statusKey ? handle.keys.indexOf(statusKey) : -1;
    if (statusCol >= 0) {
      handle.sheet.getRange(rowNum, statusCol + 1).setValue('Cancelled');
      cacheBump_(cacheScopeSheet_(src.id, src.tab));
      return { status: 200, data: { id: payload.id, cancelled: true } };
    }
    handle.sheet.deleteRow(rowNum);
    cacheBump_(cacheScopeSheet_(src.id, src.tab));
    return { status: 200, data: { id: payload.id, deleted: true } };
  } finally {
    lock.releaseLock();
  }
}

// CALL OFFS INTO THE PLATFORM MAILBOX.
var CALLOFFS_CURSOR_PROP = 'HUB_CALLOFFS_CURSOR';
var CALLOFFS_MAIL_CAP = 20;   // per pass — a flood becomes several passes

function callOffsMailSweepMaybe_() {
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('calloffs_mail_ran')) return;
  cache.put('calloffs_mail_ran', '1', 900);   // 15 min
  var cursor = 0;
  try { cursor = Math.max(0, parseInt(hubProp_(CALLOFFS_CURSOR_PROP) || '0', 10) || 0); }
  catch (eC) { cursor = 0; }

  var rows;
  try { rows = listRows_('callOffs', {}) || []; } catch (eR) { return; }   // next pass retries
  var top = rows.length ? rows.length + 1 : 0;   // last data row's sheet row (header is 1)
  if (!cursor) {
    // first pass: remember where the history ends, mail nothing old
    try { hubPropSet_(CALLOFFS_CURSOR_PROP, String(top)); } catch (eB) {}
    try { hubSysLog_('auto-calloffs', 'calloffs_mail_baseline',
                     'cursor baselined at row ' + top, { status: 200 }); } catch (eL0) {}
    return;
  }
  if (top <= cursor) return;

  var self = '';
  try { self = (platformMailCreds_() || {}).user || ''; } catch (eS) { self = ''; }
  if (!self) return;   // no mailbox configured — the sheet still holds the rows
  // a door missing from a partial push is a switch nobody can read: nothing is mailed, the cursor waits
  if (typeof hubLetterSend_ !== 'function') return;

  var pass = callOffsMailPass_(rows, cursor, self);
  if (pass.reached > cursor) {
    try { hubPropSet_(CALLOFFS_CURSOR_PROP, String(pass.reached)); } catch (eA) {}
  }
  if (pass.reached > cursor || pass.stopped) {
    try { hubSysLog_('auto-calloffs', 'calloffs_mailed',
                     pass.counts.told + ' call-off e-mail(s) sent, ' + pass.counts.held +
                     ' held by a brake and recorded, ' + pass.counts.off +
                     ' not written (the situation is off), cursor at row ' + pass.reached +
                     (pass.stopped ? ' — stopped, asked again next pass: ' + pass.stopped : ''),
                     { status: 200 }); } catch (eL) {}
  }
}

// ONE PASS OVER THE ROWS PAST THE CURSOR — { reached, counts, stopped }.
function callOffsMailPass_(rows, cursor, self) {
  var counts = { told: 0, held: 0, off: 0 }, tried = 0, reached = cursor, stopped = '';
  for (var i = 0; i < (rows || []).length && tried < CALLOFFS_MAIL_CAP; i++) {
    var n = i + 2;   // position IS the row: the house is append-only here
    if (n <= cursor) continue;
    tried++;
    var said = null;
    try { said = hubLetterSend_(callOffsNoteLetter_(rows[i], n, self)); }
    catch (eM) { said = { state: 'failed', why: String((eM && eM.message) || eM).slice(0, 160) }; }
    var st = String((said && said.state) || 'failed');
    if (st === 'told' || st === 'deduplicated') counts.told++;
    else if (st === 'held') counts.held++;
    else if (st === 'off') counts.off++;
    else { stopped = st + ' at row ' + n + ': ' + String((said && said.why) || '').slice(0, 160); break; }
    reached = n;
  }
  return { reached: reached, counts: counts, stopped: stopped };
}

/** One call-off row as its letter to the platform's own mailbox. */
function callOffsNoteLetter_(r, n, self) {
  var date = str_(r.date);
  return {
    situation: 'calloff_mailbox_note', to: self,
    vars: {
      type: str_(r.type) || 'Call Off',
      employee: str_(r.employee_name) || 'unknown',
      date_part: date ? ' (' + date + ')' : '',
      details: 'Type: ' + str_(r.type) + '\nEmployee: ' + str_(r.employee_name) +
               '\nShift date: ' + date +
               (str_(r.how_late) ? '\nHow late: ' + str_(r.how_late) : '') +
               (str_(r.notes) ? '\nNotes: ' + str_(r.notes) : '') +
               (str_(r.your_name) ? '\nReported by: ' + str_(r.your_name) : '') +
               (str_(r.timestamp) ? '\nForm time: ' + str_(r.timestamp) : '')
    },
    subject_floor: '{type} — {employee}{date_part}',
    text_floor: '{details}',
    key: 'calloff_note|' + (str_(r.id) || String(n)),
    // a sweep: the cursor stays on a held row, so the next pass after 08:00 asks again
    asks_again: true
  };
}
