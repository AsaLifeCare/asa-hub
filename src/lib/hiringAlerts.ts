// One `hiringAlertsGet` for every Settings section.
// MEASURED, 2026-08-29: ten executions in six minutes, three times the next action on the list.
import { gasAction } from '@/features/hiring/shared'
import { adoptAppsCut } from '@/lib/appsCut'

/** The whole envelope — sections read `rows`, `test_mode`, `scorecard`. */
export type AlertsAnswer = Record<string, unknown>

let inFlight: Promise<AlertsAnswer> | null = null
let cached: AlertsAnswer | null = null
let fetchedAt = 0

// THIRTY SECONDS WAS TOO SHORT, MEASURED (2026-08-29).
const FRESH_MS = 3 * 60_000

export function fetchAlerts(opts?: { force?: boolean }): Promise<AlertsAnswer> {
  if (!opts?.force) {
    if (inFlight) return inFlight
    if (cached && Date.now() - fetchedAt < FRESH_MS) return Promise.resolve(cached)
  }
  inFlight = gasAction<AlertsAnswer>('hiringAlertsGet', {})
    .then((d) => {
      cached = d || {}
      fetchedAt = Date.now()
      adoptAppsCut(cached.rows)
      return cached
    })
    .finally(() => { inFlight = null })
  return inFlight
}

/** A save just landed — the next read must not be the copy from before it. */
export function dropAlertsCache(): void {
  cached = null
  fetchedAt = 0
}
