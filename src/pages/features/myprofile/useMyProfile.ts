// My Profile's three reads: the relay's door, the certificate ledger and the address door — on mount, on a new…
// A 403 keeps the door's words.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '@/auth/useAuthStore'
import { gasAction } from '@/features/hiring/shared'
import type { UploadsAnswer } from '@/lib/certUploads'
import {
  LANE_RINGS, answerAge, copyAge, forgetLane, forgetLanes, keepLane, keptLane, laneGeneration, onLaneRing,
  refusalForgets,
} from '@/lib/laneKeep'
import { lane, LaneError } from '@/pages/features/shifts/laneFetch'
import { myProfilePath, UPLOADS_IDLE, type MyProfileView, type PersonEntry, type UploadsState } from './myProfileModel'
import { ADDRESS_IDLE, addressOf, type AddressState, type AddressView } from './addressModel'

export type MyProfileState = {
  status: 'idle' | 'loading' | 'ready' | 'failed' | 'refused'
  data: MyProfileView | null
  error: string
  reason: string
  readAt: number
  refreshing: boolean
  /** the answer drawn is a kept copy not read again since */
  kept?: boolean
}

export const MY_PROFILE_IDLE: MyProfileState = { status: 'idle', data: null, error: '', reason: '', readAt: 0, refreshing: false }

/** The master's person list — staff and clients — from the session's last mass answer, drawn while another read runs. */
export type Chooser = { people: PersonEntry[]; people_why: string; clients_why?: string; clients_note?: string }

/** The chooser a mass answer carries; an own answer carries none. */
export function chooserOf(view: MyProfileView): Chooser | null {
  const s = view.scope
  return s.mode === 'mass'
    ? { people: s.people ?? [], people_why: s.people_why ?? '', clients_why: s.clients_why ?? '', clients_note: s.clients_note ?? '' }
    : null
}

const held = new Map<string, MyProfileState>()
const heldUploads = new Map<string, UploadsState>()
const heldChooser = new Map<string, Chooser>()
const heldAddress = new Map<string, AddressState>()

/** Tests only: forget what was held, and the kept answers. */
export function forgetHeld(): void {
  forgetLanes()
  held.clear()
  heldUploads.clear()
  heldChooser.clear()
  heldAddress.clear()
}

const sessionKey = () => String(useAuthStore.getState().token ?? '')

/** The account's kept answer for a person, drawn before any read this session lands. */
function keptFor(person: string): MyProfileState | null {
  const data = keptLane<MyProfileView>(myProfilePath(person))
  return data ? { ...MY_PROFILE_IDLE, status: 'ready', data, readAt: copyAge(data), kept: true } : null
}

/** What is drawn for a person before their read lands: their own held or kept answer, never anybody else's. */
const heldFor = (k: string, person: string): MyProfileState =>
  held.get(k) ?? keptFor(person) ?? { ...MY_PROFILE_IDLE, status: 'loading' }

export function useMyProfile(enabled: boolean, person: string) {
  const session = sessionKey()
  const key = `${session}|${person}`
  const [slot, setSlot] = useState<{ key: string; state: MyProfileState }>(() => ({
    key, state: held.get(key) ?? (enabled ? keptFor(person) : null) ?? MY_PROFILE_IDLE,
  }))
  // the state belongs to the person it was read for: a new choice draws that person's, from the first render
  const state = slot.key === key ? slot.state : heldFor(key, person)
  const seq = useRef(0)

  const read = useCallback(async () => {
    if (!enabled) return
    const mine = ++seq.current
    const k = `${sessionKey()}|${person}`
    const path = myProfilePath(person)
    const generation = laneGeneration()
    // only this person's own answer is ever drawn while the read runs, never the one chosen before
    const base = held.get(k) ?? keptFor(person) ?? MY_PROFILE_IDLE
    setSlot({ key: k, state: { ...base, status: base.data ? base.status : 'loading', refreshing: true } })
    try {
      const got = await lane<MyProfileView>(path)
      if (mine !== seq.current) return
      keepLane(path, got, generation)
      const next: MyProfileState = { status: 'ready', data: got, error: '', reason: '', refreshing: false, ...answerAge(got) }
      held.set(k, next)
      const bar = got?.scope ? chooserOf(got) : null
      if (bar) heldChooser.set(sessionKey(), bar)
      else heldChooser.delete(sessionKey())
      setSlot({ key: k, state: next })
    } catch (err) {
      if (mine !== seq.current) return
      const refused = err instanceof LaneError && (err.status === 403 || err.reason === 'person')
      const message = err instanceof Error ? err.message : String(err)
      const reason = err instanceof LaneError ? err.reason : ''
      if (refused) {
        held.delete(k)
        if (refusalForgets(reason)) forgetLane(path)
      }
      setSlot((cur) => {
        const s = cur.key === k ? cur.state : heldFor(k, person)
        return { key: k, state: { ...s, status: refused ? 'refused' : 'failed', error: message, reason, refreshing: false, data: refused ? null : s.data } }
      })
    }
  }, [enabled, person])

  useEffect(() => {
    void read()
  }, [read])

  // the app's ring and the stream's return read again; nothing polls
  useEffect(() => (enabled ? onLaneRing(LANE_RINGS.profile, () => void read()) : undefined), [enabled, read])

  // the chooser is the answer's own when one is drawn; while a read runs, the session's last mass answer's
  const chooser: Chooser | null = state.data ? chooserOf(state.data) : (heldChooser.get(session) ?? null)

  return { state, refresh: read, chooser }
}

/** The certificate ledger as its own door answers this session: every row to the master, the caller's own to anyone else. */
export function useUploads(enabled: boolean) {
  const key = sessionKey()
  const [state, setState] = useState<UploadsState>(() => heldUploads.get(key) ?? UPLOADS_IDLE)
  const seq = useRef(0)

  const read = useCallback(async () => {
    if (!enabled) return
    const mine = ++seq.current
    setState((s) => (s.status === 'ready' ? s : { ...s, status: 'loading' }))
    try {
      const got = await gasAction<UploadsAnswer>('certUploadsList', {})
      if (mine !== seq.current) return
      if (!Array.isArray(got?.uploads)) {
        throw new Error('the ledger answered without its rows — nothing is listed rather than an empty list')
      }
      const next: UploadsState = {
        status: 'ready', rows: got.uploads, scope: got.scope === 'own' ? 'own' : 'all',
        self: String(got.self ?? '').trim(), error: '', refused: false,
      }
      heldUploads.set(sessionKey(), next)
      setState(next)
    } catch (err) {
      if (mine !== seq.current) return
      heldUploads.delete(sessionKey())
      // an own-scope 4xx is the door refusing to settle the caller's record — certDocUpload refuses the same way
      const env = (err as { envelope?: { scope?: unknown; status?: unknown } } | null)?.envelope
      const status = typeof env?.status === 'number' ? env.status : 0
      const refused = env?.scope === 'own' && status >= 400 && status < 500
      setState({ status: 'failed', rows: [], scope: '', self: '', error: err instanceof Error ? err.message : String(err), refused })
    }
  }, [enabled])

  useEffect(() => {
    void read()
  }, [read])

  return { uploads: state, refreshUploads: read }
}

// The address door's ask: nobody named for the caller's own record, the chosen staff key for the master's; `fresh`…
const addressPayload = (ask: string, fresh: boolean) => ({ ...(ask ? { key: ask } : {}), ...(fresh ? { edit: true } : {}) })

/** The save: only the parts that changed, each witnessed by the raw cell it was opened on. */
export const saveAddress = (ask: string, changes: { field: string; value: string; expected: string }[]) =>
  gasAction<unknown>('staffProfileAddressEdit', { ...(ask ? { key: ask } : {}), changes }, { retry: false })

// The Address as the Employee Database keeps it (staffProfileAddress), for `ask` — '' the caller's own record, a…
export function useAddress(ask: string | null) {
  const k = `${sessionKey()}|${ask ?? ''}`
  const [slot, setSlot] = useState<{ key: string; state: AddressState }>(() => ({
    key: k, state: (ask !== null && heldAddress.get(k)) || ADDRESS_IDLE,
  }))
  const state: AddressState = ask === null ? ADDRESS_IDLE
    : slot.key === k ? slot.state : (heldAddress.get(k) ?? { ...ADDRESS_IDLE, status: 'loading' })
  const seq = useRef(0)

  const read = useCallback(async (fresh = false) => {
    if (ask === null) return
    const mine = ++seq.current
    const key = `${sessionKey()}|${ask}`
    setSlot((cur) => {
      const base = (cur.key === key ? cur.state : null) ?? heldAddress.get(key) ?? ADDRESS_IDLE
      return { key, state: base.data ? base : { ...base, status: 'loading' } }
    })
    try {
      const got = addressOf(await gasAction<unknown>('staffProfileAddress', addressPayload(ask, fresh)))
      if (mine !== seq.current) return
      if (!got) throw new Error('the address door answered without an address')
      const next: AddressState = { status: 'ready', data: got, error: '' }
      heldAddress.set(key, next)
      setSlot({ key, state: next })
    } catch (err) {
      if (mine !== seq.current) return
      const status = (err as { status?: unknown } | null)?.status
      const refused = typeof status === 'number' && status >= 400 && status < 500
      const error = err instanceof Error ? err.message : String(err)
      if (refused) heldAddress.delete(key)
      setSlot((cur) => {
        const s = (cur.key === key ? cur.state : null) ?? heldAddress.get(key) ?? ADDRESS_IDLE
        return { key, state: { status: refused ? 'refused' : 'failed', data: refused ? null : s.data, error } }
      })
    }
  }, [ask])

  useEffect(() => {
    void read()
  }, [read])

  // the app's ring (a save, here or in another tab) and the stream's return read again; nothing polls
  useEffect(() => (ask === null ? undefined : onLaneRing(LANE_RINGS.profile, () => void read())), [ask, read])

  const saved = useCallback((data: AddressView) => {
    if (ask === null) return
    // a read that left before the save never draws over it
    seq.current++
    const key = `${sessionKey()}|${ask}`
    const next: AddressState = { status: 'ready', data, error: '' }
    heldAddress.set(key, next)
    setSlot({ key, state: next })
  }, [ask])

  return { address: state, refreshAddress: read, savedAddress: saved }
}
