/**
 * CLIENTS · where each section is read: the slices first (the switcher's roster and the incident reports computed
 * here, the ClientProfiles.gs rules ported and held to the .gs itself), then the relay's pack for the client (the
 * record, the care tabs, the medications, the review statuses, the activity and the six source answers), then the
 * section's own action — the pack held in memory, shared by the sections, refreshed behind what is drawn, waited on
 * a few seconds once, prefetched from the relay's memory for the neighbours and never for an archived client,
 * forgotten by a write (and no house's pack with it), never drawn from before this tab's own write was sent, never
 * named in the address, and dropped at every memory boundary. The fixtures are invented.
 */
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { useAuthStore } from '@/auth/useAuthStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { useWorldStore } from '@/stores/useWorldStore'
import { forgetSnapshot } from '@/lib/snapshotClient'
import { PACK_FRESH_MS, PREFETCH_GAP_MS, forgetPack, peekPack, readPack } from '@/lib/appPack'
import { ohioToday } from '@/lib/ohio'
import { clientIncidentsOf, rosterOf } from '@/pages/features/clientprofiles/clientModel'
import {
  clientIdentityRow, incidentsFrom, reviewsOf, rosterFrom, scrubAnswer,
} from '@/pages/features/clientprofiles/clientLanes'
import { CLIENTS_PACK, CLIENT_PACK_WAIT_S, clientAnswerAt, prefetchClient } from '@/pages/features/clientprofiles/clientReads'
import {
  clientWritten, forgetClientReads, readActivity, readCare, readDetails, readDocFile, readIncidents, readKey, readMeds,
  readRoster, useClientRead,
} from '@/pages/features/clientprofiles/useClientRead'
import { readAppointments } from '@/pages/features/clientprofiles/sources/appointments'
import { readBilling, readFunds } from '@/pages/features/clientprofiles/sources/finance'
import { readMar } from '@/pages/features/clientprofiles/sources/mar'
import { readRefillForms } from '@/pages/features/clientprofiles/sources/refills'
import { forgetTransportReads, readTransport, useTransportRead } from '@/pages/features/clientprofiles/sources/transport'
import { readKey as locationKey, useLocationRead } from '@/pages/features/locations/useLocation'
import { mountHook } from './react-host'

const ROOT = process.env.SPA_ROOT ?? process.cwd()

/* ---------- the .gs itself, for parity ---------- */

function gsFunction(file: string, name: string): string {
  const src = readFileSync(resolve(ROOT, 'apps-script', file), 'utf8')
  const at = src.indexOf(`function ${name}(`)
  assert.ok(at !== -1, `${name} in ${file}`)
  let depth = 0
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1)
  }
  throw new Error(`${name} does not close`)
}

type Fn = (...a: unknown[]) => unknown
const GS = vm.createContext({ HUB_POLICY: {}, HUB_ACTIONS: {} }) as Record<string, Fn> & Record<string, unknown>
vm.runInContext(readFileSync(resolve(ROOT, 'apps-script/Locations.gs'), 'utf8'), GS)
vm.runInContext(readFileSync(resolve(ROOT, 'apps-script/ClientProfiles.gs'), 'utf8'), GS)
vm.runInContext(['clientNameKey_', 'apptDay_', 'clientPhotoIndex_'].map((n) => gsFunction('Clients.gs', n)).join('\n'), GS)
const same = (a: unknown, b: unknown) => assert.equal(JSON.stringify(a), JSON.stringify(b))

/* ---------- the fixtures ---------- */

const CLIENT_ROWS = [
  { id: 'CLI_kay_test', client_key: 'kay_test', name: 'Kay  Test', house: 'ZZ9999', status: 'active', isp_year: '2026',
    avatar: '', medications: ['secret pill'], diagnoses_text: 'private words', guardian_phone: '3305550101' },
  { id: 'CLI_lee_other', client_key: 'lee_other', name: 'Lee Other', house: 'CAN - 47TH - QQ1000', status: '', isp_year: '2025',
    avatar: 'https://example.org/lee.jpg' },
  { id: 'CLI_ann_archive', client_key: 'ann_archive', name: 'Ann Archive', house: 'QQ1000', status: 'inactive' },
  { id: 'CLI_mophoto', name: 'Mo Photo', house: 'Room 123456789', status: 'Active' },
  { id: 'CLI_kay_test', client_key: 'kay_test', name: 'Kay Test Twice', status: 'active' },
]
const PHOTOS = [
  { kind: 'avatar', title: 'Mo Photo', src: 'https://example.org/mo.jpg' },
  { kind: 'avatar', title: 'Kay Test', src: 'https://example.org/kay-a.jpg' },
  { kind: 'avatar', title: 'Kay Test', src: 'https://example.org/kay-b.jpg' },
  { kind: 'avatar', title: 'Lee Other', src: 'https://example.org/hidden.jpg', hidden: 'TRUE' },
  { kind: 'house', title: 'Mo Photo', src: 'https://example.org/house.jpg' },
]
const INCIDENTS = [
  { id: 'r2', timestamp: '2026-09-10T14:00:00.000Z', client_name: 'Kay Test', your_name: 'Ann Staff',
    incident_category: 'Fall, Minor injury or illness (rash, bruise, small cut)', incident_date: '2026-09-10T04:00:00.000Z',
    incident_time: '09:30', incident_reported_date: '9/10/2026', employees_involved: 'Ann Staff; Bo Staff\nCy Staff',
    summary_of_incident: 'Slipped. Ref 900114544 typed by mistake.', comments: 'not a column' },
  { id: 'r3', timestamp: '2026-09-12T14:00:00.000Z', client_name: 'kay test', incident_category: '["Behavior"]',
    incident_date: '2026-09-12' },
  { id: 'r4', timestamp: '2026-09-11T14:00:00.000Z', client_name: 'Lee Other', incident_category: 'Fall', incident_date: '2026-09-11' },
]
const REVIEW_ROWS = [
  { id: 'kay_test|2026-09-10T14:00:00.000Z', client_key: 'kay_test', status: 'Under review', by: 'a@example.org', at: '2026-09-10T15:00:00Z' },
  { id: 'kay_test|2026-09-10T14:00:00.000Z', client_key: 'kay_test', status: 'Closed', by: 'boss@example.org', at: '2026-09-11T10:00:00Z' },
  { id: 'kay_test|2026-09-12T14:00:00.000Z', client_key: 'kay_test', status: 'Lost', by: 'x@example.org', at: '2026-09-12T15:00:00Z' },
  { id: 'lee_other|2026-09-11T14:00:00.000Z', client_key: 'lee_other', status: 'Closed', by: 'boss@example.org', at: '2026-09-12T10:00:00Z' },
]

GS.clientsDerived_ = () => JSON.parse(JSON.stringify(CLIENT_ROWS))
GS.listRows_ = (res: unknown) => (res === 'photos' ? JSON.parse(JSON.stringify(PHOTOS)) : [])
GS.estateRows_ = (res: unknown) => (res === 'uiIncidents' ? JSON.parse(JSON.stringify(INCIDENTS)) : [])
GS.cpOwnRows_ = (tab: unknown) => (tab === GS.CP_REVIEWS_TAB ? JSON.parse(JSON.stringify(REVIEW_ROWS)) : [])
GS.cpArchiveIndex_ = () => ({ rows: {}, order: [] })

describe('the rules, ported and held to the .gs', () => {
  it('the roster from the clients and photos slices is clientProfileRoster\'s own answer: identity only, current, '
    + 'once each, by name, a face only one photo carries, and the last guard applied', () => {
    const mine = rosterFrom(CLIENT_ROWS, PHOTOS)
    same(mine, GS.cpScrub_(GS.cpRosterBuild_(false)))
    const roster = rosterOf(mine)
    assert.deepEqual(roster.clients.map((c) => `${c.client_key}:${c.status}:${c.avatar}`),
      ['kay_test:active:', 'lee_other:active:https://example.org/lee.jpg', 'mophoto:active:https://example.org/mo.jpg'])
    assert.equal(roster.clients[2].house, 'Room [withheld]')
    assert.ok(!/secret pill|private words|3305550101|Twice/.test(JSON.stringify(mine)))
  })

  it('a clients slice row is narrowed to who and where before anything reads it', () => {
    const who = clientIdentityRow(CLIENT_ROWS[0])
    assert.deepEqual(Object.keys(who).sort(), ['avatar', 'client_id', 'client_key', 'house', 'isp_year', 'name', 'status'])
    assert.equal(who.name, 'Kay Test')
    assert.ok(!/secret|private|555/.test(JSON.stringify(CLIENT_ROWS.map(clientIdentityRow))))
    assert.equal(clientIdentityRow(CLIENT_ROWS[3]).client_key, 'mophoto')
  })

  it('Incidents: the uiIncidents rows joined to the client, with the pack\'s own review part, are '
    + 'clientProfileIncidents\' own answer', () => {
    const part = (GS.cpReviewsDoor_({ client: 'kay_test' }) as { status: number; data: unknown })
    assert.equal(part.status, 200)
    const reviews = reviewsOf(part.data)
    assert.ok(reviews)
    const mine = incidentsFrom(INCIDENTS, clientIdentityRow(CLIENT_ROWS[0]), reviews ?? {})
    same(mine, GS.cpScrub_(GS.cpIncidentsBuild_(GS.clientProfilesClient_('kay_test'))))
    const rows = clientIncidentsOf(mine).rows
    assert.deepEqual(rows.map((r) => `${r.id}:${r.status}:${r.house_code}`), ['r3:Reported:ZZ9999', 'r2:Closed:ZZ9999'])
    assert.deepEqual(rows[1].employees_involved, ['Ann Staff', 'Bo Staff', 'Cy Staff'])
    assert.equal(rows[1].categories.length, 2)
    assert.equal(rows[1].incident_reported_date, '2026-09-10')
    assert.match(rows[1].summary_of_incident, /Ref \[withheld\] typed/)
    assert.ok(!JSON.stringify(mine).includes('not a column'))
    const lee = incidentsFrom(INCIDENTS, clientIdentityRow(CLIENT_ROWS[1]), {})
    GS.cpOwnRows_ = () => []
    same(lee, GS.cpScrub_(GS.cpIncidentsBuild_(GS.clientProfilesClient_('lee_other'))))
    GS.cpOwnRows_ = (tab: unknown) => (tab === GS.CP_REVIEWS_TAB ? JSON.parse(JSON.stringify(REVIEW_ROWS)) : [])
    assert.equal(clientIncidentsOf(lee).rows[0].house_code, 'QQ1000', 'a label\'s trailing code')
  })

  it('the last guard is cpScrub_ itself', () => {
    const sample = { a: 'SSN 900114544 here', b: 'card 4000123412344812', c: '900-11-4544', d: '(330) 555-0101',
      m: '112233445566', id: 'keep900114544id', n: 123456789, list: ['x 900114544'], file_id: '900114544' }
    same(scrubAnswer(sample), GS.cpScrub_(sample))
  })
})

/* ---------- the reads, answered at fetch ---------- */

const SOURCE_AT = '2026-09-28T21:51:21Z'
const PACK_AT = '2026-09-28T22:00:00Z'
const PARTS = ['details', 'care_plans', 'care_team', 'care_daily', 'care_health', 'care_goals', 'care_home', 'meds', 'reviews',
  'activity', 'appointments', 'transport', 'mar', 'refills', 'funds', 'billing']

type Seen = { url: string; action?: string; payload?: Record<string, unknown>; line?: string }

describe('the reads, in lane order', () => {
  const realFetch = globalThis.fetch
  let seen: Seen[] = []
  let slices: Record<string, unknown[] | null> = {}
  let readAge = 1
  let door: (key: string, q: Record<string, string>) => { status: number; reason?: string; data?: unknown } = () => ({ status: 404 })
  let gas: (action: string) => unknown = () => ({})
  let gates: Promise<unknown>[] = []

  const pack = (key: string, over: Record<string, unknown> = {}) => {
    const parts: Record<string, unknown> = {
      details: { client: { client_key: key, name: 'Kay Test' }, identity: { ssn_last4: '4544', ssn_on_file: true } },
      meds: { tab: 'meds', rows: [{ id: '7', record: 'Med A', status: 'Active' }], statuses: ['Active'] },
      reviews: { client_key: key, reviews: { [`${key}|2026-09-10T14:00:00.000Z`]: { status: 'Closed', by: 'boss@example.org',
        at: '2026-09-11T10:00:00Z' } }, statuses: ['Reported', 'Under review', 'Closed'] },
      activity: { rows: [{ id: 'a1', kind: 'visit', record: 'Dr Who', date: '2026-09-30' }], total: 1 },
      appointments: { client: { client_key: key }, tabs: { visits: { rows: [] }, doctors: { rows: [] } }, from: 'pack' },
      transport: { client: { client_key: key }, today: ohioToday(), date: ohioToday(), tabs: {}, from: 'pack' },
      // Python's part says when the MARS lane listed the drive; a part without it is read from the door instead
      mar: { client: { client_key: key }, tabs: { papers: { rows: [], swept_at: '' } }, from: 'pack' },
      refills: { client: key, tabs: {}, from: 'pack' },
      funds: { client: { client_key: key }, tabs: {}, from: 'pack' },
      billing: { client: { client_key: key }, tabs: {}, from: 'pack' },
    }
    for (const t of ['plans', 'team', 'daily', 'health', 'goals', 'home']) parts[`care_${t}`] = { tab: t, rows: [], from: 'pack' }
    return {
      status: 200,
      data: { client: key, built_at: PACK_AT, state: 'fresh', age_s: readAge, read_age_s: readAge, parts,
        part_status: Object.fromEntries(PARTS.map((p) => [p, { status: 200 }])), ...over },
    }
  }

  before(() => {
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      const url = String(input)
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
      if (url.startsWith('/snapshot/')) {
        seen.push({ url })
        const name = url.slice('/snapshot/'.length).replace(/\.json$/, '')
        if (name === 'index') {
          return json({ slices: Object.fromEntries(Object.keys(slices).filter((k) => slices[k]).map((k) => [k, { built_at: SOURCE_AT }])) })
        }
        const rows = slices[name]
        return rows ? json({ resource: name, built_at: SOURCE_AT, source_at: SOURCE_AT, rows }) : new Response('no', { status: 404 })
      }
      if (url.startsWith('/erp-lanes/app-pack/')) {
        const q = Object.fromEntries(new URL(url, 'http://x').searchParams)
        const key = decodeURIComponent(new Headers(init?.headers).get('X-App-Pack-Key') ?? '')
        seen.push({ url: `pack:${key}`, payload: q, line: url })
        const gate = gates.shift()
        if (gate) await gate
        return json(door(key, q))
      }
      const body = typeof init?.body === 'string' ? init.body : ''
      const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload: Record<string, unknown> }
      seen.push({ url: 'gas', action: env.action, payload: env.payload })
      const data = gas(env.action)
      return json(data instanceof Error ? { status: 404, message: data.message } : { status: 200, data })
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })
  beforeEach(() => {
    seen = []
    slices = { clients: CLIENT_ROWS, photos: PHOTOS, uiIncidents: INCIDENTS }
    readAge = 1
    door = (key) => pack(key)
    gas = (action) => ({ from: 'action', action })
    gates = []
    forgetSnapshot()
    forgetClientReads()
    forgetTransportReads()
    forgetPack()
    useMemberStore.setState({ currentMemberId: '' } as never)
  })
  afterEach(async () => {
    // a neighbour's prefetch waits for an idle moment: let what waits drop, and its turn end, before the next case
    await new Promise((r) => setTimeout(r, 100))
    forgetPack()
    await new Promise((r) => setTimeout(r, PREFETCH_GAP_MS + 400))
  })

  const gasCalls = () => seen.filter((s) => s.url === 'gas').map((s) => [s.action, s.payload])
  const packAsks = () => seen.filter((s) => s.url.startsWith('pack:')).map((s) => s.url.slice(5))
  const from = (raw: unknown) => (raw as { from?: string } | null)?.from ?? ''

  it('the switcher\'s roster comes from the slices: no execution, the slice\'s own stamp; Show Inactive reads the '
    + 'action', async () => {
    const roster = await readRoster(false)
    assert.deepEqual(gasCalls(), [])
    assert.deepEqual(packAsks(), [])
    same(roster, rosterFrom(CLIENT_ROWS, PHOTOS))
    assert.ok(Math.abs(Date.parse(clientAnswerAt(roster)) - Date.parse(SOURCE_AT)) < 2_000, clientAnswerAt(roster))
    await readRoster(true)
    assert.deepEqual(gasCalls(), [['clientProfileRoster', { show_inactive: true }]])
  })

  it('a clients slice that is not on the shelf, or empty, sends the roster to its action', async () => {
    slices.clients = []
    await readRoster(false)
    slices.clients = null
    forgetSnapshot()
    await readRoster(false)
    assert.deepEqual(gasCalls(), [['clientProfileRoster', {}], ['clientProfileRoster', {}]])
  })

  it('every private section shares one pack request from the relay, each answered with its part and stamped with '
    + 'the pack\'s build', async () => {
    const k = 'kay_test'
    const answers = await Promise.all([readDetails(k), readCare(k, 'plans'), readCare(k, 'team'), readCare(k, 'home'),
      readMeds(k), readActivity(k), readAppointments(k), readTransport(k), readMar(k), readRefillForms(k), readFunds(k),
      readBilling(k)])
    assert.deepEqual(packAsks(), [k], 'one pack request for twelve reads')
    assert.deepEqual(gasCalls(), [])
    assert.equal((answers[0] as { identity: { ssn_last4: string } }).identity.ssn_last4, '4544')
    assert.deepEqual(answers.slice(1, 4).map((a) => (a as { tab: string }).tab), ['plans', 'team', 'home'])
    assert.deepEqual(answers.slice(6).map(from), ['pack', 'pack', 'pack', 'pack', 'pack', 'pack'])
    assert.deepEqual([...new Set(answers.map(clientAnswerAt))], [PACK_AT])
    await readMeds(k)
    assert.equal(packAsks().length, 1, 'a held pack answers within its fresh window')
  })

  it('Incidents: the reports from the slice and the statuses from the pack — no execution', async () => {
    const answer = await readIncidents('kay_test')
    assert.deepEqual(gasCalls(), [])
    const rows = clientIncidentsOf(answer).rows
    assert.deepEqual(rows.map((r) => `${r.id}:${r.status}`), ['r3:Reported', 'r2:Closed'])
    assert.ok(!/not a column|900114544/.test(JSON.stringify(answer)))
    assert.equal(clientAnswerAt(answer).slice(0, 13), SOURCE_AT.slice(0, 13), 'the older of the slice and the pack')
  })

  it('Incidents read their action when the review statuses, the reports or the client are not there', async () => {
    door = (key) => pack(key, { part_status: { ...Object.fromEntries(PARTS.map((p) => [p, { status: 200 }])),
      reviews: { status: 503, message: 'closed' } } })
    await readIncidents('kay_test')
    door = (key) => pack(key)
    forgetPack()
    slices.uiIncidents = null
    forgetSnapshot()
    await readIncidents('kay_test')
    slices.uiIncidents = INCIDENTS
    forgetSnapshot()
    await readIncidents('ann_archive_only')
    assert.deepEqual(gasCalls(), [['clientProfileIncidents', { client: 'kay_test' }], ['clientProfileIncidents', { client: 'kay_test' }],
      ['clientProfileIncidents', { client: 'ann_archive_only' }]])
  })

  it('a part the pack could not read sends only that section to its own action', async () => {
    door = (key) => pack(key, { part_status: { ...Object.fromEntries(PARTS.map((p) => [p, { status: 200 }])),
      mar: { status: 503, message: 'This part could not be read just now (papers closed).' } } })
    const [mar, funds] = await Promise.all([readMar('kay_test'), readFunds('kay_test')])
    assert.deepEqual(gasCalls(), [['clientSourceMar', { client: 'kay_test' }]])
    assert.deepEqual([from(mar), from(funds)], ['action', 'pack'])
  })

  it('Transportation: the pack answers today only; another day\'s part, or a day picked, reads the door', async () => {
    const today = await readTransport('kay_test')
    assert.equal(from(today), 'pack')
    await readTransport('kay_test', '2026-10-01')
    const stale = pack('kay_test')
    ;(stale.data.parts as Record<string, Record<string, unknown>>).transport.today = '2020-01-01'
    door = () => stale
    forgetPack()
    await readTransport('kay_test')
    assert.deepEqual(gasCalls(), [['clientSourceTransport', { client: 'kay_test', date: '2026-10-01' }],
      ['clientSourceTransport', { client: 'kay_test' }]])
  })

  it('a door that says "not here" sends each section to its own action, and is not asked again for a while', async () => {
    door = () => ({ status: 404, reason: 'unknown' })
    await readDetails('kay_test')
    await readFunds('kay_test')
    await readIncidents('kay_test')
    assert.deepEqual(gasCalls().map(([a]) => a), ['clientProfileDetails', 'clientSourceFunds', 'clientProfileIncidents'])
    assert.deepEqual(packAsks(), ['kay_test'], 'the closed door is asked once')
  })

  it('after a client\'s pack lands, their neighbours in the switcher are asked for while the browser is idle', async () => {
    await readDetails('lee_other')
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(packAsks().length, 3, 'both neighbours at once: two prefetches at a time at most')
    await new Promise((r) => setTimeout(r, PREFETCH_GAP_MS + 400))
    assert.deepEqual(packAsks().sort(), ['kay_test', 'lee_other', 'mophoto'], 'Kay and Mo sit either side of Lee')
    seen = []
    await readMeds('mophoto')
    assert.deepEqual(packAsks(), [], 'the prefetched client opens from memory')
  })

  it('a client the switcher points at is asked for while the browser is idle, once', async () => {
    prefetchClient('lee_other')
    prefetchClient(' lee_other ')
    assert.deepEqual(packAsks(), [], 'nothing is asked before the browser is idle')
    await new Promise((r) => setTimeout(r, 400))
    assert.deepEqual(packAsks(), ['lee_other'])
    assert.ok(peekPack(CLIENTS_PACK, 'lee_other'))
    const src = readFileSync(resolve(ROOT, 'src/pages/features/clientprofiles/ClientSwitcher.tsx'), 'utf8')
    assert.match(src, /onPointerEnter=\{\(\) => prefetchClient\(c\.client_key\)\} onFocus=\{\(\) => prefetchClient\(c\.client_key\)\}/)
  })

  it('after this tab\'s own write the next read names it, and a pack the relay began reading before it is never '
    + 'drawn — the section reads its action until one read after it lands', async () => {
    await readMeds('kay_test')
    await new Promise((r) => setTimeout(r, 20))
    clientWritten('kay_test')
    readAge = 30
    const before = await readMeds('kay_test')
    const asked = seen.filter((s) => s.url === 'pack:kay_test')
    assert.equal(asked.length, 2)
    assert.equal(asked[0].payload?.written_ms, undefined)
    assert.ok(Number(asked[1].payload?.written_ms) > 0 && Number(asked[1].payload?.written_ms) < 5_000, JSON.stringify(asked[1]))
    assert.equal(from(before), 'action')
    assert.equal(peekPack(CLIENTS_PACK, 'kay_test'), null, 'a copy from before the write is not held')
    readAge = 0
    const afterIt = await readMeds('kay_test')
    assert.equal(clientAnswerAt(afterIt), PACK_AT, 'read after the write: drawn')
    assert.deepEqual(gasCalls().map(([a]) => a), ['clientProfileMeds'])
    await readActivity('lee_other')
    const lee = seen.filter((s) => s.url === 'pack:lee_other')
    assert.equal(lee[0].payload?.written_ms, undefined, 'another client\'s read names no write')
  })

  it('a write is stamped when it was sent: the next read names when it was sent and answered, and a pack the relay '
    + 'began reading after the send is drawn though the answer came later', async () => {
    await readMeds('kay_test')
    await new Promise((r) => setTimeout(r, 20))
    clientWritten('kay_test', Date.now() - 10_000)
    readAge = 5
    const got = await readMeds('kay_test')
    const asked = seen.filter((s) => s.url === 'pack:kay_test')
    assert.equal(asked.length, 2)
    const q = asked[1].payload ?? {}
    assert.ok(Number(q.written_ms) > 0 && Number(q.written_ms) < 5_000, JSON.stringify(q))
    assert.ok(Number(q.sent_ms) >= 10_000 && Number(q.sent_ms) < 15_000, JSON.stringify(q))
    assert.equal(q.wait, '0', 'the relay is reading it again: the read does not wait on it')
    assert.equal(clientAnswerAt(got), PACK_AT)
    assert.deepEqual(gasCalls(), [])
    readAge = 20
    clientWritten('kay_test', Date.now() - 10_000)
    const older = await readMeds('kay_test')
    assert.equal(from(older), 'action', 'read before the write was sent: not drawn')
  })

  it('a pack the relay is still gathering holds a section a few seconds, once: it reads its own action, and the next '
    + 'reads ask without waiting until the pack is drawn', async () => {
    door = () => ({ status: 503, reason: 'filling', message: 'still' })
    const waits = () => seen.filter((s) => s.url === 'pack:kay_test').map((s) => s.payload?.wait)
    const meds = await readMeds('kay_test')
    assert.equal(from(meds), 'action')
    assert.deepEqual(waits(), [String(CLIENT_PACK_WAIT_S)], 'asked once, waiting a few seconds')
    await readDetails('kay_test')
    assert.deepEqual(waits(), [String(CLIENT_PACK_WAIT_S), '0'], 'the relay is gathering it: asked without waiting')
    door = (key) => pack(key)
    const activity = await readActivity('kay_test')
    assert.equal(clientAnswerAt(activity), PACK_AT, 'drawn once it lands')
    assert.deepEqual(gasCalls().map(([a]) => a), ['clientProfileMeds', 'clientProfileDetails'])
    const realNow = Date.now
    Date.now = () => realNow() + PACK_FRESH_MS + 1_000
    try {
      await readCare('kay_test', 'plans')
    } finally {
      Date.now = realNow
    }
    const all = waits()
    assert.equal(all[all.length - 1], String(CLIENT_PACK_WAIT_S), 'once drawn, a read past fresh waits its few seconds again')
  })

  it('an archived client\'s sections never ask for a pack, and the switcher prefetches current clients alone, from '
    + 'the relay\'s memory', async () => {
    const meds = await readMeds('ann_archive')
    assert.equal(from(meds), 'action')
    assert.deepEqual(packAsks(), [])
    prefetchClient('ann_archive')
    await new Promise((r) => setTimeout(r, 400))
    assert.deepEqual(packAsks(), [], 'an archived client is not prefetched')
    prefetchClient('lee_other')
    await new Promise((r) => setTimeout(r, 400))
    const asked = seen.filter((s) => s.url === 'pack:lee_other')
    assert.equal(asked.length, 1)
    assert.equal(asked[0].payload?.peek, '1')
    assert.equal(asked[0].payload?.wait, undefined, 'a prefetch never waits on a fill')
  })

  it('a person\'s read never rides a prefetch: one that finds nothing held leaves the section its own ask', async () => {
    door = (key, q) => (q.peek === '1' ? { status: 503, reason: 'cold', message: 'not held' } : pack(key))
    let open!: (v?: unknown) => void
    gates = [new Promise((r) => { open = r })]
    prefetchClient('lee_other')
    await new Promise((r) => setTimeout(r, 350))
    const got = await readDetails('lee_other')
    open()
    assert.equal(clientAnswerAt(got), PACK_AT)
    assert.deepEqual(seen.filter((s) => s.url === 'pack:lee_other').map((s) => s.payload?.peek ?? 'person'), ['1', 'person'])
  })

  it('no client\'s key ever rides the address the access logs write: it goes in the X-App-Pack-Key header', async () => {
    await Promise.all([readDetails('kay_test'), readMeds('kay_test')])
    prefetchClient('lee_other')
    clientWritten('kay_test', Date.now() - 5_000)
    await readActivity('kay_test')
    await new Promise((r) => setTimeout(r, 400))
    const asks = seen.filter((s) => s.url.startsWith('pack:'))
    assert.ok(asks.length >= 3, JSON.stringify(asks))
    for (const a of asks) {
      assert.match(a.line ?? '', /^\/erp-lanes\/app-pack\/client-profiles(\?[a-z_]+=[0-9.]+(&[a-z_]+=[0-9.]+)*)?$/, a.line)
      assert.ok(!/kay|lee|mo|key=/i.test((a.line ?? '').replace('/erp-lanes/app-pack/client-profiles', '')), a.line)
    }
    assert.deepEqual([...new Set(asks.map((a) => a.url.slice(5)))].sort(), ['kay_test', 'lee_other'])
  })

  it('a Clients write marks no Locations pack: the client\'s sources on the Locations hook read again, and a house '
    + 'read under the client\'s key names no write and is not taken for one being gathered', async () => {
    const key = locationKey('clientSourceFunds', 'kay_test')
    const kays = () => packAsks().filter((k) => k === 'kay_test').length
    const h = mountHook(() => useLocationRead(key, () => readFunds('kay_test'), (raw) => raw), {})
    await h.settle(() => h.current.status === 'ready')
    assert.equal(kays(), 1)
    h.run(() => clientWritten('kay_test', Date.now() - 5_000))
    await h.settle(() => kays() === 2 && h.current.status === 'ready' && !h.current.refreshing)
    assert.equal(kays(), 2, 'the funds read again after the write')
    assert.equal(from(h.current.data), 'pack')
    h.unmount()
    await readPack('locations', 'KAY_TEST', { waitS: CLIENT_PACK_WAIT_S })
    const house = seen.filter((s) => (s.line ?? '').startsWith('/erp-lanes/app-pack/locations'))
    assert.equal(house.length, 1)
    assert.equal(house[0].payload?.written_ms, undefined, 'no Locations write is named for a client')
    assert.equal(house[0].payload?.wait, String(CLIENT_PACK_WAIT_S), 'and none is marked as being gathered')
  })

  it('inside a visit, a tenant or a world no pack and no slice is asked for: each section reads its own action', async () => {
    const home = useTenantStore.getState()
    const places: [string, () => void, () => void][] = [
      ['visit', () => useMemberStore.setState({ currentMemberId: 'mem_1' } as never),
        () => useMemberStore.setState({ currentMemberId: '' } as never)],
      ['tenant', () => useTenantStore.setState({ currentTenantId: 'tn_akron', homeTenantId: 'tn_hq', tenantsLoaded: true } as never),
        () => useTenantStore.setState({ currentTenantId: home.currentTenantId, homeTenantId: home.homeTenantId,
          tenantsLoaded: home.tenantsLoaded } as never)],
      ['world', () => useWorldStore.setState({ currentWorldId: 'w_1' } as never),
        () => useWorldStore.setState({ currentWorldId: '' } as never)],
    ]
    for (const [where, enter, leave] of places) {
      seen = []
      enter()
      try {
        assert.equal(await readPack(CLIENTS_PACK, 'kay_test'), null)
        const answers = [await readRoster(false), await readDetails('kay_test'), await readIncidents('kay_test'),
          await readFunds('kay_test')]
        assert.deepEqual(answers.map(from), ['action', 'action', 'action', 'action'], where)
        assert.deepEqual(answers.map(clientAnswerAt), ['', '', '', ''], `${where}: nothing stamped by a slice or a pack`)
        prefetchClient('lee_other')
        await new Promise((r) => setTimeout(r, 400))
        assert.deepEqual(seen.filter((s) => s.url !== 'gas'), [], `${where}: no slice and no pack is asked for`)
      } finally {
        leave()
      }
    }
  })

  it('a change of account drops every held answer and pack; the section reads again, and nothing is written to '
    + 'storage', async () => {
    useAuthStore.setState({ user: { id: 'u-a' }, token: 'tok-a' } as never)
    const key = readKey('clientProfileDetails', 'kay_test')
    const a = mountHook(() => useClientRead(key, () => readDetails('kay_test'), (raw) => raw), {})
    await a.settle(() => a.current.status === 'ready')
    assert.equal(a.current.updatedAt, PACK_AT)
    a.unmount()
    assert.ok(peekPack(CLIENTS_PACK, 'kay_test'))
    const dump = (s: Storage) => Array.from({ length: s.length }, (_, i) => `${s.key(i)}=${s.getItem(s.key(i) ?? '')}`).join('\n')
    const stored = `${dump(localStorage)}\n${dump(sessionStorage)}`
    assert.ok(!/4544|Med A|Dr Who|app-pack|Closed/.test(stored), stored)
    useAuthStore.setState({ user: { id: 'u-b' }, token: 'tok-b' } as never)
    assert.equal(peekPack(CLIENTS_PACK, 'kay_test'), null)
    const b = mountHook(() => useClientRead(key, () => readDetails('kay_test'), (raw) => raw), {})
    assert.equal(b.current.status, 'loading', 'the answer held for the first account is not drawn for the next')
    await b.settle(() => b.current.status === 'ready')
    b.unmount()
    assert.equal(packAsks().filter((k) => k === 'kay_test').length, 2)
    useAuthStore.setState({ user: null, token: null } as never)
  })

  it('an answer asked for before a change of account is never drawn after it', async () => {
    let openFirst!: (v?: unknown) => void
    let openSecond!: (v?: unknown) => void
    gates = [new Promise((r) => { openFirst = r }), new Promise((r) => { openSecond = r })]
    let asked = 0
    door = (key) => {
      asked++
      const said = pack(key)
      if (asked > 1) (said.data.parts as Record<string, unknown>).meds = { tab: 'meds', rows: [], statuses: [] }
      return said
    }
    useAuthStore.setState({ user: { id: 'u-a' }, token: 'tok-a' } as never)
    const key = readKey('clientProfileMeds', 'kay_test', 'meds')
    const a = mountHook(() => useClientRead(key, () => readMeds('kay_test'), (raw) => raw as { rows: unknown[] }), {})
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(a.current.status, 'loading')
    a.run(() => useAuthStore.setState({ user: { id: 'u-b' }, token: 'tok-b' } as never))
    await new Promise((r) => setTimeout(r, 30))
    openFirst()
    await new Promise((r) => setTimeout(r, 60))
    assert.notEqual(a.current.status, 'ready', 'the first account\'s answer is not drawn for the second')
    openSecond()
    await a.settle(() => a.current.status === 'ready')
    assert.equal(a.current.data?.rows.length, 0, 'the answer drawn is the one read for the second account')
    a.unmount()
    useAuthStore.setState({ user: null, token: null } as never)
  })

  it('Transportation\'s own hold is dropped at a memory boundary and read again for the next account', async () => {
    useAuthStore.setState({ user: { id: 'u-a' }, token: 'tok-a' } as never)
    const kays = () => packAsks().filter((k) => k === 'kay_test').length
    const h = mountHook(() => useTransportRead('kay_test', ''), {})
    await h.settle(() => h.current.status === 'ready')
    assert.equal(kays(), 1)
    assert.equal((h.current.data as { client?: { client_key?: string } } | null)?.client?.client_key, 'kay_test')
    h.run(() => useAuthStore.setState({ user: { id: 'u-b' }, token: 'tok-b' } as never))
    await h.settle(() => kays() === 2 && h.current.status === 'ready')
    assert.equal(kays(), 2, 'read again after the crossing')
    h.unmount()
    useAuthStore.setState({ user: null, token: null } as never)
  })

  it('a plan opened again is answered from memory; a write for the client and a change of account read it again', async () => {
    gas = () => ({ id: 'ispdoc000001', name: 'Plan', mime: 'application/pdf', size: 3, exported: false, b64: 'JVBE' })
    await readDocFile('kay_test', 'ispdoc000001')
    await readDocFile('kay_test', 'ispdoc000001')
    assert.equal(gasCalls().length, 1)
    clientWritten('kay_test')
    await readDocFile('kay_test', 'ispdoc000001')
    assert.equal(gasCalls().length, 2, 'the client\'s write drops their documents')
    useAuthStore.setState({ user: { id: 'u-c' }, token: 'tok-c' } as never)
    await readDocFile('kay_test', 'ispdoc000001')
    assert.equal(gasCalls().length, 3, 'another account reads it again')
    assert.deepEqual(gasCalls()[0], ['clientProfileDocFile', { client: 'kay_test', file_id: 'ispdoc000001' }])
    useAuthStore.setState({ user: null, token: null } as never)
  })

  it('the section draws the held answer at once and reads behind it once it is stale, saying so, with its age', async () => {
    const key = readKey('clientProfileActivity', 'kay_test')
    const a = mountHook(() => useClientRead(key, () => readActivity('kay_test'), (raw) => raw), {})
    await a.settle(() => a.current.status === 'ready')
    assert.equal(a.current.updatedAt, PACK_AT)
    assert.equal(a.current.refreshing, false)
    a.unmount()
    const realNow = Date.now
    Date.now = () => realNow() + PACK_FRESH_MS + 1_000
    try {
      const b = mountHook(() => useClientRead(key, () => readActivity('kay_test'), (raw) => raw), {})
      assert.equal(b.current.status, 'ready', 'the held answer is drawn at once')
      assert.equal(b.current.refreshing, true)
      await b.settle(() => b.current.refreshing === false)
      assert.equal(packAsks().filter((k) => k === 'kay_test').length, 2, 'read again behind what was drawn')
      b.unmount()
    } finally {
      Date.now = realNow
    }
  })
})
