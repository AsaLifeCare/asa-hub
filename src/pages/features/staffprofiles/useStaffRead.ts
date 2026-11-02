// Staff's doors: one Apps Script action per section (StaffProfiles.gs), each named here, the account doors the…
// An answer is kept in memory for the session so a section and its panel share it; a write forgets the person's…
import { useCallback, useEffect, useState } from 'react'
import { gasAction, isRelayReceipt } from '@/features/hiring/shared'
import { answerStamp, onMemoryBoundary, readOwnPart, readPack, stampAnswer, wrotePack } from '@/lib/appPack'
import { EDITION_ROLES } from '@/lib/editions'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { ownClientKey } from '@/lib/ownClient'
import {
  createReadCache, readKey as keyOf, readRefused, useCachedRead, writtenAgainIfQueued, type ReadState,
} from '@/lib/readCache'
import { usePlatformDoc, type DocBytes, type PlatformDocMeta } from '@/lib/platformDoc'
import type { InviteAnswer } from '@/pages/settings/UsersSection'
import type { ReleaseResult } from '@/pages/features/releaseusers/releaseReport'
import type { ApplyTarget } from '@/pages/features/locations/ApplyStrip'
import type { Reread } from '@/pages/features/locations/useLocation'
import { readRefusal, staffEditionsOf, type NoteCategory, type StaffEdition, type StaffTab } from './staffModel'
import type { NotePriority } from '@/pages/features/locations/locationModel'
import type { EditChange } from '@/lib/recordEdit'

/* ---------- the reads ---------- */

export const STAFF_PACK = 'staff-profiles'

// A part of a client-role session's own view of Staff (this week's staff at its house, each BASIC); null for every…
async function ownPart(part: string): Promise<unknown> {
  const own = await readOwnPart(STAFF_PACK, part)
  return own ? stampAnswer(own.part, own.builtAt) : null
}

/** How long a section waits, once, on its staff member's pack being gathered before it reads its own action. */
export const STAFF_PACK_WAIT_S = 4

// A section from the staff member's pack in the relay's memory — its door's own answer, with the raw values the…
async function teamPart(staff: string, part: string, edit?: string): Promise<unknown> {
  if (!/^[a-z0-9]{3,80}$/.test(staff) || ownClientKey()) return null
  const pack = await readPack(STAFF_PACK, staff, { waitS: STAFF_PACK_WAIT_S })
  const said = pack?.data.part_status ?? {}
  const value = pack?.data.parts?.[part]
  if (!pack || !value || typeof value !== 'object' || (said[part]?.status ?? 200) !== 200) return null
  if (!edit) return stampAnswer(value, pack.builtAt)
  const raw = pack.data.parts?.[`edit_${edit}`]
  if (said[`edit_${edit}`] && (said[`edit_${edit}`]?.status !== 200 || !raw)) return null
  return stampAnswer(raw && typeof raw === 'object' ? { ...(value as object), edit: raw } : value, pack.builtAt)
}

export const readRoster = async (showInactive: boolean): Promise<unknown> =>
  (!showInactive && await ownPart('roster'))
  || gasAction<unknown>('staffProfileRoster', showInactive ? { show_inactive: true } : {})
export const readOverview = async (staff: string): Promise<unknown> =>
  (/^[a-z0-9]{3,80}$/.test(staff) && await ownPart(`profile_${staff}`))
  || await teamPart(staff, 'overview', 'profile')
  || gasAction<unknown>('staffProfileOverview', { staff })
export const readShifts = async (staff: string): Promise<unknown> =>
  await teamPart(staff, 'shifts') || gasAction<unknown>('staffProfileShifts', { staff })
export const readEmployment = async (staff: string): Promise<unknown> =>
  await teamPart(staff, 'employment', 'employment') || gasAction<unknown>('staffProfileEmployment', { staff })
export const readDocuments = async (staff: string): Promise<unknown> =>
  await teamPart(staff, 'documents') || gasAction<unknown>('staffProfileDocuments', { staff })
export const readCompliance = async (staff: string): Promise<unknown> =>
  await teamPart(staff, 'compliance', 'compliance') || gasAction<unknown>('staffProfileCompliance', { staff })
export const readHr = (staff: string) => gasAction<unknown>('staffProfileHr', { staff })
export const readActions = async (staff: string): Promise<unknown> =>
  await teamPart(staff, 'actions') || gasAction<unknown>('staffProfileActions', { staff })
export const readActivity = async (staff: string): Promise<unknown> =>
  await teamPart(staff, 'activity') || gasAction<unknown>('staffProfileActivity', { staff })
export const readNotes = async (staff: string): Promise<unknown> =>
  await teamPart(staff, 'notes') || gasAction<unknown>('staffProfileNotes', { staff })
export const readTranscripts = (staff: string) => gasAction<unknown>('staffProfileTranscripts', { staff })
export const readPreferences = async (staff: string): Promise<unknown> =>
  await teamPart(staff, 'preferences') || gasAction<unknown>('staffProfilePreferences', { staff })
export const readPerformance = (staff: string) => gasAction<unknown>('staffProfilePerformance', { staff })

// An edition holder's panel reads its section's edit values from Python's own door: the relay's pack never hands…
export const readOverviewLive = (staff: string) => gasAction<unknown>('staffProfileEditRead', { staff, section: 'profile' })
export const readEmploymentLive = (staff: string) => gasAction<unknown>('staffProfileEditRead', { staff, section: 'employment' })
export const readComplianceLive = (staff: string) => gasAction<unknown>('staffProfileEditRead', { staff, section: 'compliance' })

/** One conversation: `with` the counterpart, `before` the oldest message already held. */
export const readTexts = (staff: string, withId = '', before = '') =>
  gasAction<unknown>('staffProfileTexts', { staff, ...(withId ? { with: withId } : {}), ...(before ? { before } : {}) })

/** One call's words, only a call this person's transcripts list names. */
export const readTranscript = (staff: string, callId: string) => gasAction<unknown>('staffProfileTranscript', { staff, call_id: callId })

/* ---------- a document, as bytes for the platform's centred viewer ---------- */

/** A PDF or a picture as itself, a Google or Office document exported as PDF; only a file this person's rows name. */
export type DocFileAnswer = { id: string; name: string; mime: string; size: number; exported: boolean; b64: string }

export const readDocFile = (staff: string, id: string) => gasAction<DocFileAnswer>('staffProfileDocFile', { staff, id })

const docInflight = new Map<string, Promise<DocFileAnswer>>()

/** One request per document at a time; the bytes are not kept once it settles. */
function readDocOnce(staff: string, id: string): Promise<DocFileAnswer> {
  const key = `${staff}|${id}`
  const running = docInflight.get(key)
  if (running) return running
  const p = readDocFile(staff, id).finally(() => docInflight.delete(key))
  docInflight.set(key, p)
  return p
}

export type StaffDocOpener = {
  /** the file whose bytes are on their way; '' when none */
  opening: string
  open: (id: string, meta: PlatformDocMeta) => void
}

/** A staff document opens in the platform's centred viewer, from its bytes; a refusal is a toast in the page's words. */
export function useStaffDoc(staff: string): StaffDocOpener {
  const doc = usePlatformDoc(readRefusal)
  const { open } = doc
  const openDoc = useCallback((id: string, meta: PlatformDocMeta) => open(id, () => readDocOnce(staff, id), meta),
    [staff, open])
  return { opening: doc.opening, open: openDoc }
}

/* ---------- the writes (none is safe to send twice) ---------- */

export type NoteDraft = { staff: string; category?: NoteCategory; priority: NotePriority; details: string }

export const addNote = (draft: NoteDraft) => gasAction<unknown>('staffProfileNoteAdd', draft, { retry: false })

/** The staff key rides as the witness the note's row must still carry. */
export const setNoteState = (id: string, state: 'open' | 'resolved', staff: string) =>
  gasAction<unknown>('staffProfileNoteState', { id, state, staff }, { retry: false })

export type AssignDraft = { staff: string; house: string; due_date?: string }
export type AssignAnswer = {
  house?: string
  created?: { id?: string; client_name?: string; due?: string }[]
  already?: { client_name?: string; status?: string; house?: string }[]
  /** names the IST settings map to the house that no client record answers to; never made into rows */
  unplaced?: string[]
}

export const assignTraining = (draft: AssignDraft) => gasAction<AssignAnswer>('staffProfileAssignTraining', draft, { retry: false })

/** A training request on the person's notes: by a manager, the master or the person themselves. */
export type TrainingRequestDraft = { staff: string; priority: NotePriority; details: string }

export const requestTraining = (draft: TrainingRequestDraft) =>
  gasAction<unknown>('staffProfileAssignTraining', draft, { retry: false })

/** A new HR issue, filed on the HR tracker Under review. */
export type HrIssueDraft = {
  staff: string
  date: string
  severity: string
  category: string
  summary: string
  details: string
  action?: string
  next_review?: string
}

export const addHrIssue = (draft: HrIssueDraft) => gasAction<unknown>('staffProfileHrIssueAdd', draft, { retry: false })

/** A missing daily note or punch marked concluded, with why (Python's own door). */
export type DocMarkDraft = { staff: string; date: string; area: string; why: string }

export const concludeDoc = (draft: DocMarkDraft) => gasAction<unknown>('staffProfileDocConclude', draft, { retry: false })

/** An IST recorded for a client the person holds none for, at the client's house: trained on `day`, or owed by it. */
export type IstAddDraft = { key: string; client: string; status: 'done' | 'owed'; day: string }

export const addIst = (draft: IstAddDraft) => gasAction<unknown>('staffProfileIstAdd', draft, { retry: false })

// The record edit: only the changed fields, each witnessed by the raw value its panel opened on; the sign-in email…
export const editStaff = (staff: string, changes: EditChange[], confirmLoginEmail = false) =>
  gasAction<unknown>('staffProfileEdit',
    confirmLoginEmail ? { key: staff, changes, confirm_login_email: true } : { key: staff, changes }, { retry: false })

/** The rename: First and Last Name, witnessed; it answers the key the new name folds to. */
export const renameStaff = (staff: string, changes: EditChange[]) =>
  gasAction<unknown>('staffProfileRename', { key: staff, changes }, { retry: false })

/** The employee driver tab's facts and Driver Compliance's standing word. */
export const editDriving = (staff: string, changes: EditChange[]) =>
  gasAction<unknown>('staffProfileDrivingEdit', { key: staff, changes }, { retry: false })

/** One MAIS line, named by its Cat level. */
export const editMais = (staff: string, level: string, changes: EditChange[]) =>
  gasAction<unknown>('staffProfileMaisEdit', { key: staff, level, changes }, { retry: false })

/** One IST record of this person, by its id. */
export const editIst = (staff: string, id: string, changes: EditChange[]) =>
  gasAction<unknown>('staffProfileIstEdit', { key: staff, id, changes }, { retry: false })

/** One staff note's category, priority or text (Python's own door); the staff key rides as the witness. */
export const editNote = (staff: string, id: string, changes: EditChange[]) =>
  gasAction<unknown>('staffProfileNoteEdit', { staff, id, changes }, { retry: false })

/** The preferences whole, witnessed by the updated_at the section was opened on ('' for none yet). */
export const savePreferences = (staff: string, prefs: unknown, expected: string) =>
  gasAction<unknown>('staffProfilePreferencesSave', { staff, prefs, expected }, { retry: false })

/* ---------- a training paper, through the certificate doors My Profile files and confirms with ---------- */

/** The person is the roster name; the requirement id names the catalogue label and folder the paper is filed under. */
export type PaperDraft = { person: string; req_id: string; filename: string; mime: string; base64: string }

export type PaperConfirmAnswer = { id?: string; req_id?: string; date_source?: string; confirmed_on?: string; message?: string }

export const filePaper = (draft: PaperDraft) => gasAction<unknown>('certDocUpload', draft, { retry: false })

/** A Documents row's paper, through the same door: `cert` the row's title, which files it and names it on the list. */
export type DocDraft = { person: string; cert: string; filename: string; mime: string; base64: string }
export const fileDocument = (draft: DocDraft) => gasAction<unknown>('certDocUpload', draft, { retry: false })

/** The decoder's reading of the filed paper, kept on its ledger row; a row already read answers its verdict again. */
export const readPaper = (id: string) => gasAction<unknown>('certDocRead', { id })

/** What the Employee Database Master holds now for the paper's requirement. The master only. */
export const readPaperRecord = (id: string) => gasAction<unknown>('certUploadRecord', { id })

/** Writes `date` into the Master only while it still holds `expected`; never sent twice. */
export const confirmPaperDate = (id: string, date: string, expected: string) =>
  gasAction<PaperConfirmAnswer>('certUploadConfirm', { id, date, expected }, { retry: false })

/** The filed paper's bytes, for the platform's centred viewer. */
export const readPaperFile = (id: string) => gasAction<DocBytes>('certDocFile', { id })

const lastVisit = { key: '', at: 0 }

/** Who opened which section: sent once per person and section, never waited on, never retried. */
export function recordVisit(staff: string, section: StaffTab): void {
  const key = `${staff}|${section}`
  const now = Date.now()
  if (!staff || (lastVisit.key === key && now - lastVisit.at < 10_000)) return
  lastVisit.key = key
  lastVisit.at = now
  void gasAction<unknown>('staffProfileVisit', { staff, section }, { retry: false }).catch(() => {})
}

/* ---------- the account doors (Users, Release Users) ---------- */

export const sendInvite = (userId: string) => gasAction<InviteAnswer>('userInvite', { user_ids: [userId] }, { retry: false })

export const setAccountActive = (userId: string, active: boolean) =>
  gasAction<unknown>('userUpdate', { user_id: userId, active }, { retry: false })

/** What Release Users reads before a release: whether a letter can reach the person, and what the press clears. */
export type ReleaseStatusLite = {
  user_id: string
  display_name: string
  active: boolean
  armed: boolean
  must_change: boolean
  last_login: string
  signed_in_before?: boolean
  sending_holds?: boolean
  blocked_by?: string
  hold_why?: string[]
  will_clear: string[]
}

export const readReleaseStatus = (userId: string) => gasAction<ReleaseStatusLite>('releaseUserStatus', { user_id: userId })

/** One id per press: the one re-send a lost answer allows is the same letter, never a second. */
export function newPressId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* falls through */ }
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export const resetPassword = (userId: string, anyway = false) =>
  gasAction<ReleaseResult>('releaseUser',
    anyway ? { user_id: userId, anyway: true, press_id: newPressId() } : { user_id: userId, press_id: newPressId() },
    { retry: false })

/* ---------- the hook ---------- */

export {
  IDLE, QUEUED_REREAD_MS, QUEUED_WORDS, readKey, readRefused, writeQueued, type ReadState,
} from '@/lib/readCache'

// a refusal draws nothing held; the roster ('*') is not read again for one person's write
const reads = createReadCache({ stamp: answerStamp, refused: readRefused, app: STAFF_PACK })

// every answer belongs to the session and the place that read it: a sign-out, another account, a visit's, a…
onMemoryBoundary(() => {
  docInflight.clear()
})

/** Forget the answers held for a person (every section's), or every answer. */
export function forgetStaffReads(staff?: string): void {
  reads.forget(staff || undefined)
}

/** A write landed for this person: their answers are forgotten and every section on screen reads again. */
export function staffWritten(staff: string): void {
  // the relay hears it on the next read of the person's pack: no copy read before it is drawn
  if (/^[a-z0-9]{3,80}$/.test(staff)) wrotePack(STAFF_PACK, staff)
  forgetStaffReads(staff)
  reads.written(staff)
}

/** A write answered: the person is read again now, and once more after a queued write has had time to run. */
export function staffWrote(staff: string, answer: unknown): boolean {
  staffWritten(staff)
  return writtenAgainIfQueued(answer, () => staffWritten(staff))
}

// One read, keyed (readCache.useCachedRead): the held answer drawn at once and read again behind it when stale…
export function useStaffRead<T>(key: string | null, load: () => Promise<unknown>, shape: (raw: unknown) => T,
  first?: () => unknown): ReadState<T> & { reload: () => void } {
  return useCachedRead(reads, key, load, shape, first)
}

/* ---------- an edit through the Apply strip ---------- */

/** The edit panel's read as the panel keys it (StaffPanel EditBody), read again once an Apply landed. */
export const staffReread = (key: string, load: () => Promise<unknown>): Reread => ({ key, load })

/** A staff member of Staff as an Apply's target (ApplyStrip.useApplyFor). */
export const staffTarget = (staff: string): ApplyTarget => ({
  where: { app: STAFF_PACK, label: 'Staff', subject: 'staff member' },
  overlaid: () => staffWritten(staff),
  wrote: (answer) => { staffWrote(staff, answer) },
  written: () => staffWritten(staff),
  reread: (list) => Promise.all(list.map((r) => reads.read(r.key, r.load))),
})

/* ---------- the editions this viewer makes in Staff (Settings › Editions) ---------- */

const editionsAsked = new Map<string, Promise<StaffEdition[]>>()

onMemoryBoundary(() => {
  editionsAsked.clear()
})

/** editionsMine for Staff; an answer without its list is "not confirmed", never "none", and is asked again. */
export async function readStaffEditions(): Promise<StaffEdition[]> {
  const d = await gasAction<{ editions?: unknown }>('editionsMine', { app: STAFF_PACK })
  if (isRelayReceipt(d) || !Array.isArray(d?.editions)) throw new Error('The editions were not confirmed.')
  return staffEditionsOf(d.editions)
}

function editionsOnce(who: string): Promise<StaffEdition[]> {
  const held = editionsAsked.get(who)
  if (held) return held
  const p = readStaffEditions()
  p.catch(() => { if (editionsAsked.get(who) === p) editionsAsked.delete(who) })
  editionsAsked.set(who, p)
  return p
}

/** How long an unconfirmed read of the editions waits before it is asked again. */
export const STAFF_EDITIONS_RETRY_MS = 30_000

const NO_EDITIONS: readonly StaffEdition[] = []

// The editions this session makes here, once a session, the master's too (a Python-only door's); none for a visit.
export function useStaffEditions(): readonly StaffEdition[] {
  const viewer = useEffectiveUser()
  const asks = !!viewer && !viewer.visiting && EDITION_ROLES.includes(String(viewer.role ?? '').toLowerCase())
  const who = asks && viewer ? viewer.id : ''
  const [got, setGot] = useState<{ who: string; editions: StaffEdition[] }>({ who: '', editions: [] })
  useEffect(() => {
    if (!who) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const ask = () => {
      editionsOnce(who)
        .then((editions) => { if (live) setGot({ who, editions }) })
        .catch(() => { if (live) timer = setTimeout(ask, STAFF_EDITIONS_RETRY_MS) })
    }
    ask()
    return () => {
      live = false
      if (timer) clearTimeout(timer)
    }
  }, [who])
  return who && got.who === who ? got.editions : NO_EDITIONS
}

/** Compliance documents' review edition: its app and key as Settings › Editions names them. */
export const CERT_DOCS_APP = 'cert-docs'
export const CERT_REVIEW = 'certDocs.review'

const reviewAsked = new Map<string, Promise<boolean>>()

onMemoryBoundary(() => {
  reviewAsked.clear()
})

/** editionsMine for Compliance documents (none while it runs on Apps Script); an answer without its list is asked again. */
export async function readCertReview(): Promise<boolean> {
  const d = await gasAction<{ editions?: unknown }>('editionsMine', { app: CERT_DOCS_APP })
  if (isRelayReceipt(d) || !Array.isArray(d?.editions)) throw new Error('The editions were not confirmed.')
  return d.editions.some((e) => String(e) === CERT_REVIEW)
}

function reviewOnce(who: string): Promise<boolean> {
  const held = reviewAsked.get(who)
  if (held) return held
  const p = readCertReview()
  p.catch(() => { if (reviewAsked.get(who) === p) reviewAsked.delete(who) })
  reviewAsked.set(who, p)
  return p
}

// Whether this session reviews others' filed papers, once a session; never for a visit.
export function useCertReview(): boolean {
  const viewer = useEffectiveUser()
  const asks = !!viewer && !viewer.visiting && EDITION_ROLES.includes(String(viewer.role ?? '').toLowerCase())
  const who = asks && viewer ? viewer.id : ''
  const [got, setGot] = useState<{ who: string; review: boolean }>({ who: '', review: false })
  useEffect(() => {
    if (!who) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const ask = () => {
      reviewOnce(who)
        .then((review) => { if (live) setGot({ who, review }) })
        .catch(() => { if (live) timer = setTimeout(ask, STAFF_EDITIONS_RETRY_MS) })
    }
    ask()
    return () => {
      live = false
      if (timer) clearTimeout(timer)
    }
  }, [who])
  return !!who && got.who === who && got.review
}

/** The key an edition holder's live read of a section is held under, apart from the section's own copy. */
export const liveEditKey = (action: string, staff: string): string => keyOf(action, staff, 'edit')
