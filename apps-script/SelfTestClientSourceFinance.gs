/** An in-memory tab: getDataRange, getRange(row, col, rows, cols).getValues, getLastRow, getLastColumn. */
function stCsfSheet_(grid) {
  var width = 0;
  grid.forEach(function (row) { if (row.length > width) width = row.length; });
  var cell = function (r, c) { var row = grid[r]; return row && row[c] !== undefined ? row[c] : ''; };
  return {
    getLastRow: function () { return grid.length; },
    getLastColumn: function () { return width; },
    getDataRange: function () {
      return { getValues: function () {
        return grid.map(function (row, r) { var out = []; for (var c = 0; c < width; c++) out.push(cell(r, c)); return out; });
      } };
    },
    getRange: function (r, c, nr, nc) {
      return { getValues: function () {
        var out = [];
        for (var i = 0; i < (nr || 1); i++) {
          var row = [];
          for (var j = 0; j < (nc || 1); j++) row.push(cell(r - 1 + i, c - 1 + j));
          out.push(row);
        }
        return out;
      } };
    }
  };
}

function stCsfIter_(list) {
  var i = 0;
  return { hasNext: function () { return i < list.length; }, next: function () { return list[i++]; } };
}

function stCsfFile_(id, name, text) {
  return {
    getId: function () { return id; }, getName: function () { return name; },
    getLastUpdated: function () { return new Date('2026-02-12T17:01:00Z'); },
    getBlob: function () { return { getDataAsString: function () { return text; } }; }
  };
}

/** Client sources, finance: the master-only gate, the client join, the funds and billing shaping, and a failing source saying why. */
function stClientSourceFinance_(out) {
  var P = 'client sources, finance: ';

  // ---- declarations ----
  var bad = [];
  CSF_ACTIONS.forEach(function (a) {
    var p = HUB_POLICY[a];
    if (!p || p.file !== 'ClientSourceFinance.gs' || typeof HUB_ACTIONS[a] !== 'function') { bad.push(a + ': undeclared'); return; }
    if (RESOLVER_LANES.indexOf(p.lane) === -1 || RESOLVER_STORES.indexOf(p.store) === -1) bad.push(a + ': lane/store');
    if (JSON.stringify(p.roles) !== JSON.stringify(ST_CP_READ_ROLES)) bad.push(a + ': roles ' + JSON.stringify(p.roles));
    if ((p.invalidates || []).length || (p.emits || []).length) bad.push(a + ': invalidates/emits');
    if (p.idempotent !== true) bad.push(a + ': not idempotent');
    var want = a === 'clientSourceFinanceFile' ? 'tool' : 'read';
    if (p.lane !== want) bad.push(a + ': lane ' + p.lane + ', wanted ' + want);
    var params = p.params || {};
    if (!params.client) bad.push(a + ': no client param');
    Object.keys(params).forEach(function (k) { if (params[k] && params[k].required) bad.push(a + ': ' + k + ' required at the door'); });
  });
  stAssert_(out, P + 'every action is declared in ClientSourceFinance.gs for every role App Control may release Clients ' +
                 'to, idempotent, invalidating no slice and emitting nothing; the reads ride the read lane and the bytes ' +
                 'the tool lane',
            bad.length === 0 && CSF_ACTIONS.length === 3, bad.join('; '));

  var keep = {
    client: csfClient_, derived: clientsDerived_, list: listRows_, readTab: readTabNormalized_, hubId: hubId_,
    ss: ssOpen_, tabSheet: hubTabSheet_, psi: psiPunchesFullSheet_, folder: csfMbsFolder_, cache: cacheRead_,
    scope: cacheScope_, today: locationsToday_, bytes: locationsDocBytes_, book: locationsBookId_,
    masterCache: HUB_MASTER_EMAIL_CACHE, member: HUB_MEMBER_CTX, rules: hubProfileAppRules_
  };
  var master = { email: HUB_MASTER_ACCOUNT, role: 'admin' };
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    HUB_MEMBER_CTX = null;
    cacheRead_ = function (scope, name, producer) { return producer(); };
    cacheScope_ = function (tab) { return 'st_' + tab; };
    locationsBookId_ = function (prop, fallback) { return fallback; };

    // ---- the gate (no App Control row: the master's alone) ----
    hubProfileAppRules_ = function () { return { rules: {}, tenants: {} }; };
    HUB_VIEWER_MEMO = null;
    var asked = 0;
    csfClient_ = function () { asked++; return { refused: { status: 418, message: 'st: the client was asked' } }; };
    var callers = [
      { email: 'admin@example.org', role: 'admin' },
      { email: 'mgr@example.org', role: 'manager' },
      { id: 'u-st9', email: 'st9@example.org', role: 'staff', types: ['STAFF'] },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' },
      { email: HUB_MASTER_ACCOUNT, role: 'admin', is_service: true },
      { email: HUB_MASTER_ACCOUNT, role: 'manager' },
      null
    ];
    var shape = function (r) { return !!r && r.status === 404 && r.message === 'Unknown action.' && Object.keys(r).length === 2; };
    var leaks = [];
    CSF_ACTIONS.forEach(function (a) {
      callers.forEach(function (u) {
        var r = HUB_ACTIONS[a]({ client: 'tessa_mocker', id: '1FormReceiptXXXXXXXXXXXXXXXXXXXXX' }, u);
        if (!shape(r)) leaks.push(a + ' ' + JSON.stringify(u) + ' → ' + JSON.stringify(r));
      });
      HUB_MEMBER_CTX = { memberId: 'mem_st', userId: 'u-st', email: 'ann@example.org' };
      var inVisit = HUB_ACTIONS[a]({ client: 'tessa_mocker' }, master);
      HUB_MEMBER_CTX = null;
      if (!shape(inVisit)) leaks.push(a + ' in a visit → ' + JSON.stringify(inVisit));
    });
    stAssert_(out, P + 'with no App Control row: a non-master, a manager, a staff member, a visit, the service identity ' +
                   'and no session all get the 404 shape, before any client is looked up', leaks.length === 0 && asked === 0,
              leaks.slice(0, 4).join(' | ') + ' asked=' + asked);
    var passed = CSF_ACTIONS.map(function (a) { return HUB_ACTIONS[a]({ client: 'tessa_mocker', id: 'abcdefghij12' }, master).status; });
    stAssert_(out, P + 'the master in the master\'s own session passes the gate to the client lookup',
              passed.every(function (s) { return s === 418; }), JSON.stringify(passed));
    csfClient_ = keep.client;

    // ---- the client ----
    var ROSTER = [
      { client_key: 'tessa_mocker', name: 'Tessa Mocker', medicaid_id: '123456789012', ssa_name: 'Sue Case',
        isp_year: '2026-2027 (ISP Span Dates: June 25, 2026 - June 24, 2027; Effective Date June 25, 2026)',
        medications: ['secret pill'] },
      { client_key: 'kc_two', name: 'Tim Mocke', medicaid_id: '999999999999', isp_year: '' },
      { client_key: 'barbara_quill', name: 'Barbara Quill', medicaid_id: '',
        isp_year: 'March 21, 2026 - March 20, 2027 (Effective Date: March 21, 2026)' },
      { client_key: 'pat_a', name: 'Pat Doe', medicaid_id: '555555555555' }, { client_key: 'pat_b', name: 'Pat  Doe' }
    ];
    clientsDerived_ = function () { return ROSTER; };
    var kc = csfClient_('tessa_mocker');
    var none = csfClient_('nobody_here');
    var malformed = csfClient_('tessa mocker!');
    var dup = csfClient_('pat_a');
    clientsDerived_ = function () { throw new Error('st: plans closed'); };
    var closed = csfClient_('tessa_mocker');
    clientsDerived_ = function () { return ROSTER; };
    stAssert_(out, P + 'a client resolves by client_key through clientsDerived_: unknown is 404, malformed 400, an unreadable ' +
                   'roster 503, and two clients with one name are marked shared',
              kc.name === 'Tessa Mocker' && kc.medicaid_id === '123456789012' && !kc.shared && kc.last_name === 'mocker' &&
              kc.last_name_shared === false && none.refused && none.refused.status === 404 &&
              malformed.refused && malformed.refused.status === 400 && closed.refused && closed.refused.status === 503 &&
              dup.shared === true && dup.last_name_shared === true,
              JSON.stringify([kc.name, none.refused, malformed.refused, closed.refused, dup.shared]));

    // ---- funds ----
    var FT = [
      { id: 't1', client: 'Tessa Mocker', date: '2026-03-01', amount: '300', type: 'Deposit', fundType: 'Debit Card',
        vendor: 'Deposit', legacyRowKey: 'K|1', receiptVerdict: 'NONE' },
      { id: 't2', client: 'tessa  mocker', date: '2026-03-05', amount: '-36.2', type: 'Spending', fundType: 'Debit Card',
        vendor: 'Pizza Oven', category: 'Food', staffMember: 'Ann Lee', legacyRowKey: 'K|2',
        receiptName: 'form-receipt-1FormReceiptXXXXXXXXXXXXXXXXXXXXX', receiptVerdict: 'UPLOADED',
        accountLast4: '4111111111111234', accountId: '5555444433332222' },
      { id: 't3', client: 'Tessa Mocker', date: '3/6/2026', amount: '-8.21', type: 'Spending', fundType: 'Cash', vendor: 'Walmart',
        receiptName: '', receiptVerdict: 'NONE' },
      { id: 't4', client: 'Tessa Mocker', date: '2026-03-07', amount: '-6', type: 'Spending', fundType: 'Debit Card',
        vendor: 'MONTHLY FEE', receiptVerdict: 'EXEMPT', receiptNote: 'Recurring/Subscription — attested by Boss on 2026-03-08' },
      { id: 't5', client: 'Tessa Mocker', date: '2026-03-08', amount: '-12', type: 'Spending', fundType: 'Cash', vendor: 'CVS',
        receiptName: 'CVS receipt.jpg', receiptFileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', receiptVerdict: 'MISMATCH',
        receiptNote: 'Typed 12.00; the closest total on the receipt is 21.00.' },
      { id: 'o1', client: 'Tim Mocke', date: '2026-03-08', amount: '-99', fundType: 'Cash', vendor: 'Elsewhere' }
    ];
    var BAL = [
      { client_key: 'tessa_mocker', client_name: 'Tessa Mocker', total: ' $ (483.72)', house: ' $ -   ', office: '$ 100.00',
        as_of: '10/29', debit_card: '4111 1111 1111 1234' },
      { client: 'Tessa Mocker', fundType: 'Cash', month: '2026-02', closing: '50', status: 'Closed' },
      { client: 'Tessa Mocker', fundType: 'Debit Card', month: '2026-03', closing: '10', status: 'Open' },
      { client_key: 'kc_two', client_name: 'Tim Mocke', total: '5' }
    ];
    var TL = [
      { rowkey: 'K|1', cardholdername: 'Tessa Mocker', transactiondate: '03-01-2026', amount: '300' },
      { rowkey: 'K|9', cardholdername: 'Tessa Mocker', transactiondate: '03-10-2026', amount: '-5', vendor: 'BANK FEE',
        fundtype: 'Debit Card', source: 'TrueLink', accountlast4: '1234' },
      { rowkey: 'X|1', cardholdername: 'Tim Mocke', transactiondate: '03-10-2026', amount: '-7' }
    ];
    var FILES = [
      ['drive_id', 'title', 'folder', 'doc_kind', 'digest_category', 'client_key', 'client_name', 'file_date', 'modified_time', 'digest_text'],
      ['1FiledReceiptXXXXXXXXXXXXXXXXXXXX', 'Grocery_Receipts_02_01_2026_Tessa Mocker.pdf', 'Funds', 'receipt', 'receipt_invoice',
       'tessa_mocker', 'Tessa Mocker', '', '2026-02-05T16:45:34.000Z', 'st secret text'],
      ['1BankStatementXXXXXXXXXXXXXXXXXXX', 'Mocker_Tessa_2026_222012345678_True_Link_statement.pdf', 'Funds', 'bank_statement',
       '', 'tessa_mocker', 'Tessa Mocker', '2026-03-31', '', ''],
      ['1SsnCardXXXXXXXXXXXXXXXXXXXXXXXXX', 'SSN card.pdf', 'Funds', 'ssn_card', 'identity', 'tessa_mocker', 'Tessa Mocker', '', '', ''],
      ['1OtherClientReceiptXXXXXXXXXXXXXX', 'Receipt Tim.pdf', 'Funds', 'receipt', '', 'kc_two', 'Tim Mocke', '', '', ''],
      ['1MedDocXXXXXXXXXXXXXXXXXXXXXXXXXX', 'Pharmacy Receipt.pdf', 'Med Documents', 'receipt', '', 'tessa_mocker', 'Tessa Mocker', '', '', '']
    ];
    var ledgerOpen = true;
    listRows_ = function (res) {
      if (res === 'financeTransactions') { if (!ledgerOpen) throw new Error('st: ledger closed'); return FT; }
      if (res === 'financeBalances') return BAL;
      return [];
    };
    hubId_ = function (k) { return k === 'FIN_TRUELINK_SHEET_ID' ? 'st-tl-book' : ''; };
    ssOpen_ = function () { return { getSheetByName: function () { return null; } }; };
    readTabNormalized_ = function () { return TL; };
    hubTabSheet_ = function (tab) { return tab === 'client_files' ? stCsfSheet_(FILES) : null; };

    var funds = HUB_ACTIONS.clientSourceFunds({ client: 'tessa_mocker' }, master);
    var fd = funds.data || {};
    var tx = ((fd.tabs || {}).transactions || {}).rows || [];
    var byId = {};
    tx.forEach(function (t) { byId[t.id] = t; });
    stAssert_(out, P + 'funds: the ledger is this client\'s rows by name — finance_transactions plus the TrueLink rows it has not ' +
                   'imported — newest first, another client\'s never',
              funds.status === 200 && tx.length === 6 && !byId.o1 && tx[0].date === '2026-03-10' && byId['tl-3'] &&
              byId.t3.date === '2026-03-06' && fd.client.client_key === 'tessa_mocker' && Object.keys(fd.client).length === 2,
              JSON.stringify(tx.map(function (t) { return t.id + '@' + t.date; })));
    stAssert_(out, P + 'funds: a deposit is Recorded, a spend with a spending-log receipt is Receipt On File with the Drive id ' +
                   'lifted out, a spend with none is Missing receipt, an exemption is Recorded with no receipt expected, ' +
                   'and a mismatched receipt needs review',
              byId.t1.status === 'Recorded' && byId.t2.status === 'Receipt On File' &&
              byId.t2.receipt.file_id === '1FormReceiptXXXXXXXXXXXXXXXXXXXXX' && byId.t2.receipt.name === 'Spending log receipt' &&
              byId.t3.status === 'Missing receipt' && byId.t4.status === 'Recorded' &&
              byId.t4.receipt.status === 'No receipt expected' && byId.t5.status === 'Receipt On File' &&
              byId.t5.receipt.status === 'Needs review' && byId.t2.amount === -36.2 && byId.t1.amount === 300,
              JSON.stringify(tx.map(function (t) { return [t.id, t.status, t.receipt.status]; })));
    var k = fd.kpis || {};
    var bal = ((fd.tabs || {}).balances || {}).rows || [];
    var balBy = {};
    bal.forEach(function (b) { balBy[b.id] = b; });
    stAssert_(out, P + 'funds: the personal balance is the one on file with its date; a fund closed in Client Finances carries ' +
                   'its closing plus what came after, and a fund never closed says its opening is unknown rather than 0',
              k.personal_balance === -483.72 && k.personal_balance_basis === 'on_file' && k.personal_balance_as_of === '10/29' &&
              k.missing_receipts === 2 && k.transactions === 6 &&
              balBy['bal-on-file'] && /House \$0\.00/.test(balBy['bal-on-file'].details) &&
              balBy['bal-on-file'].details.indexOf('card ending 1234') !== -1 &&
              balBy['bal-cash'] && balBy['bal-cash'].personal_balance === 29.79 && balBy['bal-cash'].status === 'Closed through 2026-02' &&
              balBy['bal-debit-card'] && balBy['bal-debit-card'].personal_balance === null &&
              balBy['bal-debit-card'].status === 'Opening unknown',
              JSON.stringify([k, bal]));
    var rc = ((fd.tabs || {}).receipts || {}).rows || [];
    var docs = ((fd.documents || {}).rows || []);
    var rcFiled = rc.filter(function (r) { return r.status === 'Filed'; });
    stAssert_(out, P + 'funds: Receipts holds every spend and this client\'s Funds-folder receipts; an identity paper, another ' +
                   'client\'s receipt and a receipt outside the Funds folder stay out, and a statement is a document',
              rc.length === 6 && rcFiled.length === 1 && rcFiled[0].file_id === '1FiledReceiptXXXXXXXXXXXXXXXXXXXX' &&
              docs.length === 1 && docs[0].file_id === '1BankStatementXXXXXXXXXXXXXXXXXXX' &&
              fd.analytics && fd.analytics.compliance.spends === 5 && fd.analytics.compliance.missing === 2 &&
              fd.analytics.compliance.exempt === 1,
              JSON.stringify([rc.map(function (r) { return r.status; }), docs, fd.analytics && fd.analytics.compliance]));
    var text = JSON.stringify(fd);
    stAssert_(out, P + 'funds: no card number or other long digit run leaves — an account number in a file title is cut to ' +
                   'its last four — and no file text rides along',
              !/\d{9,}/.test(text) && text.indexOf('4111') === -1 && text.indexOf('st secret text') === -1 &&
              text.indexOf('5555') === -1 && docs[0] && /_•{8}5678_True_Link/.test(docs[0].record),
              (text.match(/\d{9,}/) || [''])[0] + ' ' + (docs[0] && docs[0].record));

    ledgerOpen = false;
    var down = HUB_ACTIONS.clientSourceFunds({ client: 'tessa_mocker' }, master).data || {};
    var dt = down.tabs || {};
    stAssert_(out, P + 'funds: an unreadable ledger answers its tabs with why — the counts are null, not 0 — and the Funds ' +
                   'folder still lists',
              down.degraded === true && /could not be read/.test(dt.transactions.why || '') && dt.transactions.rows.length === 0 &&
              down.kpis.transactions === null && down.kpis.missing_receipts === null && /could not be read/.test(dt.receipts.why || '') &&
              dt.receipts.rows.length === 1 && dt.balances.rows.length === 1 && dt.balances.rows[0].missing_receipts === null &&
              /could not be read/.test(dt.balances.why || ''),
              JSON.stringify([down.kpis, dt.transactions && dt.transactions.why]));
    ledgerOpen = true;
    var shared = csfFundsBuild_(csfClient_('pat_a'));
    stAssert_(out, P + 'funds: a name two clients share draws no ledger row, and says so',
              /more than one client/.test(shared.tabs.transactions.why || '') && shared.tabs.transactions.rows.length === 0,
              JSON.stringify(shared.tabs.transactions));

    // ---- the file door ----
    var opened = [];
    locationsDocBytes_ = function (id) {
      opened.push(id);
      return { name: 'Mocker_222012345678_True_Link_statement.pdf', mime: 'application/pdf', size: 4, exported: false, b64: 'JVBERg==' };
    };
    var okFile = HUB_ACTIONS.clientSourceFinanceFile({ client: 'tessa_mocker', id: '1FormReceiptXXXXXXXXXXXXXXXXXXXXX' }, master);
    var filed = HUB_ACTIONS.clientSourceFinanceFile({ client: 'tessa_mocker', id: '1FiledReceiptXXXXXXXXXXXXXXXXXXXX' }, master);
    var theirs = HUB_ACTIONS.clientSourceFinanceFile({ client: 'tessa_mocker', id: '1OtherClientReceiptXXXXXXXXXXXXXX' }, master);
    var ssn = HUB_ACTIONS.clientSourceFinanceFile({ client: 'tessa_mocker', id: '1SsnCardXXXXXXXXXXXXXXXXXXXXXXXXX' }, master);
    var badId = HUB_ACTIONS.clientSourceFinanceFile({ client: 'tessa_mocker', id: '../x' }, master);
    stAssert_(out, P + 'the file door opens only a file this client\'s funds name — a receipt or a Funds-folder paper — and ' +
                   'refuses another client\'s, an identity paper and a malformed id before Drive is touched',
              okFile.status === 200 && okFile.data.b64 === 'JVBERg==' && filed.status === 200 && theirs.status === 404 &&
              ssn.status === 404 && badId.status === 400 && opened.length === 2,
              JSON.stringify([okFile.status, filed.status, theirs.status, ssn.status, badId.status, opened]));
    stAssert_(out, P + 'the file door masks an account number in the file name as everywhere else',
              okFile.data && !/\d{9,}/.test(okFile.data.name) && /_•{8}5678_True_Link/.test(okFile.data.name),
              okFile.data && okFile.data.name);

    // ---- billing ----
    locationsToday_ = function () { return '2026-09-28'; };
    var BOOKS = {};
    BOOKS[CSF_PAWS_FALLBACK + '|' + CSF_PAWS_TAB] = [
      ['%', 'Name', 'Span', 'Notes', 'Projected $', 'Authorized $', 'Projected (un)', 'Authorized (un)'],
      ['0.085', 'Barbara Quill', '7/1/25-6/30/26', 'Spoke with the SSA', '150100.25', '140200.75', '18000.5', '16500'],
      ['0.03', 'Tessa Mocker', '8/3/25-10/15/26', '', '', '120,450.10', '', '14200'],
      ['0.01', 'Pat Doe', '1/1/26-10/1/26', '', '', '1,000.00', '', '100']
    ];
    BOOKS[CSF_CLIENT_DB_FALLBACK + '|' + CSF_SPANS_TAB] = [
      ['', '', '', '', '', '', ''],
      ['$', 'SSA', 'Span', 'Email', 'Phone', 'Units', 'Client'],
      ['$70,125.50', 'Dana Rowe', '3/21/26-6/30/26', 'rowe@example.org', '(330) 555-0142', '8,100.00', 'Barb Quill'],
      ['$', 'SSA', 'Span', 'Email', 'Phone', '', 'Client'],
      ['$30,250.00', 'K M', '4/4/26-6/30/26', '', '', '4,000.00', 'Nora Vale']
    ];
    BOOKS[CSF_MBS_FALLBACK + '|' + CSF_MBS_TAB] = [
      ['**************************'], [''],
      ['    TOTAL UNITS:   1318                     CLAIM INPUT ERRORS FOR BILLING CYCLE DEC25E'],
      ['  7000123   MOCKE    T    123456789012  12/26/2025  12/01/2025    APC      1      1     STAR        8.34     20'],
      [''], ['                (57) INDIV SUSPENDED FROM PAWS ON THIS DATE'], ['------------------------------------'],
      ['  7000123   OTHER    X    999999999999  12/26/2025  12/02/2025    APC      1      1     STAR        8.34     10'],
      [''], ['                (9 ) CLAIM DOES NOT MATCH USEABLE PAWS RECORD']
    ];
    BOOKS[CSF_MBS_FALLBACK + '|' + CSF_EVV_TAB] = [
      ['EVV', 'Date', 'Notes', 'Billed', 'Client', 'Additional Needed'],
      ['0', '45992', 'Need the EVV visit re-entered', '20', 'MOCKER', '20']
    ];
    var pawsOpen = true, spansOpen = true, mbsOpen = true, claimsTable = null;
    ssOpen_ = function (id) {
      return { getSheetByName: function (tab) {
        if (id === CSF_PAWS_FALLBACK && !pawsOpen) throw new Error('st: PAWS closed');
        if (id === CSF_CLIENT_DB_FALLBACK && !spansOpen) throw new Error('st: Sheet6 closed');
        if (id === CSF_MBS_FALLBACK && tab === CSF_MBS_TAB && !mbsOpen) throw new Error('st: Billing Errors closed');
        var g = BOOKS[id + '|' + tab];
        return g ? stCsfSheet_(g) : null;
      } };
    };
    hubTabSheet_ = function (tab) { return tab === 'billing_claims' && claimsTable ? stCsfSheet_(claimsTable) : null; };
    psiPunchesFullSheet_ = function () {
      return stCsfSheet_([
        ['date_iso', 'hours', 'work_code', 'consumer_1', 'consumer_2', 'consumer_3', 'date_service'],
        ['2026-06-07', '2.00', 'ADMIN', '', '', '', ''],
        ['2026-06-10', '7.00', 'HPC', 'Tessa Mocker', '', '', ''],
        ['2026-09-01', '3.50', 'HPC', 'Someone Else', 'Tessa Mocker', '', ''],
        ['2026-09-02', '5', 'ADMIN', 'Tessa Mocker', '', '', ''],
        ['2026-09-03', '4', 'HPC', 'Tim Mocke', '', '', '']
      ]);
    };
    var ERROR_DETAIL = '    TOTAL UNITS:   6464                     CLAIM INPUT ERRORS FOR BILLING CYCLE FEB26B\n' +
      '  7000123   MOCKE    T    123456789012  02/04/2026  01/10/2026    AQW      1      2     STAR       16.68      4\n\n' +
      '                (67) EVV UNITS ARE INSUFFICIENT\n------------------------------------\n';
    var EVV_INFO = '   EVV INFORMATION FOR SERVICE DATES BILLED IN BILLING CYCLE FEB26B\n' +
      '              MOCKER    TESSA    123456789012    01/10/26          24                0             24         66 \n';
    csfMbsFolder_ = function () {
      return { folder: { getFiles: function () {
        return stCsfIter_([stCsfFile_('st-err', 'ERROR_DETAIL_FEB26B_7000123.TXT', ERROR_DETAIL),
                           stCsfFile_('st-evv', 'EVV_INFO_FEB26B_7000123.TXT', EVV_INFO),
                           stCsfFile_('st-err-again', 'ERROR_DETAIL_FEB26B_7000123.TXT', ERROR_DETAIL),
                           stCsfFile_('st-pdf', 'Billing notes.pdf', 'not read')]);
      } }, why: '' };
    };

    var billing = HUB_ACTIONS.clientSourceBilling({ client: 'tessa_mocker' }, master);
    var bd = billing.data || {};
    var auth = ((bd.tabs || {}).authorizations || {}).rows || [];
    var paws = auth.filter(function (r) { return r.source === 'PAWS Adjustments'; })[0] || {};
    var ispRow = auth.filter(function (r) { return r.kind === 'isp'; })[0] || {};
    stAssert_(out, P + 'billing: the PAWS span is joined by name with its units authorized, its units used counted from the ' +
                   'first PSI punch (service codes only), and its status from the end date; the ISP span rides beside it',
              billing.status === 200 && paws.span_start === '2025-08-03' && paws.span_end === '2026-10-15' &&
              paws.status === 'Renewal due' && paws.units_authorized === 14200 && paws.amount_authorized === 120450.1 &&
              paws.units_used === 42 && paws.units_used_from === '2026-06-07' && paws.renewal_due === true &&
              ispRow.span_start === '2026-06-25' && ispRow.status === 'Current' && ispRow.ssa === 'Sue Case' &&
              bd.kpis.renewals_due === 1,
              JSON.stringify([paws, ispRow, bd.kpis]));
    var claims = ((bd.tabs || {}).claims || {}).rows || [];
    var feb = claims.filter(function (r) { return r.cycle === 'FEB26B'; })[0] || {};
    var dec = claims.filter(function (r) { return r.cycle === 'DEC25E'; })[0] || {};
    stAssert_(out, P + 'billing: claims are this client\'s MBS lines joined by the Medicaid number — the newest report and the ' +
                   'sheet — with rate × units, the EVV line and the EVV Fixes note beside them; another client\'s line stays out, ' +
                   'and a second copy of a report under the same name is counted once',
              claims.length === 2 && feb.amount === 66.72 && feb.date === '2026-01-10' && feb.status === 'Rejected' &&
              feb.evv && feb.evv.additional_needed === 24 && feb.evv.error_code === '66' &&
              dec.amount === 166.8 && dec.errors[0].code === '57' && dec.evv_fix && dec.evv_fix.notes === 'Need the EVV visit re-entered' &&
              bd.kpis.unpaid_claims === 233.52 && bd.kpis.unpaid_claims_why === '' && bd.kpis.renewals_due_why === '' &&
              bd.tabs.claims.kpis.unpaid === 233.52 && bd.tabs.claims.kpis.rejected === 2 &&
              bd.kpis.draft_claims === null && /billing_claims/.test(bd.kpis.draft_claims_why),
              JSON.stringify([claims, bd.kpis]));
    var btext = JSON.stringify(bd);
    stAssert_(out, P + 'billing: no Medicaid number, SSA e-mail or phone leaves in the answer',
              !/\d{9,}/.test(btext) && btext.indexOf('rowe@example.org') === -1 && btext.indexOf('555-0142') === -1,
              (btext.match(/\d{9,}/) || [''])[0]);

    clientsDerived_ = function () { return ROSTER; };
    var bm = HUB_ACTIONS.clientSourceBilling({ client: 'barbara_quill' }, master).data || {};
    var bmRows = bm.tabs.authorizations.rows;
    var near = bmRows.filter(function (r) { return r.source === 'Client Database › Sheet6'; });
    stAssert_(out, P + 'billing: "Barb Quill" joins Barbara Quill as a near spelling and says so; "Nora Vale" joins nobody; ' +
                   'with no Medicaid number the claims say why instead of an empty table',
              near.length === 1 && near[0].match === 'near' && /near spelling/.test(near[0].details) &&
              near[0].units_authorized === 8100 && near[0].ssa === 'Dana Rowe' &&
              /no Medicaid number/.test(bm.tabs.claims.why || '') && bm.tabs.claims.rows.length === 0 &&
              bm.kpis.unpaid_claims === null && /^not summed, because the ISP carries no Medicaid number/.test(bm.kpis.unpaid_claims_why),
              JSON.stringify([near, bm.tabs.claims, bm.kpis]));

    pawsOpen = false;
    var bdown = HUB_ACTIONS.clientSourceBilling({ client: 'tessa_mocker' }, master).data || {};
    stAssert_(out, P + 'billing: an unreadable PAWS book says why on Authorizations and marks the answer degraded; the other ' +
                   'sources still answer',
              bdown.degraded === true && /PAWS Adjustments could not be read/.test(bdown.tabs.authorizations.why || '') &&
              bdown.tabs.authorizations.rows.some(function (r) { return r.kind === 'isp'; }),
              JSON.stringify(bdown.tabs && bdown.tabs.authorizations));
    stAssert_(out, P + 'billing: with PAWS Adjustments unreadable, Renewals due is null with its why — never the count of what ' +
                   'answered — no row claims to count toward it, and the unpaid sum still stands',
              bdown.kpis.renewals_due === null && bdown.tabs.authorizations.kpis.renewals_due === null &&
              /^not counted, because PAWS Adjustments could not be read/.test(bdown.kpis.renewals_due_why || '') &&
              !bdown.tabs.authorizations.rows.some(function (r) { return r.renewal_due; }) && bdown.kpis.unpaid_claims === 233.52,
              JSON.stringify(bdown.kpis));
    pawsOpen = true;
    spansOpen = false;
    var sdown = HUB_ACTIONS.clientSourceBilling({ client: 'tessa_mocker' }, master).data || {};
    spansOpen = true;
    stAssert_(out, P + 'billing: with Client Database › Sheet6 unreadable, Renewals due is null too, although PAWS Adjustments answered',
              sdown.kpis.renewals_due === null && /Sheet6 could not be read/.test(sdown.kpis.renewals_due_why || '') &&
              sdown.tabs.authorizations.rows.some(function (r) { return r.source === 'PAWS Adjustments'; }),
              JSON.stringify(sdown.kpis));

    mbsOpen = false;
    var mdown = HUB_ACTIONS.clientSourceBilling({ client: 'tessa_mocker' }, master).data || {};
    mbsOpen = true;
    var keepMax = CSF_MBS_MAX;
    CSF_MBS_MAX = 1;
    var cut;
    try { cut = HUB_ACTIONS.clientSourceBilling({ client: 'tessa_mocker' }, master).data || {}; }
    finally { CSF_MBS_MAX = keepMax; }
    stAssert_(out, P + 'billing: with the Billing Errors book unreadable, or reports left unread past the cap, Unpaid claims is null ' +
                   'with its why — never the sum of what answered — while the lines that were read still list',
              mdown.kpis.unpaid_claims === null && mdown.tabs.claims.kpis.unpaid === null && mdown.tabs.claims.kpis.rejected === null &&
              /^not summed, because the Billing Errors book could not be read/.test(mdown.kpis.unpaid_claims_why || '') &&
              mdown.tabs.claims.rows.length === 1 && mdown.degraded === true && mdown.kpis.renewals_due === 1 &&
              cut.kpis.unpaid_claims === null && /2 more MBS report\(s\)/.test(cut.kpis.unpaid_claims_why || '') && cut.degraded === true,
              JSON.stringify([mdown.kpis, cut.kpis]));

    claimsTable = [['id', 'client', 'status', 'amount', 'units', 'payer', 'spanStart', 'spanEnd'],
                   ['c1', 'Pat Doe', 'draft', '50', '4', 'Medicaid', '2026-09-01', '2026-09-30']];
    var pd = HUB_ACTIONS.clientSourceBilling({ client: 'pat_a' }, master).data || {};
    claimsTable = null;
    var pdNames = (pd.sources || []).map(function (s) { return s.name; });
    stAssert_(out, P + 'billing: a name two clients share joins no PAWS span, no punch and no billing_claims row, and says so; ' +
                   'renewals, drafts and the unpaid sum are null, and the answer is not degraded',
              pd.tabs.authorizations.rows.length === 0 && pd.tabs.claims.rows.length === 0 &&
              pdNames.indexOf('PAWS Adjustments') === -1 && pdNames.indexOf('PSI punches') === -1 &&
              /more than one client on file is named Pat Doe/.test(pd.tabs.authorizations.why || '') &&
              pd.kpis.renewals_due === null && /more than one client/.test(pd.kpis.renewals_due_why) &&
              pd.kpis.draft_claims === null && /billing_claims keeps its claims/.test(pd.kpis.draft_claims_why) &&
              pd.kpis.unpaid_claims === null && /billing_claims keeps its claims/.test(pd.kpis.unpaid_claims_why) &&
              pd.degraded === false,
              JSON.stringify([pd.kpis, pd.tabs && pd.tabs.authorizations.why, pdNames, pd.degraded]));

    // ---- the parsers ----
    var spans = [csfSpan_('2026 (ISP Span: May 31, 2026 - May 30, 2027; Effective Date July 13, 2026)'),
                 csfSpan_('2/3/26 - 6/30/26'), csfSpan_('Annual')];
    var money = [csfMoney_(' $ (1,838.56)'), csfMoney_(' $ -   '), csfMoney_(''), csfMoney_('n/a'), csfMoney_('$148,746.29')];
    stAssert_(out, P + 'parsers: both span shapes read, a word is no span; accounting money reads, a blank or a word is null',
              spans[0].start === '2026-05-31' && spans[0].end === '2027-05-30' && spans[1].start === '2026-02-03' &&
              spans[1].end === '2026-06-30' && spans[2] === null &&
              JSON.stringify(money) === JSON.stringify([-1838.56, 0, null, null, 148746.29]) &&
              csfLast4_('4111 1111 1111 1234') === '1234' && csfLast4_('12') === '' && csfPercent_('0.2218') === 22.18,
              JSON.stringify([spans, money]));
  } finally {
    csfClient_ = keep.client;
    clientsDerived_ = keep.derived;
    listRows_ = keep.list;
    readTabNormalized_ = keep.readTab;
    hubId_ = keep.hubId;
    ssOpen_ = keep.ss;
    hubTabSheet_ = keep.tabSheet;
    psiPunchesFullSheet_ = keep.psi;
    csfMbsFolder_ = keep.folder;
    cacheRead_ = keep.cache;
    cacheScope_ = keep.scope;
    locationsToday_ = keep.today;
    locationsDocBytes_ = keep.bytes;
    locationsBookId_ = keep.book;
    HUB_MASTER_EMAIL_CACHE = keep.masterCache;
    HUB_MEMBER_CTX = keep.member;
    hubProfileAppRules_ = keep.rules;
    HUB_VIEWER_MEMO = null;
  }
}
