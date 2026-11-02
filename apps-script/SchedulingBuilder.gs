// SCHEDULING — the Builder: a house's A/B pattern over whole Monday–Sunday weeks, checked and approved, balanced…
// One draft per house and first day lives in sched_drafts, cached per draft and written without moving the board's…

var SCHED_BUILDER_ACTIONS = ['schedulingBuilderRead', 'schedulingBuilderSave', 'schedulingBuilderPublish'];
var SCHED_BUILDER_FEATURE = 'scheduling.builder';
var SCHED_BUILDER_CACHE = 'sched_bld1:';
var SCHED_BUILDER_LIST = 'sched_bld_list1:';
var SCHED_BUILDER_CTX = 'sched_bldctx1:';
// the staff list, preferences and IST books are held this long by their own caches
var SCHED_BUILDER_CTX_TTL = 600;
var SCHED_BUILDER_TTL = 21600;
var SCHED_BUILDER_PART = 45000;
var SCHED_BUILDER_PARTS = ['body', 'body_2', 'body_3', 'body_4'];
var SCHED_BUILDER_MAX_WEEKS = 26;
var SCHED_BUILDER_MAX_ROWS = 80;
var SCHED_BUILDER_REPORT = 80;
var SCHED_BUILDER_STATES = { pattern: 1, approved: 1, published: 1 };
var SCHED_BUILDER_NO_STORE = 'Drafts cannot be kept yet: the Scheduling drafts house is not set up.';

function schedBldGate_(user) { return schedViewGate_(user, SCHED_BUILDER_FEATURE); }

/** null when `ctx` edits the house, else the refusal. */
function schedBldEditor_(ctx, house) {
  if (!house) return schedRefuse_(400, 'Pick a house.');
  if (!schedHouseList_().some(function (h) { return h.code === house; })) return schedRefuse_(404, 'There is no such house.');
  if (!ctx.editorOf(house)) {
    return schedRefuse_(403, 'Only the house manager, the Scheduling directors and the master build this calendar.');
  }
  return null;
}

/** Whole Monday–Sunday weeks: { first, last, weeks } or { error }. */
function schedBldRange_(first, last) {
  if (!schedIsoValid_(first) || !schedIsoValid_(last)) return { error: 'Pick a start and an end date.' };
  if (schedDow_(first) !== 1) return { error: 'The start date is a Monday.' };
  if (schedDow_(last) !== 0) return { error: 'The end date is a Sunday.' };
  var days = schedDayIndex_(last) - schedDayIndex_(first) + 1;
  if (days < 7) return { error: 'The end date comes after the start date.' };
  if (days / 7 > SCHED_BUILDER_MAX_WEEKS) return { error: 'At most ' + SCHED_BUILDER_MAX_WEEKS + ' weeks at a time.' };
  return { first: first, last: last, weeks: days / 7 };
}

function schedBldNextMonday_(iso) {
  var d = iso;
  while (schedDow_(d) !== 1) d = schedIsoAdd_(d, 1);
  return d;
}

function schedBldId_(house, first) { return 'SD_' + schedSha16_(house + '|' + first); }

// ---- the draft's shape ----

function schedBldText_(v) { return schedStr_(v).slice(0, 60); }

function schedBldWeek_(v) {
  var a = Array.isArray(v) ? v : [], out = [];
  for (var i = 0; i < 7; i++) out.push(schedBldText_(a[i]));
  return out;
}

function schedBldOpenWeek_(v) {
  var a = Array.isArray(v) ? v : [], out = [];
  for (var i = 0; i < 7; i++) out.push((Array.isArray(a[i]) ? a[i] : []).map(schedBldText_).filter(String).slice(0, 20));
  return out;
}

/** The draft as kept: rows, the A and B weeks, the OPEN weeks, and the period's cells once applied. */
function schedBldClean_(raw, range) {
  var d = raw && typeof raw === 'object' ? raw : {};
  var rows = [], seen = {};
  (Array.isArray(d.rows) ? d.rows : []).forEach(function (r) {
    var key = schedStr_(r && r.key);
    if (!/^[a-z0-9]{1,80}$/.test(key) || seen[key] || rows.length >= SCHED_BUILDER_MAX_ROWS) return;
    seen[key] = true;
    rows.push({ key: key, name: schedStr_(r.name).slice(0, 120) || key });
  });
  var week = function (w) {
    var src = d[w] && typeof d[w] === 'object' ? d[w] : {}, out = {};
    rows.forEach(function (r) { out[r.key] = schedBldWeek_(src[r.key]); });
    return out;
  };
  var inRange = {};
  schedDates_(range.first, range.last).forEach(function (x) { inRange[x] = true; });
  var cells = {}, srcCells = d.cells && typeof d.cells === 'object' ? d.cells : {};
  rows.forEach(function (r) {
    var line = srcCells[r.key] && typeof srcCells[r.key] === 'object' ? srcCells[r.key] : {}, out = {};
    Object.keys(line).forEach(function (iso) {
      var t = inRange[iso] ? schedBldText_(line[iso]) : '';
      if (t) out[iso] = t;
    });
    cells[r.key] = out;
  });
  var open = {}, srcOpen = d.open && typeof d.open === 'object' ? d.open : {};
  Object.keys(srcOpen).forEach(function (iso) {
    if (!inRange[iso] || !Array.isArray(srcOpen[iso])) return;
    var l = srcOpen[iso].map(schedBldText_).filter(String).slice(0, 20);
    if (l.length) open[iso] = l;
  });
  return { rows: rows, a: week('a'), b: week('b'), open_a: schedBldOpenWeek_(d.open_a), open_b: schedBldOpenWeek_(d.open_b),
           cells: cells, open: open, applied: d.applied === true };
}

/** JSON in cell-sized parts, never cut beside a space (a read trims) or before what a sheet reads as a formula. */
function schedBldSplit_(text) {
  var parts = [], rest = text;
  while (rest.length > SCHED_BUILDER_PART) {
    var at = SCHED_BUILDER_PART;
    while (at > 1 && (/\s/.test(rest.charAt(at - 1)) || /[\s=+\-@]/.test(rest.charAt(at)))) at--;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  parts.push(rest);
  return parts.length > SCHED_BUILDER_PARTS.length ? null : parts;
}

function schedBldFromRow_(r) {
  var text = SCHED_BUILDER_PARTS.map(function (p) { return String(r[p] == null ? '' : r[p]); }).join('');
  return { id: r.id, house: r.house_code, first: r.first, last: r.last,
           state: SCHED_BUILDER_STATES[r.state] ? r.state : 'pattern', rev: schedIntOf_(r.rev, 0),
           body: schedJson_(text, null), approved_at: schedStr_(r.approved_at), approved_by: schedStr_(r.approved_by),
           published_at: schedStr_(r.published_at), updated_at: schedStr_(r.updated_at), updated_by: schedStr_(r.updated_by) };
}

function schedBldMeta_(d) {
  return { state: d.state, rev: d.rev, last: d.last, updated_at: d.updated_at, updated_by: d.updated_by,
           approved_at: d.approved_at, approved_by: d.approved_by, published_at: d.published_at, draft: d.body };
}

// ---- the drafts house: cached per draft, written without moving the board's version ----

function schedBldCacheGet_(id) {
  try {
    var hit = CacheService.getScriptCache().get(SCHED_BUILDER_CACHE + id);
    return hit ? JSON.parse(hit) : null;
  } catch (e) { return null; }
}

function schedBldCachePut_(id, d) {
  try { CacheService.getScriptCache().put(SCHED_BUILDER_CACHE + id, JSON.stringify(d || { none: true }), SCHED_BUILDER_TTL); }
  catch (e) { /* the sheet still answers */ }
}

/** The house's drafts, newest first, from the rows given. */
function schedBldListPut_(house, rows) {
  var list = rows.filter(function (r) { return r.house_code === house; }).map(function (r) {
    return { first: r.first, last: r.last, state: SCHED_BUILDER_STATES[r.state] ? r.state : 'pattern', updated_at: r.updated_at };
  }).sort(function (a, b) { return a.first < b.first ? 1 : (a.first > b.first ? -1 : 0); }).slice(0, 30);
  try { CacheService.getScriptCache().put(SCHED_BUILDER_LIST + house, JSON.stringify(list), SCHED_BUILDER_TTL); } catch (e) {}
  return list;
}

function schedBldList_(house) {
  try {
    var hit = CacheService.getScriptCache().get(SCHED_BUILDER_LIST + house);
    if (hit) return JSON.parse(hit);
  } catch (e) { /* read below */ }
  return schedBldListPut_(house, schedRead_(SCHED_TABS.drafts));
}

function schedBldGet_(house, first) {
  var id = schedBldId_(house, first);
  var hit = schedBldCacheGet_(id);
  if (hit) return hit.id ? hit : null;
  var row = null;
  schedRead_(SCHED_TABS.drafts).forEach(function (r) { if (r.id === id) row = r; });
  var d = row ? schedBldFromRow_(row) : null;
  schedBldCachePut_(id, d);
  return d;
}

/** Writes one draft row by id; the caller holds the lock. */
function schedBldPut_(d) {
  var parts = schedBldSplit_(JSON.stringify(d.body || {}));
  if (!parts) throw new Error('This draft is too large to keep — build fewer weeks at a time.');
  var row = { id: d.id, house_code: d.house, first: d.first, last: d.last, state: d.state, rev: String(d.rev),
              approved_at: d.approved_at || '', approved_by: d.approved_by || '', published_at: d.published_at || '',
              updated_at: d.updated_at, updated_by: d.updated_by };
  SCHED_BUILDER_PARTS.forEach(function (p, i) { row[p] = parts[i] || ''; });
  var held = sheetDbGateHolds_(SCHED_TABS.drafts, 'update');
  if (held) throw new Error(held.error.message);
  var sheet = schedSheet_(SCHED_TABS.drafts);
  var header = ensureHeader_(sheet, SCHED_HEADERS[SCHED_TABS.drafts]);
  var idCol = header.indexOf('id'), last = Math.max(sheet.getLastRow(), 1), at = 0;
  if (last > 1 && idCol !== -1) {
    sheet.getRange(2, idCol + 1, last - 1, 1).getValues().forEach(function (r, i) {
      if (!at && schedCellText_(r[0]) === d.id) at = i + 2;
    });
  }
  schedPutLines_(sheet, at || last + 1, [schedLine_(header, row)]);
  try { SpreadsheetApp.flush(); } catch (eF) { /* the cache below carries it */ }
  schedMemoDrop_(SCHED_TABS.drafts);
  schedBldCachePut_(d.id, d);
  return row;
}

// ---- what the screen reads beside the draft ----

/** Active staff by the Staff roster: [{ key, name }], or null with why. */
function schedBldStaff_() {
  try {
    if (typeof staffProfilesCached_ !== 'function') return { list: null, why: 'the staff list is not available' };
    var data = staffProfilesCached_('staffProfileRoster', 'all', 'active', [], function () {
      return spScrub_(spRosterBuild_(false));
    });
    if (!data || !Array.isArray(data.staff)) return { list: null, why: 'the staff list gave no answer' };
    return { list: data.staff.filter(function (s) {
      return s && s.status === 'active' && !s.ambiguous && /^[a-z0-9]{1,80}$/.test(schedStr_(s.key));
    }).map(function (s) { return { key: s.key, name: schedStr_(s.name) || s.key }; }), why: '' };
  } catch (e) {
    return { list: null, why: 'the staff list could not be read (' + schedErr_(e) + ')' };
  }
}

/** Everything the checks read: staff with their IST here, the roster, preferences, time off, shifts elsewhere, the weeks before. */
function schedBldContext_(house, range) {
  var out = { staff: null, staff_why: '', roster: [], prefs: {}, time_off: [], elsewhere: {}, prev: null };
  var short = {};
  schedHouseList_().forEach(function (h) { short[h.code] = h.short || h.code; });
  var got = schedBldStaff_();
  out.staff_why = got.why;
  if (got.list) {
    schedIstWarm_();
    out.staff = got.list.map(function (s) {
      var ist = schedIstFor_(s.key, house);
      return ist.has === true ? { key: s.key, name: s.name, ist: true, ist_why: '' }
        : { key: s.key, name: s.name, ist: ist.has === false ? false : null, ist_why: ist.why };
    });
  }
  var prefs = {};
  try { prefs = (typeof spPrefsIndex_ === 'function' ? spPrefsIndex_() : {}) || {}; } catch (eP) { prefs = {}; out.degraded = true; }
  Object.keys(prefs).forEach(function (k) {
    var p = prefs[k] || {};
    var here = (p.houses || []).indexOf(house) !== -1, a = (p.days || {}).a || [], b = (p.days || {}).b || [];
    if (here || a.length || b.length) out.prefs[k] = { here: here, a: a, b: b };
  });

  var bases = {};
  var baseOf = function (p) { return bases[p.id] || (bases[p.id] = schedBoardBase_(p)); };
  var current = schedCurrentPeriod_();
  var now = baseOf(current);
  ((now.grids[house] || {}).rows || []).forEach(function (r) {
    if (r.kind === 'person' && r.key) out.roster.push({ key: r.key, name: r.name });
  });
  (now.flows || []).forEach(function (f) {
    if (f.kind !== 'time_off' || (f.state !== 'approved' && f.state !== 'approved_future') || !f.person_key) return;
    var to = schedIsoValid_(f.date_to) ? f.date_to : f.date;
    if (!schedIsoValid_(f.date) || f.date > range.last || to < range.first) return;
    out.time_off.push({ key: f.person_key, name: schedStr_(f.person), from: f.date, to: to });
  });

  schedSettings_().periods.forEach(function (p) {
    if (p.last < range.first || p.first > range.last) return;
    var busy = baseOf(p).busy || {};
    Object.keys(busy).forEach(function (k) {
      busy[k].forEach(function (b) {
        if (b[4] !== 'work' || !b[3] || b[3] === house || b[0] < range.first || b[0] > range.last) return;
        (out.elsewhere[k] = out.elsewhere[k] || []).push([b[0], b[1], b[2], short[b[3]] || b[3]]);
      });
    });
  });

  var week = function (start) {
    var w = { rows: {}, open: [[], [], [], [], [], [], []], names: {} };
    for (var i = 0; i < 7; i++) {
      var iso = schedIsoAdd_(start, i), p = schedPeriodOf_(iso);
      var g = p ? baseOf(p).grids[house] : null;
      if (!g) continue;
      var col = -1;
      g.cols.forEach(function (c, j) { if (c.iso === iso) col = j; });
      if (col === -1) continue;
      g.rows.forEach(function (r) {
        var c = r.cells[col];
        var text = c && c.text && (!c.state || c.state === 'scheduled' || c.state === 'open') ? c.text : '';
        if (r.kind === 'open') { if (text) w.open[i].push(text); return; }
        if (r.kind !== 'person' || !r.key) return;
        if (!w.rows[r.key]) { w.rows[r.key] = ['', '', '', '', '', '', '']; w.names[r.key] = r.name; }
        w.rows[r.key][i] = text;
      });
    }
    return w;
  };
  out.prev = { a: week(schedIsoAdd_(range.first, -14)), b: week(schedIsoAdd_(range.first, -7)) };
  return out;
}

// The context's cache key: the board's (its version moves with every Scheduling write, its stamp with the accounts…
function schedBldContextKey_(house, range) {
  try {
    var board = schedBoardKey_(schedCurrentPeriod_());
    if (!board) return '';
    var parts = [board, house, range.first, range.last, schedToday_()];
    ['sp_staffProfileRoster_all', SP_PREFS_INDEX_SCOPE, cacheScope_(tabFor_('istRecords')), cacheScope_(tabFor_('istHouses'))]
      .forEach(function (s) { parts.push(cacheVersion_(s)); });
    return SCHED_BUILDER_CTX + schedSha16_(parts.join('|'));
  } catch (e) { return ''; }
}

/** schedBldContext_ from the cache while nothing it reads has moved; one that could not read a source is never kept. */
function schedBldContextCached_(house, range) {
  var key = schedBldContextKey_(house, range);
  var hit = key ? schedCacheGet_(key) : null;
  if (hit) return hit;
  var c = schedBldContext_(house, range);
  if (key && c.staff && !c.degraded && schedIstWarm_().readable) schedCachePut_(key, c, SCHED_BUILDER_CTX_TTL);
  return c;
}

// ---- the actions ----

HUB_POLICY.schedulingBuilderRead = {
  file: 'SchedulingBuilder.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, first: { type: 'string' }, last: { type: 'string' } }
};
// { house, first, last } (each optional): the houses this editor builds, the draft for that house and first Monday…
HUB_ACTIONS.schedulingBuilderRead = function (payload, user) {
  var ctx = schedBldGate_(user);
  if (!ctx.open) return schedClosed_();
  payload = payload || {};
  try {
    // a house manager by the cached board's rows, never a fresh read of the rows house
    var base = ctx.is_master || ctx.is_director ? null : schedBoardBase_(schedCurrentPeriod_());
    var houses = schedHouseList_().filter(function (h) { return base ? schedBaseEditor_(base, ctx, h.code) : ctx.editorOf(h.code); });
    if (!houses.length) return schedRefuse_(403, 'The Builder is for the house managers, the Scheduling directors and the master.');
    var asked = schedStr_(payload.house);
    var house = (houses.filter(function (h) { return h.code === asked; })[0] || houses[0]).code;
    var store = schedHouseReady_(SCHED_TABS.drafts) ? '' : SCHED_BUILDER_NO_STORE;
    var drafts = store ? [] : schedBldList_(house);
    var first = schedStr_(payload.first), last = schedStr_(payload.last);
    if (!first) {
      var open = drafts.filter(function (d) { return d.state !== 'published'; })[0];
      if (open) { first = open.first; last = last || open.last; }
    }
    if (!first) {
      var periods = schedSettings_().periods, lastP = periods[periods.length - 1];
      var today = schedToday_();
      first = schedBldNextMonday_(lastP && lastP.last >= today ? schedIsoAdd_(lastP.last, 1) : today);
    }
    var d = store || !schedIsoValid_(first) ? null : schedBldGet_(house, first);
    if (!last) last = d ? d.last : (schedIsoValid_(first) ? schedIsoAdd_(first, 27) : '');
    var range = schedBldRange_(first, last);
    if (range.error) return schedRefuse_(400, range.error);
    var c = schedBldContextCached_(house, range);
    var data = {
      ok: true, today: schedToday_(), house: house, first: range.first, last: range.last, weeks: range.weeks, store: store,
      houses: houses.map(function (h) { return { code: h.code, short: h.short || h.code, location: h.location }; }),
      periods: schedSettings_().periods.map(function (p) { return { id: p.id, first: p.first, last: p.last }; }),
      drafts: drafts, staff: c.staff, staff_why: c.staff_why, roster: c.roster, prefs: c.prefs, time_off: c.time_off,
      elsewhere: c.elsewhere, prev: c.prev,
      state: d ? d.state : 'pattern', rev: d ? d.rev : 0, draft: d ? d.body : null,
      updated_at: d ? d.updated_at : '', updated_by: d ? d.updated_by : '', approved_at: d ? d.approved_at : '',
      approved_by: d ? d.approved_by : '', published_at: d ? d.published_at : ''
    };
    return { status: 200, data: data };
  } catch (e) {
    return schedUnreadable_(e);
  }
};

HUB_POLICY.schedulingBuilderSave = {
  file: 'SchedulingBuilder.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, first: { type: 'string' }, last: { type: 'string' }, draft: { type: 'object' },
            state: { type: 'string' }, rev: { type: 'string' } }
};
// Keeps the draft for { house, first }: `state` 'approved' once the pattern check is approved, else 'pattern'.
HUB_ACTIONS.schedulingBuilderSave = function (payload, user) {
  var ctx = schedBldGate_(user);
  if (!ctx.open) return schedClosed_();
  payload = payload || {};
  var house = schedStr_(payload.house);
  var range = schedBldRange_(schedStr_(payload.first), schedStr_(payload.last));
  if (range.error) return schedRefuse_(400, range.error);
  var state = schedStr_(payload.state) === 'approved' ? 'approved' : 'pattern';
  try {
    var refused = schedBldEditor_(ctx, house);
    if (refused) return refused;
    if (!schedHouseReady_(SCHED_TABS.drafts)) return schedRefuse_(503, SCHED_BUILDER_NO_STORE);
    var body = schedBldClean_(payload.draft, range);
    if (state === 'approved' && !body.applied) return schedRefuse_(409, 'Apply the patterns to the period before approving.');
    return schedLock_(function () {
      var rows = schedRead_(SCHED_TABS.drafts), id = schedBldId_(house, range.first), was = null;
      rows.forEach(function (r) { if (r.id === id) was = schedBldFromRow_(r); });
      if ((was ? was.rev : 0) !== schedIntOf_(payload.rev, 0)) {
        return { status: 409, message: 'Somebody else changed this draft a moment ago — it was read again.',
                 data: { conflict: true } };
      }
      var now = schedNow_();
      var kept = state === 'approved' && was && was.state !== 'pattern' && was.approved_at;
      var d = { id: id, house: house, first: range.first, last: range.last, state: state, rev: (was ? was.rev : 0) + 1,
                body: body, approved_at: state === 'approved' ? (kept ? was.approved_at : now) : '',
                approved_by: state === 'approved' ? (kept ? was.approved_by : ctx.name) : '',
                published_at: was ? was.published_at : '', updated_at: now, updated_by: ctx.name };
      var row = schedBldPut_(d);
      schedBldListPut_(house, rows.filter(function (r) { return r.id !== id; }).concat([row]));
      var data = schedBldMeta_(d);
      data.draft = undefined;
      data.ok = true;
      data.said = state === 'approved' ? 'Pattern approved.' : 'Draft saved.';
      return { status: 200, data: data };
    });
  } catch (e) {
    return schedUnreadable_(e);
  }
};

// The cells a publish writes, under the lock: every person row of the draft and its OPEN shifts, from today on.
function schedBldPlan_(ctx, house, range, body) {
  var today = schedToday_();
  var rows = schedRead_(SCHED_TABS.rows), cells = schedRead_(SCHED_TABS.cells), flows = schedRead_(SCHED_TABS.flows);
  var tokens = schedHouseTokens_();
  var label = schedHouseLabel_(house);
  var dates = schedDates_(range.first, range.last).filter(function (d) { return d >= today; });
  var cellAt = {};
  cells.forEach(function (c) {
    if (c.house_code === house && c.date >= range.first && c.date <= range.last) cellAt[c.row_id + '|' + c.date] = c;
  });
  var pending = {};
  flows.forEach(function (f) {
    if ((f.kind !== 'request_off' && f.kind !== 'swap' && f.kind !== 'training') ||
        SCHED_FLOW_WAITING.indexOf(schedStr_(f.state)) === -1) return;
    if (f.house_code === house) pending[f.row_id + '|' + f.date] = true;
    var ex = schedFlowExchangeOf_(f);
    if (ex && ex.house === house) pending[ex.row_id + '|' + ex.date] = true;
  });
  var all = schedHoldIndex_(cells, rows, flows, tokens), holds = {};
  Object.keys(all).forEach(function (k) { holds[k] = all[k].filter(function (h) { return h.house_code !== house; }); });
  var out = { rows: [], cells: [], remove: [], log: [], skipped: [], keys: [], written: 0, cleared: 0 };
  var houseRows = rows.filter(function (r) { return r.house_code === house; });
  var rowOf = {}, maxOrder = 0, maxOpen = 0;
  houseRows.forEach(function (r) {
    rowOf[r.row_id] = r;
    if (r.row_kind === 'person') maxOrder = Math.max(maxOrder, parseFloat(r.order) || 0);
    if (r.row_kind === 'open') maxOpen = Math.max(maxOpen, schedOpenN_(r.row_id));
  });
  var skip = function (name, date, text, why) { out.skipped.push({ name: name, date: date, text: text, why: why }); };
  var put = function (rowId, date, was, text, state) {
    if (!text) {
      if (!was) return;
      out.remove.push(was.id);
      out.cleared++;
    } else {
      out.cells.push(schedCellRow_(house, rowId, date, text, { state: state, source: 'builder', color: was ? was.color : '',
                                                                updated_by: ctx.uid }));
      out.written++;
    }
    out.log.push(schedLogRow_(ctx, house, date, rowId, was ? was.text : '', text, 'builder', '', 'Builder'));
  };
  var held = function (key, was) {
    return pending[key] ? 'a request is waiting on it'
      : (was && (SCHED_ONE_OFF_STATES[schedStr_(was.state)] || schedStr_(was.flow_id)) ? 'kept: ' + (schedStr_(was.state) || 'a flow holds it') : '');
  };

  (body.rows || []).forEach(function (br) {
    var key = br.key, rowId = 'P:' + key, name = br.name;
    var rec = rowOf[rowId];
    var need = schedTrainingNeed_(house, key);
    var skippedNoIst = 0;
    if (!rec || rec.active === 'no') {
      rec = rec ? schedCopy_(rec) : { id: schedRowId_(house, rowId), house_code: house, location: '', row_id: rowId,
                                      row_kind: 'person', name: name, person_key: key, designation: '',
                                      order: String(++maxOrder), source: 'builder' };
      schedHouseList_().forEach(function (h) { if (h.code === house && !rec.location) rec.location = h.location; });
      rec.active = 'yes';
      rec.updated_at = schedNow_();
      rec.updated_by = ctx.uid;
      out.rows.push(rec);
      rowOf[rowId] = rec;
    }
    name = rec.name || name;
    out.keys.push(key);
    dates.forEach(function (d) {
      var text = schedStr_(((body.cells || {})[key] || {})[d]);
      var was = cellAt[rowId + '|' + d] || null;
      if (schedStr_(was && was.text) === text) return;
      var why = held(rowId + '|' + d, was);
      if (why) { skip(name, d, text, why); return; }
      var cls = schedClassify_(text);
      if (text && cls && cls.kind !== 'off' && cls.kind !== 'ro') {
        if (need && cls.start !== null) { skippedNoIst++; return; }
        var span = schedValueSpan_(cls, text);
        var clash = schedClash_(key, d, span ? span[0] : null, span ? span[1] : null,
                                { holds: holds, house_code: house, value: text, tokens: tokens });
        if (clash) {
          skip(name, d, text, clash.why === 'time_off' ? 'approved time off'
            : 'already at ' + schedHouseLabel_(clash.house_code) + ' ' + schedShiftWords_({ text: clash.text }));
          return;
        }
      }
      put(rowId, d, was, text, 'scheduled');
    });
    if (skippedNoIst) {
      skip(name, '', skippedNoIst + ' shift' + (skippedNoIst === 1 ? '' : 's'),
           'no IST at ' + label + ' — place them from House Calendars so the training is asked for');
    }
  });

  var openRows = houseRows.filter(function (r) { return r.row_kind === 'open' && r.active !== 'no'; }).sort(schedRowOrder_);
  dates.forEach(function (d) {
    var left = ((body.open || {})[d] || []).map(schedStr_).filter(String);
    var free = [];
    openRows.forEach(function (r) {
      var c = cellAt[r.row_id + '|' + d];
      if (!c || (!schedStr_(c.text) && !schedStr_(c.base))) { free.push(r.row_id); return; }
      var i = left.indexOf(schedStr_(c.text));
      if (i !== -1) { left.splice(i, 1); return; }
      if (schedStr_(c.state) === 'open' && !held(r.row_id + '|' + d, c)) { put(r.row_id, d, c, '', ''); free.push(r.row_id); }
    });
    free.sort(function (a, b) { return schedOpenN_(a) - schedOpenN_(b); });
    left.forEach(function (text) {
      var rowId = free.shift();
      if (!rowId) {
        var rec = schedOpenRowRecord_(house, ++maxOpen, ctx);
        rec.source = 'builder';
        out.rows.push(rec);
        openRows.push(rec);
        rowId = rec.row_id;
      }
      var was = cellAt[rowId + '|' + d] || null;
      put(rowId, d, was && schedStr_(was.text) ? was : null, text, 'open');
    });
  });
  return out;
}

HUB_POLICY.schedulingBuilderPublish = {
  file: 'SchedulingBuilder.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, first: { type: 'string' }, rev: { type: 'string' } }
};
// Publishes the approved draft for { house, first } into the house's calendar: the period its last weeks need is…
HUB_ACTIONS.schedulingBuilderPublish = function (payload, user) {
  var ctx = schedBldGate_(user);
  if (!ctx.open) return schedClosed_();
  payload = payload || {};
  var house = schedStr_(payload.house), first = schedStr_(payload.first);
  try {
    var refused = schedBldEditor_(ctx, house);
    if (refused) return refused;
    if (!schedHouseReady_(SCHED_TABS.drafts)) return schedRefuse_(503, SCHED_BUILDER_NO_STORE);
    schedIstWarm_();
    var done = schedLock_(function () {
      var held = schedHeld_();
      if (held) return held;
      schedMemoDrop_();
      var row = null, id = schedBldId_(house, first);
      schedRead_(SCHED_TABS.drafts).forEach(function (r) { if (r.id === id) row = r; });
      var d = row ? schedBldFromRow_(row) : null;
      if (!d || !d.body) return schedRefuse_(404, 'There is no draft for these weeks.');
      if (d.state === 'pattern') return schedRefuse_(409, 'Approve the pattern check before publishing.');
      if (schedStr_(payload.rev) !== '' && d.rev !== schedIntOf_(payload.rev, -1)) {
        return { status: 409, message: 'Somebody else changed this draft a moment ago — it was read again.',
                 data: { conflict: true } };
      }
      var range = schedBldRange_(d.first, d.last);
      if (range.error) return schedRefuse_(409, range.error);
      var settings = schedSettings_();
      if (!settings.readable) return schedRefuse_(503, 'The Scheduling settings could not be read: ' + settings.why);
      var periods = settings.periods, lastP = periods[periods.length - 1];
      if (range.first < periods[0].first) return schedRefuse_(409, 'These weeks start before the first calendar period.');
      var now = schedNow_(), added = null;
      if (range.last > lastP.last) {
        var from = schedIsoAdd_(lastP.last, 1);
        added = { id: 'P' + from, first: from, last: range.last, state: 'live', rolled_from: '', rolled_at: now, by: ctx.uid };
        schedUpsert_(SCHED_TABS.settings, [{ key: 'periods', value: JSON.stringify(periods.concat([added])), note: 'builder',
                                             updated_at: now, updated_by: ctx.uid }]);
        schedMemoDrop_();
      }
      var plan = schedBldPlan_(ctx, house, range, d.body);
      if (plan.rows.length) schedUpsert_(SCHED_TABS.rows, plan.rows);
      if (plan.remove.length) schedRemove_(SCHED_TABS.cells, plan.remove);
      if (plan.cells.length) schedUpsert_(SCHED_TABS.cells, plan.cells);
      if (plan.log.length) schedAppend_(SCHED_TABS.log, plan.log);
      d.state = 'published';
      d.rev += 1;
      d.published_at = now;
      d.updated_at = now;
      d.updated_by = ctx.name;
      schedBldPut_(d);
      try { CacheService.getScriptCache().remove(SCHED_BUILDER_LIST + house); } catch (eL) {}
      schedMemoDrop_();
      var period = schedPeriodOf_(range.first) || periods[0];
      var label = schedHouseLabel_(house);
      var said = 'Published ' + label + ': ' + plan.written + ' shift' + (plan.written === 1 ? '' : 's') + ' written' +
                 (plan.cleared ? ', ' + plan.cleared + ' cleared' : '') +
                 (plan.skipped.length ? ', ' + plan.skipped.length + ' left as they were' : '') + '.';
      var meta = schedBldMeta_(d);
      meta.draft = undefined;
      return schedDone_(said, period.id, [house], plan.keys, {
        builder: { written: plan.written, cleared: plan.cleared, skipped: plan.skipped.slice(0, SCHED_BUILDER_REPORT),
                   skipped_count: plan.skipped.length, period_added: added ? added.id : '', meta: meta }
      });
    });
    return schedAnswerAfter_(ctx, done);
  } catch (e) {
    return schedUnreadable_(e);
  }
};
