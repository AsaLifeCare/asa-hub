/**
 * ONE CLIENT'S DAILY NOTES, as the door hands them over — shared by the hook
 * tests (daily-notes.test.ts) and the screen tests (daily-screen.test.tsx).
 */
import type { DailyNote } from '@/pages/features/clients/daily/dailyApi'

export const NO_SHIFT: DailyNote['shift'] = {
  via: 'none', label: '', start: '', end: '', house: '', at_client_house: null,
  staff_match: '', date: '', source: '', covers_call: null,
}

export function note(id: string, call: string, day: string, at: string, more: Partial<DailyNote> = {}): DailyNote {
  return {
    id, key: '', call_id: call, reporting_date: day, call_at: at, dsp_name: 'Ann Lee',
    category: 'sleep', category_label: 'Sleep', kind: 'daily', response: `note ${id}`,
    client: 'Jo Doe', client_match: 'exact', written_as: 'Jo Doe', shift: NO_SHIFT, ...more,
  }
}

/**
 * Five calls on three dated days — and one undated — given to the section in
 * no useful order, the way rows come off a book. Newest first they are:
 * c3 (Sep 21) · c2, c1 (Sep 20, c2 later that day) · c4 (Sep 19) · c5 (undated).
 *
 * The middle day is the one that matters: a day carrying TWO calls and three
 * notes is what "the day's notes together on one page" is tested on.
 */
export const NOTES: DailyNote[] = [
  note('r11', 'c1', '2026-09-20', '2026-09-20T13:00:00Z'),
  note('r5', 'c4', '2026-09-19', '2026-09-19T15:00:00Z'),
  note('r21', 'c3', '2026-09-21', '2026-09-21T09:00:00Z', { kind: 'not_daily', category: 'fall' }),
  note('r1', 'c5', '', ''),
  note('r10', 'c1', '2026-09-20', '2026-09-20T13:00:00Z'),
  note('r12', 'c2', '2026-09-20', '2026-09-20T20:00:00Z'),
  note('r20', 'c3', '2026-09-21', '2026-09-21T09:00:00Z'),
  note('r22', 'c3', '2026-09-21', '2026-09-21T09:00:00Z'),
]
/** The pages the section walks, in order: one day each, the undated one last. */
export const NEWEST_DAYS_FIRST = ['2026-09-21', '2026-09-20', '2026-09-19', '']

/** A report on a NEW day, filed after the reader went to Medications. */
export const LATER = note('r30', 'c6', '2026-09-22', '2026-09-22T08:00:00Z')

/** A report on the day the reader is already reading — it joins their page. */
export const LATER_SAME_DAY = note('r31', 'c7', '2026-09-20', '2026-09-20T22:00:00Z')

/**
 * ONE DAY OF THE LIVE BOOK'S WORST SHAPE: a call filed TWICE under one call
 * id, the two filings stamped differently, with another call in between.
 *
 * The book really does this — two sweeps each file a row per thing asked, one
 * writing 'YYYY-MM-DDTHH:MM:SSZ' and the other a naked 'M/D/YYYY HH:MM:SS' the
 * door can only read against a declared zone — so the door hands the screen
 * two instants for one call, and the part of the day each was placed on
 * differs with them. Here: the naked filing (rows 61–62) reads three hours
 * later than the ISO one (rows 71–72), which put them either side of `mid`.
 */
export const TWICE_FILED_AT = '2026-03-04T21:52:40Z'
export const TWICE_FILED: DailyNote[] = [
  note('r61', 'twice', '2026-03-04', '2026-03-05T00:52:40Z', { shift: { ...NO_SHIFT, via: 'call_time', label: 'Evening' } }),
  note('r62', 'twice', '2026-03-04', '2026-03-05T00:52:40Z', { shift: { ...NO_SHIFT, via: 'call_time', label: 'Evening' } }),
  note('r65', 'mid', '2026-03-04', '2026-03-04T23:00:00Z', { shift: { ...NO_SHIFT, via: 'call_time', label: 'Evening' } }),
  note('r71', 'twice', '2026-03-04', TWICE_FILED_AT, { shift: { ...NO_SHIFT, via: 'call_time', label: 'Afternoon' } }),
  note('r72', 'twice', '2026-03-04', TWICE_FILED_AT, { shift: { ...NO_SHIFT, via: 'call_time', label: 'Afternoon' } }),
]
/** The parts of the one call, side by side, with the other call above them. */
export const TWICE_FILED_ORDER = ['r65', 'r71', 'r72', 'r61', 'r62']

/** A call the book never timed — a quarter of the live rows carry no stamp. */
export const UNTIMED: DailyNote[] = [
  note('r80', 'c80', '2026-09-18', ''),
  note('r81', 'c80', '2026-09-18', ''),
]

/** One call on each of 25 August days, one note each — 25 pages of one day. */
export function manyDays(): DailyNote[] {
  const many: DailyNote[] = []
  for (let d = 1; d <= 25; d++) {
    const day = `2026-08-${String(d).padStart(2, '0')}`
    many.push(note(`r${d}`, `c${d}`, day, `${day}T12:00:00Z`))
  }
  return many
}
