// The Builder's house lane: the House Calendars grid with the draft laid on, and the doors that change it.
// Every edit is a draft; only Publish writes the workbook, and Mark Call-Off is not a draft.
import { lane, post } from '@/pages/features/shifts/laneFetch'
import type { Grid, HistoryEntry, House } from '@/pages/features/shifts/houseCalTypes'

export type BuilderHouse = House & { drafts: number }

export type BuilderHouses = {
  houses: BuilderHouse[]
  me: string
  /** the reader edits every house — the master grid is theirs too */
  edits_every_house: boolean
  managers_readable: boolean
  managers_why: string
}

export type StaffDirectory = {
  staff: { name: string; houses: string[] }[]
  /** false: only calendar names are listed, and the screen says so */
  accounts_readable: boolean
}

/** Every write door's answer carries the house re-read, whole. */
type WithGrid<T> = T & { grid?: Grid | null }

export type PublishResult = WithGrid<{
  written: number
  already: number
  rows_added: string[]
  published: number
  training: string[]
  /** false: written to the workbook, but not recorded */
  recorded?: boolean
  /** true: test mode held the write; the workbook was not written */
  test_mode?: boolean
}>

export type CallOffResult = WithGrid<{
  ref: string
  location: string
  col_iso: string
  value: string
  path: string
  window: { closes_at: string; state: string; why: string }
  /** the rest of the call-off, owed to Apps Script ('owed' at the press) */
  road?: string
}>

export type HeldDiscardResult = WithGrid<{ discarded: number; trainings_withdrawn: number }>

/** One refused cell of a publish. */
export type BlockedCell = {
  employee: string
  col_iso: string
  value?: string
  base?: string
  live?: string
  reason: string
}

const BASE = '/hub-lanes/calendar-builder'

export const houseLane = {
  houses: () => lane<BuilderHouses>(`${BASE}/houses`),
  grid: (location: string) => lane<Grid>(`${BASE}/house?location=${encodeURIComponent(location)}`),
  staff: () => lane<StaffDirectory>(`${BASE}/staff`),
  history: (location: string, employee: string, colIso: string) =>
    lane<{ history: HistoryEntry[] }>(
      `${BASE}/house-history?location=${encodeURIComponent(location)}`
      + `&employee=${encodeURIComponent(employee)}&col_iso=${encodeURIComponent(colIso)}`),
  cell: (body: {
    location: string; employee: string; col_iso: string; value?: string; start?: string;
    end?: string; keep_star?: boolean; note?: string; via?: 'cell' | 'times' | 'delete' | 'add'
  }) => post<WithGrid<{ changed: boolean; employee: string; value: string; was: string; warning?: string }>>(`${BASE}/house/cell`, body),
  move: (body: {
    location: string; from: { employee: string; col_iso: string }; to: { employee: string; col_iso: string };
    swap?: boolean; replace?: boolean; value?: string; start?: string; end?: string;
    keep_star?: boolean; note?: string
  }) => post<WithGrid<{ moved: boolean; replaced: boolean; displaced: string; value: string; warning?: string }>>(`${BASE}/house/move`, body),
  requestOff: (location: string, employee: string, colIso: string, note: string) =>
    post<WithGrid<{ changed: boolean; moved_to: string; why?: string }>>(`${BASE}/house/request-off`,
      { location, employee, col_iso: colIso, note }),
  callOff: (location: string, employee: string, colIso: string, note: string) =>
    post<CallOffResult>(`${BASE}/house/call-off`, { location, employee, col_iso: colIso, note }),
  undo: (location: string) => post<WithGrid<{ undone: number }>>(`${BASE}/house/undo`, { location }),
  discard: (location: string) => post<WithGrid<{ discarded: number }>>(`${BASE}/house/discard`, { location }),
  publish: (location: string) => post<PublishResult>(`${BASE}/house/publish`, { location }),
  /** what test mode held at this house, into the workbook — refused while it holds */
  heldPublish: (location: string) => post<PublishResult>(`${BASE}/house/held/publish`, { location }),
  /** what test mode held at this house, thrown away — never reaches the workbook */
  heldDiscard: (location: string) => post<HeldDiscardResult>(`${BASE}/house/held/discard`, { location }),
}
