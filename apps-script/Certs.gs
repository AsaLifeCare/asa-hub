// Shipped floors only: this file loads before IstConfig.gs, so the cert*_() functions read ist_config at call time.
var CERT_TRAININGS_TAB = 'Trainings Status';
var CERT_MAIS_TAB = 'Med Del Certs (MAIS)';
var CERT_MASTER_TAB = 'Master';

// 60, not 30: a renewal must be booked, sat and issued before the person loses shifts.
var CERT_EXPIRING_DAYS = 60;

// Keys are header labels after estateKey_ normalisation.
var CERT_MASTER_COLUMNS = {
  cpr_exp_date: 'cpr',
  dodd_8_hour_exp: 'dodd',
  med_1_exp_date: 'med1',
  med_2_exp_date: 'med2',
  med_3_exp_date: 'med3',
  money_mgt_date: 'money',
  mandt_exp_date: 'mandt'
};

var CERT_TRAINING_KEYS = {
  'cpr exp date': 'cpr',
  'dodd 8-hour exp': 'dodd',
  'dodd 8 hour exp': 'dodd',
  'med 1 exp date': 'med1',
  'med 2 exp date': 'med2',
  'med 3 exp date': 'med3',
  'money mgt date': 'money'
};

var CERT_LABELS = {
  dodd: 'DODD 8-Hour', cpr: 'CPR / First Aid',
  med1: 'Med Delivery 1', med2: 'Med Delivery 2', med3: 'Med Delivery 3',
  mais: 'MAIS Certification', money: 'Money Management',
  mandt: 'MANDT'
};

var CERT_MAIS_KEY = 'mais';

// ---- the only way to read this vocabulary; istCfg*_ falls back per key, never to an empty list ----

function certLabels_() {
  if (typeof istCfgPairs_ !== 'function') return CERT_LABELS;
  var pairs;
  try { pairs = istCfgPairs_('ist_cert_labels'); } catch (e) { return CERT_LABELS; }
  if (!pairs || !pairs.order.length) return CERT_LABELS;
  return pairs.map;
}

function certKeys_() {
  if (typeof istCfgPairs_ !== 'function') return Object.keys(CERT_LABELS);
  var pairs;
  try { pairs = istCfgPairs_('ist_cert_labels'); } catch (e) { return Object.keys(CERT_LABELS); }
  return (pairs && pairs.order.length) ? pairs.order : Object.keys(CERT_LABELS);
}

function certLabel_(key) {
  var k = String(key || '');
  var labels = certLabels_();
  return labels[k] || CERT_LABELS[k] || k;
}

function certExpiringDays_() {
  if (typeof istCfgInt_ !== 'function') return CERT_EXPIRING_DAYS;
  try { return istCfgInt_('ist_cert_expiring_days', 1, 365); }
  catch (e) { return CERT_EXPIRING_DAYS; }
}

function certMasterColumns_() {
  if (typeof istCfgPairs_ !== 'function') return CERT_MASTER_COLUMNS;
  var pairs;
  try { pairs = istCfgPairs_('ist_cert_master_columns'); } catch (e) { return CERT_MASTER_COLUMNS; }
  return (pairs && pairs.order.length) ? pairs.map : CERT_MASTER_COLUMNS;
}

// Labels come back lowercased, the way certPicture_ compares them.
function certTrainingKeys_() {
  if (typeof istCfgPairs_ !== 'function') return CERT_TRAINING_KEYS;
  var pairs;
  try { pairs = istCfgPairs_('ist_cert_training_keys'); } catch (e) { return CERT_TRAINING_KEYS; }
  if (!pairs || !pairs.order.length) return CERT_TRAINING_KEYS;
  var out = {};
  pairs.order.forEach(function (label) { out[String(label).toLowerCase().trim()] = pairs.map[label]; });
  return out;
}

// In the cell's order.
function certMasterColumnsFor_(course) {
  var cols = certMasterColumns_(), out = [];
  for (var col in cols) {
    if (Object.prototype.hasOwnProperty.call(cols, col) && cols[col] === course) out.push(col);
  }
  return out;
}

// The tab name is configurable; the file id stays a property, never a settings cell.
function certSourceTab_(which) {
  var shipped = which === 'trainings' ? CERT_TRAININGS_TAB
    : which === 'mais' ? CERT_MAIS_TAB
    : which === 'master' ? CERT_MASTER_TAB : '';
  if (typeof istCfgPairs_ !== 'function') return shipped;
  var pairs;
  try { pairs = istCfgPairs_('ist_cert_source_tabs'); } catch (e) { return shipped; }
  var named = (pairs && pairs.map) ? String(pairs.map[which] || '').trim() : '';
  return named || shipped;
}

// An empty map when the config cannot be asked.
function certCfgPairs_(key) {
  if (typeof istCfgPairs_ !== 'function') return { map: {}, order: [] };
  try { return istCfgPairs_(key); } catch (e) { return { map: {}, order: [] }; }
}

// One fact's column spec from ist_cert_source_fields, e.g. 'employee|name'.
function certSourceField_(fact) {
  var named = String(certCfgPairs_('ist_cert_source_fields').map[fact] || '').trim();
  if (named) return named;
  // a fact left out of the cell keeps its shipped column
  var shipped = (typeof istConfigDefault_ === 'function' && typeof istCfgPairsOf_ === 'function')
    ? istCfgPairsOf_(istConfigDefault_('ist_cert_source_fields')) : null;
  return String((shipped && shipped.map[fact]) || '').trim();
}

// `|` tries alternatives in order; `+` joins columns with a space.
function certFieldOf_(row, spec) {
  var alts = String(spec || '').split('|');
  for (var i = 0; i < alts.length; i++) {
    var joined = alts[i].split('+').map(function (c) {
      var v = row[String(c).trim()];
      return String(v == null ? '' : v).trim();
    }).filter(function (s) { return !!s; }).join(' ');
    if (joined) return joined;
  }
  return '';
}

// Case-insensitive: exact words and `word*` prefixes in written order, `*` for the rest, else fallback.
function certStateOf_(key, word, fallback) {
  var p = certCfgPairs_(key);
  var w = String(word == null ? '' : word).trim().toLowerCase();
  var star = '';
  for (var i = 0; i < p.order.length; i++) {
    var k = String(p.order[i]).trim().toLowerCase();
    var v = String(p.map[p.order[i]] || '').trim().toLowerCase();
    if (k === '*') { star = star || v; continue; }
    if (k.charAt(k.length - 1) === '*') {
      if (w.indexOf(k.slice(0, -1)) === 0) return v;
      continue;
    }
    if (k === w) return v;
  }
  return star || fallback;
}

// An estate sheet on its own timezone: format dates in that zone, never toISOString or cellText_.
function certReadTab_(tab) {
  return cacheRead_(cacheScopeSheet_(hubId_('CERT_SOURCE_ID'), tab), 'rows', function () {
    var ss = ssOpen_(hubId_('CERT_SOURCE_ID'));
    var sheet = ss.getSheetByName(tab);
    if (!sheet) {
      // a tab the settings name that is not there reads as no rows: said, never silent
      try {
        hubSysLog_('asa-hub:certs', 'cert_tab_missing',
                   'the estate\'s book has no tab named "' + tab + '" (ist_cert_source_tabs) — read as empty',
                   { status: 200 });
      } catch (eLg) { /* the read matters more than the note */ }
      return [];
    }
    var tz = ss.getSpreadsheetTimeZone();
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return [];
    var keys = values[0].map(estateKey_);
    var rows = [];
    for (var i = 1; i < values.length; i++) {
      var row = {}, empty = true;
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

function certDateMs_(v) {
  var s = String(v || '').trim();
  if (!s) return null;
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function certPicture_() {
  var byPerson = {};
  var touch = function (name) {
    var k = clientNameKey_(name);
    if (!k) return null;
    if (!byPerson[k]) byPerson[k] = { name: String(name).trim(), certs: {} };
    return byPerson[k];
  };
  var soon = Date.now() + certExpiringDays_() * 24 * 3600 * 1000;
  var masterColumns = certMasterColumns_();
  var trainingKeys = certTrainingKeys_();
  // which column holds each fact (`ist_cert_source_fields`)
  var F = {};
  ['master.name', 'trainings.name', 'trainings.course', 'trainings.status', 'trainings.expires',
   'mais.name', 'mais.status', 'mais.expires', 'mais.category'].forEach(function (f) {
    F[f] = certSourceField_(f);
  });

  // A date decides valid/expiring/expired; no date writes nothing, so the cell stays missing, never valid.
  var masterRows = certReadTab_(certSourceTab_('master'));
  var masterKey = function (r) { return clientNameKey_(certFieldOf_(r, F['master.name'])); };
  var rowsOf = {}, activeOf = {};
  masterRows.forEach(function (r) {
    var k = masterKey(r);
    if (!k) return;
    rowsOf[k] = (Object.prototype.hasOwnProperty.call(rowsOf, k) ? rowsOf[k] : 0) + 1;
    if (emp360StatusActive_(r)) activeOf[k] = true;
  });
  masterRows.forEach(function (r) {
    var k = masterKey(r);
    if (k && rowsOf[k] > 1 && activeOf[k] === true && !emp360StatusActive_(r)) return;
    var p = touch(certFieldOf_(r, F['master.name']));
    if (!p) return;
    for (var label in masterColumns) {
      if (!Object.prototype.hasOwnProperty.call(masterColumns, label)) continue;
      var cred = masterColumns[label];
      var ms = certDateMs_(r[label]);
      if (ms === null) continue;
      p.certs[cred] = {
        status: ms < Date.now() ? 'expired' : (ms < soon ? 'expiring' : 'valid'),
        expires: String(r[label] || '')
      };
    }
  });

  // Runs after the dates: a tracker exception (expired or expiring, never valid) outranks a date that looks fine.
  certReadTab_(certSourceTab_('trainings')).forEach(function (r) {
    var key = trainingKeys[certFieldOf_(r, F['trainings.course']).toLowerCase().trim()];
    if (!key) return;
    var p = touch(certFieldOf_(r, F['trainings.name']));
    if (!p) return;
    var status = certStateOf_('ist_cert_tracker_statuses', certFieldOf_(r, F['trainings.status']),
                              'expiring') === 'expired' ? 'expired' : 'expiring';
    p.certs[key] = { status: status, expires: certFieldOf_(r, F['trainings.expires']) };
  });

  // MAIS: the latest record per person decides; a status word not certified or skip stands as expired.
  var latest = {};
  certReadTab_(certSourceTab_('mais')).forEach(function (r) {
    if (certStateOf_('ist_cert_mais_statuses', certFieldOf_(r, F['mais.status']), 'expired') === 'skip') return;
    var name = certFieldOf_(r, F['mais.name']);
    var k = clientNameKey_(name);
    if (!k) return;
    var ms = certDateMs_(certFieldOf_(r, F['mais.expires'])) || 0;
    if (!latest[k] || ms > latest[k].ms) latest[k] = { ms: ms, row: r, name: name };
  });
  for (var k in latest) {
    var r2 = latest[k].row;
    var p2 = touch(latest[k].name);
    if (!p2) continue;
    var certified = certStateOf_('ist_cert_mais_statuses', certFieldOf_(r2, F['mais.status']),
                                 'expired') === 'certified';
    var expires2 = certFieldOf_(r2, F['mais.expires']);
    var ms2 = certDateMs_(expires2);
    var st = !certified || (ms2 !== null && ms2 < Date.now()) ? 'expired'
      : (ms2 !== null && ms2 < soon) ? 'expiring' : 'valid';
    p2.certs[CERT_MAIS_KEY] = { status: st, expires: expires2,
                                category: certFieldOf_(r2, F['mais.category']) };
  }
  // Onboarding only lifts a cell off missing; a revocation or passed expiry always pulls it down.
  if (typeof clearanceApply_ === 'function') {
    try { byPerson = clearanceApply_(byPerson); } catch (eClr) {}
  }
  return byPerson;
}

var CERT_MATRIX_COLUMNS = ['dodd', 'cpr', 'med1', 'med2', 'med3', 'mais', 'money', 'mandt'];

// The floor is added to, never replaced: no settings cell may make a person look compliant.
function certMatrixColumns_() {
  var out = [], seen = {};
  // hasOwnProperty: a typed key like "constructor" would otherwise read as seen.
  var have = function (k) { return Object.prototype.hasOwnProperty.call(seen, k); };
  CERT_MATRIX_COLUMNS.forEach(function (k) {
    if (!have(k)) { seen[k] = true; out.push(k); }
  });
  certKeys_().forEach(function (k) {
    if (k && !have(k)) { seen[k] = true; out.push(k); }
  });
  return out;
}

// A course no source can report on must never default to valid for the whole roster.
function certAnswerableKeys_() {
  var out = {};
  var add = function (k) { var s = String(k == null ? '' : k).trim(); if (s) out[s] = true; };
  var master = certMasterColumns_();
  for (var mk in master) {
    if (Object.prototype.hasOwnProperty.call(master, mk)) add(master[mk]);
  }
  var training = certTrainingKeys_();
  for (var tk in training) {
    if (Object.prototype.hasOwnProperty.call(training, tk)) add(training[tk]);
  }
  add(CERT_MAIS_KEY);
  if (typeof CLEARANCE_CREDENTIALS !== 'undefined' && CLEARANCE_CREDENTIALS &&
      typeof CLEARANCE_CREDENTIALS.forEach === 'function') {
    CLEARANCE_CREDENTIALS.forEach(add);
  }
  return out;
}

// Precedence: a record's status; unsourced key → ''; person known to the tracker → valid; else missing.
function certMatrixCell_(known, key, answerable) {
  var own = function (o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); };
  if (own(known, key) && known[key]) {
    return { status: String(known[key].status || ''), expires: known[key].expires || '',
             dated: true, attention: known[key].status !== 'valid' ? 1 : 0 };
  }
  if (!own(answerable, key)) {
    return { status: '', expires: '', dated: false, attention: 0 };
  }
  if (known) return { status: 'valid', expires: '', dated: false, attention: 0 };
  return { status: 'missing', expires: '', dated: false, attention: 1 };
}

function certMatrixRows_() {
  var picture = certPicture_();
  var columns = certMatrixColumns_();
  var answerable = certAnswerableKeys_();
  var rows = [];
  withoutIspClients_(peopleMerged_(listRows_('people', {}))).forEach(function (p) {
    if (String(p.status || '').toLowerCase() !== 'active') return;
    var k = clientNameKey_(p.name);
    var known = (k && picture[k]) ? picture[k].certs : null;
    var row = { id: 'CERT_' + String(p.id), name: String(p.name || ''), role: String(p.role || '') };
    var attention = 0;
    columns.forEach(function (c) {
      var cell = certMatrixCell_(known, c, answerable);
      row[c] = cell.status;
      if (cell.dated) row[c + '_expires'] = cell.expires;
      attention += cell.attention;
    });
    row.attention = attention;
    rows.push(row);
  });
  rows.sort(function (a, b) { return (b.attention - a.attention) || String(a.name).localeCompare(String(b.name)); });
  return rows;
}

function staffCertRows_() {
  var picture = certPicture_();
  var rows = [];
  for (var k in picture) {
    var p = picture[k];
    for (var c in p.certs) {
      rows.push({
        id: 'SC_' + k + '_' + c,
        personName: p.name,
        certId: 'cert-' + c,
        certName: certLabel_(c),
        status: p.certs[c].status,
        expiresAt: p.certs[c].expires || ''
      });
    }
  }
  rows.sort(function (a, b) { return String(a.expiresAt).localeCompare(String(b.expiresAt)); });
  return rows;
}

// FAIL-CLOSED: the generic door lists nothing.
function certsRoute_(resource, action) {
  if (action === 'list') {
    return { status: 403, message: 'The certification tracker is read through certTrackerList, which answers ' +
             'each person their own certifications — this door cannot tell who is asking.' };
  }
  if (action === 'get') return { status: 404, message: 'Certification rows are derived — read the list.' };
  return { status: 405, message: 'Certifications are derived from the estate tracker (read-only here).' };
}

/** A tracker row's person: the roster row a matrix row was built from, the name a certificate row carries. */
function certTrackerOwn_(view, row, self) {
  if (view === 'matrix') return complianceDocsRosterId_(str_(row && row.id).replace(/^CERT_/, '')) === self.id;
  return clientNameKey_(row && row.personName) === self.key;
}

/** The certification tracker — the matrix, or one row per certificate: every person's to the real master, the caller's own to everyone else. A refusal carries the same `scope`. */
HUB_POLICY.certTrackerList = {
  file: 'Certs.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: {
    view: { type: 'string' }       // matrix | certs
  }
};
HUB_ACTIONS.certTrackerList = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  var role = String(user.role);
  if (role !== 'admin' && role !== 'manager' && role !== 'staff') return hubDenied_();
  var view = str_(payload && payload.view) || 'matrix';
  if (view !== 'matrix' && view !== 'certs') {
    return { status: 400, message: 'The tracker is read as "matrix" or "certs".' };
  }
  var all = hubIsRealMaster_(user);
  var self = all ? null : complianceDocsSelf_(user);
  if (self && !self.key) return complianceDocsRefusal_(self);
  var rows = null;
  try { rows = view === 'matrix' ? certMatrixRows_() : staffCertRows_(); } catch (eT) { rows = null; }
  if (!Array.isArray(rows)) {
    return { status: 503, message: 'The certification tracker could not be read just now — nothing is listed ' +
             'rather than an empty tracker.', scope: all ? 'all' : 'own' };
  }
  if (self) rows = rows.filter(function (r) { return certTrackerOwn_(view, r, self); });
  return { status: 200, data: { rows: rows, scope: all ? 'all' : 'own', self: self ? self.name : '' } };
};
