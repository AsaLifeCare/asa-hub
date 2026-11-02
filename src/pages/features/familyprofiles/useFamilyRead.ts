// Families' doors: each section read in lane order (familyReads.ts) — the relay's index of the whole app, the…
// An answer is kept in memory for the session so a section and its panel share it; a write forgets the family…
import { useCallback, useEffect, useRef, useState } from 'react'
import { SESSION_EXPIRED, gasAction, isRelayReceipt } from '@/features/hiring/shared'
import { forgetDocBytes, onAppRing, onMemoryBoundary, readDocBytesHeld } from '@/lib/appPack'
import { EDITION_ROLES } from '@/lib/editions'
import { useEffectiveIsMaster, useEffectiveUser } from '@/lib/effectiveUser'
import type { EditChange } from '@/lib/recordEdit'
import { usePlatformDoc } from '@/lib/platformDoc'
import { toast } from '@/stores/useToastStore'
import type { ApplyTarget } from '@/pages/features/locations/ApplyStrip'
import type { Reread } from '@/pages/features/locations/useLocation'
import {
  familyEditionsOf, newFamilyPayload, readRefusal, type CallDraft, type FamilyEdition, type NewFamilyDraft, type RosterRow,
} from './familyModel'
import {
  FAMILY_PACK, familyAnswerAt, forgetFamilyIndex, forgetFamilyOrder, forgetFamilyPack, readActivity as activityRead,
  readNotes as notesRead, readOverview as overviewRead, wroteFamilyIndex, wroteFamilyPack,
} from './familyReads'

/* ---------- the reads ---------- */

export { readActivity, readDocuments, readNotes, readOverview, readRoster } from './familyReads'

/* ---------- a document, as bytes for the platform's centred viewer ---------- */

/** A PDF or a picture as itself, a Google or Office document exported as PDF; only a file this family member's list names. */
export type DocFileAnswer = { name: string; mime: string; b64: string; exported?: boolean }

/** Through the family member's own door, held in memory for the tab so opening it again is instant (appPack). */
export const readDocFile = (family: string, fileId: string) =>
  readDocBytesHeld(`${FAMILY_PACK}|${family}|doc|${fileId}`,
    () => gasAction<DocFileAnswer>('familyProfileDocFile', { family, file_id: fileId }))

export type FamilyDocOpener = {
  /** '<family>|<file>' whose bytes are on their way; '' when none */
  opening: string
  open: (family: string, fileId: string, title: string, subtitle?: string) => void
}

/** A document in the platform's centred viewer, from its bytes; never a side panel, never a link. */
export function useFamilyDocs(): FamilyDocOpener {
  const master = useEffectiveIsMaster()
  const doc = usePlatformDoc((e) => readRefusal(e, master))
  return {
    opening: doc.opening,
    open: (family, fileId, title, subtitle = 'Families & Guardians') =>
      doc.open(`${family}|${fileId}`, () => readDocFile(family, fileId), { title, subtitle }),
  }
}

/* ---------- the writes (not safe to send twice) ---------- */

export const addNote = (family: string, body: string) =>
  gasAction<unknown>('familyProfileNoteAdd', { family, body }, { retry: false })

export const scheduleCall = (draft: CallDraft) =>
  gasAction<unknown>('familyProfileCallSchedule', { ...draft }, { retry: false })

/** What the edit panel opens on: the overview with the master's `edit` witness, read live, never from the pack. */
export const readEdit = (family: string) => gasAction<unknown>('familyProfileOverview', { family, edit: true })

/** The member's details edited: only the fields that changed, each with the value the panel opened on. */
export const saveFamily = (family: string, changes: EditChange[]) =>
  gasAction<unknown>('familyProfileSave', { family, changes }, { retry: false })

/** What the note and call panels open on: the notes with each part's witnesses (Python's), read live, never from the pack. */
export const readAdminEdit = (family: string) => gasAction<unknown>('familyProfileNotes', { family, edit: true })

/** A note's text, or its removal (state removed), with the value the panel opened on. */
export const editNote = (family: string, id: string, changes: EditChange[]) =>
  gasAction<unknown>('familyProfileNoteEdit', { family, id, changes }, { retry: false })

/** A call filed from Families: its day, priority, state (cancelled included) or details. */
export const editCall = (family: string, id: string, changes: EditChange[]) =>
  gasAction<unknown>('familyProfileCallEdit', { family, id, changes }, { retry: false })

/** The clients New Family can tie a member to: whoever registers families. */
export const readClientChoices = () => gasAction<unknown>('familyClientChoices', {})

/** A family member registered in Families' own registry (New Family). */
export const createFamily = (draft: NewFamilyDraft) =>
  gasAction<unknown>('familyCreate', newFamilyPayload(draft), { retry: false })

/** A paper kept on a family member: a file the relay files in Drive (Families/<name>), or a Drive file by its link. */
export type FamilyPaper = { title: string; doc_type: string } & (
  { base64: string; filename: string; mime: string } | { drive: string })

export const addFamilyDoc = (family: string, paper: FamilyPaper) =>
  gasAction<unknown>('familyProfileDocAdd', { family, ...paper }, { retry: false })

/** An incident filed from here, tied to the family member by its client and the report's own timestamp; safe twice. */
export const tieIncident = (family: string, clientKey: string, incidentTs: string) =>
  gasAction<unknown>('familyProfileIncidentTie', { family, client_key: clientKey, incident_ts: incidentTs })

/** The panel's filed report tied to the family member and read back; a refusal says so, the report itself stays filed. */
export async function tieFiled(row: Pick<RosterRow, 'key' | 'name'>, clientKey: string, incidentTs: string): Promise<boolean> {
  const sentAt = Date.now()
  try {
    const got = await tieIncident(row.key, clientKey, incidentTs)
    familyWrote(row.key, got, sentAt, false)
    return true
  } catch (e) {
    toast({ type: 'danger', title: `Filed, but not tied to ${row.name}`, body: readRefusal(e instanceof Error ? e.message : String(e)) })
    return false
  }
}

/* ---------- the hook ---------- */

export type ReadState<T> = {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  data: T | null
  error: string
  refreshing: boolean
  /** when what is drawn was made: the pack's own stamp, else when it was read live */
  updatedAt?: string
}

export const IDLE: ReadState<never> = { status: 'idle', data: null, error: '', refreshing: false }

/** An answer this old is read again when a section opens; a younger one is drawn as it is. */
const FRESH_MS = 60_000

const held = new Map<string, { at: number; raw: unknown }>()
const inflight = new Map<string, Promise<unknown>>()
const written = new Set<(family: string) => void>()
// bumped at a memory boundary: an answer asked for before it is never held after it
let heldEpoch = 0

onMemoryBoundary(() => {
  heldEpoch++
  held.clear()
  inflight.clear()
  forgetFamilyOrder()
})

// the app rang: the index held here is asked of the relay again, and every held answer is read again when it is drawn
onAppRing(FAMILY_PACK, () => {
  forgetFamilyIndex()
  for (const hit of held.values()) hit.at = 0
})

const familyOfKey = (key: string): string => key.split('|')[1] ?? ''

// Forget the answers held for a family member (every section's), or every answer — and the pack, the index (which…
export function forgetFamilyReads(family?: string): void {
  const one = family && family !== '*' ? family : ''
  forgetFamilyPack(one || undefined)
  forgetFamilyIndex()
  forgetDocBytes(one ? `${FAMILY_PACK}|${one}|` : `${FAMILY_PACK}|`)
  if (!family) {
    held.clear()
    forgetFamilyOrder()
    return
  }
  for (const k of [...held.keys()]) if (familyOfKey(k) === family) held.delete(k)
}

// A write landed for this family member: their answers are forgotten and every section on screen reads again.
export function familyWritten(family: string, sentAt?: number, index = true): void {
  forgetFamilyReads(family)
  if (family && family !== '*') wroteFamilyPack(family, sentAt)
  if (index) wroteFamilyIndex(sentAt)
  for (const fn of [...written]) fn(family)
}

/** The relay's ledger took the write without running it yet: {accepted:true, queued|confirmed:false} and no record. */
export function writeQueued(answer: unknown): boolean {
  if (!answer || typeof answer !== 'object') return false
  const o = answer as Record<string, unknown>
  if (typeof o.id === 'string' && o.id.startsWith('pending-')) return true
  return o.accepted === true && Object.keys(o).length <= 2
}

/** Long enough for the ledger to run a queued write before the family member is read once more. */
export const QUEUED_REREAD_MS = 8_000

// A write sent at `sentAt` answered: the family member is read again now, and once more after a queued write has…
export function familyWrote(family: string, answer: unknown, sentAt?: number, index = true): boolean {
  familyWritten(family, sentAt, index)
  const queued = writeQueued(answer)
  if (queued) {
    const t = setTimeout(() => familyWritten(family, sentAt, index), QUEUED_REREAD_MS) as unknown as { unref?: () => void }
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

const stampOf = (raw: unknown, readAt: number): string => familyAnswerAt(raw) || new Date(readAt).toISOString()

/** A refusal says this session may not see the family member: nothing held is drawn in its place. */
export function readRefused(err: unknown): boolean {
  const status = err && typeof err === 'object' ? (err as { status?: unknown }).status : undefined
  if (status === 401 || status === 403 || status === 404) return true
  const said = err instanceof Error ? err.message : String(err)
  return said === SESSION_EXPIRED || /unknown action/i.test(said)
}

/** The key an answer is held under: the action, the family key, then any parameter. The roster's is '*'. */
export const readKey = (action: string, family: string, ...rest: (string | boolean)[]): string =>
  [action, family, ...rest.map(String)].join('|')

/* ---------- an Apply (Settings › Editions): the write, then the family member read again ---------- */

/** Each section's read an Apply reads again, as the sections themselves key it. */
export const FAMILY_REREAD = {
  overview: (family: string): Reread => ({ key: readKey('familyProfileOverview', family), load: () => overviewRead(family) }),
  notes: (family: string): Reread => ({ key: readKey('familyProfileNotes', family), load: () => notesRead(family) }),
  activity: (family: string): Reread => ({ key: readKey('familyProfileActivity', family), load: () => activityRead(family) }),
}

/** The sections read again, through the one read per key every section on screen shares. */
export function rereadFamily(list: Reread[]): Promise<unknown[]> {
  return Promise.all(list.map((r) => readOnce(r.key, r.load)))
}

/** A family member as an Apply's target (ApplyStrip.useApplyFor). */
export const familyTarget = (family: string): ApplyTarget => ({
  where: { app: FAMILY_PACK, label: 'Families & Guardians', subject: 'family member' },
  overlaid: () => familyWritten(family),
  wrote: (answer, sentAt) => { familyWrote(family, answer, sentAt) },
  written: (sentAt) => familyWritten(family, sentAt),
  reread: rereadFamily,
})

/* ---------- the editions this viewer makes in Families (Settings › Editions) ---------- */

const editionsAsked = new Map<string, Promise<FamilyEdition[]>>()

onMemoryBoundary(() => {
  editionsAsked.clear()
})

/** editionsMine for Families; an answer without its list is "not confirmed", never "none", and is asked again. */
export async function readFamilyEditions(): Promise<FamilyEdition[]> {
  const d = await gasAction<{ editions?: unknown }>('editionsMine', { app: FAMILY_PACK })
  if (isRelayReceipt(d) || !Array.isArray(d?.editions)) throw new Error('The editions were not confirmed.')
  return familyEditionsOf(d.editions)
}

function editionsOnce(who: string): Promise<FamilyEdition[]> {
  const asked = editionsAsked.get(who)
  if (asked) return asked
  const p = readFamilyEditions()
  p.catch(() => { if (editionsAsked.get(who) === p) editionsAsked.delete(who) })
  editionsAsked.set(who, p)
  return p
}

/** How long an unconfirmed read of the editions waits before it is asked again. */
export const EDITIONS_RETRY_MS = 30_000

const NO_EDITIONS: readonly FamilyEdition[] = []

// The editions an employee makes here, once a session; none for the master (who makes all) or a visit.
export function useFamilyEditions(): readonly FamilyEdition[] {
  const viewer = useEffectiveUser()
  const asks = !!viewer && !viewer.isMaster && !viewer.visiting
    && EDITION_ROLES.includes(String(viewer.role ?? '').toLowerCase())
  const who = asks && viewer ? viewer.id : ''
  const [got, setGot] = useState<{ who: string; editions: FamilyEdition[] }>({ who: '', editions: [] })
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

// One read, keyed.
export function useFamilyRead<T>(key: string | null, load: () => Promise<unknown>, shape: (raw: unknown) => T):
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
    const fn = (family: string) => {
      if (familyOfKey(key) === family || familyOfKey(key) === '*') again()
    }
    written.add(fn)
    return () => {
      written.delete(fn)
    }
  }, [key, again])

  // the app rang: what is drawn stays, and is read again
  useEffect(() => (key ? onAppRing(FAMILY_PACK, again) : undefined), [key, again])

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
    state = hit ? { status: 'ready', data: shape(hit.raw), error: '', refreshing: Date.now() - hit.at >= FRESH_MS,
      updatedAt: stampOf(hit.raw, hit.at) } : { ...IDLE, status: 'loading' }
  }
  return { ...state, reload: again }
}
