// Values are placed by live header name, never by position: HR staff edit this book by hand.

// Not the Employee Database's "Master": ist_cert_source_tabs must never move this one.
var STAFF_ISSUE_SOURCE = { prop: 'ESTATE_HR_ID', tab: 'Master' };

var STAFF_ISSUE_FIELDS = [
  'date', 'employees_involved', 'situation',
  'follow_up', 'disciplinary_action', 'result', 'termination_summary'
];

var STAFF_ISSUE_ACTIONS = [
  'Monitoring', '1st Warning', '2nd Warning', 'Final Warning',
  'Not at this time', 'Terminated', 'Quit'
];

// The book sorts on M/D/YYYY; parse digits, never `new Date()` (UTC midnight is yesterday in Ohio).
function staffIssueDate_(raw) {
  var s = String(raw == null ? '' : raw).replace(/^\s+|\s+$/g, '');
  if (!s) return '';
  var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return staffIssueDay_(Number(iso[2]), Number(iso[3]), iso[1]);
  var us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (us) {
    return staffIssueDay_(Number(us[1]), Number(us[2]),
                          us[3].length === 2 ? '20' + us[3] : us[3]);
  }
  return null;
}

function staffIssueDay_(month, day, year) {
  var y = Number(year);
  var d = new Date(y, month - 1, day);
  if (d.getFullYear() !== y || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return month + '/' + day + '/' + y;
}

function staffIssueSheet_() {
  var id = hubId_(STAFF_ISSUE_SOURCE.prop);
  if (!id) {
    return { why: 'The Hub does not know which book the HR tracker is — the ' +
             STAFF_ISSUE_SOURCE.prop + ' script property is not set.' };
  }
  var ss;
  try {
    ss = ssOpen_(id);
  } catch (e) {
    return { why: 'The Hub\'s account could not open the HR tracker (' +
             String(e && e.message ? e.message : e) + ').' };
  }
  var sheet = ss.getSheetByName(STAFF_ISSUE_SOURCE.tab);
  if (!sheet) {
    return { why: 'The HR tracker has no "' + STAFF_ISSUE_SOURCE.tab + '" tab.' };
  }
  var width = sheet.getLastColumn();
  if (width < 1) return { why: 'The HR tracker\'s tab has no header row.' };
  var header = sheet.getRange(1, 1, 1, width).getValues()[0];
  return { sheet: sheet, keys: header.map(estateKey_) };
}

function staffIssueReadRow_(handle, rowNum) {
  var values = handle.sheet.getRange(rowNum, 1, 1, handle.keys.length).getValues()[0];
  var row = { id: 'r' + rowNum };
  for (var c = 0; c < handle.keys.length; c++) {
    if (!handle.keys[c]) continue;
    row[handle.keys[c]] = String(values[c] == null ? '' : values[c]);
  }
  return row;
}

var STAFF_ISSUE_SCAN = 20;

// People typing in Sheets hold no script lock, so getLastRow() may be theirs: confirm by read-back.
function staffIssueLocate_(handle, values) {
  var last = handle.sheet.getLastRow();
  var floor = Math.max(2, last - STAFF_ISSUE_SCAN);
  for (var r = last; r >= floor; r--) {
    var row = staffIssueReadRow_(handle, r);
    if (String(row.situation == null ? '' : row.situation) === values.situation &&
        String(row.employees_involved == null ? '' : row.employees_involved) ===
          values.employees_involved) {
      return { row: r, written: row, confirmed: true };
    }
  }
  return { row: last, written: staffIssueReadRow_(handle, last), confirmed: false };
}

HUB_POLICY.staffIssueAdd = {
  file: 'StaffIssues.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  // Empty on purpose: the slice is built from a mirror this row has not reached yet.
  invalidates: [], emits: [],
  params: {
    date: { type: 'string', required: true },
    employees_involved: { type: 'string', required: true },
    situation: { type: 'string', required: true },
    follow_up: { type: 'string' },
    disciplinary_action: { type: 'string' },
    result: { type: 'string' }
  }
};
HUB_ACTIONS.staffIssueAdd = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};

  var date = staffIssueDate_(payload.date);
  if (date === null) {
    return { status: 400, message: 'The date must be a calendar day (yyyy-mm-dd) — ' +
             'the tracker keeps them as M/D/YYYY and sorts on that shape.' };
  }
  if (!date) return { status: 400, message: 'A staff issue needs the date it happened.' };

  var involved = str_(payload.employees_involved).replace(/^\s+|\s+$/g, '');
  if (!involved) {
    return { status: 400, message: 'A staff issue needs the people it is about — ' +
             'the tracker is read by name.' };
  }
  var situation = str_(payload.situation).replace(/^\s+|\s+$/g, '');
  if (!situation) {
    return { status: 400, message: 'A staff issue needs the situation. A row with no ' +
             'situation is dropped by the reader and would vanish.' };
  }

  var action = str_(payload.disciplinary_action).replace(/^\s+|\s+$/g, '');
  if (action && STAFF_ISSUE_ACTIONS.indexOf(action) === -1) {
    return { status: 400, message: 'Unknown disciplinary action "' + action + '". The ' +
             'tracker\'s own list: ' + STAFF_ISSUE_ACTIONS.join(', ') + '.' };
  }

  var values = {
    date: date,
    employees_involved: involved.slice(0, 500),
    situation: situation.slice(0, 4000),
    follow_up: str_(payload.follow_up).slice(0, 4000),
    disciplinary_action: action,
    result: str_(payload.result).slice(0, 2000)
  };

  var handle = staffIssueSheet_();
  if (handle.why) {
    return { status: 502, message: handle.why + ' Nothing was written.' };
  }

  // A value whose column is gone is refused, never dropped.
  var missing = [];
  for (var f = 0; f < STAFF_ISSUE_FIELDS.length; f++) {
    var k = STAFF_ISSUE_FIELDS[f];
    if (values[k] && handle.keys.indexOf(k) === -1) missing.push(k);
  }
  if (missing.length) {
    return { status: 409, message: 'The HR tracker no longer has a column for: ' +
             missing.join(', ') + '. Nothing was written — the sheet\'s headers moved ' +
             'and the Hub will not guess where these belong.' };
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (eLock) {
    return { status: 503, message: 'The HR tracker is busy — nothing was written. Try again in a moment.' };
  }
  try {
    var line = [];
    for (var c = 0; c < handle.keys.length; c++) {
      var key = handle.keys[c];
      line.push(hubCellSafe_((key && values[key] !== undefined) ? values[key] : ''));
    }
    handle.sheet.appendRow(line);
    var found = staffIssueLocate_(handle, values);
    var wrote = found.written;
    hubSysLog_(str_(user.email), 'staff_issue_add',
               involved + ' — ' + date, { status: 200 });
    return { status: 200, data: {
      ok: true,
      id: wrote.id,
      row: found.row,
      row_confirmed: found.confirmed,
      written: wrote,
      book: 'Employee HR Tracker',
      tab: STAFF_ISSUE_SOURCE.tab
    } };
  } catch (eWrite) {
    return { status: 500, message: 'The row was NOT recorded — ' +
             String(eWrite && eWrite.message ? eWrite.message : eWrite) };
  } finally {
    lock.releaseLock();
  }
};
