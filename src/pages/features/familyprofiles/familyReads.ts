// WHERE EACH FAMILIES SECTION IS READ, in the platform's lane order — the first that answers: 1.
// the relay's index of the whole app (/hub-lanes/app-pack/family-index) — the roster, every family member's…
import { gasAction } from '@/features/hiring/shared'
import {
  answerStamp, forgetPack, prefetchPack, readPack, readPackPart, shelfServesHere, stampAnswer, wrotePack,
} from '@/lib/appPack'
import { useAuthStore } from '@/auth/useAuthStore'
import { rosterOf, switcherFamilies, viewNarrowed } from './familyModel'

export const FAMILY_PACK = 'family-profiles'
/** The relay's index of the whole app: its own door, under one key. */
export const FAMILY_INDEX = 'family-index'
export const FAMILY_INDEX_KEY = 'all'

/** How long a person's read waits on a family member's pack being gathered, once, before its section reads its action. */
export const FAMILY_PACK_WAIT_S = 4
/** How long the roster waits on the index being gathered, once, before it reads its action — less than the action takes. */
export const FAMILY_INDEX_WAIT_S = 20

/** The roles the relay's door never opens a pack to: such a session reads its actions without asking it. */
const NEVER_PACKED = new Set(['client', 'guardian', 'onboarding', 'interviewer'])

/** When an answer's source was made (the relay's index or pack); '' for an answer read live. */
export const familyAnswerAt = answerStamp

/* ---------- the roster, and the order the switcher draws it in ---------- */

// the last roster read: the current family members in the switcher's order, every key it named, and whether the…
let order: string[] = []
let named = new Set<string>()
let narrowed = false

function learnRoster(raw: unknown): void {
  const r = rosterOf(raw)
  order = switcherFamilies(r.families, '', false).map((f) => f.key)
  named = new Set(r.families.map((f) => f.key))
  narrowed = viewNarrowed(r.view)
}

/** Forget the roster's order (a memory boundary): the pack is asked for again until the roster is read. */
export function forgetFamilyOrder(): void {
  order = []
  named = new Set()
  narrowed = false
}

/* ---------- lane 1: the relay's index of the whole app ---------- */

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Whether this session asks the index at all: at headquarters, not cut to its own clients, in a role it opens to. */
function indexAsked(): boolean {
  const role = String(useAuthStore.getState().user?.role ?? '').toLowerCase()
  return shelfServesHere() && !narrowed && !NEVER_PACKED.has(role)
}

/** The roster as the index holds it, with the view the relay says this session reads; null when it did not answer. */
async function indexRoster(): Promise<unknown | null> {
  if (!indexAsked()) return null
  const pack = await readPack(FAMILY_INDEX, FAMILY_INDEX_KEY, { waitS: FAMILY_INDEX_WAIT_S })
  if (!pack || !shelfServesHere()) return null
  const status = pack.data.part_status?.roster
  const roster = pack.data.parts?.roster
  if (!isObject(roster) || !Array.isArray(roster.families) || (status?.status !== undefined && status.status !== 200)) return null
  return stampAnswer({ ...roster, view: pack.data.view }, pack.builtAt)
}

// One family member's part of the index (`overviews` or `notes`), by the key the record answers to; null when it is…
async function indexPart(family: string, part: 'overviews' | 'notes'): Promise<unknown | null> {
  if (!indexAsked()) return null
  const [got, aliases] = await Promise.all([
    readPackPart(FAMILY_INDEX, FAMILY_INDEX_KEY, part, { waitS: 0 }),
    readPackPart(FAMILY_INDEX, FAMILY_INDEX_KEY, 'aliases', { waitS: 0 }),
  ])
  if (!got || !isObject(got.part)) return null
  const spelled = aliases && isObject(aliases.part) ? aliases.part[family] : undefined
  const value = got.part[typeof spelled === 'string' ? spelled : family]
  return isObject(value) ? stampAnswer(value, got.builtAt) : null
}

/** Forget the index this tab holds: it is asked of the relay again. */
export const forgetFamilyIndex = () => forgetPack(FAMILY_INDEX)

// This tab wrote a family member's details or notes, sending it at `sentAt`: no index the relay began reading…
export const wroteFamilyIndex = (sentAt?: number) => wrotePack(FAMILY_INDEX, FAMILY_INDEX_KEY, sentAt)

/** The switcher: every family member the records name, the current and the inactive in one answer. */
export async function readRoster(): Promise<unknown> {
  const raw = (await indexRoster()) ?? await gasAction<unknown>('familyProfileRoster', {})
  learnRoster(raw)
  return raw
}

/* ---------- lane 2: the relay's pack for the family member ---------- */

function prefetchNeighbours(family: string): void {
  if (!shelfServesHere() || narrowed) return
  const at = order.indexOf(family)
  if (at === -1) return
  for (const next of [order[at - 1], order[at + 1]]) if (next) prefetchPack(FAMILY_PACK, next)
}

/** A current family member the switcher points at: their pack asked of the relay's memory while the browser is idle. */
export function prefetchFamily(family: string): void {
  const key = family.trim()
  if (key && !narrowed && order.includes(key)) prefetchPack(FAMILY_PACK, key)
}

async function packPart(family: string, part: string): Promise<{ part: unknown; builtAt: string } | null> {
  // a viewer cut to its own clients reads its cut from the doors, never the uncut pack
  if (narrowed) return null
  // a family member the roster holds as inactive: the relay keeps no pack for them
  if (named.has(family) && !order.includes(family)) return null
  const got = await readPackPart(FAMILY_PACK, family, part, { waitS: FAMILY_PACK_WAIT_S })
  if (got) prefetchNeighbours(family)
  return got
}

/** Forget one family member's pack, or every one's: it is asked of the relay again. */
export const forgetFamilyPack = (family?: string) => forgetPack(FAMILY_PACK, family ? family.trim() : undefined)

/** This tab wrote for the family member, sending it at `sentAt`: no pack the relay began reading before then is drawn. */
export const wroteFamilyPack = (family: string, sentAt?: number) => wrotePack(FAMILY_PACK, family.trim(), sentAt)

/** A pack part as its section's answer — when `fits` it — else the section's own action. */
export async function familyPackOr(family: string, part: string, action: () => Promise<unknown>,
  fits: (part: unknown) => boolean = () => true): Promise<unknown> {
  const key = family.trim()
  const got = key ? await packPart(key, part) : null
  if (got && fits(got.part)) return stampAnswer(got.part, got.builtAt)
  return action()
}

// The index's part of the family member when it holds it — their own pack then made ready behind it — else the…
async function indexOr(family: string, part: 'overviews' | 'notes', next: () => Promise<unknown>): Promise<unknown> {
  const key = family.trim()
  const held = key ? await indexPart(key, part) : null
  if (!held) return next()
  prefetchFamily(key)
  return held
}

/* ---------- the reads, one per section ---------- */

export const readOverview = (family: string) => indexOr(family, 'overviews', () =>
  familyPackOr(family, 'overview', () => gasAction<unknown>('familyProfileOverview', { family }), isObject))
export const readDocuments = (family: string) =>
  familyPackOr(family, 'documents', () => gasAction<unknown>('familyProfileDocuments', { family }), isObject)
export const readActivity = (family: string) =>
  familyPackOr(family, 'activity', () => gasAction<unknown>('familyProfileActivity', { family }), isObject)
export const readNotes = (family: string) => indexOr(family, 'notes', () =>
  familyPackOr(family, 'notes', () => gasAction<unknown>('familyProfileNotes', { family }), isObject))
