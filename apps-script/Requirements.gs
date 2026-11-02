// Obligations as data: the `requirements` tab, with REQUIREMENTS_CATALOG as the fallback when it cannot be read.

var REQUIREMENTS_TAB = 'requirements';
var REQUIREMENTS_HEADER = [
  'req_id', 'label', 'category', 'applies_to', 'evidence',
  'header', 'date_source', 'credential', 'warn_days', 'consequence',
  'na_eligible', 'enabled', 'sms_text', 'notes',
  'updated_at', 'updated_by',
  // APPEND ONLY: positional against the live tab; blank in an old row means the default.
  'max_attempts', 'frequency'
];

var REQUIREMENTS_CATALOG = [
  { req_id: 'dodd', label: 'DODD 8-Hour', category: 'training', applies_to: 'staff', evidence: 'DODD 8-hour certificate',
    header: 'Train - DODD', date_source: 'DODD 8-Hour Exp', credential: 'dodd',
    warn_days: '30', consequence: 'dodd_expiring', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'cpr', label: 'CPR / First Aid', category: 'training', applies_to: 'staff', evidence: 'CPR / First Aid card',
    header: 'Train - CPR', date_source: 'CPR Exp Date', credential: 'cpr',
    warn_days: '30', consequence: 'cpr_expiring', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'med1', label: 'Med Delivery 1', category: 'training', applies_to: 'staff', evidence: 'Med Del Level 1 certificate',
    header: 'Train - Med Del 1', date_source: 'Med 1 Exp Date', credential: 'med1',
    warn_days: '30', consequence: 'med1_expiring', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'med2', label: 'Med Delivery 2', category: 'training', applies_to: 'staff', evidence: 'Med Del Level 2 certificate',
    header: 'Train - Med Del 2', date_source: 'Med 2 Exp Date', credential: 'med2',
    warn_days: '30', consequence: 'med2_expiring', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'med3', label: 'Med Delivery 3', category: 'training', applies_to: 'staff', evidence: 'Med Del Level 3 certificate',
    header: 'Train - Med Del 3', date_source: 'Med 3 Exp Date', credential: 'med3',
    warn_days: '30', consequence: 'med3_expiring', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'mandt', label: 'Mandt', category: 'training', applies_to: 'staff', evidence: 'MANDT certificate',
    header: 'Train - MANDTT', date_source: 'Mandt Exp Date', credential: 'mandt',
    warn_days: '30', consequence: 'mandt_expiring', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'mais', label: 'MAIS Certification', category: 'training', applies_to: 'staff', evidence: 'MAIS certificate',
    header: '', date_source: '', credential: 'mais',
    warn_days: '30', consequence: 'mais_expiring', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'money', label: 'Money Management', category: 'training', applies_to: 'staff', evidence: 'Money Management certificate',
    header: '', date_source: 'money mgt date', credential: 'money',
    warn_days: '30', consequence: 'money_expiring', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },

  { req_id: 'driver_license', label: "Driver's License", category: 'documents', applies_to: 'staff', evidence: "valid driver's license",
    header: 'Driver License', date_source: 'License Exp Date', credential: 'Driver License Exp Date',
    warn_days: '60', consequence: 'drivers_license_expiring', na_eligible: 'yes', enabled: 'yes',
    sms_text: 'Hi {first_name}, this is {sender}. Your {credential} is about to expire. Once it expires, ' +
              'you\'re not legally allowed to drive, and you may have to take additional tests to get it ' +
              'renewed.\n\nHere\'s what you\'ll need to take with you to your nearest BMV:\n\n' +
              ' -Your current driver\'s license\n' +
              ' -Proof of your Social Security Number (like your SS card or W-2)\n' +
              ' -Two documents showing your Ohio address (utility bill, bank statement, etc.)\n\n' +
              'When you\'re done you can upload your new license to our document portal.\n\n' +
              'https://docs.google.com/forms/d/e/1FAIpQLSeyzahxLs37-qejU19Hynh4jFGwxVsWGgnBPArflgc2bmV3dA/viewform',
    notes: 'OFF. The original sent every one of these to a single hardcoded number instead of to the ' +
          'person — read it, then enable.' },
  { req_id: 'car_insurance', label: 'Car Insurance', category: 'documents', applies_to: 'staff', evidence: 'valid auto insurance card',
    header: 'Car Insurance', date_source: 'Insurance Exp Date', credential: 'Insurance Exp Date',
    warn_days: '15', consequence: 'car_insurance_expiring', na_eligible: 'yes', enabled: 'yes',
    sms_text: 'Hi {first_name}, this is {sender}. Your {credential} is about to expire in {days_left} days. ' +
              'Once it expires, you\'re not legally allowed to drive our clients in your vehicle.\n\n' +
              'Please renew it as soon as possible. If you do not plan to renew please let us know.\n' +
              'When you\'re done you can upload your new insurance card to our document portal.\n\n' +
              'https://docs.google.com/forms/d/e/1FAIpQLSeami3JUtuQXCGHDKXc_SPbrF10TZYTLunf3ge-ZKSD4DeYqQ/viewform?usp=sf_link',
    notes: 'OFF. The original read "our car insurance is about to expire" — "your" is meant, and it has ' +
          'been going out that way. Corrected here.' },
  { req_id: 'i9_type_1', label: 'I-9 Type 1', category: 'documents', applies_to: 'staff', evidence: 'I-9 document (type 1)',
    header: 'i9 (Type 1)', date_source: 'I-9 1 Exp Date', credential: '',
    warn_days: '', consequence: '', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'i9_type_2', label: 'I-9 Type 2', category: 'documents', applies_to: 'staff', evidence: 'I-9 document (type 2)',
    header: 'i9 (Type 2)', date_source: 'I-9 2 Exp Date', credential: '',
    warn_days: '', consequence: '', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'drive_abstract', label: "Driver's Abstract", category: 'documents', applies_to: 'staff', evidence: "current driver's abstract",
    header: 'Drive Abstract (last)', date_source: "Driver's Abstract (Latest)", credential: '',
    warn_days: '', consequence: '', na_eligible: 'yes', enabled: 'yes', sms_text: '', notes: '' },

  { req_id: 'sam', label: 'SAM', category: 'background', applies_to: 'staff', evidence: 'SAM clearance',
    header: 'SAM', date_source: '', credential: '',
    warn_days: '', consequence: '', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'oig', label: 'OIG', category: 'background', applies_to: 'staff', evidence: 'OIG clearance',
    header: 'OIG', date_source: '', credential: '',
    warn_days: '', consequence: '', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'abuser', label: 'Abuser Registry', category: 'background', applies_to: 'staff', evidence: 'Abuser registry check',
    header: 'Abuser', date_source: '', credential: '',
    warn_days: '', consequence: '', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'sex_offender', label: 'Sex Offender', category: 'background', applies_to: 'staff', evidence: 'Sex offender registry check',
    header: 'Sex Offender', date_source: '', credential: '',
    warn_days: '', consequence: '', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'offender', label: 'Offender', category: 'background', applies_to: 'staff', evidence: 'Offender registry check',
    header: 'Offender', date_source: '', credential: '',
    warn_days: '', consequence: '', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'nurse_aide', label: 'Nurse Aide Registry', category: 'background', applies_to: 'staff', evidence: 'Nurse aide registry check',
    header: 'Nurse Aide', date_source: '', credential: '',
    warn_days: '', consequence: '', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'exclusions', label: 'Exclusions Database', category: 'background', applies_to: 'staff', evidence: 'Exclusions database check',
    header: 'Exclusions', date_source: '', credential: '',
    warn_days: '', consequence: '', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'bci', label: 'BCI/FBI', category: 'background', applies_to: 'staff', evidence: 'BCI/FBI check',
    header: 'BCI', date_source: 'BCI Check Date', credential: '',
    warn_days: '', consequence: '', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'rapback', label: 'Rapback', category: 'background', applies_to: 'staff', evidence: 'Rapback enrollment',
    header: 'Rapback', date_source: 'Rapback Entry Date', credential: '',
    warn_days: '', consequence: '', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },

  { req_id: 'job_app', label: 'Job Application', category: 'onboarding', applies_to: 'staff', evidence: 'signed application',
    header: 'Job App', date_source: '', credential: '',
    warn_days: '', consequence: '', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'attestation', label: 'Attestation', category: 'onboarding', applies_to: 'staff', evidence: 'signed attestation',
    header: 'Attestation', date_source: '', credential: '',
    warn_days: '', consequence: '', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'i9_form', label: 'I-9 Form', category: 'onboarding', applies_to: 'staff', evidence: 'completed I-9',
    header: 'i9 Form', date_source: '', credential: '',
    warn_days: '', consequence: '', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'w4_form', label: 'W-4 Form', category: 'onboarding', applies_to: 'staff', evidence: 'completed W-4',
    header: 'W4 Form', date_source: '', credential: '',
    warn_days: '', consequence: '', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'hipaa_form', label: 'HIPAA Form', category: 'onboarding', applies_to: 'staff', evidence: 'signed HIPAA form',
    header: 'HIPAA Form', date_source: '', credential: '',
    warn_days: '', consequence: '', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'pay_auth_form', label: 'Pay Authorization', category: 'onboarding', applies_to: 'staff', evidence: 'signed pay authorization',
    header: 'Pay Auth Form', date_source: '', credential: '',
    warn_days: '', consequence: '', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' },
  { req_id: 'hs_diploma', label: 'HS Diploma', category: 'onboarding', applies_to: 'staff', evidence: 'HS diploma or equivalent',
    header: 'HS Diploma', date_source: '', credential: '',
    warn_days: '', consequence: '', na_eligible: 'yes', enabled: 'yes', sms_text: '', notes: '' },

  { req_id: 'referral_paid', label: 'Referral Paid', category: 'admin', applies_to: 'staff', evidence: 'referral bonus paid',
    header: 'Referral Paid', date_source: '', credential: '',
    warn_days: '', consequence: '', na_eligible: 'no', enabled: 'yes', sms_text: '', notes: '' }
];

function requirementRowValid_(row) {
  return !!(row && str_(row.req_id) && str_(row.label));
}

function requirementsSheet_() {
  var sheet = ensureTab_(REQUIREMENTS_TAB, REQUIREMENTS_HEADER);
  ensureHeader_(sheet, REQUIREMENTS_HEADER);
  return sheet;
}

function requirementsSeed_() {
  var sheet = requirementsSheet_();
  if (sheet.getLastRow() > 1) return { seeded: 0, skipped: true };
  var now = new Date().toISOString();
  var rows = REQUIREMENTS_CATALOG.map(function (r) {
    return REQUIREMENTS_HEADER.map(function (h) {
      if (h === 'updated_at') return now;
      if (h === 'updated_by') return 'requirements-seed';
      return r[h] !== undefined ? r[h] : '';
    });
  });
  sheet.getRange(2, 1, rows.length, REQUIREMENTS_HEADER.length).setValues(rows);
  cacheBump_(REQUIREMENTS_TAB);
  hubSysLog_('requirements', 'requirementsSeed', '',
             { status: 200, detail: rows.length + ' rows' });
  return { seeded: rows.length, skipped: false };
}

// null (not []) when unreadable, so requirementsAll_ falls back to the code catalog.
function requirementsRowsFromTab_() {
  try {
    var marker = 'reqseed_done';
    var cache = CacheService.getScriptCache();
    // Seeded lazily on first read, never by a deploy step that can be forgotten.
    if (!cache.get(marker)) {
      requirementsSeed_();
      try { cache.put(marker, '1', 21600); } catch (eP) {}
    }
    var sheet = requirementsSheet_();
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return [];
    var hdr = values[0].map(function (h) { return String(h).trim(); });
    var out = [];
    for (var r = 1; r < values.length; r++) {
      var row = {};
      for (var c = 0; c < hdr.length; c++) row[hdr[c]] = str_(values[r][c]);
      if (requirementRowValid_(row)) out.push(row);
      else hubSysLog_('requirements', 'invalidRow', String(r + 1), { status: 200 });
    }
    return out;
  } catch (e) {
    return null;
  }
}

function requirementsAll_() {
  var rows = cacheRead_(REQUIREMENTS_TAB, 'rows', function () {
    var fromTab = requirementsRowsFromTab_();
    return fromTab === null ? { source: 'fallback', rows: null } : { source: 'tab', rows: fromTab };
  });
  if (rows.source === 'tab' && rows.rows && rows.rows.length) {
    return { source: 'tab', rows: rows.rows };
  }
  return { source: 'fallback', rows: REQUIREMENTS_CATALOG.slice() };
}

function requirementsForSmart_() {
  var all = requirementsAll_();
  var out = [];
  for (var i = 0; i < all.rows.length; i++) {
    var r = all.rows[i];
    if (str_(r.enabled).toLowerCase() !== 'yes') continue;
    if (!str_(r.consequence)) continue;
    out.push({
      req_id: str_(r.req_id),
      label: str_(r.label),
      credential: str_(r.credential),
      warn_days: str_(r.warn_days),
      consequence: str_(r.consequence),
      sms_text: str_(r.sms_text),
      notes: str_(r.notes),
      max_attempts: str_(r.max_attempts) || '1',
      frequency: str_(r.frequency) || 'once'
    });
  }
  return out.length ? out : null;
}

/** The requirements catalog, with the source it was read from. */
HUB_POLICY.requirementsList = {
  file: 'Requirements.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'], invalidates: [], emits: []
};
HUB_ACTIONS.requirementsList = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var all = requirementsAll_();
  return { status: 200, data: { source: all.source, rows: all.rows } };
};

HUB_POLICY.requirementUpsert = {
  file: 'Requirements.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'], invalidates: [], emits: [],
  params: { row: { required: true, type: 'object' } }
};
HUB_ACTIONS.requirementUpsert = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var row = payload && payload.row;
  if (!requirementRowValid_(row)) {
    return { status: 400, message: 'row.req_id and row.label are required.' };
  }
  var reqId = str_(row.req_id).slice(0, 60);
  var sheet = requirementsSheet_();
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (eL) {
    return { status: 503, message: 'Another update is in progress — try again.' };
  }
  try {
    var values = sheet.getDataRange().getValues();
    var hdr = values[0].map(function (h) { return String(h).trim(); });
    var iId = hdr.indexOf('req_id');
    var rowNum = 0;
    for (var r = 1; r < values.length; r++) {
      if (str_(values[r][iId]) === reqId) { rowNum = r + 1; break; }
    }
    var now = new Date().toISOString();
    var line = REQUIREMENTS_HEADER.map(function (h) {
      if (h === 'updated_at') return now;
      if (h === 'updated_by') return str_(user.email);
      if (h === 'req_id') return reqId;
      return row[h] !== undefined ? str_(row[h]) : '';
    });
    if (rowNum) {
      sheet.getRange(rowNum, 1, 1, REQUIREMENTS_HEADER.length).setValues([line]);
    } else {
      sheet.appendRow(line);
    }
    cacheBump_(REQUIREMENTS_TAB);
    hubSysLog_(str_(user.email), 'requirementUpsert', reqId, { status: 200 });
    return { status: 200, data: { req_id: reqId, updated: !!rowNum } };
  } finally {
    lock.releaseLock();
  }
};

HUB_POLICY.requirementDelete = {
  file: 'Requirements.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'], invalidates: [], emits: [],
  params: { req_id: { required: true, type: 'string' } }
};
HUB_ACTIONS.requirementDelete = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var reqId = str_(payload && payload.req_id);
  if (!reqId) return { status: 400, message: 'req_id is required.' };
  var sheet = requirementsSheet_();
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (eL) {
    return { status: 503, message: 'Another update is in progress — try again.' };
  }
  try {
    var values = sheet.getDataRange().getValues();
    var hdr = values[0].map(function (h) { return String(h).trim(); });
    var iId = hdr.indexOf('req_id');
    var removed = 0;
    for (var r = values.length - 1; r >= 1; r--) {
      if (str_(values[r][iId]) === reqId) {
        sheet.deleteRow(r + 1);
        removed++;
      }
    }
    cacheBump_(REQUIREMENTS_TAB);
    hubSysLog_(str_(user.email), 'requirementDelete', reqId,
               { status: 200, detail: removed ? '' : 'not found' });
    return { status: 200, data: { req_id: reqId, removed: removed } };
  } finally {
    lock.releaseLock();
  }
};
