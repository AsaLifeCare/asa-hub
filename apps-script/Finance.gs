// A fund is an account: a misspelled fund opens a second bucket, so these lists are a floor.
var FIN_FUND_TYPES = ['Debit Card', 'Cash', 'Food Stamps'];
var FIN_TXN_TYPES = ['Spending', 'Deposit', 'Withdraw'];
var FIN_CATEGORIES = ['Food', 'Entertainment', 'Medical', 'Supplies & Personal Care',
                      'Transportation', 'Clothing & Accessories', 'Bank Fees', 'Other'];

// UNREADABLE is a real answer; a verdict is never guessed.
var FIN_VERDICTS = ['MATCH', 'POSSIBLE_MATCH', 'MISMATCH', 'UNREADABLE', 'NONE', 'EXEMPT'];

// A closed list: a free-text excuse is unauditable.
var FIN_EXEMPT_REASONS = ['Lost', 'Not Provided', 'Recurring/Subscription',
                          'Online Purchase', 'Other'];

var FIN_FOLDER_PROP = 'FINANCE_RECEIPTS_FOLDER_ID';

// Optional: a wrong id falls back, so a receipt still saves.
var FIN_HOME_PROP = 'HUB_DRIVE_HOME';

/* ───────────────────────── money helpers ───────────────────────── */

function finNum_(v) {
  var n = Number(String(v === null || v === undefined ? '' : v).replace(/[,$\s]/g, ''));
  return isFinite(n) ? n : 0;
}

// Never new Date(s): a bare date parses as UTC midnight and slips into the previous month.
function finMonthOf_(dateStr) {
  var m = /^(\d{4})-(\d{2})/.exec(String(dateStr || '').trim());
  return m ? m[1] + '-' + m[2] : '';
}
function finPrevMonth_(month) {
  var p = String(month).split('-'), y = Number(p[0]), m = Number(p[1]);
  return m === 1 ? (y - 1) + '-12' : y + '-' + ('0' + (m - 1)).slice(-2);
}
function finNextMonth_(month) {
  var p = String(month).split('-'), y = Number(p[0]), m = Number(p[1]);
  return m === 12 ? (y + 1) + '-01' : y + '-' + ('0' + (m + 1)).slice(-2);
}

// Admin and manager only, which is also why neither resource is snapshotted.
function finMayUse_(user) {
  if (!user || user.is_service) return false;
  return user.role === 'admin' || user.role === 'manager';
}

function finClients_(user) {
  var out = [];
  try {
    clientsDerived_(user).forEach(function (c) {
      out.push({ id: str_(c.id), name: str_(c.name), house: str_(c.house || c.house_name),
                 status: str_(c.status) });
    });
  } catch (e) { return []; }
  out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return out;
}

function finTxnsFor_(client, month) {
  var want = str_(client).toLowerCase();
  return listRows_('financeTransactions', {}).filter(function (r) {
    if (str_(r.client).toLowerCase() !== want) return false;
    return !month || str_(r.month) === month;
  }).map(function (r) {
    var amount = finNum_(r.amount);
    return {
      id: str_(r.id), client: str_(r.client), date: str_(r.date), month: str_(r.month),
      type: str_(r.type), fundType: str_(r.fundType), amount: amount,
      vendor: str_(r.vendor), category: str_(r.category), description: str_(r.description),
      staffMember: str_(r.staffMember), receiptName: str_(r.receiptName),
      receiptVerdict: str_(r.receiptVerdict), receiptNote: str_(r.receiptNote),
      needsReceipt: amount < 0 && !str_(r.receiptName)
    };
  }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
}

function finBalancesFor_(client) {
  var want = str_(client).toLowerCase();
  return listRows_('financeBalances', {}).filter(function (r) {
    return str_(r.client).toLowerCase() === want;
  });
}

// Computed from transactions, never a stored total; opening comes only from the previous CLOSED row.
function finLedger_(client, month) {
  var txns = finTxnsFor_(client, month);
  var prev = finPrevMonth_(month);
  var byFund = {};
  function bucket(ft) {
    if (!byFund[ft]) byFund[ft] = { fundType: ft, opening: 0, deposits: 0, spending: 0,
                                    closing: 0, count: 0, openingKnown: false };
    return byFund[ft];
  }
  finBalancesFor_(client).forEach(function (b) {
    if (str_(b.month) === prev && str_(b.status) === 'Closed') {
      var k = bucket(str_(b.fundType));
      k.opening = finNum_(b.closing);
      k.openingKnown = true;
    }
  });
  txns.forEach(function (t) {
    var k = bucket(t.fundType || 'Debit Card');
    k.count++;
    if (t.amount >= 0) k.deposits += t.amount; else k.spending += t.amount;
  });
  var funds = Object.keys(byFund).map(function (key) {
    var b = byFund[key];
    b.closing = b.opening + b.deposits + b.spending;
    return b;
  });
  var closed = finBalancesFor_(client).some(function (b) {
    return str_(b.month) === month && str_(b.status) === 'Closed';
  });
  return { client: client, month: month, funds: funds, transactions: txns, closed: closed,
           missingReceipts: txns.filter(function (t) { return t.needsReceipt; }).length };
}

/* ───────────────────────── receipts: OCR ───────────────────────── */

function finReceiptFolder_() {
  var id = str_(hubProp_(FIN_FOLDER_PROP));
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) {}
  }
  var folder = null;
  var home = str_(hubProp_(FIN_HOME_PROP));
  if (home) {
    try { folder = DriveApp.getFolderById(home).createFolder('ASA Hub — Client Receipts'); }
    catch (eH) { folder = null; }
  }
  if (!folder && typeof filesRoot_ === 'function') {
    try { folder = filesRoot_().createFolder('ASA Hub — Client Receipts'); }
    catch (eR) { folder = null; }
  }
  if (!folder) folder = DriveApp.createFolder('ASA Hub — Client Receipts');
  hubPropSet_(FIN_FOLDER_PROP, folder.getId());
  return folder;
}

// OCR through a temporary Google Doc copy: no API key, no per-page cost.
function finReceiptText_(fileId) {
  var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  var copy = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '/copy', {
    method: 'post', contentType: 'application/json', headers: auth,
    payload: JSON.stringify({ mimeType: 'application/vnd.google-apps.document', name: 'fin-ocr-tmp' }),
    muteHttpExceptions: true });
  if (copy.getResponseCode() >= 400) return '';
  var docId = '';
  try { docId = JSON.parse(copy.getContentText()).id; } catch (e) { return ''; }
  var text = '';
  try {
    var exp = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + docId + '/export?mimeType=text%2Fplain',
      { headers: auth, muteHttpExceptions: true });
    if (exp.getResponseCode() < 400) text = exp.getContentText();
  } catch (e) { text = ''; }
  try {
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + docId,
                      { method: 'delete', headers: auth, muteHttpExceptions: true });
  } catch (e) {}
  return text;
}

// Pattern pass first; the model reads text only when no number is found, and never guesses.
function finReceiptVerdict_(text, amount, vendor) {
  var want = Math.abs(finNum_(amount));
  var body = String(text || '');
  if (!body.trim()) return { verdict: 'UNREADABLE', note: 'Nothing could be read from the image.' };

  var found = [];
  var re = /(?:\$\s*)?(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/g;
  var m;
  while ((m = re.exec(body)) !== null) found.push(finNum_(m[1]));

  if (found.length) {
    for (var i = 0; i < found.length; i++) {
      if (Math.abs(found[i] - want) < 0.005) {
        var seen = vendor && body.toLowerCase().indexOf(String(vendor).toLowerCase().slice(0, 6)) !== -1;
        return { verdict: 'MATCH',
                 note: 'The receipt shows ' + want.toFixed(2) + (seen ? ' and names the vendor.' : '.') };
      }
    }
    var near = found.sort(function (a, b) { return Math.abs(a - want) - Math.abs(b - want); })[0];
    return { verdict: 'MISMATCH',
             note: 'Typed ' + want.toFixed(2) + '; the closest total on the receipt is ' + near.toFixed(2) + '.' };
  }

  if (typeof screenAiChat_ !== 'function') {
    return { verdict: 'UNREADABLE', note: 'No total could be read.' };
  }
  var ask = 'This is OCR text from a shop receipt. Reply with JSON only: ' +
            '{"total": <number or null>, "vendor": "<name or empty>"}. ' +
            'The total is what the customer paid. If you cannot tell, use null.\n\n' + body.slice(0, 4000);
  var res = null;
  try { res = screenAiChat_(ask, 0, 'ai_receipt_verdict'); } catch (e) { res = null; }
  if (!res || !res.ok) return { verdict: 'UNREADABLE', note: 'No total could be read.' };
  var parsed = null;
  try { parsed = JSON.parse(res.content); } catch (e) { parsed = null; }
  var total = parsed && parsed.total !== null && parsed.total !== undefined ? finNum_(parsed.total) : null;
  if (total === null) return { verdict: 'UNREADABLE', note: 'No total could be read (' + str_(res.via) + ').' };
  if (Math.abs(total - want) < 0.005) {
    return { verdict: 'MATCH', note: 'Read as ' + total.toFixed(2) + ' via ' + str_(res.via) + '.' };
  }
  return { verdict: 'POSSIBLE_MATCH',
           note: 'Typed ' + want.toFixed(2) + '; read ' + total.toFixed(2) + ' via ' + str_(res.via) + ' — please check.' };
}

/* ───────────────────────── actions ───────────────────────── */

/** The client list plus the current vocabularies — what the screen boots with. */
HUB_POLICY.finClients = {
  file: 'Finance.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.finClients = function (payload, user) {
  if (!finMayUse_(user)) return hubDenied_();
  var v = finVocabulary_();
  return { status: 200, data: { clients: finClients_(user), fundTypes: v.fundTypes,
                                categories: v.categories, txnTypes: v.txnTypes,
                                exemptReasons: v.exemptReasons } };
};

/** One client's month: funds, transactions, whether it is closed. */
HUB_POLICY.finLedger = {
  file: 'Finance.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.finLedger = function (payload, user) {
  if (!finMayUse_(user)) return hubDenied_();
  var client = str_(payload && payload.client);
  if (!client) return { status: 400, message: 'Which client?' };
  var month = str_(payload && payload.month) ||
              Utilities.formatDate(new Date(), hiringTimeZone_(), 'yyyy-MM');
  return { status: 200, data: finLedger_(client, month) };
};

// Spending and Withdraw are stored negative: closing = opening + deposits + spending relies on it.
HUB_POLICY.finSubmitTransaction = {
  file: 'Finance.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  // Never snapshotted, so no slices; SheetDb's cache version bump keeps reads fresh.
  invalidates: [], emits: []
};
HUB_ACTIONS.finSubmitTransaction = function (payload, user) {
  if (!finMayUse_(user)) return hubDenied_();
  var p = payload || {};
  var client = str_(p.client), date = str_(p.date), type = str_(p.type), fund = str_(p.fundType);

  if (!client) return { status: 400, message: 'Client is required.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { status: 400, message: 'Date must be YYYY-MM-DD.' };
  if (FIN_TXN_TYPES.indexOf(type) === -1) return { status: 400, message: 'Type must be one of: ' + FIN_TXN_TYPES.join(', ') + '.' };
  var funds = finVocabulary_().fundTypes;
  if (funds.indexOf(fund) === -1) return { status: 400, message: 'Fund must be one of: ' + funds.join(', ') + '.' };

  var amount = finNum_(p.amount);
  if (!(amount > 0)) return { status: 400, message: 'Amount must be a positive number.' };
  if (type === 'Spending' || type === 'Withdraw') amount = -Math.abs(amount);

  var receiptName = '', verdict = 'NONE', note = '', fileId = '';
  if (str_(p.receiptBase64) && str_(p.receiptMime)) {
    try {
      var ext = '.jpg';
      var fn = str_(p.receiptFileName);
      if (fn && fn.indexOf('.') >= 0) ext = fn.substring(fn.lastIndexOf('.')).toLowerCase();
      var clean = function (s) { return str_(s).replace(/[\/\\?<>:*|"]/g, ' '); };
      var name = clean(client) + ' - ' + date + ' - ' + (clean(p.vendor) || 'Manual') + ' - ' +
                 Math.abs(amount).toFixed(2) + ext;
      var blob = Utilities.newBlob(Utilities.base64Decode(p.receiptBase64), str_(p.receiptMime), name);
      var file = finReceiptFolder_().createFile(blob);
      fileId = file.getId();
      receiptName = file.getName();
      var read = finReceiptVerdict_(finReceiptText_(fileId), amount, str_(p.vendor));
      verdict = read.verdict;
      note = read.note;
    } catch (e) {
      verdict = 'UNREADABLE';
      note = 'The receipt could not be stored: ' + e.message;
    }
  }

  var row = createRow_('financeTransactions', {
    client: client, date: date, month: finMonthOf_(date), type: type, fundType: fund,
    amount: amount, vendor: str_(p.vendor), category: str_(p.category),
    description: str_(p.description),
    staffMember: str_(p.staffMember) || str_(user.display_name) || str_(user.email),
    receiptFileId: fileId, receiptName: receiptName,
    receiptVerdict: verdict, receiptNote: note,
    source: 'hub', enteredBy: str_(user.email)
  });
  if (sheetDbRefused_(row)) return sheetDbRefused_(row);

  hubSysLog_(str_(user.email), 'finSubmitTransaction', client,
             { status: 200, message: type + ' ' + amount.toFixed(2) + ' ' + fund +
                                     ' receipt=' + verdict });
  return { status: 200, data: { id: str_(row.id), amount: amount,
                                receipt: receiptName, verdict: verdict, note: note } };
};

// Irreversible; the lock stops two concurrent closes reading the same opening.
HUB_POLICY.finCloseMonth = {
  file: 'Finance.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.finCloseMonth = function (payload, user) {
  if (!user || user.is_service || user.role !== 'admin') return hubDenied_();
  var client = str_(payload && payload.client);
  var month = str_(payload && payload.month);
  if (!client || !month) return { status: 400, message: 'Client and month are both required.' };

  var lock = LockService.getScriptLock();
  var held = false;
  try { held = lock.tryLock(20000); } catch (e) { held = false; }
  if (!held) return { status: 503, message: 'Somebody else is closing a month — try again in a moment.' };

  try {
    var existing = finBalancesFor_(client);
    var already = existing.some(function (b) {
      return str_(b.month) === month && str_(b.status) === 'Closed';
    });
    if (already) return { status: 409, message: month + ' is already closed for ' + client + '.' };

    var led = finLedger_(client, month);
    var when = new Date().toISOString();
    var by = str_(user.display_name) || str_(user.email);

    // The first refused write stops the close: a half-closed month is answered as refused, never closed.
    var refused = null;
    led.funds.forEach(function (f) {
      if (refused) return;
      var row = null;
      existing.forEach(function (b) {
        if (str_(b.month) === month && str_(b.fundType) === f.fundType) row = b;
      });
      var values = { client: client, fundType: f.fundType, month: month,
                     opening: f.opening, deposits: f.deposits, spending: f.spending,
                     closing: f.closing, status: 'Closed', closedBy: by, closedAt: when };
      refused = sheetDbRefused_(row ? updateRowById_('financeBalances', Object.assign({ id: row.id }, values))
                                    : createRow_('financeBalances', values));
      if (refused) return;

      var next = finNextMonth_(month), nextRow = null;
      existing.forEach(function (b) {
        if (str_(b.month) === next && str_(b.fundType) === f.fundType) nextRow = b;
      });
      refused = sheetDbRefused_(nextRow
        ? updateRowById_('financeBalances', { id: nextRow.id, opening: f.closing })
        : createRow_('financeBalances', { client: client, fundType: f.fundType, month: next,
                                          opening: f.closing, deposits: 0, spending: 0,
                                          closing: f.closing, status: 'Open', closedBy: '', closedAt: '' }));
    });
    if (refused) return refused;

    hubSysLog_(str_(user.email), 'finCloseMonth', client + ' ' + month,
               { status: 200, message: led.funds.length + ' fund(s), ' +
                                       led.missingReceipts + ' missing receipt(s)' });
    return { status: 200, data: { closed: true, month: month, funds: led.funds } };
  } finally {
    if (held) lock.releaseLock();
  }
};

// Receipt chasing belongs in Smart Comms; never build a sender in this file.

/** Every client with what is outstanding against them (old apiGetClientsWithCounts): who needs attention today, not who exists. */
HUB_POLICY.finClientCounts = {
  file: 'Finance.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.finClientCounts = function (payload, user) {
  if (!finMayUse_(user)) return hubDenied_();
  var month = str_(payload && payload.month) ||
              Utilities.formatDate(new Date(), hiringTimeZone_(), 'yyyy-MM');
  var missing = {}, spend = {};
  listRows_('financeTransactions', {}).forEach(function (r) {
    if (str_(r.month) !== month) return;
    var k = str_(r.client).toLowerCase();
    var amt = finNum_(r.amount);
    if (amt < 0) spend[k] = (spend[k] || 0) + amt;
    if (amt < 0 && !str_(r.receiptName) && str_(r.receiptVerdict) !== 'EXEMPT') {
      missing[k] = (missing[k] || 0) + 1;
    }
  });
  var out = finClients_(user).map(function (c) {
    var k = c.name.toLowerCase();
    return { id: c.id, name: c.name, house: c.house,
             missingReceipts: missing[k] || 0, spending: spend[k] || 0 };
  });
  return { status: 200, data: { month: month, clients: out } };
};

/** The balance history — every month this client has, not just the open one. */
HUB_POLICY.finBalances = {
  file: 'Finance.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.finBalances = function (payload, user) {
  if (!finMayUse_(user)) return hubDenied_();
  var client = str_(payload && payload.client);
  if (!client) return { status: 400, message: 'Which client?' };
  var rows = finBalancesFor_(client).map(function (b) {
    return { id: str_(b.id), fundType: str_(b.fundType), month: str_(b.month),
             opening: finNum_(b.opening), deposits: finNum_(b.deposits),
             spending: finNum_(b.spending), closing: finNum_(b.closing),
             status: str_(b.status), closedBy: str_(b.closedBy), closedAt: str_(b.closedAt) };
  }).sort(function (a, b) { return String(b.month).localeCompare(String(a.month)); });
  return { status: 200, data: { balances: rows } };
};

/** What closing would do, before it is done (old apiGetCloseOutPreview) — the last place to notice a month is short. */
HUB_POLICY.finCloseOutPreview = {
  file: 'Finance.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.finCloseOutPreview = function (payload, user) {
  if (!finMayUse_(user)) return hubDenied_();
  var client = str_(payload && payload.client);
  var month = str_(payload && payload.month);
  if (!client || !month) return { status: 400, message: 'Client and month are both required.' };
  var led = finLedger_(client, month);
  var warnings = [];
  if (led.closed) warnings.push(month + ' is already closed.');
  led.funds.forEach(function (f) {
    if (!f.openingKnown) {
      warnings.push(f.fundType + ' opens at 0.00 because ' + finPrevMonth_(month) + ' was never closed.');
    }
    if (f.closing < 0) warnings.push(f.fundType + ' would close NEGATIVE at ' + f.closing.toFixed(2) + '.');
  });
  if (led.missingReceipts) {
    warnings.push(led.missingReceipts + ' spend(s) still have no receipt — closing does not clear them.');
  }
  return { status: 200, data: { client: client, month: month, funds: led.funds,
                                missingReceipts: led.missingReceipts,
                                closed: led.closed, warnings: warnings } };
};

// Never overwrites: correcting a real balance is a Deposit or Withdraw row.
HUB_POLICY.finSeedBalance = {
  file: 'Finance.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.finSeedBalance = function (payload, user) {
  if (!user || user.is_service || user.role !== 'admin') return hubDenied_();
  var p = payload || {};
  var client = str_(p.client), fund = str_(p.fundType), month = str_(p.month);
  if (!client || !month) return { status: 400, message: 'Client and month are both required.' };
  if (FIN_FUND_TYPES.indexOf(fund) === -1) return { status: 400, message: 'Fund must be one of: ' + FIN_FUND_TYPES.join(', ') + '.' };
  var amount = finNum_(p.amount);
  var clash = finBalancesFor_(client).filter(function (b) {
    return str_(b.month) === month && str_(b.fundType) === fund;
  });
  if (clash.length) {
    return { status: 409, message: fund + ' already has a ' + month + ' balance for ' + client +
                                   '. Correct it with a Deposit or a Withdraw, so the change is on the record.' };
  }
  var seeded = createRow_('financeBalances', { client: client, fundType: fund, month: month,
                                               opening: amount, deposits: 0, spending: 0, closing: amount,
                                               status: 'Open', closedBy: '', closedAt: '' });
  if (sheetDbRefused_(seeded)) return sheetDbRefused_(seeded);
  hubSysLog_(str_(user.email), 'finSeedBalance', client + ' ' + fund + ' ' + month,
             { status: 200, message: 'opening ' + amount.toFixed(2) });
  return { status: 200, data: { seeded: true, opening: amount } };
};

/** Attach a receipt to a row that already exists; replaces the old apiUploadAndAnalyze and apiAttachManual, which differed only in where the file came from. */
HUB_POLICY.finAttachReceipt = {
  file: 'Finance.gs', lane: 'write', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.finAttachReceipt = function (payload, user) {
  if (!finMayUse_(user)) return hubDenied_();
  var p = payload || {};
  var id = str_(p.id);
  if (!id) return { status: 400, message: 'Which transaction?' };
  if (!str_(p.receiptBase64) || !str_(p.receiptMime)) return { status: 400, message: 'No file was sent.' };

  var row = requireRow_('financeTransactions', id);
  if (row.error) return row.error;

  var amount = finNum_(row.amount);
  try {
    var ext = '.jpg';
    var fn = str_(p.receiptFileName);
    if (fn && fn.indexOf('.') >= 0) ext = fn.substring(fn.lastIndexOf('.')).toLowerCase();
    var clean = function (v) { return str_(v).replace(/[\/\\?<>:*|"]/g, ' '); };
    var name = clean(row.client) + ' - ' + str_(row.date) + ' - ' +
               (clean(row.vendor) || 'Manual') + ' - ' + Math.abs(amount).toFixed(2) + ext;
    var blob = Utilities.newBlob(Utilities.base64Decode(p.receiptBase64), str_(p.receiptMime), name);
    var file = finReceiptFolder_().createFile(blob);
    var read = finReceiptVerdict_(finReceiptText_(file.getId()), amount, str_(row.vendor));
    updateRowById_('financeTransactions', {
      id: id, receiptFileId: file.getId(), receiptName: file.getName(),
      receiptVerdict: read.verdict, receiptNote: read.note
    });
    hubSysLog_(str_(user.email), 'finAttachReceipt', str_(row.client) + ' ' + id,
               { status: 200, message: read.verdict });
    return { status: 200, data: { id: id, receipt: file.getName(),
                                  verdict: read.verdict, note: read.note } };
  } catch (e) {
    return { status: 500, message: 'The receipt could not be stored: ' + e.message };
  }
};

/** Mark that no receipt is coming for a transaction (old apiMarkNoReceipt). */
HUB_POLICY.finMarkNoReceipt = {
  file: 'Finance.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.finMarkNoReceipt = function (payload, user) {
  if (!finMayUse_(user)) return hubDenied_();
  var p = payload || {};
  var id = str_(p.id);
  var reason = str_(p.reason);
  if (!id) return { status: 400, message: 'Which transaction?' };
  var reasons = finVocabulary_().exemptReasons;
  if (reasons.indexOf(reason) === -1) {
    return { status: 400, message: 'Reason must be one of: ' + reasons.join(', ') + '.' };
  }
  var row = requireRow_('financeTransactions', id);
  if (row.error) return row.error;
  if (str_(row.receiptName)) {
    return { status: 409, message: 'That transaction already has a receipt on file.' };
  }
  var who = str_(user.display_name) || str_(user.email);
  updateRowById_('financeTransactions', {
    id: id, receiptVerdict: 'EXEMPT',
    receiptNote: reason + ' — attested by ' + who + ' on ' +
                 Utilities.formatDate(new Date(), hiringTimeZone_(), 'yyyy-MM-dd') +
                 (str_(p.note) ? ' · ' + str_(p.note) : '')
  });
  hubSysLog_(str_(user.email), 'finMarkNoReceipt', str_(row.client) + ' ' + id,
             { status: 200, message: reason });
  return { status: 200, data: { id: id, verdict: 'EXEMPT', reason: reason } };
};

// Append-only, deduped on client|date|vendor|amount; unmatched names are reported, never invented.
HUB_POLICY.finImportCard = {
  file: 'Finance.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.finImportCard = function (payload, user) {
  if (!finMayUse_(user)) return hubDenied_();
  var rows = (payload && payload.rows) || [];
  if (!rows.length) return { status: 400, message: 'No rows were sent.' };
  if (rows.length > 2000) return { status: 400, message: 'That is more than 2000 rows — split the export.' };

  var known = {};
  finClients_(user).forEach(function (c) { known[c.name.toLowerCase()] = c.name; });

  var seen = {};
  listRows_('financeTransactions', {}).forEach(function (r) {
    seen[finFingerprint_(r.client, r.date, r.vendor, finNum_(r.amount))] = true;
  });

  var imported = 0, skipped = 0, unmatched = {}, bad = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    var name = str_(r.client);
    var real = known[name.toLowerCase()];
    if (!real) { unmatched[name || '(blank)'] = (unmatched[name || '(blank)'] || 0) + 1; continue; }

    var date = str_(r.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { bad++; continue; }
    var amount = finNum_(r.amount);
    if (!amount) { bad++; continue; }
    // Keep the card's own sign; forcing one would flip a refund into a charge.
    var fund = str_(r.fundType) || 'Debit Card';
    if (FIN_FUND_TYPES.indexOf(fund) === -1) fund = 'Debit Card';

    var fp = finFingerprint_(real, date, str_(r.vendor), amount);
    if (seen[fp]) { skipped++; continue; }
    seen[fp] = true;

    var madeT = createRow_('financeTransactions', {
      client: real, date: date, month: finMonthOf_(date),
      type: amount < 0 ? 'Spending' : 'Deposit', fundType: fund, amount: amount,
      vendor: str_(r.vendor), category: str_(r.category), description: str_(r.description),
      staffMember: '', receiptFileId: '', receiptName: '',
      receiptVerdict: 'NONE', receiptNote: '',
      postedDate: str_(r.postedDate), location: str_(r.location),
      // Last four digits only; the full card number never enters this file.
      accountId: str_(r.accountId), accountLast4: str_(r.accountLast4),
      cardType: str_(r.cardType),
      source: 'truelink', enteredBy: str_(user.email)
    });
    var refusedT = sheetDbRefused_(madeT);
    if (refusedT) {
      return { status: refusedT.status, message: refusedT.message + ' — ' + imported +
               ' row(s) were written before the refusal; the rest were not.' };
    }
    imported++;
  }

  var unmatchedList = Object.keys(unmatched).map(function (k) {
    return { name: k, rows: unmatched[k] };
  });
  hubSysLog_(str_(user.email), 'finImportCard', 'card feed',
             { status: 200, message: imported + ' imported, ' + skipped + ' already there, ' +
                                     unmatchedList.length + ' unmatched name(s)' });
  return { status: 200, data: { imported: imported, skipped: skipped,
                                unreadable: bad, unmatched: unmatchedList } };
};

function finFingerprint_(client, date, vendor, amount) {
  return str_(client).toLowerCase() + '|' + str_(date) + '|' +
         str_(vendor).toLowerCase().replace(/\s+/g, ' ') + '|' + finNum_(amount).toFixed(2);
}

/* ─────────────────────── the vocabulary, in Settings ─────────────────────── */

// Saves only add to the built-in floor; a fund with transactions can never be removed.
var FIN_CFG_KEYS = ['fundTypes', 'categories', 'exemptReasons'];

function finConfigRow_(key) {
  var hit = null;
  listRows_('financeConfig', {}).forEach(function (r) {
    if (str_(r.key) === key) hit = r;
  });
  return hit;
}

function finVocabulary_() {
  var base = { fundTypes: FIN_FUND_TYPES, categories: FIN_CATEGORIES,
               exemptReasons: FIN_EXEMPT_REASONS };
  var out = {};
  FIN_CFG_KEYS.forEach(function (k) {
    var list = base[k].slice();
    var row = finConfigRow_(k);
    if (row) {
      String(row.value || '').split('|').forEach(function (v) {
        var t = String(v).trim();
        if (t && list.indexOf(t) === -1) list.push(t);
      });
    }
    out[k] = list;
  });
  out.txnTypes = FIN_TXN_TYPES;
  return out;
}

/** Save the finance vocabularies. */
HUB_POLICY.finSettingsSet = {
  file: 'Finance.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.finSettingsSet = function (payload, user) {
  if (!user || user.is_service || user.role !== 'admin') return hubDenied_();
  var p = payload || {};
  var floor = { fundTypes: FIN_FUND_TYPES, categories: FIN_CATEGORIES,
                exemptReasons: FIN_EXEMPT_REASONS };

  var usedFunds = {};
  listRows_('financeTransactions', {}).forEach(function (r) {
    var f = str_(r.fundType);
    if (f) usedFunds[f] = (usedFunds[f] || 0) + 1;
  });

  for (var i = 0; i < FIN_CFG_KEYS.length; i++) {
    var key = FIN_CFG_KEYS[i];
    if (!p[key]) continue;
    var wanted = [];
    (p[key] || []).forEach(function (v) {
      var t = String(v).trim();
      if (t && wanted.indexOf(t) === -1) wanted.push(t);
    });

    var lostFloor = floor[key].filter(function (v) { return wanted.indexOf(v) === -1; });
    if (lostFloor.length) {
      return { status: 400, message: 'These are built in and cannot be removed: ' + lostFloor.join(', ') + '.' };
    }
    if (key === 'fundTypes') {
      var inUse = Object.keys(usedFunds).filter(function (f) { return wanted.indexOf(f) === -1; });
      if (inUse.length) {
        var detail = inUse.map(function (f) { return f + ' (' + usedFunds[f] + ' transaction(s))'; });
        return { status: 409, message: 'Still in use, so it cannot be removed: ' + detail.join(', ') + '.' };
      }
    }

    var extra = wanted.filter(function (v) { return floor[key].indexOf(v) === -1; });
    var row = finConfigRow_(key);
    var wroteC = row ? updateRowById_('financeConfig', { id: row.id, value: extra.join('|') })
                     : createRow_('financeConfig', { key: key, value: extra.join('|') });
    if (sheetDbRefused_(wroteC)) return sheetDbRefused_(wroteC);
  }

  hubSysLog_(str_(user.email), 'finSettingsSet', 'finance vocabulary', { status: 200, message: 'saved' });
  return { status: 200, data: finVocabulary_() };
};

// ---- the source book and finance_transactions, read directly and deduped by RowKey ----


function finSrcDay_(v) {
  var t = str_(v).trim();
  var iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  var us = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!us) return '';
  var y = us[3].length === 2 ? '20' + us[3] : us[3];
  return y + '-' + ('0' + us[1]).slice(-2) + '-' + ('0' + us[2]).slice(-2);
}

function finSourceRows_() {
  var out = [];
  var seen = {};
  try {
    readTabNormalized_(ssOpen_(hubId_('FIN_TRUELINK_SHEET_ID')), 'Transactions').forEach(function (r) {
      var key = str_(r.rowkey);
      if (key) seen[key] = true;
      out.push({
        client: str_(r.cardholdername), date: finSrcDay_(r.transactiondate),
        posted: str_(r.posteddate), vendor: str_(r.vendor), location: str_(r.location),
        last4: str_(r.accountlast4), type: str_(r.type), amount: finNum_(r.amount),
        fund: str_(r.fundtype) || 'Debit Card', category: str_(r.category),
        description: str_(r.description).slice(0, 200), staff: str_(r.staffmember),
        source: str_(r.source) || 'TrueLink', receipt: str_(r.receipt),
        receipt_ai: str_(r.receiptai)
      });
    });
  } catch (e) {}
  listRows_('financeTransactions', {}).forEach(function (r) {
    var key = str_(r.legacyRowKey);
    if (key && seen[key]) return;
    out.push({
      client: str_(r.client), date: finSrcDay_(r.date), posted: str_(r.postedDate),
      vendor: str_(r.vendor), location: str_(r.location), last4: str_(r.accountLast4),
      type: str_(r.type), amount: finNum_(r.amount), fund: str_(r.fundType) || 'Debit Card',
      category: str_(r.category), description: str_(r.description).slice(0, 200),
      staff: str_(r.staffMember), source: str_(r.type) === 'Manual' ? 'Manual' : (str_(r.source) || 'Hub'),
      receipt: str_(r.receiptName), receipt_ai: str_(r.receiptVerdict)
    });
  });
  return out;
}

function finNormVendor_(v) {
  return str_(v).toLowerCase().replace(/[^a-z0-9]/g, '');
}

HUB_POLICY.finAnalytics = {
  file: 'Finance.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.finAnalytics = function (payload, user) {
  if (!finMayUse_(user)) return hubDenied_();
  var want = str_(payload && payload.client).toLowerCase();
  var rows = finSourceRows_().filter(function (r) {
    return !want || r.client.toLowerCase() === want;
  });
  var spent = 0, deposits = 0, spendCnt = 0;
  var clientsSeen = {};
  var byFund = {}, byCat = {}, byMonth = {}, byClient = {}, byVendor = {};
  rows.forEach(function (r) {
    if (r.client) clientsSeen[r.client] = true;
    var a = r.amount;
    if (a < 0) { spent += -a; spendCnt++; } else { deposits += a; }
    var f = byFund[r.fund] = byFund[r.fund] || { fund: r.fund, count: 0, spent: 0, deposits: 0 };
    f.count++; if (a < 0) f.spent += -a; else f.deposits += a;
    if (r.category) {
      var c = byCat[r.category] = byCat[r.category] || { category: r.category, count: 0, spent: 0 };
      c.count++; if (a < 0) c.spent += -a;
    }
    if (r.date) {
      var mo = r.date.slice(0, 7);
      var m = byMonth[mo] = byMonth[mo] || { month: mo, count: 0, spent: 0, deposits: 0 };
      m.count++; if (a < 0) m.spent += -a; else m.deposits += a;
    }
    if (r.client) {
      var cl = byClient[r.client] = byClient[r.client] || { client: r.client, count: 0, spent: 0, deposits: 0, net: 0 };
      cl.count++; cl.net += a; if (a < 0) cl.spent += -a; else cl.deposits += a;
    }
    var vk = finNormVendor_(r.vendor);
    if (vk) {
      var v = byVendor[vk] = byVendor[vk] || { vendor: r.vendor.toUpperCase(), count: 0, spent: 0, top: 0 };
      v.count++; if (a < 0) v.spent += -a;
      if (v.count > v.top) { v.top = v.count; v.vendor = r.vendor.toUpperCase(); }
    }
  });
  var toList = function (o, key, desc) {
    return Object.keys(o).map(function (k) { return o[k]; })
      .sort(function (a, b) { return desc ? b[key] - a[key] : (a[key] < b[key] ? -1 : 1); });
  };
  var monthly = toList(byMonth, 'month').sort(function (a, b) { return a.month < b.month ? -1 : 1; }).slice(-12);
  var topVendors = toList(byVendor, 'spent', true).slice(0, 12).map(function (v) {
    return { vendor: v.vendor, count: v.count, spent: Math.round(v.spent * 100) / 100 };
  });
  var byCatList = toList(byCat, 'spent', true);
  var byClientList = toList(byClient, 'spent', true).slice(0, 20);
  var tl = rows.filter(function (r) { return r.source === 'TrueLink' && r.amount < 0; });
  var withReceipt = tl.filter(function (r) { return !!r.receipt; }).length;
  var exempt = tl.filter(function (r) { return !r.receipt && r.receipt_ai === 'EXEMPT'; }).length;
  var compliance = { total: tl.length, withReceipt: withReceipt, exempt: exempt,
                     missing: tl.length - withReceipt - exempt };
  var flags = [];
  var other = null;
  byCatList.forEach(function (c) { if (c.category === 'Other') other = c; });
  if (other && spent && other.spent > 0.2 * spent) {
    flags.push({ label: "'Other' is " + Math.round(100 * other.spent / spent) + '% of spend',
                 detail: 'Large uncategorized spend — recategorize for real visibility.' });
  }
  var drains = byClientList.filter(function (c) { return c.spent > c.deposits && c.spent > 0; });
  if (drains.length) {
    flags.push({ label: drains.length + ' client(s) spending more than deposited',
                 detail: drains.slice(0, 6).map(function (c) { return c.client; }).join(', ') });
  }
  if (compliance.missing > 0) {
    flags.push({ label: compliance.missing + ' TrueLink spend(s) missing receipts',
                 detail: 'Resolve them on the ledger.' });
  }
  return { status: 200, data: {
    kpis: { txns: rows.length, clients: Object.keys(clientsSeen).length,
            spent: Math.round(spent * 100) / 100, deposits: Math.round(deposits * 100) / 100,
            net: Math.round((deposits - spent) * 100) / 100,
            avgTxn: spendCnt ? Math.round(spent / spendCnt * 100) / 100 : 0 },
    byFund: toList(byFund, 'spent', true), byCategory: byCatList, monthly: monthly,
    byClient: byClientList, topVendors: topVendors, compliance: compliance, flags: flags
  } };
};

HUB_POLICY.finLedgerHistory = {
  file: 'Finance.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.finLedgerHistory = function (payload, user) {
  if (!finMayUse_(user)) return hubDenied_();
  var want = str_(payload && payload.client).toLowerCase();
  var limit = Math.min(Math.max(Number((payload && payload.limit) || 200), 1), 500);
  var rows = finSourceRows_().filter(function (r) {
    return !want || r.client.toLowerCase() === want;
  }).sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, limit);
  return { status: 200, data: { rows: rows } };
};

HUB_POLICY.finDocs = {
  file: 'Finance.gs', lane: 'read', store: 'drive',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.finDocs = function (payload, user) {
  if (!finMayUse_(user)) return hubDenied_();
  var cacheKey = 'fin_docs_v2';
  try {
    var hit = CacheService.getScriptCache().get(cacheKey);
    if (hit) return { status: 200, data: JSON.parse(hit) };
  } catch (eC) {}
  var root;
  try {
    root = DriveApp.getFolderById(hubId_('FIN_DRIVE_ROOT_ID'));
  } catch (e) {
    return { status: 503, message: 'The Finances folder is not shared with the platform account yet — share it and this fills itself.' };
  }
  var folders = [];
  var subs = root.getFolders();
  while (subs.hasNext() && folders.length < 12) {
    var sub = subs.next();
    var f = { subfolder: sub.getName(), count: 0, docs: [] };
    var files = sub.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      f.count++;
      if (f.docs.length >= 120) continue;
      var name = file.getName();
      var amt = name.match(/\$?\s?([0-9][0-9,]*\.[0-9]{2})/);
      var dt = name.match(/(\d{4}[._-]\d{1,2}[._-]\d{1,2})|(\d{1,2}[._\/]\d{1,2}[._\/]\d{2,4})/);
      f.docs.push({ name: name, vendor: '', doc_date: dt ? dt[0] : '',
                    amount: amt ? Number(amt[1].replace(/,/g, '')) : null, currency: amt ? 'USD' : '',
                    category: '', link: file.getUrl(), mime: str_(file.getMimeType()) });
    }
    folders.push(f);
  }
  folders.sort(function (a, b) { return a.subfolder < b.subfolder ? -1 : 1; });
  var out = { folders: folders };
  try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(out), 21600); } catch (eP) {}
  return { status: 200, data: out };
};

function finSmartSubjects_() {
  var month = Utilities.formatDate(new Date(), hiringTimeZone_(), 'yyyy-MM');
  var byClient = {};
  listRows_('financeTransactions', {}).forEach(function (r) {
    if (str_(r.month) !== month) return;
    var amt = finNum_(r.amount);
    if (amt >= 0) return;
    if (str_(r.receiptName) || str_(r.receiptVerdict) === 'EXEMPT') return;
    var name = str_(r.client);
    if (!name) return;
    if (!byClient[name]) byClient[name] = { name: name, month: month, missing: 0, total: 0, oldest: '' };
    var b = byClient[name];
    b.missing++;
    b.total += Math.abs(amt);
    var d = str_(r.date);
    if (!b.oldest || d < b.oldest) b.oldest = d;
  });
  return Object.keys(byClient).map(function (k) {
    var b = byClient[k];
    b.total = '$' + b.total.toFixed(2);
    return b;
  });
}
