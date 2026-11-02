// Client Funds and Billing for one client, read from the apps that hold them, as App Control releases Clients…
// Funds: Client Finances' ledger (finance_transactions + TrueLink Reconciliation), its balances tab, and the…

var CSF_ACTIONS = ['clientSourceFunds', 'clientSourceBilling', 'clientSourceFinanceFile'];
var CSF_PAWS_PROP = 'HUB_PAWS_BOOK_ID';
var CSF_PAWS_FALLBACK = '1C81euMJk7rHL3DCymerYk0gG__5Rg9sNVwJFmxD5bIw';
var CSF_PAWS_TAB = 'Sheet1';
var CSF_CLIENT_DB_PROP = 'HUB_CLIENT_DB_SHEET_ID';
var CSF_CLIENT_DB_FALLBACK = '1fTi78ztKDiK3hvYLbI2IQ1TeSrzVLceK5LyXJ4BVPe8';
var CSF_SPANS_TAB = 'Sheet6';
var CSF_MBS_PROP = 'HUB_BILLING_ERRORS_BOOK_ID';
var CSF_MBS_FALLBACK = '1wEMjXy9LcOjsZgGY3Z8m6VbLcLTFNw-BCXQpIcZUKpA';
var CSF_MBS_TAB = 'Sheet1';
var CSF_EVV_TAB = 'EVV Fixes';
var CSF_MBS_PATH = ['Billing', 'Billing Errors'];
var CSF_MBS_MAX = 60;
var CSF_RENEWAL_DAYS = 60;
var CSF_NOT_SERVICE = ['ADMIN', 'TRAIN'];
var CSF_TXN_STATUSES = ['Recorded', 'Receipt On File', 'Missing receipt'];
var CSF_RECEIPT_STATUSES = ['Receipt On File', 'Needs review', 'Missing receipt', 'No receipt expected', 'Filed'];
var CSF_AUTH_STATUSES = ['Current', 'Renewal due', 'Expired', 'Unknown'];
var CSF_CLAIM_STATUSES = ['Draft', 'Submitted', 'Rejected', 'Denied', 'Paid'];
var CSF_REVIEW_VERDICTS = ['MISMATCH', 'POSSIBLE_MATCH', 'UNREADABLE'];
var CSF_RECEIPT_KINDS = ['receipt', 'invoice', 'packing_slip'];
var CSF_STATEMENT_KINDS = ['bank_statement', 'benefit_letter', 'paystub', 'tax_form', 'utility_bill'];
var CSF_SOURCE_WORDS = { truelink: 'TrueLink card', manual: 'Spending log', hub: 'Client Finances' };
var CSF_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
                  'october', 'november', 'december'];
var CSF_MBS_CLAIM = /^\s*(\d{7})\s+(\S+)\s+(\S+)\s+(\d{12})\s+(\d\d\/\d\d\/\d{4})\s+(\d\d\/\d\d\/\d{4})\s+([A-Z0-9]{3})\s+(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(-?[\d.]+)/;
var CSF_MBS_ERROR = /^\s*\(\s*(\d+)\s*\)\s*(.+?)\s*$/;
var CSF_MBS_CYCLE = /BILLING CYCLE\s+([A-Z]{3}\d{2}[A-Z])/;
var CSF_EVV_LINE = /(\d{12})\s+(\d\d\/\d\d\/\d{2,4})\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(\d+)\s*$/;

// FAIL-CLOSED: the Clients reader for this client — the master in its own session, else as App Control releases…
function csfGate_(user, client, office) {
  if (!user || user.is_service) return false;
  try {
    if (hubIsRealMaster_(user)) return true;
    var reader = clientProfilesReaderFor_(user, client);
    return !!reader && !(office && (reader.kind === 'client' || reader.kind === 'guardian'));
  } catch (e) { return false; }
}

function csfUnknown_() {
  return { status: 404, message: 'Unknown action.' };
}

function csfErr_(e) {
  return String((e && e.message) || e).slice(0, 120);
}

function csfRound_(n) {
  return Math.round(Number(n) * 100) / 100;
}

function csfIso_(y, m, d) {
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
}

function csfSerialDay_(n) {
  if (!(n > 20000 && n < 80000)) return '';
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
}

/** A cell as YYYY-MM-DD: a Date on Ohio's clock, ISO text, M/D/YY(YY), MM-DD-YYYY or a Sheets serial; '' otherwise. */
function csfDay_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, 'America/New_York', 'yyyy-MM-dd');
  if (typeof v === 'number') return csfSerialDay_(v);
  var s = String(v == null ? '' : v).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) return csfSerialDay_(Number(s));
  var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return csfIso_(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  var us = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/.exec(s);
  if (!us) return '';
  return csfIso_(Number(us[3].length === 2 ? '20' + us[3] : us[3]), Number(us[1]), Number(us[2]));
}

function csfDays_(from, to) {
  var a = Date.parse(String(from) + 'T12:00:00Z'), b = Date.parse(String(to) + 'T12:00:00Z');
  return isNaN(a) || isNaN(b) ? null : Math.round((b - a) / 86400000);
}

/** "Month D, YYYY - Month D, YYYY" anywhere in the text, or "M/D/YY-M/D/YY"; null when neither is there. */
function csfSpan_(text) {
  var s = String(text == null ? '' : text);
  var long = /([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})\s*[-–—]+\s*([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (long) {
    var i = CSF_MONTHS.indexOf(long[1].toLowerCase()), j = CSF_MONTHS.indexOf(long[4].toLowerCase());
    var a = i === -1 ? '' : csfIso_(Number(long[3]), i + 1, Number(long[2]));
    var b = j === -1 ? '' : csfIso_(Number(long[6]), j + 1, Number(long[5]));
    if (a && b) return { start: a, end: b };
  }
  var short = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–—]+\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/.exec(s);
  if (short) {
    var c = csfDay_(short[1]), d = csfDay_(short[2]);
    if (c && d) return { start: c, end: d };
  }
  return null;
}

function csfSpanStatus_(end, today) {
  var left = end ? csfDays_(today, end) : null;
  if (left === null) return 'Unknown';
  if (left < 0) return 'Expired';
  return left <= CSF_RENEWAL_DAYS ? 'Renewal due' : 'Current';
}

/** Money as a number: "$ (483.72)" is -483.72, an accounting "$ -" is 0, a blank or a word is null. */
function csfMoney_(v) {
  if (typeof v === 'number') return isFinite(v) ? csfRound_(v) : null;
  var s = String(v == null ? '' : v).replace(/[$,\s‎]/g, '');
  if (!s) return null;
  if (s === '-') return 0;
  var neg = false;
  var p = /^\((.*)\)$/.exec(s);
  if (p) { neg = true; s = p[1]; }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return csfRound_(neg ? -Number(s) : Number(s));
}

function csfNumber_(v) {
  return locationsNum_(String(v == null ? '' : v).replace(/[\s,‎]/g, ''));
}

/** "0.085" and "8.5%" are both 8.5. */
function csfPercent_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return null;
  var pct = /%$/.test(s);
  var n = csfNumber_(s.replace(/%$/, ''));
  if (n === null) return null;
  return csfRound_(pct || Math.abs(n) > 1 ? n : n * 100);
}

/** Free text with any 9-digit or 12+-digit run (an SSN, a card, an account, a Medicaid number) cut to its last four. */
function csfSafe_(v, max) {
  return locationsText_(v, max).replace(/\d{9,}/g, function (d) {
    return d.length === 10 || d.length === 11 ? d : new Array(d.length - 3).join('•') + d.slice(-4);
  });
}

/** The last four digits of a card cell; never more. */
function csfLast4_(v) {
  var d = String(v == null ? '' : v).replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : '';
}

function csfMoneyWords_(n) {
  if (n === null || n === undefined || !isFinite(n)) return '';
  var abs = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-$' : '$') + abs;
}

function csfWords_(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(String);
}

function csfNearName_(cell, name) {
  var a = csfWords_(cell), b = csfWords_(name);
  if (a.length < 2 || b.length < 2) return false;
  var af = a[0], al = a[a.length - 1], bf = b[0], bl = b[b.length - 1];
  if (al === bl && af.length >= 3 && bf.length >= 3 && (af.indexOf(bf) === 0 || bf.indexOf(af) === 0)) return true;
  if (af !== bf || al.length !== bl.length || al.length < 4) return false;
  var diff = 0;
  for (var i = 0; i < al.length; i++) if (al.charAt(i) !== bl.charAt(i)) diff++;
  return diff === 1;
}

/** 'exact', 'near' (a short first name or one letter off, and no other client on file is as near), or ''. */
function csfNameMatch_(cell, c) {
  var k = clientNameKey_(cell);
  if (!k) return '';
  if (k === c.name_key) return 'exact';
  if (c.roster.some(function (r) { return r.name_key === k; })) return '';
  if (!csfNearName_(cell, c.name)) return '';
  var others = c.roster.filter(function (r) { return r.client_key !== c.client_key && csfNearName_(cell, r.name); });
  return others.length ? '' : 'near';
}

function csfDriveIdOf_(v) {
  var s = String(v == null ? '' : v).trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  return locationsDriveId_(s);
}

/** The Drive id a receipt cell names: a file id, a spending-log "form-receipt-<id>", or a Drive link; '' for a bare file name. */
function csfReceiptId_(fileCell, nameCell) {
  var id = csfDriveIdOf_(fileCell);
  if (id) return id;
  var s = String(nameCell == null ? '' : nameCell).trim();
  var m = /^form-receipt-([A-Za-z0-9_-]{20,})$/.exec(s);
  return m ? m[1] : locationsDriveId_(s);
}

// ---- the client ------------------------------------------------------------

/** The client a request names, from clientsDerived_: 400 malformed, 404 unknown, 503 unreadable. */
function csfClient_(raw) {
  var key = String(raw == null ? '' : raw).trim();
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) {
    return { refused: { status: 400, message: 'client: a client key, as the Clients app names it.' } };
  }
  var all;
  try { all = clientsDerived_(null) || []; }
  catch (e) { return { refused: { status: 503, message: 'The clients could not be read just now (' + csfErr_(e) + ').' } }; }
  var roster = all.map(function (r) {
    var name = locationsText_(r.name);
    return { client_key: String(r.client_key || '').trim() || clientNameKey_(name), name: name,
             name_key: clientNameKey_(name), row: r };
  });
  var hit = null;
  roster.forEach(function (r) { if (!hit && r.client_key === key) hit = r; });
  if (!hit) return { refused: { status: 404, message: 'No client "' + key + '" is on file.' } };
  var row = hit.row || {};
  var words = csfWords_(hit.name);
  var lastName = words.length ? words[words.length - 1] : '';
  return {
    client_key: key, name: hit.name, name_key: hit.name_key, last_name: lastName,
    shared: !!hit.name_key && roster.filter(function (r) { return r.name_key === hit.name_key; }).length > 1,
    last_name_shared: roster.filter(function (r) {
      var w = csfWords_(r.name);
      return r.client_key !== key && w.length && w[w.length - 1] === lastName;
    }).length > 0,
    medicaid_id: /^\d{12}$/.test(String(row.medicaid_id || '')) ? String(row.medicaid_id) : '',
    isp_year: locationsText_(row.isp_year, 300), ssa_name: locationsText_(row.ssa_name, 80),
    roster: roster.map(function (r) { return { client_key: r.client_key, name: r.name, name_key: r.name_key }; })
  };
}

function csfWho_(c) {
  return { client_key: c.client_key, name: c.name };
}

/** Why a join by name is refused for a name two clients on file share. */
function csfSharedWhy_(c, holder) {
  return 'more than one client on file is named ' + c.name + ' and ' + holder + ' only by name, so the two cannot be told apart';
}

// ---- the stores ------------------------------------------------------------

/** Keyed csf_<action>_<client>, at most a minute old; the versions of the tabs it reads retire it sooner. A degraded answer is never kept. */
function csfCached_(action, key, depScopes, producer) {
  var scope = 'csf_' + action + '_' + key;
  var name = 'v1_' + Math.floor(Date.now() / 60000);
  (depScopes || []).forEach(function (s) {
    try { name += '_' + cacheVersion_(s); } catch (e) { name += '_x'; }
  });
  var value = cacheRead_(scope, name, producer);
  if (value && value.degraded) cacheBump_(scope);
  return value;
}

/** A hand-kept tab as objects keyed by the first row that names every `must` column (a title row may sit above it). */
function csfTab_(id, tab, must) {
  return cacheRead_(cacheScopeSheet_(id, tab), 'csf_rows_' + must.join('_'), function () {
    var sheet = ssOpen_(id).getSheetByName(tab);
    if (!sheet) throw new Error('the book has no ' + tab + ' tab');
    return csfHeaderRows_(sheet.getDataRange().getValues(), must);
  });
}

function csfHeaderRows_(values, must) {
  var trim = function (h) { return String(h == null ? '' : h).trim(); };
  var at = -1;
  for (var i = 0; i < values.length && i < 20 && at === -1; i++) {
    var cells = values[i].map(trim);
    if (must.every(function (m) { return cells.indexOf(m) !== -1; })) at = i;
  }
  if (at === -1) throw new Error('no header row names ' + must.join(', '));
  var head = values[at].map(trim);
  var rows = [];
  for (var r = at + 1; r < values.length; r++) {
    var o = { _row: r + 1 }, empty = true;
    for (var c = 0; c < head.length; c++) {
      if (!head[c] || o.hasOwnProperty(head[c])) continue;
      var v = locationsCell_(values[r][c]);
      if (v) empty = false;
      o[head[c]] = v;
    }
    if (!empty) rows.push(o);
  }
  return rows;
}

/** Only the named columns of a big tab, as objects; a column the header lacks reads ''. */
function csfColumns_(sheet, names) {
  var last = sheet.getLastRow(), width = sheet.getLastColumn();
  if (last < 2 || !width) return [];
  var head = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h == null ? '' : h).trim(); });
  var cols = {};
  names.forEach(function (n) {
    var i = head.indexOf(n);
    if (i !== -1) cols[n] = sheet.getRange(2, i + 1, last - 1, 1).getValues();
  });
  var out = [];
  for (var r = 0; r < last - 1; r++) {
    var o = {};
    names.forEach(function (n) { o[n] = cols[n] ? locationsCell_(cols[n][r][0]) : ''; });
    out.push(o);
  }
  return out;
}

// ---- funds -----------------------------------------------------------------

function csfTxn_(x) {
  var amount = csfRound_(finNum_(x.amount));
  var date = csfDay_(x.date) || finSrcDay_(x.date);
  var fund = locationsText_(x.fund) || 'Debit Card';
  var verdict = locationsText_(x.verdict).toUpperCase();
  var receiptCell = locationsText_(x.receipt_name, 200);
  var fileId = csfReceiptId_(x.receipt_file, receiptCell);
  var receiptName = /^form-receipt-/.test(receiptCell) ? 'Spending log receipt' : csfSafe_(receiptCell, 200);
  var has = !!(receiptName || fileId);
  var exempt = verdict === 'EXEMPT';
  var spend = amount < 0;
  var status = !spend || (exempt && !has) ? 'Recorded' : (has ? 'Receipt On File' : 'Missing receipt');
  var receipt = !spend ? '' : (exempt && !has) ? 'No receipt expected' : !has ? 'Missing receipt'
    : CSF_REVIEW_VERDICTS.indexOf(verdict) !== -1 ? 'Needs review' : 'Receipt On File';
  var vendor = csfSafe_(x.vendor, 120);
  var type = locationsText_(x.type) || (spend ? 'Spending' : 'Deposit');
  var category = csfSafe_(x.category, 80);
  var description = csfSafe_(x.description, 200);
  var staff = locationsText_(x.staff, 80);
  var note = csfSafe_(x.note, 240);
  var srcKey = locationsText_(x.source).toLowerCase();
  return {
    id: x.id, record: vendor || type, date: date,
    details: [category, fund, description, staff ? 'by ' + staff : '', exempt && !has && note ? 'No receipt: ' + note : '']
      .filter(String).join(' · '),
    status: status, amount: amount, type: type, fund: fund, vendor: vendor, category: category,
    description: description, staff: staff, source: CSF_SOURCE_WORDS[srcKey] || locationsText_(x.source) || 'Client Finances',
    month: finMonthOf_(date),
    receipt: { status: receipt, name: receiptName, file_id: fileId, verdict: verdict, note: note },
    card_last4: csfLast4_(x.last4)
  };
}

/** The ledger rows under this client's name: finance_transactions, then TrueLink rows it has not imported. */
function csfLedger_(c) {
  var out = { rows: [], why: '', tl_why: '' };
  var ft;
  try { ft = listRows_('financeTransactions', {}); }
  catch (e) {
    out.why = 'the Client Finances ledger (finance_transactions) could not be read (' + csfErr_(e) + ')';
    return out;
  }
  var seen = {};
  ft.forEach(function (r) {
    var k = str_(r.legacyRowKey);
    if (k) seen[k] = true;
    if (clientNameKey_(r.client) !== c.name_key) return;
    out.rows.push(csfTxn_({ id: str_(r.id), date: r.date, amount: r.amount, type: r.type, fund: r.fundType,
      vendor: r.vendor, category: r.category, description: r.description, staff: r.staffMember, source: r.source,
      receipt_name: r.receiptName, receipt_file: r.receiptFileId, verdict: r.receiptVerdict, note: r.receiptNote,
      last4: r.accountLast4 }));
  });
  var tlId = '';
  try { tlId = String(hubId_('FIN_TRUELINK_SHEET_ID') || '').trim(); } catch (eP) { tlId = ''; }
  if (!tlId) {
    out.tl_why = 'the TrueLink Reconciliation book is not configured (FIN_TRUELINK_SHEET_ID)';
  } else {
    try {
      readTabNormalized_(ssOpen_(tlId), 'Transactions').forEach(function (r, i) {
        var k = str_(r.rowkey);
        if (k && seen[k]) return;
        if (clientNameKey_(r.cardholdername) !== c.name_key) return;
        out.rows.push(csfTxn_({ id: 'tl-' + (i + 2), date: r.transactiondate, amount: r.amount, type: r.type,
          fund: r.fundtype, vendor: r.vendor, category: r.category, description: r.description, staff: r.staffmember,
          source: r.source || 'truelink', receipt_name: r.receipt, receipt_file: '', verdict: r.receiptai,
          note: r.receiptainote, last4: r.accountlast4 }));
      });
    } catch (eT) {
      out.tl_why = 'the TrueLink Reconciliation book could not be read (' + csfErr_(eT) + ')';
    }
  }
  out.rows.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : (a.id < b.id ? -1 : 1)); });
  return out;
}

/** The balances tab: the Client Fund Tracking row (on file) and the months Client Finances closed. */
function csfBalancesOnFile_(c, rows) {
  var onFile = null, closed = {};
  rows.forEach(function (b) {
    var ck = str_(b.client_key).trim();
    var mine = ck ? ck === c.client_key : clientNameKey_(b.client_name || b.client) === c.name_key;
    if (!mine) return;
    if (str_(b.fundType) && /^\d{4}-\d{2}$/.test(str_(b.month))) {
      if (str_(b.status) !== 'Closed') return;
      var f = str_(b.fundType);
      if (!closed[f] || str_(b.month) > closed[f].month) closed[f] = { month: str_(b.month), closing: csfMoney_(b.closing) };
      return;
    }
    if (onFile) return;
    onFile = { total: csfMoney_(b.total), house: csfMoney_(b.house), office: csfMoney_(b.office),
               as_of: locationsText_(b.as_of, 40), note: csfSafe_(b.note, 200), card_last4: csfLast4_(b.debit_card) };
  });
  return { on_file: onFile, closed: closed };
}

function csfFundKey_(fund) {
  return String(fund || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** `missing` is the ledger's missing-receipt count, or null when the ledger could not be read. */
function csfBalanceRows_(c, ledger, held, missing) {
  var funds = {};
  var bucket = function (f) {
    return funds[f] = funds[f] || { fund: f, deposits: 0, spending: 0, count: 0, first: '', last: '', missing: 0, after: 0 };
  };
  ledger.forEach(function (t) {
    var f = bucket(t.fund);
    f.count++;
    if (t.amount >= 0) f.deposits += t.amount; else f.spending += t.amount;
    if (t.status === 'Missing receipt') f.missing++;
    if (t.date && (!f.first || t.date < f.first)) f.first = t.date;
    if (t.date && t.date > f.last) f.last = t.date;
    var cl = held.closed[t.fund];
    if (cl && t.month > cl.month) f.after += t.amount;
  });
  Object.keys(held.closed).forEach(bucket);
  var rows = [];
  var of = held.on_file;
  if (of) {
    rows.push({
      id: 'bal-on-file', record: c.name, client: c.name, fund: '', date: '', personal_balance: of.total,
      missing_receipts: missing, status: 'On file', as_of: of.as_of, source: 'Client Finances › balances',
      details: [of.house !== null ? 'House ' + csfMoneyWords_(of.house) : '', of.office !== null ? 'Office ' + csfMoneyWords_(of.office) : '',
                of.as_of ? 'as of ' + of.as_of : 'no as-of date on the row', of.card_last4 ? 'card ending ' + of.card_last4 : '', of.note]
        .filter(String).join(' · '),
      card_last4: of.card_last4
    });
  }
  Object.keys(funds).sort().forEach(function (k) {
    var f = funds[k], cl = held.closed[k];
    var net = csfRound_(f.deposits + f.spending);
    var balance = cl && cl.closing !== null ? csfRound_(cl.closing + f.after) : null;
    rows.push({
      id: 'bal-' + csfFundKey_(k), record: c.name + ' · ' + k, client: c.name, fund: k, date: f.last,
      personal_balance: balance, missing_receipts: f.missing, recorded_net: net,
      deposits: csfRound_(f.deposits), spending: csfRound_(f.spending), transactions: f.count,
      status: balance !== null ? 'Closed through ' + cl.month : 'Opening unknown', source: 'Client Finances ledger',
      details: (f.count ? 'Recorded since ' + f.first + ': deposits ' + csfMoneyWords_(f.deposits) + ', spending ' +
                 csfMoneyWords_(f.spending) + ', net ' + csfMoneyWords_(net) : 'No transaction recorded') +
               (balance !== null ? '' : ' — no month is closed, so the opening balance is not known')
    });
  });
  return rows;
}

/** The client's Funds folder in client_files: receipts and invoices, and the statements behind the balances. */
function csfFundsDocs_(c) {
  var sheet = null;
  try { sheet = hubTabSheet_('client_files'); } catch (e) { sheet = null; }
  if (!sheet) return { receipts: null, statements: null, why: 'the client files house (client_files) could not be opened' };
  var rows;
  try {
    rows = csfColumns_(sheet, ['drive_id', 'title', 'folder', 'doc_kind', 'digest_category', 'client_key', 'client_name',
                               'file_date', 'modified_time']);
  } catch (e2) { return { receipts: null, statements: null, why: 'the client files could not be read (' + csfErr_(e2) + ')' }; }
  var receipts = [], statements = [];
  rows.forEach(function (r) {
    var ck = String(r.client_key || '').trim();
    var mine = ck ? ck === c.client_key : clientNameKey_(r.client_name) === c.name_key;
    if (!mine || !/^(funds|receipts)\b/i.test(String(r.folder || '').trim())) return;
    var id = csfDriveIdOf_(r.drive_id);
    if (!id) return;
    var kind = String(r.doc_kind || '').trim().toLowerCase();
    var title = csfSafe_(r.title, 160);
    var doc = { id: 'doc-' + id, file_id: id, record: title, date: csfDay_(r.file_date) || csfDay_(r.modified_time),
                kind: kind, folder: locationsText_(r.folder, 60), source: 'Client files › ' + locationsText_(r.folder, 60) };
    if (CSF_RECEIPT_KINDS.indexOf(kind) !== -1 || String(r.digest_category) === 'receipt_invoice' ||
        /\b(receipts?|invoices?|bill)\b/i.test(title)) receipts.push(doc);
    else if (CSF_STATEMENT_KINDS.indexOf(kind) !== -1) statements.push(doc);
  });
  var newest = function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); };
  return { receipts: receipts.sort(newest), statements: statements.sort(newest), why: '' };
}

function csfAnalytics_(ledger) {
  var byCat = {}, byMonth = {}, byVendor = {}, spends = 0, withReceipt = 0, exempt = 0;
  ledger.forEach(function (t) {
    var m = byMonth[t.month] = byMonth[t.month] || { month: t.month, spent: 0, deposits: 0 };
    if (t.amount >= 0) { m.deposits += t.amount; return; }
    m.spent += -t.amount;
    spends++;
    if (t.receipt.status === 'No receipt expected') exempt++;
    else if (t.receipt.status !== 'Missing receipt') withReceipt++;
    var cat = t.category || 'Uncategorized';
    byCat[cat] = byCat[cat] || { category: cat, spent: 0, count: 0 };
    byCat[cat].spent += -t.amount;
    byCat[cat].count++;
    var vk = String(t.vendor || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (vk) {
      byVendor[vk] = byVendor[vk] || { vendor: t.vendor, spent: 0, count: 0 };
      byVendor[vk].spent += -t.amount;
      byVendor[vk].count++;
    }
  });
  var list = function (o) { return Object.keys(o).map(function (k) { return o[k]; }); };
  var money = function (x) { x.spent = csfRound_(x.spent); if (x.deposits !== undefined) x.deposits = csfRound_(x.deposits); return x; };
  return {
    by_category: list(byCat).sort(function (a, b) { return b.spent - a.spent; }).map(money),
    monthly: list(byMonth).filter(function (m) { return !!m.month; })
      .sort(function (a, b) { return a.month < b.month ? -1 : 1; }).slice(-12).map(money),
    top_vendors: list(byVendor).sort(function (a, b) { return b.spent - a.spent; }).slice(0, 8).map(money),
    compliance: { spends: spends, with_receipt: withReceipt, exempt: exempt, missing: spends - withReceipt - exempt }
  };
}

function csfFundsBuild_(c) {
  var sources = [];
  var ledgerWhy = '';
  var ledger = [];
  if (c.shared) {
    ledgerWhy = csfSharedWhy_(c, 'Client Finances keeps its ledger');
  } else {
    var got = csfLedger_(c);
    ledgerWhy = got.why;
    ledger = got.rows;
    sources.push({ name: 'Client Finances ledger', app: 'Client Finances', readable: !got.why, why: got.why,
                   rows: got.why ? null : ledger.length });
    sources.push({ name: 'TrueLink Reconciliation', app: 'Client Finances', readable: !got.tl_why, why: got.tl_why, rows: null });
  }
  var held = { on_file: null, closed: {} }, heldWhy = '';
  try { held = csfBalancesOnFile_(c, listRows_('financeBalances', {})); }
  catch (eB) { heldWhy = 'the Client Finances balances (finance_balances) could not be read (' + csfErr_(eB) + ')'; }
  sources.push({ name: 'Client Finances balances', app: 'Client Finances', readable: !heldWhy, why: heldWhy,
                 rows: heldWhy ? null : (held.on_file ? 1 : 0) + Object.keys(held.closed).length });
  var docs = csfFundsDocs_(c);
  sources.push({ name: 'Funds folder', app: 'Clients (Drive) · Invoices', readable: !docs.why, why: docs.why,
                 rows: docs.why ? null : docs.receipts.length + docs.statements.length });

  var ledgerOk = !ledgerWhy;
  var asOf = ledger.length ? ledger[0].date : '';
  var txns = ledger;
  var spends = txns.filter(function (t) { return t.amount < 0; });
  var missing = ledgerOk ? txns.filter(function (t) { return t.status === 'Missing receipt'; }).length : null;
  var balances = ledgerOk ? csfBalanceRows_(c, txns, held, missing)
    : csfBalanceRows_(c, [], { on_file: held.on_file, closed: {} }, null);
  var balanceWhy = [ledgerOk ? '' : ledgerWhy, heldWhy].filter(String).join('; ');

  var receiptRows = spends.map(function (t) {
    return { id: 'rc-' + t.id, txn_id: t.id, record: t.record + ' · ' + t.fund, date: t.date, amount: t.amount,
             status: t.receipt.status, file_id: t.receipt.file_id, receipt_name: t.receipt.name,
             verdict: t.receipt.verdict, note: t.receipt.note, source: t.source,
             details: [t.receipt.name, t.receipt.verdict && t.receipt.verdict !== 'NONE' ? t.receipt.verdict : '', t.receipt.note]
               .filter(String).join(' · ') };
  });
  (docs.receipts || []).forEach(function (d) {
    receiptRows.push({ id: d.id, txn_id: '', record: d.record, date: d.date, amount: null, status: 'Filed',
                       file_id: d.file_id, receipt_name: d.record, verdict: '', note: '', source: d.source,
                       details: [d.kind ? d.kind.replace(/_/g, ' ') : 'document', d.source].join(' · ') });
  });
  receiptRows.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  var receiptWhy = [ledgerOk ? '' : ledgerWhy, docs.why].filter(String).join('; ');
  var count = function (list, status) { return list.filter(function (r) { return r.status === status; }).length; };

  var of = held.on_file;
  var kpis = { personal_balance: null, personal_balance_basis: '', personal_balance_as_of: '', personal_balance_why: '',
               missing_receipts: missing, transactions: ledgerOk ? txns.length : null };
  var fundRows = balances.filter(function (b) { return !!b.fund; });
  if (of && of.total !== null) {
    kpis.personal_balance = of.total;
    kpis.personal_balance_basis = 'on_file';
    kpis.personal_balance_as_of = of.as_of;
  } else if (ledgerOk && fundRows.length && fundRows.every(function (b) { return b.personal_balance !== null; })) {
    kpis.personal_balance = csfRound_(fundRows.reduce(function (s, b) { return s + b.personal_balance; }, 0));
    kpis.personal_balance_basis = 'closed_months';
    kpis.personal_balance_as_of = asOf;
  } else {
    kpis.personal_balance_why = heldWhy || (ledgerOk ? 'no balance is on file for ' + c.name +
      ' and no month is closed in Client Finances, so the ledger has no opening balance' : ledgerWhy);
  }

  var tabs = {
    balances: { rows: balances, kpis: { funds: fundRows.length, on_file: of ? 1 : 0 },
                as_of: of && of.as_of ? of.as_of : asOf },
    transactions: { rows: txns, statuses: CSF_TXN_STATUSES, as_of: asOf,
                    kpis: ledgerOk ? { count: txns.length, missing: missing,
                                       spent: csfRound_(spends.reduce(function (s, t) { return s - t.amount; }, 0)),
                                       deposits: csfRound_(txns.reduce(function (s, t) { return s + (t.amount > 0 ? t.amount : 0); }, 0)),
                                       first_date: txns.length ? txns[txns.length - 1].date : '', last_date: asOf } : {} },
    receipts: { rows: receiptRows, statuses: CSF_RECEIPT_STATUSES, as_of: asOf,
                kpis: { on_file: count(receiptRows, 'Receipt On File'), review: count(receiptRows, 'Needs review'),
                        missing: count(receiptRows, 'Missing receipt'), exempt: count(receiptRows, 'No receipt expected'),
                        filed: count(receiptRows, 'Filed') } }
  };
  if (balanceWhy) tabs.balances.why = balanceWhy;
  if (!ledgerOk) tabs.transactions.why = ledgerWhy;
  if (receiptWhy) tabs.receipts.why = receiptWhy;
  var documents = { rows: (docs.statements || []).map(function (d) {
    return { id: d.id, file_id: d.file_id, record: d.record, date: d.date, status: 'Filed', source: d.source,
             details: (d.kind ? d.kind.replace(/_/g, ' ') : 'document') + ' · ' + d.source };
  }) };
  if (docs.why) documents.why = docs.why;
  return {
    client: csfWho_(c), as_of: asOf, kpis: kpis, tabs: tabs, documents: documents,
    analytics: ledgerOk ? csfAnalytics_(txns) : null, sources: sources,
    degraded: !!(sources.some(function (s) { return !s.readable; }))
  };
}

function csfFunds_(c) {
  var deps = [cacheScope_('finance_transactions'), cacheScope_('finance_balances'), cacheScope_('client_files')];
  return csfCached_('clientSourceFunds', c.client_key, deps, function () { return csfFundsBuild_(c); });
}

// ---- billing ---------------------------------------------------------------

/** PSI HPC punches naming this client, as units (a quarter hour each) per day, and the first day any punch covers. */
function csfUnits_(c) {
  if (c.shared) {
    return { days: null, first: '', punches: 0, shared: true,
             why: csfSharedWhy_(c, 'the PSI punches record their consumers') };
  }
  var sheet = null;
  try { sheet = psiPunchesFullSheet_(); }
  catch (e) { return { days: null, first: '', punches: 0, why: 'the PSI punches could not be opened (' + csfErr_(e) + ')' }; }
  if (!sheet) return { days: null, first: '', punches: 0, why: 'the PSI punch house is not declared' };
  var rows;
  try { rows = csfColumns_(sheet, ['date_iso', 'date_service', 'hours', 'work_code', 'consumer_1', 'consumer_2', 'consumer_3']); }
  catch (e2) { return { days: null, first: '', punches: 0, why: 'the PSI punches could not be read (' + csfErr_(e2) + ')' }; }
  var days = {}, first = '', punches = 0;
  rows.forEach(function (r) {
    var day = csfDay_(r.date_iso) || csfDay_(r.date_service);
    if (!day) return;
    if (!first || day < first) first = day;
    var code = String(r.work_code || '').trim().toUpperCase();
    if (!code || CSF_NOT_SERVICE.indexOf(code) !== -1) return;
    var mine = [r.consumer_1, r.consumer_2, r.consumer_3].some(function (n) { return clientNameKey_(n) === c.name_key; });
    if (!mine) return;
    var h = Number(String(r.hours || '').replace(/[^\d.]/g, ''));
    if (!(h > 0)) return;
    days[day] = (days[day] || 0) + h * 4;
    punches++;
  });
  return { days: days, first: first, punches: punches, why: '' };
}

function csfUnitsIn_(units, start, end, today) {
  if (!units.days || !units.first || !start) return { used: null, from: '' };
  var stop = end && end < today ? end : today;
  if (stop < units.first) return { used: null, from: '' };
  var from = start < units.first ? units.first : start;
  var sum = 0;
  Object.keys(units.days).forEach(function (d) { if (d >= from && d <= stop) sum += units.days[d]; });
  return { used: Math.round(sum), from: from };
}

function csfAuthRow_(x, today, units) {
  var start = x.span ? x.span.start : '', end = x.span ? x.span.end : '';
  var status = end ? csfSpanStatus_(end, today) : 'Unknown';
  var u = x.kind === 'isp' ? { used: null, from: '' } : csfUnitsIn_(units, start, end, today);
  var parts = [];
  if (!x.span && x.span_text) parts.push('Span as written: ' + x.span_text);
  if (x.amount_authorized !== null && x.amount_authorized !== undefined) parts.push('Authorized ' + csfMoneyWords_(x.amount_authorized));
  if (x.units_projected !== null && x.units_projected !== undefined) {
    parts.push('Projected ' + Math.round(x.units_projected) + ' units' +
               (x.amount_projected !== null ? ' (' + csfMoneyWords_(x.amount_projected) + ')' : '') +
               (x.percent !== null ? ', ' + x.percent + '% over' : ''));
  }
  if (x.ssa) parts.push('SSA ' + x.ssa);
  if (x.match === 'near') parts.push('Matched "' + x.cell + '" by a near spelling');
  if (u.from && u.from !== start) parts.push('Units used counted from ' + u.from + ', the first PSI punch on the platform');
  if (x.notes) parts.push(x.notes);
  return {
    id: x.id, record: x.record, date: start, span_start: start, span_end: end,
    days_left: end ? csfDays_(today, end) : null, units_used: u.used, units_used_from: u.from,
    units_authorized: x.units_authorized === undefined ? null : x.units_authorized,
    amount_authorized: x.amount_authorized === undefined ? null : x.amount_authorized,
    units_projected: x.units_projected === undefined ? null : x.units_projected,
    amount_projected: x.amount_projected === undefined ? null : x.amount_projected,
    percent: x.percent === undefined ? null : x.percent, ssa: x.ssa || '', notes: x.notes || '',
    status: status, kind: x.kind, source: x.source, match: x.match || 'exact', renewal_due: false,
    details: parts.join(' · ')
  };
}

/** `pawsWhys` holds why a PAWS span may be missing; while it is not empty, renewals_due is null, never a partial count. */
function csfAuthorizations_(c, today, units) {
  var rows = [], whys = [], sources = [], pawsWhys = [];
  if (c.shared) {
    pawsWhys.push(csfSharedWhy_(c, 'PAWS Adjustments and Client Database › Sheet6 keep their spans'));
  } else {
    var pawsId = locationsBookId_(CSF_PAWS_PROP, CSF_PAWS_FALLBACK);
    try {
      var n = 0;
      csfTab_(pawsId, CSF_PAWS_TAB, ['Name', 'Span']).forEach(function (r) {
        var match = csfNameMatch_(r.Name, c);
        if (!match) return;
        n++;
        rows.push(csfAuthRow_({ id: 'paws-' + r._row, kind: 'paws', record: 'PAWS authorization', span: csfSpan_(r.Span),
          span_text: locationsText_(r.Span, 60), units_authorized: csfNumber_(r['Authorized (un)']),
          amount_authorized: csfMoney_(r['Authorized $']), units_projected: csfNumber_(r['Projected (un)']),
          amount_projected: csfMoney_(r['Projected $']), percent: csfPercent_(r['%']), notes: csfSafe_(r.Notes, 400),
          match: match, cell: locationsText_(r.Name, 80), source: 'PAWS Adjustments' }, today, units));
      });
      sources.push({ name: 'PAWS Adjustments', app: 'Finances › Internal Analysis', readable: true, why: '', rows: n });
    } catch (e) {
      var w = 'PAWS Adjustments could not be read (' + csfErr_(e) + ')';
      pawsWhys.push(w);
      sources.push({ name: 'PAWS Adjustments', app: 'Finances › Internal Analysis', readable: false, why: w, rows: null });
    }
    var dbId = locationsBookId_(CSF_CLIENT_DB_PROP, CSF_CLIENT_DB_FALLBACK);
    try {
      var m = 0;
      csfTab_(dbId, CSF_SPANS_TAB, ['Client', 'Span']).forEach(function (r) {
        if (String(r.Client || '').trim().toLowerCase() === 'client') return;
        var match = csfNameMatch_(r.Client, c);
        if (!match) return;
        m++;
        rows.push(csfAuthRow_({ id: 'span-' + r._row, kind: 'paws', record: 'PAWS span', span: csfSpan_(r.Span),
          span_text: locationsText_(r.Span, 60), units_authorized: csfNumber_(r.Units), amount_authorized: csfMoney_(r.$),
          units_projected: null, amount_projected: null, percent: null, ssa: locationsText_(r.SSA, 80),
          notes: '', match: match, cell: locationsText_(r.Client, 80), source: 'Client Database › Sheet6' }, today, units));
      });
      sources.push({ name: 'Client Database › Sheet6', app: 'Clients (Asa Client Database)', readable: true, why: '', rows: m });
    } catch (e2) {
      var w2 = 'Client Database › Sheet6 could not be read (' + csfErr_(e2) + ')';
      pawsWhys.push(w2);
      sources.push({ name: 'Client Database › Sheet6', app: 'Clients (Asa Client Database)', readable: false, why: w2, rows: null });
    }
  }
  whys = whys.concat(pawsWhys);
  var isp = csfSpan_(c.isp_year);
  if (isp) {
    rows.push(csfAuthRow_({ id: 'isp', kind: 'isp', record: 'ISP span', span: isp, span_text: '', ssa: c.ssa_name,
                            notes: '', source: 'ISP' }, today, units));
  }
  sources.push({ name: 'ISP span', app: 'Clients', readable: true, rows: isp ? 1 : 0,
                 why: isp ? '' : (c.isp_year ? 'the ISP span could not be read from "' + c.isp_year.slice(0, 80) + '"' : 'no ISP span is on file') });
  if (!units.shared) {
    if (units.why) whys.push('units used are unknown: ' + units.why);
    sources.push({ name: 'PSI punches', app: 'PSI Punches', readable: !units.why, why: units.why,
                   rows: units.days ? units.punches : null, from: units.first });
  }

  var latest = {};
  rows.forEach(function (r) {
    if (!r.span_end) return;
    if (!latest[r.kind] || r.span_end > latest[r.kind].span_end) latest[r.kind] = r;
  });
  var due = null;
  if (!pawsWhys.length) {
    due = 0;
    Object.keys(latest).forEach(function (k) {
      if (latest[k].status === 'Renewal due' || latest[k].status === 'Expired') { latest[k].renewal_due = true; due++; }
    });
  }
  rows.sort(function (a, b) { return (a.span_end || '') < (b.span_end || '') ? 1 : ((a.span_end || '') > (b.span_end || '') ? -1 : 0); });
  return { rows: rows, whys: whys, sources: sources, renewals_due: due,
           renewals_due_why: pawsWhys.length ? 'not counted, because ' + pawsWhys.join('; ') : '' };
}

/** DODD MBS report text as claim lines and EVV lines; the Medicaid number stays in here for the join. */
function csfMbsParse_(lines) {
  var claims = [], evv = [], cycle = '', last = null;
  (lines || []).forEach(function (raw) {
    var line = String(raw == null ? '' : raw);
    var cy = CSF_MBS_CYCLE.exec(line);
    if (cy) { cycle = cy[1]; last = null; return; }
    var m = CSF_MBS_CLAIM.exec(line);
    if (m) {
      var rate = Number(m[11]), units = Number(m[12]);
      last = { mcd: m[4], cycle: cycle, billing_date: csfDay_(m[5]), service_date: csfDay_(m[6]), service_code: m[7],
               group_size: Number(m[8]), staff_size: Number(m[9]), county: m[10], unit_rate: rate, units: units,
               amount: csfRound_(rate * units), errors: [] };
      claims.push(last);
      return;
    }
    var er = CSF_MBS_ERROR.exec(line);
    if (er && last) { last.errors.push({ code: er[1], text: locationsText_(er[2], 160) }); return; }
    if (/^\s*-{10,}/.test(line)) { last = null; return; }
    var ev = CSF_EVV_LINE.exec(line);
    if (ev) {
      evv.push({ mcd: ev[1], cycle: cycle, service_date: csfDay_(ev[2]), units_billed: csfNumber_(ev[3]),
                 evv_units: csfNumber_(ev[4]), additional_needed: csfNumber_(ev[5]), error_code: ev[6] });
    }
  });
  return { claims: claims, evv: evv };
}

function csfMbsSheet_(id) {
  return cacheRead_(cacheScopeSheet_(id, CSF_MBS_TAB), 'csf_mbs', function () {
    var sheet = ssOpen_(id).getSheetByName(CSF_MBS_TAB);
    if (!sheet) throw new Error('the book has no ' + CSF_MBS_TAB + ' tab');
    return csfMbsParse_(sheet.getDataRange().getValues().map(function (row) { return String(row[0] == null ? '' : row[0]); }));
  });
}

/** Finances › Billing › Billing Errors, where each MBS cycle's reports are dropped. */
function csfMbsFolder_() {
  var rootId = '';
  try { rootId = String(hubId_('FIN_DRIVE_ROOT_ID') || '').trim(); } catch (e) { rootId = ''; }
  if (!rootId) return { folder: null, why: 'the Finances folder is not configured (FIN_DRIVE_ROOT_ID)' };
  var folder = DriveApp.getFolderById(rootId);
  for (var i = 0; i < CSF_MBS_PATH.length; i++) {
    var it = folder.getFoldersByName(CSF_MBS_PATH[i]);
    if (!it.hasNext()) return { folder: null, why: 'Finances › ' + CSF_MBS_PATH.slice(0, i + 1).join(' › ') + ' is not there' };
    folder = it.next();
  }
  return { folder: folder, why: '' };
}

/** At most CSF_MBS_MAX reports are parsed; `left` counts the ones past it, which leave the claims incomplete. */
function csfMbsReports_() {
  var got = csfMbsFolder_();
  if (!got.folder) return { reports: null, left: 0, why: got.why };
  var files = got.folder.getFiles(), out = [], left = 0;
  while (files.hasNext()) {
    var f = files.next();
    var name = String(f.getName());
    if (!/^(ERROR_DETAIL|EVV_INFO)_/i.test(name)) continue;
    if (out.length >= CSF_MBS_MAX) { left++; continue; }
    var id = String(f.getId());
    var stamp = f.getLastUpdated();
    var parsed = cacheRead_('csf_mbs_' + id, 'v' + stamp.getTime(), function () {
      return csfMbsParse_(String(f.getBlob().getDataAsString()).split(/\r?\n/));
    });
    out.push({ id: id, name: name, modified: stamp.toISOString(), parsed: parsed });
  }
  return { reports: out, left: left, why: '' };
}

function csfClaimRow_(x, n, source) {
  var errors = (x.errors || []).map(function (e) { return { code: e.code, text: e.text }; });
  return {
    id: 'mbs-' + n, record: x.service_code + ' · ' + (x.cycle || 'billed ' + x.billing_date), date: x.service_date,
    amount: x.amount, units: x.units, unit_rate: x.unit_rate, cycle: x.cycle, billing_date: x.billing_date,
    service_code: x.service_code, group_size: x.group_size, staff_size: x.staff_size, errors: errors,
    status: 'Rejected', source: source, evv: null, evv_fix: null,
    details: errors.map(function (e) { return '(' + e.code + ') ' + e.text; }).join(' · ') || 'Rejected by MBS'
  };
}

/** `partial` holds why the claim lines may be incomplete; while it is not empty the unpaid sum is null, never a part of it. */
function csfClaims_(c) {
  var rows = [], whys = [], partial = [], sources = [], evv = [];
  var seen = {}, n = 0;
  // `from` is the copy a line was read from (a Drive file id or the sheet): a line two copies carry is kept once.
  var take = function (list, source, from) {
    (list || []).forEach(function (x) {
      if (x.mcd !== c.medicaid_id) return;
      var key = [x.billing_date, x.service_date, x.service_code, x.units, x.unit_rate,
                 (x.errors || []).map(function (e) { return e.code; }).join('+')].join('|');
      if (seen[key] && seen[key] !== from) return;
      seen[key] = from;
      rows.push(csfClaimRow_(x, ++n, source));
    });
  };
  var miss = function (w) { whys.push(w); partial.push(w); };
  if (!c.medicaid_id) {
    miss('the ISP carries no Medicaid number for ' + c.name + ', so the MBS claim lines cannot be joined');
  } else {
    try {
      var rep = csfMbsReports_();
      if (!rep.reports) {
        miss(rep.why);
        sources.push({ name: 'MBS reports', app: 'Finances › Billing', readable: false, why: rep.why, rows: null });
      } else {
        rep.reports.sort(function (a, b) { return a.modified < b.modified ? 1 : -1; });
        rep.reports.forEach(function (r) {
          var before = rows.length, evvBefore = evv.length;
          take(r.parsed.claims, r.name, 'file:' + r.id);
          r.parsed.evv.forEach(function (e) { if (e.mcd === c.medicaid_id) evv.push(e); });
          sources.push({ name: r.name, app: 'Finances › Billing › Billing Errors', readable: true, why: '',
                         rows: rows.length - before + evv.length - evvBefore, as_of: r.modified.slice(0, 10) });
        });
        if (rep.left) {
          var wl = rep.left + ' more MBS report(s) in Finances › Billing › Billing Errors were not read (the read stops at ' +
                   CSF_MBS_MAX + ')';
          miss(wl);
          sources.push({ name: 'MBS reports', app: 'Finances › Billing', readable: false, why: wl, rows: null });
        }
      }
    } catch (eR) {
      var wr = 'the MBS reports in Finances › Billing could not be read (' + csfErr_(eR) + ')';
      miss(wr);
      sources.push({ name: 'MBS reports', app: 'Finances › Billing', readable: false, why: wr, rows: null });
    }
    var mbsId = locationsBookId_(CSF_MBS_PROP, CSF_MBS_FALLBACK);
    try {
      var before2 = rows.length;
      take(csfMbsSheet_(mbsId).claims, 'Billing Errors', 'sheet:' + mbsId);
      sources.push({ name: 'Billing Errors', app: 'Finances › Billing', readable: true, why: '', rows: rows.length - before2 });
    } catch (eS) {
      var ws = 'the Billing Errors book could not be read (' + csfErr_(eS) + ')';
      miss(ws);
      sources.push({ name: 'Billing Errors', app: 'Finances › Billing', readable: false, why: ws, rows: null });
    }
  }
  evv.forEach(function (e) {
    rows.forEach(function (r) {
      if (r.date === e.service_date && (!e.cycle || !r.cycle || e.cycle === r.cycle)) {
        r.evv = { units_billed: e.units_billed, evv_units: e.evv_units, additional_needed: e.additional_needed, error_code: e.error_code };
      }
    });
  });
  if (c.last_name && !c.last_name_shared) {
    try {
      var fixes = 0;
      csfTab_(locationsBookId_(CSF_MBS_PROP, CSF_MBS_FALLBACK), CSF_EVV_TAB, ['Client', 'Date']).forEach(function (f) {
        if (String(f.Client || '').trim().toLowerCase() !== c.last_name) return;
        var day = csfDay_(f.Date);
        fixes++;
        rows.forEach(function (r) {
          if (r.date !== day) return;
          r.evv_fix = { billed: csfNumber_(f.Billed), evv: csfNumber_(f.EVV), additional_needed: csfNumber_(f['Additional Needed']),
                        notes: csfSafe_(f.Notes, 240) };
          r.details += ' · on the EVV Fixes list';
        });
      });
      sources.push({ name: 'EVV Fixes', app: 'Finances › Billing', readable: true, why: '', rows: fixes });
    } catch (eF) {
      sources.push({ name: 'EVV Fixes', app: 'Finances › Billing', readable: false, why: 'the EVV Fixes tab could not be read (' + csfErr_(eF) + ')', rows: null });
    }
  }
  var table = null, tableWhy = '';
  try { table = hubTabSheet_('billing_claims'); } catch (eT) { table = null; tableWhy = 'billing_claims could not be opened (' + csfErr_(eT) + ')'; }
  var drafts = null, sharedWhy = '';
  if (table && c.shared) {
    sharedWhy = csfSharedWhy_(c, 'billing_claims keeps its claims');
    miss(sharedWhy);
  } else if (table) {
    drafts = 0;
    var words = { draft: 'Draft', submitted: 'Submitted', paid: 'Paid', denied: 'Denied', rejected: 'Rejected' };
    locationsTabRows_(table).forEach(function (r) {
      if (csfNameMatch_(r.client, c) !== 'exact') return;
      var st = words[String(r.status || '').trim().toLowerCase()] || 'Submitted';
      if (st === 'Draft') drafts++;
      var start = csfDay_(r.spanStart), end = csfDay_(r.spanEnd);
      rows.push({ id: 'claim-' + locationsText_(r.id || r._row, 60), record: 'Claim · ' + (csfSafe_(r.payer, 60) || 'payer not named'),
                  date: start, amount: csfMoney_(r.amount), units: csfNumber_(r.units), unit_rate: null, cycle: '',
                  billing_date: '', service_code: '', errors: [], status: st, source: 'billing_claims', evv: null, evv_fix: null,
                  details: [start && end ? start + ' to ' + end : '', csfSafe_(r.payer, 60)].filter(String).join(' · ') });
    });
  }
  sources.push({ name: 'billing_claims', app: 'Billing & Payers', readable: !!table,
                 why: table ? sharedWhy : (tableWhy || 'no claims table exists yet'),
                 rows: drafts !== null ? rows.filter(function (r) { return r.source === 'billing_claims'; }).length : null });
  rows.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  var asOf = '';
  rows.forEach(function (r) { if (r.billing_date && r.billing_date > asOf) asOf = r.billing_date; });
  return { rows: rows, whys: whys, partial: partial, sources: sources, drafts: drafts, as_of: asOf,
           drafts_why: table ? sharedWhy : 'no claim is drafted on the platform — the billing_claims table does not exist yet' };
}

function csfBillingBuild_(c) {
  var today = locationsToday_();
  var units = csfUnits_(c);
  var auth = csfAuthorizations_(c, today, units);
  var claims = csfClaims_(c);
  var unpaidRows = claims.rows.filter(function (r) { return ['Rejected', 'Submitted', 'Denied'].indexOf(r.status) !== -1; });
  var whole = !claims.partial.length;
  var unpaid = whole ? csfRound_(unpaidRows.reduce(function (s, r) { return s + (r.amount || 0); }, 0)) : null;
  var tabs = {
    authorizations: { rows: auth.rows, statuses: CSF_AUTH_STATUSES, as_of: today,
                      kpis: { renewals_due: auth.renewals_due, spans: auth.rows.length } },
    claims: { rows: claims.rows, statuses: CSF_CLAIM_STATUSES, as_of: claims.as_of,
              kpis: { rejected: whole ? claims.rows.filter(function (r) { return r.status === 'Rejected'; }).length : null,
                      drafts: claims.drafts, unpaid: unpaid } }
  };
  if (auth.whys.length) tabs.authorizations.why = auth.whys.join('; ');
  if (claims.whys.length) tabs.claims.why = claims.whys.join('; ');
  var sources = auth.sources.concat(claims.sources);
  return {
    client: csfWho_(c), today: today,
    kpis: { renewals_due: auth.renewals_due, renewals_due_why: auth.renewals_due_why,
            draft_claims: claims.drafts, draft_claims_why: claims.drafts_why,
            unpaid_claims: unpaid, unpaid_claims_why: whole ? '' : 'not summed, because ' + claims.partial.join('; '),
            unpaid_claims_basis: 'rejected MBS lines and unpaid claims; no remittance is on the platform' },
    tabs: tabs, sources: sources,
    degraded: sources.some(function (s) { return !s.readable && s.name !== 'billing_claims' && s.name !== 'ISP span'; })
  };
}

// ---- the doors -------------------------------------------------------------

/** Client Funds for one client: Balances, Transactions and Receipts from Client Finances' ledger, balances and the client's Funds folder. */
HUB_POLICY.clientSourceFunds = {
  file: 'ClientSourceFinance.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' } }
};
HUB_ACTIONS.clientSourceFunds = function (payload, user) {
  if (!csfGate_(user, payload && payload.client)) return csfUnknown_();
  return csfFundsDoor_(payload);
};

/** Past the gate — the door's answer, and the relay pack's part (clientPack). */
function csfFundsDoor_(payload) {
  var c = csfClient_(payload && payload.client);
  if (c.refused) return c.refused;
  var data;
  try { data = csfFunds_(c); }
  catch (e) { return { status: 503, message: 'Client Funds could not be read just now (' + csfErr_(e) + ').' }; }
  return { status: 200, data: data };
}

/** Billing for one client: Authorizations (PAWS spans, the ISP span, units used from PSI) and Claims (the MBS error reports, billing_claims). */
HUB_POLICY.clientSourceBilling = {
  file: 'ClientSourceFinance.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' } }
};
HUB_ACTIONS.clientSourceBilling = function (payload, user) {
  if (!csfGate_(user, payload && payload.client, true)) return csfUnknown_();
  return csfBillingDoor_(payload);
};

/** Past the gate — the door's answer, and the relay pack's part (clientPack). */
function csfBillingDoor_(payload) {
  var c = csfClient_(payload && payload.client);
  if (c.refused) return c.refused;
  var data;
  try { data = csfCached_('clientSourceBilling', c.client_key, [], function () { return csfBillingBuild_(c); }); }
  catch (e) { return { status: 503, message: 'Billing could not be read just now (' + csfErr_(e) + ').' }; }
  return { status: 200, data: data };
}

// One receipt or funds document of the client, as bytes for the platform's own viewer: only a file this client's…
HUB_POLICY.clientSourceFinanceFile = {
  file: 'ClientSourceFinance.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' }, id: { type: 'string' } }
};
HUB_ACTIONS.clientSourceFinanceFile = function (payload, user) {
  if (!csfGate_(user, payload && payload.client)) return csfUnknown_();
  var c = csfClient_(payload && payload.client);
  if (c.refused) return c.refused;
  var id = locationsText_(payload && payload.id, 120);
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return { status: 400, message: 'id: a Drive file id.' };
  var funds;
  try { funds = csfFunds_(c); }
  catch (e) { return { status: 503, message: 'Client Funds could not be read just now (' + csfErr_(e) + ').' }; }
  if (!csfFileKnown_(funds, id)) return { status: 404, message: 'This client\'s funds name no such document.' };
  var got;
  try { got = locationsDocBytes_(id); }
  catch (e2) {
    var gone = /not found|no item|does not exist|trashed/i.test(csfErr_(e2));
    return gone ? { status: 404, message: 'The file is no longer in the drive.' }
                : { status: 503, message: 'The document could not be opened just now — try again in a minute.' };
  }
  if (got.refused) return got.refused;
  return { status: 200, data: { id: id, name: csfSafe_(got.name, 200), mime: got.mime, size: got.size, exported: got.exported,
                                b64: got.b64 } };
};

function csfFileKnown_(funds, id) {
  var tabs = (funds && funds.tabs) || {};
  var inRows = function (rows) { return (rows || []).some(function (r) { return r.file_id === id; }); };
  if (inRows(tabs.receipts && tabs.receipts.rows) || inRows(funds && funds.documents && funds.documents.rows)) return true;
  return ((tabs.transactions && tabs.transactions.rows) || []).some(function (t) { return t.receipt && t.receipt.file_id === id; });
}
