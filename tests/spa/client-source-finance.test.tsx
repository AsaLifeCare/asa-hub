/**
 * CLIENT FUNDS AND BILLING · the section and its doors. Every read the section makes is caught at `fetch` and handed to
 * Apps Script's own ClientSourceFinance.gs, run here on in-memory stores (the ledger, the balances, the Funds folder, the
 * PAWS and MBS books, the punches, the Finances folder); the answer comes back as JSON and is read by the section's own
 * model and drawn whole. A name, a parameter or a field one side renames breaks here, not on the screen.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { forgetLocationReads, type ReadState } from '@/pages/features/locations/useLocation'
import { forgetClientReads } from '@/pages/features/clientprofiles/useClientRead'
import {
  FINANCE_NOT_PUBLISHED, attachReceipt, billingKpis, billingOf, cardMask, dayLabel, filterRows, financeRefusal, fundsKpis,
  fundsOf, markNoReceipt, money, panelOf, panelParam, readBilling, readFinanceFile, readFunds, receiptFile, statusChoices,
  tabFor, tabNote, tableRows, unitsCell, type BillingAnswer, type FundsAnswer,
} from '@/pages/features/clientprofiles/sources/finance'
import { FinanceView } from '@/pages/features/clientprofiles/sources/FinanceTab'
import { openPlatformDoc } from '@/lib/platformDoc'
import { useFileViewerStore } from '@/stores/useFileViewerStore'

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const CLIENT = 'tessa_mocker'
const NOW = '2026-09-28T15:00:00Z'
const PDF_B64 = Buffer.from([0x25, 0x50, 0x44, 0x46]).toString('base64')
const RECEIPT_ID = '1FormReceiptXXXXXXXXXXXXXXXXXXXXX'
const FILED_ID = '1FiledReceiptXXXXXXXXXXXXXXXXXXXX'
const STATEMENT_ID = '1BankStatementXXXXXXXXXXXXXXXXXXX'
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))
const noop = () => {}
const noModal = (html: string, what: string) => {
  assert.ok(!html.includes('aria-modal'), `${what}: no aria-modal`)
  assert.ok(!html.includes('role="dialog"') && !html.includes('role="alertdialog"'), `${what}: no dialog role`)
}
const ready = <T,>(data: T): ReadState<T> => ({ status: 'ready', data, error: '', refreshing: false })

const gsText = (file: string) => readFileSync(resolve(ROOT, 'apps-script', file), 'utf8')

/** One top-level function of a .gs file, exactly as written there. */
function lift(file: string, name: string): string {
  const src = gsText(file)
  const fn = src.indexOf(`\nfunction ${name}(`)
  assert.notEqual(fn, -1, `${file} has no ${name}`)
  return src.slice(fn + 1, src.indexOf('\n}', fn + 1) + 2)
}

const HELPERS: [string, string][] = [
  ['Clients.gs', 'clientNameKey_'], ['Talent.gs', 'str_'], ['Finance.gs', 'finNum_'], ['Finance.gs', 'finMonthOf_'],
  ['Finance.gs', 'finSrcDay_'], ['Locations.gs', 'locationsText_'], ['Locations.gs', 'locationsCell_'],
  ['Locations.gs', 'locationsNum_'], ['Locations.gs', 'locationsDriveId_'], ['Locations.gs', 'locationsBookId_'],
  ['Locations.gs', 'locationsToday_'],
]

/* ---------- the stores ---------- */

type Row = Record<string, unknown>
type Grid = unknown[][]

function freshStores() {
  return {
    roster: [
      { client_key: CLIENT, name: 'Tessa Mocker', medicaid_id: '123456789012', ssa_name: 'Sue Case',
        isp_year: '2026-2027 (ISP Span Dates: June 25, 2026 - June 24, 2027; Effective Date June 25, 2026)', medications: ['Secret pill'] },
      { client_key: 'tim_mocke', name: 'Tim Mocke', medicaid_id: '999999999999', isp_year: '' },
    ] as Row[],
    ledger: [
      { id: 't1', client: 'Tessa Mocker', date: '2026-03-01', amount: '300', type: 'Deposit', fundType: 'Debit Card', vendor: 'Deposit',
        legacyRowKey: 'K|1', receiptVerdict: 'NONE' },
      { id: 't2', client: 'Tessa Mocker', date: '2026-03-05', amount: '-36.2', type: 'Spending', fundType: 'Debit Card', vendor: 'Pizza Oven',
        category: 'Food', staffMember: 'Ann Lee', receiptName: `form-receipt-${RECEIPT_ID}`, receiptVerdict: 'UPLOADED',
        accountLast4: '4111111111111234' },
      { id: 't3', client: 'Tessa Mocker', date: '2026-03-06', amount: '-8.21', type: 'Spending', fundType: 'Cash', vendor: 'Walmart',
        receiptVerdict: 'NONE' },
      { id: 'o1', client: 'Tim Mocke', date: '2026-03-08', amount: '-99', fundType: 'Cash', vendor: 'Elsewhere' },
    ] as Row[] | null,
    balances: [
      { client_key: CLIENT, client_name: 'Tessa Mocker', total: ' $ (483.72)', house: ' $ -   ', office: '$ 100.00', as_of: '10/29',
        debit_card: '4111 1111 1111 1234' },
    ] as Row[],
    trueLink: [
      { rowkey: 'K|1', cardholdername: 'Tessa Mocker', transactiondate: '03-01-2026', amount: '300' },
      { rowkey: 'K|9', cardholdername: 'Tessa Mocker', transactiondate: '03-10-2026', amount: '-5', vendor: 'BANK FEE', fundtype: 'Debit Card',
        source: 'TrueLink', accountlast4: '1234' },
    ] as Row[],
    files: [
      ['drive_id', 'title', 'folder', 'doc_kind', 'digest_category', 'client_key', 'client_name', 'file_date', 'modified_time', 'digest_text'],
      [FILED_ID, 'Grocery_Receipts_02_01_2026_Tessa Mocker.pdf', 'Funds', 'receipt', 'receipt_invoice', CLIENT, 'Tessa Mocker', '',
       '2026-02-05T16:45:34.000Z', 'secret words'],
      [STATEMENT_ID, 'Mocker_Tessa_2026_222012345678_True_Link_statement.pdf', 'Funds', 'bank_statement', '', CLIENT, 'Tessa Mocker',
       '2026-03-31', '', ''],
      ['1SsnCardXXXXXXXXXXXXXXXXXXXXXXXXX', 'SSN card.pdf', 'Funds', 'ssn_card', 'identity', CLIENT, 'Tessa Mocker', '', '', ''],
    ] as Grid,
    books: {
      '1C81euMJk7rHL3DCymerYk0gG__5Rg9sNVwJFmxD5bIw|Sheet1': [
        ['%', 'Name', 'Span', 'Notes', 'Projected $', 'Authorized $', 'Projected (un)', 'Authorized (un)'],
        ['0.03', 'Tessa Mocker', '8/3/25-10/15/26', '', '', '120,450.10', '', '14200'],
      ],
      '1fTi78ztKDiK3hvYLbI2IQ1TeSrzVLceK5LyXJ4BVPe8|Sheet6': [
        ['', '', '', '', '', '', ''],
        ['$', 'SSA', 'Span', 'Email', 'Phone', 'Units', 'Client'],
        ['$30,250.00', 'K M', '4/4/26-6/30/26', 'km@example.org', '', '4,000.00', 'Nora Vale'],
      ],
      '1wEMjXy9LcOjsZgGY3Z8m6VbLcLTFNw-BCXQpIcZUKpA|Sheet1': [
        ['**************************'],
        ['    TOTAL UNITS:   1318                     CLAIM INPUT ERRORS FOR BILLING CYCLE DEC25E'],
        ['  7000123   MOCKE    T    123456789012  12/26/2025  12/01/2025    APC      1      1     STAR        8.34     20'],
        [''], ['                (57) INDIV SUSPENDED FROM PAWS ON THIS DATE'], ['------------------------------'],
        ['  7000123   OTHER    X    999999999999  12/26/2025  12/02/2025    APC      1      1     STAR        8.34     10'],
      ],
      '1wEMjXy9LcOjsZgGY3Z8m6VbLcLTFNw-BCXQpIcZUKpA|EVV Fixes': [
        ['EVV', 'Date', 'Notes', 'Billed', 'Client', 'Additional Needed'],
        ['0', '45992', 'Need the EVV visit re-entered', '20', 'MOCKER', '20'],
      ],
    } as Record<string, Grid>,
    punches: [
      ['date_iso', 'hours', 'work_code', 'consumer_1', 'consumer_2', 'consumer_3'],
      ['2026-06-07', '2.00', 'ADMIN', '', '', ''],
      ['2026-06-10', '7.00', 'HPC', 'Tessa Mocker', '', ''],
      ['2026-09-01', '3.50', 'HPC', 'Someone Else', 'Tessa Mocker', ''],
    ] as Grid,
    reports: [
      { id: 'err', name: 'ERROR_DETAIL_FEB26B_7000123.TXT', text: '    TOTAL UNITS:   6464     CLAIM INPUT ERRORS FOR BILLING CYCLE FEB26B\n' +
        '  7000123   MOCKE    T    123456789012  02/04/2026  01/10/2026    AQW      1      2     STAR       16.68      4\n\n' +
        '                (67) EVV UNITS ARE INSUFFICIENT\n------------------------------\n' },
      { id: 'evv', name: 'EVV_INFO_FEB26B_7000123.TXT', text: '   EVV INFORMATION FOR SERVICE DATES BILLED IN BILLING CYCLE FEB26B\n' +
        '              MOCKER    TESSA    123456789012    01/10/26          24                0             24         66 \n' },
    ],
    drive: { [RECEIPT_ID]: 'application/pdf', [FILED_ID]: 'application/pdf', [STATEMENT_ID]: 'image/png' } as Record<string, string>,
  }
}

let S = freshStores()

function sheetOf(grid: Grid) {
  const width = Math.max(0, ...grid.map((r) => r.length))
  const cell = (r: number, c: number) => grid[r]?.[c] ?? ''
  return {
    getLastRow: () => grid.length,
    getLastColumn: () => width,
    getDataRange: () => ({ getValues: () => grid.map((_, r) => Array.from({ length: width }, (_x, c) => cell(r, c))) }),
    getRange: (r: number, c: number, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_x, j) => cell(r - 1 + i, c - 1 + j))),
    }),
  }
}

const iter = <T,>(items: T[]) => {
  let i = 0
  return { hasNext: () => i < items.length, next: () => items[i++] }
}

function formatDate(date: Date, tz: string, pattern: string): string {
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(date)
  if (pattern === 'yyyy-MM-dd') {
    return `${part({ year: 'numeric' })}-${part({ month: '2-digit' }).padStart(2, '0')}-${part({ day: '2-digit' }).padStart(2, '0')}`
  }
  throw new Error(`formatDate pattern ${pattern} is not stood in for`)
}

/* ---------- Apps Script, booted ---------- */

type Gs = Record<string, unknown> & {
  HUB_POLICY: Record<string, { file: string; lane: string; params?: Record<string, unknown> }>
  HUB_ACTIONS: Record<string, (payload: unknown, user: unknown) => unknown>
  CSF_ACTIONS: string[]
}

function boot(): Gs {
  const folder = (name: string, kids: Record<string, unknown>) => ({
    getName: () => name,
    getFoldersByName: (n: string) => iter(kids[n] ? [kids[n]] : []),
    getFiles: () => iter(S.reports.map((r) => ({
      getId: () => r.id, getName: () => r.name, getLastUpdated: () => new Date('2026-02-12T17:01:00Z'),
      getBlob: () => ({ getDataAsString: () => r.text }),
    }))),
  })
  const g: Record<string, unknown> = {
    console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, isNaN, isFinite, Error,
    HUB_POLICY: {}, HUB_ACTIONS: {},
    Utilities: { formatDate },
    DriveApp: {
      getFolderById: (id: string) => {
        if (id !== 'finroot') throw new Error(`Folder not found: ${id}`)
        return folder('Finances', { Billing: folder('Billing', { 'Billing Errors': folder('Billing Errors', {}) }) })
      },
    },
    hubIsRealMaster_: (u: Row | null) => !!u && u.email === 'boss@example.org' && !u.visiting_member && !u.is_service,
    hubQuietNow_: () => new Date(NOW),
    hubProp_: () => '',
    hubId_: (k: string) => (k === 'FIN_TRUELINK_SHEET_ID' ? 'tl-book' : k === 'FIN_DRIVE_ROOT_ID' ? 'finroot' : ''),
    cacheRead_: (_scope: string, _name: string, fn: () => unknown) => fn(),
    cacheScopeSheet_: (id: string, tab: string) => `${id}:${tab}`,
    cacheScope_: (t: string) => t,
    cacheVersion_: () => 1,
    cacheBump_: () => {},
    clientsDerived_: () => S.roster,
    listRows_: (r: string) => {
      if (r === 'financeTransactions') { if (!S.ledger) throw new Error('the ledger is closed'); return S.ledger }
      return r === 'financeBalances' ? S.balances : []
    },
    readTabNormalized_: () => S.trueLink,
    ssOpen_: (id: string) => ({ getSheetByName: (tab: string) => (S.books[`${id}|${tab}`] ? sheetOf(S.books[`${id}|${tab}`]) : null) }),
    hubTabSheet_: (tab: string) => (tab === 'client_files' ? sheetOf(S.files) : null),
    psiPunchesFullSheet_: () => sheetOf(S.punches),
    locationsDocBytes_: (id: string) => {
      const mime = S.drive[id]
      if (!mime) throw new Error(`File not found: ${id}`)
      return { name: `${id}.pdf`, mime, size: 4, exported: false, b64: PDF_B64 }
    },
  }
  const ctx = vm.createContext(g)
  vm.runInContext(HELPERS.map(([file, name]) => lift(file, name)).join('\n'), ctx)
  vm.runInContext(gsText('ClientSourceFinance.gs'), ctx)
  return ctx as unknown as Gs
}

const GS = boot()
const MASTER = { email: 'boss@example.org', role: 'admin', display_name: 'Boss' }
let USER: Row = MASTER

/* ---------- the section's calls, answered by the doors ---------- */

const calls: { action: string; payload: Row }[] = []
const realFetch = globalThis.fetch

before(() => {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : ''
    const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload: Row }
    calls.push({ action: env.action, payload: env.payload ?? {} })
    if (env.action === 'finMarkNoReceipt') return new Response(JSON.stringify({ status: 200, data: { id: env.payload.id, verdict: 'EXEMPT' } }))
    if (env.action === 'finAttachReceipt') return new Response(JSON.stringify({ status: 200, data: { verdict: 'MATCH', note: 'ok' } }))
    const door = GS.HUB_ACTIONS[env.action]
    const out = door ? door(JSON.parse(JSON.stringify(env.payload ?? {})), USER) : { status: 404, message: 'Unknown action.' }
    return new Response(JSON.stringify(out))
  }) as typeof fetch
})
after(() => { globalThis.fetch = realFetch })
beforeEach(() => {
  S = freshStores()
  USER = MASTER
  calls.length = 0
  forgetLocationReads()
  forgetClientReads()
})

describe('the names', () => {
  it('every door the section names is a ClientSourceFinance.gs action or Client Finances\' own receipt door, and every ' +
     'ClientSourceFinance.gs action has a caller in the generated catalogue', () => {
    const named = new Set<string>()
    for (const f of ['finance.ts', 'FinanceTab.tsx']) {
      const src = readFileSync(resolve(ROOT, 'src/pages/features/clientprofiles/sources', f), 'utf8')
      for (const m of src.matchAll(/gasAction(?:<[^>]*>)?\(\s*'([A-Za-z]+)'/g)) named.add(m[1])
    }
    const own = [...named].filter((n) => !n.startsWith('fin'))
    assert.deepEqual(own.sort(), [...GS.CSF_ACTIONS].sort())
    for (const n of own) assert.equal(GS.HUB_POLICY[n]?.file, 'ClientSourceFinance.gs')
    assert.deepEqual([...named].filter((n) => n.startsWith('fin')).sort(), ['finAttachReceipt', 'finMarkNoReceipt'])
    const finance = gsText('Finance.gs')
    for (const n of ['finAttachReceipt', 'finMarkNoReceipt']) assert.ok(finance.includes(`HUB_ACTIONS.${n} =`), `${n} is Finance.gs's`)
    const catalogue = readFileSync(resolve(ROOT, 'src/lib/actions.generated.ts'), 'utf8')
    for (const n of named) assert.ok(catalogue.includes(`"${n}"`), `${n} is in the generated catalogue`)
  })
})

describe('funds, as the section reads them', () => {
  it('the ledger arrives as the mockup\'s rows: newest first, statuses from the receipts, another client never', async () => {
    const f = fundsOf(await readFunds(CLIENT))
    assert.deepEqual(calls.map((c) => [c.action, c.payload]), [['clientSourceFunds', { client: CLIENT }]])
    const rows = tableRows('transactions', f, null)
    assert.deepEqual(rows.map((r) => [r.record, r.cells.date, r.cells.amount, r.status]), [
      ['BANK FEE', 'Mar 10, 2026', '−$5.00', 'Missing receipt'],
      ['Walmart', 'Mar 6, 2026', '−$8.21', 'Missing receipt'],
      ['Pizza Oven', 'Mar 5, 2026', '−$36.20', 'Receipt On File'],
      ['Deposit', 'Mar 1, 2026', '$300.00', 'Recorded'],
    ])
    assert.ok(!JSON.stringify(f).includes('Elsewhere'))
    assert.deepEqual(fundsKpis(f).map((k) => [k.label, k.value]), [
      ['Personal balance', '−$483.72'], ['Missing receipts', '2'], ['Transactions', '4']])
    assert.match(fundsKpis(f)[0].sub, /On file in Client Finances · as of 10\/29/)
  })

  it('balances: the balance on file and a row per fund, whose opening is said to be unknown rather than drawn as 0', async () => {
    const f = fundsOf(await readFunds(CLIENT))
    const rows = tableRows('balances', f, null)
    assert.deepEqual(rows.map((r) => [r.record, r.cells.balance, r.cells.missing, r.status]), [
      ['Tessa Mocker', '−$483.72', '2', 'On file'],
      ['Tessa Mocker · Cash', '—', '1', 'Opening unknown'],
      ['Tessa Mocker · Debit Card', '—', '1', 'Opening unknown'],
    ])
    assert.equal(rows[1].action.kind, 'transactions')
    assert.match(rows[0].sub, /card ending 1234/)
    assert.deepEqual(filterRows(tableRows('transactions', f, null), '', '', 'Cash').map((r) => r.record), ['Walmart'])
  })

  it('receipts: every spend and the Funds-folder receipts; the file the page offers, the door serves; an identity paper never', async () => {
    const f = fundsOf(await readFunds(CLIENT))
    const rows = tableRows('receipts', f, null)
    assert.deepEqual(rows.map((r) => r.status).sort(), ['Filed', 'Missing receipt', 'Missing receipt', 'Receipt On File'])
    assert.deepEqual(statusChoices(rows, f.tabs.receipts.statuses), ['Receipt On File', 'Missing receipt', 'Filed'])
    const offered = f.tabs.receipts.rows.map((r) => receiptFile(r).fileId).filter(Boolean).sort()
    assert.deepEqual(offered, [FILED_ID, RECEIPT_ID].sort())
    for (const id of offered) {
      const got = await readFinanceFile(CLIENT, id)
      assert.equal(got.b64, PDF_B64)
    }
    assert.deepEqual(f.documents.rows.map((d) => d.file_id), [STATEMENT_ID])
    assert.match(f.documents.rows[0].record, /_•{8}5678_True_Link/)
    await assert.rejects(readFinanceFile(CLIENT, '1SsnCardXXXXXXXXXXXXXXXXXXXXXXXXX'), /name no such document/)
    const text = JSON.stringify(f)
    assert.ok(!/\d{9,}/.test(text) && !text.includes('secret words') && !text.includes('4111'), 'no long number and no file text')
  })

  it('an unreadable ledger answers why, and the section says it instead of an empty table', async () => {
    S.ledger = null
    const f = fundsOf(await readFunds(CLIENT))
    assert.equal(f.kpis.transactions, null)
    assert.equal(fundsKpis(f)[1].tone, 'slate', 'an uncounted missing-receipts card is not green')
    assert.match(tabNote('transactions', f, null, 'Tessa Mocker').why, /could not be read/)
    const html = draw(<FinanceView client={CLIENT} clientName="Tessa Mocker" section="funds" funds={ready(f)} billing={null}
      tab="transactions" onTab={noop} panel={null} onPanel={noop} onRetry={noop} />)
    assert.ok(html.includes('data-why="transactions"'))
    assert.ok(!html.includes('data-empty="transactions"'))
    assert.ok(html.includes('data-kpi="transactions"') && html.includes('>—<'))
  })

  it('a session that is not the master\'s is told the section is not published, never shown an empty one', async () => {
    USER = { email: 'mgr@example.org', role: 'manager' }
    await assert.rejects(readFunds(CLIENT), /Unknown action/)
    assert.equal(financeRefusal('Unknown action.'), FINANCE_NOT_PUBLISHED)
    const failed: ReadState<FundsAnswer> = { status: 'failed', data: null, error: 'Unknown action.', refreshing: false }
    const html = draw(<FinanceView client={CLIENT} clientName="" section="funds" funds={failed} billing={null}
      tab="balances" onTab={noop} panel={null} onPanel={noop} onRetry={noop} />)
    assert.ok(html.includes(FINANCE_NOT_PUBLISHED.slice(0, 40)))
  })
})

describe('billing, as the section reads it', () => {
  it('authorizations: the PAWS span with units used / authorized and its renewal, the ISP span beside it', async () => {
    const b = billingOf(await readBilling(CLIENT))
    const rows = tableRows('authorizations', null, b)
    assert.deepEqual(rows.map((r) => [r.record, r.cells.date, r.cells.units, r.status]), [
      ['ISP span', 'Jun 25, 2026 – Jun 24, 2027', '— / —', 'Current'],
      ['PAWS authorization', 'Aug 3, 2025 – Oct 15, 2026', '42 / 14,200', 'Renewal due'],
    ])
    assert.deepEqual(billingKpis(b).map((k) => [k.label, k.value]), [['Renewals due', '1'], ['Draft claims', '—'], ['Unpaid claims $', '$233.52']])
    assert.match(billingKpis(b)[1].sub, /billing_claims table does not exist/)
    assert.deepEqual(billingKpis(b).map((k) => k.tone), ['amber', 'slate', 'red'])
  })

  it('a book that did not answer leaves its KPI unknown with the why under it — never a green 0 or a partial sum', async () => {
    delete S.books['1C81euMJk7rHL3DCymerYk0gG__5Rg9sNVwJFmxD5bIw|Sheet1']
    delete S.books['1wEMjXy9LcOjsZgGY3Z8m6VbLcLTFNw-BCXQpIcZUKpA|Sheet1']
    const b = billingOf(await readBilling(CLIENT))
    assert.equal(b.kpis.renewals_due, null)
    assert.equal(b.kpis.unpaid_claims, null)
    assert.equal(b.tabs.claims.rows.length, 1, 'the report the folder holds still lists')
    const [renewals, , unpaid] = billingKpis(b)
    assert.deepEqual([renewals.value, renewals.tone, unpaid.value, unpaid.tone], ['—', 'slate', '—', 'slate'])
    assert.match(renewals.sub, /^not counted, because PAWS Adjustments could not be read/)
    assert.match(unpaid.sub, /^not summed, because the Billing Errors book could not be read/)
    const html = draw(<FinanceView client={CLIENT} clientName="Tessa Mocker" section="billing" funds={null} billing={ready(b)}
      tab="claims" onTab={noop} panel={null} onPanel={noop} onRetry={noop} />)
    assert.ok(html.includes('data-kpi="renewals_due" data-tone="slate"') && html.includes('data-kpi="unpaid_claims" data-tone="slate"'))
    assert.ok(html.includes('not counted, because PAWS Adjustments could not be read'), 'the claims tab shows the renewals why too')
    assert.ok(!html.includes('data-tone="green"'))
  })

  it('claims: this client\'s MBS lines by the Medicaid number, with the EVV line and the EVV Fixes note; no number leaves', async () => {
    const b = billingOf(await readBilling(CLIENT))
    const rows = tableRows('claims', null, b)
    assert.deepEqual(rows.map((r) => [r.record, r.cells.date, r.cells.amount, r.status]), [
      ['AQW · FEB26B', 'Jan 10, 2026', '$66.72', 'Rejected'],
      ['APC · DEC25E', 'Dec 1, 2025', '$166.80', 'Rejected'],
    ])
    assert.equal(b.tabs.claims.rows[0].evv?.additional_needed, 24)
    assert.equal(b.tabs.claims.rows[1].evv_fix?.notes, 'Need the EVV visit re-entered')
    const text = JSON.stringify(b)
    assert.ok(!/\d{9,}/.test(text) && !text.includes('km@example.org'))
  })

  it('the screen: the mockup\'s KPI cards and columns, pills, a pencil per row, and every detail in the right panel', async () => {
    const b = billingOf(await readBilling(CLIENT))
    const html = draw(<FinanceView client={CLIENT} clientName="Tessa Mocker" section="billing" funds={null} billing={ready(b)}
      tab="authorizations" onTab={noop} panel={{ kind: 'auth', id: 'paws-2' }} onPanel={noop} onRetry={noop} />)
    for (const label of ['Renewals due', 'Draft claims', 'Unpaid claims $', 'Units used / authorized', 'All statuses']) {
      assert.ok(html.includes(label), label)
    }
    assert.ok(html.includes('data-status="Renewal due"') && html.includes('data-action="pencil"'))
    assert.ok(html.includes('data-panel="auth"') && html.includes('counts toward Renewals due'))
    noModal(html, 'billing')
    const claims = draw(<FinanceView client={CLIENT} clientName="Tessa Mocker" section="billing" funds={null} billing={ready(b)}
      tab="claims" onTab={noop} panel={{ kind: 'claim', id: b.tabs.claims.rows[0].id }} onPanel={noop} onRetry={noop} />)
    assert.ok(claims.includes('4 units × $16.68 = $66.72') && claims.includes('(67) EVV UNITS ARE INSUFFICIENT'))
    noModal(claims, 'claims')
  })
})

describe('the funds screen', () => {
  it('Balances, Transactions and Receipts in the mockup\'s columns; a missing receipt opens with Client Finances\' own doors', async () => {
    const f = fundsOf(await readFunds(CLIENT))
    const view = (tab: 'balances' | 'transactions' | 'receipts', panel: ReturnType<typeof panelOf>) =>
      draw(<FinanceView client={CLIENT} clientName="Tessa Mocker" section="funds" funds={ready(f)} billing={null} tab={tab}
        onTab={noop} panel={panel} onPanel={noop} onRetry={noop} />)
    const bal = view('balances', null)
    for (const label of ['Personal balance', 'Missing receipts', 'Transactions', 'View transactions', 'Statements on file']) {
      assert.ok(bal.includes(label), label)
    }
    const tx = view('transactions', { kind: 'txn', id: 't3' })
    assert.ok(tx.includes('data-table="transactions"') && tx.includes('data-status="Missing receipt"'))
    assert.ok(tx.includes('data-receipt-actions=""') && tx.includes('Mark no receipt') && tx.includes('Attach receipt'))
    const paid = view('transactions', { kind: 'txn', id: 't2' })
    assert.ok(paid.includes(cardMask('1234')) && paid.includes('data-open-receipt=""') && !paid.includes('data-receipt-actions'))
    const rc = view('receipts', { kind: 'receipt', id: 'rc-t2' })
    assert.ok(rc.includes('Review receipt') && rc.includes('data-view-file="rc-t2"') && rc.includes('View the receipt'))
    assert.ok(!rc.includes('<iframe') && !rc.includes('xl:w-['), 'the receipt is never framed in the panel')
    const none = view('receipts', { kind: 'receipt', id: 'rc-t3' })
    assert.ok(none.includes('data-no-file=""') && none.includes('No receipt is on file for this spend.'))
    for (const html of [bal, tx, paid, rc, none]) noModal(html, 'funds')
  })

  it('a receipt opens in the platform\'s centred viewer: its bytes through its own door, with the client, as a blob URL', async () => {
    const realRevoke = URL.revokeObjectURL
    const revoked: string[] = []
    URL.revokeObjectURL = (u: string) => { revoked.push(u); realRevoke.call(URL, u) }
    try {
      assert.equal(await openPlatformDoc(readFinanceFile(CLIENT, RECEIPT_ID), { title: 'Grocery receipt' }), true)
      assert.deepEqual(calls.map((c) => [c.action, c.payload]), [['clientSourceFinanceFile', { client: CLIENT, id: RECEIPT_ID }]])
      const shown = useFileViewerStore.getState().file
      assert.equal(shown?.title, 'Grocery receipt')
      assert.match(shown?.url ?? '', /^blob:/)
      useFileViewerStore.getState().closeFile()
      assert.deepEqual(revoked, [shown?.url], 'the bytes are let go when the viewer closes')
      assert.equal(await openPlatformDoc(readFinanceFile(CLIENT, RECEIPT_ID), { title: 'Grocery receipt' }), true)
      assert.equal(calls.length, 1, 'opened again: the bytes held in memory for the tab, no second read')
      useFileViewerStore.getState().closeFile()
      await assert.rejects(openPlatformDoc(readFinanceFile(CLIENT, 'strangerxxxxxxxxxxxx'), { title: 'x' }), /name no such document/)
    } finally {
      URL.revokeObjectURL = realRevoke
      useFileViewerStore.getState().closeFile()
    }
  })

  it('the receipt writes are Client Finances\' own, with its parameters', async () => {
    await markNoReceipt('t3', 'Lost', 'dropped at the store')
    await attachReceipt('t3', { name: 'r.jpg', mime: 'image/jpeg', b64: 'AAAA' })
    assert.deepEqual(calls.map((c) => [c.action, c.payload]), [
      ['finMarkNoReceipt', { id: 't3', reason: 'Lost', note: 'dropped at the store' }],
      ['finAttachReceipt', { id: 't3', receiptBase64: 'AAAA', receiptMime: 'image/jpeg', receiptFileName: 'r.jpg' }],
    ])
  })
})

describe('the model', () => {
  it('money, days, units, the card mask and the panel in the URL', () => {
    assert.deepEqual([money(-1838.56), money(0), money(null), money(1234.5)], ['−$1,838.56', '$0.00', '—', '$1,234.50'])
    assert.deepEqual([dayLabel('2026-03-22'), dayLabel(''), dayLabel('10/29')], ['Mar 22, 2026', '—', '10/29'])
    assert.equal(unitsCell(2081, 14200), '2,081 / 14,200')
    assert.equal(cardMask('4111111111111234'), '•••• •••• •••• 1234')
    assert.equal(cardMask(''), '')
    assert.deepEqual(panelOf(panelParam({ kind: 'receipt', id: 'rc-t2' })), { kind: 'receipt', id: 'rc-t2' })
    assert.equal(panelOf('nope:1'), null)
    assert.equal(tabFor('funds', 'claims'), 'balances')
    assert.equal(tabFor('billing', 'claims'), 'claims')
  })

  it('an answer with fields missing reads as empty, never as invented numbers', () => {
    const f: FundsAnswer = fundsOf({})
    const b: BillingAnswer = billingOf(null)
    assert.equal(f.kpis.personal_balance, null)
    assert.deepEqual(fundsKpis(f).map((k) => k.value), ['—', '—', '—'])
    assert.deepEqual(billingKpis(b).map((k) => k.value), ['—', '—', '—'])
    assert.deepEqual([...fundsKpis(f), ...billingKpis(b)].map((k) => k.tone), ['slate', 'slate', 'slate', 'slate', 'slate', 'slate'])
    assert.deepEqual(tableRows('claims', null, b), [])
  })
})
