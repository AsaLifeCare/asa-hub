// WHERE EACH CLIENT CANDIDATE SECTION IS READ, in the platform's lane order — the first that answers: 1.
// the potentialClients slice — the Potential Clients app's own rows: the switcher's roster, the Pipeline, and the…
import { gasAction } from '@/features/hiring/shared'
import { readSlice } from '@/lib/snapshotClient'
import {
  answerStamp, forgetPack, prefetchPack, readPackPart, shelfServesHere, stampAnswer, wrotePack,
} from '@/lib/appPack'
import { slicesAt } from '@/pages/features/locations/locationReads'
import { inIntake, rosterFrom, rosterOf, switcherCandidates } from './candidateModel'

export const CANDIDATE_PACK = 'client-candidates'

/** How long a person's read waits on a referral's pack being gathered, once, before its section reads its action. */
export const CANDIDATE_PACK_WAIT_S = 4

/** When an answer's source was made (the slice's build, the relay's pack); '' for an answer read live. */
export const candidateAnswerAt = answerStamp

/** A key the relay's pack door takes — a referral row's id as ClientCandidates.gs takes it. */
export const PACK_KEY_RE = /^[A-Za-z0-9_-]{3,80}$/

/* ---------- lane 1: the potentialClients slice ---------- */

/** The potentialClients slice's rows; null when they are not on the shelf here. */
async function referralsShelf(): Promise<{ rows: unknown[]; at: string } | null> {
  if (!shelfServesHere()) return null
  const rows = await readSlice<unknown>('potentialClients')
  // a crossing while the slice was read
  if (!shelfServesHere() || !rows?.length) return null
  return { rows, at: slicesAt(['potentialClients']) }
}

// The switcher's order of the referrals the relay keeps a pack for, from the slice; none when it is not on the…
async function packOrder(): Promise<string[]> {
  const shelf = await referralsShelf()
  if (!shelf) return []
  return switcherCandidates(rosterOf(rosterFrom(shelf.rows)).candidates, '')
    .filter((r) => PACK_KEY_RE.test(r.key) && inIntake(r)).map((r) => r.key)
}

/* ---------- lane 2: the relay's pack ---------- */

async function prefetchNeighbours(key: string): Promise<void> {
  const order = await packOrder()
  if (!shelfServesHere()) return
  const at = order.indexOf(key)
  if (at === -1) return
  for (const next of [order[at - 1], order[at + 1]]) if (next) prefetchPack(CANDIDATE_PACK, next)
}

/** A referral the switcher or the Pipeline points at: its pack asked of the relay's memory while the browser is idle. */
export function prefetchCandidate(key: string): void {
  const k = key.trim()
  if (!k) return
  void packOrder().then((order) => {
    if (order.includes(k)) prefetchPack(CANDIDATE_PACK, k)
  }).catch(() => {})
}

async function packPart(key: string, part: string): Promise<{ part: unknown; builtAt: string } | null> {
  if (!PACK_KEY_RE.test(key)) return null
  // a referral out of the intake: the relay keeps no pack for it
  const order = await packOrder().catch((): string[] => [])
  if (order.length && !order.includes(key)) return null
  const got = await readPackPart(CANDIDATE_PACK, key, part, { waitS: CANDIDATE_PACK_WAIT_S })
  if (got) void prefetchNeighbours(key).catch(() => {})
  return got
}

/** Forget one referral's pack, or every referral's: it is asked of the relay again. */
export const forgetCandidatePack = (key?: string) => forgetPack(CANDIDATE_PACK, key ? key.trim() : undefined)

/** This tab wrote for the referral, sending it at `sentAt`: no pack the relay began reading before then is drawn. */
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

// The switcher and the Pipeline: every referral, from the slice; `live`, or with no slice here, the action's…
export async function readRoster(live: boolean): Promise<unknown> {
  if (!live) {
    const shelf = await referralsShelf()
    if (shelf) return stampAnswer(rosterFrom(shelf.rows), shelf.at)
  }
  return gasAction<unknown>('clientCandidateRoster', {})
}

const isObject = (v: unknown): boolean => !!v && typeof v === 'object' && !Array.isArray(v)

export const readOverview = (candidate: string) =>
  candidatePackOr(candidate, 'overview', () => gasAction<unknown>('clientCandidateOverview', { candidate }), isObject)
export const readActions = (candidate: string) =>
  candidatePackOr(candidate, 'actions', () => gasAction<unknown>('clientCandidateActions', { candidate }), isObject)
export const readIntake = (candidate: string) =>
  candidatePackOr(candidate, 'intake', () => gasAction<unknown>('clientCandidateIntake', { candidate }), isObject)
export const readDocuments = (candidate: string) =>
  candidatePackOr(candidate, 'documents', () => gasAction<unknown>('clientCandidateDocuments', { candidate }), isObject)
export const readActivity = (candidate: string) =>
  candidatePackOr(candidate, 'activity', () => gasAction<unknown>('clientCandidateActivity', { candidate }), isObject)
export const readTranscripts = (candidate: string) =>
  candidatePackOr(candidate, 'transcripts', () => gasAction<unknown>('clientCandidateTranscripts', { candidate }), isObject)

/** The texts: the pack holds the latest thread; another counterpart, or an earlier page, is the action's. */
export function readTexts(candidate: string, withId = '', before = ''): Promise<unknown> {
  const ask = () => gasAction<unknown>('clientCandidateTexts', {
    candidate, ...(withId ? { with: withId } : {}), ...(before ? { before } : {}),
  })
  return withId || before ? ask() : candidatePackOr(candidate, 'texts', ask, isObject)
}

/** One call's words: never held by the pack, and every read is logged with who asked. */
export const readTranscript = (candidate: string, id: string) =>
  gasAction<unknown>('clientCandidateTranscript', { candidate, id })
