// ------------------------------------------------------------------ COMM CORTEX — the window and the supervisor…
// The cortex holds 77,997 entity facts in Postgres, which Apps Script cannot read — so the arithmetic happens in…

// The name is older than the meaning.
var COMM_ROUTES_TAB = 'comm_routes';

var COMM_ROUTES_HEADER = [
  'id', 'createdAt', 'updatedAt',
  'person_key', 'name',
  /* the hours their own shifts say they are awake, and where that came from */
  'window_from', 'window_to', 'window_why',
  // WHO THE GRAPH THINKS WOULD BE TOLD.
  'supervisor', 'supervisor_key', 'supervisor_confidence',
  'source_at'
];

// THE COLUMNS THIS HOUSE NO LONGER CARRIES (see the header).
var COMM_ROUTES_RETIRED = ['phone', 'email', 'phones_known', 'emails_known'];

// THE HAND-OFF.
HUB_POLICY.commRoutesIngest = {
  file: 'CommCortex.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  params: { rows: { required: true, type: 'array' } },
  roles: [], service: true,
  invalidates: [], emits: []
};
HUB_ACTIONS.commRoutesIngest = function (payload, user) {
  // THE RELAY, AND NOBODY ELSE.
  if (!user || !user.is_service) return hubDenied_();
  var rows = (payload && payload.rows) || [];
  if (!rows.length) return { status: 200, data: { wrote: 0, note: 'nothing was handed over' } };

  var sheet = hubTabEnsure_(COMM_ROUTES_TAB, COMM_ROUTES_HEADER);
  // before anything lands: the retired columns are emptied, including on the rows this pass will not touch at all
  var cleared = commRoutesRetireContacts_(sheet);
  var refused = 0;
  var at = str_(payload.source_at) || new Date().toISOString();
  // THE WHOLE SET IS SHAPED FIRST AND WRITTEN ONCE — see commRoutesUpsertMany_ for why a row at a time could not…
  var lines = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    var who = str_(r.person_key).toLowerCase();
    var from = commRoutesHour_(r.window_from);
    var to = commRoutesHour_(r.window_to);
    var boss = str_(r.supervisor);
    // A ROW PROPOSING NEITHER A WINDOW NOR A SUPERVISOR PROPOSES NOTHING, and a row of nothing per person is how a…
    if (!who || ((from === '' || to === '') && !boss)) { refused++; continue; }
    lines.push({
      id: 'RT_' + who.slice(0, 40),
      person_key: who,
      name: str_(r.name),
      window_from: from,
      window_to: to,
      window_why: str_(r.window_why),
      // THE GRAPH'S SUGGESTION, WITH ITS CONFIDENCE BESIDE IT.
      supervisor: boss,
      supervisor_key: str_(r.supervisor_key),
      supervisor_confidence: str_(r.supervisor_confidence),
      source_at: at
    });
  }
  // A READ THAT REFUSES MUST NOT COST THE HAND-OFF EITHER.
  var landed;
  try {
    landed = commRoutesUpsertMany_(sheet, lines);
  } catch (e) {
    landed = commRoutesOneByOne_(sheet, lines);
  }
  var wrote = landed.wrote;
  refused += landed.refused;
  try {
    hubSysLog_('asa-hub:comm', 'comm_routes_ingested',
               wrote + ' route(s) · ' + refused + ' refused' +
               (cleared ? ' · ' + cleared + ' retired contact cell(s) emptied' : ''),
               { status: 200 });
  } catch (eL) { /* written either way */ }
  return { status: 200, data: { wrote: wrote, refused: refused, cleared: cleared } };
};

// AN HOUR OFF THE WIRE, or ''.
function commRoutesHour_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(v);
  if (!isFinite(n) || n < 0 || n > 23) return '';
  return String(Math.floor(n));
}

// HOLD THE RETIRED COLUMNS EMPTY.
function commRoutesRetireContacts_(sheet) {
  var cleared = 0;
  try {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return 0;
    var header = headerOf_(sheet);
    for (var i = 0; i < COMM_ROUTES_RETIRED.length; i++) {
      var col = header.indexOf(COMM_ROUTES_RETIRED[i]);
      if (col === -1) continue;
      var range = sheet.getRange(2, col + 1, lastRow - 1, 1);
      var values = range.getValues();
      var blanks = [], dirty = 0;
      for (var r = 0; r < values.length; r++) {
        if (str_(values[r][0]) !== '') dirty++;
        blanks.push(['']);
      }
      if (!dirty) continue;                 /* nothing to undo: write nothing */
      range.setValues(blanks);
      cleared += dirty;
    }
  } catch (e) { /* a column that will not empty must not stop the routes landing */ }
  return cleared;
}

// One row, by id, through the one door.
function commRoutesUpsert_(sheet, row) {
  var found = findRowIndex_(sheet, row.id);
  row.updatedAt = new Date().toISOString();
  if (!found) {
    row.createdAt = row.updatedAt;
  } else {
    // THE DAY THIS PERSON FIRST APPEARED IS NOT THIS PASS'S TO FORGET.
    var made = headerOf_(sheet).indexOf('createdAt');
    if (made !== -1) row.createdAt = sheet.getRange(found, made + 1, 1, 1).getValue();
  }
  var header = ensureHeader_(sheet, Object.keys(row));
  var line = header.map(function (h) { return serialize_(row[h]); });
  if (found) sheet.getRange(found, 1, 1, header.length).setValues([line]);
  else sheet.appendRow(line);
}

// THE WHOLE SET, BY id, IN A HANDFUL OF CALLS INSTEAD OF THOUSANDS.
function commRoutesUpsertMany_(sheet, rows) {
  if (!rows || !rows.length) return { wrote: 0, refused: 0 };
  var stamp = new Date().toISOString();

  // ONE READ of everything the tab holds.
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var grid = (lastRow >= 1 && lastCol >= 1)
    ? sheet.getRange(1, 1, lastRow, lastCol).getValues() : [];
  var header = (grid.length ? grid[0] : []).map(String)
    .filter(function (h) { return h !== ''; });

  // every column any row of this pass names, appended once — the same law as ensureHeader_, paid for once instead…
  var missing = [];
  for (var i = 0; i < rows.length; i++) {
    for (var key in rows[i]) {
      if (!Object.prototype.hasOwnProperty.call(rows[i], key)) continue;
      if (header.indexOf(key) === -1 && missing.indexOf(key) === -1) missing.push(key);
    }
  }
  if (missing.indexOf('createdAt') === -1 && header.indexOf('createdAt') === -1) {
    missing.push('createdAt');
  }
  if (missing.indexOf('updatedAt') === -1 && header.indexOf('updatedAt') === -1) {
    missing.push('updatedAt');
  }
  if (missing.length) {
    header = header.concat(missing);
    try {
      sheet.getRange(1, 1, 1, header.length).setValues([header]);
    } catch (e) {
      // WITHOUT A HEADER NOTHING CAN BE SHAPED, so the whole set goes back to the slow path — which writes its own…
      return commRoutesOneByOne_(sheet, rows);
    }
  }

  var idCol = header.indexOf('id');
  var madeCol = header.indexOf('createdAt');
  // id → the 1-based sheet row it is on.
  var where = {};
  if (idCol !== -1) {
    for (var r = 1; r < grid.length; r++) {
      var id = String((grid[r] || [])[idCol] === undefined ? '' : grid[r][idCol]);
      if (id !== '' && !Object.prototype.hasOwnProperty.call(where, id)) where[id] = r + 1;
    }
  }

  var wrote = 0, refused = 0;
  var updates = [];      /* [sheet row, line, the row itself] for the ones already there */
  var appends = [];      /* the lines for everybody new */
  var appendRows = [];   /* and those rows themselves, for the slow path */
  for (var n = 0; n < rows.length; n++) {
    var row = rows[n];
    var rid = String(row.id === undefined || row.id === null ? '' : row.id);
    if (!rid) { refused++; continue; }
    var at = Object.prototype.hasOwnProperty.call(where, rid) ? where[rid] : 0;
    row.updatedAt = stamp;
    if (!at) {
      row.createdAt = stamp;
    } else if (madeCol !== -1) {
      // THE DAY THIS PERSON FIRST APPEARED IS NOT THIS PASS'S TO FORGET — carried forward out of the grid already…
      var was = (grid[at - 1] || [])[madeCol];
      row.createdAt = (was === undefined || was === null || was === '') ? stamp : was;
    }
    var line = header.map(function (h) { return serialize_(row[h]); });
    if (at) updates.push([at, line, row]); else { appends.push(line); appendRows.push(row); }
    wrote++;
  }

  // CONTIGUOUS RUNS, one setValues each.
  updates.sort(function (a, b) { return a[0] - b[0]; });
  var start = 0;
  while (start < updates.length) {
    var end = start;
    while (end + 1 < updates.length && updates[end + 1][0] === updates[end][0] + 1) end++;
    var block = [];
    var backing = [];
    for (var b = start; b <= end; b++) { block.push(updates[b][1]); backing.push(updates[b][2]); }
    try {
      sheet.getRange(updates[start][0], 1, block.length, header.length).setValues(block);
    } catch (e) {
      var lost = commRoutesEach_(sheet, backing);
      wrote -= lost;
      refused += lost;
    }
    start = end + 1;
  }
  if (appends.length) {
    try {
      sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, header.length)
        .setValues(appends);
    } catch (e) {
      var lostNew = commRoutesEach_(sheet, appendRows);
      wrote -= lostNew;
      refused += lostNew;
    }
  }
  return { wrote: wrote, refused: refused };
}

// The rows of a run that would not go in one call, written one at a time through the slow path → how many of them…
function commRoutesEach_(sheet, rows) {
  var lost = 0;
  for (var i = 0; i < rows.length; i++) {
    try { commRoutesUpsert_(sheet, rows[i]); } catch (e) { lost++; }
  }
  return lost;
}

// The whole set the slow way, for the one case the batch cannot start at all: a header that would not be written.
function commRoutesOneByOne_(sheet, rows) {
  var wrote = 0, refused = 0;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i] || {};
    var rid = String(row.id === undefined || row.id === null ? '' : row.id);
    if (!rid) { refused++; continue; }
    try { commRoutesUpsert_(sheet, row); wrote++; } catch (e) { refused++; }
  }
  return { wrote: wrote, refused: refused };
}

// WHAT THE CORTEX OFFERS FOR ONE PERSON — their window and their suggested supervisor — or nothing.
function commRouteOf_(personKey) {
  var who = String(personKey || '').trim().toLowerCase();
  if (!who) return null;
  var sheet;
  try { sheet = hubTabSheet_(COMM_ROUTES_TAB); } catch (e) { return null; }
  if (!sheet) return null;
  var values;
  try { values = sheet.getDataRange().getValues(); } catch (e2) { return null; }
  if (!values || values.length < 2) return null;
  var header = values[0].map(String);
  var at = header.indexOf('person_key');
  if (at === -1) return null;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][at] || '').trim().toLowerCase() !== who) continue;
    var row = {};
    for (var c = 0; c < header.length; c++) row[header[c]] = values[r][c];
    return row;
  }
  return null;
}

// THE HOURS THIS PERSON MAY BE SPOKEN TO — the platform's window, NARROWED by what the cortex knows and never…
function commCortexWindow_(personKey, floorFrom, floorTo) {
  return commCortexWindowFrom_(commRouteOf_(personKey), floorFrom, floorTo, personKey);
}

// The same narrowing, from a route row already in hand — a sweep reads the house once and asks this sixty times…
function commCortexWindowFrom_(route, floorFrom, floorTo, personKey) {
  var quietFrom = Number(floorFrom);
  var quietTo = Number(floorTo);
  var who = str_(personKey).toLowerCase() ||
            (route ? String(route.person_key || '').trim().toLowerCase() : '');
  var nowMs = new Date().getTime();
  var reach = who ? commReachOf_(who) : null;

  // THE HOLD COMES FIRST, AND IT OUTRANKS EVERY WINDOW BELOW IT.
  var hold = commReachHoldMs_(reach, nowMs);
  if (hold) {
    return { from: 0, to: 24, hold_until_ms: hold,
             why: 'they are not at work today, held until ' + commReachClock_(hold, true) +
                  ' — ' + (str_(reach.why) || 'a call-off the platform already holds') };
  }

  var quiet;
  if (!route) {
    quiet = { from: quietFrom, to: quietTo, why: 'the platform default' };
  } else {
    var from = String(route.window_from || '');
    var to = String(route.window_to || '');
    if (from === '' || to === '') {
      quiet = { from: quietFrom, to: quietTo,
                why: 'the cortex holds no shift for them — the default stands' };
    } else {
      // The cortex says awake between `from` and `to`; the platform says quiet between quietFrom and quietTo.
      var awakeFrom = Number(from), awakeTo = Number(to);
      var nextQuietTo = Math.max(quietTo, awakeFrom);     // quiet later in the morning
      var nextQuietFrom = Math.min(quietFrom, awakeTo);   // quiet earlier in the evening
      quiet = { from: nextQuietFrom, to: nextQuietTo,
                why: 'narrowed by their own shifts: ' + String(route.window_why || '') };
    }
  }

  // AND THE PASS RIDES ALONG, never inside the pair.
  var pass = commReachPass_(reach, nowMs);
  if (pass) quiet.pass = pass;
  return quiet;
}

// ------------------------------------------------------------------ THE REACH HOUSE — the minutes before a shift…
var COMM_REACH_TAB = 'comm_reach';

var COMM_REACH_HEADER = [
  'id', 'createdAt', 'updatedAt',
  'person_key', 'name', 'state',
  /* the pass, as text for whoever reads the house … */
  'window_from', 'window_to', 'moment_at', 'shift_at', 'shift_code', 'house',
  // … and as instants for the code that has to be right about it.
  'window_from_ms', 'window_to_ms', 'shift_at_ms',
  /* the day a call-off closed, the same two ways */
  'hold_until', 'hold_until_ms',
  // TRUE when this window only exists because of the shift-pass rule — i.e. it sits inside the platform's quiet…
  'only_by_this_rule',
  // how many further moments the week still holds for them, and the sentence that says WHY in words a person can…
  'moments_ahead', 'reach_anyway', 'why',
  'source_at', 'source_ms'
];

// THE BOUNDS, AND THEY LIVE ON THIS SIDE.
var COMM_REACH_MAX_MIN = 30;
var COMM_REACH_MIN_MIN = 5;

// HOW OLD A ROW MAY BE AND STILL GRANT A PASS.
var COMM_REACH_PASS_STALE_H = 6;

// THE STATES THE HAND-OFF MAY DECLARE.
var COMM_REACH_STATES = ['reachable', 'held', 'spent', 'hours_unknown', 'no_shift'];

// THE HAND-OFF.
HUB_POLICY.commReachIngest = {
  file: 'CommCortex.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  params: { rows: { required: true, type: 'array' } },
  roles: [], service: true,
  invalidates: [], emits: []
};
HUB_ACTIONS.commReachIngest = function (payload, user) {
  // THE RELAY, AND NOBODY ELSE.
  if (!user || !user.is_service) return hubDenied_();
  var rows = (payload && payload.rows) || [];
  if (!rows.length) return { status: 200, data: { wrote: 0, note: 'nothing was handed over' } };

  var sheet = hubTabEnsure_(COMM_REACH_TAB, COMM_REACH_HEADER);
  // WHOSE CLOCK SAYS HOW OLD THIS IS.
  var sourceMs = commReachMs_(payload && payload.source_at) || new Date().getTime();
  var at = str_(payload && payload.source_at) || new Date(sourceMs).toISOString();
  var wrote = 0, refused = 0, unfit = 0, holds = 0, inQuiet = 0;

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    var who = str_(r.person_key).toLowerCase();
    var state = str_(r.state).toLowerCase();
    // A ROW WITHOUT A PERSON, OR WITH A STATE THIS SIDE DOES NOT KNOW, IS NOT A ROW.
    if (!who || COMM_REACH_STATES.indexOf(state) === -1) { refused++; continue; }

    var fromMs = commReachMs_(r.window_from);
    var toMs = commReachMs_(r.window_to);
    var shiftMs = commReachMs_(r.shift_at);
    var claimed = !!(fromMs || toMs || shiftMs);
    if (!commReachFits_(fromMs, toMs, shiftMs)) {
      // A WINDOW THAT DOES NOT FIT IS EMPTIED, AND THE ROW STILL LANDS.
      if (claimed) { unfit++; if (state === 'reachable') state = 'window_refused'; }
      fromMs = 0; toMs = 0; shiftMs = 0;
    }
    var holdMs = commReachMs_(r.hold_until);
    if (holdMs) holds++;
    if (fromMs && commReachTruthy_(r.only_by_this_rule)) inQuiet++;

    try {
      // The same one door the routes house writes through: by id, createdAt carried forward, every column of the…
      commRoutesUpsert_(sheet, {
        id: 'RH_' + who.slice(0, 40),
        person_key: who,
        name: str_(r.name),
        state: state,
        window_from: fromMs ? str_(r.window_from) : '',
        window_to: fromMs ? str_(r.window_to) : '',
        moment_at: fromMs ? str_(r.moment_at) : '',
        shift_at: fromMs ? str_(r.shift_at) : '',
        shift_code: str_(r.shift_code),
        house: str_(r.house),
        window_from_ms: fromMs || '',
        window_to_ms: toMs || '',
        shift_at_ms: shiftMs || '',
        hold_until: holdMs ? str_(r.hold_until) : '',
        hold_until_ms: holdMs || '',
        only_by_this_rule: commReachTruthy_(r.only_by_this_rule) ? 'yes' : '',
        moments_ahead: str_(r.moments_ahead),
        reach_anyway: commReachTruthy_(r.reach_anyway) ? 'yes' : '',
        why: str_(r.why),
        source_at: at,
        source_ms: sourceMs
      });
      wrote++;
    } catch (e) { refused++; }
  }
  /* The house just moved under whatever else this execution is doing. */
  COMM_REACH_MEMO = null;
  try {
    hubSysLog_('asa-hub:comm', 'comm_reach_ingested',
               wrote + ' person(s) · ' + refused + ' refused · ' + unfit +
               ' window(s) outside the ' + COMM_REACH_MAX_MIN + '-' + COMM_REACH_MIN_MIN +
               ' minute bound · ' + holds + ' held · ' + inQuiet +
               ' reachable only inside quiet hours',
               { status: 200 });
  } catch (eL) { /* written either way */ }
  return { status: 200, data: { wrote: wrote, refused: refused, unfit: unfit,
                                holds: holds, only_by_this_rule: inQuiet } };
};

// AN INSTANT OFF THE WIRE OR OFF A CELL → milliseconds, or 0.
function commReachMs_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) && v > 0 ? Math.floor(v) : 0;
  var text = str_(v);
  if (!text) return 0;
  /* a number that came back out of a cell as text */
  if (/^\d{10,16}$/.test(text)) return Math.floor(Number(text));
  var ms = new Date(text).getTime();
  return isFinite(ms) ? ms : 0;
}

// A cell or a wire value that means yes.
function commReachTruthy_(v) {
  if (v === true) return true;
  var t = str_(v).toLowerCase();
  return t === 'yes' || t === 'true' || t === 'y' || t === '1';
}

// DOES THIS WINDOW FIT THE SHIFT IT CLAIMS?
function commReachFits_(fromMs, toMs, shiftMs) {
  if (!fromMs || !toMs || !shiftMs) return false;
  if (toMs <= fromMs) return false;
  var opens = shiftMs - COMM_REACH_MAX_MIN * 60000;
  var closes = shiftMs - COMM_REACH_MIN_MIN * 60000;
  return fromMs >= opens && toMs <= closes;
}

// The house, read once per execution and answered from memory after that — a sweep asks this sixty times and a…
var COMM_REACH_MEMO = null;
function commReachRows_() {
  if (COMM_REACH_MEMO) return COMM_REACH_MEMO;
  var map = {};
  try {
    var sheet = hubTabSheet_(COMM_REACH_TAB);
    if (sheet) {
      var values = sheet.getDataRange().getValues();
      if (values && values.length > 1) {
        var header = values[0].map(String);
        var at = header.indexOf('person_key');
        if (at !== -1) {
          for (var r = 1; r < values.length; r++) {
            var who = String(values[r][at] || '').trim().toLowerCase();
            if (!who) continue;
            var row = {};
            for (var c = 0; c < header.length; c++) row[header[c]] = values[r][c];
            map[who] = row;
          }
        }
      }
    }
  } catch (e) { map = {}; }
  COMM_REACH_MEMO = map;
  return map;
}

/** What the reach house holds for one person, or null. */
function commReachOf_(personKey) {
  var who = String(personKey || '').trim().toLowerCase();
  if (!who) return null;
  return commReachRows_()[who] || null;
}

// IS THIS PERSON HELD, AND UNTIL WHEN — the instant, or 0.
function commReachHoldMs_(reach, nowMs) {
  if (!reach) return 0;
  var hold = commReachMs_(reach.hold_until_ms) || commReachMs_(reach.hold_until);
  if (!hold) return 0;
  var now = Number(nowMs) || new Date().getTime();
  return hold > now ? hold : 0;
}

// THE PASS FOR ONE PERSON AT ONE MINUTE, or null.
function commReachPass_(reach, nowMs) {
  if (!reach) return null;
  if (str_(reach.state).toLowerCase() !== 'reachable') return null;
  var now = Number(nowMs) || new Date().getTime();
  if (commReachHoldMs_(reach, now)) return null;       // held beats reachable

  // THE ROW MUST BE RECENT ENOUGH TO BE ABOUT TODAY.
  var src = commReachMs_(reach.source_ms) || commReachMs_(reach.source_at);
  if (!src || (now - src) > COMM_REACH_PASS_STALE_H * 3600000) return null;

  var fromMs = commReachMs_(reach.window_from_ms);
  var toMs = commReachMs_(reach.window_to_ms);
  var shiftMs = commReachMs_(reach.shift_at_ms);
  if (!commReachFits_(fromMs, toMs, shiftMs)) return null;
  if (now < fromMs || now > toMs) return null;
  // AND AGAINST THE SHIFT ITSELF, not only against the window the row drew.
  if (now < shiftMs - COMM_REACH_MAX_MIN * 60000) return null;
  if (now > shiftMs - COMM_REACH_MIN_MIN * 60000) return null;

  // THE HOURS THIS PASS COVERS, on the same clock the caller read its own local hour from.
  var hours = commReachHours_(fromMs, toMs);
  if (!hours.length) return null;

  var code = str_(reach.shift_code);
  var house = str_(reach.house);
  return {
    ok: true,
    hours: hours,
    from_ms: fromMs,
    to_ms: toMs,
    minutes: Math.round((toMs - fromMs) / 60000),
    // THE EVIDENCE, IN THE SENTENCE ITSELF.
    why: 'their own shift: the calendar starts them at ' + commReachClock_(shiftMs) +
         (code ? ' (' + code + ')' : '') + (house ? ' at ' + house : '') +
         ', so this is the ' + Math.round((toMs - fromMs) / 60000) +
         ' minutes they spend getting ready — ' + commReachClock_(fromMs) + ' to ' +
         commReachClock_(toMs) + ', and no minute outside them'
  };
}

// The clock hours a window touches, on the script's own timezone — the same one `commRecordSweep_` reads its local…
function commReachHours_(fromMs, toMs) {
  var out = [];
  try {
    var tz = Session.getScriptTimeZone();
    var probe = Number(fromMs);
    var end = Number(toMs);
    while (probe < end) {
      var h = Number(Utilities.formatDate(new Date(probe), tz, 'H'));
      if (out.indexOf(h) === -1) out.push(h);
      probe += 5 * 60000;
    }
    var last = Number(Utilities.formatDate(new Date(end), tz, 'H'));
    if (out.indexOf(last) === -1) out.push(last);
  } catch (e) { return []; }
  return out;
}

// An instant as the people reading the ledger say it: HH:mm on the script's clock, with the weekday when the answer…
function commReachClock_(ms, withDay) {
  try {
    return Utilities.formatDate(new Date(Number(ms)), Session.getScriptTimeZone(),
                                withDay ? 'EEE HH:mm' : 'HH:mm');
  } catch (e) { return ''; }
}
