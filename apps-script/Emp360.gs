// Only the floor: the live name is the `ist_cert_source_tabs` cell, which Certs, Compliance and EmployeeDb read too.
var EMP360_MASTER_TAB = 'Master';

function emp360MasterTab_() {
  if (typeof certSourceTab_ !== 'function') return EMP360_MASTER_TAB;
  try { return certSourceTab_('master') || EMP360_MASTER_TAB; }
  catch (e) { return EMP360_MASTER_TAB; }
}

var EMP360_STAFF_DOCS_TAB = 'Employee - Staff Documentation';
var EMP360_CALL_OFF_TAB = 'Employee - Call Off';
var EMP360_HR_TAB = 'Employee - HR';
var EMP360_DAILY_NOTES_TAB = 'Employee - Daily Notes';
var EMP360_REQUESTS_TAB = 'Requests';

var EMP360_DETAIL_TABS = ['info', 'docs', 'training', 'background', 'hr', 'activity'];

// 'ssn' is matched as a substring: the Master carries 'SSN#' and 'SSN (Last 4)'.
var EMP360_PII_EXACT = ['date_of_birth', 'dob', 'birth_date', 'login', 'password',
                        'social_security', 'social_security_number'];

function emp360PiiBlocked_(key) {
  var k = String(key || '').toLowerCase();
  if (!k) return false;
  if (k.indexOf('ssn') !== -1) return true;
  return EMP360_PII_EXACT.indexOf(k) !== -1;
}

// Legacy 'Login'/'Password' are left out on purpose: never add them back.
var EMP360_DATA_COLUMNS = [
  { key: 'status',                 label: 'Status',                        group: 'employment', edit: true },
  { key: 'employee_id',            label: 'Employee ID',                   group: 'employment', edit: true },
  { key: 'first_name',             label: 'First Name',                    group: 'employment', edit: true },
  { key: 'last_name',              label: 'Last Name',                     group: 'employment', edit: true },
  { key: 'address',                label: 'Address',                       group: 'contact',    edit: true },
  { key: 'city',                   label: 'City',                          group: 'contact',    edit: true },
  { key: 'state',                  label: 'State',                         group: 'contact',    edit: true },
  { key: 'zip',                    label: 'Zip',                           group: 'contact',    edit: true },
  { key: 'phone_number',           label: 'Phone Number',                  group: 'contact',    edit: true },
  { key: 'email',                  label: 'Email',                         group: 'contact',    edit: true },
  { key: 'referral',               label: 'Referral',                      group: 'employment', edit: true },
  { key: 'referral_paid',          label: 'Referral Paid?',                group: 'employment', edit: true },
  { key: 'start_date_doc',         label: 'Start Date (doc)',              group: 'employment', edit: true },
  { key: 'start_date_first_day',   label: 'Start Date (first day)',        group: 'employment', edit: true },
  { key: 'end_date_last_day',      label: 'End Date (last day)',           group: 'employment', edit: true },
  { key: 'job_app_date',           label: 'Job App Date',                  group: 'docs',       edit: false },
  { key: 'resume',                 label: 'Resume',                        group: 'docs',       edit: false },
  { key: 'attestation_date',       label: 'Attestation Date',              group: 'docs',       edit: false },
  { key: 'i_9_date',               label: 'I-9 Date',                      group: 'docs',       edit: false },
  { key: 'i_9_completed',          label: 'I-9 Completed',                 group: 'docs',       edit: false },
  { key: 'i_9_type_1',             label: 'I-9 Type 1',                    group: 'docs',       edit: false },
  { key: 'i_9_1_exp_date',         label: 'I-9 1 Exp Date',                group: 'docs',       edit: false },
  { key: 'i_9_type_2',             label: 'I-9 Type 2',                    group: 'docs',       edit: false },
  { key: 'i_9_2_exp_date',         label: 'I-9 2 Exp Date',                group: 'docs',       edit: false },
  { key: 'w_4_date',               label: 'W-4 Date',                      group: 'docs',       edit: false },
  { key: 'hipaa_form_date',        label: 'HIPAA Form Date',               group: 'docs',       edit: false },
  { key: 'pay_auth_form_date',     label: 'Pay Auth Form Date',            group: 'docs',       edit: false },
  { key: 'hs_diploma',             label: 'HS Diploma',                    group: 'docs',       edit: false },
  { key: 'driver',                 label: 'Driver',                        group: 'docs',       edit: false },
  { key: 'dl',                     label: 'DL#',                           group: 'docs',       edit: false },
  { key: 'license_exp_date',       label: 'License Exp Date',              group: 'docs',       edit: false },
  { key: 'driver_s_abstract_original', label: "Driver's Abstract (Original)", group: 'docs',   edit: false },
  { key: 'driver_s_abstract_latest',   label: "Driver's Abstract (Latest)",   group: 'docs',   edit: false },
  { key: 'insurance_exp_date',     label: 'Insurance Exp Date',            group: 'docs',       edit: false },
  { key: 'sam',                    label: 'SAM',                           group: 'background', edit: false },
  { key: 'oig',                    label: 'OIG',                           group: 'background', edit: false },
  { key: 'abuser_registry',        label: 'Abuser Registry',               group: 'background', edit: false },
  { key: 'sex_offender',           label: 'Sex Offender',                  group: 'background', edit: false },
  { key: 'offender',               label: 'Offender',                      group: 'background', edit: false },
  { key: 'nurse_aide',             label: 'Nurse Aide',                    group: 'background', edit: false },
  { key: 'exclusions_database',    label: 'Exclusions Database',           group: 'background', edit: false },
  { key: 'bci_fbi',                label: 'BCI/FBI',                       group: 'background', edit: false },
  { key: 'bci_check_date',         label: 'BCI Check Date',                group: 'background', edit: false },
  { key: 'rapback_entry_date',     label: 'Rapback Entry Date',            group: 'background', edit: false },
  { key: 'dodd_8_hour_exp',        label: 'DODD 8-Hour Exp',               group: 'training',   edit: false },
  { key: 'cpr_exp_date',           label: 'CPR Exp Date',                  group: 'training',   edit: false },
  { key: 'med_1_exp_date',         label: 'Med 1 Exp Date',                group: 'training',   edit: false },
  { key: 'med_2_exp_date',         label: 'Med 2 Exp Date',                group: 'training',   edit: false },
  { key: 'med_3_exp_date',         label: 'Med 3 Exp Date',                group: 'training',   edit: false },
  { key: 'mandt_exp_date',         label: 'Mandt Exp Date',                group: 'training',   edit: false },
  { key: 'money_mgt_date',         label: 'Money Mgt Date',                group: 'training',   edit: false }
];

function emp360Column_(key) {
  for (var i = 0; i < EMP360_DATA_COLUMNS.length; i++) {
    if (EMP360_DATA_COLUMNS[i].key === key) return EMP360_DATA_COLUMNS[i];
  }
  return null;
}

function emp360EditableField_(key) {
  if (emp360PiiBlocked_(key)) return false;
  var col = emp360Column_(key);
  return !!(col && col.edit);
}

function emp360Key_(h) {
  if (typeof estateKey_ === 'function') return estateKey_(h);
  return String(h || '').replace(/\([^)]*\)/g, ' ').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Estate sheets are America/New_York: never SheetDb cellText_ (UTC), which puts time-only cells 32 minutes off.
function emp360Cell_(v, tz) {
  if (typeof estateCell_ === 'function') return estateCell_(v, tz);
  if (!(v instanceof Date)) return String(v == null ? '' : v);
  if (tz && v.getFullYear() < 1900) return Utilities.formatDate(v, tz, 'HH:mm');
  return v.toISOString();
}

function emp360ReadTab_(ssId, tab) {
  return cacheRead_(cacheScopeSheet_(ssId, tab), 'rows', function () {
    var ss = ssOpen_(ssId);
    var sheet = ss.getSheetByName(tab);
    if (!sheet) return [];
    var tz = ss.getSpreadsheetTimeZone();
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return [];
    var keys = values[0].map(emp360Key_);
    var rows = [];
    for (var i = 1; i < values.length; i++) {
      var row = { id: 'r' + (i + 1) }, empty = true;
      for (var c = 0; c < keys.length; c++) {
        if (!keys[c]) continue;
        if (emp360PiiBlocked_(keys[c])) continue;      // dropped at read, so nothing downstream must redact
        var v = emp360Cell_(values[i][c], tz);
        if (v) empty = false;
        row[keys[c]] = v;
      }
      if (!empty) rows.push(row);
    }
    return rows;
  });
}

function emp360MasterRows_() { return emp360ReadTab_(empDbId_(), emp360MasterTab_()); }

function emp360NameNorm_(v) {
  if (typeof nameNorm_ === 'function') return nameNorm_(v);
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Exact per segment, never a substring: "Sam" must not read Samantha's record.
function emp360NameHit_(cell, name) {
  var want = emp360NameNorm_(name);
  if (!want) return false;
  if (emp360NameNorm_(cell) === want) return true;
  var parts = String(cell || '').split(/[,;+&]|\band\b/i);
  for (var i = 0; i < parts.length; i++) {
    if (emp360NameNorm_(parts[i]) === want) return true;
  }
  return false;
}

function emp360RosterPerson_(personId) {
  var people;
  try {
    people = withoutIspClients_(peopleMerged_(listRows_('people', {})));
  } catch (e) {
    people = listRows_('people', {});
  }
  var id = String(personId || '');
  for (var i = 0; i < people.length; i++) {
    if (String(people[i].id) === id) return people[i];
  }
  return null;
}

// The Master's `Status` words for someone working now; spStatusOf_ reads the same column the same way.
var EMP360_ACTIVE_STATUSES = { active: true, yes: true };

function emp360StatusActive_(row) {
  var s = String((row && row.status) == null ? '' : row.status).trim().toLowerCase();
  return EMP360_ACTIVE_STATUSES[s] === true;
}

// Two rows on the same key is a conflict, never a coin flip: a name on several rows takes its one Active row, else refuses.
function emp360FindMasterRow_(name, employeeId) {
  var rows = emp360MasterRows_();
  var wantName = emp360NameNorm_(name);
  var wantId = String(employeeId || '').trim();
  var hits = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var rowName = r.employee || r.name || '';
    if (wantId && String(r.employee_id || '').trim() === wantId) {
      hits.push({ row: r, by: 'employee_id' });
      continue;
    }
    if (!wantId && wantName && emp360NameNorm_(rowName) === wantName) {
      hits.push({ row: r, by: 'name' });
    }
  }
  if (hits.length > 1 && !wantId) {
    var live = hits.filter(function (h) { return emp360StatusActive_(h.row); });
    if (live.length === 1) return { row: live[0].row, by: 'name (Active)' };
  }
  if (hits.length > 1) return { conflict: hits.length };
  if (hits.length === 1) return hits[0];
  return { row: null, by: '' };
}

function emp360Resolve_(payload) {
  var personId = str_(payload.personId || payload.person_id);
  var employeeId = str_(payload.employeeId || payload.employee_id);

  var person = null;
  if (personId) {
    person = emp360RosterPerson_(personId);
    if (!person) {
      return { error: { status: 404, message: 'No person "' + personId + '" in the roster.' } };
    }
  }
  var name = person ? str_(person.name) : '';

  if (!personId && !employeeId) {
    return { error: { status: 400, message: 'A personId (roster) or an employeeId (estate) is required — never a loose name.' } };
  }

  var found = emp360FindMasterRow_(name, personId ? '' : employeeId);
  if (found.conflict) {
    return { error: { status: 409, message: found.conflict + ' rows in the Employee Database match ' +
      (employeeId && !personId ? 'employee id "' + employeeId + '"' : '"' + name + '"') +
      '. Merging people is not something to do automatically — sort the duplicate out first.' } };
  }

  var m = found.row || {};
  var header = {
    personId: person ? str_(person.id) : '',
    name: person ? name : str_(m.employee || m.name),
    role: person ? str_(person.role) : '',
    status: person ? str_(person.status) : '',
    avatar: person ? str_(person.avatar) : '',
    email: person ? str_(person.email) : str_(m.email),
    phone: person ? str_(person.phone) : str_(m.phone_number),
    employeeId: str_(m.employee_id) || employeeId
  };
  return { person: header, master: found.row, matchedBy: found.by };
}

// Every column that is not a raw data column is a flag, so a renamed flag still shows.
function emp360Scorecard_(masterRow) {
  var out = [];
  for (var k in masterRow) {
    if (!Object.prototype.hasOwnProperty.call(masterRow, k)) continue;
    if (k === 'id' || k === 'employee' || k === 'name') continue;
    if (emp360PiiBlocked_(k)) continue;
    if (emp360Column_(k)) continue;
    var v = String(masterRow[k] == null ? '' : masterRow[k]).trim();
    var state = v === '1' ? 'ok' : v === '0.5' ? 'warning' : v === '0' ? 'missing' : '';
    out.push({ key: k, label: k.replace(/_/g, ' '), value: v, state: state });
  }
  return out;
}

// The Master date columns ist_cert_master_columns names: schema order first, then any added.
function emp360TrainingColumns_() {
  var schema = EMP360_DATA_COLUMNS.filter(function (c) { return c.group === 'training'; });
  var cols;
  try {
    if (typeof certMasterColumns_ !== 'function') return schema;
    cols = certMasterColumns_();
  } catch (e) { return schema; }
  var out = schema.filter(function (c) { return Object.prototype.hasOwnProperty.call(cols, c.key); });
  for (var key in cols) {
    if (!Object.prototype.hasOwnProperty.call(cols, key)) continue;
    if (out.some(function (c) { return c.key === key; })) continue;
    var name = (typeof certLabel_ === 'function') ? certLabel_(cols[key]) : cols[key];
    out.push({ key: key, label: name + ' Exp', group: 'training', edit: false });
  }
  return out.length ? out : schema;
}

function emp360Fields_(masterRow, group, editable) {
  var out = [];
  var columns = group === 'training' ? emp360TrainingColumns_() : EMP360_DATA_COLUMNS;
  for (var i = 0; i < columns.length; i++) {
    var col = columns[i];
    if (col.group !== group) continue;
    out.push({
      key: col.key, label: col.label,
      value: str_(masterRow[col.key]),
      editable: editable && col.edit
    });
  }
  return out;
}

function emp360BuildInfo_(masterRow) {
  return {
    contact: emp360Fields_(masterRow, 'contact', true),
    employment: emp360Fields_(masterRow, 'employment', true)
  };
}

function emp360BuildDocs_(name, masterRow) {
  var docs = emp360ReadTab_(hubId_('EMP360_MASTER_DATA_ID'), EMP360_STAFF_DOCS_TAB)
    .filter(function (r) { return emp360NameHit_(r.name, name); });
  return {
    fields: emp360Fields_(masterRow, 'docs', false),
    scorecard: emp360Scorecard_(masterRow).filter(function (s) {
      return ['job_app', 'attestation', 'i9_form', 'i9_type_1', 'i9_type_2',
              'w4_form', 'hipaa_form', 'pay_auth_form', 'hs_diploma',
              'driver_license', 'drive_abstract_last', 'car_insurance'].indexOf(s.key) !== -1;
    }),
    staffDocs: docs.slice(0, 50)
  };
}

function emp360BuildTraining_(name, masterRow) {
  var certs = {};
  // The certification matrix's own picture: a second derivation is how two screens start disagreeing.
  if (typeof certPicture_ === 'function') {
    try {
      var picture = certPicture_();
      var k = (typeof clientNameKey_ === 'function') ? clientNameKey_(name) : emp360NameNorm_(name).replace(/\s+/g, '');
      var mine = k && picture[k];
      if (mine) {
        for (var c in mine.certs) {
          if (!Object.prototype.hasOwnProperty.call(mine.certs, c)) continue;
          certs[c] = {
            label: (typeof certLabel_ === 'function') ? certLabel_(c) : c,
            status: mine.certs[c].status,
            expires: mine.certs[c].expires || '',
            category: mine.certs[c].category || ''
          };
        }
      }
    } catch (e) { }
  }
  return {
    certs: certs,
    fields: emp360Fields_(masterRow, 'training', false)
  };
}

function emp360BuildBackground_(masterRow) {
  return {
    fields: emp360Fields_(masterRow, 'background', false),
    scorecard: emp360Scorecard_(masterRow).filter(function (s) {
      return ['sam', 'oig', 'abuser', 'sex_offender', 'offender', 'nurse_aide',
              'exclusions', 'bci', 'rapback'].indexOf(s.key) !== -1;
    })
  };
}

function emp360BuildHr_(name) {
  var callOffs = emp360ReadTab_(hubId_('EMP360_MASTER_DATA_ID'), EMP360_CALL_OFF_TAB)
    .filter(function (r) { return emp360NameHit_(r.employee_name, name); });
  var hr = emp360ReadTab_(hubId_('EMP360_MASTER_DATA_ID'), EMP360_HR_TAB)
    .filter(function (r) { return emp360NameHit_(r.employees_involved, name); });
  return { callOffs: callOffs.slice(0, 50), hrRecords: hr.slice(0, 50) };
}

function emp360BuildActivity_(name) {
  var requests = emp360ReadTab_(hubId_('EMP360_WORK_QUEUE_ID'), EMP360_REQUESTS_TAB)
    .filter(function (r) { return emp360NameHit_(r.requestor, name); });
  var notes = emp360ReadTab_(hubId_('EMP360_MASTER_DATA_ID'), EMP360_DAILY_NOTES_TAB)
    .filter(function (r) { return emp360NameHit_(r.dsp_name, name); });
  return { supportRequests: requests.slice(0, 50), dailyNotes: notes.slice(0, 50) };
}

HUB_POLICY.emp360Detail = {
  file: 'Emp360.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
/** One 360 tab for one employee; an unknown tab is a 400, never a guess. */
HUB_ACTIONS.emp360Detail = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var tab = str_(payload.tab) || 'info';
  if (EMP360_DETAIL_TABS.indexOf(tab) === -1) {
    return { status: 400, message: 'Unknown tab "' + tab + '". Valid: ' + EMP360_DETAIL_TABS.join(', ') + '.' };
  }

  var id = emp360Resolve_(payload);
  if (id.error) return id.error;

  var data = {
    person: id.person,
    matched: !!id.master,
    matchedBy: id.matchedBy,
    masterRow: id.master ? id.master.id : null,
    tab: tab
  };
  if (!id.master) {
    data.message = 'No row in the Employee Database matches this person.';
    return { status: 200, data: data };
  }

  if (tab === 'info') data.info = emp360BuildInfo_(id.master);
  else if (tab === 'docs') data.docs = emp360BuildDocs_(id.person.name, id.master);
  else if (tab === 'training') data.training = emp360BuildTraining_(id.person.name, id.master);
  else if (tab === 'background') data.background = emp360BuildBackground_(id.master);
  else if (tab === 'hr') data.hr = emp360BuildHr_(id.person.name);
  else if (tab === 'activity') data.activity = emp360BuildActivity_(id.person.name);

  return { status: 200, data: data };
};

// Why the live row is no longer the one the cached read resolved ('' while it is): its Employee ID, else its name…
function emp360RowMoved_(header, live, id, tz) {
  var m = id.master || {};
  var at = function (key) {
    var c = header.lastIndexOf(key);
    return c === -1 ? '' : String(emp360Cell_(live[c], tz)).trim();
  };
  var eid = String(m.employee_id == null ? '' : m.employee_id).trim();
  if (eid) {
    if (at('employee_id') !== eid) return 'it no longer carries Employee ID "' + eid + '"';
  } else {
    var was = emp360NameNorm_(m.employee || m.name || '');
    if (was && emp360NameNorm_(at('employee') || at('name')) !== was) return 'it no longer names this person';
  }
  if (id.matchedBy === 'name (Active)' && !emp360StatusActive_({ status: at('status') })) {
    return 'its Status is no longer Active';
  }
  return '';
}

// `allowNonEditable` is an argument, never a payload field: the resolver does not strip undeclared params.
function emp360WriteCell_(payload, user, allowNonEditable, at, held) {
  var field = emp360Key_(payload.field);
  if (emp360PiiBlocked_(field)) {
    return { status: 403, message: '"' + field + '" is protected — it is never read or written here.' };
  }
  if (!allowNonEditable && !emp360EditableField_(field)) {
    return { status: 400, message: '"' + field + '" is not an editable Employee 360 field.' };
  }

  var id = emp360Resolve_(payload);
  if (id.error) return id.error;
  if (!id.master) {
    return { status: 404, message: 'No row in the Employee Database matches this person — nothing to write to.' };
  }
  var rowNum = parseInt(String(id.master.id).slice(1), 10);

  var lock = held ? null : LockService.getScriptLock();
  try { if (lock) lock.waitLock(20000); }
  catch (e) { return { status: 503, message: 'The sheet is busy — try again in a moment.' }; }
  try {
    var ss = ssOpen_(empDbId_());
    var masterTab = emp360MasterTab_();
    var sheet = ss.getSheetByName(masterTab);
    if (!sheet) return { status: 500, message: 'The Master tab could not be opened.' };
    var tz = ss.getSpreadsheetTimeZone();
    var width = sheet.getLastColumn();
    var header = sheet.getRange(1, 1, 1, width).getValues()[0].map(emp360Key_);
    var col = header.indexOf(field);
    if (at !== undefined) {
      if (header[at] !== field) {
        cacheBump_(cacheScopeSheet_(empDbId_(), masterTab));
        return { status: 409, message: 'The Employee Database columns moved since they were read — reloaded, nothing was written.' };
      }
      col = at;
    }
    if (col === -1) {
      return { status: 400, message: 'The Master tab has no "' + field + '" column — the estate renamed it.' };
    }

    // The estate's own forms write into this sheet between a read and a save.
    var live = sheet.getRange(rowNum, 1, 1, width).getValues()[0];
    // The row number came from a cached read; a row inserted or sorted by hand since puts someone else on it.
    var moved = emp360RowMoved_(header, live, id, tz);
    if (moved) {
      cacheBump_(cacheScopeSheet_(empDbId_(), masterTab));
      return { status: 409, message: 'The Employee Database row moved since it was read (' + moved +
               ') — reloaded, nothing was written.' };
    }
    var current = emp360Cell_(live[col], tz);
    var expected = str_(payload.expected);
    if (current !== expected) {
      return { status: 409, message: 'Someone changed this row since you opened it — reloaded.',
               data: { current: current } };
    }

    if (sheet.getRange(rowNum, col + 1).getFormula()) {
      return { status: 409, message: 'That cell computes itself from other columns — edit the source field instead.' };
    }

    sheet.getRange(rowNum, col + 1).setValue(hubCellSafe_(str_(payload.value)));
    // Bump the sheet's own scope: every reader of this tab caches under it.
    cacheBump_(cacheScopeSheet_(empDbId_(), masterTab));

    hubSysLog_(user.email, 'emp360WriteCell',
      id.person.name + ': ' + field + ' (row ' + rowNum + ')' + (allowNonEditable ? ' · via review' : ''),
      { status: 200 });
    return { status: 200, data: { field: field, value: str_(payload.value), row: id.master.id } };
  } finally {
    try { if (lock) lock.releaseLock(); } catch (eR) {}
  }
}

HUB_POLICY.emp360EditField = {
  file: 'Emp360.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['certMatrix', 'staffCerts'], emits: []
};
/** The screen's edit door: editability is decided by the column list. */
HUB_ACTIONS.emp360EditField = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  return emp360WriteCell_(payload, user, false);
};
