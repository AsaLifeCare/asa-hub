// Employee loans (Staff → Employee Pay): a loan request waits on the Scheduling directors in My Work and by text…
// Payments are recorded against an approved loan.

var EL_TAB = 'employee_loans';
var EL_HEADER = ['id', 'kind', 'loan_id', 'staff_key', 'staff_name', 'staff_uid', 'label', 'purpose', 'amount', 'date',
                 'method', 'state', 'box', 'seat', 'to_uid', 'to_email', 'to_name', 'title', 'body', 'facts',
                 'answered_by', 'answered_at', 'note', 'link', 'test_mode', 'created_at', 'created_by',
                 'created_by_uid', 'updated_at'];
var EL_SITUATION = 'staff_loan_request';
var EL_QUIET_LANE = 'staff_loan';
var EL_SCOPE = 'employee_loans';
var EL_MIRRORED_PROP = 'HUB_EMPLOYEE_LOANS_MIRRORED';
var EL_SHARE_TRY_KEY = 'el_share_try';
var EL_READER = 'living-brain@asalifecare-jarvis.iam.gserviceaccount.com';
var EL_TZ = 'America/New_York';
var EL_UNSET = 'Employee loans are not set up yet.';
var EL_METHODS = { manual: 'Manual payment', payroll: 'Payroll deduction' };
var EL_MAX_CENTS = 10000000;
var EL_ITEM_ID = /^EI[0-9A-F]{10}$/;
var EL_LOAN_ID = /^loan-\d{4}-\d{2,4}$/;
var EL_VISITING = 'Do this from your own account — not while visiting someone else.';

function elStr_(v) { return String(v == null ? '' : v).trim(); }
function elText_(v, max) { return elStr_(v).replace(/\s+/g, ' ').slice(0, max || 240); }
function elRefuse_(status, message) { return { status: status, message: message }; }
function elUnknown_() { return { status: 404, message: 'Unknown action.' }; }
function elErr_(e) { return String((e && e.message) || e || 'unknown error').slice(0, 200); }
function elNowIso_() { return new Date().toISOString(); }
function elToday_() { return Utilities.formatDate(new Date(), EL_TZ, 'yyyy-MM-dd'); }

function elCents_(v) {
  var s = String(v == null ? '' : v).replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(parseFloat(s) * 100);
}
function elDollars_(c) { return (Math.round(c) / 100).toFixed(2); }
function elMoney_(c) {
  var s = elDollars_(c).split('.');
  return '$' + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + s[1];
}

function elDay_(v) {
  var s = elStr_(v);
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return '';
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? s : '';
}
function elDayWords_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(elStr_(iso));
  if (!m) return elStr_(iso);
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + m[3] +
         ', ' + m[1];
}

function elSha10_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('').slice(0, 10).toUpperCase();
}
function elNewId_(prefix) {
  var hex = '';
  while (hex.length < 10) hex += Math.floor(Math.random() * 0x100000000).toString(16);
  return prefix + hex.slice(0, 10).toUpperCase();
}

function elTestWord_() {
  try {
    var s = hubTestModeState_();
    return s && s.on === false && !s.unrecognized ? 'no' : 'yes';
  } catch (e) { return 'yes'; }
}

// ---- the house ----

function elSheet_() {
  if (!houseMoved_(EL_TAB)) return null;
  return hubTabEnsure_(EL_TAB, EL_HEADER);
}

function elFreshRows_(sheet) {
  return locationsTabRows_(sheet).filter(function (r) { return elStr_(r.id) && elStr_(r.kind); });
}

/** Every row, cached until a write bumps the scope; null while the house is not set up (never kept). */
function elRows_() {
  if (!houseMoved_(EL_TAB)) return null;
  return cacheRead_(EL_SCOPE, 'rows_v1', function () {
    var sheet = elSheet_();
    if (!sheet) return null;
    return elFreshRows_(sheet).map(function (r) {
      var o = {};
      EL_HEADER.forEach(function (h) { o[h] = elStr_(r[h]); });
      return o;
    });
  });
}

function elPut_(sheet, rows) {
  var head = ensureHeader_(sheet, EL_HEADER);
  rows.forEach(function (r) {
    if (!r._row) { locationsAppend_(sheet, EL_HEADER, r); return; }
    sheet.getRange(r._row, 1, 1, head.length).setValues([head.map(function (h) {
      var v = r[h];
      return hubCellSafe_(v === undefined || v === null ? '' : String(v));
    })]);
  });
  SpreadsheetApp.flush();
}

// The relay's mirror lists a book only by an edit made after it could read it: a grant alone moves nothing, so a…
function elShareMaybe_() {
  var said = { ok: false, reason: '' };
  var tried = false;
  try {
    var id = String(houseIdFor_(EL_TAB) || '');
    if (!id || typeof hubGrantReader_ !== 'function') return null;
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty(EL_MIRRORED_PROP) === id) return { ok: true, already: true };
    var cache = CacheService.getScriptCache();
    if (cache.get(EL_SHARE_TRY_KEY)) return { ok: false, waiting: true };
    cache.put(EL_SHARE_TRY_KEY, '1', 600);
    // the touch is a write: a held funnel holds it (its own row says so) and a later use tries again
    if (sheetDbGateHolds_(EL_TAB, 'update')) return { ok: false, held: true };
    tried = true;
    var file = { getId: function () { return id; }, getName: function () { return EL_TAB; } };
    if (hubGrantReader_(file, EL_READER, said)) {
      said.ok = false;
      var sheet = elSheet_();
      if (!sheet) {
        said.reason = EL_UNSET;
      } else {
        var cell = sheet.getRange(1, 1);
        cell.setValue(cell.getValue());
        SpreadsheetApp.flush();
        props.setProperty(EL_MIRRORED_PROP, id);
        said.ok = true;
      }
    }
  } catch (e) { said.ok = false; said.reason = elErr_(e); }
  if (tried && !said.ok) {
    try {
      hubSysLog_('asa-hub:employee-loans', 'employee_loans_not_shared',
                 'the relay mirror (' + EL_READER + ') does not yet read the employee loans house: ' +
                 (elStr_(said.reason) || 'the grant was refused') + ' — tried again on a later use', { status: 409 });
    } catch (eL) { /* the next use tries again */ }
  }
  return said;
}

// ---- who ----

function elDirectors_() {
  try { return schedFlowDirectors_(); }
  catch (e) { return { readable: false, list: [], why: 'the Scheduling directors list could not be read (' + elErr_(e) + ')' }; }
}

/** Manager: the master, or a badge worn (follows and derived badges included) that ranks HM or higher. */
function elManager_(user) {
  try { if (hubIsRealMaster_(user)) return true; } catch (eM) { return false; }
  if (!user || user.is_service) return false;
  var ranks = HUB_USER_TYPES.slice(0, HUB_USER_TYPES.indexOf(HUB_CALENDAR_BADGE) + 1);
  var worn = [];
  try { worn = userBadgesWornBy_(user) || []; } catch (eB) { worn = []; }
  return worn.some(function (b) { return ranks.indexOf(String(b).toUpperCase()) !== -1; });
}

/** { uid, name, visiting, master, director, manager, dirs } — the session, never a payload. */
function elGate_(user) {
  var g = { uid: '', name: '', visiting: true, master: false, director: false, manager: false, dirs: null };
  if (!user || user.is_service) return g;
  g.visiting = !!(user.visiting_member || (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX));
  g.uid = hubActingUserId_(user);
  g.name = elStr_(user.display_name != null ? user.display_name : user.displayname) || elStr_(user.email);
  try { g.master = !!hubIsRealMaster_(user); } catch (eM) { g.master = false; }
  g.dirs = elDirectors_();
  g.director = !g.visiting && !!g.uid && g.dirs.list.some(function (d) { return d.uid === g.uid; });
  g.manager = !g.visiting && elManager_(user);
  return g;
}

function elRestricted_(g) { return g.master || g.director; }

function elPhoneOf_(uid) {
  var all = [];
  try { all = usersAll_() || []; } catch (e) { return ''; }
  for (var i = 0; i < all.length; i++) {
    var u = all[i] || {};
    if (elStr_(u.userid) !== uid || elStr_(u.mergedinto)) continue;
    var off = elStr_(u.active).toUpperCase();
    if (off === 'FALSE' || off === '0' || off === 'NO') return '';
    var tries = [u.phone];
    try { (profileParsePhones_(u.phones) || []).forEach(function (p) { tries.push(p && typeof p === 'object' ? p.number : p); }); }
    catch (eP) { /* the sign-in phone stands */ }
    for (var t = 0; t < tries.length; t++) {
      var n = packetSendableNumber_(tries[t]);
      if (n) return n;
    }
    return '';
  }
  return '';
}

// ---- the ledger ----

function elOutstanding_(loan, rows) {
  var paid = 0;
  rows.forEach(function (r) { if (r.kind === 'payment' && r.loan_id === loan.id) paid += elCents_(r.amount) || 0; });
  return Math.max(0, (elCents_(loan.amount) || 0) - paid);
}

/** One person's loans: open ones, requests, and the history (approved disbursements and payments, newest first). */
function elLedger_(rows, keep) {
  var mine = rows.filter(function (r) { return r.kind === 'loan' && keep(r); });
  var ids = {};
  mine.forEach(function (l) { ids[l.id] = l; });
  var loans = [], requests = [], history = [], total = 0;
  mine.forEach(function (l) {
    var amount = elCents_(l.amount) || 0;
    if (l.state !== 'approved') {
      requests.push({ id: l.id, label: l.label, amount: elDollars_(amount), date: l.date, state: l.state,
                      answered_by: l.answered_by, note: l.note, created_at: l.created_at });
      return;
    }
    var events = [{ at: l.date, seq: l.answered_at || l.created_at, type: 'disbursement', amount: amount, id: l.id + ':d' }];
    rows.forEach(function (p) {
      if (p.kind === 'payment' && p.loan_id === l.id) {
        events.push({ at: p.date, seq: p.created_at, type: 'payment', amount: elCents_(p.amount) || 0, id: p.id,
                      method: p.method });
      }
    });
    events.sort(function (a, b) {
      if (a.type !== b.type && (a.type === 'disbursement' || b.type === 'disbursement')) return a.type === 'disbursement' ? -1 : 1;
      return a.at < b.at ? -1 : a.at > b.at ? 1 : (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0);
    });
    var bal = 0;
    events.forEach(function (e) {
      bal = e.type === 'disbursement' ? e.amount : Math.max(0, bal - e.amount);
      history.push({ id: e.id, loan_id: l.id, label: l.label, date: e.at, type: e.type, amount: elDollars_(e.amount),
                     balance_after: elDollars_(bal), method: e.method ? (EL_METHODS[e.method] || e.method) : '',
                     seq: e.seq });
    });
    total += bal;
    loans.push({ id: l.id, label: l.label, amount: elDollars_(amount), outstanding: elDollars_(bal), date: l.date,
                 paid_off: bal === 0 });
  });
  history.sort(function (a, b) {
    return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.seq < b.seq ? 1 : a.seq > b.seq ? -1 : 0);
  });
  history.forEach(function (h) { delete h.seq; });
  requests.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
  return { loans: loans, requests: requests, history: history, outstanding: elDollars_(total) };
}

function elAnswer_(rows, keep, g, full, self) {
  if (rows === null) return { status: 200, data: { ready: false, why: EL_UNSET, full: full, can_pay: false } };
  var led = elLedger_(rows, keep);
  var payable = led.loans.filter(function (l) { return !l.paid_off; })
    .map(function (l) { return { id: l.id, label: l.label, outstanding: l.outstanding }; });
  var can = g.master || g.director || g.manager || self;
  if (!full) return { status: 200, data: { ready: true, full: false, payable: payable, can_pay: can } };
  return { status: 200, data: { ready: true, full: true, outstanding: led.outstanding, loans: led.loans,
                                requests: led.requests, history: led.history, payable: payable, can_pay: can,
                                can_request: elRestricted_(g) && !g.visiting,
                                methods: Object.keys(EL_METHODS).map(function (k) { return { id: k, label: EL_METHODS[k] }; }) } };
}

HUB_POLICY.employeeLoanList = {
  file: 'EmployeeLoans.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' } }
};
/** One staff member's loans and payments: whole for the master, the directors and the person; open loans only for a manager. */
HUB_ACTIONS.employeeLoanList = function (payload, user) {
  var g = elGate_(user);
  if (!g.uid && !g.master) return elUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  var self = !g.visiting && !!g.uid && !!(ctx.account && ctx.account.user_id === g.uid);
  var full = elRestricted_(g) || self;
  if (!full && !g.manager) return elUnknown_();
  elShareMaybe_();
  try {
    return elAnswer_(elRows_(), function (r) { return r.staff_key === ctx.key; }, g, full, self);
  } catch (e) {
    return elRefuse_(503, 'The employee loans could not be read just now (' + elErr_(e) + ').');
  }
};

HUB_POLICY.employeeLoanMine = {
  file: 'EmployeeLoans.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: {}
};
/** The session's own loans and payments, read-only but for Add Payment on its own approved loans. */
HUB_ACTIONS.employeeLoanMine = function (payload, user) {
  var g = elGate_(user);
  if (g.visiting || !g.uid) return elRefuse_(403, EL_VISITING);
  elShareMaybe_();
  try {
    return elAnswer_(elRows_(), function (r) { return r.staff_uid === g.uid; }, g, true, true);
  } catch (e) {
    return elRefuse_(503, 'Your loans could not be read just now (' + elErr_(e) + ').');
  }
};

// ---- the request ----

function elTell_(loan, item) {
  var vars = { employee: loan.staff_name, amount: elMoney_(elCents_(loan.amount) || 0), date: elDayWords_(loan.date),
               requester: loan.created_by, link: (typeof mailPlatformUrl_ === 'function' ? mailPlatformUrl_() : '') +
               '/#/app/my-work' };
  var key = 'el|' + EL_SITUATION + '|' + loan.id + '|' + item.to_uid;
  var res = smartTell_({ situation: EL_SITUATION, to: elPhoneOf_(item.to_uid), vars: vars, key: key,
                         person: item.to_name, lane: 'employee loans', at_ms: Date.now(), prune: true });
  if (res.state === 'held' && res.held === 'quiet' && typeof hubQuietOwe_ === 'function') {
    hubQuietOwe_(EL_QUIET_LANE, key, { item_id: item.id });
  }
  return res;
}

/** The morning carrier (Hotline.gs): said only while the item still waits. */
function elQuietCarry_(data) {
  var id = elStr_(data && data.item_id);
  var rows = null;
  try { var sheet = elSheet_(); rows = sheet ? elFreshRows_(sheet) : null; } catch (e) { return { state: 'kept', why: elErr_(e) }; }
  if (!rows) return { state: 'stale', why: EL_UNSET };
  var item = rows.filter(function (r) { return r.kind === 'ask' && r.id === id; })[0];
  if (!item || item.state !== 'waiting') return { state: 'stale', why: 'the loan request was answered overnight' };
  var loan = rows.filter(function (r) { return r.kind === 'loan' && r.id === item.loan_id; })[0];
  if (!loan || loan.state !== 'requested') return { state: 'stale', why: 'the loan request is no longer waiting' };
  var res = elTell_(loan, item);
  return { state: res.state === 'held' && res.held === 'quiet' ? 'kept' : 'carried', why: res.state + ' ' + res.why };
}

function elTextWords_(results) {
  var sent = 0, held = [], other = [];
  results.forEach(function (r) {
    if (r.state === 'sent' || r.state === 'already') sent++;
    else if (r.state === 'held') held.push(r.held === 'test_mode' ? 'test mode' : r.held === 'quiet' ? 'quiet hours, said at 08:00' : r.held);
    else other.push(r.why || r.state);
  });
  var parts = [];
  if (sent) parts.push(sent + ' text' + (sent === 1 ? '' : 's') + ' sent');
  if (held.length) parts.push('texts held (' + held.filter(function (h, i) { return held.indexOf(h) === i; }).join(', ') + ')');
  if (other.length) parts.push('not texted: ' + other.slice(0, 2).join('; '));
  return parts.length ? parts.join(' · ') + '.' : '';
}

HUB_POLICY.employeeLoanRequest = {
  file: 'EmployeeLoans.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: ['smsSend'],
  params: { staff: { type: 'string' }, amount: { type: 'string' }, date: { type: 'string' },
            purpose: { type: 'string' } }
};
/** A loan request for one staff member: filed as requested, a My Work item and a text to each director; the first answer decides. */
HUB_ACTIONS.employeeLoanRequest = function (payload, user) {
  var g = elGate_(user);
  if (!elRestricted_(g)) return elUnknown_();
  if (g.visiting) return elRefuse_(403, EL_VISITING);
  var p = payload || {};
  var ctx = staffProfilesPerson_(p.staff);
  if (ctx.refused) return ctx.refused;
  var cents = elCents_(p.amount);
  if (!(cents > 0) || cents > EL_MAX_CENTS) return elRefuse_(400, 'amount: a loan amount above $0.00.');
  var day = elDay_(p.date);
  if (!day) return elRefuse_(400, 'date: the disbursement date.');
  var purpose = String(p.purpose == null ? '' : p.purpose).trim();
  if (purpose.length > 300) return elRefuse_(400, 'purpose: at most 300 characters.');
  if (!g.dirs.readable) return elRefuse_(503, 'Nobody is set to approve loan requests: ' + g.dirs.why + '.');
  var askable = g.dirs.list.filter(function (d) { return d.uid !== g.uid; });
  if (!askable.length) return elRefuse_(409, 'Nobody else can approve this request.');
  var held = sheetDbGateHolds_(EL_TAB, 'create');
  if (held) return held.error;
  var sheet;
  try { sheet = elSheet_(); } catch (eS) { return elRefuse_(503, 'The employee loans house could not be opened (' + elErr_(eS) + ').'); }
  if (!sheet) return elRefuse_(503, EL_UNSET);
  var lock = locationsLock_();
  if (!lock) return elRefuse_(409, 'Another write is in progress — try again in a moment.');
  var loan, items;
  try {
    var rows = elFreshRows_(sheet);
    var year = elToday_().slice(0, 4), n = 0;
    rows.forEach(function (r) {
      var m = r.kind === 'loan' ? /^loan-(\d{4})-(\d+)$/.exec(r.id) : null;
      if (m && m[1] === year) n = Math.max(n, +m[2]);
    });
    var nowIso = elNowIso_(), test = elTestWord_();
    var id = 'loan-' + year + '-' + ('0' + (n + 1)).slice(-Math.max(2, String(n + 1).length));
    loan = { id: id, kind: 'loan', loan_id: id, staff_key: ctx.key, staff_name: ctx.name,
             staff_uid: ctx.account ? elStr_(ctx.account.user_id) : '', label: elText_(purpose, 60) || 'Employee Loan',
             purpose: purpose, amount: elDollars_(cents), date: day, method: '', state: 'requested', test_mode: test,
             created_at: nowIso, created_by: g.name, created_by_uid: g.uid, updated_at: nowIso };
    var facts = [['Employee', ctx.name], ['Loan', id], ['Amount', elMoney_(cents)], ['Disbursement date', elDayWords_(day)],
                 ['Purpose', purpose], ['Requested by', g.name]]
      .filter(function (f) { return f[1]; }).map(function (f) { return { label: f[0], value: elText_(f[1], 240) }; });
    items = askable.map(function (d) {
      return { id: 'EI' + elSha10_(id + '|' + d.uid), kind: 'ask', loan_id: id, staff_key: ctx.key, staff_name: ctx.name,
               box: 'work', seat: 'director', to_uid: d.uid, to_email: elStr_(d.email), to_name: elStr_(d.name),
               title: 'Employee loan request — ' + ctx.name, body: elMoney_(cents) + ' · ' + loan.label,
               facts: JSON.stringify(facts), date: day, state: 'waiting', link: '/app/my-work', test_mode: test,
               created_at: nowIso, created_by: g.name, created_by_uid: g.uid, updated_at: nowIso };
    });
    elPut_(sheet, [loan].concat(items));
  } catch (eW) {
    return elRefuse_(503, 'The loan request was not filed (' + elErr_(eW) + ').');
  } finally { lock.releaseLock(); }
  cacheBump_(EL_SCOPE);
  elShareMaybe_();
  var results = items.map(function (it) {
    try { return elTell_(loan, it); } catch (eT) { return { state: 'failed', why: elErr_(eT) }; }
  });
  var names = askable.map(function (d) { return d.name; });
  var said = 'Requested. ' + names.join(' and ') + (names.length === 1 ? ' has it.' : ' have it — the first answer decides.');
  var words = elTextWords_(results);
  try { hubSysLog_(elStr_(user && user.email), 'employeeLoanRequest', loan.id, { status: 200 }); } catch (eL) {}
  return { status: 200, data: { loan_id: loan.id, said: said + (words ? ' ' + words : '') } };
};

// ---- the answer: gated by the seat ----

HUB_POLICY.employeeLoanAnswer = {
  file: 'EmployeeLoans.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { item_id: { type: 'string' }, word: { type: 'string' }, note: { type: 'string' } }
};
/** A director's approve or decline from My Work: the item's own seat, or the master on any director seat; the first answer decides. */
HUB_ACTIONS.employeeLoanAnswer = function (payload, user) {
  var p = payload || {};
  var g = elGate_(user);
  if (g.visiting || !g.uid) return elRefuse_(403, EL_VISITING);
  var id = elText_(p.item_id, 20);
  if (!EL_ITEM_ID.test(id)) return elRefuse_(400, 'Unknown item.');
  var word = elStr_(p.word).toLowerCase();
  if (word !== 'approve' && word !== 'decline') return elRefuse_(400, 'Answer with approve or decline.');
  var note = String(p.note == null ? '' : p.note).trim();
  if (note.length > 500) return elRefuse_(400, 'A note can be at most 500 characters.');
  var held = sheetDbGateHolds_(EL_TAB, 'update');
  if (held) return held.error;
  var sheet;
  try { sheet = elSheet_(); } catch (eS) { return elRefuse_(503, 'The employee loans house could not be opened (' + elErr_(eS) + ').'); }
  if (!sheet) return elRefuse_(503, EL_UNSET);
  var lock = locationsLock_();
  if (!lock) return elRefuse_(409, 'Another write is in progress — try again in a moment.');
  var out;
  try {
    var rows = elFreshRows_(sheet);
    var item = rows.filter(function (r) { return r.kind === 'ask' && r.id === id; })[0];
    if (!item || item.box !== 'work') return elRefuse_(404, 'This loan request is not waiting any more.');
    if (item.to_uid !== g.uid && !(g.master && item.seat === 'director')) {
      return elRefuse_(403, 'This one is waiting on ' + (item.to_name || 'someone else') + '.');
    }
    var loan = rows.filter(function (r) { return r.kind === 'loan' && r.id === item.loan_id; })[0];
    if (!loan) return elRefuse_(404, 'The loan request behind this item is gone.');
    if (loan.created_by_uid === g.uid && !g.master) return elRefuse_(403, 'Nobody answers their own request.');
    var nowIso = elNowIso_();
    if (item.state !== 'waiting' || loan.state !== 'requested') {
      if (item.state === 'waiting') {
        item.state = 'superseded';
        item.answered_by = loan.answered_by;
        item.answered_at = nowIso;
        elPut_(sheet, [item]);
      }
      out = { changed: false, state: item.state, said: 'Already answered by ' + (loan.answered_by || 'someone') + '.' };
    } else {
      var approved = word === 'approve';
      loan.state = approved ? 'approved' : 'declined';
      loan.answered_by = g.name;
      loan.answered_at = nowIso;
      loan.note = note;
      loan.updated_at = nowIso;
      item.state = approved ? 'approved' : 'declined';
      item.answered_by = g.name;
      item.answered_at = nowIso;
      item.note = note;
      var settle = [loan, item];
      rows.forEach(function (r) {
        if (r.kind !== 'ask' || r.id === item.id || r.loan_id !== loan.id || r.state !== 'waiting') return;
        r.state = 'superseded';
        r.answered_by = g.name;
        r.answered_at = nowIso;
        settle.push(r);
      });
      elPut_(sheet, settle);
      out = { changed: true, state: item.state,
              said: approved ? 'Approved. ' + loan.staff_name + '\'s loan of ' + elMoney_(elCents_(loan.amount) || 0) +
                               ' is outstanding in full.'
                             : 'Declined. The request stays on ' + loan.staff_name + '\'s record as declined.' };
    }
  } catch (eW) {
    return elRefuse_(503, 'The answer was not filed (' + elErr_(eW) + ').');
  } finally { lock.releaseLock(); }
  cacheBump_(EL_SCOPE);
  try { hubSysLog_(elStr_(user && user.email), 'employeeLoanAnswer', id + ' ' + word, { status: 200 }); } catch (eL) {}
  return { status: 200, data: { ok: true, changed: out.changed, said: out.said, state: out.state } };
};

// ---- the payment ----

HUB_POLICY.employeeLoanPayment = {
  file: 'EmployeeLoans.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { loan_id: { type: 'string' }, amount: { type: 'string' }, date: { type: 'string' },
            method: { type: 'string' }, staff: { type: 'string' } }
};
/** A payment on an approved loan, at most what is outstanding: by a manager, a director, the master or the person on their own loan. */
HUB_ACTIONS.employeeLoanPayment = function (payload, user) {
  var p = payload || {};
  var g = elGate_(user);
  if (!g.uid && !g.master) return elUnknown_();
  if (g.visiting) return elRefuse_(403, EL_VISITING);
  var loanId = elText_(p.loan_id, 20);
  if (!EL_LOAN_ID.test(loanId)) return elRefuse_(400, 'loan_id: the loan.');
  var cents = elCents_(p.amount);
  if (!(cents > 0)) return elRefuse_(400, 'amount: a payment above $0.00.');
  var day = elDay_(p.date);
  if (!day) return elRefuse_(400, 'date: the payment date.');
  var method = elStr_(p.method).toLowerCase();
  if (!EL_METHODS[method]) return elRefuse_(400, 'method: ' + Object.keys(EL_METHODS).join(' or ') + '.');
  var staff = elStr_(p.staff);
  var held = sheetDbGateHolds_(EL_TAB, 'create');
  if (held) return held.error;
  var sheet;
  try { sheet = elSheet_(); } catch (eS) { return elRefuse_(503, 'The employee loans house could not be opened (' + elErr_(eS) + ').'); }
  if (!sheet) return elRefuse_(503, EL_UNSET);
  var lock = locationsLock_();
  if (!lock) return elRefuse_(409, 'Another write is in progress — try again in a moment.');
  var left, loan;
  try {
    var rows = elFreshRows_(sheet);
    loan = rows.filter(function (r) { return r.kind === 'loan' && r.id === loanId; })[0];
    var self = !!loan && !!loan.staff_uid && loan.staff_uid === g.uid;
    if (!loan || !(elRestricted_(g) || g.manager || self)) return elUnknown_();
    if (staff && staff !== loan.staff_key) return elRefuse_(409, 'This loan is not this staff member\'s.');
    if (loan.state !== 'approved') return elRefuse_(409, 'Only an approved loan takes payments.');
    var owed = elOutstanding_(loan, rows);
    if (!owed) return elRefuse_(409, 'This loan is paid off.');
    if (cents > owed) return elRefuse_(400, 'The payment is more than the ' + elMoney_(owed) + ' outstanding.');
    var nowIso = elNowIso_();
    elPut_(sheet, [{ id: elNewId_('EP'), kind: 'payment', loan_id: loan.id, staff_key: loan.staff_key,
                     staff_name: loan.staff_name, staff_uid: loan.staff_uid, label: loan.label, amount: elDollars_(cents),
                     date: day, method: method, state: 'recorded', created_at: nowIso, created_by: g.name,
                     created_by_uid: g.uid, updated_at: nowIso }]);
    left = owed - cents;
  } catch (eW) {
    return elRefuse_(503, 'The payment was not filed (' + elErr_(eW) + ').');
  } finally { lock.releaseLock(); }
  cacheBump_(EL_SCOPE);
  elShareMaybe_();
  try { hubSysLog_(elStr_(user && user.email), 'employeeLoanPayment', loanId, { status: 200 }); } catch (eL) {}
  return { status: 200, data: { loan_id: loanId, outstanding: elDollars_(left), paid_off: left === 0,
                                said: left === 0 ? 'Payment recorded. ' + loan.label + ' is paid off.'
                                                 : 'Payment recorded. ' + elMoney_(left) + ' outstanding.' } };
};
