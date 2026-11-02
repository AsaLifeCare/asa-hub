// Delta-only writes; every state change is an event; outcomes only via requirementOutcomeDispatch_.

var REQ_STATES_TAB = 'requirement_states';
// Rows are written by header name, never by position; `login` stays blank when there is none.
var REQ_STATES_HEADER = ['login', 'person_key', 'person_name', 'req_id', 'state',
                         'expires', 'days_left', 'prev_state', 'since',
                         'computed_at', 'tenant'];

function reqStatesRow_(hdr, vals) {
  var out = [];
  for (var i = 0; i < hdr.length; i++) {
    var key = String(hdr[i] || '').trim();
    out.push(Object.prototype.hasOwnProperty.call(vals, key) ? vals[key] : '');
  }
  return out;
}
var REQ_STATES_SWEEP_KEY = 'req_states_last_run';
var REQ_STATES_SWEEP_GAP_S = 6 * 3600;
// Past this, a change wave writes one summary event instead of one per change.
var REQ_STATES_EVENT_CAP = 250;

function reqStatesSheet_() {
  var sheet = ensureTab_(REQ_STATES_TAB, REQ_STATES_HEADER);
  ensureHeader_(sheet, REQ_STATES_HEADER);
  return sheet;
}

// states: ok | expiring | expired | missing | na
function reqStateFromDate_(expiresMs, warnDays, nowMs) {
  if (expiresMs === null) return { state: 'missing', days_left: '' };
  var left = Math.ceil((expiresMs - nowMs) / 86400000);
  if (left < 0) return { state: 'expired', days_left: left };
  if (left <= warnDays) return { state: 'expiring', days_left: left };
  return { state: 'ok', days_left: left };
}

// Flag columns may hold dates or yes/no words; a date goes back to reqStateFromDate_.
function reqStateFromFlag_(flag) {
  var raw = String(flag == null ? '' : flag).trim();
  var v = raw.toLowerCase();
  if (!v) return { state: 'missing', days_left: '' };
  if (v === '1' || v === 'yes' || v === 'y' || v === 'true' || v === 'x') {
    return { state: 'ok', days_left: '' };
  }
  if (v === '0.5') return { state: 'expiring', days_left: '' };
  if (v === 'n-a' || v === 'na' || v === 'n/a') return { state: 'na', days_left: '' };
  if (v === '0' || v === 'no' || v === 'n' || v === 'false') {
    return { state: 'missing', days_left: '' };
  }
  var ms = reqFlagDateMs_(raw);
  if (ms !== null) return { state: 'date', days_left: '', date: ms };
  return { state: 'missing', days_left: '' };
}

function reqStateHeader_(masterRow, req, warnDays, nowMs) {
  var cell = smartRawColumn_(masterRow, str_(req.header));
  var got = reqStateFromFlag_(cell);
  if (got.state !== 'date') { got.expires = ''; return got; }
  var out = reqStateFromDate_(got.date, warnDays, nowMs);
  out.expires = new Date(got.date).toISOString().slice(0, 10);
  return out;
}

// Accepts a US date, an ISO date, or a Sheets date serial; other numbers are counts, not dates.
function reqFlagDateMs_(raw) {
  var s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d{1,6}$/.test(s)) {
    var n = Number(s);
    if (n < 20000 || n > 80000) return null;
    return Date.UTC(1899, 11, 30) + n * 86400000;
  }
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

// ist_requirements_window: ist gives the certification window in days; own gives 0, so each row keeps its warn_days.
function reqIstWindow_() {
  try {
    if (typeof istCfgChoice_ === 'function' && istCfgChoice_('ist_requirements_window') === 'ist') {
      return certExpiringDays_();
    }
  } catch (e) { /* unreadable: each row keeps its own window */ }
  return 0;
}

// Its own warn_days (30 when blank); a training row takes istWindow when set.
function reqWarnDays_(req, istWindow) {
  if (istWindow && str_(req.category) === 'training') return istWindow;
  var warnDays = parseInt(str_(req.warn_days), 10);
  return isNaN(warnDays) ? 30 : warnDays;
}

function reqStatesCompute_() {
  var catalog = requirementsAll_().rows.filter(function (r) {
    return str_(r.enabled).toLowerCase() === 'yes';
  });
  var picture = certPicture_();
  var rawByName = {};
  try {
    var masterName = certSourceField_('master.name');
    certReadTab_(certSourceTab_('master')).forEach(function (r) {
      var k = clientNameKey_(certFieldOf_(r, masterName));
      if (k && !rawByName[k]) rawByName[k] = r;
    });
  } catch (eRaw) { rawByName = {}; }
  var istWindow = reqIstWindow_();
  var people = withoutIspClients_(peopleMerged_(listRows_('people', {})));
  var nowMs = Date.now();
  var matrix = {};

  people.forEach(function (p) {
    var nameKey = clientNameKey_(p.name);
    if (!nameKey) return;
    // Login = e-mail, else the phone's digits (the account-minting rule); blank when neither.
    var personLogin = str_(p.email).trim().toLowerCase();
    if (!personLogin) personLogin = str_(p.phone).replace(/\D+/g, '');
    if (!personLogin) personLogin = '';
    var known = picture[nameKey] || { certs: {} };
    var masterRow = rawByName[nameKey] || null;
    catalog.forEach(function (req) {
      var reqId = str_(req.req_id);
      var warnDays = reqWarnDays_(req, istWindow);
      var out = null;
      var cred = str_(req.credential);
      if (cred) {
        var cell = known.certs[cred];
        var expires = '';
        if (cell && cell.expires) expires = cell.expires;
        else if (masterRow) expires = smartRawColumn_(masterRow, cred);
        // An empty credential column falls back to the header column the book actually fills.
        if (!str_(expires) && masterRow && str_(req.header)) {
          out = reqStateHeader_(masterRow, req, warnDays, nowMs);
        } else {
          var ms = expires ? certDateMs_(expires) : null;
          out = reqStateFromDate_(ms, warnDays, nowMs);
          out.expires = ms ? String(expires).slice(0, 10) : '';
        }
      } else if (masterRow && str_(req.header)) {
        out = reqStateHeader_(masterRow, req, warnDays, nowMs);
      } else if (str_(req.na_eligible).toLowerCase() === 'yes' && !masterRow) {
        out = { state: 'missing', days_left: '', expires: '' };
      } else {
        out = { state: 'missing', days_left: '', expires: '' };
      }
      matrix[nameKey + '|' + reqId] = {
        login: personLogin,
        person_key: nameKey,
        person_name: str_(p.name),
        req_id: reqId,
        state: out.state,
        expires: out.expires,
        days_left: out.days_left
      };
    });
  });
  return matrix;
}

// Read by header name: ensureHeader_ appends, so the live order can differ from REQ_STATES_HEADER.
function reqStatesExisting_() {
  var sheet = reqStatesSheet_();
  var last = sheet.getLastRow();
  var out = {};
  if (last < 2) return out;
  var width = Math.max(sheet.getLastColumn(), REQ_STATES_HEADER.length);
  var hdr = headerOf_(sheet);
  if (!hdr.length) hdr = REQ_STATES_HEADER.slice();
  var values = sheet.getRange(2, 1, last - 1, width).getValues();
  return reqStatesIndex_(hdr, values);
}

function reqStatesIndex_(hdr, values) {
  var at = {};
  for (var h = 0; h < (hdr || []).length; h++) {
    var name = str_(hdr[h]);
    if (name && at[name] === undefined) at[name] = h;
  }
  var cell = function (row, name) {
    return at[name] === undefined ? '' : str_(row[at[name]]);
  };
  var out = {};
  for (var r = 0; r < (values || []).length; r++) {
    var row = values[r];
    var key = cell(row, 'person_key') + '|' + cell(row, 'req_id');
    if (key === '|') continue;
    out[key] = {
      row: r + 2,
      state: cell(row, 'state'),
      expires: cell(row, 'expires'),
      since: cell(row, 'since')
    };
  }
  return out;
}

function reqStatesDiff_(computed, existing) {
  var updates = [], inserts = [], changes = [];
  for (var key in computed) {
    if (!Object.prototype.hasOwnProperty.call(computed, key)) continue;
    var c = computed[key];
    var ex = existing[key];
    if (!ex) {
      inserts.push(c);
      changes.push({ key: key, prev: '', next: c.state, req_id: c.req_id,
                     person_key: c.person_key, person_name: c.person_name,
                     expires: c.expires, days_left: c.days_left });
      continue;
    }
    if (ex.state !== c.state || ex.expires !== c.expires) {
      updates.push({ row: ex.row, rowData: c, prev_state: ex.state, since: ex.since });
      if (ex.state !== c.state) {
        changes.push({ key: key, prev: ex.state, next: c.state, req_id: c.req_id,
                       person_key: c.person_key, person_name: c.person_name,
                       expires: c.expires, days_left: c.days_left });
      }
    }
  }
  return { updates: updates, inserts: inserts, changes: changes };
}

// The only place a transition becomes an effect; new outcomes are data on the requirement row.
function requirementOutcomeDispatch_(change, reqRow) {
  var outcomes = [];
  var consequence = reqRow ? str_(reqRow.consequence) : '';
  if (consequence && (change.next === 'expiring' || change.next === 'expired')) {
    outcomes.push({ type: 'smart_situation', id: consequence });
  }
  return outcomes;
}

function reqStatesCatalogById_() {
  var byId = {};
  requirementsAll_().rows.forEach(function (r) { byId[str_(r.req_id)] = r; });
  return byId;
}

function requirementStatesRebuild_(opts) {
  opts = opts || {};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { status: 409, message: 'A rebuild is already running.' };
  try {
    var computed = reqStatesCompute_();
    var existing = reqStatesExisting_();
    var diff = reqStatesDiff_(computed, existing);
    var sheet = reqStatesSheet_();
    var nowIso = new Date().toISOString();
    var where = '';
    try { where = tenantStamp_(); } catch (eT) { where = ''; }
    var liveHdr = headerOf_(sheet);
    if (!liveHdr.length) liveHdr = REQ_STATES_HEADER.slice();

    // `since` moves only when the state moved, never on a mere re-read.
    for (var u = 0; u < diff.updates.length; u++) {
      var up = diff.updates[u];
      var c = up.rowData;
      sheet.getRange(up.row, 1, 1, liveHdr.length).setValues([reqStatesRow_(liveHdr, {
        login: c.login || '', person_key: c.person_key, person_name: c.person_name,
        req_id: c.req_id, state: c.state, expires: c.expires,
        days_left: c.days_left, prev_state: up.prev_state,
        since: up.prev_state !== c.state ? nowIso : up.since,
        computed_at: nowIso, tenant: where
      })]);
    }

    var inserted = 0;
    var block = [];
    var blockStart = 0;
    for (var i = 0; i < diff.inserts.length; i++) {
      var n = diff.inserts[i];
      if (!block.length) blockStart = sheet.getLastRow() + 1;
      block.push(reqStatesRow_(liveHdr, {
        login: n.login || '', person_key: n.person_key, person_name: n.person_name,
        req_id: n.req_id, state: n.state, expires: n.expires,
        days_left: n.days_left, prev_state: '', since: nowIso,
        computed_at: nowIso, tenant: where
      }));
      if (block.length === 500) {
        sheet.getRange(blockStart, 1, block.length, liveHdr.length).setValues(block);
        inserted += block.length;
        block = [];
      }
    }
    if (block.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, block.length, liveHdr.length).setValues(block);
      inserted += block.length;
    }

    // The first rebuild earns one summary event: one event per pair outran the execution budget.
    var byId = reqStatesCatalogById_();
    var outcomes = [];
    var isBaseline = Object.keys(existing).length === 0;
    if (isBaseline) {
      var stateCounts = {};
      for (var e0 = 0; e0 < diff.changes.length; e0++) {
        var ch0 = diff.changes[e0];
        stateCounts[ch0.next] = (stateCounts[ch0.next] || 0) + 1;
        var outs0 = requirementOutcomeDispatch_(ch0, byId[ch0.req_id]);
        for (var o0 = 0; o0 < outs0.length; o0++) outcomes.push(outs0[o0]);
      }
      if (typeof eventAppend_ === 'function') {
        eventAppend_('requirement_states_baseline', {
          type: 'system', key: REQ_STATES_TAB, name: 'First rebuild'
        }, { pairs: diff.changes.length, by_state: stateCounts },
        'requirementStatesRebuild_');
      }
    } else {
      for (var e = 0; e < diff.changes.length; e++) {
        var ch = diff.changes[e];
        if (e < REQ_STATES_EVENT_CAP && typeof eventAppend_ === 'function') {
          eventAppend_('requirement_state_changed', {
            type: 'person', key: ch.person_key, name: ch.person_name
          }, {
            req_id: ch.req_id, prev_state: ch.prev, state: ch.next,
            expires: ch.expires, days_left: ch.days_left
          }, 'requirementStatesRebuild_');
        }
        var outs = requirementOutcomeDispatch_(ch, byId[ch.req_id]);
        for (var o = 0; o < outs.length; o++) outcomes.push(outs[o]);
      }
      if (diff.changes.length > REQ_STATES_EVENT_CAP && typeof eventAppend_ === 'function') {
        eventAppend_('requirement_state_changes_overflow', {
          type: 'system', key: REQ_STATES_TAB, name: 'Change wave'
        }, { total: diff.changes.length, recorded: REQ_STATES_EVENT_CAP },
        'requirementStatesRebuild_');
      }
    }

    cacheBump_(REQ_STATES_TAB);
    var summary = {
      computed: Object.keys(computed).length,
      updated: diff.updates.length,
      inserted: inserted,
      changes: diff.changes.length,
      outcomes: outcomes.length
    };
    hubSysLog_('requirementStates', 'rebuild', '',
               { status: 200, detail: JSON.stringify(summary) });
    return { status: 200, data: summary };
  } finally {
    lock.releaseLock();
  }
}

function requirementStatesSweepMaybe_() {
  try {
    var cache = CacheService.getScriptCache();
    var last = parseInt(cache.get(REQ_STATES_SWEEP_KEY), 10);
    var nowS = Math.floor(Date.now() / 1000);
    if (!isNaN(last) && nowS - last < REQ_STATES_SWEEP_GAP_S) return { skipped: 'recent' };
    cache.put(REQ_STATES_SWEEP_KEY, String(nowS), REQ_STATES_SWEEP_GAP_S + 60);
    return requirementStatesRebuild_({});
  } catch (e) {
    return { status: 500, message: String((e && e.message) || e) };
  }
}


/** FAIL-CLOSED: the stored states as { hdr, values } — the `newest` rows, or every row when none is given; null when the tab could not be read. */
function reqStatesListValues_(newest) {
  try {
    var sheet = reqStatesSheet_();
    var hdr = headerOf_(sheet);
    if (!hdr.length) hdr = REQ_STATES_HEADER.slice();
    var last = sheet.getLastRow();
    if (last < 2) return { hdr: hdr, values: [] };
    var start = newest ? Math.max(2, last - newest + 1) : 2;
    var width = Math.max(sheet.getLastColumn(), hdr.length);
    return { hdr: hdr, values: sheet.getRange(start, 1, last - start + 1, width).getValues() };
  } catch (e) {
    return null;
  }
}

/** The listed rows, newest first, read by header name (the live order is not REQ_STATES_HEADER's); `key` keeps one person's rows by the name fold of person_key, else of person_name. */
function reqStatesListFrom_(hdr, values, opts) {
  var at = {};
  for (var h = 0; h < (hdr || []).length; h++) {
    var name = str_(hdr[h]);
    if (name && at[name] === undefined) at[name] = h;
  }
  var cell = function (row, col) { return at[col] === undefined ? '' : str_(row[at[col]]); };
  var out = [];
  for (var r = (values || []).length - 1; r >= 0 && out.length < opts.limit; r--) {
    var row = values[r];
    if (opts.key && (hubNameFold_(cell(row, 'person_key')) || hubNameFold_(cell(row, 'person_name'))) !== opts.key) continue;
    if (opts.state && cell(row, 'state').toLowerCase() !== opts.state) continue;
    if (opts.person && cell(row, 'person_name').toLowerCase().indexOf(opts.person) === -1) continue;
    out.push({
      person_key: cell(row, 'person_key'), person_name: cell(row, 'person_name'),
      req_id: cell(row, 'req_id'), state: cell(row, 'state'),
      expires: cell(row, 'expires'), days_left: cell(row, 'days_left'),
      prev_state: cell(row, 'prev_state'), since: cell(row, 'since'),
      computed_at: cell(row, 'computed_at'), tenant: cell(row, 'tenant')
    });
  }
  return out;
}

/** The stored requirement states, newest first, filtered by state or person name: every person's to the real master, the caller's own to anyone else (Compliance.gs complianceWhose_). A refusal carries the same `scope`. */
HUB_POLICY.requirementStatesList = {
  file: 'RequirementStates.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'], invalidates: [], emits: []
};
HUB_ACTIONS.requirementStatesList = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  // every person's certification expiries are a mass view: settled before the tab is read
  var whose = complianceWhose_(user);
  if (whose.refusal) return whose.refusal;
  var state = str_(payload && payload.state).toLowerCase();
  var person = str_(payload && payload.person).toLowerCase();
  var limit = Math.min(2000, Math.max(1, parseInt(payload && payload.limit, 10) || 500));
  // an own answer reads the whole tab: the caller's rows may sit anywhere in it
  var got = reqStatesListValues_(whose.all ? 5000 : 0);
  if (!got) {
    return { status: 503, message: 'The requirement states could not be read just now — nothing is listed rather ' +
             'than an empty matrix.', scope: whose.scope };
  }
  var out = reqStatesListFrom_(got.hdr, got.values, {
    limit: limit, state: state, person: person, key: whose.all ? '' : whose.self.key
  });
  return { status: 200, data: { rows: out, total: out.length, scope: whose.scope,
                                self: whose.all ? '' : whose.self.name } };
};

HUB_POLICY.requirementStatesRun = {
  file: 'RequirementStates.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'], invalidates: [], emits: []
};
HUB_ACTIONS.requirementStatesRun = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  return requirementStatesRebuild_(payload || {});
};
