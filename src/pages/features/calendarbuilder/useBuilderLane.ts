// The master grid's lane (/hub-lanes/calendar-builder/grid): the workbook with the draft laid on, and the cell…
// One house at a time is useHouseBuilderLane.
import { useAuthStore } from '@/auth/useAuthStore'
import type { CalendarConflict, CalendarHours, GridPeriodCol, GridRow } from './useCalendarData'

export type DraftEntry = {
  sheetRow: number
  date: string
  value: string
  baseValue: string
  updatedBy: string
  updatedAt: string
}

export type BuilderLaneData = {
  period: { start: string; end: string; days: number; cols: GridPeriodCol[] }
  rows: GridRow[]
  draft: DraftEntry[]
  draftCount: number
  conflicts: CalendarConflict[]
  hours: CalendarHours[]
  /** whether test mode holds roster writes now (unreadable holds); the master publish is refused while it does */
  test_mode?: { on: boolean; readable: boolean; why: string }
}

export type PublishBlocked = {
  sheetRow: number
  date: string
  house?: string
  employee?: string
  reason: string
}

export class PublishRefused extends Error {
  blocked: PublishBlocked[]
  constructor(message: string, blocked: PublishBlocked[]) {
    super(message)
    this.blocked = blocked
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  const env = await res.json().catch(() => ({}))
  if (Number(env.status) === 409 && env.data?.blocked) {
    throw new PublishRefused(String(env.message || 'the publish needs a human look'), env.data.blocked)
  }
  if (Number(env.status) !== 200) throw new Error(String(env.message || `the server answered ${res.status}`))
  return env.data as T
}

export const builderLane = {
  grid: () => call<BuilderLaneData>('/hub-lanes/calendar-builder/grid'),
  setCell: (sheetRow: number, dateIso: string, value: string) =>
    call<{ sheetRow: number; date: string; value: string }>('/hub-lanes/calendar-builder/cell', {
      method: 'POST',
      body: JSON.stringify({ sheet_row: sheetRow, date_iso: dateIso, value }),
    }),
  applyRequests: () =>
    call<{ applied: number; moves: { moved: string; to: string; house: string; date: string }[] }>(
      '/hub-lanes/calendar-builder/apply-requests',
      { method: 'POST' },
    ),
  generate: () =>
    call<GenerateResult>(
      '/hub-lanes/calendar-builder/generate',
      { method: 'POST' },
    ),
  publish: () =>
    call<{ written: number; appended: number; period: string }>(
      '/hub-lanes/calendar-builder/publish',
      { method: 'POST' },
    ),
  // `test_mode`: test mode held the houses' cells — recorded, the workbook not written
  publishHouses: (dryRun: boolean) =>
    call<{ written: number; houses: HousePublishResult[]; test_mode?: boolean }>(
      '/hub-lanes/calendar-builder/publish-houses',
      { method: 'POST', body: JSON.stringify({ dry_run: dryRun }) },
    ),
}

export type GenerateResult = {
  staged: number
  skippedConflicts: number
  skippedFullWeeks: number
  skippedTimeOffAsked?: number
  period: string
  note: string
}

/** The Auto-fill toast: every blank the generator left, and why. */
export function generateSummary(r: GenerateResult): string {
  const asked = r.skippedTimeOffAsked ?? 0
  return [
    `${r.skippedConflicts} conflicts avoided`,
    `${r.skippedFullWeeks} full-week skips`,
    ...(asked ? [`${asked} day${asked === 1 ? '' : 's'} left blank where time off is asked and still waiting`] : []),
  ].join(' · ') + '. Review the grid, then Publish.'
}

// One house tab's publish outcome — the dry run carries the same shape, with `preview` showing the first few cells…
export type HousePublishResult = {
  house: string
  tab: string
  written: number
  skipped: string[]
  /** 'refused': nothing written at that house; `refused` names the cells */
  status: 'ok' | 'skipped' | 'refused'
  why?: string
  refused?: { employee: string; col_iso: string; value?: string; reason: string }[]
  preview?: { range: string; from: string; to: string }[]
  dryRun?: boolean
}

/** draft key — one per (grid row, day) */
export const draftKey = (sheetRow: number, date: string) => `${sheetRow}|${date}`
