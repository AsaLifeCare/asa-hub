// Client Candidates' doors: each section read in lane order (candidateReads.ts) — the potentialClients slice, then…
// An answer is kept in memory for the session so a section and its panel share it; a write forgets the referral's…
import { useCallback, useEffect, useRef, useState } from 'react'
import { SESSION_EXPIRED, gasAction, isRelayReceipt } from '@/features/hiring/shared'
import { forgetDocBytes, onAppRing, onMemoryBoundary, readDocBytesHeld } from '@/lib/appPack'
import { invalidate } from '@/lib/apiCache'
import { wornTypes } from '@/lib/badgeAccess'
import { EDITION_ROLES } from '@/lib/editions'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { usePlatformDoc } from '@/lib/platformDoc'
import type { EditChange } from '@/lib/recordEdit'
import { noteWrite } from '@/lib/snapshotClient'
import type { ApplyTarget } from '@/pages/features/locations/ApplyStrip'
import type { Reread } from '@/pages/features/locations/useLocation'
import {
  CANDIDATES_APP_ID, STAGE_IDS, candidateEditionsOf, readRefusal, stageId, type CandidateEdition, type CandidateWrite,
  type EditSection, type PaperDoc,
} from './candidateModel'
import {
  CANDIDATE_PACK, candidateAnswerAt, forgetCandidatePack, readActions, readDocuments, readIntake, readOverview,
  wroteCandidatePack,
} from './candidateReads'

/* ---------- the reads ---------- */

export {
  readActions, readActivity, readDocuments, readIntake, readOverview, readRoster, readTexts, readTranscript, readTranscripts,
} from './candidateReads'

/* ---------- a document, as bytes for the platform's centred viewer ---------- */

/** A PDF or a picture as itself, a Google or Office document exported as PDF; only a file this referral's list names. */
export type DocFileAnswer = { name: string; mime: string; b64: string; exported?: boolean }

/** Through the referral's own door, held in memory for the tab so opening it again is instant (appPack). */
export const readDocFile = (candidate: string, fileId: string) =>
  readDocBytesHeld(`${CANDIDATE_PACK}|${candidate}|doc|${fileId}`,
    () => gasAction<DocFileAnswer>('clientCandidateDocFile', { candidate, file_id: fileId }))

// A paper the door renders as a PDF (the referral summary, the assessment read from the plan).
export const readDocRender = (candidate: string, doc: string) =>
  gasAction<DocFileAnswer>('clientCandidateDocFile', { candidate, doc })

export type CandidateDocOpener = {
  /** '<candidate>|<file or paper>' whose bytes are on their way; '' when none */
  opening: string
  open: (candidate: string, fileId: string, title: string, subtitle?: string) => void
  render: (candidate: string, doc: string, title: string, subtitle?: string) => void
}

/** A document in the platform's centred viewer, from its bytes; never a side panel, never a link. */
export function useCandidateDocs(): CandidateDocOpener {
  const doc = usePlatformDoc(readRefusal)
  return {
    opening: doc.opening,
    open: (candidate, fileId, title, subtitle = 'Client candidate') =>
      doc.open(`${candidate}|${fileId}`, () => readDocFile(candidate, fileId), { title, subtitle }),
    render: (candidate, paper, title, subtitle = 'Client candidate') =>
      doc.open(`${candidate}|${paper}`, () => readDocRender(candidate, paper), { title, subtitle }),
  }
}

/* ---------- the presses: the Potential Clients row itself (none is safe to send twice) ---------- */

export const REFERRALS = 'potentialClients'

type PressAnswer = { entry?: { at?: string; by?: string; text?: string }; row?: { id?: string; stage?: string } }

/** The row the press answered with, patched into the slice held here so the roster and the Pipeline show it at once. */
function patchSlice(candidate: string, got: unknown): void {
  const row = got && typeof got === 'object' ? (got as PressAnswer).row : undefined
  if (row && row.id === candidate && typeof row.stage === 'string') noteWrite(REFERRALS, { id: candidate, row: { id: candidate, stage: row.stage } })
}

// One press on the referral's row (ClientCandidates.gs clientCandidateWrite, on the row as it stands under the…
export async function writeCandidate(candidate: string, press: CandidateWrite): Promise<unknown> {
  if (!candidate) throw new Error('Nothing to write.')
  if (press.kind === 'note' && !press.note.trim()) throw new Error('Write the note first.')
  if (press.kind === 'stage' && !STAGE_IDS.includes(stageId(press.stage))) throw new Error('Pick a stage first.')
  const payload: Record<string, string> = { candidate_id: candidate, kind: press.kind }
  if (press.kind === 'stage') payload.stage = press.stage
  if (press.kind !== 'stage' && press.item) payload.item = press.item
  if (press.kind !== 'stage' && press.note?.trim()) payload.note = press.note.trim()
  const got = await gasAction<unknown>('clientCandidateWrite', payload, { retry: false })
  patchSlice(candidate, got)
  return got
}

/** A paper as the file door takes it. */
export type FiledPaper = { name: string; mime: string; b64: string }

// A paper filed for the referral (ClientCandidates.gs clientCandidateFile): the support assessment, or the signed…
export function fileCandidateDoc(candidate: string, filing:
  | { doc: 'assessment'; file: FiledPaper }
  | { doc: 'consent'; file: FiledPaper; method: string; best_time: string; contact_who: string }
  | { doc: 'consent'; confirm: true }): Promise<unknown> {
  if (!candidate) return Promise.reject(new Error('Nothing to file.'))
  return gasAction<unknown>('clientCandidateFile', { candidate_id: candidate, ...filing }, { retry: false })
}

/* ---------- the editions' own doors (Python's alone: offered only as editionsMine names them) ---------- */

/** An edition's panel read: the raw values its fields open on, the save's witness. */
export const readEdit = (candidate: string, section: EditSection | 'note' | 'document', extra: { doc?: string; id?: string } = {}) =>
  gasAction<unknown>('clientCandidateEditRead', { candidate, section, ...extra })

/** Information or the intake's answers: only the fields that changed, each with the value the panel opened on. */
export const saveCandidate = (candidate: string, section: EditSection, changes: EditChange[]) =>
  gasAction<unknown>('clientCandidateEdit', { candidate, section, changes }, { retry: false })

/** A note's words changed, or the note removed (`state: removed`, its words the witness). */
export const editNote = (candidate: string, id: string, changes: EditChange[]) =>
  gasAction<unknown>('clientCandidateNoteEdit', { candidate, id, changes }, { retry: false })

/** A filed paper's record on the row: the consent's confirmation, or the record taken off. */
export const editPaper = (candidate: string, doc: PaperDoc, changes: EditChange[]) =>
  gasAction<unknown>('clientCandidateDocEdit', { candidate, doc, changes }, { retry: false })

/* ---------- the editions this viewer makes in Client Candidates (Settings › Editions) ---------- */

const editionsAsked = new Map<string, Promise<CandidateEdition[]>>()

onMemoryBoundary(() => {
  editionsAsked.clear()
})

/** editionsMine for Client Candidates; an answer without its list is "not confirmed", never "none", and is asked again. */
export async function readCandidateEditions(): Promise<CandidateEdition[]> {
  const d = await gasAction<{ editions?: unknown }>('editionsMine', { app: CANDIDATES_APP_ID })
  if (isRelayReceipt(d) || !Array.isArray(d?.editions)) throw new Error('The editions were not confirmed.')
  return candidateEditionsOf(d.editions)
}

function editionsOnce(who: string): Promise<CandidateEdition[]> {
  const asked = editionsAsked.get(who)
  if (asked) return asked
  const p = readCandidateEditions()
  p.catch(() => { if (editionsAsked.get(who) === p) editionsAsked.delete(who) })
  editionsAsked.set(who, p)
  return p
}

/** How long an unconfirmed read of the editions waits before it is asked again. */
export const EDITIONS_RETRY_MS = 30_000

const NO_EDITIONS: readonly CandidateEdition[] = []

// The editions this viewer makes here, once a session, the master's too; none asked in a visit or by a client.
export function useCandidateEditions(): readonly CandidateEdition[] {
  const viewer = useEffectiveUser()
  const narrowed = !viewer?.isMaster && (String(viewer?.role ?? '').toLowerCase() === 'client'
    || wornTypes({ types: viewer?.types }).some((t) => t === 'CLIENT' || t === 'FAMILY' || t === 'SSA'))
  const asks = !!viewer && !viewer.visiting && !narrowed && EDITION_ROLES.includes(String(viewer.role ?? '').toLowerCase())
  const who = asks && viewer ? viewer.id : ''
  const [got, setGot] = useState<{ who: string; editions: CandidateEdition[] }>({ who: '', editions: [] })
  useEffect(() => {
    if (!who) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const ask = () => {
      editionsOnce(who)
        .then((editions) => { if (live) setGot({ who, editions }) })
        .catch(() => { if (live) timer = setTimeout(ask, EDITIONS_RETRY_MS) })
    }
    ask()
    return () => {
      live = false
      if (timer) clearTimeout(timer)
    }
  }, [who])
  return who && got.who === who ? got.editions : NO_EDITIONS
}

/* ---------- an Apply's target: the referral read again after the write ---------- */

/** The sections an Apply reads again, as the sections themselves key them. */
export const CANDIDATE_REREAD = {
  overview: (c: string): Reread => ({ key: readKey('clientCandidateOverview', c), load: () => readOverview(c) }),
  actions: (c: string): Reread => ({ key: readKey('clientCandidateActions', c), load: () => readActions(c) }),
  intake: (c: string): Reread => ({ key: readKey('clientCandidateIntake', c), load: () => readIntake(c) }),
  documents: (c: string): Reread => ({ key: readKey('clientCandidateDocuments', c), load: () => readDocuments(c) }),
}

/** The sections read again through the one read per key every section on screen shares. */
export const rereadCandidate = (list: Reread[]): Promise<unknown[]> => Promise.all(list.map((r) => readOnce(r.key, r.load)))

/** A referral as an Apply's target (ApplyStrip.useApplyFor). */
export const candidateTarget = (candidate: string): ApplyTarget => ({
  where: { app: CANDIDATE_PACK, label: 'Client Candidates', subject: 'candidate' },
  overlaid: () => candidateWritten(candidate),
  wrote: (answer, sentAt) => { candidateWrote(candidate, answer, sentAt) },
  written: (sentAt) => candidateWritten(candidate, sentAt),
  reread: rereadCandidate,
})

// Opening a referral is the acknowledgement Potential Clients records (Scraper.gs leadOpened: an alerted referral…
export async function reportOpened(candidate: string): Promise<boolean> {
  const sentAt = Date.now()
  const got = await gasAction<unknown>('leadOpened', { ids: [candidate] })
  if (writeQueued(got)) {
    candidateWrote(candidate, got, sentAt)
    return false
  }
  const results = got && typeof got === 'object' ? (got as { results?: unknown }).results : null
  const hit = (Array.isArray(results) ? results : [got]).find((r) => r && typeof r === 'object' && (r as { id?: unknown }).id === candidate) as
    { stage?: unknown; unchanged?: unknown; error?: unknown } | undefined
  if (!hit || hit.error || hit.unchanged || hit.stage !== 'read') return false
  noteWrite(REFERRALS, { id: candidate, row: { id: candidate, stage: 'read' } })
  candidateWritten(candidate, sentAt)
  return true
}

/* ---------- the hook ---------- */

export type ReadState<T> = {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  data: T | null
  error: string
  refreshing: boolean
  /** when what is drawn was made: the slice's or the pack's own stamp, else when it was read live */
  updatedAt?: string
}

export const IDLE: ReadState<never> = { status: 'idle', data: null, error: '', refreshing: false }

/** An answer this old is read again when a section opens; a younger one is drawn as it is. */
const FRESH_MS = 60_000

const held = new Map<string, { at: number; raw: unknown }>()
const inflight = new Map<string, Promise<unknown>>()
const written = new Set<(candidate: string) => void>()
// bumped at a memory boundary: an answer asked for before it is never held after it
let heldEpoch = 0

onMemoryBoundary(() => {
  heldEpoch++
  held.clear()
  inflight.clear()
})

// the app rang: every held answer is read again when it is drawn
onAppRing(CANDIDATE_PACK, () => {
  for (const hit of held.values()) hit.at = 0
})

const candidateOfKey = (key: string): string => key.split('|')[1] ?? ''

/** Forget the answers held for a referral (every section's), or every answer — and the referral's pack and documents. */
export function forgetCandidateReads(candidate?: string): void {
  const one = candidate && candidate !== '*' ? candidate : ''
  forgetCandidatePack(one || undefined)
  forgetDocBytes(one ? `${CANDIDATE_PACK}|${one}|` : `${CANDIDATE_PACK}|`)
  if (!candidate) {
    held.clear()
    return
  }
  for (const k of [...held.keys()]) if (candidateOfKey(k) === candidate || candidateOfKey(k) === '*') held.delete(k)
}

// A write landed for this referral: its answers and the roster are forgotten, and every section on screen reads…
export function candidateWritten(candidate: string, sentAt?: number): void {
  forgetCandidateReads(candidate)
  if (candidate && candidate !== '*') wroteCandidatePack(candidate, sentAt)
  invalidate(REFERRALS)
  for (const fn of [...written]) fn(candidate)
}

/** The relay's ledger took the write without running it yet: {accepted:true, queued|confirmed:false} and no record. */
export function writeQueued(answer: unknown): boolean {
  if (!answer || typeof answer !== 'object') return false
  const o = answer as Record<string, unknown>
  if (typeof o.id === 'string' && o.id.startsWith('pending-')) return true
  return o.accepted === true && Object.keys(o).length <= 2
}

/** Long enough for the ledger to run a queued write before the referral is read once more. */
export const QUEUED_REREAD_MS = 8_000

// A write sent at `sentAt` answered: the referral is read again now, and once more after a queued write has had…
export function candidateWrote(candidate: string, answer: unknown, sentAt?: number): boolean {
  candidateWritten(candidate, sentAt)
  const queued = writeQueued(answer)
  if (queued) {
    const t = setTimeout(() => candidateWritten(candidate, sentAt), QUEUED_REREAD_MS) as unknown as { unref?: () => void }
    t.unref?.()
  }
  return queued
}

export const QUEUED_WORDS = 'Accepted — it shows here once the server has written it.'

function readOnce(key: string, load: () => Promise<unknown>): Promise<unknown> {
  const running = inflight.get(key)
  if (running) return running
  const asked = heldEpoch
  const p: Promise<unknown> = load()
    .then((raw) => {
      if (asked === heldEpoch) held.set(key, { at: Date.now(), raw })
      return raw
    })
    .finally(() => {
      if (inflight.get(key) === p) inflight.delete(key)
    })
  inflight.set(key, p)
  return p
}

const stampOf = (raw: unknown, readAt: number): string => candidateAnswerAt(raw) || new Date(readAt).toISOString()

/** A refusal says this session may not see the referral: nothing held is drawn in its place. */
export function readRefused(err: unknown): boolean {
  const status = err && typeof err === 'object' ? (err as { status?: unknown }).status : undefined
  if (status === 401 || status === 403 || status === 404) return true
  const said = err instanceof Error ? err.message : String(err)
  return said === SESSION_EXPIRED || /unknown action/i.test(said)
}

/** The key an answer is held under: the action, the referral, then any parameter. The roster's referral is '*'. */
export const readKey = (action: string, candidate: string, ...rest: (string | boolean)[]): string =>
  [action, candidate, ...rest.map(String)].join('|')

// One read, keyed.
export function useCandidateRead<T>(key: string | null, load: () => Promise<unknown>, shape: (raw: unknown) => T):
  ReadState<T> & { reload: () => void } {
  const loadRef = useRef(load)
  const shapeRef = useRef(shape)
  useEffect(() => {
    loadRef.current = load
    shapeRef.current = shape
  })
  const [tick, setTick] = useState(0)
  const handled = useRef(0)
  const [slot, setSlot] = useState<{ key: string | null; state: ReadState<T> }>({ key: null, state: IDLE })

  const again = useCallback(() => {
    setSlot((s) => (s.key === key ? { key, state: { ...s.state, refreshing: true } } : s))
    setTick((t) => t + 1)
  }, [key])

  useEffect(() => {
    if (!key) return
    const fn = (candidate: string) => {
      if (candidateOfKey(key) === candidate || candidateOfKey(key) === '*') again()
    }
    written.add(fn)
    return () => {
      written.delete(fn)
    }
  }, [key, again])

  // the app rang: what is drawn stays, and is read again
  useEffect(() => (key ? onAppRing(CANDIDATE_PACK, again) : undefined), [key, again])

  // another account, a visit, a tenant or a world: nothing drawn for the one before, and read again
  useEffect(() => onMemoryBoundary(() => {
    setSlot({ key: null, state: IDLE })
    setTick((t) => t + 1)
  }), [])

  useEffect(() => {
    if (!key) return
    const forced = tick !== handled.current
    handled.current = tick
    const hit = held.get(key)
    if (hit && !forced && Date.now() - hit.at < FRESH_MS) return
    let live = true
    const epoch = heldEpoch
    readOnce(key, () => loadRef.current())
      .then((raw) => {
        if (!live || epoch !== heldEpoch) return
        setSlot({ key, state: { status: 'ready', data: shapeRef.current(raw), error: '', refreshing: false,
          updatedAt: stampOf(raw, held.get(key)?.at ?? Date.now()) } })
      })
      .catch((err: unknown) => {
        if (!live || epoch !== heldEpoch) return
        const error = err instanceof Error ? err.message : String(err)
        if (readRefused(err)) {
          held.delete(key)
          setSlot({ key, state: { status: 'failed', data: null, error, refreshing: false } })
          return
        }
        setSlot((s) => ({
          key, state: { status: 'failed', data: s.key === key ? s.state.data : hit ? shapeRef.current(hit.raw) : null, error, refreshing: false,
            updatedAt: s.key === key ? s.state.updatedAt : hit ? stampOf(hit.raw, hit.at) : undefined },
        }))
      })
    return () => {
      live = false
    }
  }, [key, tick])

  let state: ReadState<T> = IDLE
  if (key && slot.key === key) state = slot.state
  else if (key) {
    // a key not answered here yet: the session's held answer, drawn at once (read again behind it when stale), or reading
    const hit = held.get(key)
    state = hit ? { status: 'ready', data: shape(hit.raw), error: '', refreshing: false, updatedAt: stampOf(hit.raw, hit.at) }
      : { ...IDLE, status: 'loading' }
  }
  return { ...state, reload: again }
}
