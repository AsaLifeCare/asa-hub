// Which of the Hiring Pipeline's views THIS USER wants.
// The app grew its second view, just as the Clients app has.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type HiringViewId =
  | 'pipeline'
  | 'table' | 'calendar' | 'actions' | 'documents' | 'reports'
  | 'analysis' | 'scores' | 'archive'
// THE ORDER IS DELIBERATE: the dropdown carries a **Talents** item, and **Analysis** sits at the top of it.
export const HIRING_VIEWS: { id: HiringViewId; label: string }[] = [
  { id: 'analysis', label: 'Analysis' },
  { id: 'pipeline', label: 'Kanban' },
  { id: 'table', label: 'Table' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'actions', label: 'Actions' },
  // DOCUMENTS AND REPORTS ARE ONE VIEW: the two are united into a single view, which carries the name Documents.
  { id: 'documents', label: 'Documents' },
  { id: 'scores', label: 'Talents' },
  // THE ARCHIVE JOINS THE MENU, LAST: the Archive, until then a separate thing, is added as the final item of the…
  { id: 'archive', label: 'Archive' },
]

// Views the master's cell predates and therefore cannot have refused: they answer to the app's own door instead…
export const ABSORBED_VIEWS: HiringViewId[] = ['analysis', 'scores', 'archive']

// The views the Flow's rail used to hold — what the master's cell means when it still says the single word `flow`.
export const FLOW_VIEWS: HiringViewId[] = ['table', 'calendar', 'actions', 'documents', 'reports']

// The two Talent Pipeline screens folded in whole — the app and the Analysis had to come across intact.
export const TALENT_VIEWS: HiringViewId[] = ['analysis', 'scores']

// `flow` is a WORD IN A CELL, not a view: expand it to the views it stands for.
export function expandHiringViews(ids: string[]): HiringViewId[] {
  const out: HiringViewId[] = []
  for (const raw of ids) {
    const id = String(raw).trim()
    if (id === 'flow') { for (const f of FLOW_VIEWS) if (!out.includes(f)) out.push(f); continue }
    const known = HIRING_VIEWS.find((v) => v.id === id)
    if (known && !out.includes(known.id)) out.push(known.id)
  }
  return out
}

// The inverse, for WRITING the cell: the Flow views spelled back as the single word `flow` whenever ALL of them…
export function collapseHiringViews(ids: HiringViewId[]): string[] {
  const hasAllFlow = FLOW_VIEWS.every((f) => ids.includes(f))
  if (!hasAllFlow) return ids.slice()
  const out: string[] = []
  for (const id of ids) {
    if (FLOW_VIEWS.includes(id)) { if (!out.includes('flow')) out.push('flow'); continue }
    out.push(id)
  }
  return out
}

// Can the pre-merge parser (which knew only `pipeline` and `flow`) read this selection back without losing a view?
export function hiringViewsAreLegacySafe(ids: HiringViewId[]): boolean {
  return collapseHiringViews(ids).every((w) => w === 'pipeline' || w === 'flow')
}

type HiringViewsState = {
  // The view the UNIFIED Hiring page shows.
  selected: HiringViewId
  setSelected: (id: HiringViewId) => void
}

export const useHiringViewsStore = create<HiringViewsState>()(
  persist(
    (set) => ({
      selected: 'pipeline',
      setSelected: (id) => set({ selected: id }),
    }),
    {
      name: 'asa-hiring-views',
      // what was stored is not trusted: an unknown stored view (an older build, a hand edit) is not a view — the…
      merge: (persisted, current) => {
        const p = persisted as Partial<HiringViewsState> | undefined
        return {
          ...current,
          selected: HIRING_VIEWS.some((v) => v.id === p?.selected) ? (p?.selected as HiringViewId) : current.selected,
        }
      },
    },
  ),
)

// The view the unified page renders for a person: their selection when the master's policy still allows it, else…
export function pickHiringView(selected: HiringViewId, lawful: HiringViewId[]): HiringViewId {
  // A stored 'reports' is somebody's remembered choice for a view that became half of Documents — it lands there…
  if (selected === 'reports' && lawful.includes('documents')) return 'documents'
  if (lawful.includes(selected)) return selected
  if (lawful.includes('pipeline')) return 'pipeline'
  return lawful[0] ?? 'pipeline'
}
