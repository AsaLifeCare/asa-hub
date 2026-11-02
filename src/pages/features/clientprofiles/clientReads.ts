// WHERE EACH CLIENTS SECTION IS READ, in the platform's lane order — the first that answers: 1.
// the slices (clients, photos, uiIncidents) — the switcher's roster, and the Incidents reports, computed here…
import { gasAction } from '@/features/hiring/shared'
import { heldRows, readSlice } from '@/lib/snapshotClient'
import {
  answerStamp, forgetPack, heldOwnPart, prefetchPack, readOwnPart, readPackPart, shelfServesHere, stampAnswer, wrotePack,
} from '@/lib/appPack'
import { ownClientKey } from '@/lib/ownClient'
import { slicesAt } from '@/pages/features/locations/locationReads'
import { switcherClients, type RosterRow } from './clientModel'
import { clientIdentityRow, incidentsFrom, reviewsOf, rosterFrom, type ClientIdentityRow } from './clientLanes'
import { narrowedReader } from './clientViewer'

/** Headquarters' copies of every client (the slices, the relay's pack) serve this tab and this account. */
const wholeServesHere = (): boolean => shelfServesHere() && !narrowedReader()

export const CLIENTS_PACK = 'client-profiles'

/** How long a person's read waits on a client's pack being gathered, once, before its section reads its action. */
export const CLIENT_PACK_WAIT_S = 4

/** When an answer's source was made (a slice's build, the relay's pack); '' for an answer read live. */
export const clientAnswerAt = answerStamp

/* ---------- lane 1: the slices ---------- */

/** The clients slice's rows, narrowed to identity, and the photos; null when the clients are not on the shelf here. */
async function clientsShelf(): Promise<{ rows: ClientIdentityRow[]; photos: unknown[]; at: string } | null> {
  if (!wholeServesHere()) return null
  const [clients, photos] = await Promise.all([readSlice<unknown>('clients'), readSlice<unknown>('photos')])
  // a crossing while the slices were read
  if (!wholeServesHere() || !clients?.length) return null
  return { rows: clients.map(clientIdentityRow), photos: photos ?? [], at: slicesAt(['clients', ...(photos ? ['photos'] : [])]) }
}

/** The switcher's order of the current clients, from the slices; [] when they are not on the shelf here. */
async function clientOrder(): Promise<string[]> {
  const shelf = await clientsShelf()
  if (!shelf) return []
  const roster = rosterFrom(shelf.rows, shelf.photos).clients as RosterRow[]
  return switcherClients(roster, '', false).map((c) => c.client_key)
}

/* ---------- lane 2: the relay's pack ---------- */

/** The clients either side of this one in the switcher's order, asked for while the browser is idle. */
async function prefetchNeighbours(client: string): Promise<void> {
  const order = await clientOrder()
  if (!wholeServesHere()) return
  const at = order.indexOf(client)
  if (at === -1) return
  for (const next of [order[at - 1], order[at + 1]]) if (next) prefetchPack(CLIENTS_PACK, next)
}

// A current client the switcher points at (hover or focus): their pack asked of the relay's memory while the…
export function prefetchClient(client: string): void {
  const key = client.trim()
  if (!key) return
  void clientOrder().then((order) => {
    if (order.includes(key)) prefetchPack(CLIENTS_PACK, key)
  }).catch(() => {})
}

/** The switcher opened on this client: the clients either side of them asked of the relay's memory while idle. */
export function prefetchClientNeighbours(client: string): void {
  const key = client.trim()
  if (key) void prefetchNeighbours(key).catch(() => {})
}

/** A part of a client-role session's own view, for its own client only; null otherwise. */
async function ownPart(client: string, part: string): Promise<{ part: unknown; builtAt: string } | null> {
  if (!client || client !== ownClientKey()) return null
  const own = await readOwnPart(CLIENTS_PACK, part, { waitS: CLIENT_PACK_WAIT_S })
  return own && String(own.data.client ?? '') === client ? own : null
}

async function packPart(client: string, part: string): Promise<{ part: unknown; builtAt: string } | null> {
  if (narrowedReader()) return ownPart(client, part)
  // a client the roster names but not as current is archived: the relay keeps no pack for them
  const order = await clientOrder().catch(() => [] as string[])
  if (order.length && !order.includes(client)) return null
  const got = await readPackPart(CLIENTS_PACK, client, part, { waitS: CLIENT_PACK_WAIT_S })
  if (got) void prefetchNeighbours(client).catch(() => {})
  return got
}

/** Forget one client's pack, or every client's: it is asked of the relay again. */
export const forgetClientPack = (client?: string) => forgetPack(CLIENTS_PACK, client ? client.trim() : undefined)

// This tab wrote for the client, sending it at `sentAt`: no pack the relay began reading before then is drawn, and…
export const wroteClientPack = (client: string, sentAt?: number) => wrotePack(CLIENTS_PACK, client.trim(), sentAt)

// A pack part as its section's answer — when `fits` it — else the section's own action.
export async function clientPackOr(client: string, part: string, action: () => Promise<unknown>,
  fits: (part: unknown) => boolean = () => true): Promise<unknown> {
  const key = client.trim()
  const got = key ? await packPart(key, part) : null
  if (got && fits(got.part)) return stampAnswer(got.part, got.builtAt)
  return action()
}

/* ---------- the reads, one per section ---------- */

// The switcher: the current clients from the slices; Show Inactive (the archive of old clients) is the action's.
export async function readRoster(showInactive: boolean): Promise<unknown> {
  if (!showInactive) {
    const own = await ownPart(ownClientKey(), 'roster')
    if (own) return stampAnswer(own.part, own.builtAt)
    const shelf = await clientsShelf()
    if (shelf) return stampAnswer(rosterFrom(shelf.rows, shelf.photos), shelf.at)
  }
  return gasAction<unknown>('clientProfileRoster', showInactive ? { show_inactive: true } : {})
}

// The switcher's current clients from the slices this tab already holds, never fetched: the first paint while…
export function heldRoster(): unknown {
  const key = ownClientKey()
  const own = key ? heldOwnPart(CLIENTS_PACK, 'roster') : null
  if (own && String(own.data.client ?? '') === key) return stampAnswer(own.part, own.builtAt)
  if (!wholeServesHere()) return null
  const clients = heldRows<unknown>('clients')
  if (!clients?.length) return null
  const photos = heldRows<unknown>('photos')
  return stampAnswer(rosterFrom(clients.map(clientIdentityRow), photos ?? []),
    slicesAt(['clients', ...(photos ? ['photos'] : [])]))
}

export const readDetails = (client: string) =>
  clientPackOr(client, 'details', () => gasAction<unknown>('clientProfileDetails', { client }))
export const readCare = (client: string, tab: string) =>
  clientPackOr(client, `care_${tab}`, () => gasAction<unknown>('clientProfileCare', { client, tab }))
/** Medication › Medications: the eMAR list (Administration and Refills read their own apps). */
export const readMeds = (client: string) =>
  clientPackOr(client, 'meds', () => gasAction<unknown>('clientProfileMeds', { client, tab: 'meds' }))
export const readActivity = (client: string) =>
  clientPackOr(client, 'activity', () => gasAction<unknown>('clientProfileActivity', { client }))

/** The client's reports from the uiIncidents slice; null when the client or the reports are not on the shelf here. */
async function incidentsShelf(client: string): Promise<{ rows: unknown[]; client: ClientIdentityRow; at: string } | null> {
  if (!wholeServesHere()) return null
  const [clients, rows] = await Promise.all([readSlice<unknown>('clients'), readSlice<unknown>('uiIncidents')])
  if (!wholeServesHere() || !clients?.length || !rows?.length) return null
  const who = clients.map(clientIdentityRow).find((c) => c.client_key === client)
  return who ? { rows, client: who, at: slicesAt(['clients', 'uiIncidents']) } : null
}

/** Incidents: the reports from the slice, the review statuses from the pack — both, else the section's action. */
export async function readIncidents(client: string): Promise<unknown> {
  const key = client.trim()
  // a client-role session's own view carries the whole answer
  const own = narrowedReader() ? await ownPart(key, 'incidents') : null
  if (own) return stampAnswer(own.part, own.builtAt)
  const [shelf, reviews] = await Promise.all([incidentsShelf(key), key ? packPart(key, 'reviews') : null])
  const byId = reviews ? reviewsOf(reviews.part) : null
  if (shelf && reviews && byId) {
    const at = [shelf.at, reviews.builtAt].filter(Boolean).sort()[0] ?? ''
    return stampAnswer(incidentsFrom(shelf.rows, shelf.client, byId), at)
  }
  return gasAction<unknown>('clientProfileIncidents', { client })
}
