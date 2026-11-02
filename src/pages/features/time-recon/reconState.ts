// The Time Reconciliation screens' view state that must survive the lanes answering again: the queue's folds and pages
// across a resolve's quiet refetch, the Overtime panel across a new answer, the entries read under the lane's day cap,
// and the Close-run warning's count. Kept out of the components so each rule is held by a test of its own
// (tests/spa/time-recon.test.tsx) — a click cannot be made in that harness, a hook can be mounted.
import { useState } from 'react'
import {
  daySpan, isDay,
  type OvertimePerson, type PayWeek, type QueueStatus, type ReconError, type ReconRun,
} from './reconTypes'

/** Cards an employee shows before "Show N more", and how many more each press adds. */
export const PER_EMPLOYEE = 10
/** More houses than this and the sections start folded. */
export const OPEN_UP_TO = 3
/** The overtime lanes' own limit (app/overtime_lanes.py MAX_DAYS): a longer range — the entries' too — answers 400. */
export const OVERTIME_MAX_DAYS = 62

/** The filters a queue answer was read for. */
export type QueueAsk = { from: string; to: string; house: string; employee: string; status: QueueStatus; type: string }

/** One string per filter set: the queue's folds and pages start afresh only when it moves. */
export function askKey(a: QueueAsk | null): string {
  return a ? [a.from, a.to, a.house, a.employee, a.status, a.type].join('|') : ''
}

/** `folded` null: no section drawn yet under these filters, so no default decided. */
type Folds = { key: string; folded: boolean | null; folds: Record<string, boolean>; limits: Record<string, number> }

/**
 * The queue's sections, open or folded, and each employee's cards shown — per filter set.
 *
 * The default (folded when more than OPEN_UP_TO houses are drawn and no house filter is set) is decided ONCE, on the
 * first answer of a filter set that draws a section, and kept until the filters change. Recomputed on every answer, a
 * resolve's quiet refetch that empties a house (four sections down to three) flipped every section the reviewer had
 * not touched open, and one that brought a fourth house shut them — under the reviewer's eyes, against "resolving keeps
 * the expansion". An empty answer decides nothing: a Run over an empty period refetches the same filters, and its five
 * houses still start folded. A new `resetKey` folds and pages afresh in the render it arrives in, never one late.
 */
export function useQueueFolds(resetKey: string, houses: number, houseFiltered: boolean) {
  const decide = (): boolean | null => (houses > 0 ? !houseFiltered && houses > OPEN_UP_TO : null)
  const [kept, setKept] = useState<Folds>(() => ({ key: resetKey, folded: decide(), folds: {}, limits: {} }))
  let s = kept
  if (kept.key !== resetKey) {
    s = { key: resetKey, folded: decide(), folds: {}, limits: {} }
    setKept(s)
  } else if (kept.folded === null && houses > 0) {
    s = { ...kept, folded: decide() }
    setKept(s)
  }
  const folded = s.folded ?? false
  return {
    /** the default this filter set was opened with */
    folded,
    isOpen: (house: string): boolean => s.folds[house] ?? !folded,
    setOpen: (house: string, open: boolean) => setKept((k) => ({ ...k, folds: { ...k.folds, [house]: open } })),
    setAll: (list: string[], open: boolean) =>
      setKept((k) => ({ ...k, folds: Object.fromEntries(list.map((h) => [h, open])) })),
    limitOf: (k: string): number => s.limits[k] ?? PER_EMPLOYEE,
    showMore: (k: string) =>
      setKept((x) => ({ ...x, limits: { ...x.limits, [k]: (x.limits[k] ?? PER_EMPLOYEE) + PER_EMPLOYEE } })),
  }
}

/**
 * The Overtime row whose panel is open, as the CURRENT answer holds it. Only the key is kept: the person is looked up
 * in every new answer (Refresh, other dates, other employees), so the panel never draws an old answer's weeks, days
 * and total against the new weeks. A person the new answer no longer holds closes the panel, and stays closed when a
 * later answer brings them back.
 */
export function useOpenPerson(people: OvertimePerson[] | null) {
  const [openKey, setOpenKey] = useState('')
  const open = openKey && people ? people.find((p) => p.key === openKey) ?? null : null
  if (openKey && people && !open) setOpenKey('')
  return { open, openKey: open ? openKey : '', setOpenKey }
}

/**
 * The reads one person's entries take: the WHOLE weeks drawn (their hours are whole weeks), cut into runs of whole
 * weeks of at most `max` days, since the lane refuses a longer range. Dates of 61 days can touch weeks of 63
 * (2026-09-01..10-31 → 08-30..10-31): read as one range, every drill-down said "Pick at most 62 days."
 */
export function entryRanges(weeks: PayWeek[], max = OVERTIME_MAX_DAYS): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = []
  for (const w of weeks) {
    if (!isDay(w.from) || !isDay(w.to)) continue
    const last = out[out.length - 1]
    if (last && daySpan(last.from, w.to) <= max) last.to = w.to
    else out.push({ from: w.from, to: w.to })
  }
  return out
}

/**
 * The open anomalies of a run, counted only when the list on screen is that run's whole open work: read over dates
 * that cover the run's own, with no house, person, type or Resolved narrowing it. null when the list cannot say —
 * a partial count is never stated as the run's ("3 still open" over a week of a two-week run).
 */
export function openLeftInRun(run: ReconRun, errors: ReconError[], on: QueueAsk | null): number | null {
  if (!on || on.house || on.employee || on.type || on.status === 'resolved') return null
  if (!isDay(run.dateFrom) || !isDay(run.dateTo) || on.from > run.dateFrom || on.to < run.dateTo) return null
  return errors.filter((e) => e.runId === run.id && e.status === 'Open').length
}
