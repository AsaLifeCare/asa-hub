// A row somebody started is never touched; the SSN is never logged, returned or shown unmasked.

// Resolved when asked, never at load.
function empDbId_() { return hubId_('CERT_SOURCE_ID'); }

// The floor; the living name is a cell read through Certs.gs, so every reader opens the same tab.
var EMPDB_TAB = 'Master';

function empdbTab_() {
  if (typeof certSourceTab_ !== 'function') return EMPDB_TAB;
  try { return certSourceTab_('master') || EMPDB_TAB; }
  catch (e) { return EMPDB_TAB; }
}

// Headers were renamed over the years; first hit wins.
var EMPDB_COLUMNS = {
  // 'Employee'/'Name' first: that is this sheet's wording, and a miss appends a duplicate row.
  'Employee Name': ['Employee', 'Name', 'Employee Name', 'Full Name'],
  'First Name': ['First Name', 'First'],
  'Last Name': ['Last Name', 'Last'],
  'Middle Initial': ['Middle Initial', 'MI'],
  'Date of Birth': ['Date of Birth', 'DOB', 'Birth Date'],
  'SSN': ['SSN#', 'SSN', 'Social Security'],
  'Email': ['Email', 'Email Address', 'E-mail'],
  'Address': ['Address', 'Street Address', 'Home Address'],
  'City': ['City'],
  'State': ['State', 'ST'],
  'Zip': ['Zip', 'Zip Code', 'Zipcode'],
  'Phone': ['Phone Number', 'Phone', 'Mobile Phone', 'Cell', 'Cell Phone'],
  'Home Phone': ['Home Phone'],
  'Referral': ['Referral', 'Referred By', 'Source']
};

// Columns 2-30 are formulas: write the dates, never the flags.
var EMPDB_PACKET_FORMS = [
  // Signing completes only the employee half of the I-9.
  { cols: ['I-9 Completed'], value: 'No' }
];

// The first-day column takes the signature date by rule; an empty AT zeroes six flags.
var EMPDB_PACKET_DATES = [
  ['I-9 Date'], ['W-4 Date', 'W4 Date'], ['HIPAA Form Date'],
  ['Pay Auth Form Date'], ['Attestation Date'], ['Job App Date'],
  ['Start Date(doc)', 'Start Date (doc)'],
  ['Start Date (first day)', 'Start Date(first day)']
];

// A date that cannot be read is left blank, never guessed.
var EMPDB_CERT_DOCS = [
  { doc: 'dodd_8hr', cred: 'dodd', cols: ['DODD 8-Hour Exp', 'DODD 8 Hour Exp'] },
  { doc: 'cpr_first_aid', cred: 'cpr', cols: ['CPR Exp Date'] },
  // byLevel: the category printed on the certificate picks the Med column.
  { doc: 'med_del', cred: 'med1', cols: ['Med 1 Exp Date'],
    byLevel: { '1': ['Med 1 Exp Date'], '2': ['Med 2 Exp Date'], '3': ['Med 3 Exp Date'] } },
  { doc: 'drivers_id', cred: 'id', cols: ['I-9 1 Exp Date', 'License Exp Date'] },
  // Not an expiry: the day the check was run.
  { doc: 'background_check', cred: '', cols: ['BCI Check Date'], use: 'issued' }
];

// The columns ist_cert_master_columns names for the course first; the typed headers are the floor.
function empdbCertCols_(course, literal) {
  var named = [];
  try {
    if (course && typeof certMasterColumnsFor_ === 'function') named = certMasterColumnsFor_(course);
  } catch (e) { named = []; }
  var keys = named.map(empdbKey_);
  return named.concat((literal || []).filter(function (c) { return keys.indexOf(empdbKey_(c)) === -1; }));
}

function empdbDocType_(text, which) {
  var t = String(text || '');
  if (which === 'id') {
    if (/driver'?s?\s*licen[sc]e/i.test(t)) return 'Driver License';
    if (/non-?driver|identification\s+card|state\s+id/i.test(t)) return 'OH ID';
    return '';
  }
  if (/social\s+security/i.test(t)) return 'Social Security';
  if (/birth\s+certificate|certificate\s+of\s+(live\s+)?birth/i.test(t)) return 'Birth Certificate';
  return '';
}

function empdbFileId_(url) {
  var m = String(url || '').match(/\/file\/d\/([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : '';
}

function empdbUsDate_(iso) {
  var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[2] + '/' + m[3] + '/' + m[1]) : '';
}

function empdbDriverNumber_(cand) {
  var name = str_(cand && cand.candidatename);
  if (!name) return '';
  try {
    if (typeof staffDocsFormIndex_ === 'function' && typeof staffDocsKey_ === 'function') {
      var form = staffDocsFormIndex_();
      var mine = form.people[staffDocsKey_(name)];
      if (mine) {
        for (var i = mine.rows.length - 1; i >= 0; i--) {
          var n = str_(mine.rows[i].driverslicense);
          if (n) return n;
        }
      }
    }
  } catch (e) { }
  return '';
}

// Secret labels: never in a log, never in a response.
function empdbSecret_(label) { return label === 'SSN'; }

function empdbSheet_() {
  var tab = empdbTab_();
  var sh = ssOpen_(empDbId_()).getSheetByName(tab);
  if (!sh) throw new Error('The ' + tab + ' tab is missing from the Employee Database.');
  return sh;
}

// Normalised like estateKey_: a plain lowercase compare misses 'SSN #' vs 'SSN#'.
function empdbKey_(h) {
  if (typeof estateKey_ === 'function') return estateKey_(h);
  return String(h || '').replace(/\([^)]*\)/g, ' ').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function empdbColumnIndex_(hdr) {
  var norm = hdr.map(empdbKey_);
  var out = {};
  for (var label in EMPDB_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(EMPDB_COLUMNS, label)) continue;
    var names = EMPDB_COLUMNS[label];
    for (var i = 0; i < names.length; i++) {
      var at = norm.indexOf(empdbKey_(names[i]));
      if (at !== -1) { out[label] = at; break; }
    }
  }
  return out;
}

// Salted fingerprint on both sides; raw digits only when no fingerprint can be made.
function empdbSsnKey_(v) {
  if (typeof hubSsnFingerprint_ === 'function') {
    var fp = hubSsnFingerprint_(v);
    if (fp) return 'fp:' + fp;
  }
  var d = String(v == null ? '' : v).replace(/\D/g, '');
  return d.length === 9 ? 'd:' + d : '';
}

// SSN, then e-mail, then name; a tie is a refusal, never a guess.
function empdbFindRow_(values, idx, answers) {
  var digits = function (v) { return String(v == null ? '' : v).replace(/\D/g, ''); };
  var wantSsnKey = str_(answers.SSN_FP) ? 'fp:' + str_(answers.SSN_FP) : empdbSsnKey_(answers.SSN);
  var want = {
    ssn: digits(answers.SSN),
    email: String(answers.Email || '').trim().toLowerCase(),
    name: typeof nameNorm_ === 'function' ? nameNorm_(answers['Employee Name']) : ''
  };
  var hits = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r], by = '';
    if (wantSsnKey && idx.SSN !== undefined &&
        empdbSsnKey_(row[idx.SSN]) === wantSsnKey) by = 'ssn';
    if (!by && want.email && idx.Email !== undefined &&
        String(row[idx.Email] || '').trim().toLowerCase() === want.email) by = 'email';
    if (!by && want.name && idx['Employee Name'] !== undefined && typeof nameNorm_ === 'function' &&
        nameNorm_(row[idx['Employee Name']]) === want.name) by = 'name';
    if (by) hits.push({ row: r + 1, by: by });
  }
  if (!hits.length) return { row: 0, by: '' };
  var strong = hits.filter(function (h) { return h.by === 'ssn' || h.by === 'email'; });
  if (strong.length === 1) return strong[0];
  if (strong.length > 1) return { row: 0, by: '', conflict: strong.length };
  if (hits.length > 1) return { row: 0, by: '', conflict: hits.length };
  return hits[0];
}

/** Fill one person's Employee Database row from what hiring collected; a preview unless commit is true. */
HUB_POLICY.employeeDbFill = {
  file: 'EmployeeDb.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: ['certMatrix', 'staffCerts'], emits: []
};
HUB_ACTIONS.employeeDbFill = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var commit = payload.commit === true || String(payload.commit) === 'true';

  var cand = null;
  try { cand = hubEvidence_(cid).cand; } catch (e) { cand = null; }
  if (!cand) return { status: 404, message: 'No candidate "' + cid + '".' };

  var rows = packetMirrorRows_();
  var res = packetMatch_(cand, rows);
  if (res.state !== 'signed' || !res.srid) {
    return { status: 409, message: 'There is no SIGNED packet for ' + str_(cand.candidatename) +
             ' — the origin details come from the packet, so there is nothing to fill from yet.' };
  }
  var hit = null;
  rows.forEach(function (r) { if (str_(r.signaturerequestid) === res.srid) hit = r; });
  var raw = {};
  try { raw = JSON.parse(str_(hit && hit.fieldsjson) || '{}') || {}; } catch (eJ) { raw = {}; }
  if (!Object.keys(raw).length) {
    return { status: 409, message: 'The packet is signed but its answers are not mirrored yet — run a recruitment sync first.' };
  }
  var answers = packetAnswers_(raw).named;
  // packetAnswers_ masks the SSN; a masked value must never be written.
  var trueSsn = '';
  for (var k in raw) {
    var lab = PACKET_FIELD_MAP[String(k).toLowerCase()];
    if (lab === 'SSN' && !trueSsn) trueSsn = String(raw[k]).trim();
    if (String(k).toLowerCase() === 'ssn_fp') answers.SSN_FP = String(raw[k]).trim();
  }
  if (trueSsn) answers.SSN = trueSsn;

  var sheet = empdbSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var idx = empdbColumnIndex_(hdr);

  var signedOn = empdbUsDate_(hit && hit.signed);
  var norm = hdr.map(empdbKey_);
  var extra = [];
  EMPDB_PACKET_FORMS.forEach(function (f) {
    for (var i = 0; i < f.cols.length; i++) {
      var at = norm.indexOf(empdbKey_(f.cols[i]));
      if (at !== -1) { idx['__' + hdr[at]] = at; answers['__' + hdr[at]] = f.value; extra.push(hdr[at]); return; }
    }
  });
  var myDocs = {};
  try { myDocs = (onboardingDocIndex_() || {})[cid] || {}; } catch (eDoc) { myDocs = {}; }
  var put = function (names, value) {
    if (!value) return;
    for (var i = 0; i < names.length; i++) {
      var at = norm.indexOf(empdbKey_(names[i]));
      if (at !== -1) { idx['__' + hdr[at]] = at; answers['__' + hdr[at]] = value; extra.push(hdr[at]); return; }
    }
  };
  // Presence needs an upload; an expiry date needs review, and every held date is named.
  var withheld = [];
  var empdbHasIt_ = function (d) {
    return !!d && (d.status === 'uploaded' || d.status === 'verified');
  };
  // document_catalog.review_required decides per class; unconfigured means review needed.
  var reviewNeeded = {};
  try {
    var catRows = (typeof filesCatalog_ === 'function') ? filesCatalog_() : [];
    for (var ci = 0; ci < catRows.length; ci++) {
      var flag = String(catRows[ci].review_required == null ? ''
                        : catRows[ci].review_required).trim().toLowerCase();
      reviewNeeded[str_(catRows[ci].doc_id)] =
        !(flag === 'false' || flag === 'no' || flag === 'off');
    }
  } catch (eCat) { reviewNeeded = {}; }
  var empdbDateAllowed_ = function (d, what, docId) {
    if (!d) return false;
    if (d.status === 'verified' || d.review_status === 'verified') return true;
    var needs = reviewNeeded[str_(docId)];
    if (needs === false && d.status === 'uploaded') return true;
    if (d.status === 'uploaded') {
      withheld.push(what + ' — the document is on file but nobody has reviewed it');
    }
    return false;
  };
  var ocrBudget = 4, ocrText = {};
  var textOf = function (d) {
    var fid = empdbFileId_(d && d.file_url);
    if (!fid) return '';
    if (ocrText[fid] !== undefined) return ocrText[fid];
    if (ocrBudget <= 0) return '';
    ocrBudget--;
    var t = '';
    try { t = (typeof clearanceOcrText_ === 'function') ? clearanceOcrText_(fid) : ''; } catch (eO) { t = ''; }
    ocrText[fid] = t;
    return t;
  };

  EMPDB_CERT_DOCS.forEach(function (cd) {
    var d = myDocs[cd.doc];
    if (!empdbHasIt_(d)) return;
    if (!empdbDateAllowed_(d, (cd.cred || cd.doc) + ' date', cd.doc)) return;
    var wants = cd.use === 'issued' ? 'issued_on' : 'expires_on';
    // A date already on record skips OCR.
    var iso = str_(d[wants]);
    var txt = '';
    if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) {
      txt = textOf(d);
      iso = (typeof clearanceDateFromText_ === 'function') ? clearanceDateFromText_(txt, cd.cred) : '';
      if (cd.cred === 'id') put(['I-9 Type 1'], empdbDocType_(txt, 'id'));
    }
    var cols = empdbCertCols_(cd.cred, cd.cols);
    if (cd.byLevel) {
      // The decoder's own level reader, never a second one.
      var lvl = '';
      try {
        if (typeof digestMedLevel_ === 'function') lvl = digestMedLevel_(txt || textOf(d));
      } catch (eL) { lvl = ''; }
      var picked = [];
      String(lvl).split(',').forEach(function (one) {
        if (cd.byLevel[one]) picked = picked.concat(empdbCertCols_('med' + one, cd.byLevel[one]));
      });
      if (picked.length) cols = picked;
    }
    put(cols, empdbUsDate_(iso));
  });

  // An SS card has no expiry: 'n/a' is what filled rows carry.
  var ss = myDocs['ss_birth'];
  if (empdbHasIt_(ss)) {
    var t2 = empdbDocType_(textOf(ss), 'ss');
    if (t2) { put(['I-9 Type 2'], t2); put(['I-9 2 Exp Date'], 'n/a'); }
  }
  var hs = myDocs['hs_diploma'];
  if (empdbHasIt_(hs)) put(['HS Diploma'], 'Yes');

  var dl = myDocs['drivers_id'];
  if (empdbHasIt_(dl)) put(['Driver'], 'Yes');
  var dlNumber = str_(answers['DL Number']) || empdbDriverNumber_(cand);
  if (dlNumber) put(['DL #', 'DL#', 'Drivers License #'], dlNumber);

  var ins = myDocs['car_insurance'];
  if (empdbHasIt_(ins) && empdbDateAllowed_(ins, 'auto insurance expiry', 'car_insurance')) {
    var insIso = str_(ins.expires_on);
    if (!insIso || !/^\d{4}-\d{2}-\d{2}/.test(insIso)) {
      insIso = (typeof clearanceDateFromText_ === 'function')
        ? clearanceDateFromText_(textOf(ins), 'insurance') : '';
    }
    put(['Insurance Exp Date'], empdbUsDate_(insIso));
  }

  var atResume = norm.indexOf(empdbKey_('Resume'));
  if (atResume !== -1) {
    idx['__' + hdr[atResume]] = atResume;
    answers['__' + hdr[atResume]] = str_(cand.resumelink) ? 'Yes' : 'No';
    extra.push(hdr[atResume]);
  }
  if (signedOn) {
    EMPDB_PACKET_DATES.forEach(function (names) {
      for (var i = 0; i < names.length; i++) {
        var at = norm.indexOf(empdbKey_(names[i]));
        if (at !== -1) { idx['__' + hdr[at]] = at; answers['__' + hdr[at]] = signedOn; extra.push(hdr[at]); return; }
      }
    });
  }

  var found = empdbFindRow_(values, idx, answers);
  if (found.conflict) {
    return { status: 409, message: 'Two rows in the Employee Database match this person (' +
             found.conflict + '). Merging people is not something to do automatically — ' +
             'sort the duplicate out first.' };
  }

  // Only basic fields count as a row somebody started.
  var BASIC = ['Employee Name', 'First Name', 'Last Name', 'Date of Birth',
               'SSN', 'Email', 'Address', 'City', 'Zip', 'Phone'];
  if (found.row) {
    var started = [];
    BASIC.forEach(function (label) {
      var at = idx[label];
      if (at === undefined) return;
      var v = String(values[found.row - 1][at] == null ? '' : values[found.row - 1][at]).trim();
      if (v) started.push(hdr[at]);
    });
    if (started.length) {
      return { status: 200, data: {
        touched: false, candidate_id: cid, name: str_(cand.candidatename),
        matched_row: found.row, matched_by: found.by,
        already_started: started,
        message: 'Somebody is already filling this row (' + started.length +
                 ' field(s) on row ' + found.row + '). Left exactly as it is.'
      } };
    }
  }

  // Fill-blank only: a typed Status is never overwritten.
  if (answers['Status'] === undefined || !String(answers['Status'] || '').trim()) {
    answers['Status'] = 'Hired';
  }
  if (withheld.length) {
    try {
      hubSysLog_(user && user.email, 'employee_db_withheld',
        str_(cand.candidatename) + ' — ' + withheld.length +
        ' date(s) held back: ' + withheld.join('; '),
        { status: 200 });
    } catch (eW) { }
  }
  var plan = [], skipped = [], noColumn = [];
  for (var label in answers) {
    if (!Object.prototype.hasOwnProperty.call(answers, label)) continue;
    var value = String(answers[label] == null ? '' : answers[label]).trim();
    if (!value) continue;
    var at = idx[label];
    if (at === undefined) { noColumn.push(label); continue; }
    var existing = found.row ? String(values[found.row - 1][at] == null ? '' : values[found.row - 1][at]).trim() : '';
    if (existing) { skipped.push(label); continue; }
    plan.push({ label: label.indexOf('__') === 0 ? label.slice(2) : label,
                column: hdr[at], at: at, value: value });
  }

  // Cell names only, never values: one of them is an SSN.
  var preview = plan.map(function (p) { return p.label + ' → ' + p.column; });

  if (!commit) {
    return { status: 200, data: {
      dry_run: true, touched: false, candidate_id: cid, name: str_(cand.candidatename),
      matched_row: found.row || 0, matched_by: found.by || (found.row ? '' : 'nothing — a new row would be appended'),
      would_fill: preview, would_skip_already_filled: skipped, no_such_column: noColumn,
      waiting_on_review: withheld
    } };
  }

  if (!plan.length && found.row) {
    return { status: 200, data: { filled: [], matched_row: found.row,
             message: 'Everything the packet knows is already on file — nothing to change.' } };
  }

  // A formula is never overwritten: each target cell is read first, whatever its column.
  var formulaRow = found.row
    ? sheet.getRange(found.row, 1, 1, hdr.length).getFormulas()[0]
    : [];
  var skippedFormula = [];
  var formulaTemplateRow = 0;
  plan = plan.filter(function (p) {
    if (formulaRow[p.at]) { skippedFormula.push(p.column); return false; }
    return true;
  });

  if (found.row) {
    plan.forEach(function (p) { sheet.getRange(found.row, p.at + 1).setValue(p.value); });
  } else {
    var line = hdr.map(function () { return ''; });
    plan.forEach(function (p) { line[p.at] = p.value; });
    sheet.appendRow(line);
    found.row = sheet.getLastRow();
    // Formulas copied from the nearest row above that actually has them.
    var srcRow = 0, srcFormulas = null;
    for (var up = found.row - 1; up >= 2 && up > found.row - 40; up--) {
      var cand = sheet.getRange(up, 1, 1, hdr.length).getFormulas()[0];
      var any = false;
      for (var q = 0; q < cand.length; q++) { if (cand[q]) { any = true; break; } }
      if (any) { srcRow = up; srcFormulas = cand; break; }
    }
    if (srcRow) {
      for (var fc = 0; fc < srcFormulas.length; fc++) {
        if (!srcFormulas[fc]) continue;
        sheet.getRange(srcRow, fc + 1).copyTo(
          sheet.getRange(found.row, fc + 1), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
      }
      SpreadsheetApp.flush();
    }
    formulaTemplateRow = srcRow;
  }
  // Existing rows get the formula too, only in genuinely empty cells, never a value.
  var restored = [];
  try {
    var tmplRow = 0, tmpl = null;
    for (var u = found.row - 1; u >= 2 && u > found.row - 40; u--) {
      var cf = sheet.getRange(u, 1, 1, hdr.length).getFormulas()[0];
      for (var q = 0; q < cf.length; q++) { if (cf[q]) { tmplRow = u; tmpl = cf; break; } }
      if (tmplRow) break;
    }
    if (tmplRow) {
      var mineF = sheet.getRange(found.row, 1, 1, hdr.length).getFormulas()[0];
      var mineV = sheet.getRange(found.row, 1, 1, hdr.length).getValues()[0];
      for (var fc2 = 0; fc2 < tmpl.length; fc2++) {
        if (!tmpl[fc2]) continue;
        if (mineF[fc2]) continue;
        if (String(mineV[fc2] == null ? '' : mineV[fc2]).trim()) continue;
        sheet.getRange(tmplRow, fc2 + 1).copyTo(
          sheet.getRange(found.row, fc2 + 1), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
        restored.push(hdr[fc2]);
      }
      if (restored.length) SpreadsheetApp.flush();
      formulaTemplateRow = formulaTemplateRow || tmplRow;
    }
  } catch (eF) { }

  // The log names the fields, never the values.
  hubSysLog_(user.email, 'employee_db_fill',
    cid + ' — ' + str_(cand.candidatename) + ': filled ' + preview.length + ' blank cell(s) [' +
    plan.map(function (p) { return p.label; }).join(', ') + '] on row ' + found.row, { status: 200 });
  return { status: 200, data: {
    filled: plan.map(function (p) { return p.label + ' → ' + p.column; }),
    matched_row: found.row, matched_by: found.by,
    skipped_already_filled: skipped, no_such_column: noColumn,
    waiting_on_review: withheld,
    skipped_formula: skippedFormula,
    formulas_copied_from_row: formulaTemplateRow,
    formulas_restored: restored
  } };
};

// Never moves a card backwards; a card with nothing to fill still stops here so the step stays visible.
function empdbStepSweep_() {
  var ss = ssOpen_(hubId_('HUB_DB_ID'));
  var due = readTabNormalized_(ss, TALENT_CANDIDATES_TAB).filter(function (c) {
    var id = str_(c.candidateid);
    if (!id || TALENT_EXCLUDE_IDS.indexOf(id) !== -1) return false;
    if (str_(c.archived).toLowerCase() === 'true') return false;
    // A test card never enters the real Master.
    if (typeof commsIsTestCandidate_ === 'function' && commsIsTestCandidate_(c)) return false;
    var st = talentStage_(c.status);
    if (st !== 'hired' && st !== 'ready') return false;
    // 'Not filled' can change on its own and is retried; 'Left alone' means a person has the row.
    if (!str_(c.internaldocsat)) return true;
    var note = str_(c.internaldocsnote);
    if (note.indexOf('Left alone') === 0) return false;
    return note.indexOf('Not filled') === 0;
  });
  if (!due.length) return;
  hubEnsureColumns_(TALENT_CANDIDATES_TAB, ['internal_docs_at', 'internal_docs_note']);
  due.forEach(function (c) {
    var cid = str_(c.candidateid);
    var out = null;
    try {
      out = HUB_ACTIONS.employeeDbFill({ candidate_id: cid, commit: true },
        { role: 'admin', email: 'auto-internal-docs' });
    } catch (e) { out = { status: 500, message: String((e && e.message) || e) }; }
    var ok = out && out.status === 200;
    hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, {
      internal_docs_at: new Date().toISOString(),
      internal_docs_note: ok
        ? (out.data && out.data.touched === false
            ? ('Left alone — ' + str_(out.data.message))
            : ('Employee Database filled: ' + ((out.data.filled || []).join('; ') || 'nothing was missing')))
        : ('Not filled — ' + str_(out && out.message))
    }, { email: 'auto-internal-docs' }, false);
    hubBustTalentCache_();
    hubSysLog_('auto-internal-docs', 'internal_docs_step',
      cid + ' — ' + str_(c.candidatename) + ': ' + (ok ? 'filled' : 'FAILED: ' + str_(out && out.message)),
      { status: ok ? 200 : 500 });
  });
}

function runEmployeeDbPreview(candidateId) {
  var out = HUB_ACTIONS.employeeDbFill({ candidate_id: candidateId || '' },
    { role: 'admin', email: 'editor' });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// The [test] name and SSN 000-00-0000 keep this row from ever reading as staff.
function runEmployeeDbWriteTest(removeAfter) {
  var stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  var answers = {
    'Employee Name': '[test] Hub Write Check ' + stamp,
    'First Name': '[test]Hub',
    'Last Name': 'WriteCheck',
    'Date of Birth': '01/01/1990',
    'SSN': '000-00-0000',
    'Email': 'asatechjk@gmail.com',
    'Address': '1 Test Street',
    'City': 'Columbus',
    'State': 'OH',
    'Zip': '43215',
    'Phone': '330-919-5558',
    'Referral': '[test] platform write check'
  };

  var sheet = empdbSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var idx = empdbColumnIndex_(hdr);

  var mapped = [], missing = [];
  for (var label in answers) {
    if (!Object.prototype.hasOwnProperty.call(answers, label)) continue;
    if (idx[label] === undefined) missing.push(label);
    else mapped.push(label + ' → "' + hdr[idx[label]] + '" (col ' + (idx[label] + 1) + ')');
  }

  var found = empdbFindRow_(values, idx, answers);
  var out = {
    spreadsheet: empDbId_(), tab: empdbTab_(),
    headers_seen: hdr.length,
    columns_matched: mapped,
    columns_missing: missing,
    matched_existing_row: found.row || 0,
    conflict: found.conflict || 0
  };

  if (found.conflict) {
    out.result = 'REFUSED — ' + found.conflict + ' rows already match this test identity. Clean them up first.';
    Logger.log(JSON.stringify(out, null, 2));
    return out;
  }

  var line = hdr.map(function () { return ''; });
  mapped.forEach(function () { });
  for (var lab in answers) {
    if (!Object.prototype.hasOwnProperty.call(answers, lab)) continue;
    if (idx[lab] !== undefined) line[idx[lab]] = answers[lab];
  }
  var targetRow;
  if (found.row) {
    for (var l2 in answers) {
      if (!Object.prototype.hasOwnProperty.call(answers, l2)) continue;
      if (idx[l2] !== undefined) sheet.getRange(found.row, idx[l2] + 1).setValue(answers[l2]);
    }
    targetRow = found.row;
  } else {
    sheet.appendRow(line);
    targetRow = sheet.getLastRow();
  }
  SpreadsheetApp.flush();

  // Read it back: a write accepted is not a write landed.
  var back = sheet.getRange(targetRow, 1, 1, hdr.length).getValues()[0];
  var verified = [], wrong = [];
  for (var l3 in answers) {
    if (!Object.prototype.hasOwnProperty.call(answers, l3)) continue;
    if (idx[l3] === undefined) continue;
    var cell = back[idx[l3]];
    var got = String(cell == null ? '' : cell).trim();
    var want = String(answers[l3]);
    // Sheets coerces '01/01/1990' into a date; the same calendar day is a match.
    var same = got === want;
    if (!same && cell instanceof Date) {
      var m = want.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (m) {
        same = cell.getMonth() + 1 === Number(m[1]) &&
               cell.getDate() === Number(m[2]) &&
               cell.getFullYear() === Number(m[3]);
      }
    }
    if (same) verified.push(l3 + (cell instanceof Date ? ' (stored as a date)' : ''));
    else wrong.push(l3 + ': wrote "' + want + '", reads back "' + got + '"');
  }
  out.written_to_row = targetRow;
  out.verified = verified;
  out.reads_back_differently = wrong;
  out.result = wrong.length ? 'WROTE — with ' + wrong.length + ' field(s) reformatted by Sheets'
                            : 'WROTE — every mapped field reads back exactly';

  if (removeAfter === true) {
    sheet.deleteRow(targetRow);
    out.cleaned_up = true;
    out.result += '; test row deleted';
  } else {
    out.cleaned_up = false;
    out.result += '; the [test] row is LEFT IN PLACE on row ' + targetRow + ' for you to look at';
  }
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

function runEmployeeDbInspect(sampleRow) {
  var sheet = empdbSheet_();
  var hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var row = sampleRow || Math.max(2, sheet.getLastRow() - 3);
  var formulas = sheet.getRange(row, 1, 1, hdr.length).getFormulas()[0];
  var values = sheet.getRange(row, 1, 1, hdr.length).getDisplayValues()[0];

  var derived = [], typed = [], empty = [];
  for (var c = 0; c < hdr.length; c++) {
    if (!hdr[c]) continue;
    var entry = hdr[c] + ' (col ' + (c + 1) + ')';
    if (formulas[c]) derived.push(entry + '  ⟵ ' + formulas[c].slice(0, 110));
    else if (String(values[c]).trim()) typed.push(entry + ' = ' + String(values[c]).slice(0, 30));
    else empty.push(entry);
  }
  var out = {
    spreadsheet: empDbId_(), tab: empdbTab_(), sampled_row: row,
    columns: hdr.length,
    derived_never_write: derived,
    typed_safe_to_fill: typed,
    empty_on_this_row: empty
  };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/** The same fill for everyone owed it, capped per run; it commits unless dry_run is set. */
HUB_POLICY.employeeDbFillAll = {
  file: 'EmployeeDb.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: ['candidates', 'certMatrix', 'staffCerts'], emits: []
};
HUB_ACTIONS.employeeDbFillAll = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var dry = payload.dry_run === true || String(payload.dry_run) === 'true';
  var limit = parseInt(payload.limit, 10) || 40;
  var only = str_(payload.candidate_id);

  var ss = ssOpen_(hubId_('HUB_DB_ID'));
  var people = readTabNormalized_(ss, TALENT_CANDIDATES_TAB).filter(function (c) {
    var id = str_(c.candidateid);
    if (!id || TALENT_EXCLUDE_IDS.indexOf(id) !== -1) return false;
    if (only) return id === only;
    if (str_(c.archived).toLowerCase() === 'true') return false;
    var st = talentStage_(c.status);
    if (['onboarding', 'hired', 'becoming-staff', 'internal-docs'].indexOf(st) === -1) return false;
    return !str_(c.internaldocsat);
  });
  if (!people.length) {
    return { status: 200, data: { considered: 0, filled: 0, results: [],
             message: 'Nobody is owed this right now.' } };
  }

  hubEnsureColumns_(TALENT_CANDIDATES_TAB, ['internal_docs_at', 'internal_docs_note']);
  var results = [], filled = 0, skipped = 0, failed = 0;
  for (var i = 0; i < people.length && i < limit; i++) {
    var c = people[i], cid = str_(c.candidateid), name = str_(c.candidatename);
    var out = null;
    try {
      out = HUB_ACTIONS.employeeDbFill({ candidate_id: cid, commit: !dry }, user);
    } catch (e) {
      out = { status: 500, message: String((e && e.message) || e) };
    }
    var d = (out && out.data) || {};
    var line = { candidate_id: cid, name: name, status: out ? out.status : 0 };
    if (out && out.status === 200 && d.touched === false) {
      line.outcome = 'left alone — somebody is already filling that row';
      line.already_started = d.already_started || [];
      skipped++;
    } else if (out && out.status === 200) {
      line.outcome = dry ? 'would fill' : 'filled';
      line.cells = dry ? (d.would_fill || []) : (d.filled || []);
      line.formulas_restored = d.formulas_restored || [];
      line.row = d.matched_row || 0;
      filled++;
    } else {
      line.outcome = 'not done';
      line.why = str_(out && out.message);
      failed++;
    }
    results.push(line);

    if (!dry) {
      var ok = out && out.status === 200;
      hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, {
        internal_docs_at: new Date().toISOString(),
        internal_docs_note: ok
          ? (d.touched === false ? 'Left alone — ' + str_(d.message)
                                 : 'Employee Database filled: ' + ((d.filled || []).join('; ') || 'nothing was missing'))
          : ('Not filled — ' + str_(out && out.message))
      }, user, false);
    }
  }
  if (!dry) hubBustTalentCache_();
  hubSysLog_(user.email, 'employee_db_fill_all',
    people.length + ' owed; ' + filled + ' filled, ' + skipped + ' left alone, ' + failed + ' not done' +
    (dry ? ' (dry run)' : ''), { status: 200 });

  return { status: 200, data: {
    dry_run: dry, considered: people.length, processed: results.length,
    filled: filled, left_alone: skipped, not_done: failed,
    left_for_next_run: Math.max(0, people.length - results.length),
    results: results
  } };
};

function runEmployeeDbFillAll() {
  var out = HUB_ACTIONS.employeeDbFillAll({}, { role: 'admin', email: 'editor' });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

function runEmployeeDbFillAllDryRun() {
  var out = HUB_ACTIONS.employeeDbFillAll({ dry_run: true }, { role: 'admin', email: 'editor' });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/** Fill the Employee Database straight from signed envelopes, a capped batch resumed by its own cursor. */
HUB_POLICY.employeeDbFillFromEnvelopes = {
  file: 'EmployeeDb.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: ['certMatrix', 'staffCerts'], emits: []
};
HUB_ACTIONS.employeeDbFillFromEnvelopes = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var dry = payload.dry_run === true || String(payload.dry_run) === 'true';
  var limit = parseInt(payload.limit, 10) || 25;

  var mirror = packetMirrorRows_().filter(function (r) {
    return String(r.status || '').toLowerCase() === 'signed' && str_(r.fieldsjson);
  });
  if (!mirror.length) {
    return { status: 409, message: 'No signed envelope carries its answers yet — run a recruitment sync first.' };
  }

  // Stable order by request id plus a saved cursor: a re-sync can reshuffle mirror rows.
  mirror.sort(function (a, b) {
    var ka = str_(a.signaturerequestid), kb = str_(b.signaturerequestid);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  var cursor = 0;
  try { cursor = parseInt(hubProp_('EMPDB_ENVELOPE_CURSOR') || '0', 10) || 0; }
  catch (eC) { cursor = 0; }
  if (!(cursor >= 0) || cursor >= mirror.length) cursor = 0;
  var ordered = mirror.slice(cursor).concat(mirror.slice(0, cursor));

  var sheet = empdbSheet_();
  var results = [], filled = 0, skipped = 0, failed = 0, done = 0, examined = 0;

  // Checked between envelopes only: half a staff row is a state nothing downstream can detect.
  var deadline = Date.now() + ENGINE_BUDGET_MS;
  for (var i = 0; i < ordered.length && done < limit; i++) {
    if (Date.now() > deadline) break;
    // `done` bounds the pass; `examined` advances the cursor, unusable envelopes included.
    examined++;
    var r = ordered[i];
    var raw = {};
    try { raw = JSON.parse(str_(r.fieldsjson)) || {}; } catch (eJ) { raw = {}; }
    if (!Object.keys(raw).length) continue;
    var answers = packetAnswers_(raw).named;
    // The real SSN, not the masked one packetAnswers_ shows.
    for (var k in raw) {
      if (String(k).toLowerCase() === 'ssn_fp') answers.SSN_FP = String(raw[k]).trim();
      if (PACKET_FIELD_MAP[String(k).toLowerCase()] === 'SSN') { answers.SSN = String(raw[k]).trim(); break; }
    }
    var who = str_(answers['Employee Name']) || str_(r.candidate);
    if (!who) continue;
    if (!answers['Employee Name']) answers['Employee Name'] = who;
    if (!answers.Email) answers.Email = str_(r.email);
    done++;

    // Re-read every pass: the sheet grows as we go.
    var values = sheet.getDataRange().getValues();
    var hdr = values[0].map(function (h) { return String(h).trim(); });
    var idx = empdbColumnIndex_(hdr);
    var norm = hdr.map(empdbKey_);

    var signedOn = empdbUsDate_(str_(r.signed));
    var put = function (names, value) {
      if (!value) return;
      for (var n = 0; n < names.length; n++) {
        var at = norm.indexOf(empdbKey_(names[n]));
        if (at !== -1) { idx['__' + hdr[at]] = at; answers['__' + hdr[at]] = value; return; }
      }
    };
    EMPDB_PACKET_FORMS.forEach(function (f) { put(f.cols, f.value); });
    if (signedOn) EMPDB_PACKET_DATES.forEach(function (names) { put(names, signedOn); });

    var found = empdbFindRow_(values, idx, answers);
    var line = { name: who, srid: str_(r.signaturerequestid), row: found.row || 0 };

    if (found.conflict) {
      line.outcome = 'refused — ' + found.conflict + ' rows match this person';
      results.push(line); failed++; continue;
    }
    if (found.row) {
      var BASIC = ['Employee Name', 'First Name', 'Last Name', 'Date of Birth',
                   'SSN', 'Email', 'Address', 'City', 'Zip', 'Phone'];
      var started = [];
      for (var b = 0; b < BASIC.length; b++) {
        var ba = idx[BASIC[b]];
        if (ba === undefined) continue;
        if (String(values[found.row - 1][ba] == null ? '' : values[found.row - 1][ba]).trim()) started.push(hdr[ba]);
      }
      if (started.length) {
        line.outcome = 'left alone — already filled (' + started.length + ' field(s))';
        results.push(line); skipped++; continue;
      }
    }

    var plan = [];
    for (var label in answers) {
      if (!Object.prototype.hasOwnProperty.call(answers, label)) continue;
      var value = String(answers[label] == null ? '' : answers[label]).trim();
      if (!value) continue;
      var at2 = idx[label];
      if (at2 === undefined) continue;
      if (found.row && String(values[found.row - 1][at2] == null ? '' : values[found.row - 1][at2]).trim()) continue;
      plan.push({ column: hdr[at2], at: at2, value: value,
                  label: label.indexOf('__') === 0 ? label.slice(2) : label });
    }
    if (found.row) {
      var fr = sheet.getRange(found.row, 1, 1, hdr.length).getFormulas()[0];
      plan = plan.filter(function (p) { return !fr[p.at]; });
    }

    line.cells = plan.map(function (p) { return p.label + ' → ' + p.column; });
    if (dry) { line.outcome = 'would fill'; results.push(line); filled++; continue; }

    if (found.row) {
      plan.forEach(function (p) { sheet.getRange(found.row, p.at + 1).setValue(p.value); });
    } else {
      var newLine = hdr.map(function () { return ''; });
      plan.forEach(function (p) { newLine[p.at] = p.value; });
      sheet.appendRow(newLine);
      found.row = sheet.getLastRow();
      line.row = found.row;
    }
    var restored = [];
    try {
      var tRow = 0, tF = null;
      for (var u = found.row - 1; u >= 2 && u > found.row - 40; u--) {
        var cf = sheet.getRange(u, 1, 1, hdr.length).getFormulas()[0];
        for (var q = 0; q < cf.length; q++) { if (cf[q]) { tRow = u; tF = cf; break; } }
        if (tRow) break;
      }
      if (tRow) {
        var mf = sheet.getRange(found.row, 1, 1, hdr.length).getFormulas()[0];
        var mv = sheet.getRange(found.row, 1, 1, hdr.length).getValues()[0];
        for (var fc = 0; fc < tF.length; fc++) {
          if (!tF[fc] || mf[fc]) continue;
          if (String(mv[fc] == null ? '' : mv[fc]).trim()) continue;
          sheet.getRange(tRow, fc + 1).copyTo(sheet.getRange(found.row, fc + 1),
            SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
          restored.push(hdr[fc]);
        }
      }
    } catch (eF) { }
    SpreadsheetApp.flush();
    line.formulas_restored = restored;
    line.outcome = 'filled';
    results.push(line); filled++;
  }

  // A dry run never moves the cursor, or the preview would eat the next real batch.
  var next = (cursor + examined) % mirror.length;
  if (!dry) {
    try { hubPropSet_('EMPDB_ENVELOPE_CURSOR', String(next)); }
    catch (eS) { }
  } else { next = cursor; }

  hubSysLog_(user.email, 'employee_db_from_envelopes',
    mirror.length + ' signed envelopes; ' + filled + ' filled, ' + skipped + ' left alone, ' +
    failed + ' refused' + (dry ? ' (dry run)' : '') +
    '; resumes at ' + next + '/' + mirror.length, { status: 200 });

  return { status: 200, data: {
    dry_run: dry, signed_envelopes: mirror.length, processed: done,
    filled: filled, left_alone: skipped, refused: failed,
    resumes_at: next,
    left_for_next_run: Math.max(0, mirror.length - next),
    results: results
  } };
};

function runEmployeeDbFromEnvelopesDryRun() {
  var out = HUB_ACTIONS.employeeDbFillFromEnvelopes({ dry_run: true },
    { role: 'admin', email: 'editor' });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

function runEmployeeDbFromEnvelopes() {
  var out = HUB_ACTIONS.employeeDbFillFromEnvelopes({}, { role: 'admin', email: 'editor' });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
