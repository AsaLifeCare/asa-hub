// Which of the Clients app's views THIS USER wants.
// The app ships with settings that can make all three views available, or two, or only one — the user decides.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ClientViewId = 'directory' | 'record' | 'unique'
export const CLIENT_VIEWS: { id: ClientViewId; label: string }[] = [
  { id: 'directory', label: 'Directory' },
  { id: 'record', label: 'Record' },
  { id: 'unique', label: 'Unique' },
]

type ClientViewsState = {
  enabled: Record<ClientViewId, boolean>
  toggle: (id: ClientViewId) => void
  // The view the UNIFIED Clients page shows: the three views are united and chosen through the Views button, with…
  selected: ClientViewId
  setSelected: (id: ClientViewId) => void
}

// All-off is not a state this store can hold: an app whose every door is hidden is an app that vanished.
function atLeastOne(enabled: Partial<Record<ClientViewId, boolean>> | undefined): Record<ClientViewId, boolean> {
  const e = {
    directory: enabled?.directory ?? true,
    record: enabled?.record ?? true,
    unique: enabled?.unique ?? true,
  }
  if (!e.directory && !e.record && !e.unique) e.directory = true
  return e
}

export const useClientViewsStore = create<ClientViewsState>()(
  persist(
    (set) => ({
      enabled: { directory: true, record: true, unique: true },
      toggle: (id) =>
        set((s) => {
          const next = { ...s.enabled, [id]: !s.enabled[id] }
          // the last visible view refuses to hide — the chooser disables its switch too, so this guard is the belt…
          if (!Object.values(next).some(Boolean)) return s
          return { enabled: next }
        }),
      // Unique is the door the app opens on until the person picks otherwise
      selected: 'unique',
      setSelected: (id) => set({ selected: id }),
    }),
    {
      name: 'asa-client-views',
      // WHAT WAS STORED IS NOT TRUSTED: the guard above only protects the paths that go through toggle(), and…
      merge: (persisted, current) => {
        const p = persisted as Partial<ClientViewsState> | undefined
        return {
          ...current,
          enabled: atLeastOne(p?.enabled),
          // an unknown stored view (an older build, a hand edit) is not a view — the default answers instead
          selected: CLIENT_VIEWS.some((v) => v.id === p?.selected) ? (p?.selected as ClientViewId) : current.selected,
        }
      },
    },
  ),
)

// The view the unified page renders for a person: their selection when the master's policy still allows it, else…
export function pickClientView(selected: ClientViewId, lawful: ClientViewId[]): ClientViewId {
  if (lawful.includes(selected)) return selected
  if (lawful.includes('unique')) return 'unique'
  return lawful[0] ?? 'unique'
}
