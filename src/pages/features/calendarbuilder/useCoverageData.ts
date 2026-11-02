// Calendar Builder · coverage data — the roster profile and the suggestions.
// Two DERIVED slices, read from the slice shelf directly and never through api.list, for the same reason…
import { useCallback, useEffect, useState } from 'react'
import { onSliceChange, readSlice, readSliceFloor } from '@/lib/snapshotClient'

// How old each source was when the reading was taken.
export type CoverageFreshness = {
  sources?: Record<string, string>
  sources_not_answering?: string[]
  read_at?: string
}

// One person who could take one shift.
export type CoverageCandidate = {
  person_key: string
  name: string
  // the smaller of the two gaps either side, in hours; null = nothing on the roster to turn around from, which is…
  rest_hours: number | null
  gap_before_hours: number | null
  gap_after_hours: number | null
  reason: string
  reasons: string[]
  cautions: string[]
  reach: string
  reach_window: string
  hours_that_week: number
  would_be_day_in_a_row: number
}

export type CoverageKind = 'conflict_release' | 'open_cell' | 'not_a_staffing_question'

export type CoverageVacancy = {
  id: string
  kind: CoverageKind
  // the two rows of one double-booking share this, so a count of conflicts is never a count of cells
  conflict_id: string
  headline: string
  house: string
  date: string
  text: string
  shift_kind: string
  starts_at: string
  ends_at: string
  hours: number | null
  sheet_row: number
  held_by: string
  conflict_side: string
  conflict_overlap_hours: number | null
  conflict_other: string
  shape: string
  candidates: CoverageCandidate[]
  also: { name: string; rest_hours: number | null }[]
  qualified: number
  considered: number
  why_not: { because: string; people: number }[]
  why_empty: string
  period_from: string
  period_to: string
  is_in_the_past: boolean
  freshness?: CoverageFreshness
}

export type RosterProfile = {
  id: string
  person_key: string
  name: string
  fact_period_from: string
  fact_period_to: string
  fact_shifts_rostered: number
  fact_days_rostered: number
  fact_hours_rostered: number
  // the COUNT of house blocks, never the codes — a house code stands 1:1 with a client's home, and a list of them…
  fact_house_blocks: number
  fact_first_day: string
  fact_last_day: string
  fact_preference_reading: string
  fact_stated_shifts: string
  fact_stated_note: string
  fact_stated_bars: string
  fact_weekend_pool: string
  fact_pickup: string
  fact_allergy_on_file: string
  fact_requests_touching_period: number
  fact_request_days: string
  fact_qualification_reading: string
  fact_expired_blocking: string
  fact_expired_shared_by_whole_roster: string
  fact_expiring_soon: string
  fact_training_verdict: string
  fact_training_why: string
  fact_ist_owed: number | null
  fact_reach_reading: string
  fact_reach_route_on_file: boolean
  fact_reach_window_from: string
  fact_reach_window_to: string
  fact_reach_window_why: string
  soft_longest_run_days: number
  soft_busiest_week_start: string
  soft_busiest_week_hours: number
  soft_overnights_rostered: number
  soft_back_to_back_days: string
  soft_strain_measured_from: string
  soft_preference_contradicted: string
  soft_call_offs_recorded_all_time: number | null
  soft_late_shows_all_time: number | null
  soft_call_off_reading: string
  soft_late_show_means: string
  soft_attendance_books: string
  soft_attendance_rate_state: string
  soft_attendance_denominator_says: string
  refused_behaviour_schedule_verdict: string
  refused_site_measurements: string
  refused_call_off_prose: string
  refused_client_identity: string
  refused_absence_rate_as_a_rank: string
  freshness?: CoverageFreshness
}

const COVERAGE_RESOURCES = ['coverageSuggestions', 'rosterProfile', 'callOffs'] as const

// One resource, slice-only.
async function read<T>(resource: string): Promise<{ rows: T[]; old: boolean } | null> {
  try {
    const fresh = await readSlice<T>(resource)
    if (fresh) return { rows: fresh, old: false }
    const floor = await readSliceFloor<T>(resource)
    if (floor) return { rows: floor.rows, old: true }
  } catch {
    return null
  }
  return null
}

// A CALL-OFF AS THIS SCREEN NEEDS IT (package 2).
export type CoverageCallOff = {
  id?: string
  person_name?: string
  person_key?: string
  shift_date?: string
  house?: string
  subject_state?: string
  recorded_at?: string
  source?: string
}

export function useCoverageData() {
  const [vacancies, setVacancies] = useState<CoverageVacancy[] | null>(null)
  const [callOffs, setCallOffs] = useState<CoverageCallOff[] | null>(null)
  const [profiles, setProfiles] = useState<RosterProfile[] | null>(null)
  const [stale, setStale] = useState(false)
  const [loading, setLoading] = useState(true)
  /** the reading has no door on this deployment — say that, do not draw zeros */
  const [noDoor, setNoDoor] = useState(false)

  const load = useCallback(() => {
    let alive = true
    setLoading(true)
    void Promise.all([read<CoverageVacancy>('coverageSuggestions'),
                      read<RosterProfile>('rosterProfile'),
                      read<CoverageCallOff>('callOffs')])
      .then(([v, p, c]) => {
        if (!alive) return
        setVacancies(v ? v.rows : null)
        setProfiles(p ? p.rows : null)
        // null, not [] — a book this deployment does not serve must never be drawn as "nobody called off".
        setCallOffs(c ? c.rows : null)
        setStale(Boolean(v?.old || p?.old || c?.old))
        setNoDoor(v === null)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => load(), [load])

  // the slices turn over quietly; re-serve without a spinner
  useEffect(
    () =>
      onSliceChange((resource) => {
        if ((COVERAGE_RESOURCES as readonly string[]).includes(resource)) load()
      }),
    [load],
  )

  return { vacancies, profiles, callOffs, loading, stale, noDoor, reload: load }
}
