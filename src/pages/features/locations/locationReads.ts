// WHERE EACH LOCATIONS SECTION IS READ, in the platform's lane order — the first that answers: 1.
// the JSON bundle and the slices (houses, clients, workOrders, uiIncidents) — House Repairs, Incidents and the…
import { gasAction } from '@/features/hiring/shared'
import { api } from '@/lib/api'
import { heldRows, readSlice, sliceAgeMs } from '@/lib/snapshotClient'
import { normalizeRows } from '@/lib/normalizeRows'
import { useApiConfigStore } from '@/stores/useApiConfigStore'
import {
  answerStamp, forgetDocBytes, forgetPack, onMemoryBoundary, prefetchPack, readDocBytesHeld, readOwnPart, readPackPart,
  shelfServesHere as hqShelf, stampAnswer, wrotePack,
} from '@/lib/appPack'
import type { HouseRow } from '@/pages/features/houses/houseModel'
import { switcherHouses } from './locationModel'
import {
  addableClients, addrIndex, clientIdentity, clientList, clientsAt, documentsAnswer, incidentsAnswer, repairsAnswer,
  repairsFor, type ClientIdentity, type RepairAnswerRow,
} from './locationLanes'

export const LOCATIONS_PACK = 'locations'

/* ---------- who reads ---------- */

let heldToHouses = false

/** The viewer's scope held it to some houses: the slices and the pack are left alone, only the cut actions read. */
export function holdToHouses(on: boolean): void {
  heldToHouses = on
}

onMemoryBoundary(() => {
  heldToHouses = false
})

/** The slices and the relay's pack serve this tab: headquarters, and a viewer who sees every house. */
const shelfServesHere = (): boolean => !heldToHouses && hqShelf()

/* ---------- when each answer was made ---------- */

const stamped = stampAnswer

/** When the answer's source was made (a slice's build, the relay's pack); '' for an answer read live. */
export const answerAt = answerStamp

/** The oldest of the slices read, as an instant. */
export function slicesAt(resources: string[]): string {
  const ages = resources.map((r) => sliceAgeMs(r)).filter((a): a is number => a !== null)
  return ages.length ? new Date(Date.now() - Math.max(...ages)).toISOString() : ''
}

/* ---------- lane 1: the slices ---------- */

type Shelf = { house: HouseRow; houses: HouseRow[]; clients: ClientIdentity[]; rows: unknown[]; at: string }

// The house and the clients from the slices, and one more resource's rows.
async function fromShelf(code: string, resource = ''): Promise<Shelf | null> {
  if (!shelfServesHere()) return null
  const [houses, clients, rows] = await Promise.all([
    readSlice<HouseRow>('houses'), readSlice<unknown>('clients'), resource ? readSlice<unknown>(resource) : Promise.resolve([]),
  ])
  // a crossing while the slices were read
  if (!shelfServesHere()) return null
  if (!houses?.length || !clients?.length || !rows || (resource && !rows.length)) return null
  const house = houses.find((h) => String(h.code).toUpperCase() === code)
  if (!house) return null
  return { house, houses, clients: clients.map(clientIdentity), rows, at: slicesAt(['houses', 'clients', ...(resource ? [resource] : [])]) }
}

const currentClients = (s: Shelf, code: string) => clientsAt(code, s.house.address ?? '', s.clients)

/* ---------- lane 2: the relay's pack ---------- */

/** The houses either side of this one in the switcher's order, asked for while the browser is idle. */
async function prefetchNeighbours(code: string): Promise<void> {
  if (!shelfServesHere()) return
  const houses = await readSlice<HouseRow>('houses')
  if (!houses?.length || !shelfServesHere()) return
  const order = switcherHouses(houses, '', false).map((h) => String(h.code).toUpperCase())
  const at = order.indexOf(code)
  if (at === -1) return
  for (const next of [order[at - 1], order[at + 1]]) if (next) prefetchPack(LOCATIONS_PACK, next)
}

/** A house the switcher points at (hover or focus): its pack asked for while the browser is idle. */
export const prefetchLocation = (house: string): void => {
  if (!heldToHouses) prefetchPack(LOCATIONS_PACK, house.toUpperCase())
}

/** The switcher opened on this house: the houses either side of it asked for while the browser is idle. */
export function prefetchLocationNeighbours(house: string): void {
  const code = house.trim().toUpperCase()
  if (code) void prefetchNeighbours(code).catch(() => {})
}

// The houses this tab already holds, never fetched: the switcher's and the header's first paint while the houses…
export function heldHouses(): HouseRow[] | null {
  if (!hqShelf() || useApiConfigStore.getState().driver !== 'apps-script') return null
  const rows = heldRows<HouseRow>('houses')
  return rows?.length ? normalizeRows('houses', rows) : null
}

/** A part of a client-role session's own view, when that view is of this house; null otherwise. */
async function ownPart(code: string, part: string): Promise<{ part: unknown; builtAt: string } | null> {
  const own = await readOwnPart(LOCATIONS_PACK, part)
  return own && String(own.data.house ?? '').toUpperCase() === code ? own : null
}

async function packPart(code: string, part: string): Promise<{ part: unknown; builtAt: string } | null> {
  if (heldToHouses) return ownPart(code, part)
  const got = await readPackPart(LOCATIONS_PACK, code, part)
  if (got) void prefetchNeighbours(code).catch(() => {})
  return got
}

/** Forget the house's pack, or every house's: it is asked of the relay again. */
export const forgetLocationPack = (house?: string) => forgetPack(LOCATIONS_PACK, house ? house.toUpperCase() : undefined)

// This tab wrote for the house, sending it at `sentAt`: no pack the relay began reading before then is drawn, and…
export const wroteLocationPack = (house: string, sentAt?: number) => wrotePack(LOCATIONS_PACK, house.toUpperCase(), sentAt)

/** A pack part as its section's answer, else the section's own action. */
async function packOrAction(house: string, part: string, action: () => Promise<unknown>): Promise<unknown> {
  const got = await packPart(house.toUpperCase(), part)
  if (got) return stamped(got.part, got.builtAt)
  return action()
}

/* ---------- the reads, one per section ---------- */

export const readOverview = (house: string) =>
  packOrAction(house, 'overview', () => gasAction<unknown>('locationOverview', { house }))
export const readStaff = (house: string) =>
  packOrAction(house, 'staff', () => gasAction<unknown>('locationStaff', { house }))
export const readSupplies = (house: string) =>
  packOrAction(house, 'supplies', () => gasAction<unknown>('locationSupplies', { house }))
export const readNotes = (house: string) =>
  packOrAction(house, 'notes', () => gasAction<unknown>('locationNotes', { house }))

export async function readRepairs(house: string, resolved: boolean): Promise<unknown> {
  const code = house.toUpperCase()
  // the own view carries every request of the house, shaped here as locationRepairs shapes it
  const own = heldToHouses ? await ownPart(code, 'repairs') : null
  const ownRows = own ? (own.part as { rows?: unknown }).rows : null
  if (own && Array.isArray(ownRows)) return stamped(repairsAnswer(code, ownRows as RepairAnswerRow[], resolved), own.builtAt)
  const shelf = await fromShelf(code, 'workOrders')
  if (shelf) {
    const index = addrIndex(shelf.houses.map((h) => ({ code: String(h.code).toUpperCase(), address: h.address })), shelf.clients)
    return stamped(repairsAnswer(code, repairsFor(shelf.rows, code, index), resolved), shelf.at)
  }
  return gasAction<unknown>('locationRepairs', { house, resolved })
}

export async function readIncidents(house: string): Promise<unknown> {
  const code = house.toUpperCase()
  const own = heldToHouses ? await ownPart(code, 'incidents') : null
  if (own) return stamped(own.part, own.builtAt)
  const shelf = await fromShelf(code, 'uiIncidents')
  if (shelf) return stamped(incidentsAnswer(code, clientList(currentClients(shelf, code)), shelf.rows), shelf.at)
  return gasAction<unknown>('locationIncidents', { house })
}

export async function readDocuments(house: string): Promise<unknown> {
  const code = house.toUpperCase()
  const own = heldToHouses ? await ownPart(code, 'documents') : null
  if (own) return stamped(own.part, own.builtAt)
  const [shelf, guide] = await Promise.all([fromShelf(code), packPart(code, 'guidebook')])
  if (shelf && guide) {
    const answer = documentsAnswer(shelf.house, currentClients(shelf, code), guide.part as Record<string, unknown>)
    const at = [shelf.at, guide.builtAt].filter(Boolean).sort()[0] ?? ''
    return stamped(answer, at)
  }
  return gasAction<unknown>('locationDocuments', { house })
}

/* ---------- the clients an edition may add to a house ---------- */

// The clients the Associated clients edition may offer for this house (locationLanes.addableClients): the clients…
export async function readAddableClients(): Promise<ClientIdentity[]> {
  const [clients, houses] = await Promise.all([
    shelfServesHere() ? readSlice<unknown>('clients') : Promise.resolve(null),
    shelfServesHere() ? readSlice<HouseRow>('houses') : Promise.resolve(null),
  ])
  const rows = clients ?? ((await api.list<unknown>('clients')) as unknown[] | null) ?? []
  return addableClients(rows.map(clientIdentity),
    (houses ?? []).map((h) => ({ code: String(h.code).toUpperCase(), address: h.address })))
}

/* ---------- a document's bytes, held for the tab ---------- */

export type DocBytes = { id: string; name: string; mime: string; size: number; exported: boolean; b64: string }

/** Forget the held documents: one house's, or every house's. */
export function forgetDocs(house?: string): void {
  forgetDocBytes(house ? `${LOCATIONS_PACK}|${house}|` : `${LOCATIONS_PACK}|`)
}

// A document through its door (locationDocFile), kept in memory for the tab (appPack's readDocBytesHeld) so opening…
export const readDocBytes = (house: string, id: string): Promise<DocBytes> =>
  readDocBytesHeld(`${LOCATIONS_PACK}|${house}|${id}`, () => gasAction<DocBytes>('locationDocFile', { house, id }))
