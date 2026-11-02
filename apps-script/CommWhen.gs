// Fails by not asking: a missing, stale or unfit window means nobody is asked, never a guessed hour.

var COMM_WHEN_TAB = 'comm_when';

var COMM_WHEN_HEADER = [
  'id', 'createdAt', 'updatedAt',
  'person_key', 'name',
  'state',
  'window_from', 'window_to', 'moment_at',
  'shift_at',
  'only_by_this_rule', 'why',
  'source_at'
];

// Refused on arrival rather than assumed absent: site codes are client addresses, and a second contact list is forbidden.
var COMM_WHEN_REFUSED = ['house', 'shift_code', 'location_code',
                         'address', 'latitude', 'longitude',
                         'consumers', 'num_consumers',
                         'comments', 'notes', 'note', 'shift_raw', 'raw',
                         'phone', 'email'];

var COMM_WHEN_INGEST_CAP = 400;

// Duplicated in the computing module on purpose: a hand-over that moves its own bounds is refused here.
var COMM_WHEN_MAX_MIN = 30;
var COMM_WHEN_MIN_MIN = 5;

// A stale window would make the platform noisier, so an old row dies.
var COMM_WHEN_STALE_H = 6;

// `window_refused` is written only by this file, never declared by a hand-over.
var COMM_WHEN_STATES = ['reachable', 'held', 'spent', 'hours_unknown', 'no_shift'];

var COMM_WHEN_FEED_STAMP = 'COMM_WHEN_FEED_AT';
var COMM_WHEN_FEED_ROWS = 'COMM_WHEN_FEED_ROWS';

function commWhenText_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

// A Date cell is refused, never converted: the offset it lost cannot be recovered and the hour may shift.
function commWhenInstant_(v) {
  var t = commWhenText_(v);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(t)) return '';
  return isFinite(Date.parse(t)) ? t : '';
}

// 0 means "no time in this cell"; no caller may read it as an instant.
function commWhenMs_(iso) {
  var t = commWhenInstant_(iso);
  if (!t) return 0;
  var ms = Date.parse(t);
  return isFinite(ms) ? ms : 0;
}

function commWhenTruthy_(v) {
  if (v === true) return true;
  var t = commWhenText_(v).toLowerCase();
  return t === 'yes' || t === 'true' || t === 'y' || t === '1';
}

// Checked on arrival and again on every read: a house is a spreadsheet anybody can type a wider window into.
function commWhenFits_(fromMs, toMs, shiftMs) {
  if (!fromMs || !toMs || !shiftMs) return false;
  if (toMs <= fromMs) return false;
  return fromMs >= shiftMs - COMM_WHEN_MAX_MIN * 60000 &&
         toMs <= shiftMs - COMM_WHEN_MIN_MIN * 60000;
}

// The same flattening the computation used; never a second minting of the person key.
function commWhenKey_(v) {
  var raw = commWhenText_(v);
  if (!raw) return '';
  try {
    if (typeof clientNameKey_ === 'function') return clientNameKey_(raw);
  } catch (e) { /* the flattening below is the same rule */ }
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Names only: the refused values are never copied anywhere, the log included.
function commWhenCrossed_(rows) {
  var hit = {}, names = [];
  for (var i = 0; i < (rows || []).length; i++) {
    var r = rows[i] || {};
    for (var c = 0; c < COMM_WHEN_REFUSED.length; c++) {
      var name = COMM_WHEN_REFUSED[c];
      if (hit[name]) continue;
      if (Object.prototype.hasOwnProperty.call(r, name)) { hit[name] = true; names.push(name); }
    }
  }
  return names;
}

// An unknown state is dropped: stored, it would match no test anywhere.
function commWhenClean_(r, at) {
  var row = r || {};
  var who = commWhenKey_(row.person_key);
  var state = commWhenText_(row.state).toLowerCase();
  if (!who || COMM_WHEN_STATES.indexOf(state) === -1) return null;

  var from = commWhenInstant_(row.window_from);
  var to = commWhenInstant_(row.window_to);
  var shift = commWhenInstant_(row.shift_at);
  var moment = commWhenInstant_(row.moment_at);
  var claimed = !!(from || to || shift);
  var fits = commWhenFits_(commWhenMs_(from), commWhenMs_(to), commWhenMs_(shift));
  if (!fits) {
    // The row still lands with its window emptied: dropping it would lose a hold that keeps the platform quiet.
    from = ''; to = ''; shift = ''; moment = '';
    if (claimed && state === 'reachable') state = 'window_refused';
  }
  return {
    id: 'CW_' + who.slice(0, 40),
    person_key: who,
    name: commWhenText_(row.name).slice(0, 120),
    state: state,
    window_from: from,
    window_to: to,
    moment_at: moment,
    shift_at: shift,
    only_by_this_rule: commWhenTruthy_(row.only_by_this_rule) ? 'yes' : '',
    why: commWhenText_(row.why).slice(0, 300),
    source_at: commWhenText_(at).slice(0, 40)
  };
}

function commWhenSheet_() {
  return hubTabEnsure_(COMM_WHEN_TAB, COMM_WHEN_HEADER);
}

function commWhenSheetRows_(sheet) {
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

// Always written as text: an ISO instant left to the grid reads back as a Date this house refuses.
function commWhenWrite_(sheet, startRow, lines, width) {
  var range = sheet.getRange(startRow, 1, lines.length, width);
  range.setNumberFormat('@');
  range.setValues(lines);
}

// One row per person; a pass that changes nothing performs zero writes.
function commWhenUpsert_(sheet, incoming, header, values) {
  var col = {};
  for (var h = 0; h < header.length; h++) col[String(header[h])] = h;
  if (col.id === undefined) return { error: 'the comm_when house lacks an "id" column' };

  var at = {};
  for (var r = 1; r < values.length; r++) {
    var id0 = commWhenText_(values[r][col.id]);
    if (id0 && at[id0] === undefined) at[id0] = r;
  }

  var now = new Date().toISOString();
  var out = { inserted: 0, updated: 0, unchanged: 0, appended: [], writes: 0 };
  var changed = {};
  incoming.forEach(function (item) {
    var id = commWhenText_(item.id);
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
      // A key handed over twice in one payload patches its own new line instead of appending another.
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
      if (commWhenText_(cur[col[k]]) !== commWhenText_(v)) { cur[col[k]] = v; touched = true; }
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
    commWhenWrite_(sheet, start + 1, block, header.length);
    out.writes++;
  }
  if (out.appended.length) {
    var first = sheet.getLastRow() + 1;
    var need = first + out.appended.length - 1;
    // setValues never grows the grid; a house minted short would throw.
    if (sheet.getMaxRows() < need) sheet.insertRowsAfter(sheet.getMaxRows(), need - sheet.getMaxRows());
    commWhenWrite_(sheet, first, out.appended, header.length);
    out.writes++;
  }
  return out;
}

// Must stay in SERVICE_SWEEP_ACTIONS (ServiceIdentity.gs), or the relay's write answers 403.
HUB_POLICY.commWhenIngest = {
  file: 'CommWhen.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  params: { rows: { required: true, type: 'array' },
            source_at: { required: false, type: 'string' } },
  roles: ['admin'], service: true,
  invalidates: [], emits: []
};
/** The hand-over: the relay computes the windows, this writes them and refuses any window not 30 to 5 minutes before its shift start. */
HUB_ACTIONS.commWhenIngest = function (payload, user) {
  var isMachine = !!(user && user.is_service);
  if (!isMachine && (!user || String(user.role) !== 'admin')) return hubDenied_();
  var rows = (payload && payload.rows) || [];
  if (!rows.length) {
    return { status: 200, data: { wrote: 0, converged: true, note: 'nothing was handed over' } };
  }

  // One feed at a time: two passes would each append the same missing person.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { status: 409, message: 'The window feed is already running.' };
  try {
    var crossed = commWhenCrossed_(rows);

    // Freshness is the relay's clock, when the calendar was read; this side's only if that stamp is unreadable.
    var at = commWhenInstant_(payload && payload.source_at) || new Date().toISOString();

    var clean = [], seen = {}, refused = 0, unfit = 0, reachable = 0, inQuiet = 0;
    for (var i = 0; i < rows.length && clean.length < COMM_WHEN_INGEST_CAP; i++) {
      var item = commWhenClean_(rows[i], at);
      if (!item) { refused++; continue; }
      if (seen[item.id]) { refused++; continue; }
      seen[item.id] = true;
      if (item.state === 'window_refused') unfit++;
      if (item.state === 'reachable') reachable++;
      if (item.window_from && item.only_by_this_rule) inQuiet++;
      clean.push(item);
    }
    var overflow = Math.max(0, rows.length - refused - clean.length);
    if (!clean.length) {
      return { status: 400, message: 'No usable row — each one needs a person and a known state.' };
    }

    var sheet = commWhenSheet_();
    var read = commWhenSheetRows_(sheet);
    var header = read.header.length ? read.header : ensureHeader_(sheet, COMM_WHEN_HEADER);
    if (!read.values.length) read.values = [header];
    var res = commWhenUpsert_(sheet, clean, header, read.values);
    if (res.error) return { status: 400, message: res.error };

    var moved = res.inserted + res.updated;
    if (moved) { try { cacheBump_(cacheScope_(COMM_WHEN_TAB)); } catch (eB) {} }
    COMM_WHEN_MEMO = null;
    try {
      hubPropSet_(COMM_WHEN_FEED_STAMP, at);
      hubPropSet_(COMM_WHEN_FEED_ROWS, String(Math.max(0, sheet.getLastRow() - 1)));
    } catch (eP) { /* the stamp is a convenience; the rows are the answer */ }

    try {
      if (crossed.length) {
        hubSysLog_('asa-hub:comm', 'comm_when_client_columns_refused', crossed.join(', '),
                   { status: 200,
                     message: 'dropped at the door — a worker\'s window never carries a client' });
      }
      if (moved || overflow || unfit) {
        hubSysLog_('asa-hub:comm', 'comm_when_ingested',
                   res.inserted + ' added, ' + res.updated + ' patched, ' + res.unchanged +
                   ' unchanged — ' + res.writes + ' write(s) · ' + reachable + ' reachable · ' +
                   inQuiet + ' reachable only inside quiet hours' +
                   (unfit ? ' · ' + unfit + ' window(s) outside the ' + COMM_WHEN_MAX_MIN + '-' +
                            COMM_WHEN_MIN_MIN + ' minute bound, emptied' : '') +
                   (overflow ? ' · ' + overflow + ' past the cap, not seen' : ''),
                   { status: 200 });
      }
    } catch (eL) { /* the rows landed either way */ }

    return { status: 200, data: {
      received: rows.length, kept: clean.length, refused: refused, overflow: overflow,
      inserted: res.inserted, updated: res.updated, unchanged: res.unchanged,
      writes: res.writes, converged: moved === 0,
      reachable: reachable, only_by_this_rule: inQuiet, unfit: unfit,
      dropped_columns: crossed, at: at
    } };
  } finally {
    lock.releaseLock();
  }
};

// null means the house did not answer and nobody may be asked; [] means it answered and holds nobody.
var COMM_WHEN_MEMO = null;

function commWhenRows_() {
  if (COMM_WHEN_MEMO) return COMM_WHEN_MEMO.rows;

  var sheet = null;
  try { sheet = hubTabSheet_(COMM_WHEN_TAB); } catch (e) { sheet = null; }
  if (!sheet) {
    return commWhenNoRows_('the ' + COMM_WHEN_TAB + ' house did not answer — it may not be ' +
                           'minted (tools/mint_comm_when_house.py) or its pointer may be unset');
  }

  var read;
  try { read = commWhenSheetRows_(sheet); } catch (e2) { read = null; }
  if (!read || !read.header.length || read.header.indexOf('person_key') === -1) {
    return commWhenNoRows_('the ' + COMM_WHEN_TAB + ' house has no readable header');
  }
  if (!read.rows.length) {
    return commWhenNoRows_('the ' + COMM_WHEN_TAB + ' house is empty — the relay has never ' +
                           'handed a window over');
  }

  var now = new Date().getTime();
  var out = [], stale = 0, unfit = 0;
  for (var i = 0; i < read.rows.length; i++) {
    var r = read.rows[i];
    var who = commWhenKey_(r.person_key);
    if (!who) continue;
    var src = commWhenMs_(r.source_at);
    if (!src || (now - src) > COMM_WHEN_STALE_H * 3600000) { stale++; continue; }

    var state = commWhenText_(r.state).toLowerCase();
    var from = commWhenInstant_(r.window_from);
    var to = commWhenInstant_(r.window_to);
    var shift = commWhenInstant_(r.shift_at);
    if (state === 'reachable' &&
        !commWhenFits_(commWhenMs_(from), commWhenMs_(to), commWhenMs_(shift))) {
      unfit++;
      continue;
    }
    out.push({
      person_key: who,
      name: commWhenText_(r.name),
      state: state,
      window_from: from,
      window_to: to,
      moment_at: commWhenInstant_(r.moment_at),
      shift_at: shift,
      only_by_this_rule: commWhenTruthy_(r.only_by_this_rule),
      why: commWhenText_(r.why)
    });
  }

  if (!out.length && (stale || unfit)) {
    // Every row thrown away is a refusal, never "nobody is reachable".
    return commWhenNoRows_(
      (stale ? stale + ' row(s) not refreshed in ' + COMM_WHEN_STALE_H + 'h — the feed has stopped'
             : '') +
      (stale && unfit ? '; ' : '') +
      (unfit ? unfit + ' row(s) claim a window that does not sit before their own shift' : '') +
      ' (' + COMM_WHEN_TAB + ')');
  }
  COMM_WHEN_MEMO = { rows: out, why: '' };
  return out;
}

function commWhenNoRows_(why) {
  COMM_WHEN_MEMO = { rows: null, why: why };
  return null;
}

function commWhenRefusal_() {
  return (COMM_WHEN_MEMO && COMM_WHEN_MEMO.why) ? String(COMM_WHEN_MEMO.why) : '';
}
