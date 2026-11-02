// Emergency Contacts' two doors, both Python's (app/emergency_contacts.py): the directory read and its one save.
// The page paints at once from this account's kept copy, else the compiled directory, and reads again on the app's
// ring and when the stream reopens — never on a clock. A refusal or a failure draws the compiled directory.
import { useCallback, useEffect, useRef, useState } from 'react'
import { gasAction } from '@/features/hiring/shared'
import { onMemoryBoundary } from '@/lib/appPack'
import { forgetKept, keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { placeScope } from '@/lib/placeKey'
import { onLiveEvent } from '@/lib/snapshotClient'
import { useAuthStore } from '@/auth/useAuthStore'
import { COMPILED, directoryFrom, directoryOfAnswer, type Directory, type SavePayload } from './emergencyContactsModel'

/** The name the relay rings after a save Python kept. */
export const EMERGENCY_CONTACTS_EVENT = 'emergency-contacts'
export const KEPT_DIRECTORY_PREFIX = 'asa:emergency:directory:'
/** A kept copy older than this is not painted. */
export const KEPT_MS = 7 * 24 * 3_600_000

type KeptDirectory = { owner: string; at: number; directory: Directory }

/** The account the copy is kept for, at the place it is read in. */
function ownerKey(): string {
  const me = String(useAuthStore.getState().user?.id ?? '')
  return me ? placeScope(me) : ''
}

const keptKeyOf = (owner: string) => `${KEPT_DIRECTORY_PREFIX}${owner}`

/** This account's kept Python directory at this place, when young enough; null otherwise. */
export function keptDirectory(owner = ownerKey(), now = Date.now()): Directory | null {
  if (!owner) return null
  const o = readKept<KeptDirectory>(keptKeyOf(owner))
  if (!o || o.owner !== owner || typeof o.at !== 'number' || now - o.at > KEPT_MS) return null
  const d = directoryFrom({ source: o.directory?.source, groups: o.directory?.groups, can_edit: o.directory?.canEdit === true })
  return d.source === 'python' ? d : null
}

function hold(d: Directory, owner: string, generation: string): void {
  if (!owner) return
  if (d.source === 'python') keepIfCurrent(keptKeyOf(owner), { owner, at: Date.now(), directory: d } satisfies KeptDirectory, generation)
  else forgetKept(keptKeyOf(owner))
}

/** emergencyContactsRead: the Python directory, or the compiled one (the app is not on Python here). */
export const readDirectory = (): Promise<Directory> =>
  gasAction<unknown>('emergencyContactsRead', {}).then(directoryFrom)

/** emergencyContactsSave: one change; the answer's data (a refusal throws with its envelope). */
export const saveDirectory = (p: SavePayload): Promise<unknown> =>
  gasAction<unknown>('emergencyContactsSave', p, { retry: false })

const crossers = new Set<() => void>()
onMemoryBoundary(() => { for (const fn of [...crossers]) fn() })

export type DirectoryState = { directory: Directory; refreshing: boolean }

// The directory: painted from the kept copy or the compiled one, read on mount, on the app's ring and on the stream's
// reopening; a save's own answer replaces it, and a read that left before that answer is dropped.
export function useDirectory(): DirectoryState & { absorb: (data: unknown) => void; adopt: (d: Directory) => void; reload: () => void } {
  const [state, setState] = useState<DirectoryState>(() => ({ directory: keptDirectory() ?? COMPILED, refreshing: true }))
  const live = useRef(true)
  const version = useRef(0)

  const read = useCallback(() => {
    const asked = version.current
    const owner = ownerKey()
    const generation = keptGeneration()
    readDirectory()
      .then((d) => {
        // a save answered since this read left: its directory is newer, and its ring reads again
        if (!live.current || asked !== version.current) return
        hold(d, owner, generation)
        setState({ directory: d, refreshing: false })
      })
      .catch(() => {
        if (!live.current || asked !== version.current) return
        setState({ directory: COMPILED, refreshing: false })
      })
  }, [])

  const adopt = useCallback((d: Directory) => {
    version.current++
    hold(d, ownerKey(), keptGeneration())
    setState({ directory: d, refreshing: false })
  }, [])

  const absorb = useCallback((data: unknown) => {
    const d = directoryOfAnswer(data)
    if (d) adopt(d)
  }, [adopt])

  useEffect(() => {
    live.current = true
    read()
    const offRing = onLiveEvent(EMERGENCY_CONTACTS_EVENT, read)
    const offOpen = onLiveEvent('open', read)
    const onCrossing = () => {
      version.current++
      setState({ directory: COMPILED, refreshing: true })
      read()
    }
    crossers.add(onCrossing)
    return () => {
      live.current = false
      offRing()
      offOpen()
      crossers.delete(onCrossing)
    }
  }, [read])

  return { ...state, absorb, adopt, reload: read }
}
