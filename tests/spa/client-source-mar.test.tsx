/**
 * CLIENTS › ADMINISTRATION · the tab and its doors together. Every call the tab makes is caught at `fetch` and handed
 * to Apps Script's own ClientSourceMar.gs, run here on in-memory stores (the roster, the three tabs, the drive); the
 * answer is read back by the tab's own model and drawn by its own components. A name, a parameter or a field one side
 * renames breaks here, not on the screen.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { bootClientFiles } from './client-files-index'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { blobOf, docShapeOf } from '@/pages/features/myprofile/certDocFile'
import { forgetLocationReads, readKey, useLocationRead, type ReadState } from '@/pages/features/locations/useLocation'
import {
  EMPTY_LINE, MAR_ACTIONS, NOT_PUBLISHED, PAGE, asOfLine, dateCell, digestOf, emptyLine, filterMarRows, kpiCards, marOf,
  readMar, readMarDoc, readMarText, readRefusal, statusTone, textOf, usePaperOpener, type MarAnswer, type PaperRow,
} from '@/pages/features/clientprofiles/sources/mar'
import { MarBody, MarPanel } from '@/pages/features/clientprofiles/sources/MarTab'
import { useFileViewerStore } from '@/stores/useFileViewerStore'
import { mountHook } from './react-host'

// motion mounts its projection nodes against the window; a panel drawn whole reaches them
for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const KENNY = 'kenny_marsh'
const TAVI = 'tavi_corvenly'
const PDF = [0x25, 0x50, 0x44, 0x46]
const JPG = [0xff, 0xd8, 0xff, 0xe0]
const noop = () => {}
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(<>{node}</>))
const ready = <T,>(data: T): ReadState<T> => ({ status: 'ready', data, error: '', refreshing: false })
const noModal = (html: string, what: string) => {
  assert.ok(!html.includes('aria-modal'), `${what}: no aria-modal`)
  assert.ok(!html.includes('role="dialog"') && !html.includes('role="alertdialog"'), `${what}: no dialog role`)
}

const gsText = (file: string) => readFileSync(resolve(ROOT, 'apps-script', file), 'utf8')

/** One top-level function or var of a .gs file, exactly as written there. */
function lift(file: string, name: string): string {
  const src = gsText(file)
  const fn = src.indexOf(`\nfunction ${name}(`)
  if (fn !== -1) return src.slice(fn + 1, src.indexOf('\n}', fn + 1) + 2)
  const v = src.indexOf(`\nvar ${name} =`)
  assert.notEqual(v, -1, `${file} has no ${name}`)
  return src.slice(v + 1, src.indexOf(';\n', v) + 1)
}

const HELPERS: [string, string][] = [
  ['Clients.gs', 'clientNameKey_'], ['Main.gs', 'hubAddrKey_'], ['Main.gs', 'hubClientIdentity_'], ['Talent.gs', 'str_'],
  ['Locations.gs', 'LOCATION_DOC_MAX_BYTES'], ['Locations.gs', 'LOCATION_OFFICE_TO_GOOGLE'], ['Locations.gs', 'locationsDocBytes_'],
  ['ComplianceDocs.gs', 'CERT_DOC_TYPES'], ['ComplianceDocs.gs', 'complianceDocsTypeOk_'], ['ComplianceDocs.gs', 'complianceDocsTypeByName_'],
  ['ComplianceDocs.gs', 'complianceDocsTypeLoose_'], ['ComplianceDocs.gs', 'complianceDocsShownType_'],
]

/* ---------- the stores ---------- */

type Row = Record<string, unknown>
type DriveFile = { name: string; mime: string; bytes: number[]; text?: string }
type Folder = { name: string; files?: string[]; folders?: Folder[] }

function freshStores() {
  return {
    master: true,
    fail: {} as Record<string, boolean>,
    clients: [
      { client_key: KENNY, name: 'Kenny Marsh', status: 'active', medications: ['never in an answer'] },
      { client_key: 'lia_gomez', name: 'Lia Gomez', status: 'active' },
      { client_key: TAVI, name: 'Tavi Corvenly', status: 'active' },
    ] as Row[],
    passes: [
      { id: 'emar_2', source_row: 'emar:2', client: 'Kenny Marsh', medication: 'Sucralfate Tab 1gm', status: 'Pass',
        date: '2025-06-10', schedule: '8:00 PM', administeredBy: 'asatech', src_dosage: '1gm', src_medtype: 'Pill', src_prn: 'Daily' },
      { id: 'emar_3', source_row: 'emar:3', client: 'Kenny Marsh', medication: 'Sucralfate Tab 1gm', status: 'Cancel',
        date: '2025-11-06 10:17', schedule: '8:00 AM', administeredBy: 'Ann Lee', src_withheld_type: 'At Workshop' },
      { id: 'emar_4', source_row: 'emar:4', client: 'Lia Gomez', medication: 'Aspirin', status: 'Pass', date: '13/06/2025, 09:00:00' },
      { id: 'emar_5', source_row: 'emar:5', client: 'kenny  marsh', medication: 'Tylenol', status: 'Pass', date: '2025-07-08 08:00',
        src_prn: 'PRN', src_prn_reason: 'Pain', src_bloodpressure: '120/80' },
      { id: 'emar_6', source_row: 'emar:6', client: 'Kenny Marsh', medication: 'Metoprolol', status: 'Breakdown',
        date: '2025-07-13 21:00', src_withheld_type: 'Stopped due to critical measure' },
      { id: 'emar_7', source_row: 'emar:7', client: 'Kenny Marsh', medication: 'Folic acid', status: 'Discontinued', date: '12:00:00 AM' },
      { id: 'emar_8', source_row: 'emar:8', client: 'Lia Gomez', medication: 'X', status: 'Pass', date: '2025-08-14 08:00' },
    ] as Row[],
    files: [
      { id: 'CDOC_aug', client_key: KENNY, client_name: 'Kenny Marsh', doc_kind: 'mar', title: 'MARS_2026 August_Kenny Marsh.pdf',
        file_date: '2026-08-01', drive_id: 'fileAug000001', kind: 'pdf', mime_type: 'application/pdf', size_bytes: '5007089',
        folder: 'MARS', digest_state: 'done', digest_text: 'MEDICATION ADMINISTRATION RECORD August 2026', digest_text_chars: '6181',
        text_file: 'textAug000001', createdAt: '2026-09-09T12:00:00Z' },
      { id: 'CDOC_jul', client_key: KENNY, client_name: 'Kenny Marsh', doc_kind: 'mar', title: 'MARS_2026 July_Kenny Marsh.jpg',
        file_date: '2026-07-01', drive_id: 'fileJul000001', kind: 'jpeg', mime_type: 'image/jpeg', digest_state: 'pending' },
      { id: 'CDOC_lia', client_key: 'lia_gomez', client_name: 'Lia Gomez', doc_kind: 'mar', title: 'MARS_2026 August_Lia Gomez.pdf',
        file_date: '2026-08-01', drive_id: 'fileLia000001' },
      { id: 'CDOC_isp', client_key: KENNY, client_name: 'Kenny Marsh', doc_kind: 'isp', title: 'ISP 2026', drive_id: 'fileIsp000001' },
    ] as Row[],
    errors: [
      { id: 'e1', client_key: KENNY, client_name: 'Kenny Marsh', error_date: '6/22/2026', medication: 'Cilostazol Tab 100MG',
        flags: 'Circled, Initialed, Explained, Missed', problem: 'NI NE', time: '8p', staff: 'Nurse' },
      { id: 'e2', client_key: 'km', client_name: 'Kenny Marsh', error_date: '5/3', year: '2026', medication: 'Aspirin',
        flags: 'Circled, (I) Wrong Day' },
      { id: 'e3', client_key: 'lia_gomez', client_name: 'Lia Gomez', error_date: '6/30/2026', flags: 'Controlled' },
      { id: 'e4', client_key: 'tc', client_name: 'TC', error_date: '1/9/2023', medication: 'Med A', flags: 'Missed, Controlled' },
      { id: 'e5', client_key: '', client_name: 'tc', error_date: '8/17/2024', medication: 'Med B', flags: 'Initialed' },
    ] as Row[],
    drive: {
      fileAug000001: { name: 'MARS_2026 August_Kenny Marsh.pdf', mime: 'application/pdf', bytes: PDF },
      fileJul000001: { name: 'MARS_2026 July_Kenny Marsh.jpg', mime: 'image/jpeg', bytes: JPG },
      fileLia000001: { name: 'MARS_2026 August_Lia Gomez.pdf', mime: 'application/pdf', bytes: PDF },
      textAug000001: { name: 'ocr.txt', mime: 'text/plain', bytes: [], text: 'PAGE 1 — Sucralfate 8 PM initials' },
      newSep0000001: { name: 'MARS_2026 September_Kenny Marsh.pdf', mime: 'application/pdf', bytes: PDF },
      newOct0000001: { name: 'MARS_2026 October_Kenny Marsh.pdf', mime: 'application/pdf', bytes: PDF },
    } as Record<string, DriveFile>,
    root: {
      name: 'Clients', folders: [
        { name: 'Kenny Marsh', files: ['newSep0000001'], folders: [{ name: 'MARS', files: ['fileAug000001', 'newOct0000001'] }] },
        { name: 'Lia Gomez', folders: [{ name: 'MARS', files: ['fileLia000001'] }] },
        { name: 'Templates', folders: [{ name: 'MARS', files: ['newSep0000001'] }] },
      ],
    } as Folder,
  }
}

let S = freshStores()

const iter = <T,>(items: T[]) => {
  let i = 0
  return { hasNext: () => i < items.length, next: () => items[i++] }
}

function driveFile(id: string) {
  const f = S.drive[id]
  if (!f) throw new Error(`File not found: ${id}`)
  return {
    getId: () => id, isTrashed: () => false, getName: () => f.name, getMimeType: () => f.mime, getSize: () => f.bytes.length,
    getLastUpdated: () => new Date('2026-09-20T12:00:00Z'),
    getBlob: () => ({ getBytes: () => f.bytes, getDataAsString: () => f.text ?? '' }),
    getAs: () => ({ getBytes: () => PDF }),
  }
}

function folderOf(f: Folder): unknown {
  return {
    getId: () => f.name, getName: () => f.name,
    getFolders: () => iter((f.folders ?? []).map(folderOf)),
    getFiles: () => iter((f.files ?? []).map(driveFile)),
  }
}

function formatDate(date: Date, tz: string, pattern: string): string {
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(date)
  if (pattern === 'yyyy-MM-dd') {
    return `${part({ year: 'numeric' })}-${part({ month: '2-digit' }).padStart(2, '0')}-${part({ day: '2-digit' }).padStart(2, '0')}`
  }
  if (pattern === 'HH:mm') return part({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  throw new Error(`formatDate pattern ${pattern} is not stood in for`)
}

/* ---------- Apps Script, booted ---------- */

type Gs = Record<string, unknown> & {
  HUB_POLICY: Record<string, { file: string; lane: string }>
  HUB_ACTIONS: Record<string, (payload: unknown, user: unknown) => { status: number; data?: unknown; message?: string }>
  CSM_ACTIONS: string[]
}

function boot(): Gs {
  const g: Record<string, unknown> = {
    console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, isNaN, Error,
    HUB_POLICY: {}, HUB_ACTIONS: {},
    Utilities: { formatDate, base64Encode: (b: number[]) => Buffer.from(b).toString('base64') },
    DriveApp: { getFileById: driveFile, getFolderById: () => folderOf(S.root) },
    hubIsRealMaster_: (u: Row | null) => !!u && u.email === 'boss@example.org' && !u.visiting_member && !u.is_service,
    hubProp_: () => '',
    cacheRead_: (_scope: string, _name: string, fn: () => unknown) => fn(),
    cacheScope_: (t: string) => t,
    cacheVersion_: () => 1,
    cacheBump_: () => {},
    clientsDerived_: () => S.clients,
    listRows_: (r: string) => {
      if (S.fail[r]) throw new Error(`${r} is closed`)
      return r === 'marEntries' ? S.passes : r === 'clientFiles' ? S.files : r === 'marErrors' ? S.errors : []
    },
  }
  const ctx = vm.createContext(g)
  vm.runInContext(HELPERS.map(([file, name]) => lift(file, name)).join('\n'), ctx)
  vm.runInContext(gsText('ClientSourceMar.gs'), ctx)
  bootClientFiles(ctx)
  return ctx as unknown as Gs
}

const GS = boot()
const MASTER = { email: 'boss@example.org', role: 'admin' }
const OTHER = { email: 'admin@example.org', role: 'admin' }

const calls: { action: string; payload: Row }[] = []
const realFetch = globalThis.fetch

before(() => {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : ''
    const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload: Row }
    calls.push({ action: env.action, payload: env.payload ?? {} })
    const door = GS.HUB_ACTIONS[env.action]
    const out = door ? door(JSON.parse(JSON.stringify(env.payload ?? {})), S.master ? MASTER : OTHER)
      : { status: 404, message: 'Unknown action.' }
    return new Response(JSON.stringify(out))
  }) as typeof fetch
})
after(() => { globalThis.fetch = realFetch })
beforeEach(() => {
  S = freshStores()
  calls.length = 0
  forgetLocationReads()
})

const source = (p: string) => readFileSync(resolve(ROOT, 'src/pages/features/clientprofiles/sources', p), 'utf8')
const SOURCES = ['mar.ts', 'MarTab.tsx']

describe('the names and the lane', () => {
  it('every door the tab names is a ClientSourceMar.gs action; the drive scan is no longer one the tab asks', () => {
    const named = new Set<string>()
    for (const f of SOURCES) {
      for (const m of source(f).matchAll(/gasAction(?:<[^>]*>)?\(\s*'([A-Za-z]+)'/g)) named.add(m[1])
    }
    for (const name of named) {
      assert.equal(GS.HUB_POLICY[name]?.file, 'ClientSourceMar.gs', `${name} is declared in ClientSourceMar.gs`)
      assert.equal(typeof GS.HUB_ACTIONS[name], 'function', `${name} has a handler`)
    }
    // the MARS lane finds a new paper in the drive by itself, so no screen asks the dry-run scan any more
    assert.deepEqual([...named].sort(), [...GS.CSM_ACTIONS].filter((a: string) => a !== 'clientSourceMarImportScan').sort())
    assert.deepEqual(Object.values(MAR_ACTIONS).sort(), [...named].sort())
    const catalogue = readFileSync(resolve(ROOT, 'src/lib/actions.generated.ts'), 'utf8')
    for (const name of named) assert.ok(catalogue.includes(`"${name}"`), `${name} is in the generated catalogue`)
  })

  it('clinical rows never become a slice: no snapshot resource, no dataSource, no slice read, no generic list', () => {
    const snapshot = JSON.parse(readFileSync(resolve(ROOT, 'public/snapshot-manifest.json'), 'utf8')) as { resources: { resource: string }[] }
    assert.ok(snapshot.resources.length > 0)
    assert.deepEqual(snapshot.resources.filter((r) => /^clientSource|^csm/i.test(r.resource)).map((r) => r.resource), [])
    for (const f of SOURCES) {
      const text = source(f)
      assert.doesNotMatch(text, /resource:\s*['"]/, f)
      assert.doesNotMatch(text, /readSlice|api\.list|api\.get\(/, f)
    }
  })

  it('the administration record and a MARS paper are never kept as a relay receipt; the scan keeps its retry', () => {
    const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
    const line = /^RELAY_NO_RECEIPT_ACTIONS = frozenset\(\{([^}]*)\}\)/m.exec(relay)?.[1] ?? ''
    assert.ok(line.includes('"clientSourceMarDocFile"'), line)
    assert.ok(line.includes('"clientSourceMar"'), line)
    assert.ok(!line.includes('"clientSourceMarImportScan"'), 'the dry-run scan keeps its one receipt re-POST')
  })
})

describe('the read, as the tab reads it', () => {
  it('passes: joined by the folded name, newest first; the swapped day read back; the status words and the reason', async () => {
    const a = marOf(await readMar(KENNY))
    assert.deepEqual(calls.map((c) => [c.action, c.payload]), [['clientSourceMar', { client: KENNY }]])
    assert.equal(a.client.name, 'Kenny Marsh')
    const rows = a.passes.rows
    assert.deepEqual(rows.map((r) => r.id), ['emar_6', 'emar_5', 'emar_3', 'emar_2', 'emar_7'])
    const by = Object.fromEntries(rows.map((r) => [r.id, r]))
    assert.deepEqual([by.emar_3.date, by.emar_3.dateFixed, by.emar_3.dateAsWritten], ['2025-06-11', true, '2025-11-06 10:17'])
    assert.deepEqual([by.emar_5.date, by.emar_5.dateFixed], ['2025-07-08', false])
    assert.deepEqual([by.emar_3.status, by.emar_3.reason], ['Not given', 'At Workshop'])
    assert.deepEqual([by.emar_2.status, by.emar_2.givenBy, by.emar_2.signedAs], ['Recorded', 'System account (eMAR pilot)', 'asatech'])
    assert.deepEqual([by.emar_6.status, by.emar_6.reason], ['Breakdown', 'Stopped due to critical measure'])
    assert.deepEqual([by.emar_5.prn, by.emar_5.prnReason, by.emar_5.bloodPressure], [true, 'Pain', '120/80'])
    assert.deepEqual([by.emar_7.date, by.emar_7.time, by.emar_7.status], ['', '00:00', 'Discontinued'])
    assert.equal(dateCell('passes', by.emar_3), 'Jun 11, 2025 · 10:17 AM')
    assert.equal(dateCell('passes', by.emar_7), 'No day · 12:00 AM')
    assert.deepEqual(a.passes.statuses, ['Recorded', 'Not given', 'Discontinued', 'Breakdown'])
    assert.deepEqual(kpiCards('passes', a.passes), [
      { label: 'Passes', value: '5' }, { label: 'Recorded', value: '2' }, { label: 'Not given', value: '1' },
      { label: 'Last pass', value: 'Jul 13, 2025' }])
    assert.equal(a.passes.asOf, '2025-08-14')
    assert.match(asOfLine('passes', a.passes), /^As of Aug 14, 2025 — the newest pass the eMAR log holds.*1 day read back day-first/)
    assert.deepEqual(filterMarRows(rows, 'workshop', '').map((r) => r.id), ['emar_3'])
    assert.deepEqual(filterMarRows(rows, '', 'Recorded').map((r) => r.id), ['emar_5', 'emar_2'])
    assert.equal(statusTone('Not given'), 'danger')
  })

  it('papers: the client\'s MARS rows newest first, Latest and Earlier, the month words; no digest in the list', async () => {
    const raw = await readMar(KENNY)
    assert.ok(!/MEDICATION ADMINISTRATION RECORD|textAug000001|never in an answer/.test(JSON.stringify(raw)))
    const a = marOf(raw)
    assert.deepEqual(a.papers.rows.map((r) => [r.id, r.status, r.fileId]), [
      ['CDOC_aug', 'Latest', 'fileAug000001'], ['CDOC_jul', 'Earlier', 'fileJul000001']])
    assert.equal(dateCell('papers', a.papers.rows[0]), 'August 2026')
    assert.match(a.papers.rows[0].details, /August 2026 · PDF · 4\.8 MB · Folder: MARS · OCR read/)
    assert.deepEqual([a.papers.rows[0].hasText, a.papers.rows[1].hasText], [true, false])
    assert.deepEqual(kpiCards('papers', a.papers), [
      { label: 'Papers on file', value: '2' }, { label: 'Months covered', value: '2' }, { label: 'Newest paper', value: 'August 2026' }])
    assert.equal(asOfLine('papers', a.papers),
      'The newest MARS paper on the platform is August 2026; the client folders were last indexed on Sep 9, 2026.')
  })

  it('errors: by key, or by the name when the key is only initials; the audit\'s day; the problem flag is the status', async () => {
    const a = marOf(await readMar(KENNY))
    assert.deepEqual(a.errors.rows.map((r) => [r.id, r.date, r.status, r.kinds.join()]), [
      ['e1', '2026-06-22', 'Missed', 'Missed'], ['e2', '2026-05-03', 'Wrong day', 'Wrong day']])
    assert.deepEqual(a.errors.rows[0].marks, ['Circled', 'Initialed', 'Explained'])
    assert.deepEqual(kpiCards('errors', a.errors).map((k) => k.value), ['2', '1', '1', 'Jun 22, 2026'])
    assert.equal(asOfLine('errors', a.errors), 'As of Jun 30, 2026 — the newest error the audit holds.')
  })

  it('a source that cannot be read answers its tab with why — no cards, no zeros — and the others still answer', async () => {
    S.fail.marErrors = true
    const a = marOf(await readMar(KENNY))
    assert.match(a.errors.why, /the MAR errors audit could not be read/)
    assert.equal(a.errors.kpis, null)
    assert.deepEqual(kpiCards('errors', a.errors), [])
    assert.equal(asOfLine('errors', a.errors), '')
    assert.equal(a.passes.rows.length, 5)
    assert.equal(a.degraded, true)
    const html = draw(<MarBody state={ready(a)} view="errors" onView={noop} onAsk={noop} onRetry={noop} />)
    assert.ok(html.includes('data-empty="missing"') && html.includes('the MAR errors audit could not be read'))
    assert.ok(!html.includes('data-kpis'))
  })

  it('outside the master\'s own session the door is unknown, and the tab says the read is not published', async () => {
    S.master = false
    await assert.rejects(readMar(KENNY), /Unknown action/)
    assert.equal(readRefusal('Unknown action.'), NOT_PUBLISHED)
    S.master = true
    await assert.rejects(readMar('nobody'), /No client "nobody"/)
  })
})

describe('the pass-time column', () => {
  const more: Row[] = [
    { id: 'emar_9', source_row: 'emar:9', client: 'Kenny Marsh', medication: 'Tylenol', status: 'Pass', date: '2025-03-09 15:32',
      schedule: '2025-03-09 15:32', src_prn: 'PRN', src_prn_reason: 'Pain', src_prn_pass_time: '03/09/2025, 15:32:00' },
    { id: 'emar_10', source_row: 'emar:10', client: 'Kenny Marsh', medication: 'Sucralfate Tab 1gm', status: 'Pass',
      date: '2025-09-20 08:00', schedule: '20/09/2025, 08:05:00' },
    { id: 'emar_11', source_row: 'emar:11', client: 'Kenny Marsh', medication: 'Metoprolol', status: 'Pass', date: '12:00:00 AM',
      schedule: '29/09/2025, 18:14:21' },
  ]
  const panel = (a: MarAnswer, id: string) =>
    draw(<MarPanel client={KENNY} answer={a} ask={{ kind: 'pass', id }} onClose={noop} />)

  it('a date-time there is never "Due": a swapped ISO copy and a dd/mm stamp are read against the settled day', async () => {
    S.passes.push(...more)
    const a = marOf(await readMar(KENNY))
    const by = Object.fromEntries(a.passes.rows.map((r) => [r.id, r]))
    assert.deepEqual([by.emar_9.date, by.emar_9.dateFixed, by.emar_9.schedule, by.emar_9.passTime, by.emar_9.prnTime],
      ['2025-09-03', true, '', '', ''])
    assert.doesNotMatch(by.emar_9.details, /Due|2025-03-09/)
    assert.equal(dateCell('passes', by.emar_9), 'Sep 3, 2025 · 3:32 PM')
    assert.deepEqual([by.emar_10.schedule, by.emar_10.passTime], ['', 'Sep 20, 2025 · 8:05 AM'])
    assert.match(by.emar_10.details, /^Pass time Sep 20, 2025 · 8:05 AM/)
    assert.deepEqual([by.emar_3.schedule, by.emar_3.passTime], ['8:00 AM', ''])
    assert.match(by.emar_3.details, /^Due 8:00 AM/)
    const swapped = panel(a, 'emar_9')
    assert.ok(!swapped.includes('>Due</dt>') && !swapped.includes('2025-03-09 15:32<') && swapped.includes('Sep 3, 2025'))
    const stamped = panel(a, 'emar_10')
    assert.ok(stamped.includes('>Pass time</dt>') && stamped.includes('Sep 20, 2025 · 8:05 AM') && !stamped.includes('>Due</dt>'))
    assert.ok(panel(a, 'emar_3').includes('>Due</dt>'))
  })

  it('a date cell with only a time takes its day and clock from the pass-time column, flagged and counted', async () => {
    S.passes.push(...more)
    const a = marOf(await readMar(KENNY))
    const row = a.passes.rows.find((r) => r.id === 'emar_11')
    assert.ok(row)
    assert.deepEqual([row.date, row.time, row.dateFrom, row.passTime, row.dateAsWritten],
      ['2025-09-29', '18:14', 'pass time', '', '12:00:00 AM'])
    assert.equal(dateCell('passes', row), 'Sep 29, 2025 · 6:14 PM')
    assert.deepEqual([a.passes.kpis?.days_from_pass_time, a.passes.kpis?.no_day], [1, 1])
    assert.equal(a.passes.asOf, '2025-09-29')
    assert.match(asOfLine('passes', a.passes), /1 day taken from the eMAR's pass-time column, where the date cell holds only a time\./)
    const html = panel(a, 'emar_11')
    assert.ok(html.includes('pass time column') && html.includes('29/09/2025, 18:14:21') && html.includes('6:14 PM'))
    assert.ok(!html.includes('the eMAR recorded only a time'))
    assert.ok(panel(a, 'emar_7').includes('No day — the eMAR row holds only a time'))
  })
})

describe('rows the audit files only under initials', () => {
  it('"tc" and "TC" rows are the one roster client whose initials are TC: marked, counted apart and said so', async () => {
    const a = marOf(await readMar(TAVI))
    assert.deepEqual(a.errors.rows.map((r) => [r.id, r.matchedBy, r.filedAs]), [['e5', 'initials', 'TC'], ['e4', 'initials', 'TC']])
    assert.deepEqual([a.errors.kpis?.by_initials, a.errors.kpis?.initials_held, a.errors.initials], [2, 0, 'TC'])
    assert.match(a.errors.rows[1].details, /^Filed as TC/)
    assert.equal(asOfLine('errors', a.errors), 'As of Jun 30, 2026 — the newest error the audit holds. 2 rows filed only ' +
      'under the initials TC are counted here: no other client, and nobody else the records name, has those initials.')
    assert.deepEqual(kpiCards('errors', a.errors).map((k) => k.value), ['2', '1', '0', 'Aug 17, 2024'])
    const kenny = marOf(await readMar(KENNY))
    assert.deepEqual(kenny.errors.rows.map((r) => [r.id, r.matchedBy]), [['e1', 'key'], ['e2', 'name']])
    const html = draw(<MarPanel client={TAVI} answer={a} ask={{ kind: 'error', id: 'e4' }} onClose={noop} />)
    assert.ok(html.includes('data-filed-as="TC"') && html.includes('only under the initials TC'))
    noModal(html, 'initials')
  })

  it('the status filter finds an error by any kind it names, not only its first', async () => {
    const a = marOf(await readMar(TAVI))
    assert.ok(a.errors.statuses.includes('Controlled'))
    assert.deepEqual(a.errors.rows.find((r) => r.id === 'e4')?.status, 'Missed')
    assert.deepEqual(filterMarRows(a.errors.rows, '', 'Controlled').map((r) => r.id), ['e4'])
    assert.deepEqual(filterMarRows(a.errors.rows, '', 'Missed').map((r) => r.id), ['e4'])
  })

  it('initials somebody else also has are held back, and the empty table says how many and why', async () => {
    S.files.push({ id: 'CDOC_tina', client_key: '', client_name: 'Tina Cole', doc_kind: 'isp', drive_id: 'fileTina00001' })
    const a = marOf(await readMar(TAVI))
    assert.deepEqual([a.errors.rows.length, a.errors.kpis?.by_initials, a.errors.kpis?.initials_held], [0, 0, 2])
    const line = emptyLine('errors', a.errors)
    assert.equal(line, 'The MAR errors audit names no error by this client\'s key or name; 2 rows filed only under the ' +
      'initials TC are not attributed here: another client, or a person the records name in full, has the same initials.')
    assert.notEqual(line, EMPTY_LINE.errors)
    const html = draw(<MarBody state={ready(a)} view="errors" onView={noop} onAsk={noop} onRetry={noop} />)
    assert.ok(html.includes('2 rows filed only under the initials TC are not attributed here'))
    S.fail.clientFiles = true
    const blind = marOf(await readMar(TAVI))
    assert.match(blind.papers.why, /the MARS papers index could not be read/)
    assert.deepEqual([blind.errors.rows.length, blind.errors.kpis?.initials_held], [0, 2])
    assert.match(blind.errors.initialsWhy, /could not be read, so nobody else can be ruled out/)
  })
})

describe('the paper door', () => {
  it('the client\'s own paper arrives as bytes the tab can draw, with its OCR digest; the whole text on asking', async () => {
    const got = await readMarDoc(KENNY, 'fileAug000001')
    assert.equal(docShapeOf(got.mime), 'pdf')
    assert.ok(blobOf(got))
    assert.deepEqual(digestOf(got.digest), { text: 'MEDICATION ADMINISTRATION RECORD August 2026', state: 'done', chars: 6181, hasText: true })
    const pic = await readMarDoc(KENNY, 'fileJul000001')
    assert.equal(docShapeOf(pic.mime), 'image')
    const text = textOf(await readMarText(KENNY, 'fileAug000001'))
    assert.deepEqual(text, { text: 'PAGE 1 — Sucralfate 8 PM initials', chars: 33, truncated: false, readAt: '' })
    assert.deepEqual(calls.at(-1)?.payload, { client: KENNY, file_id: 'fileAug000001', part: 'text' })
  })

  it('another client\'s paper, a non-MARS file and a paper with no text are refused', async () => {
    await assert.rejects(readMarDoc(KENNY, 'fileLia000001'), /no such MARS paper/)
    await assert.rejects(readMarDoc(KENNY, 'fileIsp000001'), /no such MARS paper/)
    await assert.rejects(readMarText(KENNY, 'fileJul000001'), /No OCR text is on file/)
  })

  it('a paper opens in the platform\'s centred viewer as a blob URL, let go on close; its digest comes back for the panel', async () => {
    const realRevoke = URL.revokeObjectURL
    const revoked: string[] = []
    URL.revokeObjectURL = (u: string) => { revoked.push(u); realRevoke.call(URL, u) }
    const paper = { fileId: 'fileAug000001', title: 'MAR August 2026.pdf', record: 'MAR August 2026' }
    try {
      const h = mountHook(() => usePaperOpener(KENNY), {})
      h.run(() => h.current.open(paper))
      await h.settle(() => !!h.current.digests.fileAug000001 && h.current.opening === '')
      const shown = useFileViewerStore.getState().file
      assert.equal(shown?.title, 'MAR August 2026.pdf')
      assert.match(shown?.url ?? '', /^blob:/)
      assert.equal(h.current.digests.fileAug000001.text, 'MEDICATION ADMINISTRATION RECORD August 2026')
      useFileViewerStore.getState().closeFile()
      assert.deepEqual(revoked, [shown?.url])
      h.run(() => h.current.open({ fileId: 'fileLia000001', title: 'x', record: 'x' }))
      await h.settle(() => h.current.opening === '')
      assert.equal(useFileViewerStore.getState().file, null, 'another client\'s paper is refused and nothing opens')
      h.unmount()
    } finally {
      URL.revokeObjectURL = realRevoke
      useFileViewerStore.getState().closeFile()
    }
  })
})

describe('the kept reading', () => {
  it('the as-of line says the folders are checked by themselves once the lane has listed them', async () => {
    const a = marOf(await readMar(KENNY))
    const swept = { ...a.papers, sweptAt: '2026-10-18T14:05:00Z' }
    assert.equal(asOfLine('papers', swept), 'The newest MARS paper on the platform is August 2026; the client folders ' +
      'are checked for new papers by themselves, last on Oct 18, 2026 at 10:05 AM.')
  })

  it('a paper still owed its reading says where it stands, and nothing is asked of the door', () => {
    const answer = marOf({ client: { client_key: KENNY, name: 'Kenny Marsh' }, tabs: { papers: { rows: [] }, passes: {}, errors: {} } })
    const base = { id: 'MARS_x', record: 'MARS_2026 August_Kenny Marsh.pdf', date: '2026-08-01', time: '', details: '',
      status: 'Latest', fileId: 'fileNew0000001', title: 'MARS_2026 August_Kenny Marsh.pdf', month: '2026-08', kind: 'PDF',
      mime: 'application/pdf', sizeBytes: 1, folder: 'active', modifiedTime: '', indexedAt: '2026-10-18', digestState: '',
      hasText: false, textChars: 0, ocrState: '', ocrError: '', ocrNextTryAt: '', ocrReadAt: '' } satisfies PaperRow
    const panel = (row: PaperRow) => draw(<MarPanel client={KENNY} answer={{ ...answer, papers: { ...answer.papers, rows: [row] } }}
      ask={{ kind: 'paper', id: row.id }} onClose={noop} />)
    const before = calls.length
    const pending = panel({ ...base, ocrState: 'pending' })
    assert.ok(pending.includes('data-full-text="pending"') && pending.includes('This paper is being read'))
    const failed = panel({ ...base, ocrState: 'failed', ocrError: 'the reading saw no words on the paper',
      ocrNextTryAt: '2026-10-18T15:00:00Z' })
    assert.ok(failed.includes('data-full-text="failed"') && failed.includes('saw no words on the paper'))
    assert.ok(failed.includes('tried again by') && failed.includes('Oct 18, 2026 at 11:00 AM'))
    const read = panel({ ...base, hasText: true, ocrState: 'read', ocrReadAt: '2026-10-18T14:00:00Z' })
    assert.ok(read.includes('Opening the OCR text') && read.includes('OCR read on') && !read.includes('Read the whole OCR text'))
    assert.equal(calls.length, before, 'a panel drawn on the server asks nothing')
  })
})

describe('the screen', () => {
  let answer: MarAnswer
  beforeEach(async () => { answer = marOf(await readMar(KENNY)) })

  it('papers: the cards, the as-of line and the one table, no drive check to ask; nothing is a dialog', () => {
    const html = draw(<MarBody state={ready(answer)} view="papers" onView={noop} onAsk={noop} onRetry={noop} />)
    for (const head of ['Record', 'Date', 'Details', 'Status', 'Action']) assert.ok(html.includes(`>${head}</th>`), head)
    assert.ok(html.includes('All statuses') && !html.includes('Check the drive') && !html.includes('data-scan'))
    assert.ok(html.includes('data-kpi="Papers on file"') && html.includes('data-as-of'))
    assert.ok(html.includes('data-status="Latest"') && html.includes('data-status="Earlier"'))
    assert.ok(html.includes('aria-selected="true" data-view="papers"'))
    noModal(html, 'papers')
  })

  it('passes and errors draw their own rows and pills', () => {
    const passes = draw(<MarBody state={ready(answer)} view="passes" onView={noop} onAsk={noop} onRetry={noop} />)
    assert.ok(passes.includes('data-row="emar_3"') && passes.includes('data-status="Not given"'))
    assert.ok(passes.includes('Jun 11, 2025 · 10:17 AM'))
    const errors = draw(<MarBody state={ready(answer)} view="errors" onView={noop} onAsk={noop} onRetry={noop} />)
    assert.ok(errors.includes('data-row="e1"') && errors.includes('data-status="Missed"') && errors.includes('data-status="Wrong day"'))
  })

  it('a pass and an error are drawn behind their medication\'s photo, else the pill tile; a paper is a document, with none', () => {
    const rowHtml = (html: string, id: string) => {
      const at = html.indexOf(`data-row="${id}"`)
      assert.notEqual(at, -1, `row ${id} is drawn`)
      return html.slice(at, html.indexOf('</tr>', at))
    }
    const passes = draw(<MarBody state={ready(answer)} view="passes" onView={noop} onAsk={noop} onRetry={noop} />)
    const known = rowHtml(passes, 'emar_3')
    assert.ok(known.includes('data-med-photo="photo"') && known.includes('src="med-images/sucralfate-tab-1gm.png"'), known)
    assert.ok(known.includes('loading="lazy"') && known.includes('width:32px;height:32px') && known.includes('>Sucralfate Tab 1gm</button>'))
    const unknown = rowHtml(passes, 'emar_6')
    assert.ok(unknown.includes('data-med-photo="pill"') && unknown.includes('lucide-pill') && !unknown.includes('<img'), unknown)
    const errors = draw(<MarBody state={ready(answer)} view="errors" onView={noop} onAsk={noop} onRetry={noop} />)
    assert.ok(rowHtml(errors, 'e1').includes('data-med-photo="pill"'))
    assert.ok(rowHtml(errors, 'e2').includes('src="med-images/aspirin-low-chew-81mg.png"'))
    const papers = draw(<MarBody state={ready(answer)} view="papers" onView={noop} onAsk={noop} onRetry={noop} />)
    assert.ok(papers.includes('data-row="CDOC_aug"') && !papers.includes('data-med-photo'))
    const pass = draw(<MarPanel client={KENNY} answer={answer} ask={{ kind: 'pass', id: 'emar_3' }} onClose={noop} />)
    const heading = pass.slice(pass.indexOf('<h2'), pass.indexOf('</h2>'))
    assert.ok(heading.includes('src="med-images/sucralfate-tab-1gm.png"') && heading.includes('loading="eager"'), heading)
    assert.ok(heading.includes('width:56px;height:56px') && heading.includes('>Sucralfate Tab 1gm<'))
    const error = draw(<MarPanel client={KENNY} answer={answer} ask={{ kind: 'error', id: 'e1' }} onClose={noop} />)
    assert.ok(error.slice(error.indexOf('<h2'), error.indexOf('</h2>')).includes('data-med-photo="pill"'))
    const paper = draw(<MarPanel client={KENNY} answer={answer} ask={{ kind: 'paper', id: 'CDOC_aug' }} onClose={noop} />)
    assert.ok(paper.includes('data-paper-panel="CDOC_aug"') && !paper.includes('data-med-photo'))
  })

  it('a long log is drawn a page at a time', () => {
    const many = { ...answer, passes: { ...answer.passes, rows: Array.from({ length: PAGE + 10 }, (_, i) => ({ ...answer.passes.rows[0], id: `p${i}` })) } }
    const html = draw(<MarBody state={ready(many)} view="passes" onView={noop} onAsk={noop} onRetry={noop} />)
    assert.equal((html.match(/data-row="/g) ?? []).length, PAGE)
    assert.ok(html.includes('Show 10 more of 10'))
  })

  it('reading and failing say so', () => {
    const loading = draw(<MarBody state={{ status: 'loading', data: null, error: '', refreshing: false }} view="papers" onView={noop} onAsk={noop} onRetry={noop} />)
    assert.ok(loading.includes('Reading the administration record'))
    const failed = draw(<MarBody state={{ status: 'failed', data: null, error: 'Unknown action.', refreshing: false }} view="papers" onView={noop} onAsk={noop} onRetry={noop} />)
    assert.ok(failed.includes(NOT_PUBLISHED.replace(/'/g, '&#x27;')))
  })

  it('every detail is the right panel — a pass, an error and a paper — never a dialog', () => {
    const pass = draw(<MarPanel client={KENNY} answer={answer} ask={{ kind: 'pass', id: 'emar_3' }} onClose={noop} />)
    assert.ok(pass.includes('aria-label="Administration"') && pass.includes('data-pass-panel="emar_3"'))
    assert.ok(pass.includes('data-date-note') && pass.includes('At Workshop'))
    noModal(pass, 'pass')
    const error = draw(<MarPanel client={KENNY} answer={answer} ask={{ kind: 'error', id: 'e1' }} onClose={noop} />)
    assert.ok(error.includes('data-error-panel="e1"') && error.includes('Circled · Initialed · Explained · Missed'))
    noModal(error, 'error')
    const opener = { opening: '', digests: {}, open: noop }
    const paper = draw(<MarPanel client={KENNY} answer={answer} ask={{ kind: 'paper', id: 'CDOC_aug' }} onClose={noop}
      papers={opener} />)
    assert.ok(paper.includes('data-paper-panel="CDOC_aug"') && paper.includes('View the paper'))
    // the text opens with the panel: no button to ask it, no digest waiting on the paper being viewed
    assert.ok(paper.includes('data-full-text="idle"') && paper.includes('Opening the OCR text'))
    assert.ok(!paper.includes('Read the whole OCR text') && !paper.includes('data-digest'))
    assert.ok(!paper.includes('<iframe'), 'the paper itself is never framed in the panel')
    assert.ok(paper.includes('sm:w-[384px]') && !paper.includes('xl:w-['), 'the standard width')
    noModal(paper, 'paper')
    const table = draw(<MarBody state={ready(answer)} view="papers" onView={noop} onAsk={noop} onRetry={noop} onPaper={noop} />)
    assert.ok(table.includes('data-view-paper="CDOC_aug"') && table.includes('data-details="CDOC_aug"'))
    const gone = draw(<MarPanel client={KENNY} answer={answer} ask={{ kind: 'pass', id: 'nope' }} onClose={noop} />)
    assert.ok(gone.includes('no longer listed'))
    assert.equal(draw(<MarPanel client={KENNY} answer={answer} ask={null} onClose={noop} />), '')
  })

  it('the tab holds its answer the way every section does: one read per client, drawn again from the hold', async () => {
    const key = readKey(MAR_ACTIONS.read, KENNY)
    const before = calls.length
    const a = mountHook(() => useLocationRead(key, () => readMar(KENNY), marOf), {})
    await a.settle(() => a.current.status === 'ready')
    const b = mountHook(() => useLocationRead(key, () => readMar(KENNY), marOf), {})
    await b.settle(() => b.current.status === 'ready')
    assert.equal(calls.slice(before).filter((c) => c.action === 'clientSourceMar').length, 1)
    assert.equal(b.current.data?.passes.rows.length, 5)
    a.unmount()
    b.unmount()
  })
})
