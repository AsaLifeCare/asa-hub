// Admin and manager only; the per-person record stays live and is never mirrored to a file.
var PERF_TABS = {
  staff: 'perf_staff',
  attendance: 'perf_attendance',
  incidents: 'perf_incidents',
  notes: 'perf_notes',
  trainings: 'perf_trainings',
  ai: 'perf_ai',
  board: 'perf_board'
};

var PERF_HEADERS = {
  perf_staff: ['emp_id', 'name', 'emp_num', 'status', 'phone', 'email', 'hire_date',
               'driver', 'hs_diploma', 'src', 'migrated_at'],
  perf_attendance: ['emp_id', 'name', 'date', 'kind', 'notes', 'logged_by', 'src', 'migrated_at'],
  perf_incidents: ['emp_id', 'name', 'type', 'severity', 'date', 'category', 'summary',
                   'action_taken', 'reported_by', 'status', 'src', 'migrated_at'],
  perf_notes: ['emp_id', 'name', 'category', 'text', 'src', 'created_at', 'migrated_at'],
  perf_trainings: ['emp_id', 'name', 'cert', 'expires', 'src', 'migrated_at'],
  perf_ai: ['emp_id', 'hash', 'summary', 'tags', 'grade', 'via', 'made_at'],
  perf_board: ['json', 'computed_at']
};

// A Sheets cell holds 50k chars; the board JSON is split across rows.
var PERF_BOARD_CELL_CAP = 45000;
var PERF_BOARD_MAX_ROWS = 10;

function perfSheet_(tab) {
  // An unknown tab must throw: hubTabEnsure_ would stamp placeholder columns on it.
  var header = PERF_HEADERS[tab];
  if (!header) throw new Error('perfSheet_: no header declared for tab "' + tab + '".');
  var existed = !!hubTabSheet_(tab);
  var sheet = hubTabEnsure_(tab, header);
  if (existed) ensureHeader_(sheet, header);
  return sheet;
}

function perfIsManager_(user) {
  return !!user && !user.is_service &&
         ['admin', 'manager'].indexOf(String(user.role)) !== -1;
}

// A not-yet-migrated tab reads as empty, never as an error.
function perfReadSoft_(ss, tab) {
  var book = null;
  try { book = hubTabWorkbook_(tab); } catch (eW) { book = null; }
  try { return readTabNormalized_(book || ss, tab); }
  catch (e) { return []; }
}

// The master sheet's headers drift: candidate names first, then position.
function perfCol_(headers, names, fallbackIndex) {
  var norm = headers.map(function (h) {
    return String(h || '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, '');
  });
  for (var i = 0; i < names.length; i++) {
    var want = names[i].toLowerCase().replace(/[^a-z0-9]+/g, '');
    var at = norm.indexOf(want);
    if (at !== -1) return at;
  }
  return fallbackIndex === undefined ? -1 : fallbackIndex;
}

function perfCell_(v) {
  if (v instanceof Date) {
    if (v.getFullYear() < 1900) return Utilities.formatDate(v, 'America/New_York', 'HH:mm');
    return Utilities.formatDate(v, 'America/New_York', 'yyyy-MM-dd');
  }
  return String(v == null ? '' : v).trim();
}

var PERF_CERT_COLS = [
  { col: 'DODD 8-Hour Exp', name: 'DODD 8-Hour Training' },
  { col: 'CPR Exp Date', name: 'CPR Certification' },
  { col: 'Med 1 Exp Date', name: 'Medication Administration I' },
  { col: 'Med 2 Exp Date', name: 'Medication Administration II' },
  { col: 'Med 3 Exp Date', name: 'Medication Administration III' },
  { col: 'Mandt Exp Date', name: 'Mandt Training' },
  { col: 'Money Mgt Date', name: 'Money Management' },
  { col: 'License Exp Date', name: "Driver's License" },
  { col: 'Insurance Exp Date', name: 'Vehicle Insurance' }
];

/* ---------------- THE MOVE ---------------- */

/** Copy the staff performance records from the Master Data spreadsheet onto the platform's own tabs, skipping rows already copied. */
HUB_POLICY.staffPerfMigrate = {
  file: 'StaffPerformance.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: ['staffPerfBoard'], emits: []
};
HUB_ACTIONS.staffPerfMigrate = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var master;
  try { master = ssOpen_(hubId_('PERF_MASTER_ID')); }
  catch (eO) {
    return { status: 403, message: 'The Master Data spreadsheet could not be opened — ' +
             'make sure this Google account still has access to it.' };
  }

  var counts = {};

  function copyTab(masterTab, perfTab, mapRow) {
    var sh = master.getSheetByName(masterTab);
    if (!sh || sh.getLastRow() < 2) { counts[perfTab] = 0; return; }
    var values = sh.getDataRange().getValues();
    var headers = values[0];
    var dest = perfSheet_(perfTab);
    var have = {};
    // Dedup must read the tab this copy writes to, or every run re-copies every row.
    readTabNormalized_(hubTabWorkbook_(perfTab) || ssOpen_(hubId_('HUB_DB_ID')), perfTab)
      .forEach(function (r) {
        if (str_(r.src)) have[str_(r.src)] = true;
      });
    var added = 0;
    var out = [];
    for (var i = 1; i < values.length; i++) {
      var src = masterTab + ':' + (i + 1);
      if (have[src]) continue;
      var rows = mapRow(values[i], headers, src);
      for (var k = 0; k < rows.length; k++) { out.push(rows[k]); added++; }
    }
    if (out.length) {
      dest.getRange(dest.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
    }
    counts[perfTab] = added;
  }

  var now = new Date().toISOString();
  var nameToEmp = {};

  copyTab('Employee - Database', 'perf_staff', function (row, headers, src) {
    var cName = perfCol_(headers, ['Employee'], 0);
    var cNum = perfCol_(headers, ['Employee ID']);
    var cStatus = perfCol_(headers, ['Status']);
    var name = perfCell_(row[cName]);
    if (!name) return [];
    var num = cNum === -1 ? '' : perfCell_(row[cNum]);
    var empId = num ? 'EMP_' + num : 'EMP_' + name.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase().slice(0, 24);
    nameToEmp[name.toLowerCase()] = empId;
    var st = cStatus === -1 ? '' : perfCell_(row[cStatus]);
    var status = st === 'Yes' ? 'Active' : st === 'No' ? 'Terminated' : st || 'Active';
    var take = function (names) { var c = perfCol_(headers, names); return c === -1 ? '' : perfCell_(row[c]); };
    return [[empId, name, num, status,
             take(['Phone Number', 'Phone']), take(['Email']),
             take(['Start Date(doc)', 'Start Date', 'Hire Date']),
             take(['Driver']), take(['HS Diploma']), src, now]];
  });

  copyTab('Employee - Database', 'perf_trainings', function (row, headers, src) {
    var cName = perfCol_(headers, ['Employee'], 0);
    var cNum = perfCol_(headers, ['Employee ID']);
    var name = perfCell_(row[cName]);
    if (!name) return [];
    var num = cNum === -1 ? '' : perfCell_(row[cNum]);
    var empId = num ? 'EMP_' + num : (nameToEmp[name.toLowerCase()] || '');
    var out = [];
    for (var j = 0; j < PERF_CERT_COLS.length; j++) {
      var c = perfCol_(headers, [PERF_CERT_COLS[j].col]);
      if (c === -1) continue;
      var exp = perfCell_(row[c]);
      if (!exp) continue;
      out.push([empId, name, PERF_CERT_COLS[j].name, exp, src + ':' + j, now]);
    }
    return out;
  });

  copyTab('Employee - Call Off', 'perf_attendance', function (row, headers, src) {
    var cName = perfCol_(headers, ['Employee Name', 'Employee', 'Name'], 1);
    var cDate = perfCol_(headers, ['Date', 'Call Off Date'], 2);
    var cType = perfCol_(headers, ['Type', 'Reason'], 3);
    var cNotes = perfCol_(headers, ['Notes', 'Details'], 5);
    var cBy = perfCol_(headers, ['Logged By', 'Reported By'], 6);
    var name = perfCell_(row[cName]);
    if (!name) return [];
    return [[nameToEmp[name.toLowerCase()] || '', name, perfCell_(row[cDate]),
             perfCell_(row[cType]), perfCell_(row[cNotes]), perfCell_(row[cBy]), src, now]];
  });

  copyTab('Employee - HR', 'perf_incidents', function (row, headers, src) {
    var cDate = perfCol_(headers, ['Date', 'Timestamp'], 0);
    var cWho = perfCol_(headers, ['Employees Involved', 'Employee', 'Name'], 1);
    var cSit = perfCol_(headers, ['Situation', 'Summary'], 2);
    var cFollow = perfCol_(headers, ['Follow Up', 'Follow-Up'], 3);
    var cResult = perfCol_(headers, ['Result', 'Outcome'], 4);
    var cDisc = perfCol_(headers, ['Discipline', 'Disciplinary Action'], 5);
    var name = perfCell_(row[cWho]);
    var situation = perfCell_(row[cSit]);
    if (!name || !situation) return [];
    var result = perfCell_(row[cResult]);
    var discipline = perfCell_(row[cDisc]);
    var status = /terminat/i.test(result) ? 'Closed' : result ? 'Resolved' : 'Open';
    return [[nameToEmp[name.toLowerCase()] || '', name, 'HR',
             discipline ? 'Major' : 'Minor', perfCell_(row[cDate]),
             discipline ? 'Disciplinary' : 'HR', situation.slice(0, 300),
             perfCell_(row[cFollow]) || discipline, '', status, src, now]];
  });

  copyTab('Client - UIs', 'perf_incidents', function (row, headers, src) {
    var cCreated = perfCol_(headers, ['Timestamp'], 0);
    var cReporter = perfCol_(headers, ['Your Name', 'Reporter'], 1);
    var cCat = perfCol_(headers, ['Category', 'Type'], 3);
    var cDate = perfCol_(headers, ['Incident Date', 'Date'], 5);
    var cInvolved = perfCol_(headers, ['Employees Involved'], 9);
    var cSummary = perfCol_(headers, ['Summary', 'Description'], 10);
    var cAction = perfCol_(headers, ['Action Taken', 'Actions'], 11);
    var summary = perfCell_(row[cSummary]);
    if (!summary) return [];
    var involved = perfCell_(row[cInvolved]) || perfCell_(row[cReporter]);
    if (!involved) return [];
    var out = [];
    var names = involved.split(/[,&]|\band\b/i);
    var seenHere = {};
    for (var n = 0; n < names.length; n++) {
      var nm = names[n].trim();
      if (!nm || seenHere[nm.toLowerCase()]) continue;
      seenHere[nm.toLowerCase()] = true;
      out.push([nameToEmp[nm.toLowerCase()] || '', nm, 'Client', 'Minor',
                perfCell_(row[cDate]) || perfCell_(row[cCreated]),
                perfCell_(row[cCat]), summary.slice(0, 300), perfCell_(row[cAction]),
                perfCell_(row[cReporter]), 'Closed', src + ':' + n, now]);
    }
    return out;
  });

  copyTab('Employee - Daily Notes', 'perf_notes', function (row, headers, src) {
    var cCreated = perfCol_(headers, ['Timestamp'], 0);
    var cWho = perfCol_(headers, ['DSP Name', 'DSP', 'Employee'], 3);
    var cCat = perfCol_(headers, ['Category'], 6);
    var cText = perfCol_(headers, ['Response', 'Note', 'Notes'], 7);
    var name = perfCell_(row[cWho]);
    var text = perfCell_(row[cText]);
    if (!name || !text) return [];
    return [[nameToEmp[name.toLowerCase()] || '', name,
             perfCell_(row[cCat]).replace(/_/g, ' '), text.slice(0, 500),
             src, perfCell_(row[cCreated]), now]];
  });

  try { staffPerfBoardCompute_(); } catch (eB) {}

  hubSysLog_(str_(user.email), 'staff_perf_migrate', JSON.stringify(counts).slice(0, 200),
             { status: 200 });
  return { status: 200, data: { added: counts } };
};

/* ---------------- THE BOARD ---------------- */

// Arithmetic the screen can explain; the model may only argue ±1 over it, with a reason.
function perfGrade_(att90, attOld, majors, minors, expired, expiring) {
  var parts = [];
  var take = function (label, count, per, cap) {
    if (!count) return 0;
    var cut = Math.min(count * per, cap);
    parts.push({ label: label, count: count, cut: -Math.round(cut * 100) / 100 });
    return cut;
  };
  var total = 10;
  total -= take('call-offs in the last 90 days', att90, 0.75, 3);
  total -= take('older call-offs', attOld, 0.15, 1);
  total -= take('major HR incidents', majors, 1.5, 3);
  total -= take('other incidents', minors, 0.5, 2);
  total -= take('expired certifications', expired, 1, 2.5);
  total -= take('certifications expiring', expiring, 0.25, 0.5);
  var grade = Math.max(0, Math.round(total * 10) / 10);
  return { grade: grade, parts: parts };
}

function perfCertStatus_(exp) {
  var t = Date.parse(String(exp || ''));
  if (!t) return 'current';
  var now = Date.now();
  if (t < now) return 'expired';
  if (t <= now + 30 * 86400000) return 'expiring';
  return 'current';
}

function staffPerfBoardBuild_() {
  var db = ssOpen_(hubId_('HUB_DB_ID'));
  var staff = perfReadSoft_(db, PERF_TABS.staff);
  if (!staff.length) return null;
  var att = perfReadSoft_(db, PERF_TABS.attendance);
  var inc = perfReadSoft_(db, PERF_TABS.incidents);
  var trn = perfReadSoft_(db, PERF_TABS.trainings);
  var floor90 = Date.now() - 90 * 86400000;

  var byEmp = {};
  staff.forEach(function (s) {
    var id = str_(s.empid);
    if (!id || byEmp[id]) return;
    byEmp[id] = {
      emp_id: id, name: str_(s.name), status: str_(s.status),
      phone: str_(s.phone), email: str_(s.email), hire_date: str_(s.hiredate),
      attendance_90d: 0, attendance_all: 0, incidents: 0, incidents_major: 0,
      certs_expired: 0, certs_expiring: 0, grade: 10
    };
  });
  var nameIndex = {};
  Object.keys(byEmp).forEach(function (id) { nameIndex[byEmp[id].name.toLowerCase()] = id; });
  var find = function (r) {
    return byEmp[str_(r.empid)] || byEmp[nameIndex[str_(r.name).toLowerCase()]] || null;
  };
  att.forEach(function (r) {
    var hit = find(r);
    if (!hit) return;
    hit.attendance_all++;
    var t = Date.parse(str_(r.date));
    if (t && t >= floor90) hit.attendance_90d++;
  });
  inc.forEach(function (r) {
    var hit = find(r);
    if (!hit) return;
    hit.incidents++;
    if (str_(r.severity) === 'Major') hit.incidents_major++;
  });
  trn.forEach(function (r) {
    var hit = find(r);
    if (!hit) return;
    var st = perfCertStatus_(r.expires);
    if (st === 'expired') hit.certs_expired++;
    else if (st === 'expiring') hit.certs_expiring++;
  });
  var rows = Object.keys(byEmp).map(function (id) {
    var r = byEmp[id];
    r.grade = perfGrade_(r.attendance_90d, r.attendance_all - r.attendance_90d,
                         r.incidents_major, r.incidents - r.incidents_major,
                         r.certs_expired, r.certs_expiring).grade;
    return r;
  });
  rows.sort(function (a, b) {
    var order = { Active: 0, Pending: 1 };
    var oa = order[a.status] === undefined ? 2 : order[a.status];
    var ob = order[b.status] === undefined ? 2 : order[b.status];
    return oa - ob || a.name.localeCompare(b.name);
  });
  return rows;
}

function staffPerfBoardStored_() {
  var sheet;
  try { sheet = hubTabSheet_(PERF_TABS.board); }
  catch (e) { return null; }
  if (!sheet || sheet.getLastRow() < 2) return null;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  var json = '', computedAt = '';
  for (var r = 0; r < values.length; r++) {
    json += String(values[r][0] == null ? '' : values[r][0]);
    if (!computedAt) computedAt = str_(values[r][1]);
  }
  if (!json) return null;
  try {
    var rows = JSON.parse(json);
    if (!Array.isArray(rows)) return null;
    return { rows: rows, computed_at: computedAt };
  } catch (e2) {
    return null;
  }
}

// Rebuilt only on a dirty mark from a source write, or after the floor that covers hand edits.
var PERF_BOARD_DIRTY_PROP = 'PERF_BOARD_DIRTY';    // _DIRTY: runtime-owned (ScriptProps.gs)
var PERF_BOARD_CURSOR_PROP = 'PERF_BOARD_CURSOR';
var PERF_BOARD_FLOOR_MS = 6 * 60 * 60 * 1000;

// Unique per write, so a write landing during a rebuild is not cleared by it.
function staffPerfBoardDirty_() {
  try {
    hubPropSet_(PERF_BOARD_DIRTY_PROP,
                new Date().toISOString() + '#' + Math.random().toString(36).slice(2, 6));
  } catch (e) {}
}

// Anything unreadable answers yes: recomputing is the cheap mistake.
function staffPerfBoardDue_() {
  if (str_(hubProp_(PERF_BOARD_DIRTY_PROP))) return true;
  var last = Date.parse(str_(hubProp_(PERF_BOARD_CURSOR_PROP))) || 0;
  return !last || (Date.now() - last) >= PERF_BOARD_FLOOR_MS;
}

// Compare-and-clear: a mark stamped mid-build must survive; the cursor moves even when oversize.
function staffPerfBoardMark_(claimed, computedAt) {
  try {
    if (claimed && str_(hubProp_(PERF_BOARD_DIRTY_PROP)) === claimed) {
      hubPropSet_(PERF_BOARD_DIRTY_PROP, '');
    }
    hubPropSet_(PERF_BOARD_CURSOR_PROP, computedAt);
  } catch (e) {}
}

function staffPerfBoardCompute_() {
  var claimed = str_(hubProp_(PERF_BOARD_DIRTY_PROP));
  var rows = staffPerfBoardBuild_();
  var computedAt = new Date().toISOString();
  // Nothing built, nothing cleared: the last good board keeps answering.
  if (!rows) return { rows: 0, computed_at: computedAt, stored: false, migrated: false, kept: true };
  var json = JSON.stringify(rows);
  var chunks = [];
  for (var i = 0; i < json.length; i += PERF_BOARD_CELL_CAP) {
    chunks.push(json.slice(i, i + PERF_BOARD_CELL_CAP));
  }
  var sheet = perfSheet_(PERF_TABS.board);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }
  if (chunks.length > PERF_BOARD_MAX_ROWS) {
    staffPerfBoardMark_(claimed, computedAt);
    return { rows: rows.length, computed_at: computedAt, stored: false, migrated: true };
  }
  var out = chunks.map(function (c, idx) { return [c, idx === 0 ? computedAt : '']; });
  sheet.getRange(2, 1, out.length, 2).setValues(out);
  staffPerfBoardMark_(claimed, computedAt);
  return { rows: rows.length, computed_at: computedAt, stored: true, migrated: true };
}

HUB_POLICY.staffPerfList = {
  file: 'StaffPerformance.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.staffPerfList = function (payload, user) {
  if (!perfIsManager_(user)) return hubDenied_();
  // The read lane never writes the store; staffPerfRecompute fills it.
  var stored = staffPerfBoardStored_();
  if (stored) {
    return { status: 200, data: { rows: stored.rows, migrated: true, computed_at: stored.computed_at } };
  }
  var rows = staffPerfBoardBuild_();
  if (!rows) {
    return { status: 200, data: { rows: [], migrated: false } };
  }
  return { status: 200, data: { rows: rows, migrated: true, computed_at: new Date().toISOString() } };
};

function staffPerfBoardRoute_(action, user) {
  if (String(action) !== 'list') return { status: 400, message: 'Unknown action.' };
  var allowed = (user && user.is_service) || perfIsManager_(user);
  if (!allowed) return hubDenied_();
  var stored = staffPerfBoardStored_();
  if (stored) return { status: 200, data: { rows: stored.rows || [] } };
  return { status: 200, data: { rows: staffPerfBoardBuild_() || [] } };
}

/** Recompute and store the performance board — by hand from the Recompute button, and on the relay's service clock. */
HUB_POLICY.staffPerfRecompute = {
  file: 'StaffPerformance.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['staffPerfBoard'], emits: []
};
HUB_ACTIONS.staffPerfRecompute = function (payload, user) {
  if (!user) return hubDenied_();
  if (!user.is_service && ['admin', 'manager'].indexOf(String(user.role)) === -1) return hubDenied_();
  // The service clock honours marks; a person's press always recomputes.
  if (user.is_service && !staffPerfBoardDue_()) {
    return { status: 200, data: { rows: 0, stored: false, skipped:
             'no perf_* write since the last board and the floor has not run out' } };
  }
  var out = staffPerfBoardCompute_();
  hubSysLog_(str_(user.email), 'staff_perf_recompute',
             out.rows + ' row(s), stored=' + out.stored, { status: 200 });
  return { status: 200, data: out };
};

/* ---------------- THE PERSON, UNIQUE-STYLE ---------------- */

// Shared by the profile and the evaluator so the two never drift.
function staffPerfRecord_(empId) {
  var db = ssOpen_(hubId_('HUB_DB_ID'));
  var staff = perfReadSoft_(db, PERF_TABS.staff).filter(function (s) {
    return str_(s.empid) === empId;
  })[0];
  if (!staff) return { error: { status: 404, message: 'No migrated staff row "' + empId + '".' } };
  var name = str_(staff.name);
  var nameKey = name.toLowerCase();
  var mine = function (r) {
    return str_(r.empid) === empId || str_(r.name).toLowerCase() === nameKey;
  };
  var byDateDesc = function (a, b) {
    return (Date.parse(str_(b.date) || str_(b.createdat)) || 0) -
           (Date.parse(str_(a.date) || str_(a.createdat)) || 0);
  };
  var att = perfReadSoft_(db, PERF_TABS.attendance).filter(mine).sort(byDateDesc);
  var inc = perfReadSoft_(db, PERF_TABS.incidents).filter(mine).sort(byDateDesc);
  var notes = perfReadSoft_(db, PERF_TABS.notes).filter(mine).sort(byDateDesc);
  var certs = perfReadSoft_(db, PERF_TABS.trainings).filter(mine).map(function (r) {
    return { cert: str_(r.cert), expires: str_(r.expires), status: perfCertStatus_(r.expires) };
  });

  var floor90 = Date.now() - 90 * 86400000;
  var att90 = 0;
  att.forEach(function (r) {
    var tt = Date.parse(str_(r.date));
    if (tt && tt >= floor90) att90++;
  });
  var majors = inc.filter(function (r) { return str_(r.severity) === 'Major'; }).length;
  var expired = certs.filter(function (c) { return c.status === 'expired'; }).length;
  var expiring = certs.filter(function (c) { return c.status === 'expiring'; }).length;
  var graded = perfGrade_(att90, att.length - att90, majors, inc.length - majors,
                          expired, expiring);

  // The hash is the record's SHAPE, not its prose: counts and latest dates.
  var hash = ['g2', graded.grade, att.length, inc.length, notes.length, certs.length,
              str_(att[0] && att[0].date), str_(inc[0] && inc[0].date)].join('|');
  var kept = perfReadSoft_(db, PERF_TABS.ai).filter(function (r) {
    return str_(r.empid) === empId;
  })[0] || null;
  return { staff: staff, name: name, att: att, inc: inc, notes: notes,
           certs: certs, graded: graded, hash: hash, kept: kept };
}

/** One staff member's record — facts, rows, the arithmetic grade and the last kept AI paragraph. */
HUB_POLICY.staffPerfProfile = {
  file: 'StaffPerformance.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  params: { emp_id: { required: true, type: 'string' } },
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
// The model never runs here: the relay retries the read lane, re-running any LLM call.
HUB_ACTIONS.staffPerfProfile = function (payload, user) {
  if (!perfIsManager_(user)) return hubDenied_();
  var empId = str_(payload.emp_id);
  if (!empId) return { status: 400, message: 'emp_id is required.' };
  var rec = staffPerfRecord_(empId);
  if (rec.error) return rec.error;
  var kept = rec.kept;
  var summary = kept ? str_(kept.summary) : '';
  var tags = kept ? str_(kept.tags).split('|').filter(String) : [];
  var aiGrade = kept ? str_(kept.grade) : '';
  var hasRows = !!(rec.att.length || rec.inc.length || rec.notes.length || rec.certs.length);
  var aiStale = kept ? (str_(kept.hash) !== rec.hash) : hasRows;

  return { status: 200, data: {
    staff: { emp_id: empId, name: rec.name, status: str_(rec.staff.status),
             phone: str_(rec.staff.phone), email: str_(rec.staff.email),
             hire_date: str_(rec.staff.hiredate), driver: str_(rec.staff.driver),
             hs_diploma: str_(rec.staff.hsdiploma) },
    attendance: rec.att.slice(0, 100).map(function (r) {
      return { date: str_(r.date), kind: str_(r.kind), notes: str_(r.notes), by: str_(r.loggedby) };
    }),
    incidents: rec.inc.slice(0, 60).map(function (r) {
      return { date: str_(r.date), type: str_(r.type), severity: str_(r.severity),
               category: str_(r.category), summary: str_(r.summary),
               action: str_(r.actiontaken), status: str_(r.status) };
    }),
    notes: rec.notes.slice(0, 60).map(function (r) {
      return { at: str_(r.createdat), category: str_(r.category), text: str_(r.text) };
    }),
    certs: rec.certs,
    grade: { value: rec.graded.grade, parts: rec.graded.parts,
             ai: aiGrade !== '' ? parseFloat(aiGrade) : null },
    ai: { summary: summary, tags: tags, made_at: kept ? str_(kept.madeat) : '' },
    ai_stale: aiStale
  } };
};

// Never on SERVICE_SWEEP_ACTIONS: a clocked evaluator burns quota on people nobody reads.
HUB_POLICY.staffPerfEvaluate = {
  file: 'StaffPerformance.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  params: { emp_id: { required: true, type: 'string' },
            refresh: { required: false, type: 'boolean' } },
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.staffPerfEvaluate = function (payload, user) {
  if (!perfIsManager_(user)) return hubDenied_();
  var empId = str_(payload.emp_id);
  if (!empId) return { status: 400, message: 'emp_id is required.' };
  var rec = staffPerfRecord_(empId);
  if (rec.error) return rec.error;
  var kept = rec.kept;
  var wantRefresh = !!(payload && payload.refresh);
  var keptOut = function (fresh, note) {
    return { status: 200, data: {
      summary: kept ? str_(kept.summary) : '',
      tags: kept ? str_(kept.tags).split('|').filter(String) : [],
      grade: kept && str_(kept.grade) !== '' ? parseFloat(str_(kept.grade)) : null,
      made_at: kept ? str_(kept.madeat) : '',
      fresh: !!fresh, note: note || ''
    } };
  };
  if (kept && str_(kept.hash) === rec.hash && !wantRefresh) {
    return keptOut(false, 'the record has not moved since this paragraph');
  }
  var hasRows = !!(rec.att.length || rec.inc.length || rec.notes.length || rec.certs.length);
  if (typeof screenAiChat_ !== 'function' || !hasRows) {
    return keptOut(false, hasRows ? 'no model available' : 'not enough on file');
  }

  var att = rec.att, inc = rec.inc, notes = rec.notes, certs = rec.certs;
  var graded = rec.graded;
  var facts =
    'STAFF: ' + rec.name + ' — status ' + str_(rec.staff.status) +
    (str_(rec.staff.hiredate) ? ', hired ' + str_(rec.staff.hiredate) : '') + '\n' +
    'CALL-OFFS/ATTENDANCE (' + att.length + ' on file, newest first): ' +
    att.slice(0, 12).map(function (r) { return str_(r.date) + ' ' + str_(r.kind); }).join('; ') + '\n' +
    'INCIDENTS (' + inc.length + '): ' +
    inc.slice(0, 8).map(function (r) {
      return str_(r.date) + ' [' + str_(r.type) + '/' + str_(r.severity) + '] ' + str_(r.summary).slice(0, 90);
    }).join(' | ') + '\n' +
    'CERTIFICATIONS: ' + certs.map(function (c) { return c.cert + ' (' + c.status + ')'; }).join(', ') + '\n' +
    'DAILY NOTES (' + notes.length + '): ' +
    notes.slice(0, 6).map(function (r) { return str_(r.text).slice(0, 80); }).join(' | ');
  var rubric =
    'COMPUTED GRADE: ' + graded.grade + '/10, by this arithmetic: start at 10; ' +
    graded.parts.map(function (x) { return x.cut + ' for ' + x.count + ' ' + x.label; }).join('; ') +
    (graded.parts.length ? '.' : ' nothing subtracted.');
  var ask =
    'You EVALUATE a direct support professional for a manager at a company running ' +
    'group homes for adults with developmental disabilities. Using ONLY the facts ' +
    'below — never inventing an event, a date or a trait — return JSON:\n' +
    '1. "summary": 4-6 sentences that ACTUALLY EVALUATE: weigh the attendance pattern ' +
    'against tenure, say whether the incidents are a pattern or noise, name the ' +
    'certification risk, and end with a one-sentence verdict a manager can act on. ' +
    'Never a neutral restatement of the list.\n' +
    '2. "grade": your own 0-10, starting from the computed grade — you may move it ' +
    'up to 1 point either way ONLY with a reason stated in the summary; otherwise ' +
    'repeat the computed number.\n' +
    '3. "tags": 3-6 short chips (5-9 words each) — the standout facts, good and bad.\n\n' +
    rubric + '\n\nFACTS:\n' + facts +
    '\n\nReply with JSON only: {"summary":"...","grade":7.5,"tags":["..."]}';
  var res = null;
  try { res = screenAiChat_(ask, 0.2, 'ai_staff_performance'); } catch (eA) { res = null; }
  if (!res || !res.ok) {
    return keptOut(false, 'the model did not answer — the last paragraph stands');
  }
  var parsed = null;
  try { parsed = JSON.parse(str_(res.content)); } catch (eP) { parsed = null; }
  if (!parsed || !str_(parsed.summary)) {
    return keptOut(false, 'the model answered noise — the last paragraph stands');
  }
  var summary = str_(parsed.summary).slice(0, 1400);
  var tags = (parsed.tags || []).map(function (t) { return str_(t).slice(0, 80); })
    .filter(String).slice(0, 6);
  // The model's grade must be numeric and within one point of the arithmetic.
  var g = parseFloat(parsed.grade);
  var aiGrade = (!isNaN(g) && Math.abs(g - graded.grade) <= 1)
    ? String(Math.max(0, Math.min(10, Math.round(g * 10) / 10)))
    : String(graded.grade);
  var madeAt = new Date().toISOString();
  var aiSheet = perfSheet_(PERF_TABS.ai);
  var values = aiSheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iEmp = hdr.indexOf('empid');
  var wrote = false;
  for (var v = 1; v < values.length; v++) {
    if (str_(values[v][iEmp]) === empId) {
      aiSheet.getRange(v + 1, 1, 1, 7).setValues([[empId, rec.hash, summary, tags.join('|'),
                                                   aiGrade, str_(res.via), madeAt]]);
      wrote = true;
      break;
    }
  }
  if (!wrote) aiSheet.appendRow([empId, rec.hash, summary, tags.join('|'),
                                 aiGrade, str_(res.via), madeAt]);
  return { status: 200, data: { summary: summary, tags: tags,
           grade: parseFloat(aiGrade), made_at: madeAt, fresh: true } };
};

/* ---------------- A MANAGER'S NOTE, ON OUR PAPER ---------------- */

/** Add a manager's note to one staff member's performance record. */
HUB_POLICY.staffPerfNoteAdd = {
  file: 'StaffPerformance.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  params: { emp_id: { required: true, type: 'string' }, text: { required: true, type: 'string' } },
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.staffPerfNoteAdd = function (payload, user) {
  if (!perfIsManager_(user)) return hubDenied_();
  var empId = str_(payload.emp_id);
  var text = str_(payload.text).slice(0, 500);
  if (!empId || !text) return { status: 400, message: 'emp_id and text are required.' };
  var db = ssOpen_(hubId_('HUB_DB_ID'));
  var staff = perfReadSoft_(db, PERF_TABS.staff).filter(function (s) {
    return str_(s.empid) === empId;
  })[0];
  if (!staff) return { status: 404, message: 'No staff row "' + empId + '".' };
  perfSheet_(PERF_TABS.notes).appendRow([empId, str_(staff.name), 'Manager note', text,
                                         'hub:' + str_(user.email), new Date().toISOString(),
                                         new Date().toISOString()]);
  return { status: 200, data: { ok: true } };
};
