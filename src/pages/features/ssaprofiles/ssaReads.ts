// WHERE EACH SSA SECTION IS READ, in the platform's lane order — the first that answers: 1.
// the slices (clients, photos) — the switcher's roster, computed here (ssaModel.rosterFrom) with no execution at…
import { gasAction } from '@/features/hiring/shared'
import { heldRows, readSlice } from '@/lib/snapshotClient'
import {
  answerStamp, forgetPack, heldOwnPart, prefetchPack, readOwnPart, readPackPart, shelfServesHere, stampAnswer, wrotePack,
} from '@/lib/appPack'
import { effectiveUser } from '@/lib/effectiveUser'
import { slicesAt } from '@/pages/features/locations/locationReads'
import { photoIndex } from '@/pages/features/clientprofiles/clientLanes'
import { narrowedViewer, rosterFrom, rosterOf, switcherSsas } from './ssaModel'

export const SSA_PACK = 'ssa-profiles'

/** How long a person's read waits on an SSA's pack being gathered, once, before its section reads its action. */
export const SSA_PACK_WAIT_S = 4

/** When an answer's source was made (a slice's build, the relay's pack); '' for an answer read live. */
export const ssaAnswerAt = answerStamp

/** A session the server may cut reads only the actions. */
const cutHere = (): boolean => narrowedViewer(effectiveUser())

/* ---------- lane 1: the slices ---------- */

/** The clients slice's rows and the photos' avatar index; null when the clients are not on the shelf here. */
async function clientsShelf(): Promise<{ rows: unknown[]; faces: Record<string, string>; at: string } | null> {
  if (!shelfServesHere() || cutHere()) return null
  const [rows, photos] = await Promise.all([readSlice<unknown>('clients'), readSlice<unknown>('photos')])
  // a crossing while the slices were read
  if (!shelfServesHere() || cutHere() || !rows?.length) return null
  return { rows, faces: photoIndex(photos ?? []), at: slicesAt(['clients', ...(photos ? ['photos'] : [])]) }
}

type Order = { order: string[]; partial: boolean }

// The switcher's order of the current SSAs, from the slices, and whether a current client's row there names no SSA…
async function ssaOrder(): Promise<Order> {
  const shelf = await clientsShelf()
  if (!shelf) return { order: [], partial: false }
  const r = rosterFrom(shelf.rows, shelf.faces)
  return { order: switcherSsas(rosterOf(r).ssas, '', false).map((s) => s.key), partial: r.partial }
}

/* ---------- lane 2: the relay's pack ---------- */

async function prefetchNeighbours(ssa: string): Promise<void> {
  const { order } = await ssaOrder()
  if (!shelfServesHere()) return
  const at = order.indexOf(ssa)
  if (at === -1) return
  for (const next of [order[at - 1], order[at + 1]]) if (next) prefetchPack(SSA_PACK, next)
}

/** A current SSA the switcher points at: their pack asked of the relay's memory while the browser is idle. */
export function prefetchSsa(ssa: string): void {
  const key = ssa.trim()
  if (!key || cutHere()) return
  void ssaOrder().then(({ order, partial }) => {
    if (partial || order.includes(key)) prefetchPack(SSA_PACK, key)
  }).catch(() => {})
}

/** The switcher opened on this SSA: the SSAs either side of them asked of the relay's memory while idle. */
export function prefetchSsaNeighbours(ssa: string): void {
  const key = ssa.trim()
  if (key && !cutHere()) void prefetchNeighbours(key).catch(() => {})
}

// A part of a client-role session's own view, when that view is of this SSA (or, for the roster, of any); null…
async function ownPart(ssa: string, part: string): Promise<{ part: unknown; builtAt: string } | null> {
  const own = await readOwnPart(SSA_PACK, part, { waitS: SSA_PACK_WAIT_S })
  return own && (!ssa || String(own.data.ssa ?? '') === ssa) ? own : null
}

async function packPart(ssa: string, part: string): Promise<{ part: unknown; builtAt: string } | null> {
  if (cutHere()) return ssa ? ownPart(ssa, part) : null
  // an SSA no current client names: the relay keeps no pack for them; with a current client the slices name no SSA…
  const { order, partial } = await ssaOrder().catch((): Order => ({ order: [], partial: false }))
  if (!partial && order.length && !order.includes(ssa)) return null
  const got = await readPackPart(SSA_PACK, ssa, part, { waitS: SSA_PACK_WAIT_S })
  if (got) void prefetchNeighbours(ssa).catch(() => {})
  return got
}

/** Forget one SSA's pack, or every SSA's: it is asked of the relay again. */
export const forgetSsaPack = (ssa?: string) => forgetPack(SSA_PACK, ssa ? ssa.trim() : undefined)

/** This tab wrote for the SSA, sending it at `sentAt`: no pack the relay began reading before then is drawn. */
export const wroteSsaPack = (ssa: string, sentAt?: number) => wrotePack(SSA_PACK, ssa.trim(), sentAt)

/** A pack part as its section's answer — when `fits` it — else the section's own action. */
export async function ssaPackOr(ssa: string, part: string, action: () => Promise<unknown>,
  fits: (part: unknown) => boolean = () => true): Promise<unknown> {
  const key = ssa.trim()
  const got = key ? await packPart(key, part) : null
  if (got && fits(got.part)) return stampAnswer(got.part, got.builtAt)
  return action()
}

/* ---------- the reads, one per section ---------- */

// The switcher: the current SSAs from the slices; Show Inactive (an SSA only archived clients name) is the…
export async function readRoster(showInactive: boolean): Promise<unknown> {
  // the action answers a client its own SSA whatever it asks, and so does its own view
  const own = cutHere() ? await ownPart('', 'roster') : null
  if (own) return stampAnswer(own.part, own.builtAt)
  if (!showInactive) {
    const shelf = await clientsShelf()
    if (shelf) return stampAnswer(rosterFrom(shelf.rows, shelf.faces), shelf.at)
  }
  return gasAction<unknown>('ssaProfileRoster', {})
}

// The switcher's current SSAs from the slices this tab already holds, never fetched: the first paint while…
export function heldRoster(): unknown {
  const own = cutHere() ? heldOwnPart(SSA_PACK, 'roster') : null
  if (own) return stampAnswer(own.part, own.builtAt)
  if (!shelfServesHere() || cutHere()) return null
  const rows = heldRows<unknown>('clients')
  if (!rows?.length) return null
  const photos = heldRows<unknown>('photos')
  return stampAnswer(rosterFrom(rows, photoIndex(photos ?? [])), slicesAt(['clients', ...(photos ? ['photos'] : [])]))
}

const isObject = (v: unknown): boolean => !!v && typeof v === 'object' && !Array.isArray(v)

export const readOverview = (ssa: string) =>
  ssaPackOr(ssa, 'overview', () => gasAction<unknown>('ssaProfileOverview', { ssa }), isObject)
export const readDocuments = (ssa: string) =>
  ssaPackOr(ssa, 'documents', () => gasAction<unknown>('ssaProfileDocuments', { ssa }), isObject)
export const readActivity = (ssa: string) =>
  ssaPackOr(ssa, 'activity', () => gasAction<unknown>('ssaProfileActivity', { ssa }), isObject)
export const readNotes = (ssa: string) =>
  ssaPackOr(ssa, 'notes', () => gasAction<unknown>('ssaProfileNotes', { ssa }), isObject)
