// SSA's doors: each section read in lane order (ssaReads.ts) — the slices, then the relay's pack, then the one Apps…
// An answer is kept in memory for the session so a section and its panel share it; a write forgets the SSA's…
import { useEffect, useState } from 'react'
import { gasAction, isRelayReceipt } from '@/features/hiring/shared'
import { forgetDocBytes, onMemoryBoundary, readDocBytesHeld } from '@/lib/appPack'
import { EDITION_ROLES } from '@/lib/editions'
import { useEffectiveUser } from '@/lib/effectiveUser'
import {
  createReadCache, readKey, readRefused, useCachedRead, writtenAgainIfQueued, type ReadState,
} from '@/lib/readCache'
import { usePlatformDoc } from '@/lib/platformDoc'
import type { EditChange } from '@/lib/recordEdit'
import type { ApplyTarget } from '@/pages/features/locations/ApplyStrip'
import type { Reread } from '@/pages/features/locations/useLocation'
import { SSA_APP_ID, SSA_EDITIONS, narrowedViewer, readRefusal } from './ssaModel'
import {
  SSA_PACK, forgetSsaPack, readActivity, readDocuments, readNotes, readOverview, ssaAnswerAt, wroteSsaPack,
} from './ssaReads'

/* ---------- the reads ---------- */

export { heldRoster, readActivity, readDocuments, readNotes, readOverview, readRoster } from './ssaReads'

/* ---------- a document, as bytes for the platform's centred viewer ---------- */

/** A PDF or a picture as itself, a Google or Office document exported as PDF; only a file this SSA's list names. */
export type DocFileAnswer = { name: string; mime: string; b64: string; exported?: boolean }

/** Through the SSA's own door, held in memory for the tab so opening it again is instant (appPack). */
export const readDocFile = (ssa: string, fileId: string) =>
  readDocBytesHeld(`${SSA_PACK}|${ssa}|doc|${fileId}`,
    () => gasAction<DocFileAnswer>('ssaProfileDocFile', { ssa, file_id: fileId }))

export type SsaDocOpener = {
  /** '<ssa>|<file>' whose bytes are on their way; '' when none */
  opening: string
  open: (ssa: string, fileId: string, title: string, subtitle?: string) => void
}

/** A document in the platform's centred viewer, from its bytes; never a side panel, never a link. */
export function useSsaDocs(): SsaDocOpener {
  const doc = usePlatformDoc(readRefusal)
  return {
    opening: doc.opening,
    open: (ssa, fileId, title, subtitle = 'SSA') =>
      doc.open(`${ssa}|${fileId}`, () => readDocFile(ssa, fileId), { title, subtitle }),
  }
}

/* ---------- the writes (not safe to send twice) ---------- */

export const addNote = (ssa: string, body: string) =>
  gasAction<unknown>('ssaProfileNoteAdd', { ssa, body }, { retry: false })

/** The edit panel's read (Python's own door): the overview with the fields to edit, the save's witness. */
export const readEdit = (ssa: string) => gasAction<unknown>('ssaProfileEditRead', { ssa })

/** The SSA's details edited: only the fields that changed, each with the value the panel opened on. */
export const saveSsa = (ssa: string, changes: EditChange[]) =>
  gasAction<unknown>('ssaProfileEdit', { ssa, changes }, { retry: false })

/** The SSA ticked onto the records of `add` and taken off those of `remove`. */
export const saveSsaClients = (ssa: string, add: string[], remove: string[]) =>
  gasAction<{ added?: string[]; removed?: string[]; refused?: { client: string; why: string }[] }>(
    'ssaProfileClients', { ssa, add, remove }, { retry: false })

/** A Documents entry's title or date, or its removal (state removed), with the values the panel opened on. */
export const editDoc = (ssa: string, id: string, changes: EditChange[]) =>
  gasAction<unknown>('ssaProfileDocEdit', { ssa, id, changes }, { retry: false })

/** An Activity entry's title or text, or its removal (state removed), with the values the panel opened on. */
export const editActivity = (ssa: string, id: string, changes: EditChange[]) =>
  gasAction<unknown>('ssaProfileActivityEdit', { ssa, id, changes }, { retry: false })

/* ---------- the editions this viewer makes in SSA (Settings › Editions) ---------- */

const editionsAsked = new Map<string, Promise<string[]>>()

onMemoryBoundary(() => {
  editionsAsked.clear()
})

/** editionsMine for SSA; an answer without its list is "not confirmed", never "none", and is asked again. */
export async function readSsaEditions(): Promise<string[]> {
  const d = await gasAction<{ editions?: unknown }>('editionsMine', { app: SSA_APP_ID })
  if (isRelayReceipt(d) || !Array.isArray(d?.editions)) throw new Error('The editions were not confirmed.')
  return d.editions.map((x) => String(x ?? '').trim()).filter((x) => SSA_EDITIONS.includes(x))
}

function editionsOnce(who: string): Promise<string[]> {
  const held = editionsAsked.get(who)
  if (held) return held
  const p = readSsaEditions()
  p.catch(() => { if (editionsAsked.get(who) === p) editionsAsked.delete(who) })
  editionsAsked.set(who, p)
  return p
}

/** How long an unconfirmed read of the editions waits before it is asked again. */
export const EDITIONS_RETRY_MS = 30_000

const NO_EDITIONS: readonly string[] = []

// The editions this viewer makes here, once a session, the master's too; none asked in a visit or a narrowed view.
export function useSsaEditions(): readonly string[] {
  const viewer = useEffectiveUser()
  const asks = !!viewer && !viewer.visiting && !narrowedViewer(viewer)
    && EDITION_ROLES.includes(String(viewer.role ?? '').toLowerCase())
  const who = asks && viewer ? viewer.id : ''
  const [got, setGot] = useState<{ who: string; editions: string[] }>({ who: '', editions: [] })
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

/* ---------- the hook ---------- */

export {
  IDLE, QUEUED_REREAD_MS, QUEUED_WORDS, readKey, readRefused, writeQueued, type ReadState,
} from '@/lib/readCache'

// the roster ('*') reads again when any SSA is written; a refusal draws nothing held
const reads = createReadCache({ stamp: ssaAnswerAt, refused: readRefused, rosterFollows: true, app: SSA_PACK })

/** Forget the answers held for an SSA (every section's), or every answer — and the SSA's pack and documents. */
export function forgetSsaReads(ssa?: string): void {
  const one = ssa && ssa !== '*' ? ssa : ''
  forgetSsaPack(one || undefined)
  forgetDocBytes(one ? `${SSA_PACK}|${one}|` : `${SSA_PACK}|`)
  reads.forget(ssa || undefined)
}

/** A write landed for this SSA: their answers are forgotten and every section on screen reads again. */
export function ssaWritten(ssa: string, sentAt?: number): void {
  forgetSsaReads(ssa)
  if (ssa && ssa !== '*') wroteSsaPack(ssa, sentAt)
  reads.written(ssa)
}

/** A write sent at `sentAt` answered: the SSA is read again now, and once more after a queued write has had time to run. */
export function ssaWrote(ssa: string, answer: unknown, sentAt?: number): boolean {
  ssaWritten(ssa, sentAt)
  return writtenAgainIfQueued(answer, () => ssaWritten(ssa, sentAt))
}

/** The sections an Apply reads again, as the sections themselves key them. */
export const SSA_REREAD = {
  overview: (ssa: string): Reread => ({ key: readKey('ssaProfileOverview', ssa), load: () => readOverview(ssa) }),
  documents: (ssa: string): Reread => ({ key: readKey('ssaProfileDocuments', ssa), load: () => readDocuments(ssa) }),
  activity: (ssa: string): Reread => ({ key: readKey('ssaProfileActivity', ssa), load: () => readActivity(ssa) }),
  notes: (ssa: string): Reread => ({ key: readKey('ssaProfileNotes', ssa), load: () => readNotes(ssa) }),
}

/** The sections read again, through the one read per key every section on screen shares. */
export function rereadSsa(list: Reread[]): Promise<unknown[]> {
  return Promise.all(list.map((r) => reads.read(r.key, r.load)))
}

/** An SSA as an Apply's target (ApplyStrip.useApplyFor). */
export const ssaTarget = (ssa: string): ApplyTarget => ({
  where: { app: SSA_PACK, label: 'SSA', subject: 'SSA' },
  overlaid: () => ssaWritten(ssa),
  wrote: (answer, sentAt) => { ssaWrote(ssa, answer, sentAt) },
  written: (sentAt) => ssaWritten(ssa, sentAt),
  reread: rereadSsa,
})

// One read, keyed (readCache.useCachedRead): the held answer drawn at once and read again behind it when stale…
export function useSsaRead<T>(key: string | null, load: () => Promise<unknown>, shape: (raw: unknown) => T,
  first?: () => unknown): ReadState<T> & { reload: () => void } {
  return useCachedRead(reads, key, load, shape, first)
}
