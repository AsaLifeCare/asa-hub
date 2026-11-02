// A missing row is evidence of nothing: never use this record to say someone did not work, dock pay or discipline.
var PSI_PUNCHES_TAB = 'psi_punches';

// Times and hours stay PsiAnywhere's own strings, never recomputed; `date_iso` is the one derived column.
var PSI_PUNCHES_HEADER = [
  'id', 'createdAt', 'updatedAt',
  'single_entry_id', 'status',
  'employee', 'people_id',
  'date_service', 'date_iso', 'start_time', 'end_time', 'hours',
  'work_code',
  'submitted_user', 'supervisor_id',
  'has_signature', 'is_documented', 'evv_reasons',
  'source', 'source_synced_at', 'tenant'
];

// Client data never enters the staff-hours house; dropped on arrival and logged by name.
var PSI_PUNCHES_REFUSED = ['address', 'latitude', 'longitude', 'consumers',
                           'num_consumers', 'comments', 'house', 'raw'];

// Rows past the cap are reported back, never dropped in silence.
var PSI_PUNCHES_INGEST_CAP = 1200;

var PSI_PUNCHES_LIST_CAP = 1000;

var PSI_PUNCHES_FEED_STAMP = 'PSI_PUNCHES_FEED_AT';
var PSI_PUNCHES_FEED_ROWS = 'PSI_PUNCHES_FEED_ROWS';
// WHICH SWITCH WAS ON WHEN THE FEED LAST WROTE.
var PSI_PUNCHES_FEED_SWITCH = 'PSI_PUNCHES_FEED_SWITCH';

// Never created here: a house that is not declared yet is answered as missing.
var PSI_PUNCHES_FULL_TAB = 'psi_punches_full';

// Must match server/psi_punches_full.py HEADER in order (tools/test-psi-punches-sheet.py checks it).
var PSI_PUNCHES_FULL_HEADER = [
  'id', 'createdAt', 'updatedAt',
  'single_entry_id', 'status',
  'employee', 'firstname', 'lastname', 'people_id', 'user_id',
  'date_service', 'date_iso', 'start_time', 'end_time', 'hours',
  'work_code', 'work_code_id', 'supervisor_id',
  'submitted_user', 'submit_date', 'approved_user', 'approved_time',
  'rejected_user', 'rejected_time', 'last_update',
  'transportation_units', 'key_times',
  'location_name', 'house', 'latitude', 'longitude',
  'consumers_present', 'consumers',
  'consumer_1', 'consumer_1_id', 'consumer_1_evv_reason_code', 'consumer_1_has_signature',
  'consumer_1_has_note', 'consumer_1_is_documented',
  'consumer_2', 'consumer_2_id', 'consumer_2_evv_reason_code', 'consumer_2_has_signature',
  'consumer_2_has_note', 'consumer_2_is_documented',
  'consumer_3', 'consumer_3_id', 'consumer_3_evv_reason_code', 'consumer_3_has_signature',
  'consumer_3_has_note', 'consumer_3_is_documented',
  'has_signature', 'is_documented', 'evv_reasons',
  'comments',
  'extra_json',
  'source', 'source_synced_at', 'live_first_seen',
  'tenant'
];

// The relay's batches are 300 and 500.
var PSI_PUNCHES_FULL_CAP = 600;

var PSI_PUNCHES_FULL_TEXT_CAP = 5000;

var PSI_PUNCHES_FULL_FEED_STAMP = 'PSI_PUNCHES_FULL_FEED_AT';

// A cache claim, not the script lock; its TTL frees the door if a pass dies.
var PSI_PUNCHES_FULL_CLAIM_KEY = 'psi_punches_full_running';
var PSI_PUNCHES_FULL_CLAIM_S = 10 * 60;

// Pure half: no sheet, no clock.
function psiPunchesText_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    var t = cellText_(v);
    return t === null ? '' : String(t);
  }
  return String(v).replace(/\s+/g, ' ').trim();
}

// One spelling so a re-feed never looks like a change; absence stays blank.
function psiPunchesFlag_(v) {
  if (v === true) return 'true';
  if (v === false) return 'false';
  var s = psiPunchesText_(v).toLowerCase();
  if (s === '') return '';
  if (s === 'true' || s === 't' || s === 'yes' || s === '1') return 'true';
  if (s === 'false' || s === 'f' || s === 'no' || s === '0') return 'false';
  return '';
}

// Always derived here, never trusted from the wire, so the value cannot flip between passes.
function psiPunchesDateIso_(dateService) {
  var m = psiPunchesText_(dateService).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  var mo = Number(m[1]), da = Number(m[2]);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return '';
  return m[3] + '-' + m[1] + '-' + m[2];
}

function psiPunchesClean_(r, tenant) {
  var row = r || {};
  var key = psiPunchesText_(row.single_entry_id || row.id);
  if (!key) return null;
  var service = psiPunchesText_(row.date_service);
  return {
    id: key.slice(0, 60),
    single_entry_id: key.slice(0, 60),
    status: psiPunchesText_(row.status).slice(0, 12),
    employee: psiPunchesText_(row.employee).slice(0, 120),
    people_id: psiPunchesText_(row.people_id).slice(0, 40),
    date_service: service.slice(0, 40),
    date_iso: psiPunchesDateIso_(service),
    start_time: psiPunchesText_(row.start_time).slice(0, 40),
    // A missing clock-out stays blank; filling it would invent the end of a shift.
    end_time: psiPunchesText_(row.end_time).slice(0, 40),
    hours: psiPunchesText_(row.hours).slice(0, 20),
    work_code: psiPunchesText_(row.work_code).slice(0, 24),
    submitted_user: psiPunchesText_(row.submitted_user).slice(0, 120),
    supervisor_id: psiPunchesText_(row.supervisor_id).slice(0, 40),
    has_signature: psiPunchesFlag_(row.has_signature),
    is_documented: psiPunchesFlag_(row.is_documented),
    evv_reasons: psiPunchesText_(row.evv_reasons).slice(0, 60),
    source: psiPunchesText_(row.source).slice(0, 60) || 'asa_psi_time_entries',
    source_synced_at: psiPunchesText_(row.source_synced_at).slice(0, 40),
    tenant: psiPunchesText_(tenant).slice(0, 60)
  };
}

// Undeclared keys are not carried; the relay folds anything unnamed into `extra_json`.
function psiPunchesFullClean_(r, tenant) {
  var row = r || {};
  var key = psiPunchesText_(row.single_entry_id || row.id);
  if (!key) return null;
  var out = {};
  for (var i = 0; i < PSI_PUNCHES_FULL_HEADER.length; i++) {
    var col = PSI_PUNCHES_FULL_HEADER[i];
    if (col === 'id' || col === 'createdAt' || col === 'updatedAt' ||
        col === 'date_iso' || col === 'tenant') continue;
    out[col] = psiPunchesText_(row[col]).slice(0, PSI_PUNCHES_FULL_TEXT_CAP);
  }
  out.id = key.slice(0, 60);
  out.single_entry_id = key.slice(0, 60);
  out.date_iso = psiPunchesDateIso_(out.date_service);
  out.tenant = psiPunchesText_(tenant).slice(0, 60);
  return out;
}

// The relay proves a pass landed whole by this, not by row counts: an older publish drops new columns silently.
function psiPunchesFullDropped_(rows) {
  var declared = {}, i;
  for (i = 0; i < PSI_PUNCHES_FULL_HEADER.length; i++) declared[PSI_PUNCHES_FULL_HEADER[i]] = true;
  var seen = {}, names = [], list = rows || [];
  var look = Math.min(list.length, 5);
  for (i = 0; i < look && names.length < 40; i++) {
    var r = list[i] || {};
    for (var k in r) {
      if (!Object.prototype.hasOwnProperty.call(r, k) || declared[k] || seen[k]) continue;
      seen[k] = true;
      names.push(String(k).slice(0, 60));
    }
  }
  return names;
}

// Names only; the values are never copied anywhere, the log included.
function psiPunchesCrossed_(rows) {
  var hit = {}, names = [];
  for (var i = 0; i < (rows || []).length; i++) {
    var r = rows[i] || {};
    for (var c = 0; c < PSI_PUNCHES_REFUSED.length; c++) {
      var name = PSI_PUNCHES_REFUSED[c];
      if (hit[name]) continue;
      if (Object.prototype.hasOwnProperty.call(r, name)) { hit[name] = true; names.push(name); }
    }
  }
  return names;
}

function psiPunchesSummary_(rows) {
  var people = {}, hours = 0, open = 0, undocumented = 0;
  for (var i = 0; i < (rows || []).length; i++) {
    var r = rows[i];
    var who = psiPunchesText_(r.people_id) || psiPunchesText_(r.employee);
    if (who) people[who] = true;
    var h = Number(psiPunchesText_(r.hours));
    if (isFinite(h)) hours += h;
    if (!psiPunchesText_(r.end_time)) open++;
    if (psiPunchesText_(r.is_documented) !== 'true') undocumented++;
  }
  var count = 0;
  for (var k in people) { if (Object.prototype.hasOwnProperty.call(people, k)) count++; }
  return { rows: (rows || []).length, people: count,
           hours: Math.round(hours * 100) / 100,
           open_punches: open, undocumented: undocumented };
}

// Sheet half
function psiPunchesSheet_() {
  return hubTabEnsure_(PSI_PUNCHES_TAB, PSI_PUNCHES_HEADER);
}

// null until the depot declares the house: never HUB_DB, never a tab made at an undeclared address.
function psiPunchesFullSheet_() {
  if (!houseMoved_(PSI_PUNCHES_FULL_TAB)) return null;
  return hubTabSheet_(PSI_PUNCHES_FULL_TAB);
}

function psiPunchesRows_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values.length) return { header: [], rows: [], values: [] };
  var header = values[0].map(String);
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var line = values[r], empty = true;
    for (var c = 0; c < line.length; c++) {
      if (line[c] !== '' && line[c] !== null) { empty = false; break; }
    }
    if (empty) continue;
    var obj = { _row: r };
    for (var h = 0; h < header.length; h++) { if (header[h] !== '') obj[header[h]] = line[h]; }
    rows.push(obj);
  }
  return { header: header, rows: rows, values: values };
}

// Text format first, or coerced dates and numbers look changed on every pass and every row is rewritten.
function psiPunchesWrite_(sheet, startRow, lines, width) {
  var range = sheet.getRange(startRow, 1, lines.length, width);
  range.setNumberFormat('@');
  range.setValues(lines);
}

// Never deletes: this house is the only readable copy of the stored rows. An unchanged pass writes nothing.
function psiPunchesUpsert_(sheet, incoming, header, values) {
  var col = {};
  for (var h = 0; h < header.length; h++) col[String(header[h])] = h;
  if (col.id === undefined) return { error: 'the psi_punches house lacks an "id" column' };

  var at = {};
  for (var r = 1; r < values.length; r++) {
    var id0 = psiPunchesText_(values[r][col.id]);
    if (id0 && at[id0] === undefined) at[id0] = r;
  }

  var now = new Date().toISOString();
  var out = { inserted: 0, updated: 0, unchanged: 0, appended: [], writes: 0 };
  var changed = {};
  incoming.forEach(function (item) {
    var id = psiPunchesText_(item.id);
    if (!id) return;
    var row = at[id];
    if (row === undefined) {
      var line = header.map(function () { return ''; });
      line[col.id] = id;
      if (col.createdAt !== undefined) line[col.createdAt] = now;
      if (col.updatedAt !== undefined) line[col.updatedAt] = now;
      Object.keys(item).forEach(function (k) {
        if (k === 'id' || col[k] === undefined) return;
        line[col[k]] = item[k];
      });
      out.appended.push(line);
      out.inserted++;
      at[id] = -(out.appended.length);
      return;
    }
    if (row < 0) {
      var pending = out.appended[-row - 1];
      Object.keys(item).forEach(function (k) {
        if (k === 'id' || k === 'createdAt' || col[k] === undefined) return;
        pending[col[k]] = item[k] === null || item[k] === undefined ? '' : item[k];
      });
      return;
    }
    var cur = values[row], touched = false;
    Object.keys(item).forEach(function (k) {
      if (k === 'id' || k === 'createdAt' || col[k] === undefined) return;
      var v = item[k] === null || item[k] === undefined ? '' : item[k];
      if (psiPunchesText_(cur[col[k]]) !== psiPunchesText_(v)) { cur[col[k]] = v; touched = true; }
    });
    if (touched) {
      if (col.updatedAt !== undefined) cur[col.updatedAt] = now;
      changed[row] = true;
      out.updated++;
    } else out.unchanged++;
  });

  var idxs = [];
  for (var key in changed) {
    if (Object.prototype.hasOwnProperty.call(changed, key)) idxs.push(Number(key));
  }
  idxs.sort(function (a, b) { return a - b; });
  for (var i = 0; i < idxs.length;) {
    var start = idxs[i], end = start;
    while (i + 1 < idxs.length && idxs[i + 1] === end + 1) { i++; end = idxs[i]; }
    i++;
    var block = [];
    for (var rr = start; rr <= end; rr++) block.push(values[rr].slice(0, header.length));
    psiPunchesWrite_(sheet, start + 1, block, header.length);
    out.writes++;
  }
  if (out.appended.length) {
    var first = sheet.getLastRow() + 1;
    var need = first + out.appended.length - 1;
    // setValues never grows the grid.
    if (sheet.getMaxRows() < need) sheet.insertRowsAfter(sheet.getMaxRows(), need - sheet.getMaxRows());
    psiPunchesWrite_(sheet, first, out.appended, header.length);
    out.writes++;
  }
  return out;
}

// Relay only (must stay in SERVICE_SWEEP_ACTIONS); no human write door exists for this evidence.
HUB_POLICY.psiPunchesIngest = {
  file: 'PsiPunches.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  params: { rows: { required: true, type: 'array' } },
  roles: [], service: true,
  invalidates: [], emits: []
};
HUB_ACTIONS.psiPunchesIngest = function (payload, user) {
  if (!user || !user.is_service) return hubDenied_();
  // THE GATE, AND WHY IT ARRIVES OFF EVEN THOUGH THIS DOOR WRITES A LIVE BOOK.
  var punchGate = (typeof hubIngestGate_ === 'function')
    ? hubIngestGate_('gate_psi_punches_ingest',
                     { subject: 'the punches feed', body: 'punch rows written into the live house' })
    : null;
  if (punchGate) return punchGate;
  var rows = (payload && payload.rows) || [];
  if (!rows.length) return { status: 200, data: { wrote: 0, converged: true, note: 'nothing was handed over' } };

  // Two concurrent passes would each append the same missing row.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { status: 409, message: 'The punch feed is already running.' };
  try {
    var crossed = psiPunchesCrossed_(rows);

    var tenant = '';
    try { tenant = tenantStamp_(); } catch (eT) { tenant = ''; }

    var clean = [], seen = {}, refused = 0;
    for (var i = 0; i < rows.length && clean.length < PSI_PUNCHES_INGEST_CAP; i++) {
      var item = psiPunchesClean_(rows[i], tenant);
      if (!item) { refused++; continue; }
      if (seen[item.id]) { refused++; continue; }
      seen[item.id] = true;
      clean.push(item);
    }
    var overflow = Math.max(0, rows.length - refused - clean.length);
    if (!clean.length) {
      return { status: 400, message: 'No usable row — each one needs a single_entry_id.' };
    }

    var sheet = psiPunchesSheet_();
    var read = psiPunchesRows_(sheet);
    var header = read.header.length ? read.header : ensureHeader_(sheet, PSI_PUNCHES_HEADER);
    if (!read.values.length) read.values = [header];
    var res = psiPunchesUpsert_(sheet, clean, header, read.values);
    if (res.error) return { status: 400, message: res.error };

    var moved = res.inserted + res.updated;
    if (moved) { try { cacheBump_(cacheScope_(PSI_PUNCHES_TAB)); } catch (eB) {} }
    var at = new Date().toISOString();
    try {
      hubPropSet_(PSI_PUNCHES_FEED_STAMP, at);
      hubPropSet_(PSI_PUNCHES_FEED_ROWS, String(Math.max(0, sheet.getLastRow() - 1)));
      hubPropSet_(PSI_PUNCHES_FEED_SWITCH,
                  (typeof hubSwitchWord_ === 'function' ? hubSwitchWord_() : '') + ' @ ' + at);
    } catch (eP) { /* the stamp is a convenience; the rows are the record */ }

    try {
      if (crossed.length) {
        hubSysLog_('asa-hub:psi', 'psi_punches_client_columns_refused',
                   crossed.join(', '),
                   { status: 200, message: 'dropped at the door — a staff-hours house never carries client data' });
      }
      if (moved || overflow) {
        hubSysLog_('asa-hub:psi', 'psi_punches_ingested',
                   res.inserted + ' added, ' + res.updated + ' patched, ' +
                   res.unchanged + ' unchanged — ' + res.writes + ' write(s)' +
                   (overflow ? ' · ' + overflow + ' past the cap, not seen' : ''),
                   { status: 200 });
      }
    } catch (eL) { /* the rows landed either way */ }

    return { status: 200, data: {
      received: rows.length, kept: clean.length, refused: refused, overflow: overflow,
      inserted: res.inserted, updated: res.updated, unchanged: res.unchanged,
      writes: res.writes, converged: moved === 0,
      dropped_columns: crossed, at: at
    } };
  } finally {
    lock.releaseLock();
  }
};

// Every answer carries `caveat`: without it the numbers read as an attendance report, which they are not.
HUB_POLICY.psiPunchesList = {
  file: 'PsiPunches.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: {
    person: { required: false, type: 'string' },
    people_id: { required: false, type: 'string' },
    from: { required: false, type: 'string' },
    to: { required: false, type: 'string' },
    work_code: { required: false, type: 'string' },
    limit: { required: false, type: 'number' },
    offset: { required: false, type: 'number' }
  },
  invalidates: [], emits: []
};
HUB_ACTIONS.psiPunchesList = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var p = payload || {};
  var caveat = 'A row is evidence that a punch was filed. A missing row is evidence of nothing — ' +
               'PsiAnywhere was habitually not filled in, and this record cannot show that somebody did not work.';

  var read;
  try { read = psiPunchesRows_(psiPunchesSheet_()); }
  catch (e) {
    return { status: 200, data: { rows: [], total: 0, shown: 0, read_only: true,
                                  frozen: false, caveat: caveat,
                                  note: 'The punch house has not been fed yet.' } };
  }

  var person = psiPunchesText_(p.person).toLowerCase();
  var peopleId = psiPunchesText_(p.people_id);
  var from = psiPunchesText_(p.from), to = psiPunchesText_(p.to);
  var code = psiPunchesText_(p.work_code).toUpperCase();

  var kept = read.rows.filter(function (r) {
    if (person && psiPunchesText_(r.employee).toLowerCase().indexOf(person) === -1) return false;
    if (peopleId && psiPunchesText_(r.people_id) !== peopleId) return false;
    if (code && psiPunchesText_(r.work_code).toUpperCase() !== code) return false;
    // A row whose date never parsed is kept out of a window, not counted inside it.
    var iso = psiPunchesText_(r.date_iso);
    if (from && (!iso || iso < from)) return false;
    if (to && (!iso || iso > to)) return false;
    return true;
  });

  var summary = psiPunchesSummary_(kept);
  kept.sort(function (a, b) {
    var da = psiPunchesText_(a.date_iso), db = psiPunchesText_(b.date_iso);
    if (da !== db) return da < db ? 1 : -1;
    return psiPunchesText_(a.employee) < psiPunchesText_(b.employee) ? -1 : 1;
  });

  var offset = Math.max(0, Math.floor(Number(p.offset) || 0));
  var limit = Math.floor(Number(p.limit) || 200);
  if (!(limit > 0)) limit = 200;
  if (limit > PSI_PUNCHES_LIST_CAP) limit = PSI_PUNCHES_LIST_CAP;

  var page = kept.slice(offset, offset + limit).map(function (r) {
    return { id: psiPunchesText_(r.id), single_entry_id: psiPunchesText_(r.single_entry_id),
             status: psiPunchesText_(r.status),
             employee: psiPunchesText_(r.employee), people_id: psiPunchesText_(r.people_id),
             date_service: psiPunchesText_(r.date_service), date_iso: psiPunchesText_(r.date_iso),
             start_time: psiPunchesText_(r.start_time), end_time: psiPunchesText_(r.end_time),
             hours: psiPunchesText_(r.hours), work_code: psiPunchesText_(r.work_code),
             submitted_user: psiPunchesText_(r.submitted_user),
             supervisor_id: psiPunchesText_(r.supervisor_id),
             has_signature: psiPunchesText_(r.has_signature),
             is_documented: psiPunchesText_(r.is_documented),
             evv_reasons: psiPunchesText_(r.evv_reasons),
             source: psiPunchesText_(r.source), source_synced_at: psiPunchesText_(r.source_synced_at) };
  });

  var fedAt = '';
  try { fedAt = str_(hubProp_(PSI_PUNCHES_FEED_STAMP)); } catch (eS) { fedAt = ''; }

  return { status: 200, data: {
    rows: page, shown: page.length, total: kept.length, held: read.rows.length,
    offset: offset, limit: limit, summary: summary,
    read_only: true, frozen: false,
    source: 'asa_psi_time_entries (the stored copy, to 2026-08-14) + psianywhere_live (the relay\'s reads)',
    confirmed_at: fedAt, caveat: caveat
  } };
};

// Relay only, like psiPunchesIngest; a missing house answers 409 `missing_tab` and is never made here.
HUB_POLICY.psiPunchesFullIngest = {
  file: 'PsiPunches.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  params: { rows: { required: true, type: 'array' } },
  roles: [], service: true,
  invalidates: [], emits: []
};
HUB_ACTIONS.psiPunchesFullIngest = function (payload, user) {
  if (!user || !user.is_service) return hubDenied_();
  var rows = (payload && payload.rows) || [];
  if (!rows.length) return { status: 200, data: { wrote: 0, converged: true, note: 'nothing was handed over' } };

  // The script lock guards only the claim: held across the pass it would stall every writer on the platform.
  var fullClaim = null;
  try { fullClaim = CacheService.getScriptCache(); } catch (eCc) { fullClaim = null; }
  var fullMine = false;
  var fullLock = null;
  try { fullLock = LockService.getScriptLock(); } catch (eLk) { fullLock = null; }
  if (fullLock && fullLock.tryLock(2000)) {
    try {
      var fullRunning = null;
      try { fullRunning = fullClaim && fullClaim.get(PSI_PUNCHES_FULL_CLAIM_KEY); }
      catch (eCg) { fullRunning = null; }
      if (!fullRunning) {
        fullMine = true;
        try {
          if (fullClaim) fullClaim.put(PSI_PUNCHES_FULL_CLAIM_KEY, String(new Date().getTime()),
                                       PSI_PUNCHES_FULL_CLAIM_S);
        } catch (eCp) { /* the pass still runs */ }
      }
    } finally {
      try { fullLock.releaseLock(); } catch (eRl0) { /* gone with the execution */ }
    }
  } else if (!fullLock) {
    fullMine = true;
  }
  if (!fullMine) return { status: 409, message: 'The full punch feed is already running.' };
  try {
    var sheet = psiPunchesFullSheet_();
    if (!sheet) {
      return { status: 409,
               message: 'The ' + PSI_PUNCHES_FULL_TAB + ' house is not declared yet — mint it ' +
                        '(tools/mint_psi_punches_full_house.py).',
               data: { missing_tab: true } };
    }

    var tenant = '';
    try { tenant = tenantStamp_(); } catch (eT) { tenant = ''; }

    var clean = [], seen = {}, refused = 0;
    for (var i = 0; i < rows.length && clean.length < PSI_PUNCHES_FULL_CAP; i++) {
      var item = psiPunchesFullClean_(rows[i], tenant);
      if (!item) { refused++; continue; }
      if (seen[item.id]) { refused++; continue; }
      seen[item.id] = true;
      clean.push(item);
    }
    var overflow = Math.max(0, rows.length - refused - clean.length);
    if (!clean.length) {
      return { status: 400, message: 'No usable row — each one needs a single_entry_id.' };
    }

    var header = ensureHeader_(sheet, PSI_PUNCHES_FULL_HEADER);
    var read = psiPunchesRows_(sheet);
    if (!read.values.length) read.values = [header];
    var res = psiPunchesUpsert_(sheet, clean, header, read.values);
    if (res.error) return { status: 400, message: res.error };

    var moved = res.inserted + res.updated;
    var at = new Date().toISOString();
    try { hubPropSet_(PSI_PUNCHES_FULL_FEED_STAMP, at); } catch (eP) { /* the rows are the record */ }
    try {
      if (moved || overflow) {
        hubSysLog_('asa-hub:psi', 'psi_punches_full_ingested',
                   res.inserted + ' added, ' + res.updated + ' patched, ' +
                   res.unchanged + ' unchanged — ' + res.writes + ' write(s)' +
                   (overflow ? ' · ' + overflow + ' past the cap, not seen' : ''),
                   { status: 200 });
      }
    } catch (eL) { /* the rows landed either way */ }

    return { status: 200, data: {
      received: rows.length, kept: clean.length, refused: refused, overflow: overflow,
      inserted: res.inserted, updated: res.updated, unchanged: res.unchanged,
      writes: res.writes, converged: moved === 0, at: at,
      columns: PSI_PUNCHES_FULL_HEADER.length, dropped: psiPunchesFullDropped_(rows)
    } };
  } finally {
    if (fullMine && fullClaim) {
      try { fullClaim.remove(PSI_PUNCHES_FULL_CLAIM_KEY); } catch (eRl) { /* the window expires on its own */ }
    }
  }
};
