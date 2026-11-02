// ─── Configuration: a last-resort copy; the meddel_catalog house is the setting, and a test keeps both equal ───

var MEDDEL_CONFIG_KEY = 'medDelConfig';
var MEDDEL_DEFAULTS = {
  skillsCheckEmail: 'reedh@starkdd.org',
  skillsCheckAddress: '2950 Whipple Avenue NW, Canton, OH',
  employer: 'Asa LifeCare',
  // Empty on purpose: the id is resolved from Props.gs where it is read, never frozen in code.
  transcriptsSpreadsheetId: '',
  transcriptsTab: 'Other - Transcripts',
  windowDays: 60,
  phase2ResendDays: 3,
  phase3WindowStart: 2,
  phase3WindowEnd: 12,
  phase3EveryDays: 2,
  scrapeAfterDays: 7,
  cancelAfterDays: 60
};

var MEDDEL_TAB = 'meddel_flows';

// Positional against a live tab: append new columns at the end, never relabel; `comms*` stamps are ledger instances.
var MEDDEL_HEADER = [
  'id', 'createdAt', 'updatedAt',
  'employeeId', 'employeeName', 'nameKey', 'medLevel', 'certExpDate',
  'phone', 'email',
  'phase', 'overallStatus',
  'phase1Status', 'phase1Date', 'phase1Notes',
  'phase2Status', 'phase2LastSMS', 'phase2SmsCount', 'phase2ReceivedDate',
  'phase3Status', 'phase3LastSMS', 'phase3SmsCount',
  'phase4Status', 'phase4ScheduledDate', 'phase4ReminderSent', 'skillsDoneDate',
  'phase5Status', 'phase5ScrapeDate', 'newExpDate',
  'cancelReason', 'notes',
  'commsStartedAt', 'commsResendAt', 'commsReliasAt', 'commsSkillsAt',
  'commsScrapeAlertAt', 'skillsEmailSentAt',
  'transitions'
];

var MEDDEL_LEVELS = ['Med 1', 'Med 2', 'Med 3'];
var MEDDEL_LEVEL_COLUMNS = {
  'Med 1': 'med_1_exp_date', 'Med 2': 'med_2_exp_date', 'Med 3': 'med_3_exp_date'
};
var MEDDEL_LEVEL_HEADERS = {
  'Med 1': 'Med 1 Exp Date', 'Med 2': 'Med 2 Exp Date', 'Med 3': 'Med 3 Exp Date'
};

// Whitelist: the Master's SSN, date of birth, login and password must never enter flow state.
var MEDDEL_MASTER_FIELDS = [
  'employee', 'name', 'status', 'first_name', 'last_name',
  'phone_number', 'email', 'address', 'city', 'state', 'zip',
  'med_1_exp_date', 'med_2_exp_date', 'med_3_exp_date'
];

var MEDDEL_ACTIVE_STATUSES = { yes: 1, other: 1, active: 1 };

// ─── Pure helpers (no Google: the self-test runs these) ───

function medDelDateMs_(v) {
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

function medDelDays_(ms, nowMs) {
  return Math.floor((ms - nowMs) / 86400000);
}

// UTC on purpose: dates here are calendar days, not instants.
function medDelIsoDay_(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function medDelPhoneTail_(v) {
  return String(v == null ? '' : v).replace(/\D+/g, '').slice(-10);
}

function medDelHeaderKey_(h) {
  return String(h || '')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function medDelTranscriptReply_(rows, phoneTail, afterMs) {
  if (!phoneTail) return false;
  (rows || []).forEach(function () {});
  for (var i = 0; i < (rows || []).length; i++) {
    var r = rows[i];
    if (medDelPhoneTail_(r.participant) !== phoneTail) continue;
    if (Number(r.atMs) > afterMs) return true;
  }
  return false;
}

function medDelStarkddParams_(masterRow, medLevel, employer) {
  var r = masterRow || {};
  return {
    first_name: String(r.first_name || ''), last_name: String(r.last_name || ''),
    email: String(r.email || ''), phone: String(r.phone_number || ''),
    address: String(r.address || ''), city: String(r.city || ''),
    state: String(r.state || ''), zip: String(r.zip || ''),
    med_level: String(medLevel || ''), employer: String(employer || '')
  };
}

function medDelMaisCert_(result) {
  var certs = (result && result.certifications) || [];
  for (var i = 0; i < certs.length; i++) {
    var c = certs[i] || {};
    if (String(c.type || '').indexOf('Medication') >= 0) {
      return { certFound: true, newExpDate: String(c.expiration || '') };
    }
  }
  return { certFound: false, newExpDate: '' };
}

function medDelConfigMerge_(saved) {
  var out = {};
  for (var k in MEDDEL_DEFAULTS) out[k] = MEDDEL_DEFAULTS[k];
  if (!saved || typeof saved !== 'object') return out;
  for (var key in MEDDEL_DEFAULTS) {
    if (typeof MEDDEL_DEFAULTS[key] === 'number') {
      var n = Number(saved[key]);
      if (!isNaN(n) && n > 0) out[key] = n;
    } else {
      var s = String(saved[key] == null ? '' : saved[key]).trim();
      if (s) out[key] = s;
    }
  }
  return out;
}

// `transitions` is append-only: never edit or remove an entry.
function medDelTransitionsAppend_(transitions, entry) {
  var list = Array.isArray(transitions) ? transitions.slice() : [];
  list.push({
    at: String(entry.at || ''), by: String(entry.by || ''),
    from: String(entry.from || ''), to: String(entry.to || ''),
    note: String(entry.note || '')
  });
  return list;
}

// The one answer card and board share; `when` is '' unless a real date exists, never invented.
function medDelNextStep_(flow, nowMs, cfg) {
  cfg = cfg || MEDDEL_DEFAULTS;
  var f = flow || {};
  var status = String(f.overallStatus || 'active');
  if (status === 'complete') {
    return { label: 'Renewal complete' + (f.newExpDate ? ' — new expiration ' + f.newExpDate : ''),
             when: '', waiting: 'none' };
  }
  if (status === 'cancelled') {
    return { label: 'Cancelled' + (f.cancelReason ? ' — ' + f.cancelReason : ''),
             when: '', waiting: 'none' };
  }
  var phase = Number(f.phase) || 1;
  var day = 86400000;
  if (phase === 1) {
    return { label: 'StarkDD renewal application is submitted on the next daily sweep',
             when: '', waiting: 'sweep' };
  }
  if (phase === 2) {
    if (String(f.phase2Status) === 'awaiting_response') {
      var last = medDelDateMs_(f.commsResendAt || f.phase2LastSMS) || nowMs;
      return { label: 'Waiting for the employee to confirm the signed application ' +
                      '(re-asked every ' + cfg.phase2ResendDays + ' days)',
               when: medDelIsoDay_(last + cfg.phase2ResendDays * day), waiting: 'employee' };
    }
    return { label: 'Employee confirmed — an admin marks the final application as received',
             when: '', waiting: 'admin' };
  }
  if (phase === 3) {
    return { label: 'Online Relias course — reminders every ' + cfg.phase3EveryDays +
                    ' days between day ' + cfg.phase3WindowStart + ' and day ' +
                    cfg.phase3WindowEnd + ' after the application',
             when: '', waiting: 'employee' };
  }
  if (phase === 4) {
    if (String(f.phase4Status) === 'date_scheduled' && f.phase4ScheduledDate) {
      return { label: 'Skills check scheduled — reminder SMS to the employee the day before',
               when: String(f.phase4ScheduledDate).slice(0, 10), waiting: 'date' };
    }
    return { label: 'Scheduling e-mail sent — an admin sets the skills check date',
             when: '', waiting: 'admin' };
  }
  var anchor = medDelDateMs_(f.skillsDoneDate || f.phase4ScheduledDate) || nowMs;
  return { label: 'MAIS verification scrape ' + cfg.scrapeAfterDays +
                  ' days after the skills check; the Master is updated when the cert appears',
           when: medDelIsoDay_(anchor + cfg.scrapeAfterDays * day), waiting: 'sweep' };
}

// ─── The tab ───

function medDelSheet_() {
  var sheet = hubTabEnsure_(MEDDEL_TAB, MEDDEL_HEADER);
  var width = Math.max(1, sheet.getLastColumn());
  var hdr = sheet.getRange(1, 1, 1, width).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  if (!hdr[0]) {
    sheet.getRange(1, 1, 1, MEDDEL_HEADER.length).setValues([MEDDEL_HEADER]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  var missing = MEDDEL_HEADER.filter(function (h) { return hdr.indexOf(h) === -1; });
  if (missing.length) {
    if (sheet.getMaxColumns() < hdr.length + missing.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(),
        hdr.length + missing.length - sheet.getMaxColumns());
    }
    sheet.getRange(1, hdr.length + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function medDelReadFlows_() {
  var sheet = medDelSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var width = sheet.getLastColumn();
  var values = sheet.getRange(1, 1, last, width).getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = { _row: r + 1 };
    for (var c = 0; c < hdr.length; c++) {
      if (!hdr[c]) continue;
      var v = values[r][c];
      // cellText_, never toISOString: a time-only cell would read as the 1899-12-30 epoch.
      if (v instanceof Date) v = cellText_(v);
      row[hdr[c]] = String(v == null ? '' : v);
    }
    if (!row.id) continue;
    try { row.transitions = JSON.parse(row.transitions || '[]'); }
    catch (e) { row.transitions = []; }
    if (!Array.isArray(row.transitions)) row.transitions = [];
    out.push(row);
  }
  return out;
}

// Header-bound and row-verified, so a sweep and a manager never merge two moments of one flow.
function medDelPatchFlow_(flowId, patch, transition) {
  var sheet = medDelSheet_();
  var width = sheet.getLastColumn();
  var hdr = sheet.getRange(1, 1, 1, width).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var idCol = hdr.indexOf('id');
  var last = sheet.getLastRow();
  if (idCol === -1 || last < 2) return { error: { status: 500, message: 'The meddel_flows tab is not initialised.' } };
  var ids = sheet.getRange(2, idCol + 1, last - 1, 1).getValues();
  var rowNum = 0;
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(flowId)) { rowNum = i + 2; break; }
  }
  if (!rowNum) return { error: { status: 404, message: 'No med del flow with id "' + flowId + '".' } };

  var current = {};
  var line = sheet.getRange(rowNum, 1, 1, width).getValues()[0];
  for (var c0 = 0; c0 < hdr.length; c0++) if (hdr[c0]) current[hdr[c0]] = line[c0];

  var merged = {};
  for (var k1 in current) merged[k1] = current[k1] instanceof Date
    ? String(cellText_(current[k1]) || '')
    : String(current[k1] == null ? '' : current[k1]);
  for (var k2 in patch) {
    if (k2 === 'id' || k2 === 'createdAt') continue;
    merged[k2] = String(patch[k2] == null ? '' : patch[k2]);
  }
  merged.updatedAt = new Date().toISOString();

  if (transition) {
    var trail = [];
    try { trail = JSON.parse(merged.transitions || '[]'); } catch (eT) { trail = []; }
    merged.transitions = JSON.stringify(medDelTransitionsAppend_(trail, transition));
  }

  var out = hdr.map(function (h) { return merged[h] !== undefined ? merged[h] : ''; });
  sheet.getRange(rowNum, 1, 1, width).setValues([out]);
  try { if (typeof cacheBump_ === 'function') cacheBump_(MEDDEL_TAB); } catch (eB) { /* slow read at worst */ }
  var echo = {};
  for (var k3 in merged) echo[k3] = merged[k3];
  try { echo.transitions = JSON.parse(echo.transitions || '[]'); } catch (eE) { echo.transitions = []; }
  return echo;
}

function medDelCreateFlow_(fields, by) {
  var flows = medDelReadFlows_();
  var dup = flows.filter(function (f) {
    return f.nameKey === fields.nameKey && f.medLevel === fields.medLevel &&
           f.overallStatus === 'active';
  });
  if (dup.length) {
    return { error: { status: 409, message: 'An active flow already exists for ' +
                      fields.employeeName + ' ' + fields.medLevel + '.', flowId: String(dup[0].id) } };
  }
  var now = new Date().toISOString();
  var id = 'md_' + Utilities.getUuid().slice(0, 12);
  var record = {
    phase: '1', overallStatus: 'active',
    phase1Status: 'pending', phase2Status: '', phase3Status: '',
    phase4Status: '', phase5Status: '',
    phase2SmsCount: '0', phase3SmsCount: '0',
    createdAt: now
  };
  for (var k in fields) record[k] = String(fields[k] == null ? '' : fields[k]);
  record.id = id;
  record.transitions = JSON.stringify(medDelTransitionsAppend_([], {
    at: now, by: by, from: '', to: 'phase 1',
    note: 'Flow created — ' + record.medLevel + ' expires ' + record.certExpDate
  }));

  var sheet = medDelSheet_();
  var width = sheet.getLastColumn();
  var hdr = sheet.getRange(1, 1, 1, width).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  sheet.appendRow(hdr.map(function (h) { return record[h] !== undefined ? record[h] : ''; }));
  try { if (typeof cacheBump_ === 'function') cacheBump_(MEDDEL_TAB); } catch (eB) {}
  var out = {};
  for (var k2 in record) out[k2] = record[k2];
  out.transitions = JSON.parse(record.transitions);
  return out;
}

// ─── Config, sources, identity ───

// A named push can land this file without MedDelCatalog.gs; the lane then degrades to the shipped copy.
function medDelCat_() {
  if (typeof medDelCatalog_ === 'function') return medDelCatalog_();
  if (!MEDDEL_CAT_MODULE_SAID) {
    MEDDEL_CAT_MODULE_SAID = true;
    try {
      if (typeof hubSysLog_ === 'function') {
        hubSysLog_('asa-hub:meddel', 'meddel_catalog_module_missing',
                   'MedDelCatalog.gs is not in this Apps Script project',
                   { status: 500,
                     message: 'the lane is running on the shipped levels, statuses and timings ' +
                              '— nothing was skipped and nobody was cancelled — and no edit in ' +
                              'the settings sheet reaches it until that file is pushed' });
      }
    } catch (e) { /* an unpushed file must not take the lane down either */ }
  }
  return medDelCatShipped_();
}
var MEDDEL_CAT_MODULE_SAID = false;

function medDelCatShipped_() {
  var cat = {
    ok: false, source: 'code',
    why: 'MedDelCatalog.gs, which reads the med del settings sheet, is not in this project',
    groups: { settings: 'code', levels: 'code', statuses: 'code' }, refused: [],
    settings: medDelConfigMerge_(null),
    levels: MEDDEL_LEVELS.slice(), levelColumns: {}, levelHeaders: {},
    activeStatuses: {}, masterFields: MEDDEL_MASTER_FIELDS.slice()
  };
  var k;
  for (k in MEDDEL_LEVEL_COLUMNS) cat.levelColumns[k] = MEDDEL_LEVEL_COLUMNS[k];
  for (k in MEDDEL_LEVEL_HEADERS) cat.levelHeaders[k] = MEDDEL_LEVEL_HEADERS[k];
  for (k in MEDDEL_ACTIVE_STATUSES) cat.activeStatuses[k] = MEDDEL_ACTIVE_STATUSES[k];
  return cat;
}

function medDelCatState_(cat) {
  if (typeof medDelCatalogState_ === 'function') return medDelCatalogState_(cat);
  var c = cat || medDelCatShipped_();
  return { ok: !!c.ok, why: String(c.why || ''), source: String(c.source || 'code'),
           groups: c.groups, refused: (c.refused || []).slice(0, 10),
           levels: (c.levels || []).slice() };
}

function medDelConfig_() {
  return medDelCat_().settings;
}

function medDelMasterRows_() {
  var rows = [];
  var fields = medDelCat_().masterFields;
  try {
    if (typeof certReadTab_ !== 'function') return [];
    var tab = (typeof certSourceTab_ === 'function') ? certSourceTab_('master') : 'Master';
    certReadTab_(tab).forEach(function (r) {
      var p = {};
      fields.forEach(function (f) { if (r[f] !== undefined) p[f] = r[f]; });
      p._displayName = String(p.employee || p.name || '').trim();
      rows.push(p);
    });
  } catch (e) { rows = []; }
  return rows;
}

// Identity by name key, never by loose substring.
function medDelPeopleByKey_() {
  var byKey = {};
  try {
    var people = listRows_('people', {});
    if (typeof peopleMerged_ === 'function') people = peopleMerged_(people);
    if (typeof withoutIspClients_ === 'function') people = withoutIspClients_(people);
    people.forEach(function (p) {
      var k = (typeof clientNameKey_ === 'function') ? clientNameKey_(p.name) : '';
      if (k && !byKey[k]) byKey[k] = p;
    });
  } catch (e) { /* an unresolved person is noted, never guessed */ }
  return byKey;
}

function medDelTranscriptRows_(cfg) {
  var produce = function () {
    var ss = ssOpen_(cfg.transcriptsSpreadsheetId || hubId_('EMP360_MASTER_DATA_ID'));
    var sheet = ss.getSheetByName(cfg.transcriptsTab);
    if (!sheet) return [];
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return [];
    var keys = values[0].map(medDelHeaderKey_);
    var out = [];
    for (var i = 1; i < values.length; i++) {
      var row = {};
      for (var c = 0; c < keys.length; c++) if (keys[c]) row[keys[c]] = values[i][c];
      var at = medDelDateMs_(row.received_at) || medDelDateMs_(row.transcript_created);
      out.push({ participant: String(row.participant == null ? '' : row.participant),
                 atMs: at === null ? 0 : at });
    }
    return out;
  };
  try {
    if (typeof cacheRead_ === 'function') return cacheRead_('meddel', 'transcripts', produce);
    return produce();
  } catch (e) { return []; }
}

// ─── Browser automation (the TrueLink.gs call shape) ───

// A missing Script Property is a refusal that names it, never a silent skip.
function medDelRunTask_(task, params) {
  var url = '', secret = '';
  try {
    url = String(hubProp_('BROWSER_AUTOMATION_URL') || '');
    secret = String(hubProp_('BROWSER_AUTOMATION_BOT_SECRET') || '');
  } catch (eP) { /* answered below */ }
  if (!url) return { ok: false, error: 'BROWSER_AUTOMATION_URL is not set in Script Properties' };
  if (!secret) return { ok: false, error: 'BROWSER_AUTOMATION_BOT_SECRET is not set in Script Properties' };

  var res, code = 0, text = '';
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + secret },
      payload: JSON.stringify({ task: task, params: params || {} }),
      muteHttpExceptions: true
    });
    code = res.getResponseCode();
    text = res.getContentText();
  } catch (e) {
    return { ok: false, error: 'the automation service could not be reached: ' + (e && e.message || e) };
  }
  var body = null;
  try { body = JSON.parse(text); } catch (eB) { body = null; }
  if (code !== 200 || !body) {
    return { ok: false, error: 'the service answered ' + code + ': ' + text.slice(0, 200) };
  }
  if (body.ok === false) {
    return { ok: false, error: String(body.error || body.err || 'task failed').slice(0, 300) };
  }
  return { ok: true, result: body.result || {} };
}

// ─── The Phase-5 write-back (header-bound, row-verified) ───

// One cell only; the write-back floor in MedDelCatalog.gs keeps every protected Master column unwritable.
function medDelMasterWriteExp_(employeeName, medLevel, newExpDate) {
  var header = medDelCat_().levelHeaders[medLevel];
  if (!header || !newExpDate) return { ok: false, error: 'unknown med level or empty date' };
  var srcId = hubId_('CERT_SOURCE_ID');
  var tab = (typeof certSourceTab_ === 'function') ? certSourceTab_('master') : 'Master';
  try {
    var sheet = ssOpen_(srcId).getSheetByName(tab);
    if (!sheet) return { ok: false, error: 'the employee Master tab could not be opened' };
    var last = sheet.getLastRow();
    if (last < 2) return { ok: false, error: 'the employee Master tab is empty' };

    // The estate may insert rows between lookup and write, so the row is witness-checked below.
    var names = sheet.getRange(1, 1, last, 1).getValues();
    var target = String(employeeName).trim().toLowerCase();
    var rowNum = 0;
    for (var r = 1; r < names.length; r++) {
      if (String(names[r][0]).trim().toLowerCase() === target) { rowNum = r + 1; break; }
    }
    if (!rowNum) return { ok: false, error: 'no row named "' + employeeName + '" in the Master' };

    var width = sheet.getLastColumn();
    var hdr = sheet.getRange(1, 1, 1, width).getValues()[0];
    var col = -1;
    for (var c = 0; c < hdr.length; c++) {
      if (String(hdr[c]).trim() === header) { col = c; break; }
    }
    if (col === -1) return { ok: false, error: 'the Master has no "' + header + '" column' };

    var witness = String(sheet.getRange(rowNum, 1).getValue() || '').trim().toLowerCase();
    if (witness !== target) {
      return { ok: false, error: 'the Master row moved since it was read — nothing was written' };
    }
    sheet.getRange(rowNum, col + 1).setValue(newExpDate);
    try {
      if (typeof cacheBump_ === 'function') cacheBump_(cacheScopeSheet_(srcId, tab));
    } catch (eB) {}
    return { ok: true, row: rowNum, column: header };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ─── The five-phase engine ───

// Idempotent: messages are keyed by queue stamp and every external call is guarded by the phase it leaves.
function medDelSweep_(opts) {
  opts = opts || {};
  var by = opts.by || 'asa-hub:meddel-sweep';
  // One catalogue per pass, so a cache expiry mid-sweep cannot judge flows against two sets of levels.
  var cat = medDelCat_();
  var cfg = cat.settings;
  var now = Date.now();
  var out = { created: 0, processed: 0, cancelled: 0, commsStamped: 0,
              scrapeChecked: 0, masterUpdated: 0, errors: [],
              catalogue: medDelCatState_(cat) };

  var master = medDelMasterRows_();
  var peopleByKey = medDelPeopleByKey_();
  var transcripts = medDelTranscriptRows_(cfg);

  var flows = medDelReadFlows_();
  var activeKeys = {};
  flows.forEach(function (f) {
    if (f.overallStatus === 'active') activeKeys[f.nameKey + '|' + f.medLevel] = true;
  });

  master.forEach(function (emp) {
    var status = String(emp.status || '').trim().toLowerCase();
    if (!cat.activeStatuses[status]) return;
    var nameKey = (typeof clientNameKey_ === 'function') ? clientNameKey_(emp._displayName) : '';
    if (!nameKey) return;
    cat.levels.forEach(function (level) {
      var ms = medDelDateMs_(emp[cat.levelColumns[level]]);
      if (ms === null) return;
      var days = medDelDays_(ms, now);
      if (days > cfg.windowDays || days < -cfg.windowDays) return;
      if (activeKeys[nameKey + '|' + level]) return;
      var person = peopleByKey[nameKey] || null;
      var made = medDelCreateFlow_({
        employeeId: person ? String(person.id || '') : '',
        employeeName: emp._displayName, nameKey: nameKey, medLevel: level,
        certExpDate: medDelIsoDay_(ms),
        phone: String(person && person.phone || emp.phone_number || ''),
        email: String(person && person.email || emp.email || '')
      }, by);
      if (made.error) { out.errors.push(made.error.message); return; }
      activeKeys[nameKey + '|' + level] = true;
      out.created++;
    });
  });

  flows = medDelReadFlows_();
  var masterByName = {};
  master.forEach(function (emp) { masterByName[String(emp._displayName).toLowerCase()] = emp; });
  var people = medDelPeopleByKey_();

  flows.forEach(function (flow) {
    if (flow.overallStatus !== 'active') return;
    var empRaw = masterByName[String(flow.employeeName).toLowerCase()] || null;
    var person = people[flow.nameKey] || null;

    var phone = String(person && person.phone || (empRaw && empRaw.phone_number) || flow.phone || '');
    var email = String(person && person.email || (empRaw && empRaw.email) || flow.email || '');
    var firstName = String(flow.employeeName).split(/[\s,]+/)[0];
    var phoneTail = medDelPhoneTail_(phone);
    var expMs = medDelDateMs_(flow.certExpDate);
    var daysToExp = expMs === null ? 0 : medDelDays_(expMs, now);

    var empStatus = String((empRaw && empRaw.status) || (person && person.status) || '').trim().toLowerCase();
    if (empStatus && !cat.activeStatuses[empStatus]) {
      medDelPatchFlow_(flow.id, { overallStatus: 'cancelled', cancelReason: 'employee inactive' }, {
        at: new Date().toISOString(), by: by,
        from: 'phase ' + flow.phase, to: 'cancelled',
        note: 'Auto-cancelled: the employee is no longer active'
      });
      out.cancelled++;
      return;
    }

    var phase = Number(flow.phase) || 1;

    // Phase 1: submit the renewal application.
    if (phase === 1 && flow.phase1Status === 'pending') {
      var t1 = medDelRunTask_('starkdd',
        medDelStarkddParams_(empRaw || {}, flow.medLevel, cfg.employer));
      var stamp1 = new Date().toISOString();
      medDelPatchFlow_(flow.id, {
        phase1Status: t1.ok ? 'done' : 'error',
        phase1Date: stamp1.slice(0, 10),
        phase1Notes: t1.ok ? 'Auto-submitted' : 'Error: ' + t1.error,
        phone: phone, email: email,
        // Moves on even when submission failed: a failed browser run is fixed forward by hand.
        phase: '2', phase2Status: 'awaiting_response',
        phase2LastSMS: stamp1, phase2SmsCount: '1',
        commsStartedAt: stamp1
      }, {
        at: stamp1, by: by, from: 'phase 1', to: 'phase 2',
        note: t1.ok ? 'StarkDD renewal application submitted; employee asked to sign and confirm'
                    : 'StarkDD submission failed (' + t1.error + '); employee asked to confirm anyway'
      });
      out.processed++;
      out.commsStamped++;
      return;
    }

    // Phase 2: the employee confirms.
    if (phase === 2 && flow.phase2Status === 'awaiting_response') {
      if (daysToExp < -cfg.cancelAfterDays) {
        medDelPatchFlow_(flow.id, { overallStatus: 'cancelled', cancelReason: '60d past expiration' }, {
          at: new Date().toISOString(), by: by, from: 'phase 2', to: 'cancelled',
          note: 'Auto-cancelled: ' + cfg.cancelAfterDays + ' days past expiration with no confirmation'
        });
        out.cancelled++;
        out.processed++;
        return;
      }
      var lastAsk = medDelDateMs_(flow.commsResendAt || flow.phase2LastSMS) || 0;
      if (phoneTail && medDelTranscriptReply_(transcripts, phoneTail, lastAsk)) {
        medDelPatchFlow_(flow.id, { phase2Status: 'employee_confirmed' }, {
          at: new Date().toISOString(), by: by, from: 'phase 2', to: 'phase 2',
          note: 'The employee confirmed by message — waiting on the final application'
        });
      } else if (medDelDays_(now, lastAsk) >= cfg.phase2ResendDays) {
        var stamp2 = new Date().toISOString();
        medDelPatchFlow_(flow.id, {
          commsResendAt: stamp2, phase2LastSMS: stamp2,
          phase2SmsCount: String((parseInt(flow.phase2SmsCount, 10) || 0) + 1)
        }, {
          at: stamp2, by: by, from: 'phase 2', to: 'phase 2',
          note: 'Re-asked the employee to confirm (' + ((parseInt(flow.phase2SmsCount, 10) || 0) + 1) + '. ask)'
        });
        out.commsStamped++;
      }
      out.processed++;
      return;
    }

    // Phase 2 → 3 is a human step (medDelAdvance 'application_received').

    // Phase 3: the online course.
    if (phase === 3) {
      var anchor3 = medDelDateMs_(flow.phase2ReceivedDate) || 0;
      var since3 = anchor3 ? medDelDays_(now, anchor3) : 0;
      var p3 = String(flow.phase3Status);
      if (since3 >= cfg.phase3WindowStart && since3 <= cfg.phase3WindowEnd) {
        var last3 = medDelDateMs_(flow.commsReliasAt || flow.phase3LastSMS) || 0;
        if (medDelDays_(now, last3) >= cfg.phase3EveryDays) {
          var stamp3 = new Date().toISOString();
          medDelPatchFlow_(flow.id, {
            commsReliasAt: stamp3, phase3LastSMS: stamp3,
            phase3SmsCount: String((parseInt(flow.phase3SmsCount, 10) || 0) + 1)
          }, {
            at: stamp3, by: by, from: 'phase 3', to: 'phase 3',
            note: 'Relias course reminder sent (day ' + since3 + ' of the window)'
          });
          out.commsStamped++;
        }
        if (p3 === 'registration_pending' && phoneTail &&
            medDelTranscriptReply_(transcripts, phoneTail,
              medDelDateMs_(flow.phase3LastSMS) || anchor3)) {
          medDelPatchFlow_(flow.id, { phase3Status: 'registration_confirmed' }, {
            at: new Date().toISOString(), by: by, from: 'phase 3', to: 'phase 3',
            note: 'The employee confirmed starting the online course'
          });
        }
      }
      out.processed++;
      return;
    }

    // Phase 4: the in-person skills check.
    if (phase === 4) {
      var p4 = String(flow.phase4Status);
      if (p4 === 'pending') {
        // A Smart Comms situation (med_del_skills_check): off, the flow waits here and nothing leaves.
        var skillsSit = hubLaneSituation_('med_del_skills_check');
        if (!skillsSit.on || !skillsSit.leg('email')) { out.processed++; return; }
        var stamp4 = new Date().toISOString();
        var mailTo = cfg.skillsCheckEmail;
        var skillsVars = { employee: flow.employeeName, level: flow.medLevel,
                           address: cfg.skillsCheckAddress, employer: cfg.employer };
        var subject = skillsSit.word('email_subject',
          'Med Del Skills Check — ' + flow.employeeName + ' (' + flow.medLevel + ')', skillsVars);
        var body = skillsSit.word('email_text', 'Hi,\n\nWe need to schedule an in-person Med Del skills check for ' +
                   flow.employeeName + ' (' + flow.medLevel + ').\n\n' +
                   'Location: ' + cfg.skillsCheckAddress + '\n\n' +
                   'Please reply with available dates.\n\nThank you,\n' + cfg.employer, skillsVars);
        var sent = null;
        if (typeof rpcCall_ === 'function' && mailTo) {
          sent = rpcCall_('emailSend', {
            to: mailTo, subject: subject, body: body,
            reason: 'smart comms: med_del_skills_check'
          }, { idempotency_key: 'meddel_skills_' + flow.id });
        }
        var mailed = !!(sent && sent.ok && sent.sent);
        // Held by the quiet window: stay pending so the next sweep sends it.
        if (sent && sent.quiet) { out.processed++; return; }
        medDelPatchFlow_(flow.id, {
          phase4Status: 'email_sent',
          skillsEmailSentAt: mailed ? stamp4 : '',
          notes: (flow.notes || '') + (mailed ? '' : ' | Skills e-mail NOT sent: ' +
                 (sent ? String(sent.error || sent.detail || 'gated') : 'transport unavailable'))
        }, {
          at: stamp4, by: by, from: 'phase 4', to: 'phase 4',
          note: mailed ? 'Scheduling e-mail sent to ' + mailTo
                       : 'Scheduling e-mail could not be sent — see notes'
        });
      } else if (p4 === 'date_scheduled') {
        var schedMs = medDelDateMs_(flow.phase4ScheduledDate);
        if (schedMs !== null) {
          var until = medDelDays_(schedMs, now);
          if ((until === 1 || until === 0) && flow.phase4ReminderSent !== 'yes') {
            var stampR = new Date().toISOString();
            medDelPatchFlow_(flow.id, { commsSkillsAt: stampR, phase4ReminderSent: 'yes' }, {
              at: stampR, by: by, from: 'phase 4', to: 'phase 4',
              note: 'Skills check reminder queued for the employee (' +
                    (until === 0 ? 'today' : 'tomorrow') + ')'
            });
            out.commsStamped++;
          }
          if (until < 0) {
            medDelPatchFlow_(flow.id, {
              phase4Status: 'done', phase: '5', phase5Status: 'pending'
            }, {
              at: new Date().toISOString(), by: by, from: 'phase 4', to: 'phase 5',
              note: 'The scheduled date passed — MAIS verification in ' + cfg.scrapeAfterDays + ' days'
            });
          }
        }
      }
      out.processed++;
      return;
    }

    // Phase 5: MAIS verification and the Master write-back.
    if (phase === 5 && flow.phase5Status !== 'cert_found' && flow.phase5Status !== 'cert_not_found') {
      var anchor5 = medDelDateMs_(flow.skillsDoneDate || flow.phase4ScheduledDate) || 0;
      if (anchor5 && medDelDays_(now, anchor5) >= cfg.scrapeAfterDays) {
        var t5 = medDelRunTask_('dodd', {
          first_name: String((empRaw && empRaw.first_name) || firstName),
          last_name: String((empRaw && empRaw.last_name) ||
                            String(flow.employeeName).split(/\s+/).slice(1).join(' '))
          // date_of_birth and last_4_ssn are never sent.
        });
        var stamp5 = new Date().toISOString();
        if (!t5.ok) {
          // A scrape error is not "no cert"; it is retried on the next pass.
          medDelPatchFlow_(flow.id, { phase5Status: 'scrape_error', phase5ScrapeDate: stamp5.slice(0, 10) }, {
            at: stamp5, by: by, from: 'phase 5', to: 'phase 5',
            note: 'MAIS scrape failed (' + t5.error + ') — retried on the next sweep'
          });
        } else {
          var cert = medDelMaisCert_(t5.result);
          out.scrapeChecked++;
          if (cert.certFound) {
            var write = cert.newExpDate
              ? medDelMasterWriteExp_(flow.employeeName, flow.medLevel, cert.newExpDate)
              : { ok: false, error: 'no expiration in the scrape' };
            if (write.ok) out.masterUpdated++;
            // A failed Master write holds the flow open and retryable: every other lane reads the Master.
            var held = !!cert.newExpDate && !write.ok;
            medDelPatchFlow_(flow.id, {
              phase5Status: held ? 'master_write_failed' : 'cert_found',
              phase5ScrapeDate: stamp5.slice(0, 10),
              newExpDate: cert.newExpDate,
              overallStatus: held ? 'active' : 'complete'
            }, {
              at: stamp5, by: by, from: 'phase 5', to: held ? 'phase 5' : 'complete',
              note: 'Certification found in MAIS' +
                    (cert.newExpDate ? ' — new expiration ' + cert.newExpDate : '') +
                    (write.ok ? '; the Master was updated'
                              : '; Master write FAILED: ' + write.error +
                                (held ? ' — the flow stays open and is retried on the next sweep'
                                      : ''))
            });
          } else {
            medDelPatchFlow_(flow.id, {
              phase5Status: 'cert_not_found', phase5ScrapeDate: stamp5.slice(0, 10),
              commsScrapeAlertAt: stamp5
            }, {
              at: stamp5, by: by, from: 'phase 5', to: 'phase 5',
              note: 'No certification in MAIS ' + cfg.scrapeAfterDays +
                    ' days after the skills check — the team was alerted'
            });
            out.commsStamped++;
          }
        }
      }
      out.processed++;
    }
  });

  if (out.commsStamped > 0 && typeof smartEventSweep_ === 'function') {
    try { smartEventSweep_({}); }
    catch (eS) {
      if (typeof hubSysLog_ === 'function') {
        hubSysLog_('asa-hub:meddel', 'meddel_comms_sweep_failed',
                   String((eS && eS.message) || eS), { status: 500 });
      }
    }
  }
  return out;
}

// Service requests only, at most every 6h and never while a writer holds the lock: executions are scarce.
function medDelSweepMaybe_() {
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('meddel_sweep_ran')) return;
  cache.put('meddel_sweep_ran', '1', 21600);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return;
  try {
    var out = medDelSweep_({ by: 'asa-hub:meddel-auto' });
    if (typeof hubSysLog_ === 'function') {
      hubSysLog_('asa-hub:meddel', 'meddel_auto_sweep',
        'created ' + out.created + ', processed ' + out.processed +
        ', cancelled ' + out.cancelled + ', errors ' + out.errors.length +
        // Logged on every pass, so a lane silently running on shipped values gets noticed.
        ', catalogue ' + (out.catalogue.ok ? out.catalogue.source : 'UNREAD (' + out.catalogue.why + ')'),
        { status: 200 });
    }
  } catch (e) {
    if (typeof hubSysLog_ === 'function') {
      hubSysLog_('asa-hub:meddel', 'meddel_auto_sweep_error',
                 String((e && e.message) || e), { status: 500 });
    }
  } finally {
    lock.releaseLock();
  }
}

// ─── Smart Comms subjects (swept by smartEventSweep_ via integration) ───

function medDelSmartSubjects_() {
  var cfg = medDelConfig_();
  var now = Date.now();
  return medDelReadFlows_().filter(function (f) {
    return f.overallStatus === 'active';
  }).map(function (f) {
    var expMs = medDelDateMs_(f.certExpDate);
    return {
      id: String(f.id),
      name: String(f.employeeName),
      phone: String(f.phone || ''),
      email: String(f.email || ''),
      medLevel: String(f.medLevel || ''),
      certExpDate: String(f.certExpDate || ''),
      daysLeft: expMs === null ? '' : String(medDelDays_(expMs, now)),
      scheduledDate: String(f.phase4ScheduledDate || ''),
      address: cfg.skillsCheckAddress,
      commsStartedAt: String(f.commsStartedAt || ''),
      commsResendAt: String(f.commsResendAt || ''),
      commsReliasAt: String(f.commsReliasAt || ''),
      commsSkillsAt: String(f.commsSkillsAt || '')
    };
  });
}

function medDelAlertSubjects_() {
  return medDelReadFlows_().filter(function (f) {
    return String(f.commsScrapeAlertAt || '') !== '';
  }).map(function (f) {
    return {
      id: String(f.id),
      name: String(f.employeeName),
      medLevel: String(f.medLevel || ''),
      skillsDate: String(f.skillsDoneDate || f.phase4ScheduledDate || ''),
      commsScrapeAlertAt: String(f.commsScrapeAlertAt || '')
    };
  });
}

// Every seed ships OFF: an enabled seed messages real people the moment it is swept.
var MEDDEL_SMART_SEEDS = [
  {
    id: 'meddel_renewal_started', kind: 'event', event: 'meddel_renewal_started',
    enabled: 'no', to: 'team', channels: 'sms, email', days_before: '0',
    statuses: '', credential: '', direction: '', exclude_column: '', exclude_values: '',
    cc: '', sender: '',
    label: 'Med Del renewal started — application submitted to StarkDD',
    sms_text: 'Hi {first_name}, your Med Cert {med_level} expires in {days_left} days. ' +
              'We just completed the application for you to renew your Med Administration ' +
              'Certification(s). Please check your email to sign the application. ' +
              'Once done please send me a message confirming.',
    email_subject: 'Your Med Del renewal ({med_level}) — application submitted',
    email_text: 'Hi {first_name},\n\nYour {med_level} certification expires in {days_left} days. ' +
                'We have submitted the renewal application to StarkDD for you.\n\n' +
                'Please check your e-mail, sign the application, and reply to this message ' +
                'to confirm — that confirmation is what moves your renewal forward.\n\n{sender}',
    note: 'MedDel.gs phase 1→2. Addressed to the employee (to_subject); also the phase-2 ' +
          're-ask every 3 days (the re-stamp is a new ledger instance). Seeded OFF.'
  },
  {
    id: 'meddel_relias_reminder', kind: 'event', event: 'meddel_relias_reminder',
    enabled: 'no', to: 'team', channels: 'sms, email', days_before: '0',
    statuses: '', credential: '', direction: '', exclude_column: '', exclude_values: '',
    cc: '', sender: '',
    label: 'Med Del renewal — Relias online course reminder',
    sms_text: 'Hi {first_name}, have you received the email from Relias about starting your ' +
              'online med del renewal training? I wanted to make sure you have tried to access ' +
              'the course because you\'ll lose access if you don\'t login within 14 days. ' +
              'Please let me know when you\'ve started the course.',
    email_subject: 'Your Med Del online course — have you started it?',
    email_text: 'Hi {first_name},\n\nRelias should have sent you access to the online part of ' +
                'your Med Del renewal. Please log in and start the course — access expires ' +
                '14 days after the invitation.\n\nReply to let us know once you have started.\n\n{sender}',
    note: 'MedDel.gs phase 3. Days 2–12 after the application, at most one every 2 days ' +
          '(each stamp is a new instance). Addressed to the employee (to_subject). Seeded OFF.'
  },
  {
    id: 'meddel_skills_reminder', kind: 'event', event: 'meddel_skills_reminder',
    enabled: 'no', to: 'team', channels: 'sms', days_before: '0',
    statuses: '', credential: '', direction: '', exclude_column: '', exclude_values: '',
    cc: '', sender: '',
    label: 'Med Del skills check — day-before reminder with the address',
    sms_text: 'Hi {first_name}, this is a reminder that your Med Del skills check is ' +
              'scheduled for {scheduled_date} at {address}. Please confirm your attendance.',
    email_subject: 'Your Med Del skills check — {scheduled_date}',
    email_text: 'Hi {first_name},\n\nYour in-person Med Del skills check is scheduled for ' +
                '{scheduled_date} at:\n\n{address}\n\nPlease confirm your attendance.\n\n{sender}',
    note: 'MedDel.gs phase 4. Sent once, the day before or the day of the scheduled check. ' +
          'SMS-only by default — it is a day-of logistics message. Addressed to the employee ' +
          '(to_subject). Seeded OFF.'
  },
  {
    id: 'meddel_scrape_alert', kind: 'event', event: 'meddel_scrape_alert',
    enabled: 'no', to: 'team', channels: 'sms, email', days_before: '0',
    statuses: '', credential: '', direction: '', exclude_column: '', exclude_values: '',
    cc: '', sender: '',
    label: 'Med Del renewal — cert NOT found in MAIS after the skills check',
    sms_text: 'MAIS cert not found for {name} ({med_level}) after the skills check on ' +
              '{skills_date}. Manual verification needed.',
    email_subject: 'MAIS cert not found — {name} ({med_level})',
    email_text: 'The MAIS/DODD scrape did not find a Medication certification for {name} ' +
                '({med_level}) 7 days after the skills check on {skills_date}.\n\n' +
                'Please verify the renewal manually and update the employee Master.',
    note: 'MedDel.gs phase 5. To the team (escalation audience), once per flow. Seeded OFF.'
  }
];

// ─── Actions ───

HUB_POLICY.medDelFlows = {
  file: 'MedDel.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { phase: { type: 'string' }, status: { type: 'string' } }
};
HUB_ACTIONS.medDelFlows = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};
  var cat = medDelCat_();
  var cfg = cat.settings;
  var now = Date.now();
  var phase = str_(payload.phase), status = str_(payload.status);
  var all = medDelReadFlows_();
  var flows = all.filter(function (f) {
    if (phase && String(f.phase) !== phase) return false;
    if (status && String(f.overallStatus) !== status) return false;
    return true;
  });
  var counts = { active: 0, complete: 0, cancelled: 0, byPhase: {} };
  all.forEach(function (f) {
    counts[f.overallStatus] = (counts[f.overallStatus] || 0) + 1;
    if (f.overallStatus === 'active') {
      var p = String(f.phase);
      counts.byPhase[p] = (counts.byPhase[p] || 0) + 1;
    }
  });
  flows.sort(function (a, b) {
    if ((a.overallStatus === 'active') !== (b.overallStatus === 'active')) {
      return a.overallStatus === 'active' ? -1 : 1;
    }
    var ma = medDelDateMs_(a.certExpDate) || 0, mb = medDelDateMs_(b.certExpDate) || 0;
    return ma - mb;
  });
  var data = flows.map(function (f) {
    var out = {};
    for (var k in f) { if (k !== '_row') out[k] = f[k]; }
    out.nextStep = medDelNextStep_(f, now, cfg);
    return out;
  });
  return { status: 200, data: { flows: data, counts: counts,
                                catalogue: medDelCatState_(cat) } };
};

/** Seed the queue from the Master, for when nothing has appeared in the queue yet. */
HUB_POLICY.medDelSeed = {
  file: 'MedDel.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: ['medDelFlowsRaw'], emits: []
};
// Cert dates come from the Master, never typed; a person missing from `people` still seeds from it.
HUB_ACTIONS.medDelSeed = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cat = medDelCat_();
  var cfg = cat.settings;
  var now = Date.now();
  var peopleByKey = {};
  try {
    listRows_('people', {}).forEach(function (p) {
      var k = (typeof clientNameKey_ === 'function') ? clientNameKey_(p.name) : '';
      if (k && !peopleByKey[k]) peopleByKey[k] = p;
    });
  } catch (e) { /* the Master still names them; people only adds contacts */ }
  var out = { started: 0, already_active: 0, outside_window: 0, no_dates: 0, people: [] };
  medDelMasterRows_().forEach(function (emp) {
    var k = (typeof clientNameKey_ === 'function') ? clientNameKey_(emp._displayName) : '';
    if (!k) return;
    var person = peopleByKey[k] || null;
    cat.levels.forEach(function (level) {
      var ms = medDelDateMs_(emp[cat.levelColumns[level]]);
      if (ms === null) { out.no_dates++; return; }
      var days = medDelDays_(ms, now);
      if (days > cfg.windowDays || days < -cfg.windowDays) { out.outside_window++; return; }
      var made = medDelCreateFlow_({
        employeeId: person ? String(person.id) : '',
        employeeName: String((person && person.name) || emp._displayName),
        nameKey: k, medLevel: level,
        certExpDate: medDelIsoDay_(ms),
        phone: String((person && person.phone) || emp.phone_number || ''),
        email: String((person && person.email) || emp.email || '')
      }, 'asa-hub:seed:' + str_(user.email));
      if (made.error) { out.already_active++; return; }
      out.started++;
      if (out.people.length < 40) {
        out.people.push(String((person && person.name) || emp._displayName) + ' (' + level + ')');
      }
    });
  });
  out.catalogue = medDelCatState_(cat);
  hubSysLog_(str_(user.email), 'medDelSeed',
             out.started + ' flow(s) started, ' + out.already_active + ' already active, ' +
             'catalogue ' + (out.catalogue.ok ? out.catalogue.source : 'UNREAD'),
             { status: 200 });
  return { status: 200, data: out };
};

HUB_POLICY.medDelStart = {
  file: 'MedDel.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['medDelFlowsRaw'], emits: [],
  params: { employeeId: { type: 'string', required: true }, medLevel: { type: 'string' } }
};
HUB_ACTIONS.medDelStart = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};
  var employeeId = str_(payload.employeeId);
  var person = null;
  try {
    listRows_('people', {}).forEach(function (p) {
      if (String(p.id) === employeeId && !person) person = p;
    });
  } catch (e) { person = null; }
  if (!person) return { status: 404, message: 'No person with id "' + employeeId + '".' };

  var nameKey = (typeof clientNameKey_ === 'function') ? clientNameKey_(person.name) : '';
  if (!nameKey) return { status: 422, message: 'That person has no usable name key.' };

  var master = null;
  medDelMasterRows_().forEach(function (emp) {
    var k = (typeof clientNameKey_ === 'function') ? clientNameKey_(emp._displayName) : '';
    if (k === nameKey && !master) master = emp;
  });
  if (!master) {
    return { status: 404, message: '"' + person.name + '" was not found on the employee Master — ' +
             'the cert dates live there, and a flow without them would be invented paperwork.' };
  }

  var cat = medDelCat_();
  var cfg = cat.settings;
  var now = Date.now();
  var wanted = str_(payload.medLevel);
  var levels = wanted ? [wanted] : cat.levels;
  var created = [], refused = [];
  levels.forEach(function (level) {
    if (cat.levels.indexOf(level) === -1) { refused.push(level + ': unknown med level'); return; }
    var ms = medDelDateMs_(master[cat.levelColumns[level]]);
    if (ms === null) { refused.push(level + ': no expiration on the Master'); return; }
    var days = medDelDays_(ms, now);
    if (!wanted && (days > cfg.windowDays || days < -cfg.windowDays)) return;
    var made = medDelCreateFlow_({
      employeeId: employeeId,
      employeeName: String(person.name || master._displayName),
      nameKey: nameKey, medLevel: level,
      certExpDate: medDelIsoDay_(ms),
      phone: str_(person.phone) || String(master.phone_number || ''),
      email: str_(person.email) || String(master.email || '')
    }, 'asa-hub:' + str_(user.email));
    if (made.error) refused.push(made.error.message);
    else created.push({ flowId: String(made.id), medLevel: level });
  });

  if (!created.length) {
    return { status: 409, message: refused.length ? refused.join('; ')
             : 'No ' + (wanted || 'Med Del') + ' certification inside the ±' + cfg.windowDays +
               '-day window — nothing to renew yet.' };
  }
  hubSysLog_(str_(user.email), 'medDelStart', str_(person.name),
             { status: 200, message: created.length + ' flow(s) created' });
  return { status: 200, data: { created: created, refused: refused } };
};

HUB_POLICY.medDelAdvance = {
  file: 'MedDel.gs', lane: 'write', store: 'sheet',
  // Not idempotent: each advance is a distinct human decision, and a retry is refused by the phase guard.
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['medDelFlowsRaw'], emits: [],
  params: {
    flowId: { type: 'string', required: true },
    milestone: { type: 'string', required: true },
    date: { type: 'string' }, note: { type: 'string' }
  }
};
HUB_ACTIONS.medDelAdvance = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};
  var flowId = str_(payload.flowId);
  var milestone = str_(payload.milestone);
  var note = str_(payload.note);
  var by = 'asa-hub:' + str_(user.email);
  var now = new Date().toISOString();

  var flow = null;
  medDelReadFlows_().forEach(function (f) { if (f.id === flowId && !flow) flow = f; });
  if (!flow) return { status: 404, message: 'No med del flow with id "' + flowId + '".' };
  if (flow.overallStatus !== 'active') {
    return { status: 409, message: 'That flow is ' + flow.overallStatus + ' — only an active flow advances.' };
  }
  var phase = Number(flow.phase) || 1;

  if (milestone === 'application_received') {
    if (phase !== 2 || flow.phase2Status !== 'employee_confirmed') {
      return { status: 409, message: 'The employee has not confirmed yet — the application is ' +
               'marked received after their confirmation (phase 2).' };
    }
    medDelPatchFlow_(flowId, {
      phase2Status: 'application_received', phase2ReceivedDate: now.slice(0, 10),
      phase: '3', phase3Status: 'registration_pending'
    }, { at: now, by: by, from: 'phase 2', to: 'phase 3',
         note: note || 'Final application received — online course window opened' });
    hubSysLog_(str_(user.email), 'medDelAdvance', flowId, { status: 200, message: 'application received' });
    return { status: 200, data: { advanced: true, phase: 3 } };
  }

  if (milestone === 'training_complete') {
    if (phase !== 3) return { status: 409, message: 'That flow is not in phase 3.' };
    medDelPatchFlow_(flowId, { phase3Status: 'training_complete', phase: '4', phase4Status: 'pending' },
      { at: now, by: by, from: 'phase 3', to: 'phase 4',
        note: note || 'Online Relias course complete — scheduling the skills check' });
    hubSysLog_(str_(user.email), 'medDelAdvance', flowId, { status: 200, message: 'training complete' });
    return { status: 200, data: { advanced: true, phase: 4 } };
  }

  if (milestone === 'skills_scheduled') {
    if (phase !== 4) return { status: 409, message: 'That flow is not in phase 4.' };
    var ms = medDelDateMs_(payload.date);
    if (ms === null) return { status: 400, message: 'A skills check date is required (date: yyyy-MM-dd).' };
    medDelPatchFlow_(flowId, {
      phase4Status: 'date_scheduled', phase4ScheduledDate: medDelIsoDay_(ms),
      phase4ReminderSent: ''
    }, { at: now, by: by, from: 'phase 4', to: 'phase 4',
         note: (note ? note + ' — ' : '') + 'Skills check scheduled for ' + medDelIsoDay_(ms) });
    hubSysLog_(str_(user.email), 'medDelAdvance', flowId, { status: 200, message: 'skills scheduled' });
    return { status: 200, data: { advanced: true, scheduled: medDelIsoDay_(ms) } };
  }

  if (milestone === 'skills_done') {
    if (phase !== 4) return { status: 409, message: 'That flow is not in phase 4.' };
    var doneMs = medDelDateMs_(payload.date);
    var doneDay = doneMs === null ? now.slice(0, 10) : medDelIsoDay_(doneMs);
    medDelPatchFlow_(flowId, {
      phase4Status: 'done', skillsDoneDate: doneDay, phase: '5', phase5Status: 'pending'
    }, { at: now, by: by, from: 'phase 4', to: 'phase 5',
         note: (note ? note + ' — ' : '') + 'Skills check done on ' + doneDay +
               ' — MAIS verification follows' });
    hubSysLog_(str_(user.email), 'medDelAdvance', flowId, { status: 200, message: 'skills done' });
    return { status: 200, data: { advanced: true, phase: 5 } };
  }

  return { status: 400, message: 'Unknown milestone "' + milestone + '". Valid: ' +
           'application_received, training_complete, skills_scheduled, skills_done.' };
};

HUB_POLICY.medDelCancel = {
  file: 'MedDel.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['medDelFlowsRaw'], emits: [],
  params: { flowId: { type: 'string', required: true }, reason: { type: 'string' } }
};
HUB_ACTIONS.medDelCancel = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};
  var flowId = str_(payload.flowId);
  var flow = null;
  medDelReadFlows_().forEach(function (f) { if (f.id === flowId && !flow) flow = f; });
  if (!flow) return { status: 404, message: 'No med del flow with id "' + flowId + '".' };
  if (flow.overallStatus === 'cancelled') return { status: 200, data: { cancelled: true, already: true } };
  if (flow.overallStatus === 'complete') {
    return { status: 409, message: 'That flow is complete — a finished renewal is not cancelled.' };
  }
  var now = new Date().toISOString();
  medDelPatchFlow_(flowId, {
    overallStatus: 'cancelled',
    cancelReason: str_(payload.reason) || 'cancelled by ' + str_(user.email)
  }, { at: now, by: 'asa-hub:' + str_(user.email),
       from: 'phase ' + flow.phase, to: 'cancelled',
       note: str_(payload.reason) || 'Cancelled by hand' });
  hubSysLog_(str_(user.email), 'medDelCancel', flowId, { status: 200, message: str_(payload.reason) });
  return { status: 200, data: { cancelled: true } };
};

HUB_POLICY.medDelDailySweep = {
  file: 'MedDel.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: ['medDelFlowsRaw'],
  emits: ['smsSend', 'emailSend', 'teamAlert'],
  emits_via: 'smart-comms'
};
HUB_ACTIONS.medDelDailySweep = function (payload, user) {
  if (!user || (!user.is_service && !hubIsWriter_(user))) return hubDenied_();
  var out = medDelSweep_({ by: 'asa-hub:' + str_(user.email || 'meddel-sweep') });
  hubSysLog_(str_(user.email || 'asa-hub:meddel'), 'medDelDailySweep',
             'created ' + out.created + ', processed ' + out.processed +
             ', catalogue ' + (out.catalogue.ok ? out.catalogue.source : 'UNREAD'),
             { status: out.errors.length ? 500 : 200,
               message: out.errors.length ? out.errors.join('; ').slice(0, 200)
                        : (out.catalogue.ok ? 'ok' : out.catalogue.why) });
  return { status: 200, data: out };
};
