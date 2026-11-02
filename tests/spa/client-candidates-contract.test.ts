/**
 * CLIENT CANDIDATES · the contract between the page and its doors. Every call the page makes is caught at `fetch` —
 * the potentialClients slice, the relay's pack (answered by ClientCandidates.gs's own clientCandidatePack, as the
 * relay's service identity runs it), each Apps Script door and the two presses — and handed to Apps Script's own
 * ClientCandidates.gs (with Locations.gs, ClientProfiles.gs and SsaProfiles.gs, whose helpers it leans on), run here on
 * in-memory stores; the answer comes back as JSON and is read by the page's own readers and drawn by its own sections.
 * A name, a parameter, a part or a field that one side renames breaks here, not on the screen.
 *
 * The app ships master-only: no App Control row, mounted only through CUSTOM_PAGES. Nothing in it is a dialog.
 */
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import vm from 'node:vm'
import { bootClientFiles } from './client-files-index'
import { createElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { badgeAllowsApp, useBadgeAccessStore } from '@/lib/badgeAccess'
import { isAllowedWith } from '@/lib/appAccess'
import { PREFETCH_GAP_MS, forgetPack } from '@/lib/appPack'
import { INTAKE_STAGES, funnelColumnOf } from '@/lib/intakeStages'
import { analyseReferrals, boardStage } from '@/lib/referralAnalysis'
import { forgetSnapshot } from '@/lib/snapshotClient'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { appManifests } from '@/registry/apps'
import { clientCandidatesManifests } from '@/registry/apps-client-candidates'
import { potentialClientsFunnelPage, potentialClientsPipelinePage } from '@/registry/apps-potclients'
import AppRoutePage, { CUSTOM_PAGES } from '@/pages/AppRoutePage'
import { blobOf, docShapeOf } from '@/pages/features/myprofile/certDocFile'
import { textsOf, transcriptsOf } from '@/pages/features/staffprofiles/staffModel'
import ClientCandidatesPage, { CandidatesScreen } from '@/pages/features/clientcandidates/ClientCandidatesPage'
import CandidatePanel from '@/pages/features/clientcandidates/CandidatePanel'
import { ActionsMenu } from '@/pages/features/clientcandidates/CandidateActions'
import { SwitcherList } from '@/pages/features/clientcandidates/CandidateSwitcher'
import { OverviewView } from '@/pages/features/clientcandidates/sections/Overview'
import { ActionsView } from '@/pages/features/clientcandidates/sections/Actions'
import { PIPELINE_PAGE, PipelineView } from '@/pages/features/clientcandidates/sections/Pipeline'
import { InformationView } from '@/pages/features/clientcandidates/sections/Information'
import { IntakeView } from '@/pages/features/clientcandidates/sections/Intake'
import { DocumentsView } from '@/pages/features/clientcandidates/sections/Documents'
import { ActivityView } from '@/pages/features/clientcandidates/sections/Activity'
import { TextsView } from '@/pages/features/clientcandidates/sections/Texts'
import { TranscriptsView } from '@/pages/features/clientcandidates/sections/Transcripts'
import {
  CANDIDATES_PATH, NOT_PUBLISHED, STAGES, actionsOf, activityOf, alertsOf, candidateQuery, defaultCandidate, docFileAsk,
  docOpens, documentsOf, doorOf, inIntake, intakeId, intakeOf, isWriteAsk, knownDetails, latestNotes, overviewOf, panelOf, panelParam,
  pipelineNext, pipelineRows, readRefusal, rosterFrom, rosterOf, sharePayloadFor, stageCounts, stageMeta, standingRead,
  switcherCandidates, type CandidateAsk, type RosterRow,
} from '@/pages/features/clientcandidates/candidateModel'
import { OPEN_CANDIDATE_ACTION, withCandidateLink } from '@/pages/features/clientcandidates/candidateLink'
import {
  candidateWrote, fileCandidateDoc, forgetCandidateReads, readActions, readActivity, readDocFile, readDocRender, readDocuments,
  readIntake, readKey, readOverview, readRoster, readTexts, readTranscript, readTranscripts, reportOpened, useCandidateRead,
  writeCandidate, type ReadState,
} from '@/pages/features/clientcandidates/useCandidateRead'
import { PACK_KEY_RE } from '@/pages/features/clientcandidates/candidateReads'
import { mountHook } from './react-host'
import { SHELL_SHOWN, primeShellHides } from '@/lib/myWorkHides'

// the parts Settings › My Work can hide are drawn as the master's own session sees them
primeShellHides(SHELL_SHOWN)

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const FEATURE = 'src/pages/features/clientcandidates'
const KEY = 'LEAD_2310'
const NOW = '2026-09-28T15:00:00Z'
const SOURCE_AT = '2026-09-28T14:00:00.000Z'
const PDF = [0x25, 0x50, 0x44, 0x46]
const noop = () => {}
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(createElement(MemoryRouter, null, node)))
const ready = <T>(data: T): ReadState<T> => ({ status: 'ready', data, error: '', refreshing: false })
const noModal = (html: string, what: string) => {
  assert.ok(!html.includes('aria-modal'), `${what}: no aria-modal`)
  assert.ok(!html.includes('role="dialog"') && !html.includes('role="alertdialog"'), `${what}: no dialog role`)
}

const gsText = (file: string) => readFileSync(resolve(ROOT, 'apps-script', file), 'utf8')

/** One top-level function or var of a .gs file, exactly as written there (its first line too). */
function lift(file: string, name: string): string {
  const src = `\n${gsText(file)}`
  const fn = src.indexOf(`\nfunction ${name}(`)
  if (fn !== -1) return src.slice(fn + 1, src.indexOf('\n}', fn + 1) + 2)
  const v = src.indexOf(`\nvar ${name} =`)
  assert.notEqual(v, -1, `${file} has no ${name}`)
  return src.slice(v + 1, src.indexOf(';\n', v) + 1)
}

const HELPERS: [string, string][] = [
  ['Clients.gs', 'clientNameKey_'], ['HubCore.gs', 'hubCellSafe_'], ['Talent.gs', 'str_'], ['Talent.gs', 'hashCode_'],
  ['Talent.gs', 'SHARED_LINE_DIGITS'], ['SheetDb.gs', 'HUB_TAB_HOME'], ['SheetDb.gs', 'HUB_TAB_BORN_HOME'],
  ['Main.gs', 'hubAddrKey_'], ['Main.gs', 'hubClientIdentity_'], ['Estate.gs', 'estateKey_'], ['Estate.gs', 'estateCell_'],
  ['ComplianceDocs.gs', 'CERT_DOC_TYPES'], ['ComplianceDocs.gs', 'CERT_DOC_TYPE_WORDS'],
  ['ComplianceDocs.gs', 'complianceDocsTypeOk_'], ['ComplianceDocs.gs', 'complianceDocsTypeByName_'],
  ['ComplianceDocs.gs', 'complianceDocsTypeLoose_'], ['ComplianceDocs.gs', 'complianceDocsSameType_'],
  ['ComplianceDocs.gs', 'complianceDocsFileType_'], ['ComplianceDocs.gs', 'complianceDocsShownType_'],
  ['StaffProfiles.gs', 'SP_TEXT_PAGE'], ['StaffProfiles.gs', 'spDay_'], ['StaffProfiles.gs', 'spDigits10_'],
  ['StaffProfiles.gs', 'spNumbers_'], ['StaffProfiles.gs', 'spOwnPhones_'], ['StaffProfiles.gs', 'spReadColumns_'],
  ['OptOut.gs', 'optOutKey_'], ['Scraper.gs', 'scraperAlertKey_'], ['CommMock.gs', 'COMM_MOCK_HOUSE'],
]

/* ---------- the stores ---------- */

type Row = Record<string, unknown>
type DriveFile = { name: string; mime: string; bytes: number[] }

function freshStores() {
  return {
    // the potentialClients tab as the scraper and the Potential Clients app write it; the slice is the same rows
    leads: [
      { id: 'LEAD_2310', referral_id: 2310, client_name: 'Ava Stone', client_age: '34', client_gender: 'F',
        diagnosis: 'Autism; DOB: 01/02/1990', frequency: '24/7', description: 'Homemaker/Personal Care 24/7',
        postal_code: 44708, phone: '+1 (330) 555-0142', email: 'ava.family@example.org', funding_source: '2',
        expiration_date: '12/31/27', ai_rating: '9', ai_notes: 'Strong fit: round-the-clock care near Canton.', sms_sent: 'true',
        source: '', scraped_at: '2026-09-20 14:00:00.000000+00', stage: 'new', owner: '', next_step: '',
        notes: 'Sep 20, 2026 — first look', updatedAt: '2026-09-21T10:00:00.000Z' },
      { id: 'LEAD_2301', referral_id: 2301, client_name: 'Ben Carter', client_age: '51', client_gender: 'M', diagnosis: '',
        frequency: '20 hours/week', description: 'Supported living', postal_code: '44720', phone: '3305550150', email: '',
        funding_source: '1', expiration_date: '2026-08-01', ai_rating: '7', ai_notes: '', sms_sent: 'false', source: '',
        scraped_at: '2026-07-02 09:00:00+00', stage: 'assessment', owner: 'Jo Intake', next_step: 'Visit with the family Friday',
        notes: '' },
      { id: 'LEAD_2300', referral_id: 2300, client_name: 'Cara Diaz', description: 'Residential', postal_code: '44614',
        phone: '', email: '', ai_rating: '8', sms_sent: 'true', source: 'Potential_Clients / Data', scraped_at: '',
        stage: 'converted', owner: 'Jo Intake', next_step: '', expiration_date: '', notes: '' },
      { id: 'LEAD_2299', referral_id: 2299, client_name: 'Dee Evans', description: '', postal_code: '', phone: '', email: '',
        ai_rating: '', sms_sent: '', source: '', scraped_at: '2026-06-01 09:00:00+00', stage: '', owner: '', next_step: '',
        expiration_date: '08/01/26', notes: '' },
      { id: 'LEAD_988', referral_id: 988, client_name: 'Eli Ford', description: 'Day services', postal_code: '44646',
        phone: '3305550188', email: '', ai_rating: '5', sms_sent: 'false', source: '', scraped_at: '2026-05-01 09:00:00+00',
        stage: 'lost', owner: '', next_step: '', expiration_date: '', notes: '' },
    ] as Row[],
    clients: [{ client_key: 'caradiaz', id: 'CLI_caradiaz', name: 'Cara Diaz', house: 'NW4045', status: 'active' }] as Row[],
    files: {
      ispcara00001: { name: 'Cara Diaz ISP 2026.pdf', mime: 'application/pdf', bytes: PDF },
      foreign00001: { name: 'Other.pdf', mime: 'application/pdf', bytes: PDF },
    } as Record<string, DriveFile>,
    events: {
      LEAD_2310: [{ type: 'potentialClients.update', actor: 'Boss (visiting Dee)', at: '2026-09-22T10:00:00Z', payload: {} }],
    } as Record<string, Row[]>,
    // the outbox the lead alerts leave through (CommMock.gs), one row per number
    outbox: [
      ['id', 'at', 'pass_id', 'result', 'held_by', 'to_masked', 'body', 'ledger_key'],
      ['p1#1', '2026-09-20T15:00:00.000Z', 'p1', 'sent', '', '+1 (330) ***-0101', 'Referral 2310 rated 9: round-the-clock care',
        'scraper_lead:LEAD_2310:3305550101'],
      ['p1#2', '2026-09-20T15:00:01.000Z', 'p1', 'sent', '', '+1 (330) ***-0102', 'Referral 2310 rated 9: round-the-clock care',
        'scraper_lead:LEAD_2310:3305550102'],
    ] as unknown[][],
    optOut: {} as Record<string, Row>,
    rendered: [] as string[],
    filed: [] as { folder: string; name: string; mime: string }[],
    slicesServed: true,
    packOpen: true,
  }
}

let S = freshStores()

function formatDate(date: Date, tz: string, pattern: string): string {
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(date)
  if (pattern === 'yyyy-MM-dd') {
    return `${part({ year: 'numeric' })}-${part({ month: '2-digit' }).padStart(2, '0')}-${part({ day: '2-digit' }).padStart(2, '0')}`
  }
  if (pattern === 'HH:mm') return part({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  throw new Error(`formatDate pattern ${pattern} is not stood in for`)
}

/** A sheet as spReadColumns_ reads it. */
function sheetOf(grid: unknown[][]) {
  return {
    getLastRow: () => grid.length,
    getLastColumn: () => (grid[0] ?? []).length,
    getRange: (r: number, c: number, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => grid[r - 1 + i]?.[c - 1 + j] ?? '')),
    }),
  }
}

/* ---------- Apps Script, booted ---------- */

type Answer = { status: number; data?: unknown; message?: string }
type Gs = Record<string, unknown> & {
  HUB_POLICY: Record<string, { file: string; lane: string; params?: Record<string, unknown> }>
  HUB_ACTIONS: Record<string, (payload: unknown, user: unknown) => Answer>
  CC_ACTIONS: string[]
  CC_WRITE_ACTIONS: string[]
  CC_PACK_PARTS: string[]
  CC_STAGES: { id: string; label: string; description: string }[]
}

const LINES: Record<string, { name: string; e164: string; shared: boolean; humans: number; owner: string }> = {
  '3305550100': { name: 'Main line', e164: '+13305550100', shared: false, humans: 1, owner: 'Ann Lee' },
}

function boot(): Gs {
  let uuid = 0
  const g: Record<string, unknown> = {
    console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, isNaN, isFinite, parseInt, Error,
    HUB_POLICY: {}, HUB_ACTIONS: {}, CLIENTS_DERIVED_MEMO_: null,
    Utilities: {
      formatDate, getUuid: () => `u${++uuid}`,
      base64Encode: (b: number[]) => Buffer.from(b).toString('base64'),
      base64Decode: (s: string) => [...Buffer.from(s, 'base64')],
      newBlob: (bytes: unknown, mime: string, name: string) => ({ bytes, mime, name }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    DriveApp: {
      getFileById: (id: string) => {
        const f = S.files[id]
        if (!f) throw new Error(`File not found: ${id}`)
        return {
          isTrashed: () => false, getName: () => f.name, getMimeType: () => f.mime, getSize: () => f.bytes.length,
          getBlob: () => ({ getBytes: () => f.bytes }), getAs: () => ({ getBytes: () => PDF }),
        }
      },
    },
    hubIsRealMaster_: (u: Row | null) => !!u && u.email === 'boss@example.org' && !u.visiting_member && !u.is_service,
    // App Control as ViewerScope.gs answers it: the real master always; anyone else by the scope a case releases to
    hubProfileAppGate_: (app: string, u: Row | null) => {
      if ((g.hubIsRealMaster_ as (x: Row | null) => boolean)(u)) return { open: true, scope: { kind: 'master' } }
      const kind = (app === 'client-candidates' && u && !u.visiting_member && !u.is_service && RELEASED[String(u.email)]) || 'none'
      return { open: kind !== 'none', scope: { kind } }
    },
    hubQuietNow_: () => new Date(NOW),
    hubProp_: () => '',
    hubId_: () => 'masterdata01',
    cacheRead_: (_scope: string, _name: string, fn: () => unknown) => fn(),
    cacheScopeSheet_: (id: string, tab: string) => `${id}:${tab}`,
    cacheScope_: (t: string) => t,
    cacheVersion_: () => 1,
    cacheBump_: () => {},
    ssOpen_: () => ({ getSheetByName: () => null, getSpreadsheetTimeZone: () => 'America/New_York' }),
    clientsDerived_: () => S.clients.map((c) => ({ ...c })),
    clientPhotoIndex_: () => ({}),
    listRows_: (r: string) => (r === 'potentialClients' ? JSON.parse(JSON.stringify(S.leads)) : []),
    // the generic row verbs on the in-memory tab (SheetDb.gs): a JSON cell comes back as its text
    requireRow_: (r: string, id: string) => {
      const hit = S.leads.find((x) => x.id === id)
      return r === 'potentialClients' && hit ? JSON.parse(JSON.stringify(hit))
        : { error: { status: 404, message: `No "${r}" record with id "${id}".` } }
    },
    updateRowById_: (r: string, patch: Row) => {
      const at = S.leads.findIndex((x) => x.id === patch.id)
      if (r !== 'potentialClients' || at === -1) return { error: { status: 404, message: 'No such row.' } }
      const cells = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v && typeof v === 'object' ? JSON.stringify(v) : v]))
      S.leads[at] = { ...S.leads[at], ...cells, updatedAt: NOW }
      return { ...S.leads[at] }
    },
    ispDocIndex_: () => ({ files: [{ id: 'ispcara00001', name: 'Cara Diaz ISP 2026.pdf' }] }),
    ispDocFor_: (name: string) => (name === 'Cara Diaz'
      ? { id: 'ispcara00001', name: 'Cara Diaz ISP 2026.pdf', url: '' } : { id: '', name: '', url: '' }),
    optOutIndex_: () => ({ by: S.optOut, error: '' }),
    spEventsFor_: (key: string) => JSON.parse(JSON.stringify(S.events[key] ?? [])),
    spContacts_: (ctx: { people: { phone: string; phones?: string[] } }) => ({
      phones: [ctx.people.phone, ...(ctx.people.phones ?? [])].filter(Boolean).map((value) => ({ label: 'Phone', value })), emails: [],
    }),
    spTextsFacts_: () => ({
      counterparts: [{ id: '3305550100', label: 'Main line', owner: 'Ann Lee', count: 1, first_at: '2026-09-21T12:00:00Z', last_at: '2026-09-21T12:00:00Z' }],
      messages: [{ id: 'M1', at: '2026-09-21T12:00:00Z', dir: 'in', body: 'Can we talk about the visit?', by: '', line: '3305550100' }],
      coverage: { from: '2026-09-01', to: '2026-09-28', gaps: [] }, phones_matched: 1, why: '', degraded: false,
    }),
    spTranscriptsBuild_: () => ({
      calls: [{ call_id: 'AC1', at: '2026-09-22T14:00:00Z', secs: 180, direction: 'incoming', line: 'Main line', turns: 12,
        kind: 'call', categories: ['Intake'] }],
      categories: [{ name: 'Intake', count: 1 }], gaps: [], why: '', degraded: false,
    }),
    hubLineOurs_: (d: string) => !!LINES[d],
    hubLineRow_: (id: string) => LINES[id] ?? null,
    hubTabSheet_: (t: string) => (t === 'comm_mock' ? sheetOf(S.outbox) : null),
    sheetDbGateHolds_: () => null,
    sheetDbRefused_: (res: unknown) => {
      const e = res && typeof res === 'object' ? (res as { error?: { status?: number } }).error : undefined
      return e && e.status ? e : null
    },
    hubSysLog_: () => true,
  }
  const ctx = vm.createContext(g)
  vm.runInContext(HELPERS.map(([file, name]) => lift(file, name)).join('\n'), ctx)
  vm.runInContext(gsText('Locations.gs'), ctx)
  vm.runInContext(gsText('ClientProfiles.gs'), ctx)
  vm.runInContext(gsText('SsaProfiles.gs'), ctx)
  vm.runInContext(gsText('ClientCandidates.gs'), ctx)
  bootClientFiles(ctx)
  const gs = ctx as unknown as Gs
  gs.HUB_ACTIONS.commCallsTranscript = (payload: unknown) => ({
    status: 200,
    data: { call_id: (payload as Row).call_id, at: '2026-09-22T14:00:00Z', line: 'Main line', direction: 'incoming', duration_sec: 180,
      full_transcript: 'We would like to talk about the intake. DOB: 01/02/1990', speaker_transcript: '', has_words: true },
  })
  // Drive's HTML-to-PDF conversion and the platform folder stood in: what the door hands them is kept to be read
  gs.ccPdf_ = (html: string) => { S.rendered.push(html); return PDF }
  gs.ccFolder_ = (key: string) => ({
    createFile: (blob: { mime: string; name: string }) => {
      S.filed.push({ folder: key, name: blob.name, mime: blob.mime })
      return { getId: () => `filed${String(S.filed.length).padStart(7, '0')}` }
    },
  })
  return gs
}

const GS = boot()
const MASTER = { email: 'boss@example.org', role: 'admin', display_name: 'Boss' }
const DIRECTOR = { email: 'dee@example.org', role: 'admin', display_name: 'Dee Rector' }
const SERVICE = { email: 'relay@example.org', role: 'admin', is_service: true }
let SESSION: Row = MASTER
/** e-mail → the scope App Control releases client-candidates to (all, client, guardian, ssa); none by default. */
const RELEASED: Record<string, string> = {}

/** A door's answer as the platform's envelope carries it. */
function door(action: string, payload: Row, user: Row = SESSION): Answer {
  const fn = GS.HUB_ACTIONS[action]
  return fn ? JSON.parse(JSON.stringify(fn(JSON.parse(JSON.stringify(payload)), user))) : { status: 404, message: 'Unknown action.' }
}

/** The generic potentialClients verbs the Potential Clients app uses (SheetDb.gs), on the in-memory tab. */
function resourceCall(action: string, payload: Row): Answer {
  const id = String(payload.id ?? '')
  const at = S.leads.findIndex((r) => r.id === id)
  if (action === 'list') return { status: 200, data: JSON.parse(JSON.stringify(S.leads)) }
  if (at === -1) return { status: 404, message: `No "potentialClients" record with id "${id}".` }
  if (action === 'get') return { status: 200, data: { ...S.leads[at] } }
  if (action === 'update') {
    S.leads[at] = { ...S.leads[at], ...payload, updatedAt: NOW }
    return { status: 200, data: { ...S.leads[at] } }
  }
  return { status: 400, message: `No ${action} here.` }
}

/* ---------- the page's calls, answered by the slice, the relay's pack and the doors ---------- */

let seen: { kind: 'slice' | 'pack' | 'gas' | 'resource'; name: string; payload?: Row; url?: string }[] = []
const realFetch = globalThis.fetch
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

before(() => {
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('/snapshot/')) {
      const name = url.slice('/snapshot/'.length).replace(/\.json$/, '')
      seen.push({ kind: 'slice', name })
      const slices: Record<string, Row[]> = S.slicesServed ? { potentialClients: S.leads } : {}
      if (name === 'index') return json({ slices: Object.fromEntries(Object.keys(slices).map((k) => [k, { built_at: SOURCE_AT }])) })
      const rows = slices[name]
      return rows ? json({ resource: name, built_at: SOURCE_AT, source_at: SOURCE_AT, rows }) : new Response('no', { status: 404 })
    }
    if (url.startsWith('/erp-lanes/app-pack/')) {
      const app = decodeURIComponent(url.slice('/erp-lanes/app-pack/'.length).split('?')[0])
      const key = decodeURIComponent(new Headers(init?.headers).get('X-App-Pack-Key') ?? '')
      seen.push({ kind: 'pack', name: `${app}:${key}`, url })
      if (!S.packOpen || app !== 'client-candidates') return json({ status: 404, reason: 'unknown' }, 404)
      // the relay's door is the master's alone; the pack itself is gathered by the service identity
      if (SESSION !== MASTER) return json({ status: 403, message: 'Not here.' }, 403)
      const got = door('clientCandidatePack', { candidate: key }, SERVICE)
      return json(got.status === 200 ? { status: 200, data: { ...(got.data as Row), read_age_s: 1 } } : got)
    }
    if (url.includes('/notify')) return json({ ok: true })
    const body = typeof init?.body === 'string' ? init.body : ''
    const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action?: string; resource?: string; payload: Row }
    if (env.resource === 'potentialClients') {
      seen.push({ kind: 'resource', name: String(env.action), payload: env.payload ?? {} })
      return json(resourceCall(String(env.action), env.payload ?? {}))
    }
    if (!env.action) return json({ status: 200, data: {} })
    seen.push({ kind: 'gas', name: env.action, payload: env.payload ?? {} })
    if (env.action === 'leadOpened') {
      const ids = (env.payload?.ids as string[]) ?? []
      return json({ status: 200, data: { results: ids.map((id) => {
        const r = S.leads.find((x) => x.id === id)
        if (!r) return { id, error: true }
        if (String(r.sms_sent) !== 'true' || r.stage !== 'new') return { id, stage: r.stage, unchanged: true }
        r.stage = 'read'
        return { id, stage: 'read' }
      }) } })
    }
    return json(door(env.action, env.payload ?? {}))
  }) as typeof fetch
})
after(() => { globalThis.fetch = realFetch })
beforeEach(() => {
  S = freshStores()
  SESSION = MASTER
  seen = []
  forgetSnapshot()
  forgetPack()
  forgetCandidateReads()
  useMemberStore.setState({ currentMemberId: '' } as never)
  useAuthStore.setState({ user: { id: 'u-boss', name: 'Boss', email: 'boss@example.org', role: 'admin', types: [], isMaster: true } } as never)
})
afterEach(async () => {
  // a neighbour's prefetch waits for an idle moment: let it drop, and its turn end, before the next case
  await new Promise((r) => setTimeout(r, 100))
  forgetPack()
  await new Promise((r) => setTimeout(r, PREFETCH_GAP_MS + 400))
})

const gasCalls = () => seen.filter((s) => s.kind === 'gas').map((s) => s.name)
const packAsks = () => seen.filter((s) => s.kind === 'pack').map((s) => s.name)
const resourceWrites = () => seen.filter((s) => s.kind === 'resource' && s.name === 'update').map((s) => s.payload)
const logOf = (key: string): { at: string; by: string; kind: string; text: string }[] => {
  const cell = S.leads.find((r) => r.id === key)?.candidate_log
  return typeof cell === 'string' ? JSON.parse(cell) : []
}

function walk(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n)
    return statSync(resolve(ROOT, p)).isDirectory() ? walk(p) : [p]
  })
}

const RELAY_NO_RECEIPT = (): Set<string> => {
  const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
  const line = /^RELAY_NO_RECEIPT_ACTIONS = frozenset\(\{([\s\S]*?)\}\)/m.exec(relay)?.[1] ?? ''
  return new Set([...line.matchAll(/"(\w+)"/g)].map((m) => m[1]))
}

const rowOf = async (key: string): Promise<RosterRow> => {
  const r = rosterOf(await readRoster(false)).candidates.find((c) => c.key === key)
  assert.ok(r, `${key} is on the roster`)
  return r
}

/* ---------- the app ---------- */

describe('the app', () => {
  it('is "Client Candidates", id client-candidates, one page "profile" on the houses slice, for admins and managers, next to Clients', () => {
    const app = clientCandidatesManifests[0]
    assert.deepEqual([app.id, app.name, app.icon, app.accent, app.category, app.isNew, app.enabled],
      ['client-candidates', 'Client Candidates', 'user-round-plus', 'peach', 'Care', true, true])
    assert.equal(app.tagline, 'One referral at a time — intake with the family, documents and every conversation')
    assert.deepEqual(app.audience, ['admin', 'manager'])
    assert.deepEqual(app.pages.map((p) => [p.id, p.title, (p as { dataSource?: { resource?: string } }).dataSource?.resource]),
      [['profile', 'Candidate', 'houses']])
    assert.equal(appManifests.filter((m) => m.id === 'client-candidates').length, 1)
    const ids = appManifests.map((m) => m.id)
    assert.equal(ids.indexOf('client-candidates'), ids.indexOf('client-profiles') - 1, 'registered next to Clients')
  })

  it('is mounted only through CUSTOM_PAGES, never on a static route', async () => {
    // a lazy chunk (lib/lazyPage): the entry resolves to the screen itself
    assert.equal(await CUSTOM_PAGES['client-candidates/profile'].load(), ClientCandidatesPage)
    assert.ok(!readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8').includes('client-candidates'), 'no static route in App.tsx')
  })

  it('ships no App Control row: a non-master admin is refused, the master passes — here and on every Potential Clients link', async () => {
    // the screen's chunk is in before the render, so the master's render draws it rather than a fallback
    await CUSTOM_PAGES['client-candidates/profile'].load()
    const director = { id: 'u-dir', name: 'Dee Rector', email: 'dee@example.org', role: 'admin', types: ['DIRECTOR'], isMaster: false }
    const master = { id: 'u-boss', name: 'Boss', email: 'boss@example.org', role: 'admin', types: [], isMaster: true }
    assert.equal(badgeAllowsApp('client-candidates', director as never, {}), false)
    assert.equal(badgeAllowsApp('client-candidates', master as never, {}), true)
    const hits: string[] = []
    for (const dir of ['apps-script', 'tools', 'server']) {
      for (const name of readdirSync(resolve(ROOT, dir))) {
        if (!/\.(gs|py|mjs|js|json)$/.test(name)) continue
        const text = readFileSync(join(resolve(ROOT, dir), name), 'utf8')
        if (/app_badge_access[^\n]{0,200}['"]client-candidates['"]|['"]client-candidates['"][^\n]{0,200}app_badge_access/.test(text)) hits.push(name)
      }
    }
    assert.deepEqual(hits, [])

    useRegistryStore.setState({ apps: appManifests })
    useBadgeAccessStore.setState({ rules: {}, tenantRules: {}, configRules: {} } as never)
    const open = () => flat(renderToString(createElement(MemoryRouter, { initialEntries: [`/app/client-candidates/profile?candidate=${KEY}`] },
      createElement(Routes, null, createElement(Route, { path: '/app/:appId/:pageId', element: createElement(AppRoutePage) })))))
    useAuthStore.setState({ user: director } as never)
    assert.equal(isAllowedWith(appManifests, 'admin', 'client-candidates'), false)
    assert.ok(!open().includes('data-client-candidates'), 'a director sees nothing of it')
    useAuthStore.setState({ user: master } as never)
    assert.equal(isAllowedWith(appManifests, 'admin', 'client-candidates'), true)
    assert.ok(open().includes('data-client-candidates'), 'the master gets the screen')

    // every Potential Clients surface asks the same gate, and opens the referral here
    const src = (f: string) => readFileSync(resolve(ROOT, 'src/pages/features/potclients', f), 'utf8')
    const link = readFileSync(resolve(ROOT, FEATURE, 'candidateLink.ts'), 'utf8')
    assert.match(link, /isAllowedWith\(apps, effRole, CANDIDATES_APP_ID\)/)
    assert.match(src('PotentialClientUniquePage.tsx'), /\{clientCandidates && \(\s*<Link to=\{candidateHref\(String\(rec\.id\)\)\}/)
    assert.match(src('PotentialClientsPage.tsx'), /candidatesOpen \? withCandidateLink\(base\) : base/)
    assert.match(src('PotentialClientsFunnelPage.tsx'), /candidatesOpen \? withCandidateLink\(potentialClientsFunnelPage\)/)
    assert.match(src('PotentialClientsComparePage.tsx'), /\{candidatesOpen && id && \(\s*<Link to=\{candidateHref\(id\)\}/)
    for (const f of ['PotentialClientUniquePage.tsx', 'PotentialClientsPage.tsx', 'PotentialClientsFunnelPage.tsx', 'PotentialClientsComparePage.tsx']) {
      assert.match(src(f), /useCandidatesOpen\(\)/, `${f} asks the gate`)
    }
    assert.equal(`${CANDIDATES_PATH}${candidateQuery(KEY, 'overview')}`, `/app/client-candidates/profile?candidate=${KEY}`)
  })

  it('released in App Control, a reader who is not the master reads every section and is shown no write — the presses stay the master\'s', async () => {
    const row = await rowOf(KEY)
    const o = overviewOf(await readOverview(KEY))
    const a = actionsOf(await readActions('LEAD_2301'))
    const d = documentsOf(await readDocuments(KEY))

    // the server: every read answers the release, both presses and the pack stay the master's
    const gs = readFileSync(resolve(ROOT, 'apps-script/ClientCandidates.gs'), 'utf8')
    assert.match(gs, /var CC_APP_ID = 'client-candidates';/)
    assert.match(gs, /function clientCandidatesGate_\(user\) \{[^}]*hubProfileAppGate_\(CC_APP_ID, user\)[\s\S]*?return kind === 'master' \|\| kind === 'all';\n\}/)
    for (const w of ['clientCandidateWrite', 'clientCandidateFile']) {
      assert.match(gs, new RegExp(`HUB_ACTIONS\\.${w} = function \\(payload, user\\) \\{\\n  if \\(!clientCandidatesMaster_\\(user\\)\\)`), w)
    }

    // the screen: a released director gets it
    await CUSTOM_PAGES['client-candidates/profile'].load()
    const director = { id: 'u-dir', name: 'Dee Rector', email: 'dee@example.org', role: 'admin', types: ['DIRECTOR'], isMaster: false }
    const released = { 'client-candidates': ['DIRECTOR'] }
    assert.equal(badgeAllowsApp('client-candidates', director as never, released), true)
    useRegistryStore.setState({ apps: appManifests })
    useBadgeAccessStore.setState({ rules: released, tenantRules: {}, configRules: {} } as never)
    useAuthStore.setState({ user: director } as never)
    try {
      assert.equal(isAllowedWith(appManifests, 'admin', 'client-candidates'), true)
      const screen = flat(renderToString(createElement(MemoryRouter, { initialEntries: [`/app/client-candidates/profile?candidate=${KEY}`] },
        createElement(Routes, null, createElement(Route, { path: '/app/:appId/:pageId', element: createElement(AppRoutePage) })))))
      assert.ok(screen.includes('data-client-candidates'), 'the released director gets the screen')
    } finally {
      useBadgeAccessStore.setState({ rules: {}, tenantRules: {}, configRules: {} } as never)
    }
    const page = readFileSync(resolve(ROOT, FEATURE, 'ClientCandidatesPage.tsx'), 'utf8')
    assert.match(page, /const canWrite = useEffectiveIsMaster\(\)/, 'the writes follow the master flag, never lent to a visit')
    assert.equal((page.match(/canWrite=\{canWrite\}/g) ?? []).length, 6, 'the screen, the panel, the menu, Overview, Actions and Documents')

    // every surface a press starts from, drawn for a reader the writes are not open to
    const overview = draw(createElement(OverviewView, { row, overview: ready(o), actions: ready(a), onRetry: noop, onAsk: noop, onTab: noop }))
    assert.ok(overview.includes('Quick actions') && overview.includes('data-quick="pipeline"'), 'View all candidates stays')
    assert.ok(!overview.includes('data-quick="note"') && !overview.includes('data-quick="stage"'), 'no Add note, no Update stage')
    const actions = draw(createElement(ActionsView, { name: 'Ben Carter', actions: ready(a), query: '', onQuery: noop, onAsk: noop, onRetry: noop }))
    assert.ok(actions.includes('>Next step<') && actions.includes('Visit with the family Friday'), 'the table is read')
    assert.ok(!/data-row-action=|Mark complete|Reopen|Add note|>Buttons</.test(actions), 'no press on any row')
    const docs = draw(createElement(DocumentsView, { row, docs: ready(d), doc: { opening: '', open: noop, render: noop }, onAsk: noop, onRetry: noop }))
    assert.ok(docs.includes('Consent &amp; contact preferences') && docs.includes('data-open-doc="referral"'), 'the papers are read and open')
    assert.ok(!docs.includes('data-file-doc') && !docs.includes('File…'), 'no paper is filed')
    const menu = draw(createElement(ActionsMenu, { candidate: KEY, details: { email: row.email, phone: row.phone, client_key: '' },
      onPick: noop, onTab: noop, onDone: noop }))
    assert.ok(menu.includes('Contact') && menu.includes('Navigation') && menu.includes('Open in Potential Clients'))
    assert.ok(!/Candidate actions|Add note|Update stage|data-action="(note|stage)"/.test(menu), 'the menu holds no press')
    const share = sharePayloadFor(row, 'overview')
    const writes: CandidateAsk[] = [{ kind: 'note', about: '' }, { kind: 'stage' }, { kind: 'complete', item: 'referral_review' },
      { kind: 'reopen', item: 'referral_review' }, { kind: 'file-assessment' }, { kind: 'consent' }]
    for (const ask of writes) {
      assert.equal(isWriteAsk(ask), true, ask.kind)
      const html = draw(createElement(CandidatePanel, { ask, row, share, onClose: noop }))
      assert.ok(html.includes('data-read="not-open"') && html.includes('This part is not open to you.'), `${ask.kind}: not open`)
      assert.ok(!/data-stage-select|Apply note|>Apply|type="file"/.test(html), `${ask.kind}: no form`)
    }
    for (const ask of [{ kind: 'share' }, { kind: 'transcript', id: 'AC1' }] as CandidateAsk[]) {
      assert.equal(isWriteAsk(ask), false, ask.kind)
      assert.ok(!draw(createElement(CandidatePanel, { ask, row, share, onClose: noop })).includes('data-read="not-open"'), ask.kind)
    }
  })

  it('the pipeline rows and drawer and the Funnel cards gain "Open in Client Candidates" — a navigate, never a write', () => {
    assert.deepEqual(OPEN_CANDIDATE_ACTION, { id: 'client-candidates', label: 'Open in Client Candidates', icon: 'user-round-plus',
      kind: 'navigate', href: '/app/client-candidates/profile?candidate={row.id}' })
    const pipe = withCandidateLink(potentialClientsPipelinePage).config as { rowActions: unknown[]; detailPanel: { footer: unknown[] } }
    assert.deepEqual(pipe.rowActions.at(-1), OPEN_CANDIDATE_ACTION)
    assert.deepEqual(pipe.detailPanel.footer.at(-1), OPEN_CANDIDATE_ACTION)
    const before = potentialClientsPipelinePage.config as { rowActions: unknown[]; detailPanel: { footer: unknown[] } }
    assert.equal(pipe.rowActions.length, before.rowActions.length + 1, 'the page keeps every action it had')
    assert.equal(pipe.detailPanel.footer.length, before.detailPanel.footer.length + 1)
    const funnel = withCandidateLink(potentialClientsFunnelPage).config as { rowActions: unknown[]; detailPanel?: unknown }
    assert.deepEqual(funnel.rowActions, [OPEN_CANDIDATE_ACTION])
    assert.equal(funnel.detailPanel, undefined)
  })
})

/* ---------- the names ---------- */

describe('the names', () => {
  it('every door the page names is a ClientCandidates.gs action (or the Potential Clients leadOpened), and each is in the catalogue', () => {
    const named = new Set<string>()
    for (const f of walk(FEATURE)) {
      for (const m of readFileSync(resolve(ROOT, f), 'utf8').matchAll(/gasAction(?:<[^>]*>)?\(\s*'([A-Za-z]+)'/g)) named.add(m[1])
    }
    // an edition's panel read and its edits are Python's alone (app/doors.json); the editions asked of the editions door
    const py: Record<string, { file: string }> = JSON.parse(readFileSync(resolve(ROOT, 'app/doors.json'), 'utf8'))
    const pyCandidates = [...named].filter((n) => n.startsWith('clientCandidate') && py[n]).sort()
    assert.deepEqual(pyCandidates, ['clientCandidateDocEdit', 'clientCandidateEdit', 'clientCandidateEditRead', 'clientCandidateNoteEdit'])
    for (const n of pyCandidates) {
      assert.equal(py[n].file, 'app/client_candidate_writes.py', `${n} is the writes module's`)
      assert.ok(!GS.HUB_POLICY[n] && typeof GS.HUB_ACTIONS[n] !== 'function', `${n} has no Apps Script declaration nor handler`)
    }
    assert.ok(named.has('editionsMine'), 'the editions this viewer makes, asked of the editions door')
    const own = [...named].filter((n) => n !== 'leadOpened' && n !== 'editionsMine' && !pyCandidates.includes(n))
    for (const name of own) {
      assert.equal(GS.HUB_POLICY[name]?.file, 'ClientCandidates.gs', `${name} is declared in ClientCandidates.gs`)
      assert.equal(typeof GS.HUB_ACTIONS[name], 'function', `${name} has a handler`)
    }
    assert.deepEqual(own.sort(), [...GS.CC_ACTIONS, ...GS.CC_WRITE_ACTIONS].sort())
    assert.ok(named.has('leadOpened'), 'opening an alerted referral is Potential Clients\' own acknowledgement')
    const catalogue = readFileSync(resolve(ROOT, 'src/lib/actions.generated.ts'), 'utf8')
    for (const name of named) assert.ok(catalogue.includes(`"${name}"`), `${name} is in the generated catalogue`)
    const invalidates = readFileSync(resolve(ROOT, 'src/lib/invalidates.generated.ts'), 'utf8')
    for (const name of GS.CC_WRITE_ACTIONS) {
      assert.match(invalidates, new RegExp(`"${name}":\\s*\\[\\s*"potentialClients"\\s*\\]`), `${name} refreshes the referrals`)
    }
  })

  it('the pack parts the page reads are the ones clientCandidatePack gathers', () => {
    const reads = readFileSync(resolve(ROOT, FEATURE, 'candidateReads.ts'), 'utf8')
    const parts = [...reads.matchAll(/candidatePackOr\(candidate, '([a-z_]+)'/g)].map((m) => m[1])
    const texts = /candidatePackOr\(candidate, 'texts'/.test(reads) ? [] : [...reads.matchAll(/candidatePackOr\([^,]+, '([a-z_]+)'/g)].map((m) => m[1])
    assert.deepEqual([...new Set([...parts, ...texts, 'texts'])].sort(), [...GS.CC_PACK_PARTS].sort())
  })

  it('the stages are the intake\'s six, in order and words, on both sides; Potential Clients tints and filters them too', () => {
    assert.deepEqual(STAGES.map((s) => [s.label, s.tint]), [['Referral', 'blue'], ['Discovery', 'amber'], ['Assessment', 'lavender'],
      ['Placement Review', 'peach'], ['Ready for Intake', 'mint'], ['Closed', 'pink']])
    const gsStages = JSON.parse(JSON.stringify(GS.CC_STAGES)) as typeof GS.CC_STAGES
    assert.deepEqual(STAGES.map((s) => [s.id, s.label, s.description]), gsStages.map((s) => [s.id, s.label, s.description]),
      'ClientCandidates.gs names the same stages')
    // the Potential Clients Pipeline: every value rows already hold keeps its tint, and the six are tinted and filterable
    const cfg = potentialClientsPipelinePage.config as { columns: { key: string; tintBy?: Record<string, string> }[];
      filters: { key: string; options: string[] }[] }
    const tints = cfg.columns.find((c) => c.key === 'stage')?.tintBy ?? {}
    for (const s of INTAKE_STAGES) assert.equal(tints[s.label], s.tint, `${s.label} is tinted ${s.tint} in Potential Clients`)
    for (const k of ['New', 'Contacted', 'ISP drafting', 'Converted', 'On hold', 'new', 'read']) assert.ok(tints[k], `${k} keeps its tint`)
    assert.deepEqual(cfg.filters.find((f) => f.key === 'stage')?.options, ['new', 'read', ...INTAKE_STAGES.map((s) => s.label)])
    // the words rows already hold show as one of the six — for display and filtering only
    const shown = ['new', 'scraped', 'read', '', 'contacted', 'assessment', 'ISP drafting', 'intake', 'converted', 'On hold', 'lost',
      'Closed', 'Waitlist'].map((s) => `${s}:${intakeId(s)}`)
    assert.deepEqual(shown, ['new:referral', 'scraped:referral', 'read:referral', ':referral', 'contacted:discovery',
      'assessment:assessment', 'ISP drafting:placement-review', 'intake:placement-review', 'converted:ready-for-intake',
      'On hold:closed', 'lost:closed', 'Closed:closed', 'Waitlist:'])
    // and the Funnel stands a stage written here in its matching column
    assert.deepEqual(['Referral', 'Discovery', 'Assessment', 'Placement Review', 'Ready for Intake', 'Closed'].map(funnelColumnOf),
      ['', 'contacted', 'assessment', 'intake', 'converted', 'lost'])
    assert.equal(boardStage({ stage: 'Placement Review', ai_rating: '3' }), 'intake')
    assert.equal(boardStage({ stage: 'Referral', ai_rating: '5' }), '', 'a Referral enters the board by its score alone')
    // the relay keeps a pack for exactly the referrals the page says are in the intake
    const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
    const set = (name: string) => new Set([...(new RegExp(`^${name} = frozenset\\(\\{([^}]*)\\}\\)`, 'm').exec(relay)?.[1] ?? '')
      .matchAll(/"([^"]+)"/g)].map((m) => m[1]))
    const closed = set('_APP_PACK_LEAD_CLOSED'), moved = set('_APP_PACK_LEAD_MOVED')
    for (const w of ['new', 'read', '', 'contacted', 'assessment', 'isp-drafting', 'intake', 'converted', 'on-hold', 'lost', 'closed',
      'referral', 'discovery', 'placement-review', 'ready-for-intake', 'waitlist']) {
      const id = intakeId(w)
      assert.equal(closed.has(w), ['ready-for-intake', 'closed'].includes(id), `${w || '(blank)'}: closed on both sides`)
      assert.equal(moved.has(w), ['discovery', 'assessment', 'placement-review'].includes(id), `${w || '(blank)'}: moved on both sides`)
    }
  })

  it('a pack key is the relay\'s own, and the one ClientCandidates.gs takes', () => {
    const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
    const re = /_APP_PACK_LEAD_RE = r"([^"]+)"/.exec(relay)?.[1] ?? ''
    assert.ok(re, 'the relay names its key')
    const theirs = new RegExp(`^(${re})$`)
    // every side trims the key first
    for (const k of ['LEAD_2310', 'LEAD_1', 'lead_2310', 'LE', '123e4567-e89b-12d3-a456-426614174000', ' LEAD_2310 ', 'LEAD/2310', 'x'.repeat(81)]) {
      assert.equal(PACK_KEY_RE.test(k.trim()), theirs.test(k.trim()), k)
      const refused = door('clientCandidateOverview', { candidate: k }).status === 400
      if (!PACK_KEY_RE.test(k.trim())) assert.ok(refused, `${k} is no candidate there either`)
    }
  })

  it('a session that is not the master in its own gets "Unknown action.", which the page says as a sentence', async () => {
    S.packOpen = false
    SESSION = DIRECTOR
    await assert.rejects(readOverview(KEY), (err: Error) => readRefusal(err.message) === NOT_PUBLISHED)
    await assert.rejects(writeCandidate(KEY, { kind: 'note', note: 'x' }), (err: Error) => readRefusal(err.message) === NOT_PUBLISHED)
    SESSION = { ...MASTER, visiting_member: 'mem_1' }
    await assert.rejects(readRoster(true), (err: Error) => readRefusal(err.message) === NOT_PUBLISHED)
    assert.equal(door('clientCandidatePack', { candidate: KEY }, DIRECTOR).status, 404, 'the pack answers the service identity or the master only')
    assert.equal(S.leads[0].notes, 'Sep 20, 2026 — first look', 'nothing was written')
  })

  it('released on everything, a director reads every section through the doors and presses nothing; a client, family or an SSA scope reads nothing', async () => {
    S.packOpen = false
    SESSION = DIRECTOR
    RELEASED[String(DIRECTOR.email)] = 'all'
    try {
      assert.equal(overviewOf(await readOverview(KEY)).candidate.key, KEY)
      assert.ok(rosterOf(await readRoster(true)).candidates.some((c) => c.key === KEY))
      for (const a of ['clientCandidateActions', 'clientCandidateIntake', 'clientCandidateDocuments', 'clientCandidateActivity',
        'clientCandidateTexts', 'clientCandidateTranscripts']) {
        assert.equal(door(a, { candidate: KEY }).status, 200, a)
      }
      await assert.rejects(writeCandidate(KEY, { kind: 'note', note: 'x' }), (err: Error) => readRefusal(err.message) === NOT_PUBLISHED)
      assert.deepEqual(door('clientCandidateFile', { candidate_id: KEY, doc: 'consent', confirm: true }), { status: 404, message: 'Unknown action.' })
      assert.deepEqual(door('clientCandidatePack', { candidate: KEY }), { status: 404, message: 'Unknown action.' }, 'the pack stays the master\'s')
      for (const kind of ['client', 'guardian', 'ssa']) {
        RELEASED[String(DIRECTOR.email)] = kind
        for (const a of ['clientCandidateRoster', 'clientCandidateOverview', 'clientCandidateDocuments', 'clientCandidateTexts']) {
          assert.deepEqual(door(a, { candidate: KEY }), { status: 404, message: 'Unknown action.' }, `${kind}: ${a}`)
        }
      }
      assert.equal(S.leads[0].notes, 'Sep 20, 2026 — first look', 'nothing was written')
    } finally {
      delete RELEASED[String(DIRECTOR.email)]
    }
  })

  it('a referral no row carries is refused in words', async () => {
    S.packOpen = false
    await assert.rejects(readOverview('LEAD_424242'), /No candidate "LEAD_424242" is on file/)
  })
})

/* ---------- the lanes ---------- */

describe('the lanes: the slice, then the relay\'s pack, then the door', () => {
  it('the roster comes from the potentialClients slice with no execution, and says what the action says', async () => {
    const lane1 = rosterOf(await readRoster(false))
    assert.deepEqual(gasCalls(), [])
    assert.deepEqual(packAsks(), [])
    const action = rosterOf(door('clientCandidateRoster', {}).data)
    const shown = (r: RosterRow) => [r.key, r.referral, r.name, r.service, r.stage, r.zip, r.location, r.next_step, r.owner, r.source,
      r.referred, r.phone, r.email, r.rating, r.expires, r.alerted]
    assert.deepEqual(lane1.candidates.map(shown), action.candidates.map(shown))
    assert.deepEqual(lane1.candidates.map((r) => [r.key, r.stage, r.location, r.source]), [
      ['LEAD_2310', 'new', 'ZIP 44708', 'County referral portal'], ['LEAD_2301', 'assessment', 'ZIP 44720', 'County referral portal'],
      ['LEAD_2300', 'converted', 'ZIP 44614', 'Potential_Clients / Data'], ['LEAD_2299', '', '', 'County referral portal'],
      ['LEAD_988', 'lost', 'ZIP 44646', 'County referral portal']])
    assert.ok(lane1.candidates.every((r) => r.rank !== null), 'the slice carries the Potential Clients ranking')
  })

  it('with no slice here the roster reads its action', async () => {
    S.slicesServed = false
    const r = rosterOf(await readRoster(false))
    assert.deepEqual(gasCalls(), ['clientCandidateRoster'])
    assert.equal(r.candidates.length, 5)
  })

  it('every section reads the relay\'s pack first — the key in the header, never the address — and the door\'s own answer is the same', async () => {
    const [o, a, i, d, act, t, c] = await Promise.all([readOverview(KEY), readActions(KEY), readIntake(KEY), readDocuments(KEY),
      readActivity(KEY), readTexts(KEY), readTranscripts(KEY)])
    assert.deepEqual(gasCalls(), [], 'no section read its door')
    assert.equal(packAsks().filter((p) => p === `client-candidates:${KEY}`).length, 1, 'one pack serves every section')
    assert.ok(seen.every((s) => !(s.url ?? '').includes(KEY)), 'the key rides the header, never the address')
    assert.deepEqual(overviewOf(o), overviewOf(door('clientCandidateOverview', { candidate: KEY }).data))
    assert.deepEqual(actionsOf(a), actionsOf(door('clientCandidateActions', { candidate: KEY }).data))
    assert.deepEqual(intakeOf(i), intakeOf(door('clientCandidateIntake', { candidate: KEY }).data))
    assert.deepEqual(documentsOf(d), documentsOf(door('clientCandidateDocuments', { candidate: KEY }).data))
    assert.deepEqual(activityOf(act), activityOf(door('clientCandidateActivity', { candidate: KEY }).data))
    assert.deepEqual(textsOf(t), textsOf(door('clientCandidateTexts', { candidate: KEY }).data))
    assert.deepEqual(alertsOf(t), alertsOf(door('clientCandidateTexts', { candidate: KEY }).data))
    assert.deepEqual(transcriptsOf(c), transcriptsOf(door('clientCandidateTranscripts', { candidate: KEY }).data))
  })

  it('when the relay has no pack door, each section reads its own action', async () => {
    S.packOpen = false
    await Promise.all([readOverview(KEY), readActions(KEY), readIntake(KEY), readDocuments(KEY), readActivity(KEY), readTexts(KEY),
      readTranscripts(KEY)])
    assert.deepEqual(gasCalls().sort(), ['clientCandidateActions', 'clientCandidateActivity', 'clientCandidateDocuments',
      'clientCandidateIntake', 'clientCandidateOverview', 'clientCandidateTexts', 'clientCandidateTranscripts'])
  })

  it('a referral out of the intake — Ready for Intake, Closed, or its window closed untouched — is never asked of the relay', async () => {
    for (const key of ['LEAD_2300', 'LEAD_988', 'LEAD_2299']) await readOverview(key)
    assert.deepEqual(packAsks(), [])
    assert.deepEqual(gasCalls(), ['clientCandidateOverview', 'clientCandidateOverview', 'clientCandidateOverview'])
    // one moved into the intake by a hand is asked even with its window closed
    seen = []
    await readOverview('LEAD_2301')
    assert.deepEqual(packAsks(), ['client-candidates:LEAD_2301'])
    const rows = rosterOf(rosterFrom(S.leads)).candidates
    assert.deepEqual(rows.filter((r) => inIntake(r)).map((r) => r.key).sort(), ['LEAD_2301', 'LEAD_2310'])
  })
})

/* ---------- the reads, as the page reads them ---------- */

describe('the reads', () => {
  it('overview: at a glance, contact, the referral overview with the AI rating, its tiles and its rank, the next step and the quick actions — nothing unscrubbed', async () => {
    const o = overviewOf(await readOverview(KEY))
    const row = await rowOf(KEY)
    const d = knownDetails(row, o)
    assert.deepEqual([d.name, d.referral, d.service, d.stage, d.location, d.source, d.phone, d.email, d.notes],
      ['Ava Stone', '2310', 'Homemaker/Personal Care 24/7', 'new', 'ZIP 44708', 'County referral portal', '+1 (330) 555-0142',
        'ava.family@example.org', 'Sep 20, 2026 — first look'])
    assert.deepEqual([d.diagnosis, d.age, d.gender, d.funding, d.frequency, d.rating], ['Autism; DOB [withheld]', '34', 'F', '2', '24/7', '9'])
    assert.equal(o.opened, true, 'the answer names Potential Clients\' leadOpened for an alerted referral still New')
    assert.deepEqual([o.open_actions, o.docs_on_file, o.docs_total, o.rating], [3, 1, 3, '9'])
    assert.equal(o.next_step?.action, 'First call with the family or SSA')
    assert.ok(!JSON.stringify(await readOverview(KEY)).includes('01/02/1990'), 'a date of birth never leaves')
    const standing = standingRead({ state: 'ready', analysis: analyseReferrals(S.leads, Date.parse(NOW)) }, KEY)
    assert.equal(standing.standing?.place, 1, 'the ranking the lead page draws')
    const html = draw(createElement(OverviewView, { row, overview: ready(o), actions: ready(actionsOf(door('clientCandidateActions', { candidate: KEY }).data)),
      standing, onRetry: noop, onAsk: noop, onTab: noop, canWrite: true }))
    for (const w of ['At a glance', 'Service requested', 'Location / county', 'Intake coordinator', 'Source', 'Referred', 'Sep 20, 2026',
      'Referral overview', 'Open actions', 'Documents on file', '1 of 3', 'Next step', 'First call with the family or SSA', 'Recent activity',
      'Contact', 'href="tel:+13305550142"', 'href="mailto:ava.family@example.org"', 'Quick actions', 'Add note', 'Update stage',
      'View all candidates', 'Strong fit: round-the-clock care near Canton.', 'No intake coordinator is set.', 'AI rating 9 of 10',
      'Rank in the file', `#1 of ${S.leads.length}`, 'Standing', 'On the Funnel board', '>Referral<']) {
      assert.ok(html.includes(w), w)
    }
    const reading = draw(createElement(OverviewView, { row, overview: ready(o), actions: ready(null as never), onRetry: noop, onAsk: noop, onTab: noop }))
    assert.ok(reading.includes('data-standing="loading"') && reading.includes('Reading…'), 'the rank waits for the ranking, never guessed')
    noModal(html, 'overview')
  })

  it('a converted referral (Ready for Intake) names the client it became, a link into Clients, and that client\'s plan opens centred', async () => {
    const o = overviewOf(await readOverview('LEAD_2300'))
    assert.equal(o.candidate.client_key, 'caradiaz')
    const html = draw(createElement(OverviewView, { row: await rowOf('LEAD_2300'), overview: ready(o), actions: ready(null as never),
      onRetry: noop, onAsk: noop, onTab: noop }))
    assert.ok(html.includes('href="/app/client-profiles/profile?client=caradiaz"'), 'the client opens in Clients')
    assert.ok(html.includes('>Ready for Intake<'), 'converted shows as Ready for Intake')
    const menu = draw(createElement(ActionsMenu, { candidate: 'LEAD_2300', details: knownDetails(await rowOf('LEAD_2300'), o),
      onPick: noop, onTab: noop, onDone: noop }))
    assert.ok(menu.includes('Open in Clients') && menu.includes('href="/app/client-profiles/profile?client=caradiaz"'))
    const docs = documentsOf(await readDocuments('LEAD_2300'))
    const plan = docs.docs.find((x) => x.id === 'isp')
    assert.ok(plan && docOpens(plan))
    const got = await readDocFile('LEAD_2300', plan.file_id)
    assert.ok(docShapeOf(got.mime) && blobOf(got), 'the plan opens in the platform')
    await assert.rejects(readDocFile('LEAD_2300', 'foreign00001'), /names no such document/, 'a file its list does not name is refused')
  })

  it('actions: the intake with the family — STATUS / ACTION / OWNER / DUE / NEXT STEP, Mark complete (Reopen once complete) and Add note on each row', async () => {
    const a = actionsOf(await readActions('LEAD_2301'))
    assert.deepEqual(a.items.map((x) => [x.id, x.status, x.open, x.is_next, x.door?.fields.stage ?? '', x.reopen?.fields.stage ?? '']), [
      ['referral_review', 'done', false, false, '', 'referral'], ['assessment', 'in_progress', true, true, 'placement-review', ''],
      ['placement', 'pending', true, false, '', '']])
    assert.equal(a.next?.next_step, 'Visit with the family Friday')
    const html = draw(createElement(ActionsView, { name: 'Ben Carter', actions: ready(a), query: '', onQuery: noop, onAsk: noop, onRetry: noop, canWrite: true }))
    for (const w of ['>Status<', '>Action<', '>Owner<', '>Due<', '>Next step<', 'Mark complete', 'Add note', 'Visit with the family Friday',
      'Stage → Placement Review', 'Comes after Discovery &amp; assessment.', '>In Progress<', '>Completed<', 'Jo Intake', 'Reopen']) {
      assert.ok(html.includes(w), w)
    }
    assert.equal((html.match(/data-row-action="complete"/g) ?? []).length, 2)
    assert.equal((html.match(/data-row-action="reopen"/g) ?? []).length, 1, 'a completed step is reopened, never completed again')
    noModal(html, 'actions')
  })

  it('intake: the three phases with their pill, and the preferences and support network — what the row lacks said, never guessed', async () => {
    const i = intakeOf(await readIntake('LEAD_2301'))
    assert.deepEqual(i.plan.map((s) => [s.title, s.status]), [['Referral review', 'completed'], ['Discovery & assessment', 'awaiting_confirmation'],
      ['Service fit & placement', 'pending']])
    assert.ok(i.why.some((w) => /family or guardian/.test(w)))
    const html = draw(createElement(IntakeView, { row: { name: 'Ben Carter' }, intake: ready(i), onRetry: noop }))
    for (const w of ['Intake &amp; service fit', 'Referral review', 'Discovery &amp; assessment', 'Service fit &amp; placement', '>Completed<',
      '>Awaiting Confirmation<', '>Pending<', 'Visit with the family Friday', 'Preferences &amp; support network', 'Service requested',
      'Supported living', 'Support network', 'Family / guardian', 'Not on file', 'Contact method']) {
      assert.ok(html.includes(w), w)
    }
    noModal(html, 'intake')
  })

  it('information, documents, activity and SMS draw the answers\' own words — the referral\'s own fields, the papers and the alerts too', async () => {
    const row = await rowOf(KEY)
    const o = overviewOf(await readOverview(KEY))
    const info = draw(createElement(InformationView, { row, overview: ready(o), onRetry: noop }))
    for (const w of ['Full name', 'Stage', 'Phone', 'E-mail', 'Source', 'Referred', 'Service requested', 'Location / county', 'Family / guardian',
      'Important to me', 'Preferred start', 'Intake coordinator', 'Diagnosis', 'Frequency', 'Age', 'Gender', 'Funding source', 'Referral number',
      'Referral window', 'AI rating']) assert.ok(info.includes(`>${w}<`), w)
    for (const w of ['Autism; DOB [withheld]', '9 of 10', '>34<', '>F<', 'Dec 31, 2027']) assert.ok(info.includes(w), w)
    const d = documentsOf(await readDocuments(KEY))
    assert.deepEqual(d.docs.map((x) => [x.id, x.status]), [['referral', 'on_file'], ['assessment', 'pending'], ['consent', 'pending']])
    assert.deepEqual(d.docs.map((x) => docFileAsk(x)), [null, null, { kind: 'consent' }], 'the assessment is filed at the Assessment stage alone')
    const docs = draw(createElement(DocumentsView, { row, docs: ready(d), doc: { opening: '', open: noop, render: noop }, onAsk: noop, onRetry: noop, canWrite: true }))
    for (const w of ['Referral summary', 'Support assessment', 'Consent &amp; contact preferences', '>On File<', '>Pending<', '1 of 3 on file',
      'data-file-doc="consent"', 'File…']) {
      assert.ok(docs.includes(w), w)
    }
    assert.deepEqual([...docs.matchAll(/data-open-doc="([^"]*)"/g)].map((m) => m[1]), ['referral'], 'the summary opens rendered; a paper with no file does not pretend to')
    const act = activityOf(await readActivity(KEY))
    const log = draw(createElement(ActivityView, { row, activity: ready(act), onRetry: noop }))
    assert.ok(log.includes('Referral received from the county referral portal') && log.includes('Referral record updated'))
    assert.ok(log.includes('The team was texted about this referral') && log.includes('To 2 numbers'), 'the team\'s alert is on the log')
    assert.ok(log.includes('Boss ·') && !log.includes('visiting'), 'who changed it, never the visit')
    const raw = await readTexts(KEY)
    const alerts = alertsOf(raw)
    assert.deepEqual(alerts.alerts.map((x) => [x.id, x.result, x.to]), [['p1#2', 'sent', '+1 (330) ***-0102'], ['p1#1', 'sent', '+1 (330) ***-0101']])
    const texts = draw(createElement(TextsView, { name: 'Ava Stone', texts: ready(textsOf(raw)), alerts, older: [], more: false,
      olderBusy: false, olderError: '', onPick: noop, onOlder: noop, onRetry: noop }))
    assert.ok(texts.includes('Main line') && texts.includes('Can we talk about the visit?'))
    assert.ok(texts.includes('Platform alerts about this referral') && texts.includes('Referral 2310 rated 9') && texts.includes('>Sent<'))
    const calls = draw(createElement(TranscriptsView, { name: 'Ava Stone', transcripts: ready(transcriptsOf(await readTranscripts(KEY))),
      category: '', onCategory: noop, onOpen: noop, onRetry: noop }))
    assert.ok(calls.includes('data-call="AC1"') && calls.includes('Intake'))
    const words = await readTranscript(KEY, 'AC1') as Row
    assert.ok(!String(words.full_transcript).includes('01/02/1990'), 'a call\'s words are scrubbed too')
    for (const html of [info, docs, log, texts, calls]) noModal(html, 'section')
  })

  it('the referral summary renders from the row as a PDF for the centred viewer; a paper the list does not render is refused', async () => {
    const got = await readDocRender(KEY, 'referral')
    assert.ok(docShapeOf(got.mime) === 'pdf' && blobOf(got), 'a PDF the viewer shows')
    assert.equal(S.rendered.length, 1)
    for (const w of ['Referral summary', 'Ava Stone', 'Homemaker/Personal Care 24/7', 'Autism; DOB [withheld]', '24/7', '9 of 10',
      'Strong fit: round-the-clock care near Canton.']) {
      assert.ok(S.rendered[0].includes(w), w)
    }
    assert.ok(!S.rendered[0].includes('01/02/1990'))
    await assert.rejects(readDocRender(KEY, 'assessment'), /names no such document/)
  })
})

/* ---------- the pipeline ---------- */

describe('the pipeline', () => {
  it('lists every referral, the furthest along first, with search and a stage dropdown of All and the six; a name switches the screen', async () => {
    const rows = rosterOf(await readRoster(false)).candidates
    assert.deepEqual(pipelineRows(rows, '', '').map((r) => r.key), ['LEAD_2301', 'LEAD_2310', 'LEAD_2299', 'LEAD_2300', 'LEAD_988'])
    assert.deepEqual(pipelineRows(rows, 'supported', '').map((r) => r.key), ['LEAD_2301'])
    assert.deepEqual(pipelineRows(rows, '', 'closed').map((r) => r.key), ['LEAD_988'])
    assert.deepEqual(pipelineRows(rows, '', 'referral').map((r) => r.key), ['LEAD_2310', 'LEAD_2299'])
    assert.deepEqual(pipelineRows(rows, '', 'ready-for-intake').map((r) => r.key), ['LEAD_2300'])
    assert.deepEqual(stageCounts(rows).map((c) => [c.id, c.label, c.count]), [['', 'All', 5], ['referral', 'Referral', 2],
      ['discovery', 'Discovery', 0], ['assessment', 'Assessment', 1], ['placement-review', 'Placement Review', 0],
      ['ready-for-intake', 'Ready for Intake', 1], ['closed', 'Closed', 1]])
    // a word the intake does not know shows under All alone
    const odd = [...rows, { ...rows[0], key: 'LEAD_7000', name: 'Wait Listed', stage: 'waitlist' }]
    assert.ok(pipelineRows(odd, '', '').some((r) => r.key === 'LEAD_7000'))
    assert.ok(STAGES.every((s) => !pipelineRows(odd, '', s.id).some((r) => r.key === 'LEAD_7000')))
    assert.deepEqual(stageMeta('waitlist'), { label: 'Waitlist', tint: 'slate' })
    assert.deepEqual(pipelineNext(rows.find((r) => r.key === 'LEAD_2301') as RosterRow), { text: 'Visit with the family Friday', recorded: true })
    assert.deepEqual(pipelineNext(rows.find((r) => r.key === KEY) as RosterRow), { text: 'Next stage: Discovery', recorded: false })
    assert.equal(defaultCandidate(rows)?.key, 'LEAD_2301', 'the screen opens on the one furthest along')
    const html = draw(createElement(PipelineView, { candidates: rows, current: KEY, query: '', onQuery: noop, stage: '', onStage: noop,
      shown: PIPELINE_PAGE, onMore: noop, onCandidate: noop }))
    for (const w of ['>Candidate<', '>Service requested<', '>Stage<', '>Location<', '>Next step<', 'Search candidates…', 'All · 5',
      'Assessment · 1', 'Placement Review · 0', 'data-open-candidate="LEAD_2301"', '<select', 'aria-label="Stage"']) {
      assert.ok(html.includes(w), w)
    }
    assert.ok(!html.includes('role="tablist"'), 'the filter is a dropdown, not a strip of chips')
    const options = [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1])
    assert.deepEqual(options, ['', 'referral', 'discovery', 'assessment', 'placement-review', 'ready-for-intake', 'closed'])
    const many = Array.from({ length: PIPELINE_PAGE + 3 }, (_, n) => ({ ...rows[0], key: `LEAD_${9000 + n}`, name: `Person ${n}` }))
    const paged = draw(createElement(PipelineView, { candidates: many, current: '', query: '', onQuery: noop, stage: '', onStage: noop,
      shown: PIPELINE_PAGE, onMore: noop, onCandidate: noop }))
    assert.equal((paged.match(/data-pipeline-row="/g) ?? []).length, PIPELINE_PAGE)
    assert.ok(paged.includes(`Showing ${PIPELINE_PAGE} of ${PIPELINE_PAGE + 3}`) && paged.includes('Show more'))
  })

  it('the switcher is a listbox with a search, and says when the search must narrow it', async () => {
    const rows = rosterOf(await readRoster(false)).candidates
    const list = draw(createElement(SwitcherList, { candidates: rows, current: KEY, query: '', onQuery: noop, onPick: noop }))
    assert.match(list, /role="listbox"/)
    assert.ok(list.includes('Search candidates…') && list.includes('Ava Stone') && list.includes('Referral · ZIP 44708'))
    assert.deepEqual(switcherCandidates(rows, '44720').map((r) => r.key), ['LEAD_2301'])
  })
})

/* ---------- the presses: the Potential Clients row itself ---------- */

describe('the presses', () => {
  it('Update stage writes the stage\'s label on the referral\'s row and one log line; the roster and Potential Clients read it back', async () => {
    S.packOpen = false
    const got = await writeCandidate(KEY, { kind: 'stage', stage: 'discovery' })
    assert.deepEqual(seen.filter((s) => s.kind === 'gas').map((s) => [s.name, s.payload]),
      [['clientCandidateWrite', { candidate_id: KEY, kind: 'stage', stage: 'discovery' }]])
    assert.deepEqual(resourceWrites(), [], 'no generic write from the page: the press is the door on the row as it stands')
    assert.equal(candidateWrote(KEY, got), false, 'the row came back, not a ledger receipt')
    assert.equal(S.leads[0].stage, 'Discovery', 'the label Potential Clients tints and filters')
    assert.deepEqual(logOf(KEY).map((e) => [e.text, e.by, e.kind]), [['Stage: Referral → Discovery', 'Boss', 'stage']])
    assert.match(logOf(KEY)[0].at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    assert.equal((await rowOf(KEY)).stage, 'discovery')
    await assert.rejects(writeCandidate(KEY, { kind: 'stage', stage: 'discovery' }), /already at Discovery/)
    await assert.rejects(writeCandidate(KEY, { kind: 'stage', stage: 'nowhere' }), /Pick a stage first/)
    await assert.rejects(writeCandidate('', { kind: 'note', note: 'x' }), /Nothing to write/)
  })

  it('Mark complete writes the move the answer names and "Completed action"; Reopen moves it back with "Reopened action"; a note joins the notes', async () => {
    S.packOpen = false
    const a = actionsOf(await readActions('LEAD_2301'))
    const next = a.items.find((x) => x.is_next)
    assert.ok(next?.door)
    assert.deepEqual(next.door.fields, { stage: 'placement-review' })
    await writeCandidate('LEAD_2301', { kind: 'complete', item: next.id, note: 'Met the family, all agreed' })
    const ben = S.leads[1]
    assert.equal(ben.stage, 'Placement Review')
    assert.match(String(ben.notes), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} · Boss — Needs assessment & house fit: Met the family, all agreed$/)
    assert.deepEqual(logOf('LEAD_2301').map((e) => e.text), ['Completed action: Needs assessment & house fit'])
    const after = actionsOf(door('clientCandidateActions', { candidate: 'LEAD_2301' }).data)
    assert.equal(after.next?.id, 'placement')
    const done = after.items.find((x) => x.id === 'assessment')
    assert.deepEqual(done?.reopen, { fields: { stage: 'discovery' } })
    await writeCandidate('LEAD_2301', { kind: 'reopen', item: 'assessment' })
    assert.equal(S.leads[1].stage, 'Discovery')
    assert.deepEqual(logOf('LEAD_2301').map((e) => e.text), ['Completed action: Needs assessment & house fit',
      'Reopened action: Needs assessment & house fit'])
    await assert.rejects(writeCandidate('LEAD_2301', { kind: 'reopen', item: 'assessment' }), /nothing to reopen/)
  })

  it('Add note appends one line to the notes as the row holds them at the press — a note written elsewhere meanwhile is kept', async () => {
    S.packOpen = false
    const held = overviewOf(await readOverview(KEY)).candidate.notes
    // another session writes a line straight onto the row after this page read it
    S.leads[0].notes = `${String(S.leads[0].notes)}\nSep 27, 2026 — from another session`
    await writeCandidate(KEY, { kind: 'note', note: 'Called the family back' })
    const lines = String(S.leads[0].notes).split('\n')
    assert.equal(lines.length, 3)
    assert.deepEqual(lines.slice(0, 2), ['Sep 20, 2026 — first look', 'Sep 27, 2026 — from another session'])
    assert.match(lines[2], /· Boss — Called the family back$/)
    assert.equal(held, 'Sep 20, 2026 — first look', 'the page held the notes from before the other line')
    assert.deepEqual(resourceWrites(), [], 'and never wrote them back whole')
    assert.deepEqual(logOf(KEY).map((e) => e.text), ['Note added'], 'the log says a note was added, never its words')
    assert.equal(latestNotes(String(S.leads[0].notes))[0], lines[2])
    await assert.rejects(writeCandidate(KEY, { kind: 'note', note: '   ' }), /Write the note first/)
  })

  it('a stage filed from the page is on the section at once: the write forgets the referral and the section reads again', async () => {
    S.packOpen = false
    const h = mountHook(() => useCandidateRead(readKey('clientCandidateActions', 'LEAD_2301'), () => readActions('LEAD_2301'), actionsOf), {})
    await h.settle(() => h.current.status === 'ready')
    assert.equal(h.current.data?.next?.id, 'assessment')
    const sentAt = Date.now()
    const got = await writeCandidate('LEAD_2301', { kind: 'stage', stage: 'placement-review' })
    h.run(() => { candidateWrote('LEAD_2301', got, sentAt) })
    await h.settle(() => h.current.data?.next?.id === 'placement' && !h.current.refreshing)
    assert.equal(h.current.data?.next?.id, 'placement')
    h.unmount()
  })

  it('the support assessment is filed at the Assessment stage, the consent with its contact preferences In Review until confirmed', async () => {
    S.packOpen = false
    const paper = { name: 'assessment.pdf', mime: 'application/pdf', b64: Buffer.from(PDF).toString('base64') }
    await assert.rejects(fileCandidateDoc(KEY, { doc: 'assessment', file: paper }), /at the Assessment stage/)
    const ben = documentsOf(await readDocuments('LEAD_2301'))
    assert.deepEqual(docFileAsk(ben.docs.find((x) => x.id === 'assessment') ?? ({} as never)), { kind: 'file-assessment' })
    await fileCandidateDoc('LEAD_2301', { doc: 'assessment', file: paper })
    assert.deepEqual(S.filed, [{ folder: 'LEAD_2301', name: 'Support assessment - LEAD_2301 - assessment.pdf', mime: 'application/pdf' }])
    const after = documentsOf(door('clientCandidateDocuments', { candidate: 'LEAD_2301' }).data).docs.find((x) => x.id === 'assessment')
    assert.equal(after?.status, 'on_file')
    assert.equal(after?.file_id, 'filed0000001')
    await fileCandidateDoc(KEY, { doc: 'consent', file: { ...paper, name: 'consent.pdf' }, method: 'Phone call', best_time: 'Mornings',
      contact_who: 'Rosa (daughter)' })
    const consent = () => documentsOf(door('clientCandidateDocuments', { candidate: KEY }).data).docs.find((x) => x.id === 'consent')
    assert.equal(consent()?.status, 'in_review')
    assert.deepEqual(consent()?.preferences, { method: 'Phone call', best_time: 'Mornings', who: 'Rosa (daughter)' })
    assert.deepEqual(docFileAsk(consent() ?? ({} as never)), { kind: 'consent' }, 'In Review opens the panel to confirm it')
    await fileCandidateDoc(KEY, { doc: 'consent', confirm: true })
    assert.equal(consent()?.status, 'on_file')
    assert.equal(docFileAsk(consent() ?? ({} as never)), null)
    assert.deepEqual(logOf('LEAD_2301').map((e) => e.text), ['Support assessment filed'])
    assert.deepEqual(logOf(KEY).map((e) => e.text), ['Consent & contact preferences filed', 'Consent & contact preferences confirmed'])
    assert.deepEqual(resourceWrites(), [])
  })

  it('opening an alerted referral still New is Potential Clients\' own acknowledgement — once, and only then', async () => {
    assert.equal(await reportOpened(KEY), true)
    assert.equal(S.leads[0].stage, 'read')
    assert.equal(await reportOpened(KEY), false, 'the second time changes nothing')
    assert.equal(await reportOpened('LEAD_2301'), false)
    assert.deepEqual(gasCalls(), ['leadOpened', 'leadOpened', 'leadOpened'])
  })

  it('a press\'s descriptor is read for one of the six stages alone', () => {
    assert.deepEqual(doorOf({ action: 'clientCandidateWrite', kind: 'complete', fields: { stage: 'Placement Review' } }), { fields: { stage: 'placement-review' } })
    assert.deepEqual(doorOf({ fields: { stage: 'discovery', owner: 'Jo' } }), { fields: { stage: 'discovery' } })
    assert.equal(doorOf({ fields: { stage: 'contacted' } }), null, 'a word rows hold is shown as a stage, never written as one')
    assert.equal(doorOf({ fields: { next_step: 'Call the SSA' } }), null)
    assert.equal(doorOf(null), null)
  })
})

/* ---------- no modal anywhere ---------- */

describe('no modal anywhere', () => {
  const row: RosterRow = {
    key: KEY, referral: '2310', name: 'Ava Stone', service: 'Homemaker/Personal Care 24/7', stage: 'new', zip: '44708', county: '',
    location: 'ZIP 44708', next_step: '', owner: '', source: 'County referral portal', referred: '2026-09-20', phone: '+1 (330) 555-0142',
    email: 'ava.family@example.org', rating: '9', expires: '12/31/27', alerted: true, rank: 17, avatar: '', notes: 'Sep 20, 2026 — first look',
  }

  it('no browser dialog, no Dialog or Sheet, no modal or viewer of its own, no framed document, no Drive link', () => {
    for (const file of walk(FEATURE)) {
      const text = readFileSync(resolve(ROOT, file), 'utf8')
      assert.doesNotMatch(text, /window\.(confirm|alert|prompt)\(/, file)
      assert.doesNotMatch(text, /import[^;]*\b\w*(Dialog|Sheet|Modal)\b[^;]*from/, file)
      assert.doesNotMatch(text, /from '[^']*(ui\/dialog|ui\/sheet)'/, file)
      assert.doesNotMatch(text, /components\/shared\/FileViewer|openFile\(|fixed inset-0|aria-modal|role="dialog"/, file)
      assert.doesNotMatch(text, /<iframe|createObjectURL/, `${file}: a document opens in the platform's viewer`)
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      assert.doesNotMatch(code, /drive\.google\.com|docs\.google\.com|webViewLink|target="_blank"/, file)
    }
    const openers = walk(FEATURE).filter((f) => readFileSync(resolve(ROOT, f), 'utf8').includes("from '@/lib/platformDoc'"))
    assert.deepEqual(openers.map((f) => f.slice(FEATURE.length + 1)), ['useCandidateRead.ts'])
  })

  it('every mode of the panel is the SidePanel aside, and rides the address', () => {
    const share = sharePayloadFor(row, 'overview')
    const asks: CandidateAsk[] = [{ kind: 'share' }, { kind: 'note', about: '' }, { kind: 'note', about: 'referral_review' }, { kind: 'stage' },
      { kind: 'complete', item: 'referral_review' }, { kind: 'reopen', item: 'referral_review' }, { kind: 'file-assessment' },
      { kind: 'consent' }, { kind: 'transcript', id: 'AC1' }]
    for (const ask of asks) {
      assert.deepEqual(panelOf(panelParam(ask)), ask, `${ask.kind} rides the address`)
      const html = draw(createElement(CandidatePanel, { ask, row, share, onClose: noop }))
      assert.match(html, /<aside aria-label="/, ask.kind)
      noModal(html, ask.kind)
    }
    assert.equal(draw(createElement(CandidatePanel, { ask: null, row, share, onClose: noop })), '')
    const stage = draw(createElement(CandidatePanel, { ask: { kind: 'stage' }, row, share, onClose: noop, canWrite: true }))
    for (const w of ['data-stage-select=""', 'Existing intake and document records keep their own statuses.', '>Apply', '>Referral (current)<',
      'First call with the family or SSA']) {
      assert.ok(stage.includes(w), w)
    }
    assert.deepEqual([...stage.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]), STAGES.map((s) => s.id), 'exactly the six, in order')
    const note = draw(createElement(CandidatePanel, { ask: { kind: 'note', about: '' }, row, share, onClose: noop, canWrite: true }))
    assert.ok(note.includes('Add a note about this referral…') && note.includes('Notes on the referral') && note.includes('Sep 20, 2026 — first look'))
    assert.ok(note.includes('Apply note') && note.includes('>Cancel<'))
    const shared = draw(createElement(CandidatePanel, { ask: { kind: 'share' }, row, share, onClose: noop }))
    assert.ok(shared.includes(`/app/client-candidates/profile?candidate=${KEY}`))
    assert.ok(!/555-0142|ava\.family|Homemaker|Autism/.test(JSON.stringify(share)), 'the share names no phone, e-mail, service or diagnosis')
  })

  it('the top bar: Actions sits right so its menu opens inward on a phone; a menu of three groups; a breadcrumb', () => {
    const src = readFileSync(resolve(ROOT, FEATURE, 'CandidateActions.tsx'), 'utf8')
    assert.match(src, /<div className="ml-auto flex items-center gap-2" data-actions-root="">/)
    const menu = draw(createElement(ActionsMenu, { candidate: KEY, details: { email: row.email, phone: row.phone, client_key: '' },
      onPick: noop, onTab: noop, onDone: noop, canWrite: true }))
    assert.match(menu, /role="menu"/)
    for (const w of ['Candidate actions', 'Contact', 'Navigation', 'Add note', 'Update stage', 'Copy e-mail', 'Call', 'View all candidates',
      'Open in Potential Clients', `href="/app/potential-clients/unique?record=${KEY}"`, 'href="tel:+13305550142"']) {
      assert.ok(menu.includes(w), w)
    }
    const none = draw(createElement(ActionsMenu, { candidate: KEY, details: { email: '', phone: '', client_key: '' },
      onPick: noop, onTab: noop, onDone: noop }))
    assert.equal((none.match(/disabled=""/g) ?? []).length, 2, 'an item with nothing behind it does nothing')
    const screen = draw(createElement(CandidatesScreen, { roster: ready(null), onRetry: noop, candidates: [row], wanted: KEY, row, tab: 'intake',
      details: knownDetails(row, null), actionsCount: 2, onCandidate: noop, onTab: noop, onAsk: noop }))
    assert.ok(screen.includes('Client Candidates') && screen.includes('>Intake<') && screen.includes('data-crumb=""'))
    for (const t of ['Overview', 'Actions', 'Pipeline', 'Information', 'Intake', 'Documents', 'Activity Log', 'SMS', 'Transcripts']) {
      assert.ok(screen.includes(`>${t}<`), t)
    }
    assert.ok(screen.includes('Referral 2310') && screen.includes('data-actions-count=""'))
    noModal(screen, 'screen')
  })

  it('a stage is drawn in the intake\'s words and tint, whatever word the row holds', () => {
    assert.deepEqual(stageMeta('assessment'), { label: 'Assessment', tint: 'lavender' })
    assert.deepEqual(stageMeta('read'), { label: 'Referral', tint: 'blue' })
    assert.deepEqual(stageMeta('Placement Review'), { label: 'Placement Review', tint: 'peach' })
    assert.deepEqual(stageMeta('lost'), { label: 'Closed', tint: 'pink' })
    assert.deepEqual(stageMeta('converted'), { label: 'Ready for Intake', tint: 'mint' })
    assert.deepEqual(stageMeta(''), { label: 'Referral', tint: 'blue' })
  })
})

/* ---------- what crossed the wire ---------- */

describe('what crossed the wire', () => {
  it('every call carries only the parameters its door declares', async () => {
    S.packOpen = false
    await Promise.all([readRoster(true), readOverview('LEAD_2300'), readActions(KEY), readIntake(KEY), readDocuments('LEAD_2300'),
      readActivity(KEY), readTexts(KEY), readTexts(KEY, '3305550100', '2026-09-22T00:00:00Z'), readTranscripts(KEY)])
    await readDocFile('LEAD_2300', 'ispcara00001')
    await readDocRender(KEY, 'referral')
    await readTranscript(KEY, 'AC1')
    await writeCandidate(KEY, { kind: 'note', note: 'x', item: 'referral_review' })
    await writeCandidate('LEAD_2301', { kind: 'complete', item: 'assessment', note: 'done' })
    await fileCandidateDoc(KEY, { doc: 'consent', file: { name: 'c.pdf', mime: 'application/pdf', b64: 'JVBERg==' }, method: '',
      best_time: '', contact_who: '' })
    const calls = seen.filter((s) => s.kind === 'gas')
    assert.deepEqual([...new Set(calls.map((c) => c.name))].sort(), [...GS.CC_ACTIONS, ...GS.CC_WRITE_ACTIONS].sort())
    const bad = calls.filter((c) => {
      const declared = Object.keys(GS.HUB_POLICY[c.name]?.params ?? {})
      return Object.keys(c.payload ?? {}).some((k) => !declared.includes(k))
    })
    assert.deepEqual(bad, [])
  })

  it('every read and the pack are never stamped for a receipt; every press keeps one', () => {
    const listed = RELAY_NO_RECEIPT()
    for (const name of [...GS.CC_ACTIONS, 'clientCandidatePack']) {
      assert.notEqual(GS.HUB_POLICY[name]?.lane, 'write', `${name} writes nothing`)
      assert.ok(listed.has(name), `${name} is in RELAY_NO_RECEIPT_ACTIONS`)
    }
    for (const name of GS.CC_WRITE_ACTIONS) assert.ok(!listed.has(name), `${name} keeps its receipt`)
  })
})
