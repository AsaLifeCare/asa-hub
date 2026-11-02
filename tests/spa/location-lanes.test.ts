/**
 * LOCATIONS · where each section is read: the slices first (House Repairs, Incidents and the Documents list computed
 * here, the Apps Script rules ported and held to the .gs itself), then the relay's pack (Overview, Staff, Notes,
 * Supplies, the guidebook), then the section's own action — and the pack held in memory, shared by the sections,
 * refreshed behind what is drawn, prefetched for the neighbours and forgotten by a write.
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
import { forgetSnapshot, placeLoad, seededPlace } from '@/lib/snapshotClient'
import { PACK_FRESH_MS, PREFETCH_GAP_MS, forgetPack, peekPack, readPack } from '@/lib/appPack'
import type { HouseRow } from '@/pages/features/houses/houseModel'
import { documentsOf, incidentsOf, repairsOf } from '@/pages/features/locations/locationModel'
import {
  addrIndex, addrOwner, clientIdentity, clientsAt, documentsAnswer, incidentsFor, ispsFrom, repairsAnswer, repairsFor,
  updatedWords,
} from '@/pages/features/locations/locationLanes'
import { answerAt, forgetDocs, prefetchLocation } from '@/pages/features/locations/locationReads'
import {
  forgetLocationReads, locationWritten, readDocFile, readDocuments, readIncidents, readKey, readNotes, readOverview,
  readRepairs, readStaff, readSupplies, useLocationRead,
} from '@/pages/features/locations/useLocation'
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

const GS = vm.createContext({ HUB_POLICY: {}, HUB_ACTIONS: {} }) as Record<string, (...a: unknown[]) => unknown>
vm.runInContext(readFileSync(resolve(ROOT, 'apps-script/Locations.gs'), 'utf8'), GS)
vm.runInContext(gsFunction('Main.gs', 'hubAddrKey_') + '\n' + gsFunction('Clients.gs', 'clientNameKey_'), GS)
const same = (a: unknown, b: unknown) => assert.equal(JSON.stringify(a), JSON.stringify(b))

/* ---------- the fixtures (SelfTestLocations.gs's own) ---------- */

const HOMES = [
  { code: 'ZE4048', address: '4048 Orchard Dale Dr NW, Apt A, Canton, OH 44709' },
  { code: 'ZAB2704', address: '2704 Harrison Ave NW, Canton, OH 44709' },
  { code: 'ZB4060', address: '4060 Orchard Dale Dr NW, Apt B, Canton, OH 44709' },
  { code: 'ZM4060', address: '4060 Orchard Dale Dr NW, Apt A, Canton, OH 44709' },
]
const PLACED = [{ house: 'ZL4048', home_address: '4048 Orchard Dale Dr NW Apt B, Canton, OH' }]
const REPAIRS = [
  { id: 'r2', select_address_vehicle: '4048 Orchard Dale Dr NW, Apt A, Canton, OH 44709', status: '', timestamp: '2026-09-01T10:00:00Z' },
  { id: 'r3', select_address_vehicle: '4048 Orchard Dale Apt B', status: '', timestamp: '2026-09-02T10:00:00Z' },
  { id: 'r4', select_address_vehicle: '4048 Orchard Dale (request maintenance)', status: '', timestamp: '2026-09-03T10:00:00Z' },
  { id: 'r5', select_address_vehicle: 'ALL', status: 'Completed', timestamp: '2026-08-01T10:00:00Z' },
  { id: 'r6', select_address_vehicle: '4048 Orchard Dale Apt A', status: 'Cancelled', timestamp: '2026-08-02T10:00:00Z' },
  { id: 'r7', select_address_vehicle: '2704 Harrison (request maintenance)', status: 'In Progress', timestamp: '2026-09-04T10:00:00Z',
    repair_type: 'Plumbing', urgency_level: '4', please_describe_the_issue: 'Sink' },
  { id: 'r8', select_address_vehicle: '4060 Orchard Dale', status: 'canceled', timestamp: '2026-09-05T10:00:00Z' },
]
const INCIDENTS = [
  { id: 'r2', client_name: 'Kenny  Marsh', your_name: 'A B', incident_location: 'House',
    incident_category: 'Minor injury or illness (rash, bruise, small cut), Fall', incident_date: '2026-09-01T04:00:00.000Z',
    incident_time: '10:30', summary_of_incident: 'what happened', comments: 'not a column' },
  { id: 'r3', client_name: 'Other Person', incident_category: 'Fall', incident_date: '2026-09-09T04:00:00.000Z' },
  { id: 'r4', client_name: 'kenny marsh', incident_category: '["Fall"]', incident_date: '2026-09-05T04:00:00.000Z' },
]
const CLIENT_ROWS = [
  { client_key: 'kmarsh', name: 'Kenny Marsh', house: 'ZZ9999', home_address: '', status: 'active', medications: ['secret pill'],
    diagnoses_text: 'private', isp_doc_url: 'https://drive.google.com/file/d/ispKennyxxxx1/view', isp_doc_name: 'ISP Kenny', isp_year: '2026' },
  { client_key: 'noh', name: 'No House', house: '', home_address: '9999 Test Ave NW Apt B, Canton', status: '' },
  { client_key: 'other', name: 'Other Unit', house: '', home_address: '9999 Test Ave NW, Apt A', status: 'active' },
  { client_key: 'gone', name: 'Gone Client', house: 'ZZ9999', home_address: '', status: 'inactive' },
  { client_key: 'far', name: 'Far Away', house: 'QQ1000', home_address: '', status: 'active' },
  { name: 'Lia  Gomez', house: 'ZZ9999', home_address: '', status: 'active', guardian_phone: '555' },
]
const ZZ_ADDRESS = '9999 Test Ave NW, Apt B, Canton, OH'

describe('the rules, ported and held to the .gs', () => {
  const index = addrIndex(HOMES, PLACED)
  const gsIndex = GS.locationsAddrIndex_(HOMES, PLACED)

  it('the address index and its owner are the .gs\'s own, case by case', () => {
    same(index, gsIndex)
    for (const v of ['4048 Orchard Dale Apt B', '4060 Orchard Dale', '2704 Harrison', 'ALL', '', '4048 Orchard Dale Dr NW, Apt A',
      '# 12 Nowhere', '4060 Orchard Dale Dr NW Apt A']) {
      same(addrOwner(index, v), GS.locationsAddrOwner_(gsIndex, v))
    }
    assert.deepEqual(addrOwner(index, '4048 Orchard Dale Apt A'), { code: 'ZE4048', how: 'street_number' })
    assert.deepEqual(addrOwner(index, '4060 Orchard Dale'), { code: '', how: '' }, 'a number two houses share names nobody')
  })

  it('House Repairs: the exact street, the unique number, ALL everywhere — the .gs answer, row for row', () => {
    for (const code of ['ZE4048', 'ZAB2704', 'ZB4060', 'ZL4048']) same(repairsFor(REPAIRS, code, index), GS.locationsRepairsFor_(REPAIRS, code, gsIndex))
    const ec = repairsFor(REPAIRS, 'ZE4048', index)
    assert.deepEqual(ec.map((r) => `${r.id}:${r.match}:${r.resolved}`), ['r2:exact:false', 'r6:street_number:true', 'r5:all:true'])
    const open = repairsAnswer('ZE4048', ec, false)
    assert.deepEqual([open.rows.map((r) => r.id), open.open_count, open.resolved_count], [['r2'], 1, 2])
    assert.equal(repairsAnswer('ZE4048', ec, true).rows.length, 3)
    assert.deepEqual(repairsOf(open).map((r) => [r.id, r.match, r.wholeEstate]), [['r2', 'exact', false]])
  })

  it('Incidents: joined by the folded name to the current clients, newest first, the full row whitelisted', () => {
    const clients = [{ client_key: 'kmarsh', name: 'Kenny Marsh' }]
    same(incidentsFor(INCIDENTS, clients), GS.locationsIncidentsFor_(INCIDENTS, clients))
    const rows = incidentsFor(INCIDENTS, clients)
    assert.deepEqual(rows.map((r) => r.id), ['r4', 'r2'])
    assert.ok(!('comments' in rows[1].row))
    assert.deepEqual(incidentsOf({ rows }).map((r) => r.categories.length), [1, 2])
  })

  it('the current clients of a house: its code, else the registry street and unit exactly; never inactive', () => {
    const ids = CLIENT_ROWS.map(clientIdentity)
    const home = { code: 'ZZ9999', address: ZZ_ADDRESS }
    const gs = GS.locationsClientsAt_('ZZ9999', home, CLIENT_ROWS.map((c) => ({ ...c, client_key: c.client_key ?? '' }))) as { client_key: string }[]
    assert.deepEqual(clientsAt('ZZ9999', ZZ_ADDRESS, ids).map((c) => c.client_key), ['kmarsh', 'noh', 'liagomez'])
    assert.deepEqual(gs.map((c) => c.client_key || 'liagomez'), ['kmarsh', 'noh', 'liagomez'])
  })

  it('a clients slice row is narrowed to who and where — no medication, diagnosis or contact survives', () => {
    const narrowed = CLIENT_ROWS.map(clientIdentity)
    assert.deepEqual(Object.keys(narrowed[0]).sort(),
      ['client_key', 'home_address', 'house', 'isp_doc_name', 'isp_doc_url', 'isp_year', 'name', 'status'])
    assert.ok(!/secret|private|555/.test(JSON.stringify(narrowed)))
    assert.equal(narrowed[5].client_key, 'liagomez')
    assert.equal(narrowed[5].name, 'Lia Gomez')
  })

  it('Documents: the ISPs from the clients slice, the policies from the houses slice, the guidebook from the pack', () => {
    const current = clientsAt('ZZ9999', ZZ_ADDRESS, CLIENT_ROWS.map(clientIdentity))
    const isps = ispsFrom(current)
    assert.deepEqual(isps.map((x) => [x.client, x.isp_doc_id]), [['Kenny Marsh', 'ispKennyxxxx1'], ['Lia Gomez', ''], ['No House', '']])
    const answer = documentsAnswer({ code: 'ZZ9999', policies: [{ title: 'Company Policies', url: 'https://drive.google.com/file/d/policyxxxxx1/view', audience: 'all' }] },
      current, { guidebook: { folder_name: 'ZZ9999', files: [{ id: 'guidexxxxxx1', name: 'Guide', guide: true }] }, guidebook_why: '' })
    const docs = documentsOf(answer)
    assert.deepEqual(docs.policies, [{ title: 'Company Policies', fileId: 'policyxxxxx1' }])
    assert.deepEqual(docs.isps[0], { client: 'Kenny Marsh', fileId: 'ispKennyxxxx1', name: 'ISP Kenny', year: '2026' })
    assert.equal(docs.guidebook?.files[0].id, 'guidexxxxxx1')
    assert.equal(docs.why, '')
    assert.equal(answer.degraded, false)
  })

  it('Documents: a policies tab the houses slice could not read says so — never an empty list with no reason', () => {
    const answer = documentsAnswer({ code: 'ZZ9999', policies: [], sources: [
      { key: 'registry', label: 'Client entities', state: 'fresh' },
      { key: 'policies', label: 'Common Data R3.1 · Company Policies', state: 'unreadable', why: 'could not be read (KeyError)' },
    ] }, [], { guidebook: null, guidebook_why: '' })
    assert.equal(answer.policies_why, 'the company policies could not be read (KeyError)')
    assert.equal(answer.degraded, true)
    assert.equal(documentsOf(answer).why, answer.policies_why)
    const missing = documentsAnswer({ code: 'ZZ9999', policies: [], sources: [
      { key: 'policies', label: 'Common Data R3.1 · Company Policies', state: 'unreadable', why: 'the master JSON holds no copy of its book' },
    ] }, [], { guidebook: null })
    assert.equal(missing.policies_why, 'the company policies could not be read (the master JSON holds no copy of its book)')
    const stale = documentsAnswer({ code: 'ZZ9999', policies: [], sources: [
      { key: 'policies', label: 'Common Data R3.1 · Company Policies', state: 'stale', why: 'older than an hour' },
    ] }, [], { guidebook: null })
    assert.equal(stale.policies_why, '')
  })

  it('the age line reads as words', () => {
    const now = Date.parse('2026-09-28T12:00:00Z')
    assert.equal(updatedWords('2026-09-28T11:59:30Z', now), 'just now')
    assert.equal(updatedWords('2026-09-28T11:55:00Z', now), '5 min ago')
    assert.equal(updatedWords('2026-09-28T09:00:00Z', now), '3 h ago')
    assert.equal(updatedWords('', now), '')
    assert.equal(updatedWords('not a day', now), '')
  })
})

/* ---------- the reads, answered at fetch ---------- */

function houseRow(code: string, title: string, address: string, active = true): HouseRow {
  return {
    id: code, code, label: code, title, city: 'Canton', active, address, photo: { src: '', source: '' }, managers: [], leads: [],
    clients: [], client_count: 0, staff: [], staff_source: '', week_notes: [], sources: [],
    policies: [{ title: 'Company Policies', url: 'https://drive.google.com/file/d/policyxxxxx1/view', audience: 'all' }],
  }
}
const HOUSES = [houseRow('ZE4048', 'Apple', HOMES[0].address), houseRow('ZAB2704', 'Birch', HOMES[1].address),
  houseRow('ZZ9999', 'Cedar', ZZ_ADDRESS), houseRow('ZB4060', 'Dogwood', HOMES[2].address), houseRow('QQ1000', 'Elm', '', false)]
const SOURCE_AT = '2026-09-28T21:51:21Z'
const PACK_AT = '2026-09-28T22:00:00Z'

type Seen = { url: string; action?: string; payload?: Record<string, unknown> }

describe('the reads, in lane order', () => {
  const realFetch = globalThis.fetch
  let seen: Seen[] = []
  let slices: Record<string, unknown[] | null> = {}
  // a place's own bundle (/snapshot/place?…), by its URL
  let placed: Record<string, Record<string, unknown[]>> = {}
  let door: (key: string) => { status: number; reason?: string; data?: unknown } | Response = () => ({ status: 404, message: 'Unknown lane.' } as never)
  let gas: (action: string) => unknown = () => ({})
  // each pack request in turn waits for the next of these, when there is one
  let gates: Promise<unknown>[] = []
  // every slice request waits for this, when there is one
  let sliceGate: Promise<unknown> | null = null
  // every action request waits for this, when there is one
  let gasGate: Promise<unknown> | null = null

  const pack =(key: string, over: Record<string, unknown> = {}) => ({
    status: 200,
    data: {
      house: key, built_at: PACK_AT, state: 'fresh', age_s: 1,
      parts: {
        overview: { house: { code: key, phone: '330-555-0100' }, manager: { name: 'Hank Manager', phone: '' }, managers: [] },
        staff: { house: key, clients: [], staff: [{ name: 'Ann Lee', first_day: '2025-01-06', last_day: '2026-09-20', sources: ['archive'] }] },
        notes: { house: key, notes: [{ id: 'HN_1', details: 'Back door', state: 'open', at: '2026-09-27' }] },
        supplies: { house: key, consumables: [], assets: [], ledger_ready: false },
        guidebook: { house: key, guidebook: { folder_name: key, files: [{ id: 'guidexxxxxx1', name: 'Guide', guide: true }] }, guidebook_why: '' },
      },
      part_status: { overview: { status: 200 }, staff: { status: 200 }, notes: { status: 200 }, supplies: { status: 200 }, guidebook: { status: 200 } },
      ...over,
    },
  })

  before(() => {
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      const url = String(input)
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
      if (url.startsWith('/snapshot/place')) {
        seen.push({ url })
        const bundle = placed[url]
        return bundle ? json({ slices: Object.fromEntries(Object.entries(bundle).map(([k, rows]) =>
          [k, { resource: k, built_at: SOURCE_AT, source_at: SOURCE_AT, rows }])) }) : new Response('no', { status: 404 })
      }
      if (url.startsWith('/snapshot/')) {
        seen.push({ url })
        if (sliceGate) await sliceGate
        const name = url.slice('/snapshot/'.length).replace(/\.json$/, '')
        if (name === 'index') {
          return json({ slices: Object.fromEntries(Object.keys(slices).filter((k) => slices[k]).map((k) => [k, { built_at: SOURCE_AT }])) })
        }
        const rows = slices[name]
        return rows ? json({ resource: name, built_at: SOURCE_AT, source_at: SOURCE_AT, rows }) : new Response('no', { status: 404 })
      }
      if (url.startsWith('/erp-lanes/app-pack/')) {
        // the key rides a header, never the address
        assert.equal(new URL(url, 'http://x').searchParams.get('key'), null)
        const key = decodeURIComponent(new Headers(init?.headers).get('X-App-Pack-Key') ?? '')
        seen.push({ url: `pack:${key}` })
        const gate = gates.shift()
        if (gate) await gate
        const said = door(key)
        return said instanceof Response ? said : json(said)
      }
      const body = typeof init?.body === 'string' ? init.body : ''
      const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload: Record<string, unknown> }
      seen.push({ url: 'gas', action: env.action, payload: env.payload })
      if (gasGate) await gasGate
      const data = gas(env.action)
      return json(data instanceof Error ? { status: 404, message: data.message } : { status: 200, data })
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })
  beforeEach(() => {
    seen = []
    slices = { houses: HOUSES, clients: CLIENT_ROWS, workOrders: REPAIRS, uiIncidents: INCIDENTS }
    placed = {}
    door = (key) => pack(key)
    gas = () => ({})
    gates = []
    sliceGate = null
    gasGate = null
    forgetSnapshot()
    forgetLocationReads()
    forgetPack()
    forgetDocs()
    useMemberStore.setState({ currentMemberId: '' } as never)
  })
  // a neighbour's prefetch waits for an idle moment: let it land before the next case counts requests
  afterEach(async () => {
    // the neighbours are queued behind the slice read; then what waits is dropped, and the turn it waited for ends
    // before the next case counts requests
    await new Promise((r) => setTimeout(r, 100))
    forgetPack()
    await new Promise((r) => setTimeout(r, PREFETCH_GAP_MS + 400))
  })

  const gasCalls = () => seen.filter((s) => s.url === 'gas').map((s) => [s.action, s.payload])
  const packAsks = () => seen.filter((s) => s.url.startsWith('pack:')).map((s) => s.url.slice(5))

  it('House Repairs and Incidents come from the slices: no execution, and the slice\'s own stamp', async () => {
    const repairs = await readRepairs('ZE4048', false)
    const incidents = await readIncidents('ZZ9999')
    assert.deepEqual(gasCalls(), [])
    assert.deepEqual(packAsks(), [])
    same(repairs, repairsAnswer('ZE4048', GS.locationsRepairsFor_(REPAIRS, 'ZE4048', GS.locationsAddrIndex_(
      HOUSES.map((h) => ({ code: h.code, address: h.address })), CLIENT_ROWS.map(clientIdentity))) as never, false))
    assert.deepEqual(incidentsOf(incidents).map((r) => r.id), ['r4', 'r2'])
    assert.ok(Math.abs(Date.parse(answerAt(repairs)) - Date.parse(SOURCE_AT)) < 2_000, answerAt(repairs))
    assert.ok(!/secret pill|private|555/.test(JSON.stringify(incidents)), 'no clinical field rides the answer')
  })

  it('a slice that is not on the shelf, or empty, sends that section to its own action — and only that one', async () => {
    slices.workOrders = []
    gas = (a) => (a === 'locationRepairs' ? { rows: [] } : {})
    await readRepairs('ZE4048', true)
    await readIncidents('ZZ9999')
    assert.deepEqual(gasCalls(), [['locationRepairs', { house: 'ZE4048', resolved: true }]])
    slices.uiIncidents = null
    forgetSnapshot()
    await readIncidents('ZZ9999')
    assert.deepEqual(gasCalls().slice(1), [['locationIncidents', { house: 'ZZ9999' }]])
  })

  it('Overview, Staff, Notes and Supplies share one pack request from the relay, stamped with its build', async () => {
    const [overview, staff, notes, supplies] = await Promise.all([readOverview('ZZ9999'), readStaff('ZZ9999'), readNotes('ZZ9999'),
      readSupplies('ZZ9999')])
    assert.deepEqual(packAsks().filter((k) => k === 'ZZ9999'), ['ZZ9999'], 'one pack request for four sections')
    assert.deepEqual(gasCalls(), [])
    assert.equal((overview as { manager: { name: string } }).manager.name, 'Hank Manager')
    assert.equal((staff as { staff: unknown[] }).staff.length, 1)
    assert.equal((notes as { notes: unknown[] }).notes.length, 1)
    assert.equal((supplies as { ledger_ready: boolean }).ledger_ready, false)
    assert.equal(answerAt(staff), PACK_AT)
    await readNotes('ZZ9999')
    assert.equal(packAsks().filter((k) => k === 'ZZ9999').length, 1, 'a held pack answers within its fresh window')
  })

  it('Documents: ISPs and policies from the slices, the guidebook from the pack — no execution', async () => {
    const docs = documentsOf(await readDocuments('ZZ9999'))
    assert.deepEqual(gasCalls(), [])
    assert.deepEqual(docs.isps.map((x) => [x.client, x.fileId]), [['Kenny Marsh', 'ispKennyxxxx1'], ['Lia Gomez', ''], ['No House', '']])
    assert.deepEqual(docs.policies, [{ title: 'Company Policies', fileId: 'policyxxxxx1' }])
    assert.equal(docs.guidebook?.files[0].id, 'guidexxxxxx1')
  })

  it('a door that says "not here" sends each section to its own action, and is not asked again for a while', async () => {
    door = () => ({ status: 404, reason: 'unknown', message: 'Unknown lane.' } as never)
    gas = () => ({ notes: [] })
    await readStaff('ZZ9999')
    await readNotes('ZZ9999')
    await readDocuments('ZZ9999')
    assert.deepEqual(gasCalls(), [['locationStaff', { house: 'ZZ9999' }], ['locationNotes', { house: 'ZZ9999' }],
      ['locationDocuments', { house: 'ZZ9999' }]])
    assert.deepEqual(packAsks(), ['ZZ9999'], 'the closed door is asked once')
  })

  it('an engine without the pack yet (503 unpublished) is taken the same way; a pack still filling is not', async () => {
    let asked = 0
    door = (key) => (++asked === 1 ? { status: 503, reason: 'filling', message: 'still' } as never : pack(key))
    const staff = await readStaff('ZZ9999')
    assert.deepEqual([packAsks(), gasCalls()], [['ZZ9999', 'ZZ9999'], []], 'filling: asked once more, and the fill answered')
    assert.equal(answerAt(staff), PACK_AT)
    // the neighbours' idle prefetch lands before the next count
    await new Promise((r) => setTimeout(r, 350))
    seen = []
    forgetPack()
    door = () => ({ status: 503, reason: 'filling', message: 'still' } as never)
    gas = () => ({ staff: [] })
    await readStaff('ZZ9999')
    assert.deepEqual([packAsks(), gasCalls()], [['ZZ9999', 'ZZ9999'], [['locationStaff', { house: 'ZZ9999' }]]],
      'still filling after the second ask: the section reads its own action')
    await readStaff('ZE4048')
    assert.equal(packAsks().length, 4, 'filling shuts nothing: the next house is asked')
    seen = []
    door = () => ({ status: 503, reason: 'unpublished', message: 'not yet' } as never)
    forgetPack()
    await readStaff('ZE4048')
    await readStaff('ZE4048')
    assert.equal(packAsks().length, 1, 'unpublished: the door rests')
  })

  it('the proxy\'s own page for a slow answer sends the section to its action and shuts nothing', async () => {
    door = () => new Response('<html>504 Gateway Time-out</html>', { status: 504, headers: { 'content-type': 'text/html' } })
    gas = () => ({ staff: [] })
    await readStaff('ZZ9999')
    assert.deepEqual(gasCalls(), [['locationStaff', { house: 'ZZ9999' }]])
    door = (key) => pack(key)
    const next = await readStaff('ZE4048')
    assert.equal(answerAt(next), PACK_AT)
  })

  it('a refusal about one house sends that house to its actions and shuts the door for no other', async () => {
    door = (key) => (key === 'ZZ9999' ? { status: 404, reason: 'refused', message: 'No house "ZZ9999" is on the registry.' } as never : pack(key))
    gas = () => ({ staff: [] })
    await readStaff('ZZ9999')
    assert.deepEqual(gasCalls(), [['locationStaff', { house: 'ZZ9999' }]])
    const other = await readStaff('ZE4048')
    assert.equal(answerAt(other), PACK_AT)
    assert.deepEqual(packAsks().filter((k) => k !== 'ZAB2704' && k !== 'ZB4060'), ['ZZ9999', 'ZE4048'])
  })

  it('a part the pack could not read sends only that section to its action', async () => {
    door = (key) => pack(key, { part_status: { overview: { status: 200 }, staff: { status: 200 }, notes: { status: 503, message: 'closed' },
      supplies: { status: 200 }, guidebook: { status: 200 } } })
    gas = () => ({ notes: [] })
    await readStaff('ZZ9999')
    await readNotes('ZZ9999')
    assert.deepEqual(gasCalls(), [['locationNotes', { house: 'ZZ9999' }]])
  })

  it('after a house\'s pack lands, its neighbours in the switcher are asked for while the browser is idle', async () => {
    await readStaff('ZZ9999')
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(packAsks().length, 3, 'both neighbours at once: two prefetches at a time at most')
    await new Promise((r) => setTimeout(r, PREFETCH_GAP_MS + 400))
    assert.deepEqual(packAsks().sort(), ['ZAB2704', 'ZB4060', 'ZZ9999'], 'Birch and Dogwood sit either side of Cedar')
    assert.ok(peekPack('locations', 'ZB4060'))
    seen = []
    await readStaff('ZB4060')
    assert.ok(!packAsks().includes('ZB4060'), 'the prefetched house opens from memory')
  })

  it('a house the switcher points at is asked for while the browser is idle, once', async () => {
    prefetchLocation('zb4060')
    prefetchLocation('ZB4060')
    assert.deepEqual(packAsks(), [], 'nothing is asked before the browser is idle')
    await new Promise((r) => setTimeout(r, 400))
    assert.deepEqual(packAsks(), ['ZB4060'])
    prefetchLocation('ZB4060')
    await new Promise((r) => setTimeout(r, 400))
    assert.deepEqual(packAsks(), ['ZB4060'], 'a held pack is not asked for again')
    const src = readFileSync(resolve(ROOT, 'src/pages/features/locations/HouseSwitcher.tsx'), 'utf8')
    assert.match(src, /onPointerEnter=\{\(\) => prefetchLocation\(h\.code\)\} onFocus=\{\(\) => prefetchLocation\(h\.code\)\}/)
  })

  it('a write for the house forgets its pack, so the next read asks the relay again', async () => {
    await readNotes('ZZ9999')
    locationWritten('ZZ9999')
    await readNotes('ZZ9999')
    assert.equal(packAsks().filter((k) => k === 'ZZ9999').length, 2)
  })

  it('a write for one house drops only that house\'s pack on its way: a neighbour\'s read and prefetch stand', async () => {
    let releaseWritten!: (v?: unknown) => void
    let releaseNeighbour!: (v?: unknown) => void
    gates = [new Promise((r) => { releaseWritten = r }), new Promise((r) => { releaseNeighbour = r })]
    const written = readPack('locations', 'ZZ9999')
    const neighbour = readPack('locations', 'ZB4060')
    await new Promise((r) => setTimeout(r, 20))
    prefetchLocation('ZE4048')
    locationWritten('ZZ9999')
    releaseWritten()
    releaseNeighbour()
    await Promise.all([written, neighbour])
    assert.equal(peekPack('locations', 'ZZ9999'), null, 'asked before its own write: not held')
    assert.ok(peekPack('locations', 'ZB4060'), 'another house\'s answer is held')
    await new Promise((r) => setTimeout(r, 400))
    assert.ok(packAsks().includes('ZE4048'), 'a queued prefetch for another house still runs')
    assert.ok(peekPack('locations', 'ZE4048'))
  })

  it('inside a visit the pack is never asked for', async () => {
    useMemberStore.setState({ currentMemberId: 'mem_1' } as never)
    assert.equal(await readPack('locations', 'ZZ9999'), null)
    assert.deepEqual(packAsks(), [])
    useMemberStore.setState({ currentMemberId: '' } as never)
  })

  it('inside a tenant or a world the pack is never asked for; the section reads its own, narrowed action, and '
    + 'nothing held at headquarters is drawn there', async () => {
    const key = readKey('locationStaff', 'ZZ9999')
    const hq = mountHook(() => useLocationRead(key, () => readStaff('ZZ9999'), (raw) => raw), {})
    await hq.settle(() => hq.current.status === 'ready')
    hq.unmount()
    assert.ok(peekPack('locations', 'ZZ9999'))
    seen = []
    gas = () => ({ house: 'ZZ9999', clients: [], staff: [] })
    const home = useTenantStore.getState()
    useTenantStore.setState({ currentTenantId: 'tn_akron', homeTenantId: 'tn_hq', tenantsLoaded: true } as never)
    try {
      assert.equal(peekPack('locations', 'ZZ9999'), null, 'crossing into the tenant drops what was held')
      assert.equal(await readPack('locations', 'ZZ9999'), null)
      const away = mountHook(() => useLocationRead(key, () => readStaff('ZZ9999'), (raw) => raw), {})
      assert.equal(away.current.status, 'loading', 'the answer held at headquarters is not drawn in the tenant')
      await away.settle(() => away.current.status === 'ready')
      away.unmount()
      prefetchLocation('ZB4060')
      await new Promise((r) => setTimeout(r, 400))
      assert.deepEqual(packAsks(), [])
      assert.deepEqual(gasCalls(), [['locationStaff', { house: 'ZZ9999' }]])
    } finally {
      useTenantStore.setState({ currentTenantId: home.currentTenantId, homeTenantId: home.homeTenantId,
        tenantsLoaded: home.tenantsLoaded } as never)
    }
    useWorldStore.setState({ currentWorldId: 'w_1' } as never)
    try {
      assert.equal(await readPack('locations', 'ZZ9999'), null)
      assert.deepEqual(packAsks(), [])
    } finally {
      useWorldStore.setState({ currentWorldId: '' } as never)
    }
  })

  it('inside a tenant or a world no slice is drawn, not even one held from headquarters: House Repairs, Incidents '
    + 'and Documents each read their own action, once', async () => {
    const key = readKey('locationIncidents', 'ZZ9999')
    const open = mountHook(() => useLocationRead(key, () => readIncidents('ZZ9999'), (raw) => raw), {})
    await open.settle(() => open.current.status === 'ready')
    await readRepairs('ZE4048', true)
    assert.deepEqual(gasCalls(), [], 'headquarters: the slices answered, and are held')
    gas = (action) => ({ narrowed: action, rows: [] })
    const home = useTenantStore.getState()
    const places: [string, () => void, () => void][] = [
      ['tenant', () => useTenantStore.setState({ currentTenantId: 'tn_akron', homeTenantId: 'tn_hq', tenantsLoaded: true } as never),
        () => useTenantStore.setState({ currentTenantId: home.currentTenantId, homeTenantId: home.homeTenantId,
          tenantsLoaded: home.tenantsLoaded } as never)],
      ['world', () => useWorldStore.setState({ currentWorldId: 'w_1' } as never),
        () => useWorldStore.setState({ currentWorldId: '' } as never)],
    ]
    try {
      for (const [where, enter, leave] of places) {
        seen = []
        open.run(enter)
        try {
          // the open section reads again at the crossing
          await open.settle(() => (open.current.data as { narrowed?: string } | null)?.narrowed === 'locationIncidents')
          assert.equal((open.current.data as { narrowed?: string } | null)?.narrowed, 'locationIncidents', `${where}: the open section`)
          const answers = [await readRepairs('ZE4048', true), await readIncidents('ZZ9999'), await readDocuments('ZZ9999')]
          assert.deepEqual(gasCalls(), [['locationIncidents', { house: 'ZZ9999' }], ['locationRepairs', { house: 'ZE4048', resolved: true }],
            ['locationIncidents', { house: 'ZZ9999' }], ['locationDocuments', { house: 'ZZ9999' }]], `${where}: one action per read`)
          assert.deepEqual(answers.map((a) => (a as { narrowed: string }).narrowed),
            ['locationRepairs', 'locationIncidents', 'locationDocuments'])
          assert.deepEqual(answers.map(answerAt), ['', '', ''], `${where}: nothing stamped by a slice or a pack`)
          assert.ok(!/Kenny|Orchard|ispKenny/.test(JSON.stringify(answers)), `${where}: no headquarters row`)
          assert.deepEqual(seen.filter((s) => s.url !== 'gas'), [], `${where}: no slice and no pack is asked for`)
        } finally {
          open.run(leave)
        }
        // back at headquarters, the open section is drawn from the slices again
        await open.settle(() => open.current.status === 'ready' && !(open.current.data as { narrowed?: string } | null)?.narrowed)
        assert.equal(incidentsOf(open.current.data).map((r) => r.id).join(), 'r4,r2', `after the ${where}`)
      }
    } finally {
      open.unmount()
    }
  })

  it('a crossing while the slices or the pack are read sends the section to its own action', async () => {
    let release!: (v?: unknown) => void
    sliceGate = new Promise((r) => { release = r })
    let releasePack!: (v?: unknown) => void
    gates = [new Promise((r) => { releasePack = r })]
    gas = (action) => ({ narrowed: action, rows: [] })
    const reading = [readIncidents('ZZ9999'), readStaff('ZZ9999')]
    await new Promise((r) => setTimeout(r, 20))
    assert.ok(seen.some((s) => s.url.startsWith('/snapshot/')), 'the slices were being read')
    assert.deepEqual(packAsks(), ['ZZ9999'], 'the pack was being read')
    useWorldStore.setState({ currentWorldId: 'w_1' } as never)
    try {
      release()
      releasePack()
      const answers = await Promise.all(reading)
      assert.deepEqual(answers.map((a) => (a as { narrowed?: string }).narrowed), ['locationIncidents', 'locationStaff'])
      assert.deepEqual(gasCalls().map(([a]) => a).sort(), ['locationIncidents', 'locationStaff'])
      assert.deepEqual(answers.map(answerAt), ['', ''])
    } finally {
      useWorldStore.setState({ currentWorldId: '' } as never)
    }
  })

  it('at headquarters over a shelf another place seeded, no slice is drawn; once headquarters seeds it, the slices '
    + 'answer again', async () => {
    placed = {
      '/snapshot/place?tenant=tn_akron': { houses: HOUSES, clients: CLIENT_ROWS, workOrders: REPAIRS, uiIncidents: INCIDENTS },
      '/snapshot/place': { houses: HOUSES, clients: CLIENT_ROWS, workOrders: REPAIRS, uiIncidents: INCIDENTS },
    }
    const home = useTenantStore.getState()
    try {
      useTenantStore.setState({ currentTenantId: 'tn_akron', homeTenantId: 'tn_hq', tenantsLoaded: true } as never)
      assert.ok(await placeLoad({ tenant: 'tn_akron' }))
      useTenantStore.setState({ currentTenantId: home.currentTenantId, homeTenantId: home.homeTenantId,
        tenantsLoaded: home.tenantsLoaded } as never)
      assert.equal(seededPlace(), 'tn_akron')
      seen = []
      gas = (action) => ({ narrowed: action, rows: [] })
      await readRepairs('ZE4048', false)
      await readIncidents('ZZ9999')
      assert.deepEqual(gasCalls(), [['locationRepairs', { house: 'ZE4048', resolved: false }], ['locationIncidents', { house: 'ZZ9999' }]])
      assert.deepEqual(seen.filter((s) => s.url !== 'gas'), [], 'the tenant\'s rows held in memory are not read')
    } finally {
      useTenantStore.setState({ currentTenantId: home.currentTenantId, homeTenantId: home.homeTenantId,
        tenantsLoaded: home.tenantsLoaded } as never)
      await placeLoad({})
    }
    assert.equal(seededPlace(), 'home')
    seen = []
    const repairs = await readRepairs('ZE4048', false)
    assert.deepEqual(gasCalls(), [])
    assert.ok(answerAt(repairs))
  })

  it('an answer asked for before a change of account is never drawn after it; the section reads again', async () => {
    let openFirst!: (v?: unknown) => void
    let openSecond!: (v?: unknown) => void
    gates = [new Promise((r) => { openFirst = r }), new Promise((r) => { openSecond = r })]
    let asked = 0
    door = (key) => {
      asked++
      const said = pack(key)
      if (asked > 1) said.data.parts.staff = { house: key, clients: [], staff: [] }
      return said
    }
    useAuthStore.setState({ user: { id: 'u-a' }, token: 'tok-a' } as never)
    const key = readKey('locationStaff', 'ZZ9999')
    const a = mountHook(() => useLocationRead(key, () => readStaff('ZZ9999'), (raw) => raw as { staff: unknown[] }), {})
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(a.current.status, 'loading')
    a.run(() => useAuthStore.setState({ user: { id: 'u-b' }, token: 'tok-b' } as never))
    await new Promise((r) => setTimeout(r, 30))
    openFirst()
    await new Promise((r) => setTimeout(r, 60))
    assert.notEqual(a.current.status, 'ready', 'the first account\'s answer is not drawn for the second')
    openSecond()
    await a.settle(() => a.current.status === 'ready')
    assert.equal(a.current.data?.staff.length, 0, 'the answer drawn is the one read for the second account')
    assert.equal(packAsks().filter((k) => k === 'ZZ9999').length, 2)
    a.unmount()
    useAuthStore.setState({ user: null, token: null } as never)
  })

  it('a change of account drops every held pack and document; nothing is written to storage', async () => {
    gas = (a) => (a === 'locationDocFile' ? { id: 'ispKennyxxxx1', name: 'ISP', mime: 'application/pdf', size: 3, exported: false, b64: 'JVBE' } : {})
    const key = readKey('locationStaff', 'ZZ9999')
    const a = mountHook(() => useLocationRead(key, () => readStaff('ZZ9999'), (raw) => raw), {})
    await a.settle(() => a.current.status === 'ready')
    a.unmount()
    await readDocFile('ZZ9999', 'ispKennyxxxx1')
    assert.ok(peekPack('locations', 'ZZ9999'))
    const dump = (s: Storage) => Array.from({ length: s.length }, (_, i) => `${s.key(i)}=${s.getItem(s.key(i) ?? '')}`).join('\n')
    const stored = `${dump(localStorage)}\n${dump(sessionStorage)}`
    assert.ok(!/Hank Manager|Ann Lee|JVBE|Back door|app-pack/.test(stored), stored)
    useAuthStore.setState({ user: { id: 'u-other' }, token: 'tok-other' } as never)
    assert.equal(peekPack('locations', 'ZZ9999'), null)
    const b = mountHook(() => useLocationRead(key, () => readStaff('ZZ9999'), (raw) => raw), {})
    assert.equal(b.current.status, 'loading', 'the section answer held for the first account is not drawn for the next')
    await b.settle(() => b.current.status === 'ready')
    b.unmount()
    seen = []
    await readDocFile('ZZ9999', 'ispKennyxxxx1')
    assert.equal(gasCalls().length, 1, 'the document is read again for the new account')
    useAuthStore.setState({ user: null, token: null } as never)
  })

  it('a document asked for before a change of account is never held after it', async () => {
    gas = () => ({ id: 'ispKennyxxxx1', name: 'ISP', mime: 'application/pdf', size: 3, exported: false, b64: 'JVBE' })
    let release!: (v?: unknown) => void
    gasGate = new Promise((r) => { release = r })
    useAuthStore.setState({ user: { id: 'u-a' }, token: 'tok-a' } as never)
    const first = readDocFile('ZZ9999', 'ispKennyxxxx1')
    await new Promise((r) => setTimeout(r, 20))
    useAuthStore.setState({ user: { id: 'u-b' }, token: 'tok-b' } as never)
    release()
    await first
    gasGate = null
    seen = []
    await readDocFile('ZZ9999', 'ispKennyxxxx1')
    assert.equal(gasCalls().length, 1, 'the bytes asked for by the first account are read again for the second')
    useAuthStore.setState({ user: null, token: null } as never)
  })

  it('a document opened again is answered from memory; the ninth pushes the oldest out', async () => {
    gas = () => ({ id: 'x', name: 'Doc', mime: 'application/pdf', size: 3, exported: false, b64: 'JVBE' })
    await readDocFile('ZZ9999', 'doc0xxxxxxxx')
    await readDocFile('ZZ9999', 'doc0xxxxxxxx')
    assert.equal(gasCalls().length, 1)
    for (let i = 1; i <= 8; i++) await readDocFile('ZZ9999', `doc${i}xxxxxxxx`)
    await readDocFile('ZZ9999', 'doc0xxxxxxxx')
    assert.equal(gasCalls().length, 10, 'the first was pushed out by the ninth')
  })

  it('the section draws the held answer at once and reads behind it once it is stale, saying so, with its age', async () => {
    const key = readKey('locationStaff', 'ZZ9999')
    const a = mountHook(() => useLocationRead(key, () => readStaff('ZZ9999'), (raw) => raw), {})
    await a.settle(() => a.current.status === 'ready')
    assert.equal(a.current.updatedAt, PACK_AT)
    assert.equal(a.current.refreshing, false)
    a.unmount()
    const realNow = Date.now
    Date.now = () => realNow() + PACK_FRESH_MS + 1_000
    try {
      const b = mountHook(() => useLocationRead(key, () => readStaff('ZZ9999'), (raw) => raw), {})
      assert.equal(b.current.status, 'ready', 'the held answer is drawn at once')
      assert.equal(b.current.refreshing, true)
      await b.settle(() => b.current.refreshing === false)
      assert.equal(packAsks().filter((k) => k === 'ZZ9999').length, 2, 'read again behind what was drawn')
      b.unmount()
    } finally {
      Date.now = realNow
    }
  })
})
