// Clients' doors: each section read in lane order (clientReads.ts) — the slices, then the relay's pack, then the…
// An answer is kept in memory for the session so a section and its panel share it; a write forgets the client's…
import { useEffect, useState } from 'react'
import { gasAction, isRelayReceipt } from '@/features/hiring/shared'
import { forgetDocBytes, onMemoryBoundary, readDocBytesHeld } from '@/lib/appPack'
import { EDITION_ROLES, editionIdsOf, type EditionId } from '@/lib/editions'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { createReadCache, readKey as keyOf, useCachedRead, writtenAgainIfQueued, type ReadState } from '@/lib/readCache'
import { sourceWritten, type Reread } from '@/pages/features/locations/useLocation'
import type { ApplyTarget } from '@/pages/features/locations/ApplyStrip'
import { usePlatformDoc } from '@/lib/platformDoc'
import type { EditChange } from '@/lib/recordEdit'
import { readRefusal } from './clientModel'
import {
  CLIENTS_PACK, clientAnswerAt, forgetClientPack, readCare as careRead, readDetails as detailsOf,
  readIncidents as incidentsRead, readMeds as medsRead, wroteClientPack,
} from './clientReads'
import { narrowedReader } from './clientViewer'
import { rereadTransport, transportWritten } from './sources/transport'

/* ---------- the reads ---------- */

// the slices first, then the relay's pack, then the section's own action (clientReads.ts)
export { heldRoster, readActivity, readCare, readDetails, readIncidents, readMeds, readRoster } from './clientReads'

/* ---------- a plan or a client file, as bytes for the platform's centred viewer ---------- */

/** A PDF or a picture as itself, a Google or Office document exported as PDF; only a file this client's rows name. */
export type DocFileAnswer = { name: string; mime: string; b64: string; exported?: boolean }

/** Through the client's own door, held in memory for the tab so opening it again is instant (appPack). */
export const readDocFile = (client: string, fileId: string) =>
  readDocBytesHeld(`${CLIENTS_PACK}|${client}|doc|${fileId}`,
    () => gasAction<DocFileAnswer>('clientProfileDocFile', { client, file_id: fileId }))

// A plan or a client file in the platform's centred viewer: its bytes through the client's own door, made a blob…
export function useClientDocs(): { opening: string; open: (client: string, fileId: string, title: string) => void } {
  const doc = usePlatformDoc(readRefusal)
  return {
    opening: doc.opening,
    open: (client, fileId, title) => doc.open(`${client}|${fileId}`, () => readDocFile(client, fileId), { title, subtitle: 'Clients' }),
  }
}

/* ---------- the writes (none is safe to send twice) ---------- */

/** The record edit: only the changed fields, each witnessed by the raw value the panel opened on. */
export const editProfile = (client: string, changes: EditChange[]) =>
  gasAction<unknown>('clientProfileSave', { client, changes }, { retry: false })

/** The rename: the one `name` change; the answer's client_key is the key the screen follows. */
export const renameClient = (client: string, changes: EditChange[]) =>
  gasAction<{ client_key?: string; notes?: string[] }>('clientProfileRename', { client, changes }, { retry: false })

/** Active or Inactive: the one `status` change; the client's Master row moves to or from the archive. */
export const setClientStatus = (client: string, changes: EditChange[]) =>
  gasAction<{ notes?: string[] }>('clientProfileStatus', { client, changes }, { retry: false })

/** A family member or a care row corrected, hidden or added over the plan (target '' adds one). */
export type OverrideAsk = { client: string; kind: 'family' | 'care'; tab?: string; target: string; changes: EditChange[] }
export const editOverride = (ask: OverrideAsk) => gasAction<unknown>('clientProfileOverride', ask, { retry: false })

/** A chart row corrected in place, by its eMAR id, each cell witnessed. */
export const editMedication = (client: string, id: string, changes: EditChange[]) =>
  gasAction<unknown>('emarMedUpdate', { client, id, changes }, { retry: false })

/** A chart row taken off the eMAR list, by its eMAR id; the client rides for the relay's pack. */
export const removeMedication = (client: string, id: string) =>
  gasAction<{ removed?: string }>('emarMedDelete', { client, id }, { retry: false })

export type IncidentStatusDraft = { client: string; incident_ts: string; client_name: string; status: string }
export const setIncidentStatus = (draft: IncidentStatusDraft) =>
  gasAction<unknown>('clientProfileIncidentStatus', draft, { retry: false })

export type ApptDraft = { client: string; id: string; witness: string; fields: Record<string, string> }
export const saveAppointment = (draft: ApptDraft) => gasAction<unknown>('clientProfileApptSave', draft, { retry: false })

/** The SSN, the TL card number or the DC expiry saved whole; the answer names its last four alone. */
export type SecretAnswer = { saved?: boolean; field?: string; last4?: string; sheet?: 'written' | 'not_written'; why?: string }
export const saveSecret = (client: string, field: string, value: string) =>
  gasAction<SecretAnswer>('clientProfileSecretSet', { client, field, value }, { retry: false })

/** A visit booked and a doctor added, for the client (Clients › Appointments). */
export const addAppointment = (client: string, fields: Record<string, string>) =>
  gasAction<unknown>('clientProfileApptAdd', { client, fields }, { retry: false })
export const addDoctor = (client: string, fields: Record<string, string>) =>
  gasAction<unknown>('clientProfileDoctorAdd', { client, fields }, { retry: false })

/** Client management — the Client Care app's own actions, sent with the same parameters. */
export type NewClient = { name: string; clientNumber: string; houseName: string; guardianName: string }
export const createClient = (c: NewClient) => gasAction<unknown>('clientCreate', { ...c, status: 'active' }, { retry: false })
export const createClientUser = (clientId: string, kind: 'client' | 'guardian') =>
  gasAction<{ already?: boolean; login: string }>('clientUserCreate', { client_id: clientId, kind }, { retry: false })
export type BulkAnswer = { created: number; already: number; skipped: number; skipped_named?: string[] }
export const usersFromClients = () => gasAction<BulkAnswer>('usersFromClients', {})
export const usersFromGuardians = () => gasAction<BulkAnswer>('usersFromGuardians', {})
export const guardiansToRoster = () => gasAction<{ created?: number; filled?: number; examined?: number }>('guardiansToRoster', {})
export const readThePlans = () =>
  gasAction<{ wrote?: number; refused?: number; skipped?: number; read?: number }>('ispContactsSweep', { redo: true })

/** `client` the name the chart files; `client_key` names the Clients client, so the door files it under its own name. */
export type MedDraft = { client: string; client_key?: string; name: string; dose: string; times: string; route: string; prn: string }
export const addMedication = (draft: MedDraft) => gasAction<{ id?: string }>('emarMedAdd', draft, { retry: false })

/* ---------- the hook ---------- */

export { IDLE, QUEUED_REREAD_MS, QUEUED_WORDS, readKey, writeQueued, type ReadState } from '@/lib/readCache'

// the roster ('*') reads again when any client is written
const reads = createReadCache({ stamp: clientAnswerAt, rosterFollows: true, app: CLIENTS_PACK })

/** Forget the answers held for a client (every section's), or every answer — and the client's pack and documents. */
export function forgetClientReads(client?: string): void {
  const one = client && client !== '*' ? client : ''
  forgetClientPack(one || undefined)
  forgetDocBytes(one ? `${CLIENTS_PACK}|${one}|` : `${CLIENTS_PACK}|`)
  reads.forget(client || undefined)
}

// A write landed for this client: its answers are forgotten and every section on screen reads again, its own apps'…
export function clientWritten(client: string, sentAt?: number): void {
  forgetClientReads(client)
  if (client && client !== '*') wroteClientPack(client, sentAt)
  reads.written(client)
  sourceWritten(client)
  transportWritten(client)
}

// A write sent at `sentAt` answered: the client is read again now, and once more after a queued write has had time…
export function clientWrote(client: string, answer: unknown, sentAt?: number): boolean {
  clientWritten(client, sentAt)
  return writtenAgainIfQueued(answer, () => clientWritten(client, sentAt))
}

// The relay's overlay took an edit for this client: the answers held here go; its pack already shows the edit.
export function clientOverlaid(client: string): void {
  forgetClientReads(client)
  reads.written(client)
}

/** Each section's read an Apply reads again, as the sections themselves key it. */
export const CLIENT_REREAD = {
  details: (client: string): Reread => ({ key: keyOf('clientProfileDetails', client), load: () => detailsOf(client) }),
  care: (client: string, view: string): Reread => ({ key: keyOf('clientProfileCare', client, view), load: () => careRead(client, view) }),
  meds: (client: string): Reread => ({ key: keyOf('clientProfileMeds', client, 'meds'), load: () => medsRead(client) }),
  incidents: (client: string): Reread => ({ key: keyOf('clientProfileIncidents', client), load: () => incidentsRead(client) }),
}

/** The sections read again, through the one read per key every section on screen shares. */
export function rereadClient(list: Reread[]): Promise<unknown[]> {
  return Promise.all(list.map((r) => reads.read(r.key, r.load)))
}

/** A client of Clients as an Apply's target (ApplyStrip.useApplyFor). */
export const clientTarget = (client: string): ApplyTarget => ({
  where: { app: CLIENTS_PACK, label: 'Clients', subject: 'client' },
  overlaid: () => clientOverlaid(client),
  wrote: (answer, sentAt) => { clientWrote(client, answer, sentAt) },
  written: (sentAt) => clientWritten(client, sentAt),
  reread: rereadClient,
})

/** A client's trip changed in the Transportation app's panel, as an Apply's target: the client's Transportation read again. */
export const transportTarget = (client: string): ApplyTarget => ({
  ...clientTarget(client),
  where: { app: CLIENTS_PACK, label: 'Clients', subject: 'client\'s trips' },
  reread: () => rereadTransport(client),
})

/* ---------- the editions this viewer makes in Clients (Settings › Editions) ---------- */

const editionsAsked = new Map<string, Promise<EditionId[]>>()

onMemoryBoundary(() => {
  editionsAsked.clear()
})

/** editionsMine for Clients; an answer without its list is "not confirmed", never "none", and is asked again. */
export async function readClientEditions(): Promise<EditionId[]> {
  const d = await gasAction<{ editions?: unknown }>('editionsMine', { app: CLIENTS_PACK })
  if (isRelayReceipt(d) || !Array.isArray(d?.editions)) throw new Error('The editions were not confirmed.')
  return editionIdsOf(d.editions)
}

function editionsOnce(who: string): Promise<EditionId[]> {
  const held = editionsAsked.get(who)
  if (held) return held
  const p = readClientEditions()
  p.catch(() => { if (editionsAsked.get(who) === p) editionsAsked.delete(who) })
  editionsAsked.set(who, p)
  return p
}

/** How long an unconfirmed read of the editions waits before it is asked again. */
export const EDITIONS_RETRY_MS = 30_000

const NO_EDITIONS: readonly EditionId[] = []

// The editions an employee makes here, once a session; none for the master (who makes all), a visit or a narrowed view.
export function useClientEditions(): readonly EditionId[] {
  const viewer = useEffectiveUser()
  const asks = !!viewer && !viewer.isMaster && !viewer.visiting && !narrowedReader()
    && EDITION_ROLES.includes(String(viewer.role ?? '').toLowerCase())
  const who = asks && viewer ? viewer.id : ''
  const [got, setGot] = useState<{ who: string; editions: EditionId[] }>({ who: '', editions: [] })
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

// One read, keyed (readCache.useCachedRead): the held answer drawn at once and read again behind it when stale…
export function useClientRead<T>(key: string | null, load: () => Promise<unknown>, shape: (raw: unknown) => T,
  first?: () => unknown): ReadState<T> & { reload: () => void } {
  return useCachedRead(reads, key, load, shape, first)
}
