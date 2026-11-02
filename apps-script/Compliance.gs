// The Master's scorecard columns are formula-owned: read and counted here, never written.
var COMPLIANCE_MASTER_TAB = 'Master';

// The `ist_cert_source_tabs` cell wins, so Certs.gs and Emp360.gs move with any rename.
function complianceMasterTab_() {
  if (typeof certSourceTab_ !== 'function') return COMPLIANCE_MASTER_TAB;
  try { return certSourceTab_('master') || COMPLIANCE_MASTER_TAB; }
  catch (e) { return COMPLIANCE_MASTER_TAB; }
}

var COMPLIANCE_PENDING_TAB = 'PendingReviews';

var COMPLIANCE_REVIEWS_TAB = 'compliance_reviews';

// Positional: new columns are appended and only blank header cells are ever named.
var COMPLIANCE_REVIEWS_HEADER = [
  'id', 'createdAt',
  'submitter', 'docType', 'dateField',
  'aiExpDate', 'aiCertDate', 'aiConfidence', 'isCandidate', 'sourceRow',
  'verdict', 'note', 'resolvedBy', 'resolvedAt'
];

// 'ssn' is a prefix block: the sheet grows derived SSN columns.
var COMPLIANCE_PII_EXACT = ['date of birth', 'dob', 'birth date', 'login', 'password',
                            'social security', 'social security number'];

// Separators collapse first, so 'Date_of_Birth' cannot slip past.
function compliancePiiBlocked_(header) {
  var h = String(header || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
  if (!h) return false;
  if (h.indexOf('ssn') !== -1) return true;
  return COMPLIANCE_PII_EXACT.indexOf(h) !== -1;
}

// Headers match exactly, never normalized: stripping parentheses would fold 'i9 (Type 1)' into 'i9 (Type 2)'.
var COMPLIANCE_ITEMS = [
  { id: 'referral_paid',  header: 'Referral Paid',         label: 'Referral Paid',        category: 'admin',      dateHeader: '',                            naEligible: false },
  { id: 'job_app',        header: 'Job App',               label: 'Job Application',      category: 'onboarding', dateHeader: '',                            naEligible: false },
  { id: 'attestation',    header: 'Attestation',           label: 'Attestation',          category: 'onboarding', dateHeader: '',                            naEligible: false },
  { id: 'i9_form',        header: 'i9 Form',               label: 'I-9 Form',             category: 'onboarding', dateHeader: '',                            naEligible: false },
  { id: 'w4_form',        header: 'W4 Form',               label: 'W-4 Form',             category: 'onboarding', dateHeader: '',                            naEligible: false },
  { id: 'hipaa_form',     header: 'HIPAA Form',            label: 'HIPAA Form',           category: 'onboarding', dateHeader: '',                            naEligible: false },
  { id: 'pay_auth_form',  header: 'Pay Auth Form',         label: 'Pay Authorization',    category: 'onboarding', dateHeader: '',                            naEligible: false },
  { id: 'hs_diploma',     header: 'HS Diploma',            label: 'HS Diploma',           category: 'onboarding', dateHeader: '',                            naEligible: true },
  { id: 'i9_type_1',      header: 'i9 (Type 1)',           label: 'I-9 Type 1',           category: 'documents',  dateHeader: 'I-9 1 Exp Date',              naEligible: false },
  { id: 'i9_type_2',      header: 'i9 (Type 2)',           label: 'I-9 Type 2',           category: 'documents',  dateHeader: 'I-9 2 Exp Date',              naEligible: false },
  { id: 'driver_license', header: 'Driver License',        label: "Driver's License",     category: 'documents',  dateHeader: 'License Exp Date',            naEligible: true },
  { id: 'drive_abstract', header: 'Drive Abstract (last)', label: "Driver's Abstract",    category: 'documents',  dateHeader: "Driver's Abstract (Latest)",  naEligible: true },
  { id: 'car_insurance',  header: 'Car Insurance',         label: 'Car Insurance',        category: 'documents',  dateHeader: 'Insurance Exp Date',          naEligible: true },
  { id: 'sam',            header: 'SAM',                   label: 'SAM',                  category: 'background', dateHeader: '',                            naEligible: false },
  { id: 'oig',            header: 'OIG',                   label: 'OIG',                  category: 'background', dateHeader: '',                            naEligible: false },
  { id: 'abuser',         header: 'Abuser',                label: 'Abuser Registry',      category: 'background', dateHeader: '',                            naEligible: false },
  { id: 'sex_offender',   header: 'Sex Offender',          label: 'Sex Offender',         category: 'background', dateHeader: '',                            naEligible: false },
  { id: 'offender',       header: 'Offender',              label: 'Offender',             category: 'background', dateHeader: '',                            naEligible: false },
  { id: 'nurse_aide',     header: 'Nurse Aide',            label: 'Nurse Aide Registry',  category: 'background', dateHeader: '',                            naEligible: false },
  { id: 'exclusions',     header: 'Exclusions',            label: 'Exclusions Database',  category: 'background', dateHeader: '',                            naEligible: false },
  { id: 'bci',            header: 'BCI',                   label: 'BCI/FBI',              category: 'background', dateHeader: 'BCI Check Date',              naEligible: false },
  { id: 'rapback',        header: 'Rapback',               label: 'Rapback',              category: 'background', dateHeader: 'Rapback Entry Date',          naEligible: false },
  { id: 'train_dodd',     header: 'Train - DODD',          label: 'DODD 8-Hour',          category: 'training',   dateHeader: 'DODD 8-Hour Exp',             naEligible: false },
  { id: 'train_cpr',      header: 'Train - CPR',           label: 'CPR / First Aid',      category: 'training',   dateHeader: 'CPR Exp Date',                naEligible: false },
  { id: 'train_med_1',    header: 'Train - Med Del 1',     label: 'Med Del Level 1',      category: 'training',   dateHeader: 'Med 1 Exp Date',              naEligible: false },
  { id: 'train_med_2',    header: 'Train - Med Del 2',     label: 'Med Del Level 2',      category: 'training',   dateHeader: 'Med 2 Exp Date',              naEligible: false },
  { id: 'train_med_3',    header: 'Train - Med Del 3',     label: 'Med Del Level 3',      category: 'training',   dateHeader: 'Med 3 Exp Date',              naEligible: false },
  { id: 'train_mandt',    header: 'Train - MANDTT',        label: 'Mandt',                category: 'training',   dateHeader: 'Mandt Exp Date',              naEligible: false }
];

var COMPLIANCE_MATRIX_TABS = ['onboarding', 'documents', 'background', 'training'];

var COMPLIANCE_ACTIVE_STATUSES = { yes: 1, other: 1, active: 1 };

// Skipped and named in every answer: a silent skip looks like a missed person.
var COMPLIANCE_NON_PERSON_LABELS = ['OPEN', 'WORKSHOP', 'FAMILY', 'NURSE', 'LOCATION',
                                    'NEW', 'TBD', 'VACANT', 'N/A', 'NA', 'TEST'];

function complianceNonPerson_(name) {
  var n = String(name || '').trim().toUpperCase();
  if (!n) return true;
  return COMPLIANCE_NON_PERSON_LABELS.indexOf(n) !== -1;
}

// Pure helpers — no Google calls, so the self-test can run them.

// Builds local dates: new Date('yyyy-MM-dd') parses as UTC and loses a day west of Greenwich.
function complianceDateMs_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  var s = String(v).trim();
  if (!s) return null;
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])).getTime();
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function complianceDays_(ms, nowMs) {
  return Math.floor((ms - nowMs) / 86400000);
}

function complianceIsoDay_(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Anything but 1 / 0.5 / 0 / n/a is 'other': reported, never counted as compliant.
function complianceState_(v) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (s === '') return 'blank';
  if (s === '1') return 'ok';
  if (s === '0.5') return 'warning';
  if (s === '0') return 'missing';
  if (s.toLowerCase() === 'n/a' || s.toLowerCase() === 'na') return 'na';
  return 'other';
}

function complianceItem_(id) {
  for (var i = 0; i < COMPLIANCE_ITEMS.length; i++) {
    if (COMPLIANCE_ITEMS[i].id === id) return COMPLIANCE_ITEMS[i];
  }
  return null;
}

function complianceNameKey_(v) {
  if (typeof clientNameKey_ === 'function') return clientNameKey_(v);
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// `tz` must be the workbook's own timezone: 1899-anchored time cells drift 32 minutes under UTC reads.
function complianceEstateCell_(v, tz) {
  if (typeof estateCell_ === 'function') return estateCell_(v, tz);
  if (!(v instanceof Date)) return String(v === null || v === undefined ? '' : v);
  if (v.getFullYear() < 1900) return Utilities.formatDate(v, tz, 'HH:mm');
  return v.toISOString();
}

// Throws when the Master cannot be opened, so callers answer 503, never an empty success.
function complianceMasterTable_() {
  var produce = function () {
    var ss = ssOpen_(empDbId_());
    var masterTab = complianceMasterTab_();
    var sheet = ss.getSheetByName(masterTab);
    if (!sheet) throw new Error('the Employee Database has no "' + masterTab + '" tab');
    var tz = ss.getSpreadsheetTimeZone();
    var values = sheet.getDataRange().getValues();
    if (values.length < 1) return { headers: [], rows: [] };
    var headers = [];
    for (var h = 0; h < values[0].length; h++) headers.push(String(values[0][h]).trim());
    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var row = { _row: r + 1 };
      var empty = true;
      for (var c = 0; c < headers.length; c++) {
        if (!headers[c]) continue;
        if (compliancePiiBlocked_(headers[c])) continue;
        var v = values[r][c];
        // Never v.toISOString(): time-only cells become 1899 dates.
        if (v instanceof Date) v = complianceEstateCell_(v, tz);
        v = String(v === null || v === undefined ? '' : v);
        if (v) empty = false;
        row[headers[c]] = v;
      }
      if (!empty) rows.push(row);
    }
    var kept = [];
    for (var k = 0; k < headers.length; k++) {
      if (headers[k] && !compliancePiiBlocked_(headers[k])) kept.push(headers[k]);
    }
    return { headers: kept, rows: rows };
  };
  if (typeof cacheRead_ === 'function') {
    return cacheRead_(cacheScopeSheet_(empDbId_(), complianceMasterTab_()), 'master', produce);
  }
  return produce();
}

// Nobody active is a 503: a scorecard over nobody would render as everyone compliant.
function complianceActiveRows_() {
  var table;
  try {
    table = complianceMasterTable_();
  } catch (e) {
    return { error: { status: 503, message: 'The Employee Database Master could not be read (' +
             String((e && e.message) || e) + ') — no compliance answer is possible right now.' } };
  }
  if (!table.rows.length) {
    return { error: { status: 503, message: 'The Employee Database Master answered with no rows at all — ' +
             'a scorecard over nobody would read as fully compliant, so this refuses instead.' } };
  }
  if (table.headers.indexOf('Status') === -1) {
    return { error: { status: 503, message: 'The Master has no "Status" column — without it active staff ' +
             'cannot be told from former staff, and the scorecard would count everyone who ever worked here.' } };
  }
  var nameHeader = table.headers.indexOf('Employee') !== -1 ? 'Employee' : table.headers[0];
  if (!nameHeader) {
    return { error: { status: 503, message: 'The Master has no readable name column — nobody can be ' +
             'identified, so nothing can be counted.' } };
  }

  var active = [], skipped = [];
  for (var i = 0; i < table.rows.length; i++) {
    var row = table.rows[i];
    var name = String(row[nameHeader] || '').trim();
    if (!name) continue;
    if (complianceNonPerson_(name)) { skipped.push(name); continue; }
    var status = String(row.Status || '').trim().toLowerCase();
    if (!COMPLIANCE_ACTIVE_STATUSES[status]) continue;
    row._name = name;
    active.push(row);
  }
  if (!active.length) {
    return { error: { status: 503, message: 'The Master has rows but not one active employee ' +
             '(Status yes/other/active). An all-inactive read is a broken read wearing the clothes ' +
             'of a clean result — nothing is counted.' } };
  }
  return { headers: table.headers, rows: active, skippedLabels: skipped };
}

function complianceCell_(row, item, headers, nowMs) {
  if (headers.indexOf(item.header) === -1) {
    return { state: 'unreadable', value: '', date: '', daysLeft: null };
  }
  var out = {
    state: complianceState_(row[item.header]),
    value: String(row[item.header] === undefined ? '' : row[item.header]),
    date: '', daysLeft: null
  };
  if (item.dateHeader && headers.indexOf(item.dateHeader) !== -1) {
    var ms = complianceDateMs_(row[item.dateHeader]);
    if (ms !== null) {
      out.date = complianceIsoDay_(ms);
      out.daysLeft = complianceDays_(ms, nowMs);
    }
  }
  return out;
}

// Whose rows of the Master a caller is answered: all of them for the real master in its own session; anyone else…
function complianceWhose_(user) {
  if (hubIsRealMaster_(user)) return { all: true, scope: 'all', self: null };
  var self = complianceDocsSelf_(user);
  if (!self.key) return { refusal: complianceDocsRefusal_(self) };
  return { all: false, scope: 'own', self: self };
}

/** The Master rows `whose` may read: every one, or the one carrying the caller's name; two with that name refuse. */
function complianceOwnRows_(whose, rows) {
  if (whose.all) return { rows: rows };
  var mine = rows.filter(function (r) { return hubNameFold_(r && r._name) === whose.self.key; });
  if (mine.length > 1) {
    return { refusal: { status: 409, scope: 'own', self: whose.self.name,
             message: 'Two active rows of the Employee Database carry your name, so which one is yours cannot be ' +
                      'settled — an administrator merges them or gives one a distinguishing name.' } };
  }
  return { rows: mine };
}

/** An own answer with no row of the caller's says so, rather than counting nobody as compliant. */
function complianceOwnNote_(whose, rows) {
  return (!whose.all && !rows.length)
    ? 'Your name is not on an active row of the Employee Database Master, so nothing is counted for you.' : '';
}

/** The compliance scorecard: counted over every active employee for the real master, over the caller's own row for anyone else. */
HUB_POLICY.complianceScorecard = {
  file: 'Compliance.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.complianceScorecard = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();

  var whose = complianceWhose_(user);
  if (whose.refusal) return whose.refusal;
  var got = complianceActiveRows_();
  if (got.error) { got.error.scope = whose.scope; return got.error; }
  var own = complianceOwnRows_(whose, got.rows);
  if (own.refusal) return own.refusal;
  var headers = got.headers, rows = own.rows;
  var now = Date.now();

  // 'unreadable' is decided once per item from the header: a renamed column is gone for every row.
  var items = [];
  var itemStates = {};
  for (var i = 0; i < COMPLIANCE_ITEMS.length; i++) {
    var item = COMPLIANCE_ITEMS[i];
    var readable = headers.indexOf(item.header) !== -1;
    var entry = {
      id: item.id, label: item.label, category: item.category,
      source: readable
        ? "Employee Database › Master › '" + item.header + "'"
        : "Employee Database › Master — no '" + item.header + "' column",
      state: readable ? 'readable' : 'unreadable',
      counts: { ok: 0, warning: 0, missing: 0, na: 0, other: 0, blank: 0 },
      expired: [], expiring: []
    };
    itemStates[item.id] = [];
    if (readable) {
      for (var r = 0; r < rows.length; r++) {
        var cell = complianceCell_(rows[r], item, headers, now);
        entry.counts[cell.state] = (entry.counts[cell.state] || 0) + 1;
        itemStates[item.id].push(cell.state);
        if (cell.state === 'missing' && entry.expired.length < 25) {
          entry.expired.push({ name: rows[r]._name, date: cell.date, daysLeft: cell.daysLeft });
        } else if (cell.state === 'warning' && entry.expiring.length < 25) {
          entry.expiring.push({ name: rows[r]._name, date: cell.date, daysLeft: cell.daysLeft });
        }
      }
    }
    items.push(entry);
  }

  // Rolled up from the same states counted above, so tiles and items always agree.
  var metrics = { activeEmployees: rows.length, fullyCompliant: 0, withWarnings: 0, withExpired: 0 };
  for (var e = 0; e < rows.length; e++) {
    var expired = 0, warning = 0;
    for (var j = 0; j < COMPLIANCE_ITEMS.length; j++) {
      var st = itemStates[COMPLIANCE_ITEMS[j].id][e];
      if (st === 'missing') expired++;
      else if (st === 'warning') warning++;
    }
    if (expired > 0) metrics.withExpired++;
    else if (warning > 0) metrics.withWarnings++;
    else metrics.fullyCompliant++;
  }

  var unreadable = [];
  for (var u = 0; u < items.length; u++) {
    if (items[u].state === 'unreadable') unreadable.push(items[u].label);
  }

  return { status: 200, data: {
    metrics: metrics,
    items: items,
    unreadableItems: unreadable,
    skippedLabels: whose.all ? got.skippedLabels : [],
    scope: whose.scope,
    self: whose.all ? '' : whose.self.name,
    note: complianceOwnNote_(whose, rows)
  } };
};

// One category per call, paged: no click pays for the whole 28-column grid.
HUB_POLICY.complianceMatrix = {
  file: 'Compliance.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: {
    tab: { type: 'string' },       // onboarding | documents | background | training
    limit: { type: 'number' },     // rows per page, default 50, max 200
    offset: { type: 'number' }
  }
};
HUB_ACTIONS.complianceMatrix = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};

  var tab = str_(payload.tab) || 'documents';
  if (COMPLIANCE_MATRIX_TABS.indexOf(tab) === -1) {
    return { status: 400, message: 'Unknown tab "' + tab + '". Valid: ' +
             COMPLIANCE_MATRIX_TABS.join(', ') + '.' };
  }
  var limit = parseInt(payload.limit, 10);
  if (isNaN(limit) || limit < 1) limit = 50;
  if (limit > 200) limit = 200;
  var offset = parseInt(payload.offset, 10);
  if (isNaN(offset) || offset < 0) offset = 0;

  var whose = complianceWhose_(user);
  if (whose.refusal) return whose.refusal;
  var got = complianceActiveRows_();
  if (got.error) { got.error.scope = whose.scope; return got.error; }
  var own = complianceOwnRows_(whose, got.rows);
  if (own.refusal) return own.refusal;
  var headers = got.headers, rows = own.rows;
  var now = Date.now();

  var items = [];
  for (var i = 0; i < COMPLIANCE_ITEMS.length; i++) {
    if (COMPLIANCE_ITEMS[i].category === tab) items.push(COMPLIANCE_ITEMS[i]);
  }

  var employees = [];
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var cells = {}, expired = 0, warning = 0;
    for (var c = 0; c < items.length; c++) {
      var cell = complianceCell_(row, items[c], headers, now);
      cells[items[c].id] = cell;
      if (cell.state === 'missing') expired++;
      else if (cell.state === 'warning') warning++;
    }
    employees.push({
      name: row._name,
      phone: String(row['Phone Number'] || ''),
      email: String(row['Email'] || ''),
      allCompleted: String(row['All Completed'] || ''),
      expired: expired, warning: warning,
      cells: cells
    });
  }

  employees.sort(function (a, b) {
    if (b.expired !== a.expired) return b.expired - a.expired;
    if (b.warning !== a.warning) return b.warning - a.warning;
    return a.name.localeCompare(b.name);
  });

  var total = employees.length;
  var page = employees.slice(offset, offset + limit);

  var unreadable = [];
  for (var u = 0; u < items.length; u++) {
    if (headers.indexOf(items[u].header) === -1) unreadable.push(items[u].label);
  }

  return { status: 200, data: {
    tab: tab,
    items: items.map(function (it) {
      return { id: it.id, label: it.label, dateHeader: it.dateHeader,
               naEligible: it.naEligible,
               source: "Employee Database › Master › '" + it.header + "'" };
    }),
    employees: page,
    total: total, offset: offset, limit: limit,
    unreadableItems: unreadable,
    skippedLabels: whose.all ? got.skippedLabels : [],
    scope: whose.scope,
    self: whose.all ? '' : whose.self.name,
    note: complianceOwnNote_(whose, rows)
  } };
};

function complianceReviewsSheet_() {
  // Asked before the maker: only an older tab owes the header repair below.
  var existed = !!hubTabSheet_(COMPLIANCE_REVIEWS_TAB);
  var sheet = hubTabEnsure_(COMPLIANCE_REVIEWS_TAB, COMPLIANCE_REVIEWS_HEADER);
  if (!existed) return sheet;
  var width = Math.max(1, sheet.getLastColumn());
  var hdr = sheet.getRange(1, 1, 1, width).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  if (!hdr[0]) {
    sheet.getRange(1, 1, 1, COMPLIANCE_REVIEWS_HEADER.length).setValues([COMPLIANCE_REVIEWS_HEADER]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  var missing = COMPLIANCE_REVIEWS_HEADER.filter(function (h) { return hdr.indexOf(h) === -1; });
  if (missing.length) {
    if (sheet.getMaxColumns() < hdr.length + missing.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(),
        hdr.length + missing.length - sheet.getMaxColumns());
    }
    sheet.getRange(1, hdr.length + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function complianceReviewsById_() {
  var sheet = complianceReviewsSheet_();
  var last = sheet.getLastRow();
  var byId = {};
  if (last < 2) return byId;
  var width = sheet.getLastColumn();
  var values = sheet.getRange(1, 1, last, width).getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  for (var r = 1; r < values.length; r++) {
    var row = {};
    for (var c = 0; c < hdr.length; c++) {
      if (!hdr[c]) continue;
      var v = values[r][c];
      // HUB_DB is Etc/GMT, so cellText_ (not estateCell_) is right here.
      if (v instanceof Date) v = cellText_(v);
      row[hdr[c]] = String(v === null || v === undefined ? '' : v);
    }
    if (row.id) byId[row.id] = row;
  }
  return byId;
}

// null when the source could not be asked, an array (maybe empty) when it answered.
function compliancePendingSource_() {
  var produce = function () {
    var ss = ssOpen_(hubId_('COMPLIANCE_APPDATA_ID'));
    var sheet = ss.getSheetByName(COMPLIANCE_PENDING_TAB);
    if (!sheet) return null;
    var tz = ss.getSpreadsheetTimeZone();
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return [];
    var hdr = values[0].map(function (h) { return String(h).trim(); });
    var out = [];
    for (var r = 1; r < values.length; r++) {
      var row = { _row: r + 1 };
      var empty = true;
      for (var c = 0; c < hdr.length; c++) {
        if (!hdr[c]) continue;
        if (compliancePiiBlocked_(hdr[c])) continue;
        var v = values[r][c];
        if (v instanceof Date) v = complianceEstateCell_(v, tz);
        v = String(v === null || v === undefined ? '' : v);
        if (v) empty = false;
        row[hdr[c]] = v;
      }
      if (empty) continue;
      row._id = row.FileId ? 'cr_' + row.FileId : 'cr_r' + (r + 1);
      out.push(row);
    }
    return out;
  };
  try {
    if (typeof cacheRead_ === 'function') {
      var got = cacheRead_(cacheScopeSheet_(hubId_('COMPLIANCE_APPDATA_ID'), COMPLIANCE_PENDING_TAB),
                           'rows', produce);
      return got === undefined ? null : got;
    }
    return produce();
  } catch (e) {
    return null;
  }
}

function complianceQueueItem_(src) {
  var masterNow = complianceMasterNow_(String(src.SubmitterName || ''),
                                       String(src.DateField || ''));
  return {
    id: src._id,
    submitter: String(src.SubmitterName || ''),
    docType: String(src.DocType || ''),
    dateField: String(src.DateField || ''),
    // Echoed back as `expected`, so a row edited underneath refuses instead of silently winning.
    masterNow: masterNow.value,
    masterNowWhy: masterNow.why,
    aiConfidence: String(src.AIConfidence || ''),
    aiExpDate: String(src.AIExtractedExpDate || ''),
    aiCertDate: String(src.AIExtractedCertDate || ''),
    aiName: String(src.AIExtractedName || ''),
    readability: String(src.AIReadability || ''),
    docTypeMatch: String(src.AIDocTypeMatch || '') === 'true',
    isCandidate: String(src.IsCandidate || '') === 'yes',
    thumbnail: String(src.ThumbnailUrl || ''),
    uploadedAt: String(src.UploadedAt || src.SubmittedAt || src.Timestamp || '')
  };
}

// The reviewers' door by design: a writer approves other people's submitted documents here, the on-behalf work certDocUpload also allows them.
HUB_POLICY.complianceReviewQueue = {
  file: 'Compliance.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.complianceReviewQueue = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();

  var source = compliancePendingSource_();
  if (source === null) {
    return { status: 503, message: 'The staff-docs review queue (App Data › ' +
             COMPLIANCE_PENDING_TAB + ') could not be read — the workbook or the tab did not ' +
             'answer. Nothing is pending is NOT what this means; try again once the sheet is back.' };
  }

  var resolved = complianceReviewsById_();
  var pending = [], resolvedCount = 0, legacyResolved = 0;
  for (var i = 0; i < source.length; i++) {
    var src = source[i];
    var status = String(src.ReviewStatus || '').trim().toLowerCase();
    if (resolved[src._id]) { resolvedCount++; continue; }
    if (status && status !== 'pending') { legacyResolved++; continue; }
    pending.push(complianceQueueItem_(src));
  }
  pending.reverse();

  return { status: 200, data: {
    pending: pending,
    counts: { pending: pending.length, resolvedHere: resolvedCount,
              resolvedInLegacyPortal: legacyResolved },
    message: pending.length ? '' : 'The queue answered and it is empty — nothing waits for review.'
  } };
};

// Name to Employee ID (emp360WriteCell_ never matches by name); the witness read and the write must share it.
function complianceMasterTarget_(personName, knownId) {
  var name = str_(personName);
  if (!name) return { ok: false, why: 'the review names nobody' };
  var eid = str_(knownId);
  var found;
  try { found = emp360FindMasterRow_(eid ? '' : name, eid); }
  catch (e) { return { ok: false, why: 'the Employee Database could not be read' }; }
  if (found.conflict) {
    return { ok: false, why: found.conflict + ' Master rows match ' + (eid ? 'Employee ID "' + eid + '"' : '"' + name + '"') +
             ' — sort the duplicate out first' };
  }
  if (!found.row) {
    return { ok: false, why: eid ? 'no Master row carries Employee ID "' + eid + '", the one the roster gives "' + name + '"'
                                 : 'no Master row matches "' + name + '"' };
  }
  if (eid && emp360NameNorm_(found.row.employee || found.row.name) !== emp360NameNorm_(name)) {
    return { ok: false, why: 'the Master row carrying Employee ID "' + eid + '" names someone other than "' + name + '"' };
  }
  var employeeId = str_(found.row.employee_id);
  if (!employeeId) {
    return { ok: false, row: found.row,
             why: 'the Master row for "' + name + '" has no Employee ID, so a write cannot be keyed to it' };
  }
  return { ok: true, employeeId: employeeId, row: found.row };
}

function complianceMasterNow_(personName, dateField, knownId) {
  if (!dateField) return { ok: false, value: '', why: 'the review names no date column' };
  var target = complianceMasterTarget_(personName, knownId);
  if (!target.row) return { ok: false, value: '', why: target.why };
  var key = emp360Key_(dateField);
  if (!Object.prototype.hasOwnProperty.call(target.row, key)) {
    return { ok: false, value: '', why: 'the Master has no "' + dateField + '" column' };
  }
  return { ok: true, value: str_(target.row[key]), why: '' };
}

// Only the date: the flag columns are formulas derived from it. Delegates to the one Master writer.
function complianceWriteMasterDate_(personName, dateField, value, expected, user, knownId) {
  if (!dateField) return { ok: false, why: 'the review names no date column' };
  // Med Del dates belong to the Med Del engine; two writers on one cell collide.
  if (/^med\s*\d/i.test(String(dateField))) {
    return { ok: false, why: 'Med Del dates are written by the delegation engine' };
  }
  var target = complianceMasterTarget_(personName, knownId);
  if (!target.ok) return { ok: false, why: target.why };
  try {
    // The permission is an argument here, never a payload field a browser could set.
    var res = emp360WriteCell_({
      employeeId: target.employeeId, field: dateField, value: str_(value),
      expected: expected === undefined || expected === null ? '' : str_(expected)
    }, user, true);
    if (res && res.status === 200) return { ok: true, row: res.data && res.data.row };
    return { ok: false, why: str_(res && res.message) || 'refused' };
  } catch (e) {
    return { ok: false, why: String((e && e.message) || e) };
  }
}

// Best effort: the verdict is already recorded and must not fail on a workbook this file does not own.
function complianceStampLegacy_(rowNum, verdict, who) {
  try {
    var sheet = ssOpen_(hubId_('COMPLIANCE_APPDATA_ID'))
      .getSheetByName(COMPLIANCE_PENDING_TAB);
    if (!sheet) return { ok: false, why: 'tab missing' };
    var width = sheet.getLastColumn();
    var hdr = sheet.getRange(1, 1, 1, width).getValues()[0]
      .map(function (h) { return String(h).trim(); });
    var r = parseInt(rowNum, 10);
    if (!r || r < 2 || r > sheet.getLastRow()) return { ok: false, why: 'row out of range' };
    var wrote = [];
    [['ReviewStatus', verdict], ['ReviewedBy', who],
     ['ReviewedAt', new Date().toISOString()]].forEach(function (pair) {
      var c = hdr.indexOf(pair[0]);
      if (c === -1) return;
      sheet.getRange(r, c + 1).setValue(pair[1]);
      wrote.push(pair[0]);
    });
    return { ok: wrote.length > 0, wrote: wrote };
  } catch (e) {
    return { ok: false, why: String((e && e.message) || e) };
  }
}

HUB_POLICY.complianceReviewResolve = {
  file: 'Compliance.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  // Must match emp360EditField's invalidations: both write the same Master cell.
  invalidates: ['certMatrix', 'staffCerts'], emits: [],
  params: {
    id: { type: 'string', required: true },
    verdict: { type: 'string', required: true },   // approved | rejected
    note: { type: 'string' },
    // Every param the handler reads must be declared: the resolver does not strip undeclared ones.
    date: { type: 'string' },
    expected: { type: 'string' }
  }
};
HUB_ACTIONS.complianceReviewResolve = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};

  var id = str_(payload.id);
  if (!id) return { status: 400, message: 'Which review? An id from complianceReviewQueue is required.' };
  var verdict = str_(payload.verdict).toLowerCase();
  if (verdict !== 'approved' && verdict !== 'rejected') {
    return { status: 400, message: 'Verdict must be "approved" or "rejected" — got "' +
             str_(payload.verdict) + '".' };
  }

  var source = compliancePendingSource_();
  if (source === null) {
    return { status: 503, message: 'The staff-docs review queue could not be read, so the review "' +
             id + '" cannot be verified to exist — nothing was recorded.' };
  }
  var src = null;
  for (var i = 0; i < source.length; i++) {
    if (source[i]._id === id) { src = source[i]; break; }
  }
  if (!src) {
    return { status: 404, message: 'No review "' + id + '" in the staff-docs queue.' };
  }

  var existing = complianceReviewsById_()[id];
  if (existing) {
    return { status: 409, message: 'That review was already resolved ' +
             (existing.verdict ? '("' + existing.verdict + '") ' : '') + 'by ' +
             (existing.resolvedBy || 'someone') +
             (existing.resolvedAt ? ' on ' + String(existing.resolvedAt).slice(0, 10) : '') +
             ' — a verdict is recorded once.' };
  }

  var dateField = String(src.DateField || '');
  if (dateField && compliancePiiBlocked_(dateField)) {
    return { status: 403, message: 'This review targets the protected column "' + dateField +
             '" — it is never read or written here, and its approval is not recorded here either.' };
  }

  var now = new Date().toISOString();
  var record = {
    id: id, createdAt: now,
    submitter: String(src.SubmitterName || ''),
    docType: String(src.DocType || ''),
    dateField: dateField,
    aiExpDate: String(src.AIExtractedExpDate || ''),
    aiCertDate: String(src.AIExtractedCertDate || ''),
    aiConfidence: String(src.AIConfidence || ''),
    isCandidate: String(src.IsCandidate || ''),
    sourceRow: String(src._row),
    verdict: verdict,
    note: str_(payload.note),
    resolvedBy: str_(user.email),
    resolvedAt: now
  };

  var sheet = complianceReviewsSheet_();
  var width = sheet.getLastColumn();
  var hdr = sheet.getRange(1, 1, 1, width).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  sheet.appendRow(hdr.map(function (h) {
    var v = record[h] !== undefined ? record[h] : '';
    return (typeof hubCellSafe_ === 'function') ? hubCellSafe_(v) : v;
  }));
  try {
    if (typeof cacheBump_ === 'function') {
      cacheBump_(cacheScopeSheet_(empDbId_(), complianceMasterTab_()));
    }
  } catch (eB) { /* slower read at worst */ }

  var stamped = complianceStampLegacy_(src._row, verdict, str_(user.email));

  var wrote = { ok: false, why: 'no date confirmed' };
  if (verdict === 'approved' && str_(payload.date)) {
    wrote = complianceWriteMasterDate_(record.submitter, dateField,
                                       str_(payload.date), payload.expected, user);
  }

  hubSysLog_(str_(user.email), 'complianceReviewResolve',
             record.submitter + ' — ' + record.docType +
             (stamped.ok ? ' · legacy stamped' : ' · legacy NOT stamped: ' + str_(stamped.why)),
             { status: 200, message: verdict });

  return { status: 200, data: {
    id: id, verdict: verdict,
    legacyStamped: !!stamped.ok,
    masterWritten: !!wrote.ok,
    masterWhy: wrote.ok ? '' : str_(wrote.why),
    message: 'Recorded' + (stamped.ok ? ' and the legacy queue was stamped' : '') +
             '. The Master date column (' + (dateField || 'none named') +
             ') ' + (wrote.ok ? 'was written — the sheet computes the flags from it.'
                                : 'was NOT written: ' + str_(wrote.why) + '.') +
             ' The uploaded file was not moved.' +
             (stamped.ok ? '' : ' The legacy queue could NOT be stamped (' + str_(stamped.why) +
              '), so the old portal may still offer this review.')
  } };
};

// `instance` (nameKey#owedIds) keys the sent ledger; a failed read returns [] so nothing wrong is sent.
function complianceReminderSubjects_() {
  var got = complianceActiveRows_();
  if (got.error) return [];
  var headers = got.headers, rows = got.rows;
  var now = Date.now();

  var trainingItems = [];
  for (var i = 0; i < COMPLIANCE_ITEMS.length; i++) {
    if (COMPLIANCE_ITEMS[i].category === 'training') trainingItems.push(COMPLIANCE_ITEMS[i]);
  }

  var out = [];
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var owedLabels = [], owedIds = [], worst = null;
    for (var t = 0; t < trainingItems.length; t++) {
      var cell = complianceCell_(row, trainingItems[t], headers, now);
      if (cell.state !== 'missing' && cell.state !== 'warning') continue;
      var tag = cell.state === 'missing'
        ? (cell.date ? 'expired ' + cell.date : 'missing')
        : (cell.date ? 'expiring ' + cell.date : 'expiring');
      owedLabels.push(trainingItems[t].label + ' (' + tag + ')');
      owedIds.push(trainingItems[t].id);
      if (cell.daysLeft !== null && (worst === null || cell.daysLeft < worst)) worst = cell.daysLeft;
    }
    if (!owedIds.length) continue;
    out.push({
      id: complianceNameKey_(row._name),
      name: row._name,
      phone: String(row['Phone Number'] || ''),
      email: String(row['Email'] || ''),
      owed: owedLabels.join(', '),
      owedIds: owedIds.join(','),
      owedCount: String(owedIds.length),
      worstDaysLeft: worst === null ? '' : String(worst),
      instance: complianceNameKey_(row._name) + '#' + owedIds.join(',')
    });
  }
  return out;
}
