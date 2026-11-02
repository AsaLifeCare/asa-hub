// WHERE EACH CANDIDATE SECTION IS READ, in the platform's lane order — the first that answers: 1.
// the candidates slice — the Hiring board's own rows: the switcher's roster, the Pipeline, and the at-a-glance and…
import { gasAction } from '@/features/hiring/shared'
import { wornTypes } from '@/lib/badgeAccess'
import { effectiveUser } from '@/lib/effectiveUser'
import { readSlice } from '@/lib/snapshotClient'
import {
  answerStamp, forgetPack, prefetchPack, readPackPart, shelfServesHere, stampAnswer, wrotePack,
} from '@/lib/appPack'
import { slicesAt } from '@/pages/features/locations/locationReads'
import { rosterFrom, rosterOf, switcherCandidates } from './candidateModel'

export const CANDIDATE_PACK = 'staff-candidates'

/** How long a person's read waits on a candidate's pack being gathered, once, before its section reads its action. */
export const CANDIDATE_PACK_WAIT_S = 4

/** When an answer's source was made (the slice's build, the relay's pack); '' for an answer read live. */
export const candidateAnswerAt = answerStamp

/** A reader the server may narrow to the candidates tied to their houses: never the master. */
export function mayBeNarrowed(): boolean {
  const u = effectiveUser()
  if (!u || u.isMaster) return false
  return String(u.role ?? '').toLowerCase() === 'client' || wornTypes(u).some((t) => t === 'CLIENT' || t === 'FAMILY' || t === 'SSA')
}

/* ---------- lane 1: the candidates slice ---------- */

/** The candidates slice's rows; null when they are not on the shelf here, or for a reader the server may narrow. */
async function candidatesShelf(): Promise<{ rows: unknown[]; at: string } | null> {
  if (!shelfServesHere() || mayBeNarrowed()) return null
  const rows = await readSlice<unknown>('candidates')
  // a crossing while the slice was read
  if (!shelfServesHere() || !rows?.length) return null
  return { rows, at: slicesAt(['candidates']) }
}

/** The switcher's order of the candidates in the process, from the slice; none when it is not on the shelf here. */
async function candidateOrder(): Promise<string[]> {
  const shelf = await candidatesShelf()
  if (!shelf) return []
  return switcherCandidates(rosterOf(rosterFrom(shelf.rows)).candidates, '').map((c) => c.key)
}

/* ---------- lane 2: the relay's pack ---------- */

async function prefetchNeighbours(key: string): Promise<void> {
  const order = await candidateOrder()
  if (!shelfServesHere()) return
  const at = order.indexOf(key)
  if (at === -1) return
  for (const next of [order[at - 1], order[at + 1]]) if (next) prefetchPack(CANDIDATE_PACK, next)
}

// A candidate the switcher or the Pipeline points at: their pack asked of the relay's memory while the browser is…
export function prefetchCandidate(key: string): void {
  const k = key.trim()
  if (!k) return
  void candidateOrder().then((order) => {
    if (order.includes(k)) prefetchPack(CANDIDATE_PACK, k)
  }).catch(() => {})
}

async function packPart(key: string, part: string): Promise<{ part: unknown; builtAt: string } | null> {
  if (mayBeNarrowed()) return null
  // a candidate the slice does not carry: the relay keeps no pack for them
  const order = await candidateOrder().catch((): string[] => [])
  if (order.length && !order.includes(key)) return null
  const got = await readPackPart(CANDIDATE_PACK, key, part, { waitS: CANDIDATE_PACK_WAIT_S })
  if (got) void prefetchNeighbours(key).catch(() => {})
  return got
}

/** Forget one candidate's pack, or every candidate's: it is asked of the relay again. */
export const forgetCandidatePack = (key?: string) => forgetPack(CANDIDATE_PACK, key ? key.trim() : undefined)

/** This tab wrote for the candidate, sending it at `sentAt`: no pack the relay began reading before then is drawn. */
export const wroteCandidatePack = (key: string, sentAt?: number) => wrotePack(CANDIDATE_PACK, key.trim(), sentAt)

/** A pack part as its section's answer — when `fits` it — else the section's own action. */
export async function candidatePackOr(key: string, part: string, action: () => Promise<unknown>,
  fits: (part: unknown) => boolean = () => true): Promise<unknown> {
  const k = key.trim()
  const got = k ? await packPart(k, part) : null
  if (got && fits(got.part)) return stampAnswer(got.part, got.builtAt)
  return action()
}

/* ---------- the reads, one per section ---------- */

// The switcher and the Pipeline: every candidate on the board, from the slice; `live`, or with no slice here, the…
export async function readRoster(live: boolean): Promise<unknown> {
  if (!live) {
    const shelf = await candidatesShelf()
    if (shelf) return stampAnswer(rosterFrom(shelf.rows), shelf.at)
  }
  return gasAction<unknown>('candidateProfileRoster', {})
}

const isObject = (v: unknown): boolean => !!v && typeof v === 'object' && !Array.isArray(v)

export const readOverview = (candidate: string) =>
  candidatePackOr(candidate, 'overview', () => gasAction<unknown>('candidateProfileOverview', { candidate }), isObject)
export const readActions = (candidate: string) =>
  candidatePackOr(candidate, 'actions', () => gasAction<unknown>('candidateProfileActions', { candidate }), isObject)
export const readInterviews = (candidate: string) =>
  candidatePackOr(candidate, 'interviews', () => gasAction<unknown>('candidateProfileInterviews', { candidate }), isObject)
export const readDocuments = (candidate: string) =>
  candidatePackOr(candidate, 'documents', () => gasAction<unknown>('candidateProfileDocuments', { candidate }), isObject)
export const readActivity = (candidate: string) =>
  candidatePackOr(candidate, 'activity', () => gasAction<unknown>('candidateProfileActivity', { candidate }), isObject)
export const readTranscripts = (candidate: string) =>
  candidatePackOr(candidate, 'transcripts', () => gasAction<unknown>('candidateProfileTranscripts', { candidate }), isObject)

/** The texts: the pack holds the latest thread; another counterpart, or an earlier page, is the action's. */
export function readTexts(candidate: string, withId = '', before = ''): Promise<unknown> {
  const ask = () => gasAction<unknown>('candidateProfileTexts', {
    candidate, ...(withId ? { with: withId } : {}), ...(before ? { before } : {}),
  })
  return withId || before ? ask() : candidatePackOr(candidate, 'texts', ask, isObject)
}

/** One call's words: never held by the pack, and every read is logged with who asked. */
export const readTranscript = (candidate: string, id: string) =>
  gasAction<unknown>('candidateProfileTranscript', { candidate, id })

/** Information's resume: never a pack part — its file is read only when this section asks, and kept by the server. */
export const readResume = (candidate: string) =>
  gasAction<unknown>('candidateProfileResume', { candidate }, { timeoutMs: 120000 })
