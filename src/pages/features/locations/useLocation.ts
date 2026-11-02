// Locations' doors: each section read in lane order (locationReads.ts); the House Calendar is Scheduling's own screen.
// An answer is kept in memory for the session so a section and its panel share it; a write forgets the house's…
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { onMemoryBoundary, readOwnPart } from '@/lib/appPack'
import { createReadCache, readKey, useCachedRead, writtenAgainIfQueued, type ReadState } from '@/lib/readCache'
import {
  LOCATIONS_PACK, answerAt, forgetLocationPack, holdToHouses, readDocBytes, readDocuments, readIncidents, readNotes,
  readOverview, readRepairs, readStaff, readSupplies, wroteLocationPack,
} from './locationReads'
import { gasAction } from '@/features/hiring/shared'
import type { EditChange } from '@/lib/recordEdit'
import type { EditionId } from '@/lib/editions'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { usePlatformDoc, type PlatformDocMeta } from '@/lib/platformDoc'
import { post } from '@/pages/features/shifts/laneFetch'
import {
  MASTER_SCOPE, incidentStaffOf, readRefusal, scopeOf, type LocationScope, type NotePriority, type SupplyDraft,
} from './locationModel'

/* ---------- who reads, and how far ---------- */

/** The viewer's scope, as locationScope answers it: a client-role session's own view first. */
export const readLocationScope = async (): Promise<LocationScope> => {
  const own = await readOwnPart(LOCATIONS_PACK, 'scope')
  return scopeOf(own ? own.part : await gasAction<unknown>('locationScope', {}))
}

const scopes = new Map<string, Promise<LocationScope>>()

onMemoryBoundary(() => {
  scopes.clear()
})

/** One read of the scope per viewer for the session; a failed one is asked again. */
function scopeOnce(who: string): Promise<LocationScope> {
  const held = scopes.get(who)
  if (held) return held
  const p = readLocationScope()
  p.catch(() => { if (scopes.get(who) === p) scopes.delete(who) })
  scopes.set(who, p)
  return p
}

export type ScopeRead = { scope: LocationScope | null; failed: string; reload: () => void }

// Whose Locations this is: the master in its own session sees and writes everything without asking; anyone else — a…
// `ask` false (a screen outside Locations whose viewer Locations does not open) reads nothing and holds no scope.
export function useLocationScope(ask = true): ScopeRead {
  const viewer = useEffectiveUser()
  const master = viewer?.isMaster === true
  const who = ask && viewer ? `${viewer.id}|${viewer.visiting ? 'visit' : 'own'}` : ''
  const [got, setGot] = useState<{ who: string; scope: LocationScope | null; failed: string }>({ who: '', scope: null, failed: '' })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!ask) return
    if (master) {
      holdToHouses(false)
      return
    }
    if (!who) return
    let live = true
    scopeOnce(who)
      .then((scope) => {
        if (!live) return
        holdToHouses(scope.houses !== null)
        setGot({ who, scope, failed: '' })
      })
      .catch((err: unknown) => {
        if (live) setGot({ who, scope: null, failed: readRefusal(err instanceof Error ? err.message : String(err)) })
      })
    return () => {
      live = false
    }
  }, [ask, master, who, tick])
  const reload = useCallback(() => {
    scopes.delete(who)
    setGot({ who: '', scope: null, failed: '' })
    setTick((t) => t + 1)
  }, [who])
  if (!ask) return { scope: null, failed: '', reload }
  if (master) return { scope: MASTER_SCOPE, failed: '', reload }
  return got.who === who ? { scope: got.scope, failed: got.failed, reload } : { scope: null, failed: '', reload }
}

// What the sections may offer: `writes` — the master's own pen; `editions` — the edits this viewer makes (Settings…
export type LocationViewer = { writes: boolean; cut: boolean; editions?: readonly EditionId[] }

export const LocationViewerContext = createContext<LocationViewer>({ writes: true, cut: false })

export const useLocationViewer = (): LocationViewer => useContext(LocationViewerContext)

/** Does this viewer make the edition? Never in a cut view. */
export function viewerCan(v: LocationViewer, edition: EditionId): boolean {
  if (v.cut) return false
  return v.editions ? v.editions.includes(edition) : v.writes
}

/** This viewer makes the edition (viewerCan, from the page's context). */
export const useCan = (edition: EditionId): boolean => viewerCan(useLocationViewer(), edition)

/** This viewer makes at least one edition. */
export const useAnyEdition = (): boolean => {
  const v = useLocationViewer()
  return !v.cut && (v.editions ? v.editions.length > 0 : v.writes)
}

/* ---------- the reads ---------- */

// the slices first, then the relay's pack, then the section's own action (locationReads.ts)
export {
  readDocuments, readIncidents, readNotes, readOverview, readRepairs, readStaff, readSupplies,
} from './locationReads'

/** Every active employee's name, for an incident's Employees involved: its own door, the same at every house. */
export const readIncidentStaff = () => gasAction<unknown>('locationIncidentStaff', {})

const NO_STAFF: string[] = []

/** The names an incident's Employees involved picks from; none while unread, or where the door is not this viewer's. */
export function useIncidentStaff(): string[] {
  return useLocationRead(readKey('locationIncidentStaff', 'all'), readIncidentStaff, incidentStaffOf).data ?? NO_STAFF
}

/* ---------- a document, as bytes for the platform's centred viewer ---------- */

/** A PDF or a picture as itself, a Google or Office document exported as PDF; only a file the house names. */
export type DocFileAnswer = { id: string; name: string; mime: string; size: number; exported: boolean; b64: string }

export const readDocFile = (house: string, id: string): Promise<DocFileAnswer> => readDocBytes(house, id)

const docInflight = new Map<string, Promise<DocFileAnswer>>()

/** One request per document at a time; never shared across a memory boundary. */
function readDocOnce(house: string, id: string): Promise<DocFileAnswer> {
  const key = `${house}|${id}`
  const running = docInflight.get(key)
  if (running) return running
  const p: Promise<DocFileAnswer> = readDocFile(house, id).finally(() => {
    if (docInflight.get(key) === p) docInflight.delete(key)
  })
  docInflight.set(key, p)
  return p
}

export type LocationDocOpener = {
  /** the Drive id whose bytes are on their way; '' when none */
  opening: string
  open: (fileId: string, meta: PlatformDocMeta) => void
}

/** A house document opens in the platform's centred viewer, from its bytes; a refusal is a toast in the page's words. */
export function useLocationDoc(house: string): LocationDocOpener {
  const doc = usePlatformDoc(readRefusal)
  const { open } = doc
  const openDoc = useCallback((fileId: string, meta: PlatformDocMeta) => open(fileId, () => readDocOnce(house, fileId), meta),
    [house, open])
  return { opening: doc.opening, open: openDoc }
}

/* ---------- the writes (each appends; none is safe to send twice) ---------- */

export type NoteDraft = { house: string; client_key?: string; priority: NotePriority; details: string }

export const addNote = (draft: NoteDraft) => gasAction<unknown>('locationNoteAdd', draft, { retry: false })

/** The house rides as the witness the note's row must still carry. */
export const setNoteState = (id: string, state: 'open' | 'resolved', house: string) =>
  gasAction<unknown>('locationNoteState', { id, state, house }, { retry: false })

export const addSupplyEntry = (draft: SupplyDraft) => gasAction<unknown>('locationSupplyEntry', draft, { retry: false })

/* ---------- the edits: { house, …, changes: [{ field, value, expected }] } (lib/recordEdit) ---------- */

/** The registry row; the name it was opened on rides as the row's witness. */
export const saveHouse = (house: string, homeName: string, changes: EditChange[]) =>
  gasAction<unknown>('locationHouseSave', { house, home_name: homeName, changes }, { retry: false })

export const editNote = (house: string, id: string, changes: EditChange[]) =>
  gasAction<unknown>('locationNoteEdit', { house, id, changes }, { retry: false })

export const editSupplyEntry = (house: string, id: string, changes: EditChange[]) =>
  gasAction<unknown>('locationSupplyEdit', { house, id, changes }, { retry: false })

/** A repair or an incident row, through Locations' own door (the estate's row, field by field): the row id "r42". */
export const editIncident = (house: string, id: string, changes: EditChange[], client?: string) =>
  gasAction<unknown>('locationIncidentEdit', { house, id, changes, ...(client ? { client } : {}) }, { retry: false })

/** A report opened from Support Requests › Incidents: the same door, the report found by its row id with no house and
 * witnessed by its filing instant and client as opened (App Control's support-desk.incidentsEdit decides,
 * app/writes.py support_incident_door). */
export const editSupportIncident = (id: string, changes: EditChange[], filed: string, named: string) =>
  gasAction<unknown>('locationIncidentEdit', { id, changes, via: 'support-desk', filed, named }, { retry: false })

export const editRepair = (house: string, id: string, changes: EditChange[]) =>
  gasAction<unknown>('locationRepairEdit', { house, id, changes }, { retry: false })

export type IstFileDraft ={ house: string; staff: string; client: string; file: { name: string; mime: string; b64: string } }

export const fileIstPaper = (draft: IstFileDraft) => gasAction<unknown>('locationIstFile', draft, { retry: false })

export type IstTrainDraft = { house: string; staff: string; client: string; trained_on: string; confirmed: true }

/** The IST form: the pair's record marked trained on the day, by the trainer's word (Python's own door). */
export const recordIstTraining = (draft: IstTrainDraft) => gasAction<unknown>('locationIstTrain', draft, { retry: false })

/* ---------- the editions' own doors (Settings → Editions; each re-decided by the server) ---------- */

/** A new incident for one of the house's clients, filed in the estate's UIs and MUIs sheet; `client` (a client key):
 * opened from that client's Incidents, decided by the Clients edition. */
export const fileIncident = (house: string, row: Record<string, string>, client?: string) =>
  gasAction<unknown>('locationIncidentFile', { house, row, ...(client ? { client } : {}) }, { retry: false })

/** A new repair request for the house's own street, filed in the estate's Repairs sheet. */
export const fileRepair = (house: string, row: Record<string, string>) =>
  gasAction<unknown>('locationRepairFile', { house, row }, { retry: false })

/** Take a person off the house's Staff list, or put them back; their record is never touched. */
export const removeStaff = (house: string, staff: string, back = false) =>
  gasAction<unknown>('locationStaffRemove', { house, staff, ...(back ? { back: true } : {}) }, { retry: false })

/** One of the house's own documents, moved out of its folder (never to the trash). */
export const removeDoc = (house: string, id: string) =>
  gasAction<unknown>('locationDocRemove', { house, id }, { retry: false })

/** A copy of a Google Drive document filed in the house's folder. */
export const linkDoc = (house: string, url: string) =>
  gasAction<unknown>('locationDocLink', { house, url }, { retry: false })

/** A file from outside the platform, filed in the house's folder. */
export const uploadDoc = (house: string, file: { name: string; mime: string; b64: string }) =>
  gasAction<unknown>('locationDocUpload', { house, file }, { retry: false })

/** Clients added to the house; the door never takes one off. */
export const addClients = (house: string, clients: string[]) =>
  gasAction<unknown>('locationClientsAdd', { house, clients }, { retry: false })

/** One of the house's assets on House Supplies' own inventory (the row id "r42"), field by field. */
export const editAsset = (house: string, id: string, changes: EditChange[]) =>
  gasAction<unknown>('locationAssetEdit', { house, id, changes }, { retry: false })

/** A new asset on House Supplies' own inventory, at the house's registry street. */
export const addAsset = (house: string, row: Record<string, string>) =>
  gasAction<unknown>('locationAssetAdd', { house, row }, { retry: false })

/* ---------- the house photo: kept on the relay, then named on the registry row ---------- */

/** What the relay kept of a picture (server/house_images.py). */
export type KeptPhoto = { house: string; name: string; path: string; type: string; bytes: number }

/** One picture kept on the relay for the house; nothing is shown until the registry names it. */
export const keepHousePhoto = (house: string, file: { name: string; mime: string; b64: string }) =>
  post<KeptPhoto>(`/hub-lanes/locations/image/${encodeURIComponent(house)}`, file)

/** The registry's thumbnail_url for a kept picture: this page's own origin and the relay's path. */
export const housePhotoUrl = (path: string): string => new URL(path, window.location.origin).href

/* ---------- the hook ---------- */

export { IDLE, QUEUED_REREAD_MS, QUEUED_WORDS, readKey, writeQueued, type ReadState } from '@/lib/readCache'

const reads = createReadCache({ stamp: answerAt, app: LOCATIONS_PACK })

onMemoryBoundary(() => {
  docInflight.clear()
})

/** Forget the answers held for a house (every section's), or every answer — and the house's pack with them. */
export function forgetLocationReads(house?: string): void {
  forgetLocationPack(house)
  reads.forget(house || undefined)
}

// A write landed for this house (sent at `sentAt`): its answers are forgotten and every section on screen reads…
export function locationWritten(house: string, sentAt?: number): void {
  forgetLocationReads(house)
  wroteLocationPack(house, sentAt)
  reads.written(house)
}

// The relay's overlay took an edit for this house: the answers held here go; its pack already shows the edit.
export function locationOverlaid(house: string): void {
  forgetLocationReads(house)
  reads.written(house)
}

// A write landed for a client whose sources Clients reads through this hook: those answers are forgotten and read…
export function sourceWritten(client: string): void {
  if (client) reads.forget(client)
  reads.written(client)
}

// A write sent at `sentAt` answered: the house is read again now, and once more after a queued write has had time…
export function locationWrote(house: string, answer: unknown, sentAt?: number): boolean {
  locationWritten(house, sentAt)
  return writtenAgainIfQueued(answer, () => locationWritten(house, sentAt))
}

/** One section's read, by its key: what an Apply reads again once its write answered. */
export type Reread = { key: string; load: () => Promise<unknown> }

/** Each section's read, as the sections themselves key it. */
export const REREAD = {
  overview: (h: string): Reread => ({ key: readKey('locationOverview', h), load: () => readOverview(h) }),
  staff: (h: string): Reread => ({ key: readKey('locationStaff', h), load: () => readStaff(h) }),
  notes: (h: string): Reread => ({ key: readKey('locationNotes', h), load: () => readNotes(h) }),
  supplies: (h: string): Reread => ({ key: readKey('locationSupplies', h), load: () => readSupplies(h) }),
  repairs: (h: string): Reread => ({ key: readKey('locationRepairs', h, false), load: () => readRepairs(h, false) }),
  incidents: (h: string): Reread => ({ key: readKey('locationIncidents', h), load: () => readIncidents(h) }),
  documents: (h: string): Reread => ({ key: readKey('locationDocuments', h), load: () => readDocuments(h) }),
}

// The sections read again — through the one read per key every section on screen shares — once a write landed and…
export function rereadLocation(list: Reread[]): Promise<unknown[]> {
  return Promise.all(list.map((r) => reads.read(r.key, r.load)))
}

// One read, keyed (readCache.useCachedRead): the held answer drawn at once and read again behind it when stale…
export function useLocationRead<T>(key: string | null, load: () => Promise<unknown>, shape: (raw: unknown) => T):
  ReadState<T> & { reload: () => void } {
  return useCachedRead(reads, key, load, shape)
}
